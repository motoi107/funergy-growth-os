// Codex review of PR #43 at 64474428e81b8a865d814b184c27352fde22397d.
// Synthetic data only. No browser, network, production data or writes outside this VM.
// Expected-behavior assertions: failures reproduce the findings on the reviewed head.
// Run explicitly: node --test tests/review/pr43-karte-eval-repro.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Reuse only the synthetic fixture constructor, not its test expectations.
// Replace a stub with an extracted production function where the finding needs it.
const index = process.env.FUNERGY_INDEX || new URL('../../index.html', import.meta.url).pathname;
const fixturePath = new URL('../karte-eval.test.mjs', import.meta.url);
let fixture = fs.readFileSync(fixturePath, 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, fn, person, Q } = await import('data:text/javascript;base64,' + Buffer.from(
  fixture + '\nexport { company, run, fn, person, totals, Q };\n'
).toString('base64'));
const copy = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const value = vm.runInContext(code, c); return value === undefined ? value : copy(value); };
const install = (c, ...names) => vm.runInContext(names.map(fn).join('\n'), c);
function clock(c, n) { vm.runInContext('Date.now = () => ' + n, c); }

test('R1: recording a bonus survives a later unrelated edit from a stale device', t => {
  const a = company(), b = company();
  install(b, 'saveKarte');
  clock(a, 1000);
  run(a, `bqLockQuarter('${Q}'); bonusConfirmQuarter();`);
  const recorded = copy(a.STORE.growth_karte);
  assert.equal(recorded.ken.payLog.length, 1);
  // B has not received A's payLog. The user only edits another karte field.
  clock(b, 2000);
  run(b, `var stale = getKarte('ken'); stale.note = 'Synthetic meeting note'; saveKarte('ken', stale);`);
  b.CLOUD_KARTE = recorded;
  const merged = run(b, `mergeMapByTime(CLOUD_KARTE, ls('growth_karte', {}))`);
  t.diagnostic(JSON.stringify({recordedAt:recorded.ken._at, laterEditAt:b.STORE.growth_karte.ken._at,
    historyBefore:recorded.ken.payLog.length, historyAfter:(merged.ken.payLog || []).length}));
  assert.equal((merged.ken.payLog || []).length, 1, 'A recorded payLog must not disappear when B edits a different field');
});

test('R2: an offline stale device cannot finalize an obsolete completed evaluation', t => {
  const a = company(), b = company();
  const oldAmount = person(b, 'ken').amount;
  clock(a, 1000);
  run(a, `kevEvEdit('ken','G3','ab.lv',5,'${Q}'); kevDone('ken','G3','${Q}');`);
  const latestAmount = person(a, 'ken').amount;
  assert.notEqual(latestAmount, oldAmount);
  b.navigator = {onLine:false};
  clock(b, 2000);
  run(b, `bqLockQuarter('${Q}');`);
  // Once B reconnects, even receipt of the latest evaluation cannot repair evSnap.
  b.CLOUD_EVAL = copy(a.STORE.bonus_eval);
  run(b, `STORE.bonus_eval = kevMergeMap(CLOUD_EVAL, STORE.bonus_eval);`);
  const d = b.STORE.bonus_q[Q];
  t.diagnostic(JSON.stringify({oldAmount, latestAmount, locked:!!d.locked,
    latestLevel:b.STORE.bonus_eval[Q+'|ken|G3'].ab.lv, frozenAmount:person(b,'ken').amount}));
  assert.ok(!d.locked || person(b,'ken').amount === latestAmount,
    'Reject a stale/offline finalization or validate and freeze the latest approved inputs');
});

