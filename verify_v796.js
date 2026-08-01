/* verify_v796.js — 廃止したフィールドを読んでいる箇所が残っていないか
   v795 で個人係数(coef)を算定結果から外したが、一覧表の1箇所が b.coef.toFixed(2)
   を呼び続けており、セキュアページが TypeError で真っ白になった。
   「返していないフィールドを誰も読んでいない」を機械的に検査して再発を防ぐ。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v795_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}

console.log('\n=== v796: 廃止フィールドの参照残りを断つ ===\n');

/* bonusForEmp が実際に返すキーを、ソースから取る（テストに写しを持たない） */
function returnedKeys() {
  const body = grab(src, 'bonusForEmp');
  const ret = body.slice(body.indexOf('return {'));
  let d = 0, end = -1;
  for (let j = ret.indexOf('{'); j < ret.length; j++) {
    if (ret[j] === '{') d++;
    else if (ret[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  const obj = ret.slice(ret.indexOf('{'), end + 1);
  /* ネストした値の中のコロンを拾わないよう、深さ1のキーだけを取る */
  const keys = []; let depth = 0;
  obj.replace(/[{}]|([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, function (m, k, off) {
    if (m === '{') { depth++; return m; }
    if (m === '}') { depth--; return m; }
    if (depth === 1 && k) keys.push(k);
    return m;
  });
  return keys;
}

/* ---------- 1. 算定結果の消費側が、返っていないキーを読んでいない ---------- */
console.log('[1] 算定結果を受け取る側の照合');
{
  const keys = returnedKeys();
  ok(keys.indexOf('baCoef') >= 0 && keys.indexOf('amount') >= 0, '返り値のキーを取得できた', keys);
  ok(keys.indexOf('coef') < 0, '個人係数(coef)は返していない', keys);

  /* b という引数名で算定結果を受け取る関数たち */
  const consumers = ['kbResultHtml', 'karteBonusExplain', 'renderBonusBreakdown', '_bonusWritePay', '_karteStoreSel'];
  const allowed = new Set(keys);
  let bad = [];
  consumers.forEach(function (fn) {
    let body;
    try { body = grab(src, fn); } catch (e) { return; }
    for (const m of body.matchAll(/\bb\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      if (!allowed.has(m[1])) bad.push(fn + ' → b.' + m[1]);
    }
  });
  ok(bad.length === 0, '消費側が読むキーはすべて算定結果に存在する', bad);

  /* v795 では実際に落ちていたことを示す（この検査が効くことの証明） */
  let badPrev = [];
  consumers.forEach(function (fn) {
    let body;
    try { body = grab(prev, fn); } catch (e) { return; }
    for (const m of body.matchAll(/\bb\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      if (!allowed.has(m[1])) badPrev.push(fn + ' → b.' + m[1]);
    }
  });
  ok(badPrev.length > 0, 'v795 では未定義キーの参照が残っていた（この検査で捕まる）', badPrev);
  ok(badPrev.some(function (x) { return /b\.coef$/.test(x); }), 'それは b.coef だった', badPrev);
}

/* ---------- 2. undefined に .toFixed を呼んでいないか ---------- */
console.log('\n[2] .toFixed の安全性');
{
  const keys = new Set(returnedKeys());
  const region = src.slice(src.indexOf('function kbCfg'), src.indexOf('function kbRefresh'));
  let unsafe = [];
  for (const m of region.matchAll(/\bb\.([a-zA-Z_][a-zA-Z0-9_]*)\.toFixed/g)) {
    if (!keys.has(m[1])) unsafe.push('b.' + m[1] + '.toFixed');
  }
  ok(unsafe.length === 0, '存在しないキーに .toFixed を呼んでいない', unsafe);
  /* 新しく足した予算係数は null でも落ちない書き方か */
  const list = grab(src, 'kbResultHtml');
  ok(/Number\(b\.baCoef!=null\?b\.baCoef:1\)\.toFixed/.test(list),
    '予算係数は未設定でも落ちない書き方になっている');
}

/* ---------- 3. 一覧表が実際に描ける（v795 で落ちていた画面） ---------- */
console.log('\n[3] 一覧表の描画');
{
  const rows = [
    { e: { id: 'e1', name: '山田' }, b: { grade: 'G3', base: 3000, baPct: 110, baCoef: 1.02, ba: { noData: false }, csPct: 60, csCoef: 1.06, hasCS: true, spPct: 110, spCoef: 1.02, amount: 3308 } },
    { e: { id: 'e2', name: '未評価' }, b: { grade: 'G2', base: 1000, baPct: null, baCoef: 1, ba: { noData: true }, csPct: 0, csCoef: 1, hasCS: false, spPct: 100, spCoef: 1, amount: 1000 } },
    { e: { id: 'e3', name: '欠損' }, b: { grade: 'G4', base: 5000, ba: { noData: true }, csPct: 0, csCoef: 1, hasCS: false, spPct: null, spCoef: null, amount: 5000 } }
  ];
  const sb = new Function('ROWS', `
    var out={total:9999, pool:20000, over:false, factor:1, diff:1, rows:ROWS};
    var curRole='gm';
    var store={};
    function ls(k,d){ return (k in store)? store[k] : d; }
    function lsSet(k,v){ store[k]=v; return true; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _money(n){ return '$'+Math.round(Number(n)||0).toLocaleString('en-US'); }
    function bonusTotals(){ return out; }
    function kbCfg(){ return {quarter:'2026-Q2', profit:0, poolRate:0.12}; }
    function bonusPool(){ return out.pool; }
    function evalLevelFromPct(p){ return {n:3, color:'#000'}; }
    function _karteStoreSel(cfg,e,b){ return '(store)'; }
    function karteScopeStores(){ return []; }
    function getStoresAll(){ return []; }
    ${grab(src, 'kbResultHtml')}
    return { html:kbResultHtml, setOver:function(v){ out.over=v; } };
  `)(rows);

  let h = null, err = null;
  try { h = sb.html(); } catch (e) { err = String(e && e.message); }
  ok(err === null, '一覧表が例外なく描画される（v795 はここで落ちていた）', err);
  ok(h && h.indexOf('山田') >= 0, '通常の行が出る');
  ok(h && h.indexOf('110%') >= 0, '予算達成率が出る');
  ok(h && h.indexOf('1.02') >= 0, '予算係数が出る');
  ok(h && h.indexOf('未評価') >= 0, '予算未登録の人も行が出る');
  ok(h && /予算%/.test(h) && /予算係数/.test(h), '見出しが予算の2列になっている');
  ok(h && !/>係数</.test(h), '個人係数の見出しが残っていない');
  ok(h && h.indexOf('欠損') >= 0, '係数が欠けた行でも落ちずに出る');

  /* 見出しの数と本文セルの数が合っているか（列ズレの検出） */
  const th = (h.match(/<th /g) || []).length;
  const firstRow = h.slice(h.indexOf('<tbody>'), h.indexOf('</tr>', h.indexOf('<tbody>')));
  const td = (firstRow.match(/<td /g) || []).length;
  ok(th === td, '見出しと本文の列数が一致（' + th + '列）', { th, td });
}

/* ---------- 4. 空一覧の colspan ---------- */
console.log('\n[4] 対象者がいないとき');
{
  const sb = new Function(`
    var out={total:0, pool:0, over:false, factor:1, diff:0, rows:[]};
    var curRole='gm'; var store={};
    function ls(k,d){ return (k in store)? store[k] : d; }
    function lsSet(k,v){ store[k]=v; return true; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function _money(n){ return '$'+Math.round(Number(n)||0); }
    function bonusTotals(){ return out; }
    function kbCfg(){ return {quarter:'2026-Q2', profit:0, poolRate:0.12}; }
    function bonusPool(){ return 0; }
    function evalLevelFromPct(){ return {n:3,color:'#000'}; }
    function _karteStoreSel(){ return ''; }
    function karteScopeStores(){ return []; }
    function getStoresAll(){ return []; }
    ${grab(src, 'kbResultHtml')}
    return { html:kbResultHtml, setOver:function(v){ out.over=v; } };
  `)();
  const h = sb.html();
  const th = (h.match(/<th /g) || []).length;
  const cs = Number((h.match(/colspan="(\d+)"/) || [])[1]);
  ok(cs === th, '空表示の colspan が列数と一致（' + cs + '）', { cs, th });
  sb.setOver(true);
  const h2 = sb.html();
  const th2 = (h2.match(/<th /g) || []).length;
  const cs2 = Number((h2.match(/colspan="(\d+)"/) || [])[1]);
  ok(cs2 === th2, '原資調整ありでも一致（' + cs2 + '）', { cs2, th2 });
  ok(th2 === th + 1, '調整後の列が1つ増える', { th, th2 });
}

/* ---------- 5. 計算そのものは v795 から変えていない ---------- */
console.log('\n[5] 算定式は据え置き');
{
  /* 「v796 は表示だけ直して計算を触っていない」は v796 時点の履歴的事実。
     現行と比べると後の版の変更で必ず落ちるので、v796 のビルドと比べる。 */
  if (fs.existsSync('index_v796_backup.html')) {
    const v796 = fs.readFileSync('index_v796_backup.html', 'utf8');
    ['bonusForEmp', 'budgetAchieveFor', 'baCoef', 'renderBonusBreakdown'].forEach(function (fn) {
      ok(grab(v796, fn) === grab(prev, fn), 'v796 は ' + fn + ' を1文字も変えていない');
    });
  } else {
    ok(true, 'v796 のビルドが無いため比較はスキップ');
  }
  /* 現行でも「掛け算の並び」は保たれている（durableな性質） */
  ok(/base\*ba\.coef\*spf\*csf/.test(grab(src, 'bonusForEmp')), '算定式の掛け算の並びは保たれている');
  ok(/Math\.max\(0,Math\.min\(200,pct\)\)/.test(grab(src, 'baCoef')), '係数の対応（0〜200%）は保たれている');
  ok(!/b\.coef/.test(src), '個人係数の参照がソース全体から消えた');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
