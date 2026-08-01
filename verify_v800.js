/* verify_v800.js — 管轄店舗の割り当て画面（AM / Head Chef）
   正は店舗マスター1か所。人ベースの表から操作しても、書き込み先は店舗マスター。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v799_backup.html', 'utf8');
let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}
console.log('\n=== v800: 管轄店舗の割り当て ===\n');

function build(stores, emps, role) {
  return new Function('STORES_IN', 'EMPS', 'ROLE', `
    var STORES=JSON.parse(JSON.stringify(STORES_IN));
    var curRole=ROLE, curUserName='Moto', curPage='stores';
    var toasts=[], saved=0;
    function getStoresAll(){ return STORES; }
    function setStoresAll(s){ STORES=s; saved++; }
    function getEmployees(){ return EMPS; }
    function empGrade(e){ return (e&&e.grade)||''; }
    function amStoresOf(n){ return getStoresAll().filter(function(s){return s.am===n;}).map(function(s){return s.id;}); }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function showToast(m,t){ toasts.push([m,t]); }
    function openModal(h){ LASTMODAL=h; }
    function closeModalDirect(){}
    function renderPage(){}
    function lsSet(){ return true; }
    var LASTMODAL='';
    ${grab(src, '_owStoreName')}
    ${grab(src, 'scStoreList')}
    ${grab(src, 'scPeople')}
    ${grab(src, 'scStoresOfPerson')}
    ${grab(src, 'scToggle')}
    ${grab(src, 'scRefresh')}
    ${grab(src, 'scFieldLabel')}
    ${grab(src, 'scIssues')}
    ${grab(src, 'scAssignedStores')}
    ${grab(src, 'openScopeAssign')}
    ${grab(src, 'karteEmpStoresAuto')}
    ${grab(src, 'karteEmpStores')}
    ${grab(src, 'karteEmpStoreBasis')}
    return { stores:function(){return STORES;}, people:scPeople, toggle:scToggle,
             assigned:scAssignedStores, issues:scIssues, open:openScopeAssign,
             modal:function(){return LASTMODAL;}, saved:function(){return saved;},
             empStores:karteEmpStores, basis:karteEmpStoreBasis,
             toasts:function(){return toasts;} };
  `)(stores, emps, role || 'gm');
}
const STORES = [
  { id: 'F01', name: 'ToriTon', am: 'Yuki', chef: 'Chika', active: true },
  { id: 'F02', name: 'Tenkichi', am: 'Masa', active: true },
  { id: 'F04-K', name: 'Kaimuki', am: 'Yuki', active: true },
  { id: 'F05', name: 'Marujuu', active: false },
  { id: 'OFFICE', name: 'Office', active: true }
];
const EMPS = [
  { id: 'a1', name: 'Yuki', role: 'am', grade: 'G5', store: 'F04-K', status: '在籍' },
  { id: 'a2', name: 'Masa', role: 'am', grade: 'G5', store: 'F02', status: '在籍' },
  { id: 'c1', name: 'Chika', role: 'chef', title: 'Corporate Chef', grade: 'G5', store: 'F01', status: '在籍' },
  { id: 'c2', name: 'Hiro', role: 'crew', title: 'Head Chef', grade: 'G4', store: 'F02', status: '在籍' },
  { id: 's1', name: '田中', role: 'sl', grade: 'G3', store: 'F01', status: '在籍' },
  { id: 'x1', name: '退職者', role: 'am', grade: 'G5', store: 'F01', status: '退職' }
];

console.log('[1] 正は店舗マスターのまま');
{
  ok(/setStoresAll\(all\)/.test(grab(src, 'scToggle')), '書き込み先は店舗マスター');
  ok(!/lsSet\('employees'|setEmployees\(/.test(grab(src, 'scToggle')), '従業員マスターには書かない（正を2つにしない）');
  ok(/s\.am===name \|\| s\.chef===name/.test(grab(src, 'scAssignedStores')), '読み取りも店舗マスターから');
  ok(/st-chef/.test(src) && /chef:/.test(grab(src, 'saveStore')), '店舗編集にも Head Chef 欄がある');
  ok(prev.indexOf('st-chef') < 0, 'v799 には Head Chef の欄が無かった');
}

console.log('\n[2] 対象になる人を拾う');
{
  const e = build(STORES, EMPS);
  const p = e.people();
  const names = p.map(function (x) { return x.name; });
  ok(names.indexOf('Yuki') >= 0 && names.indexOf('Masa') >= 0, 'AM が出る', names);
  ok(names.indexOf('Chika') >= 0, 'role=chef が出る', names);
  ok(names.indexOf('Hiro') >= 0, '肩書きが Head Chef の人も出る', names);
  ok(names.indexOf('田中') < 0, 'SL は出ない', names);
  ok(names.indexOf('退職者') < 0, '退職者は出ない', names);
  ok(p.find(function (x) { return x.name === 'Yuki'; }).kind === 'am', 'Yuki は AM 区分');
  ok(p.find(function (x) { return x.name === 'Hiro'; }).kind === 'chef', 'Hiro は Chef 区分');
  /* 店舗に名前だけ残っている人も取りこぼさない */
  const e2 = build(STORES.concat([{ id: 'F09', name: 'X店', am: '幽霊AM', active: true }]), EMPS);
  const orphan = e2.people().find(function (x) { return x.name === '幽霊AM'; });
  ok(!!orphan && orphan.orphan === true, '従業員マスターに居ない担当者も表示される', orphan);
}

