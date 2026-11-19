// v1192（Codex 6986713362 の P2-1）のアプリ側：「ダッシュボードで全店を見る AM」の写し（md_all_viewers_gm）を、REST（公開の鍵）ではなく関数 secure-state で書く
// （読むのは REST のまま）。書いてよいのは GM・CEO。アプリの本物の送信（syncMasterToSupabase・opMergePush・_opCasWrite・ssCall・ssPutRow・swNote）と
// 本物の合流（mergeMapByTime・OP_MERGE の md_all_viewers_gm の行）を vm で動かし、本物の関数（handler）と合成のクラウドにつなぐ。
// 前の版の関数（ltfn:1 が無い）は、入れる一式の v1144 の 1 ファイル。土台は tests/secure-grade-hist-client.test.mjs と同じ。合成データだけ（本番に接続しない）。
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
const DEFS = Object.fromEntries(['mileage_config', 'career_cfg', ...SW2_KEYS, 'grade_hist', 'md_all_viewers_gm'].map(k => {
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

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  varLine(/^var _OP_READ_TMO = .*$/m),
  ...['supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite', '_opUpsertRow', 'opMergePush', 'syncMasterToSupabase', 'supaHeaders'].map(fn),
  ...['getMileageConfig', 'setMileageConfig', '_recAt', 'kevN', 'kevV1Has', '_kevPT'].map(oneLine),
  varLine(/^var KEV_EV_META = .*$/m),
  ...['mergeMapByTime', '_coversMapByTime', 'kevMergeEvRec', 'kevMergeVerRec', 'kevMergeMap', 'kevCoversMap'].map(fn),
  // PR #197 の Codex P2-2：この端末で変えた人だけを送る（印・合流・確かめ・送れたら印を消す）と、本物の付け外し
  varLine(/^var MDAV_DIRTY_KEY = .*$/m),
  ...['mdavDirty', 'mdavDirtySave', 'mdavMark', '_mdavMap'].map(oneLine),
  ...['_mdavPending', 'mdavMerge', 'mdavCovers', 'mdavSent', 'mdAllViewers', 'mdSetAllViewer'].map(fn),
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
   function _actorName(){ return 'Gina M'; } function nowJP(){ return '2026/11/18 10:00'; }
   var document={ getElementById:function(){ return null; } };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  tCEO: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  tOF: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  tAM: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const USER = { tGM: 'gm', tCEO: 'ceo', tOF: 'office', tAM: 'am', t1: 'crew' };
const T0 = '2026-11-18T09:00:00.000000+00:00';
const KEY = 'md_all_viewers_gm';
const LV0 = { 'E-AM2': { on: true, name: 'Other Am', by: 'Gina M', at: '2026/11/01 10:00', _at: 1763000000000 } };
const lvMore = (id, on, at) => ({ ...LV0, [id]: { on, name: 'X ' + id, by: 'Gina M', at: '2026/11/18 10:00', _at: at || 1763400000000 } });

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr: {}, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.ssHandler = (o.old ? createHandler1144 : createHandler)({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 18, 10, 0, 0) });
  W.set(KEY, LV0, T0);
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
// この端末で変えた人（LV0 と違う記録）に印を付けてから送る（本物の付け外し mdSetAllViewer と同じ。送るのは印のある記録だけ）
const push = async (c, k, v) => {
  c.__pushed.length = 0;
  if (k === KEY) for (const id of Object.keys(v || {})) if (JSON.stringify(v[id]) !== JSON.stringify(LV0[id])) assert.equal(c.mdavMark(id, v[id]._at), true);
  c.lsSet(k, v); return Promise.all(c.__pushed);
};

test('the app routes the copy to the function for writing (its own ltfn marker) and keeps reading it by REST; it writes only when the row read is unchanged (cas)', () => {
  const c = tab(world(), 'tGM');
  assert.equal(c.lvIsKey(KEY), true); assert.equal(c.swIsKey(KEY), true); assert.equal(c.ghIsKey(KEY), false); assert.equal(c.sw2IsKey(KEY), false);
  assert.equal(c.swRouted(KEY), true, 'written through the function');
  assert.equal(c.ssRouted(KEY), false, 'read by REST as before (everyone needs it for the dashboard)');
  assert.ok(c._opMergeDef(KEY).cas, 'cas');
  for (const k of ['md_all_viewers', KEY + ' ', 'Md_all_viewers_gm', KEY + '_x', 'grade_hist', null]) assert.equal(c.lvIsKey(k), false, String(k));
  assert.equal(c.swRouted('md_all_viewers'), false, 'md_all_viewers itself stays a plain setting');
  assert.equal(tab(world(), 'nopin').swRouted(KEY), false, 'no PIN sign-in: REST as before');
});

test('GM and CEO write the copy through the function (server key); the device records "secure-state v1192 wrote it (role GM)"', async () => {
  for (const who of ['tGM', 'tCEO']) {
    const W = world();
    const c = tab(W, who);
    assert.deepEqual(await push(c, KEY, lvMore('E-AM', true)), [true], who);
    assert.deepEqual(W.get(KEY), lvMore('E-AM', true), who);
    assert.deepEqual(writesOf(W, KEY), ['service'], who + ': the server key');
    assert.deepEqual({ how: c._swLast[KEY].how, by: c._swLast[KEY].by }, { how: 'fn', by: USER[who] }, who);
    assert.equal(c.__toasts.length + c.__alerts.length, 0, who + ': no warning');
  }
  const logs = [];
  const c = tab(world(), 'tGM'); c.FUNERGY_STATUS = { log: (k, m) => logs.push(m) };
  await push(c, KEY, lvMore('E-AM', true));
  assert.ok(logs.some(m => m === 'ダッシュボードで全店を見る人：サーバー（secure-state v1192）が書きました（役割 GM）'), logs.join(' | '));
});

test('an AM adding her own row, Accounting and crew: refused (403), the cloud copy stays and the device says only GM/CEO; the same value passes without a write', async () => {
  const W = world();
  for (const who of ['tAM', 'tOF', 't1']) {
    const c = tab(W, who);
    assert.deepEqual(await push(c, KEY, lvMore('E-AM', true)), [false], who);
    assert.deepEqual(W.get(KEY), LV0, who + ': unchanged');
    assert.ok(c.__toasts.some(m => m.startsWith('ダッシュボードで全店を見る人を決められるのは GM・CEO です（サーバーが断りました。')), who + ': ' + c.__toasts.join(' | '));
    const d = tab(W, who);
    const same = (await d._fetchOpRow(KEY)).value;
    assert.deepEqual(same, LV0, 'the copy is readable');
    assert.deepEqual(await push(d, KEY, same), [true], who + ': the same value is not stuck');
  }
  assert.deepEqual(writesOf(W, KEY), [], 'nothing written');
});

test('cas: GM and CEO turn on different people at the same time — both succeed and both stay', async () => {
  const W = world();
  const g = tab(W, 'tGM'), e = tab(W, 'tCEO');
  const [a, b] = await Promise.all([push(g, KEY, lvMore('E-AM', true, 1763400000001)), push(e, KEY, { ...LV0, 'E-AM3': { on: true, name: 'Y', _at: 1763400000002 } })]);
  assert.deepEqual([a, b], [[true], [true]]);
  const v = W.get(KEY);
  assert.equal(v['E-AM'].on, true); assert.equal(v['E-AM3'].on, true); assert.equal(v['E-AM2'].on, true);
});

test('the function is still before v1192 (no ltfn): the app writes the copy by REST as before (before the SQL); remembered for 10 minutes', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  assert.deepEqual(await push(c, KEY, lvMore('E-AM', true)), [true]);
  assert.deepEqual(W.get(KEY), lvMore('E-AM', true));
  assert.deepEqual(writesOf(W, KEY), ['anon'], 'REST with the public key');
  assert.ok(c._ss.lvOld, 'remembered');
  assert.equal(c._swLast[KEY].how, 'rest');
  const n0 = W.calls.ss;
  assert.deepEqual(await push(c, KEY, lvMore('E-AM', false, 1763400000009)), [true]);
  assert.equal(W.calls.ss, n0, 'within the 10 minutes the app goes straight to REST');
  // 関数が v1192 になると、次の答えで印が消える
  const W2 = world();
  const c2 = tab(W2, 'tGM'); c2._ss.lvOld = { id: 'x', at: Date.now() };
  assert.deepEqual(await push(c2, KEY, lvMore('E-AM', true)), [true]);
  assert.deepEqual(writesOf(W2, KEY), ['service']);
});

// ---- PR #197 の Codex 6996221251 の P2-2：捨てた・外した許可が古い端末の写しから戻らない ----
const STALE = { 'E-AM': { on: true, name: 'Amy Area', by: 'someone', at: '2026/11/10 10:00', _at: 99 } };
const settle = async c => { await Promise.all(c.__pushed); c.__pushed.length = 0; };

test('Codex P2-2: the cloud copy was emptied (1b) but a GM device still holds an old grant; turning on someone else does not bring the old grant back', async () => {
  const W = world(); W.set(KEY, {}, T0);
  const c = tab(W, 'tGM');
  c.MEM.set(KEY, JSON.stringify(STALE));   // 前に読んだ古い写し（印なし）
  c.__pushed.length = 0;
  assert.equal(c.mdSetAllViewer('E-AM2', 'Other Am', true), true);
  await settle(c);
  const v = W.get(KEY);
  assert.deepEqual(Object.keys(v), ['E-AM2'], 'only the person changed on this device');
  assert.equal(v['E-AM2'].on, true);
  assert.deepEqual(writesOf(W, KEY), ['service']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.mdavDirty())), {}, 'the mark is gone once the cloud has it');
  // 前の合流（端末の写しを丸ごと）なら、古い許可が戻っていた（直す前の再現）
  assert.equal(c.mergeMapByTime({}, JSON.parse(c.MEM.get(KEY)))['E-AM'].on, true);
});

