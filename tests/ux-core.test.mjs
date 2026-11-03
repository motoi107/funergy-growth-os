// v1127：操作感の共通の決まり（FUNERGY_UX）。ログイン・保存・描き直し・知らせ・モーダルの決まりを、index.html の本物のコードで確かめる。
// ブラウザでの動き（打っている欄・変換・二度押し・保存の知らせ・モーダル）は tests/perf/ux-check.mjs（模擬サーバー・合成データ）。
// ここでは VM と最小の文書の代わりで、判定の決まりと、入れた場所・消した古い書き方を確かめる。ネットワーク・保存・本番のデータは使わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = src => src.replace(/\r\n/g, '\n');
const html = read(fs.readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8'));
const sw = read(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'));
function uxBlock() {
  const a = html.indexOf('/* ============================================================\n   v1127：操作感の共通の決まり（FUNERGY_UX）');
  const b = html.indexOf('</script>', a);
  assert.ok(a > 0 && b > a, 'FUNERGY_UX block');
  return html.slice(a, b);
}
function fnFrom(name) {
  let start = html.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = html.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  return html.slice(start + 1, html.indexOf('\n}', start + 1) + 2);
}
/* 最小の文書の代わり：addEventListener を覚えて、あとで呼べるようにする */
function fakeEnv(extra) {
  const listeners = {};
  const document = {
    readyState: 'loading', body: { appendChild() {} },
    addEventListener(tp, fn) { (listeners[tp] = listeners[tp] || []).push(fn); },
    getElementById() { return null; }, querySelector() { return null; }, createElement() { return { style: {}, setAttribute() {}, classList: { add() {}, remove() {} } }; },
  };
  const store = new Map();
  const window = { addEventListener() {}, matchMedia: () => ({ matches: false }), scrollX: 0, scrollY: 0 };
  const ctx = Object.assign({ window, document, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout, clearTimeout, setInterval: () => 0, Promise, Date, JSON, Math, Object, Array, String, Number, Set, WeakMap, Map, RegExp, console, MutationObserver: function () { this.observe = () => {}; },
    getComputedStyle: () => ({ display: 'block' }), requestAnimationFrame: f => setTimeout(f, 0), navigator: { onLine: true } }, extra || {});
  ctx.window.FUNERGY_UX = undefined;
  vm.createContext(ctx);
  return { ctx, listeners, store, fire(tp, ev) { (listeners[tp] || []).forEach(fn => fn(Object.assign({ isTrusted: true, target: {} }, ev))); } };
}
/* だれの保存か（_saveWho）を同じ文脈に入れ、ログインした人を決める */
function asUser(env, js) { vm.runInContext(fnFrom('_saveWho') + '\nvar curRole = "crew", curStoreLogin = false, loginPerson = null;' + (js || ''), env.ctx); }
function btn(text, onclick, opts) {
  opts = opts || {};
  return { textContent: text, value: '', getAttribute: k => (k === 'onclick' ? (onclick || null) : (k === 'aria-label' ? null : null)),
    hasAttribute: k => !!(opts.attrs && opts.attrs[k]), closest: sel => (opts.inside && sel.indexOf(opts.inside) >= 0 ? {} : null) };
}

test('版：アプリと Service Worker が 1127 以上でそろう', () => {
  const a = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], b = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(a) >= 1127, a);
  assert.equal(a, b);
});

test('共通の決まりは本体の最後（ほかの関数をすべて定義したあと）に 1 つだけ', () => {
  const head = '/* ============================================================\n   v1127：操作感の共通の決まり（FUNERGY_UX）';
  assert.equal(html.split(head).length - 1, 1);
  const a = html.indexOf(head);
  const end = html.indexOf('</script>', a);
  assert.ok(html.indexOf('<script type="module"', a) > end, 'Office のモジュールより前の本体のスクリプトの中');
  assert.ok(html.lastIndexOf('function renderPage(', a) > 0 && html.indexOf('function renderPage(', a) < 0, 'renderPage の定義より後');
});

test('保存・送信・承認などのボタンを見分ける（ナビ・閉じる・開くなどは除く）', () => {
  const env = fakeEnv(); vm.runInContext(uxBlock(), env.ctx);
  const like = env.ctx.window.FUNERGY_UX._saveLike;
  assert.equal(like(btn('保存する')), true);
  assert.equal(like(btn('承認')), true);
  assert.equal(like(btn('申請を送信')), true);
  assert.equal(like(btn('Save')), true);
  assert.equal(like(btn('', "saveKpiManual('F01','2026-10')")), true, '文字が無くても保存の関数');
  assert.equal(like(btn('閉じる', 'closeModalDirect()')), false);
  assert.equal(like(btn('詳細を見る', "openDetail('x')")), false);
  assert.equal(like(btn('＋', "this.classList.remove('x')")), false, 'メソッドの .remove( は保存ではない');
  assert.equal(like(btn('保存する', '', { inside: '.nav-bar' })), false, 'ナビの中は除く');
  assert.equal(like(btn('保存する', '', { attrs: { 'data-ux-repeat': 1 } })), false, '続けて押してよい印');
});

