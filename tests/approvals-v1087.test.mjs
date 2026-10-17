// App v1087 (UI案52 ①④, Moto 2026-10-16 "全部A"):
//  - approvals merge per role (two devices signing different roles keep both), a sign-off removed by its owner stays removed,
//    undo moves to a new generation, the accounting check (acct) is merged by time;
//  - request records (mileage / expense / leave) keep the newer decision by the status time (_stT);
//  - incoming notifications are merged with unsent local ones;
//  - every decision (approval center or the request's own page) resolves the approval-center item and notifies the applicant,
//    and the final approval of a money / payroll type notifies accounting and office crew; the accounting tab records who checked it;
//  - office crew gets the pending notices accounting gets, sees 本部 requests;
//  - the 食材管理「発注」 tab is gone, its old links go to 棚卸し, its data and sync rules stay.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1086 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

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
function varSrc(name) { const m = new RegExp('^var ' + name + '\\b[^\\n]*$', 'm').exec(SRC); if (!m) throw new Error('var not found: ' + name); return m[0]; }
// A top-level object literal `var NAME = { ... };` (balanced braces), for the nav tables.
function objSrc(decl) {
  const i = SRC.indexOf(decl); if (i < 0) throw new Error('not found: ' + decl);
  const open = SRC.indexOf(decl.trim().endsWith('[') ? '[' : '{', i);
  const close = decl.trim().endsWith('[') ? ']' : '}';
  let d = 0;
  for (let j = open; j < SRC.length; j++) { if (SRC[j] === SRC[open]) d++; else if (SRC[j] === close && --d === 0) return SRC.slice(i, j + 1); }
  throw new Error('unterminated ' + decl);
}

const MERGE = ['_apAcctOn', '_apSigBody', '_apDecided', '_apTs', '_apUnionSignoffs', '_apMut', '_apGen', '_apStT', '_apSoT', '_apMergeOne', 'mergeApprovals', '_apSig',
  '_coversApprovals', '_rtDel', '_rtPend', '_rtStT', 'mergeReqTomb', '_coversReqTomb', 'mergeNotifs', '_invMut', 'mergeInvoices'];
const APPROVAL = ['_apFollowPage', '_apNewestForRef', 'apFinalize', 'apNotifyAcctApplied', '_apDecidedElsewhere', '_apSigBody', '_actorName', '_apGradeChainTypes', '_apApplicantGrade', '_apUserInScope', '_apStoreHasAm', 'approvalRequiredRoles',
  '_approvalStore', '_approvalStoreId', '_approvalMyRoles', '_approvalSignedMap', '_approvalAllDone', '_approvalRoleLabel', '_approvalChainHtml',
  'addApproval', 'signoffApproval', 'overrideApproveAll', 'rejectApprovalItem', 'cancelMySignoff', 'approveItem', 'reopenApproval', 'renderApproval',
  '_apFreshPending', 'apPullLatest', '_apOnApprovalPage', '_apRerender', 'apAutoPull', 'apRefreshNow', '_apRecordState', '_apMarkDecided',
  'apNotifyDecision', 'apNeedsAcct', 'apCanAcct', 'apSeesAcct', 'apWithOfficeCrew', '_apStoreLabel', 'apAcctPending', 'apAcctConfirm',
  '_apAcctNotifHtml', '_apShortTime', '_apDeciders', '_apReopenRec', 'resolveApprovalByRef', '_apResolveLocal', '_apNotifyHits',
  'apDecidedFromPage', 'apWithdrawByRef', 'apReopenByRef', 'setApTab', 'invTouch', '_apRecTime', '_apPullRecord', '_rtNextT', '_rtTouchMut', 'apReopenTime',
  'canApproveMileage', 'approveMileage', 'rejectMileage', 'deleteMyMileage', 'mileageMonthEndClose', 'canMileageMonthEnd',
  'canApproveReimburse', 'approveReimburse', '_applyReimburseDecision', 'cancelApprovedVacation', 'canApproveVacation', 'approveTip',
  'notifForMe', '_roleMatch', '_userSupportsStore', '_amManagesStore', 'getNotifs', 'addNotif', 'onNotifIncoming', 'myNotifs', 'myUnreadCount'];
const VARS = ['AP_ACCT_TYPES', '_apBusy', '_apTab', '_apPullAt', 'AP_REC_KEYS'];   // _apPullAt's line also holds AP_PULL_TIMEOUT_MS

const ROLE_CONFIG = { ceo: { name: 'Tac' }, gm: { name: 'Moto' }, office: { name: 'Marcia' }, am: { name: 'Yuki' }, sl: { name: 'Store Leader' },
  office_crew: { name: '事務スタッフ' }, crew: { name: 'スタッフ' }, chef: { name: 'Head Chef' } };
const EMPLOYEES = [
  { name: 'Crew A', store: 'F01', role: 'crew', grade: 1 },
  { name: 'Akane', store: 'OFFICE', role: 'office_crew', grade: 1 },
  { name: 'Leader B', store: 'F01', role: 'sl', grade: 3 },
];

