// UI案36 (app v1056): accounting checks vendor, invoice number, amount and store only.
// Runs the real Invoice intake module from index.html in a VM with synthetic state. No network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { INFO_REASONS } from '../invoice/rules.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office', api = () => ({ ok: true }), dom = {} } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], curLang: 'ja', curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
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
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const BATCH = '経理の確認（業者・invoice番号・金額・店舗）';
const rows = () => [
  { id: id(1), version: 2, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor A', invoice_no: '1001', total_cents: 6120, store_id: 'F06', invoice_date: '2026-10-05',
    reasons: [{ code: 'mode_review_store' }, { code: 'unmapped', line_no: 2 }, { code: 'price_jump', line_no: 1 }, { code: 'line_qty_price_missing', line_no: 3 }] },
  { id: id(2), version: 1, status: 'review', doc_type: 'invoice', vendor_raw: 'Printed <b>Co</b>', invoice_no: '2001', total_cents: 2000, store_id: 'F06', reasons: [{ code: 'vendor_unknown' }] },
  { id: id(3), version: 4, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor B', invoice_no: '3001', total_cents: 5000, store_id: 'F06', reasons: [{ code: 'total_mismatch', detail: 'calc 4800 vs 5000' }] },
  { id: id(4), version: 1, status: 'review', doc_type: 'statement', vendor_name: 'Vendor A', total_cents: 9900, store_id: 'F06', reasons: [{ code: 'statement' }] },
  { id: id(5), version: 7, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor A', invoice_no: '1005', total_cents: 12566, store_id: 'F06', reasons: [{ code: 'mode_review_vendor' }, { code: 'line_amount_missing', line_no: 1 }] },
  // Read before 2026-10-07: line_value_missing then also meant an unreadable amount (Codex R7). It holds like line_amount_missing.
  { id: id(6), version: 3, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor A', invoice_no: '1006', total_cents: 6000, store_id: 'F06', reasons: [{ code: 'mode_review_store' }, { code: 'line_value_missing', line_no: 1 }] },
];

test('the screen sorts reasons exactly like the server', () => {
  const c = app();
  assert.deepEqual([...vm.runInContext('INVIN_INFO', c)], INFO_REASONS);
  const post = SQL.slice(SQL.indexOf('create function public.invoice_post('));
  const list = name => [...(new RegExp(name + " text\\[\\] := array\\[([^\\]]+)\\]").exec(post)[1].matchAll(/'([a-z_]+)'/g))].map(m => m[1]);
  assert.deepEqual([...vm.runInContext('INVIN_MUST_FIX', c)].sort(), list('must_fix').sort());
  assert.deepEqual([...vm.runInContext('INVIN_MAY_ACK', c)], list('may_ack'));
  assert.deepEqual(list('info'), INFO_REASONS);
});

test('review list: four items with marks; only invoices with nothing to check are pre-selected; products and prices are not shown', () => {
  const c = app();
  c.M._invIn.review = { rows: rows(), total: 6 };
  assert.deepEqual(rows().map(r => vm.runInContext('invInBatchable', c)(r)), [true, false, false, false, false, false]);
  assert.equal(vm.runInContext('invInMark4', c)(rows()[5], 'amount'), '!');
  const h = vm.runInContext('invInQueueHtml', c)('review');
  assert.match(h, /選んだ 1 件を反映する/);
  assert.match(h, /業者がマスターにない → 業者を選ぶ/);
  assert.match(h, /合計が明細＋税などと \$2\.00 合わない/);
  assert.match(h, /明細の金額が読めない → 原本の合計を確かめる/);
  assert.match(h, /明細が読めない（前の版の読み取り）→ 原本の合計を確かめる/);
  assert.doesNotMatch(h, /単価が前回から大きく変わった|商品マスターに対応がない|数量・単価が読めない/);
  assert.ok(h.includes('Printed &lt;b&gt;Co&lt;/b&gt;') && !h.includes('<b>Co</b>'));
  const crew = app({ role: 'office_crew' }); crew.M._invIn.review = { rows: rows(), total: 5 };
  assert.doesNotMatch(vm.runInContext('invInQueueHtml', crew)('review'), /type="checkbox"|invInBatchAsk/);
});

test('batch post: one request per selected invoice, with its version and the accounting reason; failures stay in review', async () => {
  const c = app({ api: b => (b.doc_id === id(1) ? { status: 409, error: 'conflict' } : { ok: true }) });
  const rs = rows(); rs[4].reasons = [{ code: 'mode_review_vendor' }];
  c.M._invIn.review = { rows: rs, total: 5 };
  await vm.runInContext('invInBatchPost', c)();
  assert.deepEqual(c.calls.map(b => [b.action, b.doc_id, b.version, b.reason, b.ack.length, b.adjustment_ack, b.supersedes]),
    [['post', id(1), 2, BATCH, 0, false, null], ['post', id(5), 7, BATCH, 0, false, null]]);
  assert.match(c.toasts[0][0], /反映しました：1 件.*反映できなかった：1 件/);
  const crew = app({ role: 'office_crew' }); crew.M._invIn.review = { rows: rows(), total: 5 };
  await vm.runInContext('invInBatchPost', crew)();
  assert.equal(crew.calls.length, 0);
});

const DOC = () => ({ doc: { id: id(2), version: 1, status: 'review', doc_type: 'invoice', posting_kind: 'purchase', vendor_key: null, vendor_raw: 'Printed Co', invoice_no: '2001', store_id: 'F06',
  invoice_date: '2026-10-06', subtotal_cents: 2000, tax_cents: 0, total_cents: 2000, lines_sum_cents: 2000, reasons: [{ code: 'vendor_unknown' }, { code: 'unmapped', line_no: 1 }] },
  file: {}, ai_doc: { vendor_name: 'Printed Co' }, lines: [{ id: id(9), line_no: 1, raw_name: 'ITEM <i>x</i>', reasons: ['unmapped'] }], events: [] });   // line reasons are a text array on the server

test('one invoice: four items, lines folded, "post as shown" saves, re-reads and posts', async () => {
  const after = DOC(); after.doc.version = 2; after.doc.vendor_key = 'v2'; after.doc.reasons = [{ code: 'unmapped', line_no: 1 }, { code: 'mode_review_vendor' }];
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 2, alias_learned: 'Printed Co' } : b.action === 'get' ? after : { ok: true }) });
  c.M._invIn.config = { vendors: [{ vendor_key: 'v2', display_name: 'Vendor B' }], maps: [], stores: [] };
  c.M._invIn.docId = id(2); c.M._invIn.doc = DOC(); c.M._invIn.edits = { version: 1, h: { vendor_key: 'v2' }, l: {}, reason: '', ack: {} };
  const h = vm.runInContext('invInDetail', c)('review');
  assert.match(h, /経理の確認（4 項目）/);
  assert.match(h, /<details ontoggle="_invIn\.linesOpen=this\.open">/);
  assert.ok(h.includes('ITEM &lt;i&gt;x&lt;/i&gt;') && !h.includes('<i>x</i>'));
  assert.match(h, /新商品 1/);
  assert.match(h, />商品マスターに対応がない（新商品）<\/div>/);
  await vm.runInContext('invInConfirm', c)();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.equal(c.calls[0].reason, '経理の確認で直した');
  assert.equal(c.calls[2].version, 2);
  assert.equal(c.calls[2].reason, BATCH);
});

