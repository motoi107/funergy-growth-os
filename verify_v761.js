/* ===== v761 検証 =====
   ① 曜日エディタが「その月の曜日設定」を読み込むか（読み違えると保存でその月の数字が壊れる）
   ② 日次進捗が「その月の日別予算」を使うか（予算設定画面と食い違っていた）
   同じ種類の取り違えが他に残っていないかも機械的に確認する。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v760_backup.html', 'utf8');

function grab(src, n) {
  let i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('not found: ' + n);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

const SHARED = { lunch: [], dinner: [{ guests: 1, spend: 111 }], takeout: [] };  // 共有（7月由来）
const AUGOWN = { lunch: [], dinner: [{ guests: 1, spend: 888 }], takeout: [] };  // 8月固有

function build(src) {
  const code = `
    var dowEditState=null;
    var BUDGET_MONTHLY={};
    var BUD=[{ storeId:'F01', dow:SHARED, days:{'2026-08-01':1}, months:{ '2026-08':{ dow:AUG, days:{'2026-08-01':7777} } } }];
    var STORES=[{id:'F01',name:'ToriTon'}];
    function getBudgets(){ return BUD; }
    function budYmStr(){ return '2026-08'; }
    function budgetYM(){ return {y:2026,m:8}; }
    function canEditBudget(){ return true; }
    function budStatusFor(){ return '下書き'; }
    function alert(){}
    function renderDowModal(){}
    function getDow(b){ return (b&&b.dow)||null; }
    function emptyDow(){ return {lunch:[],dinner:[],takeout:[]}; }
    ${grab(src, 'getBudgetForMonth')}
    ${grab(src, 'openDowEditor')}
    return { open:function(){ openDowEditor('F01','dinner'); return dowEditState; }, bud:BUD };
  `;
  return new Function('SHARED', 'AUG', code)(SHARED, AUGOWN);
}

/* =========================================================
   T1: 曜日エディタが読み込む値
   ========================================================= */
console.log('\n[T1] 曜日エディタ：8月を開いたときに読み込む値');
{
  const o = build(OLD), n = build(NEW);
  const so = o.open(), sn = n.open();

  ok('修正前(v760): 共有の値（7月由来）を読み込んでいた',
    so.dow.dinner[0].spend === 111, String(so.dow.dinner[0].spend));
  ok('修正後(v761): 8月自身の値を読み込む',
    sn.dow.dinner[0].spend === 888, String(sn.dow.dinner[0].spend));
  ok('編集用にコピーしている（元データを直接いじらない）',
    sn.dow !== n.bud[0].months['2026-08'].dow);

  // 月データが無い月は従来どおり共有値
  const n2 = new Function('SHARED', 'AUG', `
    var dowEditState=null;
    var BUDGET_MONTHLY={};
    var BUD=[{ storeId:'F01', dow:SHARED, months:{} }];
    var STORES=[{id:'F01',name:'ToriTon'}];
    function getBudgets(){ return BUD; }
    function budYmStr(){ return '2026-08'; }
    function canEditBudget(){ return true; }
    function budStatusFor(){ return ''; }
    function alert(){}
    function renderDowModal(){}
    function getDow(b){ return (b&&b.dow)||null; }
    function emptyDow(){ return {lunch:[],dinner:[],takeout:[]}; }
    ${grab(NEW, 'getBudgetForMonth')}
    ${grab(NEW, 'openDowEditor')}
    return function(){ openDowEditor('F01','dinner'); return dowEditState; };
  `)(SHARED, AUGOWN);
  ok('月データが無い月は従来どおり共有値を読む', n2().dow.dinner[0].spend === 111);
}

/* =========================================================
   T2: 日次進捗の日別予算
   ========================================================= */
console.log('\n[T2] 日次進捗：日別予算の取得元');
{
  const oldF = grab(OLD, 'renderBudgetDaily');
  const newF = grab(NEW, 'renderBudgetDaily');

  ok('修正前(v760): 生の予算をそのまま使っていた',
    /var b = budgets\.find\(x=>x\.storeId===s\.id\);/.test(oldF));
  ok('修正後(v761): 対象月で解決した予算を使う',
    newF.indexOf('_dlBud(s.id)') >= 0 && newF.indexOf('getBudgetForMonth') >= 0);
  ok('修正後: 生の予算を直接使う箇所は残っていない',
    !/var b = budgets\.find\(x=>x\.storeId===s\.id\);/.test(newF));
  ok('修正後: 店舗ごとに1回だけ解決する（描画のたびに何度も引かない）',
    newF.indexOf('_dlCache') >= 0);
  ok('修正後: 表示中の月から年月を決めている',
    newF.indexOf("(days[0]||{}).date") >= 0);
  ok('修正後: 予算が無い店舗でも落ちない（従来の検索に戻す）',
    newF.indexOf("budgets.find(function(x){ return x.storeId===sid; }) || null") >= 0);
}

