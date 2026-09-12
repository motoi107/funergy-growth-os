import test from 'node:test';
import assert from 'node:assert/strict';
import {formatResponsibleMorningReports} from '../supabase/functions/ops-bot/handler.mjs';
const base={from:'2026-09-01',to:'2026-09-11',expected:11,ok:11,finance_ok:11,failed:0,active_stores:1,finance_enabled:true};
const row=(code,kind,progress='not_sent')=>({code,kind,progress,status:'review',store_id:'TEST',store_name:'Synthetic',subject:kind==='labor'?'Synthetic worker':kind==='void'?'Payment Void / #123':'Unpaid / #124',employee_name:'Synthetic worker',kinds:['long'],amount:12.5,assignee:'Legacy owner'});
const combined={...base,details:[row('#1','labor','waiting'),row('#2','void'),row('#3','unpaid')],detail_total:3,counts:{labor:1,void:1,unpaid:1},stores:[{store_id:'TEST',labor:1,void:1,unpaid:1}],recent_closed:[{...row('#4','labor'),closure:{note:'Clock fixed'}},{...row('#5','void'),closure:{note:'Payment checked'}},{...row('#6','unpaid'),closure:{note:'Paid'}}]};
test('labor and finance have separate owners, counts, statuses, cases and completed cases',()=>{
 const {reports,messages}=formatResponsibleMorningReports(combined,{resend:true});assert.equal(reports.length,2);
 const labor=reports[0].messages.map(m=>m.text).join('\n'),finance=reports[1].messages.map(m=>m.text).join('\n');
 assert.match(labor,/勤怠管理レポート｜再送/);assert.match(labor,/担当：Moto・Yuki/);assert.match(labor,/未解決：1件/);assert.match(labor,/未通知 0.*対応待ち 1/);
 assert.match(finance,/会計管理レポート｜再送/);assert.match(finance,/担当：経理/);assert.match(finance,/未解決：2件（Payment Void 1／Unpaid 1）/);assert.match(finance,/未通知 2.*対応待ち 0/);
 for(const id of ['#1','#4']){assert.match(labor,new RegExp('案件：'+id));assert.doesNotMatch(finance,new RegExp('案件：'+id));}
 for(const id of ['#2','#3','#5','#6']){assert.match(finance,new RegExp('案件：'+id));assert.doesNotMatch(labor,new RegExp('案件：'+id));}
 assert.doesNotMatch(labor,/Payment Void|Unpaid|決済|Legacy owner/);assert.doesNotMatch(finance,/Synthetic worker|Moto・Yuki|Legacy owner/);
 for(const report of reports)report.messages.forEach((m,i)=>{assert.ok(m.text.startsWith('【'+(report.category==='labor'?'勤怠管理｜Moto・Yuki':'会計管理｜経理')+' '+(i+1)+'/'+report.messages.length+'】'));});
 assert.equal(messages.length,reports.reduce((n,r)=>n+r.messages.length,0));assert.ok(messages.every(m=>m.text.length<=4900));
});
test('zeroes and collection failure are evaluated independently for each responsibility',()=>{
 const s={...base,details:[],detail_total:0,counts:{labor:0,void:0,unpaid:0},finance_enabled:false,finance_ok:0};
 const {reports}=formatResponsibleMorningReports(s);assert.equal(reports[0].complete,true);assert.equal(reports[1].complete,false);
 assert.match(reports[0].text,/未解決の異常はありません/);assert.doesNotMatch(reports[0].text,/決済データ/);
 assert.match(reports[1].text,/決済データの取得が未完了/);assert.doesNotMatch(reports[1].text,/未解決の異常はありません/);
 const ready=formatResponsibleMorningReports({...s,finance_enabled:true,finance_ok:11});assert.ok(ready.reports.every(r=>r.complete));assert.ok(ready.reports.every(r=>/未解決の異常はありません/.test(r.text)));
});
test('all cases remain present when each responsibility exceeds one LINE batch',()=>{
 const details=Array.from({length:600},(_,i)=>row('#'+(i+1),i%3===0?'labor':i%3===1?'void':'unpaid'));
 const result=formatResponsibleMorningReports({...base,details,detail_total:600,counts:{labor:200,void:200,unpaid:200}});
 assert.ok(result.reports.every(r=>r.messages.length>5));
 for(const report of result.reports){const text=report.messages.map(m=>m.text).join('\n');for(const c of details)assert.equal(new RegExp('案件：'+c.code+'(?:\\n|$)').test(text),report.category==='labor'?c.kind==='labor':c.kind!=='labor');}
 assert.equal(result.detail_count,600);assert.ok(result.messages.every(m=>m.text.length<=4900));
});
test('missing classification and incomplete snapshots fail explicitly instead of silently omitting cases',()=>{
 assert.throws(()=>formatResponsibleMorningReports({...combined,recent_closed:[{code:'#9'}]}),/missing_case_kind/);
 assert.throws(()=>formatResponsibleMorningReports({...combined,details:combined.details.slice(0,2)}),/incomplete_details/);
});
