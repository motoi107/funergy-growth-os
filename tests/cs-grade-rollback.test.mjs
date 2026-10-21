// v1100 (Codex review of 34d2ed9, P1): saving a G2 setting in v1100 and then going back to v1099 must not put the 420-point
// base (e.g. 252 / 13) into v1099's 225-point computation (G2 = H·A·B·C there).
// v1100 writes the ① base / step to bp8 / bs8 (mark b8) and never to bp / bs — the fields v1099 reads; the v1099 values stay as they were.
// Runs the real v1100 code (this working tree, or FUNERGY_INDEX) and the real v1099 code (index.html of the v1099 release c79e322,
// read from the local git history with `git show`: read-only, no network) on the synthetic company of tests/karte-eval.test.mjs
// (fictional staff and numbers). No production data, no browser storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const V1100 = process.env.FUNERGY_INDEX || path.join(root, 'index.html');
const V1099_COMMIT = 'c79e3226d7d3166bb07c8324932090dfb466db5b';   // main after PR #84 (the v1099 release)
let v1099src;
try {
  v1099src = execFileSync('git', ['show', `${V1099_COMMIT}:index.html`], { cwd: root, encoding: 'utf8', maxBuffer: 3e7 });
} catch (err) {
  throw new Error(`this test reads index.html of the v1099 release ${V1099_COMMIT} from the local git history (git fetch --unshallow): ${err.message}`);
}
assert.match(v1099src, /const APP_VERSION = '1099';/);
const V1099 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'funergy-v1099-')), 'index.html');
fs.writeFileSync(V1099, v1099src);

