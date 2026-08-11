/* verify_v909.js — 2025年の確定PLと昨対

   データが正しく埋め込まれているかを、埋め込み後のソースから実際に読んで検算する。
   ① 67レコード、6店舗、消費税の式が閉じる
   ② 売上が税抜（2026年と定義が揃っている）
   ③ 前年データが無い店（Aiea/Marujuu）は null で返り、0にならない
   ④ 昨対の計算と色分け
   ⑤ 年間一覧に「昨年」行が売上だけ足されている
*/
const fs = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v908_backup.html', 'utf8');

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

/* ---------- 定数を実際に読み込む ---------- */
const seedSrc = src.slice(src.indexOf('var PL2025_SEED = {'), src.indexOf('};', src.indexOf('var PL2025_SEED = {')) + 2);
ok(seedSrc.length > 1000, 'PL2025_SEED が埋め込まれている', seedSrc.length);
const SEED = new Function(seedSrc + '\nreturn PL2025_SEED;')();

/* ---------- ① 件数と検算 ---------- */
(() => {
  const months = Object.keys(SEED);
  ok(months.length === 12, '12か月ぶんある', months.length);
  ok(months[0] === '2025-01' && months[11] === '2025-12', '2025年1〜12月', months[0] + '..' + months[11]);
  let n = 0, bad = [], stores = {};
  months.forEach(ym => Object.keys(SEED[ym]).forEach(sid => {
    n++; stores[sid] = (stores[sid]||0) + 1;
    const v = SEED[ym][sid];
    ['sales','tax','cogs','payroll','opex','netop'].forEach(k => {
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) bad.push(ym+'/'+sid+'/'+k);
    });
    const lhs = v.sales + v.tax - v.cogs - v.payroll - v.opex;
    if (Math.abs(lhs - v.netop) > 2) bad.push(ym+'/'+sid+' 式が閉じない ' + lhs + ' vs ' + v.netop);
  }));
  ok(n === 67, '67レコード', n);
  ok(bad.length === 0, '全件で sales+tax-cogs-payroll-opex = netop（丸め±$2以内）', bad.slice(0,3).join(' / '));
  ok(JSON.stringify(stores) === JSON.stringify({F01:12,F02:12,F03:12,'F03-G':12,'F04-K':12,'F04-P':7}),
     '店舗ごとの月数（F04-Pは6月開店で7か月）', JSON.stringify(stores));
})();

/* ---------- ② 税抜であること ---------- */
(() => {
  const v = SEED['2025-01']['F01'];
  ok(v.sales === 118293, 'F01 1月 売上（税抜） $118,293', v.sales);
  ok(v.tax === 5574, 'F01 1月 消費税 $5,574 が別に残っている', v.tax);
  ok(Math.abs(v.tax / (v.sales + v.tax) - 0.045) < 0.002, '税率が約4.5%（税抜になっている裏付け）', (v.tax/(v.sales+v.tax)*100).toFixed(2)+'%');
  /* 税込のままなら 123,867 になるはず。そうなっていないこと。 */
  ok(v.sales !== 123867, '税込の値をそのまま入れていない');
  /* 予算進捗2025との突き合わせ（7月） */
  ok(Math.abs(SEED['2025-07']['F03'].sales - 57670) < 2, 'F03 7月 $57,670（予算進捗の57,177と1%以内）', SEED['2025-07']['F03'].sales);
  ok(Math.abs(SEED['2025-06']['F04-P'].sales - 16880) < 2, 'F04-P 6月 $16,880（予算進捗と完全一致した月）', SEED['2025-06']['F04-P'].sales);
})();

/* 赤字の月が保持されている（負の値を落としていない） */
(() => {
  let neg = 0;
  Object.keys(SEED).forEach(ym => Object.keys(SEED[ym]).forEach(s => { if (SEED[ym][s].netop < 0) neg++; }));
  ok(neg === 6, '赤字の月が6件そのまま入っている（負の値を落としていない）', neg);
})();

