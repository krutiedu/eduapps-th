// functions/worksheets/index.js
// SSR หน้าคลังใบงานทั้งหมด — URL: https://kru-ti.com/worksheets
// เวอร์ชันที่ค้นหา/กรองได้อยู่ที่ /#/worksheets (SPA)

const SITE = 'https://kru-ti.com';

export async function onRequest({ env, request }) {
  const BASE = new URL(request.url).origin;

  let list = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,title,category,description,cover_image,pages,locked,downloads FROM worksheets
       WHERE visible=1 ORDER BY sort_order ASC, created_at DESC`
    ).all();
    list = results || [];
  } catch (e) { /* DB ล่ม → แสดงหน้าเปล่าพร้อมลิงก์ ดีกว่าพัง 500 */ }

  const groups = [];
  const byCat = new Map();
  for (const w of list) {
    const c = w.category || 'อื่นๆ';
    if (!byCat.has(c)) { byCat.set(c, []); groups.push(c); }
    byCat.get(c).push(w);
  }

  const freeCount = list.filter(w => !w.locked).length;
  const desc = `รวมใบงานพร้อมพิมพ์ ${list.length} รายการสำหรับครูไทย `
             + `${groups.length ? `ครอบคลุมวิชา${groups.slice(0, 5).join(' ')} ` : ''}`
             + `${freeCount ? `ดาวน์โหลดฟรี ${freeCount} รายการ ` : ''}ใช้ในห้องเรียนได้ทันที`;
  const canon = `${SITE}/worksheets`;

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'คลังใบงาน — Kru-ti ครูติ TH',
    description: desc,
    url: canon,
    inLanguage: 'th',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: list.length,
      itemListElement: list.slice(0, 100).map((w, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/worksheet/${w.id}`,
        name: w.title,
      })),
    },
  }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>คลังใบงาน — ใบงานพร้อมพิมพ์สำหรับครูไทย | Kru-ti ครูติ TH</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="คลังใบงาน — Kru-ti ครูติ TH">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canon}">
<meta property="og:site_name" content="Kru-ti ครูติ TH">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonld}</script>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@600;700&family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${navHTML(BASE)}
<main class="wrap">
  <header class="head">
    <h1>คลังใบงาน</h1>
    <p>${esc(desc)}</p>
    <a class="btn-spa" href="${BASE}/#/worksheets">เปิดเวอร์ชันที่ค้นหาและกรองได้ →</a>
  </header>

  ${list.length ? groups.map(cat => `
  <section class="cat-sec">
    <h2>${esc(cat)} <span class="n">${byCat.get(cat).length}</span></h2>
    <div class="grid">
      ${byCat.get(cat).map(w => `
      <a class="card" href="${BASE}/worksheet/${w.id}">
        ${w.cover_image
          ? `<img class="cover" src="${esc(w.cover_image)}" alt="${esc(w.title)}" loading="lazy">`
          : `<span class="cover cover-ph">📄</span>`}
        <span class="title">${esc(w.title)}</span>
        <span class="meta">
          ${w.pages ? `📑 ${w.pages} หน้า · ` : ''}⬇️ ${Number(w.downloads || 0).toLocaleString('th-TH')}
        </span>
        <span class="tags">
          ${w.locked ? '<span class="lock">🔒 ต้องใช้รหัส</span>' : '<span class="free">🆓 ฟรี</span>'}
        </span>
      </a>`).join('')}
    </div>
  </section>`).join('') : `
  <div class="empty">
    <div style="font-size:2.6rem;">📭</div>
    <p>ยังไม่มีใบงานให้แสดงในขณะนี้</p>
    <a class="btn-spa" href="${BASE}/">กลับหน้าหลัก</a>
  </div>`}

  <div class="more">
    <a href="${BASE}/apps">คลังแอปการสอน →</a>
    <a href="${BASE}/#/blog">อ่านบทความ →</a>
    <a href="${BASE}/#/buy">วิธีขอรหัสปลดล็อก →</a>
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
.wrap{max-width:960px;margin:0 auto;padding:40px 22px;}
.head{margin-bottom:34px;padding-bottom:24px;border-bottom:1px solid var(--line);}
.head h1{font-size:clamp(1.7rem,3.6vw,2.3rem);font-weight:700;margin-bottom:11px;}
.head p{color:var(--ink-soft);font-size:1.02rem;line-height:1.85;max-width:680px;margin-bottom:16px;}
.btn-spa{display:inline-block;background:var(--gold);color:var(--ink);padding:11px 22px;border-radius:12px;font-weight:700;font-size:.92rem;text-decoration:none;}
.cat-sec{margin-bottom:34px;}
.cat-sec h2{font-size:1.28rem;position:relative;padding-left:16px;margin-bottom:14px;}
.cat-sec h2::before{content:"";position:absolute;left:0;top:10%;bottom:10%;width:4px;border-radius:3px;background:linear-gradient(180deg,var(--gold),var(--gold-deep));}
.cat-sec h2 .n{font-family:'Sarabun',sans-serif;font-size:.78rem;font-weight:700;color:var(--slate);background:var(--gold-soft);padding:2px 10px;border-radius:100px;vertical-align:middle;margin-left:5px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:13px;}
.card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:13px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:7px;transition:border-color .15s,transform .15s;}
.card:hover{border-color:var(--gold);transform:translateY(-2px);}
.cover{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:var(--paper);display:block;}
.cover-ph{display:flex;align-items:center;justify-content:center;font-size:2.6rem;color:var(--slate);}
.title{font-family:'Pridi',serif;font-weight:600;font-size:.98rem;line-height:1.45;}
.meta{font-size:.78rem;color:var(--slate);}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:4px;}
.lock{background:#eef2f7;color:#475569;padding:2px 10px;border-radius:100px;font-size:.72rem;font-weight:700;}
.free{background:rgba(15,162,148,.12);color:#0b7d72;padding:2px 10px;border-radius:100px;font-size:.72rem;font-weight:700;}
.empty{text-align:center;padding:60px 20px;color:var(--slate);}
.empty p{margin:12px 0 20px;}
.more{margin-top:14px;padding-top:22px;border-top:1px solid var(--line);display:flex;gap:20px;flex-wrap:wrap;}
.more a{color:var(--gold-deep);font-weight:700;font-size:.92rem;text-decoration:none;}
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:24px 22px;text-align:center;font-size:.85rem;margin-top:48px;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
`;
