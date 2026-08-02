/* verify_v817.js — 初回検知で出た3つの問題を直す
   ① エラーセンターの橋渡しが人ごとに増えていた（109件になった）
   ② 新規アラートごとに通知したので300通近く飛んだ
   ③ 「月末までの予測影響額」が二重計上を含んでいた */
const fs = require('fs');
const { execFileSync } = require('child_process');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v817_backup.html')
  ? fs.readFileSync('index_v817_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v816_backup.html', 'utf8');
const clean = fs.existsSync('management_control_v817_cleanup.sql')
  ? fs.readFileSync('management_control_v817_cleanup.sql', 'utf8') : '';
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
  { id: 'F01', name: 'Tenkichi', active: true, am: 'Yuki Nagatani' },
  { id: 'F04-K', name: 'Totoya Kaimuki', active: true, am: 'Yuki Nagatani' },
];
const EMPS_FIX = [
  { name: 'Moto', role: 'gm', title: 'General Manager', store: 'F01', status: '在籍' },
  { name: 'Yuki Nagatani', role: 'am', title: 'Area Manager', store: 'F04-K', status: '在籍' },
  { name: 'Nakai', role: 'g4', title: 'Store Manager', store: 'F01', status: '在籍' },
];

function env() {
  return new Function(`
    var curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false, curPage='mgmt_ctrl';
    var SUPABASE_URL='https://x.test';
    var ROLE_CONFIG={gm:{name:'Moto'},am:{name:'Yuki Nagatani'},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{},chef:{}};
    var STORES=${JSON.stringify(STORES_FIX)}, EMPS=${JSON.stringify(EMPS_FIX)};
    var AM_STORES=['F04-K'];
    var CALLS=[], QUEUE=[];
    var DATA = { ec:[], attr:{}, cum:{}, kpi:{}, fc:{}, guests:{}, stats:{}, v2:[], changes:[], inv:{}, buy:{}, ym:'2026-08' };
    var document={hidden:false,addEventListener:function(){},removeEventListener:function(){},getElementById:function(){return null;}};
    var window={supabase:null,addEventListener:function(){},removeEventListener:function(){}};
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES.filter(function(s){return s.active;}); }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F01'; }
    function curYm(){ return DATA.ym; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+(Number(v)||0); }
    function parseJaDate(s){ var d=new Date(s); return isNaN(d)?null:d; }
    function ecCollect(){ return DATA.ec; }
    function _ecAttribute(x){ return DATA.attr[x.title]||{}; }
    function cumulativeToToday(sid){ return DATA.cum[sid]; }
    function getStoreKpiTargets(sid){ return DATA.kpi[sid]||{}; }
    function foodCostOf(sid){ return DATA.fc[sid]||{hasEnd:false}; }
    function laborCoreForYm(){ return {byName:{}}; }
    function getSkillsV2(){ return {}; }
    function getIngV2(){ return DATA.v2; }
    function priceChangesRecent(){ return DATA.changes; }
    function monthInvoiceCostYm(sid, ym){ return (DATA.inv[sid]||{})[ym]||0; }
    function monthPurchaseCostYm(sid, ym){ return (DATA.buy[sid]||{})[ym]||0; }
    function budgetGuestsMonthly(sid, seg){ return ((DATA.guests[sid]||{})[seg])||null; }
    function monthStats(sid){ return DATA.stats[sid]||null; }
    function supaHeaders(x){ return Object.assign({apikey:'k'},x||{}); }
    function showToast(){} function renderPage(){}
    function mcRenderSheetNow(){}
    function fetch(url, opt){
      opt=opt||{};
      CALLS.push({ url:String(url), method:opt.method||'GET', body: opt.body?JSON.parse(opt.body):null });
      var r = QUEUE.length ? QUEUE.shift() : { status:200, body:'[]' };
      return Promise.resolve({ ok:r.status>=200&&r.status<300, status:r.status, text:function(){ return Promise.resolve(r.body); } });
    }
    ${grab(src,'myAmStores')}
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_TBL')} ${objDecl(src,'mcSheet')} ${objDecl(src,'mcReq')} ${objDecl(src,'mcExtra')}
    ${objDecl(src,'MC_NOTIF_KIND')} ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'MC_EC_CAT')}
    ${objDecl(src,'MC_EC_SEV')} ${objDecl(src,'mcThresholds')} ${objDecl(src,'mcRun')}
    ${ruleAdditions(src)}
    var MC_SKILL_MIN_HOURS = ${(src.match(/MC_SKILL_MIN_HOURS\s*=\s*(\d+)/) || [, '20'])[1]};
    var MC_PRICE_DAYS = ${(src.match(/MC_PRICE_DAYS\s*=\s*(\d+)/) || [, '45'])[1]};
    var MC_NEWING_DAYS = ${(src.match(/MC_NEWING_DAYS\s*=\s*(\d+)/) || [, '30'])[1]};
    var MC_NOTIFY_MAX_PER_RUN = ${(src.match(/MC_NOTIFY_MAX_PER_RUN\s*=\s*(\d+)/) || [, '10'])[1]};
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcStoreManagersOf')} ${grab(src,'mcAmNameOf')} ${grab(src,'mcGmNames')}
    ${grab(src,'mcNotifyTargets')} ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcIdemKey')} ${grab(src,'mcNowIso')} ${grab(src,'mcMyName')}
    ${grab(src,'mcApi')} ${grab(src,'mcLogEvent')} ${grab(src,'mcUpdateLocked')}
    ${grab(src,'mcUpsertAlert')} ${grab(src,'mcFindAlert')} ${grab(src,'mcReplaceAlert')}
    ${grab(src,'mcSevPriority')} ${grab(src,'mcNotifItem')} ${grab(src,'mcNotifyAlert')}
    ${grab(src,'mcRaiseTargetIssues')} ${grab(src,'mcLoadAlerts')}
    ${grab(src,'mcThresholdsLoad')} ${grab(src,'mcThr')} ${grab(src,'mcSevBy')}
    ${grab(src,'mcYm')} ${grab(src,'mcRound')} ${grab(src,'mcYmAdd')} ${grab(src,'mcYmOffset')}
    ${grab(src,'mcDetectBudget')} ${grab(src,'mcDetectLabor')} ${grab(src,'mcDetectCost')}
    ${grab(src,'mcDetectGrowth')} ${grab(src,'mcDetectFromErrorCenter')}
    ${grab(src,'mcDetectPurchase')} ${grab(src,'mcDetectGuests')}
    ${grab(src,'mcCollectCandidates')} ${grab(src,'mcRunEscalation')} ${grab(src,'mcRunDetection')}
    mcLoadAlerts = function(){ return Promise.resolve(); };
    mcRunEscalation = function(){ return Promise.resolve({toAm:0,toGm:0,renotify:0}); };
    return {
      data: DATA,
      thr:function(rows){ mcThresholds.rows=rows||[]; mcThresholds.loaded=true; return this; },
      queue:function(q){ QUEUE.length=0; (q||[]).forEach(function(x){QUEUE.push(x);}); CALLS.length=0; return this; },
      calls:function(){ return CALLS; },
      ec:function(ids){ return mcDetectFromErrorCenter(ids, DATA.ym); },
      budget:function(s){ return mcDetectBudget(s, DATA.ym); },
      guests:function(s){ return mcDetectGuests(s, DATA.ym); },
      buy:function(s){ return mcDetectPurchase(s, DATA.ym); },
      cost:function(s){ return mcDetectCost(s, DATA.ym); },
      labor:function(s){ return mcDetectLabor(s, DATA.ym); },
      run: mcRunDetection
    };
  `)();
}
const R = (rows) => ({ status: 200, body: JSON.stringify(rows) });
const find = (l, c) => l.filter(x => x.rule_code === c)[0];

