/* 予算の保存経路を実コードで再現する診断 */
const fs = require('fs');
const src = fs.readFileSync('/home/claude/index.html', 'utf8');

/* 実ファイルから関数本体をそのまま切り出す */
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

const names = ['_splitPrefix', '_splitRead', '_splitWrite', 'mergeBudgets', '_coversBudgets', 'repairBudgetDupes', 'verifyBudgetSaved', '_dowHasReal',
  '_budHasReal', '_budTs', '_budWeight', '_mergeBudMonths', '_monHasReal',
  '_budStripTs', 'saveBudgets', 'getBudgets'];
let code = names.map(grab).join('\n');

/* localStorage モック */
const store = {};
const localStorage = {
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i],
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const _SPLIT_KEYS = {
  budgets_v2: { type: 'arr', by: (r) => r && r.storeId, noDelete: true },
};
/* ls / lsSet も同じスコープ内で定義（実アプリと同じ経路にする） */
code += `
function _lsRaw(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function ls(k,d){ var sp=_SPLIT_KEYS[k]; if(sp) return _splitRead(k,sp); return _lsRaw(k,d); }
function lsSet(k,v){ var sp=_SPLIT_KEYS[k]; if(sp) return _splitWrite(k,sp,v); localStorage.setItem(k, JSON.stringify(v)); return true; }
function snapshotBudgetsLocal(){}
`;
const STORES = [{ id: 'F04-K' }, { id: 'F04-P' }];
const OP_MERGE_LOCAL = {};
const sandbox = { localStorage, _SPLIT_KEYS, STORES, getPeriod: () => '2026.8',
  _opMergeDef: (k) => (String(k).indexOf('budgets_v2')>=0 ? { merge: (a,b)=>sandbox.mergeBudgets(a,b), covers: (a,b)=>sandbox._coversBudgets(a,b) } : null),
  showToast: () => {},
  JSON, Object, Array, String, Number, Date, console, isFinite, parseFloat, parseInt };
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

let issues = 0;
function check(label, cond, detail) {
  if (cond) console.log('  OK   ' + label);
  else { issues++; console.log('  >>>> 問題あり: ' + label + (detail ? '\n         ' + detail : '')); }
}

console.log('=== 前提: 端末に「旧・統合キー budgets_v2」と「分割キー spl_budgets_v2_<店>」が両方ある状態 ===');
console.log('（v720の畳み込みは「idの無いキーは対象外」＝budgets_v2は畳み込まれないため、実機で普通に起こる）\n');

/* 旧・統合キー：クラウドのlegacy行からログイン時に書き戻される、中身の薄い版 */
localStorage.setItem('budgets_v2', JSON.stringify([
  { storeId: 'F04-K', period: '2026.8', status: '下書き', segments: null, bases: [], actual: 0 }
]));
/* 分割キー：店舗が実際に作った予算 */
localStorage.setItem('spl_budgets_v2_F04-K', JSON.stringify([
  { storeId: 'F04-K', period: '2026.8', status: '下書き', _ts: 1000,
    dow: { lunch: [{ guests: 20, spend: 18 }], dinner: [{ guests: 30, spend: 32 }], takeout: [{ orders: 10, spend: 25 }] },
    months: { '2026-08': { _ts: 1000, total: 250000 } } }
]));

console.log('■ 1) 読み出し（getBudgets 相当）');
const read = S.ls('budgets_v2', null);
console.log('   読み出した件数:', read.length, '/ storeId:', read.map(x => x.storeId).join(', '));
const dupK = read.filter(x => x.storeId === 'F04-K').length;
check('同じ店舗が1件だけ返る', dupK === 1, 'F04-K が ' + dupK + ' 件返っている（重複）');

console.log('\n■ 2) find() で取れるのはどちらか');
const found = read.find(x => x.storeId === 'F04-K');
check('入力した予算(dowあり)が取れる', !!(found && found.dow), '取れたのは ' + (found && found.dow ? '入力済み' : '空の殻') + ' の方');

console.log('\n■ 3) 保存（saveBudgets → lsSet → _splitWrite）を1回通す');
S.saveBudgets(read);
const partAfter = JSON.parse(localStorage.getItem('spl_budgets_v2_F04-K'));
console.log('   分割キーの中身:', partAfter.length, '件');
check('分割キーに同じ店舗が1件だけ', partAfter.length === 1,
  '保存のたびに重複が書き戻される（' + partAfter.length + '件）');
if (partAfter.length > 1) {
  console.log('         内訳: ' + partAfter.map(x => (x.dow ? '入力済み' : '空の殻') + (x._ts ? '(_ts=' + x._ts + ')' : '(_tsなし)')).join(' / '));
}

console.log('\n■ 4) 保存を繰り返したときの増え方');
for (let i = 0; i < 3; i++) S.saveBudgets(S.ls('budgets_v2', null));
const partN = JSON.parse(localStorage.getItem('spl_budgets_v2_F04-K'));
console.log('   3回追加保存後の分割キー:', partN.length, '件');
check('保存を繰り返しても増えない', partN.length === 1, partN.length + '件まで増殖');

console.log('\n■ 5) クラウドとのマージで、空の殻が勝たないか');
const cloud = [{ storeId: 'F04-K', period: '2026.8', status: '下書き', segments: null, bases: [], actual: 0, _ts: 9999 }];
const merged = S.mergeBudgets(cloud, S.ls('budgets_v2', null));
const m = merged.find(x => x.storeId === 'F04-K');
check('マージ後も入力した予算が残る', !!(m && m.dow), '空の殻が勝って dow が消えた');
check('マージ後も月データが残る', !!(m && m.months && m.months['2026-08']), '月データが消えた');

console.log('\n■ 6) _coversBudgets（保存できたかの検証）が重複配列で正しく働くか');
const want = S.ls('budgets_v2', null);
check('自分自身をカバーと判定できる', S._coversBudgets(want, want) === true, '保存検証が常に失敗し、未送信キューに積まれ続ける');


console.log('\n■ 7) 修復関数（既に書き込まれた重複を畳む）');
localStorage.setItem('spl_budgets_v2_F04-K', JSON.stringify([
  { storeId:'F04-K', period:'2026.8', status:'GM承認待ち', _ts:2000, dow:{lunch:[{guests:20,spend:18}],dinner:[],takeout:[]}, months:{'2026-08':{_ts:2000,total:250000}} },
  { storeId:'F04-K', period:'2026.8', status:'下書き', segments:null, bases:[], actual:0 }
]));
const rr = S.repairBudgetDupes(true);
const after = JSON.parse(localStorage.getItem('spl_budgets_v2_F04-K'));
check('重複が1件に畳まれる', after.length === 1, after.length + '件のまま');
check('入力内容(dow)が残る', !!(after[0] && after[0].dow), 'dowが失われた');
check('提出ステータスが残る', after[0] && after[0].status === 'GM承認待ち', 'status=' + (after[0]||{}).status);
check('月データが残る', !!(after[0] && after[0].months && after[0].months['2026-08']), '月データが失われた');

console.log('\n■ 8) 保存確認（verifyBudgetSaved）');
const v1 = S.verifyBudgetSaved('F04-K', (x) => x && x.status === 'GM承認待ち');
check('保存済みを ok と判定', v1.ok === true, v1.reason || '');
const v2 = S.verifyBudgetSaved('F04-K', (x) => x && x.months && x.months['2026-12']);
check('未保存の内容は ok にしない', v2.ok === false, '未保存でも ok になっている');

console.log('\n===== 検出された問題: ' + issues + ' 件 =====');
