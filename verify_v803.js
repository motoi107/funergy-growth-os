/* verify_v803.js — 棚卸確定月の原価内訳
   最重要：表示だけで、棚卸・原価・伝票の保存状態を1バイトも変えないこと。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v802_backup.html', 'utf8');
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
console.log('\n=== v803: 棚卸確定月の原価内訳 ===\n');

function build(fc, opts) {
  opts = opts || {};
  return new Function('FC', 'O', `
    var store={};
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function invFmtMoney(n){ return '$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}); }
    /* 原価の単一計算口は実物をそのまま使う */
    function getFcMonthly(){ return FC; }
    function monthInvoiceCostYm(){ return O.invoice||0; }
    function monthPurchaseCostYm(){ return O.buy||0; }
    function monthTransferNetYm(){ return O.tnet || {inAmt:0,outAmt:0,net:0,inCount:0,outCount:0}; }
    function monthNonCostYm(){ return O.nonCost || {total:0, byPurpose:{}}; }
    function monthInvoiceTotalYm(){ return O.invoiceTotal!=null?O.invoiceTotal:(O.invoice||0); }
    ${grab(src, 'foodCostOf')}
    ${grab(src, 'fcModeBadge')}
    ${grab(src, '_fcMoney')}
    ${grab(src, '_fcPrevYm')}
    ${grab(src, 'invCogsBreakdown')}
    ${grab(src, 'renderInvCogsCard')}
    return { calc:invCogsBreakdown, render:renderInvCogsCard, core:foodCostOf,
             prevYm:_fcPrevYm, store:function(){return store;}, ls:ls, lsSet:lsSet };
  `)(fc, opts);
}

const SNAP = { grand: 42000, lines: [{}, {}, {}], by: 'Moto', date: '2026-08-01' };

console.log('[1] 計算式（期首 ＋ 仕入 ＋ 移動 − 期末）');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 300000 },
    { invoice: 92000, buy: 3000, tnet: { inAmt: 5000, outAmt: 2000, net: 3000, inCount: 2, outCount: 1 } });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.begin === 40000, '前月の棚 = 4万', d.begin);
  ok(d.invoice === 92000, '今月の仕入(Invoice) = 9.2万', d.invoice);
  ok(d.buy === 3000, '買い出し = 3千', d.buy);
  ok(d.transfer === 3000, '食材移動の差引 = +3千（受入5千−払出2千）', d.transfer);
  ok(d.tIn === 5000 && d.tOut === 2000, '受入・払出の内訳を持つ', [d.tIn, d.tOut]);
  ok(d.end === 42000, '今月の棚 = 4.2万', d.end);
  /* 40000 + (92000+3000+3000) - 42000 = 96000 */
  ok(d.cost === 96000, '原価 = 9.6万', d.cost);
  ok(d.rate === 32, '原価率 32.0%（96000/300000）', d.rate);
  ok(d.hasEnd === true && d.mode === 'confirmed', '期末が入っていれば確定扱い');
}

console.log('\n[2] 既存の計算口と同じ数字か');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 300000 },
    { invoice: 92000, buy: 3000, tnet: { inAmt: 5000, outAmt: 2000, net: 3000 } });
  const core = e.core('F01', '2026-08');
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.cost === core.cost, '原価が foodCostOf と一致', [d.cost, core.cost]);
  ok(d.rate === core.rate, '原価率も一致（この画面で別計算していない）', [d.rate, core.rate]);
  ok(/foodCostOf\(/.test(grab(src, 'invCogsBreakdown')), '単一計算口をそのまま呼んでいる');
  ok(!/begin \+ purch - end/.test(grab(src, 'invCogsBreakdown')), '式を書き写していない（二重管理にしない）');
}

console.log('\n[3] 前月の表示');
{
  const e = build({ beginInv: 1, endInv: 1, sales: 1 }, {});
  ok(e.prevYm('2026-08') === '2026-07', '前月が出る');
  ok(e.prevYm('2026-01') === '2025-12', '年をまたぐ（1月→前年12月）', e.prevYm('2026-01'));
  ok(e.prevYm('') === '', '空でも落ちない');
  const h = e.render('F01', '2026-08', SNAP);
  ok(/7月末の棚/.test(h), '「7月末の棚（期首）」と出る');
  ok(/8月末の棚/.test(h), '「8月末の棚（期末）」と出る');
  ok(/8月の仕入/.test(h), '「8月の仕入」と出る');
}

console.log('\n[4] 画面に4要素と原価率が出る');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 300000 },
    { invoice: 92000, buy: 3000, tnet: { inAmt: 5000, outAmt: 2000, net: 3000, inCount: 2, outCount: 1 }, nonCost: { total: 8000, byPurpose: { '備品・消耗品': 8000 } }, invoiceTotal: 100000 });
  const h = e.render('F01', '2026-08', SNAP);
  ok(/\$40,000/.test(h), '前月の棚が出る');
  ok(/\$92,000/.test(h), '今月の仕入が出る');
  ok(/食材移動/.test(h), '食材移動が出る');
  ok(/\$42,000/.test(h), '今月の棚が出る');
  ok(/32\.0%/.test(h), '原価率が出る');
  ok(/\$96,000/.test(h), '原価金額が出る');
  ok(/受入 \$5,000（2件）/.test(h), '移動の内訳（受入）が出る');
  ok(/払出 \$2,000（1件）/.test(h), '移動の内訳（払出）が出る');
  ok(/詳細/.test(h) && /<details/.test(h), '詳細は折りたたみで小さく出る');
  ok(/原価外/.test(h) || /含めていません/.test(h), '原価に含めない分があることを伝える');
  ok(/備品・消耗品/.test(h), '原価外の内訳も詳細に出る');
  ok(/\$100,000/.test(h), 'Invoice 全体の合計も詳細に出る');
  ok(/確定/.test(h), '確定バッジが出る');
}

console.log('\n[5] 食材移動がマイナスのとき');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 300000 },
    { invoice: 92000, tnet: { inAmt: 1000, outAmt: 4000, net: -3000, inCount: 1, outCount: 2 } });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.transfer === -3000, '払出が多ければマイナス', d.transfer);
  ok(d.cost === 87000, '原価から差し引かれる（40000+89000-42000）', d.cost);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/−<\/span>|−/.test(h), 'マイナス記号で表示する');
  ok(!/\$-3,000/.test(h), 'マイナス金額をそのまま書かない（記号で表す）');
}

console.log('\n[6] 棚卸総額と期末棚卸額のずれ');
{
  /* 棚卸は4.2万で確定したのに、原価管理の期末が3.5万に書き換えられている */
  const e = build({ beginInv: 40000, endInv: 35000, sales: 300000 }, { invoice: 92000 });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.endGap === 7000, 'ずれを検出する', d.endGap);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/ずれ/.test(h), 'ずれを画面に出す（黙って隠さない）');
  ok(/\$42,000/.test(h) && /\$35,000/.test(h), '両方の金額を出す');
  ok(/期末棚卸額のほうで計算/.test(h), 'どちらで計算したか明示する');
  /* 一致していれば出さない */
  const e2 = build({ beginInv: 40000, endInv: 42000, sales: 300000 }, { invoice: 92000 });
  ok(e2.calc('F01', '2026-08', SNAP).endGap === 0, '一致していればずれ0');
  ok(!/ずれ/.test(e2.render('F01', '2026-08', SNAP)), '一致していれば警告を出さない');
}

console.log('\n[7] 売上や期首が無いとき');
{
  const e = build({ beginInv: 0, endInv: 42000, sales: 0 }, { invoice: 92000 });
  const d = e.calc('F01', '2026-08', SNAP);
  ok(d.rate === 0, '売上が無ければ率は0（割らない）', d.rate);
  const h = e.render('F01', '2026-08', SNAP);
  ok(/—/.test(h), '率は「—」で出す（0.0%とは書かない）');
  ok(/売上が入っていない/.test(h), '理由を書く');
  ok(/原価金額は確定/.test(h), '金額は出せることを伝える');
  ok(/未設定/.test(h) && /前月の棚卸を確定すると入ります/.test(h), '期首が無い理由と直し方を書く');
}

console.log('\n[8] 保存状態を壊さない（最重要）');
{
  const e = build({ beginInv: 40000, endInv: 42000, sales: 300000 },
    { invoice: 92000, tnet: { inAmt: 5000, outAmt: 2000, net: 3000 } });
  e.lsSet('invoices', [{ id: 'i1', total: 100 }]);
  e.lsSet('fc_monthly', { 'F01': { '2026-08': { endInv: 42000 } } });
  e.lsSet('inv_2026-08_F01', { grand: 42000 });
  const before = JSON.stringify(e.store());
  e.calc('F01', '2026-08', SNAP);
  e.render('F01', '2026-08', SNAP);
  e.render('F01', '2026-08', SNAP);
  ok(JSON.stringify(e.store()) === before, '表示しても保存内容が1バイトも変わらない');
  /* snap を書き換えていない */
  const snapCopy = JSON.parse(JSON.stringify(SNAP));
  e.render('F01', '2026-08', SNAP);
  ok(JSON.stringify(SNAP) === JSON.stringify(snapCopy), '棚卸スナップショットを書き換えない');
  ['invCogsBreakdown', 'renderInvCogsCard', '_fcMoney', '_fcPrevYm'].forEach(function (fn) {
    const b = grab(src, fn);
    ok(!/lsSet\(|setFcMonthly\(|saveInv|localStorage\.setItem/.test(b), fn + ' は保存経路を持たない');
  });
  /* 既存の保存箇所が増えていない */
  ['fc_monthly', 'invoices', 'ing_transfers'].forEach(function (k) {
    const re = new RegExp("lsSet\\('" + k + "'", 'g');
    ok((prev.match(re) || []).length === (src.match(re) || []).length, k + ' の保存箇所は v802 と同数');
  });
}

console.log('\n[9] 既存への影響');
{
  ok(prev.indexOf('renderInvCogsCard') < 0, 'v802 には無かった');
  ok(grab(src, 'foodCostOf') === grab(prev, 'foodCostOf'), '原価の計算口は1文字も変えていない');
  ok(grab(src, 'monthTransferNetYm') === grab(prev, 'monthTransferNetYm'), '食材移動の集計も変えていない');
  ok(grab(src, 'saveInventory') === grab(prev, 'saveInventory'), '棚卸の確定処理（saveInventory）も変えていない');
  ok(grab(src, 'invLastConfirmedGrand') === grab(prev, 'invLastConfirmedGrand'), '確定済み総額の取得も変えていない');
  /* 確定済みビューにだけ差し込まれている */
  const view = grab(src, 'invRenderConfirmedView');
  ok(/renderInvCogsCard\(storeId, ym, snap\)/.test(view), '確定済みビューに出る');
  ok(/try\{[^}]*renderInvCogsCard[^}]*\}catch/.test(view), '例外が出ても棚卸画面が壊れない');
  ok(view.indexOf('renderInvCogsCard') < view.indexOf('// 明細（業者別）'), '明細より前に出る');
  ok((view.match(/renderInvCogsCard/g) || []).length === 1, '1回だけ出る');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
