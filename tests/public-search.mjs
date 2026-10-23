// Browser regression tests with local fixtures; never uses production credentials/data.
// node tests/public-search.mjs (PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_CHANNEL supported).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const items = ['คณิตศาสตร์','ภาษาไทย'].map((subject,index) => ({
  id:index + 1, title:subject, category:subject, category_id:1, description:subject,
  excerpt:subject, slug:'article-' + index, created_at:'2026-10-01 00:00:00',
  locked:index === 0 ? 1 : 0, visible:1, icon:'📝', url:'https://example.test/app', pages:1,
}));
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      let result = {}, status = 200;
      if (url.pathname === '/api/settings') result = {site_title:'Kru-ti ครูติ TH',article_categories:'[]'};
      else if (url.pathname === '/api/apps') result = {apps:items};
      else if (url.pathname === '/api/worksheets') result = {worksheets:items};
      else if (url.pathname === '/api/articles') {
        const q = url.searchParams.get('q') || '';
        const articles = items.filter(item => item.title.includes(q));
        result = {articles,total:articles.length};
      } else if (url.pathname === '/api/exam-apps') result = {apps:items};
      else if (url.pathname === '/api/exam-apps/categories') result = {categories:[{id:1,name:'รวมวิชา',icon:'📚'}]};
      else if (url.pathname === '/api/apps/1/unlock') {
        let body = ''; for await (const chunk of req) body += chunk;
        if (JSON.parse(body).code === 'GOOD') result = {url:'https://example.test/app'};
        else { status = 403; result = {error:'รหัสไม่ถูกต้อง'}; }
      }
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify(result));
      return;
    }
    const path = ['/', '/apps', '/worksheets', '/exam-apps', '/blog'].includes(url.pathname) ? '/index.html' : url.pathname;
    if (!/^\/(?:index\.html|app\.(?:js|css)|exam-pages\.mjs|info-pages\.mjs|icon-192\.png)$/.test(path)) {
      res.writeHead(404); res.end(); return;
    }
    const body = await readFile(new URL('../public' + path,import.meta.url));
    const type = path.endsWith('.html') ? 'text/html; charset=utf-8' : /\.(?:mjs|js)$/.test(path) ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'image/png';
    res.writeHead(200,{'Content-Type':type}); res.end(body);
  } catch (error) { res.writeHead(500); res.end(error.stack); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const output = new URL('../.wrangler/public-search-test/',import.meta.url);
await mkdir(output,{recursive:true});
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.route('https://**/*',route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  const cases = [
    ['/apps','#appSearch','.app-card'],
    ['/worksheets','#wsSearch','.ws-card'],
    ['/exam-apps','#examSearch','.exam-card'],
    ['/blog','#blogSearch','.art-card'],
  ];
  const submit = async selector => {
    if (selector === '#blogSearch') {
      await page.locator(selector).press('Enter');
      await page.waitForFunction(() => document.querySelector('#blogSearch')?.value === 'ภาษาไทย');
      await page.locator('.art-card').filter({hasText:'ภาษาไทย'}).waitFor();
    }
  };
  for (const [path,selector,cards] of cases) {
    await page.goto(base + path);
    const input = page.locator(selector);
    await input.waitFor();
    assert.equal(await page.locator('input[type=password]').count(),0,'closed unlock dialog must not resemble a login form');
    assert.equal(await input.evaluate(el => el.form?.getAttribute('autocomplete')),'off');
    assert.equal(await page.locator(cards).count(),2);
    // Covers both plain events and extensions that imitate beforeinput/InputEvent.
    for (const kind of ['plain','typed','silent']) {
      await input.evaluate((el,kind) => {
        el.value = 'saved-credential';
        if (kind === 'plain') el.dispatchEvent(new Event('input',{bubbles:true}));
        if (kind === 'typed') {
          el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:'saved-credential'}));
          el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'saved-credential'}));
        }
      },kind);
      await page.waitForFunction(selector => document.querySelector(selector).value === '',selector);
      assert.equal(await page.locator(cards).count(),2);
    }
    // Native autofill events are trusted; its pseudo-state must still be rejected.
    const client = await context.newCDPSession(page);
    await client.send('DOM.enable'); await client.send('CSS.enable');
    const {root} = await client.send('DOM.getDocument');
    const {nodeId} = await client.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    await client.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['autofill']});
    await input.fill('saved-credential');
    assert.equal(await input.inputValue(),'');
    await client.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    await client.detach();
    // Real paste, typing, selection replacement and undo must remain usable.
    await input.click();
    await page.evaluate(() => navigator.clipboard.writeText('ภาษาไทย'));
    await input.press('ControlOrMeta+V');
    assert.equal(await input.inputValue(),'ภาษาไทย');
    await input.press('ControlOrMeta+Z');
    assert.equal(await input.inputValue(),'');
    await input.pressSequentially('ภาษาไทย');
    await submit(selector);
    assert.equal(await page.locator(cards).count(),1);
    await input.evaluate(el => { el.value = 'saved-credential'; });
    await page.waitForFunction(selector => document.querySelector(selector).value === 'ภาษาไทย',selector);
    assert.equal(await page.locator(cards).count(),1);
    if (selector === '#appSearch') {
      await page.locator('.fx-chip button').click();
      assert.equal(await input.inputValue(),'');
      assert.equal(await page.locator(cards).count(),2);
    }
    await page.reload();
    await input.waitFor();
    assert.equal(await input.inputValue(),selector === '#blogSearch' ? 'ภาษาไทย' : '');
    if (selector === '#blogSearch') {
      await page.goto(base + '/blog'); await input.waitFor();
    }
    // SPA navigation starts the destination with its own search state.
    await page.locator('.nav-links a[href="/apps"]').click();
    await page.locator('#appSearch').waitFor();
    assert.equal(await page.locator('#appSearch').inputValue(),'');
  }
  // The access code is created only while the dialog is open, in its own form.
  await page.evaluate(() => openLockModal(1,'คณิตศาสตร์','📝'));
  await page.locator('#lockInput').fill('WRONG');
  assert.equal(await page.locator('#lockInput').evaluate(el => el.form.id),'appUnlockForm');
  await page.locator('#lockInput').press('Enter');
  await page.locator('#lockErr').waitFor({state:'visible'});
  await page.locator('#lockInput').fill('GOOD');
  await page.locator('#lockInput').press('Enter');
  await page.locator('#appViewer').waitFor({state:'visible'});
  assert.equal(await page.locator('#lockInput').count(),0);
  await page.evaluate(() => { closeAppViewer(); openLockModal(1,'คณิตศาสตร์','📝'); });
  assert.equal(await page.locator('#lockInput').inputValue(),'');
  await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
  assert.equal(await page.locator('input[type=password]').count(),0);
  await page.evaluate(() => Promise.all(document.getElementById('app').getAnimations({subtree:true}).map(animation => animation.finished)));
  await page.screenshot({path:fileURLToPath(new URL('apps-desktop.png',output))});
  const mobile = await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  await mobile.route('https://**/*',route => route.abort());
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror',error => errors.push(error.message));
  for (const [path,selector,cards] of cases) {
    await touchPage.goto(base + path);
    const input = touchPage.locator(selector);
    await input.tap();
    const client = await mobile.newCDPSession(touchPage);
    await client.send('Input.imeSetComposition',{text:'ภาษาไทย',selectionStart:7,selectionEnd:7});
    await client.send('Input.insertText',{text:'ภาษาไทย'});
    await client.detach();
    assert.equal(await input.inputValue(),'ภาษาไทย');
    if (selector === '#blogSearch') {
      await input.press('Enter');
      await touchPage.locator('.art-card').filter({hasText:'ภาษาไทย'}).waitFor();
    }
    assert.equal(await touchPage.locator(cards).count(),1);
    assert.ok(await touchPage.locator('.container').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  }
  await touchPage.evaluate(() => Promise.all(document.getElementById('app').getAnimations({subtree:true}).map(animation => animation.finished)));
  await touchPage.screenshot({path:fileURLToPath(new URL('blog-mobile.png',output))});
  assert.deepEqual(errors,[]);
  console.log('PASS: all public searches reject native/scripted/silent autofill; real Thai typing, clipboard paste, undo, IME, reload/SPA navigation, touch layout and isolated password unlock work.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
