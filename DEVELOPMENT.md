# การพัฒนาและทดสอบในเครื่อง

ไฟล์ชุดนี้ใช้ทดสอบ Cloudflare Pages Functions, D1 และ R2 ในเครื่อง โดยไม่แตะข้อมูลจริงบน production

## เตรียมครั้งแรก

1. สร้างไฟล์ secret สำหรับเครื่องนี้:

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   นำค่าที่สร้างได้ไปแทนค่า `AUTH_SECRET` ใน `.dev.vars`

2. สร้างฐานข้อมูล D1 จำลองและลง schema:

   ```powershell
   wrangler d1 execute eduapps-db-local --local --file schema.sql
   ```

3. เปิดเว็บและ Functions ในเครื่อง:

   ```powershell
   wrangler pages dev public
   ```

   จากนั้นเปิด `http://localhost:8788`

ข้อมูลทดสอบจะถูกเก็บใต้ `.wrangler/` และไม่ถูก commit ขึ้น GitHub ส่วน R2 จำลองจะใช้ binding ชื่อ `BUCKET` และ D1 จำลองใช้ binding ชื่อ `DB` เหมือน production

## ขั้นตอนแก้ไขที่แนะนำ

1. สร้าง branch ใหม่จาก `main`
2. แก้ไฟล์ใน `public/` หรือ `functions/`
3. ทดสอบในเครื่องด้วยคำสั่งด้านบน
4. push branch และตรวจ Cloudflare Preview URL
5. merge เข้า `main` เมื่อผลทดสอบถูกต้อง เพื่อให้ Cloudflare Pages deploy production อัตโนมัติ

Cloudflare Pages project ของเว็บนี้ชื่อ `kruticom` ก่อนแก้การตั้งค่า production ด้วย Wrangler ให้ล็อกอิน Cloudflare และดาวน์โหลดค่าปัจจุบันจาก Dashboard ด้วย `wrangler pages download config kruticom` แล้วตรวจเทียบก่อนเสมอ ไฟล์ `wrangler.jsonc` ชุดนี้ตั้งใจใช้เฉพาะ local และไม่มี `pages_build_output_dir` จึงไม่ควรใช้ deploy production

## ทดสอบหน้าจัดการรหัสปลดล็อก

รัน `node tests/admin-codes.mjs` เมื่อแก้ตัวเลือกแอปหรือใบงาน ต้องมีแพ็กเกจ Playwright และ Chromium ในเครื่อง การทดสอบเปิดเซิร์ฟเวอร์จำลองชั่วคราวและใช้ข้อมูล 100 แอป ไม่เชื่อมต่อฐานข้อมูลหรือ API จริง ตรวจการค้นหา หมวดหมู่ ประเภทฟรี/พรีเมียม/VIP ตัวกรองเลือกแล้ว/ยังไม่เลือก การแบ่งหน้า สิทธิ์ที่เลือก การบันทึก VIP และหน้าจอมือถือ

หากใช้ Playwright จาก runtime ภายนอก ให้ตั้ง `PLAYWRIGHT_MODULE_PATH` เป็นโฟลเดอร์แพ็กเกจ และใช้ `PLAYWRIGHT_CHANNEL=msedge` เพื่อทดสอบผ่าน Microsoft Edge ที่ติดตั้งอยู่ได้ หลังแก้หน้า admin ให้รัน `node update-asset-version.mjs` ก่อน commit เพื่ออัปเดต `public/version.txt`

## ตรวจความพร้อมสำหรับ AdSense

หน้า `/`, `/blog`, `/about` และ `/privacy` ส่งเนื้อหาใน HTML จาก Pages Functions เพื่อให้อ่านได้ก่อน JavaScript โหลด หน้าข้อมูลใช้ `public/info-pages.mjs` ร่วมกับการนำทางในเบราว์เซอร์ เมื่อแก้ไฟล์นี้หรือ `app.js` ให้รัน `node update-asset-version.mjs` ก่อน commit ด้วย

ทดสอบกับฐานข้อมูลจำลองแยกจากข้อมูล local เดิม:

```powershell
wrangler d1 execute eduapps-db-local --local --persist-to .wrangler/adsense-test --file schema.sql
wrangler d1 execute eduapps-db-local --local --persist-to .wrangler/adsense-test --file tests/adsense-fixture.sql
wrangler pages dev public --port 8792 --persist-to .wrangler/adsense-test
```

ใน terminal อีกหน้าต่าง รัน `node tests/adsense-readiness.mjs` เพื่อตรวจ HTML โดยไม่ใช้ JavaScript, บทความฉบับร่าง, การแบ่งหน้า/ค้นหา, escaping, sitemap, ads.txt และการตอบ 503 เมื่อฐานข้อมูลขัดข้อง

หลังเผยแพร่ ตรวจว่า `https://kru-ti.com/ads.txt` แสดง Publisher ID ตรงกับบัญชี AdSense และตรวจเนื้อหาหน้าเว็บด้วย URL Inspection ใน Search Console ก่อนกด Request review ใน AdSense การแก้ส่วนเทคนิคไม่ได้รับประกันผลอนุมัติ และหน้าที่มีเพียงปุ่มดาวน์โหลดหรือเปิดแอปยังควรเพิ่มวิธีใช้ ตัวอย่างกิจกรรม และข้อมูลจากผู้สร้าง

## ลิงก์สั้นของโรงเรียน ปพ.5–ปพ.6

ก่อน deploy โค้ดที่มี `/api/school-links` และ `/s/:token` ครั้งแรก ให้รัน `migration-school-short-links.sql` กับ D1 production (`eduapps-db`) เพียงครั้งเดียวผ่าน Cloudflare Dashboard → D1 → Console จากนั้น deploy เว็บหลักและแอป `pp5-40s.pages.dev` ตามลำดับ

ตาราง `school_short_links` มี `config_hash` แบบ unique: config เดิมได้ token เดิมเสมอ ส่วน config ที่เปลี่ยนจะได้ token ใหม่ การเปิด `/s/:token` ใช้การค้นด้วย primary key และส่ง 302 ไป URL แอปที่มี `#fbcfg=` โดยไม่แสดงหน้า iframe
