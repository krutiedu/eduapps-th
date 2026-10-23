-- Run ONCE on an existing database before deploying the exam-app feature.
-- New databases should use schema.sql instead (it already includes these columns).
CREATE TABLE IF NOT EXISTS exam_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '📚',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exam_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES exam_categories(id),
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📝',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  preview_image TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 1,
  lock_code TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exam_apps_category ON exam_apps(category_id, visible, sort_order);
ALTER TABLE access_codes ADD COLUMN exam_app_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE access_codes ADD COLUMN exam_category_ids TEXT NOT NULL DEFAULT '[]';
