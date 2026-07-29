/* ============================================================
   verify_v767.js — Corporate Chef 月間行動計画の検証

     テスト1: 対象月ごとに行が分かれる（月またぎで他の月を壊さない）
     テスト2: 合流ルール — id和集合・勝敗は時刻・論理削除が復活しない
     テスト3: カバー率と、紐づけゼロの目標がある間は承認できないこと
     テスト4: 権限（誰が提出でき、誰が承認できるか）
     テスト5: 提出期限が前月25日・承認期限が前月28日
     テスト6: ロック後は編集できない
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
  if (i < 0) throw new Error('見つかりません: ' + decl);
  const open = decl.indexOf('[') >= 0 ? '[' : '{', close = open === '[' ? ']' : '}';
  let d = 0, st = false, j = i;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === open) { d++; st = true; }
    else if (c === close) { d--; if (st && d === 0) { j++; break; } }
  }
  return SRC.slice(i, j) + ';';
}

const FNS = ['_ccMut', 'mergeCcList', '_coversCcList', '_ccPad', 'ccYmDefault', 'ccDeadlines',
  '_ccToday', '_ccDaysLeft', 'ccIsHQ', 'ccIsChef', 'ccCanSeePlan', 'ccCanEditActions',
  'ccCanEditGoals', 'ccAllPlans', 'ccPlan', 'ccSavePlan', 'ccGoals', 'ccActions',
  '_ccPutGoal', '_ccPutAction', 'ccCoverage'];

function build(store, role) {
  /* 定数は製品コードから取り出す（テスト側に値を書き写さない） */
  const consts = [
    /var CC_SUBMIT_DAY\s*=\s*\d+;/, /var CC_APPROVE_DAY\s*=\s*\d+;/, /var ccYmShown\s*=\s*null;/
  ].map(re => { const m = re.exec(SRC); if (!m) throw new Error('定数が見つかりません: ' + re); return m[0]; }).join('\n');
  const code = FNS.map(grab).join('\n');
  const fn = new Function('__store', 'curRole', `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(__store,k) ? __store[k] : d; }
    function lsSet(k, v){ __store[k]=v; return true; }
    function myName(){ return 'TESTER'; }
    function nowJP(){ return '2026-07-28 10:00'; }
    function showToast(){}
    ${consts}
    ${code}
    return { ccPlan, ccSavePlan, ccGoals, ccActions, _ccPutGoal, _ccPutAction, ccCoverage,
             ccDeadlines, ccYmDefault, mergeCcList, _coversCcList,
             ccIsHQ, ccIsChef, ccCanEditActions, ccCanEditGoals, ccCanSeePlan,
             days:function(){ return [CC_SUBMIT_DAY, CC_APPROVE_DAY]; } };`);
  return fn(store, role);
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

/* ============================================================
   テスト1: 対象月ごとに行が分かれる
   ============================================================ */
console.log('\n=== テスト1: 対象月ごとに行が分かれる ===');
{
  const sp = new Function(grabVar('var _SPLIT_KEYS = {') + '\nreturn _SPLIT_KEYS;')();
  check('cc_actions が対象月で分割される',
    sp.cc_actions && sp.cc_actions.by({ ym: '2026-08' }) === '2026-08',
    'spl_cc_actions_' + (sp.cc_actions ? sp.cc_actions.by({ ym: '2026-08' }) : '?'));
  check('hq_goals が対象月で分割される',
    sp.hq_goals && sp.hq_goals.by({ ym: '2026-08' }) === '2026-08');
  check('cc_plans は月をキーにした設定型', sp.cc_plans && sp.cc_plans.type === 'obj');
  check('論理削除が読み取りから外れる',
    sp.cc_actions.readFilter({ _deleted: true }) === false &&
    sp.cc_actions.readFilter({ _deleted: false }) === true);

  /* 8月を保存しても7月の行に触らない（分割先が別なので構造的に起きない） */
  check('7月と8月で保存先の行が異なる',
    sp.cc_actions.by({ ym: '2026-07' }) !== sp.cc_actions.by({ ym: '2026-08' }));

  const api = build({}, 'chef');
  api._ccPutAction({ id: 'a1', ym: '2026-07', what: '7月の行動', _mut: 1 });
  api._ccPutAction({ id: 'a2', ym: '2026-08', what: '8月の行動', _mut: 2 });
  check('月で絞って読める',
    api.ccActions('2026-07').length === 1 && api.ccActions('2026-08').length === 1,
    `7月=${api.ccActions('2026-07').length} / 8月=${api.ccActions('2026-08').length}`);
}

