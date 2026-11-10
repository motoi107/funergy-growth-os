// v1145（Moto さん 11/10「外すボタンを足す」）：サーバーが断った送信待ちを、確かめの画面のあとに外す。
// 決めた人だけが書ける設定（swIsKey：グレード履歴・ガソリン代の単価・Score管理・賞与と Career Score の設定 8 つ）は、書く役割でない端末の変更を
// サーバーが断る（403。形の合わない記録は 400）。断られた変更は何度送っても届かず、送信待ちに残り続けていた（Codex #139 6760482271 の ②）。
// アプリの本物の送信の列（_pushWithOutbox・_pushRun・送信待ち op_outbox・flushOutbox）・送信（syncMasterToSupabase・opMergePush・ssPutRow）・
// 外す道（ssRefusedMark・ssRefusedList・ssDropRefused・openRefusedDrop・ssDropRefusedRun）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 合成データだけ（架空の人と店。本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandler, SW2_KEYS } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE } from './lib/secure-state-world.mjs';

const source = readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  start += 1;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = source.slice(i + 1, source.indexOf('\n', i + 1)); assert.ok(/\}\s*(\/\*.*\*\/)?\s*$/.test(l), name); return l; };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
const DEFS = Object.fromEntries(['mileage_config', 'career_cfg', ...SW2_KEYS, 'grade_hist'].map(k => {
  if (k === 'mileage_config') return [k, 'null'];
  const m = source.match(new RegExp('^  ' + k + ':\\s+(\\{[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return [k, m[1]];
}));

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite', '_opUpsertRow', 'opMergePush', 'syncMasterToSupabase', 'supaHeaders'].map(fn),
  ...['_recAt', 'kevN', 'kevV1Has', '_kevPT'].map(oneLine),
  varLine(/^var KEV_EV_META = .*$/m),
  ...['mergeMapByTime', '_coversMapByTime', 'kevMergeEvRec', 'kevMergeVerRec', 'kevMergeMap', 'kevCoversMap'].map(fn),
  // 送信待ちの列（本物）
  ...['_outboxGet', '_outboxSet', '_outboxAdd', '_saveWho', '_pushWithOutbox', '_pushRun', '_pushAwait', 'flushOutbox', 'outboxLabel'].map(fn),
  ...['_outboxRemove', '_outboxMine', '_outboxOthers', 'outboxCount', '_pushQOf', '_pushBusy'].map(oneLine),
  varLine(/^var _pushQ = \{\};.*$/m),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[], SUPA_SYNC_ENABLED=true, _LS_SAVE_FAIL={}, _outboxFlushing=false, _lsPushP={};
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curPage='', __alerts=[], __toasts=[], __modal=null, __rendered=[];
   var MEM=new Map(), __fetched=[];
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, j){ if(window.__noLocal) return false; MEM.set(k, j); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsMarkFetched(k){ __fetched.push(k); }
   function _lsPushBlocked(){ return false; }
   function ls(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); _pushWithOutbox(k, v); return true; }
   function lsKeys(){ return [...MEM.keys()]; }
   function _lsCloudPending(){ return false; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   function csIsKey(k){ return false; } function csOnLogout(){} function piiFnMark(){}
   var __DEFS={ ${Object.entries(DEFS).map(([k, d]) => JSON.stringify(k) + ':' + d).join(', ')} };
   function _opMergeDef(k){ return __DEFS[k] || null; }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function showToast(m, kind){ __toasts.push([m, kind]); } function alert(m){ __alerts.push(m); }
   function openModal(h){ __modal=h; } function closeModalDirect(){ __modal=null; } function renderPage(p){ __rendered.push(p); } function _lsRerenderSoon(){ __rendered.push('soon'); }
   function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
   var document={ getElementById:function(){ return null; } };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
};
const USER = { tGM: 'gm', tAM: 'am', t4: 'g4' };
const T0 = '2026-11-09T09:00:00.000000+00:00';
const GH0 = {
  'E-1': { recs: [{ id: 'gh1', d: '2026-04-01', g: 'G1', from: '', start: true, src: 'hire', by: 'Gina M', at: '2026/04/01 10:00', note: '' }], name: 'Kai One', _at: 1762500000000 },
  'E-4': { recs: [{ id: 'gh2', d: '2026-06-30', g: 'G4', from: 'G3', start: false, src: 'title', by: 'Gina M', at: '2026/06/30 10:00', note: '' }], name: 'Leo Four', _at: 1762500000001 },
};
const ghMore = (id, at) => ({ ...GH0, [id]: { recs: [{ id: 'n-' + id, d: '2026-11-08', g: 'G2', from: 'G1', start: false, src: 'title', by: 'Amy Area', at: '2026/11/08 10:00', note: '' }], name: 'X ' + id, _at: at || 1762700000000 } });
const GUIDE0 = { 'H1@ja': { v: { what: 'x' }, _at: 1762500000000 } };

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: {}, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 10, 10, 0, 0) });
  if (!o.noGh) W.set('grade_hist', GH0, T0);
  W.set('cs_guide', GUIDE0, T0);
  return W;
}
// 1 台の端末（localStorage は端末ごと）。who を変えるとログインが変わる
function device(W, who) {
  const store = new Map();
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => W.fetch(u, o), localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } });
  c.window = c;
  vm.runInContext(CODE, c);
  c.__store = store;
  login(c, who);
  return c;
}
function login(c, who) { c._hwSession = who; vm.runInContext('curRole=' + JSON.stringify(USER[who]) + '; curRealRole=curRole;', c); }
const save = async (c, k, v) => { c.lsSet(k, v); return c._lsPushP[k]; };
const writesOf = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);
const outKeys = c => c._outboxGet().map(x => x.key).sort();
const J = x => JSON.parse(JSON.stringify(x));   // vm の配列・オブジェクトをこちらの形に

