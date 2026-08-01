/* verify_v797.js — 四半期ごとの査定管理（予算コミット→実績→利益→CS凍結→確定）
   最重要：四半期を切り替えても、前の四半期の査定根拠が消えない・変わらない。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v796_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
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
  if (a < 0) throw new Error('arr not found: ' + name);
  let i = text.indexOf('[', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') d++;
    else if (text[j] === ']') { d--; if (d === 0) { end = j; break; } }
  }
  return 'var ' + name + ' = ' + text.slice(i, end + 1) + ';';
}

console.log('\n=== v797: 四半期ごとの査定管理 ===\n');

const QC = {
  'F01:2026Q2': { tSales: 300000, aSales: 330000, paceSales: 300000, unreg: [] },
  'F04-K:2026Q2': { tSales: 100000, aSales: 95000, paceSales: 100000, unreg: [] },
  'F01:2026Q3': { tSales: 300000, aSales: 55000, paceSales: 50000, unreg: [] }
};
const EMPS = [
  { id: 'e1', name: '山田', grade: 'G3', store: 'F01', status: '在籍' },
  { id: 'e2', name: '佐藤', grade: 'G2', store: 'F04-K', status: '在籍' }
];
let LSS = {
  '山田': { hasData: true, totalScore: 60, totalMax: 100, totalPct: 60, cats: [{ key: 'a', name: '接客', score: 20, max: 30, pct: 67 }] },
  '佐藤': { hasData: true, totalScore: 80, totalMax: 100, totalPct: 80, cats: [{ key: 'a', name: '接客', score: 25, max: 30, pct: 83 }] }
};

function build(today) {
  return new Function('QC', 'GETLSS', 'EMPS', 'TODAY', `
    var store={};
    var curRole='gm', curUserName='Moto', curPage='karte';
    var STORES=[{id:'F01',name:'ToriTon'},{id:'F04-K',name:'Kaimuki'}];
    var QBUD={};
    var toasts=[], confirmAnswer=true, alerts=[];
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _money(n){ return '$'+Math.round(Number(n)||0).toLocaleString('en-US'); }
    function showToast(m,t){ toasts.push([m,t]); }
    function confirm(m){ alerts.push(m); return confirmAnswer; }
    function alert(m){ alerts.push(m); }
    function bizNow(){ return new Date(TODAY+'T12:00:00'); }
    function nowJP(){ return TODAY+' 10:00'; }
    function myName(){ return 'Moto'; }
    function qcCompute(sid,y,q){ return QC[sid+':'+y+'Q'+q] || null; }
    function lssSummary(n){ return GETLSS()[n] || {hasData:false,cats:[],totalScore:0,totalMax:0,totalPct:0}; }
    function getEmployees(){ return EMPS; }
    function empGrade(e){ return (e&&e.grade)||'G3'; }
    function empGradeNum(e){ return Number(String(empGrade(e)).replace('G',''))||0; }
    function getQBudget(sid,y,q){ return QBUD[sid+'_'+y+'Q'+q]||null; }
    function karteScopeStores(){ return STORES; }
    function renderPage(){}
    function kbRefresh(){}
    ${grab(src, '_quarterMonths')}
    ${grab(src, '_ymToOffset')}
    ${grab(src, '_curQuarter')}
    ${grab(src, 'karteEmpStores')}
    ${grab(src, 'karteEligibleEmps')}
    ${grab(src, 'kbCfg')}
    ${grab(src, 'kbSave')}
    ${grab(src, 'csCoef')}
    ${grab(src, 'spCoef')}
    ${grab(src, 'baCoef')}
    ${grab(src, '_bonusQParse')}
    ${arrDecl(src, 'BQ_STAGES')}
    ${grab(src, 'bqAll')}
    ${grab(src, 'bqGet')}
    ${grab(src, 'bqSet')}
    ${grab(src, '_bqNow')}
    ${grab(src, '_bqWho')}
    ${grab(src, 'bqStores')}
    ${grab(src, 'bqProfitMonths')}
    ${grab(src, 'bqProfitOf')}
    ${grab(src, 'bqSetProfit')}
    ${grab(src, 'bqLockProfit')}
    ${grab(src, 'bqUnlockProfit')}
    ${grab(src, 'bqCsFreezeOne')}
    ${grab(src, 'bqCsFreezeAll')}
    ${grab(src, 'bqCsUnfreeze')}
    ${grab(src, 'bqStageState')}
    ${grab(src, 'bqLockQuarter')}
    ${grab(src, 'bqUnlockQuarter')}
    ${grab(src, 'bqRefresh')}
    ${grab(src, 'storeProfitOf')}
    ${grab(src, 'storeScoreOf')}
    ${grab(src, 'budgetAchieveFor')}
    ${grab(src, 'bonusCsDetail')}
    ${grab(src, '_owStoreName')}
    ${grab(src, 'bonusForEmp')}
    ${grab(src, '_baStepRow')}
    ${grab(src, 'renderBonusBreakdown')}
    ${grab(src, '_bqDot')}
    ${grab(src, 'renderBqPipeline')}
    ${grab(src, 'renderBqProfit')}
    return {
      ls:ls, lsSet:lsSet, store:function(){return store;},
      cfg:kbCfg, calc:bonusForEmp, get:bqGet, set:bqSet, profitOf:bqProfitOf,
      setProfit:bqSetProfit, lockProfit:bqLockProfit, unlockProfit:bqUnlockProfit,
      freezeOne:bqCsFreezeOne, freezeAll:bqCsFreezeAll, unfreeze:bqCsUnfreeze,
      stages:bqStageState, lockQ:bqLockQuarter, unlockQ:bqUnlockQuarter,
      pipeline:renderBqPipeline, profitUI:renderBqProfit, breakdown:renderBonusBreakdown,
      storeProfit:storeProfitOf, stores:bqStores,
      setQ:function(q){ var c=kbCfg(); c.quarter=q; kbSave(c); },
      commit:function(sid,y,q){ QBUD[sid+'_'+y+'Q'+q]={status:'committed'}; },
      role:function(r){ curRole=r; },
      answer:function(v){ confirmAnswer=v; },
      toasts:function(){ return toasts; }, alerts:function(){ return alerts; }
    };
  `)(QC, function () { return LSS; }, EMPS, today || '2026-07-15');
}
function setup(e) {
  e.lsSet('karte_bonus_config', {
    quarter: '2026-Q2', gradeBase: { G2: 1000, G3: 3000, G4: 5000, G5: 8000, G6: 12000 },
    csMin: 0.7, csMax: 1.3, spMin: 0.8, spMax: 1.2, baMin: 0.8, baMax: 1.2,
    storeProfit: {}, empStore: {}, storeScore: {}
  });
}

/* ---------- 1. 四半期ごとに分かれて保存される（最重要） ---------- */
console.log('[1] 四半期をまたいでも消えない');
{
  const e = build(); setup(e);
  e.setProfit('2026-Q2', 'F01', '2026-04', 'a', '12000');
  e.setProfit('2026-Q2', 'F01', '2026-04', 't', '10000');
  e.setProfit('2026-Q3', 'F01', '2026-07', 'a', '5000');
  e.setProfit('2026-Q3', 'F01', '2026-07', 't', '9000');
  const q2 = e.profitOf('2026-Q2', 'F01'), q3 = e.profitOf('2026-Q3', 'F01');
  ok(q2.actual === 12000 && q2.target === 10000, 'Q2 の利益が保たれている', q2);
  ok(q3.actual === 5000 && q3.target === 9000, 'Q3 の利益が別に保たれている', q3);
  ok(q2.pct === 120 && q3.pct === 56, 'それぞれの達成率が出る', [q2.pct, q3.pct]);
  /* Q3をさらに編集してもQ2は不変 */
  const before = JSON.stringify(e.profitOf('2026-Q2', 'F01'));
  e.setProfit('2026-Q3', 'F01', '2026-08', 'a', '7000');
  ok(JSON.stringify(e.profitOf('2026-Q2', 'F01')) === before, 'Q3を編集してもQ2は1文字も動かない');
  /* v796 は店舗ごと1組しか持てず、四半期で共有されていた */
  ok(/cfg\.storeProfit&&cfg\.storeProfit\[sid\]/.test(grab(prev, 'storeProfitOf')), 'v796 は四半期を区別していなかった');
  ok(/bqProfitOf\(q, sid\)/.test(grab(src, 'storeProfitOf')), 'v797 は四半期ごとの値を見る');
}

