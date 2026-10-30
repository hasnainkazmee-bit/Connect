ALTER TABLE connection_requests ADD COLUMN kind text NOT NULL DEFAULT 'connection'
  CHECK (kind IN ('connection', 'message'));
ALTER TABLE connection_requests ADD CONSTRAINT message_request_has_body
  CHECK (kind <> 'message' OR length(trim(note)) > 0);
ALTER TABLE messages ADD COLUMN source_request_id uuid UNIQUE REFERENCES connection_requests(id);
