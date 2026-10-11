// v1062 (UI案39・Moto 10/10): growth-chart settings tab.
// The grade/track coefficient is a range (lower–upper). Where it falls is set by the Career Score: for store tracks, the share of the
// categories used that meet their base line (the same lines as the promotion criteria; categories not saved use a default line);
// specialists and office staff use the total %; no score = the middle. G6 is one fixed number. A confirmed quarter keeps its record.
// Runs the real code from index.html (the FUNERGY_CAREER_CRITERIA block, bonusProrate, storeProfitOf and the helpers they use)
// in a VM with synthetic staff and scores. No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function block(startMark, endMark) {
  const i = source.indexOf(startMark), j = source.indexOf(endMark, i);
  assert.ok(i >= 0 && j > i, startMark);
  return source.slice(i, j + endMark.length);
}
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start + 1), line = source.slice(start + 1, lineEnd), code = line.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '');
  if (code.trimEnd().endsWith('}') && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length) return line;
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
const varBlock = (name, close) => block('\n' + (source.includes('\nconst ' + name + ' = ') ? 'const ' : 'var ') + name + ' = ', close).replace(/^\nconst /, '\nvar ');
const MODULE = block('/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */');

function app() {
  const c = { console, STORE: {}, EMPS: [], BQ: {}, SEGS: {}, SUMS: {}, MODAL: [], TOASTS: [], RERENDER: 0, CONFIRM: true, curRole: 'gm', curLang: 'ja', curUserName: 'GM' };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('GRADE_TITLES', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'), varBlock('LSS_EMP_PREFIX', ';'),
    ...['ghNormG', 'lssCatsOrdered', 'lssItemId', 'getLssScores', 'gradeOf', 'empGrade', 'empSpecialistDept', 'bonusProrate', 'ghRecs', 'ghAll', 'ghCmp', 'ghDate', 'csCoef', 'storeProfitOf', 'ghMD'].map(fn), MODULE].join('\n') + `
    var window = this;
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ if (typeof FAIL_SET !== 'undefined' && FAIL_SET === k) return false; STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function _bonusQParse(q){ var m=String(q||'').match(/(\\d{4})\\D*Q?([1-4])/i); return m ? { y:+m[1], q:+m[2] } : null; }
    function t(a, b){ return curLang === 'en' ? b : a; }
    function escapeHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function nowJP(){ return '2026/10/10 18:00'; } function myName(){ return 'GM'; } var ROLE_CONFIG = { gm:{ name:'GM' } };
    function getEmployees(){ return EMPS; } function ocsOldLocked(){ return false; }
    function _bqNow(){ return '2026/10/10 18:00'; } function _bqWho(){ return 'GM'; }
    function showToast(m, k){ TOASTS.push([m, k]); } function kbRefresh(){} function karteRerender(){ RERENDER++; }
    function openModal(h){ MODAL.push(h); } function closeModalDirect(){} function confirm(){ return CONFIRM; } function renderPage(){}
    function lssSummary(n){ return SUMS[n] || null; }
    function ghBadge(g){ return '[' + g + ']'; } function _money(n){ return '$' + Math.round(n); }
    var QR = { q:'2026-Q3', qs:'2026-07-01', qe:'2026-09-30', n:92 };
    function ghQRange(q){ return q === QR.q ? QR : null; } function ghQOf(){ return QR.q; }
    function bqGet(q){ return Object.assign({ locked:false, csFreeze:{} }, BQ[q] || {}); }
    function bonusSegs(e){ return (SEGS[e.id] || [{ g:ghNormG(empGrade(e)), from:QR.qs, to:QR.qe, days:QR.n }]).map(function(x){ return Object.assign({}, x); }); }`, c);
  return c;
}
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
const CFG = { quarter: '2026-Q3', gradeBase: { G2: 1000, G3: 3000, G4: 5000, G5: 8000, G6: 12000 } };
// Career Score categories with a chosen rate per key (score = ceil(max × rate)); keys not listed are left out of the record.
function cats(c, rates) {
  return run(c, 'lssCatsOrdered()').filter(cat => rates[cat.key] != null).map(cat => {
    const max = cat.items.length * 3, score = Math.ceil(max * rates[cat.key] / 100);
    return { key: cat.key, name: cat.key, score, max, pct: Math.round(score / max * 100) };
  });
}
function sum(cs) { const s = cs.reduce((a, x) => a + x.score, 0), m = cs.reduce((a, x) => a + x.max, 0); return { hasData: true, cats: cs, totalScore: s, totalMax: m, totalPct: m ? Math.round(s / m * 100) : 0 }; }
const prorate = (c, e, ba = 1.1, sp = 1) => { c.E = e; c.CFG = CFG; return run(c, `bonusProrate(E, CFG, ${ba}, ${sp}, 0.9)`); };
const ALL8 = { A: 90, B: 90, C: 90, D: 90, E: 90, F: 90, G: 90, H: 90 };