/* ---------- 2. 分割保存と削除保護 ---------- */
console.log('\n[2] 保存の仕組み');
{
  ok(/bonus_q:\s*\{type:'obj'\}/.test(src), '四半期ごとに独立した行として保存される');
  const nf = src.slice(src.indexOf('var LS_NEVER_FREE'), src.indexOf('var LS_NEVER_FREE') + 900);
  ['bonus_q', 'spl_bonus_q_', 'growth_karte', 'karte_bonus_config', 'q_budgets'].forEach(function (k) {
    ok(nf.indexOf("'" + k + "'") >= 0, k + ' が自動削除から守られている');
  });
  ok(prev.slice(prev.indexOf('var LS_NEVER_FREE'), prev.indexOf('var LS_NEVER_FREE') + 900).indexOf("'growth_karte'") < 0,
    'v796 では査定履歴が守られていなかった');
}

/* ---------- 3. 利益：月別入力 → 四半期合計 → 係数 ---------- */
console.log('\n[3] 利益の集計');
{
  const e = build(); setup(e);
  [['2026-04', 12000, 10000], ['2026-05', 9000, 10000], ['2026-06', 11000, 10000]].forEach(function (m) {
    e.setProfit('2026-Q2', 'F01', m[0], 'a', String(m[1]));
    e.setProfit('2026-Q2', 'F01', m[0], 't', String(m[2]));
  });
  const p = e.profitOf('2026-Q2', 'F01');
  ok(p.actual === 32000 && p.target === 30000, '3ヶ月を合計する', [p.actual, p.target]);
  ok(p.pct === 107, '達成率 107%', p.pct);
  ok(p.filled === 3, '入力済み月数を数える', p.filled);
  ok(p.byMonth.length === 3, '月ごとの値を返す', p.byMonth.length);
  /* 算定へ反映される */
  const sp = e.storeProfit(e.cfg(), 'F01');
  ok(sp.pct === 107 && sp.src === 'q', '算定側が四半期の利益を使う', sp);
  const b = e.calc(EMPS[0], e.cfg());
  ok(b.spPct === 107, '査定に反映される', b.spPct);
  ok(b.spCoef === 1.01, '係数 ×1.01', b.spCoef);
  /* 基準額が無い店は中立 */
  const sp2 = e.storeProfit(e.cfg(), 'F04-K');
  ok(sp2.pct === 100 && sp2.src === 'none', '未入力の店は100%＝中立（0%にしない）', sp2);
  /* 空文字を入れても壊れない */
  e.setProfit('2026-Q2', 'F01', '2026-05', 'a', '');
  ok(e.profitOf('2026-Q2', 'F01').actual === 23000, '空にした月は合計から外れる', e.profitOf('2026-Q2', 'F01').actual);
  e.setProfit('2026-Q2', 'F01', '2026-05', 'a', 'あいうえお');
  ok(e.profitOf('2026-Q2', 'F01').actual === 23000, '数字でない入力は無視される');
}

