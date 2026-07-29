/* ============================================================
   verify_v782.js — キッチン管理の行動計画に「品質管理」を追加

     テスト1: グループが増えている（位置と重複なし）
     テスト2: 指標6件（Motoさん指定の6項目に対応）
     テスト3: quality カテゴリーの付け替え（メニュー開発 → 品質管理）
     テスト4: 既定は全て任意（提出ゲートを塞がない）
     テスト5: 保存済み端末にも現れる（既定∪保存）
     テスト6: 既存グループ・指標を壊していない
     テスト7: 設定タブと店舗カードが新グループを扱える
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v781_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  ✅ ' + m); pass++; } else { console.log('  ❌ ' + m); fail++; } }

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src); if (!m) return null;
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
  const i = src.indexOf(decl); if (i < 0) return null;
  return src.slice(i, src.indexOf(endTok, i) + endTok.length);
}
function env(src, saved) {
  const sb = {
    console, Object, Array, String, Number, JSON,
    STORES: [{ id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' }, { id: 'F03', name: 'FSP' },
    { id: 'F03-G', name: 'WGS' }, { id: 'F04-K', name: 'Kaimuki' }, { id: 'F04-P', name: 'Piikoi' },
    { id: 'F04-A', name: 'Aiea' }, { id: 'F05', name: 'Marujuu' }],
    _db: saved ? { cc_metrics: saved } : {}
  };
  sb.ls = (k, d) => (Object.prototype.hasOwnProperty.call(sb._db, k) ? sb._db[k] : d);
  sb.lsSet = (k, v) => { sb._db[k] = v; return true; };
  let code = '';
  for (const [d, e] of [['var CC_GROUPS = [', '];'], ['var CC_GROUP_CAT = {', '};'],
  ['var CC_CAT_GROUP = {', '};'], ['var CC_DEFAULT_METRICS = [', '];'], ['var CC_CATS = [', '];']]) {
    const t = grabVar(src, d, e); if (t) code += t + '\n';
  }
  for (const n of ['ccMetrics', '_ccMetricsMap', 'ccGroupMetrics', 'ccMetricStores']) {
    const t = grab(src, n); if (t) code += t + '\n';
  }
  vm.createContext(sb); vm.runInContext(code, sb);
  return sb;
}

const N = env(SRC), O = env(OLD);

console.log('\n===== テスト1: グループ =====');
{
  const ids = N.CC_GROUPS.map(g => g.id);
  ok(ids.indexOf('g_qc') >= 0, '品質管理(g_qc) がある');
  ok(O.CC_GROUPS.map(g => g.id).indexOf('g_qc') < 0, 'v781 には無かった');
  ok(N.CC_GROUPS.filter(g => g.id === 'g_qc')[0].label === '品質管理', 'ラベルが 品質管理');
  ok(ids.indexOf('g_qc') === ids.indexOf('g_hyg') + 1, '衛生管理の次に並ぶ');
  ok(ids[ids.length - 1] === 'g_other', 'その他は末尾のまま');
  ok(new Set(ids).size === ids.length, 'グループidに重複なし');
  ok(ids.length === O.CC_GROUPS.length + 1, '1つだけ増えた');
}

console.log('\n===== テスト2: 指標6件 =====');
{
  const q = N.ccGroupMetrics('g_qc');
  ok(q.length === 6, '品質管理に6指標（' + q.length + '）');
  const want = [
    ['m_ops', '提供時間', '秒', 'lower'],
    ['m_loss', 'ロス率', '%', 'lower'],
    ['m_recipe', 'レシピ登録率（全商品）', '%', 'higher'],
    ['m_recupd', 'レシピ未更新', '件', 'lower'],
    ['m_std', '提供の標準化レベル', 'Lv', 'higher'],
    ['m_qclv', '品質管理レベル', 'Lv', 'higher']
  ];
  want.forEach(function (w, i) {
    const m = q[i];
    ok(m && m.id === w[0] && m.label === w[1] && m.unit === w[2] && m.dir === w[3],
      w[1] + '（' + w[2] + '・' + (w[3] === 'lower' ? '低い方が良い' : '高い方が良い') + '）');
  });
  ok(q.every(m => N.ccMetricStores(m).length === 8), '6指標とも全8店が対象');
  ok(q.map(m => m.order).join(',') === '1,2,3,4,5,6', '表示順が1〜6');
}

console.log('\n===== テスト3: quality カテゴリーの付け替え =====');
{
  ok(O.CC_CAT_GROUP['quality'] === 'g_dev', 'v781: quality はメニュー開発に同居していた');
  ok(N.CC_CAT_GROUP['quality'] === 'g_qc', 'v782: 品質管理へ移った');
  ok(N.CC_GROUP_CAT['g_qc'] === 'quality', '店舗カードから足す行動の既定カテゴリーが quality');
  ok(N.CC_CATS.filter(c => c.id === 'quality').length === 1, 'CC_CATS の quality は増やしていない');
  ok(N.CC_CAT_GROUP['product'] === 'g_dev', 'product はメニュー開発のまま');
  ok(Object.keys(N.CC_CAT_GROUP).length === Object.keys(O.CC_CAT_GROUP).length, 'カテゴリー数は変わらない');
}

console.log('\n===== テスト4: 既定は全て任意 =====');
{
  const q = N.ccGroupMetrics('g_qc');
  ok(q.every(m => !m.req), '6指標とも req なし（提出ゲートを塞がない）');
  ok(q.every(m => !m.targets), '既定目標は未設定（設定タブでGMが入れる）');
}

console.log('\n===== テスト5: 保存済み端末にも現れる =====');
{
  const saved = { m_cost: { id: 'm_cost', grp: 'g_cost', label: '原価率', unit: '%', dir: 'lower', stores: 'ALL', order: 1 } };
  const s = env(SRC, JSON.parse(JSON.stringify(saved)));
  const ids = s.ccMetrics().map(m => m.id);
  ok(ids.indexOf('m_qclv') >= 0 && ids.indexOf('m_loss') >= 0,
    '保存済み cc_metrics があっても新指標が現れる（既定∪保存）');
  const o = env(OLD, JSON.parse(JSON.stringify(saved)));
  ok(o.ccMetrics().map(m => m.id).indexOf('m_qclv') < 0, 'v781 には無い指標');
}

console.log('\n===== テスト6: 既存を壊していない =====');
{
  ['g_cost', 'g_hyg', 'g_dev', 'g_ppl'].forEach(g =>
    ok(JSON.stringify(N.ccGroupMetrics(g).map(m => m.id)) ===
      JSON.stringify(O.ccGroupMetrics(g).map(m => m.id)), g + ' の指標は変わらない'));
  ok(N.ccMetrics().length === O.ccMetrics().length + 6, '指標が6件だけ増えた');
  const dup = N.ccMetrics().map(m => m.id);
  ok(new Set(dup).size === dup.length, '指標idに重複なし');
}

console.log('\n===== テスト7: 画面が新グループを扱えるか =====');
{
  ok(grab(SRC, 'renderCcSetting').indexOf('CC_GROUPS.forEach') >= 0,
    '設定タブは CC_GROUPS を回すので品質管理も出る');
  ok(SRC.indexOf("CC_CAT_GROUP[a.cat] || 'g_other'") >= 0,
    '行動のグループ解決は CC_CAT_GROUP 経由（品質管理へ流れる）');
  ok(grab(SRC, 'ccReqGaps').indexOf("CC_CAT_GROUP[a.cat]") >= 0,
    '提出時の注意喚起も同じ経路を使う');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
