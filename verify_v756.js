/* ===== v756 検証 =====
   症状: スキル編集画面の各行に、古い共通基準の文言が表示される。
         基準モーダル(Lv0〜4)は正しいのに、行の文言だけ食い違う。
   方針: ヘッダーが「全店舗」の状態を再現し、修正前は古い文言が出ることを確かめてから修正後を確認する。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v755_backup.html', 'utf8');

function grab(src, n) {
  let i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('not found: ' + n);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* Piikoi(F04-P) の新しい7軸基準と、古い共通基準を用意して切り分ける */
const NEW_CRIT = {
  'F04-P': {
    'Main Plater': {
      0: { ja: '未経験' },
      1: { ja: '丼ごとのご飯の盛り方の違いを理解し、常に再現できる（山・平）' },
      2: { ja: '全レシピ（分量・盛り付け）を再現できる。' },
      3: { ja: '全丼を60秒/杯ペースで安定提供' },
      4: { ja: '炊飯ペースを適切に管理。品質確認と異常報告ができる。' }
    }
  }
};
const OLD_CRIT = { 'Main Plater': ['未経験', '米を丼に盛りtobikoを正しくかけられる', 'できる', '教えられる'] };

function build(src, curStore) {
  const code = `
    var curLang='ja';
    var curStore=CUR_STORE;
    var window={};
    var SKILL_CRITERIA=OLDC;
    function escapeHtml(x){ return String(x); }
    function storeSkillMax(sid){ return (sid==='F04-P'||sid==='F04-K') ? 4 : 3; }
    function skillLvDescCell(sid, pos, lv){
      var s=NEWC[sid]; if(!s) return null;
      var p=s[pos]; if(!p) return null;
      return p[lv] || null;
    }
    var CALLS=[];
    ${grab(src, 'skillCriteria')}
    ${grab(src, 'skillLevelChipInner')}
    ${grab(src, 'skillLevelChipHtml')}
    ${grab(src, 'showCriteria').indexOf('openModal') >= 0 ? '' : ''}
    return { criteria:skillCriteria, chipInner:skillLevelChipInner, chipHtml:skillLevelChipHtml };
  `;
  return new Function('CUR_STORE', 'NEWC', 'OLDC', code)(curStore, NEW_CRIT, OLD_CRIT);
}

/* =========================================================
   T1: 症状の再現（ヘッダーが「全店舗」のとき）
   ========================================================= */
console.log('\n[T1] ヘッダーが「全店舗」の状態');
{
  const o = build(OLD, 'ALL'), n = build(NEW, 'ALL');

  const oldRow = o.chipInner('Main Plater', 1, 'F04-P');
  const newRow = n.chipInner('Main Plater', 1, 'F04-P');

  ok('修正前(v755): 古い共通基準の文言が出る（報告された症状）',
    oldRow.indexOf('tobiko') >= 0, oldRow.replace(/<[^>]*>/g, '').slice(0, 60));
  ok('修正後(v756): 店舗の基準（山・平）が出る',
    newRow.indexOf('山・平') >= 0, newRow.replace(/<[^>]*>/g, '').slice(0, 60));
  ok('修正後: 古い文言はもう出ない', newRow.indexOf('tobiko') < 0);

  // 基準モーダル側は元から正しい（食い違いの確認）
  ok('基準モーダル側は修正前から正しかった',
    (o.criteria('Main Plater', 'F04-P') || [])[1].indexOf('山・平') >= 0);
  ok('修正後は行と基準モーダルの文言が一致する',
    newRow.indexOf((n.criteria('Main Plater', 'F04-P') || [])[1]) >= 0);
}

/* =========================================================
   T2: 各レベルが正しく出るか
   ========================================================= */
console.log('\n[T2] Lv0〜Lv4 それぞれ');
{
  const n = build(NEW, 'ALL');
  const want = {
    0: '未経験', 1: '山・平', 2: '全レシピ', 3: '60秒', 4: '炊飯ペース'
  };
  Object.keys(want).forEach(lv => {
    const row = n.chipInner('Main Plater', Number(lv), 'F04-P');
    ok('Lv' + lv + ' の文言が店舗の基準になる', row.indexOf(want[lv]) >= 0,
      row.replace(/<[^>]*>/g, '').slice(0, 50));
  });

  const o = build(OLD, 'ALL');
  ok('修正前は Lv4 の文言が出せなかった（共通基準はLv3まで）',
    o.chipInner('Main Plater', 4, 'F04-P').indexOf('炊飯ペース') < 0);
}

/* =========================================================
   T3: チップ生成から店舗が渡るか
   ========================================================= */
console.log('\n[T3] チップ生成(skillLevelChipHtml)からの受け渡し');
{
  const o = build(OLD, 'ALL'), n = build(NEW, 'ALL');
  const oldHtml = o.chipHtml('Main Plater', 1, 'sel1', 'chip1', 0, 'F04-P');
  const newHtml = n.chipHtml('Main Plater', 1, 'sel1', 'chip1', 0, 'F04-P');
  ok('修正前(v755): 店舗が渡らず古い文言のまま', oldHtml.indexOf('tobiko') >= 0);
  ok('修正後(v756): 店舗の基準が出る', newHtml.indexOf('山・平') >= 0);
  ok('基準モーダルを開くボタンには元から店舗が渡っていた',
    newHtml.indexOf("storeId:'F04-P'") >= 0 || newHtml.indexOf('F04-P') >= 0);
}

/* =========================================================
   T4: 退行チェック
   ========================================================= */
console.log('\n[T4] 退行チェック');
{
  // 店舗を選んでいる状態では、修正前も正しく出ていた（そこは変わらない）
  const oSel = build(OLD, 'F04-P'), nSel = build(NEW, 'F04-P');
  ok('店舗選択中は修正前も正しかった',
    oSel.chipInner('Main Plater', 1).indexOf('山・平') >= 0);
  ok('店舗選択中は修正後も正しい',
    nSel.chipInner('Main Plater', 1).indexOf('山・平') >= 0);

  // 店舗別の基準が無いポジションは共通基準にフォールバックする
  const n = build(NEW, 'ALL');
  ok('店舗別の基準が無い場合は共通基準に戻る',
    n.chipInner('Main Plater', 1, 'F01').indexOf('tobiko') >= 0,
    n.chipInner('Main Plater', 1, 'F01').replace(/<[^>]*>/g, '').slice(0, 50));
  ok('店舗を渡さない従来の呼び方でも落ちない',
    typeof n.chipInner('Main Plater', 1) === 'string');
  ok('基準が無いレベルは — になる',
    n.chipInner('Main Plater', 3, 'F01').indexOf('教えられる') >= 0);
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