test('store track: the coefficient moves from the lower end towards the upper end with the share of categories that meet their base line', () => {
  const c = app();
  const ken = { id: 'ken', name: 'Ken Sample', title: 'Server Leader' };
  c.EMPS = [ken];
  assert.ok(run(c, `cscSaveTarget('G3-sv', ${JSON.stringify({ A: { m: 'pct', v: 70 }, B: { m: 'pts', v: 30 }, C: { m: 'none' }, D: { m: 'none' } })})`).ok);
  c.STORE.bonus_coef_rng = { 'G3-sv': { lo: 0.8, hi: 1.4, _at: 1 } };
  // A 70% ok, B ≥ 30 points ok, E 71% ok (default 70%), F 69% no, G 10% no, H 70% ok → 4 of the 6 categories used
  const cs = cats(c, { A: 70, B: 70, C: 0, D: 0, E: 71, F: 69, G: 10, H: 70 });
  assert.ok(cs.find(x => x.key === 'B').score >= 30, 'fixture: B has 30 points or more');
  c.SUMS['Ken Sample'] = sum(cs);
  const r = prorate(c, ken);
  const s = r.segs[0];
  assert.deepEqual([s.coefKey, s.rangeMode, s.coefLo, s.coefHi, s.cm.mode, s.cm.met, s.cm.used], ['G3-sv', true, 0.8, 1.4, 'cat', 4, 6]);
  assert.equal(s.coef, Math.round((0.8 + (1.4 - 0.8) * 4 / 6) * 100) / 100);
  assert.equal(s.coef, 1.2);
  assert.equal(s.amount, Math.round(3000 * 92 / 92 * 1 * 1.1 * 1 * 1.2), 'the Career Score coefficient (0.9 passed in) is not applied on top');
  assert.deepEqual(s.cm.rows.map(x => [x.key, x.st, x.dflt]).sort(), [['A', 'ok', false], ['B', 'ok', false], ['C', 'none', false], ['D', 'none', false], ['E', 'ok', true], ['F', 'ng', true], ['G', 'ng', true], ['H', 'ok', true]]);
  // all met → upper end; none met → lower end
  c.SUMS['Ken Sample'] = sum(cats(c, ALL8)); assert.equal(prorate(c, ken).segs[0].coef, 1.4);
  c.SUMS['Ken Sample'] = sum(cats(c, { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 })); assert.equal(prorate(c, ken).segs[0].coef, 0.8);
});

