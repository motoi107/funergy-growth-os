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
  assert.match(h, /業者がマスターにない → 業者を決める（統合か新しい業者）/);
  assert.match(h, /合計が明細＋税などと \$2\.00 合わない/);
  assert.match(h, /明細の金額が読めない → 原本の合計を確かめる/);
  assert.match(h, /明細が読めない（前の版の読み取り）→ 原本の合計を確かめる/);
  assert.doesNotMatch(h, /単価が前回から大きく変わった|商品マスターに対応がない|数量・単価が読めない/);
  assert.ok(h.includes('Printed &lt;b&gt;Co&lt;/b&gt;') && !h.includes('<b>Co</b>'));
  // v1059 (Moto 2026-10-09): 事務Crew does the Invoice intake work like accounting; someone without an invoice role does not.
  const crew = app({ role: 'office_crew' }); crew.M._invIn.review = { rows: rows(), total: 5 };
  assert.equal(vm.runInContext('invInQueueHtml', crew)('review'), h);
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows: rows(), total: 5 };
  assert.doesNotMatch(vm.runInContext('invInQueueHtml', other)('review'), /type="checkbox"|invInBatchAsk/);
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
  assert.deepEqual(crew.calls.map(b => [b.action, b.doc_id]), [['post', id(1)]]);     // 事務Crew posts like accounting (v1059)
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows: rows(), total: 5 };
  await vm.runInContext('invInBatchPost', other)();
  assert.equal(other.calls.length, 0);
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

// v1071 (Moto 2026-10-12): 「この内容で反映」→ the original's name in Drive becomes 日付_業者名_番号 → then QuickBooks.
const conf1071 = (mode = {}, qb = { to: 'qb@example.invalid', since: '2026-09-29', route: 'external', enabled: false }) =>
  ({ vendors: [], stores: [], maps: [], settings: { mode, rules: {}, qb, qb_external_enabled: false } });

test('v1071 settings: a GM or CEO turns renaming on after a confirmation; the QuickBooks start is a Hawaii time', async () => {
  const g = app({ role: 'gm' }); g.M._invIn.config = conf1071(); g.M._invIn.health = {};
  let h = vm.runInContext('invInSettings', g)();
  assert.match(h, /00_Upload の原本を月ごとのフォルダに整理する（年 \/ 月 \/ 未照合）/);
  // v1081 (UI案50 1A・3A・4A): moving reconciled originals is its own switch; until it is set it shows (and works) like filing.
  assert.match(h, /<input type="checkbox" onchange="invInSetting\('mode','organize_reconciled',this\.checked\)"> 照合したら原本を「照合済み \/ 年-月」フォルダへ移す/);
  assert.match(h, /店舗フォルダの直下や「○月 Uploaded」に置いた原本も移します/);
  const tick = cf => { const x = app({ role: 'gm' }); x.M._invIn.config = conf1071(cf); x.M._invIn.health = {};
    return /<input type="checkbox" checked onchange="invInSetting\('mode','organize_reconciled'/.test(vm.runInContext('invInSettings', x)()); };
  assert.deepEqual([tick({ organize: true }), tick({ organize: false }), tick({ organize: true, organize_reconciled: false }), tick({ organize: false, organize_reconciled: true })],
    [true, false, false, true], 'not set yet: shown like filing; once set: as set');
  assert.doesNotMatch(h, /業者_請求日_店舗_INV-番号/);
  assert.match(h, /反映したら原本のファイル名を変える/); assert.match(h, /2026-10-07_Marujuu-Produce_12345\.pdf/);
  assert.match(h, /反映して、名前を変えた原本だけ/);
  assert.match(h, /id="ivs-qbsince" style="max-width:220px" value="2026-09-29T00:00">/);       // a date (the earlier form) starts at 0:00
  vm.runInContext('invInSetting', g)('mode', 'rename', true);
  assert.equal(g.calls.length, 0, 'nothing is saved before the confirmation');
  assert.match(g.modals.at(-1), /ChatGPT 側の転送を「台帳を見て送る」に切り替えたのと同じ時/);
  assert.match(g.modals.at(-1), /invInSaveSetting\(\\?'mode\\?',\{rename:true\}\)/);
  await vm.runInContext('invInSaveSetting', g)('mode', { rename: true });
  assert.deepEqual(JSON.parse(JSON.stringify(g.calls.at(-1))), { action: 'settings_save', key: 'mode', value: { rename: true } });
  // When it was turned on (set by the server) is shown in Hawaii time; a moment as the start is shown as it was saved.
  g.M._invIn.config = conf1071({ rename: true, rename_since: '2026-10-12T21:30:05.123456+00:00' }, { since: '2026-10-13T09:00:00-10:00', route: 'external' });
  h = vm.runInContext('invInSettings', g)();
  assert.match(h, /ON にした時：2026-10-12 11:30（ハワイ）/);
  assert.match(h, /id="ivs-qbsince" style="max-width:220px" value="2026-10-13T09:00">/);
  // Saving the start sends the Hawaii time with its offset; an empty field sends nothing.
  const dom = { 'ivs-qbsince': { value: '2026-10-13T09:00' } };
  const s = app({ role: 'ceo', dom }); s.M._invIn.config = conf1071();
  await vm.runInContext('invInSaveQbSince', s)();
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [{ action: 'settings_save', key: 'qb', value: { since: '2026-10-13T09:00:00-10:00' } }]);
  dom['ivs-qbsince'].value = '';
  await vm.runInContext('invInSaveQbSince', s)();
  assert.equal(s.calls.length, 1); assert.equal(s.toasts.at(-1)[1], 'warning');
  // Accounting sees the settings but cannot turn renaming on.
  const o = app({ role: 'office' }); o.M._invIn.config = conf1071(); o.M._invIn.health = {};
  h = vm.runInContext('invInSettings', o)();
  assert.match(h, /id="ivs-qbsince" style="max-width:220px" value="2026-09-29T00:00" disabled>/); assert.doesNotMatch(h, /invInSaveQbSince\(\)/);
  vm.runInContext('invInSetting', o)('mode', 'rename', true);
  assert.equal(o.modals.length, 0); assert.equal(o.calls.length, 0);
});

