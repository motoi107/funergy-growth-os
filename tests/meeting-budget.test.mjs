import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ctx,fn} from './meeting-sales.test.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function setup(){
  const c=ctx();
  for(const name of ['segSales','segmentsTotal','dowSegBreakdown','monthSalesBudget','_gapDowPerDay','_gapDowGuestsPerDay','_meetGapBreakdown','mdStoreSeries','mdWeekRates']) vm.runInContext(fn(name),c);
  c._mdMemo=(type,key,f)=>f(); c.curYm=()=>c.bizToday().slice(0,7);
  c._gapDaysElapsed=ym=>{const days=c.daysOfYm(ym).filter(d=>d.date<c.bizToday()).map(d=>({...d,dowIdx:(new Date(d.date+'T12:00:00').getDay()+6)%7})),counts=Array(7).fill(0);days.forEach(d=>counts[d.dowIdx]++);return {days,counts};};
  return c;
}
function check(c,ym){
  const plan=c.meetingBudgetPlan('TEST',ym), k=c.keyKpiStats([{id:'TEST'}],c.daysOfYm(ym));
  near(plan.month.sales,c.monthSalesBudget('TEST',ym));
  for(const [current,p] of [[false,plan.month],[true,plan.elapsed]]){
    const v=c.meetingBudgetKpi(k,current);
    near(v.budget,p.sales);near(v.guestBudget,p.guests);
    if(p.guests>0) near(v.guestBudget*v.ppaBudget,v.budget);
    near(v.lunchGuestBud+v.dinnerGuestBud+v.takeoutBud,v.guestBudget);
  }
  near(Object.values(plan.days).reduce((a,d)=>a+d.sales,0),plan.month.sales);
  return {plan,k};
}
test('revised daily sales, zero holiday and entered 51 produce coherent monthly/elapsed targets',()=>{
  const c=setup();c.budget.days={'2026-08-01':0,'2026-08-02':255};
  c.daily={'2026-08-03':{actual:510,guests:10,dinnerSales:510,dinnerGuests:10,budget:765}};
  const before=JSON.stringify([c.budget,c.daily]),{plan,k}=check(c,'2026-08');
  near(k.ppaBudget,51);near(k.guestBudget,k.budget/51);near(plan.days['2026-08-01'].guests,0);near(plan.days['2026-08-02'].guests,5);near(plan.days['2026-08-03'].guests,15);
  const g=c._meetGapBreakdown('TEST','2026-08','guests'),p=c._meetGapBreakdown('TEST','2026-08','ppa'),s=c._meetGapBreakdown('TEST','2026-08','sales');
  near(g.tgt,k.guestBudget);near(p.tgt,k.ppaBudget);near(s.tgt,k.budget);
  near(s.cause.guestsEffect+s.cause.ppaEffect,s.gap);
  assert.equal(JSON.stringify([c.budget,c.daily]),before);
});
test('partial manual budgets retain authoritative sales total across variable weekdays',()=>{
  const c=setup();c.budget.dow.dinner=c.budget.dow.dinner.map((x,i)=>({guests:10+i,spend:40+i}));
  c.budget.days={'2026-09-01':0,'2026-09-02':1200};c.daily={'2026-09-02':{budget:800}};
  const {plan}=check(c,'2026-09');near(plan.days['2026-09-02'].sales,800);
  near(plan.days['2026-09-02'].segments.dinner.s/plan.days['2026-09-02'].segments.dinner.g,42);
  const v=c.meetingBudgetKpi(c.keyKpiStats([{id:'TEST'}],c.daysOfYm('2026-09')),true);
  near(v.ppaBudget,v.budget/v.guestBudget);
});
test('all store mixes preserve L/D/TO prices and include takeout targets even without takeout actuals',()=>{
  const c=setup();c.cfg.lOn=true;
  c.budget.dow.lunch=Array.from({length:7},()=>({guests:5,spend:30}));
  c.budget.dow.takeout=Array.from({length:7},()=>({orders:2,spend:20}));
  c.budget.days={'2026-09-01':1360};
  c.daily={'2026-09-01':{actual:510,guests:10,dinnerSales:510,dinnerGuests:10}};
  const {plan}=check(c,'2026-09'), d=plan.days['2026-09-01'];
  near(d.segments.lunch.s/d.segments.lunch.g,30);near(d.segments.dinner.s/d.segments.dinner.g,51);near(d.segments.takeout.s/d.segments.takeout.g,20);
  const sales=c._meetGapBreakdown('TEST','2026-09','sales'),g=c._meetGapBreakdown('TEST','2026-09','guests');
  assert.equal(sales.hasTakeout,true);assert.ok(sales.ld.takeout.tgt>0);near(sales.tgt,plan.elapsed.sales);near(g.tgt,plan.elapsed.guests);
  near(g.dow.reduce((a,d)=>a+d.tgt,0),g.tgt);
});
test('segment mode, explicit segment sales, legacy spend fallback and multiple stores',()=>{
  const c=setup(), a={segments:{lunch:{guests:100,spend:30,sales:2400},dinner:{guests:100,spend:50},takeout:{orders:10,spend:20}}},b={segments:{dinner:{guests:100,sales:3000}}};
  c.getBudgetForMonth=id=>id==='LEGACY'?b:a;
  const ka=c.keyKpiStats([{id:'TEST'}],c.daysOfYm('2026-08')),kb=c.keyKpiStats([{id:'LEGACY'}],c.daysOfYm('2026-08'));
  const both=c.keyKpiStats([{id:'TEST'},{id:'LEGACY'}],c.daysOfYm('2026-08'));
  near(ka.budget,7600);near(ka.guestBudget,190);near(ka.meetingSegments.lunch.s,2400);near(ka.meetingSegments.dinner.s,5000);near(ka.meetingSegments.takeout.s,200);near(kb.ppaBudget,30);near(both.guestBudget,ka.guestBudget+kb.guestBudget);near(both.ppaBudget,both.budget/both.guestBudget);
});
test('month start, leap month and explicit zero sales keep zero elapsed targets',()=>{
  const c=setup();c.bizToday=()=> '2028-02-01';let {plan}=check(c,'2028-02');assert.equal(Object.keys(plan.days).length,29);near(plan.elapsed.sales,0);near(plan.elapsed.guests,0);
  c.budget.days=Object.fromEntries(c.daysOfYm('2028-02').map(d=>[d.date,0]));({plan}=check(c,'2028-02'));near(plan.month.sales,0);near(plan.month.guests,0);
});
test('absent price and zero-price bases do not manufacture an infinite guest target',()=>{
  const c=setup();c.budget={segments:{dinner:{sales:3000}}};
  assert.equal(c.meetingBudgetPlan('TEST','2026-08').month.complete,false);
  assert.equal(c.keyKpiStats([{id:'TEST'}],c.daysOfYm('2026-08')).guestBudget,null);
  c.budget={dow:{lunch:Array.from({length:7},()=>({guests:10,spend:0}))}};
  const p=c.meetingBudgetPlan('TEST','2026-08');near(p.month.guests,310);near(p.month.sales,0);
  c.budget.days={'2026-08-01':100};assert.equal(c.meetingBudgetPlan('TEST','2026-08').month.complete,false);
});
test('edited budgets recalculate without storing or reusing stale plans',()=>{
  const c=setup();const a=check(c,'2026-09').k;c.budget.days={'2026-09-01':255};const b=check(c,'2026-09').k;
  assert.ok(a.budget>b.budget);assert.ok(a.guestBudget>b.guestBudget);near(b.ppaBudget,51);
  c.budget.dow.dinner.forEach(x=>x.spend=60);const d=check(c,'2026-09').k;near(d.ppaBudget,60);
});
test('meeting week chart uses the same daily guest/sales plan and week-weighted spend',()=>{
  const c=setup();c.budget.days={'2026-09-01':255};c.daily={'2026-09-01':{actual:255,guests:5}};
  c.laborMonthWeeks=()=>[{sun:'2026-08-30'},{sun:'2026-09-06'}];c.laborWeekHours=()=>({byWeek:{},total:0});c._mdDayGuests=(id,ov)=>ov.guests||0;c.dayCostReal=()=>0;c.getStoreKpiTargets=()=>({});c.mcYmOffset=()=>0;
  const ser=c.mdStoreSeries('TEST','2026-09',true),p=c.meetingBudgetPlan('TEST','2026-09');
  near(ser.budMonth,p.month.sales);near(ser.weeks.reduce((a,w)=>a+w.guestBud,0),p.elapsed.guests);
  const rates=c.mdWeekRates('TEST','2026-09',true);assert.equal(rates[0].ppa,100);
});
test('Japanese/English summary, store card and all-store status use identical period targets',()=>{
  const c=setup();
  for(const name of ['_meetStoreSummary','_meetStoreCard','renderMeetingReview']) vm.runInContext(fn(name),c);
  c.budget.days={'2026-09-01':255};const store={id:'TEST',name:'Test'},ym='2026-09';
  c.escapeHtml=String;c.fmtK=String;c.bizNow=()=>new Date('2026-09-09T12:00:00');c.budgetYM=()=>({y:2026,m:9});c.budgetScopeStores=()=>[store,{id:'OTHER',name:'Other'}];c._meetApplyPl=k=>k;
  const seen=[];c._meetStatus=(key,act,tgt)=>{seen.push({key,tgt});return 'ok';};
  for(const name of ['_meetStatColor','_meetStatTint','_meetStatLabel','_meetDiffStr','_meetInputBlock','_meetSegExtra'])c[name]=()=>'';
  c._meetKpiTile=(sid,ym,key,act,tgt)=>{seen.push({key,tgt});return '';};
  c.qcCommitStatusCard=()=>'';c._budgetStore='ALL';c.bStoreChips=()=>'';c._meetYearMatrix=()=>'';c.meetMode='mid';c.meetMonthOffset=0;c.budgetMonthOffset=0;
  const k=c.keyKpiStats([store],c.daysOfYm(ym));
  for(const lang of ['ja','en']){c.lang=lang;
    for(const current of [false,true]){
      const expected=c.meetingBudgetKpi(k,current);
      for(const render of [()=>c._meetStoreSummary(store,k,ym,current),()=>c._meetStoreCard(store,k,ym,current)]){
        seen.length=0;assert.equal(typeof render(),'string');
        near(seen.find(v=>v.key==='sales').tgt,expected.budget);
        for(const [key,field] of [['guests','guestBudget'],['ppa','ppaBudget']])for(const v of seen.filter(v=>v.key===key))near(v.tgt,expected[field]);
      }
    }
    seen.length=0;assert.equal(typeof c.renderMeetingReview(),'string');
    const expected=c.meetingBudgetKpi(k,true);
    for(const v of seen.filter(v=>v.key==='guests'))near(v.tgt,expected.guestBudget);
  }
});
test('year matrix preserves revised zero/missing targets, historical seeds and explicit edits',()=>{
  const c=setup(), matrix=fn('_meetYearMatrix');
  // Execute the actual nested target resolver with a synthetic historical table.
  const start=matrix.indexOf('  function liveT('),end=matrix.indexOf('  function isEdited(',start);
  Object.assign(c,{store:{id:'TEST'},sid:'TEST',isB:false,edits:{},seed:Object.fromEntries(['sales','guests','ppa'].map(key=>[key,{t:Array(12).fill(999),a:Array(12).fill(888)}])),MEETING_KGI_SEED_UNTIL:'2026-06',liveA:()=>null});
  vm.runInContext(matrix.slice(start,end),c);
  c.budget.days=Object.fromEntries(c.daysOfYm('2026-09').map(d=>[d.date,0]));
  assert.equal(c.cellV('sales','t',9,0,'2026-09'),0);assert.equal(c.cellV('guests','t',9,0,'2026-09'),0);assert.equal(c.cellV('ppa','t',9,0,'2026-09'),null);
  assert.equal(c.cellV('sales','t',6,-3,'2026-06'),999);
  c.edits={TEST:{sales:{t9:123}}};assert.equal(c.cellV('sales','t',9,0,'2026-09'),123);
  c.edits={};c.budget={segments:{dinner:{sales:3000}}};assert.equal(c.cellV('ppa','t',9,0,'2026-09'),null);
});