// fns: names to load; cloud: a separate object standing for the app_state row of each key (pullOpKey merges it in).
function app(fns, { role = 'office', user = 'Marcia', st = {}, cloud = null, routing = {} } = {}) {
  const S = JSON.parse(JSON.stringify(st));
  const c = {
    curRole: role, curUserName: user, curStore: 'ALL', curStoreLogin: false, curLang: 'ja', curPage: 'approval', ROLE_CONFIG,
    STORES: [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }],
    alerts: [], toasts: [], rendered: [], writes: [], S,
    t: (ja) => ja, ls: (k, d) => (k in S ? S[k] : d), lsSet: (k, v) => { S[k] = v; c.writes.push([k, JSON.stringify(v)]); return true; },
    _lsRaw: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), _lsWriteVerified: (k, json) => { S[k] = JSON.parse(json); return true; },
    alert: m => c.alerts.push(m), confirm: () => true, showToast: (m, k) => c.toasts.push([m, k]), renderPage: p => c.rendered.push(p),
    nowJP: () => '2026/10/16 09:10', todayJP: () => '2026/10/16', openInputModal: (o, cb) => cb('理由'), escapeHtml: s => String(s == null ? '' : s),
    getEmployees: () => EMPLOYEES, empGradeNum: e => e.grade || 1, myGradeNum: () => (EMPLOYEES.find(e => e.name === c.curUserName) || { grade: 6 }).grade,
    getStoresAll: () => [{ id: 'F01', am: 'Yuki' }, { id: 'F02' }], myAmStores: () => ['F01'], mySupportStores: () => [], vacManagerGrade: () => 0, isStoreManager: () => false,
    approversForType: type => (routing[type] && routing[type].length ? routing[type] : ['office', 'gm', 'am']),
    getVisibleStores: () => c.STORES, getReimbursements: () => S.reimbursements || [], saveReimbursements: v => { S.reimbursements = v; c.writes.push(['reimbursements', JSON.stringify(v)]); },
    getMileageRequests: () => (S.mileage_requests || []).filter(x => !x._deleted), saveMileageReqs: v => { S.mileage_requests = v; c.writes.push(['mileage_requests', JSON.stringify(v)]); },
    mileMyName: () => c.curUserName, getVacations: () => S.my_vacations || [], saveVacations: v => { S.my_vacations = v; },
    getExpenseRequests: () => (S.expense_requests || []).filter(x => !x._deleted), saveExpenseReqs: v => { S.expense_requests = v; },
    getSkillRequests: () => S.skill_requests || [], setSkillRequests: v => { S.skill_requests = v; }, getOffboardings: () => [], setOffboardings: () => {},
    getEmpSkillsStore: () => ({}), setEmpSkillStore: () => {}, addSkillHistory: () => {}, posLabel: p => p, curYm: () => '2026-10',
    renderNotifBell: () => {}, renderNotifPanel: () => {}, document: { getElementById: () => null }, workTab: 'today', setTimeout, clearTimeout,
    SUPA_SYNC_ENABLED: !!cloud,
    // The app's split rows for request records (one row per applicant / store), as in _SPLIT_KEYS.
    _SPLIT_KEYS: { mileage_requests: { type: 'arr', by: r => r && r.employee }, expense_requests: { type: 'arr', by: r => r && r.employee },
      my_vacations: { type: 'arr', by: r => r && r.employee }, reimbursements: { type: 'arr', by: r => r && r.storeId },
      tip_requests: { type: 'arr', by: r => r && r.name }, lss_requests: { type: 'arr', by: r => r && r.name } },
  };
  // The cloud read merges like the app does (approvals: mergeApprovals; request records: mergeReqTomb, also for a split row
  // spl_<key>_<id>, which updates the same list here); other keys are replaced.
  if (cloud) c.pullOpKey = async (key) => {
    c.pulls = (c.pulls || 0) + 1; (c.pulled = c.pulled || []).push(key);
    const base = /^spl_(mileage_requests|expense_requests|my_vacations)_/.exec(key), k = base ? base[1] : key;
    if (!(key in cloud)) return true;
    if (k === 'approvals' && c.mergeApprovals) S[k] = c.mergeApprovals(cloud[key], S[k] || []);
    else if (/^(mileage_requests|expense_requests|my_vacations)$/.test(k) && c.mergeReqTomb) S[k] = c.mergeReqTomb(cloud[key], S[k] || []);
    else S[k] = cloud[key];
    return true;
  };
  vm.createContext(c);
  // Missing names are skipped so the same checks can run on an older build (FUNERGY_INDEX); a call to one then fails the test.
  const code = fns.map(n => { try { return fnSrc(n); } catch (_e) { return ''; } }).concat(VARS.map(n => { try { return varSrc(n); } catch (_e) { return ''; } })).join('\n');
  vm.runInContext(code, c);
  return c;
}
const run = (c, expr) => vm.runInContext(expr, c);
const plain = v => JSON.parse(JSON.stringify(v));
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const AP = (over = {}) => ({ id: 'ap1', type: 'ガソリン代', title: 'Leader B 移動 $12.00', from: 'Leader B', store: 'F01', ref: 'mi1', status: 'pending', _mut: 100, ...over });

test('approvals: two devices signing different roles keep both sign-offs (v1086 kept only the later record)', () => {
  const c = app(MERGE);
  const base = AP({ type: 'シフト変更', ref: undefined, signoffs: [] });
  const devA = { ...base, signoffs: [{ role: 'am', name: 'Yuki', _t: 200 }], _mut: 200 };
  const devB = { ...base, signoffs: [{ role: 'office', name: 'Marcia', _t: 300 }], _mut: 300 };
  for (const [cl, lo] of [[devA, devB], [devB, devA]]) {
    const m = plain(run(c, 'mergeApprovals(' + JSON.stringify([cl]) + ',' + JSON.stringify([lo]) + ')'))[0];
    assert.deepEqual(m.signoffs.map(s => s.role).sort(), ['am', 'office']);
    assert.equal(m._mut, 301);   // content differs from both copies: one past the newest save, so v1086 devices take it
    assert.equal(m.status, 'pending');
  }
  // covers: the cloud without the other device's sign-off is not "covered".
  assert.equal(run(c, '_coversApprovals(' + JSON.stringify([devA]) + ',' + JSON.stringify([devB]) + ')'), false);
  const m = run(c, 'mergeApprovals(' + JSON.stringify([devA]) + ',' + JSON.stringify([devB]) + ')');
  assert.equal(run(c, '_coversApprovals(' + JSON.stringify(plain(m)) + ',' + JSON.stringify(plain(m)) + ')'), true);
  assert.equal(run(c, '_coversApprovals(' + JSON.stringify(plain(m)) + ',' + JSON.stringify([devB]) + ')'), true);
});

test('approvals: a removed own sign-off stays removed; decided beats pending; undo (new generation) beats the old decision', () => {
  const c = app(MERGE);
  const signed = AP({ signoffs: [{ role: 'am', name: 'Yuki', _t: 200 }], _mut: 200 });
  const removed = AP({ signoffs: [], _soX: { am: 250 }, _mut: 250 });
  const mg = (a, b) => plain(run(c, 'mergeApprovals(' + JSON.stringify([a]) + ',' + JSON.stringify([b]) + ')'))[0];
  assert.deepEqual(mg(signed, removed).signoffs, []);
  assert.deepEqual(mg(removed, signed).signoffs, []);
  // Signing again after the removal counts.
  const again = AP({ signoffs: [{ role: 'am', name: 'Yuki', _t: 400 }], _mut: 400 });
  assert.deepEqual(mg(removed, again).signoffs.map(s => s._t), [400]);
  // Decided beats a stale pending copy even when the pending copy was saved later (a sign-off on another device).
  const approved = AP({ status: 'approved', _stT: 500, _mut: 500, signoffs: [{ role: 'am', name: 'Yuki', _t: 400 }, { role: 'office', name: 'Marcia', _t: 500 }] });
  const stalePending = AP({ signoffs: [{ role: 'gm', name: 'Moto', _t: 600 }], _mut: 600 });
  const m1 = mg(approved, stalePending);
  assert.equal(m1.status, 'approved');
  assert.deepEqual(m1.signoffs.map(s => s.role).sort(), ['am', 'gm', 'office']);
  assert.equal(m1._mut, 601);   // newer than both copies (v1086 devices compare it)
  // Merging a result again changes nothing (no endless bumping in the push loop).
  const m1b = plain(run(c, 'mergeApprovals(' + JSON.stringify([m1]) + ',' + JSON.stringify([stalePending]) + ')'))[0];
  assert.deepEqual(m1b, m1);
  // A decision saved by a v1086 device (no decision time) still beats a pending copy saved later with a sign-off.
  const oldApproved = AP({ status: 'approved', _mut: 500, signoffs: [{ role: 'am', name: 'Yuki' }] });
  assert.equal(mg(oldApproved, stalePending).status, 'approved');
  assert.equal(mg(stalePending, oldApproved).status, 'approved');
  // Both decided: the decision time decides even when the other copy was saved later (accounting check on a stale copy).
  const rejLater = AP({ status: 'rejected', _stT: 900, _mut: 900, rejectReason: 'x' });
  const apprConfirmedLater = { ...approved, acct: { by: 'Marcia', t: 1000 }, _mut: 1000 };
  assert.equal(mg(apprConfirmedLater, rejLater).status, 'rejected');
  assert.equal(mg(rejLater, apprConfirmedLater).status, 'rejected');
  // Undo moves to a new generation: the old decision and its sign-offs lose.
  const reopened = AP({ status: 'pending', _gen: 1, signoffs: [], _stT: 700, _mut: 700 });
  for (const [a, b] of [[approved, reopened], [reopened, approved]]) { const m = mg(a, b); assert.equal(m.status, 'pending'); assert.equal(m._gen, 1); assert.deepEqual(m.signoffs, []); }
  // The newer generation wins with a save time past the older one (a v1086 device would otherwise keep the old generation).
  const oldLater = { ...approved, _mut: 900 };
  assert.ok(mg(oldLater, reopened)._mut > 900);
  assert.equal(mg(oldLater, reopened)._gen, 1);
  // An undo saved by a v1086 device (no generation): pending, no sign-offs, later save, the decision time copied.
  const oldUndo = { ...approved, status: 'pending', signoffs: [], _mut: 800 };
  assert.equal(mg(approved, oldUndo).status, 'pending');
  // ... and the accounting check copied with it is dropped (it belonged to the undone approval).
  const oldUndoAcct = { ...oldUndo, acct: { by: 'Marcia', t: 700 } };
  assert.equal(mg({ ...approved, acct: { by: 'Marcia', t: 700 } }, oldUndoAcct).acct, undefined);
  assert.equal(mg(oldUndoAcct, approved).acct, undefined);
  // Both decided: the newer decision time wins.
  const rejected = AP({ status: 'rejected', _stT: 900, _mut: 900, rejectReason: 'x' });
  assert.equal(mg(approved, rejected).status, 'rejected');
  assert.equal(mg(rejected, approved).status, 'rejected');
  // Accounting check: newer time wins, undo included.
  const ok1 = { ...approved, acct: { by: 'Marcia', t: 1000 } }, off = { ...approved, acct: { by: 'Akane', t: 1100, off: true } };
  assert.equal(mg(ok1, off).acct.off, true);
  assert.equal(mg(off, ok1).acct.off, true);
  assert.equal(mg(approved, ok1).acct.by, 'Marcia');
});

