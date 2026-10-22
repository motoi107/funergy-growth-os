// v1100 (Codex review of 34d2ed9, P1): saving a G2 setting in v1100 and then going back to v1099 must not put the 420-point
// base (e.g. 252 / 13) into v1099's 225-point computation (G2 = H·A·B·C there).
// v1100 writes the ① base / step to bp8 / bs8 (mark b8) and never to bp / bs — the fields v1099 reads; the v1099 values stay as they were.
// Runs the real v1100 code (this working tree, or FUNERGY_INDEX) and the real v1099 code (index.html of the v1099 release c79e322,
// read from the local git history with `git show`: read-only, no network) on the synthetic company of tests/karte-eval.test.mjs
// (fictional staff and numbers). No production data, no browser storage.
import test, { after } from 'node:test';
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
const V1100_COMMIT = 'a5a101be535d78f59e8144dd7ab9bdcd0dadf6bc';   // PR #86 as merged (the v1100 release; its ① has no c8)
const show = commit => {
  try { return execFileSync('git', ['show', `${commit}:index.html`], { cwd: root, encoding: 'utf8', maxBuffer: 3e7 }); }
  catch (err) { throw new Error(`this test reads index.html of ${commit} from the local git history (git fetch --unshallow): ${err.message}`); }
};
const v1099src = show(V1099_COMMIT), v1100src = show(V1100_COMMIT);
assert.match(v1099src, /const APP_VERSION = '1099';/);
assert.match(v1100src, /const APP_VERSION = '1100';/);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'funergy-v1099-')), V1099 = path.join(TMP, 'index.html'), V1100R = path.join(TMP, 'index-1100.html');
fs.writeFileSync(V1099, v1099src);
fs.writeFileSync(V1100R, v1100src);
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

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
const N = await harness(V1100), O = await harness(V1099), R1100 = await harness(V1100R);
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

test('G3 and above (grade / track settings): v1099 reads them on the same 420 points, so v1100 writes bp / bs too — after going back v1099 uses the v1100 value', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  assert.deepEqual(one(N, c, 'mia').slice(1, 4), [260, 13, 1.05]);
  assert.deepEqual(onV1099(c.STORE, 'mia'), [420, 260, 13, 1.05, null]);
  assert.deepEqual(J(c.STORE.bonus_eval_rule[`G4|${Q}`].set.c), { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: null, bp: 260 });
  // a v1099 G4 value (300) is used by v1100 until it is re-selected
  const d = N.co();
  d.STORE.bonus_eval_rule = { [`G4|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 300 } }, _at: 1 } };
  assert.deepEqual(one(N, d, 'mia').slice(1, 3), [300, 13]);
  saveForm(d, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  assert.deepEqual(one(N, d, 'mia').slice(1, 3), [260, 13]);
  assert.deepEqual(onV1099(d.STORE, 'mia').slice(1, 3), [260, 13]);
  // blank in v1100 → both versions use their default (315)
  saveForm(d, `kevRuleOpen('G4', 'c')`, {});
  assert.deepEqual([one(N, d, 'mia').slice(1, 3), onV1099(d.STORE, 'mia').slice(1, 3)], [[315, 13], [315, 13]]);
  // the G6 form starts from the G5 value saved in v1100 (G6 uses G5's settings)
  saveForm(d, `kevRuleOpen('G5', 'c')`, { bp: '330' });
  run(d, `kevRuleOpen('G6', 'c')`);
  assert.deepEqual(run(d, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp]`), [false, 330]);
  saveForm(d, `kevRuleOpen('G6', 'c')`, { bp: '340' });
  run(d, `kevRuleOpen('G6', 'c')`);
  assert.deepEqual(run(d, `[window._kevForm.cs.own.bp, window._kevForm.cs.cur.bp, window._kevForm.cs.def.bp]`), [true, 340, 330]);   // blank would give G5's 330
  // G1 is on the G2 track: not mirrored
  saveForm(d, `kevRuleOpen('G1', 'c')`, { bp: '260' });
  assert.equal('bp' in J(d.STORE.bonus_eval_rule[`G1|${Q}`].set.c), false);
});

// a v1099 device opens the real v1099 form, keeps what it shows and changes only the upper end of the range
const valOf = (html, id) => { const m = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"')); return m ? m[1] : ''; };
function v1099Resave(store, open, vals = {}, prep = null, from = Q) {
  const old = O.co();
  if (prep) prep(old);
  for (const k of ['bonus_eval_rule', 'bonus_eval_ovr']) if (store[k]) old.STORE[k] = J(store[k]);
  run(old, open);
  const html = old.MODAL.at(-1), shown = { bp: valOf(html, 'kevf-bp'), bs: valOf(html, 'kevf-bs') };
  old.DOM['@kevf-on'] = { value: '1' };
  Object.assign(old.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.10' }, 'kevf-bp': { value: vals.bp ?? shown.bp }, 'kevf-bs': { value: vals.bs ?? shown.bs },
    'kevf-why': { value: 'v1099 の端末' }, 'kevf-from': { value: from } });
  old.TOASTS.length = 0;
  run(old, 'kevFormSave()');
  assert.match(String((old.TOASTS.at(-1) || [''])[0]), /保存しました/, JSON.stringify(old.TOASTS));
  return { shown, old, store: J(old.STORE) };
}
// the person view (FUNERGY_CS_GRADE_VIEW of v1100) in the same company
const CSV = (() => { const S = fs.readFileSync(V1100, 'utf8').replace(/\r\n/g, '\n'), i = S.indexOf('/* FUNERGY_CS_GRADE_VIEW_BEGIN */'), j = S.indexOf('/* FUNERGY_CS_GRADE_VIEW_END */'); assert.ok(i > 0 && j > i); return S.slice(i, j); })();
const withCsv = c => vm.runInContext(`function bizToday(){ return '2026-09-20'; } function healthRing(){ return ''; }\n` + CSV, c);
const misfits = c => run(c, `kevMisfits3('${Q}')`).block.map(x => x.t + ' → ' + x.act);

