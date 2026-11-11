// v1148（2b の 10 個目・Moto さん 11/10「Career Score と同じ範囲に」）のアプリ側：グレード履歴（grade_hist）・賞与の個人設定（bonus_eval_ovr）・
// G3 の職種（bonus_track）を、REST（公開の鍵）ではなく関数 secure-state で受け取る（GM・CEO＝全部・経理と事務Crew のグレード履歴＝全部・
// ほかは Career Score で見られる人と本人の分だけ）。見られる人の分だけの写しは合流せずに置き換え、この端末で書かない。
// アプリの本物の取り込み（_kvPullRows・_applyKvRows・gbTake・gbSeenRecord・ssStaleRows）・送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssPutRow）・
// 端末で書いてよいか（gbLocalWriteOk）・ログアウト（ssOnLogout → gbOnLogout）・画面が読む関数（ghRecs・btrGet・kevOvrAll）を vm で動かし、
// 本物の関数（handler）と合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。合流の決まりはアプリの本物（OP_MERGE の行）。
// 前の版の関数は、入れる一式の v1147 の 1 ファイル（scfn:1 はあるが gbfn:1 は無い）。合成データだけ（架空の人と店。本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHandler, gbIsKey as serverGbIsKey } from '../supabase/functions/secure-state/handler.mjs';
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
const GB = ['grade_hist', 'bonus_eval_ovr', 'bonus_track'];
// 合流の決まりはアプリの本物（OP_MERGE の行。cas も）
const DEFS = Object.fromEntries(GB.map(k => { const m = source.match(new RegExp('^  ' + k + ':\\s+(\\{[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return [k, m[1]]; }));

async function oldHandler(path, tag) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
  const tmp = mkdtempSync(join(tmpdir(), tag));
  writeFileSync(join(tmp, 'handler.mjs'), s);
  return (await import(pathToFileURL(join(tmp, 'handler.mjs')).href)).createHandler;
}
const createHandler1147 = await oldHandler('deploy/secure-tip-cf-v1147/2_関数_secure-state_index.ts', 'ss1147-');

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite',
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'migrateUploadLocalOps', 'supaHeaders', '_lsRequestDeferredPrefix',
    '_srPending', 'mergeSkillReq', 'mergeLssReq', 'outboxLabel'].map(fn),
  ...['_recAt', 'kevN', 'kevV1Has', '_kevPT', 'ghAll', 'kevOvrAll', 'btrAll', 'btrKey', 'btrGet'].map(oneLine),
  varLine(/^var KEV_EV_META = .*$/m), varLine(/^var CSC_TRACK_NAME = .*$/m),
  ...['mergeMapByTime', '_coversMapByTime', 'kevMergeEvRec', 'kevMergeVerRec', 'kevMergeMap', 'kevCoversMap'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=['spl_lss_history_'], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null, _lsDeferReq={};
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curLang='ja', __pending={}, __fetched={}, __alerts=[], __toasts=[], __rerender=0, __failed=[], __pushed=[];
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   /* アプリの lsSet の入口と同じ：Career Score（csLocalWriteOk）・v1147 の店ごとの行（scLocalWriteOk）・v1148 の 3 つ（gbLocalWriteOk） */
   function lsSet(k, v){ if(!csLocalWriteOk(k) || !scLocalWriteOk(k) || !gbLocalWriteOk(k)){ __failed.push(k); return false; } MEM.set(k, JSON.stringify(v)); __pushed.push(syncMasterToSupabase(k, v)); return true; }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(k){ __failed.push(k); }
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(k){ return k.indexOf('spl_lss_history_')===0; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _lsSetVerified(k, j){ return _lsWriteVerified(k, j); } function _lsFreeOldLaborKeys(){} function _lsRerenderSoon(){ __rerender++; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   var __DEFS={ ${Object.entries(DEFS).map(([k, d]) => JSON.stringify(k) + ':' + d).join(', ')} };
   function _opMergeDef(k){ return __DEFS[k] || null; }
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
   var _pushQ={}, __mine=[]; function _saveWho(){ return curUserName||''; } function _outboxMine(){ return __mine; } function _pushBusy(k){ return false; }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function karteRerender(){ __rerender++; } function showToast(m){ __toasts.push(m); } function alert(m){ __alerts.push(m); }
   function t(ja, en){ return ja; }
   var document={ getElementById:function(){ return null; } };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-3', name: 'Sal Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-1B', name: 'Bo One', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-3B', name: 'Tim Three', store: 'S3', role: 'sl', title: 'Store Leader' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M', confirmed: true },
  tOF: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia', confirmed: true },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'], name: 'Amy Area', confirmed: true },
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false },
  tStore: 'deny',
};
const WRP = [{ emp_id: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'] }, { emp_id: 'E-4', role: 'staff', grade: 4, stores: ['S1'] }, { emp_id: 'E-3', role: 'staff', grade: 3, stores: ['S1'] }];
const USER = { tGM: ['gm', 'Gina M'], tOF: ['office', 'Ofelia'], tAM: ['am', 'Amy Area'], t4: ['am', 'Leo Four'], t1: ['crew', 'Kai One'], tStore: ['sl', ''] };
const MGR = { 'aaaaaaaa-0000-0000-0000-000000000001': { role: 'gm', emp_id: 'E-GM' }, 'aaaaaaaa-0000-0000-0000-000000000002': { role: 'office', emp_id: 'E-OF' } };
const T0 = '2026-11-09T09:00:00.000000+00:00';
const IDS = EMPS.map(e => e.id);
const REC = id => ({ recs: [{ id: 'r-' + id, d: '2026-04-01', g: 'G3', from: '', start: true, src: 'hire', by: 'Gina M', at: '2026/04/01 10:00', note: '' }], name: id, _at: 1762500000000 });
const OV = n => ({ set: { c: { b8: 1, bp8: 250 + n } }, at: '2026-11-03 09:00', by: 'Gina M', _at: 1762500000000 + n, _t: { c: 1762500000000 + n } });
const V = {
  grade_hist: Object.fromEntries(IDS.map(id => [id, REC(id)])),
  bonus_eval_ovr: Object.fromEntries(IDS.map((id, i) => [id + '|2026-Q3', OV(i)])),
  bonus_track: Object.fromEntries(IDS.map(id => ['2026-Q3|' + id, { t: 'sv', at: '2026/11/01', by: 'Gina M', _at: 1762500000000 }])),
};
const pick = (k, ids) => Object.fromEntries(Object.entries(V[k]).filter(([x]) => ids.some(id => k === 'grade_hist' ? x === id : (k === 'bonus_track' ? x.endsWith('|' + id) : x.startsWith(id + '|')))));
// 見られる人（Career Score と同じ）
const AM_IDS = ['E-AM', 'E-4', 'E-3', 'E-1', 'E-1B'], G4_IDS = ['E-4', 'E-3', 'E-1'], OF_IDS = ['E-OF'];

function world(o = {}) {
  const W = makeWorld({ pins: JSON.parse(JSON.stringify(ME)), emps: EMPS.map(e => ({ ...e })), wrPeople: WRP.map(x => ({ ...x })), mgr: MGR, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.fresh = () => { W.ssHandler = (o.old ? createHandler1147 : createHandler)({ env, fetch: (u, x) => W.fetch(u, x), now: () => Date.UTC(2026, 10, 10, 10, 0, 0) }); };
  W.fresh();
  for (const k of GB) W.set(k, V[k], T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
  return W;
}
function tab(W, who) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  if (who) login(c, who);
  return c;
}
function login(c, who) {
  c._hwSession = who;
  vm.runInContext('curRole=' + JSON.stringify(USER[who][0]) + '; curRealRole=curRole; curUserName=' + JSON.stringify(USER[who][1]) + '; curStoreLogin=' + (who === 'tStore' ? '{ id:"S1" }' : 'null') + ';', c);
}
const plain = x => JSON.parse(JSON.stringify(x));
const local = (c, k) => { const v = c.MEM.get(k); return v == null ? undefined : JSON.parse(v); };
const apply = (c, rows0) => { const rows = c.ssStaleRows(rows0); const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); c.csSeenRecord(rows, ok); c.scSeenRecord(rows, ok); c.gbSeenRecord(rows, ok); return rows; };
const pull = async (c, force) => apply(c, await c._kvPullRows(!!force));
const logout = c => { c.ssOnLogout(); c._hwSession = null; vm.runInContext('curRole=null; curRealRole=null; curUserName=null; curStoreLogin=false;', c); };
const state = c => JSON.parse(c.localStorage.getItem('_gb_state') || 'null');
const anonGb = W => W.calls.anonGb || 0;
const fill = (c, W) => { for (const k of GB) c.MEM.set(k, JSON.stringify(W.get(k))); };   // v1147 までの端末（REST で全員の分を持っている）
const push = async (c, k, v) => { c.__pushed.length = 0; const ok = c.lsSet(k, v); return [ok, ...(await Promise.all(c.__pushed))]; };

test('keys and routing are the same as the function; the three are read through the function only with a PIN sign-in; before the first answer the device behaves as before', () => {
  const c = tab(world(), 't1');
  for (const k of [...GB, 'grade_hist ', 'Grade_hist', 'bonus_eval', 'bonus_eval_rule', 'bonus_q', 'cs_guide', 'tip_cf_S1_2026', 'tasks_all', null, 1]) assert.equal(c.gbIsKey(k), serverGbIsKey(k), String(k));
  for (const k of GB) { assert.equal(c.ssRouted(k), true, k + ' is read through the function'); assert.equal(c.swRouted(k), true, k + ' is still written through the function (GM/CEO)'); }
  assert.equal(tab(world(), null).ssRouted('grade_hist'), false, 'no PIN sign-in: REST as before');
  for (const k of GB) { assert.equal(c.gbSees(k), true); assert.equal(c.gbLocalWriteOk(k), true, k + ': no state yet = as before'); }
  assert.equal(c.outboxLabel('grade_hist'), 'グレード履歴');
});

test('GM: the three come from the function whole, none through the public key; unchanged rows are not sent again; a changed row only', async () => {
  const W = world({ rlsGb: true });
  const c = tab(W, 'tGM');
  await pull(c);
  assert.equal(anonGb(W), 0, 'no row of the three through the public key');
  for (const k of GB) assert.deepEqual(local(c, k), V[k], k);
  assert.deepEqual(state(c).keys, { grade_hist: 'all', bonus_eval_ovr: 'all', bonus_track: 'all' });
  assert.equal(state(c).who, c.csWho());
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 1 } }, 'other rows still by REST');
  await pull(c);
  assert.deepEqual(W.ssLast.gb.rows, [], 'unchanged rows are skipped');
  W.set('bonus_track', { ...V.bonus_track, '2026-Q4|E-3': { t: 'op', _at: 1762800000000 } }, '2026-11-10T11:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual(W.ssLast.gb.rows.map(r => r.key), ['bonus_track']);
  assert.deepEqual(local(c, 'bonus_track')['2026-Q4|E-3'], { t: 'op', _at: 1762800000000 });
  // GM はこの端末で書ける（関数が書く）
  assert.equal(c.gbLocalWriteOk('grade_hist'), true);
  const r = await push(c, 'grade_hist', { ...local(c, 'grade_hist'), 'E-9': REC('E-9') });
  assert.deepEqual(r, [true, true]); assert.ok('E-9' in W.get('grade_hist'));
  assert.equal(anonGb(W), 0);
});

test('AM on a device that had everyone (the v1147 REST way): the copies are replaced by the Career Score range (not merged); unsent changes stay; the device does not write them', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  fill(c, W);
  c.MEM.set('bonus_track', JSON.stringify({ ...V.bonus_track, 'x|E-9': { t: 'op', _at: 9 } })); c.__pending.bonus_track = true;   // 送れていない変更のある行は残す
  await pull(c);
  assert.deepEqual(local(c, 'grade_hist'), pick('grade_hist', AM_IDS));
  assert.deepEqual(local(c, 'bonus_eval_ovr'), pick('bonus_eval_ovr', AM_IDS), 'the keepLocal merge does not keep the others');
  assert.ok('x|E-9' in local(c, 'bonus_track'), 'the unsent change stays (merged as before)');
  assert.deepEqual(state(c).keys, { grade_hist: 'scoped', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' });
  assert.equal(anonGb(W), 0, 'no row of the three through the public key (before the SQL as well)');
  // 画面が読む関数：見られる人の分がある（Career Score の基準点・G3 の職種）
  assert.ok(c.ghAll()['E-1'] && !c.ghAll()['E-3B'] && !c.ghAll()['E-GM']);
  assert.equal(c.btrGet('2026-Q3', 'E-3').t, 'sv');
  assert.ok(c.kevOvrAll()['E-1B|2026-Q3'] && !c.kevOvrAll()['E-OF|2026-Q3']);
  // 送れていない変更が無くなった（断られたものを外した・送れた）あとの取り込みで、届いた行に置き換える（合流した写しの印は残していない）
  delete c.__pending.bonus_track;
  await pull(c);
  assert.deepEqual(local(c, 'bonus_track'), pick('bonus_track', AM_IDS));
  assert.equal(c.btrGet('2026-Q3', 'E-3B'), null);
  // この端末では書かない（書けるのは GM・CEO）
  assert.equal(c.gbLocalWriteOk('grade_hist'), false);
  const r = await push(c, 'grade_hist', { ...local(c, 'grade_hist'), 'E-9': REC('E-9') });
  assert.deepEqual(r, [false]); assert.ok(c.__toasts.some(m => /グレード履歴・賞与の個人設定・G3 の職種を変えられるのは GM・CEO です/.test(m)), c.__toasts.join(' | '));
  assert.ok(!('E-9' in W.get('grade_hist')));
  await pull(c);
  assert.deepEqual(W.ssLast.gb.rows, [], 'unchanged rows are skipped');
  // 担当の店に人が入る（Career Score の範囲が変わる）：送り直して、置き換える
  W.emps.push({ id: 'E-NEW', name: 'New One', store: 'S2', role: 'crew', title: 'Crew' });
  W.set('grade_hist', { ...V.grade_hist, 'E-NEW': REC('E-NEW') }, '2026-11-10T12:00:00.000000+00:00');
  await pull(c);
  assert.deepEqual(local(c, 'grade_hist'), { ...pick('grade_hist', AM_IDS), 'E-NEW': REC('E-NEW') });
  // 担当の店から人が外れる：その人の記録も端末から消える（合流で残さない）
  W.emps = W.emps.filter(e => e.id !== 'E-1B');
  await pull(c);
  assert.ok(!('E-1B' in local(c, 'grade_hist')) && !('E-1B|2026-Q3' in local(c, 'bonus_eval_ovr')));
});

test('crew and G4: only their own / their store\'s records; even if the server ignored the "not" filters, REST rows of the three never land', async () => {
  const W = world({ ignoreNot: true });
  const one = tab(W, 't1');
  fill(one, W);
  await pull(one);
  for (const k of GB) assert.deepEqual(local(one, k), pick(k, ['E-1']), 'crew ' + k);
  assert.ok(one.ghAll()['E-1'], 'the own grade history (HR benefits on the vacation screen)');
  const g4 = tab(W, 't4');
  await pull(g4);
  for (const k of GB) assert.deepEqual(local(g4, k), pick(k, G4_IDS), 'G4 ' + k);
});

test('Accounting: the whole grade history (HR benefits, as today), only the Career Score range for the other two; the device can hold the grade history but the server still refuses a change', async () => {
  const W = world({ rlsGb: true });
  const c = tab(W, 'tOF');
  fill(c, W);
  await pull(c);
  assert.deepEqual(local(c, 'grade_hist'), V.grade_hist);
  assert.deepEqual(local(c, 'bonus_eval_ovr'), pick('bonus_eval_ovr', OF_IDS));
  assert.deepEqual(local(c, 'bonus_track'), pick('bonus_track', OF_IDS));
  assert.deepEqual(state(c).keys, { grade_hist: 'all', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' });
  assert.equal(c.gbLocalWriteOk('bonus_track'), false);
  assert.equal(c.gbLocalWriteOk('grade_hist'), true, 'held whole as before');
  const r = await push(c, 'grade_hist', { ...V.grade_hist, 'E-9': REC('E-9') });
  assert.deepEqual(r, [true, false], 'refused by the server (v1145: GM/CEO only)');
  assert.ok(!('E-9' in W.get('grade_hist')));
  assert.equal(anonGb(W), 0);
});

test('the store login and a sign-in without a PIN mark get none: the copies leave the device and nothing comes by REST', async () => {
  const W = world();
  const s = tab(W, 'tStore');
  fill(s, W);
  await pull(s);
  for (const k of GB) assert.equal(local(s, k), undefined, k);
  assert.deepEqual(state(s).keys, { grade_hist: 'none', bonus_eval_ovr: 'none', bonus_track: 'none' });
  assert.equal(s.gbSees('grade_hist'), false); assert.equal(s.gbLocalWriteOk('grade_hist'), false);
  assert.equal(anonGb(W), 0);
  const n = tab(W, null); vm.runInContext("curRole='crew';", n);   // PIN の印の無い人（CEO・GM でない）
  fill(n, W);
  await pull(n);
  for (const k of GB) assert.equal(local(n, k), undefined, 'no PIN mark ' + k);
});

test('when the people cannot be decided (the function answers gb: error) the device keeps its copy and does not read them by REST either', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await pull(c);
  const before = Object.fromEntries(GB.map(k => [k, local(c, k)]));
  W.empsDown = true; W.fresh();
  const n0 = anonGb(W);
  await pull(c);
  for (const k of GB) assert.deepEqual(local(c, k), before[k], k);
  assert.equal(anonGb(W), n0);
});

test('the function is still v1147 (no gbfn): the three are read by REST as before (before the SQL); writing stays as in v1145 / v1143', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tAM');
  await pull(c);
  for (const k of GB) assert.deepEqual(local(c, k), V[k], k + ' by REST');
  assert.equal(state(c), null, 'no range recorded = the screens as before');
  assert.ok(anonGb(W) > 0, 'read with the public key');
  assert.ok(c._ss.gbOld, 'the pull answer had no gbfn: remembered for 10 minutes');
  assert.equal(c.ssRouted('bonus_track'), false, 'within the 10 minutes the reads go straight to REST');
  assert.deepEqual(await c._fetchOpValue('bonus_track'), V.bonus_track);
  // 10 分たって、また関数に聞く 1 回目の読み込み：前の版の関数は知らない（400）ので、その場で REST に（読めないままにしない）
  c._ss.gbOld = null;
  const n0 = W.calls.ss;
  assert.deepEqual(await c._fetchOpValue('bonus_track'), V.bonus_track);
  assert.equal(W.calls.ss, n0 + 1); assert.ok(c._ss.gbOld);
  // GM の書き込み：v1147 の関数がそのまま書く（関数で読めないので cas の読み込みは REST）
  const g = tab(W, 'tGM');
  const r = await push(g, 'bonus_track', { ...V.bonus_track, '2026-Q4|E-3': { t: 'op', _at: 1762800000000 } });
  assert.deepEqual(r, [true, true]);
  assert.ok('2026-Q4|E-3' in W.get('bonus_track'));
  assert.ok(W.log.some(x => x[0] === 'write' && x[1] === 'service' && x[2] === 'bonus_track'), 'written by the function');
});

test('logout: a shared device or a sign-in that does not get everything leaves no copy; the GM\'s own device keeps them', async () => {
  const W = world();
  const am = tab(W, 'tAM');
  await pull(am);
  logout(am);
  for (const k of GB) assert.equal(local(am, k), undefined, 'AM ' + k);
  assert.equal(state(am), null);
  const gm = tab(W, 'tGM');
  await pull(gm);
  logout(gm);
  for (const k of GB) assert.deepEqual(local(gm, k), V[k], 'GM own device ' + k);
  const sh = tab(W, 'tGM');
  sh.localStorage.setItem('_ss_mark', JSON.stringify({ shared: true, keep: {}, unsafe: {} }));
  await pull(sh);
  logout(sh);
  for (const k of GB) assert.equal(local(sh, k), undefined, 'GM on a shared device ' + k);
});

test('a GM answer that arrives after the device switched to crew does not land (ssStaleRows / gbTake); the next pull gives the crew range', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  const held = []; let pred = null;
  c.fetch = async (u, o) => { const res = await W.fetch(u, o); if (pred && pred(String(u), o)) await new Promise(r => held.push(r)); return res; };
  pred = (u, o) => u === SS && JSON.parse(o.body).action === 'pull';
  const p = c._kvPullRows(false);
  for (let i = 0; i < 200 && !held.length; i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(held.length, 1);
  logout(c); login(c, 't1');
  pred = null; held.splice(0).forEach(r => r());
  apply(c, await p);
  for (const k of GB) assert.ok(!local(c, k) || !('E-GM' in local(c, k)) || k !== 'grade_hist', k);
  assert.equal(local(c, 'grade_hist'), undefined, 'the GM answer is dropped');
  await pull(c);
  assert.deepEqual(local(c, 'grade_hist'), pick('grade_hist', ['E-1']));
});

test('the real lsSet entry (index.html) refuses a key of the three that this device does not hold whole, before anything is written', () => {
  const a = source.indexOf('  var sp = _SPLIT_KEYS && _SPLIT_KEYS[key]; if(sp){ return _splitWrite(key, sp, val); }', source.indexOf('\nfunction lsSet(key, val) {'));
  const b = source.indexOf("  if(typeof hrLocalWriteOk==='function' && !hrLocalWriteOk(key)) return false;", a);
  assert.ok(b - a < 2000, 'the entry is short');
  assert.ok(a > 0 && b > a, 'the lsSet entry');
  assert.ok(source.slice(a, b).includes('gbLocalWriteOk(key)'));
  const ctx = vm.createContext({ notes: [], ok: {} });
  vm.runInContext(`var _SPLIT_KEYS={}; function _lsNoteSaveFailure(k){ notes.push(k); } function _splitWrite(){ return 'split'; }
    function csLocalWriteOk(){ return true; } function scLocalWriteOk(){ return true; } function gbLocalWriteOk(k){ return ok[k] !== false; }
    function entry(key, val){ ${source.slice(a, b)} return 'next'; }`, ctx);
  ctx.ok.grade_hist = false;
  assert.equal(ctx.entry('grade_hist', {}), false, 'refused');
  assert.deepEqual([...ctx.notes], ['grade_hist'], 'noted as a failed save');
  assert.equal(ctx.entry('bonus_track', {}), 'next', 'a key the device holds whole goes on');
});

test('the one-time upload of device-only data (migrateUploadLocalOps) never sends the three, even when the cloud list does not show them (after the SQL)', async () => {
  const W = world({ rlsGb: true });
  const c = tab(W, 'tAM');
  fill(c, W);   // v1147 の端末（全員の分を持っている）
  const sent = [], f0 = W.fetch;
  W.fetch = (u, o) => { const s = decodeURIComponent(String(u)) + ' ' + String((o && o.body) || ''); if (/grade_hist|bonus_eval_ovr|bonus_track/.test(s)) sent.push(String(u)); return f0(u, o); };
  await c.migrateUploadLocalOps();
  W.fetch = f0;
  assert.equal(c.localStorage.getItem('_f2b_opsync2'), '1', 'the upload ran');
  assert.deepEqual(sent, [], 'no request about the three');
  for (const k of GB) assert.deepEqual(W.get(k), V[k], k);
});

test('removing a refused save on a sign-in that gets none (the store login): only this device copy goes; the function is not asked', async () => {
  const W = world();
  const s = tab(W, 'tStore');
  fill(s, W); s.__pending.grade_hist = true; s.__mine.push({ key: 'grade_hist' });
  await pull(s);
  assert.equal(state(s).keys.grade_hist, 'none');
  assert.ok(local(s, 'grade_hist'), 'kept while unsent');
  s.localStorage.setItem('_ss_refused_v1', JSON.stringify({ grade_hist: { at: 1, st: 403, fp: s.ssRefusedFp('grade_hist'), who: s._saveWho() } }));
  assert.deepEqual(plain(s.ssRefusedList().map(x => x.key)), ['grade_hist']);
  const n0 = W.calls.ss;
  const r = plain(await s.ssDropRefused(['grade_hist']));
  assert.deepEqual({ done: r.done, skip: r.skip }, { done: ['grade_hist'], skip: [] });
  assert.equal(local(s, 'grade_hist'), undefined);
  assert.equal(W.calls.ss, n0, 'the function was not asked (it would refuse)');
  assert.equal(anonGb(W), 0);
});

test('"import from the cloud" (force) sends no marks for the three, so every row comes again', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await pull(c);
  assert.equal(Object.keys(plain(c.gbHaveMap(false))).length, 3, 'marks after a pull');
  assert.deepEqual(plain(c.gbHaveMap(true)), {});
  await pull(c, true);
  assert.deepEqual(W.ssLast.gb.rows.map(r => r.key).sort(), [...GB].sort());
});

test('an answer for an earlier sign-in is not taken by gbTake (the range and the copies stay)', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await pull(c);
  const before = Object.fromEntries(GB.map(k => [k, local(c, k)])), st0 = state(c);
  const tk = c.ssToken();
  login(c, 't1');   // 答えを取り込む前にログインが変わった
  const r = await c.gbTake({ keys: { grade_hist: 'none', bonus_eval_ovr: 'none', bonus_track: 'none' }, index: [], rows: [] }, tk);
  assert.equal(r.stale, true);
  for (const k of GB) assert.deepEqual(local(c, k), before[k], k);
  assert.deepEqual(state(c), st0);
});

test('when the function cannot be reached after v1148, the range record is cleared (the screens as before) and the next answer sets it again', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await pull(c);
  assert.equal(state(c).keys.grade_hist, 'scoped');
  W.ssDown = true;
  await pull(c);
  assert.equal(state(c), null, 'REST as before (before the SQL): no range recorded');
  assert.equal(c.gbLocalWriteOk('grade_hist'), true, 'as before (the server still refuses non-GM writes)');
  W.ssDown = false; c._ss.legacy = null;   // 10 分たった（関数がないと覚えている時間が過ぎた）
  await pull(c);
  assert.equal(state(c).keys.grade_hist, 'scoped');
  assert.deepEqual(local(c, 'grade_hist'), pick('grade_hist', AM_IDS));
});

test('a later (not forced) pull asks REST for no row of the three even before the SQL (the row list shows them)', async () => {
  const W = world();
  const c = tab(W, 'tAM');
  await pull(c);
  await pull(c);
  W.set('grade_hist', { ...V.grade_hist, 'E-1': { ...REC('E-1'), _at: 1762800000000 } }, '2026-11-10T12:30:00.000000+00:00');   // 一覧の印が変わる
  W.set('tasks_all', { a: { t: 2 } }, '2026-11-10T12:30:00.000000+00:00');
  await pull(c);
  assert.deepEqual(local(c, 'tasks_all'), { a: { t: 2 } }, 'the changed other row came by REST (key list)');
  assert.equal(c._kvLast.how, 'keys');
  assert.equal(local(c, 'grade_hist')['E-1']._at, 1762800000000, 'the changed row came from the function');
  assert.equal(anonGb(W), 0, 'no row of the three through the public key');
});

test('the range record of another sign-in counts as "not received" for this one', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  await pull(c);
  assert.equal(c.gbSees('grade_hist'), true);
  login(c, 't1');   // まだ取り込んでいない
  for (const k of GB) assert.equal(c.gbSees(k), false, k);
});