const fixtureSrc = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
async function harness(file) {
  const src = fixtureSrc.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(file) + ';');
  const m = await import('data:text/javascript;base64,' + Buffer.from(src + '\nexport { company, person, Q };\n').toString('base64'));
  const S = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const i = S.indexOf('\nconst LSS_GROUPS = {'), j = S.indexOf('\n};', i);
  const groups = 'var' + S.slice(i + 6, j + 3);
  const co = () => {
    const c = m.company();
    vm.runInContext(groups, c);
    vm.runInContext(`KEV2_START = '2026-Q3'; var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };`, c);
    for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${m.Q}|${id}|G4`].fx = { lv: 3, why: '発注量とシフトの見直し（7/15〜）', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
    c.curRole = 'gm';
    return c;
  };
  return { co, person: m.person, Q: m.Q };
}
const N = await harness(V1100), O = await harness(V1099);
const Q = N.Q;
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };

// the ① of one person: [maximum, base, step, coefficient, blocked]
const one = (h, c, id) => { const p = h.person(c, id), s = p.segs[0], x = s.items.c; return [x.max, x.base.bp, x.base.bs, s.coefs.c, p.blocked]; };
// the same company on v1099 with the given saved settings (copied the way the sync would bring them)
const onV1099 = (store, id) => { const c = O.co(); for (const k of ['bonus_eval_rule', 'bonus_eval_ovr']) if (store[k]) c.STORE[k] = J(store[k]); return one(O, c, id); };
const BEFORE = { aki: onV1099({}, 'aki'), mia: onV1099({}, 'mia') };

// the GM enters the ① values on the real v1100 form and saves
function saveForm(c, open, vals) {
  run(c, open);
  c.DOM['@kevf-on'] = { value: '1' };
  Object.assign(c.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: vals.bp ?? '' }, 'kevf-bs': { value: vals.bs ?? '' },
    'kevf-why': { value: '試験：v1100 で入れ直し' }, 'kevf-from': { value: Q } });
  c.TOASTS.length = 0;
  run(c, 'kevFormSave()');
  assert.match(String((c.TOASTS.at(-1) || [''])[0]), /保存しました/, JSON.stringify(c.TOASTS));
}

test('v1099 (the real code) on the synthetic company: G2 is H·A·B·C = 225 points, default base 135 · step 7; a v1099-shaped 252 / 13 would break it (what 34d2ed9 wrote)', () => {
  assert.deepEqual(BEFORE.aki, [225, 135, 7, 1.1, null]);   // 152 points: 2 steps above 135
  assert.deepEqual(BEFORE.mia, [420, 315, 13, 0.85, null]);   // G4: 281 points, 3 steps below 315
  // 34d2ed9 saved { bp:252, bs:13, cs8:1 } — v1099 reads bp / bs as they are: 152 on 225 against 252 → −3 steps → 0.85
  assert.deepEqual(onV1099({ bonus_eval_rule: { [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 252, bs: 13, cs8: 1 } }, _at: 1 } } }, 'aki'), [225, 252, 13, 0.85, null]);
});

test('Codex P1: G2 saved in v1100 (260 / 13) → back to v1099: v1099 computes exactly as before v1100 (225 points, 135 / 7); v1100 uses 260 / 13', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual(one(N, c, 'aki'), [420, 260, 13, 1.05, null]);   // 282 on 420
  assert.deepEqual(onV1099(c.STORE, 'aki'), BEFORE.aki);            // 34d2ed9: [225, 260, 13, 0.85, null]
  const rec = J(c.STORE.bonus_eval_rule[`G2|${Q}`].set.c);
  assert.deepEqual(rec, { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: 13 });   // no bp / bs, no cs8
  // the settings tables (② grade table and the ① base table) show the same 260 / 13
  assert.match(run(c, `kevCsBaseCardHtml(kbCfg())`), /\[G2\] G2<\/td><td[^>]*>8 カテゴリー・420 点<\/td><td[^>]*><b>260<\/b><\/td><td[^>]*>13<\/td>/);
  assert.match(run(c, `kevRuleCardHtml(kbCfg())`), /基準 260 \/ 420 点・1 段 13/);
  // the default (blank) saved in v1100: v1100 uses 252 / 13, v1099 still its own default
  saveForm(c, `kevRuleOpen('G2', 'c')`, {});
  assert.deepEqual(J(c.STORE.bonus_eval_rule[`G2|${Q}`].set.c), { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: null, bs8: null });
  assert.deepEqual(one(N, c, 'aki'), [420, 252, 13, 1.1, null]);
  assert.deepEqual(onV1099(c.STORE, 'aki'), BEFORE.aki);
});

test('a G2 value saved in v1099 (150 / 8) stays for v1099 when v1100 re-selects (260 / 13 or blank); v1100 never uses it', () => {
  const c = N.co();
  const v1099rule = { [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 150, bs: 8 } }, _at: 1 } };
  c.STORE.bonus_eval_rule = J(v1099rule);
  const before = onV1099(c.STORE, 'aki');
  assert.deepEqual(before, [225, 150, 8, 1, null]);   // v1099: 152 vs 150
  assert.equal(N.person(c, 'aki').blocked, 'eval');   // v1100: the 225-point value is not used
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual(J(c.STORE.bonus_eval_rule[`G2|${Q}`].set.c), { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: 13, bp: 150, bs: 8 });
  assert.deepEqual(one(N, c, 'aki'), [420, 260, 13, 1.05, null]);
  assert.deepEqual(onV1099(c.STORE, 'aki'), before);
  // re-opening the form shows 260 / 13 (not 150 / 8); saving it blank → v1100 the default 252, v1099 still 150 / 8
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.cur.bp, window._kevForm.cs.cur.bs, window._kevForm.cs.legacy.bp]`), [true, 260, 13, false]);
  assert.match(c.MODAL.at(-1), /id="kevf-bp"[^>]*value="260"/);
  assert.match(c.MODAL.at(-1), /id="kevf-bs"[^>]*value="13"/);
  // the checks look at the entered values (bp8 / bs8)
  for (const [bp, bs, re] of [['421', '', /基準得点は 0〜420 点/], ['260', '0', /1 段の点は 0 より大きく 420 点以下/], ['260', '500', /1 段の点は 0 より大きく 420 点以下/]]) {
    Object.assign(c.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: bp }, 'kevf-bs': { value: bs } }); c.DOM['@kevf-on'] = { value: '1' };
    assert.match(run(c, `kevFormBad('c', kevFormRead('c', 'kevf-'))`), re, bp + '/' + bs);
  }
  // the ladder under the fields follows the entered value
  c.DOM['kevf-lad'] = { innerHTML: '' }; c.DOM['@kevf-on'] = { value: '1' };
  Object.assign(c.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: '266' }, 'kevf-bs': { value: '' } });
  run(c, `kevFormLadUpd(window._kevForm, kevFormRead('c', 'kevf-'))`);
  assert.match(c.DOM['kevf-lad'].innerHTML, /266/);
  assert.doesNotMatch(c.DOM['kevf-lad'].innerHTML, /\b150\b/);
  saveForm(c, `kevRuleOpen('G2', 'c')`, {});
  assert.deepEqual(one(N, c, 'aki'), [420, 252, 13, 1.1, null]);
  assert.deepEqual(onV1099(c.STORE, 'aki'), before);
  // a later quarter's version made in v1100 keeps the v1099 values too
  assert.equal(run(c, `kevRuleSave('G2', '2026-Q4', {c:{on:true, lo:0.85, hi:1.15, g2:1, g3:1, b8:1, bp8:270, bs8:13}}, '試験', '① を変更')`), true);
  assert.deepEqual([c.STORE.bonus_eval_rule['G2|2026-Q4'].set.c.bp, c.STORE.bonus_eval_rule['G2|2026-Q4'].set.c.bs, c.STORE.bonus_eval_rule['G2|2026-Q4'].set.c.bp8], [150, 8, 270]);
  // a value written by the unreleased earlier commits of this branch (bp with cs8 = a 420-point value) is not kept for v1099
  const d = N.co();
  d.STORE.bonus_eval_rule = { [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 252, bs: 13, cs8: 1 } }, _at: 1 } };
  saveForm(d, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual(onV1099(d.STORE, 'aki'), BEFORE.aki);
  assert.deepEqual(J(d.STORE.bonus_eval_rule[`G2|${Q}`].set.c), { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: 13 });
});