async function main() {
  console.log('\n=== v817: 件数・通知・影響額の直し ===\n');

  console.log('[1] エラーセンターの橋渡しを人ごとに増やさない');
  {
    const E = env().thr([]);
    const people = ['Nodoka Kumagai', 'A太', 'B子', 'C郎', 'D美'];
    E.data.ec = [];
    E.data.attr = {};
    people.forEach(function (p, i) {
      for (var w = 0; w < 3; w++) {   /* 1人あたり3週ぶん */
        const t = 'Tenkichi：' + p + '：Tenkichi 7/' + (19 + w) + '〜 上限40h超過（G2）';
        E.data.ec.push({ cat: '勤怠', sev: i === 0 ? 'high' : 'mid', title: t, detail: 'd' });
        E.data.attr[t] = { store: 'F01', emp: p };
      }
    });
    const l = E.ec(['F01']);
    ok(l.length === 1, '15件の不備が1件のアラートにまとまる（v816 は5件になっていた）', l.length);
    const a = l[0];
    ok(a.dedupe_key === 'ec|labor|F01|2026-08', '鍵に人名が入らない', a.dedupe_key);
    ok(/15 件/.test(a.title) && /5 名/.test(a.title), '件数と人数を出す', a.title);
    ok(a.severity === 'critical', '重い方の重要度を採る');
    ok(/Nodoka Kumagai/.test(a.cause_summary), '対象者は原因欄に出す');
    ok(/40h超過/.test(a.description), '中身も読める');
    ok(a.current_value === 15, '件数を数値として持つ');

    /* 店舗名が二重に出ない（画面で「Tenkichi：… Tenkichi 7/19〜」になっていた） */
    ok(a.title.split('Tenkichi').length - 1 === 1, 'タイトルに店舗名が1回だけ', a.title);
    ok(a.description.indexOf('Tenkichi：') < 0, '本文の先頭からも店舗名を外す', a.description.slice(0, 60));

    /* 分野が違えば分ける */
    E.data.ec.push({ cat: '棚卸', sev: 'mid', title: 'Tenkichi：棚卸未入力', detail: 'd' });
    E.data.attr['Tenkichi：棚卸未入力'] = { store: 'F01', emp: '' };
    ok(E.ec(['F01']).length === 2, '分野が違えば分ける');
  }

  console.log('\n[2] 通知を出しすぎない（仕様§9の優先度）');
  {
    /* 確認(info)は個別通知しない */
    const E = env().thr([]);
    E.data.cum['F01'] = { budMonth: 0, budToToday: 0, actToToday: 0, actMonth: 0, daysPassed: 10, daysWithActual: 0 };
    E.queue([
      R([]),                                             /* thresholds */
      R([{ id: 'x1', version: 1, store_id: 'F01', severity: 'info', title: 't' }]),
      R([]),                                             /* event created */
      R([]), R([]), R([]), R([]), R([]),
    ]);
    await E.run('manual');
    ok(!E.calls().some(c => /rpc\/mc_notify/.test(c.url)), '確認レベルは個別に通知しない');

    const runSrc = grab(src, 'mcRunDetection');
    ok(/severity === 'info'\) kind = ''/.test(runSrc), '確認レベルを外す判定がある');
    ok(/MC_NOTIFY_MAX_PER_RUN/.test(runSrc), '1回の検知で通知する上限がある');
    ok(/severity !== 'critical'/.test(runSrc), '緊急は上限を超えても通知する');
    ok(/stat\.muted/.test(runSrc), '押さえた件数を数えている');
    ok(/通知を押さえた件数/.test(runSrc) || /muted/.test(runSrc), '実行記録に残す');
    const cap = Number((src.match(/MC_NOTIFY_MAX_PER_RUN\s*=\s*(\d+)/) || [, '0'])[1]);
    ok(cap > 0 && cap <= 20, '上限が現実的な数', cap);
    ok(!/MC_NOTIFY_MAX_PER_RUN/.test(grabIf(prev, 'mcRunDetection')), 'v816 には上限が無かった');
  }

  console.log('\n[3] 影響額を二重に数えない');
  {
    const E = env().thr([]);
    E.data.cum['F01'] = { budMonth: 100000, budToToday: 50000, actToToday: 40000, actMonth: 40000, daysPassed: 15, daysWithActual: 15, paceRate: 80, laborRate: 34, laborToToday: 13600 };
    E.data.kpi['F01'] = { laborPct: 28, foodCost: 30 };
    E.data.fc['F01'] = { hasEnd: true, rate: 36, provisionalRate: 0, sales: 40000, purch: 14400 };
    E.data.guests['F01'] = { lunch: 1000, dinner: 1000 };
    E.data.stats['F01'] = { guests: 700, avgSpend: 45, daysWithData: 15, sales: 40000 };
    E.data.inv['F01'] = { '2026-08': 20000, '2026-07': 30000, '2026-06': 30000 };
    E.data.buy['F01'] = {};

    const b = E.budget('F01'), g = E.guests('F01'), p = E.buy('F01'), c = E.cost('F01'), lb = E.labor('F01');
    const pace = find(b, 'budget_pace_behind'), fm = find(b, 'budget_forecast_miss');
    ok(pace && pace.estimated_impact == null, '進捗の遅れは金額を持たない（月末予測に含まれるため）');
    ok(/不足 \$10000/.test(pace.description), '金額は文章で読める', pace.description);
    ok(fm && fm.estimated_impact === 20000, '月末予測の不足だけが金額を持つ', fm && fm.estimated_impact);

    const gs = find(g, 'guests_short'), ss = find(g, 'spend_short');
    ok(gs && gs.estimated_impact == null, '客数不足は内訳なので金額を持たない');
    ok(/売上換算/.test(gs.description), '金額は文章で読める');
    ok(ss && ss.estimated_impact == null, '客単価不足も内訳');

    const sp = find(p, 'purchase_spike');
    ok(sp && sp.estimated_impact == null, '仕入過多は原価率超過と重なるので金額を持たない');
    ok(/超過 \$/.test(sp.description), '金額は文章で読める');

    const cr = find(c, 'cost_rate_over'), lr = lb[0];
    ok(cr && cr.estimated_impact > 0, '原価率超過は金額を持つ');
    ok(lr && lr.estimated_impact > 0, '人件費率超過も金額を持つ');

    /* 合算の中身が「売上不足＋人件費超過＋原価超過」だけになる */
    const all = b.concat(g, p, c, lb);
    const withMoney = all.filter(x => x.estimated_impact != null).map(x => x.rule_code).sort();
    ok(JSON.stringify(withMoney) === JSON.stringify(['budget_forecast_miss', 'cost_rate_over', 'labor_rate_over']),
      '金額を持つのは3ルールだけ', withMoney);
    ok(/二重に数えていません/.test(src), '画面にも何を合算しているか書いている');
  }

  console.log('\n[4] 後片付けの SQL');
  {
    ok(clean.indexOf("rule_code like 'ec" + String.fromCharCode(92) + "_%'") >= 0,
    '行き場のない ec_ アラートだけを対象にする（_ をエスケープしている）');
    ok(/not exists \(select 1 from public\.management_alert_comments/.test(clean), 'コメントが付いているものは消さない');
    ok(/not exists \(select 1 from public\.management_alert_actions/.test(clean), '依頼が付いているものも消さない');
    ok(/set acknowledged_at = now\(\)/.test(clean), '通知は消さずに確認済みにする（履歴を残す）');
    ok(!/delete from public\.management_notifications/.test(clean), '通知を直接消していない');
    ok(/select[\s\S]{0,300}ec_alerts/.test(clean), '実行前に件数を見せる');
    ok(/ec_alerts_left/.test(clean), '実行後にも件数を見せる');
  }

  console.log('\n[5] 後片付けの SQL を実際に動かす');
  {
    let alive = false;
    try {
      execFileSync('bash', ['-lc', 'su postgres -c "psql -h /tmp -p 5433 -d postgres -c \'select 1\'" >/dev/null 2>&1'], { timeout: 15000 });
      alive = true;
    } catch (e) { alive = false; }
    if (!alive) {
      console.log('  ⏭  検証用の PostgreSQL が動いていないため実行を飛ばしました');
      ok(true, 'SQL の構造は上で確認済み');
    } else {
      let out = '';
      try {
        out = String(execFileSync('bash', ['-lc',
          'set -e; D=mcclean$RANDOM; ' +
          'su postgres -c "createdb -h /tmp -p 5433 $D" >/dev/null 2>&1; ' +
          'for f in management_control_v808.sql management_control_v811.sql management_control_v815.sql; do ' +
          '  cp $f /tmp/_x.sql; chmod 644 /tmp/_x.sql; su postgres -c "psql -h /tmp -p 5433 -d $D -q -f /tmp/_x.sql" >/dev/null 2>&1; done; ' +
          "cat > /tmp/_s.sql <<'EOF'\n" +
          "insert into management_alerts (rule_code, dedupe_key, store_id, category, severity, title, status) select 'ec_labor','ec|labor|F01|x'||i,'F01','labor','critical','t'||i,'open' from generate_series(1,5) i;\n" +
          "insert into management_alerts (rule_code, dedupe_key, store_id, category, severity, title, status) values ('budget_forecast_miss','b1','F01','budget','critical','x','open');\n" +
          "insert into management_alert_comments (alert_id,user_id,comment,idempotency_key) select id,'Moto','c','k1' from management_alerts where rule_code='ec_labor' limit 1;\n" +
          "insert into management_notifications (alert_id,recipient_user_id,recipient_role,store_id,channel,priority,status,title,idempotency_key) select a.id,r.n,'sm','F01','inapp','critical','sent','t',a.id::text||r.n from management_alerts a,(values ('N'),('Y'),('M')) r(n);\n" +
          "EOF\n" +
          'chmod 644 /tmp/_s.sql; su postgres -c "psql -h /tmp -p 5433 -d $D -q -f /tmp/_s.sql" >/dev/null 2>&1; ' +
          'cp management_control_v817_cleanup.sql /tmp/_cl.sql; chmod 644 /tmp/_cl.sql; ' +
          'su postgres -c "psql -h /tmp -p 5433 -d $D -t -A -f /tmp/_cl.sql" 2>&1; ' +
          'su postgres -c "dropdb -h /tmp -p 5433 $D" >/dev/null 2>&1 || true'
        ], { timeout: 90000 }));
      } catch (e) { out = String((e && (e.stdout || e.message)) || ''); }
      const rows = out.split('\n').filter(l => /\|/.test(l));
      ok(rows.length >= 2, '実行できた', rows);
      const before = (rows[0] || '').split('|'), after = (rows[rows.length - 1] || '').split('|');
      ok(before[0] === '5' && before[2] === '18', '実行前：ec_ 5件・未確認通知18件', before);
      ok(after[0] === '1', 'コメント付きの1件だけ残る', after);
      ok(after[1] === '2', '他のアラートは消えない（予実は残る）', after);
      ok(after[2] === '0', '未確認の通知が0件になる（店長の画面が空になる）', after);
    }
  }

  console.log('\n[6] ビルドの性質と既存への影響');
  {
    const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
    if (src === _cur) {
      const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
      ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
    } else ok(true, 'SW_BUILD は現行版の検証で見る');

    ['mcRole', 'mcScopeStores', 'mcNotifyTargets', 'mcNotifyAlert', 'mcUpsertAlert', 'mcUpdateLocked',
      'mcApi', 'mcThr', 'mcRunEscalation', 'mcDetectLabor', 'mcDetectGrowth', 'mcFieldFlush',
      'mcFreshness', 'cumulativeToToday', 'foodCostOf', 'ecCollect', '_ecAttribute',
      'priceChangesRecent', 'groupsForRole'].forEach(function (fn) {
        ok(grabIf(prev, fn) !== '' && unchangedIn('817', fn), fn + ' を変えていない');
      });
    ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
    ok(grab(src, 'mcSummary') === grab(prev, 'mcSummary'), '合算のしかた自体は変えていない（金額の入れ方を直した）');
  }

  console.log('\n--- 集計 ---');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('ERR: ' + (e && e.stack || e)); process.exit(1); });
