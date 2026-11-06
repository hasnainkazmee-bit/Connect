#!/usr/bin/env python3
"""Resumable public-web credential discovery. Findings are candidates, never approvals.

Inventory: python3 tools/research-credentials.py inventory
Crawl:     python3 tools/research-credentials.py crawl --workers 12
Report:    python3 tools/research-credentials.py report
"""
import argparse
import concurrent.futures
import hashlib
import ipaddress
import json
import math
import re
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.robotparser
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.research' / 'credentials'
USER_AGENT = 'ConnectCredentialResearch/1.0 (+https://connect.sunhubapp.com)'
LOCK = threading.Lock()
HOST_LOCKS = {}
ROBOTS = {}
NEXT_REQUEST = {}
HOST_DELAYS = {}

def now():
    return datetime.now(timezone.utc).isoformat()

def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + f'.{threading.get_ident()}.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)

def public_url(raw):
    u = urllib.parse.urlsplit(raw)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.port not in (None, 80, 443):
        raise ValueError('Not a public HTTP(S) URL')
    addresses = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Non-public network address')
    return u

def fetch(raw, timeout=14):
    """Validate every redirect; no credentials, cookies, proxy bypass or TLS bypass."""
    current = raw
    for _ in range(5):
        u = public_url(current)
        host = u.hostname
        with LOCK:
            host_lock = HOST_LOCKS.setdefault(host, threading.Lock())
        with host_lock:
            delay = max(0, NEXT_REQUEST.get(host, 0) - time.monotonic())
            if delay:
                time.sleep(delay)
            key = hashlib.sha256((current + str(threading.get_ident())).encode()).hexdigest()
            body = STATE / 'downloads' / (key + '.body')
            header = body.with_suffix('.headers')
            body.parent.mkdir(parents=True, exist_ok=True)
            try:
                command = ['curl', '--silent', '--show-error', '--compressed', '--max-time', str(timeout), '--connect-timeout', '6', '--max-filesize', '2097152', '--proto', '=http,https', '--user-agent', USER_AGENT, '-D', str(header), '-o', str(body), '-w', '%{http_code}', current]
                result = subprocess.run(command, capture_output=True, text=True, timeout=timeout+3)
                if result.returncode:
                    raise ValueError('fetch failed: ' + result.stderr.strip()[:160])
                status = int(result.stdout)
                headers = header.read_text(errors='replace')
                if 300 <= status < 400:
                    locations = re.findall(r'^location:\s*(.+)$', headers, re.I | re.M)
                    if not locations:
                        raise ValueError('redirect without location')
                    current = urllib.parse.urljoin(current, locations[-1].strip())
                    continue
                if status != 200:
                    raise ValueError('HTTP ' + str(status))
                content_types = re.findall(r'^content-type:\s*([^;\r\n]+)', headers, re.I | re.M)
                mime = content_types[-1].lower() if content_types else ''
                return current, body.read_bytes().decode('utf-8', errors='replace'), mime
            finally:
                NEXT_REQUEST[host] = time.monotonic() + max(0.8,HOST_DELAYS.get(host,0))
                body.unlink(missing_ok=True)
                header.unlink(missing_ok=True)
    raise ValueError('too many redirects')

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text, self.links, self.alt = [], [], []
        self.hidden = 0
        self.anchor = None
        self.heading = None
        self.headings = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript', 'svg'):
            self.hidden += 1
        if tag == 'a' and attrs.get('href'):
            self.anchor = [attrs['href'], '']
        if tag == 'h1':
            self.heading = ''
        if tag == 'img' and attrs.get('alt'):
            self.alt.append(attrs['alt'])
        if tag in ('p','div','li','h1','h2','h3','h4','br','section'):
            self.text.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'svg'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'a' and self.anchor:
            self.links.append(self.anchor)
            self.anchor = None
        if tag == 'h1' and self.heading is not None:
            self.headings.append(self.heading.strip())
            self.heading = None

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)
            if self.anchor:
                self.anchor[1] += data
            if self.heading is not None:
                self.heading += data

def domain(raw):
    try:
        return urllib.parse.urlsplit(raw).hostname.lower().removeprefix('www.')
    except (AttributeError, ValueError):
        return ''

