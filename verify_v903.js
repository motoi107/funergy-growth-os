/* verify_v903.js — 差分分解の計算層

   関数を「実際に動かして」数字を検算する。文字列一致だけでは中身を保証できない。
   合成データを入れて、手計算と一致するかを見る。

   守るのは：
   ① 曜日インデックスが weekdayCountsForMonth と同じ（0=月, 6=日）
   ② 当月は「前日まで」。予算も経過した曜日回数で作る（満額と比べない）
   ③ テイクアウトを二重計上しない（店内L+店内D+TO=合計）
   ④ 客数×客単価の分解が恒等式として ΔS に一致する
   ⑤ 分解できないKPIは ok:false と理由。0で誤魔化さない
   ⑥ 曜日別予算が無い店では曜日分解を出さない（推計を混ぜない）
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v902_backup.html', 'utf8');

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

/* ---------- 実行環境を組む ---------- */
const NEEDED = ['_gapDowIdx','_gapDaysElapsed','_gapDowPerDay','_gapDowGuestsPerDay','_meetGapBreakdown','daysOfYm','weekdayCountsForMonth','dowSegMonthly'];
NEEDED.forEach(n => ok(grab(src, n).length > 0, 'ソースに ' + n + ' がある'));

/* 合成データ: 2026-08（31日）。1日=土。 */
const DAILY = {}, BUD = {};
function mkDow(lg, ls, dg, ds, tor, tos){
  const mk = (a, b) => Array.from({length:7}, () => ({guests:a, spend:b, orders:0}));
  const t  = Array.from({length:7}, () => ({guests:0, spend:tos||0, orders:tor||0}));
  return { lunch: mk(lg, ls), dinner: mk(dg, ds), takeout: t };
}

const sandbox = {
  DOW: ['月','火','水','木','金','土','日'],
  curYm: () => '2026-08',
  bizToday: () => '2026-08-11',            /* 8/1〜8/10 が対象 */
  getDailyActuals: () => DAILY,
  getBudgetForMonth: () => BUD.b,
  getDow: (b) => b.dow,
  usesDowMode: (b) => !!b._usesDow,
  getSegments: (b) => b.segments || {},
  segSales: (seg, type) => { if(!seg) return 0;
    if(type === 'takeout') return (parseFloat(seg.orders)||0)*(parseFloat(seg.spend)||0);
    return (parseFloat(seg.sales)||0) || (parseFloat(seg.guests)||0)*(parseFloat(seg.spend)||0); },
  console,
};
const code = NEEDED.map(n => grab(src, n)).join('\n') + '\n';
const keys = Object.keys(sandbox);
const fns = new Function(...keys, code + '\nreturn {_gapDowIdx,_gapDaysElapsed,_meetGapBreakdown,daysOfYm,weekdayCountsForMonth};')(...keys.map(k => sandbox[k]));

/* ---------- ① 曜日index ---------- */
ok(fns._gapDowIdx('2026-08-03') === 0, '2026-08-03(月) → index 0', fns._gapDowIdx('2026-08-03'));
ok(fns._gapDowIdx('2026-08-09') === 6, '2026-08-09(日) → index 6', fns._gapDowIdx('2026-08-09'));
ok(fns._gapDowIdx('2026-08-01') === 5, '2026-08-01(土) → index 5', fns._gapDowIdx('2026-08-01'));
(() => {
  /* weekdayCountsForMonth と突き合わせ：月全体を数えれば必ず一致するはず */
  const mine = [0,0,0,0,0,0,0];
  fns.daysOfYm('2026-08').forEach(d => mine[fns._gapDowIdx(d.date)]++);
  const theirs = fns.weekdayCountsForMonth(2026, 8);
  ok(JSON.stringify(mine) === JSON.stringify(theirs), '曜日の数え方が weekdayCountsForMonth と一致', JSON.stringify(mine) + ' vs ' + JSON.stringify(theirs));
})();

/* ---------- ② 前日まで ---------- */
(() => {
  const el = fns._gapDaysElapsed('2026-08');
  ok(el.days.length === 10, '当月は前日まで（8/1〜8/10 の10日）', el.days.length);
  ok(el.days[el.days.length-1].date === '2026-08-10', '最終日が 8/10（当日を含まない）', el.days[el.days.length-1].date);
  const sum = el.counts.reduce((a,b) => a+b, 0);
  ok(sum === 10, '曜日ごとの回数の合計が経過日数と一致', sum);
  /* 8/1土,2日,3月,4火,5水,6木,7金,8土,9日,10月 → 月2 火1 水1 木1 金1 土2 日2 */
  ok(JSON.stringify(el.counts) === JSON.stringify([2,1,1,1,1,2,2]), '経過した曜日回数が正しい', JSON.stringify(el.counts));
})();

