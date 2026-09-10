import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function setup(){
  const data={};
  const c={STORES:[...['F04-K','F04-P','F04-A'].map(id=>({id,name:id,brand:'Totoya'})),{id:'L',name:'Licensed',liquorLicense:true},{id:'N',name:'Other unlicensed',liquorLicense:false},{id:'U',name:'Unknown'}],
    ls:(key,fallback)=>data[key]??fallback,
    getCategories:()=>[{code:21000,cls:'liquor'},{code:1000,cls:'food'},{code:30000,cls:'beverage'},{code:40000,cls:'supply'}],
    getIngredients:()=>[{code:1,name:'Sake',cat:21000,vendor:'V',price:999},{code:2,name:'Tea',cat:30000},{code:3,name:'Supplies',cat:40000}],
    parseJaDate:s=>new Date(s),getStoreIngredients:()=>[1,2],getInvCounts:()=>({1:2,2:1}),invUnitValue:i=>i.code===1?10:5,
    _invVendorList:()=>['V'],className:cls=>cls,invHistInMonth:()=>true};
  vm.createContext(c);
  for(const name of ['storeLiquorLicense','storeCostClass','storeCostClassTotals','storeIngredientClass','catClass','ingClass','_invStoreIds','invoiceAcctData','getInvItems','invComputeTotals','invComputeMatrix','invStoreVendorData']){
    const start=src.indexOf('function '+name+'(');
    let end=src.indexOf('\nfunction ',start+1);
    // Include only the function, including one-line declarations.
    const nextClose=src.indexOf('\n}',start);
    const firstLine=src.slice(start,src.indexOf('\n',start));
    const text=firstLine.endsWith('}')?firstLine:src.slice(start,nextClose+2);
    assert.ok(start>=0,name);vm.runInContext(text,c);
  }
  return {c,data};
}
const invoice=(sid,amount=20)=>({date:'2026-09-01',storeId:sid,lines:[{code:1,name:'Sake',qty:2,newPrice:10,lineTotal:amount}]});
test('all three Totoya stores classify existing sake purchases as food without changing master or records',()=>{
  const {c,data}=setup();data.invoices=['F04-K','F04-P','F04-A'].map(sid=>invoice(sid));
  const before=JSON.stringify(data),r=c.invoiceAcctData(2026,8);
  assert.equal(r.clsTotals.food,60);assert.equal(r.clsTotals.liquor,0);
  for(const sid of ['F04-K','F04-P','F04-A']) assert.equal(r.matrix[sid].food,20);
  assert.equal(JSON.stringify(data),before);assert.equal(c.ingClass(c.getIngredients()[0]),'liquor');
});
test('any explicitly unlicensed store uses food; licensed and unknown stores preserve alcohol',()=>{
  const {c,data}=setup();data.invoices=['N','L','U'].map(s=>invoice(s));
  const r=c.invoiceAcctData(2026,8);assert.equal(r.matrix.N.food,20);assert.equal(r.matrix.L.liquor,20);assert.equal(r.matrix.U.liquor,20);
});
test('explicit license overrides Totoya default, new Totoya brand inherits default, unknown is not inferred from dining format',()=>{
  const {c}=setup();c.STORES[0].liquorLicense=true;
  assert.equal(c.storeCostClass('liquor','F04-K'),'liquor');
  assert.equal(c.storeLiquorLicense({id:'new',brand:'Totoya'}),false);
  assert.equal(c.storeLiquorLicense({id:'new',format:'dining'}),null);
  assert.equal(c.storeLiquorLicense({id:'F04-K',liquorLicense:null}),null);
});
test('beverages, supplies, refunds and invoice total remain unchanged',()=>{
  const {c,data}=setup();const v=invoice('F04-K',-20);v.lines.push({code:2,lineTotal:5},{code:3,lineTotal:9});data.invoices=[v];
  const r=c.invoiceAcctData(2026,8);assert.equal(r.grand,-6);assert.equal(r.clsTotals.food,-20);assert.equal(r.clsTotals.beverage,5);assert.equal(r.clsTotals.supply,9);
});
test('mixed-license shared receipts are classified after store allocation and name IDs resolve',()=>{
  const {c,data}=setup();const v=invoice('F04-K',30);v.splitStores=['F04-K','Licensed'];data.invoices=[v];
  const r=c.invoiceAcctData(2026,8);assert.equal(r.matrix['F04-K'].food,15);assert.equal(r.matrix.L.liquor,15);assert.equal(r.grand,30);
  assert.equal(r.details.reduce((n,l)=>n+l.qty,0),2);
});
test('inventory quantity, value and grand total remain intact while category moves to food',()=>{
  const {c,data}=setup();data['inv_F04-K']=[{code:1,count:7,last:4,received:3,par:10,daily:true}];
  const before=JSON.stringify(data);assert.equal(c.getInvItems('F04-K')[0].cls,'food');assert.equal(c.getInvItems('F04-K')[0].count,7);
  const t=c.invComputeTotals('F04-K');assert.equal(t.perClass.food,20);assert.equal(t.perClass.beverage,5);assert.equal(t.grand,25);
  assert.equal(c.invComputeMatrix('F04-K').totals.food,20);assert.equal(c.invComputeTotals('L').perClass.liquor,20);assert.equal(JSON.stringify(data),before);
});
test('historical inventory export reclassifies stored value, never reprices or mutates snapshot',()=>{
  const {c,data}=setup();data['inv_hist_F04-K']=[{date:'2026-09-01',lines:[{cls:'liquor',name:'Sake',vendor:'V',actual:2,unitVal:8,value:16}]}];
  const before=JSON.stringify(data);const r=c.invStoreVendorData('F04-K',2026,8);
  assert.equal(r.byClass.food.total,16);assert.equal(r.grand,16);assert.equal(JSON.stringify(data),before);
  const raw={food:5,liquor:16,beverage:4};const out=c.storeCostClassTotals(raw,'F04-K');assert.equal(out.food,21);assert.equal(out.beverage,4);assert.equal(raw.liquor,16);
});
