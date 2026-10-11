// v1058 (UI案37): Career Score promotion criteria by category, and grade / G3-track bonus coefficients.
// v1058 (UI案38): before a grade changes from G2 or above, GM/CEO confirm the evaluation of the previous grade's period;
// that period is prorated with it. The L4-axes condition on My page is dropped. Store Leader can no longer be chosen.
// Runs the real code from index.html (the FUNERGY_CAREER_CRITERIA block, bonusProrate and the helpers they use)
// in a VM with synthetic scores and synthetic staff. No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');   // FUNERGY_INDEX: run against another version
function block(startMark, endMark) {
  const i = source.indexOf(startMark), j = source.indexOf(endMark, i);
  assert.ok(i >= 0 && j > i, startMark);
  return source.slice(i, j + endMark.length);
}
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start + 1), line = source.slice(start + 1, lineEnd), code = line.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '');   // a one-line function may end with a /* comment */
  if (code.trimEnd().endsWith('}') && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length) return line;
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
const varBlock = (name, close) => block('\n' + (source.includes('\nconst ' + name + ' = ') ? 'const ' : 'var ') + name + ' = ', close).replace(/^\nconst /, '\nvar ');

const MODULE = block('/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */');
function app() {
  const c = { console, STORE: {}, EMPS: [], BQ: {}, SEGS: {}, curRole: 'gm', curLang: 'ja', curUserName: 'GM' };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('GRADE_TITLES', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'), varBlock('LSS_EMP_PREFIX', ';'),
    ...['ghNormG', 'lssCatsOrdered', 'lssItemId', 'getLssScores', 'gradeOf', 'empGrade', 'empSpecialistDept', 'bonusProrate', 'ghRecs', 'ghAll', 'ghCmp', 'ghDate', 'csCoef'].map(fn), MODULE].join('\n') + `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _bonusQParse(q){ var m=String(q||'').match(/(\d{4})\D*Q?([1-4])/i); return m ? { y:+m[1], q:+m[2] } : null; }
    function lsSet(k, v){ if (typeof FAIL_SET !== 'undefined' && FAIL_SET === k) return false; STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    var window = this;   // the all-or-nothing save keeps its state on window
    function _lsRawStr(k){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null; }
    function _lsWriteVerified(k, json){ STORE[k] = JSON.parse(json); return true; }
    function _lsRawDel(k){ delete STORE[k]; return true; }
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

test('unscored items put the result on hold; categories not saved use the default line (v1062); unscored items still count as 0 in the denominator', () => {
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
  const j4 = run(c, `cscJudge('Crew Sample','G4')`);
  assert.notEqual(j4.all, 'unset', 'v1062 (UI案39): a category that was not saved is judged at the default line, not left undecided');
  assert.deepEqual(j4.rows.filter(r => r.c.dflt).map(r => r.key).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 'only H was saved');
  assert.deepEqual(j4.rows.find(r => r.key === 'A').c, { m: 'pct', v: 75, dflt: true }, 'G4 default line: 75% or more');
  assert.deepEqual(j4.rows.find(r => r.key === 'H').c, { m: 'pct', v: 70 }, 'the saved line comes first');
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
// sum = the quarter's Career Score (v1062). Without it the VM has no score: the coefficient is the middle of its range.
const prorate = (c, e, segs, ba = 1.1, sp = 1, cs = 0.9, sum) => { c.SEGS[e.id] = segs; c.E = e; c.CFG = CFG; c.SUM = sum; return run(c, `bonusProrate(E, CFG, ${ba}, ${sp}, ${cs}${sum === undefined ? '' : ', SUM'})`); };
const WHOLE = g => [{ g, from: '2026-07-01', to: '2026-09-30', days: 92 }];

test('v1062: with no ranges entered (0.70–1.30), a coefficient set by the total % equals the v1061 formula to the cent; G6 is one fixed number', () => {
  const c = app();
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const titles = { G2: 'Crew Leader', G3: 'Server Leader', G4: 'Store Manager', G5: 'Area Manager', G6: 'General Manager' };
  for (let i = 0; i < 2000; i++) {
    const g = ['G2', 'G3', 'G4', 'G5', 'G6'][Math.floor(rnd() * 5)], cut = 1 + Math.floor(rnd() * 90), ba = 0.8 + rnd() * 0.4, sp = 0.8 + rnd() * 0.4, p = Math.floor(rnd() * 101);
    const segs = [{ g: 'G2', from: '2026-07-01', to: 'x', days: cut }, { g, from: 'y', to: '2026-09-30', days: 92 - cut }];
    // no category record → the total % decides (like specialists and office staff)
    const r = prorate(c, { id: 'e' + i, g, title: titles[g] }, segs, ba, sp, 0.9, { hasData: true, totalPct: p, cats: [] });
    // v1061: amount = round(gradeBase × days ÷ 92 × 1.0 × budget × profit × Career Score coefficient) per segment
    const cs = Math.round((0.7 + (1.3 - 0.7) * (Math.max(0, Math.min(100, p)) / 100)) * 100) / 100;
    assert.deepEqual(r.segs.map(s => s.amount), segs.map(s => Math.round(CFG.gradeBase[s.g] * s.days / 92 * 1 * ba * sp * (s.g === 'G6' ? 1 : cs))), 'case ' + i);
    assert.equal(r.segs[1].coef, g === 'G6' ? 1 : cs);
  }
});

test('one coefficient per segment, applied once; unknown G3 track and unset coefficients produce no amount; 0 is 0 times', () => {
  const c = app();
  c.STORE.bonus_coef_rng = { G2: { lo: 0.8, hi: 1, _at: 1 }, 'G3-sv': { lo: 1, hi: 1.4, _at: 1 }, 'G3-op': { lo: null, hi: null, _at: 1 }, G4: { lo: 0, hi: 0, _at: 1 } };
  let r = prorate(c, { id: 'ken', g: 'G3', title: 'Server Leader' }, [{ g: 'G2', from: '2026-07-01', to: '2026-08-10', days: 41 }, { g: 'G3', from: '2026-08-11', to: '2026-09-30', days: 51 }]);
  // no Career Score → the middle of each range; the Career Score coefficient (0.9 passed in) is no longer applied
  assert.deepEqual(r.segs.map(s => [s.coefKey, s.coef, s.csCoef, s.amount]), [['G2', 0.9, 1, Math.round(1000 * 41 / 92 * 1 * 1.1 * 1 * 0.9)], ['G3-sv', 1.2, 1, Math.round(3000 * 51 / 92 * 1 * 1.1 * 1 * 1.2)]]);
  r = prorate(c, { id: 'sho', g: 'G3', title: 'Store Leader' }, WHOLE('G3'));
  assert.equal(r.blocked, 'track'); assert.equal(r.segs[0].amount, 0);
  c.STORE.bonus_track = { '2026-Q3|sho': { t: 'kt', _at: 1 } };
  r = prorate(c, { id: 'sho', g: 'G3', title: 'Store Leader' }, WHOLE('G3'));
  assert.equal(r.blocked, null); assert.equal(r.segs[0].coefKey, 'G3-kt'); assert.equal(r.segs[0].coef, 1, 'a track chosen for the quarter; its coefficient not entered yet = 1.0');
  delete c.STORE.bonus_track;
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

test('v1062: coefficient ranges accept up to 2 decimals without floating-point false alarms; lower ≤ upper; G6 is one number; bad input keeps the previous value', () => {
  const c = app();
  const rg = k => { const r = run(c, `bcoefRange(${JSON.stringify(k)})`); return [r.lo, r.hi, r.src]; };
  assert.deepEqual(rg('G2'), [0.7, 1.3, 'migrated'], 'nothing entered: 0.70–1.30');
  assert.deepEqual(rg('G6'), [1, 1, 'migrated'], 'G6: one number, 1.00');
  const ok = ['2.01', '2.03', '4.02', '0.07', '0', '20'].map(v => { run(c, `bcoefSetRange('G6','lo', ${JSON.stringify(v)})`); return rg('G6').slice(0, 2); });
  assert.deepEqual(ok, [[2.01, 2.01], [2.03, 2.03], [4.02, 4.02], [0.07, 0.07], [0, 0], [20, 20]], 'G6 keeps lower = upper');
  run(c, `bcoefSetRange('G2','lo','0.85')`); run(c, `bcoefSetRange('G2','hi','1.15')`);
  assert.deepEqual(rg('G2'), [0.85, 1.15, 'set']);
  assert.equal(c.STORE.bonus_coef, undefined, 'ranges are kept in bonus_coef_rng; devices still on v1058–v1061 keep their own bonus_coef');
  for (const [w, v] of [['lo', '0.855'], ['lo', '-1'], ['hi', '21'], ['hi', 'abc'], ['lo', '1.2'], ['hi', '0.5']]) {
    run(c, `bcoefSetRange('G2', ${JSON.stringify(w)}, ${JSON.stringify(v)})`); assert.deepEqual(rg('G2'), [0.85, 1.15, 'set'], w + ' ' + v);
  }
  assert.equal(c.STORE.bonus_coef_rng.G2.hist.length, 2, 'history of the two saves');
  run(c, `bcoefSetRange('G4','hi','')`); assert.deepEqual(rg('G4'), [null, null, 'unset'], 'empty = not set');
  c.E = { id: 'sm', g: 'G4', title: 'Store Manager' };
  assert.equal(run(c, `bonusCoefFor(E,'G4',{},null,'2026-Q3').blocked`), 'coef', 'not set = no amount');
  c.curRole = 'am'; run(c, `bcoefSetRange('G4','lo','1')`); c.curRole = 'gm'; assert.deepEqual(rg('G4'), [null, null, 'unset'], 'AM cannot change coefficients');
  c.STORE.bonus_coef = { G5: { v: 1.2, _at: 1 } };   // entered with v1058–v1061 (one number)
  assert.deepEqual(rg('G5'), [0.84, 1.56, 'from-v'], 'an old single coefficient becomes v × 0.70 – v × 1.30');
});

test('a quarter track pick can be changed or cleared, and uses the same quarter key as the proration', () => {
  const c = app();
  c.CFG = { ...CFG, quarter: '2026-Q3' };
  vm.runInContext(`function kbCfg(){ return CFG; } function bqSet(q, d){ BQ[q] = JSON.parse(JSON.stringify(d)); return true; }`, c);
  run(c, `bonusSetTrack('sho','kt')`);
  assert.equal(c.STORE.bonus_track['2026-Q3|sho'].t, 'kt', 'stored per quarter and person, outside the quarter record');
  run(c, `bonusSetTrack('sho','op')`); assert.equal(c.STORE.bonus_track['2026-Q3|sho'].t, 'op');
  const at = c.STORE.bonus_track['2026-Q3|sho']._at;
  run(c, `bonusSetTrack('sho',null)`); assert.equal(c.STORE.bonus_track['2026-Q3|sho'].t, null, 'cleared = "none" with a newer time, not deleted');
  assert.ok(c.STORE.bonus_track['2026-Q3|sho']._at > at);
  c.BQ['2026-Q3'] = { locked: true, coefSnap: { ken: {} } };
  run(c, `bonusSetTrack('ken','op')`); assert.equal(c.STORE.bonus_track['2026-Q3|ken'], undefined, 'a confirmed person cannot be changed');
  run(c, `bonusSetTrack('late','op')`); assert.equal(c.STORE.bonus_track['2026-Q3|late'].t, 'op', 'someone not in the confirmed record can still get a track');
});

test('cs_criteria and bonus_coef are synced, merged per entry by time, and kept by storage cleanup', () => {
  assert.match(source, /'grade_hist','cs_criteria','bonus_coef','bonus_track','bonus_coef_rng','karte_pin'/);
  assert.match(source, /\n  bonus_track:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(source, /\n  cs_criteria:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(source, /\n  bonus_coef:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(source, /'bonus_rules','grade_hist','cs_criteria','bonus_coef','bonus_track','bonus_coef_rng','q_budgets'/);
});

/* ------------------------------------------------------------------ UI案38 */
// The real grade-history, approval and Leader-promotion code with the module, a stubbed modal and synthetic staff.
function app38() {
  const names = [...new Set([...source.matchAll(/\nfunction (_?gh\w*)\(/g)].map(m => m[1]))].concat(['gradeOf', 'empGrade', 'gradeNum', 'csCoef', 'lssCatsOrdered', 'lssItemId', 'getLssScores',
    'empSpecialistDept', 'bonusProrate', 'bonusSegs', 'saveEmp', 'mergeMapByTime', '_recAt', 'approveLssRequest', 'approveAdvance', 'advanceStage', 'jobTitle', 'getDevData', 'setDevData', 'getStage', 'getLssRequests', 'stageLabel', 'getCareerTrack']);
  const c = { console, STORE: {}, EMPS: [], BQ: {}, SUMS: {}, MODAL: [], TOASTS: [], CONFIRMS: 0, curRole: 'gm', curLang: 'ja', curUserName: 'GM' };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('GRADE_TITLES', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'), varBlock('LSS_EMP_PREFIX', ';'), varBlock('JOB_TITLES', '\n];'),
    varBlock('CAREER_CONFIG', '\n};'), varBlock('CAREER_TRACKS', ';'), varBlock('LSS_TITLES', ';'), source.match(/\nObject\.defineProperty\(CAREER_CONFIG, 'Store Leader'[^\n]*/)[0],
    ...names.map(fn), MODULE].join('\n') + `
    var window = this, curPage = 'x', FORM = {}, document = { getElementById: function(id){ return FORM[id] || null; }, querySelectorAll: function(){ return []; } };
    function canEditWages(){ return false; } function permFromRole(r){ return r; } function getWorkCondition(){ return {}; } function setWorkCondition(){} function saveEmpPrivate(){} function alert(){}
    var CAREER_STAGES = [{ n:5, label:'Leader' }, { n:6, label:'Career Score' }];
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    // like the real lsSet: a local failure (FAIL_SET) still sends the value to sync
    var PUSHES = [];
    function lsSet(k, v){ var ok = !(typeof FAIL_SET !== 'undefined' && FAIL_SET === k); if (ok) STORE[k] = JSON.parse(JSON.stringify(v)); _pushWithOutbox(k, v); return ok; }
    function _pushWithOutbox(k){ PUSHES.push(k); }
    function _lsRawStr(k){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null; }
    function _lsWriteVerified(k, json){ STORE[k] = JSON.parse(json); return true; }
    function _lsRawDel(k){ delete STORE[k]; return true; }
    function _bonusQParse(q){ var m=String(q||'').match(/(\\d{4})\\D*Q?([1-4])/i); return m ? { y:+m[1], q:+m[2] } : null; }
    function t(a, b){ return curLang === 'en' ? b : a; }
    function escapeHtml(s){ return String(s == null ? '' : s); }
    function nowJP(){ return '2026/08/20 09:00'; } function todayJP(){ return '2026/08/20'; } function bizToday(){ return '2026-08-20'; } function myName(){ return curRole === 'am' ? 'AM' : 'GM'; }
    var ROLE_CONFIG = { gm:{ name:'GM' }, am:{ name:'AM' } };
    function getEmployees(){ return EMPS; } function ocsOldLocked(){ return false; } function getKarte(){ return {}; }
    function kbCfg(){ return { quarter:'2026-Q3', gradeBase:{ G2:1000, G3:3000, G4:5000, G5:8000, G6:12000 }, csMin:0.7, csMax:1.3 }; }
    function lssSummary(n){ return SUMS[n] || { cats:[], totalScore:0, totalMax:0, totalPct:0, hasData:false }; }
    function bqGet(q){ return Object.assign({ locked:false, csFreeze:{} }, BQ[q] || {}); }
    function openModal(h){ MODAL.push(h); } function closeModalDirect(){} function showToast(m){ TOASTS.push(m); } function renderPage(){}
    function confirm(){ CONFIRMS++; return true; } function stageReadiness(){ return {}; } function inferStage(){ return 1; } function openLssDetail(){}
    function _bqNow(){ return '2026/08/20 09:00'; } function _bqWho(){ return 'GM'; } function karteRerender(){}`, c);
  const S = pct => ({ hasData: true, totalPct: pct, totalScore: pct * 3, totalMax: 300, cats: [{ key: 'H', name: 'H', score: pct, max: 100, pct }] });
  c.EMPS = [{ id: 'ken', name: 'Ken Sample', title: 'Server Leader', role: 'sl' }, { id: 'sho', name: 'Sho Sample', title: 'Store Leader', role: 'sl' },
            { id: 'amy', name: 'Amy Sample', title: 'Crew Leader', role: 'crew' }, { id: 'bob', name: 'Bob Sample', title: 'Crew', role: 'crew' },
            { id: 'neo', name: 'Neo Sample', title: 'Kitchen Leader', role: 'sl' }, { id: 'cal', name: 'Cal Sample', title: 'Crew Leader', role: 'crew' }];
  c.SUMS = { 'Ken Sample': S(72), 'Sho Sample': S(64), 'Amy Sample': S(81), 'Cal Sample': S(77) };
  c.S = S;
  return c;
}
const lastModal = c => c.MODAL[c.MODAL.length - 1] || '';

test('UI案38: a grade change from G2 or above waits until GM/CEO confirm the evaluation of the previous grade; the record keeps it', () => {
  const c = app38();
  const need = (a, b) => run(c, `ghEvalNeeded({ g0:${JSON.stringify(a)}, g1:${JSON.stringify(b)} })`);
  assert.deepEqual([need('G2', 'G3'), need('G3', 'G4'), need('G4', 'G3'), need('G2', 'G1'), need('G1', 'G2'), need('G3', 'G3')], [true, true, true, true, false, false]);
  assert.equal(run(c, `ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' })`), true);
  assert.match(lastModal(c), /G3 の期間の評価を確定（日割り）/);
  assert.match(lastModal(c), /disabled[^>]*><i class="ti ti-lock"><\/i> G3 の期間の評価を確定してから保存/, 'save is disabled until confirmed');
  assert.deepEqual(run(c, `(function(){ var p=ghEvalPeriod(window._ghPend); return [p.from, p.to, p.days, p.next]; })()`), ['2026-07-01', '2026-08-20', 51, '2026-08-21']);
  run(c, `ghConfirmSave()`);
  assert.equal(run(c, `window._ghPend.ok`), false, 'save refuses before the evaluation is confirmed');
  c.curRole = 'am'; run(c, `ghEvalConfirm()`);
  assert.equal(run(c, `window._ghPend.ev`), null, 'AM cannot confirm');
  assert.doesNotMatch(run(c, `ghConfirmHtml(window._ghPend)`), /onclick="ghEvalConfirm\(\)"/, 'AM has no confirm button');
  c.curRole = 'gm'; run(c, `ghEvalConfirm()`);
  assert.deepEqual(run(c, `(function(){ var e=window._ghPend.ev; return [e.g, e.track, e.csPct, e.by]; })()`), ['G3', 'sv', 72, 'GM']);
  c.SUMS['Ken Sample'] = c.S(95);
  // same order as ghConfirmSave: check the date and fix the period against the history before the grade changes, then save and record
  run(c, `(function(){ var p=window._ghPend; if(ghEvalStop(p)) throw new Error(ghEvalStop(p)); p.period=ghEvalPeriod(p); p.ok=true; EMPS[0].title='Store Manager'; ghAfterSaveEmp('ken', { name:'Ken Sample' }, EMPS); })()`);
  const r = run(c, `ghRecs('ken')`)[0];
  assert.deepEqual([r.d, r.g, r.from, r.src], ['2026-08-20', 'G4', 'G3', 'title']);
  assert.deepEqual([r.prevEval.g, r.prevEval.track, r.prevEval.csPct, r.prevEval.from, r.prevEval.to, r.prevEval.days], ['G3', 'sv', 72, '2026-07-01', '2026-08-20', 51], 'the confirmed score stays even if the score rises later');
});

