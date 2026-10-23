// Shared server/browser markup: protected destinations never appear before redemption.
export const examEscape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = examEscape;
export const examWebURL = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol) ? value : ''; } catch { return ''; } };
const categoryURL = id => '/exam-apps/category/' + Number(id);

function unlockForm({app, category} = {}) {
  return `<form id="examUnlockForm" class="exam-unlock" method="post" ${app ? `data-app="${Number(app.id)}"` : category ? `data-category="${Number(category.id)}"` : ''}>
    <label for="examCode">🔑 ${app ? 'ปลดล็อกแอปข้อสอบนี้' : category ? 'ปลดล็อกข้อสอบในวิชานี้' : 'ปลดล็อกแอปข้อสอบ'}</label>
    <p>ใช้รหัสเดียวกับระบบปลดล็อกเดิม สิทธิ์ขึ้นอยู่กับแพ็กเกจของรหัส: ทุกข้อสอบ รายวิชา หรือรายแอป</p>
    <div class="exam-unlock-row"><input id="examCode" name="code" placeholder="กรอกรหัสปลดล็อก" required autocomplete="off" aria-label="รหัสปลดล็อกแอปข้อสอบ">
    <button class="btn btn-primary" type="submit">🔓 ปลดล็อก</button></div>
    <p id="examUnlockMsg" role="status" aria-live="polite"></p>
    <a href="/buy">ดูวิธีขอรหัส →</a>
  </form>`;
}
function card(app, isUnlocked) {
  return `<article class="exam-card">
    <a class="exam-card-main" href="/exam-apps/${Number(app.id)}">
      ${examWebURL(app.preview_image) ? `<img class="exam-cover" src="${e(app.preview_image)}" alt="ตัวอย่าง ${e(app.title)}" loading="lazy">` : `<div class="exam-cover exam-cover-placeholder">${e(app.icon || '📝')}</div>`}
      <div class="exam-card-body"><span class="tag tag-gen">${app.locked ? isUnlocked ? '🔓 ปลดล็อกแล้ว' : '🔒 ใช้รหัส' : '🆓 ฟรี'}</span>
        <h3>${e(app.title)}</h3><p>${e(app.description)}</p></div>
    </a>
    <a class="exam-card-category" href="${categoryURL(app.category_id)}">${e(app.category)} →</a>
  </article>`;
}
export function examResultsHTML(apps, categories, category, query = '', unlocked = new Set()) {
  const needle = query.trim().toLocaleLowerCase('th');
  const selected = apps.filter(a => (!category || Number(a.category_id) === Number(category.id))
    && (!needle || `${a.title} ${a.description} ${a.category}`.toLocaleLowerCase('th').includes(needle)));
  if (!selected.length) return '<div class="empty">ยังไม่มีแอปข้อสอบที่ตรงกับเงื่อนไข</div>';
  return categories.filter(c => selected.some(a => Number(a.category_id) === Number(c.id))).map(c => {
    const items = selected.filter(a => Number(a.category_id) === Number(c.id));
    return `<section class="exam-section"><div class="exam-section-head"><h2><a href="${categoryURL(c.id)}">${e(c.icon)} ${e(c.name)}</a></h2>
      <a href="${categoryURL(c.id)}">${items.length} แอป · ดูวิชานี้ →</a></div>
      <div class="exam-grid">${items.map(a => card(a, unlocked.has(String(a.id)))).join('')}</div></section>`;
  }).join('');
}
export function examListHTML(apps, categories, category, unlocked = new Set()) {
  return `<div class="container exam-page">
    ${category ? '<a class="back-btn" href="/exam-apps">← แอปข้อสอบทั้งหมด</a>' : ''}
    <div class="page-head"><h1>${category ? e(category.icon) + ' ' + e(category.name) : 'แอปข้อสอบ'}</h1>
      <p class="ph-sub">${category ? e(category.description || 'เว็บแอปข้อสอบวิชา' + category.name) : 'รวมเว็บแอปข้อสอบ แยกตามวิชา เลือกข้อสอบแล้วเปิดใช้งานได้ทันที'}</p></div>
    ${!category && categories.length ? `<nav class="exam-subjects" aria-label="หมวดวิชาข้อสอบ">${categories.map(c => `<a class="exam-subject" href="${categoryURL(c.id)}"><span>${e(c.icon)}</span><strong>${e(c.name)}</strong><small>${apps.filter(a => Number(a.category_id) === Number(c.id)).length} แอป →</small></a>`).join('')}</nav>` : ''}
    <label class="exam-search" for="examSearch">ค้นหาแอปข้อสอบ<input type="search" class="search-in" id="examSearch" placeholder="ชื่อข้อสอบ วิชา หรือคำอธิบาย..."></label>
    ${unlockForm({category})}
    <div id="examResults">${examResultsHTML(apps,categories,category,'',unlocked)}</div>
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
