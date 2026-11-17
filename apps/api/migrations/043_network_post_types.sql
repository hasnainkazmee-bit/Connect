-- Post types belong to the community host. Empty means an ordinary discussion.
ALTER TABLE network_communities
  ADD COLUMN post_types jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(post_types) = 'array' AND jsonb_array_length(post_types) <= 20);

-- Snapshot the chosen type so later changes never rewrite published history.
ALTER TABLE network_posts
  ADD COLUMN post_type_id uuid,
  ADD COLUMN post_type_label text NOT NULL DEFAULT '',
  ADD COLUMN post_type_version integer CHECK (post_type_version > 0),
  ADD CONSTRAINT network_post_type_snapshot CHECK (
    (post_type_id IS NULL AND post_type_version IS NULL)
    OR (community_id IS NOT NULL AND post_type_id IS NOT NULL
        AND post_type_version IS NOT NULL AND length(post_type_label) > 0)
  );

-- Existing discussions keep their original behaviour and a readable historical label.
UPDATE network_posts SET post_type_label = CASE kind
  WHEN 'question' THEN 'Question'
  WHEN 'sourcing' THEN 'Looking for equipment'
  WHEN 'available' THEN 'Equipment available'
  ELSE '' END
WHERE community_id IS NOT NULL;
