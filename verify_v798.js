/* verify_v798.js — 査定データが端末間で消し合わないこと（合流ルール）
   v797 で査定を削除保護に入れた結果、監査が「丸ごと上書きされる」既存リスクを検出した。
   その修正。査定は手入力で再生できないため、件ごとに合流する必要がある。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v797_backup.html', 'utf8');
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
console.log('\n=== v798: 査定データが消し合わない ===\n');

const env = new Function(`
  ${grab(src, '_recAt')}
  ${grab(src, 'mergeMapByTime')}
  ${grab(src, '_coversMapByTime')}
  return { merge: mergeMapByTime, covers: _coversMapByTime };
`)();

console.log('[1] 合流ルールが定義されている');
{
  const om = src.slice(src.indexOf('var OP_MERGE = {'), src.indexOf('var OP_MERGE = {') + 1600);
  ['bonus_q', 'growth_karte', 'q_budgets', 'karte_bonus_config'].forEach(function (k) {
    ok(new RegExp('\\b' + k + ':').test(om), k + ' に合流ルールがある');
    ok(!new RegExp('\\b' + k + ':').test(prev.slice(prev.indexOf('var OP_MERGE = {'), prev.indexOf('var OP_MERGE = {') + 1600)),
      '  v797 には無かった（丸ごと上書きだった）');
  });
}

console.log('\n[2] 別の四半期・別の人を消さない');
{
  /* 端末A：Q2だけ持っている／端末B（クラウド）：Q3だけ持っている */
  const cloud = { '2026-Q3': { profit: { F01: {} }, _at: 2000 } };
  const local = { '2026-Q2': { profit: { F01: { '2026-04': { a: 12000 } } }, _at: 1000 } };
  const m = env.merge(cloud, local);
  ok(Object.keys(m).length === 2, 'Q2 と Q3 が両方残る', Object.keys(m));
  ok(m['2026-Q2'].profit.F01['2026-04'].a === 12000, 'Q2 の利益が保たれる');
  /* 同じ四半期は新しい方が勝つ */
  const m2 = env.merge({ '2026-Q2': { v: 'old', _at: 100 } }, { '2026-Q2': { v: 'new', _at: 200 } });
  ok(m2['2026-Q2'].v === 'new', '同じ四半期は新しい方が勝つ');
  const m3 = env.merge({ '2026-Q2': { v: 'newer', _at: 300 } }, { '2026-Q2': { v: 'older', _at: 100 } });
  ok(m3['2026-Q2'].v === 'newer', '向きを逆にしても新しい方が勝つ');
  /* カルテ：別の従業員を編集しても消えない */
  const k = env.merge({ e1: { payLog: [1], _at: 100 } }, { e2: { payLog: [2], _at: 200 } });
  ok(k.e1 && k.e2, '別々の従業員のカルテが両方残る', Object.keys(k));
}

console.log('\n[3] 時刻の印が押されている');
{
  ok(/k\._at=Date\.now\(\)/.test(grab(src, 'saveKarte')), 'カルテ保存時に印を押す');
  ok(/obj\._at=Date\.now\(\)/.test(grab(src, 'setQBudgetObj')), '四半期予算の保存時に印を押す');
  ok(/d\._at=Date\.now\(\)/.test(grab(src, 'bqSet')), '査定データの保存時に印を押す');
  ok(/d\._by=_bqWho\(\)/.test(grab(src, 'bqSet')), '誰が保存したかも残る');
  /* 印が無いと勝敗が決まらない（この修正が効く理由） */
  const noStamp = env.merge({ a: { v: 'cloud' } }, { a: { v: 'local' } });
  ok(noStamp.a.v === 'local', '印が無い場合はローカルが勝つ（＝印が要る）');
}

console.log('\n[4] 監査が基準どおり');
{
  ok(fs.existsSync('audit_merge_coverage.js'), '監査スクリプトがある');
  ok(/'growth_karte'/.test(src.slice(src.indexOf('var LS_NEVER_FREE'), src.indexOf('var LS_NEVER_FREE') + 900)),
    '査定が削除保護に入っている（v797）');
}

console.log('\n[5] 計算・画面は変えていない');
{
  ['bonusForEmp', 'budgetAchieveFor', 'bqProfitOf', 'bqStageState', 'renderBqPipeline', 'renderBqProfit'].forEach(function (fn) {
    ok(grab(src, fn) === grab(prev, fn), fn + ' は1文字も変えていない');
  });
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
