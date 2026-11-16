// Run only against a migrated, isolated local database and the Rust jobs service.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import pg from 'pg';

const base = process.env.JOBS_TEST_URL || 'http://127.0.0.1:4219';
const database = process.env.DATABASE_URL || '';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) || !/^postgres(ql)?:$/.test(new URL(database).protocol) || !['localhost','127.0.0.1'].includes(new URL(database).hostname) || !new URL(database).pathname.includes('test')) throw Error('Use an isolated local test database and service.');
const db = new pg.Client({connectionString: database});
await db.connect();
const jobs = [], companies = [], users = [];
const prefix = `library-${randomUUID().slice(0,8)}`;
let assertions = 0;
async function account(name, company, role = 'owner', options = {}) {
  const slug = `${prefix}-${randomUUID().slice(0,8)}`;
  const user = (await db.query("INSERT INTO users(email,name,password_hash,email_verified_at,onboarding_completed_at,account_type) VALUES($1,$2,'test',CASE WHEN $3 THEN now() ELSE NULL END,now(),$4) RETURNING id", [`${slug}@example.test`, name, options.verified !== false, options.individual ? 'individual' : 'company'])).rows[0].id;
  users.push(user);
  if (!company) {
    company = (await db.query("INSERT INTO companies(slug,name,username,listing_status,is_demo) VALUES($1,$2,$1,'managed',$3) RETURNING id", [slug, name, !!options.demo])).rows[0].id;
    companies.push(company);
  }
  await db.query('INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)', [user,company,role]);
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'),user,company]);
  return {company,user,cookie:`connect_session=${token}`};
}
async function request(path, actor, method = 'GET', body) {
  const response = await fetch(base + path, {method,headers:{...(actor ? {cookie:actor.cookie} : {}),...(body === undefined ? {} : {'content-type':'application/json'})},body:body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status:response.status,data};
}
async function call(path, actor, method = 'GET', body, expected = 200) {
  const result = await request(path,actor,method,body);
  assert.equal(result.status,expected,`${method} ${path}: ${JSON.stringify(result.data)}`);
  assertions++;
  return result.data;
}
const brief = {title:'Provide a commercial solar installation crew',description:'Install the rooftop solar equipment and provide the final inspection documents.',trade:'installation',location:'Austin, TX'};
const terms = {amountCents:100000,note:'Our qualified crew will install the equipment and provide the final inspection documents.'};
async function create(hirer, extra = {}) {
  const {id} = await call('/jobs',hirer,'POST',{...brief,...extra},201);
  jobs.push(id);
  return `/jobs/${id}`;
}
async function save(path, actor, version = 0, body = {note:'Private unfinished proposal'}) {
  return (await call(path+'/proposal-draft',actor,'PUT',{version,body})).draft;
}
async function uploadAndPublish(path, provider, quote) {
  const response = await fetch(base+path+`/files?name=plan.pdf&quoteId=${quote.id}&quoteVersion=${quote.version}&uploadId=${randomUUID()}`, {method:'POST',headers:{cookie:provider.cookie,'content-type':'application/pdf'},body:Buffer.from('%PDF-1.4\nTest plan\n%%EOF')});
  assert.equal(response.status,201,await response.text()); assertions++;
  await call(path+`/quotes/${quote.id}/publish`,provider,'POST',{version:quote.version});
}
try {
  const h = await account(`${prefix} Hirer`), p = await account(`${prefix} Provider`), other = await account(`${prefix} Competitor`);
  const member = await account('Member',p.company,'member'), unverified = await account('Unverified',p.company,'admin',{verified:false});
  const individual = await account('Individual',p.company,'owner',{individual:true}), demo = await account('Demo',undefined,'owner',{demo:true});
  const path = await create(h), id = path.split('/').at(-1);
  for (const [actor,status] of [[null,401],[unverified,403],[individual,403]]) {
    await call('/jobs/saved',actor,'GET',undefined,status);
    await call(path+'/proposal-draft',actor,'GET',undefined,status);
    await call(path+'/saved',actor,'PUT',{saved:true},status);
  }
  for (const actor of [h,demo,member]) {
    await call(path+'/saved',actor,'PUT',{saved:true},403);
    await call(path+'/proposal-draft',actor,'PUT',{version:0,body:{}},403);
  }
  await call(path+'/saved',p,'PUT',{saved:true});
  await call(path+'/saved',p,'PUT',{saved:true});
  assert.equal((await call('/jobs/saved',member)).jobs.length,1);
  assert.equal((await call('/jobs/saved',other)).jobs.length,0);
  assert.equal((await call('/jobs',p)).jobs.find(j=>j.id===id).saved,true);
  assert.equal((await call('/jobs')).jobs.find(j=>j.id===id).saved,false);
  let draft = await save(path,p,0,{note:'Private unfinished proposal',amountCents:null,priceBreakdown:[{label:'Labor',amountCents:null}]});
  assert.equal((await call(path+'/proposal-draft',member)).canEdit,false);
  assert.equal((await call(path+'/proposal-draft',other)).draft,null);
  await call(path+'/proposal-draft',h,'GET',undefined,403);
  assert.equal((await call('/jobs/proposal-drafts',p)).jobs[0].draftVersion,draft.version);
  assert.equal((await call('/jobs',p)).jobs.find(j=>j.id===id).draftVersion,draft.version);
  assert.equal((await call('/jobs',other)).jobs.find(j=>j.id===id).draftVersion,null);
  assert.equal(JSON.stringify(await call(path,h)).includes('Private unfinished proposal'),false);
  assert.equal(JSON.stringify((await db.query('SELECT row_to_json(n) FROM user_notifications n WHERE company_id=$1',[h.company])).rows).includes('Private unfinished proposal'),false);
  for (const body of [{note:'bad\0text'},{amountCents:-1},{note:'x'.repeat(5001)}]) await call(path+'/proposal-draft',p,'PUT',{version:draft.version,body},400);
  await call(path+'/proposal-draft',p,'PUT',{version:draft.version,body:{files:[{id:'fake'}]}},422);
  await call(path+'/proposal-draft',p,'PUT',{version:draft.version,body:{companyId:other.company}},422);
  const race = await Promise.all([request(path+'/proposal-draft',p,'PUT',{version:draft.version,body:{note:'First concurrent edit'}}),request(path+'/proposal-draft',p,'PUT',{version:draft.version,body:{note:'Second concurrent edit'}})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]); assertions++;
  await call(path+`/proposal-draft?version=${draft.version}`,p,'DELETE',undefined,409);
  draft = (await call(path+'/proposal-draft',p)).draft;
  await call(path+`/proposal-draft?version=${draft.version}`,other,'DELETE');
  assert.equal((await call(path+'/proposal-draft',p)).draft.version,draft.version);
  await call(path+'/quote',p,'POST',{...terms,draftVersion:0},409);
  await call(path+'/quote',p,'POST',{...terms,amountCents:-1,draftVersion:draft.version},400);
  assert.equal((await call(path+'/proposal-draft',p)).draft.version,draft.version);
  await call(path+'/quote',p,'POST',{...terms,draftVersion:draft.version});
  assert.equal((await call(path+'/proposal-draft',p)).draft,null,'Publishing a quote clears only its own draft');
  assert.equal(JSON.stringify(await call(path+`/quote-history?providerId=${p.company}`,h)).includes('proposal_draft_version'),false);

  const privatePath = await create(h,{visibility:'invite_only'});
  await call(privatePath+'/saved',p,'PUT',{saved:true},404);
  await call(privatePath+'/proposal-draft',p,'PUT',{version:0,body:{}},404);
  await call(privatePath+'/invite',h,'POST',{companyIds:[p.company]});
  await call(privatePath+'/saved',p,'PUT',{saved:true});
  const privateDraft = await save(privatePath,p);
  await db.query("UPDATE job_invitations SET status='declined' WHERE job_id=$1",[privatePath.split('/').at(-1)]);
  assert.equal((await call('/jobs/saved',p)).jobs.some(j=>j.id===privatePath.split('/').at(-1)),false);
  await call(privatePath+'/proposal-draft',p,'GET',undefined,404);
  await call(privatePath+'/saved',p,'PUT',{saved:false});
  await call(privatePath+`/proposal-draft?version=${privateDraft.version}`,p,'DELETE');
  const closedPath = await create(h); await call(closedPath+'/saved',p,'PUT',{saved:true});
  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1",[closedPath.split('/').at(-1)]);
  await call(closedPath+'/saved',p,'PUT',{saved:true},409);
  await call(closedPath+'/saved',p,'PUT',{saved:false});
  const expired = await create(h); await db.query("UPDATE jobs SET quote_deadline=now()-interval '1 hour' WHERE id=$1",[expired.split('/').at(-1)]);
  await call(expired+'/proposal-draft',p,'PUT',{version:0,body:{}},409);

  const pendingPath = await create(h), pendingDraft = await save(pendingPath,p);
  const pending = await call(pendingPath+'/quote',p,'POST',{...terms,attachmentCount:1,draftVersion:pendingDraft.version});
  assert.equal((await call(pendingPath+'/proposal-draft',p)).draft.version,pendingDraft.version);
  await uploadAndPublish(pendingPath,p,pending);
  assert.equal((await call(pendingPath+'/proposal-draft',p)).draft,null);
  const newerPath = await create(h), old = await save(newerPath,p);
  const oldQuote = await call(newerPath+'/quote',p,'POST',{...terms,attachmentCount:1,draftVersion:old.version});
  const newer = await save(newerPath,p,old.version,{note:'New draft created while uploading'});
  await uploadAndPublish(newerPath,p,oldQuote);
  assert.equal((await call(newerPath+'/proposal-draft',p)).draft.version,newer.version);
  const recreatedPath = await create(h), beforeDelete = await save(recreatedPath,p);
  const beforeDeleteQuote = await call(recreatedPath+'/quote',p,'POST',{...terms,attachmentCount:1,draftVersion:beforeDelete.version});
  await call(recreatedPath+`/proposal-draft?version=${beforeDelete.version}`,p,'DELETE');
  const recreated = await save(recreatedPath,p);
  assert.notEqual(recreated.version,beforeDelete.version,'Recreating a draft must not reuse an old version');
  await uploadAndPublish(recreatedPath,p,beforeDeleteQuote);
  assert.equal((await call(recreatedPath+'/proposal-draft',p)).draft.version,recreated.version);

  // Discovery ordering happens before pagination and excludes unknown dates when filtering.
  const discovery = [];
  for (let n=1;n<=26;n++) {
    const job = await create(h,{title:`${prefix} Discovery job ${n}`,budgetCents:n*100000,workArrangement:n%2?'onsite':'remote'});
    const jobId = job.split('/').at(-1); discovery.push(jobId);
    await db.query("UPDATE jobs SET posting_details=$2::jsonb,quote_deadline=now()+($3||' days')::interval WHERE id=$1",[jobId,JSON.stringify({startMode:'date',startDate:`2027-01-${String(n).padStart(2,'0')}`}),String(n)]);
    await call(job+'/saved',p,'PUT',{saved:true});
  }
  const query = '/jobs?q='+encodeURIComponent(prefix+' Discovery');
  let found = await call(query+'&sort=budget',p);
  assert.equal(found.jobs.length,24); assert.equal(found.hasMore,true); assert.equal(found.jobs[0].id,discovery[25]);
  assert.deepEqual((await call(query+'&sort=budget&page=2',p)).jobs.map(j=>j.id),[discovery[1],discovery[0]]);
  assert.equal((await call(query+'&sort=closing',p)).jobs[0].id,discovery[0]);
  assert.equal((await call(query+'&sort=start',p)).jobs[0].id,discovery[0]);
  found = await call(query+'&arrangement=remote&start=2027-01-05',p);
  assert.deepEqual(found.jobs.map(j=>j.id).sort(),[discovery[1],discovery[3]].sort());
  for (const filter of ['sort=evil','arrangement=invalid','start=2027-02-29']) await call('/jobs?'+filter,p,'GET',undefined,400);
  const savedPage = await call('/jobs/saved',p); assert.equal(savedPage.jobs.length,24); assert.equal(savedPage.hasMore,true);
  assert.equal((await call('/jobs/saved?page=2',p)).jobs.length,3);

  // Public profile records use actual completed work, not review count or invented dates.
  const completed = [];
  for (let n=0;n<5;n++) {
    const owner = n<3?h:other;
    const job = await create(owner,{title:`${prefix} Completed job ${n}`,visibility:n===0?'invite_only':'open'});
    const jobId = job.split('/').at(-1); completed.push(jobId);
    const quote = (await db.query("INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents,note,status) VALUES($1,$2,$3,100000,'Fixture complete','chosen') RETURNING id",[jobId,p.company,p.user])).rows[0].id;
    await db.query("UPDATE jobs SET chosen_quote_id=$2,status='completed' WHERE id=$1",[jobId,quote]);
    await db.query("INSERT INTO job_conversation_events(job_id,provider_company_id,actor_id,company_id,kind,created_at) VALUES($1,$2,$3,$4,'work_accepted',$5)",[jobId,p.company,owner.user,owner.company,`2026-01-0${n+1}T10:00:00Z`]);
    if(n===0) await db.query("INSERT INTO job_reviews(job_id,reviewer_company_id,reviewed_company_id,rating,text) VALUES($1,$2,$3,5,'A useful review')",[jobId,owner.company,p.company]);
  }
  let profile = await call('/jobs/companies/'+p.company);
  assert.equal(profile.completedJobs,5); assert.equal(profile.distinctHirers,2); assert.equal(profile.returningHirers,2); assert.equal(profile.reviewCount,1);
  assert.ok(profile.firstCompletedAt.startsWith('2026-01-01')); assert.equal(profile.milestones.find(m=>m.id==='five-jobs').earned,true);
  assert.equal(profile.milestones.find(m=>m.id==='ten-jobs').earned,false);
  assert.equal(profile.reviews[0].jobTitle,null,'Private job title must not become public via a review');
  await db.query("DELETE FROM job_conversation_events WHERE job_id=$1 AND kind='work_accepted'",[completed[4]]);
  profile = await call('/jobs/companies/'+p.company);
  assert.equal(profile.firstCompletedAt,null); assert.equal(profile.milestones.find(m=>m.id==='five-jobs').earnedAt,null);
  const orphan = (await db.query("INSERT INTO companies(slug,name,listing_status) VALUES($1,$2,'managed') RETURNING id",[`${prefix}-orphan`,`${prefix} Unclaimed`])).rows[0].id; companies.push(orphan);
  await db.query("INSERT INTO projects(company_id,name,description,completed_year) VALUES($1,'Recent portfolio','Roof commissioning',2026),($1,'Older portfolio','Older work',2020)",[p.company]);
  const managed = await call('/jobs/providers?q='+prefix+'&participation=managed');
  assert.equal(managed.providers.some(c=>c.id===orphan),false);
  const provider = managed.providers.find(c=>c.id===p.company);
  assert.equal(provider.on_colabb,true); assert.equal(provider.completed_jobs,5); assert.equal(provider.job_rating,5); assert.equal(provider.job_review_count,1);
  assert.equal(provider.latestProject.name,'Recent portfolio'); assert.equal(provider.latestProject.image_url,null);
  const unclaimed = await call('/jobs/providers?q='+prefix+'&participation=unclaimed');
  assert.deepEqual(unclaimed.providers.map(c=>c.id),[orphan]); assert.equal(unclaimed.total,1);
  await call('/jobs/providers?participation=invalid',null,'GET',undefined,400);
  assert.equal((await call('/jobs/providers/'+p.company)).provider.on_colabb,true);
  assert.equal((await call('/jobs/providers/'+orphan)).provider.on_colabb,false);
  assert.equal((await call('/jobs',p)).jobs[0].company.on_colabb,true);

  // Certification selection is OR, paginated consistently and keeps qualification scope.
  const certA = `${prefix} Installer accreditation`, certB = `${prefix} Electrical, qualified`;
  async function credential(company,title,{scope='company',category='certification',key=null,expired=false}={}) {
    await db.query("INSERT INTO company_credentials(company_id,catalog_key,title,category,organization,scope,scope_detail,source_url,evidence_basis,valid_until) VALUES($1,$2,$3,$4,'Test authority',$5,'Test scope','https://example.test/credential','company',CASE WHEN $6 THEN CURRENT_DATE-1 ELSE NULL END)",[company,key,title,category,scope,expired]);
  }
  await credential(p.company,certA,{key:prefix+'-installer'});
  await credential(other.company,certB,{scope:'personnel',category:'qualification'});
  await credential(orphan,certA,{scope:'personnel'});
  await credential(orphan,`${prefix} Expired`,{expired:true});
  await credential(orphan,`${prefix} Directory`,{category:'directory'});
  await credential(demo.company,`${prefix} Demo only`);
  const catalog = (await call('/jobs/provider-taxonomy')).directoryCredentials;
  const optionA = catalog.find(c=>c.label===certA&&c.scope==='company');
  const optionB = catalog.find(c=>c.label===certB&&c.scope==='personnel');
  assert.ok(optionA.value.startsWith('title:')); assert.equal(optionA.count,1); assert.ok(optionB);
  assert.ok(catalog.some(c=>c.label===certA&&c.scope==='personnel'));
  assert.ok(!catalog.some(c=>[`${prefix} Demo only`,`${prefix} Expired`,`${prefix} Directory`].includes(c.label)));
  const sampleCatalog = (await call('/jobs/provider-taxonomy?sample=true')).directoryCredentials;
  assert.ok(sampleCatalog.some(c=>c.label===`${prefix} Demo only`)); assert.ok(!sampleCatalog.some(c=>c.label===certA));
  const directory = '/jobs/providers?q='+prefix+'&credentials=';
  let certified = await call(directory+encodeURIComponent(optionA.value));
  assert.deepEqual(certified.providers.map(c=>c.id),[p.company]); assert.equal(certified.total,1);
  assert.equal(certified.providers[0].certification_count,1);
  assert.equal(certified.providers[0].certifications[0].title,certA);
  assert.equal(certified.providers[0].certifications[0].evidence_basis,'company');
  certified = await call(directory+encodeURIComponent([optionA.value,optionB.value].join(',')));
  assert.deepEqual(certified.providers.map(c=>c.id).sort(),[p.company,other.company].sort()); assert.equal(certified.total,2);
  certified = await call(directory+encodeURIComponent(prefix+'-installer'));
  assert.deepEqual(certified.providers.map(c=>c.id),[p.company]);
  for (const filter of [prefix+' Expired',prefix+' Directory',"' OR 1=1 --"]) {
    certified = await call(directory+encodeURIComponent(filter));
    assert.equal(certified.total,0); assert.deepEqual(certified.providers,[]);
  }
  for (const filter of ['x'.repeat(181),Array.from({length:21},(_,i)=>'cert'+i).join(','),'bad\u0000input']) await call(directory+encodeURIComponent(filter),null,'GET',undefined,400);
  console.log(`Job library passed (${assertions} API assertions): access/tenant/demo separation, private drafts, concurrent writes, publication cleanup, recreated-draft safety, pagination/filters, factual reputation, provider participation and scoped certification OR filters.`);
} finally {
  await db.query('UPDATE jobs SET chosen_quote_id=NULL WHERE id=ANY($1::uuid[])',[jobs]);
  await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
  await db.query('DELETE FROM companies WHERE id=ANY($1::uuid[])',[companies]);
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
  await db.end();
}
