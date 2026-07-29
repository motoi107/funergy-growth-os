/* verify_v789.js — 並び順でブランドをまとめる（@Totoya）
   修正前(v788)の症状の再現つき。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v788_backup.html', 'utf8');

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
    ${grab(text, '_storeOrderIdx')}
    ${grab(text, 'sortByLoginOrder')}
    return sortByLoginOrder;
  `)();
}

const BASE = [
  { id: 'F03-G', name: 'Waikiki Garlic Shack', brand: 'Garlic Shack' },
  { id: 'F06', name: 'LaLa', brand: 'LaLa' },
  { id: 'F01', name: 'ToriTon', brand: 'ToriTon' },
  { id: 'F04-P', name: 'Piikoi', brand: 'Totoya' },
  { id: 'F05', name: 'Marujuu', brand: 'Marujuu' },
  { id: 'F02', name: 'Tenkichi', brand: 'Tenkichi' },
  { id: 'F04-A', name: 'Aiea', brand: 'Totoya' },
  { id: 'F03', name: 'Waikiki Five Star Poke', brand: 'Five Star Poke' },
  { id: 'F04-K', name: 'Kaimuki', brand: 'Totoya' }
];
const WANT9 = ['ToriTon', 'Tenkichi', 'Kaimuki', 'Piikoi', 'Aiea', 'Marujuu', 'LaLa',
  'Waikiki Five Star Poke', 'Waikiki Garlic Shack'];

console.log('\n=== v789: 並び順で Totoya をまとめる ===\n');

/* ---------- 1. 修正前(v788)の症状の再現 ---------- */
console.log('[1] 修正前の症状（店名が違うと Totoya の位置に入らない）');
{
  const old = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(prev)[1];
  ok(old.indexOf('@Totoya') < 0, 'v788 にブランドでまとめる指定は無い', old);
  /* 店名が 'Kapolei' でない Totoya の新店（例: Ewa Beach） */
  const s = BASE.concat([{ id: 'F08', name: 'Ewa Beach', brand: 'Totoya' }]);
  const got = sorter(prev)(s).map(x => x.name);
  ok(got[got.length - 1] === 'Ewa Beach', 'v788: 名前が違う Totoya の新店は末尾に回った', got);
}

/* ---------- 2. ブランドでまとまる ---------- */
console.log('\n[2] ブランドでまとまる');
{
  const sort = sorter(src);
  const kap = { id: 'F07', name: 'Kapolei', brand: 'Totoya' };
  const got = sort(BASE.concat([kap])).map(x => x.name);
  ok(got[got.indexOf('Aiea') + 1] === 'Kapolei', 'Kapolei は Aiea の直後', got);
  ok(got[got.indexOf('Kapolei') + 1] === 'Marujuu', 'Kapolei の次は Marujuu');

  /* 店名も店舗IDも並びに書いていない Totoya の新店 */
  const ewa = { id: 'F08', name: 'Ewa Beach', brand: 'Totoya' };
  const got2 = sort(BASE.concat([ewa])).map(x => x.name);
  ok(got2[got2.indexOf('Aiea') + 1] === 'Ewa Beach',
    '並びに書いていない Totoya の新店も Aiea の直後に入る', got2);
  ok(got2[got2.indexOf('Ewa Beach') + 1] === 'Marujuu', 'その次は Marujuu');

  /* Totoya が2店増えても Totoya の塊から出ない */
  const got3 = sort(BASE.concat([kap, ewa])).map(x => x.name);
  const totoyaBlock = got3.slice(got3.indexOf('Kaimuki'), got3.indexOf('Marujuu'));
  ok(JSON.stringify(totoyaBlock) === JSON.stringify(['Kaimuki', 'Piikoi', 'Aiea', 'Kapolei', 'Ewa Beach']),
    'Totoya の店舗が5店でも1つの塊にまとまる', totoyaBlock);
  ok(got3.indexOf('Marujuu') === got3.indexOf('Ewa Beach') + 1, '塊の直後が Marujuu');
}

/* ---------- 3. ブランド未設定でも Kapolei は位置を保つ ---------- */
console.log('\n[3] ブランドをまだ Totoya にしていない場合');
{
  const sort = sorter(src);
  const got = sort(BASE.concat([{ id: 'F07', name: 'Kapolei', brand: 'Kapolei' }])).map(x => x.name);
  ok(got[got.indexOf('Aiea') + 1] === 'Kapolei',
    '店名の指定が残っているので Aiea の直後のまま', got);
  ok(got[got.indexOf('Kapolei') + 1] === 'Marujuu', 'その次は Marujuu');
}

