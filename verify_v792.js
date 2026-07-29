/* verify_v792.js — 現金チップの入力権限の診断
   v626/v630 を入れても残っていた「入力できないスタッフ」の関門を名指しできること。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v791_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}
function arrDecl(text, name) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\['));
  if (a < 0) throw new Error('arr not found: ' + name);
  let i = text.indexOf('[', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') d++;
    else if (text[j] === ']') { d--; if (d === 0) { end = j; break; } }
  }
  return 'var ' + name + ' = ' + text.slice(i, end + 1) + ';';
}

console.log('\n=== v792: 現金チップの入力権限を診断できる ===\n');

const GROUP_ARRAYS = ['NAV_ITEMS', 'MENU_GROUPS', 'CREW_GROUPS', 'STORE_GROUPS', 'CHEF_GROUPS',
  'OFFICE_CREW_GROUPS', 'ACCT_GROUPS', 'OFFICE_GROUPS', 'NO_CASHTIP_STORES'];

function build() {
  return new Function(`
    var store={};
    var curRole=null, curRealRole=null, curUserName=null, curStore=null, curStoreLogin=false;
    var _emps=[];
    var STORES=[{id:'F01',name:'ToriTon'},{id:'F03',name:'FSP'},{id:'F03-G',name:'WGS'},{id:'F04-K',name:'Kaimuki'}];
    var GRADE_TITLES={G3:['Store Leader'],G4:['Head Chef','Office Manager','Accountant','Store Manager'],G5:['Corporate Chef'],G6:['GM']};
    function gradeOf(t){ for(var g in GRADE_TITLES){ if(GRADE_TITLES[g].indexOf(t)>=0) return g; } return null; }
    function gradeNum(g){ return g? (Number(String(g).replace('G',''))||0) : 0; }
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); }
    function getEmployees(){ return _emps; }
    function getRoleHide(sub){ return ls('role_hide_'+sub, []) || []; }
    ${GROUP_ARRAYS.map(n => arrDecl(src, n)).join('\n    ')}
    var ROLE_ALIAS = { g2:'sl', g4:'am' };
    ${grab(src, '_applyRole')}
    ${grab(src, 'myGradeKey')}
    ${grab(src, 'getGradeHide')}
    ${grab(src, 'gradeHideFor')}
    ${grab(src, '_gradeHideApplies')}
    ${grab(src, 'groupsForRole')}
    ${grab(src, 'isNoCashTipStore')}
    ${grab(src, 'cashTipCanEnter')}
    ${grab(src, '_cashTipGateGlobals')}
    ${grab(src, '_cashTipGateRestore')}
    ${grab(src, 'cashTipEntryGate')}
    ${grab(src, 'cashTipHiddenGrades')}
    return {
      gate:cashTipEntryGate, hidden:cashTipHiddenGrades,
      lsSet:lsSet, store:function(){return store;},
      setEmps:function(e){ _emps=e; },
      login:function(raw,name,sid){ _applyRole(raw); curUserName=name; curStore=sid; curStoreLogin=false; },
      globals:function(){ return {curRole:curRole,curRealRole:curRealRole,curUserName:curUserName,curStore:curStore,curStoreLogin:curStoreLogin}; },
      breakGroups:function(){ groupsForRole=function(){ throw new Error('boom'); }; }
    };
  `)();
}

/* ---------- 1. 既定の設定では店舗側の全員が入力できる ---------- */
console.log('[1] 既定の設定（grade_hide なし）');
{
  const e = build();
  e.lsSet('grade_hide', null); e.lsSet('role_hide_g2', []); e.lsSet('role_hide_g4', []);
  e.login('gm', 'Moto', 'F01');
  const t = (role, title) => e.gate({ name: 'X', role: role, title: title || '' }, 'F01');
  ['crew', 'g2', 'sl', 'g4', 'am', 'gm', 'ceo'].forEach(r => {
    ok(t(r).ok === true, r + ' は入力できる', t(r));
  });
  ok(t('crew').grade === 'G1', 'crew は G1 と判定される', t('crew').grade);
  ok(t('g2').grade === 'G2', 'g2 は G2 と判定される', t('g2').grade);
  ok(t('g4').grade === 'G4', 'g4 は G4 と判定される', t('g4').grade);
  /* 本部側 */
  ok(t('chef').ok === false, 'chef（Head Chef）は入力できない', t('chef'));
  ok(t('office_crew').ok === false, 'office_crew は入力できない', t('office_crew'));
}

/* ---------- 2. 対象外店舗 ---------- */
console.log('\n[2] 対象外店舗（FSP / WGS）');
{
  const e = build();
  e.lsSet('grade_hide', null); e.login('gm', 'Moto', 'F03');
  ['F03', 'F03-G'].forEach(sid => {
    const r = e.gate({ name: 'X', role: 'crew' }, sid);
    ok(r.ok === false && /対象外店舗/.test(r.blockedBy), sid + ' は対象外店舗として理由が出る', r);
  });
  ok(e.gate({ name: 'X', role: 'crew' }, 'F01').ok === true, 'F01 は入力できる');
}