// ---- Codex（#142 6785448408）P2：送信待ちの印がある 3 つの行を共有の端末に残しても、次にログインした人の読み出し（ghAll・kevOvrAll・btrGet）は
// その人の範囲の外を返さない（scoped・none・ログインの切り替え・取得の失敗・REST に戻ったとき）。GM の変更は残り、GM が戻ったら送り直せる
const GM_EDIT = {
  grade_hist: { ...V.grade_hist, 'E-9': REC('E-9') },
  bonus_eval_ovr: { ...V.bonus_eval_ovr, 'E-3B|2026-Q4': OV(40) },
  bonus_track: { ...V.bonus_track, '2026-Q4|E-3B': { t: 'op', at: '2026/11/10', by: 'Gina M', _at: 1762800000000 } },
};
const reads = c => ({ grade_hist: plain(c.ghAll()), bonus_eval_ovr: plain(c.kevOvrAll()), bonus_track: plain(c.btrAll()) });
const ids = m => Object.keys(m).sort();
async function gmLeavesUnsent(W, shared = true) {
  const c = tab(W, 'tGM');
  if (shared) c.localStorage.setItem('_ss_mark', JSON.stringify({ shared: true, keep: {}, unsafe: {} }));
  await pull(c);
  for (const k of GB) { c.MEM.set(k, JSON.stringify(GM_EDIT[k])); c.__pending[k] = true; }   // GM が直したが送れていない（送信待ち）
  assert.deepEqual(reads(c), plain(GM_EDIT), 'the GM reads the own unsent changes');
  logout(c);
  return c;
}

