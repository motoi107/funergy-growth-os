// v1119（Moto さん 2026-10-30 の依頼 ⑤・回答「今日から」）：HR 福利厚生の対象は、従業員マスターのグレードで G3〜G6。
// その日のグレード（グレードの履歴の適用日から）で決め、役職名（専門職の肩書き）や権限の役割では決めない。
// G2 は 2026-10-30 から対象外（それより前の日は前の決まり）。グレードが無い人は対象外で「設定が必要」。前の記録は消さない。
// index.html の本物の関数を VM で動かす（合成データ・架空の名前）。FUNERGY_INDEX=<path> で別の版にも流せる（v1118 は落ちる）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
// A top-level function ends at the first line that is only "}" (the brace scanner above trips on some long template strings)
function topFn(name) { const i = SRC.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); if (i < 0) throw new Error('not found: ' + name); return SRC.slice(i, SRC.indexOf('\n}\n', i) + 2); }
function anyFn(name) { try { const t = fnSrc(name); new Function(t); return t; } catch (e) { return topFn(name); } }
function blockSrc(start) { const i = SRC.indexOf(start); if (i < 0) throw new Error('not found: ' + start); let d = 0, j = SRC.indexOf('{', i); for (; j < SRC.length; j++) { if (SRC[j] === '{' || SRC[j] === '[') d++; else if (SRC[j] === '}' || SRC[j] === ']') { d--; if (d === 0) break; } } return SRC.slice(i, SRC.indexOf(';', j) + 1); }

const FNS = ['ghNormG', 'ghDate', 'ghT', 'ghAdd', 'ghDays', 'ghHire', 'ghResign', 'ghAll', 'ghCmp', 'ghRecs', 'ghTimeline', 'ghSegments', 'gradeOf', 'gradeNum', 'empGrade',
  'benefitByType', 'benefitMinGradeOn', 'benefitGradeOn', 'benefitElig', 'vacationDays', 'getBenefitAdjust', 'benefitAdjust', 'getBenefitManual', 'benefitManualUsed',
  'benefitUsed', 'renderHR', 'openVacationModal', 'submitVacation', 'shortBenefitLabel', 'openBenefitManualModal'];
const STORES = [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }];
function app({ emps = [], gh = {}, vac = [], today = '2026-10-30', role = 'gm', user = 'Synthetic GM', st = {} } = {}) {
  const S = Object.assign({ grade_hist: gh, my_vacations: vac }, JSON.parse(JSON.stringify(st)));
  const c = {
    S, STORES, curRole: role, curRealRole: role, curUserName: user, curStore: 'ALL', curLang: 'ja', ROLE_CONFIG: { gm: { name: 'Synthetic GM' } },
    ls: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), lsSet: (k, v) => { S[k] = JSON.parse(JSON.stringify(v)); return true; },
    getEmployees: () => emps, getKarte: () => ({}), getVacations: () => S.my_vacations, saveVacations: v => { S.my_vacations = v; },
    ghToday: () => today, bizToday: () => today, todayJP: () => today, myName: () => user, nowJP: () => '2026/10/30 09:00',
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    getVisibleStores: () => STORES, _curEmp: () => emps.find(e => e.name === user) || null, alerts: [], modals: [], toasts: [],
    alert: m => c.alerts.push(m), openModal: h => c.modals.push(h), closeModalDirect: () => {}, showToast: m => c.toasts.push(m), renderPage: () => {},
    addApproval: () => {}, vacBreakdownPreview: () => {}, inputs: {},
    document: { getElementById: id => (id in c.inputs ? { value: c.inputs[id] } : null), querySelectorAll: () => Object.keys(c.inputs).filter(k => k.startsWith('v-bd-')).map(k => ({ id: k, value: c.inputs[k] })) },
  };
  vm.createContext(c);
  vm.runInContext([blockSrc('var GRADE_TITLES = {'), blockSrc('const BENEFITS = ['), "var BENEFIT_G3_FROM = '2026-10-30'; var _hrYear = 2026;"].concat(FNS.map(anyFn)).join('\n'), c);
  return c;
}
const run = (c, e) => vm.runInContext(e, c);
const J = v => JSON.parse(JSON.stringify(v));
const E = (id, name, title, o) => Object.assign({ id, name, title, store: 'F01', status: '在籍' }, o || {});

