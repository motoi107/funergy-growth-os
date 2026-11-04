// v1139（2b-1）のアプリ側：成長カルテ・賞与のキーを、REST（公開の鍵）ではなく関数 secure-state で読み書きする。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows）・送信（syncMasterToSupabase・opMergePush・supaUpsert・_opCasWrite）・
// 1 つのキーの読み込み（_fetchOpValue・_fetchOpRow・pullOpKey）を vm で動かし、本物の関数 secure-state（handler）と
// 合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。合成データだけ（本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

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
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'getKartePin', 'setKartePin', 'karteTryUnlock', 'karteChangePin', 'supaHeaders',
    // 成長カルテの本物の合流（同じ時刻は端末の側が勝つ・給与の履歴は 1 件ずつ）：独立レビュー（121da1c）の P1-1 はこれで起きた
    'mergeMapByTime', '_recAt', 'kartePayMergeRec', 'kartePayT', 'kartePayId', 'kartePayDelMap', 'kartePayTrackOf', 'kartePayCmp', 'kartePayDropOne', 'kartePayCovers', 'kartePayCoversMap', '_coversMapByTime'].map(fn),
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
   function _mergeMap(c, l){ var o=Object.assign({}, c||{}); Object.keys(l||{}).forEach(function(k){ var a=o[k], b=l[k]; if(!a || ((b&&b._at)||0)>((a&&a._at)||0)) o[k]=b; }); return o; }   /* 試験用の簡単な合流（成長カルテは本物の mergeMapByTime：同じ時刻は端末の側） */
   function _opMergeDef(k){
     if(k==='growth_karte') return { merge:mergeMapByTime, covers:kartePayCoversMap };
     return __defs[k] ? { merge:_mergeMap, covers:function(c, m){ return JSON.stringify(_mergeMap(c, m))===JSON.stringify(c); } } : null;
   }
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
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
  c.MEM.set('karte_pin', '"4321"');   // 前の版で REST から取っていた平文の PIN
  const rows = await pull(c);
  assert.equal(W.calls.anonSecret, 0, 'no secure row went through the public key');
  assert.ok(rows.some(r => r.key === 'growth_karte'), 'the full karte arrived');
  assert.deepEqual(local(c, 'growth_karte')['E-1'].payLog, [{ amount: 1234 }]);
  assert.deepEqual(Object.keys(local(c, 'bonus_eval')).sort(), ['E-1|2026-Q3', 'E-2|2026-Q3']);
  assert.deepEqual(local(c, 'spl_bonus_q_2026-Q3'), { evSnap: { 'E-1': 800 } });
  assert.equal(local(c, 'karte_pin'), undefined, 'the karte PIN never comes to the device (the old plain copy is removed)');
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
  // 関数が書けなかった（409・500）：false（送信待ちに残る）。ほかの行は書く
  const real = W.ssHandler;
  W.ssHandler = async req => { const b = await req.clone().json(); if (b.action === 'put') return new Response(JSON.stringify({ error: 'boom', fn: 1 }), { status: 500 }); return real(req); };
  assert.equal(await c.supaUpsert('app_state', [{ key: 'bonus_pool_extra', value: { q: 9 } }, { key: 'm_other', value: { x: 3 } }]), false);
  assert.deepEqual(W.get('bonus_pool_extra'), { q: 1 });
  assert.deepEqual(W.get('m_other'), { x: 3 });
  // 書けたと答えても、書いた時刻が読んだ時刻より後でなければ「ほかの保存と重なっていないか確かめられない」（REST の道と同じ）
  W.ssHandler = async req => {
    const b = await req.clone().json(), res = await real(req);
    if (b.action !== 'put' || res.status !== 200) return res;
    const j = await res.json(); j.updated_at = b.expect && b.expect.updated_at; return new Response(JSON.stringify(j), { status: 200 });
  };
  const row2 = await c._fetchOpRow('bonus_rules');
  assert.equal(await c._opCasWrite('bonus_rules', { pool: [6] }, row2), 'stale');
  W.ssHandler = real;
  // 1 つのキーの読み込み
  assert.deepEqual(await c._fetchOpValue('bonus_rules', 'app_state', true), { pool: [6] }, 'the "stale" write did reach the cloud');
  assert.equal(await c._fetchOpValue('spl_bonus_q_2030-Q1', 'app_state', false), null, 'no row');
  assert.equal(await c.pullOpKey('bonus_rules'), true);
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [6] });
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
  const p0 = W.calls.post + W.calls.patch, s0 = W.calls.ss;
  assert.equal(await c.syncMasterToSupabase('growth_karte', { 'E-1': { goals: [] } }), false, 'held: kept in the unsent list, never sent');
  assert.equal(W.calls.post + W.calls.patch, p0);
  assert.equal(W.calls.ss, s0, 'not even asked: the device copy is only the projection');
  assert.ok(JSON.parse(c.localStorage.getItem('_ss_mark')).unsafe.growth_karte, 'marked: an edit made on a partial copy');
  assert.equal(c.__toasts.length, 1, 'the person is told (once)');
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

