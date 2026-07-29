/* verify_v786.js — LaLa(F06) を Marujuu の次に並べる（全画面共通の並び順）
   修正前(v785)の症状の再現つき。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v785_backup.html', 'utf8');

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
/* 実際の sortByLoginOrder を、その版の LOGIN_STORE_ORDER で動かす */
function sorter(text) {
  const m = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(text);
  if (!m) throw new Error('LOGIN_STORE_ORDER not found');
  return new Function(`
    const LOGIN_STORE_ORDER = ${m[1]};
    ${grab(text, 'sortByLoginOrder')}
    return sortByLoginOrder;
  `)();
}

/* 店舗マスターの登録順はバラバラでも並びは揃うべき */
const STORES_MOCK = [
  { id: 'F03-G', name: 'Waikiki Garlic Shack' },
  { id: 'F06', name: 'LaLa' },
  { id: 'F01', name: 'ToriTon' },
  { id: 'F04-P', name: 'Piikoi' },
  { id: 'F05', name: 'Marujuu' },
  { id: 'F02', name: 'Tenkichi' },
  { id: 'F04-A', name: 'Aiea' },
  { id: 'F03', name: 'Waikiki Five Star Poke' },
  { id: 'F04-K', name: 'Kaimuki' }
];
const EXPECT = ['F01', 'F02', 'F04-K', 'F04-P', 'F04-A', 'F05', 'F06', 'F03', 'F03-G'];

console.log('\n=== v786: LaLa(F06) を Marujuu の次へ ===\n');

/* ---------- 1. 修正前(v785)の症状の再現 ---------- */
console.log('[1] 修正前の症状（LaLa が末尾に回っていた）');
{
  const oldOrder = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(prev)[1];
  ok(oldOrder.indexOf('F06') < 0, 'v785 の並び順に F06 が無い', oldOrder);
  const got = sorter(prev)(STORES_MOCK).map(s => s.id);
  ok(got[got.length - 1] === 'F06', 'v785: LaLa が一番最後（未登録は 999 扱い）', got);
  ok(got.indexOf('F06') > got.indexOf('F03-G'), 'v785: Waikiki より後ろに出ていた');
}

/* ---------- 2. 修正後の並び ---------- */
console.log('\n[2] 修正後の並び');
{
  const got = sorter(src)(STORES_MOCK).map(s => s.id);
  ok(JSON.stringify(got) === JSON.stringify(EXPECT),
    'ToriTon→Tenkichi→Kaimuki→Piikoi→Aiea→Marujuu→LaLa→FSP→WGS', got);
  ok(got[got.indexOf('F05') + 1] === 'F06', 'LaLa は Marujuu の直後');
  ok(got[got.indexOf('F06') + 1] === 'F03', 'LaLa の次は FSP（Waikikiは従来どおり最後）');
}

/* ---------- 3. 既存店の並びを変えていない ---------- */
console.log('\n[3] 既存店の並びを変えていない');
{
  const before = sorter(prev)(STORES_MOCK.filter(s => s.id !== 'F06')).map(s => s.id);
  const after = sorter(src)(STORES_MOCK.filter(s => s.id !== 'F06')).map(s => s.id);
  ok(JSON.stringify(before) === JSON.stringify(after),
    'LaLa を除いた8店舗の並びは v785 と完全に同じ', { before: before, after: after });
}

/* ---------- 4. 並べ替えの性質 ---------- */
console.log('\n[4] 並べ替えの性質');
{
  const sort = sorter(src);
  ok(JSON.stringify(sort([]).map(s => s.id)) === '[]', '空配列でも落ちない');
  ok(JSON.stringify(sort(null)) === '[]', 'null でも落ちない');

  const one = [{ id: 'F06', name: 'LaLa' }];
  ok(sort(one)[0].id === 'F06', '1件でも動く');

  const unknown = sort([{ id: 'F99' }, { id: 'F06' }, { id: 'F01' }]).map(s => s.id);
  ok(JSON.stringify(unknown) === JSON.stringify(['F01', 'F06', 'F99']),
    '未登録のIDは従来どおり末尾', unknown);

  const input = STORES_MOCK.slice();
  const copy = JSON.stringify(input);
  sort(input);
  ok(JSON.stringify(input) === copy, '引数の配列を書き換えない（slice しているか）');

  const dup = sort([{ id: 'F06', name: 'A' }, { id: 'F06', name: 'B' }]).map(s => s.name);
  ok(dup.length === 2, '同じIDが2件あっても落ちない', dup);
}

/* ---------- 5. 定義そのもの ---------- */
console.log('\n[5] 定義');
{
  const m = /const LOGIN_STORE_ORDER = (\[[^\]]*\]);/.exec(src)[1];
  const arr = new Function('return ' + m + ';')();
  ok(JSON.stringify(arr) === JSON.stringify(EXPECT), 'LOGIN_STORE_ORDER の中身', arr);
  ok(new Set(arr).size === arr.length, '重複が無い');
  ok(/ToriTon→Tenkichi→Kaimuki→Piikoi→Aiea→Marujuu→LaLa→FSP→WGS/.test(src),
    'コメントの並びも実際と合っている');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