test('UI案38: no Career Score means no confirmation; a G3 whose track the title does not give must pick one', () => {
  const c = app38();
  run(c, `ghBeforeSaveEmp('neo', { name:'Neo Sample', title:'Store Manager', role:'sl' })`);
  assert.match(lastModal(c), /まだ評価がありません/);
  assert.doesNotMatch(lastModal(c), /onclick="ghEvalConfirm\(\)"/);
  run(c, `ghEvalConfirm()`); assert.equal(run(c, `window._ghPend.ev`), null);
  run(c, `ghConfirmCancel(); ghBeforeSaveEmp('sho', { name:'Sho Sample', title:'Store Manager', role:'sl' })`);
  run(c, `ghEvalConfirm()`); assert.equal(run(c, `window._ghPend.ev`), null, 'Store Leader gives no track: pick first');
  run(c, `ghEvalSetTrack('op'); ghEvalConfirm()`); assert.equal(run(c, `window._ghPend.ev.track`), 'op');
});

test('UI案38: the previous grade period uses the confirmed evaluation; the new grade uses the quarter; confirmed quarters do not move', () => {
  const c = app38();
  c.STORE.grade_hist = { ken: { recs: [{ id: 'r1', d: '2026-08-20', g: 'G4', from: 'G3', start: false, src: 'title', prevEval: { g: 'G3', track: 'kt', csPct: 50 } }], _at: 1 } };
  c.EMPS[0].title = 'Store Manager'; c.E = c.EMPS[0];
  const cfg = run(c, 'kbCfg()'), cs50 = Math.round((0.7 + 0.6 * 0.5) * 100) / 100;
  let b = run(c, `bonusProrate(E, kbCfg(), 1, 1, 1.2)`);
  // v1062: the Career Score sets where the coefficient falls in its range (0.70–1.30); the 1.2 passed in is not applied any more.
  // G3: the confirmed evaluation has no category record → its total 50% → the middle (1.00).
  // G4: the quarter score (only H 72/100 recorded) against the G4 default line 75% → 0 of 8 categories → the lower end (0.70).
  assert.deepEqual(b.segs.map(s => [s.g, s.days, s.coefKey, s.coef, s.cm.mode, s.cm.src, s.csCoef, s.amount]),
    [['G3', 51, 'G3-kt', cs50, 'pct', 'grade', 1, Math.round(3000 * 51 / 92 * 1 * 1 * 1 * cs50)], ['G4', 41, 'G4', 0.7, 'cat', 'q', 1, Math.round(5000 * 41 / 92 * 1 * 1 * 1 * 0.7)]],
    'G3 7/1–8/20 at the confirmed 50% (and the confirmed kitchen track, no quarter pick needed); G4 8/21–9/30 at the quarter score');
  assert.equal(cfg.csMin, 0.7);
  const snap = run(c, `bonusCoefSnapFor(E, kbCfg(), {})`);
  assert.deepEqual(snap.segs.map(s => s.csPct), [50, null], 'confirming the quarter records the segment score');
  assert.deepEqual(snap.segs.map(s => [s.lo, s.hi, s.v, s.cm.mode]), [[0.7, 1.3, cs50, 'pct'], [0.7, 1.3, 0.7, 'cat']], 'and the range, the coefficient and how it was set');
  c.BQ['2026-Q3'] = { locked: true };
  b = run(c, `bonusProrate(E, kbCfg(), 1, 1, 1.2)`);
  assert.deepEqual(b.segs.map(s => s.csCoef), [1.2, 1.2], 'a quarter confirmed before v1058 keeps the quarter score for every segment');
});