test('approvals: a re-sign survives whichever order the copies are merged in (the newest sign-off per role is kept)', () => {
  const c = app(MERGE);
  const M = (a, b) => plain(run(c, 'mergeApprovals(' + JSON.stringify([a]) + ',' + JSON.stringify([b]) + ')'))[0];
  const cloud = AP({ type: 'シフト変更', ref: undefined, signoffs: [{ role: 'office', name: 'Marcia', _t: 11 }, { role: 'am', name: 'Yuki', _t: 24 }], _mut: 24 });
  const d1 = AP({ type: 'シフト変更', ref: undefined, signoffs: [{ role: 'office', name: 'Akane', _t: 23 }], _mut: 23 });
  const d2 = AP({ type: 'シフト変更', ref: undefined, signoffs: [], _soX: { office: 20 }, _mut: 20 });
  const f1 = M(M(cloud, d1), d2), f2 = M(M(cloud, d2), d1);
  for (const f of [f1, f2]) assert.deepEqual(f.signoffs.map(s => s.role + '@' + s._t).sort(), ['am@24', 'office@23']);
});

test('approvals: random three-device histories never lose a sign-off that was not removed', () => {
  const c = app(MERGE);
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const roles = ['am', 'gm', 'office', 'first'];
  for (let n = 0; n < 300; n++) {
    let cloud = [AP({ type: 'シフト変更', signoffs: [], _mut: 1 })];
    const dev = [0, 1, 2].map(() => plain(cloud));
    let t = 10; const live = {};
    for (let k = 0; k < 12; k++) {
      const d = Math.floor(rnd() * 3), a = dev[d][0];
      const r = roles[Math.floor(rnd() * roles.length)];
      t += 1;
      if (rnd() < 0.7) { if (!(a.signoffs || []).some(s => s.role === r)) { a.signoffs = (a.signoffs || []).concat([{ role: r, name: 'p', _t: t }]); live[r] = t; } }
      else if ((a.signoffs || []).some(s => s.role === r)) { a._soX = { ...(a._soX || {}), [r]: t }; a.signoffs = a.signoffs.filter(s => s.role !== r); delete live[r]; }
      a._mut = t;
      if (rnd() < 0.6) { cloud = plain(run(c, 'mergeApprovals(' + JSON.stringify(cloud) + ',' + JSON.stringify(dev[d]) + ')')); dev[d] = plain(cloud); }
      if (rnd() < 0.3) { const e = Math.floor(rnd() * 3); dev[e] = plain(run(c, 'mergeApprovals(' + JSON.stringify(cloud) + ',' + JSON.stringify(dev[e]) + ')')); }
    }
    const finals = [[0, 1, 2], [2, 1, 0], [1, 2, 0]].map(ord => { let cl = cloud; for (const d of ord) cl = plain(run(c, 'mergeApprovals(' + JSON.stringify(cl) + ',' + JSON.stringify(dev[d]) + ')')); return cl; });
    // Every role whose latest action was a sign-off is present; a role whose latest action was a removal is not; whatever the order.
    for (const fin of finals) assert.deepEqual(fin[0].signoffs.map(s => s.role + '@' + s._t).sort(), Object.keys(live).map(r => r + '@' + live[r]).sort(), 'history ' + n);
  }
});

test('request records: a newer decision or month-end close is kept against a stale copy; unstamped records merge as before', () => {
  const c = app(MERGE);
  const mg = (a, b) => plain(run(c, 'mergeReqTomb(' + JSON.stringify([a]) + ',' + JSON.stringify([b]) + ')'))[0];
  const approved = { id: 'mi1', status: '承認', _stT: 100 };
  const closed = { id: 'mi1', status: '承認', archived: true, _stT: 200 };
  assert.equal(mg(closed, approved).archived, true);   // v1086: the stale local copy won
  assert.equal(mg(approved, closed).archived, true);
  const undone = { id: 'mi1', status: '申請中', _stT: 300 };
  assert.equal(mg(approved, undone).status, '申請中');  // the undo propagates
  assert.equal(mg({ id: 'mi1', status: '申請中' }, approved).status, '承認');   // a stale pending copy loses
  // Without stamps: exactly the old rules (deleted first, reviewed beats pending, otherwise local).
  assert.equal(mg({ id: 'x', status: '承認' }, { id: 'x', status: '申請中' }).status, '承認');
  assert.equal(mg({ id: 'x', status: '承認', v: 1 }, { id: 'x', status: '却下', v: 2 }).v, 2);
  assert.equal(mg({ id: 'x', status: '承認', _deleted: true, _stT: 1 }, { id: 'x', status: '承認', _stT: 99 })._deleted, true);
  assert.equal(run(c, '_coversReqTomb(' + JSON.stringify([approved]) + ',' + JSON.stringify([closed]) + ')'), false);
  assert.equal(run(c, '_coversReqTomb(' + JSON.stringify([closed]) + ',' + JSON.stringify([closed]) + ')'), true);
});

test('notifications: an incoming cloud copy does not drop a notice that was not sent yet', () => {
  const c = app(MERGE.concat(['getNotifs', 'notifForMe', '_roleMatch', '_userSupportsStore', '_amManagesStore', 'myNotifs', 'myUnreadCount', 'onNotifIncoming']), {
    st: { notifications: [{ id: 'n-local', at: '2026-10-16T19:00:00Z', title: 'local', toRoles: ['office'], readBy: [] }] } });
  run(c, 'onNotifIncoming(' + JSON.stringify([{ id: 'n-cloud', at: '2026-10-16T18:00:00Z', title: 'cloud', toRoles: ['office'], readBy: [] }]) + ')');
  assert.deepEqual(c.S.notifications.map(n => n.id).sort(), ['n-cloud', 'n-local']);
});

