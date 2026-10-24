// v1105（UI案60 ① 1A）：売上・予算・勤怠の「取得の状態」の帯。index.html の本物の関数を VM で動かす（合成データ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  let start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const line = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0]; };
const NAMES = ['fstState', 'fstFailing', 'fstSave', 'fstStoreOfGuid', 'fstNote', 'fstStores', 'fstGuardOn', 'fstStatus', 'fstClock', 'fstLabel', 'fstNames', 'fstChip',
  'fstChipsHtml', 'fstPaint', 'fstShowFresh', 'fstUserBusy', 'fstAuto', 'fstGuardRefresh', 'fstSalesSync', 'fstRetry', 'fstAnyFail', 'pageSyncStrip', '_toastSalesErr', 'fetchToastSales',
  'syncStoreActualsFromToast', 'fetchTipLaborFromDB', '_fstLabor', '_tipLaborFetchErr',
  'fstGuardPendingNow', 'fstOnGuardState', 'fstSaveWhy', 'fstWhyOf'];   // v1107
const STORES = [{ id: 'F01', name: 'ToriTon', toastGuid: 'g1' }, { id: 'F06', name: 'LaLa', toastGuid: 'g6' }, { id: 'F07', name: 'Kapolei' }];

function context({ guard = true, fetch } = {}) {
  const ls = new Map(), timers = [], renders = [], writes = [];
  const ctx = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, setImmediate,
    localStorage: { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
    document: { hidden: false, getElementById: () => null }, navigator: { onLine: true },
    t: (ja, en) => ja, escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    STORES, getVisibleStores: () => STORES, _bStoreAbbr: s => s.name, outboxCount: () => 0, getSyncedAt: () => '', notifAgo: () => '',
    renderPage: p => renders.push(p), curPage: 'dashboard', monthDays: () => [{ date: '2026-10-01' }, { date: '2026-10-02' }],
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon',
    fetch: fetch || (async () => ({ ok: true, json: async () => [] })),
    getDailyActuals: () => ({ '2026-10-01': { actual: 50, event: 'kept' } }), setDailyActuals: (s, v) => writes.push(['da', s, JSON.parse(JSON.stringify(v))]),
    getBudgets: () => [{ storeId: 'F01', actual: 0 }], saveBudgets: b => writes.push(['bud', JSON.parse(JSON.stringify(b))]),
    syncTipLaborFromDB: async () => ({ updated: 0 }),
    window: {}, ls, timers, renders, writes
  };
  if (guard) { ctx.window.FUNERGY_FINANCIAL_SAVE = ctx.FUNERGY_FINANCIAL_SAVE = { refresh: async () => [] }; ctx.FunergyFinancialTransport = { keys: ['daily_actuals_F01'] }; }
  vm.createContext(ctx);
  vm.runInContext(line(/^var FST_KEY=.*$/m) + '\n' + line(/^var _fst=null.*$/m) + '\n' + line(/^var _fstGuardWas=.*$/m) + '\n' + NAMES.map(fn).join('\n'), ctx);
  return ctx;
}

test('Toast sales that cannot be read are marked, nothing is written, and the strip says so (not 0)', async () => {
  for (const fail of [async () => ({ ok: false, json: async () => ({}) }), async () => { throw Error('offline'); }, async () => ({ ok: true, json: async () => ({ message: 'x' }) })]) {
    const c = context({ fetch: fail });
    const rows = await c.fetchToastSales('g1', '2026-10-01', '2026-10-02');
    assert.equal(Array.isArray(rows), true); assert.equal(rows.length, 0); assert.equal(rows._err, true);
    const r = await c.syncStoreActualsFromToast('F01', 'g1', c.monthDays());
    assert.ok(r.error); assert.equal(c.writes.length, 0, 'the previous values stay as they were');
    assert.equal(c.fstStatus('sales').state, 'fail');
    const chip = c.fstChip('sales');
    assert.match(chip, /売上：取れませんでした（ToriTon・LaLa）|売上：取れませんでした（ToriTon）/);
    assert.match(chip, /前の情報もありません/); assert.doesNotMatch(chip, /\$0|0 円/);
  }
  const ok = context({ fetch: async () => ({ ok: true, json: async () => [{ business_date: '2026-10-01', net_sales: 321 }] }) });
  const rows = await ok.fetchToastSales('g1', '2026-10-01', '2026-10-02');
  assert.equal(rows._err, undefined);
  const r = await ok.syncStoreActualsFromToast('F01', 'g1', ok.monthDays(), rows);
  assert.equal(r.updated, 1); assert.equal(ok.writes[0][2]['2026-10-01'].actual, 321); assert.equal(ok.writes[0][2]['2026-10-01'].event, 'kept');
});

