'use strict';
const API = '/api';
// โดเมนหลักของเว็บ — ใช้กับ canonical, og:url, og:image, JSON-LD และลิงก์แชร์ทุกที่
// ห้ามใช้ location.origin กับพวกนี้: Cloudflare เปิด eduapps-th.pages.dev ทิ้งไว้ตลอด
// (บวก URL preview ของทุก deploy) ถ้า canonical ชี้กลับ origin ที่ผู้ใช้เข้ามา
// pages.dev จะกลายเป็นสำเนาที่แข่ง SEO กับ kru-ti.com เอง แทนที่จะรวมน้ำหนักมาที่โดเมนหลัก
const SITE = 'https://kru-ti.com';
let S = {}; // site settings

// ── FETCH HELPERS (cache 30 วิ + กันยิงซ้ำขณะ request แรกยังไม่กลับ) ──
const _cache = new Map();
function get(url, ttl = 30000) {
  const hit = _cache.get(url);
  if (hit) {
    if (hit.p) return hit.p;                       // มี request ค้างอยู่ → ใช้ตัวเดิม
    if (Date.now() - hit.t < ttl) return Promise.resolve(hit.v);
  }
  // เช็ค r.ok ด้วย — เดิมไม่เช็ค ทำให้ HTTP 500 ถูกมองว่าเป็น "ข้อมูลว่าง"
  // หน้าเว็บจึงขึ้น "ไม่พบบทความ" ทั้งที่เซิร์ฟเวอร์พัง ผู้ใช้เข้าใจผิดว่าเว็บไม่มีเนื้อหา
  const p = fetch(API + url).then(async r => {
    let v = null;
    try { v = await r.json(); } catch (_) { v = null; }
    if (!r.ok) {
      const e = new Error((v && v.error) || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r.status})`);
      e.status = r.status;
      throw e;
    }
    return v || {};
  }).then(v => {
    _cache.set(url, { t: Date.now(), v });
    return v;
  }).catch(e => { _cache.delete(url); throw e; }); // พลาด → ล้างทิ้ง ให้ลองใหม่ได้
  _cache.set(url, { p });
  return p;
}
const token = () => localStorage.getItem('_tok');

// ── ANALYTICS TRACKING ───────────────────────────────────
// fingerprint แบบเบาๆ ไม่ละเมิดความเป็นส่วนตัว — ไม่ส่ง raw data ส่งแต่ hash
async function getVisitorId() {
  let vid = localStorage.getItem('_vid');
  const vidAge = +localStorage.getItem('_vid_ts') || 0;
  // refresh ทุก 30 วัน
  if (vid && (Date.now() - vidAge) < 30*86400*1000) return vid;
  try {
    const fp = [navigator.userAgent, screen.width+'x'+screen.height,
                Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language].join('|');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fp));
    vid = Array.from(new Uint8Array(buf)).slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('_vid', vid);
    localStorage.setItem('_vid_ts', Date.now());
  } catch (_) {
    // fallback: random ID
    vid = Math.random().toString(36).slice(2,18);
    localStorage.setItem('_vid', vid);
    localStorage.setItem('_vid_ts', Date.now());
  }
  return vid;
}
let _lastTracked = '';
async function trackPageView(path) {
  if (!path || path === _lastTracked) return;
  // ข้าม admin/internal routes ที่ขึ้นต้นด้วย /admin
  if (path.startsWith('/admin')) return;
  _lastTracked = path;
  try {
    const vid = await getVisitorId();
    const body = JSON.stringify({ path, visitor_id: vid });
    // ใช้ sendBeacon ไม่บล็อก, fallback fetch keepalive
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API+'/track', new Blob([body], { type:'application/json' }));
    } else {
      fetch(API+'/track', { method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true }).catch(()=>{});
    }
  } catch (_) {}
}

// ── ROUTER ───────────────────────────────────────────────
// ใช้ path จริง (/apps) ไม่ใช่ hash (#/apps) — search engine อ่าน path ได้ แต่ไม่เคยเห็นสิ่งที่อยู่หลัง #
// ลิงก์เก่าแบบ #/... ยังใช้ได้ ดู migrateHashUrl() ท้ายไฟล์
function route() {
  const h = location.pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(location.search);
  // track ทุกหน้า (non-blocking)
  trackPageView(h);
  document.querySelectorAll('.nav-links a').forEach(a =>
    a.classList.toggle('active', a.dataset.r === h || (h==='/' && a.dataset.r==='/')));
  document.getElementById('navLinks').classList.remove('open');
  const _cs = document.getElementById('crownSlot');
  if (_cs && h !== '/' && h !== '') _cs.innerHTML = '';
  // ตั้ง title/คำอธิบายแยกตามหน้า — ทุกหน้าเป็น URL จริงแล้ว ถ้าใช้ title เดียวกันหมด
  // Google จะมองว่าซ้ำกันและเลือกไม่ถูกว่าจะแสดงหน้าไหน
  // (หน้าบทความกับใบงานตั้ง meta ของตัวเองทีหลัง จึงข้ามตรงนี้)
  const META = {
    '/':           { title: '', desc: '' },   // ว่าง = ใช้ชื่อ+คำอธิบายของเว็บ
    '/blog':       { title: 'บทความทั้งหมด',
                     desc: 'บทความเทคนิคการสอน ข่าวการศึกษา และเครื่องมือใหม่สำหรับครูไทย' },
    '/apps':       { title: 'คลังแอปการสอน',
                     desc: 'รวมแอปการสอน Interactive สำหรับครูไทย เปิดใช้ในห้องเรียนได้ทันทีบนมือถือและคอมพิวเตอร์ ไม่ต้องติดตั้ง' },
    '/worksheets': { title: 'คลังใบงาน',
                     desc: 'ใบงานพร้อมพิมพ์สำหรับครูไทย ดาวน์โหลดไปใช้ในห้องเรียนได้ทันที' },
    '/about':      { title: 'เกี่ยวกับเรา', desc: 'Kru-ti ครูติ TH คือใคร และทำไมถึงทำเว็บนี้' },
    '/buy':        { title: 'วิธีขอรหัสปลดล็อก', desc: 'ขั้นตอนการขอรหัสสำหรับเปิดแอปและใบงานพรีเมียม' },
    '/report':     { title: 'แจ้งปัญหา', desc: 'เจอแอปเสียหรือใบงานโหลดไม่ได้ แจ้งเข้ามาได้ที่นี่' },
    '/privacy':    { title: 'นโยบายความเป็นส่วนตัว', desc: 'เว็บนี้เก็บข้อมูลอะไรบ้างและใช้ทำอะไร' },
  };
  if (!h.startsWith('/article/') && !h.startsWith('/worksheet/')) {
    const m = META[h] || {};
    setPageMeta({ title: m.title || '', desc: m.desc || '', url: SITE + h });
  }
  window.scrollTo(0,0);
  let view;
  if (h === '/' || h === '')         view = renderHome;
  else if (h === '/blog')            view = renderBlog;
  else if (h.startsWith('/article/'))view = () => renderArticle(h.slice(9));
  else if (h === '/apps')            view = () => renderApps(query.get('open'));
  else if (h === '/worksheets')      view = renderWorksheets;
  else if (h.startsWith('/worksheet/')) view = () => renderWorksheetDetail(h.slice(11));
  else if (h === '/about')           view = renderAbout;
  else if (h === '/buy')             view = renderBuy;
  else if (h === '/privacy')         view = renderPrivacy;
  else if (h === '/report')          view = renderReport;
  else                               view = render404;
  safeView(view);
}

// ห่อการ render ทุกหน้า — ถ้า API พลาดต้องเห็นข้อความ + ปุ่มลองใหม่
// (เดิมถ้าโหลดข้อมูลไม่สำเร็จ หน้าจะค้างที่ skeleton ตลอดกาล ไม่มีอะไรบอกผู้ใช้)
function safeView(fn) {
  Promise.resolve().then(fn).catch(e => {
    console.error('[view]', e);
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
    <div style="max-width:460px;margin:60px auto;text-align:center;padding:0 20px;">
      <div style="font-size:2.4rem;margin-bottom:12px;">⚠️</div>
      <h2 style="font-family:'Pridi',serif;font-size:1.25rem;color:var(--ink);margin-bottom:8px;">โหลดข้อมูลไม่สำเร็จ</h2>
      <p style="font-size:.9rem;color:#6d7588;margin-bottom:20px;">อาจเป็นเพราะสัญญาณอินเทอร์เน็ตขาดช่วง ลองกดปุ่มด้านล่างอีกครั้ง</p>
      <button onclick="route()" style="background:var(--gold);color:var(--ink);border:none;padding:12px 26px;border-radius:11px;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.92rem;cursor:pointer;">🔄 ลองใหม่</button>
    </div>`;
  });
}

// เปลี่ยนหน้าโดยไม่โหลดใหม่ — เร็วเท่าเดิม แต่ URL บนแถบที่อยู่เป็น path จริง
const go = path => {
  const target = path.startsWith('/') ? path : '/' + path;
  if (target === location.pathname + location.search) return;
  history.pushState({}, '', target);
  route();
};

let _focusSearch = false;
function goSearch() {
  const h = location.pathname.replace(/\/+$/, '') || '/';
  if (h === '/apps') {
    document.getElementById('appSearch')?.focus();
  } else if (h === '/blog') {
    document.getElementById('blogSearch')?.focus();
  } else {
    _focusSearch = true;
    go('/blog');
  }
}

// ปุ่มย้อนกลับ/ไปข้างหน้าของเบราว์เซอร์
window.addEventListener('popstate', route);

// ดักคลิกลิงก์ภายในเว็บ → เปลี่ยนหน้าแบบไม่โหลดใหม่
// ถ้า JS พัง ลิงก์ยังเป็น <a href> ปกติที่กดแล้วโหลดหน้าจริงได้อยู่ดี
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href') || '';
  if (!href.startsWith('/') || href.startsWith('//')) return;   // ลิงก์นอกเว็บ ปล่อยผ่าน
  // หน้าที่ไม่ได้อยู่ใน SPA — ให้โหลดเต็มหน้าตามปกติ
  // /apps/6 เป็นหน้าเฉพาะของแอปที่เสิร์ฟจาก server (คนละหน้ากับคลังแอป)
  if (/^\/(admin|board|api|sitemap\.xml|robots\.txt)/.test(href)) return;
  if (/^\/apps\/\d+/.test(href)) return;
  e.preventDefault();
  go(href);
});

// ── PWA: ป้องกัน auto-prompt ของ browser (ถ้าผู้ใช้อยากติดตั้ง ใช้ menu ของ browser เอง) ──
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); });

// เมื่อ viewport เปลี่ยน (resize) — redraw apps page ถ้าอยู่ในนั้น (กัน pagination แตก)
let _appRz;
window.addEventListener('resize', () => {
  clearTimeout(_appRz);
  _appRz = setTimeout(() => {
    if (location.pathname.startsWith('/apps') && document.getElementById('appsContent')) drawApps();
  }, 250);
});
const toggleNav = () => document.getElementById('navLinks').classList.toggle('open');

