// functions/article/[id].js
// SSR หน้าบทความ — เสิร์ฟ HTML จริงให้ Googlebot/Facebook/LINE crawler
// URL: https://kru-ti.com/article/1 (รับทั้ง id ตัวเลข และ slug)
// ผู้ใช้จริงอ่านหน้านี้ได้เลย หรือกดกลับไปเว็บหลัก (SPA) ก็ได้

import { SHELL_CSS } from '../_shell-css.js';

// โดเมนหลัก — ใช้กับ canonical/og/JSON-LD เท่านั้น ห้ามใช้ origin ของ request
// ไม่งั้นถ้า crawler เจอหน้านี้ผ่าน eduapps-th.pages.dev มันจะเห็น canonical ชี้กลับ
// pages.dev เอง กลายเป็นสำเนาที่แข่ง SEO กับ kru-ti.com
const SITE = 'https://kru-ti.com';

export async function onRequest({ params, env, request }) {
  const idOrSlug = decodeURIComponent(params.id || '');
  const BASE = new URL(request.url).origin;   // ใช้กับลิงก์นำทางในหน้า (คงโดเมนที่ผู้ใช้เปิดอยู่)

  // ── lookup: id ตัวเลข หรือ slug ──
  const isNumeric = /^\d+$/.test(idOrSlug);
  const col = isNumeric ? 'id' : 'slug';
  let art = null;
  try {
    const { results } = await env.DB
      .prepare(`SELECT * FROM articles WHERE ${col}=? AND published=1`)
      .bind(idOrSlug).all();
    art = results[0] || null;
    // ไม่นับวิวตรงนี้ — ย้ายไปนับที่ trackHTML() ท้ายหน้าเหมือนหน้าแอปและใบงาน
    // เดิมนับฝั่งเซิร์ฟเวอร์ ซึ่งนับ Googlebot/ตัวดึงรูปพรีวิวของ LINE/Facebook ปนมาด้วย
    // และไม่มีการกันนับซ้ำ (กด F5 = +1 ทุกครั้ง) ตัวเลขจึงสูงกว่าคนอ่านจริงมาก
  } catch (e) { /* DB error → 404 ด้านล่าง */ }

  // ── บทความที่เกี่ยวข้อง: หมวดเดียวกัน 3 ชิ้น ──
  let related = [];
  if (art) {
    try {
      const { results } = await env.DB
        .prepare(`SELECT id, title, category, excerpt, created_at FROM articles
                  WHERE published=1 AND id != ?
                  ORDER BY (category = ?) DESC, created_at DESC
                  LIMIT 3`)
        .bind(art.id, art.category || '').all();
      related = results || [];
    } catch (e) { /* related เป็นของเสริม */ }
  }

  if (!art) {
    return new Response(page404(BASE), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const esc = s => String(s ?? '').replace(/[&<>"]/g,
    m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

  // เพิ่ม lazy loading ให้รูปในเนื้อหา (cover อยู่ above-fold จึงไม่ lazy)
  const addLazy = html => String(html || '').replace(/<img\s+([^>]*?)>/gi, (m, a) => {
    if (!/loading\s*=/i.test(a)) a += ' loading="lazy"';
    if (!/decoding\s*=/i.test(a)) a += ' decoding="async"';
    return `<img ${a}>`;
  });

  const title    = esc(art.title);
  const excerpt  = esc(art.excerpt || art.title);
  const author   = esc(art.author_name || 'Kru-ti ครูติ');
  const canon    = `${SITE}/article/${art.id}`;
  const img      = art.image_url || `${SITE}/og-image.png`; // สำหรับ og:image/JSON-LD เท่านั้น
  // รูปที่โชว์บนหน้าจริง — ต้องแยกจาก img ข้างบน 2 เหตุผล
  //   1. ถ้าบทความไม่มีรูปปก img จะเป็นรูปแบรนด์ ซึ่งเอามาแปะหัวบทความไม่ได้
  //      (บทความ 12/13 เคยขึ้นแบนเนอร์ og-image.png เป็นรูปปกอยู่พักหนึ่ง)
  //   2. ผู้เขียนบางคนวางรูปปกซ้ำในเนื้อหาด้วย จะได้ไม่โชว์ซ้ำสองใบติดกัน
  const cover    = (art.image_url && !String(art.content || '').includes(art.image_url))
                   ? art.image_url : '';
  const dateISO  = (art.created_at || '').replace(' ', 'T');
  const dateThai = fmtThai(art.created_at);

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: art.title,
    description: art.excerpt || '',
    image: img ? [img] : [],
    datePublished: dateISO,
    dateModified: (art.updated_at || art.created_at || '').replace(' ', 'T'),
    author: { '@type': 'Person', name: art.author_name || 'Kru-ti ครูติ', url: `${SITE}/about` },
    publisher: {
      '@type': 'Organization',
      name: 'Kru-ti ครูติ TH',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canon },
  }).replace(/</g, '\\u003c'); // กัน </script> breakout ใน JSON-LD

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Kru-ti ครูติ TH</title>
<meta name="description" content="${excerpt}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="${title} — Kru-ti ครูติ TH">
<meta property="og:description" content="${excerpt}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canon}">
<meta property="og:site_name" content="Kru-ti ครูติ TH">
${img ? `<meta property="og:image" content="${esc(img)}">` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta property="article:published_time" content="${dateISO}">
<meta property="article:author" content="${author}">
<script type="application/ld+json">${jsonld}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@500;600;700&family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav>
  <a class="logo" href="${BASE}/"><span class="logo-mark">✦</span>Kru-ti ครูติ <em>TH</em></a>
  <div class="nav-links">
    <a href="${BASE}/">หน้าหลัก</a>
    <a href="${BASE}/blog">บทความ</a>
    <a href="${BASE}/apps">แอปทั้งหมด</a>
    <a href="${BASE}/worksheets">ใบงาน</a>
    <a href="${BASE}/buy">ซื้อรหัส</a>
  </div>
  <div class="nav-right"></div>
</nav>
<main class="art-wrap">
  <a class="back" href="${BASE}/blog">← บทความทั้งหมด</a>
  <h1>${title}</h1>
  <div class="art-info">
    <span class="cat">${esc(art.category || '')}</span>
    <span>📅 ${dateThai}</span>
    <span>✍️ ${author}</span>
  </div>
  ${cover ? `<img class="cover" src="${esc(cover)}" alt="${title}">` : ''}
  <div class="art-body">${addLazy(art.content || '')}</div>
  <div class="share">
    <strong>แชร์:</strong>
    <a href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(canon)}" target="_blank" rel="noopener">💬 LINE</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canon)}" target="_blank" rel="noopener">📘 Facebook</a>
  </div>
  ${related.length ? `
  <div class="related">
    <h2 class="rel-head">บทความที่เกี่ยวข้อง</h2>
    ${related.map(r => `
    <a class="rel-card" href="${BASE}/article/${r.id}">
      <span class="rel-cat">${esc(r.category || '')}</span>
      <span class="rel-title">${esc(r.title)}</span>
      <span class="rel-date">${fmtThai(r.created_at)}</span>
    </a>`).join('')}
  </div>` : ''}
  <div class="more">
    <a href="${BASE}/blog">อ่านบทความอื่น →</a>
    <a href="${BASE}/apps">ดูแอปการสอนทั้งหมด →</a>
  </div>
</main>
<footer>
  <a href="${BASE}/">Kru-ti ครูติ TH</a> — แอปการสอนและบทความ เพื่อครูไทย · © 2568
</footer>
${trackHTML('/article/' + art.id)}
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // cache 5 นาที
    },
  });
}

