// v1102 (Moto 10/21 12:37 · 12:46 HST requests, 13:52 HST answers to UI案59): specialist careers × grades.
//  1. the scoring items stay the department sheets (経理・調理 96 points, サービス・マーケ 24 points); the base is held per career × grade;
//  2. every career × grade base starts "基準未設定"; the store grade base is never used instead; an unset base stops that person's bonus ① (with the reason);
//  3. from 2026 Q3 (not confirmed yet → recalculated);
//  4. 事務Crew Leader = 経理 G2 (hourly), Accounting Leader = 経理 G3 (hourly); 5. Office Manager is shown as Accounting Manager (stored key unchanged);
//  7. per career × grade: the title holder's default role and hidden pages, and who views / scores / approves that person's Career Score
//     (not set = the current rules; new titles never change the role by themselves);
//  8. the office Career Score stays a separate sheet (its base can be set; not set = the current derived rule);
//  9. G5 specialists use ① in the bonus.
// Runs the real code from index.html (FUNERGY_CAREER_CRITERIA, FUNERGY_KARTE_EVAL, FUNERGY_CS_GRADE_VIEW, FUNERGY_SPECIALIST_CAREER and the
// permission / nav / employee-form hooks) in a VM with the synthetic company of tests/karte-eval.test.mjs (fictional staff and numbers).
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
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const varBlock = (name, close) => { const k = SRC.includes('\nconst ' + name + ' = ') ? 'const ' : 'var '; const i = SRC.indexOf('\n' + k + name + ' = '), j = SRC.indexOf(close, i); assert.ok(i >= 0 && j > i, name); return 'var ' + SRC.slice(i + 1 + k.length, j + close.length); };
const fnSrc = name => fn(name);
const CSV = between('/* FUNERGY_CS_GRADE_VIEW_BEGIN */', '/* FUNERGY_CS_GRADE_VIEW_END */');
const SPEC = between('/* FUNERGY_SPECIALIST_CAREER_BEGIN */', '/* FUNERGY_SPECIALIST_CAREER_END */');
const seg = (c, id) => person(c, id).segs[0];
const toast = c => (c.TOASTS.at(-1) || [''])[0];

// the synthetic company (2026 Q3, v1099+ rules) with the specialist careers loaded, plus:
//  cora — Corporate Chef (G5 調理), oli — 事務Crew Leader (G2 経理), lea — Accounting Leader (G3 経理), max — Accounting Manager (stored 'Office Manager', G4 経理, role office)
function co() {
  const c = company();
  vm.runInContext(`KEV2_START = '2026-Q3';
    var DOM = {}; var document = { getElementById:function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; }, querySelector:function(sel){ var m=String(sel).match(/name="([^"]+)"/); return (m && DOM['@'+m[1]]) || null; }, querySelectorAll:function(){ return []; } };
    function bizToday(){ return '2026-09-20'; }
    function healthRing(p, col, size){ return '<ring p="'+Math.round(p)+'"></ring>'; }
    function ghBadge(g){ return '<badge>'+g+'</badge>'; }`, c);
  vm.runInContext([varBlock('SPECIALIST_DEPTS', '\n};'), varBlock('SPECIALIST_AXIS_ITEMS', '\n};'), fnSrc('specialistCats'), varBlock('JOB_TITLES', '\n];'), fnSrc('jobTitle'),
    varBlock('CS_GUIDE_DEF', '\n};'), CSV, SPEC,
    ...['lssRoleRank', 'canEditLss', 'canViewOthersLss', 'lssG4Sees', 'lssIsSelf', 'lssCanSelfRequest', 'lssNeedsApproval', 'lssCanApproveScore', 'lssReqByMe', 'lssApproverName', 'gradeNum', 'ocsOfficeLike'].map(fnSrc)].join('\n'), c);
  vm.runInContext(`
    lssCatsForName = function(n){ var e=EMPS.find(function(x){ return x.name===n; }), d=e ? empSpecialistDept(e) : null; return d ? specialistCats(d) : lssCatsOrdered(); };
    ROLE_CONFIG = { ceo:{name:'CEO', label:'CEO'}, gm:{name:'GM', label:'GM'}, am:{label:'AM'}, g4:{label:'Store Manager'}, sl:{label:'Store Leader'}, g2:{label:'Crew Leader'}, crew:{label:'Crew'}, office:{label:'経理'}, office_crew:{label:'事務Crew'}, chef:{label:'Head Chef'} };
    var curRealRole = 'gm', curStoreLogin = false, lssView = 'score', curPage = 'leadership';
    function lssG4SeesName(){ return true; } function _lssG4CanEdit(){ return false; } function go(p){ GO = p; } var GO = '';
    function getLssRequests(){ return ls('lss_requests', []); }`, c);
  // the extra people (fictional)
  const add = (id, name, title, g, role, store) => { c.EMPS.push({ id, name, title, g, role, store: store || 'S1', status: '在籍' }); const sc = {}; for (const k of 'ABCDEFGH') for (let i = 0; i < 4; i++) sc[k + i] = 2; c.SCORES[name] = { evaluator: 'GM', date: '2026/09/20', scores: sc, status: '確定' }; };
  add('cora', 'Cora Sample', 'Corporate Chef', 'G5', 'am', 'S3');
  add('oli', 'Oli Sample', 'Office Crew Leader', 'G2', 'office_crew');
  add('lea', 'Lea Sample', 'Accounting Leader', 'G3', 'office_crew');
  add('max', 'Max Sample', 'Office Manager', 'G4', 'office');
  c.EMPS.find(e => e.id === 'cora').stores = ['S3', 'S4'];
  for (const id of ['cora', 'oli', 'lea', 'max']) c.STORE.bonus_eval[`${Q}|${id}|${c.EMPS.find(e => e.id === id).g}`] = { ab: { lv: 3 }, kn: { lv: 3 }, qu: { lv: 3 }, st: 'done', _at: 1 };
  for (const id of ['mia', 'ray']) c.STORE.bonus_eval[`${Q}|${id}|G4`].fx = { lv: 3, why: '発注量の見直し', c_cause: true, c_plan: true, c_exec: true, c_due: true, c_svc: true };
  vm.runInContext(`kbCfg = (function(old){ return function(){ var x=old(); x.gradeBase=Object.assign({}, x.gradeBase); return x; }; })(kbCfg);`, c);
  return c;
}
const setBase = (c, dept, g, bp, bs, from = Q) => { c.STORE.bonus_eval_rule = c.STORE.bonus_eval_rule || {}; c.STORE.bonus_eval_rule[`cg:${dept}:${g}|${from}`] = { set: { c: { b8: 1, bp8: bp, bs8: bs } }, _at: 5, _t: { c: 5 } }; };
const view = (c, id) => { c.ID = id; return run(c, `(function(){ var V=csvView(EMPS.find(function(e){ return e.id===ID; })); delete V.e; return V; })()`); };

