-- Additive runtime upgrade. Never edit an already-applied migration.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS runtime_locks (
  name TEXT PRIMARY KEY
);
INSERT INTO runtime_locks(name) VALUES('live_reservations') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('creating','active','closing','closed','unconfirmed','rejected')),
  provider_session_id TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  reason_code TEXT,
  terminal_evidence TEXT,
  UNIQUE(owner_id,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_one_unresolved_owner
  ON live_sessions(owner_id) WHERE status IN ('creating','active','closing','unconfirmed');
CREATE INDEX IF NOT EXISTS live_sessions_status ON live_sessions(status,created_at);
