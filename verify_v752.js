/* ===== v752 検証 =====
   目的: 全店舗のスキルと Career Score が、上げても下げてもきちんと保存されるかを確認する。
         「点数・レベルの大小で勝敗が決まる」経路が残っていないことを、実コードで確かめる。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v751_backup.html', 'utf8');   // Career Score の修正前
const PRE = fs.readFileSync('index_v750_backup.html', 'utf8');   // スキルの修正前

function grab(src, n) {
  let i = src.indexOf('async function ' + n + '(');
  if (i < 0) i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('not found: ' + n);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function grabDecl(src, decl, open, close) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === open) { d++; st = true; }
    else if (c === close) { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* 実店舗IDを実ファイルから取り出す（テスト用に決め打ちしない） */
function storeIds(src) {
  const m = /const DEFAULT_STORES = \[/.exec(src);
  const seg = src.slice(m.index, m.index + 4000);
  const ids = [];
  seg.replace(/id\s*:\s*'([^']+)'/g, (x, id) => { if (ids.indexOf(id) < 0) ids.push(id); return x; });
  return ids;
}
const STORES = storeIds(NEW);

function build(src) {
  const P = grabDecl(src, 'var OP_MERGE_PREFIX = {', '{', '}');
  const ref = new Set();
  P.replace(/(?:merge|covers)\s*:\s*([A-Za-z_$][\w$]*)/g, (m, n) => { if (n !== 'function') ref.add(n); return m; });
  const REAL = ['mergeSkillStore', '_coversSkillStore', '_skillPick', 'mergeLssRec', '_coversLssRec'];
  const stubs = [...ref].filter(n => REAL.indexOf(n) < 0).map(n => 'function ' + n + '(){ return null; }').join('\n');
  const realFns = REAL.filter(n => src.indexOf('function ' + n + '(') >= 0).map(n => grab(src, n)).join('\n');

  const code = `
    var localStorage = {
      _s:{},
      get length(){ return Object.keys(this._s).length; },
      key:function(i){ return Object.keys(this._s)[i]; },
      getItem:function(k){ return this._s.hasOwnProperty(k)?this._s[k]:null; },
      setItem:function(k,v){ this._s[k]=String(v); },
      removeItem:function(k){ delete this._s[k]; }
    };
    var console={warn:function(){}};
    var SKILL_STORE_PREFIX='skills_st_', LSS_EMP_PREFIX='lss_emp_';
    var _skMemCache={};
    var OP_MERGE={};
    function legacySkillsV2(){ return {}; }
    function myName(){ return 'テスト評価者'; }
    function ls(k,d){ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }
    function lsSet(k,v){ localStorage.setItem(k,JSON.stringify(v)); return true; }
    function todayJP(){ return '2026-07-27'; }
    ${stubs}
    ${realFns}
    ${P}
    function _opMergeDef(key){ for(var p in OP_MERGE_PREFIX){ if(OP_MERGE_PREFIX.hasOwnProperty(p) && String(key).indexOf(p)===0) return OP_MERGE_PREFIX[p]; } return null; }
    ${grab(src, 'getStoreSkillsMap')}
    ${grab(src, 'setStoreSkills')}
    ${grab(src, 'getSkillsV2')}
    ${grab(src, 'setSkillsV2')}
    ${grab(src, 'getLssScores')}
    ${grab(src, 'setLssScores')}

    /* スキル編集画面と同じ書き方（編集したポジションを作り直す） */
    function editSkill(name, storeId, pos, lv){
      var v2=getSkillsV2();
      if(!v2[name]) v2[name]={};
      if(!v2[name][storeId]) v2[name][storeId]={};
      var prev=v2[name][storeId][pos]||{};
      v2[name][storeId][pos]={level:lv, status:(lv===0?'未取得':'承認'), date:todayJP(), evaluator:'AM', mgrComment:prev.mgrComment||''};
      setSkillsV2(v2);
    }
    function skillRaw(storeId){ return ls(SKILL_STORE_PREFIX+storeId, {}); }
    function saveScore(name, scores){ setLssScores(name, {evaluator:'AM', date:todayJP(), scores:scores}); }
    return { editSkill:editSkill, skillRaw:skillRaw, saveScore:saveScore, getScore:getLssScores,
             mergeSkill:mergeSkillStore, def:_opMergeDef, ls:localStorage };
  `;
  return new Function(code)();
}

console.log('対象店舗: ' + STORES.join(', ') + '  (' + STORES.length + '店)');

/* =========================================================
   T1: 全店舗でレベルを下げられるか
   ========================================================= */
console.log('\n[T1] 全店舗 スキルレベル 上げ / 下げ / Lv0へ');
{
  function run(src, storeId, from, to) {
    const e = build(src);
    e.editSkill('Taro', storeId, 'A軸', from);
    const cloud = JSON.parse(JSON.stringify(e.skillRaw(storeId)));
    e.editSkill('Taro', storeId, 'A軸', to);
    return e.mergeSkill(cloud, e.skillRaw(storeId))['Taro']['A軸'].level;
  }
  let oldDownNG = 0, newDownOK = 0, newUpOK = 0, newZeroOK = 0;
  STORES.forEach(sid => {
    if (run(PRE, sid, 4, 2) === 4) oldDownNG++;
    if (run(NEW, sid, 4, 2) === 2) newDownOK++;
    if (run(NEW, sid, 1, 3) === 3) newUpOK++;
    if (run(NEW, sid, 3, 0) === 0) newZeroOK++;
  });
  ok('修正前(v751以前の状態): 全' + STORES.length + '店で下げられなかった',
    oldDownNG === STORES.length, oldDownNG + '/' + STORES.length);
  ok('修正後: 全' + STORES.length + '店で下げられる', newDownOK === STORES.length, newDownOK + '/' + STORES.length);
  ok('修正後: 全' + STORES.length + '店で上げられる', newUpOK === STORES.length, newUpOK + '/' + STORES.length);
  ok('修正後: 全' + STORES.length + '店で Lv0（未取得）に戻せる', newZeroOK === STORES.length, newZeroOK + '/' + STORES.length);
}

