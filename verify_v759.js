/* ===== v759 検証 =====
   目的: ある月の予算を保存したときに、他の月の予算が変わらない・消えないことを確認する。
   方針: 実ファイルの saveDowEdit / bbSave / getBudgetForMonth をそのまま動かし、
         修正前(v758)で 7月の表示が 8月の保存で変わってしまうことを再現してから、修正後を確認する。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v758_backup.html', 'utf8');

function grab(src, n) {
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

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* 曜日別データを作る（7日ぶん） */
function mkDow(lunchSpend, dinnerSpend) {
  const row = s => [0, 1, 2, 3, 4, 5, 6].map(() => ({ guests: 10, spend: s, orders: 0 }));
  return { lunch: row(lunchSpend), dinner: row(dinnerSpend), takeout: row(0) };
}
const JULY = mkDow(100, 200);     // 7月の内容
const AUG = mkDow(300, 400);      // 8月の内容

function build(src, opts) {
  opts = opts || {};
  const code = `
    var BUDGET_MONTHLY={};
    var DOW=[0,1,2,3,4,5,6];
    var ROLE_CONFIG={gm:{name:'GM'}};
    var curRole='gm', curUserName='Moto';
    var _bbStore='F05', _bbDow=null;
    var dowEditState=null;
    var SAVED=null;
    var BUDGETS=BUD;
    function bizYm(){ return '2026-07'; }
    function curYm(){ return '2026-07'; }
    function budgetYM(){ return {y:+SAVE_YM.split('-')[0], m:+SAVE_YM.split('-')[1]}; }
    function getBudgets(){ return BUDGETS; }
    function saveBudgets(x){ SAVED=x; return true; }
    function myName(){ return 'Moto'; }
    function nowJP(){ return '2026/07/27 17:00'; }
    function emptyDow(){ return { lunch:[], dinner:[], takeout:[] }; }
    function canEditBudget(){ return true; }
    function budStatusFor(b, ym){ return (b.months&&b.months[ym]&&b.months[ym].status)||b.status||''; }
    function budSetStatus(b, ym, s){ b.months=b.months||{}; b.months[ym]=b.months[ym]||{}; b.months[ym].status=s; }
    function budPinLegacyMonth(){ return false; }   /* 推定に頼る保険は無効化して、当月退避だけを見る */
    function closeDowEditor(){}
    function closeModalDirect(){}
    function showToast(){}
    function alert(){}
    function renderPage(){}
    function markBudgetSaved(){}
    function bbMarkDirty(){}
    var document={ querySelectorAll:function(){ return []; } };
    var console={warn:function(){}};
    ${src.indexOf('function budPinCurrentMonth(') >= 0 ? grab(src, 'budPinCurrentMonth') : 'function budPinCurrentMonth(){ return false; }'}
    ${grab(src, 'getDow')}
    ${grab(src, 'getBudgetForMonth')}
    ${grab(src, 'saveDow')}
    return {
      budgets:function(){ return BUDGETS; },
      forMonth:function(ym){ return getBudgetForMonth('F05', ym); },
      dowFor:function(ym){ return getDow(getBudgetForMonth('F05', ym)); },
      saveDow:function(ym, dow){ dowEditState={storeId:'F05', dow:dow}; SAVE_YM_SET(ym); saveDow(); },
      pin:budPinCurrentMonth
    };
  `;
  let SAVE_YM = opts.saveYm || '2026-08';
  const setter = v => { SAVE_YM = v; };
  // budYmStr は budgetYM を使うので、SAVE_YM を差し替えられるようにする
  const fn = new Function('BUD', 'SAVE_YM', 'SAVE_YM_SET',
    code.replace('var BUDGETS=BUD;', 'var BUDGETS=BUD;\n    ' + grab(src, 'budYmStr')));
  return fn(opts.budgets, SAVE_YM, setter);
}

/* Marujuu の実際の状態を再現：
   7月は自分の月データを持たず、共通の b.dow を見ている。8月は月データを持っている。 */
function mkBudgets(julyDow) {
  return [{
    storeId: 'F05',
    period: '2026.07',
    dow: JSON.parse(JSON.stringify(julyDow)),
    status: '承認済み',
    approvedAt: '2026/06/25 10:00',
    approvedBy: 'GM',
    submittedBy: 'Keisuke',
    rationale: '7月の考え方',
    months: {}
  }];
}

/* =========================================================
   T1: 8月を保存したときに7月の表示が変わらないか（本題）
   ========================================================= */
console.log('\n[T1] 8月を保存 → 7月の表示');
{
  function run(src) {
    const bud = mkBudgets(JULY);
    const env = build(src, { budgets: bud, saveYm: '2026-08' });
    const before = env.dowFor('2026-07').lunch[0].spend;
    env.saveDow('2026-08', AUG);
    const after = env.dowFor('2026-07').lunch[0].spend;
    return { before, after, bud };
  }
  const o = run(OLD), n = run(NEW);

  ok('修正前(v758): 8月を保存すると7月の数字が8月のものに変わる（報告された症状）',
    o.before === 100 && o.after === 300, o.before + ' → ' + o.after);
  ok('修正後(v759): 7月の数字は変わらない',
    n.before === 100 && n.after === 100, n.before + ' → ' + n.after);
  ok('修正後: 8月は保存した数字になる',
    n.bud[0].months['2026-08'].dow.lunch[0].spend === 300);
  ok('修正後: 7月が自分の月データを持つようになる',
    !!(n.bud[0].months['2026-07'] && n.bud[0].months['2026-07'].dow));
  ok('修正後: 7月は自動退避の印が付く（あとで本保存すれば外れる）',
    n.bud[0].months['2026-07']._pinned === true);
}

