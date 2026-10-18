// App v1090 (Moto 2026-10-17):
//  B  a reimbursement that ends up "却下・支払済" after a merge notifies 経理・事務Crew once (the warning line stays);
//  ①  chosen AMs (by employee ID, set by GM/CEO) see every store on the Management Dashboard — view only;
//  ②  repeat rate: LaLa (F06) goes through the same functions as ToriTon (F01); months without visit-type data are
//      "no data" (null), never 0%, in the quarter views.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1089 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
function listSrc(decl) {
  const i = SRC.indexOf(decl); if (i < 0) throw new Error('not found: ' + decl);
  const open = SRC.indexOf('[', i); let d = 0;
  for (let j = open; j < SRC.length; j++) { if (SRC[j] === '[') d++; else if (SRC[j] === ']' && --d === 0) return SRC.slice(open, j + 1); }
  throw new Error('unterminated ' + decl);
}
const plain = v => JSON.parse(JSON.stringify(v));

/* ---------------- B: rejected but paid ---------------- */
function rbApp(role, user) {
  const c = { console, STORE: {}, RENDERS: 0, curRole: role, curUserName: user, curStoreLogin: false,
    STORES: [{ id: 'F01', name: 'ToriTon' }, { id: 'F06', name: 'LaLa' }] };
  vm.createContext(c);
  vm.runInContext(['_rbStoreName', '_rbRpKey', '_rbRpNotifId', 'rbNotifyRejectedPaid', 'rbApplyNotifFocus', 'notifForMe', '_roleMatch', 'mergeNotifs'].map(fnSrc).join('\n') + `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function getReimbursements(){ return ls('reimbursements', []); }
    function getNotifs(){ return ls('notifications', []); }
    function renderNotifBell(){ RENDERS++; }
    function isStoreManager(){ return false; }
    function _userSupportsStore(){ return false; }
    function _amManagesStore(){ return false; }
    var _rbView = { ym: '', status: 'all' };`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const RB = (o) => Object.assign({ id: 'rb1', storeId: 'F06', payer: 'Ken', amount: 42.5, date: '2026-10-14', status: '却下', payStatus: '支払済',
  paidAt: '2026/10/15 10:00', paidBy: 'Marcia', approvedBy: 'Yuki', _dT: 1760500000000 }, o);

test('B: a rejected-but-paid reimbursement notifies accounting and office crew once, from the system', () => {
  const c = rbApp('am', 'Yuki');
  c.STORE.reimbursements = [RB(), RB({ id: 'rb2', status: '承認' }), RB({ id: 'rb3', status: '申請中' }), RB({ id: 'rb4', _deleted: true }), RB({ id: 'rb5', payStatus: '未払い' })];
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 1);
  const n = plain(c.STORE.notifications);
  assert.equal(n.length, 1);
  assert.deepEqual(n[0].toRoles, ['office', 'office_crew']);
  assert.equal(n[0].by, 'システム');
  assert.equal(n[0].page, 'invoice');
  assert.equal(n[0].type, 'reject');
  assert.match(n[0].title, /却下ですが支払済/);
  assert.match(n[0].text, /LaLa/); assert.match(n[0].text, /\$42\.50/); assert.match(n[0].text, /Marcia/);
  assert.equal(n[0].id, 'ntf_rbrp_rb1_1760500000000');
  assert.deepEqual(n[0].rbFocus, { ym: '2026-10', status: 'rejected' });
  // again on the same device: nothing new
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 0);
  assert.equal(c.STORE.notifications.length, 1);
  // the notification is pruned (150 cap) but the record is still rejected+paid: not re-added on this device
  c.STORE.notifications = [];
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 0);
  assert.equal(c.STORE.notifications.length, 0);
});

test('B: the people it is for see it (accounting and office crew), others do not', () => {
  const a = rbApp('am', 'Yuki'); a.STORE.reimbursements = [RB()]; run(a, 'rbNotifyRejectedPaid()');
  const n = plain(a.STORE.notifications)[0];
  for (const [role, user, sees] of [['office', 'Marcia', true], ['office_crew', 'Akane', true], ['gm', 'Moto', false], ['am', 'Yuki', false], ['sl', 'Ken', false]]) {
    const c = rbApp(role, user);
    assert.equal(run(c, 'notifForMe(' + JSON.stringify(n) + ')'), sees, role);
  }
  // accounting itself can be the device that finds it, and still sees it (from the system, not from "me")
  const o = rbApp('office', 'Marcia'); o.STORE.reimbursements = [RB()]; run(o, 'rbNotifyRejectedPaid()');
  assert.equal(run(o, 'notifForMe(getNotifs()[0])'), true);
});

