#!/usr/bin/env python3
"""Publish only explicit first-party offering statements; never infer job eligibility.

Processes every inventory entry. No candidate status is treated as approval.
Additive batches preserve existing profile fields and remain outside matching.
"""
import argparse, collections, hashlib, json, re, unicodedata
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.research/provider-publication'
PAGES = ROOT / '.research/provider-matching/pages'
RULE_VERSION = 'source-check-v1'
# Category, public title, neutral paraphrase. Scope comes from the same statement.
SERVICES = {
 'solar-installation': ('Solar installation', 'Installation of solar photovoltaic systems.', r'(?:install(?:s|ing|ation)?\s+(?:\w+\s+){0,3}(?:solar|photovoltaic)|solar\s+(?:panel\s+|system\s+)?install(?:er|ation|s|ing)?)'),
 'solar-design': ('Solar design', 'Design services for solar projects.', r'(?:design(?:s|ing)?\s+(?:\w+\s+){0,3}(?:solar|photovoltaic)|solar\s+(?:system\s+)?(?:design|engineering))'),
 'battery-storage': ('Battery storage', 'Services for battery energy storage systems.', r'(?:battery\s+(?:storage|backup|installation)|energy\s+storage\s+(?:systems?|installation))'),
 'solar-maintenance': ('Solar repairs & maintenance', 'Service, repair and maintenance of solar systems.', r'(?:solar\s+(?:panel\s+|system\s+)?(?:repair|maintenance|service)|(?:repair|maintain|servic)(?:s|ing|e)?\s+(?:\w+\s+){0,3}solar)'),
 'solar-detach-reset': ('Solar removal & reinstallation', 'Removal and reinstallation of existing solar panels.', r'(?:solar\s+(?:panel\s+)?(?:removal|detach)|(?:detach\s*(?:&|and)\s*reset)|remov(?:e|al)\s+(?:\w+\s+){0,3}solar)'),
 'electrical': ('Electrical services', 'Electrical installation and service work.', r'electrical\s+(?:services?|contract(?:or|ing)|installation|work|repair|upgrades?)'),
 'ev-charging': ('EV charging', 'Installation of electric vehicle charging equipment.', r'(?:ev\s+charg(?:ing|er)|electric\s+vehicle\s+charg(?:ing|er))'),
 'lighting': ('Lighting', 'Lighting installation, upgrades and service work.', r'lighting\s+(?:installation|maintenance|services?|upgrades?|retrofits?)'),
 'backup-power': ('Backup power', 'Backup power system services.', r'(?:(?:backup|standby|whole.home)\s+generator|generator\s+installation|backup\s+power)'),
 'solar-thermal': ('Solar thermal', 'Solar thermal and solar water heating systems.', r'(?:solar\s+(?:thermal|water\s+heating|pool\s+heating))'),
 'wind-power': ('Wind energy', 'Wind energy system services.', r'wind\s+(?:energy|turbine)\s+(?:installation|maintenance|service|development)'),
 'project-management': ('Project management', 'Management and coordination of project delivery.', r'(?:project|construction)\s+management'),
 'solar-development': ('Solar project development', 'Development of solar energy projects.', r'(?:solar\s+(?:project\s+)?develop(?:ment|er)|develop(?:s|ing)?\s+(?:\w+\s+){0,3}solar\s+projects?)'),
 'energy-consulting': ('Energy consulting', 'Energy advisory and consulting services.', r'(?:energy|solar)\s+(?:consult(?:ing|ation)|advisory)'),
 'energy-procurement': ('Energy procurement', 'Energy procurement services.', r'energy\s+procurement'),
 'equipment-procurement': ('Equipment procurement', 'Sourcing and procurement of project equipment.', r'(?:equipment|material)\s+(?:sourcing|procurement)'),
 'equipment-supply': ('Equipment supply', 'Supply of solar equipment and components.', r'(?:solar\s+(?:equipment|components?)\s+(?:supply|distribution)|(?:suppl(?:y|ies)|distribut(?:e|es))\s+(?:\w+\s+){0,3}solar\s+(?:equipment|components?))'),
 'logistics': ('Equipment logistics', 'Logistics and delivery services for equipment.', r'(?:logistics\s+(?:services?|solutions?)|freight\s+(?:services?|coordination))'),
 'racking-design': ('Racking design', 'Design and engineering of solar mounting systems.', r'(?:racking|mounting)\s+(?:design|engineering)'),
 'racking-installation': ('Racking installation', 'Installation of solar mounting and racking systems.', r'(?:racking|mounting)\s+installation'),
 'roofing': ('Roofing', 'Roof installation, replacement and repair services.', r'(?:roof(?:ing)?\s+(?:services?|installation|replacement|repair)|roofing\s+contract(?:or|ing))'),
 'permitting': ('Permitting support', 'Permit preparation and coordination for projects.', r'(?:permitting\s+(?:services?|support)|permit\s+(?:preparation|coordination))'),
 'inspection': ('System inspections', 'Inspection services for solar or electrical systems.', r'(?:solar|electrical|pv)\s+(?:system\s+)?inspection'),
 'commissioning': ('Commissioning', 'System testing and commissioning services.', r'(?:commissioning\s+(?:services?|support)|testing\s+and\s+commissioning)'),
 'solar-cleaning': ('Solar panel cleaning', 'Cleaning of solar panels and arrays.', r'solar\s+(?:panel\s+)?cleaning'),
 'crew-supply': ('Installation crews', 'Installation crews supplied for contracted work.', r'(?:provide|supply)\s+(?:\w+\s+){0,3}(?:solar\s+|installation\s+)crews'),
 'trenching': ('Trenching', 'Trenching services for project infrastructure.', r'trenching\s+(?:services?|work)'),
 'interconnection': ('Interconnection support', 'Utility interconnection coordination for solar projects.', r'(?:interconnection\s+(?:support|services?|coordination)|utility\s+interconnection)'),
}
PRODUCTS = {
 'solar-modules': ('Solar modules', r'(?:solar\s+(?:modules?|panels?)|photovoltaic\s+modules?)'),
 'inverters': ('Inverters', r'(?:solar\s+inverter|microinverter|string\s+inverter|hybrid\s+inverter)s?'),
 'battery-storage': ('Battery storage systems', r'(?:battery\s+(?:storage|backup)|energy\s+storage\s+systems?)'),
 'racking-mounting': ('Racking & mounting', r'(?:solar\s+(?:racking|mounting)|racking\s+systems?|mounting\s+systems?)'),
 'foundations': ('Foundations', r'(?:helical\s+(?:piles?|foundations?)|ground\s+screws?|driven\s+piles?)'),
 'electrical-bos': ('Electrical components', r'(?:balance\s+of\s+system|combiner\s+boxes|solar\s+cables?|pv\s+wire)'),
 'backup-generators': ('Backup generators', r'(?:backup|standby)\s+generators?'),
 'ev-chargers': ('EV chargers', r'(?:ev\s+chargers?|electric\s+vehicle\s+chargers?)'),
 'solar-system': ('Solar system kits', r'(?:solar\s+kits?|off.grid\s+kits?|complete\s+solar\s+systems?)'),
}
BAD = re.compile(r'\b(?:testimonial|webinar|podcast|blog|news|article|learn about|learn how|read more|we do not|we don.t|no longer|not offer|coming soon|coming to|planned to|would like to|looking for|careers?|job opening|hiring|copyright|privacy policy|cookie|lorem ipsum|was founded by|has installed|have installed|had installed|previously installed|was installed|were installed)\b|[!?]|^\s*(?:I|My|We\s+(?:hired|chose|selected|had|decided))\b', re.I)
BAD_PATH = re.compile(r'/(?:blog|news|articles?|careers?|jobs|privacy|terms|tag|author|insights?|resources?|testimonials?|portfolio|projects?)(?:/|$)|/\d{4}/|(?:vs-|how-to-|why-|benefits-of-|guide-to-|tax-credit)', re.I)
SECTORS = {'residential':r'\b(?:residential|homes|homeowners?)\b','commercial':r'\bcommercial\b','industrial':r'\bindustrial\b','agricultural':r'\b(?:agricultur\w*|dairy|farmers|farming)\b','municipal':r'\b(?:municipal|government|public facilities)\b','nonprofit':r'\bnon.?profit\b','utility':r'\butility.scale\b'}
SYSTEMS = {'rooftop':r'\brooftop\b','ground mount':r'\bground.mount','carport':r'\bcarport','floating':r'\bfloating\s+solar'}

