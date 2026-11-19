// v1196（UI案96 の段階 2 の ②③④・Moto さん 11/18「1 B・2 A・3 A・4 A・5 B・6 B・7 B」）：左上の店と前の値・1 つの木・経理センターの入口とログイン直後。
// index.html の本物のコード（ROLE_CONFIG〜ナビの決まり・所属の確認・FUNERGY_LOC・左上の関数・initApp）を VM で動かす（合成データだけ・本番には接続しない）。確かめること：
//  1. 新しい見え方になるのは、確かめた自分の所属（aff_get）があり、マスターと同じで役割とも合う人だけ（2A）。G1・店のタブレット・答えが無い／前の版／SQL の前／通信の失敗は今まで
//  2. 本部所属：左上は「オフィス・本部」（全店・Office をまとめる）＋各店。ログイン直後は「オフィス・本部」。AM は管轄＋応援（1B）。前の値は決め直す
//  3. 店舗所属：左上は所属の店と応援の店だけ・1 店ずつ（7B）。今の役割で見えていた店より広げない。画面の店のタブ・全社のタブも決め直す
//  4. 1 つの木：出る画面は今と同じ（今の木で開けた画面だけ）・形は GM の木＋「そのほか」・月間行動計画は予実（5B）
//  5. 経理センターの入口は本部所属＋役割なら左上が店でも出る（3A）。ログイン直後とホームは経理・事務Crew が経理センター（4A）
//  6. 答えがアプリを出したあとに届いたら描き直す（開いている画面は開ける限りそのまま）。ログインが変わったら前の人の答えは置かない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
function fnFrom(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
const NAV = between('\nconst ROLE_CONFIG = {', '\nvar curGroup = null;');
const HQ = between('\nvar EMP_HQ_STORE', '\n/* 店舗のスキルマトリクスに出す人');
const AFF = between('/* ==== FUNERGY_AFF（v1195', '/* ==== FUNERGY_AFF end ==== */');
const LOC = between('/* ==== FUNERGY_LOC（v1196', '/* ==== FUNERGY_LOC end ==== */');
const FNS = ['myAmStores', 'amStoresOf', 'myStoreId', 'mySupportStores', 'getVisibleStores', 'accessibleStoresForUser', 'tbStoreName', 'locTopHtml',
  'switchStore', 'openStoreSwitcher', 'initApp', 'groupOfPage'].map(fnFrom).join('\n');
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }

const STORES0 = [{ id: 'S1', name: 'Store One', am: 'Amy Area', active: true }, { id: 'S2', name: 'Store Two', am: 'Amy Area', active: true },
  { id: 'S3', name: 'Store <b>Three</b>', active: true }, { id: 'S4', name: 'Closed Four', active: false }];
