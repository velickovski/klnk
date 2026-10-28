-- Controller ownership is separate from provider lifecycle evidence.
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS controller_id TEXT;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS controller_lease_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS live_sessions_controller ON live_sessions(controller_id,controller_lease_until);
