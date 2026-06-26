// ═══════════════════════════════════════════════════════
// EduApps TH — Backend API
// Cloudflare Pages Functions  →  /functions/api/[[route]].js
// ═══════════════════════════════════════════════════════

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ok  = (data, h={})  => new Response(JSON.stringify(data),  { status: 200, headers: { ...CORS, ...h } });
const err = (msg,  s=400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS });
// public GET ที่ cache ได้ — browser/edge เก็บ 60 วิ ลดภาระ D1
const okCache = (data) => ok(data, { 'Cache-Control': 'public, max-age=60' });

// ── ENTRY POINT ──────────────────────────────────────────
export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const segments = params.route || [];
  const path     = '/' + segments.join('/');
  const method   = request.method;

  // ── AUTH CHECK ──
  const needsAuth = (
    path.startsWith('/articles/admin') ||
    (path.startsWith('/articles') && method !== 'GET') ||
    path.startsWith('/apps/admin') ||
    (path.startsWith('/apps') && method !== 'GET' && !path.includes('/unlock')) ||
    (path.startsWith('/worksheets') && method !== 'GET' && !path.includes('/unlock') && !path.includes('/download')) ||
    (path.startsWith('/settings') && method !== 'GET') ||
    path.startsWith('/comments/admin') ||
    (path.startsWith('/reports/admin')) ||
    (path.startsWith('/reports') && (method === 'PUT' || method === 'DELETE')) ||
    (path.startsWith('/comments') && (method === 'PUT' || method === 'DELETE')) ||
    path.startsWith('/codes') ||
    path.startsWith('/users') ||
    path.startsWith('/analytics') ||
    path === '/backup'
  );

  if (needsAuth) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token || !(await validToken(env, token))) return err('กรุณาเข้าสู่ระบบ', 401);

    // ── permission gate — เช็คสิทธิ์รายหมวด (super_admin ผ่านหมด) ──
    const sess = await getSession(env, token);
    // map path → permission ที่ต้องมี (เฉพาะ write operations กับ admin endpoints)
    let neededPerm = null;
    if (path.startsWith('/articles') && (method !== 'GET' || path.startsWith('/articles/admin'))) neededPerm = 'articles';
    else if (path.startsWith('/apps') && (path.startsWith('/apps/admin') || (method !== 'GET' && !path.includes('/unlock')))) neededPerm = 'apps';
    else if (path.startsWith('/worksheets') && (method !== 'GET' && !path.includes('/unlock') && !path.includes('/download'))) neededPerm = 'worksheets';
    else if (path.startsWith('/comments/admin') || (path.startsWith('/comments') && (method === 'PUT' || method === 'DELETE'))) neededPerm = 'comments';
    // หมวดที่สงวนให้ super_admin เท่านั้น (codes/users/settings/reports/backup/analytics)
    const superOnly = (
      path.startsWith('/codes') || path.startsWith('/users') ||
      (path.startsWith('/settings') && method !== 'GET') ||
      path.startsWith('/reports') || path === '/backup' || path.startsWith('/analytics')
    );
    if (superOnly && sess?.role !== 'super_admin') return err('ไม่มีสิทธิ์เข้าถึงส่วนนี้', 403);
    if (neededPerm && !hasPerm(sess, neededPerm)) return err('ไม่มีสิทธิ์ในหมวดนี้', 403);
  }

  try {
    // ── ROUTER ──
    if (path === '/auth/login'  && method === 'POST')   return login(request, env);
    if (path === '/auth/logout' && method === 'POST')   return logout(request, env);
    if (path === '/auth/check'  && method === 'GET')    return authCheck(request, env);

    if (path.startsWith('/articles'))  return articles(request,  env, segments, method);
    if (path.startsWith('/apps'))      return apps(request,      env, segments, method);
    if (path.startsWith('/worksheets'))return worksheets(request, env, segments, method);
    if (path.startsWith('/settings'))  return settings(request,  env, segments, method);
    if (path.startsWith('/comments'))  return comments(request,  env, segments, method);
    if (path.startsWith('/reports'))   return reports(request,   env, segments, method);
    if (path.startsWith('/codes'))     return codes(request,     env, segments, method);
    if (path.startsWith('/users'))     return usersHandler(request, env, segments, method);
    if (path === '/track' && method === 'POST') return track(request, env);
    if (path.startsWith('/analytics')) return analytics(request, env, segments, method);
    if (path === '/upload' && method === 'POST') return upload(request, env);
    if (path === '/backup' && method === 'GET')  return backupAll(env);

    return err('ไม่พบ endpoint', 404);
  } catch (e) {
    return err(e.message, 500);
  }
}

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
async function login(req, env) {
  const { username, password } = await req.json();
  const hashed = await sha256(password);

  if (username && username !== 'admin') {
    // ── Login ผ่าน users table ──
    const { results } = await env.DB
      .prepare('SELECT * FROM users WHERE username=? AND password_hash=?')
      .bind(username.trim(), hashed).all();
    if (!results[0]) return err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
    const u = results[0];
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare(
      "INSERT INTO sessions (token,created_at,expires_at,user_id,username,role,display_name) VALUES (?,datetime('now'),?,?,?,?,?)"
    ).bind(token, expires, u.id, u.username, u.role, u.display_name).run();
    return ok({ token, expires, user_id: u.id, role: u.role, display_name: u.display_name, username: u.username, permissions: u.permissions||'[]', role_label: u.role_label||'' });
  }

  // ── Login admin หลัก (backward compat) ──
  const { results } = await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password'").all();
  if (hashed !== results[0]?.value) return err('รหัสผ่านไม่ถูกต้อง', 401);
  const token   = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const { results: sname } = await env.DB.prepare("SELECT value FROM settings WHERE key='author_name'").all();
  const displayName = sname[0]?.value || 'Admin';
  await env.DB.prepare(
    "INSERT INTO sessions (token,created_at,expires_at,user_id,username,role,display_name) VALUES (?,datetime('now'),?,0,'admin','super_admin',?)"
  ).bind(token, expires, displayName).run();
  return ok({ token, expires, role: 'super_admin', display_name: displayName, username: 'admin' });
}