/* =========================================================
   T2: 既存の月データを消していないか
   ========================================================= */
console.log('\n[T2] 既存の月データが消えないか');
{
  const bud = mkBudgets(JULY);
  bud[0].months['2026-08'] = {
    dow: JSON.parse(JSON.stringify(AUG)),
    days: { '2026-08-01': 5000 },
    daysBy: 'Keisuke', daysAt: '2026/07/27 16:31',
    status: '承認済み', submittedBy: 'Keisuke', approvedBy: 'GM',
    rationale: '8月の考え方'
  };
  const env = build(NEW, { budgets: bud, saveYm: '2026-08' });
  env.saveDow('2026-08', mkDow(999, 999));
  const m = bud[0].months['2026-08'];

  ok('曜日別だけが差し替わる', m.dow.lunch[0].spend === 999);
  ok('日別の入力が残る', m.days && m.days['2026-08-01'] === 5000);
  ok('承認状態が残る', m.status === '承認済み');
  ok('提出者が残る', m.submittedBy === 'Keisuke');
  ok('承認者が残る', m.approvedBy === 'GM');
  ok('その月の考え方が残る', m.rationale === '8月の考え方');

  // 修正前は？
  const bud2 = mkBudgets(JULY);
  bud2[0].months['2026-08'] = { dow: JSON.parse(JSON.stringify(AUG)), status: '承認済み', approvedBy: 'GM' };
  const o = build(OLD, { budgets: bud2, saveYm: '2026-08' });
  o.saveDow('2026-08', mkDow(999, 999));
  ok('修正前(v758): 曜日別エディタは月データを作っていなかった',
    !bud2[0].months['2026-08'].dow || bud2[0].months['2026-08'].dow.lunch[0].spend !== 999);
}

/* =========================================================
   T3: すでに月データがある月は退避で上書きされないか
   ========================================================= */
console.log('\n[T3] すでに月データがある月');
{
  const bud = mkBudgets(JULY);
  bud[0].months['2026-07'] = { dow: mkDow(11, 22), status: '承認済み', approvedBy: 'GM' };
  const env = build(NEW, { budgets: bud, saveYm: '2026-08' });
  env.saveDow('2026-08', AUG);

  ok('7月の既存データは退避で上書きされない',
    bud[0].months['2026-07'].dow.lunch[0].spend === 11,
    String(bud[0].months['2026-07'].dow.lunch[0].spend));
  ok('7月の承認状態も残る', bud[0].months['2026-07'].status === '承認済み');
  ok('7月に自動退避の印は付かない', !bud[0].months['2026-07']._pinned);
  ok('7月の表示も既存データのまま', env.dowFor('2026-07').lunch[0].spend === 11);
}

/* =========================================================
   T4: 当月そのものを保存したとき
   ========================================================= */
console.log('\n[T4] 当月（7月）を保存し直す');
{
  const bud = mkBudgets(JULY);
  bud[0].months['2026-08'] = { dow: JSON.parse(JSON.stringify(AUG)), status: '承認済み' };
  const env = build(NEW, { budgets: bud, saveYm: '2026-07' });
  env.saveDow('2026-07', mkDow(555, 666));

  ok('7月が自分の月データを持つ', bud[0].months['2026-07'].dow.lunch[0].spend === 555);
  ok('7月の表示が保存した数字になる', env.dowFor('2026-07').lunch[0].spend === 555);
  ok('自動退避の印は外れる（本保存したため）', !bud[0].months['2026-07']._pinned);
  ok('8月は影響を受けない', bud[0].months['2026-08'].dow.lunch[0].spend === 300);
  ok('8月の承認状態も無事', bud[0].months['2026-08'].status === '承認済み');
}

/* =========================================================
   T5: 退避部品そのもの
   ========================================================= */
console.log('\n[T5] 当月退避の部品');
{
  const env = build(NEW, { budgets: mkBudgets(JULY), saveYm: '2026-08' });
  ok('保存する月が当月なら退避しない（自分で書かれるため）',
    env.pin({ dow: JULY, months: {} }, '2026-07') === false);
  ok('共通データが無ければ何もしない',
    env.pin({ months: {} }, '2026-08') === false);
  ok('b が無くても落ちない', env.pin(null, '2026-08') === false);

  const b = { dow: JULY, months: { '2026-07': { status: '承認済み', days: { x: 1 } } } };
  env.pin(b, '2026-08');
  ok('月データはあるが曜日別が無い場合は、曜日別だけ足す',
    !!b.months['2026-07'].dow && b.months['2026-07'].status === '承認済み' && !!b.months['2026-07'].days);

  const b2 = { dow: JULY, months: {} };
  env.pin(b2, '2026-08');
  const first = JSON.stringify(b2.months['2026-07'].dow);
  b2.dow = AUG;
  env.pin(b2, '2026-08');
  ok('2回目の退避で上書きされない', JSON.stringify(b2.months['2026-07'].dow) === first);
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