test('G2 uses its four categories; a category missing from the record is not met; unscored items count as 0 (no hold for the bonus)', () => {
  const c = app();
  const amy = { id: 'amy', name: 'Amy Sample', title: 'Crew Leader' };
  // nothing saved: G2 default line 60% on H, A, B, C
  c.SUMS['Amy Sample'] = sum(cats(c, { H: 60, A: 59, B: 90, D: 0, E: 0, F: 0, G: 0 }));   // C missing from the record
  const s = prorate(c, amy).segs[0];
  assert.deepEqual([s.coefKey, s.cm.mode, s.cm.met, s.cm.used], ['G2', 'cat', 2, 4]);
  assert.deepEqual(s.cm.rows.map(x => x.key), ['H', 'A', 'B', 'C']);
  assert.equal(s.coef, 1, '0.70 + 0.60 × 2/4');
  assert.equal(run(c, `bonusCatRows('G2', ${JSON.stringify(cats(c, { H: 60, A: 60, B: 60, C: 60 }))}).every(function(r){ return r.st==='ok'; })`), true, 'exactly at the line is met');
  // compared without rounding, like the promotion check: 43/54 = 79.63% is below 79.7% (rounded it would look like 80%)
  assert.ok(run(c, `cscSaveTarget('G4', ${JSON.stringify({ B: { m: 'pct', v: 79.7 } })})`).ok);
  const b = run(c, `bonusCatRows('G4', [{ key:'B', score:43, max:54 }])`).find(r => r.key === 'B');
  assert.deepEqual([b.v, b.st], [79.7, 'ng']);
});

test('specialists and office staff use the total %; no Career Score = the middle; G6 is one number', () => {
  const c = app();
  const chef = { id: 'chef', name: 'Chef Sample', title: 'Head Chef' }, off = { id: 'off', name: 'Office Sample', title: 'Office Manager', role: 'office_crew' };
  const s1 = sum(cats(c, { A: 100, B: 100, C: 100, D: 0, E: 0, F: 0, G: 0, H: 0 }));
  c.SUMS['Chef Sample'] = s1; c.SUMS['Office Sample'] = s1;
  for (const e of [chef, off]) {
    const s = prorate(c, e).segs[0];
    assert.equal(s.cm.mode, 'pct', e.title); assert.equal(s.cm.why, 'notStore');
    assert.equal(s.coef, Math.round((0.7 + 0.6 * s1.totalPct / 100) * 100) / 100, e.title);
  }
  const nob = { id: 'nob', name: 'Nobody Sample', title: 'Store Manager' };
  const s = prorate(c, nob).segs[0];
  assert.deepEqual([s.cm.mode, s.coef], ['none', 1], 'no Career Score yet: the middle of 0.70–1.30');
  c.STORE.bonus_coef_rng = { G6: { lo: 1.5, hi: 1.5, _at: 1 } };
  const gm = { id: 'gm', name: 'GM Sample', title: 'General Manager' };
  c.SUMS['GM Sample'] = sum(cats(c, { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 }));
  const g = prorate(c, gm).segs[0];
  assert.deepEqual([g.coefKey, g.coef, g.coefFixed, g.cm.mode], ['G6', 1.5, true, 'fixed'], 'G6: the Career Score does not move it');
});

test('a Career Score confirmed for the quarter is used instead of the live one; the previous grade period uses the evaluation confirmed at the change', () => {
  const c = app();
  const ken = { id: 'ken', name: 'Ken Sample', title: 'Server Leader' };
  c.SUMS['Ken Sample'] = sum(cats(c, { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 }));
  c.BQ['2026-Q3'] = { csFreeze: { ken: sum(cats(c, ALL8)) } };
  let s = prorate(c, ken).segs[0];
  assert.deepEqual([s.coef, s.cm.src], [1.3, 'frozen']);
  delete c.BQ['2026-Q3'];
  // moved G3 (kitchen) → G4 on 8/20; the G3 evaluation (categories) was confirmed then
  const neo = { id: 'neo', name: 'Neo Sample', title: 'Store Manager' };
  c.STORE.grade_hist = { neo: { recs: [{ id: 'r1', d: '2026-08-20', g: 'G4', from: 'G3', start: false, src: 'title', prevEval: { g: 'G3', track: 'kt', csPct: 90, cats: cats(c, ALL8) } }], _at: 1 } };
  c.SEGS.neo = [{ g: 'G3', from: '2026-07-01', to: '2026-08-20', days: 51 }, { g: 'G4', from: '2026-08-21', to: '2026-09-30', days: 41 }];
  c.SUMS['Neo Sample'] = sum(cats(c, { A: 80, B: 80, C: 80, D: 80, E: 80, F: 70, G: 70, H: 70 }));   // G4 default line 75%: 5 of 8
  const r = prorate(c, neo);
  assert.deepEqual(r.segs.map(x => [x.g, x.coefKey, x.cm.src, x.cm.met, x.cm.used, x.coef]), [['G3', 'G3-kt', 'grade', 8, 8, 1.3], ['G4', 'G4', 'q', 5, 8, Math.round((0.7 + 0.6 * 5 / 8) * 100) / 100]]);
});

