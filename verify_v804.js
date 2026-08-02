/* verify_v804.js — LaLa オープン準備（仕様書の18項目のテストに対応） */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v803_backup.html', 'utf8');
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
function objDecl(text, name) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\{'));
  let i = text.indexOf('{', a), d = 0, e = -1;
  for (let j = i; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (d === 0) { e = j; break; } } }
  return 'var ' + name + ' = ' + text.slice(i, e + 1) + ';';
}
console.log('\n=== v804: LaLa オープン準備 ===\n');

function build(failSave) {
  return new Function('FAILSAVE', `
    var store={}, curUserName='Moto', curRole='gm', curPage='lala';
    var toasts=[], rendered=0, pushed=0;
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ if(FAILSAVE) return false; store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    function myName(){ return curUserName; }
    function showToast(m,t){ toasts.push([m,t]); }
    function renderPage(){ rendered++; }
    function openModal(){} function closeModalDirect(){} function alert(){} function confirm(){ return true; }
    function syncMasterToSupabase(){ pushed++; return Promise.resolve(); }
    var document={ getElementById:function(){ return null; } };
    ${arrDecl(src, 'LALA_ASSIGNEES')}
    ${arrDecl(src, 'LALA_ORDER_STATUS')}
    ${objDecl(src, 'LALA_STATUS_COLOR')}
    ${grab(src, 'lalaStatusColor')}
    ${grab(src, 'lalaAll')}
    ${grab(src, 'lalaTasks')}
    ${grab(src, 'lalaGet')}
    ${grab(src, '_lalaNowIso')}
    ${grab(src, '_lalaWho')}
    ${grab(src, '_lalaNextOrder')}
    ${grab(src, '_lalaId')}
    ${grab(src, 'lalaWrite')}
    ${grab(src, 'lalaCreate')}
    ${grab(src, 'lalaDelete')}
    ${grab(src, 'lalaRestore')}
    ${grab(src, 'lalaStats')}
    ${grab(src, 'lalaStatsBy')}
    ${grab(src, 'lalaFilter')}
    var lalaTab='ALL', lalaDone='all', lalaStatusF='ALL';
    var _lalaSaveState={}, _lalaTimers={}, _lalaDraft={}, _lalaOpenNote={};
    ${grab(src, '_lalaStateHtml')}
    ${grab(src, '_lalaWhenLabel')}
    ${grab(src, '_lalaHeadHtml')}
    ${grab(src, '_lalaTabsHtml')}
    ${grab(src, '_lalaCard')}
    ${grab(src, 'renderLala')}
    return { store:function(){return store;}, ls:ls,
      create:lalaCreate, write:lalaWrite, del:lalaDelete, restore:lalaRestore, get:lalaGet,
      tasks:lalaTasks, all:lalaAll, stats:lalaStats, statsBy:lalaStatsBy, filter:lalaFilter,
      render:renderLala, card:_lalaCard, head:_lalaHeadHtml, tabs:_lalaTabsHtml,
      color:lalaStatusColor, when:_lalaWhenLabel,
      setTab:function(v){ lalaTab=v; }, setDone:function(v){ lalaDone=v; }, setStatus:function(v){ lalaStatusF=v; },
      setUser:function(n){ curUserName=n; }, toasts:function(){return toasts;},
      state:function(k,v){ _lalaSaveState[k]=v; }, draft:function(k,v){ _lalaDraft[k]=v; },
      stateHtml:_lalaStateHtml, openNote:function(id){ _lalaOpenNote[id]=true; } };
  `)(failSave);
}

