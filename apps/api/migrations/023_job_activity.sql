-- Keep update requests and reported problems in the private job history.
ALTER TABLE job_updates DROP CONSTRAINT job_updates_kind_check;
ALTER TABLE job_updates ADD CONSTRAINT job_updates_kind_check
  CHECK (kind IN ('progress','completion','changes_requested','system','update_requested','problem'));