test('v1071 posting tells the new file name, or that the rename is tried again before QuickBooks', async () => {
  const mk = rename => {
    const c = app({ api: b => (b.action === 'post' ? { ok: true, version: 2, file_id: 'f1', rename } : { ok: true }) });
    const d = DOC(); d.doc.vendor_key = 'v2'; d.doc.reasons = [{ code: 'mode_review_vendor' }];
    c.M._invIn.docId = id(2); c.M._invIn.doc = d; c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} }; return c;
  };
  let c = mk({ ok: true, name: '2026-10-06_Vendor-B_2001.pdf' });
  await vm.runInContext('invInPost', c)();
  assert.deepEqual(c.calls.map(b => b.action), ['post']);
  assert.deepEqual(c.toasts.at(-1), ['反映しました。ファイル名：2026-10-06_Vendor-B_2001.pdf', 'success']);
  c = mk({ ok: false, error: 'drive_update_500' });
  await vm.runInContext('invInPost', c)();
  assert.equal(c.toasts.at(-1)[1], 'warning'); assert.match(c.toasts.at(-1)[0], /ファイル名はまだ変えていません.*名前を変えてから QuickBooks へ送ります/);
  c = mk(null);
  await vm.runInContext('invInPost', c)();
  assert.deepEqual(c.toasts.at(-1), ['反映しました', 'success']);
  // Posting together counts the originals not renamed yet.
  const b = app({ api: x => ({ ok: true, rename: x.doc_id === id(1) ? { ok: false, error: 'drive_update_500' } : { ok: true, name: 'n.pdf' } }) });
  const rs = rows(); rs[4].reasons = [{ code: 'mode_review_vendor' }];
  b.M._invIn.review = { rows: rs, total: 5 };
  await vm.runInContext('invInBatchPost', b)();
  assert.match(b.toasts.at(-1)[0], /反映しました：2 件.*ファイル名をまだ変えていない：1 件/); assert.equal(b.toasts.at(-1)[1], 'warning');
});

