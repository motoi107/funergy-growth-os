// v1058 (UI案37): Career Score promotion criteria by category, and grade / G3-track bonus coefficients.
// Runs the real code from index.html (the FUNERGY_CAREER_CRITERIA block, bonusProrate and the helpers they use)
// in a VM with synthetic scores and synthetic staff. No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function block(startMark, endMark) {
  const i = source.indexOf(startMark), j = source.indexOf(endMark, i);
  assert.ok(i >= 0 && j > i, startMark);
  return source.slice(i, j + endMark.length);
}
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start + 1), line = source.slice(start + 1, lineEnd);
  if (line.trimEnd().endsWith('}') && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
const varBlock = (name, close) => block('\n' + (source.includes('\nconst ' + name + ' = ') ? 'const ' : 'var ') + name + ' = ', close).replace(/^\nconst /, '\nvar ');

const MODULE = block('/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */');
function app() {
  const c = { console, STORE: {}, EMPS: [], BQ: {}, SEGS: {}, curRole: 'gm', curLang: 'ja', curUserName: 'GM' };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('GRADE_TITLES', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'), varBlock('LSS_EMP_PREFIX', ';'),
    ...['ghNormG', 'lssCatsOrdered', 'lssItemId', 'getLssScores', 'gradeOf', 'empGrade', 'empSpecialistDept', 'bonusProrate'].map(fn), MODULE].join('\n') + `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _bonusQParse(q){ var m=String(q||'').match(/(\d{4})\D*Q?([1-4])/i); return m ? { y:+m[1], q:+m[2] } : null; }
    function lsSet(k, v){ if (typeof FAIL_SET !== 'undefined' && FAIL_SET === k) return false; STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function t(a, b){ return curLang === 'en' ? b : a; }
    function escapeHtml(s){ return String(s == null ? '' : s); }
    function nowJP(){ return '2026/10/09 09:00'; } function myName(){ return 'GM'; } var ROLE_CONFIG = { gm:{ name:'GM' } };
    function getEmployees(){ return EMPS; } function ocsOldLocked(){ return false; }
    function _bqNow(){ return '2026/10/09 09:00'; } function _bqWho(){ return 'GM'; } function showToast(){} function kbRefresh(){} function karteRerender(){}
    var QR = { q:'2026-Q3', qs:'2026-07-01', qe:'2026-09-30', n:92 };
    function ghQRange(q){ return q === QR.q ? QR : null; }
    function bqGet(q){ return Object.assign({ locked:false, csFreeze:{} }, BQ[q] || {}); }
    function bonusSegs(e){ return (SEGS[e.id] || []).map(function(x){ return Object.assign({}, x); }); }`, c);
  c.EMPS = [{ id: 'a', name: 'Crew Sample', title: 'Crew' }, { id: 'b', name: 'Leader Sample', title: 'Crew Leader' }, { id: 'k', name: 'Server Sample', title: 'Server Leader' },
            { id: 'c', name: 'Chef Sample', title: 'Head Chef' }, { id: 'o', name: 'Office Sample', title: 'Office Manager' }, { id: 'g', name: 'GM Sample', title: 'General Manager' }];
  return c;
}
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };   // plain values (the VM has its own Array/Object)
const save = (c, k, cats) => run(c, `cscSaveTarget(${JSON.stringify(k)}, ${JSON.stringify(cats)})`);
// Scores: items from the front get 3 points until the category total is reached; `blanks` leaves the last items unscored.
function fill(c, name, totals, blanks) {
  const sc = {};
  run(c, 'lssCatsOrdered()').forEach(cat => {
    const n = cat.items.length, b = (blanks && blanks[cat.key]) || 0;
    let left = totals[cat.key] != null ? totals[cat.key] : Math.floor(n * 1.5);
    for (let i = 0; i < n - b; i++) { const v = Math.min(3, left); sc[cat.key + i] = v; left -= v; }
    assert.equal(left, 0, 'fill ' + cat.key);
  });
  c.STORE['lss_emp_' + name] = { scores: sc };
}
const G2 = { H: { m: 'pct', v: 60 }, A: { m: 'pct', v: 60 }, B: { m: 'pts', v: 30 }, C: { m: 'pct', v: 50 } };