def allowed(url):
    u = urllib.parse.urlsplit(url)
    origin = f'{u.scheme}://{u.netloc}'
    with LOCK:
        cached = ROBOTS.get(origin)
    if cached is None:
        try:
            _, content, mime = fetch(origin + '/robots.txt', timeout=8)
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(content.splitlines() if 'html' not in mime else [])
            cached = parser
        except Exception as error:
            # A missing robots file imposes no rules; access-denied robots is not bypassed.
            cached = False if 'HTTP 401' in str(error) or 'HTTP 403' in str(error) else True
        with LOCK:
            ROBOTS[origin] = cached
    if isinstance(cached, bool):
        return cached
    delay=cached.crawl_delay(USER_AGENT) or cached.crawl_delay('*') or 0
    rate=cached.request_rate(USER_AGENT) or cached.request_rate('*')
    if rate:delay=max(delay,rate.seconds/rate.requests)
    with LOCK:HOST_DELAYS[u.hostname]=max(HOST_DELAYS.get(u.hostname,0),delay)
    return cached.can_fetch(USER_AGENT, url)

PATTERNS = {
    'NABCEP': r'\bNABCEP\b',
    'UL / IEC': r'\b(?:UL\s*(?:1703|1741|61730|9540|1973)|IEC\s*(?:61215|61730|61701|62716))\b',
    'ISO management': r'\bISO\s*(?:9001|14001|45001|50001)(?::\d{4})?\b',
    'B Corp': r'\b(?:certified\s+B\s*corp(?:oration)?|B\s*corp\s*certifi\w+)\b',
    'Tesla installer': r'\b(?:Tesla.{0,45}(?:certified|preferred|premier).{0,25}installer|(?:certified|preferred|premier).{0,25}Tesla.{0,25}installer)\b',
    'Enphase installer': r'\b(?:Enphase.{0,40}(?:certified|platinum|gold|silver).{0,20}installer|(?:certified|platinum|gold|silver).{0,20}Enphase.{0,20}installer)\b',
    'REC installer': r'\bREC\s+(?:certified|protrust|solar professional)\b',
    'SolarEdge installer': r'\bSolarEdge.{0,35}(?:certified|preferred|elite|installer\s*plus)\b',
    'Roofing certification': r'\b(?:GAF.{0,30}(?:master\s*elite|certified)|CertainTeed.{0,30}(?:master|certified)|Owens Corning.{0,25}(?:preferred|platinum))\b',
    'BloombergNEF Tier 1': r'\b(?:Bloomberg(?:NEF)?|BNEF).{0,80}tier\s*(?:1|one)\b',
    'BBB accreditation': r'\b(?:BBB.{0,25}accredited|Better Business Bureau.{0,25}accredited|accredited.{0,25}(?:BBB|Better Business Bureau))\b',
    'SEIA membership': r'\b(?:SEIA.{0,30}member|member.{0,35}(?:SEIA|Solar Energy Industries Association))\b',
}
LINK_RANK = re.compile(r'certific|accredit|credential|award|about|our.team|who.we.are|partner|membership|quality|recognition', re.I)
DIRECTORIES = {'energysage.com':r'/supplier/\d+/', 'solarreviews.com':r'/(?:installers|manufacturers)/', 'nabcep.org':r'.', 'bcorporation.net':r'/find-a-b-corp/company/', 'solarpowerworldonline.com':r'/suppliers/'}

def parse_page(url, content):
    parser = Page()
    parser.feed(content)
    text = re.sub(r'[ \t\r\f\v]+', ' ', ''.join(parser.text))
    text = re.sub(r'\n\s*\n+', '\n', text).strip()
    links = []
    for href, label in parser.links:
        target = urllib.parse.urljoin(url, href).split('#')[0]
        if urllib.parse.urlsplit(target).scheme in ('http', 'https'):
            links.append({'url':target,'label':re.sub(r'\s+',' ',label).strip()[:180]})
    findings = []
    for name, pattern in PATTERNS.items():
        matches = list(re.finditer(pattern,text,re.I))
        for match in matches[:4]:
            findings.append({'topic':name,'channel':'text','context':text[max(0,match.start()-150):match.end()+200]})
        for alt in parser.alt:
            if re.search(pattern,alt,re.I):
                findings.append({'topic':name,'channel':'image_alt','context':alt[:300]})
                break
    return text[:250000], links, findings

