// Run pure render/aggregation checks with synthetic records, without app startup or network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const source = html.slice(html.indexOf('/* Meeting preview:'), html.indexOf('function renderBudget() {'));
function extract(name){
  const start=html.indexOf('function '+name+'(');
  const end=html.indexOf('\nfunction ', start+1);
  return html.slice(start,end);
}
const stores=[{id:'s1',name:'Test store'}];
let records={}, plans=[], chosen={y:2026,m:9}, today='2026-09-16', reads=[], renders=0;
const ctx={console, isFinite, Date, Math, Number, String, Object,
  t:(ja,en)=>ja, budgetYM:()=>chosen, bizToday:()=>today,
  ymShift:(ym,n)=>{let [y,m]=ym.split('-').map(Number);let d=new Date(Date.UTC(y,m-1+n,1));return d.toISOString().slice(0,7);},
  daysOfYm:ym=>{let [y,m]=ym.split('-').map(Number);return Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>({date:ym+'-'+String(i+1).padStart(2,'0')}));},
  escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  getDailyActuals:()=>records, guestCountType:()=> 'guest',
  bizDowIdx:date=>new Date(date+'T00:00:00Z').getUTCDay(), KD_DOW:['月','火','水','木','金','土','日'],
  getTipLabor:()=>null, _laborHrs:e=>e.hours,
  getBudgets:()=>plans, budRationale:(b,ym)=>{reads.push(ym);return b&&b.months[ym];},
  budgetScopeStores:()=>stores, bStoreChips:()=>'', _budgetStore:'s1',
  keyKpiStats:()=>({sales:100,budget:200,guests:10,ppa:10,opDays:1,unit:'名',laborRate:20,fcRate:30,drinkScope:false}),
  _meetApplyPl:k=>k,cumulativeToToday:()=>({budToToday:70}),renderPage:()=>renders++,
  getEmployees:()=>[],storeMonthlyStaff:()=>[],empMonthlyOf:()=>0,empGradeNum:()=>1,laborForEmployee:()=>({total:0}),
  laborCoreForYm:(sid,ym,opts)=>({total:20,hourly:20,salary:0,leave:0,tax:0,ins:0,manual:0,sales:100,periodDays:opts?15:30,dim:30,byName:{}}),
  salesMixForScope:()=>({hasMenu:true,total:100,drink:30,alcohol:20,soft:10}), foodCostOf:()=>({purch:0,cost:0,invoice:0,buy:0,transfer:0,hasEnd:false,provisionalRate:0}),getFcMonthly:()=>({}),monthTransferNetYm:()=>({inAmt:0,outAmt:0}),
  isTotoyaStore:()=>false,isDrinkRateStore:()=>true,fcVendorMonth:()=>({rows:[],byName:{}}),initMixFor:()=>null,getKpiConfigFor:()=>({drinkCats:[],alcoholCats:[]}),activeRecipes:()=>[],recipeInStore:()=>true,
  drinkRatioTriSub:()=>'',drinkTrendSub:()=>'',repeatTrendSub:()=>'',fcVendorTriSub:()=>''
};
vm.createContext(ctx);
for(const name of ['kdAgg','kdDow','kdPickCount','kdPickSales','kdPickPpa']) vm.runInContext(extract(name),ctx);
vm.runInContext(source,ctx);
function run(s){return vm.runInContext(s,ctx);}
assert.equal(run('mpPeriod().review'),'2026-08');
assert.equal(run('mpPeriod().plan'),'2026-09');
chosen={y:2026,m:1};assert.equal(run('mpPeriod().review'),'2025-12');chosen={y:2026,m:9};
run("mpSelect('mode','mid')");assert.equal(run('mpPeriod().end'),15);
assert.equal(run("mpDays('2025-09',mpPeriod()).length"),15);
records={'2026-09-01':{actual:100,guests:1},'2026-09-02':{actual:100,guests:9},'2026-09-16':{actual:999,guests:99}};
assert.equal(run("mpDailyAgg({id:'s1'},'2026-09',mpPeriod(),'ppa').rate"),20,'Weighted check, not average of daily ratios');
assert.equal(run("mpDailyAgg({id:'s1'},'2026-09',mpPeriod(),'sales').a"),200,'Exclude incomplete current day');
assert.equal(run("mpDailyAgg({id:'s1'},'2025-09',mpPeriod(),'sales').per"),null,'Missing prior year stays null');
plans=[{storeId:'s1',months:{'2026-09':{basis:'<img src=x onerror=alert(1)>',focus:'September goal'},'2026-08':{focus:'Wrong month'}}}];
for(const mode of ['start','mid']){
  run("mpSelect('mode','"+mode+"')");
  for(const metric of ['sales','guests','ppa','labor','drink','repeat','food']){
    run("mpSelect('metric','"+metric+"')");const rendered=run('renderMeetingPreview()');
    assert.ok(rendered.includes('September goal'));
    assert.ok(!rendered.includes('Wrong month'));
    assert.ok(rendered.includes('&lt;img'));
    assert.ok(!rendered.includes('<img src=x'));
    assert.ok(!rendered.includes('NaN'));
  }
}
assert.ok(reads.every(ym=>ym==='2026-09'),'Plan always uses meeting month');
today='2026-09-01';assert.equal(run('mpPeriod().end'),0);assert.ok(run('renderMeetingPreview()').includes('対象期間のデータがありません'));
chosen={y:2026,m:11};assert.ok(run('mpPeriod().future'));assert.equal(run("mpDays('2026-11',mpPeriod()).length"),0);
ctx.t=(ja,en)=>en;assert.ok(run('renderMeetingPreview()').includes('Monthly plan'));
assert.ok(html.includes("if (budgetTab==='meeting') return html + renderMeetingReview()"),'Original meeting route preserved');
assert.ok(html.includes("if (budgetTab==='meeting-test' || budgetTab==='meeting-preview') return html + renderMeetingPreview()"));
assert.ok(!/\b(localStorage|fetch|setTipLabor|budSetRationale|lsSet)\b/.test(source),'Preview has no writes/network');
console.log('PASS: periods/year boundary, same-date comparison, weighted check, missing history, 14 mode/metric renders, plan ownership/escaping, first-day/future, English, original route and read-only boundary.');

