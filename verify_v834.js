/* verify_v834.js — 出数（menu_mix_）をメニュー1品ごとに保存する
   記録は1か月ぶんの単一オブジェクト { items:{レシピID:出数}, sales, savedAt, toastSrc }。
   書き込み口は3つあり、どれも同じ月の同じ入れ物を触る。
     Toast同期 / DBからの取り込み / 手入力（0にした分は項目ごと消す）
   合流ルールが無く「丸ごと上書き」だったため、
   Toast同期の直後に、同期前の写しを持った端末が手入力を保存すると
   取り込んだ出数がまとめて元に戻り、理論原価と原価差異がずれる。

   守るのは6つ。
   ① Toast同期で入った出数と、別端末の手入力が両方残る（1品ごと）
   ② 同じメニューがぶつかったら、あとから変えたほうが勝つ
   ③ 0 にした操作が伝わる（「無い＝0」なので、古い写しから戻らない）
   ④ 中身が変わらない保存では印を進めない
   ⑤ 印の無い既存データで退行しない
   ⑥ 画面が受け取る形は今までと同じ（items はレシピID→出数） */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v834_backup.html')
  ? fs.readFileSync('index_v834_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v833_backup.html', 'utf8');
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
function unchangedIn(name) {
  try { return grab(src, name) === grab(prev, name); } catch (e) { return false; }
}

const FN = ['_mmItems', '_mmStamps', '_mmAt', '_mmEmpty', 'mergeMenuMix', '_coversMenuMix',
            'theoMixKey', 'getMenuMix', 'setMenuMix'];
function env(who) {
  return new Function('__store', '__who', `
    function myName(){ return __who; }
    function getPeriod(){ return '2026.8'; }
    function ls(k, d){ return (k in __store) ? JSON.parse(JSON.stringify(__store[k])) : d; }
    function lsSet(k, v){ __store[k] = JSON.parse(JSON.stringify(v)); return true; }
    var console={warn:function(){}};
    ${FN.map(n => grab(src, n)).join('\n')}
    return { ${FN.map(n => n + ':' + n).join(',')}, store:__store };
  `)({}, who || 'Moto');
}
const P = '2026.8';
const K = 'menu_mix_F01_2026.8';
/* 印の時刻を明示的にずらす（同じミリ秒だと勝敗が決まらない） */
function at(E, rid, v) { E.store[K]._im[rid] = v; return E; }

console.log('[1] キーの形');
{
  const A = env();
  ok(A.theoMixKey('F01', P) === K, '実際のキー名（期は YYYY.M）', A.theoMixKey('F01', P));
  ok(A.theoMixKey('F01') === K, '期を省くと当月になる');
}

console.log('\n[2] Toast同期と手入力が両方残る');
{
  /* Toast同期：r1 と r2 が取り込まれた */
  const A = env('同期');
  A.setMenuMix('F01', P, { items: { r1: 120, r2: 80 }, sales: 200000, savedAt: '2026/08/02 10:00', toastSrc: true });
  at(A, 'r1', 1000); at(A, 'r2', 1000);
  /* 別端末：同期前の写し（空）から、手で r3 を入力した */
  const B = env('店長');
  B.setMenuMix('F01', P, { items: { r3: 15 }, sales: 30000, savedAt: '2026/08/02 10:05' });
  at(B, 'r3', 2000);

  const m = A.mergeMenuMix(A.store[K], B.store[K]);
  ok(Object.keys(m.items).length === 3, '3品とも残る（丸ごと上書きなら片方が消えていた）', m.items);
  ok(m.items.r1 === 120 && m.items.r2 === 80, '取り込んだ出数が残る', m.items);
  ok(m.items.r3 === 15, '手入力も残る', m.items);
  const m2 = A.mergeMenuMix(B.store[K], A.store[K]);
  ok(Object.keys(m2.items).length === 3, '押し上げの順番が逆でも同じ');
}

