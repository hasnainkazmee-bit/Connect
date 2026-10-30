-- Give existing companies readable addresses. Old slugs remain valid lookup aliases.
-- Reserved names are the routing vocabulary at the time of this migration.
DO $$
DECLARE
  c record;
  base text;
  candidate text;
  number integer;
  reserved text[] := ARRAY['www', 'app', 'api', 'admin', 'administrator', 'support', 'help', 'login', 'signup', 'register', 'mail', 'email', 'static', 'assets', 'connect', 'sunhub', 'sunhubconnect', 'settings', 'account', 'security', 'status', 'billing', 'legal', 'privacy', 'terms', 'cdn', 'images', 'media', 'files', 'auth', 'oauth', 'directory', 'company', 'invite', 'join', 'requests', 'onboarding', 'notifications', 'session', 'team', 'mobile', 'health', 'ready', 'uploads', 'network', 'messages', 'posts', 'write', 'reviews', 'test', 'staging', 'localhost'];
BEGIN
  FOR c IN SELECT id,name FROM companies WHERE username IS NULL ORDER BY created_at,id LOOP
    base := left(trim(both '-' from regexp_replace(lower(c.name),'[^a-z0-9]+','-','g')),24);
    base := rtrim(base,'-');
    IF base !~ '^[a-z]' THEN base := rtrim(left('company-' || base,24),'-'); END IF;
    IF length(base)<3 OR base=ANY(reserved) THEN base := base || '-company'; END IF;
    base := rtrim(left(base,24),'-');
    number := 1;
    LOOP
      candidate := base || CASE WHEN number=1 THEN '' ELSE '-' || number::text END;
      EXIT WHEN NOT EXISTS(SELECT 1 FROM companies WHERE id<>c.id AND (username=candidate OR slug=candidate))
        AND NOT EXISTS(SELECT 1 FROM company_username_history WHERE username=candidate AND company_id<>c.id);
      number := number+1;
      IF number>1000 THEN RAISE EXCEPTION 'Cannot assign a default username for company %',c.id; END IF;
    END LOOP;
    UPDATE companies SET username=candidate WHERE id=c.id;
    INSERT INTO company_username_history(username,company_id) VALUES(candidate,c.id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