console.log('\n[3] 1店舗=1人（付けると前の担当が外れる）');
{
  const e = build(STORES, EMPS);
  ok(JSON.stringify(e.assigned('Yuki')) === JSON.stringify(['F01', 'F04-K']), '初期は Yuki が2店', e.assigned('Yuki'));
  e.toggle('Masa', 'am', 'F01');
  ok(e.stores().find(function (s) { return s.id === 'F01'; }).am === 'Masa', 'F01 の担当が Masa になる');
  ok(JSON.stringify(e.assigned('Yuki')) === JSON.stringify(['F04-K']), 'Yuki から自動的に外れる（2重管轄にならない）', e.assigned('Yuki'));
  ok(e.toasts().some(function (t) { return /Yuki/.test(t[0]) && /Masa/.test(t[0]); }), '担当が入れ替わったことを伝える', e.toasts());
  /* 同じマスをもう一度押すと外れる */
  e.toggle('Masa', 'am', 'F01');
  ok(!e.stores().find(function (s) { return s.id === 'F01'; }).am, 'もう一度押すと未割当に戻る');
  /* AM と Chef は別枠なので干渉しない */
  const e2 = build(STORES, EMPS);
  e2.toggle('Hiro', 'chef', 'F01');
  ok(e2.stores().find(function (s) { return s.id === 'F01'; }).chef === 'Hiro', 'Chef 枠が変わる');
  ok(e2.stores().find(function (s) { return s.id === 'F01'; }).am === 'Yuki', 'AM 枠は影響を受けない');
}

console.log('\n[4] 査定の対象店に反映される');
{
  const e = build(STORES, EMPS);
  ok(JSON.stringify(e.empStores({}, EMPS[0])) === JSON.stringify(['F01', 'F04-K']), 'AM は管轄2店', e.empStores({}, EMPS[0]));
  ok(JSON.stringify(e.empStores({}, EMPS[2])) === JSON.stringify(['F01']), 'Chef も管轄が対象になる', e.empStores({}, EMPS[2]));
  ok(e.basis({}, EMPS[2]).kind === 'chef', '根拠が Chef と分かる', e.basis({}, EMPS[2]));
  ok(/Chef/.test(e.basis({}, EMPS[2]).label), '画面表示に Chef と出る', e.basis({}, EMPS[2]).label);
  /* 割り当てを変えると査定の対象も変わる */
  e.toggle('Chika', 'chef', 'F02');
  ok(JSON.stringify(e.empStores({}, EMPS[2])) === JSON.stringify(['F01', 'F02']), '割り当てを足すと対象が増える', e.empStores({}, EMPS[2]));
  /* 未割当の Chef は配属店 */
  ok(JSON.stringify(e.empStores({}, EMPS[3])) === JSON.stringify(['F02']), '未割当の人は配属店', e.empStores({}, EMPS[3]));
  ok(e.basis({}, EMPS[3]).kind === 'own' || e.basis({}, EMPS[3]).kind === 'none', '未割当と分かる', e.basis({}, EMPS[3]));
  /* 休止店は対象外 */
  const e3 = build(STORES.map(function (s) { return s.id === 'F05' ? Object.assign({}, s, { am: 'Masa' }) : s; }), EMPS);
  ok(e3.empStores({}, EMPS[1]).indexOf('F05') < 0, '休止店は査定の対象に入らない', e3.empStores({}, EMPS[1]));
  /* 一般スタッフは変わらない */
  ok(JSON.stringify(e.empStores({}, EMPS[4])) === JSON.stringify(['F01']), 'SL は配属店のまま');
}

