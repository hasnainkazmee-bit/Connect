-- Matching uses reviewed, scoped facts. Discovery candidates never enter these tables.
CREATE TABLE provider_taxonomy (
  kind text NOT NULL CHECK(kind IN ('service','product')),
  id text NOT NULL CHECK(id ~ '^[a-z][a-z0-9-]{1,79}$'),
  label text NOT NULL,
  PRIMARY KEY(kind,id)
);
INSERT INTO provider_taxonomy(kind,id,label) VALUES
 ('service','solar-installation','Solar installation'),('service','solar-design','Solar design and engineering'),
 ('service','battery-storage','Battery storage installation'),('service','solar-maintenance','Solar repairs and maintenance'),
 ('service','solar-detach-reset','Solar removal and reinstallation'),('service','electrical','Electrical work'),
 ('service','ev-charging','EV charger installation'),('service','lighting','Lighting'),('service','backup-power','Backup power'),
 ('service','solar-thermal','Solar thermal'),('service','wind-power','Wind power'),('service','project-management','Project management'),
 ('service','contract-maintenance-staff','Facility maintenance personnel'),('service','safety-audits','Safety audits'),
 ('service','solar-development','Solar project development'),('service','energy-consulting','Energy consulting'),
 ('service','energy-procurement','Energy procurement'),('service','equipment-procurement','Equipment procurement'),
 ('service','equipment-supply','Equipment supply'),('service','logistics','Logistics'),
 ('service','racking-design','Racking design'),('service','racking-installation','Racking installation'),
 ('service','roofing','Roofing'),('service','permitting','Permitting'),('service','inspection','Inspections'),
 ('service','commissioning','Commissioning'),('service','solar-cleaning','Solar panel cleaning'),
 ('service','crew-supply','Installation crew supply'),('service','trenching','Trenching'),('service','interconnection','Interconnection support'),
 ('product','solar-system','Solar systems and kits'),('product','solar-modules','Solar modules'),
 ('product','inverters','Inverters'),('product','battery-storage','Batteries and storage systems'),
 ('product','racking-mounting','Racking and mounting'),('product','foundations','Foundations'),
 ('product','electrical-bos','Electrical balance of system'),('product','backup-generators','Backup generators'),
 ('product','ev-chargers','EV chargers');

CREATE TABLE provider_matching_profiles (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  state text NOT NULL DEFAULT 'unresearched' CHECK(state IN ('unresearched','reviewed','excluded_demo')),
  source_batch_id text,
  profile_snapshot jsonb,
  checked_at timestamptz,
  valid_until timestamptz,
  projected_at timestamptz,
  CHECK(state<>'reviewed' OR (profile_snapshot IS NOT NULL AND checked_at IS NOT NULL AND valid_until>checked_at AND projected_at IS NOT NULL))
);
INSERT INTO provider_matching_profiles(company_id,state)
 SELECT id,CASE WHEN is_demo THEN 'excluded_demo' ELSE 'unresearched' END FROM companies;
CREATE FUNCTION enroll_provider_matching() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO provider_matching_profiles(company_id,state) VALUES(NEW.id,CASE WHEN NEW.is_demo THEN 'excluded_demo' ELSE 'unresearched' END);
 RETURN NEW;
END $$;
CREATE TRIGGER companies_matching_inventory AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION enroll_provider_matching();