test('states: never fetched, some stores not yet, all fetched (oldest time), failed after a success shows the previous time', () => {
  const c = context();
  assert.equal(c.fstStatus('sales').state, 'none');
  assert.match(c.fstChip('sales'), /売上：まだ取れていません/);
  c.fstNote('sales', 'F01', true);
  assert.equal(c.fstStatus('sales').state, 'partial'); assert.match(c.fstChip('sales'), /まだ：LaLa/);
  const st = c.fstState(); st.sales.by.F01.ok = '2026-10-22T05:42:00.000Z'; st.sales.by.F06 = { ok: '2026-10-22T05:40:00.000Z' };
  assert.equal(c.fstStatus('sales').state, 'ok'); assert.equal(c.fstStatus('sales').ok, '2026-10-22T05:40:00.000Z', 'the oldest store');
  assert.match(c.fstChip('sales'), /19:40/);
  c.fstNote('sales', 'F06', false, 'toast_sales');
  const s = c.fstStatus('sales'); assert.equal(s.state, 'fail'); assert.deepEqual(Array.from(s.bad, x => x.id), ['F06']);
  assert.match(c.fstChip('sales'), /取れませんでした（LaLa）。前回 .*19:40.* の情報を表示中/);
  assert.match(c.fstChip('sales'), /fstRetry\('sales',true\)/);
  // stores without Toast are not counted
  assert.equal(c.fstStores().some(x => x.id === 'F07'), false);
  // a later success clears it
  c.fstNote('sales', 'F06', true); assert.equal(c.fstStatus('sales').state, 'ok');
  // kept on the device only, under a key that is never synced
  assert.match([...c.ls.keys()][0], /^_fetch_status_v1$/);
});

test('the guard (sales and budget records) failing marks both sales and budget; budget is hidden without the guard', () => {
  const c = context();
  c.fstNote('sales', 'F01', true); c.fstNote('sales', 'F06', true);
  c.fstNote('guard', null, false, 'financial_result_unknown');
  assert.equal(c.fstStatus('sales').state, 'fail'); assert.equal(c.fstStatus('budget').state, 'fail');
  assert.match(c.fstChip('budget'), /予算：取れませんでした/);
  c.fstNote('guard', null, true);
  assert.equal(c.fstStatus('sales').state, 'ok'); assert.equal(c.fstStatus('budget').state, 'ok');
  const n = context({ guard: false });
  assert.equal(n.fstChip('budget'), '');
  assert.equal(n.fstAnyFail(), false);
});

test('automatic retries: 3 times (15 s, 30 s, 60 s), not while hidden or offline, then only by pressing', async () => {
  let reads = 0;
  const c = context({ fetch: async () => { reads++; throw Error('offline'); } });
  await c.syncStoreActualsFromToast('F06', 'g6', c.monthDays());
  assert.deepEqual(Array.from(c.timers, x => x.ms), [15000]);
  c.document.hidden = true; c.timers.shift().f(); await new Promise(r => setImmediate(r));
  assert.equal(reads, 1, 'nothing is fetched while the page is hidden'); assert.deepEqual(Array.from(c.timers, x => x.ms), [15000], 'and no try is used');
  c.document.hidden = false;
  for (const ms of [15000, 30000, 60000]) {
    assert.equal(c.timers[0].ms, ms); c.timers.shift().f();
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  }
  assert.equal(reads, 4); assert.equal(c.timers.length, 0, 'no fourth automatic try');
  assert.equal(c.renders.length, 0, 'automatic tries never redraw the page (input in progress is kept)');
  await c.fstRetry('sales', true);
  assert.equal(reads, 6, 'pressing reads the store that failed and the store never read'); assert.deepEqual(Array.from(c.renders), ['dashboard'], 'pressing redraws');
});

