// v1146（2b-8）のアプリ側：Tip Rate の申請・決定（spl_tip_requests_<名前>・tip_requests）とプレップの時給の表・認定（prep_tables・prep_certs）を、
// REST（公開の鍵）ではなく関数 secure-state で書く（読むのは REST のまま）。書いてよいのは今の画面で決められる人（Moto さん 11/10）。
// アプリの本物の送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssCall・ssPutRow・swNote・断った印）と本物の合流（mergeTipReq・mergeMapByTime・
// OP_MERGE の行。cas も）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。前の版の関数は、入れる一式の v1145 の 1 ファイル（ghfn:1 はあるが tpfn:1 は無い）。
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
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = source.slice(i + 1, source.indexOf('\n', i + 1)); return l; };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
// 合流の決まりはアプリの本物（OP_MERGE の行。cas も）
const defLine = k => { const m = source.match(new RegExp('^  ' + k + ':\\s+(\\{ merge:[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return m[1]; };   // OP_MERGE の行（_SPLIT_KEYS の行ではない）
const DEFS = { tip_requests: defLine('tip_requests'), prep_tables: defLine('prep_tables'), prep_certs: defLine('prep_certs'), grade_hist: defLine('grade_hist') };

async function oldHandler(path, tag) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
  const tmp = mkdtempSync(join(tmpdir(), tag));
  writeFileSync(join(tmp, 'handler.mjs'), s);
  return (await import(pathToFileURL(join(tmp, 'handler.mjs')).href)).createHandler;
}
const createHandler1145 = await oldHandler('deploy/secure-grade-hist-v1145/2_関数_secure-state_index.ts', 'ss1145-');

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite', '_opUpsertRow', 'opMergePush', 'syncMasterToSupabase', 'supaHeaders', 'outboxLabel'].map(fn),
  ...['_recAt', '_srPending', '_tipDecT', 'pmCanAdmin'].map(oneLine),
  ...['mergeMapByTime', '_coversMapByTime', '_coversSkillReq', 'mergeTipReq', '_coversTipReq', 'pmCheckForApproval'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, __pending={}, __alerts=[], __toasts=[], __pushed=[], curLang='ja';
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function ls(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); __pushed.push(syncMasterToSupabase(k, v)); return true; }
   function lsKeys(){ return [...MEM.keys()]; }
   function _lsCloudPending(k){ return !!__pending[k]; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   function csIsKey(k){ return false; } function csOnLogout(){} function piiFnMark(){}
   var __DEFS={ ${Object.entries(DEFS).map(([k, d]) => JSON.stringify(k) + ':' + d).join(', ')} };
   function _opMergeDef(k){ return __DEFS[k] || (String(k).indexOf('spl_tip_requests_')===0 ? __DEFS.tip_requests : null); }   /* アプリの OP_MERGE_PREFIX と同じ（親の定義） */
   function _outboxRemove(){}
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function showToast(m){ __toasts.push(m); } function alert(m){ __alerts.push(m); } function closeModalDirect(){} function renderPage(){}
   function pmT(ja, en){ return ja; } var __pmPullOk=true; async function pmPull(){ return __pmPullOk; } var PM_CERT='prep_certs', PM_TBL='prep_tables';
   function pmMap(k){ var m=ls(k, {}); return (m && typeof m==='object' && !Array.isArray(m)) ? m : {}; }
   var document={ getElementById:function(){ return null; } };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tCEO: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  tOF: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const USER = { tGM: 'gm', tCEO: 'ceo', tOF: 'office', tAM: 'am', t4: 'am', t1: 'crew' };   // 役割 g4 はアプリでは AM と同じ（ROLE_ALIAS）
const T0 = '2026-11-09T09:00:00.000000+00:00';
const K = 'spl_tip_requests_Kai One';
const OLD = { id: 'tip0', name: 'Kai One', rate: 80, status: '承認', date: '2026/09/01', approver: 'Moto', approvedDate: '2026/09/02', decAt: 1762500000000 };
const P1 = { id: 'tip1', name: 'Kai One', rate: 90, reason: 'x', status: '申請中', date: '2026/11/01' };
const TIP0 = [OLD, P1];
const approve = (r, st = '承認', at = 1762700000000) => ({ ...r, status: st, approver: 'GM', approvedDate: '2026/11/09', decAt: at, decDay: '2026-11-09', decHst: '2026-11-09', ...(st === '承認' ? { fromDay: '2026-11-09', prevRate: 80 } : {}) });
const TBL0 = { t1: { store: 'S1', from: '2026-11-01', levels: [{ lv: 1, name: 'L1', cents: 1700 }], _at: 1762000000000 } };
const CERTS0 = { c1: { emp: 'E-1', name: 'Kai One', store: 'S1', lv: 2, kind: 'req', state: 'approved', from: '2026-11-10', tbl: 't1', _at: 1762700000000 } };

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: {}, rlsTp: !!o.rlsTp, wrLive: o.wrLive, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = ({ 1145: createHandler1145 }[o.old] || createHandler)({ env, fetch: (u, x) => W.fetch(u, x), now: () => Date.UTC(2026, 10, 10, 10, 0, 0) });
  W.set(K, TIP0, T0);
  W.set('prep_tables', TBL0, T0);
  W.set('prep_certs', CERTS0, T0);
  W.set('grade_hist', { 'E-1': { recs: [], _at: 1762400000000 } }, T0);
  return W;
}
function tab(W, who) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  if (who) {
    if (who !== 'nopin') c._hwSession = who;
    vm.runInContext('curRole=' + JSON.stringify(USER[who] || 'gm') + '; curRealRole=curRole;', c);
  }
  return c;
}
const writesOf = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);
const push = async (c, k, v) => { c.__pushed.length = 0; c.lsSet(k, v); return Promise.all(c.__pushed); };

