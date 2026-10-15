// v1079 (Moto 2026-10-14, accounting's requests, UI案50 stage 1): the review list is read in full and sorted on the screen,
// a person can move an invoice to another store (server reassign), and a packing list with amounts can be treated as an invoice.
// Runs the real Invoice intake module from index.html in a VM with synthetic state. No network, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normInvoiceNo } from '../invoice/dedupe.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office', api = () => ({ ok: true }), store = null } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], curLang: 'ja', curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, getIngredients: () => [],
    STORES: [{ id: 'S1', name: 'Alpha', color: '#777' }, { id: 'S2', name: 'Bravo', color: '#888' }, { id: 'S3', name: 'Charlie', color: '#999' }, { id: 'S4', name: 'Delta', color: '#aaa' }],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => {}, acSetSub: () => {}, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: { access_token: 'tok', refresh_token: 'ref' }, botResetShared: () => {}, botTime: v => 'T' + String(v || ''),
    window: {}, setTimeout: () => {}, document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await api(body);
      return r && r.status ? { ok: false, status: r.status, json: async () => ({ error: r.error }) } : { ok: true, status: 200, json: async () => r };
    },
  };
  if (store) c.localStorage = store;
  vm.createContext(c);
  vm.runInContext(MOD + '\nthis.M = { _invIn };', c);
  return c;
}
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fn = (c, name) => vm.runInContext(name, c);
const order = (c) => [...fn(c, 'invInPageRows')().all].map(r => r.id);
const has = (o, k, d) => (k in o ? o[k] : d);   // an explicit null stays null (missing value)
const row = (n, o = {}) => ({ id: id(n), version: 1, status: 'review', doc_type: 'invoice', vendor_key: 'v' + (o.v || 'a'), vendor_name: 'Vendor ' + (o.v || 'a').toUpperCase(),
  invoice_no: String(has(o, 'no', 1000 + n)), total_cents: has(o, 'amt', 1000 * n), store_id: o.store || 'S1', invoice_date: has(o, 'date', '2026-10-0' + ((n % 9) + 1)),
  ingested_at: has(o, 'recv', `2026-10-10T0${n % 10}:00:00Z`), reasons: o.reasons || [{ code: 'mode_review_store' }], drive_file_id: 'drivefile' + String(n).padStart(4, '0') });

test('the review list reads every row in pages of 200 and counts a row that moved between pages once', async () => {
  const all = Array.from({ length: 450 }, (_, i) => row(i + 1));
  let n = 0;
  const c = app({ api: b => {
    if (b.action !== 'list') return { ok: true };
    const res = { rows: all.slice(b.offset, b.offset + b.limit), total: all.length };
    // A new invoice arrives after the first page (newest first): the second page starts with the last row of the first again.
    if (++n === 1) all.unshift(row(999));
    return res;
  } });
  await fn(c, 'invInLoadQueue')('review');
  // The count changed between pages, so the list is read once more from the start.
  assert.deepEqual(c.calls.map(b => [b.action, b.status, b.limit, b.offset]), [0, 200, 400, 0, 200, 400].map(o => ['list', 'review', 200, o]));
  assert.equal(c.M._invIn.review.rows.length, 451);
  assert.equal(new Set([...c.M._invIn.review.rows].map(r => r.id)).size, 451, 'every row once, the new one too');
  assert.deepEqual([c.M._invIn.review.total, c.M._invIn.review.moved], [451, false]);
  assert.doesNotMatch(fn(c, 'invInQueueHtml')('review'), /読み込むあいだに一覧が変わ/);
  // Rows with the same sort values can come back in another order on the next page: a row seen twice is counted once.
  const same = Array.from({ length: 450 }, (_, i) => row(i + 1));
  const tie = app({ api: b => ({ rows: b.offset ? same.slice(b.offset - 1, b.offset - 1 + b.limit) : same.slice(0, b.limit), total: 450 }) });
  await fn(tie, 'invInLoadQueue')('review');
  assert.equal(tie.calls.length, 3);
  assert.equal(tie.M._invIn.review.rows.length, 450);
  // A list that keeps changing (someone posting between every page) is read twice, then the person is told to refresh.
  let k = 0;
  const busy = app({ api: b => ({ rows: Array.from({ length: Math.min(b.limit, 300 - b.offset) }, (_, i) => row(b.offset + i + 1)), total: 300 + (k++) }) });
  await fn(busy, 'invInLoadQueue')('review');
  assert.equal(busy.calls.length, 6, 'two readings, then it stops');
  assert.equal(busy.M._invIn.review.moved, true);
  assert.match(fn(busy, 'invInQueueHtml')('review'), /読み込むあいだに一覧が変わ/);
  // Rows posted elsewhere while reading: every row was read, but one may be missing, so the person is told too.
  let k2 = 0; const fixed = Array.from({ length: 300 }, (_, i) => row(i + 1));
  const gone = app({ api: b => ({ rows: fixed.slice(b.offset, b.offset + b.limit), total: 300 - (k2++) }) });
  await fn(gone, 'invInLoadQueue')('review');
  assert.deepEqual([gone.M._invIn.review.rows.length, gone.M._invIn.review.total, gone.M._invIn.review.moved], [300, 300, true]);
  assert.match(fn(gone, 'invInQueueHtml')('review'), /読み込むあいだに一覧が変わりました。抜けている行があるかもしれないので/);
  // It stops at 2,000 rows and says how many more there are.
  const big = app({ api: b => ({ rows: Array.from({ length: b.limit }, (_, i) => row(b.offset + i + 1)), total: 2300 }) });
  await fn(big, 'invInLoadQueue')('review');
  assert.equal(big.calls.length, 10);
  assert.equal(big.M._invIn.review.rows.length, 2000);
  assert.match(fn(big, 'invInQueueHtml')('review'), /ほかに 300 件あります（読み込むのは 2,000 件まで/);
  // An empty page ends the reading even when the total says more.
  const short = app({ api: b => ({ rows: b.offset ? [] : [row(1)], total: 5 }) });
  await fn(short, 'invInLoadQueue')('review');
  assert.equal(short.calls.length, 2);
  // The reconciliation list is read as before.
  const rc = app({ api: b => ({ rows: [], total: 0 }) });
  await fn(rc, 'invInLoadQueue')('recon');
  assert.deepEqual(rc.calls.map(b => [b.status || null, b.recon, b.limit, b.offset ?? null]), [['posted', 'unreconciled', 100, null], [null, 'discrepancy', 100, null]]);
});