test('a confirmed quarter keeps the range, the share and the coefficient of that moment; later changes to lines or ranges do not move it', () => {
  const c = app();
  const ken = { id: 'ken', name: 'Ken Sample', title: 'Server Leader' };
  c.EMPS = [ken];
  c.STORE.bonus_coef_rng = { 'G3-sv': { lo: 0.8, hi: 1.4, _at: 1 } };
  c.SUMS['Ken Sample'] = sum(cats(c, { A: 75, B: 75, C: 75, D: 75, E: 60, F: 60, G: 60, H: 60 }));   // 4 of 8 at the default 70%
  const before = prorate(c, ken);
  c.E = ken; c.CFG = CFG;
  const snap = run(c, 'bonusCoefSnapFor(E, CFG, {})');
  assert.deepEqual([snap.segs[0].lo, snap.segs[0].hi, snap.segs[0].frac, snap.segs[0].rv, snap.segs[0].v, snap.segs[0].cm.met, snap.segs[0].cm.rows.length], [0.8, 1.4, 0.5, 1.1, null, 4, 8],
    'the coefficient is kept as rv; v is empty so a device still on v1058–v1061 shows 計算しない instead of recomputing with the old formula (review P2)');
  c.BQ['2026-Q3'] = { locked: true, coefSnap: { ken: snap } };
  run(c, `cscSaveTarget('G3-sv', ${JSON.stringify({ A: { m: 'pct', v: 99 }, B: { m: 'pct', v: 99 } })})`);
  run(c, `bcoefSetRange('G3-sv','lo','0.5')`); run(c, `bcoefSetRange('G3-sv','hi','0.6')`);
  c.SUMS['Ken Sample'] = sum(cats(c, ALL8));
  const after = prorate(c, ken);
  assert.deepEqual(after.segs.map(x => [x.coef, x.amount, x.coefSrc, x.cm.met]), before.segs.map(x => [x.coef, x.amount, 'snap', x.cm.met]));
  // not confirmed: the new lines and range apply
  delete c.BQ['2026-Q3'];
  assert.equal(prorate(c, ken).segs[0].coef, Math.round((0.5 + 0.1 * 6 / 8) * 100) / 100, 'A and B at 99% are not met; the six others are');
});

test('the old per-store profit input (bottom table, removed) is read only for quarters confirmed with v1061 or earlier', () => {
  const c = app();
  c.CFG2 = { quarter: '2026-Q3', storeProfit: { S1: { actual: 50, target: 100 } } };
  assert.deepEqual(run(c, `storeProfitOf(CFG2,'S1')`), { actual: 0, target: 0, pct: 100, src: 'none' }, 'not confirmed: neutral (enter the months in ④)');
  const RS = { ken: { segs: [{ g: 'G3', from: '2026-07-01', key: 'G3-sv', v: null, rv: 1, lo: 0.7, hi: 1.3, gb: 3000 }] } };
  c.BQ['2026-Q3'] = { locked: true, lockedAt: '2026/12/31 09:00', lockedBy: 'GM', rangeLock: '2026/12/31 09:00|GM', coefSnap: RS };
  assert.deepEqual(run(c, `storeProfitOf(CFG2,'S1')`), { actual: 0, target: 0, pct: 100, src: 'none' }, 'confirmed with v1062: the same as before confirming (review P1)');
  c.BQ['2026-Q3'] = { locked: true, lockedAt: '2026/12/31 09:00', lockedBy: 'GM', rangeLock: '2026/12/31 09:00|GM', coefSnap: { ken: { segs: [{ g: 'G3', from: '2026-07-01', key: 'G3-sv', v: 1, gb: 3000 }] } } };
  assert.equal(run(c, `storeProfitOf(CFG2,'S1')`).src, 'old', 'confirmed again by an older device in the same minute: no range record, so the old input counts');
  c.BQ['2026-Q3'] = { locked: true };
  assert.deepEqual(run(c, `storeProfitOf(CFG2,'S1')`), { actual: 50, target: 100, pct: 50, src: 'old' }, 'confirmed with v1061 or earlier: the numbers it was confirmed with');
  c.BQ['2026-Q3'] = { locked: true, lockedAt: '2027/01/05 10:00', lockedBy: 'GM', rangeLock: '2026/12/31 09:00|GM', coefSnap: RS };
  assert.equal(run(c, `storeProfitOf(CFG2,'S1')`).src, 'old', 'unlocked and confirmed again on an older device: the mark of the earlier lock does not count');
  const lock = fn('bqLockQuarter'), unlock = fn('bqUnlockQuarter');
  assert.ok(lock.indexOf("d.rangeLock=String(d.lockedAt)+'|'+String(d.lockedBy)") > lock.indexOf('d.lockedAt=_bqNow()'), 'confirming sets the mark for this lock');
  assert.ok(unlock.includes("d.rangeLock=''"), 'unlocking clears it');
});

