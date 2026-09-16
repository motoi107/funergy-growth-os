import test from 'node:test';
import assert from 'node:assert/strict';
import {hawaiiTransactionTime,paymentVoidDetails} from '../bot/payment-details.mjs';
import {responseReceipt} from '../bot/case-replies.mjs';
import {createHandler,voidFindings} from '../supabase/functions/ops-bot/handler.mjs';

const guid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const group='C'+'d'.repeat(32),cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
const store={store_id:'TEST',name:'Synthetic Restaurant',restaurant_guid:guid(99)};
const payment={guid:guid(3),orderGuid:guid(1),checkGuid:guid(2),paymentStatus:'VOIDED',amount:17.5,paidDate:'2026-08-02T05:01:00.000+0000',voidInfo:{voidDate:'2026-08-02T08:02:03.000+0000'}};
const order={guid:guid(1),displayNumber:'900',openedDate:'2026-08-02T04:30:00Z',customer:{email:'never-copy@example.test'},checks:[{guid:guid(2),displayNumber:'11',totalAmount:17.5,payments:[payment]}]};
const detected=()=>voidFindings([structuredClone(order)],store,'2026-08-01')[0];
const fullCase=()=>({...detected(),id:guid(10),code:'#21',status:'hq_review',status_version:2,updated_at:'2026-08-02T14:00:00Z'});
const legacyCase=()=>{const c=fullCase();for(const k of ['order_number','check_number','order_opened_date','payment_paid_date'])delete c.payload[k];return c;};
const workerRequest=mode=>new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':'worker'},body:JSON.stringify({action:'worker',mode,store_id:'TEST'})});
const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',LINE_CHANNEL_ACCESS_TOKEN:'synthetic',TOAST_CLIENT_ID:'synthetic',TOAST_CLIENT_SECRET:'synthetic'})[k];

test('transaction timestamps use explicit Hawaii dates and seconds, never invented midnight',()=>{
 assert.equal(hawaiiTransactionTime('2026-08-02T08:02:03.000+0000'),'2026-08-01 22:02:03 HST');
 assert.equal(hawaiiTransactionTime('2026-08-01T22:02:03-10:00'),'2026-08-01 22:02:03 HST');
 assert.equal(hawaiiTransactionTime('2026-08-02T10:00:00Z'),'2026-08-02 00:00:00 HST');
 for(const value of [null,'bad','2026-08-01','2026-08-01T22:02:03'])assert.match(hawaiiTransactionTime(value),/Unavailable/);
});

