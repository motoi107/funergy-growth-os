// v1098（速さ）：本物の関数（index.html）を VM で動かす。合成データだけ。本番にはつながない。
//   ① lsSplitRO：端末の文字が同じなら解き直さない／1 文字でも違えば解き直す（ls() と同じ値）
//   ② _invDayCostMap：件数が同じまま金額を直した Invoice も日別の原価に出る（前は件数で覚えていた）
//   ③ supaFetchAll：Range ヘッダーを使わない（圧縮されるように）・主キーの順・途中のページが読めなければ null
//   ④ app_state の差分の取り込み（_kvPullRows・_applyKvRows・_kvSeenRecord）
//      初めての端末は全部／2 回目は変わった行だけ／関数が無ければ前の統合行だけ印で外す／取り込めなかった行は次も取る／7 日ごとに全部
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMock } from './perf/mock-api.mjs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start + 1);
  return source.slice(start + 1, end + 2);
}
const decl = name => { const m = new RegExp('^var ' + name + ' = [^\\n]+', 'm').exec(source); assert.ok(m, name); return m[0]; };

function makeFetch(mock, log) {
  return async (url, opts = {}) => {
    const u = new URL(url); const method = opts.method || 'GET'; const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    log.push({ method, path: u.pathname, search: decodeURIComponent(u.search), range: headers['range'] || null });
    const r = mock.handle(method, u, headers, opts.body || '');
    const body = r.body == null ? '' : r.body;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(body || 'null'), text: async () => body };
  };
}

function app({ tables, failWrite = new Set(), noIndex = false } = {}) {
  const prev = process.env.HAS_INDEX; process.env.HAS_INDEX = noIndex ? '0' : '1';
  const mock = createMock({ tables: Object.assign({ app_state: [] }, tables) });
  process.env.HAS_INDEX = prev;
  const log = [];
  const c = { console: { log() { }, warn() { }, error() { } }, Date, JSON, Math, Promise, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, Object, Array, String, Number, RegExp };
  c.STORE = new Map(); c.FAIL = failWrite; c.FOLD = [];
  c.fetch = makeFetch(mock, log);
  vm.createContext(c);
  vm.runInContext([
    "var SUPABASE_URL = 'https://x.supabase.co';",
    'var SUPA_MASTER_MAP = { m_employees:{ table:"employees", pk:"id" } };',
    decl('_SUPA_FETCH_ORDER'), decl('_SPLIT_RO'), decl('_LS_ONDEMAND_KEYS'), decl('_LS_ONDEMAND_PREFIX'),
    decl('KV_SEEN_KEY'), decl('KV_SKIP_PREFIX'), decl('KV_FULL_EVERY_MS'), decl('_kvRpcMissing'), decl('_kvLast'), decl('LS_LOCAL_ONLY'),
    ['_supaFetchOrder', 'supaFetchAll', '_ymOf', '_lsYmPrev', '_pdOf', '_lsPdPrev', '_lsOnDemand', 'isLocalOnlyKey', '_splitPrefix', 'lsSplitRO',
      '_kvSeenGet', '_kvSkipKey', '_kvDiscarded', '_kvQuote', '_kvIndexRpc', '_kvIndexKeys', '_kvFetchKeys', '_kvPullRows', '_kvSeenRecord', '_applyKvRows'].map(fn).join('\n'),
    `function supaHeaders(){ return { apikey:'k', Authorization:'Bearer k', 'Content-Type':'application/json' }; }
     var _SPLIT_KEYS = { invoices:{type:'arr', by:function(r){return r&&r.storeId;}}, tasks_all:{type:'arr', by:function(r){return r&&r.store;}} };
     function _lsStoreGet(k){ return STORE.has(k) ? STORE.get(k) : null; }
     function _lsWriteVerified(k, js){ if (FAIL.has(k)) return false; STORE.set(k, js); return true; }
     function _lsRaw(k, d){ var s=_lsStoreGet(k); return s==null ? d : JSON.parse(s); }
     function lsKeys(p){ return Array.from(STORE.keys()).filter(function(k){ return k.indexOf(p)===0; }).sort(); }
     var PARSES = 0;
     function ls(k, d){ if (_SPLIT_KEYS[k]) { PARSES++; var out=[]; lsKeys(_splitPrefix(k)).forEach(function(pk){ out=out.concat(JSON.parse(STORE.get(pk))); }); return out.filter(function(r){ return !(r&&r._deleted); }); } var s=_lsStoreGet(k); return s==null ? d : JSON.parse(s); }
     function _opMergeDef(k){ return null; }
     function _lsMarkFetched(){ } function _lsClearSaveFailure(){ } function _lsNoteSaveFailure(){ }
     function _handleLegacySplitRow(key, val){ _handleLegacySplitRow._ok=false; if(!_SPLIT_KEYS[key]) return false; FOLD.push(key); _handleLegacySplitRow._ok=true; return true; }`
  ].join('\n'), c);
  return { c, log, mock, run: code => vm.runInContext(code, c) };
}

