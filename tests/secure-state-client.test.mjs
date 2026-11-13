// v1139（2b-1）のアプリ側：成長カルテ・賞与のキーを、REST（公開の鍵）ではなく関数 secure-state で読み書きする。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows）・送信（syncMasterToSupabase・opMergePush・supaUpsert・_opCasWrite）・
// 1 つのキーの読み込み（_fetchOpValue・_fetchOpRow・pullOpKey）を vm で動かし、本物の関数 secure-state（handler）と
// 合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。合成データだけ（本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT, SS } from './lib/secure-state-world.mjs';

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
// 取り込みはアプリと同じ順（取り込む直前にログインを比べる ssStaleRows → _applyKvRows → 印）
const pull = async (c, force) => { const rows0 = await c._kvPullRows(!!force); const rows = c.ssStaleRows ? c.ssStaleRows(rows0) : rows0; const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); return rows; };
// 答えの配送だけを止める（関数はもう答えを作った）
function holder(c, W) {
  const held = []; let pred = null;
  c.fetch = async (u, o) => { const res = await W.fetch(u, o); if (pred && pred(String(u), o)) await new Promise(r => held.push(r)); return res; };
  return { hold: p => { pred = p; }, n: () => held.length, release: async () => { pred = null; held.splice(0).forEach(r => r()); for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); } };
}
const ssAsk = (pin, action) => (u, o) => { let b = {}; try { b = JSON.parse((o && o.body) || '{}'); } catch {} return u === SS && b.pin_session === pin && b.action === action; };
const until = async f => { for (let i = 0; i < 500 && !f(); i++) await new Promise(r => setTimeout(r, 0)); assert.ok(f(), 'waited'); };

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

test('Codex P1 (#131 6635761741): a late GM answer on a shared device that switched to crew does not bring back other people\'s pay and bonus', async () => {
  const W = world({ rls: true });
  const c = tab(W); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.equal(c.ssState(), 'part');
  c.ssOnLogout(); c._hwSession = 'tGM'; c.curRole = 'gm';
  const h = holder(c, W); h.hold(ssAsk('tGM', 'pull'));
  const gm = pull(c);
  await until(() => h.n() === 1);
  c.ssOnLogout(); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  await h.release(); await gm;
  assert.equal(c.ssState(), 'part');
  assert.equal(c.localStorage.getItem('_ss_level'), 'proj');
  assert.deepEqual(Object.keys(local(c, 'growth_karte')['E-2'] || {}), ['hireDate'], 'only the projection (hire date) for another person');
  assert.ok(!JSON.stringify(local(c, 'growth_karte')).includes('payLog'), 'no pay history');
  assert.equal(local(c, 'bonus_eval'), undefined, 'no bonus evaluations');
  assert.equal(W.calls.anonSecret, 0);
  // GM の答えがログアウトのあとに届く（だれもログインしていない）
  const d = tab(W); d._hwSession = 't1'; d.curRole = 'crew';
  await pull(d);
  d.ssOnLogout(); d._hwSession = 'tGM'; d.curRole = 'gm';
  const h2 = holder(d, W); h2.hold(ssAsk('tGM', 'pull'));
  const gm2 = pull(d);
  await until(() => h2.n() === 1);
  d.ssOnLogout(); d._hwSession = null; d.curRole = '';
  await h2.release(); await gm2;
  assert.equal(d.ssState(), 'part');
  assert.equal(local(d, 'bonus_eval'), undefined);
  assert.ok(!JSON.stringify(local(d, 'growth_karte') || {}).includes('payLog'));
});

test('Codex P1: a karte PIN check answered after the switch does not open the karte for the next person', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  const inp = { value: '4321', focus() {} }, er = { style: {}, textContent: '' };
  c.__els.kartePinIn = inp; c.__els.kartePinErr = er;
  const h = holder(c, W); h.hold(ssAsk('tGM', 'pin_check'));
  const p = c.karteTryUnlock();
  await until(() => h.n() === 1);
  c.ssOnLogout(); c._hwSession = 't1'; c.curRole = 'crew';
  await h.release(); await p;
  assert.notEqual(c._karteUnlocked, true);
  // 同じ人のままなら今までどおり開く
  c.ssOnLogout(); c._hwSession = 'tGM'; c.curRole = 'gm';
  await c.karteTryUnlock();
  assert.equal(c._karteUnlocked, true);
});

