// B-3 (Moto 2026-11-23, app v1210): 照合済み → QuickBooks, the screen side.
// The real Invoice intake module from index.html runs in a VM. Synthetic data only; no real database, Google, QuickBooks or LINE.
//  * the six words for an invoice's forwarding (未転送・転送待ち・処理中・転送成功・転送失敗・結果確認待ち), read from the server
//  * 照合待ち as a table: choose rows, reconcile them together, the result (selected / saved / not saved and the six states)
//  * one invoice: the toast after 照合済み・差異あり・未照合, 「もう一度送る」 only where the server allows it
//  * 照合済みだが未転送 (B-3-4): causes known and not known apart, one invoice at a time, no bulk resend
//  * several originals: with this system as the sender the texts say one PDF in one mail; with the forwarder before, as before
//  * end to end: the screen against the real invoice-intake handler and SQL (PGlite) with a stand-in Drive, AI and Gmail
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
assert.ok(MOD.length > 10000);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office_crew', api = () => ({ ok: true }), lang = 'ja', fetchFn = null, token = 'tok' } = {}) {
  const c = {
    calls: [], toasts: [], modals: [], renders: 0, curLang: lang, curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'drecon',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Tenkichi', color: '#777' }, { id: 'F04-K', name: 'Kaimuki', color: '#555' }],
    getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => { c.renders++; }, acSetSub: s => { c._acSub = s; }, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: { access_token: token, refresh_token: 'ref' }, botResetShared: () => {}, botTime: v => String(v || ''),
    window: {}, setTimeout: () => {}, document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: fetchFn || (async (url, init) => {
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await api(body, c);
      return r && r.status ? { ok: false, status: r.status, json: async () => ({ error: r.error }) } : { ok: true, status: 200, json: async () => r };
    }),
  };
  vm.createContext(c);
  vm.runInContext(MOD, c);
  c.fn = n => vm.runInContext(n, c);
  c.I = c.fn('_invIn'); c.I.loaded = {}; c.I.cand = {};
  return c;
}
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const R = (n, o = {}) => ({ id: id(n), status: 'posted', recon_status: 'unreconciled', version: 3, total_cents: 12000 + n, vendor_name: 'Aloha Produce', invoice_no: 'INV-' + n,
  invoice_date: '2026-11-0' + (n % 9 + 1), store_id: 'F06', drive_file_id: 'drivefile' + n, current_name: 'x.pdf', parts: 0, qb_state: null, ...o });
const text = h => h.replace(/<[^>]*>/g, '');

test('six words: chips and lines per state, external queued says hourly, errors escaped, English', () => {
  const c = app();
  c.I.qbRoute = 'invoice-intake';
  const want = { not_sent: '未転送', queued: '転送待ち', sending: '処理中', sent: '転送成功', failed: '転送失敗', unknown: '結果確認待ち' };
  for (const [k, w] of Object.entries(want)) assert.ok(c.fn(`invInQb6Chip({ state:${JSON.stringify(k)} })`).includes(w), k);
  assert.match(c.fn("invInQb6Chip({ state:'failed', stopped:true })"), /転送失敗（止まった）/);
  assert.match(c.fn("invInQb6Chip({ state:'sent', manual:true })"), /転送成功（手で記録）/);
  assert.match(c.fn("invInQbStateLine({ state:'queued' })"), /すぐに送ります/);
  assert.match(c.fn("invInQbStateLine({ state:'queued', route:'external' })"), /前の転送（ChatGPT）が 1 時間ごとに送ります/);
  assert.match(c.fn("invInQbStateLine({ state:'not_sent', why:'rename_waiting' })"), /名前を変える待ちです/);
  assert.match(c.fn("invInQbStateLine({ state:'not_sent', why:'cancelled_recon_cancelled' })"), /照合を取り消したので送っていません/);
  assert.match(c.fn("invInQbStateLine({ state:'not_sent', why:'not_in_ledger' })"), /ほかの方法で入れたかは分かりません/);
  assert.match(c.fn("invInQbStateLine({ state:'unknown', last_error:'gmail_send_no_answer' })"), /自動では送り直しません/);
  // the reconciliation taken back while the send was under way (B-3 review): what went is a fact; what had not gone stops
  assert.match(c.fn("invInQbStateLine({ state:'sending', stop_requested:true })"), /まだ送っていなければ止めます（送り終わっていたら送信済みとして残ります）/);
  assert.equal(c.fn("invInQbStateLine({ state:'sending' })"), '送っているところです');
  assert.match(c.fn("invInQbStateLine({ state:'sent', sent_at:'2026-11-23T20:00:00Z', stop_requested:true })"), /照合を取り消す前に送り終わっていました（取下げ・訂正は QuickBooks で）/);
  assert.ok(!/取り消す前/.test(c.fn("invInQbStateLine({ state:'sent', sent_at:'2026-11-23T20:00:00Z' })")));
  assert.match(c.fn("invInQbStateLine({ state:'unknown', last_error:'gmail_send_no_answer', stop_requested:true })"), /送っていないと確かめたら、送らずに止めます/);
  const f = c.fn("invInQbStateLine({ state:'failed', attempts:2, last_error:'<img src=x onerror=1>' })");
  assert.ok(!f.includes('<img'), 'an unknown error code is escaped'); assert.match(f, /やり直し 2 \/ 5/);
  // the ledger off with no reason from the server
  c.I.qbEnabled = false;
  assert.match(c.fn("invInQbStateLine({ state:'not_sent' })"), /台帳が OFF です/);
  c.curLang = 'en';
  assert.match(c.fn("invInQb6Chip({ state:'unknown' })"), /Result to be checked/);
  assert.match(c.fn("invInQb6Chip({ state:'failed' })"), /Forwarding failed/);
});

