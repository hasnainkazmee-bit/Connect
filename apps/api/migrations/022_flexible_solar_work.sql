-- A brief can request people, a specialist, supplies, or project support.
ALTER TABLE jobs DROP CONSTRAINT jobs_trade_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_trade_check CHECK (trade IN (
  'crew','installation','electrical','roofing','service','design',
  'permitting','inspection','equipment','logistics','other'
));
ALTER TABLE jobs
  ADD COLUMN people_needed integer CHECK (people_needed BETWEEN 1 AND 1000),
  ADD COLUMN expected_duration text NOT NULL DEFAULT '' CHECK (length(expected_duration) <= 120),
  ADD COLUMN work_arrangement text NOT NULL DEFAULT 'onsite' CHECK (work_arrangement IN ('onsite','remote','hybrid'));
