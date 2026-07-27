/* v743: 翌月データが常駐扱いになりクラウドへ送られることを実ファイルの関数で検証 */
const fs=require('fs'); const vm=require('vm');
const src=fs.readFileSync('/home/claude/index.html','utf8');
function grab(n){
 let i=src.indexOf('async function '+n+'(');
 if(i<0) i=src.indexOf('function '+n+'(');
 if(i<0)throw new Error(n);
 let d=0,st=false;
 for(let j=i;j<src.length;j++){const c=src[j];if(c==='{'){d++;st=true;}else if(c==='}'){d--;if(st&&d===0)return src.slice(i,j+1);}}throw new Error(n);}
function grabVar(n){
 const i=src.indexOf('var '+n+' = [');
 if(i<0)throw new Error(n);
 const j=src.indexOf('];', i);
 return src.slice(i, j+2);}
let pass=0,fail=0;
function eq(n,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);
 if(ok){pass++;console.log('  PASS '+n);}else{fail++;console.log('  FAIL '+n+'\n    got : '+JSON.stringify(g)+'\n    want: '+JSON.stringify(w));}}

const code=[grabVar('_LS_ONDEMAND_KEYS'), grabVar('_LS_ONDEMAND_PREFIX'),
  grab('_lsOnDemand'), grab('_lsPushBlocked')].join('\n') + `
var _LS_FETCHED = {};
/* 今日 = 2026-07-27（HST）を想定 */
function _lsYmNow(){ return '2026-07'; }
function _lsYmPrev(){ return '2026-06'; }
function _lsPdNow(){ return '2026.7'; }
function _lsPdPrev(){ return '2026.6'; }
`;
const sandbox={ console, String, parseInt, Array, JSON };
vm.createContext(sandbox); vm.runInContext(code,sandbox);
const S=sandbox;

console.log('== 1) 【本件】翌月の承認済み予算が常駐になる ==');
eq('2026-08（翌月）は常駐＝押し上げできる【修正前は不可】', S._lsOnDemand('budget_approved_F03_2026-08'), false);
eq('押し上げが止まらない', S._lsPushBlocked('budget_approved_F03_2026-08'), false);
eq('Piikoi の8月も同じ', S._lsPushBlocked('budget_approved_F04-P_2026-08'), false);

console.log('\n== 2) 当月・前月は従来どおり常駐 ==');
eq('2026-07（当月）', S._lsOnDemand('budget_approved_F01_2026-07'), false);
eq('2026-06（前月）', S._lsOnDemand('budget_approved_F01_2026-06'), false);

console.log('\n== 3) 前月より古いものは従来どおり必要時取得 ==');
eq('2026-05 は必要時', S._lsOnDemand('budget_approved_F01_2026-05'), true);
eq('2025-12 は必要時', S._lsOnDemand('budget_approved_F01_2025-12'), true);
eq('未取得なら押し上げを止める（クラウド保護は維持）', S._lsPushBlocked('budget_approved_F01_2026-05'), true);

console.log('\n== 4) さらに先の月も常駐（年跨ぎ） ==');
eq('2026-09', S._lsOnDemand('budget_approved_F01_2026-09'), false);
eq('2026-12', S._lsOnDemand('budget_approved_F01_2026-12'), false);
eq('2027-01（年跨ぎ）', S._lsOnDemand('budget_approved_F01_2027-01'), false);

console.log('\n== 5) fc_monthly_ も同じ扱い ==');
eq('2026-08 は常駐', S._lsOnDemand('fc_monthly_F04-K_2026-08'), false);
eq('2026-04 は必要時', S._lsOnDemand('fc_monthly_F04-K_2026-04'), true);

console.log('\n== 6) menu_mix_ の月比較（文字列比較のワナを回避） ==');
eq('2026.8（翌月）は常駐', S._lsOnDemand('menu_mix_F01_2026.8'), false);
eq('2026.7（当月）は常駐', S._lsOnDemand('menu_mix_F01_2026.7'), false);
eq('2026.6（前月）は常駐', S._lsOnDemand('menu_mix_F01_2026.6'), false);
eq('2026.5 は必要時', S._lsOnDemand('menu_mix_F01_2026.5'), true);
eq('2026.10 は常駐【文字列比較だと 2026.6 より小さく誤判定する】', S._lsOnDemand('menu_mix_F01_2026.10'), false);
eq('2026.12 は常駐', S._lsOnDemand('menu_mix_F01_2026.12'), false);
eq('2025.11 は必要時', S._lsOnDemand('menu_mix_F01_2025.11'), true);

console.log('\n== 7) 業務必須データの常駐は維持（従来の保護を壊していない） ==');
eq('売上', S._lsOnDemand('daily_actuals_F01_2026-01'), false);
eq('勤怠', S._lsOnDemand('tip_labor_F01_2026-01'), false);
eq('予算', S._lsOnDemand('spl_budgets_v2_F04-K'), false);
eq('現金チップ', S._lsOnDemand('cash_tips_F01_2026-01'), false);

console.log('\n== 8) ログ・履歴の必要時取得も維持 ==');
eq('議事録', S._lsOnDemand('meeting_minutes'), true);
eq('スキル履歴', S._lsOnDemand('spl_skill_history_yamada'), true);
eq('取得済みなら押し上げ可', (function(){ S._LS_FETCHED['meeting_minutes']=1; return S._lsPushBlocked('meeting_minutes'); })(), false);

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