/* ---------- 4. 既存店の並びを変えていない ---------- */
console.log('\n[4] 既存店の並びを変えていない');
{
  const before = sorter(prev)(BASE).map(x => x.id);
  const after = sorter(src)(BASE).map(x => x.id);
  ok(JSON.stringify(before) === JSON.stringify(after), '9店舗の並びは v788 と完全に同じ',
    { before: before, after: after });
  ok(JSON.stringify(sorter(src)(BASE).map(x => x.name)) === JSON.stringify(WANT9),
    'ToriTon→Tenkichi→Kaimuki→Piikoi→Aiea→Marujuu→LaLa→FSP→WGS');
}

/* ---------- 5. @ 指定の性質 ---------- */
console.log('\n[5] @ 指定の性質');
{
  const sort = sorter(src);
  /* 既存3店は店舗IDで先に一致するので @Totoya には落ちない＝順序が崩れない */
  const got = sort([{ id: 'F04-A', name: 'Aiea', brand: 'Totoya' }, { id: 'F04-K', name: 'Kaimuki', brand: 'Totoya' }]).map(x => x.id);
  ok(JSON.stringify(got) === JSON.stringify(['F04-K', 'F04-A']), '明示したIDが @ より優先される', got);

  /* @Totoya は完全一致。ただし並びには 'Kapolei' の指定も残っているので、
     そこに部分一致する名前・ブランドは Totoya の位置に入る。
     並び順は緩く、機能の判定（isTotoyaStore）は厳密、という住み分け。 */
  [['totoya', true, '@Totoya に完全一致'],
  ['  Totoya ', true, '前後の空白は無視'],
  ['TOTOYA', true, '大文字小文字は無視'],
  ['Totoya Kapolei', true, "'Kapolei' の指定に部分一致するため塊の位置に入る"],
  ['Totoyaa', false, '似ているだけでは入らない'],
  ['とと家', false, '別表記は入らない'],
  ['', false, 'ブランド未設定は入らない']].forEach(([b, want, why]) => {
    const r = sort([{ id: 'F05', name: 'Marujuu', brand: 'Marujuu' }, { id: 'F09', name: 'X', brand: b }]);
    const isTotoyaSlot = r[0].id === 'F09';
    ok(isTotoyaSlot === want, 'brand="' + b + '" → ' + (want ? 'Marujuuより前' : 'Marujuuより後ろ') + '（' + why + '）');
  });

  /* 並び順と機能判定は別物であることを明示しておく */
  const isT = new Function(`
    var STORES = [{id:'F09', name:'X', brand:'Totoya Kapolei'}];
    var TOTOYA_STORE_IDS = ['F04-K','F04-P','F04-A'];
    ${grab(src, 'isTotoyaStore')}
    return isTotoyaStore;
  `)();
  ok(isT('F09') === false,
    'brand="Totoya Kapolei" は並びでは Totoya の位置だが、機能上は Totoya ではない（v788の判定は完全一致）');

  ok(sort([{ id: 'F09', name: '@Totoya' }])[0].id === 'F09', '店名が "@Totoya" でも落ちない');
}

/* ---------- 6. 並べ替えの性質 ---------- */
console.log('\n[6] 並べ替えの性質');
{
  const sort = sorter(src);
  ok(JSON.stringify(sort([])) === '[]', '空配列でも落ちない');
  ok(JSON.stringify(sort(null)) === '[]', 'null でも落ちない');
  ok(sort([null, { id: 'F01' }]).length === 2, '要素が null でも落ちない');
  ok(sort([{ id: 'F04-K' }])[0].id === 'F04-K', 'name/brand が無くても落ちない');
  const input = BASE.slice(); const copy = JSON.stringify(input);
  sort(input);
  ok(JSON.stringify(input) === copy, '引数の配列を書き換えない');
  const two = sort([{ id: 'A', name: 'あ', brand: 'Totoya' }, { id: 'B', name: 'い', brand: 'Totoya' }]).map(x => x.id);
  ok(JSON.stringify(two) === JSON.stringify(['A', 'B']),
    '同じ塊の中は登録順を保つ（安定ソート）', two);
}

/* ---------- 7. 定義 ---------- */
console.log('\n[7] 定義');
{
  const arr = new Function('return ' + /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(src)[1] + ';')();
  ok(JSON.stringify(arr) === JSON.stringify(
    ['F01', 'F02', 'F04-K', 'F04-P', 'F04-A', '@Totoya', 'Kapolei', 'F05', 'F06', 'F03', 'F03-G']),
    'LOGIN_STORE_ORDER の中身', arr);
  ok(arr.indexOf('@Totoya') === arr.indexOf('F04-A') + 1, '@Totoya は Aiea の直後');
  ok(arr.indexOf('F05') > arr.indexOf('@Totoya'), 'Marujuu は Totoya の塊より後ろ');
  ok(new Set(arr).size === arr.length, '重複が無い');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
