// v1147（2b の 9 つ目・Moto さん 11/10「読む人も書く人も絞る」）のアプリ側：Tip の期間の確定（tip_cf_<店>_<年>）と注意ログ（warnings_<店>）を、
// REST（公開の鍵）ではなく関数 secure-state で受け取る・送る（見られる店の分だけ・書けるのも決めた人だけ）。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows・scTake・scSeenRecord）・送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssPutRow）・
// 端末で書いてよいか（scLocalWriteOk）・断った印と外す道（ssRefusedMark・ssDropRefused）・前の期間の確かめ（tipBackPull → tcf_status）を vm で動かし、
// 本物の関数（handler）と合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。合流の決まりはアプリの本物（OP_MERGE_PREFIX の行。cas も）。
// 前の版の関数は、入れる一式の v1146 の 1 ファイル（tpfn:1 はあるが scfn:1 は無い）。合成データだけ（架空の人と店。本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHandler, scIsKey as serverScIsKey } from '../supabase/functions/secure-state/handler.mjs';
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
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n', i + 1)); };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
// 合流の決まりはアプリの本物（OP_MERGE_PREFIX の行）
const defLine = k => { const m = source.match(new RegExp('^  \'' + k + '\':\\s+(\\{ merge:[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return m[1]; };
const DEFS = { tip_cf_: defLine('tip_cf_'), warnings_: defLine('warnings_') };

async function oldHandler(path, tag) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
  const tmp = mkdtempSync(join(tmpdir(), tag));
  writeFileSync(join(tmp, 'handler.mjs'), s);
  return (await import(pathToFileURL(join(tmp, 'handler.mjs')).href)).createHandler;
}
const createHandler1146 = await oldHandler('deploy/secure-tip-prep-v1146/2_関数_secure-state_index.ts', 'ss1146-');

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite',
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'supaHeaders', '_lsRequestDeferredPrefix',
    '_srPending', 'mergeSkillReq', 'mergeLssReq', 'outboxLabel', 'tipBackPull',
    '_cjson', '_lrPick', 'mergeLocalRecMap', '_coversLocalRecMap', '_wnKey', 'mergeWarnings', '_coversWarnings'].map(fn),
  ...['_lrObj', '_lrOwn', '_lrAt', 'tipConfirmKey'].map(oneLine),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=['spl_lss_history_'], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null, _lsDeferReq={};
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curLang='ja', __pending={}, __fetched={}, __alerts=[], __toasts=[], __rerender=0, __failed=[];
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   /* アプリの lsSet の入口と同じ：Career Score（csLocalWriteOk）と、v1147 の店ごとの行（scLocalWriteOk） */
   function lsSet(k, v){ if(!csLocalWriteOk(k) || !scLocalWriteOk(k)){ __failed.push(k); return false; } MEM.set(k, JSON.stringify(v)); return true; }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(k){ __failed.push(k); }
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(k){ return k.indexOf('spl_lss_history_')===0; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _lsSetVerified(k, j){ return _lsWriteVerified(k, j); } function _lsFreeOldLaborKeys(){} function _lsRerenderSoon(){ __rerender++; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   var __DEFS={ ${Object.entries(DEFS).map(([k, d]) => JSON.stringify(k) + ':' + d).join(', ')} };
   function _opMergeDef(k){ k=String(k); if(k.indexOf('tip_cf_')===0) return __DEFS.tip_cf_; if(k.indexOf('warnings_')===0) return __DEFS.warnings_; return null; }   /* アプリの OP_MERGE_PREFIX と同じ */
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
   /* 送る列・送信待ちの最小の代わり（断った印と外す道の試験） */
   var _pushQ={}, __mine=[]; function _saveWho(){ return curUserName||''; } function _outboxMine(){ return __mine; } function _pushBusy(k){ return !!(_pushQ[k] && _pushQ[k].busy && !_pushQ[k].__done); }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function karteRerender(){ __rerender++; } function showToast(m){ __toasts.push(m); }
   var __inputs=[]; async function askInput(){ return __inputs.shift(); } function alert(m){ __alerts.push(m); }
   function t(ja, en){ return ja; }
   /* 前の期間の確かめ（tipBackPull）に要るもの：前の期間を選んだ（tipBackInfo）・従業員・店 */
   var __back={ back:true, from:'2026-11-01' }; function tipBackInfo(){ return __back; }
   var __emps=[]; function getEmployees(){ return __emps; }
   var STORES=[{ id:'S1', name:'Store One' }, { id:'S2', name:'Store Two' }, { id:'S3', name:'Store Three' }];
   var document={ getElementById:function(id){ return __els[id] || null; } }, __els={};`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', support: ['S3'], role: 'g4', title: 'Store Manager' },
  { id: 'E-3', name: 'Sal Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-2', name: 'Ria Two', store: 'S2', role: 'g2', title: 'Crew Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', support: ['S2'], role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M', confirmed: true },
  tOF: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia', confirmed: true },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'], name: 'Amy Area', confirmed: true },
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1', 'S3'], am_stores: [], name: 'Leo Four', confirmed: true },
  t3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sal Three', confirmed: true },
  t2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S2'], am_stores: [], name: 'Ria Two', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false },
  tStore: 'deny',
};
// GM・CEO が確かめた写し（wr_people）。店のある範囲はこの写し（G2 以上）の店で（v1147・Codex #141 P2-1）
const WRP = [{ emp_id: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'] }, { emp_id: 'E-4', role: 'staff', grade: 4, stores: ['S1', 'S3'] },
  { emp_id: 'E-3', role: 'staff', grade: 3, stores: ['S1'] }, { emp_id: 'E-2', role: 'staff', grade: 2, stores: ['S2'] }];
const USER = { tGM: ['gm', 'Gina M'], tOF: ['office', 'Ofelia'], tAM: ['am', 'Amy Area'], t4: ['am', 'Leo Four'], t3: ['sl', 'Sal Three'], t2: ['g2', 'Ria Two'], t1: ['crew', 'Kai One'], tStore: ['sl', ''] };
const T0 = '2026-11-09T09:00:00.000000+00:00';
const TK = (s, y = '2026') => 'tip_cf_' + s + '_' + y, WK = s => 'warnings_' + s;
// アプリが書く形（confirmTip・unconfirmTip・logWarning）の見本（合成・額は架空）
const CF = (from, o = {}) => ({ status: '確定済み', period: 'x', range: 'y', from, to: from.slice(0, 8) + '15', weight: 'rate', by: 'Store Leader', at: '2026/11/16 10:00',
  rows: [{ name: 'Kai One', hours: 10, rate: 90, final: 123.45 }], staffCount: 1, totalFinal: 123.45, forced: false, forceReason: '', _at: 1762700000000, ...o });
const UNLOCK = (at = 1762700000500) => ({ _deleted: true, by: 'GM', at: '2026/11/16 11:00', _at: at });
const W1 = { date: '2026/11/01 10:00', by: 'Yuki', reason: '必須タスク未完了 1件 (開店準備)', id: 'wA', _mut: 1762000000000 };
const WNEW = (n = 1) => ({ date: '2026/11/10 09:00', by: 'Store Manager', reason: '必須タスク未完了 ' + n + '件 (閉店)', id: 'wN' + n, _mut: 1762700000000 + n });
const ALL_SC = [TK('S1'), TK('S1', '2025'), TK('S2'), TK('S3'), 'tip_cf_odd', WK('S1'), WK('S2')].sort();

function world(o = {}) {
  const W = makeWorld({ pins: JSON.parse(JSON.stringify(ME)), emps: EMPS.map(e => ({ ...e })), wrPeople: WRP.map(x => ({ ...x })), mgr: { 'aaaaaaaa-0000-0000-0000-000000000001': { role: 'gm', emp_id: 'E-GM' } }, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.fresh = () => { W.ssHandler = (o.old ? createHandler1146 : createHandler)({ env, fetch: (u, x) => W.fetch(u, x), now: () => Date.UTC(2026, 10, 10, 10, 0, 0) }); };   // 関数を入れ直す（PIN の 60 秒の覚えも消える）
  W.fresh();
  W.set(TK('S1'), { '2026-11-01': CF('2026-11-01') }, T0);
  W.set(TK('S2'), { '2026-11-01': CF('2026-11-01', { totalFinal: 999 }) }, T0);
  W.set(TK('S3'), { '2026-10-16': CF('2026-10-16') }, T0);
  W.set(TK('S1', '2025'), { '2025-12-16': CF('2025-12-16') }, T0);
  W.set('tip_cf_odd', { x: 1 }, T0);
  W.set(WK('S1'), [W1], T0);
  W.set(WK('S2'), [W1], T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
  return W;
}
function tab(W, who) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  vm.runInContext('__emps=' + JSON.stringify(EMPS) + ';', c);
  if (who) login(c, who);
  return c;
}
function login(c, who) {
  c._hwSession = who;
  vm.runInContext('curRole=' + JSON.stringify(USER[who][0]) + '; curRealRole=curRole; curUserName=' + JSON.stringify(USER[who][1]) + '; curStoreLogin=' + (who === 'tStore' ? '{ id:"S1" }' : 'null') + ';', c);
}
const plain = x => JSON.parse(JSON.stringify(x));   // vm の中の値（別の realm）を比べられる形に
const local = (c, k) => { const v = c.MEM.get(k); return v == null ? undefined : JSON.parse(v); };
const scKeys = c => [...c.MEM.keys()].filter(k => c.scIsKey(k)).sort();
const apply = (c, rows0) => { const rows = c.ssStaleRows(rows0); const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); c.csSeenRecord(rows, ok); c.scSeenRecord(rows, ok); return rows; };
const pull = async (c, force) => apply(c, await c._kvPullRows(!!force));
const logout = c => { c.ssOnLogout(); c._hwSession = null; vm.runInContext('curRole=null; curRealRole=null; curUserName=null; curStoreLogin=false;', c); };
const body = o => { try { return JSON.parse((o && o.body) || '{}'); } catch { return {}; } };
const ssAsk = (pin, action) => (u, o) => u === SS && body(o).pin_session === pin && (!action || body(o).action === action);
const until = async f => { for (let i = 0; i < 500 && !f(); i++) await new Promise(r => setTimeout(r, 0)); assert.ok(f(), 'waited'); };
const state = c => JSON.parse(c.localStorage.getItem('_sc_state') || 'null');
const anonSc = W => W.calls.anonSc || 0;
const anonScWrites = (W, c) => W.log.filter(([w, role, key]) => w === 'write' && role === 'anon' && c.scIsKey(key)).length;
function holder(c, W) {
  const held = []; let pred = null;
  c.fetch = async (u, o) => {
    const res = await W.fetch(u, o);
    if (pred && pred(String(u), o)) await new Promise(r => held.push(r));
    return res;
  };
  const ticks = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
  return { hold: p => { pred = p; }, n: () => held.length, release: async () => { pred = null; held.splice(0).forEach(r => r()); await ticks(); } };
}

test('keys, routing, labels and the merge rules are the same as the function (cas on both)', () => {
  const c = tab(world(), 't3');
  const keys = ['tip_cf_S1_2026', 'tip_cf_x', 'tip_cf_', 'tip_cf', 'warnings_S1', 'warnings_', 'warnings', 'Tip_cf_S1_2026', 'tip_cf_' + 'x'.repeat(193), 'tip_cf_' + 'x'.repeat(194),
    'tip_confirm_S1_2026-11-01', 'cash_tips_S1', 'spl_tip_requests_x', null, 3];
  for (const k of keys) assert.equal(c.scIsKey(k), serverScIsKey(k), String(k));
  assert.equal(c.ssRouted(TK('S1')), true); assert.equal(c.ssRouted(WK('S1')), true);
  assert.equal(c.rfIsKey(TK('S1')), true, 'refused / drop machinery'); assert.equal(c.rfIsKey('tasks_all'), false);
  assert.equal(tab(world(), null).ssRouted(TK('S1')), false, 'no PIN sign-in: REST as before');
  assert.equal(c.outboxLabel(WK('S1')), '注意ログ'); assert.equal(c.outboxLabel(TK('S1')), 'Tipの期間の確定');
  assert.ok(c._opMergeDef(TK('S1')).cas && c._opMergeDef(WK('S1')).cas, 'both write only on the row that was read');
  assert.deepEqual(plain(c.scParse(TK('S1'))), { kind: 'tip', store: 'S1' }); assert.deepEqual(plain(c.scParse('tip_cf_odd')), { kind: 'tip', store: null });
  // 範囲がまだ決まっていない（関数が前の版・上げた直後）：今までどおり
  assert.equal(c.scSeesStore('tip', 'S9'), true); assert.equal(c.scLocalWriteOk(TK('S9')), true); assert.equal(c.scWnWritable('S9'), true); assert.equal(c.scTipUnlockOk(), true);
});

test('GM: every row comes from the function and none through the public key; unchanged rows are not sent again', async () => {
  const W = world({ rls: true, rlsSc: true });
  const c = tab(W, 'tGM');
  await pull(c);
  assert.equal(anonSc(W), 0);
  assert.deepEqual(scKeys(c), ALL_SC);
  assert.deepEqual(local(c, TK('S2')), W.get(TK('S2')));
  const st = state(c);
  assert.equal(st.level, 'all'); assert.equal(st.unlock, true); assert.equal(st.wnWrite, true); assert.equal(st.who, c.csWho());
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } }, 'other rows still by REST');
  await pull(c);
  assert.equal(W.ssLast.sc.rows.length, 0, 'unchanged rows are skipped');
  W.set(WK('S2'), [W1, WNEW(1)], '2026-11-10T11:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual(W.ssLast.sc.rows.map(r => r.key), [WK('S2')]);
  assert.equal(local(c, WK('S2')).length, 2);
  assert.equal(anonSc(W), 0);
});

test('G3 on a device that had every store (the v1146 REST way): only its own store stays; the others leave the device (unsent changes stay)', async () => {
  const W = world();
  const c = tab(W, 't3');
  for (const k of ALL_SC) c.MEM.set(k, JSON.stringify(W.get(k)));
  c.MEM.set(WK('S2'), JSON.stringify([W1, WNEW(9)])); c.__pending[WK('S2')] = true;   // 送れていない変更のある行は残す
  await pull(c);
  assert.deepEqual(scKeys(c), [TK('S1'), TK('S1', '2025'), WK('S1'), WK('S2')].sort());
  assert.deepEqual(state(c).stores, ['S1']); assert.equal(state(c).level, 'scoped');
  assert.equal(c.scSeesStore('tip', 'S1'), true); assert.equal(c.scSeesStore('tip', 'S2'), false); assert.equal(c.scSees('tip_cf_odd'), false);
  assert.equal(c.scWnWritable('S1'), false, 'a store leader sees the warning log but does not record');
  assert.equal(c.scTipUnlockOk(), false, 'no unlock / force button');
  assert.equal(anonSc(W), 0, 'no row of the two kinds through the public key (before the SQL as well)');
  await pull(c);
  assert.equal(W.ssLast.sc.rows.length, 0, 'unchanged rows are skipped');
  // 応援の店が社員の表で足された：GM・CEO が確かめるまで届かない（v1147・Codex #141 P2-1）。確かめたら届く
  W.pins.t3.stores = ['S1', 'S2']; W.fresh();
  await pull(c);
  assert.ok(!scKeys(c).includes(TK('S2')), 'not before the GM/CEO confirms the added store');
  W.wrPeople.find(x => x.emp_id === 'E-3').stores = ['S1', 'S2']; W.fresh();
  await pull(c);
  assert.ok(scKeys(c).includes(TK('S2')));
});

test('even if the server ignored the "not" filters, REST rows of the two kinds never land on a device; G1 gets none', async () => {
  const W = world({ ignoreNot: true });
  const c = tab(W, 't1');
  c.MEM.set(TK('S1'), JSON.stringify(W.get(TK('S1'))));
  await pull(c);
  assert.deepEqual(scKeys(c), []);
  assert.equal(state(c).level, 'none');
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } });
  assert.equal(c.scLocalWriteOk(WK('S1')), false);
  assert.equal(c.scSeesStore('wn', 'S1'), false);
});

test('writes go through the function: confirm by a G4, unlock only by CEO/GM/Accounting, warnings appended only by those who record; the public key writes nothing', async () => {
  const W = world({ rls: true, rlsSc: true });
  const g4 = tab(W, 't4');
  await pull(g4);
  assert.deepEqual(state(g4).stores, ['S1', 'S3']); assert.equal(state(g4).wnWrite, true);
  // 確定（見られる店）
  const conf = { ...local(g4, TK('S1')), '2026-11-16': CF('2026-11-16', { _at: 1762800000000 }) };
  assert.equal(await g4.syncMasterToSupabase(TK('S1'), conf), true);
  assert.deepEqual(W.get(TK('S1'))['2026-11-16'], conf['2026-11-16']);
  // 解除：断る（送信待ちに残る・知らせる）
  const t0 = g4.__toasts.length;
  assert.equal(await g4.syncMasterToSupabase(TK('S1'), { ...conf, '2026-11-16': UNLOCK(1762800000500) }), false);
  assert.equal(W.get(TK('S1'))['2026-11-16'].status, '確定済み');
  assert.ok(g4.__toasts.length > t0 && /Tip の期間の確定/.test(g4.__toasts.at(-1)));
  // 注意ログを足す
  const wl = [...local(g4, WK('S1')), WNEW(2)];
  assert.equal(await g4.syncMasterToSupabase(WK('S1'), wl), true);
  assert.equal(W.get(WK('S1')).length, 2);
  // 見られない店：この端末で作らない（知らせる）
  assert.equal(g4.lsSet(TK('S2'), { '2026-11-01': CF('2026-11-01') }), false);
  assert.equal(g4.lsSet(WK('S2'), [WNEW(3)]), false);
  assert.equal(local(g4, TK('S2')), undefined);
  assert.ok(g4.__toasts.some(m => /見られません/.test(m)));
  // 店長（G3）：見られるが記録しない（この端末で止める。直接送ってもサーバーが断る）
  const g3 = tab(W, 't3');
  await pull(g3);
  assert.equal(g3.lsSet(WK('S1'), [...local(g3, WK('S1')), WNEW(4)]), false);
  assert.ok(g3.__toasts.some(m => /注意ログを記録できるのは/.test(m)));
  assert.equal(await g3.syncMasterToSupabase(WK('S1'), [...W.get(WK('S1')), WNEW(5)]), false);
  assert.equal(W.get(WK('S1')).length, 2);
  // GM：解除できる
  const gm = tab(W, 'tGM');
  await pull(gm);
  assert.equal(await gm.syncMasterToSupabase(TK('S1'), { ...local(gm, TK('S1')), '2026-11-16': UNLOCK(1762800001000) }), true);
  assert.equal(W.get(TK('S1'))['2026-11-16']._deleted, true);
  assert.equal(anonScWrites(W, g4), 0, 'the public key never wrote a row of the two kinds');
  assert.equal(anonSc(W), 0);
});

test('a refused write of the two kinds gets the refused mark; removing it reads the cloud through the function (in scope) or just clears the copy (out of scope)', async () => {
  const W = world({ rls: true, rlsSc: true });
  const c = tab(W, 't3');
  await pull(c);
  // 送る列の回（_pushRun）の中で断られる：印が付く（外す画面に出る）
  const mine = [...local(c, WK('S1')), WNEW(6)];
  c.MEM.set(WK('S1'), JSON.stringify(mine)); c.__pending[WK('S1')] = true;
  c._pushQ[WK('S1')] = { busy: true, busySeq: 1, busyWho: 'Sal Three' };
  assert.equal(await c.ssPutRow(WK('S1'), mine, { exists: true, updatedAt: W.rows.get(WK('S1')).updated_at }), 'forbidden');
  c._pushQ[WK('S1')].__done = true;
  vm.runInContext('__mine=[{ key:' + JSON.stringify(WK('S1')) + ' }];', c);
  const L = plain(c.ssRefusedList());
  assert.deepEqual(L.map(x => [x.key, x.st, x.label]), [[WK('S1'), 403, '注意ログ']]);
  const reads = W.calls.rest;
  const r = await c.ssDropRefused([{ key: WK('S1'), fp: L[0].fp }]);
  assert.deepEqual(plain(r.done), [WK('S1')]);
  assert.deepEqual(local(c, WK('S1')), W.get(WK('S1')), 'back to the cloud value (read through the function)');
  assert.ok(W.calls.rest > reads);
  assert.equal(anonSc(W), 0);
  // 見られない店（範囲が狭くなった）の断られた行：クラウドを読まずに、この端末の写しを消すだけ
  c.MEM.set(TK('S2'), JSON.stringify({ '2026-11-16': CF('2026-11-16') })); c.__pending[TK('S2')] = true;
  const o = c.ssRefusedAll(); o[TK('S2')] = { at: 1, st: 403, fp: c.ssRefusedFp(TK('S2')), who: 'Sal Three' }; c.ssRefusedPut(o);
  vm.runInContext('__mine=[{ key:' + JSON.stringify(TK('S2')) + ' }];', c);
  const fp = c.ssRefusedList()[0].fp, n0 = W.calls.rest;
  const r2 = await c.ssDropRefused([{ key: TK('S2'), fp }]);
  assert.deepEqual(plain(r2.done), [TK('S2')]);
  assert.equal(local(c, TK('S2')), undefined);
  assert.equal(W.calls.rest, n0, 'nothing read for the out-of-scope row');
});

test('with the v1146 function (no scfn): the app keeps the REST way for both kinds, reads and writes', async () => {
  const W = world({ old: 1146 });
  const c = tab(W, 't3');
  await pull(c);
  assert.equal(state(c), null, 'no scope recorded: screens work as before');
  assert.deepEqual(scKeys(c), ALL_SC, 'still by REST (as v1146)');
  assert.ok(anonSc(W) > 0);
  assert.equal(c.ssRouted(TK('S2')), false, 'the old function is remembered for 10 minutes');
  assert.equal(c.scSeesStore('tip', 'S2'), true);
  const n = anonScWrites(W, c);
  assert.equal(await c.syncMasterToSupabase(WK('S2'), [W1, WNEW(7)]), true);
  assert.equal(W.get(WK('S2')).length, 2);
  assert.ok(anonScWrites(W, c) > n, 'through the public key (as v1146)');
});

test('when the function goes back to v1146, the recorded scope is cleared (screens as before) and both kinds come by REST again', async () => {
  const W = world();
  const c = tab(W, 't3');
  await pull(c);
  assert.equal(state(c).level, 'scoped'); assert.equal(c.scSeesStore('tip', 'S2'), false);
  W.ssHandler = createHandler1146({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: (u, x) => W.fetch(u, x), now: () => Date.now() });
  await pull(c);
  assert.equal(state(c), null);
  assert.equal(c.scSeesStore('tip', 'S2'), true);
  assert.deepEqual(scKeys(c), ALL_SC);
});

test('a store login (401): nothing of the two kinds on the device; logout clears what the next person should not see', async () => {
  const W = world();
  const s = tab(W, 'tStore');
  s.MEM.set(TK('S1'), JSON.stringify(W.get(TK('S1'))));
  await pull(s);
  assert.deepEqual(scKeys(s), []);
  assert.equal(state(s).level, 'none');
  assert.equal(s.scLocalWriteOk(TK('S1')), false);
  // 店長がログアウト：見られる店の分も端末に残さない（次の人の範囲で受け取り直す）。送れていない行は残す
  const c = tab(W, 't3');
  await pull(c);
  c.MEM.set(WK('S1'), JSON.stringify([W1, WNEW(8)])); c.__pending[WK('S1')] = true;
  c.ssOnLogout();
  assert.deepEqual(scKeys(c), [WK('S1')]);
  assert.equal(state(c), null);
  // GM の端末（共有でない・全店）：ログアウトしても写しはそのまま（今までどおり）
  const g = tab(W, 'tGM');
  await pull(g);
  const n = scKeys(g).length;
  g.ssOnLogout();
  assert.equal(scKeys(g).length, n);
});

test('a GM answer that arrives after the shared device switched to crew is thrown away (scope, rows, marks)', async () => {
  const W = world({ rls: true, rlsSc: true });
  const c = tab(W, 't3');
  await pull(c);
  const before = scKeys(c);
  logout(c); login(c, 'tGM');
  const h = holder(c, W); h.hold(ssAsk('tGM', 'pull'));
  const gm = pull(c);
  await until(() => h.n() === 1);
  logout(c); login(c, 't3');
  await pull(c);
  await h.release(); await gm;
  assert.deepEqual(state(c).stores, ['S1']); assert.equal(state(c).who, c.csWho());
  assert.deepEqual(scKeys(c), before, 'no other store’s rows on the device');
  assert.deepEqual(Object.keys(c.scSeenGet()).sort(), before);
  assert.equal(c.scSeesStore('tip', 'S2'), false);
  // 前の人の範囲が残っているあいだ（受け取り直す前）は、見せない・書かない
  login(c, 't4');
  assert.equal(c.scSeesStore('tip', 'S1'), false); assert.equal(c.scLocalWriteOk(TK('S1'), true), false);
  await pull(c);
  assert.equal(c.scSeesStore('tip', 'S3'), true);
});

test('the inner guards: an answer handed in after the sign-in changed is not taken (scTake), and rows of the two kinds are dropped just before they land (ssStaleRows)', async () => {
  const W = world({ rls: true, rlsSc: true });
  const c = tab(W, 't3');
  await pull(c);
  const tk = c.ssToken();
  logout(c); login(c, 'tGM');
  const before = scKeys(c), st0 = state(c);
  // ssPull が確かめたあと・scTake の中で待つあいだにログインが変わった、と同じ
  const r = await c.scTake({ level: 'all', stores: [], tip: true, wn: true, confirm: true, unlock: true, wnWrite: true,
    index: [{ key: TK('S2'), v: 'x1' }], rows: [{ key: TK('S2'), v: 'x1', value: { '2026-11-01': CF('2026-11-01') }, updated_at: T0 }] }, tk);
  assert.equal(r.stale, true);
  assert.deepEqual(state(c), st0, 'the recorded scope is not replaced by the earlier request');
  assert.deepEqual(scKeys(c), before);
  // 取り込む直前：前のログインで頼んだ行の束は、2 つの種類の行を外す（ほかの行はそのまま）
  const rows = [{ key: TK('S2'), value: { '2026-11-01': CF('2026-11-01') } }, { key: WK('S2'), value: [W1] }, { key: 'tasks_all', value: { a: { t: 1 } } }];
  rows._tk = tk;
  const out = c.ssStaleRows(rows);
  assert.deepEqual(plain(out.map(x => x.key)), ['tasks_all']);
});

test('if the scope cannot be decided (people table unreadable), the device keeps its copy and does not fall back to REST', async () => {
  const W = world();
  const c = tab(W, 't3');
  await pull(c);
  const before = scKeys(c), st = state(c);
  W.empsDown = true;
  W.set(TK('S2'), { '2026-11-16': CF('2026-11-16') }, '2026-11-10T12:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual(scKeys(c), before);
  assert.deepEqual(state(c).stores, st.stores);
  assert.equal(anonSc(W), 0);
});

test('the previous-period check (tipBackPull) asks the function which stores are finalized; refused or unreadable stops; the v1146 function keeps REST', async () => {
  const W = world({ rls: true, rlsSc: true });
  // GM（Tip Rate を決める人）：店で分けない。Kai さんの店（S1・応援 S2）のうち確定している店の名前だけ
  const gm = tab(W, 'tGM');
  await pull(gm);
  assert.deepEqual(plain(await gm.tipBackPull('Kai One', '2026-11-01')), ['Store One', 'Store Two']);
  assert.equal(W.ssLast.confirmed.length, 2); assert.equal(W.ssLast.rows, undefined, 'no amounts returned');
  W.set(TK('S2'), { '2026-11-01': UNLOCK() }, '2026-11-10T12:00:00.000000+00:00');
  assert.deepEqual(plain(await gm.tipBackPull('Kai One', '2026-11-01')), ['Store One']);
  // G1：Tip Rate を決めず、その店も見られない：断る（止める・知らせる）
  const g1 = tab(W, 't1');
  assert.equal(await g1.tipBackPull('Kai One', '2026-11-01'), null);
  assert.ok(/確かめられません/.test(g1.__toasts.at(-1)));
  // 関数が落ちた（500）：止める（REST に切り替えない）
  const g2 = tab(W, 'tGM');
  await pull(g2);
  const keep = W.ssHandler; W.ssHandler = async () => new Response('{}', { status: 500 });
  assert.equal(await g2.tipBackPull('Kai One', '2026-11-01'), null);
  assert.ok(/読めませんでした/.test(g2.__toasts.at(-1)));
  W.ssHandler = keep;
  // 前の版の関数（v1146）：今までどおり REST で行を読む
  const W2 = world({ old: 1146 });
  const o = tab(W2, 'tGM');
  assert.deepEqual(plain(await o.tipBackPull('Kai One', '2026-11-01')), ['Store One', 'Store Two']);
  assert.ok(anonSc(W2) > 0);
});

test('the screens: no confirmation status or buttons for a store this sign-in cannot see; unlock/force only with the unlock right; warning KPIs and history hidden, the record button only for those who record; text escaped', () => {
  const body = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i, source.indexOf('\n}', i)); };
  const tip = body('renderTipPeriodSummary');
  assert.match(tip, /var _scNo = \(typeof scSeesStore==='function'\) && !scSeesStore\('tip', storeId\);/);
  assert.match(tip, /var confirm = _scNo \? null : getTipConfirm\(storeId, info\);/);
  assert.match(tip, /var status = _scNo \? '—' :/);
  assert.match(tip, /if \(_scNo\) \{[^\n]*\n[^\n]*このログインでは見られません/);
  assert.match(tip, /\['gm','ceo','office'\]\.includes\(curRole\) && scTipUnlockOk\(\)\)\?`<button[^`]*unconfirmTip/);
  assert.match(tip, /\['gm','office','ceo'\]\.includes\(curRole\) && scTipUnlockOk\(\)\) html \+= ` <button[^`]*forceConfirmTip/);
  assert.match(body('confirmTip'), /if \(setTipConfirm\(storeId, info, data\) === false\) \{ renderPage\('tip'\); return; \}/);
  assert.match(body('unconfirmTip'), /if \(setTipConfirm\(storeId, info, null\) === false\) \{ renderPage\('tip'\); return; \}/);
  const req = body('renderRequired');
  assert.match(req, /var _wnNo = \(typeof scSeesStore==='function'\) && !scSeesStore\('wn', storeId\);/);
  assert.match(req, /var _wnCan = ROLE_CONFIG\[curRole\]\.canApprove && \(typeof scWnWritable!=='function' \|\| scWnWritable\(storeId\)\);/);
  assert.match(req, /var warnings = _wnNo \? \[\] : getWarnings\(storeId\);/);
  assert.match(req, /\$\{_wnCan\?`<button[^`]*logWarning/);
  assert.match(req, /escapeHtml\(String\(w\.reason\|\|''\)\)/); assert.match(req, /escapeHtml\(String\(w\.by\|\|''\)\)/);
  assert.match(body('logWarning'), /if \(!saveWarnings\(storeId, warnings\)\) \{ renderPage\('required'\); return; \}/);
  const pgd = body('renderPGD');
  assert.match(pgd, /var _wnSee = function\(sid\)\{ return \(typeof scSeesStore!=='function'\) \|\| scSeesStore\('wn', sid\); \};/);
  assert.match(pgd, /STORES\.forEach\(s=>\{ if\(!_wnSee\(s\.id\)\) return; getWarnings\(s\.id\)/);
  assert.match(pgd, /var _wnHidden = \[emp\.store\]\.concat\(emp\.support\|\|\[\]\)\.filter\(Boolean\)\.some\(function\(sid\)\{ return !_wnSee\(sid\); \}\);/);
  assert.match(pgd, /\} else if \(_wnHidden\) \{/);
  assert.match(pgd, /escapeHtml\(String\(w\.reason\|\|''\)\)/);
  // 前の名前の記録の移し替え：見られない店の分は移さない（送っても断られる）
  assert.match(body('v1136MoveLocalOnly'), /if\(typeof scLocalWriteOk==='function' && !scLocalWriteOk\(nk, true\)\) return; fold\(nk, tc\[nk\], mergeLocalRecMap\);/);
  // 画面で使う関数の動き（範囲が決まった端末）
  const c = tab(world(), 't3');
  c.localStorage.setItem('_sc_state', JSON.stringify({ level: 'scoped', stores: ['S1'], tip: true, wn: true, confirm: true, unlock: false, wnWrite: false, who: c.csWho(), at: 1 }));
  assert.equal(c.scSeesStore('tip', 'S1'), true); assert.equal(c.scSeesStore('wn', 'S2'), false);
  assert.equal(c.scWnWritable('S1'), false); assert.equal(c.scTipUnlockOk(), false);
  c.localStorage.setItem('_sc_state', JSON.stringify({ level: 'all', stores: [], tip: true, wn: false, confirm: true, unlock: true, wnWrite: false, who: c.csWho(), at: 1 }));
  assert.equal(c.scSeesStore('tip', 'S9'), true); assert.equal(c.scSeesStore('wn', 'S1'), false, 'office crew: tips but no warning log'); assert.equal(c.scTipUnlockOk(), true);
  c.localStorage.setItem('_sc_state', JSON.stringify({ level: 'all', stores: [], tip: true, wn: true, unlock: true, wnWrite: true, who: 'someone else', at: 1 }));
  assert.equal(c.scSeesStore('tip', 'S1'), false, 'the previous person’s scope is not used'); assert.equal(c.scTipUnlockOk(), false); assert.equal(c.scWnWritable('S1'), false);
});

test('Codex #141 6781928056 P2-3: the growth chart (renderPGD) shows warning logs only of stores this sign-in can see — a queued row of another store stays on the device but is not shown', () => {
  const body = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n}', i) + 2); };
  const MEMx = new Map();
  const ctx = vm.createContext({
    localStorage: { getItem: k => (MEMx.has(k) ? MEMx.get(k) : null), setItem: (k, v) => MEMx.set(k, String(v)), removeItem: k => MEMx.delete(k) },
    csWho: () => 'me', console,
    STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    getEmployees: () => [{ name: 'Kai One', store: 'S1', support: ['S2'], step: 0, role: 'crew' }],
    ls: (k, d) => (MEMx.has('ls:' + k) ? JSON.parse(MEMx.get('ls:' + k)) : d),
    STEP_PROMO: { 0: { role: 'Crew', next: 'x', cond: [] } }, t: (a) => a, escapeHtml: x => String(x).replace(/</g, '&lt;'),
    kpi: (l, v) => '<div>' + l + ' ' + v + '</div>', ROLE_CONFIG: { crew: { label: 'Crew' } }, curRole: 'gm', SKILL_TRAINING: {}, posLabel: x => x, getStorePositions: () => [], getEmpSkillsStore: () => ({}), empStoresOf: e => [e.store], tStatus: x => x, _tipLatestApproved: () => null,
  });
  vm.runInContext([varLine(/^var SC_STATE_KEY = .*$/m), body('scStateGet'), body('scSeesStore'), body('getWarnings'), body('renderPGD'),
    'this.renderPGD = renderPGD;'].join('\n'), ctx);
  const SECRET = 'Kai One — 必須タスク未完了 S2 のひみつ';
  MEMx.set('ls:warnings_S2', JSON.stringify([{ date: '2026/11/10', by: 'x', reason: SECRET, id: 'w1', _mut: 1 }]));   // 送信待ちで残っている見られない店の行
  MEMx.set('ls:warnings_S1', JSON.stringify([{ date: '2026/11/09', by: 'x', reason: 'Kai One — S1 の記録', id: 'w2', _mut: 1 }]));
  MEMx.set('_sc_state', JSON.stringify({ level: 'scoped', stores: ['S1'], tip: true, wn: true, who: 'me', at: 1 }));
  let html = ctx.renderPGD('Kai One');
  assert.ok(!html.includes('ひみつ'), 'the S2 row is not shown'); assert.ok(html.includes('S1 の記録'), 'the S1 row is shown');
  assert.ok(html.includes('このログインでは見られない店の注意ログは出していません'), 'it says some stores are not shown');
  MEMx.set('_sc_state', JSON.stringify({ level: 'none', stores: [], tip: false, wn: false, who: 'me', at: 1 }));
  html = ctx.renderPGD('Kai One');
  assert.ok(!html.includes('ひみつ') && !html.includes('S1 の記録'), 'none: nothing'); assert.ok(html.includes('注意ログは、このログインでは見られません'));
  assert.ok(!html.includes('注意ログなし・良好です'), 'not “no warnings, good”');
  assert.ok(MEMx.has('ls:warnings_S2'), 'the queued row stays on the device');
  MEMx.delete('_sc_state');   // 範囲がまだ決まっていない（関数が前の版）：今までどおり全部
  html = ctx.renderPGD('Kai One');
  assert.ok(html.includes('ひみつ') && html.includes('S1 の記録'));
});

// ---- Codex（#142 6785448408）P2 と同じ形（v1147 でも見た）：送信待ちの印がある行を共有の端末に残しても、次にログインした人の読み出し
// （getTipConfirm・getWarnings）はその人の店の外を返さない（受け取る前・取得の失敗・REST に戻ったときも）。GM の変更は残り、戻ったら送り直せる
const readers = c => { if (!c.getWarnings) vm.runInContext(fn('getTipConfirm') + '\n' + fn('getWarnings') + '\nfunction v1136Moved(){ return true; }', c); return c; };
const S2_EDIT = { '2026-11-01': CF('2026-11-01', { totalFinal: 555, _at: 1762800000000 }) };
const WN_EDIT = [W1, WNEW(7)];
const see = (c, s) => ({ tip: plain(c.getTipConfirm(s, { from: s === 'S3' ? '2026-10-16' : '2026-11-01' })), wn: plain(c.getWarnings(s)) });

test('Codex #142 P2 (same shape in v1147): a GM\'s unsent rows of other stores on a shared device are not read by the next sign-in, before or after its pull, nor when the range cannot be received', async () => {
  const W = world({ rlsSc: true });
  const c = readers(tab(W, 'tGM'));
  c.localStorage.setItem('_ss_mark', JSON.stringify({ shared: true, keep: {}, unsafe: {} }));
  await pull(c);
  c.MEM.set(TK('S2'), JSON.stringify(S2_EDIT)); c.__pending[TK('S2')] = true;   // GM が直したが送れていない
  c.MEM.set(WK('S2'), JSON.stringify(WN_EDIT)); c.__pending[WK('S2')] = true;
  assert.equal(see(c, 'S2').tip.totalFinal, 555);
  logout(c);
  assert.deepEqual(local(c, TK('S2')), S2_EDIT, 'kept for the GM'); assert.deepEqual(local(c, WK('S2')), WN_EDIT);
  login(c, 't3');   // S1 だけ
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] }, 'before the pull');
  assert.equal(c.scLocalWriteOk(WK('S2'), true), false, 'and not overwritten from an empty read');
  await pull(c);
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] }, 'after the pull (S2 is outside)');
  assert.equal(see(c, 'S1').tip.totalFinal, 123.45, 'the own store');
  assert.deepEqual(local(c, TK('S2')), S2_EDIT, 'still kept');
  logout(c);
  // 見られる店を決められない・関数が答えない（REST に戻る。SQL のあとなので REST は返さない）
  W.empsDown = true; W.fresh();
  login(c, 't3'); await pull(c);
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] }, 'cannot decide the stores');
  W.empsDown = false; W.fresh();
  W.ssDown = true; await pull(c);
  assert.equal(state(c), null, 'REST as before');
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] }, 'REST: the kept rows are not read');
  assert.equal(c.scLocalWriteOk(WK('S2'), true), false);
  W.ssDown = false; c._ss.legacy = null;
  logout(c);
  // GM が戻る：読める・送り直せる
  login(c, 'tGM');
  assert.equal(see(c, 'S2').tip.totalFinal, 555, 'GM before the pull (nothing decided yet: CEO/GM may read the kept rows)');
  await pull(c);
  assert.equal(see(c, 'S2').tip.totalFinal, 555, 'GM after the pull');
  assert.ok(see(c, 'S2').wn.some(w => w.id === 'wN7'));
  for (const k of [TK('S2'), WK('S2')]) { assert.equal(await c.syncMasterToSupabase(k, c.ls(k, null)), true, k); delete c.__pending[k]; }
  assert.equal(W.get(TK('S2'))['2026-11-01'].totalFinal, 555); assert.ok(W.get(WK('S2')).some(w => w.id === 'wN7'));
  assert.equal(anonSc(W), 0);
});

test('Codex #142 P2 (v1147): on the GM\'s own device (not shared) the next sign-in reads no store of the GM\'s copy until its own range arrives; falling back to REST drops the other sign-in\'s copies', async () => {
  const W = world({ rlsSc: true });
  const c = readers(tab(W, 'tGM'));
  await pull(c); logout(c);
  assert.ok(local(c, TK('S2')), 'kept on the GM\'s own device');
  login(c, 't3');
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] }); assert.equal(see(c, 'S1').tip, null, 'another sign-in\'s range: nothing yet');
  W.ssDown = true; await pull(c);
  assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] });
  assert.equal(local(c, TK('S2')), undefined, 'the GM copy without unsent changes left the device');
  W.ssDown = false; c._ss.legacy = null;
  await pull(c);
  assert.equal(see(c, 'S1').tip.totalFinal, 123.45); assert.deepEqual(see(c, 'S2'), { tip: null, wn: [] });
});