test('「保存しました」は、その操作で送ったものが届いてから。届かなければ送信待ち', async () => {
  const env = fakeEnv(); vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  assert.equal(UX.saveWait('保存しました'), null, '送ったものが無ければ待たない');
  env.fire('pointerdown', {});   // 人の操作
  let res; const p = new Promise(r => { res = r; });
  UX._track('shift_opt_cfg_F01', p);
  assert.equal(UX.saveWait('チェックを外しました'), null, '保存の知らせでなければ待たない');
  const w = UX.saveWait('店舗ルールを保存しました');
  assert.ok(w && typeof w.then === 'function');
  assert.equal(UX.savePending(), true);
  assert.equal(env.store.has('_ux_inflight'), true, '送っている途中は端末に印（閉じられたら次に送り直す）');
  res(true);
  assert.equal(await w, 'ok');
  assert.equal(UX.savePending(), false);
  assert.equal(env.store.has('_ux_inflight'), false);
  env.fire('pointerdown', {});
  UX._track('shift_opt_cfg_F02', Promise.resolve(false));
  const w2 = UX.saveWait('保存しました');
  assert.equal(await w2, 'queued');
});

test('裏の書き込み（人の操作の 2.5 秒より後）は「保存中」に数えない', async () => {
  const env = fakeEnv(); vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  let res; UX._track('tip_labor_F01', new Promise(r => { res = r; }));
  assert.equal(UX.savePending(), false);
  assert.equal(UX.saveWait('保存しました'), null);
  res(true);
});

test('送っている途中で閉じられたキーは、同じ人が次に開いたとき送信待ちに入れて送り直す', () => {
  const added = []; let flushed = 0;
  const env = fakeEnv({ _outboxAdd: (k, why, w) => added.push([k, why, w]), flushOutbox: () => { flushed++; return Promise.resolve(); } });
  asUser(env, 'loginPerson = { id: "A" };');
  env.store.set('_ux_inflight', JSON.stringify({ old_key: { 'p:A': Date.now() - 60000 }, fresh_key: { 'p:A': Date.now() } }));
  vm.runInContext(uxBlock(), env.ctx);
  const n = env.ctx.window.FUNERGY_UX.recoverInflight();
  assert.equal(n, 1);
  assert.deepEqual(added, [['old_key', 'interrupted', 'p:A']], 'その人の送信待ちに入れる');
  assert.equal(flushed, 1);
  assert.deepEqual(Object.keys(JSON.parse(env.store.get('_ux_inflight'))), ['fresh_key'], '20 秒以内のもの（ほかのタブが送っている途中）は残す');
});

test('共有の端末：A の送信の途中でログアウトし B が入っても、A の保存を B のあいだに送り直さない（Codex の PR #118 のレビュー P1）', async () => {
  const added = []; let flushed = 0;
  const env = fakeEnv({ _outboxAdd: (k, why) => added.push([k, why]), flushOutbox: () => { flushed++; return Promise.resolve(); } });
  asUser(env, 'loginPerson = { id: "A" };');
  vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  env.fire('pointerdown', {});
  UX._track('shift_opt_cfg_F01', new Promise(() => {}));            /* A の送信：答えないまま閉じられた */
  const mark = JSON.parse(env.store.get('_ux_inflight'));
  assert.deepEqual(Object.keys(mark.shift_opt_cfg_F01), ['p:A'], 'だれの保存かを覚える');
  mark.shift_opt_cfg_F01['p:A'] -= 60000; env.store.set('_ux_inflight', JSON.stringify(mark));
  vm.runInContext('loginPerson = { id: "B" };', env.ctx);            /* ログアウトして B が入る */
  assert.equal(UX.recoverInflight(), 0);
  assert.deepEqual(added, [], 'B のあいだには送らない');
  assert.equal(flushed, 0);
  assert.ok(JSON.parse(env.store.get('_ux_inflight')).shift_opt_cfg_F01['p:A'], 'A の印は残す');
  vm.runInContext('loginPerson = null; curStoreLogin = true; var curStore = "F01";', env.ctx);   /* 店舗のログインでも送らない */
  assert.equal(UX.recoverInflight(), 0);
  vm.runInContext('curStoreLogin = false; loginPerson = { id: "A" };', env.ctx);   /* A がまた入る */
  assert.equal(UX.recoverInflight(), 1);
  assert.deepEqual(added, [['shift_opt_cfg_F01', 'interrupted']]);
  assert.equal(env.store.has('_ux_inflight'), false);
});

test('だれの保存か分からない前の印（v1127）は送らず、7 日で捨てる。キーが（だれのでも）クラウドに届いたら印を消す', async () => {
  const added = [];
  const env = fakeEnv({ _outboxAdd: (k, why) => added.push([k, why]), flushOutbox: () => Promise.resolve() });
  asUser(env, 'loginPerson = { id: "A" };');
  env.store.set('_ux_inflight', JSON.stringify({ legacy_key: Date.now() - 60000, gone_key: Date.now() - 8 * 86400000, future_key: { 'p:A': Date.now() + 3 * 86400000 }, shared_key: { 'p:B': Date.now() - 60000 } }));
  vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  assert.equal(UX.recoverInflight(), 0);
  assert.deepEqual(added, []);
  const left = JSON.parse(env.store.get('_ux_inflight'));
  assert.deepEqual(Object.keys(left).sort(), ['legacy_key', 'shared_key'], '7 日を過ぎた印・1 日より先の時刻の印（時計が戻った）は捨てる');
  UX._track('shared_key', Promise.resolve(true)); await tick(); await tick();   /* A の（裏の）送信が届いた：端末の今の値がクラウドにある */
  assert.deepEqual(Object.keys(JSON.parse(env.store.get('_ux_inflight'))), ['legacy_key'], 'B の印も要らない');
});