test('UI案38: promotion approval and Leader promotion wait for the evaluation; G1 changes and rejections do not', () => {
  const c = app38();
  c.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' },
                          { id: 'r2', name: 'Bob Sample', kind: 'promo', wantTitle: 'Crew Leader', status: '申請中' }];
  run(c, `approveLssRequest('r1','承認')`);
  assert.equal(c.STORE.lss_requests[0].status, '申請中', 'not approved yet');
  assert.equal(c.EMPS[2].title, 'Crew Leader');
  assert.match(lastModal(c), /昇格申請を承認します/);
  run(c, `ghEvalConfirm(); window._ghPend.d='2026-08-15'; ghConfirmGo();`);
  const r = run(c, `ghRecs('amy')`)[0];
  assert.equal(c.STORE.lss_requests[0].status, '承認'); assert.equal(c.EMPS[2].title, 'Kitchen Leader');
  assert.deepEqual([r.d, r.src, r.prevEval.g, r.prevEval.csPct], ['2026-08-15', 'promo', 'G2', 81]);
  assert.equal(run(c, `window._ghPend`), null, 'the confirmation is used once');
  const n = c.MODAL.length; run(c, `approveLssRequest('r2','承認')`);
  assert.equal(c.STORE.lss_requests[1].status, '承認'); assert.equal(c.MODAL.length, n, 'G1 → G2 approves as before');
  c.STORE.dev_data = { 'Cal Sample': { stage: 5, targetCareer: 'Store Leader', stageHistory: [] } };
  run(c, `approveAdvance('Cal Sample')`);
  assert.equal(run(c, `getDevData('Cal Sample').stage`), 5); assert.equal(c.CONFIRMS, 0);
  assert.equal(run(c, `window._ghPend.t1`), 'Operation Leader', 'the abolished Store Leader target becomes Operation Leader');
  run(c, `ghEvalConfirm(); ghConfirmGo();`);
  assert.equal(c.EMPS[5].title, 'Operation Leader'); assert.equal(run(c, `getDevData('Cal Sample').stage`), 6); assert.equal(c.CONFIRMS, 0);
  assert.equal(run(c, `ghRecs('cal')`)[0].prevEval.csPct, 77);
});

