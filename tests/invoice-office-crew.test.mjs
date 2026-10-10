// App v1059: 事務Crew (office_crew) confirms and posts invoices under review (accounting's request, Moto 2026-10-09).
// Runs the real Invoice intake module from index.html in a VM with synthetic state. No network, no storage.
// The server (invoice-intake SQL, migration 20261009170000) applies the same limits; these tests cover the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office_crew', lang = 'ja', api = () => ({ ok: true }) } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], curLang: lang, curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Store A', color: '#777' }], getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => {}, acSetSub: () => {}, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: { access_token: 'tok', refresh_token: 'ref' }, botResetShared: () => {}, botTime: v => String(v || ''),
    window: {}, setTimeout: () => {}, document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await api(body);
      return r && r.status ? { ok: false, status: r.status, json: async () => ({ error: r.error }) } : { ok: true, status: 200, json: async () => r };
    },
  };
  vm.createContext(c);
  vm.runInContext(MOD + '\nthis.M = { _invIn };', c);
  return c;
}
const fn = (c, name) => vm.runInContext(name, c);
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ROWS = () => [
  { id: id(1), version: 2, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor A', invoice_no: '1001', total_cents: 6120, store_id: 'F06', invoice_date: '2026-10-05', reasons: [{ code: 'mode_review_store' }] },
  { id: id(2), version: 1, status: 'review', doc_type: 'invoice', vendor_raw: 'Printed Co', invoice_no: '2001', total_cents: 2000, store_id: 'F06', reasons: [{ code: 'vendor_unknown' }] },
];
const DOC = (over = {}) => ({ doc: { id: id(2), version: 1, status: 'review', doc_type: 'invoice', posting_kind: 'purchase', vendor_key: 'v2', vendor_name: 'Vendor B', invoice_no: '2001', store_id: 'F06',
  invoice_date: '2026-10-06', subtotal_cents: 2000, tax_cents: 0, total_cents: 2000, lines_sum_cents: 2000, reasons: [{ code: 'mode_review_vendor' }], ...over },
  file: {}, ai_doc: { vendor_name: 'Printed Co' }, lines: [{ id: id(9), line_no: 1, raw_name: 'ITEM', reasons: ['unmapped'] }], events: [] });
const open = (c, d) => {
  c.M._invIn.config = { vendors: [{ vendor_key: 'v2', display_name: 'Vendor B' }], maps: [], stores: [] };
  c.M._invIn.docId = d.doc.id; c.M._invIn.doc = d; c.M._invIn.edits = { version: d.doc.version, h: {}, l: {}, reason: '', ack: {} };
  return fn(c, 'invInDetail')('review');
};

test('review list: 事務Crew sees the checkboxes and posts the selected invoices together', async () => {
  const c = app();
  c.M._invIn.review = { rows: ROWS(), total: 2 };
  const h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /type="checkbox"/);
  assert.match(h, /選んだ 1 件を反映する/);
  assert.doesNotMatch(h, /閲覧のみ/);
  await fn(c, 'invInBatchPost')();
  assert.deepEqual(c.calls.map(b => [b.action, b.doc_id, b.version, b.adjustment_ack, b.supersedes]), [['post', id(1), 2, false, null]]);
  // Someone without an invoice role still sends nothing.
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows: ROWS(), total: 2 };
  await fn(other, 'invInBatchPost')();
  assert.equal(other.calls.length, 0);
});

test('one invoice under review: 事務Crew fixes the four items and presses "post as shown"', async () => {
  const after = DOC({ version: 2, invoice_no: '2001A' });
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 2 } : b.action === 'get' ? after : { ok: true }) });
  const h = open(c, DOC());
  assert.match(h, /この内容で反映する/);
  assert.match(h, /<input class="form-input ivx-in"/);                  // the four items can be corrected
  assert.match(h, /対象外にする/); assert.match(h, /重複にする/);
  assert.doesNotMatch(h, /閲覧のみ/);
  assert.doesNotMatch(h, /新しく対応を登録/);                            // a new product mapping stays with accounting
  c.M._invIn.edits.h.invoice_no = '2001A';
  await fn(c, 'invInConfirm')();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.equal(c.calls[0].adjustment_ack, false);
  assert.equal(c.calls[2].version, 2); assert.equal(c.calls[2].adjustment_ack, false); assert.equal(c.calls[2].supersedes, null);
  // The mapping form does not open for 事務Crew; accounting still sees the option.
  fn(c, 'invInMapModal')(id(9));
  assert.equal(c.modals.length, 0);
  assert.match(open(app({ role: 'office' }), DOC()), /新しく対応を登録/);
});

