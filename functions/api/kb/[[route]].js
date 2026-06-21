// ============================================================
// KruBoard · Cloudflare Pages Function  (functions/api/[[route]].js)
// จับทุก request ที่ /api/*  —  ระบบ user/password ที่คุณคุมเอง
//
// Bindings (ตั้งใน Pages → Settings → Functions):
//   DB           -> D1 database
//   BUCKET       -> R2 bucket
// Secrets/Env vars:
//   AUTH_SECRET  -> สตริงลับ ไว้เซ็น token (ตั้งเอง ยาว ๆ สุ่ม ๆ)
//   ADMIN_PASS   -> รหัสเข้าหน้า admin
//   ALLOW_SIGNUP -> "1" = เปิดให้ครูสมัครเอง, ไม่ใส่/"0" = ปิด (เริ่มต้นปิด)
// ============================================================

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const uid = () => crypto.randomUUID().slice(0, 8);
const now = () => Date.now();
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// ---------- password hashing (PBKDF2 via Web Crypto) ----------
async function hashPass(pass, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)))
                       : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}
async function verifyPass(pass, saltHex, hashHex) {
  const { hash } = await hashPass(pass, saltHex);
  // เทียบแบบ constant-time
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

// ---------- signed session token (ไม่ต้องเก็บใน DB) ----------
// payload = base64url(JSON).signature  (HMAC-SHA256)
async function hmac(msg, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function makeToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = await hmac(body, secret);
  return body + '.' + sig;
}
async function readToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = await hmac(body, secret);
  if (sig !== expect) return null;
  try { return JSON.parse(unb64u(body)); } catch { return null; }
}

