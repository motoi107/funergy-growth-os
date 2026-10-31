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
const source = read(fs.readFileSync(process.env.MENU_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8'));
function fnFrom(src, name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = src.indexOf('\n}', start + 1);
  return src.slice(start + 1, end + 2);
}
const fn = name => fnFrom(source, name);
// The real menu-count storage: per-item stamps (_im), setMenuMix and mergeMenuMix (v834).
function storageFrom(src) {
  const start = src.indexOf('\nfunction _mmItems(');
  assert.ok(start >= 0, '_mmItems');
  const set = src.indexOf('\nfunction setMenuMix(', start);
  assert.ok(set > start, 'setMenuMix');
  return src.slice(start + 1, src.indexOf('\n}', set + 1) + 2);
}

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
  vm.runInContext([...own, 'loadMenuMixFromDB', 'syncMenuFromToast', 'recipeInStore'].map(pick).join('\n') + '\n' + storageFrom(src) + `
    var NOW_ = 1000, TODAY_ = '${TODAY}';
    Date.now = function(){ return NOW_++; };   // the clock moves on every read (a real write never has one fixed time)
    function isTotoyaStore(id){ return /^F04-/.test(id); }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ WRITES.push(k); STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function myName(){ return 'tester'; }
    function getRecipes(){ return JSON.parse(JSON.stringify(RECIPES)); }
    function setRecipes(r){ RECIPES = JSON.parse(JSON.stringify(r)); }
    function theoMixKey(s, p){ return 'menu_mix_'+s+'_'+p; }
    function getMenuMix(s, p){ return ls(theoMixKey(s, p), {items:{}, sales:0}); }
    function nowJP(){ return '2026/10/30 9:00'; }
    function bizToday(){ return TODAY_; }
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

// Codex / Claude on PR #114 (fbc4bd8) P2: a count put in by Toast that is not in "up to yesterday" stayed (v1123 had saved
// today's partial count). From v1124 each count put in by Toast is remembered with the item's stamp (_auto: { n, t });
// such a count is taken out when it is not in the new count and nobody has changed it since (same number, same stamp).
// Codex on 65bdac0 P2: an old record (v1123, no _auto) cannot tell Toast counts from counts a person entered or corrected,
// so nothing in it is taken out.
const hand = (c, period, rid, n) => run(c, `NOW_ += 1000; (function(){ var m = getMenuMix('F04-K', '${period}'); if (${n} > 0) m.items['${rid}'] = ${n}; else delete m.items['${rid}']; setMenuMix('F04-K', '${period}', m); })()`);

test('an old record (v1123, no _auto) keeps every count, also a Toast-linked count corrected by hand with no rows now (Codex 65bdac0)', async () => {
  for (const how of ['load', 'sync']) {
    const c = app();
    // v1123: Toast filled the month (toastSrc), a person corrected tea to 6, ramen has today's partial count, a recipe without Toast
    c.STORE['menu_mix_F04-K_2026.10'] = { items: { 'r-own': 5, 'r-all': 6, 'r-manual': 7 }, sales: 163, toastSrc: true };
    c.SALES = [{ business_date: TODAY, item_guid: 'g-ramen', item_name: 'Ramen', qty: 5 }];   // only today's rows so far
    const r = how === 'load' ? await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`) : await run(c, `syncMenuFromToast('F04-K', 'guid-k', '2026.10')`);
    if (how === 'load') assert.equal(r.written, false);
    assert.deepEqual({ ...mixOf(c).items }, { 'r-own': 5, 'r-all': 6, 'r-manual': 7 }, how + ': nothing is taken out of an old record');
    // rows for gyoza and ramen before today, still none for tea: the corrected tea stays, ramen gets the count up to yesterday
    c.SALES = daily.filter(x => x.item_guid !== 'g-tea');
    await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
    assert.deepEqual({ ...mixOf(c).items }, { 'r-own': 22, 'r-common': 10, 'r-all': 6, 'r-manual': 7 }, how);
    assert.deepEqual(Object.keys(mixOf(c)._auto).sort(), ['r-common', 'r-own'], how + ': only the counts put in now are marked as Toast counts');
  }
  // the next day the partial count of a day is replaced by the whole day
  const n = app();
  n.STORE['menu_mix_F04-K_2026.10'] = { items: { 'r-own': 5 }, sales: 75, toastSrc: true };
  n.SALES = [{ business_date: TODAY, item_guid: 'g-ramen', qty: 9 }];
  n.TODAY_ = '2026-10-31';
  await run(n, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(mixOf(n).items['r-own'], 9);
  // a mark that is only a number (a build before this fix, never released) is not trusted either, and is dropped on the next write
  const u = app();
  u.STORE['menu_mix_F04-K_2026.10'] = { items: { 'r-own': 5, 'r-all': 2.5, 'r-manual': 7 }, sales: 152.5, toastSrc: true, _auto: { 'r-own': 5, 'r-all': 2.5, 'r-manual': 7 } };
  u.SALES = daily.filter(x => x.item_guid === 'g-gyoza');
  await run(u, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.deepEqual({ ...mixOf(u).items }, { 'r-own': 5, 'r-all': 2.5, 'r-manual': 7, 'r-common': 10 });
  assert.deepEqual(Object.keys(mixOf(u)._auto), ['r-common']);
  // a month never filled from Toast (all by hand) is not touched either
  const h = app();
  h.STORE['menu_mix_F04-K_2026.10'] = { items: { 'r-own': 9, 'r-manual': 7 }, sales: 205 };
  h.SALES = [{ business_date: TODAY, item_guid: 'g-ramen', qty: 5 }];
  assert.equal((await run(h, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`)).written, false);
  assert.deepEqual({ ...h.STORE['menu_mix_F04-K_2026.10'].items }, { 'r-own': 9, 'r-manual': 7 });
});

test('from v1124 a Toast count that drops out is taken out; one changed by hand afterwards stays, even back to the same number', async () => {
  const c = app();
  c.SALES = daily;
  await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  const t0 = mixOf(c)._im['r-all'];
  assert.deepEqual(JSON.parse(JSON.stringify(mixOf(c)._auto)), { 'r-own': { n: 22, t: t0 }, 'r-common': { n: 10, t: t0 }, 'r-all': { n: 2.5, t: t0 } }, 'the mark carries the item stamp');
  hand(c, '2026.10', 'r-all', 4);   // someone corrects tea by hand (2.5 → 4) ...
  hand(c, '2026.10', 'r-common', 3);
  hand(c, '2026.10', 'r-common', 10);   // ... and puts gyoza back to the number Toast had: still a change made by a person
  // the next read has no gyoza and no tea rows before today (e.g. rows put right in Toast)
  c.SALES = daily.filter(x => x.item_guid !== 'g-gyoza' && x.item_guid !== 'g-tea');
  const n = c.WRITES.length;
  await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.deepEqual({ ...mixOf(c).items }, { 'r-own': 22, 'r-common': 10, 'r-all': 4 }, 'counts changed by hand stay');
  assert.deepEqual(Object.keys(mixOf(c)._auto), ['r-own'], 'counts changed by hand are no longer marked as Toast counts');
  // an untouched Toast count that drops out goes
  c.SALES = daily.filter(x => x.item_guid !== 'g-ramen');
  await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(mixOf(c).items['r-own'], undefined, 'ramen (from Toast, unchanged) is out');
  assert.equal(mixOf(c).items['r-common'], 10);
  assert.equal(mixOf(c).sales, 10 * 8 + 2.5 * 3);
  assert.equal(mixOf(c)._auto['r-own'], undefined, 'no Toast mark is left for a count taken out');
  // nothing changes on the next read: not written again
  const w = c.WRITES.length;
  await run(c, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(c.WRITES.length, w);
  assert.ok(w > n);
  // a recipe of another store with a count here is not touched (only this store's linked recipes are taken out)
  const r = run(c, `menuMixFromSales('F04-K', SALES, '${TODAY}')`);
  assert.equal([...r.linked].sort().join(','), 'r-all,r-common,r-own');
  // the case from the review: Toast counts saved by v1124, then only today's rows (nothing before today): they are taken out
  const t = app();
  t.SALES = daily;
  await run(t, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  t.SALES = [{ business_date: TODAY, item_guid: 'g-ramen', qty: 5 }];
  assert.equal((await run(t, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`)).written, true);
  assert.deepEqual({ ...mixOf(t).items }, {});
});

test('a count corrected on another device survives the merge: the Toast mark of the other device does not match its stamp', async () => {
  const a = app();
  a.SALES = daily;
  await run(a, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  const cloud = JSON.parse(JSON.stringify(mixOf(a)));
  // device B has the cloud copy and corrects tea 2.5 → 3 → 2.5 by hand (back to the Toast number)
  const b = app();
  b.STORE['menu_mix_F04-K_2026.10'] = cloud;
  b.NOW_ = 5000; hand(b, '2026.10', 'r-all', 3); hand(b, '2026.10', 'r-all', 2.5);
  // device A writes later (a new Toast count for ramen), then takes B's record in: A's record is the newer one, so its _auto is kept
  a.NOW_ = 9000;
  a.SALES = daily.concat([{ business_date: '2026-10-29', item_guid: 'g-ramen', qty: 1 }]);
  await run(a, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  a.B_ = mixOf(b);
  run(a, `STORE['menu_mix_F04-K_2026.10'] = mergeMenuMix(B_, getMenuMix('F04-K', '2026.10'))`);
  assert.equal(mixOf(a).items['r-all'], 2.5);
  assert.ok(mixOf(a)._im['r-all'] > mixOf(a)._auto['r-all'].t, 'the item stamp is from B\'s change');
  // no tea rows now: the count B set by hand stays
  a.SALES = daily.filter(x => x.item_guid !== 'g-tea');
  await run(a, `loadMenuMixFromDB('F04-K', 'guid-k', '2026-10')`);
  assert.equal(mixOf(a).items['r-all'], 2.5, 'the count set by hand on B stays');
});
