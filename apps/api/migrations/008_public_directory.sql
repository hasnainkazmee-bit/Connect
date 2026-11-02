ALTER TABLE companies
  ADD COLUMN listing_status text NOT NULL DEFAULT 'managed' CHECK (listing_status IN ('unclaimed','managed')),
  ADD COLUMN audiences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN phone text NOT NULL DEFAULT '',
  ADD COLUMN source_url text NOT NULL DEFAULT '',
  ADD COLUMN source_checked_at timestamptz,
  ADD COLUMN ownership_verified_at timestamptz,
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN name_key text GENERATED ALWAYS AS (regexp_replace(lower(normalize(name,NFKD)), '[^a-z0-9]', '', 'g')) STORED;
CREATE INDEX companies_name_key ON companies(name_key);

-- Claim domains are operator-curated evidence, never editable profile fields.
CREATE TABLE company_claim_domains (
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain=lower(domain)),
  source_url text NOT NULL,
  PRIMARY KEY(company_id,domain)
);
CREATE INDEX company_claim_domains_domain ON company_claim_domains(domain);
CREATE INDEX companies_directory_type ON companies(type,name) WHERE NOT is_demo;
CREATE INDEX companies_directory_areas ON companies USING gin(service_areas);
CREATE TABLE company_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  method text NOT NULL CHECK(method IN ('work_email','manual')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
  role_description text NOT NULL DEFAULT '',
  evidence text NOT NULL DEFAULT '',
  review_note text NOT NULL DEFAULT '',
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX company_claims_pending ON company_claims(company_id,user_id) WHERE status='pending';
CREATE UNIQUE INDEX company_claims_approved ON company_claims(company_id) WHERE status='approved';

UPDATE companies SET is_demo=true WHERE slug IN ('helioworks-solar','brightfield-energy','solara-supply','greenridge-power','cedar-roof-solar','suncraft-installations')
  AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=companies.id AND u.email LIKE '%.test');
