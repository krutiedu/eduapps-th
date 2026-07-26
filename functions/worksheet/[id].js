// functions/worksheet/[id].js
// SSR หน้าใบงานรายตัว — URL: https://kru-ti.com/worksheet/5
// ใช้เส้นทางเอกพจน์ให้ตรงกับ #/worksheet/:id ใน SPA และกับ path ที่ระบบเก็บสถิติใช้อยู่
//
// ⚠️ ห้ามใส่ file_url ลงใน HTML ถ้า locked=1 — นั่นคือไฟล์ที่ขาย

const SITE = 'https://kru-ti.com';

export async function onRequest({ params, env, request }) {
  const id = decodeURIComponent(params.id || '');
  const BASE = new URL(request.url).origin;

  if (!/^\d+$/.test(id)) return notFound(BASE);

  let w = null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,title,category,description,cover_image,pages,locked,downloads,created_at
       FROM worksheets WHERE id=? AND visible=1`
    ).bind(id).all();
    w = results[0] || null;
  } catch (e) { /* DB error → 404 */ }

  if (!w) return notFound(BASE);

  let related = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,title,category,cover_image,locked FROM worksheets
       WHERE visible=1 AND id != ?
       ORDER BY (category = ?) DESC, sort_order ASC, created_at DESC LIMIT 4`
    ).bind(w.id, w.category || '').all();
    related = results || [];
  } catch (e) { /* ของเสริม */ }

  const title = esc(w.title);
  // คำอธิบายบางใบงานถูกกรอกซ้ำกับชื่อ — ถ้าซ้ำให้เขียนประโยคที่มีประโยชน์แทน
  const rawDesc = (w.description || '').trim();
  const descText = (rawDesc && rawDesc !== (w.title || '').trim())
    ? rawDesc
    : `ใบงาน${w.category ? 'วิชา' + w.category : ''} ${w.title} พร้อมพิมพ์ใช้ในห้องเรียน`
      + `${w.pages ? ` จำนวน ${w.pages} หน้า` : ''} ดาวน์โหลดได้จาก Kru-ti ครูติ TH`;
  const desc  = esc(descText);
  const canon = `${SITE}/worksheet/${w.id}`;
  const img   = w.cover_image || `${SITE}/og-image.png`;
  const isLocked = !!w.locked;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: w.title,
    description: descText,
    learningResourceType: 'worksheet',
    educationalUse: 'assignment',
    url: canon,
    image: img,
    inLanguage: 'th',
    ...(w.category ? { about: w.category } : {}),
    ...(w.pages ? { numberOfPages: w.pages } : {}),
    publisher: {
      '@type': 'Organization',
      name: 'Kru-ti ครูติ TH',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
    },
  };
  if (!isLocked) ld.offers = { '@type': 'Offer', price: '0', priceCurrency: 'THB' };
  const jsonld = JSON.stringify(ld).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${title} — ใบงานพร้อมพิมพ์ | Kru-ti ครูติ TH</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="${title} — ใบงานพร้อมพิมพ์">
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
  <a class="back" href="${BASE}/worksheets">← คลังใบงานทั้งหมด</a>
  <div class="detail">
    <div class="cover-col">
      ${w.cover_image
        ? `<img class="cover" src="${esc(w.cover_image)}" alt="ตัวอย่างใบงาน ${title}">`
        : `<div class="cover cover-ph">📄</div>`}
    </div>
    <div class="info-col">
      <div class="badges">
        <span class="cat">${esc(w.category || 'อื่นๆ')}</span>
        ${isLocked ? '<span class="lock">🔒 ต้องใช้รหัส</span>' : '<span class="free">🆓 ดาวน์โหลดฟรี</span>'}
      </div>
      <h1>${title}</h1>
      <div class="meta">
        ${w.pages ? `<span>📑 ${w.pages} หน้า</span>` : ''}
        <span>⬇️ ดาวน์โหลดแล้ว ${Number(w.downloads || 0).toLocaleString('th-TH')} ครั้ง</span>
      </div>
      <p class="lead">${desc}</p>
      <div class="cta">
        ${isLocked
          ? `<a class="btn btn-lock" href="${BASE}/#/worksheet/${w.id}">🔓 ใส่รหัสเพื่อดาวน์โหลด</a>
             <a class="btn btn-ghost" href="${BASE}/#/buy">วิธีขอรหัส →</a>`
          : `<a class="btn btn-go" href="${BASE}/#/worksheet/${w.id}">⬇️ ดาวน์โหลดใบงาน</a>`}
      </div>
    </div>
  </div>

  ${related.length ? `
  <section class="sec">
    <h2>ใบงานอื่นที่น่าสนใจ</h2>
    <div class="rel-grid">
      ${related.map(r => `
      <a class="rel-card" href="${BASE}/worksheet/${r.id}">
        ${r.cover_image
          ? `<img class="rel-cover" src="${esc(r.cover_image)}" alt="${esc(r.title)}" loading="lazy">`
          : `<span class="rel-cover rel-ph">📄</span>`}
        <span class="rel-title">${esc(r.title)}</span>
        <span class="rel-cat">${esc(r.category || '')}${r.locked ? ' · 🔒' : ''}</span>
      </a>`).join('')}
    </div>
  </section>` : ''}

  <div class="more">
    <a href="${BASE}/worksheets">ดูใบงานทั้งหมด →</a>
    <a href="${BASE}/apps">คลังแอปการสอน →</a>
    <a href="${BASE}/#/blog">อ่านบทความ →</a>
  </div>
