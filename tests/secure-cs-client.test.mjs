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
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'supaHeaders', '_lsRequestDeferredPrefix'].map(fn),
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
     if(k.indexOf('spl_lss_requests_')===0) return { merge:function(c, l){ var o={}; (c||[]).concat(l||[]).forEach(function(r){ var x=o[r.id]; if(!x || (x.status==='申請中' && r.status!=='申請中')) o[r.id]=r; }); return Object.keys(o).sort().map(function(i){ return o[i]; }); },
       covers:function(c, m){ return JSON.stringify(c)===JSON.stringify(m); } };
     return null;
   }
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
const pull = async (c, force) => { const rows = await c._kvPullRows(!!force); const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); c.csSeenRecord(rows, ok); return rows; };
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

test('writes go through the function: the OJT pass of a G1, own requests; a refusal stays unsent with a message', async () => {
  const W = world({ rls: true, rlsCs: true });
  const c = tab(W, 't2');
  await pull(c);
  // Crew Leader：自分の店の G1 の点（OJT の合格）
  assert.equal(await c.syncMasterToSupabase('lss_emp_Kai One', { s: { 'A-1': 3 }, _at: 5 }), true);
  assert.deepEqual(W.get('lss_emp_Kai One'), { s: { 'A-1': 3 }, _at: 5 });
  // 自分の申請を足す（読んで合流して書く）
  const mine = [...local(c, 'spl_lss_requests_Cora Two'), { id: 'n1', name: 'Cora Two', status: '申請中' }];
  assert.equal(await c.syncMasterToSupabase('spl_lss_requests_Cora Two', mine), true);
  assert.deepEqual(W.get('spl_lss_requests_Cora Two').map(r => r.id).sort(), ['n1', 'r-Cora Two']);
  // 自分の点：サーバーが断る（送信待ちに残る・知らせる）
  const t0 = c.__toasts.length;
  assert.equal(await c.syncMasterToSupabase('lss_emp_Cora Two', { s: { 'A-1': 3 }, _at: 9 }), false);
  assert.deepEqual(W.get('lss_emp_Cora Two'), { s: { 'A-1': 2 }, _at: 1 });
  assert.ok(c.__toasts.length > t0 && /Career Score/.test(c.__toasts.at(-1)));
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
  W.ssHandler = createHandler1139({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: W.fetch, now: () => Date.now() });
  await pull(c);
  assert.equal(state(c), null);
  assert.equal(c.csSees('Ben S2'), true);
  assert.ok(csKeys(c).includes('lss_emp_Ben S2'));
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
