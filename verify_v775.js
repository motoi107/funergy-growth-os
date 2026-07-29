/* ============================================================
   verify_v775.js — chef ロールを本部の一員として成立させる

   Corporate Chef（Chikayoshi Nishihara）を role='chef' に切り替えたときに
   起きる欠落を、実関数を切り出して再現・比較する。

     テスト1: 症状再現 … v774 は chef を G1 と判定する（表示制御が効きすぎる）
     テスト2: 症状再現 … v774 は chef を本部スタッフの集合に含めない（勤怠・給与から消える）
     テスト3: 症状再現 … v774 は permFromRole('chef') が 'crew' に落ちる
     テスト4: v775 … グレード G4／本部スタッフに含む／perms manager
     テスト5: 経理側の名簿(officeMembers)は変えていない
     テスト6: 表示ラベル
     テスト7: 打刻の対象
     テスト8: シードの Corporate Chef
     テスト9: 本部ログインの候補とページ許可
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v774_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  ✅ ' + m); pass++; } else { console.log('  ❌ ' + m); fail++; } }

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
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
  const i = src.indexOf(decl);
  if (i < 0) return null;
  return src.slice(i, src.indexOf(endTok, i) + endTok.length);
}

const EMPS = [
  { id: 'imp4', name: 'Chikayoshi Nishihara', role: 'chef', store: 'ALL', status: '在籍', title: 'Head Chef' },
  { id: 'o1', name: 'Marcia Kodama', role: 'office', store: 'ALL', status: '在籍', title: 'Accountant' },
  { id: 'o2', name: 'Akane Yoshizawa', role: 'office_crew', store: 'ALL', status: '在籍', title: 'Office Crew' },
  { id: 'r1', name: 'Retired Person', role: 'office', store: 'ALL', status: '退職', title: 'Accountant' },
  { id: 'c1', name: 'Some Crew', role: 'crew', store: 'F01', status: '在籍', title: 'Crew' }
];

function build(src, opts) {
  opts = opts || {};
  const sb = {
    console, Object, Array, String, Number, Math, JSON, parseInt,
    curUserName: opts.name || 'Chikayoshi Nishihara',
    curRealRole: opts.realRole || null,
    curRole: opts.role || 'chef',
    getEmployees: () => JSON.parse(JSON.stringify(opts.emps || EMPS)),
    _gradeHideApplies: () => false,
    gradeHideFor: () => []
  };
  let code = '';
  const gt = grabVar(src, 'var GRADE_TITLES = {', '};');
  if (gt) code += gt + '\n';
  const rp = grabVar(src, 'const ROLE_TO_PERM = {', '};');
  if (rp) code += rp.replace('const ROLE_TO_PERM', 'var ROLE_TO_PERM') + '\n';
  for (const n of ['gradeOf', 'gradeNum', 'empGrade', 'myGradeKey', 'permFromRole',
    'officeMembers', 'hqStaffMembers', 'officeRoleLabel']) {
    const t = grab(src, n); if (t) code += t + '\n';
  }
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return sb;
}

console.log('\n===== テスト1: 症状再現（v774 は chef を G1 と判定） =====');
{
  /* 実際の登録は title:'CC'。CC は GRADE_TITLES のどれにも一致しないため、
     v774 では title からも role からもグレードが取れず G1 に落ちる。 */
  const cc = [{ id: 'imp4', name: 'Chikayoshi Nishihara', role: 'chef', status: '在籍', title: 'CC' }];
  const o = build(OLD, { role: 'chef', realRole: 'chef', emps: cc });
  ok(o.myGradeKey() === 'G1', "v774: 実際の登録(title:'CC')で G1 と判定される");
  ok(o.empGrade(cc[0]) === 'G4', 'v774: empGrade だけは G4 → 2つの判定が食い違っていた');

  /* title が GRADE_TITLES に載っていれば v774 でも救われる。
     つまり myGradeKey の欠落は「title が未設定・未登録のとき」に効く安全網。 */
  const o2 = build(OLD, { role: 'chef', realRole: 'chef' });
  ok(o2.myGradeKey() === 'G4', "v774: title:'Head Chef' なら G4（title があれば表面化しない）");
}

console.log('\n===== テスト2: 症状再現（本部スタッフから消える） =====');
{
  const o = build(OLD, {});
  const names = o.officeMembers().map(e => e.name);
  ok(names.indexOf('Chikayoshi Nishihara') < 0, 'v774: chef は officeMembers に入らない');
  ok(typeof o.hqStaffMembers !== 'function', 'v774: 本部スタッフを表す集合が無い');
  ok(names.indexOf('Marcia Kodama') >= 0 && names.indexOf('Akane Yoshizawa') >= 0, 'v774: 経理・事務は入っている');
}

console.log('\n===== テスト3: 症状再現（perms が crew に落ちる） =====');
{
  const o = build(OLD, {});
  ok(o.permFromRole('chef') === 'crew', "v774: permFromRole('chef') が 'crew'（ROLE_TO_PERM に未定義）");
  ok(o.permFromRole('g4') === 'manager', 'v774: 同じG4の g4 は manager');
}

