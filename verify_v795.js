/* verify_v795.js — ボーナス算定式の変更と算定根拠の見える化
   金額に直結するため、実関数を抽出して実数で検算する。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v794_backup.html', 'utf8');

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

console.log('\n=== v795: ボーナス算定式（Grade基準額 × 予算達成率 × 店舗利益 × Career Score） ===\n');

/* 実関数を持ち込み、qcCompute だけ差し替え可能なモックにする */
function build(opts) {
  opts = opts || {};
  return new Function('QC', 'LSS', 'TODAY', `
    var store={};
    var curRole='gm', curUserName='Moto';
    var STORES=[{id:'F01',name:'ToriTon'},{id:'F04-K',name:'Kaimuki'},{id:'F04-P',name:'Piikoi'}];
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    ${grab(src, 'escapeHtml')}
    function _money(n){ return '$'+Math.round(Number(n)||0).toLocaleString('en-US'); }
    function bizNow(){ return new Date(TODAY+'T12:00:00'); }
    function qcCompute(sid,y,q){ return QC[sid+':'+y+'Q'+q] || null; }
    function lssSummary(name){ return LSS[name] || {hasData:false, cats:[], totalScore:0, totalMax:0, totalPct:0}; }
    function empGrade(e){ return (e&&e.grade)||'G3'; }
    function getEmployees(){ return []; }
    ${grab(src, '_quarterMonths')}
    ${grab(src, '_ymToOffset')}
    ${grab(src, '_curQuarter')}
    ${grab(src, 'karteEmpStores')}
    ${grab(src, 'kbCfg')}
    ${grab(src, 'kbSave')}
    ${grab(src, 'csCoef')}
    ${grab(src, 'spCoef')}
    ${grab(src, 'storeProfitOf')}
    ${grab(src, 'storeScoreOf')}
    ${grab(src, 'baCoef')}
    ${grab(src, '_bonusQParse')}
    ${grab(src, 'budgetAchieveFor')}
    ${grab(src, 'bonusCsDetail')}
    ${grab(src, '_owStoreName')}
    ${grab(src, '_baStepRow')}
    ${grab(src, 'renderBonusBreakdown')}
    ${grab(src, 'bonusForEmp')}
    ${grab(src, 'karteBonusExplain')}
    return { ls:ls, lsSet:lsSet, cfg:kbCfg, calc:bonusForEmp, ba:budgetAchieveFor,
             baCoef:baCoef, csCoef:csCoef, spCoef:spCoef,
             render:renderBonusBreakdown, explain:karteBonusExplain,
             store:function(){return store;} };
  `)(opts.qc || {}, opts.lss || {}, opts.today || '2026-07-15');
}

/* 完了したQ（2026-Q2）と進行中のQ（2026-Q3）を用意。今日=2026-07-15 */
const QC = {
  'F01:2026Q2': { tSales: 300000, aSales: 330000, paceSales: 300000, unreg: [] },
  'F04-K:2026Q2': { tSales: 100000, aSales: 80000, paceSales: 100000, unreg: [] },
  'F01:2026Q3': { tSales: 300000, aSales: 55000, paceSales: 50000, unreg: [] },
  'F01:2026Q4': { tSales: 0, aSales: 0, paceSales: 0, unreg: [{ ym: '2026-10' }] }
};
const LSS = {
  '山田': {
    hasData: true, totalScore: 60, totalMax: 100, totalPct: 60,
    cats: [{ key: 'a', name: '接客', score: 20, max: 30, pct: 67 },
    { key: 'b', name: '調理', score: 25, max: 40, pct: 63 },
    { key: 'c', name: 'リーダー', score: 15, max: 30, pct: 50 }]
  }
};
const EMP = { id: 'e1', name: '山田', grade: 'G3', store: 'F01', coef: 1.5 };

function baseCfg(e) {
  e.lsSet('karte_bonus_config', {
    quarter: '2026-Q2', gradeBase: { G2: 1000, G3: 3000, G4: 5000, G5: 8000, G6: 12000 },
    csMin: 0.7, csMax: 1.3, spMin: 0.8, spMax: 1.2, baMin: 0.8, baMax: 1.2,
    storeProfit: { 'F01': { actual: 55000, target: 50000 }, 'F04-K': { actual: 20000, target: 25000 } },
    empStore: {}, storeScore: {}
  });
}