test('approving on the mileage page resolves the approval-center item and notifies the applicant, accounting and office crew', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'am', user: 'Yuki', st: {
    approvals: [AP()], mileage_requests: [{ id: 'mi1', status: '申請中', storeId: 'F01', employee: 'Leader B', amount: 12, purpose: '移動' }], notifications: [] } });
  await run(c, 'approveMileage("mi1")');
  await tick();
  const a = c.S.approvals[0];
  assert.equal(a.status, 'approved');
  assert.equal(a.decidedBy, 'Yuki');
  assert.ok(a.decidedAt && a._stT);
  assert.ok(c.S.mileage_requests[0]._stT);
  const ns = c.S.notifications;
  const toApplicant = ns.find(n => n.toUser === 'Leader B');
  assert.match(toApplicant.title, /ガソリン代 が承認されました/);
  assert.match(toApplicant.text, /Yuki/);
  const toAcct = ns.find(n => n.apTab === 'acct');
  assert.match(toAcct.title, /承認済み：ガソリン代（処理してください）/);
  assert.deepEqual(plain(toAcct.toRoles), ['office', 'office_crew']);
  assert.equal(toAcct.refId, 'ap1');
  // Reject on the page: the item is rejected with the reason; no accounting notice.
  const r = app(MERGE.concat(APPROVAL), { role: 'am', user: 'Yuki', st: {
    approvals: [AP()], mileage_requests: [{ id: 'mi1', status: '申請中', storeId: 'F01', employee: 'Leader B', amount: 12 }], notifications: [] } });
  await run(r, 'rejectMileage("mi1")'); await tick();
  assert.equal(r.S.approvals[0].status, 'rejected');
  assert.equal(r.S.approvals[0].rejectReason, '理由');
  assert.ok(!r.S.notifications.some(n => n.apTab === 'acct'));
  assert.match(r.S.notifications.find(n => n.toUser === 'Leader B').title, /却下されました/);
  // Withdrawing the request withdraws the item.
  const w = app(MERGE.concat(APPROVAL), { role: 'sl', user: 'Leader B', st: { approvals: [AP()], mileage_requests: [{ id: 'mi1', status: '申請中', storeId: 'F01', employee: 'Leader B' }] } });
  run(w, 'deleteMyMileage("mi1")');
  assert.equal(w.S.approvals[0].status, 'withdrawn');
});

test('pages without a link to the item (legacy TipRate / Leadership) find it by name; the approval center does not change a TipRate', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap9', type: 'TipRate', title: 'Crew A Tip Rate申請 90%', from: 'Crew A', store: '---', ref: undefined })],
    tip_requests: [{ id: 'tip1', name: 'Crew A', rate: 90, status: '申請中' }], tip_history: [], notifications: [] } });
  run(c, 'approveTip("tip1","承認")'); await tick();
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.ok(c.S.notifications.some(n => n.toUser === 'Crew A' && /TipRate が承認されました/.test(n.title)));
  // Applied on the page: accounting and office crew are told (2A).
  const acc = c.S.notifications.find(n => /承認済み：Tip Rate（処理してください）/.test(n.title));
  assert.deepEqual(plain(acc.toRoles), ['office', 'office_crew']);
  assert.equal(acc.page, undefined);   // the Tip Rate page is not in accounting's menu
  // A 5% request does not match a "15%" title.
  const e = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap7', type: 'TipRate', title: 'Crew A Tip Rate申請 15%', from: 'Crew A', store: '---', ref: undefined })],
    tip_requests: [{ id: 'tip3', name: 'Crew A', rate: 5, status: '申請中' }], tip_history: [], notifications: [] } });
  run(e, 'approveTip("tip3","承認")'); await tick();
  assert.equal(e.S.approvals[0].status, 'pending');
  // Approval center, linked item: the tip request is not changed (as before v1087; the rate is applied on the Tip Rate page),
  // and accounting is not asked to process anything yet.
  const d = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap8', type: 'TipRate', title: 'Crew A Tip Rate申請 100%', from: 'Crew A', store: '---', ref: 'tip2', signoffs: [{ role: 'office', name: 'Marcia' }, { role: 'gm', name: 'Moto' }, { role: 'am', name: 'Yuki' }] })],
    tip_requests: [{ id: 'tip2', name: 'Crew A', rate: 100, status: '申請中' }], tip_history: [], notifications: [] } });
  await run(d, 'approveItem("ap8","approved")');
  assert.equal(d.S.approvals[0].status, 'approved');
  assert.equal(d.S.tip_requests[0].status, '申請中');
  assert.equal(d.S.tip_history.length, 0);
  assert.ok(!d.S.notifications.some(n => /処理してください/.test(n.title)));
  // ... and when the page then approves it, the applicant is not told twice.
  const before = d.S.notifications.filter(n => n.toUser === 'Crew A').length;
  run(d, 'approveTip("tip2","承認")'); await tick();
  assert.equal(d.S.notifications.filter(n => n.toUser === 'Crew A').length, before);
});

test('Leadership page approval (legacy item without a link) resolves the item, tells the applicant, and asks accounting to process it', async () => {
  const c = app(MERGE.concat(APPROVAL, ['approveLssRequest', 'getLssRequests']), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap6', type: 'Leadership', title: 'Crew A Tip Rate申請（Leadership 80%）', from: 'Crew A', store: 'F01', ref: undefined })],
    lss_requests: [{ id: 'lss1', name: 'Crew A', kind: 'tip', status: '申請中' }], notifications: [] } });
  run(c, 'approveLssRequest("lss1","承認")'); await tick();
  assert.equal(c.S.lss_requests[0].status, '承認');
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.ok(c.S.notifications.some(n => n.toUser === 'Crew A' && /Leadership が承認されました/.test(n.title)));
  const acc = c.S.notifications.find(n => /承認済み：Tip Rate（処理してください）/.test(n.title));
  assert.equal(acc.page, undefined);
  assert.deepEqual(plain(acc.toRoles), ['office', 'office_crew']);
  // A rejection: no accounting notice.
  const d = app(MERGE.concat(APPROVAL, ['approveLssRequest', 'getLssRequests']), { role: 'gm', user: 'Moto', st: {
    approvals: [], lss_requests: [{ id: 'lss2', name: 'Crew A', kind: 'tip', status: '申請中' }], notifications: [] } });
  run(d, 'approveLssRequest("lss2","却下")'); await tick();
  assert.ok(!d.S.notifications.some(n => /処理してください/.test(n.title)));
});

test('a Tip Rate decided on its page cannot be undone from the approval center (no reject-after-undo turning into approved)', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap8', type: 'TipRate', title: 'Crew A Tip Rate申請 100%', from: 'Crew A', store: '---', ref: 'tip2', status: 'approved', _stT: 500, _mut: 500, decidedAt: '2026-10-16T18:00:00Z' })],
    tip_requests: [{ id: 'tip2', name: 'Crew A', rate: 100, status: '承認' }], notifications: [] } });
  await run(c, 'reopenApproval("ap8")');
  assert.match(c.alerts.at(-1), /承認センターからは取り消せません/);
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.equal(c.S.approvals[0]._gen, undefined);
  // An item the center approved but the page did not apply can still be undone.
  const d = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap8', type: 'TipRate', title: 'x', from: 'Crew A', store: '---', ref: 'tip2', status: 'approved', _stT: 500, _mut: 500 })],
    tip_requests: [{ id: 'tip2', name: 'Crew A', rate: 100, status: '申請中' }], notifications: [] } });
  await run(d, 'reopenApproval("ap8")');
  assert.equal(d.S.approvals[0].status, 'pending');
  assert.equal(d.S.approvals[0]._gen, 1);
});

