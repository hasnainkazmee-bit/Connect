CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hiring_company_id uuid NOT NULL REFERENCES companies(id),
 author_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL CHECK ((status='draft' AND length(trim(title))<=160) OR length(trim(title)) BETWEEN 8 AND 160),
 description text NOT NULL CHECK ((status='draft' AND length(trim(description))<=10000) OR length(trim(description)) BETWEEN 20 AND 10000),
 trade text NOT NULL CHECK (trade IN ('installation','electrical','roofing','service','design','other')),
 location text NOT NULL CHECK ((status='draft' AND length(trim(location))<=160) OR length(trim(location)) BETWEEN 2 AND 160),
 postal_code text NOT NULL DEFAULT '',
 exact_address text NOT NULL DEFAULT '',
 start_window text NOT NULL DEFAULT '',
 budget_cents bigint CHECK (budget_cents IS NULL OR budget_cents >= 0),
 visibility text NOT NULL DEFAULT 'open' CHECK (visibility IN ('open','invite_only')),
 quote_deadline timestamptz,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','awarded','in_progress','review','completed','cancelled')),
 chosen_quote_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_open_created ON jobs(created_at DESC) WHERE status='open' AND visibility='open';
CREATE INDEX jobs_hiring_created ON jobs(hiring_company_id,created_at DESC);

CREATE TABLE job_invitations (
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 provider_company_id uuid NOT NULL REFERENCES companies(id),
 invited_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (job_id,provider_company_id)
);
CREATE INDEX job_invitations_provider ON job_invitations(provider_company_id,created_at DESC);

CREATE TABLE job_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 provider_company_id uuid NOT NULL REFERENCES companies(id),
 author_id uuid NOT NULL REFERENCES users(id),
 amount_cents bigint NOT NULL CHECK (amount_cents > 0),
 start_window text NOT NULL DEFAULT '',
 duration text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 included text NOT NULL DEFAULT '',
 excluded text NOT NULL DEFAULT '',
 payment_terms text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','withdrawn','chosen','not_chosen')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (job_id,provider_company_id),
 UNIQUE (job_id,id)
);
CREATE INDEX job_quotes_job_created ON job_quotes(job_id,created_at DESC);
CREATE INDEX job_quotes_provider_created ON job_quotes(provider_company_id,created_at DESC);
ALTER TABLE jobs ADD CONSTRAINT jobs_chosen_quote_same_job FOREIGN KEY (id,chosen_quote_id) REFERENCES job_quotes(job_id,id);

CREATE TABLE job_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id),
 author_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('progress','completion','changes_requested','system')),
 body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_updates_job_time ON job_updates(job_id,created_at DESC);

CREATE TABLE job_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 provider_company_id uuid NOT NULL REFERENCES companies(id),
 sender_company_id uuid NOT NULL REFERENCES companies(id),
 author_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_messages_thread_time ON job_messages(job_id,provider_company_id,created_at,id);

CREATE TABLE job_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 quote_id uuid REFERENCES job_quotes(id) ON DELETE CASCADE,
 update_id uuid REFERENCES job_updates(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id),
 uploaded_by uuid NOT NULL REFERENCES users(id),
 original_name text NOT NULL,
 storage_backend text NOT NULL,
 storage_key text NOT NULL UNIQUE,
 mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK (size_bytes > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (quote_id IS NULL OR update_id IS NULL)
);
CREATE INDEX job_files_job ON job_files(job_id,created_at);

CREATE TABLE job_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 reviewer_company_id uuid NOT NULL REFERENCES companies(id),
 reviewed_company_id uuid NOT NULL REFERENCES companies(id),
 rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
 text text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (job_id,reviewer_company_id),
 CHECK (reviewer_company_id <> reviewed_company_id)
);
CREATE INDEX job_reviews_reviewed ON job_reviews(reviewed_company_id,created_at DESC);

CREATE TABLE job_payment_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
 amount_cents bigint NOT NULL CHECK (amount_cents > 0),
 sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 20),
 status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','invoiced','reported_paid','confirmed_received')),
 invoice_reference text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (job_id,sort_order)
);