/* ============================================================
   テスト2: 合流ルール
   ============================================================ */
console.log('\n=== テスト2: 合流（id和集合・時刻で判定・復活しない）===');
{
  const api = build({}, 'gm');
  const cloud = [{ id: 'a1', what: 'クラウド版', _mut: 100 }, { id: 'a2', what: '他端末だけが持つ', _mut: 50 }];
  const local = [{ id: 'a1', what: 'ローカル版', _mut: 200 }, { id: 'a3', what: '自分だけが持つ', _mut: 60 }];
  const m = api.mergeCcList(cloud, local);
  check('和集合になる（3件）', m.length === 3, m.map(x => x.id).join(','));
  check('新しい方が勝つ', m.filter(x => x.id === 'a1')[0].what === 'ローカル版');
  check('他端末だけが持つ行動が消えない', m.some(x => x.id === 'a2'));

  /* 値の大小では決めない：内容が短くても新しければ勝つ */
  const m2 = api.mergeCcList([{ id: 'x', how: 'とても長い説明文', _mut: 10 }],
    [{ id: 'x', how: '', _mut: 20 }]);
  check('内容が減る変更も時刻が新しければ通る（握り潰さない）', m2[0].how === '');

  /* 論理削除が復活しない */
  const m3 = api.mergeCcList([{ id: 'd1', _deleted: false, _mut: 100 }],
    [{ id: 'd1', _deleted: true, _mut: 200 }]);
  check('新しい削除は復活しない', m3[0]._deleted === true);
  const m4 = api.mergeCcList([{ id: 'd2', _deleted: false, _mut: 300 }],
    [{ id: 'd2', _deleted: true, _mut: 100 }]);
  check('古い削除は新しい編集に負ける', m4[0]._deleted === false);

  check('covers: 反映済みなら true',
    api._coversCcList([{ id: 'a1', _mut: 200 }], [{ id: 'a1', _mut: 200 }]) === true);
  check('covers: 古い版しか無ければ false',
    api._coversCcList([{ id: 'a1', _mut: 100 }], [{ id: 'a1', _mut: 200 }]) === false);
  check('covers: 欠けていれば false',
    api._coversCcList([], [{ id: 'a1', _mut: 1 }]) === false);
}

/* ============================================================
   テスト3: カバー率と承認ブロック
   ============================================================ */
console.log('\n=== テスト3: カバー率と承認の条件 ===');
{
  const store = {};
  const api = build(store, 'gm');
  const ym = '2026-08';
  api._ccPutGoal({ id: 'g1', ym, title: '原価28%以下', _mut: 1 });
  api._ccPutGoal({ id: 'g2', ym, title: '衛生基準の策定', _mut: 1 });
  api._ccPutAction({ id: 'a1', ym, goalId: 'g1', what: '仕込みロス調査', _mut: 1 });

  let cov = api.ccCoverage(ym);
  check('カバー率が 1/2 = 50%', cov.total === 2 && cov.covered === 1 && cov.pct === 50,
    `${cov.covered}/${cov.total} = ${cov.pct}%`);

  api._ccPutAction({ id: 'a2', ym, goalId: 'g2', what: '基準書のたたき台作成', _mut: 1 });
  cov = api.ccCoverage(ym);
  check('紐づけを足すと 100%', cov.pct === 100, `${cov.covered}/${cov.total}`);

  /* 自主提案（goalId 空）はカバー率に数えない */
  api._ccPutAction({ id: 'a3', ym, goalId: '', what: '自主提案', _mut: 1 });
  cov = api.ccCoverage(ym);
  check('自主提案はカバー率に影響しない', cov.pct === 100 && cov.total === 2);

  /* 承認の条件が「カバー率100%」であること（製品コードの確認） */
  const app = grab('ccApprove');
  check('ccApprove がカバー率で承認を止める', /cov\.covered\s*<\s*cov\.total/.test(app));
  check('差し戻し理由が必須', /理由は必須/.test(grab('ccReturn')));
}

