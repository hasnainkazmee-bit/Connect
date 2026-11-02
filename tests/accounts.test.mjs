import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv, randomUUID } from 'node:crypto';
import pg from 'pg';
const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
const companyName = 'Verified Solar ' + randomUUID().slice(0,8);
const base = process.env.API_TEST_URL + '/api';
const secret = createHash('sha256').update(process.env.AUTH_TOKEN_SECRET).digest();
const address = `account-${randomUUID()}@accounts.test`;
const password = 'PrivateConnect123!';
function client() {
  let cookie = '';
  return async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
    const value = response.headers.get('set-cookie');
    if (value) cookie = value.split(';')[0];
    return {status:response.status, data:await response.json()};
  };
}
async function code() {
  const row = (await db.query('SELECT payload_encrypted FROM email_outbox WHERE recipient=$1 ORDER BY created_at DESC LIMIT 1',[address])).rows[0];
  assert.ok(row?.payload_encrypted);
  assert.ok(!row.payload_encrypted.includes('verification code'));
  const data = Buffer.from(row.payload_encrypted,'base64');
  const cipher = createDecipheriv('aes-256-gcm',secret,data.subarray(0,12));
  cipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString().match(/\b\d{6}\b/)[0];
}
test('verified account lifecycle, recovery and device access', async t => {
  const a = client(), b = client(), outsider = client();
  let challengeId, userId;
  await t.test('registration queues encrypted email and gates company writes',async()=>{
    const r = await a('/auth/register',{name:'Account Owner',email:address,password,companyName});
    assert.equal(r.status,201); challengeId=r.data.challengeId; userId=r.data.user.id;
    assert.equal(r.data.verificationRequired,true);
    assert.equal(r.data.user.email_verified_at,null);
    const stored=(await db.query('SELECT password_hash FROM users WHERE id=$1',[userId])).rows[0].password_hash;
    assert.ok(stored.startsWith('scrypt-v2:'));
    assert.equal((await a('/requests',{companyId:randomUUID(),note:'Hello'})).status,403);
    assert.equal((await a('/join/verified-solar/accept',{})).status,403);
  });
  await t.test('verification codes have bounded guesses and resends invalidate previous codes',async()=>{
    const original=await code();
    for(let i=0;i<5;i++) assert.equal((await a('/auth/verification/confirm',{challengeId,code:original==='000000'?'111111':'000000'})).status,400);
    assert.equal((await a('/auth/verification/confirm',{challengeId,code:original})).status,400);
    const r=await a('/auth/verification/request',{}); challengeId=r.data.challengeId;
    assert.equal((await outsider('/auth/verification/confirm',{challengeId,code:await code()})).status,401);
    const verified=await a('/auth/verification/confirm',{challengeId,code:await code()});
    assert.equal(verified.status,200); assert.ok(verified.data.user.email_verified_at);
    assert.equal((await a('/auth/verification/confirm',{challengeId,code:await code()})).status,400);
  });
  await t.test('company onboarding persists its profile and completion',async()=>{
    const r=await a('/onboarding/company',{name:companyName,type:'EPC',location:'Austin, TX',services:['Installation'],serviceAreas:['Texas']});
    assert.equal(r.status,200); assert.equal(r.data.companies[0].type,'EPC');
    assert.ok((await a('/onboarding/complete',{})).data.user.onboarding_completed_at);
  });
  await t.test('session inventory excludes secrets and revoking other devices is enforced',async()=>{
    assert.equal((await b('/auth/login',{email:address,password})).status,200);
    const r=await a('/auth/sessions'); assert.equal(r.data.sessions.length,2);
    assert.ok(r.data.sessions.every(s=>!('token_hash' in s)));
    assert.equal((await a('/auth/sessions/revoke',{others:true})).status,200);
    assert.equal((await b('/session')).data.user,null);
  });
  await t.test('reset responses do not reveal account existence; reset revokes sessions',async()=>{
    const request=await outsider('/auth/password/request',{email:address});
    const missing=await outsider('/auth/password/request',{email:`missing-${randomUUID()}@accounts.test`});
    assert.equal(request.data.message,missing.data.message); assert.equal(request.status,missing.status);
    const reset=await outsider('/auth/password/reset',{challengeId:request.data.challengeId,code:await code(),password:'ChangedConnect456!'});
    assert.equal(reset.status,200); assert.equal((await a('/session')).data.user,null);
    assert.equal((await a('/auth/login',{email:address,password})).status,401);
    assert.equal((await a('/auth/login',{email:address,password:'ChangedConnect456!'})).status,200);
    assert.equal((await outsider('/auth/password/reset',{challengeId:request.data.challengeId,code:await code(),password})).status,400);
  });
  await t.test('expired reset codes and incorrect current passwords cannot change credentials',async()=>{
    const r=await outsider('/auth/password/request',{email:address});
    await db.query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[r.data.challengeId]);
    assert.equal((await outsider('/auth/password/reset',{challengeId:r.data.challengeId,code:await code(),password})).status,400);
    assert.equal((await a('/auth/password/change',{currentPassword:password,password:'AnotherConnect789!'})).status,400);
    assert.equal((await a('/auth/password/change',{currentPassword:'ChangedConnect456!',password:'AnotherConnect789!'})).status,200);
    assert.ok((await a('/session')).data.user);
  });
  await db.end();
});
