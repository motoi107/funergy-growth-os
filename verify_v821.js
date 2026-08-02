/* verify_v821.js — 「現在値／目標値」の見出しをルールに合わせる
   仕入単価の上昇で「現在値 24.8%」と出ていた。24.8% は単価ではなく上昇率。
   月末売上未達も「現在値 $4,189.90 / 目標値 $105,420.00」で、
   ここまでの売上と月間予算という別のものを並べていた。 */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v821_backup.html')
  ? fs.readFileSync('index_v821_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v820_backup.html', 'utf8');
let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}
function grabIf(t, n) { try { return grab(t, n); } catch (e) { return ''; } }
function decl(text, name, o, c) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\' + o));
  if (a < 0) throw new Error('not found: ' + name);
  let i = text.indexOf(o, a), d = 0, e = -1;
  for (let j = i; j < text.length; j++) { if (text[j] === o) d++; else if (text[j] === c) { d--; if (d === 0) { e = j; break; } } }
  return 'var ' + name + ' = ' + text.slice(i, e + 1) + ';';
}
const arrDecl = (t, n) => decl(t, n, '[', ']');
const objDecl = (t, n) => decl(t, n, '{', '}');
function unchangedIn(ver, fn) {
  const f = 'index_v' + ver + '_backup.html';
  if (!fs.existsSync(f)) return true;
  return grabIf(fs.readFileSync(f, 'utf8'), fn) === grabIf(prev, fn);
}
function ruleAdditions(text) {
  const out = [];
  text.replace(/MC_RULE_DEFAULTS\.(\w+)\s*=\s*\{[\s\S]*?\};/g, function (m) { out.push(m); return m; });
  return out.join('\n');
}

function env() {
  return new Function(`
    var curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false, curPage='mgmt_ctrl';
    var STORES=[{id:'F05',name:'Marujuu',active:true,am:'Yuki'}];
    var EMPS=[{name:'Moto',role:'gm',title:'General Manager',store:'F05',status:'在籍'}];
    var ROLE_CONFIG={gm:{name:'Moto'},am:{},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{},chef:{}};
    var AM_STORES=[];
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES; }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F05'; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+(Number(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    function mcElapsed(){ return '1分'; }
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'MC_RULE_UNIT')} ${objDecl(src,'MC_VAL_LABELS')}
    ${ruleAdditions(src)}
    ${grab(src,'myAmStores')}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcUnitOf')} ${grab(src,'mcFmtVal')} ${grab(src,'mcValLabels')} ${grab(src,'mcVals')}
    ${grab(src,'mcAlertCard')}
    return { vals: mcVals, card: mcAlertCard, labels: mcValLabels };
  `)();
}
const A = (code, o) => Object.assign({
  id: 'x', rule_code: code, store_id: 'F05', category: 'cost', severity: 'warning', status: 'open', title: 't',
}, o || {});

console.log('\n=== v821: 値の見出しをルールに合わせる ===\n');
const E = env();

console.log('[1] 仕入単価の上昇（画面で「現在値 24.8%」だったところ）');
{
  const a = A('price_up', { current_value: 24.8, target_value: 10 });
  const v = E.vals(a);
  ok(v.curL === '上昇率（最大）', '「現在値」ではなく「上昇率（最大）」', v.curL);
  ok(v.tgtL === '注意の基準', '目標値ではなく「注意の基準」', v.tgtL);
  ok(v.cur === '24.8%' && v.tgt === '10%', '値は%のまま');
  const h = E.card(a);
  ok(h.indexOf('現在値') < 0, 'カードに「現在値」が出ない');
  ok(h.indexOf('上昇率（最大）') >= 0, '正しい見出しが出る');
  ok(h.indexOf('月末予測') < 0, '関係のない「月末予測」行が出ない');
}

console.log('\n[2] 月末売上未達（別のものを並べていたところ）');
{
  const a = A('budget_forecast_miss', { category: 'budget', current_value: 4189.90, target_value: 105420, forecast_value: 91399.14, estimated_impact: 14020.86 });
  const v = E.vals(a);
  ok(v.curL === 'ここまでの売上', 'ここまでの売上', v.curL);
  ok(v.tgtL === '月間予算', '月間予算', v.tgtL);
  ok(v.fcL === '月末予測', '月末予測はそのまま');
  const h = E.card(a);
  ok(h.indexOf('ここまでの売上') >= 0 && h.indexOf('月間予算') >= 0, '見出しが出る');
  ok(h.indexOf('$14,020.86') >= 0, '影響額はそのまま');
}

