-- Public website offerings are distinct from a reviewed match for a job.
-- The existing provider_current_offerings view still accepts only 'reviewed'.
ALTER TABLE provider_matching_profiles DROP CONSTRAINT provider_matching_profiles_state_check;
ALTER TABLE provider_matching_profiles ADD CONSTRAINT provider_matching_profiles_state_check
  CHECK(state IN ('unresearched','reviewed','source_checked','excluded_demo'));
ALTER TABLE provider_offerings DROP CONSTRAINT provider_offerings_delivery_check;
ALTER TABLE provider_offerings ADD CONSTRAINT provider_offerings_delivery_check
  CHECK(delivery IN ('unknown','turnkey','specialist-service','advisory','managed-project','contract-staff','labor-only','supply'));