test('mixed devices A (independent review 8a04750 P2-1): G2 set to 260 / 13 in v1100; a v1099 device changes only the range of ① → v1100 does not quietly fall back to 252 — it waits and says why', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  const r = v1099Resave(c.STORE, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(r.shown, { bp: '', bs: '' });                 // the v1099 form cannot show the v1100 value (not written for v1099)
  assert.deepEqual(onV1099(r.store, 'aki'), BEFORE.aki);   // v1099 itself: its default 135 / 7
  c.STORE.bonus_eval_rule = r.store.bonus_eval_rule;
  const p = N.person(c, 'aki');
  assert.deepEqual([p.blocked, p.segs[0].items.c.coef], ['eval', null]);
  assert.match(p.missing.join(), /v1099 の端末で保存し直され、v1100 で入れた点（基準得点 260 点・1 段 13 点）が使われていません（グレード・職種（G2） 2026-Q3〜）/);
  assert.ok(misfits(c).some(x => /^G2・① の基準得点・1 段が v1099 の端末で保存し直され.*kevRuleOpen\('G2','c'\)$/.test(x)), misfits(c).join('\n'));
  assert.ok(!misfits(c).some(x => /225 点満点）のときの値です/.test(x)));
  // the person sees "確認中", the settings table marks it, the form says what was lost and does not fill a value in
  withCsv(c);
  assert.deepEqual(run(c, `(function(){ var V=csvView(EMPS.find(function(e){ return e.id==='aki'; })); return [V.state, V.bp, V.base.why]; })()`), ['nobase', null, 'legacy']);
  assert.match(run(c, `kevCsBaseCardHtml(kbCfg())`), /\[G2\] G2<\/td>.*?v1099 の端末で保存し直し・入れ直し/);
  assert.match(run(c, `kevRuleCardHtml(kbCfg())`), /基準 252 \/ 420 点・1 段 13（v1099 の端末で保存し直し・入れ直し）/);
  // a person with their own v1100 value (more specific than the lost grade value) is not stopped
  c.STORE.bonus_eval_ovr = { [`aki|${Q}`]: { set: { c: { b8: 1, bp8: 250, bs8: 13 } }, _at: 1 } };
  assert.deepEqual(one(N, c, 'aki'), [420, 250, 13, 1.1, null]);
  // …but only the base of their own: the step still comes from the lost grade value → stopped
  c.STORE.bonus_eval_ovr = { [`aki|${Q}`]: { set: { c: { b8: 1, bp8: 250 } }, _at: 1 } };
  assert.equal(N.person(c, 'aki').blocked, 'eval');
  c.STORE.bonus_eval_ovr = {};
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp, window._kevForm.cs.legacy.bp]`), [false, 252, true]);
  assert.match(c.MODAL.at(-1), /v1100 で入れた点（基準得点 260 点・1 段 13 点）が使われていません/);
  // the preview of a re-entry is not blocked; saving it in v1100 ends it
  assert.equal(run(c, `(function(){ var RF=kevRuleFor('G2', '${Q}', null, {level:'grade', scope:'G2', set:{c:{on:true, lo:0.85, hi:1.1, g2:1, g3:1, b8:1, bp8:260, bs8:13}}}); return !!kevCsBase(RF.r, RF, {sheet:'store', max:420}, 'G2').legacy; })()`), false);
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual(one(N, c, 'aki'), [420, 260, 13, 1.05, null]);
  assert.ok(!misfits(c).some(x => /G2・①/.test(x)));
});

test('mixed devices B: G4 (v1099 had 300) set to 260 in v1100; the v1099 form shows 260 and a range-only save keeps it — nothing lost, nothing to re-select', () => {
  const d = N.co();
  d.STORE.bonus_eval_rule = { [`G4|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 300 } }, _at: 1 } };
  saveForm(d, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  const r = v1099Resave(d.STORE, `kevRuleOpen('G4', 'c')`);
  assert.equal(r.shown.bp, '260');
  d.STORE.bonus_eval_rule = r.store.bonus_eval_rule;
  assert.deepEqual(one(N, d, 'mia').slice(1, 5), [260, 13, 1.05, null]);
  assert.ok(!misfits(d).some(x => /G4・①/.test(x)));
  // a different value typed on the v1099 device (same 420-point sheet for G4) is not silently taken over the v1100 value either
  const r2 = v1099Resave(J(d.STORE), `kevRuleOpen('G4', 'c')`, { bp: '300' });
  d.STORE.bonus_eval_rule = r2.store.bonus_eval_rule;
  assert.equal(N.person(d, 'mia').blocked, 'eval');
  assert.ok(misfits(d).some(x => /^G4・① の基準得点・1 段が v1099 の端末で保存し直され、v1100 で入れた点（基準得点 260 点・1 段 初期値）/.test(x)), misfits(d).join('\n'));
});

