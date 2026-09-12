import {parseCompletionReply,completionReceipt,parseCaseReply,replyHelp,replyChoices,responseReceipt} from '../../../bot/case-replies.mjs';
import { createClockDetector } from '../../../bot/clock-detector.mjs';
const ROLES=['ceo','gm','office','office_crew'], APPROVERS=['ceo','gm','office'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const enc=new TextEncoder();
export function dailyDisposition(c,day){
 if(c.status==='done')return 'done';
 if(c.status==='hq_review')return 'hq_review';
 if(c.status==='verify')return 'verify';
 if(c.due_date&&c.due_date>day)return 'scheduled';
 if(c.status==='correction'&&c.payload?.returned&&c.due_date&&c.due_date<=day)return 'action';
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
const {ceIsSystemAccount}=createClockDetector({getTipLabor:()=>null,getCeCfg:()=>null});
export function laborFindings(entries,employees,cfg,store,date,override=false){
  validConfig(cfg);const names=new Map(employees.map(e=>[e.guid,((e.firstName||'')+' '+(e.lastName||'')).trim()||e.name||e.guid]));
  const people={};
  for(const te of entries){
    const id=te.employeeReference?.guid;
    if(te.deleted||!te.guid||!id||ceIsSystemAccount(names.get(id)))continue;
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
  rows.push({source_key:'void:'+store.store_id+':'+pay.guid,kind:'void',store_id:store.store_id,business_date:date,subject:'Payment Void / #'+(check.displayNumber||order.displayNumber||pay.guid),payload:{store_name:store.name,order_guid:order.guid,check_guid:check.guid,entity_guid:pay.guid,fingerprint:JSON.stringify({amount:pay.amount??null,total:check.totalAmount??null,void:pay.voidInfo??null,status:pay.paymentStatus??null}),scope:'payment',check_total:check.totalAmount??null,amount:pay.amount??null,reason:reasonNames.get(reason)||null,user_name:staffNames.get(vi.voidUser?.guid)||null,approver_name:staffNames.get(vi.voidApprover?.guid)||null,reason_guid:reason||null,user_guid:vi.voidUser?.guid||null,approver_guid:vi.voidApprover?.guid||null,void_date:vi.voidDate||null,source:'toast_direct',fetched_at:new Date().toISOString()}});
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
const MORNING_KIND_JA={auto:'自動クロックアウト疑い',reverse:'IN/OUT逆転',bad:'時刻不正',long:'長時間勤務',short:'極端に短い勤務',overlap:'打刻重複'};
const MORNING_PROGRESS={not_sent:'🔴 未通知',notify_failed:'🔴 通知失敗・要確認',waiting:'🟠 対応待ち',reminder_failed:'🟠 対応待ち（再通知失敗）',in_progress:'🟡 修正対応中',recheck:'🔵 完了報告済み・Toast再確認待ち',send_check:'⚪ 送信結果確認',review:'⚪ 本部確認待ち'};
function morningField(value,max=120){return String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function morningIssue(c){
 const raw=Array.isArray(c.kinds)?c.kinds:[],labels=raw.map(k=>k==='bad'&&c.open_shift===true?'退勤打刻なし':MORNING_KIND_JA[k]||morningField(k,50));
 return labels.length?labels.join('・'):'要確認';
}
function morningProgress(c){if(c.status==='hq_review')return '本部確認待ち';if(c.status==='verify')return '修正反映待ち';const key=morningField(c.progress,30)||'review';return MORNING_PROGRESS[key]||MORNING_PROGRESS.review;}
export function morningShiftLines(c){
 const shifts=Array.isArray(c.shifts)?c.shifts.filter(x=>x&&typeof x==='object'):[];
 if(!shifts.length)return '打刻：詳細を取得できません。Funergy＋で確認してください';
 const ms=v=>v?Date.parse(v):NaN;
 const clock=(v,missing)=>{if(!v)return missing;const n=ms(v);return Number.isFinite(n)?new Date(n-10*3600000).toISOString().slice(5,16).replace('-','/').replace('T',' '):'時刻不正';};
 let cfg;try{cfg=validConfig(c.shift_cfg);}catch{}
 const detector=createClockDetector({getTipLabor:()=>null,getCeCfg:()=>cfg});
 const rows=shifts.filter(x=>x&&typeof x==='object').map((sh,i)=>{
  const a=ms(sh.inDate),b=ms(sh.outDate),valid=Number.isFinite(a)&&Number.isFinite(b)&&b>a;
  const overlap=valid&&shifts.some((other,j)=>j!==i&&other&&ms(other.outDate)>ms(other.inDate)&&a<ms(other.outDate)&&ms(other.inDate)<b);
  let kinds=cfg?detector.ceCheckShift(sh,cfg).kinds:[];
  if(!sh.inDate||!sh.outDate)kinds=[...new Set([...kinds,'bad'])];
  if(overlap)kinds=[...kinds,'overlap'];
  const reasons=kinds.map(k=>k==='bad'?(!sh.inDate?'出勤未打刻':!sh.outDate?'退勤未打刻':'時刻不正'):k==='long'?'長時間：'+cfg.longH+'時間超':k==='short'?'短時間：'+cfg.shortMin+'分未満':k==='auto'?'自動退勤疑い：退勤が'+cfg.nightFrom+'〜'+cfg.nightTo:k==='overlap'?'他の打刻と重複':MORNING_KIND_JA[k]||k);
  const minutes=valid?Math.round((b-a)/60000):null,duration=minutes===null?'時間算出不可':Math.floor(minutes/60)+'時間'+String(minutes%60).padStart(2,'0')+'分';
  return {flag:kinds.length>0,text:'勤務'+(i+1)+'：'+clock(sh.inDate,'出勤未打刻')+' → '+clock(sh.outDate,'退勤未打刻')+'（'+duration+'）\n'+(reasons.length?'確認点：'+reasons.join('／'):cfg?'この打刻の単独エラーなし':'判定設定未取得・勤務を確認')};
 }).sort((a,b)=>Number(b.flag)-Number(a.flag));
 return '検知時の打刻（HST・休憩控除前）\n'+rows.map(x=>x.text).join('\n');
}
function morningCaseBlock(c,index,category=null){
 const date=morningField(c.business_date,10).slice(5).replace('-','/'),code=morningField(c.code,20),progress=morningProgress(c),assignee=category==='labor'?'Moto・Yuki':category==='finance'?'経理':morningField(c.assignee,100)||'店舗担当者未設定';
 if(c.kind==='labor'){
  const name=morningField(c.employee_name||c.subject||'氏名不明',100);
  return index+'. '+name+'（'+date+'）\n内容：'+morningIssue(c)+'\n'+morningShiftLines(c)+'\n進捗：'+progress+'\n担当：'+assignee+'\n案件：'+code;
 }
 const ref=morningField(c.subject,100).replace(/^Payment Void \/\s*|^Unpaid \/\s*/i,''),hasAmount=c.amount!==null&&c.amount!==undefined&&c.amount!=='',amount=Number(c.amount),money=hasAmount&&Number.isFinite(amount)?'$'+amount.toFixed(2):'金額不明';
 if(c.kind==='void'){
  const who=morningField(c.user_name,100),approver=morningField(c.approver_name,100),reason=morningField(c.reason,Infinity);
  return index+'. Payment Void '+ref+'（'+date+'）\n金額：'+money+(who?'\n操作：'+who:'')+(approver?'／承認：'+approver:'')+(reason?'\n理由：'+reason:'')+'\n進捗：'+progress+'\n担当：'+assignee+'\n案件：'+code;
 }
 return index+'. Unpaid '+ref+'（'+date+'）\n金額：'+money+'\n進捗：'+progress+'\n担当：'+assignee+'\n案件：'+code;
}
// Split at line boundaries when possible; never discard text or split a surrogate pair.
function morningTextParts(text,max=4300){
 const parts=[];let rest=text;
 while(rest.length>max){let end=rest.lastIndexOf('\n',max);if(end<1)end=max;
  if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;
  parts.push(rest.slice(0,end));rest=rest.slice(end);if(rest.startsWith('\n'))rest=rest.slice(1);
 }
 if(rest)parts.push(rest);return parts;
}
function morningStoreMessages(details,total,stores=[],category=null){
 if(!Array.isArray(details)||!details.length)return [];
 if(details.length!==Number(total))throw Error('morning_summary_incomplete_details');
 const groups=new Map();
 const storeTotals=new Map((Array.isArray(stores)?stores:[]).map(s=>[morningField(s.store_id,80),Number(s.labor||0)+Number(s.void||0)+Number(s.unpaid||0)]));
 for(const row of details){const key=morningField(row.store_id,80);if(!groups.has(key))groups.set(key,{key,name:morningField(row.store_name||row.store_id,80),rows:[]});groups.get(key).rows.push(row);}
 const sections=[];
 for(const group of groups.values()){
  const header='【'+group.name+'｜未解決 '+(storeTotals.get(group.key)??group.rows.length)+'件】';let text=header;
  for(let i=0;i<group.rows.length;i++){
   const c=group.rows[i],block=morningCaseBlock(c,i+1,category)+(c.due_date?'\n期限：'+c.due_date:'')+(c.response?'\n回答：'+morningField(c.response.actor,80)+' / '+morningField(c.response.note,Infinity):'')+(c.returned?'\n差し戻し：'+morningField(c.returned.note,Infinity):'');
   const parts=morningTextParts(block,4000);
   for(let j=0;j<parts.length;j++){
    const piece=(parts.length>1?'案件：'+morningField(c.code,20)+'｜進捗：'+morningProgress(c)+'｜詳細 '+(j+1)+'/'+parts.length+'\n':'')+parts[j];
    if(text.length+piece.length+2>4500){sections.push(text);text=header+'（続き）';}
    text+='\n\n'+piece;
   }
  }
  sections.push(text);
 }
 return sections;
}
export function formatMorningSummary(s,{resend=false,category=null}={}){
 const n=k=>Number(s?.counts?.[k]||0),complete=Number(s?.active_stores)>0&&Number(s?.ok)===Number(s?.expected)&&Number(s?.failed)===0&&(category==='labor'||s?.finance_enabled===true&&Number(s?.finance_ok)===Number(s?.expected));
 const labor=n('labor'),voids=n('void'),unpaid=n('unpaid'),total=labor+voids+unpaid,period=Number(s.expected)===0&&Number(s.active_stores)>0?'当月は対象日なし':s.from+'〜'+s.to,p=s.progress_counts||{};
 const title=category==='labor'?'勤怠管理レポート':category==='finance'?'会計管理レポート':'毎朝 本部確認レポート';
 const lines=['【'+title+(resend?'｜再送':'')+'】',...(category?['管理担当：'+(category==='labor'?'Moto・Yuki':'経理')]:[]),'対象：'+period,category==='labor'?'勤怠取得：'+Number(s.ok||0)+'/'+Number(s.expected||0):'取得：'+Number(s.ok||0)+'/'+Number(s.expected||0)+'　決済確認：'+Number(s.finance_ok||0)+'/'+Number(s.expected||0),'未解決：'+total+'件'+(category==='labor'?'（勤怠）':category==='finance'?'（Payment Void '+voids+'／Unpaid '+unpaid+'）':'（勤怠 '+labor+'／Payment Void '+voids+'／Unpaid '+unpaid+'）')];
 if(total>0)lines.push('進捗：未通知 '+Number(p.not_sent||0)+'／通知失敗 '+Number(p.notify_failed||0)+'／対応待ち '+Number(p.waiting||0)+'／再通知失敗 '+Number(p.reminder_failed||0)+'／修正中 '+Number(p.in_progress||0)+'／再確認待ち '+Number(p.recheck||0)+'／本部確認 '+Number(p.review||0)+'／送信確認 '+Number(p.send_check||0));
 if(Number(s?.active_stores)===0)lines.push('⚠️ 有効店舗がありません');
 if(category!=='labor'&&(s?.finance_enabled!==true||Number(s?.finance_ok)!==Number(s?.expected)))lines.push('⚠️ 決済データの取得が未完了です');
 if(!complete)lines.push('⚠️ 取得未完了：'+Number(s.ok||0)+'/'+Number(s.expected||0)+'、失敗 '+Number(s.failed||0));
 else if(total===0)lines.push('✅ 現在、未解決の異常はありません');
 else lines.push('✅ データ取得完了　店舗別レポートを確認してください');
 lines.push('本部確認待ち：'+Number(s.status_counts?.hq_review||0)+'件');
 const closed=s.recent_closed||[];
 if(closed.length)lines.push('確認完了：'+closed.length+'件（詳細は後続の完了報告）');
 const text=lines.join('\n');if(text.length>4900)throw Error('invalid_message');
 const detailCount=Number(s.detail_total??(Array.isArray(s.details)?s.details.length:0));
 if(s.detail_total!==undefined&&(detailCount!==(s.details||[]).length||detailCount!==total))throw Error('morning_summary_incomplete_details');
 const messages=[{type:'text',text},...morningStoreMessages(s.details,detailCount,s.stores,category).map(detail=>({type:'text',text:detail}))];
 for(const c of closed){
  const header='【確認完了の定時報告｜毎朝9:00 HST】\n案件：'+morningField(c.code,20)+'｜完了',body='店舗：'+morningField(c.store_name||c.store_id)+'\n内容：'+morningField(c.subject,Infinity)+'\n回答者：'+morningField(c.closure?.actor||'Toast',100)+'\n回答：'+morningField(c.closure?.note,Infinity);
  for(const part of morningTextParts(body))messages.push({type:'text',text:header+'\n'+part});
 }
 messages[messages.length-1].text+='\n\n【レポート終了】未解決 '+detailCount+'件・確認完了 '+closed.length+'件を全件掲載';
 for(let i=0;i<messages.length;i++)messages[i].text='【'+(category==='labor'?'勤怠管理｜Moto・Yuki':category==='finance'?'会計管理｜経理':'本部レポート')+' '+(i+1)+'/'+messages.length+'】\n'+messages[i].text;

 return {text,messages,complete,total,detail_count:detailCount};
}
// Each responsibility gets its own overview, progress, details, closures and numbering.
export function formatResponsibleMorningReports(s,options={}){
 const details=s.details||[],closed=s.recent_closed||[],known=c=>['labor','void','unpaid'].includes(c.kind);
 if(details.some(c=>!known(c))||closed.some(c=>!known(c)))throw Error('morning_summary_missing_case_kind');
 if(s.detail_total!==undefined&&Number(s.detail_total)!==details.length)throw Error('morning_summary_incomplete_details');
 if(s.counts&&['labor','void','unpaid'].some(k=>Number(s.counts[k]||0)!==details.filter(c=>c.kind===k).length))throw Error('morning_summary_incomplete_details');
 const reports=['labor','finance'].map(category=>{
  const belongs=c=>category==='labor'?c.kind==='labor':c.kind==='void'||c.kind==='unpaid',rows=details.filter(belongs),done=closed.filter(belongs),progress={},statuses={};
  for(const c of rows){const key=c.status==='hq_review'?'review':c.status==='verify'?'recheck':c.progress||'review';progress[key]=(progress[key]||0)+1;statuses[c.status]=(statuses[c.status]||0)+1;}
  const stores=(s.stores||[]).map(store=>({...store,labor:category==='labor'?store.labor:0,void:category==='finance'?store.void:0,unpaid:category==='finance'?store.unpaid:0}));
  return {category,...formatMorningSummary({...s,details:rows,detail_total:rows.length,recent_closed:done,counts:{labor:rows.filter(c=>c.kind==='labor').length,void:rows.filter(c=>c.kind==='void').length,unpaid:rows.filter(c=>c.kind==='unpaid').length},stores,progress_counts:progress,status_counts:statuses},{...options,category})};
 });
 return {reports,messages:reports.flatMap(r=>r.messages),text:reports.map(r=>r.text).join('\n\n'),complete:reports.every(r=>r.complete),total:details.length,detail_count:details.length};
}
export function createHandler({env,fetch:fetcher=globalThis.fetch}){
 const sb=env('SUPABASE_URL'), service=env('SUPABASE_SERVICE_ROLE_KEY'), anon=env('SUPABASE_ANON_KEY');
 const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
 const timed=(url,init={})=>fetcher(url,{...init,signal:AbortSignal.timeout(20000)});
 async function db(path,method='GET',body,prefer){
  const r=await timed(sb+'/rest/v1/'+path,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok){const j=await r.json().catch(()=>({}));const known=['conflict','forbidden','not_found','send_unresolved','retry_mismatch','failed_send_requires_new_review','retry_expired_check_line','group_not_enabled','closed_case','purchase_details_required','order_number_required','invalid_state','note_required','assignee_required','daily_date_changed','daily_already_prepared','recheck_required','hq_review_required','response_required','due_date_required'];throw Error(known.find(x=>j.message?.includes(x))||(r.status===409?'conflict':'database_error'));}
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
   const start=Date.now(),pending=await db('bot_cases?kind=in.(labor,void,unpaid)&status=not.in.(done,hq_review)&or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&store_id=eq.'+encodeURIComponent(storeID)+'&business_date=eq.'+job.business_date+'&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20');
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
 async function flushCaseNotices(){
  if(!env('LINE_CHANNEL_ACCESS_TOKEN'))return {skipped:true};
  const notices=await db('bot_events?kind=eq.lifecycle_notice&data->>state=in.(pending,unknown)&order=id.asc&limit=5');let sent=0;
  for(const e of notices){
   const n=e.data;
   // Closure broadcasts belong to the existing 09:00 HST HQ report. Keep the
   // audit event, but do not send or retry a separate completion push.
   if(n.case?.status==='done'){await db('bot_events?id=eq.'+e.id,'PATCH',{data:{...n,state:'morning_summary',delivery:'daily_hq_report'}});continue;}
   if(Date.parse(e.created_at)<Date.now()-23*3600000){await db('bot_events?id=eq.'+e.id,'PATCH',{data:{...n,state:'expired'}});continue;}
   const groups=await db('bot_groups?group_id=eq.'+encodeURIComponent(n.group_id)+'&enabled=eq.true');
   const current=await db('bot_cases?id=eq.'+e.case_id+'&select=status,status_version');
   if(!groups.length||(!groups[0].all_stores&&groups[0].store_id!==n.case.store_id)||!current.length||current[0].status!==n.case.status||current[0].status_version!==n.case.status_version){await db('bot_events?id=eq.'+e.id,'PATCH',{data:{...n,state:'cancelled'}});continue;}
   let state='unknown';try{const response=await timed('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json','X-Line-Retry-Key':n.request_id},body:JSON.stringify({to:n.group_id,messages:[{type:'text',text:responseReceipt(n.case).slice(0,4600)+(n.case.status==='hq_review'?'\n'+n.case.code+' 承認して終了 理由 / approve reason\n'+n.case.code+' 差し戻し 理由 / return reason':'')}]})});state=response.ok||response.status===409&&!!response.headers.get('x-line-accepted-request-id')?'sent':response.status>=400&&response.status<500&&response.status!==429?'failed':'unknown';}catch{}
   await db('bot_events?id=eq.'+e.id,'PATCH',{data:{...n,state}});if(state==='sent')sent++;
  }return {sent};
 }
 async function morningSummary(variant='daily'){
  if(!['daily','resend-details-v1','resend-report-v1','mention-preview-v1'].includes(variant))throw Error('invalid_summary_variant');
  const cfg=await setting('morning_summary');
  if(!cfg?.enabled)return {skipped:true,reason:'morning_summary_disabled'};
  if(!/^C[a-f0-9]{32}$/i.test(cfg.group_id||'')||!cfg.label)throw Error('morning_summary_not_configured');
  const groups=await db('bot_groups?group_id=eq.'+encodeURIComponent(cfg.group_id)+'&enabled=eq.true&select=group_id,label,all_stores');
  if(groups.length!==1||groups[0].all_stores!==true||groups[0].label!==cfg.label)throw Error('group_not_enabled');
  if(!env('LINE_CHANNEL_ACCESS_TOKEN'))throw Error('line_token_missing');
  const snapshot=await rpc('bot_morning_snapshot',{});
  const labor=(snapshot.details||[]).filter(c=>c.kind==='labor'&&!Object.hasOwn(c,'shifts')&&/^#[0-9]+$/.test(c.code));
  for(let i=0;i<labor.length;i+=50){
   const batch=labor.slice(i,i+50);
   try{
    const rows=await db('bot_cases?code=in.'+encodeURIComponent('('+batch.map(c=>c.code).join(',')+')')+'&select=code,payload');
    for(const c of batch){const p=rows.find(r=>r.code===c.code)?.payload;
     // Keep the report's detection and shift evidence consistent across reads.
     if(p&&JSON.stringify(p.kinds)===JSON.stringify(c.kinds)&&p.employee_name===c.employee_name){c.shifts=p.shifts;c.shift_cfg=p.cfg;}
    }
   }catch{/* Missing detail is explicitly reported without suppressing the HQ report. */}
  }
  const formatted=variant==='mention-preview-v1'?{messages:[{type:'text',text:'【表示テスト｜社員メンション通知】\n［登録済み社員へのメンションがここに表示されます］\n\n店舗：サンプル店舗\n対象：スタッフ名\n内容：勤怠エラー\n進捗：🟠 対応待ち\n案件：#123\n\n対応後は「#123 修正済み 修正内容」と返信してください。\n※表示確認用です。対応は不要です。'}],complete:true,total:0,detail_count:0}:formatResponsibleMorningReports(snapshot,{resend:variant!=='daily'});
  const reserved=await rpc('bot_reserve_morning_summary_v3',{p_day:snapshot.day,p_group:cfg.group_id,p_request:crypto.randomUUID(),p_messages:formatted.messages,p_variant:variant,p_snapshot_at:snapshot.snapshot_at||null});
  if(reserved.data?.state==='accepted')return {state:'accepted',already_sent:true,day:snapshot.day};
  if(reserved.data?.state==='failed')return {state:'failed',review_required:true,day:snapshot.day};
  const batches=reserved.data?.batches;
  if(!Array.isArray(batches)||!batches.length)throw Error('morning_summary_invalid_reservation');
  let sent=0;
  for(let i=0;i<batches.length;i++){
   const batch=batches[i],messages=batch.messages,request=batch.request_id;
   if(batch.state==='accepted')continue;
   if(!UUID.test(request||'')||!Array.isArray(messages)||messages.length<1||messages.length>5||messages.some(message=>message?.type!=='text'||typeof message.text!=='string'||message.text.length<1||message.text.length>4900))throw Error('morning_summary_invalid_reservation');
   let state='unknown',status=null,lineRequest=null;
   try{
    const r=await timed('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json','X-Line-Retry-Key':request},body:JSON.stringify({to:cfg.group_id,messages})});
    status=r.status;lineRequest=r.headers.get('x-line-request-id');state=r.ok||(r.status===409&&!!r.headers.get('x-line-accepted-request-id'))?'accepted':r.status>=400&&r.status<500&&r.status!==429?'failed':'unknown';
   }catch{state='unknown';}
   await rpc('bot_finish_morning_summary_batch',{p_event:reserved.id,p_batch:i,p_state:state,p_status:status,p_line_request:lineRequest});
   if(state!=='accepted')return {state,day:snapshot.day,batch:i+1,batch_count:batches.length,line_status:status,review_required:state==='failed'};
   sent+=messages.length;
  }
  return {state:'accepted',day:snapshot.day,complete:formatted.complete,total:formatted.total,detail_count:formatted.detail_count,message_count:batches.reduce((n,b)=>n+b.messages.length,0),sent_message_count:sent,batch_count:batches.length};

 }
 async function recheck(c,actor){
  try{return await checkCase(c,actor);}catch(e){await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:{clean:false,message:/^[a-z_]+$/.test(e.message)?e.message:'verification_failed',checked_at:new Date().toISOString()}}).catch(()=>{});throw e;}
 }
 async function checkCase(c,actor){
  if(c.status==='done'||c.status==='hq_review')return {clean:c.status==='done',case:c,message:c.status==='hq_review'?'hq_review_required':'closed_case'};
  if(c.status==='correction'&&c.payload?.returned){const result={clean:false,message:'awaiting_store_response',checked_at:new Date().toISOString()};await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:result});return result;}
  if(['void','unpaid'].includes(c.kind)){
   if(c.kind==='void'&&c.payload.scope!=='payment')throw Error('item_void_out_of_scope');
   if(!UUID.test(c.payload.order_guid||'')||!UUID.test(c.payload.check_guid||''))throw Error('order_ids_required');
   const store=await getStore(c.store_id),get=await toastClient(store),order=await get('/orders/v2/orders/'+c.payload.order_guid,true);
   const result={...financeResolution(c,order),checked_at:new Date().toISOString()};
   if(!result.clean){await rpc('bot_record_check',{p_id:c.id,p_version:c.version,p_actor:actor,p_result:result});return result;}
   const updated=await rpc('bot_case_write',{p_op:'verified',p_actor:actor,p_id:c.id,p_version:c.version,p_data:result});return {...result,case:updated};
  }
  if(c.kind!=='labor')throw Error('unsupported_monitor_kind');
  // Exclusion is a scope decision, not proof that a person's clock entry was corrected.
  if(ceIsSystemAccount(c.payload?.employee_name)){
   const evidence={clean:true,verification_type:'nonhuman_account_excluded',message:'excluded_nonhuman_account',employee_name:c.payload.employee_name,checked_at:new Date().toISOString()};
   const updated=await rpc('bot_case_write',{p_op:'verified',p_actor:actor,p_id:c.id,p_version:c.version,p_data:evidence});
   return {...evidence,case:updated};
  }
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
  const full=previous.length ? previous[0].body : header+message;
  const group=await db('bot_groups?group_id=eq.'+encodeURIComponent(body.group_id)+'&enabled=eq.true');if(group.length!==1||(!group[0].all_stores&&group[0].store_id!==c.store_id))throw Error('group_not_enabled');
  let lineMessage=previous.length?(previous[0].line_message||{type:'text',text:full}):lineMentionMessage(full,null);
  if(!previous.length&&body.mention_user){
   const link=await setting('line_link:'+body.group_id+':'+c.store_id);
   if(!link||link.user_id!==body.mention_user||link.assignee!==c.assignee)throw Error('mention_link_changed');
   await lineMember(body.group_id,link.user_id);lineMessage=lineMentionMessage(full,link.user_id);
  }
  if(!previous.length&&['labor','void','unpaid'].includes(c.kind))lineMessage={...lineMessage,quickReply:replyChoices(c.code)};
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
     if(e.type==='postback')continue;
     const text=e.message?.type==='text'?e.message.text:'',completion=parseCompletionReply(text);
     if(completion){
      const result=completion.invalid?{invalid:true}:await rpc('bot_complete_reports',{p_event:e.webhookEventId,p_group:g,p_user:e.source?.userId||'',p_text:text,p_codes:completion.codes});
      if(e.replyToken&&!result.ignored&&!result.duplicate){
       const message=result.invalid?(completion.reason==='limit'?'案件は20件以内、報告は4000文字以内で送ってください。 / Up to 20 cases and 4000 characters.':'完了として登録していません。完了した場合は「案件番号 完了」と送ってください。 / Not closed. To confirm completion, send case number + done.'):completionReceipt(result);
       await timed('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json'},body:JSON.stringify({replyToken:e.replyToken,messages:[{type:'text',text:message.slice(0,4900)}]})});
      }
      continue;
     }
     const parsed=parseCaseReply(text);
     if(parsed){
      const result=await rpc('bot_reply_ingest',{p_event:e.webhookEventId,p_group:g,p_user:e.source?.userId||'',p_text:text,p_code:parsed.code,p_action:parsed.invalid?null:parsed.action,p_note:parsed.note||null,p_due:parsed.due_date||null});
      if(e.replyToken&&!result.ignored&&!result.duplicate){
       const message=result.id?responseReceipt(result):result.error==='forbidden'?'回答は記録しました。案件の状態変更には本部での回答権限登録が必要です。 / Reply recorded. HQ must authorize your response access.':result.error==='hq_review_required'?'本部確認待ちです。本部は「案件番号 承認して終了 理由」または「案件番号 差し戻し 理由」で回答してください。 / Awaiting HQ approval or return.':result.error==='closed_case'?'この案件は完了済みです。 / This case is already closed.':result.not_found?'案件が見つかりません。通知の案件番号を確認してください。 / Check the case number.':replyHelp(result.code||parsed.code);
       await timed('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json'},body:JSON.stringify({replyToken:e.replyToken,messages:[{type:'text',text:message.slice(0,4900), ...(result.id&&result.status==='hq_review'?{quickReply:{items:[['承認 / Approve','承認して終了'],['差し戻し / Return','差し戻し']].map(([label,cmd])=>({type:'action',action:{type:'postback',label,data:'case_reply='+encodeURIComponent(result.code),inputOption:'openKeyboard',fillInText:result.code+' '+cmd+' '}}))}}:{})}]})});
      }
     }else await rpc('bot_ingest',{p_event_id:e.webhookEventId,p_group:g,p_user:e.source?.userId||'',p_text:text,p_type:e.type});
    }
    return json({ok:true});
   }
   const body=JSON.parse(new TextDecoder().decode(bytes));
   if(body.action==='worker'){
   const cfg=await setting('worker');if(!cfg?.key||req.headers.get('x-bot-worker-key')!==cfg.key)throw Error('unauthorized');
   if(!cfg.enabled||!(await setting('clock')))return json({skipped:true});
    await flushCaseNotices();
    if(body.mode==='morning_summary')return json(await morningSummary(body.variant||'daily'));
    if(body.mode!=='monitor'&&(await setting('collection_range'))?.mode==='month_to_yesterday')return json(await rangeRun(String(body.store_id)));
    const date=new Date(Date.now()-10*3600000-86400000).toISOString().slice(0,10);
    const result=body.mode==='monitor'?{}:await scan(String(body.store_id),date,null,cfg.finance_enabled===true);
    const start=Date.now(),pending=await db('bot_cases?kind=in.(labor,void,unpaid)&status=not.in.(done,hq_review)&or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&store_id=eq.'+encodeURIComponent(body.store_id)+'&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20');
    let checked=0,verified=0;for(const c of pending){if(Date.now()-start>45000)break;try{if((await recheck(c,null)).clean)verified++;}catch{/* Error and check time are recorded; the case stays open. */}checked++;}
    await flushCaseNotices();return json({...result,checked,verified});
   }
   const actor=await authorize(req);
   if(body.action==='daily')return json(await dailyOverview(body.after));
   if(body.action==='list')return json({actor,daily:await dailyOverview(),cases:await db('bot_cases?or='+encodeURIComponent('(kind.neq.void,payload->>scope.eq.payment)')+'&order=updated_at.desc&limit=200'),groups:await db('bot_groups?order=group_id'),line_candidates:await db('bot_settings?key=like.line_candidate:*&select=key,value'),line_links:await db('bot_settings?key=like.line_link:*&select=key,value'),line_responders:await db('bot_settings?key=like.line_responder:*&select=key,value'),closure_rules:await setting('closure_rules'),owners:await db('bot_settings?key=like.owner:*&select=key,value'),intakes:await db('bot_events?kind=eq.line_needs_store&case_id=is.null&order=id.asc&limit=50'),runs:await db('bot_runs'),clock:await setting('clock'),worker_enabled:!!(await setting('worker'))?.enabled,finance_enabled:!!(await setting('worker'))?.finance_enabled,line:{secret:!!env('LINE_CHANNEL_SECRET'),token:!!env('LINE_CHANNEL_ACCESS_TOKEN')},stores:await db('store_config?active=eq.true&select=store_id,name')});
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
   if(body.action==='closure_rules'){
    if(!['gm','ceo'].includes(actor.role))throw Error('forbidden');
    const c=body.rules;if(!c||['finance_hq','unchanged_hq','other_hq','labor_fixed_hq'].some(k=>typeof c[k]!=='boolean')||!Number.isFinite(c.finance_threshold)||c.finance_threshold<0)throw Error('invalid_config');
    await db('bot_settings?on_conflict=key','POST',{key:'closure_rules',value:{finance_hq:c.finance_hq,unchanged_hq:c.unchanged_hq,other_hq:c.other_hq,labor_fixed_hq:c.labor_fixed_hq,finance_threshold:c.finance_threshold},updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({ok:true});
   }
   if(body.action==='responder_profile'){
    if(!APPROVERS.includes(actor.role))throw Error('forbidden');
    const candidate=await setting('line_candidate:'+body.group_id+':'+body.user_id);if(!candidate)throw Error('registration_required');
    const profile=await lineMember(body.group_id,body.user_id);return json({profile:{display_name:profile.displayName}});
   }
   if(body.action==='line_responder'){
    if(!APPROVERS.includes(actor.role))throw Error('forbidden');
    if(!/^C[a-f0-9]{32}$/i.test(body.group_id||'')||!/^U[a-f0-9]{32}$/i.test(body.user_id||''))throw Error('invalid_line_user');
    const key='line_responder:'+body.group_id+':'+body.user_id;
    if(body.remove===true){await db('bot_settings?key=eq.'+encodeURIComponent(key),'DELETE');return json({ok:true});}
    if(!['manager','hq'].includes(body.role)||body.role==='hq'&&!['gm','ceo'].includes(actor.role))throw Error('forbidden');
    const candidate=await setting('line_candidate:'+body.group_id+':'+body.user_id);if(!candidate)throw Error('registration_required');
    const groups=await db('bot_groups?group_id=eq.'+body.group_id+'&enabled=eq.true');if(groups.length!==1)throw Error('group_not_enabled');
    const stores=Array.isArray(body.stores)?[...new Set(body.stores)]:[];if(body.role==='manager'&&!stores.length)throw Error('invalid_store');
    for(const id of stores){await getStore(id);if(!groups[0].all_stores&&groups[0].store_id!==id)throw Error('forbidden');}
    const profile=await lineMember(body.group_id,body.user_id);if(body.display_name!==profile.displayName)throw Error('mention_link_changed');
    await db('bot_settings?on_conflict=key','POST',{key,value:{group_id:body.group_id,user_id:body.user_id,display_name:profile.displayName,role:body.role,stores,enabled:true,approved_by:actor.id,approved_at:new Date().toISOString()},updated_at:new Date().toISOString()},'resolution=merge-duplicates');return json({ok:true});
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
   if(body.action==='respond')return json(await rpc('bot_case_respond',{p_id:c.id,p_version:c.version,p_action:body.response,p_note:String(body.note||'').trim(),p_actor:actor.id,p_due:body.due_date||null}));
   if(body.action==='recheck')return json(await recheck(c,actor.id));
   const ops=['assign','note','draft','correction','reported','acknowledge','purchase','approve','ordered'];if(!ops.includes(body.action))throw Error('bad_action');
   const data={assignee:String(body.assignee||'').trim(),note:String(body.note||'').trim(),draft:String(body.draft||'').trim(),order_number:String(body.order_number||'').trim()};
   if(body.action==='assign'&&/[\r\n]/.test(data.assignee))throw Error('assignee_required');
   if(body.action==='purchase'){data.url=safePurchaseURL(body.url);data.quantity=Number(body.quantity);if(!Number.isFinite(data.quantity)||data.quantity<=0||data.quantity>100000)throw Error('invalid_quantity');}
   return json(await rpc('bot_case_write',{p_op:body.action,p_actor:actor.id,p_id:c.id,p_version:body.version,p_data:data}));
  }catch(e){const code=e instanceof SyntaxError?'invalid_json':e.message||'request_failed';const status=code==='unauthorized'?401:code==='forbidden'?403:['conflict','send_unresolved','scan_busy'].includes(code)?409:code.includes('missing')||code.includes('not_configured')?503:400;return json({error:/^[a-z_]+$/.test(code)?code:'request_failed'},status);}
 };
}
