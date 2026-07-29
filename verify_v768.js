/* ============================================================
   verify_v768.js — 本部メニューの経理／キッチン分離と、店舗別の共通目標

     テスト1: メニューに出る画面がすべて本部で開ける（取りこぼしゼロ）
     テスト2: 経理側にキッチン専用画面が混ざっていない／その逆も
     テスト3: v767 から画面が消えていない（CEO/GM が失うものが無い）
     テスト4: 指標の対象店舗の絞り込み（業態別）
     テスト5: 達成判定（高いほど良い／低いほど良い）
     テスト6: 数値の合流（同じセルを2端末で編集しても消えない）
     テスト7: 自動削除から守られている
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');
const V767 = fs.readFileSync('index_v767_backup.html', 'utf8');

function grabVar(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('見つかりません: ' + decl);
  const o = decl.indexOf('[') >= 0 ? '[' : '{', c = o === '[' ? ']' : '}';
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === o) { d++; st = true; }
    else if (ch === c) { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}
function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('見つかりません: ' + name);
  let i = src.indexOf('function', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
const pagesOf = (g) => g.reduce((a, x) => a.concat(x.children || []), []);
function menus(src) {
  const parts = ["const OFFICE_GROUPS = [", "const CHEF_GROUPS = [", "var OFFICE_OK_PAGES = ["];
  let code = parts.map(p => grabVar(src, p)).join('\n');
  if (src.indexOf('const ACCT_GROUPS = [') >= 0) code += grabVar(src, 'const ACCT_GROUPS = [');
  else code += 'var ACCT_GROUPS = [];';
  return new Function(code + '\nreturn {O:OFFICE_GROUPS,A:ACCT_GROUPS,C:CHEF_GROUPS,OK:OFFICE_OK_PAGES};')();
}

/* 指標まわりを動かす */
function ccEnv(store) {
  const FNS = ['ccMetrics', '_ccMetricsMap', 'ccPutMetric', 'ccMetricStores',
    '_ccScoreId', 'ccScores', 'ccScore', 'ccPutScore', 'ccScoreOk', '_ccNum',
    '_ccMut', 'mergeCcList', '_coversCcList'];
  const consts = /var CC_DEFAULT_METRICS = \[[\s\S]*?\n\];/.exec(SRC)[0];
  const stores = grabVar(SRC, 'const DEFAULT_STORES = [').replace('const DEFAULT_STORES', 'var STORES');
  return new Function('__store', `
    ${stores}
    function ls(k,d){ return Object.prototype.hasOwnProperty.call(__store,k)?__store[k]:d; }
    function lsSet(k,v){ __store[k]=v; return true; }
    function myName(){ return 'T'; } function nowJP(){ return '2026-07-28 10:00'; }
    function showToast(){}
    ${consts}
    ${FNS.map(n => grab(SRC, n)).join('\n')}
    return { ccMetrics, ccMetricStores, ccScore, ccPutScore, ccScoreOk, _ccScoreId,
             mergeCcList, STORES };`)(store);
}

let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

console.log('\n=== テスト1: メニューの画面がすべて本部で開ける ===');
{
  const e = menus(SRC);
  const all = [...new Set([...pagesOf(e.O), ...pagesOf(e.A), ...pagesOf(e.C)])];
  const bad = all.filter(p => e.OK.indexOf(p) < 0);
  check('弾かれる画面が無い', bad.length === 0, bad.join(',') || `${all.length}画面すべてOK`);
  check('重複した画面がグループ内に無い',
    pagesOf(e.A).length === new Set(pagesOf(e.A)).size &&
    pagesOf(e.O).length === new Set(pagesOf(e.O)).size,
    `経理=${pagesOf(e.A).length} / CEO・GM=${pagesOf(e.O).length}`);
}

console.log('\n=== テスト2: 経理側とキッチン側が混ざっていない ===');
{
  const e = menus(SRC);
  /* 原価率と食材マスターは両側で使う共有画面なので混在判定から外す。
     経理は請求突合と予実で、キッチンは原価管理で必要。 */
  const KITCHEN = ['cc_plan', 'menu', 'recipe', 'fv_variance', 'ing_transfer', 'inventory'];
  const ACCT = ['invoice', 'acct_review', 'acct_export', 'monthly', 'purchase_detail', 'budget', 'labor', 'tip'];
  const acct = pagesOf(e.A), chef = pagesOf(e.C);
  check('経理のメニューにキッチン専用が無い', KITCHEN.every(p => acct.indexOf(p) < 0),
    KITCHEN.filter(p => acct.indexOf(p) >= 0).join(',') || '混在なし');
  check('Chefのメニューに経理専用が無い', ACCT.every(p => chef.indexOf(p) < 0),
    ACCT.filter(p => chef.indexOf(p) >= 0).join(',') || '混在なし');
  check('グループ名で側が分かる',
    e.A.some(g => /経理/.test(g.label)) && e.O.some(g => /Kitchen/.test(g.label)));
  /* v767 では go_home と go_acct の両方に acct_review があった */
  const v7 = menus(V767);
  const dup = pagesOf(v7.O).filter((p, i, a) => a.indexOf(p) !== i);
  check('v767 にあった重複が解消された（症状の再現）', dup.length > 0 && pagesOf(e.O).filter((p, i, a) => a.indexOf(p) !== i).length === 0,
    'v767の重複: ' + (dup.join(',') || 'なし'));
}