test('4・5. titles: 事務Crew Leader (経理 G2, hourly) and Accounting Leader (経理 G3, hourly) are new; Office Manager is shown as Accounting Manager (key kept)', () => {
  const c = co();
  const jt = k => run(c, `jobTitle(${JSON.stringify(k)})`);
  assert.deepEqual([jt('Office Crew Leader').label, jt('Office Crew Leader').payType, jt('Office Crew Leader').permRole], ['事務Crew Leader', 'hourly', undefined]);
  assert.deepEqual([jt('Accounting Leader').label, jt('Accounting Leader').payType, jt('Accounting Leader').permRole], ['Accounting Leader', 'hourly', undefined]);
  assert.deepEqual([jt('Office Manager').key, jt('Office Manager').label, jt('Office Manager').payType, jt('Office Manager').permRole], ['Office Manager', 'Accounting Manager', 'monthly', 'office']);
  assert.deepEqual(['Office Crew Leader', 'Accounting Leader', 'Accountant', 'Office Manager', 'Head Chef', 'Corporate Chef', 'Customer Service Manager'].map(k => [run(c, `gradeOf(${JSON.stringify(k)})`), run(c, `titleCareer(${JSON.stringify(k)})`)]),
    [['G2', '経理'], ['G3', '経理'], ['G4', '経理'], ['G4', '経理'], ['G4', '調理'], ['G5', '調理'], ['G5', 'サービス']]);
  // the display name: Accounting Manager (stored 'Office Manager'); the English screen uses the English name of 事務Crew titles
  assert.equal(run(c, `jobTitleLabel('Office Manager')`), 'Accounting Manager');
  assert.equal(run(c, `empTitleTxt(EMPS.find(function(e){ return e.id==='max'; }))`), 'Accounting Manager（経理）');
  c.curLang = 'en';
  assert.equal(run(c, `jobTitleLabel('Office Crew Leader')`), 'Office Crew Leader');
  c.curLang = 'ja';
  assert.equal(run(c, `jobTitleLabel('Office Crew Leader')`), '事務Crew Leader');
  assert.match(run(c, `empTitleHtml(EMPS.find(function(e){ return e.id==='lea'; }))`), /^<badge>G3<\/badge> <b>Accounting Leader<\/b> <span[^>]*>経理<\/span>$/);
  // the wage table keeps one input per title (ids are built from the letters of the key)
  const ids = run(c, `JOB_TITLES.map(function(t){ return t.key.replace(/[^A-Za-z]/g,''); })`);
  assert.equal(new Set(ids).size, ids.length);
  // office-like titles (office Career Score assignment), tips follow the role (no new tip rule)
  for (const k of ['Office Crew Leader', 'Accounting Leader', 'Office Manager']) assert.equal(run(c, `ocsOfficeLike({role:'crew', title:${JSON.stringify(k)}})`), true, k);
  assert.doesNotMatch(fnSrc('isTipEligibleRole') + (SRC.match(/var TIP_EXCLUDED_TITLES[^\n]*/) || [''])[0], /Accounting|Office Crew Leader/);
});

test('2. a specialist base starts "基準未設定": bonus ① stops with the reason and the store grade base is never used instead', () => {
  const c = co();
  const ray = seg(c, 'ray');
  assert.equal(ray.items.c.total.sheet, 'spec');
  assert.deepEqual([ray.items.c.max, ray.items.c.score, ray.items.c.base.bp, ray.items.c.base.unset, ray.items.c.coef], [96, 68, null, true, null]);
  assert.deepEqual(ray.items.c.base.cg, { dept: '調理', g: 'G4', prefix: 'cg:調理:G4', from: null, set: false });
  const p = person(c, 'ray');
  assert.equal(p.blocked, 'eval');
  assert.match(p.missing.join(), /調理 × G4 の基準点が設定されていません.*通常 G4 の基準点では計算しません/);
  // store people are not touched (Mia G4 store: 315 / 13 as before)
  assert.deepEqual([seg(c, 'mia').items.c.base.bp, seg(c, 'mia').items.c.base.bs, seg(c, 'mia').items.c.base.cg], [315, 13, undefined]);
  // the store G4 base changes → Ray stays 基準未設定 (no silent follow-up)
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { c: { b8: 1, bp8: 300, bs8: 13 } }, _at: 1 } };
  assert.equal(seg(c, 'ray').items.c.base.bp, null);
  assert.equal(seg(c, 'mia').items.c.base.bp, 300);
  // the misfit list names the career × grade and the people, with the button to set it
  const M = run(c, `kevMisfits3('${Q}')`);
  const hit = M.block.find(x => /調理 × G4 の基準点が未設定/.test(x.t));
  assert.ok(hit && /Ray Sample/.test(hit.t) && /cgBaseOpen/.test(hit.act), JSON.stringify(M.block));
  assert.ok(M.block.some(x => /調理 × G5 の基準点が未設定.*Cora Sample/.test(x.t)));
  assert.ok(M.block.some(x => /経理 × G3 の基準点が未設定.*Lea Sample/.test(x.t)));
});

