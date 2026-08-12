/* verify_v914.js — 予算の考え方の常時表示と曜日別の予定/実績

   ① 曜日別の実績・目標・手入力回数が _meetGapBreakdown の戻り値から取れる
      （同じものを別関数で計算し直していない）
   ② 想定と現状の乖離が出る
   ③ 根拠・重点が未入力なら「未入力」と出して入力へ誘導する
   ④ 手入力のある曜日に * が付く（案A）
   ⑤ テイクアウト列は常に出る（案B）／未使用なら 0 ではなく —
   ⑥ 回数0の曜日は薄く — （案③）
   ⑦ 曜日別予算が無い店では表を出さず理由を出す
*/
const fs = require('fs');
const acorn = require('acorn');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v913_backup.html', 'utf8');

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
(() => {
  const i = src.indexOf('<script>'), j = src.lastIndexOf('</script>');
  let err = null;
  try { acorn.parse(src.slice(i + 8, j), { ecmaVersion: 2020 }); } catch(e){ err = e.message; }
  ok(err === null, 'スクリプト全体が構文として通る', err);
})();

['_meetPlanHtml','_meetDowPlanTable'].forEach(n => ok(grab(src, n).length > 0, n + ' がある'));
ok(/try \{ h \+= _meetPlanHtml\(store, ym, landing\); \} catch\(e\)\{\}/.test(grab(src,'_meetStoreCard')), '売上カードから呼ばれている');
ok(grab(src,'_meetStoreCard').indexOf('_meetPlanHtml') < grab(src,'_meetStoreCard').indexOf('_meetGapHtml'), '考え方が差分の原因より前に出る');

/* ---------- ① 計算を重複させていない ---------- */
const tbl = grab(src, '_meetDowPlanTable');
ok(/_meetGapBreakdown\(store\.id, ym, 'sales'\)/.test(tbl), '曜日別の数字は _meetGapBreakdown から取る');
ok(!/getDailyActuals/.test(tbl), '表の中で日次実績を読み直していない（二重計算を避ける）');
ok(!/getTipLabor|keyKpiStats/.test(tbl), '重い読み取りをしていない');
ok(/dowAct:dowA, dowTgt:dowT, dowManual:dowManual/.test(src), '戻り値に曜日別を足している');

/* ---------- 実行 ---------- */
const N = ['_gapDowIdx','_gapDaysElapsed','_gapDowPerDay','_gapDowGuestsPerDay','_meetGapBreakdown','_meetDowPlanTable','daysOfYm'];
const dowL = [100,100,100,110,130,160,150], dowD = [80,80,80,88,104,128,120];
const mk = (g, sp) => g.map(x => ({guests:x, spend:sp, orders:0}));
const BUD = { _usesDow:true, days:{}, dow:{ lunch:mk(dowL,20), dinner:mk(dowD,50), takeout:Array.from({length:7},()=>({guests:0,spend:0,orders:0})) } };
const DA = {};
function seed(upto){
  for(const k in DA) delete DA[k];
  for(let d = 1; d <= upto; d++){
    const day = '2026-08-' + String(d).padStart(2,'0');
    const js = new Date(2026,7,d).getDay(); const i = (js===0)?6:js-1;
    const bad = (i<=2) ? 0.61 : 0.98;
    DA[day] = { actual:1, lunchSales:Math.round(dowL[i]*bad*21), lunchGuests:Math.round(dowL[i]*bad),
                dinnerSales:Math.round(dowD[i]*0.98*51), dinnerGuests:Math.round(dowD[i]*0.98) };
  }
}
const sb = {
  DOW:['月','火','水','木','金','土','日'], curYm:()=>'2026-08', bizToday:()=>'2026-08-11',
  getDailyActuals:()=>DA, getBudgetForMonth:()=>BUD, getDow:b=>b&&b.dow, usesDowMode:b=>!!(b&&b._usesDow),
  getSegments:()=>({}), segSales:()=>0,
  dayBudgetFor:(b,dt)=>{ if(b.days&&b.days[dt]!=null&&b.days[dt]!=='') return parseFloat(b.days[dt]);
    const p=String(dt).split('-'); const js=new Date(+p[0],+p[1]-1,+p[2]).getDay(); const i=(js===0)?6:js-1;
    return dowL[i]*20 + dowD[i]*50; },
  fmtK:v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}),
  escapeHtml:x=>String(x).replace(/"/g,'&quot;'), t:ja=>ja, console,
};
const K = Object.keys(sb);
const F = new Function(...K, N.map(n=>grab(src,n)).join('\n') + '\nreturn{_meetDowPlanTable,_meetGapBreakdown};')(...K.map(k=>sb[k]));

