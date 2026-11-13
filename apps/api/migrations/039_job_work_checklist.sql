ALTER TABLE jobs ADD COLUMN work_checklist jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(work_checklist)='array' AND jsonb_array_length(work_checklist)<=30);
ALTER TABLE jobs ADD COLUMN checklist_version integer NOT NULL DEFAULT 1 CHECK(checklist_version>0);
