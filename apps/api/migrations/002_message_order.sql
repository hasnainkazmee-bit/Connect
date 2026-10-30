-- Use an exact sequence for pagination and read receipts; JavaScript dates
-- truncate PostgreSQL microseconds and cannot safely identify a message boundary.
CREATE SEQUENCE message_sequence;
ALTER TABLE messages ADD COLUMN sequence bigint;
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at,id) AS seq FROM messages
)
UPDATE messages SET sequence=ordered.seq FROM ordered WHERE messages.id=ordered.id;
SELECT setval('message_sequence',COALESCE((SELECT max(sequence) FROM messages),0)+1,false);
ALTER TABLE messages ALTER COLUMN sequence SET DEFAULT nextval('message_sequence');
ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL;
ALTER SEQUENCE message_sequence OWNED BY messages.sequence;
ALTER TABLE messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE UNIQUE INDEX messages_sequence ON messages(sequence);
CREATE INDEX messages_conversation_sequence ON messages(connection_id,sequence DESC);
ALTER TABLE conversation_reads ADD COLUMN read_sequence bigint NOT NULL DEFAULT 0;
UPDATE conversation_reads r SET read_sequence=COALESCE((
  SELECT max(m.sequence) FROM messages m WHERE m.connection_id=r.connection_id AND m.created_at<=r.read_at
),0);
