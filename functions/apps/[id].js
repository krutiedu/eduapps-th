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
      // ต้องมี url ด้วย — หน้านี้เปิดแอปเองแล้ว ไม่ได้ส่งต่อไปหน้ารวมอีก
      // (ส่งออกหน้าเว็บเฉพาะแอปที่ไม่ล็อกเท่านั้น ดูตอนสร้าง URL_FREE)
      `SELECT id,icon,title,category,description,url,prompt,locked,is_vip,preview_image,created_at
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
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@500;600;700&family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
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

  ${/* รูปตัวอย่าง: กำหนดความสูงตายตัว (ไม่ปล่อยตามขนาดไฟล์) — รูปบางใบเป็นภาพหน้าจอ
        แนวตั้งยาวมาก ถ้าไม่คุมจะดันปุ่มเปิดแอปตกจอไปเลย โดยเฉพาะบนมือถือ
        กดที่รูปเพื่อดูขนาดเต็มได้ */''}
  ${app.preview_image ? `
  <a class="preview-wrap" href="${esc(app.preview_image)}" target="_blank" rel="noopener" title="กดเพื่อดูรูปขนาดเต็ม">
    <img class="preview" src="${esc(app.preview_image)}" alt="ตัวอย่างหน้าจอ ${title}" loading="lazy">
    <span class="preview-zoom">🔍 ดูรูปเต็ม</span>
  </a>` : ''}

  ${/* เปิดแอปในหน้านี้เลย ไม่เด้งไปหน้ารวม — เดิมปุ่มพาไป /apps?open=ID ทำให้ผู้ใช้ที่กด
        ลิงก์มาที่แอปตัวเดียว ถูกพาถอยไปหน้ารวมทั้งคลัง แล้ววนกลับไม่ถูก */''}
  <div class="cta">
    ${isLocked
      ? `<button class="btn btn-lock" onclick="openApp()">🔓 ใส่รหัสเพื่อเปิดแอป</button>
         <a class="btn btn-ghost" href="${BASE}/buy">วิธีขอรหัส →</a>`
      : `<button class="btn btn-go" onclick="openApp()">🚀 เปิดแอปเลย</button>`}
  </div>

  ${/* ช่องใส่รหัส — โผล่ตรงนี้เลยเมื่อกดปุ่ม ไม่ต้องเปลี่ยนหน้า */''}
  <div class="unlock" id="unlockBox" hidden>
    <label for="codeInput">กรอกรหัสที่ได้รับ</label>
    <div class="unlock-row">
      <input id="codeInput" type="text" placeholder="ใส่รหัสที่นี่..." autocomplete="off"
             onkeydown="if(event.key==='Enter')submitCode()">
      <button class="btn btn-go" onclick="submitCode()">ปลดล็อก</button>
    </div>
    <p class="unlock-msg" id="unlockMsg"></p>
  </div>

  ${app.prompt ? `
  ${/* prompt ยาวได้ถึงสองหมื่นตัวอักษร (วัดแล้วมีแอปที่ยาว 21,852 ตัว = ต้องเลื่อน 21 จอ)
        ถ้าแสดงทันทีจะกลบเนื้อหาอื่นทั้งหมด — ใช้ <details> ให้กดแล้วค่อยกาง
        ทำงานได้แม้ JS ปิดอยู่ */''}
  <section class="sec">
    <details class="prompt-box">
      <summary>
        <span class="prompt-title">📋 Prompt สำหรับสร้างแอปแบบนี้เอง</span>
        <span class="prompt-hint">กดเพื่อดู · ${app.prompt.length.toLocaleString('th-TH')} ตัวอักษร</span>
      </summary>
      <p class="sec-note">คัดลอกไปวางกับ AI เพื่อดัดแปลงเป็นเวอร์ชันของคุณเองได้</p>
      <button class="btn-copy" onclick="copyPrompt(this)">📋 คัดลอก Prompt</button>
      <pre class="prompt" id="promptText">${esc(app.prompt)}</pre>
    </details>
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
${/* ตัวเปิดแอป — โครงเดียวกับในเว็บหลัก เพื่อให้หน้านี้ใช้งานได้จบในตัว */''}
<div class="viewer" id="viewer" hidden>
  <div class="viewer-box">
    <div class="viewer-bar">
      <span class="viewer-name">${esc(app.icon || '🎮')} ${title}</span>
      <span class="viewer-btns">
        <button onclick="fsApp()" title="ขยายเต็มจอ">⛶ เต็มจอ</button>
        <button onclick="newTab()" title="เปิดแท็บใหม่">↗</button>
        <button class="x" onclick="closeApp()" title="ปิด">✕</button>
      </span>
    </div>
    <iframe id="viewerFrame" allow="fullscreen; autoplay; clipboard-write; gamepad" allowfullscreen></iframe>
  </div>
