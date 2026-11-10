-- Additional scope is optional for existing listings; unknown is never zero.
ALTER TABLE jobs
  ADD COLUMN project_type text NOT NULL DEFAULT '' CHECK (project_type IN ('','residential','commercial','utility','mixed')),
  ADD COLUMN system_size_kw numeric(12,2) CHECK (system_size_kw > 0 AND system_size_kw <= 100000000),
  ADD COLUMN site_count integer CHECK (site_count BETWEEN 1 AND 100000),
  ADD COLUMN materials_by text NOT NULL DEFAULT 'to_agree' CHECK (materials_by IN ('to_agree','hiring_company','provider')),
  ADD COLUMN requirements text NOT NULL DEFAULT '' CHECK (length(requirements) <= 3000);
ALTER TABLE job_quotes ADD COLUMN price_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(price_breakdown) = 'array' AND jsonb_array_length(price_breakdown) <= 20);