test('the invoice number is compared in the same form as the server, numbers as numbers', () => {
  const c = app();
  for (const s of ['INV-55021', 'inv # 55021', 'Invoice: 0012', '#77410', 'ＩＮＶ１２３', 'CM-9', 'no. 5 5', '', null, 'NUMBER 7']) assert.equal(fn(c, 'invInNoKey')(s), normInvoiceNo(s) || '', String(s));
  const cmp = fn(c, 'invInNatCmp');
  const sorted = ['INV-10', 'INV-9', 'A2', 'A10', '010', '9', 'B'].sort(cmp);
  assert.deepEqual(sorted, ['9', '010', 'A2', 'A10', 'B', 'INV-9', 'INV-10']);
  assert.equal(cmp('0012', '12') !== 0, true, 'leading zeros: same number, still a fixed order');
  assert.deepEqual(['11', '010'].sort(cmp), ['010', '11'], 'leading zeros do not make a number larger');
});

test('sort: vendor → invoice no. by default, every choice, column headers, empty values last, remembered on this device', () => {
  const mem = {}; const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const c = app({ store });
  c.M._invIn.review = { total: 7, rows: [
    row(1, { v: 'b', no: 'INV-10', amt: 500, store: 'S2', date: '2026-10-03', recv: '2026-10-09T01:00:00Z' }),
    row(2, { v: 'a', no: 'INV-9', amt: 900, store: 'S1', date: '2026-10-05', recv: '2026-10-09T03:00:00Z', reasons: [{ code: 'vendor_kind_unset' }] }),
    row(3, { v: 'a', no: 'INV-10', amt: null, store: 'S3', date: null, recv: '2026-10-09T02:00:00Z', reasons: [{ code: 'total_missing' }] }),
    row(4, { v: 'b', no: 'INV-10', amt: 100, store: 'S1', date: '2026-10-01', recv: null, reasons: [{ code: 'same_number_different', detail: id(1) }] }),
    { ...row(5, { v: 'c', no: '', amt: 300, store: 'S2', date: '2026-10-02', recv: '2026-10-09T05:00:00Z' }), vendor_key: null, vendor_name: null, vendor_raw: null },
    row(6, { v: 'c', no: '77', amt: 700, store: 'S4', date: '2026-10-04', recv: '2026-10-09T04:00:00Z', reasons: [{ code: 'store_mismatch', detail: 'S2' }] }),
    row(7, { v: 'a', no: '', amt: 200, store: 'S1', date: '2026-10-02', recv: '2026-10-09T06:00:00Z' }),
  ] };
  // Default: vendor, then the number as a number; no number and no vendor go last.
  assert.deepEqual(order(c), [id(2), id(3), id(7), id(1), id(4), id(6), id(5)]);
  const pick = n => { fn(c, 'invInRSortPick')(String(n)); return order(c); };
  assert.deepEqual(pick(1), [id(2), id(6), id(1), id(7), id(5), id(4), id(3)], 'invoice date, newest first; same date by vendor (unknown vendor last); no date last');
  assert.deepEqual(pick(2), [id(4), id(7), id(5), id(1), id(6), id(2), id(3)], 'invoice date, oldest first; no date still last');
  assert.deepEqual(pick(3), [id(7), id(5), id(6), id(2), id(3), id(1), id(4)], 'received, newest first; unknown last');
  assert.deepEqual(pick(4), [id(3), id(4), id(6), id(2), id(7), id(1), id(5)], 'red first (must fix / does not match), then yellow, then nothing to check');
  assert.deepEqual(pick(5), [id(2), id(7), id(4), id(1), id(5), id(3), id(6)], 'store name, then vendor and number');
  assert.deepEqual(pick(6), [id(2), id(6), id(1), id(5), id(7), id(4), id(3)], 'amount, largest first; no amount last');
  assert.deepEqual(pick(7), [id(4), id(7), id(5), id(1), id(6), id(2), id(3)], 'amount, smallest first; no amount still last');
  assert.equal(mem._invin_rsort, JSON.stringify({ k: 'amount', d: 1 }));
  // A column header sorts by it; pressing it again reverses.
  fn(c, 'invInRSortHead')('no');
  assert.deepEqual(order(c), [id(2), id(3), id(1), id(4), id(6), id(7), id(5)], 'number ascending (as numbers), then vendor; no number last');
  let h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /aria-sort="ascending"><button type="button" class="ivx-sort on"[^>]*onclick="invInRSortHead\('no'\)"[^>]*>invoice番号 <span aria-hidden="true">▲/);
  assert.match(h, /<option value="" selected>invoice番号（昇順）<\/option>/, 'a header sort that is not in the list is shown in the select');
  fn(c, 'invInRSortHead')('no');
  assert.equal(order(c)[0], id(6));
  fn(c, 'invInRSortHead')('recv');
  assert.deepEqual(JSON.parse(JSON.stringify(c.M._invIn.rsort)), { k: 'recv', d: -1 }, 'dates and amounts start newest/largest first');
  // A fresh screen on the same device remembers the last choice; an unreadable value falls back to vendor.
  const again = app({ store });
  assert.deepEqual(JSON.parse(JSON.stringify(fn(again, 'invInRSort')())), { k: 'recv', d: -1 });
  mem._invin_rsort = '{"k":"__proto__","d":1}';
  assert.deepEqual(JSON.parse(JSON.stringify(fn(app({ store }), 'invInRSort')())), { k: 'vendor', d: 1 });
  mem._invin_rsort = 'not json';
  assert.deepEqual(JSON.parse(JSON.stringify(fn(app({ store }), 'invInRSort')())), { k: 'vendor', d: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(fn(app(), 'invInRSort')())), { k: 'vendor', d: 1 }, 'no storage at all (private window): vendor');
  // Ties: the invoice date (newest first) comes before the received time; stores sort by their name, not their code.
  const tie = app();
  tie.STORES = [{ id: 'S1', name: 'Zulu', color: '#777' }, { id: 'S2', name: 'Alpha', color: '#888' }];
  tie.M._invIn.review = { total: 3, rows: [row(21, { v: 'a', no: '5', date: '2026-10-01', recv: '2026-10-09T09:00:00Z', store: 'S1' }),
    row(22, { v: 'a', no: '5', date: '2026-10-08', recv: '2026-10-09T01:00:00Z', store: 'S1' }), row(23, { v: 'a', no: '6', store: 'S2' })] };
  assert.deepEqual(order(tie), [id(22), id(21), id(23)]);
  fn(tie, 'invInRSortPick')('5');
  assert.deepEqual(order(tie), [id(23), id(22), id(21)]);
  // Same numbers get a heading when sorted by vendor or number.
  fn(c, 'invInRSortPick')('0');
  h = fn(c, 'invInQueueHtml')('review');
  assert.equal((h.match(/同じ番号 2 件：/g) || []).length, 1);
  assert.match(h, /同じ番号 2 件：Vendor B · INV-10<\/b>/);
  fn(c, 'invInRSortPick')('6');
  assert.doesNotMatch(fn(c, 'invInQueueHtml')('review'), /同じ番号 \d+ 件/);
  // The received time has its own column; the store mismatch names the printed store and offers "Choose store".
  fn(c, 'invInRSortPick')('0');
  h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /T2026-10-09T05:00:00Z/);
  assert.match(h, /宛先は Bravo → 店舗を確かめる（違えば「店舗を選ぶ」）/);
  assert.equal((h.match(/invInStorePick\(/g) || []).length, 1);
  // English.
  c.curLang = 'en';
  h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /<option value="0" selected>Vendor → invoice no\. \(same numbers together\)<\/option>/);
  assert.match(h, /Addressed to Bravo → check the store/);
  assert.match(h, />Choose store</);
});

