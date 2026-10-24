// Real SQLite + authenticated API + browser tests; never connects to production.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { onRequest } from '../functions/api/[[route]].js';

const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
// Exercise first-use initialization on an existing database, then a repeatable migration.
db.exec('DROP TABLE access_code_group_members; DROP TABLE access_code_groups;');
const DB = {
  prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async all() { return {results:db.prepare(sql).all(...args).map(row => ({...row}))}; },
      async first() { const row = db.prepare(sql).get(...args); return row ? {...row} : null; },
      async run() { const result = db.prepare(sql).run(...args); return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}; },
    };
    return statement;
  },
  async batch(statements) {
    db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
const env = {DB};
db.exec(`INSERT INTO sessions(token,expires_at,role) VALUES ('organizer-admin','2099-01-01','super_admin');
  INSERT INTO users(id,username,password_hash,display_name,permissions) VALUES (10,'editor','','Editor','["apps"]');
  INSERT INTO sessions(token,expires_at,role,user_id) VALUES ('editor-token','2099-01-01','editor',10);
  INSERT INTO apps(id,title,category,url,locked,visible) VALUES
    (1,'Future Money','การเงิน','https://apps.example/money',1,1),
    (2,'Math Quest','คณิตศาสตร์','https://apps.example/math',1,1),
    (3,'แอปฟรี','อื่นๆ','https://apps.example/free',0,1);
  INSERT INTO worksheets(id,title,category,file_url,locked,visible) VALUES (1,'ใบงานเศษส่วน','คณิตศาสตร์','https://files.example/one',1,1);
  INSERT INTO exam_categories(id,name) VALUES (1,'O-NET คณิตศาสตร์'),(2,'ภาษาไทย');
  INSERT INTO exam_apps(id,title,category_id,url,locked,visible) VALUES
    (1,'ข้อสอบคณิต ชุดแรก',1,'https://exam.example/one',1,1),
    (2,'ข้อสอบภาษาไทย',2,'https://exam.example/two',1,1);`);
const call = async (path,method = 'GET',body,token = 'organizer-admin') => {
  const response = await onRequest({env,params:{route:path.split('/').filter(Boolean)},request:new Request('http://localhost/api' + path,{
    method,headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer ' + token} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  })});
  return {status:response.status,data:await response.json()};
};
const admin = async (path,method,body) => { const result = await call(path,method,body); assert.equal(result.status,200,JSON.stringify(result)); return result.data; };
const records = () => db.prepare('SELECT * FROM access_codes ORDER BY id').all().map(row => ({...row}));
assert.equal((await call('/codes/groups','POST',{name:'forbidden'},null)).status,401);
assert.equal((await call('/codes/groups','POST',{name:'forbidden'},'editor-token')).status,403);
assert.deepEqual(await admin('/codes'),{codes:[],groups:[]});
const migration = await readFile(new URL('../migration-code-groups.sql',import.meta.url),'utf8');
db.exec(migration); db.exec(migration);
const classroom = (await admin('/codes/groups','POST',{name:'  ห้องเรียน  '})).id;
const exams = (await admin('/codes/groups','POST',{name:'O-NET'})).id;
const experiment = (await admin('/codes/groups','POST',{name:'ทดลอง'})).id;
const hostileName = '<img src=x onerror="window.codeGroupXss=true">';
const hostile = (await admin('/codes/groups','POST',{name:hostileName})).id;
assert.equal((await call('/codes/groups','POST',{name:'o-net'})).status,409);
for (const name of ['', ' '.repeat(3), 'x'.repeat(81), null, {}]) assert.equal((await call('/codes/groups','POST',{name})).status,400);
assert.equal((await call('/codes/groups/' + classroom,'PUT',{name:'O-NET'})).status,409);
const create = (code,label,extra = {}) => admin('/codes','POST',{code,label,active:true,app_ids:[],worksheet_ids:[],...extra});
await create('M612','6/12',{app_ids:[1],worksheet_ids:[1],group_id:classroom});
await create('M604','6/4',{app_ids:[1],group_id:classroom});
await create('EXAM1','ข้อสอบรายวิชา',{exam_category_ids:[1],group_id:exams});
await create('VIP01','สิทธิ์ทั้งหมด',{app_ids:['all'],worksheet_ids:['all'],exam_app_ids:['all']});
await create('OFF01','ปิดแล้ว',{app_ids:[1],active:false});
await create('OLD01','หมดอายุแล้ว',{app_ids:[1],expires_at:'2000-01-01T00:00:00Z'});
await create('SOON01','ใกล้หมดอายุ',{worksheet_ids:[1],expires_at:new Date(Date.now() + 2 * 86400000).toISOString()});
await create('ONEEXAM','ข้อสอบเฉพาะแอป',{exam_app_ids:[2]});
await create('EMPTY01','ทดลองไม่มีสิทธิ์',{group_id:experiment});
for (let index = 0; index < 111; index++) await create('FILL' + index,'รายการ ' + index,{app_ids:[2]});
const id = code => records().find(row => row.code === code).id;
assert.equal((await call('/codes','POST',{code:'BADGROUP',label:'bad',group_id:999999})).status,409);
assert.ok(!records().some(row => row.code === 'BADGROUP'));
const permissionsBefore = records();
await admin('/codes/groups/move','PUT',{ids:[id('M612'),String(id('M604'))],group_id:experiment});
assert.deepEqual(records(),permissionsBefore,'bulk organization must leave every permission/expiry/status untouched');
assert.equal((await admin('/codes')).codes.find(row => row.code === 'M612').group_id,experiment);
for (const group_id of [false,[],{},-1,'all']) assert.equal((await call('/codes/groups/move','PUT',{ids:[id('M612')],group_id})).status,400);
assert.equal((await call('/codes/groups/move','PUT',{ids:[id('M612'),999999],group_id:classroom})).status,409);
assert.equal((await admin('/codes')).codes.find(row => row.code === 'M612').group_id,experiment,'stale move cannot partially apply');
// Multiple chunks stay within the D1 parameter limit and commit together.
const membershipBefore = db.prepare('SELECT * FROM access_code_group_members ORDER BY code_id').all();
db.exec(`CREATE TEMP TRIGGER fail_group_move BEFORE INSERT ON access_code_group_members
  WHEN NEW.code_id > 80 BEGIN SELECT RAISE(ABORT, 'fixture assignment failure'); END;`);
assert.equal((await call('/codes/groups/move','PUT',{ids:records().map(row => row.id),group_id:hostile})).status,500);
assert.deepEqual(db.prepare('SELECT * FROM access_code_group_members ORDER BY code_id').all(),membershipBefore,'failure in later chunk rolls back earlier assignments');
assert.equal((await call('/codes','POST',{code:'ROLLBACK',label:'atomic creation',group_id:hostile})).status,500);
assert.ok(!records().some(row => row.code === 'ROLLBACK'),'code creation and group assignment are atomic');
db.exec('DROP TRIGGER fail_group_move');
await admin('/codes/groups/move','PUT',{ids:records().map(row => row.id),group_id:hostile});
assert.equal(db.prepare('SELECT COUNT(*) n FROM access_code_group_members WHERE group_id=?').get(hostile).n,120);
assert.deepEqual(records(),permissionsBefore);
await admin('/codes/groups/move','PUT',{ids:records().map(row => row.id),group_id:null});
await admin('/codes/groups/move','PUT',{ids:[id('M612'),id('M604')],group_id:classroom});
await admin('/codes/groups/move','PUT',{ids:[id('EXAM1')],group_id:exams});
await admin('/codes/groups/move','PUT',{ids:[id('EMPTY01')],group_id:experiment});
await admin('/codes/groups/' + experiment,'DELETE');
assert.equal((await admin('/codes')).codes.find(row => row.code === 'EMPTY01').group_id,null);
assert.deepEqual(records(),permissionsBefore,'deleting a group must retain codes and permissions');
await admin('/codes/groups/' + classroom,'PUT',{name:'นักเรียน'});
assert.equal((await admin('/codes')).codes.find(row => row.code === 'M604').group_id,classroom);
const row = records().find(row => row.code === 'M604');
const payload = {...row,app_ids:JSON.parse(row.app_ids),worksheet_ids:JSON.parse(row.worksheet_ids),exam_app_ids:JSON.parse(row.exam_app_ids),exam_category_ids:JSON.parse(row.exam_category_ids)};
await admin('/codes/' + row.id,'PUT',payload);
assert.equal((await admin('/codes')).codes.find(c => c.id === row.id).group_id,classroom,'legacy update without group_id preserves group');
await admin('/codes/' + row.id,'PUT',{...payload,group_id:null});
assert.equal((await admin('/codes')).codes.find(c => c.id === row.id).group_id,null);
await admin('/codes/' + row.id,'PUT',{...payload,group_id:classroom});
assert.deepEqual(records(),permissionsBefore);
const backup = await admin('/backup');
assert.ok(backup.access_code_groups.length && backup.access_code_group_members.length);
const unlock = await call('/apps/1/unlock','POST',{code:'M604'},null);
assert.equal(unlock.status,200,'organized code still unlocks the same app');
db.exec(`INSERT INTO exam_apps(id,title,category_id,url,locked,visible) VALUES (3,'ข้อสอบคณิต เพิ่มภายหลัง',1,'https://exam.example/later',1,1)`);

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const html = await readFile(new URL('../public/admin/index.html',import.meta.url),'utf8');
let failMove = false;
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/admin/' || url.pathname === '/admin') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
  if (url.pathname === '/version.txt') { res.end('fixture'); return; }
  if (failMove && url.pathname === '/api/codes/groups/move') { failMove = false; res.writeHead(500,{'Content-Type':'application/json'}); res.end('{"error":"ทดสอบย้ายไม่สำเร็จ"}'); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const headers = new Headers(req.headers);
  headers.set('Authorization','Bearer organizer-admin');
  const response = await onRequest({env,params:{route:url.pathname.replace(/^\/api\//,'').split('/')},request:new Request(url,{
    method:req.method,headers,...(body ? {body} : {}),
  })});
  res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(await response.text());
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Bangkok'});
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  page.on('dialog',dialog => dialog.accept());
  await page.route('https://**/*',route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
  await page.evaluate(async () => { showAdmin(); applyRole(); await renderCodes(); });
  const bodyText = () => page.locator('#codesBody').innerText();
  const reset = async () => { await page.getByRole('button',{name:'ล้างตัวกรอง',exact:true}).click(); await page.locator('#codeSearch').waitFor(); };
  const search = text => page.locator('#codeSearch').fill(text);
  assert.equal(await page.locator('#codesBody tr').count(),25);
  await page.locator('[data-code-select]').first().check();
  await page.locator('#codeNext').click(); assert.match(await page.locator('#codePage').innerText(),/2 \/ 5/);
  assert.match(await page.locator('#codeSelectedCount').innerText(),/1 รหัส/,'page changes preserve selection');
  await page.locator('#codeSelectPage').check();
  assert.match(await page.locator('#codeSelectedCount').innerText(),/26 รหัส/);
  await page.locator('#codePageSize').selectOption('50'); assert.equal(await page.locator('#codesBody tr').count(),50);
  assert.equal(await page.locator('#codeBulk').isHidden(),true,'filter changes clear hidden selections');
  await search('Future Money');
  for (const code of ['M604','M612','VIP01','OFF01','OLD01']) assert.match(await bodyText(),new RegExp(code));
  await page.locator('#codeStatus').selectOption('active');
  assert.doesNotMatch(await bodyText(),/OFF01|OLD01/);
  await page.locator(`[data-code-group="${classroom}"]`).click();
  await page.locator('#codeSort').selectOption('label');
  assert.deepEqual(await page.locator('#codesBody code').allTextContents(),['M604','M612'],'natural classroom sort');
  await page.getByRole('button',{name:'แก้ไขรหัส M604',exact:true}).click();
  await page.locator('#codeTab-info').click();
  assert.equal(await page.locator('#cGroup').inputValue(),String(classroom));
  await page.locator('#cSave').click(); await page.waitForFunction(() => !document.getElementById('cSave'));
  await page.locator('#codeSearch').waitFor();
  assert.equal(await page.locator('#codeSearch').inputValue(),'Future Money');
  assert.equal(await page.locator('#codeStatus').inputValue(),'active');
  assert.equal(await page.locator('#codeSort').inputValue(),'label');
  await page.reload(); await page.evaluate(async () => { showAdmin(); applyRole(); await renderCodes(); });
  assert.equal(await page.locator('#codeSearch').inputValue(),'Future Money','filters survive reload in the same tab');
  await reset(); await page.locator('#codeContent').selectOption('apps:1');
  assert.match(await bodyText(),/VIP01/,'all-app permission matches specific app filter');
  await reset(); await search('ใบงานเศษส่วน'); assert.match(await bodyText(),/M612/); assert.match(await bodyText(),/VIP01/);
  await reset(); await search('ข้อสอบคณิต เพิ่มภายหลัง'); assert.match(await bodyText(),/EXAM1/); assert.match(await bodyText(),/VIP01/);
  await page.locator('#codeKind').selectOption('exams'); await page.locator('#codeContent').selectOption('category:1');
  assert.doesNotMatch(await bodyText(),/ONEEXAM/);
  await reset(); await page.locator('#codeStatus').selectOption('expiring');
  assert.deepEqual(await page.locator('#codesBody code').allTextContents(),['SOON01']);
  await reset(); await search('M612'); await page.locator('.code-app-link').filter({hasText:'ใบงาน'}).click();
  assert.match(await page.locator('#codeAppsDetail').innerText(),/ใบงานเศษส่วน/);
  assert.equal(await page.locator('#codeAppsDetail [data-picker-item]:enabled').count(),0);
  await page.keyboard.press('Escape');
  await reset(); await page.locator(`[data-code-group="${classroom}"]`).click();
  await page.locator('#codeSelectPage').check();
  assert.match(await page.locator('#codeSelectedCount').innerText(),/2 รหัส/);
  await page.locator('#codeMoveGroup').selectOption(String(exams));
  failMove = true; await page.locator('#codeMoveButton').click();
  await page.waitForFunction(() => !document.getElementById('codeMoveButton').disabled);
  assert.match(await page.locator('#toast').innerText(),/ทดสอบย้ายไม่สำเร็จ/);
  assert.equal(await page.locator('[data-code-select]:checked').count(),2,'failed move preserves selection');
  await page.locator('#codeMoveButton').click();
  await page.waitForFunction(() => document.getElementById('codeBulk')?.hidden);
  assert.match(await bodyText(),/ไม่พบรหัส/);
  assert.deepEqual(records(),permissionsBefore,'browser saves and moves preserve permission data');
  await reset(); await page.getByRole('button',{name:'📁 จัดการกลุ่ม',exact:true}).click();
  await page.locator('#groupName-new').fill('กลุ่มใหม่'); await page.getByRole('button',{name:'+ เพิ่มกลุ่ม',exact:true}).click();
  await page.getByRole('textbox',{name:'ชื่อกลุ่ม กลุ่มใหม่',exact:true}).waitFor();
  await page.locator('#groupName-new').fill('O-NET'); await page.getByRole('button',{name:'+ เพิ่มกลุ่ม',exact:true}).click();
  await page.waitForFunction(() => document.getElementById('codeGroupError')?.textContent.includes('มีชื่อกลุ่มนี้แล้ว'));
  assert.equal(await page.locator('#modal img').count(),0);
  assert.equal(await page.evaluate(() => window.codeGroupXss),undefined);
  await page.getByRole('button',{name:'ลบกลุ่ม ' + hostileName,exact:true}).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#modal input')].some(input => input.value.includes('onerror')));
  await page.getByRole('button',{name:'ลบกลุ่ม O-NET',exact:true}).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#modal input')].some(input => input.value === 'O-NET'));
  await page.keyboard.press('Escape');
  await page.locator('[data-code-group="ungrouped"]').click(); await search('M6'); assert.match(await bodyText(),/M604|M612/);
  await page.getByRole('button',{name:'แก้ไขรหัส M604',exact:true}).click();
  await page.locator('#codeTab-info').click();
  await page.locator('#cNewGroup').fill('กลุ่มจากฟอร์ม'); await page.locator('#cAddGroup').click();
  await page.waitForFunction(() => document.getElementById('cGroup')?.selectedOptions[0]?.textContent === 'กลุ่มจากฟอร์ม');
  await page.locator('#cSave').click(); await page.waitForFunction(() => !document.getElementById('cSave'));
  await page.locator('#codeSearch').waitFor();
  assert.deepEqual(records(),permissionsBefore);
  await reset(); await search('Future Money');
  const screenshots = new URL('../.wrangler/code-organizer-test/',import.meta.url);
  await mkdir(screenshots,{recursive:true});
  const { fileURLToPath } = await import('node:url');
  await page.evaluate(() => { window.scrollTo(0,0); document.getElementById('toast').classList.remove('show'); });
  await page.screenshot({path:fileURLToPath(new URL('desktop.png',screenshots)),fullPage:true,animations:'disabled'});
  for (const width of [375,320,1024]) {
    await page.setViewportSize({width,height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'page must not overflow horizontally');
    const filters = await page.locator('#codeStatus').boundingBox(); assert.ok(filters.width > 0 && filters.x + filters.width <= width + 1);
    if (width === 375) await page.screenshot({path:fileURLToPath(new URL('mobile.png',screenshots)),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: additive bootstrap/migration, group CRUD, atomic bulk moves, permissions/backup, content search, combined filters, natural sort, paging, persistence, failures, XSS and responsive layout.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
