/* verify_v863.js — 店舗カードの売上グラフを「月末まで見えるペース図」にする

   Motoさん確認済みの仕様：
     ・全カードに出す。ただし今のグラフサイズ（46px／単店 74px）に収める
     ・週×KPI ヒートマップは残す
     ・「今日」の縦線は前日に置く（実績は前日までの規約なので、今日に置くとずれる）

   46px に収めるために落としたもの（数字はヒーローに全部あるので重複）：
     ・Y軸の $ 目盛りとグリッド線
     ・グラフ内の「目標／実績」の点ラベル
   足したもの：予算線を月末まで／予測の点線／前日の縦線／日付3つ／着地予測の1行

   ★ 新しい計算式は作らない。
     予測線は「前日の実績 → 月末の着地予測」を予算カーブの形でつなぐだけ。
     傾きを (fc - actEnd) / (budEnd - budYest) にしてあるので、
     終点は定義上 mdForecastFrom と一致する（pace を引き直していない）。

   ★ mdSalesSparkHtml は verify_v861 が動作で見ている砦なので、置き換えず残す。
     新関数 mdSalesChartHtml を作って mdStoreCardHtml の呼び先だけ変えた（教訓73）。

   守るのは7つ。
   ① 予算線が月末まで引かれている（budFull が月の日数ぶん）
   ② budFull の最後 = budMonth（Σ日次予算と一致する）
   ③ 実績線は「前日まで」のまま。規約を変えていない
   ④ 予測線の終点が mdForecastFrom と一致する
   ⑤ 予測線の始点が実績線の終点とつながっている
   ⑥ 縦線は前日に立つ（実績の終点と同じ x）
   ⑦ mdSalesSparkHtml と mdVerdict を1バイトも変えていない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v863_backup.html')
  ? fs.readFileSync('index_v863_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v862_backup.html', 'utf8');
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
function code(text, name) { return grab(text, name).replace(/\/\*[\s\S]*?\*\//g, ''); }
function unchangedIn(n) { try { return grab(src, n) === grab(prev, n); } catch (e) { return false; } }
function pts(poly) {
  return poly.trim().split(/\s+/).map(s => s.split(',').map(Number));
}

/* ---------- データ層：mdStoreSeries が月末までの予算を返すか ---------- */
function serEnv(F) {
  return new Function('F', `
    var _mdCache={}, _mdCacheArmed=false;
    ${grab(src, 'mdCacheClear')} ${grab(src, '_mdMemo')}
    function curYm(){ return '2026-08'; }
    function bizToday(){ return F.today; }
    function todayISO(){ return F.today; }
    function mcYmOffset(){ return 0; }
    function daysOfYm(ym){ var a=[]; for(var i=1;i<=31;i++){ var ds=ym+'-'+String(i).padStart(2,'0');
      a.push({date:ds, dow:['日','月','火','水','木','金','土'][new Date(ds+'T00:00:00').getDay()]}); } return a; }
    function laborMonthWeeks(){ return F.weeks.map(function(s){ return {sun:s}; }); }
    function laborWeekDays(sun){ var a=[],d=new Date(sun+'T00:00:00');
      for(var i=0;i<7;i++){ var x=new Date(d); x.setDate(d.getDate()+i);
        a.push(x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')); } return a; }
    function _laborHrs(e){ return e.h||0; }
    function getTipLabor(sid,dt){ return F.labor[dt]||null; }
    function getDailyActuals(){ return F.acts; }
    function getBudgetForMonth(){ return {b:1}; }
    function dayBudgetFor(){ return F.dayBud; }
    function dayCostReal(){ return 0; }
    function guestCountType(){ return 'guest'; }
    function laborCoreForYm(){ return { total: F.monthLabor }; }
    ${grab(src, 'laborWeekHours')} ${grab(src, '_mdDayGuests')}
    ${grab(src, 'mdStoreSeries')}
    return mdStoreSeries;
  `)(F);
}
function baseF() {
  const F = { today: '2026-08-20', monthLabor: 44000, dayBud: 4000,
    weeks: ['2026-07-26', '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30'],
    acts: {}, labor: {} };
  for (let i = 1; i <= 31; i++) {
    const ds = '2026-08-' + String(i).padStart(2, '0');
    if (ds < F.today) F.acts[ds] = { actual: 3800 + i * 10, guests: 120 + i, foodCost: 1000 };
    F.labor[ds] = { A: { h: 20 }, B: { h: 18 } };
  }
  return F;
}

