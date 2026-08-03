/* ============================================================
   merge_probe.js — 合流ルールを「実際のコードに聞く」ための共通部品

   【なぜ作ったか】
     合流ルールの網羅を見る監査が2つあり、それぞれ別の欠けかたをしていた。
       ・audit_merge_coverage.js … 実 _opMergeDef を通す（正しい）が、
                                   対象が LS_NEVER_FREE（手入力）だけ。
                                   → daily_actuals_ が視界の外にあり、v825 の事故を防げなかった。
       ・verify_v825.js [6]      … 対象は OP_SYNC_PREFIX（正しい）だが、
                                   OP_MERGE_PREFIX の宣言テキストを文字列一致で見ていた。
                                   → v807 で _opMergeDef の先頭に直書きされた
                                     sl_manual_ の分岐を見落とし、「未保護12個」と報告していた。
                                     実際は11個。sl_manual_ は保護済み。

     つまり「対象範囲」と「判定方法」が別々の場所で二重に実装され、両方が片肺だった。
     ここに1本化して、両方が同じ判定を使うようにする。

   【原則】
     ・判定は必ず実コードの _opMergeDef を通す。宣言テキストの一致で代用しない。
     ・前方一致キーは「実際に保存される完全なキー名」に展開してから判定する。
       展開の見本が無いキーは、推測せずエラーにする（黙って間違った判定を出さない）。
============================================================ */
'use strict';
const fs = require('fs');

/* 実際に localStorage / クラウドへ保存される完全なキー名の見本。
   コード内の ls('xxx_'+storeId, …) の実例から採っている。 */
const SAMPLE = {
  /* --- OP_SYNC_PREFIX（クラウド同期の対象） --- */
  'sl_manual_':        'sl_manual_F01',
  'budget_approved_':  'budget_approved_F01_2026-07',
  'skills_st_':        'skills_st_F04-K',
  'lss_emp_':          'lss_emp_Taro',
  'help_requests_':    'help_requests_F01',
  'ot_approvals_':     'ot_approvals_F01_2026-W31',
  'att_approve_':      'att_approve_F01_2026-07',
  'att_day_approve_':  'att_day_approve_F01_2026-07-01',
  'cash_tips_':        'cash_tips_F01',
  'shift_fixed_':      'shift_fixed_F01',
  'fc_monthly_':       'fc_monthly_F01_2026-07',
  'dailyops_':         'dailyops_complete_F01',
  'orders_':           'orders_F01',
  'purchases_':        'purchases_F01',
  'inv_':              'inv_F01',
  'tip_exclude_':      'tip_exclude_F01_2026-07-01',
  'warnings_':         'warnings_F01',
  'reminded_':         'reminded_F01_2026-W31',
  'shiftopt_':         'shiftopt_cfg_F01',
  'office_attend_':    'office_attend_Taro',
  'daily_actuals_':    'daily_actuals_F02',
  'menu_mix_':         'menu_mix_F01_2026-07',
  'labor_hours_':      'labor_hours_F01_2026-W31',
  'fav_':              'fav_Taro',
  'fv_count_':         'fv_count_F04-K_2026-07',
  'fv_moves_':         'fv_moves_F04-K_2026-07',
  'fv_review_':        'fv_review_F04-K_2026-07',
  /* --- LS_NEVER_FREE 側で追加で要る見本 --- */
  'inv_hist_':         'inv_hist_F01',
  'spl_inv_hist_':     'spl_inv_hist_F01',
  'spl_budgets_v2_':   'spl_budgets_v2_F01',
  'spl_invoices_':     'spl_invoices_F01',
  'spl_skills_st_':    'spl_skills_st_F04-K',   /* 実際には使われていない名残 */
  'spl_my_vacations_': 'spl_my_vacations_Taro'
};

/* 'spl_' だけは「分割キーの入れ物そのもの」で、単独のデータではない。
   実際に押し上げられるのは spl_<基底キー>_<人/店> のパーティション。
   1件の見本で代表させると他のパーティションの穴が隠れるため、
   件数には数えず、専用の一覧で個別に判定する。 */
const NOT_A_DATA_KEY = ['spl_'];

