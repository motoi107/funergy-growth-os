/* verify_v904.js — 差分の原因の表示

   HTMLを実際に生成して中身を見る。文字列一致だけだと、
   「関数はあるが呼ばれていない」「数字が入っていない」を見逃す。
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v903_backup.html', 'utf8');

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

const NEEDED = ['_gapDowIdx','_gapDaysElapsed','_gapDowPerDay','_gapDowGuestsPerDay','_meetGapBreakdown','_meetGapHtml','daysOfYm'];
NEEDED.forEach(n => ok(grab(src, n).length > 0, 'ソースに ' + n + ' がある'));

/* カードから呼ばれているか（作ったが繋いでいない、を防ぐ） */
const card = grab(src, '_meetStoreCard');
ok(/_meetGapHtml\(store\.id, ym, 'sales'\)/.test(card), '実績カードから呼ばれている');
ok(/try \{ h \+= _meetGapHtml/.test(card), 'try で囲ってある（例外でカード全体が落ちない）');
ok(card.indexOf('_meetGapHtml') < card.indexOf('openBudgetReview'), '売上ヒーローの中に入っている');

/* ---------- 実行環境 ---------- */
const DAILY = {}, BUD = {};
function mkDow(lg, ls, dg, ds){
  const mk = (a,b) => Array.from({length:7}, () => ({guests:a, spend:b, orders:0}));
  return { lunch: mk(lg,ls), dinner: mk(dg,ds), takeout: Array.from({length:7},()=>({guests:0,spend:0,orders:0})) };
}
const sandbox = {
  DOW: ['月','火','水','木','金','土','日'],
  curYm: () => '2026-08',
  bizToday: () => '2026-08-11',
  getDailyActuals: () => DAILY,
  getBudgetForMonth: () => BUD.b,
  getDow: (b) => b && b.dow,
  usesDowMode: (b) => !!(b && b._usesDow),
  getSegments: (b) => (b && b.segments) || {},
  segSales: (seg, type) => { if(!seg) return 0;
    if(type === 'takeout') return (parseFloat(seg.orders)||0)*(parseFloat(seg.spend)||0);
    return (parseFloat(seg.sales)||0) || (parseFloat(seg.guests)||0)*(parseFloat(seg.spend)||0); },
  fmtK: (v) => '$' + (parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  escapeHtml: (x) => String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  t: (ja) => ja,
  console,
};
const code = NEEDED.map(n => grab(src, n)).join('\n');
const keys = Object.keys(sandbox);
const F = new Function(...keys, code + '\nreturn {_meetGapHtml,_meetGapBreakdown};')(...keys.map(k => sandbox[k]));

function seed(withTO){
  for(const k in DAILY) delete DAILY[k];
  for(let d = 1; d <= 12; d++){
    const day = '2026-08-' + String(d).padStart(2,'0');
    DAILY[day] = withTO
      ? { actual:5000, lunchSales:1500, lunchGuests:80, dinnerSales:3500, dinnerGuests:70, toLunchSales:300, toLunchCount:10, toDinnerSales:200, toDinnerCount:5 }
      : { actual:5000, lunchSales:1500, lunchGuests:80, dinnerSales:3500, dinnerGuests:70 };
  }
}

/* ---------- 通常ケース ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50) };
  seed(false);
  const h = F._meetGapHtml('F02','2026-08','sales');
  ok(typeof h === 'string' && h.length > 200, 'HTMLが返る', h.length);
  ok(/どこで足りないか/.test(h), '「どこで足りないか」の見出しがある');
  ok(/ランチ/.test(h) && /ディナー/.test(h), 'ランチとディナーが出る');
  ok(!/テイクアウト/.test(h), 'TOが無い月はテイクアウト行を出さない');
  ok(/−\$5,000\.00/.test(h), '差 −$5,000 が出る');
  ok(/不足の[\s\S]{0,80}50%/.test(h), '不足の構成比が出る');
  ok(/曜日別/.test(h), '曜日別の見出しがある');
  ['月','火','水','木','金','土','日'].forEach(d => ok(h.indexOf('>'+d+'</div>') > 0, '曜日ラベル ' + d + ' が出る'));
  ok(/客数[\s\S]{0,60}83%/.test(h), '客数の達成率 83% が出る（1500/1800）');
  ok(/主因は[\s\S]{0,60}集客/.test(h), '主因が集客と出る');
  ok(/前日までの10日ぶん/.test(h), '対象日数が出る');
  /* バー幅が0〜100%に収まる */
  const ws = [...h.matchAll(/width:(\d+)%/g)].map(m => +m[1]);
  ok(ws.length > 0 && ws.every(w => w >= 0 && w <= 100), 'バー幅が0〜100%に収まる', ws.join(','));
  const hs = [...h.matchAll(/height:(\d+)px/g)].map(m => +m[1]);
  ok(hs.every(x => x >= 3 && x <= 46), '曜日バーの高さが範囲内', hs.join(','));
  /* HTMLとして壊れていない（タグの開閉数） */
  const open = (h.match(/<div/g)||[]).length, close = (h.match(/<\/div>/g)||[]).length;
  ok(open === close, 'divの開閉数が一致', open + '/' + close);
})();

