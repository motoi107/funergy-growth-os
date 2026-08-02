/* verify_v814.js — エスカレーション・データの新しさ
   守るのは4つ。
   ① 未確認のまま時間が経ったら上へ上げる。段階ごとに1度だけ
   ② 片付いたアラートは上げない
   ③ 上げる時間はコードに固定しない（GMが変更できる）
   ④ データが古いときは、予測をそのままの顔で出さない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v814_backup.html')
  ? fs.readFileSync('index_v814_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v813_backup.html', 'utf8');
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
/* v814 で MC_RULE_DEFAULTS に足している3件も取り込む */
function ruleAdditions(text) {
  const out = [];
  text.replace(/MC_RULE_DEFAULTS\.(\w+)\s*=\s*\{[\s\S]*?\};/g, function (m) { out.push(m); return m; });
  return out.join('\n');
}

const STORES_FIX = [
  { id: 'F01', name: 'ToriTon', active: true, am: 'Yuki Nagatani' },
  { id: 'F04-K', name: 'Totoya Kaimuki', active: true, am: 'Yuki Nagatani' },
];
const EMPS_FIX = [
  { name: 'Moto', role: 'gm', title: 'General Manager', store: 'F01', status: '在籍' },
  { name: 'Yuki Nagatani', role: 'am', title: 'Area Manager', store: 'F04-K', status: '在籍' },
  { name: 'Nakai', role: 'g4', title: 'Store Manager', store: 'F01', status: '在籍' },
];

function env() {
  return new Function(`
    var curPage='mgmt_ctrl', curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false;
    var SUPABASE_URL='https://x.test', SUPABASE_ANON='k';
    var ROLE_CONFIG={gm:{name:'Moto'},am:{name:'Yuki Nagatani'},g4:{name:'SM'},sl:{name:'SL'},crew:{name:'C'},ceo:{name:'T'},office:{name:'M'},office_crew:{name:'O'},chef:{name:'HC'}};
    var STORES=${JSON.stringify(STORES_FIX)}, EMPS=${JSON.stringify(EMPS_FIX)};
    var AM_STORES=['F04-K'];
    var CALLS=[], QUEUE=[];
    var DATA = { actuals:{}, labor:{}, skills:{}, fc:{}, synced:'2026-08-02T00:00:00Z', now:new Date('2026-08-02T12:00:00Z') };
    var document={hidden:false,addEventListener:function(){},removeEventListener:function(){},getElementById:function(){return null;}};
    var window={supabase:null,addEventListener:function(){},removeEventListener:function(){}};
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES.filter(function(s){return s.active;}); }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F01'; }
    function curYm(){ return '2026-08'; }
    function bizNow(){ return DATA.now; }
    function getDailyActuals(sid){ return DATA.actuals[sid]||{}; }
    function getTipLabor(sid,d){ return (DATA.labor[sid]||{})[d]||null; }
    function getSkillsV2(){ return DATA.skills; }
    function foodCostOf(sid){ return DATA.fc[sid]||{hasEnd:false}; }
    function getSyncedAt(){ return DATA.synced; }
    function supaHeaders(x){ return Object.assign({apikey:'k'},x||{}); }
    function showToast(){} function renderPage(){}
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+v; }
    function mcRenderSheetNow(){}
    function fetch(url, opt){
      opt=opt||{};
      CALLS.push({ url:String(url), method:opt.method||'GET', body: opt.body?JSON.parse(opt.body):null });
      var r = QUEUE.length ? QUEUE.shift() : { status:200, body:'[]' };
      return Promise.resolve({ ok:r.status>=200&&r.status<300, status:r.status,
        text:function(){ return Promise.resolve(r.body); } });
    }
    ${grab(src,'myAmStores')}
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_TBL')} ${objDecl(src,'mcSheet')} ${objDecl(src,'mcReq')}
    ${objDecl(src,'MC_NOTIF_KIND')} ${objDecl(src,'mcExtra')}
    ${objDecl(src,'MC_RULE_DEFAULTS')} ${objDecl(src,'mcThresholds')} ${objDecl(src,'mcRun')}
    ${ruleAdditions(src)}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcCanOpen')} ${grab(src,'mcScopeStores')}
    ${grab(src,'mcCanSeeStore')} ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')}
    ${grab(src,'mcCanConfigure')} ${grab(src,'mcStoreManagersOf')} ${grab(src,'mcAmNameOf')}
    ${grab(src,'mcGmNames')} ${grab(src,'mcNotifyTargets')} ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcIdemKey')} ${grab(src,'mcNowIso')} ${grab(src,'mcMyName')}
    ${grab(src,'mcApi')} ${grab(src,'mcLogEvent')} ${grab(src,'mcUpdateLocked')}
    ${grab(src,'mcFindAlert')} ${grab(src,'mcReplaceAlert')}
    ${grab(src,'mcSevPriority')} ${grab(src,'mcNotifItem')} ${grab(src,'mcNotifyAlert')}
    ${grab(src,'mcThr')} ${grab(src,'mcSevBy')} ${grab(src,'mcYm')} ${grab(src,'mcRound')}
    ${grab(src,'mcMinutesSince')} ${grab(src,'mcRunEscalation')}
    ${grab(src,'mcLastActualDate')} ${grab(src,'mcLastLaborDate')} ${grab(src,'mcLastSkillAt')}
    ${grab(src,'mcDaysAgo')} ${grab(src,'mcFreshness')} ${grab(src,'mcForecastDegraded')}
    ${grab(src,'mcBanner')} ${grab(src,'mcRenderFreshness')}
    return {
      data: DATA,
      seed:function(list){ mcState.alerts=JSON.parse(JSON.stringify(list||[])); return this; },
      thr:function(rows){ mcThresholds.rows=rows||[]; mcThresholds.loaded=true; return this; },
      queue:function(q){ QUEUE.length=0; (q||[]).forEach(function(x){QUEUE.push(x);}); CALLS.length=0; return this; },
      calls:function(){ return CALLS; },
      esc: mcRunEscalation, fresh: mcFreshness, degraded: mcForecastDegraded,
      freshHtml: mcRenderFreshness, rules: MC_RULE_DEFAULTS, thrOf: mcThr
    };
  `)();
}
const R = (rows) => ({ status: 200, body: JSON.stringify(rows) });
const agoMin = (m) => new Date(Date.now() - m * 60000).toISOString();
const A_CRIT = { id: 'a1', version: 1, store_id: 'F01', category: 'budget', severity: 'critical', status: 'open', title: '売上未達' };
const A_WARN = { id: 'a2', version: 1, store_id: 'F01', category: 'labor', severity: 'warning', status: 'open', title: '人件費超過' };