/* ---------- 1. 個人係数が消えているか ---------- */
console.log('[1] 個人係数の廃止');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const b = e.calc(EMP, e.cfg());
  ok(b.coef === undefined, '算定結果に個人係数が残っていない', b.coef);
  const body = grab(src, 'bonusForEmp');
  ok(!/e\.coef/.test(body), 'e.coef を参照していない');
  ok(!/\bcoef\s*\*/.test(body.replace(/ba\.coef/g, '')), '式に個人係数が掛かっていない', body.match(/amount:[^,}]*/));
  ok(/base\s*\*\s*ba\.coef\s*\*\s*spf\s*\*\s*csf/.test(body), '式は 基準額×予算×利益×CS', (body.match(/amount:[^,}]*/) || [])[0]);
  /* 個人係数を変えても金額が動かない */
  const b2 = e.calc(Object.assign({}, EMP, { coef: 3.0 }), e.cfg());
  ok(b.amount === b2.amount, '個人係数を変えても金額が変わらない', { a: b.amount, b: b2.amount });
  ok(!/個人係数/.test(grab(src, 'karteBonusExplain')), '説明文から個人係数が消えている');
}

/* ---------- 2. 完了したQの計算を実数で検算 ---------- */
console.log('\n[2] 完了した四半期（2026-Q2）の検算');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const b = e.calc(EMP, e.cfg());
  /* 予算：F01のみ所属 → 330,000 ÷ 300,000 = 110% */
  ok(b.ba.pct === 110, '予算達成率 110%（33万÷30万）', b.ba.pct);
  ok(b.ba.basis === 'full', '完了Qなので四半期予算そのものと比較', b.ba.basis);
  ok(b.ba.inProgress === false, '進行中ではない');
  /* 係数：0.8 + 0.4*(110/200) = 1.02 */
  ok(b.baCoef === 1.02, '予算係数 ×1.02', b.baCoef);
  /* 利益：55,000 ÷ 50,000 = 110% → 同じ式で 1.02 */
  ok(b.spPct === 110, '利益達成率 110%', b.spPct);
  ok(b.spCoef === 1.02, '利益係数 ×1.02', b.spCoef);
  /* CS：60% → 0.7 + 0.6*(60/100) = 1.06 */
  ok(b.csPct === 60 && b.csCoef === 1.06, 'CS係数 ×1.06（60点）', [b.csPct, b.csCoef]);
  /* 金額：3000 × 1.02 × 1.02 × 1.06 = 3308.05 → 3308 */
  const expect = Math.round(3000 * 1.02 * 1.02 * 1.06);
  ok(b.amount === expect, '査定額 ' + expect + ' と一致', { got: b.amount, expect });
  ok(b.base === 3000, 'Grade基準額 3000', b.base);
}

/* ---------- 3. 複数店は金額を足してから割る ---------- */
console.log('\n[3] 複数店の合算');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const c = e.cfg(); c.empStore = { e1: ['F01', 'F04-K'] }; e.lsSet('karte_bonus_config', c);
  const b = e.calc(EMP, e.cfg());
  /* (330000+80000) ÷ (300000+100000) = 410000/400000 = 102.5% → 103% */
  ok(b.ba.actual === 410000 && b.ba.target === 400000, '売上と予算を合算している', [b.ba.actual, b.ba.target]);
  /* 410000/400000*100 は浮動小数で 102.4999… となるため 102。
     ％の単純平均なら (110+80)/2=95 なので、合算しているかはこれで判別できる。 */
  ok(b.ba.pct === 102, '合算での達成率 102%（％の平均95%ではない）', b.ba.pct);
  /* ％の平均だと (110+80)/2=95% になる。金額合算のほうが大きい店を正しく反映する */
  ok(b.ba.pct !== 95, '％の単純平均を使っていない', b.ba.pct);
  ok(b.ba.stores.length === 2, '対象店を2つ持っている', b.ba.stores);
}

/* ---------- 4. 進行中のQは経過ぶんと比べる ---------- */
console.log('\n[4] 進行中の四半期（2026-Q3・今日は7/15）');
{
  const e = build({ qc: QC, lss: LSS, today: '2026-07-15' }); baseCfg(e);
  const c = e.cfg(); c.quarter = '2026-Q3'; e.lsSet('karte_bonus_config', c);
  const b = e.calc(EMP, e.cfg());
  ok(b.ba.inProgress === true, '進行中と判定される');
  ok(b.ba.basis === 'pace', '経過ぶんの予算と比較する', b.ba.basis);
  /* 55,000 ÷ 50,000(ペース) = 110%。四半期まるごと(30万)と比べると18%になってしまう */
  ok(b.ba.pct === 110, '達成率 110%（ペース基準）', b.ba.pct);
  ok(b.ba.pct !== 18, '四半期まるごとの予算と比べていない（必ず未達に見えてしまう）', b.ba.pct);
  const h = e.render(EMP, b, e.cfg());
  ok(/進行中/.test(h), '画面に「進行中」の注意が出る');
  ok(/経過ぶんの予算/.test(h), 'どの予算と比べたか書いてある');
}

