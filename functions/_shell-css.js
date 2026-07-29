// เปลือก CSS ที่หน้า SSR ทั้ง 3 หน้าใช้ร่วมกัน (article / apps / worksheet)
//
// ทำไมต้องมีไฟล์นี้: เดิมกฎชุดนี้ถูกก๊อปไว้ในทั้ง 3 ไฟล์ แล้วค่อย ๆ เพี้ยนออกจากกัน
// เช่นตัวกันเมนูล้นบนจอแคบถูกเพิ่มให้หน้าแอปกับใบงาน แต่หน้าบทความไม่ได้ตามไปด้วย
// สแกนเมื่อ 29 ก.ค. 2569: มี selector 21 ตัวที่อยู่ครบทั้ง 3 หน้า แต่เหมือนกันเป๊ะแค่ 10
//
// **เอาเฉพาะส่วนที่ต้องเหมือนกันจริง ๆ เท่านั้น** — แถบเมนู ปุ่มย้อนกลับ ป้ายหมวด ตัวแปรสี
// ส่วน .rel-* .more และ footer ต่างกันโดยตั้งใจ (คนละเลย์เอาต์) ปล่อยไว้ในไฟล์ของแต่ละหน้า
//
// ⚠️ ห้ามให้หน้า SSR ไปโหลด public/app.css แทน — ชื่อ class ชนกันจริง
// (.btn .lock .free .cover ในนั้นนิยามไว้คนละแบบ ปุ่มกับป้ายในหน้าแอปจะเพี้ยนทันที)
//
// ไฟล์นี้ขึ้นต้นด้วย _ จึงไม่ถูก Pages Functions มองเป็น route (ตรวจด้วย wrangler build แล้ว)
export const SHELL_CSS = `
:root{--ink:#101c33;--ink-soft:#3d4c68;--gold:#f3ac2e;--gold-bright:#ffc555;--gold-deep:#c47f0e;
--gold-soft:rgba(243,172,46,.13);--chalk:#f5efdf;--mint:#0fa294;--paper:#faf7f1;
--line:#e8e1d3;--slate:#6d7588;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Sarabun',sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;}
nav{background:var(--ink);height:62px;padding:0 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.logo{font-family:'Pridi',serif;font-size:1.15rem;font-weight:700;color:#fff;text-decoration:none;display:flex;align-items:center;gap:9px;flex-shrink:0;}
.logo-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--gold),var(--gold-deep));display:flex;align-items:center;justify-content:center;color:var(--ink);font-size:1rem;}
.logo em{font-style:normal;font-size:.65rem;color:#7587a5;align-self:flex-start;margin-top:2px;}
/* ขนาดตัวอักษร/ระยะขอบต้องตรงกับ .nav-links ใน public/app.css
   overflow-x + nowrap คือตัวกันเมนูล้นบนจอแคบ — หน้า SSR ไม่มีปุ่มแฮมเบอร์เกอร์แบบเว็บหลัก
   (ต้องใช้ JS) ถ้าซ่อนเมนูบนมือถือ คนที่เข้ามาจาก Google จะไม่เหลือทางไปหน้าอื่นเลย */
.nav-links{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;}
.nav-links::-webkit-scrollbar{display:none;}
.nav-links a{padding:9px 16px;border-radius:9px;font-size:.94rem;font-weight:600;color:#aebad0;text-decoration:none;white-space:nowrap;}
.nav-links a:hover{color:#fff;background:rgba(255,255,255,.07);}
.back{color:var(--slate);font-size:.9rem;font-weight:600;text-decoration:none;display:inline-block;margin-bottom:20px;}
.back:hover{color:var(--ink);}
.cat{background:var(--gold-soft);color:var(--gold-deep);padding:3px 12px;border-radius:100px;font-size:.73rem;font-weight:700;}
footer a{color:var(--gold-bright);text-decoration:none;font-weight:700;}
`;