test('one invoice: when someone changes it between the save and the read-back, nothing is posted (Codex R8)', async () => {
  const after = DOC(); after.doc.version = 3; after.doc.vendor_key = 'v2'; after.doc.total_cents = 12000; after.doc.reasons = [{ code: 'mode_review_vendor' }];
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 2 } : b.action === 'get' ? after : { ok: true }) });
  c.M._invIn.config = { vendors: [{ vendor_key: 'v2', display_name: 'Vendor B' }], maps: [], stores: [] };
  c.M._invIn.docId = id(2); c.M._invIn.doc = DOC(); c.M._invIn.edits = { version: 1, h: { vendor_key: 'v2' }, l: {}, reason: '', ack: {} };
  await vm.runInContext('invInConfirm', c)();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get']);
  assert.match(c.toasts.map(x => x[0]).join(' '), /ほかの人がこの invoice を直しました/);
  assert.equal(c.M._invIn.doc.doc.total_cents, 12000, 'the screen now shows the newer values');
});

test('one invoice: nothing is sent while a value must still be fixed or a difference is not acknowledged', async () => {
  const c = app();
  c.M._invIn.docId = id(2); c.M._invIn.doc = DOC(); c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  await vm.runInContext('invInConfirm', c)();
  assert.equal(c.calls.length, 0);
  const d = DOC(); d.doc.vendor_key = 'v2'; d.doc.reasons = [{ code: 'total_mismatch', detail: 'calc 1900 vs 2000' }];
  c.M._invIn.doc = d;
  await vm.runInContext('invInConfirm', c)();
  assert.equal(c.calls.length, 0);
  c.M._invIn.edits.ack.total_mismatch = true;
  await vm.runInContext('invInConfirm', c)();
  assert.deepEqual([...c.calls[0].ack], ['total_mismatch']);
  // An unreadable line amount (and the earlier code for it) also needs the tick.
  for (const code of ['line_amount_missing', 'line_value_missing']) {
    const x = app(); const dd = DOC(); dd.doc.vendor_key = 'v2'; dd.doc.reasons = [{ code, line_no: 1 }];
    x.M._invIn.docId = id(2); x.M._invIn.doc = dd; x.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
    await vm.runInContext('invInConfirm', x)();
    assert.equal(x.calls.length, 0, code);
    x.M._invIn.edits.ack[code] = true;
    await vm.runInContext('invInConfirm', x)();
    assert.deepEqual([...x.calls[0].ack], [code]);
  }
});

