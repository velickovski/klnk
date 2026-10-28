CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('profile','contact','memory','mission','attempt','action','voice','calendar','integration','optout')),
  parent_id TEXT, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resources_owner_kind ON resources(owner_id,kind);
CREATE INDEX IF NOT EXISTS resources_parent ON resources(owner_id,parent_id);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','cancelled','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,run_at);
CREATE TABLE IF NOT EXISTS provider_events (
  event_key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, resource_id TEXT NOT NULL,
  event TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
