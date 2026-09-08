import { createClockDetector } from '../../../bot/clock-detector.mjs';
const ROLES=['ceo','gm','office','office_crew'], APPROVERS=['ceo','gm','office'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const enc=new TextEncoder();
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
export function voidFindings(orders,store,date,reasons=[],employees=[]){
  const reasonNames=new Map(reasons.map(x=>[x.guid,x.name]));
  const staffNames=new Map(employees.map(x=>[x.guid,((x.firstName||'')+' '+(x.lastName||'')).trim()||x.name||x.guid]));
  const rows=[];
  for(const order of orders){
    const add=(obj,scope,check)=>{if(!obj?.voided||!obj.guid)return;
      const vi=obj.voidInformation||{};
      rows.push({source_key:'void:'+store.store_id+':'+obj.guid,kind:'void',store_id:store.store_id,business_date:date,subject:'Void / '+(obj.displayName||obj.displayNumber||order.displayNumber||scope),payload:{store_name:store.name,order_guid:order.guid,check_guid:check?.guid||null,entity_guid:obj.guid,scope,item:obj.displayName||null,amount:obj.price??obj.amount??null,reason:reasonNames.get(vi.voidReason?.guid)||null,user_name:staffNames.get(vi.voidUser?.guid)||null,approver_name:staffNames.get(vi.voidApprover?.guid)||null,reason_guid:vi.voidReason?.guid||null,user_guid:vi.voidUser?.guid||null,approver_guid:vi.voidApprover?.guid||null,void_date:vi.voidDate||null,source:'toast_direct',fetched_at:new Date().toISOString()}});
    };
    add(order,'order');
    for(const check of order.checks||[]){add(check,'check',check);
      const walk=(selections)=>{for(const s of selections||[]){add(s,'selection',check);walk(s.modifiers);}};walk(check.selections);
    }
  }
  return rows;
}
export function createHandler({env,fetch:fetcher=globalThis.fetch}){
 const sb=env('SUPABASE_URL'), service=env('SUPABASE_SERVICE_ROLE_KEY'), anon=env('SUPABASE_ANON_KEY');
 const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
 const timed=(url,init={})=>fetcher(url,{...init,signal:AbortSignal.timeout(20000)});
 async function db(path,method='GET',body,prefer){
  const r=await timed(sb+'/rest/v1/'+path,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok){const j=await r.json().catch(()=>({}));const known=['conflict','forbidden','not_found','send_unresolved','retry_mismatch','failed_send_requires_new_review','retry_expired_check_line','group_not_enabled','closed_case','purchase_details_required','order_number_required','invalid_state','note_required','assignee_required'];throw Error(known.find(x=>j.message?.includes(x))||(r.status===409?'conflict':'database_error'));}
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
  if(roles.length!==1||!ROLES.includes(roles[0].role))throw Error('forbidden');return {id:u.id,role:roles[0].role};
 }
 async function getStore(id){const a=await db('store_config?store_id=eq.'+encodeURIComponent(id)+'&active=eq.true&select=store_id,restaurant_guid,name');if(a.length!==1)throw Error('invalid_store');return a[0];}
 async function toastClient(store){
  if(!env('TOAST_CLIENT_ID')||!env('TOAST_CLIENT_SECRET'))throw Error('toast_not_configured');
  const r=await timed('https://ws-api.toasttab.com/authentication/v1/authentication/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:env('TOAST_CLIENT_ID'),clientSecret:env('TOAST_CLIENT_SECRET'),userAccessType:'TOAST_MACHINE_CLIENT'})});
  if(!r.ok)throw Error('toast_auth_failed');const token=(await r.json())?.token?.accessToken;if(!token)throw Error('toast_auth_failed');
  return async path=>{
   let url=new URL('https://ws-api.toasttab.com'+path),all=[],seen=new Set();
   for(let page=0;page<40;page++){
    const r=await timed(url.href,{headers:{Authorization:'Bearer '+token,'Toast-Restaurant-External-ID':store.restaurant_guid}});
    if(!r.ok)throw Error(r.status===429?'toast_rate_limited':'toast_read_failed');const j=await r.json();if(!Array.isArray(j))throw Error('toast_invalid_response');all.push(...j);
    const next=r.headers.get('Toast-Next-Page-Token');if(!next)return all;if(seen.has(next))throw Error('toast_pagination_loop');seen.add(next);url.searchParams.set('pageToken',next);
   }
   throw Error('toast_pagination_limit');
  };
 }
 async function scan(storeID,date,actor,withVoids=true){
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
    if(!complete)throw Error('toast_pagination_limit');let reasons=[];try{reasons=await get('/config/v2/voidReasons');}catch{ /* Preserve unavailable references as IDs for accounting review. */ }findings.push(...voidFindings(orders,store,date,reasons,employees));
   }
   for(const f of findings)await rpc('bot_case_write',{p_op:'finding',p_actor:actor,p_data:f});
   await db('bot_runs?store_id=eq.'+encodeURIComponent(storeID),'PATCH',{running_until:null,last_success:new Date().toISOString(),last_error:null});
   return {created_or_matched:findings.length,override,entries:entries.length};
  }catch(e){await db('bot_runs?store_id=eq.'+encodeURIComponent(storeID),'PATCH',{running_until:null,last_error:String(e.message).slice(0,80)}).catch(()=>{});throw e;}
 }
 async function recheck(c,actor){
  if(c.kind!=='labor')throw Error('labor_only');
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
  if(!clean){const result={clean:false,message:'still_flagged_or_manual_review',checked_at:new Date().toISOString()};await db('bot_events','POST',{case_id:c.id,actor,kind:'verification_checked',data:result},'return=minimal');return result;}
  const result=await rpc('bot_case_write',{p_op:'verified',p_actor:actor,p_id:c.id,p_version:c.version,p_data:{clean:true,checked_at:new Date().toISOString(),time_entry_ids:ids,cfg}});return {clean:true,case:result};
 }
 async function send(c,actor,body){
  if(!APPROVERS.includes(actor.role))throw Error('forbidden');
  if(!env('LINE_CHANNEL_ACCESS_TOKEN'))throw Error('line_token_missing');
  if(!UUID.test(body.request_id||''))throw Error('invalid_request_id');
  const message=String(body.text||'').trim();if(!message||message.length>4900)throw Error('invalid_message');
  const previous=await db('bot_outbox?id=eq.'+body.request_id+'&select=body');
  if(!previous.length&&message.length>4500)throw Error('invalid_message');
  // Retried messages preserve the exact reviewed snapshot, including old assignment headers.
  const store=await getStore(c.store_id);
  const header='['+c.code+']\n店舗 / Store: '+store.name+' ('+c.store_id+')\n担当 / Assigned to: '+(c.assignee||'店舗マネージャー / Store manager')+'\n';
  const full=previous.length ? '['+c.code+']\n'+message : header+message;
  const group=await db('bot_groups?group_id=eq.'+encodeURIComponent(body.group_id)+'&enabled=eq.true');if(group.length!==1||(!group[0].all_stores&&group[0].store_id!==c.store_id))throw Error('group_not_enabled');
  const o=await rpc('bot_reserve_send',{p_actor:actor.id,p_id:c.id,p_version:body.version,p_request:body.request_id,p_group:body.group_id,p_body:full});
  if(o.state==='sent')return {state:'sent',request_id:o.id};
  let state='unknown';
  try{
   const r=await timed('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json','X-Line-Retry-Key':o.id},body:JSON.stringify({to:o.group_id,messages:[{type:'text',text:o.body}]})});
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
     await rpc('bot_ingest',{p_event_id:e.webhookEventId,p_group:g,p_user:e.source?.userId||'',p_text:e.message?.type==='text'?e.message.text:'',p_type:e.type});
    }
    return json({ok:true});
   }
   const body=JSON.parse(new TextDecoder().decode(bytes));
   if(body.action==='worker'){
    const cfg=await setting('worker');if(!cfg?.key||req.headers.get('x-bot-worker-key')!==cfg.key)throw Error('unauthorized');
    if(!cfg.enabled||!(await setting('clock')))return json({skipped:true});
    const date=new Date(Date.now()-10*3600000-86400000).toISOString().slice(0,10);
    const result=await scan(String(body.store_id),date,null);
    const pending=await db('bot_cases?kind=eq.labor&status=eq.verify&store_id=eq.'+encodeURIComponent(body.store_id)+'&order=updated_at.asc&limit=10');
    let verified=0;for(const c of pending){try{if((await recheck(c,null)).clean)verified++;}catch{ /* Retain unresolved cases for human review. */ }}
    return json({...result,verified});
   }
   const actor=await authorize(req);
   if(body.action==='list')return json({actor,cases:await db('bot_cases?order=updated_at.desc&limit=200'),groups:await db('bot_groups?order=group_id'),owners:await db('bot_settings?key=like.owner:*&select=key,value'),intakes:await db('bot_events?kind=eq.line_needs_store&case_id=is.null&order=id.asc&limit=50'),runs:await db('bot_runs'),clock:await setting('clock'),worker_enabled:!!(await setting('worker'))?.enabled,line:{secret:!!env('LINE_CHANNEL_SECRET'),token:!!env('LINE_CHANNEL_ACCESS_TOKEN')},stores:await db('store_config?active=eq.true&select=store_id,name')});
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
    await db('bot_settings?key=eq.worker','PATCH',{value:{...c,enabled:body.enabled===true},updated_at:new Date().toISOString()});return json({enabled:body.enabled===true});
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
   if(body.action==='scan')return json(await scan(String(body.store_id),businessDate(body.date),actor.id,body.with_voids!==false));
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
