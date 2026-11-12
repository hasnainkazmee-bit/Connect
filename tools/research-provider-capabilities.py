#!/usr/bin/env python3
"""Research every existing provider without turning website mentions into approved matches.

Uses the current public inventory, obeys robots, resumes per company, and keeps
machine candidates separate from reviewed offerings. No profile writes or outreach.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import threading
import unicodedata
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.research' / 'provider-matching'
spec = importlib.util.spec_from_file_location('credential_web', ROOT / 'tools/research-credentials.py')
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)
web.STATE = STATE
web.USER_AGENT = 'ConnectProviderResearch/1.0 (+https://connect.sunhubapp.com)'

# Discovery patterns, not publishing rules. A match is always queued for review.
PATTERNS = {
 'solar-installation': r'\b(?:solar(?:\s+(?:panel|pv|system|energy))?\s+install(?:ation|er|ing)s?|install\w*\s+(?:\w+\s+){0,3}solar)\b',
 'solar-design': r'\b(?:solar(?:\s+(?:pv|system))?\s+(?:design|engineering)|(?:design|engineer)\w*\s+(?:\w+\s+){0,3}solar)\b',
 'battery-storage': r'\b(?:battery\s+(?:storage|backup|installation)|energy\s+storage\s+(?:system|installation|solution))s?\b',
 'solar-maintenance': r'\b(?:solar(?:\s+(?:panel|system))?\s+(?:repair|maintenance|service)|(?:repair|maintain)\w*\s+(?:\w+\s+){0,3}solar|operations?\s*(?:and|&)\s*maintenance)\b',
 'solar-detach-reset': r'\b(?:detach\s*(?:and|&|/)\s*reset|solar.{0,30}(?:removal|reinstall)|panel\s+removal)\b',
 'electrical': r'\b(?:electrical\s+(?:contractor|contracting|service|installation|repair|upgrade)|commercial\s+electrician|residential\s+electrician)s?\b',
 'ev-charging': r'\b(?:(?:ev|electric\s+vehicle)\s+charg(?:ing|er)|charg(?:ing|er)\s+(?:station\s+)?installation)s?\b',
 'lighting': r'\b(?:lighting\s+(?:installation|retrofit|upgrade|design)|led\s+(?:lighting|retrofit))s?\b',
 'backup-power': r'\b(?:generator\s+(?:installation|repair|maintenance)|backup\s+(?:generator|power))s?\b',
 'solar-thermal': r'\b(?:solar\s+(?:thermal|hot\s+water|water\s+heating|pool\s+heating))\b',
 'wind-power': r'\b(?:wind\s+(?:power|turbine)\s+(?:installation|system)|install\w*\s+wind)\b',
 'project-management': r'\b(?:solar\s+project\s+management|construction\s+management)\b',
 'contract-maintenance-staff': r'\b(?:maintenance\s+(?:staffing|personnel)|contract(?:ed)?\s+maintenance\s+(?:staff|personnel))\b',
 'solar-development': r'\b(?:solar\s+(?:project\s+)?develop(?:ment|er)|develop\w*\s+solar\s+project)s?\b',
 'energy-consulting': r'\b(?:energy\s+(?:consulting|consultancy|advisory|consultant)|solar\s+(?:consulting|consultant))s?\b',
 'energy-procurement': r'\b(?:energy\s+procurement|power\s+procurement)\b',
 'equipment-procurement': r'\b(?:(?:solar|equipment)\s+procurement|procurement\s+(?:service|support))s?\b',
 'equipment-supply': r'\b(?:solar\s+(?:distribut(?:or|ion)|wholesale|equipment\s+suppl)|wholesale\s+solar)\w*\b',
 'logistics': r'\b(?:logistics\s+(?:service|solution)|freight\s+(?:service|transport)|solar\s+logistics)s?\b',
 'racking-design': r'\b(?:(?:racking|mounting)\s+(?:design|engineering)|engineer\w*\s+(?:\w+\s+){0,2}racking)\b',
 'racking-installation': r'\b(?:(?:racking|mounting)\s+install\w*|install\w*\s+(?:\w+\s+){0,2}racking)\b',
 'roofing': r'\b(?:roof(?:ing)?\s+(?:installation|replacement|repair|contractor)|re-roofing)\b',
 'permitting': r'\b(?:solar\s+permit\w*|permitting\s+(?:service|support|assistance)|permit\s+(?:design|package|plan))s?\b',
 'inspection': r'\b(?:solar\s+(?:inspection|testing)|system\s+inspection|electrical\s+inspection)s?\b',
 'commissioning': r'\b(?:solar\s+commissioning|system\s+commissioning|commissioning\s+service)s?\b',
 'solar-cleaning': r'\b(?:solar\s+panel\s+cleaning|solar\s+cleaning|module\s+cleaning)\b',
 'crew-supply': r'\b(?:solar\s+staffing|installation\s+crew\s+(?:supply|staffing)|labor.only\s+(?:solar|installation)|solar\s+labor\s+(?:supply|staffing))\b',
 'trenching': r'\b(?:trenching\s+(?:service|contractor)|excavation\s+service)s?\b',
 'interconnection': r'\b(?:interconnection\s+(?:application|support|service|assistance)|utility\s+coordination)\b',
 'safety-audits': r'\b(?:safety\s+(?:audit|inspection|consulting))s?\b',
}
PRODUCTS = {
 'solar-modules': r'\b(?:solar\s+(?:module|panel)|photovoltaic\s+module)s?\b',
 'inverters': r'\b(?:microinverter|solar\s+inverter|string\s+inverter|hybrid\s+inverter)s?\b',
 'battery-storage': r'\b(?:battery\s+(?:storage|backup)|energy\s+storage\s+system)s?\b',
 'racking-mounting': r'\b(?:solar\s+(?:racking|mounting)|racking\s+system|mounting\s+system)s?\b',
 'foundations': r'\b(?:helical\s+(?:pile|foundation)|ground\s+screw|driven\s+pile)s?\b',
 'electrical-bos': r'\b(?:balance\s+of\s+system|combiner\s+box|solar\s+cable|pv\s+wire)s?\b',
 'backup-generators': r'\b(?:backup|standby)\s+generator\b',
 'ev-chargers': r'\b(?:ev\s+charger|electric\s+vehicle\s+charger)s?\b',
 'solar-system': r'\b(?:solar\s+kit|off.grid\s+kit|complete\s+solar\s+system)s?\b',
}
IGNORE_PATH = re.compile(r'/(?:blog|news|articles?|careers?|jobs|privacy|terms|tag|author|faq)(?:/|$)|\.(?:pdf|png|jpe?g|svg|zip|mp4)$', re.I)
RELEVANT = re.compile(r'services?|solutions?|products?|capabilit|what.we.do|areas?.(?:we.)?serv|service.area|locations?|commercial|residential|industr|about|install|maintenance|repair|storage|racking|electrical|equipment', re.I)
SECTORS = {'residential': r'\b(?:residential|homeowner|homes)\b', 'commercial': r'\bcommercial\b', 'industrial': r'\bindustrial\b', 'agricultural': r'\b(?:agricultur\w*|farms?)\b', 'municipal': r'\b(?:municipal|government)\b', 'nonprofit': r'\bnon.?profit\b', 'utility': r'\butility.scale\b'}

class Content(HTMLParser):
    """Exclude menus, forms, testimonials and articles from offering discovery."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.lines = []
        self.current = []
        self.identity = []
        self.links = []
        self.anchor = None
        self.title = []
    def flush(self):
        value = re.sub(r'\s+', ' ', ''.join(self.current)).strip()
        if value: self.lines.append(value)
        self.current = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        parent = self.stack[-1][1] if self.stack else False
        hidden = parent or tag in ('script','style','noscript','svg','nav','header','footer','form','select','option','blockquote') or 'hidden' in a or a.get('aria-hidden') == 'true' or bool(re.search(r'testimonial|review-widget|cookie|menu|navigation', a.get('class','')+' '+a.get('id',''), re.I))
        if tag in ('p','div','li','h1','h2','h3','h4','section','br'): self.flush()
        if tag not in ('br','hr','img','input','meta','link','source','wbr','area','embed','param','track','col','base'):
            self.stack.append((tag, hidden))
        if tag == 'a' and a.get('href'): self.anchor = [a['href'], '']
        if tag == 'img' and a.get('alt'): self.identity.append(a['alt'])
    def handle_endtag(self, tag):
        if tag in ('p','div','li','h1','h2','h3','h4','section'): self.flush()
        if tag == 'a' and self.anchor:
            self.links.append(self.anchor); self.anchor = None
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                self.stack = self.stack[:i]; break
    def handle_data(self, value):
        tags = [x[0] for x in self.stack]
        if not any(t in ('script','style','noscript','svg') for t in tags):
            self.identity.append(value)
        if 'title' in tags: self.title.append(value)
        if self.anchor: self.anchor[1] += value
        if not self.stack or not self.stack[-1][1]: self.current.append(value)

