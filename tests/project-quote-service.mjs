import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const base=process.env.JOBS_TEST_URL || 'http://127.0.0.1:4215';
const dbUrl=process.env.DATABASE_URL || '';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base)||!new URL(dbUrl).pathname.includes('test')) throw new Error('Use only an isolated local test database and server.');
const db=new pg.Client({connectionString:dbUrl});await db.connect();
const jobs=[],companies=[],users=[];
async function account(name,company,role='owner') {
 const slug=`quote-test-${randomUUID().slice(0,8)}`;
 const user=(await db.query("INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',now(),now()) RETURNING id",[`${slug}@example.test`,name])).rows[0].id;users.push(user);
 if(!company){company=(await db.query("INSERT INTO companies(slug,name,username,listing_status) VALUES($1,$2,$1,'managed') RETURNING id",[slug,name])).rows[0].id;companies.push(company);}
 await db.query('INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)',[user,company,role]);
 const token=randomBytes(32).toString('hex');await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),user,company]);
 return {company,user,cookie:`connect_session=${token}`};
}
async function request(path,actor,method='GET',body){const r=await fetch(base+path,{method,headers:{cookie:actor.cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
async function call(path,actor,method='GET',body,expected=200){const r=await request(path,actor,method,body);assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(r.data)}`);return r.data;}
async function upload(path,actor,expected=201){const r=await fetch(base+path,{method:'POST',headers:{cookie:actor.cookie,'content-type':'application/pdf'},body:Buffer.from('%PDF-1.4\nquote test\n%%EOF')});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
async function newJob(h){const job=await call('/jobs',h,'POST',{title:'Install commercial rooftop systems',description:'Provide a qualified installation crew and final inspection documentation.',trade:'installation',location:'Austin, TX',exactAddress:'Private project address'},201);jobs.push(job.id);return `/jobs/${job.id}`;}
const terms={amountCents:100000,startWindow:'January 2027',duration:'2 weeks',note:'Our crew will install and commission the complete rooftop system.',included:'Labor and commissioning',paymentTerms:'After completion'};
try {
 const h=await account('Quote hirer'),p=await account('Quote provider'),other=await account('Other bidder');
 const employee=await account('Company member',h.company,'member');
 const providerMember=await account('Provider member',p.company,'member');
 const path=await newJob(h);
 await call(path+'/quote',providerMember,'POST',terms,403);
 const q=await call(path+'/quote',p,'POST',{...terms,attachmentCount:1});
 assert.equal(q.pendingUploads,true);
 assert.equal((await call(path,h)).quotes.length,0);
 const pendingHistory=await call(path+`/quote-history?providerId=${p.company}`,h);
 assert.equal(pendingHistory.quote,null);assert.equal(pendingHistory.versions.length,0);assert.equal(pendingHistory.events.length,0);
 await call(path+'/choose',h,'POST',{quoteId:q.id,version:1},409);
 await call(path+`/quotes/${q.id}/publish`,p,'POST',{version:1},409);
 assert.equal(q.current_version,1);assert.equal(q.version,1);
 await assert.rejects(db.query("UPDATE job_quote_versions SET terms='{}'::jsonb WHERE quote_id=$1",[q.id]),/Quote versions cannot be changed/);
 const originalUpload=path+`/files?name=original.pdf&quoteId=${q.id}&quoteVersion=1&uploadId=${randomUUID()}`;
 const file=await upload(originalUpload,p);
 assert.equal((await upload(originalUpload,p)).id,file.id,'Lost upload responses can be retried without duplicates');
 assert.equal((await fetch(base+`/jobs/files/${file.id}`,{headers:{cookie:h.cookie}})).status,404);
 await call(path+`/quotes/${q.id}/publish`,p,'POST',{version:1});
 await call(path+`/quotes/${q.id}/publish`,p,'POST',{version:1});
 const oq=await call(path+'/quote',other,'POST',{...terms,amountCents:120000});
 await call(path+`/quote-history?providerId=${p.company}`,other,'GET',undefined,403);
 await call(path+'/quote-decision',employee,'POST',{quoteId:q.id,version:1,decision:'decline',note:'Not suitable'},403);
 await call(path+'/quote-decision',h,'POST',{quoteId:q.id,version:1,decision:'changes',note:''},400);
 await call(path+'/quote-decision',h,'POST',{quoteId:q.id,version:1,decision:'changes',note:'Please include the electrical inspection.'});
 let history=await call(path+`/quote-history?providerId=${p.company}`,p);
 assert.equal(history.quote.status,'changes_requested');assert.equal(history.permissions.canRevise,true);
 await call(path+'/quote',p,'POST',{...terms,amountCents:110000},409);
 const revised=await call(path+'/quote',p,'POST',{...terms,version:1,amountCents:110000,revisionNote:'Includes inspection',attachmentCount:1});
 assert.equal(revised.current_version,2);
 await call(path+'/choose',h,'POST',{quoteId:q.id,version:1},409);
 await upload(path+`/files?name=stale.pdf&quoteId=${q.id}&quoteVersion=1`,p,409);
 const revisedFile=await upload(path+`/files?name=revision.pdf&quoteId=${q.id}&quoteVersion=2&uploadId=${randomUUID()}`,p);
 await call(path+`/quotes/${q.id}/publish`,p,'POST',{version:2});
 history=await call(path+`/quote-history?providerId=${p.company}`,h);
 assert.equal(history.versions.length,2);assert.equal(history.versions[1].amount_cents,100000);assert.equal(history.versions[0].amount_cents,110000);
 assert.ok(history.versions.every(v=>v.files.some(f=>f.id===file.id)),'Existing attachments carry forward without changing old terms');
 assert.equal(history.versions[1].files.some(f=>f.id===revisedFile.id),false,'New attachments do not mutate an older version');
 assert.equal(history.versions[0].files.some(f=>f.id===revisedFile.id),true);
 assert.equal((await call(path,other)).files.some(f=>f.id===file.id),false,'A competing provider cannot see quote files');
 await call(path+'/quote-decision',h,'POST',{quoteId:q.id,version:2,decision:'decline',note:'The revised price exceeds our budget.'});
 await call(path+'/quote',p,'POST',{...terms,version:2},400);
 await call(path+'/quote',p,'POST',{...terms,version:2,revisionNote:'Adjusted crew scheduling reduces the price.'});
 await call(path+'/choose',h,'POST',{quoteId:q.id,version:3});
 await call(path+'/choose',h,'POST',{quoteId:oq.id,version:1},409);
 assert.equal((await call(path,other)).ownQuote.status,'not_chosen');
 const closedProvider=await request(path+'/messages',other,'POST',{body:'Can we discuss?',providerId:other.company,clientId:randomUUID()});assert.ok([403,409].includes(closedProvider.status));
 const closedHirer=await request(path+'/messages',h,'POST',{body:'Can we discuss?',providerId:other.company,clientId:randomUUID()});assert.ok([403,409].includes(closedHirer.status));
 await upload(path+`/files?name=late.pdf&quoteId=${q.id}&quoteVersion=3`,p,403);
 await call(path+'/payment-stages',h,'POST',{stages:[{title:'Before work',amountCents:100000}]});
 await call(path+'/confirm',p,'POST',{decision:'decline',quoteId:q.id,version:3,note:'Our crew is no longer available.'});
 assert.equal((await call(path,h)).paymentStages.length,0);
 assert.equal((await call(path,h)).job.status,'open');
 assert.equal((await call(path,h)).agreement,null);
 await call(path+'/quote',p,'POST',{...terms,version:3,revisionNote:'We have secured a replacement crew.'});
 await call(path+'/choose',h,'POST',{quoteId:q.id,version:4});
 await call(path+'/confirm',p,'POST',{decision:123},400);
 await call(path+'/confirm',p,'POST',{decision:'accept',quoteId:q.id,version:3},409);
 await call(path+'/confirm',p,'POST',{decision:'accept',quoteId:oq.id,version:4},409);
 await call(path+'/confirm',p,'POST',{decision:'accept',quoteId:q.id,version:4});
 await call(path+`/quotes/${q.id}/publish`,p,'POST',{version:1});
 let detail=await call(path,h);assert.equal(detail.job.status,'in_progress');assert.equal(detail.selected.accepted_version,4);assert.equal(detail.agreement.amount_cents,100000);
 await call(path+'/payment-stages',h,'POST',{stages:[{title:'Final work',amountCents:100000}]});
 let change=await call(path+'/changes',p,'POST',{title:'Additional electrical inspection',scope:'Include the additional electrical inspection requested on site.',amountDeltaCents:20000,agreementVersion:1},201);
 await call(path+`/changes/${change.id}/decision`,p,'POST',{decision:'accept'},403);
 await call(path+`/changes/${change.id}/decision`,employee,'POST',{decision:'accept'},403);
 await call(path+'/updates',p,'POST',{kind:'completion',body:'The work is finished.'},409);
 await call(path+`/changes/${change.id}/decision`,h,'POST',{decision:'decline',note:'Keep the original scope for now.'});
 change=await call(path+'/changes',p,'POST',{title:'Extra roof section',scope:'Install the additional roof section approved by the site manager.',amountDeltaCents:15000,agreementVersion:1},201);
 await call(path+`/changes/${change.id}/decision`,h,'POST',{decision:'accept'});
 detail=await call(path,h);assert.equal(detail.agreement.amount_cents,115000);assert.equal(detail.agreement.revision,2);assert.equal(detail.selected.amount_cents,100000);assert.equal(detail.paymentStagesNeedReview,true);
 await call(path+`/payment-stages/${detail.paymentStages[0].id}`,p,'POST',{status:'invoiced',invoiceReference:'INV-TEST'},409);
 await call(path+'/changes',p,'POST',{title:'Stale proposal',scope:'This proposal refers to an outdated agreement.',amountDeltaCents:100,agreementVersion:1},409);
 await call(path+'/payment-stages',h,'POST',{stages:[{title:'Final work',amountCents:115000}]});
 detail=await call(path,h);assert.equal(detail.paymentStagesNeedReview,false);
 await call(path+`/payment-stages/${detail.paymentStages[0].id}`,p,'POST',{status:'invoiced',invoiceReference:'INV-TEST'});
 await call(path+'/changes',p,'POST',{title:'Invoiced price change',scope:'The existing invoice must not be silently changed.',amountDeltaCents:100,agreementVersion:2},409);
 await call(path+'/updates',p,'POST',{kind:'progress',body:'All roof sections are complete.'},201);
 const completion=await call(path+'/updates',p,'POST',{kind:'completion',body:'Final inspection passed and work is ready for review.',attachmentCount:1},201);
 assert.equal((await call(path,h)).job.status,'in_progress');
 assert.equal((await call(path,h)).updates.some(u=>u.id===completion.id),false);
 await call(path+'/review-work',h,'POST',{decision:'accept',updateId:completion.id},409);
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{},409);
 const updateUpload=path+`/files?name=inspection.pdf&updateId=${completion.id}&uploadId=${randomUUID()}`;
 const completionFile=await upload(updateUpload,p);
 assert.equal((await upload(updateUpload,p)).id,completionFile.id);
 assert.equal((await fetch(base+`/jobs/files/${completionFile.id}`,{headers:{cookie:h.cookie}})).status,404);
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{});
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{});
 assert.equal((await call(path,h)).job.status,'review');
 assert.equal((await fetch(base+`/jobs/files/${completionFile.id}`,{headers:{cookie:h.cookie}})).status,200);
 assert.equal((await fetch(base+`/jobs/files/${completionFile.id}`,{headers:{cookie:other.cookie}})).status,404);
 assert.equal((await call(path,other)).files.some(f=>f.id===completionFile.id),false);
 await call(path+'/review-work',h,'POST',{decision:'changes',updateId:completion.id,note:'Please send the final inspection certificate.'});
 const finalCompletion=await call(path+'/updates',p,'POST',{kind:'completion',body:'The inspection certificate is ready.'},201);
 await call(path+'/review-work',h,'POST',{decision:'accept',updateId:completion.id},409);
 await call(path+'/review-work',h,'POST',{decision:'accept',updateId:finalCompletion.id,note:'Thank you for completing the project.'});
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{});
 assert.equal((await upload(updateUpload,p)).id,completionFile.id,'Completed update upload retries remain idempotent');
 history=await call(path+`/quote-history?providerId=${p.company}`,p);
 assert.equal(history.events.filter(e=>e.update_id===completion.id).length,1);
 assert.equal(history.events.filter(e=>e.kind==='quote_submitted'&&e.quote_id===q.id&&e.quote_version===1).length,1);
 for(const kind of ['quote_submitted','quote_revised','quote_changes_requested','quote_declined','company_chosen','award_declined','award_accepted','change_proposed','change_declined','change_accepted','progress','work_submitted','work_changes_requested','work_accepted'])assert.ok(history.events.some(e=>e.kind===kind),`${kind} recorded in private history`);
 assert.equal(history.quote.current_version,4);assert.equal(history.quote.accepted_version,4);
 assert.equal(history.versions.find(v=>v.version===1).amount_cents,100000);
 // Expiring while attachments upload must not allow a late submission.
 const expiredPath=await newJob(h);
 const expiredQuote=await call(expiredPath+'/quote',p,'POST',{...terms,attachmentCount:1});
 await upload(expiredPath+`/files?name=late-plan.pdf&quoteId=${expiredQuote.id}&quoteVersion=1&uploadId=${randomUUID()}`,p);
 await db.query("UPDATE jobs SET quote_deadline=now()-interval '1 second' WHERE id=$1",[expiredPath.split('/').at(-1)]);
 await call(expiredPath+`/quotes/${expiredQuote.id}/publish`,p,'POST',{version:1},409);
 // Choosing and revising the same version concurrently must never accept unseen terms.
 const racePath=await newJob(h);const raceQ=await call(racePath+'/quote',p,'POST',terms);
 const results=await Promise.all([request(racePath+'/choose',h,'POST',{quoteId:raceQ.id,version:1}),request(racePath+'/quote',p,'POST',{...terms,version:1,amountCents:999999})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const raceDetail=await call(racePath,h);
 if(raceDetail.job.status==='awarded'){assert.equal(raceDetail.selected.amount_cents,100000);assert.equal(raceDetail.selected.accepted_version,1);}else{assert.equal(raceDetail.quotes[0].current_version,2);assert.equal(raceDetail.job.status,'open');}
 // A new provider must never inherit private problem reports from a declined award.
 const privatePath=await newJob(h);
 const firstPrivate=await call(privatePath+'/quote',p,'POST',terms);
 await call(privatePath+'/choose',h,'POST',{quoteId:firstPrivate.id,version:1});
 const privateUpdate=await call(privatePath+'/activity',p,'POST',{kind:'problem',body:'Private crew availability issue before starting.'},201);
 await call(privatePath+'/confirm',p,'POST',{decision:'decline',quoteId:firstPrivate.id,version:1,note:'We cannot staff the project.'});
 const secondPrivate=await call(privatePath+'/quote',other,'POST',terms);
 await call(privatePath+'/choose',h,'POST',{quoteId:secondPrivate.id,version:1});
 await call(privatePath+'/confirm',other,'POST',{decision:'accept',quoteId:secondPrivate.id,version:1});
 assert.equal((await call(privatePath,other)).updates.some(u=>u.id===privateUpdate.id),false);
 assert.equal((await call(privatePath,p)).updates.some(u=>u.id===privateUpdate.id),true);
 assert.equal((await call(privatePath,h)).updates.some(u=>u.id===privateUpdate.id),true);
 // Saturate the 10-connection pool. Locked upload transactions must not need a second pool connection.
 const bulkPath=await newJob(h);
 const bulkQuote=await call(bulkPath+'/quote',p,'POST',{...terms,attachmentCount:12});
 const started=Date.now();
 await Promise.all(Array.from({length:12},(_,i)=>upload(bulkPath+`/files?name=plan-${i}.pdf&quoteId=${bulkQuote.id}&quoteVersion=1&uploadId=${randomUUID()}`,p)));
 assert.ok(Date.now()-started<5000,'Parallel uploads must finish without starving the database pool');
 await call(bulkPath+`/quotes/${bulkQuote.id}/publish`,p,'POST',{version:1});
 assert.equal((await call(bulkPath,h)).files.length,12);
 // A refreshed editor may supersede a partial unpublished draft, retaining its completed attachment.
 const draftPath=await newJob(h);
 const draftQuote=await call(draftPath+'/quote',p,'POST',{...terms,attachmentCount:2});
 const retained=await upload(draftPath+`/files?name=retained.pdf&quoteId=${draftQuote.id}&quoteVersion=1&uploadId=${randomUUID()}`,p);
 await call(draftPath+'/quote',p,'POST',{...terms,version:1,revisionNote:'Send the uploaded plan only.'});
 const draftHistory=await call(draftPath+`/quote-history?providerId=${p.company}`,h);
 assert.deepEqual(draftHistory.versions.map(v=>v.version),[2]);
 assert.equal(draftHistory.versions[0].files[0].id,retained.id);
 assert.equal((await fetch(base+`/jobs/files/${retained.id}`,{headers:{cookie:h.cookie}})).status,200);
 console.log('Project quote workflow passed: private version history, decisions, stale/racing approvals, closed threads, agreement changes, payment safety and completion events.');
} finally {
 await db.query('UPDATE jobs SET chosen_quote_id=NULL WHERE id=ANY($1::uuid[])',[jobs]);
 await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
 await db.query('DELETE FROM companies WHERE id=ANY($1::uuid[])',[companies]);
 await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
 await db.end();
}
