/* v735: Invoice の食材/食材以外 自動判定と原価除外 を実ファイルの関数で検証 */
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
function grabVar(name) {
  const re = new RegExp('var ' + name + ' = \\[[\\s\\S]*?\\];');
  const m = src.match(re);
  if (!m) throw new Error('var not found: ' + name);
  return m[0];
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got : ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

const code = [
  grabVar('INV_NONFOOD_PURPOSES'), grabVar('INV_NONFOOD_WORDS'), grabVar('INV_FOOD_WORDS'),
  "var INV_FOOD_PURPOSE = '仕入れ・仕込み';",
  grab('_invHas'), grab('invVendorKind'), grab('invSetVendorKind'), grab('_invPastPurpose'),
  grab('invFoodLineRatio'), grab('invGuessKind'), grab('_invPurposeForWord'),
  grab('fcCostPurposes'), grab('_fcInCost'), grab('invUnclassified'),
].join('\n') + `
function ls(k,d){ return (k in _store) ? JSON.parse(JSON.stringify(_store[k])) : d; }
function lsSet(k,v){ _store[k]=JSON.parse(JSON.stringify(v)); return true; }
function getVendors(){ return ls('m_vendors', []); }
`;

const sandbox = {
  _store: { m_vendors: [], invoices: [] },
  myName: () => 'Moto', nowJP: () => '2026/07/26 23:00',
  console, JSON, Object, Array, String, Number, Math, isFinite, parseFloat, parseInt, RegExp,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

console.log('== 1) これまでの動作（用途未設定は原価に入る） ==');
{
  eq('用途が空だと原価に含まれる【これが今回の原因】', S._fcInCost(''), true);
  eq('仕入れ・仕込みは原価', S._fcInCost('仕入れ・仕込み'), true);
  eq('修繕・設備は原価外', S._fcInCost('修繕・設備'), false);
  eq('備品・消耗品は原価外', S._fcInCost('備品・消耗品'), false);
  eq('その他は原価外', S._fcInCost('その他'), false);
}

console.log('\n== 2) 明細の食材一致率で判定 ==');
{
  /* OCRが食材マスタに紐付けた行は code を持つ */
  const foodLines = [
    { name: 'AHI TUNA SAKU', code: 6034, lineTotal: 400 },
    { name: 'SALMON FILLET', code: 6022, lineTotal: 300 },
    { name: 'DELIVERY FEE', code: null, lineTotal: 20 },
  ];
  eq('食材一致率', Math.round(S.invFoodLineRatio(foodLines) * 100), 97);
  const g = S.invGuessKind('Honolulu Fish', foodLines);
  eq('食材と判定', [g.kind, g.purpose], ['food', '仕入れ・仕込み']);
  eq('根拠が出る', g.reason.indexOf('食材マスタと一致') >= 0, true);
}

console.log('\n== 3) 製氷機の修繕（今回の実例） ==');
{
  const repair = [
    { name: 'ICE MACHINE REPAIR - SERVICE CALL', code: null, lineTotal: 285 },
    { name: 'LABOR 2HR', code: null, lineTotal: 180 },
    { name: 'PARTS - WATER FILTER', code: null, lineTotal: 65 },
  ];
  eq('食材一致率は0', S.invFoodLineRatio(repair), 0);
  const g = S.invGuessKind('Island Refrigeration Service', repair);
  eq('食材以外と判定', g.kind, 'nonfood');
  eq('用途は修繕・設備', g.purpose, '修繕・設備');
  eq('原価から外れる', S._fcInCost(g.purpose), false);
  eq('根拠が出る', g.reason.length > 0, true);
}

console.log('\n== 4) 業者マスタに記憶したら次回から確定 ==');
{
  S._store.m_vendors = [];
  eq('未登録なら業者区分なし', S.invVendorKind('Aloha Plumbing'), '');
  S.invSetVendorKind('Aloha Plumbing', 'nonfood');
  eq('記憶される', S.invVendorKind('Aloha Plumbing'), 'nonfood');
  const g = S.invGuessKind('Aloha Plumbing', [{ name: 'MISC', code: null, lineTotal: 100 }]);
  eq('以後は確度highで自動判定', [g.kind, g.conf], ['nonfood', 'high']);
  eq('根拠に業者マスタと出る', g.reason.indexOf('業者マスタ') >= 0, true);
  /* 大文字小文字を無視して一致 */
  eq('表記ゆれ（大文字）でも一致', S.invVendorKind('ALOHA PLUMBING'), 'nonfood');
}

console.log('\n== 5) 同じ業者の過去実績から判定 ==');
{
  S._store.m_vendors = [];
  S._store.invoices = [
    { id: 'i1', vendor: 'Cherry', purpose: '仕入れ・仕込み' },
    { id: 'i2', vendor: 'Cherry', purpose: '仕入れ・仕込み' },
    { id: 'i3', vendor: 'Cherry', purpose: '備品・消耗品' },
  ];
  const g = S.invGuessKind('Cherry', [{ name: 'UNKNOWN ITEM', code: null, lineTotal: 50 }]);
  eq('多数決で食材', [g.kind, g.conf], ['food', 'high']);
  eq('根拠に件数が出る', g.reason.indexOf('3件中2件') >= 0, true);
  /* 1件だけでは判定しない（推測しすぎない） */
  S._store.invoices = [{ id: 'i1', vendor: 'NewVendor', purpose: '仕入れ・仕込み' }];
  eq('1件だけでは過去実績を使わない', S._invPastPurpose('NewVendor'), null);
}

console.log('\n== 6) 判定できないときは空を返す（勝手に決めない） ==');
{
  S._store.m_vendors = []; S._store.invoices = [];
  const g = S.invGuessKind('ABC Trading', [{ name: 'ITEM A', code: null, lineTotal: 100 }]);
  eq('kindは空', g.kind, '');
  eq('用途も空', g.purpose, '');
}

console.log('\n== 7) 判定の優先順位（業者マスタ > 過去実績 > 明細 > 語句） ==');
{
  S._store.m_vendors = []; S._store.invoices = [];
  const repairLines = [{ name: 'REPAIR SERVICE', code: null, lineTotal: 300 }];
  /* 明細は修繕だが、業者マスタで食材と登録されていれば業者マスタが勝つ */
  S.invSetVendorKind('Mixed Vendor', 'food');
  const g = S.invGuessKind('Mixed Vendor', repairLines);
  eq('業者マスタが最優先', [g.kind, g.conf], ['food', 'high']);
  /* 業者マスタが無く過去実績がある場合は過去実績 */
  S._store.m_vendors = [];
  S._store.invoices = [
    { id: 'x1', vendor: 'Mixed Vendor', purpose: '修繕・設備' },
    { id: 'x2', vendor: 'Mixed Vendor', purpose: '修繕・設備' },
  ];
  const g2 = S.invGuessKind('Mixed Vendor', [{ name: 'TUNA', code: 6034, lineTotal: 500 }]);
  eq('過去実績が明細より優先', [g2.kind, g2.purpose], ['nonfood', '修繕・設備']);
}

console.log('\n== 8) 用途の割り当て ==');
{
  eq('repair → 修繕・設備', S._invPurposeForWord('repair'), '修繕・設備');
  eq('ice machine → 修繕・設備', S._invPurposeForWord('ice machine'), '修繕・設備');
  eq('linen → 備品・消耗品', S._invPurposeForWord('linen'), '備品・消耗品');
  eq('清掃 → 備品・消耗品', S._invPurposeForWord('清掃'), '備品・消耗品');
  eq('subscription → その他', S._invPurposeForWord('subscription'), 'その他');
}

console.log('\n== 9) 未分類の抽出（一括分類の対象） ==');
{
  S._store.invoices = [
    { id: 'a', purpose: '', docType: 'Invoice' },
    { id: 'b', purpose: '仕入れ・仕込み', docType: 'Invoice' },
    { id: 'c', purpose: '', docType: 'Reimburse' },
    { id: 'd', purpose: '', docType: 'Invoice', deleted: true },
    { id: 'e', purpose: '   ', docType: 'Invoice' },
  ];
  eq('未分類のみ抽出（立替・削除済みは除く）', S.invUnclassified().map(v => v.id), ['a', 'e']);
}

console.log('\n== 10) 画面側の配線 ==');
{
  eq('Invoiceに「食材/食材以外」の必須欄がある', src.indexOf("name=\"inv-kind\"") >= 0, true);
  eq('Invoiceの用途に「修繕・設備」がある', /inv-purpose[\s\S]{0,400}修繕・設備/.test(src), true);
  eq('保存前に区分を必須チェック', /function invKindValidate\(\)/.test(src), true);
  eq('保存時に区分を用途へ反映', /_purpose=_kv\.purpose/.test(src), true);
  eq('業者に記憶するチェックがある', src.indexOf('inv-kind-remember') >= 0, true);
  eq('業者名の変更で判定し直す', /oninput="checkVendorRegistered\(\);invKindRefresh\(\)"/.test(src), true);
  eq('仕入明細から原価外を除外', /if \(!_fcInCost\(inv\.purpose\)\) return;/.test(src), true);
  eq('未分類の一括分類画面がある', /function openInvClassify\(\)/.test(src), true);
  eq('未分類の件数ボタンがある', src.indexOf('openInvClassify()') >= 0, true);
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