test('mixed devices C: a personal ① of a G2 store person (240 / 12) re-saved on a v1099 device → v1100 waits and lists the person; the grade-level value is not touched', () => {
  const c = N.co();
  saveForm(c, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  const r = v1099Resave(c.STORE, `kevOvrOpen('aki', 'c')`);
  assert.deepEqual(r.shown, { bp: '', bs: '' });
  c.STORE.bonus_eval_ovr = r.store.bonus_eval_ovr;
  assert.equal(N.person(c, 'aki').blocked, 'eval');
  assert.ok(misfits(c).some(x => /^個人設定 Aki Sample・① の基準得点・1 段が v1099 の端末で保存し直され、v1100 で入れた点（基準得点 240 点・1 段 12 点）.*kevOvrOpen\(.*aki.*,'c'\)$/.test(x)), misfits(c).join('\n'));
  assert.ok(!misfits(c).some(x => /^G2・①/.test(x)));
  run(c, `kevOvrOpen('aki', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.legacy.bp, !!window._kevForm.cs.legacy.lost]`), [false, true, true]);
  // a value typed on the v1099 device for the person (140 on 225 points): one entry (lost), the field stays empty
  const t = N.co();
  saveForm(t, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  t.STORE.bonus_eval_ovr = v1099Resave(t.STORE, `kevOvrOpen('aki', 'c')`, { bp: '140', bs: '7' }).store.bonus_eval_ovr;
  assert.equal(N.person(t, 'aki').blocked, 'eval');
  assert.equal(misfits(t).filter(x => /^個人設定 Aki Sample/.test(x)).length, 1, misfits(t).join('\n'));
  assert.ok(!misfits(t).some(x => /225 点満点）のときの値です/.test(x)));
  run(t, `kevOvrOpen('aki', 'c')`);
  assert.deepEqual(run(t, `[window._kevForm.cs.own.bp, window._kevForm.cs.legacy.bp]`), [false, true]);
  assert.doesNotMatch(t.MODAL.at(-1), /value="140"/);
  // a specialist (department sheet, 96 points): the personal ① re-saved on a v1099 device is not used either
  const spec = c => { c.SPEC = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(k => ({ key: k, name: k, en: k, icon: 'ti-star', items: ['1', '2', '3', '4'] })); vm.runInContext(`lssCatsForName = function(n){ return n === 'Ray Sample' ? SPEC : lssCatsOrdered(); };`, c); };
  const sp = N.co(); spec(sp);
  saveForm(sp, `kevOvrOpen('ray', 'c')`, { bp: '60', bs: '3' });
  assert.deepEqual(one(N, sp, 'ray').slice(0, 3), [96, 60, 3]);
  sp.STORE.bonus_eval_ovr = v1099Resave(sp.STORE, `kevOvrOpen('ray', 'c')`, {}, spec).store.bonus_eval_ovr;
  assert.equal(N.person(sp, 'ray').blocked, 'eval');
  // a number typed for the specialist on the v1099 device (55): not used, and not put into the v1100 field
  saveForm(sp, `kevOvrOpen('ray', 'c')`, { bp: '60', bs: '3' });
  sp.STORE.bonus_eval_ovr = v1099Resave(sp.STORE, `kevOvrOpen('ray', 'c')`, { bp: '55', bs: '3' }, spec).store.bonus_eval_ovr;
  assert.equal(N.person(sp, 'ray').blocked, 'eval');
  run(sp, `kevOvrOpen('ray', 'c')`);
  assert.deepEqual(run(sp, `[window._kevForm.cs.own.bp, window._kevForm.cs.legacy.bp, !!window._kevForm.cs.legacy.lost]`), [false, true, true]);
  assert.doesNotMatch(sp.MODAL.at(-1), /id="kevf-bp"[^>]*value="55"/);
  // other G2 people are not affected
  c.EMPS.push({ id: 'bea', name: 'Bea Sample', title: 'Crew Leader', g: 'G2', store: 'S1', role: '', status: '在籍' });
  c.SCORES['Bea Sample'] = J(c.SCORES['Aki Sample']);
  assert.equal(N.person(c, 'bea').blocked, null);
  // re-entered in v1100 → used again
  saveForm(c, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  assert.deepEqual(one(N, c, 'aki'), [420, 240, 12, 1.15, null]);
  // the previous quarter's v1100 version counts too (a v1099 device made the next quarter's version)
  const d = N.co();
  const c8 = { b8: 1, bp8: 260, bs8: 13 };   // the last v1100 ① of the level (written by v1100, copied with the version by v1099)
  d.STORE.bonus_eval_rule = { 'G2|2026-Q2': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: 13 }, c8 }, _at: 1 },
    [`G2|${Q}`]: { set: { c: { on: true, lo: 0.85, hi: 1.1, g2: 1, g3: 1, bp: null, bs: null }, c8 }, _at: 2 } };
  assert.equal(N.person(d, 'aki').blocked, 'eval');
  // a v1099 device saving another part (②) keeps the v1100 ① as it is
  const e = N.co();
  saveForm(e, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  const old = O.co(); old.STORE.bonus_eval_rule = J(e.STORE.bonus_eval_rule);
  assert.equal(run(old, `kevRuleSave('G2', '${Q}', {s:{on:true, lo:0.95, hi:1.05, g2:1, g3:1}}, 'v1099 の端末', '② を変更')`), true);
  e.STORE.bonus_eval_rule = J(old.STORE.bonus_eval_rule);
  assert.deepEqual(one(N, e, 'aki'), [420, 260, 13, 1.05, null]);
});

