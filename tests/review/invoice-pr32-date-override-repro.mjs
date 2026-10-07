// Codex independent review of PR #32, reviewed commit 362b6747cdb1605bf84179ce26f7a33024ed157b.
// Synthetic data ONLY. Uses the committed test fixture with PGlite and fake Drive/AI/mail.
// Does not load production credentials or call production services.
// Synthetic reproductions for the reading changes. Assertions express required behavior.
// Run: npm --prefix tests/runtime ci --ignore-scripts --no-audit --no-fund
//      node --test tests/review/invoice-pr32-date-override-repro.mjs
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
const { setup, doc, pdf, docsOf } = fixture;


const baseLine=[['06263','SHIRO MISO 12/500G','2','60.00','120.00','CS','12/500G']];
async function stage(E,tag,ext){
 E.fixtures.set(tag,{readable:true,documents:[ext]});
 const id=E.drive.file(tag+'.pdf',pdf(tag),'U6');await E.worker();
 return {id,d:(await docsOf(E,id))[0]};
}
test('R4: a manually confirmed invoice date must not follow a later delivery date correction',async()=>{
 const E=await setup();try{
  let {id,d}=await stage(E,'MANUAL-INVOICE-DATE',doc('MID',null,baseLine,{delivery:'2026-10-06'}));
  async function edit(header,reason){
   const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header,reason});
   assert.equal(r.status,200,JSON.stringify(r.body));[d]=await docsOf(E,id);
  }
  // A real change, entered by a person after checking another document.
  await edit({invoice_date:'2026-09-30'},'invoice date confirmed from supporting document');
  // The dates happen to coincide after this delivery-date correction.
  await edit({delivery_date:'2026-09-30'},'delivery date corrected');
  const [before]=await E.q('select invoice_date::text i, delivery_date::text v, overrides from invoice_docs where id=$1',[d.id]);
  assert.equal(before.i,'2026-09-30');assert.equal(before.overrides.invoice_date.reason,'invoice date confirmed from supporting document');
  const p=await E.api('tok-office',{action:'post',doc_id:d.id,version:d.version,reason:'confirmed invoice date'});
  assert.equal(p.status,200,JSON.stringify(p.body));[d]=await docsOf(E,id);await E.worker();
  const [initialApp]=await E.q("select value from app_state where key='spl_invoices_F06'");
  assert.equal(initialApp.value.find(x=>x.intakeDocId===d.id)?.docDate,'2026/09/30');
  await edit({delivery_date:'2026-10-01'},'delivery date only; invoice date unchanged');
  await E.worker();
  const [after]=await E.q('select invoice_date::text i, delivery_date::text v, status, overrides from invoice_docs where id=$1',[d.id]);
  const [app]=await E.q("select value from app_state where key='spl_invoices_F06'");
  const mirror=app.value.find(x=>x.intakeDocId===d.id);
  const actual={invoiceDate:after.i,deliveryDate:after.v,status:after.status,mirrorDate:mirror?.docDate};
  console.log('R4',JSON.stringify({beforeInvoiceDate:before.i,beforeDeliveryDate:before.v,actual}));
  assert.deepEqual(actual,{invoiceDate:'2026-09-30',deliveryDate:'2026-10-01',status:'posted',mirrorDate:'2026/09/30'},
    'delivery-only correction overwrote the human-confirmed invoice date across months');
 }finally{await E.pg.close();}
});
