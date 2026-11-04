// v1139（2b-1）のアプリ側：成長カルテ・賞与のキーを、REST（公開の鍵）ではなく関数 secure-state で読み書きする。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows）・送信（syncMasterToSupabase・opMergePush・supaUpsert・_opCasWrite）・
// 1 つのキーの読み込み（_fetchOpValue・_fetchOpRow・pullOpKey）を vm で動かし、本物の関数 secure-state（handler）と
// 合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。合成データだけ（本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite',
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'getKartePin', 'setKartePin', 'karteTryUnlock', 'karteChangePin', 'supaHeaders'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=[], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curStoreLogin=null, __pending={}, __fetched={}, __alerts=[], __toasts=[], __rerender=0;
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ var h=MEM.has(k); MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); return true; }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(){}
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(){ return false; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _lsSetVerified(k, j){ return _lsWriteVerified(k, j); } function _lsFreeOldLaborKeys(){}
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   var __defs={ growth_karte:1, karte_bonus_config:1, bonus_eval:1, bonus_rules:1, 'spl_bonus_q_2026-Q3':1, tasks_all:1 };
   function _mergeMap(c, l){ var o=Object.assign({}, c||{}); Object.keys(l||{}).forEach(function(k){ var a=o[k], b=l[k]; if(!a || ((b&&b._at)||0)>((a&&a._at)||0)) o[k]=b; }); return o; }
   function _opMergeDef(k){ return __defs[k] ? { merge:_mergeMap, covers:function(c, m){ return JSON.stringify(_mergeMap(c, m))===JSON.stringify(c); } } : null; }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function karteRerender(){ __rerender++; } function showToast(m){ __toasts.push(m); }
   var __inputs=[]; async function askInput(){ return __inputs.shift(); } function alert(m){ __alerts.push(m); }
   var document={ getElementById:function(id){ return __els[id] || null; } }, __els={};`,
].join('\n');

const GM = { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [] };
const CREW = { emp: 'E-1', role: 'staff', grade: 2, stores: ['S1'], am_stores: [] };
const EMPS = [{ id: 'E-1', store: 'S1' }, { id: 'E-2', store: 'S2' }, { id: 'E-GM', store: 'HQ' }];

function world(o = {}) {
  const W = makeWorld({ pins: { tGM: GM, t1: CREW, tStore: 'deny' }, emps: EMPS, ...o });
  let clock = Date.UTC(2026, 10, 3, 10, 0, 0);
  W.tick = ms => { clock += ms; };
  W.ssHandler = createHandler({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: W.fetch, now: () => clock });
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込み', due: '2026-12-01' }], payLog: [{ amount: 1234 }], _at: 5 }, 'E-2': { hireDate: '2023-03-01', payLog: [{ amount: 999 }] } });
  W.set('karte_bonus_config', { __st: 1, v: { quarter: '2026-Q3', gradeBase: { G2: 1000 } }, _at: 3 });
  W.set('spl_bonus_q_2026-Q3', { evSnap: { 'E-1': 800 } });
  W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, _at: 1 } });
  W.set('bonus_rules', { pool: [1, 2] });
  W.set('karte_pin', '4321');
  W.set('tasks_all', { a: { t: 1 } });
  W.set('m_other', { x: 1 });
  return W;
}
function tab(W, setup = {}) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  Object.assign(c, setup);
  return c;
}
const local = (c, k) => { const v = c.MEM.get(k); return v == null ? undefined : JSON.parse(v); };
const pull = async (c, force) => { const rows = await c._kvPullRows(!!force); const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); return rows; };

test('GM with a PIN session: the karte and bonus rows come from the function (never REST), and merge as before', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  c.MEM.set('bonus_eval', JSON.stringify({ 'E-2|2026-Q3': { ab: 1, _at: 9 } }));   // 送れていない手元の分は合流で残る
  const rows = await pull(c);
  assert.equal(W.calls.anonSecret, 0, 'no secure row went through the public key');
  assert.ok(rows.some(r => r.key === 'growth_karte'), 'the full karte arrived');
  assert.deepEqual(local(c, 'growth_karte')['E-1'].payLog, [{ amount: 1234 }]);
  assert.deepEqual(Object.keys(local(c, 'bonus_eval')).sort(), ['E-1|2026-Q3', 'E-2|2026-Q3']);
  assert.deepEqual(local(c, 'spl_bonus_q_2026-Q3'), { evSnap: { 'E-1': 800 } });
  assert.equal(local(c, 'karte_pin'), undefined, 'the karte PIN never comes to the device');
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } }, 'other rows still come by REST');
  assert.equal(c.localStorage.getItem('_ss_level'), 'full');
  // 2 回目：変わっていない行は関数も送らない
  const n0 = W.calls.ss;
  const rows2 = await pull(c);
  assert.equal(W.calls.ss - n0, 1);
  assert.equal(W.ssLast.rows.length, 0);
  assert.ok(!rows2.some(r => r.key === 'growth_karte'), 'unchanged rows are skipped');
  // 端末の写しが（ほかの道で）変わっていたら、クラウドの印が同じでも取り直す
  c.MEM.set('bonus_eval', JSON.stringify({ broken: 1 }));
  await pull(c);
  assert.deepEqual([...W.ssLast.rows.map(r => r.key)], ['bonus_eval']);
  assert.ok(local(c, 'bonus_eval')['E-1|2026-Q3']);
  W.set('bonus_rules', { pool: [7] }, '2026-11-03T11:00:00.000000+00:00');
  const rows3 = await pull(c);
  assert.deepEqual([...rows3.filter(r => c.ssIsKey(r.key)).map(r => r.key)], ['bonus_rules']);
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [7] });
  // 「クラウドから取り込む」（全部取り直す）は、変わっていない行も届く
  await pull(c, true);
  assert.equal(W.ssLast.rows.length, 5, 'every secure row except the karte PIN');
});

test('GM writes go through the function: merge push, compare-and-write, plain upsert; REST never writes the secure keys', async () => {
  const W = world({ rls: true });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  // 合流の決まりのあるキー：読んで合流して書く
  c.MEM.set('bonus_eval', JSON.stringify(Object.assign(local(c, 'bonus_eval'), { 'E-2|2026-Q3': { ab: 2, _at: 20 } })));
  W.set('bonus_eval', Object.assign(W.get('bonus_eval'), { 'E-3|2026-Q3': { ab: 1, _at: 30 } }), '2026-11-03T12:00:00.000000+00:00');   // ほかの端末が先に
  const r = await c.syncMasterToSupabase('bonus_eval', local(c, 'bonus_eval'));
  assert.equal(r, true);
  assert.deepEqual(Object.keys(W.get('bonus_eval')).sort(), ['E-1|2026-Q3', 'E-2|2026-Q3', 'E-3|2026-Q3']);
  // 照合つきの書き込み（cas）
  const row = await c._fetchOpRow('bonus_rules');
  assert.equal(row.exists, true);
  assert.equal(await c._opCasWrite('bonus_rules', { pool: [3] }, row), 'ok');
  assert.equal(await c._opCasWrite('bonus_rules', { pool: [4] }, row), 'conflict', 'a stale read does not overwrite');
  assert.deepEqual(W.get('bonus_rules'), { pool: [3] });
  assert.equal(await c._opCasWrite('spl_bonus_q_2026-Q9', { a: 1 }, { exists: false }), 'ok');
  assert.equal(await c._opCasWrite('spl_bonus_q_2026-Q9', { a: 2 }, { exists: false }), 'conflict');
  assert.equal(await c._opCasWrite('bonus_rules', { pool: [5] }, { exists: true, updatedAt: 'nope' }), 'badts');
  // そのままの upsert（合流の決まりの無いキー・前からの道）
  assert.equal(await c.supaUpsert('app_state', [{ key: 'bonus_pool_extra', value: { q: 1 } }, { key: 'm_other', value: { x: 2 } }]), true);
  assert.deepEqual(W.get('bonus_pool_extra'), { q: 1 });
  assert.deepEqual(W.get('m_other'), { x: 2 });
  assert.ok(!W.log.some(([, role, key]) => role === 'anon' && c.ssIsKey(key)), 'the public key never wrote a secure key');
  assert.equal(W.calls.anonSecret, 0);
  // 1 つのキーの読み込み
  assert.deepEqual(await c._fetchOpValue('bonus_rules', 'app_state', true), { pool: [3] });
  assert.equal(await c._fetchOpValue('spl_bonus_q_2030-Q1', 'app_state', false), null, 'no row');
  assert.equal(await c.pullOpKey('bonus_rules'), true);
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [3] });
});

test('crew with a PIN session: only the projection (hire dates, own goals, quarter); old full copies are removed; nothing is sent', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  // 前の版で全部取っていた端末
  c.MEM.set('growth_karte', JSON.stringify(W.get('growth_karte')));
  c.MEM.set('bonus_eval', JSON.stringify(W.get('bonus_eval')));
  c.MEM.set('spl_bonus_q_2026-Q3', JSON.stringify(W.get('spl_bonus_q_2026-Q3')));
  c.MEM.set('karte_pin', '"4321"');
  await pull(c);
  assert.equal(W.calls.anonSecret, 0);
  assert.deepEqual(local(c, 'growth_karte'), { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込み', due: '2026-12-01' }] }, 'E-2': { hireDate: '2023-03-01' } });
  assert.deepEqual(local(c, 'karte_bonus_config'), { quarter: '2026-Q3' });
  for (const k of ['bonus_eval', 'spl_bonus_q_2026-Q3', 'karte_pin', 'bonus_rules']) assert.equal(local(c, k), undefined, k + ' removed from the device');
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  // 送らない（対象外）
  const p0 = W.calls.post + W.calls.patch;
  assert.equal(await c.syncMasterToSupabase('growth_karte', { 'E-1': { goals: [] } }), undefined);
  assert.equal(W.calls.post + W.calls.patch, p0);
  // 2 回目：同じ見せる形なら取り直さない・端末の写しは見せる形のまま
  const n0 = W.calls.ss; await pull(c);
  assert.equal(W.calls.ss - n0, 1);
  assert.equal(W.ssLast.rows.length, 0, 'the same projection is not sent again');
  assert.deepEqual(local(c, 'growth_karte')['E-2'], { hireDate: '2023-03-01' });
  // 目標が変わったら、その行だけ届く
  const gk = W.get('growth_karte'); gk['E-1'].goals.push({ text: '新しい目標' }); W.set('growth_karte', gk, '2026-11-03T13:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual([...W.ssLast.rows.map(r => r.key)], ['growth_karte']);
  assert.equal(local(c, 'growth_karte')['E-1'].goals.length, 2);
  // 1 つのキー：見せる形は読める、ほかは読めない（REST にも落ちない）
  assert.equal(await c._fetchOpValue('bonus_eval', 'app_state', true), undefined);
  assert.equal(await c.pullOpKey('bonus_eval'), false);
  assert.equal(W.calls.anonSecret, 0);
});

test('a GM device used by crew and back: the projection never merges into the full values', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'), 'the full karte, not the projection merged in');
  assert.deepEqual(local(c, 'bonus_eval'), W.get('bonus_eval'));
  assert.equal(c.localStorage.getItem('_ss_level'), 'full');
});

test('store login (the function says 401) and crew with the default PIN (no session): nothing secure on the device', async () => {
  const W = world();
  const s = tab(W); s._hwSession = 'tStore'; s.curRole = 'sl'; s.curStoreLogin = { id: 'S1' };
  s.MEM.set('growth_karte', JSON.stringify(W.get('growth_karte')));
  await pull(s);
  assert.equal(local(s, 'growth_karte'), undefined);
  assert.equal(s.localStorage.getItem('_ss_level'), 'none');
  assert.equal(W.calls.anonSecret, 0);
  const d = tab(W); d.curRole = 'crew';   // PIN の印が無い
  d.MEM.set('bonus_eval', '{}');
  await pull(d);
  assert.equal(local(d, 'bonus_eval'), undefined);
  assert.equal(W.calls.anonSecret, 0, 'no session and not GM/CEO: the secure keys are not read by REST either');
});

test('a key with unsent local changes is never removed from the device', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  c.MEM.set('bonus_eval', JSON.stringify({ mine: { _at: 99 } }));
  c.__pending.bonus_eval = true;
  await pull(c);
  assert.deepEqual(local(c, 'bonus_eval'), { mine: { _at: 99 } });
});

test('before the function is deployed (404) and for a GM with the default PIN: the old REST way, exactly as v1138', async () => {
  const W = world({ ssDown: true });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'));
  assert.ok(W.calls.anonSecret > 0, 'read by REST (the old way)');
  assert.equal(await c.syncMasterToSupabase('bonus_pool_extra', { q: 8 }), true);
  assert.deepEqual(W.get('bonus_pool_extra'), { q: 8 });
  assert.ok(W.log.some(([, role, key]) => role === 'anon' && key === 'bonus_pool_extra'), 'written by REST (the old way)');
  // 関数が入ったら（10 分たって試し直す）関数で
  W.ssDown = false;
  const n0 = W.calls.anonSecret;
  c._ss.legacy.at -= 600001;
  await pull(c);
  assert.equal(W.calls.anonSecret, n0);
  // PIN の印の無い GM：今までどおり REST
  const W2 = world();
  const g = tab(W2); g.curRole = 'gm';
  await pull(g);
  assert.deepEqual(local(g, 'growth_karte'), W2.get('growth_karte'));
  assert.equal(W2.calls.ss, 0);
});

test('an answer that is not from this function (no fn marker) counts as "not deployed": the old way', async () => {
  const W = world();
  W.ssHandler = async () => new Response(JSON.stringify({ ok: false, error: 'not_configured' }), { status: 200 });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'), 'read by REST as in v1138');
  assert.notEqual(c.localStorage.getItem('_ss_level'), 'none', 'not treated as "nothing for you"');
});

test('work-requests unreachable from the function (503): the GM keeps the old way; with RLS on, REST simply returns nothing secure', async () => {
  const W = world({ rls: true });
  W.wrDown = true;
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  c.MEM.set('growth_karte', JSON.stringify({ old: { _at: 1 } }));
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), { old: { _at: 1 } }, 'nothing from REST (RLS), the device copy stays');
  assert.equal(W.calls.anonSecret, 0);
});

test('email sign-in (the managers page) works without a PIN session; a failed pull keeps proj devices off REST', async () => {
  const W = world({ users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } } });
  const c = tab(W); c._authSession = { access_token: 'jg', refresh_token: 'r' };
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'));
  assert.equal(W.calls.anonSecret, 0);
  const p = tab(W); p._hwSession = 't1'; p.curRole = 'crew';
  await pull(p);
  const realHandler = W.ssHandler;
  W.ssHandler = async () => new Response(JSON.stringify({ error: 'error' }), { status: 500 });
  await pull(p);
  assert.equal(W.calls.anonSecret, 0, 'a proj device does not fall back to REST');
  W.ssHandler = realHandler;
});

test('karte PIN: checked by the server (never on the device); wrong, locked, changed', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  const inp = { value: '1111', focus() {} }, er = { style: {}, textContent: '' };
  c.__els.kartePinIn = inp; c.__els.kartePinErr = er;
  await c.karteTryUnlock();
  assert.equal(c._karteUnlocked, undefined); assert.equal(er.textContent, 'PINが違います');
  inp.value = '4321';
  await c.karteTryUnlock();
  assert.equal(c._karteUnlocked, true);
  assert.equal(typeof W.get('karte_pin'), 'object', 'upgraded to a mark on the server');
  c.__inputs.push('4321', '7777');
  await c.karteChangePin();
  assert.deepEqual([...c.__toasts.slice(-1)], ['成長カルテのPINを変更しました']);
  c.__inputs.push('0000');
  await c.karteChangePin();
  assert.deepEqual([...c.__alerts.slice(-1)], ['現在のPINが違います']);
  c._karteUnlocked = undefined;
  inp.value = '7777';
  await c.karteTryUnlock();
  assert.equal(c._karteUnlocked, true);
  for (let i = 0; i < 6; i++) { inp.value = '0000'; await c.karteTryUnlock(); }
  assert.equal(er.textContent, '続けて間違えたため、10 分止めています');
  assert.equal(c.MEM.has('karte_pin'), false, 'nothing about the PIN on the device');
  // 関数が無い：今までどおり端末で
  const W2 = world({ ssDown: true });
  const d = tab(W2); d._hwSession = 'tGM'; d.curRole = 'gm';
  d.MEM.set('karte_pin', '"2468"');
  const inp2 = { value: '2468', focus() {} }; d.__els.kartePinIn = inp2; d.__els.kartePinErr = { style: {} };
  await d.karteTryUnlock();
  assert.equal(d._karteUnlocked, true);
});

test('the one-time upload of local data never writes a secure key from the device', async () => {
  const W = world({ rls: true });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  c.MEM.set('growth_karte', JSON.stringify({ stale: {} }));
  c.MEM.set('new_local_key', JSON.stringify({ a: 1 }));
  await c.migrateUploadLocalOps();
  assert.equal(W.get('growth_karte').stale, undefined);
  assert.deepEqual(W.get('new_local_key'), { a: 1 });
});

test('what the screens of non-GM people use is the same with the projection as with the full values', async () => {
  // Career Score の基準点の四半期（csvQ → bonusQKey(kbCfg())）・強みの「伸ばしていること」（cssGrow）・グレードの区間の入社日（ghHire）
  const code = [varLine(/^var KB_ST_META = .*$/m), ...['kbCfgPlain', 'kbCfg', 'bonusQKey', '_curQuarter', 'getKarteAll', 'getKarte', 'cssGrow', 'ghHire', 'ghDate'].map(fn),
    'var __ls={}; function ls(k, d){ return Object.prototype.hasOwnProperty.call(__ls, k) ? JSON.parse(__ls[k]) : d; } function ghQRange(q){ return /^\\d{4}-Q[1-4]$/.test(q) ? { q:q } : null; }'].join('\n');
  const W = world();
  const full = { growth_karte: W.get('growth_karte'), karte_bonus_config: W.get('karte_bonus_config') };
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  const proj = { growth_karte: local(c, 'growth_karte'), karte_bonus_config: local(c, 'karte_bonus_config') };
  const run = vals => {
    const x = vm.createContext({ JSON, Object, String, Date, Math, Array, Number, RegExp, isFinite });
    vm.runInContext(code, x);
    for (const [k, v] of Object.entries(vals)) x.__ls[k] = JSON.stringify(v);
    return JSON.stringify({ q: x.bonusQKey(x.kbCfg()), g1: x.cssGrow({ id: 'E-1' }), h1: x.ghHire({ id: 'E-1' }), h2: x.ghHire({ id: 'E-2' }), h3: x.ghHire({ id: 'E-9' }) });
  };
  assert.equal(run(proj), run(full));
  assert.match(run(proj), /"q":"2026-Q3"/);
  assert.match(run(proj), /仕込み/);
});
