// v1143（2b-5）のアプリ側：GM・CEO だけが変える賞与・Career Score の設定 8 つ（スコア基準・係数・係数の幅・G3 の職種・4 項目の設定・個人設定・強みの決まり・評価基準と例）を、
// REST（公開の鍵）ではなく関数 secure-state で書く（読むのは REST のまま）。アプリの本物の送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssCall・ssPutRow・swNote）と
// 本物の合流（mergeMapByTime・kevMergeMap）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 前の版の関数は、入れる一式の v1142 の 1 ファイル。合成データだけ（架空の人と店。本番に接続しない）。
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
// 8 つの合流の決まりはアプリの本物（OP_MERGE の行。cas も）
const DEFS = Object.fromEntries(['mileage_config', 'career_cfg', ...SW2_KEYS].map(k => {
  if (k === 'mileage_config') return [k, 'null'];
  const m = source.match(new RegExp('^  ' + k + ':\\s+(\\{[^}\\n]*\\})', 'm')); assert.ok(m, k + ' def'); return [k, m[1]];
}));

// 前の版の関数（v1142）：入れる一式の 1 ファイル（Deno の起動の行を外して読む）
const v1142Src = readFileSync(new URL('../deploy/secure-hr-v1142/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1142-'));
writeFileSync(join(tmp, 'handler.mjs'), v1142Src);
const { createHandler: createHandler1142 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

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
   function csIsKey(k){ return false; } function csOnLogout(){}
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
const T0 = '2026-11-03T09:00:00.000000+00:00';
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
  W.ssHandler = (o.old ? createHandler1142 : createHandler)({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 8, 10, 0, 0) });
  for (const k of SW2_KEYS) W.set(k, V0[k], T0);
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