test('every category used must be at or above its criterion; a high score elsewhere does not make up for it', () => {
  const c = app();
  assert.ok(save(c, 'G2', { ...G2, D: { m: 'pct', v: 99 } }).ok);
  assert.deepEqual(Object.keys(c.STORE.cs_criteria.G2.cats), ['H', 'A', 'B', 'C'], 'G2 uses Philosophy, Store Operation, Service and Kitchen/Prep only');
  fill(c, 'Crew Sample', { H: 54, A: 32, B: 54, C: 63 });
  const j = run(c, `cscJudge('Crew Sample','G2')`);
  assert.equal(j.all, 'ng');
  assert.deepEqual(j.rows.map(r => r.st), ['ok', 'ng', 'ok', 'ok']);
  assert.equal(j.rows[1].needPts, 1); assert.equal(j.rows[1].needPt, 0.8);   // 32/54 = 59.26% < 60%: one more point, 0.8 points of rate
  fill(c, 'Crew Sample', { H: 33, A: 33, B: 30, C: 32 });
  assert.equal(run(c, `cscJudge('Crew Sample','G2').all`), 'ok', 'exactly 30 points meets "30 points or more"');
});

test('at-or-above is compared without rounding, and the shown rate never rounds up', () => {
  const c = app();
  fill(c, 'Crew Sample', { B: 43, F: 27, H: 18 });
  const e = { cats: { B: { m: 'pct', v: 79.7 }, F: { m: 'pct', v: 75 }, H: { m: 'pct', v: 33.3 } } };
  const j = run(c, `cscJudge('Crew Sample','G4',${JSON.stringify(e)})`), st = k => j.rows.find(r => r.key === k).st;
  assert.equal(Math.round(43 / 54 * 100), 80, 'rounded to an integer it would look like 80%');
  assert.equal(st('B'), 'ng', '43/54 = 79.63% is below 79.7%');
  assert.equal(st('F'), 'ok', '27/36 = 75.0% meets 75%');
  assert.equal(st('H'), 'ok', '18/54 = 33.33% meets 33.3%');
  assert.equal(run(c, 'cscPctTxt(43,54)'), '79.6%');
});

test('unscored items or unfinished criteria put the result on hold; unscored items still count as 0 in the denominator', () => {
  const c = app();
  save(c, 'G2', G2);
  fill(c, 'Crew Sample', { H: 33, A: 33, B: 30, C: 32 }, { C: 1 });
  assert.equal(run(c, `cscJudge('Crew Sample','G2').all`), 'blank');
  const s = run(c, `cscCatScore('Crew Sample','C')`);
  assert.deepEqual([s.score, s.max, s.blank], [32, 63, 1], 'max stays items x 3');
  fill(c, 'Crew Sample', { H: 33, A: 20, B: 30, C: 32 }, { C: 1 });
  const j = run(c, `cscJudge('Crew Sample','G2')`);
  assert.equal(j.all, 'blank', 'still on hold while items are unscored, even with a category below its criterion');
  assert.equal(j.rows.find(r => r.key === 'A').st, 'ng', 'the row itself shows not met');
  fill(c, 'Crew Sample', { H: 33, A: 33, B: 30, C: 32 }, { D: 2 });
  assert.equal(run(c, `cscJudge('Crew Sample','G2').all`), 'ok', 'unscored items in a category the target does not use do not matter');
  save(c, 'G4', { H: { m: 'pct', v: 70 } });
  assert.equal(run(c, `cscJudge('Crew Sample','G4').all`), 'unset', 'a target whose categories are not all decided is on hold');
  assert.equal(run(c, `cscJudge('Nobody','G2').all`), 'blank', 'no Career Score yet is on hold');
});

test('targets: G1 aims at G2, G2 at all three G3 tracks, G3 at G4; specialists, office staff and G6 keep the old total-% rule', () => {
  const c = app();
  const ks = run(c, `['Crew Sample','Leader Sample','Server Sample','Chef Sample','Office Sample','GM Sample'].map(function(n){ var s=cscPromoState(n); return s ? s.targets.map(function(x){ return x.k; }).join('+') : null; })`);
  assert.deepEqual(ks, ['G2', 'G3-op+G3-sv+G3-kt', 'G4', null, null, null]);
});

test('saving: GM/CEO only, validated, failures are reported, history and the merge stamp are kept', () => {
  const c = app();
  for (const bad of [{ H: { m: 'pct', v: '70.55' } }, { F: { m: 'pts', v: 37 } }, { F: { m: 'pts', v: 2.5 } }, { H: { m: 'pct', v: '' } }, { H: { m: 'pct', v: 'x' } }, { H: { m: 'pct', v: 101 } }])
    assert.equal(save(c, 'G4', bad).ok, false, JSON.stringify(bad));
  assert.ok(save(c, 'G4', { H: { m: 'pct', v: '７０．５' } }).ok); assert.equal(c.STORE.cs_criteria.G4.cats.H.v, 70.5);
  assert.ok(save(c, 'G4', { H: { m: 'pct', v: 0 } }).ok); assert.equal(c.STORE.cs_criteria.G4.cats.H.v, 0, '0 is a criterion ("0 or more"), not "not set"');
  c.curRole = 'am'; assert.equal(save(c, 'G4', { H: { m: 'pct', v: 50 } }).ok, false); c.curRole = 'gm';
  c.FAIL_SET = 'cs_criteria'; const r = save(c, 'G3-op', { H: { m: 'pct', v: 50 } }); delete c.FAIL_SET;
  assert.equal(r.ok, false); assert.equal(c.STORE.cs_criteria['G3-op'], undefined);
  assert.ok(c.STORE.cs_criteria.G4._at > 0 && c.STORE.cs_criteria.G4.hist.length === 1);
});

