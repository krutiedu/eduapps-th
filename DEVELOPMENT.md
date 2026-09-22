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
