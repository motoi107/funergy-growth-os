/* verify_v911.js — 全店選択時は店舗サマリーのみ

   ① 全店(2店以上)ではサマリーだけ。店舗カードも年間一覧も出さない
   ② 1店選択では従来どおり詳細＋年間一覧が出る
   ③ 判定は既存の _meetStatus / _meetKpiRows と同じ（俯瞰と詳細で食い違わせない）
   ④ 年間推移は keyKpiStats を12回呼ばない（軽さが目的なので重くしない）
   ⑤ カードをタップするとその店へ
   ⑥ 昨年データが無い店でもグラフが壊れない
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v910_backup.html', 'utf8');

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

/* v912 で年間推移グラフを廃止したため、_meetTrendSvg / _meetMonthlySales は現在は無い。
   v911 の主張（サマリーだけにして軽くした）は _meetStoreSummary で見る。
   グラフまわりの検証は v911 のソースに対して行う。 */
ok(grab(src, '_meetStoreSummary').length > 0, '_meetStoreSummary がある');
const V911 = fs.readFileSync('index_v911_backup.html','utf8');
['_meetTrendSvg','_meetMonthlySales'].forEach(n =>
  ok(grab(V911, n).length > 0, 'v911 には ' + n + ' があった'));

/* ---------- ①② 分岐 ---------- */
(() => {
  const i = src.indexOf('var _multi = ks.length > 1;');
  ok(i > 0, '店舗数で分岐している');
  const seg = src.slice(i, i + 700);
  ok(/if \(_multi\) \{ try \{ html \+= _meetStoreSummary/.test(seg), '複数店ではサマリーを出す');
  ok(/return;/.test(seg), 'サマリーを出したらそこで打ち切る（詳細を続けて出さない）');
  ok(/if \(_multi\) html \+= /.test(seg) && /店舗を選ぶと出ます/.test(seg), '出ない理由を1行案内する');
  /* 1店のときは従来どおり */
  ok(/html \+= _meetStoreCard\(x\.s, x\.k, ym, isCurrent\);/.test(seg), '1店では店舗カードを出す');
  ok(/try \{ html \+= _meetYearMatrix\(x\.s, ym0\.y\); \} catch\(e\)\{\}/.test(seg), '1店では年間一覧を出す');
})();
ok(grab(src, '_meetStoreCard') === grab(prev, '_meetStoreCard'), '店舗カードそのものは触っていない');
ok(grab(src, '_meetYearMatrix') === grab(prev, '_meetYearMatrix'), '年間一覧そのものは触っていない');
ok(/if\(mode==='start'\)/.test(V911), 'v911 の時点では月初MTGが別モードだった');

/* ---------- ③ 判定は既存関数 ---------- */
const sum = grab(src, '_meetStoreSummary');
ok(/_meetKpiRows\(k\)/.test(sum), 'KPIの並びは既存の _meetKpiRows');
ok(/_meetStatus\('sales', \(k\.sales\|\|0\), paceBudget, false\)/.test(sum), '売上の判定は詳細と同じ式');
ok(/cumulativeToToday\(store\.id, ym\)/.test(sum), '予算は日別累計（v906と同じ基準）');
ok(!/0\.995|1\.005|>=100\)/.test(sum), 'サマリーの中で独自のしきい値を作っていない');
ok(/_meetConfirmBadge\(store\.id, ym, true\)/.test(sum), '速報/確定を出す');
ok(/_plYoYHtml\(store\.id, ym, landing, true\)/.test(sum), '昨対を出す（着地予測と比較）');

/* ---------- ④ 軽さ ---------- */
ok(!/keyKpiStats/.test(grab(V911,'_meetMonthlySales')), '月別集計で keyKpiStats を呼ばない');
ok(!/keyKpiStats/.test(grab(V911,'_meetTrendSvg')), 'グラフでも keyKpiStats を呼ばない');
ok((grab(V911,'_meetMonthlySales').match(/getDailyActuals/g)||[]).length === 1, 'v911 のグラフは日次実績の読み取り1回だけだった');
ok(!/keyKpiStats/.test(sum), 'サマリー本体でも keyKpiStats を呼ばない（k は呼び出し元から渡る）');

/* ---------- 実行 ---------- */
const DA = {}, PL = {
  '2025-01':{F02:{sales:100000}}, '2025-02':{F02:{sales:110000}}, '2025-03':{F02:{sales:120000}},
};
for (let m = 1; m <= 3; m++) for (let d = 1; d <= 28; d++)
  DA['2026-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0')] = { actual: 4000 + m*100 };
const sb = {
  getDailyActuals: () => DA, PL2025_SEED: PL, console,
};
const K = Object.keys(sb);
const F = new Function(...K, grab(V911,'_meetMonthlySales') + grab(V911,'_meetTrendSvg')
  + '\nreturn{_meetMonthlySales,_meetTrendSvg};')(...K.map(k => sb[k]));

