ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN reauth_until TIMESTAMPTZ;
CREATE TABLE account_challenges (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('verify_email','password_reset','email_change')),
 token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
 payload TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_challenges_owner ON account_challenges(owner_id,kind);
CREATE INDEX account_challenges_expiry ON account_challenges(expires_at);
CREATE TABLE account_mail_outbox (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 challenge_id TEXT NOT NULL REFERENCES account_challenges(id) ON DELETE CASCADE, kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','accepted','unknown','failed','cancelled')),
 payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ, lease_token TEXT, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_mail_ready ON account_mail_outbox(status,run_at);
CREATE INDEX account_mail_owner ON account_mail_outbox(owner_id);