test('an old Tip Rate item (no link) decided on the page cannot be undone from the center either', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ id: 'ap9', type: 'TipRate', title: 'Crew A Tip Rate申請 90%', from: 'Crew A', store: '---', ref: undefined })],
    tip_requests: [{ id: 'tip1', name: 'Crew A', rate: 90, status: '申請中' }], tip_history: [], notifications: [] } });
  run(c, 'approveTip("tip1","承認")'); await tick();
  assert.equal(c.S.approvals[0].via, 'page');
  await run(c, 'reopenApproval("ap9")');
  assert.match(c.alerts.at(-1), /承認センターからは取り消せません/);
  assert.equal(c.S.approvals[0].status, 'approved');
});

test('the center rejected it, then the page approved it: after reading the cloud, the center follows the page and the applicant is told', async () => {
  const rejected = AP({ id: 'ap8', type: 'TipRate', title: 'x', from: 'Crew A', store: '---', ref: 'tip2', status: 'rejected', _stT: 500, _mut: 500, rejectReason: 'x' });
  const st = { approvals: [rejected], tip_requests: [{ id: 'tip2', name: 'Crew A', rate: 100, status: '申請中' }], tip_history: [], notifications: [] };
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st, cloud: { approvals: [rejected] } });
  run(c, 'approveTip("tip2","承認")'); await tick();
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.equal(c.S.approvals[0].via, 'page');
  assert.ok(c.S.notifications.some(n => n.toUser === 'Crew A' && /承認されました/.test(n.title)));
  // Without reading the cloud (offline / sync off) nothing is re-marked.
  const off = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st });
  run(off, 'approveTip("tip2","承認")'); await tick();
  assert.equal(off.S.approvals[0].status, 'rejected');
});

test('following the page never rewrites an older round: a resubmitted plan, a reopened item, several decided rounds', async () => {
  // Monthly plan: round 1 rejected here; the resubmitted round 2 is only in the cloud.
  const r1 = AP({ id: 'apA', type: '月間行動計画', title: 'plan', from: 'Chef', store: '---', ref: '2026-10', ym: '2026-10', status: 'rejected', _stT: 100, _mut: 100 });
  const r2 = AP({ id: 'apB', type: '月間行動計画', title: 'plan', from: 'Chef', store: '---', ref: '2026-10', ym: '2026-10', status: 'pending', _mut: 200 });
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [r1], notifications: [] }, cloud: { approvals: [r1, r2] } });
  await run(c, 'apDecidedFromPage("月間行動計画", "2026-10", "approved", {ym:"2026-10", noApplicant:true})');
  assert.deepEqual(plain(c.S.approvals.map(a => a.id + ':' + a.status).sort()), ['apA:rejected', 'apB:approved']);
  // A plan round is never rewritten by following the page (the same month is resubmitted as a new item), even with no pending round anywhere.
  const p = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [r1], notifications: [] }, cloud: { approvals: [r1] } });
  await run(p, 'apDecidedFromPage("月間行動計画", "2026-10", "approved", {ym:"2026-10", noApplicant:true})');
  assert.equal(p.S.approvals[0].status, 'rejected');
  // Mileage: this device still has the old generation rejected; another device reopened it (generation 1, pending).
  const g0 = AP({ status: 'rejected', _stT: 100, _mut: 100 });
  const g1 = AP({ status: 'pending', _gen: 1, _stT: 300, _mut: 300 });
  const d = app(MERGE.concat(APPROVAL), { role: 'am', user: 'Yuki', st: { approvals: [g0], notifications: [] }, cloud: { approvals: [g1] } });
  await run(d, 'apDecidedFromPage("ガソリン代", "mi1", "approved", {applicant:"Leader B"})');
  assert.equal(d.S.approvals[0].status, 'approved');
  assert.equal(d.S.approvals[0]._gen, 1);
  // Two decided rounds with the same ref: only the newest is followed.
  const old = AP({ id: 'apX', status: 'rejected', _stT: 100, _mut: 100 }), newer = AP({ id: 'apY', status: 'rejected', _stT: 200, _mut: 200 });
  const e = app(MERGE.concat(APPROVAL), { role: 'am', user: 'Yuki', st: { approvals: [old, newer], notifications: [] }, cloud: { approvals: [old, newer] } });
  await run(e, 'apDecidedFromPage("ガソリン代", "mi1", "approved", {applicant:"Leader B"})');
  assert.deepEqual(plain(e.S.approvals.map(a => a.id + ':' + a.status).sort()), ['apX:rejected', 'apY:approved']);
});

test('v1086 devices: the merged record is always newer than the newest copy it differs from; an old accounting check does not come back', () => {
  const c = app(MERGE);
  const mg = (a, b) => plain(run(c, 'mergeApprovals(' + JSON.stringify([a]) + ',' + JSON.stringify([b]) + ')'))[0];
  // A v1087 device approved at 100; a v1086 device cancelled its own sign-off on a stale copy at 150.
  const approved = AP({ status: 'approved', _stT: 100, _mut: 100, signoffs: [{ role: 'am', name: 'Yuki', _t: 90 }] });
  const staleV1086 = AP({ status: 'pending', _mut: 150, signoffs: [] });
  for (const [a, b] of [[approved, staleV1086], [staleV1086, approved]]) { const m = mg(a, b); assert.equal(m.status, 'approved'); assert.equal(m._mut, 151); }
  // Re-approved after an undo: a stale copy still carrying the old accounting check does not bring it back.
  const reapproved = AP({ status: 'approved', _stT: 1000, _mut: 1000, decidedAt: '2026-10-16T19:00:00Z' });
  const staleWithAcct = AP({ status: 'pending', _stT: 500, _mut: 800, acct: { by: 'Marcia', t: 700 } });
  for (const [a, b] of [[reapproved, staleWithAcct], [staleWithAcct, reapproved]]) assert.equal(mg(a, b).acct, undefined);
  const r = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia' });
  const m = mg(reapproved, { ...reapproved, acct: { by: 'Marcia', t: 700 } });   // even if a copy kept it
  assert.equal(plain(run(r, 'apAcctPending(' + JSON.stringify([{ ...m, acct: { by: 'Marcia', t: 700 } }]) + ')')).length, 1);
});

test('a cloud read that does not answer is given up after the time limit (the press still goes through)', { timeout: 5000 }, async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: { approvals: [AP({ type: 'シフト変更', ref: undefined })], notifications: [] }, cloud: {} });
  c.pullOpKey = () => new Promise(() => {});   // never answers
  run(c, 'AP_PULL_TIMEOUT_MS = 30');
  await run(c, 'signoffApproval("ap1")');
  assert.equal(c.S.approvals[0].signoffs.length, 1);
  assert.equal(run(c, '_apBusy["ap1"]'), undefined);
});