test('B: two devices finding the same case end with one notification after the merge; a device that already has it adds nothing', () => {
  const a = rbApp('gm', 'Moto'), b = rbApp('office', 'Marcia');
  a.STORE.reimbursements = [RB()]; b.STORE.reimbursements = [RB()];
  run(a, 'rbNotifyRejectedPaid()'); run(b, 'rbNotifyRejectedPaid()');
  const merged = run(a, 'mergeNotifs(' + JSON.stringify(a.STORE.notifications) + ',' + JSON.stringify(b.STORE.notifications) + ')');
  assert.equal(merged.length, 1);
  const c = rbApp('office_crew', 'Akane'); c.STORE.reimbursements = [RB()]; c.STORE.notifications = plain(a.STORE.notifications);
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 0);
  assert.equal(c.STORE.notifications.length, 1);
  assert.ok(c.STORE.rb_rp_seen['rb1|1760500000000'], 'remembers it so it is not re-added after the notification is pruned');
});

test('B: a new decision (after undo and decide again) is a new case; store accounts and other roles do not look', () => {
  const c = rbApp('office', 'Marcia'); c.STORE.reimbursements = [RB()];
  run(c, 'rbNotifyRejectedPaid()');
  c.STORE.reimbursements = [RB({ _dT: 1760600000000 })];
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 1);
  assert.equal(c.STORE.notifications.length, 2);
  for (const role of ['sl', 'crew', 'g2', 'chef']) { const x = rbApp(role, 'X'); x.STORE.reimbursements = [RB()]; assert.equal(run(x, 'rbNotifyRejectedPaid()'), 0, role); }
  const s = rbApp('gm', 'Moto'); s.curStoreLogin = true; s.STORE.reimbursements = [RB()]; assert.equal(run(s, 'rbNotifyRejectedPaid()'), 0);
});

