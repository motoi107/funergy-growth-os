/* v737: メニュータブの出数がクラウドから正しく反映されることを実ファイルの関数で検証 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/claude/index.html', 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got : ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

const code = [grab('recipeOwnerKey'), grab('recipeInStore'), grabAsync('loadMenuMixFromDB')].join('\n') + `
var _mix = {};
function getMenuMix(sid, p){ var k=sid+'_'+p; return _mix[k] ? JSON.parse(JSON.stringify(_mix[k])) : {}; }
function setMenuMix(sid, p, v){ _mix[sid+'_'+p] = JSON.parse(JSON.stringify(v)); }
function getRecipes(){ return _recipes; }
function isTotoyaStore(id){ return ['F04-K','F04-P','F04-A'].indexOf(id)>=0; }
function nowJP(){ return '2026/07/27 00:30'; }
async function fetchToastItemSales(guid, period){ return _sales; }
`;

const sandbox = { console, JSON, Object, Array, String, Number, parseFloat, parseInt, isFinite, Promise,
  _recipes: [], _sales: [] };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

(async function () {

console.log('== 1) 出数はクラウドのテーブルから読む（Toastに毎回つなぎに行かない） ==');
{
  eq('fetchToastItemSales は Supabase の toast_item_sales を読む',
    /toast_item_sales\?restaurant_guid=eq\./.test(src), true);
  eq('Toast APIを直接叩いていない', /toast_item_sales[\s\S]{0,200}SUPABASE_URL|SUPABASE_URL[\s\S]{0,200}toast_item_sales/.test(src), true);
}

console.log('\n== 2) 【原因】共通レシピに出数が付かなかった ==');
{
  /* Totoya共通レシピ（storeId='TOTOYA'）と全店共通（storeId=null） */
  S._recipes = [
    { id: 'r1', name: 'Ahi Bowl', toastGuid: 'G_AHI', storeId: 'TOTOYA', price: 18 },
    { id: 'r2', name: 'Miso Soup', toastGuid: 'G_MISO', storeId: null, price: 3 },
    { id: 'r3', name: 'Kaimuki Special', toastGuid: 'G_SPE', storeId: 'F04-K', price: 22 },
  ];
  S._sales = [
    { item_guid: 'G_AHI', item_name: 'Ahi Bowl', qty: 10 },
    { item_guid: 'G_MISO', item_name: 'Miso Soup', qty: 25 },
    { item_guid: 'G_SPE', item_name: 'Kaimuki Special', qty: 4 },
  ];
  S._mix = {};
  const r = await S.loadMenuMixFromDB('F04-K', 'G-K', '2026-07');
  const mix = S.getMenuMix('F04-K', '2026.7');
  eq('Totoya共通レシピに出数が付く【従来は0のまま】', mix.items.r1, 10);
  eq('全店共通レシピにも出数が付く', mix.items.r2, 25);
  eq('店舗専用レシピも従来どおり', mix.items.r3, 4);
  eq('売上合計 = 10×18 + 25×3 + 4×22', mix.sales, 10 * 18 + 25 * 3 + 4 * 22);
  eq('反映件数を返す', [r.ok, r.matched, r.rows], [true, 3, 3]);
}

console.log('\n== 3) 店舗専用を共通より優先する ==');
{
  S._recipes = [
    { id: 'c1', name: 'Bowl(共通)', toastGuid: 'G_X', storeId: 'TOTOYA', price: 10 },
    { id: 's1', name: 'Bowl(店舗版)', toastGuid: 'G_X', storeId: 'F04-P', price: 12 },
  ];
  S._sales = [{ item_guid: 'G_X', item_name: 'Bowl', qty: 7 }];
  S._mix = {};
  await S.loadMenuMixFromDB('F04-P', 'G-P', '2026-07');
  const mix = S.getMenuMix('F04-P', '2026.7');
  eq('店舗専用に付く', mix.items.s1, 7);
  eq('共通側には付かない（二重計上しない）', mix.items.c1, undefined);
}

console.log('\n== 4) 他ブランドには共通レシピが適用されない ==');
{
  S._recipes = [{ id: 'r1', name: 'Ahi Bowl', toastGuid: 'G_AHI', storeId: 'TOTOYA', price: 18 }];
  S._sales = [{ item_guid: 'G_AHI', qty: 10 }];
  S._mix = {};
  const r = await S.loadMenuMixFromDB('F01', 'G-F01', '2026-07');
  const mix = S.getMenuMix('F01', '2026.7');
  eq('ToriTonにはTotoya共通が付かない', (mix.items || {}).r1, undefined);
  eq('未紐づけとして報告される', r.unmatchedCount, 1);
}

console.log('\n== 5) 同じ商品が日別に複数行でも合計する ==');
{
  S._recipes = [{ id: 'r1', toastGuid: 'G_AHI', storeId: 'TOTOYA', price: 18 }];
  S._sales = [
    { item_guid: 'G_AHI', business_date: '2026-07-01', qty: 3 },
    { item_guid: 'G_AHI', business_date: '2026-07-02', qty: 4 },
    { item_guid: 'G_AHI', business_date: '2026-07-03', qty: 5 },
  ];
  S._mix = {};
  await S.loadMenuMixFromDB('F04-K', 'G-K', '2026-07');
  eq('日別3行を合計して12', S.getMenuMix('F04-K', '2026.7').items.r1, 12);
}

console.log('\n== 6) データが無いときは理由を返す（黙って終わらない） ==');
{
  S._sales = [];
  const r = await S.loadMenuMixFromDB('F04-K', 'G-K', '2026-07');
  eq('okはfalse', r.ok, false);
  eq('理由が入る', r.reason.indexOf('クラウドにこの月の出数がありません') >= 0, true);
  const r2 = await S.loadMenuMixFromDB('F04-K', '', '2026-07');
  eq('GUID未設定も理由を返す', r2.reason.indexOf('Toast GUID') >= 0, true);
}

console.log('\n== 7) 画面側の配線 ==');
{
  eq('メニュータブに「出数を同期」ボタンがある', src.indexOf("ensureMenuMixLoaded('${storeId}','${period}',{notify:true})") >= 0, true);
  eq('結果をトーストで知らせる', /_r\.matched\+'商品の出数を反映しました'/.test(src), true);
  eq('診断も同じ判定に揃えた', /診断だけ厳しくて/.test(src), true);
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
})();
