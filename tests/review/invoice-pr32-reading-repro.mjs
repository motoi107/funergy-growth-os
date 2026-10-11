// Codex independent review of PR #32, reviewed commit 2544826327a8f3112a00bb1739189ca42fbf9797.
// Synthetic data ONLY. Uses the committed test fixture with PGlite and fake Drive/AI/mail.
// Does not load production credentials or call production services.
// Synthetic reproductions for the reading changes. Assertions express required behavior.
// Run: npm --prefix tests/runtime ci --ignore-scripts --no-audit --no-fund
//      node --test tests/review/invoice-pr32-reading-repro.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the real integration-test fixture without executing its existing tests.
// Resolve every relative module/file URL against the fixture's original location.
const fixtureUrl = new URL('../invoice-intake.test.mjs', import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
const marker = "test('Drive invoice intake works end to end on synthetic data'";
const boundary = fixtureSource.indexOf(marker);
assert.ok(boundary > 0, 'integration fixture boundary changed; update this review harness');
const prefix = fixtureSource.slice(0, boundary).replace(/(['"])(\.\.?\/[^'"]+)\1/g,
  (_, quote, relative) => JSON.stringify(new URL(relative, fixtureUrl).href));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-pr32-review-'));
let fixture;
try {
  const filename = path.join(temporary, 'fixture.mjs');
  fs.writeFileSync(filename, prefix + '\nexport { setup, doc, pdf, docsOf, codes };\n');
  fixture = await import(pathToFileURL(filename).href);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
const { setup, doc, pdf, docsOf, codes } = fixture;


const baseLine=[['06263','SHIRO MISO 12/500G','2','60.00','120.00','CS','12/500G']];
async function stage(E,tag,ext){
 E.fixtures.set(tag,{readable:true,documents:[ext]});
 const id=E.drive.file(tag+'.pdf',pdf(tag),'U6');await E.worker();
 return {id,d:(await docsOf(E,id))[0]};
}
test('R1: editing only due date must not replace an unreadable printed invoice date',async()=>{
 const E=await setup();try{
  const ext=doc('DATE-UNREADABLE','2026-09-30',baseLine,{delivery:'2026-10-06'});
  ext.invoice_date_text='09/??/2026'; ext.invoice_date=null;
  let {id,d}=await stage(E,'DATE-UNREADABLE',ext);
  assert.ok(codes(d).includes('date_unreadable'));assert.equal(d.invoice_date,null);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{due_date:'2026-10-31'},reason:'due date only'});
  assert.equal(r.status,200);[d]=await docsOf(E,id);
  const post=await E.api('tok-office',{action:'post',doc_id:d.id,version:d.version,reason:'synthetic review'});
  console.log('R1',JSON.stringify({invoice_date:d.invoice_date,reasons:d.reasons,post}));
  assert.equal(d.invoice_date,null,'unreadable printed invoice date was silently replaced with delivery date');
  assert.notEqual(post.status,200,'unresolved invoice date became postable');
 }finally{await E.pg.close();}
});
test('R2: a price unit parsed from the number must survive an unrelated correction',async()=>{
 const E=await setup();try{
  const ext=doc('PRICE-UNIT','2026-10-06',baseLine);
  ext.lines[0].unit_price='$60.00/LB';ext.lines[0].price_unit=null;
  let {id,d}=await stage(E,'PRICE-UNIT',ext);
  assert.ok(codes(d).includes('catch_weight'));
  const [before]=await E.q('select price_unit, reasons from invoice_lines where doc_id=$1',[d.id]);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{due_date:'2026-10-31'},reason:'due date only'});
  assert.equal(r.status,200);[d]=await docsOf(E,id);
  const post=await E.api('tok-office',{action:'post',doc_id:d.id,version:d.version,reason:'synthetic review'});
  const prices=await E.q("select purchase_unit, price_per_purchase, price_per_base from invoice_price_history where doc_id=$1 and status='active'",[d.id]);
  console.log('R2',JSON.stringify({before,reasons:d.reasons,post,prices}));
  assert.ok(codes(d).includes('catch_weight'),'price unit was lost and catch-weight gate erased');
  assert.equal(prices.length,0,'per-LB price was registered as a per-CS price');
 }finally{await E.pg.close();}
});
test('R3: quantity suffix unit must participate in mapping resolution',async()=>{
 const E=await setup();try{
  const ext=doc('QTY-UNIT','2026-10-06',baseLine);
  ext.lines[0].qty='2 CS';ext.lines[0].unit=null;
  const {d}=await stage(E,'QTY-UNIT',ext);
  const [l]=await E.q('select purchase_unit,reasons from invoice_lines where doc_id=$1',[d.id]);
  console.log('R3',JSON.stringify(l));
  assert.equal(l.purchase_unit,'CS');
  assert.ok(!l.reasons.includes('unit_unverified'),'known parsed CS was not supplied to verified CS mapping');
 }finally{await E.pg.close();}
});