test('the app routes the eight settings to the function for writing, but reads six of them by REST (v1148: the bonus personal settings and G3 track through the function)', () => {
  const c = tab(world(), 'tGM');
  for (const k of SW2_KEYS) {
    assert.equal(c.swIsKey(k), true, k); assert.equal(c.sw2IsKey(k), true, k);
    assert.equal(c.swRouted(k), true, k + ' is written through the function');
    assert.equal(c.ssRouted(k), ['bonus_eval_ovr', 'bonus_track'].includes(k), k + (['bonus_eval_ovr', 'bonus_track'].includes(k) ? ' is read through the function (v1148)' : ' is still read by REST'));
    assert.ok(c._opMergeDef(k).cas, k + ' writes only when the row read is unchanged (cas)');
  }
  for (const k of ['grade_hist', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_pool_extra', 'karte_bonus_config', 'tasks_all', 'cs_criteria ', 'Cs_guide', null])
    assert.equal(c.sw2IsKey(k), false, String(k));
  assert.equal(c.sw2IsKey('mileage_config'), false, 'the v1141 keys are not in the v1143 list');
  assert.equal(tab(world(), 'nopin').swRouted('cs_guide'), false, 'no PIN sign-in: REST as before');
});

test('GM and CEO write each of the eight settings through the function (server key); the device records it as written by the decided role', async () => {
  for (const who of ['tGM', 'tCEO']) {
    const W = world();
    const c = tab(W, who);
    for (const k of SW2_KEYS) {
      assert.deepEqual(await push(c, k, more(k)), [true], who + ' ' + k);
      assert.deepEqual(norm(W.get(k)), more(k), who + ' ' + k);
      assert.deepEqual(writesOf(W, k), ['service'], who + ' ' + k + ': written by the function with the server key');
      assert.deepEqual({ how: c._swLast[k].how, by: c._swLast[k].by }, { how: 'fn', by: USER[who] }, who + ' ' + k);
    }
    assert.equal(c.__toasts.length + c.__alerts.length, 0, who + ': no warning');
  }
  // 「設定 › 診断と記録」に残す文（手順の B-5 で見る）
  const logs = [];
  const c = tab(world(), 'tGM'); c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, 'cs_strength_rule', more('cs_strength_rule'));
  assert.ok(logs.some(m => m === '強みの決まり：サーバー（secure-state v1143）が書きました（役割 GM）'), logs.join(' | '));
  vm.runInContext('function t(ja, en){ return en; }', c); logs.length = 0;
  await push(c, 'cs_guide', more('cs_guide', 2));
  assert.ok(logs.some(m => /^Evaluation guide: written by the server \(secure-state v1143, role GM\)$/.test(m)), logs.join(' | '));
});

test('Accounting, AM, G4 and crew: a changed setting is refused (403), the cloud row stays and the device says only GM/CEO; resending what the cloud has passes without a write', async () => {
  const W = world();
  for (const who of ['tOF', 'tAM', 't4', 't1']) {
    const c = tab(W, who);
    for (const k of SW2_KEYS) {
      assert.deepEqual(await push(c, k, more(k, 7)), [false], who + ' ' + k);
      assert.deepEqual(W.get(k), V0[k], who + ' ' + k + ': unchanged');
    }
    assert.ok(c.__toasts.some(m => /賞与・Career Score の設定.*を変えられるのは GM・CEO です/.test(m)), who + ': ' + c.__toasts.join(' | '));
    const d = tab(W, who);
    for (const k of SW2_KEYS) {
      // v1148：賞与の個人設定・G3 の職種は、端末が受け取る値（Career Score で見られる人と本人の分）が「クラウドにあるもの」
      const gb = ['bonus_eval_ovr', 'bonus_track'].includes(k);
      const same = gb ? (await d._fetchOpRow(k)).value : V0[k];
      assert.deepEqual(await push(d, k, same), [true], who + ' ' + k + ': the same value is not stuck');
      assert.equal(d._swLast[k].how, 'none', who + ' ' + k + ': the cloud already has it, so the app does not even ask the server');
      if (k === 'cs_guide') { const logs = []; d.FUNERGY_STATUS = { log: (x, m) => logs.push(m) }; await push(d, k, V0[k]); assert.deepEqual(logs, ['評価基準・例：クラウドにもう入っているので書きませんでした（新しい変更なし）']); delete d.FUNERGY_STATUS; }
      // 端末の写しが古い（クラウドのほうが新しい）ときも止まらない
      const old = JSON.parse(JSON.stringify(same)); for (const r of Object.values(old)) if (r && typeof r === 'object') r._at -= 1000;
      assert.deepEqual(await push(d, k, old), [true], who + ' ' + k + ': an older copy is not stuck');
      // 前に REST で受け取った全員の分を送り直すと、全部を読めない人は断られる（同じ値でも 403＝中身を当てる道にしない）
      if (gb && JSON.stringify(same) !== JSON.stringify(V0[k])) assert.deepEqual(await push(tab(W, who), k, V0[k]), [false], who + ' ' + k + ': a full copy from before v1148 is refused');
    }
  }
  for (const k of SW2_KEYS) assert.deepEqual(writesOf(W, k), [], k + ': nothing written');
});

test('the function is still v1142 (no sw2): the app writes the eight settings by REST as before (before the SQL); the v1141 two still go through the function', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  assert.deepEqual(await push(c, 'cs_criteria', more('cs_criteria')), [true]);
  assert.deepEqual(W.get('cs_criteria'), more('cs_criteria'));
  assert.deepEqual(writesOf(W, 'cs_criteria'), ['anon'], 'REST with the public key');
  assert.ok(c._ss.sw2Old, 'remembered for 10 minutes'); assert.equal(c._ss.swOld, null, 'the v1142 function knows the v1141 keys');
  assert.equal(c._swLast.cs_criteria.how, 'rest');
  const n0 = W.calls.ss;
  assert.deepEqual(await push(c, 'bonus_coef', more('bonus_coef')), [true]);
  assert.equal(W.calls.ss, n0, 'within the 10 minutes the app goes straight to REST');
  assert.deepEqual(writesOf(W, 'bonus_coef'), ['anon']);
  // v1141 の 2 つは前の版の関数（v1142）でも関数で書く
  assert.equal(c.swRouted('mileage_config'), true);
  c.__pushed.length = 0; c.setMileageConfig({ gmapsKey: '', ratePerMile: 0.8, roundTripDefault: true });
  assert.deepEqual(await Promise.all(c.__pushed), [true]);
  assert.deepEqual(writesOf(W, 'mileage_config'), ['service']);
  // REST の文は v1143
  const logs = []; c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, 'bonus_track', more('bonus_track'));
  assert.ok(logs.some(m => /^G3 の職種：公開の鍵（REST）で書きました（関数が v1143 でない・PIN のログインでない。③ の SQL はまだ流さないでください）$/.test(m)), logs.join(' | '));
});

test('after the SQL: without a PIN sign-in the public key cannot write (kept unsent); with a PIN sign-in the GM writes through the function', async () => {
  const W = world({ rlsSw: true });
  const np = tab(W, 'nopin'); vm.runInContext("curRole='gm';", np);
  assert.deepEqual(await push(np, 'bonus_eval_rule', more('bonus_eval_rule')), [false]);
  assert.deepEqual(W.get('bonus_eval_rule'), V0.bonus_eval_rule);
  const gm = tab(W, 'tGM');
  assert.deepEqual(await push(gm, 'bonus_eval_rule', more('bonus_eval_rule')), [true]);
  assert.deepEqual(norm(W.get('bonus_eval_rule')), more('bonus_eval_rule'));
  assert.deepEqual(writesOf(W, 'bonus_eval_rule'), ['service']);
  // 読むのは今までどおり（だれでも REST で）
  const one = tab(W, 't1');
  assert.deepEqual(norm(await one._fetchOpValue('bonus_eval_rule')), more('bonus_eval_rule'));
  // ほかのキーは今までどおり REST
  assert.deepEqual(await push(one, 'tasks_all', { a: { t: 2 } }), [true]);
  assert.deepEqual(writesOf(W, 'tasks_all'), ['anon']);
});

