#!/usr/bin/env python3
"""Build an auditable import batch from reviewed issuer matches and explicit first-party claims.

Generic mentions, product standards, rankings, training and third-party credentials abstain.
The output labels every automated first-party claim company-reported, never issuer-confirmed.
"""
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('credential_research',ROOT/'tools/research-credentials.py')
research=importlib.util.module_from_spec(spec);spec.loader.exec_module(research)
STATE=research.STATE
OUTPUT=ROOT/'data/company-credentials/reviewed.json'

NEGATIVE=re.compile(r'\b(?:not\s+(?:yet\s+)?certified|not\s+accredited|no\s+longer|expired|formerly|previously|pending|applied\s+for|become|became|becoming|how\s+to|looking\s+for|look\s+for|find\s+a|choose\s+a|choose\s+an|why\s+hire|must\s+be|should\s+be|need\s+to\s+be|will\s+be|working\s+toward|working\s+towards|in\s+training|training\s+program|certification\s+requirements|our\s+partner|cooperative|aligned|tracking|tracked)\b',re.I)
EDITORIAL=re.compile(r'/(?:blog|blogs|news|newsroom|resources|articles|guides|faq|faqs|careers|jobs|testimonials|reviews|training|education|courses|classes|products|shop)(?:/|$)',re.I)

def classify_claim(finding):
    """High-precision designation recognition; returns None when context is ambiguous."""
    text=finding['context']
    if EDITORIAL.search(finding['sourceUrl']) or NEGATIVE.search(text): return None
    topic=finding['topic']
    if topic=='NABCEP':
        if re.search(r'\b(?:exam|course|training|what\s+is|what\s+does|eligible|eligibility)\b',text,re.I):return None
        if re.search(r'NABCEP[\s\w-]{0,45}(?:PV\s*Installation\s*Professional|PVIP|PV\s*Design\s*Specialist|PVDS|certified\s+(?:installers|employees|professionals|technicians))|NABCEP[\s-]*certified[\s\n]{0,5}(?:employees|installers|professionals|technicians)|NABCEP[\s-]*(?:PVIP|PVDS)[\s\w-]{0,15}certified',text,re.I):
            return ('nabcep-personnel','NABCEP-qualified personnel','NABCEP','personnel',"Personnel qualification reported on the company's website. This is separate from NABCEP company accreditation; individual holders and expiry dates require confirmation.")
        return None
    patterns={
      'Tesla installer':('tesla-installer','Tesla',r'Tesla\s+(?:(?:Energy|Powerwall|Solar\s*Roof|EV\s*charger|Supercharger)\s+)?(?:certified|premier|preferred)\s+(?:(?:Powerwall|Solar\s*Roof|EV\s*charger|Supercharger)\s+)?installer|certified\s+Tesla\s+(?:(?:Energy|Powerwall|Solar\s*Roof|EV\s*charger|Supercharger)\s+)?installer'),
      'Enphase installer':('enphase-installer','Enphase',r'Enphase\s+(?:certified|platinum|gold|silver)\s+(?:solar\s+)?installer|certified\s+Enphase\s+installer'),
      'SolarEdge installer':('solaredge-installer','SolarEdge',r'SolarEdge\s+(?:certified|preferred|elite)\s+installer|certified\s+SolarEdge\s+installer'),
      'REC installer':('rec-installer','REC Group',r'REC\s+certified\s+solar\s+professional'),
      'Roofing certification':('roofing-program','Roofing manufacturer program',r'GAF\s+(?:Master\s*Elite|Certified(?:\s*Plus)?)|CertainTeed\s+(?:SELECT\s+)?(?:ShingleMaster|SolarMaster|Master\s*Installer)|Owens\s*Corning\s+(?:Platinum|Preferred)\s+(?:Contractor|Installer)'),
    }
    if topic not in patterns: return None
    key,organization,pattern=patterns[topic]
    match=re.search(pattern,text,re.I)
    if not match: return None
    # Explicit badge alt text or a standalone designation / direct self-description.
    before=text[max(0,match.start()-90):match.start()]
    after=text[match.end():match.end()+90]
    standalone=bool(re.search(r'(?:^|\n)\s*$',before) and re.match(r'\s*(?:\n|[®™.,]|$)',after))
    self_description=bool(re.search(r'\b(?:we\s+are|we.re|as\s+a|our\s+team|our\s+company|we\s+are\s+a|we\s+are\s+an|we.re\s+a|we.re\s+an|is\s+a|is\s+an|we\s+are\s+proud\s+to\s+be\s+a)\b',before,re.I))
    if finding.get('channel')!='image_alt' and not (standalone or self_description): return None
    title=re.sub(r'\s+',' ',match.group(0)).strip()
    if topic=='Tesla installer':
        if re.search(r'supercharger',text,re.I): key='tesla-supercharger-installer'
        elif re.search(r'EV\s*charg|wall\s*connector',text,re.I) and not re.search(r'Powerwall|Solar\s*Roof',text,re.I):
            key='tesla-ev-charger-installer'; title+=' — EV charging'
        elif re.search(r'Powerwall',title,re.I): key='tesla-powerwall-installer'
        elif re.search(r'Solar\s*Roof',title,re.I): key='tesla-solar-roof-installer'
    if topic=='Roofing certification':
        key='roofing-'+re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
        organization='GAF' if title.lower().startswith('gaf') else 'CertainTeed' if title.lower().startswith('certainteed') else 'Owens Corning'
    if not title.lower().endswith(('installer','professional','contractor','shinglemaster','solarmaster')) and topic=='Roofing certification':
        title+=' contractor designation'
    detail=f"Company-reported {title} designation. Product and service coverage is limited to the linked source; confirm current program status with the program operator."
    return (key,title,organization,'company',detail)