test('a change the server refuses is marked and listed (403 for the AM; 400 for a bad shape from the GM); resending never delivers it', async () => {
  const W = world();
  const am = device(W, 'tAM');
  assert.equal(await save(am, 'grade_hist', ghMore('E-9')), false);
  assert.deepEqual(outKeys(am), ['grade_hist'], 'kept in the unsent list');
  assert.deepEqual(am.ssRefusedList().map(x => ({ key: x.key, st: x.st, label: x.label })), [{ key: 'grade_hist', st: 403, label: 'グレード履歴' }]);
  for (let i = 0; i < 3; i++) await am.flushOutbox();
  assert.deepEqual(outKeys(am), ['grade_hist'], 'still unsent after resending (the stuck state)');
  assert.equal(am.ssRefusedList().length, 1);
  assert.deepEqual(W.get('grade_hist'), GH0, 'the cloud row is unchanged');
  assert.ok(am.__toasts.some(([m]) => /右上の「保存」の「断られたものを外す」で外せます/.test(m)), am.__toasts.map(x => x[0]).join(' | '));

  const gm = device(W, 'tGM');
  assert.equal(await save(gm, 'grade_hist', { ...GH0, odd: 'x' }), false);
  assert.deepEqual(gm.ssRefusedList().map(x => [x.key, x.st]), [['grade_hist', 400]]);
  assert.equal(gm.ssRefusedWhy(400), '形の合わない記録があります');
  assert.equal(gm.ssRefusedWhy(403), '変えられる人が決まっている設定です');
});

test('removing puts the device back to the cloud value (no merge), takes it out of the unsent list and clears the mark — nothing is written to the cloud', async () => {
  const W = world();
  const am = device(W, 'tAM');
  await save(am, 'grade_hist', ghMore('E-9'));
  const n0 = writesOf(W, 'grade_hist').length;
  const r = await am.ssDropRefused(['grade_hist']);
  assert.deepEqual(J({ done: r.done, skip: r.skip }), { done: ['grade_hist'], skip: [] });
  assert.deepEqual(JSON.parse(am.MEM.get('grade_hist')), GH0, 'the device now has exactly the cloud value (the refused record is gone)');
  assert.deepEqual(outKeys(am), []);
  assert.equal(am.ssRefusedList().length, 0);
  assert.equal(am.__store.get('_ss_refused_v1'), undefined, 'the mark is gone');
  assert.ok(am.__fetched.includes('grade_hist'));
  assert.equal(writesOf(W, 'grade_hist').length, n0, 'no write');
  assert.deepEqual(W.get('grade_hist'), GH0);
  await am.flushOutbox();
  assert.deepEqual(W.get('grade_hist'), GH0, 'nothing comes back later');
});

test('when the cloud has no row, removing deletes the device value', async () => {
  const W = world({ noGh: true });
  const am = device(W, 'tAM');
  assert.equal(await save(am, 'grade_hist', ghMore('E-9')), false);
  const r = await am.ssDropRefused(['grade_hist']);
  assert.deepEqual(J(r.done), ['grade_hist']);
  assert.equal(am.MEM.has('grade_hist'), false);
  assert.deepEqual(outKeys(am), []);
  assert.equal(W.get('grade_hist'), undefined);
});