// ── HOME ─────────────────────────────────────────────────
async function renderHome() {
  const app = document.getElementById('app');
  app.innerHTML = skCards(6);
  const [artData, appData] = await Promise.all([get('/articles?page=1'), get('/apps')]);
  const arts = artData.articles || [];
  const appsArr = appData.apps || [];
  const [feat, ...rest] = arts;
  const sideArts = rest.slice(0,3);
  const gridArts = rest.slice(3,9);

  // ── มงกุฎกระดานดำ: บทความเด่น + น่าอ่านต่อ (ในโซนหมึก) ──
  const crown = document.getElementById('crownSlot');
  if (crown) crown.innerHTML = feat ? `
  <div class="crown">
    <div class="container" style="position:relative;">
      <div class="crown-grid">
        <div class="crown-feat rv" onclick="go('/article/${feat.id}')">
          <div class="stamp">${feat.pinned?'<b>📌</b><small>Pin</small>':'<b>✦</b><small>เด่น</small>'}</div>
          <div class="crown-meta"><span class="crown-cat">${feat.category}</span><span>${fmt(feat.created_at)}</span></div>
          <h2>${feat.title}</h2>
          <p class="cx">${feat.excerpt||''}</p>
          <span class="crown-read">อ่านบทความ →</span>
        </div>
        <div class="crown-side rv2">
          <div class="crown-side-label">น่าอ่านต่อ</div>
          ${sideArts.map((a,i)=>`
          <div class="crown-item" onclick="go('/article/${a.id}')">
            <div class="crown-num">${a.pinned?'📌':(i+1)}</div>
            <div><h3>${a.title}</h3><div class="ci-cat">${a.category} · ${fmt(a.created_at)}</div></div>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>
  <div class="crown-edge"></div>` : '<div style="height:18px;"></div>';

  app.innerHTML = `
  <div class="container" style="padding-bottom:8px;">
    ${adSlot()}
    <div class="cat-strip rv" id="catStrip" style="margin-top:26px;"></div>

    ${gridArts.length ? `
    <div class="rv2" style="margin-bottom:36px;">
      <div class="sec-head">
        <div><div class="sec-title">บทความล่าสุด</div><div class="sec-sub">อัปเดตเทคนิคการสอน ข่าวการศึกษา และเครื่องมือใหม่</div></div>
        <span class="sec-more" onclick="go('/blog')">ดูทั้งหมด →</span>
      </div>
      <div class="arts-grid">
        ${gridArts.map(artCard).join('')}
      </div>
    </div>` : ''}

    ${adSlot()}

    ${appsArr.length ? `
    <div class="apps-box rv3">
      <div class="sec-head">
        <div><div class="sec-title mint">แอปที่ใช้งานได้เลย</div><div class="sec-sub">เปิดใช้ในห้องเรียนได้ทันที — พร้อม Prompt ให้นำไปต่อยอด</div></div>
        <span class="sec-more" onclick="go('/apps')">ดูทั้งหมด →</span>
      </div>
      <div class="apps-grid">
        ${appsArr.slice(0,3).map(appCard).join('')}
      </div>
    </div>` : ''}

    ${adSlot()}
  </div>`;
  loadCategories();
  activateAds();
}

// ── BLOG ─────────────────────────────────────────────────
let blogQ = '', blogCat = 'ทั้งหมด', blogPage = 1;
async function renderBlog(q, cat, page) {
  if (q !== undefined) blogQ = q;
  if (cat !== undefined) blogCat = cat;
  if (page !== undefined) blogPage = page;
  const app = document.getElementById('app');
  app.innerHTML = skList(6);

  const catParam = blogCat === 'ทั้งหมด' ? '' : blogCat;
  const url = `/articles?q=${encodeURIComponent(blogQ)}&category=${encodeURIComponent(catParam)}&page=${blogPage}`;
  const data = await get(url);
  const arts = data.articles || [];
  const total = data.total || 0;
  const pages = Math.ceil(total / 9);

  app.innerHTML = `
  <div class="container" style="padding-bottom:32px;">
    <div class="page-head rv">
      <h1>บทความทั้งหมด</h1>
      <div class="ph-sub">เทคนิคการสอน ข่าวการศึกษา และเครื่องมือสำหรับครู</div>
    </div>
    <div class="search-row rv">
      <input class="search-in" id="blogSearch" placeholder="🔍 ค้นหาบทความ..." value="${blogQ}"
        onkeydown="if(event.key==='Enter')renderBlog(this.value,undefined,1)">
      <button class="btn btn-primary" style="padding:9px 18px;" onclick="renderBlog(document.getElementById('blogSearch').value,undefined,1)">ค้นหา</button>
    </div>
    <div class="cat-strip rv2" id="blogCats"></div>
    ${adSlot()}
    ${arts.length
      ? `<div class="arts-grid rv2">${arts.map(artCard).join('')}</div>`
      : `<div class="empty">📭<br>ไม่พบบทความ</div>`}
    ${pages > 1 ? `
    <div class="pagination">
      ${blogPage > 1 ? `<button class="page-btn" onclick="renderBlog(undefined,undefined,${blogPage-1})">← ก่อนหน้า</button>` : ''}
      ${[...Array(Math.min(pages,5))].map((_,i)=>{
        const p = i+1;
        return `<button class="page-btn ${p===blogPage?'active':''}" onclick="renderBlog(undefined,undefined,${p})">${p}</button>`;
      }).join('')}
      ${blogPage < pages ? `<button class="page-btn" onclick="renderBlog(undefined,undefined,${blogPage+1})">ถัดไป →</button>` : ''}
    </div>` : ''}
  </div>`;
  loadBlogCats();
  activateAds();
  if (_focusSearch) { _focusSearch = false; document.getElementById('blogSearch')?.focus(); }
}

function loadBlogCats() {
  const el = document.getElementById('blogCats');
  if (!el) return;
  const cats = ['ทั้งหมด', ...getCats()];
  el.innerHTML = cats.map(c =>
    `<span class="cat-pill ${blogCat===c?'active':''}" onclick="renderBlog(undefined,'${c}',1)">${c}</span>`
  ).join('');
}

// ── SINGLE ARTICLE ───────────────────────────────────────
async function renderArticle(slugOrId) {
  const app = document.getElementById('app');
  app.innerHTML = skArticle();
  let art;
  try {
    art = await get('/articles/' + slugOrId);
  } catch (e) {
    // 404 = ไม่มีบทความนี้จริงๆ → โชว์หน้า 404 ที่อ่านง่าย; error อื่น (เน็ต/เซิร์ฟเวอร์) ปล่อยให้ safeView จัดการ
    if (e && e.status === 404) { render404('ไม่พบบทความนี้ — อาจถูกลบหรือยังไม่เผยแพร่'); return; }
    throw e;
  }
  if (art.error) { render404('ไม่พบบทความนี้ — อาจถูกลบหรือยังไม่เผยแพร่'); return; }
  // comments ผูกกับ article_id (ตัวเลข) — ใช้ id จริงจากบทความ
  const cmtData = await get('/comments/' + art.id).catch(() => ({ comments: [] }));
  // ลิงก์แชร์แบบสั้น: ใช้ id แทน slug ไทยที่ encode ยาว
  const shareUrl = `${SITE}/article/${art.id}`;  // URL จริง — crawler เห็น OG tags

  app.innerHTML = `
  <div class="art-wrap rv">
    <div class="back-btn" onclick="go('/blog')">← กลับรายการบทความ</div>
    <h1>${art.title}</h1>
    <div class="art-info">
      <span class="${catTag(art.category)}">${art.category}</span>
      <span>📅 ${fmt(art.created_at)}</span>
      <span>✍️ ${art.author_name || S.author_name||'ผู้เขียน'}</span>
      <span>👁 ${art.views||0} ครั้ง</span>
    </div>
    ${adSlot()}
    <div class="art-body">${addLazyLoading(art.content||'')}</div>
    <div style="margin-top:28px;">${adSlot()}</div>
    <div style="margin-top:24px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <strong style="font-size:.9rem;">แชร์:</strong>
      <a class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
         href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}" target="_blank">💬 LINE</a>
      <a class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
         href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank">📘 Facebook</a>
      <button class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
              onclick="navigator.clipboard.writeText('${shareUrl}');this.textContent='✓ คัดลอกแล้ว'">🔗 คัดลอกลิงก์</button>
    </div>
    <div id="relatedBox"></div>
    <div class="comments-box" id="cmtBox">
      <h3>💬 ความคิดเห็น (${(cmtData.comments||[]).length})</h3>
      ${(cmtData.comments||[]).map(c=>`
      <div class="comment-item">
        <div class="comment-meta">👤 ${esc(c.name)} · ${fmt(c.created_at)}</div>
        <div class="comment-text">${esc(c.content)}</div>
      </div>`).join('')}
      <div class="comment-form">
        <h4 style="font-size:.98rem;font-weight:600;margin-bottom:14px;">แสดงความคิดเห็น</h4>
        <div class="form-row">
          <input class="form-input" id="cmtName" placeholder="ชื่อของคุณ">
        </div>
        <textarea class="form-ta" id="cmtText" placeholder="เขียนความคิดเห็น..."></textarea>
        <button class="btn btn-primary" style="margin-top:10px;"
                onclick="submitComment(${art.id})">ส่งความคิดเห็น</button>
        <p id="cmtMsg" style="font-size:.83rem;color:#059669;margin-top:8px;display:none;"></p>
      </div>
    </div>
  </div>`;
  activateAds();

  // ── SEO: meta + JSON-LD สำหรับบทความนี้ ──
  const siteTitle = S.site_title || 'Kru-ti ครูติ TH';
  const artUrl = `${SITE}/article/${art.id}`;
  setPageMeta({
    title: art.title,
    desc:  art.excerpt || art.title,
    image: art.image_url || '',
    url:   artUrl,
    type:  'article',
    ld: {
      '@context': 'https://schema.org',
      '@type':    'Article',
      headline:   art.title,
      description: art.excerpt || '',
      image:       art.image_url ? [art.image_url] : [],
      datePublished: art.created_at || '',
      dateModified:  art.updated_at || art.created_at || '',
      author: {
        '@type': 'Person',
        name:    art.author_name || S.author_name || 'Kru-ti ครูติ',
        url:     SITE + '/about',
      },
      publisher: {
        '@type': 'Organization',
        name:    siteTitle,
        logo: {
          '@type': 'ImageObject',
          url: `${SITE}/icon-512.png`,
        },
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id':   artUrl,
      },
    },
  });

  // ── บทความที่เกี่ยวข้อง: หมวดเดียวกัน 3 ชิ้น (ไม่นับตัวเอง) ──
  loadRelated(art);
}

async function loadRelated(art) {
  const box = document.getElementById('relatedBox');
  if (!box) return;
  try {
    const data = await get('/articles?page=1');
    let pool = (data.articles || []).filter(a => a.id !== art.id);
    // หมวดเดียวกันก่อน → ถ้าไม่ครบ 3 เติมด้วยล่าสุด
    const same  = pool.filter(a => a.category === art.category);
    const other = pool.filter(a => a.category !== art.category);
    const rel = [...same, ...other].slice(0, 3);
    if (!rel.length) return;
    box.innerHTML = `
    <div style="margin-top:42px;padding-top:30px;border-top:1px solid var(--line);">
      <div class="sec-title" style="font-size:1.25rem;margin-bottom:18px;">บทความที่เกี่ยวข้อง</div>
      <div class="arts-grid">${rel.map(artCard).join('')}</div>
    </div>`;
  } catch(e) { /* เงียบ — related เป็นของเสริม */ }
}

async function submitComment(articleId) {
  const name = document.getElementById('cmtName').value.trim();
  const content = document.getElementById('cmtText').value.trim();
  const msg = document.getElementById('cmtMsg');
  if (!name || !content) { showMsg(msg, 'กรุณากรอกชื่อและความคิดเห็น', '#ea580c'); return; }
  const res = await fetch(API + '/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article_id: articleId, name, content })
  }).then(r => r.json());
  if (res.ok) {
    document.getElementById('cmtName').value = '';
    document.getElementById('cmtText').value = '';
    showMsg(msg, '✓ ส่งความคิดเห็นแล้ว รอการอนุมัติจากผู้ดูแล', '#059669');
  }
}

// ── APPS PAGE ────────────────────────────────────────────
let _allApps = [], _appFilter = 'all', _appSort = 'newest', _appQ = '';
let _appView = 'block', _pageFree = 1, _pageLocked = 1, _pageVip = 1, _pageOther = 1, _pageTable = 1;
let _popularDays = 30;  // ช่วงเวลานับยอดนิยม: 30/7/0(ทั้งหมด)

// อ่าน preferences จาก localStorage (จำ view + filter ของผู้ใช้)
try {
  const pref = JSON.parse(localStorage.getItem('appsPref') || '{}');
  if (pref.view === 'block' || pref.view === 'table') _appView = pref.view;
  if (pref.filter) _appFilter = pref.filter;
  if (pref.sort) _appSort = pref.sort;
  if (pref.popularDays !== undefined) _popularDays = pref.popularDays;
} catch(e) {}

function saveAppsPref() {
  try { localStorage.setItem('appsPref', JSON.stringify({ view:_appView, filter:_appFilter, sort:_appSort, popularDays:_popularDays })); } catch(e) {}
}

// คำนวณจำนวนแอปต่อหน้าตาม viewport (block view: 3 rows × N cols)
function calcPageSize() {
  const w = window.innerWidth;
  if (w < 600) return 3;        // มือถือ: 1 col × 3 rows
  if (w < 900) return 6;        // tablet: 2 col × 3 rows
  if (w < 1200) return 9;       // เล็ก: 3 col × 3 rows
  return 12;                    // PC: 4 col × 3 rows
}

async function renderApps(openId) {
  const app = document.getElementById('app');
  app.innerHTML = skCards(9);
  // ถ้า sort=popular ต้องดึง view_count มาด้วย (ส่ง popular_days)
  const url = _appSort === 'popular' ? `/apps?popular_days=${_popularDays}` : '/apps';
  const data = await get(url);
  _allApps = data.apps || [];
  // ไม่ reset _appFilter, _appSort, _appView — โหลดจาก localStorage แล้ว
  _appQ = '';
  _pageFree = _pageLocked = _pageVip = _pageOther = _pageTable = 1;

  const cats = [...new Set(_allApps.map(a => a.category).filter(Boolean))];
  const pills = [
    {k:'all',    label:'ทั้งหมด'},
    {k:'free',   label:'🆓 ฟรี'},
    {k:'locked', label:'🔒 พรีเมียม'},
    {k:'vip',    label:'👑 VIP'},
    ...cats.map(c => ({k:c, label:c})),
  ];
  const pillHTML = pills.map(p =>
    `<span class="cat-pill" data-k="${esc(p.k)}"
      onclick="setAppFilter('${p.k.replace(/'/g,"\\'")}')">${p.label}</span>`
  ).join('');

  // ค่า sort ปัจจุบันสำหรับ popular: รวม sort+days เป็น 'popular-30' / 'popular-7' / 'popular-0'
  const sortVal = _appSort === 'popular' ? `popular-${_popularDays}` : _appSort;
  const sortHTML = `
    <select onchange="setAppSort(this.value)"
      style="padding:8px 13px;border:1.5px solid var(--line);border-radius:10px;font-family:'Sarabun',sans-serif;
             font-size:.88rem;font-weight:600;color:var(--ink);background:var(--card);cursor:pointer;outline:none;">
      <option value="newest" ${sortVal==='newest'?'selected':''}>🕐 ล่าสุด</option>
      <option value="oldest" ${sortVal==='oldest'?'selected':''}>🕐 เก่าสุด</option>
      <option value="name" ${sortVal==='name'?'selected':''}>🔤 ชื่อ A-Z</option>
      <option value="popular-30" ${sortVal==='popular-30'?'selected':''}>🔥 ยอดนิยม (30 วัน)</option>
      <option value="popular-7" ${sortVal==='popular-7'?'selected':''}>🔥 ยอดนิยม (7 วัน)</option>
      <option value="popular-0" ${sortVal==='popular-0'?'selected':''}>🔥 ยอดนิยม (ทั้งหมด)</option>
    </select>`;

  const viewToggleHTML = `
    <div class="view-toggle">
      <button class="vt-btn ${_appView==='block'?'on':''}" onclick="setAppView('block')" title="มุมมองบล็อก">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <span>บล็อก</span>
      </button>
      <button class="vt-btn ${_appView==='table'?'on':''}" onclick="setAppView('table')" title="มุมมองตาราง">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        <span>ตาราง</span>
      </button>
    </div>`;

  const hasLocked = _allApps.some(a => a.locked);
  const redeemHTML = hasLocked ? `
    <div class="redeem-row rv2">
      <span class="redeem-ico">🎟️</span>
      <input id="redeemCode" placeholder="มีรหัสปลดล็อก? กรอกที่นี่เพื่อปลดทุกแอปในชุด"
             onkeydown="if(event.key==='Enter')redeemAll()">
      <button onclick="redeemAll()">ปลดล็อก</button>
      <span id="redeemMsg"></span>
    </div>
    <p style="text-align:center;font-size:.88rem;color:var(--slate);margin:-14px 0 24px;">
      ยังไม่มีรหัส? <a href="/buy" style="color:var(--gold-deep);font-weight:700;">ดูวิธีซื้อรหัสปลดล็อก →</a>
    </p>` : '';

  // ── วาด shell ครั้งเดียว — search/filter/redeem อยู่นิ่ง ไม่ถูก re-render ──
  app.innerHTML = `
  <div class="container" style="padding-bottom:32px;">
    <div class="page-head rv" style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <h1>คลังแอปทั้งหมด</h1>
        <div class="ph-sub">เปิดใช้ได้ทันทีในห้องเรียน — แอปฟรีและพรีเมียม</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${viewToggleHTML}
        ${sortHTML}
      </div>
    </div>
    <div class="search-row rv" style="margin-bottom:14px;">
      <input class="search-in" id="appSearch" placeholder="🔍 ค้นหาแอป..."
        oninput="filterApps(this.value)">
    </div>
    <div class="cat-strip rv2" id="appPills" style="margin-bottom:20px;">${pillHTML}</div>
    ${redeemHTML}
    ${adSlot()}
    <div id="appsContent"></div>
    <div style="margin-top:24px;">${adSlot()}</div>
  </div>`;
  drawApps();
  activateAds();

  // ── แชร์ลิงก์: ?open=id → เปิดแอปอัตโนมัติ ──
  if (openId) {
    const target = _allApps.find(a => String(a.id) === String(openId));
    if (target) {
      const raw = sessionStorage.getItem('unlocked_' + target.id);
      const storedUrl = (raw && raw.startsWith('http')) ? raw : null;
      if (target.locked && !storedUrl) {
        // แอปล็อก → เด้ง modal ให้กรอกรหัส
        openLockModal(target.id, target.title, target.icon || '🎮');
      } else {
        openAppViewer(storedUrl || target.url, target.title, target.icon || '🎮', target.id);
      }
    }
  }
}

