// v1145（2b-7）のアプリ側：グレード履歴（grade_hist）を、REST（公開の鍵）ではなく関数 secure-state で書く（読むのは REST のまま）。
// 書いてよいのは GM・CEO（Moto さん 11/10）。アプリの本物の送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssCall・ssPutRow・swNote）と
// 本物の合流（mergeMapByTime・OP_MERGE の grade_hist の行）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 前の版の関数は、入れる一式の v1144 の 1 ファイル（sw2:1 はあるが ghfn:1 は無い）と v1142 の 1 ファイル。合成データだけ（架空の人と店。本番に接続しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = source.slice(i + 1, source.indexOf('\n', i + 1)); assert.ok(l.trimEnd().endsWith('}'), name); return l; };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
// 合流の決まりはアプリの本物（OP_MERGE の行。cas も）
const DEFS = Object.fromEntries(['mileage_config', 'career_cfg', ...SW2_KEYS, 'grade_hist'].map(k => {
  if (k === 'mileage_config') return [k, 'null'];
  const m = source.match(new RegExp('^  ' + k + ':\\s+(\\{[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return [k, m[1]];
}));

// 前の版の関数（v1144・v1142）：入れる一式の 1 ファイル（Deno の起動の行を外して読む）
async function oldHandler(path, tag) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
  const tmp = mkdtempSync(join(tmpdir(), tag));
  writeFileSync(join(tmp, 'handler.mjs'), s);
  return (await import(pathToFileURL(join(tmp, 'handler.mjs')).href)).createHandler;
}
const createHandler1144 = await oldHandler('deploy/secure-pii-v1144/2_関数_secure-state_index.ts', 'ss1144-');
const createHandler1142 = await oldHandler('deploy/secure-hr-v1142/2_関数_secure-state_index.ts', 'ss1142-');

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite', '_opUpsertRow', 'opMergePush', 'syncMasterToSupabase', 'supaHeaders'].map(fn),
  ...['getMileageConfig', 'setMileageConfig', '_recAt', 'kevN', 'kevV1Has', '_kevPT'].map(oneLine),
  varLine(/^var KEV_EV_META = .*$/m),
  ...['mergeMapByTime', '_coversMapByTime', 'kevMergeEvRec', 'kevMergeVerRec', 'kevMergeMap', 'kevCoversMap'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, __pending={}, __alerts=[], __toasts=[], __pushed=[];
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
   function _opMergeDef(k){ return __DEFS[k] || null; }
   function _outboxRemove(){}
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function showToast(m){ __toasts.push(m); } function alert(m){ __alerts.push(m); } function closeModalDirect(){} function renderPage(){}
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
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const USER = { tGM: 'gm', tCEO: 'ceo', tOF: 'office', tAM: 'am', t4: 'g4', t1: 'crew' };
const T0 = '2026-11-09T09:00:00.000000+00:00';
const GH0 = {
  'E-1': { recs: [{ id: 'gh1', d: '2026-04-01', g: 'G1', from: '', start: true, src: 'hire', by: 'Gina M', at: '2026/04/01 10:00', note: '' }], name: 'Kai One', _at: 1762500000000 },
  'E-4': { recs: [{ id: 'gh2', d: '2026-06-30', g: 'G4', from: 'G3', start: false, src: 'title', by: 'Gina M', at: '2026/06/30 10:00', note: '' }], name: 'Leo Four', _at: 1762500000001 },
};
const ghMore = (id, at) => ({ ...GH0, [id]: { recs: [{ id: 'n-' + id, d: '2026-11-08', g: 'G2', from: 'G1', start: false, src: 'title', by: 'Gina M', at: '2026/11/08 10:00', note: '' }], name: 'X ' + id, _at: at || 1762700000000 } });
const V0 = {
  cs_criteria: { G2: { cats: { A: { m: 'pct', v: 60 } }, _at: 1762500000000 } },
  bonus_coef: { 'g:G3': { v: 1, _at: 1762500000000 } },
  bonus_coef_rng: { 'g:G3': { lo: 0.85, hi: 1.15, _at: 1762500000000 } },
  bonus_track: { '2026-Q3|E-1': { t: 'ops', _at: 1762500000000 } },
  bonus_eval_rule: { '_common|2026-Q3': { set: { c: 1 }, at: '2026-11-03 09:00', by: 'Gina M', _at: 1762500000000, _t: { c: 1762500000000 } } },
  bonus_eval_ovr: { 'E-1|2026-Q3': { set: { c: 1, s: 0 }, at: '2026-11-03 09:00', by: 'Gina M', _at: 1762500000000, _t: { c: 1762500000000, s: 1762500000000 } } },
  cs_strength_rule: { rule: { minItems: 3, top: 3, _at: 1762500000000 } },
  cs_guide: { 'H1@ja': { v: { what: 'x' }, _at: 1762500000000 } },
};
// 1 つ足した値（記録 1 件を新しい時刻で）
const more = (k, i = 1, at = 1762600000000 + i) => ({ ...V0[k], ['n' + i]: k === 'cs_strength_rule' ? { minItems: 2 + i, top: 3, _at: at } : { v: i, _at: at } });

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: {}, rlsSw: !!o.rlsSw, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = ({ 1144: createHandler1144, 1142: createHandler1142 }[o.old] || createHandler)({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 9, 10, 0, 0) });
  for (const k of SW2_KEYS) W.set(k, V0[k], T0);
  W.set('grade_hist', GH0, T0);
  W.set('mileage_config', { gmapsKey: '', ratePerMile: 0.7, roundTripDefault: true }, T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
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
// 4 項目の設定・個人設定は、合流で空の変更の履歴（hist: []）が付く（アプリの本物の kevMergeMap。中身は同じ）
const norm = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'hist' && Array.isArray(x) && !x.length) ? undefined : x));
const push = async (c, k, v) => { c.__pushed.length = 0; c.lsSet(k, v); return Promise.all(c.__pushed); };