test('an automatic retry that succeeds offers "表示を更新" instead of redrawing; automatic tries do not fetch stores never tried', async () => {
  let fail = true, asked = [];
  const c = context({ fetch: async url => { asked.push(url); if (fail) throw Error('x'); return { ok: true, json: async () => [] }; } });
  await c.syncStoreActualsFromToast('F06', 'g6', c.monthDays());
  fail = false; asked = [];
  c.timers.shift().f(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 1); assert.match(asked[0], /restaurant_guid=eq\.g6/, 'only the store that failed (not F01, never fetched)');
  assert.equal(c.fstStatus('sales').state, 'partial');
  c.fstNote('sales', 'F01', true);
  c.fstNote('sales', 'F06', false); c.timers.shift().f(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.match(c.fstChipsHtml(), /新しい情報を取りました：表示を更新/);
  assert.equal(c.renders.length, 0);
  c.fstShowFresh(); assert.deepEqual(Array.from(c.renders), ['dashboard']); assert.doesNotMatch(c.fstChipsHtml(), /表示を更新/);
});

test('labor reads are noted per store; the strip on dashboard and budget pages, the old strip elsewhere', async () => {
  const c = context({ fetch: async () => ({ ok: false, json: async () => ({}) }) });
  const rows = await c.fetchTipLaborFromDB('g1', '2026-10-01', '2026-10-02'); assert.equal(rows._err, true);
  assert.equal(c.fstStatus('labor').state, 'fail'); assert.match(c.fstChip('labor'), /勤怠：取れませんでした（ToriTon）/);
  for (const scope of ['dash', 'budget']) {
    const h = c.pageSyncStrip(scope);
    assert.match(h, /id="fst-chips"/); assert.match(h, /最新情報を取得/); assert.match(h, /診断/);
  }
  assert.doesNotMatch(c.pageSyncStrip('hr'), /fst-chips/);
});

test('times are shown in Hawaii time, with HST when the device is elsewhere', () => {
  const c = context();
  const now = new Date(), iso = now.toISOString();
  const hm = now.toLocaleTimeString('ja-JP', { timeZone: 'Pacific/Honolulu', hour: '2-digit', minute: '2-digit', hour12: false });
  assert.equal(c.fstClock(iso), hm + (now.getTimezoneOffset() !== 600 ? ' HST' : ''));
  assert.match(c.fstClock('2026-01-02T03:04:00.000Z'), /^1\/1 17:04/);
});

test('the startup notice is gone; budget, meeting and purchase pages rely on the strip', () => {
  const start = source.indexOf('FUNERGY_FINANCIAL_SAVE.refresh(FunergyFinancialTransport.keys)');
  const block = source.slice(start, start + 400);
  assert.doesNotMatch(block, /showToast/); assert.match(block, /fstNote\('guard',null,true\)/); assert.match(block, /fstNote\('guard',null,false/);
  for (const name of ['renderBudget', 'renderMeetingPage', 'renderPurchasePage']) assert.doesNotMatch(fn(name), /syncFreshBadge/, name);
  assert.equal(source.includes("'売上・予算の最新データを確認できません。元の入力を残して、もう一度確認してください。'"), false);
});

// ---- v1105 独立レビュー（a9b2e32c4894cb2e1・cc7830c）の指摘
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

test('review P2: an automatic retry waits while an input form or the budget editor is open (no try is used)', async () => {
  let reads = 0;
  const c = context({ fetch: async () => { reads++; throw Error('offline'); } });
  const overlay = { classList: { contains: k => k === 'open' && overlay.open }, open: true };
  c.document.getElementById = id => id === 'modal-overlay' ? overlay : null;
  await c.syncStoreActualsFromToast('F06', 'g6', c.monthDays()); assert.equal(reads, 1);
  c.timers.shift().f(); await flush();
  assert.equal(reads, 1, 'nothing is fetched (and nothing saved) while the form is open');
  assert.deepEqual(Array.from(c.timers, x => x.ms), [15000], 'the first try is still unused');
  overlay.open = false; c._bbStore = 'F01';
  c.timers.shift().f(); await flush(); assert.equal(reads, 1, 'the budget editor counts as entering');
  c._bbStore = null; c.window.FUNERGY_FINANCIAL_SAVE.getState = () => ({ status: 'unknown' });
  c.timers.shift().f(); await flush(); assert.equal(reads, 1, 'a save waiting for its result counts as entering');
  c.window.FUNERGY_FINANCIAL_SAVE.getState = () => ({ status: 'idle' });
  c.timers.shift().f(); await flush(); assert.equal(reads, 2, 'then it retries');
  assert.deepEqual(Array.from(c.timers, x => x.ms), [30000]);
});

test('review P3: a store never fetched here does not borrow another store\'s time; the retry count is per page; one guard failure is retried once', async () => {
  const c = context();
  c.fstNote('sales', 'F01', true); c.fstNote('sales', 'F06', false, 'toast_sales');
  const chip = c.fstChip('sales');
  assert.match(chip, /取れませんでした（LaLa）/); assert.doesNotMatch(chip, /前回 .* の情報を表示中/); assert.match(chip, /前の情報もありません/);
  c.fstNote('sales', 'F01', false, 'toast_sales');
  assert.match(c.fstChip('sales'), /取れませんでした（ToriTon・LaLa）。前の情報が無い店があります/, 'one failing store had data before, one never');
  // tries are not kept on the device: a new page retries again
  c.fstState().tries.sales = 3; c.fstSave();
  assert.equal(JSON.parse(c.ls.get('_fetch_status_v1')).tries, undefined);
  const again = context(); for (const [k, v] of c.ls) again.ls.set(k, v);
  assert.equal(again.fstState().tries.sales, undefined);
  // a guard failure schedules one retry (budget), which reads the records once
  let refresh = 0;
  const g = context(); g.window.FUNERGY_FINANCIAL_SAVE.refresh = g.FUNERGY_FINANCIAL_SAVE.refresh = async () => { refresh++; throw Error('down'); };
  g.fstNote('sales', 'F01', true); g.fstNote('sales', 'F06', true);
  g.fstNote('guard', null, false, 'financial_read');
  assert.equal(g.timers.length, 1, 'not one timer for sales and one for budget');
  g.timers.shift().f(); await flush();
  assert.equal(refresh, 1);
});

test('review P3: a sales import the guard refused shows in the strip; the dashboard pull does not say "synced" when the month read failed', async () => {
  const c = context();
  c.fstNote('sales', 'F01', true); c.fstNote('sales', 'F06', true);
  c.syncStoreActualsFromToast = async () => ({ error: '保存結果を確認できないため同期を完了していません。' });
  await c.fstSalesSync('F06', 'g6', c.monthDays(), []);
  assert.equal(c.fstStatus('sales').state, 'fail'); assert.match(c.fstChip('sales'), /取れませんでした（LaLa）/);
  c.syncStoreActualsFromToast = async () => ({ updated: 0, fetched: 1 });
  await c.fstSalesSync('F06', 'g6', c.monthDays(), []); c.fstNote('sales', 'F06', true);
  assert.equal(c.fstStatus('sales').state, 'ok');
  // the guard calls onAutoRefused before its notice; the app notes the store and stays quiet during login and automatic retries
  const inst = source.slice(source.indexOf('onAutoRefused:function(name, args){'), source.indexOf('transport:FunergyFinancialTransport.create('));
  assert.match(inst, /fstNote\('sales', args&&args\[0\], false/); assert.match(inst, /return !!window\._fstQuiet/);
  assert.match(fn('loginSyncOps'), /window\._fstQuiet = true[\s\S]*finally \{ window\._fstQuiet = false; \}/);
  assert.match(fn('loginSyncOps'), /await fstSalesSync\(s\.id, s\.toastGuid, days, _toastRows\)/);
  // pull of the dashboard and budget pages
  const meta = source.slice(source.indexOf('var SYNC_SCOPE_META = {'), source.indexOf('\n};', source.indexOf('var SYNC_SCOPE_META = {')) + 3);
  for (const [scope, monthResult, anyFail, expected] of [['dash', { error: 'x' }, false, false], ['dash', undefined, false, undefined], ['budget', { error: 'x' }, false, false], ['budget', undefined, true, false]]) {
    const p = { fstGuardRefresh: async () => true, ensureMonthDataLoaded: async () => monthResult, fstAnyFail: () => anyFail, pullInvoicesAll: async () => {}, curYm: () => '2026-10', console };
    vm.createContext(p); vm.runInContext(meta + '\nvar __m = SYNC_SCOPE_META;', p);
    assert.equal(await p.__m[scope].pull(), expected, scope + ' ' + JSON.stringify(monthResult));
  }
});

test('v1107: the strip says why a sales import was not saved, and points at the yellow bar while a save waits', async () => {
  const c = context();
  c.fstNote('sales', 'F01', true); c.fstNote('sales', 'F06', true);
  c.syncStoreActualsFromToast = async () => ({ error: 'x', code: 'http_500_57014' });
  await c.fstSalesSync('F06', 'g6', c.monthDays(), []);
  assert.equal(c.fstState().sales.by.F06.err, 'save:http_500_57014');
  assert.match(c.fstChip('sales'), /取れませんでした（LaLa）[\s\S]*理由：サーバーのエラー（HTTP 500・57014）/);
  c.syncStoreActualsFromToast = async () => ({ error: 'x', code: 'conflict' });
  await c.fstSalesSync('F06', 'g6', c.monthDays(), []);
  assert.match(c.fstChip('sales'), /理由：ほかの端末の保存と重なりました/);
  c.syncStoreActualsFromToast = async () => ({ error: 'x' });   // 理由の無い前の形
  await c.fstSalesSync('F06', 'g6', c.monthDays(), []);
  assert.doesNotMatch(c.fstChip('sales'), /理由/);
  // 保存の確認待ちのあいだは、帯の保存を先に確かめるように出す（売上・予算とも）
  c.FUNERGY_FINANCIAL_SAVE.getState = () => ({ status: 'unknown' });
  c.fstNote('guard', null, false, 'financial_unresolved_save');
  assert.match(c.fstChip('sales'), /下の黄色い帯の保存を先に確かめてください/);
  assert.match(c.fstChip('budget'), /下の黄色い帯の保存を先に確かめてください/);
});

test('v1107: when the waiting save is settled, failed sales and budget are fetched again after 1 second', async () => {
  const c = context();
  let state = 'unknown'; c.FUNERGY_FINANCIAL_SAVE.getState = () => ({ status: state });
  c.fstNote('sales', 'F01', false, 'save:pending'); c.fstNote('guard', null, false, 'financial_unresolved_save');
  c.fstOnGuardState({ status: 'unknown' });
  const before = c.timers.length;
  state = 'idle'; c.fstOnGuardState({ status: 'idle' });
  const kicks = c.timers.slice(before).filter(x => x.ms === 1000);
  assert.equal(kicks.length, 2);   // 売上と予算
  let refreshed = 0; c.FUNERGY_FINANCIAL_SAVE.refresh = async () => { refreshed++; return []; };
  const synced = []; c.syncStoreActualsFromToast = async id => { synced.push(id); return { updated: 1 }; };
  for (const k of kicks) await k.f();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(refreshed >= 1, true); assert.deepEqual(synced, ['F01']);
  // 片づいていないあいだ（idle → idle）・ログインの同期の途中は、すぐには取り直さない
  const n = c.timers.length; c.fstOnGuardState({ status: 'idle' });
  assert.equal(c.timers.length, n);
  c.fstOnGuardState({ status: 'unknown' }); c.window._fstQuiet = true; c.fstNote('sales', 'F06', false, 'save:pending');
  const m = c.timers.length; c.fstOnGuardState({ status: 'idle' });
  assert.equal(c.timers.slice(m).some(x => x.ms === 1000), false);
  // 保護が保存の状態を伝える口がアプリにある
  const inst = source.slice(source.indexOf('FunergyFinancialSave.install(window, {enabled:true'), source.indexOf('transport:FunergyFinancialTransport.create('));
  assert.match(inst, /onState:function\(s\)\{ try\{ if\(typeof fstOnGuardState==='function'\) fstOnGuardState\(s\);/);
});