def normalize_name(raw):
    words = re.sub(r'[^a-z0-9]+',' ', unicodedata.normalize('NFKD',raw).encode('ascii','ignore').decode().lower()).split()
    return ''.join(w for w in words if w not in {'inc','incorporated','llc','ltd','corp','corporation','company','co','the'})

def extract(html, url, company_name):
    p = Content(); p.feed(html); p.flush()
    text = '\n'.join(p.lines)
    identity = ' '.join(p.identity)
    key = normalize_name(company_name)
    matched = len(key) >= 6 and key in normalize_name(identity)
    parked = bool(re.search(r'(?:domain (?:is )?for sale|buy this domain|website coming soon|account (?:has been )?suspended|under construction)', identity, re.I))
    findings = []
    if not IGNORE_PATH.search(urllib.parse.urlsplit(url).path):
        for kind, patterns in [('service', PATTERNS), ('product', PRODUCTS)]:
            for category, pattern in patterns.items():
                for line in p.lines:
                    # Short menu-like words and long concatenated footers are not scope evidence.
                    if not 30 <= len(line) <= 1800 or not re.search(pattern, line, re.I): continue
                    if re.search(r'\b(?:we do not|we don.t|no longer|do not offer|not provided|no installation|never install)\b', line, re.I): continue
                    match = re.search(pattern,line,re.I)
                    evidence = line[max(0,match.start()-130):min(len(line),match.end()+220)].strip()
                    findings.append({'kind':kind,'categoryId':category,'sourceUrl':url,'evidence':evidence,
                      'sectorHints':[k for k,v in SECTORS.items() if re.search(v,line,re.I)],'reviewStatus':'unreviewed'})
                    break
    coverage = [line[:450] for line in p.lines if 25 <= len(line) <= 900 and re.search(r'\b(?:we serve|serving|service area|service territory|delivery area|ship(?:ping)? (?:to|across)|available (?:in|throughout))\b',line,re.I)][:6]
    links = [{'url':urllib.parse.urljoin(url,href).split('#')[0],'label':re.sub(r'\s+',' ',label).strip()[:150]} for href,label in p.links]
    return {'title':''.join(p.title).strip()[:200],'text':text[:150000],'links':links,'identityMatched':matched and not parked,
      'identityStatus':'parked_or_inactive' if parked else 'name_on_official_domain' if matched else 'needs_review','candidates':findings,'coverageCandidates':coverage}

