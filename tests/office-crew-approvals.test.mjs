// App v1060: 事務Crew (office_crew) may make the decisions accounting (office) makes outside Invoice intake
// (Moto 2026-10-10): approval center approve / reject, check review, reimbursement and mileage approval and payment,
// deleting checks and receipts/invoices. Up to v1059 these were view-only for 事務Crew (v846).
// What stays: what 事務Crew can see, the GM-only slots and actions (budget approval, override, undo), the direct
// superior slot for skill / Career Score requests, Drive-intake copies cannot be deleted.
// Runs the real functions from index.html in a VM with synthetic state. No network, no storage.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1059 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Source of one top-level function declaration, braces matched outside strings, template literals and comments.
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

const FNS = ['_actorName', '_apGradeChainTypes', '_apApplicantGrade', '_apUserInScope', '_apStoreHasAm', 'approvalRequiredRoles',
  '_approvalStore', '_approvalStoreId', '_approvalMyRoles', '_approvalSignedMap', '_approvalAllDone', '_approvalRoleLabel',
  'signoffApproval', 'overrideApproveAll', 'rejectApprovalItem', 'cancelMySignoff', 'approveItem', 'approveBudgetSeg', 'reopenApproval',
  'canReviewChecks', '_ckSeesAll', '_ckMine', 'canDeleteCheck', 'canApproveReimburse', 'canMarkReimbursePaid', 'markReimbursePaid',
  'canApproveMileage', 'canViewMileageRec', 'approveMileage', 'canMileageMonthEnd', 'mileageMonthEndClose', 'renderApproval', '_approvalChainHtml',
  'canViewWages', 'canViewIndividualWage', 'invIsIntake', 'invIsMine', 'canDeleteInvoice'];
// So the same checks can run on a build before v1060 (FUNERGY_INDEX): its view-only helpers, and the old name rule.
const OLD = { isViewOnlyRole: null, denyViewOnly: null, _actorName: 'function _actorName(){ return (ROLE_CONFIG[curRole]||{}).name || curUserName || curRole; }' };
const CODE = FNS.map(n => { try { return fnSrc(n); } catch (e) { if (n in OLD) return OLD[n]; throw e; } })
  .concat(Object.keys(OLD).filter(n => !FNS.includes(n)).map(n => { try { return fnSrc(n); } catch (_e) { return ''; } })).join('\n');

const ROLE_CONFIG = { ceo: { name: 'Tac' }, gm: { name: 'Moto' }, office: { name: 'Marcia' }, am: { name: 'Yuki' }, sl: { name: 'Store Leader' },
  office_crew: { name: '事務スタッフ', noWage: true }, crew: { name: 'スタッフ' }, chef: { name: 'Head Chef' } };
const EMPLOYEES = [
  { name: 'Crew A', store: 'F01', role: 'crew', grade: 1 },
  { name: 'Akane', store: 'OFFICE', role: 'office_crew', grade: 1 },
  { name: 'Leader B', store: 'F01', role: 'sl', grade: 3 },
];

function app({ role = 'office_crew', user = 'Akane', approvals = [], routing = {}, checks = [], reimb = [], mileage = [] } = {}) {
  const st = { approvals: JSON.parse(JSON.stringify(approvals)), checks, reimbursements: reimb, mileage };
  const c = {
    curRole: role, curUserName: user, curStore: 'ALL', curStoreLogin: false, curLang: 'ja', ROLE_CONFIG,
    STORES: [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }],
    alerts: [], toasts: [], rendered: [], notifs: [], modals: [], lsWrites: 0,
    t: (ja) => ja, ls: (k, d) => (k in st ? st[k] : d), lsSet: (k, v) => { st[k] = v; c.lsWrites++; return true; },
    alert: m => c.alerts.push(m), confirm: () => true, showToast: (m, k) => c.toasts.push([m, k]), renderPage: p => c.rendered.push(p),
    addNotif: n => c.notifs.push(n), nowJP: () => '2026-10-10 15:00', openModal: h => c.modals.push(h),
    openInputModal: (o, cb) => cb('理由'), escapeHtml: s => String(s == null ? '' : s),
    getEmployees: () => EMPLOYEES, empGradeNum: e => e.grade || 1, myGradeNum: () => (EMPLOYEES.find(e => e.name === c.curUserName) || { grade: 6 }).grade,
    getStoresAll: () => [{ id: 'F01', am: 'Yuki' }, { id: 'F02' }], myAmStores: () => ['F01'], mySupportStores: () => [], vacManagerGrade: () => 0, isStoreManager: () => false,
    approversForType: type => (routing[type] && routing[type].length ? routing[type] : ['office', 'gm', 'am']),
    getBudgets: () => { throw new Error('budget touched'); }, getReimbursements: () => st.reimbursements,
    setReimbursements: v => { st.reimbursements = v; }, saveReimbursements: v => { st.reimbursements = v; },
    getMileageRequests: () => st.mileage, saveMileageReqs: v => { st.mileage = v; }, curYm: () => '2026-10',
    getVisibleStores: () => c.STORES, salaryVisibleToMe: () => true,
    st,
  };
  vm.createContext(c);
  vm.runInContext(CODE, c);
  return c;
}
const run = (c, expr) => vm.runInContext(expr, c);
const plain = v => JSON.parse(JSON.stringify(v));   // values from the VM realm, compared by content
const AP = (over = {}) => ({ id: 'ap1', type: 'シフト変更', title: 'Crew A シフト変更', from: 'Crew A', store: 'Store One', status: 'pending', ...over });

