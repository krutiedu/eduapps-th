-- ═══════════════════════════════════════════════════════════
-- Kru-ti ครูติ TH (kru-ti.com) — Database Schema
-- Cloudflare D1 (SQLite) — database: eduapps-db, binding: DB
--
-- ไฟล์นี้ถอดมาจากโครงสร้างจริงของ D1 production เมื่อ 26 ก.ค. 2569
-- (ที่มา: SELECT sql FROM sqlite_master)
--
-- วิธีใช้: วางทั้งไฟล์ใน D1 Console แล้ว Execute
-- ทุกคำสั่งเป็น IF NOT EXISTS — รันซ้ำกับฐานข้อมูลที่มีอยู่แล้วได้ ไม่ทำข้อมูลหาย
--
-- หมายเหตุ: ไม่รวม 2 ตารางที่ระบบสร้างเอง ห้ามสร้างด้วยมือ
--   _cf_KV          — ตารางภายในของ Cloudflare D1
--   sqlite_sequence — SQLite สร้างอัตโนมัติเมื่อใช้ AUTOINCREMENT
-- ═══════════════════════════════════════════════════════════


-- ═══ เนื้อหาเว็บ ═══════════════════════════════════════════

-- บทความ
-- view_count= ยอดวิวที่ใช้จริงทั้งเว็บ นับจาก POST /api/track ที่เดียว
--             (กันนับซ้ำราย visitor ใน 30 วินาที และต้องรัน JS จึงตัดบอตส่วนใหญ่ออก)
-- views     = ของเก่า **เลิกนับแล้ว 29 ก.ค. 2569** เก็บไว้เป็นประวัติเฉย ๆ ห้ามเอาไปแสดง
--             เดิมบวกทุกครั้งที่มีการเรียก API หรือเปิดหน้า SSR จึงรวมบอต/ตัวดึงพรีวิว
--             ของ LINE/Facebook และการกด F5 ซ้ำ ๆ เข้าไปด้วย ตัวเลขสูงกว่าคนอ่านจริงมาก
-- pinned    = 0 ไม่ปัก, 1-3 ลำดับที่ปักไว้บนสุด
CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  slug        TEXT    UNIQUE NOT NULL,
  category    TEXT    DEFAULT 'general',
  excerpt     TEXT,
  content     TEXT,
  image_url   TEXT,
  published   INTEGER DEFAULT 0,
  views       INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now')),
  author_name TEXT    DEFAULT '',
  pinned      INTEGER DEFAULT 0,
  view_count  INTEGER DEFAULT 0
);

-- แอป
-- locked=1  → API จะไม่ส่ง url ออกหน้าเว็บจนกว่าจะปลดล็อกด้วยรหัส
-- visible=0 → ซ่อนจากหน้าเว็บ (ยังเห็นในหน้า admin)
CREATE TABLE IF NOT EXISTS apps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icon          TEXT    DEFAULT 'app',
  title         TEXT    NOT NULL,
  category      TEXT    DEFAULT 'other',
  description   TEXT,
  url           TEXT,
  prompt        TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT    DEFAULT (datetime('now')),
  locked        INTEGER DEFAULT 0,
  lock_code     TEXT    DEFAULT '',
  visible       INTEGER DEFAULT 1,
  preview_image TEXT    DEFAULT '',
  is_vip        INTEGER DEFAULT 0,
  pinned        INTEGER DEFAULT 0,
  view_count    INTEGER DEFAULT 0
);

-- ใบงาน (ค่าเริ่มต้นคือ locked=1 — ใบงานใหม่ต้องใช้รหัส เว้นแต่ตั้งเป็นฟรี)
CREATE TABLE IF NOT EXISTS worksheets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  category    TEXT    DEFAULT 'อื่นๆ',
  description TEXT,
  cover_image TEXT,
  file_url    TEXT,
  pages       INTEGER DEFAULT 0,
  locked      INTEGER DEFAULT 1,
  lock_code   TEXT,
  visible     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  downloads   INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now')),
  view_count  INTEGER DEFAULT 0
);

-- คอมเมนต์ (approved=0 = รออนุมัติ ยังไม่แสดงบนเว็บ)
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  approved   INTEGER DEFAULT 0,
  created_at TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- แจ้งปัญหาจากผู้ใช้ (status: new / doing / done)
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    DEFAULT 'อื่นๆ',
  detail     TEXT    NOT NULL,
  contact    TEXT,
  image_url  TEXT,
  status     TEXT    DEFAULT 'new',
  created_at TEXT    DEFAULT (datetime('now'))
);


-- ═══ รหัสปลดล็อก ═══════════════════════════════════════════

-- app_ids / worksheet_ids เก็บเป็น JSON array เช่น [1,2,3] หรือ ["all"]
CREATE TABLE IF NOT EXISTS access_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    UNIQUE NOT NULL,
  label         TEXT    NOT NULL,
  app_ids       TEXT    DEFAULT '[]',
  expires_at    TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT    DEFAULT (datetime('now')),
  worksheet_ids TEXT    DEFAULT '[]'
);


-- ═══ ผู้ใช้และเซสชัน ════════════════════════════════════════

-- role: super_admin (เห็นทุกอย่าง) / editor (ดูตาม permissions)
-- permissions = JSON array จาก ['articles','comments','apps','worksheets']
-- หมายเหตุ: password_hash เป็น SHA-256 เปล่า ไม่มี salt — ควรเปลี่ยนไปใช้ PBKDF2
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  role          TEXT    DEFAULT 'editor',
  created_at    TEXT    DEFAULT (datetime('now')),
  permissions   TEXT    DEFAULT '[]',
  role_label    TEXT    DEFAULT ''
);