// เก็บสถิติแบบเดียวกับหน้าเว็บหลัก — ใช้ visitor id ตัวเดียวกัน (localStorage '_vid')
// ไม่งั้นคนที่สลับไปมาระหว่างหน้า SSR กับ SPA จะถูกนับเป็นคนละคน
// และถ้าไม่มีบรรทัดนี้ คนที่มาจาก Google จะไม่ปรากฏใน Dashboard เลย
// (สำเนาเดียวกับใน apps/[id].js และ worksheet/[id].js — แก้ที่ไหนต้องแก้ให้ครบทั้งสามที่)
function trackHTML(path) {
  return '<script>(function(){var P=' + JSON.stringify(path) + ';'
    + 'function s(v){try{var b=JSON.stringify({path:P,visitor_id:v});'
    + 'if(navigator.sendBeacon)navigator.sendBeacon("/api/track",new Blob([b],{type:"application/json"}));'
    + 'else fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},body:b,keepalive:true}).catch(function(){});}catch(e){}}'
    + 'try{var v=localStorage.getItem("_vid"),t=+localStorage.getItem("_vid_ts")||0;'
    + 'if(v&&(Date.now()-t)<2592000000)return s(v);'
    + 'var f=[navigator.userAgent,screen.width+"x"+screen.height,Intl.DateTimeFormat().resolvedOptions().timeZone,navigator.language].join("|");'
    + 'crypto.subtle.digest("SHA-256",new TextEncoder().encode(f)).then(function(b){'
    + 'var n=Array.from(new Uint8Array(b)).slice(0,8).map(function(x){return x.toString(16).padStart(2,"0")}).join("");'
    + 'localStorage.setItem("_vid",n);localStorage.setItem("_vid_ts",Date.now());s(n)}).catch(function(){'
    + 'var n=Math.random().toString(36).slice(2,18);localStorage.setItem("_vid",n);localStorage.setItem("_vid_ts",Date.now());s(n)});'
    + '}catch(e){}})();<\/script>';
}