const row = (key, value, at = '2026-10-20T00:00:00.000Z') => ({ key, value, updated_at: at });

test('① lsSplitRO: the same stored text gives the same parsed value; any change parses again and matches ls()', () => {
  const { c, run } = app();
  c.STORE.set('spl_invoices_F01', JSON.stringify([{ id: 'a', storeId: 'F01', total: 10 }]));
  c.STORE.set('spl_invoices_F02', JSON.stringify([{ id: 'b', storeId: 'F02', total: 20 }, { id: 'c', storeId: 'F02', total: 5, _deleted: true }]));
  const a = run("lsSplitRO('invoices')"); const b = run("lsSplitRO('invoices')");
  assert.equal(a, b, 'same object while nothing changed');
  assert.equal(run('PARSES'), 1, 'parsed once');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(run("ls('invoices',[])"))));
  c.STORE.set('spl_invoices_F01', JSON.stringify([{ id: 'a', storeId: 'F01', total: 11 }]));
  const d = run("lsSplitRO('invoices')");
  assert.notEqual(d, a); assert.equal(d.find(x => x.id === 'a').total, 11);
  c.STORE.set('spl_invoices_F03', JSON.stringify([{ id: 'z', storeId: 'F03', total: 1 }]));   // 分割の行が増えた
  assert.equal(run("lsSplitRO('invoices')").length, 3);
  c.STORE.delete('spl_invoices_F03');
  assert.equal(run("lsSplitRO('invoices')").length, 2);
  assert.equal(run("lsSplitRO('m_not_split').length"), 0, 'not a split key: plain ls()');
});

test('② _invDayCostMap: a changed amount with the same number of invoices shows up (it used to keep the old map)', () => {
  const { c, run } = app();
  vm.runInContext(fn('_invDayCostMap') + `
    function parseJaDate(s){ var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(s||'')); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; }
    function ipsStamp(){ return 's'; } function ipsReplacesCopy(){ return false; } function ipsAddDayCosts(){ }
    var window = this;`, c);
  c.STORE.set('spl_invoices_F01', JSON.stringify([{ id: 'a', storeId: 'F01', total: 100, date: '2026-10-05' }]));
  assert.equal(run("_invDayCostMap()['F01']['2026-10-05']"), 100);
  const parses = run('PARSES');
  for (let i = 0; i < 300; i++) run("_invDayCostMap()");
  assert.equal(run('PARSES'), parses, '300 calls, no parse');
  c.STORE.set('spl_invoices_F01', JSON.stringify([{ id: 'a', storeId: 'F01', total: 250, date: '2026-10-05' }]));   // 件数は同じ
  assert.equal(run("_invDayCostMap()['F01']['2026-10-05']"), 250);
});

