-- Colabb Network is separate from the retired company-update feature.
-- Authorization is enforced by Rust using the real session user/company.
CREATE TABLE network_administrators (
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE network_communities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 owner_company_id uuid NOT NULL REFERENCES companies,
 created_by uuid NOT NULL REFERENCES users,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 visibility text NOT NULL CHECK(visibility IN ('public','private')),
 join_policy text NOT NULL CHECK(join_policy IN ('open','approval')),
 rules jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(rules)='array'),
 topics jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(topics)='array'),
 require_topic boolean NOT NULL DEFAULT false,
 is_demo boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 archived_at timestamptz, cover_file_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX network_communities_partition ON network_communities(is_demo,sequence DESC);
CREATE TABLE network_members (
 community_id uuid NOT NULL REFERENCES network_communities ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies,
 role text NOT NULL CHECK(role IN ('admin','moderator','member')),
 status text NOT NULL CHECK(status IN ('joined','pending','removed')),
 sequence bigserial UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,user_id)
);
CREATE INDEX network_members_user ON network_members(user_id,status,sequence DESC);
CREATE TABLE network_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 community_id uuid NOT NULL REFERENCES network_communities ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(trim(email))),
 role text NOT NULL CHECK(role IN ('admin','moderator','member')),
 token_hash text NOT NULL UNIQUE, invited_by uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','revoked')),
 expires_at timestamptz NOT NULL, accepted_by uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz
);
CREATE UNIQUE INDEX network_invitation_pending ON network_invitations(community_id,email) WHERE status='pending';
CREATE TABLE network_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 client_id uuid NOT NULL, request_hash text NOT NULL, author_id uuid NOT NULL REFERENCES users,
 company_id uuid NOT NULL REFERENCES companies,
 community_id uuid REFERENCES network_communities,
 kind text NOT NULL CHECK(kind IN ('post','question','sourcing','available')),
 title text NOT NULL DEFAULT '' CHECK(length(title)<=180),
 body text NOT NULL CHECK(length(body)<=10000), mentions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(mentions)='array'),
 topic_id uuid, topic_label text NOT NULL DEFAULT '', topic_version integer,
 answers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(answers)='array'),
 media_format text NOT NULL DEFAULT '4:5' CHECK(media_format IN ('4:5','1:1','1.91:1','3:4')),
 comments_open boolean NOT NULL DEFAULT true,
 sourcing_status text NOT NULL DEFAULT 'open' CHECK(sourcing_status IN ('open','sourced','unavailable')),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','deleted','removed')),
 is_demo boolean NOT NULL DEFAULT false, pinned boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, source_job_id uuid REFERENCES jobs,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(author_id,company_id,client_id)
);
CREATE INDEX network_posts_feed ON network_posts(is_demo,sequence DESC) WHERE status='published';
CREATE INDEX network_posts_company ON network_posts(company_id,sequence DESC) WHERE status='published';
CREATE INDEX network_posts_community ON network_posts(community_id,sequence DESC) WHERE status='published';
CREATE TABLE network_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users,
 company_id uuid NOT NULL REFERENCES companies, community_id uuid REFERENCES network_communities,
 purpose text NOT NULL DEFAULT 'post' CHECK(purpose IN ('post','cover')),
 original_name text NOT NULL, storage_key text NOT NULL UNIQUE, mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 12582912),
 content_sha256 text NOT NULL, client_upload_id uuid, width integer, height integer,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,company_id,client_upload_id)
);
ALTER TABLE network_communities ADD CONSTRAINT network_community_cover FOREIGN KEY(cover_file_id) REFERENCES network_files;
CREATE TABLE network_post_files (
 post_id uuid NOT NULL REFERENCES network_posts ON DELETE CASCADE,
 file_id uuid NOT NULL UNIQUE REFERENCES network_files,
 sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 9),
 PRIMARY KEY(post_id,file_id), UNIQUE(post_id,sort_order)
);
CREATE TABLE network_drafts (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE NOT NULL,
 author_id uuid NOT NULL REFERENCES users, company_id uuid NOT NULL REFERENCES companies,
 community_id uuid REFERENCES network_communities,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX network_drafts_author ON network_drafts(author_id,company_id,sequence DESC);
CREATE TABLE network_post_states (
 post_id uuid NOT NULL REFERENCES network_posts ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies,
 saved boolean NOT NULL DEFAULT false, liked boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id,user_id,company_id)
);
CREATE INDEX network_post_states_user ON network_post_states(user_id,company_id);
CREATE TABLE network_follows (
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 followed_company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,company_id,followed_company_id), CHECK(company_id<>followed_company_id)
);
CREATE INDEX network_follows_target ON network_follows(followed_company_id);
CREATE TABLE network_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 post_id uuid NOT NULL REFERENCES network_posts ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users, company_id uuid NOT NULL REFERENCES companies,
 parent_id uuid REFERENCES network_comments, client_id uuid NOT NULL, request_hash text NOT NULL,
 body text NOT NULL CHECK(length(body)<=5000), mentions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(mentions)='array'), version integer NOT NULL DEFAULT 1,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(post_id,author_id,company_id,client_id)
);
CREATE INDEX network_comments_post ON network_comments(post_id,sequence);
CREATE TABLE network_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 post_id uuid NOT NULL REFERENCES network_posts, community_id uuid REFERENCES network_communities,
 reporter_id uuid NOT NULL REFERENCES users, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 120),
 details text NOT NULL DEFAULT '' CHECK(length(details)<=3000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','kept','removed')),
 resolution_reason text NOT NULL DEFAULT '', resolved_by uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX network_report_open ON network_reports(post_id,reporter_id) WHERE status='open';
CREATE INDEX network_reports_queue ON network_reports(community_id,status,sequence DESC);
CREATE TABLE network_moderation_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid REFERENCES network_communities,
 post_id uuid REFERENCES network_posts, report_id uuid REFERENCES network_reports,
 actor_id uuid NOT NULL REFERENCES users, action text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE network_notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 replies boolean NOT NULL DEFAULT true, mentions boolean NOT NULL DEFAULT true,
 community_posts boolean NOT NULL DEFAULT true, company_posts boolean NOT NULL DEFAULT true
);
-- These helpers are authorization predicates, not SECURITY DEFINER functions.
CREATE FUNCTION network_can_read_community(cid uuid,uid uuid,demo boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM network_communities c WHERE c.id=cid AND c.is_demo=demo
 AND (c.visibility='public' OR EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.owner_company_id AND m.user_id=uid AND m.role IN ('owner','admin')) OR EXISTS(SELECT 1 FROM network_members m WHERE m.community_id=c.id AND m.user_id=uid AND m.status='joined')))
$$;
CREATE FUNCTION network_can_read_post(pid uuid,uid uuid,demo boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM network_posts p WHERE p.id=pid AND p.status='published' AND p.is_demo=demo
 AND (p.community_id IS NULL OR network_can_read_community(p.community_id,uid,demo)))
$$;
CREATE FUNCTION network_notification_visible(kind text,target uuid,uid uuid,demo boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE kind
 WHEN 'network_post' THEN network_can_read_post(target,uid,demo)
 WHEN 'network_community' THEN network_can_read_community(target,uid,demo)
 WHEN 'network_invitation' THEN EXISTS(SELECT 1 FROM network_invitations i JOIN network_communities c ON c.id=i.community_id JOIN users u ON lower(u.email)=i.email WHERE i.id=target AND u.id=uid AND u.email_verified_at IS NOT NULL AND c.is_demo=demo AND i.status='pending' AND i.expires_at>now())
 ELSE false END
$$;
