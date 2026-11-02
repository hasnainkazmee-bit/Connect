import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {S3Client,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import pg from 'pg';
const base=process.env.API_TEST_URL+'/api';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
const keys=[];
function client(){let cookie='';return async(path,body,extra={})=>{
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',...extra,headers:{cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...extra.headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
 return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};
};}
async function verification(address){
 for(let attempt=0;attempt<25;attempt++){
  const inbox=await(await fetch('http://127.0.0.1:8026/api/v1/messages')).json();
  const message=inbox.messages.find(m=>m.To.some(to=>to.Address===address));
  if(message){const data=await(await fetch('http://127.0.0.1:8026/api/v1/message/'+message.ID)).json();return data.Text.match(/\b\d{6}\b/)[0];}
  await wait(250);
 }
 throw new Error('Verification email did not reach Mailpit');
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');
test('Docker mail and S3 storage integrate with verified company chat',async t=>{
 const a=client(),b=client(),outsider=client(); let A,B,conversation;
 try {
  await t.test('real SMTP verification delivers and consumes codes',async()=>{
   const register=async(cli,name)=>{const email=`storage-${randomUUID()}@services.test`; const r=await cli('/auth/register',{name,email,password:'StorageConnect123!'}); assert.equal(r.status,201);
    const code=await verification(email); assert.equal((await cli('/auth/verification/confirm',{challengeId:r.data.challengeId,code})).status,200);
    const outbox=(await db.query('SELECT sent_at,payload_encrypted FROM email_outbox WHERE recipient=$1',[email])).rows[0];assert.ok(outbox.sent_at);assert.equal(outbox.payload_encrypted,null);
    const profile=await cli('/onboarding/company',{name:name+' '+randomUUID().slice(0,8),type:'Installer',location:'Austin, TX'});assert.equal(profile.status,200);return profile.data;};
   A=await register(a,'Storage Test A'); B=await register(b,'Storage Test B');
   assert.equal((await a('/ready')).status,200);
  });
  await t.test('accepting the request connects companies and opens a private conversation',async()=>{
   const request=await a('/requests',{companyId:B.activeCompanyId,kind:'message',note:'Storage integration test'});assert.equal(request.status,201);
   const accepted=await b(`/requests/${request.data.id}/respond`,{action:'accept'});assert.equal(accepted.status,200);conversation=accepted.data.connectionId;
  });
  await t.test('concurrent retries upload one object and produce one message',async()=>{
   const id=randomUUID();const payload=(body='Photo from the project')=>{const form=new FormData();form.set('body',body);form.set('clientId',id);form.append('files',new Blob([png],{type:'image/png'}),'project.png');return form;};
   const results=await Promise.all([a(`/conversations/${conversation}/messages`,payload()),a(`/conversations/${conversation}/messages`,payload())]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].data.id,results[1].data.id);
   assert.equal((await a(`/conversations/${conversation}/messages`,payload('Changed payload'))).status,409);
   const rows=(await db.query('SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.client_id=$1',[id])).rows;assert.equal(rows.length,1);const attachment=rows[0];keys.push(attachment.storage_name);
   assert.equal(attachment.storage_backend,'s3');assert.equal(attachment.sha256,hash);
   const head=await s3.send(new HeadObjectCommand({Bucket:process.env.S3_BUCKET,Key:attachment.storage_name}));assert.equal(head.Metadata.sha256,hash);
   assert.equal((await outsider(`/attachments/${attachment.id}`)).status,401);
   const downloaded=await b(`/attachments/${attachment.id}?inline=1`);assert.equal(downloaded.status,200);assert.deepEqual(downloaded.data,png);assert.match(downloaded.headers.get('content-disposition'),/^inline/);
   const range=await b(`/attachments/${attachment.id}`,undefined,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.deepEqual(range.data,png.subarray(0,8));
   assert.equal((await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${attachment.storage_name}`)).status,403);
   const before=(await a(`/conversations/${conversation}/messages`)).data;
   assert.ok(BigInt(before.peerReadSequence||0)<BigInt(results[0].data.sequence));
   await b(`/conversations/${conversation}/messages`);
   const after=(await a(`/conversations/${conversation}/messages`)).data;
   assert.ok(BigInt(after.peerReadSequence)>=BigInt(results[0].data.sequence));
  });
  await t.test('feed uploads use the same object store and deletion removes access',async()=>{
   const form=new FormData();form.set('body','Storage-backed project image');form.append('files',new Blob([png],{type:'image/png'}),'project.png');
   const created=await a('/posts',form);assert.equal(created.status,201);
   const media=(await db.query('SELECT * FROM post_media WHERE post_id=$1',[created.data.id])).rows[0];keys.push("posts/"+media.storage_name);assert.equal(media.storage_backend,'s3');assert.equal(media.sha256,hash);
   assert.equal((await a(`/posts/${created.data.id}`,undefined,{method:'DELETE'})).status,200);
  });
 } finally {try {for(const Key of keys.filter(Boolean))await s3.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key}));} finally {await db.end();s3.destroy();}}
});
