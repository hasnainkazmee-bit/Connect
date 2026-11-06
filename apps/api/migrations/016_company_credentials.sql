CREATE TABLE company_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
 catalog_key text,
 category text NOT NULL CHECK(category IN ('certification','qualification','ranking','directory','membership')),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180),
 organization text NOT NULL DEFAULT '',
 scope text NOT NULL CHECK(scope IN ('company','product','personnel')),
 scope_detail text NOT NULL CHECK(length(scope_detail) BETWEEN 2 AND 600),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1200),
 source_url text NOT NULL CHECK(source_url ~ '^https://'),
 evidence_basis text NOT NULL CHECK(evidence_basis IN ('issuer','company','directory')),
 period text NOT NULL DEFAULT '',
 valid_until date,
 checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,catalog_key)
);
CREATE INDEX company_credentials_profile ON company_credentials(company_id,category,title);
