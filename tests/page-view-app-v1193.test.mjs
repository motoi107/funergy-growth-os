// v1193 (UI案95, Moto 11/18: all A + "view only"): the app side of 画面の表示 (FUNERGY_PV).
// - After the settings are saved, the nav uses them instead of the per-grade hidden pages (2A).
// - Columns: G1–G6 for store staff, AM / Head Chef / 経理・事務 for HQ, CEO and GM fixed (3A).
// - Strength: fixed > selected staff only > person > grade/role > today's rules.
// - A screen shown beyond today's role rules is view only: band, and the device does not save synced data
//   pressed on that screen (4A + "見るだけ"). G1 can only show/hide its own groups (8A).
// - The starting values (initialDoc) equal what each column sees today, plus the 16 pages for 経理・事務 (5A).
// - If the function is old, the SQL is missing or the answer cannot be read, the app keeps today's rules.
// Runs the real functions from index.html (and pvProject from the real function) in VMs with synthetic data.
// No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pvProject, pvCheck } from '../supabase/functions/secure-state/handler.mjs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnFrom(name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
const NAV_BLOCK = between('\nconst NAV_ITEMS = [', '\nvar curGroup = null;');
const ROLE_BLOCK = between('\nconst ROLE_CONFIG = {', '\nconst NAV_ITEMS = [');
const PV_BLOCK = between('/* ==== FUNERGY_PV（v1193', '/* ==== FUNERGY_PV end ==== */');
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const EMPS = [
  { id: 'e1', name: 'G1 Crew', role: 'crew', title: 'G1' },
  { id: 'e2', name: 'G2 Leader', role: 'g2', title: 'G2' },
  { id: 'e3', name: 'G3 Leader', role: 'sl', title: 'G3' },
  { id: 'e4', name: 'G4 Manager', role: 'g4', title: 'G4' },
  { id: 'e5', name: 'G5 Manager', role: 'g4', title: 'G5' },
  { id: 'e6', name: 'G6 Manager', role: 'g4', title: 'G6' },
  { id: 'e7', name: 'Area M', role: 'am', title: 'G5' },
  { id: 'e8', name: 'Head Chef', role: 'chef', title: 'G4' },
  { id: 'e9', name: 'Accountant', role: 'office', title: '' },
  { id: 'e10', name: 'Office Crew', role: 'office_crew', title: '' },
  { id: 'e11', name: 'General M', role: 'gm', title: 'G6' },
];
const ALIAS = { g2: 'sl', g4: 'am' };

