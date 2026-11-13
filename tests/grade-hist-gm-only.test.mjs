// v1145（Moto さん 11/10「GM,CEOです」「GM・CEO だけにする」）：グレード履歴を書いてよいのは GM・CEO。
// グレードが変わる変更（G1 から上がる・下がるも）は役職とグレード履歴を一緒に保存するので、GM・CEO だけができる：
//   従業員マスターの役職・権限ロールの変更・昇格申請の承認・Leader 昇格。ほかの人には理由を出して、何も変えない（何も同期に送らない）。
//   グレードが変わらない役職の変更・却下は今までどおり。GM・CEO 以外が登録した新しい人には「入社の記録」を作らない（区間は同じ）。
// tests/career-criteria.test.mjs の UI案38 の仕組み（index.html の本物のコード・合成の人）で動かす。通信・ブラウザの保存・本番のデータなし。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const url = new URL('./career-criteria.test.mjs', import.meta.url).href;
const T = fs.readFileSync(new URL(url), 'utf8');
const head = T.split("\ntest('")[0];
const a38 = T.slice(T.indexOf('/* ------------------------------------------------------------------ UI案38 */'), T.indexOf('const lastModal'));
const cp = T.slice(T.indexOf('function storeBacked(c)'), T.indexOf("\ntest('Codex P1: employee master"));
const mod = await import('data:text/javascript;base64,' + Buffer.from((head + '\n' + a38 + '\n' + cp).replaceAll('import.meta.url', JSON.stringify(url))
  + '\nexport { app38, run, storeBacked, EMP_FORM, source };\n').toString('base64'));
const { app38, run, storeBacked, EMP_FORM, source } = mod;
const empOf = (c, id) => c.STORE.m_employees.find(x => x.id === id);
const fnSrc = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n}\n', i) + 2); };

function app(form, role) {
  const c = storeBacked(app38());
  vm.runInContext(`document.createDocumentFragment = function(){ return { appendChild:function(){} }; };
    function lssCatsForName(){ return lssCatsOrdered(); }
    ${fnSrc('cssScore')}
    ${fnSrc('cssUnOf')}
    ${fnSrc('lssPromoGmNote')}`, c);
  c.FORM = Object.assign({ 'modal-body': { firstChild: null, innerHTML: '', appendChild() {} } }, EMP_FORM, form || {});
  if (role) c.curRole = role;
  return c;
}
const BOB = { 'e-name': { value: 'Bob Sample' }, 'e-title': { value: 'Crew Leader' }, 'e-role': { value: 'crew' } };   // Crew（G1）→ Crew Leader（G2）
const NOT_GM = ['am', 'office', 'office_crew', 'chef', 'g4', 'sl'];
const STOP = /グレードが変わる変更（G1 → G2）は GM・CEO が行います/;

test('the stop message: only when the grade really changes and the signed-in role is not GM / CEO (G1-P counts as G1)', () => {
  const c = app();
  const msg = (role, a, b) => { c.curRole = role; return run(c, `ghChangeStopMsg(${JSON.stringify(a)}, ${JSON.stringify(b)})`); };
  for (const r of ['gm', 'ceo']) assert.equal(msg(r, 'G1', 'G2'), '', r);
  for (const r of NOT_GM) { assert.match(msg(r, 'G1', 'G2'), STOP, r); assert.match(msg(r, 'G4', 'G3'), /G4 → G3/, r + ' down too'); }
  assert.equal(msg('am', 'G3', 'G3'), '', 'no grade change');
  assert.equal(msg('am', 'G1-P', 'G1'), '', 'Prep G1 is G1');
  assert.equal(msg('am', '', 'G2'), '', 'unknown grade: as before (nothing to record)');
  c.curLang = 'en';
  assert.equal(msg('am', 'G1', 'G2'), 'Only the GM or CEO can make a change that moves the grade (G1 → G2)');
});

test('employee master: a title change that moves the grade (G1 → G2) is not saved for AM / Accounting / office crew / Head Chef / G4 / SL — no confirm screen, nothing sent', () => {
  for (const role of NOT_GM) {
    const c = app(BOB, role);
    const nModal = c.MODAL.length;
    run(c, `saveEmp('bob')`);
    assert.equal(empOf(c, 'bob').title, 'Crew', role + ': title unchanged');
    assert.equal(c.STORE.grade_hist, undefined, role + ': no grade history');
    assert.deepEqual([...c.PUSHES], [], role + ': nothing sent to sync');
    assert.equal(c.MODAL.length, nModal, role + ': no confirm screen');
    assert.match(c.TOASTS.at(-1), STOP, role);
    assert.match(c.TOASTS.at(-1), /保存していません。役職・権限ロールを元に戻すと、ほかの変更は保存できます/, role);
  }
});

