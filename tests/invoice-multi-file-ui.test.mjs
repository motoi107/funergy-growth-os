// 段階 3 (app v1082): the same-invoice-number screen and an invoice in several originals.
// Moto 2026-10-14「同じinvoice#で続いてるパターンもあるので、重複か複数枚で１つのinvoiceか選択して処理できる様にする（invoice#を正にして、
// 重複で削除か統合で複数選択を可能にする）」→ UI案50 (6A・7A・8A) and「台帳に出さずに作る」.
// Runs the real Invoice intake module from index.html in a VM with synthetic state. No network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office', api = () => ({ ok: true }), dom = {}, lang = 'ja' } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], renders: 0, curLang: lang, curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Tenkichi', color: '#777' }, { id: 'F04-K', name: 'Kaimuki', color: '#555' }],
    getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => { c.renders++; }, acSetSub: s => { c._acSub = s; }, go: () => {}, lsSet: () => true,
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
  c.M._invIn.loaded = {}; c.M._invIn.cand = {};
  c.fn = name => vm.runInContext(name, c);
  return c;
}
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fid = n => 'drivefile' + String(n).padStart(8, '0');
// One "get" answer of the server, for a synthetic document of Pacific Seafood INV-55021.
function G(n, o = {}) {
  return {
    doc: { id: id(n), version: o.v || 1, status: o.status || 'review', doc_type: 'invoice', posting_kind: 'purchase', vendor_key: 'v1', vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021',
      store_id: o.store || 'F06', invoice_date: '2026-10-11', total_cents: o.total ?? null, tax_cents: o.tax || 0, shipping_cents: o.ship || 0, lines_sum_cents: o.sum ?? null,
      pages_marked: o.marks || [], reasons: o.reasons || [], part_no: o.part_no ?? null, merge_base: o.merge_base ?? null, merged_into: o.merged_into ?? null, recon_status: 'unreconciled' },
    file: { drive_file_id: fid(n), current_name: o.name || `Scan_1012_16${40 + n}.pdf`, ingested_at: o.at || `2026-10-12T16:${String(40 + n).padStart(2, '0')}:00Z` },
    lines: Array.from({ length: o.lines || 0 }, (_, i) => ({ id: id(1000 + n * 50 + i), line_no: i + 1, page: 1, raw_name: 'ITEM ' + i, reasons: [] })),
    parts: o.parts || [], main: o.main || null, file_docs: o.file_docs || 1, qb: o.qb || [], events: [], related: [],
  };
}
// The three originals of UI案50: the second page arrived first; the third is a retake of the first page.
const THREE = () => ({
  [id(1)]: G(1, { marks: ['Page 2 of 2'], lines: 7, sum: 54800, tax: 8280, ship: 3500, total: 188040, name: 'Scan_<b>1641</b>.pdf', reasons: [{ code: 'same_number_different', detail: id(2) }] }),
  [id(2)]: G(2, { marks: ['Page 1 of 2'], lines: 11, sum: 121460, reasons: [{ code: 'total_missing' }, { code: 'missing_pages', detail: '1/2' }] }),
  [id(3)]: G(3, { marks: ['Page 1 of 2'], lines: 11, sum: 121460, reasons: [{ code: 'duplicate_certain', detail: id(2) }] }),
});
const PLAN = (o = {}) => ({ main: id(2), posted: false, parts: [{ id: id(2), part_no: 1, main: true }, { id: id(1), part_no: 2, main: false }],
  header: { vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021', invoice_date: '2026-10-11', currency: 'USD', subtotal_cents: null, tax_cents: 8280, shipping_cents: 3500, discount_cents: 0,
    other_cents: 0, total_cents: 188040, lines_sum_cents: 176260, from: { total_cents: id(1), tax_cents: id(1), shipping_cents: id(1) } },
  lines_n: 18, pages: 2, reasons: [{ code: 'mode_review_store' }], ...o });
const getter = docs => b => (b.action === 'get' ? docs[b.doc_id] || { status: 404, error: 'not_found' } : null);

