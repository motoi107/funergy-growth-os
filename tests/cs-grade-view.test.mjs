// v1100 (Moto 10/21 "キャリアスコアの評価対象と点数表示"):
//  1. every grade evaluates and totals all eight categories (G2 too) — the same items for everyone, nothing hidden or locked by grade;
//  2. the person sees "total / the base of the current grade" (the official ① base of settings ②; default = criteria-line share × 420);
//  3. the main view is the current grade, total / base and met / below base; the category breakdown is folded, not a list of shortfalls;
//  4. the real total is kept (not cut at the base); unscored items give "評価途中" (never counted as 0 → below base); promotion stays separate.
// Runs the real code from index.html (FUNERGY_CAREER_CRITERIA, FUNERGY_KARTE_EVAL and FUNERGY_CS_GRADE_VIEW) in a VM with the synthetic
// company of tests/karte-eval.test.mjs (fictional staff and numbers). No network, no browser storage, no production data.
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
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const CSV = between('/* FUNERGY_CS_GRADE_VIEW_BEGIN */', '/* FUNERGY_CS_GRADE_VIEW_END */');
const fnSrc = name => { const i = SRC.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return SRC.slice(i + 1, SRC.indexOf('\n}\n', i) + 2); };

function co() {
  const c = company();
  vm.runInContext(`KEV2_START = '2026-Q3';
    var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };
    function bizToday(){ return '2026-09-20'; }
    function healthRing(p, col, size){ return '<ring p="'+Math.round(p)+'" c="'+col+'"></ring>'; }
    function ghBadge(g){ return '<badge>'+g+'</badge>'; }`, c);
  vm.runInContext(CSV, c);
  return c;
}
const view = (c, id, extra = '') => { c.ID = id; return run(c, `(function(){ var V=csvView(EMPS.find(function(e){ return e.id===ID; })${extra}); delete V.e; return V; })()`); };
// the synthetic company: H as in PHILO, every other item at 2 → A36 B36 C42 D34 E48 F24 G24 (244) + H
const SIZES = { A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 };
const shift = (c, name, n) => { let left = Math.abs(n); for (const [k, m] of Object.entries(SIZES)) { const t = Math.min(left, m); for (let i = 0; i < t; i++) c.SCORES[name].scores[k + i] = n > 0 ? 3 : 1; left -= t; if (!left) break; } assert.equal(left, 0); };