(() => {
  const m = F._meetMonthlySales('F02', 2026);
  ok(m.length === 12, '12か月ぶん返る', m.length);
  ok(m[0] === 28*4100, '1月 = 4,100×28日', m[0]);
  ok(m[2] === 28*4300, '3月 = 4,300×28日', m[2]);
  ok(m[3] === null, '実績が無い月は null（0にしない）', m[3]);
  const m25 = F._meetMonthlySales('F02', 2025);
  ok(m25.every(x => x === null), '別の年を指定すると全部 null（年をまたいで混ざらない）');
})();

(() => {
  const s = F._meetTrendSvg('F02', 2026);
  ok(/^<svg/.test(s) && /<\/svg>$/.test(s), 'SVGが返る');
  ok((s.match(/<path/g)||[]).length === 2, '今年と昨年の2本', (s.match(/<path/g)||[]).length);
  ok(/stroke="var\(--accent\)"/.test(s) && /stroke="var\(--border\)"/.test(s), '今年は濃く、昨年は薄く');
  ok(/<circle/.test(s), '直近の実績に点が付く');
  ok(!/NaN|Infinity|undefined/.test(s), 'NaN等が出ない');
  /* 座標が枠内 */
  const nums = [...s.matchAll(/([\d.]+),([\d.]+)/g)].map(x => [+x[1], +x[2]]);
  ok(nums.length > 0 && nums.every(([x,y]) => x >= 0 && x <= 170 && y >= 0 && y <= 35), '座標が枠内', nums.length + '点');
  /* 途中が欠けても線が飛ばない */
  const s2 = (() => {
    const D2 = {};
    ['2026-01-05','2026-02-05','2026-05-05','2026-06-05'].forEach(d => D2[d] = {actual:5000});
    const G = new Function('getDailyActuals','PL2025_SEED','console', grab(V911,'_meetMonthlySales')+grab(V911,'_meetTrendSvg')+'\nreturn{_meetTrendSvg};')(()=>D2, PL, console);
    return G._meetTrendSvg('F02', 2026);
  })();
  ok(/M[\d.,]+L[\d.,]+/.test(s2), '欠けた月をまたいで線を引かない（区間ごとに分ける）');
  ok(!/NaN/.test(s2), '欠損があってもNaNにならない');
})();

/* ⑥ データが無いとき */
(() => {
  const G = new Function('getDailyActuals','PL2025_SEED','console',
    grab(V911,'_meetMonthlySales') + grab(V911,'_meetTrendSvg') + '\nreturn{_meetTrendSvg};')(()=>({}), {}, console);
  ok(G._meetTrendSvg('F04-A', 2026) === '', '実績も前年も無ければグラフを出さない（空の枠を残さない）');
  const G2 = new Function('getDailyActuals','PL2025_SEED','console',
    grab(V911,'_meetMonthlySales') + grab(V911,'_meetTrendSvg') + '\nreturn{_meetTrendSvg};')(()=>DA, {}, console);
  const s = G2._meetTrendSvg('F02', 2026);
  ok(/^<svg/.test(s) && (s.match(/<path/g)||[]).length === 1, '前年が無くても今年だけで描ける', (s.match(/<path/g)||[]).length);
  const G3 = new Function('getDailyActuals','PL2025_SEED','console',
    grab(V911,'_meetMonthlySales') + grab(V911,'_meetTrendSvg') + '\nreturn{_meetTrendSvg};')(()=>{ throw new Error('x'); }, PL, console);
  let err = null; try { G3._meetTrendSvg('F02', 2026); } catch(e){ err = e.message; }
  ok(err === null, '読み取りに失敗しても例外を投げない', err);
})();

/* ---------- ⑤ タップ ---------- */
ok(/onclick="setBudgetStore\(/.test(sum), 'カードをタップするとその店へ');
ok(/cursor:pointer/.test(sum), '押せることが見た目でわかる');
ok(src.indexOf('function setBudgetStore') > 0, 'setBudgetStore が存在する');
ok(/title="'\+escapeHtml\(t\('タップでこの店の詳細へ'/.test(sum), '何が起きるか説明がある');

/* ---------- 壊していない ---------- */
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない');
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '差分分解を触っていない');
ok(grab(src, 'parsePLWorkbook') === grab(prev, 'parsePLWorkbook'), 'v910のPL取込を触っていない');
ok(grab(src, '_plPrevYear') === grab(prev, '_plPrevYear'), 'v909の昨対を触っていない');
ok(prev.indexOf('_meetStoreSummary') < 0, 'v910 には無かった関数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 911, 'APP_VERSION が 911 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