test('照合待ちの表: only posted and not yet reconciled rows can be chosen; differences are opened one by one; QuickBooks shows the six words', () => {
  const c = app();
  c.I.qbRoute = 'invoice-intake';
  const rows = [R(1), R(2, { vendor_name: '<b>Evil</b>' }), R(3, { recon_status: 'discrepancy' }), R(4, { parts: 2 })];
  c.I.recon = { rows, total: 6 };
  c.I.qbst = { [id(1)]: { state: 'not_sent', why: 'rename_waiting' }, [id(4)]: { state: 'sent', combined: true, sent_at: '2026-11-23T20:00:00Z' } };
  const h = c.fn('invInReconTable(_invIn.recon)');
  assert.equal((h.match(/invInReconToggle\(/g) || []).length, 3, 'rows 1, 2 and 4');
  assert.ok(!h.includes(`invInReconToggle('${id(3)}'`), 'a row with a difference has no checkbox');
  assert.ok(h.includes('&lt;b&gt;Evil&lt;/b&gt;') && !h.includes('<b>Evil</b>'));
  assert.match(h, /未転送/); assert.match(h, /転送成功/); assert.match(h, /3 枚/);
  assert.match(h, /ほかに 2 件あります/);
  assert.match(h, /台帳を確かめ、まだ送っていないものを送り元の Gmail からすぐ送ります/);
  assert.match(h, /選んだ 0 件を照合済みにする/); assert.match(h, /disabled onclick="invInReconAsk\(\)"/);
  // choose all: only the three that can be chosen
  c.fn('invInReconAll(true)');
  assert.deepEqual(Object.keys(c.I.rsel).sort(), [id(1), id(2), id(4)]);
  const h2 = c.fn('invInReconTable(_invIn.recon)');
  assert.match(h2, /選んだ <b>3<\/b> 件 · <b>\$360\.07<\/b>/);
  // the forwarder before: the note does not promise a send from here
  c.I.qbRoute = 'external';
  assert.match(c.fn('invInReconTable(_invIn.recon)'), /この画面からは送りません/);
  // a role that cannot act sees no checkboxes or button
  const v = app({ role: 'am' }); v.I.recon = { rows, total: 4 };
  const vh = v.fn('invInReconTable(_invIn.recon)');
  assert.ok(!/invInReconToggle|invInReconAsk/.test(vh));
});

test('まとめて照合: the rows seen when pressing, one by one; one not saved stays; the result counts and the six states', async () => {
  let release;
  const c = app({ api: async b => {
    if (b.action === 'reconcile') {
      if (b.doc_id === id(2)) return { status: 409, error: 'conflict' };
      if (b.doc_id === id(4)) return { ok: true, version: 5, qb: { queued: 1, sending: false, waiting: 'gmail' }, rename: [{ ok: false, error: 'drive_403' }] };
      return { ok: true, version: 4, qb: { queued: 1, sending: true } };
    }
    if (b.action === 'qb_doc_states') return { enabled: true, route: 'invoice-intake', states: { [id(1)]: { state: 'sending', id: 'bbbbbbbb-0000-4000-8000-000000000001' }, [id(4)]: { state: 'not_sent', why: 'rename_waiting' } } };
    return { ok: true };
  } });
  c.I.qbRoute = 'invoice-intake';
  c.I.recon = { rows: [R(1), R(2, { version: 7 }), R(3, { recon_status: 'discrepancy' }), R(4)], total: 4 };
  c.I.loaded = { recon: 1, reconqb: 1, list: 1, qbs: 1, qbun: 1, doc: 1 };
  c.fn('invInReconAll(true)');
  c.fn('invInReconAsk()');
  assert.match(c.modals.at(-1), /3 件（\$360\.07）を照合済みにします/);
  assert.match(c.modals.at(-1), /もう送ってあるものは送りません/);
  // the list changes before the person presses: only the remembered rows (and versions) are sent
  c.I.recon.rows.push(R(9)); c.I.rsel[id(9)] = 1;
  await c.fn('invInReconBulk()');
  const sent = c.calls.filter(b => b.action === 'reconcile');
  assert.deepEqual(sent.map(b => [b.doc_id, b.version, b.result]), [[id(1), 3, 'reconciled'], [id(2), 7, 'reconciled'], [id(4), 3, 'reconciled']]);
  const st = c.calls.filter(b => b.action === 'qb_doc_states');
  assert.equal(st.length, 1); assert.deepEqual(st[0].doc_ids, [id(1), id(4)]);
  const res = c.I.reconRes;
  assert.equal(res.total, 3); assert.deepEqual([...res.saved], [id(1), id(4)]); assert.equal(res.failed.length, 1);
  assert.equal(res.gmail, true); assert.equal(res.rename, true);
  assert.deepEqual(Object.keys(c.I.rsel), [], 'the selection is cleared');
  for (const k of ['recon', 'reconqb', 'list', 'qbs', 'qbun', 'doc']) assert.ok(!(k in c.I.loaded), k);
  assert.equal(c.I.busy, false); assert.equal(c.I.rbatch, null);
  const m = text(c.modals.at(-1));
  assert.match(m, /選んだ件数3/); assert.match(m, /照合済みにできた（保存成功）2/); assert.match(m, /保存できなかった1/);
  assert.match(m, /転送待ち0/); assert.match(m, /処理中1/); assert.match(m, /転送成功0/); assert.match(m, /転送失敗0/); assert.match(m, /結果確認待ち0/); assert.match(m, /未転送1/);
  assert.match(m, /未転送：名前を変える待ちです[\s\S]*1 件/);
  assert.match(m, /Aloha Produce · INV-2：/);
  assert.match(m, /送り元の Gmail がつながっていない/); assert.match(m, /名前を変えられなかったもの/);
  // 「もう一度確かめる」 reads the states again (a moment later the sending one is sent)
  c.calls.length = 0;
  release = { enabled: true, route: 'invoice-intake', states: { [id(1)]: { state: 'sent', id: 'bbbbbbbb-0000-4000-8000-000000000001', sent_at: '2026-11-23T20:00:00Z' }, [id(4)]: { state: 'queued', id: 'q4' } } };
  const c2api = c.fetch; c.fetch = async (u, init) => { const b = JSON.parse(init.body); c.calls.push(b); return { ok: true, status: 200, json: async () => release }; };
  await c.fn('invInReconResCheck()');
  c.fetch = c2api;
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].action, 'qb_doc_states');
  const m2 = text(c.modals.at(-1));
  assert.match(m2, /転送待ち1/); assert.match(m2, /転送成功1/); assert.match(m2, /未転送0/);
});

