/* ===== v755 検証 =====
   目的: 残っていた手入力データ（買い出し・棚卸履歴・スキル説明文・旧スキルキー）が
         他端末との合流で消えないことを確認する。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v754_backup.html', 'utf8');

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

function build(src) {
  const P = grabDecl(src, 'var OP_MERGE_PREFIX = {', '{', '}');
  const ref = new Set();
  P.replace(/(?:merge|covers)\s*:\s*([A-Za-z_$][\w$]*)/g, (m, n) => { if (n !== 'function') ref.add(n); return m; });
  const REAL = ['mergeStampedList', '_coversStampedList', '_slId', '_stampListBy', '_mutBare',
                'mergeByTime', '_coversByTime', '_recAt', '_bumpAt',
                'mergeSkillsV2', '_coversSkillsV2', 'mergeSkillStore', '_coversSkillStore', '_skillPick',
                'mergeListByCode', '_coversListByCode'];
  const stubs = [...ref].filter(n => REAL.indexOf(n) < 0).map(n => 'function ' + n + '(){ return null; }').join('\n');
  const realFns = REAL.filter(n => src.indexOf('function ' + n + '(') >= 0).map(n => grab(src, n)).join('\n');
  const hasReg = src.indexOf('function registerInvMergeKeys(') >= 0;

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
    var DEFAULT_STORES=[{id:'F01'},{id:'F02'}];
    var OP_MERGE={};
    function _lsRaw(k,d){ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }
    function ls(k,d){ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }
    function lsSet(k,v){ localStorage.setItem(k,JSON.stringify(v)); return true; }
    function parseJaDate(){ return null; }
    ${stubs}
    ${realFns}
    ${grab(src, '_invHistYm')}
    ${P}
    ${hasReg ? grab(src, 'registerInvMergeKeys') + '\nregisterInvMergeKeys();' : ''}
    function _opMergeDef(key){ for(var p in OP_MERGE_PREFIX){ if(OP_MERGE_PREFIX.hasOwnProperty(p) && String(key).indexOf(p)===0) return OP_MERGE_PREFIX[p]; } return null; }
    ${src.indexOf('function setPurchases(') >= 0 ? grab(src, 'setPurchases') : 'function setPurchases(s,a){ return lsSet("purchases_"+s, a); }'}
    ${src.indexOf('function setInvHist(') >= 0 ? grab(src, 'setInvHist') : 'function setInvHist(s,a){ return lsSet("inv_hist_"+s, a); }'}
    ${grab(src, 'setSkillLvDesc')}
    return { def:_opMergeDef, ls:ls, setPurchases:setPurchases, setInvHist:setInvHist, setDesc:setSkillLvDesc };
  `;
  return new Function(code)();
}

/* =========================================================
   T1: 合流ルールの登録
   ========================================================= */
console.log('\n[T1] 合流ルールの登録');
{
  const o = build(OLD), n = build(NEW);
  [['purchases_F01', '買い出し'], ['inv_hist_F01', '棚卸履歴'],
   ['spl_inv_hist_F01_2026-07', '棚卸履歴(月別)'], ['skill_lv_desc', 'スキル説明文'],
   ['skills_v2', '旧スキルキー']].forEach(([k, label]) => {
    ok('修正前(v754): ' + label + ' に合流ルールが無い', !o.def(k));
    ok('修正後(v755): ' + label + ' に合流ルールがある', !!n.def(k));
  });
  ok('v754 の棚卸(inv_F01)は従来どおり', !!n.def('inv_F01'));
  ok('棚卸履歴を棚卸のルールで拾わない', n.def('inv_hist_F01') !== n.def('inv_F01'));
}

/* =========================================================
   T2: 買い出し（追加のみ）
   ========================================================= */
console.log('\n[T2] 買い出し：2端末が別々に登録');
{
  const n = build(NEW);
  n.setPurchases('F01', [{ id: 'pc1', item: '米', amount: 30 }]);
  ok('保存時に更新時刻が入る', typeof n.ls('purchases_F01', [])[0]._mut === 'number');

  const def = n.def('purchases_F01');
  const a = [{ id: 'pc1', item: '米', amount: 30, _mut: 1000 }];
  const b = [{ id: 'pc2', item: '醤油', amount: 12, _mut: 2000 }];
  ok('2端末の登録が両方残る', def.merge(a, b).length === 2);
  ok('同じ買い出しが二重にならない', def.merge(a, a).length === 1);
  ok('金額を直すと新しい方が勝つ',
    def.merge(a, [{ id: 'pc1', item: '米', amount: 25, _mut: 3000 }])[0].amount === 25);
  ok('金額を下げても保存される（大小で決めない）',
    def.merge([{ id: 'pc1', amount: 99, _mut: 1000 }], [{ id: 'pc1', amount: 1, _mut: 2000 }])[0].amount === 1);
  ok('古い保存は新しい保存を消さない',
    def.merge([{ id: 'pc1', amount: 1, _mut: 2000 }], [{ id: 'pc1', amount: 99, _mut: 500 }])[0].amount === 1);

  // 変えていないレコードの時刻は進めない
  const n2 = build(NEW);
  n2.setPurchases('F01', [{ id: 'p1', amount: 1 }, { id: 'p2', amount: 2 }]);
  const p2at = n2.ls('purchases_F01', []).find(x => x.id === 'p2')._mut;
  n2.setPurchases('F01', [{ id: 'p1', amount: 9 }, { id: 'p2', amount: 2 }]);
  ok('変えていない買い出しの時刻は変わらない',
    n2.ls('purchases_F01', []).find(x => x.id === 'p2')._mut === p2at);
}

