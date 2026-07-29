/* ============================================================
   verify_v778.js — 役職ラベルと等級の食い違いを直す

   役職 chef のグレードは G4 なのに、ラベルが 'Corporate Chef' だった。
   GRADE_TITLES では Corporate Chef=G5 / Head Chef=G4 なので、
   役職名と等級が食い違って見える状態だった。

     テスト1: 症状再現 … v777 は G4 の役職に G5 の呼称が付いていた
     テスト2: v778 … ラベルが Head Chef
     テスト3: 等級の一貫性 … 役職も title も G4 で揃う
     テスト4: G5 へ上げる道が残っている（title で Corporate Chef）
     テスト5: 役職の中身は変えていない（メニュー・権限・全店表示）
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v777_backup.html', 'utf8');

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
function env(src) {
  const sb = { console, Object, Array, String, Math, parseInt };
  let code = '';
  code += grabVar(src, 'const ROLE_CONFIG = {', '\n};').replace('const ROLE_CONFIG', 'var ROLE_CONFIG') + '\n';
  code += grabVar(src, 'var GRADE_TITLES = {', '};') + '\n';
  code += grabVar(src, 'const ROLE_TO_PERM = {', '};').replace('const ROLE_TO_PERM', 'var ROLE_TO_PERM') + '\n';
  for (const n of ['gradeOf', 'gradeNum', 'empGrade', 'permFromRole']) code += grab(src, n) + '\n';
  vm.createContext(sb); vm.runInContext(code, sb);
  return sb;
}

console.log('\n===== テスト1: 症状再現（G4の役職にG5の呼称） =====');
{
  const o = env(OLD);
  ok(o.ROLE_CONFIG.chef.label === 'Corporate Chef', "v777: 役職ラベルが 'Corporate Chef'");
  ok(o.empGrade({ role: 'chef', title: '' }) === 'G4', 'v777: しかし等級は G4');
  ok(o.gradeOf('Corporate Chef') === 'G5', 'v777: GRADE_TITLES では Corporate Chef=G5');
  ok(o.gradeOf('Head Chef') === 'G4', 'v777: Head Chef=G4');
}

console.log('\n===== テスト2: v778 のラベル =====');
{
  const n = env(SRC);
  ok(n.ROLE_CONFIG.chef.label === 'Head Chef', "役職ラベルが 'Head Chef'");
  ok(n.ROLE_CONFIG.chef.name === 'Head Chef', '既定表示名も Head Chef');
}

console.log('\n===== テスト3: 等級の一貫性 =====');
{
  const n = env(SRC);
  const g = n.gradeOf(n.ROLE_CONFIG.chef.label);
  ok(g === 'G4', '役職ラベルを GRADE_TITLES で引くと G4（ラベルと等級が一致）');
  ok(n.empGrade({ role: 'chef', title: 'Head Chef' }) === 'G4', 'role・title どちらでも G4');
  ok(n.empGrade({ role: 'chef', title: '' }) === 'G4', 'title 未設定でも G4');
  const o = env(OLD);
  ok(o.gradeOf(o.ROLE_CONFIG.chef.label) === 'G5',
    'v777 は役職ラベルを引くと G5 で、実際の G4 と食い違っていた');
}

console.log('\n===== テスト4: G5 へ上げる道 =====');
{
  const n = env(SRC);
  ok(n.empGrade({ role: 'chef', title: 'Corporate Chef' }) === 'G5',
    "title を 'Corporate Chef' にすれば G5（empGrade は title 優先）");
  ok(n.gradeOf('Corporate Chef') === 'G5', 'GRADE_TITLES は変えていない');
}

console.log('\n===== テスト5: 役職の中身は変えていない =====');
{
  const n = env(SRC), o = env(OLD);
  ['financial', 'allStores', 'canApprove', 'canCreate'].forEach(k =>
    ok(n.ROLE_CONFIG.chef[k] === o.ROLE_CONFIG.chef[k], k + ' は据え置き（' + n.ROLE_CONFIG.chef[k] + '）'));
  ok(n.permFromRole('chef') === 'manager', "perms は 'manager' のまま");
  ok(SRC.indexOf("else if (curRole==='chef') groups = CHEF_GROUPS;") >= 0, 'メニューは CHEF_GROUPS のまま');
  ok(/\['ceo','gm','office','chef','am','g4','sl','g2','office_crew','crew'\]/.test(SRC),
    '役職の選択肢に残っている（v777）');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