def crawl_company(company, max_pages):
    result = {'companyId':company['id'],'name':company['name'],'username':company.get('username'),'website':company.get('website',''),'checkedAt':now(),'pages':[],'candidates':[],'directoryLinks':[]}
    website = company.get('website','').strip()
    if not website:
        return {**result,'status':'no_website'}
    pending = [website]
    seen = set()
    home_domain = domain(website)
    for _ in range(max_pages):
        if not pending:
            break
        target = pending.pop(0)
        if target in seen:
            continue
        seen.add(target)
        try:
            if not allowed(target):
                result['pages'].append({'url':target,'status':'robots_disallowed'})
                continue
            actual, content, mime = fetch(target)
            if 'html' not in mime and not content.lstrip().lower().startswith(('<!doctype html','<html')):
                result['pages'].append({'url':actual,'status':'not_html'})
                continue
            if domain(actual) != home_domain:
                # Redirected domains may be acquisitions, parking or unrelated businesses.
                result['pages'].append({'url':target,'finalUrl':actual,'status':'identity_redirect_review'})
                continue
            text, links, findings = parse_page(actual,content)
            cache_key = hashlib.sha256(actual.encode()).hexdigest()
            save_json(STATE/'pages'/(cache_key+'.json'),{'url':actual,'checkedAt':now(),'text':text,'links':links})
            result['pages'].append({'url':actual,'status':'ok','cacheKey':cache_key,'textLength':len(text)})
            result['candidates'].extend({**item,'sourceUrl':actual} for item in findings)
            for link in links:
                d = domain(link['url'])
                for directory, path_pattern in DIRECTORIES.items():
                    if (d == directory or d.endswith('.'+directory)) and re.search(path_pattern,urllib.parse.urlsplit(link['url']).path):
                        if not any(l['url']==link['url'] for l in result['directoryLinks']):
                            result['directoryLinks'].append(link)
                if d == home_domain and LINK_RANK.search(link['url']+' '+link['label']) and link['url'] not in seen and link['url'] not in pending and not re.search(r'\.(?:pdf|jpg|png|zip|mp4)(?:\?|$)',link['url'],re.I):
                    pending.append(link['url'])
            pending.sort(key=lambda u:(not bool(re.search(r'certific|accredit|credential',u,re.I)),len(u)))
        except Exception as error:
            result['pages'].append({'url':target,'status':'fetch_failed','error':str(error)[:240]})
    ok = any(p['status']=='ok' for p in result['pages'])
    result['status'] = 'candidates_found' if result['candidates'] or result['directoryLinks'] else 'no_findings_in_crawled_pages' if ok else 'access_or_identity_review'
    return result

def load_inventory():
    return json.loads((STATE/'inventory.json').read_text())['companies']

def read_crawl_log(path):
    """JSONL is separated by LF, not Unicode line separators inside quoted text."""
    rows=[]
    if path.exists():
        with path.open() as source:
            for line in source:
                try: rows.append(json.loads(line))
                except json.JSONDecodeError: pass # an in-progress final write is retried on the next read
    return rows

def phone_numbers(text):
    pattern=r'(?<!\d)(?:\+?1[\s.-]*)?(?:\(\s*(\d{3})\s*\)|(\d{3}))[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)'
    return {a+b+c+d for a,b,c,d in re.findall(pattern,text)}

def directory_identity(company,parser,text,first_party_link,official_texts):
    def normalize(value):
        value=unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()
        words=re.sub(r'[^a-z0-9]+',' ',value).split()
        return ''.join(word for word in words if word not in {'the','inc','incorporated','llc','ltd','limited','corp','corporation'})
    names=[company['name'],re.sub(r'\s+(?:inc\.?|llc|ltd\.?|corporation|incorporated)$','',company['name'],flags=re.I)]
    name_keys={normalize(name) for name in names if len(normalize(name))>5}
    exact_name=bool(name_keys & {normalize(h) for h in parser.headings})
    if any(domain(href)==domain(company['website']) for href,label in parser.links):return 'official_website_backlink'
    if exact_name and first_party_link:return 'exact_company_heading_and_first_party_link'
    if exact_name and phone_numbers(text) & phone_numbers('\n'.join(official_texts)):return 'exact_company_heading_and_official_website_phone'
    return None

