// functions/apps/index.js
// SSR หน้าคลังแอปทั้งหมด — URL: https://kru-ti.com/apps
// เวอร์ชันเต็มที่มีตัวกรอง/ค้นหา/สลับมุมมองอยู่ที่ /#/apps (SPA) หน้านี้มีไว้ให้
// search engine เก็บได้ และให้คนที่มาจาก Google เห็นเนื้อหาจริงทันทีโดยไม่ต้องรอ JS

const SITE = 'https://kru-ti.com';

export async function onRequest({ env, request }) {
  const BASE = new URL(request.url).origin;

  let apps = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id,icon,title,category,description,locked,is_vip FROM apps
       WHERE visible=1
       ORDER BY (pinned > 0) DESC, pinned ASC, sort_order ASC, created_at ASC`
    ).all();
    apps = results || [];
  } catch (e) { /* DB ล่ม → แสดงหน้าเปล่าพร้อมลิงก์ ดีกว่าพัง 500 */ }

  // จัดกลุ่มตามหมวด คงลำดับเดิมไว้
  const groups = [];
  const byCat = new Map();
  for (const a of apps) {
    const c = a.category || 'อื่นๆ';
    if (!byCat.has(c)) { byCat.set(c, []); groups.push(c); }
    byCat.get(c).push(a);
  }

  const freeCount = apps.filter(a => !a.locked).length;
  const desc = `รวมแอปการสอน Interactive ${apps.length} แอปสำหรับครูไทย `
             + `เปิดใช้ในห้องเรียนได้ทันทีบนมือถือและคอมพิวเตอร์ ไม่ต้องติดตั้ง `
             + `${freeCount ? `ใช้ฟรี ${freeCount} แอป ` : ''}พร้อม Prompt ให้นำไปสร้างเวอร์ชันของตัวเอง`;
  const canon = `${SITE}/apps`;

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'คลังแอปการสอน — Kru-ti ครูติ TH',
    description: desc,
    url: canon,
    inLanguage: 'th',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: apps.length,
      itemListElement: apps.slice(0, 100).map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/apps/${a.id}`,
        name: a.title,
      })),
    },
  }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>คลังแอปการสอน — สื่อการสอน Interactive สำหรับครูไทย | Kru-ti ครูติ TH</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="คลังแอปการสอน — Kru-ti ครูติ TH">
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
    <h1>คลังแอปการสอน</h1>
    <p>${esc(desc)}</p>
    <a class="btn-spa" href="${BASE}/#/apps">เปิดเวอร์ชันที่ค้นหาและกรองได้ →</a>
  </header>

  ${apps.length ? groups.map(cat => `
  <section class="cat-sec">
    <h2>${esc(cat)} <span class="n">${byCat.get(cat).length}</span></h2>
    <div class="grid">
      ${byCat.get(cat).map(a => `
      <a class="card" href="${BASE}/apps/${a.id}">
        <span class="icon">${esc(a.icon || '🎮')}</span>
        <span class="title">${esc(a.title)}</span>
        ${a.description ? `<span class="desc">${esc(a.description)}</span>` : ''}
        <span class="tags">
          ${a.locked ? '<span class="lock">🔒 ต้องใช้รหัส</span>' : '<span class="free">🆓 ใช้ฟรี</span>'}
          ${a.is_vip ? '<span class="vip">★ VIP</span>' : ''}
        </span>
      </a>`).join('')}
    </div>
  </section>`).join('') : `
  <div class="empty">
    <div style="font-size:2.6rem;">📭</div>
    <p>ยังไม่มีแอปให้แสดงในขณะนี้</p>
    <a class="btn-spa" href="${BASE}/">กลับหน้าหลัก</a>
  </div>`}

  <div class="more">
    <a href="${BASE}/worksheets">คลังใบงาน →</a>
    <a href="${BASE}/#/blog">อ่านบทความ →</a>
    <a href="${BASE}/#/buy">วิธีขอรหัสปลดล็อก →</a>
  </div>
</main>
${footerHTML(BASE)}
${trackHTML('/apps')}
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

// เก็บสถิติแบบเดียวกับหน้าเว็บหลัก — ใช้ visitor id ตัวเดียวกัน (localStorage '_vid')
// ถ้าไม่มีบรรทัดนี้ คนที่มาจาก Google จะไม่ปรากฏใน Dashboard เลย
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
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(224px,1fr));gap:13px;}
.card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:18px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:7px;transition:border-color .15s,transform .15s;}
.card:hover{border-color:var(--gold);transform:translateY(-2px);}
.icon{font-size:2.1rem;line-height:1;}
.title{font-family:'Pridi',serif;font-weight:600;font-size:1.05rem;line-height:1.45;}
.desc{font-size:.87rem;color:var(--slate);line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:6px;}
.lock{background:#eef2f7;color:#475569;padding:2px 10px;border-radius:100px;font-size:.72rem;font-weight:700;}
.free{background:rgba(15,162,148,.12);color:#0b7d72;padding:2px 10px;border-radius:100px;font-size:.72rem;font-weight:700;}
.vip{background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:100px;font-size:.72rem;font-weight:700;}
.empty{text-align:center;padding:60px 20px;color:var(--slate);}
.empty p{margin:12px 0 20px;}
.more{margin-top:14px;padding-top:22px;border-top:1px solid var(--line);display:flex;gap:20px;flex-wrap:wrap;}
.more a{color:var(--gold-deep);font-weight:700;font-size:.92rem;text-decoration:none;}
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:24px 22px;text-align:center;font-size:.85rem;margin-top:48px;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
`;
