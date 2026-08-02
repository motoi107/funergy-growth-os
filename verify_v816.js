/* verify_v816.js — 仕入・客数・客単価の検知
   守るのは4つ。
   ① 既存の抽出口を使う（新しい計算を作らない）
   ② 商品マスターへ勝手に確定登録しない
   ③ 予算に客数が入っていなければ判定しない（勝手な基準を作らない）
   ④ 金額の出し方が説明できる（客数不足＝人数差×予算客単価 など） */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v816_backup.html')
  ? fs.readFileSync('index_v816_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v815_backup.html', 'utf8');
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

const STORES_FIX = [
  { id: 'F01', name: 'ToriTon', active: true, am: 'Yuki Nagatani' },
  { id: 'F04-K', name: 'Totoya Kaimuki', active: true, am: 'Yuki Nagatani' },
];

function env() {
  return new Function(`
    var curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false, curPage='mgmt_ctrl';
    var SUPABASE_URL='https://x.test';
    var ROLE_CONFIG={gm:{name:'Moto'},am:{name:'Yuki'},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{},chef:{}};
    var STORES=${JSON.stringify(STORES_FIX)};
    var EMPS=[{name:'Moto',role:'gm',title:'General Manager',store:'F01',status:'在籍'}];
    var AM_STORES=['F04-K'];
    var DATA = { v2:[], changes:[], inv:{}, buy:{}, cum:{}, guests:{}, stats:{}, ym:'2026-08' };
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES.filter(function(s){return s.active;}); }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F01'; }
    function curYm(){ return DATA.ym; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+(Number(v)||0); }
    function parseJaDate(s){ var d=new Date(s); return isNaN(d)?null:d; }
    function getIngV2(){ return DATA.v2; }
    function priceChangesRecent(){ return DATA.changes; }
    function monthInvoiceCostYm(sid, ym){ return (DATA.inv[sid]||{})[ym]||0; }
    function monthPurchaseCostYm(sid, ym){ return (DATA.buy[sid]||{})[ym]||0; }
    function cumulativeToToday(sid, ym){ return DATA.cum[sid]; }
    function budgetGuestsMonthly(sid, seg, off){ return ((DATA.guests[sid]||{})[seg])||null; }
    function monthStats(sid, off){ return DATA.stats[sid]||null; }
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')}
    ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'mcThresholds')}
    ${ruleAdditions(src)}
    var MC_PRICE_DAYS = ${(src.match(/MC_PRICE_DAYS\s*=\s*(\d+)/) || [, '45'])[1]};
    var MC_NEWING_DAYS = ${(src.match(/MC_NEWING_DAYS\s*=\s*(\d+)/) || [, '30'])[1]};
    ${grab(src,'myAmStores')}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcThr')} ${grab(src,'mcSevBy')} ${grab(src,'mcYm')} ${grab(src,'mcRound')}
    ${grab(src,'mcYmAdd')} ${grab(src,'mcYmOffset')}
    ${grab(src,'mcDetectPurchase')} ${grab(src,'mcDetectGuests')}
    return {
      data: DATA,
      thr:function(rows){ mcThresholds.rows=rows||[]; mcThresholds.loaded=true; return this; },
      buy:function(s){ return mcDetectPurchase(s, DATA.ym); },
      guests:function(s){ return mcDetectGuests(s, DATA.ym); },
      ymAdd: mcYmAdd, rules: MC_RULE_DEFAULTS
    };
  `)();
}
const find = (l, c) => l.filter(x => x.rule_code === c)[0];
const recent = () => new Date(Date.now() - 3 * 86400000).toISOString();

console.log('\n=== v816: 仕入・客数・客単価の検知 ===\n');