test('描き直し：同期の帯は前に足すだけ（画面全体を 2 回読み直さない）', () => {
  assert.equal(html.split("el.insertAdjacentHTML('afterbegin', pageSyncStrip(_psc));").length - 1, 2);
  assert.equal(html.indexOf('el.innerHTML = pageSyncStrip(_psc) + el.innerHTML'), -1);
});

test('ログイン：二度送らない・前のエラーを消す・PIN を残さない・最初の画面を先に出す', () => {
  const f = fnFrom('doStaffLogin');
  assert.match(f, /if \(window\._uxLoginBusy\) return;/);
  assert.match(f, /errEl\.style\.display = 'none'/);
  assert.equal((f.match(/getElementById\('login-pin-input'\)\.value=''/g) || []).length, 2, '店舗・個人のどちらも');
  assert.match(f, /catch\(e\)\{ console\.error\('doStaffLogin', e\); fail\(\{ server:true \}\); \}/);
  const ls = fnFrom('loginSync');
  assert.ok(!/await loginSyncOps\(\)/.test(ls), 'ログインで店ごとの Toast の写しを待たない');
  assert.match(ls, /window\._uxMastersP = work;/);
  const e = html.slice(html.indexOf('async function enterAppWithSync()'), html.indexOf('/* ログイン時: GUID設定済みの全店'));
  const a = e.indexOf('uxLoginOpsStart(window._uxMastersP)'), b = e.indexOf('await fetchEmpPrivate()'), c = e.indexOf('resolveLoginIdentity()');
  assert.ok(c > 0 && a > c && b > a, 'ログインした人を決めてから、裏で取り込みを始める');
  assert.ok(e.indexOf('empForceLogout(_me); return;') < a, '止まっている人では取り込みを始めない');
  const ops = fnFrom('uxLoginOpsStart');
  assert.match(ops, /if \(seq !== _uxOpsSeq \|\| !curRole\) return;/, 'ログアウトしたら取り込みも描き直しもしない');
});

test('同期の画面：消している途中にまた出したら、前の「消す」を止める', () => {
  const env = fakeEnv();
  const ov = { style: { display: 'none', opacity: '0', pointerEvents: '' } };
  const msg = { textContent: '' };
  env.ctx.document.getElementById = id => (id === 'sync-splash' ? ov : id === 'sync-splash-msg' ? msg : id === 'sync-splash-style' ? {} : null);
  const timers = [];
  env.ctx.setTimeout = (f, ms) => { timers.push({ f, ms, on: true }); return timers.length; };
  env.ctx.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].on = false; };
  env.ctx.requestAnimationFrame = f => f();
  const src = html.slice(html.indexOf('\nfunction showSyncSplash('), html.indexOf('\nfunction setSyncSplash('));
  vm.runInContext(src, env.ctx);
  vm.runInContext("showSyncSplash('a'); hideSyncSplash(); showSyncSplash('b');", env.ctx);
  timers.filter(x => x.on).forEach(x => x.f());
  assert.equal(ov.style.display, 'flex');
  assert.equal(ov.style.opacity, '1');
  assert.equal(ov.style.pointerEvents, 'auto');
  vm.runInContext('hideSyncSplash();', env.ctx);
  assert.equal(ov.style.pointerEvents, 'none', '消し始めたらすぐ押せるように');
  timers.filter(x => x.on).forEach(x => x.f());
  assert.equal(ov.style.display, 'none');
});

