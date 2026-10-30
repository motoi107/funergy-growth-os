// v1124 (request ⑦, step 1): the Toast sync and the login / month load turn Toast item rows into menu counts the same way.
// Daily rows for the same item are added up (the Toast sync used to keep only the last day's count), only days before
// today in Hawaii are counted, monthly rows are not added on top of daily rows, and an unchanged result is not written again.
// Runs the real functions from index.html in a VM with synthetic Toast rows. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const read = src => src.replace(/\r\n/g, '\n');
const source = read(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
function fnFrom(src, name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = src.indexOf('\n}', start + 1);
  return src.slice(start + 1, end + 2);
}
const fn = name => fnFrom(source, name);

const TODAY = '2026-10-30';   // Hawaii
const RECIPES = [
  { id: 'r-own', toastGuid: 'g-ramen', storeId: 'F04-K', price: 15 },
  { id: 'r-common-shadowed', toastGuid: 'g-ramen', storeId: 'TOTOYA', price: 99 },   // same GUID as the store's own recipe: not used
  { id: 'r-common', toastGuid: 'g-gyoza', storeId: 'TOTOYA', price: 8 },               // Totoya common recipe: used
  { id: 'r-all', toastGuid: 'g-tea', storeId: null, price: 3 },                        // all-store recipe: used
  { id: 'r-manual', storeId: 'F04-K', price: 10 },                                     // no Toast GUID: entered by hand
  { id: 'r-other', toastGuid: 'g-other', storeId: 'F01', price: 12 },                  // another store
];
const daily = [
  { business_date: '2026-10-28', item_guid: 'g-ramen', item_name: 'Ramen', qty: 10 },
  { business_date: '2026-10-29', item_guid: 'g-ramen', item_name: 'Ramen', qty: 12 },
  { business_date: '2026-10-28', item_guid: 'g-gyoza', item_name: 'Gyoza', qty: 4 },
  { business_date: '2026-10-29', item_guid: 'g-gyoza', item_name: 'Gyoza', qty: 6 },
  { business_date: '2026-10-29', item_guid: 'g-tea', item_name: 'Tea', qty: 2.5 },
  { business_date: '2026-10-29', item_guid: 'g-unknown', item_name: 'New item', qty: 3 },
  { business_date: TODAY, item_guid: 'g-ramen', item_name: 'Ramen', qty: 5 },          // today's partial count
  { item_guid: 'g-ramen', item_name: 'Ramen (monthly row)', qty: 400 },               // a monthly row next to daily rows
];

function app(src = source) {
  const pick = name => fnFrom(src, name);
  const c = { console, STORE: {}, SALES: [], WRITES: [], TOASTS: [], RECIPES: JSON.parse(JSON.stringify(RECIPES)) };
  vm.createContext(c);
  const own = ['menuMixFromSales', 'menuMixDayLabel', 'menuMixUpTo', 'menuMixApply'].filter(n => src.includes('\nfunction ' + n + '('));
  vm.runInContext([...own, 'loadMenuMixFromDB', 'syncMenuFromToast', 'recipeInStore'].map(pick).join('\n') + `
    function isTotoyaStore(id){ return /^F04-/.test(id); }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function getRecipes(){ return JSON.parse(JSON.stringify(RECIPES)); }
    function setRecipes(r){ RECIPES = JSON.parse(JSON.stringify(r)); }
    function theoMixKey(s, p){ return 'menu_mix_'+s+'_'+p; }
    function getMenuMix(s, p){ return ls(theoMixKey(s, p), {items:{}, sales:0}); }
    function setMenuMix(s, p, d){ WRITES.push(theoMixKey(s, p)); STORE[theoMixKey(s, p)] = JSON.parse(JSON.stringify(d)); }
    function nowJP(){ return '2026/10/30 9:00'; }
    function bizToday(){ return '${TODAY}'; }
    async function fetchToastItemSales(){ return JSON.parse(JSON.stringify(SALES)); }
    async function syncToastMenuFetch(){}
    async function fetchToastMenuItems(){ return [{ guid:'g-ramen', name:'Ramen', category:'Noodle', price:15 }]; }
    function addMenuLog(){}`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const mixOf = c => c.STORE['menu_mix_F04-K_2026.10'];

test('the Toast sync adds up the daily rows (v1123 kept only the last day) and matches the login load', async () => {
  const c = app();
  c.SALES = daily;
  const r = await run(c, `syncMenuFromToast('F04-K', 'guid-k', '2026.10')`);
  const items = mixOf(c).items;
  assert.deepEqual({ ...items }, { 'r-own': 22, 'r-common': 10, 'r-all': 2.5 });
  assert.equal(mixOf(c).sales, 22 * 15 + 10 * 8 + 2.5 * 3);
  assert.equal(r.mixUpdated, 3);
  assert.equal(r.mixLastDay, '2026-10-29');
  assert.equal(r.mixTodayRows, 1);

  const c2 = app();
  c2.SALES = daily;
  const l = await run(c2, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.deepEqual({ ...mixOf(c2).items }, { ...items }, 'login load and Toast sync give the same counts');
  assert.equal(l.mode, 'daily');
  assert.equal(l.days, 2);
  assert.equal(l.lastDay, '2026-10-29');
  assert.equal(l.todayRows, 1);
  assert.equal(l.skippedMonthly, 1);
  assert.equal(l.unmatchedCount, 1);
  assert.deepEqual([...l.unmatchedNames], ['New item']);

  // The v1123 Toast sync from git history kept the last row's count per item (the monthly row here).
  let old;
  try { old = read(execFileSync('git', ['show', 'HEAD:index.html'], { cwd: new URL('..', import.meta.url), maxBuffer: 64 << 20 }).toString('utf8')); }
  catch (e) { return; }
  if (old.includes('function menuMixFromSales(')) return;   // HEAD already has the fix (after commit)
  const o = app(old);
  o.SALES = daily;
  await run(o, `syncMenuFromToast('F04-K', 'guid-k', '2026.10')`);
  assert.notEqual(mixOf(o).items['r-own'], 22, 'the old Toast sync did not add up the days');
});

test('only days before today in Hawaii are counted; the 1st of the month writes nothing for that month', async () => {
  const c = app();
  c.SALES = daily.filter(x => x.business_date);
  const r = run(c, `menuMixFromSales('F04-K', SALES, '${TODAY}')`);
  assert.equal(r.acc['r-own'], 22);
  assert.equal(r.todayRows, 1);
  assert.deepEqual([...r.days], ['2026-10-28', '2026-10-29']);

  const first = run(c, `menuMixFromSales('F04-K', [{ business_date:'2026-11-01', item_guid:'g-ramen', qty:3 }], '2026-11-01')`);
  assert.deepEqual({ ...first.acc }, {});
  assert.equal(first.todayRows, 1);
  c.SALES = [{ business_date: '2026-11-01', item_guid: 'g-ramen', qty: 3 }];
  const s = await run(c, `syncMenuFromToast('F04-K', 'guid-k', '2026.11')`);
  assert.equal(s.mixUpdated, 0);
  assert.equal(s.mixTodayRows, 1);
  assert.equal(c.STORE['menu_mix_F04-K_2026.11'], undefined, 'no counts for a day that is not over');
});

test('monthly rows are used only when there are no daily rows', async () => {
  const c = app();
  c.SALES = [{ item_guid: 'g-ramen', qty: 300 }, { item_guid: 'g-ramen', qty: 20 }, { item_guid: 'g-gyoza', qty: 50 }];
  const l = await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(l.mode, 'monthly');
  assert.deepEqual({ ...mixOf(c).items }, { 'r-own': 320, 'r-common': 50 });
  assert.equal(l.lastDay, null);
});

test('a store\'s own recipe wins over a common recipe with the same GUID; other stores are not touched', () => {
  const c = app();
  const r = run(c, `menuMixFromSales('F04-K', [{ business_date:'2026-10-29', item_guid:'g-ramen', qty:1 }, { business_date:'2026-10-29', item_guid:'g-other', qty:9 }], '${TODAY}')`);
  assert.deepEqual({ ...r.acc }, { 'r-own': 1 });
  assert.equal(Object.keys(r.unmatched).length, 1, 'the other store\'s item has no recipe here');
  const f01 = run(c, `menuMixFromSales('F01', [{ business_date:'2026-10-29', item_guid:'g-other', qty:9 }, { business_date:'2026-10-29', item_guid:'g-ramen', qty:1 }], '${TODAY}')`);
  assert.deepEqual({ ...f01.acc }, { 'r-other': 9 }, 'Totoya recipes are not used for F01');
});

test('an unchanged result is not written again; a change is written; hand-entered counts stay', async () => {
  const c = app();
  c.STORE['menu_mix_F04-K_2026.10'] = { items: { 'r-manual': 7 }, sales: 70 };
  c.SALES = daily;
  await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(c.WRITES.length, 1);
  assert.equal(mixOf(c).items['r-manual'], 7, 'a recipe without Toast rows keeps its hand-entered count');
  const second = await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(c.WRITES.length, 1, 'the same counts are not written and sent again');
  assert.equal(second.written, false);
  c.SALES = daily.concat([{ business_date: '2026-10-29', item_guid: 'g-tea', qty: 1 }]);
  const third = await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(c.WRITES.length, 2);
  assert.equal(third.written, true);
  assert.equal(mixOf(c).items['r-all'], 3.5);
});

test('the result messages say the counts are up to yesterday in Hawaii', () => {
  const c = app();
  assert.equal(run(c, `menuMixDayLabel('2026-10-29')`), '10/29');
  assert.equal(run(c, `menuMixUpTo('2026-10-29')`), '10/29まで（ハワイ時間の昨日まで）');
  assert.equal(run(c, `menuMixUpTo('2026-09-30')`), '9/30まで', 'a past month: just the date');
  const ensure = fn('ensureMenuMixLoaded');
  assert.match(ensure, /menuMixUpTo\(_r\.lastDay\)/);
  assert.match(ensure, /今日の分は明日から入ります/);
  const sync = fn('doMenuSync');
  assert.match(sync, /menuMixUpTo\(r\.mixLastDay\)/);
  assert.match(sync, /出数は今日の分だけでした/);
});

test('"出数を同期" also re-reads a past month that was already loaded once', async () => {
  const c = app();
  vm.runInContext(fn('ensureMenuMixLoaded') + `
    var STORES = [{ id:'F04-K', toastGuid:'guid-k' }], curPage = 'home';
    function isFrozenMonth(ym){ return ym < '2026-10'; }
    function lsSet(k, v){ STORE[k] = v; }
    function showToast(m, k){ TOASTS.push([m, k]); }
    function renderPage(){}`, c);
  c.SALES = [{ business_date: '2026-09-29', item_guid: 'g-ramen', qty: 4 }, { business_date: '2026-09-30', item_guid: 'g-ramen', qty: 6 }];
  await run(c, `ensureMenuMixLoaded('F04-K', '2026.9')`);
  assert.equal(c.STORE['menu_mix_F04-K_2026.9'].items['r-own'], 10);
  assert.equal(c.STORE['menumixloaded_F04-K_2026.9'], true);
  c.SALES = c.SALES.concat([{ business_date: '2026-09-28', item_guid: 'g-ramen', qty: 5 }]);
  await run(c, `ensureMenuMixLoaded('F04-K', '2026.9')`);
  assert.equal(c.STORE['menu_mix_F04-K_2026.9'].items['r-own'], 10, 'a frozen past month is not re-read on its own');
  await run(c, `ensureMenuMixLoaded('F04-K', '2026.9', { notify:true })`);
  assert.equal(c.STORE['menu_mix_F04-K_2026.9'].items['r-own'], 15, 'pressing the button re-reads it');
  assert.match(c.TOASTS.at(-1)[0], /日別 3日分・9\/30まで）/);
});
