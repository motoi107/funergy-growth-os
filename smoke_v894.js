/* smoke_v894.js — ダッシュボードのスコープを役職ごとに実際に走らせて確かめる。
   要点は2つ。
   ① AM のダッシュボードで全店の数字が見えるか
   ② それ以外の画面（予実など）は管轄店舗のままか、管轄外の店に入れないか
   ②が崩れると、見えるだけのつもりが他店の中身まで開ける状態になる。 */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}
let bad = 0;
function mark(ok, line) { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + line); }

const ALL = ['F01', 'F02', 'F03', 'F04-K', 'F04-P', 'F05', 'F06'];
const MINE = ['F04-K', 'F04-P'];      // AM の管轄
const SUPPORT = ['F05'];              // 応援

const src = `
var STORES = ${JSON.stringify(ALL.map(id => ({ id, name: id, active: true })))};
var AM_STORES = ${JSON.stringify(MINE)};
var curRole='am', curRealRole='am', curStore='ALL', curUserName='Yuki';
var ROLE_CONFIG={ am:{name:'Yuki'}, gm:{name:'Moto'}, sl:{name:'SL'}, crew:{name:'C'} };
function getStoresAll(){ return STORES; }
function activeStores(){ return getStoresAll().filter(function(s){return s.active;}); }
function sortByLoginOrder(a){ return a; }
function myStoreId(){ return 'F04-K'; }
function myAmStores(){ if(curRealRole==='g4'){ var g=myStoreId(); return g?[g]:[]; } return AM_STORES.slice(); }
function mySupportStores(){ return ${JSON.stringify(SUPPORT)}; }
${grab(/function getVisibleStores\(\) \{[\s\S]*?\n\}/, 'getVisibleStores')}
${grab(/function dashScopeStores\(\)\{[\s\S]*?\n\}/, 'dashScopeStores')}
${grab(/function dashCanEnter\(id\)\{[\s\S]*?\n\}/, 'dashCanEnter')}
return { getVisibleStores, dashScopeStores, dashCanEnter,
         set role(r){ curRole=r; }, set store(s){ curStore=s; }, set realRole(r){ curRealRole=r; } };
`;
const A = new Function(src)();
const ids = a => a.map(s => s.id);

/* ---------- ① AM のダッシュボード ---------- */
A.role = 'am'; A.store = 'ALL';
mark(ids(A.dashScopeStores()).join() === ALL.join(),
  'AM のダッシュボードに全店が出る（' + ids(A.dashScopeStores()).length + '店）');
mark(ids(A.getVisibleStores()).join() === MINE.concat(SUPPORT).join(),
  '★ 他の画面（予実など）は管轄＋応援のまま（' + ids(A.getVisibleStores()).join() + '）');

/* ---------- ② 管轄外に入れないこと ---------- */
MINE.concat(SUPPORT).forEach(id => mark(A.dashCanEnter(id) === true, '管轄店 ' + id + ' には入れる'));
ALL.filter(id => !MINE.concat(SUPPORT).includes(id))
  .forEach(id => mark(A.dashCanEnter(id) === false, '★ 管轄外 ' + id + ' には入れない'));

/* ---------- ③ 店舗を1つ選んだとき ---------- */
A.store = 'F01';
mark(ids(A.dashScopeStores()).join() === 'F01', '上部で店舗を選ぶと GM と同じくその店だけになる');
mark(A.dashCanEnter('F01') === false, '選んでも管轄外なら入れないまま');
A.store = 'ALL';

/* ---------- ④ 他の役職の見え方が変わっていないこと ---------- */
A.role = 'gm';
mark(ids(A.dashScopeStores()).join() === ALL.join(), 'GM は従来どおり全店');
mark(ids(A.dashScopeStores()).join() === ids(A.getVisibleStores()).join(), 'GM はダッシュボードと他画面が一致（変化なし）');
mark(A.dashCanEnter('F01') === true, 'GM はどの店にも入れる');
A.role = 'ceo';
mark(ids(A.dashScopeStores()).join() === ids(A.getVisibleStores()).join(), 'CEO も変化なし');
A.role = 'sl';
mark(ids(A.dashScopeStores()).join() === ids(A.getVisibleStores()).join(), 'SL は変化なし（配属＋応援のまま）');
mark(ids(A.dashScopeStores()).join() !== ALL.join(), 'SL に全店は出ない');
A.role = 'crew';
mark(ids(A.dashScopeStores()).join() === ids(A.getVisibleStores()).join(), 'crew も変化なし');

/* ---------- ⑤ G4（管轄1店）の AM ---------- */
A.role = 'am'; A.realRole = 'g4';
mark(A.dashCanEnter('F04-K') === true, 'G4 は配属店に入れる');
mark(A.dashCanEnter('F04-P') === false, '★ G4 は他店に入れない（管轄は配属1店のみ）');
mark(ids(A.dashScopeStores()).join() === ALL.join(), 'G4 でもダッシュボードは全店見える');
A.realRole = 'am';

/* ---------- ⑥ 配線 ---------- */
const has = re => re.test(utf);
mark(has(/var stores = sortByLoginOrder\(dashScopeStores\(\)\)\.map/), 'ダッシュボードが dashScopeStores を使う');
mark(has(/var actionable = stores\.filter\(function\(s\)\{ return dashCanEnter\(s\.id\); \}\);/),
  '★ 優先アクションは管轄店舗のみ');
mark(/function renderLaborOverview\(\) \{[\s\S]{0,400}?sortByLoginOrder\(getVisibleStores\(\)\)/.test(utf),
  '★ 人件費画面は getVisibleStores のまま（触っていない）');
mark(!/function getVisibleStores\(\) \{[\s\S]*?dashScopeStores/.test(grab(/function getVisibleStores\(\) \{[\s\S]*?\n\}/, 'gvs')),
  '★ getVisibleStores 自体を書き換えていない');
mark(has(/\$\{_canEnter\?`onclick="switchStore\('\$\{s\.id\}'\);go\('budget'\)"`:''\}/),
  '管轄外の行はタップしても遷移しない');
mark(has(/管轄外/), '管轄外の店にはその旨の表示が出る');
mark(has(/dashScopeStores==='function'\) \? dashScopeStores\(\) : getVisibleStores\(\)/),
  'Funergy Now も同じスコープに揃っている');

/* 予実など他画面が getVisibleStores を使い続けているか（本数で確認） */
const gvsUses = (utf.match(/getVisibleStores\(\)/g) || []).length;
mark(gvsUses > 30, '他画面は getVisibleStores を使い続けている（' + gvsUses + '箇所）');

console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
process.exit(bad ? 1 : 0);