test('pages of 100: ticks are kept by id across sorting and pages; "select all" and posting only touch the page in view', async () => {
  const rows = Array.from({ length: 230 }, (_, i) => row(i + 1, { v: 'a', no: String(i + 1), reasons: (i + 1) % 10 === 0 ? [{ code: 'vendor_unknown' }] : [{ code: 'mode_review_store' }] }));
  const c = app({ api: b => (b.action === 'list' ? { rows: [], total: 0 } : { ok: true }) });
  c.M._invIn.review = { rows, total: 230 };
  let h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /230 件中 1–100/);
  assert.match(h, /選んだ 90 件を反映する/);
  assert.match(h, /次の 100 件 ›/);
  assert.match(h, /<button class="btn btn-secondary btn-sm" disabled onclick="invInRPage\(-1\)">/);
  // Untick one on page 1, untick all on page 2: page 1 keeps 89, page 3 is untouched.
  fn(c, 'invInSel')(id(1), false);
  fn(c, 'invInRPage')(1);
  fn(c, 'invInSelAll')(false);
  assert.match(fn(c, 'invInQueueHtml')('review'), /選んだ 0 件を反映する/);
  fn(c, 'invInRPage')(1);
  h = fn(c, 'invInQueueHtml')('review');
  assert.match(h, /230 件中 201–230/);
  assert.match(h, /選んだ 27 件を反映する/);
  assert.match(h, /<button class="btn btn-secondary btn-sm" disabled onclick="invInRPage\(1\)">次へ ›/);
  fn(c, 'invInRPage')(5);
  assert.equal(fn(c, 'invInPageRows')().page, 2, 'pages are clamped');
  // Sorting goes back to the first page; the ticks stay.
  fn(c, 'invInRSortHead')('no');
  assert.equal(c.M._invIn.rpage, 0);
  fn(c, 'invInRSortHead')('no');
  fn(c, 'invInRSortHead')('no');
  assert.match(fn(c, 'invInQueueHtml')('review'), /選んだ 89 件を反映する/);
  // Posting sends only the ticked rows of page 1, in the order shown (the question says so first).
  fn(c, 'invInBatchAsk')();
  assert.match(c.modals.at(-1), /<b>89 件<\/b>・合計 /);
  await fn(c, 'invInBatchPost')();
  const posted = c.calls.filter(b => b.action === 'post').map(b => b.doc_id);
  const page1 = rows.slice(0, 100).filter(r => r.id !== id(1) && Number(r.invoice_no) % 10 !== 0).map(r => r.id);
  assert.deepEqual(posted, page1);
  // "Select all" on page 1 ticks only page 1.
  const d = app(); d.M._invIn.review = { rows, total: 230 };
  fn(d, 'invInSelAll')(false); fn(d, 'invInRPage')(1); fn(d, 'invInSelAll')(false); fn(d, 'invInRPage')(-1); fn(d, 'invInSelAll')(true);
  const ticked = rs => rs.filter(r => fn(d, 'invInSelected')(r)).length;
  assert.deepEqual([ticked(rows.slice(0, 100)), ticked(rows.slice(100, 200)), ticked(rows.slice(200))], [90, 0, 27]);
  // While posting, sorting and paging are locked.
  d.M._invIn.batching = { done: 0, total: 1 };
  fn(d, 'invInRSortHead')('amount'); fn(d, 'invInRPage')(1);
  assert.deepEqual([d.M._invIn.rsort.k, d.M._invIn.rpage], ['vendor', 0]);
  assert.match(fn(d, 'invInQueueHtml')('review'), /<select id="ivx-rsort" class="form-select ivx-in" style="max-width:300px;min-width:0" disabled/);
  // Signing out forgets the ticks and the page (the sort stays: it is this device's choice).
  d.M._invIn.batching = null; fn(d, 'invInRPage')(1);
  fn(d, 'invInReset')();
  assert.deepEqual([Object.keys(d.M._invIn.unsel).length, d.M._invIn.rpage, d.M._invIn.review], [0, 0, null]);
});

