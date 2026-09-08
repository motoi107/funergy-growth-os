import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validSignature,validConfig,safePurchaseURL,laborFindings,voidFindings,unpaidFindings,financeResolution,businessDate,lineMentionMessage,dailyDisposition} from '../supabase/functions/ops-bot/handler.mjs';
const cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
const store={store_id:'TEST',name:'Test Restaurant'};
const guid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const entry=(n,from,to)=>({guid:guid(n),employeeReference:{guid:guid(99)},inDate:from,outDate:to});
const sign=async(raw,secret)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const a=await crypto.subtle.sign('HMAC',key,raw);return btoa(String.fromCharCode(...new Uint8Array(a)));};
test('signature verification uses original bytes and fails closed',async()=>{
 const raw=new TextEncoder().encode('{"events":[]}'),sig=await sign(raw,'synthetic-secret');
 assert.equal(await validSignature(raw,sig,'synthetic-secret'),true);
 assert.equal(await validSignature(new TextEncoder().encode('{ "events":[]}'),sig,'synthetic-secret'),false);
 assert.equal(await validSignature(raw,sig,''),false);
});
test('unauthenticated callers and untrusted metadata cannot access cases',async()=>{
 const calls=[];const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon'})[k];
 const h=createHandler({env,fetch:async(url)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:guid(1),user_metadata:{role:'ceo'}});if(url.includes('manager_auth'))return Response.json([]);throw Error('Unexpected private read');}});
 let r=await h(new Request('https://fn.test',{method:'POST',body:JSON.stringify({action:'list'})}));assert.equal(r.status,401);assert.equal(calls.length,0);
 r=await h(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer fake'},body:JSON.stringify({action:'list'})}));assert.equal(r.status,403);
 r=await h(new Request('https://fn.test',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}));assert.equal(r.status,403);
});
test('verified LINE receiver accepts redelivery IDs and never sends',async()=>{
 const calls=[];const secret='synthetic-secret';const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_SECRET:secret})[k];
 const h=createHandler({env,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});assert.ok(url.endsWith('/rpc/bot_ingest'));return Response.json({accepted:true});}});
 const data={events:[{webhookEventId:'test-event',type:'message',source:{groupId:'C'+'a'.repeat(32),userId:'U'+'b'.repeat(32)},message:{type:'text',text:'/order synthetic gloves'}}]};
 const raw=new TextEncoder().encode(JSON.stringify(data));
 let r=await h(new Request('https://fn.test?route=line',{method:'POST',headers:{'x-line-signature':'bad'},body:raw}));assert.equal(r.status,401);assert.equal(calls.length,0);
 r=await h(new Request('https://fn.test?route=line',{method:'POST',headers:{'x-line-signature':await sign(raw,secret)},body:raw}));assert.equal(r.status,200);assert.equal(calls[0].body.p_event_id,'test-event');
});
test('raw labor preserves GUIDs, open shifts and existing thresholds; Order Only is excluded',()=>{
 const a=entry(1,'2026-08-01T09:00:00-10:00','2026-08-01T09:08:00-10:00');
 const names=[{guid:guid(99),firstName:'Synthetic',lastName:'Person'}];
 let result=laborFindings([a],names,cfg,store,'2026-08-01');assert.equal(result[0].payload.shifts[0].guid,guid(1));assert.deepEqual(result[0].payload.kinds,['short']);
 a.outDate=null;result=laborFindings([a],names,cfg,store,'2026-08-01');assert.equal(result[0].payload.open_shift,true);
 a.outDate='2026-08-01T21:00:00-10:00';assert.equal(laborFindings([a],names,cfg,store,'2026-08-01').length,0);
 a.outDate=null;assert.equal(laborFindings([a],[{guid:guid(99),firstName:'Order',lastName:'Only'}],cfg,store,'2026-08-01').length,0);
});
test('payment Voids exclude item/check cancellations and include payment voidInfo',()=>{
 const item={guid:guid(3),voided:true,displayName:'Test item',modifiers:[{guid:guid(4),voided:true}]};
 const order={guid:guid(1),customer:{email:'do-not-copy@example.test'},checks:[{guid:guid(2),selections:[item],payments:[]}]};
 assert.equal(voidFindings([order],store,'2026-08-01').length,0);
 order.checks[0].payments=[{guid:guid(5),paymentStatus:'VOIDED',amount:20,voidInfo:{voidReason:{guid:guid(6)}}}];
 let f=voidFindings([order],store,'2026-08-01',[{guid:guid(6),name:'Synthetic reason'}]);assert.equal(f.length,1);assert.equal(f[0].payload.scope,'payment');assert.equal(f[0].payload.reason,'Synthetic reason');
 order.checks[0].voided=true;f=voidFindings([order],store,'2026-08-01');assert.equal(f.length,1);assert.equal(f[0].payload.scope,'payment');
 order.voided=true;f=voidFindings([order],store,'2026-08-01');assert.equal(f.length,1);assert.equal(f[0].payload.scope,'payment');assert.equal(JSON.stringify(f).includes('do-not-copy'),false);
});
test('settings, dates and purchase links reject malformed or unsafe values',()=>{
 assert.throws(()=>validConfig({...cfg,nightFrom:'99:99'}));assert.throws(()=>validConfig(null));assert.throws(()=>safePurchaseURL('javascript:alert(1)'));assert.throws(()=>safePurchaseURL('https://u:p@example.com'));assert.throws(()=>safePurchaseURL('https://127.0.0.1/'));assert.equal(safePurchaseURL('https://www.amazon.com/dp/TEST'),'https://www.amazon.com/dp/TEST');assert.throws(()=>businessDate('2026-02-30'));assert.throws(()=>businessDate('2099-01-01'));
});
test('all-store sends include store and assignee and retry the exact approved snapshot',async()=>{
 const group='C'+'c'.repeat(32),request=guid(12);let saved=null,pushed=[];
 const c={id:guid(10),code:'B-000000000001',store_id:'TEST',version:1,assignee:'Synthetic Manager'};
 const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',LINE_CHANNEL_ACCESS_TOKEN:'synthetic-token'})[k];
 const h=createHandler({env,fetch:async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:guid(1)});
  if(url.includes('/manager_auth?'))return Response.json([{role:'gm'}]);
  if(url.includes('/bot_cases?'))return Response.json([c]);
  if(url.includes('/bot_outbox?'))return Response.json(saved?[{body:saved.body,line_message:saved.line_message}]:[]);
  if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',name:'Test Restaurant'}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:group,store_id:null,all_stores:true}]);
  if(url.endsWith('/rpc/bot_reserve_send_v2')){const b=JSON.parse(init.body);if(saved)assert.equal(b.p_body,saved.body);else saved={id:request,group_id:group,body:b.p_body,line_message:b.p_message,state:'unknown'};return Response.json(saved);}
  if(url.endsWith('/rpc/bot_finish_send'))return Response.json(null);
  if(url==='https://api.line.me/v2/bot/message/push'){pushed.push(JSON.parse(init.body));return Response.json({}, {status:500});}
  throw Error('unexpected path');
 }});
 const call=text=>h(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({action:'send',id:c.id,version:1,request_id:request,group_id:group,text})}));
 assert.equal((await call('Please check')).status,200);
 assert.match(saved.body,/Store: Test Restaurant \(TEST\)/);assert.match(saved.body,/Assigned to: Synthetic Manager/);
 c.assignee='Changed after snapshot';
 assert.equal((await call(saved.body.replace(/^\[B-[A-F0-9]{12}\]\n/,''))).status,200);
 assert.equal(pushed.length,2);assert.deepEqual(pushed[0],pushed[1]);
});
test('minimal write responses are successful for owner, group and clock settings',async()=>{
 const saved=new Map();
 const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon'})[k];
 const h=createHandler({env,fetch:async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:guid(1)});
  if(url.includes('/manager_auth?'))return Response.json([{role:'gm'}]);
  if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',name:'Test Store'}]);
  if(init.method==='POST'&&(url.includes('/bot_settings?')||url.includes('/bot_groups?'))){const b=JSON.parse(init.body);saved.set(b.key||b.group_id,b);return new Response(null,{status:201});}
  throw Error('unexpected read/write');
 }});
 for(const body of [{action:'owner',store_id:'TEST',name:'Synthetic Manager'},{action:'group',group_id:'C'+'a'.repeat(32),all_stores:true,label:'Synthetic HQ',enabled:true},{action:'config',clock:cfg}]){
  const r=await h(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(body)}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.error,undefined);
 }
 assert.equal(saved.get('owner:TEST').value.name,'Synthetic Manager');assert.equal(saved.get('C'+'a'.repeat(32)).all_stores,true);assert.deepEqual(saved.get('clock').value,cfg);
});
test('manual default and scheduled collection call labor only; legacy item sends are rejected',async()=>{
 const calls=[];
 const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',TOAST_CLIENT_ID:'synthetic',TOAST_CLIENT_SECRET:'synthetic'})[k];
 const h=createHandler({env,fetch:async(url,init)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:guid(1)});
  if(url.includes('/manager_auth?'))return Response.json([{role:'gm'}]);
  if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',name:'Test',restaurant_guid:guid(2)}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('key=eq.collection_range'))return Response.json([]);
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'synthetic-worker'}}]);
  if(url.endsWith('/rpc/bot_take_run'))return Response.json(true);
  if(url.includes('/authentication/v1/'))return Response.json({token:{accessToken:'synthetic-toast'}});
  if(url.includes('/labor/v1/')||url.includes('/app_state?'))return Response.json([]);
  if(url.includes('/bot_runs?'))return new Response(null,{status:204});
  if(url.includes('/bot_cases?kind=in.'))return Response.json([]);
  if(url.includes('/bot_cases?id='))return Response.json([{id:guid(3),kind:'void',payload:{scope:'selection'},version:1}]);
  throw Error('unexpected_path');
 }});
 for(const action of ['scan','worker']){
  const r=await h(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic','x-bot-worker-key':'synthetic-worker'},body:JSON.stringify({action,store_id:'TEST',date:'2026-08-01'})}));assert.equal(r.status,200,await r.text());
 }
 assert.equal(calls.some(x=>x.includes('/orders/')||x.includes('/config/v2/voidReasons')),false);
 const r=await h(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({action:'send',id:guid(3),version:1})}));assert.equal((await r.json()).error,'item_void_out_of_scope');
});
test('unpaid detection excludes live-zero/cancelled checks and confirmation requires actual coverage',()=>{
 const order={guid:guid(1),checks:[{guid:guid(2),paymentStatus:'OPEN',totalAmount:20,payments:[]}]};
 let findings=unpaidFindings([order],store,'2026-08-01');assert.equal(findings.length,1);const c=findings[0];
 assert.equal(financeResolution(c,order).clean,false);
 order.checks[0].paymentStatus='CLOSED';assert.equal(financeResolution(c,order).clean,false);
 const pay={guid:guid(3),type:'CREDIT',paymentStatus:'AUTHORIZED',amount:20,tipAmount:0,paidDate:'2026-08-01T12:00:00Z'};
 order.checks[0].payments=[pay];assert.equal(financeResolution(c,order).clean,false);
 pay.paymentStatus='CAPTURED';assert.equal(financeResolution(c,order).clean,true);
 pay.refundStatus='FULL';assert.equal(financeResolution(c,order).clean,false);
 pay.refundStatus='PARTIAL';assert.equal(financeResolution(c,order).clean,false);
 pay.refund={refundAmount:0};assert.equal(financeResolution(c,order).clean,false);
 delete pay.refundStatus;
 pay.refund={refundAmount:5};assert.equal(financeResolution(c,order).clean,false);delete pay.refund;
 order.checks[0].totalAmount=10;assert.equal(financeResolution(c,order).message,'bill_changed_manual_review');
 order.checks[0].voided=true;assert.equal(financeResolution(c,order).clean,false);assert.equal(unpaidFindings([order],store,'2026-08-01').length,0);
 order.checks[0].voided=false;order.checks[0].paymentStatus='OPEN';order.checks[0].totalAmount=0;assert.equal(unpaidFindings([order],store,'2026-08-01').length,0);
});
test('payment-void recovery requires original record, unchanged bill, and replacement paid funds',()=>{
 const old={guid:guid(3),type:'CREDIT',paymentStatus:'VOIDED',amount:20,paidDate:'2026-08-01T12:00:00Z'};
 const order={guid:guid(1),checks:[{guid:guid(2),paymentStatus:'CLOSED',totalAmount:20,payments:[old]}]};
 const c=voidFindings([order],store,'2026-08-01')[0];assert.equal(financeResolution(c,order).clean,false);
 order.checks[0].payments.push({guid:guid(4),type:'CASH',amount:20,paidDate:'2026-08-01T12:00:00Z'});
 assert.equal(financeResolution(c,order).verification_type,'payment_void_recovered');
 order.checks[0].payments.shift();assert.equal(financeResolution(c,order).message,'payment_missing_manual_review');
});

