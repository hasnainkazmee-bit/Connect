#!/usr/bin/env python3
"""Read up to three additional official service pages for the published cohort.

Resumable, robots-aware, bounded per host. Does not publish or alter profiles.
"""
import concurrent.futures
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('research',ROOT/'tools/research-provider-capabilities.py')
research=importlib.util.module_from_spec(spec);spec.loader.exec_module(research)
spec2=importlib.util.spec_from_file_location('corrections',ROOT/'tools/build-provider-profile-corrections.py')
corrections=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(corrections)
STATE=ROOT/'.research/provider-profile-review'
old={r['companyId']:r for r in map(json.loads,filter(None,(ROOT/'.research/provider-matching/research.jsonl').read_text().split('\n')))}

def read_more(company):
 result=json.loads(json.dumps(old[company['id']]))
 seen={p['url'].rstrip('/') for p in result['pages']}
 links={}
 for p in result['pages']:
  if not p.get('cacheKey'):continue
  path=corrections.PAGES/(p['cacheKey']+'.json')
  if not path.exists():continue
  for link in json.loads(path.read_text()).get('links',[]):
   url=link['url'];parts=urlsplit(url)
   if not corrections.safe_page({'url':url},company['website']) or parts.query or url.rstrip('/') in seen:continue
   if research.IGNORE_PATH.search(parts.path):continue
   if not re.search(r'services?|residential|commercial|industrial|solar|electrical|roofing|storage|battery|installation',parts.path,re.I):continue
   score=0 if corrections.heading_category(link.get('label','')) else 1
   links[url]=(score,len(url))
 for url in sorted(links,key=links.get)[:3]:
  try:
   if not research.robots_allowed(url):
    result['pages'].append({'url':url,'status':'robots_or_access_blocked'});continue
   actual,html,mime=research.web.fetch(url,timeout=15)
   if not corrections.safe_page({'url':actual},company['website']):
    result['pages'].append({'url':url,'status':'identity_redirect_review'});continue
   if 'html' not in mime:continue
   parsed=research.extract(html,actual,company['name'])
   checked=research.web.now();digest=hashlib.sha256(html.encode()).hexdigest();key=hashlib.sha256(actual.encode()).hexdigest()
   research.web.save_json(corrections.PAGES/(key+'.json'),dict(url=actual,checkedAt=checked,contentHash=digest,**parsed))
   result['pages'].append(dict(url=actual,checkedAt=checked,contentHash=digest,title=parsed['title'],status='ok',cacheKey=key))
  except Exception as e:result['pages'].append({'url':url,'status':'fetch_failed','error':str(e)[:160]})
 result['checkedAt']=research.web.now()
 return result

def main():
 inv=json.loads((STATE/'inventory.json').read_text())
 selected={r['companyId'] for f in (ROOT/'.research/provider-publication/batches').glob('*.json') for r in json.loads(f.read_text())['records']}
 out=STATE/'research.jsonl'
 done={r['companyId'] for r in map(json.loads,filter(None,out.read_text().split('\n')))} if out.exists() else set()
 todo=[c for c in inv['companies'] if c['id'] in selected and c['id'] not in done and not c['managed']]
 with out.open('a',buffering=1) as f,concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
  futures=[pool.submit(read_more,c) for c in todo]
  for i,future in enumerate(concurrent.futures.as_completed(futures),1):
   result=future.result();f.write(json.dumps(result,ensure_ascii=False)+'\n')
   if i%50==0 or i==len(todo):print(json.dumps({'processed':i,'total':len(todo)}),flush=True)
if __name__=='__main__':main()
