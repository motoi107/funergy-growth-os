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
  'fstChipsHtml', 'fstPaint', 'fstShowFresh', 'fstAuto', 'fstGuardRefresh', 'fstRetry', 'fstAnyFail', 'pageSyncStrip', '_toastSalesErr', 'fetchToastSales',
  'syncStoreActualsFromToast', 'fetchTipLaborFromDB', '_fstLabor', '_tipLaborFetchErr'];
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
  vm.runInContext(line(/^var FST_KEY=.*$/m) + '\n' + line(/^var _fst=null.*$/m) + '\n' + NAMES.map(fn).join('\n'), ctx);
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
