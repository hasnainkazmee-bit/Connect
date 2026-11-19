/** Read-only public release smoke check. Does not request private data. */
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]||'https://connect.sunhubapp.com').origin;
const get=async path=>{const response=await fetch(origin+path,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,path);return response;};
const xml=await(await get('/sitemap.xml')).text();
const urls=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>new URL(m[1]));
assert(urls.length>0);assert(urls.every(u=>u.origin===origin&&!u.search&&!u.hash));
const services=urls.filter(u=>u.pathname.startsWith('/services/'));
const profiles=urls.filter(u=>/^\/[a-z0-9-]+$/.test(u.pathname)&&!['/hire','/find-work','/how-it-works','/our-story','/network','/providers','/jobs','/services','/help'].includes(u.pathname));
const paths=[...new Set(['/', '/providers','/services','/help/payments',...profiles.slice(0,2).map(u=>u.pathname),...services.slice(0,3).map(u=>u.pathname),...(services.some(u=>u.pathname==='/services/solar-installation/ohio')?['/services/solar-installation/ohio']:[])])];
for(const path of paths){
 const response=await get(path),html=await response.text();
 assert(html.includes('<h1'),path+' has a readable heading');
 assert.equal(html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1],origin+path,path+' canonical');
 assert(!response.headers.get('x-robots-tag')?.includes('noindex'),path+' indexable');
 const schemas=[...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
 assert.equal(schemas.length,1);assert(JSON.parse(schemas[0][1])['@graph']);
 assert(html.includes('property="og:image"'));assert(html.includes('name="twitter:card"'));
}
const robots=await(await get('/robots.txt')).text();assert(robots.includes('Sitemap: '+origin+'/sitemap.xml'));assert(robots.includes('Allow: /api/company-assets/'));
const image=await get('/brand/colabb-social-preview.png');assert(image.headers.get('content-type')?.includes('image/png'));
const png=Buffer.from(await image.arrayBuffer());assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
for(const path of ['/services/not-a-service','/help/not-a-topic'])assert.equal((await fetch(origin+path)).status,404);
const privatePage=await get('/network/communities');assert(privatePage.headers.get('x-robots-tag')?.includes('noindex'));
console.log(JSON.stringify({origin,sitemapUrls:urls.length,companyProfiles:profiles.length,servicePages:services.length,checkedPages:paths,cleanUrls:true,socialImage:'1200x630',privatePages:'noindex',status:'passed'},null,2));