test('R3: absent cost and attendance records are missing, not an excellent FL result', t => {
  const c = company();
  install(c, 'plComputeStore', 'foodCostOf', '_laborCoreForYmRaw', 'laborWeekDays', 'laborMonthWeeks', 'laborWeekRange', '_laborHrs', 'isoLocalDate', 'isoOf');
  // Revenue/budget exists in the fixture. All cost, inventory and attendance
  // sources below are empty; the real PL and labor calculations consume them.
  vm.runInContext(`
    var PL_VC_CATS = [], PL_FIX_CATS = [], PAYROLL_TAX_RATE = 0.17;
    function getPlConfig(){ return {vcAvg:{}, fixed:{}, getRate:4.712}; }
    function getPlOverrides(){ return {}; }
    function getFcMonthly(){ return {}; }
    function monthInvoiceCostYm(){ return 0; }
    function monthPurchaseCostYm(){ return 0; }
    function monthTransferNetYm(){ return {inAmt:0,outAmt:0,net:0}; }
    function plReimburseTotal(){ return 0; }
    function laborCoreForYm(s, ym){ return _laborCoreForYmRaw(s, ym); }
    function curYm(){ return '2026-10'; }
    function getTipLabor(){ return null; }
    function storeMonthlyStaff(){ return []; }
    function daysInMonthOf(ym){ return new Date(+ym.slice(0,4),+ym.slice(5),0).getDate(); }
    function daysOfYm(ym){ return Array.from({length:daysInMonthOf(ym)},(_,i)=>({date:ym+'-'+String(i+1).padStart(2,'0')})); }
    function _daRO(){ return {}; }
    function isFrozenMonth(){ return false; }
  `, c);
  // Make sure a missing helper does not merely trigger plComputeStore's catch.
  const labor = run(c, `_laborCoreForYmRaw('S2', '2026-09')`);
  assert.equal(labor.total, 0);
  const pl = run(c, `plComputeStore('S2','2026-09',-1)`);
  assert.equal(pl.sales, 309000);
  assert.equal(pl.cogs, 0);
  const b = person(c, 'mia'), f = b.segs[0].items.f;
  t.diagnostic(JSON.stringify({cogs:pl.cogs, labor:pl.labor, blocked:b.blocked,
    foodRate:f.food.res.actual, foodResultPoints:f.food.res.pts,
    laborRate:f.labor.res.actual, laborResultPoints:f.labor.res.pts,
    flCoef:b.segs[0].coefs?.f, lockProblems:run(c,'kevLockProblems(bonusTotals(kbCfg()))')}));
  assert.equal(b.blocked, 'eval', 'Missing source data must not grant 75 result points and allow finalization');
});

test('R4: finalized evaluations retain and display the explanation and evidence', t => {
  const c = company();
  const reason = 'REVIEW_FIXTURE_REASON_43';
  const comment = 'REVIEW_FIXTURE_FEEDBACK_43';
  const next = 'REVIEW_FIXTURE_NEXT_ACTION_43';
  Object.assign(c.STORE.bonus_eval[Q+'|mia|G4'], {cm:comment});
  c.STORE.bonus_eval[Q+'|mia|G4'].ab.ev = reason;
  c.STORE.bonus_eval[Q+'|mia|G4'].fa.next = next;
  const before = run(c, `var b=bonusForEmp(EMPS[3],kbCfg()); kevPersonMainHtml(EMPS[3],b,b.segs[0],kevApplies(kbCfg()),bonusTotals(kbCfg()))`);
  assert.ok(before.includes(reason) && before.includes(comment) && before.includes(next));
  run(c, `bqLockQuarter('${Q}');`);
  const snapshot = JSON.stringify(c.STORE.bonus_q[Q].evSnap);
  const after = run(c, `var b=bonusForEmp(EMPS[3],kbCfg()); kevSnapMainHtml(EMPS[3],b,b.segs[0],kevApplies(kbCfg()))`);
  t.diagnostic(JSON.stringify({stillInDraft:JSON.stringify(c.STORE.bonus_eval).includes(reason),
    reasonFrozen:snapshot.includes(reason), commentFrozen:snapshot.includes(comment),
    nextFrozen:snapshot.includes(next), reasonVisible:after.includes(reason), commentVisible:after.includes(comment)}));
  assert.ok(snapshot.includes(reason) && snapshot.includes(comment) && snapshot.includes(next)
    && after.includes(reason) && after.includes(comment),
    'Finalization must preserve the approved explanations and keep them readable without unlocking');
});