console.log('\n[3] 率・件数・人数');
{
  ok(E.labels('labor_rate_over').cur === '人件費率', '人件費率');
  ok(E.labels('labor_rate_over').fc === '', '同じ値の「月末予測」を出さない');
  const h1 = E.card(A('labor_rate_over', { category: 'labor', current_value: 34, target_value: 28, forecast_value: 34 }));
  ok(h1.indexOf('人件費率') >= 0 && h1.indexOf('34%') >= 0, '人件費率 34%');
  ok((h1.match(/34%/g) || []).length === 1, '同じ値を2度出さない', (h1.match(/34%/g) || []).length);

  ok(E.labels('cost_rate_over').cur === '原価率', '原価率');
  ok(E.labels('new_ingredient').cur === '件数' && E.labels('new_ingredient').tgt === '', '新規材料は件数だけ');
  const h2 = E.card(A('new_ingredient', { current_value: 93 }));
  ok(h2.indexOf('件数') >= 0 && h2.indexOf('93 件') >= 0, '件数 93 件');
  ok(h2.indexOf('目標値') < 0, '意味のない「目標値」を出さない');

  ok(E.labels('ec_labor').cur === '件数', 'エラーセンター由来も件数');
  const h3 = E.card(A('ec_labor', { category: 'labor', current_value: 9 }));
  ok(h3.indexOf('件数') >= 0 && h3.indexOf('9 件') >= 0, '件数 9 件');

  ok(E.labels('skill_stale').cur === '対象人数', 'スキル評価は対象人数');
  ok(E.labels('guests_short').cur === '客数' && E.labels('guests_short').tgt === '進捗ぶんの予算', '客数は進捗ぶんの予算と比べる');
  ok(E.labels('spend_short').cur === '客単価' && E.labels('spend_short').tgt === '予算', '客単価');
  ok(E.labels('purchase_spike').cur === '今月の仕入' && E.labels('purchase_spike').tgt === 'いつもなら', '仕入過多');
}

console.log('\n[4] 知らないルールは今までどおり');
{
  const l = E.labels('なにか新しいルール');
  ok(l.cur === '現在値' && l.tgt === '目標値' && l.fc === '月末予測', '既定の見出しに戻る', l);
  /* selftest は単位を持たない設定なので、単位も見出しも既定のルールで確かめる */
  const h = E.card(A('mirai_no_rule', { current_value: 100 }));
  ok(h.indexOf('現在値') >= 0 && h.indexOf('$100.00') >= 0, '見出しも値も既定のまま出る');
  ok(E.vals(A('selftest', { current_value: 100 })).cur === '',
    '単位を持たないルール（selftest）は値を出さない設計のまま');
}

console.log('\n[5] 見出しが空なら行ごと出さない');
{
  const v = E.vals(A('new_ingredient', { current_value: 93, target_value: 1, forecast_value: 5 }));
  ok(v.tgt === '' && v.fc === '', '値があっても見出しが空なら出さない', v);
  const h = E.card(A('new_ingredient', { current_value: 93, target_value: 1, forecast_value: 5 }));
  ok(h.indexOf('目標値') < 0 && h.indexOf('月末予測') < 0, 'カードにも出ない');
}

console.log('\n[6] 3つの画面すべてで使う');
{
  ['mcAlertCard', 'mcDetailHtml', 'renderMcRequests'].forEach(function (fn) {
    const b = grab(src, fn);
    ok(/curL/.test(b), fn + ' が見出しを使っている');
  });
  ok(!/row\('現在値'/.test(src) || /_v\.curL \|\| '現在値'/.test(src), '固定の「現在値」が残っていない');
}

console.log('\n[7] ビルドの性質と既存への影響');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
  } else ok(true, 'SW_BUILD は現行版の検証で見る');

  ['mcRole', 'mcScopeStores', 'mcUnitOf', 'mcFmtVal', 'mcThr', 'mcEnoughDays',
    'mcDetectBudget', 'mcDetectLabor', 'mcDetectCost', 'mcDetectGuests', 'mcDetectPurchase',
    'mcUpsertAlert', 'mcNotifyAlert', 'mcRunDetection', 'mcSummary', 'mcVisibleAlerts',
    'foodCostOf', 'cumulativeToToday', 'groupsForRole'].forEach(function (fn) {
      ok(grabIf(prev, fn) !== '' && unchangedIn('821', fn), fn + ' を変えていない');
    });
  ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
  ok(prev.indexOf('function mcValLabels(') < 0, 'v820 には無かった');
  ok(src.indexOf(String.fromCharCode(0x8f96)) < 0, '簡体字の誤字が入っていない');
  /* 表示だけの変更で、保存されている値には触れていない */
  const dets = ['mcDetectBudget', 'mcDetectPurchase', 'mcDetectGuests'];
  ok(dets.every(fn => grabIf(src, fn) === grabIf(prev, fn)), '検知側の値は1つも変えていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