test('eligibility: G3〜G6 by the employee master grade; G1・G2 not; no grade is flagged; the role (permission) does not count', () => {
  const emps = [E('a', 'Ann', 'Server Leader'), E('b', 'Ben', 'Crew Leader'), E('c', 'Cy', 'Crew'), E('d', 'Dee', 'General Manager'),
    E('h', 'Hal', 'Head Chef'), E('k', 'Kim', 'Accounting Leader'), E('p', 'Pat', 'Prep'), E('x', 'Xu', 'Mystery Title'), E('r', 'Rae', '', { role: 'sl' })];
  const c = app({ emps });
  const el = id => J(run(c, 'benefitElig(getEmployees().find(function(e){return e.id==="' + id + '";}), "2026-10-30")'));
  for (const id of ['a', 'd', 'h', 'k', 'r']) assert.equal(el(id).ok, true, id);
  for (const id of ['b', 'c', 'p']) assert.equal(el(id).ok, false, id);
  assert.equal(el('b').g, 'G2'); assert.match(el('b').why, /G3 未満/);
  assert.equal(el('h').g, 'G4', 'a specialist title is read as its grade'); assert.equal(el('k').g, 'G3');
  assert.equal(el('x').missing, true); assert.match(el('x').why, /グレード未設定/);
  assert.equal(J(run(c, 'benefitElig(null, "2026-10-30")')).missing, true);
});

test('G2 was eligible before 2026-10-30 and is not from that day (past records keep the old rule)', () => {
  const c = app({ emps: [E('b', 'Ben', 'Crew Leader')] });
  assert.equal(run(c, 'benefitElig(getEmployees()[0], "2026-10-29").ok'), true);
  assert.equal(run(c, 'benefitElig(getEmployees()[0], "2026-10-30").ok'), false);
  assert.equal(run(c, 'benefitMinGradeOn("2026-10-29") + "," + benefitMinGradeOn("2026-10-30")'), '2,3');
});

test('promotion and demotion count from their effective dates (grade history), not from the current title', () => {
  // Promoted G2 → G3: decided 11/04, effective 11/05. Demoted G3 → G2: decided 10/20, effective 10/21.
  const emps = [E('u', 'Uma', 'Server Leader'), E('w', 'Wes', 'Crew Leader')];
  const gh = { u: { recs: [{ id: 'r1', d: '2026-11-04', g: 'G3', from: 'G2' }] }, w: { recs: [{ id: 'r2', d: '2026-10-20', g: 'G2', from: 'G3' }] } };
  const c = app({ emps, gh });
  const ok = (id, d) => run(c, 'benefitElig(getEmployees().find(function(e){return e.id==="' + id + '";}), "' + d + '").ok');
  assert.equal(ok('u', '2026-11-04'), false, 'still G2 on the day it was decided');
  assert.equal(ok('u', '2026-11-05'), true);
  assert.match(J(run(c, 'benefitElig(getEmployees()[0], "2026-11-01")')).why, /グレードの履歴（今の役職は G3）/);
  assert.equal(ok('w', '2026-10-20'), true, 'G3 until the demotion takes effect (and before the G2 cutover)');
  assert.equal(ok('w', '2026-10-30'), false);
});

