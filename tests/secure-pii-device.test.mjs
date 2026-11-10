// v1144 の直し（Codex #138 P1-2）：app_state の emp_pii（全員の個人の欄の生の値）を端末に置かない。
// SQL 20261113090000 の前は公開の鍵で読めるので、通常の取り込み（_kvPullRows・_applyKvRows）で取らず・置かず、
// 前に置いた写し（localStorage・IndexedDB・送信待ち）も、起動（IndexedDB を読み終えたあと）・取り込み・ログアウトのたびに消す。
// アプリの本物の取り込み・ログアウト・起動の一行を vm で動かし、本物の関数 secure-state（今と v1143）と合成のクラウドにつなぐ。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, ts6 } from './lib/secure-state-world.mjs';

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

const v1143Src = readFileSync(new URL('../deploy/secure-settings-v1143/2_関数_secure-state_index.ts', import.meta.url), 'utf8').replace(/\nDeno\.serve\([^\n]*\n?$/, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'ss1143d-'));
writeFileSync(join(tmp, 'handler.mjs'), v1143Src);
const { createHandler: createHandler1143 } = await import(pathToFileURL(join(tmp, 'handler.mjs')).href);

// 起動の一行（IndexedDB を読み終えたら消す）：アプリのそのままの文
const BOOT_HOOK = varLine(/^_idbBootP\.then\(function\(\)\{ try\{ if\(typeof piiPurgeLocal==='function'\) piiPurgeLocal\(\); \}catch\(e\)\{\} \}\);.*$/m);

const CODE = [
  block('var SS_FN = ', 'var KV_SEEN_KEY'),
  block('var KV_SEEN_KEY', '\nasync function supaPullAllMasters('),
  varLine(/^var _OP_READ_TMO = .*$/m), varLine(/^var _SUPA_FETCH_ORDER = .*$/m),
  ...['_applyKvRows', '_supaFetchOrder', 'supaFetchAll', 'supaHeaders'].map(fn),
  `var SUPABASE_URL=${JSON.stringify(URL0)}, SUPABASE_ANON=${JSON.stringify(ANON)};
   var _SPLIT_KEYS={}, _LS_ONDEMAND_KEYS=[], _LS_ONDEMAND_PREFIX=[], SUPA_MASTER_MAP={}, SUPA_SETTING_KEYS=[], SUPA_SETTING_PREFIX=[];
   var _supaBooting=false, _lastSupaError=null, _opMergeChain={}, _opLastPushErr={}, _opLastPushWhy={}, _idbState='ready', _idbBootP=null;
   var curRole='', curStoreLogin=null, __pending={}, __fetched={}, __toasts=[];
   var MEM=new Map();
   function _lsStoreGet(k){ return MEM.has(k) ? MEM.get(k) : null; }
   function _lsWriteVerified(k, t){ MEM.set(k, t); return true; }
   function _lsRawDel(k){ MEM.delete(k); return true; }
   function _lsRaw(k, d){ var v=_lsStoreGet(k); return v ? JSON.parse(v) : d; }
   function ls(k, d){ return _lsRaw(k, d); }
   function lsSet(k, v){ MEM.set(k, JSON.stringify(v)); return true; }
   function lsKeys(p){ p=p||''; return [...MEM.keys()].filter(function(k){ return k.indexOf(p)===0; }); }
   function _lsMarkFetched(k){ __fetched[k]=1; } function _lsClearSaveFailure(){} function _lsNoteSaveFailure(){}
   function _handleLegacySplitRow(){ return false; } function _lsOnDemand(){ return false; } function isLocalOnlyKey(){ return false; }
   function _pullPendingMap(){ return null; } function _pullKeepLocal(){ return false; } function _lsCloudPending(k){ return !!__pending[k]; }
   function _opMergeDef(){ return null; }
   var __removed=[]; function _outboxRemove(k){ __removed.push(k); delete __pending[k]; }
   function invInSession(){ return null; } async function invInSessionRefresh(){ return null; }
   function showToast(m){ __toasts.push(m); } function karteRerender(){}
   var document={ getElementById:function(){ return null; } };`,
].join('\n');

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', data: { dob: '2001-01-01' } },
];
const ME = { tGM: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' }, t1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' } };
const PII = { 'E-1': { dob: '2001-01-01', cardLast4: '5555', insurance: true, dental: false, insuranceAmt: 250, _at: 'x', _by: 'Gina M' } };
const T0 = ts6(Date.UTC(2026, 10, 3, 9, 0, 0));

