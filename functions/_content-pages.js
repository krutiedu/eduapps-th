// Public HTML is rendered for every visitor; browser navigation uses the same shell.
import { aboutContent, privacyContent } from '../public/info-pages.mjs';

const SITE = 'https://kru-ti.com';
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pageNumber = value => Math.min(100000, Math.max(1, parseInt(value, 10) || 1));

async function publicSettings(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT key,value FROM settings WHERE key IN ('site_title','site_desc','site_tagline','author_name')"
    ).all();
    return Object.fromEntries(results.map(row => [row.key, row.value]));
  } catch (error) {
    console.error('Content page settings unavailable:', error);
    return {};
  }
}

async function articles(env, url, home) {
  const page = home ? 1 : pageNumber(url.searchParams.get('page'));
  const q = home ? '' : (url.searchParams.get('q') || '').slice(0, 200);
  const category = home ? '' : (url.searchParams.get('category') || '').slice(0, 100);
  let where = 'WHERE published=1';
  const args = [];
  if (category) { where += ' AND category=?'; args.push(category); }
  if (q) { where += ' AND (title LIKE ? OR excerpt LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  const [list, count] = await Promise.all([
    env.DB.prepare(`SELECT id,title,category,excerpt,image_url,created_at,pinned FROM articles ${where}
      ORDER BY (pinned > 0) DESC, pinned ASC, created_at DESC LIMIT ? OFFSET ?`)
      .bind(...args, 9, (page - 1) * 9).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM articles ${where}`).bind(...args).all(),
  ]);
  return { items: list.results, total: count.results[0]?.n || 0, page, q, category };
}

function articleCard(article) {
  const image = article.image_url && /^https?:\/\//i.test(article.image_url)
    ? `<div class="art-thumb"><img src="${esc(article.image_url)}" alt="" loading="lazy"></div>`
    : '<div class="art-thumb art-thumb-ph">✦</div>';
  const date = article.created_at
    ? new Date(article.created_at.replace(' ', 'T') + (article.created_at.includes('T') ? '' : 'Z'))
      .toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  return `<a class="art-card" href="/article/${Number(article.id)}">${image}<div class="ac-body">
    <div class="art-meta"><span class="tag tag-gen">${esc(article.category)}</span></div>
    <h3>${esc(article.title)}</h3><p>${esc(article.excerpt)}</p>
    <div class="art-date">📅 ${esc(date)}</div></div></a>`;
}

function listContent(data, settings, home) {
  const heading = home ? (settings.site_title || 'Kru-ti ครูติ TH') : 'บทความทั้งหมด';
  const description = home ? (settings.site_tagline || 'สื่อการสอน Interactive สำหรับครูและนักเรียนไทย')
    : 'เทคนิคการสอน ข่าวการศึกษา และเครื่องมือสำหรับครู';
  const linkForPage = page => {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    if (data.category) params.set('category', data.category);
    if (page > 1) params.set('page', page);
    return '/blog' + (params.size ? `?${params}` : '');
  };
  const pages = Math.ceil(data.total / 9);
  return `<div class="container" style="padding-bottom:32px;">
    <div class="page-head"><h1>${esc(heading)}</h1><p class="ph-sub">${esc(description)}</p></div>
    ${home ? `<p style="margin-bottom:24px;">เลือกอ่านบทความการศึกษา เปิดใช้แอปการสอน หรือค้นหาใบงานสำหรับห้องเรียนของคุณ</p>
      <p style="margin-bottom:28px;"><a class="btn btn-outline" href="/apps">คลังแอปการสอน</a>
      <a class="btn btn-outline" href="/worksheets">คลังใบงาน</a></p>
      <h2 class="sec-title" style="margin-bottom:22px;">บทความล่าสุด</h2>`
      : `<form class="search-row" action="/blog" method="get">
        <input class="search-in" name="q" aria-label="ค้นหาบทความ" placeholder="ค้นหาบทความ..." value="${esc(data.q)}">
        ${data.category ? `<input type="hidden" name="category" value="${esc(data.category)}">` : ''}
        <button class="btn btn-primary" type="submit">ค้นหา</button></form>`}
    ${data.items.length ? `<div class="arts-grid">${data.items.map(articleCard).join('')}</div>`
      : '<p class="empty">ไม่พบบทความ</p>'}
    ${home ? '<p style="margin-top:24px;"><a class="btn btn-outline" href="/blog">อ่านบทความทั้งหมด →</a></p>'
      : `<nav class="pagination" aria-label="หน้าบทความ">
        ${data.page > 1 ? `<a class="page-btn" href="${esc(linkForPage(data.page - 1))}">← ก่อนหน้า</a>` : ''}
        ${data.page < pages ? `<a class="page-btn" href="${esc(linkForPage(data.page + 1))}">ถัดไป →</a>` : ''}
      </nav>`}
  </div>`;
}

export async function renderContentPage(context, page) {
  const { request, env } = context;
  const url = new URL(request.url);
  // ASSETS bypasses Functions. Use the pretty path rather than index.html,
  // whose automatic redirect would otherwise return an empty shell.
  const assetURL = new URL('/', url);
  const asset = env.ASSETS ? await env.ASSETS.fetch(new Request(assetURL))
    : await context.next(new Request(assetURL));
  if (!asset.ok) return asset;
  let html = await asset.text();
  const settings = await publicSettings(env);
  const siteTitle = settings.site_title || 'Kru-ti ครูติ TH';
  let content, title, description, canonical, list, status = 200;
  if (page === 'about') {
    content = aboutContent(settings);
    title = 'เกี่ยวกับเรา';
    description = `${siteTitle} — แพลตฟอร์มสื่อการสอน Interactive สำหรับครูและนักเรียนไทย`;
    canonical = SITE + '/about';
  } else if (page === 'privacy') {
    content = privacyContent(settings);
    title = 'นโยบายความเป็นส่วนตัว';
    description = 'ข้อมูลที่เว็บไซต์เก็บรวบรวม การวิเคราะห์การใช้งาน และ Google AdSense';
    canonical = SITE + '/privacy';
  } else {
    const home = page === 'home';
    title = home ? '' : 'บทความทั้งหมด';
    description = home ? (settings.site_desc || settings.site_tagline || 'สื่อการสอนและบทความสำหรับครูไทย')
      : 'บทความเทคนิคการสอน ข่าวการศึกษา และเครื่องมือใหม่สำหรับครูไทย';
    canonical = SITE + (home ? '/' : '/blog');
    try {
      list = await articles(env, url, home);
      content = listContent(list, settings, home);
      if (!home) {
        const params = new URLSearchParams();
        if (list.q) params.set('q', list.q);
        if (list.category) params.set('category', list.category);
        if (list.page > 1) params.set('page', list.page);
        if (params.size) canonical += `?${params}`;
      }
    } catch (error) {
      console.error('Content page articles unavailable:', error);
      status = 503;
      content = '<div class="art-wrap"><h1>โหลดข้อมูลไม่สำเร็จ</h1><p>ระบบกำลังขัดข้อง กรุณาลองใหม่อีกครั้ง</p></div>';
    }
  }
  const fullTitle = title ? `${title} — ${siteTitle}` : siteTitle;
  const structured = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebPage', name: fullTitle, description, url: canonical,
  }).replace(/</g, '\\u003c');
  // Callbacks preserve literal dollar signs in text from settings/articles.
  html = html.replace(/<main id="app">[\s\S]*?<\/main>/,
    () => `<main id="app" data-server-rendered="true">${content}</main>`)
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/, () => `<title id="pageTitle">${esc(fullTitle)}</title>`)
    .replace(/<meta name="description" id="metaDesc"[^>]*>/,
      () => `<meta name="description" id="metaDesc" content="${esc(description)}">`)
    .replace(/<link rel="canonical" id="canonical"[^>]*>/,
      () => `<link rel="canonical" id="canonical" href="${esc(canonical)}">`)
    .replace(/<script type="application\/ld\+json" id="jsonld">[\s\S]*?<\/script>/,
      () => `<script type="application/ld+json" id="jsonld">${structured}</script>`)
    .replace(/<span class="ticker-text" id="tickerText">[\s\S]*?<\/span>/,
      () => `<span class="ticker-text" id="tickerText">${esc(list?.items.map(item => item.title).join('   ✦   ') || siteTitle)}</span>`)
    .replace('</head>', () => `<meta property="og:title" content="${esc(fullTitle)}">
      <meta property="og:description" content="${esc(description)}">
      <meta property="og:url" content="${esc(canonical)}"></head>`);
  const headers = new Headers(asset.headers);
  for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  if (status === 503) headers.set('Retry-After', '60');
  return new Response(request.method === 'HEAD' ? null : html, { status, headers });
}