/* ---------- テイクアウトあり ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50) };
  seed(true);
  const h = F._meetGapHtml('F02','2026-08','sales');
  ok(/テイクアウト/.test(h), 'TOがある月はテイクアウト行が出る');
  ok(/テイクアウトは区分を分けて計上/.test(h), '二重計上していない旨の注記が出る');
  const open = (h.match(/<div/g)||[]).length, close = (h.match(/<\/div>/g)||[]).length;
  ok(open === close, 'TOありでもdivの開閉が一致', open + '/' + close);
})();

/* ---------- 曜日別予算が無い店 ---------- */
(() => {
  BUD.b = { _usesDow:false, dow:null, segments:{ lunch:{guests:100,spend:20}, dinner:{guests:80,spend:50} } };
  seed(false);
  const h = F._meetGapHtml('F02','2026-08','sales');
  ok(/どこで足りないか/.test(h), '区分別は出る');
  ok(!/曜日別（予算との差）/.test(h), '曜日バーは出さない');
  ok(/曜日別予算を設定すると表示されます/.test(h), '出ない理由を案内する');
  ok(!/主因は/.test(h), '客数/客単価の断定も出さない');
})();

/* ---------- 達成しているとき ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(50,20,40,50) };   /* 目標を低くして達成に */
  seed(false);
  const h = F._meetGapHtml('F02','2026-08','sales');
  ok(h.length > 100, '達成時もHTMLは出る');
  ok(!/不足の/.test(h), '達成時は「不足の」を出さない');
  ok(/\+\$/.test(h), 'プラスの差が + 付きで出る');
  const open = (h.match(/<div/g)||[]).length, close = (h.match(/<\/div>/g)||[]).length;
  ok(open === close, '達成時もdivの開閉が一致', open + '/' + close);
})();

/* ---------- 出せないとき ---------- */
(() => {
  BUD.b = null;
  const h1 = F._meetGapHtml('F02','2026-08','sales');
  ok(/予算が未設定/.test(h1), '予算未設定は理由を出す');
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50) };
  for(const k in DAILY) delete DAILY[k];
  const h2 = F._meetGapHtml('F02','2026-08','sales');
  ok(/実績がまだ入力されていません/.test(h2), '実績なしは理由を出す');
  ok(!/どこで足りないか/.test(h2), '実績なしでバーを出さない');
  /* 分解できないKPIは静かに何も出さない（カードが壊れない） */
  seed(false);
  ['fc','drink','labor','repeat'].forEach(k => {
    const h3 = F._meetGapHtml('F02','2026-08',k);
    ok(h3 === '', k + ' は空文字（カードを壊さない）', JSON.stringify(h3).slice(0,40));
  });
})();

/* ---------- 壊れたデータ ---------- */
(() => {
  BUD.b = { _usesDow:true, dow: mkDow(100,20,80,50) };
  for(const k in DAILY) delete DAILY[k];
  DAILY['2026-08-03'] = { actual:1000, lunchSales:100, lunchGuests:5, toLunchSales:500, toLunchCount:2 };
  let h = '', err = null;
  try { h = F._meetGapHtml('F02','2026-08','sales'); } catch(e){ err = e.message; }
  ok(err === null, '壊れた行でも例外を投げない', err);
  ok(!/NaN|Infinity|undefined/.test(h), 'NaN/Infinity/undefined が画面に出ない');
  const ws = [...h.matchAll(/width:(-?\d+)%/g)].map(m => +m[1]);
  ok(ws.every(w => w >= 0 && w <= 100), '壊れた行でもバー幅が範囲内', ws.join(','));
})();

/* ---------- 壊していない ---------- */
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), 'v903の計算層を触っていない');
ok(grab(src, '_meetSegExtra') === grab(prev, '_meetSegExtra'), '区分別内訳を触っていない');
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない');
ok(/var paceBudget = isCurrent/.test(card), 'v902の日割り判定が残っている');
ok(!/_meetTaskSection\(x\.s\)[\s\S]{0,40}_meetStoreCard|_meetStoreCard[\s\S]{0,60}_meetTaskSection/.test(src), '中間MTGにタスク欄が戻っていない');
ok(prev.indexOf('_meetGapHtml') < 0, 'v903 には無かった関数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 904, 'APP_VERSION が 904 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