async function logout(req, env) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  return ok({ ok: true });
}

async function authCheck(req, env) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const sess  = token ? await getSession(env, token) : null;
  if (!sess) return ok({ authenticated: false });
  return ok({ authenticated: true, role: sess.role||'super_admin', display_name: sess.display_name||'Admin', username: sess.username||'admin', permissions: sess.user_permissions||'[]', role_label: sess.user_role_label||'' });
}

async function getSession(env, token) {
  const { results } = await env.DB
    .prepare(`SELECT s.*, u.permissions AS user_permissions, u.role_label AS user_role_label
              FROM sessions s LEFT JOIN users u ON s.user_id = u.id
              WHERE s.token=? AND s.expires_at > datetime('now')`)
    .bind(token).all();
  return results[0] || null;
}

// ── permission helper ──
// super_admin (และ admin หลัก user_id=0) ได้ทุก permission
// คนอื่นเช็คจาก permissions JSON array ใน users
const ALL_PERMS = ['articles', 'comments', 'apps', 'worksheets'];
function hasPerm(sess, perm) {
  if (!sess) return false;
  if (sess.role === 'super_admin') return true;
  try {
    const perms = JSON.parse(sess.user_permissions || '[]');
    return Array.isArray(perms) && perms.includes(perm);
  } catch { return false; }
}

async function validToken(env, token) {
  return !!(await getSession(env, token));
}

