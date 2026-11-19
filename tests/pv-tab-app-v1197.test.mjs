// v1197（UI案96 の 6B）：「画面の表示」の店のタブレットの列（アプリ・FUNERGY_PV）。index.html の本物のコードを VM で動かす（合成データだけ）。確かめること：
//  1. 編集（CEO・GM）：関数が受け取れるとき（pv_full の tabok:1）だけ列を出し、初めの値に入れる（今の 4 画面＝表示・出せるほかの画面＝非表示・カードなし）。
//     前の版の関数には列を出さない・送らない。出せる画面は人ごとのデータを出さない店の仕事の画面だけ（ほかは「—」）。1 つも出さないと保存しない
//  2. 店のタブレット：ログインを確かめない pv_tab を読み、今の 4 画面を 表示／非表示、足した画面は元の大タブの名前で足して見るだけ。
//     隠した今の画面は行き先も止める。足していない画面の行き先は今のまま。前の版の関数・止めた・届かないときは今の 4 画面（届かないときは写し）
//  3. ログインした人の列・CEO・GM は今まで。ログアウト・ほかの店のログインで前の答えを使わない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pvCheck } from '../supabase/functions/secure-state/handler.mjs';

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
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

const EMPS = [{ id: 'e11', name: 'General M', role: 'gm', title: 'G6' }, { id: 'e3', name: 'G3 Leader', role: 'sl', title: 'G3', store: 'F01' }];
const STORES = [{ id: 'F01', active: true }, { id: 'F02', active: true }, { id: 'F09', active: false }];