test('ranges live in their own synced key: a device still on v1058–v1061 rewriting bonus_coef does not wipe them', () => {
  const c = app();
  run(c, `bcoefSetRange('G3-sv','lo','0.9')`); run(c, `bcoefSetRange('G3-sv','hi','1.1')`);
  assert.deepEqual(JSON.parse(JSON.stringify([c.STORE.bonus_coef['G3-sv'].v, 'lo' in c.STORE.bonus_coef['G3-sv']])), [1, false], 'bonus_coef gets only the middle, for devices still on v1058–v1061');
  c.STORE.bonus_coef = { 'G3-sv': { v: 1, at: 'x', by: 'old device', _at: Date.now() + 1000, hist: [] } };   // what v1061 bcoefSet writes
  const r = run(c, `bcoefRange('G3-sv')`);
  assert.deepEqual([r.lo, r.hi, r.src], [0.9, 1.1, 'set']);
  assert.match(source, /'bonus_track','bonus_coef_rng','karte_pin'/, 'synced');
  assert.match(source, /\n  bonus_coef_rng:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/, 'merged per coefficient by time');
  assert.match(source, /'bonus_track','bonus_coef_rng','q_budgets'/, 'kept by storage cleanup');
  // a G3 whose track is unknown is shown with the range formula too (no leftover Career Score coefficient)
  const sho = { id: 'sho', name: 'Sho Sample', title: 'Store Leader' };
  const s = prorate(c, sho).segs[0];
  assert.deepEqual([s.blocked, s.rangeMode, s.amount], ['track', true, 0]);
});

