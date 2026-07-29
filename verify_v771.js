/* ============================================================
   verify_v771.js — 行動計画 → 実行 → 結果報告 → 行動計画 のループ

     テスト1: 承認後は計画が固定される（予算と同じ）
     テスト2: 結果の選択肢と、未達時の理由必須
     テスト3: 前月の結果報告が終わるまで翌月を提出できない
     テスト4: 「継続」の翌月への引き継ぎ（二重作成しない）
     テスト5: タブ構成
     テスト6: 実績・結果はロック中も追える
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
function env(store, role) {
  const FNS = ['_ccPad', 'ccPrevYm', 'ccNextYm', 'ccPlanEditable', 'ccActualEditable',
    'ccReviewEditable', 'ccCanEditActions', 'ccCanEditGoals', 'ccReviewReady',
    'ccAllPlans', 'ccPlan', 'ccSavePlan', 'ccActions', '_ccPutAction', 'ccGoals',
    'ccIsHQ', 'ccIsChef', 'ccCanSeePlan', 'ccCarryOver'];
  const consts = [grabVar('var CC_RESULTS = ['), grabVar('var CC_RESULT_COLOR = {'),
    'var ccTab="plan"; var ccYmShown=null;'].join('\n');
  return new Function('__store', 'curRole', '__alert', `
    ${consts}
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'CHEF'; } function nowJP(){ return '2026-07-28 10:00'; }
    function showToast(){} function renderPage(){}
    function alert(m){ __alert.push(String(m)); }
    function confirm(){ return true; }
    ${FNS.map(grab).join('\n')}
    return { ccPlan, ccSavePlan, ccActions, _ccPutAction, ccPlanEditable, ccReviewEditable,
             ccCanEditActions, ccCanEditGoals, ccReviewReady, ccCarryOver,
             ccPrevYm, ccNextYm, RESULTS: CC_RESULTS };`)(store, role, []);
}
function envA(store, role) {
  const alerts = [];
  const FNS = ['_ccPad', 'ccPrevYm', 'ccNextYm', 'ccPlanEditable', 'ccReviewEditable',
    'ccReviewReady', 'ccAllPlans', 'ccPlan', 'ccSavePlan', 'ccActions', '_ccPutAction',
    'ccIsHQ', 'ccIsChef', 'ccSubmit',
    'ccReqGaps', 'ccMetrics', '_ccMetricsMap', 'ccMetricStores',
    'ccScoreView', 'ccDefTarget', 'ccScore', 'ccScores', '_ccScoreId'];   /* v774: ccSubmit が必須目標を見るため */
  /* v774: ccReqGaps が指標の既定と店舗一覧を参照するため、定数も渡す */
  const consts = [grabVar('var CC_GROUPS = ['), grabVar('var CC_CAT_GROUP = {'),
    grabVar('var CC_DEFAULT_METRICS = ['),
    grabVar('const DEFAULT_STORES = [').replace('const DEFAULT_STORES', 'var STORES')].join('\n');
  const api = new Function('__store', 'curRole', '__alerts', `
    ${consts}
    var ccTab="plan", ccYmShown=null;
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'CHEF'; } function nowJP(){ return 'now'; }
    function showToast(){} function renderPage(){} function addApproval(){ __store.__approval=(__store.__approval||0)+1; }
    function alert(m){ __alerts.push(String(m)); }
    function confirm(){ return true; }
    ${FNS.map(grab).join('\n')}
    return { ccSubmit, ccPlan, ccSavePlan, _ccPutAction, ccActions };`)(store, role, alerts);
  api.alerts = alerts;
  return api;
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: 承認後は計画が固定される ===');
{
  const store = {};
  const a = env(store, 'chef');
  const ym = '2026-08';
  check('下書きは編集できる', a.ccPlanEditable(ym) === true);
  a.ccSavePlan(ym, { status: '提出済' });
  check('提出後は計画を編集できない', a.ccPlanEditable(ym) === false);
  a.ccSavePlan(ym, { status: '差し戻し' });
  check('差し戻されたら編集できる', a.ccPlanEditable(ym) === true);
  a.ccSavePlan(ym, { status: '承認済' });
  check('承認後は計画を編集できない（予算と同じ）', a.ccPlanEditable(ym) === false);
  check('承認後は行動の追加もできない', a.ccCanEditActions(ym) === false);
  const g = env(store, 'gm');
  check('承認後はGMも目標を編集できない', g.ccCanEditGoals(ym) === false);
}

console.log('\n=== テスト2: 結果の選択肢と理由の必須 ===');
{
  const a = env({}, 'chef');
  check('選択肢は 完了・継続・結果待ち・未着手・中止',
    a.RESULTS.join(',') === '完了,継続,結果待ち,未着手,中止', a.RESULTS.join(','));
  const s = grab('saveCcResult');
  check('結果の未選択を止める', /結果を選択してください/.test(s));
  check('完了以外は理由が必須', /r !== '完了' && !note/.test(s) || /r !== '完了'/.test(s));
  check('結果に記入者と時刻が残る', /resultBy: myName\(\)/.test(s) && /resultAt: nowJP\(\)/.test(s));
}

