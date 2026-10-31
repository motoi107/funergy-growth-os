// v1126 (UI案65, request ⑦ step 2): the new menu screen (overview / by item / trend) reads Toast item rows for a date
// range (always through yesterday in Hawaii) and counts them the same way on every tab. It only reads (no saving, no sending),
// keeps the previous monthly screen as a tab, and shows days with sales but no item rows instead of hiding them.
// Runs the real code from index.html in a VM with synthetic rows. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const read = src => src.replace(/\r\n/g, '\n');
const source = read(fs.readFileSync(process.env.MENU_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8'));
const sw = read(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'));
function block(src) {
  const a = src.indexOf('\nvar MN_COLORS = ');
  const b = src.indexOf('\n/* v1126：前の画面');
  assert.ok(a > 0 && b > a, 'menu block');
  return src.slice(a + 1, b + 1);
}
function fnFrom(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}

const TODAY = '2026-10-30';
const STORES = [
  { id: 'F01', name: 'Store A', toastGuid: 'gA' },
  { id: 'F02', name: 'Store B', toastGuid: 'gB' },
  { id: 'F09', name: 'Store Z', toastGuid: '' },
];
const RECIPES = [
  { id: 'r1', toastGuid: 'salmon-A', storeId: 'F01', name: 'Salmon bowl', category: 'Bowl', price: 20 },
  { id: 'r2', toastGuid: 'miso-A', storeId: 'F01', name: 'Miso soup', category: 'Soup', price: 4 },
  { id: 'r3', toastGuid: 'beer-A', storeId: 'F01', name: 'Beer', category: 'Drink', price: 8 },
  { id: 'r4', toastGuid: 'old-A', storeId: 'F01', name: 'Old bowl', category: 'Bowl', price: 18, archived: true, archivedAt: '2026/10/18' },
  { id: 'r5', toastGuid: 'salmon-B', storeId: 'F02', name: 'Salmon bowl', category: 'Bowl', price: 20 },
  { id: 'r6', toastGuid: 'tea-all', storeId: null, name: 'Tea', category: 'Drink', price: 3 },
  { id: 'r7', toastGuid: 'free-A', storeId: 'F01', name: 'Water', category: 'Drink', price: 0 },
];
const R = (d, g, n, q, extra) => Object.assign({ business_date: d, item_guid: g, item_name: n, qty: q }, extra || {});
// current month (10/1-10/29) and the same days last month (9/1-9/29)
function rowsA() {
  return [
    R('2026-10-01', 'salmon-A', 'Salmon bowl', 10), R('2026-10-02', 'salmon-A', 'Salmon bowl', 5),
    R('2026-10-20', 'salmon-A', 'Salmon bowl L', 5),             // renamed later in the month
    R('2026-10-02', 'miso-A', 'Miso soup', 20),
    R('2026-10-03', 'beer-A', 'Beer', 6),
    R('2026-10-03', 'old-A', 'Old bowl', 2),                      // ended (recipe archived)
    R('2026-10-08', 'kids-A', 'Kids <b>plate</b>', 4),            // not linked to a recipe; name needs escaping
    R('2026-10-09', 'tea-all', 'Tea', 3),                         // all-store recipe
    R('2026-10-09', 'free-A', 'Water', 2),                        // recipe without a price
  ];
}
const prevA = () => [R('2026-09-01', 'salmon-A', 'Salmon bowl', 16), R('2026-09-05', 'miso-A', 'Miso soup', 25), R('2026-09-06', 'beer-A', 'Beer', 6)];
const rowsB = () => [R('2026-10-04', 'salmon-B', 'Salmon bowl', 7), R('2026-10-04', 'miso-B', 'Miso soup', 3)];   // miso-B: another Toast item with the same name as Store A's
const prevB = () => [R('2026-09-04', 'salmon-B', 'Salmon bowl', 5)];
const salesA = () => [{ business_date: '2026-10-01', net_sales: 900, guest_count: 50 }, { business_date: '2026-10-12', net_sales: 800, guest_count: 40 },   // 10/12: sales but no item rows
  { business_date: '2026-10-13', net_sales: 0, guest_count: 0 }];
const salesB = () => [{ business_date: '2026-10-04', net_sales: 300, guest_count: 20 }];

function app(opts = {}) {
  const c = {
    console, STORES: JSON.parse(JSON.stringify(opts.stores || STORES)), RECIPES: JSON.parse(JSON.stringify(opts.recipes || RECIPES)),
    FETCHES: [], RENDERS: [], TOASTS: [], ROWS: opts.rows || {}, FAIL: opts.fail || {},
    curRole: opts.role || 'gm', curStore: opts.curStore || 'ALL', curLang: opts.lang || 'ja', curPage: 'menu',
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon',
    DRINK: { F01: ['Drink'], F02: ['Drink'] },
  };
  vm.createContext(c);
  vm.runInContext(fnFrom(source, 'recipeInStore') + '\n' + `
    function isTotoyaStore(id){ return /^F04-/.test(id); }
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function getRecipes(){ return RECIPES; }
    function getVisibleStores(){ return STORES; }
    function getKpiConfigFor(id){ return { drinkCats: DRINK[id] || [] }; }
    function bizToday(){ return '${TODAY}'; }
    function getPeriod(){ return '2026.10'; }
    function renderPage(p){ RENDERS.push(p); }
    function renderMenuMonth(){ return '<div class="old-month-screen"></div>'; }
    function showToast(m, k){ TOASTS.push([m, k]); }
    function openItemSalesOverview(){}
    async function fvResyncItemSalesChunked(guid, o){ FETCHES.push({ resync: guid, o: o }); return { okDays: 7, failDays: 0, lastErr: '' }; }
    var document = { activeElement: null, getElementById: function(){ return null; }, body: { classList: { toggle: function(){} } } };
    var window = {};
    function setTimeout(f){ return 0; } function clearTimeout(){}
    async function fetch(url, init){
      FETCHES.push({ url: url, method: (init && init.method) || 'GET' });
      var u = String(url);
      for (var k in FAIL) if (u.indexOf(k) >= 0) return { ok: false, status: 500, json: async function(){ return {}; } };
      for (var k2 in ROWS) if (u.indexOf(k2) >= 0) { var off = +(/offset=(\\d+)/.exec(u)||[0,0])[1]; return { ok: true, json: async function(){ return ROWS[k2].slice(off, off + 1000); } }; }
      return { ok: true, json: async function(){ return []; } };
    }
  ` + '\n' + block(source), c);
  return c;
}
const flush = () => new Promise(r => setImmediate(r));
const rowsFor = (c) => ({
  'toast_item_sales?restaurant_guid=eq.gA&business_date=gte.2026-10-01&business_date=lte.2026-10-29': rowsA(),
  'toast_item_sales?restaurant_guid=eq.gA&business_date=gte.2026-09-01&business_date=lte.2026-09-29': prevA(),
  'toast_item_sales?restaurant_guid=eq.gB&business_date=gte.2026-10-01&business_date=lte.2026-10-29': rowsB(),
  'toast_item_sales?restaurant_guid=eq.gB&business_date=gte.2026-09-01&business_date=lte.2026-09-29': prevB(),
  'toast_sales?restaurant_guid=eq.gA&business_date=gte.2026-10-01&business_date=lte.2026-10-29': salesA(),
  'toast_sales?restaurant_guid=eq.gB&business_date=gte.2026-10-01&business_date=lte.2026-10-29': salesB(),
});
async function loaded(opts = {}) {
  const c = app(Object.assign({ rows: rowsFor() }, opts));
  vm.runInContext('window._mn = ' + JSON.stringify(opts.state || {}) + '; mnState();', c);
  await vm.runInContext('mnRun(mnJobs(mnState()).jobs)', c);
  return c;
}
const model = c => JSON.parse(vm.runInContext('(function(){ var s = mnState(), J = mnJobs(s); var M = mnModel(mnInput(s, J)); return JSON.stringify({ M: M, r: J.r, pr: J.pr }); })()', c));
const item = (M, name) => M.cur.find(it => it.name === name);

test('periods always end yesterday in Hawaii, and the comparison period is the same days last month (or the period before)', () => {
  const c = app();
  const rg = (per, today, f, e) => JSON.parse(JSON.stringify(vm.runInContext(`(function(){ var r = mnRange(${JSON.stringify(per)}, ${JSON.stringify(f || '')}, ${JSON.stringify(e || '')}, ${JSON.stringify(today)}); var p = mnPrevRange(${JSON.stringify(per)}, r); return { r: r, p: p }; })()`, c)));
  let x = rg('month', TODAY); assert.deepEqual([x.r.from, x.r.to, x.r.n], ['2026-10-01', '2026-10-29', 29]); assert.deepEqual([x.p.from, x.p.to], ['2026-09-01', '2026-09-29']);
  x = rg('month', '2026-11-01'); assert.equal(x.r.empty, true, 'the 1st has nothing yet (today is not counted)');
  x = rg('month', '2026-03-31'); assert.deepEqual([x.p.from, x.p.to], ['2026-02-01', '2026-02-28'], 'last month is shorter: up to its last day');
  x = rg('yesterday', TODAY); assert.deepEqual([x.r.from, x.r.to, x.p.from, x.p.to], ['2026-10-29', '2026-10-29', '2026-10-28', '2026-10-28']);
  x = rg('d7', TODAY); assert.deepEqual([x.r.from, x.r.to, x.p.from, x.p.to], ['2026-10-23', '2026-10-29', '2026-10-16', '2026-10-22']);
  x = rg('d30', TODAY); assert.deepEqual([x.r.from, x.r.to, x.r.n], ['2026-09-30', '2026-10-29', 30]);
  x = rg('prev', TODAY); assert.deepEqual([x.r.from, x.r.to, x.p.from, x.p.to], ['2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31']);
  x = rg('custom', TODAY, '2026-10-31', '2026-10-05'); assert.deepEqual([x.r.from, x.r.to], ['2026-10-05', '2026-10-29'], 'future days are cut to yesterday and the order is fixed');
  x = rg('custom', TODAY, '2026-01-01', '2026-10-29'); assert.equal(x.r.n, 93); assert.equal(x.r.cut, true);
  x = rg('custom', TODAY, 'nonsense', ''); assert.deepEqual([x.r.from, x.r.to], ['2026-10-23', '2026-10-29']);
});

test('the screen reads item rows by date (through yesterday), the comparison period and the sales rows, only with GET', async () => {
  const c = await loaded();
  const urls = c.FETCHES.map(f => f.url);
  assert.ok(c.FETCHES.every(f => f.method === 'GET'), 'never writes');
  assert.ok(urls.every(u => /order=(id|business_date)\.asc/.test(u)), 'ordered pages (rows do not repeat or go missing at page edges)');
  assert.ok(urls.some(u => u.includes('toast_item_sales?restaurant_guid=eq.gA&business_date=gte.2026-10-01&business_date=lte.2026-10-29')));
  assert.ok(urls.some(u => u.includes('business_date=gte.2026-09-01&business_date=lte.2026-09-29')));
  assert.ok(!urls.some(u => u.includes('lte.2026-10-30')), 'today is never read');
  assert.ok(!urls.some(u => u.includes('restaurant_guid=eq.&')), 'a store without Toast is not read');
  const n = c.FETCHES.length;
  await vm.runInContext('mnRun(mnJobs(mnState()).jobs.filter(function(j){ return !_mnCache[j.k]; }))', c);
  vm.runInContext('mnKick()', c); await flush();
  assert.equal(c.FETCHES.length, n, 'cached ranges are not read again');
  vm.runInContext('mnReload()', c); vm.runInContext('mnKick()', c); await flush(); await flush();
  assert.ok(c.FETCHES.length > n, '"Reload" reads again');
});

test('totals, category shares, average price and the comparison come from the same rows', async () => {
  const c = await loaded({ state: { store: 'F01' } });
  const { M } = model(c);
  assert.equal(M.money, '', 'no amount column: sales = qty × recipe price');
  assert.equal(M.tq, 10 + 5 + 5 + 20 + 6 + 2 + 4 + 3 + 2);
  assert.equal(M.ts, 20 * 20 + 20 * 4 + 6 * 8 + 2 * 18 + 3 * 3);
  const salmon = M.cur.find(it => it.key === 'salmon-A');
  assert.equal(salmon.qty, 20); assert.equal(salmon.name, 'Salmon bowl L', 'latest name'); assert.equal(salmon.renamed, true);
  assert.deepEqual(Object.keys(salmon.oldNames), ['Salmon bowl']);
  assert.equal(salmon.prevQty, 16); assert.ok(Math.abs(salmon.chg - 0.25) < 1e-9);
  assert.equal(item(M, 'Old bowl').ended, true); assert.equal(item(M, 'Old bowl').archivedAt, '2026/10/18');
  const kids = item(M, 'Kids <b>plate</b>'); assert.equal(kids.cat, '未分類'); assert.equal(kids.isNew, true); assert.equal(kids.drink, false);
  assert.equal(item(M, 'Tea').cat, 'Drink'); assert.equal(item(M, 'Tea').drink, true, 'all-store recipe and the store drink setting');
  assert.equal(item(M, 'Water').priceMissing, true); assert.equal(M.noPrice, 2, 'Water and the unlinked item have no price');
  const sumQ = M.catList.reduce((a, x) => a + x.qty, 0), sumS = M.catList.reduce((a, x) => a + x.sales, 0);
  assert.equal(sumQ, M.tqA); assert.equal(sumS, M.tsA);
  assert.ok(Math.abs(M.catList.reduce((a, x) => a + x.qShare, 0) - 1) < 1e-9);
  const bowl = M.catList.find(x => x.name === 'Bowl'); assert.equal(bowl.qty, 22); assert.ok(Math.abs(bowl.avg - (400 + 36) / 22) < 1e-9);
  assert.equal(M.catList[M.catList.length - 1].name, '未分類', 'uncategorized is listed last');
  assert.equal(M.pq, 47); assert.ok(Math.abs(M.qChg - (57 / 47 - 1)) < 1e-9);
  assert.equal(M.newCount, 4, 'Old bowl, Kids, Tea and Water were not sold in the comparison period');
  assert.equal(M.guests, 50, 'guests only on days that have item rows');
  assert.deepEqual(M.missing.map(m => [m.store, m.date]), [['F01', '2026-10-12']], 'sales but no item rows; a 0-sales day is not missing');
  const d12 = M.days.find(d => d.d === '2026-10-12'); assert.equal(d12.partial, true);
  assert.equal(M.days.length, 29);
  assert.equal(M.days.reduce((a, d) => a + d.food + d.drink, 0), M.tq);
  assert.equal(M.weeks.length, 5); assert.deepEqual([M.weeks[4].from, M.weeks[4].to, M.weeks[4].n], ['2026-10-29', '2026-10-29', 1]);
  assert.equal(M.weekMix.reduce((a, w) => a + w.tq, 0), M.tqA);
});

test('an amount column, when the table has one, is used for sales instead of qty × price', async () => {
  const rows = rowsFor();
  const k = 'toast_item_sales?restaurant_guid=eq.gA&business_date=gte.2026-10-01&business_date=lte.2026-10-29';
  rows[k] = rows[k].map(r => Object.assign({}, r, { net_sales: r.qty * 1.5 }));
  const c = await loaded({ rows, state: { store: 'F01' } });
  const { M } = model(c);
  assert.equal(M.money, 'net_sales');
  assert.equal(M.ts, 57 * 1.5); assert.equal(M.noPrice, 0);
});

test('all stores join the same menu by name; one store keeps each Toast item apart', async () => {
  const c = await loaded({ state: { store: 'ALL' } });
  const { M } = model(c);
  const salmon = M.cur.filter(it => /^Salmon bowl/.test(it.name));
  assert.equal(salmon.length, 2, 'renamed "Salmon bowl L" (Store A) and "Salmon bowl" (Store B)');
  const b = salmon.find(it => it.name === 'Salmon bowl'); assert.equal(b.qty, 7); assert.deepEqual(Object.keys(b.stores), ['F02']);
  assert.equal(M.tq, 57 + 7 + 3);
  assert.equal(M.guests, 70);
  const miso = M.cur.filter(it => it.name === 'Miso soup');
  assert.equal(miso.length, 1, 'same name in two stores is one row'); assert.equal(miso[0].qty, 23); assert.deepEqual(Object.keys(miso[0].stores).sort(), ['F01', 'F02']);
  assert.equal(miso[0].cat, 'Soup', 'the linked category wins over an unlinked one');
  const ids = vm.runInContext('mnJobs(mnState()).stores.map(function(x){ return x.id; })', c);
  assert.deepEqual([...ids], ['F01', 'F02'], 'Store Z has no Toast and is not read');
});

test('type, category, name search, chips and sort narrow the lists without changing the category shares', async () => {
  const c = await loaded({ state: { store: 'F01' } });
  const set = s => vm.runInContext('Object.assign(window._mn, ' + JSON.stringify(s) + ')', c);
  set({ kind: 'drink' }); let M = model(c).M;
  assert.deepEqual(M.B.map(x => x.name).sort(), ['Beer', 'Tea', 'Water']);
  set({ kind: 'food' }); M = model(c).M;
  assert.ok(M.B.every(x => !x.drink)); assert.ok(M.B.some(x => x.cat === '未分類'), 'uncategorized counts as food');
  set({ kind: 'all', cat: 'Bowl' }); M = model(c).M;
  assert.deepEqual(M.B.map(x => x.name).sort(), ['Old bowl', 'Salmon bowl L']);
  assert.ok(M.catList.length > 1, 'the category list stays (cards can switch)');
  assert.equal(M.tq, 22);
  set({ cat: '', q: 'salmon bowl' }); M = model(c).M; assert.deepEqual(M.rows.map(x => x.name), ['Salmon bowl L']);
  set({ q: 'SALMON BOWL', chip: 'renamed' }); M = model(c).M; assert.equal(M.rows.length, 1);
  set({ q: '', chip: 'ended' }); M = model(c).M; assert.deepEqual(M.rows.map(x => x.name), ['Old bowl']);
  set({ chip: 'unc' }); M = model(c).M; assert.deepEqual(M.rows.map(x => x.name), ['Kids <b>plate</b>']);
  set({ chip: 'new', sort: 'name' }); M = model(c).M; assert.deepEqual(M.rows.map(x => x.name), ['Kids <b>plate</b>', 'Old bowl', 'Tea', 'Water']);
  set({ chip: 'all', sort: 'down' }); M = model(c).M; assert.equal(M.rows[0].name, 'Miso soup', 'biggest decrease first (25 → 20)');
  set({ sort: 'sales' }); M = model(c).M; assert.equal(M.rows[0].name, 'Salmon bowl L');
});

test('a store that could not be read is left out and named; a failed comparison hides changes instead of showing them as new', async () => {
  const c = await loaded({ state: { store: 'ALL' }, fail: { 'toast_item_sales?restaurant_guid=eq.gB&business_date=gte.2026-10-01': 1 } });
  let M = model(c).M;
  assert.deepEqual(M.failed.map(x => x.id), ['F02']);
  assert.equal(M.tq, 57);
  assert.ok(!M.missing.some(m => m.store === 'F02'), 'a store that could not be read is not reported as missing days either');
  assert.equal(M.guests, 50);
  const html = vm.runInContext('mnBodyHtml(mnState())', c);
  assert.match(html, /読み込めなかった店があります/); assert.match(html, /Store B/);
  const c2 = await loaded({ state: { store: 'F01' }, fail: { 'restaurant_guid=eq.gA&business_date=gte.2026-09-01': 1 } });
  M = model(c2).M;
  assert.equal(M.prevOk, false); assert.equal(M.newCount, null); assert.equal(M.qChg, null);
  assert.ok(M.cur.every(it => it.chg === null && it.isNew === false));
  assert.match(vm.runInContext('mnBodyHtml(mnState())', c2), /増減・新しいメニューは出していません/);
});

test('the three tabs render with escaped names; the monthly tab keeps the previous screen', async () => {
  const c = await loaded({ state: { store: 'F01' } });
  const page = tab => { vm.runInContext(`window._mn.tab = '${tab}'`, c); return vm.runInContext('renderMenu()', c); };
  let h = page('overview');
  assert.match(h, /出数/); assert.match(h, /カテゴリー別の割合/); assert.match(h, /出数 vs 売上/);
  assert.match(h, /10\/29（木）までの数字/);
  assert.match(h, /1 店・1 日の出数がまだ入っていません/); assert.match(h, /その日を取り直す/);
  assert.match(h, /出数 × レシピの売価/);
  assert.ok(!h.includes('<b>plate</b>'), 'item names are escaped'); assert.ok(h.includes('Kids &lt;b&gt;plate&lt;/b&gt;'));
  h = page('items');
  assert.match(h, /出数 vs 売価/); assert.match(h, /mn-table/); assert.match(h, /先月の同じ日数より/);
  assert.match(h, /名前が変わった/); assert.match(h, /販売終了 10\/18/); assert.match(h, /前の名前：Salmon bowl/);
  h = page('trend');
  assert.match(h, /日ごとの出数/); assert.equal((h.match(/class="mn-day"/g) || []).length, 29); assert.match(h, /mn-part/);
  assert.match(h, /メニューごとの推移/);
  h = page('month');
  assert.match(h, /old-month-screen/); assert.ok(!h.includes('id="mn-body"'));
  c.curLang = 'en'; h = page('overview');
  assert.match(h, /Through 10\/29 \(Thu\)/); assert.match(h, /Items sold are missing for 1 store-day\(s\)/);
});

test('re-import of missing days is for GM, accounting and CEO only, and asks Toast only as far back as needed', async () => {
  const c = await loaded({ state: { store: 'F01' } });
  c.curRole = 'sl';
  assert.match(vm.runInContext('mnBodyHtml(mnState())', c), /GM・経理に伝えてください/);
  await vm.runInContext('mnResync()', c);
  assert.equal(c.FETCHES.filter(f => f.resync).length, 0);
  c.curRole = 'gm';
  await vm.runInContext('mnResync()', c);
  const rs = c.FETCHES.filter(f => f.resync);
  assert.equal(rs.length, 1); assert.equal(rs[0].resync, 'gA');
  assert.deepEqual(JSON.parse(JSON.stringify(rs[0].o)), { chunk: 7, total: 21 }, '10/12 is 17 days before 10/30: three 7-day chunks');
});

test('the screen only reads: no saving, no sending, no menu counts written', () => {
  const b = block(source);
  for (const bad of ['lsSet(', 'setMenuMix(', 'menuMixApply(', "method: 'POST'", 'method:"POST"', "method:'POST'", 'opMergePush(', '_lsPush']) assert.ok(!b.includes(bad), bad);
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInContext('MN_COLORS', app()))),
    ['#eb6834', '#1baf7a', '#eda100', '#256abf', '#e87ba4', '#008300', '#6250d6', '#e34948'], 'the validated category palette');
});

test('the previous monthly screen is unchanged and both page renderers widen the page for the new tabs', () => {
  const now = fnFrom(source, 'renderMenuMonth').replace('function renderMenuMonth()', 'function renderMenu()');
  let before = '';
  try { before = read(execFileSync('git', ['show', '6bcf6cd:index.html'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 64 << 20 })); } catch (e) { }
  if (before) assert.equal(now, fnFrom(before, 'renderMenu'), 'v1125 renderMenu body');
  assert.equal((source.match(/document\.body\.classList\.toggle\('mn-wide', page === 'menu'/g) || []).length, 2);
  const av = /const APP_VERSION = '(\d+)'/.exec(source)[1], sv = /const SW_BUILD = '(\d+)'/.exec(sw)[1];
  assert.equal(av, sv); assert.ok(Number(av) >= 1126);
});
