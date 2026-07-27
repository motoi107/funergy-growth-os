/* v745: 翌月以降の予算がQコミットビューに反映されることを実ファイルの関数で検証 */
const fs=require('fs'); const vm=require('vm');
const src=fs.readFileSync('/home/claude/index.html','utf8');
function grab(n){
 let i=src.indexOf('async function '+n+'(');
 if(i<0) i=src.indexOf('function '+n+'(');
 if(i<0)throw new Error(n);
 let d=0,st=false;
 for(let j=i;j<src.length;j++){const c=src[j];if(c==='{'){d++;st=true;}else if(c==='}'){d--;if(st&&d===0)return src.slice(i,j+1);}}throw new Error(n);}
let pass=0,fail=0;
function eq(n,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);
 if(ok){pass++;console.log('  PASS '+n);}else{fail++;console.log('  FAIL '+n+'\n    got : '+JSON.stringify(g)+'\n    want: '+JSON.stringify(w));}}

const code=[grab('_dowHasReal'), grab('_monHasReal'), grab('_qbBudgetIsForMonth'),
  grab('budYmStr'), grab('budMon'), grab('_ymFromStamp'), grab('_budGuessStatusYm'),
  grab('_budLegacyYm'), grab('budStatusFor')].join('\n') + `
function getBudgets(){ return _BUDGETS; }
function bizYm(){ return '2026-07'; }
function budgetYM(){ return { y:2026, m:8 }; }
function curYm(){ return '2026-07'; }
`;
const dow8={ lunch:[{guests:20,spend:18},{},{},{},{},{},{}], dinner:[{guests:30,spend:32},{},{},{},{},{},{}], takeout:[] };
const sandbox={ console, JSON, Object, Array, String, Number, parseInt, parseFloat, isFinite, Date,
  _BUDGETS:[{ storeId:'F04-K', status:'承認済み', _statusYm:'2026-08',
    months:{ '2026-08':{ status:'承認済み', approvedBy:'Moto', approvedAt:'2026/07/27 01:00', dow:dow8 } } }] };
vm.createContext(sandbox); vm.runInContext(code,sandbox);
const S=sandbox;

console.log('== 1) 【本件】7月時点で作って承認した8月の予算 ==');
{
  const bView={ storeId:'F04-K', dow:dow8 };
  eq('8月が登録済みと判定される【修正前は false】', S._qbBudgetIsForMonth(bView,'2026-08'), true);
  eq('8月のステータスは承認済み', S.budStatusFor(S._BUDGETS[0],'2026-08'), '承認済み');
}

console.log('\n== 2) データの無い月は登録済みにしない ==');
{
  const bView={ storeId:'F04-K', dow:dow8 };
  eq('9月（データなし）は false', S._qbBudgetIsForMonth(bView,'2026-09'), false);
  eq('6月（データなし）は false', S._qbBudgetIsForMonth(bView,'2026-06'), false);
}

console.log('\n== 3) 当月は従来どおり（旧データ互換） ==');
{
  /* months を持たない旧データでも、当月なら登録済みとして扱う */
  S._BUDGETS=[{ storeId:'F01', dow:dow8 }];
  const bView={ storeId:'F01', dow:dow8 };
  eq('当月(2026-07)は true', S._qbBudgetIsForMonth(bView,'2026-07'), true);
  eq('翌月(2026-08)は false（データが無いため）', S._qbBudgetIsForMonth(bView,'2026-08'), false);
}

console.log('\n== 4) 中身が空の月は登録済みにしない（誤って売上を出さない） ==');
{
  S._BUDGETS=[{ storeId:'F02', months:{ '2026-08':{ status:'下書き' } } }];   /* dowもdaysも無い */
  const bView={ storeId:'F02' };
  eq('空の月データは false', S._qbBudgetIsForMonth(bView,'2026-08'), false);
  S._BUDGETS=[{ storeId:'F02', months:{ '2026-08':{ dow:{ lunch:[{guests:0,spend:0}], dinner:[], takeout:[] } } } }];
  eq('客数0・単価0だけの月も false', S._qbBudgetIsForMonth(bView,'2026-08'), false);
}

console.log('\n== 5) 日別調整だけの月も登録済みとして扱う ==');
{
  S._BUDGETS=[{ storeId:'F03', months:{ '2026-09':{ days:{ '2026-09-01':1200 } } } }];
  const bView={ storeId:'F03' };
  eq('日別だけでも true', S._qbBudgetIsForMonth(bView,'2026-09'), true);
}

console.log('\n== 6) 月別ファイルは従来どおり優先 ==');
{
  eq('_fromFile は常に true', S._qbBudgetIsForMonth({ _fromFile:true, storeId:'F01' },'2026-12'), true);
}

console.log('\n== 7) 予算が無ければ false ==');
{
  eq('null は false', S._qbBudgetIsForMonth(null,'2026-08'), false);
}

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
