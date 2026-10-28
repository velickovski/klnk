-- Separate encrypted v1 internal collaboration records. No legacy telephone conversion.
CREATE TABLE network_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('identity','connection','policy','memory','conversation','task','event','reminder','outbox','receipt')),
  owner_a TEXT NOT NULL REFERENCES users(id), owner_b TEXT REFERENCES users(id),
  status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX network_records_owner_a ON network_records(owner_a,kind,status);
CREATE INDEX network_records_owner_b ON network_records(owner_b,kind,status);
CREATE UNIQUE INDEX network_connection_pair ON network_records(LEAST(owner_a,owner_b),GREATEST(owner_a,owner_b)) WHERE kind='connection';
CREATE INDEX network_tasks_ready ON network_records(kind,status,created_at) WHERE kind='task';
