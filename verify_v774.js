/* ============================================================
   verify_v774.js — 本部目標の設定タブと月への反映

   実関数を index.html（v774）と index_v773_backup.html（v773）から切り出し、
   Node 上で動かして「修正前の症状」を再現する。

     テスト1: 症状再現 … v773 は保存済み設定があると新しい既定指標が永久に現れない
     テスト2: 挙動不変 … 設定が空なら ccScoreView は ccScore と同じものを返す
     テスト3: 反映 … 設定の既定目標が月の目標として解決される
     テスト4: 上書き … 月の目標が入っていれば設定より優先される
     テスト5: 合流 … 既定∪保存（保存が勝つ／論理削除は消えたまま）
     テスト6: 店舗の割り当て … グランドは3店、シーズナルは全店
     テスト7: 凍結 … 承認時に目標を書き込み、以後設定を変えても動かない
     テスト8: 凍結は既存の月目標を壊さない
     テスト9: 必須/任意 … メニュー開発は既定で任意
     テスト10: ccReqGaps … 必須で目標があり行動が無い店を拾う
     テスト11: 画面 … 設定タブの存在と、設定タブで提出ボタンを出さないこと
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v773_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✅ ' + msg); pass++; }
  else { console.log('  ❌ ' + msg); fail++; }
}

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('function', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function grabVar(src, decl, endTok) {
  const i = src.indexOf(decl);
  if (i < 0) return null;
  const j = src.indexOf(endTok, i) + endTok.length;
  return src.slice(i, j);
}

const STORES = [
  { id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' },
  { id: 'F03', name: 'Waikiki Five Star Poke' }, { id: 'F03-G', name: 'Waikiki Garlic Shack' },
  { id: 'F04-K', name: 'Kaimuki' }, { id: 'F04-P', name: 'Piikoi' },
  { id: 'F04-A', name: 'Aiea' }, { id: 'F05', name: 'Marujuu' }
];

function build(src, store) {
  store = store || {};
  const sb = {
    console, Date, Math, Object, Array, String, Number, JSON, isNaN,
    STORES: STORES.slice(),
    _db: store,
    myName: () => 'Chika',
    nowJP: () => '2026-08-01 09:00',
    showToast: () => { },
    renderPage: () => { },
    escapeHtml: (s) => String(s)
  };
  sb.ls = (k, d) => (Object.prototype.hasOwnProperty.call(sb._db, k) ? sb._db[k] : d);
  sb.lsSet = (k, v) => { sb._db[k] = v; return true; };

  let code = '';
  const vars = [
    ['var CC_GROUPS = [', '];'],
    ['var CC_GROUP_CAT = {', '};'],
    ['var CC_CAT_GROUP = {', '};'],
    ['var CC_DEFAULT_METRICS = [', '];']
  ];
  for (const [d, e] of vars) { const t = grabVar(src, d, e); if (t) code += t + '\n'; }
  const fns = ['ccMetrics', '_ccMetricsMap', 'ccPutMetric', 'ccMetricStores', 'ccGroupMetrics',
    '_ccScoreId', 'ccScores', 'ccScore', 'ccPutScore', 'ccActualOf', 'ccCheckRate',
    'ccDefTarget', 'ccScoreView', 'ccFreezeTargets', 'ccReqGaps', 'ccActions'];
  for (const n of fns) { const t = grab(src, n); if (t) code += t + '\n'; }
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return sb;
}

console.log('\n===== テスト1: 症状再現（v773 は保存済み設定があると新しい既定が現れない） =====');
{
  const saved = { m_cost: { id: 'm_cost', grp: 'g_cost', label: '原価率', unit: '%', dir: 'lower', stores: 'ALL', order: 1 } };
  const o = build(OLD, { cc_metrics: JSON.parse(JSON.stringify(saved)) });
  const ids = o.ccMetrics().map(m => m.id);
  ok(ids.length === 1 && ids[0] === 'm_cost', 'v773: 保存済み1件だけになり、既定の指標が消える');
  ok(ids.indexOf('m_g3') < 0, 'v773: 既定にあった m_g3 すら現れない');

  const n = build(SRC, { cc_metrics: JSON.parse(JSON.stringify(saved)) });
  const nids = n.ccMetrics().map(m => m.id);
  ok(nids.indexOf('m_g2') >= 0, 'v774: 新しい既定 m_g2 が現れる');
  ok(nids.indexOf('m_grand') >= 0 && nids.indexOf('m_seasonal') >= 0, 'v774: m_grand / m_seasonal も現れる');
  ok(nids.indexOf('m_cost') >= 0, 'v774: 保存済みの m_cost も残る');
}

console.log('\n===== テスト2: 設定が空なら挙動不変 =====');
{
  const s = build(SRC, {});
  ok(s.ccScoreView('2026-08', 'F01', 'm_cost') === null, '数値も設定も無ければ null（従来と同じ）');
  s._db.cc_scores = [{ id: '2026-08|F01|m_cost', ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: '', actual: 30 }];
  const v = s.ccScoreView('2026-08', 'F01', 'm_cost');
  ok(v && v.actual === 30 && (v.target === '' || v.target == null), '既定が無ければ月の値をそのまま返す');
}

console.log('\n===== テスト3: 設定が月の目標として解決される =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap();
  map.m_cost.targets = { F01: 28, F02: 30 };
  s._db.cc_metrics = map;
  ok(s.ccDefTarget('m_cost', 'F01') === 28, 'ccDefTarget が設定値を返す');
  const v = s.ccScoreView('2026-08', 'F01', 'm_cost');
  ok(v && Number(v.target) === 28, '数値が未入力でも目標 28 が入った状態で返る');
  ok(s.ccScore('2026-08', 'F01', 'm_cost') === null, '元の cc_scores には書き込まない（解決は読み取り時だけ）');
  ok(s.ccDefTarget('m_cost', 'F05') === '', '設定していない店は空のまま');
}

console.log('\n===== テスト4: 月の目標が設定より優先される =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap(); map.m_cost.targets = { F01: 28 }; s._db.cc_metrics = map;
  s._db.cc_scores = [{ id: '2026-08|F01|m_cost', ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 26, actual: '' }];
  ok(Number(s.ccScoreView('2026-08', 'F01', 'm_cost').target) === 26, 'その月だけの上書きが勝つ');
}

console.log('\n===== テスト5: 既定∪保存（保存が勝つ・論理削除は消えたまま） =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap();
  map.m_cost.label = '原価率（改）';
  map.m_theo = Object.assign({}, map.m_theo, { _deleted: true });
  s._db.cc_metrics = map;
  const arr = s.ccMetrics();
  ok(arr.filter(m => m.id === 'm_cost')[0].label === '原価率（改）', '保存した編集が勝つ');
  ok(arr.filter(m => m.id === 'm_theo').length === 0, '論理削除した指標は復活しない');
  ok(arr.filter(m => m.id === 'm_g2').length === 1, '既定の追加分は現れる');
}

console.log('\n===== テスト6: 店舗の割り当て =====');
{
  const s = build(SRC, {});
  const g = s.ccMetrics().filter(m => m.id === 'm_grand')[0];
  const q = s.ccMetrics().filter(m => m.id === 'm_seasonal')[0];
  const gs = s.ccMetricStores(g).map(x => x.id).sort();
  ok(JSON.stringify(gs) === JSON.stringify(['F01', 'F02', 'F05']), 'グランドは ToriTon / Tenkichi / Marujuu');
  ok(s.ccMetricStores(q).length === 8, 'シーズナルは全8店');
  const doh = s.ccMetrics().filter(m => m.id === 'm_doh')[0];
  ok(Object.keys(doh.targets).length === 8 && doh.targets['F03-G'] === 100, 'DOHは全店 100% が既定で入っている');
}

console.log('\n===== テスト7: 承認時の凍結 =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap(); map.m_cost.targets = { F01: 28 }; s._db.cc_metrics = map;
  const n = s.ccFreezeTargets('2026-08');
  ok(n > 0, '凍結で目標が書き込まれる（' + n + '件）');
  const raw = s.ccScore('2026-08', 'F01', 'm_cost');
  ok(raw && Number(raw.target) === 28, 'cc_scores に 28 が実体として入る');

  const map2 = s._ccMetricsMap(); map2.m_cost.targets = { F01: 25 }; s._db.cc_metrics = map2;
  ok(Number(s.ccScoreView('2026-08', 'F01', 'm_cost').target) === 28,
    '設定を 25 に変えても、承認済みの月は 28 のまま動かない');

  const o = build(OLD, {});
  ok(typeof o.ccFreezeTargets !== 'function', 'v773 には凍結が無く、設定変更が過去月へ波及しうる');
}

console.log('\n===== テスト8: 凍結は既存の月目標を壊さない =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap(); map.m_cost.targets = { F01: 28 }; s._db.cc_metrics = map;
  s._db.cc_scores = [{ id: '2026-08|F01|m_cost', ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 26, actual: 31, note: '手入力' }];
  s.ccFreezeTargets('2026-08');
  const raw = s.ccScore('2026-08', 'F01', 'm_cost');
  ok(Number(raw.target) === 26, '既に入っていた目標は上書きしない');
  ok(Number(raw.actual) === 31 && raw.note === '手入力', '実績・メモも保持される');
}

console.log('\n===== テスト9: 必須/任意の既定 =====');
{
  const s = build(SRC, {});
  const by = {}; s.ccMetrics().forEach(m => by[m.id] = m);
  ok(by.m_cost.req === true && by.m_doh.req === true, '原価・衛生は必須');
  ok(by.m_g3.req === true && by.m_g2.req === true, 'G3・G2 は必須');
  ok(!by.m_grand.req && !by.m_seasonal.req, 'メニュー開発は既定で任意（実施月を固定しないため）');
}

console.log('\n===== テスト10: ccReqGaps =====');
{
  const s = build(SRC, {});
  const map = s._ccMetricsMap();
  map.m_cost.targets = { F01: 28, F02: 30 };
  map.m_doh.targets = {}; map.m_g3.targets = {}; map.m_g2.targets = {};
  map.m_grand.targets = { F01: 1 };
  s._db.cc_metrics = map;
  s._db.cc_actions = [{ id: 'a1', ym: '2026-08', cat: 'cost', storeId: 'F01', what: '仕入見直し' }];
  const gaps = s.ccReqGaps('2026-08');
  ok(gaps.some(x => x.indexOf('Tenkichi') === 0), '行動が無い Tenkichi の原価が拾われる');
  ok(!gaps.some(x => x.indexOf('ToriTon／原価率') === 0), '行動がある ToriTon の原価は拾われない');
  ok(!gaps.some(x => x.indexOf('グランド') >= 0), '任意のグランドは目標があっても拾われない');
}

console.log('\n===== テスト11: 画面まわり（静的） =====');
{
  ok(SRC.indexOf("['setting', '設定']") >= 0, 'タブに「設定」がある');
  ok(OLD.indexOf("['setting', '設定']") < 0, 'v773 には無かった');
  ok(SRC.indexOf("if(ccTab === 'setting') return h;") >= 0, '設定タブでは提出・承認ボタンを出さない');
  ok(grab(SRC, 'renderCcSetting') !== null && grab(SRC, 'saveCcSetting') !== null, '設定画面と保存関数がある');
  ok(grab(SRC, 'saveCcSetting').indexOf("if(!ccIsHQ())") >= 0, '設定の保存は本部(GM/CEO)のみ');
  ok((SRC.match(/ccScore\(ym, s\.id, mt\.id\)/g) || []).length === 0,
    '集計・カード・達成判定から生の ccScore 直読みが無くなっている');
  ok(SRC.indexOf('ccFreezeTargets(ym)') >= 0 && SRC.indexOf("_fz === -1") >= 0,
    '承認で凍結し、失敗したら承認を進めない');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