// วาดเฉพาะกริดแอป — ไม่แตะ input/search (กัน keyboard เด้งบนมือถือ)
function drawApps() {
  const cont = document.getElementById('appsContent');
  if (!cont) return;

  // sync สถานะ active ของ pills โดยไม่ rebuild (กัน reflow)
  document.querySelectorAll('#appPills .cat-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.k === _appFilter);
  });

  const sorted = [..._allApps].sort((a, b) => {
    if (_appSort === 'oldest') return (a.created_at||'') > (b.created_at||'') ? 1 : -1;
    if (_appSort === 'name')   return (a.title||'').localeCompare(b.title||'', 'th');
    if (_appSort === 'popular') {
      // ยอดนิยม: view_count มาก → น้อย, ถ้าเท่ากันใช้ล่าสุด tie-break
      const va = a.view_count || 0, vb = b.view_count || 0;
      if (vb !== va) return vb - va;
      return (a.created_at||'') < (b.created_at||'') ? 1 : -1;
    }
    return (a.created_at||'') < (b.created_at||'') ? 1 : -1;
  });

  let filtered = sorted;
  if (_appFilter === 'free')        filtered = sorted.filter(a => !a.locked);
  else if (_appFilter === 'locked') filtered = sorted.filter(a => a.locked);
  else if (_appFilter === 'vip')    filtered = sorted.filter(a => a.is_vip);
  else if (_appFilter !== 'all')    filtered = sorted.filter(a => a.category === _appFilter);

  if (_appQ.trim()) {
    const q = _appQ.trim().toLowerCase();
    filtered = filtered.filter(a =>
      (a.title||'').toLowerCase().includes(q) ||
      (a.description||'').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    cont.innerHTML = `<div class="empty">📭<br>ไม่พบแอปที่ตรงกัน</div>`;
    return;
  }

  // ── TABLE VIEW ──
  if (_appView === 'table') {
    cont.innerHTML = renderTableView(filtered);
    return;
  }

  // ── BLOCK VIEW ──
  const pageSize = calcPageSize();

  // เมื่อ filter = all → แยกกลุ่ม free + locked + pagination แยก
  if (_appFilter === 'all') {
    const free   = filtered.filter(a => !a.locked);
    const locked = filtered.filter(a =>  a.locked);
    let content = '';
    if (free.length > 0)   content += renderBlockGroup('แอปฟรี', 'mint', 'var(--mint-soft)', 'var(--mint)', free, _pageFree, pageSize, 'free');
    if (locked.length > 0) content += renderBlockGroup('แอปพรีเมียม', '', 'var(--gold-soft)', 'var(--gold-deep)', locked, _pageLocked, pageSize, 'locked');
    cont.innerHTML = content;
  }
  // filter เฉพาะ → แสดงกลุ่มเดียว + pagination
  else {
    const groupKey = _appFilter === 'vip' ? 'vip' : 'other';
    const page = groupKey === 'vip' ? _pageVip : _pageOther;
    cont.innerHTML = `<div class="apps-grid">${filtered.slice((page-1)*pageSize, page*pageSize).map(appCard).join('')}</div>
      ${pagerHTML(filtered.length, page, pageSize, groupKey)}`;
  }
}

// render section ใน block view + pagination ของ section นั้น
function renderBlockGroup(title, titleClass, badgeBg, badgeColor, items, page, pageSize, groupKey) {
  const slice = items.slice((page-1)*pageSize, page*pageSize);
  return `<div style="margin-bottom:30px;">
    <h2 class="sec-title ${titleClass}" style="font-size:1.18rem;margin-bottom:14px;">${title} <span style="background:${badgeBg};color:${badgeColor};padding:2px 11px;border-radius:100px;font-size:.76rem;font-family:'Sarabun';vertical-align:middle;">${items.length}</span></h2>
    <div class="apps-grid">${slice.map(appCard).join('')}</div>
    ${pagerHTML(items.length, page, pageSize, groupKey)}
  </div>`;
}

// pagination component
function pagerHTML(total, current, pageSize, groupKey) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return '';
  let buttons = `<button onclick="gotoPage('${groupKey}',${current-1})" ${current===1?'disabled':''}>‹</button>`;
  // แสดงเลขหน้า: หน้า 1, ..., n-1, n, n+1, ..., last
  const pages = new Set([1, totalPages, current, current-1, current+1]);
  const sortedPages = [...pages].filter(p => p>=1 && p<=totalPages).sort((a,b)=>a-b);
  let prev = 0;
  for (const p of sortedPages) {
    if (p - prev > 1) buttons += `<span class="pinfo">…</span>`;
    buttons += `<button class="${p===current?'on':''}" onclick="gotoPage('${groupKey}',${p})">${p}</button>`;
    prev = p;
  }
  buttons += `<button onclick="gotoPage('${groupKey}',${current+1})" ${current===totalPages?'disabled':''}>›</button>`;
  return `<div class="pager">${buttons}</div>`;
}

