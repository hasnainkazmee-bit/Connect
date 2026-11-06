-- Upgrade databases that applied 012 before Android version filtering was added.
CREATE OR REPLACE FUNCTION connect_queue_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO push_deliveries(notification_id,device_id)
 SELECT NEW.id,d.id FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash
 WHERE d.user_id=NEW.user_id AND s.expires_at>now()
 AND (NEW.source_kind<>'release' OR EXISTS(
  SELECT 1 FROM notification_releases r WHERE r.id=NEW.source_id
   AND r.platform=d.platform
   AND (r.platform<>'android' OR d.app_version_code IS NULL
    OR (r.version ~ '^[0-9]+$' AND d.app_version_code<r.version::bigint))
 ));
 RETURN NEW;
END $$;

CREATE FUNCTION connect_notification_release_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF NOT NEW.announce THEN RETURN NEW; END IF;
 FOR target IN
  SELECT DISTINCT user_id FROM push_devices
  WHERE platform=NEW.platform
   AND (NEW.platform<>'android' OR app_version_code IS NULL
    OR (NEW.version ~ '^[0-9]+$' AND app_version_code<NEW.version::bigint))
 LOOP
  PERFORM connect_notify(NULL,target,NULL,NULL,
   'release:'||NEW.platform||':'||NEW.version,'release','updates',
   NEW.title,NEW.body,'/account/updates','release',NEW.id);
 END LOOP;
 RETURN NEW;
END $$;

DROP TRIGGER notifications_release ON notification_releases;
CREATE TRIGGER notifications_release
 AFTER INSERT ON notification_releases
 FOR EACH ROW EXECUTE FUNCTION connect_notification_release_event();
