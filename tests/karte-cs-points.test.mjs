// v1099 (UI案58 · Moto's answers 10/21: 1A, 2 "total score per grade — meeting the grade's base total gives 1.0", 3A–7A, 8A editable;
// step = 3% of the maximum; specialist/office base = the store base share × their maximum):
//  ① Career Score's official total score against the grade/track base points (the bonus-only 4-element evaluation is no longer used);
//  each item's coefficient is one of 0.85/0.90/0.95/1.00/1.05/1.10/1.15 (ties go to the upper step); the FL action adds ±0.05/±0.10;
//  the product is still held to 0.85–1.15; the special pool E is added to the normal pool P ("不足分を補う" adds only the current shortfall);
//  confirming freezes everything; the editable criteria guide keeps one source per language.
// Runs the real code from index.html (the FUNERGY_KARTE_EVAL and FUNERGY_CAREER_CRITERIA blocks) in a VM with the synthetic company of
// tests/karte-eval.test.mjs (fictional staff and numbers). No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
let fixture = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, person, Q } = await import('data:text/javascript;base64,' + Buffer.from(
  fixture + '\nexport { company, fn, person, Q };\n').toString('base64'));
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const runP = async (c, code) => J(await vm.runInContext(code, c));
const seg = (c, id) => person(c, id).segs[0];
const totals = c => run(c, 'kevTotals(kbCfg(), kevApplies(kbCfg()))');
const lastToast = c => (c.TOASTS.at(-1) || [''])[0];
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const LSS_GROUPS_SRC = (() => { const i = SRC.indexOf('\nconst LSS_GROUPS = {'), j = SRC.indexOf('\n};', i); return 'var' + SRC.slice(i + 6, j + 3); })();

