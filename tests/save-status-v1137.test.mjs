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
const OUTBOX = () => [fnFrom('_outboxGet'), fnFrom('_outboxSet')].join('\n');
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
  assert.ok(idb.has('op_outbox_overflow'), 'IndexedDB の別の名前に持つ');
  assert.equal(c.window._outboxLsFail, 0, 'IndexedDB に残せたので診断には出さない（読み込み直しても消えない）');
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

test('送信待ち（独立レビュー P3-1）：IndexedDB の別の名前は、localStorage に最後に書けた時刻より新しいときだけ使う', () => {
  const ls = fakeStorage(true), idb = new Map();
  const c = outboxCtx(ls, idb);
  c._outboxSet([{ key: 'old' }]);   // 書けない → 別の名前（時刻つき）
  ls.full = false;
  const c2 = outboxCtx(ls, idb);
  c2._outboxSet([{ key: 'new' }]);   // 書けた → localStorage の時刻を進め、別の名前を消す
  assert.ok(Number(ls.getItem('_op_outbox_at')) > 0);
  idb.set('op_outbox_overflow', JSON.stringify({ at: 1, list: [{ key: 'old' }] }));   // 消す前に閉じられた・ほかのタブの古い写し
  const c3 = outboxCtx(ls, idb);
  assert.deepEqual(J(c3._outboxGet().map(x => x.key)), ['new'], '古い別の名前は使わない');
  assert.equal(idb.has('op_outbox_overflow'), false, '古い別の名前は消す');
});

test('送信待ち：送れて外したとき、localStorage に時刻だけ書けなくても（ほぼ満杯）、古い別の名前で送信待ちに戻さない', () => {
  // 本物のブラウザ（合成データ・localStorage がほぼ満杯の端末）で見つけた：ログインの裏の保存が送れて外したのに「送信待ち 1 件」のまま
  const ls = fakeStorage(true), idb = new Map();
  const c = outboxCtx(ls, idb);
  c._outboxSet([{ key: 'm_credit_tip_adj_F02', lastErr: 'queued' }]);   // 満杯 → 別の名前
  ls.full = false;
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === '_op_outbox_at') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } setItem(k, v); };
  assert.equal(c._outboxSet([]), true, 'op_outbox（短くなる）には書けた');
  assert.deepEqual(J(c._outboxGet()), [], 'このタブで戻らない');
  assert.deepEqual(J(outboxCtx(ls, idb)._outboxGet()), [], '読み込み直しても戻らない');
});

test('送信待ち（2 回目の独立レビュー P3-4）：IndexedDB を読む前に書けたときも時刻を残し、前の別の名前をあとで新しいとみなさない', () => {
  const ls = fakeStorage(false), idb = new Map();
  idb.set('op_outbox_overflow', JSON.stringify({ at: 5, list: [{ key: 'old' }] }));
  const c = outboxCtx(ls, idb);
  c._idbState = 'loading'; c._IDB_MEM = null;   // 起動の直後（まだ読んでいない）
  assert.equal(c._outboxSet([{ key: 'new' }]), true);
  assert.ok(Number(ls.getItem('_op_outbox_at')) > 5);
  const c2 = outboxCtx(ls, idb);   // 読み終えた
  assert.deepEqual(J(c2._outboxGet().map(x => x.key)), ['new']);
});

test('送信待ち：IndexedDB も使えない端末では、このタブのあいだだけ覚える', () => {
  const ls = fakeStorage(true);
  const c = outboxCtx(ls, null);
  c._outboxSet([{ key: 'k' }]);
  assert.deepEqual(J(c._outboxGet().map(x => x.key)), ['k']);
  assert.ok(c.window._outboxLsFail > 0, '読み込み直すと消えるので、診断に出す印');
});

/* ---------------------------------------------------------------- この端末だけの小さな記録・直した時刻 */
test('小さな記録（シフト・本人確認の情報の送信待ちの印）：書けなくてもこのタブでは覚える・書けたら localStorage に戻る', () => {
  const ls = fakeStorage(true);
  const c = ctxOf({ localStorage: ls });
  vm.runInContext([fnFrom('_smallGet'), fnFrom('_smallSet')].join('\n'), c);
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
  vm.runInContext([varLine('var PEND_EDIT_KEY'), fnFrom('_pendEditAtRaw'), fnFrom('_pendEditAtSetRaw'), fnFrom('_pendEditAtAll'), fnFrom('_pendEditAtMark'), fnFrom('_pendEditAtDrop')].join('\n'), c);
  c._pendEditAtMark('evaluations', '{"a":1}', '{"a":2}');
  assert.ok(Number(c._pendEditAtAll().evaluations) > 0);
  c._pendEditAtDrop('evaluations');
  assert.deepEqual(J(c._pendEditAtAll()), {});
  // ふだん（書ける）は localStorage に
  const ls2 = fakeStorage(false), c2 = ctxOf({ localStorage: ls2, isOpSyncKey: () => true, _opMergeDef: () => null, _cjson: x => JSON.stringify(x) });
  vm.runInContext([varLine('var PEND_EDIT_KEY'), fnFrom('_pendEditAtRaw'), fnFrom('_pendEditAtSetRaw'), fnFrom('_pendEditAtAll'), fnFrom('_pendEditAtMark')].join('\n'), c2);
  c2._pendEditAtMark('evaluations', '{"a":1}', '{"a":2}');
  assert.ok(JSON.parse(ls2.getItem('_pend_edit_at')).evaluations > 0);
});