test('only refused saves of the person signed in: a GM save that went through, a not-refused unsent save, and another person\'s refused save are not removed', async () => {
  const W = world();
  const gm = device(W, 'tGM');
  assert.equal(await save(gm, 'grade_hist', ghMore('E-9')), true);
  assert.deepEqual(J(gm.ssRefusedList()), []);
  assert.deepEqual(J(await gm.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'gone' }]);

  // 断られていない送信待ち（通信の失敗）は外さない
  const W2 = world(); const am2 = device(W2, 'tAM');
  W2.ssDown = true; W2.afterGet = null;
  am2._outboxAdd('cs_guide', 'push failed');
  assert.deepEqual(J(am2.ssRefusedList()), [], 'no mark without a server refusal');
  assert.deepEqual(J(await am2.ssDropRefused(['cs_guide'])).skip, [{ key: 'cs_guide', why: 'gone' }]);
  assert.deepEqual(outKeys(am2), ['cs_guide']);

  // 同じ端末で、AM の断られた送信待ちは G4 のログインのあいだは出ない・外せない（AM がまたログインすれば出る）
  const am = device(W, 'tAM');
  await save(am, 'grade_hist', ghMore('E-8'));
  login(am, 't4');
  assert.deepEqual(J(am.ssRefusedList()), []);
  assert.deepEqual(J(await am.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'gone' }]);
  assert.deepEqual(outKeys(am), ['grade_hist'], 'the AM\'s entry stays');
  login(am, 'tAM');
  assert.deepEqual(am.ssRefusedList().map(x => x.key), ['grade_hist']);
});

test('not removed when the cloud cannot be read, while it is being sent, when it is saved again or the sign-in changes during the read, or when the device cannot write', async () => {
  // クラウドを読めない
  let W = world(), c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  const realFetch = W.fetch;
  c.fetch = (u, o) => (String(u).includes('/rest/v1/app_state') && (!o || !o.method || o.method === 'GET')) ? Promise.reject(new TypeError('fetch failed')) : realFetch(u, o);
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'read' }]);
  assert.deepEqual(JSON.parse(c.MEM.get('grade_hist')), ghMore('E-9'), 'the device value stays');
  assert.deepEqual(outKeys(c), ['grade_hist']);
  assert.equal(c.ssRefusedList().length, 1);

  // 送っている途中
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  c._pushQOf('grade_hist').busy = Date.now();
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'busy' }]);
  c._pushQOf('grade_hist').busy = 0;

  // 読んでいるあいだにこの端末でまた保存された
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  W.afterGet = url => { if (!String(url).includes('grade_hist')) return false; c.MEM.set('grade_hist', JSON.stringify(ghMore('E-7'))); return true; };
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'changed' }]);
  assert.deepEqual(JSON.parse(c.MEM.get('grade_hist')), ghMore('E-7'), 'the newer device value is kept');
  assert.deepEqual(outKeys(c), ['grade_hist']);

  // 読んでいるあいだにログインが変わった
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  W.afterGet = url => { if (!String(url).includes('grade_hist')) return false; login(c, 't4'); return true; };
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'changed' }]);
  login(c, 'tAM');
  assert.deepEqual(outKeys(c), ['grade_hist']);

  // 読んでいるあいだに、ほかの道（ほかのタブの送信など）で送信待ちから外れた：読む前の値でこの端末を書き換えない
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  W.afterGet = url => { if (!String(url).includes('grade_hist')) return false; c._outboxRemove('grade_hist'); return true; };
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'changed' }]);
  assert.deepEqual(JSON.parse(c.MEM.get('grade_hist')), ghMore('E-9'), 'the device value is not rewritten');

  // だれのか分からない前の版の送信待ち（who なし。だれのログインでも出る）でも、読んでいるあいだにログインが変われば外さない
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  c._outboxSet(c._outboxGet().map(x => { const y = { ...x }; delete y.who; return y; }));
  assert.deepEqual(J(c.ssRefusedList().map(x => x.key)), ['grade_hist']);
  W.afterGet = url => { if (!String(url).includes('grade_hist')) return false; login(c, 't4'); return true; };
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'changed' }]);
  assert.deepEqual(outKeys(c), ['grade_hist']);

  // この端末に書けない
  W = world(); c = device(W, 'tAM');
  await save(c, 'grade_hist', ghMore('E-9'));
  c.__noLocal = true;
  assert.deepEqual(J(await c.ssDropRefused(['grade_hist'])).skip, [{ key: 'grade_hist', why: 'local' }]);
  assert.deepEqual(outKeys(c), ['grade_hist']);
  assert.equal(c.ssRefusedList().length, 1, 'the mark stays');
});