// ---- Codex（#142 6785448408）P2 と同じ形（v1139 でも見た）：GM の送れていない成長カルテ・賞与を共有の端末に残しても、次にログインした人の
// 読み出し（getKarteAll・bonusRules・kevEvAll・getKartePin）は、その人の見せる形の外（給与の履歴・面談・賞与）を返さない
// （受け取る前・取得の失敗・REST に戻ったときも）。GM の変更は残り、戻ったら送り直せる
const ssReaders = c => { if (!c.getKarteAll) vm.runInContext(['getKarteAll', 'bonusRules', 'kevEvAll'].map(fn).join('\n'), c); return c; };
const view = c => ({ k: JSON.parse(JSON.stringify(c.getKarteAll())), r: JSON.parse(JSON.stringify(c.bonusRules())), e: JSON.parse(JSON.stringify(c.kevEvAll())), pin: c.getKartePin() });
const PROJ1 = { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込み', due: '2026-12-01' }] }, 'E-2': { hireDate: '2023-03-01' } };
async function gmLeavesKarte(W, shared = true) {
  const c = ssReaders(tab(W)); c._hwSession = 'tGM'; c.curRole = 'gm';
  if (shared) c.localStorage.setItem('_ss_mark', JSON.stringify({ shared: 1, keep: {}, unsafe: {} }));
  await pull(c);
  const k = local(c, 'growth_karte'); k['E-2'] = { ...k['E-2'], payLog: [{ amount: 999 }, { amount: 1500 }], _at: 77 };
  c.MEM.set('growth_karte', JSON.stringify(k)); c.__pending.growth_karte = true;   // GM が直したが送れていない
  c.MEM.set('bonus_rules', JSON.stringify({ pool: [1, 2], gm: { v: 9, _at: 99 } })); c.__pending.bonus_rules = true;   // 試験の合流は _at の新しいほう
  c.MEM.set('karte_pin', '"4321"'); c.__pending.karte_pin = true;   // 前の版の平文の写しが送れずに残っている
  assert.equal(view(c).k['E-2'].payLog.length, 2, 'the GM reads the own unsent change');
  c.ssOnLogout(); c._hwSession = null; c.curRole = null;
  return c;
}
const NONE = { k: {}, r: {}, e: {}, pin: '1234' };

test('Codex #142 P2 (same shape in v1139): after the GM leaves unsent karte / bonus changes on a shared device, crew reads only the projection given to it, before and after the pull', async () => {
  const W = world({ rls: true });
  const c = await gmLeavesKarte(W);
  assert.equal(local(c, 'growth_karte')['E-2'].payLog.length, 2, 'the unsent change stays on the device');
  c._hwSession = 't1'; c.curRole = 'crew';
  assert.deepEqual(view(c), NONE, 'before the pull: nothing (not received for this sign-in)');
  assert.equal(c.ssLocalWriteOk('growth_karte'), false, 'and not overwritten');
  assert.equal(c.ssLocalWriteOk('karte_bonus_config'), false, 'nothing is written before this sign-in\'s answer arrives');
  await pull(c);
  assert.deepEqual(view(c), { k: PROJ1, r: {}, e: {}, pin: '1234' }, 'after the pull: the projection only (no pay log, no meetings, no bonus)');
  assert.equal(local(c, 'growth_karte')['E-2'].payLog.length, 2, 'still kept for the GM');
  assert.equal(c.ssLocalWriteOk('growth_karte'), false);
  // 店のログイン（401）：何もない
  c.ssOnLogout(); c._hwSession = 'tStore'; c.curRole = 'sl'; c.curStoreLogin = { id: 'S1' };
  await pull(c);
  assert.deepEqual(view(c), NONE);
  c.curStoreLogin = null;
  assert.equal(W.calls.anonSecret, 0);
});

test('Codex #142 P2 (v1139): the same when crew cannot receive its projection (the function fails, or is not found and REST comes back with nothing)', async () => {
  const W = world({ rls: true });
  const c = await gmLeavesKarte(W);
  const real = W.ssHandler;
  W.ssHandler = async () => new Response(JSON.stringify({ error: 'error', fn: 1 }), { status: 500 });
  c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.deepEqual(view(c), NONE, 'the function failed');
  W.ssHandler = real; W.ssDown = true;
  await pull(c);
  assert.deepEqual(view(c), NONE, 'REST (the function not found): the kept copies are not read');
  assert.equal(c.ssLocalWriteOk('bonus_rules'), false);
  assert.equal(local(c, 'bonus_rules').gm.v, 9, 'still kept');
  W.ssDown = false; c._ss.legacy = null;
  await pull(c);
  assert.deepEqual(view(c).k, PROJ1);
});

test('Codex #142 P2 (v1139): when the GM comes back the unsent karte / bonus changes are read whole and sent again', async () => {
  const W = world({ rls: true });
  const c = await gmLeavesKarte(W);
  c._hwSession = 't1'; c.curRole = 'crew'; await pull(c); c.ssOnLogout();
  c._hwSession = 'tGM'; c.curRole = 'gm';
  assert.deepEqual(view(c), NONE, 'before the pull the GM reads nothing of another sign-in\'s answer either');
  await pull(c);
  const v = view(c);
  assert.equal(v.k['E-2'].payLog.length, 2, 'the GM edit is still there'); assert.equal(v.r.gm.v, 9);
  assert.equal(c.ssLocalWriteOk('growth_karte'), true);
  for (const k of ['growth_karte', 'bonus_rules']) { assert.equal(await c.syncMasterToSupabase(k, local(c, k)), true, k); delete c.__pending[k]; }
  assert.equal(W.get('growth_karte')['E-2'].payLog.length, 2); assert.equal(W.get('bonus_rules').gm.v, 9);
});

test('Codex #142 P2 (v1139): on the GM\'s own device the next sign-in reads none of the GM\'s full copies until its own projection arrives; a REST fallback drops them', async () => {
  const W = world({ rls: true });
  const g = ssReaders(tab(W)); g._hwSession = 'tGM'; g.curRole = 'gm';
  await pull(g); g.ssOnLogout();
  assert.ok(local(g, 'bonus_eval'), 'kept on the GM\'s own device');
  g._hwSession = 't1'; g.curRole = 'crew';
  assert.deepEqual(view(g), NONE);
  W.ssDown = true; await pull(g);
  assert.deepEqual(view(g), NONE);
  assert.equal(local(g, 'bonus_eval'), undefined, 'the GM copy (no unsent change) left the device');
  W.ssDown = false; g._ss.legacy = null;
  await pull(g);
  assert.deepEqual(view(g).k, PROJ1);
  // GM だけの端末の今までどおり：GM が戻れば全部の値（関数から）
  g.ssOnLogout(); g._hwSession = 'tGM'; g.curRole = 'gm';
  await pull(g);
  assert.deepEqual(view(g).k, W.get('growth_karte'));
  // GM だけの端末（ほかの人が使っていない）：次に GM がログインしたとき関数が答えなくても（REST に戻る）、写しは消さない（CEO・GM は全部を見る人）
  const o = ssReaders(tab(W)); o._hwSession = 'tGM'; o.curRole = 'gm';
  await pull(o); o.ssOnLogout();
  W.ssDown = true; o._hwSession = 'tGM'; o.curRole = 'gm';
  await pull(o);
  assert.deepEqual(view(o).k, W.get('growth_karte'), 'kept for the GM while the function is down');
  W.ssDown = false;
});

test('Codex #142 P2 (v1139): before the SQL, a crew sign-in that falls back to REST gets the full rows by REST as before, but not the GM\'s unsent changes kept on the device', async () => {
  const W = world();   // SQL の前（REST で全部読める）
  const c = await gmLeavesKarte(W);
  c._hwSession = 't1'; c.curRole = 'crew';
  W.ssDown = true; await pull(c);
  assert.equal(c.ssState(), 'full', 'REST as before');
  assert.deepEqual(view(c).k, NONE.k, 'the karte row is the GM\'s kept change: not read');
  assert.equal(local(c, 'growth_karte')['E-2'].payLog.length, 2, 'kept for the GM');
  assert.deepEqual(view(c).e, W.get('bonus_eval'), 'a row without a kept change: REST as before');
  W.ssDown = false;
});

test('Codex #142 P2 (v1139): after a sign-in that used REST (no record of whose copy it is), the next person still reads nothing of it before its own answer', async () => {
  const W = world({ rls: true, pins: { tGM: GM, t1: CREW, t2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S2'], am_stores: [] }, tStore: 'deny' } });
  const c = ssReaders(tab(W)); c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c);
  assert.deepEqual(view(c).k, PROJ1);
  W.ssDown = true; await pull(c);   // 同じ人のまま REST に戻る（だれの写しかの記録は空になる）
  assert.deepEqual(view(c).k, PROJ1, 'the own projection, as before');
  c.ssOnLogout(); c._hwSession = 't2'; c.curRole = 'g2';
  assert.deepEqual(view(c), NONE, 'another person: nothing of the earlier projection');
  W.ssDown = false;
});

/* v1151（Codex #145 6848717787 P2）：保護されたデータを関数から取れなかった同期は「最新」に数えない。
   本物の ssPull・_kvPullRows・supaPullAllMasters と、本物の FUNERGY_STATUS（autoSync・trackPull）・FUNERGY_SIGNAL（runFull）をつなぐ。
   前は ssPull の「取れなかった」（{ rest:true, fail:true }）を _kvPullRows が伝えず、REST の行が読めれば _fails が空のまま「最新」になり、
   「変わった」の合図の預かり（_secure:bonus）を外していた（SQL のあと公開の鍵では賞与などは取れない）。合成データだけ */
const between = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const unrefTimer = (f, ms) => { const h = setTimeout(f, ms); if (h && h.unref) h.unref(); return h; };
function syncTab(W, who) {
  const c = tab(W);
  Object.assign(c, who);
  c.setTimeout = unrefTimer; c.setInterval = () => 0;
  const shell = { style: {} };
  c.document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById: id => (id === 'app-shell' ? shell : null), createElement: () => ({ innerHTML: '', classList: { contains: () => false } }) };
  c.addEventListener = () => {}; c.removeEventListener = () => {};
  c.navigator = { onLine: true }; c.getComputedStyle = () => ({ display: 'block' }); c.curPage = 'dashboard';
  c.FUNERGY_UX = { saveState: () => ({ k: '' }), save: {}, failedList: () => [] };
  c.flushOutbox = async () => {};
  vm.runInContext(fn('supaPullAllMasters'), c);   // 本物のまとめての取り込み（右上の同期の結果 _fails を作る）
  vm.runInContext(between('/* ==== FUNERGY_STATUS（v1137）', '/* ==== FUNERGY_STATUS end ==== */'), c);   // 本物の autoSync・trackPull（取り込みを包む）
  vm.runInContext(between('/* ==== FUNERGY_SIGNAL（v1151', '/* ==== FUNERGY_SIGNAL end ==== */'), c);   // 本物の runFull
  const ST = c.FUNERGY_STATUS, SG = c.FUNERGY_SIGNAL;
  SG.st.on = true;
  return { c, ST, SG };
}
const hold = (SG, key) => { SG.st.fullPend[key] = { key, n: 1, _ft: Date.now() - 5 }; };
const stopSig = SG => { try { clearTimeout(SG.st.fullTm); } catch {} SG.st.fullTm = null; SG.stop(); };
const ssNet = (c, W) => { c.fetch = (u, o) => (String(u).startsWith(SS) ? Promise.reject(new TypeError('fetch failed')) : W.fetch(u, o)); };

test('v1151 (Codex #145 6848717787 P2): the function cannot be reached by a GM: REST still reads, but the sync is not "up to date" and the signal hold for the bonus stays until the bonus is really read', async () => {
  const W = world({ rls: true });
  const { c, ST, SG } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
  W.set('bonus_rules', { pool: [9] }, '2026-11-03T12:00:00.000000+00:00');   // ほかの端末が賞与を変えた（合図 _secure:bonus）
  hold(SG, '_secure:bonus');
  ssNet(c, W);   // 関数に届かない：ssPull は { rest:true, fail:true }
  const r = await SG._runFull();
  assert.equal(r, 'fail', 'the sync says something could not be fetched (before: ok)');
  assert.equal(ST.auto.okStarted, 0, 'not counted as up to date (before: counted)');
  assert.deepEqual(Object.keys(SG.st.fullPend), ['_secure:bonus'], 'the hold stays (before: dropped)');
  assert.ok(SG.st.fullTm, 'tried again later');
  assert.equal(local(c, 'bonus_rules'), undefined, 'REST (RLS) never gave the bonus');
  assert.ok(W.calls.rest > 0, 'the rest of the work data was still read');
  const s = ST.syncState();
  assert.equal(s.k, 'fail');
  assert.deepEqual([...s.what], ['保護されたデータ']);
  // 関数が戻った：賞与を本当に読めた同期で預かりを外す
  c.fetch = (u, o) => W.fetch(u, o);
  ST.auto.last = 0;
  const r2 = await SG._runFull();
  assert.equal(r2, 'ok');
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [9] }, 'the bonus was read');
  assert.ok(ST.auto.okStarted > 0);
  assert.equal(Object.keys(SG.st.fullPend).length, 0, 'released only now');
  assert.equal(ST.syncState().k, 'ok');
  stopSig(SG);
});

