-- Quote terms are append-only. Decisions refer to the version the user reviewed.
ALTER TABLE job_quotes ADD COLUMN current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0);
ALTER TABLE job_quotes ADD COLUMN accepted_version integer;
ALTER TABLE job_quotes ADD COLUMN decision_note text NOT NULL DEFAULT '';
ALTER TABLE job_quotes DROP CONSTRAINT job_quotes_status_check;
ALTER TABLE job_quotes ADD CONSTRAINT job_quotes_status_check CHECK (status IN ('submitted','withdrawn','chosen','not_chosen','changes_requested','declined','award_declined'));
CREATE TABLE job_quote_versions (
 quote_id uuid NOT NULL REFERENCES job_quotes(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version > 0),
 terms jsonb NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id),
 revision_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(quote_id,version)
);
INSERT INTO job_quote_versions(quote_id,version,terms,author_id,created_at)
 SELECT id,1,jsonb_build_object('amount_cents',amount_cents,'start_window',start_window,'duration',duration,'note',note,'included',included,'excluded',excluded,'payment_terms',payment_terms,'price_breakdown',price_breakdown,'legacy_import',true),author_id,now() FROM job_quotes;
UPDATE job_quotes SET accepted_version=1 WHERE status='chosen';
ALTER TABLE job_quotes ADD CONSTRAINT job_quotes_accepted_version FOREIGN KEY(id,accepted_version) REFERENCES job_quote_versions(quote_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION connect_immutable_quote_terms() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Quote versions cannot be changed'; END $$;
CREATE TRIGGER job_quote_versions_immutable BEFORE UPDATE ON job_quote_versions FOR EACH ROW EXECUTE FUNCTION connect_immutable_quote_terms();

ALTER TABLE job_files ADD COLUMN quote_version integer;
UPDATE job_files SET quote_version=1 WHERE quote_id IS NOT NULL;
ALTER TABLE job_files ADD CONSTRAINT job_files_quote_version_fk FOREIGN KEY(quote_id,quote_version) REFERENCES job_quote_versions(quote_id,version) ON DELETE CASCADE;
CREATE TABLE job_quote_version_files (
 quote_id uuid NOT NULL,
 version integer NOT NULL,
 file_id uuid NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
 PRIMARY KEY(quote_id,version,file_id),
 FOREIGN KEY(quote_id,version) REFERENCES job_quote_versions(quote_id,version) ON DELETE CASCADE
);
INSERT INTO job_quote_version_files SELECT quote_id,quote_version,id FROM job_files WHERE quote_id IS NOT NULL;

CREATE TABLE job_conversation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 provider_company_id uuid NOT NULL REFERENCES companies(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 company_id uuid NOT NULL REFERENCES companies(id),
 kind text NOT NULL,
 body text NOT NULL DEFAULT '',
 quote_id uuid REFERENCES job_quotes(id) ON DELETE CASCADE,
 quote_version integer,
 update_id uuid REFERENCES job_updates(id) ON DELETE CASCADE,
 change_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(quote_id,quote_version) REFERENCES job_quote_versions(quote_id,version) ON DELETE CASCADE
);
CREATE INDEX job_conversation_events_thread ON job_conversation_events(job_id,provider_company_id,created_at,id);
-- Existing quotes had no version history. Preserve their current terms without
-- inventing an earlier submission or decision timestamp.
INSERT INTO job_conversation_events(job_id,provider_company_id,actor_id,company_id,kind,quote_id,quote_version)
 SELECT job_id,provider_company_id,author_id,provider_company_id,'quote_recorded',id,1 FROM job_quotes;
INSERT INTO job_conversation_events(job_id,provider_company_id,actor_id,company_id,kind,body,update_id,created_at)
 SELECT u.job_id,q.provider_company_id,u.author_id,u.company_id,
 CASE u.kind WHEN 'completion' THEN 'work_submitted' WHEN 'changes_requested' THEN 'work_changes_requested' ELSE u.kind END,
 u.body,u.id,u.created_at FROM job_updates u JOIN jobs j ON j.id=u.job_id JOIN job_quotes q ON q.id=j.chosen_quote_id;


CREATE TABLE job_agreements (
 job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 quote_id uuid NOT NULL REFERENCES job_quotes(id),
 quote_version integer NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 start_window text NOT NULL DEFAULT '',
 duration text NOT NULL DEFAULT '',
 scope text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(quote_id,quote_version) REFERENCES job_quote_versions(quote_id,version)
);
INSERT INTO job_agreements(job_id,quote_id,quote_version,amount_cents,start_window,duration,scope)
 SELECT j.id,q.id,q.current_version,q.amount_cents,q.start_window,q.duration,COALESCE(NULLIF(q.included,''),q.note) FROM jobs j JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.status IN ('awarded','in_progress','review','completed');
CREATE TABLE job_scope_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 proposed_by uuid NOT NULL REFERENCES users(id),
 company_id uuid NOT NULL REFERENCES companies(id),
 agreement_revision integer NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
 scope text NOT NULL CHECK(length(trim(scope)) BETWEEN 10 AND 5000),
 amount_delta_cents bigint NOT NULL DEFAULT 0,
 start_window text NOT NULL DEFAULT '',
 duration text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 decision_note text NOT NULL DEFAULT '',
 decided_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz
);
CREATE UNIQUE INDEX job_scope_changes_one_pending ON job_scope_changes(job_id) WHERE status='pending';
ALTER TABLE job_conversation_events ADD CONSTRAINT job_conversation_event_change FOREIGN KEY(change_id) REFERENCES job_scope_changes(id) ON DELETE CASCADE;
