-- ═══════════════════════════════════════
-- EduApps TH — Database Schema
-- Cloudflare D1 (SQLite)
-- ═══════════════════════════════════════

-- บทความ
CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  slug        TEXT    UNIQUE NOT NULL,
  category    TEXT    DEFAULT 'ทั่วไป',
  excerpt     TEXT,
  content     TEXT,
  image_url   TEXT,
  published   INTEGER DEFAULT 0,
  views       INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

-- แอป
CREATE TABLE IF NOT EXISTS apps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  icon        TEXT    DEFAULT '🎮',
  title       TEXT    NOT NULL,
  category    TEXT    DEFAULT 'อื่นๆ',
  description TEXT,
  url         TEXT,
  prompt      TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- คอมเมนต์
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  approved    INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ตั้งค่าเว็บ
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- session admin
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- ═══════════════════════════════════════
-- ข้อมูลเริ่มต้น
-- ═══════════════════════════════════════
INSERT OR IGNORE INTO settings VALUES ('site_title',    'EduApps TH');
INSERT OR IGNORE INTO settings VALUES ('site_tagline',  'สื่อการสอน Interactive สำหรับครูและนักเรียนไทย');
INSERT OR IGNORE INTO settings VALUES ('site_desc',     'รวมแอปการศึกษาพร้อมใช้ฟรี พร้อม prompt สำหรับผู้ที่อยากสร้างแอปของตัวเอง');
INSERT OR IGNORE INTO settings VALUES ('author_name',   'ผู้ดูแลเว็บ');
-- รหัสผ่านเริ่มต้นคือ "admin1234" (เปลี่ยนทันทีหลัง login ครั้งแรก ที่หน้าตั้งค่า)
INSERT OR IGNORE INTO settings VALUES ('admin_password','ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270');
INSERT OR IGNORE INTO settings VALUES ('imgbb_key',     '');
INSERT OR IGNORE INTO settings VALUES ('adsense_id',    '');

-- บทความตัวอย่าง
INSERT OR IGNORE INTO articles (id,title,slug,category,excerpt,content,published) VALUES (
  1,
  'วิธีสร้างแอปการศึกษาด้วย AI ในเวลาแค่ชั่วโมงเดียว',
  'create-edu-app-with-ai',
  'เทคนิค',
  'ปัจจุบัน AI ช่วยให้ครูสร้างสื่อการสอนแบบ Interactive ได้เองในเวลาไม่นาน บทความนี้บอกวิธีทีละขั้นตอน',
  '<h2>ทำไมครูต้องทำแอปเอง?</h2><p>ในยุค AI แบบนี้ ครูทุกคนสามารถสร้างสื่อการสอนแบบ Interactive ได้เองโดยไม่ต้องรู้โค้ด เพียงแค่รู้จักตั้งคำถาม (prompt) กับ AI ให้เป็น</p><h2>ขั้นตอนการสร้างแอป</h2><p>เริ่มจากกำหนดจุดประสงค์ให้ชัดเจน แล้วค่อยเขียน prompt ที่ดี ระบุรูปแบบ เนื้อหา และฟีเจอร์ที่ต้องการ</p>',
  1
);

INSERT OR IGNORE INTO articles (id,title,slug,category,excerpt,content,published) VALUES (
  2,
  'BBL กับการออกแบบกิจกรรมคณิตศาสตร์ที่สนุก',
  'bbl-math-activity',
  'วิชาการ',
  'Brain-Based Learning คือแนวทางการสอนที่สอดคล้องกับการทำงานของสมอง',
  '<h2>BBL คืออะไร?</h2><p>Brain-Based Learning หรือ BBL คือการจัดการเรียนรู้ที่ตั้งอยู่บนหลักการทำงานของสมองมนุษย์ โดยเน้นการเรียนรู้ผ่านประสาทสัมผัสทั้งหมด</p>',
  1
);

-- แอปตัวอย่าง
INSERT OR IGNORE INTO apps (id,icon,title,category,description,url,prompt,sort_order) VALUES (
  1,'⚡','MathBolt','คณิตศาสตร์',
  'เกมคิดเลขเร็วแบบ Game 24 มี 3D tiles, เสียง Web Audio และ confetti เหมาะทุกระดับ',
  'https://your-mathbolt-url.pages.dev',
  'สร้างเกมคิดเลขเร็วแบบ Game 24 เป็น single HTML file'||char(10)||'- มีกระเบื้อง 3D แสดงตัวเลข 4 ตัว'||char(10)||'- ผู้เล่นต้องใช้ + − × ÷ ทำให้ได้ 24',
  1
);

INSERT OR IGNORE INTO apps (id,icon,title,category,description,url,prompt,sort_order) VALUES (
  2,'🎰','สล็อตสะกดคำ','ภาษาไทย',
  'เกมสล็อตฝึกสะกดคำภาษาไทย ป.1–ป.3 สนุกและเรียนรู้ไปพร้อมกัน',
  'https://your-slot-url.pages.dev',
  'สร้างเกมสล็อตฝึกสะกดคำภาษาไทยเป็น single HTML file'||char(10)||'- คลังคำ ป.1–ป.3',
  2
);
