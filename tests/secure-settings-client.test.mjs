// v1141（2b の 3 つ目）のアプリ側：ガソリン代の単価（mileage_config）と Score管理（career_cfg）を、REST（公開の鍵）ではなく
// 関数 secure-state で書く（読むのは REST のまま）。アプリの本物の送信（syncMasterToSupabase・opMergePush・supaUpsert・ssCall・ssPutRow）と
// ガソリン代の設定の画面（canManageMileage・saveMileageConfigDo）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 前の版の関数は、入れる一式の v1140 の 1 ファイル。合成データだけ（架空の人と店。本番に接続しない）。
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
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = source.slice(i + 1, source.indexOf('\n', i + 1)); assert.ok(l.trimEnd().endsWith('}'), name); return l; };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
// Score管理の合流の決まりはアプリの本物（OP_MERGE の行。cas も：Codex #135 の P1）
const CG_DEF = (() => { const m = source.match(/^  career_cfg:\s+(\{[^}\n]*\})/m); assert.ok(m, 'career_cfg def'); return m[1]; })();

// 前の版の関数（v1140）：入れる一式の 1 ファイル（Deno の起動の行を外して読む）
const v1140Src = readFileSync(new URL('../deploy/secure-cs-v1140/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1140-'));
writeFileSync(join(tmp, 'handler.mjs'), v1140Src);
const { createHandler: createHandler1140 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite', '_opUpsertRow', 'opMergePush', 'syncMasterToSupabase', 'supaHeaders', 'saveMileageConfigDo'].map(fn),
  ...['getMileageConfig', 'setMileageConfig', 'canManageMileage', '_recAt'].map(oneLine),
  ...['mergeMapByTime', '_coversMapByTime'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, __pending={}, __alerts=[], __toasts=[], __pushed=[];
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function ls(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   /* アプリの lsSet と同じ：端末に置いてから送る（送った結果を __pushed に） */
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); __pushed.push(syncMasterToSupabase(k, v)); return true; }
   function lsKeys(){ return [...MEM.keys()]; }
   function _lsCloudPending(k){ return !!__pending[k]; }
   function _opWriteBack(){} function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   function csIsKey(k){ return false; } function csOnLogout(){}
   /* Score管理の合流はアプリの本物（mergeMapByTime・_coversMapByTime。独立レビュー P3-6） */
   var __CG_DEF=${CG_DEF};
   function _opMergeDef(k){ return k==='career_cfg' ? __CG_DEF : null; }
   function _outboxRemove(){}
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function showToast(m){ __toasts.push(m); } function alert(m){ __alerts.push(m); } function closeModalDirect(){} function renderPage(){}
   function canManageVacations(){ return true; }   /* 前は G4 以上・店のログインも設定を開けた（v1141 で使わない） */
   var document={ getElementById:function(id){ return __els[id] || null; } }, __els={};`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
// PIN のログインの印 → work-requests の whoami の答え（役割はサーバーが決める：manager_auth の人は ceo・gm・office・office_crew）
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tCEO: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  tOF: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  tOC: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  t4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  tStore: 'deny',
};
const USER = { tGM: 'gm', tCEO: 'ceo', tOF: 'office', tOC: 'office_crew', tAM: 'am', t4: 'g4', t1: 'crew', tStore: 'sl' };
const T0 = '2026-11-03T09:00:00.000000+00:00';
const MI0 = { gmapsKey: '', ratePerMile: 0.7, roundTripDefault: true };
const CG0 = { '経理|G4': { role: '', hide: [], csView: null, csEdit: null, csApprove: ['am'], _at: 5 } };

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: {}, rlsSw: !!o.rlsSw, ...o });
  let clock = Date.UTC(2026, 10, 4, 10, 0, 0);
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = (o.old ? createHandler1140 : createHandler)({ env, fetch: W.fetch, now: () => clock });
  W.set('mileage_config', MI0, T0);
  W.set('career_cfg', CG0, T0);
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
    vm.runInContext('curRole=' + JSON.stringify(USER[who] || 'gm') + '; curRealRole=curRole; curStoreLogin=' + (who === 'tStore' ? '{ id:"S1" }' : 'null') + ';', c);
  }
  return c;
}
const saveMileage = async (c, rate, key = '', rt = true) => {
  c.__els = { 'mi-key': { value: key }, 'mi-rate': { value: String(rate) }, 'mi-rtdef': { checked: rt } };
  vm.runInContext('__els=' + JSON.stringify(c.__els) + ';', c);
  c.__pushed.length = 0;
  c.saveMileageConfigDo();
  return Promise.all(c.__pushed);
};
const writesOf = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('who may open the mileage settings: CEO, GM and Accounting only (not G4, AM, office crew or the store tablet)', () => {
  const W = world();
  for (const [who, want] of [['tGM', true], ['tCEO', true], ['tOF', true], ['tOC', false], ['tAM', false], ['t4', false], ['t1', false], ['tStore', false]]) {
    assert.equal(tab(W, who).canManageMileage(), want, who);
  }
  // 店のタブレットは、役割が経理の名前でも開けない（共有の端末）
  const c = tab(W, 'tStore'); vm.runInContext("curRole='office';", c);
  assert.equal(c.canManageMileage(), false);
});

test('CEO, GM and Accounting save the mileage rate through the function (service key), not REST', async () => {
  for (const who of ['tGM', 'tCEO', 'tOF']) {
    const W = world();
    const c = tab(W, who);
    const r = await saveMileage(c, 0.725, 'AIza-test');
    assert.deepEqual(r, [true], who);
    assert.deepEqual(W.get('mileage_config'), { gmapsKey: 'AIza-test', ratePerMile: 0.725, roundTripDefault: true }, who);
    assert.deepEqual(writesOf(W, 'mileage_config'), ['service'], who + ': written by the function with the server key');
    assert.ok(W.calls.ss >= 1);
    assert.equal(c.__alerts.length, 0, who + ': no alert');
  }
});

test('the screen refuses a rate the server cannot use (negative, over $5) and a role that may not change it', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  for (const bad of ['-1', '5.01', '9', '0.009', '0.000001']) {   // 0.01 より小さいと短い距離が 0 セント（独立レビュー P3-1）
    c.__alerts.length = 0;
    await saveMileage(c, bad);
    assert.equal(c.__alerts.length, 1, bad); assert.match(c.__alerts[0], /\$0\.01〜\$5\.00/);
  }
  assert.deepEqual(W.get('mileage_config'), MI0, 'nothing sent');
  assert.equal(writesOf(W, 'mileage_config').length, 0);
  const g4 = tab(W, 't4');
  await saveMileage(g4, 0.9);
  assert.match(g4.__alerts[0], /CEO・GM・経理/);
  assert.equal(W.get('mileage_config').ratePerMile, 0.7, 'a G4 cannot change it from the screen');
});

test('a device that still has a change it may not make: the server refuses (403), the row stays, the change stays unsent with a warning', async () => {
  const W = world();
  const c = tab(W, 't4');
  c.__pushed.length = 0;
  c.setMileageConfig({ gmapsKey: '', ratePerMile: 3, roundTripDefault: false });   // 前の版の画面で直した値が残っていた端末など
  assert.deepEqual(await Promise.all(c.__pushed), [false]);
  assert.deepEqual(W.get('mileage_config'), MI0, 'the cloud row is unchanged');
  assert.equal(writesOf(W, 'mileage_config').length, 0);
  assert.ok(c.__toasts.some(m => /CEO・GM・経理/.test(m)), 'the device says who can change it');
  // 同じ値なら、だれが送っても止まらない（一括の送り直しなど）
  const c2 = tab(W, 't1');
  c2.__pushed.length = 0; c2.setMileageConfig(MI0);
  assert.deepEqual(await Promise.all(c2.__pushed), [true]);
  assert.equal(writesOf(W, 'mileage_config').length, 0, 'nothing written');
});

test('Score settings (career_cfg): GM and CEO merge and write through the function; Accounting, AM and G4 are refused', async () => {
  const W = world();
  const gm = tab(W, 'tGM');
  const next = { ...CG0, '調理|G4': { role: 'chef', hide: [], csView: ['g4'], csEdit: null, csApprove: null, _at: 9 } };
  assert.equal(await gm.opMergePush('career_cfg', next), true);
  assert.deepEqual(W.get('career_cfg'), next);
  assert.deepEqual(writesOf(W, 'career_cfg'), ['service']);
  for (const who of ['tOF', 'tAM', 't4']) {
    const c = tab(W, who);
    const mine = { ...next, '経理|G4': { ...CG0['経理|G4'], csApprove: [who], _at: 99 } };
    assert.equal(await c.opMergePush('career_cfg', mine), false, who);
    assert.ok(c.__toasts.some(m => /Score管理の設定を変えられるのは GM・CEO/.test(m)), who);
  }
  assert.deepEqual(W.get('career_cfg'), next, 'only the GM change is in');
  assert.deepEqual(writesOf(W, 'career_cfg'), ['service']);
});

test('the function is still v1140 (no swfn): the app writes these two keys by REST as before (before the SQL)', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  assert.deepEqual(await saveMileage(c, 0.8), [true]);
  assert.equal(W.get('mileage_config').ratePerMile, 0.8);
  assert.deepEqual(writesOf(W, 'mileage_config'), ['anon'], 'REST with the public key');
  assert.ok(c._ss.swOld, 'remembered for 10 minutes');
  const n0 = W.calls.ss;
  assert.deepEqual(await saveMileage(c, 0.81), [true]);
  assert.equal(W.calls.ss, n0, 'within the 10 minutes the app goes straight to REST (no extra call to the old function)');
  assert.deepEqual(writesOf(W, 'mileage_config'), ['anon', 'anon']);
  // 前の版の関数は知らないキーを断るだけで、何も書かない（書いたのは REST の 2 回だけ）
  assert.equal(W.log.filter(x => x[0] === 'write').length, 2);
});

test('no PIN session (PIN still the default, or an old device): REST as before — refused by the database after the SQL, kept unsent', async () => {
  const W = world();
  const c = tab(W, 'nopin');
  vm.runInContext("curRole='gm';", c);
  assert.deepEqual(await saveMileage(c, 0.9), [true], 'before the SQL the public key can still write');
  assert.deepEqual(writesOf(W, 'mileage_config'), ['anon']);
  const W2 = world({ rlsSw: true });
  const c2 = tab(W2, 'nopin');
  vm.runInContext("curRole='gm';", c2);
  assert.deepEqual(await saveMileage(c2, 0.9), [false], 'after the SQL the public key cannot write');
  assert.deepEqual(W2.get('mileage_config'), MI0);
  // 1141 の端末で PIN のログインなら、SQL のあとも書ける（関数はサーバーの鍵）
  const c3 = tab(W2, 'tOF');
  assert.deepEqual(await saveMileage(c3, 0.9), [true]);
  assert.equal(W2.get('mileage_config').ratePerMile, 0.9);
  assert.deepEqual(writesOf(W2, 'mileage_config'), ['service']);
});

test('reading is unchanged: the two keys are not read through the function, and other keys still go by REST', async () => {
  const W = world({ rlsSw: true });
  const c = tab(W, 't1');
  assert.equal(c.swRouted('mileage_config'), true); assert.equal(c.ssRouted('mileage_config'), false, 'reads stay on REST');
  assert.deepEqual(await c._fetchOpValue('career_cfg'), CG0, 'anyone can still read the Score settings');
  assert.equal(W.calls.ss, 0, 'no function call for a read');
  c.__pushed.length = 0; c.lsSet('tasks_all', { a: { t: 2 } });
  assert.deepEqual(await Promise.all(c.__pushed), [true]);
  assert.deepEqual(writesOf(W, 'tasks_all'), ['anon'], 'other keys: REST as before');
  assert.equal(c.swIsKey('mileage_requests'), false); assert.equal(c.swIsKey('career_cfg'), true); assert.equal(c.swIsKey(null), false);
});

test('v1141 review: when the server refuses the shape (400), the device says what is wrong and keeps the change unsent', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  c.__pushed.length = 0;
  c.setMileageConfig({ gmapsKey: '', ratePerMile: 0.004, roundTripDefault: true });   // 前の版の画面で入れた値など（画面は 0.01 未満を断る）
  assert.deepEqual(await Promise.all(c.__pushed), [false]);
  assert.ok(c.__toasts.some(m => /ガソリン代の設定をサーバーが断りました（単価は \$0\.01〜\$5\.00/.test(m)), c.__toasts.join(' | '));
  assert.deepEqual(W.get('mileage_config'), MI0);
  // Score管理：クラウドにもうある形の合わない記録は GM の保存を止めない（本物の合流で、クラウドの記録も一緒に送る）
  W.set('career_cfg', { ...CG0, x: 1 }, T0);
  const next = { ...CG0, '調理|G4': { role: 'chef', hide: [], csView: ['g4'], csEdit: null, csApprove: null, _at: 9 } };
  assert.equal(await c.opMergePush('career_cfg', next), true);
  assert.deepEqual(W.get('career_cfg'), { ...next, x: 1 }, 'the odd record stays as it was');
  // 新しく形の合わない記録を入れようとすると断られ、何が悪いかを出す
  assert.equal(await c.opMergePush('career_cfg', { ...next, y: 'odd' }), false);
  assert.ok(c.__toasts.some(m => /Score管理の設定をサーバーが断りました/.test(m)));
  assert.deepEqual(W.get('career_cfg'), { ...next, x: 1 });
});

test('Codex #135 P2: blank, 0 or a non-number is not saved and the current rate stays (no silent $0.70)', async () => {
  const W = world();
  W.set('mileage_config', { ...MI0, ratePerMile: 1.25 }, T0);
  const c = tab(W, 'tGM');
  for (const bad of ['', '0', '  ', 'abc', '1.2abc', '0.00']) {
    c.__alerts.length = 0;
    const r = await saveMileage(c, bad);
    assert.deepEqual(r, [], JSON.stringify(bad) + ': nothing sent');
    assert.equal(c.__alerts.length, 1, JSON.stringify(bad)); assert.match(c.__alerts[0], /空・0 は保存しません。今の単価はそのままです/);
  }
  assert.equal(W.get('mileage_config').ratePerMile, 1.25);
  assert.equal(writesOf(W, 'mileage_config').length, 0);
  // 英語の画面の文
  vm.runInContext("function t(ja, en){ return en; }", c); c.__alerts.length = 0;
  await saveMileage(c, '');
  assert.match(c.__alerts[0], /blank or 0 is not saved; the current rate stays/);
  // ふつうの値は保存できる
  assert.deepEqual(await saveMileage(c, '0.85'), [true]);
  assert.equal(W.get('mileage_config').ratePerMile, 0.85);
});

test('Codex #135 P1: GM and CEO save different Score settings at the same time: both report success and both changes stay', async () => {
  const W = world();
  const gm = tab(W, 'tGM'), ceo = tab(W, 'tCEO');
  const A = { role: 'chef', hide: [], csView: ['g4'], csEdit: null, csApprove: null, _at: 9 };
  const B = { role: '', hide: ['karte'], csView: null, csEdit: ['am'], csApprove: null, _at: 10 };
  const r = await Promise.all([gm.opMergePush('career_cfg', { ...CG0, '調理|G4': A }), ceo.opMergePush('career_cfg', { ...CG0, 'サービス|G4': B })]);
  assert.deepEqual(r, [true, true]);
  assert.deepEqual(W.get('career_cfg'), { ...CG0, '調理|G4': A, 'サービス|G4': B }, 'both changes stay');
  assert.ok(writesOf(W, 'career_cfg').every(x => x === 'service'));
});

test('Codex #135 P1: the CEO read the old settings, then the GM revoked an approval right, then the CEO saved another item: the revocation stays', async () => {
  const W = world();
  const gm = tab(W, 'tGM');
  let hold = null, held = false;
  const ceo = tab(W, 'tCEO');
  // CEO の端末：Score管理の行を読んだあと（書く前）に止める
  ceo.fetch = async (u, o) => {
    const res = await W.fetch(u, o);
    if (!held && String(u).includes('/rest/v1/app_state?key=eq.career_cfg') && (!o || !o.method || o.method === 'GET')) { held = true; await new Promise(r => { hold = r; }); }
    return res;
  };
  const revoked = { ...CG0['経理|G4'], csApprove: [], _at: 6 };
  const B = { role: '', hide: ['karte'], csView: null, csEdit: ['am'], csApprove: null, _at: 10 };
  const p = ceo.opMergePush('career_cfg', { ...CG0, 'サービス|G4': B });   // CEO の写しの '経理|G4' は古いまま（AM が承認する）
  for (let i = 0; i < 50 && !hold; i++) await new Promise(r => setTimeout(r, 1));
  assert.ok(hold, 'the CEO read the row');
  assert.equal(await gm.opMergePush('career_cfg', { ...CG0, '経理|G4': revoked }), true);
  hold();
  assert.equal(await p, true);
  const fin = W.get('career_cfg');
  assert.deepEqual(fin['経理|G4'].csApprove, [], 'the AM is not put back');
  assert.deepEqual(fin['サービス|G4'], B, 'the CEO change is in too');
});

test('Codex #135 P1: a device that may not change the Score settings and resends the same value is not stuck (nothing written)', async () => {
  const W = world();
  const c = tab(W, 't1');
  assert.equal(await c.opMergePush('career_cfg', CG0), true);
  assert.equal(writesOf(W, 'career_cfg').length, 0);
  assert.equal(c._swLast.career_cfg.how, 'same');
});

test('Codex #135 P2 (step B-5): the device records which way the setting was written — the function as the decided role, not written, or REST', async () => {
  const W = world();
  const gm = tab(W, 'tGM');
  await saveMileage(gm, '0.7');
  assert.deepEqual({ how: gm._swLast.mileage_config.how, by: gm._swLast.mileage_config.by }, { how: 'fn', by: 'gm' }, 'v1141 wrote it as the GM');
  const one = tab(W, 't1');
  one.__pushed.length = 0; one.setMileageConfig(W.get('mileage_config'));
  assert.deepEqual(await Promise.all(one.__pushed), [true], 'the same value from a crew device passes (as before)');
  assert.equal(one._swLast.mileage_config.how, 'same', 'but it is recorded as not written');
  const W2 = world({ old: true });
  const g2 = tab(W2, 'tGM');
  await saveMileage(g2, '0.7');
  assert.equal(g2._swLast.mileage_config.how, 'rest', 'the function is v1140: REST');
  const np = tab(W, 'nopin'); vm.runInContext("curRole='gm';", np);
  await saveMileage(np, '0.7');
  assert.equal(np._swLast.mileage_config.how, 'rest', 'no PIN sign-in: REST');
  // 「設定 › 診断と記録」に残す文
  const logs = [];
  const c = tab(world(), 'tOF'); c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await saveMileage(c, '0.7');
  assert.ok(logs.some(m => /ガソリン代の設定：サーバー（secure-state v1141）が書きました（役割 経理）/.test(m)), logs.join(' | '));
});
