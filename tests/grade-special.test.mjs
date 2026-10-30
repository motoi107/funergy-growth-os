// v1115 (Moto 10/29 "評価なしでの特例グレード変更"): when a grade change needs the evaluation of the previous grade (UI案38:
// changes from G2 or above), GM/CEO can choose "特例でグレードを変更する（キャリアスコア評価なし）" instead of the normal change.
// Only the Career Score condition is skipped: the reason is required, the change is reviewed before saving, the grade history
// records it as a special change (reason, who, when, no evaluation), the title and the grade history are still saved together,
// and the Career Score itself (scores, unscored items) is never touched. The normal change keeps the evaluation condition.
// Runs the real code from index.html with the UI案38 harness of tests/career-criteria.test.mjs (synthetic staff and scores).
// No network, no browser storage, no production data.
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
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const lastModal = c => c.MODAL[c.MODAL.length - 1] || '';
const empOf = (c, id) => c.STORE.m_employees.find(x => x.id === id);
const fnSrc = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n}\n', i) + 2); };

// the harness plus: the modal body that the employee form is kept in, the unscored count (v1114), a real-looking form
function app(form) {
  const c = storeBacked(app38());
  const ghVars = source.split('\n').filter(l => /^var GH_(SRC|GRADES) = /.test(l)).join('\n');
  vm.runInContext(`${ghVars}
    document.createDocumentFragment = function(){ return { appendChild:function(){} }; };
    function lssCatsForName(){ return lssCatsOrdered(); }
    ${fnSrc('cssScore')}
    ${fnSrc('cssUnOf')}`, c);
  c.FORM = Object.assign({ 'modal-body': { firstChild: null, innerHTML: '', appendChild() {} } }, EMP_FORM, form || {});
  return c;
}
const NEO = { 'e-name': { value: 'Neo Sample' }, 'e-title': { value: 'Store Manager' } };   // Kitchen Leader (G3, no Career Score) → Store Manager (G4)
const REASON = '店舗の立ち上げで役割が変わったため（評価は次の四半期）';

