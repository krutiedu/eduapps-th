// Shared server/browser markup: protected destinations never appear before redemption.
export const examEscape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = examEscape;
export const examWebURL = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol) ? value : ''; } catch { return ''; } };
const categoryURL = id => '/exam-apps/category/' + Number(id);

function unlockForm({app, category, inline = false} = {}) {
  const title = app ? 'ปลดล็อกแอปข้อสอบนี้' : category ? 'ปลดล็อกข้อสอบในวิชานี้' : 'ปลดล็อกแอปข้อสอบ';
  return `<form id="examUnlockForm" class="exam-unlock${inline ? ' exam-unlock-inline' : ''}" method="post" aria-label="${title}" ${app ? `data-app="${Number(app.id)}"` : category ? `data-category="${Number(category.id)}"` : ''}>
    ${inline ? '' : `<label for="examCode">🔑 ${title}</label>`}
    <div class="exam-unlock-row"><input id="examCode" name="code" placeholder="${inline ? 'รหัสปลดล็อก' : 'กรอกรหัสปลดล็อก'}" required autocomplete="off" aria-label="รหัสปลดล็อกแอปข้อสอบ">
    <button class="btn btn-primary" type="submit">🔓 ปลดล็อก</button></div>
    <p id="examUnlockMsg" role="status" aria-live="polite"></p>
    ${inline ? '' : '<a href="/buy">ดูวิธีขอรหัส →</a>'}
  </form>`;
}
const statusTag = (app, isUnlocked) => `<span class="tag tag-gen">${app.locked ? isUnlocked ? '🔓 ปลดล็อกแล้ว' : '🔒 ใช้รหัส' : '🆓 ฟรี'}</span>`;
function card(app, isUnlocked) {
  return `<article class="exam-card">
    <a class="exam-card-main" href="/exam-apps/${Number(app.id)}">
      ${examWebURL(app.preview_image) ? `<img class="exam-cover" src="${e(app.preview_image)}" alt="ตัวอย่าง ${e(app.title)}" loading="lazy">` : `<div class="exam-cover exam-cover-placeholder">${e(app.icon || '📝')}</div>`}
      <div class="exam-card-body">${statusTag(app,isUnlocked)}
        <h3>${e(app.title)}</h3><p>${e(app.description)}</p></div>
    </a>
    <a class="exam-card-category" href="${categoryURL(app.category_id)}">${e(app.category)} →</a>
  </article>`;
}
function table(apps, category, unlocked) {
  return `<div class="exam-table-wrap"><table class="data-table exam-table" aria-label="ข้อสอบวิชา${e(category.name)}">
    <thead><tr><th class="exam-table-thumb" scope="col" aria-label="ตัวอย่าง">📝</th><th scope="col">ชื่อข้อสอบ</th>
      <th class="exam-table-status" scope="col">สถานะ</th><th class="exam-table-action" scope="col">ดูข้อสอบ</th></tr></thead>
    <tbody>${apps.map(app => {
      const status = statusTag(app,unlocked.has(String(app.id)));
      const href = '/exam-apps/' + Number(app.id);
      return `<tr>
        <td class="exam-table-thumb">${examWebURL(app.preview_image) ? `<img src="${e(app.preview_image)}" alt="" loading="lazy">` : `<span aria-hidden="true">${e(app.icon || '📝')}</span>`}</td>
        <td><a class="exam-table-title" href="${href}">${e(app.title)}</a><p class="exam-table-description">${e(app.description)}</p><div class="exam-table-mobile-status">${status}</div></td>
        <td class="exam-table-status">${status}</td><td class="exam-table-action"><a class="exam-table-open" href="${href}">ดูข้อสอบ</a></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}