test('void collection retains distinct order, check and payment identities without changing evidence',()=>{
 const one=detected(),two=voidFindings([{...order,checks:[{...order.checks[0],payments:[{...payment,guid:guid(4),amount:12,voidInfo:{voidDate:'2026-08-02T08:04:05Z'}}]}]}],store,'2026-08-01')[0];
 assert.equal(one.payload.order_number,'900');assert.equal(one.payload.check_number,'11');assert.equal(one.payload.payment_paid_date,payment.paidDate);
 assert.equal(one.payload.fingerprint,JSON.stringify({amount:17.5,total:17.5,void:payment.voidInfo,status:'VOIDED'}));
 assert.notEqual(one.source_key,two.source_key);assert.notEqual(paymentVoidDetails(one),paymentVoidDetails(two));
 assert.equal(JSON.stringify(one).includes('never-copy'),false);
 const text=responseReceipt(fullCase());assert.match(text,/案件 \/ Case: #21/);assert.match(text,/Order #: #900/);assert.match(text,/Check #: #11/);assert.match(text,/Voided: 2026-08-01 22:02:03 HST/);assert.match(text,/Amount: \$17\.50/);
 const old=responseReceipt(legacyCase());assert.match(old,/Order #: 未取得/);assert.match(old,/Legacy ref: #11/);assert.doesNotMatch(old,/Order #: #11/);
 const absent=paymentVoidDetails({kind:'void',payload:{amount:0}});assert.match(absent,/Amount: \$0\.00/);assert.match(absent,/Voided: 未取得/);
});

test('the actual scan path preserves order metadata for payments voided on a later business day',async()=>{
 const findings=[];
 const h=createHandler({env:k=>k==='LINE_CHANNEL_ACCESS_TOKEN'?null:env(k),fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker',finance_enabled:true}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('key=eq.collection_range'))return Response.json([]);
  if(url.includes('/store_config?'))return Response.json([store]);
  if(url.endsWith('/rpc/bot_take_run'))return Response.json(true);
  if(url.endsWith('/authentication/login'))return Response.json({token:{accessToken:'synthetic'}});
  if(url.includes('/labor/')||url.includes('/app_state?')||url.includes('/ordersBulk?')||url.includes('/config/v2/'))return Response.json([]);
  if(url.includes('/payments?voidBusinessDate='))return Response.json([payment.guid]);
  if(url.endsWith('/payments/'+payment.guid))return Response.json(payment);
  if(url.endsWith('/orders/'+order.guid))return Response.json(order);
  if(url.endsWith('/rpc/bot_case_write')){findings.push(JSON.parse(init.body).p_data);return Response.json({});}
  if(url.includes('/bot_runs?'))return new Response(null,{status:204});
  if(url.includes('/bot_cases?'))return Response.json([]);
  throw Error(url);
 }});
 const result=await h(workerRequest('scan'));assert.equal(result.status,200);assert.equal(findings.length,1);
 assert.equal(findings[0].payload.order_number,'900');assert.equal(findings[0].payload.check_number,'11');assert.equal(findings[0].payload.order_opened_date,order.openedDate);
});

function lifecycleHarness({legacy=false,toastFail=false,race=false,mismatch=false,closeDuringLookup=false,disableDuringLookup=false}={}){
 let current=legacyCase(),orderReads=0,attempts=0,groupEnabled=true;
 const original={code:current.code,store_id:current.store_id,subject:current.subject,status:current.status,status_version:2,payload:{store_name:store.name,response:null,returned:null,closure:null}};
 let data={state:legacy?'unknown':'pending',group_id:group,request_id:guid(20),case:original};
 const pushes=[],writes=[];
 const h=createHandler({env,fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('kind=eq.lifecycle_notice'))return Response.json(['pending','unknown'].includes(data.state)?[{id:1,case_id:current.id,created_at:new Date().toISOString(),data:structuredClone(data)}]:[]);
  if(url.includes('/bot_groups?'))return Response.json(groupEnabled?[{all_stores:true}]:[]);
  if(url.includes('/bot_cases?id='))return Response.json([current]);
  if(url.includes('/bot_cases?kind='))return Response.json([]);
  if(url.includes('/store_config?'))return Response.json([store]);
  if(url.endsWith('/authentication/login'))return Response.json({token:{accessToken:'synthetic'}});
  if(url.endsWith('/orders/'+order.guid)){orderReads++;if(closeDuringLookup)current={...current,status:'done',status_version:3};if(disableDuringLookup)groupEnabled=false;return toastFail?new Response(null,{status:503}):Response.json({...order,guid:mismatch?guid(999):order.guid});}
  if(url.includes('/bot_events?id=eq.1')){
   if(init.method==='GET')return Response.json([{data}]);
   const next=JSON.parse(init.body).data;writes.push(next);
   if(url.includes('line_message=is.null')&&race){data={...next,line_message:{type:'text',text:'Already frozen by the other worker'}};return Response.json([]);}
   data=next;return init.headers.Prefer==='return=representation'?Response.json([{data}]):new Response(null,{status:204});
  }
  if(url.endsWith('/message/push')){
   assert.ok(data.line_message,'persist before send');pushes.push({key:init.headers['X-Line-Retry-Key'],body:JSON.parse(init.body)});
   current={...current,payload:{...current.payload,amount:999}};return new Response(null,{status:++attempts===1?500:200});
  }
  throw Error(url);
 }});
 return {run:()=>h(workerRequest('monitor')),pushes,writes,original,get data(){return data;},get orderReads(){return orderReads;}};
}

