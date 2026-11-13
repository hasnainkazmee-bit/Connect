CREATE TABLE job_checklist_submissions (
 id uuid PRIMARY KEY REFERENCES job_updates(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 item_id uuid NOT NULL,
 item_revision integer NOT NULL CHECK(item_revision>0),
 company_id uuid NOT NULL REFERENCES companies(id),
 client_id uuid NOT NULL,
 note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','changes_requested','cancelled')),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 reviewed_by uuid REFERENCES users(id),
 UNIQUE(job_id,item_id,company_id,client_id)
);
CREATE INDEX job_checklist_submissions_item ON job_checklist_submissions(job_id,item_id,submitted_at);
-- Earlier checklist drafts have no proof approval; retain their scope, not an
-- unsupported claim that a task has been approved.
UPDATE jobs SET work_checklist=(SELECT COALESCE(jsonb_agg(item || jsonb_build_object('status','todo','revision',1,'completed',false,'completedAt',NULL,'completedByCompanyId',NULL) ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(work_checklist) WITH ORDINALITY entries(item,ord))
 WHERE jsonb_array_length(work_checklist)>0;
