ALTER TABLE oidc_flows ADD COLUMN popup_id text
  CHECK (popup_id IS NULL OR popup_id ~ '^[A-Za-z0-9_-]{32,128}$');
