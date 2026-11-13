import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
const base=process.env.JOBS_TEST_URL||'http://127.0.0.1:4235';
const url=process.env.DATABASE_URL||'';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base)||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.includes('test'))throw new Error('Use only an isolated local test database and service.');
const db=new pg.Client({connectionString:url});await db.connect();
const jobs=[],companies=[],users=[];let checks=0;
async function account(name,company,role='owner',verified=true){
 const slug=`checklist-test-${randomUUID().slice(0,8)}`;
 const user=(await db.query("INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',CASE WHEN $3 THEN now() ELSE NULL END,now()) RETURNING id",[slug+'@example.test',name,verified])).rows[0].id;users.push(user);
 if(!company){company=(await db.query("INSERT INTO companies(slug,name,username,listing_status) VALUES($1,$2,$1,'managed') RETURNING id",[slug,name])).rows[0].id;companies.push(company);}
 await db.query('INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)',[user,company,role]);
 const token=randomBytes(32).toString('hex');await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),user,company]);
 return {company,user,cookie:`connect_session=${token}`};
}
async function request(path,actor,method='GET',body){const r=await fetch(base+path,{method,headers:{...(actor?{cookie:actor.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
async function call(path,actor,method='GET',body,expected=200){const r=await request(path,actor,method,body);assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(r.data)}`);checks++;return r.data;}
async function upload(path,actor,expected=201){const r=await fetch(base+path,{method:'POST',headers:{...(actor?{cookie:actor.cookie}:{}),'content-type':'application/pdf'},body:Buffer.from('%PDF-1.4\nchecklist proof test\n%%EOF')});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));checks++;return data;}
const brief={title:'Install commercial rooftop equipment',description:'Install the mounting system and electrical equipment, then provide final inspection proof.',trade:'installation',location:'Austin, TX'};
const terms={amountCents:150000,note:'Our team will provide the complete installation and inspection documents.',startWindow:'In two weeks',duration:'One week'};
const tasks=[{id:randomUUID(),title:'Install the mounting system'},{id:randomUUID(),title:'Complete the electrical inspection'}];
async function create(h,extra={}){const j=await call('/jobs',h,'POST',{...brief,...extra},201);jobs.push(j.id);return '/jobs/'+j.id;}
async function start(path,h,p){const q=await call(path+'/quote',p,'POST',terms);await call(path+'/choose',h,'POST',{quoteId:q.id,version:1});await call(path+'/confirm',p,'POST',{decision:'accept',quoteId:q.id,version:1});return q;}
async function current(path,a){return(await call(path,a)).job;}
async function prepare(path,p,item,extra={}){const j=await current(path,p);const body={version:j.checklist_version,clientId:randomUUID(),attachmentCount:1,note:'The attached file shows the finished task.',...extra};const r=await call(path+`/checklist/${item}/submissions`,p,'POST',body,201);return{...r,body};}
async function proof(path,p,item){const r=await prepare(path,p,item);const file=await upload(path+`/files?updateId=${r.updateId}&uploadId=${randomUUID()}&name=proof.pdf`,p);await call(path+`/updates/${r.updateId}/publish`,p,'POST',{});return{...r,file};}
async function review(path,h,item,s,decision,note=''){const j=await current(path,h);return call(path+`/checklist/${item}/review`,h,'POST',{version:j.checklist_version,submissionId:s,decision,note});}
try{
 const h=await account('Checklist hirer'),p=await account('Checklist provider'),other=await account('Checklist competitor');
 const hm=await account('Hirer employee',h.company,'member'),pm=await account('Provider employee',p.company,'member'),pu=await account('Unverified provider',p.company,'admin',false);
 await call('/jobs',hm,'POST',{...brief,workChecklist:tasks},403);
 for(const workChecklist of [null,{},'bad',[{}],[{...tasks[0],id:'bad'}],[{...tasks[0],title:''}],[{...tasks[0],title:'x'.repeat(301)}],[{...tasks[0],title:'bad\0text'}],[tasks[0],{...tasks[0],id:tasks[0].id.toUpperCase()}],Array.from({length:31},()=>({...tasks[0],id:randomUUID()}))])await call('/jobs',h,'POST',{...brief,workChecklist},400);
 const path=await create(h,{workChecklist:tasks.map(t=>({...t,id:t.id.toUpperCase(),title:' '+t.title+' ',completed:true,status:'approved'}))});
 let j=await current(path,h);assert.equal(j.work_checklist[0].completed,false);assert.equal(j.work_checklist[0].status,'todo');assert.equal(j.checklist_version,1);assert.equal(j.work_checklist[0].id,tasks[0].id);
 assert.deepEqual((await current(path,null)).work_checklist,tasks);
 await call(path,h,'PATCH',brief);assert.equal((await current(path,h)).checklist_version,1);
 await call(path,h,'PATCH',{...brief,workChecklist:tasks});assert.equal((await current(path,h)).checklist_version,1);
 await call(path,h,'PATCH',{...brief,workChecklist:[tasks[1],tasks[0]]});assert.equal((await current(path,h)).checklist_version,2);
 await call(path,h,'PATCH',{...brief,workChecklist:tasks});
 await call(path+`/checklist/${tasks[0].id}/submissions`,p,'POST',{version:3,clientId:randomUUID(),attachmentCount:1},403);
 const q=await call(path+'/quote',p,'POST',terms);await call(path+'/quote',other,'POST',terms);
 await call(path,h,'PATCH',{...brief,workChecklist:[]},409);
 await call(path+'/choose',h,'POST',{quoteId:q.id,version:1});
 await call(path+`/checklist/${tasks[0].id}/submissions`,p,'POST',{version:3,clientId:randomUUID(),attachmentCount:1},409);
 await call(path+'/confirm',p,'POST',{decision:'accept',quoteId:q.id,version:1});
 const createPath=path+`/checklist/${tasks[0].id}/submissions`;
 for(const actor of [h,other,pm,pu])await call(createPath,actor,'POST',{version:3,clientId:randomUUID(),attachmentCount:1},403);
 await call(createPath,null,'POST',{version:3,clientId:randomUUID(),attachmentCount:1},401);
 for(const bad of [{attachmentCount:0},{attachmentCount:21},{note:null},{note:'x'.repeat(3001)},{clientId:'bad'},{version:0},{version:'3'}])await call(createPath,p,'POST',{version:3,clientId:randomUUID(),attachmentCount:1,...bad},400);
 await call(createPath,p,'POST',{version:2,clientId:randomUUID(),attachmentCount:1},409);
 await call(path+'/updates',p,'POST',{kind:'completion',body:'All work finished'},409);
 const cancelPath=createPath+'/cancel';
 await call(cancelPath,p,'POST',{clientId:randomUUID()});
 const emptyDraft=await prepare(path,p,tasks[0].id);
 await call(cancelPath,p,'POST',{clientId:emptyDraft.body.clientId});
 await call(createPath,p,'POST',emptyDraft.body,409);
 const abandoned=await prepare(path,p,tasks[0].id,{attachmentCount:2});
 const abandonedFile=await upload(path+`/files?updateId=${abandoned.updateId}&uploadId=${randomUUID()}&name=discarded.pdf`,p);
 for(const actor of [h,other,pm])await call(cancelPath,actor,'POST',{clientId:abandoned.body.clientId},403);
 await call(cancelPath,p,'POST',{clientId:abandoned.body.clientId});await call(cancelPath,p,'POST',{clientId:abandoned.body.clientId});
 await call(createPath,p,'POST',abandoned.body,409);
 await upload(path+`/files?updateId=${abandoned.updateId}&uploadId=${randomUUID()}&name=discarded.pdf`,p,409);
 await call(path+`/updates/${abandoned.updateId}/publish`,p,'POST',{},409);
 assert.equal((await fetch(base+`/jobs/files/${abandonedFile.id}`,{headers:{cookie:h.cookie}})).status,404);
 assert.equal((await call(path,h)).updates.some(x=>x.id===abandoned.updateId),false);
 const secondPending=await prepare(path,p,tasks[1].id);
 const competingDraft=await prepare(path,p,tasks[0].id);
 await upload(path+`/files?updateId=${competingDraft.updateId}&uploadId=${randomUUID()}&name=competing.pdf`,p);
 const s=await prepare(path,p,tasks[0].id,{attachmentCount:2});
 assert.equal((await call(createPath,p,'POST',{...s.body,version:1},201)).submissionId,s.submissionId,'Lost prepare response retries before version check');
 await call(createPath,p,'POST',{...s.body,note:'different'},409);
 await call(path+`/updates/${s.updateId}/publish`,p,'POST',{},409);
 const up=path+`/files?updateId=${s.updateId}&uploadId=${randomUUID()}&name=proof.pdf`;
 const f=await upload(up,p);assert.equal((await upload(up,p)).id,f.id,'Upload retries are idempotent');
 for(const actor of [h,other,pm,null])await upload(path+`/files?updateId=${s.updateId}&uploadId=${randomUUID()}&name=unauthorized.pdf`,actor,actor?403:401);
 await call(path+`/updates/${s.updateId}/publish`,p,'POST',{},409);
 assert.equal((await current(path,h)).work_checklist[0].status,'todo');assert.equal((await call(path,h)).updates.some(x=>x.id===s.updateId),false);
 for(const actor of [h,other])assert.equal((await fetch(base+`/jobs/files/${f.id}`,{headers:{cookie:actor.cookie}})).status,404);
 await upload(path+`/files?updateId=${s.updateId}&uploadId=${randomUUID()}&name=inspection.pdf`,p);
 for(const actor of [h,other,pm,null])await call(path+`/updates/${s.updateId}/publish`,actor,'POST',{},actor?403:401);
 await call(path+`/updates/${s.updateId}/publish`,p,'POST',{});await call(path+`/updates/${s.updateId}/publish`,p,'POST',{});
 await call(cancelPath,p,'POST',{clientId:s.body.clientId},409);
 await call(path+`/updates/${competingDraft.updateId}/publish`,p,'POST',{},409);
 await call(cancelPath,p,'POST',{clientId:competingDraft.body.clientId});
 j=await current(path,h);assert.equal(j.work_checklist[0].status,'submitted');assert.equal(j.work_checklist[0].completed,false);assert.equal(j.work_checklist[0].proofFiles.length,2);
 assert.deepEqual((await current(path,other)).work_checklist,tasks);assert.equal(JSON.stringify(await call(path,other)).includes(s.submissionId),false);
 assert.equal((await fetch(base+`/jobs/files/${f.id}`,{headers:{cookie:h.cookie}})).status,200);assert.equal((await fetch(base+`/jobs/files/${f.id}`,{headers:{cookie:other.cookie}})).status,404);
 const competitorHistory=await call(path+'/quote-history',other);
 assert.equal(JSON.stringify(competitorHistory).includes(s.submissionId),false);
 assert.equal(JSON.stringify(competitorHistory).includes(s.body.note),false);
 assert.equal((await db.query("SELECT url FROM user_notifications WHERE user_id=$1 AND title='Task ready for approval' ORDER BY created_at DESC LIMIT 1",[h.user])).rows[0]?.url,path+'#work-checklist');
 const rev=path+`/checklist/${tasks[0].id}/review`,decision={version:j.checklist_version,submissionId:s.submissionId,decision:'approve'};
 for(const actor of [p,other,hm])await call(rev,actor,'POST',decision,403);
 await call(rev,h,'POST',{...decision,submissionId:randomUUID()},409);await call(rev,h,'POST',{...decision,decision:'changes',note:''},400);
 const races=await Promise.all([request(rev,h,'POST',decision),request(rev,h,'POST',decision)]);assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
 j=await current(path,h);assert.equal(j.work_checklist[0].completed,true);assert.equal(j.work_checklist[0].status,'approved');
 await review(path,h,tasks[0].id,s.submissionId,'changes','Please show the completed fastening inspection.');
 j=await current(path,p);assert.equal(j.work_checklist[0].completed,false);assert.equal(j.work_checklist[0].proofFiles.length,2);assert.ok(j.work_checklist[0].reviewNote.includes('fastening'));
 const fresh=await prepare(path,p,tasks[0].id);await call(path+`/updates/${fresh.updateId}/publish`,p,'POST',{},409);
 await upload(path+`/files?updateId=${s.updateId}&uploadId=${randomUUID()}&name=mutate-old.pdf`,p,409);
 const newFile=await upload(path+`/files?updateId=${fresh.updateId}&uploadId=${randomUUID()}&name=new-proof.pdf`,p);await call(path+`/updates/${fresh.updateId}/publish`,p,'POST',{});
 await call(rev,h,'POST',{version:(await current(path,h)).checklist_version,submissionId:s.submissionId,decision:'approve'},409);
 await review(path,h,tasks[0].id,fresh.submissionId,'approve');
 j=await current(path,h);assert.deepEqual(j.work_checklist[0].proofFiles.map(f=>f.id),[newFile.id]);assert.equal((await call(path,h)).updates.filter(u=>[s.updateId,fresh.updateId].includes(u.id)).length,2,'Both proof submissions retained');
 const second=secondPending;
 assert.equal((await call(path+`/checklist/${tasks[1].id}/submissions`,p,'POST',second.body,201)).submissionId,second.submissionId,'Other task progress must not invalidate a prepared submission');
 await upload(path+`/files?updateId=${second.updateId}&uploadId=${randomUUID()}&name=second-proof.pdf`,p);
 await call(path+`/updates/${second.updateId}/publish`,p,'POST',{});
 await call(path+'/updates',p,'POST',{kind:'completion',body:'Work submitted before task approval'},409);
 await review(path,h,tasks[1].id,second.submissionId,'approve');
 const completion=await call(path+'/updates',p,'POST',{kind:'completion',body:'All approved tasks complete.',attachmentCount:1},201);
 await review(path,h,tasks[1].id,second.submissionId,'changes','Please recheck the final photo.');
 await upload(path+`/files?updateId=${completion.id}&uploadId=${randomUUID()}&name=final.pdf`,p);
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{},409);
 const finalProof=await proof(path,p,tasks[1].id);await review(path,h,tasks[1].id,finalProof.submissionId,'approve');
 await call(path+`/updates/${completion.id}/publish`,p,'POST',{});
 await call(createPath,p,'POST',{version:(await current(path,p)).checklist_version,clientId:randomUUID(),attachmentCount:1},409);
 await call(rev,h,'POST',{version:(await current(path,h)).checklist_version,submissionId:fresh.submissionId,decision:'changes',note:'Too late while final work is under review.'},409);
 await call(path+'/review-work',h,'POST',{decision:'changes',updateId:completion.id,note:'Please send final commissioning notes.'});
 await review(path,h,tasks[0].id,fresh.submissionId,'changes','Include the commissioning photo.');
 const last=await proof(path,p,tasks[0].id);await review(path,h,tasks[0].id,last.submissionId,'approve');
 const finish=await call(path+'/updates',p,'POST',{kind:'completion',body:'Approved tasks and final notes are ready.'},201);
 await call(path+'/review-work',h,'POST',{decision:'accept',updateId:finish.id});assert.equal((await current(path,h)).status,'completed');
 await call(createPath,p,'POST',{version:(await current(path,p)).checklist_version,clientId:randomUUID(),attachmentCount:1},409);
 const legacy=await create(h);await start(legacy,h,p);const done=await call(legacy+'/updates',p,'POST',{kind:'completion',body:'No checklist, completed normally.'},201);await call(legacy+'/review-work',h,'POST',{decision:'accept',updateId:done.id});
 console.log(`Checklist proof workflow passed (${checks} API checks): scope validation, role/state/privacy, upload retries, approval races, fresh proof after changes, completion guards, and legacy jobs.`);
}finally{
 await db.query('UPDATE jobs SET chosen_quote_id=NULL WHERE id=ANY($1::uuid[])',[jobs]);await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);await db.query('DELETE FROM companies WHERE id=ANY($1::uuid[])',[companies]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();
}
