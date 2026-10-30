CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL,
 tagline text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', type text NOT NULL DEFAULT 'Installer',
 location text NOT NULL DEFAULT '', service_areas text[] NOT NULL DEFAULT '{}', services text[] NOT NULL DEFAULT '{}',
 website text NOT NULL DEFAULT '', cover_url text NOT NULL DEFAULT '/assets/solar.jpg',
 logo_style text NOT NULL DEFAULT 'sun', established integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 user_id uuid REFERENCES users ON DELETE CASCADE, company_id uuid REFERENCES companies ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','admin','member')), title text NOT NULL DEFAULT '',
 PRIMARY KEY(user_id,company_id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid REFERENCES companies ON DELETE SET NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 name text NOT NULL, description text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
 size text NOT NULL DEFAULT '', image_url text NOT NULL DEFAULT '/assets/solar.jpg'
);
CREATE TABLE connection_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_id uuid NOT NULL REFERENCES companies,
 to_id uuid NOT NULL REFERENCES companies, author_id uuid NOT NULL REFERENCES users,
 note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz,
 CHECK(from_id <> to_id)
);
CREATE UNIQUE INDEX one_pending_request ON connection_requests(LEAST(from_id,to_id),GREATEST(from_id,to_id)) WHERE status='pending';
CREATE TABLE connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_a uuid NOT NULL REFERENCES companies,
 company_b uuid NOT NULL REFERENCES companies, status text NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','disconnected')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_a,company_b), CHECK(company_a < company_b)
);
CREATE TABLE blocks (
 blocker_id uuid REFERENCES companies, blocked_id uuid REFERENCES companies,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES connections,
 sender_company_id uuid NOT NULL REFERENCES companies, author_id uuid NOT NULL REFERENCES users,
 body text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_time ON messages(connection_id,created_at,id);
CREATE TABLE attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES messages ON DELETE CASCADE,
 original_name text NOT NULL, storage_name text NOT NULL UNIQUE, mime_type text NOT NULL, size integer NOT NULL
);
CREATE TABLE conversation_reads (
 connection_id uuid REFERENCES connections, company_id uuid REFERENCES companies, read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connection_id,company_id)
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies,
 type text NOT NULL, text text NOT NULL, related_company_id uuid REFERENCES companies,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX notifications_company_time ON notifications(company_id,created_at DESC);
CREATE TABLE team_invites (
 token_hash text PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies, email text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','member')), expires_at timestamptz NOT NULL, accepted_at timestamptz
);