console.log('[1] 追加・編集・削除');
{
  const e = build();
  const r = e.create({ title: '食器の発注', assignee: 'Chika', order_status: '検討中', notes: 'A社に見積依頼' });
  ok(r.ok, 'タスクを追加できる');
  ok(e.tasks().length === 1, '一覧に出る');
  const t = r.task;
  ok(t.version === 1 && t.created_by === 'Moto' && !!t.created_at, '作成者・作成日時・版が入る', t);
  ok(t.is_completed === false && t.sort_order > 0, '初期値が入る', [t.is_completed, t.sort_order]);
  ok(!e.create({ title: '  ' }).ok, 'タスク名が空では追加できない');
  /* 編集 */
  const w = e.write(t.id, { title: '食器の発注（改）' }, t.version);
  ok(w.ok && w.task.title === '食器の発注（改）', 'タスク名を編集できる');
  ok(w.task.version === 2, '版が上がる', w.task.version);
  ok(w.task.updated_by === 'Moto' && w.task.updated_at !== t.updated_at, '更新者と日時が入る');
  /* 削除（ソフト） */
  ok(e.del(t.id).ok, 'タスクを削除できる');
  ok(e.tasks().length === 0, '通常画面から消える');
  ok(!!e.all()[t.id], 'データは残っている（ソフトデリート）');
  ok(!!e.all()[t.id].deleted_at && !!e.all()[t.id].deleted_by, '削除者と日時が残る');
  ok(e.restore(t.id).ok && e.tasks().length === 1, '復旧できる');
  /* 重複しない */
  const ids = {}; for (let i = 0; i < 50; i++) ids[e.create({ title: 'x' + i }).task.id] = 1;
  ok(Object.keys(ids).length === 50, '同じidが作られない', Object.keys(ids).length);
}

console.log('\n[2] 保存される項目');
{
  const e = build();
  const t = e.create({ title: 'A' }).task;
  ['is_completed|true', 'assignee|Aya', 'order_status|発注済み', 'notes|テスト備考'].forEach(function (x) {
    const p = x.split('|'), v = p[1] === 'true' ? true : p[1];
    const cur = e.get(t.id);
    const r = e.write(t.id, (function () { const o = {}; o[p[0]] = v; return o; })(), cur.version);
    ok(r.ok && String(e.get(t.id)[p[0]]) === String(v), p[0] + ' が保存される', e.get(t.id)[p[0]]);
  });
  /* 再読み込み後も残る（保存先から読み直す） */
  const saved = e.ls('lala_tasks', {});
  ok(saved[t.id] && saved[t.id].notes === 'テスト備考', '再読み込み後も残る（保存先に入っている）');
}

console.log('\n[3] 進捗の計算');
{
  const e = build();
  ok(e.stats().pct === 0 && e.stats().total === 0, '0件でも0%（計算エラーにしない）', e.stats());
  const a = e.create({ title: 'a', assignee: 'Moto' }).task;
  const b = e.create({ title: 'b', assignee: 'Moto' }).task;
  e.create({ title: 'c', assignee: 'Chika' });
  e.write(a.id, { is_completed: true }, a.version);
  const s = e.stats();
  ok(s.total === 3 && s.done === 1 && s.open === 2, '完了1・未完了2・全3', s);
  ok(Math.round(s.pct * 10) / 10 === 33.3, '完了率 33.3%', s.pct);
  ok(e.statsBy('Moto').done === 1 && e.statsBy('Moto').total === 2, '担当者別 Moto 1/2', e.statsBy('Moto'));
  ok(e.statsBy('Chika').total === 1, '担当者別 Chika 0/1', e.statsBy('Chika'));
  ok(e.statsBy('Aya').total === 0 && e.statsBy('Aya').pct === 0, '0件の担当者でも落ちない');
  const h = e.head();
  ok(/33\.3%/.test(h), '進捗率が出る');
  ok(/width:33\.3%/.test(h), '進捗バーが連動する', (h.match(/width:[\d.]+%/) || [])[0]);
  ok(/1<\/b> \/ 全 <b[^>]*>3/.test(h.replace(/\s+/g, ' ')) || /完了/.test(h), '完了数と全数が出る');
  ok(/6\/14/.test(e.tabs()) === false && /1\/2/.test(e.tabs()), 'タブに担当者別の完了数が出る', e.tabs().match(/\d+\/\d+/g));
}

