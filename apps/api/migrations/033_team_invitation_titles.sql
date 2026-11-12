-- Job titles describe the employee's work; access roles remain separate.
ALTER TABLE team_invites
  ADD COLUMN job_title text NOT NULL DEFAULT '' CHECK (length(job_title) <= 120);