test('the app routes Tip Rate rows and prep tables/certifications to the function for writing (its own tpfn marker), but reads them by REST; cas on both', () => {
  const c = tab(world(), 'tGM');
  for (const k of [K, 'spl_tip_requests_x', 'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_' + 'x'.repeat(300)]) {
    assert.equal(c.tpIsKey(k), true, k); assert.equal(c.gwIsKey(k), true, k); assert.equal(c.swIsKey(k), false, k + ' is not a v1141–v1145 key');
  }
  for (const k of ['spl_tip_requests_', 'spl_tip_history_Kai One', 'tip_history', 'live_tip_rate', 'prep_cfg', 'prep_history', 'tip_requests ', 'Prep_tables', null, 3]) assert.equal(c.tpIsKey(k), false, String(k));
  for (const k of [K, 'prep_tables', 'prep_certs']) {
    assert.equal(c.swRouted(k), true, k + ' written through the function');
    assert.equal(c.ssRouted(k), false, k + ' still read by REST');
  }
  assert.ok(c._opMergeDef(K).cas && c._opMergeDef('tip_requests').cas && c._opMergeDef('prep_certs').cas && c._opMergeDef('prep_tables').cas, 'cas');
  assert.equal(c.swRouted('grade_hist'), true, 'v1145 unchanged');
  assert.equal(tab(world(), 'nopin').swRouted(K), false, 'no PIN sign-in: REST as before');
  assert.equal(c.outboxLabel(K), 'Tip Rate（Kai One）'); assert.equal(c.outboxLabel('prep_certs'), 'プレップの認定');
});

test('GM, CEO and AM decide a Tip Rate through the function (server key); the device records "secure-state v1146 wrote it"; the staff member adds their own request', async () => {
  for (const who of ['tGM', 'tCEO', 'tAM']) {
    const W = world();
    const c = tab(W, who);
    const v = [OLD, approve(P1)];
    assert.deepEqual(await push(c, K, v), [true], who);
    assert.deepEqual(W.get(K), v, who);
    assert.deepEqual(writesOf(W, K), ['service'], who + ': the server key');
    assert.deepEqual({ how: c._swLast[K].how, by: c._swLast[K].by }, { how: 'fn', by: ME[who].role }, who);
    assert.equal(c.__toasts.length + c.__alerts.length, 0, who + ': no warning');
  }
  const logs = [];
  const c = tab(world(), 'tGM'); c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, K, [OLD, approve(P1)]);
  assert.ok(logs.some(m => m === 'Tip Rate（Kai One）：サーバー（secure-state v1146）が書きました（役割 GM）'), logs.join(' | '));
  vm.runInContext('function t(ja, en){ return en; }', c); logs.length = 0;
  await push(c, 'prep_tables', { ...TBL0, t2: { store: 'S1', from: '2026-12-01', levels: [], _at: 1762800000000 } });
  assert.ok(logs.some(m => /^Prep wage tables: written by the server \(secure-state v1146, role GM\)$/.test(m)), logs.join(' | '));
  // 本人の申請
  const W = world();
  const me = tab(W, 't1');
  const mine = [...TIP0, { id: 'tip2', name: 'Kai One', rate: 100, reason: 'y', status: '申請中', date: '2026/11/10' }];
  assert.deepEqual(await push(me, K, mine), [true]);
  assert.deepEqual(W.get(K), mine);
  assert.deepEqual(writesOf(W, K), ['service']);
  assert.equal(me._swLast[K].by, 'staff');
});