test('UI案38: a confirmation made for an approval is never reused for an employee-master change', () => {
  const c = app38();
  run(c, `window._ghPend = { kind:'approve', key:'zz', empId:'ken', g0:'G3', g1:'G4', ok:true, ev:{ g:'G3' }, d:'2026-08-01' }`);
  assert.equal(run(c, `ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' })`), true);
  assert.equal(run(c, `window._ghPend.kind`), 'emp'); assert.equal(run(c, `window._ghPend.ev`), null);
});

test('UI案38: My page promotion button no longer needs all axes at L4; Store Leader cannot be chosen', () => {
  const c = app38();
  vm.runInContext(`var OK=true; cscPromoState=function(n){ return n==='Amy Sample' ? { ok:OK, targets:[] } : null; }; lssEligibility=function(){ return { pct:85, hasData:true, promo:{ ok:false, min:80 } }; };`, c);
  assert.equal(run(c, `cscMyCanApply('Amy Sample', { ojtOk:true, axesOk:false, can:false })`), true, 'axes below L4, OJT done, criteria met');
  assert.equal(run(c, `cscMyCanApply('Amy Sample', { ojtOk:false, axesOk:true, can:false })`), false, 'OJT still required');
  assert.equal(run(c, `cscMyCanApply('Dan Sample', { ojtOk:true, axesOk:true, can:true })`), false, 'others use the total % (not met here)');
  assert.doesNotMatch(fn('renderMypage'), /t\('担当軸すべてL4'/, 'the L4 line is gone');
  assert.match(fn('renderMypage'), /cscMyCanApply\(me, gpe\)/);
  assert.equal(run(c, `Object.keys(CAREER_CONFIG).join()`), 'Server Leader,Kitchen Leader,Operation Leader');
  assert.equal(run(c, `CAREER_TRACKS.join()`), 'Server Leader,Kitchen Leader,Operation Leader');
  c.STORE.career_track = { X: 'Store Leader' };
  assert.equal(run(c, `getCareerTrack('X')`), 'Operation Leader');
  assert.match(fn('openLssApply'), /LSS_TITLES\.filter\(t=>t!=='Store Leader'\)/);
  assert.match(fn('openEmpModal'), /JOB_TITLES\.filter\(t=>t\.key!=='Store Leader'\|\|e\.title===t\.key\)/);
});

test('UI案38: the decision date must match the grade history; a same-day record keeps the evaluation; an old Store Leader request gets Operation Leader', () => {
  const c = app38();
  c.STORE.grade_hist = { ken: { recs: [{ id: 'k1', d: '2026-08-15', g: 'G3', from: 'G2', start: false, src: 'title' }], _at: 1 } };
  run(c, `ghBeforeSaveEmp('ken', { name:'Ken Sample', title:'Store Manager', role:'sl' }); window._ghPend.d='2026-08-10'; ghEvalConfirm();`);
  assert.match(run(c, `ghEvalPeriod(window._ghPend)`).err, /8\/16 以降/, 'a date before the last record is not turned into a guessed period');
  assert.equal(run(c, `window._ghPend.ev`), null, 'and cannot be confirmed');
  run(c, `window._ghPend.d='2026-08-25'; ghEvalConfirm();`);
  assert.deepEqual(run(c, `(function(){ var p=ghEvalPeriod(window._ghPend); return [p.from, p.days, window._ghPend.ev.csPct]; })()`), ['2026-08-16', 10, 72]);
  run(c, `window._ghPend.d='2026-08-12'`);
  assert.match(run(c, `ghEvalStop(window._ghPend)`), /より後の日/, 'moving the date back after confirming stops the save again');
  run(c, `ghConfirmCancel()`);
  c.STORE.grade_hist.ken.recs.push({ id: 'k2', d: '2026-08-30', g: 'G4', from: 'G3', start: false, src: 'manual' });
  run(c, `ghAddRecEval('ken', { d:'2026-08-30', g:'G4', from:'G3', start:false, src:'title', prevEval:{ g:'G3', csPct:72 } }, 'Ken Sample')`);
  const same = run(c, `ghRecs('ken')`).filter(r => r.d === '2026-08-30');
  assert.equal(same.length, 1); assert.equal(same[0].prevEval.csPct, 72, 'the evaluation is added to the existing record, not dropped');
  c.STORE.grade_hist.amy = { recs: [{ id: 'a1', d: '2026-08-15', g: 'G1', from: 'G2', start: false, src: 'manual' }], _at: 1 };   // history says G1 since 8/16, the title says G2
  run(c, `ghConfirmCancel(); ghBeforeSaveEmp('amy', { name:'Amy Sample', title:'Kitchen Leader', role:'sl' }); window._ghPend.d='2026-08-20'; ghEvalConfirm();`);
  assert.match(run(c, `ghEvalPeriod(window._ghPend)`).err, /G2 になっていません/, 'history and title disagree: no guessed period');
  assert.equal(run(c, `window._ghPend.ev`), null);
  run(c, `ghConfirmCancel()`);
  c.EMPS.push({ id: 'zed', name: 'Zed Sample', title: 'Crew', role: 'crew' });
  c.STORE.lss_requests = [{ id: 'r9', name: 'Zed Sample', kind: 'promo', wantTitle: 'Store Leader', status: '申請中' }];
  run(c, `approveLssRequest('r9','承認')`);
  assert.equal(c.EMPS.find(x => x.id === 'zed').title, 'Operation Leader');
});

/* ------------------------------------------------------------------ Codex review of b215fd4 */
// P1: a grade change saves the title, the grade-history record (with the evaluation), the request status and the
// development stage together. If any of them cannot be saved, all of them stay as they were and nothing is sent to sync.
function storeBacked(c) {
  vm.runInContext(`getEmployees = function(){ return Object.prototype.hasOwnProperty.call(STORE, 'm_employees') ? JSON.parse(JSON.stringify(STORE.m_employees)) : EMPS; };`, c);
  c.STORE.m_employees = JSON.parse(JSON.stringify(c.EMPS));
  return c;
}
const empOf = (c, id) => c.STORE.m_employees.find(x => x.id === id);
const EMP_FORM = { 'e-name': { value: 'Ken Sample' }, 'e-code': { value: '' }, 'e-role': { value: 'sl' }, 'e-store': { value: 'F01' }, 'e-emp': { value: '正社員' }, 'e-step': { value: '1' },
  'e-hire': { value: '2024-01-01' }, 'e-resign': { value: '' }, 'e-status': { value: '在籍' }, 'e-email': { value: '' }, 'e-phone': { value: '' }, 'e-insurance': { checked: false },
  'e-dental': { checked: false }, 'e-title': { value: 'Store Manager' }, 'e-wc-maxh': { value: '40' } };

test('Codex P1: employee master — if the title or the grade history cannot be saved, neither changes and nothing is sent to sync', () => {
  for (const fail of ['grade_hist', 'm_employees', null]) {
    const c = storeBacked(app38()); c.FORM = EMP_FORM;
    run(c, `saveEmp('ken')`);
    run(c, `ghEvalConfirm(); (function(){ var p=window._ghPend; p.d='2026-08-20'; p.period=ghEvalPeriod(p); p.ok=true; })();`);   // what ghConfirmSave does
    c.PUSHES.length = 0; c.TOASTS.length = 0; if (fail) c.FAIL_SET = fail;
    run(c, `saveEmp('ken')`); delete c.FAIL_SET;
    const toasts = c.TOASTS.join(' | ');
    if (fail) {
      assert.equal(empOf(c, 'ken').title, 'Server Leader', fail);
      assert.equal(c.STORE.grade_hist, undefined, fail);
      assert.deepEqual([...c.PUSHES], [], fail + ': nothing sent to sync');
      assert.match(toasts, /保存できませんでした。役職とグレード履歴は元のまま/); assert.doesNotMatch(toasts, /更新しました/);
    } else {
      assert.equal(empOf(c, 'ken').title, 'Store Manager');
      assert.equal(c.STORE.grade_hist.ken.recs[0].prevEval.csPct, 72);
      assert.ok(c.PUSHES.includes('m_employees') && c.PUSHES.includes('grade_hist'));
    }
  }
});

test('Codex P1: promotion approval and Leader promotion are all-or-nothing (request status / stage, title, grade history)', () => {
  for (const fail of ['grade_hist', 'm_employees', 'lss_requests', null]) {
    const c = storeBacked(app38());
    c.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
    run(c, `approveLssRequest('r1','承認'); ghEvalConfirm();`);
    c.PUSHES.length = 0; c.TOASTS.length = 0; if (fail) c.FAIL_SET = fail;
    run(c, `ghConfirmGo()`); delete c.FAIL_SET;
    if (fail) {
      assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, c.STORE.grade_hist, [...c.PUSHES]], ['申請中', 'Crew Leader', undefined, []], fail);
      assert.match(c.TOASTS.join(), /承認・役職・グレード履歴は元のまま/);
    } else {
      assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, c.STORE.grade_hist.amy.recs[0].prevEval.csPct], ['承認', 'Kitchen Leader', 81]);
      assert.ok(['lss_requests', 'm_employees', 'grade_hist'].every(k => c.PUSHES.includes(k)));
    }
  }
  for (const fail of ['grade_hist', 'm_employees', 'dev_data', 'career_history', null]) {
    const c = storeBacked(app38());
    c.STORE.dev_data = { 'Cal Sample': { stage: 5, targetCareer: 'Operation Leader', stageHistory: [] } };
    run(c, `approveAdvance('Cal Sample'); ghEvalConfirm();`);
    c.PUSHES.length = 0; c.TOASTS.length = 0; if (fail) c.FAIL_SET = fail;
    run(c, `ghConfirmGo()`); delete c.FAIL_SET;
    if (fail) {
      assert.deepEqual([c.STORE.dev_data['Cal Sample'].stage, empOf(c, 'cal').title, c.STORE.grade_hist, c.STORE.career_history, [...c.PUSHES]], [5, 'Crew Leader', undefined, undefined, []], fail);
      assert.match(c.TOASTS.join(), /ステージ・役職・グレード履歴は元のまま/);
    } else {
      assert.deepEqual([c.STORE.dev_data['Cal Sample'].stage, empOf(c, 'cal').title, c.STORE.grade_hist.cal.recs[0].prevEval.csPct], [6, 'Operation Leader', 77]);
      assert.ok(['dev_data', 'm_employees', 'grade_hist', 'career_history'].every(k => c.PUSHES.includes(k)));
    }
  }
  const c = storeBacked(app38());
  c.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
  run(c, `approveLssRequest('r1','承認'); ghEvalConfirm(); var _ar=ghAddRecEval; ghAddRecEval=function(){ throw new Error('boom'); }; void 0;`);
  c.PUSHES.length = 0; run(c, `ghConfirmGo(); ghAddRecEval=_ar; void 0;`);
  assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, [...c.PUSHES]], ['申請中', 'Crew Leader', []], 'an exception in the middle rolls back too');
});

