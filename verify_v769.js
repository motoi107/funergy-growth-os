/* ============================================================
   verify_v769.js — 共通目標のグループ化・DOHチェックリスト・行動の一体表示

     テスト1: グループ構成（原価／衛生／メニュー開発／人材の統合）
     テスト2: DOHチェックリストの適合率計算とプラカード
     テスト3: 行動がグループへ正しく振り分けられる（旧カテゴリーも解決できる）
     テスト4: グループ集計（達成・未入力・行動の完了数）
     テスト5: 未入力を未達にしない
     テスト6: 折りたたみの初期状態と開閉
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');

function grab(name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(SRC);
  if (!m) throw new Error('見つかりません: ' + name);
  let i = SRC.indexOf('function', m.index);
  let d = 0, st = false, j = SRC.indexOf('{', i);
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}
function grabVar(decl) {
  const i = SRC.indexOf(decl);
  const o = decl.indexOf('[') >= 0 ? '[' : '{', c = o === '[' ? ']' : '}';
  let d = 0, st = false, j = i;
  for (; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === o) { d++; st = true; }
    else if (ch === c) { d--; if (st && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j) + ';';
}

function env(store) {
  const FNS = ['ccMetrics', '_ccMetricsMap', 'ccPutMetric', 'ccMetricStores', 'ccGroupMetrics',
    '_ccScoreId', 'ccScores', 'ccScore', 'ccPutScore', 'ccCheckRate', 'ccActualOf', 'ccScoreOk',
    'ccGroupSummary', 'ccGroupActions', 'ccActions', 'toggleCcGroup', '_ccNum',
    'ccScoreView', 'ccDefTarget'];   /* v774: 達成判定・集計が目標の解決を経由するため */
  const consts = [grabVar('var CC_GROUPS = ['), grabVar('var CC_CAT_GROUP = {'),
    grabVar('var CC_DEFAULT_METRICS = ['), grabVar('var CC_DOH_ITEMS = ['),
    grabVar('var CC_PLACARD = ['), 'var ccGridOpen = {};',
    grabVar('const DEFAULT_STORES = [').replace('const DEFAULT_STORES', 'var STORES')].join('\n');
  return new Function('__store', `
    ${consts}
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'T'; } function nowJP(){ return '2026-07-28 10:00'; }
    function showToast(){} function renderPage(){}
    ${FNS.map(grab).join('\n')}
    return { ccMetrics, ccGroupMetrics, ccMetricStores, ccScore, ccPutScore, ccScoreOk,
             ccCheckRate, ccActualOf, ccGroupSummary, ccGroupActions, _ccScoreId,
             toggleCcGroup, open:function(){ return ccGridOpen; },
             GROUPS: CC_GROUPS, DOH: CC_DOH_ITEMS, CATG: CC_CAT_GROUP, STORES };`)(store);
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: グループ構成 ===');
{
  const a = env({});
  /* v782: 品質管理(g_qc)を追加したため 5 → 6。 */
  check('グループが6つ', a.GROUPS.length === 6, a.GROUPS.map(g => g.label).join(' / '));
  const cost = a.ccGroupMetrics('g_cost').map(m => m.label);
  check('原価管理に原価率と理論原価差異が入っている',
    cost.indexOf('原価率') >= 0 && cost.indexOf('理論原価との差異') >= 0, cost.join(' + '));
  const hyg = a.ccGroupMetrics('g_hyg').map(m => m.label);
  /* v770: フードハンドラーはDOHチェックリストの項目へ統合した */
  check('衛生管理はDOHに集約されている',
    hyg.length === 1 && hyg[0] === 'DOH適合', hyg.join(' + '));
  const dev = a.ccGroupMetrics('g_dev');
  /* v774: 設計変更。グランド更新（ToriTon/Tenkichi/Marujuu）とシーズナル（全店）に分けた。
     v769 の「1指標に統合」はこの版で上書きされたので、新しい構成を検査する。 */
  check('メニュー開発はグランドとシーズナルの2指標', dev.length === 2, dev.map(m => m.label).join(','));
  const grand = dev.filter(m => m.id === 'm_grand')[0];
  const seas = dev.filter(m => m.id === 'm_seasonal')[0];
  check('グランド更新は3店のみ', !!grand && a.ccMetricStores(grand).length === 3);
  check('シーズナルは全店対象', !!seas && a.ccMetricStores(seas).length === a.STORES.length);
  const ppl = a.ccGroupMetrics('g_ppl').map(m => m.label);
  check('人材・育成にG3キッチンリーダー', ppl.indexOf('G3キッチンリーダー') >= 0, ppl.join(','));
}

