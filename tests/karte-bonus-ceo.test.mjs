// v1074 (CEO directive · UI案46 · Moto's answers 10/13: 1A / 2 both / 3A / 4A / 5B): the growth-chart bonus from 2026 Q3.
// Items: G2/G3 ① Career Score, G4 ① ② sales ③ FL, G5/G6 ② sales ④ profit (store management profit = net income + head office + depreciation).
// Sales/profit: 90% → floor, 100% → 1.00, 110% → ceiling, linear between, 0.25% steps, held outside. FL: (target − actual) ±2pt.
// FL action (5 levels, +5%…−5%) is added to the FL number and held to the FL range. The product (not rounded) is held to 0.85–1.15,
// times the base (prorated), $1; over the pool everyone gets the same factor. Confirming freezes everything.
// Runs the real code from index.html in a VM with the synthetic company of tests/karte-eval.test.mjs (fictional staff and numbers).
// No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
let fixture = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, fn, person, Q } = await import('data:text/javascript;base64,' + Buffer.from(
  fixture + '\nexport { company, fn, person, Q };\n').toString('base64'));
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const install = (c, ...names) => vm.runInContext(names.map(fn).join('\n'), c);
const clock = (c, n) => vm.runInContext('Date.now = () => ' + n, c);
const lastToast = c => (c.TOASTS.at(-1) || [''])[0];
const totals = c => run(c, 'bonusTotals(kbCfg())');
const seg = (c, id) => person(c, id).segs[0];

// an independent oracle for the coefficient: two-piece line → 0.25% steps → held to the range
const lin = (v, lo, hi, x0, x1, x2) => v <= x0 ? lo : v >= x2 ? hi : v <= x1 ? lo + (1 - lo) * (v - x0) / (x1 - x0) : 1 + (hi - 1) * (v - x1) / (x2 - x1);
const step = v => Math.round(Math.round(v / 0.0025) * 0.0025 * 1e6) / 1e6;
const coef = (v, lo, hi, pts) => Math.min(Math.max(step(lin(v, lo, hi, ...pts)), lo), hi);
const PCT = [90, 100, 110];