test('Codex #142 P2: after the GM leaves unsent changes on a shared device, crew / AM / the store login read only their own range, before and after the pull', async () => {
  const W = world({ rlsGb: true });
  const c = await gmLeavesUnsent(W);
  for (const k of GB) assert.deepEqual(local(c, k), GM_EDIT[k], k + ': the unsent change stays on the device');
  // スタッフ：受け取る前（ログインの直後）も、受け取ったあとも、本人の分だけ
  login(c, 't1');
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} }, 'before the pull: nothing (not received for this sign-in)');
  assert.equal(c.btrGet('2026-Q4', 'E-3B'), null);
  await pull(c);
  for (const k of GB) assert.deepEqual(reads(c)[k], pick(k, ['E-1']), 'crew ' + k);
  assert.equal(c.btrGet('2026-Q4', 'E-3B'), null); assert.ok(!('E-9' in c.ghAll()));
  for (const k of GB) assert.deepEqual(local(c, k), GM_EDIT[k], k + ': still kept (not merged with the crew range)');
  assert.equal(c.gbLocalWriteOk('grade_hist', true), false);
  // 送れて送信待ちが外れても（だれのか分からない前の版の送信待ちなど）、このログインのあいだは残した写しを読まない
  delete c.__pending.grade_hist;
  assert.deepEqual(ids(c.ghAll()), ['E-1']);
  c.__pending.grade_hist = true;
  // AM：担当の範囲だけ
  logout(c); login(c, 'tAM');
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} });
  await pull(c);
  for (const k of GB) assert.deepEqual(reads(c)[k], pick(k, AM_IDS), 'AM ' + k);
  // 店のログイン：何もない
  logout(c); login(c, 'tStore');
  await pull(c);
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} });
  for (const k of GB) assert.deepEqual(local(c, k), GM_EDIT[k], k + ': still kept for the GM');
  assert.equal(anonGb(W), 0);
});