function app(o = {}) {
  const c = {
    curRole: o.tablet ? 'sl' : (o.role || 'gm'), curRealRole: o.tablet ? null : (o.role || 'gm'), curStore: o.store || 'F01', curStoreLogin: !!o.tablet,
    curUserName: o.tablet ? 'Store A' : (o.user || 'General M'), curLang: o.lang || 'ja', curPage: '',
    TOASTS: [], CALLS: [], FETCH: [], SS: o.ss || null, TABF: o.tabf || null, EMPS, STORES0: STORES, Date, JSON, Math, Object, Array, String, Number, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console,
  };
  vm.createContext(c);
  vm.runInContext(`
    var window = this;
    var localStorage = { _m: new Map(), getItem(k){ return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v){ this._m.set(k, String(v)); }, removeItem(k){ this._m.delete(k); } };
    var document = { visibilityState:'visible', addEventListener(){}, getElementById(){ return null; }, createElement(){ return {}; } };
    var MASTER_ADMINS = [];
    var SUPABASE_URL = 'https://db.example.test', SUPABASE_ANON = 'anon-key', SS_FN = '/functions/v1/secure-state';
    function AbortController(){ this.signal = {}; this.abort = function(){}; }
    async function fetch(u, opt){ FETCH.push({ u:u, body:JSON.parse(opt.body), auth:opt.headers.Authorization }); if (!TABF) throw new Error('offline'); var x = await TABF(JSON.parse(opt.body)); return { ok:x.status === 200, status:x.status, json: async function(){ return x.j; } }; }
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m){ TOASTS.push(m); }
    function ls(k, d){ return d; }
    function lsSet(){}
    function getRoleHide(){ return []; }
    function getEmployees(){ return EMPS; }
    function getVisibleStores(){ return []; }
    function activeStores(){ return STORES0.filter(function(s){ return s.active; }); }
    function escapeHtml(s){ return String(s==null?'':s); }
    function gradeOf(title){ var m = /^G(\\d)/.exec(String(title||'')); return m ? 'G' + m[1] : ''; }
    function gradeNum(g){ return g ? (parseInt(String(g).replace('G',''))||0) : 0; }
    function myGradeNum(){ return parseInt(String(myGradeKey()).slice(1), 10) || 1; }
    function isOpSyncKey(k){ return /^(m_|spl_)/.test(k); }
    var _SPLIT_KEYS = {}, SUPA_MASTER_MAP = {}, SUPA_SETTING_KEYS = [], SUPA_SETTING_PREFIX = [];
    async function ssCall(p){ CALLS.push(p); return SS ? SS(p) : { status:400, error:'unknown_action' }; }
    ${ROLE_BLOCK}
    ${NAV_BLOCK}
    ${between('\nfunction isPageHiddenForMe(', '\nvar curSLName')}
    ${fnFrom('canAccessStaffMaster')}
    ${fnFrom('canAccessKpiMaster')}
    ${fnFrom('isKpiSM')}
    ${fnFrom('canSeeDashboard')}
    ${PV_BLOCK}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const J = x => JSON.parse(JSON.stringify(x));
const STORE4 = ['store_cmd', 'shift_admin', 'inventory', 'vacation'];
const fullAns = (tabok, doc) => p => p.action === 'pv_full' ? { ok: true, j: Object.assign({ pvfn: 1, ver: doc ? 2 : 0, pv: doc ? { ver: 2, at: '2026-11-19T00:00:00Z', by_name: 'General M', doc } : null }, tabok ? { tabok: 1 } : {}) }
  : p.action === 'pv_save' ? { ok: true, j: { ok: true, ver: (doc ? 3 : 1) } } : { status: 400, error: 'unknown_action' };
const tabAns = col => () => ({ status: 200, j: { fn: 1, pvfn: 1, pv: col ? { ver: 5, at: '2026-11-19T00:00:00Z', col } : null } });

test('editor: the store tablet column appears only when the function takes it (tabok); starting values are today\'s 4 screens; no cards', async () => {
  // an older function (no tabok): no column, nothing for it in the starting document
  const o = app({ ss: fullAns(false) });
  run(o, 'FUNERGY_PV.editorHtml()'); await settle();
  assert.deepEqual(J(run(o, 'FUNERGY_PV._editCols()')).includes('tab'), false);
  assert.equal(J(run(o, 'FUNERGY_PV._E().draft')).cols.tab, undefined);
  assert.doesNotMatch(run(o, 'FUNERGY_PV.editorHtml()'), /店のタブレット/);
  // v1197 function
  for (const lang of ['ja', 'en']) {
    const c = app({ ss: fullAns(true), lang });
    run(c, 'FUNERGY_PV.editorHtml()'); await settle();
    assert.ok(J(run(c, 'FUNERGY_PV._editCols()')).includes('tab'));
    const tab = J(run(c, 'FUNERGY_PV._E().draft')).cols.tab;
    const TAB_OK = J(run(c, 'FUNERGY_PV.TAB_OK'));
    for (const p of STORE4) assert.equal(tab['p:' + p], 's', p);
    for (const p of TAB_OK.filter(x => !STORE4.includes(x))) assert.equal(tab['p:' + p], 'h', p);
    assert.ok(Object.keys(tab).every(k => k.startsWith('p:') && TAB_OK.includes(k.slice(2))), 'only allowed screens, no cards: ' + Object.keys(tab));
    for (const p of ['labor', 'tip', 'staff_master', 'hiring', 'growthhub', 'leadership', 'chat', 'dashboard', 'expense', 'skill'])
      assert.equal(tab['p:' + p], undefined, p + ' is not offered to a shared tablet');
    assert.ok(pvCheck(J(run(c, 'FUNERGY_PV._E().draft'))), 'the server takes the document');
    const h = run(c, 'FUNERGY_PV.editorHtml()');
    assert.match(h, lang === 'ja' ? /店のタブレット/ : /Store tablet/);
    assert.match(h, lang === 'ja' ? /2 店/ : /2 stores/, 'the number of active stores');
  }
});

test('editor: hiding every tablet screen is refused; a change to one cell is saved with the tablet column', async () => {
  const saved = [];
  const c = app({ ss: p => { if (p.action === 'pv_save') saved.push(p); return fullAns(true)(p); } });
  run(c, 'FUNERGY_PV.editorHtml()'); await settle();
  run(c, "FUNERGY_PV.h.reason('タブレットにメニュー'); FUNERGY_PV.h.cell('tab','p:menu')");
  assert.equal(J(run(c, 'FUNERGY_PV._E().draft')).cols.tab['p:menu'], 's');
  run(c, 'FUNERGY_PV.h.save()'); await settle();
  assert.equal(saved.length, 1); assert.equal(saved[0].doc.cols.tab['p:menu'], 's');
  assert.ok(pvCheck(saved[0].doc));
  // all off → not saved
  const d = app({ ss: p => { if (p.action === 'pv_save') saved.push(p); return fullAns(true)(p); } });
  run(d, 'FUNERGY_PV.editorHtml()'); await settle();
  for (const p of STORE4) run(d, `FUNERGY_PV.h.cell('tab','p:${p}')`);
  run(d, "FUNERGY_PV.h.reason('x'); FUNERGY_PV.h.save()"); await settle();
  assert.equal(saved.length, 1, 'not sent');
  assert.match(d.TOASTS.at(-1), /店のタブレットに出す画面が 1 つもありません/);
});

test('store tablet: reads pv_tab without a sign-in, hides today\'s screens set to Hide (and their ways in), adds shown screens under their own group as view only', async () => {
  const c = app({ tablet: true, tabf: tabAns({ 'p:vacation': 'h', 'p:menu': 's', 'p:budget': 's', 'p:recipe': 'h', 'p:store_cmd': 's' }) });
  assert.deepEqual(J(run(c, '_navBaseGroups()')).map(g => g.id), ['g_store', 'g_shift', 'g_inv', 'g_vac']);
  run(c, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(c.FETCH.length, 1); assert.deepEqual(c.FETCH[0].body, { action: 'pv_tab' }); assert.equal(c.FETCH[0].auth, 'Bearer anon-key');
  assert.equal(c.CALLS.length, 0, 'no signed-in call');
  assert.equal(run(c, 'FUNERGY_PV.on()'), true);
  const gs = J(run(c, 'groupsForRole()'));
  assert.deepEqual(gs.map(g => g.id), ['g_store', 'g_shift', 'g_inv', 'pvt_g_budget', 'pvt_g_food']);
  assert.deepEqual(gs.find(g => g.id === 'pvt_g_food'), { id: 'pvt_g_food', label: '食材管理', icon: 'ti-receipt', children: ['menu'] });
  assert.deepEqual(gs.find(g => g.id === 'pvt_g_budget').children, ['budget']);
  assert.equal(run(c, "navGuardAllows('vacation')"), false, 'a hidden screen of today does not open by a direct way in either');
  assert.equal(run(c, "navResolvePage('vacation')"), 'store_cmd');
  assert.equal(run(c, "navGuardAllows('recipe')"), true, 'a screen that was not on the tablet keeps today\'s rule');
  assert.equal(run(c, "navGuardAllows('ar_settings')"), false, 'guarded screens never');
  assert.equal(run(c, "FUNERGY_PV.ro('menu')"), true, 'added screens are view only');
  assert.equal(run(c, "FUNERGY_PV.ro('store_cmd')"), false);
  assert.equal(run(c, "FUNERGY_PV.ro('recipe')"), false);
  assert.equal(run(c, 'navHomePage()'), 'store_cmd');
  // hiding the operations screen: home is the first screen of the tablet tree
  const d = app({ tablet: true, tabf: tabAns({ 'p:store_cmd': 'h' }) });
  run(d, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(run(d, 'navHomePage()'), 'shift_admin');
});

test('store tablet: an older function, a turned-off setting, before the SQL, offline (with and without a copy), another store and logout', async () => {
  const OLD = () => ({ status: 400, j: { fn: 1, pvfn: 1, error: 'unknown_action' } });
  for (const [name, f] of [['old', OLD], ['off', () => ({ status: 200, j: { fn: 1, pvfn: 1, pv: null, off: true } })], ['nosql', () => ({ status: 200, j: { fn: 1, pvfn: 1, pv: null, nosql: true } })], ['offline', null]]) {
    const c = app({ tablet: true, tabf: f });
    run(c, 'FUNERGY_PV.afterLogin()'); await settle();
    assert.equal(run(c, 'FUNERGY_PV.on()'), false, name);
    assert.deepEqual(J(run(c, 'groupsForRole()')).map(g => g.id), ['g_store', 'g_shift', 'g_inv', 'g_vac'], name);
  }
  // a copy from an earlier answer is used while offline
  const c = app({ tablet: true, tabf: tabAns({ 'p:menu': 's' }) });
  run(c, 'FUNERGY_PV.afterLogin()'); await settle();
  c.TABF = null; run(c, 'FUNERGY_PV.onLogout(); FUNERGY_PV.afterLogin()'); await settle();
  assert.ok(J(run(c, 'groupsForRole()')).some(g => g.children.includes('menu')), 'the copy');
  // an older function clears the copy
  c.TABF = OLD; run(c, 'FUNERGY_PV.load(true)'); await settle();
  assert.equal(run(c, 'FUNERGY_PV.on()'), false); assert.equal(run(c, "localStorage.getItem('_pv_tab_cache_v1')"), null);
  // another store's login does not use an answer that arrives late for the first
  let release; const slow = () => new Promise(r => { release = () => r({ status: 200, j: { fn: 1, pvfn: 1, pv: { ver: 1, at: '', col: { 'p:menu': 's' } } } }); });
  const s = app({ tablet: true, tabf: slow });
  run(s, 'FUNERGY_PV.afterLogin()'); await settle();
  run(s, "FUNERGY_PV.onLogout(); curStore = 'F02'"); release(); await settle();
  assert.equal(run(s, 'FUNERGY_PV.on()'), false, 'the late answer is not used');
  assert.equal(run(s, 'FUNERGY_PV._TB().col'), null, 'nor kept');
});

test('signed-in people and the CEO/GM are unchanged by the tablet column', async () => {
  const c = app({ role: 'sl', user: 'G3 Leader', ss: p => p.action === 'pv_get' ? { ok: true, j: { pvfn: 1, pv: { ver: 2, at: '', cols: { tab: { 'p:vacation': 'h' }, g3: {} }, mine: {}, only: {} } } } : { status: 400 } });
  run(c, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(run(c, "navGuardAllows('vacation')"), true, 'the tablet column does not apply to a signed-in G3');
  assert.equal(c.FETCH.length, 0);
  const g = app();
  run(g, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(g.FETCH.length, 0); assert.equal(run(g, 'FUNERGY_PV.on()'), false);
});
