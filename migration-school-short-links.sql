-- Run once against the production D1 database before deploying /s/:token.
CREATE TABLE IF NOT EXISTS school_short_links (
  token       TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