function app(empId, opts) {
  opts = opts || {};
  const e = EMPS.find(x => x.id === empId);
  const store = new Map();
  const c = {
    curRole: ALIAS[e.role] || e.role, curRealRole: e.role, curStore: opts.store || (['office', 'office_crew', 'chef'].includes(e.role) ? 'OFFICE' : 'F01'),
    curStoreLogin: false, curUserName: e.name, curLang: opts.lang || 'ja', curPage: opts.page || '',
    TOASTS: [], CALLS: [], SS: opts.ss || null, GH: opts.gh || null, EMPS, Date, JSON, Math, Object, Array, String, Number, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console,
  };
  vm.createContext(c);
  vm.runInContext(`
    var window = this;
    var localStorage = { _m: new Map(), getItem(k){ return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v){ this._m.set(k, String(v)); }, removeItem(k){ this._m.delete(k); } };
    var document = { visibilityState:'visible', addEventListener(){}, getElementById(){ return null; }, createElement(){ return {}; } };
    var MASTER_ADMINS = [];
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m){ TOASTS.push(m); }
    function ls(k, d){ return (k === 'grade_hide' && GH) ? JSON.parse(JSON.stringify(GH)) : d; }
    function lsSet(){}
    function getRoleHide(){ return []; }
    function getEmployees(){ return EMPS; }
    function getVisibleStores(){ return []; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function gradeOf(title){ var m = /^G(\\d)/.exec(String(title||'')); return m ? 'G' + m[1] : ''; }
    function gradeNum(g){ return g ? (parseInt(String(g).replace('G',''))||0) : 0; }
    function myGradeNum(){ return parseInt(String(myGradeKey()).slice(1), 10) || 1; }
    function isOpSyncKey(k){ return /^(m_|spl_|tip_labor_|cash_tips_)/.test(k); }
    function lsIsDeviceLocal(k){ return k.charAt(0) === '_' || k === 'spl_device_x'; }
    function isLocalOnlyKey(k){ return k === 'local_only_x'; }
    var _SPLIT_KEYS = {}, SUPA_MASTER_MAP = { m_employees:{} }, SUPA_SETTING_KEYS = ['pl_public'], SUPA_SETTING_PREFIX = ['dailyops_template_'];
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
const flatNav = c => Array.from(run(c, 'groupsForRole()')).flatMap(g => Array.from(g.children)).filter(p => run(c, `navChildAllowed(${JSON.stringify(p)})`));
const EMP_COL = { e1: 'g1', e2: 'g2', e3: 'g3', e4: 'g4', e5: 'g5', e6: 'g6', e7: 'am', e8: 'chef', e9: 'acct', e10: 'acct' };

/* Turn the settings on for this user with a document, through the real afterLogin → pv_get path. */
async function withDoc(c, doc, empId) {
  const d = pvCheck(JSON.parse(JSON.stringify(doc)));
  c.SS = p => p.action === 'pv_get' ? { ok: true, j: { pvfn: 1, pv: Object.assign({ ver: 3, at: '2026-11-18T00:00:00Z' }, pvProject(d, empId)) } } : { status: 400, error: 'unknown_action' };
  run(c, 'FUNERGY_PV.afterLogin()');
  await settle();
  assert.equal(run(c, 'FUNERGY_PV.on()'), true, 'settings are on');
}
function initialDoc(gh) { const c = app('e11', { gh }); return JSON.parse(JSON.stringify(run(c, 'FUNERGY_PV._initialDoc()'))); }

test('release markers are 1193 or later and the same in the page and the service worker', () => {
  const a = src.match(/const APP_VERSION = '(\d+)';/), b = sw.match(/const SW_BUILD = '(\d+)';/);
  assert.ok(Number(a[1]) >= 1193); assert.equal(a[1], b[1]);
});

test('each person goes to the right column (CEO and GM have none; store sign-in has none)', () => {
  for (const [id, col] of Object.entries(EMP_COL)) assert.equal(run(app(id), 'FUNERGY_PV._myCol()'), col, id);
  assert.equal(run(app('e11'), 'FUNERGY_PV._myCol()'), null);
  const s = app('e3'); s.curStoreLogin = true; assert.equal(run(s, 'FUNERGY_PV._myCol()'), null);
  // the editor's column for an employee row is the same mapping
  const g = app('e11');
  for (const e of EMPS) assert.equal(run(g, `FUNERGY_PV._pvColOf(${JSON.stringify(e)})`), EMP_COL[e.id] || null, e.id);
});

test('the initial document is today\'s view for every column (with per-grade hidden pages), plus the 16 pages for 経理・事務 (5A)', () => {
  const GH = { G1: ['tiprate'], G2: ['tasks', 'hiring'], G3: ['labor'], G4: [], G5: ['purchase'], G6: [], _v1084: true };
  const doc = initialDoc(GH);
  const ACCT_NEW = run(app('e11'), 'FUNERGY_PV.ACCT_NEW');
  assert.equal(ACCT_NEW.length, 16);
  for (const [id, col] of Object.entries(EMP_COL)) {
    if (col === 'g1' || col === 'acct') continue;
    const today = new Set(flatNav(app(id, { gh: GH })));
    const c = app(id, { gh: GH });
    for (const [node, v] of Object.entries(doc.cols[col])) {
      if (!node.startsWith('p:')) continue;
      const pid = node.slice(2);
      assert.equal(v === 's', today.has(pid), `${col} ${pid}: initial ${v} vs today ${today.has(pid)}`);
    }
    // and nothing today is missing from the document (other than fixed pages)
    for (const pid of today) if (!['mypage', 'mid_review', 'ar_settings', 'growth_karte'].includes(pid)) assert.ok(('p:' + pid) in doc.cols[col] || run(c, `FUNERGY_PV._tree().every(g => g.children.indexOf(${JSON.stringify(pid)}) < 0)`), col + ' ' + pid);
  }
  // 経理・事務: what accountants (HQ or a store) or office crew see today, and the 16 pages, and KPI settings
  const union = new Set([...flatNav(app('e9', { gh: GH })), ...flatNav(app('e9', { gh: GH, store: 'F01' })), ...flatNav(app('e10', { gh: GH }))]);
  for (const [node, v] of Object.entries(doc.cols.acct)) {
    if (!node.startsWith('p:')) continue;
    const pid = node.slice(2);
    assert.equal(v === 's', union.has(pid) || ACCT_NEW.includes(pid) || pid === 'kpi_master', 'acct ' + pid);
  }
  for (const pid of ACCT_NEW) assert.equal(doc.cols.acct['p:' + pid], 's', pid);
  // G1: only groups; a group is hidden when every page in it is hidden today
  assert.equal(doc.cols.g1['g1:g_tip'], 'h'); assert.equal(doc.cols.g1['g1:g_store'], 's'); assert.ok(!('g1:g_mypage' in doc.cols.g1));
  // cards start shown; fixed pages and the approval center are not in the document
  for (const col of Object.keys(doc.cols)) {
    assert.equal(doc.cols[col]['c:times'], 's'); assert.equal(doc.cols[col]['c:exp'], 's');
    for (const f of ['mypage', 'mid_review', 'approval', 'ar_settings', 'growth_karte']) assert.ok(!(('p:' + f) in doc.cols[col]), col + ' ' + f);
  }
  // the document passes the server's checks as it is
  assert.ok(pvCheck(JSON.parse(JSON.stringify(doc))), 'the server accepts the starting values');
});

let VIEW_ONLY_E9 = [], EDIT_E9 = [];
test('saving the initial document changes nobody\'s nav except the new view-only pages for 経理・事務', async () => {
  const GH = { G2: ['tasks'], G5: ['purchase'], _v1084: true };
  const doc = initialDoc(GH);
  for (const id of Object.keys(EMP_COL)) {
    const before = flatNav(app(id, { gh: GH }));
    const c = app(id, { gh: GH });
    await withDoc(c, doc, id);
    const after = flatNav(c);
    if (EMP_COL[id] !== 'acct') { assert.deepEqual([...after].sort(), [...before].sort(), id); continue; }
    for (const p of before) assert.ok(after.includes(p), id + ' keeps ' + p);
    const added = after.filter(p => !before.includes(p));
    assert.ok(added.length > 0, id + ' gets new pages');
    // an accountant can edit what they already open when a store is chosen; everything else that is new is view only
    const atStore = id === 'e9' ? flatNav(app('e9', { gh: GH, store: 'F01' })) : [];
    for (const p of added) assert.equal(run(c, `FUNERGY_PV.ro(${JSON.stringify(p)})`), !atStore.includes(p), id + ' ' + p);
    if (id === 'e9') { VIEW_ONLY_E9 = added.filter(p => !atStore.includes(p)); EDIT_E9 = added.filter(p => atStore.includes(p)); }
    for (const p of before) assert.equal(run(c, `FUNERGY_PV.ro(${JSON.stringify(p)})`), false, id + ' ' + p + ' stays editable');
  }
});

test('office crew: the store master stays blocked by the code guard; accountants at HQ can edit what they open at a store', async () => {
  const doc = initialDoc(null);
  const oc = app('e10'); await withDoc(oc, doc, 'e10');
  assert.deepEqual(JSON.parse(JSON.stringify(run(oc, "FUNERGY_PV.decide('store_master')"))), { show: false, src: 'fixed' });
  assert.equal(run(oc, "navGuardAllows('store_master')"), false);
  assert.equal(run(oc, "FUNERGY_PV.ro('dashboard')"), true);
  // PR #197 のレビューの P3：従業員マスター・KPI設定は画面の中で事務Crew を断るので、出さない（入口だけ出て断られない）
  for (const pid of ['staff_master', 'kpi_master']) {
    assert.deepEqual(JSON.parse(JSON.stringify(run(oc, `FUNERGY_PV.decide('${pid}')`))), { show: false, src: 'fixed' }, pid);
    assert.equal(run(oc, `navChildAllowed('${pid}')`), false, pid + ' is not in the office crew nav');
    assert.equal(run(oc, `FUNERGY_PV.ro('${pid}')`), false, pid);
  }
  assert.ok(!flatNav(oc).includes('staff_master') && !flatNav(oc).includes('kpi_master'));
  assert.equal(run(oc, "FUNERGY_PV.ro('inventory')"), true, 'the other new pages stay view only for office crew');
  const ac = app('e9'); await withDoc(ac, doc, 'e9');
  assert.equal(run(ac, "navGuardAllows('store_master')"), true);
  assert.ok(flatNav(ac).includes('staff_master') && flatNav(ac).includes('kpi_master'), 'accountants open both');
  assert.equal(run(ac, "FUNERGY_PV.ro('staff_master')"), false);
  assert.equal(run(ac, "FUNERGY_PV.ro('dashboard')"), false, 'an accountant already opens it when a store is chosen');
  // new pages are placed together, under a group named like the menu group
  const groups = run(oc, 'groupsForRole()');
  const g = groups.find(x => x.children.includes('dashboard'));
  assert.ok(g && g.children.includes('store_cmd'), 'dashboard and store operations are in the same group');
  const acctG = Array.from(groups).find(x => Array.from(x.children).includes('ingredient_master'));
  assert.ok(acctG && Array.from(acctG.children).includes('menu') && Array.from(acctG.children).includes('inventory'), 'menu and inventory join the group that has the ingredient master');
  assert.ok(groups.every(x => x.children.length > 0));
});

test('strength order: fixed > selected staff only > person > grade/role', async () => {
  const doc = initialDoc(null);
  doc.cols.g3['p:labor'] = 's'; doc.cols.g3['p:tip'] = 'h';
  doc.people.e3 = { 'p:tip': 's', 'p:hiring': 'h' };
  doc.only['p:labor'] = ['e7'];             // e3 is not in the list → hidden even though the column shows it
  doc.only['p:hiring'] = ['e3'];            // e3 is in the list, but their person value hides it
  doc.only['p:tasks'] = ['e3'];             // e3 is in the list → shown
  const c = app('e3'); await withDoc(c, doc, 'e3');
  const d = p => JSON.parse(JSON.stringify(run(c, `FUNERGY_PV.decide(${JSON.stringify(p)})`)));
  assert.deepEqual(d('labor'), { show: false, src: 'only' });
  assert.deepEqual(d('hiring'), { show: false, src: 'person' });
  assert.deepEqual(d('tip'), { show: true, src: 'person' });
  assert.deepEqual(d('tasks'), { show: true, src: 'only' });
  assert.equal(run(c, "FUNERGY_PV.decide('mypage')"), null, 'fixed');
  assert.equal(run(c, "navChildAllowed('approval')"), false);
  assert.equal(run(c, "isPageHiddenForMe('labor')"), true);
  assert.equal(run(c, "navGuardAllows('labor')"), false);
  const nav = flatNav(c);
  assert.ok(nav.includes('tip') && nav.includes('tasks') && !nav.includes('labor') && !nav.includes('hiring'));
  assert.ok(Array.from(run(c, 'groupsForRole()')).every(g => !Array.from(g.children).includes('labor')), 'hidden pages are taken out of the groups');
  // someone else in the list sees labor
  const a = app('e7'); await withDoc(a, doc, 'e7'); assert.ok(flatNav(a).includes('labor'));
});

test('G1: groups can be hidden (never widened); hiding the store group closes store operations', async () => {
  const doc = initialDoc(null);
  doc.cols.g1['g1:g_store'] = 'h'; doc.cols.g1['c:times'] = 'h';
  const c = app('e1'); await withDoc(c, doc, 'e1');
  const ids = run(c, 'groupsForRole()').map(g => g.id);
  assert.ok(!ids.includes('g_store') && ids.includes('g_mypage') && ids.includes('g_chat'));
  assert.equal(run(c, "navGuardAllows('store_cmd')"), false);
  assert.equal(run(c, "isPageHiddenForMe('store_cmd')"), true);
  assert.equal(run(c, "FUNERGY_PV.decide('chat')"), null, 'shown groups keep today\'s rules');
  assert.equal(run(c, "FUNERGY_PV.ro('chat')"), false);
  assert.equal(run(c, "FUNERGY_PV.cardShown('times')"), false);
  assert.equal(run(c, "FUNERGY_PV.cardShown('exp')"), true);
  // a page outside the G1 rules cannot be opened by a G1 column value
  doc.cols.g1['p:budget'] = 's';
  assert.equal(pvCheck(JSON.parse(JSON.stringify(doc))), null, 'the server refuses page nodes in the G1 column');
});

test('view only: synced writes and server saves pressed on the screen are refused; background and local writes are not', async () => {
  const doc = initialDoc(null);
  const c = app('e10', { page: 'inventory' }); await withDoc(c, doc, 'e10');
  assert.equal(run(c, "FUNERGY_PV.ro('inventory')"), true);
  const press = () => run(c, "Object.assign(FUNERGY_PV._G, { at: Date.now(), page: curPage, inPage: true, live: true })");
  press();
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('m_employees')"), true);
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('spl_lss_x')"), true);
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('_device_mark')"), false, 'device-only keys are written');
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('spl_device_x')"), false, 'a device-only key that looks synced is written');
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('local_only_x')"), false);
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('fav_pages')"), false);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'put', key:'m_employees' })"), true);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'pii_op' })"), true);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'pv_get' })"), false);
  assert.ok(c.TOASTS.some(m => /見るだけ/.test(m)));
  // the press was outside the page (the nav) → not refused
  run(c, "Object.assign(FUNERGY_PV._G, { inPage: false })");
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('m_employees')"), false);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'put', key:'m_employees' })"), false);
  // long after the press (a background import) → not refused
  run(c, "Object.assign(FUNERGY_PV._G, { at: Date.now() - 60000, inPage: true, live: false })");
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('m_employees')"), false);
  assert.equal(run(c, "FUNERGY_PV.callBlocked({ action:'pii_op' })"), false);
  // on a page that is editable today → not refused
  press(); c.curPage = 'acct_center'; run(c, "FUNERGY_PV._G.page = curPage");
  assert.equal(run(c, "FUNERGY_PV.writeBlocked('m_employees')"), false);
});

test('fallbacks: old function, SQL missing, turned off, unreadable answer and another sign-in keep today\'s rules', async () => {
  const GH = { G3: ['labor'], _v1084: true };
  const base = flatNav(app('e3', { gh: GH }));
  assert.ok(!base.includes('labor'));
  for (const ans of [{ status: 400, error: 'unknown_action' }, { ok: true, j: { pvfn: 1, pv: null, nosql: true } }, { ok: true, j: { pvfn: 1, pv: null, off: true, ver: 2 } }, { legacy: true }, { none: true }]) {
    const c = app('e3', { gh: GH, ss: () => ans });
    run(c, 'FUNERGY_PV.afterLogin()'); await settle();
    assert.equal(run(c, 'FUNERGY_PV.on()'), false, JSON.stringify(ans));
    assert.deepEqual(flatNav(c), base, JSON.stringify(ans));
  }
  // network failure keeps the last copy for the same person only
  const doc = initialDoc(GH); doc.cols.g3['p:labor'] = 's';
  const c = app('e3', { gh: GH }); await withDoc(c, doc, 'e3');
  assert.ok(flatNav(c).includes('labor'));
  c.SS = () => ({ net: true });
  run(c, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(run(c, 'FUNERGY_PV.on()'), true, 'the copy is used when the answer cannot be read');
  // another person on the same device does not get that copy
  c.curUserName = 'G2 Leader'; c.curRealRole = 'g2'; c.curRole = 'sl';
  run(c, 'FUNERGY_PV.afterLogin()'); await settle();
  assert.equal(run(c, 'FUNERGY_PV.on()'), false);
  // an answer that arrives after the sign-in changed is dropped
  let release; const slow = new Promise(r => { release = r; });
  const d2 = app('e3', { gh: GH }); d2.SS = () => slow;
  run(d2, 'FUNERGY_PV.afterLogin()'); await tick();
  d2.curUserName = 'G2 Leader'; d2.curRealRole = 'g2'; d2.curRole = 'sl';
  release({ ok: true, j: { pvfn: 1, pv: Object.assign({ ver: 1, at: '' }, pvProject(pvCheck(JSON.parse(JSON.stringify(doc))), 'e3')) } }); await settle();
  assert.equal(run(d2, 'FUNERGY_PV.on()'), false);
  assert.notEqual(run(d2, 'FUNERGY_PV._P().state'), 'on', 'the late answer for the previous person is dropped');
  assert.equal(d2.localStorage._m.size, 0, 'and not kept on the device');
  // sign out clears it (and the same person is not active again until they sign in)
  const lo = app('e3', { gh: GH }); await withDoc(lo, doc, 'e3');
  run(lo, 'FUNERGY_PV.onLogout()'); assert.equal(run(lo, 'FUNERGY_PV.on()'), false);
  assert.ok(flatNav(lo).every(p => p !== 'labor'), 'back to today\'s rules');
});

test('CEO and GM always see everything; the settings card points to the new tab', async () => {
  const doc = initialDoc(null);
  for (const col of Object.keys(doc.cols)) for (const k of Object.keys(doc.cols[col])) doc.cols[col][k] = 'h';
  const g = app('e11');
  const before = flatNav(g);
  await withDoc(g, doc, 'e11');
  assert.deepEqual(flatNav(g), before);
  assert.equal(run(g, "FUNERGY_PV.ro('dashboard')"), false);
  assert.equal(run(g, "FUNERGY_PV.decide('dashboard')"), null);
  assert.match(run(g, 'FUNERGY_PV.settingsCard()'), /FUNERGY_PV\.openEditor\(\)/);
  assert.doesNotMatch(run(g, 'FUNERGY_PV.settingsCard()'), /grade-hide|renderGradeHideConfig/);
});

test('editor (CEO・GM): view-only badges per role, a conflicting save keeps my change on top of theirs, then saves', async () => {
  const g = app('e11');
  const saved = [], doc0 = initialDoc(null);
  let step = 0;
  g.SS = p => {
    if (p.action === 'pv_full') {
      if (step === 0) return { ok: true, j: { pvfn: 1, pv: null, ver: 0 } };
      const theirs = JSON.parse(JSON.stringify(doc0)); theirs.cols.g3['p:tip'] = 'h';
      return { ok: true, j: { pvfn: 1, ver: 5, pv: { ver: 5, at: '2026-11-18T01:00:00Z', by_name: 'CEO', doc: pvCheck(theirs) } } };
    }
    if (p.action === 'pv_save') { saved.push(JSON.parse(JSON.stringify(p))); step++; return step === 1 ? { status: 409, error: 'conflict' } : { ok: true, j: { pvfn: 1, ok: true, ver: 6, at: '' } }; }
    return { ok: true, j: { pvfn: 1, pv: null } };
  };
  run(g, 'FUNERGY_PV.editorHtml()'); await settle();
  const html = run(g, 'FUNERGY_PV.editorHtml()');
  const cell = (col, pid) => { const m = html.match(new RegExp("h\\.cell\\('" + col + "','p:" + pid + "'\\)\">[^<]*</button>(<span class=\"pv-new\"[^>]*>([^<]*)</span>)?")); return m ? (m[2] || '') : null; };
  assert.equal(cell('acct', 'dashboard'), '事務Crew は見るだけ', 'accountants open the dashboard at a store; office crew does not');
  assert.equal(cell('acct', 'shift_admin'), '新・見るだけ', 'nobody in accounting opens shift admin today');
  assert.equal(cell('acct', 'invoice'), '', 'already open for accounting');
  assert.equal(cell('g3', 'budget'), '');
  assert.equal(cell('g2', 'store_master'), null, 'the code guard: no button');
  assert.ok(/h\.cell\('acct','p:store_master'\)">[^<]*<\/button><span class="pv-ml"/.test(html), 'store master: accounting managers and leads only (no view-only mark; office crew is blocked by the code guard)');
  // the staff master and KPI settings refuse office crew inside the screen (PR #197 review P3-1): treated like the code guard
  for (const pid of ['staff_master', 'kpi_master']) {
    assert.ok(new RegExp("h\\.cell\\('acct','p:" + pid + "'\\)\">[^<]*</button><span class=\"pv-ml\"").test(html), pid + ': M・L (accounting managers and leads only)');
    const ex = role => JSON.parse(JSON.stringify(run(g, `FUNERGY_PV._explain({ col:'acct', id:'x', e:{ role:'${role}' } }, '${pid}')`)));
    assert.equal(ex('office_crew').show, false, pid + ': office crew — not shown');
    assert.equal(ex('office_crew').src, 'コードの守り', pid + ': and the reason is the code guard');
    assert.equal(ex('office').show, true, pid + ': accountants keep it');
  }
  // change one cell, save with a reason; someone else saved first
  run(g, "FUNERGY_PV.h.cell('g3','p:labor')");
  run(g, "FUNERGY_PV.h.reason('G3 も人件費を見る')");
  run(g, 'FUNERGY_PV.h.save()'); await settle();
  assert.equal(saved.length, 1); assert.equal(saved[0].expect, 0); assert.equal(saved[0].doc.cols.g3['p:labor'], doc0.cols.g3['p:labor'] === 's' ? 'h' : 's');
  assert.ok(saved[0].summary.length >= 1);
  const E1 = JSON.parse(JSON.stringify(run(g, 'FUNERGY_PV._E()')));
  assert.equal(E1.band, 'conflict'); assert.equal(E1.ver, 5);
  assert.equal(E1.draft.cols.g3['p:labor'], saved[0].doc.cols.g3['p:labor'], 'my change is kept');
  assert.equal(E1.draft.cols.g3['p:tip'], 'h', 'their change is kept');
  run(g, 'FUNERGY_PV.h.save()'); await settle();
  assert.equal(saved.length, 2); assert.equal(saved[1].expect, 5);
  assert.ok(pvCheck(saved[1].doc), 'the saved document has the shape the server accepts');
  const E2 = JSON.parse(JSON.stringify(run(g, 'FUNERGY_PV._E()')));
  assert.equal(E2.ver, 6); assert.equal(E2.band, ''); assert.equal(E2.reason, '');
  assert.ok(g.CALLS.some(c => c.action === 'pv_get'), 'reads its own copy again after saving');
});

test('editor helpers: a conflicting save keeps only my own changes on top of the new values', () => {
  const c = app('e11');
  const base = { v: 1, off: false, cols: { g2: { 'p:tasks': 's', 'p:tip': 's' } }, people: {}, only: {} };
  const mine = { v: 1, off: false, cols: { g2: { 'p:tasks': 'h', 'p:tip': 's' } }, people: { e2: { 'p:labor': 's' } }, only: {} };
  const theirs = { v: 1, off: false, cols: { g2: { 'p:tasks': 's', 'p:tip': 'h' } }, people: {}, only: { 'p:hiring': ['e3'] } };
  const out = JSON.parse(JSON.stringify(run(c, `FUNERGY_PV._rebase(${JSON.stringify(base)}, ${JSON.stringify(mine)}, ${JSON.stringify(theirs)})`)));
  assert.equal(out.cols.g2['p:tasks'], 'h', 'mine');
  assert.equal(out.cols.g2['p:tip'], 'h', 'theirs kept');
  assert.equal(out.people.e2['p:labor'], 's');
  assert.deepEqual(out.only['p:hiring'], ['e3']);
  // core: the order of strength
  const core = (o, p, v) => JSON.parse(JSON.stringify(run(c, `FUNERGY_PV._core(${JSON.stringify(o)}, ${JSON.stringify(p)}, ${JSON.stringify(v)})`)));
  assert.deepEqual(core(false, 's', 's'), { show: false, src: 'only' });
  assert.deepEqual(core(true, 'h', 's'), { show: false, src: 'person' });
  assert.deepEqual(core(true, undefined, 'h'), { show: true, src: 'only' });
  assert.deepEqual(core(undefined, undefined, 'h'), { show: false, src: 'col' });
  assert.equal(run(c, 'FUNERGY_PV._core(undefined, undefined, undefined)'), null);
});

test('wiring: the nav, guards, writes, server calls, settings, sign-in and sign-out use the module; English labels exist', () => {
  assert.match(src, /function groupsForRole\(\) \{\n  var groups = _navBaseGroups\(\);/);
  assert.match(src, /FUNERGY_PV\.writeBlocked\(key\)\) return false;\n  var sp = _SPLIT_KEYS/);
  assert.match(src, /FUNERGY_PV\.callBlocked\(payload\)\) return \{ status:403, error:'view_only' \};/);
  assert.match(src, /FUNERGY_PV\.settingsCard\(\) : renderGradeHideConfig\(\)/);
  assert.match(src, /if \(window\.FUNERGY_PV\) FUNERGY_PV\.afterLogin\(\);/);
  assert.match(src, /if\(window\.FUNERGY_PV\) FUNERGY_PV\.onLogout\(\);/);
  assert.equal((src.match(/if\(window\.FUNERGY_PV\) FUNERGY_PV\.band\(page\);/g) || []).length, 2, 'both renderPage copies show the band');
  assert.match(src, /FUNERGY_PV\.cardShown\('times'\)/);
  assert.equal((src.match(/FUNERGY_PV\.cardShown\('exp'\)/g) || []).length, 2);
  assert.match(src, /if \(A\.tab === 'pv' && W\.FUNERGY_PV\) return tabsBar/);
  assert.match(src, /'そのほか':'Other','画面の表示':'Screen visibility'/);
  // the module keeps nothing but its own copy on the device
  assert.ok(!/localStorage\.setItem\((?!CACHE_KEY|TAB_CACHE)/.test(PV_BLOCK));   // v1197：店のタブレットの列の写し（秘密ではない）も
});
