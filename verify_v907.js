/* verify_v907.js — 目標の固定表示（KPI帯）

   ① 各店カードの先頭に出て、position:sticky で貼り付く
   ② 判定はカード本体と同じ（帯とカードで食い違わない）
   ③ 未達が先頭に来る（横スクロールの右端に隠れない）
   ④ 横1行に収まる（縦に積んで画面を埋めない）
   ⑤ スクロール監視を足していない（renderPage の innerHTML 差し替えで漏れる）
   ⑥ 目標が無いKPIでも壊れない
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v906_backup.html', 'utf8');

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

ok(grab(src, '_meetPinHtml').length > 0, '_meetPinHtml がある');
ok(grab(src, '_meetPinShort').length > 0, '_meetPinShort がある');

/* ---------- ① 繋ぎ込みと sticky ---------- */
const card = grab(src, '_meetStoreCard');
ok(/_meetPinHtml\(store, rows, _sts, paceBudget, isCurrent\)/.test(card), 'カードから呼ばれている');
ok(/try \{ h \+= _meetPinHtml/.test(card), 'try で囲ってある');
ok(card.indexOf('_meetPinHtml') < card.indexOf('売上ヒーロー') || card.indexOf('_meetPinHtml') < card.indexOf('_meetGapHtml'),
   '売上ヒーローより前（カードの先頭）にある');
const pin = grab(src, '_meetPinHtml');
ok(/position:sticky/.test(pin), 'sticky で貼り付く');
ok(/top:52px/.test(pin), 'トップバー直下（52px）に貼る＝既存の作法と同じ');
ok(/background:var\(--surface\)/.test(pin), '背景がある（下の文字が透けない）');
ok(/z-index:30/.test(pin), 'z-index が指定されている');

/* ---------- ④ 横1行 ---------- */
ok(/display:flex/.test(pin) && /overflow-x:auto/.test(pin), '横1行＋横スクロール');
ok(/white-space:nowrap/.test(pin), 'ピルが折り返さない');
ok(!/flex-wrap:wrap/.test(pin), '折り返して縦に積まない（画面を埋めない）');

/* ---------- ⑤ スクロール監視を足していない ---------- */
ok(!/addEventListener\(\s*['"]scroll/.test(pin), 'スクロールリスナーを足していない');
ok(!/IntersectionObserver/.test(pin), 'IntersectionObserver を使っていない');
ok((src.match(/IntersectionObserver/g)||[]).length === (prev.match(/IntersectionObserver/g)||[]).length,
   'ソース全体でも Observer を増やしていない');

/* ---------- ② 判定はカードと同じ関数 ---------- */
ok(/_meetStatColor\(/.test(pin) && /_meetStatTint\(/.test(pin), '色は既存の判定関数から取る');
ok(!/0\.995|1\.005|>=100|defG|defY/.test(pin), '帯の中で独自のしきい値を作っていない');

/* ---------- 実行して中身を見る ---------- */
const sb = {
  escapeHtml:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  _meetStatColor:st=>({miss:'var(--red)',warn:'var(--yellow)',ok:'var(--green)',none:'var(--muted)'}[st]||'var(--muted)'),
  _meetStatTint:st=>({miss:'#fdeee4',warn:'#fff8e1',ok:'#eef7ed',none:'var(--surface2)'}[st]||'var(--surface2)'),
  t:ja=>ja, console,
};
const K = Object.keys(sb);
const F = new Function(...K, grab(src,'_meetPinShort') + '\n' + grab(src,'_meetPinHtml') + '\nreturn{_meetPinHtml,_meetPinShort}')(...K.map(k=>sb[k]));

/* 短縮表記 */
ok(F._meetPinShort(96829.27, true) === '$96.8k', '$96,829 → $96.8k', F._meetPinShort(96829.27,true));
ok(F._meetPinShort(152196, true) === '$152.2k', '$152,196 → $152.2k', F._meetPinShort(152196,true));
ok(F._meetPinShort(880.5, true) === '$880.5', '1,000未満はそのまま', F._meetPinShort(880.5,true));
ok(F._meetPinShort(33.14, false, '%') === '33.1%', '率は小数1桁', F._meetPinShort(33.14,false,'%'));
ok(F._meetPinShort(3410, false, '名') === '3410名', '件数は単位付き', F._meetPinShort(3410,false,'名'));
ok(F._meetPinShort(null, true) === '—', '未設定は —', F._meetPinShort(null,true));
ok(F._meetPinShort(undefined, false, '%') === '—', 'undefined も —', F._meetPinShort(undefined,false,'%'));

/* 帯の描画 */
const rows = [
  { key:'sales',  label:'売上',     act:96829, tgt:0,    money:true,  isSales:true },
  { key:'guests', label:'客数',     act:3410,  tgt:3300, unit:'名' },
  { key:'ppa',    label:'客単価',   act:28.4,  tgt:29.0, money:true },
  { key:'fc',     label:'原価率',   act:0,     tgt:28,   unit:'%', lower:true },
  { key:'labor',  label:'人件費率', act:33.1,  tgt:30,   unit:'%', lower:true },
];
const sts = ['miss','ok','miss','none','miss'];
const h = F._meetPinHtml({id:'F02',name:'Tenkichi'}, rows, sts, 115000, true);

ok(h.length > 200, '帯が描画される', h.length);
ok((h.match(/<div/g)||[]).length === (h.match(/<\/div>/g)||[]).length, 'divの開閉が一致');
ok(!/NaN|Infinity|undefined/.test(h), 'NaN等が出ない');
['売上','客数','客単価','原価率','人件費率'].forEach(l => ok(h.indexOf('>'+l+'</div>') > 0, l + ' のピルが出る'));
ok(/\$96\.8k[\s\S]{0,120}\$115k/.test(h), '売上は 実績/日別累計予算 を出す（paceBudget を使う）');
ok(/3410名[\s\S]{0,120}3300名/.test(h), '客数は 実績/目標');
ok(/33\.1%[\s\S]{0,120}30%/.test(h), '人件費率は 実績/目標');

/* ③ 未達が先頭 */
(() => {
  const order = ['売上','客数','客単価','原価率','人件費率']
    .map(l => ({ l, i: h.indexOf('>'+l+'</div>') }))
    .sort((a,b) => a.i - b.i).map(x => x.l);
  ok(order[0] === '売上' || order[0] === '客単価' || order[0] === '人件費率', '未達のKPIが先頭に来る', order.join('→'));
  ok(order.indexOf('客数') > order.indexOf('人件費率'), '達成しているKPIは未達より後ろ', order.join('→'));
  ok(order[order.length-1] === '原価率', '判定不可(none)は最後', order.join('→'));
})();

/* ⑥ 壊れ耐性 */
(() => {
  const h2 = F._meetPinHtml({id:'F02',name:'X'}, [{key:'sales',label:'売上',act:null,tgt:null,money:true,isSales:true}], ['none'], null, true);
  ok(h2.length > 50 && !/NaN|undefined/.test(h2), '目標も実績も無くても壊れない');
  ok(/—/.test(h2), '— で出る');
  const h3 = F._meetPinHtml({id:'F02',name:'X'}, [], [], 0, true);
  ok(h3 === '', 'KPIが無ければ帯を出さない（空の枠を残さない）', JSON.stringify(h3));
})();

/* ---------- 壊していない ---------- */
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '計算層を触っていない');
ok(grab(src, '_meetGapHtml') === grab(prev, '_meetGapHtml'), '差分分解の表示を触っていない');
ok(grab(src, '_meetKpiRows') === grab(prev, '_meetKpiRows'), 'KPI行の定義を触っていない');
ok(/cumulativeToToday\(store\.id, ym\)/.test(card), 'v906の日別累計予算が残っている');
ok(/max-width:560px/.test(src), 'v905のPCレイアウトが残っている');
ok(prev.indexOf('_meetPinHtml') < 0, 'v906 には無かった関数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 907, 'APP_VERSION が 907 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