test('HR list: only today\'s G3〜G6 with store, role, grade and reason; no grade and former records are listed apart; same list on any device', () => {
  const emps = [E('a', 'Ann', 'Server Leader'), E('b', 'Ben', 'Crew Leader', { store: 'F02' }), E('c', 'Cy', 'Crew'), E('x', 'Xu', 'Mystery Title'),
    E('q', 'Quit', 'Store Manager', { status: '退職' })];
  const vac = [{ id: 'v1', employee: 'Ben', type: '有給2', breakdown: { '有給休暇': 2 }, startDate: '2026-06-01', endDate: '2026-06-02', status: '承認' }];
  const html = run(app({ emps, vac }), 'renderHR()');
  const main = html.slice(html.indexOf('消化状況'), html.indexOf('グレードが未設定'));
  assert.match(main, /消化状況 — G3以上 1名/);
  assert.match(main, /<td style="font-size:12px">Ann<\/td><td style="font-size:11px">Store One<\/td><td style="font-size:11px">Server Leader<\/td>/);
  assert.match(main, /G3（G3 以上）/);
  assert.doesNotMatch(main, />Ben</); assert.doesNotMatch(main, />Cy</); assert.doesNotMatch(main, />Quit</);
  assert.match(html, /グレードが未設定（対象外・設定が必要）1名[\s\S]*Xu · Store One · Mystery Title/);
  const former = html.slice(html.indexOf('今は対象外'));
  assert.match(former, /今は対象外・2026年の記録あり 1名/); assert.match(former, />Ben</); assert.match(former, /G2（G3 未満）/);
  assert.doesNotMatch(former, />Cy</, 'no records: not listed');
  assert.equal(run(app({ emps, vac }), 'renderHR()'), html, 'the same data gives the same list');
  assert.match(run(app({ emps, role: 'am' }), 'renderHR()'), /経理・GM・CEOのみ/, 'who can see the page is unchanged');
});

test('application: benefit types only for G3〜G6 by the master grade; a G2 with a manager role cannot apply for paid leave; dated by the start day', () => {
  const emps = [E('b', 'Ben', 'Crew Leader'), E('a', 'Ann', 'Server Leader')];
  const g2 = app({ emps, user: 'Ben', role: 'sl' });   // role sl used to lift the grade to 3 (myGradeNum)
  run(g2, 'openVacationModal()');
  assert.doesNotMatch(g2.modals[0], /v-bd-有給休暇/); assert.match(g2.modals[0], /v-bd-公休/); assert.match(g2.modals[0], /あなた：G2（G3 未満）/);
  Object.assign(g2.inputs, { 'v-start': '2026-11-02', 'v-end': '2026-11-02', 'v-reason': '', 'v-bd-有給休暇': '1' });
  run(g2, 'submitVacation()');
  assert.match(g2.alerts[0], /G3〜G6/); assert.equal(g2.S.my_vacations.length, 0, 'nothing saved');
  Object.assign(g2.inputs, { 'v-bd-有給休暇': '', 'v-bd-公休': '1' }); delete g2.inputs['v-bd-有給休暇'];
  run(g2, 'submitVacation()');
  assert.equal(g2.S.my_vacations.length, 1, 'a day off without a benefit type is fine');
  const g3 = app({ emps, user: 'Ann' });
  run(g3, 'openVacationModal()');
  assert.match(g3.modals[0], /v-bd-有給休暇/);
  Object.assign(g3.inputs, { 'v-start': '2026-11-02', 'v-end': '2026-11-02', 'v-reason': '', 'v-bd-有給休暇': '1' });
  run(g3, 'submitVacation()');
  assert.equal(g3.alerts.length, 0); assert.equal(g3.S.my_vacations[0].breakdown['有給休暇'], 1);
});

test('the rule table says G3〜G6; release markers are 1119 or later and match', () => {
  assert.match(anyFn('renderHR'), /G3〜G6（2026\/10\/30 から。前は G2 以上）/);
  assert.doesNotMatch(anyFn('openVacationModal'), /myGradeNum\(\)/, 'the form does not use the permission-based grade');
  const v = Number((/const APP_VERSION = '(\d+)';/.exec(SRC) || [])[1]);
  assert.ok(v >= 1119, String(v)); assert.ok(SW.includes("const SW_BUILD = '" + v + "';"));
});