// ดึง username ครูจาก token (ค้างยาว — ไม่ใส่วันหมดอายุ)
async function currentTeacher(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const p = await readToken(token, env.AUTH_SECRET || 'dev-secret');
  return p?.u || null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/kb\/?/, '');
  const method = request.method;
  const SECRET = env.AUTH_SECRET || 'dev-secret';

  try {
    // ================= สาธารณะ: รูป =================
    if (path.startsWith('img/') && method === 'GET') {
      const key = decodeURIComponent(path.slice(4));
      const obj = await env.BUCKET.get(key);
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=31536000' } });
    }

    // ================= ครู: ล็อกอิน =================
    // POST /api/login  {username, password}
    if (path === 'login' && method === 'POST') {
      const { username, password } = await request.json();
      if (!username || !password) return json({ error: 'กรอกข้อมูลไม่ครบ' }, 400);
      const t = await env.DB.prepare('SELECT * FROM kb_teachers WHERE username=?').bind(username).first();
      if (!t || !t.active) return json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
      const ok = await verifyPass(password, t.pass_salt, t.pass_hash);
      if (!ok) return json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
      await env.DB.prepare('UPDATE kb_teachers SET last_seen=? WHERE username=?').bind(now(), username).run();
      const token = await makeToken({ u: username, iat: now() }, SECRET);
      return json({ token, username, name: t.name || username });
    }

    // ครูสมัครเอง (ปิดไว้เป็นค่าเริ่มต้น เปิดด้วย env ALLOW_SIGNUP=1)
    // POST /api/signup {username,name,password}
    if (path === 'signup' && method === 'POST') {
      if (env.ALLOW_SIGNUP !== '1') return json({ error: 'ระบบยังไม่เปิดให้สมัครเอง ติดต่อผู้ดูแล' }, 403);
      const { username, name, password } = await request.json();
      if (!username || !password) return json({ error: 'กรอกข้อมูลไม่ครบ' }, 400);
      if (password.length < 6) return json({ error: 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)' }, 400);
      const exists = await env.DB.prepare('SELECT username FROM kb_teachers WHERE username=?').bind(username).first();
      if (exists) return json({ error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' }, 409);
      const { hash, salt } = await hashPass(password);
      await env.DB.prepare('INSERT INTO kb_teachers (username,name,pass_hash,pass_salt,active,created) VALUES (?,?,?,?,1,?)')
        .bind(username, name || username, hash, salt, now()).run();
      const token = await makeToken({ u: username, iat: now() }, SECRET);
      return json({ token, username, name: name || username });
    }

    // ================= สาธารณะ: นักเรียน =================
    if (path.startsWith('board/') && method === 'GET') {
      const id = path.slice(6);
      const b = await env.DB.prepare('SELECT id,title,room,peer FROM kb_boards WHERE id=?').bind(id).first();
      if (!b) return json({ error: 'ไม่พบกระดาน' }, 404);
      return json(b);
    }

    // GET /peer/:boardId — นักเรียนดูงานเพื่อน (เฉพาะกระดานที่ peer=1)
    // ส่งแค่รูป + เลขที่ + ชื่อ ไม่ส่งผลตรวจของครู (status/score/comment)
    if (path.startsWith('peer/') && method === 'GET') {
      const id = path.slice(5);
      const b = await env.DB.prepare('SELECT id,title,room,peer FROM kb_boards WHERE id=?').bind(id).first();
      if (!b) return json({ error: 'ไม่พบกระดาน' }, 404);
      if (!b.peer) return json({ error: 'ครูไม่ได้เปิดให้นักเรียนดูงานเพื่อน' }, 403);
      const { results } = await env.DB.prepare(
        'SELECT no,name,img_key FROM kb_subs WHERE board=? ORDER BY no ASC'
      ).bind(id).all();
      results.forEach(s => { s.img = `/api/kb/img/${encodeURIComponent(s.img_key)}`; delete s.img_key; });
      return json({ board: { id:b.id, title:b.title, room:b.room }, subs: results });
    }

    if (path === 'submit' && method === 'POST') {
      const form = await request.formData();
      const board = form.get('board'); const no = parseInt(form.get('no'));
      const name = (form.get('name') || '').toString().slice(0, 60); const file = form.get('file');
      if (!board || !no || !file) return json({ error: 'ข้อมูลไม่ครบ' }, 400);
      const b = await env.DB.prepare('SELECT id FROM kb_boards WHERE id=?').bind(board).first();
      if (!b) return json({ error: 'ไม่พบกระดาน' }, 404);
      const key = `${board}/${no}-${uid()}.jpg`;
      await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: 'image/jpeg' } });
      const old = await env.DB.prepare('SELECT img_key FROM kb_subs WHERE board=? AND no=?').bind(board, no).first();
      if (old?.img_key) await env.BUCKET.delete(old.img_key).catch(() => {});
      await env.DB.prepare(`
        INSERT INTO kb_subs (id,board,no,name,img_key,status,created) VALUES (?,?,?,?,?, 'wait', ?)
        ON CONFLICT(board,no) DO UPDATE SET name=excluded.name, img_key=excluded.img_key, status='wait', score=NULL, comment=NULL, created=excluded.created, reviewed=NULL
      `).bind(uid(), board, no, name, key, now()).run();
      return json({ ok: true });
    }

    if (path.startsWith('result/') && method === 'GET') {
      const [, board, no] = path.split('/');
      const s = await env.DB.prepare('SELECT no,name,img_key,status,score,comment FROM kb_subs WHERE board=? AND no=?').bind(board, parseInt(no)).first();
      if (!s) return json({ error: 'ยังไม่พบงานของเลขที่นี้' }, 404);
      s.img = `/api/kb/img/${encodeURIComponent(s.img_key)}`; delete s.img_key;
      return json(s);
    }

    // ================= ADMIN (รหัสแยกต่างหาก) =================
    // ทุก endpoint admin ต้องส่ง header: X-Admin-Pass: <ADMIN_PASS>
    if (path.startsWith('admin/')) {
      // ตรวจ session token ของ admin ครูติ (ใช้ตาราง sessions ของเว็บหลัก)
      const auth = request.headers.get('Authorization') || '';
      const ktiTok = auth.replace(/^Bearer\s+/i, '');
      if (!ktiTok) return json({ error: 'กรุณาเข้าสู่ระบบ admin ครูติ' }, 401);
      const sess = await env.DB
        .prepare("SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime('now')")
        .bind(ktiTok).first();
      if (!sess) return json({ error: 'session หมดอายุ — กรุณาเข้าสู่ระบบใหม่' }, 401);

      // GET /api/admin/teachers — รายชื่อครูทั้งหมด
      if (path === 'admin/teachers' && method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT t.username, t.name, t.active, t.bytes_used, t.created, t.last_seen,
            (SELECT COUNT(*) FROM kb_boards b WHERE b.owner=t.username) AS boards
          FROM kb_teachers t ORDER BY t.created DESC
        `).all();
        return json({ teachers: results });
      }

      // POST /api/admin/teachers — สร้างครู {username,name,password}
      if (path === 'admin/teachers' && method === 'POST') {
        const { username, name, password } = await request.json();
        if (!username || !password) return json({ error: 'กรอกข้อมูลไม่ครบ' }, 400);
        const exists = await env.DB.prepare('SELECT username FROM kb_teachers WHERE username=?').bind(username).first();
        if (exists) return json({ error: 'ชื่อผู้ใช้นี้มีแล้ว' }, 409);
        const { hash, salt } = await hashPass(password);
        await env.DB.prepare('INSERT INTO kb_teachers (username,name,pass_hash,pass_salt,active,created) VALUES (?,?,?,?,1,?)')
          .bind(username, name || username, hash, salt, now()).run();
        return json({ ok: true });
      }

      // PUT /api/admin/teachers/<username> — รีเซ็ตรหัส / เปิด-ปิด {password?,active?,name?}
      if (path.match(/^admin\/teachers\/[^/]+$/) && method === 'PUT') {
        const username = decodeURIComponent(path.split('/')[2]);
        const body = await request.json();
        const sets = [], binds = [];
        if (body.password) { const { hash, salt } = await hashPass(body.password); sets.push('pass_hash=?', 'pass_salt=?'); binds.push(hash, salt); }
        if (body.active != null) { sets.push('active=?'); binds.push(body.active ? 1 : 0); }
        if (body.name != null) { sets.push('name=?'); binds.push(body.name); }
        if (!sets.length) return json({ error: 'ไม่มีอะไรให้แก้' }, 400);
        binds.push(username);
        await env.DB.prepare(`UPDATE kb_teachers SET ${sets.join(',')} WHERE username=?`).bind(...binds).run();
        return json({ ok: true });
      }

      // DELETE /api/admin/teachers/<username> — ลบครู + กระดาน + รูป
      if (path.match(/^admin\/teachers\/[^/]+$/) && method === 'DELETE') {
        const username = decodeURIComponent(path.split('/')[2]);
        const { results: boards } = await env.DB.prepare('SELECT id FROM kb_boards WHERE owner=?').bind(username).all();
        for (const b of boards) {
          const { results: subs } = await env.DB.prepare('SELECT img_key FROM kb_subs WHERE board=?').bind(b.id).all();
          for (const s of subs) await env.BUCKET.delete(s.img_key).catch(() => {});
          await env.DB.prepare('DELETE FROM kb_subs WHERE board=?').bind(b.id).run();
        }
        await env.DB.prepare('DELETE FROM kb_boards WHERE owner=?').bind(username).run();
        await env.DB.prepare('DELETE FROM kb_teachers WHERE username=?').bind(username).run();
        return json({ ok: true });
      }

      return json({ error: 'ไม่พบเส้นทาง admin นี้' }, 404);
    }

    // ================= ครู (ต้องล็อกอิน) =================
    const me = await currentTeacher(request, env);
    if (!me) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);

    if (path === 'boards' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT b.*,
          (SELECT COUNT(*) FROM kb_subs s WHERE s.board=b.id) AS submitted,
          (SELECT COUNT(*) FROM kb_subs s WHERE s.board=b.id AND s.status!='wait') AS reviewed
        FROM kb_boards b WHERE b.owner=? ORDER BY b.created DESC
      `).bind(me).all();
      return json({ boards: results });
    }

    if (path === 'boards' && method === 'POST') {
      const body = await request.json();
      if (!body.title) return json({ error: 'ต้องมีชื่อการบ้าน' }, 400);
      const id = uid();
      await env.DB.prepare('INSERT INTO kb_boards (id,owner,title,room,roster,peer,term_tag,created) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, me, body.title.slice(0, 120), (body.room || '').slice(0, 40), parseInt(body.roster) || 0, body.peer ? 1 : 0, body.term_tag || null, now()).run();
      return json({ id });
    }

    if (path.match(/^boards\/[^/]+\/subs$/) && method === 'GET') {
      const id = path.split('/')[1];
      const b = await env.DB.prepare('SELECT id FROM kb_boards WHERE id=? AND owner=?').bind(id, me).first();
      if (!b) return json({ error: 'ไม่พบกระดาน หรือไม่ใช่ของคุณ' }, 404);
      const { results } = await env.DB.prepare('SELECT id,no,name,img_key,status,score,comment FROM kb_subs WHERE board=? ORDER BY no').bind(id).all();
      results.forEach(s => { s.img = `/api/kb/img/${encodeURIComponent(s.img_key)}`; delete s.img_key; });
      return json({ subs: results });
    }

    if (path.match(/^subs\/[^/]+$/) && method === 'PUT') {
      const sid = path.split('/')[1];
      const owns = await env.DB.prepare('SELECT s.id FROM kb_subs s JOIN kb_boards b ON s.board=b.id WHERE s.id=? AND b.owner=?').bind(sid, me).first();
      if (!owns) return json({ error: 'ไม่มีสิทธิ์' }, 403);
      const body = await request.json();
      await env.DB.prepare('UPDATE kb_subs SET status=?, score=?, comment=?, reviewed=? WHERE id=?')
        .bind(body.status || 'wait', body.score ?? null, body.comment ?? null, now(), sid).run();
      return json({ ok: true });
    }

    // DELETE /subs/:id — ลบ submission (เฉพาะครูเจ้าของกระดาน)
    if (path.match(/^subs\/[^/]+$/) && method === 'DELETE') {
      const sid = path.split('/')[1];
      const s = await env.DB.prepare(
        'SELECT s.id, s.img_key FROM kb_subs s JOIN kb_boards b ON s.board=b.id WHERE s.id=? AND b.owner=?'
      ).bind(sid, me).first();
      if (!s) return json({ error: 'ไม่มีสิทธิ์ หรือไม่พบ submission' }, 403);
      // ลบรูปใน R2 ก่อน (ไม่ block ถ้าลบไม่ได้)
      if (s.img_key) await env.BUCKET.delete(s.img_key).catch(() => {});
      await env.DB.prepare('DELETE FROM kb_subs WHERE id=?').bind(sid).run();
      return json({ ok: true });
    }

    return json({ error: 'ไม่พบเส้นทางนี้' }, 404);

  } catch (e) {
    return json({ error: 'เกิดข้อผิดพลาด: ' + e.message }, 500);
  }
}