// the synthetic company on the v1099 rules (2026 Q3): G4 people have an FL improvement action
function co(opts = {}) {
  const c = company(opts);
  vm.runInContext(LSS_GROUPS_SRC, c);
  vm.runInContext(`KEV2_START = '2026-Q3'; var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };`, c);
  for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${Q}|${id}|G4`].fx = { lv: 3, why: '発注量とシフトの見直し（7/15〜）', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
  return c;
}
// set n items of a category to v (the rest stay as they are)
const setItems = (c, name, cat, from, n, v) => { for (let i = from; i < from + n; i++) c.SCORES[name].scores[cat + i] = v; };
// move the total by n points: items at 2 go to 3 (n > 0) or to 1 (n < 0), category by category (A–G, H keeps its mix)
const SIZES = { A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 };
const shift = (c, name, n) => { let left = Math.abs(n); for (const [k, m] of Object.entries(SIZES)) { const t = Math.min(left, m); setItems(c, name, k, 0, t, n > 0 ? 3 : 1); left -= t; if (!left) break; } assert.equal(left, 0); };
// an independent oracle for ① : the number of steps from the base, held to ±3 and to the range
const oracleStep = (S, B, w) => S >= B ? Math.min(3, Math.floor((S - B) / w + 1e-9)) : -Math.min(3, Math.ceil((B - S) / w - 1e-9));
const oracleCoef = (S, B, w, lo = 0.85, hi = 1.15) => Math.round(Math.min(Math.max(1 + 0.05 * oracleStep(S, B, w), lo), hi) * 100) / 100;

test('① the official total score against the grade base: G3 294/420 (70%), one step = 13 points (3% of 420); ties go up', () => {
  const c = co();
  const ken = seg(c, 'ken');
  assert.equal(ken.gen, 3);
  assert.deepEqual([ken.items.c.score, ken.items.c.max, ken.items.c.base.bp, ken.items.c.base.bs, ken.items.c.step, ken.coefs.c], [284, 420, 294, 13, -1, 0.95]);
  assert.equal(person(c, 'ken').amount, Math.round(3000 * 0.95), 'G3: ① only');
  // the ladder of the G3 base: 333+ 1.15 / 320+ 1.10 / 307+ 1.05 / 294+ 1.00 / 281+ 0.95 / 268+ 0.90 / below 0.85
  const lad = run(c, 'kevCsLadder(294, 13, 0.85, 1.15)');
  assert.deepEqual(lad.map(r => [r.coef, r.from]), [[1.15, 333], [1.1, 320], [1.05, 307], [1, 294], [0.95, 281], [0.9, 268], [0.85, null]]);
  // exactly on the base and on each boundary → the upper step (5A)
  for (const [add, want] of [[10, 1], [9, 0.95], [23, 1.05], [22, 1], [49, 1.15], [80, 1.15], [-3, 0.95], [-4, 0.9], [-16, 0.9], [-17, 0.85], [-60, 0.85]]) {
    const c2 = co();
    const S = 284 + add;
    shift(c2, 'Ken Sample', add);
    const s = seg(c2, 'ken');
    assert.equal(s.items.c.score, S, 'total ' + S);
    assert.equal(s.coefs.c, want, 'total ' + S);
    assert.equal(want, oracleCoef(S, 294, 13), 'the oracle agrees at ' + S);
  }
  // random totals and bases: the code equals the oracle
  let seed = 11; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const B = Math.round(50 + rnd() * 350), w = 1 + Math.round(rnd() * 20), S = Math.round(rnd() * 420);
    assert.equal(run(c, `kevCsStep(${S}, ${B}, ${w})`), oracleStep(S, B, w), `S=${S} B=${B} w=${w}`);
  }
});

test('① total, not per category: two people with the same total get the same coefficient however it is made up (Moto: 人によって得意な事が違う)', () => {
  const a = co(), b = co();
  setItems(a, 'Ken Sample', 'A', 0, 10, 3);   // +10 in A
  setItems(b, 'Ken Sample', 'G', 0, 10, 3);   // +10 in G
  assert.deepEqual([seg(a, 'ken').items.c.score, seg(b, 'ken').items.c.score], [294, 294]);
  assert.deepEqual([seg(a, 'ken').coefs.c, seg(b, 'ken').coefs.c], [1, 1]);
  // the category table still shows each category against the promotion-line base (reference only)
  const cats = seg(a, 'ken').items.c.total.cats;
  assert.equal(cats.length, 8);
  assert.ok(cats.every(x => x.un === 0));
});

test('① what is counted: G2 = H·A·B·C (225 points, base 135 = 60%, step 7), G3 and above = all eight (420); unscored items are 未評価, never 0', () => {
  const c = co();
  const aki = seg(c, 'aki');
  assert.deepEqual([aki.items.c.max, aki.items.c.base.bp, aki.items.c.base.bs, aki.items.c.total.keys.slice().sort().join('')], [225, 135, 7, 'ABCH']);
  assert.deepEqual([aki.items.c.score, aki.items.c.step, aki.coefs.c], [152, 2, 1.1]);
  // an unscored item in D (not counted for G2) changes nothing
  delete c.SCORES['Aki Sample'].scores.D3;
  assert.equal(seg(c, 'aki').coefs.c, 1.1);
  // an unscored item in A (counted) → 未評価: no coefficient, no amount, the reason names the category; it is not counted as 0
  delete c.SCORES['Aki Sample'].scores.A0;
  const p = person(c, 'aki');
  assert.equal(p.blocked, 'eval');
  assert.equal(p.segs[0].items.c.coef, null);
  assert.match(p.missing.join(), /未評価の項目が 1 あります.*0 点では数えません/);
  // for G3 the D item counts
  const c2 = co();
  delete c2.SCORES['Ken Sample'].scores.D3;
  assert.equal(person(c2, 'ken').blocked, 'eval');
  assert.equal(totals(c2).nBlocked, 1);
});

test('① which evaluation: the official score dated in the quarter; an older date is not used (no fill-in from another period); a v1099 freeze is used', () => {
  const c = co();
  c.SCORES['Ken Sample'].date = '2026/06/20';
  const p = person(c, 'ken');
  assert.equal(p.blocked, 'eval');
  assert.match(p.missing.join(), /評価日（6\/20）が四半期の初日より前です/);
  // no evaluation at all → 評価がありません (not 0)
  const c2 = co();
  delete c2.SCORES['Ken Sample'];
  assert.match(person(c2, 'ken').missing.join(), /Career Score の評価がありません/);
  // a v1099 freeze of the quarter (kv 2, unscored count per category) is used before the latest score
  const c3 = co();
  const cats = run(c3, `lssSummary('Ken Sample').cats`).map(x => ({ key: x.key, score: x.score, max: x.max }));
  cats.find(x => x.key === 'A').score += 13;
  c3.STORE.bonus_q[Q].csFreeze = { ken: { kv: 2, date: '2026-09-28', ev: 'AM', hUn: 0, cun: Object.fromEntries(cats.map(x => [x.key, 0])), cats } };
  const s3 = seg(c3, 'ken');
  assert.deepEqual([s3.items.c.total.src, s3.items.c.score, s3.coefs.c], ['frozen', 297, 1]);
  // a freeze made before v1099 (no per-category unscored count) is not used: the latest score decides
  c3.STORE.bonus_q[Q].csFreeze.ken.kv = 1; delete c3.STORE.bonus_q[Q].csFreeze.ken.cun;
  assert.deepEqual([seg(c3, 'ken').items.c.total.src, seg(c3, 'ken').items.c.score], ['latest', 284]);
});

test('① specialists (部門別 96 points) and office staff (100 points): the store base share × their maximum; one step likewise', () => {
  const c = co();
  // Ray (Head Chef → 調理): a department sheet of 8 axes × 4 items
  c.SPEC = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(k => ({ key: k, name: k, en: k, icon: 'ti-star', items: ['1', '2', '3', '4'] }));
  vm.runInContext(`lssCatsForName = function(n){ return n === 'Ray Sample' ? SPEC : lssCatsOrdered(); };`, c);
  const ray = seg(c, 'ray');
  assert.equal(ray.items.c.total.sheet, 'spec');
  assert.deepEqual([ray.items.c.max, ray.items.c.base.bp, ray.items.c.base.bs], [96, 72, 3], 'ceil(315 × 96 / 420) = 72, round(13 × 96 / 420) = 3');
  assert.deepEqual([ray.items.c.score, ray.items.c.step, ray.coefs.c], [68, -2, 0.9]);
  // the G4 store base changed for the grade → the specialist base follows the same share
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, bp: 294, g2: 1, g3: 1 } }, _at: 1 } };
  assert.equal(seg(c, 'ray').items.c.base.bp, Math.ceil(294 * 96 / 420 - 1e-9));
  // a personal base in the person's own points wins
  c.STORE.bonus_eval_ovr['ray|2026-Q3'].set.c = { on: true, lo: 0.85, hi: 1.15, bp: 66, bs: 2, g2: 1, g3: 1 };
  assert.deepEqual([seg(c, 'ray').items.c.base.bp, seg(c, 'ray').items.c.base.bs, seg(c, 'ray').coefs.c], [66, 2, 1.05]);
  // office: Ken on the office Career Score (G3: 70 of 100, step 3)
  const o = co();
  o.OCS['Ken Sample'] = true;
  const ocs = (total, uc = 0) => { o.OCS['ev:ken'] = { conf: { at: '2026-09-29T10:00:00Z', by: 'CEO' }, state: { k: 'ok', calc: { total, counts: { uc } } } }; return seg(o, 'ken'); };
  let s = ocs(72);
  assert.deepEqual([s.items.c.total.sheet, s.items.c.max, s.items.c.base.bp, s.items.c.base.bs, s.coefs.c], ['office', 100, 70, 3, 1]);
  assert.equal(ocs(73).coefs.c, 1.05);
  assert.equal(ocs(69).coefs.c, 0.95);
  assert.equal(ocs(80, 2).items.c.coef, null, 'unscored office items: 未評価');
  o.OCS['ev:ken'].state.k = 'prov';
  assert.match(person(o, 'ken').missing.join(), /まだ確定していません/);
});

test('7 levels: saved ranges must be on 0.85–1.15 by 0.05 with 1.00 inside; others block with 設定の確認が必要 and are listed, never converted', () => {
  const c = co();
  // a v1065-era ① range (copied from the old grade coefficient range) is not used: ① starts at 0.85–1.15 (3A)
  c.STORE.bonus_eval_rule = { 'G3-sv|2026-Q3': { set: { c: { on: true, lo: 0.7, hi: 1.3 } }, _at: 1 } };
  assert.deepEqual([seg(c, 'ken').items.c.rule.lo, seg(c, 'ken').items.c.rule.hi, person(c, 'ken').blocked], [0.85, 1.15, null]);
  // a range saved by v1074–v1098 (g2) that is not on the 7 levels: kept as it is, the person is blocked, the list shows it
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { s: { on: true, lo: 0.975, hi: 1.05, g2: 1 } }, _at: 1 } };
  const mia = person(c, 'mia');
  assert.equal(mia.blocked, 'eval');
  assert.match(mia.missing.join(), /設定の確認が必要/);
  const M = run(c, `kevMisfits3('${Q}')`);
  assert.ok(M.block.some(x => /G4.*② 売上.*0\.975〜1\.05/.test(x.t)), JSON.stringify(M.block));
  assert.equal(c.STORE.bonus_eval_rule['G4|2026-Q3'].set.s.lo, 0.975, 'not converted');
  // a range that does not contain 1.00 is not allowed either
  assert.match(run(c, 'kevRange3Bad({on:true, lo:1.05, hi:1.15})'), /1\.00 を含む/);
  assert.equal(run(c, 'kevRange3Bad({on:true, lo:0.9, hi:1.1})'), '');
  assert.equal(run(c, 'kevRange3Bad({on:false, lo:0.975, hi:1.05})'), '', '1.00 fixed: the saved range does not matter');
  // the company rule: final range and FL action must be on 0.05 steps
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { j: { clo: 0.8, chi: 1.2, a5: 7, g3: 1 } }, _at: 1 } };
  assert.match(run(c, `kevJ3Bad(kevJ3(kevRuleFor(null, '${Q}').r))`), /最終係数の幅 0\.80〜1\.20 は.*／FL 改善行動の調整率は 0\.05/);
  assert.equal(person(c, 'aki').blocked, 'eval', 'everyone waits until the company rule is chosen again');
});

test('②③④ 0.05 steps: the conversion table equals the coefficient, ties go up; FL action ±0.05/±0.10 is added and held to the FL range', () => {
  const c = co();
  const J = run(c, `kevJ3(kevRuleFor(null, '${Q}').r)`);
  assert.deepEqual([J.step, J.a5, J.a4, J.a3, J.a2, J.a1, J.clo, J.chi], [5, 10, 5, 0, -5, -10, 0.85, 1.15]);
  for (const [lo, hi, pts] of [[0.95, 1.05, [90, 100, 110]], [0.9, 1.1, [90, 100, 110]], [0.85, 1.15, [90, 100, 110]], [0.95, 1.05, [-2, 0, 2]]]) {
    const rows = run(c, `kevThresh3(${lo}, ${hi}, ${pts.join(',')})`);
    for (const r of rows) {
      const at = r.from == null ? pts[0] - 50 : r.from + 1e-6;   // the table's "以上" value (stored to 6 decimals)
      assert.equal(run(c, `kevCoef2(${at}, {lo:${lo}, hi:${hi}}, ${JSON.stringify(pts)}, kevJ3({}))`), r.coef, `at ${at} on ${lo}–${hi}`);
      if (r.from != null) assert.ok(run(c, `kevCoef2(${r.from - 0.01}, {lo:${lo}, hi:${hi}}, ${JSON.stringify(pts)}, kevJ3({}))`) < r.coef, 'just below is the lower step');
    }
  }
  // the table shows a boundary that does not end at 2 decimals with "…" (108.333…% is not shown as a reachable 108.33%)
  const th = run(c, `kevThreshHtml(kevThresh3(0.85, 1.15, 90, 100, 110), '%')`).replace(/<[^>]+>/g, ' ');
  assert.match(th, /108\.33…% 以上/);
  assert.match(th, /105% 以上・108\.33…% 未満/);
  // 102.5% on 0.95–1.05 is exactly between 1.00 and 1.05 → 1.05 (upper step); 102.49% → 1.00
  assert.equal(run(c, 'kevCoef2(105, {lo:0.95, hi:1.05}, [90,100,110], kevJ3({}))'), 1.05);
  assert.equal(run(c, 'kevCoef2(102.5, {lo:0.9, hi:1.1}, [90,100,110], kevJ3({}))'), 1.05);
  assert.equal(run(c, 'kevCoef2(102.49, {lo:0.9, hi:1.1}, [90,100,110], kevJ3({}))'), 1);
  // Mia (G4) with FL range 0.85–1.15: the number is 1.00 (0.1pt over the target), the action adds its step
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { f: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1 } }, _at: 1 } };
  const fl = lv => { c.STORE.bonus_eval[`${Q}|mia|G4`].fx.lv = lv; return seg(c, 'mia').items.f; };
  assert.deepEqual([5, 4, 3, 2, 1].map(lv => fl(lv).coef), [1.1, 1.05, 1, 0.95, 0.9]);
  assert.equal(fl(3).num, 1);
  // the default FL range 0.95–1.05 holds it
  c.STORE.bonus_eval_rule = {};
  assert.deepEqual([fl(5).coef, fl(5).capped, fl(1).coef], [1.05, true, 0.95]);
  // a plus step needs 実行状況 (a plan alone does not raise it)
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.c_exec = false;
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.lv = 5;
  assert.match(person(c, 'mia').missing.join(), /実行状況/);
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.lv = 2;
  assert.doesNotMatch(person(c, 'mia').missing.join(), /実行状況/, 'a minus step does not need it');
});

test('6A: the product is still held to the final range 0.85–1.15 (per person), before the pool adjustment', () => {
  const c = co();
  setItems(c, 'Mia Sample', 'A', 0, 18, 3); setItems(c, 'Mia Sample', 'B', 0, 18, 3); setItems(c, 'Mia Sample', 'C', 0, 21, 3); setItems(c, 'Mia Sample', 'D', 0, 17, 3);
  setItems(c, 'Mia Sample', 'E', 0, 24, 3); setItems(c, 'Mia Sample', 'F', 0, 12, 3); setItems(c, 'Mia Sample', 'G', 0, 12, 3); setItems(c, 'Mia Sample', 'H', 0, 18, 3);
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { s: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1 }, f: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1 } }, _at: 1 } };
  c.STORE.bonus_eval[`${Q}|mia|G4`].fx.lv = 5;
  const s = seg(c, 'mia');
  assert.deepEqual([s.coefs.c, s.coefs.s, s.coefs.f], [1.15, 1.05, 1.1]);
  assert.equal(s.clamped, true);
  assert.equal(person(c, 'mia').amount, 5750, '5000 × 1.15 (not × 1.328)');
});

test('the old bonus-only evaluation (能力・知識・仕事の質) no longer changes the estimate; the v1098 comparison still uses it and ignores v1099 settings', () => {
  const c = co();
  const a0 = totals(c).total;
  for (const id of ['aki', 'ken', 'neo', 'mia', 'ray']) { const k = Object.keys(c.STORE.bonus_eval).find(x => x.includes(`|${id}|`)); Object.assign(c.STORE.bonus_eval[k], { ab: { lv: 5, ev: 'x' }, kn: { lv: 5, ev: 'x' }, qu: { lv: 5, ev: 'x' } }); }
  assert.equal(totals(c).total, a0, 'the 4-element levels do not move the v1099 amounts');
  const C = run(c, 'kevCompare3(kbCfg(), kevApplies(kbCfg()))');
  const ken = C.rows.find(r => r.e.id === 'ken');
  assert.notEqual(ken.old.amount, ken.now.amount);
  assert.equal(ken.now.amount, Math.round(3000 * 0.95));
  // a v1099 save (g3) is not used by the v1098 comparison
  const old0 = ken.old.amount;
  c.STORE.bonus_eval_rule = { 'G3-sv|2026-Q3': { set: { c: { on: false, lo: 0.85, hi: 1.15, g2: 1, g3: 1 } }, _at: 1 } };
  const C2 = run(c, 'kevCompare3(kbCfg(), kevApplies(kbCfg()))');
  assert.equal(C2.rows.find(r => r.e.id === 'ken').old.amount, old0);
  assert.equal(C2.rows.find(r => r.e.id === 'ken').now.amount, 3000, 'the v1099 setting (① fixed) applies to the new rules');
});

test('special pool (request cases): P $10,000 / S $12,000 → shortfall $2,000, k = 10000/12000; "不足分を補う" adds only that, once', async () => {
  const c = co();
  c.EMPS = c.EMPS.filter(e => e.id === 'gus');   // G6: ② ④ at 1.00 → S = $12,000
  c.POOL = 10000;
  let t = totals(c);
  assert.deepEqual([t.total, t.poolP, t.extra, t.cap, t.short, t.k], [12000, 10000, 0, 10000, 2000, 10000 / 12000]);
  assert.equal(t.paid, 10000, 'never over the cap');
  // the store filter of the evaluation tab does not change the shortfall or k (everyone in the same pool)
  vm.runInContext(`window._kevF = { store: 'S1' };`, c);
  assert.deepEqual([totals(c).short, totals(c).k], [2000, 10000 / 12000]);
  vm.runInContext(`window._kevF = {};`, c);
  // fill
  assert.equal(await runP(c, `kevPxFill('${Q}', 2000, 0)`), true);
  t = totals(c);
  assert.deepEqual([t.extra, t.cap, t.short, t.k, t.paid], [2000, 12000, 0, 1, 12000]);
  const rec = c.STORE.bonus_pool_extra[Q];
  assert.deepEqual([rec.v, rec.kind, rec.hist.length, rec.hist[0].prev, rec.hist[0].D], [2000, 'fill', 1, 0, 2000]);
  assert.match(rec.why, /不足分を補う/);
  // pressing again (the same old numbers): nothing more is added
  assert.equal(await runP(c, `kevPxFill('${Q}', 2000, 0)`), false);
  assert.equal(totals(c).extra, 2000);
  assert.match(lastToast(c), /不足はありません/);
  // later the total rises: nothing is added automatically
  c.STORE.karte_bonus_config = { gradeBase: { G2: 1000, G3: 3000, G4: 5000, G5: 8000, G6: 13000 } };
  t = totals(c);
  assert.deepEqual([t.extra, t.short, t.k], [2000, 1000, 12000 / 13000]);
});

test('special pool: E $500 → shortfall $1,500 → E $2,000, k 1.00; a changed number or E on another device is not added', async () => {
  const c = co();
  c.EMPS = c.EMPS.filter(e => e.id === 'gus'); c.POOL = 10000;
  run(c, `kevPxWrite('${Q}', 500, '臨時の売上', 'set', 0, null)`);
  let t = totals(c);
  assert.deepEqual([t.extra, t.cap, t.short], [500, 10500, 1500]);
  const at = c.STORE.bonus_pool_extra[Q]._at;
  // a stale shortfall (the screen showed $2,000) → not added
  assert.equal(await runP(c, `kevPxFill('${Q}', 2000, ${at})`), false);
  assert.match(lastToast(c), /新しい不足額は \$1,500\.00/);
  // a stale record time (E changed on another device) → not added
  assert.equal(await runP(c, `kevPxFill('${Q}', 1500, 0)`), false);
  assert.equal(totals(c).extra, 500);
  assert.equal(await runP(c, `kevPxFill('${Q}', 1500, ${at})`), true);
  t = totals(c);
  assert.deepEqual([t.extra, t.short, t.k], [2000, 0, 1]);
  // the write itself refuses a stale record time (two devices)
  assert.equal(run(c, `kevPxWrite('${Q}', 900, 'x', 'set', ${at}, null)`).conflict, true);
  assert.equal(totals(c).extra, 2000);
  // GM/CEO only (the same as the normal pool)
  c.curRole = 'am';
  assert.equal(await runP(c, `Promise.resolve(kevPxFill('${Q}', 1, 0))`), false);
  assert.match(lastToast(c), /GM・CEO/);
});

test('special pool: 試算未完了 while someone is incomplete (fill and confirm stop, the draft can be saved); unset P is not $0; S = 0 → k = 1', async () => {
  const c = co();
  c.EMPS = c.EMPS.filter(e => e.id === 'gus' || e.id === 'ken'); c.POOL = 10000;
  delete c.SCORES['Ken Sample'].scores.A0;
  let t = totals(c);
  assert.deepEqual([t.nBlocked, t.short], [1, null]);
  assert.equal(await runP(c, `Promise.resolve(kevPxFill('${Q}', 0, 0))`), false);
  assert.match(lastToast(c), /試算未完了/);
  assert.equal(run(c, `kevLockProblems(kevTotals(kbCfg(), kevApplies(kbCfg()))).length > 0`), true);
  // the draft (amount and reason) can be saved
  Object.assign(c.DOM, { 'kpx-v': { value: '1,250.50' }, 'kpx-why': { value: '年末の特別配分' }, 'kpx-at': { value: '0' } });
  await runP(c, `Promise.resolve(kevPxSaveUi('${Q}'))`);
  assert.equal(totals(c).extra, 1250.5);
  // bad amounts are refused
  for (const v of ['-1', '12.345', 'abc']) { c.DOM['kpx-v'].value = v; c.DOM['kpx-at'].value = String(c.STORE.bonus_pool_extra[Q]._at); assert.equal(await runP(c, `Promise.resolve(kevPxSaveUi('${Q}'))`), false, v); }
  // unset P: no shortfall and no confirm (not treated as $0)
  c.POOL = null;
  t = totals(c);
  assert.deepEqual([t.poolKnown, t.cap, t.k], [false, null, null]);
  assert.match(run(c, 'kevLockProblems(kevTotals(kbCfg(), kevApplies(kbCfg())))').join(), /原資が未設定/);
  // S = 0 → k = 1
  assert.deepEqual(run(c, 'kevAlloc([{id:"a", raw:0}], 100)'), { k: 1, finals: { a: 0 }, sum: 0, S: 0, P: 100 });
});

test('the cap with cents: $1 payouts never exceed P + E; a whole-dollar cap gives the same as before', () => {
  const c = co();
  let seed = 5; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rnd() * 9), list = Array.from({ length: n }, (_, j) => ({ id: 'p' + j, raw: Math.round(500 + rnd() * 9000) }));
    const S = list.reduce((a, x) => a + x.raw, 0), cap = Math.round(S * (0.5 + rnd() * 0.6) * 100) / 100;
    const A = run(c, `kevAlloc(${JSON.stringify(list)}, ${cap})`);
    assert.ok(A.sum <= cap + 1e-9, `sum ${A.sum} ≤ cap ${cap}`);
    if (cap < S) assert.equal(A.sum, Math.floor(cap), 'everything up to the whole dollar is paid');
    else assert.equal(A.sum, S);
    assert.ok(Object.values(A.finals).every(v => Number.isInteger(v)));
  }
});

test('confirming freezes ① (total, base, step), the coefficients, P, E and the cap; later changes do not move the confirmed amounts', () => {
  const c = co();
  c.EMPS = c.EMPS.filter(e => ['gus', 'ken'].includes(e.id)); c.POOL = 10000;
  run(c, `kevPxWrite('${Q}', 300, '特別', 'set', 0, null)`);
  const before = totals(c);
  run(c, `bqLockQuarter('${Q}')`);
  const d = run(c, `bqGet('${Q}')`);
  assert.equal(d.locked, true);
  assert.deepEqual([d.evSnap.gen, d.evSnap.P, d.evSnap.E, d.evSnap.cap], [3, 10000, 300, 10300]);
  const snapKen = d.evSnap.people.ken;
  assert.deepEqual([snapKen.segs[0].gen, snapKen.segs[0].items.c.score, snapKen.segs[0].items.c.base.bp, snapKen.segs[0].items.c.step, snapKen.segs[0].items.c.coef], [3, 284, 294, -1, 0.95]);
  const after0 = totals(c);
  assert.deepEqual([after0.gen3, after0.extra, after0.cap, after0.paid, after0.finals], [true, 300, 10300, before.paid, before.finals]);
  // change everything afterwards
  setItems(c, 'Ken Sample', 'A', 0, 18, 3);
  c.STORE.bonus_pool_extra[Q].v = 5000;
  c.POOL = 20000;
  c.STORE.bonus_eval_rule = { 'G3-sv|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, bp: 200, g2: 1, g3: 1 } }, _at: 1 } };
  const after = totals(c);
  assert.deepEqual([after.extra, after.cap, after.paid, after.finals], [300, 10300, before.paid, before.finals]);
  assert.equal(person(c, 'ken').segs[0].coefs.c, 0.95);
  // the freeze keeps the unscored count per category (kv 2)
  assert.equal(d.csFreeze.ken.kv, 2);
  assert.equal(typeof d.csFreeze.ken.cun.A, 'number');
});

test('a quarter confirmed with the v1074–v1098 rules stays as it was (not recomputed with v1099)', () => {
  const c = co();
  c.EMPS = c.EMPS.filter(e => ['gus', 'ken'].includes(e.id));
  vm.runInContext(`KEV3_START = '2099-Q1';`, c);   // a device still on v1098
  run(c, `bqLockQuarter('${Q}')`);
  const t0 = totals(c);
  assert.equal(run(c, `bqGet('${Q}').evSnap.gen`), 2);
  vm.runInContext(`KEV3_START = '2026-Q3';`, c);   // updated to v1099
  const t1 = totals(c);
  assert.deepEqual([t1.gen3, t1.extra, t1.paid, t1.finals], [false, 0, t0.paid, t0.finals]);
  assert.equal(person(c, 'ken').segs[0].coefs.c, t0.rows.find(r => r.e.id === 'ken').b.segs[0].coefs.c);
});

test('the settings form (v1099): 7-level selects, base points within the maximum, the j rule with ±0.05 steps; marks g2 and g3', () => {
  const c = co();
  c.DOM['@kevf-on'] = { value: '1' };
  Object.assign(c.DOM, { 'kevf-lo': { value: '0.90' }, 'kevf-hi': { value: '1.10' }, 'kevf-bp': { value: '300' }, 'kevf-bs': { value: '' } });
  vm.runInContext(`window._kevForm = { kind:'rule', scope:'G4', part:'c', pre:'kevf-', q:'${Q}', cs:{ max:420, sheet:'store', def:{ bp:315, bs:13 }, own:{} } };`, c);
  let set = run(c, `kevFormRead('c', 'kevf-')`);
  assert.deepEqual(set, { c: { on: true, lo: 0.9, hi: 1.1, g2: 1, g3: 1, bp: 300, bs: null } });
  assert.equal(run(c, `kevFormBad('c', ${JSON.stringify(set)})`), '');
  c.DOM['kevf-bp'].value = '421';
  assert.match(run(c, `kevFormBad('c', kevFormRead('c', 'kevf-'))`), /基準得点は 0〜420 点/);
  c.DOM['kevf-bp'].value = '300'; c.DOM['kevf-lo'].value = '';   // the select showed "合わない・選び直す"
  assert.match(run(c, `kevFormBad('c', kevFormRead('c', 'kevf-'))`), /7 種類から選んでください/);
  c.DOM['kevf-lo'].value = '1.05';
  assert.match(run(c, `kevFormBad('c', kevFormRead('c', 'kevf-'))`), /1\.00 を含む/);
  // the saved part is used by v1099 (g3) and ignored by the v1098 comparison
  c.DOM['kevf-lo'].value = '0.90';
  assert.equal(run(c, `kevRuleSave('G4', '${Q}', kevFormRead('c', 'kevf-'), 'テスト', '① を変更')`), true);
  assert.deepEqual(run(c, `[kevRuleFor('G4', '${Q}').r.c.lo, kevRuleFor('G4', '${Q}').r.c.bp, kevRuleFor('G4', '${Q}', null, null, null, true).r.c.bp == null]`), [0.9, 300, true]);
  // the company rule (j)
  vm.runInContext(`window._kevForm = { kind:'rule', scope:'_common', part:'j', pre:'kevf-', q:'${Q}' };`, c);
  Object.assign(c.DOM, { 'kevf-j_sx0': { value: '90' }, 'kevf-j_sx1': { value: '100' }, 'kevf-j_sx2': { value: '110' }, 'kevf-j_fpt': { value: '2' }, 'kevf-j_pd': { value: '5' },
    'kevf-j_clo': { value: '0.85' }, 'kevf-j_chi': { value: '1.15' }, 'kevf-j_a5': { value: '15' }, 'kevf-j_a4': { value: '5' }, 'kevf-j_a3': { value: '0' }, 'kevf-j_a2': { value: '-5' }, 'kevf-j_a1': { value: '-15' } });
  set = run(c, `kevFormRead('j', 'kevf-')`);
  assert.equal(set.j.g3, 1); assert.equal(set.j.step, undefined, 'the step is fixed (not saved)');
  assert.equal(run(c, `kevFormBad('j', ${JSON.stringify(set)})`), '');
  c.DOM['kevf-j_a4'].value = '-5';
  assert.match(run(c, `kevFormBad('j', kevFormRead('j', 'kevf-'))`), /非常に優秀 ≧ 十分に実行/);
});

test('criteria guide: initial drafts for 35 groups, 8 categories × G2–G5 and 16 department axes; saving one language keeps the other; reset; conflicts; GM/CEO only', () => {
  const c = co();
  const D = run(c, 'CS_GUIDE_DEF');
  assert.equal(Object.keys(D.groups).length, 35);
  assert.equal(Object.keys(D.expect).length, 32);
  assert.equal(Object.keys(D.spec).length, 16);
  for (const [k, g] of Object.entries(D.groups)) {
    assert.ok(g.what && g.lv.length === 4 && g.ex.length === 4 && g.cm.length === 2, k);
    for (const x of [g.what, ...g.lv, ...g.ex, ...g.cm]) assert.ok(Array.isArray(x) && x[0] && x[1], k + ' has ja and en');
  }
  // every LSS group has a draft
  const groups = run(c, 'LSS_GROUPS');
  for (const [cat, gs] of Object.entries(groups)) gs.forEach((_, i) => assert.ok(D.groups[cat + '|' + i], cat + '|' + i));
  // read: the draft until edited
  let g = run(c, `csgGet('grp|A|0', 'ja')`);
  assert.equal(g.edited, false);
  assert.equal(g.what, D.groups['A|0'].what[0]);
  // save Japanese, then English with its own record time: both stay
  assert.equal(run(c, `csgSaveRec('grp|A|0', 'ja', {what:'新しい説明', lv:['','','',''], ex:['','','',''], cm:['','']}, '言葉を直した', 0)`).ok, true);
  const atEn = run(c, `csgGet('grp|A|0', 'en')._at`);
  assert.equal(run(c, `csgSaveRec('grp|A|0', 'en', {what:'New text', lv:['','','',''], ex:['','','',''], cm:['','']}, 'wording', ${atEn})`).ok, true);
  assert.deepEqual([run(c, `csgGet('grp|A|0', 'ja').what`), run(c, `csgGet('grp|A|0', 'en').what`)], ['新しい説明', 'New text']);
  assert.equal(run(c, `csgGet('grp|A|0', 'ja').lv[2]`), D.groups['A|0'].lv[2][0], 'an empty field shows the draft');
  // a stale record time is refused
  assert.equal(run(c, `csgSaveRec('grp|A|0', 'ja', {what:'古い画面'}, 'x', 0)`).conflict, true);
  // two devices: one edits Japanese, the other English → the merge keeps both
  const a = co(), b = co();
  run(a, `csgSaveRec('grp|B|1', 'ja', {what:'A の端末'}, 'x', 0)`);
  run(b, `csgSaveRec('grp|B|1', 'en', {what:'Device B'}, 'x', 0)`);
  a.M1 = J(a.STORE.cs_guide); a.M2 = J(b.STORE.cs_guide);
  a.STORE.cs_guide = run(a, 'mergeMapByTime(M1, M2)');
  assert.deepEqual([run(a, `csgGet('grp|B|1', 'ja').what`), run(a, `csgGet('grp|B|1', 'en').what`)], ['A の端末', 'Device B']);
  // reset
  const atJa = run(c, `csgGet('grp|A|0', 'ja')._at`);
  assert.equal(run(c, `csgSaveRec('grp|A|0', 'ja', {}, '戻す', ${atJa}, true)`).ok, true);
  assert.equal(run(c, `csgGet('grp|A|0', 'ja').what`), D.groups['A|0'].what[0]);
  assert.equal(run(c, `csgGet('grp|A|0', 'en').what`), 'New text');
  // GM/CEO only
  c.curRole = 'am';
  assert.equal(run(c, 'csgCan()'), false);
});
