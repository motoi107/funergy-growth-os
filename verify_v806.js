/* verify_v806.js — 棚卸が「何月分」かを取り違えないようにする */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v805_backup.html', 'utf8');
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
console.log('\n=== v806: 棚卸の対象月を取り違えない ===\n');

function build(off, lang) {
  return new Function('OFF', 'LANG', `
    var invMonthOffset=OFF, curLang=LANG||'ja';
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function renderPage(){}
    ${grab(src, '_invMonthRel')}
    ${grab(src, 'renderInvMonthBanner')}
    ${grab(src, 'invConfirmMonthText')}
    return { rel:_invMonthRel, banner:renderInvMonthBanner, confirmText:invConfirmMonthText };
  `)(off, lang);
}

console.log('[1] 対象月が主役になっている');
{
  const e = build(0);
  const h = e.banner('F01', '2026-08', null, false, '2026年8月', false);
  ok(/2026年8月/.test(h), '対象月が出る');
  const m = h.match(/font-size:(\d+)px;font-weight:800[^>]*>2026年8月/);
  ok(!!m && Number(m[1]) >= 20, '月が大きい文字で出る（' + (m ? m[1] : '?') + 'px）', m && m[1]);
  ok(/この画面で入力・表示しているのは/.test(h), '何の月なのか説明がある');
  /* v805 は 14px で月ナビの中に埋もれていた */
  const old = prev.slice(prev.indexOf('// 月ナビ'), prev.indexOf('// 月ナビ') + 900);
  ok(/font-size:14px/.test(old), 'v805 は 14px だった');
  ok(!/font-size:14px[^>]*>\$\{_mLabel\}/.test(src), 'v806 では小さい表示に戻っていない');
}

console.log('\n[2] 今月との関係が分かる');
{
  ok(build(0).rel(0).label === '当月', '0 は当月');
  ok(build(0).rel(-1).label === '先月', '-1 は先月');
  ok(build(0).rel(-3).label === '3ヶ月前', '-3 は3ヶ月前', build(0).rel(-3));
  ok(build(0).rel(0).warn === false, '当月は警告なし');
  ok(build(0).rel(-1).warn === true, '先月は警告あり');
  const h0 = build(0).banner('F01', '2026-08', null, false, '2026年8月', false);
  ok(/当月/.test(h0), '当月と出る');
  ok(!/今月ではありません/.test(h0), '当月なら警告を出さない');
  const h1 = build(-1).banner('F01', '2026-07', null, false, '2026年7月', false);
  ok(/先月/.test(h1), '先月と出る');
  ok(/今月ではありません/.test(h1), '当月以外は警告を出す');
  ok(/今月へ戻る/.test(h1), '戻る導線が帯の中にある');
  ok(/var\(--yellow\)/.test(h1), '当月以外は色を変える');
}

console.log('\n[3] 入力できる状態かが分かる');
{
  const e = build(0);
  ok(/未入力/.test(e.banner('F01', '2026-08', null, false, '8月', false)), '未入力');
  ok(/入力中（未確定）/.test(e.banner('F01', '2026-08', null, false, '8月', true)), '入力中');
  ok(/確定済み/.test(e.banner('F01', '2026-08', { grand: 1 }, false, '8月', true)), '確定済み');
  ok(/確定済みを修正中/.test(e.banner('F01', '2026-08', { grand: 1 }, true, '8月', true)), '修正中');
  /* v805 にあった3状態を落としていない */
  ok(prev.indexOf('Not entered') >= 0 && src.indexOf('Not entered') >= 0, '未入力の区別を引き継いでいる');
  ok(src.indexOf('In progress') >= 0, '入力中の区別も引き継いでいる');
}

console.log('\n[4] 月の移動');
{
  const h0 = build(0).banner('F01', '2026-08', null, false, '8月', false);
  ok(/invNavMonth\(-1\)/.test(h0) && /invNavMonth\(1\)/.test(h0), '前後の月へ移動できる');
  ok(/disabled/.test(h0), '当月では「次の月」を押せない（未来に行かせない）');
  const h1 = build(-1).banner('F01', '2026-07', null, false, '7月', false);
  ok(!/disabled/.test(h1), '過去月では次の月へ進める');
  ok(/aria-label="前の月"/.test(h0), '読み上げ用の名前がある');
}

console.log('\n[5] 確定前の最終確認');
{
  ok(build(0).confirmText('2026-08') === '2026年8月分（当月）', '当月と明示', build(0).confirmText('2026-08'));
  ok(build(-1).confirmText('2026-07') === '2026年7月分（先月）', '先月と明示', build(-1).confirmText('2026-07'));
  ok(build(0).confirmText('') === '', '不正な値では空');
  ok(/invConfirmMonthText\(_ym\)/.test(grab(src, 'saveInventory')), '確定時にこの文言を使う');
  ok(!/月分の棚卸として確定しますか/.test(src), '古い確認文が残っていない');
  ok(/よろしいですか/.test(grab(src, 'saveInventory')), '確認を求めている');
}

console.log('\n[6] スマホ表示');
{
  const h = build(-1).banner('F01', '2026-07', null, false, '2026年7月', false);
  ok(/min-width:0/.test(h), '横あふれを防ぐ');
  ok(/flex-wrap:wrap/.test(h), '狭い幅で折り返す');
  ok(/flex:0 0 44px/.test(h), '前後ボタンが指で押せる大きさ');
  ok(!/(^|[^-\w])width:\s*\d{3,}px/.test(h), '固定の大きな横幅を使っていない');
}

console.log('\n[7] 表示のみ・既存への影響');
{
  ['renderInvMonthBanner', '_invMonthRel', 'invConfirmMonthText'].forEach(function (fn) {
    ok(!/lsSet\(/.test(grab(src, fn)), fn + ' は何も保存しない');
  });
  ok(prev.indexOf('renderInvMonthBanner') < 0, 'v805 には無かった');
  ok(/renderInvMonthBanner\(storeId, _ym, _snap, _editing, _mLabel/.test(grab(src, 'renderInventory')), '棚卸画面に出る');
  const ri = grab(src, 'renderInventory'), rp = grab(prev, 'renderInventory');
  ok(ri.indexOf('invSnapForYm') >= 0 && rp.indexOf('invSnapForYm') >= 0, '対象月の判定は変えていない');
  ok(grab(src, 'invYm') === grab(prev, 'invYm'), '月の決め方は1文字も変えていない');
  ok(grab(src, 'invNavMonth') === grab(prev, 'invNavMonth'), '月の移動処理も変えていない');
  ok(grab(src, 'invRenderConfirmedView') === grab(prev, 'invRenderConfirmedView'), '確定済みビューも変えていない');
  ok(grab(src, 'invCogsBreakdown') === grab(prev, 'invCogsBreakdown'), '原価計算も変えていない');
  /* saveInventory は確認文だけの変更 */
  const norm = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  const newSet = new Set(norm(grab(src, 'saveInventory')));
  const removed = norm(grab(prev, 'saveInventory')).filter(l => !newSet.has(l));
  ok(removed.length === 1 && /確定しますか/.test(removed[0]), 'saveInventory の変更は確認文の1行だけ', removed);
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