/* ---------- ③④ ヘルパーを動かす ---------- */
const sb = {
  PL2025_SEED: SEED,
  fmtK: v => '$' + (parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  escapeHtml: x => String(x), t: ja => ja, console,
};
const K = Object.keys(sb);
const F = new Function(...K, grab(src,'_plPrevYear') + grab(src,'_plYoY') + grab(src,'_plYoYHtml')
  + '\nreturn{_plPrevYear,_plYoY,_plYoYHtml}')(...K.map(k => sb[k]));

ok(F._plPrevYear('F01','2026-01').sales === 118293, '2026-01 の前年は 2025-01', F._plPrevYear('F01','2026-01').sales);
ok(F._plPrevYear('F04-A','2026-03') === null, 'Aiea は前年データなし → null（0にしない）', JSON.stringify(F._plPrevYear('F04-A','2026-03')));
ok(F._plPrevYear('F05','2026-03') === null, 'Marujuu も null');
ok(F._plPrevYear('F04-P','2026-03') === null, 'Piikoi の3月は前年が無い（6月開店）→ null');
ok(F._plPrevYear('F04-P','2026-07') !== null, 'Piikoi の7月は前年がある');
ok(F._plPrevYear('F01','2027-01') === null, '2027年（前年=2026）はデータが無い → null');
ok(F._plPrevYear('F01','') === null, '空文字でも落ちない');

ok(F._plYoY('F01','2026-01', 129000) === 109.1, '129,000 / 118,293 = 109.1%（小数1桁で丸め）', F._plYoY('F01','2026-01',129000));
ok(F._plYoY('F01','2026-01', null) === null, '実績なしは null');
ok(F._plYoY('F04-A','2026-03', 100000) === null, '前年なしは null');

(() => {
  const h1 = F._plYoYHtml('F01','2026-01', 129000);
  ok(/109\.1%/.test(h1), '昨対が表示される');
  ok(/var\(--green\)/.test(h1), '100%以上は緑');
  ok(/\$118,293\.00/.test(h1), '前年額も出る');
  const h2 = F._plYoYHtml('F01','2026-01', 110000);
  ok(/var\(--red\)/.test(h2), '95%未満は赤', h2.match(/var\(--\w+\)/)[0]);
  const h3 = F._plYoYHtml('F01','2026-01', 114000);
  ok(/var\(--yellow\)/.test(h3), '95〜100%は黄');
  const h4 = F._plYoYHtml('F04-A','2026-03', 100000);
  ok(/前年なし/.test(h4) && !/NaN|Infinity/.test(h4), '前年なしは「前年なし」と出す', h4.slice(0,60));
  const h5 = F._plYoYHtml('F01','2026-01', null);
  ok(/前年/.test(h5) && !/NaN/.test(h5), '実績なしでも前年額は出す');
  [h1,h2,h3,h4,h5].forEach((h,i) => ok((h.match(/<span/g)||[]).length === (h.match(/<\/span>/g)||[]).length, 'spanの開閉が一致 #' + (i+1)));
})();

/* ---------- ⑤ 画面への繋ぎ込み ---------- */
const mat = grab(src, '_meetYearMatrix');
ok(/if \(kk === 'sales'\) \{/.test(mat), '昨年行は売上のときだけ足す');
ok(/_plPrevYear\(sid, M\.ym\)/.test(mat), '年間一覧が前年を引いている');
ok(/t\('昨年','Prev yr'\)/.test(mat), '「昨年」のラベルがある');
ok((mat.match(/_plPrevYear/g)||[]).length === 1, '前年の参照は1か所（全KPIに増殖していない）');
const card = grab(src, '_meetStoreCard');
ok(/_plYoYHtml\(store\.id, ym, landing\)/.test(card), '売上ヒーローで着地予測と前年を比べる');
ok(/try \{ h\+='<div style="margin-top:3px"><i class="ti ti-calendar-stats"/.test(card), 'try で囲ってある');
ok(/着地予測との比較/.test(src), '何と比べているかを画面に書いている');
ok(/Aiea・Marujuuは前年データがありません/.test(src), '前年が無い店を凡例で明示');

/* ---------- 壊していない ---------- */
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない');
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '差分分解を触っていない');
/* v910 が pl_public 対応で _meetIsConfirmed を変えたので、v908→v909 の差で見る。 */
ok(grab(fs.readFileSync('index_v909_backup.html','utf8'), '_meetIsConfirmed') === grab(prev, '_meetIsConfirmed'),
   'v909 は確定判定を触っていなかった');
ok(/cumulativeToToday\(store\.id, ym\)/.test(card), 'v906の日別累計予算が残っている');
ok(prev.indexOf('PL2025_SEED') < 0, 'v908 には無かった定数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 909, 'APP_VERSION が 909 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