test('まとめて照合: the states could not be read → said plainly, the reconciliation stays saved; a second press while working does nothing', async () => {
  const c = app({ api: async b => (b.action === 'reconcile' ? { ok: true, version: 4 } : b.action === 'qb_doc_states' ? { status: 500, error: 'boom' } : { ok: true }) });
  c.I.recon = { rows: [R(1)], total: 1 };
  c.fn('invInReconAll(true)'); c.fn('invInReconAsk()');
  c.I.rbatch = { total: 1, done: 0 };
  await c.fn('invInReconBulk()');
  assert.equal(c.calls.filter(b => b.action === 'reconcile').length, 0, 'not while another run is going');
  c.I.rbatch = null; c.fn('invInReconAsk()');
  await c.fn('invInReconBulk()');
  const m = text(c.modals.at(-1));
  assert.match(m, /照合済みにできた（保存成功）1/); assert.match(m, /状態を確かめられなかった1/); assert.match(m, /QuickBooks の状態を読めませんでした（boom）。照合済みの保存はできています/);
});

test('1 件の照合: the toast says what happened to the forwarding; taking it back says what was stopped and what could not be', async () => {
  const D = { id: id(5), version: 2, status: 'posted' };
  let states = { enabled: true, route: 'invoice-intake', states: { [id(5)]: { state: 'not_sent', why: 'rename_waiting' } } };
  let rec = { ok: true, version: 3, qb: { queued: 0, sending: false, waiting: 'gmail' } };
  const c = app({ api: async b => (b.action === 'reconcile' ? rec : b.action === 'qb_doc_states' ? states : { ok: true }) });
  c.I.qbRoute = 'invoice-intake';
  c.I.doc = { doc: D }; c.I.docId = D.id; c.I.edits = {};
  await c.fn("invInReconcile('reconciled')");
  let [msg, kind] = c.toasts.at(-1);
  assert.match(msg, /照合済みにしました。QuickBooks：未転送（名前を変える待ちです/);
  assert.match(msg, /送り元の Gmail がつながっていない/); assert.equal(kind, 'warning');
  assert.equal(c.I.doc, null, 'the next one opens');
  // sent right away: success
  states = { enabled: true, route: 'invoice-intake', states: { [id(5)]: { state: 'sending', id: 'q5' } } }; rec = { ok: true, version: 3, qb: { queued: 1, sending: true } };
  c.I.doc = { doc: D }; c.I.docId = D.id; c.I.edits = {};
  await c.fn("invInReconcile('reconciled')");
  [msg, kind] = c.toasts.at(-1);
  assert.equal(msg, '照合済みにしました。QuickBooks：処理中'); assert.equal(kind, 'success');
  // 差異あり: what had not started is stopped; what was being sent could not be
  rec = { ok: true, version: 4, qb_stopped: 2, qb_busy: 1, qb_stop_requested: 1, qb_kept_out: 0 };
  c.I.doc = { doc: D }; c.I.docId = D.id; c.I.edits = { note: '数量が違う' };
  await c.fn("invInReconcile('discrepancy')");
  [msg, kind] = c.toasts.at(-1);
  assert.match(msg, /差異ありにしました。まだ送っていなかった 2 件を止めました（照合済みに戻すとまた送ります）。1 件はもう送る途中です。まだ送っていなければ止めます。送り終わっていたら送信済みとして残ります（取下げ・訂正は QuickBooks で/);
  assert.ok(!/止められません/.test(msg), 'the stop is asked, not given up');
  assert.equal(kind, 'warning');
  const last = c.calls.filter(b => b.action === 'reconcile').at(-1);
  assert.deepEqual([last.result, last.note], ['discrepancy', '数量が違う']);
  // nothing in the ledger yet (the ledger off, a rename waiting): kept out, said plainly; nothing being sent → no warning
  rec = { ok: true, version: 5, qb_stopped: 0, qb_busy: 0, qb_stop_requested: 0, qb_kept_out: 1 };
  c.I.doc = { doc: D }; c.I.docId = D.id; c.I.edits = {};
  await c.fn("invInReconcile('unreconciled')");
  [msg, kind] = c.toasts.at(-1);
  assert.equal(msg, '未照合に戻しました。まだ台帳に積んでいなかったので、台帳に積まないようにしました（照合済みに戻すと送ります）'); assert.equal(kind, 'success');
  // a conflict: no toast of success, the invoice stays open
  rec = { status: 409, error: 'conflict' };
  c.I.doc = { doc: D }; c.I.docId = D.id; c.I.edits = {};
  const n = c.toasts.length;
  await c.fn("invInReconcile('reconciled')");
  assert.equal(c.toasts.length, n + 1); assert.equal(c.toasts.at(-1)[1], 'warning'); assert.ok(c.I.doc, 'still open');
});

