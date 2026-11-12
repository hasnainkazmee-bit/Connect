INSERT INTO provider_taxonomy(kind,id,label)
VALUES('service','hvac','Heating, cooling and heat pumps'),
      ('service','technical-training','Technical training'),
      ('service','provider-referrals','Service provider referrals')
ON CONFLICT(kind,id) DO NOTHING;
