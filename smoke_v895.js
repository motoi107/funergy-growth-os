/* smoke_v895.js — saveInventory() を実際に走らせ、確定が最後まで通るか見る。
   「confirm が出るか」ではなく「hist に保存され、原価率に反映され、通知が出るか」。
   途中で落ちると全部が起きないので、そこを一つずつ確認する。 */
const fs=require('fs');
const utf=fs.readFileSync('index.html','utf8');
const body=utf.match(/function saveInventory\(storeId\)\{[\s\S]*?\n\}/)[0];
let bad=0; const mark=(ok,l)=>{ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l); };

function run(src, opts){
  const st={hist:null, fc:null, toast:null, confirmed:null, alerted:null, rendered:null, err:null};
  const sb={
    invYm:()=> '2026-07',
    invComputeTotals:()=>({grand:12345, perClass:{}, perVendor:{}}),
    getInvCounts:()=>({A:3}),
    getIngredients:()=>[{code:'A',name:'米',cls:'食材',vendor:'JFC',unit:'kg',cat:'穀'}],
    getStoreIngredients:()=>['A'],
    invUnitValue:()=>10, invPriceOf:()=>null, catClass:()=>'食材',
    invConfirmMonthText:(y)=>{ st.confirmed=y; return '2026年7月（先月）'; },
    confirm:(m)=>{ st.confirmMsg=m; return true; },
    alert:(m)=>{ st.alerted=m; },
    nowJP:()=>'2026-08-09', fmtJP:()=>'2026-08-09', parseJaDate:()=>null,
    ROLE_CONFIG:{gm:{name:'Moto'}}, curRole:'gm',
    ls:(k,d)=> (opts.existing && k==='inv_hist_F01') ? [{ym:'2026-07',grand:9999,date:'2026-07-31',by:'Moto'}] : d,
    setInvHist:(sid,h)=>{ st.hist=h; },
    getFcMonthly:()=>({beginInv:5000, history:[]}),
    setFcMonthly:(sid,ym,o)=>{ st.fc={ym,o}; },
    invFmtMoney:n=>'$'+n,
    showToast:(m)=>{ st.toast=m; },
    renderPage:(p)=>{ st.rendered=p; },
    window:{}, console,
    Math, Date, String, Number, parseFloat, parseInt, isNaN, Object, Array, JSON,
  };
  sb.window=sb;
  try{ new Function('sb', 'with(sb){ '+src+' saveInventory("F01"); }')(sb); }
  catch(e){ st.err=e.message; }
  return st;
}

console.log('=== v895（修正後） ===');
let r=run(body,{});
mark(!r.err, '例外なく最後まで走る'+(r.err?(' → '+r.err):''));
mark(r.confirmed==='2026-07', '確定の確認ダイアログに正しい年月が渡る（'+r.confirmed+'）');
mark(!!r.hist && r.hist.length===1 && r.hist[0].ym==='2026-07', '★ 棚卸履歴に7月分が保存される');
mark(r.hist && r.hist[0].grand===12345, '★ 総額が保存される（'+(r.hist&&r.hist[0].grand)+'）');
mark(!!r.fc && r.fc.ym==='2026-07' && r.fc.o.endInv===12345, '★ 原価率の期末棚卸に反映される');
mark(!!r.fc && r.fc.o.beginInv===5000, '期首棚卸は既存値を引き継ぐ');
mark(/7月分の棚卸を確定しました/.test(r.toast||''), '完了の通知が出る（'+r.toast+'）');
mark(r.rendered==='inventory', '画面が再描画される');

console.log('\n=== 修正・再確定（同月に既存の確定がある場合） ===');
r=run(body,{existing:true});
mark(!r.err, '例外なく最後まで走る'+(r.err?(' → '+r.err):''));
mark(r.hist && r.hist.length===1, '同じ月は置き換えられる（重複しない）');
mark(r.hist && r.hist[0].edits && r.hist[0].edits.length===1, '修正履歴が残る');
mark(r.hist && r.hist[0].edits[0].prevGrand===9999, '修正前の総額を控えている');
mark(/修正・再確定しました/.test(r.toast||''), '再確定の通知になる');

console.log('\n=== v894（修正前）で同じことをすると ===');
const before=fs.readFileSync('index_v894.bak.html','utf8').match(/function saveInventory\(storeId\)\{[\s\S]*?\n\}/)[0];
r=run(before,{});
mark(!!r.err && /_ym/.test(r.err), '★ ReferenceError で落ちる（'+r.err+'）');
mark(r.hist===null, '★ 履歴に保存されない＝確定できていない');
mark(r.fc===null, '★ 原価率にも反映されない');
mark(r.toast===null && r.alerted===null, '★ エラーも成功も出ない＝画面は無反応');

console.log('\n'+(bad?('FAIL '+bad+' 件'):'すべて PASS'));
process.exit(bad?1:0);