def reconcile(args):
    """Re-evaluate cached, previously unresolved profiles without new network requests."""
    companies={c['id']:c for c in load_inventory()}
    crawl={row['companyId']:row for row in read_crawl_log(STATE/'crawl.jsonl')}
    path=STATE/'directory-research.json'
    rows=json.loads(path.read_text())
    improved=0
    for row in rows:
        if row['status']!='identity_review' or not row.get('cacheKey'):continue
        company=companies[row['companyId']]
        cached=json.loads((STATE/'pages'/(row['cacheKey']+'.json')).read_text())
        parser=Page();parser.headings=cached.get('headings',[]);parser.links=cached.get('links',[])
        texts=[]
        for page in crawl.get(company['id'],{}).get('pages',[]):
            if page.get('status')=='ok' and page.get('cacheKey'):
                source=STATE/'pages'/(page['cacheKey']+'.json')
                if source.exists():texts.append(json.loads(source.read_text()).get('text',''))
        text=cached.get('text','')
        match=directory_identity(company,parser,text,row.get('firstPartyLink',False),texts)
        if match:
            row.update(status='profile_identity_matched',matchedBy=match,networkDisclaimer=bool(re.search(r'not in the EnergySage network|not been screened or verified',text,re.I)))
            improved+=1
    save_json(path,rows)
    print(f'Reconciled cached directory profiles: {improved} additional corroborated identities.',flush=True)

def inventory(args):
    first_url = args.origin.rstrip('/') + '/api/companies?page=1'
    _, content, _ = fetch(first_url,30)
    first = json.loads(content)
    pages = math.ceil(first['total']/first['pageSize'])
    by_id = {c['id']:c for c in first['companies']}
    def get_page(page):
        for attempt in range(3):
            try:
                _, content, _ = fetch(args.origin.rstrip('/')+f'/api/companies?page={page}',30)
                return json.loads(content)['companies']
            except Exception:
                if attempt == 2: raise
                time.sleep(2+attempt)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for i, companies in enumerate(executor.map(get_page,range(2,pages+1)),2):
            by_id.update({c['id']:c for c in companies})
            if i%20 == 0: print(f'Inventory page {i}/{pages}: {len(by_id)} unique companies',flush=True)
    columns = ['id','name','username','slug','type','website','location','listing_status']
    rows = [{k:c.get(k) for k in columns} for c in by_id.values()]
    snapshot = {'origin':args.origin,'capturedAt':now(),'reportedTotal':first['total'],'uniqueTotal':len(rows),'companies':rows}
    save_json(STATE/'inventory.json',snapshot)
    print(f'Inventory complete: {len(rows)} unique companies; API reported {first["total"]}',flush=True)
    if len(rows) != first['total']:
        raise SystemExit('Directory changed during pagination; rerun inventory before claiming complete coverage.')

def crawl(args):
    rows = load_inventory()
    completed = set()
    log = STATE/'crawl.jsonl'
    if log.exists() and not args.refresh:
        completed={row['companyId'] for row in read_crawl_log(log)}
    pending = [c for c in rows if c['id'] not in completed]
    if args.limit: pending = pending[:args.limit]
    print(f'Crawl: {len(rows)} companies, {len(completed)} already attempted, {len(pending)} queued',flush=True)
    counts = Counter()
    with log.open('a') as output, concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        jobs = {executor.submit(crawl_company,c,args.pages):c for c in pending}
        for i, job in enumerate(concurrent.futures.as_completed(jobs),1):
            try: result = job.result()
            except Exception as error: result = {'companyId':jobs[job]['id'],'name':jobs[job]['name'],'status':'worker_failed','error':str(error),'checkedAt':now()}
            output.write(json.dumps(result,ensure_ascii=False)+'\n'); output.flush()
            counts[result['status']] += 1
            if i%25 == 0 or i==len(jobs): print(f'Crawl {i}/{len(jobs)}: {dict(counts)}',flush=True)