test('crew: even if the server ignored the "not" filters, the full secure rows from REST never land on the device', async () => {
  const W = world({ ignoreNot: true });
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込み', due: '2026-12-01' }] }, 'E-2': { hireDate: '2023-03-01' } });
  for (const k of ['bonus_eval', 'spl_bonus_q_2026-Q3', 'karte_pin', 'bonus_rules']) assert.equal(local(c, k), undefined, k);
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } });
});

test('a GM device used by crew and back: the projection never merges into the full values', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  assert.deepEqual(local(c, 'growth_karte')['E-2'], { hireDate: '2023-03-01' });
  // そのあいだにクラウドで E-2 の記録が消えた：見せる形の E-2 を全部の値に混ぜない（混ぜると消した記録が半分の形で戻る）
  const gk = W.get('growth_karte'); delete gk['E-2']; W.set('growth_karte', gk, '2026-11-03T14:00:00.000000+00:00');
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
  // RLS の前（SQL を流す前）：GM の 1 つのキーの読み書きは今までどおり REST で続く（10 分は関数を呼ばない）
  const W2 = world();
  W2.wrDown = true;
  const g = tab(W2); g._hwSession = 'tGM'; g.curRole = 'gm';
  await pull(g);
  const n0 = W2.calls.ss;
  assert.deepEqual(await g._fetchOpValue('bonus_rules', 'app_state', true), { pool: [1, 2] });
  assert.equal(W2.calls.ss, n0, 'the function is not asked again while it cannot check people');
});

test('Codex P1: a crew PIN on a device that still has a GM email session sends only the PIN, and never gets the GM\'s rows (work-requests up or down)', async () => {
  const W = world({ rls: true, users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } } });
  const real = W.ssHandler, auths = [];
  W.ssHandler = async req => { auths.push(req.headers.get('authorization')); return real(req); };
  const c = tab(W); c._authSession = { access_token: JWT('jg'), refresh_token: 'r' }; c._hwSession = 't1'; c.curRole = 'crew';
  for (const mode of ['503', 'throw', false]) {
    W.wrDown = mode;
    await pull(c, true);
    const gk = local(c, 'growth_karte') || {};
    assert.ok(!JSON.stringify(gk).includes('1234') && !JSON.stringify(gk).includes('999'), `work-requests ${mode}: no pay history on the crew device`);
    assert.equal(local(c, 'bonus_eval'), undefined);
  }
  assert.ok(auths.length && auths.every(a => a === 'Bearer ' + ANON), 'the GM email token is not sent with the PIN mark');
  assert.equal(W.calls.anonSecret, 0);
  W.ssHandler = real;
});

test('email sign-in (the managers page) works without a PIN session; a failed pull keeps proj devices off REST', async () => {
  const W = world({ users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } } });
  const c = tab(W); c._authSession = { access_token: JWT('jg'), refresh_token: 'r' };
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

