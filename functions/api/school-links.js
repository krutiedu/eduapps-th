import { normalizeSchoolConfig, schoolConfigHash, newSchoolToken } from '../_school-links.js';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const shortUrl = token => `https://kru-ti.com/s/${token}`;

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'บริการลิงก์ยังไม่พร้อมใช้งาน' }, 503);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 8192) return json({ error: 'Firebase config ยาวเกินไป' }, 413);

  let config;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: 'Firebase config ยาวเกินไป' }, 413);
    const body = JSON.parse(raw);
    config = normalizeSchoolConfig(body && body.config);
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'ข้อมูลที่ส่งมาไม่ใช่ JSON' : (error.message || 'Firebase config ไม่ถูกต้อง') }, 400);
  }

  const configJson = JSON.stringify(config);
  const configHash = await schoolConfigHash(config);
  try {
    const existing = await env.DB.prepare(
      'SELECT token FROM school_short_links WHERE config_hash = ?'
    ).bind(configHash).first();
    if (existing) return json({ url: shortUrl(existing.token), existing: true });

    for (let attempt = 0; attempt < 3; attempt++) {
      const token = newSchoolToken();
      try {
        await env.DB.prepare(
          'INSERT INTO school_short_links (token, config_hash, config_json) VALUES (?, ?, ?)'
        ).bind(token, configHash, configJson).run();
        return json({ url: shortUrl(token), existing: false }, 201);
      } catch (error) {
        if (!/UNIQUE constraint failed/i.test(String(error))) throw error;
        // A concurrent click may have inserted this config. The unique hash
        // makes both callers return the same link; a token collision retries.
        const concurrent = await env.DB.prepare(
          'SELECT token FROM school_short_links WHERE config_hash = ?'
        ).bind(configHash).first();
        if (concurrent) return json({ url: shortUrl(concurrent.token), existing: true });
      }
    }
  } catch {
    return json({ error: 'สร้างลิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง' }, 503);
  }
  return json({ error: 'สร้างลิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง' }, 503);
}
