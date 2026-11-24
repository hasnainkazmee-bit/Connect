#!/usr/bin/env python3
"""Read official sites for a reconciled event list; never publish crawler output.

Input contains company names/domains only, never the contact/outreach columns.
Uses the provider crawler's robots, redirect, TLS and per-host rate safeguards.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('providers', ROOT / 'tools/research-provider-capabilities.py')
providers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(providers)

class BrandMetadata(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.logos, self.descriptions = url, [], []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('name') or a.get('property')) in ('description', 'og:description'):
            self.descriptions.append(a.get('content', ''))
        if tag == 'img' and 'logo' in ' '.join(a.get(k, '') for k in ('alt','class','id','src')).lower():
            raw = a.get('src') or a.get('data-src') or ''
            if raw and not raw.startswith('data:'):
                self.logos.append({'url':urljoin(self.url, raw),'alt':a.get('alt','')})

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--workers', type=int, default=12)
    p.add_argument('--pages', type=int, default=4)
    a = p.parse_args()
    state = Path(a.output)
    state.mkdir(parents=True, exist_ok=True)
    providers.STATE = providers.web.STATE = state
    original_extract = providers.extract
    def extract(body, url, name):
        parsed = original_extract(body, url, name)
        metadata = BrandMetadata(url)
        metadata.feed(body)
        return {**parsed, 'logoCandidates':metadata.logos[:12], 'metaDescriptions':metadata.descriptions}
    providers.extract = extract
    items = json.loads(Path(a.input).read_text())
    log = state / 'research.jsonl'
    done = {r['companyId']:r for r in providers.web.read_crawl_log(log)}
    records = [{'id':r['domain'],'name':r['name'],'website':'https://'+r['domain'], 'is_demo':False} for r in items]
    todo = [r for r in records if r['id'] not in done]
    with log.open('a', buffering=1) as out, concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(a.workers,16))) as executor:
        futures = {executor.submit(providers.crawl, r, max(1,min(a.pages,5)), {}):r for r in todo}
        for i, future in enumerate(concurrent.futures.as_completed(futures),1):
            result = future.result()
            done[result['companyId']] = result
            out.write(json.dumps(result,ensure_ascii=False)+'\n')
            if i%25 == 0 or i == len(todo):
                print(json.dumps({'processed':len(done),'total':len(records),'status':dict(Counter(r['status'] for r in done.values()))}),flush=True)
    providers.web.save_json(state/'summary.json',{'processed':len(done),'total':len(records),'status':dict(Counter(r['status'] for r in done.values()))})

if __name__ == '__main__': main()