// ---- 独立レビュー（121da1c）の指摘の再現と直し
test('P1-1: on a shared device, a GM\'s unsent karte edit survives a crew session and is merged (never the projection) when the GM comes back', async () => {
  const W = world();
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-05', goals: [{ text: 'g' }], payLog: [{ id: 'p1', amount: 1234 }], meetings: [{ note: 'secret' }], _at: 5 },
    'E-2': { hireDate: '2023-03-01', payLog: [{ id: 'p2', amount: 999 }], meetings: [{ note: 'old' }] } });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  // GM が直したが送れていない（送信待ち）
  const mine = local(c, 'growth_karte'); mine['E-3'] = { note: 'GM の新しい記録', _at: 50 };
  c.MEM.set('growth_karte', JSON.stringify(mine)); c.__pending.growth_karte = true;
  // 同じ端末で crew がログイン
  c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.equal(local(c, 'growth_karte')['E-3'].note, 'GM の新しい記録', 'the unsent value is not replaced by the projection');
  assert.deepEqual(local(c, 'karte_bonus_config'), { quarter: '2026-Q3' }, 'other projected keys are the projection');
  // GM が戻る
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  const k = local(c, 'growth_karte');
  assert.equal(k['E-3'].note, 'GM の新しい記録', 'the GM edit is still there');
  assert.deepEqual(k['E-2'].payLog, [{ id: 'p2', amount: 999 }], 'the cloud pay log is not lost');
  assert.deepEqual(k['E-2'].meetings, [{ note: 'old' }], 'nor the meetings');
  assert.deepEqual(local(c, 'karte_bonus_config'), W.get('karte_bonus_config'), 'the projection was dropped before the full value');
  assert.equal(await c.syncMasterToSupabase('growth_karte', k), true, 'and it is sent');
  assert.deepEqual(W.get('growth_karte')['E-2'].payLog, [{ id: 'p2', amount: 999 }]);
  assert.equal(W.get('growth_karte')['E-3'].note, 'GM の新しい記録');
});

test('P1-2: after crew used the device and the GM\'s pull fails (RLS on), a GM edit on the partial copy is held (not sent, not silently dropped), then set aside with a copy', async () => {
  const W = world({ rls: true });
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  const real = W.ssHandler;
  W.ssHandler = async () => new Response(JSON.stringify({ error: 'error', fn: 1 }), { status: 500 });
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.equal(c.ssState(), 'part', 'nothing full arrived (the function failed, REST shows nothing secure)');
  // GM が見せる形の上で直す
  const edited = Object.assign(local(c, 'growth_karte'), { 'E-2': { hireDate: '2023-03-01', note: 'on a partial copy', _at: 99 } });
  c.MEM.set('growth_karte', JSON.stringify(edited));
  const before = JSON.stringify(W.get('growth_karte'));
  assert.equal(await c.syncMasterToSupabase('growth_karte', edited), false, 'held (stays in the unsent list)');
  assert.ok(c.__toasts.some(m => /送りません/.test(m)), 'the GM is told');
  assert.equal(JSON.stringify(W.get('growth_karte')), before, 'the cloud is untouched');
  c.__pending.growth_karte = true;   // 送信待ちに残っている
  // 次に受け取れたら：その入力は控えに移して外し、全部の値を置く
  W.ssHandler = real;
  await pull(c);
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'), 'the full value, not the edit on the projection');
  assert.ok(c.__removed.includes('growth_karte'), 'removed from the unsent list');
  const kept = JSON.parse(c.localStorage.getItem('_ss_unsent'));
  assert.equal(kept[0].key, 'growth_karte'); assert.match(kept[0].text, /on a partial copy/);
  assert.equal(c.ssState(), 'full');
  assert.equal(await c.syncMasterToSupabase('growth_karte', local(c, 'growth_karte')), true, 'from now on the GM can save');
  assert.equal(JSON.stringify(W.get('growth_karte')), before);
});

test('P1-2: the same with RLS off (before the SQL): the GM\'s REST pull brings the full rows, the partial copy is replaced, and saving works', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  W.ssHandler = async () => new Response(JSON.stringify({ error: 'error', fn: 1 }), { status: 500 });
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.equal(c.ssState(), 'full');
  assert.deepEqual(local(c, 'growth_karte'), W.get('growth_karte'), 'the REST full value replaced the projection (no merge into it)');
  assert.deepEqual(local(c, 'karte_bonus_config'), W.get('karte_bonus_config'));
});

test('P1-2: a GM account the server shows only the projection (no employee link): edits are held with a warning, not dropped', async () => {
  const W = world();
  W.pins.tGMx = { emp: 'E-9', role: 'staff', grade: 6, stores: [], am_stores: [] };
  const c = tab(W); c._hwSession = 'tGMx'; c.curRole = 'gm';
  await pull(c);
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  assert.equal(await c.syncMasterToSupabase('bonus_pool_extra', { q: 5 }), false);
  assert.equal(c.__toasts.length, 1);
  assert.equal(W.get('bonus_pool_extra'), undefined);
});

test('the level is the server\'s answer for this person: a device that was proj does not stop a GM whose pull works from saving', async () => {
  const W = world({ rls: true });
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.equal(await c.syncMasterToSupabase('bonus_pool_extra', { q: 7 }), true);
  assert.deepEqual(W.get('bonus_pool_extra'), { q: 7 });
});

