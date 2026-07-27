/* v747: サマリーの集約と月別統合を検証 */
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
function near(n,g,w,tol){const ok=Math.abs(g-w)<=(tol||0.5);
 if(ok){pass++;console.log('  PASS '+n);}else{fail++;console.log('  FAIL '+n+'\n    got : '+g+'\n    want: ~'+w);}}

const code=[grab('_quarterMonths'), grab('_ymToOffset'), grab('qcPaceRatio'),
  grab('qcDaysLeft'), grab('qcDaysElapsed'), grab('qcCompute'),
  grab('_qcPct'), grab('_qcSign'), grab('renderQCommitSummary')].join('\n') + `
function fmtK(v){ return '$'+(parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function t(ja,en){ return ja; }
function escapeHtml(s){ return String(s==null?'':s); }
`;

function mk(opt){
  const sb={ console, JSON, Object, Array, String, Number, Math, Date, parseFloat, parseInt, isFinite,
    bizNow:()=>new Date(2026,7,16),
    STORES:[{id:'S1',name:'A店'}],
    getVisibleStores:()=>[{id:'S1',name:'A店'}],
    quarterTargets:()=>opt.T,
    quarterActuals:()=>opt.A,
    monthStats:(sid,off)=>((opt.ms&&opt.ms[off])||{}) };
  vm.createContext(sb); vm.runInContext(code,sb);
  return sb;
}

const T={ sales:300000, guests:7500, fcRate:31, laborRate:27, repeat:40,
  byMonth:[{ym:'2026-07',sales:100000,guests:2500,registered:true},
           {ym:'2026-08',sales:100000,guests:2500,registered:true},
           {ym:'2026-09',sales:100000,guests:2500,registered:true}] };
const A={ sales:140000, guests:3400, food:47600, labor:40600, ftB:600, rpB:1400 };

console.log('== 1) サマリーは1枚のカードにまとまっている ==');
{
  const sb=mk({T,A});
  const html=sb.renderQCommitSummary('S1',2026,3);
  eq('カードは1枚だけ', (html.match(/class="card"/g)||[]).length, 1);
  eq('廃止したカードが出ない（必要なペース）', html.indexOf('目標達成に必要なペース') < 0, true);
  eq('廃止したカードが出ない（何が足りないか）', html.indexOf('何が足りないか') < 0, true);
  eq('廃止したカードが出ない（利益への影響）', html.indexOf('利益への影響') < 0, true);
  eq('廃止したカードが出ない（月別）', html.indexOf('>月別<') < 0, true);
}

console.log('\n== 2) 不足の内訳（客数／客単価）がサマリー内にある ==');
{
  const sb=mk({T,A});
  const html=sb.renderQCommitSummary('S1',2026,3);
  eq('「不足の内訳」がある', html.indexOf('不足の内訳') >= 0, true);
  eq('客数が出る', html.indexOf('客数') >= 0, true);
  eq('客単価が出る', html.indexOf('客単価') >= 0, true);
  eq('主因が出る', html.indexOf('主因') >= 0, true);
  const R=sb.qcCompute('S1',2026,3);
  near('分解の合計＝売上ギャップ', R.gapGuest+R.gapPpa, R.aSales-R.paceSales, 1);
}

console.log('\n== 3) サマリーに入れた項目 ==');
{
  const sb=mk({T,A});
  const html=sb.renderQCommitSummary('S1',2026,3);
  eq('着地見込み', html.indexOf('着地見込み') >= 0, true);
  eq('1日あたり必要額', html.indexOf('達成には') >= 0, true);
  eq('原価/人件費', html.indexOf('原価/人件費') >= 0, true);
  eq('Prime の金額インパクト', html.indexOf('Prime') >= 0, true);
  eq('リピート率', html.indexOf('リピート率') >= 0, true);
  eq('ペース比', html.indexOf('ペース比') >= 0, true);
}

console.log('\n== 4) リピート率の計算 ==');
{
  const sb=mk({T,A});
  const R=sb.qcCompute('S1',2026,3);
  near('実績リピート率 = 1400/(600+1400) = 70%', R.aRep, 70, 0.1);
  near('目標リピート率 = 40%', R.tRep, 40, 0.1);
}

console.log('\n== 5) 原価・人件費の金額インパクト ==');
{
  const sb=mk({T,A});
  const R=sb.qcCompute('S1',2026,3);
  near('実績原価率 = 47600/140000 = 34%', R.aFc, 34, 0.1);
  near('実績人件費率 = 40600/140000 = 29%', R.aLb, 29, 0.1);
  near('原価の超過 = 140000×3% = 4,200', R.fcImpact, 4200, 1);
  near('人件費の超過 = 140000×2% = 2,800', R.lbImpact, 2800, 1);
  near('Prime = 7,000', R.primeImpact, 7000, 1);
}

console.log('\n== 6) 予算未登録の警告はサマリー内に残す ==');
{
  const T2=JSON.parse(JSON.stringify(T)); T2.byMonth[2].registered=false;
  const sb=mk({T:T2,A});
  const html=sb.renderQCommitSummary('S1',2026,3);
  eq('未登録の警告が出る', html.indexOf('予算未登録の月があります') >= 0, true);
}

console.log('\n== 7) 既存の「合計進捗」カードは削除された ==');
{
  eq('合計進捗の描画コードが無い', /card-title[^>]*>[\s\S]{0,120}合計進捗/.test(src), false);
  eq('削除した旨のコメントがある', src.indexOf('「合計進捗」カードは上部のQ達成サマリーと重複するため削除') >= 0, true);
}

console.log('\n== 8) 月別は進捗と考え方が同じカードに入る ==');
{
  eq('見出しが「月別 進捗と考え方」', src.indexOf("t('月別 進捗と考え方','Monthly progress & rationale')") >= 0, true);
  eq('別カードだった「月ごとの考え方」は無い', /card-title[^>]*>[\s\S]{0,120}月ごとの考え方/.test(src), false);
  /* 同じループ内で進捗行と考え方を出している */
  const i=src.indexOf('月別 進捗と考え方');
  const seg=src.slice(i, i+4200);
  eq('同じカード内に売上の進捗行がある', seg.indexOf("_qbProgLine(t('売上','Sales')") >= 0, true);
  eq('同じカード内に「根拠」がある', seg.indexOf("t('根拠','Basis')") >= 0, true);
  eq('同じカード内に「重点」がある', seg.indexOf("t('重点','Focus')") >= 0, true);
  eq('この月の狙い（L/D/TO構成）も同じカード', seg.indexOf('この月の狙い') >= 0, true);
  eq('考え方の記入者と日時も出る', seg.indexOf('escapeHtml(r.by)') >= 0, true);
  eq('未入力なら明示する', seg.indexOf('考え方が未入力です') >= 0, true);
  eq('月の達成率が見出しに出る', seg.indexOf('_pct==null?') >= 0, true);
}

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
