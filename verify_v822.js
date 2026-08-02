/* verify_v822.js — 前月タブと、意味の分からない説明を直す
   ① 「前月」で一覧が0件なのにサマリーは51件と出ていた（期間の見方が違っていた）
   ② 期間を「検知した日」で見ていたので、前月のアラートが永久に出なかった
   ③ 想定原因が「勤怠の不備です」と同じ言葉を繰り返すだけだった */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v822_backup.html')
  ? fs.readFileSync('index_v822_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v821_backup.html', 'utf8');
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
    var STORES=[{id:'F01',name:'Tenkichi',active:true,am:'Yuki'},{id:'F05',name:'Marujuu',active:true,am:'Yuki'}];
    var EMPS=[{name:'Moto',role:'gm',title:'General Manager',store:'F01',status:'在籍'}];
    var ROLE_CONFIG={gm:{name:'Moto'},am:{},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{},chef:{}};
    var AM_STORES=[];
    var DATA={ec:[],attr:{},ym:'2026-08'};
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES; }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F01'; }
    function curYm(){ return DATA.ym; }
    function bizNow(){ return new Date('2026-08-02T12:00:00Z'); }
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+(Number(v)||0); }
    function ecCollect(){ return DATA.ec; }
    function _ecAttribute(x){ return DATA.attr[x.title]||{}; }
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'MC_RULE_UNIT')} ${objDecl(src,'MC_VAL_LABELS')}
    ${objDecl(src,'MC_EC_CAT')} ${objDecl(src,'MC_EC_SEV')} ${objDecl(src,'MC_EC_WHAT')}
    ${objDecl(src,'mcThresholds')}
    ${ruleAdditions(src)}
    ${grab(src,'myAmStores')}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')} ${grab(src,'mcThr')}
    ${grab(src,'mcYm')} ${grab(src,'mcRound')} ${grab(src,'mcYmAdd')} ${grab(src,'mcYmOffset')}
    ${grab(src,'mcPeriodStart')} ${grab(src,'mcPeriodEnd')}
    ${grab(src,'mcAlertYm')} ${grab(src,'mcInPeriod')}
    ${grab(src,'mcVisibleAlerts')} ${grab(src,'mcSummary')} ${grab(src,'mcBreakdownHtml')}
    ${grab(src,'mcDetectFromErrorCenter')}
    return {
      data: DATA,
      seed:function(l){ mcState.alerts=JSON.parse(JSON.stringify(l||[])); mcState.tab='priority';
        mcState.store='ALL'; mcState.sev='ALL'; mcState.status='ACTIVE'; return this; },
      period:function(p){ mcState.period=p; return this; },
      visible:function(){ return mcVisibleAlerts().map(function(a){return a.id;}); },
      summary: mcSummary, breakdown: mcBreakdownHtml,
      ymOf: mcAlertYm, inPeriod: mcInPeriod,
      ec:function(ids){ return mcDetectFromErrorCenter(ids, DATA.ym); }
    };
  `)();
}
const nowIso = new Date().toISOString();
const A = (id, key, o) => Object.assign({
  id: id, dedupe_key: key, store_id: 'F01', category: 'budget', severity: 'warning',
  status: 'open', title: 't', estimated_impact: 100, last_detected_at: nowIso,
}, o || {});

console.log('\n=== v822: 前月タブと説明の分かりにくさ ===\n');

console.log('[1] 期間は「対象月」で見る（検知した日ではない）');
{
  const E = env();
  ok(E.ymOf(A('x', 'budget_forecast_miss|F01|2026-07')) === '2026-07', 'dedupe_key から対象月を取る');
  ok(E.ymOf(A('x', 'ec|labor|F01|2026-08')) === '2026-08', 'エラーセンター由来も取れる');
  ok(E.ymOf(A('x', 'no_store_manager|F01')) === '', '月に紐づかないものは空');

  const jul = A('jul', 'budget_forecast_miss|F01|2026-07');
  const aug = A('aug', 'budget_forecast_miss|F01|2026-08');
  const nom = A('nom', 'no_store_manager|F01', { category: 'growth' });
  E.seed([jul, aug, nom]);

  E.period('month');
  ok(JSON.stringify(E.visible().sort()) === JSON.stringify(['aug', 'nom']), '今月＝8月ぶん＋月に紐づかないもの', E.visible());
  E.period('prev');
  ok(JSON.stringify(E.visible().sort()) === JSON.stringify(['jul', 'nom']), '前月＝7月ぶん（検知は今日でも出る）', E.visible());
  ok(E.visible().indexOf('aug') < 0, '前月に8月ぶんは出ない');
}

console.log('\n[2] サマリーと一覧が食い違わない');
{
  const E = env().seed([
    A('a1', 'budget_forecast_miss|F01|2026-08', { severity: 'critical', estimated_impact: 1000 }),
    A('a2', 'labor_rate_over|F01|2026-08', { category: 'labor', estimated_impact: 500 }),
  ]);
  E.period('month');
  let s = E.summary();
  ok(s.open === 2 && s.critical === 1 && s.impact === 1500, '今月は2件・緊急1・$1500', s);
  ok(E.visible().length === 2, '一覧も2件');

  E.period('prev');
  s = E.summary();
  ok(E.visible().length === 0, '前月の一覧は0件');
  ok(s.open === 0 && s.critical === 0 && s.impact === 0,
    '前月のサマリーも0（画面では 51件・$45,674 のままだった）', s);
  ok(E.breakdown() === '', '内訳も出ない');
}

console.log('\n[3] 今週');
{
  const E = env().seed([
    A('new', 'ec|labor|F01|2026-08', { category: 'labor', last_detected_at: nowIso }),
    A('old', 'ec|cost|F01|2026-08', { category: 'cost', last_detected_at: '2026-07-20T00:00:00Z' }),
  ]);
  E.period('week');
  const v = E.visible();
  ok(v.indexOf('new') >= 0, '今週検知されたものは出る');
  ok(v.indexOf('old') < 0, '先月に検知されたきりのものは出ない');
}

console.log('\n[4] 想定原因が説明になっている');
{
  const E = env();
  E.data.ec = [
    { cat: '勤怠', sev: 'mid', title: 'Tenkichi：A：上限40h超過', detail: 'd1' },
    { cat: '勤怠', sev: 'mid', title: 'Tenkichi：B：打刻漏れ', detail: 'd2' },
    { cat: 'チップ', sev: 'mid', title: 'Tenkichi：チップ未入力', detail: 'd3' },
    { cat: '従業員', sev: 'mid', title: 'Tenkichi：時給未設定', detail: 'd4' },
  ];
  E.data.attr = {
    'Tenkichi：A：上限40h超過': { store: 'F01', emp: 'A' },
    'Tenkichi：B：打刻漏れ': { store: 'F01', emp: 'B' },
    'Tenkichi：チップ未入力': { store: 'F01', emp: 'C' },
    'Tenkichi：時給未設定': { store: 'F01', emp: 'D' },
  };
  const l = E.ec(['F01']);
  const lab = l.filter(x => /勤怠/.test(x.title))[0];
  ok(!!lab, '勤怠のアラートが出る');
  ok(/打刻漏れ・退勤漏れ・勤務時間の上限超過/.test(lab.cause_summary),
    '何が起きているか書いてある（「勤怠の不備です」ではない）', lab.cause_summary);
  ok(lab.cause_summary.indexOf('勤怠の不備です') < 0, '同じ言葉の繰り返しになっていない');
  ok(/対象：A、B/.test(lab.cause_summary), '対象者も残っている');

  const tip = l.filter(x => /チップ/.test(x.title))[0];
  ok(/入力漏れ|配分/.test(tip.cause_summary), 'チップも中身が書いてある', tip.cause_summary);
  const emp = l.filter(x => /従業員情報/.test(x.title))[0];
  ok(!!emp, '「従業員の不備」→「従業員情報の不備」に', emp && emp.title);
  ok(/役職・時給・在籍状態/.test(emp.cause_summary), '何の未設定かが分かる');

  ok(l.length === 3, '勤怠・チップ・従業員が別々のアラートになる（混ざらない）',
    l.map(x => x.dedupe_key));
  ok(new Set(l.map(x => x.dedupe_key)).size === 3, '鍵も3つに分かれる');
  ok(l.some(x => /\|勤怠\|/.test(x.dedupe_key)) && l.some(x => /\|チップ\|/.test(x.dedupe_key)),
    '鍵にエラーセンター側の分類が入る');
  ok(l.every(x => /\|2026-08$/.test(x.dedupe_key)), '鍵の最後は対象月のまま（期間の判定が壊れない）');

  /* 前版では同じ言葉の繰り返しだった */
  const before = grabIf(prev, 'mcDetectFromErrorCenter');
  ok(/a\._cat \+ '.{0,4}不備です'/.test(before) || /_cat.*不備/.test(before), '（参考）v821 までは繰り返しだった');
}

console.log('\n[5] 「内容量が変わった可能性」の言い方');
{
  const b = grab(src, 'mcDetectPurchase');
  ok(/単価が極端に動いた品目/.test(b), '何が起きたかをタイトルに書く');
  ok(/内容量の変更かもしれません/.test(b), '推測であることを分かるようにする');
  ok(/納品書の内容量を確認/.test(b), '何をすればよいか書いてある');
}

console.log('\n[6] 前月を検知できる');
{
  const rc = grab(src, 'mcRecalcNow');
  ok(/mcState\.period === 'prev'/.test(rc), '選んでいる期間を見る');
  ok(/mcYmAdd\(mcYm\(\), -1\)/.test(rc), '前月なら前月を検知する');
  ok(/mcRunDetection\('manual', ym\)/.test(rc), '対象月を渡す');
  const rd = grab(src, 'mcRunDetection');
  ok(/function mcRunDetection\(source, ymOpt\)/.test(rd), '対象月を受け取れる');
  ok(/var past = \(ym !== mcYm\(\)\)/.test(rd), '過去月かどうかを判定する');
  ok(/if \(kind && past\) kind = ''/.test(rd), '過去月の検知では通知しない（今さら鳴らさない）');
  ok(/ymOpt \|\| mcYm\(\)/.test(rd), '指定が無ければ今月');
  const before = grabIf(prev, 'mcRunDetection');
  ok(!/ymOpt/.test(before), '（参考）v821 までは今月しか検知できなかった');
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

  ['mcRole', 'mcScopeStores', 'mcThr', 'mcEnoughDays', 'mcUnitOf', 'mcVals', 'mcValLabels',
    'mcDetectBudget', 'mcDetectLabor', 'mcDetectCost', 'mcDetectGuests',
    'mcUpsertAlert', 'mcAlertChanged', 'mcNotifyAlert', 'mcRunEscalation', 'mcFieldFlush',
    'cumulativeToToday', 'foodCostOf', 'groupsForRole'].forEach(function (fn) {
      ok(grabIf(prev, fn) !== '' && unchangedIn('822', fn), fn + ' を変えていない');
    });
  ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
  ok(prev.indexOf('function mcInPeriod(') < 0, 'v821 には無かった');
  ok(src.indexOf(String.fromCharCode(0x8f96)) < 0, '簡体字の誤字が入っていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
