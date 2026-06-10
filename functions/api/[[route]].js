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
    (path.startsWith('/settings') && method !== 'GET') ||
    path.startsWith('/comments/admin') ||
    (path.startsWith('/comments') && (method === 'PUT' || method === 'DELETE')) ||
    path.startsWith('/codes') ||
    path.startsWith('/users') ||
    path === '/upload'
  );

  if (needsAuth) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token || !(await validToken(env, token))) return err('กรุณาเข้าสู่ระบบ', 401);
  }

  try {
    // ── ROUTER ──
    if (path === '/auth/login'  && method === 'POST')   return login(request, env);
    if (path === '/auth/logout' && method === 'POST')   return logout(request, env);
    if (path === '/auth/check'  && method === 'GET')    return authCheck(request, env);

    if (path.startsWith('/articles'))  return articles(request,  env, segments, method);
    if (path.startsWith('/apps'))      return apps(request,      env, segments, method);
    if (path.startsWith('/settings'))  return settings(request,  env, segments, method);
    if (path.startsWith('/comments'))  return comments(request,  env, segments, method);
    if (path.startsWith('/codes'))     return codes(request,     env, segments, method);
    if (path.startsWith('/users'))     return usersHandler(request, env, segments, method);
    if (path === '/upload' && method === 'POST') return upload(request, env);

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
    return ok({ token, expires, role: u.role, display_name: u.display_name, username: u.username });
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
  return ok({ authenticated: true, role: sess.role||'super_admin', display_name: sess.display_name||'Admin', username: sess.username||'admin' });
}

async function getSession(env, token) {
  const { results } = await env.DB
    .prepare("SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')")
    .bind(token).all();
  return results[0] || null;
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
      .prepare('SELECT id,username,display_name,role,created_at FROM users ORDER BY created_at ASC').all();
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
    await env.DB.prepare(
      "INSERT INTO users (username,password_hash,display_name,role) VALUES (?,?,?,?)"
    ).bind(b.username.trim(), ph, b.display_name.trim(), b.role||'editor').run();
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

    const listSql  = `SELECT id,title,slug,category,excerpt,image_url,views,created_at FROM articles ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
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
      .prepare('SELECT id,title,slug,category,published,views,created_at FROM articles ORDER BY created_at DESC')
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

  // GET /articles/:slug — public single
  if (id && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM articles WHERE slug=? AND published=1')
      .bind(id).all();
    if (!results[0]) return err('ไม่พบบทความ', 404);
    await env.DB.prepare('UPDATE articles SET views=views+1 WHERE slug=?').bind(id).run();
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
      .prepare('SELECT * FROM apps ORDER BY sort_order ASC, created_at ASC').all();
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
  if (!id && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id,icon,title,category,description,url,prompt,locked,visible,preview_image,sort_order,created_at FROM apps WHERE visible=1 ORDER BY sort_order ASC, created_at ASC').all();
    const safe = results.map(a => ({
      ...a,
      url: a.locked ? null : a.url,   // ซ่อน URL ถ้า locked
    }));
    return okCache({ apps: safe });
  }

  if (!id && method === 'POST') {
    const b = await req.json();
    await env.DB.prepare(
      'INSERT INTO apps (icon,title,category,description,url,prompt,sort_order,locked,lock_code,visible,preview_image) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(b.icon||'🎮', b.title, b.category||'อื่นๆ', b.description||'', b.url||'', b.prompt||'', b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0, b.preview_image||'').run();
    return ok({ ok: true });
  }

  if (id && method === 'PUT') {
    const b = await req.json();
    await env.DB.prepare(
      'UPDATE apps SET icon=?,title=?,category=?,description=?,url=?,prompt=?,sort_order=?,locked=?,lock_code=?,visible=?,preview_image=? WHERE id=?'
    ).bind(b.icon||'🎮', b.title, b.category||'อื่นๆ', b.description||'', b.url||'', b.prompt||'', b.sort_order||0, b.locked?1:0, b.lock_code||'', b.visible!==false?1:0, b.preview_image||'', id).run();
    return ok({ ok: true });
  }

  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM apps WHERE id=?').bind(id).run();
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
      'INSERT INTO access_codes (code,label,app_ids,expires_at,active) VALUES (?,?,?,?,?)'
    ).bind(
      b.code.trim().toUpperCase(),
      b.label.trim(),
      JSON.stringify(b.app_ids || []),
      b.expires_at || null,
      b.active !== false ? 1 : 0   // รับค่า active จริงๆ ไม่ hardcode
    ).run();
    return ok({ ok: true });
  }

  // PUT /codes/:id — แก้ไขโค้ด
  if (id && method === 'PUT') {
    const b = await req.json();
    await env.DB.prepare(
      'UPDATE access_codes SET code=?,label=?,app_ids=?,expires_at=?,active=? WHERE id=?'
    ).bind(
      b.code.trim().toUpperCase(),
      b.label.trim(),
      JSON.stringify(b.app_ids || []),
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

// ════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════
function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    || Date.now().toString();
}