test('an application keeps the criteria and results of that moment', () => {
  const c = app();
  save(c, 'G2', G2);
  fill(c, 'Crew Sample', { H: 33, A: 33, B: 30, C: 32 });
  const snap = run(c, `cscSnapshot('Crew Sample')`);
  save(c, 'G2', { ...G2, H: { m: 'pct', v: 99 } });
  assert.equal(snap.ok, true); assert.equal(snap.targets[0].rows[0].v, 60);
  assert.equal(run(c, `cscJudge('Crew Sample','G2').all`), 'ng');
});

const CFG = { quarter: '2026-Q3', gradeBase: { G2: 1000, G3: 3000, G4: 5000, G5: 8000, G6: 12000 } };
const prorate = (c, e, segs, ba = 1.1, sp = 1, cs = 0.9) => { c.SEGS[e.id] = segs; c.E = e; c.CFG = CFG; return run(c, `bonusProrate(E, CFG, ${ba}, ${sp}, ${cs})`); };
const WHOLE = g => [{ g, from: '2026-07-01', to: '2026-09-30', days: 92 }];

test('with no coefficients entered (all 1.0) every amount equals the v1057 formula to the cent', () => {
  const c = app();
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const titles = { G2: 'Crew Leader', G3: 'Server Leader', G4: 'Store Manager', G5: 'Area Manager', G6: 'General Manager' };
  for (let i = 0; i < 2000; i++) {
    const g = ['G2', 'G3', 'G4', 'G5', 'G6'][Math.floor(rnd() * 5)], cut = 1 + Math.floor(rnd() * 90), ba = 0.8 + rnd() * 0.4, sp = 0.8 + rnd() * 0.4, cs = 0.7 + rnd() * 0.6;
    const segs = [{ g: 'G2', from: '2026-07-01', to: 'x', days: cut }, { g, from: 'y', to: '2026-09-30', days: 92 - cut }];
    const r = prorate(c, { id: 'e' + i, g, title: titles[g] }, segs, ba, sp, cs);
    // v1057: amount = round(gradeBase × days ÷ 92 × budget × profit × Career Score) per segment
    assert.deepEqual(r.segs.map(s => s.amount), segs.map(s => Math.round(CFG.gradeBase[s.g] * s.days / 92 * ba * sp * cs)), 'case ' + i);
  }
});

test('one coefficient per segment, applied once; unknown G3 track and unset coefficients produce no amount; 0 is 0 times', () => {
  const c = app();
  c.STORE.bonus_coef = { G2: { v: 0.9, _at: 1 }, 'G3-sv': { v: 1.2, _at: 1 }, 'G3-op': { v: null, _at: 1 }, G4: { v: 0, _at: 1 } };
  let r = prorate(c, { id: 'ken', g: 'G3', title: 'Server Leader' }, [{ g: 'G2', from: '2026-07-01', to: '2026-08-10', days: 41 }, { g: 'G3', from: '2026-08-11', to: '2026-09-30', days: 51 }]);
  assert.deepEqual(r.segs.map(s => [s.coefKey, s.coef, s.amount]), [['G2', 0.9, Math.round(1000 * 41 / 92 * 0.9 * 1.1 * 0.9)], ['G3-sv', 1.2, Math.round(3000 * 51 / 92 * 1.2 * 1.1 * 0.9)]]);
  r = prorate(c, { id: 'sho', g: 'G3', title: 'Store Leader' }, WHOLE('G3'));
  assert.equal(r.blocked, 'track'); assert.equal(r.segs[0].amount, 0);
  c.BQ['2026-Q3'] = { track: { sho: { t: 'kt' } } };
  r = prorate(c, { id: 'sho', g: 'G3', title: 'Store Leader' }, WHOLE('G3'));
  assert.equal(r.blocked, null); assert.equal(r.segs[0].coefKey, 'G3-kt'); assert.equal(r.segs[0].coef, 1, 'a track chosen for the quarter; its coefficient not entered yet = 1.0');
  c.BQ = {};
  assert.equal(prorate(c, { id: 'op', g: 'G3', title: 'Operation Leader' }, WHOLE('G3')).blocked, 'coef', 'saved empty = not set');
  r = prorate(c, { id: 'sm', g: 'G4', title: 'Store Manager' }, WHOLE('G4'));
  assert.equal(r.blocked, null); assert.equal(r.segs[0].amount, 0, '0 = 0 times');
});

