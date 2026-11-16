import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';

const fixturePath=process.env.COLABB_UI_FIXTURES;
if(!fixturePath)throw Error('Provide an isolated local COLABB_UI_FIXTURES file.');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(fixture.base))throw Error('Local UI only.');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--disable-quic']});
const errors=[];
const contexts={};
async function post(actor,path,data){const r=await contexts[actor].request.post(fixture.base+'/api/jobs'+path,{headers:{Origin:fixture.base},data});assert.ok(r.ok(),await r.text());return r.json();}
const proof={name:'local-test-proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=','base64')};
try{
 for(const actor of ['hirer','provider','other']){const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts[actor]=context;const r=await context.request.post(fixture.base+'/api/auth/login',{headers:{Origin:fixture.base},data:{email:fixture.accounts[actor].email,password:fixture.password}});assert.equal(r.status(),200);}
 const taskId=randomUUID();
 const job=await post('hirer','',{title:'QA — Checklist proof review',description:'Local isolated interaction check for proof upload, requested changes and approval. No real work or payment.',trade:'electrical',location:'Austin, TX',budgetCents:100000,workChecklist:[{id:taskId,title:'Provide commissioning test evidence'}]});
 const quote=await post('provider',`/${job.id}/quote`,{note:'Our local test company will submit the commissioning evidence for this isolated workflow check.',amountCents:100000,startWindow:'Next week',duration:'One day'});
 await post('hirer',`/${job.id}/choose`,{quoteId:quote.id,version:quote.version});
 await post('provider',`/${job.id}/confirm`,{quoteId:quote.id,version:quote.version,decision:'accept'});
 const url=fixture.base+`/jobs/${job.id}#work-checklist`;
 const provider=await contexts.provider.newPage(),hirer=await contexts.hirer.newPage(),other=await contexts.other.newPage();
 for(const p of [provider,hirer,other])p.on('pageerror',e=>errors.push(e.message));
 await provider.goto(url);
 await expect(provider.getByRole('button',{name:'Send for approval',exact:true})).toBeDisabled();
 await provider.getByLabel('Add proof files or photos',{exact:true}).setInputFiles(proof);
 await provider.getByLabel('Note Optional',{exact:true}).fill('Initial local test evidence.');
 await provider.getByRole('button',{name:'Send for approval',exact:true}).click();
 await expect(provider.getByText('Proof sent for approval.',{exact:true})).toBeVisible();
 await expect(provider.getByRole('button',{name:'Approve task',exact:true})).toHaveCount(0);
 await hirer.goto(url);
 await expect(hirer.getByRole('button',{name:'Send for approval',exact:true})).toHaveCount(0);
 await hirer.getByRole('button',{name:'Preview local-test-proof.png',exact:true}).click();
 await expect(hirer.getByRole('region',{name:'Attachment preview'})).toBeVisible();
 await hirer.getByRole('button',{name:'Close preview',exact:true}).click();
 await hirer.getByRole('button',{name:'Request changes',exact:true}).click();
 await hirer.getByLabel('What needs to change?',{exact:true}).fill('Include the final inspection reading.');
 await hirer.getByRole('button',{name:'Send feedback',exact:true}).click();
 await expect(hirer.getByText('Changes requested. The company can send updated proof.',{exact:true})).toBeVisible();
 await provider.reload();
 await expect(provider.getByText('Include the final inspection reading.',{exact:true})).toBeVisible();
 await provider.getByLabel('Add proof files or photos',{exact:true}).setInputFiles({...proof,name:'revised-local-proof.png'});
 await provider.getByLabel('Note Optional',{exact:true}).fill('Revised local test evidence includes the final reading.');
 await provider.getByRole('button',{name:'Send for approval',exact:true}).click();
 await expect(provider.getByText('Proof sent for approval.',{exact:true})).toBeVisible();
 await hirer.reload();
 await hirer.getByRole('button',{name:'Approve task',exact:true}).click();
 await expect(hirer.getByText(/This task is complete\./)).toBeVisible();
 const detail=await(await contexts.hirer.request.get(fixture.base+`/api/jobs/${job.id}`)).json();
 assert.equal(detail.job.work_checklist[0].status,'approved');
 assert.equal(detail.job.work_checklist[0].proofFiles.length,1);
 await other.goto(url);
 await expect(other.getByRole('button',{name:'Send for approval',exact:true})).toHaveCount(0);
 await expect(other.getByRole('button',{name:'Approve task',exact:true})).toHaveCount(0);
 await hirer.screenshot({path:'/private/tmp/colabb-proof-review-verified.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Proof review UI passed: required attachment, awarded-company-only submission, full-screen preview, requested changes, resubmission and hirer approval.');
}finally{await browser.close();}
