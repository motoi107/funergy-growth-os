const fs=require('fs'); const src=fs.readFileSync('index.html','utf8');
/* 関数単位に切り出す */
function funcs(src){
  const out=[]; const re=/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm; let m;
  while((m=re.exec(src))){
    const start=m.index; let d=0,st=false,j=start;
    for(;j<src.length;j++){const c=src[j]; if(c==='{'){d++;st=true;} else if(c==='}'){d--; if(st&&d===0){j++;break;}}}
    out.push({name:m[1], body:src.slice(start,j), line:src.slice(0,start).split('\n').length});
  }
  return out;
}
const MONTHLY=/\b(hasDayBudget|dayBudgetFor|getDow|usesDowMode|budgetSegShown|budRationale)\s*\(/;
const RAW=/getBudgets\s*\(\s*\)/;
const RESOLVED=/getBudgetForMonth\s*\(/;
const risky=[], ok=[];
funcs(src).forEach(f=>{
  if(!MONTHLY.test(f.body)) return;
  if(!RAW.test(f.body)) return;                 // 生データを自分で取っていない関数は対象外
  (RESOLVED.test(f.body)?ok:risky).push(f);
});
console.log('=== 生の予算を取得し、月別に解決していない関数（要確認） ===');
risky.forEach(f=>console.log('  行'+String(f.line).padStart(6)+'  '+f.name));
console.log('\n=== 生も取るが、月別解決もしている関数 ===');
ok.forEach(f=>console.log('  行'+String(f.line).padStart(6)+'  '+f.name));
console.log('\n要確認 '+risky.length+' / 解決済み '+ok.length);