/* ---------- 4. Career Score の凍結 ---------- */
console.log('\n[4] Career Score の確定');
{
  const e = build(); setup(e);
  let b = e.calc(EMPS[0], e.cfg());
  ok(b.csPct === 60 && b.csFrozen === false, '確定前は最新の評価を反映', [b.csPct, b.csFrozen]);
  /* 評価が上がると査定も動く（確定前） */
  LSS['山田'].totalPct = 90;
  b = e.calc(EMPS[0], e.cfg());
  ok(b.csPct === 90, '確定前は評価の変化が反映される', b.csPct);
  /* ここで確定 */
  e.freezeOne('2026-Q2', 'e1', true);
  b = e.calc(EMPS[0], e.cfg());
  ok(b.csFrozen === true, '確定済みになる');
  ok(b.csPct === 90, '確定した時点の点数', b.csPct);
  /* 確定後に評価が変わっても査定は動かない */
  LSS['山田'].totalPct = 20;
  b = e.calc(EMPS[0], e.cfg());
  ok(b.csPct === 90, '後から評価が変わっても査定は動かない（最重要）', b.csPct);
  /* csMin0.7 + (1.3-0.7)*0.9 = 1.24。凍結した90%から算出されている。 */
  ok(b.csCoef === 1.24, '係数も確定時点の90%から出ている（×1.24）', b.csCoef);
  ok(b.csCoef !== 0.82, '最新の20%（×0.82）にはなっていない', b.csCoef);
  /* 他の人は影響を受けない */
  const b2 = e.calc(EMPS[1], e.cfg());
  ok(b2.csFrozen === false && b2.csPct === 80, '確定していない人は最新のまま', [b2.csFrozen, b2.csPct]);
  /* 解除すると最新に戻る */
  e.unfreeze('2026-Q2', 'e1');
  b = e.calc(EMPS[0], e.cfg());
  ok(b.csFrozen === false && b.csPct === 20, '解除で最新に戻る', [b.csFrozen, b.csPct]);
  LSS['山田'].totalPct = 60;
  /* 四半期が違えば別に凍結される */
  e.freezeOne('2026-Q2', 'e1', true);
  ok(!!e.get('2026-Q2').csFreeze['e1'], 'Q2 で確定している');
  ok(!e.get('2026-Q3').csFreeze['e1'], 'Q3 では確定していない');
}

