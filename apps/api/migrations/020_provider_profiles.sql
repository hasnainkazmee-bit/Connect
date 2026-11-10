CREATE TABLE provider_profiles (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  trades text[] NOT NULL DEFAULT '{}',
  project_types text[] NOT NULL DEFAULT '{}',
  availability text NOT NULL DEFAULT '',
  crew_size text NOT NULL DEFAULT '',
  capacity text NOT NULL DEFAULT '',
  license_details text NOT NULL DEFAULT '',
  insurance_details text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_profiles_trades ON provider_profiles USING gin(trades);