def robots_allowed(url):
    # Unlike a missing robots file, timeouts and server errors do not grant permission.
    origin = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(url))
    with web.LOCK: cached = web.ROBOTS.get(origin)
    if cached is None:
        try:
            _, body, mime = web.fetch(origin+'/robots.txt',timeout=8)
            if 'html' in mime: cached = True
            else:
                cached = web.urllib.robotparser.RobotFileParser(); cached.parse(body.splitlines())
        except Exception as e:
            cached = bool(re.search(r'HTTP (?:404|410)\b',str(e)))
        with web.LOCK: web.ROBOTS[origin] = cached
    if isinstance(cached,bool): return cached
    delay = cached.crawl_delay(web.USER_AGENT) or cached.crawl_delay('*') or 0
    rate = cached.request_rate(web.USER_AGENT) or cached.request_rate('*')
    if rate: delay = max(delay,rate.seconds/rate.requests)
    # An exceptionally long requested delay is deferred for operator review.
    if delay > 30: return False
    with web.LOCK: web.HOST_DELAYS[urllib.parse.urlsplit(url).hostname] = max(delay,0.8)
    return cached.can_fetch(web.USER_AGENT,url)

def crawl(company, max_pages, hints):
    result = {'companyId':company['id'],'companyName':company['name'],'website':company['website'],
      'checkedAt':web.now(),'identityStatus':'unknown','status':'pending','pages':[],'candidates':[],'coverageCandidates':[]}
    if company['is_demo']: return {**result,'status':'excluded_demo'}
    if not company['website']: return {**result,'status':'no_website'}
    domain = web.domain(company['website'])
    pending = [company['website']]; seen = set()
    name_matched = False
    for _ in range(max_pages):
        if not pending: break
        url = pending.pop(0)
        seen.add(url)
        try:
            if not robots_allowed(url):
                result['pages'].append({'url':url,'status':'robots_or_access_blocked'}); break
            actual, body, mime = web.fetch(url)
            if web.domain(actual) != domain:
                result['pages'].append({'url':url,'finalUrl':actual,'status':'identity_redirect_review'}); break
            if 'html' not in mime and not body.lstrip().lower().startswith(('<html','<!doctype html')):
                result['pages'].append({'url':actual,'status':'not_html'}); continue
            parsed = extract(body,actual,company['name'])
            checked = web.now(); digest = hashlib.sha256(body.encode()).hexdigest()
            cache_key = hashlib.sha256(actual.encode()).hexdigest()
            web.save_json(STATE/'pages'/(cache_key+'.json'),{'url':actual,'checkedAt':checked,'contentHash':digest,**parsed})
            result['pages'].append({'url':actual,'checkedAt':checked,'contentHash':digest,'title':parsed['title'],'status':'ok','cacheKey':cache_key})
            name_matched = name_matched or parsed['identityMatched']
            if parsed['identityStatus'] == 'parked_or_inactive':
                result['identityStatus'] = 'parked_or_inactive'; break
            for finding in parsed['candidates']:
                if not any(f['kind']==finding['kind'] and f['categoryId']==finding['categoryId'] for f in result['candidates']): result['candidates'].append(finding)
            result['coverageCandidates'].extend({'sourceUrl':actual,'evidence':e,'offeringScope':'needs_review'} for e in parsed['coverageCandidates'])
            for link in parsed['links']+hints.get(company['id'],[]):
                target = link['url']
                u = urllib.parse.urlsplit(target)
                if web.domain(target) == domain and u.scheme in ('https','http') and not u.query and not IGNORE_PATH.search(u.path) and RELEVANT.search(target+' '+link.get('label','')) and target not in seen and target not in pending:
                    pending.append(target)
            pending.sort(key=lambda u: (0 if re.search(r'/(?:services?|products?|solutions?)/?$',urllib.parse.urlsplit(u).path,re.I) else 1, len(u)))
        except Exception as error:
            result['pages'].append({'url':url,'status':'fetch_failed','error':str(error)[:200]})
    ok = any(p['status']=='ok' for p in result['pages'])
    if result['identityStatus']=='parked_or_inactive' or (ok and not name_matched): result['status']='identity_review'
    elif name_matched:
        result['identityStatus']='name_on_official_domain'
        result['status']='ready_for_review' if result['candidates'] else 'no_offerings_found'
    else: result['status']='robots_or_access_blocked' if any(p['status']=='robots_or_access_blocked' for p in result['pages']) else 'unreachable'
    result['checkedAt']=web.now()
    return result