test('ログインの所属の並び：読み込むあいだの仮の枠は店のボタンと別の印', () => {
  const g = html.slice(html.indexOf('id="login-store-grid"'), html.indexOf('</div>\n      </div>', html.indexOf('id="login-store-grid"')));
  assert.equal((g.match(/class="ux-ph-cell"/g) || []).length, 10);
  assert.ok(!/class="store-btn/.test(g), '仮の枠を店のボタンとして数えない');
});

test('右上の保存の状態・知らせの置き場・見た目の決まり', () => {
  assert.match(html, /<button id="ux-save" type="button" class="topbar-icon-btn ux-save ux-trio" hidden onclick="FUNERGY_UX\.saveInfo\(\)"><\/button>/);   /* v1137：保存・同期・診断の 3 つ */
  assert.ok(!/id="topbar-sync"/.test(html), 'v1137：右上の「最新に更新」は外した');
  assert.match(html, /@media \(hover: hover\) \{ \.btn:hover \{ opacity: \.85; \} \}/);
  assert.ok(!/\n\.btn:hover \{ opacity: \.85; \}/.test(html), '触れる端末で押したあとの見た目が残らない');
  assert.match(html, /\.btn:disabled, \.btn\[disabled\], \.btn\[aria-disabled="true"\] \{ opacity:\.45; cursor:not-allowed; \}/);
  assert.match(html, /:focus-visible \{ outline:2px solid var\(--accent\); outline-offset:2px; \}/);
  const toast = html.slice(html.indexOf('\nfunction showToast('), html.indexOf('\nfunction _toastGone('));
  assert.match(toast, /\.textContent = text;/, '知らせの文は文字として出す');
  assert.match(toast, /while \(live\.length > 3\)/);
  assert.match(toast, /FUNERGY_UX\.saveWait\(clean\)/);
});

test('描くたびに同じ要素へ処理を足さない・検索欄の値は文字として入れる', () => {
  const f = fnFrom('attachPageEvents');
  assert.equal((f.match(/if \(el\.dataset\.uxEv\) return; el\.dataset\.uxEv = '1';/g) || []).length, 2);
  assert.match(html, /value="\$\{escapeHtml\(empSearchQ\)\}" oninput="empSearch\(this\.value\)/);
});

test('業務の決まり・保存の道は変えない（保存の関数・承認の関数はそのまま。包むだけ）', () => {
  const b = uxBlock();
  for (const name of ['renderPage', 'go', '_pushWithOutbox', 'closeModal', 'doLogout', 'fstOnGuardState']) {
    assert.match(b, new RegExp('var orig[A-Za-z]* = ' + name.replace('_', '\\_') + ';'), name + ' は元の関数を呼ぶ');
  }
  assert.ok(!/approve|budgetStatus|lsSet\(/.test(b.replace(/approve\|/g, '').replace(/lsSet → クラウド/g, '')), '承認・予算・保存を自分ではしない');
});

/* 同じキーの送信の順（_pushWithOutbox）：本物の関数を VM で。クラウドへの送信は代わりの関数（答えを試験で決める） */
function pushEnv(clock) {
  const a = html.indexOf('\nfunction _outboxGet(){'), b = html.indexOf('\n/* 書き戻し診断');
  assert.ok(a > 0 && b > a, 'push block');
  const store = new Map(), calls = [];
  const ctx = { console, Promise, Date: clock ? clock.Date : Date, JSON, Object, Array, String, setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    _supaBooting: false, _lsPushBlocked: () => false, SUPA_SYNC_ENABLED: true, __vals: {}, _LS_SAVE_FAIL: {},
    ls: (k, d) => (k in ctx.__vals ? ctx.__vals[k] : d),
    syncMasterToSupabase: (key, val) => { let res; const p = new Promise(r => { res = r; }); calls.push({ key, val, res }); return p; } };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a + 1, b + 1), ctx);
  return { ctx, calls, outbox: () => JSON.parse(store.get('op_outbox') || '[]').map(x => x.key) };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('同じキーを続けて保存：送っている途中のものが終わってから、最新の値で 1 回だけ送る', async () => {
  const E = pushEnv();
  E.ctx._pushWithOutbox('k1', 'v1'); const p1 = E.ctx._lsPushP.k1;
  await tick();
  E.ctx._pushWithOutbox('k1', 'v2'); const p2 = E.ctx._lsPushP.k1;
  E.ctx._pushWithOutbox('k1', 'v3'); const p3 = E.ctx._lsPushP.k1;
  await tick();
  assert.equal(E.calls.length, 1, '1 つ目が終わるまで送らない');
  assert.equal(p2, p3, '待っている保存は 1 つにまとめる');
  E.calls[0].res(true); assert.equal(await p1, true);
  await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['v1', 'v3'], '途中の値（v2）は飛ばして最新の値を送る');
  E.calls[1].res(true); assert.equal(await p3, true);
  assert.deepEqual(E.outbox(), []);
});

test('古い送信の成功で、まだ送れていない新しい変更を「送れた」にしない', async () => {
  const E = pushEnv();
  E.ctx._pushWithOutbox('k2', 'old'); await tick();
  E.ctx._pushWithOutbox('k2', 'new'); const pNew = E.ctx._lsPushP.k2;
  E.calls[0].res(true); await tick(); await tick();
  E.calls[1].res(false);
  assert.equal(await pNew, false);
  assert.deepEqual(E.outbox(), ['k2'], '新しい変更は送信待ちに残る');
  /* 逆：古い送信が失敗し、新しい送信が届いた → 送信待ちから外れる */
  const F = pushEnv();
  F.ctx._pushWithOutbox('k3', 'old'); await tick();
  F.ctx._pushWithOutbox('k3', 'new'); const q = F.ctx._lsPushP.k3;
  F.calls[0].res(false); await tick(); await tick();
  assert.deepEqual(F.outbox(), ['k3']);
  F.calls[1].res(true); assert.equal(await q, true);
  assert.deepEqual(F.outbox(), []);
});

test('ちがうキーは待たずに送る・送らないキー（undefined）は送信待ちに入れない', async () => {
  const E = pushEnv();
  E.ctx._pushWithOutbox('a', 1); E.ctx._pushWithOutbox('b', 2); await tick();
  assert.equal(E.calls.length, 2);
  E.calls[0].res(undefined); E.calls[1].res(true);
  assert.equal(await E.ctx._lsPushP.a, undefined); assert.equal(await E.ctx._lsPushP.b, true);
  assert.deepEqual(E.outbox(), []);
});

test('新しい送信が先に失敗し、古い送信があとで届いても、送信待ちから外さない（前は外れて、新しい変更が送られないままだった）', async () => {
  const E = pushEnv();
  E.ctx._pushWithOutbox('k4', 'old'); await tick();
  E.ctx._pushWithOutbox('k4', 'new'); await tick();
  if (E.calls.length === 2) { E.calls[1].res(false); await tick(); await tick(); E.calls[0].res(true); await tick(); await tick(); }   // 並べて送る作り：新しいほうが先に答える
  else { E.calls[0].res(true); await tick(); await tick(); E.calls[1].res(false); await tick(); await tick(); }
  assert.deepEqual(E.outbox(), ['k4']);
});

/* 試験の時計（30 秒の待ちを進める） */
function fakeClock() {
  const c = { t: 1000000, timers: [] };
  c.Date = { now: () => c.t };
  c.setTimeout = (f, ms) => { c.timers.push({ f, at: c.t + (ms || 0), on: true }); return c.timers.length; };
  c.clearTimeout = id => { if (c.timers[id - 1]) c.timers[id - 1].on = false; };
  c.advance = ms => { c.t += ms; c.timers.filter(x => x.on && x.at <= c.t).forEach(x => { x.on = false; x.f(); }); };
  return c;
}
test('答えない送信のあいだの保存：30 秒を過ぎても並べて送らない。前の送信が答えてから、いちばん新しい値だけ送る（Codex の PR #118 のレビュー P1）', async () => {
  const C = fakeClock(), E = pushEnv(C);
  E.ctx._pushWithOutbox('k5', 'A'); await tick();                    // A：答えない
  C.advance(5000); E.ctx._pushWithOutbox('k5', 'B'); const pB = E.ctx._lsPushP.k5;
  assert.deepEqual(E.outbox(), ['k5'], '待っている値は送信待ちにも入れる（閉じられても次に送る）');
  C.advance(10000); E.ctx._pushWithOutbox('k5', 'C'); const pC = E.ctx._lsPushP.k5;
  assert.equal(pB, pC);
  C.advance(120000); await tick(); await tick();
  assert.equal(E.calls.length, 1, '2 分たっても、前の送信が答えるまで送らない（2 つを同時に送らない）');
  E.calls[0].res(true); await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['A', 'C'], 'B は送らない（古い値をあとから送らない）');
  E.calls[1].res(true); assert.equal(await pC, true);
  assert.deepEqual(E.outbox(), [], 'いちばん新しい値が届いたら送信待ちから外す');
});
test('サーバーに届く順：同じキーの送信はいつも 1 つずつなので、遅い古い送信があとから適用されて新しい値を上書きすることがない', async () => {
  const C = fakeClock(), E = pushEnv(C);
  let cloud = null; const applied = [];
  const answer = (i, r) => { applied.push(E.calls[i].val); cloud = E.calls[i].val; E.calls[i].res(r); };   /* 答えた時にサーバーで適用されたとみなす */
  E.ctx._pushWithOutbox('k6', 'old'); await tick();
  C.advance(31000); E.ctx._pushWithOutbox('k6', 'new'); await tick(); await tick();
  assert.equal(E.calls.length, 1, '30 秒を過ぎても新しい値は前の送信のあと');
  answer(0, true); await tick(); await tick();                        /* 古い送信が遅れて適用 */
  assert.equal(E.calls.length, 2);
  answer(1, true); await tick(); await tick();
  assert.deepEqual(applied, ['old', 'new']);
  assert.equal(cloud, 'new', '最後は新しい値');
  assert.deepEqual(E.outbox(), []);
});
test('未送信キューの再送も、同じキーを送っている途中なら送らず、その送信のあとに並ぶ（並べて送らない）', async () => {
  const C = fakeClock(), E = pushEnv(C);
  E.ctx._pushWithOutbox('k7', 'A'); await tick();                    // A：送っている途中
  E.ctx._pushWithOutbox('k7', 'B');                                   // 待っている（送信待ちにも入る）
  E.ctx.__vals = { k7: 'B' };
  await E.ctx.flushOutbox();
  assert.equal(E.calls.length, 1, '再送は送っている途中のキーを送らない');
  assert.deepEqual(E.outbox(), ['k7']);
  E.calls[0].res(true); await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['A', 'B']);
  E.calls[1].res(true); await tick(); await tick();
  assert.deepEqual(E.outbox(), []);
  /* 送っていないキーは今までどおり再送し、そのあいだの保存はそのあとに並ぶ */
  E.ctx._outboxAdd('k8', 'x'); E.ctx.__vals.k8 = 'X';
  const f = E.ctx.flushOutbox(); await tick();
  assert.equal(E.calls.at(-1).val, 'X');
  E.ctx._pushWithOutbox('k8', 'Y'); await tick();
  assert.equal(E.calls.filter(c => c.key === 'k8').length, 1, '再送の答えを待つ');
  E.calls.at(-1).res(true); await f; await tick(); await tick();
  assert.deepEqual(E.calls.filter(c => c.key === 'k8').map(c => c.val), ['X', 'Y']);
  assert.deepEqual(E.outbox(), ['k8'], 'Y を送っているあいだは送信待ちに残す');
  E.calls.at(-1).res(true); await tick(); await tick();
  assert.deepEqual(E.outbox(), []);
});
test('待っているあいだに送信待ちに入れた印は、クラウドに送らないキー（undefined）でも外す', async () => {
  const E = pushEnv();
  E.ctx._pushWithOutbox('local_like', 1); await tick();
  E.ctx._pushWithOutbox('local_like', 2); const p = E.ctx._lsPushP.local_like;
  assert.deepEqual(E.outbox(), ['local_like']);
  E.calls[0].res(undefined); await tick(); await tick();
  E.calls[1].res(undefined); assert.equal(await p, undefined);
  assert.deepEqual(E.outbox(), []);
});