test('a staff member who approves their own Tip Rate, Accounting deciding, and a confirmed G4 after the Work Center is in use: refused (403), the cloud row stays, the device explains and marks it refused', async () => {
  const cases = [['t1', [OLD, approve(P1)]], ['tOF', [OLD, approve(P1)]], ['t4', [OLD, approve(P1)]]];
  for (const [who, v] of cases) {
    const W = world();
    const c = tab(W, who);
    assert.deepEqual(await push(c, K, v), [false], who);
    assert.deepEqual(W.get(K), TIP0, who + ': unchanged');
    assert.ok(c.__toasts.some(m => /^この Tip Rate の記録は、このログインでは変えられません（決めるのは CEO・GM・AM などで、自分の Tip Rate は決めません。申請は本人だけ。サーバーが断りました。/.test(m)), who + ': ' + c.__toasts.join(' | '));
    assert.equal(c.ssRefusedAll()[K].st, 403, who + ': marked refused (can be removed from Save)');
  }
  // 使い始める前の確かめた G4 は決める（今の画面と同じ）
  const W = world({ wrLive: false, wrPeople: [] });
  const g4 = tab(W, 't4');
  assert.deepEqual(await push(g4, K, [OLD, approve(P1)]), [true]);
  assert.deepEqual(writesOf(W, K), ['service']);
  // 経理・AM はプレップの表を変えられない（GM・CEO）
  for (const who of ['tOF', 'tAM']) {
    const W2 = world(); const c = tab(W2, who);
    assert.deepEqual(await push(c, 'prep_tables', { ...TBL0, t1: { ...TBL0.t1, levels: [{ lv: 1, name: 'L1', cents: 9900 }], _at: 1762900000000 } }), [false], who);
    assert.deepEqual(W2.get('prep_tables'), TBL0);
    assert.ok(c.__toasts.some(m => /^プレップの時給の表を変えられるのは GM・CEO です/.test(m)), c.__toasts.join(' | '));
  }
  // 経理は「反映した」の印だけ
  const W3 = world(); const of = tab(W3, 'tOF');
  const mark = { ...CERTS0, c1: { ...CERTS0.c1, toast: { by: 'Ofelia', at: '2026-11-10T01:00:00.000Z' }, _at: 1762900000000 } };
  assert.deepEqual(await push(of, 'prep_certs', mark), [true]);
  assert.deepEqual(W3.get('prep_certs'), mark);
  assert.equal(of._swLast.prep_certs.by, 'office');
});

test('the approval center\'s stamps from any device go through (the rate and decision unchanged); a stale copy that drops them while the staff member adds a request is not stuck', async () => {
  const D = approve(P1, '承認', 1762700000000);
  const W = world(); W.set(K, [OLD, D], T0);
  const of = tab(W, 'tOF');
  const stamped = [OLD, { ...D, _dG: 2, _stK: 'k1', _stT: 1762700000500, _dT: 1762700000500 }];
  assert.deepEqual(await push(of, K, stamped), [true], 'Accounting stamps (approval center)');
  assert.deepEqual(W.get(K), stamped);
  // スタッフの端末は印の無い古い写しを持つ（合流では同じ決定なら手元が勝つ＝今までと同じ）。本人の申請を足しても止まらない
  const me = tab(W, 't1');
  const mine = [OLD, D, { id: 'tip9', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }];
  assert.deepEqual(await push(me, K, mine), [true]);
  assert.equal(W.get(K).length, 3);
  assert.equal(me.__toasts.length, 0, me.__toasts.join(' | '));
});

