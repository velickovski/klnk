ALTER TABLE network_records ADD COLUMN failure_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE network_records ADD COLUMN next_attempt_at TIMESTAMPTZ;
ALTER TABLE network_records ADD COLUMN dead_lettered_at TIMESTAMPTZ;
CREATE INDEX network_tasks_retry ON network_records(next_attempt_at) WHERE kind='task' AND dead_lettered_at IS NULL;

CREATE TABLE request_limits (
  key_hash TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL,
  blocked_until TIMESTAMPTZ
);
CREATE INDEX request_limits_expiry ON request_limits(reset_at);
