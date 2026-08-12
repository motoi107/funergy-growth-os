/* verify_v908.js — 予算の考え方の固定表示／第3層の統合／速報・確定マーク

   ① 予算の考え方が固定帯にあり、横スクロールで流れない位置に置かれている
   ② 旧位置のボタンが消えている（二重に置かない）
   ③ 第3層（年間KPI一覧）が中間MTGの店舗カードの下に出る
   ④ 月初MTGは壊れていない
   ⑤ 確定/速報の判定が pl_actual の有無で決まり、色だけでなく文字でも出る
   ⑥ 上書きしていない（PLとアプリの差は消さない）
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v907_backup.html', 'utf8');

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

const pin = grab(src, '_meetPinHtml');
const card = grab(src, '_meetStoreCard');

/* ---------- ① 予算の考え方が固定帯にある ---------- */
ok(/openBudgetReview/.test(pin), '予算の考え方が固定帯の中にある');
ok(/position:sticky/.test(pin) && /top:52px/.test(pin), '帯は貼り付いたまま');
ok(/flex:0 0 auto/.test(pin.slice(pin.indexOf('openBudgetReview') - 300)), 'ボタンが縮まない指定');
(() => {
  /* 横スクロール領域の中に入っていないこと。入っていると右へ流れて消える。 */
  const sc = pin.indexOf('overflow-x:auto');
  const close = pin.indexOf("h += '</div>';", sc);
  const btn = pin.indexOf('openBudgetReview');
  ok(close > 0 && btn > close, 'ボタンが横スクロール領域の外にある（右へ流れて消えない）', 'scroll終端@' + close + ' btn@' + btn);
})();

/* ---------- ② 旧位置は消えている ---------- */
ok(!/当月 予算の考え方/.test(card), 'カード中ほどの旧ボタンが消えている');
ok(/当月 予算の考え方/.test(prev), 'v907 には旧ボタンがあった（変更が効いている確認）');
ok((card.match(/openBudgetReview/g)||[]).length === 0, 'カード本体からは呼ばれていない（帯からのみ）');

/* ---------- ③ 第3層 ---------- */
ok(/html \+= _meetStoreCard\(x\.s, x\.k, ym, isCurrent\);\r?\n\s*try \{ html \+= _meetYearMatrix\(x\.s, ym0\.y\); \} catch\(e\)\{\}/.test(src),
   '中間MTGで店舗カードの下に年間KPI一覧が出る');
ok(!/_meetYearMatrix/.test(prev.slice(prev.indexOf('else { ks.forEach(function(x){ html+=_meetStoreCard'), prev.indexOf('else { ks.forEach(function(x){ html+=_meetStoreCard') + 200)),
   'v907 の中間MTGには年間一覧が無かった');
/* v912 で月初/中間が統合され、呼び出しは 定義1＋1店用1 の計2つになった。
   v908 の主張は「中間でも年間一覧が出る」なので、そこを見る。 */