def report(args):
    companies = load_inventory()
    results = {}
    log = STATE/'crawl.jsonl'
    if log.exists():
        results={row['companyId']:row for row in read_crawl_log(log)}
    counts = Counter(results.get(c['id'],{}).get('status','not_started') for c in companies)
    save_json(STATE/'coverage.json',{'generatedAt':now(),'total':len(companies),'statusCounts':dict(counts),'companies':[{**c,'researchStatus':results.get(c['id'],{}).get('status','not_started'),'candidateCount':len(results.get(c['id'],{}).get('candidates',[])),'directoryLinkCount':len(results.get(c['id'],{}).get('directoryLinks',[]))} for c in companies]})
    print(json.dumps({'total':len(companies),'statusCounts':dict(counts),'coverage':str(STATE/'coverage.json')},indent=2))
    if args.publish:
        folder=ROOT/'data/company-credentials'
        directory_path=STATE/'directory-research.json'
        directory_rows=json.loads(directory_path.read_text()) if directory_path.exists() else []
        batch_path=folder/'reviewed.json'
        records=json.loads(batch_path.read_text())['records'] if batch_path.exists() else []
        by_company=Counter(record['companyId'] for record in records)
        coverage=[]
        for company in companies:
            result=results.get(company['id'],{})
            coverage.append({**company,'websiteResearchStatus':result.get('status','not_started'),'checkedAt':result.get('checkedAt'),'importableRecordCount':by_company[company['id']],'checkedPages':[{key:page[key] for key in ['url','finalUrl','status'] if key in page} for page in result.get('pages',[])]})
        summary={'generatedAt':now(),'inventoryCompanies':len(companies),'attemptedCompanies':len(results),'websiteResearchStatusCounts':dict(counts),'websitePagesFetched':sum(p.get('status')=='ok' for row in results.values() for p in row.get('pages',[])),'directoryProfilesAttempted':len(directory_rows),'directoryProfileStatusCounts':dict(Counter(row['status'] for row in directory_rows)),'importableRecords':len(records),'companiesWithImportableRecords':len(by_company),'evidenceBasisCounts':dict(Counter(record['evidenceBasis'] for record in records)),'reviewMethodCounts':dict(Counter(record['reviewMethod'] for record in records)),'notes':['Company-reported claims are not issuer verification.','No findings means no qualifying evidence in checked pages, not absence of credentials.','These research artifacts do not establish a production deployment or import.']}
        save_json(folder/'coverage.json',{'generatedAt':now(),'companies':coverage})
        save_json(folder/'research-summary.json',summary)
        print('Published coverage and research-summary artifacts.',flush=True)

def directories(args):
    """Validate direct profile links discovered on the company's own website."""
    companies = {c['id']:c for c in load_inventory()}
    results = {}
    results={row['companyId']:row for row in read_crawl_log(STATE/'crawl.jsonl')}
    official_texts={}
    for company_id,row in results.items():
        texts=[]
        for page in row.get('pages',[]):
            if page.get('status')=='ok' and page.get('cacheKey'):
                cache=STATE/'pages'/(page['cacheKey']+'.json')
                if cache.exists():texts.append(json.loads(cache.read_text()).get('text',''))
        official_texts[company_id]=texts
    output_path = STATE/'directory-research.json'
    previous = json.loads(output_path.read_text()) if output_path.exists() else []
    done = {(row['companyId'],row['url']) for row in previous if row['status']!='fetch_failed'} if not args.refresh else set()
    jobs = []
    names = {'energysage.com':'EnergySage','solarreviews.com':'SolarReviews','solarpowerworldonline.com':'Solar Power World','bcorporation.net':'B Lab'}
    for company_id,row in results.items():
        for link in row.get('directoryLinks',[]):
            d = domain(link['url'])
            if (company_id,link['url']) not in done and d in names:
                jobs.append((companies[company_id],link['url'],names[d],True))
    sitemap_candidates=STATE/'sitemap-candidates.json'
    queued={(job[0]['id'],job[1]) for job in jobs}
    if sitemap_candidates.exists():
        for item in json.loads(sitemap_candidates.read_text()):
            pair=(item['companyId'],item['url'])
            if pair not in done and pair not in queued:
                jobs.append((companies[item['companyId']],item['url'],item['organization'],False));queued.add(pair)
    if args.limit: jobs=jobs[:args.limit]
    def check(job):
        company,url,organization,first_party_link = job
        result={'companyId':company['id'],'companyName':company['name'],'website':company['website'],'url':url,'organization':organization,'checkedAt':now(),'firstPartyLink':first_party_link}
        try:
            if not allowed(url): return {**result,'status':'robots_disallowed'}
            actual,content,_=fetch(url)
            if domain(actual)!=domain(url): return {**result,'status':'redirect_review','finalUrl':actual}
            parser=Page();parser.feed(content)
            text,_,_=parse_page(actual,content)
            cache_key=hashlib.sha256(actual.encode()).hexdigest()
            save_json(STATE/'pages'/(cache_key+'.json'),{'url':actual,'checkedAt':now(),'text':text,'headings':parser.headings,'links':parser.links})
            matched=directory_identity(company,parser,text,first_party_link,official_texts.get(company['id'],[]))
            if not matched:return {**result,'status':'identity_review','headings':parser.headings[:5],'sourceUrl':actual,'cacheKey':cache_key}
            return {**result,'status':'profile_identity_matched','sourceUrl':actual,'cacheKey':cache_key,'matchedBy':matched,'networkDisclaimer':bool(re.search(r'not in the EnergySage network|not been screened or verified',text,re.I))}
        except Exception as error: return {**result,'status':'fetch_failed','error':str(error)[:200]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.workers,6)) as executor:
        futures=[executor.submit(check,job) for job in jobs]
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            result=future.result()
            previous=[row for row in previous if (row['companyId'],row['url'])!=(result['companyId'],result['url'])]
            previous.append(result); save_json(output_path,previous)
            if i%10==0 or i==len(jobs): print(f'Directory profiles {i}/{len(jobs)}',flush=True)
    print(json.dumps(dict(Counter(row['status'] for row in previous)),indent=2))

