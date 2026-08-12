/* verify_v912.js — 会議タブの統合と全店の軽量化

   ① 月初/中間のモード切替が消え、renderMeetingReview に mode 分岐が残っていない
   ② 全店（2店以上）は店舗カードのみ。年間一覧も差分の原因も出さない
   ③ 1店では 店舗カード＋年間一覧 が出る
   ④ 全社サマリーは全店のときだけ
   ⑤ 年間推移グラフとその関数が消えている
   ⑥ タスク欄は出ないが、関数は残っている（戻せる）
*/
const fs = require('fs');
const acorn = require('acorn');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v911_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra){
  if(c){ pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra!==undefined ? '  → ' + extra : '')); }
}
function grab(s, name){
  const i = s.indexOf('function ' + name + '(');
  if(i < 0) return '';
  let d = 0, st = false;
  for(let j = i; j < s.length; j++){
    if(s[j] === '{'){ d++; st = true; }
    else if(s[j] === '}'){ d--; if(st && d === 0) return s.slice(i, j + 1); }
  }
  return '';
}

/* ---------- 構文（今回 else の閉じ括弧が残って落ちたので機械で押さえる） ---------- */
(() => {
  const i = src.indexOf('<script>'), j = src.lastIndexOf('</script>');
  let err = null;
  try { acorn.parse(src.slice(i + 8, j), { ecmaVersion: 2020 }); } catch(e){ err = e.message; }
  ok(err === null, 'スクリプト全体が構文として通る', err);
})();

const view = grab(src, 'renderMeetingReview');
ok(view.length > 0, 'renderMeetingReview を取り出せる');

/* ---------- ① モード廃止 ---------- */
ok(!/\bmode\b/.test(view), '会議ビューに mode の参照が1つも残っていない');
ok(!/setMeetMode\(/.test(view), 'モード切替ボタンが消えている');
ok(!/中間MTG/.test(view) && !/月初MTG/.test(view), '2つのMTGという表現が画面から消えている');
ok(/setMeetMode/.test(prev) && /月初MTG/.test(grab(prev,'renderMeetingReview')), 'v911 にはモード切替があった（変更が効いている確認）');
ok(src.indexOf('function setMeetMode') > 0, 'setMeetMode 関数自体は残す（外から呼ばれても壊れない）');
ok(/前日まで/.test(view), 'バナーは当月の進捗を出す');

/* ---------- ②③ 描画の分岐 ---------- */
(() => {
  const i = view.indexOf('var _multi = ks.length > 1;');
  ok(i > 0, '店舗数で分岐している');
  const seg = view.slice(i, i + 800);
  ok(/if \(_multi\) \{ try \{ html \+= _meetStoreSummary/.test(seg), '全店ではサマリーカード');
  ok(/return;/.test(seg), 'サマリーを出したら打ち切る');
  ok(/html \+= _meetStoreCard\(x\.s, x\.k, ym, isCurrent\);/.test(seg), '1店では店舗カード');
  ok(/_meetYearMatrix\(x\.s, ym0\.y\)/.test(seg), '1店では年間一覧');
  /* 全店で年間一覧が出ないこと（_multi なら return しているので到達しない） */
  const retAt = seg.indexOf('return;');
  const matAt = seg.indexOf('_meetYearMatrix');
  ok(retAt > 0 && matAt > retAt, '全店では年間一覧に到達しない', 'return@' + retAt + ' matrix@' + matAt);
})();
ok((view.match(/_meetYearMatrix\(/g)||[]).length === 1, '年間一覧の呼び出しは1か所だけ', (view.match(/_meetYearMatrix\(/g)||[]).length);
ok(grab(src, '_meetStoreCard') === grab(prev, '_meetStoreCard'), '店舗カードそのものは触っていない');
ok(grab(src, '_meetYearMatrix') === grab(prev, '_meetYearMatrix'), '年間一覧そのものは触っていない');

/* ---------- ④ 全社サマリー ---------- */
ok(/if \(ks\.length > 1\) html\+='<div class="card" style="border:1\.5px solid '\+sumCol/.test(view),
   '全社サマリーは全店のときだけ');
ok(/当月サマリー/.test(view), 'サマリーの見出しは残っている');

/* ---------- ⑤ グラフ廃止 ---------- */
ok(src.indexOf('_meetTrendSvg') < 0, '_meetTrendSvg が消えている');
ok(src.indexOf('_meetMonthlySales') < 0, '_meetMonthlySales が消えている');
ok(prev.indexOf('_meetTrendSvg') > 0, 'v911 にはあった（変更が効いている確認）');
ok(!/月別売上の推移/.test(src), 'グラフの説明文も消えている');
ok(!/<svg/.test(grab(src, '_meetStoreSummary')), 'サマリーカードにSVGが無い');

/* ---------- ⑥ タスク欄 ---------- */
ok((src.match(/_meetTaskSection\(/g)||[]).length === 1, 'タスク欄の呼び出しは無い（定義の1件のみ）', (src.match(/_meetTaskSection\(/g)||[]).length);
ok(grab(src, '_meetTaskSection').length > 0, '_meetTaskSection 関数は残してある（1行で戻せる）');
ok(/タスク欄\(_meetTaskSection\)は出さない/.test(view), 'なぜ出さないかがコードに書いてある');

/* ---------- サマリーカードが軽くなったか ---------- */
(() => {
  const sum = grab(src, '_meetStoreSummary');
  ok(sum.length < grab(prev, '_meetStoreSummary').length, 'サマリーカードのコードが短くなった',
     grab(prev,'_meetStoreSummary').length + ' → ' + sum.length);
  ok(/_meetKpiRows\(k\)/.test(sum) && /_meetStatus\('sales'/.test(sum), '判定は既存関数のまま');
  ok(/cumulativeToToday\(store\.id, ym\)/.test(sum), '予算は日別累計（v906の基準）のまま');
  ok(/_plYoYHtml\(store\.id, ym, landing, true\)/.test(sum), '昨対は残す');
  ok(/onclick="setBudgetStore\(/.test(sum), 'タップでその店へ');
})();

/* ---------- 壊していない ---------- */
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない');
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '差分分解を触っていない');
ok(grab(src, 'parsePLWorkbook') === grab(prev, 'parsePLWorkbook'), 'PL取込を触っていない');
ok(grab(src, '_plPrevYear') === grab(prev, '_plPrevYear'), '昨対の計算を触っていない');
ok(src.indexOf('var PL2025_SEED = {') > 0, '2025年シードが残っている');
ok(/bStoreChips\(_budgetStore, 'setBudgetStore'\)/.test(view), '店舗チップは残っている');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 912, 'APP_VERSION が 912 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
