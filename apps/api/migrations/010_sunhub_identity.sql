CREATE TABLE external_identities (
 issuer text NOT NULL, subject text NOT NULL,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id)
);
CREATE TABLE oidc_flows (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL,
 verifier text NOT NULL, nonce text NOT NULL, issuer text NOT NULL,
 return_to text NOT NULL, account_type text NOT NULL CHECK(account_type IN ('company','individual')),
 link_user_id uuid REFERENCES users ON DELETE CASCADE, link_session_hash text,
 mobile_redirect text, mobile_state text, mobile_challenge text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX oidc_flows_expiry ON oidc_flows(expires_at);
CREATE TABLE mobile_auth_handoffs (
 code_hash text PRIMARY KEY, challenge text NOT NULL,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 seconds'
);
CREATE INDEX mobile_auth_handoffs_expiry ON mobile_auth_handoffs(expires_at);