/* ---------- 3. 長年の原因：grade_hide で店舗オペレーションが消える ---------- */
console.log('[3] grade_hide で「店舗オペレーション」が非表示のとき');
{
  [['crew', 'G1'], ['g2', 'G2'], ['sl', 'G3'], ['g4', 'G4'], ['am', 'G5']].forEach(([role, gk]) => {
    const e = build();
    const gh = { G1: [], G2: [], G3: [], G4: [], G5: [], G6: [] }; gh[gk] = ['store_cmd'];
    e.lsSet('grade_hide', gh); e.login('gm', 'Moto', 'F01');
    const r = e.gate({ name: 'X', role: role }, 'F01');
    ok(r.ok === false, role + '(' + gk + ') は入力できなくなる', r);
    ok(r.roleOk === true, '  ページ権限は「許可」のまま（ここだけ見ても分からない）', r.roleOk);
    ok(r.inGroup === false, '  メニューのグループから消えている', r.inGroup);
    ok(r.blockedBy.indexOf(gk) >= 0 && /メニューから非表示/.test(r.blockedBy),
      '  理由に等級と原因が出る', r.blockedBy);
  });
}

/* ---------- 4. 旧設定 role_hide_g2 の引き継ぎ ---------- */
console.log('\n[4] 旧 role_hide_g2 が今も効いている場合');
{
  const e = build();
  e.lsSet('grade_hide', null);              /* grade_hide 未設定 */
  e.lsSet('role_hide_g2', ['store_cmd']);   /* 昔の設定だけが残っている */
  e.login('gm', 'Moto', 'F01');
  const r = e.gate({ name: 'X', role: 'g2' }, 'F01');
  ok(r.ok === false, 'G2 は入力できない（grade_hide を触っていないのに）', r);
  ok(/G2/.test(r.blockedBy), '理由が G2 を指す', r.blockedBy);
  ok(e.hidden().indexOf('G2') >= 0, '早見（cashTipHiddenGrades）が G2 を挙げる', e.hidden());
  ok(e.gate({ name: 'X', role: 'crew' }, 'F01').ok === true, 'G1 には影響しない');
  ok(e.gate({ name: 'X', role: 'sl' }, 'F01').ok === true, 'G3 には影響しない');
}

/* ---------- 5. 役職より上の title を持つ人 ---------- */
console.log('\n[5] title で等級が上がる人');
{
  const e = build();
  const gh = { G1: [], G2: [], G3: ['store_cmd'], G4: [], G5: [], G6: [] };
  e.lsSet('grade_hide', gh); e.login('gm', 'Moto', 'F01');
  e.setEmps([{ name: 'Leader', role: 'crew', title: 'Store Leader', store: 'F01' }]);
  const r = e.gate({ name: 'Leader', role: 'crew', title: 'Store Leader' }, 'F01');
  ok(r.grade === 'G3', 'role=crew でも title=Store Leader なら G3', r.grade);
  ok(r.ok === false && /G3/.test(r.blockedBy), 'G3 の非表示設定が効く（等級で判定される）', r);
}

/* ---------- 6. 診断が現在のログイン状態を壊さない ---------- */
console.log('\n[6] 診断の副作用');
{
  const e = build();
  e.lsSet('grade_hide', null); e.login('gm', 'Moto', 'F04-K');
  const before = JSON.stringify(e.globals());
  const storeBefore = JSON.stringify(e.store());
  e.gate({ name: 'X', role: 'crew' }, 'F01');
  e.gate({ name: 'Y', role: 'chef' }, 'F03');
  ok(JSON.stringify(e.globals()) === before, '判定後もログイン中の役職・店舗が元に戻る', e.globals());
  ok(JSON.stringify(e.store()) === storeBefore, '設定を1つも書き換えない');

  /* 途中で例外が出ても戻る（ここが戻らないと権限が入れ替わったまま操作できてしまう） */
  const e2 = build();
  e2.lsSet('grade_hide', null); e2.login('gm', 'Moto', 'F04-K');
  const b2 = JSON.stringify(e2.globals());
  e2.breakGroups();
  const r = e2.gate({ name: 'X', role: 'crew' }, 'F01');
  ok(JSON.stringify(e2.globals()) === b2, '例外が出てもログイン状態が元に戻る', e2.globals());
  ok(r.ok === false, '判定できないときは「できない」側に倒す', r);
}

/* ---------- 7. 書き込みをしない ---------- */
console.log('\n[7] 読み取りだけ');
{
  ['cashTipEntryGate', 'cashTipHiddenGrades', 'openCashTipPermCheck', '_cashTipGateGlobals'].forEach(fn => {
    const body = grab(src, fn);
    ok(!/lsSet\(|setGradeHide\(|toggleGradeHide\(|setRoleHide\(|localStorage\.setItem/.test(body),
      fn + ' は設定を書き換えない');
  });
  const re = /toggleGradeHide\(/g;
  ok((prev.match(re) || []).length === (src.match(re) || []).length,
    '設定を変える経路の数は v791 と同じ');
}

/* ---------- 8. 入口と気づける仕掛け ---------- */
console.log('\n[8] 入口');
{
  ok(prev.indexOf('openCashTipPermCheck') < 0, 'v791 には無かった');
  ok(/onclick="openCashTipPermCheck\(\)"/.test(src), 'チップ管理にボタンがある');
  const tool = src.slice(src.indexOf('function renderTipMgmt'), src.indexOf('function renderTipMgmt') + 2500);
  ok(/openCashTipPermCheck/.test(tool), 'その場所はチップ管理のツールバー');
  ok(/openTipDateDebug/.test(tool), '既存の Tip診断も残っている');
  const gate = grab(src, 'openCashTipPermCheck').slice(0, 300);
  ok(/\['gm','ceo','office','am'\]\.indexOf\(curRole\)<0/.test(gate), 'GM・CEO・経理・AM 以外は開けない');
  /* 原因を切り替える場所に注意が出る */
  const cfg = grab(src, 'renderGradeHideConfig');
  ok(/pid==='store_cmd' && on/.test(cfg), '設定画面で store_cmd を隠したときに注意が出る');
  ok(/現金チップ/.test(cfg), 'その注意が現金チップに触れている');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