/* ---------- 5. 段階の判定 ---------- */
console.log('\n[5] 段階');
{
  const e = build('2026-07-15'); setup(e);
  let st = e.stages('2026-Q2');
  ok(st.actual.done === true, 'Q2（4-6月）は3ヶ月とも経過している', st.actual);
  ok(st.budget.done === false && st.budget.n === 0, '予算コミットは未', st.budget);
  e.commit('F01', 2026, 2);
  st = e.stages('2026-Q2');
  ok(st.budget.n === 1, 'コミットした店が数えられる', st.budget);
  ok(st.profit.done === false, '利益は未確定');
  ok(st.cs.done === false, 'CS も未確定');
  /* 進行中のQ3 */
  const st3 = e.stages('2026-Q3');
  ok(st3.actual.done === false && st3.actual.n === 0, 'Q3 は進行中', st3.actual);
  /* 利益を確定 */
  e.setProfit('2026-Q2', 'F01', '2026-04', 'a', '12000');
  e.setProfit('2026-Q2', 'F01', '2026-04', 't', '10000');
  e.setProfit('2026-Q2', 'F04-K', '2026-04', 'a', '9000');
  e.setProfit('2026-Q2', 'F04-K', '2026-04', 't', '10000');
  e.lockProfit('2026-Q2');
  st = e.stages('2026-Q2');
  ok(st.profit.done === true && st.profit.locked === true, '利益が確定になる', st.profit);
  ok(st.ready === true, '査定を確定できる状態になる', st.ready);
}

/* ---------- 6. 確定すると入力が締まる ---------- */
console.log('\n[6] 確定と締め');
{
  const e = build('2026-07-15'); setup(e);
  e.setProfit('2026-Q2', 'F01', '2026-04', 'a', '12000');
  e.setProfit('2026-Q2', 'F01', '2026-04', 't', '10000');
  e.lockProfit('2026-Q2');
  const before = JSON.stringify(e.profitOf('2026-Q2', 'F01'));
  e.setProfit('2026-Q2', 'F01', '2026-05', 'a', '99999');
  ok(JSON.stringify(e.profitOf('2026-Q2', 'F01')) === before, '確定後は利益を書き換えられない');
  ok(e.toasts().some(function (t) { return /確定済み/.test(t[0]); }), '締まっている理由が伝わる');
  /* 四半期を確定 */
  e.lockQ('2026-Q2');
  const d = e.get('2026-Q2');
  ok(d.locked === true, '四半期が確定になる');
  ok(!!d.lockedAt && !!d.lockedBy, '確定した人と日時が残る', [d.lockedBy, d.lockedAt]);
  ok(!!d.csFreeze['e1'] && !!d.csFreeze['e2'], '確定時に未凍結のCSも自動で確定される', Object.keys(d.csFreeze));
  /* 確定後は利益の解除もできない */
  e.unlockProfit('2026-Q2');
  ok(e.get('2026-Q2').profitLocked === true, '査定確定中は利益の解除を止める');
  /* 解除すれば戻せる */
  e.unlockQ('2026-Q2');
  ok(e.get('2026-Q2').locked === false, '解除できる');
  /* Q3 には影響しない */
  ok(e.get('2026-Q3').locked === false, '他の四半期は確定していない');
}

/* ---------- 7. 権限 ---------- */
console.log('\n[7] 権限');
{
  const e = build(); setup(e);
  e.role('sl');
  e.lockProfit('2026-Q2');
  ok(e.get('2026-Q2').profitLocked === false, 'SL は利益を確定できない');
  e.lockQ('2026-Q2');
  ok(e.get('2026-Q2').locked === false, 'SL は査定を確定できない');
  e.freezeAll('2026-Q2');
  ok(Object.keys(e.get('2026-Q2').csFreeze).length === 0, 'SL は CS を確定できない');
  ['bqLockProfit', 'bqLockQuarter', 'bqUnlockQuarter', 'bqCsFreezeAll', 'bqUnlockProfit', 'bqCsUnfreeze'].forEach(function (fn) {
    ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(grab(src, fn)), fn + ' は GM・CEO のみ');
  });
}

