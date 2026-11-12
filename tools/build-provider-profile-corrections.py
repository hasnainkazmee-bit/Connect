#!/usr/bin/env python3
"""Refresh public profiles from bounded first-party service evidence.

A source check is not an editorial matching review. Unknown territories, staffing,
third-party-system acceptance and delivery terms remain unknown. Category changes
require the separately reviewed, exact company self-description. Existing owned
profiles and the individually reviewed pilot are excluded.
"""
import collections
import copy
import datetime
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.research/provider-profile-review'
PAGES = ROOT / '.research/provider-matching/pages'
spec = importlib.util.spec_from_file_location('publication', ROOT / 'tools/build-provider-publication.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
BAD_PATH = re.compile(r'/(?:blogs?|news|articles?|careers?|jobs|privacy|terms|tags?|authors?|insights?|resources?|testimonials?|reviews?|portfolio|projects?|case-stud(?:y|ies)|(?:our-)?(?:member|partner)s?)(?:[-/]|$)|/\d{4}/', re.I)
BAD_TEXT = re.compile(r'\b(?:we (?:do not|don.t|no longer)|not (?:offer|provide|install)|coming soon|planned|previously|used to|testimonial|customer review|our partners|our members|they (?:offer|provide)|we (?:hired|chose|selected)|I (?:had|am|have)|would recommend|highly recommend)\b|[!?]', re.I)
# Exact service navigation labels; no fuzzy name or technology-only inference.
HEADINGS = {
 'solar-installation': r'(?:solar(?: panel| pv)?(?: installation| installers| systems| energy| power)?|photovoltaic systems)',
 'solar-design': r'(?:solar (?:design|engineering|design (?:and|&) engineering))',
 'battery-storage': r'(?:battery (?:storage|backup|installation)|(?:solar )?energy storage|solar batteries)',
 'solar-maintenance': r'(?:solar(?: panel| system)? (?:repairs?|maintenance|service|service (?:and|&) repair|repairs? (?:and|&) maintenance|operations (?:and|&) maintenance)|solar o&m)',
 'solar-detach-reset': r'(?:solar(?: panel)? (?:removal|removal (?:and|&) reinstallation|detach (?:and|&) reset)|detach (?:and|&) reset)',
 'electrical': r'(?:electrical(?: services| contracting| installation| construction| repair| upgrades)?|electrician services)',
 'ev-charging': r'(?:ev charg(?:ing|er)(?: installation|s| stations)?|electric vehicle charg(?:ing|er)(?: installation|s| stations)?)',
 'lighting': r'(?:(?:led|interior|exterior|landscape|parking lot|warehouse) lighting(?: installation| upgrades| retrofit| services)?|lighting (?:installation|upgrades|retrofits|services))',
 'backup-power': r'(?:(?:backup |standby |whole.home )?generator(?: installation|s)|backup power)',
 'roofing': r'(?:roofing(?: services)?|roof (?:installation|replacement|repairs?|replacement (?:and|&) repair))',
 'solar-thermal': r'(?:solar (?:thermal|pool heating|water heating))',
 'solar-cleaning': r'(?:solar panel cleaning)',
 'solar-development': r'(?:solar(?: project)? development)',
 'electrical-design': r'(?:electrical (?:design|engineering)|design (?:and|&) build)',
}
# Only parse facets within an accepted service assertion/heading, not arbitrary site text.
FACETS = {
 'solar-installation': [
  ('rooftop systems',r'\broof(?:top|.mount)'),('ground-mounted systems',r'\bground.mount'),
  ('solar carports',r'\bcarports?\b'),('off-grid systems',r'\boff.grid\b'),('grid-connected systems',r'\bgrid.(?:tied|connected)\b')],
 'solar-design': [('site assessment',r'\bsite (?:assessment|evaluation|survey)'),('system sizing',r'\b(?:system sizing|sized|sizing)'),('permit plans',r'\b(?:permit.ready|permit plans|plan sets)')],
 'electrical': [('panel upgrades',r'\b(?:panel|service panel) upgrades?'),('rewiring',r'\b(?:rewir\w*|wiring replacement)'),('new-construction wiring',r'\bnew construction\b'),('surge protection',r'\bsurge protection\b'),('medium-voltage systems',r'\bmedium.voltage\b'),('power distribution',r'\b(?:power distribution|distribution equipment)'),('home automation',r'\bhome automation\b')],
 'battery-storage': [('whole-home backup',r'\bwhole.home'),('critical-load backup',r'\bcritical.load'),('standalone storage',r'\bstand.?alone'),('solar integration',r'\b(?:solar.plus.storage|paired with solar|solar and battery|solar.with.battery)')],
 'ev-charging': [('Level 2 chargers',r'\blevel.?2\b'),('DC fast charging',r'\b(?:dc fast|level.?3)\b')],
 'roofing': [('roof repairs',r'\broof(?:ing)? repair'),('roof replacement',r'\broof(?:ing)? replacement'),('metal roofs',r'\bmetal roof'),('shingle roofs',r'\b(?:shingle|asphalt)\b'),('flat roofs',r'\bflat roof')],
 'solar-maintenance': [('inverter repairs',r'\binverter.{0,25}(?:repair|replacement|service)'),('system troubleshooting',r'\b(?:troubleshoot|diagnos)\w*'),('performance monitoring',r'\bmonitor\w*'),('panel repairs',r'\bpanel.{0,20}repair')],
 'lighting': [('LED upgrades',r'\bled\b'),('interior lighting',r'\binterior\b'),('exterior lighting',r'\bexterior\b'),('parking-lot lighting',r'\bparking.lot\b'),('warehouse lighting',r'\bwarehouse\b')],
 'backup-power': [('standby generators',r'\bstandby\b'),('transfer switches',r'\btransfer switch'),('whole-home generators',r'\bwhole.home\b')],
}
SECTORS = {**base.SECTORS, 'agricultural': r'\b(?:agricultur\w*|farms?|farming)\b'}
SECTOR_NOUNS = {'residential':'homes','commercial':'businesses','industrial':'industrial facilities','agricultural':'farms','municipal':'public facilities','nonprofit':'nonprofits','utility':'utility-scale projects'}
TRADES = {'solar-installation':'Installation','solar-design':'Design','electrical':'Electrical','ev-charging':'Electrical','lighting':'Electrical','backup-power':'Electrical','battery-storage':'Installation','roofing':'Roofing','solar-maintenance':'Service','solar-detach-reset':'Service','solar-cleaning':'Service','inspection':'Inspection','permitting':'Permitting','equipment-supply':'Equipment','equipment-procurement':'Equipment','logistics':'Logistics','racking-design':'Design','racking-installation':'Installation','solar-development':'Development','energy-consulting':'Consulting','project-management':'Project management','hvac':'Heating & cooling'}


def unique(xs):
 return list(dict.fromkeys(xs))
def join(xs):
 return xs[0] if len(xs)==1 else ', '.join(xs[:-1])+' and '+xs[-1] if xs else ''
def safe_page(page, website):
 return base.domain(page.get('url',''))==base.domain(website) and not BAD_PATH.search(urlsplit(page['url']).path) and page['url'].startswith('https://')
def heading_category(label):
 label=re.sub(r'\s+',' ',label).strip().strip(' →›»').lower()
 if len(label)>85 or BAD_TEXT.search(label):return None
 # Prefixes only: a sector becomes evidence for this particular service.
 body=re.sub(r'^(?:(?:residential|commercial|industrial|agricultural|municipal|utility.scale|residential (?:and|&) commercial)\s+)+','',label)
 for category,pattern in HEADINGS.items():
  if re.fullmatch(pattern,body,re.I):return 'electrical' if category=='electrical-design' else category
 return None

def page_claims(page, name):
 # Existing explicit offering statements are kept. Short first-party service
 # navigation labels add scope; article titles and member sites are excluded.
 claims=[]
 for category in base.SERVICES:
  heading=base.explicit_heading(page,category,name)
  if heading and category not in ('battery-storage','backup-power','solar-thermal','solar-maintenance'):
   claims.append((category,heading))
 for sentence in base.sentences(page.get('text','')):
  if BAD_TEXT.search(sentence):continue
  for category in base.SERVICES:
   if base.explicit_service(sentence,category,name):claims.append((category,sentence))
 lines=page.get('text','').splitlines()
 for i,line in enumerate(lines[:-1]):
  category=heading_category(line)
  if not category:continue
  body=lines[i+1].strip()
  # A service heading plus its own descriptive paragraph is stronger than a
  # technology mention elsewhere on a page. Require a present delivery action.
  if not 35<=len(body)<=650 or BAD_TEXT.search(body):continue
  if not re.search(r'\b(?:install\w*|repair\w*|design\w*|upgrad\w*|maintain\w*|replac\w*|rewir\w*|provid\w*|offer\w*)\b',body,re.I):continue
  claims.append((category,line.strip()+': '+body))
 for link in page.get('links',[]):
  label=link.get('label','');url=link.get('url','')
  category=heading_category(label)
  if category and safe_page({'url':url},page['url']) and urlsplit(url).path not in ('','/'):
   # A product-only page does not establish installation/field services.
   if re.search(r'/(?:products?|shop|store|equipment)(?:/|$)',urlsplit(url).path,re.I):continue
   claims.append((category,label))
 return unique(claims)

def detailed(service, claims):
 texts=[t for _,t in claims]
 facets=unique(label for label,pattern in FACETS.get(service['category'],[]) if any(re.search(pattern,t,re.I) for t in texts))[:5]
 sectors=unique(service.get('sectors',[])+[s for s,pat in SECTORS.items() if any(re.search(pat,t,re.I) for t in texts)])
 service['sectors']=sectors
 service['systems']=unique(service.get('systems',[])+[s for s,pat in base.SYSTEMS.items() if any(re.search(pat,t,re.I) for t in texts)])
 # Specific features and sectors are composed from referenced claims only.
 desc=base.SERVICES.get(service['category'],(None,service['detail']))[1].rstrip('.')
 if sectors:
  desc += ' for '+join([SECTOR_NOUNS[s] for s in sectors])
 if facets:desc += ', including '+join(facets)
 service['detail']=desc+'.'
 return service

def projects_for(services, products):
 result={}
 for s in services:
  for sector in s['sectors']:
   suffix='solar' if s['category'].startswith('solar-') else 'electrical' if s['category'] in ('electrical','lighting') else 'roofing' if s['category']=='roofing' else 'energy projects'
   label=sector.capitalize()+' '+suffix
   result[label]=unique(result.get(label,[])+s['sourceIds'])
  if s['category'].startswith('solar-'):
   for system in s['systems']:
    label={'rooftop':'Rooftop solar','ground mount':'Ground-mounted solar','carport':'Solar carports','floating':'Floating solar'}.get(system)
    if label:result[label]=unique(result.get(label,[])+s['sourceIds'])
 return [{'label':k,'sourceIds':v} for k,v in list(result.items())[:12]]

def build_record(company, original, receipts, classification=None, custom=None):
 if company['managed'] or company['listing_status']!='unclaimed':return None,'company_managed'
 pages=[]
 for receipt in receipts.get('pages',[]):
  if receipt.get('status')!='ok' or not receipt.get('cacheKey'):continue
  file=PAGES/(receipt['cacheKey']+'.json')
  if not file.exists():continue
  page=json.loads(file.read_text())
  if page.get('contentHash')==receipt.get('contentHash') and safe_page(page,company['website']):pages.append(page)
 if not pages or not any(p.get('identityMatched') for p in pages):return None,'identity_review'
 r=copy.deepcopy(original)
 r.pop('preserveProfile',None)
 r['preserveServiceAreas']=True
 r['expectedProfile']=copy.deepcopy(company['profile'])
 r['profile']=copy.deepcopy(company['profile'])
 research=r['research'];research['reviewMethod']='source-check-v2'
 research['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 research['confirmationNeeded']=['Offering-specific territory and delivery terms require confirmation.','Availability and staffing require company confirmation.']
 research['reviewNotes']=['Public profile source check; not a job-matching scope review.','Existing service areas retained without expanding researched coverage.']
 # Each claim references the page where the statement or service link occurs.
 sources={p['url']:{'id':'source-'+str(i+1),'title':p['title'].split('\n')[0][:150] or company['name'],'url':p['url'],'evidence':'Company identity and service catalogue on the matched official website.','basis':'company-website'} for i,p in enumerate(pages)}
 claims=collections.defaultdict(list)
 for p in pages:
  for category,text in page_claims(p,company['name']):claims[category].append((p['url'],text))
 # "Residential solar" on a supplier's navigation is not proof of an
 # installation service. Generic solar headings require a delivery statement
 # or the previously checked installation offering.
 if not any(s['category']=='solar-installation' for s in research['services']):
  claims['solar-installation']=[(u,t) for u,t in claims.get('solar-installation',[]) if re.search(r'\binstall\w*\b',t,re.I)]
  if not claims['solar-installation']:del claims['solar-installation']
 previous_evidence=ROOT/'.research/provider-publication/evidence'/(company['id']+'.json')
 previous=json.loads(previous_evidence.read_text()) if previous_evidence.exists() else {}
 for category,e in previous.get('services',{}).items():
  if e['url'] in sources and not BAD_TEXT.search(e['evidence']):claims[category].append((e['url'],e['evidence']))
 if not claims and not research['products'] and not custom:return None,'no_own_offering_evidence'
 services=[]
 for category,items in claims.items():
  if category not in base.SERVICES:continue
  title,detail,_=base.SERVICES[category]
  old=next((s for s in research['services'] if s['category']==category),{})
  service={'id':category,'category':category,'title':title,'detail':detail,'sectors':[], 'delivery':'unknown','systems':[], 'thirdPartySystems':'unknown','sourceIds':unique(sources[u]['id'] for u,_ in items)}
  detailed(service,items)
  services.append(service)
  for u,t in items:
   source=sources[u]
   if source['evidence'].startswith('Company identity'):source['evidence']=t[:650]
 research['services']=services[:20]
 products=[]
 for p in research['products']:
  oldsources=[s['url'] for s in research['sources'] if s['id'] in p['sourceIds']]
  p['sourceIds']=unique(sources[u]['id'] for u in oldsources if u in sources)
  if p['sourceIds']:products.append(p)
 research['products']=products
 research['sources']=list(sources.values())
 identity=next(p for p in pages if p.get('identityMatched'))
 research['identitySourceIds']=[sources[identity['url']]['id']]
 research['summarySourceIds']=unique(s for o in [*services,*products] for s in o['sourceIds'])[:12] or research['identitySourceIds']
 research['projectTypes']=projects_for(services,products)
 research['baseLocation']=None
 research['coverage']=[]
 if classification:
  url=classification['sourceUrl'];evidence=classification['evidence']
  page=next((p for p in pages if p['url']==url),None)
  if not page or evidence not in re.sub(r'\s+',' ',page['text']):
   # Preserve exact matching for normalized line spacing, never relax identity.
   if not page or re.sub(r'\s+',' ',evidence) not in re.sub(r'\s+',' ',page['text']):raise ValueError('Classification source changed: '+company['name'])
  sid=sources[url]['id'];sources[url]['evidence']=evidence[:650]
  research['businessType']={'value':classification['type'],'sourceIds':[sid]}
  r['expectedProfile']['type']=company['type'];r['profile']['type']=classification['type']
 all_titles=[o['title'] for o in [*services,*products]]
 if not all_titles and not custom:return None,'no_own_offering_evidence'
 labels=[s.replace('EV','electric vehicle') for s in all_titles[:4]]
 kind={'Contractor':'a contractor','EPC':'an EPC','Developer':'a project developer','Manufacturer':'a manufacturer','Distributor':'a distributor','Service provider':'a service provider'}.get(classification['type']) if classification else None
 intro=company['name']+(' is '+kind+' offering ' if kind else ' provides ')+join([s.lower() for s in labels])+'.'
 specifics=[]
 for s in services:
  if s['sectors'] or s['systems'] or ', including ' in s['detail']:
   specifics.append(s['detail'])
 # A concise factual profile is better than unsupported filler. No fabricated
 # staff counts, licence status, capacity, history, guarantees or location claims.
 r['profile']['description']=intro+ ('\n\n'+' '.join(specifics[:4]) if specifics else '')
 existing=company['profile']['description']
 if len(existing)>250 and not re.search(r'operates in|its published company location|listed services include',existing,re.I):
  r['profile']['description']=existing
 r['profile']['tagline']=join(all_titles[:3])[:200]
 r['profile']['services']=unique(all_titles)[:20]
 r['profile']['trades']=unique(TRADES.get(s['category'],'Service') for s in services)[:12]
 if products:r['profile']['trades']=unique([*r['profile']['trades'],'Equipment'])[:12]
 r['profile']['projectTypes']=[p['label'] for p in research['projectTypes']]
 if custom:
  # Editorial copy can add more detailed sourced offerings without implying
  # researched matching coverage. External URLs still fail schema validation.
  research.update(copy.deepcopy(custom['research']))
  for field in ['description','tagline','services','trades','projectTypes']:
   if field in custom:r['profile'][field]=custom[field]
  r['profile']['services']=[s['title'] for s in research['services']]+[p['title'] for p in research['products']]
  r['profile']['projectTypes']=[p['label'] for p in research['projectTypes']]
  if research.get('businessType'):
   r['expectedProfile']['type']=company['type'];r['profile']['type']=research['businessType']['value']
 return r,'ready'

def main():
 inventory=json.loads((STATE/'inventory.json').read_text())
 companies={c['id']:c for c in inventory['companies']}
 receipts={r['companyId']:r for r in map(json.loads,filter(None,(ROOT/'.research/provider-matching/research.jsonl').read_text().split('\n')))}
 if (STATE/'research.jsonl').exists():
  receipts.update({r['companyId']:r for r in map(json.loads,filter(None,(STATE/'research.jsonl').read_text().split('\n')))})
 originals={r['companyId']:r for f in sorted((ROOT/'.research/provider-publication/batches').glob('*.json')) for r in json.loads(f.read_text())['records']}
 categories={r['companyId']:r for r in json.loads((ROOT/'data/provider-enrichment/profile-category-review-2026-11-12.json').read_text())['records']}
 customfile=ROOT/'data/provider-enrichment/profile-detail-review-2026-11-12.json'
 custom={r['companyId']:r for r in json.loads(customfile.read_text())['records']} if customfile.exists() else {}
 ready=[];outcomes=[]
 for cid,original in originals.items():
  company=companies[cid]
  record,status=build_record(company,original,receipts[cid],categories.get(cid),custom.get(cid))
  outcomes.append({'companyId':cid,'company':company['name'],'status':status})
  if record:ready.append(record)
 out=STATE/'batches';out.mkdir(exist_ok=True)
 for stale in out.glob('*.json'):stale.unlink()
 for i in range(0,len(ready),25):
  batchid='provider-profile-details-2026-11-12-'+str(i//25+1).zfill(3)
  (out/('provider-source-publication-v2-'+str(i//25+1).zfill(3)+'.json')).write_text(json.dumps({'version':1,'batchId':batchid,'inventoryOrigin':'https://connect.sunhubapp.com','cohort':'Sourced profile overviews, services, project types and category corrections','records':ready[i:i+25]},indent=2)+'\n')
 summary={'companies':len(ready),'statuses':dict(collections.Counter(o['status'] for o in outcomes)),'services':sum(len(r['research']['services']) for r in ready),'products':sum(len(r['research']['products']) for r in ready),'withProjectTypes':sum(bool(r['profile']['projectTypes']) for r in ready),'withDetailedOverview':sum(len(r['profile']['description'])>=400 for r in ready),'categoryChanges':sum(r['profile'].get('type')!=r['expectedProfile'].get('type') for r in ready),'customReviewed':sum(r['companyId'] in custom for r in ready)}
 (STATE/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 (STATE/'outcomes.json').write_text(json.dumps(outcomes,indent=2)+'\n')
 print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
