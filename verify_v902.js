/* verify_v902.js — 中間MTGタブの更新

   ① 売上は「前日までの実績 vs 日割り予算」で判定・表示する（カードもサマリーも）
   ② リピート率にL/D内訳（既存 repeatStatsLD を使う）
   ③ 人件費率にL/D内訳。時給比で全体を按分し、分子の総額は全体と一致する
   ④ ドリンク比率は変えていない
   ⑤ 中間MTGからタスク欄が消え、月初MTGには残っている
   ⑥ seg の lower 追加が既存の呼び出しを壊していない
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v901_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra){
  if(c){ pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra!==undefined ? '  → ' + extra : '')); }
}
function fn(s, name){
  const i = s.indexOf('function ' + name + '(');
  if(i < 0) return '';
  let d = 0, started = false;
  for(let j = i; j < s.length; j++){
    if(s[j] === '{'){ d++; started = true; }
    else if(s[j] === '}'){ d--; if(started && d === 0) return s.slice(i, j + 1); }
  }
  return '';
}

/* ---------- ① 売上の日割り ---------- */
const card = fn(src, '_meetStoreCard');
ok(card.length > 0, '_meetStoreCard を取り出せる');
ok(/var paceBudget = isCurrent \? Math\.round\(\(k\.budget\|\|0\)\*paceFrac\)/.test(card), '日割り予算 paceBudget を paceFrac から作っている');
ok(/var salesBase = \(k\.sales\|\|0\);/.test(card), '判定の実績は「前日まで」の実績');
ok(/_meetStatus\('sales', salesBase, paceBudget, false\)/.test(card), '売上の判定が日割り予算に対して行われる');
ok(!/_meetStatus\('sales', salesBase, k\.budget/.test(card), '満額予算での判定が残っていない');
ok(!/var salesBase = isCurrent \? landing/.test(card), 'バッジが着地予測で判定される旧実装が消えている');
ok(/_meetDiffStr\('sales', salesBase, paceBudget/.test(card), 'バッジの差分も日割り予算基準');
ok(/fmtK\(paceBudget\)/.test(card), '画面の予算表示が日割り');
ok(/t\('月間予算','Month'\)/.test(card), '月間予算も小さく併記していて情報が消えていない');
ok(/landing/.test(card) && /着地予測/.test(card), '着地予測はそのまま残っている');
ok(prev.indexOf('paceBudget') < 0, 'v901 には paceBudget が無かった（変更が効いている確認）');

/* 数値: 30日中15日経過、月間予算 $300,000 → 日割り $150,000 */
(() => {
  const pace = (budget, daysPassed, monthDays) => Math.round(budget * Math.min(1, daysPassed / monthDays));
  ok(pace(300000, 15, 30) === 150000, '15/30日経過・予算30万 → 日割り15万', pace(300000,15,30));
  ok(pace(300000, 30, 30) === 300000, '月末は満額', pace(300000,30,30));
  ok(pace(310000, 10, 31) === 100000, '31日月・10日経過', pace(310000,10,31));
})();

/* サマリー側 */
ok(/var _pb=Math\.round\(\(k\.budget\|\|0\)\*_pf\);/.test(src), 'サマリーも日割り予算を作っている');
ok(/_meetStatus\('sales', \(k\.sales\|\|0\), _pb, false\)/.test(src), 'サマリーの売上判定も日割り');
ok(!/_meetStatus\('sales', lj, k\.budget, false\)/.test(src), 'サマリーの着地予測判定が消えている');
ok(/var _sumBud  = _sumPace \? totPaceBud : totBud;/.test(src), 'サマリータイルの分母を切り替えている');
ok(/totPaceBud\+=_pb;/.test(src), 'totPaceBud を積んでいる');
ok(/var totSales=0, totBud=0, totMiss=0, totKpi=0, storeMiss=0, totPaceBud=0;/.test(src), 'totPaceBud を宣言している');

/* ---------- ② リピート率 L/D ---------- */
const seg = fn(src, '_meetSegExtra');
ok(/if\(key==='repeat'\)\{/.test(seg), 'repeat の分岐がある');
ok(/repeatStatsLD\(\[\{id:storeId\}\], daysOfYm\(ym\)\)/.test(seg), '既存の repeatStatsLD を呼んでいる（計算式を作っていない）');
ok(/rl\.lunch\.repeat\/rl\.lunch\.total/.test(seg) && /rl\.dinner\.repeat\/rl\.dinner\.total/.test(seg), 'L/D それぞれで率を出している');
ok(/if\(!rl \|\| !rl\.has\)/.test(seg), 'データが無いときの案内がある');
ok(prev.indexOf("if(key==='repeat')") < 0, 'v901 には repeat 分岐が無かった');

/* ---------- ③ 人件費率 L/D ---------- */
const lld = fn(src, '_meetLaborLD');
ok(lld.length > 0, '_meetLaborLD がある');
ok(/var useRaw=\(rL\+rD\)>=\(wL\+wD\);/.test(lld), '_laborHrs と同じ「合計が大きい側」の選び方にそろえている');
ok(/lc\+=\(useRaw\?rL:wL\)\*w; dc\+=\(useRaw\?rD:wD\)\*w;/.test(lld), '時給×時間をL/D別に積んでいる');
ok(/ov\.lunchSales/.test(lld) && /ov\.dinnerSales/.test(lld), 'L/D売上を日次実績から取っている');
ok(/if\(key==='labor'\)\{/.test(seg), 'labor の分岐がある');
ok(/var fct=\(k\.labor>0\)\?\(k\.labor\/lbase\):1;/.test(seg), '全体人件費で按分係数を作っている');
ok(/seg\(t\('ランチ','L'\), llr, k\.laborBudgetRate, false, '%', true\)/.test(seg), '人件費率のL側に lower=true を渡している');
ok(/seg\(t\('ディナー','D'\), dlr, k\.laborBudgetRate, false, '%', true\)/.test(seg), '人件費率のD側に lower=true を渡している');
ok(/時給比で全体を按分/.test(seg), '按分している旨が画面に出る');

/* 按分の数値検証：分子（人件費の総額）は必ず全体と一致する */
(() => {
  const alloc = (lc, dc, ls, ds, total) => {
    const base = lc + dc, f = base > 0 ? total / base : 1;
    return { l: ls > 0 ? lc * f / ls * 100 : null, d: ds > 0 ? dc * f / ds * 100 : null, f: f, lCost: lc * f, dCost: dc * f };
  };
  const a = alloc(4000, 6000, 20000, 30000, 13000);   // 時給ベース1万 → 全体1.3万（割増・税・月給込み）
  ok(Math.abs((a.lCost + a.dCost) - 13000) < 1e-6, '按分後のL+Dの人件費が全体と一致する', a.lCost + a.dCost);
  ok(Math.abs(a.l - 26) < 1e-9, 'ランチ 4000×1.3 ÷ 20000 = 26%', a.l);
  ok(Math.abs(a.d - 26) < 1e-9, 'ディナー 6000×1.3 ÷ 30000 = 26%', a.d);
  /* L/D売上の合計が人件費率の分母と一致するときは、加重平均が全体に戻る */
  const whole = 13000 / 50000 * 100;
  const weighted = (a.l * 20000 + a.d * 30000) / 50000;
  ok(Math.abs(weighted - whole) < 1e-9, 'L/D売上の合計＝分母のときは加重平均が全体に戻る', weighted + ' vs ' + whole);
  /* 片側しか売上が無い場合に落ちない */
  const b = alloc(4000, 6000, 0, 30000, 13000);
  ok(b.l === null && Number.isFinite(b.d), 'ランチ売上0でも壊れない', JSON.stringify([b.l, b.d]));
})();

/* ---------- ⑥ seg の lower ---------- */
ok(/var seg=function\(lbl, act, tgt, money, u, lower\)\{/.test(seg), 'seg が lower を受け取る');
ok(/lower\?\(act<=tgt\*1\.005\):\(act>=tgt\*0\.995\)/.test(seg), 'lower のとき判定が反転する');
(() => {
  const judge = (act, tgt, lower) => (tgt > 0 && act > 0) ? (lower ? (act <= tgt * 1.005) : (act >= tgt * 0.995)) : null;
  ok(judge(26, 30, true) === true,  '人件費率 26% は目標30%に対して良い', judge(26,30,true));
  ok(judge(34, 30, true) === false, '人件費率 34% は目標30%に対して悪い', judge(34,30,true));
  ok(judge(52, 50, false) === true, 'リピート率 52% は目標50%に対して良い', judge(52,50,false));
  ok(judge(44, 50, false) === false,'リピート率 44% は目標50%に対して悪い', judge(44,50,false));
})();
/* 既存の呼び出しは lower を渡していない＝undefined＝従来動作 */
ok(/seg\(t\('ランチ','L'\), k\.lunchGuests,[^\n]*\)/.test(seg), '客数の呼び出しは従来のまま（lower を渡していない）');
ok(/seg\(t\('ランチ','L'\), k\.ppaLunch, tl, true\)/.test(seg), '客単価の呼び出しは従来のまま');

/* ---------- ④ ドリンクは変更なし ---------- */
ok(/if\(key==='drink'\)\{ var mix=null;/.test(seg), 'drink の分岐は残っている');
ok(/酒\/ソフト内訳はメニュー出数の同期後に表示/.test(src), 'drink の文言を変えていない');
const d0 = fn(prev, '_meetSegExtra'), dCur = seg;
const drinkOf = (t2) => { const i = t2.indexOf("if(key==='drink')"); return i < 0 ? '' : t2.slice(i); };
ok(drinkOf(d0) === drinkOf(dCur), 'drink 分岐が v901 と1文字も変わっていない');

/* ---------- ⑤ タスク欄 ---------- */
ok(/else \{ ks\.forEach\(function\(x\)\{ html\+=_meetStoreCard\(x\.s, x\.k, ym, isCurrent\); \}\); \}/.test(src), '中間MTGからタスク欄が外れている');
ok(/if\(mode==='start'\)\{ ks\.forEach\(function\(x\)\{ html\+=_meetYearMatrix\(x\.s, ym0\.y\)\+_meetTaskSection\(x\.s\); \}\); \}/.test(src), '月初MTGにはタスク欄が残っている');
ok(fn(src, '_meetTaskSection').length > 0, '_meetTaskSection 関数自体は残してある（戻せる）');
ok((src.match(/_meetTaskSection\(x\.s\)/g) || []).length === 1, 'タスク欄の呼び出しは1か所だけになった', (src.match(/_meetTaskSection\(x\.s\)/g)||[]).length);
ok((prev.match(/_meetTaskSection\(x\.s\)/g) || []).length === 2, 'v901 では2か所から呼ばれていた');

/* ---------- 壊していない ---------- */
ok(/paceFrac<1\)\{ rows\.forEach\(function\(it\)\{ if\(it\.key==='guests'/.test(src), '客数の日割りは従来どおり');
ok(/laborRate: laborSalesCore\?Math\.round\(labor\/laborSalesCore\*1000\)\/10/.test(src), '全体の人件費率の計算を触っていない');
ok(fn(src, 'repeatStatsLD') === fn(prev, 'repeatStatsLD'), 'repeatStatsLD を書き換えていない');
ok(/const APP_VERSION = '902'/.test(src), 'APP_VERSION が 902');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