/* ---------- 8. 予算達成率は常に最新（途中経過も見える） ---------- */
console.log('\n[8] 予算達成率');
{
  const e = build('2026-07-15'); setup(e);
  const b2 = e.calc(EMPS[0], e.cfg());
  ok(b2.ba.pct === 110 && b2.ba.basis === 'full', 'Q2 は四半期予算と比較', [b2.ba.pct, b2.ba.basis]);
  e.setQ('2026-Q3');
  const b3 = e.calc(EMPS[0], e.cfg());
  ok(b3.ba.inProgress === true && b3.ba.basis === 'pace', 'Q3 は途中経過（経過ぶんと比較）', b3.ba);
  ok(b3.ba.pct === 110, '途中経過でも達成率が出る', b3.ba.pct);
  const h = e.pipeline('2026-Q3', e.cfg());
  ok(/進行中/.test(h), '進行中であることが画面に出る');
  ok(/途中経過/.test(h), '途中経過だと明記されている');
}

/* ---------- 9. 画面 ---------- */
console.log('\n[9] 画面');
{
  const e = build('2026-07-15'); setup(e);
  e.setProfit('2026-Q2', 'F01', '2026-04', 'a', '12000');
  e.setProfit('2026-Q2', 'F01', '2026-04', 't', '10000');
  const p = e.profitUI('2026-Q2', e.cfg());
  ok(/2026-04/.test(p) || /04月/.test(p), '月ごとの入力欄が出る');
  ok(/bqSetProfit/.test(p), '入力すると保存される');
  ok(/Q合計/.test(p) && /達成率/.test(p) && /係数/.test(p), '合計・達成率・係数が並ぶ');
  ok(/ToriTon/.test(p) && /Kaimuki/.test(p), '対象店舗が並ぶ');
  const pipe = e.pipeline('2026-Q2', e.cfg());
  ['予算コミット', '実績', '利益入力', 'Career Score', '査定確定'].forEach(function (s) {
    ok(pipe.indexOf(s) >= 0, '段階「' + s + '」が出る');
  });
  ok(/bqLockQuarter/.test(pipe), '査定確定のボタンがある');
  ok(/bqCsFreezeAll/.test(pipe), 'CSを今の評価で確定するボタンがある');
  /* 確定後は入力欄が消える */
  e.lockProfit('2026-Q2');
  const p2 = e.profitUI('2026-Q2', e.cfg());
  ok(!/bqSetProfit/.test(p2), '確定後は入力欄が出ない');
  ok(/確定済み/.test(p2), '確定済みと表示される');
  ok(/\$12,000/.test(p2), '確定後も数字は読める');
  /* 算定根拠にCS凍結が反映される */
  e.freezeOne('2026-Q2', 'e1', true);
  const b = e.calc(EMPS[0], e.cfg());
  const bd = e.breakdown(EMPS[0], b, e.cfg());
  ok(/Career Score/.test(bd), '算定根拠にCSの段がある');
  ok(/接客/.test(bd), '凍結した内訳が出る');
}

/* ---------- 10. 副作用 ---------- */
console.log('\n[10] 副作用');
{
  const e = build(); setup(e);
  const before = JSON.stringify(e.store());
  e.stages('2026-Q2'); e.profitOf('2026-Q2', 'F01'); e.calc(EMPS[0], e.cfg());
  e.pipeline('2026-Q2', e.cfg()); e.profitUI('2026-Q2', e.cfg());
  ok(JSON.stringify(e.store()) === before, '表示・判定は何も保存しない');
  ['bqStageState', 'bqProfitOf', 'renderBqPipeline', 'renderBqProfit', 'bqStores'].forEach(function (fn) {
    ok(!/lsSet\(/.test(grab(src, fn)), fn + ' は保存しない');
  });
  /* 算定式は v796 から変わっていない（掛け算の並び） */
  ok(/base\*ba\.coef\*spf\*csf/.test(grab(src, 'bonusForEmp')), '算定式そのものは変えていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