/* =========================================================
   T3: 同じ種類の取り違えが残っていないか（機械的な確認）
   ========================================================= */
console.log('\n[T3] 全体の洗い出し');
{
  function funcs(src) {
    const out = []; const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm; let m;
    while ((m = re.exec(src))) {
      const start = m.index; let d = 0, st = false, j = start;
      for (; j < src.length; j++) { const c = src[j]; if (c === '{') { d++; st = true; } else if (c === '}') { d--; if (st && d === 0) { j++; break; } } }
      out.push({ name: m[1], body: src.slice(start, j) });
    }
    return out;
  }
  /* 月別に解決しないと日別調整・月別の曜日設定を取り違える関数 */
  const MONTHLY = /\b(hasDayBudget|dayBudgetFor|getDow|usesDowMode|budgetSegShown)\s*\(\s*b\b/;
  const RAW = /getBudgets\s*\(\s*\)/;
  const RESOLVED = /getBudgetForMonth\s*\(/;

  const risky = funcs(NEW).filter(f => MONTHLY.test(f.body) && RAW.test(f.body) && !RESOLVED.test(f.body))
    .map(f => f.name);
  const riskyOld = funcs(OLD).filter(f => MONTHLY.test(f.body) && RAW.test(f.body) && !RESOLVED.test(f.body))
    .map(f => f.name);

  console.log('       修正前: ' + (riskyOld.join(', ') || 'なし'));
  console.log('       修正後: ' + (risky.join(', ') || 'なし'));

  ok('修正前は要確認の関数があった', riskyOld.length > 0, riskyOld.join(','));
  ok('曜日エディタは解消した', risky.indexOf('openDowEditor') < 0);
  ok('日次進捗は解消した', risky.indexOf('renderBudgetDaily') < 0);

  // 残っているものは、それぞれ理由があって安全なことを個別に確認する
  const builder = grab(NEW, 'renderBudgetBuilder');
  ok('予算エディタは自前で月データを見ている（安全）',
    builder.indexOf("b.months[ymStr]") >= 0 && builder.indexOf("(_mo&&_mo.dow)||getDow(b)") >= 0);
  const submit = grab(NEW, '_doSubmitBudget');
  ok('提出処理は対象月の考え方を読んでいる（安全）',
    submit.indexOf('budRationale(b, _symYm)') >= 0);
}

/* =========================================================
   T4: 全店・全月に効くか（店舗別の分岐が無いこと）
   ========================================================= */
console.log('\n[T4] 店舗・月による分岐が無いこと');
{
  /* 予算の解決部分だけを見る。renderBudgetDaily には F03/F03-G を除外する
     リピート率の仕様があるが、これは予算とは無関係なので対象外。 */
  const parts = {
    'openDowEditor': grab(NEW, 'openDowEditor'),
    'budgetSegShown': grab(NEW, 'budgetSegShown'),
    'renderBudgetDaily(予算の解決部分)': (function () {
      const b = grab(NEW, 'renderBudgetDaily');
      const i = b.indexOf('var _dlBud');
      return b.slice(i, i + 400);
    })()
  };
  Object.keys(parts).forEach(k => {
    const hardStore = /'F0\d|'F04-|Kaimuki|Piikoi|Marujuu|ToriTon/.test(parts[k]);
    ok(k + ' に店舗の直書きが無い（全店に効く）', !hardStore,
      (parts[k].match(/'F0\d[^']*'/g) || []).join(','));
  });
  ok('日次進捗の解決部分は店舗IDを引数で受け取る（全店共通）',
    parts['renderBudgetDaily(予算の解決部分)'].indexOf('function(sid)') >= 0);
  ok('budgetSegShown は対象月を引数で受け取る（全月に効く）',
    grab(NEW, 'budgetSegShown').indexOf('function budgetSegShown(b, ym)') >= 0);
  ok('曜日エディタは表示中の月で解決する',
    grab(NEW, 'openDowEditor').indexOf('budYmStr()') >= 0);
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