/* =========================================================
   T2: 全店舗で保存時刻が入るか
   ========================================================= */
console.log('\n[T2] 全店舗 保存時刻の記録');
{
  let n = 0;
  STORES.forEach(sid => {
    const e = build(NEW);
    e.editSkill('Taro', sid, 'A軸', 3);
    const v = e.skillRaw(sid)['Taro']['A軸'];
    if (typeof v._at === 'number' && v._at > 0) n++;
  });
  ok('全' + STORES.length + '店で保存時刻が入る', n === STORES.length, n + '/' + STORES.length);
}

/* =========================================================
   T3: Kaimuki/Piikoi の7軸移行後も下げられるか
   ========================================================= */
console.log('\n[T3] Kaimuki / Piikoi（7軸移行の対象店）');
{
  ['F04-K', 'F04-P'].forEach(sid => {
    const e = build(NEW);
    // 移行前の名称で保存されていた状態を作る
    e.ls.setItem('skills_st_' + sid, JSON.stringify({ 'Taro': { 'Team Standards': { level: 4, status: '承認' } } }));
    const cloud = JSON.parse(e.ls.getItem('skills_st_' + sid));
    e.editSkill('Taro', sid, 'Team Standards', 1);
    const merged = e.mergeSkill(cloud, e.skillRaw(sid));
    ok(sid + ': 時刻なしの既存データから下げられる',
      merged['Taro']['Team Standards'].level === 1,
      'level=' + merged['Taro']['Team Standards'].level);
  });
}

/* =========================================================
   T4: Career Score
   ========================================================= */
console.log('\n[T4] Career Score（lss_emp_）');
{
  const o = build(OLD), n = build(NEW);
  ok('修正前(v751): 合流ルールが無い（丸ごと上書き）', !o.def('lss_emp_Taro'));
  ok('修正後(v752): 合流ルールがある', !!n.def('lss_emp_Taro'));

  // 上げ下げが端末に保存されること
  n.saveScore('Taro', { a1: 3, a2: 2 });
  ok('Career Score を保存できる', n.getScore('Taro').scores.a1 === 3);
  n.saveScore('Taro', { a1: 1, a2: 2 });
  ok('点数を下げても保存される', n.getScore('Taro').scores.a1 === 1,
    JSON.stringify(n.getScore('Taro').scores));
  n.saveScore('Taro', { a1: 4, a2: 2 });
  ok('点数を上げても保存される', n.getScore('Taro').scores.a1 === 4);

  ok('保存時刻が入る', typeof n.getScore('Taro')._at === 'number' && n.getScore('Taro')._at > 0);
  ok('保存者が入る', n.getScore('Taro')._by === 'テスト評価者');

  // 2端末の合流：点数の大小ではなく、新しい保存が勝つ
  const def = n.def('lss_emp_Taro');
  const older = { scores: { a1: 5 }, _at: 1000, _by: '端末A' };
  const newerLower = { scores: { a1: 1 }, _at: 2000, _by: '端末B' };
  ok('低い点数でも、新しい保存が勝つ',
    def.merge(older, newerLower).scores.a1 === 1, JSON.stringify(def.merge(older, newerLower)));
  ok('古い保存は新しい保存を消さない',
    def.merge(newerLower, older).scores.a1 === 1);
  ok('確認(covers): 新しい方が入っていればOK', def.covers(newerLower, older) === true);
  ok('確認(covers): 古いままならNG', def.covers(older, newerLower) === false);

  // 時刻なしの既存データとの合流
  const legacy = { scores: { a1: 5 } };
  ok('時刻なしの既存データより、時刻ありの新しい保存が勝つ',
    def.merge(legacy, newerLower).scores.a1 === 1);
  ok('時刻ありの保存は、時刻なしの保存に消されない',
    def.merge(newerLower, legacy).scores.a1 === 1);

  // 続けて保存しても時刻が必ず進む
  const before = n.getScore('Taro')._at;
  n.saveScore('Taro', { a1: 0, a2: 0 });
  ok('連続保存でも時刻が必ず進む', n.getScore('Taro')._at > before,
    before + ' -> ' + n.getScore('Taro')._at);
  ok('全項目0にも下げられる', n.getScore('Taro').scores.a1 === 0);
}

/* =========================================================
   T5: 点数・レベルの大小で勝敗を決める箇所が残っていないか
   ========================================================= */
console.log('\n[T5] 大小で勝敗を決める判定が残っていないか');
{
  const n = build(NEW);
  // 同時刻ではない限り、レベルの大小は勝敗に影響しないこと
  const hi = { 'T': { 'A': { level: 4, _at: 100 } } };
  const lo = { 'T': { 'A': { level: 1, _at: 200 } } };
  ok('スキル: 新しければ低いレベルが勝つ', n.mergeSkill(hi, lo)['T']['A'].level === 1);
  ok('スキル: 手元が古ければ、クラウドの新しい低いレベルが採用される',
    n.mergeSkill(lo, hi)['T']['A'].level === 1, 'level=' + n.mergeSkill(lo, hi)['T']['A'].level);

  // 片方だけ時刻がある場合
  ok('スキル: 時刻ありが時刻なしに勝つ（低くても）',
    n.mergeSkill({ 'T': { 'A': { level: 4 } } }, { 'T': { 'A': { level: 1, _at: 5 } } })['T']['A'].level === 1);
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