// table view + pagination 20 row/page
function renderTableView(items) {
  const perPage = 20;
  const total = items.length;
  const totalPages = Math.ceil(total / perPage);
  if (_pageTable > totalPages) _pageTable = 1;
  const slice = items.slice((_pageTable-1)*perPage, _pageTable*perPage);

  const rows = slice.map(a => {
    const pid = `p_${a.id}`;
    const raw = sessionStorage.getItem('unlocked_'+a.id);
    const storedUrl = (raw && raw.startsWith('http')) ? raw : null;
    const isLocked = a.locked && !storedUrl;
    const appUrl = storedUrl || a.url;
    const tier = a.is_vip ? '<span class="at-tier vip">👑 VIP</span>'
               : a.locked ? '<span class="at-tier lock">🔒 พรีเมียม</span>'
               : '<span class="at-tier free">🆓 ฟรี</span>';
    const btn = isLocked
      ? `<button class="at-btn lock" onclick="openLockModal(${a.id},'${esc(a.title).replace(/'/g,"\\'")}','${a.icon||'🎮'}')">🔒 ปลดล็อก</button>`
      : (appUrl ? `<button class="at-btn" onclick="openAppViewer('${encodeURI(appUrl)}','${esc(a.title).replace(/'/g,"\\'")}','${a.icon||'🎮'}',${a.id})">🚀 เปิด</button>` : '');
    return `<tr>
      <td class="at-icon">${a.icon||'🎮'}</td>
      <td><div class="at-title">${esc(a.title)}</div><div class="at-desc">${esc(a.description||'')}</div></td>
      <td class="at-hide-mobile">${esc(a.category||'')}</td>
      <td>${tier}</td>
      <td class="at-hide-mobile at-date">${fmt(a.created_at)}</td>
      <td>${btn}</td>
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;">
    <table class="apps-table">
      <thead><tr>
        <th></th><th>ชื่อแอป</th><th class="at-hide-mobile">หมวดหมู่</th><th>ประเภท</th><th class="at-hide-mobile">วันที่</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="color:var(--slate);font-size:.82rem;text-align:center;margin-top:10px;">
    แสดง ${(_pageTable-1)*perPage+1}–${Math.min(_pageTable*perPage,total)} จาก ${total} แอป
  </div>
  ${pagerHTML(total, _pageTable, perPage, 'table')}`;
}

// ใส่รหัสเดียว ปลดทุกแอปที่รหัสนั้นเข้าได้
async function redeemAll() {
  const inp = document.getElementById('redeemCode');
  const msg = document.getElementById('redeemMsg');
  const code = (inp.value || '').trim();
  if (!code) { showMsg(msg, 'กรุณากรอกรหัส', '#ea580c'); return; }
  showMsg(msg, '⏳ กำลังตรวจรหัส...', '#6d7588');
  try {
    const r = await fetch(API + '/apps/unlock-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }).then(r => r.json());
    if (r.error) { showMsg(msg, '❌ ' + r.error, '#dc2626'); return; }
    const list = r.unlocked || [];
    list.forEach(a => { if (a.url) sessionStorage.setItem('unlocked_' + a.id, a.url); });
    showMsg(msg, `✅ ปลดล็อกสำเร็จ ${list.length} แอป!`, '#0fa294');
    setTimeout(drawApps, 700);
  } catch (e) {
    showMsg(msg, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', '#dc2626');
  }
}

function filterApps(q)   { _appQ      = q; _pageFree = _pageLocked = _pageVip = _pageOther = _pageTable = 1; drawApps(); }
function setAppFilter(f) { _appFilter = f; _pageFree = _pageLocked = _pageVip = _pageOther = _pageTable = 1; saveAppsPref(); drawApps(); }
function setAppSort(s)   {
  const wasPopular = _appSort === 'popular';
  // parse 'popular-30' / 'popular-7' / 'popular-0' → sort='popular' + days
  if (s.startsWith('popular-')) {
    _popularDays = parseInt(s.split('-')[1]) || 0;
    _appSort = 'popular';
  } else {
    _appSort = s;
  }
  saveAppsPref();
  // ถ้าเข้า/ออกจาก popular → ต้อง re-fetch จาก backend
  if (_appSort === 'popular' || wasPopular) renderApps();
  else drawApps();
}
function setAppView(v)   { _appView   = v; saveAppsPref(); renderApps(); }
function gotoPage(group, p) {
  if (group === 'free') _pageFree = p;
  else if (group === 'locked') _pageLocked = p;
  else if (group === 'vip') _pageVip = p;
  else if (group === 'other') _pageOther = p;
  else if (group === 'table') _pageTable = p;
  drawApps();
  // scroll ขึ้นบน section
  document.getElementById('appsContent')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── ABOUT ─────────────────────────────────────────────────
function renderAbout() {
  const title = S.site_title || 'Kru-ti ครูติ TH';
  const author = S.author_name || 'ผู้สร้าง';
  document.getElementById('app').innerHTML = `
  <div class="art-wrap rv">
    <h1 style="margin-bottom:24px;">เกี่ยวกับเรา</h1>

    <div class="art-body">
      <h2>เราคือใคร?</h2>
      <p><strong>${title}</strong> คือแพลตฟอร์มรวมสื่อการสอนแบบ Interactive สำหรับครูและนักเรียนไทย ก่อตั้งโดยครูที่อยู่ในห้องเรียนจริง เพื่อแก้ปัญหาที่ครูทุกคนพบเหมือนกัน — ขาดเครื่องมือดิจิทัลที่ใช้สอนได้ทันที ฟรี และเหมาะกับบริบทไทย</p>

      <p>เราเริ่มต้นจากความเชื่อง่าย ๆ ว่า <em>"ครูไทยควรมีเครื่องมือที่ดีไม่แพ้ครูที่ไหนในโลก"</em> ทุกแอปและบทความบนเว็บไซต์นี้ถูกออกแบบ ทดลอง และปรับปรุงจากการใช้งานจริงในห้องเรียน ไม่ใช่จากทฤษฎีบนกระดาษ</p>

      <h2>พันธกิจของเรา</h2>
      <p>เราต้องการเปลี่ยนการเรียนการสอนในประเทศไทยให้ดีขึ้น ผ่าน 3 วิธี:</p>
      <ul>
        <li><strong>สร้างเครื่องมือฟรี</strong> — แอปและใบงานที่ครูทุกคนเข้าถึงได้ ไม่ว่าจะอยู่ในโรงเรียนที่มีงบมากหรือน้อย</li>
        <li><strong>แบ่งปันความรู้</strong> — บทความเกี่ยวกับเทคนิคการสอน เทคโนโลยีการศึกษา และการใช้ AI ในห้องเรียน</li>
        <li><strong>สร้างชุมชน</strong> — เปิด prompt ให้ครูคนอื่น ๆ ต่อยอด สร้างเครื่องมือของตัวเอง ไม่กั๊กความรู้</li>
      </ul>

      <h2>สิ่งที่คุณจะได้จากเว็บนี้</h2>
      <ul>
        <li><strong>แอปการศึกษา Interactive</strong> — ครอบคลุมคณิตศาสตร์ ภาษาไทย ภาษาอังกฤษ และทักษะอื่น ๆ ตั้งแต่ ป.1 ถึง ม.6 ใช้งานได้ทันทีไม่ต้องติดตั้ง พัฒนาเพิ่มต่อเนื่อง</li>
        <li><strong>ใบงานพร้อมใช้</strong> — ดาวน์โหลดได้ฟรี ปรับใช้ในห้องเรียนได้ทันที</li>
        <li><strong>บทความเชิงลึก</strong> — เกี่ยวกับนวัตกรรมการสอน การประยุกต์ใช้ AI และวิธีคิดสำหรับครูยุคใหม่</li>
        <li><strong>KruBoard</strong> — ระบบส่งการบ้านแบบดิจิทัล ครูตรวจง่าย นักเรียนส่งได้ผ่านมือถือ</li>
      </ul>

      <h2>ผู้สร้าง</h2>
      <p><strong>${author}</strong> — ครูสอนวิชาภาษาอังกฤษ จบการศึกษาระดับปริญญาโทด้านหลักสูตรและการสอน (Curriculum and Instruction) มีประสบการณ์สอนตั้งแต่ระดับประถมศึกษาตอนต้นจนถึงมัธยมศึกษาตอนปลาย และเป็นนักพัฒนาอิสระด้านสื่อการเรียนรู้ดิจิทัล</p>
      <p>นอกจากการสอน ยังเป็นนักเขียน นักข่าวอดีต และนักเล่าเรื่องที่หลงใหลในการใช้เทคโนโลยีเพื่อยกระดับการศึกษาไทย</p>

      <h2>วิธีที่เราทำงาน</h2>
      <p>ทุกแอปและบทความบนเว็บนี้ผ่านกระบวนการต่อไปนี้:</p>
      <ol>
        <li><strong>เริ่มจากปัญหาจริง</strong> — มาจากห้องเรียนของผู้สร้าง หรือจากคำถามของครูคนอื่น ๆ</li>
        <li><strong>ออกแบบและทดลอง</strong> — ใช้กับนักเรียนจริงก่อน ดูว่าได้ผล ไม่งง ไม่ติดขัด</li>
        <li><strong>ปรับปรุงตามฟีดแบ็ก</strong> — รับฟังเสียงครูและนักเรียน อัปเดตอย่างต่อเนื่อง</li>
        <li><strong>แบ่งปันแบบเปิด</strong> — เปิดให้ใช้ฟรี และเปิด prompt ให้นำไปต่อยอด</li>
      </ol>

      <h2>ความเชื่อของเรา</h2>
      <ul>
        <li><strong>การศึกษาควรเข้าถึงได้ทุกคน</strong> — เราจึงให้ฟรีให้มากที่สุดเท่าที่ทำได้</li>
        <li><strong>ครูคือผู้สร้างความเปลี่ยนแปลง</strong> — เราออกแบบทุกอย่างเพื่อให้ครูทำงานง่ายขึ้น ไม่ใช่ยากขึ้น</li>
        <li><strong>AI คือผู้ช่วย ไม่ใช่ผู้แทน</strong> — เราเชื่อว่าครูยังเป็นหัวใจของการเรียนรู้เสมอ</li>
      </ul>

      <h2>ติดต่อเรา</h2>
      <p>หากมีข้อสงสัย ข้อเสนอแนะ อยากให้พัฒนาแอปใหม่ ๆ หรืออยากร่วมมือสร้างสรรค์สิ่งดี ๆ ให้การศึกษาไทย ยินดีรับฟังทุกความคิดเห็น</p>
      <p>📧 อีเมล: <a href="mailto:kruti.edu@gmail.com" style="color:var(--mint);font-weight:700;">kruti.edu@gmail.com</a></p>
      <p>📘 Facebook: <a href="https://www.facebook.com/kruti.edu" target="_blank" rel="noopener" style="color:var(--mint);font-weight:700;">facebook.com/kruti.edu</a></p>
      <p style="margin-top:18px;color:var(--slate);font-size:.92rem;">เราอ่านทุกข้อความและตอบกลับโดยปกติภายใน 1-3 วัน</p>
    </div>

    <div style="margin-top:32px;">
      <a class="btn btn-outline" href="/">← กลับหน้าหลัก</a>
    </div>
  </div>`;
  // เพิ่ม structured data (Organization schema) — ช่วย Google เข้าใจตัวตนเว็บ
  setPageMeta({
    // setPageMeta เติมชื่อเว็บต่อท้ายให้อยู่แล้ว ไม่ต้องใส่ซ้ำ ไม่งั้นได้ "เกี่ยวกับเรา · X — X"
    title: 'เกี่ยวกับเรา',
    // ชื่อพารามิเตอร์คือ desc ไม่ใช่ description — ที่ผ่านมาจึงถูกเมินเงียบ ๆ
    // คำอธิบาย SEO ของหน้านี้เลยไม่เคยถูกตั้งเลย
    desc: title + ' — แพลตฟอร์มสื่อการสอน Interactive สำหรับครูและนักเรียนไทย ฟรี เปิดให้ใช้ได้ทันที',
    url: SITE + '/about',
  });
}

// ── BUY / วิธีซื้อรหัส ─────────────────────────────────────
const FB_PAGE = 'https://www.facebook.com/kruti.edu';
// ══ ใบงาน: หน้ารวม ══════════════════════════════════════
let _allWs = [], _wsView = 'grid', _wsFilter = 'all', _wsQ = '';

async function renderWorksheets() {
  const app = document.getElementById('app');
  app.innerHTML = skCards(6);
  const data = await get('/worksheets');
  _allWs = data.worksheets || [];
  _wsFilter = 'all'; _wsQ = '';
  _wsView = localStorage.getItem('_wsView') || 'grid';

  const cats = [...new Set(_allWs.map(w => w.category).filter(Boolean))];
  const pills = [{k:'all',label:'ทั้งหมด'}, {k:'free',label:'🆓 ฟรี'}, {k:'locked',label:'🔒 พรีเมียม'},
    ...cats.map(c => ({k:c, label:c}))];
  const pillHTML = pills.map(p =>
    `<span class="cat-pill" data-k="${esc(p.k)}" onclick="setWsFilter('${p.k.replace(/'/g,"\\'")}')">${p.label}</span>`
  ).join('');

  setPageMeta({ title: 'คลังใบงาน', desc: 'ใบงานพร้อมใช้ สำหรับครูไทย ดาวน์โหลดได้ทันที' });

  app.innerHTML = `
  <div class="container" style="padding-bottom:32px;">
    <div class="page-head rv">
      <h1>คลังใบงาน</h1>
      <div class="ph-sub">ใบงานพร้อมพิมพ์ใช้ในห้องเรียน — ดาวน์โหลดเป็น PDF</div>
    </div>
    <div class="ws-toolbar rv">
      <div class="search-row" style="flex:1;min-width:200px;margin:0;">
        <input class="search-in" id="wsSearch" placeholder="🔍 ค้นหาใบงาน..." oninput="filterWs(this.value)">
      </div>
      <div class="ws-viewtoggle">
        <button id="wsvGrid" onclick="setWsView('grid')">▦ บล็อก</button>
        <button id="wsvList" onclick="setWsView('list')">☰ ตาราง</button>
      </div>
    </div>
    <div class="cat-strip rv2" id="wsPills" style="margin-bottom:20px;">${pillHTML}</div>
    ${adSlot()}
    <div id="wsContent"></div>
    <div style="margin-top:24px;">${adSlot()}</div>
  </div>`;
  drawWs();
  activateAds();
}

function setWsView(v) {
  _wsView = v; localStorage.setItem('_wsView', v); drawWs();
}
function setWsFilter(f) { _wsFilter = f; drawWs(); }
function filterWs(q) { _wsQ = q; drawWs(); }

function drawWs() {
  const cont = document.getElementById('wsContent');
  if (!cont) return;
  document.getElementById('wsvGrid')?.classList.toggle('active', _wsView === 'grid');
  document.getElementById('wsvList')?.classList.toggle('active', _wsView === 'list');
  document.querySelectorAll('#wsPills .cat-pill').forEach(el =>
    el.classList.toggle('active', el.dataset.k === _wsFilter));

  let list = [..._allWs];
  if (_wsFilter === 'free')        list = list.filter(w => !w.locked);
  else if (_wsFilter === 'locked') list = list.filter(w => w.locked);
  else if (_wsFilter !== 'all')    list = list.filter(w => w.category === _wsFilter);
  if (_wsQ.trim()) {
    const q = _wsQ.trim().toLowerCase();
    list = list.filter(w => (w.title||'').toLowerCase().includes(q) || (w.description||'').toLowerCase().includes(q));
  }

  if (!list.length) { cont.innerHTML = `<div class="empty">📭<br>ไม่พบใบงานที่ตรงกัน</div>`; return; }

  if (_wsView === 'grid') {
    cont.innerHTML = `<div class="ws-grid">${list.map(wsCard).join('')}</div>`;
  } else {
    cont.innerHTML = `<div class="ws-list">${list.map(wsRow).join('')}</div>`;
  }
}

function wsCover(w, cls) {
  return w.cover_image
    ? `<img src="${esc(w.cover_image)}" alt="${esc(w.title)}" loading="lazy">`
    : `<span class="ws-emoji">📄</span>`;
}
function wsBadge(w) {
  return w.locked ? `<span class="ws-badge lock">🔒</span>` : `<span class="ws-badge free">ฟรี</span>`;
}
function wsCard(w) {
  return `<a class="ws-card" href="/worksheet/${w.id}" onmouseenter="showWsPv(this,${w.id})" onmouseleave="hideWsPv(this)">
    <div class="ws-cover">${wsCover(w)}${wsBadge(w)}</div>
    <div class="ws-info">
      <h3>${esc(w.title)}</h3>
      <div class="ws-meta">📑 ${w.pages||0} หน้า · ⬇️ ${w.downloads||0}</div>
    </div>
  </a>`;
}
function wsRow(w) {
  const tag = w.locked
    ? `<span class="ws-badge lock" style="position:static;">🔒 พรีเมียม</span>`
    : `<span class="ws-badge free" style="position:static;">ฟรี</span>`;
  return `<a class="ws-row" href="/worksheet/${w.id}" onmouseenter="showWsPv(this,${w.id})" onmouseleave="hideWsPv(this)">
    <div class="ws-rcover">${w.cover_image ? `<img src="${esc(w.cover_image)}" alt="" loading="lazy">` : '📄'}</div>
    <div class="ws-rbody">
      <h3>${esc(w.title)}</h3>
      <div class="ws-meta">${esc(w.category||'')} · 📑 ${w.pages||0} หน้า · ⬇️ ${w.downloads||0} ดาวน์โหลด</div>
    </div>
    ${tag}
  </a>`;
}

function showWsPv(el, id) {
  const w = _allWs.find(x => x.id === id);
  if (!w || !w.cover_image) return;
  const pv = document.createElement('div');
  pv.className = 'ws-pv';
  pv.innerHTML = `<div class="ws-pv-img"><img src="${esc(w.cover_image)}" alt="" loading="lazy"></div>`;
  el.appendChild(pv);
  requestAnimationFrame(() => { pv.style.opacity = '1'; pv.style.transform = 'translate(-50%,-50%) scale(1)'; });
}
function hideWsPv(el) { const p = el.querySelector('.ws-pv'); if (p) p.remove(); }

// ══ ใบงาน: หน้ารายละเอียด ════════════════════════════════
async function renderWorksheetDetail(id) {
  const app = document.getElementById('app');
  app.innerHTML = skArticle();
  const data = await get('/worksheets');
  const w = (data.worksheets || []).find(x => String(x.id) === String(id));
  if (!w) { render404('ไม่พบใบงานนี้ — อาจถูกลบหรือยังไม่เผยแพร่'); return; }

  setPageMeta({
    title: w.title,
    desc: w.description || `ใบงาน ${w.category||''} — ดาวน์โหลดได้ที่ Kru-ti ครูติ`,
    image: w.cover_image || undefined,
    // canonical ชี้หน้า SSR ที่ /worksheet/:id — Google ตัด #/... ทิ้งอยู่แล้ว
    // บอกไปเลยว่าเนื้อหานี้อยู่ที่ URL จริงไหน จะได้ไม่แข่งกับหน้าแรก
    url: SITE + '/worksheet/' + w.id,
  });

  const unlocked = sessionStorage.getItem('ws_url_' + w.id);
  const fileUrl = (!w.locked && w.file_url) ? w.file_url : unlocked;
  // แชร์ลิงก์หน้า SSR — LINE/Facebook อ่าน OG tag ได้ ขึ้นชื่อและรูปใบงานถูกต้อง
  // (ลิงก์ #/... crawler อ่านไม่ออก จะขึ้นเป็นหน้าแรกทั่ว ๆ ไป)
  const shareUrl = SITE + '/worksheet/' + w.id;
  const descIsDup = (w.description||'').trim() === (w.title||'').trim();

  app.innerHTML = `
  <div class="container" style="padding:8px 22px 40px;max-width:880px;">
    <div class="back-btn rv" onclick="go('/worksheets')" style="margin:8px 0 18px;cursor:pointer;color:var(--slate);font-weight:700;">← กลับคลังใบงาน</div>
    <div class="rv ws-detail-grid">
      <div class="ws-detail-cover">
        <div style="position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 6px 22px rgba(16,28,51,.1);aspect-ratio:210/297;">
          ${w.cover_image ? `<img src="${esc(w.cover_image)}" alt="${esc(w.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--slate);"><div style="font-size:3rem;">📄</div></div>`}
          ${w.locked ? `<span class="ws-badge lock" style="top:12px;right:12px;font-size:.74rem;padding:5px 13px;">🔒 พรีเมียม</span>` : `<span class="ws-badge free" style="top:12px;right:12px;font-size:.74rem;padding:5px 13px;">🆓 ฟรี</span>`}
        </div>
        <div style="display:flex;gap:14px;justify-content:center;align-items:center;margin-top:12px;font-size:.84rem;color:var(--slate);font-weight:600;">
          <span>📑 ${w.pages||0} หน้า</span>
          ${(w.downloads||0) > 0 ? `<span style="opacity:.4;">·</span><span>⬇️ ${w.downloads} ดาวน์โหลด</span>` : ''}
        </div>
      </div>
      <div class="ws-detail-body">
        <span style="display:inline-block;background:var(--gold-soft);color:var(--gold-deep);border:1px solid rgba(243,172,46,.3);padding:4px 14px;border-radius:100px;font-size:.78rem;font-weight:700;margin-bottom:14px;">${esc(w.category||'อื่นๆ')}</span>
        <h1 style="font-family:'Pridi',serif;font-size:clamp(1.4rem,3.4vw,1.8rem);font-weight:600;color:var(--ink);line-height:1.45;margin:0 0 14px;">${esc(w.title)}</h1>
        ${w.description && !descIsDup ? `<p style="font-size:1rem;color:#444;line-height:1.85;margin-bottom:22px;">${esc(w.description)}</p>` : '<div style="margin-bottom:8px;"></div>'}
        <div id="wsAction"></div>
        <div style="margin-top:22px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <strong style="font-size:.86rem;color:var(--slate);">แชร์ใบงานนี้:</strong>
          <a class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
             href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">💬 LINE</a>
          <a class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
             href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">📘 Facebook</a>
          <button class="btn btn-outline" style="padding:6px 14px;font-size:.82rem;"
                  onclick="navigator.clipboard.writeText('${shareUrl}').then(()=>{this.textContent='✓ คัดลอกแล้ว';setTimeout(()=>this.innerHTML='🔗 คัดลอกลิงก์',2000)})">🔗 คัดลอกลิงก์</button>
        </div>
      </div>
    </div>
  </div>`;

  renderWsAction(w, fileUrl);
}

function renderWsAction(w, fileUrl) {
  const box = document.getElementById('wsAction');
  if (!box) return;
  if (fileUrl) {
    box.innerHTML = `
      <a href="${esc(fileUrl)}" target="_blank" rel="noopener" onclick="bumpWsDownload(${w.id})"
        style="display:inline-flex;align-items:center;gap:10px;background:var(--mint);color:#fff;font-family:'Sarabun';font-weight:700;font-size:1.05rem;text-decoration:none;padding:14px 32px;border-radius:13px;box-shadow:0 6px 18px rgba(15,162,148,.32);">
        ⬇️ ดาวน์โหลดใบงาน (PDF)
      </a>
      <p style="font-size:.85rem;color:var(--slate);margin-top:12px;">เปิดไฟล์ในแท็บใหม่ — บันทึกหรือพิมพ์ได้เลย</p>`;
  } else {
    box.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;max-width:420px;">
        <div style="font-size:.92rem;color:var(--ink);font-weight:700;margin-bottom:11px;">🎟️ มีรหัสปลดล็อก? กรอกเพื่อดาวน์โหลด</div>
        <div style="display:flex;gap:8px;">
          <input id="wsCode" placeholder="กรอกรหัส เช่น WS2025" onkeydown="if(event.key==='Enter')unlockWs(${w.id})"
            style="flex:1;border:1.5px solid var(--line);border-radius:10px;padding:11px 14px;font-size:.95rem;font-family:'Sarabun';outline:none;text-transform:uppercase;">
          <button onclick="unlockWs(${w.id})" style="background:var(--gold);color:var(--ink);border:none;padding:11px 22px;border-radius:10px;font-family:'Sarabun';font-weight:700;font-size:.95rem;cursor:pointer;white-space:nowrap;">⬇️ ดาวน์โหลด</button>
        </div>
        <div id="wsCodeMsg" style="font-size:.85rem;font-weight:700;margin-top:9px;"></div>
        <div style="text-align:center;margin-top:11px;font-size:.86rem;color:var(--slate);border-top:1px solid var(--line-soft);padding-top:11px;">
          ยังไม่มีรหัส? <a href="/buy" style="color:var(--gold-deep);font-weight:700;">ดูวิธีซื้อรหัสปลดล็อก →</a>
        </div>
      </div>`;
  }
}

async function unlockWs(id) {
  const inp = document.getElementById('wsCode');
  const msg = document.getElementById('wsCodeMsg');
  const code = (inp.value || '').trim();
  if (!code) { msg.style.color = 'var(--gold-deep)'; msg.textContent = 'กรุณากรอกรหัส'; return; }
  msg.style.color = 'var(--slate)'; msg.textContent = 'กำลังตรวจสอบ...';
  try {
    const r = await fetch(API + '/worksheets/' + id + '/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(r => r.json());
    if (r.error) { msg.style.color = '#dc2626'; msg.textContent = '❌ ' + r.error; return; }
    if (r.file_url) {
      sessionStorage.setItem('ws_url_' + id, r.file_url);
      const w = _allWs.find(x => x.id === id) || { id };
      renderWsAction(w, r.file_url);
      toast('✅ ปลดล็อกสำเร็จ!');
    }
  } catch (e) { msg.style.color = '#dc2626'; msg.textContent = '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'; }
}

function bumpWsDownload(id) {
  // ใบงานฟรี: นับยอดดาวน์โหลด (ไม่ต้องรอผล)
  fetch(API + '/worksheets/' + id + '/download', { method: 'POST' }).catch(() => {});
}

// ══ แจ้งปัญหา ══════════════════════════════════════════
function renderReport() {
  setPageMeta({ title: 'แจ้งปัญหา', desc: 'แจ้งปัญหาการใช้งาน แอป ใบงาน หรือบทความ' });
  document.getElementById('app').innerHTML = `
  <div class="art-wrap rv" style="max-width:620px;">
    <div class="back-btn" onclick="go('/')" style="cursor:pointer;color:var(--slate);font-weight:700;margin-bottom:16px;">← กลับหน้าหลัก</div>
    <h1 style="margin-bottom:8px;">แจ้งปัญหา</h1>
    <p style="color:var(--slate);font-size:1rem;margin-bottom:24px;">เจอแอปเสีย ใบงานโหลดไม่ได้ หรือพบข้อผิดพลาด? แจ้งได้เลย ครูติจะรีบดูให้ครับ</p>

    <div id="reportForm" style="background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;">
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:700;font-size:.92rem;margin-bottom:8px;color:var(--ink);">ประเภทปัญหา</label>
        <div id="rpTypes" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${['แอป','ใบงาน','บทความ','การซื้อรหัส','อื่นๆ'].map((t,i) =>
            `<span class="cat-pill${i===0?' active':''}" data-type="${t}" onclick="selReportType(this)">${t}</span>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:700;font-size:.92rem;margin-bottom:8px;color:var(--ink);">รายละเอียดปัญหา *</label>
        <textarea id="rpDetail" placeholder="อธิบายปัญหาที่เจอ เช่น แอปไหน หน้าไหน กดแล้วเกิดอะไร..." 
          style="width:100%;min-height:120px;border:1.5px solid var(--line);border-radius:11px;padding:13px;font-size:.96rem;font-family:'Sarabun';outline:none;resize:vertical;"></textarea>
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:700;font-size:.92rem;margin-bottom:8px;color:var(--ink);">อีเมล/ช่องทางติดต่อกลับ <span style="font-weight:400;color:var(--slate);">(ไม่บังคับ)</span></label>
        <input id="rpContact" placeholder="เผื่อครูติต้องสอบถามเพิ่มเติม" 
          style="width:100%;border:1.5px solid var(--line);border-radius:11px;padding:12px 13px;font-size:.96rem;font-family:'Sarabun';outline:none;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block;font-weight:700;font-size:.92rem;margin-bottom:8px;color:var(--ink);">แนบรูป/สกรีนช็อต <span style="font-weight:400;color:var(--slate);">(ไม่บังคับ)</span></label>
        <button type="button" onclick="uploadReportImg()" id="rpImgBtn"
          style="background:var(--paper);border:1.5px dashed var(--line);border-radius:11px;padding:12px 18px;font-family:'Sarabun';font-size:.92rem;color:var(--slate);cursor:pointer;width:100%;">
          📷 เลือกรูปเพื่อแนบ
        </button>
        <div id="rpImgPreview"></div>
      </div>
      <button onclick="submitReport()" id="rpSubmit"
        style="width:100%;background:var(--gold);color:var(--ink);border:none;padding:14px;border-radius:12px;font-family:'Sarabun';font-weight:700;font-size:1.02rem;cursor:pointer;">
        📨 ส่งแจ้งปัญหา
      </button>
    </div>
  </div>`;
  window._rpType = 'แอป';
  window._rpImg = '';
}

function selReportType(el) {
  document.querySelectorAll('#rpTypes .cat-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  window._rpType = el.dataset.type;
}

async function uploadReportImg() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const btn = document.getElementById('rpImgBtn');
    btn.textContent = '⏳ กำลังอัปโหลด...';
    try {
      const fd = new FormData();
      fd.append('image', f);
      const r = await fetch(API + '/upload', { method: 'POST', body: fd }).then(r => r.json());
      if (r.url) {
        window._rpImg = r.url;
        document.getElementById('rpImgPreview').innerHTML =
          `<img src="${r.url}" style="margin-top:10px;max-height:140px;border-radius:10px;border:1px solid var(--line);">`;
        btn.textContent = '✓ แนบรูปแล้ว (กดเพื่อเปลี่ยน)';
      } else { btn.textContent = '📷 เลือกรูปเพื่อแนบ'; toast('❌ อัปโหลดรูปไม่สำเร็จ'); }
    } catch (e) { btn.textContent = '📷 เลือกรูปเพื่อแนบ'; toast('❌ อัปโหลดรูปไม่สำเร็จ'); }
  };
  inp.click();
}

async function submitReport() {
  const detail = document.getElementById('rpDetail').value.trim();
  if (!detail) { toast('กรุณากรอกรายละเอียดปัญหา'); document.getElementById('rpDetail').focus(); return; }
  const btn = document.getElementById('rpSubmit');
  btn.textContent = '⏳ กำลังส่ง...'; btn.disabled = true;
  try {
    const r = await fetch(API + '/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: window._rpType || 'อื่นๆ',
        detail,
        contact: document.getElementById('rpContact').value.trim(),
        image_url: window._rpImg || '',
      }),
    }).then(r => r.json());
    if (r.error) { toast('❌ ' + r.error); btn.textContent = '📨 ส่งแจ้งปัญหา'; btn.disabled = false; return; }
    document.getElementById('reportForm').innerHTML = `
      <div style="text-align:center;padding:30px 10px;">
        <div style="font-size:3rem;margin-bottom:12px;">✅</div>
        <h2 style="font-size:1.3rem;margin-bottom:8px;">ส่งแจ้งปัญหาแล้ว</h2>
        <p style="color:var(--slate);">ขอบคุณที่ช่วยแจ้งครับ ครูติจะรีบตรวจสอบและแก้ไขให้เร็วที่สุด</p>
        <button onclick="go('/')" style="margin-top:20px;background:var(--gold);color:var(--ink);border:none;padding:12px 28px;border-radius:11px;font-family:'Sarabun';font-weight:700;cursor:pointer;">กลับหน้าหลัก</button>
      </div>`;
  } catch (e) {
    toast('❌ ส่งไม่สำเร็จ ลองใหม่อีกครั้ง');
    btn.textContent = '📨 ส่งแจ้งปัญหา'; btn.disabled = false;
  }
}

function renderBuy() {
  document.getElementById('app').innerHTML = `
  <div class="art-wrap rv">
    <div class="back-btn" onclick="go('/apps')">← กลับหน้าแอป</div>
    <h1 style="margin-bottom:8px;">วิธีซื้อรหัสปลดล็อก</h1>
    <p style="color:var(--slate);font-size:1rem;margin-bottom:6px;">ปลดล็อกแอปพรีเมียมทั้งชุด ใช้ได้ทุกอุปกรณ์</p>

    <div style="background:linear-gradient(150deg,var(--ink) 20%,var(--ink-2) 80%);border-radius:22px;
      padding:34px 30px;margin:26px 0;text-align:center;color:#fff;position:relative;overflow:hidden;">
      <div style="font-size:2.4rem;margin-bottom:10px;">🎟️</div>
      <h2 style="color:#fff;font-size:1.4rem;margin-bottom:10px;">ติดต่อซื้อรหัส & ดูโปรโมชั่น</h2>
      <p style="color:#aebad0;font-size:.98rem;line-height:1.8;max-width:42ch;margin:0 auto 22px;">
        สอบถามราคา โปรโมชั่น และชุดแอปที่เปิดขาย ได้ที่เพจ Facebook ครูติ
        ทักแชทมาได้เลย ยินดีตอบทุกคำถามครับ
      </p>
      <a href="${FB_PAGE}" target="_blank" rel="noopener"
        style="display:inline-flex;align-items:center;gap:10px;background:var(--gold);color:var(--ink);
        font-family:'Sarabun';font-weight:700;font-size:1.05rem;text-decoration:none;
        padding:14px 34px;border-radius:13px;box-shadow:0 6px 20px rgba(243,172,46,.4);">
        💬 ทักเพจครูติ
      </a>
    </div>

    <div class="art-body">
      <h2>ขั้นตอนง่ายๆ</h2>
      <ol>
        <li><strong>ทักเพจครูติ</strong> — สอบถามแอปที่อยากได้ หรือดูโปรโมชั่นชุดแอป</li>
        <li><strong>ตกลงราคา & โอนเงิน</strong> — แอดมินแจ้งรายละเอียดการชำระเงิน</li>
        <li><strong>รับรหัสทางอีเมล</strong> — ส่งรหัสปลดล็อกให้ทางอีเมลที่แจ้งไว้</li>
        <li><strong>กรอกรหัสที่หน้าแอป</strong> — ไปที่ <a href="/apps">หน้าแอปทั้งหมด</a> กรอกรหัสในช่อง 🎟️ แล้วกดปลดล็อก ใช้งานได้ทันที</li>
      </ol>

      <h2>คำถามที่พบบ่อย</h2>
      <p><strong>รหัสใช้ได้นานแค่ไหน?</strong><br>ระยะเวลาการใช้งานขึ้นอยู่กับชุดที่ซื้อ — บางชุดใช้ได้ตลอดไม่มีวันหมดอายุ บางชุดมีกำหนดระยะเวลา สอบถามรายละเอียดกับแอดมินได้เลย</p>
      <p><strong>ปลดล็อกได้กี่แอป?</strong><br>ขึ้นอยู่กับชุดที่ซื้อ — รหัสบางชุดปลดล็อกหลายแอปพร้อมกัน สอบถามแอดมินได้เลย</p>
      <p><strong>มีแอปฟรีไหม?</strong><br>มีครับ หลายแอปใช้ฟรี ดูได้ที่ <a href="/apps">หน้าแอปทั้งหมด</a> รหัสมีไว้สำหรับแอปพรีเมียมเท่านั้น</p>
    </div>

    <div style="margin-top:30px;display:flex;gap:12px;flex-wrap:wrap;">
      <a class="btn btn-primary" href="${FB_PAGE}" target="_blank" rel="noopener">💬 ทักเพจครูติ</a>
      <a class="btn btn-outline" href="/apps">ดูแอปทั้งหมด</a>
    </div>
  </div>`;
  setPageMeta({
    title: 'วิธีซื้อรหัสปลดล็อก',
    desc: 'ปลดล็อกแอปพรีเมียมของครูติ — ติดต่อซื้อรหัสและดูโปรโมชั่นได้ที่เพจ Facebook ครูติ',
    url: SITE + '/buy',
  });
}

// ── PRIVACY POLICY ────────────────────────────────────────
function renderPrivacy() {
  const title = S.site_title || 'Kru-ti ครูติ TH';
  const today = new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});
  document.getElementById('app').innerHTML = `
  <div class="art-wrap rv">
    <h1 style="margin-bottom:8px;">นโยบายความเป็นส่วนตัว</h1>
    <p style="color:var(--slate);font-size:.88rem;margin-bottom:28px;">อัปเดตล่าสุด: ${today}</p>

    <div class="art-body">

      <h2>บทนำ</h2>
      <p>เว็บไซต์ <strong>${title}</strong> ("เรา" หรือ "เว็บไซต์") ให้ความสำคัญกับความเป็นส่วนตัวของผู้เยี่ยมชมทุกท่าน นโยบายนี้อธิบายว่าเราเก็บรวบรวม ใช้ และปกป้องข้อมูลของท่านอย่างไร</p>

      <h2>ข้อมูลที่เราเก็บรวบรวม</h2>
      <p>เว็บไซต์นี้ไม่ได้เก็บข้อมูลส่วนตัวโดยตรง ยกเว้นในกรณีต่อไปนี้:</p>
      <ul>
        <li><strong>ความคิดเห็น (Comments)</strong> — เมื่อท่านแสดงความคิดเห็น เราจะเก็บชื่อและข้อความที่ท่านกรอก</li>
        <li><strong>ข้อมูลการใช้งาน</strong> — จำนวนครั้งที่แต่ละบทความถูกเปิดอ่าน (ไม่ระบุตัวตน)</li>
      </ul>

      <h2>การใช้ Cookies</h2>
      <p>เว็บไซต์นี้ใช้ <strong>cookies</strong> (ไฟล์ข้อมูลขนาดเล็กในอุปกรณ์ของท่าน) เพื่อวัตถุประสงค์ต่อไปนี้:</p>
      <ul>
        <li>เพื่อการแสดงผลโฆษณา (ผ่าน Google AdSense)</li>
        <li>เพื่อวิเคราะห์การใช้งานเว็บไซต์</li>
      </ul>

      <h2>Google AdSense และโฆษณา</h2>
      <p>เว็บไซต์นี้ใช้ <strong>Google AdSense</strong> ซึ่งเป็นบริการโฆษณาของ Google LLC เพื่อแสดงโฆษณา</p>
      <ul>
        <li>Google AdSense ใช้ cookies เพื่อแสดงโฆษณาที่เกี่ยวข้องกับความสนใจของท่าน</li>
        <li>Google อาจใช้ข้อมูลเกี่ยวกับการเยี่ยมชมเว็บไซต์นี้ (และเว็บไซต์อื่น) เพื่อแสดงโฆษณาที่ตรงความสนใจ</li>
        <li>ท่านสามารถดูและปรับการตั้งค่าโฆษณาส่วนตัวได้ที่ <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google Ads Settings</a></li>
        <li>สามารถอ่านนโยบายความเป็นส่วนตัวของ Google เพิ่มเติมได้ที่ <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">policies.google.com/privacy</a></li>
      </ul>

      <h2>ผู้ให้บริการภายนอก (Third-Party Services)</h2>
      <p>เว็บไซต์อาจเชื่อมต่อกับบริการภายนอก ซึ่งมีนโยบายความเป็นส่วนตัวของตนเอง:</p>
      <ul>
        <li><strong>Google AdSense</strong> — บริการโฆษณา</li>
        <li><strong>Google Fonts</strong> — แบบอักษรที่ใช้แสดงผล</li>
        <li><strong>imgbb</strong> — บริการฝากรูปภาพ</li>
      </ul>

      <h2>การปฏิเสธ Cookies</h2>
      <p>ท่านสามารถปฏิเสธการใช้ cookies ได้โดย:</p>
      <ul>
        <li>ตั้งค่าเบราว์เซอร์ให้บล็อก cookies (แต่อาจกระทบการแสดงผลบางส่วน)</li>
        <li>ใช้ Google Opt-out ที่ <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google Ads Settings</a></li>
        <li>ติดตั้ง <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Google Analytics Opt-out Browser Add-on</a></li>
      </ul>

      <h2>ลิงก์ไปยังเว็บไซต์อื่น</h2>
      <p>เว็บไซต์อาจมีลิงก์ไปยังเว็บไซต์ภายนอก เราไม่รับผิดชอบต่อนโยบายความเป็นส่วนตัวของเว็บไซต์เหล่านั้น</p>

      <h2>การเปลี่ยนแปลงนโยบาย</h2>
      <p>เราอาจอัปเดตนโยบายนี้เป็นครั้งคราว โดยจะระบุวันที่อัปเดตไว้ที่ด้านบนของหน้า การใช้งานเว็บไซต์ต่อไปหลังการเปลี่ยนแปลงถือว่าท่านยอมรับนโยบายที่อัปเดต</p>

      <h2>ติดต่อเรา</h2>
      <p>หากมีคำถามเกี่ยวกับนโยบายความเป็นส่วนตัวนี้ กรุณาติดต่อผ่านหน้า <a href="/about">เกี่ยวกับเรา</a></p>

    </div>

    <div style="margin-top:32px;">
      <a class="btn btn-outline" href="/">← กลับหน้าหลัก</a>
    </div>
  </div>`;
}

// ── CARD TEMPLATES ───────────────────────────────────────
function artCard(a) {
  return `<div class="art-card" onclick="go('/article/${a.id}')">
    <div class="art-meta"><span class="${catTag(a.category)}">${a.category}</span></div>
    <h3>${a.title}</h3>
    <p>${a.excerpt||''}</p>
    <div class="art-date">📅 ${fmt(a.created_at)}</div>
  </div>`;
}

function appCard(a) {
  const pid = `p_${a.id}`;
  const raw = sessionStorage.getItem('unlocked_'+a.id);
  const storedUrl = (raw && raw.startsWith('http')) ? raw : null;
  const isLocked = a.locked && !storedUrl;
  const appUrl = storedUrl || a.url;
  const previewImg = a.preview_image
    ? `<img src="${esc(a.preview_image)}" alt="Preview" loading="lazy" onerror="this.parentNode.innerHTML='<div class=app-preview-ph>${a.icon||'🎮'}</div>'">`
    : `<div class="app-preview-ph">${a.icon||'🎮'}</div>`;
  const preview = `
    <div class="app-preview">
      ${previewImg}
      <div class="app-preview-info">
        <p>${esc(a.description||'')}</p>
        ${isLocked ? '<span class="app-preview-lock">🔒 ต้องใช้รหัสปลดล็อก</span>' : ''}
      </div>
    </div>`;
  return `<div class="app-card">
    ${preview}
    ${a.pinned?'<div style="position:absolute;top:10px;left:10px;background:#fbbf24;color:#78350f;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:99px;z-index:2;box-shadow:0 2px 6px rgba(0,0,0,.15);">📌 PIN</div>':''}
    ${a.is_vip?'<div class="app-vip-badge" title="แอประดับ VIP">👑 VIP</div>':''}
    ${isLocked?`<div style="position:absolute;top:10px;${a.pinned?'left:78px':'left:10px'};font-size:1.1rem;" title="แอปนี้ต้องใช้รหัสผ่าน">🔒</div>`:''}
    <div class="app-top">
      <div class="app-icon icon-blue">${a.icon||'🎮'}</div>
      <div><h4>${esc(a.title)}</h4><span class="tag tag-math" style="font-size:.7rem;">${esc(a.category)}</span></div>
    </div>
    <p>${esc(a.description||'')}</p>
    <div class="app-btns">
      ${isLocked
        ? `<button class="btn-open" style="background:var(--slate);color:#fff;" onclick="openLockModal(${a.id},'${esc(a.title).replace(/'/g,"\\'")}','${a.icon||'🎮'}')">🔒 ปลดล็อก</button>`
        : (appUrl ? `<button class="btn-open" onclick="openAppViewer('${encodeURI(appUrl)}','${esc(a.title).replace(/'/g,"\\'")}','${a.icon||'🎮'}',${a.id})">🚀 เปิดแอป</button>` : '')
      }
      ${a.has_prompt ? `<button class="btn-pmt" onclick="openPromptModal(${a.id}, '${esc(a.title).replace(/'/g,"\\'")}')">📋 Prompt</button>` : ''}
      <button class="btn-share" onclick="shareApp(${a.id},'${esc(a.title).replace(/'/g,"\\'")}')"
        title="แชร์แอปนี้" aria-label="แชร์แอปนี้"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"></line></svg></button>
    </div>
  </div>`;
}

// ── UTILS ─────────────────────────────────────────────────
// ตรวจตำแหน่งการ์ดก่อนแสดง preview — ถ้าด้านบนไม่มีที่พอ ให้เด้งลงล่าง
document.addEventListener('mouseover', e => {
  const card = e.target.closest('.app-card');
  if (!card || !card.querySelector('.app-preview')) return;
  const navH = document.getElementById('nav')?.offsetHeight || 64;
  const spaceAbove = card.getBoundingClientRect().top - navH;
  card.classList.toggle('preview-down', spaceAbove < 250);
});

// prompt ไม่ได้ส่งมากับรายการแอปแล้ว (ยาวมาก) — ดึงตอนกดดูจริง
// get() มี cache 30 วิ ในตัว เปิดซ้ำแอปเดิมจึงขึ้นทันที
async function openPromptModal(id, title) {
  const body = document.getElementById('promptBody');
  document.getElementById('promptTitle').textContent = title;
  document.getElementById('promptCopyBtn').textContent = '📋 คัดลอก Prompt';
  body.textContent = 'กำลังโหลด prompt...';
  document.getElementById('promptModal').style.display = 'flex';
  try {
    const d = await get('/apps/' + id + '/prompt');
    body.textContent = d.prompt || '(แอปนี้ยังไม่มี prompt)';
  } catch (e) {
    body.textContent = 'โหลด prompt ไม่สำเร็จ — ปิดหน้าต่างนี้แล้วลองกดใหม่อีกครั้ง';
  }
}
function closePromptModal() {
  document.getElementById('promptModal').style.display = 'none';
}
function copyPromptModal() {
  const text = document.getElementById('promptBody').textContent;
  const btn = document.getElementById('promptCopyBtn');
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ คัดลอกแล้ว!';
    setTimeout(() => { btn.textContent = '📋 คัดลอก Prompt'; }, 1800);
  }).catch(() => {
    btn.textContent = '✓ คัดลอกแล้ว!';
    setTimeout(() => { btn.textContent = '📋 คัดลอก Prompt'; }, 1800);
  });
}

function doCopy(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ คัดลอกแล้ว!';
    setTimeout(() => btn.textContent = '📋 คัดลอก Prompt', 1800);
  });
}

function doCopyPre(pid, btn) {
  const pre = document.getElementById(pid)?.querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = '✓ คัดลอกแล้ว!';
    setTimeout(() => btn.textContent = '📋 คัดลอก Prompt', 1800);
  });
}

// ── APP PLAYER ───────────────────────────────────────────
let _viewerUrl = '';
// mini toast — แจ้งเตือนสั้นๆ มุมล่าง
function toast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);'
      + 'background:var(--ink);color:#fff;padding:13px 24px;border-radius:12px;font-family:\'Sarabun\',sans-serif;'
      + 'font-size:.92rem;font-weight:600;box-shadow:0 10px 30px rgba(16,28,51,.3);z-index:10000;'
      + 'opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;max-width:90vw;text-align:center;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 2600);
}

// แชร์แอป: ส่งลิงก์หน้า SSR ที่ /apps/:id — LINE/Facebook อ่าน OG tag ได้
// ขึ้นชื่อแอปและคำอธิบายถูกต้อง (ลิงก์ #/... crawler อ่านไม่ออก จะขึ้นเป็นหน้าแรกทั่ว ๆ ไป)
// ในหน้านั้นมีปุ่มพากลับเข้า viewer ของเว็บหลักอยู่แล้ว
async function shareApp(id, title) {
  const url = `${SITE}/apps/${id}`;
  // มือถือ: ใช้ native share sheet ถ้ามี — ส่ง url อย่างเดียว
  if (navigator.share) {
    try { await navigator.share({ url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  // เดสก์ท็อป: copy ลิงก์
  try {
    await navigator.clipboard.writeText(url);
    toast('✅ คัดลอกลิงก์แอปแล้ว — แชร์ได้เลย');
  } catch (e) {
    prompt('คัดลอกลิงก์นี้เพื่อแชร์:', url);
  }
}

function openAppViewer(url, title, icon, appId) {
  _viewerUrl = url;
  document.getElementById('viewerFrame').src = url;
  document.getElementById('viewerTitle').textContent = title || 'แอป';
  document.getElementById('viewerIcon').textContent = icon || '🎮';
  document.getElementById('appViewer').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // track การเปิดแอป (ใช้ path /apps/:id เพื่อแยกจาก /apps หน้ารวม)
  if (appId) trackPageView('/apps/' + appId);
}
function closeAppViewer() {
  const av = document.getElementById('appViewer');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
  av.classList.remove('vb-full');
  const btn = document.getElementById('fsBtn');
  if (btn) btn.innerHTML = '⛶ เต็มจอ';
  av.style.display = 'none';
  document.getElementById('viewerFrame').src = 'about:blank';
  document.body.style.overflow = '';
}
function openInNewTab() {
  if (_viewerUrl) window.open(_viewerUrl, '_blank');
}
function fullscreenApp() {
  const av  = document.getElementById('appViewer');
  const box = document.getElementById('viewerBox');
  const btn = document.getElementById('fsBtn');
  const isFull = av.classList.contains('vb-full');

  if (!isFull) {
    // ขยายเต็มจอ — CSS fullscreen ทำงานได้ทุกที่ (รวม iOS standalone)
    av.classList.add('vb-full');
    if (btn) btn.innerHTML = '🗗 ย่อ';
    // เสริม: ลอง native Fullscreen API ด้วย (Android/desktop ได้ขอบจอเต็มจริง; iOS จะ no-op เฉยๆ)
    const req = box.requestFullscreen || box.webkitRequestFullscreen || box.msRequestFullscreen;
    try { req?.call(box); } catch (_) {}
  } else {
    // ย่อกลับ
    av.classList.remove('vb-full');
    if (btn) btn.innerHTML = '⛶ เต็มจอ';
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('promptModal')?.style.display === 'flex') { closePromptModal(); return; }
  if (e.key === 'Escape' && document.getElementById('appViewer').style.display === 'flex') {
    // ถ้าเต็มจอ (CSS) อยู่ → ย่อก่อน; กด Escape อีกครั้งค่อยปิด
    if (document.getElementById('appViewer').classList.contains('vb-full') && !document.fullscreenElement) {
      fullscreenApp();
    } else if (!document.fullscreenElement) {
      closeAppViewer();
    }
  }
});
// ออกจาก native fullscreen ผ่านปุ่มระบบ → sync ปุ่ม/คลาสให้ตรง
['fullscreenchange','webkitfullscreenchange'].forEach(ev =>
  document.addEventListener(ev, () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const av = document.getElementById('appViewer'), btn = document.getElementById('fsBtn');
      if (av.classList.contains('vb-full')) { av.classList.remove('vb-full'); if (btn) btn.innerHTML = '⛶ เต็มจอ'; }
    }
  })
);

function catTag(cat) {
  const m = { 'เทคนิค':'tag tag-tech','วิชาการ':'tag tag-edu','AI & เครื่องมือ':'tag tag-ai','ข่าวการศึกษา':'tag tag-news' };
  return m[cat] || 'tag tag-gen';
}

function fmt(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('th-TH',{year:'numeric',month:'short',day:'numeric'});
  } catch { return d; }
}

// ── 404: หน้าหาย — พากลับ + แนะนำบทความ ──────────────────
async function render404(msg) {
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="container" style="padding:60px 22px 40px;text-align:center;">
    <div style="font-family:'Pridi',serif;font-size:5rem;font-weight:700;color:var(--gold);line-height:1;">4✦4</div>
    <h1 style="font-size:1.5rem;margin:14px 0 8px;">${msg || 'ไม่พบหน้านี้'}</h1>
    <p style="color:var(--slate);margin-bottom:24px;">ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="go('/')">🏠 กลับหน้าหลัก</button>
      <button class="btn btn-outline" onclick="go('/apps')">ดูแอปทั้งหมด</button>
    </div>
    <div id="nf-arts" style="text-align:left;max-width:880px;margin:48px auto 0;"></div>
  </div>`;
  setPageMeta({ title: 'ไม่พบหน้านี้' });
  // แนะนำบทความล่าสุด
  try {
    const data = await get('/articles?page=1');
    const arts = (data.articles || []).slice(0, 3);
    if (arts.length) {
      document.getElementById('nf-arts').innerHTML = `
        <div class="sec-title" style="font-size:1.2rem;margin-bottom:16px;">หรืออ่านบทความล่าสุด</div>
        <div class="arts-grid">${arts.map(artCard).join('')}</div>`;
    }
  } catch(e) {}
}