def load_records():
    return {r['companyId']:r for r in web.read_crawl_log(STATE/'research.jsonl')}

def report(inventory):
    rows=load_records(); ids={c['id'] for c in inventory['companies']}; selected=[r for k,r in rows.items() if k in ids]
    stats={'inventory':len(ids),'realCompanies':sum(not c['is_demo'] for c in inventory['companies']),
      'processed':len(selected),'remaining':len(ids)-len(selected),'statuses':dict(Counter(r['status'] for r in selected)),
      'pagesRead':sum(p['status']=='ok' for r in selected for p in r['pages']),
      'offeringCandidates':sum(len(r['candidates']) for r in selected),'reviewedProfiles':sum(bool(c['researched_at']) for c in inventory['companies']),
      'generatedAt':web.now(),'note':'Discovery candidates require review. These counts do not imply approved or match-ready profiles.'}
    web.save_json(STATE/'summary.json',stats)
    return stats

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['crawl','report']); parser.add_argument('--workers',type=int,default=12);parser.add_argument('--pages',type=int,default=3);parser.add_argument('--limit',type=int)
    args=parser.parse_args(); inventory=json.loads((STATE/'inventory.json').read_text())
    if args.command=='report': print(json.dumps(report(inventory),indent=2));return
    # Older public pages only suggest URLs. Every new claim requires a fresh read.
    hints={}
    for row in web.read_crawl_log(ROOT/'.research/credentials/crawl.jsonl'):
        hints[row['companyId']]=[]
        for page in row.get('pages',[]):
            if page.get('cacheKey'):
                path=ROOT/'.research/credentials/pages'/(page['cacheKey']+'.json')
                if path.exists(): hints[row['companyId']].extend(json.loads(path.read_text()).get('links',[]))
    done=load_records()
    todo=[c for c in inventory['companies'] if c['id'] not in done or done[c['id']]['website']!=c['website']]
    if args.limit: todo=todo[:args.limit]
    STATE.mkdir(parents=True,exist_ok=True)
    with (STATE/'research.jsonl').open('a',buffering=1) as out, concurrent.futures.ThreadPoolExecutor(max_workers=min(16,max(1,args.workers))) as executor:
        futures={executor.submit(crawl,c,min(5,max(1,args.pages)),hints):c for c in todo}
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            result=future.result();out.write(json.dumps(result,ensure_ascii=False)+'\n')
            if i%50==0 or i==len(todo): print(json.dumps({'doneThisRun':i,'totalThisRun':len(todo),**report(inventory)}),flush=True)
    print(json.dumps(report(inventory),indent=2))

if __name__=='__main__':main()