function world(o = {}) {
  const W = makeWorld({ pins: ME, emps: EMPS.map(e => JSON.parse(JSON.stringify(e))), ...o });   // rls なし＝SQL 20261113090000 の前（公開の鍵で emp_pii を読める）
  let clock = Date.UTC(2026, 10, 9, 11, 0, 0);
  W.ssHandler = (o.old ? createHandler1143 : createHandler)({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: W.fetch, now: () => (clock += 1000) });
  W.set('emp_pii', PII, T0);
  W.set('tasks_all', { a: { t: 1 } }, T0);
  return W;
}
function tab(W) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array, AbortController, Error,
    fetch: (u, o) => W.fetch(u, o), localStorage: (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; })() });
  c.window = c;
  vm.runInContext(CODE, c);
  return c;
}
const pull = async (c, force) => { const rows0 = await c._kvPullRows(!!force); const rows = c.ssStaleRows ? c.ssStaleRows(rows0) : rows0; const ok = []; c._applyKvRows(rows, ok); c._kvSeenRecord(rows, ok); c.ssSeenRecord(rows, ok); return rows; };

for (const [name, opt] of [['the v1144 function', {}], ['the v1143 function (before the new one)', { old: true }], ['no function at all', { ssDown: true }]]) {
  test('before the SQL, the normal pull never puts emp_pii on the device (' + name + ')', async () => {
    for (const who of ['tGM', 't1']) {
      const W = world(opt);
      const c = tab(W); c._hwSession = who; c.curRole = who === 'tGM' ? 'gm' : 'crew';
      await pull(c, true);   // 全部取る（初めての端末・7 日ごと・設定）
      assert.ok(!c.MEM.has('emp_pii'), who + ': not stored by the full pull');
      assert.ok(c.MEM.has('tasks_all'), 'other rows still arrive');
      const full = W.reads.map(decodeURIComponent).filter(q => /select=key,value/.test(q) && /key=not\.in\./.test(q));
      assert.ok(full.length && full.every(q => /"emp_pii"/.test(q)), 'the full REST read excludes emp_pii');
      W.set('emp_pii', { ...PII, 'E-1': { ...PII['E-1'], dob: '2001-02-02' } }, ts6(Date.UTC(2026, 10, 3, 10, 0, 0)));   // 変わった（印が変わる）
      const rows = await pull(c);   // 差分の取り込み（変わった行だけ）
      assert.ok(!rows.some(r => r && r.key === 'emp_pii'), who + ': not asked for by the diff pull');
      assert.ok(!c.MEM.has('emp_pii'));
    }
  });
}

test('a server that ignores the filter still cannot put emp_pii on the device (the apply step drops it)', async () => {
  const W = world({ ignoreNot: true });
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  const rows = await pull(c, true);
  assert.ok(rows.some(r => r && r.key === 'emp_pii'), 'the row came (the server ignored not.in)');
  assert.ok(!c.MEM.has('emp_pii'), 'but it was not stored');
});

test('a copy put there earlier (older version, IndexedDB, unsent queue) is removed by the pull and by logout', async () => {
  const W = world();
  const c = tab(W); c._hwSession = 'tGM'; c.curRole = 'gm';
  c.MEM.set('emp_pii', JSON.stringify(PII)); c.localStorage.setItem('emp_pii', JSON.stringify(PII)); c.__pending.emp_pii = 1;
  await pull(c);
  assert.ok(!c.MEM.has('emp_pii') && c.localStorage.getItem('emp_pii') == null, 'removed at the pull');
  assert.ok(c.__removed.includes('emp_pii'), 'and dropped from the unsent queue');
  // ログアウト（共有の端末）：消す。SQL のあと（RLS で読めない）・取り直しても戻らない
  c.MEM.set('emp_pii', JSON.stringify(PII));
  c.ssOnLogout();
  assert.ok(!c.MEM.has('emp_pii'), 'removed at logout');
  W.rlsPii = true;
  c._hwSession = 't1'; c.curRole = 'crew';
  await pull(c, true);
  assert.ok(!c.MEM.has('emp_pii'));
});

test('slow IndexedDB: the copy that IndexedDB restores after the pull is removed once it finishes loading (the boot line)', async () => {
  const W = world();
  const c = tab(W);
  let done;
  c._idbBootP = new Promise(r => { done = r; });
  vm.runInContext(BOOT_HOOK, c);   // アプリの起動の一行（_idbBootP のすぐあと）
  // 取り込みは IndexedDB を 3 秒まで待つ。そのあいだに何も来ないまま進んだあと、IndexedDB が前の版の写しを戻す
  c.MEM.set('emp_pii', JSON.stringify(PII));
  done();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!c.MEM.has('emp_pii'), 'removed when IndexedDB finished loading');
  assert.match(BOOT_HOOK, /piiPurgeLocal\(\)/);
  // アプリの中で、この一行は _idbBootP を作った直後にある
  const i = source.indexOf('var _idbBootP = new Promise('), j = source.indexOf(BOOT_HOOK);
  assert.ok(i > 0 && j > i && source.slice(i, j).split('\n').length <= 3, 'right after _idbBootP');
});
