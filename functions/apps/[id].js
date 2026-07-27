// functions/apps/[id].js
// SSR หน้าแอปรายตัว — เสิร์ฟ HTML จริงให้ Googlebot/Facebook/LINE crawler
// URL: https://kru-ti.com/apps/12
//
// ทำไมต้องมี: หน้าแอปในเว็บหลักอยู่หลัง #/apps ซึ่ง search engine ไม่ index
// ครูที่ค้นหา "เกมคิดเลขเร็ว" จึงไม่มีทางเจอคลังแอปของเราเลย หน้านี้แก้เรื่องนั้น
//
// ⚠️ ห้ามใส่ app.url ลงใน HTML ถ้า locked=1 — นั่นคือของที่ขาย

const SITE = 'https://kru-ti.com';

export async function onRequest({ params, env, request }) {
  const id = decodeURIComponent(params.id || '');
  const BASE = new URL(request.url).origin;

  if (!/^\d+$/.test(id)) return notFound(BASE);

  let app = null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,icon,title,category,description,prompt,locked,is_vip,preview_image,created_at
       FROM apps WHERE id=? AND visible=1`
    ).bind(id).all();
    app = results[0] || null;
  } catch (e) { /* DB error → 404 */ }

  if (!app) return notFound(BASE);

  // แอปอื่นในหมวดเดียวกัน
  let related = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,icon,title,category,locked FROM apps
       WHERE visible=1 AND id != ?
       ORDER BY (category = ?) DESC, sort_order ASC, created_at ASC LIMIT 4`
    ).bind(app.id, app.category || '').all();
    related = results || [];
  } catch (e) { /* ของเสริม */ }

  const title = esc(app.title);
  const desc  = esc(app.description || `${app.title} — สื่อการสอนพร้อมใช้สำหรับครูไทย`);
  const canon = `${SITE}/apps/${app.id}`;
  const img   = app.preview_image || `${SITE}/og-image.png`;
  const isLocked = !!app.locked;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.title,
    description: app.description || '',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    url: canon,
    image: app.preview_image || `${SITE}/og-image.png`,
    inLanguage: 'th',
    publisher: {
      '@type': 'Organization',
      name: 'Kru-ti ครูติ TH',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
    },
  };
  // ระบุราคาเฉพาะแอปฟรี — แอปที่ล็อกต้องซื้อรหัส ไม่ประกาศราคาที่ไม่รู้
  if (!isLocked) ld.offers = { '@type': 'Offer', price: '0', priceCurrency: 'THB' };
  const jsonld = JSON.stringify(ld).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${title} — แอปการสอน | Kru-ti ครูติ TH</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="${title} — แอปการสอน">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canon}">
