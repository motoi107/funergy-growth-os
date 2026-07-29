/* ============================================================
   verify_v770.js — 事実 → 改善目標 → 行動 → 進捗 の一体表示

     テスト1: フードハンドラー保持の重複が解消されている
     テスト2: 差（あとどれだけ改善するか）の計算
     テスト3: 前月からの推移（事実の並び）
     テスト4: 店舗ごとの行動の割り当てと進捗
     テスト5: 全店まとめ（人・件は合計、率は平均）
     テスト6: 行動追加時に店舗とカテゴリーが引き継がれる
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
    'ccGroupSummary', 'ccGroupActions', 'ccActions', '_ccPad', 'ccPrevYm', 'ccGap',
    'ccStoreActions', 'ccProgressOf', 'ccGroupAgg', '_ccNum'];
  const consts = [grabVar('var CC_GROUPS = ['), grabVar('var CC_GROUP_CAT = {'),
    grabVar('var CC_CAT_GROUP = {'), grabVar('var CC_DEFAULT_METRICS = ['),
    grabVar('var CC_DOH_ITEMS = ['), grabVar('var CC_PROGRESS = {'),
    grabVar('const DEFAULT_STORES = [').replace('const DEFAULT_STORES', 'var STORES')].join('\n');
  return new Function('__store', `
    ${consts}
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'T'; } function nowJP(){ return '2026-07-28 10:00'; }
    function showToast(){} function renderPage(){}
    ${FNS.map(grab).join('\n')}
    return { ccMetrics, ccGroupMetrics, ccMetricStores, ccScore, ccPutScore, ccGap,
             ccPrevYm, ccStoreActions, ccProgressOf, ccGroupAgg, ccGroupActions,
             _ccScoreId, DOH: CC_DOH_ITEMS, GCAT: CC_GROUP_CAT, STORES };`)(store);
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: フードハンドラーの重複解消 ===');
{
  const a = env({});
  const hyg = a.ccGroupMetrics('g_hyg');
  check('衛生管理の指標はDOHの1つだけ', hyg.length === 1 && hyg[0].id === 'm_doh',
    hyg.map(m => m.label).join(','));
  check('フードハンドラー保持の指標が消えている', !a.ccMetrics().some(m => m.id === 'm_fh'));
  check('DOHチェックリストにフードハンドラー証がある',
    a.DOH.some(x => /フードハンドラー証/.test(x.label)),
    (a.DOH.filter(x => /フードハンドラー/.test(x.label))[0] || {}).label || 'なし');
  check('項目数が増えている（抜けていない）', a.DOH.length === 27, a.DOH.length + '件');
}

console.log('\n=== テスト2: 差（あとどれだけ改善するか）===');
{
  const a = env({});
  const lower = { dir: 'lower' }, higher = { dir: 'higher' };
  let g = a.ccGap(lower, { target: 28, actual: 30.2 });
  check('低い方が良い：実績30.2 目標28 → あと2.2改善', g.need === 2.2 && g.ok === false, 'need=' + g.need);
  g = a.ccGap(lower, { target: 28, actual: 27 });
  check('低い方が良い：達成しているとき ok=true', g.ok === true && g.need === -1);
  g = a.ccGap(higher, { target: 90, actual: 80 });
  check('高い方が良い：実績80 目標90 → あと10改善', g.need === 10 && g.ok === false);
  g = a.ccGap(higher, { target: 90, actual: 95 });
  check('高い方が良い：達成', g.ok === true);
  check('ちょうど目標は達成', a.ccGap(lower, { target: 28, actual: 28 }).ok === true);
  check('片方でも未入力なら差を出さない',
    a.ccGap(lower, { target: 28, actual: '' }) === null && a.ccGap(lower, { target: '', actual: 30 }) === null);
}

console.log('\n=== テスト3: 前月からの推移 ===');
{
  const a = env({});
  check('前月が求まる', a.ccPrevYm('2026-08') === '2026-07', a.ccPrevYm('2026-08'));
  check('年またぎ', a.ccPrevYm('2026-01') === '2025-12', a.ccPrevYm('2026-01'));

  const store = {};
  const b = env(store);
  b.ccPutScore({ id: b._ccScoreId('2026-07', 'F01', 'm_cost'), ym: '2026-07', storeId: 'F01', metricId: 'm_cost', target: 28, actual: 31.0, _mut: 1 });
  b.ccPutScore({ id: b._ccScoreId('2026-08', 'F01', 'm_cost'), ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 28, actual: 30.2, _mut: 1 });
  const cur = b.ccScore('2026-08', 'F01', 'm_cost'), pv = b.ccScore(b.ccPrevYm('2026-08'), 'F01', 'm_cost');
  check('前月の実績を引ける', pv && Number(pv.actual) === 31.0, pv ? pv.actual : 'なし');
  check('推移が計算できる（31.0 → 30.2 = -0.8）',
    Math.round((Number(cur.actual) - Number(pv.actual)) * 10) / 10 === -0.8);
  check('描画に前月比が含まれる', /前月 /.test(grab('renderCcGrid')));
  check('描画に「あと〇改善」が含まれる', /あと /.test(grab('renderCcGrid')));
}

console.log('\n=== テスト4: 店舗ごとの行動と進捗 ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08';
  store['cc_actions'] = [
    { id: 'a1', ym, cat: 'cost', storeId: 'F01', what: 'F01の原価行動', status: '完了' },
    { id: 'a2', ym, cat: 'cost', storeId: 'F01', what: 'F01の原価行動2', status: '進行中' },
    { id: 'a3', ym, cat: 'cost', storeId: 'F02', what: 'F02の原価行動', status: '未着手' },
    { id: 'a4', ym, cat: 'cost', storeId: 'ALL', what: '全店の原価行動', status: '確認待ち' },
    { id: 'a5', ym, cat: 'hygiene', storeId: 'F01', what: 'F01の衛生行動', status: '進行中' }
  ];
  const f01 = a.ccStoreActions(ym, 'g_cost', 'F01');
  check('F01の原価行動は自店2件＋全店1件', f01.length === 3, f01.map(x => x.id).join(','));
  check('全店の行動が各店に出る', f01.some(x => x.id === 'a4'));
  check('他店の行動は出ない', !f01.some(x => x.id === 'a3'));
  check('別グループの行動は混ざらない', !f01.some(x => x.id === 'a5'));

  /* 完了100 + 進行中50 + 確認待ち80 = 230 / 3 = 76.67 → 77 */
  check('進捗はステータスの平均', a.ccProgressOf(f01) === 77, a.ccProgressOf(f01) + '%');
  check('行動が無ければ null', a.ccProgressOf([]) === null);
  check('全部完了なら100', a.ccProgressOf([{ status: '完了' }, { status: '完了' }]) === 100);
}

