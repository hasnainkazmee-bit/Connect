-- Durable inbox and delivery outbox. Business-row triggers share the writer's
-- transaction, so a rolled-back message can never produce a notification.
CREATE TABLE notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 messages boolean NOT NULL DEFAULT true, social boolean NOT NULL DEFAULT true,
 requests boolean NOT NULL DEFAULT true, team boolean NOT NULL DEFAULT true,
 updates boolean NOT NULL DEFAULT true, previews boolean NOT NULL DEFAULT false
);
CREATE TABLE user_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial UNIQUE NOT NULL,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 company_id uuid REFERENCES companies ON DELETE CASCADE,
 actor_user_id uuid REFERENCES users ON DELETE SET NULL,
 actor_company_id uuid REFERENCES companies ON DELETE CASCADE,
 event_key text NOT NULL, type text NOT NULL,
 category text NOT NULL CHECK(category IN ('messages','social','requests','team','updates')),
 title text NOT NULL, text text NOT NULL, url text NOT NULL CHECK(url LIKE '/%' AND url NOT LIKE '//%'),
 source_kind text NOT NULL, source_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
 UNIQUE(user_id,event_key)
);
CREATE INDEX user_notifications_page ON user_notifications(user_id,sequence DESC);
CREATE TABLE push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 installation_id uuid NOT NULL UNIQUE, binding_id uuid NOT NULL,
 platform text NOT NULL CHECK(platform IN ('web','android')),
 address_hash text NOT NULL UNIQUE, address text NOT NULL, p256dh text, auth text,
 app_version_code integer, app_version_name text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user ON push_devices(user_id);
CREATE TABLE push_deliveries (
 id bigserial PRIMARY KEY, notification_id uuid NOT NULL REFERENCES user_notifications ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES push_devices ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_token uuid, delivered_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 last_error text, UNIQUE(notification_id,device_id)
);
CREATE INDEX push_deliveries_due ON push_deliveries(next_attempt_at) WHERE delivered_at IS NULL;
CREATE TABLE notification_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL,
 version text NOT NULL, title text NOT NULL, body text NOT NULL, announce boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(platform,version)
);

CREATE FUNCTION connect_notify(target_company uuid,target_user uuid,actor_company uuid,actor_user uuid,
 event text,kind text,category_name text,heading text,description text,link text,source text,source_uuid uuid)
 RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO user_notifications(user_id,company_id,actor_user_id,actor_company_id,event_key,type,category,title,text,url,source_kind,source_id)
 SELECT u.id,target_company,actor_user,actor_company,event,kind,category_name,left(heading,150),left(description,500),link,source,source_uuid
 FROM users u WHERE
 ((target_user IS NOT NULL AND u.id=target_user) OR (target_user IS NULL AND EXISTS(
  SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.company_id=target_company
   AND (category_name NOT IN ('requests','team') OR m.role IN ('owner','admin')))))
 AND u.id IS DISTINCT FROM actor_user
 AND (actor_company IS NULL OR target_company IS DISTINCT FROM actor_company)
 AND (actor_company IS NULL OR NOT EXISTS(SELECT 1 FROM memberships am WHERE am.user_id=u.id AND am.company_id=actor_company))
 AND (target_company IS NULL OR actor_company IS NULL OR NOT EXISTS(SELECT 1 FROM blocks b
  WHERE (b.blocker_id=target_company AND b.blocked_id=actor_company) OR (b.blocker_id=actor_company AND b.blocked_id=target_company)))
 ON CONFLICT(user_id,event_key) DO NOTHING;
END $$;
CREATE FUNCTION connect_queue_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO push_deliveries(notification_id,device_id)
 SELECT NEW.id,d.id FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash
 WHERE d.user_id=NEW.user_id AND s.expires_at>now()
 AND (NEW.source_kind<>'release' OR EXISTS(SELECT 1 FROM notification_releases r WHERE r.id=NEW.source_id AND r.platform=d.platform
  AND (r.platform<>'android' OR d.app_version_code IS NULL OR (r.version ~ '^[0-9]+$' AND d.app_version_code<r.version::bigint))));
 RETURN NEW;
END $$;
CREATE TRIGGER notification_push AFTER INSERT ON user_notifications FOR EACH ROW EXECUTE FUNCTION connect_queue_push();