test('グレードの一緒の保存（ghTxn）は直した時刻を _pendEditAtRaw／_pendEditAtSetRaw で覚えて戻す', () => {
  const b = fnFrom('ghTxnBegin'), e = fnFrom('ghTxnEnd');
  assert.match(b, /_pendEditAtRaw\(\)/);
  assert.match(e, /_pendEditAtSetRaw\(tx\.pendAt\)/);
});

/* ---------------------------------------------------------------- シフトの表（shift_plans） */
/* クラウドの shift_plans の 1 行の代わり（GET・POST）。fail＝読めない／書けない */
function shiftCtx(opts) {
  opts = opts || {};
  const ls = fakeStorage(false), notifs = [], posts = [], local = new Map(), cloud = new Map();
  let postOk = false, postGate = null, getOk = true, getGate = null;
  const c = ctxOf({ localStorage: ls, _supaBooting: false, STORES: [{ id: 'F01', name: '店A' }], t: (ja) => ja, showToast: () => {},
    addNotif: n => notifs.push(n), getNotifs: () => notifs, getShiftPlan: (s, w) => (local.has(s + '_' + w) ? JSON.parse(local.get(s + '_' + w)) : null),
    SUPABASE_URL: 'https://x.invalid', supaHeaders: () => ({}), _lsWriteVerified: (k, j) => { local.set(k.replace(/^shiftplan_/, ''), j); return true; },
    _cjson: x => JSON.stringify(x), _saveWho: () => c.me,
    fetch: async (u) => {
      c.fetched = (c.fetched || 0) + 1;
      if (getGate) await getGate;
      if (!getOk) return { ok: false, json: async () => ({}) };
      const m = /store_id=eq\.([^&]+)&week=eq\.([^&]+)/.exec(u); const k = decodeURIComponent(m[1]) + '_' + decodeURIComponent(m[2]);
      return { ok: true, json: async () => (cloud.has(k) ? [JSON.parse(cloud.get(k))] : []) };
    } });
  c.me = opts.me || 'p:A';
  vm.runInContext([fnFrom('_smallGet'), fnFrom('_smallSet'), varLine('var SHIFTPLAN_PENDING_KEY'), varLine('var SHIFTPLAN_BASE_KEY'),
    fnFrom('_shiftFp'), fnFrom('_shiftSmallGet'), fnFrom('_shiftSmallSet'), fnFrom('_shiftBaseAll'), fnFrom('_shiftBaseOf'), fnFrom('_shiftBaseSet'), fnFrom('_shiftWho'),
    fnFrom('shiftPlanPendingList'), fnFrom('shiftPlanPendingMine'), fnFrom('_shiftPlanPendingSet'), fnFrom('shiftPlanPendingOf'), fnFrom('_shiftPlanPendingAdd'), fnFrom('_shiftPlanPendingDone'),
    fnFrom('shiftPlanLabel'), fnFrom('_shiftConflictNote'), fnFrom('_shiftPlanGet'), fnFrom('pushShiftPlan'), varLine('var _shiftRetryBusy'), fnFrom('retryShiftPlanPending'), fnFrom('shiftPlanNotifyPublished'), fnFrom('pullShiftPlan')].join('\n'), c);
  c._shiftPlanPost = async (s, w, plan) => { posts.push([s, w, plan]); if (postGate) await postGate; if (postOk) cloud.set(s + '_' + w, JSON.stringify({ status: plan.status || '下書き', cells: plan.cells || {} })); return postOk; };
  const save = (plan, notify) => { local.set('F01_11/1', JSON.stringify(plan)); return c.pushShiftPlan('F01', '11/1', plan, true, notify ? { notify: true } : undefined); };
  return { c, ls, notifs, posts, local, cloud, save, setOk: v => { postOk = v; }, gate: p => { postGate = p; }, getOk: v => { getOk = v; }, getGate: p => { getGate = p; } };
}
const plan = (status, who) => ({ status, cells: { mon_L_1: who } });

test('シフト：送れなかったら送信待ち・クラウドがそのままなら読み込みでも端末の値を残す・送れたら公開の知らせ（1 回）', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), true, '最初に読んだクラウドの中身を覚える');
  S.setOk(false);
  assert.equal(await S.save(plan('公開済', 'Mine'), true), 'deferred');
  assert.deepEqual(J(S.c.shiftPlanPendingList().map(x => [x.s, x.w, x.notify, x.who])), [['F01', '11/1', 1, 'p:A']]);
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), 'pending', 'クラウドが送れなかった変更の前のままなら端末の値を残す');
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'Mine');
  await tick(10);
  S.setOk(true);
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.deepEqual(J(S.c.shiftPlanPendingList()), []);
  assert.equal(JSON.parse(S.cloud.get('F01_11/1')).cells.mon_L_1, 'Mine');
  assert.equal(S.notifs.filter(n => n.title === 'シフトが公開されました').length, 1, '送れたときに 1 回知らせる');
  assert.equal(await S.c.retryShiftPlanPending(), 0);
  assert.equal(S.notifs.length, 1);
});