test('1・2. a career × grade base set by GM/CEO is used on the department sheet (96 / 24 points); ties go up; a personal base still wins', () => {
  const c = co();
  setBase(c, '調理', 'G4', 70, 3);
  const s = seg(c, 'ray');
  assert.deepEqual([s.items.c.base.bp, s.items.c.base.bs, s.items.c.base.srcBp, s.items.c.step, s.coefs.c], [70, 3, 'career', -1, 0.95]);
  setBase(c, '調理', 'G4', 68, 3);
  assert.deepEqual([seg(c, 'ray').items.c.step, seg(c, 'ray').coefs.c], [0, 1], 'exactly on the base = ×1.00');
  setBase(c, '調理', 'G4', 62, 3);
  assert.deepEqual([seg(c, 'ray').items.c.step, seg(c, 'ray').coefs.c], [2, 1.1], '68 ≥ 62 + 2×3');
  // 1 step not set → 3% of the sheet maximum (96 → 3)
  c.STORE.bonus_eval_rule['cg:調理:G4|2026-Q3'].set.c = { b8: 1, bp8: 66 };
  assert.deepEqual([seg(c, 'ray').items.c.base.bs, seg(c, 'ray').items.c.base.srcBs], [3, 'sheetDef']);
  // a personal base in the person's own points wins over the career base
  c.STORE.bonus_eval_ovr['ray|2026-Q3'].set.c = { b8: 1, bp8: 60, bs8: 2 };
  assert.deepEqual([seg(c, 'ray').items.c.base.bp, seg(c, 'ray').items.c.base.srcBp, seg(c, 'ray').coefs.c], [60, 'person', 1.15]);
  // サービス (24 points: 8 axes × 1 item)
  const d = co();
  d.EMPS.push({ id: 'cs', name: 'Csm Sample', title: 'Customer Service Manager', g: 'G5', role: 'am', store: 'S5', status: '在籍' });
  d.SCORES['Csm Sample'] = { evaluator: 'GM', date: '2026/09/20', scores: Object.fromEntries('ABCDEFGH'.split('').map(k => [k + '0', 2])), status: '確定' };
  d.STORE.bonus_eval[`${Q}|cs|G5`] = { st: 'done', _at: 1 };
  assert.deepEqual([seg(d, 'cs').items.c.max, seg(d, 'cs').items.c.score, seg(d, 'cs').items.c.base.unset], [24, 16, true]);
  setBase(d, 'サービス', 'G5', 16, 1);
  assert.deepEqual([seg(d, 'cs').items.c.base.bp, seg(d, 'cs').coefs.c], [16, 1]);
});

test('9. G5 specialists use ① (Corporate Chef); the store G5 (Area Manager) keeps ① fixed at 1.00', () => {
  const c = co();
  const cora = seg(c, 'cora');
  assert.deepEqual([cora.items.c.on, cora.src.c], [true, 'career']);
  assert.equal(person(c, 'cora').blocked, 'eval', 'unset base → ① stops');
  setBase(c, '調理', 'G5', 70, 3);
  assert.deepEqual([seg(c, 'cora').items.c.score, seg(c, 'cora').items.c.coef, seg(c, 'cora').coefs.c], [64, 0.9, 0.9], '64 is 2 steps of 3 below 70');
  setBase(c, '調理', 'G5', 64, 3);
  assert.deepEqual([seg(c, 'cora').items.c.coef, person(c, 'cora').blocked], [1, null]);
  assert.equal(seg(c, 'sam').items.c.on, false, 'Area Manager (store) unchanged');
  // a personal setting can still fix ① at 1.00 for one person
  c.STORE.bonus_eval_ovr['cora|2026-Q3'] = { set: { c: { on: false, g2: 1 } }, _at: 3 };
  assert.equal(seg(c, 'cora').items.c.on, false);
});

test('3. from 2026 Q3: an earlier quarter keeps the old derived rule; a version from 2026 Q4 does not change Q3; a grade-change segment uses its own grade', () => {
  const c = co();
  assert.equal(run(c, `kevRuleFor('G4', '2026-Q2', 'ray', null, kbCfg()).cg`), null);
  assert.equal(run(c, `kevRuleFor('G4', '2026-Q3', 'ray', null, kbCfg()).cg.prefix`), 'cg:調理:G4');
  assert.equal(run(c, `kevRuleFor('G3-op', '2026-Q3', 'ray', null, kbCfg()).cg.prefix`), 'cg:調理:G3', 'the segment grade, not today\'s');
  assert.equal(run(c, `kevRuleFor('G4', '2026-Q3', 'mia', null, kbCfg()).cg`), null, 'store sheet: no career layer');
  setBase(c, '調理', 'G4', 70, 3, '2026-Q4');
  assert.equal(seg(c, 'ray').items.c.base.bp, null);
  setBase(c, '調理', 'G4', 66, 3, '2026-Q3');
  assert.equal(seg(c, 'ray').items.c.base.bp, 66);
  // a G3 specialist needs no G3 track (the base does not depend on it)
  setBase(c, '経理', 'G3', 60, 3);
  const lea = seg(c, 'lea');
  assert.deepEqual([lea.key, lea.items.c.base.bp, person(c, 'lea').blocked], ['G3-op', 60, null]);
  // the old code path (before 2026 Q3 / no career layer) is unchanged: the store share × 96
  assert.equal(run(c, `(function(){ var RF=kevRuleFor('G4', '2026-Q3', null, null, kbCfg()); return kevCsBase(RF.r, RF, {sheet:'spec', max:96}, 'G4').bp; })()`), Math.ceil(315 * 96 / 420 - 1e-9));
});

test('8. office Career Score: not set = the current rule (store share × 100); a base set in Score管理 is used', () => {
  const c = co();
  c.OCS['Ken Sample'] = true;
  c.OCS['ev:ken'] = { conf: { at: '2026-09-29T10:00:00Z', by: 'CEO' }, state: { k: 'ok', calc: { total: 72, counts: { uc: 0 } } } };
  let s = seg(c, 'ken');
  assert.deepEqual([s.items.c.total.sheet, s.items.c.base.bp, s.items.c.base.bs, s.items.c.base.derived, s.items.c.base.cg.prefix, s.coefs.c], ['office', 70, 3, true, 'cg:office:G3', 1]);
  setBase(c, 'office', 'G3', 75, 2);
  s = seg(c, 'ken');
  assert.deepEqual([s.items.c.base.bp, s.items.c.base.bs, s.items.c.base.srcBp, s.coefs.c], [75, 2, 'career', 0.9], '72 is 1.5 steps of 2 below 75 → 2 steps');
  assert.equal(run(c, `cgOfficeDerived('G3', '${Q}').bp`), 70);
});