test('the choice: only when the evaluation would be needed; "normal" is the default and still needs the evaluation', () => {
  const c = app();
  run(c, `ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' })`);   // Server Leader G3 → Store Manager G4
  const m = lastModal(c);
  assert.match(m, /role="radiogroup" aria-label="グレードの変え方"/);
  assert.match(m, /<input type="radio" name="gh-mode" value="normal" checked[^>]*>[\s\S]*?<b[^>]*>通常のグレード変更<\/b>/);
  assert.match(m, /<input type="radio" name="gh-mode" value="special" onchange="ghSetChangeMode\(this\.value\)"[^>]*>[\s\S]*?<b[^>]*>特例でグレードを変更する（キャリアスコア評価なし）<\/b>/);
  assert.match(m, /G3 の期間の評価を確定（日割り）/, 'the normal evaluation block is shown');
  assert.match(m, /disabled[^>]*><i class="ti ti-lock"><\/i> G3 の期間の評価を確定してから保存/);
  run(c, `ghConfirmSave()`);
  assert.equal(run(c, `window._ghPend.ok`), false, 'normal: no save without the evaluation (as before)');
  // a change from G1 needs no evaluation → no choice at all
  run(c, `ghConfirmCancel(); ghBeforeSaveEmp('bob', { name:'Bob Sample', title:'Crew Leader', role:'crew' })`);
  assert.doesNotMatch(lastModal(c), /グレードの変え方|特例/);
  run(c, `ghSetChangeMode('special')`);
  assert.equal(run(c, `window._ghPend.mode`), 'normal', 'no evaluation needed → nothing to skip');
  // AM: the special option is shown but disabled, and cannot be chosen
  run(c, `ghConfirmCancel()`); c.curRole = 'am';
  run(c, `ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' })`);
  assert.match(lastModal(c), /value="special" disabled[\s\S]*?特例は GM・CEO だけが使えます/);
  run(c, `ghSetChangeMode('special')`);
  assert.equal(run(c, `window._ghPend.mode`), 'normal');
  assert.doesNotMatch(lastModal(c), /id="gh-sp-reason"/);
  // the radio rows are 44px targets
  for (const x of lastModal(c).matchAll(/<label style="display:flex;gap:10px;align-items:flex-start;min-height:(\d+)px/g)) assert.ok(+x[1] >= 44);
});

test('special with no Career Score at all: the reason is required (not empty, not spaces), the review shows who / grades / dates / reason, then title and history are saved together', () => {
  const c = app(NEO);
  run(c, `saveEmp('neo')`);
  assert.match(lastModal(c), /まだ評価がありません/);
  assert.match(lastModal(c), /評価をせずに変えるときは、上の「特例でグレードを変更する」を選べます/);
  run(c, `ghSetChangeMode('special')`);
  let m = lastModal(c);
  assert.match(m, /キャリアスコアの評価を伴わずにグレードを変更します。変更理由と操作履歴が記録されます。/);
  assert.match(m, /対象従業員<\/td><td[^>]*><b>Neo Sample<\/b><div[^>]*>Kitchen Leader → Store Manager<\/div>/);
  assert.match(m, /現在のグレード<\/td><td[^>]*><span[^>]*>G3<\/span>/);
  assert.match(m, /変更後のグレード<\/td><td[^>]*><span[^>]*>G4<\/span>/);
  assert.match(m, /適用日<\/td><td[^>]*><span id="gh-sp-apply"><b>2026\/8\/21<\/b> から（確定日 2026\/8\/20 の翌日）<\/span>/);
  assert.match(m, /職種（G3 の期間）<\/td><td[^>]*><b>G3 [^<]+<\/b><div[^>]*>役職名 Kitchen Leader から<\/div>/);
  // the apply date follows the date field
  c.FORM['gh-sp-apply'] = { innerHTML: '' };
  run(c, `ghConfirmDate('2026-08-18')`);
  assert.match(c.FORM['gh-sp-apply'].innerHTML, /<b>2026\/8\/19<\/b> から（確定日 2026\/8\/18 の翌日）/);
  run(c, `ghConfirmDate('2026-08-20')`);
  assert.match(m, /Career Score<\/td><td[^>]*>まだ評価がありません（未評価のまま残ります）/);
  assert.doesNotMatch(m, /G3 の期間の評価を確定（日割り）/, 'no evaluation block in the special change');
  assert.match(m, /<label class="form-label" for="gh-sp-reason">特例変更の理由（必須）<\/label><textarea[^>]*id="gh-sp-reason"/);
  assert.match(m, /<button id="gh-cf-go"[^>]*disabled[^>]*>.*特例変更の理由を入れてください<\/button>/);
  // empty and spaces-only reasons are refused (screen and save path)
  run(c, `ghConfirmSave()`);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader'); assert.equal(c.STORE.grade_hist, undefined);
  run(c, `ghSpecialReason('   　  ')`);
  const nt = c.TOASTS.length;
  run(c, `ghConfirmSave()`);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader');
  assert.equal(c.TOASTS.length, nt + 1);
  assert.match(c.TOASTS.at(-1), /特例変更の理由を入れてください/);
  run(c, `ghSpecialReview()`);
  assert.doesNotMatch(lastModal(c), /（確認）/, 'spaces only: no review either');
  run(c, `ghSpecialReason('\u200b\u2060\ufeff')`);
  run(c, `ghSpecialReview()`);
  assert.doesNotMatch(lastModal(c), /（確認）/, 'invisible characters only: no review either');
  assert.equal(run(c, `window._ghPend.reviewed`), false);
  // with a reason: the button goes to the review (not straight to the save)
  run(c, `ghSpecialReason(${JSON.stringify(REASON)})`);
  run(c, `ghConfirmSave()`);
  m = lastModal(c);
  assert.match(m, /特例でグレードを変更します（確認）/);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader', 'nothing saved before the review is confirmed');
  assert.match(m, /対象従業員<\/td><td><b>Neo Sample<\/b>/);
  assert.match(m, /役職<\/td><td>Kitchen Leader → <b>Store Manager<\/b>/);
  assert.match(m, /グレード<\/td><td><span[^>]*>G3<\/span> <i class="ti ti-arrow-right"[^>]*><\/i> <span[^>]*>G4<\/span>/);
  assert.match(m, /確定日・適用日<\/td><td>2026\/8\/20（新しいグレードは 2026\/8\/21 から）/);
  assert.match(m, /変更種別<\/td><td><b>特例変更<\/b>（Career Score の評価なし）/);
  assert.ok(m.includes('理由</td><td><div style="white-space:pre-wrap;font-weight:700">' + REASON + '</div>'));
  assert.match(m, /操作者<\/td><td>GM/);
  assert.match(m, /onclick="ghSpecialBack\(\)">戻る<\/button><button id="gh-cf-go" class="btn btn-primary" onclick="ghConfirmGo\(\)">.*特例で変更して保存<\/button>/);
  // anything changed after the review needs the review again (the save button does not skip it)
  run(c, `ghSpecialReason(${JSON.stringify(REASON + '。')})`);
  run(c, `ghConfirmSave()`);
  assert.match(lastModal(c), /（確認）/); assert.equal(empOf(c, 'neo').title, 'Kitchen Leader');
  run(c, `ghSetChangeMode('special')`);
  run(c, `ghConfirmGo()`);
  assert.match(lastModal(c), /（確認）/); assert.equal(empOf(c, 'neo').title, 'Kitchen Leader');
  run(c, `ghSpecialReason(${JSON.stringify(REASON)})`);
  // back keeps what was entered
  run(c, `ghSpecialBack()`);
  assert.ok(lastModal(c).includes('>' + REASON + '</textarea>'));
  run(c, `ghSpecialReview()`);
  c.PUSHES.length = 0;
  run(c, `ghConfirmGo()`);
  assert.equal(empOf(c, 'neo').title, 'Store Manager');
  const r = c.STORE.grade_hist.neo.recs[0];
  assert.deepEqual([r.d, r.g, r.from, r.src, r.mode, r.reason, r.by, r.at, r.spBy, r.spAt, r.track, r.prevEval], ['2026-08-20', 'G4', 'G3', 'title', 'special', REASON, 'GM', '2026/08/20 09:00', 'GM', '2026/08/20 09:00', 'kt', undefined]);
  assert.ok(c.PUSHES.includes('m_employees') && c.PUSHES.includes('grade_hist'));
  assert.equal(Object.keys(c.STORE).filter(k => /^lss_emp_/.test(k)).length, 0, 'no Career Score is made up');
  assert.equal(run(c, `window._ghPend`), null);
});

test('special while the evaluation is in progress: the scores and their unscored items stay exactly as they were; a confirmed evaluation is not used', () => {
  const c = app();
  const sc = {}; run(c, 'lssCatsOrdered()').forEach(k => k.items.forEach((_, i) => { if (i % 3) sc[k.key + i] = 2; }));   // a third of the items unscored
  c.STORE['lss_emp_Ken Sample'] = { evaluator: 'SM', date: '2026/08/01', scores: sc, status: '確定' };
  const before = JSON.stringify(c.STORE['lss_emp_Ken Sample']);
  run(c, `saveEmp('ken'); ghEvalConfirm();`);   // the GM had already confirmed the evaluation in the normal way …
  assert.ok(run(c, `window._ghPend.ev`));
  run(c, `ghSetChangeMode('special')`);
  assert.match(lastModal(c), /Career Score<\/td><td[^>]*>評価途中（採点していない項目 \d+）・今の点 /);
  run(c, `ghSpecialReason('役割の変更（評価は途中）'); ghSpecialReview(); ghConfirmGo();`);
  assert.equal(empOf(c, 'ken').title, 'Store Manager');
  const r = c.STORE.grade_hist.ken.recs[0];
  assert.deepEqual([r.mode, r.reason, r.prevEval], ['special', '役割の変更（評価は途中）', undefined], '… but a special change keeps no evaluation');
  assert.equal(JSON.stringify(c.STORE['lss_emp_Ken Sample']), before, 'the in-progress Career Score is untouched');
  // switching back to normal uses the confirmed evaluation again (the normal record keeps it, no special mark)
  const d = app();
  run(d, `saveEmp('ken'); ghEvalConfirm(); ghSetChangeMode('special'); ghSetChangeMode('normal'); ghConfirmSave();`);
  const r2 = d.STORE.grade_hist.ken.recs[0];
  assert.deepEqual([r2.mode, r2.reason, r2.prevEval.csPct], [undefined, undefined, 72]);
});

test('permission: GM/CEO only, and checked again on the save path (not only on the screen)', () => {
  const c = app();
  run(c, `saveEmp('ken')`);
  run(c, `(function(){ var p=window._ghPend; p.mode='special'; p.reason='x'; p.d='2026-08-20'; p.period=ghEvalPeriod(p); p.ok=true; p.reviewed=true; })()`);   // a screen that skipped the checks
  c.curRole = 'am';
  run(c, `saveEmp('ken')`);
  assert.equal(empOf(c, 'ken').title, 'Server Leader');
  assert.equal(c.STORE.grade_hist, undefined);
  assert.match(c.TOASTS.at(-1), /特例でのグレード変更は GM・CEO だけができます（保存していません）/);
  // the same on promotion approval
  const d = app();
  d.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
  run(d, `approveLssRequest('r1','承認'); (function(){ var p=window._ghPend; p.mode='special'; p.reason=''; p.ok=true; p.reviewed=true; })();`);
  run(d, `approveLssRequest('r1','承認')`);
  assert.deepEqual([d.STORE.lss_requests[0].status, empOf(d, 'amy').title], ['申請中', 'Crew Leader']);
  assert.match(d.TOASTS.at(-1), /特例変更の理由を入れてください（変えていません）/);
  // CEO can
  const e = app(NEO); e.curRole = 'ceo';
  run(e, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('CEO の判断'); ghSpecialReview(); ghConfirmGo();`);
  assert.equal(empOf(e, 'neo').title, 'Store Manager');
});

test('the reason is also read from the text box; a change that needs no evaluation never gets the special mark', () => {
  const c = app(NEO);
  run(c, `saveEmp('neo'); ghSetChangeMode('special');`);
  c.FORM['gh-sp-reason'] = { value: '貼り付けた理由' };
  run(c, `ghSpecialReview()`);
  assert.match(lastModal(c), /（確認）/);
  assert.ok(lastModal(c).includes('>貼り付けた理由</div>'));
  run(c, `ghConfirmGo()`);
  assert.equal(c.STORE.grade_hist.neo.recs[0].reason, '貼り付けた理由');
  // G1 → G2 (no Career Score condition): even a forged special mark is not recorded
  const d = app({ 'e-name': { value: 'Bob Sample' }, 'e-title': { value: 'Crew Leader' }, 'e-role': { value: 'crew' } });
  run(d, `saveEmp('bob'); window._ghPend.mode='special'; window._ghPend.reason='x'; ghConfirmSave();`);
  assert.equal(empOf(d, 'bob').title, 'Crew Leader');
  const r = d.STORE.grade_hist.bob.recs[0];
  assert.deepEqual([r.from, r.g, r.mode, r.reason], ['G1', 'G2', undefined, undefined]);
});

test('the date checks against the grade history still apply to the special change', () => {
  const c = app(NEO);
  c.STORE.grade_hist = { neo: { recs: [{ id: 'h1', d: '2026-08-25', g: 'G3', from: 'G2', start: false, src: 'manual' }], _at: 1 } };
  run(c, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('理由');`);
  run(c, `window._ghPend.d='2026-08-20'; ghSpecialReview();`);
  assert.match(c.TOASTS.at(-1), /グレード履歴の最後の記録（2026\/8\/25 G3）より後の日にしてください/);
  assert.doesNotMatch(lastModal(c), /（確認）/);
  run(c, `ghConfirmGo()`);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader');
});

test('promotion approval and Leader promotion can use the special change; still all-or-nothing', () => {
  for (const fail of ['grade_hist', 'lss_requests', null]) {
    const c = app();
    c.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
    run(c, `approveLssRequest('r1','承認'); ghSetChangeMode('special'); ghSpecialReason('承認の特例'); ghConfirmGo();`);
    assert.equal(c.STORE.lss_requests[0].status, '申請中', 'approval: the review comes first');
    assert.match(lastModal(c), /特例でグレードを変更します（確認）/);
    assert.match(lastModal(c), /特例で承認してグレード履歴に記録/);
    c.PUSHES.length = 0; if (fail) c.FAIL_SET = fail;
    run(c, `ghConfirmGo()`); delete c.FAIL_SET;
    if (fail) assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, c.STORE.grade_hist, [...c.PUSHES]], ['申請中', 'Crew Leader', undefined, []], fail);
    else {
      const r = c.STORE.grade_hist.amy.recs[0];
      assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, r.src, r.mode, r.reason, r.prevEval], ['承認', 'Kitchen Leader', 'promo', 'special', '承認の特例', undefined]);
    }
  }
  const c = app();
  c.STORE.dev_data = { 'Cal Sample': { stage: 5, targetCareer: 'Operation Leader', stageHistory: [] } };
  run(c, `approveAdvance('Cal Sample'); ghSetChangeMode('special'); ghSpecialReason('Leader 昇格の特例'); ghSpecialReview();`);
  assert.match(lastModal(c), /特例で昇格してグレード履歴に記録/);
  run(c, `ghConfirmGo()`);
  const r = c.STORE.grade_hist.cal.recs[0];
  assert.deepEqual([c.STORE.dev_data['Cal Sample'].stage, empOf(c, 'cal').title, r.src, r.mode, r.reason], [6, 'Operation Leader', 'stage', 'special', 'Leader 昇格の特例']);
});

