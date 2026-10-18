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
  { id: 'F01', name: 'ToriTon', active: true, am: 'Uruma', toastGuid: 'g1' }, { id: 'F02', name: 'Tenkichi', active: true, am: 'Masamitsu', toastGuid: 'g2' },
  { id: 'F04-K', name: 'Kaimuki', active: true, am: 'Yuki Nagatani', toastGuid: 'g4k' }, { id: 'F04-P', name: 'Piikoi', active: true, am: 'Yuki Nagatani', toastGuid: 'g4p' },
  { id: 'F05', name: 'Marujuu', active: true, am: 'Uruma', toastGuid: 'g5' }, { id: 'F06', name: 'LaLa', active: true, am: 'Uruma', toastGuid: 'g6' }, { id: 'F03', name: 'FSP', active: false, am: 'Yuki Nagatani' }];
function mdApp(o) {
  const c = Object.assign({ console, STORE: {}, CALLS: [], curRole: 'am', curRealRole: 'am', curUserName: 'Yuki Nagatani', curStoreLogin: false,
    curStore: 'F04-K', ME: 'e-yuki', TOASTS: [], setTimeout, clearTimeout, AbortController }, o || {});
  vm.createContext(c);
  vm.runInContext(['mcRole', 'mcScopeStores', 'mdAllViewers', 'mdIsAllViewer', 'mdViewStores', 'mdPickedStore', 'mdSetStore', 'mdSetAllViewer', 'mdOpenStore',
    'dashScopeStores', 'mdScopeLabel', 'mdStorePickHtml', 'mcStoreLabel', 'activeStores', 'mdPendingApprovals',
    'mdViewOnlyStore', 'mdViewLaborPending', 'mdViewerEnsureLabor', 'mdVerdict', 'mdUnknown', 'mdJudge', 'mdV', 'mdStateLabel', 'mcRound',
    '_mdMemo', 'mdCacheClear', '_mdBizDay', 'mdLaborMark', 'mdLaborFresh', 'mdLaborMarksClear', '_mdFrozenLoaded', 'mdViewLaborNote', '_mdViewRedrawSoon', 'mdViewLaborGate', '_mdNoLaborDays', '_mdViewBusy'].map(fnSrc).join('\n') + `
    var mdState = { period:'month', storeFilter:'all', kpi:'', store:'' };
    var STORES_ALL = ${JSON.stringify(STORES)};
    function getStoresAll(){ return STORES_ALL; }
    function sortByLoginOrder(a){ return a; }
    function myAmStores(){ var me=curUserName; return getStoresAll().filter(function(s){ return s.am===me; }).map(function(s){ return s.id; }); }
    function mcMe(){ return null; } function mcIsStoreManagerEmp(){ return false; } function myStoreId(){ return ''; }
    var SUPPORT = [];   // stores she supports (the support field of her employee record)
    function mySupportStores(){ return SUPPORT.slice(); }
    function getVisibleStores(){ return activeStores().filter(function(s){ return s.id === curStore; }); }   // an AM: the store picked at the top
    var _mdCache = {}, _mdCacheArmed = false;
    var _mdLaborMarks = {}, _mdViewLabor = {}, _mdViewInflight = {}, MD_VIEW_LABOR_TIMEOUT_MS = 20000, _mdViewRedrawT = null;
    var MD_VIEW_LABOR_RETRY_MS = 60000, MD_VIEW_LABOR_EMPTY_RETRY_MS = 600000;
    var DAY = '2026-10-17'; function bizToday(){ return DAY; }
    var FROZEN = {}; function isFrozenMonth(ym){ return ym < '2026-10'; } function monthFrozenKey(id, ym){ return 'monthloaded_' + id + '_' + ym; }
    var MD_KPI = { labor_rate: { label: '人件費率', dir: 'down', unit: '%' }, profit: { label: '営業利益', dir: 'up' }, sales: { label: '売上', dir: 'up' } };
    var MD_UNKNOWN = ${JSON.stringify({ no_labor: '勤怠が未取込', no_target: '目標が未設定', calc_error: '計算エラー' })};
    var LABOR = {}, LOADS = [];   // LABOR[store|ym] = days with sales but no labor on this device
    function cumulativeToToday(id, ym){ return { actToToday: 10000, actMonth: 10000, laborRate: 9.5, daysWithActual: 16, daysPassed: 16, budMonth: 1, budToToday: 1 }; }
    function laborCoreForYm(id, ym){ return { noLaborDays: LABOR[id + '|' + ym] || [] }; }
    function getStoreKpiTargets(){ return { laborPct: 30 }; }
    function mcEnoughDays(){ return true; }
    function mcYm(){ return '2026-10'; }
    function daysOfYm(ym){ return [{ date: ym + '-01' }, { date: ym + '-31' }]; }
    var HANG = false, HANGS = [], SIGNALS = [];
    function syncTipLaborFromDB(id, guid, days, opts){ LOADS.push([id, guid, days[0].date, days[days.length - 1].date]); SIGNALS.push(opts && opts.signal);
      if (HANG) { HANG = (HANG === 'once') ? false : HANG; return new Promise(function(res){ HANGS.push(res); }); }   // answers only when the test says so (late)
      if (FETCHERR) return Promise.resolve({ rowCount: 0, updated: 0, fetchErr: true });
      var k = id + '|' + days[0].date.slice(0, 7), n = ROWS(id), upd = EMPTYDATA ? 0 : n;   // EMPTYDATA: rows in the DB but their labor lists are empty
      return Promise.resolve({ rowCount: n, updated: upd }).then(function(r){ if (r.updated) { if (REMAIN[k]) LABOR[k] = REMAIN[k]; else delete LABOR[k]; } return r; }); }
    var EMPTYDATA = false, FETCHERR = false, REMAIN = {};   // REMAIN[store|ym]: sales days the DB still has no labor for after the load
    function ROWS(id){ return 14; }
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

test('①（独立レビュー P3）: a store she supports is not "view only": it opens 予実 like before and has no view-only label', () => {
  const c = mdApp(); c.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(c, "SUPPORT = ['F02']");
  assert.equal(run(c, "mdViewOnlyStore('F02')"), false);
  assert.equal(run(c, "mdViewOnlyStore('F01')"), true);
  assert.equal(run(c, "mdViewOnlyStore('F04-K')"), false, 'her own store');
  run(c, "mdOpenStore('F02')");
  assert.deepEqual(plain(c.CALLS), [['switch', 'F02'], ['go', 'budget']]);
  const pick = run(c, 'mdStorePickHtml()');
  assert.match(pick, />Tenkichi<\/option>/); assert.match(pick, />ToriTon（管轄外・見るだけ）<\/option>/);
  run(c, "curStore = 'F04-K'");   // 2 回目 P3-1: whatever store is picked at the top
  assert.equal(run(c, "mdViewOnlyStore('F02')"), false);
  run(c, "mdState.store='F04-K'");
  assert.equal(run(c, "mdScopeLabel(['F04-K'])"), 'Kaimuki', 'her own store is not "（閲覧）"');
});

test('①（独立レビュー P2-1・2 回目 P2-A／B・Codex・3 回目）: for the all-store viewer, a view-only store with sales days but no labor on this device is "勤怠が未取込", never a low rate; her own stores are judged as when the setting is off', async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const c = mdApp({ curPage: 'dashboard' }); c.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(c, "LABOR['F01|2026-09'] = ['2026-09-01','2026-09-02']; LABOR['F04-P|2026-09'] = ['2026-09-03']; LABOR['F04-K|2026-09'] = ['2026-09-04']");
  let v = plain(run(c, "mdVerdict('F01','labor_rate','2026-09')"));
  assert.equal(v.state, 'unknown'); assert.equal(v.reasonCode, 'no_labor'); assert.equal(v.note, '勤怠を読み込み中（2 日）');
  assert.equal(plain(run(c, "mdVerdict('F01','profit','2026-09')")).reasonCode, 'no_labor');
  // 3 回目 P3-4: her own stores (scope or support) are judged like any AM / GM sees them, whatever was read
  assert.equal(plain(run(c, "mdVerdict('F04-P','labor_rate','2026-09')")).state, 'ok', 'own store: same as with the setting off');
  assert.equal(plain(run(c, "mdVerdict('F04-K','labor_rate','2026-09')")).state, 'ok');
  const off = mdApp(); run(off, "LABOR['F04-P|2026-09'] = ['2026-09-03']");
  assert.equal(plain(run(off, "mdVerdict('F04-P','labor_rate','2026-09')")).state, 'ok', 'the same AM with the setting off');
  // a view-only store with every day's labor already here: judged
  assert.equal(plain(run(c, "mdVerdict('F05','labor_rate','2026-09')")).state, 'ok');
  // the dashboard reads every shown store not read today (read only; her own stores too, so their numbers are complete), each once, and redraws
  run(c, "mdLaborMark('F04-K','2026-09')");   // the login sync read her store today
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', mdViewStores())"), 5);
  await wait(0);
  assert.deepEqual(plain(c.LOADS).map(x => x[0]).sort(), ['F01', 'F02', 'F04-P', 'F05', 'F06']);
  assert.deepEqual(plain(c.LOADS[0]).slice(2), ['2026-09-01', '2026-09-31']);
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', mdViewStores())"), 0, 'already loading');
  await wait(350);
  assert.ok(plain(c.CALLS).some(x => x[0] === 'render' && x[1] === 'dashboard'));
  assert.equal(plain(run(c, "mdVerdict('F01','labor_rate','2026-09')")).state, 'ok');
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', mdViewStores())"), 0, 'read today: not again');
  // Codex 10/17: read, but a sales day still has no labor in the DB → still not judged; read again after 10 minutes (not every minute)
  run(c, "REMAIN['F06|2026-10'] = ['2026-10-03']; LABOR['F06|2026-10'] = ['2026-10-03','2026-10-04']; mdCacheClear()");
  assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F06'])"), 1);
  await wait(350);
  v = plain(run(c, "mdVerdict('F06','labor_rate','2026-10')"));
  assert.equal(v.reasonCode, 'no_labor'); assert.equal(v.note, 'DB にまだ勤怠が無い日があります（1 日）');
  assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F06'])"), 0);
  run(c, "Object.keys(_mdViewLabor).forEach(function(k){ if (_mdViewLabor[k]) _mdViewLabor[k].failAt -= 61000; })");
  assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F06'])"), 0, 'still waiting (10 minutes)');
  run(c, "REMAIN = {}; Object.keys(_mdViewLabor).forEach(function(k){ if (_mdViewLabor[k]) _mdViewLabor[k].failAt -= 540000; })");
  assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F06'])"), 1, 'after 10 minutes');
  await wait(350);
  assert.equal(plain(run(c, "mdVerdict('F06','labor_rate','2026-10')")).state, 'ok', 'the day reached the DB');
  assert.equal(run(c, "mdLaborFresh('F06','2026-10')"), true);
  // 2 回目 P2-A: the next (Hawaii) day, after 最新に更新 or after logging out and in, it is read again
  run(c, "DAY = '2026-10-18'; mdCacheClear(); LABOR['F01|2026-09'] = ['2026-10-17']");
  assert.equal(plain(run(c, "mdVerdict('F01','labor_rate','2026-09')")).reasonCode, 'no_labor', 'the day changed');
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', ['F01'])"), 1, 'only the shown store');
  await wait(350);
  run(c, 'mdLaborMarksClear(); mdCacheClear()');
  assert.equal(run(c, "mdViewLaborPending('F01','2026-09')"), true, 'cleared by 最新に更新 / logout');
  assert.match(fnSrc('refreshNow'), /mdLaborMarksClear\(\)/);
  assert.match(SRC, /\nfunction doLogout\(\) \{[\s\S]{0,600}mdLaborMarksClear\(\)/);
  // 3 回目 P3-7: the login sync and the month load mark only when they wrote labor
  for (const f of ['loginSyncOps', 'ensureMonthDataLoaded']) assert.match(fnSrc(f), /if \(_lr && Number\(_lr\.updated\) > 0 && typeof mdLaborMark === 'function'\) mdLaborMark\(s\.id, ym\);/, f);
  // 3 回目 P3-3: a past month this device loaded before (frozen): not read when nothing is missing; read (once at a time) when a day is missing
  c.STORE['monthloaded_F02_2026-09'] = true;
  run(c, "delete LABOR['F02|2026-09']; mdCacheClear()");
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', ['F02'])"), 0, 'nothing missing: not read');
  run(c, "LABOR['F02|2026-09'] = ['2026-09-30']; mdCacheClear()");
  assert.equal(plain(run(c, "mdVerdict('F02','labor_rate','2026-09')")).reasonCode, 'no_labor');
  assert.equal(run(c, "mdViewerEnsureLabor('2026-09', ['F02'])"), 1, 'a missing day: read again');
  await wait(350);
  assert.equal(plain(run(c, "mdVerdict('F02','labor_rate','2026-09')")).state, 'ok', 'the day that reached the DB later is shown');
  // Codex 10/17: rows in the DB whose labor lists are empty fill nothing → still not judged
  const e = mdApp({ curPage: 'dashboard' }); e.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(e, "EMPTYDATA = true; LABOR['F01|2026-10'] = ['2026-10-02']");
  assert.equal(run(e, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1);
  await wait(0); await wait(0);
  assert.equal(run(e, "mdLaborFresh('F01','2026-10')"), false);
  assert.equal(plain(run(e, "mdVerdict('F01','labor_rate','2026-10')")).note, 'DB にまだ勤怠が無い日があります（1 日）');
  // 3 回目 P3-5: an empty answer when nothing is missing (e.g. the 1st of the month) counts as read today: not read on every redraw
  const d = mdApp({ curPage: 'dashboard' }); d.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(d, "ROWS = function(){ return 0; }");
  assert.equal(run(d, "mdViewerEnsureLabor('2026-10', ['F06'])"), 1);
  await wait(0); await wait(0);
  assert.equal(run(d, "mdLaborFresh('F06','2026-10')"), true);
  assert.equal(run(d, "mdViewerEnsureLabor('2026-10', ['F06'])"), 0);
  // 3 回目 P3-2: a failed read (HTTP error / network) is "読めませんでした" (1 minute), not "DB にまだ無い"
  const x = mdApp({ curPage: 'dashboard' }); x.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(x, "FETCHERR = true; LABOR['F01|2026-10'] = ['2026-10-02']");
  assert.equal(run(x, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1);
  await wait(0); await wait(0);
  assert.equal(plain(run(x, "mdVerdict('F01','labor_rate','2026-10')")).note, '勤怠を読めませんでした（1 日・1 分あけて読み直します）');
  run(x, "Object.keys(_mdViewLabor).forEach(function(k){ _mdViewLabor[k].failAt -= 61000; })");
  assert.equal(run(x, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1, 'after a minute');
  // 2 回目 P3-2 / 3 回目 P3-5 / Codex 27f5ec8: a request that never answers stops "loading" at the time limit and is cancelled;
  // within the limit the store is not read twice; after it, the store can be read again (a minute later, or at once after 最新に更新),
  // and the late answer of the cancelled request is not used
  const h = mdApp({ curPage: 'dashboard' }); h.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(h, "HANG = 'once'; MD_VIEW_LABOR_TIMEOUT_MS = 40; LABOR['F01|2026-10'] = ['2026-10-02']");
  assert.equal(run(h, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1);
  assert.equal(run(h, "mdViewerEnsureLabor('2026-10', ['F01'])"), 0, 'not twice within the time limit');
  run(h, 'mdLaborMarksClear()');
  assert.equal(run(h, "mdViewerEnsureLabor('2026-10', ['F01'])"), 0, 'not twice within the time limit, also after 最新に更新');
  await wait(90);
  assert.equal(plain(run(h, "mdVerdict('F01','labor_rate','2026-10')")).note, '勤怠を読めませんでした（1 日・1 分あけて読み直します）', 'no endless "loading"');
  assert.equal(run(h, 'SIGNALS[0] && SIGNALS[0].aborted'), true, 'the request that did not answer is cancelled');
  assert.equal(run(h, "mdViewerEnsureLabor('2026-10', ['F01'])"), 0, 'waits a minute');
  run(h, "Object.keys(_mdViewLabor).forEach(function(k){ _mdViewLabor[k].failAt -= 61000; })");
  assert.equal(run(h, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1, 'read again after a minute (the network came back)');
  await wait(20);
  assert.equal(plain(run(h, "mdVerdict('F01','labor_rate','2026-10')")).state, 'ok', 'judged with the new read');
  run(h, "HANGS[0]({ rowCount: 0, updated: 0, fetchErr: true })"); await wait(20);   // the cancelled request answers late
  assert.equal(plain(run(h, "mdVerdict('F01','labor_rate','2026-10')")).state, 'ok', 'the late answer is not used');
  assert.equal(run(h, "mdLaborFresh('F01','2026-10')"), true);
  // after 最新に更新 a timed-out store is read again at once
  const r2 = mdApp({ curPage: 'dashboard' }); r2.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  run(r2, "HANG = 'once'; MD_VIEW_LABOR_TIMEOUT_MS = 20; LABOR['F02|2026-10'] = ['2026-10-02']");
  assert.equal(run(r2, "mdViewerEnsureLabor('2026-10', ['F02'])"), 1);
  await wait(60);
  run(r2, 'mdLaborMarksClear()');
  assert.equal(run(r2, "mdViewerEnsureLabor('2026-10', ['F02'])"), 1, 'read again at once after 最新に更新');
  await wait(20);
  assert.equal(plain(run(r2, "mdVerdict('F02','labor_rate','2026-10')")).state, 'ok');
  assert.match(fnSrc('fetchTipLaborFromDB'), /if \(signal\) _fo\.signal = signal;/);
  assert.match(fnSrc('syncTipLaborFromDB'), /fetchTipLaborFromDB\(guid, days\[0\]\.date, days\[days\.length-1\]\.date, opts && opts\.signal\)/);
  // people who are not all-store viewers: nothing is loaded and nothing is gated
  const n = mdApp(); run(n, "LABOR['F04-K|2026-09'] = ['2026-09-03']; LABOR['F01|2026-09'] = ['2026-09-03']");
  assert.equal(run(n, "mdViewerEnsureLabor('2026-09')"), 0);
  assert.equal(plain(run(n, "mdVerdict('F04-K','labor_rate','2026-09')")).state, 'ok');
  assert.match(fnSrc('renderMgmtDash'), /mdViewerEnsureLabor\(ym, stores\)/);
  assert.match(SRC, /no_labor:     \{ label: '勤怠が未取込'/);
});

test('①（3 回目 P3-1・P3-2）: the weekly heatmap leaves out the labor rate of weeks with a missing labor day (view-only stores); the card shows the store’s labor state; a failed read is told apart from an empty answer', async () => {
  const c = mdApp(); c.STORE.md_all_viewers = { 'e-yuki': { on: true, _at: 5 } };
  vm.runInContext(fnSrc('mdWeekRates') + `
    function mdStoreSeries(){ return { budMonth: 1000, weeks: [
      { sun: '2026-09-28', sales: 100, bud: 100, guests: 10, labor: 20, food: 0, hasAct: true },
      { sun: '2026-10-05', sales: 100, bud: 100, guests: 10, labor: 20, food: 0, hasAct: true },
      { sun: '2026-10-12', sales: 100, bud: 100, guests: 10, labor: 20, food: 0, hasAct: true } ] }; }
    function monthGuestBudget(){ return 0; } function mcYmOffset(y){ return y; }`, c);
  run(c, "LABOR['F01|2026-10'] = ['2026-10-06']; LABOR['F04-K|2026-10'] = ['2026-10-06']");
  assert.deepEqual(plain(run(c, "mdWeekRates('F01','2026-10')")).map(w => w.labor_rate), [150, null, 150], 'view-only store: the week of 10/6 has no labor rate');
  assert.deepEqual(plain(run(c, "mdWeekRates('F04-K','2026-10')")).map(w => w.labor_rate), [150, 150, 150], 'her own store: as before');
  const n = mdApp(); vm.runInContext(fnSrc('mdWeekRates') + `
    function mdStoreSeries(){ return { budMonth: 1000, weeks: [{ sun: '2026-10-05', sales: 100, bud: 100, guests: 10, labor: 20, food: 0, hasAct: true }] }; }
    function monthGuestBudget(){ return 0; } function mcYmOffset(y){ return y; }`, n);
  run(n, "LABOR['F01|2026-10'] = ['2026-10-06']");
  assert.deepEqual(plain(run(n, "mdWeekRates('F01','2026-10')")).map(w => w.labor_rate), [150], 'not a viewer: as before');
  // the store card shows the note (読み込み中／読めなかった／DB にまだ無い) instead of a fixed text
  assert.match(SRC, /escapeHtml\(\(v\.reasonCode === 'no_labor' && v\.note\) \? v\.note : f\.how\)/);
  // a failed read is marked (_err) so it is not taken for an empty answer
  const f = { console };
  vm.createContext(f);
  vm.runInContext(fnSrc('_tipLaborFetchErr') + '\n' + fnSrc('fetchTipLaborFromDB') + "\nvar SUPABASE_URL='https://x', SUPABASE_ANON='a'; var RES = null; async function fetch(){ if (RES === 'throw') throw new Error('net'); return RES; }", f);
  run(f, "RES = { ok: false, status: 500 }"); let r = await run(f, "fetchTipLaborFromDB('g','2026-10-01','2026-10-31')");
  assert.equal(r.length, 0); assert.equal(r._err, true);
  run(f, "RES = 'throw'"); r = await run(f, "fetchTipLaborFromDB('g','2026-10-01','2026-10-31')");
  assert.equal(r._err, true);
  run(f, "RES = { ok: true, json: async function(){ return []; } }"); r = await run(f, "fetchTipLaborFromDB('g','2026-10-01','2026-10-31')");
  assert.equal(r.length, 0); assert.equal(r._err, undefined, 'an empty answer is not an error');
  assert.match(fnSrc('syncTipLaborFromDB'), /fetchErr: !!\(rows && rows\._err\)/);
});

/* Codex 6245991596（#74 4e685ac）・6246056356（#75 4bfc3ff）の P2：置き換えられた古い読み込みの答えが、新しい勤怠とクレジットTip調整額を戻した。
   本物の mdViewerEnsureLabor → syncTipLaborFromDB → fetchTipLaborFromDB → setTipLabor / setCreditTipAdjLocal を通す（時計・タイマー・fetch・保存先は合成） */
function laborApp() {
  const c = { console, AbortController, STORE: {}, FETCHES: [], TIMERS: [], NOW: 1000000, IGNORE_ABORT: false };
  vm.createContext(c);
  vm.runInContext(['_tipLaborFetchErr', 'fetchTipLaborFromDB', 'syncTipLaborFromDB', 'setTipLabor', 'setCreditTipAdjLocal', 'getCreditTipAdjMap', '_ctAdjKey',
    'normalizeBusinessDate', 'mdViewerEnsureLabor', '_mdViewBusy', 'mdLaborMark', 'mdLaborFresh', 'mdLaborMarksClear', '_mdBizDay', '_mdNoLaborDays', '_mdFrozenLoaded'].map(fnSrc).join('\n') + `
    Date.now = function(){ return NOW; };
    var setTimeout = function(fn, ms){ TIMERS.push(fn); return TIMERS.length; }, clearTimeout = function(){};   // timers run only when the test says so
    var _tipLaborSeq = 0, _tipLaborSaved = {};
    var _mdLaborMarks = {}, _mdViewLabor = {}, _mdViewInflight = {}, MD_VIEW_LABOR_TIMEOUT_MS = 20000, _mdViewRedrawT = null;
    var MD_VIEW_LABOR_RETRY_MS = 60000, MD_VIEW_LABOR_EMPTY_RETRY_MS = 600000;
    var SUPABASE_URL = 'https://x', SUPABASE_ANON = 'a';
    function bizToday(){ return '2026-10-17'; }
    function isFrozenMonth(){ return false; } function monthFrozenKey(){ return 'x'; }
    function mdIsAllViewer(){ return true; } function mdViewStores(){ return ['F01']; }
    function getStoresAll(){ return [{ id: 'F01', toastGuid: 'g1' }]; }
    function daysOfYm(ym){ return [{ date: ym + '-01' }, { date: ym + '-31' }]; }
    function laborCoreForYm(id){ return { noLaborDays: STORE['tip_labor_' + id + '_2026-10-02'] ? [] : ['2026-10-02'] }; }
    function _mdViewRedrawSoon(){}
    function getEmployees(){ return [{ name: 'Ken' }]; }
    function isOrderOnlyAccount(){ return false; }
    function tipHoursFromShifts(){ return { lunch: 0, dinner: 0 }; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function _lsRawStr(k){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null; }
    function _lsFreeOldLaborKeys(){} function _laborSaveWarn(){}
    function fetch(url, o){ return new Promise(function(res, rej){
      var f = { url: url, signal: o && o.signal, res: res, rej: rej };
      if (f.signal) f.signal.addEventListener('abort', function(){ if (!IGNORE_ABORT) rej(new Error('aborted')); });
      FETCHES.push(f); }); }
    function answer(i, hours, adj){ FETCHES[i].res({ ok: true, json: async function(){ return [{ business_date: '2026-10-02', lunch_credit_tip_adj: adj,
      data: [{ name: 'Ken', lunchHours: hours, dinnerHours: 0 }] }]; } }); }
    function saved(){ var l = STORE['tip_labor_F01_2026-10-02']; var a = (STORE['m_credit_tip_adj_F01'] || {})['2026-10-02'];
      return { hours: l && l.Ken ? l.Ken.lunch : null, adj: a ? a.lAdj : null }; }`, c);
  return c;
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

test('①（Codex 6245991596）: a replaced old read does not put old labor and credit tip adjustments back over a newer read (real save path)', async () => {
  for (const ignoreAbort of [false, true]) {   // true: the old answer still arrives after the abort (the save guard alone must hold)
    const c = laborApp(); c.IGNORE_ABORT = ignoreAbort;
    assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1, 'A starts');
    await flush(); assert.equal(c.FETCHES.length, 1);
    run(c, 'NOW += 25000');   // past the time limit, but A's timer has not run yet (a background tab)
    run(c, 'mdLaborMarksClear()');
    assert.equal(run(c, "mdViewerEnsureLabor('2026-10', ['F01'])"), 1, 'B starts');
    await flush(); assert.equal(c.FETCHES.length, 2);
    assert.equal(c.FETCHES[0].signal.aborted, true, 'A is cancelled when B replaces it');
    run(c, 'answer(1, 9, 9)'); await flush();
    assert.deepEqual(plain(run(c, 'saved()')), { hours: 9, adj: 9 }, 'B saved');
    assert.equal(run(c, "mdLaborFresh('F01','2026-10')"), true);
    run(c, 'TIMERS[0]()'); await flush();   // A's timer runs late
    run(c, 'answer(0, 1, 1)'); await flush();   // A's old answer arrives
    assert.deepEqual(plain(run(c, 'saved()')), { hours: 9, adj: 9 }, 'the old answer does not overwrite (ignoreAbort=' + ignoreAbort + ')');
    assert.equal(run(c, "mdLaborFresh('F01','2026-10')"), true);
  }
});

test('①（Codex 6245991596）: any two reads of the same store and day: the one started later wins, whatever order the answers come in; a read that is no longer used saves nothing', async () => {
  const c = laborApp();
  const days = "[{date:'2026-10-01'},{date:'2026-10-31'}]";
  // started A then B; B answers first, A later: B stays (login sync and month load also go through here)
  let pa = run(c, `syncTipLaborFromDB('F01','g1',${days})`), pb = run(c, `syncTipLaborFromDB('F01','g1',${days})`);
  await flush(); run(c, 'answer(1, 9, 9)'); const rb = await pb; run(c, 'answer(0, 1, 1)'); const ra = await pa;
  assert.deepEqual(plain(run(c, 'saved()')), { hours: 9, adj: 9 });
  assert.equal(rb.updated, 1); assert.equal(ra.updated, 0); assert.equal(ra.skipped, 1);
  // in order: the later one saves over the earlier one (as before)
  pa = run(c, `syncTipLaborFromDB('F01','g1',${days})`); pb = run(c, `syncTipLaborFromDB('F01','g1',${days})`);
  await flush(); run(c, 'answer(2, 3, 3)'); await pa; run(c, 'answer(3, 4, 4)'); await pb;
  assert.deepEqual(plain(run(c, 'saved()')), { hours: 4, adj: 4 });
  // another store's day is not blocked by this store's reads
  // a read whose caller no longer wants it (alive() false) or that was cancelled saves nothing
  const p = run(c, `syncTipLaborFromDB('F01','g1',${days},{ alive: function(){ return false; } })`);
  await flush(); run(c, 'answer(4, 7, 7)'); const r = await p;
  assert.equal(r.stale, true); assert.equal(r.updated, 0);
  assert.deepEqual(plain(run(c, 'saved()')), { hours: 4, adj: 4 });
  // a read that timed out (its own time limit passed and nothing replaced it) does not save its late answer either
  const t = laborApp(); t.IGNORE_ABORT = true;
  run(t, "mdViewerEnsureLabor('2026-10', ['F01'])"); await flush();
  run(t, 'TIMERS[0]()'); await flush();
  assert.equal(t.FETCHES[0].signal.aborted, true);
  run(t, 'answer(0, 5, 5)'); await flush();
  assert.deepEqual(plain(run(t, 'saved()')), { hours: null, adj: null }, 'the timed-out read saves nothing; the next read (a minute later) brings the data');
  // the same where the browser has no AbortController (nothing can be cancelled): the read is no longer used, so it saves nothing
  const n = laborApp(); n.AbortController = undefined;
  run(n, "mdViewerEnsureLabor('2026-10', ['F01'])"); await flush();
  assert.equal(n.FETCHES[0].signal, undefined);
  run(n, 'TIMERS[0]()'); await flush();
  run(n, 'answer(0, 5, 5)'); await flush();
  assert.deepEqual(plain(run(n, 'saved()')), { hours: null, adj: null });
});

test('B（独立レビュー P2-2）: tapping the notification switches the receipts screen back to the list, where the reimbursement card is', () => {
  const c = { console }; vm.createContext(c);
  vm.runInContext(fnSrc('rbApplyNotifFocus') + "\nvar _rbView = { ym: '', status: 'all' }; var window = { _invMainView: 'checks' };", c);
  run(c, "rbApplyNotifFocus({ rbFocus: { ym: '2026-10', status: 'rejected' } })");
  assert.equal(run(c, 'window._invMainView'), 'list');
  assert.deepEqual(plain(run(c, '_rbView')), { ym: '2026-10', status: 'rejected' });
  run(c, "window._invMainView='checks'; rbApplyNotifFocus({ page: 'invoice' })");
  assert.equal(run(c, 'window._invMainView'), 'checks', 'other notifications do not touch it');
});

test('B（独立レビュー P3）: if the notification cannot be saved on this device, it is not remembered as sent (tried again next time)', () => {
  const c = rbApp('office', 'Akane');
  c.STORE.reimbursements = [RB()];
  run(c, "var _lsSet0 = lsSet; lsSet = function(k, v){ if (k === 'notifications') return false; return _lsSet0(k, v); }");
  run(c, 'rbNotifyRejectedPaid()');
  assert.equal(c.STORE.rb_rp_seen, undefined);
  run(c, 'lsSet = _lsSet0');
  assert.equal(run(c, 'rbNotifyRejectedPaid()'), 1);
  assert.ok(c.STORE.rb_rp_seen);
});

test('①（独立レビュー P3）: names with quotes or "&quot;" in the setting buttons stay inside the call', () => {
  const c = { console, STORE: {}, ARGS: [] }; vm.createContext(c);
  const esc = /^function escapeHtml\(s\)\{.*\}$/m.exec(SRC)[0];   // one line; fnSrc cannot read its /"/ regex
  vm.runInContext(fnSrc('scAllViewerHtml') + '\n' + esc + "\nfunction mdAllViewers(){ return {}; }", c);
  const nasty = 'Yu"ki &quot;);alert(1);//';
  const h = run(c, 'scAllViewerHtml(' + JSON.stringify([{ kind: 'am', id: 'e-1', name: nasty }]) + ')');
  const m = /onclick="([^"]*)"/.exec(h); assert.ok(m, 'one double-quoted attribute');
  const js = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  vm.runInContext('function scToggleAllViewer(a, b){ ARGS.push([a, b]); }\n' + js, c);
  assert.deepEqual(plain(c.ARGS), [['e-1', nasty]]);
  assert.match(fnSrc('scToggleAllViewer'), /showToast\(escapeHtml\(name\)/);
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