test('the screen checks a page added to a posted invoice like the server does', () => {
  const c = app();
  const merge = SQL.slice(SQL.indexOf('create function public.invoice_merge('));
  const list = name => [...(new RegExp(name + " text\\[\\] := array\\[([^\\]]+)\\]").exec(merge)[1].matchAll(/'([a-z_]+)'/g))].map(m => m[1]);
  assert.deepEqual([...c.fn('INVIN_MERGE_ACK')], list('may_ack'));
  assert.deepEqual([...c.fn('INVIN_MUST_FIX')].sort(), list('must_fix').sort());
  for (const k of ['has_parts', 'bad_merge', 'route_not_assigned']) assert.ok(c.fn('INVIN_ERR')[k], k);
  assert.match(c.fn('invInErrText')('bad_merge', 409), /まとめられません/);
});

test('review list: the same-number heading opens the screen; an invoice of pages shows how many; other roles see no button', () => {
  const rows = [
    { id: id(1), version: 1, status: 'review', doc_type: 'invoice', vendor_key: 'v1', vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021', total_cents: 188040, store_id: 'F06', ingested_at: '2026-10-12T16:41:00Z', reasons: [{ code: 'same_number_different', detail: id(2) }] },
    { id: id(2), version: 1, status: 'review', doc_type: 'invoice', vendor_key: 'v1', vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021', total_cents: null, store_id: 'F06', ingested_at: '2026-10-12T16:42:00Z', reasons: [{ code: 'total_missing' }] },
    { id: id(4), version: 2, status: 'review', doc_type: 'invoice', vendor_key: 'v2', vendor_name: 'Aloha Meats', invoice_no: '77', total_cents: 5000, store_id: 'F06', parts: 2, reasons: [{ code: 'mode_review_store' }] },
  ];
  const c = app();
  c.M._invIn.review = { rows, total: 3 };
  const h = c.fn('invInQueueHtml')('review');
  assert.match(h, /同じ番号 2 件：Pacific Seafood · INV-55021<\/b> <span style="color:var\(--muted\)">— 重複か、複数枚で 1 つの invoice か<\/span>/);
  assert.match(h, /invInSameFromRow\('00000000-0000-4000-8000-00000000000[12]'\)"><i class="ti ti-files"><\/i> まとめて決める/);
  assert.match(h, /Aloha Meats<\/b>.*<i class="ti ti-files"><\/i> 3 枚/);
  assert.doesNotMatch(h, />同じ番号<\/button>/, 'grouped by number: the heading has the button');
  // Sorted another way the heading is gone; the row that has the same number gets its own button.
  c.fn('invInSetRSort')('amount', -1);
  const h2 = c.fn('invInQueueHtml')('review');
  assert.doesNotMatch(h2, /まとめて決める/);
  assert.equal((h2.match(/>同じ番号<\/button>/g) || []).length, 1);
  const other = app({ role: 'crew' }); other.M._invIn.review = { rows, total: 3 };
  assert.doesNotMatch(other.fn('invInQueueHtml')('review'), /まとめて決める|invInSameFromRow/);
  // The row opens the screen with every row of the number, received first first, and what their reasons name.
  c.fn('invInSameFromRow')(id(2));
  assert.deepEqual([...c.M._invIn.same.ids], [id(1), id(2)]);
  assert.equal(c.M._invIn.same.back, null);
  // The list shows the pages and the QuickBooks wait of a posted invoice of pages.
  assert.match(c.fn('invInQbChip')(null, 1, 'posted'), /複数枚：転送側の対応待ち/);
  assert.match(c.fn('invInQbChip')(null, 0, 'posted'), /対象外・未登録/);
  assert.match(c.fn('invInQbChip')('sent', 1, 'posted'), /送信済み/);
  assert.deepEqual({ ...c.fn('invInListParams')({ state: 'merged' }, 0) }, { action: 'list', limit: 50, offset: 0, status: 'merged' });
});

test('merge: pages from what is printed, the retake set aside, a preview first, then saved with every version', async () => {
  const docs = THREE();
  let pvAnswer = PLAN();
  const c = app({ api: b => getter(docs)(b) || (b.action === 'merge' && b.preview ? pvAnswer : b.action === 'merge' ? { ok: true, version: 3, file_ids: ['f2', 'f1'], posted: false, plan: PLAN() } : { ok: true }) });
  c.fn('invInSameOpen')([id(1), id(2), id(3)]);
  const S = c.M._invIn.same;
  assert.match(c.fn('invInSameHtml')(), /要確認の一覧へ<\/button><div class="card"[^>]*><i class="ti ti-loader-2"><\/i>/);
  await c.fn('invInLoadSame')();
  assert.deepEqual(c.calls.map(b => [b.action, b.doc_id]), [['get', id(1)], ['get', id(2)], ['get', id(3)]]);
  assert.deepEqual([...S.order], [id(1), id(2), id(3)], 'received order');
  assert.deepEqual({ ...S.inc }, { [id(1)]: true, [id(2)]: true, [id(3)]: false }, 'the retake is set aside');
  assert.equal(S.how, 'merge');
  assert.deepEqual({ ...S.page }, { [id(2)]: 1, [id(1)]: 2 }, 'printed Page 1 of 2 comes first though it arrived second');
  let h = c.fn('invInSameHtml')();
  assert.match(h, /同じ invoice 番号が 3 件/);
  assert.match(h, /印字「Page 2 of 2」・明細 7 行・明細の計 \$548\.00・税 \$82\.80・送料 \$35\.00・合計 \$1,880\.40/);
  assert.match(h, /印字「Page 1 of 2」・明細 11 行・明細の計 \$1,214\.60・合計の印字なし/);
  assert.match(h, /原本 2 と同じ中身（撮り直し）/);
  assert.match(h, /重複として外す/);
  assert.match(h, /drive\.google\.com\/file\/d\/drivefile00000001\/preview/);
  assert.ok(h.includes('Scan_&lt;b&gt;1641&lt;/b&gt;.pdf') && !h.includes('<b>1641</b>'), 'file names are escaped');
  assert.match(h, /まとめた結果を計算しています/);
  assert.match(h, /<button class="btn btn-primary" disabled onclick="invInSameSave\(\)">/, 'nothing to save before the preview');
  await c.fn('invInSameSave')();
  assert.ok(!c.calls.some(b => b.action === 'merge'), 'no save before the preview');
  // The preview: the server works the whole invoice out, nothing is saved.
  await c.fn('invInLoadSamePv')();
  assert.deepEqual(c.calls.at(-1), { action: 'merge', preview: true, docs: [id(2), id(1)], duplicates: [id(3)] });
  h = c.fn('invInSameHtml')();
  assert.match(h, /18 行（11＋7）/);
  assert.match(h, /合計（2 枚目の印字）<\/div><div style="font-weight:800;text-align:right;overflow-wrap:anywhere">\$1,880\.40/);
  assert.match(h, /税・送料（2 枚目の印字）<\/div><div style="font-weight:700;text-align:right;overflow-wrap:anywhere">\$82\.80 ・ \$35\.00/);
  assert.match(h, /✓ 合っています/);
  assert.match(h, /2026-10-11_Pacific-Seafood_INV-55021_p1/);
  assert.match(h, /原本 3 は重複として外し、Drive からは消しません/);
  assert.match(h, /台帳に出しません/);
  assert.match(h, /<button class="btn btn-primary" onclick="invInSameSave\(\)"><i class="ti ti-files"><\/i> 1 つの invoice にまとめる/);
  // Saved: the pages in page order, the retake as a duplicate, every version that was looked at.
  S.note = '  2 枚に分けて撮った ';
  await c.fn('invInSameSave')();
  const sv = c.calls.at(-1);
  assert.deepEqual(sv, { action: 'merge', docs: [id(2), id(1)], duplicates: [id(3)], versions: { [id(2)]: 1, [id(1)]: 1, [id(3)]: 1 }, reason: '2 枚に分けて撮った', ack: [], adjustment_ack: false });
  assert.equal(c.M._invIn.same, null);
  assert.equal(c.M._invIn.docId, id(2)); assert.equal(c.M._invIn.docSub, 'dreview');
  assert.match(c.toasts.at(-1)[0], /2 枚を 1 つの invoice にまとめました。4 項目を確かめて反映してください/);
  // Without a note the record says what happened.
  const c2 = app({ api: b => getter(THREE())(b) || (b.action === 'merge' && b.preview ? PLAN() : { ok: true, file_ids: ['a', 'b'], posted: false, plan: PLAN() }) });
  c2.fn('invInSameOpen')([id(1), id(2), id(3)]); await c2.fn('invInLoadSame')(); await c2.fn('invInLoadSamePv')(); await c2.fn('invInSameSave')();
  assert.equal(c2.calls.at(-1).reason, '複数枚で 1 つの invoice');
  pvAnswer = null;
});

test('merge: a change of pages or files throws the preview away; a late answer for an older choice is not used', async () => {
  let release; const late = new Promise(r => { release = r; });
  let first = true;
  const c = app({ api: async b => getter(THREE())(b) || (b.action === 'merge' && b.preview ? (first ? (first = false, await late, PLAN()) : PLAN({ main: id(1) })) : { ok: true }) });
  c.fn('invInSameOpen')([id(1), id(2), id(3)]); await c.fn('invInLoadSame')();
  const S = c.M._invIn.same;
  const pending = c.fn('invInLoadSamePv')();
  c.fn('invInSamePage')(id(1), 1);                                   // swap: the page that was 2 becomes 1
  assert.deepEqual({ ...S.page }, { [id(1)]: 1, [id(2)]: 2 });
  release(); await pending;
  assert.equal(S.pv, null, 'the preview of the earlier order is not shown');
  assert.equal(c.fn('invInSameReady')(S), false);
  await c.fn('invInLoadSamePv')();
  assert.deepEqual(c.calls.at(-1), { action: 'merge', preview: true, docs: [id(1), id(2)], duplicates: [id(3)] });
  assert.equal(c.fn('invInSameReady')(S), true);
  // The retake taken in: it becomes the last page, nothing is set aside, the preview is gone.
  c.fn('invInSameInc')(id(3), true);
  assert.deepEqual({ ...S.page }, { [id(1)]: 1, [id(2)]: 2, [id(3)]: 3 }); assert.equal(S.pv, null);
  assert.deepEqual(JSON.parse(JSON.stringify(c.fn('invInSamePlan')(S))), { docs: [id(1), id(2), id(3)], duplicates: [] });
  assert.match(c.fn('invInSameHtml')(), /<option value="3" selected>3<\/option>/);
  c.fn('invInSameInc')(id(3), false);
  assert.deepEqual({ ...S.page }, { [id(1)]: 1, [id(2)]: 2 });
  // Only one file left: not a merge.
  c.fn('invInSameInc')(id(1), false);
  assert.match(c.fn('invInSameProblem')(S), /2 つ以上選んでください/);
  const n = c.calls.length; await c.fn('invInLoadSamePv')(); assert.equal(c.calls.length, n, 'no preview is asked for');
  assert.equal(c.fn('invInSameReady')(S), false);
});

test('merge: what cannot be merged is said before asking the server', async () => {
  const cases = [
    [{ [id(1)]: G(1, { marks: ['Page 1 of 2'] }), [id(2)]: G(2, { marks: ['Page 2 of 2'], store: 'F04-K' }) }, /店舗が違うファイルはまとめられません/],
    [{ [id(1)]: G(1, { status: 'posted', marks: ['Page 1 of 2'] }), [id(2)]: G(2, { status: 'posted', marks: ['Page 2 of 2'] }) }, /反映済みの invoice が 2 つあります/],
    [{ [id(1)]: G(1, { marks: ['Page 1 of 2'] }), [id(2)]: G(2, { marks: ['Page 2 of 2'], file_docs: 2 }) }, /書類が 2 つある原本はまとめられません/],
  ];
  for (const [docs, re] of cases) {
    const c = app({ api: getter(docs) });
    c.fn('invInSameOpen')([id(1), id(2)]); await c.fn('invInLoadSame')();
    c.fn('invInSameHow')('merge');
    assert.match(c.fn('invInSameProblem')(c.M._invIn.same), re);
    assert.match(c.fn('invInSameHtml')(), re);
    await c.fn('invInLoadSamePv')(); await c.fn('invInSameSave')();
    assert.ok(!c.calls.some(b => b.action === 'merge'), String(re));
  }
  // The server's own refusal is shown and nothing can be saved.
  const c = app({ api: b => getter(THREE())(b) || (b.action === 'merge' ? { status: 409, error: 'bad_merge' } : null) });
  c.fn('invInSameOpen')([id(1), id(2), id(3)]); await c.fn('invInLoadSame')(); await c.fn('invInLoadSamePv')();
  assert.match(c.fn('invInSameHtml')(), /まとめられません：まとめられません（同じ業者・番号・店舗の/);
  assert.equal(c.fn('invInSameReady')(c.M._invIn.same), false);
});

test('a page that arrives after its invoice was posted is added to it (8A), with what posting asks', async () => {
  const docs = {
    [id(1)]: G(1, { status: 'posted', v: 4, marks: ['Page 1 of 2'], lines: 3, total: 12000, qb: [{ state: 'sent', created_at: '2026-10-12T17:00:00Z' }] }),
    [id(2)]: G(2, { marks: ['Page 2 of 2'], lines: 1, reasons: [{ code: 'same_number_different', detail: id(1) }] }),
  };
  let pv = PLAN({ main: id(1), posted: true, parts: [{ id: id(1), part_no: 1, main: true }, { id: id(2), part_no: 2 }], reasons: [{ code: 'total_mismatch', detail: 'calc 16000 vs 12000' }] });
  const c = app({ api: b => getter(docs)(b) || (b.action === 'merge' && b.preview ? pv : b.action === 'merge' ? { ok: true, posted: true, file_ids: ['a', 'b'], rename: [{ ok: true }, { ok: false }], plan: pv } : null) });
  c.fn('invInSameOpen')([id(2), id(1)]); await c.fn('invInLoadSame')();
  const S = c.M._invIn.same;
  assert.equal(S.inc[id(1)], true); assert.equal(S.keep, id(1));
  let h = c.fn('invInSameHtml')();
  assert.match(h, /反映済み（ここに足す）/);
  assert.match(h, /<input type="checkbox" checked disabled onchange="invInSameInc\('00000000-0000-4000-8000-000000000001'/, 'a posted invoice is always in');
  await c.fn('invInLoadSamePv')();
  h = c.fn('invInSameHtml')();
  assert.match(h, /反映済みの invoice に足します（訂正/);
  assert.match(h, /もう QuickBooks へ送っています。足したページは QuickBooks で手で足してください/);
  assert.match(h, /✗ 合いません（差 \$40\.00）/);
  assert.ok(h.includes('onchange="invInSameAck(\'total_mismatch\',this.checked)"> 原本で確かめた：' + c.fn('invInReason')('total_mismatch') + '</label>'));
  assert.match(h, /反映済みの invoice に足す<\/button>/);
  assert.equal(c.fn('invInSameReady')(S), false, 'the mismatch needs a tick');
  c.fn('invInSameAck')('total_mismatch', true); S.adj = true;
  assert.equal(c.fn('invInSameReady')(S), true);
  await c.fn('invInSameSave')();
  assert.deepEqual(c.calls.at(-1), { action: 'merge', docs: [id(1), id(2)], duplicates: [], versions: { [id(1)]: 4, [id(2)]: 1 }, reason: '複数枚で 1 つの invoice', ack: ['total_mismatch'], adjustment_ack: true });
  assert.equal(c.M._invIn.docId, id(1)); assert.equal(c.M._invIn.docSub, 'drecon');
  assert.deepEqual(c.toasts.at(-1), ['反映済みの invoice に足しました（全部で 2 枚）。ファイル名はあとで自動でやり直します', 'warning']);
  // Something posting would make a person fix first: the pages cannot be added.
  pv = PLAN({ main: id(1), posted: true, reasons: [{ code: 'vendor_unknown' }] });
  const c2 = app({ api: b => getter(docs)(b) || (b.action === 'merge' ? pv : null) });
  c2.fn('invInSameOpen')([id(2), id(1)]); await c2.fn('invInLoadSame')(); await c2.fn('invInLoadSamePv')();
  assert.ok(c2.fn('invInSameHtml')().includes('反映済みの invoice には足せません：' + c2.fn('invInReason')('vendor_unknown')));
  assert.equal(c2.fn('invInSameReady')(c2.M._invIn.same), false);
});

test('duplicates: one is kept, the others are marked one by one with their versions; a posted invoice is the one kept', async () => {
  const docs = { [id(1)]: G(1, { lines: 2, total: 5000, v: 3 }), [id(2)]: G(2, { lines: 2, total: 5000, v: 5, reasons: [{ code: 'duplicate_certain', detail: id(1) }] }) };
  const c = app({ api: b => getter(docs)(b) || { ok: true } });
  c.fn('invInSameOpen')([id(1), id(2)]); await c.fn('invInLoadSame')();
  const S = c.M._invIn.same;
  assert.equal(S.how, 'dup', 'one file left after the retake: duplicates'); assert.equal(S.keep, id(1));
  let h = c.fn('invInSameHtml')();
  assert.match(h, /原本 1 を残し、原本 2 を重複として外します（計上しません）。Drive の原本は消しません/);
  assert.match(h, /重複にする（1 つを残す）<\/button>/);
  await c.fn('invInSameSave')();
  assert.deepEqual(c.calls.filter(b => b.action === 'mark'), [{ action: 'mark', doc_id: id(2), version: 5, mark: 'duplicate', duplicate_of: id(1), reason: '同じ番号の処理：重複（1 つを残す）' }]);
  assert.equal(c.M._invIn.same, null); assert.equal(c.M._invIn.docId, id(1));
  // One that could not be marked: the screen stays and reads them again.
  const c2 = app({ api: b => getter(docs)(b) || { status: 409, error: 'conflict' } });
  c2.fn('invInSameOpen')([id(1), id(2)]); await c2.fn('invInLoadSame')(); await c2.fn('invInSameSave')();
  assert.ok(c2.M._invIn.same); assert.equal(c2.M._invIn.same.G, null);
  assert.match(c2.toasts.at(-1)[0], /できなかった：1 件（ほかの人が先に更新しました/);
  // A posted invoice cannot be set aside.
  const posted = { [id(1)]: G(1, { status: 'posted' }), [id(2)]: G(2) };
  const c3 = app({ api: getter(posted) });
  c3.fn('invInSameOpen')([id(1), id(2)]); await c3.fn('invInLoadSame')();
  c3.fn('invInSameHow')('dup'); assert.equal(c3.M._invIn.same.keep, id(1));
  c3.fn('invInSameKeep')(id(2));
  assert.match(c3.fn('invInSameProblem')(c3.M._invIn.same), /反映済み・複数枚の invoice は重複にできません/);
  await c3.fn('invInSameSave')();
  assert.ok(!c3.calls.some(b => b.action === 'mark'));
});

test('separate invoices change nothing; cancel goes back where it came from; a conflict reads them again', async () => {
  const c = app({ api: getter(THREE()) });
  c.M._invIn.docId = id(1); c.M._invIn.docSub = 'dreview';
  c.fn('invInSameOpen')([id(1), id(2), id(3)]);
  assert.equal(c.M._invIn.same.back, id(1));
  await c.fn('invInLoadSame')();
  c.fn('invInSameHow')('sep');
  assert.match(c.fn('invInSameHtml')(), /何も変えません/);
  const n = c.calls.length;
  await c.fn('invInSameSave')();
  assert.equal(c.calls.length, n); assert.equal(c.M._invIn.same, null); assert.equal(c.M._invIn.docId, id(1));
  assert.match(c.fn('invInReview')(), /onclick="invInBack\(\)"><i class="ti ti-chevron-left"><\/i> 要確認の一覧へ/);
  // A conflict while saving: read again (the choices start over from what is there now).
  const c2 = app({ api: b => getter(THREE())(b) || (b.action === 'merge' && b.preview ? PLAN() : { status: 409, error: 'conflict' }) });
  c2.fn('invInSameOpen')([id(1), id(2), id(3)]); await c2.fn('invInLoadSame')(); await c2.fn('invInLoadSamePv')(); await c2.fn('invInSameSave')();
  assert.ok(c2.M._invIn.same); assert.equal(c2.M._invIn.same.G, null); assert.ok(!c2.M._invIn.loaded.same);
  // A merged page in the list is taken as its invoice; a document already excluded is left out.
  const docs = { [id(1)]: G(1, { status: 'merged', main: { id: id(7), status: 'review' } }), [id(7)]: G(7, { parts: [{ id: id(1), part_no: 2 }] }), [id(2)]: G(2), [id(3)]: G(3, { status: 'rejected' }) };
  const c3 = app({ api: getter(docs) });
  c3.fn('invInSameOpen')([id(2), id(1), id(3)]); await c3.fn('invInLoadSame')();
  assert.deepEqual([...c3.M._invIn.same.order], [id(2), id(7)]); assert.deepEqual([...c3.M._invIn.same.skip], [id(3)]);
  assert.equal(c3.M._invIn.same.how, 'merge'); assert.deepEqual({ ...c3.M._invIn.same.page }, { [id(7)]: 1, [id(2)]: 2 });
  const h = c3.fn('invInSameHtml')();
  assert.match(h, /ほかに 対象外・重複などにした書類が 1 件あります/);
  assert.match(h, /ページ 1–2<\/span>/, 'the invoice with pages keeps its pages first');
  assert.match(h, /<option value="2" selected>3<\/option>/, 'the new page comes after them');
});

test('one invoice: the same-number button, an invoice of pages, a merged page, taking a merge back, QuickBooks by hand', async () => {
  // The same-number entry on the invoice: the other document is named in its reasons (a merged page counts as its invoice).
  const c = app({ api: getter({}) });
  const one = G(2, { reasons: [{ code: 'same_number_different', detail: id(5) }] });
  c.M._invIn.cand = { [id(5)]: { id: id(5), status: 'merged', merged_into: id(7) } };
  c.M._invIn.docId = id(2); c.M._invIn.doc = one; c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  c.M._invIn.config = { vendors: [], maps: [], stores: [{ store_id: 'F06', active: true }] };
  assert.deepEqual([...c.fn('invInSameCands')(one.doc)], [id(7)]);
  assert.match(c.fn('invInDetail')('review'), /invInSameFromDoc\(\)"><i class="ti ti-files"><\/i> 同じ番号の処理（まとめる・重複）/);
  c.fn('invInSameFromDoc')();
  assert.deepEqual([...c.M._invIn.same.ids], [id(2), id(7)]); assert.equal(c.M._invIn.same.back, id(2));
  // An invoice of two originals waiting for review: its pages, the originals to switch between, take the merge back.
  const main = G(7, { lines: 3, total: 19950, part_no: 1, merge_base: { doc: {} }, reasons: [{ code: 'mode_review_store' }, { code: 'store_mismatch', detail: 'F04-K' }],
    name: 'Scan <b>1</b>.pdf', parts: [{ id: id(8), part_no: 2, version: 3, file_id: id(80), drive_file_id: fid(8), current_name: 'Scan_<i>2</i>.pdf' }] });
  const d = app({ api: b => (b.action === 'unmerge' ? { ok: true, file_ids: [] } : b.action === 'qb_manual' ? { ok: true, added: 2 } : { ok: true }),
    dom: { 'ivx-qbm-note': { value: ' QB #1234 ' } } });
  d.M._invIn.docId = id(7); d.M._invIn.doc = main; d.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  d.M._invIn.config = { vendors: [], maps: [], stores: [{ store_id: 'F06', active: true }, { store_id: 'F04-K', active: true }] };
  let h = d.fn('invInDetail')('review');
  assert.match(h, /<i class="ti ti-files"><\/i> 2 枚/);
  assert.match(h, /複数枚の invoice：2 枚/);
  assert.ok(h.includes('Scan &lt;b&gt;1&lt;/b&gt;.pdf') && h.includes('Scan_&lt;i&gt;2&lt;/i&gt;.pdf') && !h.includes('<i>2</i>'));
  assert.match(h, />1 枚目<\/button><button class="btn btn-sm btn-secondary"[^>]*>2 枚目<\/button>/);
  assert.match(h, /まとめを外す/);
  assert.doesNotMatch(h, /invInMark\('duplicate'\)|invInMark\('reject'\)/, 'set aside or excluded only after taking the merge back');
  assert.match(h, /先に「まとめを外す」/);
  assert.doesNotMatch(h, /店舗を変える|invInReassign/, 'its store is not changed while it has pages');
  assert.match(h, /drive\.google\.com\/file\/d\/drivefile00000007\/preview/);
  d.fn('invInShowOrig')(fid(8));
  h = d.fn('invInDetail')('review');
  assert.match(h, /drive\.google\.com\/file\/d\/drivefile00000008\/preview/);
  assert.match(h, /この invoice の 2 枚目の原本<br>ファイル名：<span[^>]*>Scan_&lt;i&gt;2&lt;\/i&gt;\.pdf<\/span><br>/);
  d.fn('invInUnmergeAsk')();
  assert.match(d.modals.at(-1), /2 枚の原本を、まとめる前のそれぞれの要確認に戻します/);
  await d.fn('invInUnmerge')();
  assert.deepEqual(d.calls.at(-1), { action: 'unmerge', doc_id: id(7), version: 1, reason: 'まとめを外す' });
  assert.equal(d.M._invIn.origFile, null);
  // Posted: QuickBooks waits for the forwarder; entering it by hand is recorded for every page.
  const posted = G(7, { status: 'posted', v: 6, part_no: 1, parts: [{ id: id(8), part_no: 2, drive_file_id: fid(8), current_name: 'p2.pdf', qb_state: null }] });
  d.M._invIn.doc = posted; d.M._invIn.loaded = {};
  h = d.fn('invInDetail')('recon');
  assert.match(h, /複数枚：転送側の対応待ち/);
  assert.match(h, /転送側（ChatGPT）が対応するまで台帳に出しません/);
  assert.doesNotMatch(h, /まとめを外す/);
  d.fn('invInQbManualAsk')();
  assert.match(d.modals.at(-1), /すべて QuickBooks に手で入れたことを記録します/);
  await d.fn('invInQbManual')();
  assert.deepEqual(d.calls.at(-1), { action: 'qb_manual', doc_id: id(7), version: 6, note: 'QB #1234' });
  assert.deepEqual(d.toasts.at(-1), ['記録しました（2 ページ）', 'success']);
  posted.qb = [{ state: 'sent', created_at: '2026-10-13T00:00:00Z' }]; posted.parts[0].qb_state = 'sent';
  h = d.fn('invInDetail')('recon');
  assert.match(h, /すべてのページを記録済み/); assert.doesNotMatch(h, /invInQbManualAsk/);
  // A merged page: where its lines are.
  const page2 = G(8, { status: 'merged', part_no: 2, main: { id: id(7), vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021', status: 'posted' } });
  d.M._invIn.docId = id(8); d.M._invIn.doc = page2;
  h = d.fn('invInDetail')('recon');
  assert.match(h, /まとめた原本/);
  assert.match(h, /この原本は「Pacific Seafood · INV-55021」の 2 枚目にまとめました（明細はそちらに入っています）。/);
  assert.match(h, /invInOpen\('00000000-0000-4000-8000-000000000007','drecon'\)">まとめた invoice を開く/);
});

test('English: the same-number screen and an invoice of pages', async () => {
  const c = app({ lang: 'en', api: b => getter(THREE())(b) || (b.action === 'merge' ? PLAN() : null) });
  c.fn('invInSameOpen')([id(1), id(2), id(3)]); await c.fn('invInLoadSame')(); await c.fn('invInLoadSamePv')();
  const h = c.fn('invInSameHtml')();
  for (const s of ['Same invoice number: 3 documents', 'One invoice in several originals', 'Set aside as duplicate', 'Original 2: same content (a retake)',
    'Total (printed on page 2)', 'They match', 'Merge into one invoice', 'Cancel', 'Printed “Page 2 of 2”']) assert.ok(h.includes(s), s);
  assert.doesNotMatch(h.replace(/<[^>]*>/g, ''), /[ぁ-んァ-ン一-龥]/, 'no Japanese text left');
  const m = G(8, { status: 'merged', part_no: 2, main: { id: id(7), vendor_name: 'Pacific Seafood', invoice_no: 'INV-55021', status: 'review' } });
  c.M._invIn.docId = id(8); c.M._invIn.doc = m; c.M._invIn.edits = { version: 1, h: {}, l: {}, reason: '', ack: {} };
  assert.match(c.fn('invInDetail')('recon'), /This original is page 2 of “Pacific Seafood · INV-55021” \(its lines are there\)\./);
});