def record(company,key,title,organization,scope,description,source,basis,checked,method,note,category='qualification',scope_detail=None,period=''):
    return dict(companyId=company['id'],companyName=company['name'],website=company['website'],key=key,category=category,title=title,organization=organization,scope=scope,scopeDetail=scope_detail or (f"{company['name']}: personnel credentials reported on its official website." if scope=='personnel' else f"{company['name']}: installation services described by the company."),description=description,sourceUrl=source,evidenceBasis=basis,period=period,validUntil=None,checkedAt=checked,reviewMethod=method,evidenceNote=note)

def build():
    snapshot=json.loads((STATE/'inventory.json').read_text())
    companies={c['id']:c for c in snapshot['companies']}
    results={}
    if (STATE/'crawl.jsonl').exists():
        results={row['companyId']:row for row in research.read_crawl_log(STATE/'crawl.jsonl')}
    records={}
    abstained=0
    for company_id,row in results.items():
        company=companies.get(company_id)
        if not company: continue
        for finding in row.get('candidates',[]):
            if research.domain(finding['sourceUrl'])!=research.domain(company['website']):continue
            claim=classify_claim(finding)
            if not claim:
                abstained+=1;continue
            key,title,organization,scope,description=claim
            stable=(company_id,key)
            if stable in records:continue
            # Exact context is kept in the private research cache. Public batch gets a paraphrased audit note.
            records[stable]=record(company,key,title,organization,scope,description,finding['sourceUrl'],'company',row['checkedAt'],'first_party_explicit_claim',f"Explicit {finding.get('channel','text')} designation on the matched company website; ambiguous and editorial contexts excluded.")
    directory_path=STATE/'directory-research.json'
    if directory_path.exists():
        for finding in json.loads(directory_path.read_text()):
            if finding['status']!='profile_identity_matched':continue
            company=companies[finding['companyId']]
            organization=finding['organization']
            if organization=='B Lab':continue # directory presence alone is not proof of certification
            key={'EnergySage':'energysage','SolarReviews':'solarreviews','Solar Power World':'solar-power-world'}[organization]
            description='Public company profile. Directory presence is separate from certification; external ratings are not included in Connect review scores.'
            # Profile existence is corroborated here. Network approval/status needs separate manual review.
            records[(company['id'],key)]=record(company,key,organization+' profile',organization,'company',description,finding['sourceUrl'],'directory',finding['checkedAt'],'directory_profile_identity_match',finding['matchedBy'],category='directory',scope_detail=company['name']+' public directory profile.')
    # Human-reviewed source records and issuer-directory domain matches take precedence.
    manual=ROOT/'data/company-credentials/manual.json'
    if manual.exists():
        for item in json.loads(manual.read_text())['records']:
            records[(item['companyId'],item['key'])]=item
    batch={'version':1,'generatedAt':research.now(),'inventoryOrigin':snapshot['origin'],'records':sorted(records.values(),key=lambda r:(r['companyName'].lower(),r['key']))}
    research.save_json(OUTPUT,batch)
    summary={'inventoryCompanies':len(companies),'attemptedCompanies':len(results),'recordCount':len(records),'companiesWithImportableRecords':len({r['companyId'] for r in records.values()}),'abstainedMentions':abstained,'output':str(OUTPUT),'methods':dict(__import__('collections').Counter(r['reviewMethod'] for r in records.values()))}
    research.save_json(STATE/'batch-summary.json',summary)
    print(json.dumps(summary,indent=2))

if __name__=='__main__':build()
