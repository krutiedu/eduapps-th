// Exam scopes use stable category IDs, so renaming a subject preserves its grants.
const ids = value => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
};
const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const webURL = value => {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || (/^[/?#]/.test(raw) && !raw.startsWith('//'))) return '';
  const hostWithPort = /^(?:localhost|[^/?#:\s]+\.[^/?#:\s]+):\d+(?:[/?#]|$)/i.test(raw);
  const candidate = raw.startsWith('//') ? 'https:' + raw
    : /^[a-z][a-z\d+.-]*:/i.test(raw) && !hostWithPort ? raw : 'https://' + raw;
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
export const EXAM_PUBLIC_COLUMNS = `a.id,a.category_id,a.title,a.icon,a.description,a.preview_image,a.locked,a.sort_order,a.created_at,a.view_count,
  c.name AS category,c.icon AS category_icon,CASE WHEN a.locked=0 THEN a.url ELSE NULL END AS url`;

export async function examApps(req, env, segs, method, {ok, err, okCache}) {
  const db = env.DB;
  const id = segs[1];
  if (id === 'categories') {
    const categoryId = segs[2];
    if (categoryId === 'reorder' && method === 'PUT' && segs.length === 3) {
      const body = await req.json();
      if (!Array.isArray(body.ids) || !body.ids.length || !body.ids.every(id => ['number','string'].includes(typeof id) && positiveId(id))) return err('ลำดับวิชาไม่ถูกต้อง');
      const orderedIds = body.ids.map(Number);
      if (new Set(orderedIds).size !== orderedIds.length) return err('รายการวิชาซ้ำกัน');
      const order = JSON.stringify(orderedIds);
      // One atomic update; a stale list (added/deleted subjects) changes no rows.
      // json_each keeps the bind count fixed even for a large subject list.
      const result = await db.prepare(`UPDATE exam_categories SET sort_order=(
        SELECT CAST(key AS INTEGER)+1 FROM json_each(?) WHERE CAST(value AS INTEGER)=exam_categories.id
      ) WHERE (SELECT COUNT(*) FROM exam_categories)=?
        AND NOT EXISTS (SELECT 1 FROM exam_categories WHERE id NOT IN (SELECT value FROM json_each(?)))`)
        .bind(order, orderedIds.length, order).run();
      if (result.meta.changes !== orderedIds.length) return err('รายชื่อวิชาเปลี่ยนไป กรุณารีเฟรชหน้าก่อนจัดลำดับอีกครั้ง', 409);
      return ok({ok:true});
    }
    if (!categoryId && method === 'GET') {
      const {results} = await db.prepare(`SELECT c.*,COUNT(a.id) AS app_count FROM exam_categories c
        LEFT JOIN exam_apps a ON a.category_id=c.id AND a.visible=1 GROUP BY c.id ORDER BY c.sort_order,c.id`).all();
      return ok({categories:results}, {'Cache-Control':'no-cache'});
    }
    if (categoryId && !positiveId(categoryId)) return err('ไม่พบหมวดวิชา', 404);
    if ((!categoryId && method === 'POST') || (categoryId && method === 'PUT')) {
      const b = await req.json();
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name || name.length > 100) return err('กรุณาใส่ชื่อวิชาไม่เกิน 100 ตัวอักษร');
      const duplicate = await db.prepare('SELECT id FROM exam_categories WHERE name=? AND id!=?').bind(name, categoryId || 0).first();
      if (duplicate) return err('ชื่อวิชานี้มีอยู่แล้ว', 409);
      const values = [name, String(b.icon || '📚'), String(b.description || ''), parseInt(b.sort_order) || 0];
      if (categoryId) {
        const result = await db.prepare('UPDATE exam_categories SET name=?,icon=?,description=?,sort_order=? WHERE id=?').bind(...values, categoryId).run();
        if (!result.meta.changes) return err('ไม่พบหมวดวิชา', 404);
        return ok({ok:true});
      }
      const result = await db.prepare('INSERT INTO exam_categories (name,icon,description,sort_order) VALUES (?,?,?,?)').bind(...values).run();
      return ok({ok:true,id:result.meta.last_row_id});
    }
    if (categoryId && method === 'DELETE') {
      // Refuse deletion until apps have been moved/deleted, including hidden apps.
      const result = await db.prepare('DELETE FROM exam_categories WHERE id=? AND NOT EXISTS (SELECT 1 FROM exam_apps WHERE category_id=?)').bind(categoryId, categoryId).run();
      if (!result.meta.changes) return err('ลบไม่ได้: กรุณาย้ายหรือลบแอปในวิชานี้ให้หมดก่อน', 409);
      return ok({ok:true});
    }
    return err('ไม่พบ', 404);
  }
  if (id === 'admin' && segs[2] === 'list' && method === 'GET') {
    const [apps, categories] = await Promise.all([
      db.prepare('SELECT a.*,c.name AS category FROM exam_apps a JOIN exam_categories c ON c.id=a.category_id ORDER BY c.sort_order,c.id,a.sort_order,a.id DESC').all(),
      db.prepare('SELECT * FROM exam_categories ORDER BY sort_order,id').all(),
    ]);
    return ok({apps:apps.results,categories:categories.results});
  }
  const singleUnlock = positiveId(id) && segs[2] === 'unlock';
  if ((id === 'unlock-all' || singleUnlock) && method === 'POST') {
    const b = await req.json();
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    if (!code) return err('กรุณากรอกรหัส');
    if (b.category_id != null && !positiveId(b.category_id)) return err('หมวดวิชาไม่ถูกต้อง');
    const row = await db.prepare('SELECT * FROM access_codes WHERE code=?').bind(code).first();
    if (row && !row.active) return err('รหัสนี้ถูกปิดใช้งานแล้ว', 403);
    if (row?.expires_at && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now())) return err('รหัสหมดอายุแล้ว', 403);
    let sql = 'SELECT id,category_id,url,lock_code FROM exam_apps WHERE locked=1 AND visible=1';
    const args = [];
    if (singleUnlock) { sql += ' AND id=?'; args.push(id); }
    else if (b.category_id != null) { sql += ' AND category_id=?'; args.push(b.category_id); }
    const {results} = await db.prepare(sql).bind(...args).all();
    if (singleUnlock && !results.length) return err('ไม่พบแอปข้อสอบ', 404);
    const appIds = ids(row?.exam_app_ids), categoryIds = ids(row?.exam_category_ids);
    const matched = results.filter(a => row
      ? appIds.includes('all') || appIds.includes(String(a.id)) || categoryIds.includes(String(a.category_id))
      : !!a.lock_code && a.lock_code === code);
    if (!matched.length) return err(row ? 'รหัสนี้ไม่มีสิทธิ์ปลดล็อกแอปข้อสอบที่เลือก' : 'รหัสไม่ถูกต้อง', 403);
    const unlocked = matched.map(a => ({id:a.id,url:a.url}));
    return ok(singleUnlock ? {url:unlocked[0].url} : {unlocked,label:row?.label || ''});
  }
  if ((!id || positiveId(id)) && method === 'GET' && segs.length <= 2) {
    const {results} = await db.prepare(`SELECT ${EXAM_PUBLIC_COLUMNS} FROM exam_apps a JOIN exam_categories c ON c.id=a.category_id
      WHERE a.visible=1 ${id ? 'AND a.id=?' : ''} ORDER BY c.sort_order,c.id,a.sort_order,a.id DESC`).bind(...(id ? [id] : [])).all();
    if (id && !results.length) return err('ไม่พบแอปข้อสอบ', 404);
    return okCache(id ? {app:results[0]} : {apps:results});
  }
  if ((!id && method === 'POST') || (positiveId(id) && method === 'PUT' && segs.length === 2)) {
    const b = await req.json();
    if (typeof b.title !== 'string' || !b.title.trim()) return err('กรุณาใส่ชื่อแอปข้อสอบ');
    const appURL = webURL(b.url), previewURL = webURL(b.preview_image || '');
    if (!appURL) return err('กรุณาใส่ URL แอปที่ถูกต้อง เช่น example.com');
    if (b.preview_image && !previewURL) return err('URL รูปตัวอย่างไม่ถูกต้อง');
    if (!positiveId(b.category_id) || !await db.prepare('SELECT id FROM exam_categories WHERE id=?').bind(b.category_id).first()) return err('กรุณาเลือกหมวดวิชาที่มีอยู่');
    const values = [Number(b.category_id),b.title.trim(),String(b.icon || '📝'),String(b.description || ''),appURL,previewURL,b.locked !== false && b.locked !== 0 ? 1 : 0,String(b.lock_code || '').trim(),b.visible !== false && b.visible !== 0 ? 1 : 0,parseInt(b.sort_order) || 0];
    if (id) {
      const result = await db.prepare('UPDATE exam_apps SET category_id=?,title=?,icon=?,description=?,url=?,preview_image=?,locked=?,lock_code=?,visible=?,sort_order=? WHERE id=?').bind(...values,id).run();
      if (!result.meta.changes) return err('ไม่พบแอปข้อสอบ', 404);
      return ok({ok:true});
    }
    const result = await db.prepare('INSERT INTO exam_apps (category_id,title,icon,description,url,preview_image,locked,lock_code,visible,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...values).run();
    return ok({ok:true,id:result.meta.last_row_id});
  }
  if (positiveId(id) && method === 'DELETE' && segs.length === 2) {
    await db.prepare('DELETE FROM exam_apps WHERE id=?').bind(id).run();
    return ok({ok:true});
  }
  return err('ไม่พบ', 404);
}