def domain(url):
 return urlsplit(url).hostname.lower().removeprefix('www.') if urlsplit(url).hostname else ''
def name_key(value):
 return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower())
def actor_pattern(name):
 words=re.sub(r'\b(?:llc|inc\.?|ltd\.?|corp\.?)\b','',name,flags=re.I).strip(' .,')
 return r'(?:\bwe\b|\bour\s+(?:company|team|services?|expertise)\b|^\s*'+re.escape(words)+')'
def sentences(text):
 for line in text.splitlines():
  line=re.sub(r'\s+',' ',line).strip()
  if 25<=len(line)<=1500 and not BAD.search(line):
   for sentence in re.split(r'(?<=[.;])\s+(?=[A-Z])',line):
    if 25<=len(sentence)<=650 and not BAD.search(sentence):yield sentence

def explicit_service(sentence, category, name):
 pattern=SERVICES[category][2]
 subject=actor_pattern(name)
 # Require an actor making a present-tense offering, not merely mentioning a technology.
 offering=re.search(subject+r'\s+(?:(?:speciali[sz]e|focus)\s+in|offers?|provides?|delivers?|performs?|handles?|installs?|designs?|maintains?|suppl(?:y|ies)|helps?|is\s+(?:a|an|the)|are\s+(?:a|an|the)|include|range\s+from|covers?)\b',sentence,re.I)
 if not offering:return False
 tail=sentence[offering.start():]
 match=re.search(pattern,tail,re.I)
 if not match or match.start()>260:return False
 # Exclude tools, consulting about installation, or someone else's expertise.
 if re.search(r'\b(?:tools?|fasteners?|connectors?|labels?|software|training|courses?|customers?|partners?)\b.{0,65}'+pattern,tail,re.I):return False
 if category in ['solar-installation','electrical','roofing'] and re.search(r'\b(?:consult(?:ing|ants?)|recruit(?:ing|ment)|staffing|training|software|tools?|fasteners?)\b',tail,re.I):return False
 if category=='solar-design' and re.search(r'(?:relied on by|partner(?:s|ing)? with|work with).{0,60}(?:engineering|design)',tail,re.I):return False
 if category=='ev-charging' and not re.search(r'\b(?:install|installation|installing|installed|charging\s+services)\b',tail,re.I):return False
 if category in ['battery-storage','backup-power','solar-thermal'] and not re.search(r'\b(?:install(?:s|ation|ing)?|design(?:s|ing)?|build|integrate|maintain|repair)\b',tail,re.I):return False
 if category=='solar-maintenance' and not re.search(r'\b(?:repair|maintain|maintenance|servicing)\w*\b',tail,re.I):return False
 return True

