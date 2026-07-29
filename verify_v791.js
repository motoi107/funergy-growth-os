/* verify_v791.js — 月間行動計画の申請内容を承認画面で読めるようにする
   最重要の性質：提出済みの内容が消えない（読み取りしか足していない）。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v790_backup.html', 'utf8');

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

/* 配列定数はソースから取る（テストに写しを持たない） */
function arrDecl(text, name) {
  const a = text.indexOf('var ' + name + ' = [');
  if (a < 0) throw new Error('not found: ' + name);
  let i = text.indexOf('[', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') d++;
    else if (text[j] === ']') { d--; if (d === 0) { end = j; break; } }
  }
  return 'var ' + name + ' = ' + text.slice(i, end + 1) + ';';
}

console.log('\n=== v791: 月間行動計画の申請内容が承認画面で読める ===\n');

/* ---------- 1. 提出済みの内容を書き換える経路を増やしていない ---------- */
console.log('[1] 申請内容を消さない（書き込み経路）');
{
  const keys = ['cc_plans', 'cc_actions', 'hq_goals', 'cc_metrics', 'cc_scores', 'cc_logs'];
  keys.forEach(k => {
    const re = new RegExp("lsSet\\('" + k + "'", 'g');
    const a = (prev.match(re) || []).length, b = (src.match(re) || []).length;
    ok(a === b, k + ' への保存箇所が v790 と同数（' + b + '）', { v790: a, v791: b });
  });
  /* 新規に足した関数の中に書き込みが無い */
  ['ccApprovalDetailHtml', 'ccPullShared', 'ccRefetchNow', 'ccOpenYm'].forEach(fn => {
    const body = grab(src, fn);
    ok(!/lsSet\(|_ccPut|ccSavePlan\(|_lsSet|localStorage\.setItem/.test(body),
      fn + ' は書き込みを一切しない', body.slice(0, 80));
  });
  /* 削除の印を付ける経路も足していない */
  ok(!/_deleted\s*[:=]\s*true/.test(grab(src, 'ccApprovalDetailHtml')), '削除の印を立てない');
}

/* ---------- 2. 取り寄せ（合流）で行が消えない ---------- */
console.log('\n[2] クラウドから取り寄せても提出済みの行が消えない');
{
  const env = new Function(`
    ${grab(src, '_ccMut')}
    ${grab(src, 'mergeCcList')}
    ${grab(src, '_coversCcList')}
    return { merge:mergeCcList, covers:_coversCcList };
  `)();
  const chef = [
    { id: 'ca1', ym: '2026-08', what: '原価表の更新', cat: 'g_cost', _mut: 100 },
    { id: 'ca2', ym: '2026-08', what: 'DOH再点検', cat: 'g_hyg', _mut: 100 },
    { id: 'ca3', ym: '2026-08', what: '新メニュー試作', cat: 'g_dev', _mut: 100 }
  ];
  /* GM端末は空 → 取り寄せでシェフの3件が入る */
  let m = env.merge(chef, []);
  ok(m.length === 3, 'GM端末が空でも、取り寄せでシェフの3件が入る', m.length);

  /* GM端末に別の行がある → どちらも残る */
  m = env.merge(chef, [{ id: 'zz', ym: '2026-08', what: 'GM側の行', _mut: 50 }]);
  ok(m.length === 4, 'GM端末の行とシェフの行が両方残る', m.map(x => x.id));

  /* クラウドに無い行が端末にある → 消えない */
  m = env.merge([chef[0]], [chef[1]]);
  ok(m.length === 2, 'クラウドに無い行を取り寄せで消さない', m.map(x => x.id));

  /* 同じidは _mut の新しい方が勝つ（内容の多さでは決めない） */
  m = env.merge([{ id: 'ca1', what: '古い', _mut: 100 }], [{ id: 'ca1', what: '新しい', _mut: 200 }]);
  ok(m.length === 1 && m[0].what === '新しい', '同じidは新しい方が勝つ', m);
  m = env.merge([{ id: 'ca1', what: '新しい', _mut: 300 }], [{ id: 'ca1', what: '古い', _mut: 100 }]);
  ok(m.length === 1 && m[0].what === '新しい', '向きを逆にしても新しい方が勝つ', m);
}

/* ---------- 3. 申請内容が実際に読める ---------- */
console.log('\n[3] 承認カードに中身が出る');
const pulled = [];
const sb = new Function('pulled', `
  var store={};
  var ccYmShown=null, ccTab='plan', curPage='approval';
  var _lsDeferReq={};
  ${arrDecl(src, 'CC_GROUPS')}
  ${arrDecl(src, 'CC_SPLIT_PREFIXES')}
  function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
  function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); }
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function showToast(){}
  function go(p){ curPage=p; }
  function renderPage(p){ curPage=p; }
  function _lsRequestDeferredPrefix(p){ if(_lsDeferReq['#'+p]) return; _lsDeferReq['#'+p]=1; pulled.push(p); }
  ${grab(src, 'ccAllPlans')}
  ${grab(src, 'ccPlan')}
  ${grab(src, 'ccActions')}
  ${grab(src, 'ccGoals')}
  ${grab(src, 'ccPullShared')}
  ${grab(src, 'ccRefetchNow')}
  ${grab(src, 'ccOpenYm')}
  ${grab(src, 'ccApprovalDetailHtml')}
  return { lsSet:lsSet, ls:ls, store:function(){return store;}, detail:ccApprovalDetailHtml,
           openYm:ccOpenYm, refetch:ccRefetchNow, ym:function(){return ccYmShown;},
           page:function(){return curPage;}, tab:function(){return ccTab;},
           prefixes:CC_SPLIT_PREFIXES, deferKeys:function(){return Object.keys(_lsDeferReq);} };
`)(pulled);

{
  sb.lsSet('cc_plans', {
    '2026-08': { ym: '2026-08', status: '提出済', focus: ['原価率を下げる', '衛生の再教育', ''], submittedBy: 'Chikayoshi Nishihara', submittedAt: '2026-07-25 10:00' }
  });
  sb.lsSet('hq_goals', [
    { id: 'g1', ym: '2026-08', title: '原価率30%以下', priority: '高' },
    { id: 'g2', ym: '2026-07', title: '先月の目標', priority: '中' }
  ]);
  sb.lsSet('cc_actions', [
    { id: 'ca1', ym: '2026-08', cat: 'g_cost', what: '原価表を全店更新', how: '週1で棚卸と突合', due: '2026-08-10', status: '進行中', goalId: 'g1' },
    { id: 'ca2', ym: '2026-08', cat: 'g_hyg', what: 'DOH指摘6件の再点検', note: '前回指摘分' },
    { id: 'ca3', ym: '2026-08', cat: 'g_zzz', what: '区分が未定義の行動' },
    { id: 'ca9', ym: '2026-07', cat: 'g_cost', what: '先月の行動' }
  ]);

  const before = JSON.stringify(sb.store());
  const h = sb.detail({ type: '月間行動計画', ym: '2026-08', from: 'Chikayoshi Nishihara', date: '2026-07-25' });

  ok(JSON.stringify(sb.store()) === before, '表示しても保存内容が1文字も変わらない');
  ok(h.indexOf('2026-08') >= 0, '対象月が出る');
  ok(h.indexOf('原価表を全店更新') >= 0, '行動①が出る');
  ok(h.indexOf('DOH指摘6件の再点検') >= 0, '行動②が出る');
  ok(h.indexOf('区分が未定義の行動') >= 0, '既定の区分に無い行動も消えずに出る');
  ok(h.indexOf('週1で棚卸と突合') >= 0, 'やり方（how）が出る');
  ok(h.indexOf('原価率30%以下') >= 0, '紐づく本部目標の名前が出る');
  ok(h.indexOf('2026-08-10') >= 0, '期限が出る');
  ok(h.indexOf('前回指摘分') >= 0, '補足（note）が出る');
  ok(h.indexOf('原価率を下げる') >= 0 && h.indexOf('衛生の再教育') >= 0, '重点行動が出る');
  ok(h.indexOf('Chikayoshi Nishihara') >= 0, '提出者が出る');
  ok(h.indexOf('行動：</b>3件') >= 0, '対象月の行動だけを数える（3件）', (h.match(/行動：<\/b>\d+件/) || [])[0]);
  ok(h.indexOf('先月の行動') < 0, '別の月の行動は混ざらない');
  ok(h.indexOf('先月の目標') < 0, '別の月の目標は混ざらない');
  ok(h.indexOf('ccOpenYm(\'2026-08\')') >= 0, '「計画を開く」が対象月を指している');
  ok(h.indexOf('ccRefetchNow()') >= 0, '「再取得」ボタンがある');
  ok(pulled.length > 0, '表示のついでに分割データを取りに行く', pulled);
  ok(sb.prefixes.indexOf('spl_cc_actions_') >= 0 && sb.prefixes.indexOf('spl_cc_plans_') >= 0
    && sb.prefixes.indexOf('spl_hq_goals_') >= 0, '取り寄せ対象に計画・目標・行動が入っている', sb.prefixes);
}

/* ---------- 4. 中身が無いときに黙って空白にしない ---------- */
console.log('\n[4] 届いていないときの表示');
{
  const h = sb.detail({ type: '月間行動計画', ym: '2026-12' });
  ok(h.indexOf('届いていません') >= 0, '空欄ではなく理由を出す');
  ok(h.indexOf('再取得') >= 0, 'その場で引き直せる');
  ok(sb.detail({ type: '月間行動計画' }) === '', '対象月が分からない申請では何も出さない（誤表示しない）');
  /* ref しか持たない旧データでも読める */
  const h2 = sb.detail({ type: '月間行動計画', ref: '2026-08' });
  ok(h2.indexOf('原価表を全店更新') >= 0, 'ym が無く ref だけの申請でも中身が出る');
}

/* ---------- 5. 表示の安全性 ---------- */
console.log('\n[5] 壊れた入力・危険な文字');
{
  sb.lsSet('cc_plans', { '2026-09': { ym: '2026-09', status: '提出済', focus: ['<img src=x onerror=alert(1)>'] } });
  sb.lsSet('cc_actions', [
    { id: 'x1', ym: '2026-09', cat: 'g_cost', what: '<script>bad()</script>' },
    null,
    { id: 'x2', ym: '2026-09' }
  ]);
  sb.lsSet('hq_goals', []);
  const h = sb.detail({ type: '月間行動計画', ym: '2026-09' });
  ok(h.indexOf('<script>bad()') < 0, 'HTMLがそのまま出ない（エスケープ済み）');
  /* 「onerror=alert」という文字が残るのは正しい。危険なのは山括弧が生で出ること。 */
  ok(h.indexOf('<img') < 0, '重点行動の山括弧が生で出ない（タグとして解釈されない）');
  ok(h.indexOf('&lt;img') >= 0, '重点行動も文字としては読める');
  ok(h.indexOf('&lt;script&gt;') >= 0, '行動名も文字としては読める');
  ok(true, 'null や項目欠けの行があっても落ちない');
}

/* ---------- 6. 他の申請種別に影響しない ---------- */
console.log('\n[6] 他の申請への影響');
{
  const hook = src.slice(src.indexOf("if (a.type==='月間行動計画')") - 200, src.indexOf("if (a.type==='月間行動計画')") + 200);
  ok(/a\.type==='月間行動計画'/.test(hook), '差し込みは月間行動計画に限定されている');
  ok(/try\{[^}]*ccApprovalDetailHtml\(a\)[^}]*\}catch/.test(hook), '例外で承認画面全体が壊れないようにしている');
  /* スキル・予算の表示は v790 と同じ。
     v790 では「html += _approvalChainHtml」が直後だったが v791 で行を挟んだため、
     終端を文字列で決め打ちにせず、括弧の対応でブロックを切り出して比べる。 */
  const skill = s => {
    const a = s.indexOf("if (a.type==='スキル')");
    let i = s.indexOf('{', a), d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') d++;
      else if (s[j] === '}') { d--; if (d === 0) return s.slice(a, j + 1); }
    }
    throw new Error('skill block not closed');
  };
  ok(skill(prev) === skill(src), 'スキル申請の表示は1文字も変えていない');
  const budget = s => s.slice(s.indexOf('var isBudget'), s.indexOf('var isBudget') + 120);
  ok(budget(prev) === budget(src), '予算申請の判定は変えていない');
}

/* ---------- 7. 入口 ---------- */
console.log('\n[7] 入口と遷移');
{
  ok(prev.indexOf('ccApprovalDetailHtml') < 0, 'v790 には無かった');
  sb.openYm('2026-08');
  ok(sb.ym() === '2026-08', '「計画を開く」で提出月に切り替わる', sb.ym());
  ok(sb.page() === 'cc_plan', '月間行動計画のページへ移動する', sb.page());
  ok(sb.tab() === 'plan', '行動計画タブが開く', sb.tab());
  ok(/ccPullShared\(\)/.test(grab(src, 'renderCcPlan').slice(0, 400)), 'ページを開いたときも取り寄せる');
  /* 再取得は印を消してから引き直す */
  const n0 = pulled.length;
  sb.refetch();
  ok(pulled.length > n0, '「再取得」でもう一度取りに行く', { before: n0, after: pulled.length });
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
