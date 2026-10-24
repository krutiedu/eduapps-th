-- Additive and safe to rerun. Group membership never changes unlock permissions.
CREATE TABLE IF NOT EXISTS access_code_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS access_code_group_members (
  code_id INTEGER PRIMARY KEY REFERENCES access_codes(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES access_code_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_code_group_members_group ON access_code_group_members(group_id);
