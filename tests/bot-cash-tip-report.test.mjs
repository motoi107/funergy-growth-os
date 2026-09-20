import test from 'node:test';
import assert from 'node:assert/strict';
import {cashTipEntered,cashTipFindings,formatCashTipReport} from '../bot/cash-tip-report.mjs';
const store={id:'TEST',name:'Synthetic',active:true};
const check=(cash,extra={})=>cashTipFindings({from:'2026-09-14',to:'2026-09-14',stores:[store],cash:{TEST:{'2026-09-14':cash}},...extra});
test('explicit zero is entered; default zero, blanks, null, invalid and unconfirmed values are missing',()=>{
 for(const value of [0,'0',12.3])assert.equal(cashTipEntered({lunch:value,lunchEntered:true},'lunch'),true);
 for(const value of [undefined,null,'',' ',NaN,Infinity,-1,false,[],{}])assert.equal(cashTipEntered({lunch:value,lunchEntered:true},'lunch'),false);
 assert.equal(cashTipEntered({lunch:0},'lunch'),false);
 assert.equal(cashTipEntered({lunch:0,entered:true},'lunch'),true);
 assert.equal(cashTipEntered({lunch:0,entered:true,lunchEntered:false},'lunch'),false);
 assert.deepEqual(check({lunch:0,lunchEntered:true})[0].missing,['dinner']);
 assert.equal(check({lunch:0,dinner:0,entered:true}).length,0);
});
test('whole-day, partial closures, dinner-only, final day and inactive/excluded stores',()=>{
 assert.equal(check(null,{stores:[{...store,bizDays:{月:'closed'}}]}).length,0);
 assert.deepEqual(check(null,{stores:[{...store,bizDays:{月:'lclose'}}]})[0].missing,['dinner']);
 assert.equal(check({dinner:0,dinnerEntered:true},{stores:[{...store,bizDays:{月:'lclose'}}]}).length,0);
 assert.deepEqual(check(null,{hours:{TEST:{mode:'hours',dow:{月:{lOn:true,dOn:false}}}}})[0].missing,['lunch']);
 assert.equal(check(null,{config:{last_business_dates:{TEST:'2026-09-13'}}}).length,0);
 assert.equal(check(null,{config:{last_business_dates:{TEST:'2026-09-14'}}}).length,1);
 assert.equal(check(null,{config:{first_business_dates:{TEST:'2026-09-15'}}}).length,0);
 assert.equal(check(null,{stores:[{...store,active:false}]}).length,0);
 assert.equal(check(null,{config:{excluded_store_ids:['TEST']}}).length,0);
 assert.equal(check(null,{closures:{TEST:{'2026-09-14':{mode:'closed'}}}}).length,0);
});
test('reports are silent when complete and split all missing days within LINE limits',()=>{
 assert.equal(formatCashTipReport([]).messages.length,0);
 const rows=Array.from({length:700},(_,i)=>({store_id:'TEST',store_name:'Synthetic',business_date:'2026-09-'+String(i+1),missing:['lunch','dinner']}));
 const report=formatCashTipReport(rows,{from:'2026-09-01',to:'2026-09-19'}),text=report.messages.map(m=>m.text).join('\n');
 assert.ok(report.messages.length>5);assert.ok(report.messages.every(m=>m.text.length<=4900));
 for(const row of rows)assert.ok(text.includes(row.business_date+'：'));
 assert.match(text,/「0」/);assert.match(text,/700店舗日を全件掲載/);
});