console.log('[1] 未確認の新規材料');
{
  const E = env().thr([]);
  E.data.v2 = [
    { name: '新しい鶏', stores: ['F01'], cls: null, specDone: false, priceHistory: [{ date: recent() }] },
    { name: '分類済み', stores: ['F01'], cls: '肉', specDone: false, priceHistory: [{ date: recent() }] },
    { name: '規格確定済み', stores: ['F01'], cls: null, specDone: true, priceHistory: [{ date: recent() }] },
    { name: '他店のもの', stores: ['F04-K'], cls: null, specDone: false, priceHistory: [{ date: recent() }] },
    { name: '古いもの', stores: ['F01'], cls: null, specDone: false, priceHistory: [{ date: '2026-01-05' }] },
  ];
  const l = E.buy('F01');
  const a = find(l, 'new_ingredient');
  ok(!!a, '未確認の材料を検知する');
  ok(/1 件/.test(a.title), '対象は1件だけ', a.title);
  ok(/新しい鶏/.test(a.description), '該当品目を出す');
  ok(!/分類済み/.test(a.description), '分類済みは対象外');
  ok(!/規格確定済み/.test(a.description), '規格が確定していれば対象外');
  ok(!/他店のもの/.test(a.description), '他店のものは入らない');
  ok(!/古いもの/.test(a.description), '古いものは今さら鳴らさない');
  ok(/登録.*統合.*名称修正.*対象外/.test(a.recommended_action), '4つの選択肢へ誘導する');

  const b = grab(src, 'mcDetectPurchase');
  ok(!/lsSet\(|saveIngV2\(|_setIngV2\(/.test(b), '検知が商品マスターに書き込まない（勝手に確定登録しない）');
}

console.log('\n[2] 仕入単価の上昇と、内容量が変わった可能性');
{
  const E = env().thr([]);
  E.data.changes = [
    { name: '玉ねぎ', from: 10, to: 11.5, pct: 15, stores: ['F01'] },
    { name: '鶏もも', from: 20, to: 25, pct: 25, stores: ['F01'] },
    { name: '米', from: 30, to: 60, pct: 100, stores: ['F01'] },
    { name: '値下げ品', from: 10, to: 8, pct: -20, stores: ['F01'] },
    { name: '微増', from: 10, to: 10.3, pct: 3, stores: ['F01'] },
    { name: '他店', from: 10, to: 20, pct: 100, stores: ['F04-K'] },
  ];
  const l = E.buy('F01');
  const up = find(l, 'price_up');
  ok(up && /2 件/.test(up.title), '10%以上の上昇を2件拾う', up && up.title);
  ok(up.severity === 'critical', '25%は緊急', up.severity);
  ok(!/値下げ/.test(up.description), '値下げは拾わない');
  ok(!/微増/.test(up.description), '基準未満は拾わない');
  ok(!/米/.test(up.description), '極端な変動は別扱いにする（二重に出さない）');

  const cs = find(l, 'case_size_changed');
  ok(cs && /1 件/.test(cs.title), '40%以上は内容量変更の可能性として出す');
  ok(/米/.test(cs.description), '対象品目が出る');
  ok(/\u5185\u5bb9\u91cf/.test(cs.recommended_action), '規格の確認へ誘導する');
  ok(!/他店/.test(JSON.stringify(l)), '他店の変動は入らない');
}

console.log('\n[3] 仕入額が普段より多い');
{
  const E = env().thr([]);
  E.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 50000, actMonth: 50000, daysPassed: 15, daysWithActual: 15, paceRate: 100 };
  E.data.inv['F01'] = { '2026-08': 20000, '2026-07': 30000, '2026-06': 30000, '2026-05': 30000 };
  E.data.buy['F01'] = {};
  let l = E.buy('F01');
  const sp = find(l, 'purchase_spike');
  ok(!!sp, '過去平均の同進捗より多ければ検知する');
  ok(sp.target_value === 15000, '比べる相手＝過去3か月平均×進捗', sp.target_value);
  ok(sp.estimated_impact === 5000, '影響額＝超過額', sp.estimated_impact);
  ok(sp.severity === 'critical', '33%超は緊急', sp.severity);

  E.data.inv['F01']['2026-08'] = 15500;
  ok(!find(E.buy('F01'), 'purchase_spike'), '基準内なら出さない');

  /* 過去データが足りなければ判定しない */
  const E2 = env().thr([]);
  E2.data.cum['F01'] = E.data.cum['F01'];
  E2.data.inv['F01'] = { '2026-08': 99999, '2026-07': 30000 };
  E2.data.buy['F01'] = {};
  ok(!find(E2.buy('F01'), 'purchase_spike'), '比べる月が1つしか無ければ判定しない');
}

console.log('\n[4] 客数の予実');
{
  const E = env().thr([]);
  E.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 45000, actMonth: 45000, daysPassed: 15, daysWithActual: 15, paceRate: 90 };
  E.data.guests['F01'] = { lunch: 1000, dinner: 1000 };   /* 月間 2000人 */
  E.data.stats['F01'] = { guests: 800, avgSpend: 50, daysWithData: 15, sales: 45000 };
  const l = E.guests('F01');
  const g = find(l, 'guests_short');
  ok(!!g, '客数不足を検知する');
  ok(g.target_value === 1000, '進捗ぶんの予算客数＝2000×(50000/100000)', g.target_value);
  ok(/20% 下回/.test(g.title), '20%不足', g.title);
  ok(g.estimated_impact === 10000, '影響額＝人数差×予算客単価（200人×$50）', g.estimated_impact);
  ok(g.severity === 'critical', '12%超は緊急');
  ok(/\u96c6\u5ba2/.test(g.cause_summary), '客単価ではなく集客の問題だと書く');

  E.data.stats['F01'].guests = 980;
  ok(!find(E.guests('F01'), 'guests_short'), '2%不足なら出さない');
}

console.log('\n[5] 客単価の予実');
{
  const E = env().thr([]);
  E.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 45000, actMonth: 45000, daysPassed: 15, daysWithActual: 15, paceRate: 90 };
  E.data.guests['F01'] = { lunch: 1000, dinner: 1000 };
  E.data.stats['F01'] = { guests: 1000, avgSpend: 45, daysWithData: 15, sales: 45000 };
  const l = E.guests('F01');
  const s = find(l, 'spend_short');
  ok(!!s, '客単価不足を検知する');
  ok(s.target_value === 50, '予算客単価＝月間予算÷月間予算客数', s.target_value);
  ok(/10% 下回/.test(s.title), '10%不足', s.title);
  ok(s.estimated_impact === 5000, '影響額＝単価差×実績客数（$5×1000人）', s.estimated_impact);
  ok(!find(l, 'guests_short'), '客数は足りているので客数不足は出ない');
}