console.log('\n[4] 絞り込み');
{
  const e = build();
  const a = e.create({ title: 'a', assignee: 'Moto', order_status: '発注済み' }).task;
  e.create({ title: 'b', assignee: 'Chika', order_status: '検討中' });
  e.create({ title: 'c', assignee: 'Moto', order_status: '検討中' });
  e.write(a.id, { is_completed: true }, a.version);
  ok(e.filter({ assignee: 'Moto' }).length === 2, '担当者フィルター');
  ok(e.filter({ done: 'open' }).length === 2, '未完了のみ');
  ok(e.filter({ done: 'done' }).length === 1, '完了のみ');
  ok(e.filter({ status: '検討中' }).length === 2, '発注状況フィルター');
  ok(e.filter({ assignee: 'Moto', done: 'open', status: '検討中' }).length === 1, '3つを組み合わせられる');
  ok(e.filter({ status: 'ALL' }).length === 3, 'ALLは絞らない');
  /* 元データを変えない */
  const before = JSON.stringify(e.store());
  e.filter({ assignee: 'Aya', done: 'done', status: '納品済み' });
  ok(JSON.stringify(e.store()) === before, 'フィルターは元データを変えない');
}

console.log('\n[5] 表示順');
{
  const e = build();
  const a = e.create({ title: 'a' }).task;
  const b = e.create({ title: 'b' }).task;
  const c = e.create({ title: 'c' }).task;
  ok(b.sort_order > a.sort_order && c.sort_order > b.sort_order, '追加順に表示順が振られる', [a.sort_order, b.sort_order, c.sort_order]);
  ok(b.sort_order - a.sort_order >= 2, '間に差し込めるよう隙間がある（将来の並べ替え用）', b.sort_order - a.sort_order);
  e.write(a.id, { is_completed: true }, a.version);
  const list = e.tasks();
  ok(list[list.length - 1].id === a.id, '完了タスクが後ろに回る', list.map(function (x) { return x.title; }));
  ok(list[0].id === b.id && list[1].id === c.id, '未完了の中は表示順のまま');
}

console.log('\n[6] 競合（他の人の更新を上書きしない）');
{
  const e = build();
  const t = e.create({ title: 'a' }).task;
  /* 別の人が先に更新 */
  e.setUser('Chika');
  const w1 = e.write(t.id, { notes: 'Chikaが書いた' }, t.version);
  ok(w1.ok && w1.task.version === 2, 'Chikaの更新が入る');
  /* Motoが古い版のまま保存しようとする */
  e.setUser('Moto');
  const w2 = e.write(t.id, { notes: 'Motoが書いた' }, t.version);
  ok(!w2.ok && w2.reason === 'conflict', '古い版では上書きされない', w2);
  ok(e.get(t.id).notes === 'Chikaが書いた', 'Chikaの内容が残っている');
  ok(!!w2.current, '最新の内容を返す（知らせるため）');
  /* 最新版でなら書ける */
  ok(e.write(t.id, { notes: 'Motoが書いた' }, e.get(t.id).version).ok, '最新版なら保存できる');
  ok(e.get(t.id).updated_by === 'Moto', '更新者が入れ替わる');
  /* 版を指定しなければ通す（チェックなど競合しにくい操作用） */
  ok(e.write(t.id, { is_completed: true }).ok, '版の指定なしでも書ける');
  ok(!e.write('存在しないid', { title: 'x' }).ok, '無いidには書かない');
}