test('Codex/Claude P2: G3 track picks for different people on different devices both survive the merge; clearing and re-picking win by time', () => {
  const A = app38(), B = app38();
  run(A, `bonusSetTrack('alice','sv')`); run(B, `bonusSetTrack('bob','kt')`);
  const cloud1 = run(A, `mergeMapByTime(${JSON.stringify(B.STORE.bonus_track)}, STORE.bonus_track)`);
  assert.deepEqual([cloud1['2026-Q3|alice'].t, cloud1['2026-Q3|bob'].t], ['sv', 'kt']);
  run(A, `bonusSetTrack('alice', null)`);
  for (const merged of [run(A, `mergeMapByTime(${JSON.stringify(cloud1)}, STORE.bonus_track)`), run(A, `mergeMapByTime(STORE.bonus_track, ${JSON.stringify(cloud1)})`)])
    assert.deepEqual([merged['2026-Q3|alice'].t, merged['2026-Q3|bob'].t], [null, 'kt'], 'the clear wins in both merge directions and Bob stays');
  const cloud2 = run(A, `mergeMapByTime(${JSON.stringify(cloud1)}, STORE.bonus_track)`);
  A.STORE.bonus_track = cloud2; run(A, `bonusSetTrack('alice','op')`);
  assert.equal(run(A, `mergeMapByTime(${JSON.stringify(cloud2)}, STORE.bonus_track)`)['2026-Q3|alice'].t, 'op', 're-picking after a clear wins');
  assert.equal(run(A, `bonusTrackFor({ id:'alice', title:'Crew Leader' }, '2026-Q3').t`), 'op');
  assert.equal(run(A, `btrGet('2026-Q4','bob')`), null, 'another quarter is separate');
});