// ── helpers ──────────────────────────────────────────────
function fmtThai(d) {
  if (!d) return '';
  try {
    return new Date(d.replace(' ', 'T')).toLocaleDateString('th-TH',
      { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}

function page404(BASE) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ไม่พบบทความ — Kru-ti ครูติ TH</title>
<meta name="robots" content="noindex">
<style>${CSS}
.nf{text-align:center;padding:80px 20px;}
.nf h1{font-size:1.6rem;margin:14px 0;}
.nf a{display:inline-block;margin-top:18px;background:#f3ac2e;color:#101c33;padding:12px 26px;border-radius:12px;font-weight:700;text-decoration:none;}</style>
</head><body>
<main class="nf"><div style="font-size:3rem;">📭</div><h1>ไม่พบบทความนี้</h1>
<p>บทความอาจถูกลบหรือยังไม่เผยแพร่</p>
<a href="${BASE}/">กลับหน้าหลัก</a></main>
</body></html>`;
}

// CSS ย่อจากธีมเว็บหลัก "กระดานดำ & ดาวทอง" — เฉพาะที่หน้าบทความใช้
// เปลือก (แถบเมนู ปุ่มย้อนกลับ ป้ายหมวด ตัวแปรสี) อยู่ที่ functions/_shell-css.js ใช้ร่วมกับ
// หน้าแอปและใบงาน — แก้ที่นั่นที่เดียวแล้วได้ผลทั้ง 3 หน้า
const CSS = SHELL_CSS + `
h1,h2,h3{font-family:'Pridi',serif;font-weight:600;line-height:1.4;}
/* ตัวถ่วงฝั่งขวา — nav ใช้ space-between ถ้ามีแค่ logo กับ nav-links เมนูจะถูกดันไปชิดขวา
   ไม่ตรงกับเว็บหลักที่มีปุ่มค้นหาคั่นอยู่ทำให้เมนูอยู่กลาง (หน้านี้ไม่มีปุ่มค้นหาเพราะต้องใช้ JS) */
.nav-right{width:104px;flex-shrink:0;}
/* จอแคบ: เก็บตัวถ่วงทิ้งเพื่อคืนที่ให้เมนู แต่ **ไม่ซ่อนเมนู** — เดิมซ่อนที่ 820px
   ทำให้คนที่เข้าบทความจากมือถือไม่เหลือลิงก์ไปหน้าอื่นเลย (หน้าแอป/ใบงานเลื่อนเมนูได้มาตลอด) */
@media(max-width:820px){.nav-right{display:none;}}
/* ความกว้างต้องเท่ากับ .art-wrap ใน public/app.css ไม่งั้นบทความเดียวกันบรรทัดตัดคนละที่ */
.art-wrap{max-width:820px;margin:0 auto;padding:42px 22px;}
.art-wrap h1{font-size:clamp(1.6rem,3.4vw,2.15rem);font-weight:700;line-height:1.42;margin-bottom:16px;}
.art-info{display:flex;gap:13px;align-items:center;flex-wrap:wrap;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--line);font-size:.85rem;color:var(--slate);}
.cover{width:100%;border-radius:14px;margin-bottom:24px;}
.art-body h2{font-size:1.42rem;font-weight:600;margin:30px 0 11px;}
.art-body h3{font-size:1.14rem;font-weight:600;margin:22px 0 8px;}
.art-body p{margin-bottom:14px;line-height:1.95;font-size:1.04rem;}
.art-body ul,.art-body ol{margin:0 0 14px 22px;}
.art-body li{margin-bottom:6px;line-height:1.85;}
.art-body code{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f1ede4;padding:1px 7px;border-radius:5px;font-size:.86em;color:var(--gold-deep);}
.art-body pre{background:var(--ink);border-radius:12px;padding:16px 18px;margin:15px 0;overflow-x:auto;}
.art-body pre code{background:none;padding:0;font-size:.88rem;color:var(--chalk);}
.art-body blockquote{border-left:3px solid var(--gold);padding:12px 19px;margin:15px 0;background:var(--gold-soft);border-radius:0 11px 11px 0;color:var(--ink-soft);}
.art-body a{color:var(--mint);}
.art-body img{border-radius:11px;margin:13px 0;width:100%;max-width:100%;height:auto;display:block;}
/* ชุดนี้ต้องตรงกับ public/app.css และ .editor-body ใน public/admin/index.html (ดูหมายเหตุที่ app.css) */
.art-body .t-sm{font-size:.9rem;line-height:1.85;}
.art-body .t-lg{font-size:1.2rem;line-height:1.9;}
.art-body .t-xl{font-size:1.42rem;line-height:1.75;font-weight:600;}
.art-body img.w-75{width:75%;}
.art-body img.w-50{width:50%;}
.art-body img.w-auto{width:auto;}
.art-body img.a-l{margin-left:0;margin-right:auto;}
.art-body img.a-c{margin-left:auto;margin-right:auto;}
.art-body img.a-r{margin-left:auto;margin-right:0;}
.art-body table{width:100%;border-collapse:collapse;margin:15px 0;font-size:.92rem;}
.art-body th{text-align:left;padding:10px 12px;border-bottom:2px solid var(--line);font-weight:700;color:var(--ink-soft);}
.art-body td{padding:10px 12px;border-bottom:1px solid var(--line);}
.art-body strong{color:var(--ink);}
.share{margin-top:30px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:.9rem;}
.share a{border:1.5px solid var(--line);background:#fff;padding:7px 16px;border-radius:10px;text-decoration:none;color:var(--ink);font-weight:700;font-size:.84rem;}
.share a:hover{border-color:var(--gold);}
.related{margin-top:38px;padding-top:26px;border-top:1px solid var(--line);}
.rel-head{font-size:1.25rem;font-weight:600;margin-bottom:14px;position:relative;padding-left:16px;}
.rel-head::before{content:"";position:absolute;left:0;top:10%;bottom:10%;width:4px;border-radius:3px;background:linear-gradient(180deg,var(--gold),var(--gold-deep));}
.rel-card{display:block;background:#fff;border:1px solid var(--line);border-radius:13px;padding:15px 18px;margin-bottom:10px;text-decoration:none;color:var(--ink);transition:border-color .15s;}
.rel-card:hover{border-color:var(--gold);}
.rel-cat{display:inline-block;background:var(--gold-soft);color:var(--gold-deep);padding:2px 11px;border-radius:100px;font-size:.71rem;font-weight:700;margin-bottom:6px;}
.rel-title{display:block;font-family:'Pridi',serif;font-size:1.02rem;font-weight:600;line-height:1.5;}
.rel-date{display:block;font-size:.78rem;color:var(--slate);margin-top:5px;}
.more{margin-top:26px;padding-top:22px;border-top:1px solid var(--line);display:flex;gap:20px;flex-wrap:wrap;}
.more a{color:var(--gold-deep);font-weight:700;font-size:.92rem;text-decoration:none;}
/* ⚠️ selector footer เปล่า ๆ โดนแท็ก <footer> ที่ผู้เขียนใส่ไว้ในเนื้อบทความด้วย
   (ใช้ทำกล่องเน้นสีเข้ม เช่น "แหล่งข้อมูลประกอบ") — ต้องให้ตรงกับกฎ footer ใน
   public/app.css เป๊ะ ๆ ไม่งั้นบทความเดียวกันหน้าตาไม่เหมือนกันระหว่างเข้าจากในเว็บ
   (SPA) กับกด F5 (หน้านี้) เดิมกฎนี้มี text-align:center ติดมาด้วย กล่องในบทความ
   เลยจัดกึ่งกลางเฉพาะตอนกด F5 */
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:38px 26px 30px;
  margin-top:48px;position:relative;overflow:hidden;}
footer::before{content:"✦";position:absolute;right:-40px;bottom:-80px;font-size:10rem;
  color:rgba(243,172,46,.08);pointer-events:none;line-height:1;}
/* ท้ายหน้าจริงเท่านั้น — ห้ามย้ายสองบรรทัดนี้ไปไว้ที่ selector footer เปล่า */
body>footer{text-align:center;font-size:.85rem;padding:24px 22px;}
`;