test('the app routes the grade history to the function for writing (its own ghfn marker), but reads it by REST; it writes only when the row read is unchanged (cas)', () => {
  const c = tab(world(), 'tGM');
  assert.equal(c.ghIsKey('grade_hist'), true); assert.equal(c.swIsKey('grade_hist'), true); assert.equal(c.sw2IsKey('grade_hist'), false);
  assert.equal(c.swRouted('grade_hist'), true, 'written through the function');
  assert.equal(c.ssRouted('grade_hist'), false, 'still read by REST');
  assert.ok(c._opMergeDef('grade_hist').cas, 'cas');
  for (const k of ['grade_hist ', 'Grade_hist', 'grade_hist_x', 'growth_karte', 'cs_guide', 'tasks_all', null]) assert.equal(c.ghIsKey(k), false, String(k));
  for (const k of SW2_KEYS) assert.equal(c.swRouted(k), true, k + ' (v1143) unchanged');
  assert.equal(tab(world(), 'nopin').swRouted('grade_hist'), false, 'no PIN sign-in: REST as before');
});

test('GM and CEO write the grade history through the function (server key); the device records "secure-state v1145 wrote it (role GM)"', async () => {
  for (const who of ['tGM', 'tCEO']) {
    const W = world();
    const c = tab(W, who);
    assert.deepEqual(await push(c, 'grade_hist', ghMore('E-9')), [true], who);
    assert.deepEqual(W.get('grade_hist'), ghMore('E-9'), who);
    assert.deepEqual(writesOf(W, 'grade_hist'), ['service'], who + ': the server key');
    assert.deepEqual({ how: c._swLast.grade_hist.how, by: c._swLast.grade_hist.by }, { how: 'fn', by: USER[who] }, who);
    assert.equal(c.__toasts.length + c.__alerts.length, 0, who + ': no warning');
  }
  const logs = [];
  const c = tab(world(), 'tGM'); c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, 'grade_hist', ghMore('E-9'));
  assert.ok(logs.some(m => m === 'グレード履歴：サーバー（secure-state v1145）が書きました（役割 GM）'), logs.join(' | '));
  vm.runInContext('function t(ja, en){ return en; }', c); logs.length = 0;
  await push(c, 'grade_hist', ghMore('E-8', 1762700000009));
  assert.ok(logs.some(m => /^Grade history: written by the server \(secure-state v1145, role GM\)$/.test(m)), logs.join(' | '));
});

test('Accounting, AM, G4 and crew: a changed grade history is refused (403), the cloud row stays and the device says only GM/CEO; what the cloud has, or an older copy, passes without a write', async () => {
  const W = world();
  for (const who of ['tOF', 'tAM', 't4', 't1']) {
    const c = tab(W, who);
    assert.deepEqual(await push(c, 'grade_hist', ghMore('E-9')), [false], who);
    assert.deepEqual(W.get('grade_hist'), GH0, who + ': unchanged');
    assert.ok(c.__toasts.some(m => m === 'グレード履歴を変えられるのは GM・CEO です（サーバーが断りました。送信待ちに残しています）'), who + ': ' + c.__toasts.join(' | '));
    const d = tab(W, who);
    assert.deepEqual(await push(d, 'grade_hist', GH0), [true], who + ': the same value is not stuck');
    assert.equal(d._swLast.grade_hist.how, 'none', who + ': the cloud already has it');
    const old = JSON.parse(JSON.stringify(GH0)); for (const r of Object.values(old)) r._at -= 1000;
    assert.deepEqual(await push(d, 'grade_hist', old), [true], who + ': an older copy is not stuck');
  }
  assert.deepEqual(writesOf(W, 'grade_hist'), [], 'nothing written');
});

