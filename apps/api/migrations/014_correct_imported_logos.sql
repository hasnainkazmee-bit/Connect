-- The imported image was a customer logo shown on the official website,
-- not the company's own header artwork. The replacement was extracted from
-- https://www.15lightyears.com/ on 2026-11-04.
UPDATE companies
SET logo_url = '/assets/companies/15-lightyears.png'
WHERE username = 'company-15-lightyears'
  AND listing_status = 'unclaimed'
  AND source_url = 'https://www.15lightyears.com/';

-- The initial image for 1stle was a client logo from its portfolio grid.
-- The company's own header logo was downloaded from https://1stle.com/.
UPDATE companies
SET logo_url = '/assets/companies/1stle.png'
WHERE username = 'company-1stle'
  AND listing_status = 'unclaimed'
  AND source_url = 'https://1stle.com/';

-- Failed external images should render as an empty white logo area, and should
-- sort with the no-logo listings until the company supplies a usable image.
UPDATE companies
SET logo_url = ''
WHERE listing_status = 'unclaimed'
  AND source_checked_at::date = '2026-11-03'
  AND logo_url ~* '^https?://';