test('Codex P2-2: reading the copy keeps only this device\'s unsent changes; old grants on the device are dropped', () => {
  const c = tab(world(), 'tGM');
  const local = { ...STALE, 'E-AM2': { on: true, name: 'Other Am', _at: 1763400000005 } };
  assert.equal(c.mdavMark('E-AM2', 1763400000005), true);
  const got = JSON.parse(JSON.stringify(c.mdavMerge({}, local)));
  assert.deepEqual(Object.keys(got), ['E-AM2'], 'the unsent change stays, the old grant is dropped');
  assert.deepEqual(JSON.parse(JSON.stringify(c.mdavMerge({ 'E-AM3': { on: true, _at: 5 } }, STALE))), { 'E-AM3': { on: true, _at: 5 } }, 'no mark: the cloud copy as it is');
  // ほかの端末があとで同じ人を変えていたら、クラウドの新しい記録
  const newer = { 'E-AM2': { on: false, name: 'Other Am', _at: 1763400000009 } };
  assert.deepEqual(JSON.parse(JSON.stringify(c.mdavMerge(newer, local))), newer);
  // 印の時刻と端末の記録の時刻が違う（その後に取り込んだ）なら、印は使わない
  assert.deepEqual(JSON.parse(JSON.stringify(c.mdavMerge({}, { 'E-AM2': { on: true, _at: 7 } }))), {});
  // 確かめ：印のある記録がクラウドにあれば済み。印の無い古い記録は見ない
  assert.equal(c.mdavCovers({}, STALE), true);
  assert.equal(c.mdavCovers({}, local), false);
  assert.equal(c.mdavCovers({ 'E-AM2': { on: true, _at: 1763400000005 } }, local), true);
});

