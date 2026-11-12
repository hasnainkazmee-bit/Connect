import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('corrections',pathlib.Path(__file__).resolve().parents[1]/'tools/build-provider-profile-corrections.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Boundaries(unittest.TestCase):
 def test_headings_only_publish_offered_work(self):
  self.assertEqual(m.heading_category('Residential Solar'),'solar-installation')
  self.assertEqual(m.heading_category('Commercial Electrical Services'),'electrical')
  for s in ['Solar Panel Installation Cost','Why Solar Is Better','Do we install solar?','Best Solar Contractors','Electric Company','We do not install solar','Solar Equipment']:
   self.assertIsNone(m.heading_category(s),s)
 def test_partners_blogs_and_product_pages_do_not_establish_installer_scope(self):
  self.assertFalse(m.safe_page({'url':'https://example.com/our-member-owners/'},'https://example.com'))
  self.assertFalse(m.safe_page({'url':'https://other.example/services/'},'https://example.com'))
  p={'url':'https://example.com/','text':'','links':[{'url':'https://example.com/blog/solar','label':'Residential Solar'},{'url':'https://example.com/products/solar','label':'Solar Installation'},{'url':'https://example.com/services/electrical','label':'Electrical Services'}]}
  self.assertEqual(m.page_claims(p,'Example'),[('electrical','Electrical Services')])
 def test_no_project_type_from_company_name_or_unrelated_text(self):
  s={'category':'electrical','sectors':[],'sourceIds':['source-1'],'systems':[]}
  self.assertEqual(m.projects_for([s],[]),[])
  s['sectors']=['commercial'];self.assertEqual(m.projects_for([s],[]),[{'label':'Commercial electrical','sourceIds':['source-1']}])
if __name__=='__main__':unittest.main()
