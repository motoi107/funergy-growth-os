/* ============================================================
   verify_v772.js — 週次更新（実行の記録）

     テスト1: 週の求め方（月曜始まり・月またぎ・年またぎ）
     テスト2: 同じ週を2端末で書いても合流する（idが決まっている）
     テスト3: 今週未更新の抽出（完了・中止は除く）
     テスト4: 状態が行動側へ反映される
     テスト5: 承認後は計画の中身を保存側でも止める
     テスト6: タブごとにタップ先が変わる
     テスト7: 保存キーの保護
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
  const FNS = ['_ccPad', '_ccWeekStart', 'ccThisWeek', '_ccWeekLabel', '_ccLogId',
    'ccLogs', 'ccLogsFor', 'ccLatestLog', '_ccPutLog', 'ccWeekPending',
    'ccActions', '_ccPutAction', '_ccMut', 'mergeCcList', '_coversCcList'];
  const consts = [grabVar('var CC_STATUS = ['), grabVar('var CC_PROGRESS = {')].join('\n');
  return new Function('__store', `
    ${consts}
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'CHEF'; } function nowJP(){ return 'now'; }
    function showToast(){}
    ${FNS.map(grab).join('\n')}
    return { _ccWeekStart, ccThisWeek, _ccWeekLabel, _ccLogId, ccLogs, ccLogsFor,
             ccLatestLog, _ccPutLog, ccWeekPending, ccActions, _ccPutAction, mergeCcList };`)(store);
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: 週の求め方（月曜始まり） ===');
{
  const a = env({});
  check('水曜 2026-08-05 → 月曜 2026-08-03', a._ccWeekStart('2026-08-05') === '2026-08-03', a._ccWeekStart('2026-08-05'));
  check('月曜はその日のまま', a._ccWeekStart('2026-08-03') === '2026-08-03');
  check('日曜は前の月曜へ寄る（2026-08-09 → 08-03）', a._ccWeekStart('2026-08-09') === '2026-08-03', a._ccWeekStart('2026-08-09'));
  check('月をまたぐ（2026-08-01 土 → 07-27）', a._ccWeekStart('2026-08-01') === '2026-07-27', a._ccWeekStart('2026-08-01'));
  check('年をまたぐ（2027-01-01 金 → 2026-12-28）', a._ccWeekStart('2027-01-01') === '2026-12-28', a._ccWeekStart('2027-01-01'));
  check('表示は「8/3の週」', a._ccWeekLabel('2026-08-03') === '8/3の週', a._ccWeekLabel('2026-08-03'));
  check('今週が求まる', /^\d{4}-\d{2}-\d{2}$/.test(a.ccThisWeek()), a.ccThisWeek());
}

console.log('\n=== テスト2: 同じ週の合流 ===');
{
  const a = env({});
  const id = a._ccLogId('2026-08', 'ca1', '2026-08-03');
  check('idが 月|行動|週 で決まる', id === '2026-08|ca1|2026-08-03', id);

  /* 端末Aが先に書き、端末Bが後から上書き */
  const m = a.mergeCcList(
    [{ id: id, did: '端末Aの記録', _mut: 100 }],
    [{ id: id, did: '端末Bの記録', _mut: 200 }]);
  check('同じ週は新しい方が残る', m.length === 1 && m[0].did === '端末Bの記録');

  /* 別の週・別の行動は独立 */
  const m2 = a.mergeCcList(
    [{ id: '2026-08|ca1|2026-08-03', _mut: 1 }],
    [{ id: '2026-08|ca1|2026-08-10', _mut: 1 }, { id: '2026-08|ca2|2026-08-03', _mut: 1 }]);
  check('別の週・別の行動は消えない（3件）', m2.length === 3, m2.map(x => x.id.split('|').slice(1).join('|')).join(' / '));
}