test('v1071 one invoice: the original shows its file name and whether it was renamed', () => {
  const c = app(); c.M._invIn.config = { vendors: [], maps: [], stores: [], settings: { mode: { rename: true } } };
  const d = DOC(); d.file = { drive_file_id: 'abcDEF123', current_name: 'Scanned <Oct 7>.pdf', rename_state: 'none' };
  c.M._invIn.docId = id(2); c.M._invIn.doc = d; c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  let h = vm.runInContext('invInDetail', c)('review');
  assert.ok(h.includes('Scanned &lt;Oct 7&gt;.pdf') && !h.includes('<Oct 7>'));
  assert.match(h, /反映すると「日付_業者名_invoice番号」に名前を変えます/);
  assert.match(h, /原本の中身は変えません（変えるのはファイル名だけ）/); assert.doesNotMatch(h, /このアプリは原本を書き換えません/);
  d.doc.status = 'posted'; d.file = { ...d.file, current_name: '2026-10-06_Vendor-B_2001.pdf', rename_state: 'done' };
  h = vm.runInContext('invInDetail', c)('review');
  assert.match(h, /2026-10-06_Vendor-B_2001\.pdf/); assert.match(h, /反映して名前を変えました/);
  d.file = { ...d.file, rename_state: 'error', rename_error: 'outside_store_folders' };
  h = vm.runInContext('invInDetail', c)('review');
  assert.match(h, /ファイル名を変えられませんでした（名前を変えてから QuickBooks へ送ります）：原本が店舗のフォルダの外へ移されています/);
  // With renaming off, nothing is promised.
  c.M._invIn.config.settings.mode.rename = false; d.doc.status = 'review'; d.file = { ...d.file, rename_state: 'none' };
  h = vm.runInContext('invInDetail', c)('review');
  assert.doesNotMatch(h, /反映すると「日付_業者名_invoice番号」/);
});

test('v1071 status page: a failed rename is explained and can be retried; originals waiting for their name are counted', () => {
  const c = app();
  c.M._invIn.health = { stores: [], qb: { sent: 1 }, qb_settings: { to: 'qb@example.invalid', since: '2026-10-13T09:00:00-10:00', route: 'external', enabled: true }, rename_waiting: 2, drive: {} };
  c.M._invIn.problems = { files: [{ id: id(7), store_id: 'F06', current_name: 'a.pdf', drive_file_id: 'x1', intake_status: 'posted', organize_status: 'done', drive_state: 'ok',
    rename_state: 'error', rename_error: 'outside_store_folders' }], qb: [] };
  const h = vm.runInContext('invInHealth', c)();
  assert.match(h, /ファイル名を変えられませんでした（名前を変えてから QuickBooks へ送ります）：原本が店舗のフォルダの外へ移されています/);
  assert.ok(h.includes("invInRetry('" + id(7) + "')"));
  assert.match(h, /名前を変える待ち 2/);
  assert.match(h, /2026\/10\/13 09:00 より後に入った原本/);
  c.M._invIn.health.rename_waiting = 0;
  assert.doesNotMatch(vm.runInContext('invInHealth', c)(), /名前を変える待ち/);
});

// v1070 (Moto 2026-10-12「USD の表記がないものが取り込みできません。経理が USD の判定をできるように」).
const usdRow = (n, reasons, version = 3) => ({ id: id(n), version, status: 'review', doc_type: 'invoice', vendor_name: 'Vendor A', invoice_no: String(7000 + n), total_cents: 4200, store_id: 'F06',
  invoice_date: '2026-10-06', reasons });
test('review list: a row whose only check is the currency gets a "USD" button that saves USD with its version, then reloads', async () => {
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 4 } : { ok: true }) });
  const rs = [usdRow(11, [{ code: 'currency' }, { code: 'mode_review_store' }]), usdRow(12, [{ code: 'currency' }, { code: 'vendor_unknown' }]), usdRow(13, [{ code: 'mode_review_store' }])];
  c.M._invIn.review = { rows: rs, total: 3 };
  const h = vm.runInContext('invInQueueHtml', c)('review');
  assert.match(h, /通貨の印字なし・USD 以外 → USD なら「USD」を押す/);
  assert.equal((h.match(/invInUsdRow\(/g) || []).length, 1, 'only the currency-only row');
  assert.ok(h.includes("invInUsdRow(\\'" + id(11) + "\\')") || h.includes("invInUsdRow('" + id(11) + "')"));
  assert.match(h, /onclick="event\.stopPropagation\(\);invInUsdRow/);
  c.M._invIn.loaded.review = 1;
  await vm.runInContext('invInUsdRow', c)(id(11));
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [{ action: 'edit', doc_id: id(11), version: 3, header: { currency: 'USD' }, lines: [], reason: '経理の確認：通貨は USD', adjustment_ack: false, ack: [] }]);
  assert.equal(c.M._invIn.loaded.review, undefined, 'the list is read again (the row can now be posted together)');
  assert.equal(c.toasts.at(-1)[0], '通貨を USD にしました');
  // A row that is not in the list, or a person who cannot edit, sends nothing.
  await vm.runInContext('invInUsdRow', c)(id(99));
  assert.equal(c.calls.length, 1);
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows: rs, total: 3 };
  assert.doesNotMatch(vm.runInContext('invInQueueHtml', other)('review'), /invInUsdRow/);
  await vm.runInContext('invInUsdRow', other)(id(11));
  assert.equal(other.calls.length, 0);
  // A conflict (someone saved first) is shown and the list is read again.
  const busy = app({ api: () => ({ status: 409, error: 'conflict' }) }); busy.M._invIn.review = { rows: rs, total: 3 }; busy.M._invIn.loaded.review = 1;
  await vm.runInContext('invInUsdRow', busy)(id(11));
  assert.match(busy.toasts.at(-1)[0], /ほかの人が先に更新しました/); assert.equal(busy.M._invIn.loaded.review, undefined);
});