console.log('\n[1] 予算は月末まで、実績は前日まで');
{
  const F = baseF();
  const s = serEnv(F)('F01', '2026-08');
  ok(s.budFull && s.budFull.length === 31, '予算は月の日数ぶん（31日）', s.budFull && s.budFull.length);
  ok(s.line.length === 19, '実績は前日まで（8/1〜8/19 の19日）', s.line.length);
  ok(s.budFull[30].bud === Math.round(s.budMonth),
    'budFull の最後 = budMonth（Σ日次予算と一致）', { last: s.budFull[30].bud, budMonth: s.budMonth });
  ok(s.budFull[18].bud === s.line[18].bud,
    '前日までの部分は今までの進捗予算と同じ値', { full: s.budFull[18].bud, line: s.line[18].bud });
  ok(s.budFull[30].date === '2026-08-31' && s.budFull[0].date === '2026-08-01', '日付が月初と月末で入っている');
  /* 実績側の規約を変えていないこと（v861 の①をもう一度見る） */
  ok(s.line.every(p => p.date < F.today), '実績に今日以降が混じっていない');
}

console.log('\n[2] グラフ：3本の線と前日の縦線');
{
  const chart = new Function(`${grab(src, 'mdSalesChartHtml')} return mdSalesChartHtml;`)();
  const n = 31, iy = 18;
  const budFull = Array.from({ length: n }, (_, i) => ({ date: '2026-08-' + String(i + 1).padStart(2, '0'), bud: (i + 1) * 1000 }));
  const line = Array.from({ length: iy + 1 }, (_, i) => ({ date: '2026-08-' + String(i + 1).padStart(2, '0'), act: (i + 1) * 940, bud: (i + 1) * 1000 }));
  const ser = { budFull, line, budMonth: 31000 };
  const FC = 29140;                      /* mdForecastFrom 相当の外から渡す値 */
  const h = 46, w = 240;
  const html = chart(ser, '#e23b3b', h, false, FC);

  const polys = [...html.matchAll(/<polyline points="([^"]+)"/g)].map(m => m[1]);
  ok(polys.length === 3, '線は3本（予算・予測・実績）', polys.length);

  const pBud = pts(polys[0]), pFc = pts(polys[1]), pAct = pts(polys[2]);
  ok(pBud.length === 31, '予算線は月末まで31点', pBud.length);
  ok(pAct.length === 19, '実績線は前日まで19点', pAct.length);
  ok(pFc.length === 31 - iy, '予測線は前日から月末まで', pFc.length);

  /* 終点が mdForecastFrom と一致する（＝新しい計算式を作っていない） */
  const budEnd = budFull[n - 1].bud, actEnd = line[iy].act;
  const mx = Math.max(budEnd, FC, actEnd) * 1.06;
  const yOf = v => Number((h - v / mx * h).toFixed(1));
  ok(pFc[pFc.length - 1][1] === yOf(FC),
    '予測線の終点が着地予測と一致', { line: pFc[pFc.length - 1][1], forecast: yOf(FC) });
  ok(pFc[0][0] === pAct[pAct.length - 1][0] && pFc[0][1] === pAct[pAct.length - 1][1],
    '予測線の始点が実績線の終点とつながっている', { fc: pFc[0], act: pAct[pAct.length - 1] });

  /* 縦線は前日（実績の終点）に立つ。今日ではない */
  const vx = Number((html.match(/<line x1="([\d.]+)" y1="0"/) || [])[1]);
  ok(vx === pAct[pAct.length - 1][0], '縦線は前日に立つ（実績の終点と同じ x）', { line: vx, act: pAct[pAct.length - 1][0] });
  ok(vx < w, '縦線が右端（今日＝月末側）に寄っていない', vx);
  ok(/前日 8\/19/.test(html), 'ラベルが「前日 8/19」', (html.match(/前日 [\d/]+/) || [])[0]);
  ok(/>8\/1</.test(html) && />8\/31</.test(html), '日付は月初と月末の2つだけ足している');

  /* 高さ：46px + 日付の帯12px */
  ok(/height:58px/.test(html), 'グラフの高さは 46 + 12 = 58px');
  ok(/viewBox="0 0 240 58"/.test(html), 'viewBox も 58');
  ok(!/\$/.test(html.replace(/前日[^<]*/g, '')), 'Y軸の $ 目盛りは入れていない（数字はヒーロー側）');
}

