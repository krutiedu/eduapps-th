// Admin-only organization metadata. Public unlock queries keep using access_codes.
const schemas = new WeakMap();
export async function ensureCodeGroups(DB) {
  if (!schemas.has(DB)) {
    const pending = DB.batch([
      DB.prepare(`CREATE TABLE IF NOT EXISTS access_code_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      DB.prepare(`CREATE TABLE IF NOT EXISTS access_code_group_members (
        code_id INTEGER PRIMARY KEY REFERENCES access_codes(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES access_code_groups(id) ON DELETE CASCADE)`),
      DB.prepare('CREATE INDEX IF NOT EXISTS idx_code_group_members_group ON access_code_group_members(group_id)'),
    ]).catch(error => { schemas.delete(DB); throw error; });
    schemas.set(DB, pending);
  }
  await schemas.get(DB);
}

export function codeGroupId(value) {
  if (value === null || value === '') return null;
  if (!['number','string'].includes(typeof value) || !/^\d+$/.test(String(value))) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function codeGroupAssignment(DB, codeId, groupId) {
  return groupId === null
    ? DB.prepare('DELETE FROM access_code_group_members WHERE code_id=?').bind(codeId)
    : DB.prepare(`INSERT INTO access_code_group_members(code_id,group_id) VALUES (?,?)
        ON CONFLICT(code_id) DO UPDATE SET group_id=excluded.group_id`).bind(codeId, groupId);
}

export async function codeGroups(req, DB, segs, method, {ok,err}) {
  if (segs.length === 2 && method === 'POST') {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 80) return err('กรุณาใส่ชื่อกลุ่มไม่เกิน 80 ตัวอักษร');
    try {
      const result = await DB.prepare('INSERT INTO access_code_groups(name) VALUES (?)').bind(name).run();
      return ok({ok:true,id:result.meta.last_row_id,name});
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error))) return err('มีชื่อกลุ่มนี้แล้ว',409);
      throw error;
    }
  }
  if (segs.length === 3 && segs[2] === 'move' && method === 'PUT') {
    const body = await req.json();
    const groupId = codeGroupId(body.group_id);
    if (groupId === undefined) return err('กลุ่มไม่ถูกต้อง');
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 1000) return err('เลือกรหัส 1–1,000 รายการ');
    const ids = [...new Set(body.ids.map(codeGroupId))];
    if (ids.some(id => id === undefined || id === null)) return err('รายการรหัสไม่ถูกต้อง');
    if (groupId !== null && !await DB.prepare('SELECT id FROM access_code_groups WHERE id=?').bind(groupId).first()) return err('ไม่พบกลุ่ม กรุณาโหลดรายการใหม่',409);
    // Keep each statement below D1's parameter limit; batch applies all chunks atomically.
    const chunks = [];
    for (let start = 0; start < ids.length; start += 80) chunks.push(ids.slice(start,start + 80));
    const counts = await Promise.all(chunks.map(chunk => DB.prepare(`SELECT COUNT(*) AS n FROM access_codes
      WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).first()));
    if (counts.reduce((sum,row) => sum + row.n,0) !== ids.length) return err('มีรหัสถูกลบระหว่างเปิดหน้านี้ กรุณาโหลดรายการใหม่',409);
    await DB.batch(chunks.map(chunk => {
      const slots = chunk.map(() => '?').join(',');
      return groupId === null
        ? DB.prepare(`DELETE FROM access_code_group_members WHERE code_id IN (${slots})`).bind(...chunk)
        : DB.prepare(`INSERT INTO access_code_group_members(code_id,group_id)
            SELECT id,? FROM access_codes WHERE id IN (${slots})
            ON CONFLICT(code_id) DO UPDATE SET group_id=excluded.group_id`).bind(groupId,...chunk);
    }));
    return ok({ok:true,moved:ids.length});
  }
  const id = codeGroupId(segs[2]);
  if (segs.length !== 3 || !id) return err('ไม่พบ',404);
  if (!await DB.prepare('SELECT id FROM access_code_groups WHERE id=?').bind(id).first()) return err('ไม่พบกลุ่ม',404);
  if (method === 'PUT') {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 80) return err('กรุณาใส่ชื่อกลุ่มไม่เกิน 80 ตัวอักษร');
    try {
      await DB.prepare('UPDATE access_code_groups SET name=? WHERE id=?').bind(name,id).run();
      return ok({ok:true});
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error))) return err('มีชื่อกลุ่มนี้แล้ว',409);
      throw error;
    }
  }
  if (method === 'DELETE') {
    await DB.batch([
      DB.prepare('DELETE FROM access_code_group_members WHERE group_id=?').bind(id),
      DB.prepare('DELETE FROM access_code_groups WHERE id=?').bind(id),
    ]);
    return ok({ok:true});
  }
  return err('ไม่พบ',404);
}
