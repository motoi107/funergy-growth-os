// Codex re-review of PR #32, head 1301623dabaee010b8452d07907e106f0485845f.
// Synthetic data ONLY. Uses the committed test fixture with PGlite and fake Drive/AI/mail.
// Does not load production credentials or call production services.
// These safety assertions FAIL on the reviewed head; C3 is only partially fixed.
// Run: npm --prefix tests/runtime ci --ignore-scripts --no-audit --no-fund
//      node --test tests/review/invoice-pr32-codex-rereview.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the real integration-test fixture without executing its existing tests.
// Resolve every relative module/file URL against the fixture's original location.
const fixtureUrl = new URL('../invoice-intake.test.mjs', import.meta.url);
let fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
// Exercise the real production upgrade path as well as the consolidated SQL.
// INVOICE_REVIEW_UPGRADE=1 node --test tests/review/invoice-pr32-codex-rereview.mjs
if (process.env.INVOICE_REVIEW_UPGRADE === '1') {
 const sqlLine = "const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');";
 assert.ok(fixtureSource.includes(sqlLine));
 fixtureSource = fixtureSource.replace(sqlLine,
  "const SQL = fs.readFileSync(new URL('../supabase/migrations/20261007090000_invoice_intake.sql', import.meta.url), 'utf8') + '\\n' + fs.readFileSync(new URL('../supabase/migrations/20261007160000_invoice_intake_review_fixes.sql', import.meta.url), 'utf8') + '\\n' + fs.readFileSync(new URL('../supabase/migrations/20261007200000_invoice_intake_accounting_checks.sql', import.meta.url), 'utf8');");
 // (Claude 2026-10-07, UI案36: production now also receives 20261007200000.)
}
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
const { setup: setupBase, doc, pdf, docsOf, codes } = fixture;
// Updated by Claude 2026-10-07 for UI案36 (Moto's decision: accounting checks only the vendor, the invoice number, the
// amount and the store). An invoice whose only reasons are about products now posts by itself, so this reproduction puts
// the store in review mode to keep invoices waiting for a person, as when it was written. Codex to confirm.
const setup = async (...a) => { const E = await setupBase(...a); await E.q('update invoice_stores set auto_post=false'); return E; };


const line=(price='60.00')=>[['06263','SHIRO MISO 12/500G','1',price,price,'CS','12/500G']];
async function intake(E,tag,no,date='2026-10-06',extra={}) {
 E.fixtures.set(tag,{readable:true,documents:[doc(no,date,line(),extra)]});
 const id=E.drive.file(tag+'.pdf',pdf(tag),'U6');
 await E.worker(); return {id,d:(await docsOf(E,id))[0]};
}
async function post(E,d){const r=await E.api('tok-gm',{action:'post',doc_id:d.id,version:d.version,reason:'synthetic original checked'});assert.equal(r.status,200);}


test('C3a: currency-only correction of a posted invoice must enforce must_fix',async()=>{
 const E=await setup();try{
  let {id,d}=await intake(E,'CURRENCY','CUR'); await post(E,d); await E.worker();
  [d]=await docsOf(E,id);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{currency:'JPY'},reason:'synthetic currency correction'});
  [d]=await docsOf(E,id);
  console.log('C3a',JSON.stringify({response:r,status:d.status,currency:d.currency,reasons:d.reasons}));
  assert.notEqual(r.status,200,'posted USD invoice accepted JPY despite currency must_fix');
 }finally{await E.pg.close();}
});

// C3b as written (a changed quantity mismatch needs a new acknowledgement) no longer applies: under UI案36 quantity ×
// price is for reference and never stops posting (Moto 2026-10-07). What stays required: the changed line never becomes
// price history, and an amount change on a posted invoice still needs the acknowledgement (total_mismatch). Codex to confirm.
test('C3b (UI案36): a changed line mismatch is for reference; an amount change still needs acknowledgement',async()=>{
 const E=await setup();try{
  E.fixtures.set('LINE-MISMATCH',{readable:true,documents:[doc('LM','2026-10-06',
    [['06263','SHIRO MISO 12/500G','2','60.00','60.00','CS','12/500G']])]});
  const id=E.drive.file('line.pdf',pdf('LINE-MISMATCH'),'U6'); await E.worker();
  let [d]=await docsOf(E,id);
  assert.ok(codes(d).includes('line_math'));
  const p=await E.api('tok-office',{action:'post',doc_id:d.id,version:d.version,reason:'checked original'});
  assert.equal(p.status,200); await E.worker(); [d]=await docsOf(E,id);
  const [l]=await E.q('select * from invoice_lines where doc_id=$1',[d.id]);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,lines:[{line_id:l.id,set:{qty:'200'}}],reason:'synthetic changed mismatch'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const prices=await E.q("select count(*)::int n from invoice_price_history where doc_id=$1 and status='active'",[d.id]);
  assert.equal(prices[0].n,0,'a line whose quantity × price does not match became price history');
  [d]=await docsOf(E,id);
  const t=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{total_cents:12001},reason:'synthetic total change'});
  console.log('C3b',JSON.stringify({line:r.status,total:t}));
  assert.notEqual(t.status,200,'an amount change on a posted invoice was saved without acknowledgement');
 }finally{await E.pg.close();}
});