for (const old of [1144, 1142]) {
  test(`the function is still v${old} (no ghfn): the app writes the grade history by REST as before (before the SQL)${old === 1144 ? '; the v1143 eight still go through the function' : ''}`, async () => {
    const W = world({ old });
    const c = tab(W, 'tGM');
    assert.deepEqual(await push(c, 'grade_hist', ghMore('E-9')), [true]);
    assert.deepEqual(W.get('grade_hist'), ghMore('E-9'));
    assert.deepEqual(writesOf(W, 'grade_hist'), ['anon'], 'REST with the public key');
    assert.ok(c._ss.ghOld, 'remembered for 10 minutes');
    assert.equal(c._swLast.grade_hist.how, 'rest');
    const n0 = W.calls.ss;
    assert.deepEqual(await push(c, 'grade_hist', ghMore('E-8', 1762700000009)), [true]);
    assert.equal(W.calls.ss, n0, 'within the 10 minutes the app goes straight to REST');
    if (old === 1144) {
      assert.equal(c._ss.sw2Old, null, 'the v1144 function knows the v1143 eight');
      assert.deepEqual(await push(c, 'cs_guide', more('cs_guide')), [true]);
      assert.deepEqual(writesOf(W, 'cs_guide'), ['service'], 'the v1143 eight through the function');
    }
    const logs = []; c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
    await push(c, 'grade_hist', ghMore('E-7', 1762700000019));
    assert.ok(logs.some(m => /^グレード履歴：公開の鍵（REST）で書きました（関数が v1145 でない・PIN のログインでない。③ の SQL はまだ流さないでください）$/.test(m)), logs.join(' | '));
  });
}

test('after the SQL: without a PIN sign-in the public key cannot write the grade history (kept unsent); with a PIN sign-in the GM writes through the function; everyone still reads it', async () => {
  const W = world({ rlsSw: true });   // rlsSw：今の版の SQL（swIsKey のキーは公開の鍵で書けない＝グレード履歴も）
  const np = tab(W, 'nopin'); vm.runInContext("curRole='gm';", np);
  assert.deepEqual(await push(np, 'grade_hist', ghMore('E-9')), [false]);
  assert.deepEqual(W.get('grade_hist'), GH0);
  const gm = tab(W, 'tGM');
  assert.deepEqual(await push(gm, 'grade_hist', ghMore('E-9')), [true]);
  assert.deepEqual(W.get('grade_hist'), ghMore('E-9'));
  assert.deepEqual(writesOf(W, 'grade_hist'), ['service']);
  const one = tab(W, 't1');
  assert.deepEqual(await one._fetchOpValue('grade_hist'), ghMore('E-9'), 'read by REST');
});

test('cas: GM and CEO save different people\'s grade history at the same time — both succeed and both stay', async () => {
  const W = world();
  const gm = tab(W, 'tGM'), ceo = tab(W, 'tCEO');
  const A = ghMore('E-9', 1762700000000)['E-9'], B = ghMore('E-8', 1762700000001)['E-8'];
  const r = await Promise.all([gm.opMergePush('grade_hist', { ...GH0, 'E-9': A }), ceo.opMergePush('grade_hist', { ...GH0, 'E-8': B })]);
  assert.deepEqual(r, [true, true]);
  assert.deepEqual(W.get('grade_hist'), { ...GH0, 'E-9': A, 'E-8': B });
  assert.ok(writesOf(W, 'grade_hist').every(x => x === 'service'));
});

test('a bad shape is refused (400) with a message; an odd record already in the cloud does not block a GM save', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  assert.equal(await c.opMergePush('grade_hist', { ...GH0, odd: 'x' }), false);
  assert.ok(c.__toasts.some(m => /グレード履歴をサーバーが断りました/.test(m)), c.__toasts.join(' | '));
  assert.deepEqual(W.get('grade_hist'), GH0);
  W.set('grade_hist', { ...GH0, odd: 1 }, T0);
  const next = ghMore('E-9');
  assert.equal(await c.opMergePush('grade_hist', next), true);
  assert.deepEqual(W.get('grade_hist'), { ...next, odd: 1 }, 'the odd record stays as it was');
});
