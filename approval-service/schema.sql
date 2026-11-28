CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  username TEXT,
  username_hash TEXT,
  password_cipher TEXT,
  password_iv TEXT,
  machine_code TEXT NOT NULL,
  machine_hash TEXT NOT NULL,
  machine_code_version INTEGER NOT NULL DEFAULT 1,
  device_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','unbound','expired')),
  expires_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS applications_device_idx ON applications(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_phone_idx ON applications(phone_hash, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS applications_approved_phone_idx ON applications(phone_hash) WHERE status='approved';
CREATE INDEX IF NOT EXISTS applications_username_idx ON applications(username_hash, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS applications_approved_username_idx ON applications(username_hash) WHERE status='approved' AND username_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS applications_approved_machine_idx ON applications(machine_hash) WHERE status='approved';

CREATE TABLE IF NOT EXISTS active_announcement (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_rule_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  config_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  rollback_of INTEGER CHECK (rollback_of IS NULL OR rollback_of >= 0)
);