test('all sign-offs in but still pending (two devices at once): 確定する finishes it and notifies', async () => {
  const all = [{ role: 'office', name: 'Marcia', _t: 1 }, { role: 'gm', name: 'Moto', _t: 2 }, { role: 'am', name: 'Yuki', _t: 3 }];
  const st = { approvals: [AP({ type: '採用', ref: undefined, title: 'Crew A 採用書類', from: 'Crew A', signoffs: all })], notifications: [] };
  const c = app(MERGE.concat(APPROVAL), { role: 'am', user: 'Yuki', st });
  run(c, '_apTab="pending"');
  const h = run(c, 'renderApproval()');
  assert.match(h, /apFinalize\('ap1'\)/);
  const crew = app(MERGE.concat(APPROVAL), { role: 'sl', user: 'Leader B', st });
  run(crew, '_apTab="pending"');
  assert.doesNotMatch(run(crew, 'renderApproval()'), /apFinalize\(/);
  await run(c, 'apFinalize("ap1")');
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.ok(c.S.notifications.some(n => n.toUser === 'Crew A'));
  assert.ok(c.S.notifications.some(n => n.apTab === 'acct'));
  // Not all in: nothing changes.
  const d = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [AP({ type: '採用', ref: undefined, signoffs: all.slice(0, 2) })], notifications: [] } });
  await run(d, 'apFinalize("ap1")');
  assert.equal(d.S.approvals[0].status, 'pending');
  // Someone who neither approved it nor is GM/CEO cannot finalize it.
  const e = app(MERGE.concat(APPROVAL), { role: 'office_crew', user: 'Akane', st });
  await run(e, 'apFinalize("ap1")');
  assert.equal(e.S.approvals[0].status, 'pending');
  assert.match(e.alerts[0], /承認した人と GM・CEO/);
});

test('after waiting for the cloud, the approval page is redrawn only if it is still open', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: { approvals: [AP({ type: 'シフト変更', ref: undefined })], notifications: [] } });
  c.curPage = 'dashboard';
  await run(c, 'signoffApproval("ap1")');
  assert.equal(c.S.approvals[0].signoffs.length, 1);
  assert.deepEqual(c.rendered, []);
  c.curPage = 'approval';
  await run(c, 'cancelMySignoff("ap1")');
  assert.deepEqual(c.rendered, ['approval']);
});

test('monthly close: 在庫の締め opens inventory only for roles that can open it', () => {
  const mk = role => {
    const ctx = { curRole: role, done: {}, escapeHtml: s => String(s), progBar: () => '', ymLabelJP: y => y, getOfficeClose: () => ({}), navPageAllowed: p => role !== 'office_crew' };
    vm.createContext(ctx);
    vm.runInContext(objSrc('var OFFICE_CLOSE_ITEMS=[') + ';\nvar officeCloseMonth="2026-10";\n' + fnSrc('renderOfficeCloseCard'), ctx);
    return vm.runInContext('renderOfficeCloseCard()', ctx);
  };
  assert.match(mk('office'), /在庫の締め[\s\S]*?go\('inventory'\)/);
  assert.doesNotMatch(mk('office_crew'), /go\('inventory'\)/);
  assert.match(mk('office_crew'), /在庫の締め/);
  assert.match(mk('office_crew'), /go\('monthly'\)/);   // the other items keep their links
});

test('approval center: a press reads the cloud first and stops if another device already decided', async () => {
  const cloud = { approvals: [AP({ type: 'シフト変更', ref: undefined, status: 'approved', _stT: 500, _mut: 500, decidedBy: 'Moto' })] };
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: { approvals: [AP({ type: 'シフト変更', ref: undefined })], notifications: [] }, cloud });
  await run(c, 'signoffApproval("ap1")');
  assert.ok(c.pulls >= 1);
  assert.match(c.alerts[0], /ほかの端末でもう承認されています（Moto）/);
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.equal((c.S.approvals[0].signoffs || []).length, 0);
  // Another device's sign-off arrives with the read; this device adds its own and both are kept.
  const cloud2 = { approvals: [AP({ type: 'シフト変更', ref: undefined, signoffs: [{ role: 'am', name: 'Yuki', _t: 300 }], _mut: 300 })] };
  const d = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: { approvals: [AP({ type: 'シフト変更', ref: undefined })], notifications: [] }, cloud: cloud2 });
  await run(d, 'signoffApproval("ap1")');
  assert.deepEqual(plain(d.S.approvals[0].signoffs.map(s => s.role).sort()), ['am', 'office']);
});

test('approval center: cancelling one\'s own sign-off is not undone by another device\'s older copy', async () => {
  const signed = AP({ type: 'シフト変更', ref: undefined, signoffs: [{ role: 'office', name: 'Marcia', _t: 300 }], _mut: 300 });
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: { approvals: [signed], notifications: [] } });
  await run(c, 'cancelMySignoff("ap1")');
  assert.deepEqual(plain(c.S.approvals[0].signoffs), []);
  const merged = plain(run(c, 'mergeApprovals(' + JSON.stringify([signed]) + ', ls("approvals"))'))[0];
  assert.deepEqual(merged.signoffs, []);
  const merged2 = plain(run(c, 'mergeApprovals(ls("approvals"),' + JSON.stringify([signed]) + ')'))[0];
  assert.deepEqual(merged2.signoffs, []);
  // Signing again later counts, also after merging with the copy that has the removal.
  await new Promise(r => setTimeout(r, 5));
  await run(c, 'signoffApproval("ap1")');
  const again = plain(run(c, 'mergeApprovals(' + JSON.stringify([merged]) + ', ls("approvals"))'))[0];
  assert.deepEqual(again.signoffs.map(s => s.role), ['office']);
});

test('reimbursement decisions move the save time, so an older copy on another device does not bring back 申請中', () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: {
    approvals: [AP({ type: '建替経費', ref: 'rb1' })], reimbursements: [{ id: 'rb1', status: '申請中', storeId: 'F01', payer: 'Leader B', amount: 48.2, byUser: 'Leader B', _mut: 100 }], notifications: [] } });
  const stale = plain(c.S.reimbursements);
  run(c, '_applyReimburseDecision("rb1", true, "")');
  const m = plain(run(c, 'mergeInvoices(' + JSON.stringify(plain(c.S.reimbursements)) + ',' + JSON.stringify(stale) + ')'))[0];
  assert.equal(m.status, '承認');
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.ok(c.S.notifications.some(n => n.apTab === 'acct' && n.refId === 'ap1'));
});

test('approval center: an item already decided on its page is matched, not overwritten (no rejecting an approved mileage)', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: {
    approvals: [AP()], mileage_requests: [{ id: 'mi1', status: '承認', approvedBy: 'Yuki', storeId: 'F01', employee: 'Leader B' }], notifications: [] } });
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.equal(c.S.approvals[0].status, 'approved');
  assert.equal(c.S.approvals[0].decidedBy, 'Yuki');
  assert.equal(c.S.mileage_requests[0].status, '承認');
  assert.equal(c.S.notifications.length, 0);
  assert.match(c.toasts.at(-1)[0], /もう承認されています/);
});

test('skill hold: the approved state is never saved when the request cannot be applied', async () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ type: 'スキル', ref: 'nope', title: 'Crew A スキル申請 (Server)', from: 'Crew A', signoffs: [{ role: 'gm', name: 'Moto' }] })], skill_requests: [], notifications: [] } });
  await run(c, 'approveItem("ap1","approved",null,{fresh:true})');
  assert.equal(c.S.approvals[0].status, 'pending');
  assert.ok(!c.writes.some(([k, v]) => k === 'approvals' && /"status":"approved"/.test(v)));
  assert.ok(!c.S.notifications.some(n => /承認完了/.test(n.title)));
});

