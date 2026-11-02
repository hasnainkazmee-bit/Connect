CREATE TABLE post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial UNIQUE NOT NULL,
  post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  author_id uuid REFERENCES users ON DELETE SET NULL,
  emoji text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (post_id, company_id, emoji)
);
CREATE INDEX post_reactions_page ON post_reactions(post_id, sequence);
INSERT INTO post_reactions(post_id,company_id,emoji)
SELECT post_id,company_id,'🎉' FROM post_likes ON CONFLICT DO NOTHING;

ALTER TABLE post_comments
  ADD COLUMN parent_id uuid REFERENCES post_comments ON DELETE CASCADE,
  ADD COLUMN reply_to_id uuid REFERENCES post_comments ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamptz,
  DROP CONSTRAINT post_comments_body_check,
  ADD CONSTRAINT post_comments_body_check CHECK (
    (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1500)
    OR (deleted_at IS NOT NULL AND body='')
  ),
  ADD CONSTRAINT post_comments_not_self CHECK (parent_id IS DISTINCT FROM id AND reply_to_id IS DISTINCT FROM id);
CREATE INDEX post_comments_threads ON post_comments(post_id,parent_id,sequence);