<meta property="og:site_name" content="Kru-ti ครูติ TH">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<script type="application/ld+json">${jsonld}</script>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@600;700&family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${navHTML(BASE)}
<main class="wrap">
  <a class="back" href="${BASE}/apps">← คลังแอปทั้งหมด</a>
  <div class="hero">
    <div class="hero-icon">${esc(app.icon || '🎮')}</div>
    <div>
      <div class="badges">
        <span class="cat">${esc(app.category || 'อื่นๆ')}</span>
        ${app.is_vip ? '<span class="vip">★ VIP</span>' : ''}
        ${isLocked ? '<span class="lock">🔒 ต้องใช้รหัส</span>' : '<span class="free">🆓 ใช้ฟรี</span>'}
      </div>
      <h1>${title}</h1>
      <p class="lead">${desc}</p>
    </div>
  </div>

  ${app.preview_image ? `<img class="preview" src="${esc(app.preview_image)}" alt="ตัวอย่างหน้าจอ ${title}" loading="lazy">` : ''}

  <div class="cta">
    ${isLocked
      ? `<a class="btn btn-lock" href="${BASE}/apps/${app.id}">🔓 ใส่รหัสเพื่อเปิดแอป</a>
         <a class="btn btn-ghost" href="${BASE}/buy">วิธีขอรหัส →</a>`
      : `<a class="btn btn-go" href="${BASE}/apps/${app.id}">🚀 เปิดแอปเลย</a>`}
  </div>

  ${app.prompt ? `
  <section class="sec">
    <h2>Prompt สำหรับสร้างแอปแบบนี้เอง</h2>
    <p class="sec-note">คัดลอกไปวางกับ AI เพื่อดัดแปลงเป็นเวอร์ชันของคุณเองได้</p>
    <pre class="prompt">${esc(app.prompt)}</pre>
  </section>` : ''}

  ${related.length ? `
  <section class="sec">
    <h2>แอปอื่นที่น่าสนใจ</h2>
    <div class="rel-grid">
      ${related.map(r => `
      <a class="rel-card" href="${BASE}/apps/${r.id}">
        <span class="rel-icon">${esc(r.icon || '🎮')}</span>
        <span class="rel-title">${esc(r.title)}</span>
        <span class="rel-cat">${esc(r.category || '')}${r.locked ? ' · 🔒' : ''}</span>
      </a>`).join('')}
    </div>
  </section>` : ''}

  <div class="more">
    <a href="${BASE}/apps">ดูแอปทั้งหมด →</a>
    <a href="${BASE}/worksheets">คลังใบงาน →</a>
    <a href="${BASE}/blog">อ่านบทความ →</a>
  </div>
</main>
${footerHTML(BASE)}
${trackHTML('/apps/' + app.id)}
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// ── helpers ──────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

function navHTML(BASE) {
  return `<nav>
  <a class="logo" href="${BASE}/"><span class="logo-mark">✦</span>Kru-ti ครูติ <em>TH</em></a>
  <div class="nav-links">
    <a href="${BASE}/">หน้าหลัก</a>
    <a href="${BASE}/blog">บทความ</a>
    <a href="${BASE}/apps">แอป</a>
    <a href="${BASE}/worksheets">ใบงาน</a>
  </div>
</nav>`;
}

function footerHTML(BASE) {
  return `<footer>
  <a href="${BASE}/">Kru-ti ครูติ TH</a> — แอปการสอนและบทความ เพื่อครูไทย · © 2568
</footer>`;
}

// เก็บสถิติแบบเดียวกับหน้าเว็บหลัก — ใช้ visitor id ตัวเดียวกัน (localStorage '_vid')
// ไม่งั้นคนที่สลับไปมาระหว่างหน้า SSR กับ SPA จะถูกนับเป็นคนละคน
// และถ้าไม่มีบรรทัดนี้ คนที่มาจาก Google จะไม่ปรากฏใน Dashboard เลย
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

