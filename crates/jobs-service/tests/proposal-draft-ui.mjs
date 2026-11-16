import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

const fixturePath=process.env.COLABB_UI_FIXTURES;
if(!fixturePath)throw Error('Provide an isolated local COLABB_UI_FIXTURES file.');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(fixture.base))throw Error('Local UI only.');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--disable-quic']});
const contexts=[];
const errors=[];
async function login(key){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
 const response=await context.request.post(fixture.base+'/api/auth/login',{headers:{Origin:fixture.base},data:{email:fixture.accounts[key].email,password:fixture.password}});
 assert.equal(response.status(),200,await response.text());return context;
}
try{
 const provider=await login('provider'),other=await login('other'),hirer=await login('hirer');
 const fresh=await hirer.request.post(fixture.base+'/api/jobs',{headers:{Origin:fixture.base},data:{title:'QA — Commercial rooftop proposal draft workflow',description:'A local isolated test job for electrical installation and commissioning. Submit the required inspection documents and coordinate the crew.',trade:'electrical',location:'Austin, TX',budgetCents:4200000}});
 assert.equal(fresh.status(),201,await fresh.text());
 const jobId=(await fresh.json()).id;
 const path=`/api/jobs/${jobId}`;
 const old=await(await provider.request.get(fixture.base+path+'/proposal-draft')).json();
 if(old.draft)await provider.request.delete(fixture.base+path+`/proposal-draft?version=${old.draft.version}`,{headers:{Origin:fixture.base}});
 const page=await provider.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${fixture.base}/jobs/${jobId}?action=quote`);
 const proposal=page.locator('#quote-proposal-text');
 await expect(proposal).toBeVisible();
 await proposal.fill('Our commercial electrical crew can take on this installation. Draft text for review.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Draft saved for your company. It has not been sent.')).toBeVisible();
 const persisted=await(await provider.request.get(fixture.base+path+'/proposal-draft')).json();
 assert.equal(persisted.draft.body.amountCents,null,'Partial pricing is saveable');
 assert.equal((await(await other.request.get(fixture.base+path+'/proposal-draft')).json()).draft,null);
 assert.equal((await hirer.request.get(fixture.base+path+'/proposal-draft')).status(),403);
 await page.locator('.jobs-top-nav a[href="/jobs"]').click();
 await expect(page).toHaveURL(/\/jobs$/);
 await expect(page.getByText('You have unsaved changes.')).toHaveCount(0);
 await page.goto(`${fixture.base}/jobs/${jobId}?action=quote`);
 await expect(proposal).toHaveValue(persisted.draft.body.note);
 await expect(page.getByText(/Saved proposal restored/)).toBeVisible();

 // Another company administrator updates the same draft while this form is open.
 const team=await login('provider');
 const concurrent=await team.request.put(fixture.base+path+'/proposal-draft',{headers:{Origin:fixture.base},data:{version:persisted.draft.version,body:{...persisted.draft.body,note:'Updated by the team: include commissioning and inspection support.'}}});
 assert.equal(concurrent.status(),200);
 await proposal.fill('Local edits must survive a stale save response.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'This draft was changed by your team'})).toBeVisible();
 await expect(proposal).toHaveValue('Local edits must survive a stale save response.');
 await page.getByRole('button',{name:'Load saved draft',exact:true}).click();
 await expect(proposal).toHaveValue('Updated by the team: include commissioning and inspection support.');
 await page.getByLabel('Add proposal files or photos',{exact:true}).setInputFiles({name:'draft-proof.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nQA proof\n%%EOF')});
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Proposal text saved. Selected files stay on this device until you send.')).toBeVisible();
 await page.locator('.jobs-top-nav a[href="/jobs"]').click();
 await expect(page.getByText('You have unsaved changes.')).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await page.getByRole('button',{name:'Remove draft-proof.pdf',exact:true}).click();
  await page.getByLabel('Earliest start',{exact:true}).fill('In two weeks');
  await page.getByLabel('Estimated duration',{exact:true}).fill('Three weeks');
  await page.getByLabel('Total quote in USD',{exact:true}).fill('42000');
 await page.getByRole('button',{name:'Send quote',exact:true}).click();
 await expect(page.getByText('Quote sent',{exact:true})).toBeVisible();
 assert.equal((await(await provider.request.get(fixture.base+path+'/proposal-draft')).json()).draft,null);
 const sent=await(await hirer.request.get(fixture.base+path)).json();
 assert.equal(sent.quotes.length,1);assert.equal(sent.quotes[0].note,'Updated by the team: include commissioning and inspection support.');
 assert.equal(sent.quotes[0].amount_cents,4200000);
 await expect(page.getByText('You have unsaved changes.')).toHaveCount(0);
 await page.screenshot({path:'/private/tmp/colabb-proposal-draft-verified.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Proposal draft UI passed: partial save, clean leave, restored text, company privacy, concurrent conflict, explicit reload, attachment warning/guard and successful publish.');
}finally{for(const context of contexts)await context.close();await browser.close();}
