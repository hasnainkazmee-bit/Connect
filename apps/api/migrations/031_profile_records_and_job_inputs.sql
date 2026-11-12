-- Keep imported prose intact while company owners add structured records.
ALTER TABLE provider_profiles ADD COLUMN work_settings jsonb;
ALTER TABLE provider_profiles ADD CONSTRAINT provider_work_settings_object
 CHECK(work_settings IS NULL OR jsonb_typeof(work_settings)='object');

ALTER TABLE company_credentials DROP CONSTRAINT company_credentials_source_url_check;
ALTER TABLE company_credentials ADD CONSTRAINT company_credentials_source_url_check
 CHECK(source_url='' OR source_url ~ '^https://');
ALTER TABLE company_credentials ADD COLUMN credential_number text NOT NULL DEFAULT '';
ALTER TABLE company_credentials ADD COLUMN issued_on date;
ALTER TABLE company_credentials ADD COLUMN does_not_expire boolean NOT NULL DEFAULT false;
ALTER TABLE company_credentials ADD CONSTRAINT credential_validity
 CHECK((issued_on IS NULL OR valid_until IS NULL OR valid_until>=issued_on) AND (NOT does_not_expire OR valid_until IS NULL));

CREATE TABLE company_licenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 license_type text NOT NULL,
 license_number text NOT NULL,
 authority text NOT NULL,
 jurisdiction text NOT NULL,
 holder text NOT NULL,
 classification text NOT NULL DEFAULT '',
 issued_on date,
 expires_on date,
 does_not_expire boolean NOT NULL DEFAULT false,
 verification_url text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(issued_on IS NULL OR expires_on IS NULL OR expires_on>=issued_on),
 CHECK(NOT does_not_expire OR expires_on IS NULL)
);
CREATE INDEX company_licenses_company ON company_licenses(company_id);

CREATE TABLE company_insurance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 coverage_type text NOT NULL,
 insurer text NOT NULL,
 coverage_limit numeric(15,2) CHECK(coverage_limit>0),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency IN ('USD','CAD')),
 limit_basis text NOT NULL DEFAULT '' CHECK(limit_basis IN ('','per_occurrence','aggregate','statutory')),
 expires_on date NOT NULL,
 verification_url text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_insurance_company ON company_insurance(company_id);

ALTER TABLE jobs ADD COLUMN posting_details jsonb;
ALTER TABLE jobs ADD CONSTRAINT job_posting_details_object
 CHECK(posting_details IS NULL OR jsonb_typeof(posting_details)='object');
