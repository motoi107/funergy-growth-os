/* v742: 1000行上限のページング処理を実ファイルの関数で検証 */
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

/* Supabase が1000行で打ち切る挙動を再現する */
function makeServer(totalRows){
  const all=[]; for(let i=1;i<=totalRows;i++) all.push({id:i, qty:1});
  const urls=[];
  return { urls, fetch:(url)=>{
    urls.push(url);
    const lim=Math.min(Number((url.match(/[?&]limit=(\d+)/)||[])[1]||1000), 1000);  // ★サーバ側上限1000
    const off=Number((url.match(/[?&]offset=(\d+)/)||[])[1]||0);
    return Promise.resolve({ ok:true, json:()=>Promise.resolve(all.slice(off, off+lim)) });
  }};
}

const code=[grab('supaFetchAllRows'), grab('fetchToastItemSales')].join('\n');

(async function(){
console.log('== 1) 1000行を超えても全件読める ==');
{
  const srv=makeServer(2575);   // ToriTon 相当: 103商品 × 25日
  const sb={ SUPABASE_URL:'https://x', SUPABASE_ANON:'anon', fetch:srv.fetch, console, JSON, Array, Number, String, Promise };
  vm.createContext(sb); vm.runInContext(code,sb);
  const rows=await sb.supaFetchAllRows('toast_item_sales?restaurant_guid=eq.G&order=id.asc');
  eq('2,575行すべて取得【修正前は1000行で打ち切り】', rows.length, 2575);
  eq('3回に分けて読む', srv.urls.length, 3);
  eq('offsetをずらしている', srv.urls.map(u=>(u.match(/offset=(\d+)/)||[])[1]), ['0','1000','2000']);
  eq('先頭と末尾が正しい', [rows[0].id, rows[rows.length-1].id], [1, 2575]);
  const ids=new Set(rows.map(r=>r.id));
  eq('重複も欠落もない', ids.size, 2575);
}

console.log('\n== 2) ちょうど1000行のときに無限ループしない ==');
{
  const srv=makeServer(1000);
  const sb={ SUPABASE_URL:'https://x', SUPABASE_ANON:'a', fetch:srv.fetch, console, JSON, Array, Number, String, Promise };
  vm.createContext(sb); vm.runInContext(code,sb);
  const rows=await sb.supaFetchAllRows('t?x=1');
  eq('1,000行を取得', rows.length, 1000);
  eq('空が返るまで2回で止まる', srv.urls.length, 2);
}

console.log('\n== 3) 1000行未満は1回で終わる（従来どおり軽い） ==');
{
  const srv=makeServer(884);   // Kaimuki 相当: 34商品 × 26日
  const sb={ SUPABASE_URL:'https://x', SUPABASE_ANON:'a', fetch:srv.fetch, console, JSON, Array, Number, String, Promise };
  vm.createContext(sb); vm.runInContext(code,sb);
  const rows=await sb.supaFetchAllRows('t?x=1');
  eq('884行を取得', rows.length, 884);
  eq('1回だけで終わる', srv.urls.length, 1);
}

console.log('\n== 4) fetchToastItemSales が月とid順を指定する ==');
{
  const srv=makeServer(1500);
  const sb={ SUPABASE_URL:'https://x', SUPABASE_ANON:'a', fetch:srv.fetch, console, JSON, Array, Number, String, Promise };
  vm.createContext(sb); vm.runInContext(code,sb);
  const rows=await sb.fetchToastItemSales('GUID-1','2026.7');
  eq('全件取得', rows.length, 1500);
  eq('business_month を 2026-07 に変換', srv.urls[0].indexOf('business_month=eq.2026-07') >= 0, true);
  eq('id順を指定（ページ境界のズレ防止）', srv.urls[0].indexOf('order=id.asc') >= 0, true);
  eq('店舗GUIDで絞る', srv.urls[0].indexOf('restaurant_guid=eq.GUID-1') >= 0, true);
}

console.log('\n== 5) 通信エラーでも落ちない ==');
{
  const sb={ SUPABASE_URL:'https://x', SUPABASE_ANON:'a',
    fetch:()=>Promise.resolve({ ok:false, status:500, json:()=>Promise.resolve([]) }),
    console, JSON, Array, Number, String, Promise };
  vm.createContext(sb); vm.runInContext(code,sb);
  const rows=await sb.supaFetchAllRows('t?x=1');
  eq('空配列を返す', rows, []);
}

console.log('\n== 6) 他の読み取りもページングに揃えた ==');
{
  eq('メニュー商品もページング', src.indexOf("supaFetchAllRows('toast_menu_items?restaurant_guid=eq.'") >= 0, true);
  eq('出数の診断もページング', src.indexOf("rows = await supaFetchAllRows('toast_item_sales?restaurant_guid=eq.'") >= 0, true);
  eq('打ち切られる limit=10000 は残っていない', /limit=10000';/.test(src), false);
}

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
})();
