/* 「丸ごと上書き」から守られていないキーを、実コードの _opMergeDef に聞いて洗い出す。
   マージ定義があるキー = 和集合で合流するため、部分データを送ってもクラウドが壊れない。
   マージ定義が無いキー = syncMasterToSupabase が丸ごと上書きする。

   【この監査の対象範囲について】
     第1部 LS_NEVER_FREE … 消えては困る手入力データ。従来からの対象。
     第2部 OP_SYNC_PREFIX … クラウド同期の対象すべて。v825 で追加。
       daily_actuals_ は「Toast から再生成できる」として LS_NEVER_FREE に入っておらず、
       この監査の視界の外にあった。しかし再生成には人が期間一括取り込みを回す必要があり、
       誰も気づかないまま全端末から7月前半が消えていた。
       「再生成できる」と「自動で戻る」は別。同期する以上は全部見る。
     第3部 分割パーティション … 実際に押し上げられる spl_<基底>_<人/店> の名前で判定。 */
const P = require('./merge_probe.js');
const probe = P.fromFile('index.html');

/* ================= 第1部：手入力データ ================= */
console.log('=== LS_NEVER_FREE（消えては困る手入力データ）のマージ定義カバー状況 ===\n');
{
  const uncovered = [], covered = [];
  probe.neverFree().forEach(p => {
    const r = probe.ruleFor(p);
    const isSplit = !!probe.split[p];
    const line = (r.name ? '  OK  ' : ' MISS ') + p.padEnd(22) +
      ' (例: ' + r.key + ')' + (isSplit ? '  [分割キー]' : '');
    (r.name ? covered : uncovered).push(line);
  });
  covered.forEach(l => console.log(l));
  console.log('');
  uncovered.forEach(l => console.log(l));

  console.log('\n--- 集計 ---');
  console.log('マージ定義あり : ' + covered.length);
  console.log('マージ定義なし : ' + uncovered.length);
}

/* ================= 第2部：クラウド同期の対象すべて ================= */
console.log('\n=== OP_SYNC_PREFIX（クラウド同期の対象すべて）のカバー状況 ===\n');
{
  const uncovered = [], covered = [], aside = [];
  probe.syncPrefixes().forEach(p => {
    if (P.NOT_A_DATA_KEY.indexOf(p) >= 0) {
      aside.push('  --  ' + p.padEnd(22) + ' 分割キーの入れ物。第3部で個別に判定する');
      return;
    }
    const r = probe.ruleFor(p);
    const line = (r.name ? '  OK  ' : ' MISS ') + p.padEnd(22) +
      ' (例: ' + r.key + ')' + (r.name ? '  ' + r.name : '');
    (r.name ? covered : uncovered).push(line);
  });
  covered.forEach(l => console.log(l));
  console.log('');
  uncovered.forEach(l => console.log(l));
  if (aside.length) { console.log(''); aside.forEach(l => console.log(l)); }

  console.log('\n--- 集計 ---');
  console.log('保護あり : ' + covered.length);
  console.log('同期対象で未保護 : ' + uncovered.length);
  if (uncovered.length) {
    console.log('  → ' + uncovered.map(l => l.slice(6).trim().split(' ')[0]).join('  '));
    console.log('  ※ 形（配列／日付キー／名前キー／単一オブジェクト）を確認してから登録すること。');
    console.log('     単一オブジェクトに mergeMapByTime を当てると項目名を日付と誤解して壊れる。');
  }
}

/* ================= 第3部：分割パーティション ================= */
console.log('\n=== 分割キーのパーティション名での判定 ===');
['spl_skill_history_Taro', 'spl_career_history_Taro', 'spl_lss_history_Taro',
 'spl_tip_history_Taro', 'spl_invoices_F01', 'spl_budgets_v2_F01',
 'spl_tasks_all_F01', 'spl_skill_requests_Taro', 'spl_my_vacations_Taro'
].forEach(k => {
  console.log((probe.def(k) ? '  OK  ' : ' MISS ') + k);
});
