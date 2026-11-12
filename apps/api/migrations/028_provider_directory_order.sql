-- Editorial directory positions are separate from provider/job-match eligibility.
CREATE TABLE provider_directory_pins (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  position integer NOT NULL UNIQUE CHECK (position > 0)
);

-- Pin the existing company identities, never a similarly named imported listing.
INSERT INTO provider_directory_pins(company_id,position)
SELECT c.id,p.position
FROM (VALUES
  ('a79660d7-9787-4ba1-b75f-fab0eb6891eb'::uuid,1),
  ('46cb6d28-d43f-44f6-9f9c-81aaecfa3094'::uuid,2)
) AS p(company_id,position)
JOIN companies c ON c.id=p.company_id
WHERE NOT c.is_demo;
