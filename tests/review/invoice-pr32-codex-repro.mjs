// Codex independent review of PR #32, reviewed commit 1851593bb4de597fa122d3abf77186be0230df00.
// Synthetic data ONLY. Uses the committed test fixture with PGlite and fake Drive/AI/mail.
// Does not load production credentials or call production services.
// These five safety assertions FAIL on the reviewed commit; they document C1-C5.
// Run: npm --prefix tests/runtime ci --ignore-scripts --no-audit --no-fund
//      node --test tests/review/invoice-pr32-codex-repro.mjs
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

const line=(price='60.00')=>[['06263','SHIRO MISO 12/500G','1',price,price,'CS','12/500G']];
async function intake(E,tag,no,date='2026-10-06',extra={}) {
 E.fixtures.set(tag,{readable:true,documents:[doc(no,date,line(),extra)]});
 const id=E.drive.file(tag+'.pdf',pdf(tag),'U6');
 await E.worker(); return {id,d:(await docsOf(E,id))[0]};
}
async function post(E,d){const r=await E.api('tok-gm',{action:'post',doc_id:d.id,version:d.version,reason:'synthetic original checked'});assert.equal(r.status,200);}

test('C1: an AI-failed rescan must not be forwarded without duplicate classification',async()=>{
 const E=await setup();try{
  await intake(E,'ORIGINAL-A','R1'); assert.equal(E.sent.length,1);
  E.drive.file('retaken.pdf',pdf('same invoice different image bytes'),'U6'); E.setAiDown('ai_network');
  await E.worker();
  console.log('C1',JSON.stringify({sent:E.sent.length,files:await E.q('select intake_status,last_error from invoice_files order by ingested_at')}));
  assert.equal(E.sent.length,1,'failed AI reading was sent to QB before duplicate checks');
 } finally {await E.pg.close();}
});

test('C2: editing due date must retain the legacy app duplicate candidate',async()=>{
 const E=await setup();try{
  E.fixtures.set('LEGACY',{readable:true,documents:[doc('R2','2026-10-07',[['06263','SHIRO MISO 12/500G','2','61.20','122.40','CS','12/500G']])]});
  const id=E.drive.file('legacy.pdf',pdf('LEGACY'),'U6');await E.worker();
  let [d]=await docsOf(E,id);assert.ok(codes(d).includes('app_duplicate_candidate'));assert.equal(E.sent.length,0);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{due_date:'2026-10-31'},reason:'correct due date only'});assert.equal(r.status,200);
  await E.worker();[d]=await docsOf(E,id);
  console.log('C2',JSON.stringify({reasons:codes(d),sent:E.sent.length}));
  assert.ok(codes(d).includes('app_duplicate_candidate'),'editing erased app dedupe gate and caused forwarding');
 } finally {await E.pg.close();}
});

test('C4: cached destination folders moved outside store must not receive originals',async()=>{
 const E=await setup();try{
  await intake(E,'FOLDER-FIRST','R3-A');
  const [year]=await E.q("select id from invoice_folders where store_id='F06' and role='year'");
  E.drive.folder('OUTSIDE','Outside','ROOT');E.drive.items.get(year.id).parents=['OUTSIDE'];
  const {id}=await intake(E,'FOLDER-SECOND','R3-B');
  console.log('C4',JSON.stringify({path:E.drive.pathOf(id),moves:E.drive.log.filter(x=>x[0]==='update'&&x[1]===id)}));
  assert.ok(!E.drive.pathOf(id).includes('Outside'),'worker moved original to cached destination outside configured store');
 } finally {await E.pg.close();}
});

test('C3: posted financial edits with mismatched totals require acknowledgement before mirror',async()=>{
 const E=await setup();try{
  let {id,d}=await intake(E,'POSTED-EDIT','R4');await post(E,d);await E.worker();[d]=await docsOf(E,id);
  const r=await E.api('tok-office',{action:'edit',doc_id:d.id,version:d.version,header:{total_cents:1},reason:'mistyped total, no math acknowledgement'});
  await E.worker();[d]=await docsOf(E,id);
  const [{value}]=await E.q("select value from app_state where key='spl_invoices_F06'");const mirrored=value.find(x=>x.intakeDocId===d.id);
  console.log('C3',JSON.stringify({status:r.status,docStatus:d.status,reasons:codes(d),mirroredTotal:mirrored?.total}));
  assert.notEqual(mirrored?.total,.01,'invalid edit remained posted and replaced live app copy without total_mismatch acknowledgement');
 } finally {await E.pg.close();}
});

test('C5: a changed original must not auto-post alongside its already posted version',async()=>{
 const E=await setup();try{
  let {id,d}=await intake(E,'VERSION-ORIGINAL','R6-OLD','2026-10-02');await post(E,d);
  E.fixtures.set('VERSION-NEW',{readable:true,documents:[doc('R6-NEW','2026-10-06',line())]});
  E.drive.replaceContent(id,pdf('VERSION-NEW'));
  await E.q("update invoice_files set drive_checked_at=now()-interval '7 hours'");
  await E.worker();await E.worker();
  const rows=await docsOf(E,id);
  console.log('C5',JSON.stringify(rows.map(x=>({no:x.invoice_no,status:x.status,posted:x.posted_mode,reasons:codes(x)}))));
  assert.equal(rows.filter(x=>x.status==='posted').length,1,'new original bytes auto-posted without explicit supersede');
 } finally {await E.pg.close();}
});