</div>
${footerHTML(BASE)}
${trackHTML('/apps/' + app.id)}
<script>
(function () {
  var ID = ${app.id};
  var LOCKED = ${isLocked ? 'true' : 'false'};
  ${/* url ของแอปฟรีเป็นข้อมูลสาธารณะอยู่แล้ว (GET /api/apps ส่งให้ทุกคน)
        ส่วนแอปที่ล็อกจะไม่มีค่านี้ในหน้าเว็บเด็ดขาด ต้องแลกด้วยรหัสผ่าน API เท่านั้น */''}
  var URL_FREE = ${isLocked ? 'null' : JSON.stringify(app.url || '')};
  var url = null;

  function show(u) {
    url = u;
    document.getElementById('viewerFrame').src = u;
    document.getElementById('viewer').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  window.closeApp = function () {
    // ต้องออกจากโหมดเต็มจอก่อน ไม่งั้นปิดหน้าต่างแอปแล้วเบราว์เซอร์ยังค้างเต็มจอ
    // ผู้ใช้ต้องกด Esc เองอีกรอบ
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    var box = document.querySelector('.viewer-box');
    if (box) box.classList.remove('fs');
    document.getElementById('viewer').hidden = true;
    document.getElementById('viewerFrame').src = 'about:blank';
    document.body.style.overflow = '';
  };
  window.newTab = function () { if (url) window.open(url, '_blank', 'noopener'); };
  window.fsApp = function () {
    var b = document.querySelector('.viewer-box');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (b.requestFullscreen) b.requestFullscreen();
    else b.classList.toggle('fs');      // iOS Safari ไม่มี Fullscreen API — ใช้ CSS แทน
  };

  window.openApp = function () {
    if (!LOCKED) return show(URL_FREE);
    // รหัสที่เคยปลดไว้เก็บใน sessionStorage คีย์เดียวกับเว็บหลัก ปลดจากหน้าไหนก็ใช้ได้ทั้งเว็บ
    var saved = null;
    try { saved = sessionStorage.getItem('unlocked_' + ID); } catch (e) {}
    if (saved) return show(saved);
    var box = document.getElementById('unlockBox');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('codeInput').focus();
  };

  window.submitCode = function () {
    var inp = document.getElementById('codeInput');
    var msg = document.getElementById('unlockMsg');
    var code = (inp.value || '').trim();
    if (!code) { msg.textContent = 'กรุณากรอกรหัส'; msg.className = 'unlock-msg err'; return; }
    msg.textContent = 'กำลังตรวจสอบ...'; msg.className = 'unlock-msg';
    fetch('/api/apps/' + ID + '/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.url) {
          msg.textContent = '❌ ' + (res.d.error || 'รหัสไม่ถูกต้อง');
          msg.className = 'unlock-msg err'; inp.select(); return;
        }
        try { sessionStorage.setItem('unlocked_' + ID, res.d.url); } catch (e) {}
        msg.textContent = '✅ ปลดล็อกแล้ว'; msg.className = 'unlock-msg ok';
        document.getElementById('unlockBox').hidden = true;
        show(res.d.url);
      })
      .catch(function () {
        msg.textContent = '❌ เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง';
        msg.className = 'unlock-msg err';
      });
  };

  window.copyPrompt = function (btn) {
    var t = document.getElementById('promptText').textContent;
    var done = function () { btn.textContent = '✓ คัดลอกแล้ว'; setTimeout(function () { btn.textContent = '📋 คัดลอก Prompt'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, done); else done();
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('viewer').hidden) closeApp();
  });
})();
<\/script>
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
/* รูปตัวอย่าง — คุมความสูงตายตัว ไม่ปล่อยตามขนาดไฟล์
   ภาพหน้าจอแนวตั้งบางใบสูงเป็นพันพิกเซล ถ้าไม่คุมจะดันปุ่มเปิดแอปตกจอ */
.preview-wrap{display:block;position:relative;width:fit-content;max-width:100%;margin:0 auto 22px;
  border-radius:15px;border:1px solid var(--line);background:#fff;overflow:hidden;text-decoration:none;}
.preview{display:block;max-height:300px;max-width:100%;width:auto;height:auto;object-fit:contain;}
.preview-zoom{position:absolute;right:9px;bottom:9px;background:rgba(16,28,51,.82);color:#fff;
  padding:4px 11px;border-radius:100px;font-size:.74rem;font-weight:700;pointer-events:none;}

/* ตัวเปิดแอป */
.viewer{position:fixed;inset:0;z-index:9999;background:rgba(13,21,38,.9);
  display:flex;align-items:center;justify-content:center;padding:12px;}
.viewer[hidden]{display:none;}
.viewer-box{display:flex;flex-direction:column;width:100%;max-width:460px;height:88vh;background:#fff;
  border-radius:15px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);}