const DOC = (o = {}) => ({ doc: { id: id(2), file_id: id(50), version: 3, status: 'review', doc_type: 'invoice', posting_kind: 'purchase', vendor_key: 'va', vendor_name: 'Vendor A',
  invoice_no: '77410', store_id: 'S1', invoice_date: '2026-10-10', total_cents: 96875, subtotal_cents: 96875, lines_sum_cents: 96875, ship_to_raw: 'TOTOYA <b>B</b>',
  reasons: [{ code: 'store_mismatch', detail: 'S2' }, { code: 'mode_review_store' }], ...o }, file: { ingested_at: '2026-10-13T19:12:00Z' }, ai_doc: { vendor_name: 'Vendor A', ship_to: 'TOTOYA <b>B</b>', doc_type: o.doc_type || 'invoice' }, lines: [], events: [] });
const CONFIG = { vendors: [{ vendor_key: 'va', display_name: 'Vendor A' }], maps: [], stores: [{ store_id: 'S1', label: 'Alpha', active: true }, { store_id: 'S2', label: 'Bravo', active: true }, { store_id: 'S3', label: 'Charlie', active: false }, { store_id: 'S4', label: 'Delta', active: true }] };
const open = (c, doc) => { c.M._invIn.config = CONFIG; c.M._invIn.docId = doc.doc.id; c.M._invIn.doc = doc; c.M._invIn.edits = { version: doc.doc.version, h: {}, l: {}, reason: '', ack: {} }; };