test('cas: GM and CEO save different score criteria at the same time — both report success and both stay', async () => {
  const W = world();
  const gm = tab(W, 'tGM'), ceo = tab(W, 'tCEO');
  const A = { cats: { B: { m: 'pct', v: 70 } }, _at: 1762700000000 };
  const B = { cats: { C: { m: 'pct', v: 75 } }, _at: 1762700000001 };
  const r = await Promise.all([gm.opMergePush('cs_criteria', { ...V0.cs_criteria, 'G3|ops': A }), ceo.opMergePush('cs_criteria', { ...V0.cs_criteria, G4: B })]);
  assert.deepEqual(r, [true, true]);
  assert.deepEqual(W.get('cs_criteria'), { ...V0.cs_criteria, 'G3|ops': A, G4: B });
  assert.ok(writesOf(W, 'cs_criteria').every(x => x === 'service'));
});

test('cas with the real kevMergeMap: GM and CEO change different parts of one person\'s bonus settings at the same time — both parts stay; the history keeps both', async () => {
  const W = world();
  const gm = tab(W, 'tGM'), ceo = tab(W, 'tCEO');
  const base = V0.bonus_eval_ovr['E-1|2026-Q3'];
  const a = { ...base, set: { ...base.set, c: 0 }, at: '2026-11-08 09:00', by: 'Gina M', why: 'x', _at: 1762700000000, _t: { ...base._t, c: 1762700000000 } };
  const b = { ...base, set: { ...base.set, s: 1 }, at: '2026-11-08 09:01', by: 'Cal E', why: 'y', _at: 1762700000001, _t: { ...base._t, s: 1762700000001 } };
  const r = await Promise.all([gm.opMergePush('bonus_eval_ovr', { 'E-1|2026-Q3': a }), ceo.opMergePush('bonus_eval_ovr', { 'E-1|2026-Q3': b })]);
  assert.deepEqual(r, [true, true]);
  const fin = W.get('bonus_eval_ovr')['E-1|2026-Q3'];
  assert.deepEqual(fin.set, { c: 0, s: 1 }, 'both parts stay');
  assert.ok(Array.isArray(fin.hist) && fin.hist.length >= 1, 'the earlier save is in the history');
  assert.ok(writesOf(W, 'bonus_eval_ovr').every(x => x === 'service'));
});

test('cas: the CEO read the old strength rule, the GM saved a newer one, then the CEO saved: the newer GM rule is not overwritten by the older read', async () => {
  const W = world();
  const gm = tab(W, 'tGM');
  let hold = null, held = false;
  const ceo = tab(W, 'tCEO');
  ceo.fetch = async (u, o) => {
    const res = await W.fetch(u, o);
    if (!held && String(u).includes('/rest/v1/app_state?key=eq.cs_guide') && (!o || !o.method || o.method === 'GET')) { held = true; await new Promise(r => { hold = r; }); }
    return res;
  };
  const mine = { ...V0.cs_guide, 'H2@ja': { v: { what: 'ceo' }, _at: 1762700000000 } };
  const p = ceo.opMergePush('cs_guide', mine);
  for (let i = 0; i < 50 && !hold; i++) await new Promise(r => setTimeout(r, 1));
  assert.ok(hold, 'the CEO read the row');
  const gmv = { ...V0.cs_guide, 'H1@ja': { v: { what: 'gm-new' }, _at: 1762700000005 } };
  assert.equal(await gm.opMergePush('cs_guide', gmv), true);
  hold();
  assert.equal(await p, true);
  const fin = W.get('cs_guide');
  assert.deepEqual(fin['H1@ja'].v, { what: 'gm-new' }, 'the GM change stays');
  assert.deepEqual(fin['H2@ja'].v, { what: 'ceo' }, 'the CEO change is in too');
});

test('a bad shape is refused (400) with a message; an odd record already in the cloud does not block a GM save', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  assert.equal(await c.opMergePush('bonus_coef', { ...V0.bonus_coef, x: 'odd' }), false);
  assert.ok(c.__toasts.some(m => /賞与・Career Score の設定をサーバーが断りました/.test(m)), c.__toasts.join(' | '));
  assert.deepEqual(W.get('bonus_coef'), V0.bonus_coef);
  W.set('bonus_coef', { ...V0.bonus_coef, x: 1 }, T0);
  const next = { ...V0.bonus_coef, 'g:G4': { v: 1.05, _at: 1762700000000 } };
  assert.equal(await c.opMergePush('bonus_coef', next), true);
  assert.deepEqual(W.get('bonus_coef'), { ...next, x: 1 }, 'the odd record stays as it was');
});
