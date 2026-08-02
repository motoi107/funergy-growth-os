/* verify_v805.js — 棚卸の原価計算に、その月の実績売上を自動反映 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v804_backup.html', 'utf8');
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
console.log('\n=== v805: 棚卸の原価計算に実績売上を自動反映 ===\n');

function build(fc, actuals, opts) {
  opts = opts || {};
  return new Function('FC', 'ACT', 'O', `
    var store={};
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function invFmtMoney(n){ return '$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US'); }
    function getFcMonthly(){ return FC; }
    function getDailyActuals(){ return ACT; }
    function monthInvoiceCostYm(){ return O.invoice||0; }
    function monthPurchaseCostYm(){ return O.buy||0; }
    function monthTransferNetYm(){ return O.tnet || {inAmt:0,outAmt:0,net:0,inCount:0,outCount:0}; }
    function monthNonCostYm(){ return {total:0, byPurpose:{}}; }
    function monthInvoiceTotalYm(){ return O.invoice||0; }
    /* monthStats は実物を使い、ym版と同じ数字になるか確かめる */
    function bizNow(){ return new Date('2026-08-15T12:00:00'); }
    ${grab(src, 'monthStats')}
    ${grab(src, 'foodCostOf')}
    ${grab(src, 'fcModeBadge')}
    ${grab(src, 'monthSalesOfYm')}
    ${grab(src, '_fcMoney')}
    ${grab(src, '_fcPrevYm')}
    ${grab(src, 'invCogsBreakdown')}
    ${grab(src, 'renderInvCogsCard')}
    return { calc:invCogsBreakdown, render:renderInvCogsCard,
             salesYm:monthSalesOfYm, stats:monthStats, store:function(){return store;} };
  `)(fc, actuals, opts);
}
const SNAP = { grand: 42000, lines: [{}, {}] };
/* 8月の日次実績：3日ぶんで合計 30万 */
const ACT = {
  '2026-08-01': { actual: 100000 },
  '2026-08-02': { actual: 120000 },
  '2026-08-03': { actual: 80000 },
  '2026-07-31': { actual: 999999 },   /* 別の月。混ざってはいけない */
  '2026-08-04': { guests: 30 }        /* 売上未入力の日 */
};

console.log('[1] 実績売上を自動で使う');
{
  const e = build({ beginInv: 40000, endInv: 42000 }, ACT, { invoice: 92000 });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.sales === 300000, 'その月の実績売上 30万が入る', d.sales);
  ok(d.salesSrc === 'actual', '出どころは実績', d.salesSrc);
  ok(d.salesDays === 3, '売上のある日だけ数える（3日）', d.salesDays);
  /* 40000 + 92000 - 42000 = 90000 → 90000/300000 = 30% */
  ok(d.cost === 90000, '原価 9万', d.cost);
  ok(d.rate === 30, '原価率 30.0%（自動で出る）', d.rate);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/30\.0%/.test(h), '画面に原価率が出る');
  ok(/日次実績 3日ぶんを自動反映/.test(h), '出どころを画面に書く');
  /* v804 では売上0で率が出なかった */
  ok(!/foodCostOf\(storeId, ym\)\s*:/.test(grab(src, 'invCogsBreakdown')), 'v805 は売上を渡している');
  ok(/foodCostOf\(storeId, ym\)\s*:/.test(grab(prev, 'invCogsBreakdown')), 'v804 は売上を渡していなかった');
}

console.log('\n[2] 月をまたがない');
{
  const e = build({ beginInv: 0, endInv: 1 }, ACT, {});
  ok(e.salesYm('F01', '2026-08').sales === 300000, '8月は30万', e.salesYm('F01', '2026-08'));
  ok(e.salesYm('F01', '2026-07').sales === 999999, '7月は別に数える', e.salesYm('F01', '2026-07'));
  ok(e.salesYm('F01', '2026-09').sales === 0, 'データが無い月は0');
  ok(e.salesYm('F01', '2026-09').days === 0, '日数も0');
}

console.log('\n[3] 既存画面と同じ数字か');
{
  const e = build({}, ACT, {});
  /* monthStats(offset=0) は今日(2026-08-15)基準＝8月 */
  ok(e.stats('F01', 0).sales === e.salesYm('F01', '2026-08').sales,
    '既存の monthStats と同じ数字（予実・原価管理と食い違わない）', [e.stats('F01', 0).sales, e.salesYm('F01', '2026-08').sales]);
  ok(e.stats('F01', -1).sales === e.salesYm('F01', '2026-07').sales, '前月も一致', [e.stats('F01', -1).sales, e.salesYm('F01', '2026-07').sales]);
  /* 原価管理タブと同じ優先順（手入力が先） */
  const body = grab(src, 'invCogsBreakdown');
  ok(/_manual \|\| _actual\.sales \|\| 0/.test(body), '手入力があればそれを優先（原価管理タブと同じ）');
  ok(/parseFloat\(fc\.sales\)\|\|stats\.sales\|\|0/.test(src), '原価管理タブの優先順は変わっていない');
}

console.log('\n[4] 手入力がある場合');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 280000 }, ACT, { invoice: 92000 });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.sales === 280000, '手入力を優先する', d.sales);
  ok(d.salesSrc === 'manual', '出どころは手入力', d.salesSrc);
  ok(d.salesActual === 300000, '実績も保持している（比較用）', d.salesActual);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/原価管理タブの手入力/.test(h), '手入力だと画面に書く');
  ok(/日次実績の合計は/.test(h) && /\$300,000/.test(h), 'ずれていることを知らせる');
  ok(/手入力を空にすると実績が自動で入ります/.test(h), '直し方を書く');
  /* 一致していれば警告を出さない */
  const e2 = build({ beginInv: 40000, endInv: 42000, sales: 300000 }, ACT, { invoice: 92000 });
  ok(!/日次実績の合計は/.test(e2.render('F01', '2026-08', SNAP)), '一致していれば警告なし');
}

console.log('\n[5] 売上が無いとき');
{
  const e = build({ beginInv: 40000, endInv: 42000 }, {}, { invoice: 92000 });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.sales === 0 && d.rate === 0, '売上0なら率は出さない（0除算しない）', [d.sales, d.rate]);
  ok(d.salesSrc === 'none', '出どころ無しと分かる', d.salesSrc);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/見つからないため/.test(h), '理由を書く');
  ok(/日次実績を入力するか/.test(h), '直し方を書く');
  ok(/原価金額は確定/.test(h), '金額は出せることを伝える');
  ok(/—/.test(h), '率は「—」で出す');
  /* 壊れた実績でも落ちない */
  const e2 = build({ endInv: 1 }, { '2026-08-01': { actual: 'あ' }, 'bad': null }, {});
  ok(typeof e2.salesYm('F01', '2026-08').sales === 'number', '数字でない実績でも落ちない', e2.salesYm('F01', '2026-08'));
  ok(e2.salesYm('F01', '2026-08').sales === 0, '数字にならない値は0として扱う');
}

console.log('\n[6] 副作用');
{
  const e = build({ beginInv: 40000, endInv: 42000 }, ACT, { invoice: 92000 });
  e.store()['fc_monthly'] = { x: 1 };
  const before = JSON.stringify(e.store());
  e.calc('F01', '2026-08', SNAP); e.render('F01', '2026-08', SNAP);
  ok(JSON.stringify(e.store()) === before, '表示しても保存内容が変わらない');
  ['monthSalesOfYm', 'invCogsBreakdown', 'renderInvCogsCard'].forEach(function (fn) {
    ok(!/lsSet\(/.test(grab(src, fn)), fn + ' は保存しない');
  });
  ok(grab(src, 'foodCostOf') === grab(prev, 'foodCostOf'), '原価の計算口は1文字も変えていない');
  ok(grab(src, 'monthStats') === grab(prev, 'monthStats'), '既存の月次集計も変えていない');
  ok(grab(src, 'getDailyActuals') === grab(prev, 'getDailyActuals'), '日次実績の取得も変えていない');
  ok(prev.indexOf('monthSalesOfYm') < 0, 'v804 には無かった');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