/* ---------- 5. 予算未登録は0%にしない（最重要の安全策） ---------- */
console.log('\n[5] 予算が未登録のとき');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const c = e.cfg(); c.quarter = '2026-Q4'; e.lsSet('karte_bonus_config', c);
  const b = e.calc(EMP, e.cfg());
  ok(b.ba.noData === true, 'データ無しと判定される');
  ok(b.baCoef === 1, '係数は中立の 1.00（0.80まで下げない）', b.baCoef);
  ok(b.ba.pct === null, '達成率は「なし」（0%ではない）', b.ba.pct);
  /* 3000 × 1.00 × 1.02 × 1.06 */
  ok(b.amount === Math.round(3000 * 1 * 1.02 * 1.06), '中立で計算される', b.amount);
  const h = e.render(EMP, b, e.cfg());
  ok(/予算が登録されていない|予算未登録/.test(h), '未登録であることが画面に出る');
  ok(/中立/.test(h), '中立扱いだと明記されている');
  /* 四半期の指定が壊れていても落ちない */
  const c2 = e.cfg(); c2.quarter = ''; e.lsSet('karte_bonus_config', c2);
  const b2 = e.calc(EMP, e.cfg());
  ok(b2.baCoef === 1 && b2.ba.noData === true, '四半期が空でも中立で通る', b2.baCoef);
  const c3 = e.cfg(); c3.quarter = 'でたらめ'; e.lsSet('karte_bonus_config', c3);
  ok(e.calc(EMP, e.cfg()).baCoef === 1, '四半期の書式が不正でも落ちない');
}

/* ---------- 6. CS未評価も中立に（v794の不具合） ---------- */
console.log('\n[6] Career Score が未評価のとき');
{
  const e = build({ qc: QC, lss: {} }); baseCfg(e);   /* CSデータ無し */
  const b = e.calc(EMP, e.cfg());
  ok(b.hasCS === false, 'CS未評価と判定される');
  ok(b.csCoef === 1, 'CS係数は中立の 1.00', b.csCoef);
  /* v794 では csCoef(0) = 0.70 になり、未評価者だけ3割減っていた */
  const before = grab(prev, 'bonusForEmp');
  ok(/csf=csCoef\(pct,cfg\)/.test(before), 'v794 は未評価でも0%として係数を出していた');
  ok(e.csCoef(0, e.cfg()) === 0.7, '0%なら本来0.70になる（＝未評価者が3割減っていた）', e.csCoef(0, e.cfg()));
  ok(b.amount === Math.round(3000 * 1.02 * 1.02 * 1), '中立で計算される', b.amount);
}

/* ---------- 7. 係数の対応表 ---------- */
console.log('\n[7] 係数の対応（0〜200%を下限〜上限へ）');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const cfg = e.cfg();
  [[0, 0.8], [50, 0.9], [100, 1.0], [150, 1.1], [200, 1.2]].forEach(function (p) {
    ok(e.baCoef(p[0], cfg) === p[1], p[0] + '% → ×' + p[1], e.baCoef(p[0], cfg));
  });
  ok(e.baCoef(300, cfg) === 1.2, '200%超は上限で頭打ち', e.baCoef(300, cfg));
  ok(e.baCoef(-50, cfg) === 0.8, 'マイナスでも下限で止まる', e.baCoef(-50, cfg));
  ok(e.baCoef(null, cfg) === 1, 'データ無しは中立');
  ok(e.baCoef(100, cfg) === e.spCoef(100, cfg), '利益係数と同じ対応（100%＝1.00）');
  /* 上下限を変えると反映される */
  const c = e.cfg(); c.baMin = 0.5; c.baMax = 1.5; e.lsSet('karte_bonus_config', c);
  ok(e.baCoef(100, e.cfg()) === 1, '幅を変えても100%は1.00のまま', e.baCoef(100, e.cfg()));
  ok(e.baCoef(200, e.cfg()) === 1.5, '上限が効く', e.baCoef(200, e.cfg()));
}

