-- Barnhart Pump Co is a water well pump service, including solar-powered water
-- pumps. It is not a photovoltaic installer. Verified against its official
-- services and contact pages on 2026-11-04.
UPDATE companies
SET type = 'Service provider',
    tagline = 'Water well pumps, including solar-powered systems',
    description = 'Barnhart Pump Co designs, installs and repairs water well pump systems and provides water treatment in Colorado. Its solar work is solar-powered water pumps for off-grid homes, farms and remote sites.',
    services = ARRAY['Solar water pumps','Water well pump installation','Well pump repair','Water treatment'],
    location = 'Peyton, CO',
    service_areas = ARRAY['Peyton','Colorado Springs','Pikes Peak region']
WHERE username = 'barnhart-pump-co'
  AND listing_status = 'unclaimed'
  AND source_url = 'https://www.barnhartpump.com/'
  AND type = 'Installer';