console.log('\n=== テスト5: 全店まとめ ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08';
  const mtCost = a.ccMetrics().filter(m => m.id === 'm_cost')[0];
  a.ccPutScore({ id: a._ccScoreId(ym, 'F01', 'm_cost'), ym, storeId: 'F01', metricId: 'm_cost', target: 28, actual: 30, _mut: 1 });
  a.ccPutScore({ id: a._ccScoreId(ym, 'F02', 'm_cost'), ym, storeId: 'F02', metricId: 'm_cost', target: 28, actual: 26, _mut: 1 });
  const ag = a.ccGroupAgg(ym, mtCost);
  check('率は平均になる（30と26 → 28）', ag.actual === 28, String(ag.actual));
  check('目標も平均', ag.target === 28, String(ag.target));
  check('入力済の件数が分かる', ag.n === 2 && ag.of === a.STORES.length, `${ag.n}/${ag.of}`);

  const mtG3 = a.ccMetrics().filter(m => m.id === 'm_g3')[0];
  a.ccPutScore({ id: a._ccScoreId(ym, 'F01', 'm_g3'), ym, storeId: 'F01', metricId: 'm_g3', target: 1, actual: 2, _mut: 1 });
  a.ccPutScore({ id: a._ccScoreId(ym, 'F02', 'm_g3'), ym, storeId: 'F02', metricId: 'm_g3', target: 1, actual: 3, _mut: 1 });
  const ag2 = a.ccGroupAgg(ym, mtG3);
  check('人数は合計になる（2と3 → 5）', ag2.actual === 5, String(ag2.actual));
  check('未入力しかなければ null', a.ccGroupAgg('2099-01', mtCost).actual === null);
}

console.log('\n=== テスト6: 行動追加時の引き継ぎ ===');
{
  const a = env({});
  check('グループ→カテゴリーの対応がある',
    a.GCAT.g_cost === 'cost' && a.GCAT.g_hyg === 'hygiene' && a.GCAT.g_ppl === 'leader',
    JSON.stringify(a.GCAT));
  const m = grab('openCcActionModal');
  check('店舗とカテゴリーを引数で受ける', /function openCcActionModal\(ym, id, presetGrp, presetStore\)/.test(m));
  check('新規のときだけ既定値に使う',
    /cat:\(presetGrp && CC_GROUP_CAT\[presetGrp\]\)/.test(m) && /storeId: presetStore \|\| 'ALL'/.test(m));
  const r = grab('renderCcGrid');
  check('店舗カードから引き継いで呼んでいる', /openCcActionModal\([^)]*g\.id[^)]*s\.id/.test(r));
  check('ロック中は追加ボタンを出さない', /if\(canEdit\)\{/.test(r));
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