test('a personal setting of a G2 store person saved in v1100 is not read by v1099 (its own personal value, or the grade / default, stays)', () => {
  const c = N.co();
  saveForm(c, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  assert.deepEqual(one(N, c, 'aki'), [420, 240, 12, 1.15, null]);   // 282: 3 steps above 240
  assert.deepEqual(onV1099(c.STORE, 'aki'), BEFORE.aki);            // 34d2ed9: [225, 240, 12, 0.85, null]
  const rec = J(c.STORE.bonus_eval_ovr[`aki|${Q}`].set.c);
  assert.deepEqual([rec.b8, rec.bp8, rec.bs8, 'bp' in rec, 'bs' in rec], [1, 240, 12, false, false]);
  run(c, `kevOvrOpen('aki', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.cur.bp, window._kevForm.cs.cur.bs, window._kevForm.cs.legacy.bp]`), [true, 240, 12, false]);
  assert.match(c.MODAL.at(-1), /id="kevf-bp"[^>]*value="240"/);
  // a v1099 personal value (140) stays for v1099
  const d = N.co();
  d.STORE.bonus_eval_ovr = { [`aki|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 140 } }, _at: 1 } };
  const before = onV1099(d.STORE, 'aki');
  assert.deepEqual(before, [225, 140, 7, 1.05, null]);
  saveForm(d, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  assert.equal(d.STORE.bonus_eval_ovr[`aki|${Q}`].set.c.bp, 140);
  assert.deepEqual(one(N, d, 'aki'), [420, 240, 12, 1.15, null]);
  assert.deepEqual(onV1099(d.STORE, 'aki'), before);
});

test('G3 and above saved in v1100 are not read by v1099 either (v1099 keeps its own values or default); v1099 values are still used by v1100', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  assert.deepEqual(one(N, c, 'mia').slice(1, 4), [260, 13, 1.05]);
  assert.deepEqual(onV1099(c.STORE, 'mia'), BEFORE.mia);
  // a v1099 G4 value (300) is used by v1100 until it is re-selected, and stays for v1099 afterwards
  const d = N.co();
  d.STORE.bonus_eval_rule = { [`G4|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 300 } }, _at: 1 } };
  assert.deepEqual(one(N, d, 'mia').slice(1, 3), [300, 13]);
  saveForm(d, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  assert.deepEqual(one(N, d, 'mia').slice(1, 3), [260, 13]);
  assert.deepEqual(onV1099(d.STORE, 'mia').slice(1, 3), [300, 13]);
  // the G6 form starts from the G5 value saved in v1100 (G6 uses G5's settings)
  saveForm(d, `kevRuleOpen('G5', 'c')`, { bp: '330' });
  run(d, `kevRuleOpen('G6', 'c')`);
  assert.deepEqual(run(d, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp]`), [false, 330]);
  saveForm(d, `kevRuleOpen('G6', 'c')`, { bp: '340' });
  run(d, `kevRuleOpen('G6', 'c')`);
  assert.deepEqual(run(d, `[window._kevForm.cs.own.bp, window._kevForm.cs.cur.bp, window._kevForm.cs.def.bp]`), [true, 340, 330]);   // blank would give G5's 330
});

test('back from v1099: a v1099 device that re-saves the G2 ① writes bp / bs again → v1100 does not use it silently (the amount waits, listed to re-select)', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  const old = O.co();
  old.STORE.bonus_eval_rule = J(c.STORE.bonus_eval_rule);
  old.DOM['@kevf-on'] = { value: '1' };
  Object.assign(old.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: '140' }, 'kevf-bs': { value: '7' } });
  vm.runInContext(`window._kevForm = { kind:'rule', scope:'G2', part:'c', pre:'kevf-', q:'${Q}', cs:{ max:225, sheet:'store', def:{ bp:135, bs:7 }, own:{} } };`, old);
  assert.equal(run(old, `kevRuleSave('G2', '${Q}', kevFormRead('c', 'kevf-'), 'v1099 の端末', '① を変更')`), true);
  assert.deepEqual(one(O, old, 'aki').slice(0, 3), [225, 140, 7]);
  c.STORE.bonus_eval_rule = J(old.STORE.bonus_eval_rule);
  const p = N.person(c, 'aki');
  assert.equal(p.blocked, 'eval');
  assert.match(p.missing.join(), /G2 の基準得点・1 段の点は v1099（4 カテゴリー・225 点満点）のときに保存された値です/);
  assert.ok(run(c, `kevMisfits3('${Q}')`).block.some(x => /G2・① の基準得点・1 段：v1099/.test(x.t)));
});

test('the preview of the ① form shows the value the save will give: a blank field means the upper level or the default (the stored value of the same level is replaced)', () => {
  const c = N.co();
  c.STORE.bonus_eval_rule = { [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 150, bs: 8 } }, _at: 1 } };
  const sim = bp8 => `{level:'grade', scope:'G2', set:{c:{on:true, lo:0.85, hi:1.15, g2:1, g3:1, b8:1, bp8:${bp8}, bs8:null}}}`;
  const base = s => run(c, `(function(){ var RF=kevRuleFor('G2', '${Q}', null, ${s}); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, 'G2'); return [B.bp, B.bs, !!B.legacy, B.srcBp]; })()`);
  assert.deepEqual(base('null'), [150, 8, true, 'grade']);          // stored: the v1099 value (not used)
  assert.deepEqual(base(sim('null')), [252, 13, false, 'default']);  // blank in the form → the default after saving
  assert.deepEqual(base(sim('266')), [266, 13, false, 'grade']);
  // the company-wide base (v1100) is inherited when the grade's field is left blank
  c.STORE.bonus_eval_rule[`_common|${Q}`] = { set: { c: { b8: 1, bp8: 300 } }, _at: 1 };
  c.STORE.bonus_eval_rule[`G2|${Q}`].set.c = { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bp: 150, bs: 8 };
  assert.deepEqual(base('null'), [260, 13, false, 'grade']);
  assert.deepEqual(base(sim('null')), [300, 13, false, 'common']);
  // the G2 form: with the grade's own value removed, the field's default is the company value (300), not the 225-point one
  delete c.STORE.bonus_eval_rule[`G2|${Q}`];
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp, window._kevForm.cs.legacy.bp]`), [false, 300, false]);
  // the company level and the personal level are replaced the same way in the preview
  const base2 = s => run(c, `(function(){ var RF=kevRuleFor('G2', '${Q}', 'aki', ${s}); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, 'G2'); return [B.bp, B.srcBp]; })()`);
  c.STORE.bonus_eval_rule = { [`_common|${Q}`]: { set: { c: { b8: 1, bp8: 300 } }, _at: 1 } };
  assert.deepEqual(base2('null'), [300, 'common']);
  assert.deepEqual(base2(`{level:'common', set:{c:{b8:1, bp8:null, bs8:null}}}`), [252, 'default']);
  c.STORE.bonus_eval_ovr = { [`aki|${Q}`]: { set: { c: { b8: 1, bp8: 250 } }, _at: 1 } };
  assert.deepEqual(base2('null'), [250, 'person']);
  assert.deepEqual(base2(`{level:'person', empId:'aki', set:{c:{on:true, lo:0.85, hi:1.15, g2:1, g3:1, b8:1, bp8:null, bs8:null}}}`), [300, 'common']);
  // one level with both fields and no mark (not written by the app; e.g. edited by hand): bp8 is the v1100 value
  c.STORE.bonus_eval_ovr = {};
  c.STORE.bonus_eval_rule = { [`G2|${Q}`]: { set: { c: { bp: 150, bp8: 260 } }, _at: 1 } };
  assert.deepEqual(base2('null'), [260, 'grade']);
  // a personal value saved in v1099 is more specific than a v1100 grade value: for G2 store people it is the 225-point value (not used)
  c.STORE.bonus_eval_rule = { [`_common|${Q}`]: { set: { c: { b8: 1, bp8: 300 } }, _at: 1 }, [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bp: 150, bs: 8 } }, _at: 1 } };
  c.STORE.bonus_eval_ovr = { [`aki|${Q}`]: { set: { c: { bp: 140 } }, _at: 1 } };
  assert.equal(N.person(c, 'aki').blocked, 'eval');
  c.STORE.bonus_eval_ovr[`aki|${Q}`].set.c = { b8: 1, bp8: 250, bp: 140 };
  assert.deepEqual(one(N, c, 'aki').slice(1, 3), [250, 13]);
});
