import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.BOT_PGLITE_MODULE||'./runtime/node_modules/@electric-sql/pglite/dist/index.js');
const gm='00000000-0000-4000-8000-000000000001',crew='00000000-0000-4000-8000-000000000002';
const group='C'+'a'.repeat(32),other='C'+'b'.repeat(32);
let db;
async function init(){db=new PGlite();await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table store_config(store_id text primary key,name text,active boolean default true); create table manager_auth(user_id uuid primary key,role text); insert into store_config(store_id,name) values('TEST','Test Restaurant'),('OTHER','Other Restaurant'); insert into manager_auth values('${gm}','gm'),('${crew}','office_crew'); grant select on store_config,manager_auth to service_role;`);await db.exec(fs.readFileSync(new URL('../db/ops-bot.sql',import.meta.url),'utf8'));await db.exec(fs.readFileSync(new URL('../db/ops-bot-all-stores.sql',import.meta.url),'utf8'));await db.exec(fs.readFileSync(new URL('../db/ops-bot-monitor.sql',import.meta.url),'utf8'));await db.exec(fs.readFileSync(new URL('../db/ops-bot-mentions.sql',import.meta.url),'utf8'));await db.exec(fs.readFileSync(new URL('../db/ops-bot-daily-range.sql',import.meta.url),'utf8'));}
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
 await t.test('all-store group routes multiple stores without widening store-only groups',async()=>{
  const global='C'+'c'.repeat(32);
  await q("insert into bot_groups(group_id,enabled,all_stores) values($1,true,true)",[global]);
  for(const store of ['TEST','OTHER']){
   const c=await write('finding',null,null,{source_key:'global-'+store,kind:'labor',store_id:store,business_date:'2026-08-01',subject:'Synthetic',payload:{}});
   await q('select bot_reserve_send($1,$2,$3,$4,$5,$6)',[gm,c.id,c.version,crypto.randomUUID(),global,'Synthetic route']);
   await q('select bot_ingest($1,$2,$3,$4,$5)',['global-report-'+store,global,'synthetic',c.code+' 完了','message']);
   assert.equal((await q('select status from bot_cases where id=$1',[c.id]))[0].status,'verify');
  }
  const wrong=await write('finding',null,null,{source_key:'other-scope',kind:'labor',store_id:'OTHER',business_date:'2026-08-01',subject:'Synthetic',payload:{}});
  await assert.rejects(()=>q('select bot_reserve_send($1,$2,$3,$4,$5,$6)',[gm,wrong.id,wrong.version,crypto.randomUUID(),group,'Wrong scope']),/group_not_enabled/);
  await q('select bot_ingest($1,$2,$3,$4,$5)',['wrong-scope',group,'synthetic',wrong.code+' 完了','message']);
  assert.equal((await q('select status from bot_cases where id=$1',[wrong.id]))[0].status,'review');
  await q('update bot_groups set enabled=false where group_id=$1',[global]);
  await q('select bot_ingest($1,$2,$3,$4,$5)',['disabled-scope',global,'synthetic',wrong.code+' 完了','message']);
  assert.equal((await q('select status from bot_cases where id=$1',[wrong.id]))[0].status,'review');
  await q('update bot_groups set enabled=true where group_id=$1',[global]);
 });
 await t.test('completion is a report, negative replies remain notes, closed cases stay closed',async()=>{
  const global='C'+'c'.repeat(32);let c=await finding('completion','labor');
  for(const [i,reply] of ['未完了','まだ完了していません','not done','not fixed','修正しましたか？'].entries()){
   await q('select bot_ingest($1,$2,$3,$4,$5)',['negative-'+i,global,'synthetic',c.code+' '+reply,'message']);
   assert.equal((await q('select status from bot_cases where id=$1',[c.id]))[0].status,'review');
  }
  await q('select bot_ingest($1,$2,$3,$4,$5)',['positive',global,'synthetic','['+c.code+'] done','message']);
  c=(await q('select * from bot_cases where id=$1',[c.id]))[0];assert.equal(c.status,'verify');
  c=await write('verified',c.id,c.version,{clean:true},null);
  await q('select bot_ingest($1,$2,$3,$4,$5)',['closed-report',global,'synthetic',c.code+' 完了','message']);
  assert.equal((await q('select status from bot_cases where id=$1',[c.id]))[0].status,'done');
 });
 await t.test('assignee defaults apply only to new cases, assignment is audited and permission checked',async()=>{
  await q("insert into bot_settings(key,value) values('owner:TEST',$1)",[JSON.stringify({name:'Synthetic Manager'})]);
  let c=await finding('assigned','labor',{fingerprint:'one'});assert.equal(c.assignee,'Synthetic Manager');
  await assert.rejects(()=>write('assign',c.id,c.version,{assignee:'Other'},crew),/forbidden/);
  c=await write('assign',c.id,c.version,{assignee:'Synthetic Reviewer'});
  c=await finding('assigned','labor',{fingerprint:'two'});assert.equal(c.assignee,'Synthetic Reviewer');
  assert.equal((await q("select count(*)::int n from bot_events where case_id=$1 and kind='assign'",[c.id]))[0].n,1);
 });
 await t.test('all-store orders route explicit names and retain missing stores for one-time assignment',async()=>{
  const global='C'+'c'.repeat(32);
  const ingest=async(id,text)=>(await q('select bot_ingest($1,$2,$3,$4,$5) v',[id,global,'synthetic',text,'message']))[0].v;
  await ingest('named-order','発注依頼 [Other Restaurant] synthetic cups');
  assert.equal((await q("select store_id from bot_cases where source_key='line:named-order'"))[0].store_id,'OTHER');
  assert.equal((await ingest('missing-order','/order synthetic gloves')).needs_store,true);
  assert.equal((await ingest('missing-order','/order synthetic gloves')).duplicate,true);
  const e=(await q("select * from bot_events where event_key='missing-order'"))[0];assert.equal(e.kind,'line_needs_store');assert.equal(e.case_id,null);
  const resolve=async(store)=>(await q('select bot_assign_intake($1,$2,$3) v',[gm,e.id,store]))[0].v;
  const c=await resolve('TEST');assert.equal(c.store_id,'TEST');assert.equal((await resolve('OTHER')).id,c.id);
  assert.equal((await resolve('OTHER')).store_id,'TEST');
  await db.exec('set role authenticated');await assert.rejects(()=>resolve('TEST'),/permission denied/);await db.exec('reset role');
 });
 await t.test('monitor records failures without closing and rotates by check time; paid checks can reopen',async()=>{
  let c=await finding('unpaid-monitor','unpaid',{fingerprint:'open',amount:20});
  await q('select bot_record_check($1,$2,$3,$4)',[c.id,c.version,null,JSON.stringify({clean:false,message:'payment_not_confirmed'})]);
  c=(await q('select * from bot_cases where id=$1',[c.id]))[0];assert.equal(c.status,'review');assert.ok(c.last_checked_at);assert.equal(c.last_check.clean,false);
  await assert.rejects(()=>write('verified',c.id,c.version,{clean:true},null),/verification_required/);
  c=await write('verified',c.id,c.version,{clean:true,verification_type:'unpaid_paid',checked_at:'2026-08-02T00:00:00Z'},null);assert.equal(c.status,'done');assert.equal(c.last_check.clean,true);
  c=await finding('unpaid-monitor','unpaid',{fingerprint:'open',amount:20});assert.equal(c.status,'review');
  await db.exec('set role authenticated');await assert.rejects(()=>q('select bot_record_check($1,$2,$3,$4)',[c.id,c.version,gm,'{}']),/permission denied/);await db.exec('reset role');
 });
 await t.test('mention snapshot is immutable across retries and private to service callers',async()=>{
  const c=await finding('mention-snapshot'),rid=crypto.randomUUID();const msg={type:'textV2',text:'{assignee} hi',substitution:{assignee:{type:'mention',mentionee:{type:'user',userId:'U'+'a'.repeat(32)}}}};
  const reserve=async m=>(await q('select bot_reserve_send_v2($1,$2,$3,$4,$5,$6,$7) v',[gm,c.id,c.version,rid,group,'hi',JSON.stringify(m)]))[0].v;
  const first=await reserve(msg);const retry=await reserve({type:'text',text:'changed'});assert.deepEqual(first.line_message,msg);assert.deepEqual(retry.line_message,msg);
  await db.exec('set role authenticated');await assert.rejects(()=>reserve(msg),/permission denied/);await db.exec('reset role');
 });

 await t.test('monthly queue covers all completed days, retries failures and rolls months without overlap',async()=>{
  await q("insert into bot_settings(key,value) values('worker','{\"enabled\":true}') on conflict(key) do update set value=excluded.value");
  const when='2026-09-08T19:00:00Z';
  const claim=async(date=when)=>(await q('select bot_claim_range($1,$2) v',['TEST',date]))[0].v;
  const finish=async(j,error=null)=>(await q('select bot_finish_range($1,$2,$3,$4) v',['TEST',j.business_date,j.lease_id,error]))[0].v;
  let j=await claim();assert.equal(j.business_date,'2026-09-01');assert.equal(await claim(),null);
  assert.equal(await finish({...j,lease_id:crypto.randomUUID()}),false);assert.equal(await finish(j,'toast_read_failed'),true);
  for(let i=2;i<=7;i++){j=await claim();assert.equal(j.business_date,'2026-09-0'+i);await finish(j);}
  assert.equal(await claim(),null);
  j=await claim('2026-09-08T19:16:00Z');assert.equal(j.business_date,'2026-09-01');assert.equal(j.attempts,2);await finish(j);
  assert.equal(await claim('2026-09-08T19:20:00Z'),null);
  const o=(await q('select bot_range_overview($1) v',[when]))[0].v;assert.equal(o.expected,14);assert.equal(o.ok,7);assert.equal(o.failed,0);
  j=await claim('2026-09-09T19:00:00Z');assert.equal(j.business_date,'2026-09-08');await finish(j);
  // Previous cycle successes must be fetched again, and missing yesterday has priority.
  j=await claim('2026-09-09T19:01:00Z');assert.equal(j.business_date,'2026-09-01');await finish(j);
  assert.equal(await claim('2026-10-01T19:00:00Z'),null);
  j=await claim('2026-10-02T19:00:00Z');assert.equal(j.business_date,'2026-10-01');await finish(j);
  assert.equal((await q('select bot_range_overview($1) v',['2026-10-01T19:00:00Z']))[0].v.expected,0);
  // Hawaii is still September at 09:59 UTC on October 1.
  assert.equal((await q('select bot_range_overview($1) v',['2026-10-01T09:59:00Z']))[0].v.from,'2026-09-01');
  await db.exec('set role authenticated');await assert.rejects(()=>claim(),/permission denied/);await assert.rejects(()=>q('select * from bot_scan_days'),/permission denied/);await db.exec('reset role');
 });
 await t.test('morning reservation rejects stale evidence and duplicates while keeping the approved message',async()=>{
  let c=await finding('daily-reminder','labor',{});const day=(await q("select (now() at time zone 'Pacific/Honolulu')::date::text d"))[0].d;
  const msg={type:'text',text:'Daily check'};const reserve=async(id=crypto.randomUUID(),body='Daily check',actor=gm)=>(await q('select bot_reserve_daily_send($1,$2,$3,$4,$5,$6,$7,$8) v',[actor,c.id,c.version,id,group,body,JSON.stringify(msg),day]))[0].v;
  await assert.rejects(()=>reserve(),/recheck_required/);
  await q("select bot_record_check($1,$2,$3,$4)",[c.id,c.version,null,JSON.stringify({message:'still_flagged_or_manual_review',clean:false})]);
  c=(await q('select * from bot_cases where id=$1',[c.id]))[0];
  const first=await reserve();const again=await reserve();assert.equal(first.id,again.id);
  await assert.rejects(()=>reserve(crypto.randomUUID(),'Changed text'),/daily_already_prepared/);
  await assert.rejects(()=>reserve(crypto.randomUUID(),'Daily check',crew),/forbidden/);
  assert.equal((await q('select count(*)::int n from bot_outbox where case_id=$1 and reminder_date=$2',[c.id,day]))[0].n,1);
  await q('select bot_finish_send($1,$2)',[first.id,'failed']);
  c=(await q('select * from bot_cases where id=$1',[c.id]))[0];
  await assert.rejects(()=>reserve(first.id),/failed_send_requires_new_review/);
  const fresh=await reserve(crypto.randomUUID(),'New reviewed text');assert.notEqual(fresh.id,first.id);
  assert.equal((await q("select count(*)::int n from bot_outbox where case_id=$1 and reminder_date=$2 and state<>'failed'",[c.id,day]))[0].n,1);
 });
 await db.close();
});
