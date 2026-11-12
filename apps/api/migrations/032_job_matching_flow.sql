ALTER TABLE jobs ADD COLUMN matching_preferences jsonb;
ALTER TABLE jobs ADD CONSTRAINT job_matching_preferences_object
 CHECK(matching_preferences IS NULL OR jsonb_typeof(matching_preferences)='object');

ALTER TABLE provider_profiles ADD COLUMN work_settings_confirmed_at timestamptz;

-- A sourced candidate is not automatically a confirmed match. The matcher still
-- checks each offering's own coverage, sector and delivery method. Keep the
-- stricter reviewed-only view for consumers that explicitly require that tier.
CREATE VIEW provider_current_candidates AS
 SELECT o.*,m.checked_at,m.valid_until,m.state AS match_state
 FROM provider_offerings o
 JOIN provider_matching_profiles m ON m.company_id=o.company_id
 JOIN companies c ON c.id=o.company_id
 LEFT JOIN provider_profiles p ON p.company_id=c.id
 JOIN provider_capabilities e ON e.company_id=c.id
 WHERE m.state IN ('reviewed','source_checked') AND NOT c.is_demo
 AND m.valid_until>now() AND p.updated_at<=e.updated_at
 AND e.batch_id=m.source_batch_id
 AND m.profile_snapshot=jsonb_build_object('type',c.type,'website',c.website,'services',c.services,'serviceAreas',c.service_areas,
   'trades',COALESCE(p.trades,'{}'::text[]),'projectTypes',COALESCE(p.project_types,'{}'::text[]));
