import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validSignature,validConfig,safePurchaseURL,laborFindings,voidFindings,businessDate} from '../supabase/functions/ops-bot/handler.mjs';
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
test('Void collection includes voided selections and references without copying customer data',()=>{
 const f=voidFindings([{guid:guid(1),customer:{email:'do-not-copy@example.test'},checks:[{guid:guid(2),selections:[{guid:guid(3),voided:true,displayName:'Test item',price:10,voidInformation:{voidReason:{guid:guid(4)}}}]}]}],store,'2026-08-01');
 assert.equal(f.length,1);assert.equal(f[0].payload.reason_guid,guid(4));assert.equal(JSON.stringify(f).includes('do-not-copy'),false);
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
  if(url.includes('/bot_outbox?'))return Response.json(saved?[{body:saved.body}]:[]);
  if(url.includes('/store_config?'))return Response.json([{store_id:'TEST',name:'Test Restaurant'}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:group,store_id:null,all_stores:true}]);
  if(url.endsWith('/rpc/bot_reserve_send')){const b=JSON.parse(init.body);if(saved)assert.equal(b.p_body,saved.body);else saved={id:request,group_id:group,body:b.p_body,state:'unknown'};return Response.json(saved);}
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