console.log('\n[6] 判定しない条件（勝手な基準を作らない）');
{
  const E = env().thr([]);
  E.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 45000, actMonth: 45000, daysPassed: 15, daysWithActual: 15, paceRate: 90 };
  E.data.stats['F01'] = { guests: 100, avgSpend: 10, daysWithData: 15, sales: 45000 };
  E.data.guests['F01'] = {};                       /* 予算に客数が入っていない */
  ok(E.guests('F01').length === 0, '予算に客数が無ければ判定しない');

  E.data.guests['F01'] = { lunch: 1000, dinner: 1000 };
  E.data.stats['F01'] = { guests: 0, avgSpend: 0, daysWithData: 0, sales: 0 };
  ok(E.guests('F01').length === 0, '実績が無ければ判定しない');

  E.data.cum['F01'] = { budMonth: 0, budToToday: 0 };
  E.data.stats['F01'] = { guests: 800, avgSpend: 50, daysWithData: 15 };
  ok(E.guests('F01').length === 0, '予算が無ければ判定しない');
}

console.log('\n[7] 基準は GM が変更できる');
{
  const E = env();
  E.thr([]);
  ok(E.rules.price_up.warning === 10 && E.rules.price_up.unit === '%', '仕入単価は既定10%');
  ok(E.rules.guests_short.critical === 12, '客数は12%で緊急');
  E.data.changes = [{ name: 'A', from: 10, to: 10.6, pct: 6, stores: ['F01'] }];
  ok(!find(E.buy('F01'), 'price_up'), '既定では6%は鳴らない');
  E.thr([{ rule_code: 'price_up', store_id: null, warning_value: 5, critical_value: 8, enabled: true }]);
  ok(!!find(E.buy('F01'), 'price_up'), '基準を下げると鳴る');
  E.thr([{ rule_code: 'price_up', store_id: null, warning_value: 5, enabled: false }]);
  ok(!find(E.buy('F01'), 'price_up'), '無効にすれば鳴らない');
}