test('the mark goes away when the server accepts the key later (the same value as the cloud, or a GM save on the device) and is not set for other keys', async () => {
  const W = world();
  const am = device(W, 'tAM');
  await save(am, 'grade_hist', ghMore('E-9'));
  assert.equal(am.ssRefusedList().length, 1);
  // 端末の値をクラウドと同じに戻して保存（サーバーは書かずに通す）
  assert.equal(await save(am, 'grade_hist', GH0), true);
  assert.deepEqual(outKeys(am), []);
  assert.equal(am.__store.get('_ss_refused_v1'), undefined);

  // 同じ端末で GM が保存すると、GM の権限で送られる（前からの動き）：印も消える
  await save(am, 'grade_hist', ghMore('E-9'));
  assert.equal(am.ssRefusedList().length, 1);
  login(am, 'tGM');
  assert.equal(await save(am, 'grade_hist', ghMore('E-6', 1762700000005)), true);
  assert.deepEqual(outKeys(am), []);
  assert.equal(am.__store.get('_ss_refused_v1'), undefined);

  // swIsKey でないキーには印を付けない（成長カルテ・Career Score などはこの道に入れない）
  am.ssRefusedMark('growth_karte', 403); am.ssRefusedMark('tasks_all', 403); am.ssRefusedMark('lss_emp_x', 403);
  assert.equal(am.__store.get('_ss_refused_v1'), undefined);
});

test('the confirmation screen lists what will be removed; pressing the button removes only what was shown, logs it without contents, and re-renders', async () => {
  const W = world();
  const am = device(W, 'tAM');
  await save(am, 'grade_hist', ghMore('E-9'));
  assert.equal(await save(am, 'cs_guide', { ...GUIDE0, 'H2@ja': { v: { what: 'y' }, _at: 1762700000000 } }), false);
  assert.deepEqual(am.ssRefusedList().map(x => x.key).sort(), ['cs_guide', 'grade_hist']);
  const logs = []; am.FUNERGY_STATUS = { log: (k, m, ok) => logs.push([k, m, ok]), paintSoon: () => {} };

  am.openRefusedDrop('grade_hist');
  assert.ok(am.__modal, 'a confirmation opens (nothing removed yet)');
  assert.match(am.__modal, /グレード履歴/);
  assert.doesNotMatch(am.__modal, /評価基準・例/, 'only the one asked for');
  assert.match(am.__modal, /この端末で入れたこの変更は消えます（元に戻せません）/);
  assert.match(am.__modal, /GM・CEO に伝えて入れ直して/);
  assert.match(am.__modal, /id="ss-refused-go" onclick="ssDropRefusedRun\(\)"/);
  assert.doesNotMatch(am.__modal, /メールのアカウントと社員の ID の結び/, 'the GM note is for GM/CEO only');
  assert.deepEqual(outKeys(am), ['cs_guide', 'grade_hist'], 'opening does not remove');

  vm.runInContext("curPage='diag_center';", am);
  const r = await am.ssDropRefusedRun();
  assert.deepEqual(J(r.done), ['grade_hist']);
  assert.deepEqual(outKeys(am), ['cs_guide'], 'the other refused save stays');
  assert.equal(am.__modal, null, 'closed');
  assert.deepEqual(J(logs), [['store', 'サーバーが断った送信待ちを外しました：グレード履歴（この端末の値をクラウドの値に戻した）', true]]);
  assert.ok(am.__toasts.some(([m, k]) => m === '外しました（1 件）。この端末はクラウドの値に戻りました' && k === 'success'));
  assert.deepEqual(J(am.__rendered), ['diag_center']);
  assert.deepEqual(J(await am.ssDropRefusedRun()), { done: [], skip: [] }, 'pressing again without the screen removes nothing');

  am.openRefusedDrop();
  assert.match(am.__modal, /評価基準・例/);
  const realFetch = W.fetch; am.fetch = (u, o) => (String(u).includes('/rest/v1/app_state') && (!o || !o.method || o.method === 'GET')) ? Promise.reject(new TypeError('fetch failed')) : realFetch(u, o);   // 読み込みを失敗させる
  const r2 = await am.ssDropRefusedRun();
  assert.deepEqual(J(r2.skip), [{ key: 'cs_guide', why: 'read' }]);
  assert.ok(am.__toasts.some(([m, k]) => m === '外せなかったもの：評価基準・例（クラウドを読めませんでした（つながる所でもう一度））' && k === 'warning'), am.__toasts.map(x => x[0]).join(' | '));

  // GM・CEO の画面には、外す前に結びを確かめる文
  const gm = device(world(), 'tGM');
  await save(gm, 'grade_hist', { ...GH0, odd: 'x' });
  gm.openRefusedDrop();
  assert.match(gm.__modal, /メールのアカウントと社員の ID の結び/);
  // 何も無ければ画面を開かない
  const none = device(world(), 'tAM');
  none.openRefusedDrop();
  assert.equal(none.__modal, null);
  assert.ok(none.__toasts.some(([m]) => m === 'サーバーが断った送信待ちはありません'));
});

