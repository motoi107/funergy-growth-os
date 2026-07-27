/* v734: 提出者名／考え方の月別化／承認の月指定 を実ファイルの関数で検証 */
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

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got : ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

/* ---- 共通サンドボックス ---- */
const names = ['budYmStr', 'budMon', '_ymFromStamp', '_budLegacyYm', '_budGuessStatusYm', 'budStatusFor',
  'budSetStatus', 'budRationale', 'budSetRationale', 'budMonMeta', 'myName', 'resolveApprovalByRef'];
let code = names.map(grab).join('\n');
code += `
function ls(k,d){ return (k in _store) ? JSON.parse(JSON.stringify(_store[k])) : d; }
function lsSet(k,v){ _store[k]=JSON.parse(JSON.stringify(v)); return true; }
`;
let YM = { y: 2026, m: 8 };
const sandbox = {
  _store: {},
  budgetYM: () => YM,
  curYm: () => '2026-07',
  nowJP: () => '2026/07/26 20:22',
  curUserName: 'Masamitsu',
  curRole: 'am',
  ROLE_CONFIG: { am: { name: 'Yuki' }, gm: { name: 'Moto' }, sl: { name: 'Store Leader' } },
  console, JSON, Object, Array, String, Number, Date, isFinite, parseInt, parseFloat,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

console.log('== 1) 提出者・承認者が「本人の名前」になる ==');
{
  eq('G5でログイン中の本人名を返す（ロール既定名 Yuki ではない）', S.myName(), 'Masamitsu');
  sandbox.curUserName = '';
  eq('本人名が無いときだけロール既定名', S.myName(), 'Yuki');
  sandbox.curUserName = 'Masamitsu';
  /* ソース側で古い書き方が残っていないこと */
  eq('提出者にロール既定名を使っていない', /b\.submittedBy = myName\(\)/.test(src), true);
  eq('承認者にロール既定名を使っていない', /b\.approvedBy=myName\(\)/.test(src), true);
  eq('考え方の記録者も本人名', (src.match(/by:myName\(\), at:nowJP\(\)/g) || []).length >= 1, true);
}

console.log('\n== 2) 「予算の考え方」が月ごとに保存される ==');
{
  const b = { storeId: 'F02', period: '2026.6', months: {} };
  YM = { y: 2026, m: 8 };
  S.budSetRationale(b, '2026-08', '8月はKPIと今年の実績を基に算出', 'ディナーはシーズナルメニュー');
  YM = { y: 2026, m: 9 };
  S.budSetRationale(b, '2026-09', '9月は営業日が1日少ない', 'ランチは丼スペシャル');

  eq('8月の考え方が残る', S.budRationale(b, '2026-08').basis, '8月はKPIと今年の実績を基に算出');
  eq('9月の考え方も別に残る【従来は上書きされていた】', S.budRationale(b, '2026-09').basis, '9月は営業日が1日少ない');
  eq('8月の重点は8月のまま', S.budRationale(b, '2026-08').focus, 'ディナーはシーズナルメニュー');
  eq('記録者は本人名', S.budRationale(b, '2026-09').by, 'Masamitsu');
  eq('7月には考え方が無い', S.budRationale(b, '2026-07'), null);

  /* 同じ月を書き直すと履歴に積む */
  S.budSetRationale(b, '2026-08', '書き直した根拠', '書き直した重点');
  eq('書き直しが反映される', S.budRationale(b, '2026-08').basis, '書き直した根拠');
  eq('前の内容は履歴に残る', b.months['2026-08'].rationaleHistory.length, 1);
  eq('9月は影響を受けない', S.budRationale(b, '2026-09').basis, '9月は営業日が1日少ない');
}

console.log('\n== 3) 旧データ（店舗に1つの考え方）はその月にだけ出る ==');
{
  const b = { storeId: 'F03', period: '2026.7', status: '承認済み',
    approvedAt: '2026/07/05 14:00',
    rationale: { basis: '旧データの根拠', focus: '旧データの重点', by: 'Yuki', at: '2026/07/05 11:56' } };
  eq('承認日から7月に紐づく', S._budLegacyYm(b), '2026-07');
  eq('7月では見える', S.budRationale(b, '2026-07').basis, '旧データの根拠');
  eq('8月では出ない（別の月の考え方を流用しない）', S.budRationale(b, '2026-08'), null);
}

console.log('\n== 4) 承認依頼の消化が「その月だけ」になる ==');
{
  S._store.approvals = [
    { id: 'a1', type: '予算', ref: 'F02', ym: '2026-08', status: 'pending' },
    { id: 'a2', type: '予算', ref: 'F02', ym: '2026-09', status: 'pending' },
    { id: 'a3', type: '予算', ref: 'F04-K', ym: '2026-08', status: 'pending' },
  ];
  S.resolveApprovalByRef('予算', 'F02', 'approved', '2026-08');
  const ap = S.ls('approvals', []);
  eq('8月の依頼だけ承認済みになる', ap.find(a => a.id === 'a1').status, 'approved');
  eq('9月の依頼は残る【従来は一緒に消えていた】', ap.find(a => a.id === 'a2').status, 'pending');
  eq('他店の依頼も残る', ap.find(a => a.id === 'a3').status, 'pending');
}

console.log('\n== 5) 月を持たない古い依頼は積み残さない ==');
{
  S._store.approvals = [
    { id: 'b1', type: '予算', ref: 'F02', status: 'pending' },          /* 旧: 月なし */
    { id: 'b2', type: '予算', ref: 'F02', ym: '2026-09', status: 'pending' },
  ];
  S.resolveApprovalByRef('予算', 'F02', 'approved', '2026-08');
  const ap = S.ls('approvals', []);
  eq('月を持たない旧依頼は消化される', ap.find(a => a.id === 'b1').status, 'approved');
  eq('別の月の依頼は残る', ap.find(a => a.id === 'b2').status, 'pending');
}

console.log('\n== 6) ソース側の配線確認 ==');
{
  eq('承認依頼に対象月(ym)を持たせている', /type:'予算', from:b\.submittedBy, store:sName, ref:storeId, ym:_symYm/.test(src), true);
  eq('依頼タイトルが対象月になっている', src.indexOf("'予算承認依頼 — '+sName+'（'+_symYm+'）'") >= 0, true);
  eq('同じ店舗・同じ月の未処理依頼は作り直さない', /dup\.length/.test(src), true);
  eq('承認は依頼の月を受け取る', /function approveBudgetSeg\(storeId, ym\)/.test(src), true);
  eq('差し戻しも依頼の月を受け取る', /function rejectBudgetSeg\(storeId, ym\)/.test(src), true);
  eq('承認センターのボタンが月を渡す', /approveBudgetSeg\(\\''\+a\.ref\+_ymArg/.test(src), true);
  eq('承認カードに対象月を表示', src.indexOf("t('対象月','Month')") >= 0, true);
  eq('承認カードはその月の考え方を表示', /budRationale\(_bb, _aYm\)/.test(src), true);
  eq('考え方・日別も依頼の月で開く', /openBudgetReview\(\\''\+a\.ref\+'\\',false'/.test(src), true);
  eq('確認画面の既定月が予算画面の月', /var ym=ymArg\|\|\(\(typeof budYmStr==='function'\)\?budYmStr\(\):curYm\(\)\)/.test(src), true);
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