test('one invoice: the store panel offers the printed store first, needs a reason, and moves the file with the server reassign', async () => {
  const c = app({ api: b => (b.action === 'reassign' ? { ok: true, summary: true } : { ok: true }) });
  open(c, DOC());
  c.M._invIn.loaded.review = 1; c.M._invIn.loaded.doc = 1;
  let h = fn(c, 'invInDetail')('review');
  assert.match(h, /店舗を選ぶ<\/div>/);
  assert.match(h, /今の店舗（アップロード先）<\/span><b>Alpha<\/b>/);
  assert.ok(h.includes('TOTOYA &lt;b&gt;B&lt;/b&gt; → 設定の Bravo と一致') && !h.includes('<b>B</b>'));
  const opts = [...h.matchAll(/<option value="(S\d)"( selected)?>([^<]*)<\/option>/g)].map(m => [m[1], !!m[2], m[3]]);
  assert.deepEqual(opts, [['S2', true, 'Bravo（宛先から）'], ['S1', false, 'Alpha（今の店舗・アップロード先）'], ['S4', false, 'Delta']], 'inactive stores are not offered');
  assert.match(h, /宛先は Bravo → 店舗を確かめる/);
  // No reason: nothing is sent.
  await fn(c, 'invInReassign')();
  assert.equal(c.calls.length, 0);
  assert.match(c.toasts.at(-1)[0], /理由を入力してください/);
  // Choosing the current store: nothing is sent, the button is off.
  fn(c, 'invInSet')('e', 'storeWhy', null, 'Addressed to Bravo');
  fn(c, 'invInSet')('e', 'storeTo', null, 'S1');
  assert.match(fn(c, 'invInDetail')('review'), /<button class="btn btn-primary btn-sm" disabled onclick="invInReassign\(\)">/);
  await fn(c, 'invInReassign')();
  assert.equal(c.calls.length, 0);
  // An inactive store cannot be sent even if set by hand.
  fn(c, 'invInSet')('e', 'storeTo', null, 'S3');
  await fn(c, 'invInReassign')();
  assert.equal(c.calls.length, 0);
  fn(c, 'invInSet')('e', 'storeTo', null, 'S2');
  await fn(c, 'invInReassign')();
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [{ action: 'reassign', file_id: id(50), store_id: 'S2', reason: 'Addressed to Bravo' }]);
  assert.match(c.toasts.at(-1)[0], /店舗を Bravo にしました。数分で取り込み直します/);
  assert.equal(c.M._invIn.docId, null);
  assert.equal(c.M._invIn.loaded.review, undefined, 'the list is read again');
});

test('one invoice: unsaved corrections are not carried over, so changing the store asks first; refusals keep the screen', async () => {
  const c = app({ api: b => (b.action === 'reassign' ? { status: 409, error: 'posted_use_correction' } : { ok: true }) });
  open(c, DOC());
  c.M._invIn.edits.h.invoice_no = '77411';
  fn(c, 'invInSet')('e', 'storeWhy', null, 'wrong folder');
  await fn(c, 'invInReassign')();
  assert.equal(c.calls.length, 0);
  assert.match(c.modals.at(-1), /直した値（まだ保存していないもの）は、新しい店舗の分には引き継ぎません/);
  assert.match(c.modals.at(-1), /invInReassign\(true\)/);
  await fn(c, 'invInReassign')(true);
  assert.equal(c.calls.length, 1);
  assert.match(c.toasts.at(-1)[0], /このファイルの書類はもう反映済みのため、店舗を変えられません/);
  assert.equal(c.M._invIn.docId, id(2), 'a refusal keeps the invoice open');
  // A store that matches: no panel, a small "Change store" button opens it.
  const ok = app(); open(ok, DOC({ reasons: [{ code: 'mode_review_store' }] }));
  let h = fn(ok, 'invInDetail')('review');
  assert.doesNotMatch(h, /店舗を選ぶ<\/div>/);
  assert.match(h, /onclick="_invIn\.storeOpen=&quot;00000000-0000-4000-8000-000000000002&quot;;invInRerender\(\)">店舗を変える<\/button>/);
  ok.M._invIn.storeOpen = id(2);
  h = fn(ok, 'invInDetail')('review');
  assert.match(h, /店舗を選ぶ<\/div>/);
  assert.match(h, /<option value="" selected>選ぶ<\/option>/, 'no printed store: nothing is chosen for the person');
  // The list button opens the invoice with the panel.
  ok.M._invIn.storeOpen = null;
  fn(ok, 'invInStorePick')(id(2));
  assert.deepEqual([ok.M._invIn.docId, ok.M._invIn.storeOpen, ok.M._invIn.docSub], [id(2), id(2), 'dreview']);
  fn(ok, 'invInBack')();
  assert.equal(ok.M._invIn.storeOpen, null);
  // A posted invoice, a person who cannot edit, or a file with several documents.
  const posted = app(); open(posted, DOC({ status: 'posted' }));
  assert.doesNotMatch(fn(posted, 'invInDetail')('review'), /店舗を選ぶ<\/div>|店舗を変える/);
  const crew = app({ role: 'crew' }); open(crew, DOC());
  assert.doesNotMatch(fn(crew, 'invInDetail')('review'), /店舗を選ぶ<\/div>|店舗を変える/);
  fn(crew, 'invInSet')('e', 'storeWhy', null, 'x'); fn(crew, 'invInSet')('e', 'storeTo', null, 'S2');
  await fn(crew, 'invInReassign')(true);
  assert.equal(crew.calls.length, 0);
  const multi = app(); open(multi, DOC({ reasons: [{ code: 'multi_store', detail: 'S1,S2' }, { code: 'multiple_documents' }] }));
  h = fn(multi, 'invInDetail')('review');
  assert.match(h, /ファイルの書類はすべて選んだ店舗になります/);
  assert.match(h, /宛先は複数の店舗：Alpha・Bravo/);
  assert.match(h, /<option value="" selected>選ぶ<\/option>/, 'several printed stores (the current one too): nothing is chosen for the person');
  // The note says plainly that automatic posting may post it after the change.
  assert.match(h, /自動反映が ON の店舗・業者で確かめることが無ければ、そのまま反映されます/);
});

