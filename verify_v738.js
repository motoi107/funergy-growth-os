/* v738: 店舗ごとの表示と再取り込みの配線を検証 */
const fs=require('fs'); const vm=require('vm');
const src=fs.readFileSync('/home/claude/index.html','utf8');
function grab(n){const i=src.indexOf('function '+n+'(');if(i<0)throw new Error(n);let d=0,st=false;
 for(let j=i;j<src.length;j++){const c=src[j];if(c==='{'){d++;st=true;}else if(c==='}'){d--;if(st&&d===0)return src.slice(i,j+1);}}throw new Error(n);}
let pass=0,fail=0;
function eq(n,g,w){const ok=JSON.stringify(g)===JSON.stringify(w);
 if(ok){pass++;console.log('  PASS '+n);}else{fail++;console.log('  FAIL '+n+'\n    got : '+JSON.stringify(g)+'\n    want: '+JSON.stringify(w));}}

const code=[grab('guestCountType'),grab('guestCountLabel')].join('\n');
const sandbox={ curLang:'ja', console, JSON, Object, Array, String,
  STORES:[{id:'F01',name:'ToriTon',brand:'ToriTon'},{id:'F02',name:'Tenkichi',brand:'Tenkichi'},
    {id:'F03',name:'Waikiki FSP',brand:'FSP'},{id:'F04-K',name:'Kaimuki',brand:'Totoya'}] };
vm.createContext(sandbox); vm.runInContext(code,sandbox); const S=sandbox;

console.log('== 1) 店舗ごとの呼び方 ==');
eq('ToriTon は「客数」', S.guestCountLabel('F01'), '客数');
eq('Tenkichi は「客数」', S.guestCountLabel('F02'), '客数');
eq('Totoya(Kaimuki) は「丼数」', S.guestCountLabel('F04-K'), '丼数');
eq('Waikiki FSP は「Plate」', S.guestCountLabel('F03'), 'Plate');
eq('WGS も「Plate」', S.guestCountLabel('F03-G'), 'Plate');

console.log('\n== 2) 診断が店舗ごとのラベルを使う ==');
eq('固定文言「客数/丼数」を廃止', src.indexOf('同月の客数/丼数') < 0, true);
eq('guestCountLabel を使っている', /同月の'\+escapeHtml\(\(typeof guestCountLabel==='function'\)\?guestCountLabel\(storeId\)/.test(src), true);
eq('1件あたりの単位も店舗別', /guestCountType\(storeId\)==='bowls'\)\?'丼'/.test(src), true);

console.log('\n== 3) 再取り込みは店舗ごと・表示中の月 ==');
eq('店舗のGUIDを指定して呼ぶ（店舗ごと）', /mode:'cronSync', days:31, restaurantGuid:st\.toastGuid/.test(src), true);
eq('期間を受け取る', /async function resyncItemSales31\(storeId, period\)/.test(src), true);
eq('表示中の月を読み直す', /var _pd = period \|\| \(typeof getPeriod/.test(src), true);
eq('診断ボタンが期間を渡す', src.indexOf("resyncItemSales31(\\''+storeId+'\\',\\''+period+'\\')") >= 0, true);
eq('完了後に診断を開き直す', /openMenuMixDiag\(storeId, period\)/.test(src), true);

console.log('\n== 4) 同期とToast再取得の違いを明記 ==');
eq('クラウド読込である旨の説明がある', src.indexOf('クラウドに入っている分をこの端末へ読み直します') >= 0, true);
eq('Toastから入れ直す旨の説明がある', src.indexOf('Toastから取得してクラウドへ入れ直します') >= 0, true);

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
