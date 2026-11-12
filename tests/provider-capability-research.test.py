import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('research',Path(__file__).resolve().parents[1]/'tools/research-provider-capabilities.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ResearchTests(unittest.TestCase):
 def test_menus_forms_and_testimonials_are_not_service_evidence(self):
  html='''<title>Example Solar</title><nav>We provide solar installation and battery storage systems</nav>
   <form><p>Our solar installation covers all states</p><select><option>Ohio</option></select></form>
   <blockquote>They completed our solar installation</blockquote><div class="testimonial"><p>Great battery storage installation</p></div>
   <main><p>We provide commercial electrical contracting for business premises.</p></main>'''
  r=m.extract(html,'https://example.test/services','Example Solar')
  self.assertTrue(r['identityMatched']);self.assertEqual([c['categoryId'] for c in r['candidates']],['electrical'])
 def test_supply_mentions_stay_unreviewed_and_do_not_create_installation_territory(self):
  r=m.extract('<title>Example Solar</title><p>We distribute solar modules and ship to all US states.</p>', 'https://example.test/products','Example Solar')
  self.assertTrue(r['candidates']);self.assertTrue(all(c['reviewStatus']=='unreviewed' for c in r['candidates']))
  self.assertFalse(any(c['categoryId']=='solar-installation' for c in r['candidates']))
  self.assertTrue(r['coverageCandidates'])
 def test_blogs_negated_services_and_parked_domains_do_not_become_confirmed_facts(self):
  r=m.extract('<title>Example Solar</title><p>We no longer provide solar installation for homes.</p>', 'https://example.test/services','Example Solar')
  self.assertEqual(r['candidates'],[])
  r=m.extract('<title>Example Solar</title><p>We offer residential solar installation for local homeowners.</p>', 'https://example.test/blog/installations','Example Solar')
  self.assertEqual(r['candidates'],[])
  r=m.extract('<title>Example Solar</title><p>This domain is for sale</p>','https://example.test','Example Solar')
  self.assertFalse(r['identityMatched'])
if __name__=='__main__':unittest.main()
