// App v1059: 事務Crew (office_crew) does the Invoice intake work like accounting (Moto 2026-10-09: first "let 事務Crew
// post", then "事務Crew completes it on their own"). Settings, turning automatic posting on and the store screen stay with
// GM and CEO, as for accounting. Runs the real Invoice intake module from index.html in a VM with synthetic state.
// No network, no storage. The server (invoice-intake SQL, migration 20261009190000) applies the same roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office_crew', lang = 'ja', api = () => ({ ok: true }), dom = {} } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], curLang: lang, curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Store A', color: '#777' }], getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => {}, acSetSub: () => {}, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: { access_token: 'tok', refresh_token: 'ref' }, botResetShared: () => {}, botTime: v => String(v || ''),
    window: {}, setTimeout: () => {}, document: { getElementById: k => dom[k] || null, querySelectorAll: () => [] },
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
  invoice_date: '2026-10-06', subtotal_cents: 2000, tax_cents: 0, total_cents: 2000, lines_sum_cents: 2000, recon_status: 'unreconciled', reasons: [{ code: 'mode_review_vendor' }], ...over },
  file: {}, ai_doc: { vendor_name: 'Printed Co' }, lines: [{ id: id(9), line_no: 1, raw_name: 'ITEM', reasons: ['unmapped'] }], events: [] });
const CONF = () => ({ vendors: [{ vendor_key: 'v2', display_name: 'Vendor B', aliases: [], food_kind: 'food', auto_post: false }], maps: [],
  stores: [{ store_id: 'F06', label: 'StoreA', active: true, auto_post: false, aliases: [] }], settings: { mode: { intake: true }, rules: {}, qb: {} } });
const open = (c, d, mode = 'review') => {
  c.M._invIn.config = CONF();
  c.M._invIn.docId = d.doc.id; c.M._invIn.doc = d; c.M._invIn.edits = { version: d.doc.version, h: {}, l: {}, reason: '', ack: {} };
  return fn(c, 'invInDetail')(mode);
};

test('the same screen as accounting: 事務Crew may do everything accounting may in Invoice intake, nothing GM・CEO only', () => {
  for (const role of ['office', 'office_crew']) {
    const c = app({ role });
    assert.equal(fn(c, 'invInCanEdit')(), true, role);
    assert.equal(fn(c, 'invInCanAdmin')(), false, role);
  }
  for (const role of ['ceo', 'gm']) assert.equal(fn(app({ role }), 'invInCanAdmin')(), true, role);
  for (const role of ['crew', 'am', 'store_manager']) { const c = app({ role }); assert.equal(fn(c, 'invInCan')(), false, role); assert.equal(fn(c, 'invInCanEdit')(), false, role); }
  // The screens 事務Crew sees match accounting's (apart from nothing).
  for (const [mode, d] of [['review', DOC()], ['review', DOC({ status: 'posted' })], ['recon', DOC({ status: 'posted' })]]) {
    assert.equal(open(app(), d, mode), open(app({ role: 'office' }), d, mode), mode + ' ' + d.doc.status);
  }
  const q = r => { const c = app({ role: r }); c.M._invIn.review = { rows: ROWS(), total: 2 }; return fn(c, 'invInQueueHtml')('review'); };
  assert.equal(q('office_crew'), q('office'));
  assert.doesNotMatch(q('office_crew'), /閲覧のみ/);
});

test('review list: 事務Crew posts the selected invoices together', async () => {
  const c = app();
  c.M._invIn.review = { rows: ROWS(), total: 2 };
  assert.match(fn(c, 'invInQueueHtml')('review'), /選んだ 1 件を反映する/);
  await fn(c, 'invInBatchPost')();
  assert.deepEqual(c.calls.map(b => [b.action, b.doc_id, b.version]), [['post', id(1), 2]]);
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows: ROWS(), total: 2 };
  await fn(other, 'invInBatchPost')();
  assert.equal(other.calls.length, 0);
});

test('one invoice: 事務Crew fixes any value, registers a product and posts', async () => {
  const after = DOC({ version: 2, invoice_no: '2001A' });
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 2 } : b.action === 'get' ? after : { ok: true }) });
  const h = open(c, DOC());
  assert.match(h, /この内容で反映する/);
  assert.match(h, /新しく対応を登録/);
  assert.match(h, /oninput="invInSet\('l'/);                         // lines can be corrected too
  fn(c, 'invInMapModal')(id(9));
  assert.equal(c.modals.length, 1);
  c.M._invIn.edits.h.invoice_no = '2001A';
  await fn(c, 'invInConfirm')();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get', 'post']);
});

test('closed month and a corrected version: 事務Crew posts the adjustment and replaces the posted one', async () => {
  const c = app();
  const h = open(c, DOC({ invoice_date: '2026-08-28', reasons: [{ code: 'closed_month' }] }));
  assert.match(h, /_invIn\.edits\.adj=this\.checked/);
  c.M._invIn.edits.adj = true;
  await fn(c, 'invInConfirm')();
  assert.deepEqual(c.calls.map(b => [b.action, b.adjustment_ack]), [['post', true]]);
  const old = id(7);
  const r = app();
  r.M._invIn.cand = { [old]: { vendor_name: 'Vendor B', invoice_no: '2001', total_cents: 1900, status: 'posted' } };
  assert.match(open(r, DOC({ reasons: [{ code: 'same_number_different', detail: old }] })), /訂正版として置き換える/);
  r.M._invIn.edits.sup = old;
  await fn(r, 'invInPost')();
  assert.equal(r.calls[0].supersedes, old);
});

test('posted invoices, reconciliation, retries and unknown forwarding results: 事務Crew settles them', async () => {
  const c = app();
  assert.match(open(c, DOC({ status: 'posted' })), /修正を保存/);
  assert.match(fn(c, 'invInReconActions')(DOC({ status: 'posted' }).doc), /invInReconcile\('reconciled'\)/);
  await fn(c, 'invInRetry')(id(5));
  const q = app({ dom: { 'ivx-qb-note': { value: '送信済みフォルダで確認' } } });
  await fn(q, 'invInQbResolveDo')(id(6), 'sent');
  assert.deepEqual([...c.calls, ...q.calls].map(b => b.action), ['retry', 'qb_resolve']);
});

test('GM・CEO only, as for accounting: automatic posting and the operation switches', async () => {
  const c = app();
  c.M._invIn.config = CONF();
  await fn(c, 'invInVendorAuto')('v2', true);
  assert.equal(c.calls.length, 0);
  const g = app({ role: 'gm' }); g.M._invIn.config = CONF();
  await fn(g, 'invInVendorAuto')('v2', true);
  assert.deepEqual(g.calls.map(b => b.action), ['vendor_save']);
  c.M._invIn.health = { stores: [] };
  const s = fn(c, 'invInSettings')();
  assert.match(s, /onchange="invInSetting\('mode','intake',this\.checked\)"/);
  assert.ok(/disabled[^>]*onchange="invInSetting\('mode','intake'/.test(s), 'the operation switches are shown but cannot be changed');
  const en = app({ lang: 'en' }); en.M._invIn.review = { rows: ROWS(), total: 2 };
  assert.doesNotMatch(fn(en, 'invInQueueHtml')('review'), /view only/i);
});