/* ============================================================
   テスト4: 権限
   ============================================================ */
console.log('\n=== テスト4: 権限 ===');
{
  const mk = (role) => build({}, role);
  check('chef は計画側', mk('chef').ccIsChef() === true && mk('chef').ccIsHQ() === false);
  check('gm は本部側', mk('gm').ccIsHQ() === true && mk('gm').ccIsChef() === false);
  check('ceo も本部側', mk('ceo').ccIsHQ() === true);
  check('経理(office)は閲覧権限なし', mk('office').ccCanSeePlan() === false);
  check('店長(g4)は閲覧権限なし', mk('g4').ccCanSeePlan() === false);
  check('本部目標を編集できるのは本部側だけ',
    mk('gm').ccCanEditGoals('2026-08') === true && mk('chef').ccCanEditGoals('2026-08') === false);

  const sub = grab('ccSubmit'), app = grab('ccApprove');
  const render = grab('renderCcPlan');
  check('提出ボタンは chef のときだけ出る', /ccIsChef\(\)\s*&&\s*\(plan\.status/.test(render));
  check('承認・差し戻しは本部側のときだけ出る', /ccIsHQ\(\)\s*&&\s*plan\.status\s*===\s*'提出済'/.test(render));
}

/* ============================================================
   テスト5: 期限
   ============================================================ */
console.log('\n=== テスト5: 提出期限・承認期限 ===');
{
  const api = build({}, 'gm');
  check('スペックどおり前月25日・28日', api.days()[0] === 25 && api.days()[1] === 28, api.days().join('日 / ')+'日');
  let d = api.ccDeadlines('2026-08');
  check('8月の計画 → 提出 7/25・承認 7/28',
    d.submit === '2026-07-25' && d.approve === '2026-07-28', `${d.submit} / ${d.approve}`);
  d = api.ccDeadlines('2027-01');
  check('年をまたぐ（1月の計画 → 前年12/25・12/28）',
    d.submit === '2026-12-25' && d.approve === '2026-12-28', `${d.submit} / ${d.approve}`);
  d = api.ccDeadlines('2026-03');
  check('3月の計画 → 2/25・2/28', d.submit === '2026-02-25' && d.approve === '2026-02-28',
    `${d.submit} / ${d.approve}`);
}

/* ============================================================
   テスト6: ロック
   ============================================================ */
console.log('\n=== テスト6: ロック後は編集できない ===');
{
  const store = {};
  const api = build(store, 'chef');
  const ym = '2026-08';
  check('通常時は編集できる', api.ccCanEditActions(ym) === true);
  api.ccSavePlan(ym, { status: 'ロック' });
  check('ロック後は chef も編集できない', api.ccCanEditActions(ym) === false);

  const gm = build(store, 'gm');
  check('ロック後は GM も目標を編集できない', gm.ccCanEditGoals(ym) === false);
  check('ロック解除は本部側だけ', /ccIsHQ\(\)\s*&&\s*locked/.test(grab('renderCcPlan')));
}

/* ============================================================
   テスト7: 自動削除から守られているか
   ============================================================ */
console.log('\n=== テスト7: 自動削除の対象になっていないか ===');
{
  const never = new Function(grabVar("var LS_NEVER_FREE = [") + '\nreturn LS_NEVER_FREE;')();
  ['spl_cc_plans_', 'hq_goals', 'spl_hq_goals_', 'cc_actions', 'spl_cc_actions_']
    .forEach(k => check(`${k} が LS_NEVER_FREE にある`, never.indexOf(k) >= 0));
  /* 基底キー cc_plans は lsSet が分割保存へ横取りするため端末に実在しない。
     保護対象に入れると監査が永久に MISS を出し、本物の漏れを見落とす原因になる。 */
  check('基底キー cc_plans は保護対象に入れない（監査の偽陽性を避ける）', never.indexOf('cc_plans') < 0);

  const prunable = new Function(grab('lsIsPrunable') + '\nreturn lsIsPrunable;')();
  check('cc_actions は自動削除の対象外', prunable('spl_cc_actions_2026-08') === false);
  check('hq_goals は自動削除の対象外', prunable('spl_hq_goals_2026-08') === false);
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