function empty(msg, icon='📭') {
  return `<div class="empty"><div style="font-size:2.5rem;margin-bottom:12px;">${icon}</div><p>${msg}</p></div>`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// เพิ่ม loading="lazy" + decoding="async" ให้รูปในเนื้อหาบทความที่ยังไม่มี
// (ภาพแรกๆ ที่อยู่บนสุด browser จะโหลดก่อนอยู่แล้ว, ที่เหลือ lazy)
function addLazyLoading(html) {
  if (!html) return '';
  return html.replace(/<img\s+([^>]*?)>/gi, (match, attrs) => {
    let a = attrs;
    if (!/loading\s*=/i.test(a)) a += ' loading="lazy"';
    if (!/decoding\s*=/i.test(a)) a += ' decoding="async"';
    return `<img ${a}>`;
  });
}

// ── Skeleton loaders — แสดงโครงร่างระหว่างโหลด (ดูเร็วกว่า spinner) ──
function skCards(n = 6) {
  let cards = '';
  for (let i = 0; i < n; i++) {
    cards += `<div class="sk-card">
      <div class="sk sk-img"></div>
      <div class="sk sk-line" style="width:80%;"></div>
      <div class="sk sk-line" style="width:55%;"></div>
    </div>`;
  }
  return `<div class="sk-grid" style="max-width:1180px;margin:28px auto;padding:0 18px;">${cards}</div>`;
}
function skArticle() {
  return `<div style="max-width:820px;margin:42px auto;padding:0 22px;">
    <div class="sk sk-line" style="width:40%;height:18px;margin-bottom:20px;"></div>
    <div class="sk sk-line" style="width:90%;height:30px;"></div>
    <div class="sk sk-line" style="width:70%;height:30px;margin-bottom:24px;"></div>
    <div class="sk sk-img" style="aspect-ratio:16/9;margin-bottom:24px;"></div>
    ${Array(6).fill('<div class="sk sk-line" style="width:100%;"></div>').join('')}
    <div class="sk sk-line" style="width:60%;"></div>
  </div>`;
}
function skList(n = 5) {
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="sk-card" style="display:flex;gap:14px;align-items:center;margin-bottom:12px;">
      <div class="sk" style="width:72px;height:72px;border-radius:10px;flex-shrink:0;"></div>
      <div style="flex:1;"><div class="sk sk-line" style="width:70%;"></div><div class="sk sk-line" style="width:40%;margin-bottom:0;"></div></div>
    </div>`;
  }
  return `<div style="max-width:1180px;margin:28px auto;padding:0 18px;">${rows}</div>`;
}

// AdSense — แสดงเมื่อตั้งค่า Publisher ID แล้วเท่านั้น
function adSlot() {
  if (S.adsense_id) {
    return `<ins class="adsbygoogle" style="margin:20px 0;"
      data-ad-client="${S.adsense_id}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  }
  return '';
}

function activateAds() {
  if (!S.adsense_id || !window.adsbygoogle) return;
  document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
  });
}

