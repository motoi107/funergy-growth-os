// Codex PR #32 re-review at 1301623. Real UI functions, synthetic state, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function source(name){
 const start=html.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));assert.ok(start>=0,name);
 const rest=html.slice(start);
 for(const match of rest.matchAll(/^}[^\n]*$/gm)){
  const candidate=rest.slice(0,match.index+match[0].length);
  try{new vm.Script(candidate);return candidate;}catch(e){if(!(e instanceof SyntaxError))throw e;}
 }
 throw Error('Cannot extract '+name);
}
function setup(){
 const stores=[{id:'F06',name:'Synthetic store',invoiceUploadFolderId:'abcdefghijklmnop'},{id:'F04',name:'Other store'}];
 const c={window:{_invoiceStore:'F06'},stores,STORES:stores,invoiceDocType:'Invoice',writes:0,notices:[],
  getStoresAll:()=>stores,t:(ja,en)=>ja,invInFileId:s=>/^[a-zA-Z0-9_-]{10,}$/.test(s||'')?s:'',
  showToast:(...args)=>c.notices.push(args),lsSet:()=>c.writes++,invInRerender:()=>{},
  invInCanAdmin:()=>true,_invIn:{config:{stores:[{store_id:'F06',upload_folder_id:'abcdefghijklmnop'}],settings:{mode:{}}}}};
 vm.createContext(c);
 for(const n of ['invInUsesDrive','invDocTypeButtons','_invSaveCore','invInPublishLink','renderInvoice'])vm.runInContext(source(n),c);
 return c;
}
test('v1055: published Drive store hides supplier type; unpublished store retains it',()=>{
 const c=setup();assert.equal(c.invInUsesDrive('F06'),true);assert.equal(c.invInUsesDrive('F04'),false);
 assert.ok(!c.invDocTypeButtons().includes("setInvDocType('Invoice')"));
 c.window._invoiceStore='F04';assert.ok(c.invDocTypeButtons().includes("setInvDocType('Invoice')"));
});
test('v1055: supplier invoice save is stopped before any write for a published store',async()=>{
 const c=setup();const r=await c._invSaveCore({docType:'Invoice',storeId:'F06'},false);
 assert.equal(r.stage,'drive_only');assert.equal(r.ok,false);assert.equal(c.writes,0);
});
test('v1055: publish requires admin, intake, mirror and start time',()=>{
 const c=setup();delete c.stores[0].invoiceUploadFolderId;
 c.invInPublishLink('F06',true,true);assert.equal(c.writes,0);
 c._invIn.config.settings.mode={intake:true,mirror:true,start_at:'2026-10-07T20:00:00Z'};
 c.invInCanAdmin=()=>false;c.invInPublishLink('F06',true,true);assert.equal(c.writes,0);
 c.invInCanAdmin=()=>true;c.invInPublishLink('F06',true,true);assert.equal(c.writes,1);assert.equal(c.invInUsesDrive('F06'),true);
 c.invInPublishLink('F06',false,true);assert.equal(c.invInUsesDrive('F06'),false);
});
test('v1055: receipts and invoice view keep separate records in both languages',()=>{
 const c=setup();Object.assign(c,{curRole:'office',ensureIngV2Backfill:()=>{},
 ls:()=>[{id:'receipt',docType:'Receipt',storeId:'F06'},{id:'invoice',docType:'Invoice',storeId:'F06'},{id:'legacy',storeId:'F06'}],
 invoiceStoreCandidates:()=>c.stores,invUnclassified:()=>[],invInStoreCardHtml:()=>'',invInHqBarHtml:()=>'',
 bulkBannerHtml:()=>'',checkReturnedCount:()=>0,invIsMine:()=>true,renderReimburseCard:()=>'',escapeHtml:s=>s,invCardHtml:r=>'RECORD:'+r.id});
 for(const english of [false,true]){
  c.t=(ja,en)=>english?en:ja;c.window._invMainView='list';let h=c.renderInvoice();
  assert.ok(h.includes('RECORD:receipt'));assert.ok(!h.includes('RECORD:invoice'));
  c.window._invMainView='invoices';h=c.renderInvoice();assert.ok(h.includes('RECORD:invoice'));assert.ok(h.includes('RECORD:legacy'));assert.ok(!h.includes('RECORD:receipt'));
 }
});
