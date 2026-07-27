/* v729: 予算の提出・承認が月ごとに独立していることを、実ファイルの関数で検証 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/claude/index.html', 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const names = ['budYmStr', 'budMon', '_budLegacyYm', 'budStatusFor', 'budSetStatus', 'budMonMeta',
  'migrateBudgetStatusYm', 'canEditBudget', '_splitPrefix', '_splitRead', '_splitWrite',
  'mergeBudgets', '_coversBudgets', '_budHasReal', '_budTs', '_budWeight', '_mergeBudMonths',
  '_monHasReal', '_dowHasReal', '_budStripTs', 'saveBudgets', 'verifyBudgetSaved'];
let code = names.map(grab).join('\n');
code += `
function _lsRaw(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function ls(k,d){ var sp=_SPLIT_KEYS[k]; if(sp) return _splitRead(k,sp); return _lsRaw(k,d); }
function lsSet(k,v){ var sp=_SPLIT_KEYS[k]; if(sp) return _splitWrite(k,sp,v); localStorage.setItem(k, JSON.stringify(v)); return true; }
function snapshotBudgetsLocal(){}
`;

const store = {};
const localStorage = {
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i],
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
let YM = { y: 2026, m: 8 };            /* 画面で選んでいる月 */
let ROLE = 'sl';
const sandbox = {
  localStorage,
  _SPLIT_KEYS: { budgets_v2: { type: 'arr', by: (r) => r && r.storeId, noDelete: true } },
  _opMergeDef: (k) => (String(k).indexOf('budgets_v2') >= 0
    ? { merge: (a, b) => sandbox.mergeBudgets(a, b), covers: (a, b) => sandbox._coversBudgets(a, b) } : null),
  budgetYM: () => YM,
  curYm: () => '2026-07',
  get curRole() { return ROLE; },
  getPeriod: () => '2026.8',
  console, JSON, Object, Array, String, Number, Date, isFinite, parseFloat, parseInt,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got : ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

/* ---- 実機と同じ状態を作る: 7月は承認済み、8月はこれから作る ---- */
function setup() {
  for (const k of Object.keys(store)) delete store[k];
  localStorage.setItem('spl_budgets_v2_F04-K', JSON.stringify([{
    storeId: 'F04-K', period: '2026.7', status: '承認済み',
    approvedBy: 'Moto', approvedAt: '2026/07/13 00:16',
    dow: { lunch: [{ guests: 20, spend: 18 }], dinner: [], takeout: [] },
    months: { '2026-07': { _ts: 1000, dow: { lunch: [{ guests: 20, spend: 18 }], dinner: [], takeout: [] } } },
    _ts: 1000
  }]));
  localStorage.removeItem('_bud_status_ym_v729');
  S.migrateBudgetStatusYm();
  return S.ls('budgets_v2', [])[0];
}

console.log('== 1) スクリーンショットの状態を再現（7月承認済み・8月画面） ==');
{
  const b = setup();
  YM = { y: 2026, m: 7 };
  eq('7月は承認済みのまま', S.budStatusFor(b, '2026-07'), '承認済み');
  YM = { y: 2026, m: 8 };
  eq('8月は下書き（承認済みが引き継がれない）', S.budStatusFor(b, '2026-08'), '下書き');
  eq('画面が8月なら既定も8月の状態', S.budStatusFor(b), '下書き');
  eq('承認者は7月にだけ紐づく', S.budMonMeta(b, '2026-07').approvedBy, 'Moto');
  eq('8月には承認者がいない', S.budMonMeta(b, '2026-08').approvedBy, '');
}

console.log('\n== 2) 【本件の原因】8月の予算が編集できるか ==');
{
  const b = setup();
  ROLE = 'sl';
  YM = { y: 2026, m: 7 };
  eq('7月（承認済み）はSLが編集不可＝正しい', S.canEditBudget(b, '2026-07'), false);
  YM = { y: 2026, m: 8 };
  eq('8月はSLが編集できる【修正前は false で保存が弾かれていた】', S.canEditBudget(b, '2026-08'), true);
  eq('月を省略しても画面の月(8月)で判定', S.canEditBudget(b), true);
}

console.log('\n== 3) 8月を提出しても7月の承認が壊れない ==');
{
  const b = setup();
  YM = { y: 2026, m: 8 };
  S.budSetStatus(b, '2026-08', 'GM承認待ち', { submittedBy: 'Store Leader', submittedAt: '2026/08/01 10:00' });
  eq('8月はGM承認待ち', S.budStatusFor(b, '2026-08'), 'GM承認待ち');
  eq('7月は承認済みのまま', S.budStatusFor(b, '2026-07'), '承認済み');
  eq('8月の提出者が記録される', S.budMonMeta(b, '2026-08').submittedBy, 'Store Leader');
  eq('7月の承認者は消えない', S.budMonMeta(b, '2026-07').approvedBy, 'Moto');
  ROLE = 'sl';
  eq('提出後は8月が編集不可になる', S.canEditBudget(b, '2026-08'), false);
  ROLE = 'gm';
  eq('GMは8月を承認できる状態', S.budStatusFor(b, '2026-08'), 'GM承認待ち');
  S.budSetStatus(b, '2026-08', '承認済み', { approvedBy: 'Moto', approvedAt: '2026/08/01 12:00' });
  eq('8月承認後も7月は独立', [S.budStatusFor(b, '2026-07'), S.budStatusFor(b, '2026-08')], ['承認済み', '承認済み']);
  eq('9月はまだ下書き', S.budStatusFor(b, '2026-09'), '下書き');
}

console.log('\n== 4) 保存して読み直しても月別状態が保たれる ==');
{
  const b = setup();
  YM = { y: 2026, m: 8 };
  S.budSetStatus(b, '2026-08', 'GM承認待ち', { submittedBy: 'SL', submittedAt: 'x' });
  const arr = S.ls('budgets_v2', []);
  const idx = arr.findIndex(x => x.storeId === 'F04-K');
  arr[idx] = b;
  const ok = S.saveBudgets(arr);
  eq('保存が成功を返す', ok !== false, true);
  const re = S.ls('budgets_v2', []).find(x => x.storeId === 'F04-K');
  eq('読み直しても8月はGM承認待ち', S.budStatusFor(re, '2026-08'), 'GM承認待ち');
  eq('読み直しても7月は承認済み', S.budStatusFor(re, '2026-07'), '承認済み');
  eq('店舗の重複は無い', S.ls('budgets_v2', []).filter(x => x.storeId === 'F04-K').length, 1);
  const vf = S.verifyBudgetSaved('F04-K', (x) => S.budStatusFor(x, '2026-08') === 'GM承認待ち');
  eq('提出の保存確認が通る', vf.ok, true);
}

console.log('\n== 5) 月データが無い店（Waikiki Garlic Shack 型）の扱い ==');
{
  for (const k of Object.keys(store)) delete store[k];
  localStorage.setItem('spl_budgets_v2_F03-G', JSON.stringify([{
    storeId: 'F03-G', period: '2026.7', status: '承認済み', approvedBy: 'Yuki', approvedAt: '2026/07/05 11:56',
    dow: { lunch: [{ guests: 5, spend: 10 }], dinner: [], takeout: [] }
  }]));
  localStorage.removeItem('_bud_status_ym_v729');
  S.migrateBudgetStatusYm();
  const b = S.ls('budgets_v2', [])[0];
  eq('period から7月と判定される', S._budLegacyYm(b), '2026-07');
  eq('7月は承認済み', S.budStatusFor(b, '2026-07'), '承認済み');
  eq('8月は下書き＝編集できる', S.budStatusFor(b, '2026-08'), '下書き');
  ROLE = 'sl';
  eq('8月をSLが編集できる', S.canEditBudget(b, '2026-08'), true);
}

console.log('\n== 6) 差し戻し → 再提出も月別 ==');
{
  const b = setup();
  S.budSetStatus(b, '2026-08', '差し戻し', { rejectReason: '客数が高すぎる', rejectedAt: 'x' });
  eq('8月が差し戻し', S.budStatusFor(b, '2026-08'), '差し戻し');
  eq('差し戻し理由が月に紐づく', S.budMonMeta(b, '2026-08').rejectReason, '客数が高すぎる');
  ROLE = 'sl';
  eq('差し戻し中はSLが編集できる', S.canEditBudget(b, '2026-08'), true);
  if (S.budStatusFor(b, '2026-08') === '差し戻し') S.budSetStatus(b, '2026-08', '再提出済み');
  eq('再提出済みになる', S.budStatusFor(b, '2026-08'), '再提出済み');
  eq('7月は影響を受けない', S.budStatusFor(b, '2026-07'), '承認済み');
}

console.log('\n== 7) 旧データ補完は一度だけ・既存の月別状態を壊さない ==');
{
  const b = setup();
  S.budSetStatus(b, '2026-08', 'GM承認待ち');
  const arr = S.ls('budgets_v2', []); arr[0] = b; S.saveBudgets(arr);
  localStorage.removeItem('_bud_status_ym_v729');
  S.migrateBudgetStatusYm();                     /* もう一度走らせても */
  const re = S.ls('budgets_v2', []).find(x => x.storeId === 'F04-K');
  eq('8月の状態が保持される', S.budStatusFor(re, '2026-08'), 'GM承認待ち');
  eq('7月の状態も保持される', S.budStatusFor(re, '2026-07'), '承認済み');
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