test('a confirmed quarter keeps the coefficients and base amounts of that moment; quarters confirmed before v1058 keep the old formula', () => {
  const c = app();
  c.BQ['2026-Q3'] = { locked: true, coefSnap: { ken: { segs: [{ g: 'G2', from: '2026-07-01', key: 'G2', v: 0.9, gb: 1000 }, { g: 'G3', from: '2026-08-11', key: 'G3-sv', track: 'sv', v: 1.2, gb: 3000 }] } } };
  c.STORE.bonus_coef = { G2: { v: 3, _at: 2 }, 'G3-sv': { v: 5, _at: 2 } };
  const cfg = { ...CFG, gradeBase: { ...CFG.gradeBase, G2: 9999, G3: 9999 } };
  c.SEGS.ken = [{ g: 'G2', from: '2026-07-01', to: '2026-08-10', days: 41 }, { g: 'G3', from: '2026-08-11', to: '2026-09-30', days: 51 }]; c.E = { id: 'ken', g: 'G3', title: 'Server Leader' }; c.CFG2 = cfg;
  let r = run(c, `bonusProrate(E, CFG2, 1.1, 1, 0.9)`);
  assert.deepEqual(r.segs.map(s => s.amount), [Math.round(1000 * 41 / 92 * 0.9 * 1.1 * 0.9), Math.round(3000 * 51 / 92 * 1.2 * 1.1 * 0.9)]);
  c.BQ['2026-Q3'] = { locked: true };   // confirmed with v1057: no coefficient record
  r = prorate(c, { id: 'sho', g: 'G3', title: 'Store Leader' }, WHOLE('G3'));
  assert.equal(r.blocked, null); assert.equal(r.segs[0].coefSrc, 'legacy'); assert.equal(r.segs[0].amount, Math.round(3000 * 1.1 * 0.9));
});

test('coefficients accept up to 3 decimals without floating-point false alarms; bad input keeps the previous value', () => {
  const c = app();
  const ok = ['2.01', '2.03', '4.02', '1.001', '1.005', '0', '20'].map(v => { run(c, `bcoefSet('G6', ${JSON.stringify(v)})`); return run(c, `bcoefGet('G6').v`); });
  assert.deepEqual(ok, [2.01, 2.03, 4.02, 1.001, 1.005, 0, 20]);
  for (const v of ['1.0005', '-1', '21', 'abc']) { run(c, `bcoefSet('G6','1.5')`); run(c, `bcoefSet('G6', ${JSON.stringify(v)})`); assert.equal(run(c, `bcoefGet('G6').v`), 1.5, v); }
  run(c, `bcoefSet('G6','')`); assert.deepEqual(run(c, `bcoefGet('G6')`).v, null, 'empty = not set');
  c.curRole = 'am'; run(c, `bcoefSet('G6','2')`); c.curRole = 'gm'; assert.equal(run(c, `bcoefGet('G6').v`), null, 'AM cannot change coefficients');
});

test('a quarter track pick can be changed or cleared, and uses the same quarter key as the proration', () => {
  const c = app();
  c.CFG = { ...CFG, quarter: '2026-Q3' };
  vm.runInContext(`function kbCfg(){ return CFG; } function bqSet(q, d){ BQ[q] = JSON.parse(JSON.stringify(d)); return true; }`, c);
  run(c, `bonusSetTrack('sho','kt')`);
  assert.equal(c.BQ['2026-Q3'].track.sho.t, 'kt');
  run(c, `bonusSetTrack('sho','op')`); assert.equal(c.BQ['2026-Q3'].track.sho.t, 'op');
  run(c, `bonusSetTrack('sho',null)`); assert.equal(c.BQ['2026-Q3'].track.sho, undefined);
  c.BQ['2026-Q3'] = { locked: true, coefSnap: { ken: {} }, track: {} };
  run(c, `bonusSetTrack('ken','op')`); assert.equal(c.BQ['2026-Q3'].track.ken, undefined, 'a confirmed person cannot be changed');
  run(c, `bonusSetTrack('late','op')`); assert.equal(c.BQ['2026-Q3'].track.late.t, 'op', 'someone not in the confirmed record can still get a track');
});

test('cs_criteria and bonus_coef are synced, merged per entry by time, and kept by storage cleanup', () => {
  assert.match(source, /'grade_hist','cs_criteria','bonus_coef','karte_pin'/);
  assert.match(source, /\n  cs_criteria:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(source, /\n  bonus_coef:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(source, /'bonus_rules','grade_hist','cs_criteria','bonus_coef','q_budgets'/);
});