ok((src.match(/_meetYearMatrix\(/g)||[]).length === 2, '_meetYearMatrix の呼び出しは定義1＋描画1', (src.match(/_meetYearMatrix\(/g)||[]).length);
/* v908 の追加分だけを剥がして比べる。正規表現で継ぎ接ぎすると
   「検証が壊れているのか製品が壊れているのか」が分からなくなる。 */
(() => {
  const strip = t => t.replace(/\s*\/\* v908[^*]*\*\/\s*/g, '')
                      .replace(/\+'<div style="margin-top:2px">'\+_meetConfirmBadge\(sid, M\.ym, true\)\+'<\/div>'/g, '')
                      .replace(/\s+/g, '');
  /* v909 が「昨年」行を足したので、現在のソースではなく v907→v908 の差で見る。 */
  ok(strip(grab(fs.readFileSync('index_v908_backup.html','utf8'), '_meetYearMatrix')) ===
     strip(grab(prev, '_meetYearMatrix')),
     'v908 は年間一覧の月見出し以外を触っていなかった');
})();

/* ---------- ④ 月初MTGが壊れていない ---------- */
ok(/if\(mode==='start'\)\{ ks\.forEach\(function\(x\)\{ html\+=_meetYearMatrix\(x\.s, ym0\.y\)\+_meetTaskSection\(x\.s\); \}\); \}/.test(fs.readFileSync('index_v908_backup.html','utf8')),
   'v908 の時点では月初MTGが従来どおりだった');
ok(/setMeetMode/.test(src) && /中間MTG/.test(src) && /月初MTG/.test(src), 'モード切替のタブが残っている');

/* ---------- ⑤ 確定/速報 ---------- */
ok(grab(src, '_meetIsConfirmed').length > 0, '_meetIsConfirmed がある');
ok(grab(src, '_meetConfirmBadge').length > 0, '_meetConfirmBadge がある');
ok(/ls\('pl_actual', null\)/.test(grab(src, '_meetIsConfirmed')), '判定は pl_actual の有無');
ok(/a\[ym\] && a\[ym\]\[storeId\]/.test(grab(src, '_meetIsConfirmed')), '月×店で判定する');
ok(/_meetConfirmBadge\(sid, M\.ym, true\)/.test(src), '年間一覧の月見出しにバッジが出る');
ok(/_meetConfirmBadge\(store\.id, ymForPin\)/.test(pin), '固定帯にもバッジが出る');

/* 実行して中身を見る */
(() => {
  const PL = { '2026-05': { F01:{sales:1}, F02:{sales:1} }, _src: { '2026-05':'Excel取込（暫定PL）' } };
  const sb = { ls:(k,d)=> (k==='pl_actual' ? PL : d), escapeHtml:x=>String(x), t:ja=>ja, console };
  const K = Object.keys(sb);
  const F = new Function(...K, grab(src,'_meetIsConfirmed') + grab(src,'_meetConfirmSrc') + grab(src,'_meetConfirmBadge')
    + '\nreturn{_meetIsConfirmed,_meetConfirmBadge,_meetConfirmSrc}')(...K.map(k=>sb[k]));
  ok(F._meetIsConfirmed('F02','2026-05') === true, 'PL取込のある月は確定');
  ok(F._meetIsConfirmed('F02','2026-07') === false, 'PL取込の無い月は速報');
  ok(F._meetIsConfirmed('F05','2026-05') === false, '同じ月でも店が無ければ速報');
  ok(F._meetConfirmSrc('2026-05') === 'Excel取込（暫定PL）', '取込元が取れる', F._meetConfirmSrc('2026-05'));
  const b1 = F._meetConfirmBadge('F02','2026-05');
  const b2 = F._meetConfirmBadge('F02','2026-07');
  ok(/確定/.test(b1) && !/速報/.test(b1), '確定は「確定」と文字で出る');
  ok(/速報/.test(b2) && !/確定/.test(b2), '速報は「速報」と文字で出る');
  ok(/Excel取込（暫定PL）/.test(b1), '確定は取込元を title に出す');
  ok(b1 !== b2 && /var\(--green\)/.test(b1), '色でも区別する（色だけには頼らない）');
  ok((b1.match(/<span/g)||[]).length === (b1.match(/<\/span>/g)||[]).length, 'spanの開閉が一致');
  /* pl_actual が壊れていても落ちない */
  const F2 = new Function('ls','escapeHtml','t','console', grab(src,'_meetIsConfirmed') + '\nreturn{_meetIsConfirmed}')
    (()=>{ throw new Error('boom'); }, x=>x, ja=>ja, console);
  let err = null; let r = null;
  try { r = F2._meetIsConfirmed('F02','2026-05'); } catch(e){ err = e.message; }
  ok(err === null && r === false, '読めないときは例外にせず速報扱い', err);
})();

/* ---------- ⑥ 上書きしていない ---------- */
ok(!/pl_actual[\s\S]{0,200}lsSet/.test(grab(src,'_meetIsConfirmed')), '判定関数は書き込まない');
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'アプリ側の実績計算を触っていない（PLで上書きしない）');
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '差分分解を触っていない');
ok(/cumulativeToToday\(store\.id, ym\)/.test(card), 'v906の日別累計予算が残っている');
ok(/max-width:560px/.test(src), 'v905のPCレイアウトが残っている');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 908, 'APP_VERSION が 908 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