test('one invoice: a packing list with amounts is saved as an invoice with the reason, re-read and posted', async () => {
  const before = () => DOC({ doc_type: 'other', posting_kind: 'none', reasons: [{ code: 'doc_type_unknown' }, { code: 'mode_review_store' }] });
  const after = before(); after.doc.version = 4; after.doc.doc_type = 'invoice'; after.doc.posting_kind = 'purchase'; after.doc.reasons = [{ code: 'mode_review_store' }];
  const c = app({ api: b => (b.action === 'edit' ? { ok: true, version: 4 } : b.action === 'get' ? after : { ok: true }) });
  open(c, before());
  let h = fn(c, 'invInDetail')('review');
  assert.match(h, /書類の種類<\/td><td[^>]*>その他<\/td>/, 'the AI reading');
  assert.match(h, /<option value="" selected>その他（選び直す）<\/option>/);
  assert.equal((h.match(/書類の種類が分からない → 開いて種類を選ぶ/g) || []).length, 3, 'the status, the list of checks and the document type row');
  const mk = o => fn(c, 'invInMark4')(DOC(o).doc, 'type');
  assert.deepEqual([fn(c, 'invInMark4')(before().doc, 'type'), mk({}), mk({ doc_type: 'statement', reasons: [{ code: 'statement' }] }), mk({ doc_type: 'unknown', reasons: [] }), mk({ doc_type: 'other', reasons: [] })],
    ['?', 'ok', 'ok', '?', '?']);
  assert.match(h, /金額のある Packing list は「Packing list（invoice 扱い）」を選ぶ/);
  assert.doesNotMatch(h, /この内容で反映する<\/button>/, 'not a purchase yet');
  assert.match(h, /この書類は仕入れとして計上しません/);
  fn(c, 'invInSetDocType')('pl');
  h = fn(c, 'invInDetail')('review');
  assert.match(h, /<option value="pl" selected>Packing list（invoice 扱い）<\/option>/);
  assert.match(h, /書類の種類：Packing list（invoice 扱い）（保存すると確かめ直します）/);
  assert.match(h, /この内容で反映する<\/button>/);
  assert.doesNotMatch(h, /次は直してから反映します|この書類は仕入れとして計上しません/);
  assert.match(h, /金額のある Packing list を invoice として反映します/);
  await fn(c, 'invInConfirm')();
  assert.deepEqual(c.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0].header)), { doc_type: 'invoice' });
  assert.equal(c.calls[0].reason, '経理の確認で直した / 書類の種類：Packing list を invoice として扱う');
  assert.equal(c.calls[2].version, 4);
  // Choosing the type again undoes it; a statement stays out of posting; a value that is not offered is ignored.
  const x = app(); open(x, before());
  fn(x, 'invInSetDocType')('pl'); fn(x, 'invInSetDocType')('');
  assert.deepEqual([JSON.parse(JSON.stringify(x.M._invIn.edits.h)), x.M._invIn.plDoc], [{}, null]);
  fn(x, 'invInSetDocType')('pl'); fn(x, 'invInSetDocType')('invoice');
  assert.deepEqual([JSON.parse(JSON.stringify(x.M._invIn.edits.h)), x.M._invIn.plDoc], [{ doc_type: 'invoice' }, null]);
  fn(x, 'invInSetDocType')('statement');
  h = fn(x, 'invInDetail')('review');
  assert.doesNotMatch(h, /この内容で反映する<\/button>/);
  fn(x, 'invInSetDocType')('receipt');
  assert.equal(x.M._invIn.edits.h.doc_type, 'statement');
  // Choosing the type the document already has changes nothing (a statement stays a statement to check).
  const st = app(); open(st, DOC({ doc_type: 'statement', posting_kind: 'none', reasons: [{ code: 'statement' }] }));
  fn(st, 'invInSetDocType')('statement');
  assert.deepEqual(JSON.parse(JSON.stringify(st.M._invIn.edits.h)), {});
  assert.doesNotMatch(fn(st, 'invInDetail')('review'), /保存すると確かめ直します/);
  // An invoice that is already an invoice and picked as a packing list sends no change.
  const y = app(); open(y, DOC({ reasons: [{ code: 'mode_review_store' }] }));
  fn(y, 'invInSetDocType')('pl');
  assert.deepEqual(JSON.parse(JSON.stringify(fn(y, 'invInCollectEdits')(y.M._invIn.doc.doc, []).header)), {});
  // English.
  const en = app(); en.curLang = 'en'; open(en, before());
  fn(en, 'invInSetDocType')('pl');
  assert.match(fn(en, 'invInDetail')('review'), /<option value="pl" selected>Packing list \(as invoice\)<\/option>/);
});