test('シフト（独立レビュー P1）：送れなかったあとにほかの端末で変わった（公開された）ら、送り直しで上書きしない・クラウドの内容にする', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(false);
  await S.save(plan('下書き', 'A-offline'), false);
  S.cloud.set('F01_11/1', JSON.stringify(plan('公開済', 'GM')));   // GM がほかの端末で直して公開
  S.setOk(true);
  const n0 = S.posts.length;
  assert.equal(await S.c.retryShiftPlanPending(), 0);
  assert.equal(S.posts.length, n0, '送らない');
  assert.deepEqual(J(JSON.parse(S.cloud.get('F01_11/1'))), plan('公開済', 'GM'), 'クラウドの公開はそのまま');
  assert.deepEqual(J(JSON.parse(S.local.get('F01_11/1'))), plan('公開済', 'GM'), '端末もクラウドの内容に');
  assert.deepEqual(J(S.c.shiftPlanPendingList()), []);
  // 読み込みでも同じ（送れなかったあと、ほかの端末で変わっていたらクラウドの内容に）
  const S2 = shiftCtx();
  S2.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S2.c.pullShiftPlan('F01', '11/1');
  S2.setOk(false); await S2.save(plan('下書き', 'A-offline'), false);
  S2.cloud.set('F01_11/1', JSON.stringify(plan('公開済', 'GM')));
  assert.equal(await S2.c.pullShiftPlan('F01', '11/1'), true);
  assert.equal(JSON.parse(S2.local.get('F01_11/1')).cells.mon_L_1, 'GM');
  assert.deepEqual(J(S2.c.shiftPlanPendingList()), []);
});

test('シフト（独立レビュー P1）：送信待ちは保存した人のもの。ほかの人のログインのあいだは送らず、数えない', async () => {
  const S = shiftCtx({ me: 'p:A' });
  S.setOk(false);
  await S.save(plan('下書き', 'A'), false);
  S.c.me = 'p:B'; S.setOk(true);
  assert.equal(S.c.shiftPlanPendingMine().length, 0);
  assert.equal(await S.c.retryShiftPlanPending(), 0);
  assert.equal(S.cloud.has('F01_11/1'), false, 'B のあいだに A の保存は送らない');
  S.c.me = 'p:A';
  assert.equal(await S.c.retryShiftPlanPending(), 1, 'A がまた入ったら送る');
});

test('シフト（独立レビュー P2-1）：送っている途中・読み始めたあとに送り終えたときは、読み込みで端末の値を上書きしない', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(true);
  let open; S.gate(new Promise(r => { open = r; }));
  const p = S.save(plan('下書き', 'New'), false);   // 遅い送信
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), 'pending', '送っている途中');
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'New');
  open(); await p; S.gate(null);
  // 読み始めたあとに送り終えた
  let openGet; S.getGate(new Promise(r => { openGet = r; }));
  const pr = S.c.pullShiftPlan('F01', '11/1');
  await tick(2);
  await S.save(plan('下書き', 'Newer'), false);
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Newer')));
  openGet(); S.getGate(null);
  assert.equal(await pr, 'pending');
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'Newer');
});

test('シフト：もうクラウドに同じ中身がある（送れたのに答えが届かなかった）なら、送らずに送信待ちを外す', async () => {
  const S = shiftCtx();
  S.setOk(false);
  await S.save(plan('下書き', 'x'), false);
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'x')));
  S.setOk(true);
  const n0 = S.posts.length;
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.equal(S.posts.length, n0);
  assert.equal(S.c.shiftPlanPendingList().length, 0);
});

test('シフト：送れたら、その中身を土台として覚える（あとの保存が送れなかったときに、ほかの端末の変更と取り違えない）', async () => {
  const S = shiftCtx();
  S.setOk(true);
  assert.equal(await S.save(plan('下書き', 'P1'), false), true);   // 読まずに最初の保存（新しい週）
  S.setOk(false);
  await S.save(plan('下書き', 'P2'), false);
  S.setOk(true);
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.equal(JSON.parse(S.cloud.get('F01_11/1')).cells.mon_L_1, 'P2', '自分が送った P1 の上の変更なので送る');
  // 送っているあいだのあとの保存が送れなかった：土台はいま送れた中身
  const S2 = shiftCtx();
  S2.setOk(true);
  let open; S2.gate(new Promise(r => { open = r; }));
  const p1 = S2.save(plan('下書き', 'Q1'), false);
  await tick(2);
  S2.c._shiftPlanPendingAdd('F01', '11/1', false); S2.local.set('F01_11/1', JSON.stringify(plan('下書き', 'Q2')));
  open(); await p1; S2.gate(null);
  assert.equal(await S2.c.retryShiftPlanPending(), 1);
  assert.equal(JSON.parse(S2.cloud.get('F01_11/1')).cells.mon_L_1, 'Q2');
});

test('シフト：前に送り始めた送信が成功しても、そのあとの保存の送信待ちは消さない', async () => {
  const S = shiftCtx();
  let open; S.gate(new Promise(r => { open = r; }));
  S.setOk(true);
  const p = S.save(plan('下書き', 'a'), false);
  await tick(5);
  S.c._shiftPlanPendingAdd('F01', '11/1', false);   // 送っているあいだに、別の保存が送れなかった
  open(); assert.equal(await p, true);
  assert.equal(S.c.shiftPlanPendingList().length, 1, 'あとの保存は送信待ちに残る');
});

