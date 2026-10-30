// v1116 (Moto 10/29 21:18 HST "変更できません"): the grade history already had the change (the last record is the new grade on the
// chosen decision date — e.g. added beforehand in the grade-history tab) while the title in the staff master was still the old one.
// v1115 then refused every date: on that date "より後の日にしてください", on a later date "その日のグレードが履歴では … になっていません".
// Now the same change on the same date is accepted: the period is checked with the history before that record, the save adds no new
// record but attaches to it (special mark and reason, or the confirmed evaluation), and the title is saved with it (all or nothing).
// On another date the message names the recorded date. Runs the real code from index.html with the harness of
// tests/career-criteria.test.mjs (synthetic staff and scores). No network, no browser storage, no production data.
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
const lastModal = c => c.MODAL[c.MODAL.length - 1] || '';
const empOf = (c, id) => c.STORE.m_employees.find(x => x.id === id);
const fnSrc = name => { const i = source.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return source.slice(i + 1, source.indexOf('\n}\n', i) + 2); };

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
const REASON = '権限の変更（評価は次の四半期）';
const MANUAL = { id: 'm1', d: '2026-06-30', g: 'G4', from: '', start: false, src: 'manual', by: 'GM', at: '2026/08/19 10:00', note: '' };   // added in the grade-history tab first