console.log('\n[3] 同じメニューがぶつかったら、あとから変えたほうが勝つ');
{
  const A = env('同期'); A.setMenuMix('F01', P, { items: { r1: 120 }, sales: 0 }); at(A, 'r1', 1000);
  const B = env('店長'); B.setMenuMix('F01', P, { items: { r1: 98 }, sales: 0 }); at(B, 'r1', 3000);
  ok(A.mergeMenuMix(A.store[K], B.store[K]).items.r1 === 98, 'あとから直した出数が勝つ');
  ok(A.mergeMenuMix(B.store[K], A.store[K]).items.r1 === 98, '順番が逆でも同じ');
}

console.log('\n[4] 0 にした操作が伝わる（無い＝0）');
{
  const A = env('店長');
  A.setMenuMix('F01', P, { items: { r1: 120, r2: 80 }, sales: 0 });
  at(A, 'r1', 1000); at(A, 'r2', 1000);
  /* 別端末はまだ r1=120 を持っている */
  const B = env('Yuki'); B.store[K] = JSON.parse(JSON.stringify(A.store[K]));
  /* 店長が r1 を 0 にする（画面と同じく項目ごと消える） */
  const cur = A.getMenuMix('F01', P); delete cur.items.r1;
  A.setMenuMix('F01', P, cur); at(A, 'r1', 5000);

  const m = A.mergeMenuMix(B.store[K], A.store[K]);
  ok(m.items.r1 === undefined, '0 にした出数が古い写しから戻らない', m.items);
  ok(m.items.r2 === 80, '他のメニューは残る', m.items);
  ok(Number(m._im.r1) === 5000, '0 にした時刻が残る', m._im);
  /* 入れ直したら、そちらが新しいので勝つ */
  const C = env('店長'); C.store[K] = JSON.parse(JSON.stringify(m));
  const c2 = C.getMenuMix('F01', P); c2.items.r1 = 45;
  C.setMenuMix('F01', P, c2); at(C, 'r1', 9000);
  ok(C.mergeMenuMix(m, C.store[K]).items.r1 === 45, '入れ直せば入れ直しが勝つ');
}

console.log('\n[5] 中身が変わらない保存では印を進めない');
{
  const A = env('店長');
  A.setMenuMix('F01', P, { items: { r1: 120 }, sales: 0 });
  const at1 = A.store[K]._at, im1 = A.store[K]._im.r1;
  ok(Number(at1) > 0 && Number(im1) > 0, '変わったときは印が付く', { at1: at1, im1: im1 });
  ok(A.store[K]._by === '店長', '保存者も残る', A.store[K]._by);
  A.setMenuMix('F01', P, A.getMenuMix('F01', P));
  ok(A.store[K]._at === at1 && A.store[K]._im.r1 === im1, '同じ中身を保存し直しても進まない');
}

console.log('\n[6] 印の無い既存データで退行しない');
{
  const A = env();
  A.store[K] = { items: { r1: 120, r2: 80 }, sales: 200000, savedAt: '2026/07/31 12:00' };   /* v833 以前の形 */
  const seen = A.getMenuMix('F01', P);
  ok(Object.keys(seen.items).length === 2, '古い形でもそのまま読める', seen.items);
  const cloud = { items: { r1: 120 }, sales: 0 };
  const local = { items: { r1: 98 }, sales: 0 };
  ok(A.mergeMenuMix(cloud, local).items.r1 === 98, '印が無ければローカルが勝つ（v833 までと同じ）');
  /* 印の無い記録どうしでも、別のメニューは消さない */
  ok(Object.keys(A.mergeMenuMix({ items: { r1: 1 } }, { items: { r2: 2 } }).items).length === 2,
    '印が無くても、別のメニューは両方残る');
  ok(A.mergeMenuMix({ items: { r1: 5, r2: 9 } }, { items: { r1: 5 } }).items.r2 === 9,
    '印が無い側に入っていないだけでは、消したとみなさない');
  /* 片方に印があるときは、そちらの「消した」が効く */
  ok(A.mergeMenuMix({ items: { r1: 5, r2: 9 } }, { items: { r1: 5 }, _im: { r2: 7000 } }).items.r2 === undefined,
    '印があれば「消した」が伝わる');
}

