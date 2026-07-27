/* v746: Q達成サマリーの計算を実ファイルの関数で検証 */
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
  grab('qcDaysLeft'), grab('qcDaysElapsed'), grab('qcCompute')].join('\n');

/* 今日 = 2026-08-16（Q3の45日目）を想定 */
function mk(opt){
  opt=opt||{};
  const sb={ console, JSON, Object, Array, String, Number, Math, Date, parseFloat, parseInt, isFinite,
    bizNow:()=>new Date(2026,7,16),                    /* 2026-08-16 */
    STORES:[{id:'S1',name:'A店'},{id:'S2',name:'B店'}],
    getVisibleStores:()=>[{id:'S1',name:'A店'},{id:'S2',name:'B店'}],
    quarterTargets:(sid,y,q)=>opt.targets[sid],
    quarterActuals:(sid,y,q)=>opt.actuals[sid],
    monthStats:(sid,off)=>((opt.ms&&opt.ms[sid]&&opt.ms[sid][off])||{}) };
  vm.createContext(sb); vm.runInContext(code,sb);
  return sb;
}

console.log('== 1) 当月は経過日数で按分して比較する ==');
{
  const sb=mk({targets:{},actuals:{}});
  eq('7月（過去）は満了扱い 1.0', sb.qcPaceRatio('2026-07'), 1);
  eq('9月（未来）は 0', sb.qcPaceRatio('2026-09'), 0);
  near('8月（16日時点）は 15/31 ≒ 0.484', sb.qcPaceRatio('2026-08'), 15/31, 0.001);
  eq('Q3の経過日数（7/1〜8/15）= 46日', sb.qcDaysElapsed(2026,3), 46);
  eq('Q3の残日数（8/16〜9/30）= 46日', sb.qcDaysLeft(2026,3), 46);
}

console.log('\n== 2) ペース目標と達成率 ==');
{
  /* 目標: 7月100k / 8月100k / 9月100k = 300k。実績 140k */
  const T={ sales:300000, guests:10000, fcRate:31, laborRate:27,
    byMonth:[{ym:'2026-07',sales:100000,guests:3400,registered:true},
             {ym:'2026-08',sales:100000,guests:3300,registered:true},
             {ym:'2026-09',sales:100000,guests:3300,registered:true}] };
  const A={ sales:140000, guests:4600, food:46000, labor:39000 };
  const sb=mk({ targets:{S1:T}, actuals:{S1:A} });
  const R=sb.qcCompute('S1',2026,3);
  near('ペース目標 = 100k + 100k×0.484 = 148.4k', R.paceSales, 100000+100000*15/31, 1);
  near('Q進捗率 = 140k/300k = 46.7%', R.progress*100, 46.67, 0.1);
  near('ペース比 = 140k/148.4k = 94.3%', R.pacePct*100, 94.34, 0.2);
  eq('判定は「要挽回」', R.level, 'behind');
  near('不足 = 160k', R.short, 160000, 1);
  near('1日あたり必要 = 160k/46 ≒ 3,478', R.perDayNeed, 160000/46, 1);
  near('直近の1日平均 = 140k/46 ≒ 3,043', R.perDayNow, 140000/46, 1);
  near('必要倍率 = 1.14倍', R.needRatio, (160000/46)/(140000/46), 0.01);
}

console.log('\n== 3) 判定のしきい値 ==');
{
  const mkR=(actual)=>{
    const T={ sales:300000, guests:10000, fcRate:31, laborRate:27,
      byMonth:[{ym:'2026-07',sales:100000,guests:3400,registered:true},
               {ym:'2026-08',sales:0,guests:0,registered:true},
               {ym:'2026-09',sales:0,guests:0,registered:true}] };
    return mk({targets:{S1:T},actuals:{S1:{sales:actual,guests:3400,food:0,labor:0}}}).qcCompute('S1',2026,3);
  };
  eq('ペース比100%以上は「達成ペース」', mkR(100000).level, 'good');
  eq('96%は「やや遅れ」', mkR(96000).level, 'watch');
  eq('94%は「要挽回」', mkR(94000).level, 'behind');
}

