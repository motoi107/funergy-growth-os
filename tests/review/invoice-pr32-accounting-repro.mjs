// Codex independent review of 497a444ca2200c9b30b1b142e3104f3e6a6f3b1f (PR #32).
// Synthetic data only: local PGlite, real handler/SQL/UI module, fake Drive/AI/mail.
// No production credentials or services. Assertions express required safe behavior.
// R7 requires local git history containing 72cfcf8; git show is read-only and uses no network.
// Run: node --test tests/review/invoice-pr32-accounting-repro.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const fixtureUrl = new URL('../invoice-intake.test.mjs', import.meta.url);
const uiUrl = new URL('../invoice-ui.test.mjs', import.meta.url);
const legacy = '72cfcf8c8023eda9f930320430b0fa59373da508';
const show = p => execFileSync('git', ['show', `${legacy}:${p}`], { cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4e6 });
const moduleUrl = (source, base) => 'data:text/javascript,' + encodeURIComponent(source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
  (_, quote, relative) => JSON.stringify(new URL(relative, base).href)));
const fixtureSource = fs.readFileSync(fixtureUrl, 'utf8');
const boundary = fixtureSource.indexOf("test('Drive invoice intake works end to end on synthetic data'");
assert.ok(boundary > 0, 'fixture boundary changed');
const prefix = fixtureSource.slice(0, boundary);
const { setup, doc, pdf, docsOf, codes } = await import(moduleUrl(prefix + '\nexport { setup, doc, pdf, docsOf, codes };', fixtureUrl));
const uiSource = fs.readFileSync(uiUrl, 'utf8');
const uiBoundary = uiSource.indexOf('const id = n =>');
assert.ok(uiBoundary > 0, 'UI fixture boundary changed');
const { app } = await import(moduleUrl(uiSource.slice(0, uiBoundary) + '\nexport { app };', uiUrl));
const line = [['06263', 'SHIRO MISO 12/500G', '1', '60.00', '60.00', 'CS', '12/500G']];
async function stage(E, tag, ext) {
  E.fixtures.set(tag, { readable: true, documents: [ext] });
  const id = E.drive.file(tag + '.pdf', pdf(tag), 'U6');
  await E.worker();
  return { id, d: (await docsOf(E, id))[0] };
}