/* ---------- v1128（独立レビュー 6f2b5ab）：だれの保存か・送信待ちの持ち主・答えない送信・onboardings の機密 ---------- */
test('だれの保存か：ログインしていない（名前を選んだだけ）は空・PIN と管理者ページの同じ人は同じ印・店舗はその店', () => {
  const env = fakeEnv();
  vm.runInContext(fnFrom('_saveWho') + '\nvar curRole = null, curStoreLogin = false, loginPerson = { id: "A" }, loginLocation = null, curStore = null, curUserName = "";', env.ctx);
  const w = () => vm.runInContext('_saveWho()', env.ctx);
  assert.equal(w(), '', '名前を選んだだけ（PIN の前）はだれでもない');
  vm.runInContext('curRole = "crew";', env.ctx); assert.equal(w(), 'p:A');
  vm.runInContext('window._authSession = { emp_id: "M1", email: "x@y" }; window._secureMode = true;', env.ctx);
  assert.equal(w(), 'p:M1', '管理者ページではメールで確かめた人（選んだ名前ではなく）');
  vm.runInContext('window._authSession = { email: "Boss@Ex.com" };', env.ctx); assert.equal(w(), 'a:boss@ex.com');
  vm.runInContext('window._secureMode = false; window._authSession = null; loginPerson = null; curStoreLogin = true; loginLocation = "F01";', env.ctx);
  assert.equal(w(), 's:F01');
});

