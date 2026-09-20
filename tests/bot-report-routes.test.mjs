import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {createHandler} from '../supabase/functions/ops-bot/handler.mjs';
const laborGroup='C'+'a'.repeat(32),financeGroup='C'+'b'.repeat(32);
const guid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clock={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
test('isolated report routes, immutable retries, read-only preview and private SQL',async t=>{
 const db=new PGlite(),q=async(s,p=[])=>(await db.query(s,p)).rows;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table store_config(store_id text primary key,name text,active boolean default true);create table manager_auth(user_id uuid primary key,role text);insert into store_config values('TEST','Synthetic',true);grant select on store_config,manager_auth to service_role;`);
  for(const f of ['ops-bot','ops-bot-all-stores','ops-bot-monitor','ops-bot-mentions','ops-bot-daily-range','ops-bot-auth','ops-bot-morning-summary','ops-bot-morning-summary-details'])await db.exec(fs.readFileSync(new URL('../db/'+f+'.sql',import.meta.url),'utf8'));
  for(const f of ['20260910184520_bot_case_closure','20260911205005_bot_simple_completion','20260912220724_bot_full_morning_report','20260912224146_bot_report_responsibility','20260920024342_bot_report_routes_cash_tips'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+f+'.sql',import.meta.url),'utf8'));
  const config={enabled:true,group_id:financeGroup,label:'HQ',routes:{labor:{group_id:laborGroup,label:'Corrections'},finance:{group_id:financeGroup,label:'HQ'}},cash_tip:{enabled:true}};
  await q('insert into bot_groups(group_id,label,enabled,all_stores) values($1,$2,true,true),($3,$4,true,true)',[laborGroup,'Corrections',financeGroup,'HQ']);
  const saveConfig=()=>q("insert into bot_settings(key,value) values('morning_summary',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify(config)]);
  await saveConfig();
  const day=(await q("select (now() at time zone 'Pacific/Honolulu')::date::text d"))[0].d;
  const yesterday=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  let cash={},failLabor=true,changeRoute=false;
  const snapshot={day,snapshot_at:new Date().toISOString(),from:yesterday,to:yesterday,expected:1,ok:1,finance_ok:1,failed:0,active_stores:1,finance_enabled:true,detail_total:2,counts:{labor:1,void:0,unpaid:1},details:[{code:'#1',kind:'labor',store_id:'TEST',store_name:'Synthetic',business_date:yesterday,employee_name:'Synthetic worker',kinds:['short'],shifts:[],status:'review'},{code:'#2',kind:'unpaid',store_id:'TEST',store_name:'Synthetic',business_date:yesterday,subject:'Unpaid / #22',amount:5,status:'review'}]};
  const pushes=[],writes=[];
  const rpc=async(fn,b)=>{const keys=Object.keys(b);return(await q('select public.'+fn+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') v',keys.map(k=>b[k]!==null&&typeof b[k]==='object'?JSON.stringify(b[k]):b[k])))[0].v;};
  const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'synthetic'})[k],fetch:async(url,init)=>{
   if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
   if(url.includes('key=eq.clock'))return Response.json([{value:clock}]);
   if(url.includes('key=eq.morning_summary'))return Response.json([{value:config}]);
   if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
   if(url.includes('/bot_groups?')){const id=new URL(url).searchParams.get('group_id')?.slice(3);return Response.json(await q('select * from bot_groups'+(id?' where group_id=$1':''),id?[id]:[]));}
   if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',name:'Synthetic',active:true}]);
   if(url.includes('/stores?'))return Response.json([{id:'TEST',data:{}}]);
   if(url.includes('/app_state?'))return Response.json([{key:'cash_tips_TEST',value:cash}]);
   if(url.endsWith('/rpc/bot_morning_snapshot'))return Response.json(snapshot);
   if(url.includes('/rpc/')){writes.push(url);const r=await rpc(url.split('/rpc/')[1],JSON.parse(init.body));if(changeRoute&&url.endsWith('bot_reserve_morning_report'))config.routes.labor={group_id:financeGroup,label:'HQ'};return Response.json(r);}
   if(url.endsWith('/summary'))return Response.json({groupName:url.includes(laborGroup)?'Corrections':'HQ'});
   if(url.endsWith('/message/push')){const body=JSON.parse(init.body);pushes.push({key:init.headers['X-Line-Retry-Key'],body});if(body.to===laborGroup&&failLabor){failLabor=false;return new Response(null,{status:429});}return new Response(null,{status:200});}
   throw Error('Unexpected '+url);
  }});
  const call=async(mode,variant='daily',key='worker')=>{const r=await h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':key},body:JSON.stringify({action:'worker',mode,variant})}));return {status:r.status,body:await r.json()};};
  await t.test('preview and directory require worker authentication and never flush, reserve or send',async()=>{
   assert.equal((await call('group_directory','daily','wrong')).status,401);
   assert.equal((await call('group_directory')).body.groups.length,2);
   const preview=await call('morning_preview');assert.equal(preview.status,200);assert.equal(preview.body.reports.length,3);
   assert.equal(preview.body.reports[0].route.group_id,laborGroup);assert.equal(preview.body.reports[2].route.group_id,financeGroup);
   assert.equal(pushes.length,0);assert.equal(writes.length,0);
  });
  await t.test('labor failure never blocks finance or cash; retries preserve payload and skip accepted reports',async()=>{
   const first=await call('morning_summary');assert.equal(first.status,200);assert.deepEqual(first.body.reports.map(r=>r.state),['unknown','accepted','accepted']);
   assert.equal(pushes.length,3);
   assert.doesNotMatch(JSON.stringify(pushes[0].body),/Unpaid|キャッシュチップ/);
   assert.doesNotMatch(JSON.stringify(pushes.slice(1).map(p=>p.body)),/Synthetic worker|勤怠管理/);
   const saved=structuredClone(pushes[0]);snapshot.details[0].employee_name='Changed after reservation';
   await call('morning_summary');assert.equal(pushes.length,4);assert.deepEqual(pushes[3],saved);
   await call('morning_summary');assert.equal(pushes.length,4);
  });
  await t.test('cash zeros clear warnings without modifying case state or sending a completion report',async()=>{
   cash={[yesterday]:{lunch:0,dinner:0,lunchEntered:true,dinnerEntered:true}};
   const r=await call('morning_preview');assert.equal(r.body.reports[2].total,0);assert.equal(r.body.reports[2].messages.length,0);assert.equal(pushes.length,4);
  });
  await t.test('wrong recipient/category, disabled routes and unprivileged callers fail closed',async()=>{
   const args={p_day:day,p_group:laborGroup,p_request:guid(9),p_messages:[{type:'text',text:'【勤怠管理｜test'}],p_category:'labor',p_variant:'resend-report-v1'};
   await assert.rejects(()=>rpc('bot_reserve_morning_report',{...args,p_group:financeGroup}),/morning_summary_not_configured/);
   await assert.rejects(()=>rpc('bot_reserve_morning_report',{...args,p_messages:[{type:'text',text:'【会計管理｜test'}]}),/report_category_mismatch/);
   for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>rpc('bot_reserve_morning_report',args),/permission denied/);await db.exec('reset role');}
   await q('update bot_groups set enabled=false where group_id=$1',[laborGroup]);
   await assert.rejects(()=>rpc('bot_reserve_morning_report',args),/group_not_enabled/);
   await q('update bot_groups set enabled=true where group_id=$1',[laborGroup]);
  });
  await t.test('lifecycle trigger uses the configured category recipient',async()=>{
   for(const [n,kind] of [[1,'labor'],[2,'unpaid']]){
    await q("insert into bot_cases(source_key,kind,store_id,business_date,subject,status) values($1,$2,'TEST',$3,'Synthetic','review')",['case'+n,kind,yesterday]);
    await q("update bot_cases set status='hq_review',version=version+1 where source_key=$1",['case'+n]);
   }
   const notices=await q("select data from bot_events where kind='lifecycle_notice' order by id");
   assert.deepEqual(notices.map(n=>n.data.group_id),[laborGroup,financeGroup]);
  });
  await t.test('unconfigured labor destination stays blocked while finance and cash remain available',async()=>{
   const old=config.routes.labor;delete config.routes.labor;await saveConfig();
   const preview=await call('morning_preview');assert.equal(preview.status,200);
   assert.equal(preview.body.reports[0].route,null);assert.equal(preview.body.reports[0].route_error,'report_route_not_configured');
   assert.equal(preview.body.reports[1].route.group_id,financeGroup);
   const before=pushes.length;const r=await call('morning_summary','resend-report-v1');
   assert.equal(r.body.reports[0].error,'report_route_not_configured');assert.equal(r.body.reports[1].state,'accepted');
   assert.ok(pushes.slice(before).every(p=>p.body.to===financeGroup));
   config.routes.labor=old;await saveConfig();
  });
  await t.test('route changes during reservation prevent the old audience receiving that report',async()=>{
   changeRoute=true;const before=pushes.length;const r=await call('morning_summary','resend-details-v1');
   assert.equal(r.body.reports[0].reason,'report_route_changed');assert.ok(pushes.slice(before).every(p=>p.body.to!==laborGroup));
  });
 }finally{await db.close();}
});

test('legacy in-flight combined report cannot send after routes activate or the old group is disabled',async()=>{
 for(const transition of ['activate_routes','disable_group']){
  let config={enabled:true,group_id:financeGroup,label:'HQ'},enabled=true,pushes=0;
  const day=new Date(Date.now()-10*3600000).toISOString().slice(0,10);
  const snapshot={day,from:day,to:day,expected:1,ok:1,finance_ok:1,failed:0,active_stores:1,finance_enabled:true,counts:{labor:1,void:0,unpaid:0},detail_total:1,details:[{code:'#1',kind:'labor',store_id:'TEST',employee_name:'Synthetic worker',kinds:['short'],shifts:[],status:'review'}]};
  const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'synthetic'})[k],fetch:async(url,init)=>{
   if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
   if(url.includes('key=eq.clock'))return Response.json([{value:clock}]);
   if(url.includes('key=eq.morning_summary'))return Response.json([{value:config}]);
   if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
   if(url.includes('/bot_groups?'))return Response.json(enabled?[{group_id:financeGroup,label:'HQ',all_stores:true}]:[]);
   if(url.endsWith('bot_morning_snapshot'))return Response.json(snapshot);
   if(url.endsWith('bot_reserve_morning_summary_v3')){
    const b=JSON.parse(init.body);
    if(transition==='activate_routes')config={...config,routes:{labor:{group_id:laborGroup,label:'Corrections'},finance:{group_id:financeGroup,label:'HQ'}}};else enabled=false;
    return Response.json({id:1,data:{state:'pending',batches:[{state:'pending',request_id:guid(1),messages:b.p_messages}]}});
   }
   if(url.endsWith('/message/push')){pushes++;return new Response(null,{status:200});}
   throw Error('Unexpected '+url);
  }});
  const r=await h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':'worker'},body:JSON.stringify({action:'worker',mode:'morning_summary'})}));
  assert.equal(r.status,200);assert.equal((await r.json()).reason,'report_route_changed');assert.equal(pushes,0);
 }
});

test('requested attendance-only send does not send, flush or fetch other categories',async()=>{
 const day=new Date(Date.now()-10*3600000).toISOString().slice(0,10),pushes=[],reserves=[];
 const config={enabled:true,group_id:financeGroup,label:'HQ',routes:{labor:{group_id:laborGroup,label:'Corrections'},finance:{group_id:financeGroup,label:'HQ'}},cash_tip:{enabled:true}};
 const snapshot={day,from:day,to:day,expected:1,ok:1,finance_ok:1,failed:0,active_stores:1,finance_enabled:true,counts:{labor:1,void:1,unpaid:0},detail_total:2,details:[{code:'#1',kind:'labor',store_id:'TEST',employee_name:'Synthetic worker',kinds:['short'],shifts:[],status:'review'},{code:'#2',kind:'void',store_id:'TEST',subject:'Payment Void / #22',status:'review',amount:12}]};
 const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'synthetic'})[k],fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:clock}]);
  if(url.includes('key=eq.morning_summary'))return Response.json([{value:config}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:laborGroup,label:'Corrections',all_stores:true}]);
  if(url.endsWith('bot_morning_snapshot'))return Response.json(snapshot);
  if(url.endsWith('bot_reserve_morning_report')){const b=JSON.parse(init.body);reserves.push(b);return Response.json({id:1,data:{state:'pending',batches:[{state:'pending',request_id:guid(1),messages:b.p_messages}]}});}
  if(url.endsWith('bot_finish_morning_summary_batch'))return Response.json(null);
  if(url.endsWith('/message/push')){pushes.push(JSON.parse(init.body));return new Response(null,{status:200});}
  throw Error('Unrelated side effect or read: '+url);
 }});
 const call=category=>h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':'worker'},body:JSON.stringify({action:'worker',mode:'morning_summary',category})}));
 const r=await call('labor');assert.equal(r.status,200);const body=await r.json();
 assert.deepEqual(body.reports.map(r=>r.category),['labor']);assert.equal(body.reports[0].state,'accepted');
 assert.equal(reserves.length,1);assert.equal(reserves[0].p_category,'labor');assert.equal(pushes.length,1);assert.equal(pushes[0].to,laborGroup);
 assert.doesNotMatch(JSON.stringify(pushes),/Payment Void|キャッシュチップ|会計管理/);
 for(const category of [null,'','all','typo'])assert.equal((await call(category)).status,400);
 assert.equal(pushes.length,1);
});
