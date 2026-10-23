import { EXAM_PUBLIC_COLUMNS } from './_exam-apps.js';
import { examListHTML, examDetailHTML, examEscape as esc } from '../public/exam-pages.mjs';

export async function renderExamPage({request,env,params}) {
  const url = new URL(request.url);
  const assetURL = new URL('/',url);
  const asset = await env.ASSETS.fetch(new Request(assetURL));
  if (!asset.ok) return asset;
  let html = await asset.text(), content, title = 'แอปข้อสอบ', status = 200;
  let description = 'รวมเว็บแอปข้อสอบ แยกตามวิชา เปิดใช้งานได้ทันที';
  try {
    if (params?.id && !/^\d+$/.test(params.id)) {
      status = 404;
    } else if (url.pathname.includes('/category/')) {
      const category = await env.DB.prepare('SELECT * FROM exam_categories WHERE id=?').bind(params.id).first();
      if (!category) status = 404;
      else {
        const {results} = await env.DB.prepare(`SELECT ${EXAM_PUBLIC_COLUMNS} FROM exam_apps a JOIN exam_categories c ON c.id=a.category_id WHERE a.visible=1 AND a.category_id=? ORDER BY a.sort_order,a.id DESC`).bind(category.id).all();
        title = `ข้อสอบวิชา${category.name}`;
        description = category.description || title;
        content = examListHTML(results,[category],category);
      }
    } else if (params?.id) {
      const app = await env.DB.prepare(`SELECT ${EXAM_PUBLIC_COLUMNS} FROM exam_apps a JOIN exam_categories c ON c.id=a.category_id WHERE a.visible=1 AND a.id=?`).bind(params.id).first();
      if (!app) status = 404;
      else { title = app.title; description = app.description || title; content = examDetailHTML(app); }
    } else {
      const [apps,categories] = await Promise.all([
        env.DB.prepare(`SELECT ${EXAM_PUBLIC_COLUMNS} FROM exam_apps a JOIN exam_categories c ON c.id=a.category_id WHERE a.visible=1 ORDER BY c.sort_order,c.id,a.sort_order,a.id DESC`).all(),
        env.DB.prepare('SELECT * FROM exam_categories ORDER BY sort_order,id').all(),
      ]);
      content = examListHTML(apps.results,categories.results);
    }
  } catch (error) {
    console.error('Exam pages unavailable:',error);
    status = 503;
    content = '<div class="container exam-page"><h1>โหลดแอปข้อสอบไม่สำเร็จ</h1><p>กรุณาลองใหม่อีกครั้ง</p></div>';
  }
  if (status === 404) { title = 'ไม่พบหน้าแอปข้อสอบ'; content = '<div class="container exam-page"><h1>ไม่พบหน้านี้</h1><a href="/exam-apps">กลับไปแอปข้อสอบ</a></div>'; }
  const canonical = 'https://kru-ti.com' + url.pathname.replace(/\/+$/,'');
  const fullTitle = title + ' — Kru-ti ครูติ TH';
  html = html.replace(/<main id="app">[\s\S]*?<\/main>/,() => `<main id="app" data-server-rendered="true">${content}</main>`)
    .replace(/<title id="pageTitle">[\s\S]*?<\/title>/,() => `<title id="pageTitle">${esc(fullTitle)}</title>`)
    .replace(/<meta name="description" id="metaDesc"[^>]*>/,() => `<meta name="description" id="metaDesc" content="${esc(description)}">`)
    .replace(/<link rel="canonical" id="canonical"[^>]*>/,() => `<link rel="canonical" id="canonical" href="${esc(canonical)}">`)
    .replace(/<script type="application\/ld\+json" id="jsonld">[\s\S]*?<\/script>/,() => `<script type="application/ld+json" id="jsonld">${JSON.stringify({'@context':'https://schema.org','@type':'WebPage',name:fullTitle,url:canonical}).replace(/</g,'\\u003c')}</script>`)
    .replace('</head>',() => `<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">${status !== 200 ? '<meta name="robots" content="noindex">' : ''}</head>`);
  const headers = new Headers(asset.headers);
  for (const key of ['Content-Length','ETag','Last-Modified']) headers.delete(key);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','public, max-age=0, must-revalidate');
  if (status === 503) headers.set('Retry-After','60');
  return new Response(request.method === 'HEAD' ? null : html,{status,headers});
}