console.log('\n[8] 設計どおりか');
{
  const b = grab(src, 'mcDetectPurchase'), g = grab(src, 'mcDetectGuests');
  ok(!/await |fetch\(|mcApi\(/.test(b) && !/await |fetch\(|mcApi\(/.test(g), '検知は通信しない');
  ok(/priceChangesRecent\(/.test(b), '単価変動は既存の抽出口を使う');
  ok(/getIngV2\(/.test(b), '食材は V2 マスターを見る');
  ok(/monthInvoiceCostYm\(/.test(b) && /monthPurchaseCostYm\(/.test(b), '仕入額は既存の集計を使う');
  ok(/budgetGuestsMonthly\(/.test(g), '予算客数は既存の関数を使う');
  ok(/monthStats\(/.test(g), '実績は既存の集計を使う');
  ok(/cumulativeToToday\(/.test(g) && /cumulativeToToday\(/.test(b), '進捗も既存の計算口から取る');
  /* 件数ではなく、実際に出たアラートの鍵を見る（教訓③） */
  const E9 = env().thr([]);
  E9.data.v2 = [{ name: 'X', stores: ['F01'], cls: null, specDone: false, priceHistory: [{ date: recent() }] }];
  E9.data.changes = [{ name: 'A', from: 10, to: 13, pct: 30, stores: ['F01'] },
                     { name: 'B', from: 10, to: 20, pct: 100, stores: ['F01'] }];
  E9.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 45000, actMonth: 45000, daysPassed: 15, daysWithActual: 15, paceRate: 90 };
  E9.data.inv['F01'] = { '2026-08': 20000, '2026-07': 30000, '2026-06': 30000 };
  E9.data.buy['F01'] = {};
  E9.data.guests['F01'] = { lunch: 1000, dinner: 1000 };
  E9.data.stats['F01'] = { guests: 800, avgSpend: 45, daysWithData: 15, sales: 45000 };
  const produced = E9.buy('F01').concat(E9.guests('F01'));
  const codes = produced.map(x => x.rule_code).sort();
  ok(codes.length === 6, 'この版で足した6ルールが全部出る', codes);
  ok(produced.every(x => !!x.dedupe_key), '全件に重複防止の鍵がある');
  ok(produced.every(x => x.dedupe_key.indexOf('|F01|2026-08') > 0), '鍵に店舗と対象月が入る',
    produced.map(x => x.dedupe_key));
  ok(new Set(produced.map(x => x.dedupe_key)).size === 6, '鍵が互いに重ならない');
  /* 数字が動いても鍵は変わらない＝アラートが増えない */
  E9.data.stats['F01'].guests = 700;
  const again = E9.buy('F01').concat(E9.guests('F01')).map(x => x.dedupe_key).sort();
  ok(JSON.stringify(again) === JSON.stringify(produced.map(x => x.dedupe_key).sort()),
    '数字が変わっても鍵は同じ');
  const col = grab(src, 'mcCollectCandidates');
  ok(/mcDetectPurchase\(/.test(col) && /mcDetectGuests\(/.test(col), '収集口に足した（検知の入口は1つのまま）');
}

console.log('\n[9] ビルドの性質と既存への影響');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
  } else ok(true, 'SW_BUILD は現行版の検証で見る');

  ['mcDetectBudget', 'mcDetectLabor', 'mcDetectCost', 'mcDetectGrowth', 'mcDetectFromErrorCenter',
    'mcRunDetection', 'mcRunEscalation', 'mcThr', 'mcUpsertAlert', 'mcNotifyAlert', 'mcApi',
    'priceChangesRecent', 'getIngV2', 'ingestInvoiceToV2', 'monthInvoiceCostYm',
    'budgetGuestsMonthly', 'monthStats', 'foodCostOf', 'cumulativeToToday',
    'groupsForRole'].forEach(function (fn) {
      if (fn === 'mcCollectCandidates') return;
      ok(grabIf(prev, fn) !== '' && unchangedIn('816', fn), fn + ' を変えていない');
    });
  ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
  ok(prev.indexOf('function mcDetectPurchase(') < 0, 'v815 には無かった');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
