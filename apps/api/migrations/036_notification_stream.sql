-- Payloads contain only the recipient identifier. SSE rechecks session and
-- notification visibility before sending a content-free refresh event.
CREATE FUNCTION connect_notification_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('connect_notifications_changed', NEW.user_id::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_notifications_stream_changed
AFTER INSERT OR UPDATE OF read_at ON user_notifications
FOR EACH ROW EXECUTE FUNCTION connect_notification_changed();
