CREATE TABLE company_follows (
  follower_id uuid REFERENCES companies ON DELETE CASCADE,
  followed_id uuid REFERENCES companies ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(follower_id,followed_id), CHECK(follower_id<>followed_id)
);
CREATE INDEX company_follows_target ON company_follows(followed_id);
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users,
  body text NOT NULL DEFAULT '' CHECK(length(body)<=4000),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX posts_company_sequence ON posts(company_id,sequence DESC);
CREATE TABLE post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  storage_name text NOT NULL UNIQUE, original_name text NOT NULL, mime_type text NOT NULL,
  size bigint NOT NULL, position integer NOT NULL, alt text NOT NULL DEFAULT ''
);
CREATE TABLE post_likes (
  post_id uuid REFERENCES posts ON DELETE CASCADE, company_id uuid REFERENCES companies ON DELETE CASCADE,
  PRIMARY KEY(post_id,company_id)
);
CREATE TABLE post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial NOT NULL,
  post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX post_comments_order ON post_comments(post_id,sequence);