</main>
${footerHTML(BASE)}
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
    <a href="${BASE}/#/blog">บทความ</a>
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

function notFound(BASE) {
  return new Response(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ไม่พบใบงานนี้ — Kru-ti ครูติ TH</title><meta name="robots" content="noindex">
<style>${CSS}.nf{text-align:center;padding:80px 20px;}
.nf h1{font-size:1.55rem;margin:14px 0 8px;}
.nf p{color:var(--slate);margin-bottom:22px;}</style></head><body>
${navHTML(BASE)}
<main class="nf"><div style="font-size:3rem;">🔍</div>
<h1>ไม่พบใบงานนี้</h1><p>ใบงานอาจถูกลบ หรือยังไม่ได้เปิดให้ดาวน์โหลด</p>
<a class="btn btn-go" href="${BASE}/worksheets">ดูใบงานทั้งหมด</a></main>
${footerHTML(BASE)}
</body></html>`, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const CSS = `
:root{--ink:#101c33;--ink-soft:#3d4c68;--gold:#f3ac2e;--gold-bright:#ffc555;--gold-deep:#c47f0e;
--gold-soft:rgba(243,172,46,.13);--paper:#faf7f1;--line:#e8e1d3;--slate:#6d7588;}
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
.wrap{max-width:900px;margin:0 auto;padding:38px 22px;}
.back{color:var(--slate);font-size:.9rem;font-weight:600;text-decoration:none;display:inline-block;margin-bottom:20px;}
.back:hover{color:var(--ink);}
.detail{display:grid;grid-template-columns:300px 1fr;gap:30px;align-items:start;margin-bottom:38px;}
.cover{width:100%;border-radius:15px;border:1px solid var(--line);background:#fff;display:block;}
.cover-ph{aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:4rem;color:var(--slate);}
.badges{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px;}
.cat{background:var(--gold-soft);color:var(--gold-deep);padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.lock{background:#eef2f7;color:#475569;padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.free{background:rgba(15,162,148,.12);color:#0b7d72;padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
.wrap h1{font-size:clamp(1.45rem,3vw,1.95rem);font-weight:700;margin-bottom:10px;}
.meta{display:flex;gap:14px;flex-wrap:wrap;font-size:.86rem;color:var(--slate);margin-bottom:14px;
  padding-bottom:14px;border-bottom:1px solid var(--line);}
.lead{color:var(--ink-soft);font-size:1rem;line-height:1.85;margin-bottom:22px;}
.cta{display:flex;gap:10px;flex-wrap:wrap;}
.btn{display:inline-block;padding:13px 26px;border-radius:12px;font-weight:700;font-size:.95rem;text-decoration:none;border:1.5px solid transparent;}
.btn-go{background:var(--gold);color:var(--ink);}
.btn-lock{background:var(--ink);color:#fff;}
.btn-ghost{background:#fff;border-color:var(--line);color:var(--ink);}
.btn-ghost:hover{border-color:var(--gold);}
.sec{margin-bottom:32px;}
.sec h2{font-size:1.25rem;position:relative;padding-left:16px;margin-bottom:14px;}
.sec h2::before{content:"";position:absolute;left:0;top:10%;bottom:10%;width:4px;border-radius:3px;background:linear-gradient(180deg,var(--gold),var(--gold-deep));}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:13px;}
.rel-card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:6px;transition:border-color .15s;}
.rel-card:hover{border-color:var(--gold);}
.rel-cover{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:9px;background:var(--paper);}
.rel-ph{display:flex;align-items:center;justify-content:center;font-size:2.2rem;color:var(--slate);}
.rel-title{font-family:'Pridi',serif;font-weight:600;font-size:.95rem;line-height:1.45;}
.rel-cat{font-size:.77rem;color:var(--slate);}
.more{padding-top:22px;border-top:1px solid var(--line);display:flex;gap:20px;flex-wrap:wrap;}
.more a{color:var(--gold-deep);font-weight:700;font-size:.92rem;text-decoration:none;}
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:24px 22px;text-align:center;font-size:.85rem;margin-top:48px;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
@media(max-width:680px){.detail{grid-template-columns:1fr;gap:20px;}
.cover-col{max-width:260px;margin:0 auto;}}
`;
