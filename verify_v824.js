/* verify_v824.js — Head Chef を原価・仕入の担当として通知先に入れる
   Moto さん確認：Head Chef は G4 で、表示は店長と同じ。担当は原価・仕入のみ。
   これまで通知先に一切入っていなかったので、本人には何も届いていなかった。

   守るのは4つ。
   ① 原価・仕入のときだけ Head Chef が宛先に入る
   ② それ以外の分野では入らない
   ③ Head Chef を店長として数えない（判定は今までどおり）
   ④ Head Chef しかいない店舗を「店長未設定」にしない（原価・仕入に限る） */
const fs = require('fs');
const { execFileSync } = require('child_process');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v824_backup.html')
  ? fs.readFileSync('index_v824_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v823_backup.html', 'utf8');
const sql = fs.existsSync('management_control_v815.sql')
  ? fs.readFileSync('management_control_v815.sql', 'utf8') : '';
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

/* F01 = 店長も Head Chef もいる ／ F05 = Head Chef だけ ／ F03-G = どちらもいない */
const STORES_FIX = [
  { id: 'F01', name: 'ToriTon', active: true, am: 'Yuki Nagatani' },
  { id: 'F05', name: 'Marujuu', active: true, am: 'Yuki Nagatani' },
  { id: 'F03-G', name: 'Waikiki Garlic Shack', active: true, am: 'Yuki Nagatani' },
];
const EMPS_FIX = [
  { name: 'Moto', role: 'gm', title: 'General Manager', store: 'F01', status: '在籍' },
  { name: 'Yuki Nagatani', role: 'am', title: 'Area Manager', store: 'F01', status: '在籍' },
  { name: 'Uruma', role: 'g4', title: 'Store Manager', store: 'F01', status: '在籍' },
  { name: 'ChefA', role: 'g4', title: 'Head Chef', store: 'F01', status: '在籍' },
  { name: 'ChefB', role: 'g4', title: 'Head Chef', store: 'F05', status: '在籍' },
  { name: 'ChefOld', role: 'g4', title: 'Head Chef', store: 'F05', status: '退職' },
  { name: 'Marcia Kodama', role: 'office', title: 'Accountant', store: 'F01', status: '在籍' },
  { name: 'Chika', role: 'chef', title: 'Corporate Chef', store: 'F01', status: '在籍' },
];

function env() {
  return new Function(`
    var curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false, curPage='mgmt_ctrl';
    var SUPABASE_URL='https://x.test';
    var ROLE_CONFIG={gm:{name:'Moto'},am:{name:'Yuki Nagatani'},chef:{},g4:{},sl:{},crew:{},ceo:{},office:{},office_crew:{}};
    var STORES=${JSON.stringify(STORES_FIX)}, EMPS=${JSON.stringify(EMPS_FIX)};
    var AM_STORES=[];
    var CALLS=[], QUEUE=[];
    function getStoresAll(){ return STORES; }
    function activeStores(){ return STORES; }
    function getEmployees(){ return EMPS; }
    function myStoreId(){ return 'F01'; }
    function supaHeaders(x){ return Object.assign({apikey:'k'},x||{}); }
    function showToast(){} function renderPage(){} function mcRenderSheetNow(){}
    function escapeHtml(s){ return String(s==null?'':s); }
    function fmtMoney(v){ return '$'+v; }
    function fetch(url, opt){
      opt=opt||{};
      CALLS.push({ url:String(url), method:opt.method||'GET', body: opt.body?JSON.parse(opt.body):null });
      var r = QUEUE.length ? QUEUE.shift() : { status:200, body:'[]' };
      return Promise.resolve({ ok:r.status>=200&&r.status<300, status:r.status, text:function(){ return Promise.resolve(r.body); } });
    }
    ${arrDecl(src,'MC_CATEGORIES')} ${arrDecl(src,'MC_NON_SM_G4_TITLES')}
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_STATUS')} ${objDecl(src,'mcState')}
    ${objDecl(src,'MC_TBL')} ${objDecl(src,'mcSheet')} ${objDecl(src,'mcReq')} ${objDecl(src,'mcExtra')}
    ${objDecl(src,'MC_NOTIF_KIND')}
    ${grab(src,'myAmStores')}
    ${grab(src,'mcEmpActive')} ${grab(src,'mcMe')} ${grab(src,'mcIsStoreManagerEmp')}
    ${grab(src,'mcRole')} ${grab(src,'mcScopeStores')} ${grab(src,'mcCanSeeStore')}
    ${grab(src,'mcCategoryIds')} ${grab(src,'mcCanResolve')} ${grab(src,'mcCanOpen')}
    ${grab(src,'mcStoreManagersOf')} ${grab(src,'mcStoreChefsOf')} ${grab(src,'mcAmNameOf')}
    ${grab(src,'mcGmNames')} ${grab(src,'mcNotifyTargets')}
    ${grab(src,'mcCatLabel')} ${grab(src,'mcStoreLabel')}
    ${grab(src,'mcIdemKey')} ${grab(src,'mcNowIso')} ${grab(src,'mcMyName')}
    ${grab(src,'mcApi')} ${grab(src,'mcLogEvent')} ${grab(src,'mcUpdateLocked')}
    ${grab(src,'mcFindAlert')} ${grab(src,'mcReplaceAlert')} ${grab(src,'mcCanAct')}
    ${grab(src,'mcSevPriority')} ${grab(src,'mcNotifItem')} ${grab(src,'mcNotifyAlert')}
    ${grab(src,'mcRaiseTargetIssues')} ${grab(src,'mcUpsertAlert')}
    ${grab(src,'mcLoadDetailExtras')} ${grab(src,'mcRequestToSm')}
    return {
      targets: mcNotifyTargets, chefs: mcStoreChefsOf, sms: mcStoreManagersOf,
      isSm: mcIsStoreManagerEmp, role: mcRole, canOpen: mcCanOpen,
      login:function(n){ var e=EMPS.find(function(x){return x.name===n;})||{};
        curUserName=n; curRealRole=e.role||''; curRole=({g2:'sl',g4:'am'})[e.role]||e.role||''; return this; },
      seed:function(l){ mcState.alerts=JSON.parse(JSON.stringify(l||[])); return this; },
      queue:function(q){ QUEUE.length=0; (q||[]).forEach(function(x){QUEUE.push(x);}); CALLS.length=0; return this; },
      calls:function(){ return CALLS; },
      notify: mcNotifyAlert, request: mcRequestToSm
    };
  `)();
}
const R = (rows) => ({ status: 200, body: JSON.stringify(rows) });
const ALERT = (cat, store) => ({ id: 'a1', version: 1, store_id: store, category: cat, severity: 'warning', status: 'open', title: 't' });

