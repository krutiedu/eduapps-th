// Real SQL + API + browser regression tests. Uses only an in-memory database.
// node tests/exam-apps.mjs
// Optional PLAYWRIGHT_MODULE_PATH and PLAYWRIGHT_CHANNEL work as in admin-codes.mjs.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { onRequest } from '../functions/api/[[route]].js';
import { renderExamPage } from '../functions/_exam-pages.js';
import { onRequest as sitemap } from '../functions/sitemap.xml.js';

const db = new DatabaseSync(':memory:');
db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
// An existing production-style schema can receive the migration without losing old codes.
const migrated = new DatabaseSync(':memory:');
migrated.exec("CREATE TABLE access_codes(id INTEGER PRIMARY KEY,code TEXT,app_ids TEXT,worksheet_ids TEXT); INSERT INTO access_codes VALUES(1,'OLD','[1]','[2]');");
migrated.exec(await readFile(new URL('../migration-exam-apps.sql',import.meta.url),'utf8'));
assert.deepEqual({...migrated.prepare('SELECT * FROM access_codes').get()},{id:1,code:'OLD',app_ids:'[1]',worksheet_ids:'[2]',exam_app_ids:'[]',exam_category_ids:'[]'});
migrated.close();
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
  async batch(statements) { return Promise.all(statements.map(s => s.run())); },
};
const asset = async request => {
  let path = new URL(request.url).pathname;
  if (path === '/') path = '/index.html';
  if (path === '/admin/' || path === '/admin') path = '/admin/index.html';
  if (path.includes('..')) return new Response('',{status:404});
  try {
    const body = await readFile(new URL('../public' + path,import.meta.url));
    const extension = path.split('.').pop();
    return new Response(body,{headers:{'Content-Type':({html:'text/html; charset=utf-8',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',txt:'text/plain'})[extension] || 'application/octet-stream'}});
  } catch { return new Response('',{status:404}); }
};
const env = {DB,ASSETS:{fetch:asset}};
db.exec(`INSERT INTO sessions (token,expires_at,role) VALUES ('admin-test','2099-01-01','super_admin');
  INSERT INTO users (id,username,password_hash,display_name,permissions) VALUES (10,'apps-editor','','Editor','["apps"]'),(11,'article-editor','','Other','["articles"]');
  INSERT INTO sessions (token,expires_at,role,user_id) VALUES ('apps-editor','2099-01-01','editor',10),('other-editor','2099-01-01','editor',11);`);
const call = async (path,method = 'GET',body,token) => {
  const response = await onRequest({env,params:{route:path.split('/').filter(Boolean)},request:new Request('http://localhost/api' + path,{
    method,headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer ' + token} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  })});
  return {status:response.status,data:await response.json()};
};
const admin = async (path,method,body) => {
  const result = await call(path,method,body,'admin-test');
  assert.equal(result.status,200,JSON.stringify(result));
  return result.data;
};
assert.equal((await call('/exam-apps/admin/list')).status,401);
assert.equal((await call('/exam-apps/categories','POST',{name:'bad'})).status,401);
assert.equal((await call('/exam-apps/categories/unlock','POST',{name:'bad'})).status,401);
assert.equal((await call('/exam-apps/admin/list','GET',undefined,'other-editor')).status,403);
assert.equal((await call('/exam-apps/admin/list','GET',undefined,'apps-editor')).status,200);
const math = (await admin('/exam-apps/categories','POST',{name:'คณิตศาสตร์',icon:'🔢'})).id;
const thai = (await admin('/exam-apps/categories','POST',{name:'ภาษาไทย',icon:'📖'})).id;
const empty = (await admin('/exam-apps/categories','POST',{name:'วิชาว่าง'})).id;
const createApp = (title,category,extra = {}) => admin('/exam-apps','POST',{title,category_id:category,url:'https://exam.example/' + encodeURIComponent(title),...extra});
const first = (await createApp('ข้อสอบคณิต 1',math,{lock_code:'DIRECT'})).id;
const second = (await createApp('ข้อสอบคณิต 2',math)).id;
const third = (await createApp('ข้อสอบภาษาไทย',thai)).id;
const hidden = (await createApp('ข้อสอบซ่อน',math,{visible:false})).id;
const free = (await createApp('ข้อสอบฟรี',thai,{locked:false})).id;
const xss = (await createApp('<img src=x onerror="window.examXss=true">',thai,{description:'</p><script>window.examXss=true</script>'})).id;
assert.equal((await call('/exam-apps','POST',{title:'bad',category_id:math,url:'javascript:alert(1)'},'admin-test')).status,400);
assert.equal((await call('/exam-apps','POST',{title:'bad',category_id:999,url:'https://exam.example'},'admin-test')).status,400);
assert.equal((await call('/exam-apps/categories','POST',{name:'คณิตศาสตร์'},'admin-test')).status,409);
const createCode = (code,extra = {}) => admin('/codes','POST',{code,label:code,active:true,app_ids:['all'],worksheet_ids:[1],...extra});
await createCode('EXAMSALL',{exam_app_ids:['all']});
await createCode('MATH',{exam_category_ids:[String(math)]});
await createCode('ONE',{exam_app_ids:[String(first)]});
await createCode('MIX',{exam_category_ids:[math],exam_app_ids:[third]});
await createCode('LEGACY');
await createCode('EXPIRED',{exam_app_ids:['all'],expires_at:'2020-01-01T00:00:00Z'});
await createCode('DIRECT',{exam_app_ids:['all'],active:false});
const publicList = (await call('/exam-apps')).data.apps;
assert.equal(publicList.length,5);
assert.ok(publicList.filter(a => a.locked).every(a => a.url === null && !('lock_code' in a)));
assert.ok(publicList.find(a => a.id === free).url);
assert.equal((await call('/exam-apps/' + hidden)).status,404);
const unlock = (code,category_id) => call('/exam-apps/unlock-all','POST',{code,...(category_id ? {category_id} : {})});
const unlockedIds = result => result.data.unlocked.map(a => a.id).sort((a,b) => a-b);
assert.deepEqual(unlockedIds(await unlock('EXAMSALL')),[first,second,third,xss]);
assert.deepEqual(unlockedIds(await unlock('MATH')),[first,second]);
assert.deepEqual(unlockedIds(await unlock('ONE')),[first]);
assert.deepEqual(unlockedIds(await unlock('MIX')),[first,second,third]);
assert.deepEqual(unlockedIds(await unlock('EXAMSALL',thai)),[third,xss]);
assert.equal((await unlock('MATH',thai)).status,403);
assert.equal((await unlock('LEGACY')).status,403);
assert.equal((await unlock('EXPIRED')).status,403);
assert.equal((await unlock('DIRECT')).status,403,'inactive central code must not fall back to a matching per-app code');
assert.equal((await unlock('')).status,400);
assert.equal((await call('/exam-apps/' + third + '/unlock','POST',{code:'ONE'})).status,403);
assert.equal((await call('/exam-apps/' + hidden + '/unlock','POST',{code:'EXAMSALL'})).status,404);
assert.equal((await call('/exam-apps/' + first + '/unlock','POST',{code:'ONE'})).status,200);
const later = (await createApp('ข้อสอบใหม่ภายหลัง',math)).id;
assert.deepEqual(unlockedIds(await unlock('MATH')),[first,second,later]);
assert.deepEqual(unlockedIds(await unlock('ONE')),[first]);
await admin('/exam-apps/categories/' + math,'PUT',{name:'คณิตศาสตร์ใหม่',icon:'🔢'});
assert.deepEqual(unlockedIds(await unlock('MATH')),[first,second,later]);
assert.equal((await call('/exam-apps/categories/' + math,'DELETE',undefined,'admin-test')).status,409);
await admin('/exam-apps/categories/' + empty,'DELETE');
const categoryOrder = () => db.prepare('SELECT id FROM exam_categories ORDER BY sort_order,id').all().map(c => c.id);
assert.equal((await call('/exam-apps/categories/reorder','PUT',{ids:[thai,math]})).status,401);
assert.equal((await call('/exam-apps/categories/reorder','PUT',{ids:[thai,math]},'other-editor')).status,403);
const scopesBeforeOrder = db.prepare('SELECT * FROM access_codes ORDER BY id').all();
const appsBeforeOrder = db.prepare('SELECT * FROM exam_apps ORDER BY id').all();
await admin('/exam-apps/categories/reorder','PUT',{ids:[String(thai),math]});
assert.deepEqual(categoryOrder(),[thai,math]);
assert.deepEqual((await call('/exam-apps/categories')).data.categories.map(c => c.id),[thai,math]);
assert.deepEqual(db.prepare('SELECT * FROM access_codes ORDER BY id').all(),scopesBeforeOrder);
assert.deepEqual(db.prepare('SELECT * FROM exam_apps ORDER BY id').all(),appsBeforeOrder);
for (const invalid of [[],[math,math],[math,String(math)],[null,thai],[[math],thai],['all',thai]]) {
  assert.equal((await call('/exam-apps/categories/reorder','PUT',{ids:invalid},'admin-test')).status,400);
  assert.deepEqual(categoryOrder(),[thai,math]);
}
for (const stale of [[math],[math,thai,999999],[math,999999]]) {
  assert.equal((await call('/exam-apps/categories/reorder','PUT',{ids:stale},'admin-test')).status,409);
  assert.deepEqual(categoryOrder(),[thai,math],'stale/unknown lists must not partially update the order');
}
assert.equal((await call('/exam-apps/categories/reorder','PUT',{ids:[math,thai]},'apps-editor')).status,200);
assert.deepEqual(categoryOrder(),[math,thai]);
// Old clients updating codes cannot silently clear new exam scopes.
const mathCode = (await admin('/codes')).codes.find(c => c.code === 'MATH');
await admin('/codes/' + mathCode.id,'PUT',{code:'MATH',label:'Math package',app_ids:['all'],worksheet_ids:[1],active:true});
assert.equal((await admin('/codes')).codes.find(c => c.code === 'MATH').exam_category_ids,JSON.stringify([String(math)]));
// Direct per-app codes still work when there is no conflicting central code.
await createApp('รหัสตรง',thai,{lock_code:'LOCALONLY'});
assert.equal((await unlock('LOCALONLY')).status,200);
const shell = await readFile(new URL('../public/index.html',import.meta.url),'utf8');
for (const path of ['/exam-apps','/exam-apps/category/' + math,'/exam-apps/' + first]) {
  const response = await renderExamPage({env,request:new Request('http://localhost' + path),params:{id:path === '/exam-apps' ? undefined : path.split('/').pop()}});
  assert.equal(response.status,200);
  const html = await response.text();
  assert.match(html,/data-server-rendered/);
  for (const app of db.prepare('SELECT url FROM exam_apps WHERE locked=1').all()) assert.ok(!html.includes(app.url),'no locked destinations in SSR');
  assert.doesNotMatch(html,/lock_code|DIRECT|LOCALONLY/);
  assert.match(html,/href="\/exam-apps/);
}
for (const id of [hidden,99999,'oops']) assert.equal((await renderExamPage({env,request:new Request('http://localhost/exam-apps/' + id),params:{id:String(id)}})).status,404);
const broken = await renderExamPage({env:{...env,DB:{prepare(){throw new Error('fixture DB offline');}}},request:new Request('http://localhost/exam-apps'),params:{}});
assert.equal(broken.status,503);
const xml = await (await sitemap({env})).text();
assert.match(xml,new RegExp('/exam-apps/category/' + math));
assert.match(xml,new RegExp('/exam-apps/' + first + '<'));
assert.doesNotMatch(xml,new RegExp('/exam-apps/' + hidden + '<'));
await call('/track','POST',{path:'/exam-apps/' + first,visitor_id:'exam-test'});
assert.equal(db.prepare('SELECT view_count FROM exam_apps WHERE id=?').get(first).view_count,1);
assert.ok((await admin('/backup')).exam_apps.length);
console.log('PASS: SQL migration, protected URLs, all/category/app grants, future apps, rename, expiry, disabled codes, legacy updates, permissions, SSR, sitemap and backup.');

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
let failReorder = false, reorderRequests = 0;
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1');
    let response;
    if (url.pathname.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      if (url.pathname === '/api/exam-apps/categories/reorder') reorderRequests++;
      if (url.pathname === '/api/exam-apps/categories/reorder' && failReorder) {
        failReorder = false;
        response = new Response(JSON.stringify({error:'Fixture reorder unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});
      } else response = await onRequest({env,params:{route:url.pathname.slice(5).split('/')},request:new Request(url,{method:req.method,headers:req.headers,...(body ? {body} : {})})});
    } else if (/^\/exam-apps(?:\/(?:category\/)?[^/]+)?\/?$/.test(url.pathname)) {
      response = await renderExamPage({env,request:new Request(url),params:{id:url.pathname === '/exam-apps' ? undefined : url.pathname.split('/').pop()}});
    } else response = await asset(new Request(url));
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.statusCode = 500; res.end(error.stack); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Bangkok'});
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  page.on('dialog',dialog => dialog.accept());
  await page.route('https://**/*',route => route.abort());
  const base = 'http://127.0.0.1:' + server.address().port;
  await page.goto(base + '/exam-apps');
  await page.locator('#examSearch').waitFor();
  await page.waitForFunction(() => !document.getElementById('app').dataset.serverRendered);
  assert.ok(await page.locator('.exam-card').count() >= 6);
  assert.equal(await page.evaluate(() => window.examXss),undefined);
  const output = new URL('../.wrangler/exam-test/',import.meta.url);
  await mkdir(output,{recursive:true});
  await page.screenshot({path:new URL('library-desktop.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.locator('.exam-subject').filter({hasText:'คณิตศาสตร์ใหม่'}).click();
  await page.waitForURL('**/exam-apps/category/' + math);
  await page.locator('#examSearch').fill('คณิต 1');
  assert.equal(await page.locator('.exam-card').count(),1);
  await page.locator('#examCode').fill('MATH');
  await page.locator('#examUnlockForm button').click();
  await page.waitForFunction(() => document.getElementById('examUnlockMsg').textContent.includes('สำเร็จ'));
  await page.locator('.exam-card-main').click();
  await page.waitForURL('**/exam-apps/' + first);
  await page.locator('#examLaunch').waitFor();
  assert.match(await page.locator('#examExternal').getAttribute('href'),/^https:\/\/exam\.example/);
  await page.locator('#examLaunch').click();
  await page.locator('#appViewer').waitFor({state:'visible'});
  assert.equal(await page.locator('#appViewer').evaluate(el => getComputedStyle(el).display),'flex');
  await page.evaluate(() => closeAppViewer());
  // Revoking a previously redeemed code takes effect when opening the app again.
  db.prepare("UPDATE access_codes SET active=0 WHERE code='MATH'").run();
  await page.locator('#examLaunch').click();
  await page.locator('#examUnlockForm').waitFor();
  assert.match(await page.locator('#examUnlockMsg').innerText(),/ปิดใช้งาน/);
  db.prepare("UPDATE access_codes SET active=1 WHERE code='MATH'").run();
  await page.reload();
  await page.locator('#examLaunch').waitFor();
  await page.goto(base + '/exam-apps/' + third);
  await page.locator('#examUnlockForm').waitFor();
  await page.locator('#examCode').fill('ONE');
  await page.locator('#examUnlockForm button').click();
  await page.waitForFunction(() => document.getElementById('examUnlockMsg').textContent.includes('ไม่มีสิทธิ์'));
  await page.locator('#examCode').fill('EXAMSALL');
  await page.locator('#examUnlockForm button').click();
  await page.locator('#examLaunch').waitFor();
  await page.goto(base + '/exam-apps/' + free);
  await page.locator('#examLaunch').waitFor();
  assert.equal(await page.locator('#examUnlockForm').count(),0);
  for (const width of [320,768,960,1024]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),'navigation fits viewport ' + width);
  }
  await page.setViewportSize({width:375,height:812});
  await page.goto(base + '/exam-apps');
  await page.waitForFunction(() => !document.getElementById('app').dataset.serverRendered);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path:new URL('library-mobile.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.goto(base + '/admin/');
  await page.evaluate(async () => { localStorage.setItem('_admtok','admin-test'); showAdmin(); await renderExamAdmin('categories'); });
  await page.getByRole('button',{name:'+ เพิ่มวิชา',exact:true}).click();
  await page.locator('#examCategoryForm [name=name]').fill('วิชาทดสอบ');
  await page.locator('#examCategoryForm [type=submit]').click();
  await page.waitForFunction(() => !document.getElementById('examCategoryForm'));
  assert.ok(db.prepare("SELECT id FROM exam_categories WHERE name='วิชาทดสอบ'").get());
  // Native mouse dragging, keyboard ordering and mobile move controls all persist.
  await page.setViewportSize({width:1440,height:1000});
  const rowOrder = () => page.locator('#examCategoryRows [data-category-id]').evaluateAll(rows => rows.map(row => Number(row.dataset.categoryId)));
  const beforeDrag = await rowOrder();
  const dragSource = page.locator(`[data-category-id="${beforeDrag[0]}"] [data-category-grip]`);
  const dragTarget = page.locator(`[data-category-id="${beforeDrag.at(-1)}"]`);
  const targetBounds = await dragTarget.boundingBox();
  await dragSource.dragTo(dragTarget,{targetPosition:{x:20,y:targetBounds.height - 4}});
  await page.waitForFunction(() => document.getElementById('examCategoryOrderStatus').textContent.includes('✅'));
  let expectedOrder = [...beforeDrag.slice(1),beforeDrag[0]];
  assert.deepEqual(await rowOrder(),expectedOrder);
  assert.deepEqual(categoryOrder(),expectedOrder);
  assert.equal(reorderRequests,1);
  const movedGrip = page.locator(`[data-category-id="${beforeDrag[0]}"] [data-category-grip]`);
  await movedGrip.press('ArrowUp');
  await page.waitForFunction(() => !document.getElementById('examCategoryManager').dataset.saving);
  [expectedOrder[1],expectedOrder[2]] = [expectedOrder[2],expectedOrder[1]];
  assert.deepEqual(await rowOrder(),expectedOrder);
  assert.deepEqual(categoryOrder(),expectedOrder);
  assert.equal(await movedGrip.evaluate(el => el === document.activeElement),true);
  await page.evaluate(() => renderExamAdmin('categories'));
  assert.deepEqual(await rowOrder(),expectedOrder,'saved order survives a fresh API load');
  const writesBeforeCancel = reorderRequests;
  await page.locator(`[data-category-id="${expectedOrder[0]}"] [data-category-grip]`).dragTo(page.locator('.page-title'));
  assert.deepEqual(await rowOrder(),expectedOrder);
  assert.equal(reorderRequests,writesBeforeCancel,'dropping outside the table does not save');
  assert.equal(await page.locator('.exam-category-dragging,.exam-drop-before,.exam-drop-after').count(),0);
  failReorder = true;
  await page.locator(`[data-category-id="${expectedOrder[0]}"] [data-category-move="1"]`).click();
  await page.waitForFunction(() => document.getElementById('examCategoryOrderStatus').textContent.includes('Fixture reorder unavailable'));
  assert.deepEqual(await rowOrder(),expectedOrder);
  assert.deepEqual(categoryOrder(),expectedOrder);
  assert.equal(await page.locator('#examCategoryManager').evaluate(el => el.inert),false);
  await page.setViewportSize({width:375,height:812});
  await page.locator(`[data-category-id="${expectedOrder[0]}"] [data-category-move="1"]`).click();
  await page.waitForFunction(() => !document.getElementById('examCategoryManager').dataset.saving);
  [expectedOrder[0],expectedOrder[1]] = [expectedOrder[1],expectedOrder[0]];
  assert.deepEqual(await rowOrder(),expectedOrder);
  assert.deepEqual(categoryOrder(),expectedOrder);
  assert.equal(await page.locator('#examCategoryRows tr').first().locator('[data-category-move="-1"]').isDisabled(),true);
  assert.equal(await page.locator('#examCategoryRows tr').last().locator('[data-category-move="1"]').isDisabled(),true);
  await page.screenshot({path:new URL('category-order-mobile.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:new URL('category-order-desktop.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.goto(base + '/exam-apps');
  await page.waitForFunction(() => !document.getElementById('app').dataset.serverRendered);
  assert.deepEqual(await page.locator('.exam-subject').evaluateAll(links => links.map(link => Number(link.getAttribute('href').split('/').pop()))),expectedOrder);
  await page.goto(base + '/admin/');
  await page.evaluate(() => showAdmin());
  await page.setViewportSize({width:375,height:812});
  await page.evaluate(async () => { await renderExamAdmin(); openExamApp(null); });
  await page.locator('#examAppForm [name=title]').fill('ข้อสอบผ่านแอดมิน');
  await page.locator('#examAppForm [name=url]').fill('https://exam.example/admin');
  await page.locator('#examAppForm [type=submit]').click();
  await page.waitForFunction(() => !document.getElementById('examAppForm'));
  assert.ok(db.prepare("SELECT id FROM exam_apps WHERE title='ข้อสอบผ่านแอดมิน'").get());
  await page.evaluate(async id => { await renderCodes(); await openCodeModal(id,'exams'); },mathCode.id);
  await page.locator('#cExamCategories [data-exam-category="' + math + '"]').waitFor();
  assert.equal(await page.locator('#cExamCategories [data-exam-category="' + math + '"]').isChecked(),true);
  await page.locator('#cExamsPicker [data-picker-search]').fill('ข้อสอบภาษาไทย');
  await page.locator('#cExamsPicker [data-picker-item="' + third + '"]').check();
  await page.locator('#cSave').click();
  await page.waitForFunction(() => !document.getElementById('cSave'));
  let saved = db.prepare('SELECT * FROM access_codes WHERE id=?').get(mathCode.id);
  assert.deepEqual(JSON.parse(saved.exam_app_ids),[third]);
  assert.deepEqual(JSON.parse(saved.exam_category_ids),[math]);
  assert.deepEqual(JSON.parse(saved.app_ids),['all']);
  assert.deepEqual(JSON.parse(saved.worksheet_ids),[1]);
  await page.evaluate(id => openCodeModal(id,'exams'),mathCode.id);
  await page.locator('#cExamsPicker [data-picker-vip]').check();
  await page.locator('#cSave').click();
  await page.waitForFunction(() => !document.getElementById('cSave'));
  saved = db.prepare('SELECT * FROM access_codes WHERE id=?').get(mathCode.id);
  assert.deepEqual(JSON.parse(saved.exam_app_ids),['all']);
  await page.evaluate(id => openEmailModal(id),mathCode.id);
  assert.match(await page.locator('#emApps').inputValue(),/ทุกแอปข้อสอบ/);
  assert.match(await page.evaluate(() => buildEmailHTML()),/https:\/\/kru-ti.com\/exam-apps/);
  await page.evaluate(id => openMsgrModal(id),mathCode.id);
  assert.match(await page.locator('#mgPreview').inputValue(),/\/exam-apps/);
  await page.evaluate(id => openCodeModal(id,'exams'),mathCode.id);
  const box = await page.locator('.code-modal').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 376);
  await page.screenshot({path:new URL('code-exams-mobile.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:new URL('code-exams-desktop.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  assert.deepEqual(errors,[]);
  console.log('PASS: browser subject/detail links, search, all/category/app redemption, revocation, reload, free exams, admin CRUD, drag/keyboard/mobile category ordering, cancelled/failed saves, preserved mixed scopes, all-future checkbox and mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  db.close();
}
