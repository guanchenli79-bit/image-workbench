CREATE TABLE IF NOT EXISTS model_rule_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  config_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  rollback_of INTEGER CHECK (rollback_of IS NULL OR rollback_of >= 0)
);