test('v1151 (Codex #145 6848717787 P2): the PIN check behind the function is down (503, the old REST way for 10 minutes) and crew whose function call fails: also "could not fetch"; a function that is simply not deployed (404) is still the old way and counts', async () => {
  const W = world({ rls: true });
  W.wrDown = true;   // 関数は入っているが PIN の確かめ先が答えない（関数は 503 auth_unavailable）
  const A = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
  hold(A.SG, '_secure:bonus');
  assert.equal(await A.SG._runFull(), 'fail');
  assert.equal(A.ST.auto.okStarted, 0);
  assert.deepEqual(Object.keys(A.SG.st.fullPend), ['_secure:bonus']);
  const n0 = W.calls.ss; A.ST.auto.last = 0;
  assert.equal(await A.SG._runFull(), 'fail', 'still not fetched while the old way is kept (10 minutes)');
  assert.equal(W.calls.ss, n0, 'the function is not asked again in those 10 minutes (as before)');
  assert.deepEqual(Object.keys(A.SG.st.fullPend), ['_secure:bonus']);
  stopSig(A.SG);
  W.wrDown = false;

  const B = syncTab(W, { _hwSession: 't1', curRole: 'staff' });   // スタッフ：関数に届かない（{ rest:false, fail:true }）
  hold(B.SG, '_secure:career_score');
  ssNet(B.c, W);
  assert.equal(await B.SG._runFull(), 'fail');
  assert.equal(B.ST.auto.okStarted, 0);
  assert.deepEqual(Object.keys(B.SG.st.fullPend), ['_secure:career_score']);
  stopSig(B.SG);

  const W2 = world();   // SQL の前・関数がまだ無い（404）：今までどおり REST で全部読める＝取れた
  W2.ssDown = true;
  const C = syncTab(W2, { _hwSession: 'tGM', curRole: 'gm' });
  hold(C.SG, '_secure:bonus');
  assert.equal(await C.SG._runFull(), 'ok');
  assert.ok(C.ST.auto.okStarted > 0);
  assert.equal(Object.keys(C.SG.st.fullPend).length, 0);
  assert.deepEqual(local(C.c, 'bonus_rules'), { pool: [1, 2] }, 'read by REST as before');
  stopSig(C.SG);
});

