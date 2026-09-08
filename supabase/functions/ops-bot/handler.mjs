import { createClockDetector } from '../../../bot/clock-detector.mjs';
const ROLES=['ceo','gm','office','office_crew'], APPROVERS=['ceo','gm','office'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const enc=new TextEncoder();
export function dailyDisposition(c,day){
 if(c.status==='done')return 'done';
 const checked=c.last_checked_at&&new Date(new Date(c.last_checked_at).getTime()-10*3600000).toISOString().slice(0,10);
 if(checked!==day||(c.payload?.fetched_at&&Date.parse(c.last_checked_at)<Date.parse(c.payload.fetched_at)))return 'unverified';
 return ['still_flagged_or_manual_review','payment_not_confirmed','payment_coverage_incomplete'].includes(c.last_check?.message)?'action':'review';
}

export function validConfig(c){
  if(!c||!/^([01]?\d|2[0-3]):[0-5]\d$/.test(c.nightFrom)||!/^([01]?\d|2[0-3]):[0-5]\d$/.test(c.nightTo)||!(Number(c.longH)>0&&Number(c.longH)<=24)||!(Number(c.shortMin)>0&&Number(c.shortMin)<=240)) throw Error('invalid_config');
  return {nightFrom:c.nightFrom,nightTo:c.nightTo,longH:Number(c.longH),shortMin:Number(c.shortMin)};
}
export function safePurchaseURL(input){
  let u;try{u=new URL(input);}catch{throw Error('invalid_url');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/\.(local|internal)$/i.test(u.hostname)) throw Error('invalid_url');
  return u.href;
}
export function businessDate(input,now=Date.now()){
  if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input))throw Error('invalid_date');
  const d=new Date(input+'T00:00:00Z');
  if(!isFinite(d.getTime())||d.toISOString().slice(0,10)!==input||input>=new Date(now-10*3600000).toISOString().slice(0,10))throw Error('closed_day_required');return input;
}
export async function validSignature(raw,signature,secret){
  if(!secret||!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),raw);
}
function orderOnly(name){const n=String(name||'').toLowerCase().replace(/[\s_\-.]/g,'');return n.includes('orderonly')||n==='order';}
export function laborFindings(entries,employees,cfg,store,date,override=false){
  validConfig(cfg);const names=new Map(employees.map(e=>[e.guid,((e.firstName||'')+' '+(e.lastName||'')).trim()||e.name||e.guid]));
  const people={};
  for(const te of entries){
    const id=te.employeeReference?.guid;
    if(te.deleted||!te.guid||!id||orderOnly(names.get(id)))continue;
    (people[id]??=[]).push({guid:te.guid,inDate:te.inDate??null,outDate:te.outDate??null,employee_guid:id,autoClockedOut:te.autoClockedOut===true});
  }
  const effective=Object.fromEntries(Object.entries(people).map(([id,shifts])=>[id,{shifts}]));
  const detector=createClockDetector({getCeCfg:()=>cfg,getTipLabor:()=>effective});
  return detector.ceScanDay(store.store_id,date).rows.map(r=>({
    source_key:'labor:'+store.store_id+':'+date+':'+r.name,kind:'labor',store_id:store.store_id,business_date:date,
    subject:(names.get(r.name)||r.name)+' / '+r.kinds.join(', '),
    payload:{employee_guid:r.name,employee_name:names.get(r.name)||r.name,store_name:store.name,kinds:r.kinds,shifts:people[r.name],cfg,override,source:'toast_direct',fetched_at:new Date().toISOString(),
      fingerprint:JSON.stringify({shifts:people[r.name],kinds:r.kinds,cfg,override}),
      open_shift:people[r.name].some(x=>!x.outDate),draft:''}
  }));
}
// Only payment-level Voids; item/check/order cancellations are not payment failures.
export function paymentIsVoided(p){return p.paymentStatus==='VOIDED'||(p.type!=='CREDIT'&&!!p.voidInfo?.voidDate);}
export function voidFindings(orders,store,date,reasons=[],employees=[]){
 const reasonNames=new Map(reasons.map(x=>[x.guid,x.name]));
 const staffNames=new Map(employees.map(x=>[x.guid,((x.firstName||'')+' '+(x.lastName||'')).trim()||x.name||x.guid]));
 const rows=[];
 for(const order of orders)for(const check of order.checks||[])for(const pay of check.payments||[]){
  if(!pay.guid||!paymentIsVoided(pay))continue;const vi=pay.voidInfo||{},reason=vi.voidReason?.guid;
  rows.push({source_key:'void:'+store.store_id+':'+pay.guid,kind:'void',store_id:store.store_id,business_date:date,subject:'Payment Void / #'+(check.displayNumber||order.displayNumber||pay.guid),payload:{store_name:store.name,order_guid:order.guid,check_guid:check.guid,entity_guid:pay.guid,scope:'payment',check_total:check.totalAmount??null,amount:pay.amount??null,reason:reasonNames.get(reason)||null,user_name:staffNames.get(vi.voidUser?.guid)||null,approver_name:staffNames.get(vi.voidApprover?.guid)||null,reason_guid:reason||null,user_guid:vi.voidUser?.guid||null,approver_guid:vi.voidApprover?.guid||null,void_date:vi.voidDate||null,source:'toast_direct',fetched_at:new Date().toISOString()}});
 }
 return rows;
}
export function unpaidFindings(orders,store,date){
 const rows=[];
 for(const order of orders){if(order.deleted||order.voided)continue;
  for(const c of order.checks||[]){
   if(!c.guid||c.deleted||c.voided||c.paymentStatus!=='OPEN'||!(Number(c.totalAmount??c.amount)>0))continue;
   rows.push({source_key:'unpaid:'+store.store_id+':'+c.guid,kind:'unpaid',store_id:store.store_id,business_date:date,subject:'Unpaid / #'+(c.displayNumber||order.displayNumber||c.guid),payload:{store_name:store.name,order_guid:order.guid,check_guid:c.guid,amount:c.totalAmount??c.amount,payment_status:c.paymentStatus,source:'toast_direct',fingerprint:JSON.stringify({status:c.paymentStatus,total:c.totalAmount??c.amount}),fetched_at:new Date().toISOString()}});
  }
 }
 return rows;
}
export function financeResolution(c,order){
 const no=reason=>({clean:false,message:reason});
 if(!order||order.guid!==c.payload.order_guid||order.deleted||order.voided)return no('order_missing_or_cancelled_review');
 const checks=(order.checks||[]).filter(x=>x.guid===c.payload.check_guid);if(checks.length!==1)return no('check_missing_manual_review');const check=checks[0];
 if(check.deleted||check.voided)return no('check_cancelled_manual_review');
 if(c.kind==='void'&&(check.payments||[]).filter(p=>p.guid===c.payload.entity_guid).length!==1)return no('payment_missing_manual_review');
 // CLOSED alone can follow a write-off/discount. Require a positive bill, unchanged amount for
 // unpaid cases, and captured/non-card paid funds covering the total, including tips.
 const total=Number(check.totalAmount);if(check.paymentStatus!=='CLOSED'||!Number.isFinite(total)||total<=0)return no('payment_not_confirmed');
 if(c.kind==='void'&&(!Number.isFinite(Number(c.payload.check_total))||Number(c.payload.check_total)<=0||Math.round(total*100)!==Math.round(Number(c.payload.check_total)*100)))return no('bill_changed_manual_review');
 if(c.kind==='unpaid'&&Math.round(total*100)!==Math.round(Number(c.payload.amount)*100))return no('bill_changed_manual_review');
 let received=0;const ids=[];
 for(const p of check.payments||[]){
  if(paymentIsVoided(p)||!p.guid||!p.paidDate)continue;
  if(p.type==='CREDIT'?p.paymentStatus!=='CAPTURED':!['CASH','GIFTCARD','HOUSE_ACCOUNT','REWARDCARD','LEVELUP','TOAST_SV','OTHER'].includes(p.type))continue;
  if(p.type!=='CREDIT'&&['CANCELLED','ERROR','ERROR_NETWORK','DENIED','PROCESSING_VOID'].includes(p.paymentStatus))continue;
  if(p.refundStatus==='FULL'||(p.refundStatus&&!['NONE','PARTIAL'].includes(p.refundStatus)))continue;
  if((p.refundStatus==='PARTIAL'||p.refund)&&(!p.refund||typeof p.refund.refundAmount!=='number'||typeof p.refund.tipRefundAmount!=='number'))continue;
  const values=[p.amount,p.tipAmount??0,p.refund?.refundAmount??0,p.refund?.tipRefundAmount??0].map(Number);
  if(values.some(x=>!Number.isFinite(x)||x<0))continue;
  const net=values[0]+values[1]-values[2]-values[3];if(net<=0)continue;received+=Math.round(net*100);ids.push(p.guid);
 }
 if(received<Math.round(total*100))return no('payment_coverage_incomplete');
 return {clean:true,verification_type:c.kind==='unpaid'?'unpaid_paid':'payment_void_recovered',check_guid:check.guid,payment_guids:ids,total,received:received/100};
}
export function lineMentionMessage(text,user){
 if(!user)return {type:'text',text};
 if(!/^U[a-f0-9]{32}$/i.test(user))throw Error('invalid_line_user');
 const escaped=text.replaceAll('{','{{').replaceAll('}','}}');
 if(escaped.length+12>5000)throw Error('invalid_message');
 return {type:'textV2',text:'{assignee}\n'+escaped,substitution:{assignee:{type:'mention',mentionee:{type:'user',userId:user}}}};
}
export function formatMorningSummary(s){
 const n=k=>Number(s?.counts?.[k]||0),complete=Number(s?.active_stores)>0&&s?.finance_enabled===true&&Number(s?.ok)===Number(s?.expected)&&Number(s?.finance_ok)===Number(s?.expected)&&Number(s?.failed)===0;
 const labor=n('labor'),voids=n('void'),unpaid=n('unpaid'),total=labor+voids+unpaid;
 const period=Number(s.expected)===0&&Number(s.active_stores)>0?'当月は対象日なし / No completed days this month':s.from+' - '+s.to;
 const lines=['【業務Bot 朝の確認 / Morning Check】','対象 / Period: '+period,
  '勤怠エラー / Timecard: '+labor+'件','決済Void / Payment Void: '+voids+'件','未決済 / Unpaid: '+unpaid+'件'];
 if(Number(s?.active_stores)===0)lines.push('取得元 / Stores: 有効店舗なし・要確認 / No active stores');
 if(s?.finance_enabled!==true||Number(s?.finance_ok)!==Number(s?.expected))lines.push('決済監視 / Finance collection: 未完了・要確認 ('+Number(s?.finance_ok||0)+'/'+Number(s?.expected||0)+')');
 if(!complete)lines.push('取得状況 / Collection: 未完了・要確認 ('+Number(s.ok||0)+'/'+Number(s.expected||0)+'、失敗 / Failed '+Number(s.failed||0)+')');
 else if(total===0)lines.push('異常はありません / No unresolved issues.');
 else lines.push('未解決 合計 / Total unresolved: '+total+'件');
 for(const row of s.stores||[])lines.push(row.store_name+' ('+row.store_id+'): 勤怠 '+Number(row.labor||0)+' / Void '+Number(row.void||0)+' / 未決済 '+Number(row.unpaid||0));
 lines.push(complete?'取得完了 / Collection complete':'「異常なし」ではありません。取得結果を確認してください。 / Do not treat this as all clear.');
 const text=lines.join('\n');if(text.length>4900)throw Error('invalid_message');return {text,complete,total};
}
export function createHandler({env,fetch:fetcher=globalThis.fetch}){
 const sb=env('SUPABASE_URL'), service=env('SUPABASE_SERVICE_ROLE_KEY'), anon=env('SUPABASE_ANON_KEY');
 const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
 const timed=(url,init={})=>fetcher(url,{...init,signal:AbortSignal.timeout(20000)});
 async function db(path,method='GET',body,prefer){
  const r=await timed(sb+'/rest/v1/'+path,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok){const j=await r.json().catch(()=>({}));const known=['conflict','forbidden','not_found','send_unresolved','retry_mismatch','failed_send_requires_new_review','retry_expired_check_line','group_not_enabled','closed_case','purchase_details_required','order_number_required','invalid_state','note_required','assignee_required','daily_date_changed','daily_already_prepared','recheck_required'];throw Error(known.find(x=>j.message?.includes(x))||(r.status===409?'conflict':'database_error'));}
  // PostgREST minimal writes can return 201 with an empty body.
  const text=await r.text();return text.trim()?JSON.parse(text):null;
 }
 const rpc=(name,args)=>db('rpc/'+name,'POST',args);
 const setting=async key=>(await db('bot_settings?key=eq.'+key+'&select=value'))[0]?.value||null;
 async function authorize(req){
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer ')||authorization==='Bearer '+anon)throw Error('unauthorized');
  const r=await timed(sb+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}});
  if(!r.ok)throw Error('unauthorized');const u=await r.json();if(!u.id)throw Error('unauthorized');
  const roles=await db('manager_auth?user_id=eq.'+encodeURIComponent(u.id)+'&select=role');
  if(roles.length===1&&ROLES.includes(roles[0].role))return {id:u.id,role:roles[0].role};
  const members=await db('bot_users?user_id=eq.'+encodeURIComponent(u.id)+'&enabled=eq.true&select=user_id');
  if(members.length!==1)throw Error('forbidden');
  return {id:u.id,role:'office_crew',bot_only:true};
 }
 async function getStore(id){const a=await db('store_config?store_id=eq.'+encodeURIComponent(id)+'&active=eq.true&select=store_id,restaurant_guid,name');if(a.length!==1)throw Error('invalid_store');return a[0];}
 async function toastClient(store){
  if(!env('TOAST_CLIENT_ID')||!env('TOAST_CLIENT_SECRET'))throw Error('toast_not_configured');
  const r=await timed('https://ws-api.toasttab.com/authentication/v1/authentication/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:env('TOAST_CLIENT_ID'),clientSecret:env('TOAST_CLIENT_SECRET'),userAccessType:'TOAST_MACHINE_CLIENT'})});
  if(!r.ok)throw Error('toast_auth_failed');const token=(await r.json())?.token?.accessToken;if(!token)throw Error('toast_auth_failed');
  return async (path,object=false)=>{
   let url=new URL('https://ws-api.toasttab.com'+path),all=[],seen=new Set();
   for(let page=0;page<40;page++){
    const r=await timed(url.href,{headers:{Authorization:'Bearer '+token,'Toast-Restaurant-External-ID':store.restaurant_guid}});
    if(!r.ok)throw Error(r.status===429?'toast_rate_limited':'toast_read_failed');const j=await r.json();if(object){if(!j||Array.isArray(j)||typeof j!=='object')throw Error('toast_invalid_response');return j;}if(!Array.isArray(j))throw Error('toast_invalid_response');all.push(...j);
    const next=r.headers.get('Toast-Next-Page-Token');if(!next)return all;if(seen.has(next))throw Error('toast_pagination_loop');seen.add(next);url.searchParams.set('pageToken',next);
   }
   throw Error('toast_pagination_limit');
  };
 }
 async function scan(storeID,date,actor,withVoids=false){
  const store=await getStore(storeID),cfg=validConfig(await setting('clock'));
  if(!(await rpc('bot_take_run',{p_store:storeID})))throw Error('scan_busy');
  try{
   const get=await toastClient(store),bd=date.replaceAll('-','');
   const entries=await get('/labor/v1/timeEntries?businessDate='+bd),employees=await get('/labor/v1/employees');
   const overrides=await db('app_state?key=eq.'+encodeURIComponent('att_override_'+storeID+'_'+date)+'&select=value');
   const override=!!overrides[0]?.value?.data;
   const findings=laborFindings(entries,employees,cfg,store,date,override);
   if(withVoids){const orders=[];let complete=false;
    for(let page=1;page<=40;page++){const batch=await get('/orders/v2/ordersBulk?businessDate='+bd+'&pageSize=100&page='+page);orders.push(...batch);if(batch.length<100){complete=true;break;}}
    if(!complete)throw Error('toast_pagination_limit');
    findings.push(...unpaidFindings(orders,store,date));
    // voidBusinessDate also finds a payment voided today for an older order.
    const ids=await get('/orders/v2/payments?voidBusinessDate='+bd);
    if(ids.length>100||ids.some(id=>!UUID.test(id)))throw Error('payment_batch_requires_review');
    let reasons=[];try{reasons=await get('/config/v2/voidReasons');}catch{/* Keep reason IDs. */}
    const payments=[];
    for(const id of [...new Set(ids)]){const pay=await get('/orders/v2/payments/'+id,true);if(pay.guid!==id||!UUID.test(pay.orderGuid||'')||!UUID.test(pay.checkGuid||''))throw Error('toast_invalid_response');const order=orders.find(o=>o.guid===pay.orderGuid)||await get('/orders/v2/orders/'+pay.orderGuid,true);if(order.guid!==pay.orderGuid)throw Error('toast_invalid_response');const check=(order.checks||[]).find(c=>c.guid===pay.checkGuid);payments.push({guid:pay.orderGuid,checks:[{guid:pay.checkGuid,displayNumber:check?.displayNumber,totalAmount:check?.totalAmount,payments:[pay]}]});}
    findings.push(...voidFindings(payments,store,date,reasons,employees));
   }
   for(const f of findings)await rpc('bot_case_write',{p_op:'finding',p_actor:actor,p_data:f});
   await db('bot_runs?store_id=eq.'+encodeURIComponent(storeID),'PATCH',{running_until:null,last_success:new Date().toISOString(),last_error:null});
   return {created_or_matched:findings.length,override,entries:entries.length};
  }catch(e){await db('bot_runs?store_id=eq.'+encodeURIComponent(storeID),'PATCH',{running_until:null,last_error:String(e.message).slice(0,80)}).catch(()=>{});throw e;}
 }
 async function rangeRun(storeID){
  const job=await rpc('bot_claim_range',{p_store:storeID});
  if(!job)return {skipped:true,range_complete_or_waiting:true};
  try{
   const cfg=await setting('worker');
   const result=await scan(storeID,job.business_date,null,cfg?.finance_enabled===true);
   const start=Date.now(),pending=await db('bot_cases?kind=in.(labor,void,unpaid)&status=neq.done&or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&store_id=eq.'+encodeURIComponent(storeID)+'&business_date=eq.'+job.business_date+'&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20');
   for(const c of pending){if(Date.now()-start>45000)break;try{await recheck(c,null);}catch{/* Evidence failures stay unresolved and are shown separately. */}}
   await rpc('bot_finish_range_v2',{p_store:storeID,p_date:job.business_date,p_lease:job.lease_id,p_error:null,p_finance:cfg?.finance_enabled===true});
   return {...result,business_date:job.business_date,range:true};
  }catch(e){
   await rpc('bot_finish_range_v2',{p_store:storeID,p_date:job.business_date,p_lease:job.lease_id,p_error:/^[a-z_]+$/.test(e.message)?e.message:'scan_failed',p_finance:false}).catch(()=>{});
   throw e;
  }
 }
 async function dailyOverview(after){
  if(after!==undefined&&after!==null&&!UUID.test(after))throw Error('invalid_cursor');
  const overview=await rpc('bot_range_overview',{});
  // Prior-month unresolved cases remain in reminders and in the hourly monitor.
  const rows=await db('bot_cases?kind=in.(labor,void,unpaid)&status=neq.done&or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&business_date=lt.'+overview.day+'&order=id.asc&limit=101'+(after?'&id=gt.'+after:''));
  const cases=rows.slice(0,100);
  const sends=cases.length?await db('bot_outbox?case_id=in.('+cases.map(c=>c.id).join(',')+')&reminder_date=eq.'+overview.day+'&state=in.(sent,pending,unknown)&select=case_id,state'):[];
  for(const c of cases){c.daily_send=sends.find(o=>o.case_id===c.id)?.state||null;c.daily_check=dailyDisposition(c,overview.day);}
  return {overview,cases,next:rows.length>100?cases.at(-1).id:null};
 }
 async function morningSummary(){
  const cfg=await setting('morning_summary');
  if(!cfg?.enabled)return {skipped:true,reason:'morning_summary_disabled'};
  if(!/^C[a-f0-9]{32}$/i.test(cfg.group_id||'')||!cfg.label)throw Error('morning_summary_not_configured');
  const groups=await db('bot_groups?group_id=eq.'+encodeURIComponent(cfg.group_id)+'&enabled=eq.true&select=group_id,label,all_stores');
  if(groups.length!==1||groups[0].all_stores!==true||groups[0].label!==cfg.label)throw Error('group_not_enabled');
  if(!env('LINE_CHANNEL_ACCESS_TOKEN'))throw Error('line_token_missing');
  const snapshot=await rpc('bot_morning_snapshot',{}),formatted=formatMorningSummary(snapshot);
  const reserved=await rpc('bot_reserve_morning_summary',{p_day:snapshot.day,p_group:cfg.group_id,p_request:crypto.randomUUID(),p_message:{type:'text',text:formatted.text}});
  if(reserved.data?.state==='accepted')return {state:'accepted',already_sent:true,day:snapshot.day};
  if(reserved.data?.state==='failed')return {state:'failed',review_required:true,day:snapshot.day};
  const message=reserved.data?.message,request=reserved.data?.request_id;
  if(!UUID.test(request||'')||message?.type!=='text'||typeof message.text!=='string')throw Error('morning_summary_invalid_reservation');
  let state='unknown',status=null,lineRequest=null;
  try{
   const r=await timed('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json','X-Line-Retry-Key':request},body:JSON.stringify({to:cfg.group_id,messages:[message]})});
   status=r.status;lineRequest=r.headers.get('x-line-request-id');state=r.ok||(r.status===409&&!!r.headers.get('x-line-accepted-request-id'))?'accepted':r.status>=400&&r.status<500&&r.status!==429?'failed':'unknown';
  }catch{state='unknown';}
  await rpc('bot_finish_morning_summary',{p_event:reserved.id,p_state:state,p_status:status,p_line_request:lineRequest});
  return {state,day:snapshot.day,complete:formatted.complete,total:formatted.total,line_status:status};
 }
 async function recheck(c,actor){
  try{return await checkCase(c,actor);}catch(e){await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:{clean:false,message:/^[a-z_]+$/.test(e.message)?e.message:'verification_failed',checked_at:new Date().toISOString()}}).catch(()=>{});throw e;}
 }
 async function checkCase(c,actor){
  if(['void','unpaid'].includes(c.kind)){
   if(c.kind==='void'&&c.payload.scope!=='payment')throw Error('item_void_out_of_scope');
   if(!UUID.test(c.payload.order_guid||'')||!UUID.test(c.payload.check_guid||''))throw Error('order_ids_required');
   const store=await getStore(c.store_id),get=await toastClient(store),order=await get('/orders/v2/orders/'+c.payload.order_guid,true);
   const result={...financeResolution(c,order),checked_at:new Date().toISOString()};
   if(!result.clean){await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:result});return result;}
   const updated=await rpc('bot_case_write',{p_op:'verified',p_actor:actor,p_id:c.id,p_version:c.version,p_data:result});return {...result,case:updated};
  }
  if(c.kind!=='labor')throw Error('unsupported_monitor_kind');
  const ids=(c.payload.shifts||[]).map(x=>x.guid);if(!ids.length||ids.length>100||ids.some(x=>!UUID.test(x)))throw Error('time_entry_ids_required');
  const store=await getStore(c.store_id), get=await toastClient(store),cfg=validConfig(await setting('clock'));
  const entries=[];
  // Query each GUID so a moved clock-in date cannot silently erase the record.
  for(const id of ids){const j=await get('/labor/v1/timeEntries?timeEntryIds='+encodeURIComponent(id));const hit=j.filter(x=>x.guid===id);if(hit.length!==1)throw Error('time_entry_missing_manual_review');entries.push(hit[0]);}
  const override=await db('app_state?key=eq.'+encodeURIComponent('att_override_'+c.store_id+'_'+c.business_date)+'&select=value');
  const detector=createClockDetector({getCeCfg:()=>cfg,getTipLabor:()=>({})});
  let clean=!override[0]?.value?.data && entries.every(x=>!x.deleted&&x.employeeReference?.guid===c.payload.employee_guid&&x.outDate&&!detector.ceCheckShift(x,cfg).level);
  // Re-read the full original day as well, to catch new overlapping entries.
  const day=await get('/labor/v1/timeEntries?businessDate='+c.business_date.replaceAll('-',''));
  const shifts=day.filter(x=>!x.deleted&&x.employeeReference?.guid===c.payload.employee_guid);
  if(detector._ceOverlap(shifts)||shifts.some(x=>detector.ceCheckShift(x,cfg).level))clean=false;
  // Moved records require review of their new business day; do not auto-close them.
  if(entries.some(x=>String(x.businessDate)!==c.business_date.replaceAll('-','')))clean=false;
  if(!clean){const result={clean:false,message:'still_flagged_or_manual_review',checked_at:new Date().toISOString()};await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:result});return result;}
  const result=await rpc('bot_case_write',{p_op:'verified',p_actor:actor,p_id:c.id,p_version:c.version,p_data:{clean:true,checked_at:new Date().toISOString(),time_entry_ids:ids,cfg}});return {clean:true,case:result};
 }
 async function lineMember(group,user){
  if(!/^C[a-f0-9]{32}$/i.test(group||'')||!/^U[a-f0-9]{32}$/i.test(user||''))throw Error('invalid_line_user');
  const r=await timed('https://api.line.me/v2/bot/group/'+group+'/member/'+user,{headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN')}});
  if(!r.ok)throw Error('line_member_unavailable');const p=await r.json();if(p.userId!==user)throw Error('line_member_unavailable');return p;
 }
 async function send(c,actor,body){
  if(c.kind==='void'&&c.payload?.scope!=='payment')throw Error('item_void_out_of_scope');
  if(!APPROVERS.includes(actor.role))throw Error('forbidden');
  if(!env('LINE_CHANNEL_ACCESS_TOKEN'))throw Error('line_token_missing');
  if(!UUID.test(body.request_id||''))throw Error('invalid_request_id');
  const message=String(body.text||'').trim();if(!message||message.length>4900)throw Error('invalid_message');
  const previous=await db('bot_outbox?id=eq.'+body.request_id+'&select=body,line_message');
  if(!previous.length&&message.length>4500)throw Error('invalid_message');
  // Retried messages preserve the exact reviewed snapshot, including old assignment headers.
  const store=await getStore(c.store_id);
  const header='['+c.code+']\n店舗 / Store: '+store.name+' ('+c.store_id+')\n担当 / Assigned to: '+(c.assignee||'店舗マネージャー / Store manager')+'\n';
  const full=previous.length ? '['+c.code+']\n'+message : header+message;
  const group=await db('bot_groups?group_id=eq.'+encodeURIComponent(body.group_id)+'&enabled=eq.true');if(group.length!==1||(!group[0].all_stores&&group[0].store_id!==c.store_id))throw Error('group_not_enabled');
  let lineMessage=previous.length?(previous[0].line_message||{type:'text',text:full}):lineMentionMessage(full,null);
  if(!previous.length&&body.mention_user){
   const link=await setting('line_link:'+body.group_id+':'+c.store_id);
   if(!link||link.user_id!==body.mention_user||link.assignee!==c.assignee)throw Error('mention_link_changed');
   await lineMember(body.group_id,link.user_id);lineMessage=lineMentionMessage(full,link.user_id);
  }
  const o=await rpc(body.daily_date?'bot_reserve_daily_send':'bot_reserve_send_v2',{p_actor:actor.id,p_id:c.id,p_version:body.version,p_request:body.request_id,p_group:body.group_id,p_body:full,p_message:lineMessage,...(body.daily_date?{p_day:body.daily_date}:{})});
  if(o.state==='sent')return {state:'sent',request_id:o.id};
  let state='unknown';
  try{
   const r=await timed('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json','X-Line-Retry-Key':o.id},body:JSON.stringify({to:o.group_id,messages:[o.line_message||{type:'text',text:o.body}]})});
   state=r.ok||(r.status===409&&!!r.headers.get('x-line-accepted-request-id'))?'sent':r.status>=400&&r.status<500&&r.status!==429?'failed':'unknown';
  }catch{state='unknown';}
  await rpc('bot_finish_send',{p_id:o.id,p_state:state});return {state,request_id:o.id};
 }
 return async function handler(req){
  const origin=req.headers.get('origin');
  const allowed=['https://funergy-plus.com','https://www.funergy-plus.com','https://motoi107.github.io'];
  const cors=origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}:{};
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  try{
   if(origin&&!allowed.includes(origin))return json({error:'origin_denied'},403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   const url=new URL(req.url);
   if(req.method==='GET'&&url.searchParams.get('action')==='config')return json({clock:await setting('clock')});
   if(req.method!=='POST')return json({error:'POST_required'},405);
   const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>256000)return json({error:'body_too_large'},413);
   if(url.searchParams.get('route')==='line'){
    const secret=env('LINE_CHANNEL_SECRET');if(!secret)return json({error:'line_secret_missing'},503);
    if(!(await validSignature(bytes,req.headers.get('x-line-signature'),secret)))return json({error:'invalid_signature'},401);
    const data=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(data.events))throw Error('invalid_events');
    for(const e of data.events){const g=e.source?.groupId;if(!/^C[a-f0-9]{32}$/i.test(g||''))continue;
     if(!e.webhookEventId||typeof e.webhookEventId!=='string')continue;
     const registration=e.message?.type==='text'&&/^(?:担当者登録|register)\s+(.{1,120})$/i.exec(e.message.text.trim());
     if(registration&&/^U[a-f0-9]{32}$/i.test(e.source?.userId||'')){
      const groups=await db('bot_groups?group_id=eq.'+g+'&enabled=eq.true');
      if(groups.length===1)await db('bot_settings?on_conflict=key','POST',{key:'line_candidate:'+g+':'+e.source.userId,value:{group_id:g,user_id:e.source.userId,claimed_name:registration[1],registered_at:new Date().toISOString()},updated_at:new Date().toISOString()},'resolution=merge-duplicates');
      continue;
     }
     await rpc('bot_ingest',{p_event_id:e.webhookEventId,p_group:g,p_user:e.source?.userId||'',p_text:e.message?.type==='text'?e.message.text:'',p_type:e.type});
    }
    return json({ok:true});
   }
   const body=JSON.parse(new TextDecoder().decode(bytes));
   if(body.action==='worker'){
   const cfg=await setting('worker');if(!cfg?.key||req.headers.get('x-bot-worker-key')!==cfg.key)throw Error('unauthorized');
   if(!cfg.enabled||!(await setting('clock')))return json({skipped:true});
    if(body.mode==='morning_summary')return json(await morningSummary());
    if(body.mode!=='monitor'&&(await setting('collection_range'))?.mode==='month_to_yesterday')return json(await rangeRun(String(body.store_id)));
    const date=new Date(Date.now()-10*3600000-86400000).toISOString().slice(0,10);
    const result=body.mode==='monitor'?{}:await scan(String(body.store_id),date,null,cfg.finance_enabled===true);
    const start=Date.now(),pending=await db('bot_cases?kind=in.(labor,void,unpaid)&status=neq.done&or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&store_id=eq.'+encodeURIComponent(body.store_id)+'&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20');
    let checked=0,verified=0;for(const c of pending){if(Date.now()-start>45000)break;try{if((await recheck(c,null)).clean)verified++;}catch{/* Error and check time are recorded; the case stays open. */}checked++;}
    return json({...result,checked,verified});
   }
   const actor=await authorize(req);
   if(body.action==='daily')return json(await dailyOverview(body.after));
   if(body.action==='list')return json({actor,daily:await dailyOverview(),cases:await db('bot_cases?or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&order=updated_at.desc&limit=200'),groups:await db('bot_groups?order=group_id'),line_candidates:await db('bot_settings?key=like.line_candidate:*&select=key,value'),line_links:await db('bot_settings?key=like.line_link:*&select=key,value'),owners:await db('bot_settings?key=like.owner:*&select=key,value'),intakes:await db('bot_events?kind=eq.line_needs_store&case_id=is.null&order=id.asc&limit=50'),runs:await db('bot_runs'),clock:await setting('clock'),worker_enabled:!!(await setting('worker'))?.enabled,finance_enabled:!!(await setting('worker'))?.finance_enabled,line:{secret:!!env('LINE_CHANNEL_SECRET'),token:!!env('LINE_CHANNEL_ACCESS_TOKEN')},stores:await db('store_config?active=eq.true&select=store_id,name')});
   if(body.action==='resolve_send'){
    if(!APPROVERS.includes(actor.role)||!UUID.test(body.outbox_id||''))throw Error('forbidden');
    await rpc('bot_resolve_send',{p_actor:actor.id,p_id:body.outbox_id,p_state:body.state,p_note:String(body.note||'').trim()});return json({ok:true});
   }
   if(body.action==='detail'){
    if(!UUID.test(body.id||''))throw Error('invalid_id');return json({events:await db('bot_events?case_id=eq.'+body.id+'&order=id.desc&limit=100'),outbox:await db('bot_outbox?case_id=eq.'+body.id+'&order=created_at.desc&limit=20')});
   }
   if(body.action==='config'){
    if(!['gm','ceo'].includes(actor.role))throw Error('forbidden');const clock=validConfig(body.clock);
    await db('bot_settings?on_conflict=key','POST',{key:'clock',value:clock,updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({clock});
   }
   if(body.action==='worker_config'){
    if(!['gm','ceo'].includes(actor.role))throw Error('forbidden');const c=await setting('worker');if(!c)throw Error('worker_not_configured');
    await db('bot_settings?key=eq.worker','PATCH',{value:{...c,enabled:typeof body.enabled==='boolean'?body.enabled:!!c.enabled,finance_enabled:typeof body.finance_enabled==='boolean'?body.finance_enabled:!!c.finance_enabled},updated_at:new Date().toISOString()});return json({enabled:typeof body.enabled==='boolean'?body.enabled:!!c.enabled,finance_enabled:typeof body.finance_enabled==='boolean'?body.finance_enabled:!!c.finance_enabled});
   }
   if(body.action==='line_link'||body.action==='line_profile'){
    if(!APPROVERS.includes(actor.role))throw Error('forbidden');await getStore(body.store_id);
    const groups=await db('bot_groups?group_id=eq.'+encodeURIComponent(body.group_id)+'&enabled=eq.true');
    if(groups.length!==1||(!groups[0].all_stores&&groups[0].store_id!==body.store_id))throw Error('group_not_enabled');
    const key='line_link:'+body.group_id+':'+body.store_id;
    if(body.remove===true){await db('bot_settings?key=eq.'+encodeURIComponent(key),'DELETE');return json({ok:true});}
    const candidate=await setting('line_candidate:'+body.group_id+':'+body.user_id);
    if(!candidate)throw Error('registration_required');
    const owner=await setting('owner:'+body.store_id);if(!owner?.name||owner.name!==body.assignee)throw Error('mention_link_changed');
    const profile=await lineMember(body.group_id,body.user_id);
    if(body.action==='line_profile')return json({profile:{user_id:profile.userId,display_name:profile.displayName}});
    if(body.display_name!==profile.displayName)throw Error('mention_link_changed');
    const value={group_id:body.group_id,store_id:body.store_id,user_id:body.user_id,assignee:owner.name,display_name:profile.displayName,approved_by:actor.id,approved_at:new Date().toISOString()};
    await db('bot_settings?on_conflict=key','POST',{key,value,updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({ok:true,link:value});
   }
   if(body.action==='owner'){
    if(!APPROVERS.includes(actor.role))throw Error('forbidden');await getStore(body.store_id);
    const name=String(body.name||'').trim();if(!name||name.length>120||/[\r\n]/.test(name))throw Error('assignee_required');
    await db('bot_settings?on_conflict=key','POST',{key:'owner:'+body.store_id,value:{name},updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({ok:true});
   }
   if(body.action==='assign_intake'){
    if(!Number.isSafeInteger(body.event_id)||body.event_id<=0)throw Error('invalid_id');
    return json(await rpc('bot_assign_intake',{p_actor:actor.id,p_event:body.event_id,p_store:body.store_id}));
   }
   if(body.action==='group'){
    if(!['gm','ceo'].includes(actor.role))throw Error('forbidden');if(body.all_stores!==true)await getStore(body.store_id);
    if(!/^C[a-f0-9]{32}$/i.test(body.group_id||''))throw Error('invalid_group');
    await db('bot_groups?on_conflict=group_id','POST',{group_id:body.group_id,store_id:body.all_stores===true?null:body.store_id,all_stores:body.all_stores===true,label:String(body.label||'').slice(0,120),enabled:body.enabled===true,updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({ok:true});
   }
   if(body.action==='scan')return json(await scan(String(body.store_id),businessDate(body.date),actor.id,body.with_voids===true));
   if(body.action==='create_purchase'){
    const store=await getStore(body.store_id);if(!UUID.test(body.request_id||''))throw Error('invalid_request_id');const subject=String(body.subject||'').trim();if(!subject||subject.length>160)throw Error('subject_required');
    return json(await rpc('bot_case_write',{p_op:'finding',p_actor:actor.id,p_data:{source_key:'manual:'+body.request_id,kind:'purchase',store_id:store.store_id,business_date:new Date(Date.now()-10*3600000).toISOString().slice(0,10),subject,payload:{request:String(body.request||subject).slice(0,5000),source:'manual'}}}));
   }
   if(!UUID.test(body.id||'')||!Number.isInteger(body.version))throw Error('invalid_id_or_version');
   const rows=await db('bot_cases?id=eq.'+body.id);if(rows.length!==1)throw Error('not_found');const c=rows[0];
   if(body.action==='send')return json(await send(c,actor,body));
   if(c.version!==body.version)throw Error('conflict');
   if(body.action==='recheck')return json(await recheck(c,actor.id));
   const ops=['assign','note','draft','correction','reported','acknowledge','purchase','approve','ordered'];if(!ops.includes(body.action))throw Error('bad_action');
   const data={assignee:String(body.assignee||'').trim(),note:String(body.note||'').trim(),draft:String(body.draft||'').trim(),order_number:String(body.order_number||'').trim()};
   if(body.action==='assign'&&/[\r\n]/.test(data.assignee))throw Error('assignee_required');
   if(body.action==='purchase'){data.url=safePurchaseURL(body.url);data.quantity=Number(body.quantity);if(!Number.isFinite(data.quantity)||data.quantity<=0||data.quantity>100000)throw Error('invalid_quantity');}
   return json(await rpc('bot_case_write',{p_op:body.action,p_actor:actor.id,p_id:c.id,p_version:body.version,p_data:data}));
  }catch(e){const code=e instanceof SyntaxError?'invalid_json':e.message||'request_failed';const status=code==='unauthorized'?401:code==='forbidden'?403:['conflict','send_unresolved','scan_busy'].includes(code)?409:code.includes('missing')||code.includes('not_configured')?503:400;return json({error:/^[a-z_]+$/.test(code)?code:'request_failed'},status);}
 };
}
