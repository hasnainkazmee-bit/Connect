-- Google Business Profile access is granted by a company administrator.
-- Refresh tokens are encrypted in the API; never return them to clients.
CREATE TABLE google_business_connections (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  authorized_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_ciphertext text NOT NULL,
  account_name text,
  location_name text,
  location_title text,
  google_maps_uri text,
  rating double precision CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  review_count integer CHECK (review_count IS NULL OR review_count >= 0),
  rating_fetched_at timestamptz,
  last_refresh_attempt_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE google_business_oauth_states (
  state_hash text PRIMARY KEY,
  session_hash text NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX google_business_oauth_states_expires ON google_business_oauth_states(expires_at);
