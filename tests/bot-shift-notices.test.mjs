import test from 'node:test';
import assert from 'node:assert/strict';
import {morningShiftLines,formatMorningSummary,createHandler} from '../supabase/functions/ops-bot/handler.mjs';
const cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
test('shift notices show Hawaii dates, elapsed duration, actual thresholds, missing punches and overlaps',()=>{
 const sh=(a,b)=>({inDate:a,outDate:b});
 const text=morningShiftLines({shift_cfg:cfg,shifts:[sh('2026-09-08T20:00:00Z','2026-09-09T09:30:00Z'),sh('2026-09-09T03:00:00Z','2026-09-09T13:00:00Z'),sh('2026-09-09T20:00:00Z',null)]});
 assert.match(text,/09\/08 10:00 → 09\/08 23:30（13時間30分）/);assert.match(text,/長時間：12時間超/);
 assert.match(text,/09\/08 17:00 → 09\/09 03:00/);assert.match(text,/自動退勤疑い：退勤が03:00〜05:00/);assert.match(text,/他の打刻と重複/);
 assert.match(text,/退勤未打刻（時間算出不可）/);assert.match(text,/休憩控除前/);
 assert.match(morningShiftLines({}),/詳細を取得できません/);
 assert.match(morningShiftLines({shift_cfg:cfg,shifts:[sh('bad','2026-09-09T09:00:00Z')]}),/時刻不正/);
 assert.match(morningShiftLines({shift_cfg:cfg,shifts:[sh('2026-09-09T10:00:00Z','2026-09-09T09:00:00Z')]}),/IN\/OUT逆転/);
});
test('large shift lists retain case identity and response status within LINE limits',()=>{
 const c={kind:'labor',code:'#123',employee_name:'Example',business_date:'2026-09-08',store_id:'TEST',status:'hq_review',kinds:['long'],shift_cfg:cfg,shifts:Array.from({length:30},()=>({inDate:'2026-09-08T20:00:00Z',outDate:'2026-09-09T09:00:00Z'}))};
 const m=formatMorningSummary({details:[c],counts:{labor:1},stores:[]});assert.match(m.messages[1].text,/ほか26勤務/);assert.match(m.messages[1].text,/本部確認待ち/);assert.match(m.messages[1].text,/案件：#123/);assert.ok(m.messages.every(x=>x.text.length<=4900));
});
test('morning worker enriches saved cases before reservation without changing delivery timing',async()=>{
 const group='C'+'a'.repeat(32),guid='00000000-0000-4000-8000-000000000001';let reserved,pushes=0;
 const detail={kind:'labor',code:'#123',employee_name:'Example',business_date:'2026-09-08',store_id:'TEST',status:'waiting',kinds:['long']};
 const h=createHandler({env:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'test'})[k],fetch:async(url,init)=>{
  if(url.includes('key=eq.worker'))return Response.json([{value:{enabled:true,key:'worker'}}]);
  if(url.includes('key=eq.clock'))return Response.json([{value:cfg}]);
  if(url.includes('kind=eq.lifecycle_notice'))return Response.json([]);
  if(url.includes('key=eq.morning_summary'))return Response.json([{value:{enabled:true,group_id:group,label:'HQ'}}]);
  if(url.includes('/bot_groups?'))return Response.json([{group_id:group,label:'HQ',all_stores:true}]);
  if(url.endsWith('/rpc/bot_morning_snapshot'))return Response.json({day:'2026-09-09',details:[detail],counts:{labor:1},stores:[]});
  if(url.includes('/bot_cases?code=in.'))return Response.json([{code:'#123',payload:{employee_name:'Example',kinds:['long'],cfg,shifts:[{inDate:'2026-09-08T20:00:00Z',outDate:'2026-09-09T09:00:00Z'}]}}]);
  if(url.endsWith('/rpc/bot_reserve_morning_summary_v2')){reserved=JSON.parse(init.body);return Response.json({id:1,data:{state:'pending',messages:reserved.p_messages,request_id:guid}});}
  if(url.endsWith('/rpc/bot_finish_morning_summary'))return Response.json(null);
  if(url.endsWith('/message/push')){pushes++;return new Response(null,{status:200});}
  throw Error(url);
 }});
 const res=await h(new Request('https://fn.test',{method:'POST',headers:{'x-bot-worker-key':'worker'},body:JSON.stringify({action:'worker',mode:'morning_summary'})}));
 assert.equal(res.status,200);assert.equal(reserved.p_variant,'daily');assert.match(reserved.p_messages[1].text,/09\/08 10:00 → 09\/08 23:00/);assert.equal(pushes,1);
});
