/* verify_v790.js — Kaimuki/Piikoi のスキル基準を添付シート準拠へ＋基準文が他端末へ届かない不具合の修正
   修正前(v789)の症状の再現つき。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v789_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
/* async function も拾う */
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
function obj(text, name) {
  const a = text.indexOf('var ' + name + ' = {');
  if (a < 0) throw new Error('not found: ' + name);
  let i = text.indexOf('{', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') d++;
    else if (text[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  return new Function('return ' + text.slice(i, end + 1))();
}

console.log('\n=== v790: Kaimuki/Piikoi の基準文（日英）と、届かない不具合の修正 ===\n');

/* ---------- 1. 基準文の中身（添付シート準拠） ---------- */
console.log('[1] 基準文の中身');
{
  const C = obj(src, 'TOTOYA_SKILL_CRITERIA_V2');
  const axes = Object.keys(C);
  ok(axes.length === 7, '評価軸は7つ（満点28点の前提）', axes);
  ok(axes.every(p => C[p].length === 5), '全軸が Lv0〜4 の5段階', axes.map(p => p + ':' + C[p].length));
  const empty = [];
  axes.forEach(p => C[p].forEach((pair, lv) => {
    if (!pair[0] || !String(pair[0]).trim()) empty.push(p + ' Lv' + lv + ' JA');
    if (!pair[1] || !String(pair[1]).trim()) empty.push(p + ' Lv' + lv + ' EN');
  }));
  ok(empty.length === 0, '日英どちらも空欄が無い（35項目×2言語）', empty);

  /* Motoさんの指示：Miso Lv2 の数字は英語に合わせて 50 */
  const misoJa = C['Miso'][2][0], misoEn = C['Miso'][2][1];
  ok(/50/.test(misoJa), 'Miso Lv2 の日本語が 50 になっている', misoJa);
  ok(!/(^|[^\d])30([^\d]|$)/.test(misoJa), 'Miso Lv2 の日本語に 30 が残っていない', misoJa);
  ok(/50\+/.test(misoEn), 'Miso Lv2 の英語も 50+ のまま', misoEn);
  const nJa = (misoJa.match(/\d+/g) || []).map(Number), nEn = (misoEn.match(/\d+/g) || []).map(Number);
  ok(nJa.length > 0 && nEn.length > 0 && nJa[0] === nEn[0],
    '日英で先頭の数字が一致（' + nJa[0] + ' / ' + nEn[0] + '）', [nJa, nEn]);

  /* 各軸の中でレベルごとの文言が重複していない（貼り間違いの検出） */
  const dup = [];
  axes.forEach(p => {
    ['ja', 'en'].forEach((lang, k) => {
      const seen = {};
      C[p].forEach((pair, lv) => {
        const v = String(pair[k]).trim();
        if (seen[v] !== undefined) dup.push(p + ' ' + lang + ' Lv' + seen[v] + '=Lv' + lv);
        seen[v] = lv;
      });
    });
  });
  ok(dup.length === 0, '同じ軸の中でレベルの文言が重複していない', dup);

  /* オーダー数のはしごが逆行していない（Miso / Host） */
  ['Miso', 'Host'].forEach(p => {
    const nums = C[p].map(pair => { const m = String(pair[1]).match(/(\d+)\+? orders/); return m ? Number(m[1]) : null; })
      .filter(x => x !== null);
    const sorted = nums.slice().sort((a, b) => a - b);
    ok(JSON.stringify(nums) === JSON.stringify(sorted), p + ' のオーダー数が昇順（' + nums.join('→') + '）', nums);
  });
}

/* ---------- 2. v789 から変わったのは指示された2箇所だけ ---------- */
console.log('\n[2] v789 からの差は指示された2箇所だけ');
{
  const A = obj(prev, 'TOTOYA_SKILL_CRITERIA_V2'), B = obj(src, 'TOTOYA_SKILL_CRITERIA_V2');
  ok(JSON.stringify(Object.keys(A)) === JSON.stringify(Object.keys(B)), '評価軸の構成は変えていない');
  const diff = [];
  Object.keys(B).forEach(p => B[p].forEach((pair, lv) => {
    ['JA', 'EN'].forEach((lang, k) => {
      const a = (A[p] && A[p][lv] && A[p][lv][k]) || '';
      if (a !== pair[k]) diff.push(p + ' Lv' + lv + ' ' + lang);
    });
  }));
  ok(diff.length === 2, '変更したのは2項目だけ', diff);
  ok(diff.indexOf('Miso Lv2 JA') >= 0, 'その1つは Miso Lv2 の日本語', diff);
  ok(diff.indexOf('Host Lv3 EN') >= 0, 'もう1つは Host Lv3 の英語', diff);
}

/* ---------- 3. 修正前(v789)の症状：GMが実行しても他端末へ届かない ---------- */
console.log('[3] 修正前の症状の再現（基準文が他端末へ届かない）');
{
  /* 実関数をそのまま使う */
  const real = new Function(`
    var store={};
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); }
    ${grab(src, '_recAt')}
    ${grab(src, '_bumpAt')}
    ${grab(src, 'mergeByTime')}
    ${grab(src, 'getSkillLvDesc')}
    ${grab(src, 'setSkillLvDesc')}
    return { store:function(){return store;}, ls:ls, lsSet:lsSet, mergeByTime:mergeByTime,
             setSkillLvDesc:setSkillLvDesc, get:getSkillLvDesc };
  `)();

  const OLD = '30オーダー＋（旧基準）', NEW = '50オーダー＋（新基準）';
  const mk = (at, txt) => ({ _at: at, 'F04-K': { Miso: { 2: { ja: txt, en: '' } } } });
  const critOf = o => { try { return o['F04-K']['Miso'][2].ja; } catch (e) { return '(なし)'; } };

  /* 旧経路：lsSet で書く（_at は据え置き） */
  const gmOld = mk(1000, OLD);
  const wroteOld = JSON.parse(JSON.stringify(gmOld)); wroteOld['F04-K'].Miso[2].ja = NEW;
  const staff = mk(1000, OLD);      /* 同期済みのスタッフ端末 */
  ok(critOf(real.mergeByTime(wroteOld, staff)) === OLD,
    'v789: _at が同じままなのでスタッフ端末は旧基準が残る（症状）', critOf(real.mergeByTime(wroteOld, staff)));
  const cloudNewer = mk(2000, OLD);
  ok(critOf(real.mergeByTime(cloudNewer, wroteOld)) === OLD,
    'v789: 他端末が後で編集していると GM端末でも旧基準へ戻る（症状）');

  /* 新経路：setSkillLvDesc で書く（_at が進む） */
  real.lsSet('skill_lv_desc', mk(1000, OLD));
  const d = real.ls('skill_lv_desc', {}); d['F04-K'].Miso[2].ja = NEW;
  real.setSkillLvDesc(d);
  const wroteNew = real.ls('skill_lv_desc', null);
  ok(wroteNew._at > 1000, '_at が進む', wroteNew._at);
  ok(critOf(real.mergeByTime(wroteNew, staff)) === NEW, 'スタッフ端末へ新基準が届く');
  ok(critOf(real.mergeByTime(cloudNewer, wroteNew)) === NEW, '他端末の古い編集に負けない');
}

/* ---------- 4. 移行処理が _at を進める出口を通っている ---------- */
console.log('\n[4] 保存の出口');
{
  const before = grab(prev, 'runTotoyaSkillV2'), after = grab(src, 'runTotoyaSkillV2');
  ok(/lsSet\(\s*'skill_lv_desc'/.test(before), 'v789 は _at を進めない出口だった（症状の所在）');
  ok(!/lsSet\(\s*'skill_lv_desc'/.test(after), 'v790 は lsSet で直接書かない');
  ok(/setSkillLvDesc\(/.test(after), 'v790 は setSkillLvDesc（_at を進める出口）を通る');
  ok(/_at\s*=\s*_bumpAt\(/.test(grab(src, 'setSkillLvDesc')), 'その出口が _at を進めている');
  /* 他店を巻き込んでいないこと */
  ok(/TOTOYA_V2_STORES/.test(after) || /TG\s*=\s*TOTOYA_V2_STORES/.test(after),
    '対象店舗は TOTOYA_V2_STORES から取っている');
}

/* ---------- 5. 基準文だけを更新する処理（新規） ---------- */
console.log('\n[5] 基準文だけを更新する処理');
{
  ok(prev.indexOf('function runTotoyaCritRefresh') < 0, 'v789 には無かった');
  ok(src.indexOf('function runTotoyaCritRefresh') >= 0, 'v790 で追加された');

  const C = obj(src, 'TOTOYA_SKILL_CRITERIA_V2');
  const logs = [], pushes = [];
  const sb = new Function('C', 'logs', 'pushes', `
    var store={};
    var curRole='gm', curPage='skill';
    var STORES=[{id:'F04-K',name:'Kaimuki'},{id:'F04-P',name:'Piikoi'},{id:'F04-A',name:'Aiea'},{id:'F01',name:'ToriTon'}];
    var TOTOYA_V2_STORES=['F04-K','F04-P'];
    var TOTOYA_SKILL_CRITERIA_V2=C;
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); }
    function escapeHtml(s){ return String(s); }
    function showToast(){}
    function openModal(){}
    function closeModalDirect(){}
    function renderPage(){}
    function _tv2Log(m){ logs.push(m); }
    async function pullOpKey(){ return true; }
    async function syncMasterToSupabase(k,v){ pushes.push([k, JSON.parse(JSON.stringify(v))]); return true; }
    var document={ getElementById:function(){ return null; } };
    ${grab(src, '_recAt')}
    ${grab(src, '_bumpAt')}
    ${grab(src, 'getSkillLvDesc')}
    ${grab(src, 'setSkillLvDesc')}
    ${grab(src, '_tv2CritDiff')}
    ${grab(src, '_tv2CritTotal')}
    ${grab(src, 'runTotoyaCritRefresh')}
    return { store:function(){return store;}, ls:ls, lsSet:lsSet,
             diff:_tv2CritDiff, total:_tv2CritTotal, run:runTotoyaCritRefresh };
  `)(C, logs, pushes);

  /* 初期状態：旧基準＋他店・他キーのデータあり */
  sb.lsSet('skill_lv_desc', {
    _at: 5000,
    'F04-K': { Miso: { 2: { ja: '30オーダー＋（旧）', en: 'old' } } },
    'F04-A': { Host: { 1: { ja: 'Aiea の基準文', en: 'Aiea' } } },
    'F01': { Bar: { 1: { ja: 'ToriTon の基準文', en: 'ToriTon' } } }
  });
  sb.lsSet('store_positions', { 'F04-K': ['旧軸'] });
  sb.lsSet('skill_rules', { 'F04-K': { toRate90: { minTotal: 99 } } });
  sb.lsSet('skills_st_F04-K', { 'someone': { Miso: 2 } });

  ok(sb.total() === 70, '対象は2店×7軸×5段階=70項目', sb.total());
  const before = sb.diff().length;
  ok(before > 0, '実行前は差がある（' + before + '項目）');

  return sb.run().then(function () {
    const d = sb.ls('skill_lv_desc', {});
    ok(sb.diff().length === 0, '実行後は基準文の差が0になる', sb.diff().length);
    ok(d._at > 5000, '_at が進む（他端末へ届く）', d._at);
    ok(d['F04-K'].Miso[2].ja === C['Miso'][2][0], 'Kaimuki の Miso Lv2 が新基準になる', d['F04-K'].Miso[2].ja);
    ok(d['F04-P'] && d['F04-P'].Host && d['F04-P'].Host[3].en === C['Host'][3][1], 'Piikoi にも同じ基準文が入る');

    /* 触ってはいけないもの */
    ok(d['F04-A'] && d['F04-A'].Host[1].ja === 'Aiea の基準文', 'Aiea の基準文は変わらない', d['F04-A']);
    ok(d['F01'] && d['F01'].Bar[1].ja === 'ToriTon の基準文', 'ToriTon の基準文は変わらない', d['F01']);
    ok(JSON.stringify(sb.ls('store_positions', {})) === JSON.stringify({ 'F04-K': ['旧軸'] }),
      '評価軸（store_positions）には触らない', sb.ls('store_positions', {}));
    ok(sb.ls('skill_rules', {})['F04-K'].toRate90.minTotal === 99,
      'チップ率条件（skill_rules）には触らない');
    ok(JSON.stringify(sb.ls('skills_st_F04-K', {})) === JSON.stringify({ 'someone': { Miso: 2 } }),
      '承認済みスキルには触らない');

    /* クラウドへ押し上げるのは基準文だけ */
    ok(pushes.length === 1, 'クラウドへ押し上げるキーは1つだけ', pushes.map(p => p[0]));
    ok(pushes.length === 1 && pushes[0][0] === 'skill_lv_desc', 'そのキーは skill_lv_desc', pushes.map(p => p[0]));
    ok(pushes.length === 1 && Number(pushes[0][1]._at) === Number(d._at),
      '押し上げた内容の _at が進んだ値になっている');

    /* 二重実行しても壊れない */
    return sb.run();
  }).then(function () {
    ok(sb.diff().length === 0, '続けて2回実行しても差は0のまま');
    ok(pushes.length === 2, '2回目も押し上げは基準文だけ', pushes.map(p => p[0]));

    /* ---------- 6. 入口（人がどこで押すか） ---------- */
    console.log('\n[6] 入口');
    ok(/onclick="openTotoyaCritRefresh\(\)"/.test(src), 'ボタンが画面に置かれている');
    const tool = src.slice(src.indexOf('function renderSkillManager'), src.indexOf('function renderSkillManager') + 3000);
    ok(/openTotoyaCritRefresh/.test(tool), 'その場所は Skill Level 承認のツールバー');
    ok(/openTotoyaSkillV2/.test(tool), '既存の「Totoya新基準」も残っている（別用途として併存）');
    const gmOnly = src.slice(src.indexOf('function openTotoyaCritRefresh'), src.indexOf('function openTotoyaCritRefresh') + 400);
    ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(gmOnly), 'GM・CEO 以外は実行できない');
    ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(grab(src, 'runTotoyaCritRefresh')), '実行関数側でも権限を確認している');

    console.log('\n--- 集計 ---');
    console.log('PASS=' + pass + '  FAIL=' + fail);
    process.exit(fail ? 1 : 0);
  });
}
