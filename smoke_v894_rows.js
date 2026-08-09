const fs=require('fs');
const utf=fs.readFileSync('index.html','utf8');
const blk=utf.match(/        \/\* v894: 管轄外の店は数字だけ[\s\S]*?      \}\);/)[0]
  .replace(/^      \}\);$/m,'');           // forEach の閉じを外す
// 行の中で使う変数（color/sFc/sL）は本体の直前行で定義されている。同じものを補う。
const pre = 'var color=statusColor(s.status);'
  + 'var sFc=s.fc>0?statusColor(statusFromCeil(s.fc,31,34)):"var(--muted)";'
  + 'var sL=s.labor>0?statusColor(statusFromCeil(s.labor,29,32)):"var(--muted)";';
const body = 'var html="";stores.forEach(function(s){\n' + pre + '\n' + blk + '\n});return html;';
const mk=new Function('stores','dashCanEnter','statusColor','statusTag','statusFromCeil','fmtK','t','ppaTripleLine', body);
const mine=['F04-K'];
const stores=[{id:'F01',name:'ToriTon',color:'#111',status:'danger',sp:82,a:1000,b:1200,fc:35,labor:33},
              {id:'F04-K',name:'Totoya Kaimuki',color:'#222',status:'good',sp:104,a:900,b:870,fc:30,labor:28}];
const html=mk(stores, id=>mine.includes(id), ()=>'#000', ()=>'tag-green', ()=>'good', n=>'$'+n, x=>x, ()=>'');
const rows=html.split('class="store-row"').slice(1);
let bad=0;
function chk(ok,l){ if(!ok) bad++; console.log((ok?'  PASS  ':'  FAIL  ')+l); }
const out=[['F01（管轄外）',rows[0],false],['F04-K（管轄）',rows[1],true]];
out.forEach(([lab,r,can])=>{
  chk(/onclick="switchStore\('.*?'\);go\('budget'\)"/.test(r)===can, lab+' 予実への遷移: '+(can?'あり':'なし')+'が正解');
  chk(/openStoreCmd/.test(r)===can, lab+' 店舗コマンドのボタン: '+(can?'あり':'なし')+'が正解');
  chk(/管轄外/.test(r)===!can, lab+' 「管轄外」の表示: '+(!can?'あり':'なし')+'が正解');
  chk(/売上/.test(r)&&/FC/.test(r)&&/Labor/.test(r), lab+' 売上/FC/Labor の数字は出る');
});
console.log('\n'+(bad?('FAIL '+bad):'すべて PASS'));
process.exit(bad?1:0);
