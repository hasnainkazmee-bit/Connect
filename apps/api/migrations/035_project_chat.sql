ALTER TABLE job_messages DROP CONSTRAINT job_messages_body_check;
ALTER TABLE job_messages ADD CONSTRAINT job_messages_body_check CHECK (length(trim(body)) <= 5000);
ALTER TABLE job_messages ADD COLUMN reply_to uuid REFERENCES job_messages(id) ON DELETE SET NULL;
ALTER TABLE job_messages ADD COLUMN pinned_at timestamptz;
ALTER TABLE job_messages ADD COLUMN pinned_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE job_messages ADD CONSTRAINT job_messages_thread_identity UNIQUE (id,job_id,provider_company_id);

ALTER TABLE job_files ADD COLUMN message_id uuid;
ALTER TABLE job_files ADD COLUMN provider_company_id uuid REFERENCES companies(id);
ALTER TABLE job_files ADD COLUMN message_draft_id uuid;
ALTER TABLE job_files ADD CONSTRAINT job_files_message_thread FOREIGN KEY(message_id,job_id,provider_company_id)
  REFERENCES job_messages(id,job_id,provider_company_id) ON DELETE CASCADE;
ALTER TABLE job_files ADD CONSTRAINT job_files_chat_destination CHECK (
  (provider_company_id IS NULL AND message_id IS NULL AND message_draft_id IS NULL) OR
  (provider_company_id IS NOT NULL AND message_draft_id IS NOT NULL AND quote_id IS NULL AND update_id IS NULL)
);
CREATE INDEX job_files_message ON job_files(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX job_files_thread ON job_files(job_id,provider_company_id,created_at) WHERE message_id IS NOT NULL;
CREATE INDEX job_files_drafts ON job_files(uploaded_by,message_draft_id) WHERE message_id IS NULL AND message_draft_id IS NOT NULL;

CREATE TABLE job_message_reactions (
  message_id uuid NOT NULL REFERENCES job_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id,emoji)
);