async function main() {
  console.log('\n=== v824: Head Chef を原価・仕入の担当にする ===\n');
  const E = env();

  console.log('[1] 原価・仕入のときだけ宛先に入る');
  {
    const cost = E.targets('F01', 'cost');
    ok(cost.chef.indexOf('ChefA') >= 0, '原価・仕入では Head Chef が入る', cost.chef);
    ok(cost.sm.indexOf('Uruma') >= 0, '店長も入る（店の責任者のため）');
    ['budget', 'labor', 'growth'].forEach(function (c) {
      ok(E.targets('F01', c).chef.length === 0, c + ' では Head Chef は入らない');
    });
    ok(E.targets('F01').chef.length === 0, '分野を渡さなければ入らない');
  }

  console.log('[2] 有効な人だけ');
  {
    ok(E.chefs('F05').map(function (e) { return e.name; }).join() === 'ChefB', '退職した Head Chef は入らない');
    ok(E.chefs('F03-G').length === 0, 'いない店舗は空');
    ok(E.chefs('F01').every(function (e) { return e.title === 'Head Chef'; }), '肩書きで引いている');
    ok(E.chefs('F01').map(function (e) { return e.name; }).indexOf('Chika') < 0,
      'Corporate Chef（全店）は店舗の Head Chef として数えない');
  }

  console.log('\n[3] Head Chef を店長として数えない（今までどおり）');
  {
    const chef = EMPS_FIX.find(function (e) { return e.name === 'ChefA'; });
    ok(E.isSm(chef) === false, 'Head Chef は店長判定に入らない');
    ok(E.sms('F01').map(function (e) { return e.name; }).join() === 'Uruma', '店長は Uruma だけ');
    ok(E.sms('F05').length === 0, 'Head Chef しかいない店舗に店長はいない');
    ok(E.login('ChefA').role() === 'sm', '画面上の扱いは店長と同じ（Motoさん確認済み）');
    ok(E.login('ChefA').canOpen() === false, '管理統括タブは出ない（店長と同じ）');
    E.login('Moto');
  }

  console.log('\n[4] Head Chef しかいない店舗の扱い');
  {
    const cost = E.targets('F05', 'cost');
    ok(cost.chef.join() === 'ChefB' && cost.sm.length === 0, '原価は Head Chef が受ける', cost);
    ok(cost.issues.indexOf('no_sm') < 0, '「店長未設定」にしない（原価は担当がいるため）', cost.issues);

    const lab = E.targets('F05', 'labor');
    ok(lab.issues.indexOf('no_sm') >= 0, '勤怠は受け手がいないので「店長未設定」', lab.issues);
    ok(lab.am.length === 1 && lab.gm.length === 1, 'AM と GM には届く（破棄しない）');

    const none = E.targets('F03-G', 'cost');
    ok(none.issues.indexOf('no_sm') >= 0, '誰もいなければ原価でも「未設定」', none.issues);
  }

  console.log('\n[5] 実際に通知を作る');
  {
    const E2 = env().login('Moto').seed([]);
    E2.queue([R([{ id: 'n1' }]), R([])]);
    await E2.notify(ALERT('cost', 'F01'), 'new_alert', {});
    const items = E2.calls()[0].body.p_items;
    const roles = items.map(function (x) { return x.recipient_user_id + ':' + x.recipient_role; });
    ok(roles.indexOf('ChefA:chef') >= 0, '原価の通知が Head Chef に届く', roles);
    ok(roles.indexOf('Uruma:sm') >= 0, '店長にも届く');
    ok(roles.length === 4, '店長・Head Chef・AM・GM の4人', roles);

    const E3 = env().login('Moto').seed([]);
    E3.queue([R([{ id: 'n1' }]), R([])]);
    await E3.notify(ALERT('labor', 'F01'), 'new_alert', {});
    const r3 = E3.calls()[0].body.p_items.map(function (x) { return x.recipient_role; });
    ok(r3.indexOf('chef') < 0, '勤怠の通知は Head Chef に届かない', r3);
    ok(r3.length === 3, '店長・AM・GM の3人');
  }

  console.log('\n[6] 対応依頼は原価なら Head Chef へ');
  {
    const E4 = env().login('Moto').seed([ALERT('cost', 'F01')]);
    E4.queue([R([{ id: 'ac1', version: 1, alert_id: 'a1' }]), R([{ id: 'n1' }]), R([]), R([]),
    R([{ id: 'a1', version: 2, store_id: 'F01', category: 'cost', assigned_user_id: 'ChefA' }])]);
    await E4.request('a1', '確認してください');
    ok(E4.calls()[0].body[0].assigned_to === 'ChefA', '原価は Head Chef が担当', E4.calls()[0].body[0].assigned_to);

    const E5 = env().login('Moto').seed([ALERT('labor', 'F01')]);
    E5.queue([R([{ id: 'ac1', version: 1, alert_id: 'a1' }]), R([{ id: 'n1' }]), R([]), R([]),
    R([{ id: 'a1', version: 2, store_id: 'F01', category: 'labor', assigned_user_id: 'Uruma' }])]);
    await E5.request('a1', 'x');
    ok(E5.calls()[0].body[0].assigned_to === 'Uruma', '勤怠は店長が担当', E5.calls()[0].body[0].assigned_to);
  }

  console.log('\n[7] 再通知でも Head Chef を落とさない');
  {
    ok(/array\['sm', 'chef', 'am'\]/.test(sql), '注意の再通知に chef が入っている');
    ok(/array\['sm', 'chef'\]/.test(sql), '確認の再通知にも入っている');
    ok(/既に届いている通知/.test(sql) || /management_notifications mn/.test(sql),
      '宛先は届いた通知から採るので、原価以外で chef が入ることはない');
    let alive = false;
    try {
      execFileSync('bash', ['-lc', 'su postgres -c "psql -h /tmp -p 5433 -d postgres -c \'select 1\'" >/dev/null 2>&1'], { timeout: 15000 });
      alive = true;
    } catch (e) { alive = false; }
    if (!alive) { console.log('  ⏭  PostgreSQL が動いていないため実行を飛ばしました'); ok(true, '構造は確認済み'); }
    else {
      let out = '';
      try {
        out = String(execFileSync('bash', ['-lc',
          'set -e; D=mc824$RANDOM; su postgres -c "createdb -h /tmp -p 5433 $D" >/dev/null 2>&1; ' +
          'for f in management_control_v808.sql management_control_v811.sql management_control_v815.sql; do ' +
          '  cp $f /tmp/_q.sql; chmod 644 /tmp/_q.sql; su postgres -c "psql -h /tmp -p 5433 -d $D -q -f /tmp/_q.sql" >/dev/null 2>&1; done; ' +
          'cp test_mc_escalate.sql /tmp/_r.sql; chmod 644 /tmp/_r.sql; ' +
          'su postgres -c "psql -h /tmp -p 5433 -d $D -v ON_ERROR_STOP=1 -f /tmp/_r.sql" 2>&1; ' +
          'su postgres -c "dropdb -h /tmp -p 5433 $D" >/dev/null 2>&1 || true'], { timeout: 90000 }));
      } catch (e) { out = String((e && (e.stdout || e.message)) || ''); }
      ok(/すべて期待どおり/.test(out) && !/FAIL:/.test(out), 'chef を足してもエスカレーションが壊れていない');
    }
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

    ['mcRole', 'mcIsStoreManagerEmp', 'mcStoreManagersOf', 'mcScopeStores', 'mcCanOpen',
      'mcCanResolve', 'mcCanAct', 'mcUpsertAlert', 'mcRunDetection', 'mcRunEscalation',
      'mcDetectCost', 'mcDetectBudget', 'mcInPeriod', 'mcVals', 'mcHasWorkCenter',
      'renderWorkCenter', 'groupsForRole'].forEach(function (fn) {
        ok(grabIf(prev, fn) !== '' && unchangedIn('824', fn), fn + ' を変えていない');
      });
    ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
    ok(arrDecl(src, 'MC_NON_SM_G4_TITLES').indexOf('Head Chef') >= 0, 'Head Chef を店長から外す設定は残っている');
    ok(prev.indexOf('function mcStoreChefsOf(') < 0, 'v823 には無かった');
    ok(src.indexOf(String.fromCharCode(0x8f96)) < 0, '簡体字の誤字が入っていない');
  }

  console.log('\n--- 集計 ---');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('ERR: ' + (e && e.stack || e)); process.exit(1); });
