/* ============================================================
   verify_v781.js — Miso の日英を一致させる

   ver2 の原本は Miso Lv1・Lv2 で日本語と英語が食い違っていた。
   「英語が正」と確定したため、日本語を英語に合わせた。

     テスト1: 症状再現 … v780 は日英が食い違っていた
     テスト2: Lv1 … 配置項目が日英とも4つ
     テスト3: Lv2 … オーダー数が日英とも50、内容も一致
     テスト4: 数値の整合 … 全軸で日英のオーダー数が一致する
     テスト5: レベルの単調性 … Miso のオーダー数が Lv2<Lv3
     テスト6: 他の軸は変えていない
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v780_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  ✅ ' + m); pass++; } else { console.log('  ❌ ' + m); fail++; } }

function crit(src) {
  const i = src.indexOf('var TOTOYA_SKILL_CRITERIA_V2 = {');
  const j = src.indexOf('\n};', i) + 3;
  const sb = {}; vm.createContext(sb);
  vm.runInContext(src.slice(i, j) + '\nvar _c = TOTOYA_SKILL_CRITERIA_V2;', sb);
  return sb._c;
}
/* 文中の「◯◯オーダー」「◯◯+ orders」を拾う */
function ordersJa(s) { const m = s.match(/(\d+)\s*オーダー/); return m ? Number(m[1]) : null; }
function ordersEn(s) { const m = s.match(/(\d+)\+?\s*orders?/i); return m ? Number(m[1]) : null; }
/* 括弧内の列挙の個数 */
function items(s, open, close) {
  const i = s.indexOf(open); if (i < 0) return null;
  const j = s.indexOf(close, i); if (j < 0) return null;
  return s.slice(i + 1, j).split('/').length;
}

const C = crit(SRC), O = crit(OLD);
const AXES = ['Team Standards', 'Main Plater', 'Miso', 'Host', 'Supporter', 'Prep', 'Hospitality'];

console.log('\n===== テスト1: 症状再現（v780 の食い違い） =====');
{
  ok(ordersJa(O['Miso'][2][0]) === 70 && ordersEn(O['Miso'][2][1]) === 50,
    'v780: Lv2 は 日70 / 英50 で食い違っていた');
  ok(items(O['Miso'][1][0], '（', '）') === 3 && items(O['Miso'][1][1], '(', ')') === 4,
    'v780: Lv1 の配置項目は 日3 / 英4 で食い違っていた');
}

console.log('\n===== テスト2: Lv1 の配置項目 =====');
{
  const ja = items(C['Miso'][1][0], '（', '）'), en = items(C['Miso'][1][1], '(', ')');
  ok(ja === 4 && en === 4, '日英とも4項目（日' + ja + ' / 英' + en + '）');
  ok(C['Miso'][1][0].indexOf('海苔') >= 0, '日本語に「海苔」が入った');
  ok(C['Miso'][1][0].indexOf('海苔/丼/味噌/スプーン') >= 0, '英語と同じ並び順');
}

console.log('\n===== テスト3: Lv2 =====');
{
  ok(ordersJa(C['Miso'][2][0]) === 50, '日本語が50オーダー');
  ok(ordersEn(C['Miso'][2][1]) === 50, '英語も50オーダー');
  ok(C['Miso'][2][0].indexOf('エリアの清潔を維持') >= 0,
    "日本語が clean station に対応（v780 の「洗い場を回す」は Lv3 と重複していた）");
  ok(C['Miso'][2][0].indexOf('いくらシャワー') > 0, 'いくらシャワーは残っている');
  ok(C['Miso'][2][0].indexOf('洗い場') < 0, 'Lv2 から「洗い場」が外れた（Lv3 の要件のため）');
  ok(C['Miso'][3][0].indexOf('洗い場') >= 0, 'Lv3 には「洗い場」がある');
}

console.log('\n===== テスト4: 全軸で日英のオーダー数が一致 =====');
{
  let bad = [];
  AXES.forEach(function (a) {
    C[a].forEach(function (p, lv) {
      const j = ordersJa(p[0]), e = ordersEn(p[1]);
      if (j !== null && e !== null && j !== e) bad.push(a + ' Lv' + lv + '（日' + j + '/英' + e + '）');
    });
  });
  ok(bad.length === 0, '食い違いなし' + (bad.length ? '：' + bad.join('、') : ''));

  let badOld = [];
  AXES.forEach(function (a) {
    O[a].forEach(function (p, lv) {
      const j = ordersJa(p[0]), e = ordersEn(p[1]);
      if (j !== null && e !== null && j !== e) badOld.push(a + ' Lv' + lv);
    });
  });
  ok(badOld.length === 1 && badOld[0] === 'Miso Lv2', 'v780 の食い違いは Miso Lv2 の1件だけだった');
}

console.log('\n===== テスト5: レベルの単調性 =====');
{
  const l2 = ordersJa(C['Miso'][2][0]), l3 = ordersJa(C['Miso'][3][0]);
  ok(l2 < l3, 'Miso は Lv2(' + l2 + ') < Lv3(' + l3 + ')');
  const h2 = ordersJa(C['Host'][2][0]), h3 = ordersJa(C['Host'][3][0]);
  ok(h2 < h3, 'Host も Lv2(' + h2 + ') < Lv3(' + h3 + ')');
  ok(l2 === h2 && l3 === h3, 'Miso と Host の刻みが揃っている（50 → 70）');
}

console.log('\n===== テスト6: 他の軸は変えていない =====');
{
  AXES.filter(a => a !== 'Miso').forEach(a =>
    ok(JSON.stringify(C[a]) === JSON.stringify(O[a]), a + ' は変更なし'));
  ok(JSON.stringify(C['Miso'][0]) === JSON.stringify(O['Miso'][0]), 'Miso Lv0 も変更なし');
  ok(JSON.stringify(C['Miso'][3]) === JSON.stringify(O['Miso'][3]), 'Miso Lv3 も変更なし');
  ok(JSON.stringify(C['Miso'][4]) === JSON.stringify(O['Miso'][4]), 'Miso Lv4 も変更なし');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
