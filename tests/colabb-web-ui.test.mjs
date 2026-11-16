import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
process.env.CONNECT_WEB_UI='colabb';
process.env.NODE_ENV='test';
const {selectedWebUI,webDist,webUIRoutes}=await import('../apps/api/dist/web-ui.js');

test('frontend selection is allowlisted and keeps native clients on Connect',()=>{
 assert.equal(selectedWebUI({headers:{}}),'colabb');
 assert.equal(selectedWebUI({headers:{cookie:'connect_web_ui=connect'}}),'connect');
 assert.equal(selectedWebUI({headers:{cookie:'connect_web_ui=../../private'}}),'colabb');
 assert.equal(selectedWebUI({headers:{cookie:'unrelated=connect; connect_web_ui=colabb'}}),'colabb');
 for(const agent of ['ConnectMac/0.1.5','Mozilla/5.0 ConnectWindows/0.1.0','ConnectAndroid/0.2'])assert.equal(selectedWebUI({headers:{cookie:'connect_web_ui=colabb','user-agent':agent}}),'connect');
 process.env.CONNECT_WEB_UI='connect';assert.equal(selectedWebUI({headers:{}}),'connect');assert.equal(selectedWebUI({headers:{cookie:'connect_web_ui=colabb'}}),'colabb');process.env.CONNECT_WEB_UI='colabb';
});
test('switching is reversible, cache safe, and keeps existing hashed assets available',async()=>{
 const app=express();app.use(webUIRoutes());app.get('/',(req,res)=>res.send(selectedWebUI(req)));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  let r=await fetch(base+'/_interface/connect?returnTo=https://example.com',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');assert.match(r.headers.get('cache-control'),/no-store/);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Lax/i);assert.match(cookie,/Path=\//);assert.equal(await(await fetch(base+'/',{headers:{cookie}})).text(),'connect');
  r=await fetch(base+'/_interface/unknown',{redirect:'manual'});assert.equal(r.status,404);assert.equal(r.headers.get('set-cookie'),null);
  for(const ui of ['connect','colabb']){
   const html=await fs.readFile(webDist(ui)+'/index.html','utf8');const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(m=>m[1]);assert.ok(assets.length>=2);
   for(const asset of assets){r=await fetch(base+asset,{headers:{cookie:`connect_web_ui=${ui==='connect'?'colabb':'connect'}`}});assert.equal(r.status,200,asset);assert.match(r.headers.get('vary'),/Cookie/);assert.match(r.headers.get('vary'),/User-Agent/);await r.arrayBuffer();}
   r=await fetch(base+'/push-sw.js',{headers:{cookie:`connect_web_ui=${ui}`}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('service-worker-allowed'),'/');await r.arrayBuffer();
  }
  r=await fetch(base+'/brand/marks/lockup-primary.svg',{headers:{cookie:'connect_web_ui=connect'}});assert.equal(r.status,200);assert.match(await r.text(),/<svg/);
 }finally{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));}
});