test('independent review P1: the batch posts exactly the rows (and versions) the question showed, never rows that moved in later', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => row(i + 1, { v: 'a', no: String(i + 1) }));
  const c = app({ api: () => ({ ok: true }) });
  c.M._invIn.review = { rows, total: 150 };
  // Only two rows ticked on page 1.
  fn(c, 'invInSelAll')(false); fn(c, 'invInSel')(id(3), true); fn(c, 'invInSel')(id(50), true);
  fn(c, 'invInBatchAsk')();
  assert.match(c.modals.at(-1), /<b>2 件<\/b>/);
  assert.match(c.modals.at(-1), /invInBatchPost\(true\)/);
  // Before "Post" is pressed the list is read again: row 3 was posted elsewhere, row 50 changed, row 101 moved up onto page 1 (ticked).
  const now = rows.filter(r => r.id !== id(3)).map(r => (r.id === id(50) ? { ...r, version: 2, total_cents: 999999 } : r));
  c.M._invIn.review = { rows: now, total: 149 };
  await fn(c, 'invInBatchPost')(true);
  assert.deepEqual(c.calls.map(b => [b.action, b.doc_id, b.version]), [['post', id(3), 1], ['post', id(50), 1]], 'what was shown, with the version shown (the server refuses a changed one)');
  // Pressing it again without a new question sends nothing.
  await fn(c, 'invInBatchPost')(true);
  assert.equal(c.calls.length, 2);
  // While the list is being read again, the question is not shown and the button is off.
  c.M._invIn.loaded.review = 'loading';
  const n = c.modals.length; fn(c, 'invInBatchAsk')();
  assert.equal(c.modals.length, n);
  assert.match(fn(c, 'invInQueueHtml')('review'), /<button class="btn btn-primary btn-sm" disabled onclick="invInBatchAsk\(\)">/);
});

test('independent review P2: rows a person unticked stay unticked after a batch is posted', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => row(i + 1, { v: 'a', no: String(i + 1) }));
  const c = app({ api: () => ({ ok: true }) });
  c.M._invIn.review = { rows, total: 150 };
  fn(c, 'invInSel')(id(120), false);
  await fn(c, 'invInBatchPost')();
  assert.equal(c.calls.length, 100);
  assert.equal(fn(c, 'invInSelected')(rows[119]), false);
  assert.equal(fn(c, 'invInSelected')(rows[120]), true);
});

test('independent review P2: a document that could not be read, or a receipt, cannot change its type', () => {
  for (const [code, note] of [['unreadable', /読み取れなかった書類は種類を変えられません/], ['ai_failed', /読み取れなかった書類は種類を変えられません/], ['receipt_route', /レシートは種類を変えられません/]]) {
    const c = app(); open(c, DOC({ doc_type: code === 'receipt_route' ? 'receipt' : 'unknown', posting_kind: 'none', reasons: [{ code }] }));
    const h = fn(c, 'invInDetail')('review');
    assert.doesNotMatch(h, /aria-label="書類の種類"/, code);
    assert.match(h, note, code);
    fn(c, 'invInSetDocType')('pl');
    assert.deepEqual([JSON.parse(JSON.stringify(c.M._invIn.edits.h)), c.M._invIn.plDoc || null], [{}, null], code);
    assert.doesNotMatch(fn(c, 'invInDetail')('review'), /この内容で反映する<\/button>/, code);
  }
});

test('second review P2: a document without an AI reading keeps its type even after the read failure reason was saved away', () => {
  const c = app(); const d = DOC({ doc_type: 'unknown', posting_kind: 'none', reasons: [{ code: 'doc_type_unknown' }, { code: 'no_lines' }] }); d.ai_doc = null;
  open(c, d);
  const h = fn(c, 'invInDetail')('review');
  assert.doesNotMatch(h, /aria-label="書類の種類"/);
  assert.match(h, /読み取れなかった書類は種類を変えられません/);
  fn(c, 'invInSetDocType')('pl');
  assert.deepEqual(JSON.parse(JSON.stringify(c.M._invIn.edits.h)), {});
});

