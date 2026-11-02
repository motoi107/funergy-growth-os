// v1129 (11/01 request ②): visit types (FT/RP/SR — the Toast menu group "Customers", the same rule as hyper-worker)
// are not counted as menu items in the monthly item counts (menu_mix), whatever screen reads them.
// The order rows (toast_item_sales) and the visit-type counts used for the repeat rate are not touched.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fnFrom(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i + 1, j + 1); }
const VISIT = between('\nvar VISIT_TYPE_GROUPS = ', '\n/* 月の出数：来店区分のレシピの数は読むときに外す');

function app(recipes, store) {
  const c = { RECIPES: recipes, STORE: store || {}, WRITES: [] };
  vm.createContext(c);
  vm.runInContext(VISIT + fnFrom('getMenuMix') + fnFrom('theoMixKey') + fnFrom('menuMixFromSales') + fnFrom('menuMixApply') + fnFrom('menuMixAutoOk') + `
    function getRecipes(){ return RECIPES; }
    function recipeInStore(r, id){ return !r.storeId || r.storeId === id; }
    function getPeriod(){ return '2026.10'; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : d; }
    function _mmStamps(m){ return (m && m._im) || {}; }
    function nowJP(){ return 'now'; }
    function setMenuMix(sid, p, data, at){ WRITES.push(JSON.parse(JSON.stringify(data))); STORE[theoMixKey(sid, p)] = data; }
  `, c);
  return c;
}
const R = [
  { id: 'r1', toastGuid: 'g1', storeId: 'F01', name: 'Salmon', category: 'Bowl', price: 20 },
  { id: 'rft', toastGuid: 'gft', storeId: 'F01', name: 'FT', category: 'Customers', price: 0 },
  { id: 'rrp', toastGuid: 'grp', storeId: 'F01', name: 'RP', category: ' CUSTOMERS', price: 0 },
  { id: 'rfts', toastGuid: 'gfts', storeId: 'F01', name: 'FT Special', category: 'Appetizers', price: 12 },   // not by name
  { id: 'rfree', toastGuid: 'gfree', storeId: 'F01', name: 'Free tea', category: 'Drink', price: 0 },      // not by price
  { id: 'rman', storeId: 'F01', name: 'Hand-made', category: 'Customers', price: 3 },                      // no Toast link: not a visit type
];

test('the monthly item counts leave visit types out on reading (old saved counts too), and the next write removes them', () => {
  const c = app(R, { 'menu_mix_F01_2026.10': { items: { r1: 10, rft: 50, rrp: 40, rfts: 2, rfree: 3, rman: 1 }, sales: 200, _im: { r1: 1, rft: 1, rrp: 1 } } });
  const m = JSON.parse(vm.runInContext("JSON.stringify(getMenuMix('F01', '2026.10'))", c));
  assert.deepEqual(m.items, { r1: 10, rfts: 2, rfree: 3, rman: 1 });
  assert.equal(m.sales, 200); assert.deepEqual(m._im, { r1: 1, rft: 1, rrp: 1 }, 'other fields stay');
  assert.deepEqual(c.STORE['menu_mix_F01_2026.10'].items.rft, 50, 'reading does not change what is saved');
  // building from the order rows: visit types do not enter
  const rows = [{ business_date: '2026-10-01', item_guid: 'g1', qty: 4 }, { business_date: '2026-10-01', item_guid: 'gft', qty: 30 }, { business_date: '2026-10-02', item_guid: 'grp', qty: 9 },
    { business_date: '2026-10-02', item_guid: 'gfts', qty: 1 }, { business_date: '2026-10-02', item_guid: 'gfree', qty: 2 }];
  const r = JSON.parse(vm.runInContext(`JSON.stringify(menuMixFromSales('F01', ${JSON.stringify(rows)}, '2026-10-30'))`, c));
  assert.deepEqual(r.acc, { r1: 4, rfts: 1, rfree: 2 }); assert.equal(r.visitQty, 39); assert.deepEqual(r.days, ['2026-10-01', '2026-10-02']);
  vm.runInContext(`(function(){ var x = menuMixFromSales('F01', ${JSON.stringify(rows)}, '2026-10-30'); menuMixApply('F01', '2026.10', x.acc, x.linked); })()`, c);
  const w = c.WRITES.at(-1);
  assert.ok(!('rft' in w.items) && !('rrp' in w.items), 'the written month has no visit types');
  assert.equal(w.items.r1, 4); assert.equal(w.items.rman, 1, 'hand-entered numbers stay');
});

test('a month without visit types is returned as it is (same object); unknown categories are not visit types', () => {
  const saved = { items: { r1: 1 }, sales: 20 };
  const c = app(R, { 'menu_mix_F01_2026.10': saved });
  assert.equal(vm.runInContext("getMenuMix('F01', '2026.10')", c), saved);
  assert.equal(vm.runInContext("isVisitTypeCategory('Customer Type')", c), false);
  assert.equal(vm.runInContext("isVisitTypeCategory('Customers')", c), true);
  assert.equal(vm.runInContext("isVisitTypeCategory(null)", c), false);
  assert.equal(vm.runInContext("isVisitTypeRecipe({ category: 'Customers' })", c), false, 'only Toast-linked recipes');
});