test('シフト：画面を描くたびに送り直さない（15 秒あける）・読めないときは何もしない', async () => {
  const S = shiftCtx();
  S.setOk(false);
  await S.save(plan('下書き', 'x'), false);
  const n0 = S.posts.length;
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  await S.c.pullShiftPlan('F01', '11/1'); await tick(5);
  assert.equal(S.posts.length - n0, 1);
  S.getOk(false);
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), null);
  const n1 = S.posts.length;
  assert.equal(await S.c.retryShiftPlanPending(), 0);
  assert.equal(S.posts.length, n1, '読めないときは送らない');
});

test('シフト（P3-4）：前の公開の知らせは、送れたときにまだ公開のままのときだけ', async () => {
  const S = shiftCtx();
  S.setOk(false);
  await S.save(plan('公開済', 'x'), true);
  S.setOk(true);
  await S.save(plan('下書き', 'y'), false);   // 代わりの人を入れて下書きに戻した
  assert.equal(S.notifs.length, 0);
});

/* 2 回目の独立レビュー（9196173・756b30c）の再現 */
test('シフト（2 回目の独立レビュー P1）：土台が分からない（v1136 以前に入れた週）ときは、ほかの端末で変わったと決めず、この端末の変更を送る', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  S.local.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  S.getOk(false);
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), null, '読めない（土台は覚えていない）');
  S.setOk(false);
  assert.equal(await S.save(plan('下書き', 'MyEdit'), false), 'deferred');
  assert.equal(J(S.c.shiftPlanPendingList())[0].base, null);
  S.getOk(true);
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), 'pending', '読み込みでも端末の値を残す');
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'MyEdit');
  S.setOk(true);
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.equal(JSON.parse(S.cloud.get('F01_11/1')).cells.mon_L_1, 'MyEdit', 'この端末の変更が届く');
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'MyEdit');
  assert.equal(S.c.shiftPlanPendingList().length, 0);
});

test('シフト（2 回目の独立レビュー P1）：送り直しがまた送れなかったとき、送信待ちの土台は前のまま（土台の印の写しが無くなっても空にしない）', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(false);
  await S.save(plan('下書き', 'Mine'), false);
  const b0 = J(S.c.shiftPlanPendingList())[0].base;
  assert.ok(b0);
  S.ls.removeItem('_shiftplan_base'); S.c._shiftBaseSet.mem = null;   // 写しが無くなった（80 週を超えた・読み込み直した）
  await S.c.retryShiftPlanPending();   // クラウドは土台のまま → 送る → また送れない
  assert.equal(J(S.c.shiftPlanPendingList())[0].base, b0);
});

test('シフト（2 回目の独立レビュー P2）：送り直しが読んでいるあいだに保存した（送れた → 次は送れなかった）ら、その読みで端末の新しい変更を捨てない', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(false);
  await S.save(plan('下書き', 'P1'), false);
  await tick(5);
  S.setOk(true);
  let openGet; S.getGate(new Promise(r => { openGet = r; }));
  const rp = S.c.retryShiftPlanPending();
  await tick(5);
  S.getGate(null);
  assert.equal(await S.save(plan('下書き', 'P2'), false), true);
  await tick(5);
  S.setOk(false);
  assert.equal(await S.save(plan('下書き', 'P3'), false), 'deferred');
  openGet();
  await rp;
  assert.equal(JSON.parse(S.local.get('F01_11/1')).cells.mon_L_1, 'P3', '端末の新しい変更を残す');
  assert.equal(S.c.shiftPlanPendingList().length, 1, '送信待ちも残る');
});

test('シフト（2 回目の独立レビュー P3-1）：送れなかった公開が実は届いていた（答えだけ届かなかった）ら、読み込みで知らせる・2 回は知らせない', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.c._shiftPlanPost = async (s, w, p) => { S.cloud.set(s + '_' + w, JSON.stringify({ status: p.status, cells: p.cells })); return false; };
  assert.equal(await S.save(plan('公開済', 'Mine'), true), 'deferred');
  assert.equal(await S.c.pullShiftPlan('F01', '11/1'), true);
  assert.equal(S.c.shiftPlanPendingList().length, 0);
  assert.equal(S.notifs.length, 1);
  S.c.shiftPlanNotifyPublished('F01', '11/1', plan('公開済', 'Mine'));
  assert.equal(S.notifs.length, 1, '同じ公開は 1 回');
});

test('シフト（2 回目の独立レビュー P3-2）：あとから呼んで送れた保存で、前の送れなかった保存の送信待ちは外れる', async () => {
  const S = shiftCtx();
  let open, calls = 0; const gate = new Promise(r => { open = r; });
  S.c._shiftPlanPost = async (s, w, p) => { calls++; if (calls === 1) { await gate; return false; } S.cloud.set(s + '_' + w, JSON.stringify({ status: p.status, cells: p.cells })); return true; };
  const pa = S.save(plan('下書き', 'A'), false);
  await tick(2);
  const pb = S.save(plan('下書き', 'B'), false);   // A の答えの前に呼んだ（順番に送る）
  await tick(2);
  open();
  assert.equal(await pa, 'deferred');
  assert.equal(await pb, true);
  assert.equal(S.c.shiftPlanPendingList().length, 0, 'B が A のあとの中身を送ったので、A の送信待ちは残さない');
});