console.log('\n== 4) ギャップの要因分解（客数＋客単価＝売上ギャップ） ==');
{
  const T={ sales:200000, guests:5000, fcRate:31, laborRate:27,
    byMonth:[{ym:'2026-07',sales:100000,guests:2500,registered:true},
             {ym:'2026-08',sales:100000,guests:2500,registered:true},
             {ym:'2026-09',sales:0,guests:0,registered:true}] };
  /* 経過ぶん目標: 100k + 100k×0.484 = 148.4k / 客数 2500+2500×0.484 = 3710 → 単価 $40 */
  const A={ sales:140000, guests:3500, food:0, labor:0 };
  const R=mk({targets:{S1:T},actuals:{S1:A}}).qcCompute('S1',2026,3);
  near('分解の合計＝売上ギャップ', R.gapGuest+R.gapPpa, R.aSales-R.paceSales, 1);
  eq('客数はマイナス要因', R.gapGuest<0, true);
  near('目標客単価 $40', R.tPpa, 40, 0.2);
  near('実績客単価 $40', R.aPpa, 40, 0.2);
}

console.log('\n== 5) 率の差を金額に換算 ==');
{
  const T={ sales:300000, guests:10000, fcRate:31, laborRate:27,
    byMonth:[{ym:'2026-07',sales:100000,guests:3400,registered:true},{ym:'2026-08',sales:0,guests:0,registered:true},{ym:'2026-09',sales:0,guests:0,registered:true}] };
  /* 売上100k・原価34k(34%)・人件費29k(29%) */
  const A={ sales:100000, guests:3400, food:34000, labor:29000 };
  const R=mk({targets:{S1:T},actuals:{S1:A}}).qcCompute('S1',2026,3);
  eq('実績原価率 34%', R.aFc, 34);
  eq('目標原価率 31%', R.tFc, 31);
  near('原価の超過額 = 100k×3% = 3,000', R.fcImpact, 3000, 1);
  near('人件費の超過額 = 100k×2% = 2,000', R.lbImpact, 2000, 1);
  near('Prime合計 = 5,000', R.primeImpact, 5000, 1);
}

console.log('\n== 6) 全店合算と、率の売上加重平均 ==');
{
  const T1={ sales:200000, guests:5000, fcRate:30, laborRate:26, byMonth:[{ym:'2026-07',sales:200000,guests:5000,registered:true},{ym:'2026-08',sales:0,guests:0,registered:true},{ym:'2026-09',sales:0,guests:0,registered:true}] };
  const T2={ sales:100000, guests:2000, fcRate:36, laborRate:30, byMonth:[{ym:'2026-07',sales:100000,guests:2000,registered:true},{ym:'2026-08',sales:0,guests:0,registered:true},{ym:'2026-09',sales:0,guests:0,registered:true}] };
  const R=mk({ targets:{S1:T1,S2:T2},
    actuals:{S1:{sales:180000,guests:4500,food:0,labor:0}, S2:{sales:90000,guests:1800,food:0,labor:0}} }).qcCompute('ALL',2026,3);
  eq('売上目標は合算 300k', R.tSales, 300000);
  eq('実績も合算 270k', R.aSales, 270000);
  near('原価率目標は売上加重（30×200k+36×100k）/300k = 32.0', R.tFc, 32, 0.05);
  near('人件費率目標も加重 = 27.3', R.tLb, 27.3, 0.05);
}

console.log('\n== 7) 予算未登録の月を検出する ==');
{
  const T={ sales:100000, guests:2500, fcRate:31, laborRate:27,
    byMonth:[{ym:'2026-07',sales:100000,guests:2500,registered:true},
             {ym:'2026-08',sales:0,guests:0,registered:false},
             {ym:'2026-09',sales:0,guests:0,registered:false}] };
  const R=mk({targets:{S1:T},actuals:{S1:{sales:90000,guests:2300,food:0,labor:0}}}).qcCompute('S1',2026,3);
  eq('未登録の月を2件検出', R.unreg.length, 2);
  eq('どの月かが分かる', R.unreg.map(u=>u.ym), ['2026-08','2026-09']);
}

console.log('\n== 8) 過去の四半期では残日数0 ==');
{
  const sb=mk({targets:{},actuals:{}});
  eq('2026 Q1 の残日数は0', sb.qcDaysLeft(2026,1), 0);
  eq('2026 Q1 の経過日数は90日', sb.qcDaysElapsed(2026,1), 90);
  eq('2027 Q1 は未来なので経過0', sb.qcDaysElapsed(2027,1), 0);
}

console.log('\n== 9) 画面に組み込まれている ==');
{
  eq('サマリー描画関数がある', /function renderQCommitSummary\(scope, y, q\)/.test(src), true);
  eq('Qコミットビューが呼んでいる', src.indexOf('renderQCommitSummary(_qbStore, y, q)') >= 0, true);
  eq('全店・単店の両方で出る（店舗チップの直後）', /bStoreChips\(_qbStore,'setQbStore'\);[\s\S]{0,300}renderQCommitSummary/.test(src), true);
}

console.log('\n===== RESULT: PASS '+pass+' / FAIL '+fail+' =====');
process.exit(fail?1:0);
