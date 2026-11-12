-- Directory presentation only. This score does not establish job eligibility,
-- certifications, availability, or an endorsement of a company.
CREATE VIEW provider_directory_completeness AS
SELECT c.id AS company_id,
  (
    CASE
      WHEN c.description ~* '(its published company location|listed services include)' THEN 0
      WHEN length(trim(c.description)) >= 400 THEN 20
      WHEN length(trim(c.description)) >= 160 THEN 14
      WHEN length(trim(c.description)) >= 40 THEN 6 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM unnest(c.services) s WHERE length(trim(s)) > 2)
        THEN 10 ELSE 0 END
    + CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          COALESCE(e.research->'services','[]'::jsonb) || COALESCE(e.research->'products','[]'::jsonb)
        ) offering WHERE length(trim(offering->>'detail')) >= 80
      ) THEN 10 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM unnest(p.project_types) t WHERE length(trim(t)) > 2)
        THEN 12 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM unnest(c.service_areas) a WHERE length(trim(a)) > 2)
        OR jsonb_array_length(COALESCE(e.research->'coverage','[]'::jsonb)) > 0
        THEN 10 ELSE 0 END
    + CASE WHEN length(trim(c.location)) > 2
        AND lower(trim(c.location)) NOT IN ('united states','usa','us','unknown')
        THEN 6 ELSE 0 END
    + CASE WHEN c.website ~* '^https?://' THEN 4 ELSE 0 END
    + CASE WHEN length(trim(c.logo_url)) > 0 THEN 8 ELSE 0 END
    + CASE WHEN length(trim(c.cover_url)) > 0 AND c.cover_url <> '/assets/solar.jpg'
        THEN 4 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM company_credentials cr WHERE cr.company_id=c.id
        AND cr.category IN ('certification','qualification')
        AND (cr.valid_until IS NULL OR cr.valid_until >= CURRENT_DATE))
        THEN 8 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM projects pr WHERE pr.company_id=c.id
        AND length(trim(pr.name)) > 2 AND length(trim(pr.description)) > 20)
        THEN 8 ELSE 0 END
  )::integer AS score
FROM companies c
LEFT JOIN provider_profiles p ON p.company_id=c.id
LEFT JOIN provider_capabilities e ON e.company_id=c.id AND p.updated_at<=e.updated_at;