test('re-review P3: a track pick that cannot be saved is not sent to sync; a grade-history record that silently fails rolls back; the failure banner is cleared after a rollback', () => {
  const A = app38();
  A.FAIL_SET = 'bonus_track'; A.PUSHES.length = 0; A.TOASTS.length = 0;
  run(A, `bonusSetTrack('alice','sv')`); delete A.FAIL_SET;
  assert.deepEqual([[...A.PUSHES], A.STORE.bonus_track], [[], undefined]);
  assert.match(A.TOASTS.join(), /保存できませんでした/);
  run(A, `bonusSetTrack('alice','sv')`);
  assert.ok(A.PUSHES.includes('bonus_track'), 'saved normally afterwards');

  const c = storeBacked(app38());
  c.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
  run(c, `approveLssRequest('r1','承認'); ghEvalConfirm(); var _gar=ghAddRec; ghAddRec=function(){ return false; }; void 0;`);   // no lsSet failure, just no record
  c.PUSHES.length = 0; run(c, `ghConfirmGo(); ghAddRec=_gar; void 0;`);
  assert.deepEqual([c.STORE.lss_requests[0].status, empOf(c, 'amy').title, [...c.PUSHES]], ['申請中', 'Crew Leader', []]);

  const d = storeBacked(app38());
  vm.runInContext(`var CLEARED=[]; function _lsClearSaveFailure(k){ CLEARED.push(k); }`, d);
  d.STORE.lss_requests = [{ id: 'r1', name: 'Amy Sample', kind: 'promo', wantTitle: 'Kitchen Leader', status: '申請中' }];
  run(d, `approveLssRequest('r1','承認'); ghEvalConfirm();`);
  d.FAIL_SET = 'grade_hist'; run(d, `ghConfirmGo()`); delete d.FAIL_SET;
  assert.ok(d.CLEARED.includes('grade_hist'), 'the "not saved on this device" mark is cleared once everything is back');
});