test('送信待ちは保存した人のもの：A の送れなかった保存は、B のログインのあいだに送らず、A がまた入ると送る（だれのか分からない前の送信待ちは今までどおり送る）', async () => {
  const E = pushEnv();
  E.ctx.curRole = 'crew'; E.ctx.curStoreLogin = false; E.ctx.loginPerson = { id: 'A' };
  E.ctx._pushWithOutbox('kA', 'a1'); await tick();
  E.ctx.loginPerson = { id: 'B' };                                   /* 送っている途中にログアウトして B が入る */
  E.calls[0].res(false); await tick(); await tick();
  const ob = () => JSON.parse(E.ctx.localStorage.getItem('op_outbox') || '[]');
  assert.deepEqual(ob().map(x => [x.key, x.who]), [['kA', 'p:A']], '送れなかった保存は、保存した A の送信待ち（今の B ではない）');
  E.ctx.localStorage.setItem('op_outbox', JSON.stringify(ob().concat([{ key: 'kOld', attempts: 1, ts: 1 }])));   /* v1127 までの送信待ち（だれのか分からない） */
  E.ctx.__vals = { kA: 'a1', kOld: 'o1' };
  assert.equal(E.ctx.outboxCount(), 1, 'B に見える（送れる）のは前の送信待ちだけ');
  assert.equal(E.ctx._outboxOthers(), 1);
  const f = E.ctx.flushOutbox(); await tick();
  assert.deepEqual(E.calls.slice(1).map(c => c.key), ['kOld'], 'B のあいだは A の保存を送らない');
  E.calls.at(-1).res(true); await f; await tick();
  assert.deepEqual(ob().map(x => x.key), ['kA']);
  E.ctx.loginPerson = { id: 'A' };                                   /* A がまた入る */
  const f2 = E.ctx.flushOutbox(); await tick();
  assert.equal(E.calls.at(-1).key, 'kA'); E.calls.at(-1).res(true); await f2; await tick();
  assert.deepEqual(ob(), []);
});

test('この 1 件を送る：ほかの人の送信待ちは送らない。送っている途中に新しい保存があれば、送信待ちから外さない（2 回数えない）', async () => {
  const E = pushEnv();
  const toasts = [];
  Object.assign(E.ctx, { showToast: (m, k) => toasts.push(m), openDiag: undefined, _opLastPushErr: {}, curRole: 'crew', curStoreLogin: false, loginPerson: { id: 'B' } });
  E.ctx.localStorage.setItem('op_outbox', JSON.stringify([{ key: 'kA', attempts: 1, ts: 1, who: 'p:A' }]));
  E.ctx.__vals = { kA: 'a', kB: 'b1' };
  const r0 = E.ctx.outboxRetryOne('kA'); await tick(); await tick();
  const sentA = E.calls.length; if (sentA) E.calls[0].res(true); await r0;
  assert.equal(sentA, 0, 'A の保存は B から送らない');
  assert.match(toasts.at(-1), /ほかの人の送信待ち/);
  E.ctx._outboxAdd('kB', 'x');
  const r = E.ctx.outboxRetryOne('kB'); await tick();
  E.ctx._pushWithOutbox('kB', 'b2');                                 /* 再送のあいだにまた保存 */
  E.calls[0].res(true); await tick(); await tick(); await r;
  assert.deepEqual(E.calls.map(c => c.val), ['b1', 'b2'], 'b2 を続けて送る');
  assert.ok(JSON.parse(E.ctx.localStorage.getItem('op_outbox')).some(x => x.key === 'kB'), 'b2 を送っているあいだは送信待ちに残す');
  E.calls[1].res(false); await tick(); await tick();
  assert.equal(JSON.parse(E.ctx.localStorage.getItem('op_outbox')).find(x => x.key === 'kB').attempts, 3, '送れなかったのは 1 回だけ数える（x・待ち・失敗）');
});