test('Codex #142 P2: the same when the range cannot be received (people cannot be decided, the function or the PIN check is down)', async () => {
  const W = world({ rlsGb: true });
  const c = await gmLeavesUnsent(W);
  // 見られる人を決められない（gb: error）
  W.empsDown = true; W.fresh();
  login(c, 't1');
  await pull(c);
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} }, 'cannot decide the people');
  W.empsDown = false; W.fresh();
  // 関数が答えない（404＝前の版と同じ扱いで REST に戻る。SQL のあとなので REST は 3 つを返さない）
  W.ssDown = true;
  await pull(c);
  assert.equal(state(c), null, 'REST as before');
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} }, 'REST: the kept copies are not read');
  assert.equal(c.gbLocalWriteOk('bonus_track', true), false, 'and not overwritten from an empty read');
  for (const k of GB) assert.deepEqual(local(c, k), GM_EDIT[k], k);
  W.ssDown = false; c._ss.legacy = null;
  await pull(c);
  for (const k of GB) assert.deepEqual(reads(c)[k], pick(k, ['E-1']), k);
});

test('Codex #142 P2: when the GM comes back the unsent changes are still there, read whole, and sent again', async () => {
  const W = world({ rlsGb: true });
  const c = await gmLeavesUnsent(W);
  login(c, 't1'); await pull(c); logout(c);
  W.ssDown = true; login(c, 't1'); await pull(c); logout(c); W.ssDown = false; c._ss.legacy = null;
  login(c, 'tGM');
  // CEO・GM のログインは、範囲がまだ決まっていない（ログアウトのあと受け取る前・REST に戻った）ときも残した写しを読める（前から全部を持つ人）
  assert.deepEqual(reads(c), plain(GM_EDIT), 'GM before the pull');
  assert.equal(c.gbLocalWriteOk('grade_hist', true), true);
  W.ssDown = true; await pull(c);
  assert.deepEqual(reads(c), plain(GM_EDIT), 'GM in the REST fallback');
  W.ssDown = false; c._ss.legacy = null;
  await pull(c);
  assert.deepEqual(state(c).keys, { grade_hist: 'all', bonus_eval_ovr: 'all', bonus_track: 'all' });
  const rd = reads(c);
  for (const k of GB) assert.deepEqual(ids(rd[k]), ids(GM_EDIT[k]), k + ': the GM reads everyone with the own unsent change (merged with the cloud)');
  assert.deepEqual(rd.grade_hist['E-9'], REC('E-9')); assert.equal(rd.bonus_track['2026-Q4|E-3B'].t, 'op'); assert.equal(rd.bonus_eval_ovr['E-3B|2026-Q4'].set.c.bp8, 290);
  assert.equal(c.secHeld('grade_hist'), false);
  // 送り直し（flushOutbox と同じく端末の写しをそのまま送る）
  for (const k of GB) {
    const r = await c.syncMasterToSupabase(k, c.ls(k, null));
    assert.equal(r, true, k + ' sent'); delete c.__pending[k];
    assert.deepEqual(ids(W.get(k)), ids(GM_EDIT[k]), k + ' in the cloud');
  }
  assert.deepEqual(W.get('grade_hist')['E-9'], REC('E-9')); assert.equal(W.get('bonus_track')['2026-Q4|E-3B'].t, 'op'); assert.equal(W.get('bonus_eval_ovr')['E-3B|2026-Q4'].set.c.bp8, 290);
});

