/* verify_v807.js — Shift Leader の手入力が端末間で消し合わない
   v801 で削除保護に入れたのに合流ルールを用意しておらず、丸ごと上書きされる状態だった。
   $10/回の支給根拠なので実害がある。監査が検出した。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v806_backup.html', 'utf8');
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
function arrDecl(text, name) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\['));
  let i = text.indexOf('[', a), d = 0, e = -1;
  for (let j = i; j < text.length; j++) { if (text[j] === '[') d++; else if (text[j] === ']') { d--; if (d === 0) { e = j; break; } } }
  return 'var ' + name + ' = ' + text.slice(i, e + 1) + ';';
}
console.log('\n=== v807: Shift Leader の手入力を消し合わない ===\n');

console.log('[1] 合流ルールが定義されている');
{
  const om = src.slice(src.indexOf('var OP_MERGE = {'), src.indexOf('var OP_MERGE = {') + 1800);
  ok(/sl_config:\s*\{ merge: mergeStamped/.test(om), 'sl_config に合流ルールがある');
  ok(!/sl_config:/.test(prev.slice(prev.indexOf('var OP_MERGE = {'), prev.indexOf('var OP_MERGE = {') + 1800)),
    'v806 には無かった（丸ごと上書きだった）');
  ok(/sl_manual_'\)===0\) return \{ merge: mergeMapByTime/.test(grab(src, '_opMergeDef')),
    'sl_manual_<店> にも日付単位の合流がある');
  ok(!/sl_manual_/.test(grab(prev, '_opMergeDef')), 'v806 には無かった');
  ok(/_at = Date\.now\(\)/.test(grab(src, 'slManualSet')), '日付ごとに時刻の印を押す');
}

console.log('\n[2] 別の日を登録しても消し合わない');
{
  const env = new Function(`
    ${grab(src, '_recAt')}
    ${grab(src, 'mergeMapByTime')}
    ${grab(src, '_coversMapByTime')}
    return { merge: mergeMapByTime };
  `)();
  /* 端末A：8/5 を登録／クラウド：8/6 が登録済み */
  const cloud = { '2026-08-06': { 'B子': { D: { by: 'AM' } }, _at: 2000 } };
  const local = { '2026-08-05': { 'A太': { L: { by: 'Moto' } } , _at: 1000 } };
  const m = env.merge(cloud, local);
  ok(Object.keys(m).length === 2, '両方の日が残る', Object.keys(m));
  ok(m['2026-08-05']['A太'].L.by === 'Moto', '8/5 の登録が保たれる');
  ok(m['2026-08-06']['B子'].D.by === 'AM', '8/6 の登録も保たれる');
  /* 同じ日は新しい方が勝つ */
  const m2 = env.merge({ '2026-08-05': { v: 'old', _at: 100 } }, { '2026-08-05': { v: 'new', _at: 200 } });
  ok(m2['2026-08-05'].v === 'new', '同じ日は新しい方が勝つ');
  const m3 = env.merge({ '2026-08-05': { v: 'newer', _at: 300 } }, { '2026-08-05': { v: 'old', _at: 100 } });
  ok(m3['2026-08-05'].v === 'newer', '向きを逆にしても新しい方が勝つ');
}

console.log('\n[3] 印を氏名として拾わない（この修正で入り込む穴）');
{
  const EMPS = [{ id: '1', name: 'A太', role: 'crew', grade: 'G1', store: 'F04-K', status: '在籍' }];
  const e = new Function('EMPS', `
    var store={}, curRole='gm', curUserName='Moto';
    var STORES=[{id:'F04-K',name:'Kaimuki'}];
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function _money(n){ return '$'+Math.round(Number(n)||0); }
    function showToast(){} function nowJP(){ return '2026-08-05 10:00'; } function myName(){ return 'Moto'; }
    function getEmployees(){ return EMPS; }
    function empGrade(x){ return (x&&x.grade)||''; }
    function getTipLabor(){ return null; }
    function getTipWindow(){ return {lunchStart:10,lunchEnd:16,dinnerStart:16,dinnerEnd:23}; }
    ${grab(src, 'isoLocalDate')}
    ${grab(src, 'overlapHours')}
    ${arrDecl(src, 'SL_DEFAULT_STORES')}
    ${arrDecl(src, 'SL_DEFAULT_JOBS')}
    ${grab(src, 'slCfg')}
    ${grab(src, 'slJobOf')}
    ${grab(src, 'slIsLeaderJob')}
    ${grab(src, 'slPeriodOfShift')}
    ${grab(src, 'slManualAll')}
    ${grab(src, 'slManualSet')}
    ${grab(src, '_slGrade')}
    ${grab(src, 'slDayRecords')}
    ${grab(src, '_slEachDate')}
    ${grab(src, 'slPeriodSummary')}
    return { set:slManualSet, day:slDayRecords, sum:slPeriodSummary, all:slManualAll, store:function(){return store;} };
  `)(EMPS);
  e.set('F04-K', '2026-08-05', 'A太', 'L', true);
  const raw = e.all('F04-K')['2026-08-05'];
  ok(!!raw._at, '印が押されている', raw._at);
  const r = e.day('F04-K', '2026-08-05');
  ok(r.ok.length === 1, '記録は1件だけ（印を氏名として数えない）', r.ok);
  ok(r.ok[0].name === 'A太', '氏名は A太', r.ok[0]);
  ok(!r.ok.some(function (x) { return x.name === '_at'; }) && !r.ng.some(function (x) { return x.name === '_at'; }),
    '印が対象外リストにも出ない', r.ng);
  const s = e.sum('F04-K', '2026-08-01', '2026-08-15');
  ok(s.rows.length === 1 && s.total === 10, '集計と金額が正しい（$10）', [s.rows.length, s.total]);
  ok(!s.rows.some(function (x) { return x.name === '_at'; }), '集計に印が混ざらない');
  /* 消すと印も消える */
  e.set('F04-K', '2026-08-05', 'A太', 'L', false);
  ok(!e.all('F04-K')['2026-08-05'], '最後の1件を消すと日付ごと消える（印だけ残らない）', e.all('F04-K'));
}

console.log('\n[4] 既存への影響');
{
  ok(grab(src, 'slPeriodSummary') === grab(prev, 'slPeriodSummary'), '集計の処理は変えていない');
  ok(grab(src, 'slCfg') === grab(prev, 'slCfg'), '設定の読み取りも変えていない');
  ok(grab(src, 'renderInvMonthBanner') === grab(prev, 'renderInvMonthBanner'), 'v806 の月表示も変えていない');
  const before = (prev.match(/var OP_MERGE = \{([\s\S]{0,1800})/) || [])[1] || '';
  ['bonus_q', 'growth_karte', 'q_budgets', 'lala_tasks'].forEach(function (k) {
    ok(new RegExp('\\b' + k + ':').test(src.slice(src.indexOf('var OP_MERGE = {'), src.indexOf('var OP_MERGE = {') + 1800)),
      k + ' の合流ルールを外していない');
  });
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