test('シフト：送れた保存のあとに送れなかった保存は、送れた中身を土台にする（クラウドがそのままなら送り直しで送る）', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(true);
  assert.equal(await S.save(plan('下書き', 'A'), false), true);
  S.setOk(false);
  assert.equal(await S.save(plan('下書き', 'B'), false), 'deferred');
  S.setOk(true);
  assert.equal(await S.c.retryShiftPlanPending(), 1);
  assert.equal(JSON.parse(S.cloud.get('F01_11/1')).cells.mon_L_1, 'B', 'ほかの端末で変わったとみなして捨てない');
});

test('シフト（2 回目の独立レビュー P2）：送り直しが読んでいるあいだにログインが変わったら、前の人の送信待ちを送らない', async () => {
  const S = shiftCtx();
  S.cloud.set('F01_11/1', JSON.stringify(plan('下書き', 'Old')));
  await S.c.pullShiftPlan('F01', '11/1');
  S.setOk(false);
  await S.save(plan('下書き', 'A の変更'), false);
  S.setOk(true);
  let openGet; S.getGate(new Promise(r => { openGet = r; }));
  const n0 = S.posts.length;
  const rp = S.c.retryShiftPlanPending();
  await tick(5);
  S.c.me = 'p:B';
  openGet();
  await rp;
  assert.equal(S.posts.length, n0, 'B のログインのあいだは送らない');
  assert.equal(S.c.shiftPlanPendingList().length, 1);
});