test('one invoice: "Confirm USD" on the amount row, then "post as shown" saves USD, re-reads and posts', async () => {
  const before = () => { const d = DOC(); d.doc.vendor_key = 'v2'; d.doc.vendor_name = 'Vendor B'; d.doc.currency = null; d.doc.reasons = [{ code: 'currency' }, { code: 'mode_review_store' }]; d.ai_doc = { vendor_name: 'Vendor B', currency: null }; return d; };
  const after = before(); after.doc.version = 2; after.doc.currency = 'USD'; after.doc.reasons = [{ code: 'mode_review_store' }];
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 2 } : b.action === 'get' ? after : { ok: true }) });
  c.M._invIn.config = { vendors: [{ vendor_key: 'v2', display_name: 'Vendor B' }], maps: [], stores: [] };
  c.M._invIn.docId = id(2); c.M._invIn.doc = before(); c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  let h = vm.runInContext('invInDetail', c)('review');
  assert.match(h, /通貨の読み：印字なし <button[^>]*onclick="invInSetUsd\(true\)">USD と確かめる<\/button>/);
  assert.match(h, /次は直してから反映します[^<]*通貨の印字なし/);
  // Posting without confirming sends nothing.
  await vm.runInContext('invInConfirm', c)();
  assert.equal(c.calls.length, 0);
  vm.runInContext('invInSetUsd', c)(true);
  h = vm.runInContext('invInDetail', c)('review');
  assert.match(h, /通貨は USD（「この内容で反映する」で保存して反映）/);
  assert.match(h, /通貨は USD と確かめた（反映するときに保存）/);
  assert.doesNotMatch(h.slice(h.indexOf('経理の確認（4 項目）')), /通貨の印字なし/);
  assert.doesNotMatch(h, /次は直してから反映します/);
  assert.doesNotMatch(h, /USD と確かめる/);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('invInCollectEdits', c)(c.M._invIn.doc.doc, []).header)), { currency: 'USD' });
  // Undo puts it back.
  vm.runInContext('invInSetUsd', c)(false);
  assert.match(vm.runInContext('invInDetail', c)('review'), /USD と確かめる/);
  vm.runInContext('invInSetUsd', c)(true);
  await vm.runInContext('invInConfirm', c)();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0].header)), { currency: 'USD' });
  assert.equal(c.calls[2].version, 2);
  // A currency the AI read as something else can be confirmed the same way; the read value is shown (escaped).
  const x = app(); const d = before(); d.ai_doc.currency = '<b>JPY</b>';
  x.M._invIn.docId = id(2); x.M._invIn.doc = d; x.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  const hx = vm.runInContext('invInDetail', x)('review');
  assert.ok(hx.includes('通貨の読み：&lt;b&gt;JPY&lt;/b&gt;') && !hx.includes('<b>JPY</b>'));
  // No currency reason: no button. Someone who cannot edit: no button.
  const y = app(); const dy = before(); dy.doc.reasons = [{ code: 'mode_review_store' }];
  y.M._invIn.docId = id(2); y.M._invIn.doc = dy; y.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  assert.doesNotMatch(vm.runInContext('invInDetail', y)('review'), /USD と確かめる|通貨の読み/);
  const z = app({ role: 'crew' }); z.M._invIn.docId = id(2); z.M._invIn.doc = before(); z.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  assert.doesNotMatch(vm.runInContext('invInDetail', z)('review'), /USD と確かめる/);
});