console.log('\n=== テスト3: CEO / GM が失う画面が無い ===');
{
  const now = pagesOf(menus(SRC).O), before = pagesOf(menus(V767).O);
  const lost = before.filter(p => now.indexOf(p) < 0);
  const added = now.filter(p => before.indexOf(p) < 0);
  check('v767 から消えた画面が無い', lost.length === 0, lost.join(',') || 'なし');
  check('増えたのは仕入明細だけ', added.join(',') === 'purchase_detail', added.join(',') || 'なし');
}

console.log('\n=== テスト4: 指標の対象店舗（業態別） ===');
{
  const api = ccEnv({});
  const mets = api.ccMetrics();
  check('既定の指標が7つある', mets.length === 7, mets.map(m => m.label).join(' / '));
  const byId = {}; mets.forEach(m => byId[m.id] = m);
  check('原価率は全店', api.ccMetricStores(byId.m_cost).length === api.STORES.length);
  const season = api.ccMetricStores(byId.m_season).map(s => s.id);
  check('シーズナル進捗は居酒屋2店のみ', season.join(',') === 'F01,F02', season.join(','));
  const nm = api.ccMetricStores(byId.m_newmenu).map(s => s.id);
  check('新メニュー開発は Totoya 3店のみ', nm.join(',') === 'F04-K,F04-P,F04-A', nm.join(','));
  check('G3キッチンリーダーに配置の必要性がある', byId.m_g3.needPlace === true);
  check('ご指定の項目が揃っている',
    ['原価率', '理論原価との差異', '衛生', 'フードハンドラー保持', 'G3キッチンリーダー', 'シーズナル進捗', '新メニュー開発']
      .every(l => mets.some(m => m.label === l)));
}

console.log('\n=== テスト5: 達成判定 ===');
{
  const api = ccEnv({});
  const lower = { dir: 'lower' }, higher = { dir: 'higher' };
  check('低いほど良い：目標28で実績27 → 達成', api.ccScoreOk(lower, { target: 28, actual: 27 }) === true);
  check('低いほど良い：目標28で実績30 → 未達', api.ccScoreOk(lower, { target: 28, actual: 30 }) === false);
  check('高いほど良い：目標90で実績95 → 達成', api.ccScoreOk(higher, { target: 90, actual: 95 }) === true);
  check('高いほど良い：目標90で実績80 → 未達', api.ccScoreOk(higher, { target: 90, actual: 80 }) === false);
  check('未入力は判定しない（未達にしない）',
    api.ccScoreOk(higher, { target: 90, actual: '' }) === null && api.ccScoreOk(higher, null) === null);
  check('ちょうど目標どおりは達成', api.ccScoreOk(lower, { target: 28, actual: 28 }) === true);
}

console.log('\n=== テスト6: 数値の合流 ===');
{
  const store = {};
  const api = ccEnv(store);
  const id = api._ccScoreId('2026-08', 'F01', 'm_cost');
  check('セルのidが月・店舗・指標で決まる', id === '2026-08|F01|m_cost', id);

  /* 端末A（目標を入れた）と端末B（実績を入れた）が別々に保存した状態 */
  const a = [{ id: id, ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 28, actual: '', _mut: 100 }];
  const b = [{ id: id, ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 28, actual: 30, _mut: 200 }];
  const m = api.mergeCcList(a, b);
  check('同じセルは新しい方が残る', m.length === 1 && m[0].actual === 30, JSON.stringify(m[0].actual));

  /* 別の店舗・別の指標は独立して残る */
  const m2 = api.mergeCcList(
    [{ id: '2026-08|F01|m_cost', _mut: 1 }],
    [{ id: '2026-08|F02|m_cost', _mut: 1 }, { id: '2026-08|F01|m_hyg', _mut: 1 }]);
  check('別セルは消えない（3件）', m2.length === 3, m2.map(x => x.id).join(' / '));

  api.ccPutScore({ id: id, ym: '2026-08', storeId: 'F01', metricId: 'm_cost', target: 28, actual: 27, _mut: 1 });
  check('保存して読み戻せる', (api.ccScore('2026-08', 'F01', 'm_cost') || {}).actual === 27);
  check('別の月には出てこない', api.ccScore('2026-07', 'F01', 'm_cost') === null);
}

console.log('\n=== テスト7: 自動削除・保存の保護 ===');
{
  const never = new Function(grabVar(SRC, "var LS_NEVER_FREE = [") + '\nreturn LS_NEVER_FREE;')();
  ['spl_cc_metrics_', 'cc_scores', 'spl_cc_scores_'].forEach(k =>
    check(`${k} が LS_NEVER_FREE にある`, never.indexOf(k) >= 0));
  const prunable = new Function(grab(SRC, 'lsIsPrunable') + '\nreturn lsIsPrunable;')();
  check('cc_scores は自動削除の対象外', prunable('spl_cc_scores_2026-08') === false);

  const sp = new Function(grabVar(SRC, 'var _SPLIT_KEYS = {') + '\nreturn _SPLIT_KEYS;')();
  check('cc_scores は対象月ごとに行が分かれる', sp.cc_scores.by({ ym: '2026-08' }) === '2026-08');
  check('cc_metrics は月に依存しない設定型', sp.cc_metrics.type === 'obj');
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
