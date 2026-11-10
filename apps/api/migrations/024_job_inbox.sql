ALTER TABLE job_messages ADD COLUMN client_id uuid;
CREATE UNIQUE INDEX job_messages_client_send
  ON job_messages(author_id, sender_company_id, client_id)
  WHERE client_id IS NOT NULL;

-- Reading is personal, even when several employees share a company inbox.
CREATE TABLE job_message_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL,
  last_read_message_id uuid NOT NULL,
  PRIMARY KEY (user_id, company_id, job_id, provider_company_id)
);
