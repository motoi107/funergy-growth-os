// v1193 (PR #197, Codex 6996221251 P2-1 and the Claude routine 6996082711 P2-1/P3-1): on a "view only" screen of
// 画面の表示 (FUNERGY_PV), ordinary typing must not save.
// - Codex: on the inventory screen (view only for office crew) the count field saves with oninput → setInvCount → lsSet.
//   The guard only looked at Enter; typing 1.6 seconds after choosing the field saved one row. Now typing (any key, input),
//   paste and leaving the field are watched too, so a field that keeps the focus and is typed into later is still stopped,
//   and the field shows the value it had again.
// - Claude routine: deleteEvent / deleteBasis / approve / reject / reopen (v1101 writers) were not wrapped. Now every
//   v1101 writer that a person presses is wrapped (the automatic ones are not).
// Runs the real FUNERGY_PV module, the real nav and the real setInvCount from index.html in a VM with a small DOM that
// dispatches events the way a browser does (capture listeners on document first, then the element's own handler).
// Synthetic data only. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pvProject, pvCheck } from '../supabase/functions/secure-state/handler.mjs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fnFrom(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
const NAV_BLOCK = between('\nconst NAV_ITEMS = [', '\nvar curGroup = null;');
const ROLE_BLOCK = between('\nconst ROLE_CONFIG = {', '\nconst NAV_ITEMS = [');
const PV_BLOCK = between('/* ==== FUNERGY_PV（v1193', '/* ==== FUNERGY_PV end ==== */');
// the first line of the real lsSet (the guard) — checked below so this harness keeps matching the app
const LSSET_GUARD = "if(window.FUNERGY_PV && typeof window.FUNERGY_PV.writeBlocked==='function' && window.FUNERGY_PV.writeBlocked(key)) return false;";
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const EMPS = [
  { id: 'e3', name: 'G3 Leader', role: 'sl', title: 'G3' },
  { id: 'e9', name: 'Accountant', role: 'office', title: '' },
  { id: 'e10', name: 'Office Crew', role: 'office_crew', title: '' },
  { id: 'e8', name: 'Head Chef', role: 'chef', title: 'G4' },
  { id: 'e2', name: 'G2 Leader', role: 'g2', title: 'G2' },
  { id: 'e11', name: 'General M', role: 'gm', title: 'G6' },
];
const ALIAS = { g2: 'sl', g4: 'am' };

/* A small element: tag, type, value / defaultValue, inline handlers (oninput = "..." runs as a function body) */
function el(tag, o = {}) {
  return Object.assign({ nodeType: 1, tagName: tag, type: o.type || '', value: o.value || '', defaultValue: o.value || '',
    checked: !!o.checked, defaultChecked: !!o.checked, isConnected: true, parent: null }, o.extra || {});
}

