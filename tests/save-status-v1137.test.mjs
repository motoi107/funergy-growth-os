// v1137（全体アップデート指示・決めてほしいこと 12・UI案69 ⑨）：保存・同期・診断の状態と、実際と合わない「保存しました」の直し。
// index.html の本物のコードを VM で動かして、判定の決まりを確かめる。ネットワーク・本番のデータは使わない（合成の値だけ）。
// ブラウザでの見え方（右上の 3 つ・押したときの中身・「診断と記録」・オフライン・自動の同期）は tests/perf/status-check.mjs（模擬サーバー）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = src => src.replace(/\r\n/g, '\n');
const html = read(fs.readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8'));
const sw = read(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'));

function fnFrom(name) {
  let start = html.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = html.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  return html.slice(start + 1, html.indexOf('\n}', start + 1) + 2);
}
function varLine(prefix) {
  const i = html.indexOf('\n' + prefix);
  assert.ok(i >= 0, prefix);
  return html.slice(i + 1, html.indexOf('\n', i + 1));
}
function uxBlock() {
  const a = html.indexOf('/* ============================================================\n   v1127：操作感の共通の決まり（FUNERGY_UX）');
  const b = html.indexOf('</script>', a);
  assert.ok(a > 0 && b > a);
  return html.slice(a, b);
}
function statusBlock() {
  const a = html.indexOf('/* ==== FUNERGY_STATUS（v1137）');
  const b = html.indexOf('/* ==== FUNERGY_STATUS end ==== */', a);
  assert.ok(a > 0 && b > a, 'FUNERGY_STATUS block');
  return html.slice(a, b);
}
/* localStorage の代わり。full=true なら書けない（端末の localStorage がいっぱいの端末） */
function fakeStorage(full) {
  const m = new Map();
  const st = {
    full: !!full, map: m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (st.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
  return st;
}
function ctxOf(extra) {
  const ctx = Object.assign({ window: {}, Date, JSON, Math, Object, Array, String, Number, Promise, Map, Set, RegExp, Error, console, setTimeout: uSetTimeout, clearTimeout }, extra || {});
  vm.createContext(ctx);
  return ctx;
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 0));
/* 試験の中で止まらない時計（アプリの待ち時間のタイマーで試験が終わらなくならないように） */
const uSetTimeout = (fn, ms) => { const h = setTimeout(fn, ms); if (h && h.unref) h.unref(); return h; };
const J = x => JSON.parse(JSON.stringify(x));   // VM の中の値を比べられる形に

/* ---------------------------------------------------------------- 送信待ちの列（op_outbox） */
const OUTBOX = () => [varLine('var _outboxMem = null'), fnFrom('_outboxParse'), fnFrom('_outboxGet'), fnFrom('_outboxSet')].join('\n');
function outboxCtx(storage, idbMem) {
  const queued = [];
  const ctx = ctxOf({ localStorage: storage, _idbState: idbMem ? 'ready' : 'unavailable', _IDB_MEM: idbMem || null,
    _idbQueue: (k, j) => { queued.push([k, j]); if (!idbMem) return false; if (j === null) idbMem.delete(k); else idbMem.set(k, j); return true; },
    _lsFreeOldLaborKeys: () => { ctx.freed = (ctx.freed || 0) + 1; } });
  ctx.queued = queued;
  vm.runInContext(OUTBOX(), ctx);
  return ctx;
}

test('送信待ち：localStorage に書けるときは前と同じ（localStorage だけ・IndexedDB の別の名前は使わない）', () => {
  const ls = fakeStorage(false), idb = new Map();
  const c = outboxCtx(ls, idb);
  assert.equal(c._outboxSet([{ key: 'a', attempts: 1 }]), true);
  assert.deepEqual(JSON.parse(ls.getItem('op_outbox')), [{ key: 'a', attempts: 1 }]);
  assert.equal(c.queued.length, 0, 'IndexedDB には書かない');
  assert.deepEqual(J(c._outboxGet().map(x => x.key)), ['a']);
  ls.setItem('op_outbox', JSON.stringify([{ key: 'b' }]));   // ほかの所（売上・予算の保護の試験など）が localStorage を直接読み書きしても、そのまま読む
  assert.deepEqual(J(c._outboxGet().map(x => x.key)), ['b']);
});

test('送信待ち：localStorage がいっぱいでも捨てない（前は黙って捨て、右上は「保存済み」のままだった）', () => {
  const ls = fakeStorage(true), idb = new Map();
  const c = outboxCtx(ls, idb);
  assert.equal(c._outboxSet([{ key: 'inv_X', attempts: 1, who: 'p:e1' }]), false);
  assert.equal(c.freed, 1, '古い月の勤怠の写しを空けてもう 1 回試す（lsSet と同じ）');
  assert.deepEqual(J(c._outboxGet().map(x => x.key)), ['inv_X'], 'このタブでは覚えている');
  assert.ok(c.window._outboxLsFail > 0, '診断に出す印');
  assert.ok(idb.has('op_outbox_overflow'), 'IndexedDB の別の名前に持つ');
  // 読み込み直した（新しいタブ）：localStorage は前の値（空）のまま。IndexedDB の別の名前を読む
  const c2 = outboxCtx(ls, idb);
  assert.deepEqual(J(c2._outboxGet().map(x => x.key)), ['inv_X']);
  // 空きができて書けた：localStorage に書き、別の名前とメモリは消す
  ls.full = false;
  assert.equal(c2._outboxSet([]), true);
  assert.equal(idb.has('op_outbox_overflow'), false);
  assert.deepEqual(J(c2._outboxGet()), []);
  assert.equal(c2.window._outboxLsFail, 0);
  assert.deepEqual(J(outboxCtx(ls, idb)._outboxGet()), [], '次のタブも空');
});

test('送信待ち：IndexedDB も使えない端末では、このタブのあいだだけ覚える', () => {
  const ls = fakeStorage(true);
  const c = outboxCtx(ls, null);
  c._outboxSet([{ key: 'k' }]);
  assert.deepEqual(J(c._outboxGet().map(x => x.key)), ['k']);
});

/* ---------------------------------------------------------------- この端末だけの小さな記録・直した時刻 */
test('小さな記録（シフト・本人確認の情報の送信待ちの印）：書けなくてもこのタブでは覚える・書けたら localStorage に戻る', () => {
  const ls = fakeStorage(true);
  const c = ctxOf({ localStorage: ls });
  vm.runInContext([varLine('var _SMALL_MEM = {}'), fnFrom('_smallGet'), fnFrom('_smallSet')].join('\n'), c);
  assert.equal(c._smallSet('_shiftplan_pending', '[1]'), false);
  assert.equal(c._smallGet('_shiftplan_pending'), '[1]');
  assert.ok(c.window._smallLsFail > 0);
  ls.full = false;
  assert.equal(c._smallSet('_shiftplan_pending', null), true);
  assert.equal(c._smallGet('_shiftplan_pending'), null);
  assert.equal(c.window._smallLsFail, 0, '覚えているものが無くなったら印を消す');
});

test('直した時刻（v1136）：書けなくてもこのタブでは覚える（送信待ちのあいだの取り込みで手元を残せる）', () => {
  const ls = fakeStorage(true);
  const c = ctxOf({ localStorage: ls, isOpSyncKey: () => true, _opMergeDef: () => null, _cjson: x => JSON.stringify(x) });
  vm.runInContext([varLine('var PEND_EDIT_KEY'), varLine('var _pendEditMem = null'), fnFrom('_pendEditAtRaw'), fnFrom('_pendEditAtSetRaw'), fnFrom('_pendEditAtAll'), fnFrom('_pendEditAtMark'), fnFrom('_pendEditAtDrop')].join('\n'), c);
  c._pendEditAtMark('evaluations', '{"a":1}', '{"a":2}');
  assert.ok(Number(c._pendEditAtAll().evaluations) > 0);
  c._pendEditAtDrop('evaluations');
  assert.deepEqual(J(c._pendEditAtAll()), {});
  // ふだん（書ける）は localStorage に
  const ls2 = fakeStorage(false), c2 = ctxOf({ localStorage: ls2, isOpSyncKey: () => true, _opMergeDef: () => null, _cjson: x => JSON.stringify(x) });
  vm.runInContext([varLine('var PEND_EDIT_KEY'), varLine('var _pendEditMem = null'), fnFrom('_pendEditAtRaw'), fnFrom('_pendEditAtSetRaw'), fnFrom('_pendEditAtAll'), fnFrom('_pendEditAtMark')].join('\n'), c2);
  c2._pendEditAtMark('evaluations', '{"a":1}', '{"a":2}');
  assert.ok(JSON.parse(ls2.getItem('_pend_edit_at')).evaluations > 0);
});

test('グレードの一緒の保存（ghTxn）は直した時刻を _pendEditAtRaw／_pendEditAtSetRaw で覚えて戻す', () => {
  const b = fnFrom('ghTxnBegin'), e = fnFrom('ghTxnEnd');
  assert.match(b, /_pendEditAtRaw\(\)/);
  assert.match(e, /_pendEditAtSetRaw\(tx\.pendAt\)/);
});

/* ---------------------------------------------------------------- シフトの表（shift_plans） */
function shiftCtx() {
  const ls = fakeStorage(false), notifs = [], posts = [];
  let postOk = false, postGate = null;
  const c = ctxOf({ localStorage: ls, _supaBooting: false, STORES: [{ id: 'F01', name: '店A' }], t: (ja) => ja,
    addNotif: n => notifs.push(n), getShiftPlan: () => ({ status: '下書き', cells: { mon_L_1: 'A' } }),
    SUPABASE_URL: 'https://x.invalid', supaHeaders: () => ({}), _lsWriteVerified: () => true,
    fetch: async () => { c.fetched = (c.fetched || 0) + 1; return { ok: true, json: async () => [] }; } });
  vm.runInContext([varLine('var _SMALL_MEM = {}'), fnFrom('_smallGet'), fnFrom('_smallSet'), varLine('var SHIFTPLAN_PENDING_KEY'),
    fnFrom('shiftPlanPendingList'), fnFrom('_shiftPlanPendingSet'), fnFrom('shiftPlanPendingOf'), fnFrom('_shiftPlanPendingAdd'), fnFrom('_shiftPlanPendingDone'),
    fnFrom('shiftPlanLabel'), fnFrom('pushShiftPlan'), varLine('var _shiftRetryBusy'), fnFrom('retryShiftPlanPending'), fnFrom('shiftPlanNotifyPublished'), fnFrom('pullShiftPlan')].join('\n'), c);
  c._shiftPlanPost = async (s, w, plan) => { posts.push([s, w, plan]); if (postGate) await postGate; return postOk; };
  return { c, ls, notifs, posts, setOk: v => { postOk = v; }, gate: p => { postGate = p; } };
}

test('シフト：送れなかったら送信待ち（\'deferred\'）・読み込みでは端末の値を上書きしない・送れたら公開の知らせ（1 回）', async () => {
  const S = shiftCtx();
  S.setOk(false);
  assert.equal(await S.c.pushShiftPlan('F01', '11/1', { cells: {} }, true, { notify: true }), 'deferred');
  assert.deepEqual(J(S.c.shiftPlanPendingList().map(x => [x.s, x.w, x.notify])), [['F01', '11/1', 1]]);
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), 'pending', '送れていない変更があるあいだはクラウドの値で上書きしない');
  assert.equal(S.c.fetched || 0, 0);
  await tick(10);   // 読み込みのときの送り直し（まだつながらない）が終わるのを待つ
  assert.equal(S.c.shiftPlanPendingList().length, 1);
  S.setOk(true);
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.deepEqual(J(S.c.shiftPlanPendingList()), []);
  assert.equal(S.notifs.filter(n => n.title === 'シフトが公開されました').length, 1, '送れたときに 1 回知らせる');
  assert.equal(await S.c.retryShiftPlanPending(), 0);
  assert.equal(S.notifs.length, 1);
});

test('シフト：前に送り始めた送信が成功しても、そのあとの保存の送信待ちは消さない', async () => {
  const S = shiftCtx();
  let open; S.gate(new Promise(r => { open = r; }));
  S.setOk(true);
  const p = S.c.pushShiftPlan('F01', '11/1', { cells: { a: 1 } }, true);
  await tick(5);
  S.c._shiftPlanPendingAdd('F01', '11/1', false);   // 送っているあいだに、別の保存が送れなかった
  open(); assert.equal(await p, true);
  assert.equal(S.c.shiftPlanPendingList().length, 1, 'あとの保存は送信待ちに残る');
});

test('シフト：画面を描くたびに送り直さない（15 秒あける）', async () => {
  const S = shiftCtx();
  S.setOk(false);
  await S.c.pushShiftPlan('F01', '11/1', { cells: {} }, true);
  const n0 = S.posts.length;
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  assert.equal(S.posts.length - n0, 1);
});

test('シフトの公開：届いてから「公開しました」と知らせ。届かなければ「まだ送れていません」・知らせない', () => {
  const f = fnFrom('publishShiftPlan');
  assert.match(f, /pushShiftPlan\(storeId, week, plan, true, \{ notify:true \}\)/);
  assert.match(f, /if\(r === true\)\{ shiftPlanNotifyPublished\(storeId, week\); showToast\('シフトを公開しました'/);
  assert.match(f, /まだ送れていません/);
  assert.doesNotMatch(f.slice(0, f.indexOf('return Promise.resolve(_pp)')), /addNotif\(/, '届く前に知らせない');
});

/* ---------------------------------------------------------------- 給与と連絡先（emp-private） */
async function empPriv(resp) {
  const tracked = [];
  const c = ctxOf({ window: { _sessionPin: '1', FUNERGY_UX: { _track: (k, p, o) => tracked.push([k, o]) } }, curUserName: 'GM', curRole: 'gm', t: ja => ja,
    SUPABASE_URL: 'https://x.invalid', supaHeaders: () => ({}), fetch: async () => { if (resp === 'throw') throw new Error('net'); return resp; } });
  c.window.window = c.window; c.FUNERGY_UX = c.window.FUNERGY_UX;   // ブラウザでは window と全体が同じ
  vm.runInContext(fnFrom('_empPrivOk') + '\n' + fnFrom('saveEmpPrivate'), c);
  const r = await c.saveEmpPrivate('e1', 20, 'x@example.invalid', '0', null);
  return { r, tracked, c };
}
test('給与と連絡先：答えを見る（前は送れなくても「従業員情報を更新しました」）', async () => {
  assert.equal((await empPriv({ ok: true, json: async () => ({ ok: true }) })).r, true);
  assert.equal((await empPriv({ ok: false, status: 500, json: async () => ({}) })).r, 'failed');
  assert.equal((await empPriv({ ok: true, json: async () => ({ ok: false, error: 'x' }) })).r, 'failed', 'HTTP は成功でも ok:false');
  assert.equal((await empPriv('throw')).r, 'failed');
  const t = await empPriv({ ok: true, json: async () => ({ ok: true }) });
  assert.equal(t.tracked[0][0], 'emp_private_e1');
  assert.equal(t.tracked[0][1].direct, true);
  assert.equal(typeof t.tracked[0][1].retry, 'function', '「もう一度」で送れる');
});

/* ---------------------------------------------------------------- 本人確認の情報（ob-private） */
test('本人確認の情報：送れなかったら送信待ちに入れ、送れたら外す。提出は送れるまで止める', async () => {
  const ls = fakeStorage(false);
  let ok = false;
  const c = ctxOf({ localStorage: ls, t: ja => ja, obSecretOf: () => ({ ssn: 'x' }), authObPriv: async () => ({ ok }) });
  vm.runInContext([varLine('var _SMALL_MEM = {}'), fnFrom('_smallGet'), fnFrom('_smallSet'), varLine('var OB_SECRET_PENDING_KEY'), fnFrom('obSecretPendingList'), fnFrom('_obSecretPendingSet'), fnFrom('obPushSecret')].join('\n'), c);
  assert.equal(await c.obPushSecret({ id: 'o1', inviteToken: 't' }), 'deferred');
  assert.deepEqual(J(c.obSecretPendingList().map(x => x.id)), ['o1']);
  assert.ok(!/ssn/.test(ls.getItem('_ob_secret_pending') || ''), '送信待ちの印に中身は入れない');
  ok = true;
  assert.equal(await c.obPushSecret({ id: 'o1', inviteToken: 't' }), true);
  assert.deepEqual(J(c.obSecretPendingList()), []);
  const sub = fnFrom('obWizSubmit');
  assert.match(sub, /Promise\.resolve\(obPushSecret\(ob\)\)\.then/);
  assert.match(sub, /if \(r !== true\)\{ alert\(/, '送れなければ提出完了にしない');
  assert.match(sub, /本人確認の情報を送れませんでした/);
});

/* ---------------------------------------------------------------- 請求書の復旧 */
test('請求書の復旧：送れなかった店があれば「復旧しました」と出さない', async () => {
  const toasts = [];
  const c = ctxOf({ STORES: [{ id: 'F01', name: '店A' }, { id: 'F02', name: '店B' }], t: ja => ja, showToast: (m, k) => toasts.push([m, k]), openInvoiceDiag: () => {},
    ls: () => [{ storeId: 'F01' }, { storeId: 'F02' }, { storeId: 'F02' }], opMergePush: async k => k === 'spl_invoices_F01' });
  vm.runInContext(fnFrom('pushInvoicesAll') + '\n' + fnFrom('invRecoverAll'), c);
  const n = await c.invRecoverAll('2026-10');
  assert.equal(Number(n), 1);
  assert.deepEqual(J(n.failed), ['F02']);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], 'warning');
  assert.match(toasts[0][0], /送れなかった店があります（店B）/);
  assert.doesNotMatch(toasts[0][0], /復旧しました/);
});

/* ---------------------------------------------------------------- FUNERGY_UX（右上の「保存」） */
function uxEnv() {
  const listeners = {};
  const document = { readyState: 'loading', body: { appendChild() {} }, addEventListener(tp, fn) { (listeners[tp] = listeners[tp] || []).push(fn); },
    getElementById() { return null; }, querySelector() { return null; }, createElement() { return { style: {}, setAttribute() {}, classList: { add() {}, remove() {} } }; } };
  const store = new Map();
  const window = { addEventListener() {}, matchMedia: () => ({ matches: false }), scrollX: 0, scrollY: 0, confirm: () => true, alert: () => {}, prompt: () => '' };
  const ctx = Object.assign({ window, document, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout: uSetTimeout, clearTimeout, setInterval: () => 0, Promise, Date, JSON, Math, Object, Array, String, Number, Set, WeakMap, Map, RegExp, console, MutationObserver: function () { this.observe = () => {}; },
    getComputedStyle: () => ({ display: 'block' }), requestAnimationFrame: f => uSetTimeout(f, 0), navigator: { onLine: true } });
  vm.createContext(ctx);
  vm.runInContext(uxBlock(), ctx);
  return { ctx, UX: ctx.window.FUNERGY_UX, fire(tp) { (listeners[tp] || []).forEach(fn => fn({ isTrusted: true, target: {} })); } };
}

test('右上の「保存」：送信待ちを通らない保存（direct）が届かなければ「保存できなかったもの」・あとで届いたら消える', async () => {
  const E = uxEnv();
  E.fire('pointerdown');
  let res; const p = new Promise(r => { res = r; });
  E.UX._track('emp_private_e1', p, { direct: true, label: '給与・連絡先', retry: () => true });
  res('failed'); await tick(5);
  assert.deepEqual(J(E.UX.saveState()), { k: 'failed', n: 1 });
  assert.equal(E.UX.failedList()[0].label, '給与・連絡先');
  E.fire('pointerdown');
  E.UX._track('emp_private_e1', Promise.resolve(true), { direct: true }); await tick(5);
  assert.equal(E.UX.failedList().length, 0);
  assert.equal(E.UX.saveState().k, 'saved');
});

test('右上の「保存」：前の保存の失敗で、あとの保存の結果を上書きしない', async () => {
  const E = uxEnv();
  let r1; const p1 = new Promise(r => { r1 = r; });
  E.UX._track('k', p1, { direct: true });
  await tick(2);
  E.UX._track('k', Promise.resolve(true), { direct: true }); await tick(5);
  r1('failed'); await tick(5);
  assert.equal(E.UX.failedList().length, 0);
});

test('「保存しました」の待ち：届かなかった direct の保存は \'failed\'・確定しました／公開しました も待つ', async () => {
  let E = uxEnv();
  E.fire('pointerdown');
  E.UX._track('ob_secret_o1', Promise.resolve('failed'), { direct: true });
  assert.equal(await E.UX.saveWait('提出しました'), 'failed');
  E = uxEnv(); E.fire('pointerdown');
  E.UX._track('inv_F01', Promise.resolve(false));
  assert.equal(await E.UX.saveWait('棚卸を確定しました'), 'queued');
  E = uxEnv(); E.fire('pointerdown');
  E.UX._track('shiftplan_F01_11/1', Promise.resolve('deferred'), { direct: true });
  assert.equal(await E.UX.saveWait('シフトを公開しました'), 'queued');
  E = uxEnv(); E.fire('pointerdown');
  E.UX._track('inv_F01', Promise.resolve(true));
  assert.equal(await E.UX.saveWait('棚卸を確定しました'), 'ok', '届いたら「確定しました」');
});

test('確かめの画面（confirm）で答えるのに時間がかかっても、そのあとの保存はその人の操作として待つ', async () => {
  const E = uxEnv();
  assert.equal(E.ctx.window.confirm._uxWrapped, true);
  E.ctx.window.confirm('棚卸を確定しますか？');
  const rec = E.UX._track('inv_F01', Promise.resolve(true));
  assert.equal(rec.user, true);
});

test('右上の「保存」の名前：名前の無いキーはキーそのものを出さない', () => {
  const ux = uxBlock();
  assert.match(ux, /return \(!l \|\| l === String\(key\)\) \? '' : l;/);
  const ob = fnFrom('outboxLabel');
  const c = ctxOf(); vm.runInContext(ob, c);
  assert.equal(c.outboxLabel('menu_mix_F03_2026.11'), 'メニューの出数');
  assert.equal(c.outboxLabel('zzz_unknown'), 'zzz_unknown');
});

/* ---------------------------------------------------------------- FUNERGY_STATUS（同期・診断・自動の同期） */
function stEnv(opts) {
  opts = opts || {};
  const listeners = { win: {}, doc: {} };
  const shell = { style: {} };
  const document = { hidden: false, addEventListener(tp, fn) { (listeners.doc[tp] = listeners.doc[tp] || []).push(fn); }, getElementById: id => (id === 'app-shell' ? shell : null), createElement: () => ({ innerHTML: '', classList: { contains: () => false } }) };
  const window = { addEventListener(tp, fn) { (listeners.win[tp] = listeners.win[tp] || []).push(fn); }, FUNERGY_UX: opts.ux || { saveState: () => ({ k: '' }), save: {}, failedList: () => [] } };
  const store = new Map();
  const ctx = Object.assign({ window, document, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: { onLine: opts.online !== false }, getComputedStyle: () => ({ display: 'block' }), setTimeout: uSetTimeout, clearTimeout, setInterval: () => 0,
    Promise, Date, JSON, Math, Object, Array, String, Number, Map, Set, RegExp, Error, console, curRole: opts.role || 'gm', curStoreLogin: false, curPage: 'dashboard' }, opts.extra || {});
  vm.createContext(ctx);
  vm.runInContext(statusBlock(), ctx);
  return { ctx, ST: ctx.window.FUNERGY_STATUS, listeners };
}

test('「診断と記録」に入れるのは GM・CEO・経理・事務Crew（店舗のログインは不可）', () => {
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(stEnv({ role: r }).ST.canDiag(), true, r);
  for (const r of ['am', 'sl', 'crew', 'chef', 'g3', 'g4']) assert.equal(stEnv({ role: r }).ST.canDiag(), false, r);
  const E = stEnv({ role: 'gm' }); E.ctx.curStoreLogin = true;
  assert.equal(E.ST.canDiag(), false);
  assert.match(E.ST.renderDiagCenter(), /GM・CEO・経理・事務Crew が使います/);
});

test('同期の状態：オフライン／取り込みの途中／取り込めなかった（表の名前）／取れた', async () => {
  assert.equal(stEnv({ online: false }).ST.syncState().k, 'offline');
  const E = stEnv();
  let res; const p = new Promise(r => { res = r; });
  const tr = E.ST.trackPull(p);
  assert.equal(E.ST.syncState().k, 'busy');
  const r = []; Object.defineProperty(r, '_fails', { value: ['app_settings', 'employees'], enumerable: false });
  res(r); await tr;
  const s = E.ST.syncState();
  assert.equal(s.k, 'fail');
  assert.deepEqual(J(s.what), ['設定', '従業員']);
  assert.equal(E.ST.syncInfo.streak, 1);
  await E.ST.trackPull(Promise.resolve([]));
  assert.equal(E.ST.syncState().k, 'ok');
  assert.equal(E.ST.syncInfo.streak, 0);
  assert.ok(E.ST.syncInfo.at > 0);
  assert.equal(E.ST.syncState().k, 'ok');
  await E.ST.trackPull(Promise.resolve(null));
  assert.deepEqual(J(E.ST.syncState().what), ['業務のデータ'], '答えが無い＝読めなかった');
});

test('診断：続けて 2 回取り込めない・何度送っても送れない・送信待ちの記録を書けない を出す', async () => {
  const E = stEnv({ extra: { _outboxMine: () => [{ key: 'a', attempts: 3, lastErr: '503' }, { key: 'b', attempts: 1, lastErr: '503' }] } });
  assert.deepEqual(J(E.ST.diagState().items.map(x => x.k)), ['stuck']);
  assert.equal(E.ST.diagState().items[0].n, 1, '3 回より少ないものは数えない');
  const bad = []; Object.defineProperty(bad, '_fails', { value: ['app_state'], enumerable: false });
  await E.ST.trackPull(Promise.resolve(bad));
  assert.ok(!E.ST.diagState().items.some(x => x.k === 'pull'), '1 回では出さない');
  await E.ST.trackPull(Promise.resolve(bad));
  assert.ok(E.ST.diagState().items.some(x => x.k === 'pull'));
  E.ctx.window._outboxLsFail = Date.now();
  assert.ok(E.ST.diagState().items.some(x => x.k === 'queue'));
});

test('自動の同期：入力中（モーダル・打っている・ログインの途中）は待つ・オフラインは動かない', async () => {
  const E = stEnv({ ux: { saveState: () => ({ k: '' }), save: {}, failedList: () => [], _typing: () => true } });
  assert.equal(await E.ST.autoSync('timer'), 'busy');
  assert.equal(await stEnv({ online: false }).ST.autoSync('timer'), 'offline');
  const E2 = stEnv(); E2.ctx.window._uxLoginBusy = true;
  assert.equal(await E2.ST.autoSync('timer'), 'busy');
});

test('自動の同期：送信待ちを送る → 送り直す → 取り込む → 画面を描き直す（入力を消さない描き直し）', async () => {
  const order = [];
  const ux = { saveState: () => ({ k: '' }), save: {}, failedList: () => [], bgRefresh: () => order.push('bg') };
  const E = stEnv({ ux, extra: {
    flushOutbox: async () => { order.push('flush'); }, retryShiftPlanPending: async () => { order.push('shift'); return 0; }, retryObSecretPending: async () => { order.push('ob'); return 0; },
    refreshStores: () => order.push('stores') } });
  E.ctx.supaPullAllMasters = () => { order.push('pull'); return Promise.resolve([]); };
  assert.equal(await E.ST.autoSync('timer'), 'ok');
  assert.deepEqual(order, ['flush', 'shift', 'ob', 'pull', 'stores', 'bg']);
});

test('自動の同期：途中で別の人になったら、その先（描き直しなど）はしない', async () => {
  const order = [];
  const E = stEnv({ ux: { saveState: () => ({ k: '' }), save: {}, failedList: () => [], _who: () => E.who, bgRefresh: () => order.push('bg') } });
  E.who = 'p:1';
  E.ctx.flushOutbox = async () => { E.who = 'p:2'; };
  E.ctx.supaPullAllMasters = () => { order.push('pull'); return Promise.resolve([]); };   // 別の人のあいだに取り込まない
  assert.equal(await E.ST.autoSync('timer'), 'changed');
  assert.deepEqual(order, []);
});

/* ---------------------------------------------------------------- 画面とナビ（決めてほしいこと 12A） */
test('右上：3 つ（保存・同期・診断）の入れ物があり、前の「最新に更新」（topbar-sync）は無い', () => {
  assert.match(html, /<button id="ux-save" type="button" class="topbar-icon-btn ux-save ux-trio" hidden onclick="FUNERGY_UX\.saveInfo\(\)"><\/button>/);
  assert.doesNotMatch(html, /id="topbar-sync"/);
});

test('「設定 › 診断と記録」：ナビは GM・CEO・経理・事務Crew だけ・2 つの renderPage に同じ case', () => {
  const navLine = html.split('\n').find(l => /\{ *id: *'diag_center'/.test(l));
  assert.ok(navLine, 'NAV_ITEMS');
  const roles = (navLine.match(/roles: *\[([^\]]*)\]/) || [])[1] || '';
  assert.deepEqual(roles.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort(), ['ceo', 'gm', 'office', 'office_crew']);
  assert.equal(html.split("case 'diag_center':").length - 1, 2);
});

test('「自動同期 OFF」「ログイン時同期 OFF」「全データリセット」は無い。クラウド同期はいつも ON', () => {
  assert.match(html, /\nvar SUPA_SYNC_ENABLED = true;/);
  for (const name of ['setSupaSync', 'toggleSupaSync', 'toggleLoginAutosync', 'loginAutosyncOn', 'clearAllData']) assert.doesNotMatch(html, new RegExp('function ' + name + '\\('), name);
  assert.doesNotMatch(html, /clearAllData\(/, '前の「全データリセット」の処理');
  assert.doesNotMatch(html, /['">]\s*全データリセット/, '画面の文字としては出さない（コメントだけ）');
  assert.doesNotMatch(html, /['">]\s*マスター自動同期/, '画面の文字としては出さない（コメントだけ）');
});

test('一般の画面の帯：ダッシュボード・予実は取得の状態だけ（「最新情報を取得」「診断」は無い）・ほかは何も出さない', () => {
  const f = fnFrom('pageSyncStrip');
  const c = ctxOf({ fstChipsHtml: () => '<span>売上 取得</span>' }); vm.runInContext(f, c);
  assert.match(c.pageSyncStrip('dash'), /売上 取得/);
  assert.doesNotMatch(c.pageSyncStrip('dash'), /最新情報を取得|診断/);
  for (const sc of ['hr', 'tip', 'inv', 'menu']) assert.equal(c.pageSyncStrip(sc), '', sc);
});

test('版：アプリと Service Worker が 1137 でそろう', () => {
  const a = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], b = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.equal(a, '1137');
  assert.equal(a, b);
});