test('base lines are edited inside the settings tab: default rows, starting from the default, dirty check, save closes and keeps history', () => {
  const c = app();
  c.CFG = CFG;
  run(c, `openCscInline('G3-sv')`);
  assert.deepEqual(run(c, 'window._cscEdit'), { k: 'G3-sv', d: {}, inline: true }, 'nothing saved: every category is at its default');
  const html = run(c, `renderBonusCoefCard(CFG)`);
  assert.match(html, /G3 サーバーリーダー の基準ライン/);
  assert.match(html, /<option value="" selected>初期値（70% 以上）<\/option>/);
  assert.match(html, /すべて初期値（70% 以上）/);
  assert.match(html, /係数の決まり方（例）：判定に使う 8 カテゴリーのうち 5 つが基準ライン以上 → 0\.70 ＋（1\.30 − 0\.70）× 5\/8 ＝ <b>×1\.08<\/b>/);
  assert.match(html, /bcoefSetRange\('G6','lo',this\.value\)/); assert.doesNotMatch(html, /bcoefSetRange\('G6','hi'/, 'G6: one input');
  assert.match(html, /基準ラインなし（係数は 1 つ）/);
  run(c, `cscModalSet('A','m','pct')`);
  assert.deepEqual(run(c, 'window._cscEdit.d.A'), { m: 'pct', v: '70' }, 'choosing a rate starts from the default line');
  run(c, `cscModalSet('C','m','none')`);
  assert.equal(c.MODAL.length, 0, 'inline: re-renders the tab, never opens the modal');
  assert.ok(c.RERENDER >= 3);
  assert.equal(run(c, 'cscEditDirty()'), true);
  c.CONFIRM = false; run(c, 'cscInlineClose()'); assert.ok(run(c, 'window._cscEdit'), 'unsaved changes: closing asks first');
  run(c, `cscModalSet('A','v','75')`); run(c, 'cscModalSave()');
  assert.equal(run(c, 'window._cscEdit'), null, 'saved and closed');
  assert.deepEqual(JSON.parse(JSON.stringify(c.STORE.cs_criteria['G3-sv'].cats)), { A: { m: 'pct', v: 75 }, C: { m: 'none' } }, 'only what was chosen is saved; the rest stays at the default');
  assert.equal(run(c, `cscLineSum('G3-sv').used`), 7);
  assert.match(run(c, `renderBonusCoefCard(CFG)`), /8 中 7 カテゴリーで判定/);
  c.curRole = 'am'; run(c, `openCscInline('G2')`); assert.equal(run(c, 'window._cscEdit'), null, 'AM cannot edit'); c.curRole = 'gm';
  // the promotion modal (leadership page) still opens as a modal
  run(c, `openCscModal('G2')`); assert.equal(c.MODAL.length, 1); assert.match(c.MODAL[0], /初期値（60% 以上）/);
});

test('the settings tab keeps editing but drops the old cards; the progress of the quarter moves to the assessment list', () => {
  const body = name => fn(name);
  const cfg = body('renderKarteConfig');
  for (const gone of ['bonusSetCs(', 'bonusSetStoreProfit(', 'renderBqPipeline(', 'renderBonusMemoCard(', '評価係数のレンジ', '店舗別 利益スコア']) assert.ok(!cfg.includes(gone), gone);
  for (const kept of ['renderKarteQuarterBar(', 'renderBonusPoolCard(', 'renderBonusCoefCard(', 'renderBonusFactorCard(', 'renderBqProfit(']) assert.ok(cfg.includes(kept), kept);
  assert.ok(body('kbResultHtml').includes('renderBqPipeline('), 'the pipeline is at the top of the assessment list');
  const pool = body('renderBonusPoolCard');
  assert.ok(pool.includes('_bonusMemoSectionHtml(') && pool.includes('_bonusPoolTableViewHtml('), 'the memo and the table are inside the pool card');
  assert.ok(!pool.includes('bonusSetQuarter'), 'the quarter is chosen above the cards');
  const view = body('_bonusPoolTableViewHtml');
  assert.ok(view.includes('_bonusPoolTableEditHtml()') && view.includes('bpEditStart()') && view.includes('bpHistory()'), 'the table is still editable, with its history');
  const memo = body('_bonusMemoSectionHtml');
  for (const k of ['bmEditStart()', 'bmCopy()', 'bmHistory()', 'bmSave()', 'bmInsertTable()']) assert.ok(memo.includes(k), k);
  assert.ok(body('renderKarteQuarterBar').includes('bonusSetQuarter(this.value)'));
});

test('numbers from a confirmed-quarter record (synced) reach the page only as numbers', () => {
  const c = app();
  const bad = { mode: 'pct', pct: '<img src=x onerror=alert(1)>', src: 'q' }, bad2 = { mode: 'cat', met: '<b>', used: '<i>', rows: [{ key: 'A', st: 'ok', score: 1, max: 2, m: 'pct', v: '<svg>' }] };
  const html = run(c, `[bonusCmCellHtml(${JSON.stringify(bad)}), bonusCmCellHtml(${JSON.stringify(bad2)}), bonusCmTxt(${JSON.stringify(bad)}), bonusCmShort(${JSON.stringify(bad2)}), bonusCmRowsHtml(${JSON.stringify(bad2)})].join('')`);
  assert.doesNotMatch(html, /<img|<svg|<b>[^<]*<\/b>\/|<i>/);
});