test('the person view: 基準未設定 with the career × grade named; then total / base; title and career shown; 期待されること', () => {
  const c = co();
  let v = view(c, 'ray');
  assert.deepEqual([v.state, v.base.why, v.cg.key, v.max, v.score], ['nobase', 'cgunset', '調理|G4', 96, 68]);
  c.ID = 'ray';
  let h = run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`);
  assert.match(h, /<badge>G4<\/badge> <span[^>]*>Head Chef<\/span> <span[^>]*>調理<\/span>/);
  assert.match(h, />基準未設定<\/span>/);
  assert.match(h, /調理 × G4 の基準点はまだ設定されていません（GM・CEO が設定します）/);
  assert.match(h, /期待されること/);
  assert.match(h, /まだ書かれていません/);
  setBase(c, '調理', 'G4', 70, 3);
  v = view(c, 'ray');
  assert.deepEqual([v.state, v.bp, v.diff], ['notmet', 70, -2]);
  setBase(c, '調理', 'G4', 60, 3);
  assert.deepEqual([view(c, 'ray').state, view(c, 'ray').diff], ['met', 8], 'above the base: the real total stays');
  // a G3 specialist without a track still gets a base; Accounting Manager shows the new name
  setBase(c, '経理', 'G3', 60, 3); setBase(c, '経理', 'G4', 70, 3);
  assert.deepEqual([view(c, 'lea').scope, view(c, 'lea').bp], ['G3-op', 60]);
  c.ID = 'max';
  assert.match(run(c, `csvGradeHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`), /Accounting Manager<\/span> <span[^>]*>経理<\/span>/);
  // the expectation text written for the career × grade
  c.STORE.cs_guide = { 'cg|調理|G4@ja': { v: { what: '店舗の味をそろえ、原価を説明できる' }, _at: 1 } };
  c.ID = 'ray';
  assert.match(run(c, `csvMainHtml(csvView(EMPS.find(function(e){ return e.id===ID; })))`), /店舗の味をそろえ、原価を説明できる/);
});

test('saving a base (GM/CEO): reason and start quarter, a confirmed quarter refused, clearing goes back to 基準未設定; the preview shows the amounts', () => {
  const c = co();
  const DOM = (vals) => { c.D = vals; vm.runInContext(`DOM = {}; Object.keys(D).forEach(function(k){ DOM[k] = {value:D[k], checked:false}; });`, c); };
  // the first time, the start quarter is the earliest open quarter (answer 3: from 2026 Q3); the store base is not offered as a value
  c.STORE.karte_bonus_config = { quarter: '2026-Q4' };   // the growth chart shows Q4
  run(c, `cgBaseOpen('調理', 'G4')`);
  assert.match(c.MODAL.at(-1), /<option selected>2026-Q3<\/option><option>2026-Q4<\/option>/);
  assert.match(c.MODAL.at(-1), /id="cgf-bp"[^>]*value=""/);
  assert.match(c.MODAL.at(-1), /id="cgf-bs"[^>]*value="3"/);
  setBase(c, '調理', 'G5', 70, 3);
  run(c, `cgBaseOpen('調理', 'G5')`);
  assert.match(c.MODAL.at(-1), /<option>2026-Q3<\/option><option selected>2026-Q4<\/option>/, 'later changes start from the quarter shown');
  delete c.STORE.karte_bonus_config;
  c.curRole = 'am'; run(c, `cgBaseOpen('調理', 'G4')`); assert.match(toast(c), /GM・CEO/); c.curRole = 'gm';
  vm.runInContext(`window._cgForm = {dept:'調理', g:'G4'};`, c);
  DOM({ 'cgf-from': Q, 'cgf-bp': '70', 'cgf-bs': '3', 'cgf-why': '' });
  assert.equal(run(c, 'cgBaseSave(false)'), false);
  assert.match(toast(c), /理由/);
  DOM({ 'cgf-from': Q, 'cgf-bp': '97', 'cgf-bs': '3', 'cgf-why': '初めての設定' });
  assert.equal(run(c, 'cgBaseSave(false)'), false);
  assert.match(toast(c), /1〜96/);
  c.curRole = 'am';
  DOM({ 'cgf-from': Q, 'cgf-bp': '70', 'cgf-bs': '3', 'cgf-why': '初めての設定' });
  assert.equal(run(c, 'cgBaseSave(false)'), false);
  assert.match(toast(c), /GM・CEO/);
  c.curRole = 'gm';
  assert.equal(run(c, 'cgBaseSave(false)'), true);
  const rec = c.STORE.bonus_eval_rule['cg:調理:G4|2026-Q3'];
  assert.deepEqual([rec.set.c.b8, rec.set.c.bp8, rec.set.c.bs8, rec.set.c.bp, rec.why], [1, 70, 3, undefined, '初めての設定']);
  assert.deepEqual([seg(c, 'ray').items.c.base.bp, seg(c, 'ray').coefs.c], [70, 0.95]);
  // the preview of a change: who changes and how
  vm.runInContext(`window._cgForm = {dept:'調理', g:'G4'};`, c);
  DOM({ 'cgf-from': Q, 'cgf-bp': '68', 'cgf-bs': '3', 'cgf-why': 'x', 'cgf-prev': '' });
  run(c, 'cgBasePreview()');
  assert.match(c.DOM['cgf-prev'].innerHTML, /金額が変わる人（2026-Q3）：1（Ray Sample \$4,\d{3}→\$5,\d{3}）/);
  // clear → back to 基準未設定
  DOM({ 'cgf-from': Q, 'cgf-bp': '', 'cgf-bs': '', 'cgf-why': '見直し' });
  assert.equal(run(c, 'cgBaseSave(true)'), true);
  assert.equal(seg(c, 'ray').items.c.base.unset, true);
  // a confirmed quarter cannot be changed
  c.STORE.bonus_q[Q].locked = true;
  vm.runInContext(`window._cgForm = {dept:'調理', g:'G4'};`, c);
  DOM({ 'cgf-from': Q, 'cgf-bp': '70', 'cgf-bs': '3', 'cgf-why': 'x' });
  assert.equal(run(c, 'cgBaseSave(false)'), false);
  assert.match(toast(c), /確定しています/);
});

test('confirming keeps the career × grade, the title and the base of that time (evSnap)', () => {
  const c = co();
  setBase(c, '調理', 'G4', 70, 3);
  const snap = run(c, `(function(){ var cfg=kbCfg(), kv=kevApplies(cfg), e=EMPS.find(function(x){ return x.id==='ray'; }), b=kevBonusForEmp(e, cfg, kv); return kevSnapSeg(b.segs[0]); })()`);
  assert.deepEqual(snap.items.c.base.cg, { dept: '調理', g: 'G4', prefix: 'cg:調理:G4', from: Q });
  assert.deepEqual([snap.items.c.base.bp, snap.items.c.base.bs, snap.items.c.base.title, snap.items.c.base.unset], [70, 3, 'Head Chef', false]);
  const h = run(c, `kevSnapCareerHtml3(${JSON.stringify(snap.items.c)}, {q:'${Q}'}, 'G4')`);
  assert.match(h, /参照している基準：専門職（調理 × G4）/);
  assert.match(h, /Head Chef/);
});

test('settings ②: the specialist table is the same record as Score管理 (rows with titles or people, state, buttons)', () => {
  const c = co();
  setBase(c, '経理', 'G4', 70, 3);
  const h = run(c, `cgSettingsTableHtml('${Q}', true)`);
  assert.match(h, /Career Score › Score管理 と同じ記録/);
  assert.match(h, /<badge>G2<\/badge> 経理<\/td><td[^>]*>事務Crew Leader<\/td>/);
  assert.match(h, /<badge>G4<\/badge> 経理<\/td><td[^>]*>Accountant・Accounting Manager<\/td><td[^>]*>1<\/td><td[^>]*>96<\/td><td[^>]*><b>70<\/b>/);
  assert.match(h, /<badge>G4<\/badge> 調理<\/td><td[^>]*>Head Chef<\/td>.*?基準未設定/);
  assert.match(h, /cgBaseOpen\(&quot;経理&quot;,&quot;G4&quot;\)/);
  assert.match(fnSrc('kevCsBaseCardHtml'), /cgSettingsTableHtml\(q/);
});

test('Score管理: career → grade → titles, people, base, items and permissions (one view, no duplicate management)', () => {
  const c = co();
  vm.runInContext(`function renderScoreMgmtGeneral(){ return '<general>'; } function navItemById(p){ return {label:p}; }`, c);
  let h = run(c, 'renderScoreMgmt()');
  assert.match(h, /<general>/, 'the store track overview is kept');
  assert.match(h, /専門職キャリア × グレード/);
  vm.runInContext(`window._smSel = {c:'経理', g:'G3'};`, c);
  h = run(c, 'renderScoreMgmt()');
  for (const re of [/aria-selected="true"[^>]*><b[^>]*>経理<\/b>/, /② グレード/, /<b style="font-size:15px">Accounting Leader<\/b>/, /この組み合わせの人：1 人（Lea Sample）/,
    /基準未設定/, /通常 G3 の基準点では代わりに計算しません/, /基準点を設定する/, /この専門職 × グレードで期待すること/, /正確性/, /csgOpen\(&quot;A&quot;,null,&quot;経理&quot;,&quot;G3&quot;\)/,
    /\(2\) この人の Career Score/, /今の決まり：AM 以上/, /権限を設定する/]) assert.match(h, re);
  // AM sees it read-only (no setting buttons)
  c.curRole = 'am'; vm.runInContext(`curRealRole = 'am';`, c);
  h = run(c, 'renderScoreMgmt()');
  assert.doesNotMatch(h, /基準点を設定する|権限を設定する/);
  // the grade chips show the state per grade
  c.curRole = 'gm'; vm.runInContext(`curRealRole = 'gm';`, c);
  setBase(c, '経理', 'G4', 70, 3);
  h = run(c, 'renderScoreMgmt()');
  assert.match(h, /<b style="font-size:14px">G4<\/b><span[^>]*>設定済み<\/span>/);
  assert.match(h, /<b style="font-size:14px">G5<\/b><span[^>]*>肩書きなし<\/span>/);
});

test('7(1). the default role: the career × grade setting → the title default (current rule) → nothing (new titles do not change the role)', () => {
  const c = co();
  assert.deepEqual(run(c, `titleRoleDefault('Accounting Leader')`), { role: '', src: 'none', dept: '経理', g: 'G3' });
  assert.deepEqual(run(c, `titleRoleDefault('Head Chef')`), { role: 'sl', src: 'title', dept: '調理', g: 'G4' });
  c.STORE.career_cfg = { '経理|G3': { role: 'office_crew', _at: 1 }, '調理|G4': { role: 'chef', _at: 1 }, '経理|G2': { role: 'gm', _at: 1 } };
  assert.deepEqual(run(c, `titleRoleDefault('Accounting Leader')`).role, 'office_crew');
  assert.deepEqual(run(c, `titleRoleDefault('Head Chef')`), { role: 'chef', src: 'career', dept: '調理', g: 'G4' });
  assert.equal(run(c, `titleRoleDefault('Office Crew Leader')`).role, '', 'GM / CEO can never be a default role');
  // the employee form: picking the title fixes the career, previews the display and applies only a set default role
  const el = (v, extra = {}) => Object.assign({ value: v, disabled: false, innerHTML: '', attrs: {}, getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }, setAttribute(k, x) { this.attrs[k] = String(x); }, removeAttribute(k) { delete this.attrs[k]; } }, extra);
  c.F = { 'e-title': el('Office Crew Leader'), 'e-career': el(''), 'e-career-note': el(''), 'e-title-preview': el(''), 'e-role': el('crew'), 'e-role-note': el('') };
  c.STORE.career_cfg = {};
  vm.runInContext(`DOM = F; function empRoleChanged(){}`, c);
  run(c, 'cgEmpFormSync(true)');
  assert.deepEqual([c.F['e-career'].value, c.F['e-career'].disabled, c.F['e-role'].value], ['経理', true, 'crew']);
  assert.match(c.F['e-title-preview'].innerHTML, /<badge>G2<\/badge> <b>事務Crew Leader<\/b> <span[^>]*>経理<\/span>/);
  assert.match(c.F['e-role-note'].innerHTML, /経理 × G2 の権限がまだ設定されていません.*権限ロールは変えていません/);
  c.F['e-title'].value = 'Server Leader';
  run(c, 'cgEmpFormSync(true)');
  assert.deepEqual([c.F['e-career'].value, c.F['e-career'].disabled, c.F['e-role'].value], ['', false, 'sl'], 'a store title frees the career and keeps the current title default');
  c.STORE.career_cfg = { '経理|G2': { role: 'office_crew', _at: 1 } };
  c.F['e-title'].value = 'Office Crew Leader';
  run(c, 'cgEmpFormSync(true)');
  assert.equal(c.F['e-role'].value, 'office_crew');
  assert.match(c.F['e-role-note'].innerHTML, /経理 × G2 の既定の権限ロール/);
});

test('changing the career on save: asked first (consequences listed); the title career clears the free career field; same career → no question', () => {
  const c = co();
  vm.runInContext(`var ASKED = []; confirm = function(m){ ASKED.push(m); return CONFIRM; };`, c);
  c.CONFIRM = false;
  const r1 = run(c, `cgEmpBeforeSave('ray', {title:'Accountant', career:'経理'})`);
  assert.deepEqual(r1, { ok: false, career: '' });
  assert.match(c.ASKED.at(-1), /調理 → 経理/);
  assert.match(c.ASKED.at(-1), /確定した評価・賞与：当時のキャリア・肩書き・基準点のまま/);
  assert.match(c.ASKED.at(-1), /経理 × G4 は基準未設定/);
  c.CONFIRM = true;
  assert.deepEqual(run(c, `cgEmpBeforeSave('ray', {title:'Accountant', career:'経理'})`), { ok: true, career: '' });
  const n = c.ASKED.length;
  assert.deepEqual(run(c, `cgEmpBeforeSave('ray', {title:'Corporate Chef', career:'調理'})`), { ok: true, career: '' });
  assert.equal(c.ASKED.length, n, 'same career (調理): no question');
  assert.deepEqual(run(c, `cgEmpBeforeSave('mia', {title:'Store Manager', career:'マーケ'})`), { ok: true, career: 'マーケ' });
  assert.match(c.ASKED.at(-1), /なし（店舗用の評価表） → マーケ/);
  // saveEmp asks before the grade-change dialog and keeps the answer for its second pass
  const se = fnSrc('saveEmp');
  assert.ok(se.indexOf('cgEmpBeforeSave') > 0 && se.indexOf('cgEmpBeforeSave') < se.indexOf('ghBeforeSaveEmp(empId, data)'));
});

test('7(2). Career Score permissions per career × grade: view / score / approve (GM・CEO always; not set = the current rules; scores by roles below AM need approval)', () => {
  const c = co();
  const as = (role, name = 'Zed Office') => { c.curRole = role === 'g4' ? 'am' : role; c.curUserName = name; vm.runInContext(`curRealRole = ${JSON.stringify(role)};`, c); };
  // not set: the current rules
  as('office');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`)], [false, false, false]);
  as('am');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`), run(c, `lssNeedsApproval('Oli Sample')`)], [true, true, false, false]);
  // set for 経理 × G2: view office + office_crew, score office, approve office
  c.STORE.career_cfg = { '経理|G2': { csView: ['office', 'office_crew'], csEdit: ['office'], csApprove: ['office', 'gm', 'bogus'], _at: 1 } };
  as('office');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`), run(c, `lssNeedsApproval('Oli Sample')`)], [true, true, true, true]);
  assert.deepEqual(run(c, `lssApproveRolesFor('Oli Sample')`), ['gm', 'office'], 'unknown roles and GM are not added twice');
  as('am');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`)], [false, false, false], 'the setting replaces the AM rule for this career × grade');
  as('gm', 'GM Sample');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`)], [true, true, true]);
  as('ceo', 'CEO Sample');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`)], [true, true, false], 'approval stays GM + the listed roles');
  // nobody scores or approves their own Career Score; other people are not affected
  as('office', 'Oli Sample');
  assert.deepEqual([run(c, `canEditLss('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`)], [false, false]);
  as('office');
  assert.equal(run(c, `canEditLss('Lea Sample')`), false, '経理 × G3 is not set');
  assert.equal(run(c, `lssReqByMe({by:'Zed Office'})`), true);
  // a shared store login never uses these settings
  vm.runInContext(`curStoreLogin = true;`, c);
  assert.equal(run(c, `canEditLss('Oli Sample')`), false);
  vm.runInContext(`curStoreLogin = false;`, c);
  // the leadership page gets an entry for a role that was granted something
  as('office');
  assert.equal(run(c, 'cgCsGrantForMe()'), true);
  as('office_crew');
  assert.equal(run(c, 'cgCsGrantForMe()'), true);
  as('sl');
  assert.equal(run(c, 'cgCsGrantForMe()'), false);
  // the hooks in the app use these
  assert.match(fnSrc('navChildAllowed'), /pid==='leadership' && typeof cgCsGrantForMe==='function' && cgCsGrantForMe\(\)/);
  assert.match(fnSrc('groupsForRole'), /g_cs_grant/);
  assert.match(SRC, /async function openLssDetail\(name\) \{[\s\S]{0,500}canViewLssOf\(name\)/);
  assert.match(fnSrc('renderLeadership'), /canViewLssOfEmp\(e\)/);
  assert.match(fnSrc('approveLssScoreRequest'), /lssCanApproveScoreFor\(r\.name\)/);
  assert.match(fnSrc('rejectLssScoreRequest'), /lssCanApproveScoreFor\(r\.name\)/);
  assert.match(fnSrc('lssScoreApprovalCardHtml'), /lssCanApproveScoreFor\(r\.name\)/);
  assert.match(SRC, /toRoles:\(\(typeof lssApproveRolesFor==='function'\) \? lssApproveRolesFor\(name\) : \['gm'\]\)/);
});

