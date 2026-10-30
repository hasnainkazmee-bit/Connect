ALTER TABLE users ADD COLUMN account_type text NOT NULL DEFAULT 'company' CHECK(account_type IN ('company','individual'));
ALTER TABLE companies ADD COLUMN username text UNIQUE;
ALTER TABLE companies ADD COLUMN logo_url text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN employee_count text NOT NULL DEFAULT '';
ALTER TABLE companies ADD CONSTRAINT companies_username_format CHECK(username IS NULL OR username ~ '^[a-z][a-z0-9-]{1,28}[a-z0-9]$');
CREATE TABLE company_username_history (username text PRIMARY KEY,company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE);
CREATE TABLE individual_follows (user_id uuid REFERENCES users ON DELETE CASCADE,company_id uuid REFERENCES companies ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,company_id));
CREATE INDEX individual_follows_company ON individual_follows(company_id);
ALTER TABLE posts DROP CONSTRAINT posts_body_check;
ALTER TABLE posts ADD CONSTRAINT posts_body_check CHECK(length(body)<=50000);
ALTER TABLE posts ADD COLUMN kind text NOT NULL DEFAULT 'post' CHECK(kind IN ('post','article','press_release','case_study'));
ALTER TABLE posts ADD COLUMN title text NOT NULL DEFAULT '' CHECK(length(title)<=180);
ALTER TABLE posts ADD COLUMN subtitle text NOT NULL DEFAULT '' CHECK(length(subtitle)<=300);
ALTER TABLE posts ADD COLUMN document jsonb;
ALTER TABLE posts ADD COLUMN status text NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published'));
ALTER TABLE posts ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE posts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE posts ADD COLUMN published_at timestamptz;
UPDATE posts SET published_at=created_at;
ALTER TABLE posts ADD COLUMN cover_media_id uuid REFERENCES post_media ON DELETE SET NULL;
CREATE INDEX posts_published_company ON posts(company_id,kind,sequence DESC) WHERE status='published';
CREATE TABLE company_achievements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 title text NOT NULL,issuer text NOT NULL DEFAULT '',year integer CHECK(year BETWEEN 1900 AND 2200),
 description text NOT NULL DEFAULT '',url text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects ADD COLUMN completed_year integer CHECK(completed_year BETWEEN 1900 AND 2200);
ALTER TABLE projects ADD COLUMN url text NOT NULL DEFAULT '';
CREATE TABLE company_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 storage_name text NOT NULL UNIQUE,storage_backend text NOT NULL,mime_type text NOT NULL,size bigint NOT NULL,sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 120),body text NOT NULL CHECK(length(body) BETWEEN 20 AND 3000),
 experience_date date NOT NULL,reply text NOT NULL DEFAULT '',replied_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,user_id)
);
CREATE INDEX company_reviews_recent ON company_reviews(company_id,created_at DESC,id);
CREATE TABLE review_reports (
 review_id uuid REFERENCES company_reviews ON DELETE CASCADE,user_id uuid REFERENCES users ON DELETE CASCADE,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(review_id,user_id)
);
CREATE TABLE personal_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 user_read_sequence bigint NOT NULL DEFAULT 0,company_read_sequence bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,company_id)
);
CREATE TABLE personal_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigserial UNIQUE NOT NULL,
 thread_id uuid NOT NULL REFERENCES personal_threads ON DELETE CASCADE,author_id uuid NOT NULL REFERENCES users,
 sender_kind text NOT NULL CHECK(sender_kind IN ('individual','company')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 client_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(thread_id,author_id,client_id)
);
CREATE INDEX personal_messages_thread ON personal_messages(thread_id,sequence);
ALTER TABLE team_invites ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE team_invites ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE team_invites ADD COLUMN revoked_at timestamptz;
