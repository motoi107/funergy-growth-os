// v1208（#215 のルーティンのレビュー P2-A）：2026 Q4 からのグレード変更（UI案38：G2 以上から変わるときに前のグレードの期間の評価を確定）は、
// 前の Career Score（lss_emp_）の点が無くても確定できる。2026 Q4 からの賞与の ① は「Career Score」→「今期の評価」で確定・公開した評価で決まり
// （答え 6 A）、前の点はもう使わないため。G3 の職種（賞与の係数の区分）は今までどおり決める。Q3 までの変更・新しい Career Score が動いていない端末は今までどおり。
// Runs the real code from index.html with the UI案38 harness of tests/career-criteria.test.mjs (synthetic staff and scores).
// No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const url = new URL('./career-criteria.test.mjs', import.meta.url).href;
const T = fs.readFileSync(new URL(url), 'utf8');
const head = T.split("\ntest('")[0];
const a38 = T.slice(T.indexOf('/* ------------------------------------------------------------------ UI案38 */'), T.indexOf('const lastModal'));
const cp = T.slice(T.indexOf('function storeBacked(c)'), T.indexOf("\ntest('Codex P1: employee master"));
const mod = await import('data:text/javascript;base64,' + Buffer.from((head + '\n' + a38 + '\n' + cp).replaceAll('import.meta.url', JSON.stringify(url))
  + '\nexport { app38, run, storeBacked };\n').toString('base64'));
const { app38, run, storeBacked } = mod;
const lastModal = c => c.MODAL[c.MODAL.length - 1] || '';

// 2026 Q4 の日付の端末（ハワイ 11/10）。cs4 は新しい Career Score が動いているか（FUNERGY_CS4.bonusQ）
function app({ today = '2026-11-10', cs4 = true } = {}) {
  const c = storeBacked(app38());
  run(c, `bizToday = function(){ return ${JSON.stringify(today)}; }; todayJP = function(){ return ${JSON.stringify(today.replace(/-/g, '/'))}; };
    nowJP = function(){ return ${JSON.stringify(today.replace(/-/g, '/') + ' 09:00')}; }; _bqNow = nowJP; void 0;`);
  if (cs4) run(c, `window.FUNERGY_CS4 = { bonusQ: function(q){ return String(q || '') >= '2026-Q4'; } };`);
  return c;
}

test('Q4: a person with no old Career Score can have the previous grade period confirmed (today’s evaluation is used for the bonus ①)', () => {
  const c = app();
  run(c, `ghBeforeSaveEmp('neo', { name:'Neo Sample', title:'Store Manager', role:'sl' }); window._ghPend.d='2026-11-05';`);
  assert.equal(run(c, `ghEvalCs4(window._ghPend)`), true);
  const m = run(c, `ghConfirmHtml(window._ghPend)`);
  assert.match(m, /今期の評価（新しい Career Score）/);
  assert.match(m, /onclick="ghEvalConfirm\(\)"/, 'the confirm button is there');
  assert.doesNotMatch(m, /まだ評価がありません/);
  run(c, `ghEvalConfirm()`);
  const ev = run(c, `window._ghPend.ev`);
  assert.ok(ev, 'confirmed with no old score');
  assert.deepEqual([ev.g, ev.cs4, ev.csPct, ev.csScore, ev.csMax, ev.cats, ev.by], ['G3', 1, null, null, null, null, 'GM']);
  assert.equal(ev.track, 'kt', 'Kitchen Leader → kitchen track');
  assert.equal(run(c, `ghEvalStop(window._ghPend)`), '', 'the save is no longer stopped by the evaluation');
  // the record keeps the confirmation; the history screen says it is the new evaluation
  run(c, `(function(){ var p=window._ghPend; p.period=ghEvalPeriod(p); p.ok=true; EMPS[4].title='Store Manager'; STORE.m_employees[4].title='Store Manager'; ghAfterSaveEmp('neo', { name:'Neo Sample' }, EMPS); })()`);
  const r = run(c, `ghRecs('neo')`)[0];
  assert.deepEqual([r.d, r.g, r.from, r.prevEval.cs4, r.prevEval.csPct, r.prevEval.track], ['2026-11-05', 'G4', 'G3', 1, null, 'kt']);
  assert.match(run(c, `ghPrevEvalHtml(ghRecs('neo')[0])`), /今期の評価（2026 Q4 からの新しい Career Score）/);
  assert.equal(Object.keys(c.STORE).filter(k => /^lss_emp_/.test(k)).length, 0, 'no old Career Score is made up');
});

test('Q4: the G3 track is still required when the title does not give one; GM/CEO only', () => {
  const c = app();
  run(c, `ghBeforeSaveEmp('sho', { name:'Sho Sample', title:'Store Manager', role:'sl' }); window._ghPend.d='2026-11-05';`);
  run(c, `ghEvalConfirm()`);
  assert.equal(run(c, `window._ghPend.ev`), null, 'Store Leader gives no track: pick first');
  run(c, `ghEvalSetTrack('op'); ghEvalConfirm()`);
  assert.deepEqual(run(c, `[window._ghPend.ev.track, window._ghPend.ev.cs4, window._ghPend.ev.csPct]`), ['op', 1, null], 'the old 64% is not copied in Q4');
  run(c, `ghConfirmCancel(); ghBeforeSaveEmp('neo', { name:'Neo Sample', title:'Store Manager', role:'sl' }); window._ghPend.d='2026-11-05';`);
  c.curRole = 'am'; run(c, `ghEvalConfirm()`);
  assert.equal(run(c, `window._ghPend.ev`), null, 'AM cannot confirm (as before)');
  assert.doesNotMatch(run(c, `ghConfirmHtml(window._ghPend)`), /onclick="ghEvalConfirm\(\)"/);
});

test('a change dated in Q3, or a device where the new Career Score is not running, works as before', () => {
  for (const [opts, d] of [[{}, '2026-09-30'], [{ cs4: false }, '2026-11-05']]) {
    const c = app(opts);
    run(c, `ghBeforeSaveEmp('neo', { name:'Neo Sample', title:'Store Manager', role:'sl' }); window._ghPend.d=${JSON.stringify(d)};`);
    assert.equal(run(c, `ghEvalCs4(window._ghPend)`), false, JSON.stringify(opts) + d);
    const m = run(c, `ghConfirmHtml(window._ghPend)`);
    assert.match(m, /まだ評価がありません/);
    assert.doesNotMatch(m, /onclick="ghEvalConfirm\(\)"/);
    run(c, `ghEvalConfirm()`);
    assert.equal(run(c, `window._ghPend.ev`), null, 'no old score → no confirmation (as before)');
    // with an old score, the old score is confirmed (as before)
    run(c, `ghConfirmCancel(); ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' }); window._ghPend.d=${JSON.stringify(d)}; ghEvalConfirm();`);
    const ev = run(c, `window._ghPend.ev`);
    assert.deepEqual([ev.csPct, ev.cs4], [72, undefined]);
  }
});

test('a broken FUNERGY_CS4 never turns the old way on or off by mistake', () => {
  const c = app({ cs4: false });
  run(c, `window.FUNERGY_CS4 = { bonusQ: function(){ throw new Error('x'); } };`);
  run(c, `ghBeforeSaveEmp('neo', { name:'Neo Sample', title:'Store Manager', role:'sl' }); window._ghPend.d='2026-11-05';`);
  assert.equal(run(c, `ghEvalCs4(window._ghPend)`), false);
  assert.equal(run(c, `ghEvalCs4(null)`), false);
});