test('settings: only GM/CEO switch vendors and stores to auto, and the other saved values are kept', async () => {
  const conf = () => ({ vendors: [{ vendor_key: 'v2', display_name: 'Vendor B', aliases: ['VENDOR B', 'Printed Co'], food_kind: 'food', auto_post: false }],
    stores: [{ store_id: 'F06', label: 'StoreA', root_folder_id: 'rootFolder0001', upload_folder_id: 'uploadFolder01', active: true, auto_post: false, aliases: ['Store A'], address_group: 'g1', reviewer: 'R' },
      { store_id: 'F07', label: 'StoreB', active: false, auto_post: false, aliases: [] }], maps: [], settings: { mode: {}, rules: {}, qb: {} } });
  const g = app({ role: 'gm' }); g.M._invIn.config = conf();
  await vm.runInContext('invInVendorAuto', g)('v2', true);
  await vm.runInContext('invInStoreAutoAllDo', g)();
  // A switch sends only the switch: names, folders and the kind stay as the server has them now (nothing stale is written back).
  assert.deepEqual(JSON.parse(JSON.stringify(g.calls)), [
    { action: 'vendor_save', vendor: { vendor_key: 'v2', auto_post: true } },
    { action: 'store_save', store: { store_id: 'F06', auto_post: true } }]);
  const o = app({ role: 'office' }); o.M._invIn.config = conf();
  await vm.runInContext('invInVendorAuto', o)('v2', true);
  await vm.runInContext('invInVendorAutoAllDo', o)();
  await vm.runInContext('invInStoreAutoAllDo', o)();
  assert.equal(o.calls.length, 0);
  const dom = { 'ivst-label': { value: 'StoreA' }, 'ivst-root': { value: '' }, 'ivst-up': { value: '' }, 'ivst-al': { value: 'Store A' }, 'ivst-rv': { value: '' }, 'ivst-act': { checked: true }, 'ivst-auto': { checked: false } };
  const e = app({ role: 'gm', dom }); const ce = conf(); ce.stores[0].updated_at = '2026-10-07T20:00:00.123456+00:00'; e.M._invIn.config = ce;
  await vm.runInContext('invInStoreSave', e)('F06');
  assert.equal(e.calls[0].store.address_group, 'g1');
  assert.equal(e.calls[0].store.expect_updated_at, '2026-10-07T20:00:00.123456+00:00', 'a full edit says which version it read');
  const vdom = { 'ivv-name': { value: 'Vendor B' }, 'ivv-al': { value: 'VENDOR B' }, 'ivv-kind': { value: 'food' }, 'ivv-auto': { checked: false } };
  const vm2 = app({ role: 'gm', dom: vdom }); const cv = conf(); cv.vendors[0].updated_at = '2026-10-07T20:01:00+00:00'; vm2.M._invIn.config = cv;
  await vm.runInContext('invInVendorSave', vm2)('v2');
  assert.equal(vm2.calls[0].vendor.expect_updated_at, '2026-10-07T20:01:00+00:00');
});