/* ---------- 8. 算定根拠の表示 ---------- */
console.log('\n[8] 「なぜこの金額か」の表示');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const b = e.calc(EMP, e.cfg());
  const h = e.render(EMP, b, e.cfg());
  /* 4段すべてが出る */
  ok(/Grade基準額/.test(h), '① Grade基準額の段がある');
  ok(/予算達成率/.test(h), '② 予算達成率の段がある');
  ok(/店舗利益係数/.test(h), '③ 店舗利益係数の段がある');
  ok(/Career Score係数/.test(h), '④ Career Score係数の段がある');
  /* 元データが見える */
  ok(h.indexOf('$330,000') >= 0 && h.indexOf('$300,000') >= 0, '売上実績と予算の金額が出る');
  ok(/110%/.test(h), '達成率のパーセントが出る');
  ok(h.indexOf('$55,000') >= 0 && h.indexOf('$50,000') >= 0, '利益の実績と基準額が出る');
  ok(/ToriTon/.test(h), '対象店の名前が出る');
  /* Career Score のカテゴリー別が全部出る（Motoさんの要望） */
  ok(/接客/.test(h) && /調理/.test(h) && /リーダー/.test(h), 'CSの全カテゴリー名が出る');
  ok(/20\/30/.test(h) && /25\/40/.test(h) && /15\/30/.test(h), '各カテゴリーの点数が出る');
  ok(/67%/.test(h) && /63%/.test(h) && /50%/.test(h), '各カテゴリーの％が出る');
  ok(/60 \/ 100点/.test(h), 'CS合計点が出る');
  /* 途中経過の金額（掛けるたびに金額がどう動くか） */
  ok(h.indexOf('$3,000') >= 0, '出発点の金額が出る');
  ok(h.indexOf(_m(b.amount)) >= 0, '最終額が出る', b.amount);
  ok((h.match(/→ \$/g) || []).length === 4, '4段すべてに途中経過の金額が付く',
    (h.match(/→ \$/g) || []).length);
  /* 係数がすべて表示される */
  ok(/×1\.02/.test(h) && /×1\.06/.test(h), '各係数が表示される');
  function _m(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
}

/* ---------- 9. 表示の安全性 ---------- */
console.log('\n[9] 壊れた入力');
{
  const bad = {
    hasData: true, totalScore: 5, totalMax: 10, totalPct: 50,
    cats: [{ key: 'x', name: '<script>bad()</script>', score: 5, max: 10, pct: 50 }]
  };
  const e = build({ qc: QC, lss: { '山田': bad } }); baseCfg(e);
  const b = e.calc(EMP, e.cfg());
  const h = e.render(EMP, b, e.cfg());
  ok(h.indexOf('<script>bad()') < 0, 'カテゴリー名がHTMLとして出ない');
  ok(/&lt;script&gt;/.test(h), '文字としては読める');
  /* 所属店が無い人 */
  const e2 = build({ qc: QC, lss: LSS }); baseCfg(e2);
  const b2 = e2.calc({ id: 'e9', name: '無店舗', grade: 'G2' }, e2.cfg());
  ok(b2.baCoef === 1, '所属店が無くても中立で通る', b2.baCoef);
  ok(typeof e2.render({ id: 'e9', name: '無店舗' }, b2, e2.cfg()) === 'string', '描画が落ちない');
  /* qcCompute が失敗する店 */
  const e3 = build({ qc: {}, lss: LSS }); baseCfg(e3);
  ok(e3.calc(EMP, e3.cfg()).baCoef === 1, '売上データが取れなくても中立', e3.calc(EMP, e3.cfg()).baCoef);
}

/* ---------- 10. 読み取りだけ／履歴 ---------- */
console.log('\n[10] 副作用と履歴');
{
  const e = build({ qc: QC, lss: LSS }); baseCfg(e);
  const before = JSON.stringify(e.store());
  e.calc(EMP, e.cfg()); e.ba(e.cfg(), EMP); e.render(EMP, e.calc(EMP, e.cfg()), e.cfg());
  ok(JSON.stringify(e.store()) === before, '計算・表示は何も保存しない');
  ['budgetAchieveFor', 'baCoef', 'bonusForEmp', 'renderBonusBreakdown', 'bonusCsDetail'].forEach(function (fn) {
    ok(!/lsSet\(/.test(grab(src, fn)), fn + ' は保存しない');
  });
  /* 新しい記録には予算係数が入る */
  const wp = grab(src, '_bonusWritePay');
  ok(/baPct:b\.baPct/.test(wp) && /baCoef:b\.baCoef/.test(wp), '履歴に予算達成率を残す');
  ok(!/coef:b\.coef/.test(wp), '履歴に個人係数を残さない');
  /* 過去の記録は書き換えない */
  ok(/sn\.coef!=null/.test(src), '旧式の記録も表示できる（過去分を壊さない）');
  ok(/旧式/.test(src), '旧式であることが分かる表示になっている');
}

/* ---------- 11. 設定 ---------- */
console.log('\n[11] 設定');
{
  ok(/function bonusSetBa/.test(src), '上下限を変える処理がある');
  ok(/予算達成率係数 下限/.test(src) && /予算達成率係数 上限/.test(src), '設定画面に入力欄がある');
  ok(/baMin:0\.8, baMax:1\.2/.test(src), '既定は 0.8〜1.2（利益係数と同じ）');
  ok(/if\(d\.baMin==null\)d\.baMin=0\.8/.test(src), '既存の設定にも既定値が補われる');
  ok(prev.indexOf('baCoef') < 0, 'v794 には無かった');
  /* 式の表記が更新されている */
  ok(/Grade基準額 × 予算達成率 × 店舗利益係数 × Career Score係数/.test(src), '一覧の式表記が新しい');
  ok(!/基準額 × 予実達成率 × Level係数/.test(src), '古い式表記が残っていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