test('Codex P2-2: a device holding only an old grant does not write at all; a change that could not be sent is sent later, and once sent it does not come back after another emptying', async () => {
  const W = world(); W.set(KEY, {}, T0);
  const c = tab(W, 'tGM');
  assert.deepEqual(await (async () => { c.__pushed.length = 0; c.lsSet(KEY, STALE); return Promise.all(c.__pushed); })(), [true], 'nothing to send: done');
  assert.deepEqual(writesOf(W, KEY), [], 'no write');
  assert.deepEqual(W.get(KEY), {}, 'the old grant did not come back');
  // AM の端末が送ろうとして断られた変更は、印が残ったまま（GM の端末の写しには関係しない）
  const a = tab(W, 'tAM');
  a.__pushed.length = 0;
  a.MEM.set(KEY, JSON.stringify({}));
  assert.equal(a.mdavMark('E-AM', 1763400000100), true);
  a.lsSet(KEY, { 'E-AM': { on: true, name: 'Amy Area', _at: 1763400000100 } });
  assert.deepEqual(await Promise.all(a.__pushed), [false]);
  assert.deepEqual(W.get(KEY), {}, 'refused');
  assert.ok(a.mdavDirty()['E-AM'], 'the mark stays while it is not sent');
  // GM が付けて送れたあと、もう一度空にされても（SQL 1b など）、GM の端末から戻らない
  c.__pushed.length = 0;
  assert.equal(c.mdSetAllViewer('E-AM2', 'Other Am', true), true);
  await settle(c);
  assert.equal(W.get(KEY)['E-AM2'].on, true);
  W.set(KEY, {}, '2026-11-18T09:30:00.000000+00:00');
  c.__pushed.length = 0; c.lsSet(KEY, JSON.parse(c.MEM.get(KEY)));
  assert.deepEqual(await Promise.all(c.__pushed), [true]);
  assert.deepEqual(W.get(KEY), {}, 'a sent change is not sent again');
});


test('Codex P2-2: a device that cannot keep the mark (storage refused) does not save the change and says so — no "saved" that never reaches the cloud', async () => {
  const W = world(); W.set(KEY, {}, T0);
  const c = tab(W, 'tGM');
  c.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  c.__pushed.length = 0;
  assert.equal(c.mdSetAllViewer('E-AM2', 'Other Am', true), false, 'not saved');
  await settle(c);
  assert.deepEqual(writesOf(W, KEY), [], 'no write');
  assert.deepEqual(W.get(KEY), {}, 'the cloud copy is unchanged');
  assert.ok(c.__toasts.some(m => /印を残せません/.test(m)), 'the device says it could not keep the mark');
  assert.equal(c.MEM.has(KEY) ? JSON.parse(c.MEM.get(KEY))['E-AM2'] : undefined, undefined, 'this device does not show it as ON either');
});
