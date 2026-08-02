/* verify_v820.js — 月初のノイズと過剰な緊急を止める
   実運用の画面（8/2）で見えた3つ。
   ① 1日分の実績から月末を予測して緊急にしていた
   ② 仕入単価1品目の上昇が緊急だった
   ③ 新店の食材マスター未整備（93件）が緊急だった */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v820_backup.html')
  ? fs.readFileSync('index_v820_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v819_backup.html', 'utf8');
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
    var STORES=[{id:'F05',name:'Marujuu',active:true,am:'Yuki'},{id:'F03-G',name:'Waikiki Garlic Shack',active:true,am:'Yuki'}];
    var EMPS=[{name:'Moto',role:'gm',title:'General Manager',store:'F05',status:'在籍'}];
    var ROLE_CONFIG={gm:{name:'Moto'},am:{},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{},chef:{}};
    var AM_STORES=[];
    var DATA={cum:{},kpi:{},fc:{},guests:{},stats:{},v2:[],changes:[],inv:{},buy:{},ym:'2026-08'};
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES; }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F05'; }
    function curYm(){ return DATA.ym; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+(Number(v)||0); }
    function parseJaDate(s){ var d=new Date(s); return isNaN(d)?null:d; }
    function cumulativeToToday(sid){ return DATA.cum[sid]; }
    function getStoreKpiTargets(sid){ return DATA.kpi[sid]||{}; }
    function foodCostOf(sid){ return DATA.fc[sid]||{hasEnd:false}; }
    function budgetGuestsMonthly(sid,seg){ return ((DATA.guests[sid]||{})[seg])||null; }
    function monthStats(sid){ return DATA.stats[sid]||null; }
    function getIngV2(){ return DATA.v2; }
    function priceChangesRecent(){ return DATA.changes; }
    function monthInvoiceCostYm(sid,ym){ return (DATA.inv[sid]||{})[ym]||0; }
    function monthPurchaseCostYm(sid,ym){ return (DATA.buy[sid]||{})[ym]||0; }
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'MC_RULE_UNIT')} ${objDecl(src,'mcThresholds')}
    ${ruleAdditions(src)}
    var MC_SKILL_MIN_HOURS=${(src.match(/MC_SKILL_MIN_HOURS\s*=\s*(\d+)/)||[,'20'])[1]};
    var MC_PRICE_DAYS=${(src.match(/MC_PRICE_DAYS\s*=\s*(\d+)/)||[,'45'])[1]};
    var MC_NEWING_DAYS=${(src.match(/MC_NEWING_DAYS\s*=\s*(\d+)/)||[,'30'])[1]};
    ${grab(src,'myAmStores')}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcThr')} ${grab(src,'mcSevBy')} ${grab(src,'mcYm')} ${grab(src,'mcRound')}
    ${grab(src,'mcYmAdd')} ${grab(src,'mcYmOffset')} ${grab(src,'mcEnoughDays')}
    ${grab(src,'mcDetectBudget')} ${grab(src,'mcDetectLabor')} ${grab(src,'mcDetectCost')}
    ${grab(src,'mcDetectGuests')} ${grab(src,'mcDetectPurchase')}
    ${grab(src,'mcUnitOf')} ${grab(src,'mcFmtVal')} ${grab(src,'mcBreakdownHtml')}
    return {
      data: DATA, rules: MC_RULE_DEFAULTS,
      thr:function(r){ mcThresholds.rows=r||[]; mcThresholds.loaded=true; return this; },
      budget:function(s){ return mcDetectBudget(s, DATA.ym); },
      labor:function(s){ return mcDetectLabor(s, DATA.ym); },
      cost:function(s){ return mcDetectCost(s, DATA.ym); },
      guests:function(s){ return mcDetectGuests(s, DATA.ym); },
      buy:function(s){ return mcDetectPurchase(s, DATA.ym); },
      enough: mcEnoughDays,
      seed:function(l){ mcState.alerts=l||[]; return this; },
      breakdown: mcBreakdownHtml
    };
  `)();
}
const find = (l, c) => l.filter(x => x.rule_code === c)[0];
const recent = () => new Date(Date.now() - 3 * 86400000).toISOString();

console.log('\n=== v820: 月初のノイズと過剰な緊急を止める ===\n');

console.log('[1] 8/2 の実データ（Marujuu）を再現する');
{
  const E = env().thr([]);
  /* 実績1日ぶん $4,189.90 で、月末予測 $91,399 が出て緊急になっていた */
  E.data.cum['F05'] = {
    budMonth: 105420, budToToday: 4832, actToToday: 4189.90, actMonth: 4189.90,
    daysPassed: 1, daysWithActual: 1, paceRate: 86.7, laborRate: 40, laborToToday: 1675,
  };
  E.data.kpi['F05'] = { laborPct: 28, foodCost: 30 };
  E.data.fc['F05'] = { hasEnd: false, rate: 0, provisionalRate: 45, sales: 4189.90, purch: 1885 };
  E.data.guests['F05'] = { lunch: 800, dinner: 800 };
  E.data.stats['F05'] = { guests: 45, avgSpend: 34.02, daysWithData: 1, sales: 4189.90 };

  const b = E.budget('F05'), g = E.guests('F05'), c = E.cost('F05'), l = E.labor('F05');
  ok(!find(b, 'budget_forecast_miss'), '1日分の実績から月末を予測しない');
  ok(!find(b, 'budget_pace_behind'), '進捗の遅れも出さない');
  ok(!find(g, 'guests_short'), '客数の予実も出さない');
  ok(!find(g, 'spend_short'), '客単価の予実も出さない');
  ok(l.length === 0, '人件費率も出さない（月初は必ずブレる）');
  ok(!find(c, 'cost_rate_over'), '暫定の原価率も出さない');
  ok(!!find(b, 'sales_not_synced') === false, 'データが1日でも入っていれば未同期にはしない');

  /* 3日たてば出る */
  E.data.cum['F05'].daysWithActual = 3;
  E.data.cum['F05'].daysPassed = 3;
  E.data.stats['F05'].daysWithData = 3;
  ok(!!find(E.budget('F05'), 'budget_forecast_miss'), '3日たてば月末予測を出す');
  ok(!!find(E.guests('F05'), 'guests_short'), '客数の予実も出す');
  ok(E.labor('F05').length === 1, '人件費率も出す');
}

console.log('\n[2] 棚卸で確定した原価率は日数に関係なく出す');
{
  const E = env().thr([]);
  E.data.cum['F05'] = { budMonth: 105420, budToToday: 4832, actToToday: 4189.90, actMonth: 4189.90, daysPassed: 1, daysWithActual: 1, paceRate: 86.7 };
  E.data.kpi['F05'] = { foodCost: 30 };
  E.data.fc['F05'] = { hasEnd: true, rate: 45, provisionalRate: 0, sales: 4189.90, purch: 1885 };
  ok(!!find(E.cost('F05'), 'cost_rate_over'), '確定値なら月初でも出す（推測ではないため）');
  E.data.fc['F05'] = { hasEnd: false, rate: 0, provisionalRate: 45, sales: 4189.90, purch: 1885 };
  ok(!find(E.cost('F05'), 'cost_rate_over'), '暫定値なら出さない');
}

console.log('\n[3] 必要日数は GM が変更できる');
{
  const E = env().thr([]);
  ok(E.rules.forecast_min_days.warning === 3, '既定は3日');
  ok(E.rules.forecast_min_days.unit === '日', '単位が分かる');
  ok(E.rules.forecast_min_days.catLabel === '共通', '基準タブに「共通」として並ぶ');
  ok(E.enough({ daysWithActual: 2 }, 'F05') === false, '2日では足りない');
  ok(E.enough({ daysWithActual: 3 }, 'F05') === true, '3日で足りる');
  E.thr([{ rule_code: 'forecast_min_days', store_id: null, warning_value: 7, enabled: true }]);
  ok(E.enough({ daysWithActual: 5 }, 'F05') === false, '7日に変えれば5日では足りない');
  E.thr([{ rule_code: 'forecast_min_days', store_id: null, warning_value: 1, enabled: true }]);
  ok(E.enough({ daysWithActual: 1 }, 'F05') === true, '1日に戻すこともできる');
}

console.log('\n[4] 事務作業と単価変動を緊急にしない');
{
  const E = env().thr([]);
  /* 新店の食材マスター未整備 93件（画面では緊急になっていた） */
  E.data.v2 = [];
  for (var i = 0; i < 93; i++) E.data.v2.push({ name: '材料' + i, stores: ['F05'], cls: null, specDone: false, priceHistory: [{ date: recent() }] });
  const a = find(E.buy('F05'), 'new_ingredient');
  ok(a && /93 件/.test(a.title), '93件を検知する');
  ok(a.severity === 'warning', '93件でも注意どまり（緊急にしない）', a.severity);
  ok(E.rules.new_ingredient.critical === null, '緊急の基準を持たない');

  /* 1品目 24.8% の値上げ（画面では緊急になっていた） */
  E.data.v2 = [];
  E.data.changes = [{ name: '油', from: 10, to: 12.48, pct: 24.8, stores: ['F05'] }];
  const p = find(E.buy('F05'), 'price_up');
  ok(p && /1 件/.test(p.title), '1件を検知する');
  ok(p.severity === 'warning', '24.8%でも注意どまり', p.severity);
  ok(E.rules.price_up.critical === null, '緊急の基準を持たない');

  /* 前版では緊急だったこと */
  const before = objDecl(prev, 'MC_RULE_DEFAULTS') + ruleAdditions(prev);
  ok(/price_up[\s\S]{0,120}critical: 20/.test(before), '（参考）v819 までは20%で緊急にしていた');
  ok(/new_ingredient[\s\S]{0,120}critical: 10/.test(before), '（参考）v819 までは10件で緊急にしていた');
}

console.log('\n[5] 内訳に rule_code が生で出ない');
{
  const E = env().thr([]).seed([
    { rule_code: 'no_store_manager', store_id: 'F05', category: 'growth', status: 'open' },
    { rule_code: 'no_area_manager', store_id: 'F05', category: 'growth', status: 'open' },
    { rule_code: 'new_ingredient', store_id: 'F05', category: 'cost', status: 'open' },
  ]);
  const h = E.breakdown();
  ok(/店長が登録されていない 1/.test(h), '店長未設定が名前で出る（画面では no_store_manager のままだった）', h);
  ok(/管轄AMが設定されていない 1/.test(h), 'AM未設定も名前で出る');
  ok(!/no_store_manager/.test(h), 'rule_code が生で出ない');
}

console.log('\n[6] 止めすぎていないか');
{
  const E = env().thr([]);
  /* 実績が少なくても、データ不備そのものは出す */
  E.data.cum['F03-G'] = { budMonth: 50000, budToToday: 5000, actToToday: 0, actMonth: 0, daysPassed: 4, daysWithActual: 0, paceRate: 0 };
  const b = E.budget('F03-G');
  ok(!!find(b, 'sales_not_synced'), '売上が入っていないことは出す（見落としにならない）');
  E.data.cum['F03-G'] = { budMonth: 0, budToToday: 0, actToToday: 0, actMonth: 0, daysPassed: 4, daysWithActual: 0, paceRate: 0 };
  ok(!!find(E.budget('F03-G'), 'budget_missing'), '予算未登録も出す');
  /* 仕入・材料は日数に関係なく出す */
  E.data.v2 = [{ name: 'x', stores: ['F03-G'], cls: null, specDone: false, priceHistory: [{ date: recent() }] }];
  ok(!!find(E.buy('F03-G'), 'new_ingredient'), '材料の確認は月初でも出す（予測ではないため）');
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

  ['mcRole', 'mcScopeStores', 'mcThr', 'mcSevBy', 'mcUpsertAlert', 'mcAlertChanged',
    'mcNotifyAlert', 'mcRunDetection', 'mcRunEscalation', 'mcDetectGrowth',
    'mcDetectFromErrorCenter', 'mcUnitOf', 'mcVals', 'mcSummary', 'mcFieldFlush',
    'cumulativeToToday', 'foodCostOf', 'budgetGuestsMonthly', 'groupsForRole'].forEach(function (fn) {
      ok(grabIf(prev, fn) !== '' && unchangedIn('820', fn), fn + ' を変えていない');
    });
  ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
  ok(prev.indexOf('function mcEnoughDays(') < 0, 'v819 には無かった');
  ok(/mcEnoughDays\(/.test(grab(src, 'mcDetectBudget')), '予実に効いている');
  ok(/mcEnoughDays\(/.test(grab(src, 'mcDetectGuests')), '客数・客単価に効いている');
  ok(/mcEnoughDays\(/.test(grab(src, 'mcDetectLabor')), '人件費率に効いている');
  ok(/mcEnoughDays\(/.test(grab(src, 'mcDetectCost')), '原価率に効いている');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