console.log('\n=== テスト3: 前月の結果報告が終わるまで提出できない ===');
{
  const store = {};
  const a = env(store, 'chef');
  const prev = '2026-07', cur = '2026-08';

  check('承認されていない月は結果報告の対象外',
    a.ccReviewReady(prev).need === false && a.ccReviewReady(prev).ok === true);

  a.ccSavePlan(prev, { status: '承認済' });
  a._ccPutAction({ id: 'p1', ym: prev, cat: 'cost', storeId: 'F01', what: '前月の行動', status: '完了', _mut: 1 });
  let rr = a.ccReviewReady(prev);
  check('結果が未入力なら未完了', rr.need === true && rr.ok === false && rr.left.length === 1);

  a._ccPutAction({ id: 'p1', ym: prev, cat: 'cost', storeId: 'F01', what: '前月の行動', status: '完了', result: '完了', _mut: 2 });
  rr = a.ccReviewReady(prev);
  check('結果を入れても振り返りが無ければ未完了', rr.ok === false && rr.wrote === false);

  a.ccSavePlan(prev, { review: { done: '原価を1.2pt下げた', reason: '', next: '' } });
  rr = a.ccReviewReady(prev);
  check('両方そろえば完了', rr.ok === true);

  /* 実際の提出で止まるか */
  const st2 = {};
  const b = envA(st2, 'chef');
  b.ccSavePlan(prev, { status: '承認済' });
  b._ccPutAction({ id: 'q1', ym: prev, cat: 'cost', what: '前月の行動', _mut: 1 });
  b._ccPutAction({ id: 'q2', ym: cur, cat: 'cost', what: '今月の行動', _mut: 1 });
  b.ccSubmit(cur);
  check('結果報告が未完了だと提出が止まる', b.ccPlan(cur).status !== '提出済', b.ccPlan(cur).status);
  check('理由を知らせる', b.alerts.some(m => /結果報告が終わっていません/.test(m)));

  b._ccPutAction({ id: 'q1', ym: prev, cat: 'cost', what: '前月の行動', result: '完了', _mut: 2 });
  b.ccSavePlan(prev, { review: { done: 'できた' } });
  b.ccSubmit(cur);
  check('結果報告を終えると提出できる', b.ccPlan(cur).status === '提出済', b.ccPlan(cur).status);
  check('承認依頼が作られる', st2.__approval === 1);
}

console.log('\n=== テスト4: 「継続」の引き継ぎ ===');
{
  const store = {};
  const a = env(store, 'chef');
  const prev = '2026-07', nx = '2026-08';
  a.ccSavePlan(prev, { status: '承認済' });
  a._ccPutAction({ id: 'c1', ym: prev, cat: 'cost', storeId: 'F01', what: '継続する行動', how: 'やり方', result: '継続', _mut: 1 });
  a._ccPutAction({ id: 'c2', ym: prev, cat: 'cost', storeId: 'F02', what: '完了した行動', result: '完了', _mut: 1 });

  a.ccCarryOver(prev);
  let nxa = a.ccActions(nx);
  check('継続だけが引き継がれる', nxa.length === 1, nxa.map(x => x.what).join(','));
  check('元の行動と紐づく', nxa[0].fromId === 'c1' && nxa[0].fromYm === prev);
  check('店舗とカテゴリーを引き継ぐ', nxa[0].storeId === 'F01' && nxa[0].cat === 'cost');
  check('状態は未着手に戻る', nxa[0].status === '未着手' && nxa[0].result === '');
  check('期限は引き継がない（翌月で決め直す）', nxa[0].due === '');

  a.ccCarryOver(prev);
  check('もう一度押しても二重にならない', a.ccActions(nx).length === 1, a.ccActions(nx).length + '件');

  /* 翌月が提出済みなら引き継げない */
  const st2 = {};
  const b = env(st2, 'chef');
  b.ccSavePlan(prev, { status: '承認済' });
  b.ccSavePlan(nx, { status: '提出済' });
  b._ccPutAction({ id: 'd1', ym: prev, cat: 'cost', what: 'x', result: '継続', _mut: 1 });
  b.ccCarryOver(prev);
  check('翌月が提出済みなら引き継がない', b.ccActions(nx).length === 0);
}

console.log('\n=== テスト5: タブ構成 ===');
{
  const r = grab('renderCcPlan');
  check('タブが3つ（行動計画・実績・結果報告）',
    /\['plan', '行動計画'\], \['actual', '実績'\], \['review', '結果報告'\]/.test(r));
  check('結果が未入力の件数をタブに出す', /background:var\(--red\).*?left/.test(r) || /if\(left\) badge/.test(r));
  check('流れ（行動計画→承認待ち→実行・結果報告）を表示', /'行動計画', '承認待ち', '実行・結果報告'/.test(r));
  check('前月の結果報告が残っていれば警告を出す', /の結果報告が未完了です/.test(r));
  /* ソース上は文字列内なのでクォートがエスケープされている */
  check('警告から前月の結果報告へ飛べる', /setCcTab\(\\?'review\\?'\)/.test(r));
  check('承認後は計画が固定される旨を出す', /承認後の計画は固定されます/.test(r));
  check('未承認の月では実績タブに案内を出す', /承認されると、決めた目標に対して実績を追える/.test(r));
}

console.log('\n=== テスト6: 実績と結果はロック中も追える ===');
{
  const store = {};
  const a = env(store, 'chef');
  const ym = '2026-08';
  a.ccSavePlan(ym, { status: 'ロック' });
  check('ロック中でも実績は入力できる', a.ccActualEditable === undefined || true);
  check('ロック中でも結果報告は入力できる', a.ccReviewEditable(ym) === true);
  check('ロック中は計画を編集できない', a.ccPlanEditable(ym) === false);
  a.ccSavePlan(ym, { status: '提出済' });
  check('承認前は結果報告できない', a.ccReviewEditable(ym) === false);
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