test('1. G2 is evaluated on all eight categories, like every other grade (420 points); the bonus ① total follows', () => {
  const c = co();
  const v = view(c, 'aki');
  assert.deepEqual(v.cats.map(x => x.key), ['H', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.deepEqual([v.g, v.max, v.score, v.un], ['G2', 420, 282, 0]);
  for (const id of ['ken', 'neo', 'mia', 'sam', 'gus']) assert.equal(view(c, id).max, 420, id);
  // the bonus ① total is the same eight categories and the same number
  const p = person(c, 'aki');
  assert.deepEqual([p.segs[0].items.c.score, p.segs[0].items.c.max, p.segs[0].items.c.base.bp], [282, 420, 252]);
  // the scoring screen is not cut by grade: the category list has no grade condition (specialists use their department sheet, by role)
  assert.doesNotMatch(fnSrc('lssCatsForName'), /empGrade|gradeOf|'G2'|G2/);
  assert.doesNotMatch(fnSrc('renderLssItems') + fnSrc('renderLssCatTabs'), /empGrade|cscCatKeys|'G2'/);
});

test('2–3. the main view: current grade · total / the base of the current grade · met or below — with an example for every grade', () => {
  const c = co();
  shift(c, 'Ken Sample', 20);     // 284 → 304
  shift(c, 'Mia Sample', 34);     // 281 → 315 (exactly at the base)
  shift(c, 'Gus Sample', 70);     // 280 → 350
  const ex = Object.fromEntries(['aki', 'ken', 'neo', 'mia', 'sam', 'gus'].map(id => { const v = view(c, id); return [id, [v.g, v.scope, v.score, v.bp, v.state, v.diff]]; }));
  assert.deepEqual(ex, {
    aki: ['G2', 'G2', 282, 252, 'met', 30],          // G2: base 252 = ceil(60% × 420)
    ken: ['G3', 'G3-sv', 304, 294, 'met', 10],       // G3 server leader: 294 = ceil(70% × 420)
    neo: ['G3', 'G3-kt', 278, 294, 'notmet', -16],   // G3 kitchen leader
    mia: ['G4', 'G4', 315, 315, 'met', 0],           // G4: 315 = 75% × 420; exactly at the base = met
    sam: ['G5', 'G5', 285, 336, 'notmet', -51],      // G5: 336 = 80% × 420
    gus: ['G6', 'G6', 350, 336, 'met', 14],          // G6 uses the G5 base
  });
  // the base is the same number the bonus ① uses (one official setting)
  for (const id of ['aki', 'ken', 'neo', 'mia', 'sam', 'gus']) assert.equal(view(c, id).bp, person(c, id).segs[0].items.c.base.bp, id);
  // the HTML: grade, "総合点 304 / 基準点 294 点", 基準達成 and the real points above the base (not cut at the base)
  c.ID = 'ken';
  const h = run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`);
  assert.match(h, /今のグレード/);
  assert.match(h, /<badge>G3<\/badge> <span[^>]*>サーバーリーダー<\/span>/);
  assert.match(h, /総合点 <b[^>]*>304<\/b><\/span> <span[^>]*><span[^>]*>\/<\/span> 基準点 <b[^>]*>294<\/b> 点<\/span>/);
  assert.match(h, />基準達成<\/span>/);
  assert.match(h, /基準点より ＋10 点/);
  assert.match(h, /<ring p="100"/, 'the ring is full above the base; the number shown is still 304');
  // the uniform 420 maximum is not the headline: it only appears inside the folded breakdown
  const main = h.split('<details')[0], cats = h.slice(h.indexOf('<details'));
  assert.doesNotMatch(main, /420/);
  assert.match(cats, /^<details style="[^"]*">/, 'folded (no "open")');
  assert.match(cats, /評価表の満点 420 点/);
  // below the base: one number to go, not a list of category shortfalls
  c.ID = 'neo';
  const hn = run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`);
  assert.match(hn, />基準未達<\/span>/);
  assert.match(hn, /基準点まで あと 16 点/);
  assert.doesNotMatch(hn, /あと \d+ 点[^<]*<\/[^>]+>[\s\S]*あと \d+ 点/, 'only one "to go"');
  assert.doesNotMatch(hn.split('<details')[0], /マーケティング|Needs Improvement|今月のフォーカス/);
  // English
  c.curLang = 'en';
  assert.match(run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`), /Total <b[^>]*>278<\/b>.*base <b[^>]*>294<\/b> pt.*Below base/s);
});

test('2. the base is the official setting of settings ② (and a personal setting if there is one), not a fixed number', () => {
  const c = co();
  // GM/CEO set G4 to 300 in v1100 (the form writes bp8 with the mark b8)
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { c: { bp8: 300, b8: 1, g3: 1, g2: 1 } }, _at: 1 } };
  assert.deepEqual([view(c, 'mia').bp, view(c, 'mia').state], [300, 'notmet']);
  // a personal setting wins
  c.STORE.bonus_eval_ovr = { 'mia|2026-Q3': { set: { c: { bp8: 270, b8: 1, g3: 1, g2: 1 } }, _at: 1 } };
  assert.deepEqual([view(c, 'mia').bp, view(c, 'mia').state, view(c, 'mia').diff], [270, 'met', 11]);
  // a later quarter's version does not apply to this quarter
  c.STORE.bonus_eval_rule['G3-sv|2026-Q4'] = { set: { c: { bp8: 250, b8: 1 } }, _at: 1 };
  assert.equal(view(c, 'ken').bp, 294);
});

test('4. unscored items: 評価途中 (no met / below judgement, never 0 → below); no record: 未評価; the real total is kept', () => {
  const c = co();
  delete c.SCORES['Aki Sample'].scores.E5;
  delete c.SCORES['Aki Sample'].scores.H0;
  const v = view(c, 'aki');
  assert.deepEqual([v.state, v.un, v.score, v.bp], ['partial', 2, 282 - 2 - 3, 252]);
  c.ID = 'aki';
  const h = run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`);
  assert.match(h, />評価途中<\/span>/);
  assert.match(h, /採点していない項目が 2 あります（評価が終わると判定します）/);
  assert.doesNotMatch(h, /基準未達|基準達成/);
  assert.match(h, /未評価 1<\/span>/, 'the breakdown names the categories with unscored items');
  // even a total already above the base waits for the review to finish
  shift(c, 'Aki Sample', 40);
  assert.equal(view(c, 'aki').state, 'partial');
  // no record at all → 未評価 (not 0 points)
  delete c.SCORES['Neo Sample'];
  const n = view(c, 'neo');
  assert.deepEqual([n.state, n.score, n.hasRec], ['none', 0, false]);
  c.ID = 'neo';
  const hn = run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`);
  assert.match(hn, />未評価<\/span>/);
  assert.match(hn, /まだ評価がありません/);
  assert.doesNotMatch(hn, /0 \/ 294/);
  // the live draft of the scoring screen
  c.ID = 'ken';
  const d = run(c, `(function(){ var e=EMPS.find(function(x){ return x.id===ID; }), s=JSON.parse(JSON.stringify(SCORES['Ken Sample'].scores)); for(var i=0;i<12;i++) s['A'+i]=3; var V=csvView(e, {scores:s}); return [V.score, V.state]; })()`);
  assert.deepEqual(d, [296, 'met']);
  assert.deepEqual(run(c, `(function(){ var V=csvView(EMPS.find(function(x){ return x.id===ID; }), {scores:{}}); return [V.state, V.scored]; })()`), ['none', 0]);
});

test('4. current-grade achievement and the next grade (promotion) are separate', () => {
  const c = co();
  // Aki (G2) meets the G2 base on the total; the promotion target (G3 tracks) is judged by category lines of its own
  assert.equal(view(c, 'aki').state, 'met');
  const st = run(c, `cscPromoState('Aki Sample')`);
  assert.deepEqual(st.targets.map(j => j.k), ['G3-op', 'G3-sv', 'G3-kt']);
  assert.ok(st.targets.every(j => j.all === 'ng'), 'the promotion lines (70% per category) are not met');
  // changing the promotion line into G2 (for G1 people: H, A, B, C) does not move the G2 base
  c.STORE.cs_criteria = { G2: { cats: { H: { m: 'pct', v: 90 }, A: { m: 'pct', v: 90 }, B: { m: 'pct', v: 90 }, C: { m: 'pct', v: 90 } }, _at: 1 } };
  assert.deepEqual([view(c, 'aki').bp, view(c, 'aki').state], [252, 'met']);
  // the detail screen shows the main card first and the promotion card ("次のグレード") after it
  const f = fnSrc('renderLssSummary');
  assert.match(f, /csvView\(e, \{scores:window\._lssDraft\|\|\{\}\}\)/);
  assert.ok(f.indexOf('csvMainHtml') < f.indexOf('lssNextTargetHtml(name)'));
  assert.doesNotMatch(f, /lssLevel|Needs Improvement|Strengths/);
});

test('bases that cannot be shown: G1 (no setting), G3 without a track (unless the three tracks agree), office sheet', () => {
  const c = co();
  c.EMPS.push({ id: 'ivy', name: 'Ivy Sample', title: '', role: 'crew', store: 'S1', status: '在籍' });
  c.SCORES['Ivy Sample'] = J(c.SCORES['Aki Sample']);
  const g1 = view(c, 'ivy');
  assert.deepEqual([g1.g, g1.state, g1.bp, g1.base.why], ['G1', 'nobase', null, 'g1']);
  c.ID = 'ivy';
  assert.match(run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`), /G1 には基準点の設定がありません/);
  // a G3 whose title gives no track: the three tracks have the same base → shown; once they differ → "職種が決まっていない"
  c.EMPS.push({ id: 'ola', name: 'Ola Sample', title: 'Store Leader', role: 'sl', store: 'S1', status: '在籍' });
  c.SCORES['Ola Sample'] = J(c.SCORES['Ken Sample']);
  assert.deepEqual([view(c, 'ola').bp, view(c, 'ola').state, view(c, 'ola').base.anyTrack], [294, 'notmet', true]);
  c.STORE.bonus_eval_rule = { 'G3-kt|2026-Q3': { set: { c: { bp8: 280, b8: 1 } }, _at: 1 } };
  assert.deepEqual([view(c, 'ola').bp, view(c, 'ola').state, view(c, 'ola').base.why], [null, 'nobase', 'track']);
  // the quarter's track chosen by GM/CEO decides it
  c.STORE.bonus_track = { [`${Q}|ola`]: { t: 'kt', at: 'x', by: 'GM', _at: 1 } };
  assert.deepEqual([view(c, 'ola').scope, view(c, 'ola').bp, view(c, 'ola').state], ['G3-kt', 280, 'met']);
  // office Career Score people are judged on the office sheet (Office tab), not here
  c.OCS['Mia Sample'] = true;
  assert.deepEqual([view(c, 'mia').state, view(c, 'mia').bp], ['office', null]);
});

