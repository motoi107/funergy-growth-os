/* verify_v866.js — スキル評価を G1〜G6 全員・店舗ごとに

   Motoさん依頼：
     ① マイページの旧「スキル進捗」を外す（v865 で調べた結論の②）
     ② G1〜G6 すべてのスタッフが配属店（応援先を含む）に出て、評価できる
     ③ 複数店舗で働く人は、店舗ごとのスキルレベルを出す

   ① 旧「スキル進捗」は 8項目（EVAL_CRITERIA）を evalSeed から読んでいた。
      唯一の書き込み元である評価入力画面がページ切替に登録されておらず到達できないため、
      中身は step から機械的に作った仮の数字でしかなかった。
      スキルの実態は Skill Level（店舗別）が持っているので、二重表示をやめる。
      これで evalSeed は生きている画面から呼ばれなくなる。

   ② v865 では ['g4','sl','g2','crew'] まで広げたが、G5(am) と G6(gm) が残っていた。
      chef（コーポレートシェフ）も同様。office / office_crew / ceo は Office 側なので入れない。

   ③ 「この人はこの店舗の人か」を画面ごとに書き写すと v865 と同じ取りこぼしが再発する。
      empStoresOf() の1か所に集約し、3つのビューとマイページが全部これを使う。
      AM の管轄は店舗マスターの am 欄が正（v799 の決定）なので amStoresOf を通す。
      store='ALL' / GM / chef は全店。

   ★ renderPGD は依存が多すぎて丸ごと動かすとハーネスが製品より複雑になる。
     ここだけは構造で見張り、動作はハーネスで足りる empStoresOf と
     renderSkillStaffView で見る。

   守るのは7つ。
   ① G1〜G6 が店舗スタッフ、Office と CEO は違う
   ② 配属店・応援先・AMの管轄・全店（ALL/GM/chef）が正しく並ぶ
   ③ 3つのビューとマイページが同じ判定を使い、書き写しが残っていない
   ④ 複数店舗の人は店舗ごとに出る
   ⑤ マイページから旧「スキル進捗」が消え、evalSeed が生きた画面から外れた
   ⑥ マイページのポジションは店舗別の記録を読む
   ⑦ staffForStore / visibleStaffForManager / amStoresOf を1バイトも変えていない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v866_backup.html')
  ? fs.readFileSync('index_v866_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v865_backup.html', 'utf8');
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
function code(text, name) { return grab(text, name).replace(/\/\*[\s\S]*?\*\//g, ''); }
function gvar(text, decl) { const i = text.indexOf(decl); return text.slice(i, text.indexOf(';', i) + 1); }
function unchangedIn(n) { try { return grab(src, n) === grab(prev, n); } catch (e) { return false; } }

const STORES = [
  { id: 'F04-P', name: 'Piikoi', color: '#0E78C4', am: 'Yuki', active: true },
  { id: 'F04-K', name: 'Kaimuki', color: '#1E9B6B', am: 'Yuki', active: true },
  { id: 'F01', name: 'ToriTon', color: '#E2571E', am: 'Eri', active: true },
  { id: 'F09', name: 'Closed', color: '#999', am: '', active: false }
];
function env(F) {
  return new Function('F', `
    var window = {};
    var curRole = F.curRole || 'gm', curStore = 'ALL', curUserName = 'ME';
    var STORES = F.stores;
    function getStoresAll(){ return F.stores; }
    function amStoresOf(nm){ return F.stores.filter(function(s){ return s.am === nm; }).map(function(s){ return s.id; }); }
    function getEmployees(){ return F.emps; }
    function myAmStores(){ return []; }
    function getVisibleStores(){ return F.stores; }
    function skillStoreListUI(){ return F.stores; }
    function bStoreChips(){ return '<!--chips-->'; }
    function escapeHtml(s){ return String(s == null ? '' : s); }
    function t(ja, en){ return ja; }
    function posLabel(p){ return p; }
    function effectiveTipRate(){ return 100; }
    function skillScoreStore(){ return { total: 0, lv3: 0 }; }
    function approvedPositionsStore(){ return []; }
    function checkLevelUpEligibility(){ return null; }
    function skillLevelListHtml(){ return ''; }
    function nextSkillSuggestions(){ return []; }
    function skillRadarForStore(){ return ''; }
    function skillEvalSectionHtml(){ return ''; }
    ${gvar(src, 'var STORE_STAFF_ROLES')}
    ${grab(src, 'isStoreStaff')} ${grab(src, 'empStoresOf')} ${grab(src, 'empWorksAt')}
    ${grab(src, 'visibleStaffForManager')} ${grab(src, 'renderSkillStaffView')}
    if (F.sel) window._skillStaffStore = F.sel;
    return { is:isStoreStaff, stores:empStoresOf, at:empWorksAt, view:renderSkillStaffView };
  `)(F);
}
function baseF(sel) {
  return {
    stores: STORES, sel: sel || 'F04-P', curRole: 'gm',
    emps: [
      { name: 'Ichiro', role: 'crew', store: 'F04-P' },                        /* G1 */
      { name: 'Jiro',   role: 'g2',   store: 'F04-P' },                        /* G2 */
      { name: 'Saburo', role: 'sl',   store: 'F04-P' },                        /* G3 */
      { name: 'Shiro',  role: 'g4',   store: 'F04-P' },                        /* G4 */
      { name: 'Yuki',   role: 'am',   store: 'ALL' },                          /* G5 */
      { name: 'Moto',   role: 'gm',   store: 'ALL' },                          /* G6 */
      { name: 'Chika',  role: 'chef', store: 'ALL' },                          /* G4 コーポレート */
      { name: 'Rokuro', role: 'crew', store: 'F04-K', support: ['F04-P'] },    /* 応援 */
      { name: 'Nanako', role: 'crew', store: 'F01' },                          /* 他店 */
      { name: 'Yameta', role: 'g2',   store: 'F04-P', status: '退職' },
      { name: 'Jimu',   role: 'office', store: 'ALL' },
      { name: 'Shacho', role: 'ceo',  store: 'ALL' }
    ]
  };
}

