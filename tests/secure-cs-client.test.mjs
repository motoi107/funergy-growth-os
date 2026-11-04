// v1140（2b の 2 つ目）のアプリ側：Career Score の点・申請・履歴を、REST（公開の鍵）ではなく関数 secure-state で受け取る・送る。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows・csTake・csSeenRecord）・送信（syncMasterToSupabase・opMergePush・_opCasWrite）・
// 1 つのキーの読み込み（pullOpKey）・履歴（_lsRequestDeferredPrefix → csHistPull）・端末で書いてよいか（csLocalWriteOk）を vm で動かし、
// 本物の関数 secure-state（handler）と合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。前の版の関数は、入れる一式の v1139 の 1 ファイル。
// 合成データだけ（架空の人と店。本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, SS } from './lib/secure-state-world.mjs';

const source = readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  start += 1;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
// 1 行で書いた関数（fn だと次の関数まで取ってしまう）
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = source.slice(i + 1, source.indexOf('\n', i + 1)); assert.ok(l.trimEnd().endsWith('}'), name); return l; };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };

// 前の版の関数（v1139）：入れる一式の 1 ファイル（Deno の起動の行を外して読む）
const v1139Src = readFileSync(new URL('../deploy/secure-state-v1139/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1139-'));
writeFileSync(join(tmp, 'handler.mjs'), v1139Src);
const { createHandler: createHandler1139 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite',
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'supaHeaders', '_lsRequestDeferredPrefix',
    '_srPending', 'mergeSkillReq', 'mergeLssReq'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=['spl_lss_history_'], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null, _lsDeferReq={};
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, __pending={}, __fetched={}, __alerts=[], __toasts=[], __rerender=0, __failed=[];
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   /* アプリの lsSet の入口と同じ：Career Score の行はこの端末で書いてよいときだけ（csLocalWriteOk） */
   function lsSet(k, v){ if(!csLocalWriteOk(k)){ __failed.push(k); return false; } MEM.set(k, JSON.stringify(v)); return true; }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(k){ __failed.push(k); }
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(k){ return k.indexOf('spl_lss_history_')===0; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _lsSetVerified(k, j){ return _lsWriteVerified(k, j); } function _lsFreeOldLaborKeys(){} function _lsRerenderSoon(){ __rerender++; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   /* 試験用の合流：点は新しい _at、申請は id の和集合（決まった申請が勝つ） */
   function _opMergeDef(k){
     if(k.indexOf('lss_emp_')===0) return { merge:function(c, l){ return (!l || ((c&&c._at)||0)>=((l&&l._at)||0)) ? c : l; }, covers:function(c, m){ return JSON.stringify(c)===JSON.stringify(m); } };
     /* 申請：アプリと同じ合流（OP_MERGE.lss_requests＝mergeLssReq）。__reqMerge で前の合流（mergeSkillReq）に替えられる */
     if(k.indexOf('spl_lss_requests_')===0) return { merge:function(c, l){ return (__reqMerge || mergeLssReq)(c, l); },
       covers:function(c, m){ return JSON.stringify(c)===JSON.stringify(m); } };
     return null;
   }
   var __reqMerge=null;
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function karteRerender(){ __rerender++; } function showToast(m){ __toasts.push(m); }
   var __inputs=[]; async function askInput(){ return __inputs.shift(); } function alert(m){ __alerts.push(m); }
   var document={ getElementById:function(id){ return __els[id] || null; } }, __els={};`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-3', name: 'Sam Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-2', name: 'Cora Two', store: 'S1', role: 'g2', title: 'Crew Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-1b', name: 'Ben S2', store: 'S2', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  t3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sam Three' },
  t2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Cora Two' },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  tStore: 'deny',
};
const USER = { tGM: ['gm', 'Gina M'], t3: ['sl', 'Sam Three'], t2: ['g2', 'Cora Two'], t1: ['crew', 'Kai One'], tStore: ['sl', ''] };
const T0 = '2026-11-03T09:00:00.000000+00:00';
const NAMES = EMPS.map(e => e.name);

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: { 'aaaaaaaa-0000-0000-0000-000000000001': { role: 'gm', emp_id: 'E-GM' } }, ...o });
  let clock = Date.UTC(2026, 10, 4, 10, 0, 0);
  W.tick = ms => { clock += ms; };
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = (o.old ? createHandler1139 : createHandler)({ env, fetch: W.fetch, now: () => clock });
  for (const n of NAMES) {
    W.set('lss_emp_' + n, { s: { 'A-1': 2 }, _at: 1 }, T0);
    W.set('spl_lss_requests_' + n, [{ id: 'r-' + n, name: n, status: '承認' }], T0);
    W.set('spl_lss_history_' + n, [{ name: n, total: 40 }], T0);
  }
  W.set('lss_scores', Object.fromEntries(NAMES.map(n => [n, { s: { 'A-1': 1 } }])), T0);
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-05' } }, T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
  return W;
}
function tab(W, who) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  if (who) login(c, who);
  return c;
}
function login(c, who) {
  c._hwSession = who; c.curRole = USER[who][0]; c.curRealRole = USER[who][0]; c.curUserName = USER[who][1];
  vm.runInContext('curRole=' + JSON.stringify(USER[who][0]) + '; curRealRole=curRole; curUserName=' + JSON.stringify(USER[who][1]) + '; curStoreLogin=' + (who === 'tStore' ? '{ id:"S1" }' : 'null') + ';', c);
}
const local = (c, k) => { const v = c.MEM.get(k); return v == null ? undefined : JSON.parse(v); };
const csKeys = c => [...c.MEM.keys()].filter(k => c.csIsKey(k)).sort();
// 取り込みはアプリと同じ順（supaPullAllMasters の裏の取り込み：取り込む直前にログインを比べる ssStaleRows → _applyKvRows → 印）
const apply = (c, rows0) => { const rows = c.ssStaleRows ? c.ssStaleRows(rows0) : rows0; const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); c.csSeenRecord(rows, ok); return rows; };
const pull = async (c, force) => apply(c, await c._kvPullRows(!!force));
// ログアウト（doLogout と同じ順：ssOnLogout のあとにログインの記録を消す）
const logout = c => { c.ssOnLogout(); c._hwSession = null; vm.runInContext('curRole=null; curRealRole=null; curUserName=null; curStoreLogin=false;', c); };
// 答えの配送だけを止める（関数・クラウドはもう答えを作った＝Codex の再現と同じ）。止めた順に 1 つずつ放せる
function holder(c, W) {
  const held = []; let pred = null;
  c.fetch = async (u, o) => {
    const res = await W.fetch(u, o);
    if (pred && pred(String(u), o)) await new Promise(r => held.push(r));
    return res;
  };
  const ticks = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
  return { hold: p => { pred = p; }, n: () => held.length, releaseOne: async () => { held.shift()(); await ticks(); }, release: async () => { pred = null; held.splice(0).forEach(r => r()); await ticks(); } };
}
const body = o => { try { return JSON.parse((o && o.body) || '{}'); } catch { return {}; } };
const ssAsk = (pin, action) => (u, o) => u === SS && body(o).pin_session === pin && (!action || body(o).action === action);
const until = async f => { for (let i = 0; i < 500 && !f(); i++) await new Promise(r => setTimeout(r, 0)); assert.ok(f(), 'waited'); };
const state = c => JSON.parse(c.localStorage.getItem('_cs_state') || 'null');

test('GM: every Career Score row (not history) comes from the function, none through the public key; unchanged rows are not sent again', async () => {
  const W = world({ rls: true, rlsCs: true });
  const c = tab(W, 'tGM');
  await pull(c);
  assert.equal(W.calls.anonCs, 0, 'no Career Score row through the public key');
  assert.deepEqual(csKeys(c), [...NAMES.map(n => 'lss_emp_' + n), 'lss_scores', ...NAMES.map(n => 'spl_lss_requests_' + n)].sort());
  assert.deepEqual(local(c, 'lss_scores'), W.get('lss_scores'), 'the full old row');
  assert.equal(state(c).level, 'full');
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } }, 'other rows still by REST');
  await pull(c);
  assert.equal(W.ssLast.cs.rows.length, 0, 'unchanged rows are skipped');
  assert.equal(W.ssLast.rows.length, 0, 'the karte/bonus part too (its versions are still recorded)');
  W.set('lss_emp_Ben S2', { s: { 'A-1': 3 }, _at: 7 }, '2026-11-04T11:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual(W.ssLast.cs.rows.map(r => r.key), ['lss_emp_Ben S2']);
  assert.deepEqual(local(c, 'lss_emp_Ben S2'), { s: { 'A-1': 3 }, _at: 7 });
});

test('G3 on a device that had everything (the v1139 REST way): only the people in scope stay; others and the full old rows leave the device', async () => {
  const W = world();
  const c = tab(W, 't3');
  for (const n of NAMES) { c.MEM.set('lss_emp_' + n, JSON.stringify(W.get('lss_emp_' + n))); c.MEM.set('spl_lss_requests_' + n, JSON.stringify(W.get('spl_lss_requests_' + n))); c.MEM.set('spl_lss_history_' + n, JSON.stringify(W.get('spl_lss_history_' + n))); }
  c.MEM.set('lss_scores', JSON.stringify(W.get('lss_scores')));
  c.MEM.set('lss_emp_Gina M', JSON.stringify({ s: { mine: 1 }, _at: 99 })); c.__pending['lss_emp_Gina M'] = true;   // 送れていない変更のある行は残す
  await pull(c);
  const want = ['Sam Three', 'Cora Two', 'Kai One'];
  assert.deepEqual(state(c).names, [...want].sort());
  assert.deepEqual(csKeys(c), [...want.map(n => 'lss_emp_' + n), ...want.map(n => 'spl_lss_requests_' + n), ...want.map(n => 'spl_lss_history_' + n), 'lss_emp_Gina M', 'lss_scores'].sort());
  assert.deepEqual(Object.keys(local(c, 'lss_scores')).sort(), [...want].sort(), 'the old combined row: only the part about the people in scope');
  assert.equal(W.calls.anonCs, 0, 'no Career Score row through the public key (before the SQL as well)');
  // 2 回目：見せる形の前の統合行は同じ印なら残す（届き直さない）
  await pull(c);
  assert.equal(W.ssLast.cs.rows.length, 0);
  assert.ok(local(c, 'lss_scores'));
  // 範囲が変わる（Kai さんが S2 へ）：Kai さんの行が端末から消える
  W.emps.find(e => e.id === 'E-1').store = 'S2';
  await pull(c);
  assert.ok(!csKeys(c).some(k => k.endsWith('Kai One')));
  assert.deepEqual(Object.keys(local(c, 'lss_scores')).sort(), ['Cora Two', 'Sam Three']);
});

test('even if the server ignored the "not" filters, Career Score rows from REST never land on a scoped device', async () => {
  const W = world({ ignoreNot: true });
  const c = tab(W, 't1');
  await pull(c);
  assert.deepEqual(csKeys(c), ['lss_emp_Kai One', 'lss_scores', 'spl_lss_requests_Kai One']);
  assert.deepEqual(Object.keys(local(c, 'lss_scores')), ['Kai One']);
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } });
});

test('the device writes Career Score rows only for people in scope (and never the old combined rows when scoped)', async () => {
  const W = world();
  const c = tab(W, 't2');
  await pull(c);
  assert.deepEqual(state(c).names, ['Cora Two', 'Kai One']);
  assert.equal(c.csSees('Kai One'), true); assert.equal(c.csSees('Ben S2'), false, 'the screens show “—” for people outside the scope');
  assert.equal(c.csLocalWriteOk('lss_emp_Kai One'), true);
  assert.equal(c.csLocalWriteOk('spl_lss_requests_Cora Two'), true);
  assert.equal(c.csLocalWriteOk('lss_emp_Ben S2'), false, 'outside the scope: a partial copy would be pushed by a GM device later');
  assert.equal(c.csLocalWriteOk('lss_scores'), false);
  assert.equal(c.csLocalWriteOk('m_other'), true);
  assert.equal(c.__toasts.length, 2, 'told (once per kind)');
  assert.equal(c.lsSet('lss_emp_Ben S2', { s: {} }), false);
  assert.equal(local(c, 'lss_emp_Ben S2'), undefined);
  // ほかの人がこの端末でログインし直した：範囲を受け取り直すまで書かない・本人だけ見せる
  login(c, 't3');
  assert.equal(c.csLocalWriteOk('lss_emp_Kai One'), false);
  assert.equal(c.csSees('Kai One'), false); assert.equal(c.csSees('Sam Three'), true);
  await pull(c);
  assert.equal(c.csLocalWriteOk('lss_emp_Kai One'), true);
  // 範囲がまだ決まっていない端末（関数が前の版・v1139 から上げた直後）：今までどおり
  const d = tab(world(), 't3');
  assert.equal(d.csLocalWriteOk('lss_emp_Ben S2'), true); assert.equal(d.csSees('Ben S2'), true);
});

test('writes go through the function: the OJT pass of a G1 (raise only), own requests; a refusal stays unsent with a message', async () => {
  const W = world({ rls: true, rlsCs: true });
  W.set('lss_emp_Kai One', { scores: { 'A-1': 1 }, evaluator: 'Sam Three', status: '確定', _at: 1 }, T0);
  const c = tab(W, 't3');
  await pull(c);
  // G3：自分の店の G1 の分野の下限を上げる（OJT の合格。アプリの g2RaiseAxisFloor と同じ形）
  const up = { ...local(c, 'lss_emp_Kai One'), scores: { 'A-1': 2, 'A-2': 2 }, date: '2026/11/04', autoOjt: true, _at: 5 };
  assert.equal(await c.syncMasterToSupabase('lss_emp_Kai One', up), true);
  assert.deepEqual(W.get('lss_emp_Kai One'), up);
  // 自分の申請を足す（読んで合流して書く）
  const mine = [...local(c, 'spl_lss_requests_Sam Three'), { id: 'n1', name: 'Sam Three', status: '申請中' }];
  assert.equal(await c.syncMasterToSupabase('spl_lss_requests_Sam Three', mine), true);
  assert.deepEqual(W.get('spl_lss_requests_Sam Three').map(r => r.id).sort(), ['n1', 'r-Sam Three']);
  // 自分の点：サーバーが断る（送信待ちに残る・知らせる）
  const t0 = c.__toasts.length;
  assert.equal(await c.syncMasterToSupabase('lss_emp_Sam Three', { s: { 'A-1': 3 }, _at: 9 }), false);
  assert.deepEqual(W.get('lss_emp_Sam Three'), { s: { 'A-1': 2 }, _at: 1 });
  assert.ok(c.__toasts.length > t0 && /Career Score/.test(c.__toasts.at(-1)));
  // 下げる・上限（G1 は 2）を超える：断る
  assert.equal(await c.syncMasterToSupabase('lss_emp_Kai One', { ...up, scores: { 'A-1': 1, 'A-2': 2 }, _at: 6 }), false);
  assert.equal(await c.syncMasterToSupabase('lss_emp_Kai One', { ...up, scores: { 'A-1': 3, 'A-2': 2 }, _at: 6 }), false);
  assert.deepEqual(W.get('lss_emp_Kai One'), up);
  // Crew Leader は OJT にサインしない（アプリの g2CanEdit）：G1 の点は見えるが書けない
  const d = tab(W, 't2');
  await pull(d);
  assert.equal(d.csSees('Kai One'), true);
  assert.equal(await d.syncMasterToSupabase('lss_emp_Kai One', { ...up, scores: { 'A-1': 2, 'A-2': 2, 'B-1': 2 }, _at: 7 }), false);
  assert.ok(!W.log.some(([, role, key]) => role === 'anon' && c.csIsKey(key)), 'the public key never wrote a Career Score row');
  // 1 つのキーの読み込み（pullOpKey）も関数から：範囲の外は読めない（REST にも落ちない）
  assert.equal(await c.pullOpKey('lss_emp_Kai One'), true);
  assert.equal(await c.pullOpKey('lss_emp_Ben S2'), false);
  assert.equal(W.calls.anonCs, 0);
});

test('history opens through the function: only the people in scope; out-of-scope history leaves the device', async () => {
  const W = world({ rls: true, rlsCs: true });
  const c = tab(W, 't3');
  await pull(c);
  c.MEM.set('spl_lss_history_Ben S2', JSON.stringify([{ name: 'Ben S2', total: 1 }]));
  c._lsRequestDeferredPrefix('spl_lss_history_');
  for (let i = 0; i < 20 && !c.MEM.has('spl_lss_history_Kai One'); i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(local(c, 'spl_lss_history_Kai One'), [{ name: 'Kai One', total: 40 }]);
  assert.equal(local(c, 'spl_lss_history_Ben S2'), undefined);
  assert.equal(local(c, 'spl_lss_history_Gina M'), undefined);
  assert.equal(W.calls.anonCs, 0);
});

test('with the v1139 function (no Career Score): the app keeps the REST way for Career Score, and the karte/bonus part works as before', async () => {
  const W = world({ old: true });
  const c = tab(W, 't3');
  await pull(c);
  assert.equal(state(c), null, 'no scope recorded: screens work as before');
  assert.ok(csKeys(c).includes('lss_emp_Ben S2'), 'Career Score still by REST (as v1139)');
  assert.ok(W.calls.anonCs > 0);
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj', 'the karte projection still from the function');
  // 書き込みも REST（前の版の関数は Career Score のキーを受けない）
  const n = W.calls.anonCs;
  assert.equal(await c.syncMasterToSupabase('lss_emp_Kai One', { s: { x: 1 }, _at: 4 }), true);
  assert.deepEqual(W.get('lss_emp_Kai One'), { s: { x: 1 }, _at: 4 });
  assert.ok(W.calls.anonCs > n);
  assert.equal(c.csSees('Ben S2'), true);
});

test('when the function goes back to v1139, the recorded scope is cleared (screens as before) and Career Score comes by REST again', async () => {
  const W = world();
  const c = tab(W, 't3');
  await pull(c);
  assert.equal(state(c).level, 'scoped'); assert.equal(c.csSees('Ben S2'), false);
  c._lsRequestDeferredPrefix('spl_lss_history_');   // 範囲の中の履歴を関数から取った
  for (let i = 0; i < 40 && !c.MEM.has('spl_lss_history_Kai One'); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(c.MEM.has('spl_lss_history_Kai One') && !c.MEM.has('spl_lss_history_Ben S2'));
  W.ssHandler = createHandler1139({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: W.fetch, now: () => Date.now() });
  await pull(c);
  assert.equal(state(c), null);
  assert.equal(c.csSees('Ben S2'), true);
  assert.ok(csKeys(c).includes('lss_emp_Ben S2'));
  // 履歴も今までどおり REST から取り直す（関数から取ったときの「取った」の印を残さない）
  c._lsRequestDeferredPrefix('spl_lss_history_');
  for (let i = 0; i < 40 && !c.MEM.has('spl_lss_history_Ben S2'); i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(local(c, 'spl_lss_history_Ben S2'), [{ name: 'Ben S2', total: 40 }]);
});

test('a store login (401) and a shared device: no Career Score on the device; logout clears what the next person should not see', async () => {
  const W = world();
  const s = tab(W, 'tStore');
  s.MEM.set('lss_emp_Kai One', JSON.stringify(W.get('lss_emp_Kai One')));
  await pull(s);
  assert.deepEqual(csKeys(s), []);
  assert.equal(state(s).level, 'none');
  assert.equal(s.csLocalWriteOk('lss_emp_Kai One'), false);
  // G3 がログアウト：見られる人の分も端末に残さない（次の人の範囲で受け取り直す）。送れていない行は残す
  const c = tab(W, 't3');
  await pull(c);
  c.MEM.set('lss_emp_Kai One', JSON.stringify({ s: { 'A-1': 3 }, _at: 50 })); c.__pending['lss_emp_Kai One'] = true;
  c.ssOnLogout();
  assert.deepEqual(csKeys(c), ['lss_emp_Kai One']);
  assert.equal(state(c), null);
  // GM の端末（共有でない）：ログアウトしても全部の写しはそのまま（今までどおり）
  const g = tab(W, 'tGM');
  await pull(g);
  const n = csKeys(g).length;
  g.ssOnLogout();
  assert.equal(csKeys(g).length, n);
});

test('if the scope cannot be decided (people tables unreadable), the device keeps its copy and does not fall back to REST', async () => {
  const W = world({ rlsCs: false });
  const c = tab(W, 't3');
  await pull(c);
  const before = csKeys(c);
  W.mgrDown = true;
  const n = W.calls.anonCs;
  await pull(c);
  assert.deepEqual(csKeys(c), before);
  assert.equal(W.calls.anonCs, n, 'no REST read of Career Score');
  assert.equal(state(c).level, 'scoped', 'the last scope is kept');
});

// 独立レビュー（bcb64c3）の P3 の直し
test('a withdrawal and an approval that cross: the approval wins on the requester’s device too, so the push is accepted (it used to stay unsent forever)', async () => {
  for (const merge of ['old', 'new']) {
    const W = world({ rls: true, rlsCs: true });
    const K = 'spl_lss_requests_Kai One';
    W.set(K, [{ id: 'r-Kai One', name: 'Kai One', status: '承認' }, { id: 'p1', name: 'Kai One', status: '申請中', total: 50 }], T0);
    const c = tab(W, 't1');
    if (merge === 'old') vm.runInContext('__reqMerge = mergeSkillReq;', c);   // v1140 の最初の形（OP_MERGE.lss_requests＝mergeSkillReq）
    await pull(c);
    // 本人が取り下げているあいだに、GM が承認する（点はもう書いてある）
    W.set(K, [{ id: 'r-Kai One', name: 'Kai One', status: '承認' }, { id: 'p1', name: 'Kai One', status: '承認', total: 50, reviewedBy: 'Gina M' }], '2026-11-04T10:30:00.000000+00:00');
    const mine = local(c, K).map(r => r.id === 'p1' ? { ...r, status: '取消' } : r);
    const ok = await c.syncMasterToSupabase(K, mine);
    if (merge === 'old') { assert.equal(ok, false, 'the old merge kept the withdrawal and the server refused it'); continue; }
    assert.equal(ok, true);
    assert.equal(W.get(K).find(r => r.id === 'p1').status, '承認', 'the approval stays');
  }
  // アプリの合流の表：前の統合行（lss_requests）も、分割の行（spl_lss_requests_…＝_opMergeDef が lss_requests の決まりを使う）も mergeLssReq
  assert.match(source, /\n  lss_requests: +\{ merge: mergeLssReq, +covers: _coversSkillReq \}/);
  // 合流は順によらない（どの端末でも同じ）。申請中は決めたものに負ける（今までどおり）
  const c = tab(world());
  const m = (x, y) => JSON.parse(JSON.stringify(c.mergeLssReq(x, y)));
  const a = [{ id: 1, status: '取消' }], b = [{ id: 1, status: '却下', by: 'GM' }], p = [{ id: 1, status: '申請中' }];
  assert.deepEqual(m(a, b), b); assert.deepEqual(m(b, a), b);
  assert.deepEqual(m(p, a), a); assert.deepEqual(m(a, p), a);
  assert.deepEqual(m([{ id: 1, status: '承認', x: 1 }], [{ id: 1, status: '承認', x: 2 }]), [{ id: 1, status: '承認', x: 2 }], 'two decisions: the device copy, as before');
  assert.deepEqual(m([{ id: 1, status: '取消', x: 1 }], [{ id: 1, status: '取消', x: 2 }]), [{ id: 1, status: '取消', x: 2 }]);
});

test('history is fetched again for the next person and when the scope changes (the “already fetched” flag is not kept)', async () => {
  const W = world();
  const c = tab(W, 't3');
  await pull(c);
  const open = async key => { c._lsRequestDeferredPrefix('spl_lss_history_'); for (let i = 0; i < 40 && !c.MEM.has(key); i++) await new Promise(r => setTimeout(r, 5)); };
  await open('spl_lss_history_Kai One');
  assert.ok(c.MEM.has('spl_lss_history_Kai One'));
  // 範囲が広がる（Ben さんが S1 へ）：もう一度取る
  W.emps.find(e => e.id === 'E-1b').store = 'S1';
  await pull(c);
  await open('spl_lss_history_Ben S2');
  assert.deepEqual(local(c, 'spl_lss_history_Ben S2'), [{ name: 'Ben S2', total: 40 }]);
  // ログアウト → 別の人（Kai さん）がログイン：その人の範囲で取り直す
  c.ssOnLogout();
  assert.ok(!c.MEM.has('spl_lss_history_Kai One'), 'a scoped device keeps no Career Score after logout');
  login(c, 't1');
  await pull(c);
  await open('spl_lss_history_Kai One');
  assert.deepEqual(local(c, 'spl_lss_history_Kai One'), [{ name: 'Kai One', total: 40 }]);
  assert.ok(!c.MEM.has('spl_lss_history_Ben S2'));
});

test('when the pull goes the REST way (a CEO/GM without a PIN mark), the scope of the last person is not kept', async () => {
  const W = world();
  const c = tab(W, 't3');
  await pull(c);
  assert.equal(state(c).level, 'scoped'); assert.equal(c.csSees('Ben S2'), false);
  login(c, 'tGM'); c._hwSession = '';   // 共有の端末で GM がログイン（PIN の印なし＝今までどおり REST）
  await pull(c);
  assert.equal(state(c), null);
  assert.equal(c.csSees('Ben S2'), true);
  assert.equal(c.csLocalWriteOk('lss_emp_Ben S2'), true);
});

test('the old combined request row folds into the per-person rows with the app’s own fold, only for people in scope, and those rows go back through the function', async () => {
  const W = world({ rls: true, rlsCs: true });
  W.set('lss_requests', ['Kai One', 'Cora Two', 'Ben S2', 'Gina M'].map(n => ({ id: 'old-' + n, name: n, status: '承認', total: 30 })), T0);
  const code = CODE
    .replace('var _SPLIT_KEYS={}', "var _SPLIT_KEYS={ lss_requests:{type:'arr', by:function(r){return r&&r.name;}} }")
    .replace('function _handleLegacySplitRow(){ return false; }', [...['_handleLegacySplitRow', '_foldLegacyIntoPartitions', '_splitPartitionsRaw', '_splitFoldable'].map(fn), ...['_splitPrefix', '_splitRecKey'].map(oneLine)].join('\n'));
  assert.notEqual(code, CODE);
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c; vm.runInContext(code, c); login(c, 't3');
  await pull(c);
  assert.equal(c.MEM.has('lss_requests'), false, 'the combined row is folded, not kept');
  assert.deepEqual(local(c, 'spl_lss_requests_Kai One').map(r => r.id).sort(), ['old-Kai One', 'r-Kai One']);
  assert.deepEqual(local(c, 'spl_lss_requests_Cora Two').map(r => r.id).sort(), ['old-Cora Two', 'r-Cora Two']);
  assert.ok(!c.MEM.has('spl_lss_requests_Ben S2') && !c.MEM.has('spl_lss_requests_Gina M'), 'nobody outside the scope');
  assert.equal(c.__failed.length, 0, 'every fold write was allowed on the device');
  for (const n of ['Kai One', 'Cora Two']) assert.equal(await c.syncMasterToSupabase('spl_lss_requests_' + n, local(c, 'spl_lss_requests_' + n)), true, n);
  assert.deepEqual(W.get('spl_lss_requests_Kai One').map(r => r.id).sort(), ['old-Kai One', 'r-Kai One']);
  assert.deepEqual(W.get('spl_lss_requests_Ben S2').map(r => r.id), ['r-Ben S2'], 'the other people’s rows are untouched');
  // 2 回目：前の統合行は届き直さない（同じ印）
  await pull(c);
  assert.ok(!W.ssLast.cs.rows.some(r => r.key === 'lss_requests'));
});

test('Codex P1 (#133 6641596764): a GM answer that arrives after the shared device switched to crew is thrown away (scope, rows, marks)', async () => {
  const W = world({ rls: true, rlsCs: true });
  const c = tab(W, 't1');
  await pull(c);   // クルーが先に使った（共有の端末）：本人だけ
  const before = csKeys(c);
  assert.deepEqual(before, ['lss_emp_Kai One', 'lss_scores', 'spl_lss_requests_Kai One']);
  assert.deepEqual(Object.keys(local(c, 'lss_scores')), ['Kai One'], 'the old combined row: only the crew’s part');
  logout(c); login(c, 'tGM');
  const h = holder(c, W); h.hold(ssAsk('tGM', 'pull'));
  const gm = pull(c);
  await until(() => h.n() === 1);
  logout(c); login(c, 't1');
  await pull(c);                     // クルーの取り込みが先に終わる
  await h.release(); await gm;       // そのあと GM の答えが届く
  assert.equal(state(c).level, 'scoped');
  assert.equal(state(c).who, 'Kai One|crew|');
  assert.deepEqual(state(c).names, ['Kai One']);
  assert.deepEqual(csKeys(c), before, 'no other person’s Career Score on the device');
  assert.deepEqual(Object.keys(local(c, 'lss_scores')), ['Kai One'], 'not the GM’s full combined row');
  assert.equal(c.csSees('Ben S2'), false);
  assert.equal(c.csLocalWriteOk('lss_emp_Ben S2'), false);
  assert.deepEqual(Object.keys(c.csSeenGet()).sort(), before, 'marks only for the crew’s rows');
  assert.equal(W.calls.anonCs, 0);
  // 次の取り込みもクルーの範囲のまま
  await pull(c);
  assert.deepEqual(csKeys(c), before);
});

test('Codex P1: the GM answer after logout (nobody signed in), and answers in reverse order, change nothing', async () => {
  const W = world({ rls: true, rlsCs: true });
  // ログアウトのあとに届く
  const c = tab(W, 't1');
  await pull(c);
  logout(c); login(c, 'tGM');
  const h = holder(c, W); h.hold(ssAsk('tGM', 'pull'));
  const gm = pull(c);
  await until(() => h.n() === 1);
  logout(c);
  await h.release(); await gm;
  assert.equal(state(c), null, 'no scope recorded for nobody');
  assert.deepEqual(csKeys(c), [], 'no Career Score row (the crew’s copies were cleared at logout)');
  assert.equal(c.ssState(), 'part');
  assert.ok(!c.MEM.has('growth_karte') || !JSON.stringify(local(c, 'growth_karte')).includes('payLog'));
  // 逆順：GM の答えを止めたままクルーも頼み、GM → クルーの順に届く
  const d = tab(W, 't1');
  await pull(d);
  logout(d); login(d, 'tGM');
  const h2 = holder(d, W); h2.hold((u, o) => u === SS && body(o).action === 'pull');
  const gm2 = pull(d);
  await until(() => h2.n() === 1);
  logout(d); login(d, 't1');
  const crew2 = pull(d);
  await until(() => h2.n() === 2);
  await h2.releaseOne(); await gm2;      // 先に GM
  assert.ok(!d.MEM.has('lss_emp_Ben S2'), 'the GM answer is not used while the crew is signed in');
  assert.notEqual(state(d) && state(d).level, 'full');
  await h2.releaseOne(); await crew2;    // そのあとクルー
  assert.equal(state(d).level, 'scoped');
  assert.deepEqual(csKeys(d), ['lss_emp_Kai One', 'lss_scores', 'spl_lss_requests_Kai One']);
  assert.deepEqual(Object.keys(local(d, 'lss_scores')), ['Kai One']);
});

test('Codex P1: a sign-in change while the public rows are loading, or before the pulled rows are put on the device, keeps the GM rows off', async () => {
  const W = world({ rls: true, rlsCs: true });
  // 取り込む直前（supaPullAllMasters の裏の取り込み）にログインが変わる
  const c = tab(W, 't1');
  await pull(c);
  logout(c); login(c, 'tGM');
  const rows = await c._kvPullRows(false);
  assert.ok(rows.some(r => r.key === 'lss_emp_Ben S2'), 'the GM pull itself got everything');
  logout(c); login(c, 't1');
  const put = apply(c, rows);
  assert.ok(!put.some(r => c.csIsKey(r.key) || c.ssIsKey(r.key)), 'stale rows lose the secure keys');
  assert.equal(put.length, rows.filter(r => !c.csIsKey(r.key) && !c.ssIsKey(r.key)).length, 'public rows are still applied');
  assert.ok(!c.MEM.has('lss_emp_Ben S2') && !c.MEM.has('lss_scores'));
  assert.equal(state(c), null, 'the GM scope was cleared at logout and is not put back');
  // 同じログインのままなら何も外さない
  const g = tab(W, 'tGM');
  const rg = await g._kvPullRows(false);
  assert.equal(g.ssStaleRows(rg), rg);
  // 公開の行（REST）を待つあいだにログインが変わる
  const d = tab(W, 't1');
  await pull(d);
  logout(d); login(d, 'tGM');
  const h = holder(d, W); h.hold(u => u.startsWith(URL0 + '/rest/v1/app_state?'));
  const gm = d._kvPullRows(true);   // 「クラウドから取り込む」（公開の行も全部取る）
  await until(() => h.n() === 1);
  logout(d); login(d, 't1');
  await h.release();
  const rows2 = await gm;
  assert.ok(!rows2.some(r => d.csIsKey(r.key) || d.ssIsKey(r.key)), 'no secure row comes out of a pull that went stale');
  apply(d, rows2);
  assert.ok(!d.MEM.has('lss_emp_Ben S2'));
});

test('Codex P1: a GM history pull and a single-key read that arrive after the switch are not kept', async () => {
  const W = world({ rls: true, rlsCs: true });
  const c = tab(W, 't1');
  await pull(c);
  logout(c); login(c, 'tGM');
  await pull(c);
  const h = holder(c, W);
  // 履歴（開いたときだけ）
  h.hold(ssAsk('tGM', 'hist'));
  c._lsRequestDeferredPrefix('spl_lss_history_');
  await until(() => h.n() === 1);
  logout(c); login(c, 't1');
  await h.release();
  assert.equal(c.lsKeys('spl_lss_history_').length, 0, 'no history arrives on the crew device');
  assert.equal(c._lsDeferReq['#spl_lss_history_'], undefined, 'the history can be asked again (for the crew)');
  // 1 つのキー
  logout(c); login(c, 'tGM');
  await pull(c);
  c.MEM.delete('lss_emp_Ben S2');
  h.hold(ssAsk('tGM', 'get'));
  const one = c.pullOpKey('lss_emp_Ben S2');
  await until(() => h.n() === 1);
  logout(c); login(c, 't1');
  await h.release();
  assert.equal(await one, false, 'read as "could not read"');
  assert.ok(!c.MEM.has('lss_emp_Ben S2'));
});


// ---- 守りを 1 つずつ確かめる（わざと壊して落ちるように）----
const ticks = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
// IndexedDB を読み終える前（ssIdbReady が待つ）に止めておき、そのあいだにログインを変える
function idbGate(c) { let open; c._idbState = 'init'; c._idbBootP = new Promise(r => { open = r; }); return async () => { c._idbState = 'ready'; open(); await ticks(); }; }

test('Codex P1: the sign-in token changes on each part (logout, name, store sign-in, PIN mark, email sign-in) and not otherwise', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  const tk = c.ssToken();
  assert.equal(c.ssStale(tk), false, 'same sign-in');
  assert.equal(c.ssStale(null), false);
  c.ssOnLogout(); assert.equal(c.ssStale(tk), true, 'logout alone (same name and PIN mark) makes it stale');
  const t2 = c.ssToken();
  vm.runInContext('curUserName="Someone Else";', c); assert.equal(c.ssStale(t2), true, 'name'); vm.runInContext('curUserName="Gina M";', c);
  vm.runInContext('curStoreLogin={ id:"S1" };', c); assert.equal(c.ssStale(t2), true, 'store sign-in'); vm.runInContext('curStoreLogin=null;', c);
  c._hwSession = 't1'; assert.equal(c.ssStale(t2), true, 'PIN mark'); c._hwSession = 'tGM';
  assert.equal(c.ssStale(t2), false, 'back to the same');
  c._hwSession = null; c._authSession = { access_token: 'x', email: 'a@example.test' };
  const t3 = c.ssToken();
  c._authSession = { access_token: 'y', email: 'a@example.test' }; assert.equal(c.ssStale(t3), false, 'a refreshed email session of the same person');
  c._authSession = { access_token: 'z', email: 'b@example.test' }; assert.equal(c.ssStale(t3), true, 'another email sign-in');
});

test('Codex P1: each step of the pull drops a stale answer by itself (after the answer, while IndexedDB loads, store 401, no session, old function)', async () => {
  // 答えのあと（前の版の関数＝Career Score の無い答え）：GM の full で「前に受け取った形」を変えない
  {
    const W = world({ old: true });
    W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, _at: 1 } }, T0);
    const c = tab(W, 't1');
    await pull(c);
    assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
    logout(c); login(c, 'tGM');
    const h = holder(c, W); h.hold(ssAsk('tGM', 'pull'));
    const gm = c.ssPull(false);
    await until(() => h.n() === 1);
    logout(c); login(c, 't1');
    await h.release();
    assert.equal((await gm).stale, true);
    assert.equal(c.localStorage.getItem('_ss_level'), 'proj', 'the GM level is not recorded');
    assert.equal(local(c, 'bonus_eval'), undefined);
  }
  // Career Score を受け取る途中（IndexedDB を待つあいだ）にログインが変わる：範囲も「前に受け取った形」も変えない
  {
    const W = world({ rls: true, rlsCs: true });
    const c = tab(W, 't1');
    await pull(c);
    logout(c); login(c, 'tGM');
    const open = idbGate(c);
    const n0 = W.calls.ss;
    const gm = c.ssPull(false);
    await until(() => W.calls.ss > n0); await ticks();
    logout(c); login(c, 't1');
    await open();
    assert.equal((await gm).stale, true);
    assert.equal(state(c), null, 'no GM scope recorded (the crew’s was cleared at logout)');
    assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  }
  // 店のログイン（401）の答えを待つあいだに GM へ：GM の全部の写しを消さない
  {
    const W = world({ rls: true, rlsCs: true });
    W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, _at: 1 } }, T0);
    const c = tab(W, 'tGM');
    await pull(c);
    assert.ok(local(c, 'bonus_eval'));
    logout(c); login(c, 'tStore');
    const open = idbGate(c);
    const n0 = W.calls.ss;
    const st = c.ssPull(false);
    await until(() => W.calls.ss > n0); await ticks();
    logout(c); login(c, 'tGM');
    await open();
    assert.equal((await st).stale, true);
    assert.ok(local(c, 'bonus_eval'), 'the GM copy is kept');
    assert.equal(c.ssState(), 'full');
  }
  // ログインの印の無い人（初期の PIN）：IndexedDB を待つあいだに GM へ
  {
    const W = world({ rls: true, rlsCs: true });
    W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, _at: 1 } }, T0);
    const c = tab(W, 'tGM');
    await pull(c);
    logout(c); login(c, 't1'); c._hwSession = null;
    const open = idbGate(c);
    const p = c.ssPull(false);
    await ticks();
    logout(c); login(c, 'tGM');
    await open();
    assert.equal((await p).stale, true);
    assert.ok(local(c, 'bonus_eval'), 'the GM copy is kept');
  }
  // 前の版の関数で、クルーの見せる形を待つあいだに GM へ：GM の全部の写しを見せる形にしない
  {
    const W = world({ old: true });
    W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, _at: 1 } }, T0);
    const c = tab(W, 'tGM');
    await pull(c);
    logout(c); login(c, 't1');
    const open = idbGate(c);
    const n0 = W.calls.ss;
    const p = c.ssPull(false);
    await until(() => W.calls.ss > n0); await ticks();
    logout(c); login(c, 'tGM');
    await open();
    assert.equal((await p).stale, true);
    assert.ok(local(c, 'bonus_eval'), 'the GM copy is kept');
    assert.equal(c.ssState(), 'full');
  }
});

test('Codex P1: a history answer that waits for IndexedDB, and public rows that bring secure keys (filters ignored), are dropped after the switch', async () => {
  {
    // G3（範囲の名前つきの答え＝端末の写しを片づける前に IndexedDB を待つ）の履歴の答えを、クルーに替わってから置かない
    const W = world({ rls: true, rlsCs: true });
    const c = tab(W, 't1');
    await pull(c);
    logout(c); login(c, 't3');
    await pull(c);
    const open = idbGate(c);
    const n0 = W.calls.ss;
    c._lsRequestDeferredPrefix('spl_lss_history_');
    await until(() => W.calls.ss > n0); await ticks(200);
    assert.equal(c.lsKeys('spl_lss_history_').length, 0, 'still waiting for IndexedDB');
    logout(c); login(c, 't1');
    await open();
    assert.equal(c.lsKeys('spl_lss_history_').length, 0);
  }
  {
    const W = world({ ignoreNot: true });   // 前の版の SQL（公開の鍵で読める）で、サーバーが「外す」条件を読まない
    const d = tab(W, 't1');
    await pull(d);
    logout(d); login(d, 'tGM');
    const h = holder(d, W); h.hold(u => u.startsWith(URL0 + '/rest/v1/app_state?'));
    const gm = d._kvPullRows(true);
    await until(() => h.n() === 1);
    logout(d); login(d, 't1');
    await h.release();
    const rows = await gm;
    assert.ok(rows.length > 0 && !rows.some(r => d.csIsKey(r.key) || d.ssIsKey(r.key)), 'the REST copies of the secure rows are dropped too');
  }
});
