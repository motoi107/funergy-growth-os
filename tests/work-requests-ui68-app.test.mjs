// v1135：G3 も Career Score・Tip Rate の変更を GM に申請できる（UI案68 の 6 ＋「G3 以上に申請権限」・Moto さん 11/03）。
// 本体（index.html）の関数をそのまま切り出して VM で動かす（合成データ）。G3 がスキル Lv を直接変えられるのは今のまま。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

const EMPS = [
  { id: 'E5', name: 'Ami Area', role: 'am', title: 'Area Manager', store: 'S1', status: '在籍' },
  { id: 'E6', name: 'Sam Store', role: 'sl', title: 'Store Manager', store: 'S1', status: '在籍' },
  { id: 'E7', name: 'Lee Leader', role: 'sl', title: 'Server Leader', store: 'S1', support: ['S3'], status: '在籍' },
  { id: 'E8', name: 'Cam Crew', role: 'crew', title: 'Crew', store: 'S1', status: '在籍' },
  { id: 'E10', name: 'Gus Crewlead', role: 'g2', title: 'Crew Leader', store: 'S1', status: '在籍' },
  { id: 'E11', name: 'Ned Leader', role: 'sl', title: 'Operation Leader', store: 'S1', status: '在籍' },
  { id: 'E12', name: 'Tia Two', role: 'g2', title: 'Crew Leader', store: 'S3', status: '在籍' },
  { id: 'E13', name: 'Bo Two', role: 'g2', title: 'Crew Leader', store: 'S2', status: '在籍' },
  { id: 'E14', name: 'Old Two', role: 'g2', title: 'Crew Leader', store: 'S1', status: '退職' },
];
const GR = { 'Area Manager': 'G5', 'Store Manager': 'G4', 'Server Leader': 'G3', 'Operation Leader': 'G3', 'Crew Leader': 'G2', Crew: 'G1' };

function load({ me = 'Lee Leader', role = 'sl', real = '', live = true } = {}) {
  const ctx = {
    curUserName: me, curRole: role, curRealRole: real, ROLE_CONFIG: { sl: { name: 'Store Leader' }, gm: { name: 'Moto' } },
    getEmployees: () => EMPS, empGrade: e => GR[e.title] || '', wrIsG3Live: () => live && role === 'sl' && GR[(EMPS.find(e => e.name === me) || {}).title] === 'G3',
    cgPermList: () => null, lssRoleRank: r => ({ crew: 1, g2: 2, sl: 3, g4: 4, am: 5, gm: 6, ceo: 7 })[r] || 0,
    cgMyRole: () => real || role, cgCsGranted: () => false, lssG4Sees: () => true, lssIsSelf: n => n === me,
    lssCanSelfRequest: n => n === me,
  };
  vm.createContext(ctx);
  for (const f of ['_lssG4CanEdit', '_lssG3CanEdit', 'canEditLss', 'canViewOthersLss', 'canViewLssOfEmp', 'lssNeedsApproval']) vm.runInContext(fnSrc(f), ctx);
  return ctx;
}
const byName = n => EMPS.find(e => e.name === n);

test('a G3 (after go-live) may score and see only G2 people of their own and support stores; not peers, G1, others or the retired', () => {
  const c = load();
  assert.equal(c.canEditLss('Gus Crewlead'), true, 'a G2 at S1');
  assert.equal(c.canEditLss('Tia Two'), true, 'a G2 at the support store S3');
  assert.equal(c.canEditLss('Bo Two'), false, 'not at S2');
  assert.equal(c.canEditLss('Ned Leader'), false, 'not another G3');
  assert.equal(c.canEditLss('Sam Store'), false, 'not the G4');
  assert.equal(c.canEditLss('Cam Crew'), false, 'Career Score starts at G2');
  assert.equal(c.canEditLss('Old Two'), false, 'not someone who left');
  assert.equal(c.canEditLss('Lee Leader'), false, 'not oneself');
  assert.equal(c.canViewLssOfEmp(byName('Gus Crewlead')), true);
  assert.equal(c.canViewLssOfEmp(byName('Ned Leader')), false, 'a G3 still does not see other G3');
  assert.equal(c.canViewLssOfEmp(byName('Lee Leader')), true, 'oneself as before');
  assert.equal(c.lssNeedsApproval('Gus Crewlead'), true, 'a G3 score always goes through the GM');
});

test('before go-live, or for a G2/G1, nothing changes (a G3 sees only themselves, as before)', () => {
  const pre = load({ live: false });
  assert.equal(pre.canEditLss('Gus Crewlead'), false);
  assert.equal(pre.canViewLssOfEmp(byName('Gus Crewlead')), false);
  const g2 = load({ me: 'Gus Crewlead', role: 'g2' });
  assert.equal(g2.canEditLss('Cam Crew'), false);
  const am = load({ me: 'Ami Area', role: 'am', real: 'am' });
  assert.equal(am.canEditLss('Gus Crewlead'), true, 'the AM as before (direct)');
  assert.equal(am.lssNeedsApproval('Gus Crewlead'), false, 'the AM still scores directly');
});

test('the screens: the Career Score list adds the G2 people for a G3; the Tip Rate screen has the ask button; the score request goes to Work Center for a G3', () => {
  const lead = fnSrc('renderLeadership');
  assert.match(lead, /_g3See = \(typeof _lssG3CanEdit==='function' && typeof wrIsG3Live==='function' && wrIsG3Live\(\)\)/);
  assert.match(lead, /\.concat\(_cgSee\)\.concat\(_g3See\)/);
  const tip = fnSrc('renderTipRate');
  assert.match(tip, /if \(!canApprove && !canEditPolicy && typeof wrCanAskLive==='function' && wrCanAskLive\(\)\) \{[\s\S]*?onclick="wrTipAsk\(\)"/);
  const sub = fnSrc('submitLssScoreRequest');
  assert.match(sub, /wrCanAskLive\(\) && typeof wrCsAsk==='function' && !lssIsSelf\(name\)\) wrCsAsk\(/);
  // G3 changes skill levels directly as before: the skill editor still asks only for a G4
  const ed = fnSrc('saveStaffSkillEdit');
  assert.match(ed, /wrIsG4Live\(\)\) \{ if \(typeof wrSkillAsk==='function'\) wrSkillAsk/);
  assert.doesNotMatch(ed, /wrCanAskLive|wrIsG3Live/);
});