// the synthetic company on the CEO formula: G4 people have an FL improvement action
function ceo(opts = {}) {
  const c = company(opts);
  vm.runInContext(`KEV2_START = '2026-Q3'; var document = { getElementById:function(){ return null; }, querySelector:function(){ return null; }, querySelectorAll:function(){ return []; } };`, c);
  for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${Q}|${id}|G4`].fx = { lv: 3, why: '発注量とシフトの見直し（7/15〜）', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
  return c;
}
const storeRec = (c, sid, rec) => { c.STORE.bonus_store_q = Object.assign(c.STORE.bonus_store_q || {}, { [`${Q}|${sid}`]: Object.assign({ _at: 1 }, rec) }); };
const acts = vals => Object.fromEntries(['2026-07', '2026-08', '2026-09'].map((ym, i) => [ym, { a: vals[i], src: 'man' }]));

test('coefficients: linear between the points, 0.25% steps, held outside the range', () => {
  const c = ceo();
  const J0 = run(c, 'kevJ({})');
  assert.deepEqual(J0, { sx0: 90, sx1: 100, sx2: 110, fpt: 2, pd: 5, step: 0.25, clo: 0.85, chi: 1.15, a5: 5, a4: 2.5, a3: 0, a2: -2.5, a1: -5 }, 'the CEO directive as the initial rules');
  const k = (x, lo, hi, pts = PCT) => run(c, `kevCoef2(${x}, {lo:${lo}, hi:${hi}}, ${JSON.stringify(pts)}, kevJ({}))`);
  for (const [x, lo, hi, want] of [[102.4, 0.95, 1.05, 1.0125], [95, 0.95, 1.05, 0.975], [89, 0.95, 1.05, 0.95], [112, 0.95, 1.05, 1.05], [100, 0.95, 1.05, 1],
    [101.3, 0.9, 1.1, 1.0125], [95, 0.9, 1.1, 0.95], [99.99, 0.9, 1.1, 1], [100.13, 0.9, 1.1, 1.0025]]) {
    assert.equal(k(x, lo, hi), want, `${x}% on ${lo}–${hi}`);
    assert.equal(want, coef(x, lo, hi, PCT), 'the oracle agrees');
  }
  // random values: always a multiple of 0.25%, inside the range, and equal to the oracle
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    const x = 70 + rnd() * 60, lo = [0.9, 0.95, 0.85][i % 3], hi = [1.1, 1.05, 1.2][i % 3], got = k(x, lo, hi);
    assert.equal(got, coef(x, lo, hi, PCT), 'x=' + x);
    assert.ok(Math.abs(got / 0.0025 - Math.round(got / 0.0025)) < 1e-6 && got >= lo && got <= hi);
  }
  // the steps are applied before holding to the range, so a range that is not on a step is still respected (step 5%, range 0.97–1.03)
  assert.equal(run(c, 'kevCoef2(89, {lo:0.97, hi:1.03}, [90, 100, 110], Object.assign(kevJ({}), {step:5}))'), 0.97);
  assert.equal(run(c, 'kevCoef2(111, {lo:0.97, hi:1.03}, [90, 100, 110], Object.assign(kevJ({}), {step:5}))'), 1.03);
  assert.deepEqual([run(c, 'kevLin(80, 0.9, 1.1, 90, 100, 110)'), run(c, 'kevLin(120, 0.9, 1.1, 90, 100, 110)'), run(c, 'kevLin(95, 0.9, 1.1, 90, 100, 110)')], [0.9, 1.1, 0.95]);
  assert.equal(run(c, 'kevFc(0.95)'), '0.950');
  assert.equal(run(c, 'kevFc(1.0125)'), '1.0125');
});

test('items: G2/G3 ①, G4 ①②③, G5/G6 ②④ — v1065-era on/off, points and ②③④ ranges are not used; ① ranges, new saves and deliberate personal changes are', () => {
  const c = ceo();
  const on = id => { const s = seg(c, id); return ['c', 's', 'f', 'p'].filter(k => s.items[k].on).join(''); };
  assert.deepEqual(['aki', 'ken', 'neo', 'mia', 'sam', 'gus'].map(on), ['c', 'c', 'c', 'csf', 'sp', 'sp']);
  assert.equal(on('ray'), 'cf', "Ray's personal setting (② fixed, with a reason) is still honored");
  assert.equal(seg(c, 'sam').coefs.c, 1, 'G5: Career Score is evaluated but not used');
  // what the v1065 settings tab saved for 2026 Q3 (its form saved the pre-filled values too): G5 ① on with 0.80–1.20,
  // G5 ② points 0/100/200 with the pre-filled range 0.80–1.20, G4 ② off, a company-wide ④ range 0.80–1.20
  c.STORE.bonus_eval_rule = {
    'G5|2026-Q3': { set: { c: { on: true, lo: 0.8, hi: 1.2, x0: 0, x1: 50, x2: 100 }, s: { on: true, lo: 0.8, hi: 1.2, x0: 0, x1: 100, x2: 200 } }, _at: 1 },
    'G4|2026-Q3': { set: { s: { on: false }, f: { lo: 0.9, hi: 1.1 } }, _at: 1 },
    '_common|2026-Q3': { set: { p: { lo: 0.8, hi: 1.2, x0: 0, x1: 100, x2: 200 } }, _at: 1 },
  };
  assert.equal(on('sam'), 'sp', 'the old G5 ① on is not used');
  assert.equal(on('mia'), 'csf', 'the old G4 ② off is not used');
  const sam = seg(c, 'sam');
  assert.deepEqual([sam.items.s.rule.lo, sam.items.s.rule.hi, sam.items.s.rule.x0, sam.items.s.rule.x2], [0.95, 1.05, 90, 110], 'the CEO range and points, not the saved v1065 values');
  assert.deepEqual([sam.items.p.rule.lo, sam.items.p.rule.hi, seg(c, 'mia').items.f.rule.lo], [0.9, 1.1, 0.95]);
  assert.equal(sam.coefs.s, coef(96, 0.95, 1.05, PCT), '96% on 0.95–1.05 = 0.98');
  // ① keeps the saved range (Moto: 5B) — visible once ① is switched on with this version (g2)
  c.STORE.bonus_eval_rule['G5|2026-Q3'].set.c.g2 = 1;
  assert.equal(on('sam'), 'csp');
  assert.deepEqual([seg(c, 'sam').items.c.rule.lo, seg(c, 'sam').items.c.rule.hi], [0.8, 1.2]);
  // ②③④ ranges saved with this version are used
  c.STORE.bonus_eval_rule['G5|2026-Q3'].set.s = { on: true, lo: 0.9, hi: 1.1, g2: 1 };
  assert.deepEqual([seg(c, 'sam').items.s.rule.lo, seg(c, 'sam').coefs.s], [0.9, coef(96, 0.9, 1.1, PCT)]);
  // a personal on/off from before is used only when it was a deliberate change from the v1065 default
  c.STORE.bonus_eval_rule = {};
  c.STORE.bonus_eval_ovr['sam|2026-Q3'] = { set: { c: { on: true, lo: 0.7, hi: 1.3 }, w: { ab: 40, kn: 20, ph: 20, qu: 20 } }, why: '配点を変えた', _at: 1 };
  assert.equal(on('sam'), 'sp', 'G5 ① was on by default in v1065: the saved "on" was only pre-filled');
  c.STORE.bonus_eval_ovr['mia|2026-Q3'] = { set: { p: { on: true, lo: 0.8, hi: 1.2 } }, why: '店舗の利益にも責任を持つ', _at: 1 };
  assert.equal(on('mia'), 'csfp', 'G4 ④ was off by default in v1065: turning it on was deliberate');
  assert.deepEqual([seg(c, 'mia').items.p.rule.lo, seg(c, 'mia').items.p.rule.hi], [0.9, 1.1], 'but its pre-filled range is not used');
  assert.equal(on('ray'), 'cf', "Ray's ② fixed at 1.00 (deliberate) is kept");
  // Codex review (3a2f5e2) P2: the baseline is what the person had in v1065 — the v1065 default plus the v1065 grade setting.
  // G5 ① was switched to "fixed" for the grade in v1065, and Sam alone was switched back on: deliberate, kept (with the amount it implies)
  const sam0 = person(c, 'sam').amount;
  c.STORE.bonus_eval_rule = { 'G5|2026-Q3': { set: { c: { on: false } }, _at: 1 } };
  c.STORE.bonus_eval_ovr['sam|2026-Q3'] = { set: { c: { on: true, lo: 0.7, hi: 1.3 } }, why: 'この人だけ Career Score を反映', _at: 2 };
  assert.equal(on('sam'), 'csp');
  const samC = seg(c, 'sam');
  assert.equal(person(c, 'sam').amount, Math.round(8000 * samC.coefs.c * samC.coefs.s * samC.coefs.p));
  assert.notEqual(person(c, 'sam').amount, sam0, 'the personal ① changes the amount');
  // the same grade setting with Sam's pre-filled "fixed" (equal to what he had): not a deliberate change → the CEO default (① off)
  c.STORE.bonus_eval_ovr['sam|2026-Q3'] = { set: { c: { on: false, lo: 0.7, hi: 1.3 } }, why: '配点', _at: 3 };
  assert.equal(on('sam'), 'sp');
  // G6 inherits G5's v1065 setting first (G5 ① fixed, G6 not saved): Gus alone on → kept
  c.STORE.bonus_eval_ovr['gus|2026-Q3'] = { set: { c: { on: true } }, why: 'この人だけ', _at: 4 };
  assert.equal(on('gus'), 'csp');
  // a grade part saved by this version (g2) is not a v1065 decision: with no v1065 value for it, the baseline is the v1065 default (G5 ① on),
  // so Sam's "on" equals what he had and is treated as pre-filled
  c.STORE.bonus_eval_rule = { 'G5|2026-Q3': { set: { c: { on: false, g2: 1 } }, _at: 5 } };
  c.STORE.bonus_eval_ovr['sam|2026-Q3'] = { set: { c: { on: true } }, why: '配点', _at: 6 };
  assert.equal(on('sam'), 'sp');
  // the same grade version re-saved by this version keeps the v1065 value in its history: v1065 had G5 ① fixed, so Sam's "on" was deliberate → kept
  c.STORE.bonus_eval_rule['G5|2026-Q3'].hist = [{ set: { c: { on: false, lo: 0.7, hi: 1.3 } }, why: 'v1065', at: '2026/10/11 10:00', by: 'GM', _at: 1 }];
  assert.equal(on('sam'), 'csp');
  // an earlier save by this version in the same history is skipped too (it is not a v1065 decision)
  c.STORE.bonus_eval_rule['G5|2026-Q3'].hist.push({ set: { c: { on: true, g2: 1 } }, why: 'v1074', at: '2026/10/13 10:00', by: 'GM', _at: 4 });
  assert.equal(on('sam'), 'csp');
  delete c.STORE.bonus_eval_ovr['gus|2026-Q3'];
  // the judgement rules are company-wide: a grade or personal "j" is ignored
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { j: { clo: 0.5, chi: 2 } }, _at: 1 } };
  c.STORE.bonus_eval_ovr['ray|2026-Q3'].set.j = { clo: 0.5, chi: 2 };
  assert.deepEqual(seg(c, 'ray').lim, [0.85, 1.15]);
});

test('Codex review (eb10419) P2: the v1065 baseline survives creating the next quarter and a 21st save of the same version', () => {
  const c = ceo();
  const on = (id, q = Q) => { c.QQ = q; c.ID = id; const r = run(c, `kevRuleFor(ghNormG(empGrade(EMPS.find(function(e){ return e.id===ID; }))), QQ, ID).r`); return ['c', 's', 'f', 'p'].filter(k => r[k].on).join(''); };
  // v1065: G5 ① fixed for the grade; Sam alone switched back on (deliberate) → kept, with the higher amount
  c.STORE.bonus_eval_rule = { 'G5|2026-Q3': { set: { c: { on: false, lo: 0.7, hi: 1.3 } }, why: 'v1065', at: '2026/10/11 10:00', by: 'GM', _at: 1 } };
  c.STORE.bonus_eval_ovr['sam|2026-Q3'] = { set: { c: { on: true, lo: 0.7, hi: 1.3 } }, why: 'この人だけ Career Score を反映', at: '2026/10/11 10:05', by: 'GM', _at: 2 };
  assert.equal(on('sam'), 'csp');
  const want = person(c, 'sam').amount;
  // (a) the next quarter's grade setting is created with this version (① saved as fixed, g2): the 2026 Q4 version has no v1065 value,
  //     but the 2026 Q3 version still has it — Sam's personal "on" (from 2026 Q3) stays deliberate in 2026 Q4, and Q3 does not move
  let t = 1000; clock(c, t);
  assert.equal(run(c, `kevRuleSave('G5', '2026-Q4', {c:{on:false, lo:0.7, hi:1.3, g2:1}}, '翌四半期の設定', '① を変更')`), true);
  assert.equal(on('sam', '2026-Q4'), 'csp', 'Q4: the personal ① is still kept');
  assert.deepEqual(run(c, `kevV1On('G5', '2026-Q4')`).c, { on: false }, 'the v1065 baseline for Q4 comes from the Q3 version');
  assert.equal(on('sam'), 'csp'); assert.equal(person(c, 'sam').amount, want);
  // the personal setting (from 2026 Q3) is compared with what was in effect in 2026 Q3, even if an old device later put a v1065-era ① on into the Q4 version
  const q4 = J(c.STORE.bonus_eval_rule['G5|2026-Q4']);
  c.STORE.bonus_eval_rule['G5|2026-Q4'] = Object.assign(J(q4), { set: { c: { on: true, lo: 0.7, hi: 1.3 } } });
  assert.deepEqual(run(c, `kevV1On('G5', '2026-Q4')`).c, { on: true });
  assert.equal(on('sam', '2026-Q4'), 'csp', 'still deliberate against the Q3 baseline');
  c.STORE.bonus_eval_rule['G5|2026-Q4'] = q4;
  // a 2026 Q4 personal version made with this version (another part changed) copies the v1065 ① and is compared with the same baseline
  assert.equal(run(c, `kevOvrSave('sam', '2026-Q4', {stores:['S3','S4']}, '担当店', '担当店を変更')`), true);
  assert.equal(on('sam', '2026-Q4'), 'csp');
  // (b) the same 2026 Q3 grade version saved again 21 times with this version (the history keeps 20): the v1065 value is kept in v1
  for (let i = 0; i < 21; i++) { clock(c, (t += 1000)); assert.equal(run(c, `kevRuleSave('G5', '2026-Q3', {c:{on:${i % 2 ? 'true' : 'false'}, lo:0.7, hi:1.3, g2:1}}, '保存 ${i + 1}', '① を変更')`), true); }
  assert.equal(run(c, `kevRuleSave('G5', '2026-Q3', {c:{on:false, lo:0.7, hi:1.3, g2:1}}, '保存 22', '① を変更')`), true);
  const v = J(c.STORE.bonus_eval_rule['G5|2026-Q3']);
  assert.equal(v.hist.length, 20, 'the history is capped');
  assert.ok(v.hist.every(h => h.set.c.g2), 'the v1065 value has left the history');
  assert.deepEqual(v.v1, { c: { on: false } }, 'it is kept in v1');
  assert.equal(on('sam'), 'csp', 'the 22nd save does not drop the personal ①');
  assert.equal(person(c, 'sam').amount, want, 'and the amount does not change');
  // sync: a copy without v1 (older) and a copy with it — the merged record keeps v1, and so does the reverse order
  const withV1 = J(v), without = Object.assign(J(v), { _at: v._at - 5 }); delete without.v1;
  c.A = withV1; c.B = without;
  assert.deepEqual(run(c, 'kevMergeVerRec(A, B).v1'), { c: { on: false } });
  assert.deepEqual(run(c, 'kevMergeVerRec(B, A).v1'), { c: { on: false } });
  // an old device (v1068) saving the version again with a v1065 value: that value is used, and the next save with this version keeps it in v1
  c.STORE.bonus_eval_rule['G5|2026-Q3'] = Object.assign(J(v), { set: { c: { on: true, lo: 0.7, hi: 1.3 } }, _at: (t += 1000) });
  assert.deepEqual(run(c, `kevV1On('G5', '${Q}')`).c, { on: true }, 'the v1065-era value in the set wins over the kept one');
  assert.equal(on('sam'), 'sp', 'G5 ① on for the grade (v1065): Sam\'s "on" is now the same → pre-filled');
  clock(c, (t += 1000));
  assert.equal(run(c, `kevRuleSave('G5', '2026-Q3', {c:{on:false, lo:0.7, hi:1.3, g2:1}}, '保存', '① を変更')`), true);
  assert.deepEqual(J(c.STORE.bonus_eval_rule['G5|2026-Q3'].v1), { c: { on: true } }, 'v1 follows the latest v1065-era value');
  // personal settings do not get v1 (only the grade and company rules carry the v1065 baseline), even when the same version is saved again
  clock(c, (t += 1000));
  assert.equal(run(c, `kevOvrSave('sam', '2026-Q3', {stores:['S3']}, '担当店', '担当店を変更')`), true);
  assert.equal(c.STORE.bonus_eval_ovr['sam|2026-Q3'].hist.length, 1);
  assert.equal(c.STORE.bonus_eval_ovr['sam|2026-Q3'].v1, undefined);
});

test('G4 FL: target − actual on ±2pt, then the improvement action, held to the FL range; a plus needs 実行状況', () => {
  const c = ceo();
  vm.runInContext('STORES.S2.fc = 30; STORES.S2.lb = 27;', c);   // Mia's store: FL actual exactly 57.0%
  const fx = v => { c.STORE.bonus_eval[`${Q}|mia|G4`].fx = Object.assign({ why: '原因：仕込み過多。7/15 から発注を毎日に。9/1 までに 1pt。品質は週 1 で確認' }, v); };
  const f = () => seg(c, 'mia').items.f;
  storeRec(c, 'S2', { tgt: { fl: 55 } });   // 2pt over target → 0.95
  fx({ lv: 5, c_exec: true });
  assert.deepEqual([f().target, f().actual.toFixed(1), f().num, f().adj, f().coef, f().capped], [55, '57.0', 0.95, 5, 1, false], '0.95 + 5% = 1.00');
  fx({ lv: 1 });
  assert.equal(f().coef, 0.95, '0.95 − 5% = 0.90 → held at 0.95');
  assert.equal(f().capped, true);
  storeRec(c, 'S2', { tgt: { fl: 59 } });   // 2pt under target → 1.05
  fx({ lv: 5, c_exec: true });
  assert.deepEqual([f().num, f().raw, f().coef, f().capped], [1.05, 1.1, 1.05, true], '1.05 + 5% → held at 1.05');
  storeRec(c, 'S2', { tgt: { fl: 57 } });   // on target → 1.00
  fx({ lv: 2 });
  assert.equal(f().coef, 0.975);
  // a company-wide adjustment that is not on a 0.25% step: the FL coefficient is stepped again after adding it
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { j: { a4: 1.1 } }, _at: 1 } };
  fx({ lv: 4, c_exec: true });
  assert.deepEqual([f().num, f().raw, f().coef], [1, 1.01, 1.01], '1.00 + 1.1% = 1.011 → 1.01');
  c.STORE.bonus_eval_rule = {};
  storeRec(c, 'S2', { tgt: { fl: 57.5 } });   // 0.5pt under → 1.0125
  fx({ lv: 3 });
  assert.equal(f().num, coef(0.5, 0.95, 1.05, [-2, 0, 2]));
  assert.equal(f().num, 1.0125);
  // a plus level without 実行状況: the plan alone is not a plus → missing (no amount until fixed)
  fx({ lv: 4, c_cause: true, c_plan: true });
  assert.match(f().miss.join(), /実行状況/);
  assert.equal(person(c, 'mia').blocked, 'eval');
  run(c, `window._kevF={}`);
  c.ID = 'mia';
  assert.match(run(c, "kevDoneProblems(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()).segs[0], kevApplies(kbCfg())).join('／')"), /実行状況/);
  // "a plus needs 実行状況" follows the adjustment rate (the rates are company-wide and editable): 標準 at +1% needs it too
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { j: { a3: 1 } }, _at: 1 } };
  fx({ lv: 3, c_cause: true });
  assert.match(f().miss.join(), /実行状況/);
  assert.match(run(c, "kevDoneProblems(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()).segs[0], kevApplies(kbCfg())).join('／')"), /実行状況/);
  c.STORE.bonus_eval_rule = {};
  fx({ lv: 3, c_cause: true });
  assert.deepEqual(f().miss, [], '標準 at 0% does not need it');
  fx({ lv: 4, c_exec: true, why: '  ' });
  assert.match(f().miss.join(), /理由を書いてください/);
  fx({ lv: null });
  assert.match(f().miss.join(), /段階を選んでください/);
  // no store-table target: the KPI master Food + Labor
  c.STORE.bonus_store_q = {};
  fx({ lv: 3 });
  assert.deepEqual([f().target, f().kpi], [58, 1]);
  // FL = 3 months of Food + Labor ÷ 3 months of sales (not the average of monthly %)
  vm.runInContext('STORES.S2.a = [100000, 300000, 500000]; STORES.S2.fc = 30; STORES.S2.lb = 27;', c);
  assert.equal(f().actual.toFixed(4), ((30000 + 90000 + 150000 + 27000 + 81000 + 135000) / 900000 * 100).toFixed(4));
});

test('G5/G6 profit: store management profit, target by % or $, summed before dividing, prorated in progress, target ≤ 0 by the difference', () => {
  const c = ceo();
  storeRec(c, 'S3', { tgt: { pp: 10, pb: 'pct' }, act: acts([30000, 30000, 30000]) });   // budget $900,000 → target $90,000
  storeRec(c, 'S4', { tgt: { pa: 95000, pb: 'amt' }, act: acts([31000, 31000, 31000]) });
  let p = seg(c, 'sam').items.p;
  assert.deepEqual([p.mode, p.target, p.actual, p.pct.toFixed(4)], ['pct', 185000, 183000, (183000 / 185000 * 100).toFixed(4)]);
  assert.deepEqual(p.rows.map(r => [r.sid, r.tSrc, Math.round(r.tAmt), r.tPct.toFixed(2)]), [['S3', 'pct', 90000, '10.00'], ['S4', 'amt', 95000, '9.50']]);
  const sam = seg(c, 'sam');
  assert.equal(sam.coefs.p, coef(183000 / 185000 * 100, 0.9, 1.1, PCT));
  assert.equal(sam.coefs.s, coef((288000 * 3 + 320000 * 3) / 1900000 * 100, 0.95, 1.05, PCT));
  assert.equal(sam.mult, sam.coefs.s * sam.coefs.p);
  assert.equal(person(c, 'sam').amount, Math.round(8000 * sam.coefs.s * sam.coefs.p));
  // in progress (September is the current month): only July and August, the target prorated by the sales budget
  vm.runInContext('var _ymo=_ymToOffset; _ymToOffset=function(ym){ return _ymo(ym)+1; };', c);
  p = seg(c, 'sam').items.p;
  const want = 90000 * 600000 / 900000 + 95000 * (333334 + 333333) / 1000000;
  assert.deepEqual([p.target.toFixed(4), p.actual, p.ended], [want.toFixed(4), 122000, false]);
  vm.runInContext('_ymToOffset=_ymo;', c);
  // the profit target of the stores adds up to ≤ 0: the difference ÷ the sales budget on ±5pt
  storeRec(c, 'S3', { tgt: { pa: -10000, pb: 'amt' }, act: acts([1000, 1000, 1000]) });
  storeRec(c, 'S4', { tgt: { pa: 0, pb: 'amt' }, act: acts([500, 500, 500]) });
  p = seg(c, 'sam').items.p;
  const dpt = (4500 + 10000) / 1900000 * 100;
  assert.deepEqual([p.mode, p.dpt.toFixed(6), p.coef], ['diff', dpt.toFixed(6), coef(dpt, 0.9, 1.1, [-5, 0, 5])]);
  // a cleared month ("clr") does not fall back to the v1068 hand entry
  storeRec(c, 'S4', { tgt: { pa: 95000, pb: 'amt' }, act: Object.assign(acts([1, 1, 1]), { '2026-09': { a: null, src: 'clr' } }) });
  assert.match(seg(c, 'sam').items.p.miss.join(), /Store 4 9月/);
  assert.equal(person(c, 'sam').blocked, 'eval');
  // a month not entered in the new table uses the v1068 entry of that month (shown as 前の入力), and is missing when there is none
  storeRec(c, 'S4', { tgt: { pa: 95000, pb: 'amt' }, act: { '2026-07': { a: 1, src: 'man' }, '2026-08': { a: 1, src: 'pl' } } });
  assert.deepEqual(Object.values(run(c, `kevStoreRow('${Q}','S4')`).acts).map(x => x.src), ['man', 'pl', 'old']);
  delete c.STORE.bonus_q[Q].profit.S4['2026-09'];
  assert.match(seg(c, 'sam').items.p.miss.join(), /Store 4 9月/);
  assert.equal(person(c, 'sam').blocked, 'eval');
  // nothing in the store table: the v1068 hand entry is used ("前の入力")
  c.STORE.bonus_store_q = {};
  c.STORE.bonus_q = J(ceo().STORE.bonus_q);
  p = seg(c, 'sam').items.p;
  assert.deepEqual([p.rows.map(r => r.tSrc).join(), p.target, p.actual], ['old,old', 200000, 186000]);
  // G6 = all stores (Gus: S5)
  assert.equal(seg(c, 'gus').items.p.rows.map(r => r.sid).join(), 'S5');
});

test('final coefficient: the product (not rounded) is held to 0.85–1.15; the pool adjustment may go below the floor', () => {
  const c = ceo();
  const ray = seg(c, 'ray');
  assert.ok(ray.mult > 1.15, 'Ray: ① × ③ is over 1.15');
  assert.equal(ray.mult, ray.coefs.c * ray.coefs.s * ray.coefs.f * ray.coefs.p, 'not rounded before holding');
  assert.deepEqual([ray.fmult, ray.clamped, ray.lim], [1.15, true, [0.85, 1.15]]);
  assert.equal(person(c, 'ray').amount, Math.round(5000 * 1.15));
  // a poor quarter at G5 with a saved range 0.90–1.10 on ②: 0.90 × 0.90 = 0.81 → 0.85
  c.STORE.bonus_eval_rule = { 'G5|2026-Q3': { set: { s: { on: true, lo: 0.9, hi: 1.1, g2: 1 } }, _at: 1 } };
  vm.runInContext('STORES.S3.a = [240000, 240000, 240000]; STORES.S4.a = [260000, 260000, 260000];', c);
  storeRec(c, 'S3', { tgt: { pp: 10, pb: 'pct' }, act: acts([20000, 20000, 20000]) });
  storeRec(c, 'S4', { tgt: { pp: 10, pb: 'pct' }, act: acts([20000, 20000, 20000]) });
  const sam = seg(c, 'sam');
  assert.deepEqual([sam.coefs.s, sam.coefs.p, sam.fmult, sam.clamped], [0.9, 0.9, 0.85, true]);
  assert.equal(person(c, 'sam').amount, 6800);
  // the pool is smaller than the total: everyone × the same k, and Sam goes below 0.85 × base
  c.POOL = 20000;
  const t = totals(c);
  assert.ok(t.k < 1);
  assert.equal(t.paid, 20000);
  assert.ok(t.finals.sam < Math.round(8000 * 0.85), 'adjusted below the individual floor (指示書 ⑧)');
  // the pool is larger: nobody gets more than their own amount (the rest is not used)
  c.POOL = 999999;
  const t2 = totals(c);
  assert.equal(t2.k, 1);
  assert.equal(t2.paid, t2.total);
  // the final range is a judgement rule (company-wide, versioned)
  c.STORE.bonus_eval_rule['_common|2026-Q3'] = { set: { j: { clo: 0.9, chi: 1.1 } }, _at: 2 };
  assert.deepEqual([seg(c, 'ray').fmult, seg(c, 'sam').fmult], [1.1, 0.9]);
});

test('judgement rules: versioned by quarter (a 2026 Q4 version leaves Q3 alone), validated, and the form saves them company-wide', () => {
  const c = ceo();
  const before = totals(c).finals;
  c.STORE.bonus_eval_rule = { '_common|2026-Q4': { set: { j: { sx0: 80, sx2: 120, clo: 0.5, chi: 2 } }, _at: 1 } };
  assert.deepEqual(totals(c).finals, before, 'Q4 rules do not change Q3');
  c.STORE.bonus_eval_rule['_common|2026-Q3'] = { set: { j: { sx0: 95, sx1: 100, sx2: 105 } }, _at: 1 };
  assert.equal(seg(c, 'mia').coefs.s, coef(103, 0.95, 1.05, [95, 100, 105]), 'Mia at 103% with 95/100/105');
  const bad = j => run(c, `kevJBad(${JSON.stringify(Object.assign({}, run(c, 'KEV_J_DEF'), j))})`);
  assert.equal(bad({}), '');
  for (const j of [{ sx0: 100 }, { sx2: 99 }, { fpt: 0 }, { pd: -1 }, { step: 0 }, { clo: 1.2 }, { chi: 0.9 }, { a5: -10 }, { a1: 60 }, { sx1: 'x' }]) assert.notEqual(bad(j), '', JSON.stringify(j));
  // the form (settings ③): only GM/CEO, company-wide, with a reason and the starting quarter
  c.STORE.bonus_eval_rule = {};
  const fields = { j_sx0: '92', j_sx1: '100', j_sx2: '108', j_fpt: '2', j_pd: '5', j_step: '0.25', j_clo: '0.85', j_chi: '1.15', j_a5: '5', j_a4: '2.5', j_a3: '0', j_a2: '-2.5', j_a1: '-5', why: '9 月の会議で変更', from: Q };
  vm.runInContext(`var FIELDS=${JSON.stringify(fields)}; document={ getElementById:function(id){ var k=id.replace(/^kevf-/, ''); return (k in FIELDS) ? {value:FIELDS[k]} : null; }, querySelector:function(){ return null; }, querySelectorAll:function(){ return []; } };`, c);
  run(c, "kevRuleOpen('G5','j')");
  assert.equal(c.MODAL.length, 0, 'judgement rules are not per grade');
  run(c, "kevRuleOpen('_common','j')");
  assert.match(c.MODAL.at(-1), /判定の決まり（会社共通）/);
  assert.match(c.MODAL.at(-1), /id="kevf-j_sx0"/);
  vm.runInContext("FIELDS.j_sx0='120'", c);
  run(c, 'kevFormSave()');
  assert.match(lastToast(c), /下限 < 1\.00 < 上限/);
  assert.equal(c.STORE.bonus_eval_rule['_common|2026-Q3'], undefined, 'invalid rules are not saved');
  vm.runInContext("FIELDS.j_sx0='92'", c);
  run(c, 'kevFormSave()');
  const saved = c.STORE.bonus_eval_rule['_common|2026-Q3'];
  assert.deepEqual([saved.set.j.sx0, saved.set.j.sx2, saved.why], [92, 108, '9 月の会議で変更']);
  assert.equal(seg(c, 'mia').items.s.rule.x0, 92);
  c.curRole = 'office';
  run(c, "kevRuleOpen('_common','j')");
  assert.match(lastToast(c), /GM・CEO/);
});

test('settings forms (2026 Q3): ②③④ change on/off and the range only, marked as saved by this version (g2)', () => {
  const c = ceo();
  const fields = { lo: '0.90', hi: '1.10', why: 'CEO の指示', from: Q };
  vm.runInContext(`var FIELDS=${JSON.stringify(fields)}, ON='1'; document={ getElementById:function(id){ var k=id.replace(/^kevf-/, ''); return (k in FIELDS) ? {value:FIELDS[k]} : null; }, querySelector:function(s){ return /on"\\]:checked/.test(s) ? {value:ON} : null; }, querySelectorAll:function(){ return []; } };`, c);
  run(c, "kevRuleOpen('G5','s')");
  const html = c.MODAL.at(-1);
  assert.match(html, /下限の係数/);
  assert.doesNotMatch(html, /kevf-x0/, 'no points: they are the judgement rules');
  run(c, 'kevFormSave()');
  assert.deepEqual(J(c.STORE.bonus_eval_rule['G5|2026-Q3'].set.s), { on: true, lo: 0.9, hi: 1.1, g2: 1 });
  assert.deepEqual([seg(c, 'sam').items.s.rule.lo, seg(c, 'sam').items.s.rule.hi], [0.9, 1.1]);
  vm.runInContext("ON='0'", c);
  run(c, "kevRuleOpen('G5','p')"); run(c, 'kevFormSave()');
  assert.equal(seg(c, 'sam').items.p.on, false, 'a fixed 1.00 saved by this version is used');
  vm.runInContext("FIELDS.lo='1.10'", c);
  run(c, "kevRuleOpen('G4','f')"); run(c, 'kevFormSave()');
  assert.match(lastToast(c), /1\.00 が下限〜上限の中/);
});

test('store table: GM/CEO set targets (% or $) and enter the monthly profit, PL fill = net income + head office + depreciation', () => {
  const c = ceo();
  install(c, 'plOtherOf', 'plNormAccount');
  assert.equal(run(c, `kevTgtSet('${Q}','S3','pp','12')`), true);
  let r = run(c, `kevStoreRow('${Q}','S3')`);
  assert.deepEqual([r.tSrc, r.tPct, Math.round(r.tAmt)], ['pct', 12, 108000], '12% of the $900,000 budget');
  run(c, `kevTgtSet('${Q}','S3','pa','$100,000')`);
  r = run(c, `kevStoreRow('${Q}','S3')`);
  assert.deepEqual([r.tSrc, r.tAmt, r.tPct.toFixed(3), r.pp], ['amt', 100000, '11.111', null], 'typing the amount replaces the %');
  run(c, `kevTgtSet('${Q}','S3','pa','')`);
  r = run(c, `kevStoreRow('${Q}','S3')`);
  assert.deepEqual([r.tAmt, r.tSrc], [null, null], 'cleared: the v1068 entry is not used either');
  run(c, `kevTgtSet('${Q}','S3','fl','57.5')`);
  assert.deepEqual([run(c, `kevStoreRow('${Q}','S3')`).flT, run(c, `kevStoreRow('${Q}','S3')`).flSrc], [57.5, 'set']);
  for (const [field, v] of [['pp', '101'], ['fl', '0'], ['fl', 'abc']]) { assert.equal(run(c, `kevTgtSet('${Q}','S3','${field}','${v}')`), false, field + ' ' + v); }
  assert.equal(run(c, `kevActSet('${Q}','S3','2026-07','12,345.67')`), true);
  assert.deepEqual(J(c.STORE.bonus_store_q[`${Q}|S3`].act['2026-07']).a, 12345.67);
  assert.equal(run(c, `kevActSet('${Q}','S3','2026-12','1')`), false, 'a month outside the quarter');
  // roles
  // the table is on the GM/CEO-only growth chart: other roles cannot write (also when called directly)
  for (const role of ['office', 'am', 'manager']) {
    c.curRole = role;
    assert.equal(run(c, `kevTgtSet('${Q}','S3','pp','9')`), false, role);
    assert.equal(run(c, `kevActSet('${Q}','S3','2026-08','1000')`), false, role);
    assert.match(lastToast(c), /GM・CEO/);
  }
  c.curRole = 'gm';
  // only closed months and the stores of the quarter
  vm.runInContext('var _ymo=_ymToOffset; _ymToOffset=function(ym){ return _ymo(ym)+1; };', c);   // September is the current month
  assert.equal(run(c, `kevActSet('${Q}','S3','2026-09','1000')`), false);
  assert.match(lastToast(c), /締まった月だけ/);
  vm.runInContext('_ymToOffset=_ymo;', c);
  assert.equal(run(c, `kevActSet('${Q}','S9','2026-08','1000')`), false);
  assert.equal(run(c, `kevTgtSet('${Q}','S9','pp','9')`), false);
  assert.match(lastToast(c), /対象の店舗ではありません/);
  // profit confirmed / quarter confirmed / another quarter on screen
  c.STORE.bonus_q[Q].profitLocked = true;
  assert.equal(run(c, `kevActSet('${Q}','S3','2026-08','3000')`), false);
  assert.equal(run(c, `kevTgtSet('${Q}','S3','pp','9')`), false);
  assert.equal(run(c, `kevTgtSet('${Q}','S3','fl','58')`), true, 'the FL target is not part of the profit confirmation');
  c.STORE.bonus_q[Q].profitLocked = false;
  assert.equal(run(c, `kevTgtSet('2026-Q4','S3','pp','9')`), false);
  assert.match(lastToast(c), /表示中の四半期/);
  // the PL fill (only on the device that imported the PL; Waikiki's PL is combined)
  c.STORE.pl_actual = {
    '2026-07': { S3: { sales: 288000, opex: 90000, netinc: 20000, detailOth: { 'Head Office Fee': 5000, ' Depreciation ': 3000 } }, S4: { sales: 320000, opex: 1, netinc: 9000 } },
    '2026-08': { S3: { sales: 0, opex: 0, netinc: -500 } },
  };
  assert.deepEqual(run(c, "kevPlValue('S3','2026-07')"), { ok: true, v: 28000, ni: 20000, hq: 5000, dp: 3000 });
  assert.equal(run(c, "kevPlValue('S4','2026-07')").ok, false, 'no breakdown of the other expenses: not filled');
  assert.equal(run(c, "kevPlValue('S3','2026-08')").v, -500, 'a month before opening: the other expenses are 0');
  assert.match(run(c, "kevPlValue('F03','2026-07')").why, /Waikiki/);
  // only closed months are filled (September as the current month: not offered)
  c.STORE.pl_actual['2026-09'] = { S3: { sales: 1, opex: 1, netinc: 1, detailOth: { 'Head Office Fee': 1, 'Depreciation': 1 } } };
  vm.runInContext('var _ymo2=_ymToOffset; _ymToOffset=function(ym){ return _ymo2(ym)+1; };', c);
  assert.deepEqual(run(c, `kevPlFillList('${Q}', ['S3'])`).map(x => x.ym), ['2026-07', '2026-08']);
  vm.runInContext('_ymToOffset=_ymo2;', c);
  delete c.STORE.pl_actual['2026-09'];
  assert.equal(run(c, `kevPlFill('${Q}')`), true);
  const a = c.STORE.bonus_store_q[`${Q}|S3`].act;
  assert.deepEqual([a['2026-07'].a, a['2026-07'].src, a['2026-08'].a, a['2026-09']], [28000, 'pl', -500, undefined]);
  assert.equal(run(c, `kevStoreRow('${Q}','S3')`).acts['2026-07'].src, 'pl');
});

test('progress panel (査定の進み具合): 2026 Q3 counts stores whose store table has a target and every closed month', () => {
  const c = ceo();
  install(c, 'bqStageState');
  vm.runInContext('function getQBudget(){ return {status:"committed"}; }', c);
  c.STORE.bonus_q = { [Q]: {} };   // no v1068 hand entry
  assert.equal(run(c, `bqStageState('${Q}')`).profit.n, 0);
  storeRec(c, 'S3', { tgt: { pp: 10, pb: 'pct' }, act: acts([1, 2, 3]) });
  storeRec(c, 'S4', { tgt: { pp: 10, pb: 'pct' }, act: acts([1, 2, null]) });
  const st = run(c, `bqStageState('${Q}')`);
  assert.deepEqual([st.profit.n, st.profit.tot], [1, 5], 'S3 complete; S4 misses September');
  assert.deepEqual(run(c, `kevStoreLockMiss('${Q}', ['S4', 'S5'])`), ['Store 4（9月の実績）', 'Store 5（目標・7月・8月・9月の実績）']);
});

test('store table sync: two devices change different stores / fields, both survive; the confirm re-read and digest include it', () => {
  const a = ceo(), b = ceo();
  clock(a, 1000); run(a, `kevTgtSet('${Q}','S3','pp','10')`);
  clock(b, 2000); run(b, `kevActSet('${Q}','S3','2026-07','30000')`); run(b, `kevTgtSet('${Q}','S4','fl','59')`);
  a.M1 = J(b.STORE.bonus_store_q); a.M2 = J(a.STORE.bonus_store_q);
  const m = run(a, 'kevMergeMap(M1, M2)');
  assert.deepEqual([m[`${Q}|S3`].tgt.pp, m[`${Q}|S3`].act['2026-07'].a, m[`${Q}|S4`].tgt.fl], [10, 30000, 59]);
  a.M1 = J(a.STORE.bonus_store_q); a.M2 = J(b.STORE.bonus_store_q);
  assert.deepEqual(J(run(a, 'kevMergeMap(M1, M2)')), m, 'the same in either order');
  assert.ok(run(a, `kevLockSyncKeys('${Q}')`).includes('bonus_store_q'));
  // registered for sync (OP_SYNC_KEYS), merged per field (OP_MERGE) and kept by storage cleanup (LS_NEVER_FREE)
  const src = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /'karte_pin','bonus_eval_rule','bonus_eval_ovr','bonus_eval','bonus_store_q',/);
  assert.match(src, /\n  bonus_store_q:\s+\{ merge: kevMergeMap, covers: kevCoversMap, keepLocal: true \}/);
  assert.match(src, /'q_budgets','bonus_eval_rule','bonus_eval_ovr','bonus_eval','bonus_store_q',\n/);
  const swB = (fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8').match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number((src.match(/const APP_VERSION = '(\d+)';/) || [])[1]) >= 1074 && (src.match(/const APP_VERSION = '(\d+)';/) || [])[1] === swB, 'v1074 or later, page and service worker on the same release');
  const d0 = run(a, `kevLockDigest('${Q}')`);
  run(a, `kevTgtSet('${Q}','S5','pp','9')`);
  assert.notEqual(run(a, `kevLockDigest('${Q}')`), d0, 'a target change is seen before confirming');
});

test('confirming freezes the CEO formula: later rules, targets, actuals and ranges do not move the amounts; the screens read the record', () => {
  const c = ceo();
  const before = totals(c);
  run(c, `bqLockQuarter('${Q}')`);
  const d = run(c, `bqGet('${Q}')`);
  assert.equal(d.locked, true, lastToast(c));
  assert.deepEqual([d.evSnap.gen, d.evSnap.start2, d.evSnap.j.chi, Object.keys(d.evSnap.stores).join()], [2, '2026-Q3', 1.15, 'S1,S2,S3,S4,S5']);
  assert.deepEqual(d.evSnap.finals, before.finals);
  const rs = d.evSnap.people.ray.segs[0];
  assert.deepEqual([rs.gen, rs.fmult, rs.clamped, rs.items.f.lv, rs.items.f.num, rs.ev.fx.c_exec, rs.ev.fx.why], [2, 1.15, true, 3, 0.9975, true, '発注量とシフトの見直し（7/15〜）']);
  assert.deepEqual(d.evSnap.people.sam.segs[0].items.p.rows.map(r => r.tSrc), ['old', 'old']);
  // change everything afterwards
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { j: { sx0: 99, sx2: 101, clo: 0.5, chi: 3 } }, _at: 9 }, 'G5|2026-Q3': { set: { s: { lo: 0.5, hi: 1.5, g2: 1 } }, _at: 9 } };
  storeRec(c, 'S3', { tgt: { pp: 50, pb: 'pct' }, act: acts([1, 1, 1]) });
  vm.runInContext('STORES.S2.a = [1, 1, 1];', c);
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.lv = 1;
  assert.deepEqual(totals(c).finals, before.finals);
  assert.equal(person(c, 'ray').segs[0].fmult, 1.15);
  // screens show the frozen record, no inputs
  vm.runInContext("window._kevSel='mia'", c);
  const tab = run(c, 'kevTabHtml(kbCfg())');
  assert.match(tab, /確定したときの記録/);
  assert.match(tab, /改善行動 標準/);
  assert.doesNotMatch(tab, /onclick="kevLv\(|onchange="kevChk\(/);
  const store = run(c, 'kevStoreCardHtml(kbCfg())');
  assert.match(store, /確定済み/);
  assert.doesNotMatch(store, /kevTgtSet\(|kevActSet\(|kevPlFill\(/);
  assert.match(store, /\$31,000/, 'the frozen monthly profit, not the later $1');
  const judgeLocked = run(c, 'kevJudgeCardHtml(kbCfg())');
  assert.match(judgeLocked, /確定したときの決まり/);
  assert.match(judgeLocked, /90% で下限 ／ 100% で 1\.00 ／ 110% で上限/, 'the confirmed rules, not the later 99/101');
  assert.match(judgeLocked, /0\.85 〜 1\.15/);
  assert.equal(run(c, `kevTgtSet('${Q}','S3','pp','9')`), false);
  assert.equal(run(c, `kevTgtSet('${Q}','S3','fl','58')`), false, 'the FL target is closed by the confirmation too');
  assert.match(lastToast(c), /査定を確定しています/);
  assert.match(store, /aria-label="Store 3 利益の目標 %" value="11.11"/, 'the frozen target % (not the later 50%)');
  assert.doesNotMatch(store, /value="50"/);
  // the pay history keeps the final coefficient
  run(c, 'bonusConfirmQuarter()');
  const snap = c.STORE.growth_karte.ray.payLog[0].snap;
  assert.deepEqual([snap.gen, snap.segs[0].fmult, snap.segs[0].clamped], [2, 1.15, true]);
  assert.match(run(c, 'kevSnapLineHtml(STORE.growth_karte.ray.payLog[0].snap)'), /最終×1\.150/);
  // unlocking: calculated again with the rules as they are now
  run(c, `bqUnlockQuarter('${Q}')`);
  assert.notDeepEqual(totals(c).finals, before.finals);
});

test('2026 Q3 confirmed by v1065–v1068 (old formula): the old record stays until it is unlocked (Moto: 4A)', () => {
  const c = ceo();
  vm.runInContext("KEV2_START = '2099-Q1';", c);
  run(c, `bqLockQuarter('${Q}')`);
  const old = totals(c).finals;
  assert.equal(run(c, `bqGet('${Q}')`).evSnap.gen, undefined);
  vm.runInContext("KEV2_START = '2026-Q3';", c);   // the device is updated to v1074
  assert.deepEqual(totals(c).finals, old, 'the confirmed amounts do not change by updating');
  vm.runInContext("window._kevSel='mia'", c);
  const tab = run(c, 'kevTabHtml(kbCfg())');
  assert.match(tab, /確定したときの記録/);
  assert.doesNotMatch(tab, /改善行動（GM・CEO が選ぶ）/, 'the old record view');
  install(c, 'renderKarteQuarterBar', 'renderKarteConfig');
  vm.runInContext("function _kcCss(){ return ''; } function renderBonusPoolCard(){ return '<pool>'; } function _karteQuarterOpts(q){ return [q]; } function bqRangeLock(){ return true; } function ghToday(){ return '2026-10-11'; } function renderBqProfit(){ return '<old-profit>'; }", c);
  assert.match(run(c, 'renderKarteQuarterBar(kbCfg())'), /前の版（v1065〜v1068）の式で確定/);
  const cfgHtml = run(c, 'renderKarteConfig(kbCfg())');
  assert.match(cfgHtml, /前の版（v1065〜v1068）の式で確定/);
  assert.match(cfgHtml, /前の式で確定しています（下の数字は今の入力/, 'the store table says its numbers were not used for the confirmed amounts');
  assert.doesNotMatch(cfgHtml, /kevTgtSet\(|kevActSet\(/, 'read-only while confirmed');
  run(c, `bqUnlockQuarter('${Q}')`);
  const now = totals(c).finals;
  assert.notDeepEqual(now, old);
  assert.equal(person(c, 'ray').segs[0].fmult, 1.15, 'after unlocking: the CEO formula');
  const cfg2 = run(c, 'renderKarteConfig(kbCfg())');
  assert.match(cfg2, /判定の決まり（会社共通/);
  assert.match(cfg2, /店舗の目標と実績/);
  assert.match(run(c, 'renderKarteQuarterBar(kbCfg())'), /最終係数/);
});

test('screens (PC and phone): evaluation with the FL action, settings ③ ④, list with the final coefficient; synced text is escaped', () => {
  const c = ceo();
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.why = '<img src=x onerror=alert(1)>';
  vm.runInContext("var _osn=_owStoreName; _owStoreName=function(s){ return s==='S3' ? '<b>S3</b>' : _osn(s); }; window._kevSel='mia';", c);
  const mia = run(c, 'kevTabHtml(kbCfg())');
  assert.doesNotMatch(mia, /<img src=x/);
  for (const s of ['③ FL 管理（数値 ＋ 改善行動）', '改善行動（GM・CEO が選ぶ）', 'kev-fxb', '非常に優秀', '未実施', '実行状況（実行している）', 'サービス品質への影響', '理由（必須', 'FL 最終係数', '個人の最終係数', '0.85〜1.15 に収める', 'kev-sm', 'kev-side'])
    assert.ok(mia.includes(s), s);
  assert.match(mia, /aria-pressed="true" aria-label="FL 改善行動 標準"/);
  assert.equal((mia.match(/class="kev-fxb"/g) || []).length, 5);
  vm.runInContext("window._kevSel='sam'", c);
  const sam = run(c, 'kevTabHtml(kbCfg())');
  assert.ok(sam.includes('④ 利益予算達成率（店舗管理利益）') && sam.includes('純利益 ＋ 本部費 ＋ 減価償却'));
  assert.doesNotMatch(sam, /<b>S3<\/b>/);
  const judge = run(c, 'kevJudgeCardHtml(kbCfg())');
  for (const s of ['判定の決まり（会社共通', '90% で下限', '個人の最終係数の幅', '0.85 〜 1.15', "kevRuleOpen('_common','j')", '達成率 → 係数'])
    assert.ok(judge.includes(s), s);
  const store = run(c, 'kevStoreCardHtml(kbCfg())');
  for (const s of ['店舗の目標と実績', '利益 目標 %', 'FL 目標率', 'kevTgtSet(', 'kevActSet(', '各月の店舗管理利益', 'Sam Sample（G5）の担当 2 店', '前の入力', 'KPI マスター', 'FL の元の数字'])
    assert.ok(store.includes(s), s);
  assert.doesNotMatch(store, /<b>S3<\/b>/);
  assert.doesNotMatch(store, /kevPlFill\(/, 'no PL on this device: no fill button');
  const list = run(c, 'kevListTableHtml(kbCfg(), bonusTotals(kbCfg()))');
  assert.match(list, /→ 最終 <b style="color:var\(--accent\)">×1\.150<\/b>（止めた）/);
  assert.match(run(c, 'kevResultTopHtml(kbCfg(), bonusTotals(kbCfg()))'), /最終係数/);
  const rule = run(c, 'kevRuleCardHtml(kbCfg())');
  assert.match(rule, /CEO の指示書/);
  c.ID = 'ray';
  const inner = run(c, 'kevPersonInnerHtml(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()), kbCfg(), {})');
  assert.match(inner, /1\.1795 → 1\.150 で止めた/);
  assert.match(run(c, 'kevSelfExplainHtml(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()), kbCfg())'), /0\.85〜1\.15 に収めて ×1\.150/);
  // other roles get no inputs (the growth chart itself is GM/CEO only)
  c.curRole = 'office';
  const off = run(c, 'kevStoreCardHtml(kbCfg())');
  assert.doesNotMatch(off, /kevActSet\(|kevTgtSet\(|kevPlFill\(/);
});

test('v1075 (Moto 10/13「両方に付ける」): the person page and the self view open from 個別評価 and 査定一覧, also while the evaluation is not finished', () => {
  const c = ceo();
  delete c.STORE.bonus_eval[`${Q}|mia|G4`].fx;   // Mia's FL action is not chosen yet: her bonus is 不足
  vm.runInContext("window._kevSel='mia'; window._karteTab='eval';", c);
  assert.ok(person(c, 'mia').blocked, 'not finished');
  const ev = run(c, 'kevTabHtml(kbCfg())');
  // in the person's header row (outside .kev-side, which phones hide), both buttons, whether or not the evaluation is finished
  const head = ev.slice(ev.indexOf('<div class="kev-main">'), ev.indexOf('<div class="card kev-side">'));
  assert.match(head, /class="kev-go"[^>]*><button class="btn btn-secondary btn-sm" onclick="kevOpenPerson\(&quot;mia&quot;,false\)"><i class="ti ti-user"><\/i> 個人ページ<\/button><button class="btn btn-secondary btn-sm" onclick="kevOpenPerson\(&quot;mia&quot;,true\)"><i class="ti ti-eye"><\/i> 本人に見せる表示<\/button>/);
  assert.doesNotMatch(ev.slice(ev.indexOf('<div class="card kev-side">')), /openKarteDetail\(/, 'the old button at the bottom right is shown only when finished');
  // 査定一覧: each name has its own button; it stops the row's click (the row still opens 個別評価)
  const list = run(c, 'kevListTableHtml(kbCfg(), bonusTotals(kbCfg()))');
  const rows = list.split('<tr').slice(2);
  assert.equal(rows.length, c.EMPS.length);
  for (const r of rows) {
    assert.match(r, /onclick="kevOpenEval\(&quot;(\w+)&quot;\)"/);
    const id = r.match(/kevOpenEval\(&quot;(\w+)&quot;\)/)[1];
    assert.ok(r.includes(`onclick="event.stopPropagation();kevOpenPerson(&quot;${id}&quot;,false)"`), id);
  }
  // opening: the self view or the person page (summary tab), and the text being typed is saved first
  install(c, 'karteSelfView');
  vm.runInContext("var FLUSHED=0; var _kft=kevFlushText; kevFlushText=function(){ FLUSHED++; return _kft.apply(this, arguments); }; window._karteDetTab='talk';", c);
  const r0 = c.RERENDER;
  run(c, 'kevOpenPerson("mia", true)');
  assert.deepEqual([c._karteViewEmp, c._karteSelf, c._karteDetTab, c.FLUSHED, c.RERENDER - r0], ['mia', true, 'sum', 1, 1]);
  run(c, 'kevOpenPerson("ray", false)');
  assert.deepEqual([c._karteViewEmp, c._karteSelf], ['ray', false]);
  run(c, 'kevOpenPerson("", true)');
  assert.equal(c._karteViewEmp, 'ray', 'no id: nothing happens');
});

test('v1075 UI案47 (Moto 10/13): while the evaluation is not finished, the self view shows how far it has got and the coefficients known so far', () => {
  const c = ceo();
  const P = id => { c.ID = id; return run(c, 'kevSelfProgress(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()), kbCfg(), getKarte(ID))'); };
  const H = (f, id) => { c.ID = id; return run(c, `${f}(EMPS.find(function(e){ return e.id===ID; }), bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg()), kbCfg()${f === 'kevSelfProgressHtml' ? ', getKarte(ID)' : ''})`); };
  const rows = p => p.rows.map(r => (r.ok ? '✓' : '·') + r.t + (r.sub ? '（' + r.sub + '）' : ''));
  // Mia (G4): the FL action is not chosen and the evaluation is a draft
  delete c.STORE.bonus_eval[`${Q}|mia|G4`].fx; c.STORE.bonus_eval[`${Q}|mia|G4`].st = 'draft';
  let p = P('mia');
  assert.deepEqual(rows(p), ['✓Career Score の評価', '✓売上の達成率', '·FL 管理（改善の取り組みを評価中です）', '·評価の完了（GM・CEO が評価を終えるまで）',
    '·査定の確定（全員の評価がそろったあと、会社全体で確定します）', '·ボーナスの記録（確定したあと、あなたの記録に入ります）']);
  assert.deepEqual([p.done, p.n, p.blocked], [2, 6, true]);
  const mh = H('kevSelfProgressHtml', 'mia');
  assert.match(mh, /今期の評価の進み具合/); assert.match(mh, /2026-Q3 ・ 2 \/ 6/); assert.match(mh, /width:33%/);
  assert.equal((mh.match(/>済み</g) || []).length, 2); assert.equal((mh.match(/>これから</g) || []).length, 4);
  const me = H('kevSelfExplainHtml', 'mia');
  assert.match(me, /基準額 \$5,000 × Career 1\.080 × 売上 1\.015 × FL <span style="color:var\(--muted\)">（評価中）<\/span> で決まります。評価が終わると金額が出ます。/);
  assert.doesNotMatch(me, /支給額|原資/, 'no amount and no pool while not finished');
  // Sam (G5): the evaluation is done, the September profit of one store is missing — only "waiting for the store numbers", no details
  c.STORE.bonus_store_q = { [`${Q}|S4`]: { tgt: { pa: 95000, pb: 'amt' }, act: acts([31000, 31000, null]), _at: 1 } };
  delete c.STORE.bonus_store_q[`${Q}|S4`].act['2026-09']; delete c.STORE.bonus_q[Q].profit.S4['2026-09'];
  p = P('sam');
  assert.deepEqual(rows(p).slice(0, 3), ['✓売上の達成率', '·利益の達成率（店舗の数字がそろうのを待っています）', '✓評価の完了']);
  assert.ok(!rows(p).some(r => /Career/.test(r)), 'G5: Career Score is not used, so it is not listed');
  const sh = H('kevSelfProgressHtml', 'sam') + H('kevSelfExplainHtml', 'sam');
  assert.match(sh, /利益 <span style="color:var\(--muted\)">（集計中）<\/span>/);
  assert.doesNotMatch(sh, /S4|9 月|9月|設定 ④|店舗管理利益が|未取得/, 'no store names, months or screen instructions for the staff member');
  // Ray: everything evaluated, the quarter not confirmed yet → the amount is an estimate and the card shows what is left
  p = P('ray');
  assert.deepEqual(rows(p), ['✓Career Score の評価', '✓FL 管理', '✓評価の完了', '·査定の確定（全員の評価がそろったあと、会社全体で確定します）', '·ボーナスの記録（確定したあと、あなたの記録に入ります）']);
  assert.match(H('kevSelfExplainHtml', 'ray'), /あなたの評価で決まる額は <b>\$/, 'not blocked: the full explanation as before');
  // confirmed but not recorded: 4 of 5; recorded: the card is gone
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx = { lv: 3, why: '発注の見直し', c_exec: true }; c.STORE.bonus_eval[`${Q}|mia|G4`].st = 'done';
  c.STORE.bonus_q[Q].profit.S4['2026-09'] = { a: 31000, t: 33334 };
  run(c, `bqLockQuarter('${Q}')`);
  p = P('ray');
  assert.deepEqual([p.done, p.n, p.locked], [4, 5, true]);
  assert.ok(p.rows.every(r => r.ok || r.t === 'ボーナスの記録'));
  c.STORE.growth_karte = { ray: { payLog: [{ id: 'q3', type: 'ボーナス', amount: 4000, quarter: Q, src: 'auto', _at: 1 }], _at: 1 } };
  assert.equal(H('kevSelfProgressHtml', 'ray'), '', 'recorded: the amount and how it was decided are shown instead');
  // G1 (no base amount) and quarters before 2026 Q3 get no card
  c.EMPS.push({ id: 'zoe', name: 'Zoe Sample', title: 'Crew', g: 'G1', store: 'S1', status: '在籍' });
  assert.equal(P('zoe'), null);
  // the self view: the tile says 評価中 instead of —, and the card sits under the tiles
  const src = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
  const sv = src.slice(src.indexOf('\nfunction renderKarteSelfView('), src.indexOf('\n}', src.indexOf('\nfunction renderKarteSelfView(')));
  assert.match(sv, /cur\.blocked\?'評価中':_money\(cur\.amt\)/);
  assert.match(sv, /cur\.blocked\?'・金額は評価のあと':'・査定中'/);
  assert.ok(sv.indexOf('kevSelfProgressHtml(e, b, cfg, k)') > sv.indexOf("_kTile('次期の目標'") && sv.indexOf('kevSelfProgressHtml(e, b, cfg, k)') < sv.indexOf('kdBonusTrendHtml('), 'under the tiles, above the bonus trend');
});