test('cas: the GM and the AM decide two requests in the same person\'s row at the same time — both stay', async () => {
  const W = world();
  const P2 = { id: 'tip2', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/02' };
  W.set(K, [...TIP0, P2], T0);
  const gm = tab(W, 'tGM'), am = tab(W, 'tAM');
  const r = await Promise.all([gm.opMergePush(K, [OLD, approve(P1, '却下', 1762700000000), P2]), am.opMergePush(K, [OLD, P1, approve(P2, '承認', 1762700000001)])]);
  assert.deepEqual(r, [true, true]);
  const got = W.get(K);
  assert.equal(got.find(x => x.id === 'tip1').status, '却下'); assert.equal(got.find(x => x.id === 'tip2').status, '承認');
  assert.ok(writesOf(W, K).every(x => x === 'service'));
});

test('the function is still v1145 (no tpfn): the app writes Tip Rate and prep by REST as before (before the SQL); the grade history still goes through the function', async () => {
  const W = world({ old: 1145 });
  const c = tab(W, 'tGM');
  assert.deepEqual(await push(c, K, [OLD, approve(P1)]), [true]);
  assert.deepEqual(writesOf(W, K), ['anon'], 'REST with the public key');
  assert.ok(c._ss.tpOld, 'remembered for 10 minutes');
  assert.equal(c._ss.ghOld, null, 'the v1145 function knows the grade history');
  assert.equal(c._swLast[K].how, 'rest');
  const n0 = W.calls.ss;
  assert.deepEqual(await push(c, 'prep_tables', { ...TBL0, t2: { store: 'S1', from: '2026-12-01', levels: [], _at: 1762800000000 } }), [true]);
  assert.equal(W.calls.ss, n0, 'within the 10 minutes the app goes straight to REST');
  assert.deepEqual(writesOf(W, 'prep_tables'), ['anon']);
  assert.deepEqual(await push(c, 'grade_hist', { 'E-1': { recs: [], _at: 1762400000000 }, 'E-9': { recs: [], _at: 1762800000000 } }), [true]);
  assert.deepEqual(writesOf(W, 'grade_hist'), ['service'], 'the grade history through the function');
  const logs = []; c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, K, [OLD, approve(P1, '却下', 1762700000009)]);
  assert.ok(logs.some(m => /^Tip Rate（Kai One）：公開の鍵（REST）で書きました（関数が v1146 でない・PIN のログインでない。③ の SQL はまだ流さないでください）$/.test(m)), logs.join(' | '));
});

test('after the SQL: without a PIN sign-in the public key cannot write Tip Rate or prep (kept unsent); with a PIN sign-in the GM writes through the function; everyone still reads them', async () => {
  const W = world({ rlsTp: true });
  const np = tab(W, 'nopin'); vm.runInContext("curRole='gm';", np);
  assert.deepEqual(await push(np, K, [OLD, approve(P1)]), [false]);
  assert.deepEqual(W.get(K), TIP0);
  const gm = tab(W, 'tGM');
  assert.deepEqual(await push(gm, K, [OLD, approve(P1)]), [true]);
  assert.deepEqual(writesOf(W, K), ['service']);
  const one = tab(W, 't1');
  assert.deepEqual(await one._fetchOpValue(K), [OLD, approve(P1)], 'read by REST');
  assert.deepEqual(await one._fetchOpValue('prep_certs'), CERTS0, 'read by REST');
});

test('the approval center: only GM/CEO approve a prep certification (as the server); the reject rule is unchanged', async () => {
  for (const [role, ok] of [['gm', true], ['ceo', true], ['am', false], ['office', false]]) {
    const c = tab(world(), 'tGM');
    vm.runInContext('curRole=' + JSON.stringify(role) + ';', c);
    const r = await c.pmCheckForApproval({ ref: 'cX' }, 'approved', {});
    assert.equal(r, null);
    if (ok) assert.ok(c.__toasts.some(m => /認定の申請が見つからない/.test(m)), role + ' goes on to the checks: ' + c.__toasts.join(' | '));
    else assert.ok(c.__toasts.some(m => m === 'プレップ認定を承認できるのは GM・CEO です（何も変えていません）'), role + ': ' + c.__toasts.join(' | '));
    const c2 = tab(world(), 'tGM'); vm.runInContext('curRole=' + JSON.stringify(role) + ';', c2);
    const r2 = await c2.pmCheckForApproval({ ref: 'cX' }, 'rejected', {});
    if (ok) assert.deepEqual(r2 && r2.id, 'cX'); else assert.equal(r2, null);
  }
});