test('mention payload escapes literal braces and targets only an explicit LINE user',()=>{
 const uid='U'+'a'.repeat(32),m=lineMentionMessage('Literal {assignee} {x}',uid);
 assert.equal(m.type,'textV2');assert.equal(m.text,'{assignee}\nLiteral {{assignee}} {{x}}');assert.equal(m.substitution.assignee.mentionee.userId,uid);
 assert.deepEqual(lineMentionMessage('plain',null),{type:'text',text:'plain'});assert.throws(()=>lineMentionMessage('x','all'));
});
test('registration requires a signed event in an enabled group and never auto-approves',async()=>{
 const group='C'+'a'.repeat(32),uid='U'+'b'.repeat(32),writes=[];let enabled=true;
 const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_SECRET:'secret'})[k],fetch:async(url,init)=>{
  if(url.includes('/bot_groups?'))return Response.json(enabled?[{enabled:true}]:[]);
  if(url.includes('/bot_settings?')){writes.push(JSON.parse(init.body));return new Response(null,{status:201});}throw Error('unexpected_path');
 }});
 const raw=new TextEncoder().encode(JSON.stringify({events:[{webhookEventId:'registration',type:'message',source:{groupId:group,userId:uid},message:{type:'text',text:'担当者登録 Example'}}]}));
 const call=async()=>h(new Request('https://fn.test?route=line',{method:'POST',headers:{'x-line-signature':await sign(raw,'secret')},body:raw}));
 assert.equal((await call()).status,200);assert.equal(writes.length,1);assert.equal(writes[0].key,'line_candidate:'+group+':'+uid);assert.equal(writes[0].value.approved_by,undefined);
 enabled=false;assert.equal((await call()).status,200);assert.equal(writes.length,1);
});