test('R6: learning an invoice vendor alias must preserve a concurrent stop and other saved aliases', async () => {
  const E = await setup();
  try {
    const { d } = await stage(E, 'ALIAS-RACE', doc('ALIAS-1', '2026-10-06', line, { vendor: 'New printed vendor' }));
    const rpc = E.db.rpc.bind(E.db);
    let injected = false;
    E.db.rpc = async (name, p) => {
      const r = await rpc(name, p);
      if (name === 'invoice_edit' && !injected) {
        injected = true;
        const stop = await E.api('tok-ceo', { action: 'vendor_save', vendor: {
          vendor_key: 'v1', display_name: 'VendorA', aliases: ['VENDOR A INC.', 'Concurrent saved alias'], food_kind: 'food', auto_post: false,
        } });
        assert.equal(stop.status, 200);
      }
      return r;
    };
    const r = await E.api('tok-gm', { action: 'edit', doc_id: d.id, version: d.version, header: { vendor_key: 'v1' }, reason: 'identify vendor only' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [v] = await E.q("select auto_post, aliases from invoice_vendor_rules where vendor_key='v1'");
    const next = await stage(E, 'ALIAS-NEXT', doc('ALIAS-2', '2026-10-07', line, { vendor: 'New printed vendor' }));
    console.log('R6', JSON.stringify({ vendor: v, nextStatus: next.d.status }));
    assert.deepEqual({ auto: v.auto_post, kept: v.aliases.includes('Concurrent saved alias'), next: next.d.status },
      { auto: false, kept: true, next: 'review' }, 'alias learning overwrote the newer vendor setting');
  } finally { await E.pg.close(); }
});

test('R7: upgrading a legacy unreadable line amount must not mark it safe for batch posting', async () => {
  // Run the actual previously reviewed rules/handler/SQL, then apply the new production migration.
  // Other imported modules are unchanged between the two commits.
  const rules = moduleUrl(show('invoice/rules.mjs'), new URL('invoice/rules.mjs', root));
  const handler = moduleUrl(show('supabase/functions/invoice-intake/handler.mjs').replace("'../../../invoice/rules.mjs'", JSON.stringify(rules)),
    new URL('supabase/functions/invoice-intake/handler.mjs', root));
  let oldPrefix = prefix.replace("'../supabase/functions/invoice-intake/handler.mjs'", JSON.stringify(handler));
  const sqlDeclaration = "const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');";
  assert.ok(oldPrefix.includes(sqlDeclaration));
  oldPrefix = oldPrefix.replace(sqlDeclaration, () => 'const SQL = ' + JSON.stringify(show('db/invoice-intake.sql')) + ';');
  const { setup: setupOld } = await import(moduleUrl(oldPrefix + '\nexport { setup };', fixtureUrl));
  const E = await setupOld();
  try {
    const ext = doc('LEGACY-1', '2026-10-06', line); ext.lines[0].amount = '6O.OO';
    const { d } = await stage(E, 'LEGACY-AMOUNT', ext);
    assert.equal(d.status, 'review'); assert.ok(codes(d).includes('line_value_missing'));
    const [l] = await E.q('select amount_cents from invoice_lines where doc_id=$1', [d.id]);
    assert.equal(l.amount_cents, null);
    await E.pg.exec('reset role');
    await E.pg.exec(fs.readFileSync(new URL('supabase/migrations/20261007200000_invoice_intake_accounting_checks.sql', root), 'utf8'));
    await E.pg.exec('set role service_role');
    const c = app({ api: async b => {
      const r = await E.api('tok-office', b);
      return r.status === 200 ? r.body : { status: r.status, error: r.body.error };
    } });
    c.M._invIn.review = { rows: [d], total: 1 };
    const batchable = vm.runInContext('invInBatchable', c)(d);
    const mark = vm.runInContext('invInMark4', c)(d, 'amount');
    await vm.runInContext('invInBatchPost', c)();
    const [after] = await E.q('select status from invoice_docs where id=$1', [d.id]);
    console.log('R7', JSON.stringify({ reasons: d.reasons, lineAmount: l.amount_cents, batchable, amountMark: mark, after }));
    assert.deepEqual({ batchable, status: after.status }, { batchable: false, status: 'review' },
      'legacy missing amount was treated as quantity/price-only information');
  } finally { await E.pg.close(); }
});

test('R8: save-then-post must stop if another reviewer changes the invoice before the read-back', async () => {
  const E = await setup();
  try {
    await E.q('update invoice_stores set auto_post=false');
    const { d } = await stage(E, 'CONFIRM-RACE', doc('CONFIRM-1', '2026-10-06', line));
    const G = (await E.api('tok-office', { action: 'get', doc_id: d.id })).body;
    let injected = false;
    const c = app({ api: async b => {
      const r = await E.api('tok-office', b);
      if (b.action === 'edit' && r.status === 200 && !injected) {
        injected = true;
        const other = await E.api('tok-gm', { action: 'edit', doc_id: d.id, version: r.body.version,
          header: { total_cents: 12000, subtotal_cents: 12000 }, lines: [{ line_id: G.lines[0].id, set: { qty: '2', amount_cents: 12000 } }], reason: 'a second reviewer changes the amount' });
        assert.equal(other.status, 200, JSON.stringify(other.body));
      }
      return r.status === 200 ? r.body : { status: r.status, error: r.body.error };
    } });
    c.M._invIn.docId = d.id; c.M._invIn.doc = G;
    c.M._invIn.edits = { version: d.version, h: { invoice_no: 'CONFIRMED-NUMBER' }, l: {}, reason: '', ack: {} };
    await vm.runInContext('invInConfirm', c)();
    const [after] = await E.q('select status, total_cents, version from invoice_docs where id=$1', [d.id]);
    console.log('R8', JSON.stringify({ reviewedTotal: d.total_cents, calls: c.calls.map(x => ({ action: x.action, version: x.version })), after }));
    assert.equal(after.status, 'review', 'the button posted another reviewer\'s unseen amount');
  } finally { await E.pg.close(); }
});
