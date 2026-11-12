-- Reviewed public research is separate from company-maintained work details.
-- Importing a batch is an explicit operator action, never a migration side effect.
CREATE TABLE provider_capabilities (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  batch_id text NOT NULL,
  research jsonb NOT NULL CHECK (jsonb_typeof(research) = 'object'),
  checked_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_enrichment_audit (
  batch_id text NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  record_hash text NOT NULL,
  before_profile jsonb NOT NULL,
  after_profile jsonb NOT NULL,
  before_capabilities jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, company_id)
);
