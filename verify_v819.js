/* verify_v819.js — 再検知のたびの書き込みと監査ログを減らす
   実運用の記録で「毎回 43件更新／通知0」になっていた。
   中身は何も変わっていないのに、43行の PATCH と 43行の監査ログが出ていた。

   守るのは4つ。
   ① 手元にあるものは読み直さない（POST→409→GET の往復をなくす）
   ② 中身が変わっていなければ書き込まない
   ③ 監査ログは変わったときだけ（本当の操作履歴が埋もれない）
   ④ ただし最終検知が古くなったら触る／重要度が上がれば必ず反映する */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v819_backup.html')
  ? fs.readFileSync('index_v819_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v818_backup.html', 'utf8');
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

function env() {
  return new Function(`
    var curRole='gm', curRealRole='gm', curUserName='Moto', curStore='ALL', curStoreLogin=false, curPage='mgmt_ctrl';
    var SUPABASE_URL='https://x.test';
    var ROLE_CONFIG={gm:{name:'Moto'}};
    var CALLS=[], QUEUE=[];
    function supaHeaders(x){ return Object.assign({apikey:'k'},x||{}); }
    function fetch(url, opt){
      opt=opt||{};
      CALLS.push({ url:String(url), method:opt.method||'GET', body: opt.body?JSON.parse(opt.body):null });
      var r = QUEUE.length ? QUEUE.shift() : { status:200, body:'[]' };
      return Promise.resolve({ ok:r.status>=200&&r.status<300, status:r.status, text:function(){ return Promise.resolve(r.body); } });
    }
    ${objDecl(src,'MC_SEV')} ${objDecl(src,'MC_TBL')} ${objDecl(src,'mcState')}
    var MC_TOUCH_MIN = ${(src.match(/MC_TOUCH_MIN\s*=\s*(\d+)/) || [, '180'])[1]};
    ${grab(src,'mcNowIso')} ${grab(src,'mcMyName')}
    ${grab(src,'mcApi')} ${grab(src,'mcLogEvent')} ${grab(src,'mcUpdateLocked')}
    ${grab(src,'mcFindAlert')} ${grab(src,'mcReplaceAlert')}
    ${grab(src,'mcAlertChanged')} ${grab(src,'mcUpsertAlert')}
    function mcRole(){ return 'gm'; }
    return {
      seed:function(l){ mcState.alerts = JSON.parse(JSON.stringify(l||[])); return this; },
      queue:function(q){ QUEUE.length=0; (q||[]).forEach(function(x){QUEUE.push(x);}); CALLS.length=0; return this; },
      calls:function(){ return CALLS; }, alerts:function(){ return mcState.alerts; },
      upsert: mcUpsertAlert, changed: mcAlertChanged
    };
  `)();
}
const R = (rows) => ({ status: 200, body: JSON.stringify(rows) });
const nowIso = () => new Date().toISOString();
const agoMin = (m) => new Date(Date.now() - m * 60000).toISOString();

const SAVED = {
  id: 'a1', version: 4, dedupe_key: 'labor_rate_over|F01|2026-08', store_id: 'F01',
  category: 'labor', severity: 'warning', status: 'open', title: 'ToriTon：人件費率が目標を 3pt 超えています',
  current_value: 31, target_value: 28, forecast_value: 31, estimated_impact: 3000,
  description: 'd', cause_summary: 'c', recommended_action: 'r',
  last_detected_at: nowIso(), reopen_count: 0,
};
const SAME = {
  rule_code: 'labor_rate_over', dedupe_key: 'labor_rate_over|F01|2026-08', store_id: 'F01',
  category: 'labor', severity: 'warning', title: 'ToriTon：人件費率が目標を 3pt 超えています',
  current_value: 31, target_value: 28, forecast_value: 31, estimated_impact: 3000,
  description: 'd', cause_summary: 'c', recommended_action: 'r',
};