.viewer-box.fs{position:fixed;inset:0;max-width:none;width:100vw;height:100vh;border-radius:0;}
.viewer-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:9px 12px;background:var(--ink);flex-shrink:0;}
.viewer-name{color:#fff;font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.viewer-btns{display:flex;gap:6px;flex-shrink:0;}
.viewer-btns button{background:var(--gold);color:var(--ink);border:none;padding:6px 11px;border-radius:8px;
  font-family:'Sarabun',sans-serif;font-size:.8rem;font-weight:700;cursor:pointer;}
.viewer-btns button.x{background:#dc2626;color:#fff;}
#viewerFrame{flex:1;width:100%;border:none;background:#fff;}

/* ช่องใส่รหัส */
.unlock{background:#fff;border:1.5px solid var(--gold);border-radius:15px;padding:18px 20px;margin-bottom:30px;}
.unlock[hidden]{display:none;}
.unlock label{display:block;font-weight:700;font-size:.92rem;margin-bottom:9px;}
.unlock-row{display:flex;gap:9px;flex-wrap:wrap;}
.unlock-row input{flex:1;min-width:170px;padding:11px 14px;border:1.5px solid var(--line);border-radius:11px;
  font-family:'Sarabun',sans-serif;font-size:1rem;outline:none;}
.unlock-row input:focus{border-color:var(--gold);}
.unlock-msg{font-size:.86rem;margin-top:9px;min-height:1.2em;color:var(--slate);}
.unlock-msg.err{color:#dc2626;font-weight:700;}
.unlock-msg.ok{color:#0b7d72;font-weight:700;}

/* prompt — พับเก็บไว้ กดแล้วค่อยกาง */
.prompt-box{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.prompt-box summary{cursor:pointer;padding:15px 18px;list-style:none;display:flex;
  align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.prompt-box summary::-webkit-details-marker{display:none;}
.prompt-box summary:hover{background:var(--gold-soft);}
.prompt-title{font-family:'Pridi',serif;font-weight:600;font-size:1.05rem;}
.prompt-hint{font-size:.8rem;color:var(--slate);}
.prompt-box[open] summary{border-bottom:1px solid var(--line);}
.prompt-box .sec-note{padding:13px 18px 0;margin:0;}
.btn-copy{margin:11px 18px;background:var(--gold);color:var(--ink);border:none;padding:9px 18px;
  border-radius:10px;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.86rem;cursor:pointer;}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:34px;}
/* ใช้ทั้งกับ <a> และ <button> — ปุ่มต้องบังคับ font-family เอง
   ไม่งั้นเบราว์เซอร์ใช้ฟอนต์ default (Arial) ไม่ใช่ Sarabun ของเว็บ */
.btn{display:inline-block;padding:13px 26px;border-radius:12px;font-weight:700;font-size:.95rem;
  text-decoration:none;border:1.5px solid transparent;font-family:'Sarabun',sans-serif;
  cursor:pointer;line-height:1.5;}
.btn-go{background:var(--gold);color:var(--ink);}
.btn-lock{background:var(--ink);color:#fff;}
.btn-ghost{background:#fff;border-color:var(--line);color:var(--ink);}
.btn-ghost:hover{border-color:var(--gold);}
.sec{margin-bottom:34px;}
.sec h2{font-size:1.25rem;position:relative;padding-left:16px;margin-bottom:6px;}
.sec h2::before{content:"";position:absolute;left:0;top:10%;bottom:10%;width:4px;border-radius:3px;background:linear-gradient(180deg,var(--gold),var(--gold-deep));}
.sec-note{color:var(--slate);font-size:.88rem;margin-bottom:12px;padding-left:16px;}
/* เนื้อ prompt — จำกัดความสูงแล้วเลื่อนในกล่อง ไม่ยืดหน้าเว็บออกไปเป็นสิบจอ */
.prompt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;line-height:1.75;
  background:var(--ink);color:var(--chalk);padding:18px 20px;margin:0 18px 18px;border-radius:13px;
  white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:60vh;}
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
@media(max-width:560px){
  .hero{gap:14px;}
  .hero-icon{width:64px;height:64px;font-size:2.3rem;border-radius:14px;}
  .preview{max-height:200px;}          /* มือถือจอเตี้ย — รูปต้องไม่กินเกินครึ่งจอ */
  .cta{flex-direction:column;}
  .cta .btn{width:100%;text-align:center;}
  .viewer{padding:0;}
  .viewer-box{max-width:none;height:100vh;border-radius:0;}
  .prompt{max-height:50vh;margin:0 12px 14px;font-size:.8rem;}
  .prompt-box summary{padding:13px 14px;}
  .btn-copy{margin:11px 12px;}
}
`;