test('もう一度送る: the server decides; refused says why; the states are read again', async () => {
  let ans = { ok: true, sending: true };
  const c = app({ api: async b => (b.action === 'qb_retry' ? ans : { ok: true }) });
  c.I.qbst = { x: { state: 'failed' } }; c.I.qbGen = 3; c.I.loaded = { reconqb: 1, listqb: 1, qbs: 1, doc: 1, qbun: 1 };
  await c.fn("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000001')");
  assert.deepEqual(c.calls.at(-1), { action: 'qb_retry', id: 'bbbbbbbb-0000-4000-8000-000000000001' });
  assert.equal(c.toasts.at(-1)[0], 'もう一度送る予約をしました');
  assert.deepEqual(Object.keys(c.fn('_invIn.qbst')), []); assert.equal(c.I.qbGen, 4);
  for (const k of ['reconqb', 'listqb', 'qbs', 'doc', 'qbun']) assert.ok(!(k in c.I.loaded), k);
  ans = { ok: false, why: 'not_reconciled' };
  await c.fn("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000001')");
  assert.deepEqual(c.toasts.at(-1), ['送り直していません：照合済みでないので送り直しません（照合済みにすると送ります）', 'warning']);
  const v = app({ role: 'am' });
  await v.fn("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000001')");
  assert.equal(v.calls.length, 0, 'a role that cannot act does not call');
});