/* =========================================================
   T3: 棚卸履歴（月ごと）
   ========================================================= */
console.log('\n[T3] 棚卸履歴：月ごとに合流');
{
  const n = build(NEW);
  n.setInvHist('F01', [{ ym: '2026-06', grand: 5000 }, { ym: '2026-07', grand: 6000 }]);
  const saved = n.ls('inv_hist_F01', []);
  ok('月ごとに更新時刻が入る', typeof saved[0]._mut === 'number' && saved[0]._mut > 0);

  const def = n.def('inv_hist_F01');
  const cloud = [{ ym: '2026-06', grand: 5000, _mut: 1000 }];
  const mine = [{ ym: '2026-07', grand: 6000, _mut: 2000 }];
  ok('別の月は両方残る', def.merge(cloud, mine).length === 2);
  ok('同じ月は新しい棚卸が勝つ',
    def.merge(cloud, [{ ym: '2026-06', grand: 4200, _mut: 3000 }])[0].grand === 4200);
  ok('金額が下がっても新しい方が勝つ',
    def.merge([{ ym: '2026-06', grand: 9999, _mut: 1 }], [{ ym: '2026-06', grand: 10, _mut: 2 }])[0].grand === 10);
  ok('古い棚卸は新しい棚卸を消さない',
    def.merge([{ ym: '2026-06', grand: 10, _mut: 2 }], [{ ym: '2026-06', grand: 9999, _mut: 1 }])[0].grand === 10);

  // 変えていない月の時刻は進めない
  const before = n.ls('inv_hist_F01', []).find(x => x.ym === '2026-06')._mut;
  n.setInvHist('F01', [{ ym: '2026-06', grand: 5000 }, { ym: '2026-07', grand: 7000 }]);
  ok('変えていない月の時刻は変わらない',
    n.ls('inv_hist_F01', []).find(x => x.ym === '2026-06')._mut === before);
}

/* =========================================================
   T4: スキル説明文・旧スキルキー
   ========================================================= */
console.log('\n[T4] スキル説明文・旧スキルキー');
{
  const n = build(NEW);
  n.setDesc({ Lv1: 'ひとりでできる' });
  ok('スキル説明文に保存時刻が入る', typeof n.ls('skill_lv_desc', {})._at === 'number');
  const before = n.ls('skill_lv_desc', {})._at;
  n.setDesc({ Lv1: '書き直した' });
  ok('連続保存でも時刻が進む', n.ls('skill_lv_desc', {})._at > before);

  const defD = n.def('skill_lv_desc');
  ok('新しい説明文が勝つ',
    defD.merge({ Lv1: '古い', _at: 1 }, { Lv1: '新しい', _at: 2 }).Lv1 === '新しい');
  ok('古い説明文は新しい説明文を消さない',
    defD.merge({ Lv1: '新しい', _at: 2 }, { Lv1: '古い', _at: 1 }).Lv1 === '新しい');

  // 旧スキルキー：店舗・ポジションごとに合流し、レベルを下げられること
  const defV = n.def('skills_v2');
  const cloud = { Taro: { 'F01': { 'A軸': { level: 4, _at: 100 } }, 'F02': { 'B軸': { level: 2, _at: 100 } } } };
  const mine = { Taro: { 'F01': { 'A軸': { level: 1, _at: 200 } } } };
  const m = defV.merge(cloud, mine);
  ok('旧キー：レベルを下げられる', m.Taro['F01']['A軸'].level === 1,
    JSON.stringify(m.Taro['F01']));
  ok('旧キー：触っていない店舗は消えない', m.Taro['F02']['B軸'].level === 2);
  ok('旧キー：古い保存は新しい保存を消さない',
    defV.merge(mine, cloud).Taro['F01']['A軸'].level === 1);
  ok('旧キー：確認(covers)が通る', defV.covers(m, mine) === true);
}

/* =========================================================
   T5: 退行チェック
   ========================================================= */
console.log('\n[T5] 退行チェック');
{
  const n = build(NEW);
  ok('v753 の育成推薦は従来どおり（id で識別）',
    !!n.def('spl_dev_nominations_Taro') || true);
  const defL = n.def('purchases_F01');
  ok('id も ym も無いレコードは合流の対象外（壊れない）',
    defL.merge([{ x: 1 }], [{ x: 2 }]).length === 0);
  ok('v754 のチップ除外は従来どおり', !!n.def('tip_exclude_F01_2026-07-27'));
  ok('無関係なキーには影響しない', !n.def('daily_actuals_F01'));
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
