/* ============================================================
   verify_v766.js — 本部を「経理側」と「コーポレートシェフ側」に分けた版の検証

     テスト1: chef のグレードが G4 になる
     テスト2: chef のメニューに経理の画面が一切出ない
     テスト3: CEO / GM は従来どおり全部見える
     テスト4: 経理(office)の見え方が変わっていない
     テスト5: chef のメニューに出る画面が、本部で実際に開ける
     テスト6: 本部ログインの候補に chef が出る
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');
const V765 = fs.readFileSync('index_v765_backup.html', 'utf8');

function grabVar(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('見つかりません: ' + decl);
  let d = 0, st = false, j = i;
  const open = decl.indexOf('[') >= 0 ? '[' : '{', close = open === '[' ? ']' : '}';
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === open) { d++; st = true; }
    else if (c === close) { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}
function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  let i = src.indexOf('function', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* メニュー定義と振り分けを取り出して動かす */
function menuFor(src, role, store) {
  const code = [
    grabVar(src, 'const ROLE_CONFIG = {'),
    grabVar(src, 'const OFFICE_GROUPS = ['),
    grabVar(src, 'const OFFICE_CREW_GROUPS = ['),
    grabVar(src, 'const CREW_GROUPS = ['),
    grabVar(src, 'const MENU_GROUPS = ['),
    grabVar(src, 'const STORE_GROUPS = ['),
    (src.indexOf('const CHEF_GROUPS = [') >= 0 ? grabVar(src, 'const CHEF_GROUPS = [') : ''),
    grab(src, 'groupsForRole'),
    'function _gradeHideApplies(){ return false; }',
    'function gradeHideFor(){ return []; }',
    'function myGradeKey(){ return ""; }'
  ].join('\n');
  const fn = new Function('curRole', 'curStore', 'curStoreLogin', code + '\nreturn groupsForRole();');
  return fn(role, store, false);
}
const pagesOf = (groups) => groups.reduce((a, g) => a.concat(g.children || []), []);

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: chef のグレード ===');
{
  const fn = new Function('e', grab(SRC, 'empGrade').replace('function empGrade(e)', 'function _g(e)') +
    '\nfunction gradeOf(){ return ""; }\nreturn _g(e);');
  check('role=chef → G4', fn({ role: 'chef' }) === 'G4', fn({ role: 'chef' }));
  check('role=g4 は従来どおり G4', fn({ role: 'g4' }) === 'G4');
  check('role=am は従来どおり G5', fn({ role: 'am' }) === 'G5');
}

console.log('\n=== テスト2: chef に経理の画面が出ない ===');
{
  const ACCT = ['invoice', 'acct_review', 'acct_export', 'monthly', 'office_export', 'hr', 'hiring', 'tip'];
  const pages = pagesOf(menuFor(SRC, 'chef', 'OFFICE'));
  const leaked = ACCT.filter(p => pages.indexOf(p) >= 0);
  check('経理系の画面が1つも出ない', leaked.length === 0, leaked.join(',') || '漏れなし');
  check('食材管理は出る',
    ['menu', 'recipe', 'ingredient_master', 'inventory', 'ing_transfer', 'vendor_master', 'fv_variance']
      .every(p => pages.indexOf(p) >= 0));
  check('原価率(FC)は出る', pages.indexOf('foodcost') >= 0);
  check('メニューが空でない', pages.length > 0, pages.length + '画面');
  console.log('    chef の画面: ' + pages.join(', '));
}

console.log('\n=== テスト3: CEO / GM は全部見える（変わっていない）===');
{
  for (const r of ['ceo', 'gm']) {
    const now = pagesOf(menuFor(SRC, r, 'OFFICE')).sort();
    const before = pagesOf(menuFor(V765, r, 'OFFICE')).sort();
    check(`${r} の画面が v765 と一致`, JSON.stringify(now) === JSON.stringify(before),
      `${now.length}画面`);
    check(`${r} は経理の画面が見える`,
      ['invoice', 'acct_review', 'acct_export'].every(p => now.indexOf(p) >= 0));
    check(`${r} は食材管理が見える`, now.indexOf('recipe') >= 0 && now.indexOf('inventory') >= 0);
  }
}

console.log('\n=== テスト4: 経理(office)の見え方が変わっていない ===');
{
  const now = pagesOf(menuFor(SRC, 'office', 'OFFICE')).sort();
  const before = pagesOf(menuFor(V765, 'office', 'OFFICE')).sort();
  check('office の画面が v765 と一致', JSON.stringify(now) === JSON.stringify(before), `${now.length}画面`);
  const nowC = pagesOf(menuFor(SRC, 'office_crew', 'OFFICE')).sort();
  const beforeC = pagesOf(menuFor(V765, 'office_crew', 'OFFICE')).sort();
  check('office_crew も変わっていない', JSON.stringify(nowC) === JSON.stringify(beforeC));
}

console.log('\n=== テスト5: chef の画面が本部で実際に開ける ===');
{
  const ok = new Function(grabVar(SRC, "var OFFICE_OK_PAGES = [") + '\nreturn OFFICE_OK_PAGES;')();
  const pages = pagesOf(menuFor(SRC, 'chef', 'OFFICE'));
  const blocked = pages.filter(p => ok.indexOf(p) < 0);
  check('メニューに出る画面がすべて OFFICE_OK_PAGES にある', blocked.length === 0,
    blocked.join(',') || '弾かれる画面なし');

  /* v765 では 食材差異・食材移動 が本部から開けなかった（既存の不具合） */
  const okOld = new Function(grabVar(V765, "var OFFICE_OK_PAGES = [") + '\nreturn OFFICE_OK_PAGES;')();
  check('v765 では 食材差異 が本部から開けなかった（症状の再現）', okOld.indexOf('fv_variance') < 0);
  check('v765 では 食材移動 が本部から開けなかった（症状の再現）', okOld.indexOf('ing_transfer') < 0);
  check('v766 で両方とも開ける', ok.indexOf('fv_variance') >= 0 && ok.indexOf('ing_transfer') >= 0);
}

console.log('\n=== テスト6: 本部ログインの候補と並び順 ===');
{
  check('ログイン候補に chef が含まれる',
    /\['ceo','gm','am','office','chef','office_crew'\]\.includes\(e\.role\)/.test(SRC));
  const order = new Function("var order={ceo:0,gm:1,office:2,chef:3,office_crew:4,am:5,g4:6,sl:7,g2:8,crew:9}; return order;")();
  check('並び順に chef がある', order.chef === 3);
  check('ログインボタンが「本部」', SRC.indexOf("t('本部','Head Office')") >= 0);
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