CREATE TABLE provider_evidence (
 company_id uuid NOT NULL REFERENCES provider_matching_profiles(company_id) ON DELETE CASCADE,
 id text NOT NULL,
 url text NOT NULL CHECK(url ~ '^https://'),
 title text NOT NULL,
 evidence text NOT NULL,
 basis text NOT NULL CHECK(basis IN ('company-website','issuer','company-confirmation')),
 checked_at timestamptz NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TABLE provider_offerings (
 company_id uuid NOT NULL REFERENCES provider_matching_profiles(company_id) ON DELETE CASCADE,
 id text NOT NULL,
 kind text NOT NULL,
 category_id text NOT NULL,
 title text NOT NULL,
 detail text NOT NULL,
 sectors text[] NOT NULL DEFAULT '{}' CHECK(sectors <@ ARRAY['residential','commercial','industrial','agricultural','municipal','nonprofit','utility']::text[]),
 delivery text CHECK(delivery IN ('turnkey','specialist-service','advisory','managed-project','contract-staff','labor-only','supply')),
 product_role text CHECK(product_role IN ('manufactures','distributes','supplies-and-installs')),
 systems text[] NOT NULL DEFAULT '{}',
 system_types text[] NOT NULL DEFAULT '{}' CHECK(system_types <@ ARRAY['rooftop','ground-mount','carport','pergola','fixed-tilt','tracker-foundations','floating','tracking']::text[]),
 brands text[] NOT NULL DEFAULT '{}',
 third_party_systems text NOT NULL DEFAULT 'unknown' CHECK(third_party_systems IN ('accepted','unknown')),
 PRIMARY KEY(company_id,id),
 FOREIGN KEY(kind,category_id) REFERENCES provider_taxonomy(kind,id),
 CHECK((kind='service' AND product_role IS NULL AND delivery IS NOT NULL) OR (kind='product' AND product_role IS NOT NULL AND delivery IS NULL))
);
CREATE INDEX provider_offerings_category ON provider_offerings(kind,category_id,company_id);
CREATE INDEX provider_offerings_sectors ON provider_offerings USING gin(sectors);
CREATE TABLE provider_offering_evidence (
 company_id uuid NOT NULL,offering_id text NOT NULL,evidence_id text NOT NULL,
 PRIMARY KEY(company_id,offering_id,evidence_id),
 FOREIGN KEY(company_id,offering_id) REFERENCES provider_offerings(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,evidence_id) REFERENCES provider_evidence(company_id,id) ON DELETE CASCADE
);
CREATE TABLE provider_coverage_areas (
 company_id uuid NOT NULL REFERENCES provider_matching_profiles(company_id) ON DELETE CASCADE,
 id text NOT NULL,
 label text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('city','metro','region','state','country')),
 country_code text CHECK(country_code ~ '^[A-Z]{2}$'),
 state_code text CHECK(state_code ~ '^[A-Z]{2}$'),
 city_key text,
 included_state_codes text[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(company_id,id),
 CHECK(kind NOT IN ('city','metro','state') OR (country_code IS NOT NULL AND state_code IS NOT NULL)),
 CHECK(kind<>'country' OR (country_code IS NOT NULL AND state_code IS NULL)),
 CHECK(kind<>'city' OR city_key IS NOT NULL),
 CHECK(cardinality(included_state_codes)=0 OR (kind='region' AND country_code IS NOT NULL AND state_code IS NULL))
);
CREATE INDEX provider_coverage_geography ON provider_coverage_areas(country_code,state_code,city_key);
CREATE TABLE provider_coverage_offerings (
 company_id uuid NOT NULL,area_id text NOT NULL,offering_id text NOT NULL,
 PRIMARY KEY(company_id,area_id,offering_id),
 FOREIGN KEY(company_id,area_id) REFERENCES provider_coverage_areas(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,offering_id) REFERENCES provider_offerings(company_id,id) ON DELETE CASCADE
);
CREATE TABLE provider_coverage_evidence (
 company_id uuid NOT NULL,area_id text NOT NULL,evidence_id text NOT NULL,
 PRIMARY KEY(company_id,area_id,evidence_id),
 FOREIGN KEY(company_id,area_id) REFERENCES provider_coverage_areas(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,evidence_id) REFERENCES provider_evidence(company_id,id) ON DELETE CASCADE
);

-- Website research cannot populate time-sensitive operational availability.
CREATE TABLE provider_service_availability (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'service' CHECK(kind='service'),
 category_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('accepting','limited','unavailable')),
 earliest_start date,
 crew_count integer CHECK(crew_count BETWEEN 1 AND 10000),
 confirmed_by uuid NOT NULL REFERENCES users(id),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz NOT NULL,
 PRIMARY KEY(company_id,category_id),
 FOREIGN KEY(kind,category_id) REFERENCES provider_taxonomy(kind,id),
 CHECK(valid_until>confirmed_at AND valid_until<=confirmed_at+interval '30 days')
);
CREATE INDEX provider_availability_expiry ON provider_service_availability(valid_until);

-- Append-only run records cover every company, including unresolved identities.
CREATE TABLE provider_research_runs (
 id text PRIMARY KEY,
 inventory_hash text NOT NULL CHECK(length(inventory_hash)=64),
 result_hash text NOT NULL CHECK(length(result_hash)=64),
 generated_at timestamptz NOT NULL,
 summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'),
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_research_results (
 run_id text NOT NULL REFERENCES provider_research_runs(id),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('ready_for_review','no_offerings_found','identity_review','robots_or_access_blocked','unreachable','no_website','excluded_demo')),
 identity_status text NOT NULL,
 checked_at timestamptz NOT NULL,
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),
 PRIMARY KEY(run_id,company_id)
);
CREATE INDEX provider_research_queue ON provider_research_results(status,company_id);

-- Profile edits and expired research disable matching without destroying evidence.
CREATE VIEW provider_current_offerings AS
 SELECT o.*,m.checked_at,m.valid_until FROM provider_offerings o
 JOIN provider_matching_profiles m ON m.company_id=o.company_id
 JOIN companies c ON c.id=o.company_id
 LEFT JOIN provider_profiles p ON p.company_id=c.id
 JOIN provider_capabilities e ON e.company_id=c.id
 WHERE m.state='reviewed' AND NOT c.is_demo AND m.valid_until>now()
 AND p.updated_at<=e.updated_at AND e.batch_id=m.source_batch_id
 AND m.profile_snapshot=jsonb_build_object('type',c.type,'website',c.website,'services',c.services,'serviceAreas',c.service_areas,
   'trades',COALESCE(p.trades,'{}'::text[]),'projectTypes',COALESCE(p.project_types,'{}'::text[]));
