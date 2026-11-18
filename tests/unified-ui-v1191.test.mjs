// v1191 (unified UI, first confirmed slice; Moto's answers 11/18: 2A, 3B "secure page is CEO/GM only, accounting removed",
// 4B, 5B, 9A, 10 = https://times.funergygroup.com/).
// - One rule decides whether a screen opens: the nav (navChildAllowed) and every way in (go/renderPage via navResolvePage)
//   ask the same PAGE_GUARD. A G1 sign-in only opens its nav pages and the pages its own screens link to.
// - The big "経理レビュー" tab moved into 経理センター › 経理レビュー (the same renderAcctReview body).
// - Nav labels no longer show raw ids (acct_export / monthly); the empty "profile" page is gone.
// - The admin secure page is for the CEO and GM only (accounting is refused at sign-in and on open).
// - Individual pay (others' wages, the title pay table, HQ payroll card/CSV) is CEO/GM only; totals stay as before.
// - FUNERGY TIMES: one setting (CEO/GM), an https funergygroup.com address only, a link on everyone's My Page.
// Runs the real functions from index.html in VMs with synthetic data. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnFrom(name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }

const NAV_BLOCK = between('\nconst NAV_ITEMS = [', '\nvar curGroup = null;');

function navApp(role, opts) {
  opts = opts || {};
  const c = {
    curRole: role, curRealRole: opts.realRole || role, curStore: opts.store || 'F01', curStoreLogin: !!opts.storeLogin,
    curUserName: 'Test User', curLang: 'ja', budgetTab: 'daily', workTab: 'today', officeMgrTab: 'dash', _acCat: 'docs', _acSub: 'x',
    TOASTS: [], window: {}, Date,
  };
  vm.createContext(c);
  vm.runInContext(`
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m){ TOASTS.push(m); }
    function ls(k, d){ return d; }
    function getRoleHide(){ return []; }
    function getEmployees(){ return []; }
    function getVisibleStores(){ return []; }
    function escapeHtml(s){ return String(s==null?'':s); }
    ${NAV_BLOCK}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const ALL_GROUP_ARRAYS = ['MENU_GROUPS', 'OFFICE_GROUPS', 'ACCT_GROUPS', 'CHEF_GROUPS', 'CREW_GROUPS', 'STORE_GROUPS'];

test('release markers are 1191 in the page and the service worker', () => {
  assert.match(src, /const APP_VERSION = '1191';/);
  assert.match(sw, /const SW_BUILD = '1191';/);
});

test('G1 (personal sign-in): accounting, store master, approval rules, settings, the karte and management pages do not open by a direct way in', () => {
  const c = navApp('crew', { store: 'F01' });
  for (const p of ['acct_center', 'acct_review', 'office_mgr', 'store_master', 'ar_settings', 'growth_karte', 'settings', 'hr', 'acct_export', 'monthly', 'budget', 'dashboard', 'staff_master']) {
    assert.equal(run(c, `navResolvePage(${JSON.stringify(p)})`), 'mypage', p);
  }
  assert.ok(c.TOASTS.length >= 1, 'a short notice (once per 2 s) says the screen is not available');
  for (const p of ['mypage', 'discount', 'crew_handbook', 'shift_staff', 'skill', 'ojtmap', 'tiprate', 'store_cmd', 'chat', 'vacation', 'expense', 'mileage', 'lost_receipt', 'goals', 'onboarding', 'notifications']) {
    assert.equal(run(c, `navResolvePage(${JSON.stringify(p)})`), p, p + ' (nav or a button on a G1 screen) still opens');
  }
  // every page in the G1 nav opens
  for (const g of run(c, 'groupsForRole()')) for (const p of g.children) assert.equal(run(c, `navGuardAllows(${JSON.stringify(p)})`), true, p);
});

test('store tablet (shared store sign-in) is unchanged for its own pages and cannot open the guarded ones', () => {
  const c = navApp('sl', { storeLogin: true, store: 'F01' });
  for (const p of ['store_cmd', 'shift_admin', 'inventory', 'vacation']) assert.equal(run(c, `navResolvePage(${JSON.stringify(p)})`), p, p);
  for (const p of ['acct_center', 'ar_settings', 'store_master', 'growth_karte', 'settings']) assert.equal(run(c, `navResolvePage(${JSON.stringify(p)})`), 'store_cmd', p);
});

test('accounting (office at HQ): the old 経理レビュー tab opens 経理センター › 経理レビュー; CEO/GM-only pages do not open', () => {
  const c = navApp('office', { store: 'OFFICE' });
  assert.equal(run(c, "navResolvePage('acct_review')"), 'acct_center');
  assert.equal(c._acCat, 'review'); assert.equal(c._acSub, 'acctrev');
  for (const p of ['ar_settings', 'growth_karte']) assert.notEqual(run(c, `navResolvePage(${JSON.stringify(p)})`), p, p);
  assert.equal(run(c, "navResolvePage('acct_export')"), 'acct_export');
  assert.equal(run(c, "navResolvePage('store_master')"), 'store_master');
  const ids = run(c, 'groupsForRole()').flatMap(g => g.children);
  assert.ok(ids.includes('acct_center') && !ids.includes('acct_review') && !ids.includes('office_mgr'), 'the HQ menu shows 経理センター (not the old tab names)');
});

test('事務Crew: same menu as accounting but 経理出力 (payroll export) is not offered, and its direct way in is closed', () => {
  const c = navApp('office_crew', { store: 'OFFICE' });
  assert.equal(run(c, "navChildAllowed('acct_export')"), false);
  assert.notEqual(run(c, "navResolvePage('acct_export')"), 'acct_export');
  assert.equal(run(c, "navResolvePage('acct_center')"), 'acct_center');
});

test('CEO and GM open every page; acct_review still lands inside 経理センター', () => {
  for (const r of ['ceo', 'gm']) {
    const c = navApp(r, { store: 'OFFICE' });
    for (const p of ['ar_settings', 'growth_karte', 'store_master', 'acct_export', 'settings', 'budget']) assert.equal(run(c, `navResolvePage(${JSON.stringify(p)})`), p, r + ' ' + p);
    assert.equal(run(c, "navResolvePage('acct_review')"), 'acct_center', r);
  }
});

test('every role: each page the nav shows also opens (nav and direct way in agree); "profile" goes to My Page', () => {
  const cases = [['ceo', { store: 'OFFICE' }], ['gm', { store: 'OFFICE' }], ['office', { store: 'OFFICE' }], ['office_crew', { store: 'OFFICE' }],
    ['chef', { store: 'OFFICE' }], ['am', { store: 'F01' }], ['sl', { store: 'F01' }], ['crew', { store: 'F01' }], ['sl', { store: 'F01', storeLogin: true }]];
  for (const [r, o] of cases) {
    const c = navApp(r, o);
    for (const g of run(c, 'groupsForRole()')) for (const p of g.children) {
      if (!run(c, `navChildAllowed(${JSON.stringify(p)})`)) continue;
      assert.equal(run(c, `navGuardAllows(${JSON.stringify(p)})`), true, r + (o.storeLogin ? '(tablet)' : '') + ' ' + p);
    }
    assert.equal(run(c, "navResolvePage('profile')"), run(c, "navPageAllowed('mypage')") ? 'mypage' : run(c, 'navHomePage()'), r + ' (retired page: My Page if it is in this menu, else home)');
  }
});

test('menus: no raw ids as labels, no empty "profile" page, the big 経理レビュー tab is gone from the store menu', () => {
  const c = navApp('gm', { store: 'OFFICE' });
  for (const arr of ALL_GROUP_ARRAYS) {
    for (const g of run(c, arr)) for (const p of g.children) {
      const it = run(c, `navItemById(${JSON.stringify(p)})`);
      assert.notEqual(it.label, p, `${arr} › ${g.id} › ${p} has a real name`);
      assert.notEqual(p, 'profile', `${arr} › ${g.id}`);
    }
  }
  assert.equal(run(c, "MENU_GROUPS.some(function(g){ return g.id==='g_acct_review'; })"), false);
  assert.equal(run(c, "navItemById('acct_export').label"), '経理出力');
  assert.equal(run(c, "navItemById('monthly').label"), '月次サマリー');
});

test('the work-requests list inside 経理センター › 経理レビュー redraws there (not only on the old page id)', () => {
  const wr = between('function onAcct(){', 'function rerenderAcct(){');
  assert.match(wr, /arOnPage\(\)/);
});

// ---------- secure page ----------
function secApp(session) {
  const c = { window: { _authSession: session }, curLang: 'ja' };
  vm.createContext(c);
  vm.runInContext(`${fnFrom('secureRoleAllowed')}\n${fnFrom('secureSessionAllowed')}`, c);
  return c;
}
test('admin secure page: CEO and GM only; accounting is refused at sign-in, on open and on the My Page card', () => {
  assert.equal(run(secApp({ access_token: 'x', role: 'ceo' }), 'secureSessionAllowed()'), true);
  assert.equal(run(secApp({ access_token: 'x', role: 'gm' }), 'secureSessionAllowed()'), true);
  assert.equal(run(secApp({ access_token: 'x', role: 'office' }), 'secureSessionAllowed()'), false);
  assert.equal(run(secApp(null), 'secureSessionAllowed()'), false);
  assert.match(fnFrom('doManagerLogin'), /secureRoleAllowed\(rows\[0\]\.role\)/, 'sign-in refuses an accounting account and clears the session');
  assert.match(fnFrom('showManagerSecure'), /secureSessionAllowed\(\)/);
  assert.match(fnFrom('renderSecureBody'), /secureSessionAllowed\(\)/);
  assert.match(src, /secureSessionAllowed === 'function' && secureSessionAllowed\(\) \? '<button class="btn btn-primary btn-sm" onclick="FUNERGY_ML\.openSecure\(\)"/);
});

// ---------- individual pay ----------
function wageApp(role, opts) {
  opts = opts || {};
  const c = { curRole: role, curUserName: 'Me', curLang: 'ja', OPENED: [], TOASTS: [], ROLE_CONFIG: { office_crew: { noWage: true } },
    JOB_TITLES: [{ key: 'Crew', label: 'Crew', payType: 'hourly' }, { key: 'Office Manager', label: 'Accounting Manager', payType: 'monthly' }] };
  vm.createContext(c);
  vm.runInContext(`
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function salaryVisibleToMe(){ return ${opts.hidden ? 'false' : 'true'}; }
    function showToast(m){ TOASTS.push(m); } function openModal(h){ OPENED.push(h); }
    function getTitleWageTable(){ return {}; } function lsSet(){ SAVED = true; } var SAVED = false;
    function closeModalDirect(){} function renderPage(){}
    var document = { getElementById: function(){ return null; } };
    ${fnFrom('canViewIndividualWage')}
    ${fnFrom('canEditWages')}
    ${fnFrom('canViewWageOf')}
    ${fnFrom('openTitleWageModal')}
    ${fnFrom('saveTitleWageTable')}
  `, c);
  return c;
}
test('individual pay: only CEO and GM see others’ wages and the title pay table; accounting sees totals only', () => {
  for (const r of ['ceo', 'gm']) assert.equal(run(wageApp(r), 'canViewIndividualWage()'), true, r);
  for (const r of ['office', 'office_crew', 'am', 'chef', 'sl', 'crew']) assert.equal(run(wageApp(r), 'canViewIndividualWage()'), false, r);
  assert.equal(run(wageApp('office'), "canViewWageOf({name:'Other'})"), false, 'accounting: not another person’s wage');
  assert.equal(run(wageApp('office'), "canViewWageOf({name:'Me'})"), true, 'accounting: still their own');
  assert.equal(run(wageApp('gm', { hidden: true }), 'canViewIndividualWage()'), false, 'the company-wide "hide pay" switch still wins');
  const o = wageApp('office'); run(o, 'openTitleWageModal()'); assert.equal(o.OPENED.length, 0); assert.equal(o.TOASTS.length, 1);
  run(o, 'saveTitleWageTable()'); assert.equal(o.SAVED, false, 'accounting cannot save the title pay table');
  const g = wageApp('gm'); run(g, 'openTitleWageModal()'); assert.equal(g.OPENED.length, 1);
  assert.match(src, /\$\{canViewIndividualWage\(\)\?`<button class="btn btn-secondary btn-sm" onclick="openTitleWageModal\(\)">/, 'the button is shown to CEO/GM only');
  assert.match(fnFrom('exportOfficePayrollCSV'), /^function exportOfficePayrollCSV\(y,m,half\)\{\n  if\(!canViewIndividualWage\(\)\)/);
  assert.match(fnFrom('officePayrollCardHtml'), /^function officePayrollCardHtml\(y,m\)\{\n  if\(!canViewIndividualWage\(\)\) return '';/);
});

// ---------- FUNERGY TIMES ----------
const TIMES_BLOCK = between("var TIMES_DEFAULT_URL = ", "\n/* 店舗別メッセージ");
function timesApp(role, stored) {
  const store = { funergy_times: stored === undefined ? null : JSON.parse(JSON.stringify(stored)) };
  const c = { curRole: role, curUserName: 'Moto', curLang: 'ja', curPage: 'mypage', TOASTS: [], OPENED: [], STORE: store, FIELDS: {}, ROLE_CONFIG: { gm: { name: 'GM' } }, URL };
  vm.createContext(c);
  vm.runInContext(`
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) && STORE[k] != null ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function showToast(m, ty){ TOASTS.push([m, ty]); } function openModal(h){ OPENED.push(h); } function closeModalDirect(){} function renderPage(){}
    function langDateLocale(){ return 'ja'; }
    var document = { getElementById: function(id){ return Object.prototype.hasOwnProperty.call(FIELDS, id) ? { value: FIELDS[id] } : null; } };
    ${TIMES_BLOCK}
  `, c);
  return c;
}
test('FUNERGY TIMES: only https addresses on funergygroup.com (and below) are used; anything else falls back to the default', () => {
  const c = timesApp('crew');
  assert.equal(run(c, 'TIMES_DEFAULT_URL'), 'https://times.funergygroup.com/');
  const ok = ['https://times.funergygroup.com/', 'https://funergygroup.com/times', 'https://times.funergygroup.com/2026/11?x=1'];
  for (const u of ok) assert.ok(run(c, `timesHostOk(${JSON.stringify(u)})`), u);
  const bad = ['http://times.funergygroup.com/', 'https://times.funergygroup.com.evil.example/', 'https://evilfunergygroup.com/', 'javascript:alert(1)',
    'https://user:pw@times.funergygroup.com/', 'https://times.funergygroup.com:8443/', 'data:text/html,hi', '//times.funergygroup.com/', '', ' ', 'x'.repeat(600)];
  for (const u of bad) { assert.equal(run(c, `timesHostOk(${JSON.stringify(u)})`), '', u); assert.equal(run(c, `timesSafeUrl(${JSON.stringify(u)})`), 'https://times.funergygroup.com/', u); }
  assert.equal(run(c, 'timesSafeUrl(42)'), 'https://times.funergygroup.com/');
});

test('FUNERGY TIMES card: everyone gets it; a written-in bad address or HTML in the title cannot get through', () => {
  const plain = timesApp('crew');
  const h0 = run(plain, 'timesCardHtml()');
  assert.match(h0, /href="https:\/\/times\.funergygroup\.com\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(h0, /FUNERGY TIMES/);
  assert.doesNotMatch(h0, /<img/, 'no cover unless one was entered');
  assert.doesNotMatch(h0, /号/, 'no made-up issue title or month');
  const bad = timesApp('crew', { url: 'javascript:alert(1)', title: '<img src=x onerror=alert(1)>"', month: '2026-13', cover: 'https://evil.example/x.png', at: 1 });
  const h1 = run(bad, 'timesCardHtml()');
  assert.match(h1, /href="https:\/\/times\.funergygroup\.com\/"/);
  assert.doesNotMatch(h1, /javascript:|<img src=x|evil\.example/);
  assert.match(h1, /&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  const set = timesApp('crew', { url: 'https://times.funergygroup.com/2026-11', title: '11月号の特集', month: '2026-11', cover: 'https://times.funergygroup.com/c.jpg', at: 1 });
  const h2 = run(set, 'timesCardHtml()');
  assert.match(h2, /href="https:\/\/times\.funergygroup\.com\/2026-11"/);
  assert.match(h2, /11月号の特集 · 2026年11月号/);
  assert.match(h2, /<img src="https:\/\/times\.funergygroup\.com\/c\.jpg"[^>]*referrerpolicy="no-referrer"/);
});

test('FUNERGY TIMES settings: CEO/GM only; bad addresses are refused; the previous setting is kept in the history', () => {
  for (const r of ['office', 'office_crew', 'am', 'sl', 'crew', 'chef']) {
    const c = timesApp(r);
    assert.equal(run(c, 'timesSettingsCardHtml()'), '', r);
    run(c, 'openTimesSettings()'); assert.equal(c.OPENED.length, 0, r);
    c.FIELDS['tm-url'] = 'https://times.funergygroup.com/x';
    run(c, 'saveTimesSettings()'); assert.equal(c.STORE.funergy_times, null, r + ' cannot save');
  }
  const g = timesApp('gm', { url: 'https://times.funergygroup.com/', title: '10月号', month: '2026-10', by: 'CEO', at: 1000 });
  assert.match(run(g, 'timesSettingsCardHtml()'), /data-times-set="1"/);
  run(g, 'openTimesSettings()'); assert.equal(g.OPENED.length, 1);
  g.FIELDS = { 'tm-url': 'http://times.funergygroup.com/', 'tm-title': 'x', 'tm-month': '', 'tm-cover': '' };
  run(g, 'saveTimesSettings()');
  assert.equal(g.STORE.funergy_times.title, '10月号', 'http is refused, nothing saved');
  g.FIELDS = { 'tm-url': 'https://times.funergygroup.com/', 'tm-title': 'x', 'tm-month': '', 'tm-cover': 'https://evil.example/c.png' };
  run(g, 'saveTimesSettings()');
  assert.equal(g.STORE.funergy_times.title, '10月号', 'a cover outside funergygroup.com is refused');
  g.FIELDS = { 'tm-url': ' https://times.funergygroup.com/2026-11 ', 'tm-title': '11月号', 'tm-month': '2026-11', 'tm-cover': '' };
  run(g, 'saveTimesSettings()');
  const v = g.STORE.funergy_times;
  assert.equal(v.url, 'https://times.funergygroup.com/2026-11');
  assert.equal(v.title, '11月号'); assert.equal(v.month, '2026-11'); assert.equal(v.by, 'Moto'); assert.ok(v.at > 1000);
  assert.equal(v.hist.length, 1); assert.equal(v.hist[0].title, '10月号'); assert.equal(v.hist[0].by, 'CEO');
  for (let i = 0; i < 14; i++) { g.FIELDS['tm-title'] = 'n' + i; run(g, 'saveTimesSettings()'); }
  assert.equal(g.STORE.funergy_times.hist.length, 10, 'history keeps the last 10');
});

test('FUNERGY TIMES: one setting key synced like other company settings; the card sits right under the Staff ID on My Page; CEO/GM card in Settings', () => {
  assert.match(src, /'md_all_viewers','funergy_times'\];/);
  const my = fnFrom('renderMypage');
  const i = my.indexOf("openStaffPass()\"><i class=\"ti ti-eye\"></i>"), j = my.indexOf('timesCardHtml()'), k = my.indexOf("_mp('t',20)");
  assert.ok(i > 0 && j > i && k > j, 'after the Staff ID card, before the next block');
  assert.equal((src.match(/'https:\/\/times\.funergygroup\.com\/'/g) || []).length, 1, 'the address is written in one place only (TIMES_DEFAULT_URL)');
  assert.match(fnFrom('renderSettings'), /\(curRole==='gm'\|\|curRole==='ceo'\)\?timesSettingsCardHtml\(\):''/);
});