test('English screen', async () => {
  const W = world();
  const am = device(W, 'tAM');
  vm.runInContext("function t(ja, en){ return en; } var curLang='en';", am);
  await save(am, 'grade_hist', ghMore('E-9'));
  assert.equal(am.ssRefusedList()[0].label, 'Grade history');
  am.openRefusedDrop();
  assert.match(am.__modal, /Remove saves the server refused/);
  assert.match(am.__modal, /The change made on this device is lost \(cannot be undone\)/);
  const r = await am.ssDropRefusedRun();
  assert.deepEqual(J(r.done), ['grade_hist']);
  assert.ok(am.__toasts.some(([m]) => m === 'Removed (1). This device now has the cloud value'));
});

test('labels: every key that can be refused has a readable name in Japanese and English (bonus_coef_rng before bonus_coef)', () => {
  const c = device(world(), 'tAM');
  const keys = ['grade_hist', 'mileage_config', 'career_cfg', ...SW2_KEYS];
  for (const k of keys) { assert.equal(c.swIsKey(k), true, k); assert.notEqual(c.outboxLabel(k), k, k + ' ja'); }
  assert.equal(c.outboxLabel('bonus_coef_rng'), '賞与の係数の幅');
  assert.equal(c.outboxLabel('bonus_coef'), '賞与の係数');
  vm.runInContext("var curLang='en';", c);
  for (const k of keys) assert.match(c.outboxLabel(k), /^[A-Z0-9][A-Za-z0-9 -]+$/, k + ' en');
});

test('the screens: the top-right Save panel and Settings › Diagnostics show the refused saves with a button that opens the confirmation; the check counts them apart from "failed repeatedly"', () => {
  const st = source.slice(source.indexOf('ST.fillPop = function(pop){'), source.indexOf('/* ---------- 自動の同期 ---------- */'));
  assert.match(st, /ssRefusedList\(\)/);
  assert.match(st, /このうちサーバーが断ったもの ' \+ refused\.length \+ ' 件（このままでは届きません）：/);
  assert.match(st, /\n    if\(refused\.length && typeof openRefusedDrop === 'function'\) btns\.push\('<button type="button" class="btn btn-secondary btn-sm" data-ux-repeat="1" data-st-act="drop">' \+ esc\(T\('断られたものを外す…', 'Remove refused…'\)\) \+ '<\/button>'\);/);
  assert.match(st, /if\(act === 'drop'\)\{ try\{ pop\.classList\.remove\('on'\); \}catch\(e\)\{\} try\{ openRefusedDrop\(\); \}catch\(e\)\{\} return; \}/, 'the panel button only opens the confirmation');
  const ds = source.slice(source.indexOf('ST.diagState = function(){'), source.indexOf('ST.extraPending = function(){'));
  assert.match(ds, /!rf\[x\.key\] && \(Number\(x\.attempts\)/, 'not double-counted as failed repeatedly');
  assert.match(ds, /k: 'refused', n: nrf/);
  const dc = source.slice(source.indexOf('ST.renderDiagCenter = function(){'), source.indexOf('/* ② Toast の取り直し'));
  assert.match(dc, /onclick="openRefusedDrop\(\\'' \+ qk \+ '\\'\)">' \+ esc\(T\('外す…', 'Remove…'\)\)/);
  assert.match(dc, /onclick="openRefusedDrop\(\)"><i class="ti ti-cloud-x"><\/i> ' \+ esc\(T\('断られたものを外す…', 'Remove refused…'\)\)/);
  const od = fn('openOutboxDiag');
  assert.match(od, /closeModalDirect\(\); openRefusedDrop\(\);/);
  assert.match(fn('ssPutRow'), /if\(r\.status===403\)\{\n    ssRefusedMark\(key, 403\);/);
  assert.match(fn('ssPutRow'), /if\(r\.status===400\)\{\n    ssRefusedMark\(key, 400\);/);
  assert.match(oneLine('_outboxRemove'), /ssRefusedClear\(key\)/);
});