// Detailed-board behavior: paired denominators, zeros, year boundaries and no collapsed KPI sections.
today='2026-09-16';chosen={y:2026,m:9};run("mpSelect('mode','mid')");
records={'2026-09-01':{actual:100,guests:1,firstTimeBowls:0,repeatBowls:1},'2026-09-02':{actual:100,guests:9},'2026-09-03':{actual:300},'2026-09-16':{actual:999,guests:99}};
assert.equal(run("mtSnapshot(stores[0],'2026-09',mpPeriod()).vals.ppa".replace('stores[0]',"{id:'s1'}")),20);
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.sales"),500);
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.first"),0);
assert.equal(run("mtSnapshot({id:'s1'},'2025-09',mpPeriod()).vals.sales"),null);
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.hours"),null);
assert.ok(!run("mtSpark([1,null,3],[])").includes('<line x1="8" y1="'),'No connecting line across missing periods');
ctx.guestCountType=()=> 'bowls';records={'2026-09-01':{actual:180,bowls:8,takeoutBowls:2,toLunchCount:1}};
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.guests"),10);
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.toCount"),1);
assert.equal(run("mtSnapshot({id:'s1'},'2026-09',mpPeriod()).vals.ppa"),18);
let cutoffs=[];ctx.laborCoreForYm=(sid,ym,opts)=>{cutoffs.push(opts&&opts.endBefore);return {total:0,byName:{}};};
today='2026-03-31';chosen={y:2026,m:3};run("mtSnapshot({id:'s1'},'2026-02',mpPeriod())");assert.equal(cutoffs.pop(),'2026-03-01');
ctx.initMixFor=()=>({'2026-03-02':{a:2,b:3,c:10},'2026-03-31':{a:999}});
ctx.activeRecipes=()=>[{toastGuid:'a',category:'Beer',price:5},{toastGuid:'b',category:'Soft',price:2},{toastGuid:'c',category:'Food',price:10}];ctx.getKpiConfigFor=()=>({drinkCats:['Beer','Soft'],alcoholCats:['Beer']});
const drink=run("mtDrinkWeekday({id:'s1'},mpPeriod())");assert.ok(drink.includes('Mon'));assert.ok(!drink.includes('月'));assert.ok(drink.includes('13.8%'));assert.ok(drink.includes('62.5%'));
for(const lang of ['ja','en']){ctx.t=(ja,en)=>lang==='ja'?ja:en;for(const mode of ['start','mid']){run("mpSelect('mode','"+mode+"')");const out=run('renderMeetingTest()');assert.ok(!out.includes('<details'));assert.ok(!/NaN|undefined/.test(out));assert.ok(out.includes('mt-table'));assert.ok(out.includes('mt-week-grid'));}}
ctx.budgetScopeStores=()=>[];assert.ok(run('renderMeetingTest()').includes('No data'));
ctx.budgetScopeStores=()=>[{id:'s1'},{id:'s2'}];assert.ok(run('renderMeetingTest()').includes('Select a store'));
console.log('PASS: paired PPA, zero vs missing, bowls vs orders, February cutoff, English drinks and ratios, 4 expanded renders, zero/multiple-store scope.');