async function main() {
  console.log('\n=== v819: 再検知のたびの書き込みと監査ログを減らす ===\n');

  console.log('[1] 中身が変わっていなければ書き込まない');
  {
    const E = env().seed([SAVED]).queue([]);
    const r = await E.upsert(SAME);
    ok(r.ok && r.mode === 'unchanged', '「変化なし」として返る', r.mode);
    ok(E.calls().length === 0, '通信が0回（これまでは POST→GET→PATCH の3回）', E.calls().length);
    ok(E.alerts()[0].version === 4, 'version が進まない（他端末の編集と競合しない）');
  }

  console.log('\n[2] 監査ログを毎回書かない');
  {
    /* 最終検知が古い＝触るが、中身は同じ → PATCH はするが監査ログは書かない */
    const old = Object.assign({}, SAVED, { last_detected_at: agoMin(60 * 24) });
    const E = env().seed([old]).queue([R([Object.assign({}, old, { version: 5, last_detected_at: nowIso() })])]);
    const r = await E.upsert(SAME);
    ok(r.mode === 'touched', '最終検知だけを更新する', r.mode);
    ok(E.calls().length === 1 && E.calls()[0].method === 'PATCH', 'PATCH は1回だけ');
    ok(!E.calls().some(c => /management_alert_events/.test(c.url)),
      '監査ログを書かない（本当の操作履歴が埋もれない）');
  }

  console.log('\n[3] 変わったときは今までどおり残す');
  {
    const E = env().seed([SAVED]).queue([R([Object.assign({}, SAVED, { version: 5, current_value: 35 })]), R([])]);
    const r = await E.upsert(Object.assign({}, SAME, { current_value: 35, title: 'ToriTon：人件費率が目標を 7pt 超えています' }));
    ok(r.mode === 'updated', '更新として返る', r.mode);
    ok(E.calls().some(c => /management_alert_events/.test(c.url)), '監査ログを書く');
    const ev = E.calls().find(c => /management_alert_events/.test(c.url));
    ok(ev.body[0].event_type === 'redetected', '種別が入る');
    ok(ev.body[0].before_data.current_value === 31 && ev.body[0].after_data.current_value === 35, '前後が残る');
  }

  console.log('\n[4] 変化の見分け方');
  {
    const E = env();
    ok(E.changed(SAVED, SAME) === false, '同じなら変化なし');
    ok(E.changed(SAVED, Object.assign({}, SAME, { severity: 'critical' })) === true, '重要度が変われば変化');
    ok(E.changed(SAVED, Object.assign({}, SAME, { current_value: 31.001 })) === false, '誤差程度は変化と見ない');
    ok(E.changed(SAVED, Object.assign({}, SAME, { current_value: 31.01 })) === true, '意味のある差は変化');
    ok(E.changed(SAVED, Object.assign({}, SAME, { estimated_impact: 3500 })) === true, '影響額が変われば変化');
    ok(E.changed(SAVED, Object.assign({}, SAME, { cause_summary: 'ちがう原因' })) === true, '原因が変われば変化');
    ok(E.changed(SAVED, Object.assign({}, SAME, { description: '9 件' })) === true, '本文が変われば変化（件数の増減）');
    ok(E.changed(null, SAME) === true, '保存済みが無ければ変化');
  }

  console.log('\n[5] 重要度が上がったときは必ず反映する');
  {
    const E = env().seed([SAVED]).queue([R([Object.assign({}, SAVED, { version: 5, severity: 'critical' })]), R([])]);
    const r = await E.upsert(Object.assign({}, SAME, { severity: 'critical' }));
    ok(r.mode === 'updated' && r.severityRaised === true, '重要度上昇として返る（通知の判断材料）', r);
    ok(E.calls().some(c => c.method === 'PATCH' && c.body.severity === 'critical'), '保存もされる');
  }

  console.log('\n[6] 解決済みの再発');
  {
    const done = Object.assign({}, SAVED, { status: 'resolved', resolved_by: 'Moto', reopen_count: 1 });
    const E = env().seed([done]).queue([R([Object.assign({}, done, { version: 5, status: 'open', reopen_count: 2 })]), R([])]);
    const r = await E.upsert(SAME);
    ok(r.mode === 'reopened', '中身が同じでも再オープンする', r.mode);
    const p = E.calls().find(c => c.method === 'PATCH');
    ok(p.body.status === 'open' && p.body.reopen_count === 2, '状態を戻して回数を増やす');
    ok(E.calls().some(c => /management_alert_events/.test(c.url)), '再発は監査ログに残す');
  }

  console.log('\n[7] 手元に無ければ作りにいく（新規は今までどおり）');
  {
    const E = env().seed([]).queue([R([{ id: 'n1', version: 1, store_id: 'F01', dedupe_key: 'k' }]), R([])]);
    const r = await E.upsert(Object.assign({}, SAME, { dedupe_key: 'k' }));
    ok(r.mode === 'created', '新規として作られる');
    ok(E.calls()[0].method === 'POST', 'POST で作る');
    ok(E.alerts().length === 1, '手元にも入る（次回は読み直さない）');
  }

  console.log('\n[8] 競合したら読み直して1回だけやり直す');
  {
    const E = env().seed([Object.assign({}, SAVED, { version: 4 })]).queue([
      R([]),                                                        /* PATCH → 0件＝競合 */
      R([Object.assign({}, SAVED, { version: 9 })]),                /* 最新を読む */
      R([Object.assign({}, SAVED, { version: 10, current_value: 35 })]),  /* やり直し */
      R([]),
    ]);
    const r = await E.upsert(Object.assign({}, SAME, { current_value: 35 }));
    ok(r.ok === true, '最終的に保存できる', r.mode);
    ok(/version=eq\.9/.test(E.calls()[2].url), '最新の version でやり直す', E.calls()[2].url);
    ok(E.calls().filter(c => c.method === 'PATCH').length === 2, 'やり直しは1回だけ（無限に再送しない）');
  }

  console.log('\n[9] 実行記録の数え方');
  {
    const run = grab(src, 'mcRunDetection');
    ok(/mode === 'unchanged'/.test(run), '「変化なし」を更新と数えない');
    ok(/stat\.same/.test(run), '変化なしの件数を持つ');
    ok(/変化なし/.test(run), '実行記録に残す');
    const before = grabIf(prev, 'mcRunDetection');
    ok(!/unchanged/.test(before), '（参考）v818 までは全部「更新」と数えていた');
  }

  console.log('\n[10] 設計どおりか');
  {
    const u = grab(src, 'mcUpsertAlert');
    ok(/mcState\.alerts\.find/.test(u), '手元にあるものを先に使う');
    ok(/if \(changed\) \{/.test(u), '監査ログを条件つきにしている');
    ok(/MC_TOUCH_MIN/.test(u), '最終検知が古いときは触る');
    ok(/mcReplaceAlert\(/.test(u), '手元も最新にする');
    ok(/reopen_count/.test(u), '再発の回数は残す');
    const touch = Number((src.match(/MC_TOUCH_MIN\s*=\s*(\d+)/) || [, '0'])[1]);
    ok(touch >= 60 && touch <= 720, '触る間隔が現実的（分）', touch);
  }

  console.log('\n[11] ビルドの性質と既存への影響');
  {
    const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
    ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
    if (src === _cur) {
      const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
      ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
    } else ok(true, 'SW_BUILD は現行版の検証で見る');

    ['mcRole', 'mcScopeStores', 'mcUpdateLocked', 'mcApi', 'mcLogEvent', 'mcNotifyAlert',
      'mcNotifyTargets', 'mcRunEscalation', 'mcDetectBudget', 'mcDetectCost', 'mcDetectGuests',
      'mcDetectFromErrorCenter', 'mcUnitOf', 'mcVals', 'mcFieldFlush', 'mcSummary',
      'foodCostOf', 'cumulativeToToday', 'groupsForRole'].forEach(function (fn) {
        ok(grabIf(prev, fn) !== '' && unchangedIn('819', fn), fn + ' を変えていない');
      });
    ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
    ok(prev.indexOf('function mcAlertChanged(') < 0, 'v818 には無かった');
    /* 全体を書き換えていないこと（改行の一括変換をしたため念のため） */
    /* 行の多重集合で比べる。位置がずれても数えられる */
    const cnt = new Map();
    src.split('\r\n').forEach(l => cnt.set(l, (cnt.get(l) || 0) + 1));
    const la = prev.split('\r\n');
    let same = 0;
    la.forEach(l => { const c = cnt.get(l) || 0; if (c > 0) { cnt.set(l, c - 1); same++; } });
    ok(same > la.length * 0.995, '前版の行がほぼそのまま残っている（全体を書き換えていない）',
      { 一致行: same, 旧行数: la.length, 消えた行: la.length - same });
  }

  console.log('\n--- 集計 ---');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('ERR: ' + (e && e.stack || e)); process.exit(1); });