test('specialist career (Head Chef → Corporate Chef, 調理) and the normal career: title, grade history and the specialist field stay consistent', () => {
  const c = app({ 'e-name': { value: 'Hana Sample' }, 'e-title': { value: 'Corporate Chef' }, 'e-role': { value: 'chef' } });
  c.EMPS.push({ id: 'hc', name: 'Hana Sample', title: 'Head Chef', role: 'chef' });
  c.STORE.m_employees = JSON.parse(JSON.stringify(c.EMPS));
  run(c, `saveEmp('hc')`);
  assert.match(lastModal(c), /value="special"/);
  assert.match(lastModal(c), /G4 の期間の評価を確定/);
  run(c, `ghSetChangeMode('special'); ghSpecialReason('料理長の交代'); ghSpecialReview();`);
  assert.match(lastModal(c), /<span[^>]*>G4<\/span> <i class="ti ti-arrow-right"[^>]*><\/i> <span[^>]*>G5<\/span>/);
  run(c, `ghConfirmGo()`);
  const e = empOf(c, 'hc');
  assert.deepEqual([e.title, run(c, `empGrade(${JSON.stringify(e)})`), run(c, `empSpecialistDept(${JSON.stringify(e)})`)], ['Corporate Chef', 'G5', '調理']);
  assert.equal(run(c, `ghCheck(${JSON.stringify(e)}).state`), 'ok', 'the grade shown and the last grade-history record agree');
  const r = c.STORE.grade_hist.hc.recs[0];
  assert.deepEqual([r.from, r.g, r.mode, r.prevEval], ['G4', 'G5', 'special', undefined]);
  // the normal career: Kitchen Leader (G3) → Store Manager (G4)
  const d = app(NEO);
  run(d, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('理由'); ghSpecialReview(); ghConfirmGo();`);
  const n = empOf(d, 'neo');
  assert.deepEqual([run(d, `empGrade(${JSON.stringify(n)})`), run(d, `empSpecialistDept(${JSON.stringify(n)})`), run(d, `ghCheck(${JSON.stringify(n)}).state`)], ['G4', null, 'ok']);
});

test('the grade history tells special changes apart; the reason is escaped; editing the history keeps the mark', () => {
  const c = app();
  vm.runInContext(`escapeHtml = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };`, c);
  const rec = { id: 'h1', d: '2026-08-20', g: 'G4', from: 'G3', start: false, src: 'title', mode: 'special', reason: '<b>理由</b>', by: 'GM', at: '2026/08/20 09:00' };
  c.R = rec;
  assert.match(run(c, `ghSrcTag(R)`), />自動：役職の変更<\/span> <span[^>]*color:#b4501a[^>]*>特例（評価なし）<\/span>$/);
  assert.equal(run(c, `ghSrcTag({src:'title'})`).includes('特例'), false, 'normal changes have no special tag');
  assert.match(run(c, `ghSpecialHtml(R)`), /特例変更（Career Score の評価なし）<\/span> 理由：&lt;b&gt;理由&lt;\/b&gt;<span[^>]*> 2026\/08\/20 09:00 GM<\/span>/);
  assert.equal(run(c, `ghSpecialHtml({src:'title'})`), '');
  // the grade-history editor (GM/CEO) keeps mode and reason when other fields are edited
  c.STORE.grade_hist = { ken: { recs: [rec], _at: 1 } };
  run(c, `ghOpenEdit('ken'); ghEdSet(0, 'note', 'メモ'); ghEdSave();`);
  const r = c.STORE.grade_hist.ken.recs[0];
  assert.deepEqual([r.mode, r.reason, r.note], ['special', '<b>理由</b>', 'メモ']);
  // the same day and grade already recorded (without an evaluation): the special mark is added to it
  c.STORE.grade_hist = { neo: { recs: [{ id: 'h2', d: '2026-08-20', g: 'G4', from: 'G3', start: false, src: 'manual' }], _at: 1 } };
  assert.equal(run(c, `ghAddRecEval('neo', { d:'2026-08-20', g:'G4', from:'G3', start:false, src:'title', mode:'special', reason:'r' }, 'Neo Sample')`), true);
  assert.deepEqual([c.STORE.grade_hist.neo.recs.length, c.STORE.grade_hist.neo.recs[0].mode, c.STORE.grade_hist.neo.recs[0].reason], [1, 'special', 'r']);
  // both history tables show it
  assert.match(source, /ghSrcTag\(x\.r\)[^\n]*ghSpecialHtml\(x\.r\)/);
  assert.match(source, /ghPrevEvalHtml\(t\.rec\)\+\(\(typeof ghSpecialHtml==='function'\) \? ghSpecialHtml\(t\.rec\) : ''\)/);
});

test('review P2: the grade-history tab toggle (ghSetMode) still works, and no two top-level functions share a name', () => {
  const c = app();
  vm.runInContext('karteRerender = function(){ window.RER = (window.RER||0) + 1; };', c);
  run(c, `ghSetMode('all')`);
  assert.deepEqual([run(c, 'window._ghMode'), run(c, 'window.RER')], ['all', 1]);
  run(c, `ghSetMode('chg')`);
  assert.equal(run(c, 'window._ghMode'), 'chg');
  // a stale grade-change dialog is not reopened by the tab
  run(c, `saveEmp('ken')`); const n = c.MODAL.length;
  run(c, `ghSetMode('all')`);
  assert.equal(c.MODAL.length, n);
  const names = [...source.matchAll(/\nfunction ([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  assert.deepEqual([...new Set(dup)], [], 'a later declaration silently replaces an earlier one');
});

test('G3 track (not an evaluation): kept on the special record and used by the bonus; chosen when the title does not tell it', () => {
  // the title tells it (Kitchen Leader → kitchen): the bonus uses it for the G3 period
  const c = app(NEO);
  run(c, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('理由'); ghSpecialReview();`);
  assert.match(lastModal(c), /職種（G3 の期間）<\/td><td>G3 /);
  run(c, `ghConfirmGo()`);
  assert.equal(c.STORE.grade_hist.neo.recs[0].track, 'kt');
  const e = empOf(c, 'neo');
  const seg = { g: 'G3', from: '2026-07-01', to: '2026-08-20' };
  vm.runInContext(fnSrc('kevScopeOf'), c);
  c.E = e; c.SEG = seg;
  assert.equal(run(c, `ghSpecialSegTrack(E, SEG)`), 'kt');
  const cf = run(c, `bonusCoefFor(E, 'G3', null, SEG, '2026-Q3')`);
  assert.deepEqual([cf.track, cf.trackSrc, cf.blocked || null], ['kt', 'grade', cf.blocked === 'coef' ? 'coef' : null]);
  assert.notEqual(cf.blocked, 'track', 'the G3 period of a special change is not blocked for the track');
  assert.deepEqual(run(c, `kevScopeOf(E, SEG, '2026-Q3')`), { key: 'G3-kt', g: 'G3', track: 'kt', trackSrc: 'grade' });
  assert.equal(run(c, `ghSpecialSegTrack(E, {g:'G3', from:'2026-07-01', to:'2026-08-19'})`), null, 'only the period that the change ended');
  // the title does not tell it: choose it (like the normal change); the review shows it
  const d = app({ 'e-name': { value: 'Tom Sample' }, 'e-title': { value: 'Store Manager' }, 'e-role': { value: 'sl' } });
  d.EMPS.push({ id: 'tom', name: 'Tom Sample', title: '', role: 'sl' });
  d.STORE.m_employees = JSON.parse(JSON.stringify(d.EMPS));
  vm.runInContext(`empGrade = (function(orig){ return function(e){ return (e && !e.title && e.role==='sl') ? 'G3' : orig(e); }; })(empGrade);`, d);
  run(d, `saveEmp('tom'); ghSetChangeMode('special'); ghSpecialReason('理由');`);
  assert.match(lastModal(d), /aria-label="G3 の職種"/);
  assert.match(run(d, `ghConfirmBtnHtml(window._ghPend)`), /<button id="gh-cf-go"[^>]*disabled[^>]*>.*G3 の職種を選んでください<\/button>/);
  run(d, `ghConfirmSave()`);
  assert.equal(empOf(d, 'tom').title, '');
  run(d, `ghEvalSetTrack('sv')`);
  assert.ok(lastModal(d).includes('>理由</textarea>'), 'the reason is kept when the track is chosen');
  run(d, `ghSpecialReview(); ghConfirmGo();`);
  const r = d.STORE.grade_hist.tom.recs[0];
  assert.deepEqual([empOf(d, 'tom').title, r.mode, r.track], ['Store Manager', 'special', 'sv']);
});

