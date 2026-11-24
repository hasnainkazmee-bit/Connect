-- Event participation is not a certification, endorsement or verified account.
CREATE TABLE industry_events (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  website text NOT NULL CHECK (website ~ '^https://'),
  logo_path text NOT NULL DEFAULT '' CHECK (logo_path = '' OR logo_path ~ '^/brand/events/[a-z0-9.-]+$')
);
CREATE TABLE company_event_participations (
  company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES industry_events,
  participation text NOT NULL CHECK (participation IN ('attendee','exhibitor','sponsor','speaker')),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 2 AND 600),
  identity_note text NOT NULL CHECK (length(identity_note) BETWEEN 10 AND 1200),
  checked_at timestamptz NOT NULL,
  batch_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,event_key)
);
CREATE INDEX company_event_directory ON company_event_participations(event_key,company_id);
CREATE TABLE company_event_profile_sources (
  company_id uuid PRIMARY KEY REFERENCES companies ON DELETE CASCADE,
  batch_id text NOT NULL,
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_event_imports (
  batch_id text PRIMARY KEY,
  input_hash text NOT NULL,
  summary jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately omit the contact spreadsheet and internal research notes from public APIs.
CREATE VIEW company_public_events AS
SELECT p.company_id,e.key,e.name,e.year,e.website,e.logo_path,p.participation
FROM company_event_participations p JOIN industry_events e ON e.key=p.event_key;