test('employee master: a title change that keeps the grade still saves for the AM (Server Leader → Kitchen Leader, both G3); the GM still changes the grade with the date screen', () => {
  const c = app({ 'e-name': { value: 'Ken Sample' }, 'e-title': { value: 'Kitchen Leader' }, 'e-role': { value: 'sl' } }, 'am');
  run(c, `saveEmp('ken')`);
  assert.equal(empOf(c, 'ken').title, 'Kitchen Leader');
  assert.equal(c.STORE.grade_hist, undefined, 'no record (the grade did not change)');
  assert.ok(c.PUSHES.includes('m_employees'));
  const g = app(BOB, 'gm');
  run(g, `saveEmp('bob')`);
  assert.match(g.MODAL.at(-1), /グレードが変わります/, 'the GM gets the date screen as before');
  run(g, `ghConfirmSave()`);
  assert.equal(empOf(g, 'bob').title, 'Crew Leader');
  const r = run(g, `ghRecs('bob')`)[0];
  assert.deepEqual([r.g, r.from, r.src], ['G2', 'G1', 'title']);
  assert.ok(g.PUSHES.includes('grade_hist') && g.PUSHES.includes('m_employees'));
});

test('employee master: a GM confirmation left on the device is not used for another person\'s save (the AM is still stopped)', () => {
  const c = app(BOB, 'gm');
  run(c, `saveEmp('bob'); (function(){ var p=window._ghPend; p.ok=true; })();`);   // a GM screen that got as far as "ok"
  c.curRole = 'am';
  run(c, `saveEmp('bob')`);
  assert.equal(empOf(c, 'bob').title, 'Crew');
  assert.equal(c.STORE.grade_hist, undefined);
  assert.equal(run(c, `window._ghPend`), null, 'the left-over confirmation is dropped');
  assert.match(c.TOASTS.at(-1), STOP);
});

test('promotion approval: the AM / Head Chef / G4 cannot approve a request that moves the grade (nothing changes); rejecting still works; the GM approves', () => {
  for (const role of ['am', 'chef', 'g4']) {
    const c = app(null, role);
    c.STORE.lss_requests = [{ id: 'r2', name: 'Bob Sample', kind: 'promo', wantTitle: 'Crew Leader', status: '申請中' }];
    run(c, `approveLssRequest('r2','承認')`);
    assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'bob').title, c.STORE.grade_hist, [...c.PUSHES]], ['申請中', 'Crew', undefined, []], role);
    assert.match(c.TOASTS.at(-1), STOP, role); assert.match(c.TOASTS.at(-1), /変えていません。GM・CEO に承認してもらってください/, role);
    assert.match(run(c, `lssPromoGmNote(STORE.lss_requests[0])`), /グレードが変わるので GM・CEO が承認します/, role + ': the list says so');
    run(c, `approveLssRequest('r2','却下')`);
    assert.equal(c.STORE.lss_requests[0].status, '却下', role + ': rejecting is as before');
  }
  const g = app(null, 'gm');
  g.STORE.lss_requests = [{ id: 'r2', name: 'Bob Sample', kind: 'promo', wantTitle: 'Crew Leader', status: '申請中' }];
  assert.equal(run(g, `lssPromoGmNote(STORE.lss_requests[0])`), '', 'no note for the GM');
  run(g, `approveLssRequest('r2','承認')`);
  assert.equal(g.STORE.lss_requests[0].status, '承認'); assert.equal(empOf(g, 'bob').title, 'Crew Leader');
  assert.deepEqual(run(g, `ghRecs('bob')`).map(r => [r.g, r.from, r.src]), [['G2', 'G1', 'promo']]);
  // グレードが変わらない昇格（G3 → G3）は AM も今までどおり承認できる・一覧に一言も出ない
  const a = app(null, 'am');
  a.STORE.lss_requests = [{ id: 'r3', name: 'Ken Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
  assert.equal(run(a, `lssPromoGmNote(STORE.lss_requests[0])`), '');
  run(a, `approveLssRequest('r3','承認')`);
  assert.equal(a.STORE.lss_requests[0].status, '承認'); assert.equal(empOf(a, 'ken').title, 'Kitchen Leader'); assert.equal(a.STORE.grade_hist, undefined);
  assert.equal(run(a, `lssPromoGmNote({ kind:'tip', name:'Bob Sample' })`), '', 'not a promotion');
});