console.log('\n[7] 空で中身のあるものを消さない');
{
  const A = env();
  const full = { items: { r1: 120 }, _im: { r1: 1000 }, _at: 1000 };
  ok(A.mergeMenuMix(full, { items: {} }).items.r1 === 120, '空のローカルは勝てない');
  ok(A.mergeMenuMix({ items: {} }, full).items.r1 === 120, '逆向きも同じ');
  const virgin = A.mergeMenuMix({ items: {} }, { items: {} });
  ok(virgin && Object.keys(_ITEMS(virgin)).length === 0, 'もともと空なら空のまま（新しい月が作れなくならない）');
  function _ITEMS(m) { return (m && m.items) || {}; }
}

console.log('\n[8] covers：少ない側・古い側で押し上げない');
{
  const A = env('店長');
  A.setMenuMix('F01', P, { items: { r1: 120, r2: 80 }, sales: 0 });
  const full = A.store[K];
  const part = { items: { r1: 120 }, _im: { r1: full._im.r1 }, _at: full._at };
  ok(A._coversMenuMix(full, part) === true, '全部持っていれば部分をカバーできている');
  ok(A._coversMenuMix(part, full) === false, '部分しか持っていなければ押し上げを止める');
  ok(A._coversMenuMix({ items: {} }, full) === false, '空では押し上げられない');
  ok(A._coversMenuMix(full, { items: {} }) === true, '相手が空なら止めない');
}

console.log('\n[9] 画面が受け取る形と登録');
{
  const A = env('店長');
  A.setMenuMix('F01', P, { items: { r1: 120 }, sales: 200000, savedAt: '2026/08/02 10:00' });
  const seen = A.getMenuMix('F01', P);
  ok(typeof seen.items === 'object' && seen.items.r1 === 120, 'items はレシピID→出数のまま', seen.items);
  ok(seen.sales === 200000 && seen.savedAt === '2026/08/02 10:00', 'sales と savedAt はそのまま');

  const MP = require('./merge_probe.js');
  const p = MP.buildProbe(src);
  ok(p.ruleFor('menu_mix_').name === 'mergeMenuMix', '実 _opMergeDef が合流ルールを返す');
  ok(MP.buildProbe(prev).ruleFor('menu_mix_').name === null, '（参考）v833 までは無かった');
  ok(MP.SAMPLE['menu_mix_'] === 'menu_mix_F01_2026.8', '監査の見本も実際のキー名');
}

console.log('\n[10] 同じ穴が他に何個あるか（見えるようにしておく）');
{
  const MP = require('./merge_probe.js');
  function uncoveredIn(text) {
    const q = MP.buildProbe(text);
    return q.syncPrefixes().filter(function (k) {
      if (MP.NOT_A_DATA_KEY.indexOf(k) >= 0) return false;
      return !q.ruleFor(k).name;
    });
  }
  const missing = uncoveredIn(src), missB = uncoveredIn(prev);
  console.log('     合流ルールが無いキー（丸ごと上書きされる）: ' + missing.length + ' 個');
  console.log('     ' + missing.join('  '));
  ok(missing.indexOf('menu_mix_') < 0, '出数は塞いだ');
  ok(missing.length === missB.length - 1, '1つだけ減った', { v833: missB.length, v834: missing.length });
}

console.log('\n[11] ビルドの性質と既存への影響');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
  } else ok(true, 'SW_BUILD は現行版の検証で見る');

  /* 出数を書く3か所は setMenuMix を通しているので、どれも変えていない */
  ['getMenuMix', 'theoMixKey', 'saveMenuMix', 'syncMenuFromToast', 'loadMenuMixFromDB',
   'theoreticalUsageByIngredient', 'varianceSummary', 'mergeDailyOps', '_opMergeDef',
   'mergeWarnings', 'saveOrders', 'getDailyOps'
  ].forEach(function (n) { ok(unchangedIn(n), n + ' を変えていない'); });

  ok(src.indexOf('\u8f96') < 0, '簡体字の誤字が入っていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