test('7(1). hidden pages per career × grade: added to the grade rule, never My Page, never for GM・CEO or a store login', () => {
  const c = co();
  c.STORE.career_cfg = { '経理|G3': { hide: ['budget', 'mypage', 'staff_master'], _at: 1 } };
  c.curUserName = 'Lea Sample'; vm.runInContext(`curRealRole = 'office_crew';`, c); c.curRole = 'office_crew';
  assert.deepEqual(run(c, 'cgHideForMe()'), ['budget', 'staff_master']);
  vm.runInContext(`curRealRole = 'gm';`, c); c.curRole = 'gm';
  assert.deepEqual(run(c, 'cgHideForMe()'), []);
  vm.runInContext(`curRealRole = 'office_crew'; curStoreLogin = true;`, c); c.curRole = 'office_crew';
  assert.deepEqual(run(c, 'cgHideForMe()'), []);
  vm.runInContext(`curStoreLogin = false;`, c);
  c.curUserName = 'Oli Sample';
  assert.deepEqual(run(c, 'cgHideForMe()'), [], '経理 × G2 has nothing set');
  assert.match(fnSrc('isPageHiddenForMe'), /cgHideForMe\(\)\.indexOf\(pid\)>=0/);
  assert.match(fnSrc('groupsForRole'), /cgHideForMe\(\)/);
});