test('シフトの公開：届いてから「公開しました」と知らせ。届かなければ「まだ送れていません」・知らせない', () => {
  const f = fnFrom('publishShiftPlan');
  assert.match(f, /pushShiftPlan\(storeId, week, plan, true, \{ notify:true \}\)/);
  assert.match(f, /if\(r === true\)\{ shiftPlanNotifyPublished\(storeId, week, plan\); showToast\('シフトを公開しました'/);
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
function obCtx() {
  const ls = fakeStorage(false), sent = [];
  let ok = false, sec = { ssn: 'x' };
  const obs = [{ id: 'o1', inviteToken: 't' }], secs = {}, hooks = {};
  const c = ctxOf({ localStorage: ls, t: ja => ja, obSecretOf: (ob) => (ob && secs[ob.id]) || sec,
    authObPriv: async (p) => { sent.push(p); if (hooks.auth) return hooks.auth(p); return { ok }; }, _cjson: x => JSON.stringify(x), _saveWho: () => c.me, ls: () => JSON.parse(JSON.stringify(obs)) });
  c.me = 'p:A';
  vm.runInContext([fnFrom('_smallGet'), fnFrom('_smallSet'), varLine('var OB_SECRET_PENDING_KEY'), varLine('var OB_SECRET_TTL'), fnFrom('_obSecretFp'), fnFrom('_obSecretWho'),
    fnFrom('obSecretPendingList'), fnFrom('obSecretPendingMine'), fnFrom('_obSecretPendingSet'), fnFrom('obPushSecret'), varLine('var _obSecretRetryBusy'), fnFrom('retryObSecretPending')].join('\n'), c);
  return { c, ls, sent, obs, secs, hooks, setOk: v => { ok = v; }, setSec: v => { sec = v; } };
}
test('本人確認の情報：送れなかったら送信待ち（中身は入れない）・送れたら外す。提出は送れるまで止める', async () => {
  const O = obCtx();
  assert.equal(await O.c.obPushSecret({ id: 'o1', inviteToken: 't' }), 'deferred');
  assert.deepEqual(J(O.c.obSecretPendingList().map(x => [x.id, x.who])), [['o1', 'p:A']]);
  assert.ok(!/ssn/.test(O.ls.getItem('_ob_secret_pending') || ''), '送信待ちの印に中身は入れない');
  O.setOk(true);
  assert.equal(await O.c.obPushSecret({ id: 'o1', inviteToken: 't' }), true);
  assert.deepEqual(J(O.c.obSecretPendingList()), []);
  const sub = fnFrom('obWizSubmit');
  assert.match(sub, /Promise\.resolve\(obPushSecret\(ob\)\)\.then/);
  assert.match(sub, /if \(r !== true\)\{ alert\(/, '送れなければ提出完了にしない');
  assert.match(sub, /本人確認の情報を送れませんでした/);
});
test('本人確認の情報（独立レビュー P2-2）：自動では送り直さない。「今すぐ送る」でも同じ人・中身がそのまま・24 時間以内だけ', async () => {
  const O = obCtx();
  await O.c.obPushSecret({ id: 'o1', inviteToken: 't' });
  O.setOk(true);
  const n0 = O.sent.length;
  assert.equal(await O.c.retryObSecretPending(false), 0, '自動の同期では送らない');
  assert.equal(O.sent.length, n0);
  O.c.me = 'p:B';
  assert.equal(await O.c.retryObSecretPending(true), 0, 'ほかの人は送らない');
  assert.equal(O.c.obSecretPendingMine().length, 0);
  O.c.me = 'p:A'; O.setSec({ ssn: 'changed' });
  assert.equal(await O.c.retryObSecretPending(true), 0, '中身が変わったら送らない（送信待ちから外す）');
  assert.equal(O.c.obSecretPendingList().length, 0);
  O.setSec({ ssn: 'x' }); O.setOk(false);
  await O.c.obPushSecret({ id: 'o1', inviteToken: 't' }); O.setOk(true);
  assert.equal(await O.c.retryObSecretPending(true), 1, '同じ人・同じ中身なら送る');
  // 24 時間を過ぎたものは外す
  O.setOk(false); await O.c.obPushSecret({ id: 'o1', inviteToken: 't' });
  const l = J(O.c.obSecretPendingList()); l[0].at = Date.now() - 25 * 3600000; O.c._obSecretPendingSet(l);
  assert.equal(O.c.obSecretPendingMine().length, 0);
  await O.c.retryObSecretPending(false);
  assert.equal(O.c.obSecretPendingList().length, 0);
});

test('本人確認の情報（2 回目の独立レビュー P3-7）：送り直しのあいだに直して送れなかった新しい中身を、古い写しで送らない・送信待ちを消さない', async () => {
  const O = obCtx();
  O.obs.push({ id: 'o2', inviteToken: 't' });
  O.secs.o1 = { ssn: '1' }; O.secs.o2 = { ssn: 'old' };
  await O.c.obPushSecret({ id: 'o1', inviteToken: 't' });
  await O.c.obPushSecret({ id: 'o2', inviteToken: 't' });
  assert.equal(O.c.obSecretPendingList().length, 2);
  let open; const gate = new Promise(r => { open = r; });
  O.hooks.auth = async (p) => { if (p.obId === 'o1') { await gate; return { ok: true }; } return { ok: p.secret.ssn !== 'new' || O.hooks.newOk === true }; };
  const rp = O.c.retryObSecretPending(true);
  await tick(5);
  O.secs.o2 = { ssn: 'new' };   // 送り直しのあいだに o2 を直した → 送れなかった
  assert.equal(await O.c.obPushSecret({ id: 'o2', inviteToken: 't' }), 'deferred');
  O.hooks.newOk = true;
  open();
  await rp;
  const o2 = O.sent.filter(p => p.obId === 'o2').map(p => p.secret.ssn);
  assert.deepEqual(o2, ['old', 'new', 'new'], '送り直しは新しい中身を送る（前は送信待ちの古い写しと比べて外し、新しい中身を送らなかった）');
  assert.equal(O.c.obSecretPendingList().length, 0, '新しい中身が届いたので外す');
});

test('本人確認の情報：あとから呼んで送れた保存で、前の送れなかった保存の送信待ちは外れる（送れなかった時刻ではなく呼んだ時刻）', async () => {
  const O = obCtx();
  let open, calls = 0; const gate = new Promise(r => { open = r; });
  assert.equal(await O.c.obPushSecret({ id: 'o1', inviteToken: 't' }), 'deferred');   // 前から送信待ちがある
  O.hooks.auth = async () => { calls++; if (calls === 1) { await gate; return { ok: false }; } return { ok: true }; };
  const pa = O.c.obPushSecret({ id: 'o1', inviteToken: 't' });
  await tick(2);
  const pb = O.c.obPushSecret({ id: 'o1', inviteToken: 't' });
  await tick(2);
  open();
  assert.equal(await pa, 'deferred');
  assert.equal(await pb, true);
  assert.equal(O.c.obSecretPendingList().length, 0);
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

test('右上の「保存」：前の送信の答えを待って並んでいるだけのもの（いま送っている途中）は「送信待ち」に数えない', () => {
  const E = uxEnv();
  let busy = true;
  E.ctx._outboxMine = () => [{ key: 'm_credit_tip_adj_F04-K', attempts: 1, lastErr: 'queued' }];
  E.ctx._pushBusy = () => busy;
  assert.equal(E.UX.saveState().k, '', 'ログインのあとの裏の保存で点滅しない');
  assert.equal(E.UX.outboxWaiting().length, 0, '押した中身の一覧も同じ（2 回目の独立レビュー P3-5）');
  busy = false;   // 送り終えたのに残っている＝届かなかった
  assert.deepEqual(J(E.UX.saveState()), { k: 'queued', n: 1, off: false });
  busy = true;
  E.ctx._outboxMine = () => [{ key: 'k2', attempts: 2, lastErr: 'push failed' }];
  assert.equal(E.UX.saveState().k, 'queued', '送れなかったものは送っている途中でも数える');
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

test('「診断と記録」：画面ごとの診断は GM・CEO・経理・事務Crew。AM・G4・SL は前の同期センターの道具だけ（独立レビュー P2-4）。店舗のログインは不可', () => {
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(stEnv({ role: r }).ST.canDiag(), true, r);
  for (const r of ['am', 'sl', 'crew', 'chef', 'g3', 'g4']) assert.equal(stEnv({ role: r }).ST.canDiag(), false, r);
  for (const r of ['am', 'g4', 'sl']) assert.equal(stEnv({ role: r }).ST.canOpen(), true, r);   // 2 回目の独立レビュー P3-8：G4 も
  for (const r of ['crew', 'chef', 'g2']) assert.equal(stEnv({ role: r }).ST.canOpen(), false, r);
  const sc = { syncCenterBodyHtml: () => '<div id="sc-body">前の同期センター</div>', fstClock: () => '00:00' };
  const doc = (E) => { E.ctx.document.createElement = () => ({ innerHTML: '', classList: { contains: () => false }, querySelectorAll: () => [] }); return E; };
  const am = doc(stEnv({ role: 'am', extra: sc })).ST.renderDiagCenter();
  assert.match(am, /sc-body/, 'AM には前の同期センターの道具');
  assert.doesNotMatch(am, /openTipDateDebug|runLaborDiag|runSupaPullAll/, 'AM には画面ごとの診断・クラウドの書き直しを出さない');
  const gm = doc(stEnv({ role: 'gm', extra: Object.assign({ getVisibleStores: () => [], getEmployees: () => [], STORES: [] }, sc) })).ST.renderDiagCenter();
  assert.match(gm, /openTipDateDebug/); assert.match(gm, /runSupaPullAll/);
  const E = stEnv({ role: 'gm' }); E.ctx.curStoreLogin = true;
  assert.equal(E.ST.canOpen(), false);
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

test('押した中身（2 回目の独立レビュー P3-5）：送信待ちの一覧は右上の数と同じもの（送っている途中で並んでいるだけのものは出さない）', () => {
  const ux = { saveState: () => ({ k: '' }), save: {}, failedList: () => [], outboxWaiting: () => [] };
  const E = stEnv({ ux, extra: { _outboxMine: () => [{ key: 'm_x', lastErr: 'queued', ts: Date.now() }], outboxLabel: () => '何か' } });
  const pop = { innerHTML: '', classList: { contains: () => false }, querySelectorAll: () => [] };
  E.ST.fillPop(pop);
  assert.doesNotMatch(pop.innerHTML, /送れていない \d/);
  ux.outboxWaiting = () => [{ key: 'm_x', lastErr: 'push failed', ts: Date.now() }];
  E.ST.fillPop(pop);
  assert.match(pop.innerHTML, /送れていない 1 件/);
});

test('前に「自動同期 OFF」だった端末（独立レビュー P2-5）：ログインのあと 1 回だけ記録に残す', () => {
  const E = stEnv();
  E.ctx.localStorage.setItem('_sync_was_off', '1');
  E.ctx.ST = E.ST; E.ST.paintSoon = () => {};
  E.ST.afterEnter();
  assert.ok(E.ST.logList().some(x => /自動同期 OFF/.test(x.x)), '記録に残す');
  assert.equal(E.ctx.localStorage.getItem('_sync_was_off'), null, '印は消す');
  E.ST.afterEnter();
  assert.equal(E.ST.logList().filter(x => /自動同期 OFF/.test(x.x)).length, 1, '2 回目は残さない');
});

test('自動の同期：入力中（モーダル・打っている・ログインの途中）は待つ・オフラインは動かない', async () => {
  const E = stEnv({ ux: { saveState: () => ({ k: '' }), save: {}, failedList: () => [], _typing: () => true } });
  assert.equal(await E.ST.autoSync('timer'), 'busy');
  assert.equal(await stEnv({ online: false }).ST.autoSync('timer'), 'offline');
  const E2 = stEnv(); E2.ctx.window._uxLoginBusy = true;
  assert.equal(await E2.ST.autoSync('timer'), 'busy');
});

test('同期の状態（2 回目の独立レビュー P3-9）：2 分を過ぎた取り込みは取れなかったことにし、あとで取れたら取れたことにする', async () => {
  const E = stEnv();
  E.ctx.setTimeout = (f, ms) => (ms >= 120000 ? setTimeout(f, 1) : uSetTimeout(f, ms));   // 2 分を 1 ms に
  let res; const p = new Promise(r => { res = r; });
  await E.ST.trackPull(p);
  assert.equal(E.ST.syncState().k, 'fail');
  res([]); await tick(5);
  assert.equal(E.ST.syncState().k, 'ok');
  assert.equal(E.ST.syncInfo.streak, 0);
});

test('「今すぐ最新にする」（2 回目の独立レビュー P3-6）：自動の同期の途中なら、終わってから手の同期をする', async () => {
  const calls = [];
  let open; const gate = new Promise(r => { open = r; });
  const E = stEnv({ extra: { flushOutbox: async () => {}, retryShiftPlanPending: async () => 0, retryObSecretPending: async (m) => { calls.push('ob:' + m); return 0; }, showToast: () => {} } });
  let n = 0; E.ctx.supaPullAllMasters = () => { n++; return n === 1 ? gate.then(() => []) : Promise.resolve([]); };
  const a = E.ST.autoSync('timer');
  await tick(5);
  const m = E.ST.syncNow();
  open();
  assert.equal(await a, 'ok');
  assert.equal(await m, 'ok');
  assert.deepEqual(calls, ['ob:false', 'ob:true'], '手の同期は自動の同期のあとにもう一度');
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

test('自動の同期（独立レビュー P2-3）：読み直しの直前にもう一度、入力中か確かめる・売上を保存しうる読み直しは自動ではしない', async () => {
  const order = [];
  let typing = false;
  const ux = { saveState: () => ({ k: '' }), save: {}, failedList: () => [], _typing: () => typing, bgRefresh: () => order.push('bg') };
  const E = stEnv({ ux, extra: { pageSyncScope: p => ({ dashboard: 'dash', hr: 'hr' })[p] || null, _syncMeta: sc => ({ pull: () => { order.push('pull:' + sc); } }) } });
  E.ctx.supaPullAllMasters = () => { typing = true; return Promise.resolve([]); };   // 取り込んでいるあいだに打ち始めた
  E.ctx.curPage = 'hr';
  await E.ST.autoSync('timer');
  assert.ok(!order.includes('pull:hr'), '入力中になったら画面の読み直しはしない');
  typing = false; order.length = 0;
  E.ctx.supaPullAllMasters = () => Promise.resolve([]);
  E.ctx.curPage = 'dashboard';
  E.ST.auto.running = null;
  await E.ST.autoSync('timer');
  assert.ok(!order.includes('pull:dash'), '自動ではダッシュボードの売上の取り直しをしない');
  assert.ok(order.includes('bg'), '取り込んだデータで描き直す');
  order.length = 0;
  await E.ST.autoSync('manual', { manual: true });
  assert.ok(order.includes('pull:dash'), '「今すぐ最新にする」ではする');
  order.length = 0; E.ctx.mnReload = () => order.push('mn');
  E.ST.pageRefresher('menu', false)();
  assert.ok(!order.includes('mn'), '自動ではメニューの出数を全部取り直さない（P3-5）');
  E.ST.pageRefresher('menu', true)();
  assert.ok(order.includes('mn'));
});

test('本人確認の情報の送り直しは「今すぐ送る」のときだけ（自動の同期では送らない）', async () => {
  const calls = [];
  const E = stEnv({ extra: { retryObSecretPending: m => { calls.push(m); return Promise.resolve(0); }, flushOutbox: async () => {}, retryShiftPlanPending: async () => 0 } });
  E.ctx.supaPullAllMasters = () => Promise.resolve([]);
  await E.ST.autoSync('timer');
  await E.ST.sendNow();
  assert.deepEqual(J(calls), [false, true]);
});

test('診断（独立レビュー P3-3）：送っている途中で待った・まだ取っていない・閉じられた送信待ちは「何度送っても送れない」に数えない', () => {
  const E = stEnv({ extra: { _outboxMine: () => [{ key: 'a', attempts: 5, lastErr: 'queued' }, { key: 'b', attempts: 4, lastErr: 'deferred: not fetched yet' }, { key: 'c', attempts: 3, lastErr: 'interrupted' }, { key: 'd', attempts: 3, lastErr: 'HTTP 503' }] } });
  const it = E.ST.diagState().items.find(x => x.k === 'stuck');
  assert.equal(it && it.n, 1);
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

test('「設定 › 診断と記録」：ナビは GM・CEO・経理・事務Crew と AM・G4・SL（復旧の道具だけ）・2 つの renderPage に同じ case', () => {
  const navLine = html.split('\n').find(l => /\{ *id: *'diag_center'/.test(l));
  assert.ok(navLine, 'NAV_ITEMS');
  const roles = (navLine.match(/roles: *\[([^\]]*)\]/) || [])[1] || '';
  assert.deepEqual(roles.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort(), ['am', 'ceo', 'g4', 'gm', 'office', 'office_crew', 'sl']);
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

test('版：アプリと Service Worker が 1137 以上でそろう', () => {
  const a = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], b = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(a) >= 1137, String(a));   // v1138 で版を上げても落ちないように
  assert.equal(a, b);
});

test('v1151（Codex #145 6846570741 P2-1）：自動の同期は始めた時刻（started）と、最後に「最新」で終わった同期を始めた時刻（okStarted）を残す。延期・失敗・別の人では進めない', async () => {
  const E = stEnv({ extra: { flushOutbox: async () => {}, retryShiftPlanPending: async () => 0, retryObSecretPending: async () => 0 } });
  E.ctx.supaPullAllMasters = () => Promise.resolve([]);
  assert.equal(E.ST.auto.okStarted, 0);
  const t0 = Date.now();
  const p = E.ST.autoSync('timer');
  const st = E.ST.auto.started;
  assert.ok(st >= t0, 'started is set when the run begins');
  assert.equal(E.ST.autoSync('signal'), p, 'a second call joins the running sync (same start)');
  assert.equal(await p, 'ok');
  assert.equal(E.ST.auto.okStarted, st);
  await tick(5);
  const F = stEnv({ online: false });
  assert.equal(await F.ST.autoSync('signal'), 'offline');
  assert.equal(F.ST.auto.started, 0, 'not started');
  assert.equal(F.ST.auto.okStarted, 0);
  const G = stEnv({ ux: { saveState: () => ({ k: '' }), save: {}, failedList: () => [], _who: () => G.who } });
  G.who = 'p:1';
  G.ctx.flushOutbox = async () => { G.who = 'p:2'; };
  G.ctx.supaPullAllMasters = () => Promise.resolve([]);
  assert.equal(await G.ST.autoSync('timer'), 'changed');
  assert.ok(G.ST.auto.started > 0);
  assert.equal(G.ST.auto.okStarted, 0, 'changed: not up to date');
});
