const CONFIG_FIELDS = [
  'apiKey', 'authDomain', 'databaseURL', 'projectId',
  'storageBucket', 'messagingSenderId', 'appId', 'measurementId',
];

export function normalizeSchoolConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Firebase config ไม่ถูกต้อง');
  }

  // Keep a fixed field order so equivalent configs produce the same hash.
  const config = {};
  for (const key of CONFIG_FIELDS) {
    const value = raw[key];
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || value.length > 2048) {
      throw new Error('Firebase config ไม่ถูกต้อง');
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    // Firebase web config values are ASCII; this also keeps btoa reversible.
    if (/[^\x20-\x7e]/.test(trimmed)) throw new Error('Firebase config ไม่ถูกต้อง');
    config[key] = trimmed;
  }

  if (!config.apiKey || !config.databaseURL) {
    throw new Error('Firebase config ต้องมี apiKey และ databaseURL');
  }
  let databaseURL;
  try { databaseURL = new URL(config.databaseURL); }
  catch { throw new Error('databaseURL ไม่ถูกต้อง'); }
  if (databaseURL.protocol !== 'https:' || !databaseURL.hostname ||
      databaseURL.username || databaseURL.password || databaseURL.search || databaseURL.hash) {
    throw new Error('databaseURL ต้องเป็น HTTPS');
  }
  config.databaseURL = databaseURL.href.replace(/\/+$/, '');
  return config;
}

export async function schoolConfigHash(config) {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(JSON.stringify(config))
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function newSchoolToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

export function schoolAppUrl(configJson) {
  return 'https://pp5-40s.pages.dev/#fbcfg=' + encodeURIComponent(btoa(configJson));
}