test('review P3: a confirmation left over from another change is not stamped on an approval; an earlier special mark is not overwritten', () => {
  const c = app();
  c.STORE.lss_requests = [{ id: 'r1', name: 'Bob Sample', kind: 'promo', wantTitle: 'Crew Leader', status: '申請中' }];
  run(c, `window._ghPend = { ok:true, kind:'emp', empId:'bob', g0:'G2', g1:'G3', d:'2026-08-01', note:'', mode:'special', reason:'old', reviewed:true, ev:null, track:null }`);
  run(c, `approveLssRequest('r1','承認')`);
  const r = c.STORE.grade_hist.bob.recs[0];
  assert.deepEqual([c.STORE.lss_requests[0].status, r.from, r.g, r.d, r.mode, r.reason], ['承認', 'G1', 'G2', '2026-08-20', undefined, undefined]);
  // the same grades but left over from the employee form (kind) / an approval of other grades: not used either
  for (const pend of [`{ ok:true, kind:'emp', empId:'bob', key:'bob', g0:'G1', g1:'G2', d:'2026-08-01', note:'old note' }`,
                      `{ ok:true, kind:'approve', empId:'bob', key:'r2', g0:'G2', g1:'G3', d:'2026-08-01', note:'old note' }`]) {
    const d = app();
    d.STORE.lss_requests = [{ id: 'r2', name: 'Bob Sample', kind: 'promo', wantTitle: 'Crew Leader', status: '申請中' }];
    run(d, `window._ghPend = ${pend}`);
    run(d, `approveLssRequest('r2','承認')`);
    const x = d.STORE.grade_hist.bob.recs[0];
    assert.deepEqual([x.d, x.note === 'old note'], ['2026-08-20', false], pend);
  }
  // the same day and grade already marked special: the first mark (reason, who, when) stays
  c.STORE.grade_hist = { neo: { recs: [{ id: 'h3', d: '2026-08-20', g: 'G4', from: 'G3', start: false, src: 'title', mode: 'special', reason: 'first', spBy: 'CEO', spAt: '2026/08/20 08:00' }], _at: 1 } };
  assert.equal(run(c, `ghAddRecEval('neo', { d:'2026-08-20', g:'G4', from:'G3', start:false, src:'title', mode:'special', reason:'second', spBy:'GM', spAt:'2026/08/20 09:00' }, 'Neo Sample')`), true);
  const h = c.STORE.grade_hist.neo.recs[0];
  assert.deepEqual([h.reason, h.spBy, h.spAt], ['first', 'CEO', '2026/08/20 08:00']);
  // the history line shows who made the special change, and when
  c.R = { mode: 'special', reason: 'x', by: 'Someone', at: '2026/08/01 10:00', spBy: 'GM', spAt: '2026/08/20 09:00' };
  assert.match(run(c, `ghSpecialHtml(R)`), /2026\/08\/20 09:00 GM<\/span>/);
});

test('nothing else changes: no evaluation is confirmed or invented, the bonus keeps its rules, the release', () => {
  // the special change never calls the evaluation confirm, never writes Career Score or bonus data
  for (const f of ['ghSpecialRec', 'ghSpecialReview', 'ghSpecialReviewHtml', 'ghSpecialBlockHtml', 'ghSetChangeMode', 'ghSpecialReason', 'ghSpecialTrackHtml', 'ghSpecialApplyHtml', 'ghSpReason', 'ghSpecialSegTrack', 'ghModeHtml', 'ghCsStateTxt'])
    assert.doesNotMatch(fnSrc(f), /ghEvalConfirm\(|setLssScores|lsSet\(|bonus_q|csFreeze/, f);
  assert.match(fnSrc('ghEvalRecord'), /if\(!p \|\| !p\.ev \|\| p\.mode==='special'\) return undefined;/);
  assert.match(source, /const APP_VERSION = '1115';/);
  assert.match(SW, /const SW_BUILD = '1115';/);
});