def sitemaps(args):
    """Name matches discover candidates only. Import still requires profile identity evidence."""
    def name_key(raw):
        raw=unicodedata.normalize('NFKD',raw).encode('ascii','ignore').decode().lower()
        words=re.sub(r'[^a-z0-9]+',' ',raw).split()
        return ''.join(w for w in words if w not in {'inc','incorporated','llc','ltd','limited','corp','corporation','co','the','reviews'})
    keys={}
    for company in load_inventory():
        for raw in [company['name'],company.get('username') or '']:
            key=name_key(raw)
            if len(key)>=6:keys.setdefault(key,{})[company['id']]=company
    candidates={}
    def locations(xml):return [e.text for e in ET.fromstring(xml).iter() if e.tag.endswith('loc') and e.text]
    sources=[('https://www.energysage.com/sitemap.xml','EnergySage',r'sitemap-suppliers\.xml'),('https://www.solarreviews.com/sitemapindex.xml','SolarReviews',r'/installers-sitemap\.xml$')]
    for index,organization,pattern in sources:
        if not allowed(index):continue
        _,content,_=fetch(index,30)
        children=[url for url in locations(content) if re.search(pattern,url)]
        for i,url in enumerate(children,1):
            try:
                if not allowed(url):continue
                _,content,_=fetch(url,30)
                for profile in locations(content):
                    path=urllib.parse.urlsplit(profile).path
                    match=re.search(r'/supplier/\d+/([^/]+)/?',path) if organization=='EnergySage' else re.search(r'/installers/([^/]+)',path)
                    if not match:continue
                    matches=keys.get(name_key(match.group(1)),{})
                    if len(matches)!=1:continue
                    company=next(iter(matches.values()))
                    candidates[(company['id'],profile)]={'companyId':company['id'],'companyName':company['name'],'website':company['website'],'url':profile,'organization':organization,'discoveredAt':now(),'matchType':'exact_normalized_name_candidate_only'}
                print(f'{organization} sitemap {i}/{len(children)}; {len(candidates)} candidate links',flush=True)
            except Exception as error:print(f'Sitemap failed: {url}: {str(error)[:160]}',flush=True)
    save_json(STATE/'sitemap-candidates.json',list(candidates.values()))
    print(f'Sitemap discovery: {len(candidates)} candidate profiles. Identity validation is still required.',flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['inventory','crawl','report','directories','sitemaps','reconcile'])
    parser.add_argument('--origin',default='https://connect.sunhubapp.com')
    parser.add_argument('--workers',type=int,default=12)
    parser.add_argument('--pages',type=int,default=3)
    parser.add_argument('--limit',type=int)
    parser.add_argument('--refresh',action='store_true')
    parser.add_argument('--publish',action='store_true')
    args=parser.parse_args()
    if not 1 <= args.workers <= 64 or not 1 <= args.pages <= 8: parser.error('Use 1–64 workers and 1–8 pages per company. Per-host throttling is always enforced.')
    STATE.mkdir(parents=True,exist_ok=True)
    {'inventory':inventory,'crawl':crawl,'report':report,'directories':directories,'sitemaps':sitemaps,'reconcile':reconcile}[args.command](args)

if __name__=='__main__': main()
