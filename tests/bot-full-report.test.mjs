import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {formatMorningSummary,createHandler} from '../supabase/functions/ops-bot/handler.mjs';
const group='C'+'a'.repeat(32),cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
const guid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

test('full morning report: complete snapshot, bounded transport, immutable retry and private RPCs',async t=>{
 const db=new PGlite(),q=async(s,p=[])=>(await db.query(s,p)).rows;
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table store_config(store_id text primary key,name text,active boolean default true);create table manager_auth(user_id uuid primary key,role text);insert into store_config values('TEST','Synthetic Restaurant',true);grant select on store_config,manager_auth to service_role;`);
 for(const f of ['ops-bot','ops-bot-all-stores','ops-bot-monitor','ops-bot-mentions','ops-bot-daily-range','ops-bot-auth','ops-bot-morning-summary','ops-bot-morning-summary-details'])await db.exec(fs.readFileSync(new URL('../db/'+f+'.sql',import.meta.url),'utf8'));
 for(const f of ['20260910184520_bot_case_closure','20260911205005_bot_simple_completion','20260912220724_bot_full_morning_report'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+f+'.sql',import.meta.url),'utf8'));
 await q('insert into bot_groups(group_id,label,enabled,all_stores) values($1,$2,true,true)',[group,'HQ']);
 await q("insert into bot_settings(key,value) values('morning_summary',$1)",[JSON.stringify({enabled:true,group_id:group,label:'HQ'})]);
 await q(`insert into bot_cases(source_key,kind,store_id,business_date,subject,status,closed_at,payload)
 select 'synthetic-'||n,'labor','TEST',current_date-40,'Synthetic Person '||n,case when n<=250 then 'review' else 'done' end,case when n>250 then now()-interval '10 minutes' end,$1::jsonb from generate_series(1,375)n`,[JSON.stringify({employee_name:'Synthetic Person',kinds:['long'],cfg,shifts:[{inDate:'2026-09-08T20:00:00Z',outDate:'2026-09-09T09:00:00Z'}],closure:{note:'Synthetic completion',actor:'Synthetic reviewer'}})]);
 const snap=(await q('select bot_morning_snapshot() v'))[0].v,day=snap.day;
 await t.test('all 250 open and 125 completed cases are included, with atomic shifts and no omitted cases',()=>{
  assert.equal(snap.details.length,250);assert.equal(snap.detail_total,250);assert.equal(snap.recent_closed.length,125);
  assert.deepEqual(snap.details[0].shift_cfg,cfg);assert.equal(snap.details[0].shifts.length,1);
  const formatted=formatMorningSummary(snap),text=formatted.messages.map(m=>m.text).join('\n');
  for(const c of [...snap.details,...snap.recent_closed])assert.ok(text.includes('案件：'+c.code),c.code);
  assert.ok(formatted.messages.length>5);assert.doesNotMatch(text,/ほか\s*\d+件|続きはFunergy/);
  assert.match(text,/レポート終了.*250件.*125件/);assert.ok(formatted.messages.every(m=>m.text.length<=4900));
  assert.throws(()=>formatMorningSummary({...snap,details:snap.details.slice(0,200)}),/incomplete_details/);
 });
 const attempts=[];let failSecond=true;
 const rpc=async(fn,body)=>{const keys=Object.keys(body);return (await q('select public.'+fn+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') v',keys.map(k=>body[k]!==null&&typeof body[k]==='object'?JSON.stringify(body[k]):body[k])))[0].v;};
 const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'synthetic'})[k],fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
  if(url.includes('key=eq.morning_summary'))return Response.json([{value:{enabled:true,group_id:group,label:'HQ'}}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:group,label:'HQ',all_stores:true}]);
  if(url.includes('/rpc/'))return Response.json(await rpc(url.split('/rpc/')[1],JSON.parse(init.body)));
  if(url.endsWith('/message/push')){
   const body=JSON.parse(init.body);assert.equal(body.to,group);assert.ok(body.messages.length<=5);assert.ok(body.messages.every(m=>m.text.length<=4900));
   attempts.push({key:init.headers['X-Line-Retry-Key'],body});
   if(attempts.length===2&&failSecond){failSecond=false;return new Response(null,{status:429});}
   if(attempts.length===3)return new Response(null,{status:409,headers:{'x-line-accepted-request-id':'synthetic-accepted'}});
   return new Response(null,{status:200});
  }
  throw Error('Unexpected test URL '+url);
 }});
 const call=key=>h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':key},body:JSON.stringify({action:'worker',mode:'morning_summary'})}));
 await t.test('429 stops at the failed batch; retry uses the same payload and key, skips accepted batches and handles LINE 409',async()=>{
  assert.equal((await call('wrong')).status,401);assert.equal(attempts.length,0);
  let r=await call('worker');assert.equal(r.status,200);assert.equal((await r.json()).state,'unknown');assert.equal(attempts.length,2);
  let event=(await q("select * from bot_events where kind='morning_summary'"))[0];assert.equal(event.data.state,'pending');assert.equal(event.data.batches[0].state,'accepted');assert.equal(event.data.batches[1].state,'unknown');
  await q("update bot_cases set subject='Changed after reservation' where status<>'done'");
  r=await call('worker');assert.equal(r.status,200);assert.equal((await r.json()).state,'accepted');
  assert.deepEqual(attempts[1],attempts[2]);assert.notEqual(attempts[0].key,attempts[2].key);
  const delivered=attempts.filter((_,i)=>i!==1).flatMap(x=>x.body.messages).map(m=>m.text).join('\n');
  assert.doesNotMatch(delivered,/Changed after reservation/);assert.match(delivered,/レポート終了/);
  for(const c of [...snap.details,...snap.recent_closed])assert.ok(delivered.includes('案件：'+c.code));
  event=(await q("select * from bot_events where kind='morning_summary'"))[0];assert.equal(event.data.state,'accepted');assert.ok(event.data.batches.every(b=>b.state==='accepted'));
  const count=attempts.length;r=await call('worker');assert.equal((await r.json()).already_sent,true);assert.equal(attempts.length,count);
 });
 const messages=[{type:'text',text:'Immutable synthetic report'}];
 const reserve=(variant,bundle=messages)=>(rpc('bot_reserve_morning_summary_v3',{p_day:day,p_group:group,p_request:guid(1),p_messages:bundle,p_variant:variant}));
 await t.test('legacy pending v2 reservations retain their exact retry key and payload',async()=>{
  const old=await rpc('bot_reserve_morning_summary_v2',{p_day:day,p_group:group,p_request:guid(2),p_messages:messages,p_variant:'resend-details-v1'});
  const current=await reserve('resend-details-v1',[{type:'text',text:'Must not replace'}]);
  assert.equal(current.id,old.id);assert.equal(current.data.batches[0].request_id,guid(2));assert.deepEqual(current.data.batches[0].messages,messages);
 });
 await t.test('batch completion cannot skip earlier batches or regress an accepted batch',async()=>{
  const e=await reserve('resend-report-v1',Array.from({length:7},(_,i)=>({type:'text',text:'Part '+i})));
  const finish=(batch,state)=>rpc('bot_finish_morning_summary_batch',{p_event:e.id,p_batch:batch,p_state:state});
  await assert.rejects(()=>finish(1,'accepted'),/invalid_batch_order/);
  await finish(0,'accepted');await finish(0,'unknown');await finish(1,'failed');
  const saved=await reserve('resend-report-v1');assert.equal(saved.data.state,'failed');assert.equal(saved.data.batches[0].state,'accepted');
 });
 await t.test('malformed messages, wrong group and unprivileged roles are rejected',async()=>{
  for(const bundle of [null,{},[],[{}],[{type:'text'}],[{type:'text',text:3}],[{type:'text',text:'x'.repeat(4901)}]])await assert.rejects(()=>reserve('mention-preview-v1',bundle),/invalid_message/);
  await assert.rejects(()=>rpc('bot_reserve_morning_summary_v3',{p_day:day,p_group:'C'+'b'.repeat(32),p_request:guid(1),p_messages:messages}),/morning_summary_not_configured/);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>reserve('mention-preview-v1'),/permission denied/);await assert.rejects(()=>q('select bot_morning_snapshot()'),/permission denied/);await assert.rejects(()=>rpc('bot_finish_morning_summary_batch',{p_event:1,p_batch:0,p_state:'accepted'}),/permission denied/);await db.exec('reset role');}
 });
 await t.test('completion watermark uses frozen snapshot time, retaining closures during delivery',async()=>{
  await q("update bot_events set data=data||jsonb_build_object('snapshot_at',now()-interval '5 minutes') where kind='morning_summary' and data->>'variant'='daily'");
  await q("update bot_cases set status='done',closed_at=now()-interval '2 minutes' where source_key='synthetic-1'");
  const next=(await q('select bot_morning_snapshot() v'))[0].v;assert.equal(next.recent_closed.length,1);assert.equal(next.details.length,249);
 });
 }finally{await db.close();}
});

test('long case detail keeps every shift, long reply and emoji without losing identity or exceeding LINE limits',()=>{
 const c={code:'#123',store_id:'TEST',store_name:'Synthetic',kind:'labor',employee_name:'Synthetic',kinds:['long'],status:'hq_review',shift_cfg:cfg,shifts:Array.from({length:100},()=>({inDate:'2026-09-08T20:00:00Z',outDate:'2026-09-09T09:00:00Z'})),response:{actor:'Synthetic',note:'🙂'.repeat(6000)+'END_OF_REPLY'}};
 const m=formatMorningSummary({counts:{labor:1},detail_total:1,details:[c]}),text=m.messages.map(x=>x.text).join('\n');
 assert.match(text,/勤務100：/);assert.match(text,/END_OF_REPLY/);assert.equal([...text].filter(x=>x==='🙂').length,6000);
 assert.ok(m.messages.every(x=>x.text.length<=4900));for(const x of m.messages.slice(1))assert.match(x.text,/案件：#123.*本部確認待ち/s);
});
