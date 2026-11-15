// v1169（Moto さん 11/14・急ぎ）：G1・G2 の画面には「Tip Rate の変更履歴」を出さない（現場の重点 KPI は kpi-settings-v1153 の試験）。
// 本物の renderTipRate・isFloorG1G2（index.html）を VM で動かす。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(SRC);
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
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const run = (c, code) => vm.runInContext(code, c);

const EMPS = [
  { name: 'Dee', title: 'Office Crew', role: 'office_crew', store: 'ALL' },
  { name: 'Ann', title: 'Crew', role: 'crew', store: 'F01' },
  { name: 'Ben', title: 'Crew Leader', role: 'sl', store: 'F01' },
  { name: 'Cal', title: 'Operation Leader', role: 'sl', store: 'F01' },
  { name: 'Yuki', title: 'Area Manager', role: 'am', store: 'F01' },
];
// 決まった Tip Rate の記録（ほかの人の率と前後が入っている）
const REQS = [
  { id: 'a', name: 'Ann', rate: 90, prevRate: 80, status: '承認', approver: 'Moto', decAt: 1, approvedDate: '2026/11/01', basis: 'manual', store: 'F01' },
  { id: 'b', name: 'Zed', rate: 100, prevRate: 90, status: '承認', approver: 'Moto', decAt: 2, approvedDate: '2026/11/02', basis: 'manual', store: 'F01' },
];

function device(o) {
  const c = { console: { log() {}, warn() {}, error() {} }, EMPS, REQS, ROLE: o.role, REAL: o.realRole || null, USER: o.user, SLOGIN: !!o.storeLogin };
  vm.createContext(c);
  run(c, [between('const ROLE_CONFIG = {', '\n};').replace('const ', 'var '), between('var GRADE_TITLES = {', '\n};'),
    ...['gradeOf', 'gradeNum', 'empGrade', 'isFloorG1G2', 'renderTipRate'].map(fnSrc)].join('\n') + `
    var curLang = 'ja', curRole = ROLE, curRealRole = REAL, curUserName = USER, curStoreLogin = SLOGIN, curStore = 'F01';
    var STORES = [{ id:'F01', name:'ToriTon' }], TIP_OPTIONS = [80,90,100];
    function t(ja){ return ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
    function ls(k, d){ return k==='tip_requests' ? JSON.parse(JSON.stringify(REQS)) : d; }
    function getEmployees(){ return EMPS; } function myName(){ return curUserName; }
    function getTipPolicy(){ return 'policy'; } function effectiveTipRate(){ return 90; } function tipRateColor(){ return '#000'; }
    function checkLevelUpEligibility(){ return { maxed:true }; } function skillScoreStore(){ return { total:10, lv3:2 }; }
    function isTipEligibleRole(){ return true; } function isThreeMonths(){ return false; } function firstWorkDate(){ return null; } function langDateLocale(){ return 'ja'; }
    function _tipDecT(r){ return Number(r.decAt)||0; } function tipReplacedBy(){ return null; } function _tipFromOk(){ return false; }
    function tipDayLabel(d){ return d; } function _tipDecDayRaw(){ return ''; }
  `);
  return c;
}

test('G1・G2 and the store tablet do not see the Tip Rate history; G3, AM and GM still do', () => {
  const cases = [
    ['G1 crew', { role: 'crew', user: 'Ann' }, false],
    ['G2 (g2 aliased to sl)', { role: 'sl', realRole: 'g2', user: 'Ben' }, false],
    ['G2 by title with the sl role', { role: 'sl', user: 'Ben' }, false],
    ['G2 login whose name is not in the employee master', { role: 'sl', realRole: 'g2', user: 'Gus' }, false],
    ['the store tablet (store PIN)', { role: 'sl', user: 'ToriTon', storeLogin: true }, false],
    ['G3 by title', { role: 'sl', user: 'Cal' }, true],
    ['AM', { role: 'am', user: 'Yuki' }, true],
    ['GM', { role: 'gm', user: 'Moto' }, true],
  ];
  for (const [name, o, shown] of cases) {
    const html = run(device(o), 'renderTipRate()');
    assert.equal(html.includes('Tip Rate 変更履歴'), shown, name);
    assert.equal(html.includes('Zed'), shown, name + ': other people\'s rates');
    assert.ok(html.includes('Tip Rate Policy'), name + ': the rest of the page stays');
    if (o.role === 'crew' || o.role === 'sl') assert.ok(html.includes('あなたのTip Rate'), name + ': own rate stays');
  }
});

test('the helper: managers are never hidden; unknown people with the sl role are not hidden; an error hides', () => {
  for (const [role, real, user, want] of [['ceo', null, 'Tac', false], ['office', null, 'Marcia', false], ['chef', null, 'X', false], ['am', 'g4', 'Eve', false],
    ['office_crew', null, 'Dee', true], ['sl', null, 'Nobody', false],
    ['office', null, 'Dee', false]]   /* 経理のログインなら、従業員マスターの肩書きが G1 でも隠さない */) {
    assert.equal(run(device({ role, realRole: real, user }), 'isFloorG1G2()'), want, role + ' ' + user);
  }
  const c = device({ role: 'sl', user: 'Cal' });
  run(c, `getEmployees = function(){ throw new Error('x'); };`);
  assert.equal(run(c, 'isFloorG1G2()'), true);
});

test('release markers', () => {
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  assert.ok(+v >= 1169, v);
  assert.equal(/const SW_BUILD = '(\d+)'/.exec(SW)[1], v);
});
