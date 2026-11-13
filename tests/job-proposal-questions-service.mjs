import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const base=process.env.JOBS_TEST_URL || 'http://127.0.0.1:4215';
const database=process.env.DATABASE_URL || '';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base)||!new URL(database).pathname.includes('test')) throw new Error('Use only an isolated local test database and server.');
const db=new pg.Client({connectionString:database});await db.connect();
const jobs=[],companies=[],users=[];
let assertions=0;
async function account(name,company,role='owner') {
 const slug=`questions-test-${randomUUID().slice(0,8)}`;
 const user=(await db.query("INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,'test',now(),now()) RETURNING id",[`${slug}@example.test`,name])).rows[0].id;users.push(user);
 if(!company){company=(await db.query("INSERT INTO companies(slug,name,username,listing_status) VALUES($1,$2,$1,'managed') RETURNING id",[slug,name])).rows[0].id;companies.push(company);}
 await db.query('INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)',[user,company,role]);
 const token=randomBytes(32).toString('hex');await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),user,company]);
 return {company,user,cookie:`connect_session=${token}`};
}
async function request(path,actor,method='GET',body){const r=await fetch(base+path,{method,headers:{...(actor?{cookie:actor.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function call(path,actor,method='GET',body,expected=200){const r=await request(path,actor,method,body);assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(r.data)}`);assertions++;return r.data;}
const brief={title:'Provide an experienced solar installation crew',description:'Install the rooftop solar equipment and provide final inspection documents.',trade:'installation',location:'Austin, TX'};
const terms={amountCents:100000,note:'Our team will perform the work and provide the requested inspection documents.'};
const q1={id:randomUUID(),prompt:'How large is the available crew?',required:true};
const q2={id:randomUUID(),prompt:'Which similar projects have you completed?',required:false};
const answer='Private provider answer: a dedicated six-person crew.';
async function create(h,proposalQuestions){const body={...brief,...(proposalQuestions===undefined?{}:{proposalQuestions})};const result=await call('/jobs',h,'POST',body,201);jobs.push(result.id);return `/jobs/${result.id}`;}
try {
 const h=await account('Questions hirer'),p=await account('Questions provider'),other=await account('Questions competitor');
 const member=await account('Questions employee',h.company,'member');
 await call('/jobs',member,'POST',{...brief,proposalQuestions:[q1]},403);
 const malformed=[null,{},'questions',12,[{}],[{...q1,id:'not-a-uuid'}],[{...q1,prompt:''}],[{...q1,prompt:'  '}],[{...q1,prompt:7}],[{...q1,prompt:'x'.repeat(501)}],[{...q1,prompt:'invalid\u0000text'}],[{...q1,required:'true'}],[{id:q1.id,prompt:q1.prompt}],[q1,{...q1,id:q1.id.toUpperCase()}],Array.from({length:11},()=>({...q1,id:randomUUID()}))];
 for(const proposalQuestions of malformed)await call('/jobs',h,'POST',{...brief,proposalQuestions},400);
 const path=await create(h,[{...q1,id:q1.id.toUpperCase(),prompt:`  ${q1.prompt}  `},q2]);
 let detail=await call(path,h);assert.deepEqual(detail.job.proposal_questions,[q1,q2]);assert.equal(detail.job.questions_version,1);
 await call(path,h,'PATCH',brief);
 detail=await call(path,h);assert.deepEqual(detail.job.proposal_questions,[q1,q2]);assert.equal(detail.job.questions_version,1,'Omission preserves questions');
 await call(path,h,'PATCH',{...brief,proposalQuestions:[{...q1,prompt:` ${q1.prompt} `},q2]});
 assert.equal((await call(path,h)).job.questions_version,1,'Normalized equivalent questions do not bump version');
 const revisedQuestions=[{...q1,prompt:'How many qualified workers can start next month?'},q2];
 await call(path,h,'PATCH',{...brief,proposalQuestions:revisedQuestions});
 assert.equal((await call(path,h)).job.questions_version,2);
 await call(path+'/quote',p,'POST',{...terms,questionsVersion:1,answers:[{questionId:q1.id,answer}]},409);
 await call(path+'/quote',p,'POST',{...terms,answers:[{questionId:q1.id,answer}]},409);
 for(const questionsVersion of [null,'2',0,-1,2.5])await call(path+'/quote',p,'POST',{...terms,questionsVersion,answers:[{questionId:q1.id,answer}]},400);
 const malformedAnswers=[null,{},'answers',[{}],[{questionId:q1.id,answer:null}],[{questionId:q1.id,answer:7}],[{questionId:q1.id,answer:'x'.repeat(5001)}],[{questionId:q1.id,answer:'invalid\u0000text'}],[{questionId:randomUUID(),answer}],[{questionId:q1.id,answer},{questionId:q1.id.toUpperCase(),answer}],Array.from({length:11},()=>({questionId:q1.id,answer}))];
 for(const answers of malformedAnswers)await call(path+'/quote',p,'POST',{...terms,questionsVersion:2,answers},400);
 await call(path+'/quote',p,'POST',{...terms,questionsVersion:2},400);
 await call(path+'/quote',p,'POST',{...terms,questionsVersion:2,answers:[]},400);
 await call(path+'/quote',p,'POST',{...terms,questionsVersion:2,answers:[{questionId:q1.id,answer:' \n '}]},400);
 const submitted=await call(path+'/quote',p,'POST',{...terms,questionsVersion:2,answers:[{questionId:q1.id.toUpperCase(),answer:` ${answer} `,prompt:'Forged question',required:false}]});
 detail=await call(path,h);
 const expected=[{questionId:q1.id,prompt:revisedQuestions[0].prompt,required:true,answer},{questionId:q2.id,prompt:q2.prompt,required:false,answer:''}];
 assert.deepEqual(detail.quotes[0].proposal_answers,expected);assert.equal(detail.quotes[0].questions_version,2);
 await call(path,h,'PATCH',{...brief,proposalQuestions:[]},409);
 const publicDetail=await call(path,null);assert.equal(JSON.stringify(publicDetail).includes(answer),false);assert.deepEqual(publicDetail.job.proposal_questions,revisedQuestions);
 assert.equal(JSON.stringify(await call(path,other)).includes(answer),false);
 await call(path+`/quote-history?providerId=${p.company}`,other,'GET',undefined,403);
 const own=await call(path,p);assert.deepEqual(own.ownQuote.proposal_answers,expected);
 let history=await call(path+`/quote-history?providerId=${p.company}`,h);assert.deepEqual(history.versions[0].proposal_answers,expected);assert.equal(history.versions[0].questions_version,2);
 assert.equal(JSON.stringify(history.events).includes(answer),false,'Answer text must not leak into event previews');
 const notices=await db.query("SELECT row_to_json(n) FROM user_notifications n WHERE company_id=$1",[h.company]);
 assert.equal(JSON.stringify(notices.rows).includes(answer),false,'Answer text must not leak into notifications');
 const newAnswer='Revised private answer: eight workers are available.';
 await call(path+'/quote',p,'POST',{...terms,version:1,questionsVersion:2,answers:[{questionId:q1.id,answer:newAnswer},{questionId:q2.id,answer:'  Three commercial rooftop projects.  '}]});
 history=await call(path+`/quote-history?providerId=${p.company}`,h);
 assert.deepEqual(history.versions.find(v=>v.version===1).proposal_answers,expected);
 assert.equal(history.versions[0].proposal_answers[0].answer,newAnswer);assert.equal(history.versions[0].proposal_answers[1].answer,'Three commercial rooftop projects.');
 await call(path+'/quote',other,'POST',{...terms,questionsVersion:2,answers:[{questionId:q1.id,answer:'Private competitor staffing answer.'}]});
 await call(path+'/choose',h,'POST',{quoteId:submitted.id,version:2});
 assert.equal((await call(path,h)).selected.proposal_answers[0].answer,newAnswer);
 assert.equal(JSON.stringify(await call(path,other)).includes(newAnswer),false);
 // Empty optional answers are preserved, and Unicode limits count characters rather than bytes.
 const optionalPath=await create(h,[{...q2,prompt:'☀'.repeat(500)}]);
 await call(optionalPath+'/quote',p,'POST',{...terms,questionsVersion:1});
 assert.equal((await call(optionalPath,h)).quotes[0].proposal_answers[0].answer,'');
 await call(optionalPath+'/quote',p,'POST',{...terms,version:1,questionsVersion:1,answers:[{questionId:q2.id,answer:'☀'.repeat(5000)}]});
 assert.equal((await call(optionalPath,h)).quotes[0].proposal_answers[0].answer.length,5000);
 const clearPath=await create(h,[q1]);
 await call(clearPath,h,'PATCH',{...brief,proposalQuestions:[]});
 detail=await call(clearPath,h);assert.equal(detail.job.questions_version,2);assert.deepEqual(detail.job.proposal_questions,[]);
 await call(clearPath+'/quote',p,'POST',{...terms,questionsVersion:1},409);
 await call(clearPath+'/quote',p,'POST',terms);
 assert.deepEqual((await call(clearPath,h)).quotes[0].proposal_answers,[]);
 // Legacy jobs accept old clients. Legacy immutable snapshots get read defaults without writes.
 const legacyPath=await create(h);
 await call(legacyPath+'/quote',p,'POST',terms);
 detail=await call(legacyPath,h);assert.deepEqual(detail.job.proposal_questions,[]);assert.equal(detail.job.questions_version,1);assert.deepEqual(detail.quotes[0].proposal_answers,[]);
 // Simulate a pre-migration immutable snapshot; reading it must not modify the old terms.
 const historicalPath=await create(h);
 const historicalJob=historicalPath.split('/').at(-1);
 const historicalId=(await db.query("INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents,note) VALUES($1,$2,$3,100000,$4) RETURNING id",[historicalJob,p.company,p.user,terms.note])).rows[0].id;
 const historicalTerms={amount_cents:100000,note:terms.note};
 await db.query("INSERT INTO job_quote_versions(quote_id,version,terms,author_id) VALUES($1,1,$2::jsonb,$3)",[historicalId,JSON.stringify(historicalTerms),p.user]);
 await db.query("INSERT INTO job_quote_publications(quote_id,version) VALUES($1,1)",[historicalId]);
 const historical=await call(historicalPath+`/quote-history?providerId=${p.company}`,h);
 assert.deepEqual(historical.versions[0].proposal_answers,[]);assert.equal(historical.versions[0].questions_version,1);
 assert.deepEqual((await db.query('SELECT terms FROM job_quote_versions WHERE quote_id=$1',[historicalId])).rows[0].terms,historicalTerms);
 // Draft quote answers remain private until attachment finalization.
 const pendingPath=await create(h,[q1]);
 const pending=await call(pendingPath+'/quote',p,'POST',{...terms,questionsVersion:1,answers:[{questionId:q1.id,answer}],attachmentCount:1});
 assert.equal(JSON.stringify(await call(pendingPath,h)).includes(answer),false);
 assert.equal(JSON.stringify(await call(pendingPath+`/quote-history?providerId=${p.company}`,h)).includes(answer),false);
 const upload=await fetch(base+pendingPath+`/files?name=crew.pdf&quoteId=${pending.id}&quoteVersion=1&uploadId=${randomUUID()}`,{method:'POST',headers:{cookie:p.cookie,'content-type':'application/pdf'},body:Buffer.from('%PDF-1.4\ncrew\n%%EOF')});assert.equal(upload.status,201);
 await call(pendingPath+`/quotes/${pending.id}/publish`,p,'POST',{version:1});
 assert.equal((await call(pendingPath,h)).quotes[0].proposal_answers[0].answer,answer);
 // The job lock prevents mixing a changed question prompt with an older answer screen.
 for(let index=0;index<4;index++) {
  const racePath=await create(h,[q1]);
  const race=await Promise.all([request(racePath,h,'PATCH',{...brief,proposalQuestions:[{...q1,prompt:'Changed question while quoting?'}]}),request(racePath+'/quote',p,'POST',{...terms,questionsVersion:1,answers:[{questionId:q1.id,answer}]})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const raced=await call(racePath,h);
  if(raced.quotes.length){assert.equal(raced.job.questions_version,1);assert.equal(raced.quotes[0].proposal_answers[0].prompt,q1.prompt);}else{assert.equal(raced.job.questions_version,2);}
 }
 console.log(`Proposal questions passed (${assertions} API assertions): typed questions/answers, schema versions, immutable snapshots, privacy, upload finalization and concurrent edit/quote safety.`);
} finally {
 await db.query('UPDATE jobs SET chosen_quote_id=NULL WHERE id=ANY($1::uuid[])',[jobs]);
 await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
 await db.query('DELETE FROM companies WHERE id=ANY($1::uuid[])',[companies]);
 await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
 await db.end();
}