test('状態の読み込み: an answer that arrives after a reload is not written; 200 at a time; ids once', async () => {
  let open;
  const c = app({ api: b => (b.action === 'qb_doc_states' ? new Promise(r => { open = () => r({ enabled: true, route: 'invoice-intake', states: Object.fromEntries(b.doc_ids.map(i => [i, { state: 'sent' }])) }); }) : { ok: true }) });
  const p = c.fn(`invInQbStates(['${id(1)}','${id(1)}','${id(2)}'])`);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(c.calls[0].doc_ids, [id(1), id(2)]);
  c.fn('invInQbReload()');
  open(); await p;
  assert.deepEqual(Object.keys(c.fn('_invIn.qbst')), [], 'a stale answer is dropped');
  const many = Array.from({ length: 450 }, (_, i) => id(100 + i));
  const d = app({ api: b => ({ enabled: true, route: 'invoice-intake', states: Object.fromEntries(b.doc_ids.map(i => [i, { state: 'queued' }])) }) });
  await d.fn(`invInQbStates(${JSON.stringify(many)})`);
  assert.deepEqual(d.calls.map(b => b.doc_ids.length), [200, 200, 50]);
  assert.equal(Object.keys(d.fn('_invIn.qbst')).length, 450); assert.equal(d.I.qbRoute, 'invoice-intake'); assert.equal(d.I.qbEnabled, true);
  // the safe reader keeps the error to show
  const e = app({ api: () => ({ status: 500, error: 'down' }) });
  await e.fn(`invInQbStatesSafe(['${id(1)}'])`);
  assert.equal(e.I.qbstErr, 'down');
});

