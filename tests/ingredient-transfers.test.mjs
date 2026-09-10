import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function context(){
  const c={rows:[],STORES:[{id:'A',name:'Alpha'},{id:'B',name:'Beta'},{id:'C',name:'Gamma'}],lang:'en',_itReportMonth:'',
    bizToday:()=> '2026-09-10',t:(ja,en)=>c.lang==='en'?en:ja,escapeHtml:s=>String(s).replace(/</g,'&lt;'),
    getIngTransfers:()=>c.rows,getVisibleStores:()=>c.visible,getIngredients:()=>[],curLang:'en',
    invStoreSheetRows:id=>c.inventory[id]||null,invStoreVendorData:id=>c.inventory[id]?{store:c.STORES.find(s=>s.id===id)}:null,
    downloadExcelSheets:(sheets,name)=>{c.output={sheets,name};},showToast:()=>{},renderPage:()=>{},inventory:{},_r2:n=>Math.round(n*100)/100};
  c.visible=c.STORES; vm.createContext(c);
  for(const name of ['itReportMonth','itSetReportMonth','itMonthlyReport','itReportSheets','itExportMonth','itMonthlySummaryHtml','renderIngTransfer','exportInventoryCSV','exportAllInventoryCSV','monthTransferNetYm']){
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
    assert.ok(start>=0 && end>start,name);vm.runInContext(source.slice(start,end+2),c);
  }
  return c;
}
const row=(from,to,amount,date='2026-09-01')=>({from,to,amount,date,name:'Rice',qty:2,unit:'bag',unitVal:amount/2,id:'test'});
test('monthly amount counts movements once and balances incoming/outgoing without changing records',()=>{
  const c=context();c.rows=[row('A','B',12.34),row('B','A',2.11),row('C','A',3,'2026-08-31'),row('A','B',9,'2026-10-01')];
  const before=JSON.stringify(c.rows),d=c.itMonthlyReport('2026-09',c.STORES);
  assert.equal(d.total,14.45);assert.equal(d.count,2);assert.equal(d.stores[0].net,-10.23);assert.equal(d.stores[1].net,10.23);
  assert.equal(d.stores.reduce((n,s)=>n+s.net,0),0);assert.equal(JSON.stringify(c.rows),before);
  assert.equal(Math.round(c.monthTransferNetYm('A','2026-09').net*100),-1023);
});
test('scope excludes unrelated stores but includes both directions and all monthly lines beyond 40',()=>{
  const c=context();c.visible=[c.STORES[0]];c.rows=Array.from({length:45},()=>row('A','B',0.1));c.rows.push(row('C','B',100));
  const d=c.itMonthlyReport('2026-09',c.visible);assert.equal(d.count,45);assert.equal(d.total,4.5);assert.equal(d.stores.length,1);
  const html=c.renderIngTransfer();assert.ok(html.includes('4.50'));assert.equal((html.match(/>Undo</g)||[]).length,45);assert.ok(!c.itMonthlySummaryHtml().includes('Gamma'));
});
test('uses recorded price, reports invalid values and zero months',()=>{
  const c=context();c.rows=[row('A','B',12.5),row('A','B',NaN)];c.rows[0].unitVal=999;
  const d=c.itMonthlyReport('2026-09',c.visible);assert.equal(d.total,12.5);assert.equal(d.invalid,1);
  assert.ok(c.itMonthlySummaryHtml().includes('Missing/invalid'));
  assert.equal(c.itMonthlyReport('2025-12',c.visible).total,0);
  assert.ok(JSON.stringify(c.itReportSheets('2025-12',c.visible)).includes('No transfers recorded'));
});
test('month selector preserves prior years and rejects malformed months',()=>{
  const c=context();assert.equal(c.itReportMonth(),'2026-09');c.itSetReportMonth('2025-12');assert.equal(c.itReportMonth(),'2025-12');
  c.itSetReportMonth('2026-13');assert.equal(c.itReportMonth(),'2025-12');
});
test('inventory export keeps inventory intact and appends summary and details for same month',()=>{
  const c=context();c.rows=[row('A','B',25)];c.inventory.A=[['Inventory',100]];
  c.exportInventoryCSV('A',2026,8);assert.equal(c.output.sheets.length,3);assert.equal(c.output.sheets[0].rows,c.inventory.A);
  assert.equal(c.output.sheets[1].rows[2][1],25);assert.equal(c.output.sheets[2].rows[2][8],25);
  assert.ok(c.output.name.includes('2026-09'));
});
test('all-store export includes stores with transfer-only records and does not double total',()=>{
  const c=context();c.rows=[row('A','B',25)];c.inventory.A=[['Inventory',100]];
  c.exportAllInventoryCSV(2026,8);assert.equal(c.output.sheets.length,5);
  assert.ok(JSON.stringify(c.output.sheets[1]).includes('Inventory not finalized'));
  assert.equal(c.output.sheets[3].rows[2][1],25);
});
test('transfer-only single-store output works; inaccessible store cannot be exported',()=>{
  const c=context();c.visible=[c.STORES[0]];c.rows=[row('A','B',25)];
  c.exportInventoryCSV('A',2026,8);assert.ok(JSON.stringify(c.output).includes('Inventory not finalized'));
  c.output=null;c.exportInventoryCSV('B',2026,8);assert.equal(c.output,null);
});
test('Japanese and English summaries and details use matching language',()=>{
  const c=context();c.lang='ja';assert.ok(c.itMonthlySummaryHtml().includes('受入額'));assert.equal(c.itReportSheets('2026-09',c.visible)[0].name,'食材移動集計');
  c.lang='en';assert.ok(c.itMonthlySummaryHtml().includes('Received'));assert.equal(c.itReportSheets('2026-09',c.visible)[0].name,'Transfer summary');
});
