import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
export function fn(name,s=source){
  const start=s.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  const end=s.indexOf('\n}',start);
  return s.slice(start,end+2);
}
export function ctx(){
  const c={console,Date,DOW:['月','火','水','木','金','土','日'],
    cfg:{mode:'hours',dow:{},lOn:false,dOn:true},closure:null,
    getTipHoursCfg:()=>c.cfg,tipHoursWindowFor:()=>c.cfg,
    dowLabelForDate:()=> '月',dayClosureMode:()=>c.closure,
    getBudgetForMonth:()=>c.budget,getDow:b=>b.dow,getSegments:b=>b?.segments||{},
    bizToday:()=> '2026-09-09',getDailyActuals:()=>c.daily,
    guestCountType:()=> 'guest',laborCoreForYm:()=>({total:0,sales:0}),
    getTipLabor:()=>null,foodCostOf:()=>({invoice:0,buy:0,transfer:0}),
    segmentsTotal:()=>0,segmentsFcBudget:()=>0,segmentsLaborBudget:()=>0,
    monthGuestBudget:()=>300,budgetGuestsMonthly:()=>null,budgetTakeoutMonthly:()=>null,
    monthTakeoutSalesBudget:()=>0,monthSalesBudget:()=>c.salesBudget,
    repeatStats:()=>({has:false}),prevMonthDaysList:()=>[],t:(ja,en)=>c.lang==='en'?en:ja,
    daily:{},salesBudget:14000};
  vm.createContext(c);
  for(const name of ['usesDowMode','segSales','weekdayCountsForMonth','dowSegMonthly','salesActualForDay','budgetSpendBasis','daysOfYm','meetingBudgetPlan','meetingBudgetKpi','keyKpiStats','_meetSegExtra','_meetLaborLD','_meetKpiRows']) vm.runInContext(fn(name),c);
  c.budget={dow:{lunch:[],dinner:Array.from({length:7},()=>({guests:10,spend:51})),takeout:[]}};
  return c;
}
test('dinner-only sales view moves sales, guests and takeout together, preserving totals and Tip',()=>{
  const c=ctx(), raw={actual:1020,guests:20,lunchSales:204,dinnerSales:816,lunchGuests:4,dinnerGuests:16,
    toLunchSales:51,toDinnerSales:51,toLunchCount:1,toDinnerCount:1,
    lunchCreditTip:20,dinnerCreditTip:80,lunchCashTip:5,budget:999};
  const before=JSON.stringify(raw), out=c.salesActualForDay('TEST','2026-09-01',raw);
  assert.equal(out.lunchSales,0);assert.equal(out.dinnerSales,1020);
  assert.equal(out.lunchGuests,0);assert.equal(out.dinnerGuests,20);
  assert.equal(out.toDinnerSales,102);assert.equal(out.toDinnerCount,2);
  for(const key of ['actual','guests','lunchCreditTip','dinnerCreditTip','lunchCashTip','budget']) assert.equal(out[key],raw[key]);
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(c.salesActualForDay('TEST','2026-09-01',out),out);
});
test('mixed-service, closed, dinner-closed and unconfigured days preserve source classification',()=>{
  const c=ctx(),r={lunchSales:150,dinnerSales:250};
  for(const cfg of [{mode:'all',dow:{}},{mode:'hours'},{mode:'hours',dow:{},lOn:true,dOn:true},{mode:'hours',dow:{},lOn:false,dOn:false}]){
    c.cfg=cfg; assert.equal(c.salesActualForDay('TEST','2026-09-01',r),r);
  }
  c.cfg={mode:'hours',dow:{},lOn:false,dOn:true};
  for(const closure of ['closed','dclose']){c.closure=closure;assert.equal(c.salesActualForDay('TEST','2026-09-01',r),r);}
});
test('entered spend remains 51 despite holiday/day sales overrides; explicit month weights are used',()=>{
  const c=ctx();c.budget.days={'2026-08-01':0,'2026-08-02':100};
  const b=c.budgetSpendBasis('TEST','2026-08');
  assert.equal(b.guests,310);assert.equal(b.sales/b.guests,51);
  assert.equal(c.budgetSpendBasis('TEST','2026-02').guests,280);
  c.budget.dow.lunch=Array.from({length:7},()=>({guests:5,spend:30}));
  c.budget.dow.takeout=Array.from({length:7},()=>({orders:2,spend:20}));
  const mix=c.budgetSpendBasis('TEST','2026-09');
  assert.equal(mix.sales/mix.guests,700/17);
  assert.equal(mix.dineSales/mix.dineGuests,44);
});
test('monthly segment targets use entered spend rather than an overridden sales amount',()=>{
  const c=ctx();c.budget={segments:{dinner:{guests:100,spend:51,sales:4500},takeout:{orders:10,spend:20}}};
  const b=c.budgetSpendBasis('TEST','2026-09');
  assert.equal(b.dineSales/b.dineGuests,51);assert.equal(b.sales,5300);assert.equal(b.guests,110);
});
test('multi-store spend targets retain stores with legacy sales and guests but no entered spend',()=>{
  const c=ctx(), entered=c.budget;
  c.getBudgetForMonth=id=>id==='ENTERED'?entered:{segments:{dinner:{guests:300,sales:9000}}};
  c.monthSalesBudget=id=>id==='ENTERED'?14000:9000;
  const k=c.keyKpiStats([{id:'ENTERED'},{id:'LEGACY'}],[{date:'2026-09-01'}]);
  assert.equal(k.budget,23000);assert.ok(Math.abs(k.ppaBudget-23000/(14000/51+300))<1e-9);assert.ok(Math.abs(k.ppaBudget-k.ppaDineBudget)<1e-9);
});
test('explicit zero-price guests are included in a weighted target',()=>{
  const c=ctx();c.budget.dow.lunch=Array.from({length:7},()=>({guests:10,spend:0}));
  const b=c.budgetSpendBasis('TEST','2026-09');assert.equal(b.guests,600);assert.equal(b.sales/b.guests,25.5);
});
test('meeting KPI integration uses adjusted services and entered target, keeps raw and day cutoff',()=>{
  const c=ctx(); c.daily={'2026-09-01':{actual:1020,guests:20,lunchSales:204,dinnerSales:816,lunchGuests:4,dinnerGuests:16},
    '2026-09-09':{actual:9999,guests:1,lunchSales:9999,lunchGuests:1}};
  const before=JSON.stringify(c.daily);
  const k=c.keyKpiStats([{id:'TEST'}],[{date:'2026-09-01'},{date:'2026-09-09'}]);
  assert.equal(k.sales,1020);assert.equal(k.guests,20);assert.equal(k.ppa,51);
  assert.equal(k.lunchGuests,0);assert.equal(k.dinnerGuests,20);assert.equal(k.ppaLunch,null);assert.equal(k.ppaDinner,51);
  assert.equal(k.budget,14000);assert.ok(Math.abs(k.ppaBudget-51)<1e-9);assert.ok(Math.abs(k.ppaDineBudget-51)<1e-9);
  assert.equal(JSON.stringify(c.daily),before);
  for(const lang of ['ja','en']){c.lang=lang;
    const html=c._meetSegExtra(k,'ppa','TEST','2026-09',1,'');
    assert.match(html,/\$51/); assert.doesNotMatch(html,/ランチ|>L /);
    assert.ok(Math.abs(c._meetKpiRows(k).find(x=>x.key==='ppa').tgt-51)<1e-9);
  }
});
test('meeting labor sales denominator uses same service classification',()=>{
  const c=ctx();c.daily={'2026-09-01':{lunchSales:50,dinnerSales:450}};
  c.daysOfYm=()=>[{date:'2026-09-01'}];const b=c._meetLaborLD('TEST','2026-09');
  assert.equal(b.lunchSales,0);assert.equal(b.dinnerSales,500);
});
test('meeting detail preserves dinner-only actuals and a zero target day has no spend target',()=>{
  const c=ctx();for(const name of ['_gapDowPerDay','_gapDowGuestsPerDay','_meetGapBreakdown']) vm.runInContext(fn(name),c);
  c._gapDaysElapsed=()=>({days:[{date:'2026-09-01',dowIdx:1}],counts:[0,1,0,0,0,0,0]});
  c.daily={'2026-09-01':{actual:510,guests:10,lunchSales:102,dinnerSales:408,lunchGuests:2,dinnerGuests:8,budget:0}};
  const p=c._meetGapBreakdown('TEST','2026-09','ppa');
  assert.equal(p.tgt,null);assert.equal(p.act,51);assert.equal(p.ld.lunch.act,null);assert.equal(p.ld.dinner.act,51);
  const s=c._meetGapBreakdown('TEST','2026-09','sales');
  assert.equal(s.tgt,0);assert.equal(s.act,510);assert.equal(s.ld.lunch.act,0);assert.equal(s.ld.dinner.act,510);
});
test('Tip computation, raw storage and Toast import are byte-identical to baseline',()=>{
  const baseline=execFileSync('git',['show','2b3b9ea:index.html'],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:10*1024*1024}).replace(/\r\n/g,'\n');
  for(const name of ['tipForDay','tipDayLunchOff','applyTipHoursClip','applyTipSplit','tipHoursWindowFor','getTipLabor','getDailyActuals','getTipHoursCfg','syncStoreActualsFromToast']) assert.equal(fn(name),fn(name,baseline),name);
});
