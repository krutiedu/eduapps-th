// functions/article/[id].js
// SSR หน้าบทความ — เสิร์ฟ HTML จริงให้ Googlebot/Facebook/LINE crawler
// URL: https://kru-ti.com/article/1 (รับทั้ง id ตัวเลข และ slug)
// ผู้ใช้จริงอ่านหน้านี้ได้เลย หรือกดกลับไปเว็บหลัก (SPA) ก็ได้

export async function onRequest({ params, env, request }) {
  const idOrSlug = decodeURIComponent(params.id || '');
  const BASE = new URL(request.url).origin;

  // ── lookup: id ตัวเลข หรือ slug ──
  const isNumeric = /^\d+$/.test(idOrSlug);
  const col = isNumeric ? 'id' : 'slug';
  let art = null;
  try {
    const { results } = await env.DB
      .prepare(`SELECT * FROM articles WHERE ${col}=? AND published=1`)
      .bind(idOrSlug).all();
    art = results[0] || null;
    if (art) {
      // นับวิว (ไม่รอผล)
      env.DB.prepare(`UPDATE articles SET views=views+1 WHERE ${col}=?`)
        .bind(idOrSlug).run().catch(() => {});
    }
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
  const canon    = `${BASE}/article/${art.id}`;
  const img      = art.image_url || `${BASE}/og-image.png`; // ไม่มีรูปปก → ใช้รูปแบรนด์
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
    author: { '@type': 'Person', name: art.author_name || 'Kru-ti ครูติ', url: `${BASE}/#/about` },
    publisher: {
      '@type': 'Organization',
      name: 'Kru-ti ครูติ TH',
      logo: { '@type': 'ImageObject', url: `${BASE}/icon-512.png` },
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
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@600;700&family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav>
  <a class="logo" href="${BASE}/"><span class="logo-mark">✦</span>Kru-ti ครูติ <em>TH</em></a>
  <div class="nav-links">
    <a href="${BASE}/">หน้าหลัก</a>
    <a href="${BASE}/#/blog">บทความ</a>
    <a href="${BASE}/#/apps">แอปทั้งหมด</a>
  </div>
</nav>
<main class="art-wrap">
  <a class="back" href="${BASE}/#/blog">← บทความทั้งหมด</a>
  <h1>${title}</h1>
  <div class="art-info">
    <span class="cat">${esc(art.category || '')}</span>
    <span>📅 ${dateThai}</span>
    <span>✍️ ${author}</span>
  </div>
  ${img ? `<img class="cover" src="${esc(img)}" alt="${title}">` : ''}
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
    <a href="${BASE}/#/blog">อ่านบทความอื่น →</a>
    <a href="${BASE}/#/apps">ดูแอปการสอนทั้งหมด →</a>
  </div>
</main>
<footer>
  <a href="${BASE}/">Kru-ti ครูติ TH</a> — แอปการสอนและบทความ เพื่อครูไทย · © 2568
</footer>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // cache 5 นาที
    },
  });
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
const CSS = `
:root{--ink:#101c33;--ink-soft:#3d4c68;--gold:#f3ac2e;--gold-bright:#ffc555;--gold-deep:#c47f0e;
--gold-soft:rgba(243,172,46,.13);--chalk:#f5efdf;--mint:#0fa294;--paper:#faf7f1;
--line:#e8e1d3;--slate:#6d7588;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Sarabun',sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;}
h1,h2,h3{font-family:'Pridi',serif;font-weight:600;line-height:1.4;}
nav{background:var(--ink);height:62px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-family:'Pridi',serif;font-size:1.15rem;font-weight:700;color:#fff;text-decoration:none;display:flex;align-items:center;gap:9px;}
.logo-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--gold),var(--gold-deep));display:flex;align-items:center;justify-content:center;color:var(--ink);font-size:1rem;}
.logo em{font-style:normal;font-size:.65rem;color:#7587a5;align-self:flex-start;margin-top:2px;}
.nav-links{display:flex;gap:4px;}
.nav-links a{padding:8px 14px;border-radius:9px;font-size:.9rem;font-weight:600;color:#aebad0;text-decoration:none;}
.nav-links a:hover{color:#fff;background:rgba(255,255,255,.07);}
.art-wrap{max-width:730px;margin:0 auto;padding:42px 22px;}
.back{color:var(--slate);font-size:.9rem;font-weight:600;text-decoration:none;display:inline-block;margin-bottom:18px;}
.back:hover{color:var(--ink);}
.art-wrap h1{font-size:clamp(1.6rem,3.4vw,2.15rem);font-weight:700;line-height:1.42;margin-bottom:16px;}
.art-info{display:flex;gap:13px;align-items:center;flex-wrap:wrap;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--line);font-size:.85rem;color:var(--slate);}
.cat{background:var(--gold-soft);color:var(--gold-deep);padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
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
.art-body img{border-radius:11px;margin:13px 0;max-width:100%;}
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
footer{background:var(--ink);color:rgba(255,255,255,.72);padding:24px 22px;text-align:center;font-size:.85rem;margin-top:48px;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
`;
