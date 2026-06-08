# คู่มือตั้งค่า EduApps TH
## ทำตามทีละขั้น ไม่มีโค้ด — ใช้เวลาประมาณ 1 ชั่วโมง

---

## สิ่งที่ต้องเตรียม (ทั้งหมดฟรี)
- บัญชี **GitHub** → github.com
- บัญชี **Cloudflare** → cloudflare.com
- บัญชี **imgbb.com** → imgbb.com (สำหรับอัปโหลดรูปภาพ)

---

## ขั้นที่ 1 — สร้าง Repository บน GitHub

1. เข้า github.com → Sign in
2. คลิก **New** (ปุ่มสีเขียว)
3. ตั้งชื่อ repository: `eduapps-th`
4. เลือก **Public** (สำคัญ — Cloudflare ฟรีต้องใช้ Public)
5. คลิก **Create repository**

---

## ขั้นที่ 2 — อัปโหลดไฟล์ขึ้น GitHub

### โครงสร้างโฟลเดอร์ที่ต้องอัปโหลด
```
eduapps-th/
├── public/
│   ├── index.html
│   └── admin/
│       └── index.html
├── functions/
│   └── api/
│       └── [[route]].js
├── schema.sql
└── wrangler.toml
```

### วิธีอัปโหลด
1. ใน repository ที่สร้าง คลิก **uploading an existing file**
2. ลากโฟลเดอร์ทั้งหมดมาวาง (หรืออัปโหลดทีละไฟล์)
3. คลิก **Commit changes**

---

## ขั้นที่ 3 — ตั้งค่า Cloudflare D1 (ฐานข้อมูล)

1. เข้า [dash.cloudflare.com](https://dash.cloudflare.com)
2. คลิก **Workers & Pages** ในเมนูซ้าย
3. คลิก **D1 SQL Database** → **Create database**
4. ตั้งชื่อ: `eduapps-db`
5. คลิก **Create**
6. หลังสร้างเสร็จ คลิกเข้าไปใน database
7. คลิก **Console**
8. คัดลอกเนื้อหาจากไฟล์ `schema.sql` มาวางใน Console
9. คลิก **Execute**
10. **จด Database ID ไว้** (เห็นที่หน้า database settings — รูปแบบ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)

---

## ขั้นที่ 4 — แก้ไข wrangler.toml

เปิดไฟล์ `wrangler.toml` แล้วแก้บรรทัดนี้:
```
database_id = "REPLACE_WITH_YOUR_D1_ID"
```
เปลี่ยนเป็น Database ID ที่จดไว้ในขั้นที่ 3

---

## ขั้นที่ 5 — Deploy บน Cloudflare Pages

1. ใน Cloudflare Dashboard คลิก **Workers & Pages**
2. คลิก **Create application** → **Pages**
3. คลิก **Connect to Git**
4. เลือก GitHub → authorize → เลือก repository `eduapps-th`
5. ตั้งค่า Build:
   - **Framework preset**: None
   - **Build command**: เว้นว่าง
   - **Build output directory**: `public`
6. คลิก **Save and Deploy**
7. รอสักครู่ — Cloudflare จะ deploy ให้อัตโนมัติ

---

## ขั้นที่ 6 — เชื่อม D1 Database กับ Pages

1. ไปที่ Pages project ที่เพิ่ง deploy
2. คลิก **Settings** → **Functions**
3. เลื่อนลงไปหา **D1 database bindings**
4. คลิก **Add binding**:
   - Variable name: `DB`
   - D1 database: เลือก `eduapps-db`
5. คลิก **Save**
6. **Redeploy** — คลิก **Deployments** → **Retry deployment**

---

## ขั้นที่ 7 — เข้า Admin ครั้งแรก แล้วเปลี่ยนรหัสผ่าน

ระบบตั้งรหัสผ่านเริ่มต้นให้แล้ว:

- **รหัสผ่านเริ่มต้น: `admin1234`**

1. เข้า `https://eduapps-th.pages.dev/admin/`
2. ใส่รหัส `admin1234` → เข้าสู่ระบบ
3. ⚠️ **เปลี่ยนรหัสผ่านทันที** ที่ **ตั้งค่า → เปลี่ยนรหัสผ่าน Admin**

---

## ขั้นที่ 8 — ตั้งค่า imgbb (สำหรับอัปโหลดรูป)

1. สมัครที่ [imgbb.com](https://imgbb.com)
2. คลิกรูปโปรไฟล์ → **About** → **API**
3. คลิก **Get API Key**
4. คัดลอก API Key
5. เข้า Admin Panel ของเว็บ → **ตั้งค่า** → ใส่ API Key → บันทึก

---

## ขั้นที่ 9 — เข้าใช้งาน Admin Panel

เว็บของคุณจะอยู่ที่: `https://eduapps-th.pages.dev`
Admin Panel: `https://eduapps-th.pages.dev/admin/`

---

## การอัปเดตเนื้อหาในอนาคต

### เพิ่มบทความ
เข้า Admin Panel → **เขียนบทความใหม่** → เขียน → เผยแพร่

### เพิ่มแอป
เข้า Admin Panel → **จัดการแอป** → เพิ่มแอปใหม่

### แก้ไขโค้ด
เข้า GitHub → คลิกไฟล์ → คลิกดินสอ ✏️ → แก้ไข → Commit
Cloudflare จะ deploy ใหม่อัตโนมัติภายใน 1-2 นาที

---

## ปัญหาที่พบบ่อย

**Q: เว็บแสดงข้อผิดพลาด 500**
A: ตรวจสอบว่า D1 binding ชื่อ `DB` ถูกต้อง และ schema.sql ถูก execute แล้ว

**Q: Admin login ไม่ได้**
A: รหัสผ่านเริ่มต้นคือ `admin1234` — ถ้าเปลี่ยนแล้วลืม ให้รัน SQL นี้ใน D1 Console เพื่อรีเซ็ตกลับเป็น admin1234:
```sql
UPDATE settings SET value = 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270' WHERE key = 'admin_password';
```

**Q: อัปโหลดรูปไม่ได้**
A: ตรวจสอบ imgbb API Key ใน Settings

**Q: อยากเปลี่ยนชื่อเว็บ**
A: เข้า Admin Panel → ตั้งค่า → เปลี่ยนชื่อเว็บ → บันทึก

---

## ติดต่อขอความช่วยเหลือ

ถ้าติดปัญหาใด ให้บอก Claude ว่า:
"ช่วยดู error นี้หน่อย: [วาง error message]"
Claude จะช่วยแก้ให้ได้ครับ
