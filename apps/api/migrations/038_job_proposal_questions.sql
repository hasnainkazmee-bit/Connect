ALTER TABLE jobs ADD COLUMN proposal_questions jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(proposal_questions)='array' AND jsonb_array_length(proposal_questions)<=10);
ALTER TABLE jobs ADD COLUMN questions_version integer NOT NULL DEFAULT 1 CHECK(questions_version>0);
ALTER TABLE job_quotes ADD COLUMN proposal_answers jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(proposal_answers)='array' AND jsonb_array_length(proposal_answers)<=10);
ALTER TABLE job_quotes ADD COLUMN questions_version integer NOT NULL DEFAULT 1 CHECK(questions_version>0);
