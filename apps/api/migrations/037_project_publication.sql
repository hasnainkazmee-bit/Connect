ALTER TABLE job_quotes ADD COLUMN upload_pending boolean NOT NULL DEFAULT false;
ALTER TABLE job_quotes ADD COLUMN expected_files integer NOT NULL DEFAULT 0 CHECK(expected_files BETWEEN 0 AND 20);
CREATE TABLE job_quote_publications (
 quote_id uuid NOT NULL,
 version integer NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(quote_id,version),
 FOREIGN KEY(quote_id,version) REFERENCES job_quote_versions(quote_id,version) ON DELETE CASCADE
);
INSERT INTO job_quote_publications(quote_id,version,published_at) SELECT quote_id,version,created_at FROM job_quote_versions;
ALTER TABLE job_updates ADD COLUMN upload_pending boolean NOT NULL DEFAULT false;
ALTER TABLE job_updates ADD COLUMN published_at timestamptz DEFAULT now();
UPDATE job_updates SET published_at=created_at;
ALTER TABLE job_updates ADD COLUMN expected_files integer NOT NULL DEFAULT 0 CHECK(expected_files BETWEEN 0 AND 20);
ALTER TABLE job_updates ADD COLUMN provider_company_id uuid REFERENCES companies(id);
UPDATE job_updates u SET provider_company_id=COALESCE(
 (SELECT e.provider_company_id FROM job_conversation_events e WHERE e.update_id=u.id ORDER BY e.created_at LIMIT 1),
 (SELECT q.provider_company_id FROM jobs j JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=u.job_id)
);
CREATE INDEX job_updates_provider ON job_updates(job_id,provider_company_id,created_at);
ALTER TABLE job_files ADD COLUMN client_upload_id uuid;
ALTER TABLE job_files ADD COLUMN content_sha256 text;
CREATE UNIQUE INDEX job_files_upload_retry ON job_files(uploaded_by,client_upload_id) WHERE client_upload_id IS NOT NULL;