test('saving permissions: the record per career × grade (role, hidden pages, lists or "current rule"); a change on another device is not overwritten', () => {
  const c = co();
  const box = (checked) => ({ checked, value: '' });
  vm.runInContext(`window._cgPerm = {dept:'経理', g:'G3', at0:0};`, c);
  c.F = { 'cgp-role': { value: 'office_crew' }, 'cgp-why': { value: '経理の担当' }, 'cgp-h-budget': box(true), 'cgp-h-staff_master': box(false),
    '@cgp-csView-m': { value: 'set' }, 'cgp-csView-office': box(true), 'cgp-csView-am': box(false),
    '@cgp-csEdit-m': { value: 'cur' }, 'cgp-csEdit-office': box(true),
    '@cgp-csApprove-m': { value: 'set' } };
  vm.runInContext(`DOM = F; function cgPermPages(){ return ['budget','staff_master','mypage']; } function buildNav(){} function navItemById(p){ return {label:p}; }`, c);
  assert.equal(run(c, 'cgPermSave()'), true);
  const r = J(c.STORE.career_cfg['経理|G3']);
  assert.deepEqual([r.role, r.hide, r.csView, r.csEdit, r.csApprove, r.why], ['office_crew', ['budget'], ['office'], null, [], '経理の担当']);
  // GM・CEO only
  c.curRole = 'am';
  assert.equal(run(c, 'cgPermSave()'), false);
  c.curRole = 'gm';
  // the record changed on another device after the form opened → not saved
  vm.runInContext(`window._cgPerm = {dept:'経理', g:'G3', at0:1};`, c);
  assert.equal(run(c, 'cgPermSave()'), false);
  assert.match(toast(c), /ほかの端末で先に変えられていました/);
  // synced: one merge rule per career × grade, never freed by the storage cleanup
  assert.match(SRC, /career_cfg:\s+\{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(SRC, /'cs_guide','career_cfg','reimbursements'/);
  assert.match(SRC, /'cs_guide','career_cfg',/);
});

test('the expectation text is one cs_guide record per career × grade and language (edited only by GM・CEO)', () => {
  const c = co();
  assert.deepEqual(run(c, `csgDefOf('cg|経理|G3')`), {});
  assert.equal(run(c, `csgDefOf('cg|経理|G6')`), null);
  assert.equal(run(c, `csgDefOf('cg|nope|G3')`), null);
  assert.deepEqual(run(c, `csgDefOf('cg|office|G4')`), {});
  vm.runInContext(`DOM = { 'csg-what': { value:'  月次締めを期限どおりに回す  ' } };`, c);
  assert.deepEqual(run(c, `csgReadForm('cg|経理|G3', 'ja')`), { what: '月次締めを期限どおりに回す' });
  assert.match(fnSrc('csgEdit'), /isCg/);
});

test('display: one helper for "G4 Head Chef 調理" on the lists, profile, Career Score, growth chart and bonus screens', () => {
  for (const name of ['renderStaffMaster', 'kevTabHtml', 'kevListTableHtml', 'renderLeadership']) assert.match(fnSrc(name), /empTitleHtml/, name);
  assert.match(fnSrc('renderGradeHideConfig'), /jobTitleLabel/);
  assert.ok((SRC.match(/empTitleHtml\(/g) || []).length >= 9);
  assert.match(fnSrc('csvGradeHtml'), /empTitleLabel/);
  // the title select is grouped by career with the grade (Store Leader only for someone who still has it)
  const c = co();
  const h = run(c, `cgTitleOptsHtml('Office Manager')`);
  assert.match(h, /<optgroup label="経理"><option value="Office Crew Leader">事務Crew Leader（G2 · 経理）<\/option><option value="Accounting Leader">Accounting Leader（G3 · 経理）<\/option><option value="Accountant">Accountant（G4 · 経理）<\/option><option value="Office Manager" selected>Accounting Manager（G4 · 経理）<\/option><\/optgroup>/);
  assert.doesNotMatch(h, /Store Leader/);
  assert.match(run(c, `cgTitleOptsHtml('Store Leader')`), /Store Leader・廃止/);
});

test('the individual evaluation ① card names the base it uses (専門職 × グレード / オフィス用 / 通常) and links to Score管理', () => {
  const s = fnSrc('kevCareerCardHtml3');
  assert.match(s, /参照している基準：/);
  assert.match(s, /'専門職（'\+cgComboName\(B\.cg\.dept, B\.cg\.g\)\+'）'/);
  assert.match(s, /'通常（'\+kevScopeLabel\(scope\)\+'）'/);
  assert.match(s, /cgGoScoreMgmt/);
  const c = co();
  vm.runInContext(`function kevItemHead(){ return ''; } function kevCsLadderHtml(){ return ''; } function kevCsCatTableHtml(){ return ''; } function kevMissHtml(){ return ''; } function kevOldEvHtml(){ return ''; } function ghMD(d){ return d; }`, c);
  const h = run(c, `(function(){ var cfg=kbCfg(), kv=kevApplies(cfg), e=EMPS.find(function(x){ return x.id==='ray'; }), b=kevBonusForEmp(e, cfg, kv), x=b.segs[0], I={sc:{key:x.key, g:x.g}, src:x.src}; return kevCareerCardHtml3(e, x.items.c, I, kv); })()`);
  assert.match(h, /参照している基準：専門職（調理 × G4）・基準未設定/);
  assert.match(h, /調理 × G4 の基準点が未設定。通常 G4 の基準点では計算しません/);
});

test('independent review P2-1: an approver below GM is recorded by their own name (GM as before)', () => {
  const c = co();
  vm.runInContext(`ROLE_CONFIG.g4 = {label:'G4', name:'Store Manager'}; ROLE_CONFIG.am.name = 'AM Default'; ROLE_CONFIG.office.name = 'Office Default';`, c);
  const as = (role, name) => { c.curRole = role === 'g4' ? 'am' : role; c.curUserName = name; vm.runInContext(`curRealRole = ${JSON.stringify(role)};`, c); };
  as('g4', 'Gina Manager'); assert.equal(run(c, 'lssApproverName()'), 'Gina Manager');
  as('office', 'Zed Office'); assert.equal(run(c, 'lssApproverName()'), 'Zed Office');
  as('gm', 'GM Sample'); assert.equal(run(c, 'lssApproverName()'), 'GM', 'GM keeps the name recorded before v1102');
  for (const f of ['approveLssScoreRequest', 'rejectLssScoreRequest']) assert.match(fnSrc(f), /var me = \(typeof lssApproverName==='function'\) \? lssApproverName\(\)/, f);
});

test('independent review P2-2: a 2026 Q3+ quarter confirmed by a v1101 device (no cg mark) with a specialist is named; v1102 confirmations carry the mark', () => {
  const c = co();
  const snap = { gen: 3, people: { ray: { name: 'Ray Sample', segs: [{ items: { c: { base: { sheet: 'spec', bp: 72 } } } }] }, mia: { name: 'Mia Sample', segs: [{ items: { c: { base: { sheet: 'store', bp: 315 } } } }] } } };
  assert.deepEqual(run(c, `cgOldSnapNames(${JSON.stringify(snap)})`), ['Ray Sample']);
  assert.deepEqual(run(c, `cgOldSnapNames(${JSON.stringify(Object.assign({}, snap, { cg: 1 }))})`), []);
  assert.deepEqual(run(c, `cgOldSnapNames(${JSON.stringify(Object.assign({}, snap, { gen: 2 }))})`), []);
  assert.match(SRC, /d\.evSnap\.gen=3; d\.evSnap\.start3=KEV3_START;[^\n]*\n    d\.evSnap\.cg=1;/);
  assert.match(SRC, /cgOldSnapNames\(_kvq\.snap\)/);
});

test('independent review P3-3・P3-4: the unset list follows the segments (a store period before becoming a specialist) and skips ① fixed at 1.00', () => {
  const c = co();
  c.STORE.bonus_eval_ovr['ray|2026-Q3'].set.c = { on: false, g2: 1 };
  let M = run(c, `kevMisfits3('${Q}')`);
  assert.ok(!M.block.some(x => /Ray Sample/.test(x.t)), 'Ray computes at 1.00: not listed');
  assert.equal(person(c, 'ray').blocked, null);
  // Neo: Kitchen Leader (store G3) until 8/15, Head Chef from 8/16 → the G3 period is judged on 調理 × G3
  const n = c.EMPS.find(e => e.id === 'neo'); n.title = 'Head Chef'; n.g = 'G4';
  c.SEGS.neo = [{ g: 'G3', from: '2026-07-01', to: '2026-08-15', days: 46 }, { g: 'G4', from: '2026-08-16', to: '2026-09-30', days: 46 }];
  setBase(c, '調理', 'G4', 60, 3);
  M = run(c, `kevMisfits3('${Q}')`);
  const hit = M.block.find(x => /調理 × G3 の基準点が未設定/.test(x.t));
  assert.ok(hit && /Neo Sample/.test(hit.t) && /cgBaseOpen\(&quot;調理&quot;,&quot;G3&quot;\)/.test(hit.act), JSON.stringify(M.block));
});

test('independent review P3-5: an accountant on the office sheet takes permissions and expectations from 経理 × G#, and the base from オフィス用 × G#', () => {
  const c = co();
  c.OCS['Max Sample'] = true;
  assert.deepEqual([run(c, `cgOf(EMPS.find(function(e){ return e.id==='max'; })).key`), run(c, `cgPermOf(EMPS.find(function(e){ return e.id==='max'; })).key`)], ['office|G4', '経理|G4']);
  c.STORE.career_cfg = { '経理|G4': { csEdit: ['office_crew'], hide: ['budget'], _at: 1 }, 'office|G4': { csEdit: ['sl'], _at: 1 } };
  c.curRole = 'office_crew'; c.curUserName = 'Zed'; vm.runInContext(`curRealRole = 'office_crew';`, c);
  assert.equal(run(c, `canEditLss('Max Sample')`), true);
  c.curUserName = 'Max Sample';
  assert.deepEqual(run(c, 'cgHideForMe()'), ['budget']);
  // Score管理 lists Max in both rows: 経理 × G4 (permissions) and オフィス用 × G4 (base); the office row has no permission card
  vm.runInContext(`curRealRole = 'gm'; function navItemById(p){ return {label:p}; }`, c); c.curRole = 'gm'; c.curUserName = 'GM Sample';
  assert.deepEqual(run(c, `cgPeople('経理', 'G4').map(function(e){ return e.name; })`), ['Max Sample']);
  assert.deepEqual(run(c, `cgPeople('office', 'G4').map(function(e){ return e.name; })`), ['Max Sample']);
  vm.runInContext(`window._smSel = {c:'経理', g:'G4'};`, c);
  assert.match(run(c, 'renderScoreMgmt()'), /オフィス用 Career Score で評価している人（Max Sample）の基準点は「オフィス用 × G4」の行/);
  vm.runInContext(`window._smSel = {c:'office', g:'G4'};`, c);
  const h = run(c, 'renderScoreMgmt()');
  assert.doesNotMatch(h, /権限を設定する/);
  assert.match(h, /肩書きの専門職（経理など）の行で決めます/);
});

test('independent review P3-6・P3-7: a role granted to score or approve can also view; the extra menu entry is not added to a page the grade rule hides', () => {
  const c = co();
  c.STORE.career_cfg = { '経理|G2': { csApprove: ['office'], _at: 1 } };
  c.curRole = 'office'; c.curUserName = 'Zed'; vm.runInContext(`curRealRole = 'office';`, c);
  assert.deepEqual([run(c, `canViewLssOf('Oli Sample')`), run(c, `lssCanApproveScoreFor('Oli Sample')`), run(c, `canEditLss('Oli Sample')`)], [true, true, false]);
  c.STORE.career_cfg = { '経理|G2': { csEdit: ['office'], _at: 1 } };
  assert.deepEqual([run(c, `canViewLssOf('Oli Sample')`), run(c, `canEditLss('Oli Sample')`)], [true, true]);
  assert.match(fnSrc('groupsForRole'), /!\(typeof isPageHiddenForMe==='function' && isPageHiddenForMe\('leadership'\)\)/);
  assert.match(fnSrc('renderLeadership'), /cgCsGranted\(e\)/);
});
