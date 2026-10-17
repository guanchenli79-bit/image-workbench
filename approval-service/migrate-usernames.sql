ALTER TABLE applications ADD COLUMN username TEXT;
ALTER TABLE applications ADD COLUMN username_hash TEXT;
ALTER TABLE applications ADD COLUMN password_cipher TEXT;
ALTER TABLE applications ADD COLUMN password_iv TEXT;
CREATE INDEX IF NOT EXISTS applications_username_idx ON applications(username_hash, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS applications_approved_username_idx ON applications(username_hash) WHERE status='approved' AND username_hash IS NOT NULL;