test('accounting tab: approved money items wait for 経理の確認; 確認した records who and when; office crew sees the same list', async () => {
  const items = [AP({ status: 'approved', decidedAt: '2026-10-16T18:40:00Z', decidedBy: 'Yuki', _stT: 500, _mut: 500 }),
    AP({ id: 'ap2', type: 'シフト変更', ref: undefined, status: 'approved', decidedAt: '2026-10-16T18:41:00Z', _stT: 501, _mut: 501 }),
    AP({ id: 'ap3', status: 'approved', _mut: 50 })];   // decided before v1087 (no decidedAt): not listed
  const c = app(MERGE.concat(APPROVAL), { role: 'office_crew', user: 'Akane', st: { approvals: items, notifications: [] } });
  run(c, '_apTab="acct"');
  const h = run(c, 'renderApproval()');
  assert.match(h, /経理の確認/);
  assert.match(h, /apAcctConfirm\('ap1'\)/);
  assert.doesNotMatch(h, /apAcctConfirm\('ap2'\)/);   // shift change: not an accounting type
  assert.doesNotMatch(h, /apAcctConfirm\('ap3'\)/);
  await run(c, 'apAcctConfirm("ap1")');
  assert.equal(c.S.approvals[0].acct.by, 'Akane');
  assert.equal(c.S.approvals[0].acct.at, '2026/10/16 09:10');
  run(c, '_apTab="acct"');
  assert.doesNotMatch(run(c, 'renderApproval()'), /apAcctConfirm\('ap1'\)/);
  run(c, '_apTab="history"');
  assert.match(run(c, 'renderApproval()'), /経理確認：Akane 2026\/10\/16 09:10/);
  // A store leader has no accounting tab; GM sees it without the button.
  const sl = app(MERGE.concat(APPROVAL), { role: 'sl', user: 'Leader B', st: { approvals: items } });
  run(sl, '_apTab="acct"');
  assert.doesNotMatch(run(sl, 'renderApproval()'), /経理の確認/);
  const gm = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: items } });
  run(gm, '_apTab="acct"');
  const g = run(gm, 'renderApproval()');
  assert.match(g, /経理の確認待ち/);
  assert.doesNotMatch(g, /apAcctConfirm\(/);
  await run(gm, 'apAcctConfirm("ap1")');
  assert.match(gm.alerts[0], /経理・事務Crew/);
});

test('accounting check pressed on a device whose clock is behind the approver\'s still counts', async () => {
  const future = Date.now() + 60000;
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', st: {
    approvals: [AP({ status: 'approved', decidedAt: new Date(future).toISOString(), _stT: future, _mut: future })], notifications: [] } });
  await run(c, 'apAcctConfirm("ap1")');
  assert.ok(c.S.approvals[0].acct.t > future);
  assert.equal(plain(run(c, 'apAcctPending(ls("approvals"))')).length, 0);
});

test('accounting check on a clock-behind device: confirm → undo → confirm again each win the merge with the copy before it (Codex P2 on 79d5675)', async () => {
  const future = Date.now() + 60000;
  const cloud = { approvals: [AP({ status: 'approved', decidedAt: new Date(future).toISOString(), _stT: future, _mut: future })] };
  const c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud, st: { approvals: plain(cloud.approvals), notifications: [] } });
  const on = list => run(c, '_apAcctOn(' + JSON.stringify(list[0]) + ')');
  const mg = (x, y) => plain(run(c, 'mergeApprovals(' + JSON.stringify(x) + ',' + JSON.stringify(y) + ')'));
  await run(c, 'apAcctConfirm("ap1")');
  const confirmed = plain(c.S.approvals); cloud.approvals = confirmed;   // sent
  await run(c, 'apAcctConfirm("ap1", true)');
  const undone = plain(c.S.approvals);
  assert.equal(on(undone), false);
  assert.ok(undone[0].acct.t > confirmed[0].acct.t);
  for (const m of [mg(confirmed, undone), mg(undone, confirmed)]) assert.equal(on(m), false, 'the undo is not brought back by the confirmed copy');
  cloud.approvals = undone;
  await run(c, 'apAcctConfirm("ap1")');
  const again = plain(c.S.approvals);
  for (const m of [mg(undone, again), mg(again, undone)]) assert.equal(on(m), true, 'confirming again is not lost to the undone copy');
});

test('a reopened request rejected on a device whose copy of the request is old is rejected, not turned back into the old approval (Codex P2 on 79d5675)', async () => {
  // Another device undid the approval: the item is a new generation (pending), the mileage request is 申請中 again (both in the cloud).
  // This device still has the mileage request as 承認 from before.
  const reopened = () => AP({ _gen: 1, _stT: 500, _mut: 500, signoffs: [] });   // a fresh copy each time (the merge can hand back the cloud's own object)
  const oldReq = { id: 'mi1', status: '承認', approvedBy: 'Yuki', storeId: 'F01', employee: 'Leader B', _stT: 300 };
  const cloudReq = { ...oldReq, status: '申請中', approvedBy: '', _stT: 500 };
  // The request is read again before following it: rejected as asked, and the request becomes 却下.
  let c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [reopened()], mileage_requests: [cloudReq] },
    st: { approvals: [AP({ status: 'approved', _stT: 300, _mut: 300 })], mileage_requests: [oldReq], notifications: [] } });
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.deepEqual([c.S.approvals[0].status, c.S.approvals[0]._gen, c.S.mileage_requests[0].status], ['rejected', 1, '却下']);
  // The request cannot be read (not in the cloud copy here): its decision is older than the undo, so it is not followed either.
  c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [reopened()] },
    st: { approvals: [reopened()], mileage_requests: [oldReq], notifications: [] } });
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.deepEqual([c.S.approvals[0].status, c.S.mileage_requests[0].status], ['rejected', '却下']);
  assert.ok(c.S.mileage_requests[0]._stT > 500);
  // Decided on the page after the undo: that is followed (the center matches the page; nothing is rewritten).
  c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [reopened()] },
    st: { approvals: [reopened()], mileage_requests: [{ ...oldReq, _stT: 600 }], notifications: [] } });
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.deepEqual([c.S.approvals[0].status, c.S.mileage_requests[0].status], ['approved', '承認']);
  assert.match(c.toasts.at(-1)[0], /もう承認されています/);
  // Never reopened: the page decided again on another device (承認 → 却下 there, newer). Reading the request again (its split row)
  // follows the newer page decision, not the old local one.
  c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [AP()], 'spl_mileage_requests_Leader B': [{ ...oldReq, status: '却下', _stT: 400 }] },
    st: { approvals: [AP()], mileage_requests: [oldReq], notifications: [] } });
  await run(c, 'approveItem("ap1","approved")');
  assert.ok(c.pulled.includes('spl_mileage_requests_Leader B'));
  assert.deepEqual([c.S.approvals[0].status, c.S.mileage_requests[0].status], ['rejected', '却下']);
  assert.match(c.toasts.at(-1)[0], /もう却下されています/);
  assert.doesNotMatch(c.toasts.at(-1)[0], /確かめられなかった/);
  // The request cannot be read from the cloud: the local copy is used, and that is said.
  c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [AP()] }, st: { approvals: [AP()], mileage_requests: [oldReq], notifications: [] } });
  c.pullOpKey = async key => (key === 'approvals');
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.deepEqual([c.S.approvals[0].status, c.toasts.at(-1)[1]], ['approved', 'warning']);
  assert.match(c.toasts.at(-1)[0], /確かめられなかったので、この端末の記録で合わせました/);
});