test('③ supaFetchAll: no Range header, ordered by the primary key, a failed later page is a failure (null)', async () => {
  const rows = Array.from({ length: 2300 }, (_, i) => row('k' + String(i).padStart(5, '0'), { i }));
  const { run, log, mock } = app({ tables: { app_state: rows.slice().reverse() } });
  const got = JSON.parse(JSON.stringify(await run("supaFetchAll('app_state','key,value')")));
  assert.equal(got.length, 2300);
  assert.deepEqual(got.map(r => r.key), rows.map(r => r.key), 'ordered, no duplicates or gaps across pages');
  assert.ok(log.every(e => e.range === null), 'no Range header (the browser would ask for an uncompressed answer)');
  assert.ok(log.every(e => /order=key\.asc/.test(e.search) && /limit=1000/.test(e.search)));
  // 2 ページ目で失敗
  const real = mock.handle; let n = 0;
  mock.handle = (m, u, h, b) => (++n === 2 ? { status: 503, body: '{}' } : real(m, u, h, b));
  assert.equal(await run("supaFetchAll('app_state','key,value')"), null);
  mock.handle = real;
  // 並べる列が無い表は並べずに取る
  // 並べる列が無い（400）ときは、並べずに取り直す
  const { run: run2, log: log2, mock: mock2 } = app({ tables: { employees: [{ id: 'v1', data: {} }] } });
  const real2 = mock2.handle;
  mock2.handle = (m, u, h, b) => (u.searchParams.get('order') ? { status: 400, body: '{"code":"42703"}' } : real2(m, u, h, b));
  const v = JSON.parse(JSON.stringify(await run2("supaFetchAll('employees','data')")));
  assert.equal(v.length, 1);
  assert.equal(log2.length, 2, 'once with order, once without');
});

function seedCloud() {
  const big = Array.from({ length: 40 }, (_, i) => ({ id: 'i' + i, storeId: 'F01', total: i }));
  return [
    row('daily_actuals_F01', { '2026-10-01': { actual: 100 } }, '2026-10-19T01:00:00.000Z'),
    row('spl_invoices_F01', big, '2026-10-19T01:00:00.000Z'),
    row('invoices', big, '2026-07-01T00:00:00.000Z'),            // 前の統合行（分割へ移ったもの）
    row('tasks_all', [{ id: 't', store: 'F01' }], '2026-07-01T00:00:00.000Z'),
    row('ec_log', [{ d: 1 }], '2026-10-19T00:00:00.000Z'),        // 必要時だけ取る（取り込みで捨てる）
    row('spl_skill_history_A B', [{ name: 'A B' }], '2026-10-19T00:00:00.000Z'),
    row('notifications', [{ id: 'n1' }], '2026-10-19T00:00:00.000Z'),
    row('pl_actual', { x: 1 }, '2026-10-19T00:00:00.000Z'),        // 端末だけのキー（取り込みで捨てる）
    row('invoice_purchase_2026-10', { s: 1 }, '2026-10-19T00:00:00.000Z'),
    row('cash_tips_F01', { '2026-10-01': { lunch: 1, entered: true } }, '2026-10-19T00:00:00.000Z'),
  ];
}
async function pull(h, force) {
  // VM の中の配列は別の realm なので、JSON で外の形にしてから比べる
  return JSON.parse(await h.run(`(async function(){ var rows = await _kvPullRows(${force ? 'true' : 'false'}); var ok = []; _applyKvRows(rows, ok); _kvSeenRecord(rows, ok); return JSON.stringify({ n: rows ? rows.length : -1, keys: (rows||[]).map(function(r){ return r.key; }).sort(), how: rows && rows._kv && rows._kv.how }); })()`));
}
const valueGets = log => log.filter(e => e.method === 'GET' && e.path === '/rest/v1/app_state' && /select=key,value/.test(e.search));