console.log('\n[1] ① G1〜G6 が対象');
{
  const E = env(baseF());
  [['crew', 'G1'], ['g2', 'G2'], ['sl', 'G3'], ['g4', 'G4'], ['chef', 'G4コーポレート'],
   ['am', 'G5'], ['gm', 'G6']].forEach(function (r) {
    ok(E.is({ role: r[0] }) === true, r[1] + '（' + r[0] + '）が対象');
  });
  ['office', 'office_crew', 'ceo'].forEach(function (r) {
    ok(E.is({ role: r }) === false, r + ' は店舗側の対象にしない');
  });
}

console.log('\n[2] ② 所属店舗の並べ方');
{
  const E = env(baseF());
  ok(JSON.stringify(E.stores({ role: 'crew', store: 'F04-P' })) === '["F04-P"]', '配属店だけ');
  ok(JSON.stringify(E.stores({ role: 'crew', store: 'F04-K', support: ['F04-P'] })) === '["F04-K","F04-P"]',
    '配属店＋応援先', E.stores({ role: 'crew', store: 'F04-K', support: ['F04-P'] }));
  const am = E.stores({ role: 'am', name: 'Yuki', store: 'ALL' });
  ok(am.indexOf('F04-P') >= 0 && am.indexOf('F04-K') >= 0, 'AM は管轄店舗が入る（店舗マスターの am 欄）', am);
  const gm = E.stores({ role: 'gm', name: 'Moto', store: 'ALL' });
  ok(gm.length === 3 && gm.indexOf('F01') >= 0, 'GM は営業中の全店', gm);
  ok(gm.indexOf('F09') < 0, '閉店した店舗は入れない', gm);
  ok(E.stores({ role: 'chef', name: 'Chika', store: 'ALL' }).length === 3, 'コーポレートシェフも全店');
  ok(E.stores({ role: 'crew', store: 'ALL' }).indexOf('ALL') < 0, '出力に ALL を混ぜない');
  ok(E.stores({ role: 'office', store: 'OFFICE' }).indexOf('OFFICE') < 0, '出力に OFFICE を混ぜない');
  const dup = E.stores({ role: 'crew', store: 'F04-P', support: ['F04-P', 'F04-K'] });
  ok(dup.length === 2, '同じ店舗が二重に入らない', dup);
  ok(E.stores(null).length === 0, '空でも落ちない');
  /* empWorksAt は empStoresOf と必ず一致する */
  ok(E.at({ role: 'am', name: 'Yuki', store: 'ALL' }, 'F04-K') === true, 'AM は管轄店舗に居る扱い');
  ok(E.at({ role: 'crew', store: 'F01' }, 'F04-P') === false, '他店の人は居ない扱い');
}