export function examResultsHTML(apps, categories, category, query = '', unlocked = new Set(), view = 'grid') {
  const needle = query.trim().toLocaleLowerCase('th');
  const selected = apps.filter(a => (!category || Number(a.category_id) === Number(category.id))
    && (!needle || `${a.title} ${a.description} ${a.category}`.toLocaleLowerCase('th').includes(needle)));
  if (!selected.length) return '<div class="empty">ยังไม่มีแอปข้อสอบที่ตรงกับเงื่อนไข</div>';
  return categories.filter(c => selected.some(a => Number(a.category_id) === Number(c.id))).map(c => {
    const items = selected.filter(a => Number(a.category_id) === Number(c.id));
    return `<section class="exam-section"><div class="exam-section-head"><h2><a href="${categoryURL(c.id)}">${e(c.icon)} ${e(c.name)}</a></h2>
      <a href="${categoryURL(c.id)}">${items.length} แอป · ดูวิชานี้ →</a></div>
      ${view === 'table' ? table(items,c,unlocked) : `<div class="exam-grid">${items.map(a => card(a, unlocked.has(String(a.id)))).join('')}</div>`}</section>`;
  }).join('');
}
export function examListHTML(apps, categories, category, unlocked = new Set(), view = 'grid') {
  return `<div class="container exam-page">
    ${category ? '<a class="back-btn" href="/exam-apps">← แอปข้อสอบทั้งหมด</a>' : ''}
    <div class="page-head library-head library-head-unlock">
      <div class="library-heading"><h1>${category ? e(category.icon) + ' ' + e(category.name) : 'แอปข้อสอบ'}</h1>${unlockForm({category,inline:true})}</div>
      <label class="exam-search header-search" for="examSearch"><span>ค้นหาแอปข้อสอบ</span><input type="search" class="search-in" id="examSearch" placeholder="ชื่อข้อสอบ วิชา หรือคำอธิบาย..."></label>
      <div class="exam-list-meta"><p class="ph-sub">${category ? e(category.description || 'เว็บแอปข้อสอบวิชา' + category.name) : 'รวมเว็บแอปข้อสอบ แยกตามวิชา เลือกข้อสอบแล้วเปิดใช้งานได้ทันที'}</p>
        <div class="view-toggle exam-view-toggle" role="group" aria-label="มุมมองแอปข้อสอบ">
          <button type="button" class="vt-btn ${view !== 'table' ? 'on' : ''}" data-exam-view="grid" aria-pressed="${view !== 'table'}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>การ์ด</button>
          <button type="button" class="vt-btn ${view === 'table' ? 'on' : ''}" data-exam-view="table" aria-pressed="${view === 'table'}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>ตาราง</button>
        </div></div></div>
    <div id="examResults">${examResultsHTML(apps,categories,category,'',unlocked,view)}</div>
    ${!category && categories.length ? `<nav class="exam-subjects" aria-label="หมวดวิชาข้อสอบ">${categories.map(c => `<a class="exam-subject" href="${categoryURL(c.id)}"><span>${e(c.icon)}</span><strong>${e(c.name)}</strong><small>${apps.filter(a => Number(a.category_id) === Number(c.id)).length} แอป →</small></a>`).join('')}</nav>` : ''}
  </div>`;
}
export function examDetailHTML(app, unlocked = false) {
  return `<div class="container exam-page exam-detail">
    <nav class="exam-breadcrumb" aria-label="เส้นทาง"><a href="/exam-apps">แอปข้อสอบ</a><span> / </span><a href="${categoryURL(app.category_id)}">${e(app.category)}</a></nav>
    <div class="page-head"><span class="tag tag-gen">${app.locked ? unlocked ? '🔓 ปลดล็อกแล้ว' : '🔒 ต้องใช้รหัส' : '🆓 ใช้ฟรี'}</span><h1>${e(app.icon)} ${e(app.title)}</h1>
      <p class="ph-sub">วิชา <a href="${categoryURL(app.category_id)}">${e(app.category)}</a></p></div>
    ${examWebURL(app.preview_image) ? `<img class="exam-detail-cover" src="${e(app.preview_image)}" alt="ตัวอย่าง ${e(app.title)}">` : ''}
    <p class="exam-description">${e(app.description || 'เปิดเว็บแอปข้อสอบเพื่อฝึกฝนและทบทวนความรู้')}</p>
    ${app.locked && !unlocked ? unlockForm({app}) : `<div class="exam-launch"><button type="button" class="btn btn-primary" id="examLaunch">🚀 เปิดแอปข้อสอบ</button></div>`}
    <p class="exam-back"><a href="${categoryURL(app.category_id)}">ดูข้อสอบวิชา${e(app.category)}ทั้งหมด →</a></p>
  </div>`;
}