test('approval center: 事務Crew fills the 本部 (office) slot like accounting, records their own name, and can reject', async () => {
  for (const [role, user, name] of [['office', 'Marcia', 'Marcia'], ['office_crew', 'Akane', 'Akane']]) {
    const c = app({ role, user, approvals: [AP()] });
    assert.deepEqual([...run(c, '_approvalMyRoles(ls("approvals")[0])')], ['office'], role);
    run(c, 'signoffApproval("ap1")');
    const a = c.st.approvals[0];
    assert.deepEqual(plain(a.signoffs.map(s => [s.role, s.name])), [['office', name]], role);
    assert.equal(a.status, 'pending', role);
    assert.match(c.toasts.at(-1)[0], /承認しました（残り：GM・AM\/店長）/, role);
    assert.equal(c.alerts.length, 0, role);
    // The undo-my-sign-off finds their own sign-off by the same name.
    run(c, 'cancelMySignoff("ap1")');
    assert.deepEqual(plain(c.st.approvals[0].signoffs), [], role);
  }
  // Reject goes through approveItem; 事務Crew is no longer stopped there.
  const c = app({ approvals: [AP()] });
  run(c, 'rejectApprovalItem("ap1")');
  await new Promise(r => setImmediate(r));
  assert.equal(c.st.approvals[0].status, 'rejected');
  assert.equal(c.st.approvals[0].rejectReason, '理由');
  assert.ok(!c.toasts.some(([m]) => /閲覧のみ/.test(m)));
});

test('approval center: what stays as before for 事務Crew', () => {
  const crew = app();
  // Skill / Career Score: the direct superior (grade above the applicant) and GM. A G1 事務Crew fills neither.
  assert.deepEqual([...run(crew, '_approvalMyRoles(' + JSON.stringify(AP({ type: 'スキル' })) + ')')], []);
  assert.deepEqual([...run(crew, '_approvalMyRoles(' + JSON.stringify(AP({ type: 'Leadership' })) + ')')], []);
  // A request type routed to GM only.
  assert.deepEqual([...run(app({ routing: { 退職: ['gm'] } }), '_approvalMyRoles(' + JSON.stringify(AP({ type: '退職' })) + ')')], []);
  // Not one's own request; not a slot someone already signed.
  assert.deepEqual([...run(crew, '_approvalMyRoles(' + JSON.stringify(AP({ from: 'Akane' })) + ')')], []);
  assert.deepEqual([...run(crew, '_approvalMyRoles(' + JSON.stringify(AP({ signoffs: [{ role: 'office', name: 'Marcia' }] })) + ')')], []);
  // GM/CEO-only actions.
  const c = app({ approvals: [AP()] });
  run(c, 'overrideApproveAll("ap1")');
  run(c, 'reopenApproval("ap1")');
  run(c, 'approveBudgetSeg("F01","2026-10")');
  assert.equal(c.alerts.length, 3);
  assert.equal(c.st.approvals[0].status, 'pending');
  assert.equal(c.st.approvals[0].signoffs, undefined);
  // Other roles: the office slot is still accounting's only.
  for (const role of ['crew', 'sl', 'chef']) assert.deepEqual([...run(app({ role, user: 'Leader B' }), '_approvalMyRoles(' + JSON.stringify(AP()) + ')')], [], role);
});

test('checks: 事務Crew reviews, returns and deletes like accounting; others unchanged', () => {
  const mine = { id: 'c1', byUser: 'Leader B', reviewStatus: '未確認' }, done = { id: 'c2', byUser: 'Leader B', reviewStatus: '確認済み' };
  const exp = { ceo: [true, true, true], gm: [true, true, true], office: [true, true, true], office_crew: [true, true, true],
    am: [false, false, false], sl: [false, true, false], crew: [false, false, false] };
  for (const [role, want] of Object.entries(exp)) {
    const c = app({ role, user: role === 'sl' ? 'Leader B' : 'Someone' });
    assert.deepEqual([run(c, 'canReviewChecks()'), run(c, 'canDeleteCheck(' + JSON.stringify(mine) + ')'), run(c, 'canDeleteCheck(' + JSON.stringify(done) + ')')], want, role);
  }
  assert.equal(run(app(), 'canDeleteCheck(null)'), false);
});