console.log('\n[3] ③ 3つのビューが同じ判定を使う');
{
  ok(/empWorksAt\(e, mgrStoreId\)/.test(code(src, 'renderSkillManager')), '店舗別マトリクス');
  ok(/empWorksAt\(e, storeId\)/.test(code(src, 'renderSkillPositionView')), 'ポジション別');
  const sv = code(src, 'renderSkillStaffView');
  ok(/empWorksAt\(e, selStore\)/.test(sv), '従業員別の絞り込み');
  ok(/empStoresOf\(e\)/.test(sv), '従業員別の店舗一覧');
  ok(!/\(e\.support\|\|\[\]\)\.includes\(/.test(sv + code(src, 'renderSkillManager') + code(src, 'renderSkillPositionView')),
    'スキル画面に所属判定の書き写しが残っていない');
  ok(/empStoresOf\(emp\)/.test(code(src, 'renderPGD')), 'マイページも同じ判定を使う');
}

console.log('\n[4] ②③ 実際に全員・店舗ごとに出る');
{
  const h = env(baseF('F04-P')).view();
  ['Ichiro', 'Jiro', 'Saburo', 'Shiro'].forEach(function (nm) {
    ok(new RegExp(nm).test(h), nm + ' が Piikoi に出る');
  });
  ok(/Yuki/.test(h), 'AM（G5）が管轄の Piikoi に出る');
  ok(/Moto/.test(h), 'GM（G6）が Piikoi に出る');
  ok(/Chika/.test(h), 'コーポレートシェフが Piikoi に出る');
  ok(/Rokuro/.test(h), '応援で入っている人が出る');
  ok(!/Nanako/.test(h), '他店だけの人は出ない');
  ok(!/Yameta/.test(h), '退職者は出ない');
  ok(!/Jimu/.test(h) && !/Shacho/.test(h), 'Office と CEO は出ない');

  /* 複数店舗の人は店舗ごとにセクションが出る */
  const all = env(baseF('ALL')).view();
  const rok = all.slice(all.indexOf('Rokuro'), all.indexOf('Shiro') > all.indexOf('Rokuro')
    ? all.indexOf('Shiro') : all.length);
  ok(/Kaimuki/.test(rok) && /Piikoi/.test(rok), '応援の人は配属店と応援先の両方が出る');
  const moto = all.slice(all.indexOf('>Moto') >= 0 ? all.indexOf('>Moto') : all.indexOf('Moto'));
  ok((moto.match(/Piikoi|Kaimuki|ToriTon/g) || []).length >= 3, 'GM は3店ぶんのスキルが出る',
    (moto.match(/Piikoi|Kaimuki|ToriTon/g) || []).length);
  /* 店舗を選んだときは、その店舗ぶんだけ */
  const one = env(baseF('F04-P')).view();
  const m1 = one.slice(one.indexOf('Moto'));
  ok(!/Kaimuki/.test(m1.slice(0, m1.indexOf('Rokuro') > 0 ? m1.indexOf('Rokuro') : m1.length)),
    '店舗を選んだら選んだ店舗だけ出る');
}

console.log('\n[5] ①⑤ マイページから旧「スキル進捗」を外した');
{
  const pgd = code(src, 'renderPGD');
  ok(!/evalSeed/.test(pgd), 'renderPGD が evalSeed を読まない');
  ok(!/skillRate/.test(pgd) && !/skillItems/.test(pgd), '達成率の計算が消えている');
  ok(!/スキル進捗/.test(pgd), '「スキル進捗」のカードが消えている');
  ok(!/EVAL_CRITERIA/.test(pgd), '8項目（EVAL_CRITERIA）を読まない');
  /* evalSeed が生きている画面から呼ばれていないこと */
  const callers = ['renderEvaluation', 'openEvalModal', 'saveEval', 'approveEval'];
  const hits = [...src.matchAll(/evalSeed\(\)/g)].length;
  ok(hits === callers.length + 1, 'evalSeed の呼び出しは到達できない4関数と定義だけ', hits);
  ok(!/case 'evaluation'/.test(src), '評価入力画面は今も到達できないまま（触っていない）');
  /* 評価履歴（別キー）は残す */
  ok(/eval_history/.test(pgd), '評価履歴（eval_history）は残っている');
}

console.log('\n[6] ③⑥ マイページも店舗ごと');
{
  const pgd = code(src, 'renderPGD');
  ok(/_pgStores\.forEach/.test(pgd), '働く店舗ぶんだけ繰り返す');
  ok(/getEmpSkillsStore\(empName, _sid\)/.test(pgd), '店舗別の記録を読む');
  ok(!/getEmpSkills\(empName\)/.test(pgd), '店舗を無視する読み方が残っていない');
  ok(!/emp\.store==='ALL'\?STORES\[0\]\.id/.test(pgd), '「ALL なら先頭店舗」の決め打ちが残っていない');
  ok(/getStorePositions\(_sid\)/.test(pgd), 'ポジションもその店舗のものを使う');
  ok(/_pgStores = \[STORES\[0\]\.id\]/.test(pgd), '店舗が1つも無い人でも空にならない');
}

console.log('\n[7] 触っていないもの');
{
  ok(unchangedIn('staffForStore'), 'staffForStore を1バイトも変えていない');
  ok(unchangedIn('visibleStaffForManager'), 'visibleStaffForManager を1バイトも変えていない');
  ok(unchangedIn('amStoresOf'), 'amStoresOf を1バイトも変えていない（AMの管轄）');
  ok(unchangedIn('myAmStores'), 'myAmStores を1バイトも変えていない');
  ok(unchangedIn('empGrade'), 'empGrade を1バイトも変えていない');
  ok(unchangedIn('getEmpSkillsStore'), 'getEmpSkillsStore を1バイトも変えていない');
  ok(unchangedIn('skillScoreStore'), 'skillScoreStore を1バイトも変えていない');
  ok(unchangedIn('evalSeed'), 'evalSeed 自体は残してある（消すのは別の判断）');
  ok(unchangedIn('p4StaffWeekHtml'), 'v864 の週間表を1バイトも変えていない');
  ok(unchangedIn('mdSalesChartHtml'), 'v863 の売上グラフを1バイトも変えていない');
}

console.log('\n[8] ビルド');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(sw === av, 'SW_BUILD も同じ', { APP_VERSION: av, SW_BUILD: sw });
  }
}

console.log('\nPASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
