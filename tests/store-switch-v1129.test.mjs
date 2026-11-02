// v1129 (11/01 request ③): the top-left store (curStore) and the store inside each screen.
// - Screens that can show all stores follow the top-left; changing the top-left re-aligns the in-screen store filters.
// - One-store-at-a-time screens: the top-left store when one is chosen; with "All stores", the store picked in that
//   screen, else the first store this person may see. Picking a store inside such a screen never changes the top-left.
// - Never a store outside what the person may see (before: STORES[0], which could be outside an AM's stores).
// Runs the real functions from index.html in a VM with synthetic stores. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fnFrom(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, a); return src.slice(i, j); }
const HELPERS = between('var _soloSel = {};', '\nfunction storeSelectBar(');

const STORES = [
  { id: 'F01', name: 'ToriTon', color: '#111', active: true }, { id: 'F02', name: 'Tenkichi', color: '#222', active: true },
  { id: 'F04-K', name: 'Kaimuki', color: '#333', active: true }, { id: 'F05', name: 'Marujuu', color: '#444', active: true },
];
function app(role, store, am) {
  const c = {
    STORES, curRole: role, curStore: store, curPage: 'dashboard', curLang: 'ja', RENDERS: [], TOPBAR: { innerHTML: '' }, AM: am || [],
    dailyStoreScope: 'current', _budgetStore: 'ALL', _qbStore: 'ALL', _laborStore: 'ALL', laborTab: 'overview', _pdStore: 'ALL', _ipsScope: null, _ipsVendor: null, _ojtGateStore: null,
    window: {},
  };
  vm.createContext(c);
  vm.runInContext(`
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    function activeStores(){ return STORES.filter(function(s){ return s.active; }); }
    function myAmStores(){ return AM.slice(); } function mySupportStores(){ return []; } function myStoreId(){ return 'F02'; }
    function sortByLoginOrder(l){ return l; }
    function renderPage(p){ RENDERS.push(p); } function closeModalDirect(){} function buildNav(){}
    var document = { getElementById: function(id){ return id === 'topbar-store' ? TOPBAR : null; } };
    ${fnFrom('accessibleStoresForUser')}
    ${fnFrom('getVisibleStores')}
    ${HELPERS}
    ${fnFrom('switchStore')}
    ${fnFrom('dailyScopeStores')}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);

test('one-store screens: with "All stores" the first store this person may see (AM: never outside their stores); a pick in the screen does not change the top-left', () => {
  const am = app('am', 'ALL', ['F04-K', 'F05']);
  assert.equal(run(am, "soloStoreId('tip')"), 'F04-K', 'not STORES[0] (F01 is not this AM’s)');
  run(am, "curPage = 'tip'; pageStorePick('F05')");
  assert.equal(am.curStore, 'ALL', 'the top-left stays on All stores');
  assert.equal(run(am, "soloStoreId('tip')"), 'F05', 'the screen shows the picked store');
  assert.equal(run(am, "soloStoreId('inventory')"), 'F04-K', 'each screen remembers its own pick');
  run(am, "pageStorePick('F01')");   // outside: ignored when resolving
  assert.equal(run(am, "soloStoreId('tip')"), 'F04-K');
  assert.match(run(am, "soloStoreBar('tip')"), /1 店ずつ[\s\S]*左上は全店のまま/);
  assert.doesNotMatch(run(am, "soloStoreBar('tip')"), /ToriTon/, 'the selector lists only this AM’s stores');
  const gm = app('gm', 'ALL');
  assert.equal(run(gm, "soloStoreId('store_cmd')"), 'F01');
  assert.match(run(gm, "pageStoreTabs('F01', false)"), /pageStorePick\('F02'\)/, 'one-store tabs do not call switchStore');
  assert.match(run(gm, "pageStoreTabs('ALL', true)"), /switchStore\('F02'\)/, 'tabs that include All stores switch the top-left as before');
});

test('with a store chosen at the top-left, every screen shows that store; picking another store in a screen changes the top-left too (screen and top-left stay the same)', () => {
  const gm = app('gm', 'F02');
  assert.equal(run(gm, "soloStoreId('tip')"), 'F02');
  assert.equal(run(gm, "soloStoreBar('tip')"), '', 'no bar when a store is chosen');
  run(gm, "curPage = 'tip'; pageStorePick('F05')");
  assert.equal(gm.curStore, 'F05'); assert.equal(run(gm, "soloStoreId('tip')"), 'F05'); assert.match(gm.TOPBAR.innerHTML, /Marujuu/);
});

test('changing the top-left re-aligns the in-screen store filters (before: each screen kept the store it first chose)', () => {
  const gm = app('gm', 'ALL');
  run(gm, "_budgetStore='F01'; _qbStore='F01'; _laborStore='F04-K'; laborTab='hours'; _pdStore='F01'; _ipsScope='F01'; dailyStoreScope='F01'; window._mn={store:'F01'}; window._menuStore='F01'; window._kpiStore='F01'; window._skillMatrixStore='F01'; _ojtGateStore='F01'; _soloSel={tip:'F01'}");
  run(gm, "switchStore('F05')");
  for (const v of ['_budgetStore', '_qbStore', '_laborStore', '_pdStore', '_ipsScope', 'window._mn.store', 'window._menuStore', 'window._kpiStore', 'window._skillMatrixStore', '_ojtGateStore']) assert.equal(run(gm, v), 'F05', v);
  assert.equal(run(gm, 'dailyStoreScope'), 'current');
  assert.deepEqual(JSON.parse(run(gm, 'JSON.stringify(_soloSel)')), {});
  run(gm, "_soloSel={tip:'F02'}; switchStore('ALL')");
  assert.equal(run(gm, '_budgetStore'), 'ALL'); assert.equal(run(gm, '_laborStore'), 'ALL'); assert.equal(run(gm, 'laborTab'), 'overview');
  assert.equal(run(gm, '_pdStore'), 'ALL'); assert.equal(run(gm, '_ipsScope'), null); assert.equal(run(gm, 'window._mn.store'), '');
  assert.equal(run(gm, "soloStoreId('tip')"), 'F02', 'back to All stores: the one-store screens keep what was picked there');
});

test('予実の日次：左上が全店なら全店（前は最初の店だけ）・店なら店', () => {
  const gm = app('gm', 'ALL');
  assert.deepEqual(JSON.parse(run(gm, 'JSON.stringify(dailyScopeStores().map(function(s){return s.id;}))')), ['F01', 'F02', 'F04-K', 'F05']);
  run(gm, "switchStore('F02')");
  assert.deepEqual(JSON.parse(run(gm, 'JSON.stringify(dailyScopeStores().map(function(s){return s.id;}))')), ['F02']);
  const am = app('am', 'ALL', ['F04-K', 'F05']);
  assert.deepEqual(JSON.parse(run(am, 'JSON.stringify(dailyScopeStores().map(function(s){return s.id;}))')), ['F04-K', 'F05'], 'AM: their stores only');
});

test('the screens that used STORES[0] with "All stores" now use soloStoreId; one-store chips/tabs do not switch the top-left', () => {
  for (const [fn, page] of [['renderStoreCmd', 'store_cmd'], ['renderDailyOps', 'dailyops'], ['renderRequired', 'required'], ['renderGoals', 'goals'], ['renderShiftAdmin', 'shift_admin'], ['renderTipShiftLeader', 'tip']]) {
    const b = fnFrom(fn);
    assert.match(b, new RegExp("soloStoreId\\('" + page + "'\\)"), fn);
    assert.doesNotMatch(b, /curStore *=== *'ALL' *\? *STORES\[0\]/, fn);
  }
  assert.match(fnFrom('renderInventory'), /soloStoreId\('inventory'\)/);
  for (const fn of ['renderTipMgmt', 'renderShiftAdmin']) assert.doesNotMatch(fnFrom(fn), /bStoreChips\([^)]*'switchStore'/, fn + ': chips do not change the top-left');
  // budget setup does not overwrite the store the meeting and annual plan share
  const rp = src.slice(src.indexOf("  /* v1129 ③：予算設定は 1 店ずつ。"), src.indexOf("  html += bStoreChips(_budgetStore, 'setBudgetStore', {showAll: true});"));
  assert.doesNotMatch(rp, /_budgetStore *= *[^=]/, 'the setup tab does not write _budgetStore');
  // labor: the per-store tabs do not write _laborStore any more
  const lb = fnFrom('renderLabor');
  assert.doesNotMatch(lb, /_laborStore *= *v0/);
});