console.log('\n===== テスト4: v775 の判定 =====');
{
  const n = build(SRC, { role: 'chef', realRole: 'chef' });
  ok(n.myGradeKey() === 'G4', 'chef は G4 と判定される');
  ok(n.permFromRole('chef') === 'manager', "permFromRole('chef') が 'manager'");
  const hq = n.hqStaffMembers().map(e => e.name);
  ok(hq.indexOf('Chikayoshi Nishihara') >= 0, '本部スタッフに含まれる（勤怠・給与の対象）');
  ok(hq.indexOf('Marcia Kodama') >= 0 && hq.indexOf('Akane Yoshizawa') >= 0, '経理・事務も含まれる');
  ok(hq.indexOf('Retired Person') < 0, '退職者は除外される');
  ok(hq.indexOf('Some Crew') < 0, '店舗Crewは含まれない');

  const cc = [{ id: 'imp4', name: 'Chikayoshi Nishihara', role: 'chef', status: '在籍', title: 'CC' }];
  ok(build(SRC, { role: 'chef', realRole: 'chef', emps: cc }).myGradeKey() === 'G4',
    "title が 'CC' のままでも role から G4 になる");
}

console.log('\n===== テスト5: 経理側の名簿は変えていない =====');
{
  const n = build(SRC, {});
  const om = n.officeMembers().map(e => e.name);
  ok(om.indexOf('Chikayoshi Nishihara') < 0, 'officeMembers は従来どおり chef を含まない');
  ok(om.length === 2, '経理・事務の2名のまま（経理画面の見え方は変わらない）');
  ok(SRC.indexOf("  var mem = officeMembers();") >= 0, '経理画面(Officeメンバー早見)は officeMembers のまま');
  ok((SRC.match(/hqStaffMembers\(\)/g) || []).length === 7,
    '本部スタッフへ切り替えたのは当日ボード・勤怠・メンバー・給与の6箇所＋定義');
}

console.log('\n===== テスト6: 表示ラベル =====');
{
  const n = build(SRC, {});
  ok(n.officeRoleLabel({ role: 'chef' }) === 'Chef', 'chef は Chef');
  ok(n.officeRoleLabel({ role: 'office' }) === '経理', 'office は 経理');
  ok(n.officeRoleLabel({ role: 'office_crew' }) === '事務Crew', 'office_crew は 事務Crew');
  ok((SRC.match(/e\.role==='office'\?'経理':'事務Crew'/g) || []).length === 0,
    '直書きのラベル判定が残っていない');
  ok(OLD.indexOf("role:(e.role==='office'?'経理':'事務')") >= 0 &&
    SRC.indexOf("role:(e.role==='office'?'経理':'事務')") < 0,
    '給与明細のラベルもヘルパへ寄せた');
}

console.log('\n===== テスト7: 打刻の対象 =====');
{
  ok(SRC.indexOf("me.role==='office'||me.role==='office_crew'||me.role==='chef'") >= 0,
    '本部勤怠の打刻カードが chef にも出る');
  ok(OLD.indexOf("me.role==='office'||me.role==='office_crew'||me.role==='chef'") < 0,
    'v774 では出なかった');
}

console.log('\n===== テスト8: シードの Corporate Chef =====');
{
  const line = SRC.split('\r\n').filter(l => l.indexOf("name:'Chikayoshi Nishihara'") >= 0)[0] || '';
  ok(line.indexOf("role:'chef'") >= 0, "シードの role が 'chef'");
  ok(line.indexOf("title:'Head Chef'") >= 0, "title が 'Head Chef'");
  ok(line.indexOf("perms:'manager'") >= 0, "perms が 'manager'");
  const n = build(SRC, {});
  ok(n.gradeOf('Head Chef') === 'G4', 'Head Chef は GRADE_TITLES で G4');
  ok(n.gradeOf('Corporate Chef') === 'G5', 'Corporate Chef は G5 なので G4昇格には使わない');
  ok(n.gradeOf('CC') === '', "'CC' はどのグレードにも一致しない（旧設定は無等級だった）");
}

console.log('\n===== テスト9: ログイン候補とページ許可 =====');
{
  ok(/\['ceo','gm','am','office','chef','office_crew'\]/.test(SRC), '本部ログインの候補に chef が入っている');
  const cg = SRC.slice(SRC.indexOf('const CHEF_GROUPS'), SRC.indexOf('/* Crew専用'));
  const pages = [...new Set([...cg.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    .filter(p => ['gc_home', 'gc_food', 'gc_cost', 'gc_my'].indexOf(p) < 0))];
  const oi = SRC.indexOf('OFFICE_OK_PAGES');
  const okp = SRC.slice(oi, SRC.indexOf('];', oi));
  const miss = pages.filter(p => okp.indexOf("'" + p + "'") < 0);
  ok(pages.length >= 14, 'キッチン管理のページを ' + pages.length + '件 検出');
  ok(miss.length === 0, 'すべて OFFICE_OK_PAGES にある（本部ログインで開ける）' + (miss.length ? '：' + miss.join(',') : ''));
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