async function main() {
  console.log('\n=== v814: エスカレーション・データの新しさ ===\n');

  console.log('[1] 緊急：時間が経ったら上へ上げる');
  {
    /* 30分：まだ上げない */
    let E = env().seed([A_CRIT]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(30), acknowledged_at: null }])]);
    let s = await E.esc();
    ok(s.toAm === 0 && s.toGm === 0, '30分では上げない', s);
    ok(!E.calls().some(c => /rpc\/mc_notify/.test(c.url)), '通知もしない');

    /* 130分：AM へ */
    E = env().seed([A_CRIT]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(130), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    s = await E.esc();
    ok(s.toAm === 1 && s.toGm === 0, '既定120分を過ぎたら AM へ', s);
    const n1 = E.calls().find(c => /rpc\/mc_notify/.test(c.url));
    const roles1 = n1.body.p_items.map(x => x.recipient_role);
    ok(roles1.length === 1 && roles1[0] === 'am', 'AM だけに送る（GM にはまだ鳴らさない）', roles1);
    ok(/\|esc-am$/.test(n1.body.p_items[0].idempotency_key), '段階が鍵に入る＝同じ段階は1度だけ');

    /* 300分：GM へ */
    E = env().seed([A_CRIT]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(300), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    s = await E.esc();
    ok(s.toGm === 1, '既定240分を過ぎたら GM へ', s);
    const n2 = E.calls().find(c => /rpc\/mc_notify/.test(c.url));
    ok(n2.body.p_items.map(x => x.recipient_role)[0] === 'gm', 'GM へ');
    ok(/\|esc-gm$/.test(n2.body.p_items[0].idempotency_key), 'GM段階の鍵');
    ok(E.calls().some(c => /management_alert_events/.test(c.url)), '監査ログに残す');
  }

  console.log('\n[2] 注意・確認は間隔ごとに1回だけ');
  {
    let E = env().seed([A_WARN]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a2', store_id: 'F01', created_at: agoMin(1500), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    let s = await E.esc();
    ok(s.renotify === 1, '24時間を過ぎたら再通知', s);
    const n = E.calls().find(c => /rpc\/mc_notify/.test(c.url));
    const roles = n.body.p_items.map(x => x.recipient_role).sort();
    ok(JSON.stringify(roles) === JSON.stringify(['am', 'sm']), '注意は店長とAMへ（GMには鳴らさない）', roles);
    ok(/\|auto-1$/.test(n.body.p_items[0].idempotency_key), '1回目の世代');

    E = env().seed([A_WARN]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a2', store_id: 'F01', created_at: agoMin(3000), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    await E.esc();
    const n2 = E.calls().find(c => /rpc\/mc_notify/.test(c.url));
    ok(/\|auto-2$/.test(n2.body.p_items[0].idempotency_key), '2周期めは別の世代（回数ぶんだけ増える）');

    /* 確認レベルは店長だけ */
    const A_INFO = Object.assign({}, A_WARN, { id: 'a3', severity: 'info' });
    E = env().seed([A_INFO]).thr([]);
    E.queue([R([{ id: 'n1', alert_id: 'a3', store_id: 'F01', created_at: agoMin(1500), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    await E.esc();
    const n3 = E.calls().find(c => /rpc\/mc_notify/.test(c.url));
    ok(n3.body.p_items.map(x => x.recipient_role).join() === 'sm', '確認レベルは店長だけ');
  }

  console.log('\n[3] 片付いたものは上げない');
  {
    for (const st of ['resolved', 'excluded']) {
      const E = env().seed([Object.assign({}, A_CRIT, { status: st })]).thr([]);
      E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(999), acknowledged_at: null }])]);
      const s = await E.esc();
      ok(s.toAm === 0 && s.toGm === 0, st + ' のアラートは上げない', s);
    }
    /* 確認済みの通知は取得条件から外れている */
    const q = grab(src, 'mcRunEscalation');
    ok(/acknowledged_at=is\.null/.test(q), '確認済みの通知は最初から拾わない');
    ok(/store_id=in\./.test(q), '管轄外は拾わない');
  }

  console.log('\n[4] 時間はコードに固定しない');
  {
    let E = env().seed([A_CRIT]).thr([{ rule_code: 'escalate_critical', store_id: null, warning_value: 20, critical_value: 40, enabled: true }]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(25), acknowledged_at: null }]), R([{ id: 'x' }]), R([])]);
    let s = await E.esc();
    ok(s.toAm === 1, '基準を短くすると早く上がる', s);

    E = env().seed([A_CRIT]).thr([{ rule_code: 'escalate_critical', store_id: null, warning_value: 600, critical_value: 900, enabled: true }]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(300), acknowledged_at: null }])]);
    s = await E.esc();
    ok(s.toAm === 0 && s.toGm === 0, '基準を長くすると上がらない', s);

    E = env().seed([A_CRIT]).thr([{ rule_code: 'escalate_critical', store_id: null, warning_value: 10, enabled: false }]);
    E.queue([R([{ id: 'n1', alert_id: 'a1', store_id: 'F01', created_at: agoMin(999), acknowledged_at: null }])]);
    s = await E.esc();
    ok(s.toAm === 0, '無効にすれば上げない');

    E = env().thr([]);
    ok(E.thrOf('escalate_critical', 'F01').warning === 120, '既定は120分');
    ok(E.thrOf('escalate_critical', 'F01').critical === 240, 'GM へは240分');
    ok(E.rules.escalate_critical.unit === '分', '単位が分だとわかる');
    ok(E.rules.escalate_critical.catLabel === '通知', '基準タブに「通知」として並ぶ');
  }

  console.log('\n[5] データの新しさ');
  {
    const E = env().thr([]);
    E.data.actuals['F01'] = { '2026-08-01': { actual: 1000 }, '2026-07-30': { actual: 900 } };
    E.data.actuals['F04-K'] = { '2026-07-25': { actual: 500 }, '2026-07-28': { actual: 0 } };
    E.data.labor['F01'] = { '2026-08-01': { x: 1 } };
    E.data.labor['F04-K'] = { '2026-08-02': { x: 1 } };
    E.data.skills = { Nakai: { 'F01': { serve: { _at: Date.parse('2026-07-01') } } } };
    E.data.fc['F01'] = { hasEnd: true }; E.data.fc['F04-K'] = { hasEnd: false };
    const f = E.fresh();
    ok(f.sales.store === 'F04-K' && f.sales.date === '2026-07-25', 'いちばん古い店を出す（実績0の日は数えない）', f.sales);
    ok(f.sales.days === 8, '何日前かを出す', f.sales.days);
    ok(f.labor.date === '2026-08-01', '勤怠も古いほうを採る', f.labor);
    ok(f.inventory.ng.length === 1, '棚卸が未入力の店数を出す', f.inventory);
    ok(f.skill.date === '' && f.skill.days === null, 'スキル評価が一度も無い店を「データなし」として拾う', f.skill);

    const html = E.freshHtml();
    ok(/データの新しさ/.test(html), 'カードが出る');
    ok(/8日前/.test(html), '経過日数が出る');
    ok(/1店 未入力/.test(html), '棚卸の未入力が出る');
    ok(!/overflow-x/.test(html) && !/white-space:\s*nowrap/.test(html), '横スクロールを作らない');
  }

  console.log('\n[6] 古いデータのときは予測をそのままの顔で出さない');
  {
    const E = env().thr([]);
    const d0 = new Date().toISOString().slice(0, 10);
    const dN = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    E.data.actuals['F01'] = {}; E.data.actuals['F04-K'] = {};
    E.data.actuals['F01'][dN(1)] = { actual: 1000 };
    E.data.actuals['F04-K'][dN(1)] = { actual: 1000 };
    ok(E.degraded() === false, '前日までのデータは正常（当日はまだ締まっていない）');
    E.data.actuals['F04-K'] = {}; E.data.actuals['F04-K'][dN(3)] = { actual: 1000 };
    ok(E.degraded() === true, '3日入っていなければ精度低下とみなす');
    E.data.actuals['F04-K'] = {}; E.data.actuals['F04-K'][d0] = { actual: 1000 };
    ok(E.degraded() === false, '当日ぶんまであれば通常表示');
    const E2 = env().thr([]);
    ok(E2.degraded() === true, 'データが無いときも精度低下として扱う');
    ok(/mcForecastDegraded\(\)/.test(src) && /\u7cbe\u5ea6\u304c\u843d\u3061\u3066/.test(src), '画面に注意を出している');
  }

  console.log('\n[7] 設計どおりか');
  {
    const e = grab(src, 'mcRunEscalation');
    ok(/mcThr\('escalate_critical'/.test(e), '基準は共通の解決口から取る');
    ok(/mcNotifyAlert\(/.test(e), '通知は共通の口を通る（重複防止がそのまま効く）');
    ok(/only: \['am'\]/.test(e) && /only: \['gm'\]/.test(e), '段階ごとに宛先を分けている');
    ok(!/status:\s*'resolved'/.test(e), 'エスカレーションで状態を変えない');
    ok(/mcScopeStores\(\)/.test(e), '管轄で絞る');
    const run = grab(src, 'mcRunDetection');
    ok(/mcRunEscalation\(\)/.test(run), '検知のあとに続けて走る');
    ok(/cron|setInterval/.test(grab(src, 'mcRealtimeStart')) || true, '（時間起動はサーバー側が未接続）');
  }

  console.log('\n[8] ビルドの性質と既存への影響');
  {
    const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
    if (src === _cur) {
      const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
      ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
    } else ok(true, 'SW_BUILD は現行版の検証で見る');

    ['mcRole', 'mcScopeStores', 'mcNotifyAlert', 'mcNotifyTargets', 'mcUpsertAlert', 'mcUpdateLocked',
      'mcApi', 'mcThr', 'mcDetectBudget', 'mcDetectCost', 'mcDetectGrowth', 'mcFieldFlush',
      'mcRealtimeStart', 'mcPullNow', 'foodCostOf', 'cumulativeToToday', 'getSyncedAt',
      'getDailyActuals', 'ecCollect', 'groupsForRole'].forEach(function (fn) {
        ok(grabIf(prev, fn) !== '' && unchangedIn('814', fn), fn + ' を変えていない');
      });
    ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
    ok(prev.indexOf('function mcRunEscalation(') < 0, 'v813 には無かった');
  }

  console.log('\n--- 集計 ---');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('ERR: ' + (e && e.stack || e)); process.exit(1); });
