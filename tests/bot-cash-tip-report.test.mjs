// v1118（Moto さん 10/30 ①）：業務Bot のキャッシュチップの知らせは、未入力を知らせず（未登録は 0 として補完する）、不正な値だけを知らせる。
import test from 'node:test';
import assert from 'node:assert/strict';
import {cashTipEntered,cashTipValueOk,cashTipFindings,formatCashTipReport} from '../bot/cash-tip-report.mjs';
const store={id:'TEST',name:'Synthetic',active:true};
const check=(cash,extra={})=>cashTipFindings({from:'2026-09-14',to:'2026-09-14',stores:[store],cash:{TEST:{'2026-09-14':cash}},...extra});
test('entered flags keep their meaning (explicit zero is entered; default zero and blanks are not)',()=>{
 for(const value of [0,'0',12.3])assert.equal(cashTipEntered({lunch:value,lunchEntered:true},'lunch'),true);
 for(const value of [undefined,null,'',' ',NaN,Infinity,-1,false,[],{}])assert.equal(cashTipEntered({lunch:value,lunchEntered:true},'lunch'),false);
 assert.equal(cashTipEntered({lunch:0},'lunch'),false);
 assert.equal(cashTipEntered({lunch:0,entered:true},'lunch'),true);
 assert.equal(cashTipEntered({lunch:0,entered:true,lunchEntered:false},'lunch'),false);
});
test('missing entries are no longer reported; only invalid values are',()=>{
 assert.equal(check(null).length,0,'no record = counted as 0, no report');
 assert.equal(check({lunch:0,lunchEntered:true}).length,0,'one side missing = no report');
 assert.equal(check({lunch:0,dinner:0,entered:true}).length,0);
 assert.equal(check({lunch:0,dinner:0,lunchEntered:true,dinnerEntered:true,lunchAuto:true,dinnerAuto:true,autoBy:'system'}).length,0,'automatic zero is fine');
 for(const bad of ['abc',-1,'-3',NaN,Infinity,false,[],{}])assert.deepEqual(check({lunch:bad,lunchEntered:true,dinner:5,dinnerEntered:true})[0].invalid,['lunch'],String(bad));
 assert.deepEqual(check({lunch:'x',dinner:-2})[0].invalid,['lunch','dinner'],'invalid even without the entered flag');
 for(const ok of [0,'0',' 12.5 ',12.5,'',null,undefined])assert.equal(cashTipValueOk(ok),true,String(ok));
 assert.equal(check({lunch:'abc'},{stores:[{...store,active:false}]}).length,0);
 assert.equal(check({lunch:'abc'},{config:{excluded_store_ids:['TEST']}}).length,0);
});
test('reports are silent when nothing is invalid and split all invalid days within LINE limits',()=>{
 assert.equal(formatCashTipReport([]).messages.length,0);
 const rows=Array.from({length:700},(_,i)=>({store_id:'TEST',store_name:'Synthetic',business_date:'2026-09-'+String(i+1),invalid:['lunch','dinner']}));
 const report=formatCashTipReport(rows,{from:'2026-09-01',to:'2026-09-19'}),text=report.messages.map(m=>m.text).join('\n');
 assert.ok(report.messages.length>5);assert.ok(report.messages.every(m=>m.text.length<=4900));
 for(const row of rows)assert.ok(text.includes(row.business_date+'：'));
 assert.match(text,/不正/);assert.doesNotMatch(text,/未入力：/);assert.match(text,/700店舗日を全件掲載/);
});
