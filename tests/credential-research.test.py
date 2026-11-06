import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('batch',ROOT/'tools/build-credential-batch.py')
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)

def finding(text, topic='Tesla installer', channel='text', url='https://example.test/about/'):
    return {'context':text,'topic':topic,'channel':channel,'sourceUrl':url}

class CredentialResearchTests(unittest.TestCase):
    def test_directory_name_match_alone_is_not_sufficient(self):
        parser=batch.research.Page();parser.feed('<h1>Example Solar</h1><p>(212) 555-0199</p>')
        company={'name':'Example Solar','website':'https://official.example.test/'}
        self.assertIsNone(batch.research.directory_identity(company,parser,'(212) 555-0199',False,['Other company phone 415-555-0142']))
        self.assertEqual(batch.research.directory_identity(company,parser,'(212) 555-0199',False,['Call us: 212.555.0199']),'exact_company_heading_and_official_website_phone')
        self.assertEqual(batch.research.directory_identity(company,parser,'(212) 555-0199',True,[]),'exact_company_heading_and_first_party_link')

    def test_legal_name_variants_still_require_independent_identity_evidence(self):
        parser=batch.research.Page();parser.feed('<h1>The Example Solar LLC</h1>')
        company={'name':'Example Solar','website':'https://official.example.test/'}
        self.assertIsNone(batch.research.directory_identity(company,parser,'Call 212-555-0199',False,[]))
        self.assertEqual(batch.research.directory_identity(company,parser,'Call 212-555-0199',False,['Phone (212) 555-0199']),'exact_company_heading_and_official_website_phone')

    def test_unicode_line_separators_inside_page_text_do_not_lose_company_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'crawl.jsonl'
            row={'companyId':'one','context':'First\u2028second\u2029third'}
            path.write_text(json.dumps(row,ensure_ascii=False)+'\n')
            self.assertEqual(batch.research.read_crawl_log(path),[row])

    def test_employer_claim_is_personnel_not_company_accreditation(self):
        result=batch.classify_claim(finding('Our team includes NABCEP-certified installers.','NABCEP'))
        self.assertIsNotNone(result)
        self.assertEqual(result[3],'personnel')

    def test_alignment_and_training_are_not_certification(self):
        for text in ['Our engineering follows NABCEP aligned standards.','Our team is working towards NABCEP certification.','NABCEP tracked installers']:
            self.assertIsNone(batch.classify_claim(finding(text,'NABCEP')))

    def test_cooperative_bcorp_does_not_certify_its_members(self):
        self.assertIsNone(batch.classify_claim(finding('Our cooperative is a Certified B Corp.','B Corp')))

    def test_educational_and_negative_claims_abstain(self):
        for text in ['How to become a Tesla Certified Installer','We are not certified Tesla installers','We were formerly a Tesla Certified Installer','Our Tesla Certified Installer application is pending']:
            self.assertIsNone(batch.classify_claim(finding(text)))

    def test_blog_badge_does_not_establish_business_credential(self):
        self.assertIsNone(batch.classify_claim(finding('Tesla Certified Installer',channel='image_alt',url='https://example.test/blog/choosing-an-installer')))

    def test_explicit_badge_can_only_propose_company_reported_program(self):
        result=batch.classify_claim(finding('Tesla Powerwall Certified Installer',channel='image_alt'))
        self.assertEqual(result[0],'tesla-powerwall-installer')
        self.assertIn('Company-reported',result[4])

    def test_ev_authorization_is_not_promoted_to_powerwall(self):
        result=batch.classify_claim(finding('We are a certified Tesla EV charger installer.'))
        self.assertEqual(result[0],'tesla-ev-charger-installer')
        self.assertIn('EV charging',result[1])
        self.assertNotIn('Powerwall',result[1])

    def test_generic_product_standards_require_model_review(self):
        self.assertIsNone(batch.classify_claim(finding('We sell UL 61730 modules.','UL / IEC')))

    def test_roofing_designations_retain_the_actual_program_organization(self):
        result=batch.classify_claim(finding('GAF Master Elite Roofing Contractor','Roofing certification','image_alt'))
        self.assertEqual(result[2],'GAF')

    def test_html_parser_excludes_script_and_style_text(self):
        parser=batch.research.Page()
        parser.feed('<h1>Example Solar</h1><script>Fake Tesla Certified Installer</script><p>Our team</p><img alt="NABCEP certified"><a href="/about">About us</a>')
        self.assertEqual(parser.headings,['Example Solar'])
        self.assertNotIn('Fake',''.join(parser.text))
        self.assertEqual(parser.links,[['/about','About us']])

    def test_private_networks_and_authenticated_urls_are_rejected(self):
        with patch.object(batch.research.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):batch.research.public_url('https://example.test/')
        for url in ['file:///etc/passwd','https://user:password@example.test/','http://example.test:8080/']:
            with self.assertRaises(ValueError):batch.research.public_url(url)

if __name__=='__main__':unittest.main()
