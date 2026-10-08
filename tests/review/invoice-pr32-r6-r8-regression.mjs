// Codex independent review of 0a1daa78a5bd20ae864de0bf8ec387f6acd2f7a9, PR #32.
// Real handler/SQL/UI module; local PGlite and synthetic Drive/AI/mail only.
// Exercise the remaining boundaries around the fixes, without production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = new URL('../invoice-intake.test.mjs', import.meta.url);
const ui = new URL('../invoice-ui.test.mjs', import.meta.url);
async function prefixModule(url, boundary, names) {
  const src = fs.readFileSync(url, 'utf8');
  const end = src.indexOf(boundary);
  assert.ok(end > 0, 'fixture boundary changed');
  const code = (src.slice(0, end) + `\nexport { ${names} };`).replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_, quote, path) => JSON.stringify(new URL(path, url).href));
  return import('data:text/javascript,' + encodeURIComponent(code));
}
const { setup, doc, pdf, docsOf } = await prefixModule(fixture, "test('Drive invoice intake works end to end on synthetic data'", 'setup, doc, pdf, docsOf');
const { app } = await prefixModule(ui, 'const id = n =>', 'app');
const lines = [['06263', 'SHIRO MISO 12/500G', '1', '60.00', '60.00', 'CS', '12/500G']];
async function stage(E, tag, ext) {
  E.fixtures.set(tag, { readable: true, documents: [ext] });
  const file = E.drive.file(tag + '.pdf', pdf(tag), 'U6');
  await E.worker();
  return (await docsOf(E, file))[0];
}

test('R6 fix: a vendor stop after handler context is read survives alias learning, and a stale editor conflicts', async () => {
  const E = await setup();
  try {
    const d = await stage(E, 'R6-BEFORE-SQL', doc('R6-BOUNDARY', '2026-10-06', lines, { vendor: 'Kona Independent Review' }));
    const [before] = await E.q("select to_jsonb(v) j from invoice_vendor_rules v where vendor_key='v1'");
    const rpc = E.db.rpc.bind(E.db);
    let injected = false;
    E.db.rpc = async (name, p) => {
      if (name === 'invoice_edit' && !injected) {
        injected = true; // The handler has already read its context. Stop the vendor before the SQL edit begins.
        const stop = await E.api('tok-ceo', { action: 'vendor_save', vendor: {
          vendor_key: 'v1', auto_post: false, aliases: ['VENDOR A INC.', 'Saved during correction'],
        } });
        assert.equal(stop.status, 200, JSON.stringify(stop.body));
      }
      return rpc(name, p);
    };
    const edited = await E.api('tok-office', { action: 'edit', doc_id: d.id, version: d.version,
      header: { vendor_key: 'v1' }, reason: 'identify printed vendor' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.alias_learned, 'Kona Independent Review');
    const [v] = await E.q("select auto_post, aliases from invoice_vendor_rules where vendor_key='v1'");
    assert.deepEqual(v, { auto_post: false, aliases: ['VENDOR A INC.', 'Saved during correction', 'Kona Independent Review'] });
    const stale = await E.api('tok-gm', { action: 'vendor_save', vendor: { vendor_key: 'v1', aliases: before.j.aliases,
      auto_post: true, expect_updated_at: before.j.updated_at } });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    const next = await stage(E, 'R6-NEXT-STOPPED', doc('R6-NEXT', '2026-10-07', lines, { vendor: 'Kona Independent Review' }));
    assert.equal(next.vendor_key, 'v1'); assert.equal(next.status, 'review');
  } finally { await E.pg.close(); }
});

test('R7 fix: changing a posted total with an unreadable line amount requires a fresh acknowledgement', async () => {
  const E = await setup();
  try {
    const ext = doc('R7-POSTED', '2026-10-06', lines); ext.lines[0].amount = '6O.OO';
    const d = await stage(E, 'R7-POSTED-ACK', ext);
    const posted = await E.api('tok-office', { action: 'post', doc_id: d.id, version: d.version,
      reason: 'original total checked', ack: ['line_amount_missing'] });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const change = { action: 'edit', doc_id: d.id, version: posted.body.version,
      header: { subtotal_cents: 12000, total_cents: 12000 }, reason: 'correct the total' };
    const no = await E.api('tok-office', change);
    assert.equal(no.status, 409, JSON.stringify(no.body)); assert.equal(no.body.error, 'blocked:line_amount_missing');
    const [held] = await E.q('select total_cents, version from invoice_docs where id=$1', [d.id]);
    assert.deepEqual(held, { total_cents: 6000, version: posted.body.version });
    const ok = await E.api('tok-office', { ...change, ack: ['line_amount_missing'] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const [price] = await E.q("select count(*)::int n from invoice_price_history where doc_id=$1 and status='active'", [d.id]);
    assert.equal(price.n, 0);
  } finally { await E.pg.close(); }
});

test('R8 fix: a change after read-back is still rejected by the version on the final post', async () => {
  const E = await setup();
  try {
    await E.q('update invoice_stores set auto_post=false');
    const d = await stage(E, 'R8-AFTER-GET', doc('R8-BOUNDARY', '2026-10-06', lines));
    const G = (await E.api('tok-office', { action: 'get', doc_id: d.id })).body;
    let injected = false;
    const c = app({ api: async b => {
      const r = await E.api('tok-office', b);
      if (b.action === 'get' && !injected) {
        injected = true; // Return the saved version, but commit another correction before UI posts it.
        const other = await E.api('tok-gm', { action: 'edit', doc_id: d.id, version: r.body.doc.version,
          header: { subtotal_cents: 12000, total_cents: 12000 }, lines: [{ line_id: G.lines[0].id, set: { qty: '2', amount_cents: 12000 } }],
          reason: 'another reviewer changes amount after read-back' });
        assert.equal(other.status, 200, JSON.stringify(other.body));
      }
      return r.status === 200 ? r.body : { status: r.status, error: r.body.error };
    } });
    c.M._invIn.docId = d.id; c.M._invIn.doc = G;
    c.M._invIn.edits = { version: d.version, h: { invoice_no: 'R8-EDITED-NUMBER' }, l: {}, reason: '', ack: {} };
    await vm.runInContext('invInConfirm', c)();
    assert.deepEqual(c.calls.map(x => x.action), ['edit', 'get', 'post']);
    assert.equal(c.calls[2].version, d.version + 1, 'post uses the saved and read-back version');
    const [after] = await E.q('select status, total_cents, version from invoice_docs where id=$1', [d.id]);
    assert.deepEqual(after, { status: 'review', total_cents: 12000, version: d.version + 2 });
  } finally { await E.pg.close(); }
});
