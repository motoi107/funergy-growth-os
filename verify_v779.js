/* ============================================================
   verify_v779.js — Office ログインの並びを Grade 順にする

   実際の並べ替えを切り出して、v778 と v779 の並びを比較する。
   指定：CEO → GM → AM → Office Manager(経理) → Head Chef → 事務Crew

     テスト1: 症状再現 … v778 は 経理・Head Chef が AM より前だった
     テスト2: v779 … 指定どおりの順になる
     テスト3: 同じ役職が複数いれば名前順
     テスト4: 指定に無い役職（配属だけ OFFICE）は後ろに実Grade降順
     テスト5: 店舗側の並びは変えていない（実Grade降順のまま）
     テスト6: 表示ラベル
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v778_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  ✅ ' + m); pass++; } else { console.log('  ❌ ' + m); fail++; } }

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src); if (!m) return null;
  let i = src.indexOf('function', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function grabVar(src, decl, endTok) {
  const i = src.indexOf(decl); if (i < 0) return null;
  return src.slice(i, src.indexOf(endTok, i) + endTok.length);
}

/* loginPickLocation から並べ替えだけを取り出す */
function sorter(src) {
  const fn = grab(src, 'loginPickLocation');
  const s = fn.indexOf('var order=');
  const e = fn.indexOf('ng.innerHTML', s);   /* s より後ろを探す。ng.innerHTML は !people.length 側にも出る */
  const body = fn.slice(s, e);
  if (s < 0 || e < 0 || !body.trim()) throw new Error('並べ替えの抽出に失敗しました');
  const sb = { console, Object, Array, String, Number, Math, parseInt };
  let code = '';
  code += grabVar(src, 'var GRADE_TITLES = {', '};') + '\n';
  for (const n of ['gradeOf', 'gradeNum', 'empGrade', 'empGradeNum']) code += grab(src, n) + '\n';
  code += 'function _sort(people, loc){ ' + body + ' return people.map(function(p){return p.name;}); }';
  vm.createContext(sb); vm.runInContext(code, sb);
  return sb._sort;
}

const HQ = [
  { name: 'Akane Yoshizawa', role: 'office_crew', title: 'Office Crew' },
  { name: 'Chikayoshi Nishihara', role: 'chef', title: 'Head Chef' },
  { name: 'Marcia Kodama', role: 'office', title: 'Office Manager' },
  { name: 'Yuki Nagatani', role: 'am', title: 'Area Manager' },
  { name: 'Moto Kubota', role: 'gm', title: 'General Manager' },
  { name: 'Tac Tsutsumi', role: 'ceo', title: '' }
];
const WANT = ['Tac Tsutsumi', 'Moto Kubota', 'Yuki Nagatani', 'Marcia Kodama',
  'Chikayoshi Nishihara', 'Akane Yoshizawa'];

console.log('\n===== テスト1: 症状再現（v778 の並び） =====');
{
  const got = sorter(OLD)(HQ.slice(), 'OFFICE');
  console.log('     v778: ' + got.join(' → '));
  ok(got.indexOf('Marcia Kodama') < got.indexOf('Yuki Nagatani'),
    'v778: 経理(G4) が AM(G5) より前だった');
  ok(got.indexOf('Chikayoshi Nishihara') < got.indexOf('Yuki Nagatani'),
    'v778: Head Chef(G4) も AM(G5) より前だった');
  ok(got.join(',') !== WANT.join(','), 'v778 は指定の並びではない');
}

console.log('\n===== テスト2: v779 の並び =====');
{
  const got = sorter(SRC)(HQ.slice(), 'OFFICE');
  console.log('     v779: ' + got.join(' → '));
  ok(got.join(',') === WANT.join(','), 'CEO → GM → AM → Office Manager → Head Chef → 事務Crew');
  /* 入力順を変えても同じ結果か */
  const shuffled = [HQ[3], HQ[0], HQ[5], HQ[2], HQ[1], HQ[4]];
  ok(sorter(SRC)(shuffled, 'OFFICE').join(',') === WANT.join(','), '入力順に依存しない');
}

console.log('\n===== テスト3: 同じ役職は名前順 =====');
{
  const two = [{ name: 'Zoe', role: 'office', title: '' }, { name: 'Ann', role: 'office', title: '' },
  { name: 'Tac Tsutsumi', role: 'ceo', title: '' }];
  const got = sorter(SRC)(two, 'OFFICE');
  ok(got[0] === 'Tac Tsutsumi', 'CEO が先頭');
  ok(got[1] === 'Ann' && got[2] === 'Zoe', '同じ役職どうしは名前順（' + got.slice(1).join(', ') + '）');
}

console.log('\n===== テスト4: 指定に無い役職は後ろに実Grade降順 =====');
{
  const mixed = HQ.concat([
    { name: 'Office G4', role: 'g4', title: 'Store Manager' },
    { name: 'Office G2', role: 'g2', title: 'Crew Leader' },
    { name: 'Office G3', role: 'sl', title: 'Store Leader' }
  ]);
  const got = sorter(SRC)(mixed, 'OFFICE');
  console.log('     ' + got.join(' → '));
  ok(got.slice(0, 6).join(',') === WANT.join(','), '指定の6役職が先頭でその順');
  ok(got.indexOf('Office G4') < got.indexOf('Office G3'), 'G4 → G3');
  ok(got.indexOf('Office G3') < got.indexOf('Office G2'), 'G3 → G2');
}

console.log('\n===== テスト5: 店舗側の並びは据え置き =====');
{
  const store = [{ name: 'Crew A', role: 'crew', title: 'Crew' },
  { name: 'SL B', role: 'sl', title: 'Store Leader' },
  { name: 'Mgr C', role: 'g4', title: 'Store Manager' }];
  const a = sorter(OLD)(store.slice(), 'F01').join(',');
  const b = sorter(SRC)(store.slice(), 'F01').join(',');
  ok(a === b, '店舗の並びが v778 と同じ（' + b + '）');
  ok(b === 'Mgr C,SL B,Crew A', '実Grade降順のまま');
}

console.log('\n===== テスト6: 表示ラベル =====');
{
  const map = (SRC.match(/var map = \{ceo:\['CEO'[^;]*\};/) || [''])[0];
  ok(map.indexOf('chef:') < 0, "roleLabelI18n に chef が無い（ROLE_CONFIG へ落ちる）");
  ok(SRC.indexOf("chef:   { label:'Head Chef'") >= 0, 'その落ち先が Head Chef（v778）');
  ok(map.indexOf("am:['G5(エリアMG)','G5(Area Mgr)']") >= 0, 'am の表示は G5(エリアMG) のまま');
  ok(map.indexOf("office:['経理','Office']") >= 0, 'office の表示は 経理 のまま');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