seed(10);
(() => {
  const h = F._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(h.length > 500, '表が出る', h.length);
  ok((h.match(/<td/g)||[]).length > 0 && (h.match(/<tr/g)||[]).length === 9, 'ヘッダー2行＋曜日7行', (h.match(/<tr/g)||[]).length);
  ok(!/NaN|Infinity|undefined/.test(h), 'NaN等が出ない');
  ['月','火','水','木','金','土','日'].forEach(d => ok(h.indexOf('>'+d+' <span') > 0, d + 'の行がある'));
  ok(/100 <span[^>]*>→<\/span> <b[^>]*>61<\/b>/.test(h), '予定→実績が同じセルに出る（100 → 61）');
  ok(/2回/.test(h) && /1回/.test(h), '曜日ごとの回数が出る');
  /* ⑤ テイクアウト列 */
  ok(/テイクアウト/.test(h), 'テイクアウト列が常に出る（案B）');
  ok(/件数/.test(h), 'テイクアウトは件数と表記');
  ok(!/>0</.test(h.replace(/>0<\/span>/g,'')), '未使用のテイクアウトが 0 ではない');
  const toCells = (h.match(/color:var\(--border\)">—<\/td>/g)||[]).length;
  ok(toCells >= 14, '未使用の区分は — で出る', toCells);
})();

/* ---------- ④ 手入力 ---------- */
(() => {
  BUD.days = { '2026-08-05': 12000 };   /* 水曜 */
  const h = F._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(/\$12,000<span[^>]*>\*<\/span>/.test(h), '手入力のある曜日の日計に * が付く');
  ok(/この曜日の1日は日別予算を手入力/.test(h), '何日ぶんが手入力か title に出る');
  ok(/日別予算を手入力した日を含みます/.test(h), '表の下に注記が出る');
  /* 手入力が無いときは注記も * も出ない */
  BUD.days = {};
  const h2 = F._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(!/\*<\/span>/.test(h2), '手入力が無ければ * を出さない');
  ok(!/日別予算を手入力した日を含みます/.test(h2), '注記も出さない');
})();

/* ---------- ⑥ 回数0の曜日 ----------
   曜日の回数は「経過した日数」から数える（実績の有無ではない）。
   なので0回を作るには月の頭に戻す必要がある。8/4 時点なら 8/1土・2日・3月 だけ経過。 */
(() => {
  const F0 = new Function(...K, N.map(n=>grab(src,n)).join('\n') + '\nreturn{_meetDowPlanTable};')
    (...K.map(k => k==='bizToday' ? (()=>'2026-08-04') : sb[k]));
  seed(3);
  const h = F0._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(/火 <span[^>]*>0回/.test(h), 'まだ来ていない曜日も行を出す');
  ok(/色|color:var\(--border\)/.test(h), '薄く出す');
  ok(!/NaN/.test(h), '0回でもNaNにならない');
  ok(/color:var\(--border\)">100<\/td>/.test(h), '0回でも予定の客数は見える');
  seed(10);
})();

/* ---------- 実績が未入力の曜日 ----------
   経過はしているが実績が入っていない曜日を $0 と断定しない。
   −$6,000 と出すと「未入力」を「未達」と誤読する。 */
(() => {
  for(const k in DA) delete DA[k];
  DA['2026-08-03'] = { actual:1, lunchSales:1000, lunchGuests:50, dinnerSales:2000, dinnerGuests:40 };  /* 月曜だけ */
  const h = F._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(/この曜日の実績が未入力です/.test(h), '未入力の曜日は理由を出す');
  ok(!/−\$6,000/.test(h), '未入力を大きな未達として出さない');
  ok(!/→ \$0/.test(h), '$0 と断定しない');
  ok(!/NaN/.test(h), '壊れない');
  seed(10);
})();

/* ---------- ⑦ 曜日別予算が無い店 ---------- */
(() => {
  const B2 = { _usesDow:false, days:{}, dow:null };
  const F2 = new Function(...K, N.map(n=>grab(src,n)).join('\n') + '\nreturn{_meetDowPlanTable};')
    (...K.map(k => k==='getBudgetForMonth' ? (()=>B2) : k==='usesDowMode' ? (()=>false) : k==='getDow' ? (()=>null) : sb[k]));
  const h = F2._meetDowPlanTable({id:'F02',name:'T'}, '2026-08');
  ok(!/<table/.test(h), '表を出さない');
  ok(/曜日別予算を設定すると表示されます/.test(h), '理由を出す');
})();

/* ---------- ②③ 考え方 ---------- */
const plan = grab(src, '_meetPlanHtml');
ok(/budRationale\(raw, ym\)/.test(plan), '根拠・重点を既存関数から取る');
ok(/根拠・重点が未入力です/.test(plan), '未入力なら「未入力」と出す');
ok(/openBudgetReview\(/.test(plan), '入力への導線がある');
ok(/prevMonthStats\(store\.id, ym\)/.test(plan), '前月実績を既存関数から取る');
ok(/dayBudgetFor\(b, dd\.date\)/.test(plan), '月間予算は日別予算の積み上げ（v906と同じ基準）');
ok(/の乖離/.test(plan), '想定との乖離を出す');
ok(/budStatusFor\(raw, ym\)/.test(plan), '予算のステータスを出す（未承認の予算と比べていないか分かる）');
ok(!/0\.995|1\.005/.test(plan), '独自のしきい値を作っていない');

/* ---------- 壊していない ---------- */
ok(grab(src, '_meetGapHtml') === grab(prev, '_meetGapHtml'), '差分の原因の表示を触っていない');
ok(grab(src, '_meetKpiTile') === grab(prev, '_meetKpiTile'), 'v913のKPIカードを触っていない');
ok(grab(src, '_meetStorePinHtml') === grab(prev, '_meetStorePinHtml'), 'v913の固定行を触っていない');
ok(grab(src, 'openBudgetReview') === grab(prev, 'openBudgetReview'), 'モーダルは残してある（詳しく見る導線）');
(() => {
  /* v913 までの分解結果が変わっていないこと */
  seed(10); BUD.days = {};
  const r = F._meetGapBreakdown('F02','2026-08','sales');
  ok(r.ok === true, '差分分解は従来どおり動く');
  ok(Math.abs(r.segs.reduce((a,s)=>a+r.ld[s].tgt,0) - r.budDaily) < 1e-6, '区分別の合計＝日別予算の累計（v906の保証が保たれている）');
  ok(Array.isArray(r.dowAct) && r.dowAct.length === 7, 'dowAct が7つ');
  ok(Array.isArray(r.dowManual) && r.dowManual.length === 7, 'dowManual が7つ');
})();
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 914, 'APP_VERSION が 914 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
