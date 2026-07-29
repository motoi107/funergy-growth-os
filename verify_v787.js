/* verify_v787.js — 並び順に Kapolei を追加し、店舗IDが分からない店舗を店名で並べられるようにする
   修正前(v786)の症状の再現つき。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v786_backup.html', 'utf8');

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
function sorter(text) {
  const m = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(text);
  return new Function(`
    const LOGIN_STORE_ORDER = ${m[1]};
    ${text.indexOf('function _storeOrderIdx(') >= 0 ? grab(text, '_storeOrderIdx') : ''}
    ${grab(text, 'sortByLoginOrder')}
    return sortByLoginOrder;
  `)();
}

/* 登録順はバラバラ。Kapolei の店舗IDは意図的に「分からない値」にしてある */
function mock(kapoleiName) {
  return [
    { id: 'F03-G', name: 'Waikiki Garlic Shack', brand: 'Garlic Shack' },
    { id: 'F06', name: 'LaLa', brand: 'LaLa' },
    { id: 'F01', name: 'ToriTon', brand: 'ToriTon' },
    { id: 'F04-P', name: 'Piikoi', brand: 'Totoya' },
    { id: 'F05', name: 'Marujuu', brand: 'Marujuu' },
    { id: 'F02', name: 'Tenkichi', brand: 'Tenkichi' },
    { id: 'F04-A', name: 'Aiea', brand: 'Totoya' },
    { id: 'F03', name: 'Waikiki Five Star Poke', brand: 'Five Star Poke' },
    { id: 'F04-K', name: 'Kaimuki', brand: 'Totoya' },
    { id: 'F07', name: kapoleiName, brand: 'Totoya' }
  ];
}
const WANT = ['ToriTon', 'Tenkichi', 'Kaimuki', 'Piikoi', 'Aiea', 'Kapolei', 'Marujuu', 'LaLa',
  'Waikiki Five Star Poke', 'Waikiki Garlic Shack'];

console.log('\n=== v787: Kapolei を Aiea の次へ／店名でも並べられるように ===\n');

/* ---------- 1. 修正前(v786)の症状の再現 ---------- */
console.log('[1] 修正前の症状');
{
  const old = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(prev)[1];
  ok(old.indexOf('Kapolei') < 0, 'v786 の並び順に Kapolei が無い', old);
  ok(prev.indexOf('function _storeOrderIdx(') < 0, 'v786 は店舗IDでしか照合していない');
  const got = sorter(prev)(mock('Kapolei')).map(s => s.name);
  ok(got[got.length - 1] === 'Kapolei', 'v786: Kapolei が末尾に回っていた', got);
}

/* ---------- 2. 指定どおりの並び ---------- */
console.log('\n[2] 指定どおりの並び');
{
  const got = sorter(src)(mock('Kapolei')).map(s => s.name);
  ok(JSON.stringify(got) === JSON.stringify(WANT),
    'ToriTon→Tenkichi→Kaimuki→Piikoi→Aiea→Kapolei→Marujuu→LaLa→FSP→WGS', got);
  ok(got[got.indexOf('Aiea') + 1] === 'Kapolei', 'Kapolei は Aiea の直後');
  ok(got[got.indexOf('Kapolei') + 1] === 'Marujuu', 'Kapolei の次は Marujuu');
  ok(got[got.indexOf('Marujuu') + 1] === 'LaLa', 'LaLa は Marujuu の直後');
}

/* ---------- 3. 店舗IDが分からなくても並ぶ ---------- */
console.log('\n[3] 店舗IDが分からなくても並ぶ');
{
  const sort = sorter(src);
  ['Kapolei', 'Totoya Kapolei', 'KAPOLEI', 'Kapolei店', 'ととや Kapolei'].forEach(nm => {
    const got = sort(mock(nm)).map(s => s.name);
    ok(got[got.indexOf('Aiea') + 1] === nm, '店名「' + nm + '」でも Aiea の直後に入る', got);
  });
  const byBrand = sort([{ id: 'F09', name: '新店', brand: 'Kapolei' }, { id: 'F01', name: 'ToriTon' }]).map(s => s.id);
  ok(JSON.stringify(byBrand) === JSON.stringify(['F01', 'F09']), 'ブランド名でも拾える', byBrand);

  const unrelated = sort([{ id: 'F09', name: 'まったく別の店' }, { id: 'F01', name: 'ToriTon' }]).map(s => s.id);
  ok(JSON.stringify(unrelated) === JSON.stringify(['F01', 'F09']), '該当しない店舗は従来どおり末尾');
}

/* ---------- 4. 既存店の並びを変えていない ---------- */
console.log('\n[4] 既存店の並びを変えていない');
{
  const eight = mock('Kapolei').filter(s => s.id !== 'F07');
  const before = sorter(prev)(eight).map(s => s.id);
  const after = sorter(src)(eight).map(s => s.id);
  ok(JSON.stringify(before) === JSON.stringify(after),
    'Kapolei を除いた9店舗の並びは v786 と完全に同じ', { before: before, after: after });

  /* 'F..' の項目は店名では拾わない＝IDでしか一致しないことの確認 */
  const idOnly = sorter(src)([{ id: 'F99', name: 'F01' }, { id: 'F02', name: 'Tenkichi' }]).map(s => s.id);
  ok(JSON.stringify(idOnly) === JSON.stringify(['F02', 'F99']),
    '店名が "F01" でも ID項目には一致させない（誤爆しない）', idOnly);
}

/* ---------- 5. 並べ替えの性質 ---------- */
console.log('\n[5] 並べ替えの性質');
{
  const sort = sorter(src);
  ok(JSON.stringify(sort([])) === '[]', '空配列でも落ちない');
  ok(JSON.stringify(sort(null)) === '[]', 'null でも落ちない');
  ok(sort([null, { id: 'F01' }]).length === 2, '要素が null でも落ちない');
  ok(sort([{ id: 'F01' }])[0].id === 'F01', 'name/brand が無くても落ちない');

  const input = mock('Kapolei');
  const copy = JSON.stringify(input);
  sort(input);
  ok(JSON.stringify(input) === copy, '引数の配列を書き換えない');
}

/* ---------- 6. 定義 ---------- */
console.log('\n[6] 定義');
{
  const arr = new Function('return ' + /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(src)[1] + ';')();
  /* 配列の中身をそのまま固定すると、後の版で書き方を変えただけで落ちる（v789で実際に落ちた）。
     この検証が守りたいのは「Kapolei が Aiea と Marujuu の間にあること」なので、位置関係で見る。 */
  ok(arr.indexOf('F04-A') >= 0 && arr.indexOf('F05') >= 0, 'Aiea と Marujuu が並びにある', arr);
  ok(arr.indexOf('F04-A') < arr.indexOf('F05'), 'Aiea は Marujuu より前');
  const kapIdx = arr.findIndex(function (e) { return /kapolei|@totoya/i.test(String(e)); });
  ok(kapIdx > arr.indexOf('F04-A') && kapIdx < arr.indexOf('F05'),
    'Kapolei の受け口が Aiea と Marujuu の間にある', { kapIdx: kapIdx, arr: arr });
  ok(new Set(arr).size === arr.length, '重複が無い');
  ok(/ToriTon→Tenkichi→[^）]*→FSP→WGS/.test(src),
    'コメントの並びが ToriTon で始まり WGS で終わっている');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