/* 送る道（supaUpsert・opMergePush・pushOpKeyNow）を、本物の関数で。通信は代わり（答えを試験で決める）・時計も代わり */
function netEnv() {
  const timers = [], reqs = [], local = {}, back = [];
  const ctx = { console, Promise, JSON, Object, Array, String, Math, Date, Number, Error,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; },
    AbortController: class { constructor() { const s = { aborted: false, on: [] }; this.signal = s; this.abort = () => { s.aborted = true; s.on.forEach(f => f()); }; } },
    SUPABASE_URL: 'https://x', supaHeaders: () => ({}), _opLastPushErr: {}, _opLastPushWhy: {}, _opMergeChain: {}, _lastSupaError: null,
    ls: (k, d) => (k in local ? JSON.parse(JSON.stringify(local[k])) : d),
    _opWriteBack: (k, d, v) => back.push(JSON.parse(JSON.stringify(v))),
    _opMergeDef: k => ((k === 'onboardings' || /^spl_onboardings_/.test(k)) ? { merge: (c, l) => { const m = {}; (c || []).forEach(x => { m[x.id] = x; }); (l || []).forEach(x => { m[x.id] = x; }); return Object.values(m); }, covers: () => true } : null),
    fetch: (url, opt) => new Promise((res, rej) => { const r = { url, opt, res, rej }; reqs.push(r); if (opt && opt.signal) opt.signal.on.push(() => rej(new Error('AbortError'))); }) };
  vm.createContext(ctx);
  const v = n => html.match(new RegExp('\\nvar ' + n + ' = [^\\n]*'))[0];
  vm.runInContext([v('_OP_READ_TMO'), v('_OB_SENSITIVE'), fnFrom('stripObPII'), fnFrom('_opCloudVal'), fnFrom('_opUpsertRow'), fnFrom('_supaWriteMs'), fnFrom('supaUpsert'),
    fnFrom('_fetchOpValue'), fnFrom('opMergePush'), fnFrom('pushOpKeyNow')].join('\n'), ctx);
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
  return { ctx, reqs, local, back, ok, fireTimers: () => { timers.splice(0).forEach(t => t.f && t.f()); } };
}

test('答えない書き込みは打ち切って「送れなかった」にする（同じキーの送信が止まり続けない）', async () => {
  const N = netEnv();
  const p = N.ctx.supaUpsert('app_state', [{ key: 'k', value: 1 }]); await tick();
  assert.equal(N.reqs.length, 1); assert.ok(N.reqs[0].opt.signal, '打ち切れる書き込み');
  N.fireTimers(); assert.equal(await p, false);
  assert.match(N.ctx._lastSupaError.body, /timeout/);
  assert.equal(N.ctx._supaWriteMs(0), 45000); assert.equal(N.ctx._supaWriteMs(2000000), 145000); assert.equal(N.ctx._supaWriteMs(1e9), 300000);
});

test('合流して送るキー：送る前の読み込みが答えなければ書かない（端末の値で丸ごと書かない）', async () => {
  const N = netEnv();
  const p = N.ctx.opMergePush('onboardings', [{ id: 1 }]); await tick(); await tick();
  assert.equal(N.reqs.length, 1, '読み込みだけ');
  N.fireTimers(); assert.equal(await p, false);
  assert.equal(N.reqs.length, 1, '書いていない');
  assert.match(N.ctx._opLastPushErr.onboardings, /答えませんでした/);
});

test('新しく入った人（onboardings）の機密は、合流の道でもクラウドに書かない（端末の値はそのまま）', async () => {
  const N = netEnv();
  const ob = { id: 1, name: 'X', personal: { ssn: '123', address: 'a', dob: 'd', phone: 'p', email: 'e', visa: 'v', visaDetail: 'vd', pos: 'keep' }, docs: [{ name: 'Passport', image: 'data:image/png;base64,AA', uploadedAt: 't' }] };
  const p = N.ctx.opMergePush('onboardings', [ob]); await tick(); await tick();
  N.reqs[0].res(N.ok([{ value: [{ id: 2, name: 'Y' }] }])); await tick(); await tick(); await tick();
  const w = JSON.parse(N.reqs[1].opt.body)[0].value;
  assert.deepEqual(w.map(x => x.id).sort(), [1, 2], 'ほかの端末の行も残す');
  const mine = w.find(x => x.id === 1);
  assert.deepEqual(mine.personal, { pos: 'keep' }, '住所・電話・メール・生年月日・SSN・ビザは書かない');
  assert.deepEqual(mine.docs, [{ name: 'Passport', uploadedAt: 't' }], '書類の画像は書かない');
  N.reqs[1].res(N.ok(null)); await tick(); await tick();
  N.reqs[2].res(N.ok([{ value: w }])); assert.equal(await p, true);
  assert.equal(N.back[0].find(x => x.id === 1).personal.ssn, '123', '端末の値は変えない');
  /* 人ごとに分けた行（spl_onboardings_<名前>。lsSet('onboardings') が実際に送る行）も同じ */
  const p2 = N.ctx.opMergePush('spl_onboardings_X', [ob]); await tick(); await tick();
  N.reqs[3].res(N.ok([])); await tick(); await tick(); await tick();
  const w2 = JSON.parse(N.reqs[4].opt.body)[0].value[0];
  assert.equal(w2.personal.ssn, undefined); assert.equal(w2.docs[0].image, undefined);
  N.reqs[4].res(N.ok(null)); await tick(); await tick(); N.reqs[5].res(N.ok([{ value: [w2] }])); assert.equal(await p2, true);
  assert.equal(N.ctx._opCloudVal('spl_onboardings_X', [ob])[0].personal.ssn, undefined);
  assert.equal(N.ctx._opCloudVal('spl_offboardings_X', [ob])[0].personal.ssn, '123', 'ほかのキーは変えない');
});

