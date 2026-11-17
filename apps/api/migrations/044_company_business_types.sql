-- Name-only compatibility clients have not supplied a business classification.
-- Preserve existing company data; never assume that a new company installs solar.
ALTER TABLE companies ALTER COLUMN type SET DEFAULT '';