test('morning reminders require fresh evidence and separate technical failures',()=>{
 const c={status:'review',last_checked_at:'2026-09-08T16:00:00Z',last_check:{message:'still_flagged_or_manual_review'},payload:{fetched_at:'2026-09-08T15:00:00Z'}};
 assert.equal(dailyDisposition(c,'2026-09-08'),'action');
 assert.equal(dailyDisposition(c,'2026-09-09'),'unverified');
 assert.equal(dailyDisposition({...c,payload:{fetched_at:'2026-09-08T17:00:00Z'}},'2026-09-08'),'unverified');
 assert.equal(dailyDisposition({...c,last_check:{message:'toast_read_failed'}},'2026-09-08'),'review');
 assert.equal(dailyDisposition({...c,status:'done'},'2026-09-08'),'done');
});
test('monthly worker uses leased business dates and records failures without sending LINE',async()=>{
 let failed=false,job=true;const results=[];
 const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',TOAST_CLIENT_ID:'synthetic',TOAST_CLIENT_SECRET:'synthetic'})[k],fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'test',finance_enabled:false}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('key=eq.collection_range'))return Response.json([{value:{mode:'month_to_yesterday'}}]);
  if(url.endsWith('/rpc/bot_claim_range'))return Response.json(job?{business_date:'2026-09-01',lease_id:guid(44)}:null);
  if(url.endsWith('/rpc/bot_finish_range')){results.push(JSON.parse(init.body));return Response.json(true);}
  if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',restaurant_guid:guid(1)}]);
  if(url.endsWith('/rpc/bot_take_run'))return Response.json(true);
  if(url.includes('/authentication/v1/'))return Response.json({token:{accessToken:'test'}});
  if(url.includes('/timeEntries?')){assert.ok(url.includes('businessDate=20260901'));if(failed)return Response.json({}, {status:500});return Response.json([]);}
  if(url.includes('/bot_cases?'))return Response.json([]);
  if(url.includes('/employees')||url.includes('/app_state?'))return Response.json([]);
  if(url.includes('/bot_runs?'))return new Response(null,{status:204});
  throw Error('unexpected_call_'+url);
 }});
 const call=()=>h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':'test'},body:JSON.stringify({action:'worker',store_id:'TEST'})}));
 let res=await call();assert.equal(res.status,200);assert.equal((await res.json()).business_date,'2026-09-01');assert.equal(results[0].p_error,null);
 failed=true;res=await call();assert.equal(res.status,400);assert.equal(results[1].p_error,'toast_read_failed');
 job=false;res=await call();assert.equal((await res.json()).skipped,true);assert.equal(results.length,2);
});
test('daily page uses stable pagination, retains prior-month cases and excludes worker secrets',async()=>{
 const rows=Array.from({length:101},(_,i)=>({id:guid(i+1),status:'review',business_date:'2026-08-30',payload:{},last_checked_at:null}));
 const paths=[];const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[k],fetch:async(url)=>{
  paths.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:guid(999)});
  if(url.includes('/manager_auth?'))return Response.json([{role:'office'}]);
  if(url.endsWith('/rpc/bot_range_overview'))return Response.json({day:'2026-09-08',from:'2026-09-01',to:'2026-09-07'});
  if(url.includes('/bot_cases?'))return Response.json(rows);
  if(url.includes('/bot_outbox?'))return Response.json([{case_id:guid(1),state:'sent'}]);
  throw Error('unexpected_read');
 }});
 const res=await h(new Request('https://fn.test',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify({action:'daily',after:guid(500)})}));
 const data=await res.json();assert.equal(data.cases.length,100);assert.equal(data.next,guid(100));assert.equal(data.cases[0].daily_send,'sent');assert.equal(data.cases[0].daily_check,'unverified');
 assert.ok(paths.some(p=>p.includes('id=gt.'+guid(500))));assert.equal(paths.some(p=>p.includes('business_date=gte.')),false);
});