test('status times only move forward: a decision or an undo on a device whose clock is behind is still newer than the state it saw (independent review of 878db1c)', async () => {
  const future = Date.now() + 60000;
  // The undo was stamped by a clock 60 s fast; a correct clock rejects within that minute: the rejection is newer, and the merge keeps it.
  const undone = { id: 'mi1', status: '申請中', storeId: 'F01', employee: 'Leader B', _stT: future };
  const reopened = () => AP({ _gen: 1, _stT: future, _mut: future, signoffs: [] });
  let c = app(MERGE.concat(APPROVAL), { role: 'office', user: 'Marcia', cloud: { approvals: [reopened()] },
    st: { approvals: [reopened()], mileage_requests: [undone], notifications: [] } });
  await run(c, 'approveItem("ap1","rejected","x")');
  assert.ok(c.S.mileage_requests[0]._stT > future);
  const m = plain(run(c, 'mergeReqTomb(' + JSON.stringify([undone]) + ',' + JSON.stringify(plain(c.S.mileage_requests)) + ')'));
  assert.equal(m[0].status, '却下');
  // Undo in the approval center: the request and the item get the same time, later than both before (the decision was stamped fast).
  const decided = { id: 'mi1', status: '承認', approvedBy: 'Yuki', storeId: 'F01', employee: 'Leader B', _stT: future + 10 };
  c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [AP({ status: 'approved', _stT: future, _mut: future, decidedAt: 'x' })], mileage_requests: [decided], notifications: [] } });
  await run(c, 'reopenApproval("ap1")');
  const a1 = c.S.approvals[0], r1 = c.S.mileage_requests[0];
  assert.deepEqual([a1.status, a1._gen, r1.status], ['pending', 1, '申請中']);
  assert.equal(r1._stT, a1._stT);
  assert.ok(r1._stT > future + 10);
  // The old 承認 copy no longer counts as decided; a decision after the undo (even by a slow clock) does.
  assert.equal(run(c, '_apRecordState(' + JSON.stringify(a1) + ',0)').state, 'pending');
  c.S.mileage_requests = [decided];
  assert.equal(run(c, '_apRecordState(ls("approvals")[0])').state, 'pending');
  c.S.mileage_requests = [{ ...decided, _stT: a1._stT + 1 }];
  assert.equal(run(c, '_apRecordState(ls("approvals")[0])').state, 'approved');
  // Undo of an approved leave on its page: the same time on the leave and the item.
  const vac = { id: 'v1', status: '承認', employee: 'Leader B', storeId: 'F01', _stT: future };
  c = app(MERGE.concat(APPROVAL).concat(['cancelApprovedVacation', 'apReopenTime']), { role: 'gm', user: 'Moto',
    st: { approvals: [AP({ type: '休暇', ref: 'v1', status: 'approved', _stT: future + 5, _mut: future + 9 })], my_vacations: [vac], notifications: [] } });
  run(c, 'cancelApprovedVacation("v1")');
  assert.equal(c.S.my_vacations[0]._stT, c.S.approvals[0]._stT);
  assert.ok(c.S.my_vacations[0]._stT > future + 9);
  assert.equal(c.S.approvals[0]._mut, c.S.approvals[0]._stT);
});

test('office crew: pending notices where accounting is an approver, store-scoped notices, and the approval center shows 本部', () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [], notifications: [] } });
  run(c, 'addApproval({type:"採用", title:"Crew A 採用書類", from:"Crew A", store:"Store One"})');
  const n = c.S.notifications[0];
  assert.ok(n.toRoles.includes('office') && n.toRoles.includes('office_crew'));
  const d = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: { approvals: [], notifications: [] }, routing: { 休暇: ['am'] } });
  run(d, 'addApproval({type:"休暇", title:"x", from:"Crew A", store:"Store One"})');
  assert.ok(!d.S.notifications[0].toRoles.includes('office_crew'));   // accounting is not an approver of this type
  const crew = app(MERGE.concat(APPROVAL), { role: 'office_crew', user: 'Akane' });
  assert.equal(run(crew, 'notifForMe(' + JSON.stringify({ toStore: 'F01', toRoles: ['office', 'office_crew'], by: 'x' }) + ')'), true);
  assert.equal(run(crew, 'notifForMe(' + JSON.stringify({ toRoles: ['office', 'office_crew'], by: 'x' }) + ')'), true);
  assert.equal(run(crew, 'notifForMe(' + JSON.stringify({ toRoles: ['office'], by: 'x' }) + ')'), false);   // other notices to accounting: unchanged
});

test('undoing an approved leave on its page reopens the approval-center item (new generation) so it can be approved again', () => {
  const c = app(MERGE.concat(APPROVAL), { role: 'gm', user: 'Moto', st: {
    approvals: [AP({ type: '休暇', ref: 'v1', status: 'approved', _stT: 500, _mut: 500, signoffs: [{ role: 'am', name: 'Yuki' }], acct: { by: 'Marcia', t: 600 } })],
    my_vacations: [{ id: 'v1', status: '承認', storeId: 'F01', employee: 'Leader B' }] } });
  run(c, 'cancelApprovedVacation("v1")');
  const a = c.S.approvals[0];
  assert.equal(a.status, 'pending'); assert.equal(a._gen, 1); assert.deepEqual(plain(a.signoffs), []); assert.equal(a.acct, undefined);
  assert.equal(c.S.my_vacations[0].status, '申請中');
  assert.ok(c.S.my_vacations[0]._stT);
});

test('④ the 食材管理「発注」 tab is gone; old links go to 棚卸し; its data and sync rules stay', () => {
  assert.doesNotMatch(SRC, /^\s*\{id:'order',\s+label:'発注'/m);
  assert.doesNotMatch(SRC, /case 'order':/);
  assert.doesNotMatch(SRC, /function renderOrder\(/);
  assert.doesNotMatch(SRC, /go\('order'\)|renderPage\('order'\)|page:'order'/);
  assert.doesNotMatch(SRC, /'経理 発注'/);
  assert.match(SRC, /var NAV_RETIRED = \{[^}]*\border:'inventory'[^}]*\}/);
  assert.match(SRC, /supply_order:'inventory'/);
  assert.match(SRC, /\{id:'order',\s+label:'在庫の締め', page:'inventory'\}/);
  assert.match(SRC, /'orders_': \{ merge: mergeStampedList/);   // the records still merge per order
  assert.match(SRC, /'order_lists','order_templates'/);         // still synced
  // navResolvePage sends the old page to inventory, or home when inventory is not open to the role.
  const nav = { budgetTab: 'daily', workTab: 'today', allowed: { inventory: true } };
  vm.createContext(nav);
  vm.runInContext(varSrc('NAV_RETIRED') + '\n' + fnSrc('navResolvePage') + '\nfunction navPageAllowed(p){ return !!allowed[p]; }\nfunction navHomePage(){ return "home"; }', nav);
  assert.equal(vm.runInContext('navResolvePage("order")', nav), 'inventory');
  assert.equal(vm.runInContext('navResolvePage("supply_order")', nav), 'inventory');
  nav.allowed = {};
  assert.equal(vm.runInContext('navResolvePage("order")', nav), 'home');
});

test('release markers are 1087 or later and the page matches the service worker', () => {
  const app = Number((SRC.match(/const APP_VERSION = '(\d+)';/) || [])[1]), sw = Number((SW.match(/const SW_BUILD = '(\d+)';/) || [])[1]);
  assert.ok(app >= 1087, 'APP_VERSION ' + app);
  assert.equal(app, sw);
});