test('P2-1: a refusal that does not come from this function (gateway, Verify JWT ON) is "not deployed", not "nothing for you"; a GM\'s 401 keeps the device copy', async () => {
  const W = world();
  W.ssHandler = async () => new Response(JSON.stringify({ code: 401, message: 'Invalid JWT' }), { status: 401 });
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  c.MEM.set('growth_karte', JSON.stringify(W.get('growth_karte')));
  await pull(c);
  assert.ok(c._ss.legacy, 'treated as not deployed');
  assert.notEqual(c.localStorage.getItem('_ss_level'), 'none');
  // 関数の 401（fn:1）でも、GM の端末の写しは消さない
  const W2 = world({ rls: true });
  W2.pins.tGM = 'deny';
  const g = tab(W2); g._hwSession = 'tGM'; g.curRole = 'gm';
  g.MEM.set('bonus_eval', JSON.stringify({ mine: { _at: 1 } }));
  await pull(g);
  assert.deepEqual(local(g, 'bonus_eval'), { mine: { _at: 1 } });
  assert.notEqual(g.ssState(), 'part');
});

test('P2-3: the purge waits for IndexedDB (copies that were still loading are removed too)', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  c._idbState = 'init';
  c._idbBootP = new Promise(r => setTimeout(() => { c.MEM.set('bonus_eval', JSON.stringify(W.get('bonus_eval'))); c._idbState = 'ready'; r(); }, 400));   // 関数の答えより遅い
  const res = await c.ssPull(false);
  assert.equal(res.rest, false);
  await c._idbBootP;
  assert.equal(local(c, 'bonus_eval'), undefined, 'the copy that came from IndexedDB is gone (the purge waited for it)');
  assert.deepEqual(local(c, 'growth_karte'), { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込み', due: '2026-12-01' }] }, 'E-2': { hireDate: '2023-03-01' } });
});

test('logout: on a shared device the GM\'s full copies are removed (unsent ones stay); a GM-only device keeps them', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  assert.ok(local(c, 'bonus_eval'));
  c.MEM.set('bonus_rules', JSON.stringify({ pool: [8] })); c.__pending.bonus_rules = true;
  c.ssOnLogout();
  assert.equal(local(c, 'bonus_eval'), undefined);
  assert.equal(local(c, 'growth_karte'), undefined);
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [8] }, 'unsent changes stay');
  assert.equal(c.ssState(), 'part');
  // GM だけの端末
  const g = tab(W); g._hwSession = 'tGM'; g.curRole = 'gm';
  await pull(g);
  g.ssOnLogout();
  assert.ok(local(g, 'bonus_eval'), 'kept');
});

test('P2-4: when the function is not usable (old REST way), a device with a partial copy still does not send it', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  W.ssDown = true; c._ss.legacy = { id: c.ssSess().id, at: Date.now() };
  const n0 = W.log.length;
  assert.equal(await c.syncMasterToSupabase('growth_karte', local(c, 'growth_karte')), false);
  assert.equal(W.log.length, n0, 'nothing written by REST');
});

test('a write the server refuses (403: this person is no longer CEO/GM) stays in the unsent list and the person is told', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  await pull(c);
  W.pins.tGM = { emp: 'E-GM', role: 'staff', grade: 3, stores: [], am_stores: [] };
  W.tick(61000);   // 関数の覚え（60 秒）を過ぎた
  assert.equal(await c.syncMasterToSupabase('bonus_pool_extra', { q: 3 }), false);
  assert.ok(c.__toasts.some(m => /このアカウントでは/.test(m)));
  assert.equal(W.get('bonus_pool_extra'), undefined);
});

test('the app, the function and the SQL use the same key rule', async () => {
  const { ssIsKey } = await import('../supabase/functions/secure-state/handler.mjs');
  const c = tab(world());
  const keys = ['growth_karte', 'karte_pin', 'bonus_q', 'spl_bonus_q_2026-Q3', 'spl_bonus_q_', 'spl_bonus_q_a&b', 'spl_bonus_q_a b', 'spl_bonus_q_' + 'x'.repeat(41), 'spl_bonus_q_四', 'bonus_eval_rule', 'tasks_all', 'Growth_karte'];
  for (const k of keys) assert.equal(c.ssIsKey(k), ssIsKey(k), k);
});