console.log('\n[5] 未割当の検出');
{
  const e = build(STORES, EMPS);
  const iss = e.issues();
  ok(iss.some(function (x) { return x.sid === 'F02' && /Head Chef/.test(x.msg); }), 'Chef 未割当を検出', iss);
  ok(!iss.some(function (x) { return x.sid === 'F05'; }), '休止店は指摘しない', iss);
  ok(!iss.some(function (x) { return x.sid === 'OFFICE'; }), 'OFFICE は対象外', iss);
}

console.log('\n[6] 権限');
{
  const e = build(STORES, EMPS, 'am');
  e.toggle('Masa', 'am', 'F01');
  ok(e.stores().find(function (s) { return s.id === 'F01'; }).am === 'Yuki', 'AM は割り当てを変えられない');
  ok(e.saved() === 0, '保存も走らない');
  e.open();
  ok(e.modal() === '', 'AM は画面を開けない');
  ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(grab(src, 'scToggle')), '付け外しは GM・CEO のみ');
  ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(grab(src, 'openScopeAssign')), '画面も GM・CEO のみ');
  ok(/\['gm','ceo'\]\.indexOf\(curRole\)>=0\?/.test(src.slice(src.indexOf('function renderStoreMaster'), src.indexOf('function renderStoreMaster') + 900)), '入口ボタンも GM・CEO だけに出る');
}

console.log('\n[7] 画面');
{
  const e = build(STORES, EMPS);
  e.open();
  const h = e.modal();
  ok(/管轄店舗の割り当て/.test(h), '見出しが出る');
  ok(/エリアマネージャー/.test(h) && /Head Chef/.test(h), 'AM と Head Chef の2区分が出る');
  ok(/ToriTon/.test(h) && /Kaimuki/.test(h), '店舗が列に並ぶ');
  ok(/Yuki/.test(h) && /Chika/.test(h), '対象者が行に並ぶ');
  ok(/scToggle/.test(h), 'マスを押すと付け外しできる');
  ok(/休止/.test(h), '休止店が分かる');
  ok(/未割当/.test(h), '未割当の警告が出る');
  ok(/1店舗の担当は1人/.test(h), '入れ替わる仕様が説明されている');
  ok(/openScopeAssign/.test(src.slice(src.indexOf('function renderStoreMaster'), src.indexOf('function renderStoreMaster') + 900)), '店舗マスターに入口がある');
  /* 名前に引用符が入っても壊れない */
  const e2 = build(STORES, EMPS.concat([{ id: 'q1', name: "O'Brien", role: 'am', grade: 'G5', store: 'F01', status: '在籍' }]));
  e2.open();
  ok(e2.modal().indexOf('scToggle') >= 0, '特殊文字の名前でも描画できる');
}

console.log('\n[8] 影響範囲');
{
  ok(grab(src, 'bonusForEmp') === grab(prev, 'bonusForEmp'), '算定式は変えていない');
  ok(grab(src, 'budgetAchieveFor') === grab(prev, 'budgetAchieveFor'), '予算達成率の取り方も同じ');
  ok(grab(src, 'myAmStores') === grab(prev, 'myAmStores'), '権限の見える範囲の判定は変えていない');
  ok(grab(src, 'amStoresOf') === grab(prev, 'amStoresOf'), 'amStoresOf も変えていない');
  ok(!/lsSet\(/.test(grab(src, 'scAssignedStores')) && !/lsSet\(/.test(grab(src, 'scIssues')), '読み取り側は保存しない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
