import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { subscribeNotificationChanges } from '../apps/api/dist/notification-stream.js';
import { pool } from '../apps/api/dist/db.js';
if(!new URL(process.env.DATABASE_URL).pathname.includes('test'))throw new Error('Use an isolated test database.');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const user=randomUUID(),other=randomUUID();let wakes=0,otherWakes=0;const payloads=[];
let stop=subscribeNotificationChanges(user,()=>wakes++),stopOther=subscribeNotificationChanges(other,()=>otherWakes++);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(test){for(let n=0;n<40;n++){if(test())return;await pause(25);}assert.ok(test(),'Database notification arrived within one second');}
try{
  await db.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Stream test','test')",[user,`stream-${user}@example.test`]);
  await db.query('LISTEN connect_notifications_changed');
  db.on('notification',n=>payloads.push(n.payload));
  // Wait for the shared pool listener to establish, without exposing connection internals.
  for(let n=0;n<20&&wakes===0;n++){await db.query("SELECT pg_notify('connect_notifications_changed',$1)",[user]);await pause(25);}
  assert.ok(wakes>0);wakes=0;payloads.length=0;
  await db.query('BEGIN');
  await db.query("INSERT INTO user_notifications(user_id,event_key,type,category,title,text,url,source_kind) VALUES($1,$2,'job','messages','Private title','Private body','/jobs/inbox','job')",[user,`stream:${user}`]);
  await pause(50);assert.equal(wakes,0,'No delivery before commit');
  await db.query('COMMIT');await waitFor(()=>wakes===1);
  assert.equal(otherWakes,0,'Other recipient receives no event');
  assert.deepEqual(payloads,[user],'Payload contains only recipient UUID, never message or title');
  await db.query('UPDATE user_notifications SET read_at=now() WHERE user_id=$1',[user]);await waitFor(()=>wakes===2);
  stop();stopOther();const before=wakes;
  await db.query("SELECT pg_notify('connect_notifications_changed',$1)",[user]);await pause(50);assert.equal(wakes,before,'Unsubscribe closes delivery');
  console.log('Notification stream passed: immediate committed delivery, recipient scoping, content-free payload, read updates and clean unsubscribe.');
}finally{
  stop();stopOther();await db.query('ROLLBACK');await db.query('DELETE FROM users WHERE id=$1',[user]);await db.end();await pool.end();
}