test("Moto's case: the history already says the new grade on that date — the special change saves the title and marks that record (no second record)", () => {
  const c = app(NEO);
  c.STORE.grade_hist = { neo: { recs: [Object.assign({}, MANUAL)], _at: 1 } };
  assert.equal(run(c, `ghCheck(EMPS.find(function(x){ return x.id==='neo'; })).state`), 'diff', 'history G4, title G3');
  run(c, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason(${JSON.stringify(REASON)});`);
  // another date: the message names the recorded date (v1115 said "7/1 以降", and 7/1 then failed with "G3 になっていません")
  for (const d of ['2026-06-20', '2026-07-01', '2026-08-20']) {
    run(c, `window._ghPend.d=${JSON.stringify(d)}`);
    const stop = run(c, `ghEvalStop(window._ghPend)`);
    assert.match(stop, /^グレード履歴では、もう 2026\/6\/30 に G4 に変わっています（役職はまだ G3）。確定日を 2026\/6\/30 にすると、その記録に合わせて役職を変えます/, d);
    assert.doesNotMatch(stop, /より後の日|になっていません/, d);
    assert.equal(run(c, `ghConfirmInfo(window._ghPend)`).includes('新しい記録は足さず'), false, d + ': only on the recorded date');
  }
  run(c, `ghSpecialReview(); ghConfirmGo();`);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader', 'not saved on another date');
  // the recorded date: accepted; the period is the old grade up to that date (the history before that record)
  run(c, `ghSpecialBack(); ghConfirmDate('2026-06-30')`);
  assert.equal(run(c, `ghEvalStop(window._ghPend)`), '');
  assert.deepEqual(run(c, `(function(){ var p=ghEvalPeriod(window._ghPend); return [p.err||'', p.from, p.to, p.days, p.next, p.same && p.same.id]; })()`), ['', '2026-04-01', '2026-06-30', 91, '2026-07-01', 'm1']);
  assert.match(run(c, `ghConfirmInfo(window._ghPend)`), /グレード履歴にはもう 2026\/6\/30 に G4 になった記録があります（役職はまだ G3）。新しい記録は足さず、その記録に合わせて役職を変えます。/);
  run(c, `ghConfirmSave()`);
  const m = lastModal(c);
  assert.match(m, /特例でグレードを変更します（確認）/);
  assert.match(m, /<td[^>]*>グレード履歴<\/td><td>[\s\S]*?もう 2026\/6\/30 に G4 になった記録があります/);
  c.PUSHES.length = 0;
  run(c, `ghConfirmGo()`);
  assert.equal(empOf(c, 'neo').title, 'Store Manager');
  const recs = c.STORE.grade_hist.neo.recs;
  assert.equal(recs.length, 1, 'no second record');
  const r = recs[0];
  assert.deepEqual([r.id, r.d, r.g, r.src, r.by, r.at, r.mode, r.reason, r.spBy, r.spAt, r.track, r.prevEval], ['m1', '2026-06-30', 'G4', 'manual', 'GM', '2026/08/19 10:00', 'special', REASON, 'GM', '2026/08/20 09:00', 'kt', undefined]);
  assert.ok(c.PUSHES.includes('m_employees') && c.PUSHES.includes('grade_hist'), 'title and history together');
  assert.equal(run(c, `ghCheck(${JSON.stringify(empOf(c, 'neo'))}).state`), 'ok');
  assert.equal(run(c, `window._ghPend`), null);
  assert.equal(Object.keys(c.STORE).filter(k => /^lss_emp_/.test(k)).length, 0, 'no Career Score is made up');
});

test('the normal change (with the confirmed evaluation) on the recorded date: the evaluation goes into that record', () => {
  const c = app();   // Ken: Server Leader (G3, Career Score 72) → Store Manager (G4)
  c.STORE.grade_hist = { ken: { recs: [{ id: 'k1', d: '2026-08-15', g: 'G4', from: 'G3', start: false, src: 'manual' }], _at: 1 } };
  run(c, `saveEmp('ken'); window._ghPend.d='2026-08-25'; ghEvalConfirm();`);
  assert.equal(run(c, `window._ghPend.ev`), null, 'another date cannot be confirmed');
  assert.match(run(c, `ghEvalPeriod(window._ghPend).err`), /もう 2026\/8\/15 に G4 に変わっています/);
  assert.match(run(c, `ghEvalPeriodHtml(window._ghPend)`), /もう 2026\/8\/15 に G4 に変わっています/, 'shown in the evaluation block');
  run(c, `window._ghPend.d='2026-08-15'; ghEvalConfirm(); ghConfirmSave();`);
  assert.equal(empOf(c, 'ken').title, 'Store Manager');
  const recs = c.STORE.grade_hist.ken.recs;
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].id, recs[0].prevEval.csPct, recs[0].prevEval.from, recs[0].prevEval.to, recs[0].prevEval.days, recs[0].mode], ['k1', 72, '2026-07-01', '2026-08-15', 46, undefined]);
});

test('a record that is already a special change keeps its first reason; the screen says so', () => {
  const c = app(NEO);
  c.STORE.grade_hist = { neo: { recs: [Object.assign({}, MANUAL, { src: 'title', mode: 'special', reason: 'first', spBy: 'CEO', spAt: '2026/08/19 10:00' })], _at: 1 } };
  run(c, `saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('second'); ghConfirmDate('2026-06-30');`);
  assert.match(run(c, `ghConfirmInfo(window._ghPend)`), /その記録に合わせて役職を変えます（この記録はもう特例変更です。理由は前に入れたもののまま）。/);
  run(c, `ghSpecialReview(); ghConfirmGo();`);
  assert.equal(empOf(c, 'neo').title, 'Store Manager');
  const r = c.STORE.grade_hist.neo.recs;
  assert.deepEqual([r.length, r[0].reason, r[0].spBy, r[0].spAt], [1, 'first', 'CEO', '2026/08/19 10:00']);
});

test('Codex #106 e9e8bc4 P2 (v1117): a record that is already a special change is not turned into a normal one — the normal change stops before the evaluation, the special change keeps the first reason, who and when', () => {
  const c = app();   // Ken: Server Leader (G3, Career Score 72) → Store Manager (G4)
  const SP = { id: 'k1', d: '2026-08-15', g: 'G4', from: 'G3', start: false, src: 'title', by: 'CEO', at: '2026/08/19 10:00', note: '',
               mode: 'special', reason: 'original', spBy: 'CEO', spAt: '2026/08/19 10:00', track: 'sv' };
  c.STORE.grade_hist = { ken: { recs: [Object.assign({}, SP)], _at: 1 } };
  const keep = () => { const r = c.STORE.grade_hist.ken.recs; assert.equal(r.length, 1); return [r[0].mode, r[0].reason, r[0].spBy, r[0].spAt, r[0].track, r[0].prevEval, r[0].edBy]; };
  const KEPT = ['special', 'original', 'CEO', '2026/08/19 10:00', 'sv', undefined, undefined];
  run(c, `saveEmp('ken'); window._ghPend.d='2026-08-15';`);
  assert.notEqual(run(c, `window._ghPend.mode`), 'special', 'the normal change is the default');
  // the normal change: stopped first (not "confirm the evaluation" — confirming it could never be saved)
  const stop = run(c, `ghEvalStop(window._ghPend)`);
  assert.match(stop, /^グレード履歴の 2026\/8\/15 G4 の記録は、もう特例変更（評価なし）です。上の「特例でグレードを変更する」を選ぶと、その記録のまま役職を変えます（理由は前に入れたもののまま）。評価で数える通常の変更にするときは、先に成長カルテのグレード履歴でこの記録を消してください$/);
  assert.match(run(c, `ghConfirmBtnHtml(window._ghPend)`), /disabled[\s\S]*特例変更の記録です。「特例」を選んでから保存/);
  assert.match(run(c, `ghEvalPeriodHtml(window._ghPend)`), /もう特例変更（評価なし）です/);
  const info = run(c, `ghConfirmInfo(window._ghPend)`);
  assert.match(info, /2026\/8\/15 に G4 になった記録があります（特例変更・評価なし。役職はまだ G3）。「特例でグレードを変更する」を選ぶと、新しい記録は足さず、その記録のまま役職を変えます（理由は前に入れたもののまま）。/);
  assert.doesNotMatch(info, /その記録に合わせて役職を変えます（この記録はもう特例変更です/, 'no longer says the normal change keeps the reason');
  run(c, `ghEvalConfirm()`);
  assert.equal(run(c, `window._ghPend.ev`), null, 'the evaluation is not confirmed');
  assert.equal(c.TOASTS[c.TOASTS.length - 1], stop);
  run(c, `ghConfirmSave()`);
  assert.equal(empOf(c, 'ken').title, 'Server Leader', 'not saved as a normal change');
  assert.deepEqual(keep(), KEPT);
  // the special change on the same record: saved, the first reason, who and when stay (the new reason is not used)
  run(c, `ghSetChangeMode('special'); ghSpecialReason('second');`);
  assert.equal(run(c, `ghEvalStop(window._ghPend)`), '');
  run(c, `ghSpecialReview(); ghConfirmGo();`);
  assert.equal(empOf(c, 'ken').title, 'Store Manager');
  assert.deepEqual(keep(), KEPT);
});

test('Codex #106 e9e8bc4 P2 (v1117): if the record became a special change on another device after the screen checked it, the save writes nothing and keeps the special change', () => {
  const c = app();
  c.STORE.grade_hist = { ken: { recs: [{ id: 'k1', d: '2026-08-15', g: 'G4', from: 'G3', start: false, src: 'manual' }], _at: 1 } };
  run(c, `saveEmp('ken'); window._ghPend.d='2026-08-15'; ghEvalConfirm();`);
  assert.ok(run(c, `window._ghPend.ev`), 'confirmed on a plain record');
  // another device: the record becomes a special change
  c.STORE.grade_hist = { ken: { recs: [{ id: 'k1', d: '2026-08-15', g: 'G4', from: 'G3', start: false, src: 'manual', mode: 'special', reason: 'other device', spBy: 'CEO', spAt: '2026/08/20 08:30' }], _at: 2 } };
  // the screen checks again when saving
  run(c, `ghConfirmSave()`);
  assert.equal(empOf(c, 'ken').title, 'Server Leader');
  assert.match(c.TOASTS[c.TOASTS.length - 1], /もう特例変更（評価なし）です/);
  // and the record itself is never overwritten, even if the screen check is passed (between the check and the write): all or nothing
  c.TOASTS.length = 0;
  run(c, `var __es=ghEvalStop; ghEvalStop=function(){ return ''; }; try{ ghConfirmSave(); } finally { ghEvalStop=__es; }`);
  assert.equal(empOf(c, 'ken').title, 'Server Leader', 'the title is rolled back with the history');
  const r = c.STORE.grade_hist.ken.recs;
  assert.deepEqual([r.length, r[0].mode, r[0].reason, r[0].spBy, r[0].spAt, r[0].prevEval, r[0].edBy], [1, 'special', 'other device', 'CEO', '2026/08/20 08:30', undefined, undefined]);
  assert.ok(c.TOASTS.some(t => /^保存できませんでした。/.test(t)), c.TOASTS.join(' / '));
  assert.ok(c.TOASTS.some(t => /2026\/8\/15 G4 の記録は特例変更（評価なし）になっています。評価は記録せず、役職も変えていません/.test(t)), c.TOASTS.join(' / '));
  // outside the save, too
  c.TOASTS.length = 0;
  assert.equal(run(c, `ghAddRecEval('ken', { d:'2026-08-15', g:'G4', from:'G3', start:false, src:'title', prevEval:{ g:'G3', csPct:72 } }, 'Ken Sample')`), false);
  assert.equal(c.STORE.grade_hist.ken.recs[0].reason, 'other device');
  assert.match(c.TOASTS.join(' / '), /特例変更（評価なし）になっています/);
});

test('not the same change: the checks stay as before (another grade, another "from", history that disagrees before the record, start records)', () => {
  const c = app(NEO);
  const stopFor = (recs, d) => {
    c.STORE.grade_hist = { neo: { recs, _at: 1 } };
    run(c, `window._ghPend=null; saveEmp('neo'); ghSetChangeMode('special'); ghSpecialReason('x'); window._ghPend.d=${JSON.stringify(d)};`);
    return run(c, `ghEvalStop(window._ghPend)`);
  };
  // the last record is another grade
  assert.match(stopFor([Object.assign({}, MANUAL, { g: 'G5' })], '2026-06-30'), /グレード履歴の最後の記録（2026\/6\/30 G5）より後の日にしてください（7\/1 以降）/);
  // the recorded change starts from another grade
  assert.match(stopFor([Object.assign({}, MANUAL, { from: 'G2' })], '2026-06-30'), /グレード履歴の最後の記録（2026\/6\/30 G4）より後の日にしてください/);
  // same change, but the history before it does not say G3 on that date → not guessed
  assert.match(stopFor([{ id: 'm0', d: '2026-05-10', g: 'G2', from: 'G3', start: false, src: 'manual' }, Object.assign({}, MANUAL)], '2026-06-30'),
    /確定日 6\/30 の時点のグレードが、グレード履歴では G3 になっていません（G2）/);
  // a start (hire) record with the new grade is not a change
  assert.match(stopFor([{ id: 's0', d: '2026-06-30', g: 'G4', start: true, src: 'hire' }], '2026-06-30'), /グレード履歴の最後の記録（2026\/6\/30 G4）より後の日にしてください（6\/30 以降）|になっていません/);
  assert.equal(empOf(c, 'neo').title, 'Kitchen Leader');
  // without such a record nothing changes
  delete c.STORE.grade_hist;
  run(c, `window._ghPend=null; saveEmp('neo'); ghSetChangeMode('special'); window._ghPend.d='2026-06-30';`);
  assert.equal(run(c, `ghConfirmInfo(window._ghPend)`).includes('もう'), false);
  assert.equal(run(c, `ghEvalPeriod(window._ghPend).same`), undefined);
  assert.equal(run(c, `ghLastSameChange({g0:'G3', g1:'G3'}, [{d:'2026-06-30', g:'G3', start:false}])`), null, 'no change of grade');
});

test('promotion approval uses the same check (one function for the three entrances)', () => {
  assert.match(fnSrc('ghEvalStop'), /ghEvalPeriod\(p\)/);
  assert.match(fnSrc('ghEvalPeriod'), /var sc=e \? ghLastSameChange\(p, recs\) : null;/);
  assert.match(fnSrc('ghEvalPeriod'), /if\(sc\) recs=recs\.slice\(0, -1\);/);
  assert.match(fnSrc('ghAddRecEval'), /if\(ghAddRec\(empId, rec, name\)\) return true;/, 'the save attaches to the same-day record (ghAddRec refuses a duplicate)');
});
