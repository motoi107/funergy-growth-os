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
function btn(text, onclick, opts) {
  opts = opts || {};
  return { textContent: text, value: '', getAttribute: k => (k === 'onclick' ? (onclick || null) : (k === 'aria-label' ? null : null)),
    hasAttribute: k => !!(opts.attrs && opts.attrs[k]), closest: sel => (opts.inside && sel.indexOf(opts.inside) >= 0 ? {} : null) };
}

test('版：アプリと Service Worker が 1127 でそろう', () => {
  assert.match(html, /const APP_VERSION = '1127';/);
  assert.match(sw, /const SW_BUILD = '1127';/);
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

test('送っている途中で閉じられたキーは、次に開いたとき送信待ちに入れて送り直す', () => {
  const added = []; let flushed = 0;
  const env = fakeEnv({ _outboxAdd: (k, why) => added.push([k, why]), flushOutbox: () => { flushed++; return Promise.resolve(); } });
  env.store.set('_ux_inflight', JSON.stringify({ old_key: Date.now() - 60000, fresh_key: Date.now() }));
  vm.runInContext(uxBlock(), env.ctx);
  const n = env.ctx.window.FUNERGY_UX.recoverInflight();
  assert.equal(n, 1);
  assert.deepEqual(added, [['old_key', 'interrupted']]);
  assert.equal(flushed, 1);
  assert.deepEqual(Object.keys(JSON.parse(env.store.get('_ux_inflight'))), ['fresh_key'], '20 秒以内のもの（ほかのタブが送っている途中）は残す');
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
  assert.match(html, /<button id="ux-save" type="button" class="topbar-icon-btn ux-save" hidden onclick="FUNERGY_UX\.saveInfo\(\)"><\/button>/);
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
  const a = html.indexOf('\nfunction _outboxGet(){'), b = html.indexOf('\n/* 未送信キューを再送');
  assert.ok(a > 0 && b > a, 'push block');
  const store = new Map(), calls = [];
  const ctx = { console, Promise, Date: clock ? clock.Date : Date, JSON, Object, Array, String, setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    _supaBooting: false, _lsPushBlocked: () => false,
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
test('答えない送信のあいだの保存：待っている値は 30 秒で、いちばん新しい値だけ送る。待っているあいだも送信待ちに入っている（独立レビュー P1）', async () => {
  const C = fakeClock(), E = pushEnv(C);
  E.ctx._pushWithOutbox('k5', 'A'); await tick();                    // A：答えない
  C.advance(5000); E.ctx._pushWithOutbox('k5', 'B'); const pB = E.ctx._lsPushP.k5;
  assert.deepEqual(E.outbox(), ['k5'], '待っている値は送信待ちにも入れる（閉じられても次に送る）');
  C.advance(10000); E.ctx._pushWithOutbox('k5', 'C'); const pC = E.ctx._lsPushP.k5;
  assert.equal(pB, pC);
  await tick(); assert.equal(E.calls.length, 1, '30 秒までは待つ');
  C.advance(16000); await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['A', 'C'], 'B は送らない（古い値をあとから送らない）');
  E.calls[1].res(true); assert.equal(await pC, true);
  assert.deepEqual(E.outbox(), [], 'いちばん新しい値が届いたら送信待ちから外す');
  E.calls[0].res(true); await tick(); await tick();
  assert.deepEqual(E.outbox(), [], '古い送信があとで答えても何も変えない');
});
test('答えない送信から 30 秒たって保存したら、待っていた値をその送信にまとめる（あとで古い値を送らない）', async () => {
  const C = fakeClock(), E = pushEnv(C);
  E.ctx._pushWithOutbox('k6', 'A'); await tick();
  C.advance(5000); E.ctx._pushWithOutbox('k6', 'B'); const pB = E.ctx._lsPushP.k6;
  C.timers.forEach(x => { x.on = false; });                          // 待ちの時計が動く前に
  C.t += 30000; E.ctx._pushWithOutbox('k6', 'C'); const pC = E.ctx._lsPushP.k6;
  await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['A', 'C']);
  E.calls[1].res(true);
  assert.equal(await pC, true); assert.equal(await pB, true, '待っていた保存も、まとめた送信の結果で終わる');
  E.calls[0].res(true); await tick(); await tick();
  assert.deepEqual(E.calls.map(c => c.val), ['A', 'C'], 'B をあとから送らない');
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