function buildProbe(src) {
  function grab(name) {
    let i = src.indexOf('async function ' + name + '(');
    if (i < 0) i = src.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('not found: ' + name);
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
    if (i < 0) throw new Error('not found: ' + decl);
    const open = decl.trim().slice(-1), close = (open === '[') ? ']' : '}';
    let d = 0, st = false, j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === open) { d++; st = true; }
      else if (c === close) { d--; if (st && d === 0) { j++; break; } }
    }
    return src.slice(i, j) + ';';
  }

  const merges = grabObj('var OP_MERGE = {');
  const mergePre = grabObj('var OP_MERGE_PREFIX = {');
  const splitKeys = grabObj('var _SPLIT_KEYS = {');

  /* マージ関数の中身は判定に関係しないので空関数で置く */
  const ref = new Set();
  (merges + mergePre).replace(/(?:merge|covers)\s*:\s*([A-Za-z_$][\w$]*)/g,
    (m, n) => { ref.add(n); return m; });
  const stubs = [...ref].map(n => 'function ' + n + '(){}').join('\n');

  /* 店舗IDはソースの DEFAULT_STORES から採る（registerInvMergeKeys が inv_<店> を登録する）。
     手で書き写すと店舗が増えたときに古くなるため、固定しない。 */
  const storeIds = (grabObj('DEFAULT_STORES = [').match(/id:\s*'([^']+)'/g) || [])
    .map(s => s.split("'")[1]);

  const api = new Function(`
    var DEFAULT_STORES = ${JSON.stringify(storeIds.map(id => ({ id })))};
    function _lsRaw(){ return null; }
    function mergeListByCode(){} function _coversListByCode(){}
    /* v767: 設定型(obj)の分割キーは _stDef() へ解決される。無いと例外＝誤判定になる */
    function mergeStamped(){} function _coversStamped(){}
    var _ST_MERGE_DEF=null;
    function _stDef(){ if(!_ST_MERGE_DEF) _ST_MERGE_DEF={ merge:mergeStamped, covers:_coversStamped }; return _ST_MERGE_DEF; }
    var console={warn:function(){}};
    ${stubs}
    ${merges}
    ${mergePre}
    ${splitKeys}
    ${src.indexOf('function registerInvMergeKeys(') >= 0
      ? grab('registerInvMergeKeys') + '\nregisterInvMergeKeys();' : ''}
    ${grab('_opMergeDef')}
    return { def:_opMergeDef, split:_SPLIT_KEYS };
  `)();

  function listOf(name) {
    const raw = /\[([\s\S]*?)\];/.exec(grabObj('var ' + name + ' = ['));
    return raw[1].replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }

  /* 前方一致キー → 実キー名。見本が無ければ推測せず例外にする。 */
  function sampleFor(prefix) {
    if (SAMPLE[prefix]) return SAMPLE[prefix];
    if (!/_$/.test(prefix)) return prefix;          // 完全キー名はそのまま
    /* spl_<基底キー>_ の判定は _opMergeDef 内で「spl_<基底>_ で始まるか」だけを見ており、
       末尾の店舗名／人名は結果に一切影響しない。よってここは推測ではなく、
       どの id を置いても同じ判定になることが保証されている。 */
    if (prefix.indexOf('spl_') === 0) return prefix + 'F01';
    throw new Error(
      '実キー名の見本が未登録です: ' + prefix +
      '\n  → merge_probe.js の SAMPLE に、コード内の実際の保存キー名を追加してください。' +
      '\n     （推測で判定すると、守れていないキーを守れていると誤報告します）');
  }

  /* 合流ルールがあるか。あれば merge 関数名、無ければ null。 */
  function ruleFor(prefix) {
    const key = sampleFor(prefix);
    const d = api.def(key);
    return { key, name: d ? fnName(d.merge) : null };
  }
  function fnName(f) {
    if (typeof f === 'function' && f.name) return f.name;
    return '(名前不明)';
  }

  return {
    def: api.def,
    split: api.split,
    ruleFor: ruleFor,
    sampleFor: sampleFor,
    syncPrefixes: () => listOf('OP_SYNC_PREFIX'),
    neverFree: () => listOf('LS_NEVER_FREE'),
    NOT_A_DATA_KEY
  };
}

function fromFile(path) { return buildProbe(fs.readFileSync(path, 'utf8')); }

module.exports = { buildProbe, fromFile, SAMPLE, NOT_A_DATA_KEY };
