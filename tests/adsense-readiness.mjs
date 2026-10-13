// Run against an isolated local Pages/D1 instance, never production.
// Fixture: ten published articles titled SSR fixture 01..10 plus one draft.
import assert from 'node:assert/strict';
import { aboutContent, privacyContent } from '../public/info-pages.mjs';
import { renderContentPage } from '../functions/_content-pages.js';
import fs from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:8792';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Use an isolated local fixture database for this test.');
}
const get = async path => {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  return { response, html: await response.text() };
};
const main = html => html.match(/<main id="app"[^>]*>([\s\S]*?)<\/main>/)?.[1] || '';

for (const path of ['/', '/blog', '/about', '/privacy']) {
  const { html, response } = await get(path);
  assert.match(html, /data-server-rendered="true"/);
  assert.ok(main(html).length > 200, path + ' must contain initial readable HTML');
  assert.doesNotMatch(main(html), /กำลังโหลด/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(html, /SSR fixture draft/);
}
const { html: blog } = await get('/blog');
assert.equal((main(blog).match(/class="art-card"/g) || []).length, 9);
assert.match(main(blog), /href="\/blog\?page=2"/);
const { html: second } = await get('/blog?page=2');
assert.equal((main(second).match(/class="art-card"/g) || []).length, 1);
assert.match(second, /id="canonical" href="https:\/\/kru-ti.com\/blog\?page=2"/);
const { html: negative } = await get('/blog?page=-1');
assert.equal((main(negative).match(/class="art-card"/g) || []).length, 9);
const { html: filtered } = await get('/blog?q=fixture%2010');
assert.equal((main(filtered).match(/class="art-card"/g) || []).length, 1);
const { html: hostile } = await get('/blog?q=' + encodeURIComponent('"><script>alert(1)</script>'));
assert.doesNotMatch(main(hostile), /<script>alert/);
assert.match(main(hostile), /&quot;&gt;&lt;script&gt;/);

const { html: ads, response: adsResponse } = await get('/ads.txt');
assert.equal(ads.trim(), 'google.com, pub-2993021281914259, DIRECT, f08c47fec0942fa0');
assert.match(adsResponse.headers.get('content-type'), /text\/plain/);
const { html: sitemap } = await get('/sitemap.xml');
for (const path of ['/blog', '/about', '/privacy']) assert.ok(sitemap.includes('https://kru-ti.com' + path));
assert.doesNotMatch(sitemap, /\/article\/11</);
const { html: privacy } = await get('/privacy');
assert.match(main(privacy), /localStorage/);
assert.match(main(privacy), /พันธมิตร/);
assert.doesNotMatch(main(privacy), /Google Analytics Opt-out/);
const malicious = '</script><img src=x onerror=alert(1)> $&';
assert.doesNotMatch(aboutContent({ site_title: malicious, author_name: malicious }), /<img src=x/);
assert.doesNotMatch(privacyContent({ site_title: malicious }), /<img src=x/);
assert.ok(aboutContent({ site_title: malicious }).includes('$&'));

const shell = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const oldError = console.error;
console.error = () => {};
try {
  const response = await renderContentPage({
    request: new Request(base + '/blog'),
    env: {
      ASSETS: { fetch: async () => new Response(shell, { headers: { ETag: 'stale', 'Content-Length': '1' } }) },
      DB: { prepare() { throw new Error('Database unavailable'); } },
    },
  }, 'blog');
  assert.equal(response.status, 503, 'Database failure must not become a successful empty page');
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('content-length'), null);
} finally { console.error = oldError; }
const head = await fetch(base + '/privacy', { method: 'HEAD' });
assert.equal(head.status, 200);
assert.equal(await head.text(), '');
console.log('Passed: initial HTML, publication filtering, pagination, search, escaping, metadata, ads.txt, privacy, sitemap, HEAD and database failure.');
