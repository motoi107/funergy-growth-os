/* 手入力データ（消えては困るもの）が「丸ごと上書き」から守られているかを実コードで確認する。
   マージ定義があるキー = 和集合で合流するため、部分データを送ってもクラウドが壊れない。
   マージ定義が無いキー = syncMasterToSupabase が丸ごと上書きする。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');

function grab(n) {
  let i = src.indexOf('async function ' + n + '(');
  if (i < 0) i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('not found: ' + n);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function grabObj(decl) {
  const i = src.indexOf(decl);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}

const merges = grabObj('var OP_MERGE = {');
const mergePre = grabObj('var OP_MERGE_PREFIX = {');
const splitKeys = grabObj('var _SPLIT_KEYS = {');
const neverFree = grabObj("var LS_NEVER_FREE = [").replace('var LS_NEVER_FREE = [', 'var LS_NEVER_FREE = [');

const ref = new Set();
(merges + mergePre).replace(/(?:merge|covers)\s*:\s*([A-Za-z_$][\w$]*)/g, (m, n) => { ref.add(n); return m; });
const stubs = [...ref].map(n => 'function ' + n + '(){}').join('\n');

const api = new Function(`
  var DEFAULT_STORES=[{id:'F01'},{id:'F02'},{id:'F03'},{id:'F03-G'},{id:'F04-K'},{id:'F04-P'},{id:'F04-A'},{id:'F05'}];
  function _lsRaw(){ return null; }
  function mergeListByCode(){} function _coversListByCode(){}
  var console={warn:function(){}};
  ${stubs}
  ${merges}
  ${mergePre}
  ${splitKeys}
  ${src.indexOf('function registerInvMergeKeys(')>=0 ? grab('registerInvMergeKeys')+'\nregisterInvMergeKeys();' : ''}
  ${grab('_opMergeDef')}
  var LS_NEVER_FREE = ${JSON.stringify(
    /var LS_NEVER_FREE = \[([\s\S]*?)\];/.exec(src)[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  )};
  return { def:_opMergeDef, never:LS_NEVER_FREE, split:_SPLIT_KEYS };
`)();

// 代表的な実キー名を作る（前方一致キーは実例に展開）
const SAMPLE = {
  'inv_': 'inv_F01',
  'inv_hist_': 'inv_hist_F01',
  'spl_inv_hist_': 'spl_inv_hist_F01',
  'budget_approved_': 'budget_approved_F01_2026-07',
  'spl_budgets_v2_': 'spl_budgets_v2_F01',
  'spl_invoices_': 'spl_invoices_F01',
  'purchases_': 'purchases_F01_2026-07',
  'skills_st_': 'skills_st_F04-K',
  'spl_skills_st_': 'spl_skills_st_F04-K',   // 実際には使われていない名残
  'lss_emp_': 'lss_emp_Taro',
  'att_approve_': 'att_approve_F01_2026-07',
  'att_day_approve_': 'att_day_approve_F01_2026-07-01',
  'cash_tips_': 'cash_tips_F01',
  'tip_exclude_': 'tip_exclude_F01',
  'spl_my_vacations_': 'spl_my_vacations_Taro',
  'fv_count_': 'fv_count_F04-K',
  'fv_moves_': 'fv_moves_F04-K',
  'fv_review_': 'fv_review_F04-K'
};

console.log('=== LS_NEVER_FREE（消えては困る手入力データ）のマージ定義カバー状況 ===\n');
const uncovered = [], covered = [];
api.never.forEach(p => {
  const k = SAMPLE[p] || p;
  const d = api.def(k);
  const isSplit = !!api.split[p];
  // 分割キーは書き込み時にパーティション名へ変換される
  const line = (d ? '  OK  ' : ' MISS ') + p.padEnd(22) + ' (例: ' + k + ')' + (isSplit ? '  [分割キー]' : '');
  (d ? covered : uncovered).push(line);
});
covered.forEach(l => console.log(l));
console.log('');
uncovered.forEach(l => console.log(l));

console.log('\n--- 集計 ---');
console.log('マージ定義あり : ' + covered.length);
console.log('マージ定義なし : ' + uncovered.length);

// 分割キーのパーティション名でも確認（実際に push されるのはこちら）
console.log('\n=== 分割キーのパーティション名での判定 ===');
['spl_skill_history_Taro', 'spl_career_history_Taro', 'spl_lss_history_Taro',
 'spl_tip_history_Taro', 'spl_invoices_F01', 'spl_budgets_v2_F01',
 'spl_tasks_all_F01', 'spl_skill_requests_Taro', 'spl_my_vacations_Taro'
].forEach(k => {
  console.log((api.def(k) ? '  OK  ' : ' MISS ') + k);
});