const EMPS0 = () => [
  { id: 'E-GM', name: 'Gina M', role: 'gm', store: 'OFFICE', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cy Eo', role: 'ceo', store: 'OFFICE', title: 'CEO' },
  { id: 'E-OF', name: 'Ofelia', role: 'office', store: 'OFFICE', title: 'Accounting Manager' },
  { id: 'E-OC', name: 'Oscar', role: 'office_crew', store: 'OFFICE', title: 'Office Crew' },
  { id: 'E-CH', name: 'Chet', role: 'chef', store: 'OFFICE', title: 'Head Chef' },
  { id: 'E-AM', name: 'Amy Area', role: 'am', store: 'OFFICE', support: ['S1', 'S2'], title: 'Area Manager' },
  { id: 'E-SL', name: 'Sal Lee', role: 'sl', store: 'S1', support: ['S2'], title: 'Store Leader' },
  { id: 'E-G4', name: 'Gus Four', role: 'g4', store: 'S2', support: ['S3'], title: 'Store Manager' },
  { id: 'E-AMS', name: 'Ann Store', role: 'am', store: 'S1', support: ['S3'], title: 'Area Manager' },
  { id: 'E-CR', name: 'Kai Crew', role: 'crew', store: 'S1', support: ['S2'], title: 'Crew' },
];
// 確かめた所属（GM・CEO が保存した写し）。マスターと同じ
const ROWS0 = () => ({
  'Gina M': { aff: 'hq', store: '', support: [] }, 'Cy Eo': { aff: 'hq', store: '', support: [] }, 'Ofelia': { aff: 'hq', store: '', support: [] },
  'Oscar': { aff: 'hq', store: '', support: [] }, 'Chet': { aff: 'hq', store: '', support: [] }, 'Amy Area': { aff: 'hq', store: '', support: ['S1', 'S2'] },
  'Sal Lee': { aff: 'store', store: 'S1', support: ['S2'] }, 'Gus Four': { aff: 'store', store: 'S2', support: ['S3'] },
  'Ann Store': { aff: 'store', store: 'S1', support: ['S3'] }, 'Kai Crew': { aff: 'store', store: 'S1', support: ['S2'] },
});

function app(o = {}) {
  const c = {
    curRole: null, curRealRole: null, curStore: o.store || 'S1', curStoreLogin: !!o.storeLogin, curUserName: null, curLang: o.lang || 'ja', curPage: '',
    budgetTab: 'daily', workTab: 'today', officeMgrTab: 'dash', _acCat: 'docs', _acSub: 'x',
    TOASTS: [], NAVS: [], RENDERS: [], MODALS: [], CALLS: [], GOS: [], FOLLOW: [], EMPS: o.emps || EMPS0(), STORES0: STORES0.map(s => ({ ...s })),
    ROWS: o.rows || ROWS0(), SSMODE: o.ssMode || 'ok', WRLAND: !!o.wrLand, TOP: { innerHTML: '' }, MODALOPEN: false, TYPING: false, PENDING: [],
    Date, JSON, Math, Object, Array, String, Number, Promise, console,
  };
  vm.createContext(c);
  vm.runInContext(`
    var window = this;
    window.scrollTo = function(){};
    var MAIN = { contains: function(){ return TYPING; } };
    var MO = { classList: { contains: function(){ return MODALOPEN; } } };
    var document = { getElementById: function(id){ if (id === 'topbar-store') return TOP; if (id === 'nav-bar') return { innerHTML:'' }; if (id === 'main-content') return MAIN; if (id === 'modal-overlay') return MO; return null; },
      get activeElement(){ return TYPING ? { tagName:'INPUT' } : null; } };
    function setTimeout(){ return 0; } function clearTimeout(){}
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m){ TOASTS.push(m); }
    function ls(k, d){ return d; } function lsSet(){ return true; }
    function getRoleHide(){ return []; }
    function getEmployees(){ return EMPS; }
    function getStoresAll(){ return STORES0.map(function(s){ return Object.assign({}, s); }); }
    var STORES = getStoresAll();
    function activeStores(){ return getStoresAll().filter(function(s){ return s.active; }); }
    function sortByLoginOrder(a){ return (a || []).slice(); }
    function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]; }); }
    function _bStoreAbbr(s){ return String(s.id); }
    function openModal(h){ MODALS.push(h); } function closeModalDirect(){}
    function buildNav(){ NAVS.push(groupsForRole().map(function(g){ return g.id; })); }
    function renderPage(p){ RENDERS.push(p); }
    function go(p){ GOS.push(p); curPage = p; }
    function pageStoresFollow(id){ FOLLOW.push(id); }
    function wrLandHere(){ return WRLAND; }
    function maybeShowCompanyMessage(){}
    var _supaBooting = true; function _lsDegraded(){ return true; }
    var AM_STORES = ['F03', 'F04-K'];
    var ROLE_ALIAS = { g2:'sl', g4:'am' };
    function _applyRole(raw){ curRealRole = raw || null; curRole = (raw && ROLE_ALIAS[raw]) ? ROLE_ALIAS[raw] : raw; }
    var _ssGen = 0;
    function SSF(p){
      if (SSMODE === 'ok') return { ok:true, j:{ affn:1, row: ROWS[curUserName] || null } };
      if (SSMODE === 'legacy') return { legacy:true };
      if (SSMODE === 'nosql') return { ok:true, j:{ affn:1, row:null, nosql:true } };
      if (SSMODE === 'none') return { none:true };
      if (SSMODE === 'deferred') { var who = curUserName; return new Promise(function(res){ PENDING.push(function(){ res({ ok:true, j:{ affn:1, row: ROWS[who] || null } }); }); }); }
      return { net:true };
    }
    async function ssCall(p){ CALLS.push(JSON.parse(JSON.stringify(p))); return SSF(p); }
    ${NAV}
    ${HQ}
    ${FNS}
    ${AFF}
    ${LOC}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const J = x => JSON.parse(JSON.stringify(x));
async function login(c, name, opt = {}) {
  const e = c.EMPS.find(x => x.name === name);
  run(c, `_applyRole(${JSON.stringify(e.role)}); curUserName = ${JSON.stringify(name)}; curStore = ${JSON.stringify(opt.store || (['ceo', 'gm', 'office'].includes(e.role) ? 'ALL' : (e.store === 'OFFICE' ? 'ALL' : e.store)))};`);
  run(c, 'FUNERGY_LOC.afterLogin()');
  await settle();
  return e;
}
const mode = c => J(run(c, 'FUNERGY_LOC.mode()'));
const pages = gs => { const s = new Set(); for (const g of gs) for (const p of g.children) s.add(p); return s; };
const shown = (c, gs) => new Set([...pages(gs)].filter(p => run(c, `navChildAllowed(${JSON.stringify(p)})`)));

test('release markers are 1196 and the same in the page and the service worker', () => {
  const a = src.match(/const APP_VERSION = '(\d+)';/), b = sw.match(/const SW_BUILD = '(\d+)';/);
  assert.ok(a && b); assert.ok(Number(a[1]) >= 1196, a[1]); assert.equal(a[1], b[1]);
});

test('who gets the new view: a confirmed own row that matches the master and the role (2A); everyone else keeps today', async () => {
  const c = app();
  await login(c, 'Gina M');
  assert.deepEqual(mode(c), { kind: 'hq' });
  assert.equal(c.CALLS.at(-1).action, 'aff_get', 'reads only the own row');
  await login(c, 'Sal Lee');
  assert.deepEqual(mode(c), { kind: 'store', opts: ['S1', 'S2'] });
  // G1 (crew) keeps today's view even when confirmed (Claude decided; G1 lands on My Page as before)
  await login(c, 'Kai Crew'); assert.equal(mode(c), null);
  // the master differs from the confirmed row (support / store / head office) → today
  for (const [name, patch] of [['Sal Lee', { support: ['S3'] }], ['Sal Lee', { store: 'S2' }], ['Gina M', { store: 'ALL' }], ['Ofelia', { store: 'S1' }]]) {
    const c2 = app(); Object.assign(c2.EMPS.find(e => e.name === name), patch);
    await login(c2, name); assert.equal(mode(c2), null, name + ' ' + JSON.stringify(patch));
  }
  // role and affiliation do not match (an office role confirmed as a store, a store role confirmed as head office) → today
  { const rows = ROWS0(); rows['Oscar'] = { aff: 'store', store: 'S1', support: [] }; const c2 = app({ rows }); c2.EMPS.find(e => e.name === 'Oscar').store = 'S1';
    await login(c2, 'Oscar'); assert.equal(mode(c2), null, 'office crew at a store'); }
  { const rows = ROWS0(); rows['Sal Lee'] = { aff: 'hq', store: '', support: [] }; const c2 = app({ rows }); c2.EMPS.find(e => e.name === 'Sal Lee').store = 'OFFICE'; c2.EMPS.find(e => e.name === 'Sal Lee').support = [];
    await login(c2, 'Sal Lee'); assert.equal(mode(c2), null, 'store leader at head office'); }
  // AM whose assigned stores are not in affiliation + support → today
  { const c2 = app(); c2.EMPS.find(e => e.name === 'Amy Area').support = ['S1']; const rows = c2.ROWS; rows['Amy Area'].support = ['S1'];
    await login(c2, 'Amy Area'); assert.equal(mode(c2), null, 'AM missing S2'); }
  // no row, a malformed row, before the SQL, an older function, not signed in, network failure → today
  { const rows = ROWS0(); delete rows['Gina M']; const c2 = app({ rows }); await login(c2, 'Gina M'); assert.equal(mode(c2), null, 'no row'); }
  { const rows = ROWS0(); rows['Gina M'] = { aff: 'boss' }; const c2 = app({ rows }); await login(c2, 'Gina M'); assert.equal(mode(c2), null, 'bad row'); }
  { const rows = ROWS0(); rows['Sal Lee'] = { aff: 'store', store: '', support: [] }; const c2 = app({ rows }); await login(c2, 'Sal Lee'); assert.equal(mode(c2), null, 'store without id'); }
  for (const m of ['nosql', 'legacy', 'none', 'net']) { const c2 = app({ ssMode: m }); await login(c2, 'Gina M'); assert.equal(mode(c2), null, m); }
  // the store tablet
  { const c2 = app({ storeLogin: true }); run(c2, "curRole='sl'; curStoreLogin=true; curUserName='Store One'; FUNERGY_LOC.afterLogin()"); await settle();
    assert.equal(mode(c2), null); assert.equal(c2.CALLS.length, 0, 'the tablet does not ask'); }
});

test('the answer is tied to the sign-in: someone else in the same tab (cash tip gate swap), a logout or a re-login does not use it', async () => {
  const c = app();
  await login(c, 'Gina M');
  assert.deepEqual(mode(c), { kind: 'hq' });
  // cashTipEntryGate temporarily swaps the current user to evaluate someone else's nav: that person gets today's view
  run(c, "_applyRole('sl'); curUserName='Sal Lee';"); assert.equal(mode(c), null);
  run(c, "_applyRole('gm'); curUserName='Gina M';"); assert.deepEqual(mode(c), { kind: 'hq' });
  run(c, 'FUNERGY_LOC.onLogout()'); assert.equal(mode(c), null, 'logout');
  // an answer that arrives after the sign-in changed is not used
  const d = app({ ssMode: 'deferred' });
  await login(d, 'Gina M');
  run(d, "_applyRole('office'); curUserName='Ofelia'; FUNERGY_LOC.afterLogin()");
  d.PENDING[0](); await settle();
  assert.equal(mode(d), null, "Gina's late answer is not Ofelia's");
  d.PENDING[1](); await settle();
  assert.deepEqual(mode(d), { kind: 'hq' }, "Ofelia's own answer");
  // a logout while waiting
  const e = app({ ssMode: 'deferred' });
  await login(e, 'Gina M'); run(e, 'FUNERGY_LOC.onLogout()'); e.PENDING[0](); await settle();
  run(e, "curUserName='Gina M'"); assert.equal(mode(e), null);
});

test('head office: the top-left is "Office / HQ" (all stores and the old Office together) + each store; it starts there; old values are re-decided', async () => {
  for (const lang of ['ja', 'en']) {
    const c = app({ lang });
    await login(c, 'Chet', { store: 'S2' });   // Head Chef picked a store at the login screen
    run(c, 'curPage="dashboard"; FUNERGY_LOC.enter()');
    assert.equal(c.curStore, 'ALL', 'starts at Office / HQ');
    assert.deepEqual(c.FOLLOW, ['ALL'], 'the screen store choices follow');
    const top = run(c, "locTopHtml('ALL')");
    assert.match(top, lang === 'ja' ? /オフィス・本部/ : /Office \/ HQ/); assert.match(top, /ti-building-skyscraper/);
    assert.doesNotMatch(top, /全店舗/);
    // old values: OFFICE, unknown, closed → Office / HQ; a store stays
    for (const [v, want] of [['OFFICE', 'ALL'], ['S9', 'ALL'], ['S4', 'ALL'], ['', 'ALL'], ['S3', 'S3'], ['ALL', 'ALL']]) {
      run(c, `switchStore(${JSON.stringify(v)})`); assert.equal(c.curStore, want, v);
    }
    assert.equal(c.RENDERS.at(-1), 'dashboard', 'OFFICE no longer jumps to the old Office screen');
    // the switcher: Office / HQ + the stores, no "全店舗" and no separate "Office"
    run(c, 'openStoreSwitcher()');
    const h = c.MODALS.at(-1);
    assert.match(h, lang === 'ja' ? /オフィス・本部/ : /Office \/ HQ/);
    assert.match(h, /switchStore\('ALL'\)/); assert.doesNotMatch(h, /switchStore\('OFFICE'\)/); assert.doesNotMatch(h, />全店舗</);
    for (const s of ['S1', 'S2', 'S3']) assert.match(h, new RegExp("switchStore\\('" + s + "'\\)"));
    assert.doesNotMatch(h, /switchStore\('S4'\)/, 'closed store');
    assert.match(h, /Store &lt;b&gt;Three&lt;\/b&gt;/, 'names are escaped');
  }
});

test('head office AM (1B): Office / HQ covers the assigned stores + support, the same stores as today', async () => {
  const c = app();
  await login(c, 'Amy Area', { store: 'S1' });
  run(c, 'FUNERGY_LOC.enter()');
  assert.equal(c.curStore, 'ALL');
  assert.deepEqual(J(run(c, 'getVisibleStores()')).map(s => s.id), ['S1', 'S2']);
  run(c, "switchStore('S3')"); assert.equal(c.curStore, 'ALL', 'not an assigned store');
  run(c, "switchStore('S2')"); assert.equal(c.curStore, 'S2');
  assert.deepEqual(J(run(c, 'getVisibleStores()')).map(s => s.id), ['S2']);
  run(c, 'openStoreSwitcher()');
  const h = c.MODALS.at(-1);
  assert.match(h, /管轄の店をまとめて（2 店）/); assert.doesNotMatch(h, /switchStore\('S3'\)/);
});

test('store affiliation (7B): own store + support only, one at a time, never wider than today; tabs and "全社" re-decide', async () => {
  const c = app();
  await login(c, 'Sal Lee', { store: 'S1' });
  run(c, 'curPage="budget"; FUNERGY_LOC.enter()');
  assert.equal(c.curStore, 'S1');
  assert.deepEqual(J(run(c, 'getVisibleStores()')).map(s => s.id), ['S1'], 'one store (today: S1 + S2 together)');
  assert.deepEqual(J(run(c, 'accessibleStoresForUser()')).map(s => s.id), ['S1', 'S2']);
  for (const [v, want] of [['ALL', 'S1'], ['OFFICE', 'S1'], ['S3', 'S1'], ['S2', 'S2'], ['S1', 'S1']]) { run(c, `switchStore(${JSON.stringify(v)})`); assert.equal(c.curStore, want, v); }
  run(c, "curStore='ALL'"); assert.deepEqual(J(run(c, 'getVisibleStores()')).map(s => s.id), ['S1'], 'an old ALL in memory still shows one store');
  run(c, 'openStoreSwitcher()');
  const h = c.MODALS.at(-1);
  assert.match(h, /switchStore\('S1'\)/); assert.match(h, /switchStore\('S2'\)/);
  assert.doesNotMatch(h, /switchStore\('ALL'\)/); assert.doesNotMatch(h, /OFFICE/); assert.doesNotMatch(h, /S3/);
  assert.equal(run(c, "locTopHtml('S1')").includes('オフィス'), false);
  // G4 (am alias): today "全店舗（管轄すべて）" + own; now own + support one at a time
  const g = app(); await login(g, 'Gus Four', { store: 'S2' }); run(g, 'FUNERGY_LOC.enter()');
  assert.deepEqual(mode(g), { kind: 'store', opts: ['S2', 'S3'] });
  run(g, 'openStoreSwitcher()'); assert.doesNotMatch(g.MODALS.at(-1), /switchStore\('ALL'\)|管轄すべて/);
  // a store-affiliated AM: affiliation + support ∩ what the AM saw today (assigned + support) — S1 is not assigned to Ann, so only S3
  const a = app(); await login(a, 'Ann Store', { store: 'S1' });
  assert.deepEqual(mode(a), { kind: 'store', opts: ['S3'] });
  run(a, 'FUNERGY_LOC.enter()'); assert.equal(a.curStore, 'S3');
  // one store only: the switcher opens nothing (as today for store leaders)
  const one = app(); one.EMPS.find(e => e.name === 'Sal Lee').support = []; one.ROWS['Sal Lee'].support = [];
  await login(one, 'Sal Lee'); run(one, 'openStoreSwitcher()'); assert.equal(one.MODALS.length, 0);
});

test('people without the new view keep today\'s switcher, stores and labels', async () => {
  const rows = ROWS0(); delete rows['Gina M']; delete rows['Sal Lee'];
  const c = app({ rows });
  await login(c, 'Gina M');
  run(c, "switchStore('OFFICE')"); assert.equal(c.curStore, 'OFFICE'); assert.equal(c.RENDERS.at(-1), 'office_mgr');
  run(c, 'openStoreSwitcher()'); assert.match(c.MODALS.at(-1), /全店舗/); assert.match(c.MODALS.at(-1), /switchStore\('OFFICE'\)/);
  assert.match(run(c, "locTopHtml('ALL')"), /全店舗/);
  await login(c, 'Sal Lee', { store: 'S1' });
  assert.deepEqual(J(run(c, 'getVisibleStores()')).map(s => s.id), ['S1', 'S2'], 'today: S1 + S2 together');
});

test('one tree (3): the pages shown are the same as today (the union of the store/all tree and the Office tree), in the GM shape + "Other"; 5B', async () => {
  const MENU_IDS = J(run(app(), 'MENU_GROUPS.map(function(g){ return g.id; })')).concat(['g_other']);
  for (const name of ['Gina M', 'Cy Eo', 'Ofelia', 'Oscar', 'Chet', 'Amy Area', 'Sal Lee', 'Gus Four']) {
    // today: the trees this role used (left-top a store / all, and Office)
    const t0 = app({ rows: {} }); await login(t0, name);
    const today = new Set();
    for (const st of ['S1', 'ALL', 'OFFICE']) { run(t0, `curStore=${JSON.stringify(st)}`); for (const p of shown(t0, J(run(t0, '_navBaseGroups()')))) today.add(p); }
    const c = app(); await login(c, name);
    const gs = J(run(c, '_navBaseGroups()'));
    for (const st of ['S1', 'ALL']) { run(c, `curStore=${JSON.stringify(st)}`); assert.deepEqual(J(run(c, '_navBaseGroups()')), gs, name + ': the same tree whatever the top-left'); }
    assert.deepEqual([...shown(c, gs)].sort(), [...today].sort(), name + ': same pages as today');
    const ids = gs.map(g => g.id);
    assert.ok(ids.every(id => MENU_IDS.includes(id)), name + ' ' + ids);
    assert.deepEqual(ids, MENU_IDS.filter(id => ids.includes(id)), name + ': GM order');
    assert.equal(gs.flatMap(g => g.children).length, pages(gs).size, name + ': each page once');
    const where = p => (gs.find(g => g.children.includes(p)) || {}).id;
    if (['Gina M', 'Cy Eo', 'Chet'].includes(name)) assert.equal(where('cc_plan'), 'g_budget', name + ': 月間行動計画 in 予実 (5B)');
    else assert.ok(!shown(c, gs).has('cc_plan'), name + ': no 月間行動計画 (as today)');
    if (['Ofelia', 'Oscar'].includes(name)) { assert.equal(where('acct_center'), 'g_acct_center'); assert.equal(where('notifications'), 'g_other'); }
    assert.ok(!pages(gs).has('approval'), 'the closed approval center is not listed');
  }
  // the G1 and the store tablet trees are unchanged
  const g1 = app(); await login(g1, 'Kai Crew'); assert.deepEqual(J(run(g1, '_navBaseGroups()')).map(g => g.id), J(run(g1, 'CREW_GROUPS.map(function(g){ return g.id; })')));
  const tab = app(); run(tab, "curRole='sl'; curStoreLogin=true; curUserName='Store One'"); assert.deepEqual(J(run(tab, '_navBaseGroups()')).map(g => g.id), ['g_store', 'g_shift', 'g_inv', 'g_vac']);
  // without the new view, accounting at Office keeps the accounting tree
  const o = app({ rows: {} }); await login(o, 'Ofelia', { store: 'OFFICE' }); assert.equal(J(run(o, '_navBaseGroups()'))[0].id, 'ga_home');
});

test('3A / 4A: accounting and office crew at head office start at (and come home to) 経理センター; its entry shows even with a store at the top-left', async () => {
  for (const name of ['Ofelia', 'Oscar']) {
    for (const wr of [false, true]) {
      const c = app({ wrLand: wr }); await login(c, name);
      run(c, 'initApp()');
      assert.equal(c.curPage, 'acct_center', name + ' lands on 経理センター (wrLandHere ' + wr + ')');
      assert.equal(c.curStore, 'ALL');
      assert.match(c.TOP.innerHTML, /オフィス・本部/);
      assert.equal(run(c, 'navHomePage()'), 'acct_center');
      run(c, "switchStore('S2')");
      assert.ok(J(run(c, 'groupsForRole()')).some(g => g.children.includes('acct_center')), 'entry with a store at the top-left');
      assert.equal(run(c, "navPageAllowed('acct_center')"), true);
    }
  }
  // the others: the first page of the tree (dashboard) as today, and the work center when wrLandHere says so
  for (const name of ['Gina M', 'Chet', 'Amy Area', 'Sal Lee']) {
    const c = app(); await login(c, name); run(c, 'initApp()'); assert.equal(c.curPage, 'dashboard', name);
    const w = app({ wrLand: true }); await login(w, name); run(w, 'initApp()'); assert.equal(w.curPage, 'tasks', name + ' work center (v1131)');
  }
  // without the new view: accounting lands as today (dashboard; work center when wrLandHere)
  const o = app({ rows: {} }); await login(o, 'Ofelia'); run(o, 'initApp()'); assert.equal(o.curPage, 'dashboard');
  const oc = app({ rows: {} }); await login(oc, 'Oscar'); run(oc, 'initApp()'); assert.equal(oc.curPage, 'acct_center', 'office crew today: the accounting tree starts with 経理センター');
  const ow = app({ rows: {}, wrLand: true }); await login(ow, 'Oscar'); run(ow, 'initApp()'); assert.equal(ow.curPage, 'tasks');
  // a store role never gets 経理センター; 4A is only for head office (even if an office role were ever seen with a store view)
  const s = app(); await login(s, 'Sal Lee'); assert.equal(run(s, 'navAcctLanding()'), false);
  const x = app(); await login(x, 'Ofelia'); assert.equal(run(x, 'navAcctLanding()'), true);
  run(x, "var _m0 = FUNERGY_LOC.mode; FUNERGY_LOC.mode = function(){ return { kind:'store', opts:['S1'] }; }");
  assert.equal(run(x, 'navAcctLanding()'), false); run(x, 'FUNERGY_LOC.mode = _m0');
  assert.ok(!J(run(s, 'groupsForRole()')).some(g => g.children.includes('acct_center')));
});

test('an answer after the app is shown: the top-left and nav are redrawn, the open page stays when it can, an old Office becomes Office / HQ', async () => {
  const c = app({ ssMode: 'deferred' });
  await login(c, 'Gina M');
  run(c, "curStore='OFFICE'; initApp()");
  assert.equal(c.curPage, 'acct_center', 'today: Office tree first page');
  assert.match(c.TOP.innerHTML, /Office/);
  c.PENDING[0](); await settle();
  assert.equal(c.curStore, 'ALL');
  assert.match(c.TOP.innerHTML, /オフィス・本部/);
  assert.ok(c.NAVS.at(-1).includes('g_dash'), 'nav rebuilt with the one tree');
  assert.equal(c.curPage, 'acct_center', 'the open page stays (still allowed)');
  assert.equal(c.GOS.length, 0);
  assert.equal(c.RENDERS.at(-1), 'acct_center', 'redrawn for the new store');
  // while typing, the page is not redrawn
  const d = app({ ssMode: 'deferred' });
  await login(d, 'Sal Lee', { store: 'S2' });
  run(d, "initApp(); curStore='ALL'"); d.TYPING = true; const r0 = d.RENDERS.length;
  d.PENDING[0](); await settle();
  assert.equal(d.curStore, 'S1', 'an old ALL is re-decided to the own store'); assert.equal(d.RENDERS.length, r0, 'not redrawn while typing');
});

test('the shared memory: nothing is written to the device; aff_get asks without extra fields', async () => {
  const c = app();
  await login(c, 'Gina M');
  assert.deepEqual(c.CALLS, [{ action: 'aff_get', ms: 8000 }]);
  assert.doesNotMatch(LOC, /localStorage|lsSet\(|sessionStorage|indexedDB/);
});
