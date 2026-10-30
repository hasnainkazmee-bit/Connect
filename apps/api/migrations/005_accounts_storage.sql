ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN onboarding_completed_at timestamptz;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
-- Preserve the explicitly seeded test accounts; real addresses must be verified.
UPDATE users SET email_verified_at=created_at WHERE email LIKE '%.test';
UPDATE users SET onboarding_completed_at=created_at;
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX sessions_id ON sessions(id);
CREATE INDEX sessions_user ON sessions(user_id,expires_at);
CREATE TABLE auth_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')), code_hash text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_challenges_user ON auth_challenges(user_id,purpose,created_at DESC);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE auth_limits (
 key_hash text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
CREATE TABLE auth_events (
 id bigserial PRIMARY KEY, user_id uuid REFERENCES users ON DELETE SET NULL,
 event text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user ON auth_events(user_id,created_at DESC);
CREATE TABLE email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient text NOT NULL, subject text NOT NULL,
 payload_encrypted text, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_pending ON email_outbox(available_at) WHERE sent_at IS NULL;
ALTER TABLE messages ADD COLUMN client_id uuid;
ALTER TABLE messages ADD COLUMN content_hash text;
CREATE UNIQUE INDEX messages_idempotency ON messages(connection_id,sender_company_id,client_id) WHERE client_id IS NOT NULL;
ALTER TABLE attachments ADD COLUMN storage_backend text NOT NULL DEFAULT 'local' CHECK(storage_backend IN ('local','s3'));
ALTER TABLE attachments ADD COLUMN sha256 text;
ALTER TABLE post_media ADD COLUMN storage_backend text NOT NULL DEFAULT 'local' CHECK(storage_backend IN ('local','s3'));
ALTER TABLE post_media ADD COLUMN sha256 text;
CREATE TABLE storage_deletions (
 id bigserial PRIMARY KEY, storage_backend text NOT NULL, storage_key text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(storage_backend,storage_key)
);
CREATE INDEX memberships_company ON memberships(company_id,user_id);
CREATE INDEX connection_requests_recipient ON connection_requests(to_id,status,created_at DESC);
CREATE INDEX connection_requests_sender ON connection_requests(from_id,status,created_at DESC);
CREATE INDEX connections_company_b ON connections(company_b,updated_at DESC);