test('B: opening the notification shows the rejected list of that month; the hooks are in place', () => {
  const c = rbApp('office', 'Marcia');
  run(c, "rbApplyNotifFocus({ rbFocus:{ ym:'2026-09', status:'rejected' } })");
  assert.deepEqual(plain(c._rbView), { ym: '2026-09', status: 'rejected' });
  run(c, "rbApplyNotifFocus({ page:'approval' })");
  assert.deepEqual(plain(c._rbView), { ym: '2026-09', status: 'rejected' }, 'other notifications leave the view alone');
  for (const f of ['onNotifClick', 'onNotifClickPage']) assert.match(fnSrc(f), /rbApplyNotifFocus\(n\)/, f);
  assert.match(fnSrc('renderReimburseCard'), /rbNotifyRejectedPaid\(\)/);
  assert.match(SRC, /reimbursements: \{ merge: mergeInvoices, covers: _coversInvoices, after: function\(\)\{ try\{ if\(typeof rbNotifyRejectedPaid==='function'\) setTimeout\(rbNotifyRejectedPaid, 0\)/);
  assert.match(SRC, /try\{ checkTipPromotions\(\); \}catch\(e\)\{\}\n  try\{ rbNotifyRejectedPaid\(\); \}catch\(e\)\{\}/);
  // the warning line is still drawn
  assert.match(fnSrc('_rbRow'), /支払済ですが、ほかの端末の却下があとから届きました/);
  // the device-local memory is not synced
  assert.doesNotMatch(listSrc('var OP_SYNC_KEYS = ['), /rb_rp_seen/);
  assert.doesNotMatch(listSrc('var OP_SYNC_PREFIX = ['), /'rb_/);
});

/* ---------------- ①: all-store dashboard view ---------------- */
const STORES = [
  { id: 'F01', name: 'ToriTon', active: true, am: 'Uruma' }, { id: 'F02', name: 'Tenkichi', active: true, am: 'Masamitsu' },
  { id: 'F04-K', name: 'Kaimuki', active: true, am: 'Yuki Nagatani' }, { id: 'F04-P', name: 'Piikoi', active: true, am: 'Yuki Nagatani' },
  { id: 'F05', name: 'Marujuu', active: true, am: 'Uruma' }, { id: 'F06', name: 'LaLa', active: true, am: 'Uruma' }, { id: 'F03', name: 'FSP', active: false, am: 'Yuki Nagatani' }];
function mdApp(o) {
  const c = Object.assign({ console, STORE: {}, CALLS: [], curRole: 'am', curRealRole: 'am', curUserName: 'Yuki Nagatani', curStoreLogin: false,
    curStore: 'F04-K', ME: 'e-yuki', TOASTS: [] }, o || {});
  vm.createContext(c);
  vm.runInContext(['mcRole', 'mcScopeStores', 'mdAllViewers', 'mdIsAllViewer', 'mdViewStores', 'mdPickedStore', 'mdSetStore', 'mdSetAllViewer', 'mdOpenStore',
    'dashScopeStores', 'mdScopeLabel', 'mdStorePickHtml', 'mcStoreLabel', 'activeStores', 'mdPendingApprovals'].map(fnSrc).join('\n') + `
    var mdState = { period:'month', storeFilter:'all', kpi:'', store:'' };
    var STORES_ALL = ${JSON.stringify(STORES)};
    function getStoresAll(){ return STORES_ALL; }
    function sortByLoginOrder(a){ return a; }
    function myAmStores(){ var me=curUserName; return getStoresAll().filter(function(s){ return s.am===me; }).map(function(s){ return s.id; }); }
    function mcMe(){ return null; } function mcIsStoreManagerEmp(){ return false; } function myStoreId(){ return ''; }
    function getVisibleStores(){ return activeStores(); }
    function _empMeId(){ return ME; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function renderPage(p){ CALLS.push(['render', p]); }
    function switchStore(s){ CALLS.push(['switch', s]); }
    function go(p){ CALLS.push(['go', p]); }
    function showToast(m){ TOASTS.push(m); }
    function _actorName(){ return curUserName; } function nowJP(){ return '2026/10/17 16:00'; }
    function escapeHtml(s){ return String(s); }
    var window = { scrollTo: function(){} };`, c);
  return c;
}

test('①: only the chosen person (by employee ID) gets every store; the other AMs and their scope do not change', () => {
  const c = mdApp();
  assert.deepEqual(plain(run(c, 'mdViewStores()')), ['F04-K', 'F04-P'], 'before the setting: her own stores');
  c.STORE.md_all_viewers = { 'e-yuki': { on: true, name: 'Yuki Nagatani', _at: 5 } };
  assert.equal(run(c, 'mdIsAllViewer()'), true);
  assert.deepEqual(plain(run(c, 'mdViewStores()')), ['F01', 'F02', 'F04-K', 'F04-P', 'F05', 'F06'], 'every active store');
  assert.deepEqual(plain(run(c, 'mcScopeStores()')), ['F04-K', 'F04-P'], 'her scope (what she can act on) stays');
  // same name, different employee: not the chosen person
  c.ME = 'e-other';
  assert.equal(run(c, 'mdIsAllViewer()'), false);
  assert.deepEqual(plain(run(c, 'mdViewStores()')), ['F04-K', 'F04-P']);
  // another AM
  const u = mdApp({ curUserName: 'Uruma', ME: 'e-uruma' }); u.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  assert.deepEqual(plain(run(u, 'mdViewStores()')), ['F01', 'F05', 'F06']);
  // switched off
  c.ME = 'e-yuki'; c.STORE.md_all_viewers = { 'e-yuki': { on: false, _at: 9 } };
  assert.equal(run(c, 'mdIsAllViewer()'), false);
  // only for the AM role (GM / CEO see everything anyway, the setting does nothing for other roles)
  for (const r of ['gm', 'sl', 'office']) {
    const x = mdApp({ curRole: r, curRealRole: r }); x.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
    assert.equal(run(x, 'mdIsAllViewer()'), false, r);
  }
});

test('①: the dashboard starts at all stores; picking a store narrows the dashboard and Funergy Now; out-of-scope cards stay in the dashboard', () => {
  const c = mdApp(); c.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  assert.equal(run(c, 'mdPickedStore()'), '');
  assert.equal(run(c, "mdScopeLabel(mdViewStores())"), '全店 6店（閲覧）');
  assert.deepEqual(plain(run(c, 'dashScopeStores().map(function(s){return s.id;})')), ['F01', 'F02', 'F04-K', 'F04-P', 'F05', 'F06'],
    'Funergy Now: all stores even though she logged in at Kaimuki');
  // a card of a store outside her scope: stay on the dashboard (view only), do not open 予実
  run(c, "mdOpenStore('F06')");
  assert.deepEqual(plain(c.CALLS), [['render', 'dashboard']]);
  assert.equal(run(c, 'mdPickedStore()'), 'F06');
  assert.deepEqual(plain(run(c, 'dashScopeStores().map(function(s){return s.id;})')), ['F06']);
  assert.match(run(c, 'mdStorePickHtml()'), /管轄外の店は見るだけです/);
  assert.equal(run(c, "mdScopeLabel(['F06'])"), 'LaLa（閲覧）');
  // her own store: as before (switch + 予実)
  c.CALLS.length = 0; run(c, "mdOpenStore('F04-P')");
  assert.deepEqual(plain(c.CALLS), [['switch', 'F04-P'], ['go', 'budget']]);
  // back to all
  run(c, "mdSetStore('')"); assert.equal(run(c, 'mdPickedStore()'), '');
  // a picked store that is not viewable is ignored
  run(c, "mdState.store='F03'"); assert.equal(run(c, 'mdPickedStore()'), '', 'inactive store');
  // non-viewers: no picker, unchanged behaviour
  const n = mdApp(); assert.equal(run(n, 'mdStorePickHtml()'), '');
  run(n, "mdOpenStore('F06')"); assert.deepEqual(plain(n.CALLS), [['switch', 'F06'], ['go', 'budget']]);
  assert.equal(run(n, "mdScopeLabel(mcScopeStores())"), '管轄店舗 2店');
});

test('①: approvals on the dashboard stay limited to her scope; the dashboard draws the view stores', () => {
  const dash = fnSrc('renderMgmtDash');
  assert.match(dash, /var scope = mcScopeStores\(\);\n  var stores = mdViewStores\(\);/);
  assert.match(dash, /approvalList: mdPendingApprovals\(scope\)/);
  assert.match(dash, /if \(mdPickedStore\(\)\) stores = \[mdPickedStore\(\)\];/);
  const c = mdApp(); c.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  c.STORE.approvals = [{ id: 'a1', status: 'pending', store: 'F04-K' }, { id: 'a2', status: 'pending', store: 'F01' }];
  assert.deepEqual(plain(run(c, 'mdPendingApprovals(mcScopeStores()).map(function(a){return a.id;})')), ['a1']);
});

test('①: only GM / CEO set it, by employee ID, with a newer time each save; the key is a synced setting with a merge rule', () => {
  const g = mdApp({ curRole: 'gm', curRealRole: 'gm', curUserName: 'Moto' });
  assert.equal(run(g, "mdSetAllViewer('e-yuki','Yuki Nagatani',true)"), true);
  const v1 = plain(g.STORE.md_all_viewers)['e-yuki'];
  assert.equal(v1.on, true); assert.equal(v1.name, 'Yuki Nagatani'); assert.equal(v1.by, 'Moto');
  assert.equal(run(g, "mdSetAllViewer('e-yuki','Yuki Nagatani',false)"), true);
  const v2 = plain(g.STORE.md_all_viewers)['e-yuki'];
  assert.equal(v2.on, false); assert.ok(v2._at > v1._at, 'switching off keeps a newer record (wins the merge)');
  assert.equal(run(g, "mdSetAllViewer('_Orphan','Orphan',true)"), false, 'people not in the employee master cannot be chosen');
  for (const r of ['am', 'office', 'sl']) {
    const x = mdApp({ curRole: r, curRealRole: r });
    assert.equal(run(x, "mdSetAllViewer('e-yuki','Yuki',true)"), false, r);
    assert.equal(x.STORE.md_all_viewers, undefined, r);
  }
  assert.match(listSrc('var SUPA_SETTING_KEYS = ['), /'md_all_viewers'/);
  assert.match(SRC, /\n  md_all_viewers:     \{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(listSrc('var LS_NEVER_FREE = ['), /'md_all_viewers'/);
  assert.match(SRC, /\n  h\+=scAllViewerHtml\(people\);   \/\* v1090 \*\/\n/, 'the setting is in the scope assignment (GM / CEO)');
});

/* ---------------- ②: repeat rate ---------------- */
function rrApp() {
  const c = { console, DA: {} };
  vm.createContext(c);
  vm.runInContext(['repeatStats', 'repeatStatsLD', '_qbRepeatRate', '_qbProgLine', 't'].map(fnSrc).join('\n') + `
    var curLang = 'ja';
    function _daRO(id){ return DA[id] || {}; }
    function getDailyActuals(id){ return DA[id] || {}; }
    function fmtUSD2(v){ return '$'+v; }
    function progBar(p){ return '<bar '+p+'>'; }`, c);
  return c;
}
const days = (ym, n) => Array.from({ length: n }, (_, i) => ({ date: ym + '-' + String(i + 1).padStart(2, '0') }));

test('②: the same visit-type data gives ToriTon and LaLa the same repeat numbers (shared functions, no store special case)', () => {
  const c = rrApp();
  const one = {};
  for (let i = 1; i <= 20; i++) {
    const d = '2026-10-' + String(i).padStart(2, '0');
    one[d] = { firstTimeBowls: 10 + (i % 3), repeatBowls: 7 + (i % 5), superRegular: i % 2, firstTimeBowlsLunch: 4, repeatBowlsLunch: 3, firstTimeBowlsDinner: 6 + (i % 3), repeatBowlsDinner: 4 + (i % 5) };
  }
  c.DA = { F01: one, F06: JSON.parse(JSON.stringify(one)) };
  const dl = JSON.stringify(days('2026-10', 31));
  for (const f of ['repeatStats', 'repeatStatsLD']) {
    assert.deepEqual(plain(run(c, f + "([{id:'F01'}]," + dl + ")")), plain(run(c, f + "([{id:'F06'}]," + dl + ")")), f);
  }
  assert.deepEqual(plain(run(c, "_qbRepeatRate('F01','2026-10')")), plain(run(c, "_qbRepeatRate('F06','2026-10')")));
  // the month rate is the count ratio, not an average of daily rates
  const r = run(c, "_qbRepeatRate('F06','2026-10')");
  let ft = 0, rp = 0; Object.values(one).forEach(v => { ft += v.firstTimeBowls; rp += v.repeatBowls; });
  assert.equal(r.rate, Math.round(rp / (ft + rp) * 1000) / 10);
  // no store id special-cases LaLa or ToriTon in the repeat paths (only FSP/WGS are manual)
  for (const f of ['repeatStats', 'repeatStatsLD', '_qbRepeatRate', 'keyKpiStats', 'computeKpiActuals', 'quarterActuals']) {
    assert.doesNotMatch(fnSrc(f), /F06|F01|LALA_STORE|isToritonShift/, f);
  }
  assert.match(fnSrc('computeKpiActuals'), /var _useBowlsRepeat = \['F03','F03-G'\]\.indexOf\(storeId\)<0;/);
});

test('②: a month without visit-type data is "no data", not 0%; a real 0% stays 0%', () => {
  const c = rrApp();
  c.DA = { F06: { '2026-10-01': { actual: 900, guests: 40 } } };   // sales but no first/repeat
  const none = plain(run(c, "_qbRepeatRate('F06','2026-10')"));
  assert.equal(none.rate, null); assert.equal(none.has, false);
  c.DA.F06['2026-10-02'] = { firstTimeBowls: 12, repeatBowls: 0 };
  const zero = plain(run(c, "_qbRepeatRate('F06','2026-10')"));
  assert.equal(zero.rate, 0); assert.equal(zero.has, true);
  // the month card line
  const nd = run(c, "_qbProgLine('リピート率', null, 40, {unit:'%', nullable:true})");
  assert.match(nd, /データなし（未取得）/); assert.doesNotMatch(nd, /(^|[^0-9.])0%/);
  assert.match(run(c, "_qbProgLine('リピート率', 0, 40, {unit:'%', nullable:true})"), />0%/);
  // the quarter paths keep null
  assert.match(fnSrc('quarterActuals'), /st\.repeat=\(st\.repHas && \(st\.ftB\+st\.rpB\)\)\?Math\.round\(st\.rpB\/\(st\.ftB\+st\.rpB\)\*1000\)\/10:null;/);
  assert.match(fnSrc('qcCompute'), /R\.aRep=R\.repBase\?Math\.round\(R\.repRp\/R\.repBase\*1000\)\/10:null;/);
  const tbl = fnSrc('renderQcKpiTable');
  assert.match(tbl, /var noCmp=\(it\.act==null \|\| it\.tgt==null\);/);
  assert.match(tbl, /if\(noCmp\)\{ ds='—'; dc='var\(--muted\)'; \}/);
  assert.match(fnSrc('renderQCommitSummary'), /R\.aRep==null/);
  assert.match(SRC, /_qbProgLine\(t\('リピート率','Repeat rate'\), md\.aRep, md\.tRep, \{unit:'%', nullable:true\}\)/);
});

test('②: the visit-type diagnosis can target the store picked in the sync center (LaLa)', () => {
  const f = fnSrc('runCustDebug');
  assert.match(f, /document\.getElementById\('sc-store'\)/);
  assert.match(f, /var s=\(_scId && stores\.find\(function\(x\)\{ return x\.id===_scId; \}\)\) \|\| stores\[0\];/);
});

test('version markers are 1090 or later and match', () => {
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  const sw = /const SW_BUILD = '(\d+)'/.exec(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))[1];
  assert.ok(Number(v) >= 1090); assert.equal(v, sw);
});