CREATE FUNCTION connect_notification_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; actor uuid; actor_user uuid; display_name text; post_company uuid; parent_company uuid; row_data record; key text;
BEGIN
 IF TG_TABLE_NAME='messages' THEN
  IF NEW.source_request_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT CASE WHEN company_a=NEW.sender_company_id THEN company_b ELSE company_a END INTO target FROM connections WHERE id=NEW.connection_id;
  SELECT name INTO display_name FROM companies WHERE id=NEW.sender_company_id;
  PERFORM connect_notify(target,NULL,NEW.sender_company_id,NEW.author_id,'message:'||NEW.id,'message','messages',display_name,
    CASE WHEN length(NEW.body)>0 THEN NEW.body ELSE 'Sent an attachment.' END,'/messages?conversation='||NEW.connection_id,'connection',NEW.connection_id);
 ELSIF TG_TABLE_NAME='connection_requests' THEN
  IF TG_OP='INSERT' AND NEW.status='pending' THEN
   SELECT name INTO display_name FROM companies WHERE id=NEW.from_id;
   PERFORM connect_notify(NEW.to_id,NULL,NEW.from_id,NEW.author_id,'request:'||NEW.id,
    CASE WHEN NEW.kind='message' THEN 'message_request' ELSE 'request' END,'requests',display_name,
    CASE WHEN NEW.kind='message' THEN 'Sent you a message request.' ELSE 'Would like to connect.' END,
    '/messages?company='||NEW.from_id,'request',NEW.id);
  ELSIF TG_OP='UPDATE' AND NEW.status='accepted' AND OLD.status='pending' THEN
   SELECT name INTO display_name FROM companies WHERE id=NEW.to_id;
   PERFORM connect_notify(NEW.from_id,NULL,NEW.to_id,NULL,'request-accepted:'||NEW.id,'accepted','requests',display_name,
    'Accepted your request.','/messages?company='||NEW.to_id,'request',NEW.id);
  END IF;
 ELSIF TG_TABLE_NAME='personal_messages' THEN
  SELECT * INTO row_data FROM personal_threads WHERE id=NEW.thread_id;
  IF NEW.sender_kind='individual' THEN
   SELECT name INTO display_name FROM users WHERE id=NEW.author_id;
   PERFORM connect_notify(row_data.company_id,NULL,NULL,NEW.author_id,'personal-message:'||NEW.id,
    CASE WHEN row_data.status='pending' THEN 'message_request' ELSE 'message' END,
    CASE WHEN row_data.status='pending' THEN 'requests' ELSE 'messages' END,display_name,NEW.body,
    '/messages?personal='||NEW.thread_id,'personal',NEW.thread_id);
  ELSE
   SELECT name INTO display_name FROM companies WHERE id=row_data.company_id;
   PERFORM connect_notify(NULL,row_data.user_id,row_data.company_id,NEW.author_id,'personal-message:'||NEW.id,'message','messages',display_name,NEW.body,
    '/messages?personal='||NEW.thread_id,'personal',NEW.thread_id);
  END IF;
 ELSIF TG_TABLE_NAME='personal_threads' THEN
  IF NEW.status='accepted' AND OLD.status='pending' THEN
   SELECT name INTO display_name FROM companies WHERE id=NEW.company_id;
   PERFORM connect_notify(NULL,NEW.user_id,NEW.company_id,NULL,'personal-accepted:'||NEW.id,'accepted','requests',display_name,
    'Accepted your message request.','/messages?personal='||NEW.id,'personal',NEW.id);
  END IF;
 ELSIF TG_TABLE_NAME='post_comments' THEN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT company_id INTO post_company FROM posts WHERE id=NEW.post_id AND status='published';
  IF post_company IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO display_name FROM companies WHERE id=NEW.company_id;
  IF NEW.parent_id IS NOT NULL THEN
   SELECT company_id INTO parent_company FROM post_comments WHERE id=COALESCE(NEW.reply_to_id,NEW.parent_id);
   PERFORM connect_notify(parent_company,NULL,NEW.company_id,NEW.author_id,'comment:'||NEW.id,'reply','social',display_name,
    'Replied to your comment.','/posts/'||NEW.post_id||'?comment='||NEW.id,'comment',NEW.id);
  END IF;
  PERFORM connect_notify(post_company,NULL,NEW.company_id,NEW.author_id,'comment:'||NEW.id,'comment','social',display_name,
   'Commented on your post.','/posts/'||NEW.post_id||'?comment='||NEW.id,'comment',NEW.id);
 ELSIF TG_TABLE_NAME='post_reactions' THEN
  SELECT company_id INTO post_company FROM posts WHERE id=NEW.post_id AND status='published';
  IF post_company IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO display_name FROM companies WHERE id=NEW.company_id;
  -- One notification per acting company/post/day across emoji toggles and re-adds.
  PERFORM connect_notify(post_company,NULL,NEW.company_id,NEW.author_id,
   'reaction:'||NEW.post_id||':'||NEW.company_id||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),
   'reaction','social',display_name,'Reacted to your post.','/posts/'||NEW.post_id,'post',NEW.post_id);
 ELSIF TG_TABLE_NAME='company_follows' THEN
  SELECT name INTO display_name FROM companies WHERE id=NEW.follower_id;
  PERFORM connect_notify(NEW.followed_id,NULL,NEW.follower_id,NULL,'follow:'||NEW.followed_id||':'||NEW.follower_id||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),
   'follow','social',display_name,'Started following your company.','/company/'||NEW.follower_id,'company',NEW.follower_id);
 ELSIF TG_TABLE_NAME='individual_follows' THEN
  SELECT name INTO display_name FROM users WHERE id=NEW.user_id;
  PERFORM connect_notify(NEW.company_id,NULL,NULL,NEW.user_id,'follow:'||NEW.company_id||':'||NEW.user_id||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),
   'follow','social',display_name,'Started following your company.','/company/'||NEW.company_id,'company',NEW.company_id);
 ELSIF TG_TABLE_NAME='team_invites' THEN
  IF TG_OP='INSERT' THEN
   SELECT u.id INTO target FROM users u WHERE u.email=NEW.email AND u.email_verified_at IS NOT NULL AND u.account_type='company';
   IF target IS NOT NULL THEN
    SELECT name,COALESCE(username,slug) AS handle INTO row_data FROM companies WHERE id=NEW.company_id;
    PERFORM connect_notify(NULL,target,NEW.company_id,NULL,'invite:'||NEW.id,'team_invite','team',row_data.name,
     'Invited you to manage its company profile.','/join/'||row_data.handle,'invite',NEW.id);
   END IF;
  ELSIF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
   SELECT id,name INTO row_data FROM users WHERE email=NEW.email;
   PERFORM connect_notify(NEW.company_id,NULL,NULL,row_data.id,'invite-accepted:'||NEW.id,'team_joined','team','Your company team',
    COALESCE(row_data.name,'An employee')||' joined your company team.','/company/'||NEW.company_id,'company',NEW.company_id);
  END IF;
 ELSIF TG_TABLE_NAME='posts' THEN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status='draft') AND NOT NEW.is_demo THEN
   SELECT name INTO display_name FROM companies WHERE id=NEW.company_id;
   FOR target IN SELECT follower_id FROM company_follows WHERE followed_id=NEW.company_id LOOP
    PERFORM connect_notify(target,NULL,NEW.company_id,NEW.author_id,'publication:'||NEW.id,'publication','social',display_name,
     CASE WHEN NEW.kind='press_release' THEN 'Published a press release.' ELSE 'Shared a new post.' END,'/posts/'||NEW.id,'post',NEW.id);
   END LOOP;
   FOR target IN SELECT user_id FROM individual_follows WHERE company_id=NEW.company_id LOOP
    PERFORM connect_notify(NULL,target,NEW.company_id,NEW.author_id,'publication:'||NEW.id,'publication','social',display_name,
     CASE WHEN NEW.kind='press_release' THEN 'Published a press release.' ELSE 'Shared a new post.' END,'/posts/'||NEW.id,'post',NEW.id);
   END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='notification_releases' THEN
  IF NOT NEW.announce THEN RETURN NEW; END IF;
  FOR target IN SELECT DISTINCT user_id FROM push_devices WHERE platform=NEW.platform
    AND (NEW.platform<>'android' OR app_version_code IS NULL OR (NEW.version ~ '^[0-9]+$' AND app_version_code<NEW.version::bigint)) LOOP
   PERFORM connect_notify(NULL,target,NULL,NULL,'release:'||NEW.platform||':'||NEW.version,'release','updates',NEW.title,NEW.body,
    '/account/updates','release',NEW.id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notifications_messages AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_requests AFTER INSERT OR UPDATE OF status ON connection_requests FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_personal AFTER INSERT ON personal_messages FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_personal_accepted AFTER UPDATE OF status ON personal_threads FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_comments AFTER INSERT ON post_comments FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_reactions AFTER INSERT ON post_reactions FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_company_follow AFTER INSERT ON company_follows FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_individual_follow AFTER INSERT ON individual_follows FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_team AFTER INSERT OR UPDATE OF accepted_at ON team_invites FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_publication AFTER INSERT OR UPDATE OF status ON posts FOR EACH ROW EXECUTE FUNCTION connect_notification_event();
CREATE TRIGGER notifications_release AFTER INSERT ON notification_releases FOR EACH ROW EXECUTE FUNCTION connect_notification_event();

-- Retain the recent legacy inbox when clients move to per-user read state.
INSERT INTO user_notifications(user_id,company_id,actor_company_id,event_key,type,category,title,text,url,source_kind,source_id,created_at,read_at)
SELECT m.user_id,n.company_id,n.related_company_id,'legacy:'||n.id,n.type,
 CASE WHEN n.type='message' THEN 'messages' ELSE 'requests' END,'Connect',n.text,
 '/company/'||COALESCE(n.related_company_id,n.company_id),'company',COALESCE(n.related_company_id,n.company_id),n.created_at,n.read_at
FROM notifications n JOIN memberships m ON m.company_id=n.company_id
WHERE n.created_at>now()-interval '90 days' AND n.company_id IS DISTINCT FROM n.related_company_id
ON CONFLICT DO NOTHING;