test('Codex #142 P2: the GM\'s own device (not shared) keeps the copies on logout, but the next sign-in reads nothing of them until its own range arrives', async () => {
  const W = world({ rlsGb: true });
  const c = await gmLeavesUnsent(W, false);
  for (const k of GB) assert.deepEqual(local(c, k), GM_EDIT[k], k);
  login(c, 't1');
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} }, 'another sign-in\'s range is not this one\'s');
  W.empsDown = true; W.fresh();
  await pull(c);
  assert.deepEqual(reads(c), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} }, 'and a failed pull does not open them');
  W.empsDown = false; W.fresh();
  await pull(c);
  for (const k of GB) assert.deepEqual(reads(c)[k], pick(k, ['E-1']), k);
  // ここでは印を付けたのは取り込み（gbTake）だけ（GM だけの端末のログアウトは印を付けない）。送信待ちが外れても読まない
  for (const k of GB) delete c.__pending[k];
  for (const k of GB) assert.deepEqual(reads(c)[k], pick(k, ['E-1']), k + ' after the pending mark went away');
  // 送れていない変更が無い GM の写し（全員の分）も：REST に戻ったとき、ほかのログインの写しは使わない
  const W2 = world({ rlsGb: true });
  const g = tab(W2, 'tGM'); await pull(g); logout(g);
  login(g, 't1'); W2.ssDown = true; await pull(g);
  assert.deepEqual(reads(g), { grade_hist: {}, bonus_eval_ovr: {}, bonus_track: {} });
  for (const k of GB) assert.equal(local(g, k), undefined, k + ': the GM copy without unsent changes left the device');
});