def explicit_heading(page, category, name):
 title=page.get('title','')
 if BAD.search(title) or re.search(r'\b(?:how|why|cost|benefits|tools?|fasteners?|software|training|courses?|careers?|jobs?|news|guide|best|top|tips)\b',title,re.I):return None
 if name_key(name) not in name_key(title) or len(name_key(name))<6:return None
 if not re.search(SERVICES[category][2],title,re.I):return None
 path=urlsplit(page['url']).path
 if path not in ('','/') and not re.search(r'/(?:services?|residential|commercial|industrial|solar|electrical|roofing|installation)',path,re.I):return None
 # A business's self-description in its official page title is a narrow scope claim.
 return title[:320]

def explicit_product(sentence, category, name):
 subject=actor_pattern(name)
 product=PRODUCTS[category][1]
 for role,verb in [('manufactures',r'manufacture|manufactures|produce|produces'),('distributes',r'distribute|distributes|supply|supplies|sell|sells|stock|stocks'),('supplies-and-installs',r'(?:supply|supplies|provide|provides)\s+and\s+install(?:s)?')]:
  m=re.search(subject+r'\s+(?:design\s+and\s+)?(?:'+verb+r')\b',sentence,re.I)
  if not m:continue
  tail=sentence[m.end():]
  match=re.search(product,tail,re.I)
  if not match or match.start()>180:continue
  if re.search(r'\b(?:connectors?|tools?|fasteners?|labels?|software|training)\b',tail,re.I):continue
  if category=='solar-modules' and re.search(r'solar\s+panels?\s+(?:cleaning|removal|repair|recycling)',tail,re.I):continue
  return role
 for role,label in [('manufactures','manufacturer'),('distributes','distributor')]:
  m=re.search(subject+r'\s+(?:are|is)\s+(?:\w+\s+){0,5}'+label+r'(?:s)?\s+of\s+',sentence,re.I)
  if m and re.search(product,sentence[m.end():m.end()+180],re.I):return role
 return None

