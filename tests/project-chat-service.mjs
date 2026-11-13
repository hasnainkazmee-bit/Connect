import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import pg from 'pg';

const base = process.env.JOBS_TEST_URL || 'http://127.0.0.1:4215';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base) || !new URL(process.env.DATABASE_URL).pathname.includes('test')) throw new Error('Use an isolated local test database and service.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const users = [], companies = [], jobs = [], streams = [];
async function account(name, sharedCompany, role = 'owner') {
  const user = randomUUID(), company = sharedCompany || randomUUID();
  users.push(user);
  await db.query("INSERT INTO users(id,email,name,password_hash,email_verified_at,onboarding_completed_at) VALUES($1,$2,$3,'test',now(),now())", [user, `chat-${user}@example.test`, name]);
  if (!sharedCompany) {
    companies.push(company);
    await db.query('INSERT INTO companies(id,slug,username,name) VALUES($1::uuid,$3,$3,$2)', [company, name, `chat-${company.slice(0,8)}`]);
  }
  await db.query('INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3)', [user, company, role]);
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO sessions(token_hash,user_id,company_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), user, company]);
  return { user, company, cookie: `connect_session=${token}` };
}
async function call(path, actor, body, expected = 200) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie: actor.cookie, ...(body ? {'content-type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function openStream(actor) {
  const apiBase=process.env.API_TEST_URL;
  if(!apiBase)return null;
  if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(apiBase))throw new Error('Use local SSE only.');
  const controller=new AbortController();
  const response=await fetch(apiBase+'/api/notifications/events',{headers:{cookie:actor.cookie},signal:controller.signal});
  assert.equal(response.status,200);
  const state={count:0,controller};streams.push(state);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  state.reading=(async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);if(packet.includes('event: changed'))state.count++;}}}catch(error){if(error.name!=='AbortError')throw error;}})();
  for(let n=0;n<60&&state.count===0;n++)await new Promise(r=>setTimeout(r,25));
  assert.equal(state.count,1,'Authenticated SSE opened and loaded its initial state');
  return state;
}
async function upload(job, actor, provider, draft, name = 'Site plan.pdf', expected = 201, bytes = '%PDF-1.7\nIsolated test file') {
  const response = await fetch(`${base}/jobs/${job}/files?providerId=${provider}&messageDraftId=${draft}&name=${encodeURIComponent(name)}`, {method:'POST', headers:{cookie:actor.cookie,'content-type':'application/octet-stream'},body:bytes});
  const data = await response.json();
  assert.equal(response.status,expected,JSON.stringify(data));
  return data;
}
async function download(file, actor, expected) {
  const response = await fetch(`${base}/jobs/files/${file}?preview=1`,{headers:{cookie:actor.cookie}});
  assert.equal(response.status,expected);
  if(expected===200){assert.equal(response.headers.get('content-type'),'application/pdf'); assert.equal(response.headers.get('cache-control'),'private, no-store');}
}
try {
  const hirer=await account('Chat hirer'), provider=await account('Chat provider'), competitor=await account('Chat competitor'), teammate=await account('Chat teammate',provider.company,'member');
  const job=await call('/jobs',hirer,{title:'Review the installation and site drawings',description:'Coordinate the commercial installation scope, site drawings and crew availability.',trade:'installation',location:'Austin, TX',exactAddress:'PRIVATE TEST ADDRESS'},201);
  jobs.push(job.id);
  const path=`/jobs/${job.id}/messages`, query=`?providerId=${provider.company}`;
  const send=(actor,body,expected=201)=>call(path,actor,{providerId:provider.company,clientId:randomUUID(),...body},expected);
  // Staging does not create a conversation, leak files, or notify the other side.
  const hireStream=await openStream(hirer),otherStream=await openStream(competitor);
  const client=randomUUID();
  const file=await upload(job.id,provider,provider.company,client);
  await download(file.id,provider,200);
  await download(file.id,hirer,404);
  await download(file.id,teammate,404);
  await download(file.id,competitor,404);
  for (const actor of [hirer,provider,competitor]) {
    assert.ok(!(await call(`/jobs/${job.id}`,actor)).files.some(f=>f.id===file.id),'Staged files excluded from job file listings');
  }
  assert.equal((await call(path+'/files'+query,hirer)).files.length,0);
  assert.ok(!(await call('/jobs/inbox',hirer)).threads.some(t=>t.job_id===job.id));
  await upload(job.id,provider,provider.company,randomUUID(),'Wrong.pdf',400,'<script>invalid file</script>');
  await send(provider,{body:'Wrong draft must not attach.',fileIds:[file.id]},400);
  await send(teammate,{body:'Cannot use another employee attachment.',clientId:client,fileIds:[file.id]},400);
  const sent=await send(provider,{body:'',clientId:client,fileIds:[file.id]});
  assert.equal(sent.message.attachments[0].original_name,'Site plan.pdf');
  if(hireStream){
    for(let n=0;n<50&&hireStream.count<2;n++)await new Promise(r=>setTimeout(r,25));
    assert.equal(hireStream.count,2,'A real sent message refreshed SSE before its five-second fallback poll');
    assert.equal(otherStream.count,1,'Another company received no private message event');
  }
  const retry=await send(provider,{body:'',clientId:client,fileIds:[file.id]},200);
  assert.equal(retry.id,sent.id);
  await send(provider,{body:'Changed payload',clientId:client,fileIds:[file.id]},409);
  await download(file.id,hirer,200);
  await download(file.id,teammate,200);
  await download(file.id,competitor,404);
  assert.equal((await call(path+'/files'+query,hirer)).files[0].id,file.id);
  await upload(job.id,provider,provider.company,client,'Too late.pdf',409);
  // Replies and search remain scoped to one provider, including empty-body attachments.
  const reply=await send(hirer,{body:'The access route is highlighted on this plan.',replyTo:sent.id});
  assert.equal(reply.message.reply.attachments[0].id,file.id);
  const other=await call(path,competitor,{body:'Private competing quote conversation.',providerId:competitor.company,clientId:randomUUID()},201);
  await send(hirer,{body:'Forged reply',replyTo:other.id},404);
  await call(path+`?providerId=${provider.company}`,competitor,undefined,403);
  assert.equal((await call(path+query+'&q=Site%20plan',hirer)).messages[0].id,sent.id);
  assert.equal((await call(path+query+'&q=competing',hirer)).messages.length,0);
  // Reactions are per employee; existing chips toggle and disclose human names, not emails.
  const react=`${path}/${reply.id}/react`;
  await call(react,provider,{providerId:provider.company,emoji:'👍'});
  let reactions=(await call(react,teammate,{providerId:provider.company,emoji:'👍'})).reactions;
  assert.equal(reactions[0].count,2);
  assert.ok(reactions[0].people.some(p=>p.name==='Chat teammate'));
  reactions=(await call(react,provider,{providerId:provider.company,emoji:'👍'})).reactions;
  assert.equal(reactions[0].count,1);
  await call(react,competitor,{providerId:competitor.company,emoji:'👍'},404);
  await call(react,provider,{providerId:provider.company,emoji:'not emoji'},400);
  const pin=`${path}/${reply.id}/pin`;
  await call(pin,provider,{providerId:provider.company,pinned:true});
  assert.equal((await call(path+query,hirer)).pinnedMessages[0].id,reply.id);
  await call(pin,hirer,{providerId:provider.company,pinned:false});
  assert.equal((await call(path+query,hirer)).pinnedMessages.length,0);
  await call(path+'/read',hirer,{providerId:provider.company,messageId:sent.id});
  assert.equal((await call(path+query,provider)).messages.find(m=>m.id===sent.id).readByOtherCompany,true);
  // Concurrent retries create one message and one notification, preserving attachment scope.
  const concurrentId=randomUUID(), attachment=await upload(job.id,provider,provider.company,concurrentId,'Final plan.pdf');
  const payload={providerId:provider.company,clientId:concurrentId,body:'Final site plan',fileIds:[attachment.id]};
  const responses=await Promise.all([0,1].map(async()=>{const r=await fetch(base+path,{method:'POST',headers:{cookie:provider.cookie,'content-type':'application/json'},body:JSON.stringify(payload)});assert.ok([200,201].includes(r.status));return r.json();}));
  assert.equal(responses[0].id,responses[1].id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM user_notifications WHERE user_id=$1 AND event_key=$2',[hirer.user,`job-message:${responses[0].id}`])).rows[0].n,1);
  // Workflow notification reads are personal and cannot clear another candidate's events.
  await send(hirer,{body:'Thanks. I am reviewing the quotes.'});
  const event=(await db.query("INSERT INTO job_conversation_events(job_id,provider_company_id,actor_id,company_id,kind,body) VALUES($1,$2,$3,$2,'quote_submitted','') RETURNING id",[job.id,provider.company,provider.user])).rows[0].id;
  const beforeUnread=(await call('/jobs/inbox',hirer)).threads.find(t=>t.job_id===job.id&&t.provider_id===provider.company).unread_count;
  await db.query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','requests','New quote received','Test quote',$5,'job',$6::uuid)",[hirer.company,provider.company,provider.user,`job-event:${event}`,`/jobs/inbox?job=${job.id}&provider=${provider.company}`,job.id]);
  const eventThread=(await call('/jobs/inbox',hirer)).threads.find(t=>t.job_id===job.id&&t.provider_id===provider.company);
  assert.equal(eventThread.body,'Quote received');
  assert.equal(eventThread.sender_company_id,null,'Workflow preview never inherits the last chat sender or a misleading You prefix');
  assert.equal(eventThread.preview_kind,'event');
  assert.equal(eventThread.unread_count,beforeUnread+1);
  await call(`/jobs/${job.id}/events/read`,hirer,{providerId:competitor.company,eventId:event},404);
  const readEvent=await call(`/jobs/${job.id}/events/read`,hirer,{providerId:provider.company,eventId:event});
  assert.equal(readEvent.notificationIds.length,1);
  assert.equal((await call('/jobs/inbox',hirer)).threads.find(t=>t.job_id===job.id&&t.provider_id===provider.company).unread_count,beforeUnread);
  // Awarding to one company closes BOTH sides of every competing conversation.
  const selected=(await db.query("INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents) VALUES($1,$2,$3,10000) RETURNING id",[job.id,provider.company,provider.user])).rows[0].id;
  await db.query("UPDATE jobs SET status='awarded',chosen_quote_id=$2 WHERE id=$1",[job.id,selected]);
  for(const actor of [hirer,competitor]){
    assert.equal((await call(path+`?providerId=${competitor.company}`,actor)).conversation.canSend,false);
    await call(path,actor,{providerId:competitor.company,clientId:randomUUID(),body:'This competing conversation is closed.'},403);
  }
  await send(hirer,{body:'The chosen company can still discuss its start date.'});
  // Closing the job freezes both sides, while all existing private history stays readable.
  await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1",[job.id]);
  for(const actor of [hirer,provider]){
    assert.equal((await call(path+query,actor)).conversation.canSend,false);
    await send(actor,{body:'Cannot send after closure.'},403);
    await call(pin,actor,{providerId:provider.company,pinned:true},403);
    await call(react,actor,{providerId:provider.company,emoji:'👍'},403);
  }
  await download(file.id,hirer,200);
  console.log('Project chat passed: staged and sent file privacy, payload validation, replies, search, named reactions, pinning, read receipts, concurrent retries and symmetric archives.');
} finally {
  for(const stream of streams)stream.controller.abort();
  await Promise.all(streams.map(stream=>stream.reading));
  await db.query('DELETE FROM jobs WHERE hiring_company_id=ANY($1::uuid[])',[companies]);
  await db.query('DELETE FROM companies WHERE id=ANY($1::uuid[])',[companies]);
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
  await db.end();
  if(process.env.JOBS_UPLOAD_DIR?.startsWith('/private/tmp/')) for(const id of jobs)await rm(`${process.env.JOBS_UPLOAD_DIR}/jobs/${id}`,{recursive:true,force:true});
}