test('④-1 first pull on a device takes everything it keeps (as before); the second pull takes only the changed rows', async () => {
  const h = app({ tables: { app_state: seedCloud() } });
  const r1 = await pull(h);
  assert.equal(r1.how, 'all');
  assert.deepEqual(r1.keys, ['cash_tips_F01', 'daily_actuals_F01', 'invoices', 'notifications', 'pl_actual', 'spl_invoices_F01', 'tasks_all'],
    'server already leaves out the rows the app throws away (ec_log, person history) and invoice_purchase_');
  assert.ok(h.c.STORE.has('daily_actuals_F01') && h.c.STORE.has('notifications') && !h.c.STORE.has('pl_actual') && !h.c.STORE.has('ec_log'));
  assert.deepEqual(JSON.parse(JSON.stringify(h.c.FOLD)).sort(), ['invoices', 'tasks_all']);
  // 1 行だけ変える（updated_at は変えずに中身だけ：印は中身で決まる）
  const t = h.mock.T.app_state.find(r => r.key === 'notifications'); t.value = [{ id: 'n1' }, { id: 'n2' }];
  h.log.length = 0; h.c.FOLD.length = 0;
  const r2 = await pull(h);
  assert.equal(r2.how, 'keys');
  assert.deepEqual(r2.keys, ['notifications'], 'only the changed row');
  assert.equal(JSON.parse(h.c.STORE.get('notifications')).length, 2);
  assert.equal(h.c.FOLD.length, 0, 'unchanged old combined rows are not folded again');
  assert.equal(valueGets(h.log).length, 1);
  // 何も変わっていなければ値は 1 行も取らない
  h.log.length = 0;
  const r3 = await pull(h);
  assert.deepEqual(r3.keys, []);
});

test('④-2 a row missing on the device, a row that could not be saved, and a new row are taken again', async () => {
  const h = app({ tables: { app_state: seedCloud() }, failWrite: new Set(['cash_tips_F01']) });
  await pull(h);
  h.c.STORE.delete('daily_actuals_F01');                 // 端末から消えた（整理など）
  h.mock.T.app_state.push(row('purchases_F01', [{ id: 'p' }]));
  h.c.FAIL.clear();
  const r = await pull(h);
  assert.deepEqual(r.keys, ['cash_tips_F01', 'daily_actuals_F01', 'purchases_F01']);
  const r2 = await pull(h);
  assert.deepEqual(r2.keys, []);
});

test('④-3 without the SQL function: everything as before, except old combined rows whose updated_at did not change', async () => {
  const h = app({ tables: { app_state: seedCloud() }, noIndex: true });
  const r1 = await pull(h);
  assert.equal(r1.how, 'all');
  assert.ok(r1.keys.includes('invoices'));
  const rpcCalls = () => h.log.filter(e => e.path === '/rest/v1/rpc/app_state_index').length;
  assert.equal(rpcCalls(), 1, 'tried the function once');
  h.c.FOLD.length = 0;
  const r2 = await pull(h);
  assert.equal(r2.how, 'all');
  assert.ok(!r2.keys.includes('invoices') && !r2.keys.includes('tasks_all'), 'unchanged old combined rows are left out');
  assert.ok(r2.keys.includes('daily_actuals_F01') && r2.keys.includes('notifications'), 'all other rows are still taken (no hash to trust)');
  // 前の統合行が書き直されたら（前の版の端末が書いた）、また取って畳み込む
  h.mock.T.app_state.find(r => r.key === 'invoices').updated_at = '2026-10-20T05:00:00.000Z';
  const r3 = await pull(h);
  assert.ok(r3.keys.includes('invoices'));
  assert.deepEqual(JSON.parse(JSON.stringify(h.c.FOLD)), ['invoices']);
  assert.equal(rpcCalls(), 1, 'not again in the same session after a 404');
});