test('second review P3: late store change, cancelled question, sign-out, a printed store not taking invoices in, a packing list saved first', async () => {
  // A store change that returns after another invoice was opened does not close that invoice.
  let release; const gate = new Promise(r => { release = r; });
  const c = app({ api: async b => { if (b.action === 'reassign') { await gate; return { ok: true }; } return { ok: true }; } });
  open(c, DOC()); fn(c, 'invInSet')('e', 'storeWhy', null, 'x');
  const pending = fn(c, 'invInReassign')();
  const other = DOC({ id: id(7), reasons: [{ code: 'mode_review_store' }] }); open(c, other); c.M._invIn.edits.h.invoice_no = '1';
  release(); await pending;
  assert.deepEqual([c.M._invIn.docId, c.M._invIn.edits.h.invoice_no], [id(7), '1']);
  assert.equal(c.M._invIn.loaded.review, undefined);
  // Cancel and sign-out forget the question; sign-out forgets the packing list choice.
  const q = app(); q.M._invIn.review = { rows: [row(1)], total: 1 };
  fn(q, 'invInBatchAsk')();
  assert.match(q.modals.at(-1), /onclick="_invIn\.batchPlan=null;closeModalDirect\(\)">キャンセル/);
  assert.match(q.modals.at(-1), /class="modal-close" onclick="_invIn\.batchPlan=null;closeModalDirect\(\)"/);
  q.M._invIn.plDoc = id(2);
  fn(q, 'invInReset')();
  assert.deepEqual([q.M._invIn.batchPlan, q.M._invIn.plDoc], [null, null]);
  // The printed store that is not taking invoices in is named and marked.
  const ia = app(); open(ia, DOC({ reasons: [{ code: 'store_mismatch', detail: 'S3' }] }));
  const h = fn(ia, 'invInDetail')('review');
  assert.match(h, /→ 設定の Charlie（取込していない店舗・選べない） と一致/);
  assert.doesNotMatch(h, /<option value="S3"/);
  // A packing list saved with "save changes only" is still recorded when it is posted later.
  const before = () => DOC({ doc_type: 'other', posting_kind: 'none', reasons: [{ code: 'doc_type_unknown' }, { code: 'mode_review_store' }] });
  const after = before(); after.doc.version = 4; after.doc.doc_type = 'invoice'; after.doc.posting_kind = 'purchase'; after.doc.reasons = [{ code: 'mode_review_store' }];
  const sv = app({ api: b => (b.action === 'edit' ? { ok: true, version: 4 } : b.action === 'get' ? after : { ok: true }) });
  open(sv, before()); fn(sv, 'invInSetDocType')('pl');
  await fn(sv, 'invInSave')();
  await fn(sv, 'invInLoadDoc')();
  assert.match(fn(sv, 'invInDetail')('review'), /<option value="pl" selected>/);
  await fn(sv, 'invInConfirm')();
  assert.deepEqual(sv.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.match(sv.calls[2].reason, /書類の種類：Packing list を invoice として扱う$/);
});

test('a packing list the AI already read as an invoice is recorded when it is posted (and when other values are saved)', async () => {
  const PL = '書類の種類：Packing list を invoice として扱う';
  const clean = () => DOC({ reasons: [{ code: 'mode_review_store' }] });
  const c = app({ api: () => ({ ok: true }) });
  open(c, clean()); fn(c, 'invInSetDocType')('pl');
  await fn(c, 'invInConfirm')();
  assert.deepEqual(c.calls.map(b => b.action), ['post']);
  assert.equal(c.calls[0].reason, '経理の確認（業者・invoice番号・金額・店舗） / ' + PL);
  // With another correction: the save and the post both say so.
  const after = clean(); after.doc.version = 4; after.doc.invoice_no = '77411';
  const d = app({ api: b => (b.action === 'edit' ? { ok: true, version: 4 } : b.action === 'get' ? after : { ok: true }) });
  open(d, clean()); fn(d, 'invInSetDocType')('pl'); d.M._invIn.edits.h.invoice_no = '77411';
  await fn(d, 'invInConfirm')();
  assert.deepEqual(d.calls.map(b => b.action), ['edit', 'get', 'post']);
  assert.equal(d.calls[0].reason, '経理の確認で直した / ' + PL);
  assert.equal(d.calls[2].reason, '経理の確認（業者・invoice番号・金額・店舗） / ' + PL);
});

test('rows that could not be read while the list changed are reported as such; a row without a store sorts last', () => {
  const c = app();
  c.M._invIn.review = { rows: [row(1, { store: 'S2' }), { ...row(2), store_id: null }, row(3, { store: 'S1' })], total: 4 };
  assert.match(fn(c, 'invInQueueHtml')('review'), /読み込むあいだに一覧が変わり、1 件を読めませんでした。「更新」で読み直してください/);
  fn(c, 'invInRSortPick')('5');
  assert.deepEqual(order(c), [id(3), id(1), id(2)]);
  fn(c, 'invInRSortHead')('store');
  assert.deepEqual(order(c), [id(1), id(3), id(2)], 'also last when the order is reversed');
});