test('reimbursements and mileage: 事務Crew approves and marks paid like accounting; others unchanged', () => {
  const r = { storeId: 'F01' }, r2 = { storeId: 'F02' };
  const exp = { ceo: [true, true, true, true], gm: [true, true, true, true], office: [true, true, true, true], office_crew: [true, true, true, true],
    am: [true, false, false, true], sl: [false, false, false, false], crew: [false, false, false, false] };
  for (const [role, want] of Object.entries(exp)) {
    const c = app({ role, user: 'Someone' });
    assert.deepEqual([run(c, 'canApproveReimburse(' + JSON.stringify(r) + ')'), run(c, 'canApproveReimburse(' + JSON.stringify(r2) + ')'),
      run(c, 'canMarkReimbursePaid()'), run(c, 'canApproveMileage(' + JSON.stringify(r) + ')')], want, role);
  }
  // The handlers let 事務Crew through and record the person, not the role's default name.
  const c = app({ reimb: [{ id: 'rb1', status: '承認', storeId: 'F01', payer: 'Leader B', amount: 12.5 }], mileage: [{ id: 'mi1', status: '申請中', storeId: 'F01', employee: 'Leader B', amount: 3 }] });
  run(c, 'markReimbursePaid("rb1")');
  assert.equal(c.alerts.length, 0);
  assert.equal(c.st.reimbursements[0].payStatus, '支払済');
  assert.equal(c.st.reimbursements[0].paidBy, 'Akane');
  run(c, 'approveMileage("mi1")');
  assert.equal(c.st.mileage[0].status, '承認');
  assert.equal(c.st.mileage[0].approvedBy, 'Akane');
  // Mileage is settled by the month-end close (精算確定); 事務Crew runs it like accounting.
  c.st.mileage[0].date = '2026-10-03';
  run(c, 'mileageMonthEndClose("2026-10")');
  assert.equal(c.st.mileage[0].archived, true);
  assert.equal(c.st.mileage[0].archivedBy, 'Akane');
  for (const [role, want] of [['office', true], ['office_crew', true], ['gm', true], ['ceo', true], ['am', false], ['sl', false], ['crew', false]]) {
    assert.equal(run(app({ role }), 'canMileageMonthEnd()'), want, role);
  }
  // Accounting is recorded as before (the role's name).
  const o = app({ role: 'office', user: 'Marcia M', reimb: [{ id: 'rb1', status: '承認', storeId: 'F01', payer: 'P', amount: 1 }] });
  run(o, 'markReimbursePaid("rb1")');
  assert.equal(o.st.reimbursements[0].paidBy, 'Marcia');
  const other = app({ role: 'crew', reimb: [] });
  run(other, 'markReimbursePaid("rb1")');
  assert.match(other.alerts[0], /支払い処理は経理・事務Crew・GM・CEOのみ/);
});

test('receipts / invoices: 事務Crew deletes like accounting; Drive-intake copies stay undeletable for everyone', () => {
  const inv = { id: 'i1', byUser: 'Leader B', reviewStatus: '未確認' }, intake = { id: 'i2', src: 'drive-intake', byUser: 'Leader B' };
  for (const role of ['ceo', 'gm', 'office', 'office_crew']) {
    const c = app({ role, user: 'Someone' });
    assert.equal(run(c, 'canDeleteInvoice(' + JSON.stringify(inv) + ')'), true, role);
    assert.equal(run(c, 'canDeleteInvoice(' + JSON.stringify(intake) + ')'), false, role);
  }
  assert.equal(run(app({ role: 'crew', user: 'Someone' }), 'canDeleteInvoice(' + JSON.stringify(inv) + ')'), false);
  assert.equal(run(app({ role: 'sl', user: 'Leader B' }), 'canDeleteInvoice(' + JSON.stringify(inv) + ')'), true);
  assert.equal(run(app({ role: 'sl', user: 'Leader B' }), 'canDeleteInvoice(' + JSON.stringify({ ...inv, reviewStatus: '確認済み' }) + ')'), false);
});

test('what 事務Crew sees does not widen: no 本部 (office) requests in the approval center, no wages', () => {
  const items = [AP({ id: 'ap1', title: 'STORE-REQUEST' }), AP({ id: 'ap2', title: 'HQ-REQUEST', store: '---', from: 'Leader B' })];
  const crew = run(app({ approvals: items }), 'renderApproval()');
  assert.match(crew, /STORE-REQUEST/);
  assert.doesNotMatch(crew, /HQ-REQUEST/);
  const office = run(app({ role: 'office', user: 'Marcia', approvals: items }), 'renderApproval()');
  assert.match(office, /HQ-REQUEST/);
  // The 事務Crew sees the approve button for the store request (本部 slot) and the reject button.
  assert.match(crew, /signoffApproval\('ap1'\)/);
  assert.match(crew, /rejectApprovalItem\('ap1'\)/);
  const w = app();
  assert.equal(run(w, 'canViewWages()'), false);
  assert.equal(run(w, 'canViewIndividualWage()'), false);
});

test('no view-only gate is left for 事務Crew', () => {
  assert.doesNotMatch(SRC, /\bisViewOnlyRole\b|\bdenyViewOnly\b/);
  assert.doesNotMatch(SRC, /事務Crewは閲覧のみです/);
});