function notFound(BASE) {
  return new Response(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ไม่พบแอปนี้ — Kru-ti ครูติ TH</title><meta name="robots" content="noindex">
<style>${CSS}.nf{text-align:center;padding:80px 20px;}
.nf h1{font-size:1.55rem;margin:14px 0 8px;}
.nf p{color:var(--slate);margin-bottom:22px;}</style></head><body>
${navHTML(BASE)}
<main class="nf"><div style="font-size:3rem;">🔍</div>
<h1>ไม่พบแอปนี้</h1><p>แอปอาจถูกลบ หรือยังไม่ได้เปิดให้ใช้งาน</p>
<a class="btn btn-go" href="${BASE}/apps">ดูแอปทั้งหมด</a></main>
${footerHTML(BASE)}
</body></html>`, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const CSS = `
:root{--ink:#101c33;--ink-soft:#3d4c68;--gold:#f3ac2e;--gold-bright:#ffc555;--gold-deep:#c47f0e;
--gold-soft:rgba(243,172,46,.13);--chalk:#f5efdf;--mint:#0fa294;--paper:#faf7f1;
--line:#e8e1d3;--slate:#6d7588;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Sarabun',sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;}
h1,h2{font-family:'Pridi',serif;font-weight:600;line-height:1.4;}
nav{background:var(--ink);height:62px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.logo{font-family:'Pridi',serif;font-size:1.15rem;font-weight:700;color:#fff;text-decoration:none;display:flex;align-items:center;gap:9px;flex-shrink:0;}
.logo-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--gold),var(--gold-deep));display:flex;align-items:center;justify-content:center;color:var(--ink);font-size:1rem;}
.logo em{font-style:normal;font-size:.65rem;color:#7587a5;align-self:flex-start;margin-top:2px;}
.nav-links{display:flex;gap:2px;overflow-x:auto;}
.nav-links a{padding:8px 13px;border-radius:9px;font-size:.88rem;font-weight:600;color:#aebad0;text-decoration:none;white-space:nowrap;}
.nav-links a:hover{color:#fff;background:rgba(255,255,255,.07);}
.wrap{max-width:820px;margin:0 auto;padding:38px 22px;}
.back{color:var(--slate);font-size:.9rem;font-weight:600;text-decoration:none;display:inline-block;margin-bottom:20px;}
.back:hover{color:var(--ink);}
.hero{display:flex;gap:20px;align-items:flex-start;margin-bottom:22px;}
.hero-icon{font-size:3.2rem;line-height:1;background:#fff;border:1px solid var(--line);border-radius:18px;width:86px;height:86px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.badges{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;}
.cat{background:var(--gold-soft);color:var(--gold-deep);padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.vip{background:#fef3c7;color:#92400e;padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.lock{background:#eef2f7;color:#475569;padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.free{background:rgba(15,162,148,.12);color:#0b7d72;padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.wrap h1{font-size:clamp(1.5rem,3.2vw,2rem);font-weight:700;margin-bottom:9px;}
.lead{color:var(--ink-soft);font-size:1.02rem;line-height:1.85;}
.preview{width:100%;border-radius:15px;border:1px solid var(--line);margin-bottom:22px;}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:34px;}
.btn{display:inline-block;padding:13px 26px;border-radius:12px;font-weight:700;font-size:.95rem;text-decoration:none;border:1.5px solid transparent;}
.btn-go{background:var(--gold);color:var(--ink);}
.btn-lock{background:var(--ink);color:#fff;}
.btn-ghost{background:#fff;border-color:var(--line);color:var(--ink);}
.btn-ghost:hover{border-color:var(--gold);}
.sec{margin-bottom:34px;}
.sec h2{font-size:1.25rem;position:relative;padding-left:16px;margin-bottom:6px;}
.sec h2::before{content:"";position:absolute;left:0;top:10%;bottom:10%;width:4px;border-radius:3px;background:linear-gradient(180deg,var(--gold),var(--gold-deep));}
.sec-note{color:var(--slate);font-size:.88rem;margin-bottom:12px;padding-left:16px;}
.prompt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;line-height:1.75;
  background:var(--ink);color:var(--chalk);padding:18px 20px;border-radius:13px;
  white-space:pre-wrap;word-break:break-word;overflow-x:auto;}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:11px;}
.rel-card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:16px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:5px;transition:border-color .15s;}
.rel-card:hover{border-color:var(--gold);}
.rel-icon{font-size:1.7rem;}
.rel-title{font-family:'Pridi',serif;font-weight:600;font-size:.98rem;line-height:1.45;}
.rel-cat{font-size:.78rem;color:var(--slate);}
.more{padding-top:22px;border-top:1px solid var(--line);display:flex;gap:20px;flex-wrap:wrap;}
.more a{color:var(--gold-deep);font-weight:700;font-size:.92rem;text-decoration:none;}
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:24px 22px;text-align:center;font-size:.85rem;margin-top:48px;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
@media(max-width:560px){.hero{gap:14px;}.hero-icon{width:64px;height:64px;font-size:2.3rem;border-radius:14px;}}
`;