test('closed month: 事務Crew cannot post it as an adjustment; accounting still can', async () => {
  const d = () => DOC({ invoice_date: '2026-08-28', reasons: [{ code: 'closed_month' }] });
  const c = app();
  const h = open(c, d());
  assert.match(h, /締め済みの月の invoice です。経理の調整として反映するのは経理・GM・CEO です/);
  assert.doesNotMatch(h, /_invIn\.edits\.adj=this\.checked/);
  c.M._invIn.edits.adj = true;                                            // even if set some other way
  await fn(c, 'invInConfirm')();
  assert.equal(c.calls.length, 0);
  assert.match(c.toasts.map(x => x[0]).join(' '), /締め済みの月の invoice は経理・GM・CEO が反映します/);
  const en = app({ lang: 'en' });
  assert.match(open(en, d()), /Accounting, GM or CEO post it as an accounting adjustment \(office crew cannot\)/);
  const o = app({ role: 'office' });
  assert.match(open(o, d()), /_invIn\.edits\.adj=this\.checked/);
  o.M._invIn.edits.adj = true;
  await fn(o, 'invInConfirm')();
  assert.deepEqual(o.calls.map(b => [b.action, b.adjustment_ack]), [['post', true]]);
});

test('a corrected version: only accounting replaces the posted one; 事務Crew never sends a replacement', async () => {
  const old = id(7);
  const d = () => DOC({ reasons: [{ code: 'same_number_different', detail: old }] });
  const c = app();
  c.M._invIn.cand = { [old]: { vendor_name: 'Vendor B', invoice_no: '2001', total_cents: 1900, status: 'posted' } };
  const h = open(c, d());
  assert.doesNotMatch(h, /訂正版として置き換える/);
  assert.match(h, /これと重複/);                                          // marking it a duplicate is part of the review
  assert.match(h, /置き換えるのは経理・GM・CEO です/);
  c.M._invIn.edits.sup = old; c.M._invIn.edits.adj = true;               // even if set some other way
  await fn(c, 'invInPost')();
  assert.equal(c.calls[0].supersedes, null); assert.equal(c.calls[0].adjustment_ack, false);
  const o = app({ role: 'office' });
  o.M._invIn.cand = c.M._invIn.cand;
  assert.match(open(o, d()), /訂正版として置き換える/);
  o.M._invIn.edits.sup = old;
  await fn(o, 'invInPost')();
  assert.equal(o.calls[0].supersedes, old);
});

test('posted invoices and reconciliation stay with accounting, GM and CEO', () => {
  const c = app();
  const h = open(c, DOC({ status: 'posted' }));
  assert.doesNotMatch(h, /反映済みの訂正|修正を保存/);
  assert.doesNotMatch(h, /<input class="form-input ivx-in"/);
  const r = fn(c, 'invInReconActions')(DOC({ status: 'posted' }).doc);
  assert.match(r, /照合は経理・GM・CEO が行います/);
  assert.doesNotMatch(r, /invInReconcile/);
  const o = app({ role: 'office' });
  assert.match(open(o, DOC({ status: 'posted' })), /修正を保存/);
  assert.match(fn(o, 'invInReconActions')(DOC({ status: 'posted' }).doc), /invInReconcile\('reconciled'\)/);
});

test('settings stay with accounting, GM and CEO (no change in v1059)', () => {
  const c = app();
  assert.equal(fn(c, 'invInCanEdit')(), false);
  assert.equal(fn(c, 'invInCanAdmin')(), false);
  assert.equal(fn(c, 'invInCanReview')(), true);
  for (const role of ['ceo', 'gm', 'office']) assert.equal(fn(app({ role }), 'invInCanReview')(), true, role);
  for (const role of ['crew', 'am', 'store_manager']) assert.equal(fn(app({ role }), 'invInCanReview')(), false, role);
});