console.log('\n[3] 単店と、描けないとき');
{
  const chart = new Function(`${grab(src, 'mdSalesChartHtml')} return mdSalesChartHtml;`)();
  const budFull = Array.from({ length: 31 }, (_, i) => ({ date: '2026-08-' + String(i + 1).padStart(2, '0'), bud: (i + 1) * 1000 }));
  const line = [{ date: '2026-08-01', act: 900, bud: 1000 }];
  const solo = chart({ budFull, line, budMonth: 31000 }, '#15a66a', 74, true, 29000);
  ok(/height:86px/.test(solo), '単店は 74 + 12 = 86px');
  ok(/stroke="#e6ded4"/.test(solo), '単店だけ月間予算の水位線が入る');
  const grid = chart({ budFull, line, budMonth: 31000 }, '#15a66a', 46, false, 29000);
  ok(!/stroke="#e6ded4"/.test(grid), '一覧カードには水位線を入れない（46px では潰れる）');

  ok(chart({ budFull: [], line: [] }, '#000', 46, false, 0) === '', '予算が無ければ何も描かない');
  ok(chart({ budFull, line: [] }, '#000', 46, false, 0) === '', '実績が1日も無ければ何も描かない（月初）');
  const noFc = chart({ budFull, line, budMonth: 31000 }, '#000', 46, false, 0);
  ok((noFc.match(/<polyline/g) || []).length === 2 && !/予測/.test(noFc),
    '着地予測が出せないときは予測線も凡例も出さない');
}

console.log('\n[4] 触っていないもの');
{
  ok(unchangedIn('mdSalesSparkHtml'), 'mdSalesSparkHtml を1バイトも変えていない（verify_v861 の砦）');
  ok(unchangedIn('mdVerdict'), 'mdVerdict を1バイトも変えていない');
  ok(unchangedIn('mdStoreVerdict'), 'mdStoreVerdict を1バイトも変えていない');
  ok(unchangedIn('mdWeekHeatHtml'), 'ヒートマップは残す（1バイトも変えていない）');
  ok(unchangedIn('mdWeekRates'), 'mdWeekRates を1バイトも変えていない');
  ok(unchangedIn('mdForecastFrom'), '着地予測の式は既存のまま');
  ok(unchangedIn('laborWeekHours'), 'laborWeekHours を1バイトも変えていない');
  ok(/mdSalesChartHtml\(ser,/.test(code(src, 'mdStoreCardHtml')), 'カードは新しいグラフを呼んでいる');
  ok(/mdForecastFrom\(cumulativeToToday\(storeId, ym\)\)/.test(code(src, 'mdStoreCardHtml')),
    '着地予測は既存の関数から取っている（式を作り直していない）');
  ok(/mdWeekHeatHtml\(storeId, ym\)/.test(code(src, 'mdStoreCardHtml')), 'ヒートマップの呼び出しが残っている');
  /* 予測線が pace を引き直していないこと＝終点が定義上ずれない */
  ok(!/paceRate/.test(code(src, 'mdSalesChartHtml')),
    'グラフの中で pace を引き直していない（渡された着地予測をそのまま使う）');
}

console.log('\n[5] ビルド');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(sw === av, 'SW_BUILD も同じ', { APP_VERSION: av, SW_BUILD: sw });
  }
}

console.log('\nPASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
