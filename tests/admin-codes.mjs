// Browser regression test against mocked local APIs; never reads production data.
// Install Playwright and its Chromium browser, then run: node tests/admin-codes.mjs
// Optional: PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright and PLAYWRIGHT_CHANNEL=msedge
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);

const apps = Array.from({length:100}, (_, index) => ({
  id:index + 1, title:`แอป ${String(index + 1).padStart(3, '0')}`, icon:'🎮',
  category:index % 2 ? 'ภาษาอังกฤษ' : 'คณิตศาสตร์', locked:1, is_vip:index % 5 === 0 ? 1 : 0,
}));
apps[0].title += ' <img src=x onerror="window.codeTestXss=true">';
apps[0].category = 'หมวด "พิเศษ" <b>ทดสอบ</b>';
apps.push({id:101, title:'แอปเดิมที่เปิดใช้ฟรี', category:'อื่นๆ', locked:0});
const worksheets = Array.from({length:12}, (_, index) => ({id:index + 1, title:`ใบงาน ${String(index + 1).padStart(3, '0')}`, category:'แบบฝึกหัด', locked:1}));
worksheets.push({id:13, title:'ใบงานฟรี', category:'แบบฝึกหัด', locked:0});
const originalExpiry = '2027-10-18T12:34:17.000Z';
const codes = [
  {id:1, code:'TEST01', label:'ชุด "ทดสอบ" <b>ข้อความ</b>', app_ids:JSON.stringify([1,'20',65,101,999]), worksheet_ids:JSON.stringify([1,10,888]), expires_at:originalExpiry, active:1},
  {id:2, code:'VIP01', label:'VIP เดิม', app_ids:'["all"]', worksheet_ids:'["all"]', expires_at:null, active:1},
  {id:3, code:'EMPTY01', label:'รหัสที่ไม่มีแอป', app_ids:'[]', worksheet_ids:'[]', expires_at:null, active:1},
];
let lastSaved;
let failSave = false;
let failWorksheets = false;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (url.pathname === '/admin/' || url.pathname === '/admin') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (url.pathname === '/version.txt') { res.end('fixture'); return; }
  if (url.pathname === '/api/apps/admin/list') { res.end(JSON.stringify({apps})); return; }
  if (url.pathname === '/api/exam-apps/admin/list') { res.end(JSON.stringify({apps:[],categories:[]})); return; }
  if (url.pathname === '/api/worksheets/admin/list') {
    if (failWorksheets) { res.statusCode = 503; res.end(JSON.stringify({error:'Fixture unavailable'})); }
    else res.end(JSON.stringify({worksheets}));
    return;
  }
  if (url.pathname === '/api/codes' && req.method === 'GET') { res.end(JSON.stringify({codes})); return; }
  if (url.pathname.startsWith('/api/codes') && ['POST','PUT'].includes(req.method)) {
    let body='';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (failSave) { failSave = false; res.statusCode = 500; res.end(JSON.stringify({error:'Fixture save failure'})); return; }
      lastSaved = JSON.parse(body);
      const id = Number(url.pathname.split('/').pop());
      const record = req.method === 'PUT' ? codes.find(code => code.id === id) : {id:codes.length + 1};
      Object.assign(record, lastSaved, {app_ids:JSON.stringify(lastSaved.app_ids), worksheet_ids:JSON.stringify(lastSaved.worksheet_ids)});
      if (req.method === 'POST') codes.push(record);
      res.end('{"ok":true}');
    });
    return;
  }
  res.statusCode=404; res.end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000}, timezoneId:'Asia/Bangkok'});
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
  await page.evaluate(async () => { showAdmin(); await renderCodes(); });
  const picker = page.locator('#cAppsPicker');
  const wsPicker = page.locator('#cWorksheetsPicker');
  const field = (root, name) => root.locator(`[data-picker-${name}]`);
  const edit = async id => {
    await page.evaluate(id => openCodeModal(id), id);
    await page.locator('#cSave').waitFor();
  };
  const save = async () => {
    await page.locator('#cSave').click();
    await page.waitForFunction(() => !document.getElementById('cSave'));
    await page.locator('#codesBody tr').first().waitFor();
  };
  assert.equal(await page.locator('#codesBody tr').count(), 3);
  assert.equal(await page.locator('#codesBody .code-app-preview').count(), 0);
  assert.match(await page.locator('#codesBody').innerText(), /5 แอป/);
  assert.match(await page.locator('#codesBody').innerText(), /ทุกแอป \+ ใหม่/);
  assert.equal(await page.locator('#codesBody img, #codesBody strong b').count(), 0);

  // Detail view is read-only, searchable, and dismissible without editing a code.
  await page.locator('[aria-label="ดูแอปที่ปลดล็อกด้วยรหัส TEST01"]').click();
  assert.equal(await page.locator('#codeAppsDetail [data-picker-item]').count(), 5);
  assert.equal(await page.locator('#codeAppsDetail [data-picker-item]:enabled').count(), 0);
  await field(page.locator('#codeAppsDetail'), 'search').fill('020');
  assert.equal(await page.locator('#codeAppsDetail [data-picker-item]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.code-modal').count(), 0);

  // Selections survive filters, pages, mixed numeric/string IDs, and missing/free entries.
  await edit(1);
  assert.equal(await page.locator('#codeTab-apps').getAttribute('aria-selected'), 'true');
  await page.locator('#codeTab-apps').press('Home');
  assert.equal(await page.locator('#codeTab-info').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#cExpiry').inputValue(), '2027-10-18T19:34');
  await page.locator('#codeTab-info').press('ArrowRight');
  assert.equal(await page.locator('#codeTab-apps').getAttribute('aria-selected'), 'true');
  assert.match(await field(picker, 'count').innerText(), /5 \/ 102/);
  // Unselected combines with tier/category/search, updates immediately, and retains hidden selections.
  await field(picker, 'unselected').click();
  assert.equal(await field(picker, 'unselected').getAttribute('aria-pressed'), 'true');
  assert.equal(await picker.locator('[data-picker-item]:checked').count(), 0);
  await field(picker, 'tier').selectOption('vip');
  await field(picker, 'category').selectOption('ภาษาอังกฤษ');
  await field(picker, 'search').fill('006');
  assert.equal(await picker.locator('.code-picker-tier-vip').count(), 1);
  await picker.locator('[data-picker-item="6"]').click(); // The row disappears from the unselected view immediately.
  assert.equal(await picker.locator('[data-picker-item]').count(), 0);
  assert.match(await field(picker, 'unselected').innerText(), /96/);
  await field(picker, 'all').click();
  assert.equal(await picker.locator('[data-picker-item="6"]').isChecked(), true);
  await field(picker, 'tier').selectOption('premium');
  assert.equal(await picker.locator('[data-picker-item]').count(), 0, 'Premium excludes VIP');
  await field(picker, 'tier').selectOption('vip');
  await field(picker, 'selected').click();
  await picker.locator('[data-picker-item="6"]').click(); // The row disappears from the selected view immediately.
  assert.equal(await picker.locator('[data-picker-item]').count(), 0);
  await field(picker, 'all').click();
  await field(picker, 'search').fill('');
  await field(picker, 'category').selectOption('');
  await field(picker, 'tier').selectOption('free');
  assert.equal(await picker.locator('[data-picker-item="101"]').isChecked(), true, 'Legacy free-app permission is retained');
  assert.equal(await picker.locator('.code-picker-tier-free').count(), 1);
  await field(picker, 'tier').selectOption('');
  assert.match(await field(picker, 'count').innerText(), /5 \/ 102/);
  await field(picker, 'next').click();
  assert.match(await field(picker, 'page').innerText(), /2 \/ 17/);
  await field(picker, 'search').fill('020');
  await picker.locator('[data-picker-item="20"]').uncheck();
  await field(picker, 'search').fill('100');
  await picker.locator('[data-picker-item="100"]').check();
  await field(picker, 'category').selectOption('คณิตศาสตร์');
  assert.equal(await picker.locator('[data-picker-item]').count(), 0);
  await field(picker, 'category').selectOption('');
  assert.equal(await picker.locator('[data-picker-item="100"]').isChecked(), true);
  await page.locator('#codeTab-worksheets').click();
  await field(wsPicker, 'search').fill('012');
  await wsPicker.locator('[data-picker-item="12"]').check();
  await save();
  assert.deepEqual([...lastSaved.app_ids].sort((a,b) => a-b), [1,65,100,101,999]);
  assert.deepEqual([...lastSaved.worksheet_ids].sort((a,b) => a-b), [1,10,12,888]);
  assert.equal(lastSaved.expires_at, originalExpiry, 'Untouched expiry retains its original timezone and seconds');

  // New code: selecting every current item must not silently grant future items.
  await edit(null);
  assert.equal(await page.locator('#codeTab-info').getAttribute('aria-selected'), 'true');
  await page.locator('#cCode').fill('NEW100');
  await page.locator('#cLabel').fill('ทุกแอปปัจจุบัน');
  await page.locator('#codeTab-apps').click();
  await field(picker, 'tier').selectOption('free');
  assert.equal(await picker.locator('[data-picker-item="101"]').isDisabled(), true);
  assert.match(await picker.innerText(), /ไม่ต้องใช้รหัส/);
  assert.equal(await field(picker, 'bulk').isDisabled(), true);
  await field(picker, 'tier').selectOption('');
  await field(picker, 'bulk').click();
  assert.equal(await field(picker, 'vip').isChecked(), false);
  assert.match(await field(picker, 'count').innerText(), /100 \/ 101/);
  await page.locator('#codeTab-worksheets').click();
  await field(wsPicker, 'unselected').click();
  await field(wsPicker, 'tier').selectOption('free');
  assert.equal(await wsPicker.locator('[data-picker-item="13"]').isDisabled(), true);
  assert.equal(await field(wsPicker, 'bulk').isDisabled(), true);
  await field(wsPicker, 'tier').selectOption('premium');
  await field(wsPicker, 'bulk').click();
  assert.equal(await wsPicker.locator('[data-picker-item]').count(), 0);
  await field(wsPicker, 'selected').click();
  assert.equal(await wsPicker.locator('[data-picker-item]:checked').count(), 6);
  await save();
  assert.equal(lastSaved.app_ids.length, 100);
  assert.equal(lastSaved.worksheet_ids.length, 12);
  assert.equal(lastSaved.app_ids.includes('all'), false);
  assert.equal(lastSaved.active, true);

  // Bulk selection applies only to the matching results, including the selected-only view.
  await edit(3);
  assert.match(await field(picker, 'count').innerText(), /0 \/ 101/);
  await field(picker, 'search').fill('090');
  await field(picker, 'category').selectOption('คณิตศาสตร์');
  assert.equal(await field(picker, 'bulk').isDisabled(), true);
  await field(picker, 'category').selectOption('ภาษาอังกฤษ');
  await field(picker, 'bulk').click();
  await field(picker, 'search').fill('');
  await field(picker, 'selected').click();
  assert.equal(await picker.locator('[data-picker-item]').count(), 1);
  assert.equal(await picker.locator('[data-picker-item="90"]').isChecked(), true);
  await save();
  assert.deepEqual(lastSaved.app_ids, [90]);

  // Existing VIP still serializes as ['all']; opt-out becomes a fixed current list.
  await edit(2);
  assert.equal(await field(picker, 'vip').isChecked(), true);
  assert.equal(await picker.locator('[data-picker-item]:enabled').count(), 0);
  await save();
  assert.deepEqual(lastSaved.app_ids, ['all']);
  assert.deepEqual(lastSaved.worksheet_ids, ['all']);
  await edit(2);
  await field(picker, 'vip').uncheck();
  await save();
  assert.equal(lastSaved.app_ids.length, 100);
  assert.deepEqual(lastSaved.worksheet_ids, ['all']);

  // VIP can be toggled temporarily without losing the prior manual selection.
  await edit(1);
  await field(picker, 'vip').check();
  await field(picker, 'vip').uncheck();
  assert.match(await field(picker, 'count').innerText(), /5 \/ 102/);
  failSave=true;
  await page.locator('#cSave').click();
  await page.waitForFunction(() => document.getElementById('cSave')?.disabled === false);
  assert.match(await page.locator('#toast').innerText(), /Fixture save failure/);
  assert.equal(await page.evaluate(() => window._codeModalState.apps.selected.size), 5);
  await save();
  assert.deepEqual([...lastSaved.app_ids].sort((a,b) => a-b), [1,65,100,101,999]);

  // A failed worksheet request must never open a form with empty replacement permissions.
  failWorksheets=true;
  await page.evaluate(() => openCodeModal(1));
  assert.equal(await page.locator('#cSave').count(), 0);
  assert.match(await page.locator('#toast').innerText(), /Fixture unavailable/);
  failWorksheets=false;

  // Layout remains within the viewport with a reachable footer on small/short screens.
  await edit(1);
  const outputDirectory = process.env.ADMIN_CODES_SCREENSHOT_DIR;
  if (outputDirectory) {
    await mkdir(outputDirectory, {recursive:true});
    await page.locator('.code-modal').screenshot({path:join(outputDirectory, 'admin-codes-desktop.png')});
    await page.evaluate(() => closeModal());
    await page.locator('#content').screenshot({path:join(outputDirectory, 'admin-codes-table.png')});
    await edit(1);
  }
  for (const viewport of [{width:375,height:812},{width:320,height:568},{width:1024,height:500}]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('.code-modal').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
    const footer = await page.locator('.code-modal .modal-footer').boundingBox();
    assert.ok(footer.y + footer.height <= viewport.height + 1, 'Save actions must remain visible');
    assert.equal(await page.locator('.code-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  }
  await page.setViewportSize({width:375,height:812});
  if (outputDirectory) await page.screenshot({path:join(outputDirectory, 'admin-codes-mobile.png')});
  await page.evaluate(() => closeModal());
  apps.length=0; worksheets.length=0;
  await edit(null);
  await page.locator('#cCode').fill('FUTURE01');
  await page.locator('#cLabel').fill('VIP สำหรับรายการใหม่');
  await page.locator('#codeTab-apps').click();
  assert.match(await picker.innerText(), /ยังไม่มีแอปในระบบ/);
  assert.equal(await field(picker, 'bulk').isDisabled(), true);
  await field(picker, 'vip').check();
  await save();
  assert.deepEqual(lastSaved.app_ids, ['all']);
  assert.deepEqual(lastSaved.worksheet_ids, []);
  assert.equal(await page.evaluate(() => window.codeTestXss), undefined);
  assert.deepEqual(errors, []);
  console.log('PASS: 100-app summaries; selected/unselected and free/premium/VIP filters combined with search/categories/pages; preserved permissions and expiry; API failures; desktop/mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