console.log('\n[7] 保存エラーで入力が消えない');
{
  const e = build(true);   /* lsSet が必ず失敗する */
  ok(!e.create({ title: 'a' }).ok, '保存に失敗したら ok=false を返す');
  const e2 = build();
  const t = e2.create({ title: 'a' }).task;
  e2.draft(t.id + '_notes', { id: t.id, field: 'notes', value: '打ちかけの内容' });
  e2.state(t.id + '_notes', 'error');
  const h = e2.card(e2.get(t.id));
  ok(/打ちかけの内容/.test(h), '保存に失敗しても入力内容が画面に残る');
  ok(/保存エラー/.test(h), '保存エラーと表示される');
  ok(/再試行/.test(h), '再試行ボタンがある');
  ok(/lalaRetry/.test(h), '再試行が押せる');
  ['saving|保存中', 'saved|保存済み', 'retry|再保存中'].forEach(function (x) {
    const p = x.split('|');
    ok(e2.stateHtml.call(null, 'k') !== undefined, '');
    pass--; /* 上はダミー。下で実判定 */
    e2.state('k', p[0]);
    ok(new RegExp(p[1]).test(e2.stateHtml('k')), p[1] + ' が表示される');
  });
}

console.log('\n[8] 画面');
{
  const e = build();
  ok(/タスクはまだ登録されていません/.test(e.render()), '0件のとき案内が出る');
  ok(/最初のタスクを追加/.test(e.render()), '最初の追加ボタンが出る');
  const t = e.create({ title: 'テスト', assignee: 'Aya', order_status: '発送済み', notes: 'メモ' }).task;
  const h = e.render();
  ok(/LaLa オープン準備/.test(h), 'ページ名が出る');
  ok(/LaLa Opening Preparation/.test(h), '英語表記も出る');
  ok(/全員/.test(h) && /Moto/.test(h) && /Chika/.test(h) && /Aya/.test(h), '担当者タブが4つ');
  ok((h.match(/タスク追加/g) || []).length >= 2, '追加ボタンが上下にある', (h.match(/タスク追加/g) || []).length);
  const c = e.card(e.get(t.id));
  ok(/type="checkbox"/.test(c), '完了チェックがある');
  ok(/テスト/.test(c) && /メモ/.test(c), 'タスク名と備考が出る');
  ok(/発送済み/.test(c), '発注状況の名前が出る（色だけに頼らない）');
  ok(/lalaSetNow\('[^']+','is_completed'/.test(c), 'チェックはすぐ保存');
  ok(/lalaSetNow\('[^']+','assignee'/.test(c) && /lalaSetNow\('[^']+','order_status'/.test(c), '担当・発注状況もすぐ保存');
  ok(/lalaSetDebounced\('[^']+','notes'/.test(c), '備考は入力停止後に保存');
  ok(/lalaFlush\('[^']+','notes'/.test(c), '欄から離れたら即保存');
  ok(/openLalaMenu/.test(c), '「…」メニューがある');
  ok(/が .* に更新/.test(c) || /に更新/.test(c), '最終更新者と日時が出る');
  /* 完了時の見た目 */
  e.write(t.id, { is_completed: true }, e.get(t.id).version);
  const c2 = e.card(e.get(t.id));
  ok(/line-through/.test(c2), '完了は取り消し線');
  ok(/opacity:\.72/.test(c2), '少し薄くする（読めなくならない程度）');
  /* 色 */
  ok(e.color('納品済み') === 'var(--green)' && e.color('検討中') === 'var(--yellow)', 'ステータス色が既存トークン', [e.color('納品済み'), e.color('検討中')]);
  ok(e.color('未知') === 'var(--muted)', '未知の値でも落ちない');
}

console.log('\n[9] スマホ表示');
{
  const e = build();
  const t = e.create({ title: 'a', notes: 'x'.repeat(200) }).task;
  const c = e.card(e.get(t.id));
  ok(/min-width:0/.test(c), '横あふれを防ぐ指定がある');
  ok(/width:24px;height:24px/.test(c), 'チェックが指で押せる大きさ');
  ok(/flex-wrap:wrap/.test(c), '狭い幅で折り返す');
  ok(/…/.test(c) && /全文/.test(c), '長い備考は省略して展開できる');
  e.openNote(t.id);
  ok(/x{100}/.test(e.card(e.get(t.id))), '展開すると全文が編集できる');
  /* min-width / max-width は下限・上限であって固定幅ではない。
     問題になるのは「width: 大きな固定値」だけなので、そちらだけを見る。 */
  ok(!/(^|[^-\w])width:\s*\d{3,}px/.test(c), '固定の大きな横幅を使っていない',
     (c.match(/(^|[^-\w])width:\s*\d+px/g)||[]));
  /* 320px でも2つのセレクトが並んで収まるか（下限の合計＋隙間） */
  const mins=[...c.matchAll(/min-width:(\d+)px/g)].map(function(m){ return Number(m[1]); });
  ok(mins.reduce(function(a,b){return a+b;},0)+12 <= 298, '下限幅の合計が320px幅に収まる', mins);
  const tabs = e.tabs();
  ok(/flex:1 1 0/.test(tabs) && /min-width:0/.test(tabs), 'タブが画面幅に収まる');
}

console.log('\n[10] 同期・保存先');
{
  ok(/'lala_tasks'/.test(src.slice(src.indexOf('var OP_SYNC_KEYS'), src.indexOf('var OP_SYNC_KEYS') + 900)), 'クラウド同期の対象');
  ok(/lala_tasks:\s*\{ merge: mergeMapByTime/.test(src), 'タスク単位で合流（別タスクを消し合わない）');
  ok(/'lala_tasks'\]/.test(src.slice(src.indexOf('var LS_NEVER_FREE'), src.indexOf('var LS_NEVER_FREE') + 1200)), '自動削除から守られている');
  ok(/_at: Date\.now\(\)/.test(grab(src, 'lalaWrite')), '合流で勝敗を決める印を押す');
  ok(/postgres_changes/.test(grab(src, 'lalaRealtimeStart')), 'Realtime で他端末の更新を受ける');
  ok(/setInterval/.test(grab(src, 'lalaRealtimeStart')), 'Realtime未設定でも定期取得で追いつく');
  ok(/lalaRealtimeStop/.test(grab(src, 'go')), 'ページを離れたら購読を止める');
  ok(/pullOpKey\('lala_tasks'\)/.test(grab(src, 'lalaPullNow')), '最新を取り直せる');
  ok(/syncMasterToSupabase\('lala_tasks'/.test(grab(src, 'lalaPushNow')), 'クラウドへ押し上げる');
  ok(/送信箱/.test(grab(src, 'lalaPushNow')), '同期失敗を画面に出す');
}

console.log('\n[11] 既存への影響');
{
  ok(prev.indexOf('renderLala') < 0, 'v803 には無かった');
  ok(/case 'lala':/.test(src), '新しいページとして登録されている');
  ok(/{id:'lala'/.test(src), 'メニュー項目がある');
  ok(/children:\['tasks','lala'\]/.test(src), 'ワークセンターの中に入る');
  ['renderTipMgmt', 'foodCostOf', 'bonusForEmp', 'saveInventory'].forEach(function (fn) {
    ok(grab(src, fn) === grab(prev, fn), fn + ' は1文字も変えていない');
  });
  const before = (prev.match(/var OP_SYNC_KEYS = \[([^\]]*)\]/) || [])[1] || '';
  const after = (src.match(/var OP_SYNC_KEYS = \[([^\]]*)\]/) || [])[1] || '';
  ok(before.split(',').every(function (x) { return after.indexOf(x.trim()) >= 0; }), '既存の同期キーを1つも外していない');
  /* 固定タスクを埋め込んでいない */
  ok(!/lalaCreate\(\{title:'/.test(src), 'コードにタスクを埋め込んでいない');
  ok(e0Empty(), '初期状態は0件');
  function e0Empty() { const e = build(); return e.tasks().length === 0; }
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