def inspect(company, row):
 if company['is_demo']:return None,'excluded_demo'
 if company['managed'] or company['listing_status']!='unclaimed':return None,'company_managed'
 if company['researched_at']:return None,'already_published'
 if not row:return None,'no_research'
 if row['status'] not in ['ready_for_review','no_offerings_found']:return None,row['status']
 if domain(row['website'])!=domain(company['website']) or row['companyName']!=company['name']:return None,'identity_changed'
 if not company['website'].startswith('https://'):return None,'https_review'
 pages=[]
 for receipt in row['pages']:
  if receipt['status']!='ok' or not receipt.get('cacheKey'):continue
  path=PAGES/(receipt['cacheKey']+'.json')
  if not path.exists():continue
  page=json.loads(path.read_text())
  if page.get('contentHash')!=receipt.get('contentHash') or domain(page['url'])!=domain(company['website']) or not page['url'].startswith('https://'):continue
  if BAD_PATH.search(urlsplit(page['url']).path):continue
  pages.append(page)
 identity=next((p for p in pages if p.get('identityMatched')),None)
 if not identity:return None,'identity_review'
 found={};products={};selected={}
 for page in pages:
  for category,(title,detail,_) in SERVICES.items():
   heading=explicit_heading(page,category,company['name'])
   if heading and category not in found and category not in ('battery-storage','backup-power','solar-thermal','solar-maintenance'):
    found[category]={'title':title,'detail':detail,'evidence':heading,'url':page['url'],'sectors':[k for k,v in SECTORS.items() if re.search(v,heading,re.I)],'systems':[k for k,v in SYSTEMS.items() if re.search(v,heading,re.I)]}
    selected[page['url']]=page
  for sentence in sentences(page['text']):
   for category,(title,detail,_) in SERVICES.items():
    if category not in found and explicit_service(sentence,category,company['name']):
     found[category]={'title':title,'detail':detail,'evidence':sentence,'url':page['url'],'sectors':[k for k,v in SECTORS.items() if re.search(v,sentence,re.I)],'systems':[k for k,v in SYSTEMS.items() if re.search(v,sentence,re.I)]}
     selected[page['url']]=page
   for category,(title,_) in PRODUCTS.items():
    role=explicit_product(sentence,category,company['name'])
    if role and category not in products:
     products[category]={'title':title,'role':role,'evidence':sentence,'url':page['url']}
     selected[page['url']]=page
 if not found and not products:return None,'no_explicit_offering'
 selected[identity['url']]=identity
 urls=list(selected)
 ids={u:'source-'+str(i+1) for i,u in enumerate(urls)}
 services=[{'id':category,'category':category,'title':v['title'],'detail':v['detail'],'sectors':v['sectors'],'delivery':'unknown','systems':v['systems'],'thirdPartySystems':'unknown','sourceIds':[ids[v['url']]]} for category,v in found.items()][:20]
 offers=[{'id':category,'category':category,'title':v['title'],'detail':{'manufactures':'Manufactures','distributes':'Supplies','supplies-and-installs':'Supplies and installs'}[v['role']]+' '+v['title'].lower()+'.','role':v['role'],'brands':[],'sourceIds':[ids[v['url']]]} for category,v in products.items()][:20]
 sources=[]
 for url,page in selected.items():
  evidence=next((v['evidence'] for v in [*found.values(),*products.values()] if v['url']==url),'The company name appears on its existing official website.')
  sources.append({'id':ids[url],'url':url,'title':(page['title'].splitlines()[0] if page['title'].splitlines() else company['name']+' — Company website')[:150],'evidence':evidence[:650],'basis':'company-website'})
 research={'checkedAt':row['checkedAt'],'reviewMethod':RULE_VERSION,'identityNote':'Current company UUID and official website match the source inventory. Company name is present on that domain.','identitySourceIds':[ids[identity['url']]],'summarySourceIds':[ids[identity['url']]],'baseLocation':None,'services':services,'products':offers,'coverage':[],'sources':sources,'availability':'unknown','earliestStart':None,'crewCapacity':None,'stockAvailability':'unknown','laborOnly':'unknown','subcontracting':'unknown','confirmationNeeded':['Offering-specific territory and delivery terms require confirmation.','Availability and staffing require company confirmation.'],'reviewNotes':['Automatic source check: explicit present-tense first-party offering statements only.','Additive public facts; excluded from job matching until editorial scope review.']}
 profile=company['profile']
 (STATE/'evidence').mkdir(exist_ok=True)
 (STATE/'evidence'/(company['id']+'.json')).write_text(json.dumps({'services':found,'products':products},indent=2)+'\n')
 return {'companyId':company['id'],'companyName':company['name'],'website':company['website'],'preserveProfile':True,'expectedProfile':profile,'profile':profile,'research':research},'ready'

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',default=str(STATE/'batches'));args=parser.parse_args()
 inventory=json.loads((STATE/'inventory.json').read_text())
 records={r['companyId']:r for r in map(json.loads,filter(None,(ROOT/'.research/provider-matching/research.jsonl').read_text().split('\n')))}
 ready=[];outcomes=[]
 for index,company in enumerate(inventory['companies']):
  if index and index%500==0:print(f'Checked {index} companies',flush=True)
  record,status=inspect(company,records.get(company['id']))
  if record:ready.append(record)
  outcomes.append({'companyId':company['id'],'name':company['name'],'status':status,'services':len(record['research']['services']) if record else 0,'products':len(record['research']['products']) if record else 0})
 out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
 for prior in out.glob('provider-source-publication-2026-11-12-*.json'):prior.unlink()
 for i in range(0,len(ready),25):
  batch={'version':1,'batchId':f'provider-source-publication-2026-11-12-{i//25+1:03d}','inventoryOrigin':'https://connect.sunhubapp.com','cohort':'Additive first-party service and product statements across existing unclaimed profiles. Source-checked; not eligible for automatic matching.','records':ready[i:i+25]}
  (out/(batch['batchId']+'.json')).write_text(json.dumps(batch,indent=2,ensure_ascii=False)+'\n')
 summary={'ruleVersion':RULE_VERSION,'inventory':len(outcomes),'realCompanies':sum(not c['is_demo'] for c in inventory['companies']),'statuses':dict(collections.Counter(o['status'] for o in outcomes)),'services':sum(o['services'] for o in outcomes),'products':sum(o['products'] for o in outcomes),'batches':(len(ready)+24)//25,'matchingEligible':False,'inventorySha256':hashlib.sha256((STATE/'inventory.json').read_bytes()).hexdigest()}
 (STATE/'outcomes.json').write_text(json.dumps(outcomes,indent=2)+'\n')
 (STATE/'publication-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