function showMsg(el, text, color) {
  el.textContent = text; el.style.color = color; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

// ── CATEGORIES (อ่านจาก settings) ────────────────────────
function getCats() {
  try { return JSON.parse(S.article_categories || '[]'); } catch { return ['เทคนิค','วิชาการ','AI & เครื่องมือ','ข่าวการศึกษา','เคล็ดลับครู']; }
}
function loadCategories() {
  const el = document.getElementById('catStrip');
  if (!el) return;
  const cats = ['ทั้งหมด', ...getCats()];
  el.innerHTML = cats.map(c =>
    `<span class="cat-pill" onclick="go('/blog');setTimeout(()=>renderBlog(undefined,'${c}',1),50)">${c}</span>`
  ).join('');
}

// ── LOCK MODAL ────────────────────────────────────────────
let _lockAppId = null, _lockTitle = '', _lockIcon = '';
function openLockModal(id, title, icon) {
  _lockAppId = id; _lockTitle = title; _lockIcon = icon;
  document.getElementById('lockTitle').textContent = title;
  document.getElementById('lockInput').value = '';
  document.getElementById('lockErr').style.display = 'none';
  document.getElementById('lockModal').style.display = 'flex';
  setTimeout(() => document.getElementById('lockInput').focus(), 100);
}
function closeLockModal() { document.getElementById('lockModal').style.display = 'none'; }
async function submitLock() {
  const code = document.getElementById('lockInput').value.trim();
  if (!code) return;
  try {
    const r = await fetch(API + '/apps/' + _lockAppId + '/unlock', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})
    });
    const d = await r.json();
    if (r.ok && d.url) {
      sessionStorage.setItem('unlocked_' + _lockAppId, d.url);
      closeLockModal();
      openAppViewer(d.url, _lockTitle, _lockIcon, _lockAppId);
    } else {
      document.getElementById('lockErr').style.display = 'block';
      document.getElementById('lockInput').select();
    }
  } catch { document.getElementById('lockErr').style.display = 'block'; }
}

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    S = await get('/settings');
    const title = S.site_title || 'Kru-ti ครูติ TH';
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('metaDesc').content = S.site_desc || '';
    document.getElementById('logoTitle').textContent = title.replace(' TH','');
    document.getElementById('footerLogo').textContent = title;
    document.getElementById('footerText').textContent = '© 2568 ' + title;

    setPageMeta({
      title: '',
      desc:  S.site_desc || '',
      url:   SITE + '/',
    });

    if (S.adsense_id) {
      const sc = document.createElement('script');
      sc.async = true;
      sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${S.adsense_id}`;
      sc.crossOrigin = 'anonymous';
      document.head.appendChild(sc);
    }
  } catch(e) { console.log('Settings load error', e); }

  route();   // render เนื้อหาหลักทันที ไม่รอ ticker

  // Ticker เติมทีหลัง (ใช้ cache จาก renderHome — ไม่ยิงซ้ำ)
  get('/articles?page=1').then(artData => {
    const titles = (artData.articles||[]).map(a=>a.title);
    const el = document.getElementById('tickerText');
    if (!el || !titles.length) return;
    el.textContent = titles.join('   ✦   ');
    startTicker(el);
  }).catch(()=>{});
}

// ── TICKER: ความเร็วคงที่ px/วินาที ──
let _tickerAnim = null;
function startTicker(el) {
  const run = () => {
    if (_tickerAnim) _tickerAnim.cancel();
    const inner = el.parentElement;
    const containerW = inner.offsetWidth;
    const textW = el.scrollWidth;
    if (textW < 5) return;
    const SPEED = 50;
    const distance = containerW + textW;
    const dur = (distance / SPEED) * 1000;
    _tickerAnim = el.animate(
      [{ transform: `translateX(${containerW}px)` },
       { transform: `translateX(${-textW}px)` }],
      { duration: dur, iterations: Infinity, easing: 'linear' }
    );
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
  else run();
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(run, 200); });
}


// ── SEO: อัปเดต meta tags ต่อหน้า ─────────────────────────
function setPageMeta({ title, desc, image, url, type = 'website', ld = null } = {}) {
  const siteTitle = S.site_title || 'Kru-ti ครูติ TH';
  const fullTitle = title ? `${title} — ${siteTitle}` : siteTitle;
  const canon = url || SITE + (location.pathname.replace(/\/+$/, '') || '/');

  document.getElementById('pageTitle').textContent = fullTitle;
  document.getElementById('metaDesc').content       = desc || S.site_desc || '';
  document.getElementById('canonical').href         = canon;

  setMeta('og:title',       fullTitle);
  setMeta('og:description', desc || S.site_desc || '');
  setMeta('og:url',         canon);
  setMeta('og:type',        type);
  setMeta('og:image', image || (SITE + '/og-image.png'));
  setMeta('twitter:card',  'summary_large_image');
  setMeta('twitter:title', fullTitle);

  // JSON-LD structured data
  const jel = document.getElementById('jsonld');
  if (jel) jel.textContent = ld ? JSON.stringify(ld) : '{}';
}

function setMeta(prop, content) {
  const attr = prop.startsWith('og:') ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, prop); document.head.appendChild(el); }
  el.content = content;
}

document.addEventListener('DOMContentLoaded', init);
window.openPromptModal = openPromptModal;
window.closePromptModal = closePromptModal;
window.copyPromptModal = copyPromptModal;
window.doCopy = doCopy;
window.doCopyPre = doCopyPre;
window.openAppViewer = openAppViewer;
window.shareApp = shareApp;
window.closeAppViewer = closeAppViewer;
window.openInNewTab = openInNewTab;
window.fullscreenApp = fullscreenApp;
window.renderAbout = renderAbout;
window.renderBuy = renderBuy;
window.renderReport = renderReport;
window.selReportType = selReportType;
window.uploadReportImg = uploadReportImg;
window.submitReport = submitReport;
window.renderWorksheets = renderWorksheets;
window.renderWorksheetDetail = renderWorksheetDetail;
window.setWsView = setWsView;
window.setWsFilter = setWsFilter;
window.filterWs = filterWs;
window.showWsPv = showWsPv;
window.hideWsPv = hideWsPv;
window.unlockWs = unlockWs;
window.bumpWsDownload = bumpWsDownload;
window.loadRelated = loadRelated;
window.render404 = render404;
window.renderPrivacy = renderPrivacy;
window.openLockModal = openLockModal;
window.redeemAll = redeemAll;
window.closeLockModal = closeLockModal;
window.submitLock = submitLock;
window.filterApps = filterApps;
window.setAppFilter = setAppFilter;
window.setAppSort = setAppSort;
window.go = go;
window.goSearch = goSearch;
window.toggleNav = toggleNav;
window.renderBlog = renderBlog;
window.submitComment = submitComment;
