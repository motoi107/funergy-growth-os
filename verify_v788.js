/* verify_v788.js — Totoya判定を店舗IDの直書きからブランドへ
   修正前(v787)の症状の再現つき。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v787_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}

/* Kapolei は店舗IDが分からない前提。ブランドだけが Totoya。 */
const STORES_MOCK = [
  { id: 'F01', name: 'ToriTon', brand: 'ToriTon' },
  { id: 'F02', name: 'Tenkichi', brand: 'Tenkichi' },
  { id: 'F03', name: 'Waikiki Five Star Poke', brand: 'Five Star Poke' },
  { id: 'F03-G', name: 'Waikiki Garlic Shack', brand: 'Garlic Shack' },
  { id: 'F04-K', name: 'Kaimuki', brand: 'Totoya' },
  { id: 'F04-P', name: 'Piikoi', brand: 'Totoya' },
  { id: 'F04-A', name: 'Aiea', brand: 'Totoya' },
  { id: 'F05', name: 'Marujuu', brand: 'Marujuu' },
  { id: 'F06', name: 'LaLa', brand: 'LaLa' },
  { id: 'F07', name: 'Kapolei', brand: 'Totoya' }
];

function env(text, stores) {
  const hasIds = text.indexOf('function totoyaStoreIds(') >= 0;
  return new Function(`
    var STORES = ${JSON.stringify(stores === undefined ? STORES_MOCK : stores)};
    var TOTOYA_STORE_IDS = ['F04-K','F04-P','F04-A'];
    ${hasIds ? grab(text, 'totoyaStoreIds') : 'function totoyaStoreIds(){ return TOTOYA_STORE_IDS.slice(); }'}
    ${grab(text, 'isTotoyaStore')}
    ${grab(text, 'recipeOwnerKey')}
    ${grab(text, 'recipeInStore')}
    return { isTotoya:isTotoyaStore, ids:totoyaStoreIds, owner:recipeOwnerKey, inStore:recipeInStore };
  `)();
}

console.log('\n=== v788: Totoya判定をブランドで行う ===\n');

/* ---------- 1. 修正前(v787)の症状の再現 ---------- */
console.log('[1] 修正前の症状（Kapolei が Totoya の仲間に入らない）');
{
  const e = env(prev);
  ok(e.isTotoya('F04-K') === true, 'v787: Kaimuki は Totoya');
  ok(e.isTotoya('F07') === false, 'v787: Kapolei は Totoya と判定されなかった', e.isTotoya('F07'));
  ok(e.owner('F07') === 'F07', 'v787: 食材・レシピが Totoya と共有されなかった', e.owner('F07'));
  ok(e.inStore({ storeId: 'TOTOYA' }, 'F07') === false, 'v787: Totoya共通レシピが適用されなかった');
}

/* ---------- 2. ブランドで判定できる ---------- */
console.log('\n[2] ブランドで判定できる');
{
  const e = env(src);
  ok(e.isTotoya('F07') === true, 'Kapolei（brand=Totoya）は Totoya と判定される');
  ok(e.owner('F07') === 'TOTOYA', '食材とレシピが Totoya 3店と共有される', e.owner('F07'));
  ok(e.inStore({ storeId: 'TOTOYA' }, 'F07') === true, 'Totoya共通レシピが Kapolei にも適用される');
  ok(JSON.stringify(e.ids()) === JSON.stringify(['F04-K', 'F04-P', 'F04-A', 'F07']),
    'totoyaStoreIds() に Kapolei が入る', e.ids());
}

/* ---------- 3. 既存店の判定を変えていない ---------- */
console.log('\n[3] 既存店の判定を変えていない');
{
  const before = env(prev), after = env(src);
  ['F01', 'F02', 'F03', 'F03-G', 'F04-K', 'F04-P', 'F04-A', 'F05', 'F06'].forEach(id => {
    ok(before.isTotoya(id) === after.isTotoya(id),
      id + ' の判定は v787 と同じ（' + after.isTotoya(id) + '）');
    ok(before.owner(id) === after.owner(id), id + ' の食材オーナーも同じ（' + after.owner(id) + '）');
  });
}

