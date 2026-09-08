import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.BOT_PGLITE_MODULE||'./runtime/node_modules/@electric-sql/pglite/dist/index.js');
const gm='00000000-0000-4000-8000-000000000001',crew='00000000-0000-4000-8000-000000000002';
const group='C'+'a'.repeat(32),other='C'+'b'.repeat(32);
let db;
async function init(){db=new PGlite();await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table store_config(store_id text primary key); create table manager_auth(user_id uuid primary key,role text); insert into store_config values('TEST'),('OTHER'); insert into manager_auth values('${gm}','gm'),('${crew}','office_crew'); grant select on store_config,manager_auth to service_role;`);await db.exec(fs.readFileSync(new URL('../db/ops-bot.sql',import.meta.url),'utf8'));}
const q=async(sql,p=[])=>(await db.query(sql,p)).rows;
const write=async(op,id,version,data={},actor=gm)=>(await q('select bot_case_write($1,$2,$3,$4,$5) as v',[op,actor,id,version,JSON.stringify(data)]))[0].v;
const finding=async(key='test-case',kind='purchase',payload={})=>write('finding',null,null,{source_key:key,kind,store_id:'TEST',business_date:'2026-08-01',subject:'Synthetic case',payload});
test('database workflows are atomic, duplicate-safe, permission-checked and durable',async(t)=>{
 await init();
 await t.test('anon/authenticated cannot read tables or invoke service RPC',async()=>{
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>q('select * from bot_cases'),/permission denied/);await assert.rejects(()=>write('finding',null,null,{}),/permission denied/);await db.exec('reset role');}
 });
 await t.test('case creation deduplicates and stale edits preserve data',async()=>{
  const c=await finding();assert.equal((await finding()).id,c.id);
  const n=await write('note',c.id,c.version,{note:'First review'});assert.equal(n.version,2);
  await assert.rejects(()=>write('note',c.id,c.version,{note:'Stale edit'}),/conflict/);
  assert.equal((await q('select count(*)::int n from bot_events where case_id=$1',[c.id]))[0].n,2);
 });
 await t.test('purchase approval and ordering require details, role and order number',async()=>{
  let c=await finding('purchase');await assert.rejects(()=>write('acknowledge',c.id,c.version,{note:'Bypass ordering'}),/order_number_required/);await assert.rejects(()=>write('approve',c.id,c.version),/purchase_details_required/);
  c=await write('purchase',c.id,c.version,{url:'https://www.amazon.com/dp/TEST',quantity:2});
  await assert.rejects(()=>write('approve',c.id,c.version,{},crew),/forbidden/);
  c=await write('approve',c.id,c.version);assert.equal(c.status,'ready');await assert.rejects(()=>write('ordered',c.id,c.version,{}),/order_number_required/);
  c=await write('ordered',c.id,c.version,{order_number:'SYNTHETIC-123'});assert.equal(c.status,'done');
 });
 await t.test('unknown group messages are not retained; repeated webhook creates one case',async()=>{
  const ingest=async(g,id,text)=>q('select bot_ingest($1,$2,$3,$4,$5) v',[id,g,'synthetic-user',text,'message']);
  await ingest(group,'ignored','/order private text');assert.equal((await q("select count(*)::int n from bot_events where event_key='ignored'"))[0].n,0);
  await q("update bot_groups set enabled=true,store_id='TEST' where group_id=$1",[group]);
  await ingest(group,'line1','/order synthetic cups');await ingest(group,'line1','/order synthetic cups');
  let c=(await q("select * from bot_cases where source_key='line:line1'"))[0];assert.equal(c.status,'review');
  await ingest(group,'line2',c.code+' corrected');c=(await q('select * from bot_cases where id=$1',[c.id]))[0];assert.equal(c.status,'verify');
  await q("insert into bot_groups(group_id,enabled,store_id) values($1,true,'OTHER')",[other]);await ingest(other,'wrong',c.code+' fixed');assert.equal((await q("select count(*)::int n from bot_events where event_key='wrong'"))[0].n,0);
 });
 await t.test('send reservation handles concurrency, body mismatch, and replies during send',async()=>{
  let c=await finding('send');const request=crypto.randomUUID();
  const reserve=(rid,txt='Test message')=>q('select bot_reserve_send($1,$2,$3,$4,$5,$6) v',[gm,c.id,c.version,rid,group,txt]);
  const o=(await reserve(request))[0].v;assert.equal((await reserve(request))[0].v.id,o.id);
  await assert.rejects(()=>reserve(request,'Changed text'),/retry_mismatch/);await assert.rejects(()=>reserve(crypto.randomUUID()),/conflict/);
  await q('select bot_ingest($1,$2,$3,$4,$5)',['during-send',group,'synthetic',c.code+' corrected','message']);
  await q('select bot_finish_send($1,$2)',[request,'sent']);c=(await q('select * from bot_cases where id=$1',[c.id]))[0];assert.equal(c.status,'verify');
  assert.equal((await q('select state from bot_outbox where id=$1',[request]))[0].state,'sent');
 });
 await t.test('failed sends cannot be replayed after a new review or close',async()=>{
  let c=await finding('failed-send','labor',{fingerprint:'one'});const request=crypto.randomUUID();
  await q('select bot_reserve_send($1,$2,$3,$4,$5,$6)',[gm,c.id,c.version,request,group,'Old message']);
  await q('select bot_finish_send($1,$2)',[request,'failed']);
  c=(await q('select * from bot_cases where id=$1',[c.id]))[0];
  c=await write('acknowledge',c.id,c.version,{note:'Reviewed as correct'});
  await assert.rejects(()=>q('select bot_reserve_send($1,$2,$3,$4,$5,$6)',[gm,c.id,c.version,request,group,'Old message']),/failed_send_requires_new_review/);
 });
 await t.test('new source change reopens a done labor case but preserves saved draft',async()=>{
  let c=await finding('labor','labor',{fingerprint:'one'});c=await write('draft',c.id,c.version,{draft:'Reviewed wording'});c=await write('acknowledge',c.id,c.version,{note:'Reviewed as correct'});
  c=await finding('labor','labor',{fingerprint:'two',draft:''});assert.equal(c.status,'review');assert.equal(c.payload.draft,'Reviewed wording');
  c=await write('verified',c.id,c.version,{clean:true},null);assert.equal(c.status,'done');
 });
 await db.close();
});