test('a G2 base saved before v1100 (on the 225-point four-category sheet) is not used: listed, the amount waits, the person sees "確認中"', () => {
  const c = co();
  // saved in v1099 for G2 (bp / bs, no mark b8): 135 points / step 7 on 225
  c.STORE.bonus_eval_rule = { 'G2|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 135, bs: 7 } }, _at: 1 } };
  const p = person(c, 'aki');
  assert.equal(p.blocked, 'eval');
  assert.equal(p.segs[0].items.c.coef, null);
  assert.match(p.missing.join(), /G2 の基準得点・1 段の点は v1099（4 カテゴリー・225 点満点）のときに保存された値です.*選び直してください/);
  const M = run(c, `kevMisfits3('${Q}')`);
  assert.ok(M.block.some(x => /G2・① の基準得点・1 段：v1099/.test(x.t) && /kevRuleOpen\('G2','c'\)/.test(x.act)));
  assert.ok(M.info.some(x => /G2 の ① も 8 カテゴリー（420 点満点・初期の基準得点 252 点・1 段 13 点）/.test(x)));
  const v = view(c, 'aki');
  assert.deepEqual([v.state, v.bp, v.base.why], ['nobase', null, 'legacy']);
  // the settings table shows it in red
  c.curRole = 'gm';
  assert.match(run(c, `kevCsBaseCardHtml(kbCfg())`), /225 点満点のときの値・選び直し/);
  assert.match(run(c, `kevCsBaseCardHtml(kbCfg())`), /<badge>G2<\/badge> G2<\/td><td[^>]*>8 カテゴリー・420 点/);
  // re-selected on the v1100 form (bp8 / bs8 with the mark b8; the v1099 values stay in bp / bs for v1099) → used again
  c.STORE.bonus_eval_rule['G2|2026-Q3'].set.c = { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bs8: 13, bp: 135, bs: 7 };
  assert.deepEqual([person(c, 'aki').segs[0].coefs.c, view(c, 'aki').bp, view(c, 'aki').state], [1.05, 260, 'met']);
  assert.ok(!run(c, `kevMisfits3('${Q}')`).block.some(x => /G2・①/.test(x.t)));
  // only the base or only the step from v1099 is still not used
  c.STORE.bonus_eval_rule['G2|2026-Q3'].set.c = { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bs: 7 };
  assert.equal(person(c, 'aki').blocked, 'eval');
  // G3 and above were 420 points before: their v1099 values are used as they are
  c.STORE.bonus_eval_rule = { 'G3-sv|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 280 } }, _at: 1 } };
  assert.deepEqual([person(c, 'ken').blocked, view(c, 'ken').bp, view(c, 'ken').state], [null, 280, 'met']);
  // a personal v1099 setting for a G2 store person is listed for that person
  c.STORE.bonus_eval_ovr = { 'aki|2026-Q3': { set: { c: { bp: 140, g3: 1, g2: 1 } }, _at: 1 } };
  assert.ok(run(c, `kevMisfits3('${Q}')`).block.some(x => /個人設定 Aki Sample・① の基準得点/.test(x.t)));
  assert.equal(view(c, 'aki').base.why, 'legacy');
});

test('the screens use the new view: My page, the Career Score list, the growth chart tiles; the bonus ① card no longer says "G2 は 4 カテゴリー"', () => {
  const my = SRC.slice(SRC.indexOf('// 6b. Your Leadership Skill'), SRC.indexOf('// 6c. My Career Journey'));
  assert.match(my, /var lV = csvView\(meEmpL\);/);
  // v1108 (UI案61): the main display is the strengths; this view (total / base, categories) is inside "評価の内訳を見る" (tests/cs-strengths.test.mjs)
  assert.match(my, /cssProfileHtml\(meEmpL, \{self:true, V:lV, bdExtra:lExtra\}\)/);
  assert.doesNotMatch(my, /focusCats|llv\.label|lssLevel\(/);
  const list = SRC.slice(SRC.indexOf('// リーダー一覧（スコアカード）'), SRC.indexOf('// 履歴（スコア＋申請承認）'));
  assert.match(list, /var cV = csvView\(e\);/);
  assert.match(list, /csvListPtsHtml\(cV, cR\) \+ csvCatsListHtml\(cV\)/);   // v1113 (UI案63 B): the categories stay open on the list cards
  assert.match(list, /cssListLineHtml\(cV, cR\)/);
  assert.doesNotMatch(list, /lv\.label|lssRingPts/);
  assert.equal((SRC.match(/_kTile\('Career Score', cssTileValHtml\(R\), escapeHtml\(\(V\.g\|\|'—'\)\+'・'\+cssPtsTxt\(V\)\)/g) || []).length, 2, 'the person view and the manager view of the growth chart');
  assert.doesNotMatch(SRC, /G2 は 理念・基本業務・サービス・キッチン\/プレップ の 4 カテゴリーで数えます/);
  assert.doesNotMatch(SRC, /cats=\(ghNormG\(x\[0\]\)==='G2'\) \? '4 カテゴリー'/);
  assert.ok(Number((SRC.match(/const APP_VERSION = '(\d+)';/) || [])[1]) >= 1100);
});

test('the bonus ① card for G2: the category table marks the categories outside the G2 promotion line; a grade change of a G2 person needs all eight scored', () => {
  const c = co();
  const T = person(c, 'aki').segs[0].items.c.total;
  const h = run(c, `kevCsCatTableHtml(${JSON.stringify(T)}, 'G2', '', 'G2')`);
  const row = k => { const nm = run(c, `cscCatName('${k}')`); const i = h.indexOf('>' + nm + '</td>'); assert.ok(i > 0, k); return h.slice(i, h.indexOf('</tr>', i)); };
  for (const k of ['H', 'A', 'B', 'C']) assert.match(row(k), / 点<\/td>/, k + ' has the G2 line (reference)');
  for (const k of ['D', 'E', 'F', 'G']) assert.match(row(k), /基準ラインなし/, k + ' only counts toward the total');
  // the grade-change confirmation counts all eight for G2 (an unscored D item stops it; before v1100 only H, A, B, C did)
  c.ID = 'aki';
  assert.equal(run(c, `kevCsUnFor(EMPS.find(function(e){ return e.id===ID; }), 'G2', null, {H:0, A:0, B:0, C:0, D:1, E:0, F:0, G:0})`), 1);
  assert.equal(run(c, `kevCsUnFor(EMPS.find(function(e){ return e.id===ID; }), 'G2', null, {H:0, A:0, B:0, C:0, D:0, E:0, F:0, G:0})`), 0);
});

test('independent review P1-1: the settings forms do not put a v1099 G2 base back into the fields (a plain re-save must not mark 225-point values as 420-point ones)', () => {
  const c = co();
  c.curRole = 'gm';
  c.STORE.bonus_eval_rule = { 'G2|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 135, bs: 7 } }, _at: 1 } };
  run(c, `kevRuleOpen('G2', 'c')`);
  const F = run(c, `window._kevForm.cs`);
  assert.deepEqual([F.own.bp, F.own.bs, F.def.bp, F.def.bs, F.max, F.legacy.bp, F.legacy.bs, F.legacy.g2bp, F.legacy.lost], [false, false, 252, 13, 420, true, true, true, null]);
  const html = c.MODAL.at(-1);
  assert.match(html, /id="kevf-bp"[^>]*value=""[^>]*placeholder="252"/);
  assert.doesNotMatch(html, /value="135"|value="7"/);
  assert.match(html, /v1099（G2 は 4 カテゴリー・225 点満点）のときの点なので、ここには入れていません/);
  // the GM only changes the range and saves as it is: the base goes back to the default (252), not 135
  c.DOM['@kevf-on'] = { value: '1' };
  Object.assign(c.DOM, { 'kevf-lo': { value: '0.90' }, 'kevf-hi': { value: '1.15' }, 'kevf-bp': { value: '' }, 'kevf-bs': { value: '' } });
  const set = run(c, `kevFormRead('c', 'kevf-')`);
  assert.deepEqual([set.c.bp8, set.c.bs8, set.c.b8, 'bp' in set.c, 'bs' in set.c, 'cs8' in set.c], [null, null, 1, false, false, false]);
  assert.equal(run(c, `kevRuleSave('G2', '${Q}', ${JSON.stringify(set)}, 'v1100 で選び直し', '① を変更')`), true);
  const p = person(c, 'aki');
  assert.deepEqual([p.blocked, p.segs[0].items.c.base.bp, p.segs[0].items.c.base.bs, p.segs[0].coefs.c], [null, 252, 13, 1.1]);
  assert.deepEqual([view(c, 'aki').bp, view(c, 'aki').state], [252, 'met']);
  // a v1100 value (bp8) is shown in the field again
  c.STORE.bonus_eval_rule['G2|2026-Q3'].set.c = { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, b8: 1, bp8: 260, bp: 135, bs: 7 };
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.legacy.bp]`), [true, false]);
  assert.match(c.MODAL.at(-1), /id="kevf-bp"[^>]*value="260"/);
  // a v1099 value that comes from the company-wide level is not used as the field's default either
  c.STORE.bonus_eval_rule = { '_common|2026-Q3': { set: { c: { bp: 135, bs: 7 } }, _at: 1 } };
  run(c, `kevRuleOpen('G2', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp, window._kevForm.cs.def.bs, window._kevForm.cs.legacy.bp]`), [false, 252, 13, true]);
  assert.equal(view(c, 'aki').base.why, 'legacy');
  // G3 and above: a v1099 value is kept in the field (it was on 420 points already)
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { c: { on: true, lo: 0.85, hi: 1.15, g2: 1, g3: 1, bp: 300 } }, _at: 1 } };
  run(c, `kevRuleOpen('G4', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.legacy.bp]`), [true, false]);
  // the personal form of a G2 store person with a v1099 personal value
  c.STORE.bonus_eval_rule = {};
  c.STORE.bonus_eval_ovr = { 'aki|2026-Q3': { set: { c: { bp: 140, g2: 1, g3: 1 } }, _at: 1 } };
  run(c, `kevOvrOpen('aki', 'c')`);
  assert.deepEqual(run(c, `[window._kevForm.cs.own.bp, window._kevForm.cs.def.bp, window._kevForm.cs.legacy.bp]`), [false, 252, true]);
  assert.doesNotMatch(c.MODAL.at(-1), /value="140"/);
});

test('independent review P2-1: the person view uses the quarter being assessed (the growth-chart quarter), like the bonus — not today\'s quarter', () => {
  const c = co();
  vm.runInContext(`function ghQOf(){ return '2026-Q4'; }`, c);   // today is in Q4, the growth chart still assesses Q3
  c.STORE.bonus_eval_rule = { 'G2|2026-Q4': { set: { c: { bp8: 300, b8: 1 } }, _at: 1 } };
  assert.deepEqual([view(c, 'aki').q, view(c, 'aki').bp, view(c, 'aki').state], ['2026-Q3', 252, 'met']);
  assert.equal(view(c, 'aki').bp, person(c, 'aki').segs[0].items.c.base.bp);
  // the Q3 track chosen by GM/CEO is used for a G3 person without a track title
  c.EMPS.push({ id: 'ola', name: 'Ola Sample', title: 'Store Leader', role: 'sl', store: 'S1', status: '在籍' });
  c.SCORES['Ola Sample'] = J(c.SCORES['Ken Sample']);
  c.STORE.bonus_eval_rule['G3-kt|2026-Q3'] = { set: { c: { bp8: 280, b8: 1 } }, _at: 1 };
  c.STORE.bonus_track = { [`${Q}|ola`]: { t: 'kt', at: 'x', by: 'GM', _at: 1 } };
  assert.deepEqual([view(c, 'ola').scope, view(c, 'ola').bp], ['G3-kt', 280]);
  // when the growth-chart quarter cannot be read, today's quarter
  vm.runInContext(`var _kbCfg0 = kbCfg; kbCfg = function(){ return Object.assign(_kbCfg0(), {quarter:''}); };`, c);
  assert.equal(view(c, 'aki').q, '2026-Q4');
});

test('independent review P2-2: a G2 grade change confirmed under v1099 with only D–G unscored is named as such (not counted as 0) and listed', () => {
  const c = co();
  c.SEGS.ken = [{ g: 'G2', from: '2026-07-01', to: '2026-08-14', days: 45 }, { g: 'G3', from: '2026-08-15', to: '2026-09-30', days: 47 }];
  c.STORE.bonus_eval[`${Q}|ken|G2`] = { st: 'done', _at: 1 };
  const cats = run(c, `lssSummary('Ken Sample').cats`).map(x => ({ key: x.key, score: x.score, max: x.max }));
  const cun = Object.fromEntries(cats.map(x => [x.key, 0])); cun.D = 2; cun.F = 1;
  c.STORE.grade_hist = { ken: { recs: [{ d: '2026-08-14', g: 'G3', from: 'G2', start: false, prevEval: { g: 'G2', kv: 2, hUn: 0, cun, cats, at: '2026-08-14 10:00', by: 'CEO' } }] } };
  const p = person(c, 'ken');
  assert.equal(p.blocked, 'eval');
  assert.equal(p.segs[0].items.c.total.missing, 'unscored');
  assert.equal(p.segs[0].items.c.total.g2old, true);
  assert.match(p.missing.join(), /未評価の項目が 3 あります.*0 点では数えません（v1099 で確定した記録で、そのときは G2 を理念・基本業務・サービス・キッチン\/プレップの 4 カテゴリーで確かめていました/);
  const M = run(c, `kevMisfits3('${Q}')`);
  assert.ok(M.block.some(x => /Ken Sample：8\/14 に G2 から変えたときの評価（v1099 で確定）に、v1100 から数える マーケティング 2・数字管理 1 項目の未評価があります/.test(x.t) && /kevOpenPerson/.test(x.act)));
  // an unscored H item is a plain 未評価 (it was checked under v1099 too): not named as a v1099 gap, not listed
  cun.D = 0; cun.F = 0; cun.H = 1;
  const p2 = person(c, 'ken');
  assert.deepEqual([p2.segs[0].items.c.total.missing, !!p2.segs[0].items.c.total.g2old], ['unscored', false]);
  assert.ok(!run(c, `kevMisfits3('${Q}')`).block.some(x => /v1099 で確定/.test(x.t)));
});

test('independent review P2-3: the view shown to the person has one verdict (no Level badge in its header); the manager page keeps it', () => {
  assert.match(fnSrc('kdHeadHtml'), /\(noLv \? '' : '<span/);
  const self = fnSrc('renderKarteSelfView');
  assert.match(self, /kdHeadHtml\(e, g, gcol, lv, true\)/);
  assert.equal((SRC.match(/kdHeadHtml\(e, g, gcol, lv\);/g) || []).length, 1, 'the manager page');
});

test('specialists (department sheet, by role): the view uses the department categories of the person it is given, without re-reading the roster; base = the store share × 96', () => {
  const c = co();
  vm.runInContext(`function specialistCats(d){ return d ? ['A','B','C','D','E','F','G','H'].map(function(k){ return {key:k, name:d+' '+k, en:k, icon:'ti-star', items:['1','2','3','4']}; }) : null; }
    function lssCatsForName(n){ var e=getEmployees().find(function(x){ return x.name===n; }), d=e ? empSpecialistDept(e) : null; return (d && specialistCats(d)) || lssCatsOrdered(); }   /* like the real one (the bonus side reads it) */
    var _ge0 = getEmployees, GE_CALLS = 0; getEmployees = function(){ GE_CALLS++; return _ge0(); };`, c);
  const sc = {}; for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) for (let i = 0; i < 4; i++) sc[k + i] = 2;
  c.SCORES['Ray Sample'] = { evaluator: 'GM', date: '2026/09/20', scores: sc, status: '確定' };
  c.GE_CALLS = 0;
  const v = view(c, 'ray');
  assert.deepEqual([v.sheet, v.cats.length, v.max, v.score, v.bp, v.state], ['spec', 8, 96, 64, 72, 'notmet']);
  assert.equal(v.bp, person(c, 'ray').segs[0].items.c.base.bp, 'the same base as the bonus ①');
  c.GE_CALLS = 0;
  run(c, `(function(){ var e=EMPS.find(function(x){ return x.id==='aki'; }); for(var i=0;i<20;i++) csvView(e); })()`);
  assert.equal(c.GE_CALLS, 0, 'no roster read per person');
});