/* ---------- ③④ 売上の分解（手計算と突き合わせ） ---------- */
(() => {
  /* 目標: ランチ 100人×$20=$2,000/日、ディナー 80人×$50=$4,000/日、TOなし
     10日経過 → 目標 L$20,000 D$40,000 計$60,000 */
  BUD.b = { _usesDow:true, dow: mkDow(100, 20, 80, 50, 0, 0) };
  for(let d = 1; d <= 12; d++){
    const day = '2026-08-' + String(d).padStart(2,'0');
    DAILY[day] = { actual: 5000, lunchSales: 1500, lunchGuests: 80, dinnerSales: 3500, dinnerGuests: 70 };
  }
  const r = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r.ok === true, '売上は分解できる');
  ok(r.days === 10, '10日ぶんで集計している', r.days);
  ok(r.ld.lunch.act === 15000, 'ランチ実績 $1,500×10 = $15,000', r.ld.lunch.act);
  ok(r.ld.lunch.tgt === 20000, 'ランチ目標 $2,000×10 = $20,000', r.ld.lunch.tgt);
  ok(r.ld.lunch.gap === -5000, 'ランチ差 −$5,000', r.ld.lunch.gap);
  ok(r.ld.dinner.gap === -5000, 'ディナー差 −$5,000', r.ld.dinner.gap);
  ok(r.gap === -10000, '合計差 −$10,000', r.gap);
  ok(Math.abs((r.ld.lunch.gap + r.ld.dinner.gap) - r.gap) < 1e-6, 'L+D の差が合計と一致（取りこぼしなし）');
  ok(r.hasTakeout === false, 'テイクアウトが無い月は2区分', r.hasTakeout);
  ok(Array.isArray(r.dow) && r.dow.length === 7, '曜日分解が7つ出る');
  ok(Math.abs(r.dow.reduce((a,x) => a + x.gap, 0) - r.gap) < 1e-6, '曜日別の差の合計が全体と一致', r.dow.reduce((a,x)=>a+x.gap,0));
  ok(r.dow[0].days === 2 && r.dow[2].days === 1, '曜日ごとの回数が入っている', r.dow[0].days + '/' + r.dow[2].days);
  /* 月は2回ぶんなので目標も2倍 */
  ok(r.dow[0].tgt === 12000, '月曜の目標は2回ぶん $12,000', r.dow[0].tgt);
  ok(r.dow[2].tgt === 6000,  '水曜の目標は1回ぶん $6,000',  r.dow[2].tgt);

  /* ④ 恒等式 */
  const c = r.cause;
  ok(!!c, '客数/客単価の分解が出る');
  if(c){
    ok(Math.abs((c.guestsEffect + c.ppaEffect) - r.gap) < 1e-6, '客数効果＋客単価効果 = 全体の差（恒等式）', (c.guestsEffect + c.ppaEffect) + ' vs ' + r.gap);
    ok(c.guestsAct === 1500, '客数実績 (80+70)×10 = 1,500', c.guestsAct);
    ok(c.guestsTgt === 1800, '客数目標 (100+80)×10 = 1,800', c.guestsTgt);
    ok(c.driver === 'guests', '差の主因は客数と判定', c.driver + ' G=' + Math.round(c.guestsEffect) + ' P=' + Math.round(c.ppaEffect));
  }
})();

/* ---------- ③ テイクアウトを二重計上しない ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(100, 20, 80, 50, 10, 30) };  /* TO 10件×$30 */
  for(const k in DAILY) delete DAILY[k];
  for(let d = 1; d <= 12; d++){
    const day = '2026-08-' + String(d).padStart(2,'0');
    DAILY[day] = { actual: 5000, lunchSales: 1500, lunchGuests: 80, dinnerSales: 3500, dinnerGuests: 70,
                   toLunchSales: 300, toLunchCount: 10, toDinnerSales: 200, toDinnerCount: 5 };
  }
  const r = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r.hasTakeout === true, 'テイクアウトがある月は3区分', r.hasTakeout);
  ok(r.segs.length === 3, '区分が3つ', r.segs.join(','));
  ok(r.ld.lunch.act === 12000, '店内ランチ = ($1,500−$300)×10', r.ld.lunch.act);
  ok(r.ld.dinner.act === 33000, '店内ディナー = ($3,500−$200)×10', r.ld.dinner.act);
  ok(r.ld.takeout.act === 5000, 'テイクアウト = ($300+$200)×10', r.ld.takeout.act);
  const tot = r.ld.lunch.act + r.ld.dinner.act + r.ld.takeout.act;
  ok(tot === 50000, '3区分の合計 = 日次実績の売上合計（二重計上なし）', tot);
  ok(r.ld.takeout.tgt === 3000, 'TO目標 10件×$30×10日 = $3,000', r.ld.takeout.tgt);
  ok(Math.abs((r.ld.lunch.gap + r.ld.dinner.gap + r.ld.takeout.gap) - r.gap) < 1e-6, '3区分の差の合計が全体と一致');
})();

