// อัปเดตเลขเวอร์ชันของ app.css / app.js ใน index.html
//
// ทำไมต้องมี: Cloudflare ตั้ง Browser Cache TTL ไว้ 4 ชั่วโมง ซึ่งทับค่าใน _headers
// ถ้าไม่มีเลขเวอร์ชันในลิงก์ ผู้ใช้ที่เคยเข้าเว็บแล้วจะยังใช้โค้ดเก่าไปอีกถึง 4 ชม.
// หลัง deploy — เคยทำให้ผู้ใช้ไม่เห็นการแก้ไขและเข้าใจว่าเว็บพัง
//
// เลขเวอร์ชันคำนวณจากเนื้อไฟล์ ถ้าไม่ได้แก้อะไรเลขก็ไม่เปลี่ยน (cache ไม่เสียเปล่า)
//
// วิธีใช้: รัน `node update-asset-version.mjs` ทุกครั้งที่แก้ app.css หรือ app.js
// ก่อน commit  (ถ้าลืม สคริปต์จะไม่ทำอะไร แต่ผู้ใช้จะได้ของเก่าไปอีก 4 ชม.)
import fs from 'node:fs';
import crypto from 'node:crypto';

const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
const vCss = hash('public/app.css');
const vJs  = hash('public/app.js');

let html = fs.readFileSync('public/index.html', 'utf8');
const before = html;
html = html.replace(/href="\/app\.css(\?v=[a-f0-9]+)?"/, `href="/app.css?v=${vCss}"`);
html = html.replace(/src="\/app\.js(\?v=[a-f0-9]+)?"/,   `src="/app.js?v=${vJs}"`);

if (html === before) {
  console.log('เลขเวอร์ชันตรงกับเนื้อไฟล์อยู่แล้ว ไม่มีอะไรต้องแก้');
} else {
  fs.writeFileSync('public/index.html', html);
  console.log('อัปเดตแล้ว:  app.css?v=' + vCss + '   app.js?v=' + vJs);
}
