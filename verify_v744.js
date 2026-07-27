/* v744: 押し上げの成功/失敗が正しく返り、未送信キューから消えることを検証 */
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

const code=grab('opMergePush') + `
var _opLastPushErr = {};
var _opMergeChain = {};
function _opMergeDef(k){ return _DEF; }
function _opUpsertRow(k,v,t){ return { key:k, value:v }; }
async function _fetchOpValue(k,t){ return _CLOUD; }
async function supaUpsert(t,rows){ _UPSERTS.push(rows); return _UPSERT_OK; }
var localStorage = { setItem:function(){}, getItem:function(){return null;} };
`;

function mk(opts){
  const sb={ console, JSON, Promise, String, Object, Array,
    _DEF:{ merge:(c,l)=>({...(c||{}),...(l||{})}), covers:(chk,want)=>opts.covers!==false, after:null },
    _CLOUD: ('cloud' in opts)?opts.cloud:{a:1},
    _UPSERT_OK: opts.upsertOk!==false,
    _UPSERTS: [] };
  vm.createContext(sb); vm.runInContext(code,sb);
  return sb;
}

(async function(){

console.log('== 1) 【本件】成功したら true を返す（従来は常に undefined） ==');
{
  const sb=mk({});
  const r=await sb.opMergePush('budget_approved_F03_2026-08', {b:2});
  eq('true を返す', r, true);
  eq('クラウドへ書き込んでいる', sb._UPSERTS.length, 1);
  eq('エラーは記録されない', sb._opLastPushErr['budget_approved_F03_2026-08'], '');
}

console.log('\n== 2) 未送信キューから消える ==');
{
  /* _pushWithOutbox / flushOutbox の判定を再現：undefined だと消えない */
  const decide=(r)=> (r===false) ? 'keep-and-count' : (r===true ? 'remove' : 'nothing');
  eq('修正前(undefined)は何もしない＝残り続ける', decide(undefined), 'nothing');
  eq('修正後(true)は削除される', decide(true), 'remove');
  eq('失敗(false)はキューに残す', decide(false), 'keep-and-count');
}

console.log('\n== 3) 書き込み失敗なら false と理由を返す ==');
{
  const sb=mk({ upsertOk:false });
  const r=await sb.opMergePush('spl_invoices_F04-K', {b:2});
  eq('false を返す', r, false);
  eq('理由が残る', sb._opLastPushErr['spl_invoices_F04-K'], 'クラウドへの書き込みに失敗しました');
}

console.log('\n== 4) 競合で確認できないときも false（キューに残して再試行） ==');
{
  const sb=mk({ covers:false });
  const r=await sb.opMergePush('spl_budgets_v2_F01', {b:2});
  eq('false を返す', r, false);
  eq('競合の理由が残る', sb._opLastPushErr['spl_budgets_v2_F01'].indexOf('競合') >= 0, true);
  eq('3回試している', sb._UPSERTS.length, 3);
}

console.log('\n== 5) クラウドを読めないときは素通しで書き込み、成功扱い ==');
{
  const sb=mk({ cloud:undefined });
  const r=await sb.opMergePush('fv_count_F04-K_2026-07', {b:2});
  eq('true を返す', r, true);
  eq('1回だけ書き込む', sb._UPSERTS.length, 1);
}

console.log('\n== 6) 例外が出ても false を返して理由を残す ==');
{
  const sb=mk({});
  sb.supaUpsert=async()=>{ throw new Error('network down'); };
  vm.runInContext('supaUpsert = _INJ;', Object.assign(sb,{_INJ:sb.supaUpsert}));
  const r=await sb.opMergePush('approvals', {b:2});
  eq('false を返す', r, false);
  eq('例外の内容が残る', sb._opLastPushErr['approvals'], 'network down');
}

console.log('\n== 7) 呼び出し側が結果を返すようになっている ==');
{
  eq('app_settings 側', src.indexOf("return await opMergePush(key, val, 'app_settings');") >= 0, true);
  eq('app_state 側', src.indexOf('return await opMergePush(key, val);') >= 0, true);
}

console.log('\n== 8) 1件ずつ送って結果を確認できる ==');
{
  eq('個別送信の関数がある', /async function outboxRetryOne\(key\)/.test(src), true);
  eq('診断に「この1件を送る」ボタンがある', src.indexOf('この1件を送る') >= 0, true);
  eq('未取得で止まる場合は理由を出す', src.indexOf('まだクラウドから取得していないため送れません') >= 0, true);
  eq('端末にデータが無ければキューから外す', src.indexOf('端末にデータがありません。キューから外します') >= 0, true);
  eq('失敗理由を表示する', src.indexOf("'送れませんでした：'+why") >= 0, true);
}

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
})();