/* ---------- 客数 ---------- */
(() => {
  const r = fns._meetGapBreakdown('F02', '2026-08', 'guests');
  ok(r.ok === true && r.unit === 'count', '客数は件数として分解できる', r.unit);
  ok(r.ld.lunch.act === 700, '店内ランチ客数 (80−10)×10 = 700', r.ld.lunch.act);
  ok(r.ld.takeout.act === 150, 'テイクアウト件数 (10+5)×10 = 150', r.ld.takeout.act);
  ok(r.ld.takeout.tgt === 100, 'TO目標件数 10×10 = 100', r.ld.takeout.tgt);
})();

/* ---------- ⑥ 曜日別予算が無い店 ---------- */
(() => {
  BUD.b = { _usesDow:false, dow:null, segments:{ lunch:{guests:100,spend:20}, dinner:{guests:80,spend:50}, takeout:{orders:0,spend:0} } };
  const r = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r.ok === true, '曜日別予算が無くても区分別は出せる');
  ok(r.tgtMode === 'prorate', '日割りモードになる', r.tgtMode);
  ok(r.dow === null, '曜日分解は出さない（推計を混ぜない）', JSON.stringify(r.dow));
  ok(r.cause === null, '客数/客単価の分解も出さない', JSON.stringify(r.cause));
  /* 月次 L 100×20=2000/日相当 → segSales は月額として扱う。10/31 日割り */
  ok(Math.abs(r.ld.lunch.tgt - 2000*10/31) < 1e-6, '日割り目標 = 月次×10/31', r.ld.lunch.tgt);
})();

/* ---------- ⑤ 分解できないKPI ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50,0,0) };
  [['fc','fc_monthly'],['drink','drink_nold'],['labor','labor_alloc'],['repeat','repeat_ld_only']].forEach(([k, why]) => {
    const r = fns._meetGapBreakdown('F02', '2026-08', k);
    ok(r.ok === false && r.reason === why, k + ' は ok:false / ' + why, r.reason);
    ok(typeof r.note === 'string' && r.note.length > 8, k + ' に日本語の理由が入っている');
    ok(!('gap' in r), k + ' は gap を返さない（0で誤魔化さない）');
  });
})();

/* ---------- 欠損・境界 ---------- */
(() => {
  const r1 = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r1.ok === true, '通常ケースは通る');
  BUD.b = null;
  const r2 = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r2.ok === false && r2.reason === 'no_budget', '予算未設定は no_budget', r2.reason);
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50,0,0) };
  for(const k in DAILY) delete DAILY[k];
  const r3 = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r3.ok === false && r3.reason === 'no_actual', '実績ゼロは no_actual', r3.reason);
  /* 実績が1日だけ、しかも lunchSales が総売上を超える壊れた行 */
  DAILY['2026-08-03'] = { actual: 1000, lunchSales: 100, lunchGuests: 5, toLunchSales: 500, toLunchCount: 2 };
  const r4 = fns._meetGapBreakdown('F02', '2026-08', 'sales');
  ok(r4.ok === true, 'TOが L売上を超える壊れた行でも落ちない');
  ok(r4.ld.lunch.act === 0, '負にならず0で止まる', r4.ld.lunch.act);
  ok(Number.isFinite(r4.gap), 'gap が数値', r4.gap);
})();

/* 過去月は月末まで */
(() => {
  sandbox.curYm = () => '2026-09';
  const f2 = new Function(...keys, code + '\nreturn {_gapDaysElapsed};')(...keys.map(k => k === 'curYm' ? (() => '2026-09') : sandbox[k]));
  const el = f2._gapDaysElapsed('2026-08');
  ok(el.days.length === 31, '過去月は月末まで（31日）', el.days.length);
})();

/* ---------- 壊していない ---------- */
/* v903 の時点で画面を変えていないことを見る主張。
   v904 が意図的にカードへ表示を足したので、現在のソースとの比較では落ちる。
   「v903 が加えた変更は計算層だけだった」を、v902→v903 の差で確認する。 */
ok(grab(prev, '_meetStoreCard').replace(/\s+/g,'') ===
   grab(fs.readFileSync('index_v903_backup.html','utf8'), '_meetStoreCard').replace(/\s+/g,''),
   'v903 は会議カードを触っていなかった（計算層のみ）');
ok(grab(src, '_meetSegExtra') === grab(prev, '_meetSegExtra'), '区分別内訳を触っていない');
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない');
ok(grab(src, 'dowSegMonthly') === grab(prev, 'dowSegMonthly'), 'dowSegMonthly を触っていない');
ok(prev.indexOf('_meetGapBreakdown') < 0, 'v902 には無かった関数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 903, 'APP_VERSION が 903 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
