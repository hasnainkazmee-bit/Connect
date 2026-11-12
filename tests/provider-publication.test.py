import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('publication',Path(__file__).resolve().parent.parent/'tools/build-provider-publication.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class PublicationRules(unittest.TestCase):
 def test_explicit_current_offering(self):
  self.assertTrue(p.explicit_service('We design and install solar systems for residential and commercial customers.','solar-installation','Example Solar'))
  self.assertTrue(p.explicit_service('Our team provides electrical installation services for commercial customers.','electrical','Example Solar'))
  self.assertEqual(p.explicit_product('We manufacture solar modules for commercial customers.','solar-modules','Example Solar'),'manufactures')
 def test_mentions_and_third_party_work_not_offerings(self):
  examples=[('We supply fasteners for your solar installation needs.','solar-installation'),('Our team provides tools for solar installation projects.','solar-installation'),('We provide solar installation training for contractors.','solar-installation'),('We offer software for solar installation companies.','solar-installation'),('I recently had Lee install solar panels on my house.','solar-installation'),('Lee has been relied on by major solar engineering firms to construct their projects.','solar-design')]
  for text,cat in examples:self.assertFalse(p.explicit_service(text,cat,'Lee'),text)
  self.assertIsNone(p.explicit_product('We supply solar panel connectors and tools.','solar-modules','Example Solar'))
 def test_news_negation_and_history_are_omitted(self):
  for text in ['We do not offer solar installation.','We participated in a webinar on battery storage.','We have installed solar panels at the school.','Our team offers solar installation services coming soon.']:
   self.assertEqual(list(p.sentences(text)),[])
 def test_solar_farm_not_agriculture(self):
  self.assertIsNone(__import__('re').search(p.SECTORS['agricultural'],'We install solar farms.'))
if __name__=='__main__':unittest.main()