function app(empId, page, now) {
  const e = EMPS.find(x => x.id === empId);
  const c = {
    curRole: ALIAS[e.role] || e.role, curRealRole: e.role, curStore: ['office', 'office_crew'].includes(e.role) ? 'OFFICE' : 'F01',
    curStoreLogin: false, curUserName: e.name, curLang: 'ja', curPage: page,
    TOASTS: [], WRITES: [], CALLED: [], SS: null, EMPS, JSON, Math, Object, Array, String, Number, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, NOW: now,
  };
  // Date.now() is the test clock (the module measures 1.5 seconds with it)
  c.Date = class extends Date { static now() { return c.NOW.t; } };
  vm.createContext(c);
  vm.runInContext(`
    var window = this;
    var localStorage = { _m: new Map(), getItem(k){ return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v){ this._m.set(k, String(v)); }, removeItem(k){ this._m.delete(k); } };
    var LISTEN = {};
    var MAIN = { nodeType:1, id:'main-content', kids:new Set(), contains(x){ return x === this || this.kids.has(x); }, insertBefore(){}, firstChild:null };
    var OUT = { nodeType:1, id:'nav', kids:new Set(), contains(x){ return x === this || this.kids.has(x); } };
    var document = { visibilityState:'visible', addEventListener(t, f, cap){ (LISTEN[t] = LISTEN[t] || []).push(f); },
      getElementById(id){ return id === 'main-content' ? MAIN : (ELS[id] || null); }, createElement(){ return {}; } };
    /* v1194：棚卸しの上の「自動保存」の表示・原価率・価格の欄（ほかの id は無い） */
    var ELS = { 'inv-autosave': { innerHTML:'' }, 'inv-costrate': { textContent:'31.0%' }, 'inv-cogs': { textContent:'$310' },
      'inv-price-101': { value:'9' } };
    /* the browser's order: capture listeners on document, then the element's own handler */
    function fire(type, target, extra){
      var ev = Object.assign({ type:type, target:target }, extra || {});
      (LISTEN[type] || []).forEach(function(f){ f(ev); });
      if (typeof target['on' + type] === 'function') target['on' + type].call(target, ev);
    }
    var MASTER_ADMINS = [];
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m){ TOASTS.push(m); }
    function ls(k, d){ return d; }
    function getRoleHide(){ return []; }
    function getEmployees(){ return EMPS; }
    function getVisibleStores(){ return []; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function gradeOf(title){ var m = /^G(\\d)/.exec(String(title||'')); return m ? 'G' + m[1] : ''; }
    function gradeNum(g){ return g ? (parseInt(String(g).replace('G',''))||0) : 0; }
    function myGradeNum(){ return parseInt(String(myGradeKey()).slice(1), 10) || 1; }
    function isOpSyncKey(k){ return /^(m_|spl_|inv_|daily_actuals_)/.test(k); }   /* the app syncs every inv_ key (OP_SYNC_PREFIX) */
    function lsIsDeviceLocal(k){ return k.charAt(0) === '_'; }
    function isLocalOnlyKey(k){ return false; }
    var _SPLIT_KEYS = {}, SUPA_MASTER_MAP = { m_employees:{} }, SUPA_SETTING_KEYS = [], SUPA_SETTING_PREFIX = [];
    async function ssCall(p){ return SS ? SS(p) : { status:400, error:'unknown_action' }; }
    /* the real guard of lsSet, then the write */
    function lsSet(key, val){ ${LSSET_GUARD} WRITES.push(key); return true; }
    /* the inventory count: the real setInvCount with the screen helpers stubbed */
    function invYm(){ return '2026-11'; }
    function getInvCountsRaw(){ return {}; }
    function invRefreshInputSection(){} function renderInvToppageInner(){ return ''; }
    /* v1194：the other inventory saves (inner screen helpers stubbed; the save and the label are the app's own) */
    var invMonthOffset = 0;
    function invComputeTotals(){ return { grand: 100 }; } function invPrevStockYm(){ return 0; } function invMovesFor(){ return { net: 0 }; }
    function monthEventSalesYm(){ return { sales: 0 }; } function monthStats(){ return { sales: 1000 }; } function invFmtMoney(v){ return '$' + v; }
    function getInvTopRaw(){ return {}; }
    function invPriceEditable(){ return true; } function invBasePrice(){ return 5; } function getIngredients(){ return [{ code: 101 }]; }
    function _invPriceTagHtml(){ return ''; }
    /* v1101 writers (stand-ins that only record that they ran) */
    ${['saveDailyActual', 'saveDayMemo', 'bbSave', 'saveEvent', 'deleteEvent', 'saveDow', 'saveSeg', 'saveDayBudget', 'saveBasis', 'deleteBasis',
    'submitBudget', '_reviewBeforeSubmit', '_saveRationaleDraft', '_doSubmitBudget', 'approveBudgetSeg', 'rejectBudgetSeg', 'reopenBudget',
    'syncStoreActualsFromToast', 'fetchToastRange', 'fetchWeatherForView', 'migrateBudgetStatusYmFix', 'migrateBudgetStatusYm', 'normalizeBudgetsDemo']
    .map(n => `window.${n} = function(){ CALLED.push(${JSON.stringify(n)}); return 'ran'; };`).join('\n')}
    ${ROLE_BLOCK}
    ${NAV_BLOCK}
    ${between('\nfunction isPageHiddenForMe(', '\nvar curSLName')}
    ${fnFrom('canAccessStaffMaster')}
    ${fnFrom('canAccessKpiMaster')}
    ${fnFrom('isKpiSM')}
    ${fnFrom('canSeeDashboard')}
    ${fnFrom('setInvCount')}
    ${fnFrom('setInvSplit')}
    ${fnFrom('setInvTop')}
    ${fnFrom('setInvPrice')}
    ${fnFrom('invResetPrice')}
    ${fnFrom('_invPriceRowSync')}
    ${fnFrom('invPvBlocks')}
    ${fnFrom('invAutosaveShow')}
    ${PV_BLOCK}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
function initialDoc() { const c = app('e11', '', { t: 1 }); return JSON.parse(JSON.stringify(run(c, 'FUNERGY_PV._initialDoc()'))); }
async function withDoc(c, doc, empId) {
  const d = pvCheck(JSON.parse(JSON.stringify(doc)));
  c.SS = p => p.action === 'pv_get' ? { ok: true, j: { pvfn: 1, pv: Object.assign({ ver: 3, at: '2026-11-18T00:00:00Z' }, pvProject(d, empId)) } } : { status: 400, error: 'unknown_action' };
  run(c, 'FUNERGY_PV.afterLogin()');
  await settle();
  assert.equal(run(c, 'FUNERGY_PV.on()'), true, 'settings are on');
}
/* a field inside the page; by default the inventory count field with the app's own oninput */
function makeField(c, value, handler) {
  const f = el('INPUT', { type: 'number', value });
  f.oninput = handler || function () { c.setInvCount('F01', 101, this.value); };
  run(c, 'MAIN').kids.add(f);
  return f;
}
const later = async (c, ms) => { c.NOW.t += ms; await new Promise(r => setTimeout(r, 5)); await settle(); };

test('the harness uses the real first line of lsSet (the view-only guard)', () => {
  assert.ok(src.includes(LSSET_GUARD), 'lsSet still starts with the FUNERGY_PV guard');
  const i = src.indexOf('function lsSet(key, val) {');
  assert.ok(i > 0 && src.indexOf(LSSET_GUARD, i) - i < 600, 'and it is at the top of lsSet');
});

test('Codex P2-1: office crew on the view-only inventory screen — typing a count 1.6 s after choosing the field does not save, and the field shows its value again', async () => {
  const doc = initialDoc();
  const c = app('e10', 'inventory', { t: 1_000_000 }); await withDoc(c, doc, 'e10');
  assert.equal(run(c, "FUNERGY_PV.ro('inventory')"), true, 'inventory is new for office crew and view only');
  const f = makeField(c, '3');
  c.fire('pointerdown', f); c.fire('click', f);
  await later(c, 1600);
  f.value = '35';
  c.fire('keydown', f, { key: '5' });
  c.fire('beforeinput', f, { inputType: 'insertText', data: '5' });
  c.fire('input', f);
  assert.deepEqual(c.WRITES, [], 'not saved');
  assert.equal(f.value, '3', 'the field shows the value it had');
  assert.ok(c.TOASTS.some(m => /見るだけ/.test(m)));
  // the focus stays in the field and the person types again a minute later
  await later(c, 60_000);
  f.value = '7'; c.fire('keydown', f, { key: '7' }); c.fire('input', f);
  assert.deepEqual(c.WRITES, [], 'still not saved');
  // paste
  await later(c, 5000);
  f.value = '99'; c.fire('paste', f); c.fire('input', f);
  assert.deepEqual(c.WRITES, [], 'paste is not saved');
  // a field that saves when it is left (onblur), long after the last key
  await later(c, 30_000);
  const g = makeField(c, '1', null); g.oninput = null;
  g.onblur = function () { c.setInvCount('F01', 102, this.value); };
  g.value = '4'; c.fire('blur', g);
  assert.deepEqual(c.WRITES, [], 'leaving the field does not save');
  assert.equal(g.value, '1');
});

test('the same typing saves where the screen is editable, and background writes are never stopped', async () => {
  const doc = initialDoc();
  // an accountant opens inventory today (no band): typing saves
  const a = app('e9', 'inventory', { t: 2_000_000 }); await withDoc(a, doc, 'e9');
  assert.equal(run(a, "FUNERGY_PV.ro('inventory')"), false);
  const f = makeField(a, '3');
  await later(a, 1600); f.value = '35'; a.fire('keydown', f, { key: '5' }); a.fire('input', f);
  assert.deepEqual(a.WRITES, ['inv_count_F01_2026-11'], 'saved');
  assert.equal(f.value, '35');
  // office crew: a write long after the last key, or after a press outside the page, is a background write
  const c = app('e10', 'inventory', { t: 3_000_000 }); await withDoc(c, doc, 'e10');
  const g = makeField(c, '3');
  g.value = '5'; c.fire('input', g);
  assert.deepEqual(c.WRITES, []);
  await later(c, 1600);
  run(c, "lsSet('spl_x', 1)");
  assert.deepEqual(c.WRITES, ['spl_x'], 'a write 1.6 s after the last key is not stopped (background import)');
  const nav = el('A'); run(c, 'OUT').kids.add(nav);
  g.value = '6'; c.fire('input', g); c.fire('pointerdown', nav);
  run(c, "lsSet('spl_y', 1)");
  assert.deepEqual(c.WRITES, ['spl_x', 'spl_y'], 'after a press outside the page (the nav) it is not stopped');
  // a search box on the view-only screen keeps what was typed (it writes nothing, so nothing is put back)
  const s = makeField(c, '', function () {});
  s.type = 'search'; s.value = 'tuna'; c.fire('keydown', s, { key: 'a' }); c.fire('input', s);
  assert.equal(s.value, 'tuna');
});

test('Claude routine P2-1: every v1101 writer a person presses is wrapped (deletes, approve, reject, reopen); the automatic ones are not', async () => {
  const W = between('const WRITERS = [', '];').replace('const WRITERS = [', '');
  const A = between('const AUTO_SOURCES = [', '];').replace('const AUTO_SOURCES = [', '');
  const names = s => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const writers = names(W), auto = names(A);
  assert.ok(writers.includes('deleteEvent') && writers.includes('deleteBasis') && auto.length === 6);
  // 予実（budget）itself is open to everyone but G1 today, so it is never view only (G1 is never widened) — checked here.
  // The same writers are reachable from the dashboard (daily input), which IS view only for office crew (5A).
  const doc = initialDoc();
  for (const id of ['e2', 'e3', 'e8', 'e9', 'e10']) {
    const x = app(id, '', { t: 1 }); await withDoc(x, doc, id);
    assert.equal(run(x, "FUNERGY_PV.ro('budget')"), false, id + ': 予実 is editable today, never view only');
  }
  const c = app('e10', 'dashboard', { t: 4_000_000 }); await withDoc(c, doc, 'e10');
  assert.equal(run(c, "FUNERGY_PV.ro('dashboard')"), true, 'office crew: the dashboard is view only');
  const wrapped = Array.from(run(c, 'FUNERGY_PV._RO_WRAP'));
  for (const n of writers.filter(n => !auto.includes(n))) assert.ok(wrapped.includes(n), n + ' is wrapped');
  for (const n of auto) assert.ok(!wrapped.includes(n), n + ' (automatic) is not wrapped');
  // pressed on the view-only dashboard: nothing runs
  const b = el('BUTTON'); run(c, 'MAIN').kids.add(b);
  for (const n of ['deleteEvent', 'deleteBasis', 'approveBudgetSeg', 'rejectBudgetSeg', 'reopenBudget', 'saveDailyActual']) {
    c.fire('pointerdown', b); c.fire('click', b);
    assert.equal(run(c, `${n}('F01')`), undefined, n);
  }
  assert.deepEqual(c.CALLED, [], 'none of them ran');
  // the automatic ones run even right after a press
  c.fire('click', b);
  assert.equal(run(c, "syncStoreActualsFromToast('F01')"), 'ran');
  // not pressed (a background call) → runs
  await later(c, 1600);
  assert.equal(run(c, "deleteEvent('F01')"), 'ran');
  assert.deepEqual(c.CALLED, ['syncStoreActualsFromToast', 'deleteEvent']);
});

test('Claude routine P3-1: office crew does not get an entry to the staff master or KPI settings that the screen would refuse', async () => {
  const doc = initialDoc();
  const c = app('e10', 'staff_master', { t: 5_000_000 }); await withDoc(c, doc, 'e10');
  for (const pid of ['staff_master', 'kpi_master']) assert.equal(run(c, `navChildAllowed('${pid}')`), false, pid);
  assert.equal(run(c, 'canAccessStaffMaster() || canAccessKpiMaster()'), false, 'the screens themselves refuse office crew');
  // even if someone saves "show" for the person, the screen guard wins
  const d2 = JSON.parse(JSON.stringify(doc)); d2.people = { e10: { 'p:staff_master': 's', 'p:kpi_master': 's' } };
  const c2 = app('e10', '', { t: 6_000_000 }); await withDoc(c2, d2, 'e10');
  assert.deepEqual(JSON.parse(JSON.stringify(run(c2, "FUNERGY_PV.decide('staff_master')"))), { show: false, src: 'fixed' });
  assert.deepEqual(JSON.parse(JSON.stringify(run(c2, "FUNERGY_PV.decide('kpi_master')"))), { show: false, src: 'fixed' });
  // a G3 (store) can open KPI settings today but not the staff master
  const g3 = app('e3', '', { t: 7_000_000 });
  const d3 = JSON.parse(JSON.stringify(doc)); d3.cols.g3 = Object.assign({}, d3.cols.g3, { 'p:staff_master': 's' });
  await withDoc(g3, d3, 'e3');
  assert.equal(run(g3, "navChildAllowed('staff_master')"), false, 'a G3 is not given the staff master');
});

test('each kind of typing on its own counts as a press (any key, paste, cut, drop, composing, leaving the field), and a save up to 1.5 s later is stopped too', async () => {
  const doc = initialDoc();
  const c = app('e10', 'inventory', { t: 8_000_000 }); await withDoc(c, doc, 'e10');
  const f = makeField(c, '3', function () {});
  const kinds = [['keydown', { key: 'a' }], ['beforeinput', { inputType: 'insertText' }], ['input'], ['paste'], ['cut'], ['drop'],
    ['compositionend'], ['change'], ['blur'], ['focusout'], ['submit'], ['pointerdown'], ['click']];
  assert.deepEqual(Array.from(run(c, 'FUNERGY_PV._GESTURES')).sort(), kinds.map(k => k[0]).sort(), 'the module listens to exactly these');
  for (const [type, extra] of kinds) {
    await later(c, 60_000);
    f.value = '9'; c.fire(type, f, extra);
    run(c, "setInvCount('F01', 103, '9')");
    assert.deepEqual(c.WRITES, [], type + ' alone: not saved');
    assert.equal(f.value, '3', type + ' alone: the field is put back');
  }
  // a field that saves a little after the last key (a timer): still stopped within 1.5 s
  await later(c, 60_000);
  f.value = '8'; c.fire('input', f);
  await later(c, 1000);
  run(c, "setInvCount('F01', 104, '8')");
  assert.deepEqual(c.WRITES, [], '1.0 s after the key: not saved');
  assert.equal(f.value, '3');
});

test('a stopped server save and a stopped v1101 writer also put the typed field back', async () => {
  const doc = initialDoc();
  const c = app('e10', 'dashboard', { t: 9_000_000 }); await withDoc(c, doc, 'e10');
  assert.equal(run(c, "FUNERGY_PV.ro('dashboard')"), true);
  const f = makeField(c, '120', function () {});
  f.value = '999'; c.fire('input', f);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'put', key:'spl_x' })"), true, 'the server save is stopped');
  assert.equal(f.value, '120', 'and the field shows its value again');
  await later(c, 60_000);
  f.value = '777'; c.fire('input', f);
  assert.equal(run(c, "saveDailyActual('F01')"), undefined, 'the daily input is stopped');
  assert.equal(f.value, '120', 'and the field shows its value again');
  assert.deepEqual(c.CALLED, []);
});

// ---- v1194 (PR #197 Codex 17509ee P3 and the Claude routine 6996965658 P3-1) ----
const label = c => String(run(c, "ELS['inv-autosave'].innerHTML"));

test('v1194 Codex P3: on the view-only inventory a stopped save does not say 「自動保存」, and the screen keeps the saved numbers', async () => {
  const doc = initialDoc();
  const c = app('e10', 'inventory', { t: 10_000_000 }); await withDoc(c, doc, 'e10');
  assert.equal(run(c, "FUNERGY_PV.ro('inventory')"), true);
  const before = run(c, 'FUNERGY_PV.blocked()');
  // the count, the split count, the top numbers, the price and "戻す" of the price — each typed / pressed on the screen
  const cases = [
    ['setInvCount', "setInvCount('F01', 101, '7')"],
    ['setInvSplit', "setInvSplit('F01', 101, 'f', '2')"],
    ['setInvTop', "setInvTop('F01', 'purchase', '500')"],
    ['setInvPrice', "setInvPrice('F01', 101, '6.5')"],
  ];
  for (const [name, call] of cases) {
    await later(c, 60_000);
    run(c, "ELS['inv-autosave'].innerHTML = ''");
    const f = makeField(c, '3', function () {});
    f.value = '9'; c.fire('input', f);
    run(c, call);
    assert.deepEqual(c.WRITES, [], name + ': not saved');
    assert.doesNotMatch(label(c), /自動保存/, name + ': does not say auto-saved');
    assert.match(label(c), /見るだけ（保存しませんでした）/, name + ': says view only (not saved)');
  }
  assert.equal(run(c, "ELS['inv-costrate'].textContent"), '31.0%', 'the cost rate is not worked out from the unsaved input');
  assert.equal(run(c, "ELS['inv-cogs'].textContent"), '$310');
  // 「戻す」 of the price (a link, not a field): the price field keeps the hand-entered price
  await later(c, 60_000);
  const a = el('A'); run(c, 'MAIN').kids.add(a);
  c.fire('pointerdown', a); c.fire('click', a);
  run(c, "invResetPrice('F01', 101)");
  assert.deepEqual(c.WRITES, []);
  assert.equal(run(c, "ELS['inv-price-101'].value"), '9', 'the price field is not set back to the master price');
  assert.match(label(c), /見るだけ/);
  assert.equal(run(c, 'FUNERGY_PV.blocked()') - before, 5, 'each stop is counted once');
  // English
  run(c, "curLang = 'en'");
  await later(c, 60_000);
  const g = makeField(c, '3', function () {}); g.value = '4'; c.fire('input', g);
  run(c, "setInvCount('F01', 101, '4')");
  assert.match(label(c), /View only \(not saved\)/);
});

test('v1194: where the inventory is editable the same saves still say 「自動保存」 (and a save that only failed on this device is not called view only)', async () => {
  const doc = initialDoc();
  const a = app('e9', 'inventory', { t: 11_000_000 }); await withDoc(a, doc, 'e9');
  assert.equal(run(a, "FUNERGY_PV.ro('inventory')"), false);
  for (const call of ["setInvCount('F01', 101, '7')", "setInvSplit('F01', 101, 'r', '2')", "setInvTop('F01', 'purchase', '500')", "setInvPrice('F01', 101, '6.5')", "invResetPrice('F01', 101)"]) {
    run(a, "ELS['inv-autosave'].innerHTML = ''");
    const f = makeField(a, '3', function () {}); f.value = '9'; a.fire('input', f);
    run(a, call);
    assert.match(label(a), /自動保存/, call);
  }
  assert.deepEqual(a.WRITES, ['inv_count_F01_2026-11', 'inv_count_F01_2026-11', 'inv_top_F01_2026-11', 'inv_price_F01_2026-11', 'inv_price_F01_2026-11']);
  assert.equal(run(a, "ELS['inv-costrate'].textContent"), '40.0%', 'the cost rate is worked out after a save ((0 + 500 - 100) / 1000)');
  assert.equal(run(a, "ELS['inv-price-101'].value"), 5, '「戻す」 puts the master price back');
  // lsSet says false because this device could not keep it (it was still sent): that is not "view only"
  run(a, "var _realLsSet = lsSet; lsSet = function(k){ WRITES.push(k); return false; }");
  run(a, "ELS['inv-autosave'].innerHTML = ''");
  run(a, "setInvCount('F01', 101, '8')");
  assert.match(label(a), /自動保存/);
  assert.doesNotMatch(label(a), /見るだけ/);
});

test('v1194 Claude routine P3-1: a search or filter box keeps what was typed when another save is stopped a moment later', async () => {
  const doc = initialDoc();
  const c = app('e10', 'inventory', { t: 12_000_000 }); await withDoc(c, doc, 'e10');
  const boxes = [
    el('INPUT', { type: 'search', value: '' }),
    el('INPUT', { type: '', value: '', extra: { id: 'gr-q' } }),
    el('INPUT', { type: 'text', value: '', extra: { placeholder: '名前で探す' } }),
    el('INPUT', { type: 'text', value: '', extra: { placeholder: '商品名で絞り込み' } }),
    el('INPUT', { type: 'text', value: '', extra: { id: 'emp-search', placeholder: '名前・従業員コード・Email・電話で検索' } }),
    el('INPUT', { type: 'text', value: '', extra: { getAttribute(n) { return n === 'aria-label' ? 'Filter by name' : null; } } }),
  ];
  for (const b of boxes) {
    await later(c, 60_000);
    b.oninput = function () {};   // the box's own handler only narrows the list
    run(c, 'MAIN').kids.add(b);
    b.value = 'tuna'; c.fire('keydown', b, { key: 'a' }); c.fire('input', b);
    // still inside the same press, and then 0.5 s later, something saves a synced key (for example a timer of the screen)
    assert.equal(run(c, "lsSet('inv_count_F01_2026-11', {})"), false, 'the save itself is still stopped');
    await later(c, 500);
    assert.equal(run(c, "lsSet('spl_x', 1)"), false);
    assert.equal(b.value, 'tuna', (b.id || b.placeholder || b.type) + ': the box keeps what was typed');
  }
  assert.deepEqual(c.WRITES, []);
});

test('v1194: a field that does not save by itself is not put back by a later stopped save; a field that saves by itself still is', async () => {
  const doc = initialDoc();
  const c = app('e10', 'inventory', { t: 13_000_000 }); await withDoc(c, doc, 'e10');
  // a note that is saved with a button (no handler of its own)
  const note = el('TEXTAREA', { value: 'old' }); run(c, 'MAIN').kids.add(note);
  note.value = 'new words'; c.fire('input', note);
  await later(c, 700);
  assert.equal(run(c, "lsSet('spl_x', 1)"), false, 'a save 0.7 s later is still stopped');
  assert.equal(note.value, 'new words', 'the note is not put back (it was not what saved)');
  // the count field saves with a timer (its own oninput starts it): put back
  await later(c, 60_000);
  const f = makeField(c, '3', function () {});
  f.value = '8'; c.fire('input', f);
  await later(c, 700);
  run(c, "setInvCount('F01', 104, '8')");
  assert.equal(f.value, '3');
  // stopped inside the press itself (live): a field without an inline handler is put back too (its save ran from that press)
  await later(c, 60_000);
  const h = el('INPUT', { type: 'number', value: '1' }); run(c, 'MAIN').kids.add(h);
  h.value = '6'; c.fire('change', h);
  run(c, "setInvCount('F01', 105, '6')");
  assert.equal(h.value, '1');
  assert.deepEqual(c.WRITES, []);
});

test('v1194: which boxes count as search or filter boxes (real ids and words of the screens)', () => {
  const c = app('e10', 'inventory', { t: 14_000_000 });
  const q = o => run(c, 'FUNERGY_PV._queryField')(Object.assign({ tagName: 'INPUT', type: 'text' }, o));
  for (const id of ['gr-q', 'chat-q', 'ivm-q', 'tl-q', 'vmg-q', 'ilk-q', 'ilk-find', 'emp-search', 'recipe-search', 'ing-master-search', 'inv-link-q', 'ingpick-q', 'bowl-search'])
    assert.equal(q({ id }), true, id);
  for (const placeholder of ['名前で探す', '食材名・業者・コードで検索', '名前で絞り込み', 'Search by name', 'Filter by name or code'])
    assert.equal(q({ placeholder }), true, placeholder);
  assert.equal(q({ type: 'search' }), true);
  for (const id of ['inv-price-101', 'eq-total', 'qty', 'inv-top-sales', ''])
    assert.equal(q({ id }), false, id || '(no id)');
  assert.equal(q({ placeholder: '数量' }), false);
  // the real search boxes in index.html: every one is found by the rule
  const boxes = [...src.matchAll(/<input[^>]*?(?:placeholder="[^"]*(?:探す|検索|絞り込|Search|Filter)[^"]*"|type="search")[^>]*>/g)].map(m => m[0]);
  assert.ok(boxes.length >= 20, 'found the search boxes of the screens: ' + boxes.length);
  const attr = (tag, n) => { const m = new RegExp('\\s' + n + '="([^"]*)"').exec(tag); return m ? m[1] : ''; };
  for (const tag of boxes) assert.equal(q({ id: attr(tag, 'id'), type: attr(tag, 'type'), placeholder: attr(tag, 'placeholder') }), true, tag.slice(0, 120));
});

test('v1194: every 「自動保存」 label of the inventory goes through the stop check', () => {
  const body = name => fnFrom(name);
  for (const name of ['setInvTop', 'setInvSplit', 'setInvCount', 'setInvPrice', 'invResetPrice']) {
    const b = body(name);
    const i = b.indexOf('var _pv=invPvBlocks();'), j = b.indexOf('if(invPvBlocks()!==_pv){ invAutosaveShow(false); return; }');
    assert.ok(i > 0 && j > i, name + ' checks whether the save was stopped');
    assert.doesNotMatch(b, /自動保存/, name + ' does not write the label itself');
  }
  assert.ok(body('setInvCount').includes("lsSet('inv_count_'+storeId+'_'+_ym, c)"), 'setInvCount still writes with lsSet (verify_v917)');
  const u = body('updateInv');
  assert.ok(u.indexOf('invPvBlocks()') > 0 && u.indexOf("invAutosaveShow(false)") < u.indexOf('自動保存済み'), 'updateInv says auto-saved only after a save that was not stopped');
  assert.equal((src.match(/getElementById\('inv-autosave'\)/g) || []).length, 2, 'only invAutosaveShow and updateInv write the label');
});

test('v1194: every stop (lsSet, a server save, a v1101 writer) is counted once, and nothing else is', async () => {
  const doc = initialDoc();
  const c = app('e10', 'dashboard', { t: 15_000_000 }); await withDoc(c, doc, 'e10');
  const n = () => run(c, 'FUNERGY_PV.blocked()');
  const f = makeField(c, '1', function () {});
  f.value = '2'; c.fire('input', f);
  const n0 = n();
  assert.equal(run(c, "lsSet('spl_x', 1)"), false); assert.equal(n(), n0 + 1);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'put', key:'spl_x' })"), true); assert.equal(n(), n0 + 2);
  assert.equal(run(c, "saveDailyActual('F01')"), undefined); assert.equal(n(), n0 + 3);
  // not stopped: a key of this device only, a server call that is not a save, a write long after the press
  run(c, "lsSet('_draft', 1)"); run(c, "FUNERGY_PV.callBlocked({ action:'get', key:'spl_x' })");
  await later(c, 1600); run(c, "lsSet('spl_y', 1)");
  assert.equal(n(), n0 + 3);
  assert.deepEqual(c.WRITES, ['_draft', 'spl_y']);
});