test('Leader promotion (stage 5 → 6): the AM cannot do it when the grade moves (G1 → G3, no evaluation needed before); the GM can', () => {
  const c = app(null, 'am');
  c.STORE.dev_pipe = { 'Bob Sample': { stage: 5, targetCareer: 'Server Leader', stageHistory: [] } };
  run(c, `approveAdvance('Bob Sample')`);
  assert.equal(run(c, `getDevData('Bob Sample').stage`), 5);
  assert.equal(empOf(c, 'bob').title, 'Crew'); assert.equal(c.STORE.grade_hist, undefined); assert.deepEqual([...c.PUSHES], []);
  assert.equal(c.CONFIRMS, 0, 'stopped before the confirm');
  assert.match(c.TOASTS.at(-1), /グレードが変わる変更（G1 → G3）は GM・CEO が行います/);
  const g = app(null, 'gm');
  g.STORE.dev_pipe = { 'Bob Sample': { stage: 5, targetCareer: 'Server Leader', stageHistory: [] } };
  run(g, `approveAdvance('Bob Sample')`);
  assert.equal(run(g, `getDevData('Bob Sample').stage`), 6); assert.equal(empOf(g, 'bob').title, 'Server Leader');
  assert.deepEqual(run(g, `ghRecs('bob')`).map(r => [r.g, r.from, r.src]), [['G3', 'G1', 'stage']]);
});

test('a new hire registered by someone other than GM / CEO gets no start record (same segments: hire date → current grade); the GM\'s registration still records it', () => {
  const NEW = { 'e-name': { value: 'Nia Sample' }, 'e-title': { value: 'Crew' }, 'e-role': { value: 'crew' }, 'e-hire': { value: '2026-08-01' } };
  const c = app(NEW, 'am');
  run(c, `saveEmp(null)`);
  const nia = c.STORE.m_employees.find(x => x.name === 'Nia Sample');
  assert.ok(nia, 'registered');
  assert.equal(c.STORE.grade_hist, undefined, 'no grade history written by the AM');
  assert.ok(!c.PUSHES.includes('grade_hist'));
  c.NIA = nia;
  const segAm = run(c, `ghSegments(NIA, '2026-07-01', '2026-09-30')`).map(s => [s.g, s.from, s.to, s.days, s.noHist]);
  assert.deepEqual(segAm, [['G1', '2026-08-01', '2026-09-30', 61, true]]);
  const g = app(NEW, 'gm');
  run(g, `saveEmp(null)`);
  const nia2 = g.STORE.m_employees.find(x => x.name === 'Nia Sample');
  const recs = run(g, `ghRecs(${JSON.stringify(nia2.id)})`);
  assert.deepEqual(recs.map(r => [r.d, r.g, r.start, r.src]), [['2026-08-01', 'G1', true, 'hire']]);
  g.NIA = nia2;
  const segGm = run(g, `ghSegments(NIA, '2026-07-01', '2026-09-30')`).map(s => [s.g, s.from, s.to, s.days]);
  assert.deepEqual(segGm, segAm.map(s => s.slice(0, 4)), 'the bonus segments are the same with or without the start record');
});

test('the code: the employee master, approval and Leader promotion paths all go through the GM/CEO check before anything is written', () => {
  const before = fnSrc('ghBeforeSaveEmp');
  assert.ok(before.indexOf('ghChangeStopMsg(g0, g1)') > 0 && before.indexOf('ghChangeStopMsg(g0, g1)') < before.indexOf('window._ghPend={'), 'employee master: before the date screen');
  const gate = fnSrc('ghGate');
  assert.ok(gate.indexOf('ghChangeStopMsg(g0, g1)') > 0 && gate.indexOf('ghChangeStopMsg(g0, g1)') < gate.indexOf('var p=window._ghPend;'), 'approval / Leader promotion: before anything else');
  assert.match(fnSrc('approveLssRequest'), /ghGate\('approve', id, _ge, r\.wantTitle\)\) return;[\s\S]*ghTxnBegin\(\)/);
  assert.match(fnSrc('approveAdvance'), /if \(stage===5 && ghGateStage\(name\)\) return;[\s\S]*ghTxnBegin\(\)/);
  assert.match(fnSrc('ghAfterSaveEmp'), /ghEvalCan\(\)\)\) ghAddRec\(e\.id, \{d:h, g:g, start:true, src:'hire'\}/);
  assert.match(fnSrc('ghEdSave'), /\['gm','ceo'\]\.indexOf\(curRole\)<0/); assert.match(fnSrc('ghImpRun'), /\['gm','ceo'\]\.indexOf\(curRole\)<0/);
});