test('HQ notices hydrate the stripped event and freeze identical retries before LINE delivery',async()=>{
 const f=lifecycleHarness();assert.equal((await f.run()).status,200);assert.equal(f.data.state,'sent');assert.equal(f.pushes.length,2);
 assert.deepEqual(f.pushes[0],f.pushes[1]);assert.equal(f.orderReads,1);
 const text=f.pushes[0].body.messages[0].text;
 assert.match(text,/Order #: #900/);assert.match(text,/Check #: #11/);assert.match(text,/Voided: 2026-08-01 22:02:03 HST/);assert.match(text,/Amount: \$17\.50/);assert.doesNotMatch(text,/999/);
 assert.match(text,/#21 承認して終了/);assert.match(text,/Awaiting HQ review/);
});

test('legacy unknown delivery retries its original message without changing a possibly delivered body',async()=>{
 const f=lifecycleHarness({legacy:true});assert.equal((await f.run()).status,200);
 assert.equal(f.orderReads,0);assert.equal(f.pushes[0].body.messages[0].text,responseReceipt(f.original,{includeTransaction:false})+'\n#21 承認して終了 理由 / approve reason\n#21 差し戻し 理由 / return reason');
 assert.deepEqual(f.pushes[0],f.pushes[1]);
});

test('unavailable Toast and mismatched orders keep saved void dates and never guess order numbers',async()=>{
 for(const options of [{toastFail:true},{mismatch:true}]){
  const f=lifecycleHarness(options);assert.equal((await f.run()).status,200);assert.equal(f.data.state,'sent');
  const text=f.pushes[0].body.messages[0].text;assert.match(text,/Order #: 未取得/);assert.match(text,/Legacy ref: #11/);assert.match(text,/Voided: 2026-08-01 22:02:03 HST/);assert.match(text,/Amount: \$17\.50/);
 }
});

test('concurrent lifecycle workers send only the first atomically frozen body',async()=>{
 const f=lifecycleHarness({race:true});assert.equal((await f.run()).status,200);
 assert.equal(f.pushes[0].body.messages[0].text,'Already frozen by the other worker');assert.deepEqual(f.pushes[0],f.pushes[1]);
});

test('lifecycle delivery revalidates closure and destination after the external lookup',async()=>{
 for(const options of [{closeDuringLookup:true},{disableDuringLookup:true}]){
  const f=lifecycleHarness(options);assert.equal((await f.run()).status,200);
  assert.equal(f.orderReads,1);assert.equal(f.pushes.length,0);assert.equal(f.data.state,'cancelled');
 }
});

test('morning finance and completed reports include transaction identity while reusing one Toast read',async()=>{
 const c=legacyCase(),closed={...c,code:'#22',status:'done',closed_at:'2026-08-02T15:00:00Z'},pushes=[];let reserved,orderReads=0;
 const detail={code:c.code,kind:'void',store_id:'TEST',store_name:store.name,business_date:c.business_date,subject:c.subject,status:c.status,amount:17.5};
 const h=createHandler({env,fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
  if(url.includes('key=eq.morning_summary'))return Response.json([{value:{enabled:true,group_id:group,label:'HQ'}}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:group,label:'HQ',all_stores:true}]);
  if(url.endsWith('/rpc/bot_morning_snapshot'))return Response.json({day:'2026-08-02',snapshot_at:'2026-08-02T16:00:00Z',details:[detail],detail_total:1,counts:{void:1},stores:[],recent_closed:[{code:'#22',kind:'void',store_id:'TEST',subject:c.subject,closed_at:closed.closed_at,closure:{actor:'Synthetic reviewer',note:'Checked'}}]});
  if(url.includes('/bot_cases?code=in.'))return Response.json([c,closed]);
  if(url.includes('/store_config?'))return Response.json([store]);
  if(url.endsWith('/authentication/login'))return Response.json({token:{accessToken:'synthetic'}});
  if(url.endsWith('/orders/'+order.guid)){orderReads++;return Response.json(order);}
  if(url.endsWith('/rpc/bot_reserve_morning_summary_v3')){reserved=JSON.parse(init.body);return Response.json({id:1,data:{state:'pending',batches:[{state:'pending',messages:reserved.p_messages,request_id:guid(20)}]}});}
  if(url.endsWith('/rpc/bot_finish_morning_summary_batch'))return Response.json(null);
  if(url.endsWith('/message/push')){pushes.push(JSON.parse(init.body));return new Response(null,{status:200});}
  throw Error(url);
 }});
 assert.equal((await h(workerRequest('morning_summary'))).status,200);assert.equal(orderReads,1);assert.equal(reserved.p_variant,'daily');
 const text=reserved.p_messages.map(m=>m.text).join('\n');assert.equal((text.match(/Order #: #900/g)||[]).length,2);assert.equal((text.match(/Voided: 2026-08-01 22:02:03 HST/g)||[]).length,2);
 assert.match(text,/勤怠管理/);assert.match(text,/会計管理/);assert.match(text,/案件：#21/);assert.match(text,/案件：#22/);assert.ok(reserved.p_messages.every(m=>m.text.length<=4900));assert.equal(pushes.length,1);
});

test('snapshots never borrow newer transaction details, including reopened and reclosed findings',async()=>{
 for(const state of [{status:'review',closed_at:null},{status:'done',closed_at:'2026-08-02T17:00:00Z'},{status:'hq_review',updated_at:'2026-08-02T17:00:00Z'}]){
  let reserved;
  const c=fullCase(),closed={code:c.code,kind:c.kind,store_id:c.store_id,subject:c.subject,closed_at:'2026-08-02T15:00:00Z',closure:{actor:'Synthetic reviewer',note:'Earlier closure'}};
  const h=createHandler({env,fetch:async(url,init)=>{
   if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
   if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
   if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
   if(url.includes('key=eq.morning_summary'))return Response.json([{value:{enabled:true,group_id:group,label:'HQ'}}]);
   if(url.includes('/bot_groups?'))return Response.json([{group_id:group,label:'HQ',all_stores:true}]);
   if(url.endsWith('/rpc/bot_morning_snapshot'))return Response.json({day:'2026-08-02',snapshot_at:'2026-08-02T16:00:00Z',details:state.status==='hq_review'?[{...closed,amount:17.5,status:'hq_review'}]:[],detail_total:state.status==='hq_review'?1:0,counts:state.status==='hq_review'?{void:1}:{},stores:[],recent_closed:state.status==='hq_review'?[]:[closed]});
   if(url.includes('/bot_cases?code=in.'))return Response.json([{...c,...state,payload:{...c.payload,void_date:'2026-08-02T16:00:00Z'}}]);
   if(url.endsWith('/rpc/bot_reserve_morning_summary_v3')){reserved=JSON.parse(init.body);return Response.json({id:1,data:{state:'pending',batches:[{state:'pending',messages:reserved.p_messages,request_id:guid(20)}]}});}
   if(url.endsWith('/rpc/bot_finish_morning_summary_batch'))return Response.json(null);
   if(url.endsWith('/message/push'))return new Response(null,{status:200});
   throw Error(url);
  }});
  assert.equal((await h(workerRequest('morning_summary'))).status,200);
  const text=reserved.p_messages.map(m=>m.text).join('\n');if(state.status!=='hq_review')assert.match(text,/Earlier closure/);assert.match(text,/Voided: 未取得/);assert.doesNotMatch(text,/Order #: #900|06:00:00/);
 }
});