test('v1151 (Codex #145 6848717787 P2): only one protected part fails (Career Score, Tip period/warnings or grade history) while the rest is read: the sync is still "could not fetch" and that part\'s hold stays', async () => {
  for (const [part, sig] of [['cs', '_secure:career_score'], ['sc', '_secure:tip_confirm'], ['gb', '_secure:grade_hist']]) {
    const W = world({ rls: true });
    const { c, ST, SG } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
    hold(SG, sig);
    c.fetch = async (u, o) => {
      const res = await W.fetch(u, o);
      if (!String(u).startsWith(SS)) return res;
      const j = await res.json();
      if (j && typeof j === 'object' && j.level) j[part] = { error: 'down' };   // 関数は答えたが、その区分の「見られる人」を決められなかった
      return new Response(JSON.stringify(j), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
    assert.equal(await SG._runFull(), 'fail', part);
    assert.equal(ST.auto.okStarted, 0, part);
    assert.deepEqual(Object.keys(SG.st.fullPend), [sig], part);
    assert.deepEqual([...ST.syncState().what], ['保護されたデータ'], part);
    assert.deepEqual(local(c, 'bonus_rules'), { pool: [1, 2] }, 'the parts that were read are still read: ' + part);
    stopSig(SG);
  }
});

test('v1151 (Codex #145 6848717787 P2): the login changes while the protected data could not be fetched: the old person\'s failure is not shown to the next person', async () => {
  const W = world({ rls: true });
  const { c, ST, SG } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
  c.fetch = (u, o) => {
    if (String(u).startsWith(SS)) return Promise.reject(new TypeError('fetch failed'));
    if (String(u).includes('/rest/v1/app_state')) c._hwSession = 't1';   // REST を読んでいるあいだに次の人がログインした
    return W.fetch(u, o);
  };
  const res = await c.supaPullAllMasters();
  if (res && res._done) await res._done;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(ST.syncInfo.busy, 0, 'the sync finished');
  const s = ST.syncState();
  assert.ok(!(s.what || []).includes('保護されたデータ'), 'not shown for the next person: ' + JSON.stringify(s));
  stopSig(SG);
});

/* v1151（Codex #146 6849760483 継続の P2）：関数が見つからない（404・関数でない答え）・PIN の印の無い CEO・GM は今までどおり REST で読むが、
   公開の鍵の決まり（SQL ③）が入っていれば REST では保護されたデータは返らない。前は「関数が無い＝今までどおり」として「最新」に数え、
   「変わった」の合図の預かり（_secure:bonus）を外していた。決まりが入っているかを ss_secret_key で聞く（合成データだけ） */
test('v1151 (Codex #146 6849760483 P2): the function is not found (404) while the public-key rule (RLS) is on: the sync is "could not fetch" and the bonus hold stays (also for the 10 minutes of the old way); once the function is back, the bonus is read and only then released', async () => {
  const W = world({ rls: true });
  W.ssDown = true;   // 関数が見つからない（前の版に戻した・名前の誤り）
  const { c, ST, SG } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
  W.set('bonus_rules', { pool: [9] }, '2026-11-03T12:00:00.000000+00:00');   // ほかの端末が賞与を変えた（合図 _secure:bonus）
  hold(SG, '_secure:bonus');
  const r = await SG._runFull();
  assert.equal(r, 'fail', 'not "up to date" (before: ok, because a missing function counted as the old way)');
  assert.ok(W.calls.rlsProbe >= 1, 'asked whether the rule is on');
  assert.equal(ST.auto.okStarted, 0);
  assert.deepEqual(Object.keys(SG.st.fullPend), ['_secure:bonus'], 'the hold stays (before: dropped)');
  assert.equal(local(c, 'bonus_rules'), undefined, 'REST (RLS) never gave the bonus');
  assert.ok(W.calls.rest > 0, 'the rest of the work data was still read');
  assert.deepEqual([...ST.syncState().what], ['保護されたデータ']);
  // 関数が無いと分かった 10 分（ssLegacyNow）：関数には聞かないが、やはり「取れなかった」
  const n0 = W.calls.ss; ST.auto.last = 0;
  assert.equal(await SG._runFull(), 'fail', 'still not fetched during the 10 minutes');
  assert.equal(W.calls.ss, n0, 'the function is not asked again in those 10 minutes (as before)');
  assert.deepEqual(Object.keys(SG.st.fullPend), ['_secure:bonus']);
  // 関数が戻った（10 分が過ぎた）：賞与を本当に読めた同期で外す
  W.ssDown = false; c._ss.legacy.at -= 600001; ST.auto.last = 0;
  const r3 = await SG._runFull();
  assert.equal(r3, 'ok');
  assert.deepEqual(local(c, 'bonus_rules'), { pool: [9] }, 'the bonus was read');
  assert.ok(ST.auto.okStarted > 0);
  assert.equal(Object.keys(SG.st.fullPend).length, 0, 'released only now');
  assert.equal(ST.syncState().k, 'ok');
  stopSig(SG);
});

test('v1151 (Codex #146 6849760483 P2): an answer that is not this function\'s (a gateway 401) and a CEO/GM without a PIN mark, with the rule on: also "could not fetch"; with the rule off (before the SQL) both are the old way and count', async () => {
  const gate = (c, W) => { c.fetch = (u, o) => (String(u).startsWith(SS) ? Promise.resolve(new Response(JSON.stringify({ msg: 'Invalid JWT' }), { status: 401 })) : W.fetch(u, o)); };
  for (const rlsOn of [true, false]) {
    const W = world({ rls: rlsOn });
    const A = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
    gate(A.c, W);
    hold(A.SG, '_secure:bonus');
    assert.equal(await A.SG._runFull(), rlsOn ? 'fail' : 'ok', 'gateway, rls ' + rlsOn);
    assert.deepEqual(Object.keys(A.SG.st.fullPend), rlsOn ? ['_secure:bonus'] : [], 'gateway, rls ' + rlsOn);
    assert.deepEqual(local(A.c, 'bonus_rules'), rlsOn ? undefined : { pool: [1, 2] }, 'gateway, rls ' + rlsOn);
    stopSig(A.SG);

    const W2 = world({ rls: rlsOn });
    const B = syncTab(W2, { curRole: 'gm' });   // PIN の印もメールのログインも無い CEO・GM（初期の PIN など）：今までどおり REST
    hold(B.SG, '_secure:bonus');
    assert.equal(await B.SG._runFull(), rlsOn ? 'fail' : 'ok', 'no PIN mark, rls ' + rlsOn);
    assert.equal(W2.calls.ss, 0, 'the function is not asked (as before)');
    assert.deepEqual(Object.keys(B.SG.st.fullPend), rlsOn ? ['_secure:bonus'] : [], 'no PIN mark, rls ' + rlsOn);
    stopSig(B.SG);
  }
});

test('v1151 (Codex #146 6849760483 P2): when the rule cannot be told (the check fails, does not answer or answers something unreadable), a missing function is "could not fetch"; the hold is released only when the check says the rule is off', async () => {
  for (const down of ['500', 'throw', 'badjson']) {
    const W = world();   // 決まりは入っていない（本当は REST で読める）が、それを確かめられない
    W.ssDown = true; W.rlsProbeDown = down;
    const { c, ST, SG } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
    hold(SG, '_secure:bonus');
    assert.equal(await SG._runFull(), 'fail', down);
    assert.deepEqual(Object.keys(SG.st.fullPend), ['_secure:bonus'], down);
    assert.deepEqual(local(c, 'bonus_rules'), { pool: [1, 2] }, 'REST still read what it could: ' + down);
    W.rlsProbeDown = null; ST.auto.last = 0;   // 確かめられた：決まりは無い（関数が無い 404）
    assert.equal(await SG._runFull(), 'ok', down);
    assert.equal(Object.keys(SG.st.fullPend).length, 0, down);
    stopSig(SG);
  }
});

test('v1151 (Codex #146 6849760483 P2): the login changes while the rule is being checked: the old person\'s result is not used', async () => {
  const W = world({ rls: true });
  W.ssDown = true;
  const { c } = syncTab(W, { _hwSession: 'tGM', curRole: 'gm' });
  c.fetch = (u, o) => { if (String(u).includes('/rpc/ss_secret_key')) c._hwSession = 't1'; return W.fetch(u, o); };
  const r = await c.ssPull(false);
  assert.equal(r.stale, true, 'stale (the next person gets its own answer)');
});