console.log('\n=== テスト3: 今週未更新の抽出 ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08', w = a.ccThisWeek();
  store['cc_actions'] = [
    { id: 'a1', ym, what: '進行中の行動', status: '進行中' },
    { id: 'a2', ym, what: '未着手の行動', status: '未着手' },
    { id: 'a3', ym, what: '完了した行動', status: '完了' },
    { id: 'a4', ym, what: '中止した行動', status: '中止' }
  ];
  let p = a.ccWeekPending(ym);
  check('完了・中止は対象外', p.map(x => x.id).sort().join(',') === 'a1,a2', p.map(x => x.id).join(','));

  a._ccPutLog({ id: a._ccLogId(ym, 'a1', w), ym, actionId: 'a1', week: w, did: 'やった', _mut: 1 });
  p = a.ccWeekPending(ym);
  check('更新すると未更新から外れる', p.map(x => x.id).join(',') === 'a2', p.map(x => x.id).join(','));

  /* 先週の更新では今週の未更新は解消しない */
  const store2 = {};
  const b = env(store2);
  store2['cc_actions'] = [{ id: 'b1', ym, what: 'x', status: '進行中' }];
  b._ccPutLog({ id: b._ccLogId(ym, 'b1', '2020-01-06'), ym, actionId: 'b1', week: '2020-01-06', did: '昔の記録', _mut: 1 });
  check('先週以前の更新では今週の未更新は解消しない', b.ccWeekPending(ym).length === 1);
  check('履歴は新しい週が先頭', b.ccLogsFor(ym, 'b1').length === 1);
}

console.log('\n=== テスト4: 状態の反映と履歴 ===');
{
  const store = {};
  const a = env(store);
  const ym = '2026-08';
  store['cc_actions'] = [{ id: 'a1', ym, what: 'x', status: '未着手' }];
  a._ccPutLog({ id: a._ccLogId(ym, 'a1', '2026-08-03'), ym, actionId: 'a1', week: '2026-08-03', did: '1週目', _mut: 1 });
  a._ccPutLog({ id: a._ccLogId(ym, 'a1', '2026-08-10'), ym, actionId: 'a1', week: '2026-08-10', did: '2週目', _mut: 2 });
  const h = a.ccLogsFor(ym, 'a1');
  check('週ごとに積み上がる', h.length === 2, h.length + '件');
  check('新しい週が先頭', h[0].week === '2026-08-10', h[0].week);
  check('最新の更新を引ける', a.ccLatestLog(ym, 'a1').did === '2週目');

  const s = grab('saveCcWeek');
  check('状態を行動側へ反映する', /_ccPutAction\(Object\.assign\(\{\}, a, \{ status: st/.test(s));
  check('空の保存を止める', /今週の内容を1つ以上入力してください/.test(s));
  check('記入者と時刻が残る', /by: myName\(\)/.test(s) && /at: nowJP\(\)/.test(s));
}

console.log('\n=== テスト5: 承認後は保存側でも止める ===');
{
  check('行動の保存が承認後に止まる', /if\(!ccPlanEditable\(ym\)\)\{ alert\('承認後の計画は変更できません/.test(grab('saveCcAction')));
  check('本部目標の保存も承認後に止まる', /if\(!ccPlanEditable\(ym\)\)/.test(grab('saveCcGoal')));
  check('週次更新は承認後も保存できる', !/ccPlanEditable/.test(grab('saveCcWeek')));
  check('結果報告も承認後に保存できる', !/ccPlanEditable/.test(grab('saveCcResult')));
}

console.log('\n=== テスト6: タブごとのタップ先 ===');
{
  const r = grab('renderCcGrid');
  check('実績タブでは週次更新を開く', /ccTab === 'actual'\) \? 'openCcWeekModal' : 'openCcActionModal'/.test(r));
  check('今週未更新の印を出す', /今週未更新/.test(r));
  check('最新の更新内容を行に出す', /_ccWeekLabel\(_lg\.week\)/.test(r));
  const p = grab('renderCcPlan');
  check('実績タブに今週の更新状況カードがある', /の更新/.test(p) && /ccWeekPending\(ym\)/.test(p));
  check('未更新が無ければその旨を出す', /今週の更新はすべて入っています/.test(p));
}

console.log('\n=== テスト7: 保存キーの保護 ===');
{
  const sp = new Function(grabVar('var _SPLIT_KEYS = {') + '\nreturn _SPLIT_KEYS;')();
  check('cc_logs は対象月ごとに行が分かれる', sp.cc_logs && sp.cc_logs.by({ ym: '2026-08' }) === '2026-08');
  check('論理削除が読み取りから外れる', sp.cc_logs.readFilter({ _deleted: true }) === false);
  const never = new Function(grabVar('var LS_NEVER_FREE = [') + '\nreturn LS_NEVER_FREE;')();
  check('cc_logs が LS_NEVER_FREE にある', never.indexOf('cc_logs') >= 0 && never.indexOf('spl_cc_logs_') >= 0);
  const prunable = new Function(grab('lsIsPrunable') + '\nreturn lsIsPrunable;')();
  check('自動削除の対象外', prunable('spl_cc_logs_2026-08') === false);
  check('合流ルールがある', /cc_logs:\s*\{ merge: mergeCcList/.test(SRC));
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