test('Codex 31277db P1: a v1099 device that makes two (or more) quarter versions in a row does not hide the v1100 value — grade, personal and company-wide levels', () => {
  const at = (c, q, emp = 'null', scope = 'G2') => run(c, `(function(){ var RF=kevRuleFor('${scope}', '${q}', ${emp}, null, kbCfg()); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, '${scope}'); return [B.bp, B.bs, !!B.legacy, !!B.lost, B.lost ? B.lost.ref : null]; })()`);
  // grade (G2): v1100 sets 2026-Q3 to 260 / 13 → a v1099 device saves 2026-Q4, then 2027-Q1 (range only, what its form shows)
  const c = N.co();
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  let st = c.STORE;
  for (const q of ['2026-Q4', '2027-Q1']) st = v1099Resave(st, `kevRuleOpen('G2', 'c')`, {}, null, q).store;
  assert.deepEqual(Object.keys(st.bonus_eval_rule).sort(), ['G2|2026-Q3', 'G2|2026-Q4', 'G2|2027-Q1']);
  c.STORE.bonus_eval_rule = st.bonus_eval_rule;
  for (const q of ['2026-Q4', '2027-Q1']) assert.deepEqual(at(c, q), [252, 13, true, true, { bp: 260, bs: 13 }], q);   // 31277db: 2027-Q1 → [252, 13, false, false, null]
  assert.deepEqual(at(c, Q), [260, 13, false, false, null]);   // the v1100 quarter itself is untouched
  assert.ok(run(c, `kevMisfits3('2027-Q1')`).block.some(x => /^G2・① の基準得点・1 段が v1099 の端末で保存し直され、v1100 で入れた点（基準得点 260 点・1 段 13 点）/.test(x.t)));
  // three in a row, and several saves inside one version, are still found
  st = v1099Resave(st, `kevRuleOpen('G2', 'c')`, {}, null, '2027-Q2').store;
  st = v1099Resave(st, `kevRuleOpen('G2', 'c')`, {}, null, '2027-Q2').store;
  c.STORE.bonus_eval_rule = st.bonus_eval_rule;
  assert.deepEqual(at(c, '2027-Q2').slice(2, 4), [true, true]);
  // re-entered in v1100 for 2027-Q1 → that quarter is used again; the later v1099 version (2027-Q2, made before) still waits, compared with what it was copied from
  c.STORE.bonus_eval_rule['G2|2027-Q1'].set.c = { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 255, bs8: 13 };
  assert.deepEqual(at(c, '2027-Q1').slice(0, 4), [255, 13, false, false]);
  assert.deepEqual(at(c, '2027-Q2').slice(2, 5), [true, true, { bp: 260, bs: 13 }]);   // 2027-Q2 was copied before the re-entry: its v1100 value is 260
  assert.deepEqual(at(c, '2026-Q4').slice(2, 5), [true, true, { bp: 260, bs: 13 }]);   // a later quarter is not the "before" of an earlier one
  // the v1099 device first re-saved the v1100 quarter itself, then made the next one (the v1100 value is in the history of 2026-Q3)
  const f = N.co();
  saveForm(f, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  let sf = v1099Resave(f.STORE, `kevRuleOpen('G2', 'c')`).store;
  sf = v1099Resave(sf, `kevRuleOpen('G2', 'c')`, {}, null, '2026-Q4').store;
  f.STORE.bonus_eval_rule = sf.bonus_eval_rule;
  assert.deepEqual(at(f, '2026-Q4').slice(2, 5), [true, true, { bp: 260, bs: 13 }]);
  // personal (G2 store person): v1100 2026-Q3 240 / 12 → a v1099 device saves 2026-Q4 and 2027-Q1
  const d = N.co();
  saveForm(d, `kevOvrOpen('aki', 'c')`, { bp: '240', bs: '12' });
  let so = d.STORE;
  for (const q of ['2026-Q4', '2027-Q1']) so = v1099Resave(so, `kevOvrOpen('aki', 'c')`, {}, null, q).store;
  d.STORE.bonus_eval_ovr = so.bonus_eval_ovr;
  assert.deepEqual(at(d, '2027-Q1', "'aki'").slice(2, 5), [true, true, { bp: 240, bs: 12 }]);
  // company-wide (no screen for ① there since v1099; written here directly)
  const e = N.co();
  const k8 = { b8: 1, bp8: 300, bs8: null };
  e.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { c: { b8: 1, bp8: 300 }, c8: k8 }, _at: 1 }, '_common|2026-Q4': { set: { c: { g2: 1, g3: 1 }, c8: k8 }, _at: 2 }, '_common|2027-Q1': { set: { c: { g2: 1, g3: 1 }, c8: k8 }, _at: 3 } };
  assert.deepEqual(at(e, '2027-Q1', 'null', 'G4').slice(2, 5), [true, true, { bp: 300, bs: null }]);
  // a level whose ① was taken away in between (no ① in 2026-Q4) is not a replacement of the v1100 value
  e.STORE.bonus_eval_ovr = { 'mia|2026-Q3': { set: { c: { b8: 1, bp8: 280, bs8: 13 }, c8: { b8: 1, bp8: 280, bs8: 13 } }, _at: 1 }, 'mia|2026-Q4': { set: { s: { on: true } }, _at: 2 }, 'mia|2027-Q1': { set: { c: { bp: 300, bs: 13 } }, _at: 3 } };
  e.STORE.bonus_eval_rule = {};
  assert.deepEqual(at(e, '2027-Q1', "'mia'", 'G4').slice(0, 4), [300, 13, false, false]);
});

