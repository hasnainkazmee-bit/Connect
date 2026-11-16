-- A company's shortlist and unfinished proposal are private workspace records.
-- They do not create a quote, a conversation, or a notification to the hirer.
CREATE TABLE job_saved (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 saved_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,job_id)
);
CREATE INDEX job_saved_recent ON job_saved(company_id,created_at DESC,job_id);

-- Versions never restart when a draft is discarded and recreated.
CREATE SEQUENCE job_proposal_draft_version_seq AS integer;
CREATE TABLE job_proposal_drafts (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=100000),
 version integer NOT NULL DEFAULT nextval('job_proposal_draft_version_seq') CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,job_id)
);
ALTER SEQUENCE job_proposal_draft_version_seq OWNED BY job_proposal_drafts.version;
CREATE INDEX job_proposal_drafts_recent ON job_proposal_drafts(company_id,updated_at DESC,job_id);

-- Ties publication to the saved draft it replaces. A later draft must survive.
ALTER TABLE job_quote_versions ADD COLUMN proposal_draft_version integer
 CHECK(proposal_draft_version IS NULL OR proposal_draft_version>0);