console.log('\n=== テスト2: DOHチェックリスト ===');
{
  const a = env({});
  check('DOH項目が20件以上ある', a.DOH.length >= 20, a.DOH.length + '件');
  const secs = [...new Set(a.DOH.map(x => x.sec))];
  check('区分が分かれている（管理体制・手指衛生・温度管理・交差汚染・表示保管・施設）',
    ['管理体制', '手指衛生', '温度管理', '交差汚染', '表示・保管', '施設'].every(s => secs.indexOf(s) >= 0),
    secs.join(' / '));
  check('温度の基準値が入っている',
    a.DOH.some(x => /41.F/.test(x.label)) && a.DOH.some(x => /135.F/.test(x.label)) && a.DOH.some(x => /165.F/.test(x.label)));

  const r1 = a.ccCheckRate({ checks: { d01: 'ok', d02: 'ok', d03: 'ng', d04: 'ok' } });
  check('適合率 = 適合 / (適合+不適合)', r1.pct === 75 && r1.ok === 3 && r1.ng === 1, `${r1.ok}適合 ${r1.ng}不適合 = ${r1.pct}%`);
  const r2 = a.ccCheckRate({ checks: { d01: '', d02: '' } });
  check('未入力だけなら判定しない', r2 === null);
  check('チェック無しは null', a.ccCheckRate(null) === null);

  const mt = a.ccMetrics().filter(m => m.id === 'm_doh')[0];
  check('DOHの実績は適合率になる',
    a.ccActualOf(mt, { checks: { a: 'ok', b: 'ng' } }) === 50);
  check('目標90%・適合率50% → 未達',
    a.ccScoreOk(mt, { target: 90, checks: { a: 'ok', b: 'ng' } }) === false);
  check('目標90%・適合率100% → 達成',
    a.ccScoreOk(mt, { target: 90, checks: { a: 'ok', b: 'ok' } }) === true);
  check('プラカードの選択肢がある', grabVar('var CC_PLACARD = [').indexOf('緑') >= 0);
  check('プラカードと検査日を保存する', /placard:/.test(grab('saveCcDoh')) && /inspectedAt:/.test(grab('saveCcDoh')));
}

console.log('\n=== テスト3: 行動のグループ振り分け ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08';
  store['cc_actions'] = [
    { id: 'a1', ym, cat: 'cost', what: '原価の行動', status: '進行中' },
    { id: 'a2', ym, cat: 'hygiene', what: '衛生の行動', status: '完了' },
    { id: 'a3', ym, cat: 'product', what: '商品開発の行動', status: '未着手' },
    { id: 'a4', ym, cat: 'quality', what: '品質の行動（旧カテゴリー）', status: '完了' },
    { id: 'a5', ym, cat: 'staff', what: '人員の行動（旧カテゴリー）', status: '進行中' },
    { id: 'a6', ym, cat: 'support', what: '応援要請', status: '未着手' },
    { id: 'a7', ym, cat: 'unknown_cat', what: '不明カテゴリー', status: '未着手' }
  ];
  check('原価管理に1件', a.ccGroupActions(ym, 'g_cost').length === 1);
  check('衛生管理に1件', a.ccGroupActions(ym, 'g_hyg').length === 1);
  /* v782: quality カテゴリーを品質管理へ移したので、メニュー開発は商品開発の1件だけになる。 */
  check('メニュー開発に1件（商品開発）', a.ccGroupActions(ym, 'g_dev').length === 1,
    a.ccGroupActions(ym, 'g_dev').map(x => x.id).join(','));
  check('品質管理に1件（クオリティ管理）', a.ccGroupActions(ym, 'g_qc').length === 1,
    a.ccGroupActions(ym, 'g_qc').map(x => x.id).join(','));
  check('人材・育成に1件（旧staffも解決）', a.ccGroupActions(ym, 'g_ppl').length === 1);
  check('未知のカテゴリーはその他に落ちる（行動が消えない）',
    a.ccGroupActions(ym, 'g_other').map(x => x.id).sort().join(',') === 'a6,a7',
    a.ccGroupActions(ym, 'g_other').map(x => x.id).join(','));
  const total = ['g_cost', 'g_hyg', 'g_qc', 'g_dev', 'g_ppl', 'g_other']   /* v782: g_qc を集計に追加 */
    .reduce((n, g) => n + a.ccGroupActions(ym, g).length, 0);
  check('どのグループにも入らない行動が無い', total === 7, total + '/7');
}

console.log('\n=== テスト4: グループ集計 ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08';
  /* 原価管理：F01は達成、F02は未達、他は未入力 */
  a.ccPutScore({ id: a._ccScoreId(ym, 'F01', 'm_cost'), ym, storeId: 'F01', metricId: 'm_cost', target: 28, actual: 27, _mut: 1 });
  a.ccPutScore({ id: a._ccScoreId(ym, 'F02', 'm_cost'), ym, storeId: 'F02', metricId: 'm_cost', target: 28, actual: 31, _mut: 1 });
  const sm = a.ccGroupSummary(ym, 'g_cost');
  check('達成1件', sm.done === 1, `達成${sm.done} / 入力済${sm.filled} / 未入力${sm.blank}`);
  check('入力済は2件', sm.filled === 2);
  check('未入力は残りすべて', sm.blank === sm.total - 2, `全${sm.total}`);
  check('全店×2指標が母数', sm.total === a.STORES.length * 2, sm.total + '');
}

console.log('\n=== テスト5: 未入力を未達にしない ===');
{
  const a = env({});
  const mt = { dir: 'higher' };
  check('目標だけ入力 → 判定しない', a.ccScoreOk(mt, { target: 90, actual: '' }) === null);
  check('実績だけ入力 → 判定しない', a.ccScoreOk(mt, { target: '', actual: 95 }) === null);
  check('両方入力で初めて判定', a.ccScoreOk(mt, { target: 90, actual: 95 }) === true);
}

console.log('\n=== テスト6: 折りたたみ ===');
{
  const a = env({});
  check('初期状態はすべて閉じている', Object.keys(a.open()).length === 0);
  a.toggleCcGroup('g_cost');
  check('タップで開く', a.open()['g_cost'] === true);
  a.toggleCcGroup('g_cost');
  check('もう一度タップで閉じる', a.open()['g_cost'] === false);
  check('見出しに開閉アイコンがある', /ti-chevron-down|ti-chevron-right/.test(grab('renderCcGrid')));
  check('閉じているグループは中身を描かない', /if\(!open\) return;/.test(grab('renderCcGrid')));
  check('行動の進捗バーがある', /width:'\s*\+\s*pct/.test(grab('_ccActionRow')));
  check('期限超過を表示する', /超過/.test(grab('_ccActionRow')));
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