test('independent review 5db2653 P2: the comparison is with the last v1100 ① of that lineage (c8), not with whatever the earlier quarter says now — later edits, versions that existed before, ① taken away in between, 20+ saves', () => {
  const at = (c, q, emp = 'null', scope = 'G2') => run(c, `(function(){ var RF=kevRuleFor('${scope}', '${q}', ${emp}, null, kbCfg()); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, '${scope}'); return [B.bp, B.bs, !!B.legacy, !!B.lost]; })()`);
  // S1: G4 260 in Q3 (v1100) → a v1099 device makes Q4 keeping 260 → later a v1100 user changes Q3 to 280: Q4 is still 260 and not stopped
  const a = N.co();
  saveForm(a, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  a.STORE.bonus_eval_rule = v1099Resave(a.STORE, `kevRuleOpen('G4', 'c')`, {}, null, '2026-Q4').store.bonus_eval_rule;
  assert.deepEqual(at(a, '2026-Q4', 'null', 'G4'), [260, 13, false, false]);
  saveForm(a, `kevRuleOpen('G4', 'c')`, { bp: '280' });
  assert.deepEqual([at(a, Q, 'null', 'G4'), at(a, '2026-Q4', 'null', 'G4')], [[280, 13, false, false], [260, 13, false, false]]);
  assert.ok(!run(a, `kevMisfits3('2026-Q4')`).block.some(x => /G4・①/.test(x.t)));
  // S2: a Q4 version that already existed before v1100 (v1099 / v1098 values) is not stopped when v1100 sets Q3
  const b = N.co();
  b.STORE.bonus_eval_rule = { 'G4|2026-Q4': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 310 } }, _at: 1 }, 'G2|2026-Q4': { set: { c: { on: true, lo: 0.9, hi: 1.1 } }, _at: 1 } };
  saveForm(b, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  saveForm(b, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual([at(b, '2026-Q4', 'null', 'G4'), at(b, '2026-Q4')], [[310, 13, false, false], [252, 13, false, false]]);
  // S3: mia 240 / 12 in Q3 (v1100) → a v1099 device saves 2027-Q1 blank (lost) → a v1100 user takes away her ① in 2026-Q4: 2027-Q1 still waits
  const d = N.co();
  saveForm(d, `kevOvrOpen('mia', 'c')`, { bp: '240', bs: '12' });
  d.STORE.bonus_eval_ovr = v1099Resave(d.STORE, `kevOvrOpen('mia', 'c')`, {}, null, '2027-Q1').store.bonus_eval_ovr;
  assert.deepEqual(at(d, '2027-Q1', "'mia'", 'G4').slice(2), [true, true]);
  assert.equal(run(d, `kevPutVer('bonus_eval_ovr', kevOvrAll(), 'mia', '2026-Q4', {}, '外す', '① の個人設定を外した', ['c','w'])`), true);
  assert.equal('c8' in J(d.STORE.bonus_eval_ovr['mia|2026-Q4'].set), false);   // taking ① away in v1100 takes the v1100 ① away too
  // …and that wins over an older copy of the same version in the sync merge (the time of the part)
  const stale = J(d.STORE.bonus_eval_ovr['mia|2026-Q4']); stale.set.c = { b8: 1, bp8: 240, bs8: 12 }; stale.set.c8 = { b8: 1, bp8: 240, bs8: 12 }; stale._t = { c: 1, c8: 1, w: 1 }; stale._at = 1;
  const merged = run(d, `kevMergeVerRec(${JSON.stringify(stale)}, ${JSON.stringify(J(d.STORE.bonus_eval_ovr['mia|2026-Q4']))})`);
  assert.deepEqual(['c' in merged.set, 'c8' in merged.set], [false, false]);
  assert.deepEqual(at(d, '2027-Q1', "'mia'", 'G4').slice(2), [true, true]);
  assert.deepEqual(at(d, '2026-Q4', "'mia'", 'G4'), [315, 13, false, false]);
  // after ① was taken away in v1100, a ① added later on a v1099 device in a later quarter is not a replacement of a v1100 value
  d.STORE.bonus_eval_ovr = v1099Resave(J(d.STORE), `kevOvrOpen('mia', 'c')`, { bp: '300', bs: '13' }, null, '2027-Q2').store.bonus_eval_ovr;
  // (the v1099 device's base for 2027-Q2 is 2027-Q1, which still carries the v1100 ① → still compared with it)
  assert.equal(at(d, '2027-Q2', "'mia'", 'G4')[3], true);
  // 20+ saves of other parts after the v1099 re-save (the history keeps 20): still found
  const f = N.co();
  saveForm(f, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  const old = v1099Resave(f.STORE, `kevRuleOpen('G2', 'c')`).old;
  for (let i = 0; i < 22; i++) assert.equal(run(old, `kevRuleSave('G2', '${Q}', {s:{on:true, lo:0.95, hi:1.05, g2:1, g3:1}}, 'v1099 の端末 ${i}', '② を変更')`), true);
  f.STORE.bonus_eval_rule = J(old.STORE.bonus_eval_rule);
  assert.equal(J(f.STORE.bonus_eval_rule[`G2|${Q}`].hist).length, 20);
  assert.deepEqual(at(f, Q).slice(2), [true, true]);
  // the sync merge keeps c8 (part by part)
  const m = run(f, `kevMergeVerRec(${JSON.stringify(f.STORE.bonus_eval_rule[`G2|${Q}`])}, ${JSON.stringify(J(N.co().STORE.bonus_eval_rule || {})[`G2|${Q}`] || { set: {}, _at: 1 })})`);
  assert.deepEqual(m.set.c8, { b8: 1, bp8: 260, bs8: 13 });
});

test('independent review 5db2653 P3: the preview of taking away another personal part (②) still checks a lost ① — and taking away ① itself does not', () => {
  const c = N.co();
  saveForm(c, `kevOvrOpen('mia', 'c')`, { bp: '240', bs: '12' });
  assert.equal(run(c, `kevOvrSave('mia', '${Q}', {s:{on:false, lo:0.95, hi:1.05, g2:1, g3:1}}, '試験', '② を変更')`), true);
  c.STORE.bonus_eval_ovr = v1099Resave(c.STORE, `kevOvrOpen('mia', 'c')`).store.bonus_eval_ovr;
  assert.equal(N.person(c, 'mia').blocked, 'eval');
  const pv = parts => run(c, `(function(){ var v=kevVer(kevOvrAll(), 'mia', '${Q}'), s=JSON.parse(JSON.stringify(v.set)); ${JSON.stringify(parts)}.forEach(function(p){ delete s[p]; }); var RF=kevRuleFor('G4', '${Q}', 'mia', {level:'person', empId:'mia', set:s, replace:true}, kbCfg()); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, 'G4'); return [B.bp, !!B.lost]; })()`);
  assert.deepEqual(pv(['s']), [315, true]);        // 5db2653: [315, false] — the preview showed an amount
  assert.deepEqual(pv(['c', 'w']), [315, false]);  // after taking ① away the grade value is used
});

// a device on the released v1100 (a5a101b) saves on its real form: no c8
function v1100Save(store, open, vals, from = Q) {
  const d = R1100.co();
  for (const k of ['bonus_eval_rule', 'bonus_eval_ovr']) if (store[k]) d.STORE[k] = J(store[k]);
  run(d, open);
  d.DOM['@kevf-on'] = { value: '1' };
  Object.assign(d.DOM, { 'kevf-lo': { value: '0.85' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: vals.bp ?? '' }, 'kevf-bs': { value: vals.bs ?? '' }, 'kevf-why': { value: 'v1100 の端末' }, 'kevf-from': { value: from } });
  d.TOASTS.length = 0; run(d, 'kevFormSave()');
  assert.match(String((d.TOASTS.at(-1) || [''])[0]), /保存しました/, JSON.stringify(d.TOASTS));
  return J(d.STORE);
}
const tick = () => { const t = Date.now() + 3; while (Date.now() < t) { /* the stores' save times (_at) must differ */ } };

test('v1102: settings saved by the released v1100 (no c8) — a v1099 re-save is still found by a walk that follows the save times; saving in v1102 gives them c8', () => {
  const at = (c, q, emp = 'null', scope = 'G2') => run(c, `(function(){ var RF=kevRuleFor('${scope}', '${q}', ${emp}, null, kbCfg()); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, '${scope}'); return [B.bp, B.bs, !!B.legacy, !!B.lost, B.lost ? B.lost.ref : null]; })()`);
  // G2 260 / 13 saved on v1100 (a5a101b): no c8
  let st = v1100Save({}, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.equal('c8' in st.bonus_eval_rule[`G2|${Q}`].set, false);
  const c = N.co(); c.STORE.bonus_eval_rule = J(st.bonus_eval_rule);
  assert.deepEqual(at(c, Q), [260, 13, false, false, null]);
  // a v1099 device: re-save of the same version, then 2026-Q4 and 2027-Q1
  tick(); st = v1099Resave(st, `kevRuleOpen('G2', 'c')`).store;
  tick(); st = v1099Resave(st, `kevRuleOpen('G2', 'c')`, {}, null, '2026-Q4').store;
  tick(); st = v1099Resave(st, `kevRuleOpen('G2', 'c')`, {}, null, '2027-Q1').store;
  c.STORE.bonus_eval_rule = J(st.bonus_eval_rule);
  for (const q of [Q, '2026-Q4', '2027-Q1']) assert.deepEqual(at(c, q), [252, 13, true, true, { bp: 260, bs: 13 }], q);
  // S1 with v1100 records: G4 260 (v1100) → v1099 makes Q4 keeping 260 → a v1100 device changes Q3 to 280 later: Q4 is not stopped
  let s1 = v1100Save({}, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  tick(); s1 = v1099Resave(s1, `kevRuleOpen('G4', 'c')`, {}, null, '2026-Q4').store;
  tick(); s1 = v1100Save(s1, `kevRuleOpen('G4', 'c')`, { bp: '280' });
  const a = N.co(); a.STORE.bonus_eval_rule = J(s1.bonus_eval_rule);
  assert.deepEqual([at(a, Q, 'null', 'G4').slice(0, 4), at(a, '2026-Q4', 'null', 'G4').slice(0, 4)], [[280, 13, false, false], [260, 13, false, false]]);
  // …and a v1099 value typed in Q4 against that 260 is found (compared with the Q3 state when Q4 was made, 260)
  tick(); const s1b = v1099Resave(s1, `kevRuleOpen('G4', 'c')`, { bp: '300' }, null, '2026-Q4').store;
  a.STORE.bonus_eval_rule = J(s1b.bonus_eval_rule);
  assert.deepEqual(at(a, '2026-Q4', 'null', 'G4').slice(3), [true, { bp: 260, bs: null }]);
  // a value changed in v1102 replaces c8 (a later v1099 range-only save keeps the mirrored G4 value → not stopped)
  const h = N.co();
  saveForm(h, `kevRuleOpen('G4', 'c')`, { bp: '260' });
  saveForm(h, `kevRuleOpen('G4', 'c')`, { bp: '280' });
  assert.deepEqual(J(h.STORE.bonus_eval_rule[`G4|${Q}`].set.c8), { b8: 1, bp8: 280, bs8: null });
  h.STORE.bonus_eval_rule = v1099Resave(J(h.STORE), `kevRuleOpen('G4', 'c')`).store.bonus_eval_rule;
  assert.deepEqual(at(h, Q, 'null', 'G4').slice(0, 4), [280, 13, false, false]);
  // S2: a Q4 version that existed before v1100 set Q3 is not stopped
  const s2 = { bonus_eval_rule: { 'G4|2026-Q4': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 310 } }, _at: Date.now() - 86400000 } } };
  const b = N.co(); b.STORE.bonus_eval_rule = J(v1100Save(s2, `kevRuleOpen('G4', 'c')`, { bp: '260' }).bonus_eval_rule);
  assert.deepEqual(at(b, '2026-Q4', 'null', 'G4').slice(0, 4), [310, 13, false, false]);
  // S3: mia 240 / 12 (v1100) → v1099 2027-Q1 blank → later a v1100 device takes her ① away in 2026-Q4: 2027-Q1 still waits
  let s3 = v1100Save({}, `kevOvrOpen('mia', 'c')`, { bp: '240', bs: '12' });
  tick(); s3 = v1099Resave(s3, `kevOvrOpen('mia', 'c')`, {}, null, '2027-Q1').store;
  tick();
  const d = N.co(); d.STORE.bonus_eval_ovr = J(s3.bonus_eval_ovr);
  d.STORE.bonus_eval_ovr['mia|2026-Q4'] = { set: { s: { on: true } }, _at: Date.now() };
  assert.deepEqual(at(d, '2027-Q1', "'mia'", 'G4').slice(3), [true, { bp: 240, bs: 12 }]);
  // a version made later for an earlier quarter is not where 2027-Q1 was copied from: Q3 changed to 250 by v1100 after 2027-Q1 was made, then Q4 made from it
  let s4 = v1100Save({}, `kevOvrOpen('mia', 'c')`, { bp: '240', bs: '12' });
  tick(); s4 = v1099Resave(s4, `kevOvrOpen('mia', 'c')`, {}, null, '2027-Q1').store;
  tick(); s4 = v1100Save(s4, `kevOvrOpen('mia', 'c')`, { bp: '250', bs: '12' });
  tick(); s4 = v1100Save(s4, `kevOvrOpen('mia', 'c')`, { bp: '250', bs: '12' }, '2026-Q4');
  const g = N.co(); g.STORE.bonus_eval_ovr = J(s4.bonus_eval_ovr);
  assert.deepEqual(at(g, '2027-Q1', "'mia'", 'G4').slice(3), [true, { bp: 240, bs: 12 }]);
  // a malformed history entry is skipped, not the end
  const e = N.co(); e.STORE.bonus_eval_rule = J(st.bonus_eval_rule);
  e.STORE.bonus_eval_rule[`G2|${Q}`].hist.push({ at: 'x' });
  assert.deepEqual(at(e, Q).slice(2, 4), [true, true]);
  // saving another part in v1102 gives the v1100 ① its c8 (then the lineage no longer needs the walk)
  const f = N.co(); f.STORE.bonus_eval_rule = J(v1100Save({}, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' }).bonus_eval_rule);
  assert.equal(run(f, `kevRuleSave('G2', '${Q}', {s:{on:true, lo:0.95, hi:1.05, g2:1, g3:1}}, '試験', '② を変更')`), true);
  assert.deepEqual(J(f.STORE.bonus_eval_rule[`G2|${Q}`].set.c8), { b8: 1, bp8: 260, bs8: 13 });
  assert.ok(Number(J(f.STORE.bonus_eval_rule[`G2|${Q}`])._t.c8) > 0);
});

// a device clock that can run in the v1099 days (before v1100 existed) — the stores' save times (_at) come from Date.now()
const OLD_DAYS = Date.UTC(2026, 8, 1, 10);   // 2026-09-01 0:00 HST
const fakeClock = c => vm.runInContext(`(function(){ var real=Date.now, t=${OLD_DAYS}; globalThis.__oldDays=true; Date.now=function(){ return globalThis.__oldDays ? (t+=1000) : real(); }; })();`, c);
const realClock = c => vm.runInContext('globalThis.__oldDays=false;', c);
const saveS = (c, scope, n, from = Q) => { for (let i = 0; i < n; i++) assert.equal(run(c, `kevRuleSave('${scope}', '${from}', {s:{on:true, lo:0.95, hi:1.05, g2:1, g3:1}}, 'v1099 の端末 ${i}', '② を変更')`), true); };

test('Codex 98c1b60 P2: the history (20 entries) dropped the v1100 ① of a record saved by the released v1100 (no c8) — the head stops instead of computing; v1099-only records from before v1100 are not stopped', () => {
  const at = (c, q, emp = 'null', scope = 'G2') => run(c, `(function(){ var RF=kevRuleFor('${scope}', '${q}', ${emp}, null, kbCfg()); var B=kevCsBase(RF.r, RF, {sheet:'store', max:420}, '${scope}'); return [B.bp, B.bs, !!B.legacy, !!B.lost, B.lost ? B.lost.ref : null]; })()`);
  const SINCE = Date.UTC(2026, 9, 21, 10);                            // 2026-10-21 0:00 HST: from when a v1100 ① can exist (KEV_CS_LOST_SINCE)
  assert.ok(Date.now() >= SINCE);                                     // the saves below (real clock) are after v1100 could be used
  const UNKNOWN = { bp: null, bs: null, unknown: true };
  // Codex's sequence: a5a101b form G2 260 / 13 → c79e322 re-saves ① of the same version → 22 saves of ② on that v1099 device
  const st = v1100Save({}, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  tick();
  const old = v1099Resave(st, `kevRuleOpen('G2', 'c')`).old;
  saveS(old, 'G2', 22);
  const rec = J(old.STORE.bonus_eval_rule[`G2|${Q}`]);
  assert.equal(rec.hist.length, 20);
  assert.equal('c8' in rec.set, false);
  assert.ok(!rec.hist.some(h => h.set && h.set.c && h.set.c.b8));   // the v1100 ① is no longer anywhere in the record
  const c = N.co(); c.STORE.bonus_eval_rule = J(old.STORE.bonus_eval_rule);
  assert.deepEqual(at(c, Q), [252, 13, true, true, UNKNOWN]);         // 98c1b60: [252, 13, false, false, null] — the normal computation
  const p = N.person(c, 'aki');
  assert.deepEqual([p.blocked, p.segs[0].items.c.coef], ['eval', null]);
  assert.match(p.missing.join(), /① の基準得点・1 段が v1099 の端末で保存し直されています。その前に v1100 で入れた点があったかを、変更の履歴（20 件まで）からは確かめられないため、この点では計算しません（グレード・職種（G2） 2026-Q3〜）/);
  assert.ok(misfits(c).some(x => /^G2・① の基準得点・1 段が v1099 の端末で保存し直されています。その前に v1100 で入れた点があったか.*kevRuleOpen\('G2','c'\)$/.test(x)), misfits(c).join('\n'));
  withCsv(c);
  assert.deepEqual(run(c, `(function(){ var V=csvView(EMPS.find(function(e){ return e.id==='aki'; })); return [V.state, V.bp, V.base.why]; })()`), ['nobase', null, 'legacy']);
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp, window._kevForm.cs.legacy.bp, window._kevForm.cs.legacy.bs]`), [false, 252, true, true]);
  assert.match(c.MODAL.at(-1), /変更の履歴（20 件まで）からは確かめられないため/);
  // a later quarter made from it by the v1099 device waits too (the walk reaches the cut version)
  const q4 = v1099Resave(J(old.STORE), `kevRuleOpen('G2', 'c')`, {}, null, '2026-Q4').store;
  const c4 = N.co(); c4.STORE.bonus_eval_rule = J(q4.bonus_eval_rule);
  assert.deepEqual(at(c4, '2026-Q4'), [252, 13, true, true, UNKNOWN]);
  // entering ① again in v1102 ends it
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  assert.deepEqual(one(N, c, 'aki'), [420, 260, 13, 1.05, null]);
  assert.ok(!misfits(c).some(x => /G2・①/.test(x)));

  // a cut history that still holds the v1100 ①: found with its values (not "unknown")
  const s2 = v1099Resave({}, `kevRuleOpen('G2', 'c')`, { bp: '140', bs: '7' });
  saveS(s2.old, 'G2', 25);
  tick(); const s2b = v1100Save(J(s2.old.STORE), `kevRuleOpen('G2', 'c')`, { bp: '270', bs: '13' });
  tick(); const s2c = v1099Resave(s2b, `kevRuleOpen('G2', 'c')`).store;
  assert.equal(s2c.bonus_eval_rule[`G2|${Q}`].hist.length, 20);
  const d2 = N.co(); d2.STORE.bonus_eval_rule = J(s2c.bonus_eval_rule);
  assert.deepEqual(at(d2, Q), [140, 7, true, true, { bp: 270, bs: 13 }]);   // 140 / 7: the v1099 (225-point) value kept at that level — not used

  // a quarter made by the v1099 device from a v1100 quarter, then the v1100 quarter is saved 20+ times: the version it was copied from cannot be told → waits
  // (98c1b60 + the walk: the earlier quarter looked "made later" and was skipped → [252, 13, false, false, null])
  let s3 = v1100Save({}, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  tick(); const r3 = v1099Resave(s3, `kevRuleOpen('G2', 'c')`, {}, null, '2026-Q4');
  tick(); const d3 = R1100.co(); d3.STORE.bonus_eval_rule = J(r3.store.bonus_eval_rule);
  for (let i = 0; i < 22; i++) assert.equal(run(d3, `kevRuleSave('G2', '${Q}', {s:{on:true, lo:0.95, hi:1.05, g2:1, g3:1}}, 'v1100 の端末 ${i}', '② を変更')`), true);
  const c3 = N.co(); c3.STORE.bonus_eval_rule = J(d3.STORE.bonus_eval_rule);
  assert.equal(c3.STORE.bonus_eval_rule[`G2|${Q}`].hist.length, 20);
  assert.deepEqual(at(c3, Q).slice(2, 4), [false, false]);              // the 2026-Q3 version itself still has the v1100 ① (b8)
  assert.deepEqual(at(c3, '2026-Q4'), [252, 13, true, true, UNKNOWN]);
  // …but a quarter made by v1099 before v1100 existed is not stopped by later saves of the earlier quarter (nothing it was copied from can be a v1100 ①)
  const c5 = N.co();
  c5.STORE.bonus_eval_rule = J(c3.STORE.bonus_eval_rule);
  c5.STORE.bonus_eval_rule['G4|2026-Q4'] = { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 310 } }, at: '2026/09/10', _at: OLD_DAYS + 9 * 86400000 };
  const g4q3 = J(c3.STORE.bonus_eval_rule[`G2|${Q}`]);
  c5.STORE.bonus_eval_rule[`G4|${Q}`] = g4q3;                            // 20 kept states, all after v1100, from a5a101b's G2 record (only the shape matters)
  assert.deepEqual(at(c5, '2026-Q4', 'null', 'G4').slice(0, 4), [310, 13, false, false]);

  // v1099-only record (G4 300) saved 22 times in the v1099 days: not stopped; history partly after v1100: not stopped
  const g = v1099Resave({}, `kevRuleOpen('G4', 'c')`, { bp: '300' }, fakeClock);
  saveS(g.old, 'G4', 22);
  const e = N.co(); e.STORE.bonus_eval_rule = J(g.old.STORE.bonus_eval_rule);
  assert.equal(e.STORE.bonus_eval_rule[`G4|${Q}`].hist.length, 20);
  assert.deepEqual(at(e, Q, 'null', 'G4'), [300, 13, false, false, null]);
  realClock(g.old); saveS(g.old, 'G4', 8);
  e.STORE.bonus_eval_rule = J(g.old.STORE.bonus_eval_rule);
  const hs = e.STORE.bonus_eval_rule[`G4|${Q}`].hist.map(h => h._at < SINCE);
  assert.ok(hs.includes(true) && hs.includes(false));
  assert.deepEqual(at(e, Q, 'null', 'G4'), [300, 13, false, false, null]);
  // the accepted limit: more than 20 saves of the same version after v1100 could be used → it cannot be told any more → waits (safe side) until ① is entered again
  saveS(g.old, 'G4', 20);
  e.STORE.bonus_eval_rule = J(g.old.STORE.bonus_eval_rule);
  assert.deepEqual(at(e, Q, 'null', 'G4'), [300, 13, true, true, UNKNOWN]);
  saveForm(e, `kevRuleOpen('G4', 'c')`, { bp: '300' });
  assert.deepEqual(at(e, Q, 'null', 'G4'), [300, 13, false, false, null]);
  assert.equal(run(e, 'KEV_CS_LOST_SINCE'), SINCE);
});

test('back from v1099: a v1099 device that types a G2 value (140 / 7 on 225 points) → v1100 does not use it silently (the amount waits, listed to re-enter)', () => {
  const c = N.co();
  saveForm(c, `kevRuleOpen('G2', 'c')`, { bp: '260', bs: '13' });
  const r = v1099Resave(c.STORE, `kevRuleOpen('G2', 'c')`, { bp: '140', bs: '7' });
  assert.deepEqual(one(O, r.old, 'aki').slice(0, 3), [225, 140, 7]);
  c.STORE.bonus_eval_rule = r.store.bonus_eval_rule;
  const p = N.person(c, 'aki');
  assert.equal(p.blocked, 'eval');
  assert.match(p.missing.join(), /v1099 の端末で保存し直され、v1100 で入れた点（基準得点 260 点・1 段 13 点）が使われていません/);
  assert.ok(misfits(c).some(x => /^G2・① の基準得点・1 段が v1099 の端末で保存し直され/.test(x)));
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