test('招待をすぐ送る（pushOpKeyNow）：同じキーの合流の送信のあとに並び、クラウドの最新に重ねて書く・機密を外す・端末は書き換えない・失敗は false', async () => {
  const N = netEnv();
  N.local.onboardings = [{ id: 1, name: 'X', personal: { ssn: '9' } }];
  const first = N.ctx.opMergePush('onboardings', N.local.onboardings); await tick(); await tick();
  const p = N.ctx.pushOpKeyNow('onboardings'); await tick(); await tick();
  assert.equal(N.reqs.length, 1, 'ふだんの送信が終わるまで待つ');
  N.reqs[0].res(N.ok([])); await tick(); await tick(); await tick();
  N.reqs[1].res(N.ok(null)); await tick(); await tick();
  N.reqs[2].res(N.ok([{ value: [{ id: 1 }] }])); await first; await tick(); await tick();
  N.reqs[3].res(N.ok([{ value: [{ id: 1, name: 'X' }, { id: 7, name: 'Other' }] }])); await tick(); await tick(); await tick();
  const w = JSON.parse(N.reqs[4].opt.body)[0].value;
  assert.deepEqual(w.map(x => x.id).sort(), [1, 7], 'ほかの端末の行を消さない');
  assert.equal(w.find(x => x.id === 1).personal.ssn, undefined);
  N.reqs[4].res({ ok: false, status: 500, text: async () => 'x' });
  assert.equal(await p, false, '書けなければ false（前はいつも true）');
  assert.equal(N.back.length, 1, 'pushOpKeyNow は端末を書き換えない');
});

test('ログアウト：自分の送れていない保存があれば、送ってみてから知らせる（キャンセルでログアウトしない）。止めるためのログアウトでは聞かない', () => {
  let out = 0, flushed = 0; const asked = [];
  const env = fakeEnv({ doLogout: () => { out++; }, flushOutbox: () => { flushed++; return Promise.resolve(); }, t: (ja) => ja });
  asUser(env, 'loginPerson = { id: "A" };');
  vm.runInContext('function _outboxMine(){ return [{ key: "k", who: "p:A" }, { key: "old" }]; }', env.ctx);
  env.ctx.confirm = m => { asked.push(m); return false; };
  vm.runInContext(uxBlock(), env.ctx);
  vm.runInContext('doLogout()', env.ctx);
  assert.equal(out, 0); assert.equal(flushed, 1); assert.match(asked[0], /送れていない保存が 1 件/);
  env.ctx.window._forceLogout = true; vm.runInContext('doLogout()', env.ctx);
  assert.equal(out, 1); assert.equal(asked.length, 1);
});

test('直接送っていた所（店舗マスターの移し替え・LaLa・Totoya のスキル・この 1 件を送る）は、同じキーの送信の順に並ぶ（_pushAwait）', () => {
  assert.equal((html.match(/_pushAwait\('m_stores', stores\)/g) || []).length, 2, '店舗マスターの移し替え 2 か所');
  assert.match(fnFrom('outboxRetryOne'), /await _pushAwait\(key, cur\)/);
  assert.ok(!/syncMasterToSupabase\(/.test(fnFrom('outboxRetryOne')), 'この 1 件を送るは直接送らない');
  assert.match(html, /await _pushAwait\(pushKeys\[k\]\[0\], pushKeys\[k\]\[1\]\)/, 'Totoya のスキルの一括');
  assert.match(html, /await _pushAwait\('skill_lv_desc'/);
  assert.match(html, /await _pushAwait\('lala_tasks'/);
});

test('合流の決まりの無い送り方（syncMasterToSupabase）も、人ごとに分けた行の機密を外す', () => {
  assert.match(fnFrom('syncMasterToSupabase'), /_opCloudVal\(key, val\)/);
});

/* v1129（11/01 の依頼 ④）：ログインのあとの裏の取り込みで、右上が「保存中…」と点滅しない。通信が切れたら右上に出す */
test('v1129 ④：裏の自動の保存（売上・予算）を送っているあいだは「保存中…」にしない・確かめが要るときは出す', () => {
  const st = { status: 'idle', auto: false };
  const guard = { getState: () => Object.freeze(Object.assign({ enabled: true }, st)) };
  const nav = { onLine: true };
  const env = fakeEnv({ FUNERGY_FINANCIAL_SAVE: guard, navigator: nav, outboxCount: () => 0 });
  env.ctx.window.FUNERGY_FINANCIAL_SAVE = guard;
  vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  const k = () => UX.saveState().k;
  assert.equal(k(), '');
  st.status = 'saving'; st.auto = true;
  assert.equal(k(), '', '自動の保存を送っているあいだ');
  st.status = 'checking';
  assert.equal(k(), '', '自動の保存の答えを確かめているあいだ');
  st.status = 'unknown';
  assert.equal(k(), 'check', '自動の保存でも答えが確かめられなければ出す');
  st.status = 'conflict';
  assert.equal(k(), 'check', '重なったときも出す');
  st.status = 'saving'; st.auto = false;
  assert.equal(k(), 'saving', '人が押した保存は今までどおり「保存中…」');
  st.status = 'checking';
  assert.equal(k(), 'saving');
});

test('v1129 ④：通信が切れたら、送るものが無くても右上に「オフライン」。送信待ちがあれば件数', () => {
  const nav = { onLine: false };
  let n = 0;
  const env = fakeEnv({ navigator: nav, outboxCount: () => n });
  vm.runInContext(uxBlock(), env.ctx);
  const UX = env.ctx.window.FUNERGY_UX;
  assert.equal(UX.saveState().k, 'offline');
  n = 2;
  const s = UX.saveState();
  assert.equal(s.k, 'queued'); assert.equal(s.n, 2); assert.equal(s.off, true);
  n = 0; nav.onLine = true;
  assert.equal(UX.saveState().k, '', 'つながれば消える');
  assert.ok(uxBlock().includes("if(s.k === 'offline') return T('オフライン（つながると最新を取りに行きます）'"), '右上の言葉');
});