-- เซสชัน admin (อายุ 7 วัน) — user_id=0 คือ admin หลักที่ login ด้วย settings.admin_password
-- ตารางนี้ไม่มีการลบแถวที่หมดอายุอัตโนมัติ ควรล้างเป็นระยะ:
--   DELETE FROM sessions WHERE expires_at < datetime('now');
CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  created_at   TEXT    DEFAULT (datetime('now')),
  expires_at   TEXT    NOT NULL,
  user_id      INTEGER DEFAULT 0,
  username     TEXT    DEFAULT 'admin',
  role         TEXT    DEFAULT 'super_admin',
  display_name TEXT    DEFAULT 'Admin'
);


-- ═══ ตั้งค่าเว็บ ═════════════════════════════════════════════

-- key ที่ระบบใช้: site_title, site_tagline, site_desc, author_name,
--                admin_password, imgbb_key, adsense_id, article_categories
-- key ที่ลงท้ายด้วย _key/_secret/_token/_password จะไม่ถูกส่งออก GET /settings สาธารณะ
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);


-- ═══ สถิติผู้เข้าชม ══════════════════════════════════════════

-- visitor_id เป็น hash แบบเบา ไม่เก็บข้อมูลระบุตัวตน
CREATE TABLE IF NOT EXISTS page_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  visitor_id TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now'))
);


-- ═══ KruBoard (ต้องมี R2 binding ชื่อ BUCKET + ตัวแปร AUTH_SECRET) ═══

-- ครูที่ใช้ KruBoard — รหัสผ่านมี salt (ต่างจากตาราง users)
CREATE TABLE IF NOT EXISTS kb_teachers (
  username   TEXT    PRIMARY KEY,
  name       TEXT,
  pass_hash  TEXT    NOT NULL,
  pass_salt  TEXT    NOT NULL,
  active     INTEGER DEFAULT 1,
  bytes_used INTEGER DEFAULT 0,
  created    INTEGER NOT NULL,
  last_seen  INTEGER
);

-- กระดานส่งงาน
CREATE TABLE IF NOT EXISTS kb_boards (
  id       TEXT    PRIMARY KEY,
  owner    TEXT    NOT NULL,
  title    TEXT    NOT NULL,
  room     TEXT,
  roster   INTEGER DEFAULT 0,
  peer     INTEGER DEFAULT 0,
  term_tag TEXT,
  created  INTEGER NOT NULL
);

-- งานที่นักเรียนส่ง — img_key คือ key ของรูปใน R2 (status: wait / ตรวจแล้ว)
CREATE TABLE IF NOT EXISTS kb_subs (
  id       TEXT    PRIMARY KEY,
  board    TEXT    NOT NULL,
  no       INTEGER NOT NULL,
  name     TEXT,
  img_key  TEXT    NOT NULL,
  status   TEXT    DEFAULT 'wait',
  score    TEXT,
  comment  TEXT,
  created  INTEGER NOT NULL,
  reviewed INTEGER,
  UNIQUE(board, no)
);


-- ═══ INDEX ══════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_articles_pinned   ON articles(pinned);
CREATE INDEX IF NOT EXISTS idx_apps_pinned       ON apps(pinned);
CREATE INDEX IF NOT EXISTS idx_apps_is_vip       ON apps(is_vip);
CREATE INDEX IF NOT EXISTS idx_pv_created        ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_path_created   ON page_views(path, created_at);
CREATE INDEX IF NOT EXISTS idx_pv_visitor        ON page_views(visitor_id);
CREATE INDEX IF NOT EXISTS idx_boards_owner      ON kb_boards(owner);
CREATE INDEX IF NOT EXISTS idx_boards_term       ON kb_boards(term_tag);
CREATE INDEX IF NOT EXISTS idx_subs_board        ON kb_subs(board);


-- ═══ ข้อมูลตั้งต้น (ใช้เมื่อสร้างฐานข้อมูลใหม่) ═══════════════════
-- INSERT OR IGNORE — ไม่ทับค่าที่ตั้งไว้แล้ว
-- ไม่มีบทความ/แอปตัวอย่างในไฟล์นี้ เนื้อหาจริงกู้จากไฟล์ backup JSON
-- (หน้า admin → ตั้งค่าเว็บ → ดาวน์โหลดข้อมูลสำรอง)

INSERT OR IGNORE INTO settings VALUES ('site_title',   'Kru-ti ครูติ');
INSERT OR IGNORE INTO settings VALUES ('site_tagline', 'สื่อการสอน Interactive สำหรับครูและนักเรียนไทย');
INSERT OR IGNORE INTO settings VALUES ('site_desc',    'รวมแอปการศึกษาพร้อมใช้ฟรี พร้อม prompt สำหรับผู้ที่อยากสร้างแอปของตัวเอง');
INSERT OR IGNORE INTO settings VALUES ('author_name',  'kruti');
INSERT OR IGNORE INTO settings VALUES ('imgbb_key',    '');
INSERT OR IGNORE INTO settings VALUES ('adsense_id',   '');
INSERT OR IGNORE INTO settings VALUES ('article_categories', '["วิชาการ","AI & เครื่องมือ","ข่าวการศึกษา","บทความ","ใบงาน"]');

-- ⚠️ รหัสผ่าน admin เริ่มต้นคือ "admin1234" (hash ด้านล่าง)
--    บรรทัดนี้มีไว้เพื่อให้ login เข้าไปตั้งค่าได้ตอนสร้างฐานข้อมูลใหม่เท่านั้น
--    ต้องเปลี่ยนรหัสทันทีหลัง login ครั้งแรก ที่ ตั้งค่าเว็บ → เปลี่ยนรหัสผ่าน
INSERT OR IGNORE INTO settings VALUES ('admin_password','ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270');