// ════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════
async function usersHandler(req, env, segs, method) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const sess  = await getSession(env, token);
  const id    = segs[1];

  // GET /users — list (super_admin only)
  if (!id && method === 'GET') {
    if (sess?.role !== 'super_admin') return err('ไม่มีสิทธิ์', 403);
    const { results } = await env.DB
      .prepare('SELECT id,username,display_name,role,permissions,role_label,created_at FROM users ORDER BY created_at ASC').all();
    return ok({ users: results });
  }

  // POST /users — create (super_admin only)
  if (!id && method === 'POST') {
    if (sess?.role !== 'super_admin') return err('ไม่มีสิทธิ์', 403);
    const b = await req.json();
    if (!b.username || !b.password || !b.display_name) return err('ข้อมูลไม่ครบ');
    const { results: exist } = await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(b.username.trim()).all();
    if (exist[0]) return err('ชื่อผู้ใช้นี้มีอยู่แล้ว');
    const ph = await sha256(b.password);
    // sanitize permissions: เก็บเฉพาะที่อยู่ใน ALL_PERMS
    const perms = Array.isArray(b.permissions) ? b.permissions.filter(p => ALL_PERMS.includes(p)) : [];
    await env.DB.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,permissions,role_label) VALUES (?,?,?,?,?,?)"
    ).bind(b.username.trim(), ph, b.display_name.trim(), b.role||'editor', JSON.stringify(perms), (b.role_label||'').slice(0,40)).run();
    return ok({ ok: true });
  }

  // PUT /users/:id — update (admin: ใครก็ได้, editor: แค่ตัวเอง)
  if (id && method === 'PUT') {
    const isSelf = String(sess?.user_id) === id;
    if (!isSelf && sess?.role !== 'super_admin') return err('ไม่มีสิทธิ์', 403);
    const b = await req.json();
    const sets = ['display_name=?'];
    const vals = [b.display_name?.trim() || ''];
    if (b.password) { sets.push('password_hash=?'); vals.push(await sha256(b.password)); }
    if (sess?.role === 'super_admin' && b.role && !isSelf) { sets.push('role=?'); vals.push(b.role); }
    // super_admin แก้ permissions + role_label ของคนอื่นได้ (ไม่ใช่ตัวเอง — กันล็อกตัวเอง)
    if (sess?.role === 'super_admin' && !isSelf) {
      if (b.permissions !== undefined) {
        const perms = Array.isArray(b.permissions) ? b.permissions.filter(p => ALL_PERMS.includes(p)) : [];
        sets.push('permissions=?'); vals.push(JSON.stringify(perms));
      }
      if (b.role_label !== undefined) { sets.push('role_label=?'); vals.push((b.role_label||'').slice(0,40)); }
    }
    vals.push(id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
    return ok({ ok: true });
  }

  // DELETE /users/:id (super_admin only, ลบตัวเองไม่ได้)
  if (id && method === 'DELETE') {
    if (sess?.role !== 'super_admin') return err('ไม่มีสิทธิ์', 403);
    if (String(sess?.user_id) === id) return err('ลบตัวเองไม่ได้');
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

async function sha256(text) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

// ════════════════════════════════════════════════════════
// ARTICLES
// ════════════════════════════════════════════════════════
async function articles(req, env, segs, method) {
  const rawId = segs[1];
  const id    = rawId ? decodeURIComponent(rawId) : null;  // decode %E0%B9%81... → แ
  const page = parseInt(new URL(req.url).searchParams.get('page') || '1');
  const cat  = new URL(req.url).searchParams.get('category') || '';
  const q    = new URL(req.url).searchParams.get('q') || '';
  const per  = 9;

  // GET /articles — public list
  if (!id && method === 'GET') {
    let where    = 'WHERE published=1';
    const wArgs  = [];
    if (cat) { where += ' AND category=?'; wArgs.push(cat); }
    if (q)   { where += ' AND (title LIKE ? OR excerpt LIKE ?)'; wArgs.push('%'+q+'%','%'+q+'%'); }

    const listSql  = `SELECT id,title,slug,category,excerpt,image_url,views,created_at,pinned FROM articles ${where} ORDER BY (pinned > 0) DESC, pinned ASC, created_at DESC LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(*) as n FROM articles ${where}`;

    const [data, count] = await Promise.all([
      env.DB.prepare(listSql).bind(...wArgs, per, (page-1)*per).all(),
      env.DB.prepare(countSql).bind(...wArgs).all(),
    ]);
    return okCache({ articles: data.results, total: count.results[0]?.n || 0, page, per });
  }

  // GET /articles/admin/list — admin list (includes drafts) — must come BEFORE single GET
  if (segs[1] === 'admin' && segs[2] === 'list' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id,title,slug,category,published,views,created_at,pinned FROM articles ORDER BY (pinned > 0) DESC, pinned ASC, created_at DESC')
      .all();
    return ok({ articles: results });
  }

  // GET /articles/admin/:id — admin single (full content, includes drafts)
  if (segs[1] === 'admin' && segs[2] && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM articles WHERE id=?').bind(segs[2]).all();
    if (!results[0]) return err('ไม่พบบทความ', 404);
    return ok(results[0]);
  }

  // GET /articles/:idOrSlug — public single (รับทั้ง id ตัวเลข และ slug)
  if (id && method === 'GET') {
    const isNumericId = /^\d+$/.test(id);
    const col = isNumericId ? 'id' : 'slug';
    const { results } = await env.DB
      .prepare(`SELECT * FROM articles WHERE ${col}=? AND published=1`)
      .bind(id).all();
    if (!results[0]) return err('ไม่พบบทความ', 404);
    await env.DB.prepare(`UPDATE articles SET views=views+1 WHERE ${col}=?`).bind(id).run();
    return okCache(results[0]);
  }

  // POST /articles — create (admin)
  if (!id && method === 'POST') {
    const b    = await req.json();
    const slug = b.slug || toSlug(b.title);
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    const sess  = await getSession(env, token);
    const author = b.author_name || sess?.display_name || '';
    await env.DB.prepare(
      'INSERT INTO articles (title,slug,category,excerpt,content,image_url,published,author_name) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(b.title, slug, b.category||'ทั่วไป', b.excerpt||'', b.content||'', b.image_url||'', b.published?1:0, author).run();
    const { results } = await env.DB.prepare('SELECT * FROM articles WHERE slug=?').bind(slug).all();
    return ok(results[0]);
  }

  // PUT /articles/:id/pin (admin) — ตั้ง/ยกเลิก pin (ต้องอยู่ก่อน PUT update)
  // body: { pin: 0|1|2|3 } — 0 = ไม่ pin, 1-3 = ลำดับ
  if (id && segs[2] === 'pin' && method === 'PUT') {
    const body = await req.json();
    const pin = parseInt(body.pin) || 0;
    if (pin < 0 || pin > 3) return err('pin ต้องเป็น 0-3', 400);
    if (pin > 0) {
      // ถ้ามีบทความอื่นใช้ pin slot นี้อยู่ → ย้ายให้ไม่ pin (0)
      await env.DB.prepare('UPDATE articles SET pinned=0 WHERE pinned=? AND id!=?').bind(pin, id).run();
    }
    await env.DB.prepare('UPDATE articles SET pinned=? WHERE id=?').bind(pin, id).run();
    return ok({ ok: true, pin });
  }

  // PUT /articles/:id — update (admin)
  if (id && method === 'PUT') {
    const b = await req.json();
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    const sess  = await getSession(env, token);
    const author = b.author_name || sess?.display_name || '';
    await env.DB.prepare(
      "UPDATE articles SET title=?,slug=?,category=?,excerpt=?,content=?,image_url=?,published=?,author_name=?,updated_at=datetime('now') WHERE id=?"
    ).bind(b.title, b.slug||toSlug(b.title), b.category||'ทั่วไป', b.excerpt||'', b.content||'', b.image_url||'', b.published?1:0, author, id).run();
    return ok({ ok: true });
  }

  // DELETE /articles/:id (admin)
  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM articles WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ════════════════════════════════════════════════════════
// APPS
// ════════════════════════════════════════════════════════
async function apps(req, env, segs, method) {
  const id = segs[1];

  // GET /apps/admin/list — admin ดูทุกแอป รวม hidden (with lock_code)
  if (segs[1] === 'admin' && segs[2] === 'list' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM apps ORDER BY (pinned > 0) DESC, pinned ASC, sort_order ASC, created_at ASC').all();
    return ok({ apps: results });
  }

  // POST /apps/unlock-all — ใส่รหัสเดียว ปลดทุกแอปที่รหัสนั้นเข้าได้
  if (segs[1] === 'unlock-all' && method === 'POST') {
    const b = await req.json();
    const code = (b.code || '').trim();
    if (!code) return err('กรุณาใส่รหัส');

    // ── ตรวจ access_codes table (ระบบกลาง) ──
    const { results: codeRows } = await env.DB
      .prepare("SELECT * FROM access_codes WHERE code=? AND active=1").bind(code).all();

    if (codeRows[0]) {
      const row = codeRows[0];
      if (row.expires_at && new Date(row.expires_at) < new Date()) return err('รหัสหมดอายุแล้ว', 403);
      let appIds = [];
      try { appIds = JSON.parse(row.app_ids || '[]'); } catch {}
      const { results: all } = await env.DB
        .prepare('SELECT id,url FROM apps WHERE locked=1 AND visible=1').all();
      const matched = appIds.includes('all')
        ? all
        : all.filter(a => appIds.includes(a.id) || appIds.includes(String(a.id)));
      if (!matched.length) return err('รหัสนี้ยังไม่มีแอปให้ปลด', 403);
      return ok({ unlocked: matched.map(a => ({ id: a.id, url: a.url })), label: row.label });
    }

    // ── fallback: รหัสตรงกับ lock_code ของแอปไหนบ้าง ──
    const { results: byCode } = await env.DB
      .prepare('SELECT id,url FROM apps WHERE locked=1 AND visible=1 AND lock_code=?').bind(code).all();
    if (!byCode.length) return err('รหัสไม่ถูกต้อง', 403);
    return ok({ unlocked: byCode.map(a => ({ id: a.id, url: a.url })) });
  }

  // POST /apps/:id/unlock — ตรวจรหัส (เช็ค access_codes ก่อน แล้ว fallback ไป per-app code)
  if (id && segs[2] === 'unlock' && method === 'POST') {
    const b = await req.json();
    const code = (b.code || '').trim();

    // ── ตรวจ access_codes table (ระบบกลาง) ──
    const { results: codeRows } = await env.DB
      .prepare("SELECT * FROM access_codes WHERE code=? AND active=1").bind(code).all();
    if (codeRows[0]) {
      const row = codeRows[0];
      // เช็ควันหมดอายุ
      if (row.expires_at && new Date(row.expires_at) < new Date()) return err('รหัสหมดอายุแล้ว', 403);
      // เช็คสิทธิ์แอป
      let appIds = [];
      try { appIds = JSON.parse(row.app_ids || '[]'); } catch {}
      const canAccess = appIds.includes('all') || appIds.includes(parseInt(id)) || appIds.includes(String(id));
      if (!canAccess) return err('รหัสนี้ไม่สามารถปลดล็อกแอปนี้ได้', 403);
      const { results: ar } = await env.DB
        .prepare('SELECT url FROM apps WHERE id=? AND locked=1 AND visible=1').bind(id).all();
      if (!ar[0]) return err('ไม่พบแอป', 404);
      return ok({ url: ar[0].url });
    }

    // ── fallback: ตรวจรหัสของแอปโดยตรง ──
    const { results } = await env.DB
      .prepare('SELECT lock_code, url FROM apps WHERE id=? AND locked=1 AND visible=1').bind(id).all();
    if (!results[0]) return err('ไม่พบแอป', 404);
    if (results[0].lock_code !== code) return err('รหัสไม่ถูกต้อง', 403);
    return ok({ url: results[0].url });
  }

  // GET /apps — สาธารณะ เฉพาะ visible=1, ไม่ส่ง lock_code, locked=1 ไม่ส่ง url
  // ?popular_days=N → คืน view_count ในช่วง N วันล่าสุด (0 = ทั้งหมด, default ไม่นับ)
  if (!id && method === 'GET') {
    const url = new URL(req.url);
    const popularDays = parseInt(url.searchParams.get('popular_days'));
    let sql;
    if (Number.isFinite(popularDays) && popularDays >= 0) {
      // นับ view_count จาก page_views โดย LIKE '/apps/{id}'
      const TZ = "'+7 hours'";
      const dateFilter = popularDays > 0
        ? `AND date(pv.created_at, ${TZ}) > date('now', ${TZ}, '-${popularDays} days')`
        : '';
      sql = `
        SELECT a.id, a.icon, a.title, a.category, a.description, a.url, a.prompt, a.locked, a.visible, a.preview_image, a.sort_order, a.is_vip, a.pinned, a.created_at,
               COALESCE((SELECT COUNT(*) FROM page_views pv WHERE pv.path = '/apps/' || a.id ${dateFilter}), 0) AS view_count
        FROM apps a
        WHERE a.visible=1
        ORDER BY (a.pinned > 0) DESC, a.pinned ASC, a.sort_order ASC, a.created_at ASC`;
    } else {
      sql = 'SELECT id,icon,title,category,description,url,prompt,locked,visible,preview_image,sort_order,is_vip,pinned,created_at FROM apps WHERE visible=1 ORDER BY (pinned > 0) DESC, pinned ASC, sort_order ASC, created_at ASC';
    }
    const { results } = await env.DB.prepare(sql).all();
    const safe = results.map(a => ({
      ...a,
      url: a.locked ? null : a.url,   // ซ่อน URL ถ้า locked
    }));
    return okCache({ apps: safe });
  }

  if (!id && method === 'POST') {
    const b = await req.json();
    const res = await env.DB.prepare(
      'INSERT INTO apps (icon,title,category,description,url,prompt,sort_order,locked,lock_code,visible,preview_image,is_vip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(b.icon||'🎮', b.title, b.category||'อื่นๆ', b.description||'', b.url||'', b.prompt||'', b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0, b.preview_image||'', b.is_vip?1:0).run();
    return ok({ ok: true, id: res?.meta?.last_row_id || res?.lastInsertRowid });
  }

  // PUT /apps/:id/pin (admin) — ตั้ง/ยกเลิก pin (ต้องอยู่ก่อน PUT update)
  if (id && segs[2] === 'pin' && method === 'PUT') {
    const body = await req.json();
    const pin = parseInt(body.pin) || 0;
    if (pin < 0 || pin > 3) return err('pin ต้องเป็น 0-3', 400);
    if (pin > 0) {
      await env.DB.prepare('UPDATE apps SET pinned=0 WHERE pinned=? AND id!=?').bind(pin, id).run();
    }
    await env.DB.prepare('UPDATE apps SET pinned=? WHERE id=?').bind(pin, id).run();
    return ok({ ok: true, pin });
  }

  if (id && method === 'PUT') {
    const b = await req.json();
    await env.DB.prepare(
      'UPDATE apps SET icon=?,title=?,category=?,description=?,url=?,prompt=?,sort_order=?,locked=?,lock_code=?,visible=?,preview_image=?,is_vip=? WHERE id=?'
    ).bind(b.icon||'🎮', b.title, b.category||'อื่นๆ', b.description||'', b.url||'', b.prompt||'', b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0, b.preview_image||'', b.is_vip?1:0, id).run();
    return ok({ ok: true });
  }

  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM apps WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ── ใบงาน (worksheets) ─────────────────────────────────────
async function worksheets(req, env, segs, method) {
  const id = segs[1];

  // GET /worksheets/admin/list — admin ดูทั้งหมด รวม hidden + lock_code
  if (segs[1] === 'admin' && segs[2] === 'list' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM worksheets ORDER BY sort_order ASC, created_at DESC').all();
    return ok({ worksheets: results });
  }

  // POST /worksheets/:id/unlock — กรอกรหัส → ได้ file_url
  if (id && segs[2] === 'unlock' && method === 'POST') {
    const b = await req.json();
    const code = (b.code || '').trim();
    if (!code) return err('กรุณาใส่รหัส');

    // ตรวจ access_codes (ระบบกลาง) — เช็ค worksheet_ids
    const { results: codeRows } = await env.DB
      .prepare("SELECT * FROM access_codes WHERE code=? AND active=1").bind(code).all();
    if (codeRows[0]) {
      const row = codeRows[0];
      if (row.expires_at && new Date(row.expires_at) < new Date()) return err('รหัสหมดอายุแล้ว', 403);
      let wsIds = [];
      try { wsIds = JSON.parse(row.worksheet_ids || '[]'); } catch {}
      const canAccess = wsIds.includes('all') || wsIds.includes(parseInt(id)) || wsIds.includes(String(id));
      if (!canAccess) return err('รหัสนี้ใช้กับใบงานนี้ไม่ได้', 403);
      const { results: wr } = await env.DB
        .prepare('SELECT file_url FROM worksheets WHERE id=? AND visible=1').bind(id).all();
      if (!wr[0]) return err('ไม่พบใบงาน', 404);
      // นับดาวน์โหลด
      await env.DB.prepare('UPDATE worksheets SET downloads=downloads+1 WHERE id=?').bind(id).run();
      return ok({ file_url: wr[0].file_url });
    }

    // fallback: รหัสเฉพาะใบงาน
    const { results } = await env.DB
      .prepare('SELECT lock_code, file_url FROM worksheets WHERE id=? AND locked=1 AND visible=1').bind(id).all();
    if (!results[0]) return err('ไม่พบใบงาน', 404);
    if (results[0].lock_code !== code) return err('รหัสไม่ถูกต้อง', 403);
    await env.DB.prepare('UPDATE worksheets SET downloads=downloads+1 WHERE id=?').bind(id).run();
    return ok({ file_url: results[0].file_url });
  }

  // POST /worksheets/:id/download — ใบงานฟรี นับยอด + ได้ลิงก์
  if (id && segs[2] === 'download' && method === 'POST') {
    const { results } = await env.DB
      .prepare('SELECT file_url, locked FROM worksheets WHERE id=? AND visible=1').bind(id).all();
    if (!results[0]) return err('ไม่พบใบงาน', 404);
    if (results[0].locked) return err('ใบงานนี้ต้องใช้รหัส', 403);
    await env.DB.prepare('UPDATE worksheets SET downloads=downloads+1 WHERE id=?').bind(id).run();
    return ok({ file_url: results[0].file_url });
  }

  // GET /worksheets — สาธารณะ เฉพาะ visible, ซ่อน file_url ถ้า locked
  if (!id && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id,title,category,description,cover_image,file_url,pages,locked,visible,sort_order,downloads,created_at FROM worksheets WHERE visible=1 ORDER BY sort_order ASC, created_at DESC').all();
    const safe = results.map(w => ({ ...w, file_url: w.locked ? null : w.file_url }));
    return okCache({ worksheets: safe });
  }

  if (!id && method === 'POST') {
    const b = await req.json();
    const res = await env.DB.prepare(
      'INSERT INTO worksheets (title,category,description,cover_image,file_url,pages,sort_order,locked,lock_code,visible) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(b.title, b.category||'อื่นๆ', b.description||'', b.cover_image||'', b.file_url||'', b.pages||0, b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0).run();
    return ok({ ok: true, id: res?.meta?.last_row_id || res?.lastInsertRowid });
  }

  if (id && method === 'PUT') {
    const b = await req.json();
    await env.DB.prepare(
      'UPDATE worksheets SET title=?,category=?,description=?,cover_image=?,file_url=?,pages=?,sort_order=?,locked=?,lock_code=?,visible=? WHERE id=?'
    ).bind(b.title, b.category||'อื่นๆ', b.description||'', b.cover_image||'', b.file_url||'', b.pages||0, b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0, id).run();
    return ok({ ok: true });
  }

  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM worksheets WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
async function settings(req, env, segs, method) {
  if (method === 'GET') {
    const { results } = await env.DB
      .prepare("SELECT key,value FROM settings WHERE key != 'admin_password'").all();
    const s = Object.fromEntries(results.map(r => [r.key, r.value]));
    return okCache(s);
  }

  if (method === 'PUT') {
    const b = await req.json();
    for (const [key, value] of Object.entries(b)) {
      if (key === 'admin_password' && value) {
        await env.DB.prepare('UPDATE settings SET value=? WHERE key=?').bind(await sha256(value), key).run();
      } else if (key !== 'admin_password') {
        await env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind(key, value).run();
      }
    }
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ════════════════════════════════════════════════════════
// COMMENTS
// ════════════════════════════════════════════════════════
async function comments(req, env, segs, method) {
  const articleId = segs[1];
  const action    = segs[2];
  const commentId = segs[1];

  // GET /comments/:article_id
  if (articleId && method === 'GET' && !action) {
    const { results } = await env.DB
      .prepare('SELECT * FROM comments WHERE article_id=? AND approved=1 ORDER BY created_at DESC')
      .bind(articleId).all();
    return ok({ comments: results });
  }

  // POST /comments — ส่งคอมเมนต์ใหม่
  if (!action && method === 'POST') {
    const b = await req.json();
    if (!b.article_id || !b.name || !b.content) return err('กรุณากรอกข้อมูลให้ครบ');
    await env.DB.prepare(
      'INSERT INTO comments (article_id,name,content) VALUES (?,?,?)'
    ).bind(b.article_id, b.name.substring(0,50), b.content.substring(0,500)).run();
    return ok({ ok: true, message: 'ส่งคอมเมนต์แล้ว รอการอนุมัติ' });
  }

  // GET /comments/admin/list
  if (segs[0] === 'comments' && segs[1] === 'admin') {
    const { results } = await env.DB
      .prepare('SELECT c.*,a.title as article_title FROM comments c JOIN articles a ON c.article_id=a.id ORDER BY c.created_at DESC')
      .all();
    return ok({ comments: results });
  }

  // PUT /comments/:id/approve
  if (commentId && action === 'approve' && method === 'PUT') {
    await env.DB.prepare('UPDATE comments SET approved=1 WHERE id=?').bind(commentId).run();
    return ok({ ok: true });
  }

  // DELETE /comments/:id
  if (commentId && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(commentId).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ════════════════════════════════════════════════════════
// REPORTS (แจ้งปัญหา)
// ════════════════════════════════════════════════════════
async function reports(req, env, segs, method) {
  const id = segs[1];
  const action = segs[2];

  // POST /reports — ส่งแจ้งปัญหา (สาธารณะ)
  if (!id && method === 'POST') {
    const b = await req.json();
    if (!b.detail || !b.detail.trim()) return err('กรุณากรอกรายละเอียดปัญหา');
    await env.DB.prepare(
      'INSERT INTO reports (type,detail,contact,image_url) VALUES (?,?,?,?)'
    ).bind(
      (b.type || 'อื่นๆ').substring(0, 30),
      b.detail.substring(0, 2000),
      (b.contact || '').substring(0, 120),
      (b.image_url || '').substring(0, 500)
    ).run();
    return ok({ ok: true, message: 'ส่งแจ้งปัญหาแล้ว ขอบคุณครับ' });
  }

  // GET /reports/admin/list
  if (segs[1] === 'admin' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM reports ORDER BY (status="new") DESC, created_at DESC').all();
    return ok({ reports: results });
  }

  // PUT /reports/:id/status — เปลี่ยนสถานะ (new/doing/done)
  if (id && action === 'status' && method === 'PUT') {
    const b = await req.json();
    const st = ['new','doing','done'].includes(b.status) ? b.status : 'new';
    await env.DB.prepare('UPDATE reports SET status=? WHERE id=?').bind(st, id).run();
    return ok({ ok: true });
  }

  // DELETE /reports/:id
  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM reports WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ════════════════════════════════════════════════════════
// IMAGE UPLOAD (imgbb API)
// ════════════════════════════════════════════════════════
async function upload(req, env) {
  const { results } = await env.DB.prepare("SELECT value FROM settings WHERE key='imgbb_key'").all();
  const key = results[0]?.value;
  if (!key) return err('ยังไม่ได้ตั้งค่า imgbb API key');

  const formData = await req.formData();
  const file     = formData.get('image');
  if (!file) return err('ไม่พบไฟล์รูป');

  const body = new FormData();
  body.append('image', file);
  const res  = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: 'POST', body });
  const data = await res.json();

  if (!data.success) return err('อัปโหลดรูปไม่สำเร็จ: ' + (data.error?.message || 'unknown'));
  return ok({ url: data.data.url, thumb: data.data.thumb?.url || data.data.url });
}

// ════════════════════════════════════════════════════════
// ACCESS CODES (ระบบรหัสปลดล็อกแบบกลาง)
// ════════════════════════════════════════════════════════
async function codes(req, env, segs, method) {
  const id = segs[1];

  // GET /codes — รายการโค้ดทั้งหมด
  if (!id && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM access_codes ORDER BY created_at DESC').all();
    return ok({ codes: results });
  }

  // POST /codes — สร้างโค้ดใหม่
  if (!id && method === 'POST') {
    const b = await req.json();
    if (!b.code || !b.label) return err('กรุณาใส่รหัสและชื่อแพ็กเกจ');
    // เช็คว่าโค้ดซ้ำไหม
    const { results: exist } = await env.DB
      .prepare('SELECT id FROM access_codes WHERE code=?').bind(b.code.trim()).all();
    if (exist[0]) return err('รหัสนี้มีอยู่แล้ว');
    await env.DB.prepare(
      'INSERT INTO access_codes (code,label,app_ids,worksheet_ids,expires_at,active) VALUES (?,?,?,?,?,?)'
    ).bind(
      b.code.trim().toUpperCase(),
      b.label.trim(),
      JSON.stringify(b.app_ids || []),
      JSON.stringify(b.worksheet_ids || []),
      b.expires_at || null,
      b.active !== false ? 1 : 0   // รับค่า active จริงๆ ไม่ hardcode
    ).run();
    return ok({ ok: true });
  }

  // PUT /codes/:id — แก้ไขโค้ด
  if (id && method === 'PUT') {
    const b = await req.json();
    await env.DB.prepare(
      'UPDATE access_codes SET code=?,label=?,app_ids=?,worksheet_ids=?,expires_at=?,active=? WHERE id=?'
    ).bind(
      b.code.trim().toUpperCase(),
      b.label.trim(),
      JSON.stringify(b.app_ids || []),
      JSON.stringify(b.worksheet_ids || []),
      b.expires_at || null,
      b.active ? 1 : 0,
      id
    ).run();
    return ok({ ok: true });
  }

  // DELETE /codes/:id — ลบโค้ด
  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM access_codes WHERE id=?').bind(id).run();
    return ok({ ok: true });
  }

  return err('ไม่พบ', 404);
}

// ── ANALYTICS: นับยอดคนดูแต่ละหน้า ──────────────────────
// POST /track — public, fire-and-forget จาก frontend
async function track(req, env) {
  try {
    const b = await req.json();
    const path = String(b.path||'').slice(0,200);
    const vid  = String(b.visitor_id||'').slice(0,64);
    if (!path || !vid) return ok({ ok:true }); // เงียบๆ ไม่ error เพื่อไม่กระทบ user
    // กันส่งซ้ำในเวลาสั้นๆ: ถ้า visitor นี้เพิ่ง view path เดียวกันใน 30 วินาที ข้าม
    const recent = await env.DB.prepare(
      "SELECT 1 FROM page_views WHERE visitor_id=? AND path=? AND created_at > datetime('now','-30 seconds') LIMIT 1"
    ).bind(vid, path).first();
    if (recent) return ok({ ok:true });
    await env.DB.prepare(
      'INSERT INTO page_views (path, visitor_id) VALUES (?, ?)'
    ).bind(path, vid).run();
    return ok({ ok:true });
  } catch (_) {
    return ok({ ok:true }); // เงียบเสมอ
  }
}

// GET /analytics/summary — admin: สรุปยอดและ top pages (พร้อม breakdown ตาม category)
async function analytics(req, env, segs, method) {
  if (method !== 'GET') return err('ไม่พบ', 404);
  const action = segs[1] || 'summary';

  if (action === 'summary') {
    // ใช้เวลาประเทศไทย (UTC+7) — "วันนี้" = ตั้งแต่ 00:00 ของวันนี้ในไทย, ไม่ใช่ 24 ชม.ที่ผ่านมา
    const TZ = "'+7 hours'";
    const ranges = [
      { key:'today', sql:`datetime(created_at, ${TZ}) >= date('now', ${TZ})` },
      { key:'week',  sql:`date(created_at, ${TZ}) > date('now', ${TZ}, '-7 days')` },
      { key:'month', sql:`date(created_at, ${TZ}) > date('now', ${TZ}, '-30 days')` },
    ];
    const stats = {};
    for (const r of ranges) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS uniq FROM page_views WHERE ${r.sql}`
      ).first();
      stats[r.key] = { views: row?.views || 0, unique: row?.uniq || 0 };
    }

    // SQL pattern ของแต่ละ category — ใช้ LIKE บน path
    const cats = {
      page:      `(path IN ('/','/blog','/apps','/worksheets','/about','/buy','/report','/privacy') OR path='')`,
      article:   `path LIKE '/article/%'`,
      app:       `path LIKE '/apps/%'`,
      worksheet: `path LIKE '/worksheet/%'`,
    };
    const periods = {
      today: `datetime(created_at, ${TZ}) >= date('now', ${TZ})`,
      week:  `date(created_at, ${TZ}) > date('now', ${TZ}, '-7 days')`,
      month: `date(created_at, ${TZ}) > date('now', ${TZ}, '-30 days')`,
    };
    // คืน top ของแต่ละ category × แต่ละ period
    const tops = {};
    for (const [pk, psql] of Object.entries(periods)) {
      tops[pk] = { all: [], page: [], article: [], app: [], worksheet: [] };
      // all: ทุก path รวมกัน
      tops[pk].all = (await env.DB.prepare(
        `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS uniq FROM page_views WHERE ${psql} GROUP BY path ORDER BY views DESC LIMIT 10`
      ).all()).results;
      // แยกตาม category
      for (const [ck, csql] of Object.entries(cats)) {
        tops[pk][ck] = (await env.DB.prepare(
          `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS uniq FROM page_views WHERE ${psql} AND ${csql} GROUP BY path ORDER BY views DESC LIMIT 10`
        ).all()).results;
      }
    }

    // กราฟ 14 วันย้อนหลัง — group by วันตามปฏิทินไทย
    const daily = (await env.DB.prepare(
      `SELECT date(created_at, ${TZ}) AS d, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS uniq
       FROM page_views WHERE date(created_at, ${TZ}) > date('now', ${TZ}, '-14 days')
       GROUP BY d ORDER BY d ASC`
    ).all()).results;

    // backward compatible: ส่ง topToday/top7/top30 = tops.X.all เพื่อไม่ break frontend เก่า
    return ok({
      stats, daily, tops,
      topToday: tops.today.all,
      top7: tops.week.all,
      top30: tops.month.all,
    });
  }
  return err('ไม่พบ', 404);
}


// ── BACKUP: dump ทุกตารางเป็น JSON (admin เท่านั้น) ──────
async function backupAll(env) {
  const tables = ['articles', 'apps', 'worksheets', 'access_codes', 'comments', 'reports', 'users', 'settings'];
  const dump = {
    _meta: {
      site: 'kru-ti.com',
      exported_at: new Date().toISOString(),
      note: 'สำรองข้อมูล D1 — เก็บไฟล์นี้ไว้ในที่ปลอดภัย ใช้กู้คืนข้อมูลได้',
    },
  };
  for (const t of tables) {
    try {
      const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
      // ไม่เก็บ password hash ของ users ใน backup ธรรมดา? เก็บไว้ — จำเป็นต่อการ restore
      dump[t] = results;
    } catch (e) {
      dump[t] = { _error: String(e) };
    }
  }
  const filename = `kruti-backup-${new Date().toISOString().split('T')[0]}.json`;
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...CORS,
    },
  });
}

function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    || Date.now().toString();
}