test('④-4 every 7 days (and on "取り込む" in settings) everything is taken again, whatever the marks say', async () => {
  const h = app({ tables: { app_state: seedCloud() } });
  await pull(h);
  const seen = JSON.parse(h.c.STORE.get('kv_seen_v1'));
  seen.fullAt = Date.now() - 8 * 86400000; h.c.STORE.set('kv_seen_v1', JSON.stringify(seen));
  const r = await pull(h);
  assert.equal(r.how, 'all'); assert.ok(r.keys.includes('notifications') && r.keys.includes('invoices'));
  const r2 = await pull(h);
  assert.deepEqual(r2.keys, []);
  const r3 = await pull(h, true);
  assert.equal(r3.how, 'all');
});

test('④-5 keys with spaces, quotes and commas are fetched by name correctly', async () => {
  const odd = ['spl_budgets_v2_F01', 'fav_Ann "Q", Lee', 'sl_manual_F(1)', 'menu_mix_F01_2026.10', '日本語_キー'];
  const h = app({ tables: { app_state: odd.map(k => row(k, { k })) } });
  await pull(h);
  for (const k of odd) h.mock.T.app_state.find(r => r.key === k).value = { k, v: 2 };
  const r = await pull(h);
  assert.deepEqual(r.keys, odd.slice().sort());
  for (const k of odd) assert.equal(JSON.parse(h.c.STORE.get(k)).v, 2, k);
});

test('④-6 a broken or empty index is not trusted (everything is taken as before)', async () => {
  const h = app({ tables: { app_state: seedCloud() } });
  await pull(h);
  const real = h.mock.handle;
  h.mock.handle = (m, u, hd, b) => (/rpc\/app_state_index/.test(u.pathname) ? { status: 200, body: '[]' } : real(m, u, hd, b));
  const r = await pull(h);
  assert.equal(r.how, 'all');
  assert.ok(r.keys.includes('notifications') && r.keys.includes('invoices'), 'everything (the marks were md5, not updated_at)');
  h.mock.handle = (m, u, hd, b) => (/rpc\/app_state_index/.test(u.pathname) ? { status: 200, body: '[{"key":"x","h":"nothex"}]' } : real(m, u, hd, b));
  const r2 = await pull(h);
  assert.equal(r2.how, 'all');
});

test('⑤ the SQL to paste is the same as the migration and the check (deploy/perf-v1098)', () => {
  const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.equal(rd('deploy/perf-v1098/1_追加のSQL_app_state_index.sql'), rd('supabase/migrations/20261027090000_app_state_index.sql'));
  assert.equal(rd('deploy/perf-v1098/2_確認のSQL_読むだけ.sql'), rd('db/app-state-index-check.sql'));
  assert.equal(rd('deploy/perf-v1098/止める_関数を外す.sql'), rd('db/app-state-index-rollback.sql'));
  const mig = rd('supabase/migrations/20261027090000_app_state_index.sql');
  assert.ok(/security invoker/.test(mig) && !/security definer/i.test(mig), 'runs with the caller rights');
  assert.ok(!/\b(insert|update|delete|alter table|drop table|truncate)\b/i.test(mig.replace(/--[^\n]*/g, '')), 'reads only');
});

test('⑥ release markers: APP_VERSION and SW_BUILD are 1098; the first-install reload is guarded', () => {
  assert.match(source, /APP_VERSION = '1098'/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /const SW_BUILD = '1098';/);
  const i = source.indexOf("navigator.serviceWorker.addEventListener('controllerchange'");
  const block = source.slice(i - 400, i + 400);
  assert.match(block, /var _swHadController=!!navigator\.serviceWorker\.controller;/);
  assert.match(block, /if\(!_swHadController && !window\._swUpdateAsked\) return;/);
  assert.match(source, /window\._swUpdateAsked=true;   \/\* v1098 \*\/\n      try\{ worker\.postMessage\(\{type:'SKIP_WAITING'\}\); \}catch\(e\)\{\}/);
});
