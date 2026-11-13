// v1152（段階 2b の最後）のアプリ側：通知（notifications）を、REST（公開の鍵）ではなく関数 secure-state の nt で読み書きする。
// アプリの本物の関数（ntMode・ntPull・ntPush・ntReceive・ntMigrate・ntOnLogout・addNotif・markNotifRead・notifForMe・ssCall・
// syncMasterToSupabase・_kvPullRows・_applyKvRows・ssOnLogout）を vm で動かし、本物の関数（handler）と合成のクラウド（tests/lib/secure-state-world.mjs）につなぐ。
// 前の版の関数は、入れる一式の v1151 の 1 ファイル（clfn:1 はあるが ntfn:1 は無い）。合成データだけ（架空の人と店。本番に接続しない）。
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
const oneLine = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n', i + 1)); };
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
const NT_DEF = (() => { const m = source.match(/^  notifications:\s+(\{.*\} \}),?$/m); assert.ok(m, 'notifications def'); return m[1]; })();

async function oldHandler(path, tag) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\n\/\/ ---- 起動[^\n]*\nDeno\.serve\([^\n]*\n?$/, '\n').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
  const tmp = mkdtempSync(join(tmpdir(), tag));
  writeFileSync(join(tmp, 'handler.mjs'), s);
  return (await import(pathToFileURL(join(tmp, 'handler.mjs')).href)).createHandler;
}
const createHandler1151 = await oldHandler('deploy/change-signal-v1151/2_関数_secure-state_index.ts', 'ss1151-');

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaUpsert', '_supaWriteMs', '_fetchOpValue', '_fetchOpRow', '_tsMicro', '_casTs', '_opCasWrite',
    '_opUpsertRow', 'opMergePush', 'pullOpKey', 'syncMasterToSupabase', 'supaHeaders', '_lsRequestDeferredPrefix', 'outboxLabel',
    'mergeNotifs', '_coversNotifs', 'addNotif', 'notifForMe', 'markNotifRead', 'markAllNotifRead', 'ackNotif', 'notifPullNow', 'onNotifIncoming',
    'notifRealtimeStart', 'notifOnVisible', 'notifRealtimeStop', '_opWriteBack',
    '_userSupportsStore', '_amManagesStore', '_roleMatch', 'isStoreManager', 'mergeMapByTime', '_coversMapByTime'].map(fn),
  ...['getNotifs', 'myNotifs', 'myUnreadCount', 'notifRetired'].map(oneLine),
  block('/* ============================================================\n   v1152（段階 2b の最後）：通知', '/* ===== 承認ルーティング'),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=['spl_lss_history_'], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null, _lsDeferReq={};
   var curRole='', curRealRole='', curUserName='', curStoreLogin=null, curStore='', curLang='ja', __pending={}, __fetched={}, __alerts=[], __toasts=[], __rerender=0, __failed=[], __pushed=[], __bell=0;
   var MEM=new Map(), _rtClient=null, _rtChannel=null, _notifPollTimer=null;
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); __pushed.push(syncMasterToSupabase(k, v)); return true; }
   function _pushWithOutbox(k, v){ __pushed.push(syncMasterToSupabase(k, v)); }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(k){ __failed.push(k); }
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(k){ return k.indexOf('spl_lss_history_')===0; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _lsSetVerified(k, j){ return _lsWriteVerified(k, j); } function _lsFreeOldLaborKeys(){} function _lsRerenderSoon(){ __rerender++; }
   function _opCloudVal(k, v){ return v; } function isOpSyncKey(k){ return true; }
   function renderNotifBell(){ __bell++; } function renderNotifPanel(){}
   var __DEFS={ notifications: ${NT_DEF} };
   function _opMergeDef(k){ return __DEFS[k] || null; }
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
   var _pushQ={}, __mine=[]; function _saveWho(){ return curUserName||''; } function _outboxMine(){ return __mine; } function _pushBusy(k){ return false; }
   function invInSession(){ return window._authSession || null; } async function invInSessionRefresh(){ return null; }
   function karteRerender(){ __rerender++; } function showToast(m){ __toasts.push(m); } function alert(m){ __alerts.push(m); }
   function t(ja, en){ return ja; }
   var ROLE_CONFIG={ sl:{ name:'店' } };
   var __EMPS=[]; function getEmployees(){ return __EMPS; }
   var STORES=[{ id:'S1', name:'店 1', am:'Area' }, { id:'S2', name:'店 2', am:'' }];
   var document={ getElementById:function(){ return null; }, addEventListener:function(){}, removeEventListener:function(){}, hidden:false };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-SL', name: 'Sally', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-1', name: 'Crew 1', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-2', name: 'Crew 2', store: 'S2', role: 'crew', title: 'Crew' },
];
const ME = {
  tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina', confirmed: true },
  tSL: { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sally', confirmed: true },
  t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Crew 1', confirmed: false },
  t2: { emp: 'E-2', role: 'staff', grade: 1, stores: ['S2'], am_stores: [], name: 'Crew 2', confirmed: false },
  tStore: 'deny',
};
const USER = { tGM: ['gm', 'Gina', 'HQ'], tSL: ['sl', 'Sally', 'S1'], t1: ['crew', 'Crew 1', 'S1'], t2: ['crew', 'Crew 2', 'S2'], tStore: ['sl', '店 1', 'S1'] };
const WRP = [{ emp_id: 'E-SL', role: 'staff', grade: 3, stores: ['S1'] }];
const T0 = '2026-11-12T09:00:00.000000+00:00';
const N = (id, o) => ({ id, at: '2026-11-12T0' + (id.length % 9) + ':00:00.000Z', by: 'X', readBy: [], ackBy: [], type: 't', title: 'T ' + id, ...o });
const SEED = [
  N('off-s1', { toStore: 'S1', toRoles: ['office', 'gm', 'ceo', 'am', 'sl', 'sm'], title: '退職手続き開始：〇〇', text: '一身上の都合' }),
  N('shift-s1', { toStore: 'S1', toRoles: ['crew', 'sl'] }),
  N('shift-s2', { toStore: 'S2', toRoles: ['crew', 'sl'] }),
  N('u-crew1', { toUser: 'Crew 1', title: '特別育成に指名されました' }),
  N('r-gm', { toRoles: ['gm'] }),
];

function world(o = {}) {
  const W = makeWorld({ pins: JSON.parse(JSON.stringify(ME)), emps: EMPS.map(e => ({ ...e })), wrPeople: WRP.map(x => ({ ...x })), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  W.fresh = (old) => { W.ssHandler = (old ? createHandler1151 : createHandler)({ env, fetch: (u, x) => W.fetch(u, x), now: () => Date.UTC(2026, 10, 13, 10, 0, 0) }); };
  W.fresh(o.old);
  W.set('notifications', SEED, T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
  return W;
}
function tab(W, who) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error, parseFloat, isFinite,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  c.__EMPS.push(...EMPS);
  if (who) login(c, who);
  return c;
}
function login(c, who, noPin) {
  c._hwSession = noPin ? null : who;
  vm.runInContext('curRole=' + JSON.stringify(USER[who][0]) + '; curRealRole=curRole; curUserName=' + JSON.stringify(USER[who][1]) + '; curStore=' + JSON.stringify(USER[who][2])
    + '; curStoreLogin=' + (who === 'tStore' ? '{ id:"S1" }' : 'null') + ';', c);
}
const logout = c => { c.ssOnLogout(); c._hwSession = null; vm.runInContext('curRole=null; curRealRole=null; curUserName=null; curStoreLogin=false;', c); };
const local = c => { const v = c.MEM.get('notifications'); return v == null ? undefined : JSON.parse(v); };
const ids = arr => (arr || []).map(n => n.id).sort();
const settle = async c => { for (let i = 0; i < 5; i++) { const p = c.__pushed.splice(0); if (!p.length) break; await Promise.all(p); } };
const fillRest = c => c.MEM.set('notifications', JSON.stringify(SEED));   // v1151 までの端末（REST で全部の通知を持っている）
// 関数に届かない（通信の失敗）。関数が無い（404）・PIN を確かめられない（503）は「前の版」とみなして今までどおり REST に戻る（別の試験）
const netDown = (c, W, on) => { c.fetch = on ? (u, o) => (String(u).includes('/functions/v1/secure-state') ? Promise.reject(new TypeError('fetch failed')) : W.fetch(u, o)) : (u, o) => W.fetch(u, o); };
const cloud = W => W.get('notifications');

test('the mode: a PIN sign-in reads through the function; the store tablet and people without a PIN mark only add; GM・CEO without a PIN mark stay as before', () => {
  const W = world();
  assert.equal(tab(W, 'tGM').ntMode(), 'fn');
  assert.equal(tab(W, 't1').ntMode(), 'fn');
  assert.equal(tab(W, 'tStore').ntMode(), 'add', 'the store tablet does not show notifications (Moto 11/12)');
  const c = tab(W); login(c, 't1', true);
  assert.equal(c.ntMode(), 'add', 'a staff member without a PIN mark (initial PIN)');
  const g = tab(W); login(g, 'tGM', true);
  assert.equal(g.ntMode(), 'rest', 'GM・CEO without a PIN mark: as before (like the other secure keys)');
});

test('a device that had all notifications (v1151) keeps only what is addressed to the person after the first read; nothing comes through the public key', async () => {
  const W = world();
  const c = tab(W, 't1');
  fillRest(c);
  await c.ntPull();
  assert.deepEqual(ids(local(c)), ['shift-s1', 'u-crew1'], 'the GM-only and other-store notifications (incl. the resignation reason) are gone from the device');
  assert.ok(local(c).every(n => n._s === 1));
  assert.deepEqual(ids(c.myNotifs()), ['shift-s1', 'u-crew1']);
  // REST の取り込みでは通知を取らない（関数の答えの写しをそのまま）
  const reads0 = W.reads.length;
  const rows = await c._kvPullRows(true);
  c._applyKvRows(rows, []);
  assert.ok(!W.reads.slice(reads0).some(q => q.includes('notifications') && !q.includes('not.in')), 'no REST read of the notifications row');
  assert.deepEqual(ids(local(c)), ['shift-s1', 'u-crew1']);
  assert.ok(!(rows || []).some(r => r && r.key === 'notifications'));
});

test('adding and marking read go through the function: the sender is the checked person; the device and the cloud agree; nothing is sent twice', async () => {
  const W = world();
  const gm = tab(W, 'tGM'), crew = tab(W, 't1');
  await gm.ntPull(); await crew.ntPull();
  gm.addNotif({ type: 'shift', title: 'シフト変更が承認されました', text: '11/20', toUser: 'Crew 1', page: 'shift_staff', refId: 'sc1' });
  await settle(gm);
  const added = cloud(W).find(n => n.refId === 'sc1');
  assert.ok(added, 'in the cloud');
  assert.equal(added.by, 'Gina');
  assert.equal(local(gm).find(n => n.refId === 'sc1')._s, 1, 'the device knows it is in the cloud (not sent again)');
  const patches = W.calls.patch;
  gm.lsSet('notifications', local(gm)); await settle(gm);
  assert.equal(W.calls.patch, patches, 'nothing new to send: no write');
  // スタッフの端末：読む → 既読を付ける
  await crew.ntPull();
  assert.ok(ids(crew.myNotifs()).includes(added.id));
  assert.equal(crew.myUnreadCount(), 3);
  crew.markNotifRead(added.id); await settle(crew);
  assert.deepEqual(cloud(W).find(n => n.id === added.id).readBy, ['Crew 1']);
  assert.equal(local(crew).find(n => n.id === added.id)._sr, 1);
  crew.markAllNotifRead(); await settle(crew);
  assert.deepEqual(cloud(W).filter(n => (n.readBy || []).includes('Crew 1')).map(n => n.id).sort(), [added.id, 'shift-s1', 'u-crew1'].sort());
  assert.equal(crew.myUnreadCount(), 0);
  // GM の端末から、ほかの人の既読を消すことはできない（端末の写しに無い名前は送らない・関数も付けない）
  await gm.ntPull();
  assert.ok(!local(gm).some(n => n.id === 'u-crew1'), 'the GM device never had the crew’s personal notice');
});

test('an unsent mark survives a read that started before it (no going back); a failed send stays pending and is sent later', async () => {
  const W = world();
  const crew = tab(W, 't1');
  await crew.ntPull();
  // 既読を付ける（送るのは失敗）
  netDown(crew, W, true);
  crew.markNotifRead('shift-s1'); await settle(crew);
  assert.deepEqual(cloud(W).find(n => n.id === 'shift-s1').readBy, [], 'not sent (the function did not answer)');
  assert.equal(crew.ntMode(), 'fn', 'a network failure does not switch to REST');
  netDown(crew, W, false);
  await crew.ntPull();
  assert.ok(local(crew).find(n => n.id === 'shift-s1').readBy.includes('Crew 1'), 'the read (cloud without the mark) does not take the unsent mark away');
  await settle(crew);
  assert.deepEqual(cloud(W).find(n => n.id === 'shift-s1').readBy, ['Crew 1'], 'the next read sends the pending mark');
  assert.ok(local(crew).find(n => n.id === 'shift-s1').readBy.includes('Crew 1'));
  // 足した通知も、送れなければ端末に残り、あとで送る
  netDown(crew, W, true);
  crew.addNotif({ type: 'consult', title: '相談', toRoles: ['gm'], refId: 'c1' });
  await settle(crew);
  assert.ok(!cloud(W).some(n => n.refId === 'c1'));
  const pend = local(crew).find(n => n.refId === 'c1');
  assert.ok(pend && !pend._s && pend._w === 'Crew 1');
  netDown(crew, W, false);
  assert.equal(await crew.ntPush(), true);
  assert.ok(cloud(W).some(n => n.refId === 'c1' && n.by === 'Crew 1'));
  assert.ok(!local(crew).some(n => n.refId === 'c1' && !n._s), 'sent: no longer pending');
});

test('the store tablet: adds without reading; keeps no notifications of others on the device', async () => {
  const W = world();
  const tb = tab(W, 'tStore');
  fillRest(tb);
  tb.ntMigrate();
  assert.deepEqual(local(tb), [], 'the notifications of others are removed from the shared tablet');
  tb.addNotif({ type: 'shift', title: 'シフトが公開されました', toStore: 'S1', toRoles: ['crew', 'sl'], refId: 'pub1' });
  await settle(tb);
  const a = cloud(W).find(n => n.refId === 'pub1');
  assert.ok(a, 'the tablet’s notice reaches the cloud');
  assert.deepEqual([a.by, a._u], ['店 1', 1]);
  assert.deepEqual(local(tb), [], 'nothing is kept or read back on the tablet');
  assert.equal(await tb.ntPull(), null, 'the tablet does not read');
  assert.equal(tb.myNotifs().length, 0);
  assert.match(tb.ntHintHtml(), /タブレットでは通知を出しません/);
  // スタッフには届く
  const crew = tab(W, 't1'); await crew.ntPull();
  assert.ok(crew.myNotifs().some(n => n.refId === 'pub1'));
});

test('logout: what came from the cloud is not left for the next person; a notice the first person could not send is not sent as the next person', async () => {
  const W = world();
  const c = tab(W, 'tGM');
  await c.ntPull();
  assert.ok(local(c).some(n => n.id === 'off-s1'));
  netDown(c, W, true);
  c.addNotif({ type: 'approval', title: '承認待ち', toRoles: ['office'], refId: 'gm-unsent' });
  await settle(c);
  logout(c);
  assert.deepEqual(local(c).map(n => n.refId), ['gm-unsent'], 'only the unsent notice of the first person remains');
  netDown(c, W, false);
  login(c, 't2');
  await c.ntPull();
  await c.ntPush();
  assert.ok(!cloud(W).some(n => n.refId === 'gm-unsent'), 'not sent under the second person');
  assert.deepEqual(ids(c.myNotifs()), ['shift-s2']);
  logout(c); login(c, 'tGM');
  assert.equal(await c.ntPush(), true);
  assert.ok(cloud(W).some(n => n.refId === 'gm-unsent' && n.by === 'Gina'), 'sent when the first person logs in again');
});

test('a function of the previous version (v1151, no ntfn): notifications go by REST as before for 10 minutes', async () => {
  const W = world({ old: true });
  const c = tab(W, 'tGM');
  assert.equal(c.ntMode(), 'fn');
  await c.notifPullNow();
  assert.equal(c.ntMode(), 'rest', 'learned that the function is older');
  assert.deepEqual(ids(local(c)), ids(SEED), 'read by REST as before');
  c.addNotif({ type: 't', title: 'old way', toRoles: ['gm'], refId: 'ow1' });
  await settle(c);
  assert.ok(cloud(W).some(n => n.refId === 'ow1'), 'written by REST as before (merged)');
  assert.equal(cloud(W).length, SEED.length + 1);
  assert.equal(c.localStorage.getItem('_nt_mig_v1152'), null, 'back on the REST road: the device copy is fixed again when the function road returns');
  // 関数を v1152 に入れ直す → 10 分たったら関数の道に戻り、写しを v1152 の形に直す（REST で取った分を「足した」として送り直さない）
  W.fresh(false); c._nt.old = null;
  const posts = W.calls.patch + W.calls.post;
  await c.ntPull();
  assert.equal(W.calls.patch + W.calls.post, posts, 'nothing is sent again');
  assert.ok(local(c).every(n => n._s === 1));
  assert.ok(!local(c).some(n => n.id === 'shift-s2'), 'only what GM can see');
});
test('the function is missing (404) or cannot check the PIN (503): REST as before (the same as the other secure keys)', async () => {
  const W = world({ ssDown: true });
  const c = tab(W, 'tGM');
  await c.notifPullNow();
  assert.equal(c.ntMode(), 'rest');
  assert.deepEqual(ids(local(c)), ids(SEED));
});

test('after the SQL (the row is closed to the public key) everything still works through the function', async () => {
  const W = world({ rlsNt: true });
  const c = tab(W, 'tSL');
  await c.ntPull();
  assert.deepEqual(ids(local(c)), ['off-s1', 'shift-s1']);
  c.markNotifRead('off-s1'); c.addNotif({ type: 't', title: 'after sql', toRoles: ['gm'], refId: 'as1' });
  await settle(c);
  const cl = cloud(W);
  assert.deepEqual(cl.find(n => n.id === 'off-s1').readBy, ['Sally']);
  assert.ok(cl.some(n => n.refId === 'as1' && n.by === 'Sally'));
});

// ---- わざと壊す試験で見つけた抜けを埋める試験（v1152）
// 関数への頼みを見る・答えを遅らせる（答えはそのときのクラウドで作り、届けるのを待たせる）
function spy(c, W) {
  const S = { bodies: [], hold: null, holdN: 0 };
  c.fetch = async (u, o) => {
    const isSS = String(u).includes('/functions/v1/secure-state');
    if (isSS && o && typeof o.body === 'string') { try { S.bodies.push(JSON.parse(o.body)); } catch { /* */ } }
    const r = await W.fetch(u, o);
    if (isSS && S.hold && S.holdN > 0) { S.holdN--; await S.hold; }
    return r;
  };
  S.gate = () => { let rel; S.hold = new Promise(r => { rel = r; }); S.holdN = 1; return () => rel(); };
  S.nt = () => S.bodies.filter(b => b.action === 'nt');
  return S;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const nAt = (id, msAgo, o) => ({ id, at: new Date(Date.now() - msAgo).toISOString(), readBy: [], ackBy: [], type: 't', title: 'T ' + id, ...o });

test('the first run on a v1151 device: copies from REST count as in the cloud (marks too); only my own notices of the last 3 days are sent again, and only when a send was pending', async () => {
  const W = world();
  const extra = [nAt('mine-recent', 3600000, { by: 'Gina', toRoles: ['gm'] }), nAt('mine-old', 5 * 86400000, { by: 'Gina', toRoles: ['gm'] }),
    nAt('read-by-me', 7200000, { by: 'X', toRoles: ['gm'], readBy: ['Gina'], ackBy: ['Gina'] })];
  const a = tab(W, 'tGM'); a.MEM.set('notifications', JSON.stringify([...SEED, ...extra]));
  const sa = spy(a, W);
  assert.equal(await a.ntPush(), true);
  assert.equal(sa.nt().length, 0, 'no send was pending: nothing is sent (no notices, no marks)');
  assert.ok(local(a).every(n => n._s === 1));
  const rb = local(a).find(n => n.id === 'read-by-me');
  assert.deepEqual([rb._sr, rb._sa], [1, 1]);
  const b = tab(W, 'tGM'); b.MEM.set('notifications', JSON.stringify([...SEED, ...extra])); b.__pending.notifications = true;
  const sb = spy(b, W);
  assert.equal(await b.ntPush(), true);
  assert.deepEqual(sb.nt().flatMap(x => (x.add || []).map(n => n.id)), ['mine-recent'], 'a send was pending: only my own notice of the last 3 days');
  assert.ok(cloud(W).some(n => n.id === 'mine-recent' && n.by === 'Gina'));
  assert.ok(!cloud(W).some(n => n.id === 'mine-old'));
});

test('a notice someone else added and could not send is kept for them for 14 days, then dropped; it is never sent as me', async () => {
  const W = world();
  const c = tab(W, 't1'); await c.ntPull();
  const L = local(c);
  L.push(nAt('oth-new', 86400000, { by: 'Crew 2', _w: 'Crew 2', toRoles: ['gm'] }), nAt('oth-old', 20 * 86400000, { by: 'Crew 2', _w: 'Crew 2', toRoles: ['gm'] }));
  c.MEM.set('notifications', JSON.stringify(L));
  const s = spy(c, W);
  assert.equal(await c.ntPush(), true);
  assert.equal(s.nt().length, 0);
  assert.ok(local(c).some(n => n.id === 'oth-new'), 'kept for its person');
  assert.ok(!local(c).some(n => n.id === 'oth-old'), 'dropped after 14 days');
});

test('more than 20 notices go 20 at a time; a notice the function cannot take is not kept as unsent; an ack is sent once', async () => {
  const W = world();
  const c = tab(W, 'tGM'); await c.ntPull();
  const L = local(c);
  for (let i = 0; i < 25; i++) L.push(nAt('bulk' + i, 60000, { by: 'Gina', toRoles: ['office'] }));
  L.push(nAt('bad1', 60000, { by: 'Gina', 'bad-key': 1 }));
  c.MEM.set('notifications', JSON.stringify(L));
  const s = spy(c, W);
  assert.equal(await c.ntPush(), true);
  assert.equal(cloud(W).filter(n => n.id.startsWith('bulk')).length, 25);
  assert.ok(s.nt().every(b => (b.add || []).length <= 20));
  assert.ok(!local(c).some(n => n.id === 'bad1'), 'not kept as an unsent notice (it would be sent forever)');
  assert.ok(!cloud(W).some(n => n.id === 'bad1'));
  c.ackNotif('r-gm'); await settle(c);
  assert.deepEqual(cloud(W).find(n => n.id === 'r-gm').ackBy, ['Gina']);
  const n0 = s.bodies.length;
  assert.equal(await c.ntPush(), true);
  assert.equal(s.bodies.length, n0, 'the ack in the cloud is not sent again');
});

test('another sign-in while a request is out: the answer is not put on the next person’s device', async () => {
  const W = world();
  const c = tab(W, 'tGM'); await c.ntPull();
  const s = spy(c, W);
  let rel = s.gate();
  const p = c.ntPull();
  await wait(20); logout(c); login(c, 't2'); rel();
  assert.equal(await p, null);
  assert.ok(!local(c).some(n => ['r-gm', 'off-s1'].includes(n.id)), 'reading: GM’s notifications are not put on the next device');
  logout(c); login(c, 'tGM'); await c.ntPull();
  const L = local(c); L.push(nAt('gm-pend', 60000, { by: 'Gina', toRoles: ['office'] })); c.MEM.set('notifications', JSON.stringify(L));
  rel = s.gate();
  const p2 = c.ntPush();
  await wait(20); logout(c); login(c, 't2'); rel();
  assert.equal(await p2, false);
  assert.ok(!local(c).some(n => ['r-gm', 'off-s1'].includes(n.id)), 'sending: the same');
});

test('an older read answer does not take away a notice the device just sent', async () => {
  const W = world();
  const c = tab(W, 't1'); await c.ntPull();
  const s = spy(c, W);
  const rel = s.gate();
  const p = c.ntPull();                 // 答えは新しい通知の前のクラウド
  await wait(20);
  c.addNotif({ type: 'consult', title: '相談', toRoles: ['gm'], refId: 'rx1' });
  await settle(c);
  assert.ok(local(c).some(n => n.refId === 'rx1' && n._s === 1));
  rel(); assert.equal(await p, true);
  assert.ok(local(c).some(n => n.refId === 'rx1'), 'still there');
});

test('pullOpKey for notifications goes through the function; a stretch on the REST road does not turn the cloud’s notices into my notices', async () => {
  const W = world();
  const c = tab(W, 't1');
  await c.pullOpKey('notifications');
  assert.deepEqual(ids(local(c)), ['shift-s1', 'u-crew1']);
  assert.ok(!(W.anonReads || []).some(q => q.includes('notifications')), 'no REST read with the public key');
  // 前の版の関数：REST で読む。関数が戻っても、REST で取った通知（500 件を超えて押し出されたものも）を自分の通知として送らない
  const W2 = world({ old: true });
  const g = tab(W2, 'tGM');
  await g.pullOpKey('notifications');
  assert.deepEqual(ids(local(g)), ids(SEED), 'read by REST as before');
  W2.set('notifications', SEED.filter(n => n.id !== 'r-gm'));
  W2.fresh(false); g._nt.old = null;
  const sg = spy(g, W2);
  assert.equal(await g.ntPush(), true);
  assert.ok(!sg.nt().some(b => (b.add || []).length), 'nothing is sent as a new notice');
  assert.ok(!cloud(W2).some(n => n.id === 'r-gm'), 'a pushed-out notice does not come back under my name');
  // 送ったときに前の版と分かった：同じ
  const W3 = world({ old: true });
  const h = tab(W3, 'tGM'); h.__pending.notifications = true;
  h.addNotif({ type: 't', title: 'via rest', toRoles: ['office'], refId: 'vr1' });
  await settle(h);
  assert.ok(cloud(W3).some(n => n.refId === 'vr1'), 'written by REST as before');
  W3.set('notifications', cloud(W3).filter(n => n.id !== 'r-gm'));
  W3.fresh(false); h._nt.old = null; h.__pending.notifications = false;
  const sh = spy(h, W3);
  await h.ntPush();
  assert.ok(!cloud(W3).some(n => n.id === 'r-gm'));
  assert.ok(!sh.nt().some(b => (b.add || []).some(n => n.id === 'r-gm')));
  // PIN の確かめ先が答えない 10 分（ほかの機密のキーも REST に戻る）：REST の取り込みのあと、関数の道に戻っても同じ
  const W4 = world();
  const k = tab(W4, 't1'); await k.ntPull();
  k._ss.legacy = { id: k.ssSess().id, at: Date.now() };
  k._applyKvRows(await k._kvPullRows(true), []);
  assert.ok(local(k).some(n => n.id === 'r-gm'), 'REST as before during the stretch');
  W4.set('notifications', SEED.filter(n => n.id !== 'r-gm'));
  k._ss.legacy = null;
  const sk = spy(k, W4);
  await k.ntPush();
  assert.ok(!cloud(W4).some(n => n.id === 'r-gm'));
  assert.ok(!sk.nt().some(b => (b.add || []).length));
});

test('the REST pull leaves the notifications row out of the request itself (the full read and the changed-keys read)', async () => {
  const W = world();
  const c = tab(W, 't1'); await c.ntPull();
  const r0 = W.reads.length;
  const rows1 = await c._kvPullRows(true), ok1 = [];
  c._applyKvRows(rows1, ok1); c._kvSeenRecord(rows1, ok1);
  const full = W.reads.slice(r0).filter(q => q.includes('select=key%2Cvalue') || q.includes('select=key,value'));
  assert.ok(full.length, 'the full read ran: ' + W.reads.slice(r0).join(' | '));
  assert.ok(full.every(q => q.includes('notifications')), 'notifications is named in not.in: ' + full.join(' | '));
  W.set('notifications', [...SEED, N('new-one', { toRoles: ['gm'] })], '2026-11-13T09:00:00.000000+00:00');
  W.set('tasks_all', { a: { t: 2 } }, '2026-11-13T09:00:00.000000+00:00');
  const r1 = W.reads.length;
  const rows2 = await c._kvPullRows(false);
  const q2 = W.reads.slice(r1);
  assert.ok(q2.some(q => q.includes('key=in.') && q.includes('tasks_all')), 'the changed-keys read ran: ' + q2.join(' | '));
  assert.ok(!q2.some(q => q.includes('notifications')), 'notifications is not asked for by name');
  assert.ok(!(rows2 || []).some(r => r && r.key === 'notifications'));
});

test('the realtime watch on the notifications row is only for the REST road (the function road reads on signals and every minute)', async () => {
  const W = world();
  const subs = [];
  const mk = c => { c.supabase = { createClient: () => ({ channel: n => { const ch = { on() { return ch; }, subscribe() { subs.push(n); return ch; } }; return ch; }, removeChannel() {} }) }; };
  const c = tab(W, 't1'); mk(c);
  c.notifRealtimeStart(); await wait(30); c.notifRealtimeStop();
  assert.deepEqual(subs, [], 'the function road: not watched');
  const g = tab(W); login(g, 'tGM', true); mk(g);
  g.notifRealtimeStart(); await wait(30); g.notifRealtimeStop();
  assert.deepEqual(subs, ['rt-notifications'], 'the REST road (GM without a PIN mark): watched as before');
});

test('the store tablet with a function of the previous version: adds by REST as before', async () => {
  const W = world({ old: true });
  const tb = tab(W, 'tStore');
  tb.ntMigrate();   // ログインのとき（notifRealtimeStart）
  tb.addNotif({ type: 'shift', title: 'old tablet', toStore: 'S1', toRoles: ['crew'], refId: 'ot1' });
  await settle(tb);
  assert.ok(cloud(W).some(n => n.refId === 'ot1'), 'reached the cloud');
  // ログインの印の無いスタッフ（PIN が初期のまま）：関数を公開の鍵で呼ぶ道。前の版なら同じく REST で
  const c = tab(W); login(c, 't1', true); c.ntMigrate();
  c.addNotif({ type: 'consult', title: 'no mark', toRoles: ['gm'], refId: 'ot2' });
  await settle(c);
  assert.ok(cloud(W).some(n => n.refId === 'ot2'), 'reached the cloud');
});