test('照合済みだが未転送 (B-3-4): causes known and not known apart; buttons only where this system can act; escaped; no bulk resend', () => {
  const c = app();
  const hist = (o) => ({ id: 'bbbbbbbb-0000-4000-8000-000000000099', state: 'error', route: 'invoice-intake', attempts: 5, created_at: '2026-11-20T19:00:00Z', ...o });
  c.I.qbun = { from: '2026-10-01', to_set: true, count: 5, enabled: true, route: 'invoice-intake', rows: [
    { doc_id: id(1), vendor: '<i>Fresh</i>', store_id: 'F06', invoice_no: 'A1', invoice_date: '2026-11-02', total_cents: 5000, recon_by: 'Akane', recon_at: '2026-11-03T01:00:00Z', reason: 'failed', confirmed: true, history: [hist({ id: 'bbbbbbbb-0000-4000-8000-000000000002' })], drive_file_id: 'd1', pages: 1 },
    { doc_id: id(2), vendor: 'Ext', reason: 'failed', confirmed: true, history: [hist({ id: 'bbbbbbbb-0000-4000-8000-000000000003', route: 'external' })] },
    { doc_id: id(3), vendor: 'Unk', reason: 'unknown', confirmed: false, history: [hist({ id: 'bbbbbbbb-0000-4000-8000-000000000004', state: 'unknown' })] },
    { doc_id: id(4), vendor: 'None', reason: 'not_in_ledger', confirmed: false, history: [] },
    { doc_id: id(5), vendor: 'Back', reason: 'cancelled_recon_cancelled', confirmed: true, history: [hist({ id: 'bbbbbbbb-0000-4000-8000-000000000005', state: 'cancelled', last_error: 'recon_cancelled' })], pages: 3 },
  ] };
  const h = c.fn('invInQbUnsentCard()');
  assert.ok(h.includes('&lt;i&gt;Fresh&lt;/i&gt;') && !h.includes('<i>Fresh</i>'));
  assert.ok(h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000002')") && h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000005')"));
  assert.ok(!h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000003')"), 'the forwarder before is not retried from here');
  assert.ok(h.includes("invInQbLookup('bbbbbbbb-0000-4000-8000-000000000004')"));
  assert.match(text(h), /原因が分かっているもの 3 件/); assert.match(text(h), /送ったか分からないもの 2 件/);
  assert.match(text(h), /このシステムの台帳には送信済みの記録がありません。前の転送（ChatGPT）や手で QuickBooks に入れたかは、ここでは分かりません/);
  assert.match(text(h), /まとめて送り直すボタンはありません/);
  assert.match(text(h), /ページ 3/);
  assert.equal((h.match(/invInQbRetry\(/g) || []).length, 2);
  assert.doesNotMatch(text(h), /照合の古い順に先頭の/, 'all of them are shown');
  // Paged by the server (#217 routine review): the screen says only the oldest are shown.
  c.I.qbun = { ...c.I.qbun, count: 240, limit: 200, more: true };
  assert.match(text(c.fn('invInQbUnsentCard()')), /照合の古い順に先頭の 5 件を出しています（ほか 235 件。先頭の分を片づけると出ます）/);
  c.I.qbun = { error: '<x>' };
  assert.match(c.fn('invInQbUnsentCard()'), /読めませんでした（&lt;x&gt;）/);
  c.I.qbun = { from: '2026-10-01', rows: [], count: 0 };
  assert.match(c.fn('invInQbUnsentCard()'), /ありません/);
  assert.equal(app({ role: 'am' }).fn('invInQbUnsentCard()'), '');
});

test('取込状況のカード: the reason a row was not sent, 「もう一度送る」 only on a failed row of this system', () => {
  const c = app();
  const row = o => ({ id: 'bbbbbbbb-0000-4000-8000-000000000098', route: 'invoice-intake', state: 'error', attempts: 2, next_at: '2026-11-23T20:00:00Z', last_error: 'drive_download_failed', created_at: '2026-11-23T19:00:00Z', store_id: 'F06', current_name: 'n.pdf', drive_file_id: 'F', ...o });
  c.I.qbs = { counts: {}, stopped: 0, rows: [row({ id: 'bbbbbbbb-0000-4000-8000-000000000006' }), row({ id: 'bbbbbbbb-0000-4000-8000-000000000007', route: 'external' }), row({ id: 'bbbbbbbb-0000-4000-8000-000000000008', state: 'cancelled', last_error: 'recon_cancelled' }), row({ id: 'bbbbbbbb-0000-4000-8000-000000000009', state: 'cancelled', last_error: 'merge_changed' })],
    gmail: { status: 'ok' }, qb: { route: 'invoice-intake', enabled: true } };
  const h = c.fn('invInQbCard({ qb_settings:{} }, null)');
  assert.ok(h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000006')")); assert.ok(!h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000007')"));
  assert.match(h, /照合を取り消した（送っていない）/); assert.match(h, /照合を取り消したので送っていません（照合済みに戻すとまた送ります）/);
  assert.match(h, /台帳に積んだあとページが変わった（送っていない）/);
  assert.ok(!app({ role: 'am' }).fn("(function(){ _invIn.qbs = " + JSON.stringify(c.I.qbs) + "; return invInQbCard({ qb_settings:{} }, null); })()").includes('invInQbRetry'));
});

test('複数枚の invoice: with this system as the sender, one PDF in one mail; with the forwarder before, the texts as before', () => {
  const c = app();
  const G = (o = {}) => ({ doc: { id: id(7), status: 'posted', part_no: 1, version: 2, ...o }, file: { drive_file_id: 'f1', current_name: 'p1.pdf' },
    parts: [{ part_no: 2, drive_file_id: 'f2', current_name: 'p2.pdf', qb_state: null }, { part_no: 3, drive_file_id: 'f3', current_name: 'p3.pdf', qb_state: null }], qb: [] });
  // the forwarder before (or not decided): as before
  assert.match(c.fn("invInQbChip(null, 2, 'posted')"), /複数枚：転送側の対応待ち/);
  assert.match(c.fn(`invInPartsHtml(${JSON.stringify(G())})`), /転送側（ChatGPT）が対応するまで台帳に出しません/);
  c.I.qbRoute = 'external';
  assert.match(c.fn("invInQbChip(null, 2, 'posted')"), /複数枚：転送側の対応待ち/);
  // this system
  c.I.qbRoute = 'invoice-intake';
  assert.match(c.fn("invInQbChip(null, 2, 'posted')"), /複数枚：まだ台帳にありません（1 通で送ります）/);
  let h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /全ページを、ページの順に 1 つの PDF にして 1 通で送ります/); assert.ok(!/ChatGPT/.test(h));
  c.I.qbst = { [id(7)]: { state: 'sent', combined: true, sent_at: '2026-11-23T20:00:00Z', pages: 3 } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /全ページを、ページの順に 1 つの PDF にして送りました/);
  c.I.qbst = { [id(7)]: { state: 'not_sent', why: 'part_already_sent', pages: 3 } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /ページの一部をもう送っています/); assert.match(h, /invInQbManualAsk\(\)/); assert.ok(!/1 つの PDF にして 1 通で送ります/.test(h));
  c.I.qbst = { [id(7)]: { state: 'not_sent', why: 'rename_waiting', pages: 3 } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /名前を変える待ちです[\s\S]*1 つの PDF にして 1 通で送ります/); assert.ok(!/invInQbManualAsk/.test(h));
  // never settles by itself (B-3 review P2-2): a page's original changed / 5 tries used (e.g. the PDF could not be joined) → recorded by hand
  c.I.qbst = { [id(7)]: { state: 'not_sent', why: 'part_changed', pages: 3 } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /ページの原本の中身が、読んだときから変わっています/); assert.match(h, /invInQbManualAsk\(\)/); assert.ok(!/1 つの PDF にして 1 通で送ります/.test(h));
  c.I.qbst = { [id(7)]: { state: 'failed', stopped: true, attempts: 5, last_error: 'pdf_join_failed', pages: 3, can_retry: true, id: 'q7' } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.match(h, /やり直し 5 回を使い切りました/); assert.match(h, /自動ではもう送りません/); assert.match(h, /invInQbManualAsk\(\)/);
  c.I.qbst = { [id(7)]: { state: 'failed', stopped: false, attempts: 2, last_error: 'pdf_join_failed', pages: 3, can_retry: true, id: 'q7' } };
  h = c.fn(`invInPartsHtml(${JSON.stringify(G())})`);
  assert.ok(!/invInQbManualAsk/.test(h), 'still tried again by itself'); assert.ok(!/自動ではもう送りません/.test(h));
  // the merge screens' texts follow the sender too (the source carries both)
  assert.ok(html.includes("invInQbRoute()==='invoice-intake' ? t('足したページと合わせ、ページの順に 1 つの PDF にして 1 通で送ります"));
  assert.ok(html.includes("QuickBooks：複数枚の invoice は、ページの順に 1 つの PDF にして 1 通で送ります"));
  assert.ok(html.includes('QuickBooks：複数枚の invoice は、転送側（ChatGPT）の対応が済むまで台帳に出しません'), 'the old text stays for the forwarder before');
});

test('1 件の画面: the forwarding block uses the six words once the state is read; buttons follow can_retry', () => {
  const c = app();
  const G = { doc: { id: id(8), status: 'posted' }, qb: [{ id: 'bbbbbbbb-0000-4000-8000-000000000010', state: 'sent', message_id: '18f3<script>', route: 'invoice-intake' }] };
  c.I.qbst = { [id(8)]: { state: 'sent', id: 'bbbbbbbb-0000-4000-8000-000000000010', sent_at: '2026-11-23T20:00:00Z' } };
  let h = c.fn(`invInQbBlock(${JSON.stringify(G)})`);
  assert.match(h, /転送成功/); assert.match(h, /Gmail ID[\s\S]*18f3&lt;script&gt;/); assert.match(h, /QuickBooks での取り込みは QuickBooks で確かめてください/);
  c.I.qbst = { [id(8)]: { state: 'failed', id: 'bbbbbbbb-0000-4000-8000-000000000010', can_retry: true, attempts: 5, stopped: true, last_error: 'drive_download_failed' } };
  h = c.fn(`invInQbBlock(${JSON.stringify(G)})`);
  assert.ok(h.includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000010')"));
  c.I.qbst = { [id(8)]: { state: 'failed', id: 'bbbbbbbb-0000-4000-8000-000000000010', can_retry: false } };
  assert.ok(!c.fn(`invInQbBlock(${JSON.stringify(G)})`).includes('invInQbRetry'));
  c.I.qbst = { [id(8)]: { state: 'not_sent', why: 'cancelled_recon_cancelled', cancelled_id: 'bbbbbbbb-0000-4000-8000-000000000012', can_retry: true } };
  assert.ok(c.fn(`invInQbBlock(${JSON.stringify(G)})`).includes("invInQbRetry('bbbbbbbb-0000-4000-8000-000000000012')"));
  c.I.qbst = { [id(8)]: { state: 'unknown', id: 'bbbbbbbb-0000-4000-8000-000000000011' } };
  h = c.fn(`invInQbBlock(${JSON.stringify(G)})`);
  assert.ok(h.includes("invInQbLookup('bbbbbbbb-0000-4000-8000-000000000011')") && h.includes("invInQbResolve('bbbbbbbb-0000-4000-8000-000000000011','pending')"));
  // not read yet (or a role that cannot read): the block as before
  c.I.qbst = {};
  assert.ok(!/転送成功/.test(c.fn(`invInQbBlock(${JSON.stringify(G)})`)));
});

test('the page wires it in: 照合待ち uses the table, the list reads the states of posted rows, Intake status shows the unsent card, logout clears', () => {
  assert.match(html, /if \(kind==='recon'\) return invInReconTable\(Q\);/);
  assert.match(html, /invInLoad\('reconqb', function\(\)\{ return invInQbStatesSafe\(/);
  assert.match(html, /invInLoad\('listqb', function\(\)\{ return invInQbStatesSafe\(/);
  assert.match(html, /invInLoad\('qbun', async function\(\)\{ try \{ _invIn\.qbun = await invInAPI\(\{ action:'qb_unsent' \}\)/);
  assert.match(html, /h \+= invInQbUnsentCard\(\);[^\n]*\n  h \+= invInQbCard\(H, P\);/);
  assert.match(html, /_invIn\.qbst = \{\}; _invIn\.qbRoute = null; _invIn\.qbEnabled = null; _invIn\.qbstErr = ''; _invIn\.qbun = null; _invIn\.rsel = \{\}; _invIn\.reconRes = null; _invIn\.reconPlan = null; _invIn\.rbatch = null;/);
  assert.match(html, /invInQbCell\(r\)/);
  assert.ok(!/action:'qb_send'|action:"qb_send"/.test(MOD), 'the screen never asks to send directly');
});

// ---------------------------------------------------------------------------------------------- end to end (real handler, PGlite)
const harnessUrl = new URL('./invoice-qb-gmail.test.mjs', import.meta.url);
async function harness() {
  const { PDFDocument } = await import(process.env.INVOICE_PDFLIB_MODULE || './runtime/node_modules/pdf-lib/cjs/index.js');
  const hsrc = fs.readFileSync(harnessUrl, 'utf8');
  const hcut = hsrc.indexOf("test('(10) the mail");
  assert.ok(hcut > 0);
  const htmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-qb-reconcile-ui-'));
  try {
    const file = path.join(htmp, 'harness.mjs');
    fs.writeFileSync(file, hsrc.slice(0, hcut)
      .replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, q, rel) => JSON.stringify(new URL(rel, harnessUrl).href))
      .replace(/import\.meta\.url/g, JSON.stringify(harnessUrl.href))
      + '\nexport { env0, docsOf };\n');
    const H = await import(pathToFileURL(file).href);
    return { ...H, PDFDocument };
  } finally { fs.rmSync(htmp, { recursive: true, force: true }); }
}

test('end to end (事務Crew): posted while the ledger was off → chosen in 照合待ち → reconciled together → sent once each; one not saved; the unsent list', async () => {
  const H = await harness();
  const X = await H.env0({ deps: { PDFDocument: H.PDFDocument } });
  try {
    await X.q('update invoice_stores set auto_post=false');
    await X.q(`update invoice_settings set value=value||'{"enabled":false}'::jsonb where key='qb'`);
    const ids = [];
    for (const [tag, no] of [['UI-1', '9101'], ['UI-2', '9102'], ['UI-3', '9103']]) {
      const r = await X.review(tag, no);
      const p = await X.post(r.doc); assert.equal(p.status, 200, JSON.stringify(p.body));
      ids.push(r.id);
    }
    await X.settle();
    await X.q(`update invoice_settings set value=value||'{"enabled":true}'::jsonb where key='qb'`);
    const c = app({ token: 'tok-crew', fetchFn: async (url, init) => {
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await X.api(init.headers.Authorization.slice(7), body);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    } });
    // 照合待ち as the crew sees it
    await c.fn("invInLoadQueue('recon')");
    const rows = c.I.recon.rows;
    const mine = await Promise.all(ids.map(async i => (await H.docsOf(X, i))[0].id));
    assert.deepEqual(mine.map(d => rows.some(r => r.id === d)), [true, true, true]);
    await c.fn(`invInQbStates(${JSON.stringify(mine)})`);
    assert.deepEqual(mine.map(d => c.I.qbst[d].state), ['not_sent', 'not_sent', 'not_sent']);
    assert.equal(c.I.qbRoute, 'invoice-intake');
    const h = c.fn('invInReconTable(_invIn.recon)');
    for (const d of mine) assert.ok(h.includes(`invInReconToggle('${d}'`));
    assert.match(h, /未転送/);
    // choose them, ask; someone changes the third before the save (its version is older now)
    for (const d of mine) c.fn(`invInReconToggle('${d}', true)`);
    c.fn('invInReconAsk()');
    const late = c.I.reconPlan.find(x => x.id === mine[2]); assert.ok(late, 'the third is in the plan'); late.version -= 1;
    await c.fn('invInReconBulk()');
    const R1 = c.I.reconRes;
    assert.equal(R1.total, 3); assert.equal(R1.saved.length, 2); assert.equal(R1.failed.length, 1);
    await X.settle();
    await c.fn('invInReconResCheck()');
    const m = text(c.modals.at(-1));
    assert.match(m, /選んだ件数3/); assert.match(m, /照合済みにできた（保存成功）2/); assert.match(m, /保存できなかった1/); assert.match(m, /転送成功2/);
    assert.deepEqual(ids.map(i => X.sentFor(i)), [1, 1, 0]);
    // pressing again for the two that went: nothing is sent twice (they are not in 照合待ち any more)
    await c.fn("invInLoadQueue('recon')");
    assert.ok(!c.I.recon.rows.some(r => r.id === mine[0] || r.id === mine[1]));
    // the one not saved is still waiting; reconciled now (one invoice), it is sent once
    c.I.doc = { doc: (await H.docsOf(X, ids[2]))[0] }; c.I.docId = mine[2]; c.I.edits = {};
    await c.fn("invInReconcile('reconciled')");
    assert.match(c.toasts.at(-1)[0], /照合済みにしました。QuickBooks：(転送待ち|処理中|転送成功)/);
    await X.settle();
    assert.deepEqual(ids.map(i => X.sentFor(i)), [1, 1, 1]);
    // 照合済みだが未転送: none of these three (all sent); the list itself sends nothing
    const before = X.qbSent().length;
    c.I.qbun = await c.fn("invInAPI({ action:'qb_unsent' })");
    const card = c.fn('invInQbUnsentCard()');
    for (const d of mine) assert.ok(!card.includes(`invInOpen('${d}'`));
    assert.equal(X.qbSent().length, before);
  } finally { await X.pg.close(); }
});