/* ---------- 4. ブランドの書き方の揺れ ---------- */
console.log('\n[4] ブランドの書き方の揺れ');
{
  [['Totoya', true], ['totoya', true], ['TOTOYA', true], ['  Totoya  ', true],
  ['Totoya Kapolei', false], ['とと家', false], ['', false]].forEach(([b, want]) => {
    const e = env(src, [{ id: 'F07', name: 'Kapolei', brand: b }]);
    ok(e.isTotoya('F07') === want,
      'brand="' + b + '" → ' + (want ? 'Totoya' : 'Totoyaではない'), e.isTotoya('F07'));
  });
}

/* ---------- 5. 壊れた入力に耐える ---------- */
console.log('\n[5] 壊れた入力に耐える');
{
  const e = env(src);
  ok(e.isTotoya('') === false, '空文字は false');
  ok(e.isTotoya(null) === false, 'null は false');
  ok(e.isTotoya(undefined) === false, 'undefined は false');
  ok(e.isTotoya('ALL') === false, "'ALL' は false");
  ok(e.isTotoya('OFFICE') === false, "'OFFICE' は false");
  ok(e.isTotoya('F99') === false, '未登録のIDは false');

  const e2 = env(src, [null, { id: 'F07', brand: 'Totoya' }, {}]);
  ok(e2.isTotoya('F07') === true, '一覧に null や空の要素があっても落ちない');

  /* STORES が無い起動直後でも、既存3店だけは正しく判定できる */
  const boot = new Function(`
    var TOTOYA_STORE_IDS = ['F04-K','F04-P','F04-A'];
    ${grab(src, 'isTotoyaStore')}
    return isTotoyaStore;
  `)();
  ok(boot('F04-K') === true, 'STORES が未定義でも既存3店は Totoya と判定できる');
  ok(boot('F07') === false, 'STORES が未定義なら新店は判定できない（既定にフォールバック）');
}

/* ---------- 6. 直書きが残っていないか ---------- */
console.log('\n[6] TOTOYA_STORE_IDS の直接参照');
{
  const lines = src.split('\r\n');
  const direct = [];
  lines.forEach((l, i) => {
    if (l.indexOf('TOTOYA_STORE_IDS') < 0) return;
    if (/var TOTOYA_STORE_IDS = /.test(l)) return;                    // 定義
    if (/TOTOYA_STORE_IDS\.indexOf\(storeId\)>=0\) return true;/.test(l)) return; // isTotoyaStore の保険
    if (/out = TOTOYA_STORE_IDS\.slice\(\)/.test(l)) return;          // totoyaStoreIds の土台
    if (/^\s*\/\*|^\s*\*/.test(l)) return;                            // コメント
    direct.push((i + 1) + ': ' + l.trim().slice(0, 90));
  });
  ok(direct.length === 1, '残る直接参照は1件だけ', direct);
  ok(direct.length === 1 && /TOTOYA_STORE_IDS\.forEach/.test(direct[0]),
    'その1件は一度きりの移行処理（過去の店舗別データを TOTOYA へ統合するもの。\n'
    + '        新店には legacy データが無く、_totoyaIngMerged で実行済みなので、ここは既定のままが正しい）', direct);
  ok(/totoyaStoreIds\(\)\.forEach\(function\(sid\)/.test(src),
    '食材を使っている店舗の一覧が新関数を使う（Totoya共通の食材に新店も含まれる）');
  ok(/stores: totoyaStoreIds\(\)/.test(src), '日次食材差異の既定店舗が新関数を使う');
  ok(/totoyaStoreIds\(\)\.indexOf\(x\.storeId\)>=0/.test(src), '丼グループの判定が新関数を使う');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
