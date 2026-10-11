// v1065 (UI案42・Moto 10/11): growth-chart "個別評価" tab and the 4-item bonus from 2026 Q3.
// amount per grade segment = base × days/quarter days × ① Career × ② sales × ③ FL × ④ profit (each "reflected" or fixed at 1.00);
// over the pool, everyone gets the same factor, floored to $1 with the remainder handed out by largest fraction;
// confirming the quarter freezes everything, and pay history is written only after confirming.
// Runs the real code from index.html (the FUNERGY_KARTE_EVAL and FUNERGY_CAREER_CRITERIA blocks and the hooks) in a VM
// with synthetic staff, budgets, sales, costs and scores (the same fictional numbers as UI案42). No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
function block(startMark, endMark) {
  const i = source.indexOf(startMark), j = source.indexOf(endMark, i);
  assert.ok(i >= 0 && j > i, startMark);
  return source.slice(i, j + endMark.length);
}
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start + 1), line = source.slice(start + 1, lineEnd), code = line.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '');
  if (code.trimEnd().endsWith('}') && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length) return line;
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
const varBlock = (name, close) => block('\n' + (source.includes('\nconst ' + name + ' = ') ? 'const ' : 'var ') + name + ' = ', close).replace(/^\nconst /, '\nvar ');
const CAREER = block('/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */');
const KEV = block('/* FUNERGY_KARTE_EVAL_BEGIN */', '/* FUNERGY_KARTE_EVAL_END */');

const Q = '2026-Q3', QR = { q: Q, qs: '2026-07-01', qe: '2026-09-30', n: 92 };
const MONTHS = ['2026-07', '2026-08', '2026-09'];
// fictional stores: monthly sales budget / actual sales / cost of goods / labor, quarterly profit target / actual, KPI targets
const STORES = {
  S1: { b: [320000, 320000, 320000], a: [333440, 333440, 333440], fc: 31.2, lb: 27.9, tF: 30.0, tL: 28.0, pt: [46667, 46667, 46666], pa: [44333, 44333, 44334] },
  S2: { b: [300000, 300000, 300000], a: [309000, 309000, 309000], fc: 30.9, lb: 27.2, tF: 30.0, tL: 28.0, pt: [41667, 41667, 41666], pa: [38333, 38333, 38334] },
  S3: { b: [300000, 300000, 300000], a: [288000, 288000, 288000], fc: 30.2, lb: 28.9, tF: 31.0, tL: 28.0, pt: [33333, 33333, 33334], pa: [31000, 31000, 31000] },
  S4: { b: [333334, 333333, 333333], a: [320000, 320000, 320000], fc: 30.2, lb: 28.9, tF: 31.0, tL: 28.0, pt: [33333, 33333, 33334], pa: [31000, 31000, 31000] },
  S5: { b: [400000, 400000, 400000], a: [400100, 400100, 400100], fc: 30.0, lb: 28.0, tF: 30.0, tL: 28.0, pt: [33333, 33333, 33334], pa: [33400, 33400, 33400] },
};
const PEOPLE = [
  { id: 'aki', name: 'Aki Sample', title: 'Crew Leader', g: 'G2', store: 'S1' },
  { id: 'ken', name: 'Ken Sample', title: 'Server Leader', g: 'G3', store: 'S1' },
  { id: 'neo', name: 'Neo Sample', title: 'Kitchen Leader', g: 'G3', store: 'S2' },
  { id: 'mia', name: 'Mia Sample', title: 'Store Manager', g: 'G4', store: 'S2' },
  { id: 'ray', name: 'Ray Sample', title: 'Head Chef', g: 'G4', store: 'S3', stores: ['S3', 'S4'] },
  { id: 'sam', name: 'Sam Sample', title: 'Area Manager', g: 'G5', store: 'S3', stores: ['S3', 'S4'] },
  { id: 'gus', name: 'Gus Sample', title: 'General Manager', g: 'G6', store: 'S5', stores: ['S5'] },
];
// Career Score philosophy (category H, 18 items): [number of 3s, number of 2s, number of 1s]
const PHILO = { aki: [2, 16, 0], ken: [4, 14, 0], neo: [0, 16, 2], mia: [1, 17, 0], ray: [8, 10, 0], sam: [5, 13, 0], gus: [0, 18, 0] };
const LEVELS = { aki: [3, 3, 2], ken: [4, 3, 4], neo: [3, 4, 3], mia: [4, 4, 3], ray: [4, 5, 4], sam: [4, 4, 4], gus: [3, 3, 3] };

function app() {
  const c = { console, STORE: {}, EMPS: [], SEGS: {}, SCORES: {}, TOASTS: [], ALERTS: [], MODAL: [], RERENDER: 0, CONFIRM: true, POOL: 31858, curRole: 'gm', curLang: 'ja', curUserName: 'CEO Sample', OCS: {}, PREV: {} };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('GRADE_TITLES', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'), varBlock('LSS_EMP_PREFIX', ';'),
    ...['ghNormG', 'lssCatsOrdered', 'lssItemId', 'gradeOf', 'empGrade', 'empSpecialistDept', 'ghRecs', 'ghAll', 'ghCmp', 'ghDate', 'ghMD', 'bqProfitOf', 'bqProfitMonths', '_quarterMonths',
      '_recAt', 'mergeMapByTime', 'bqStores', 'bonusSegEval', 'bonusForEmp', 'bonusTotals', 'bqLockQuarter', 'bqUnlockQuarter', 'bonusConfirmQuarter', 'bonusConfirmOne', '_bonusWritePay', 'kdCurAmount', 'karteSetTab'].map(fn), CAREER, KEV].join('\n') + `
    var window = this, BQ_STAGES=[];
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ if (typeof FAIL_SET !== 'undefined' && FAIL_SET === k) return false; STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function _bonusQParse(q){ var m=String(q||'').match(/(\\d{4})\\D*Q?([1-4])/i); return m ? { y:+m[1], q:+m[2] } : null; }
    function t(a, b){ return curLang === 'en' ? b : a; }
    function escapeHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function nowJP(){ return '2026/10/11 10:40'; } function myName(){ return curUserName; } var ROLE_CONFIG = { gm:{ name:'GM' } };
    function todayISO(){ return '2026-10-11'; }
    function getEmployees(){ return EMPS; } function ocsOldLocked(n){ return !!OCS[n]; }
    function ocsEv(id, q){ return OCS['ev:'+id] || null; } function ocsEvState(ev){ return ev.state; }
    function _bqNow(){ return '2026/10/11 10:40'; } function _bqWho(){ return curUserName; }
    function showToast(m, k){ TOASTS.push([m, k]); } function alert(m){ ALERTS.push(m); } function kbRefresh(){} function karteRerender(){ RERENDER++; } function bqRefresh(){}
    function openModal(h){ MODAL.push(h); } function closeModalDirect(){} function confirm(){ return CONFIRM; } function renderPage(){} function openKarteDetail(){}
    function getLssScores(n){ return SCORES[n] || null; }
    function lssCatsForName(){ return lssCatsOrdered(); }
    function lssSummary(n){ var r=SCORES[n]; if(!r) return null; var cats=lssCatsOrdered().map(function(c){ var s=0; c.items.forEach(function(l,i){ s+=(parseInt(r.scores[lssItemId(c.key,i)])||0); }); return {key:c.key, name:c.name, score:s, max:c.items.length*3, pct:Math.round(s/(c.items.length*3)*100)}; });
      var ts=cats.reduce(function(a,x){return a+x.score;},0), tm=cats.reduce(function(a,x){return a+x.max;},0); return {hasData:true, cats:cats, totalScore:ts, totalMax:tm, totalPct:Math.round(ts/tm*100)}; }
    function ghBadge(g){ return '[' + g + ']'; } function _money(n){ return '$' + Math.round(n); } function _owStoreName(s){ return 'Store ' + String(s).slice(1); }
    var QR = ${JSON.stringify(QR)};
    function ghQRange(q){ var m=String(q||'').match(/^(\\d{4})-Q([1-4])$/); if(!m) return null; if(q===QR.q) return QR; var y=+m[1], n=+m[2]; return {q:q, qs:y+'-'+String((n-1)*3+1).padStart(2,'0')+'-01', qe:'x', n:91}; }
    function ghQOf(){ return QR.q; }
    function bqAll(){ return ls('bonus_q', {}); }
    function bqGet(q){ var d=bqAll()[q]; d=(d && typeof d==='object') ? d : {}; return Object.assign({}, d, {profit:d.profit||{}, csFreeze:d.csFreeze||{}, incl:d.incl||{}, co:d.co||{}, locked:!!d.locked}); }
    function bqSet(q, d){ var m=bqAll(); d._at=Date.now(); m[q]=d; return lsSet('bonus_q', m); }
    function bonusSegs(e, qr, d){ if(d && d.locked && d.segSnap && d.segSnap[e.id]) return d.segSnap[e.id]; return (SEGS[e.id] || [{ g:ghNormG(empGrade(e)), from:QR.qs, to:QR.qe, days:QR.n }]).map(function(x){ return Object.assign({}, x); }); }
    function kbCfg(){ return Object.assign({ quarter:QR.q, gradeBase:{G2:1000,G3:3000,G4:5000,G5:8000,G6:12000}, baMin:0.8, baMax:1.2, spMin:0.8, spMax:1.2, csMin:0.7, csMax:1.3, empStore:{} }, ls('karte_bonus_config', {})); }
    function kbSave(c){ lsSet('karte_bonus_config', c); }
    function karteEligibleEmps(){ return EMPS.filter(function(e){ return !e.out && ['G2','G3','G4','G5','G6'].indexOf(ghNormG(empGrade(e)))>=0 || (SEGS[e.id] && SEGS[e.id].some(function(x){ return ['G2','G3','G4','G5','G6'].indexOf(x.g)>=0; })); }); }
    function karteEmpStores(cfg, e){ return e.stores ? e.stores.slice() : [e.store]; }
    function karteEmpStoreBasis(){ return {label:'自動'}; }
    function bonusPoolInfo(cfg, q){ return {q:q, known:POOL!=null, amount:POOL, margin:11.1, rate:9, row:{lo:11, hi:12, r:9}, profit:353978}; }
    function bqStageState(){ return {actual:{done:true, n:3}, budget:{done:true, n:5, tot:5}, profit:{done:true}, cs:{}, confirm:{}}; }
    var STORES = ${JSON.stringify(STORES)}, MONTHS = ${JSON.stringify(MONTHS)};
    function _ymToOffset(ym){ var p=ym.split('-'); return (+p[0])*12+(+p[1]-1)-(2026*12+9); }
    function monthSalesBudget(sid, ym){ var s=STORES[sid], i=MONTHS.indexOf(ym); return (s && i>=0 && s.b) ? s.b[i] : 0; }
    function _meetPlKpi(){ return null; }
    function monthStats(sid, off){ var s=STORES[sid], i=off+3; if(!s || !s.a || i<0 || i>2 || s.a[i]==null) return {hasData:false, sales:0}; return {hasData:true, sales:s.a[i]}; }
    function qcPaceRatio(){ return 1; }
    function plComputeStore(sid, ym, off){ var s=STORES[sid], i=MONTHS.indexOf(ym); if(!s || !s.a || s.a[i]==null) return {sales:0, cogs:0, labor:0}; return {sales:s.a[i], cogs:Math.round(s.a[i]*s.fc/100), labor:Math.round(s.a[i]*s.lb/100), cogsSrc:s.prov ? '仕入合計（暫定・期末棚卸待ち）' : '棚卸法（確定）'}; }
    function quarterTargets(sid){ var s=STORES[sid]; return s ? {sales:(s.b||[]).reduce(function(a,b){return a+b;},0), fcRate:s.tF, laborRate:s.tL} : {}; }
    function getKarteAll(){ return ls('growth_karte', {}); } function getKarte(id){ return getKarteAll()[id] || {}; }
    function karteScopeStores(){ return Object.keys(STORES).map(function(k){ return {id:k, name:'Store '+k.slice(1)}; }); }
    function renderKarteQuarterBar(){ return '<quarter-bar>'; } function cscJsArg(v){ return escapeHtml(JSON.stringify(String(v==null?'':v))); }
    function _outboxGet(){ return []; }`, c);
  return c;
}
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
function philoScores(spec) {   // [threes, twos, ones] over the 18 philosophy items; other categories at 2
  const sc = {}; let i = 0;
  const put = (n, v) => { for (let k = 0; k < n; k++) sc['H' + (i++)] = v; };
  put(spec[0], 3); put(spec[1], 2); put(spec[2], 1);
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) for (let j = 0; j < 30; j++) sc[key + j] = 2;
  return sc;
}
function profitStore(c) {   // the hand-entered monthly profit (actual / target) for every store
  const p = {};
  for (const [sid, s] of Object.entries(STORES)) { p[sid] = {}; MONTHS.forEach((ym, i) => { p[sid][ym] = { a: s.pa[i], t: s.pt[i] }; }); }
  return p;
}
// The fictional company of UI案42: seven people evaluated and marked done, profit entered, pool $31,858
function company(opts = {}) {
  const c = app();
  c.EMPS = PEOPLE.map(p => Object.assign({ status: '在籍' }, p, { role: p.g === 'G6' ? 'gm' : '' }));
  for (const e of c.EMPS) c.SCORES[e.name] = { evaluator: 'GM', date: '2026/09/20', scores: philoScores(PHILO[e.id]), status: '確定' };
  c.STORE.bonus_q = { [Q]: { profit: profitStore(c) } };
  c.STORE.bonus_coef_rng = {};   // ① range: the current default 0.70–1.30 for every grade
  // Ray (Head Chef): ② fixed at 1.00 and ③ Food 80% / Labor 20% (personal settings, with reasons)
  c.STORE.bonus_eval_ovr = { 'ray|2026-Q3': { set: { s: { on: false }, fl: { fw: 80, lw: 20 } }, why: 'キッチン統括', at: '2026/10/03 14:20', by: 'GM', _at: 1 } };
  const ev = {};
  for (const e of c.EMPS) {
    const [ab, kn, qu] = LEVELS[e.id];
    const r = { ab: { lv: ab, ev: ab !== 3 ? '8/24 の場面' : '' }, kn: { lv: kn, ev: kn !== 3 ? '9/2 の場面' : '' }, qu: { lv: qu, ev: qu !== 3 ? '7〜9 月' : '' }, st: 'done', _at: 1 };
    if (e.id === 'mia' || e.id === 'ray') { r.fa = { lv: 4, qc: true, ev: '発注表', what: '発注量の調整' }; r.la = { lv: 3 }; }
    if (e.id === 'sam') { r.fa = { lv: 5, qc: true, ev: '発注の仕組みを全店に' }; r.la = { lv: 4, qc: true, ev: 'シフト' }; }
    ev[`${Q}|${e.id}|${e.g}`] = r;
  }
  c.STORE.bonus_eval = ev;
  if (opts.tia) {
    c.EMPS.push({ id: 'tia', name: 'Tia Sample', title: 'Crew Leader', g: 'G2', store: 'S2', status: '在籍' });
    c.SEGS.tia = [{ g: 'G1', from: '2026-07-01', to: '2026-08-15', days: 46 }, { g: 'G2', from: '2026-08-16', to: '2026-09-30', days: 46 }];
    const sc = philoScores([0, 16, 0]);   // 16 philosophy items scored, 2 left blank
    c.SCORES['Tia Sample'] = { evaluator: 'GM', date: '2026/09/25', scores: sc, status: '確定' };
    c.STORE.bonus_eval[`${Q}|tia|G2`] = { ab: { lv: 3 }, kn: { lv: 3 }, qu: { lv: 4, ev: '引継ぎ' }, st: 'done', _at: 1 };
  }
  return c;
}
const person = (c, id) => { c.ID = id; return run(c, 'bonusForEmp(EMPS.find(function(e){ return e.id===ID; }), kbCfg())'); };
const totals = c => run(c, 'bonusTotals(kbCfg())');

test('the fictional company of UI案42: every number on the 計算例 board comes out of the code', () => {
  const c = company();
  const amt = Object.fromEntries(PEOPLE.map(p => [p.id, person(c, p.id)]));
  for (const [id, want] of Object.entries({ aki: 970, ken: 3270, neo: 3090, mia: 5563, ray: 6077, sam: 8860, gus: 12000 })) {
    assert.equal(amt[id].blocked, null, id + ' is complete');
    assert.equal(amt[id].amount, want, id);
  }
  const ken = amt.ken.segs[0];
  assert.deepEqual([ken.key, ken.coefs.c, ken.items.c.score.toFixed(2), ken.items.c.parts.ph.pts.toFixed(2)], ['G3-sv', 1.09, '65.28', '61.11']);
  assert.deepEqual([ken.items.s.on, ken.items.f.on, ken.items.p.on], [false, false, false], 'G3: only ① is reflected');
  assert.equal(ken.items.s.pct.toFixed(1), '104.2', 'G3: the sales number is still shown');
  const mia = amt.mia.segs[0];
  assert.deepEqual([mia.coefs.c, mia.coefs.s, mia.coefs.f, mia.coefs.p], [1.08, 1.01, 1.02, 1]);
  assert.deepEqual([mia.items.s.pct.toFixed(1), mia.items.f.food.pts.toFixed(1), mia.items.f.labor.pts.toFixed(1), mia.items.f.score.toFixed(1), mia.items.p.pct.toFixed(1)], ['103.0', '68.2', '51.6', '59.9', '92.0']);
  assert.equal(mia.items.p.on, false, 'G4: ④ fixed at 1.00 (but evaluated)');
  const ray = amt.ray.segs[0];
  assert.deepEqual([ray.coefs.c, ray.coefs.s, ray.coefs.f], [1.18, 1, 1.03]);
  assert.deepEqual([ray.src.s, ray.src.f, ray.src.c], ['person', 'person', 'grade']);
  assert.equal(ray.items.s.pct.toFixed(1), '96.0', 'the 2 stores are summed');
  const sam = amt.sam.segs[0];
  assert.deepEqual([sam.coefs.c, sam.coefs.s, sam.coefs.f, sam.coefs.p, sam.items.p.pct.toFixed(1)], [1.13, 0.99, 1, 0.99, '93.0']);
  assert.equal(sam.items.f.on, false, 'G5: ③ only evaluated');
  assert.deepEqual([sam.items.f.score.toFixed(1), sam.items.f.coef], ['68.5', 1.04], 'its FL score would give ×1.04 if reflected, but does not count');
  const gus = amt.gus.segs[0];
  assert.deepEqual([gus.coefs.c, gus.coefs.s, gus.coefs.f, gus.coefs.p], [1, 1, 1, 1]);
  assert.equal(amt.gus.amount, 12000, 'all four at 1.00 = the base amount');
  // the pool: floor, then the remainder by largest fraction; the current rounding would overshoot by $2
  const tot = totals(c);
  assert.equal(tot.total, 39830);
  assert.equal(tot.k.toFixed(5), '0.79985');
  assert.deepEqual(tot.finals, { aki: 776, ken: 2615, neo: 2471, mia: 4450, ray: 4861, sam: 7087, gus: 9598 });
  assert.equal(tot.paid, 31858);
  const rounded = Object.values({ aki: 970, ken: 3270, neo: 3090, mia: 5563, ray: 6077, sam: 8860, gus: 12000 }).reduce((a, x) => a + Math.round(x * 31858 / 39830), 0);
  assert.equal(rounded, 31860, 'rounding each person would pay $2 over the pool');
});

test('G2/G3: store numbers do not move the amount; G4 FL weights action over result', () => {
  const c = company();
  for (const f of [0.85, 1.15]) {
    c.SALES = f;
    vm.runInContext(`STORES.S1.a = [${[0, 1, 2].map(i => Math.round(320000 * f))}];`, c);
    assert.equal(person(c, 'ken').amount, 3270, 'sales at ' + f * 100 + '%');
  }
  const c2 = company();
  c2.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { fl: { aw: 20, rw: 80 } }, why: 'test', _at: 1 } };
  const mia = person(c2, 'mia');
  assert.deepEqual([mia.segs[0].items.f.score.toFixed(1), mia.segs[0].coefs.f, mia.amount], ['52.1', 1, 5454], 'result-heavy: ③ ×1.00 → $5,454');
});

test('personal settings: removing them shows the right amounts; the source of each value is shown', () => {
  const c = company();
  const pick = set => { c.SIM = { level: 'person', empId: 'ray', set, replace: true }; return run(c, 'kevBonusForEmp(EMPS.find(function(e){ return e.id==="ray"; }), kbCfg(), kevApplies(kbCfg()), SIM)').amount; };
  assert.equal(pick({ fl: { fw: 80, lw: 20 } }), 6016, 'drop ② only');
  assert.equal(pick({ s: { on: false } }), 6018, 'drop the ③ ratio only');
  assert.equal(pick({}), 5958, 'drop both');
  const R = run(c, `kevRuleFor('G4', '2026-Q3', 'ray')`);
  assert.deepEqual([R.src['s.on'], R.src['fl.fw'], R.src['fl.aw'], R.src['c.lo'], R.src['w.ab']], ['person', 'person', 'gradeDef', 'gradeDef', 'common'], 'G4 action 80% and the ① range are grade defaults; the weights are common');
  assert.equal(run(c, `kevItemSrc(kevRuleFor('G4','2026-Q3','ray').src,'s')`), 'person');
  assert.equal(run(c, `kevItemSrc(kevRuleFor('G4','2026-Q3','mia').src,'f')`), 'grade');
  // stores set on the person replace the automatic ones (for ②・③・④)
  c.STORE.bonus_eval_ovr['gus|2026-Q3'] = { set: { stores: ['S1'] }, why: 'Store 1 の立て直し', _at: 2 };
  const gus = person(c, 'gus');
  assert.deepEqual([J(gus.stores), gus.storeSrc, gus.segs[0].items.s.pct.toFixed(1)], [['S1'], 'person', '104.2']);
});

test('settings inherit common → grade/track → person by start quarter; G6 uses the G5 range; ① starts from today\'s grade range', () => {
  const c = company();
  c.STORE.bonus_coef_rng = { G5: { lo: 0.8, hi: 1.25, _at: 1 }, G6: { lo: 1.1, hi: 1.1, _at: 1 }, G4: { lo: 1.05, hi: 1.4, _at: 1 } };
  assert.deepEqual(run(c, `[kevRuleFor('G6','2026-Q3').r.c.lo, kevRuleFor('G6','2026-Q3').r.c.hi]`), [0.8, 1.25], 'G6 like G5 (no more single fixed coefficient)');
  assert.deepEqual(run(c, `[kevRuleFor('G4','2026-Q3').r.c.lo, kevRuleFor('G4','2026-Q3').r.c.hi]`), [0.7, 1.3], 'a range that does not contain 1.00 is not copied');
  assert.deepEqual(run(c, `['G2','G3-sv','G4','G5','G6'].map(function(k){ var r=kevRuleFor(k,'2026-Q3').r; return [r.c.on, r.s.on, r.f.on, r.p.on].map(Number).join(''); })`), ['1000', '1000', '1110', '1101', '1101']);
  // a common change from 2026-Q4 does not touch Q3; a grade change wins over common
  c.STORE.bonus_eval_rule = { '_common|2026-Q4': { set: { s: { lo: 0.9, hi: 1.1 } }, _at: 1 }, 'G5|2026-Q4': { set: { s: { lo: 0.95 } }, _at: 1 } };
  assert.deepEqual(run(c, `[kevRuleFor('G5','2026-Q3').r.s.lo, kevRuleFor('G5','2026-Q4').r.s.lo, kevRuleFor('G5','2026-Q4').r.s.hi, kevRuleFor('G4','2026-Q4').r.s.lo]`), [0.8, 0.95, 1.1, 0.9]);
  // ② ④ start from today's budget/profit ranges
  c.STORE.karte_bonus_config = { baMin: 0.9, baMax: 1.1, spMin: 0.85, spMax: 1.15 };
  assert.deepEqual(run(c, `(function(r){ return [r.s.lo, r.s.hi, r.p.lo, r.p.hi]; })(kevRuleFor('G5','2026-Q3').r)`), [0.9, 1.1, 0.85, 1.15]);
});

test('the coefficient: 1.00 at the stated point, stops at the ends, works with an uneven range', () => {
  const c = app();
  const r = { lo: 0.95, hi: 1.1, x0: 0, x1: 50, x2: 100 };
  assert.deepEqual(run(c, `[-5, 0, 25, 50, 75, 100, 130].map(function(x){ return kevCoef(x, ${JSON.stringify(r)}); })`), [0.95, 0.95, 0.98, 1, 1.05, 1.1, 1.1]);
  assert.equal(run(c, `kevCoef(103, {lo:0.8, hi:1.2, x0:0, x1:100, x2:200})`), 1.01);
  assert.equal(run(c, `kevCoef(null, {lo:0.8, hi:1.2, x0:0, x1:100, x2:200})`), null, 'no number → no coefficient (never 1.00)');
  assert.match(run(c, `kevRuleBad({lo:1.05, hi:1.3, x0:0, x1:50, x2:100})`), /1\.00 が下限〜上限の中/);
  assert.match(run(c, `kevRuleBad({lo:0.9, hi:1.1, x0:0, x1:100, x2:50})`), /順/);
  assert.match(run(c, `kevRuleBad({lo:0.955, hi:1.1, x0:0, x1:50, x2:100})`), /小数 2 桁/);
  assert.equal(run(c, `kevRuleBad({lo:1, hi:1, x0:0, x1:50, x2:100})`), '', '1.00–1.00 is allowed');
  // philosophy points: average ≤ 2 → ×25, above 2 → 50 + (a − 2) × 50
  assert.deepEqual(run(c, `[0, 1, 1.5, 2, 2.5, 3].map(kevPhiloPts)`), [0, 25, 37.5, 50, 75, 100]);
});

test('missing data is shown as missing, never filled with 0 or 1.00; a fixed item does not block', () => {
  const c = company();
  // Ken: a level not chosen → ① missing → no amount
  delete c.STORE.bonus_eval[`${Q}|ken|G3`].kn;
  let ken = person(c, 'ken');
  assert.deepEqual([ken.blocked, ken.amount], ['eval', 0]);
  assert.match(ken.missing.join(), /知識：未評価/);
  // philosophy evaluated before the quarter started → missing
  const c2 = company();
  c2.SCORES['Ken Sample'].date = '2026/06/12';
  ken = person(c2, 'ken');
  assert.equal(ken.blocked, 'eval');
  assert.match(ken.missing.join(), /6\/12.*四半期の初日より前/);
  // Mia: one month without a sales budget → partial (② is reflected for G4)
  const c3 = company();
  vm.runInContext('STORES.S2.b = [300000, 0, 300000];', c3);
  const mia = person(c3, 'mia');
  assert.equal(mia.blocked, 'eval');
  assert.match(mia.missing.join(), /売上予算が未設定の月があります（Store 2 8月）/);
  // ... but Neo (G3, same store, ② fixed) is not blocked by it
  assert.equal(person(c3, 'neo').blocked, null);
  // a month with neither budget nor sales (closed) is not counted
  vm.runInContext('STORES.S2.b = [300000, 0, 300000]; STORES.S2.a = [309000, null, 309000];', c3);
  const mia2 = person(c3, 'mia');
  assert.equal(mia2.segs[0].items.s.status, 'ok');
  assert.equal(mia2.segs[0].items.s.pct.toFixed(1), '103.0');
  // a month with a budget but no sales figure yet → not taken as 0
  vm.runInContext('STORES.S2.b = [300000, 300000, 300000]; STORES.S2.a = [309000, 309000, null];', c3);
  const mia3 = person(c3, 'mia');
  assert.equal(mia3.blocked, 'eval');
  assert.match(mia3.missing.join(), /売上の実績が未取得の月があります（Store 2 9月）/);
  // profit not entered for a month → ④ partial; Sam (④ reflected) is blocked, Ken (fixed) is not
  const c4 = company();
  c4.STORE.bonus_q[Q].profit.S3['2026-09'] = { a: '', t: 33334 };
  assert.match(person(c4, 'sam').missing.join(), /利益の実績・基準額が未入力の月があります（Store 3 9月）/);
  // a zero/negative profit target: compared by the difference over the sales budget
  const c5 = company();
  for (const ym of MONTHS) c5.STORE.bonus_q[Q].profit.S5[ym] = { a: 2000, t: 0 };
  const gus = person(c5, 'gus').segs[0].items.p;
  assert.equal(gus.mode, 'diff');
  assert.equal(gus.dpt.toFixed(2), '0.50');   // (6000 − 0) / 1,200,000 = 0.5pt
  assert.equal(gus.coef, 1.02);
  vm.runInContext('STORES.S5.b = [400000, 0, 0];', c5);
  const gus2 = person(c5, 'gus');
  assert.deepEqual([gus2.blocked, gus2.segs[0].items.p.status, gus2.segs[0].items.p.coef], ['eval', 'unset', null]);
  assert.match(gus2.missing.join(), /比べる売上予算がそろっていません/);
});

test('FL: a result far below target is capped at 75 points until the evaluator confirms; level 4–5 needs the quality check', () => {
  const c = company();
  vm.runInContext('STORES.S2.fc = 26.5;', c);   // 3.5pt below the 30.0% target
  let f = person(c, 'mia').segs[0].items.f.food;
  assert.deepEqual([f.res.raw, f.res.pts, f.res.check, f.res.capped], [85, 75, true, true]);
  c.STORE.bonus_eval[`${Q}|mia|G4`].fa.okLow = true;
  f = person(c, 'mia').segs[0].items.f.food;
  assert.deepEqual([f.res.pts, f.res.capped], [85, false]);
  delete c.STORE.bonus_eval[`${Q}|mia|G4`].fa.qc;
  assert.match(person(c, 'mia').missing.join(), /品質・量・サービスへの影響の確認が未チェック/);
});

test('philosophy source: the grade change record for the earlier segment, a frozen score, office staff use the office Career Score', () => {
  const c = company();
  c.SCORES['Ken Sample'] = undefined;
  c.STORE.bonus_q[Q].csFreeze = { ken: { kv: 1, at: '2026/10/01 09:00', date: '2026-09-28', ev: 'AM', hUn: 0, cats: [{ key: 'H', score: 40, max: 54 }] } };
  let ph = person(c, 'ken').segs[0].items.c.parts.ph;
  assert.deepEqual([ph.src, ph.missing, ph.pts.toFixed(1), ph.date, ph.by], ['frozen', null, '61.1', '2026-09-28', 'AM']);
  c.STORE.bonus_q[Q].csFreeze.ken.hUn = 2;
  assert.equal(person(c, 'ken').segs[0].items.c.parts.ph.missing, 'unscored');
  assert.match(person(c, 'ken').missing.join(), /固定した評価で理念の 2 項目が未採点.*固定し直して/);
  c.STORE.bonus_q[Q].csFreeze.ken.date = '2026-06-20'; c.STORE.bonus_q[Q].csFreeze.ken.hUn = 0;
  assert.match(person(c, 'ken').missing.join(), /固定した評価の評価日（6\/20）.*固定し直して/);
  // a freeze made by v1064 or earlier (no evaluation date, no unscored count) is not used: the latest score decides
  const c3 = company();
  c3.SCORES['Aki Sample'].date = '2026/06/15';
  delete c3.SCORES['Aki Sample'].scores.H0; delete c3.SCORES['Aki Sample'].scores.H1;
  assert.match(person(c3, 'aki').missing.join(), /6\/15/);
  c3.STORE.bonus_q[Q].csFreeze = { aki: { at: '2026/10/05 10:00', by: 'GM', cats: [{ key: 'H', score: 32, max: 54 }] } };
  const aki = person(c3, 'aki');
  assert.deepEqual([aki.blocked, aki.segs[0].items.c.parts.ph.src], ['eval', 'latest'], 'the old freeze does not hide the old date and the blank items');
  // confirming re-freezes it with today's score (date, evaluator, unscored count)
  c3.SCORES['Aki Sample'].date = '2026/09/22'; c3.SCORES['Aki Sample'].scores.H0 = 2; c3.SCORES['Aki Sample'].scores.H1 = 2;
  run(c3, `bqLockQuarter('${Q}')`);
  const fz = run(c3, `bqGet('${Q}').csFreeze.aki`);
  assert.deepEqual([run(c3, `bqGet('${Q}').locked`), fz.kv, fz.date, fz.hUn], [true, 1, '2026-09-22', 0]);
  // office staff: the office Career Score of the quarter, category A
  const c2 = company();
  c2.OCS['Gus Sample'] = true;
  c2.OCS['ev:gus'] = { conf: { at: '2026-09-29T10:00:00Z', by: 'CEO' }, state: { k: 'ok', calc: { cats: { A: { targets: 6, num: 6, uc: 0, sum: 12, max: 18 } } } } };
  ph = person(c2, 'gus').segs[0].items.c.parts.ph;
  assert.deepEqual([ph.src, ph.missing, ph.pts], ['ocs', null, 50]);
  c2.OCS['ev:gus'].state.calc.cats.A.uc = 1;
  assert.equal(person(c2, 'gus').segs[0].items.c.parts.ph.missing, 'unscored');
  delete c2.OCS['ev:gus'];
  assert.equal(person(c2, 'gus').segs[0].items.c.parts.ph.missing, 'none');
});

test('a G1 → G2 change mid-quarter: the G1 part is not paid; the G2 part waits for the missing philosophy items', () => {
  const c = company({ tia: true });
  let tia = person(c, 'tia');
  assert.deepEqual(tia.segs.map(x => [x.g, x.elig, x.days]), [['G1', false, 46], ['G2', true, 46]]);
  assert.equal(tia.blocked, 'eval');
  assert.match(tia.missing.join(), /理念：理念の 2 項目が未採点/);
  let tot = totals(c);
  assert.equal(tot.total, 39830, 'Tia is not in the estimate yet');
  assert.equal(tot.nBlocked, 1);
  assert.equal(tot.finals.tia, undefined, 'no estimate for a person who is still missing something (not $0)');
  c.SCORES['Tia Sample'].scores.H16 = 2; c.SCORES['Tia Sample'].scores.H17 = 2;
  tia = person(c, 'tia');
  assert.deepEqual([tia.blocked, tia.segs[1].coefs.c, tia.amount], [null, 1.04, 520]);
  tot = totals(c);
  assert.equal(tot.total, 40350);
  assert.equal(tot.paid, 31858, 'the pool is used exactly, never more');
});

test('a G4 → G5 change mid-quarter: each part uses its own evaluation and the philosophy score confirmed at the change', () => {
  const c = company();
  c.SEGS.sam = [{ g: 'G4', from: '2026-07-01', to: '2026-08-15', days: 46 }, { g: 'G5', from: '2026-08-16', to: '2026-09-30', days: 46 }];
  c.STORE.grade_hist = { sam: { recs: [{ d: '2026-08-15', g: 'G5', from: 'G4', start: false, prevEval: { g: 'G4', cats: [{ key: 'H', score: 30, max: 54 }], at: '2026-08-15 10:00', by: 'CEO' } }] } };
  c.STORE.bonus_eval[`${Q}|sam|G4`] = { ab: { lv: 2, ev: '7/20 の場面' }, kn: { lv: 3 }, qu: { lv: 3 }, fa: { lv: 3 }, la: { lv: 3 }, st: 'done', _at: 1 };
  const sam = person(c, 'sam');
  assert.equal(sam.blocked, null);
  const [a, b] = sam.segs;
  assert.deepEqual([a.g, a.key, a.items.c.parts.ab.lv, a.items.c.parts.ph.src, a.items.c.parts.ph.pts.toFixed(1), a.items.c.parts.ph.by], ['G4', 'G4', 2, 'grade', '41.7', 'CEO']);
  assert.deepEqual([b.g, b.key, b.items.c.parts.ab.lv, b.items.c.parts.ph.src], ['G5', 'G5', 4, 'latest']);
  assert.deepEqual([a.items.c.score.toFixed(2), a.coefs.c, a.items.p.on, a.items.f.on], ['41.67', 0.95, false, true], 'G4 part: ③ reflected, ④ fixed');
  assert.equal(a.amount, Math.round(2500 * a.mult));
  assert.equal(b.amount, Math.round(4000 * b.mult));
  assert.equal(sam.amount, a.amount + b.amount);
  // the G4 part is not evaluated yet → the whole person waits
  delete c.STORE.bonus_eval[`${Q}|sam|G4`];
  const sam2 = person(c, 'sam');
  assert.equal(sam2.blocked, 'eval');
  assert.match(sam2.missing.join(), /G4：能力：未評価/);
});

test('the pool: $0 pays $0; an unknown pool is not confirmed; at or above the total nobody is cut; ties go to the larger amount', () => {
  const c = app();
  const alloc = (list, P) => run(c, `kevAlloc(${JSON.stringify(list)}, ${JSON.stringify(P)})`);
  assert.deepEqual(alloc([{ id: 'a', raw: 500 }, { id: 'b', raw: 1000 }], 0).finals, { a: 0, b: 0 });
  assert.equal(alloc([{ id: 'a', raw: 500 }], null), null);
  assert.deepEqual(alloc([{ id: 'a', raw: 500 }, { id: 'b', raw: 1000 }], 2000), { k: 1, finals: { a: 500, b: 1000 }, sum: 1500, S: 1500, P: 2000 });
  assert.deepEqual(alloc([{ id: 'a', raw: 500 }, { id: 'b', raw: 1000 }, { id: 'c', raw: 10500 }], 10000).finals, { a: 417, b: 833, c: 8750 }, '416.67 / 833.33 / 8750 → the $1 left goes to the largest fraction');
  const r = alloc([{ id: 'a', raw: 500 }, { id: 'b', raw: 1000 }], 1200);   // spec example scaled: ×0.80
  assert.deepEqual(r.finals, { a: 400, b: 800 });
  assert.deepEqual(alloc([{ id: 'b', raw: 1 }, { id: 'a', raw: 1 }, { id: 'c', raw: 2 }], 2).finals, { a: 1, b: 0, c: 1 }, 'same fraction and amount: by id');
  assert.deepEqual(alloc([{ id: 'a', raw: 1 }, { id: 'b', raw: 3 }], 2).finals, { a: 0, b: 2 }, 'same fraction: the larger amount first');
  assert.deepEqual(alloc([{ id: 'a', raw: 1 }, { id: 'b', raw: 6 }, { id: 'c', raw: 3 }], 4).finals, { a: 0, b: 3, c: 1 }, '0.4 = 2.4 − 2 exactly: decided by the amount, not by rounding noise');
  assert.deepEqual(alloc([], 100).finals, {}, 'nobody: nothing to pay');
});

test('confirming: blocked while someone is missing, not done, or the pool is unknown; then everything is frozen', () => {
  const c = company({ tia: true });
  run(c, `bqLockQuarter('${Q}')`);
  assert.equal(run(c, `bqGet('${Q}').locked`), false);
  assert.match(c.TOASTS.at(-1)[0], /Tia Sample：理念/);
  c.SCORES['Tia Sample'].scores.H16 = 2; c.SCORES['Tia Sample'].scores.H17 = 2;
  c.STORE.bonus_eval[`${Q}|ken|G3`].st = 'edit';
  run(c, `bqLockQuarter('${Q}')`);
  assert.match(c.TOASTS.at(-1)[0], /Ken Sample：評価完了がまだです/);
  c.STORE.bonus_eval[`${Q}|ken|G3`].st = 'done';
  c.POOL = null;
  run(c, `bqLockQuarter('${Q}')`);
  assert.match(c.TOASTS.at(-1)[0], /原資が未設定/);
  c.POOL = 31858;
  // recording before confirming is refused (確定 → 記録 の順)
  run(c, 'bonusConfirmQuarter()');
  assert.match(c.ALERTS.at(-1), /先に「この四半期の査定を確定」/);
  assert.equal(c.STORE.growth_karte, undefined);
  run(c, `bqLockQuarter('${Q}')`);
  const d = run(c, `bqGet('${Q}')`);
  assert.equal(d.locked, true);
  assert.equal(d.evSnap.lk, d.lockedAt + '|' + d.lockedBy);
  assert.deepEqual([d.evSnap.S, d.evSnap.P, d.evSnap.paid], [40350, 31858, 31858]);
  assert.equal(Object.values(d.evSnap.finals).reduce((a, x) => a + x, 0), 31858);
  assert.equal(d.evSnap.people.mia.segs[0].items.f.score.toFixed(1), '59.9');
  // devices still on v1064 or earlier read the record as "coefficient not set" and do not calculate or record
  assert.ok(Object.values(d.coefSnap).every(sn => sn.segs.every(x => x.v === null && x.rv === null && x.lo != null && x.hi != null)));
  assert.equal(d.rangeLock, d.lockedAt + '|' + d.lockedBy);
  // the philosophy score was frozen with its evaluation date and evaluator
  assert.deepEqual([d.csFreeze.ken.date, d.csFreeze.ken.ev, d.csFreeze.ken.hUn], ['2026-09-20', 'GM', 0]);
  // later changes do not move a confirmed quarter
  const before = totals(c).finals;
  vm.runInContext('STORES.S2.a = [100, 100, 100];', c);
  c.STORE.bonus_eval[`${Q}|ken|G3`].ab.lv = 1;
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { s: { lo: 0.5, hi: 1.5 } }, _at: 2 } };
  assert.deepEqual(totals(c).finals, before);
  assert.equal(person(c, 'mia').amount, 5563);
  // inputs are refused once confirmed
  assert.equal(run(c, "kevEvEdit('mia','G4','ab.lv',1)"), false);
  assert.match(c.TOASTS.at(-1)[0], /確定した四半期は直せません/);
  assert.equal(c.STORE.bonus_eval[`${Q}|mia|G4`].ab.lv, 4);
  // recording writes the frozen final amounts
  run(c, 'bonusConfirmQuarter()');
  const pay = c.STORE.growth_karte;
  assert.equal(Object.keys(pay).length, 8);
  assert.deepEqual(['ken', 'mia', 'gus', 'tia'].map(id => pay[id].payLog[0].amount), [String(before.ken), String(before.mia), String(before.gus), String(before.tia)]);
  assert.equal(pay.mia.payLog[0].snap.v4, 1);
  // the recorded line is not undone by another device that still holds an older copy of the karte
  const stale = J(pay); stale.mia = { payLog: [], _at: 5 };
  assert.equal(run(c, `mergeMapByTime(${JSON.stringify(stale)}, ls('growth_karte', {}))`).mia.payLog.length, 1);
  assert.equal(run(c, `mergeMapByTime(ls('growth_karte', {}), ${JSON.stringify(stale)})`).mia.payLog.length, 1);
  assert.deepEqual(J(pay.mia.payLog[0].snap.segs[0].coefs), { c: 1.08, s: 1.01, f: 1.02, p: 1 });
  // unlocking clears the frozen record; the live numbers come back
  run(c, `bqUnlockQuarter('${Q}')`);
  assert.equal(run(c, `bqGet('${Q}').evSnap`), null);
  assert.notEqual(person(c, 'mia').amount, 5563);
});

test('quarters before 2026 Q3, and a 2026 Q3 confirmed by an older version, keep the old formula', () => {
  const c = company();
  assert.equal(run(c, `kevApplies(Object.assign(kbCfg(), {quarter:'2026-Q2'}))`), null);
  assert.ok(run(c, `!!kevApplies(kbCfg())`));
  c.STORE.bonus_q[Q] = Object.assign(c.STORE.bonus_q[Q], { locked: true, lockedAt: '2026/10/05 09:00', lockedBy: 'GM', rangeLock: '2026/10/05 09:00|GM' });
  assert.equal(run(c, `kevApplies(kbCfg())`), null);
  assert.equal(run(c, `kevOldLock(kbCfg())`), true);
  // a v1065 lock that an older device unlocked and locked again: the frozen record no longer belongs to this lock
  c.STORE.bonus_q[Q].evSnap = { lk: '2026/10/01 08:00|GM', people: {} };
  assert.equal(run(c, `kevApplies(kbCfg())`), null);
  // the order 確定 → 記録 holds for the old formula too
  const c2 = company();
  c2.STORE.karte_bonus_config = { quarter: '2026-Q2' };
  run(c2, "bonusConfirmOne('mia')");
  assert.match(c2.ALERTS.at(-1), /先に「この四半期の査定を確定」/);
  assert.equal(c2.STORE.growth_karte, undefined);
});

test('drafts: every input is saved as a draft; done needs reasons for levels other than 3; editing after done needs done again; no self-evaluation', () => {
  const c = company();
  delete c.STORE.bonus_eval[`${Q}|ken|G3`];
  run(c, `kevLv('ken','G3','ab',4)`);
  let r = c.STORE.bonus_eval[`${Q}|ken|G3`];
  assert.deepEqual([r.st, r.ab.lv, r.by], ['draft', 4, 'CEO Sample']);
  run(c, `kevLv('ken','G3','ab',4)`);
  assert.equal(c.STORE.bonus_eval[`${Q}|ken|G3`].ab.lv, null, 'pressing the chosen level again clears it');
  run(c, `kevLv('ken','G3','ab',4)`); run(c, `kevLv('ken','G3','kn',3)`); run(c, `kevLv('ken','G3','qu',3)`);
  run(c, 'kevDone("ken","G3")');
  assert.match(c.TOASTS.at(-1)[0], /能力：段階 3 以外は根拠を書いてください/);
  run(c, `kevTxt('ken','G3','ab.ev','8/24 ピーク時に配置を組み替えた')`);
  run(c, 'kevDone("ken","G3")');
  r = c.STORE.bonus_eval[`${Q}|ken|G3`];
  assert.deepEqual([r.st, r.doneBy], ['done', 'CEO Sample']);
  run(c, `kevTxt('ken','G3','cm','次は新人教育も')`);
  assert.equal(c.STORE.bonus_eval[`${Q}|ken|G3`].st, 'edit');
  assert.equal(person(c, 'ken').notDone, true);
  // a device that cannot store does not pretend it saved
  c.FAIL_SET = 'bonus_eval';
  run(c, `kevTxt('ken','G3','cm','x')`);
  assert.match(c.TOASTS.at(-1)[0], /保存できませんでした/);
  delete c.FAIL_SET;
  // the GM cannot evaluate or set themselves; an AM cannot use the tab's inputs
  c.curUserName = 'Gus Sample';
  run(c, `kevLv('gus','G6','ab',5)`);
  assert.match(c.TOASTS.at(-1)[0], /自分自身の評価は入力できません/);
  assert.equal(c.STORE.bonus_eval[`${Q}|gus|G6`].ab.lv, 3);
  c.curUserName = 'AM Sample'; c.curRole = 'am';
  run(c, `kevLv('ken','G3','ab',1)`);
  assert.match(c.TOASTS.at(-1)[0], /GM・CEO/);
});

test('saving settings: a reason and a start quarter are required; history is kept; a confirmed quarter cannot be changed', () => {
  const c = company();
  assert.equal(run(c, `kevOvrSave('mia','2026-Q3',{s:{on:false}},'店長代理の期間','② を変更')`), true);
  assert.equal(run(c, `kevOvrSave('mia','2026-Q4',{fl:{fw:70, lw:30}},'次の期から','③ を変更')`), true);
  const v = c.STORE.bonus_eval_ovr;
  assert.deepEqual(J(v['mia|2026-Q4'].set), { s: { on: false }, fl: { fw: 70, lw: 30 } }, 'a new version starts from the latest earlier one');
  assert.equal(run(c, `kevRuleFor('G4','2026-Q3','mia').r.fl.fw`), 50);
  assert.equal(run(c, `kevRuleFor('G4','2026-Q4','mia').r.fl.fw`), 70);
  assert.equal(run(c, `kevOvrSave('mia','2026-Q3',{s:{on:true}},'戻す','② を変更')`), true);
  assert.equal(c.STORE.bonus_eval_ovr['mia|2026-Q3'].hist.length, 1, 'the previous value is kept');
  c.curUserName = 'Mia Sample';
  assert.equal(run(c, `kevOvrSave('mia','2026-Q3',{s:{on:false}},'自分で','x')`), false, 'nobody changes their own settings');
  c.curUserName = 'CEO Sample';
  assert.equal(run(c, `kevRuleSave('G9','2026-Q3',{s:{on:false}},'x','x')`), false);
  // the form refuses without a reason, and for a confirmed quarter
  c.curRole = 'ceo';
  vm.runInContext(`var EL={'kevf-why':{value:''}, 'kevf-from':{value:'2026-Q3'}, 'kevf-lo':{value:'0.9'}, 'kevf-hi':{value:'1.1'}, 'kevf-x0':{value:'0'}, 'kevf-x1':{value:'100'}, 'kevf-x2':{value:'200'}};
    var document={ getElementById:function(id){ return EL[id] || null; }, querySelector:function(){ return {value:'1'}; }, querySelectorAll:function(){ return []; } };
    window._kevForm={kind:'rule', scope:'G4', part:'s', pre:'kevf-', q:'2026-Q3'};`, c);
  run(c, 'kevFormSave()');
  assert.match(c.TOASTS.at(-1)[0], /理由を入れてください/);
  vm.runInContext(`EL['kevf-why'].value='テスト'; EL['kevf-lo'].value='1.05';`, c);
  run(c, 'kevFormSave()');
  assert.match(c.TOASTS.at(-1)[0], /1\.00 が下限〜上限の中/);
  vm.runInContext(`EL['kevf-lo'].value='0.9';`, c);
  c.STORE.bonus_q[Q].locked = true;
  run(c, 'kevFormSave()');
  assert.match(c.TOASTS.at(-1)[0], /確定しています/);
  c.STORE.bonus_q[Q].locked = false;
  run(c, 'kevFormSave()');
  assert.deepEqual(J(c.STORE.bonus_eval_rule['G4|2026-Q3'].set.s), { on: true, lo: 0.9, hi: 1.1, x0: 0, x1: 100, x2: 200 });
  assert.equal(c.STORE.bonus_eval_rule['G4|2026-Q3'].why, 'テスト');
});

test('the screens render for PC and phone, escape names from synced data, and are read-only once confirmed', () => {
  const c = company({ tia: true });
  c.EMPS.find(e => e.id === 'ken').name = 'Ken <img src=x onerror=alert(1)>';
  c.SCORES['Ken <img src=x onerror=alert(1)>'] = c.SCORES['Ken Sample'];
  vm.runInContext(`var document={ getElementById:function(){ return null; } }; window._kevSel='ken';`, c);
  const tab = run(c, 'kevTabHtml(kbCfg())');
  assert.doesNotMatch(tab, /<img src=x/);
  for (const s of ['① Career Score（賞与用）', '② 売上予算達成率', '③ FL 管理', '④ 利益予算達成率', '評価完了', '下書き保存', '計算の明細を開く', '詳細設定', 'kev-sm', 'kev-side', '個人設定']) assert.ok(tab.includes(s), s);
  assert.match(tab, /aria-pressed="true" aria-label="能力 段階 4"/);
  const list = run(c, 'kevListTableHtml(kbCfg(), bonusTotals(kbCfg()))');
  assert.doesNotMatch(list, /<img src=x/);
  assert.match(list, /<b>1\.08<\/b> · <b>1\.01<\/b> · <b>1\.02<\/b> · <span style="color:var\(--muted\)">固<\/span>/);
  assert.match(list, /不足/);
  for (const html of [run(c, 'kevRuleCardHtml(kbCfg())'), run(c, 'kevCommonCardHtml(kbCfg())'), run(c, 'kevResultTopHtml(kbCfg(), bonusTotals(kbCfg()))')]) assert.ok(html.length > 200);
  assert.match(run(c, 'kevResultTopHtml(kbCfg(), bonusTotals(kbCfg()))'), /disabled onclick="bonusConfirmQuarter\(\)"/, 'record is greyed out until confirmed');
  assert.match(run(c, 'kevCommonCardHtml(kbCfg())'), /G4<\/td><td[^>]*>①②③<\/td><td[^>]*>0\.504<\/td><td[^>]*>1\.716/);
  c.SCORES['Tia Sample'].scores.H16 = 2; c.SCORES['Tia Sample'].scores.H17 = 2;
  run(c, `bqLockQuarter('${Q}')`);
  const locked = run(c, 'kevTabHtml(kbCfg())');
  assert.ok(locked.includes('査定確定済み（見るだけ）'));
  assert.doesNotMatch(locked, /kevDone\(|onclick="kevLv\(/, 'no inputs once confirmed');
  assert.match(run(c, 'kevPersonInnerHtml(EMPS[3], bonusForEmp(EMPS[3], kbCfg()), kbCfg(), {})'), /支給額（確定）/);
  assert.match(run(c, 'kevSelfExplainHtml(EMPS[3], bonusForEmp(EMPS[3], kbCfg()), kbCfg())'), /全員同じ割合（×0\.79[0-9]）/);
});

test('sync: the three new keys are synced, merged per entry by time and kept by storage cleanup', () => {
  assert.match(source, /'karte_pin','bonus_eval_rule','bonus_eval_ovr','bonus_eval',/);
  assert.match(source, /'q_budgets','bonus_eval_rule','bonus_eval_ovr','bonus_eval',/);
  for (const k of ['bonus_eval_rule', 'bonus_eval_ovr', 'bonus_eval']) assert.match(source, new RegExp('\\n  ' + k + ':\\s+\\{ merge: kevMergeMap, covers: kevCoversMap \\}'));
  assert.match(source, /const APP_VERSION = '1065';/);
});

test('two devices edit the same person at once: each item keeps the newer change; done is undone by a change it did not see', () => {
  const c = company();
  const KEY = `${Q}|ken|G3`;
  c.STORE.bonus_eval[KEY] = { ab: { lv: 4, ev: '8/24' }, kn: { lv: 3 }, qu: { lv: 4, ev: '7〜9 月' }, st: 'draft', _at: 10, _t: { ab: 10, kn: 10, qu: 10, st: 10 } };
  const S0 = J(c.STORE.bonus_eval);
  // device A: 知識 4 with a reason
  assert.equal(run(c, "kevEvEdit('ken','G3','kn.lv',4,'2026-Q3')"), true);
  run(c, "kevEvEdit('ken','G3','kn.ev','9/2 新メニューを説明','2026-Q3')");
  const A = J(c.STORE.bonus_eval);
  // device B (has not received A yet): a comment
  c.STORE.bonus_eval = J(S0);
  run(c, "kevEvEdit('ken','G3','cm','次は新人の教育','2026-Q3')");
  const B = J(c.STORE.bonus_eval);
  for (const m of [run(c, `kevMergeMap(${JSON.stringify(A)}, ${JSON.stringify(B)})`), run(c, `kevMergeMap(${JSON.stringify(B)}, ${JSON.stringify(A)})`)]) {
    assert.deepEqual([m[KEY].kn.lv, m[KEY].kn.ev, m[KEY].cm, m[KEY].ab.lv], [4, '9/2 新メニューを説明', '次は新人の教育', 4], 'both changes are kept');
    assert.equal(run(c, `kevCoversMap(${JSON.stringify(m)}, ${JSON.stringify(A)})`), true);
    assert.equal(run(c, `kevCoversMap(${JSON.stringify(m)}, ${JSON.stringify(B)})`), true);
  }
  assert.equal(run(c, `kevCoversMap(${JSON.stringify(S0)}, ${JSON.stringify(A)})`), false);
  // device A marks done; device B (stale) changed 仕事の質 before seeing it → the merged entry is "直している", not done
  c.STORE.bonus_eval = J(A);
  run(c, "kevDone('ken','G3','2026-Q3')");
  const A2 = J(c.STORE.bonus_eval);
  assert.equal(A2[KEY].st, 'done');
  c.STORE.bonus_eval = J(S0);
  run(c, "kevEvEdit('ken','G3','qu.lv',2,'2026-Q3')");
  const B2 = J(c.STORE.bonus_eval);
  for (const m of [run(c, `kevMergeMap(${JSON.stringify(A2)}, ${JSON.stringify(B2)})`), run(c, `kevMergeMap(${JSON.stringify(B2)}, ${JSON.stringify(A2)})`)]) {
    assert.deepEqual([m[KEY].st, m[KEY].qu.lv, m[KEY].kn.lv], ['edit', 2, 4]);
  }
  // merging done with the older copy it was made from keeps it done
  assert.equal(run(c, `kevMergeMap(${JSON.stringify(S0)}, ${JSON.stringify(A2)})`)[KEY].st, 'done');
  assert.equal(run(c, `kevMergeMap(${JSON.stringify(A2)}, ${JSON.stringify(A)})`)[KEY].st, 'done');
  // saving the same value again writes nothing and keeps done
  c.STORE.bonus_eval = J(A2);
  assert.equal(run(c, "kevTxt('ken','G3','kn.ev','9/2 新メニューを説明','2026-Q3')"), true);
  assert.equal(c.STORE.bonus_eval[KEY].st, 'done');
  // records without per-item times merge as before (the newer record)
  assert.equal(run(c, `kevMergeMap({x:{a:1,_at:5}}, {x:{a:2,_at:4}})`).x.a, 1);
  // a screen drawn for another quarter does not save into this one
  assert.equal(run(c, "kevTxt('ken','G3','cm','別の四半期','2026-Q4')"), false);
  assert.match(c.TOASTS.at(-1)[0], /表示中の四半期が 2026-Q3 に変わった/);
  assert.notEqual(c.STORE.bonus_eval[KEY].cm, '別の四半期');
});

test('two devices change different parts of the same personal setting: both parts and both histories are kept; removing a part is kept too', () => {
  const c = company();
  c.STORE.bonus_eval_ovr = { 'ray|2026-Q3': { set: { s: { on: false }, fl: { fw: 80, lw: 20 } }, why: 'キッチン統括', what: '② と ③', at: '2026/10/03 14:20', by: 'GM', _at: 1, _t: { s: 1, fl: 1 } } };
  const S0 = J(c.STORE.bonus_eval_ovr);
  assert.equal(run(c, `kevOvrSave('ray', '2026-Q3', {stores:['S3']}, 'Store 3 だけ見る', '範囲を変更')`), true);
  const A = J(c.STORE.bonus_eval_ovr);
  c.STORE.bonus_eval_ovr = J(S0);
  assert.equal(run(c, `kevPutVer('bonus_eval_ovr', kevOvrAll(), 'ray', '2026-Q3', {}, '店舗の売上も見る', '② の個人設定を外した', ['s'])`), true);
  const B = J(c.STORE.bonus_eval_ovr);
  const m = run(c, `kevMergeMap(${JSON.stringify(A)}, ${JSON.stringify(B)})`)['ray|2026-Q3'];
  assert.deepEqual([J(m.set.stores), m.set.s, J(m.set.fl)], [['S3'], undefined, { fw: 80, lw: 20 }], 'the store change and the removal of ② are both kept');
  assert.deepEqual(m.hist.map(h => h.what).sort(), ['② と ③', m.what === '範囲を変更' ? '② の個人設定を外した' : '範囲を変更'].sort());
  // settings coming from sync are numbers: text never reaches the screen
  c.STORE.bonus_eval_rule = { 'G4|2026-Q3': { set: { c: { lo: '<img src=x onerror=alert(1)>' }, fl: { aw: '<svg onload=alert(1)>', rw: 20 }, w: { ab: '"><b>' } }, _at: 1 } };
  const R = run(c, `kevRuleFor('G4', '2026-Q3').r`);
  assert.deepEqual([R.c.lo, R.fl.aw, R.w.ab], [0.7, 80, 25]);
  for (const h of [run(c, 'kevRuleCardHtml(kbCfg())'), run(c, 'kevCommonCardHtml(kbCfg())')]) assert.doesNotMatch(h, /<img|<svg|"><b>/);
});

test('settings: 会社共通 does not decide 反映/固定 or the ① range; G6 follows G5 until G6 has its own; later versions are named', () => {
  const c = company();
  assert.equal(run(c, `kevRuleSave('_common', '2026-Q3', {s:{on:false, lo:0.9, hi:1.1, x0:0, x1:100, x2:200}, c:{on:false, lo:0.5, hi:1.5, x0:0, x1:40, x2:100}}, 'test', 'test')`), true);
  const st = c.STORE.bonus_eval_rule['_common|2026-Q3'].set;
  assert.deepEqual([st.s.on, st.c.on, st.c.lo, st.c.hi, st.s.lo, st.c.x1], [undefined, undefined, undefined, undefined, 0.9, 40]);
  const g4 = run(c, `kevRuleFor('G4', '2026-Q3').r`);
  assert.deepEqual([g4.s.on, g4.s.lo, g4.c.lo, g4.c.x1], [true, 0.9, 0.7, 40]);
  // G6 = G5
  run(c, `kevRuleSave('G5', '2026-Q3', {s:{on:true, lo:0.85, hi:1.15, x0:0, x1:100, x2:200}}, 'test', 'G5 の ②')`);
  assert.deepEqual(run(c, `[kevRuleFor('G5','2026-Q3').r.s.lo, kevRuleFor('G6','2026-Q3').r.s.lo]`), [0.85, 0.85]);
  run(c, `kevRuleSave('G6', '2026-Q3', {s:{on:true, lo:0.95, hi:1.05, x0:0, x1:100, x2:200}}, 'test', 'G6 の ②')`);
  assert.deepEqual(run(c, `[kevRuleFor('G5','2026-Q3').r.s.lo, kevRuleFor('G6','2026-Q3').r.s.lo]`), [0.85, 0.95]);
  assert.match(run(c, 'kevRuleCardHtml(kbCfg())'), /保存済み（2026-Q3〜）/);
  // a later version exists → a change from Q3 only runs until then
  run(c, `kevOvrSave('mia', '2026-Q4', {s:{on:false}}, 'test', 'Q4')`);
  assert.deepEqual(run(c, `kevLaterVers(kevOvrAll(), 'mia', '2026-Q3')`), ['2026-Q4']);
  // stores added by a personal setting appear in the profit table
  c.STORE.bonus_eval_ovr['aki|2026-Q3'] = { set: { stores: ['S9'] }, _at: 3 };
  assert.ok(run(c, 'bqStores(kbCfg())').includes('S9'));
});

test('G3 without a job track: the 個別評価 tab offers the track; the grade-change record with blank philosophy items is missing; names are escaped in toasts', () => {
  const c = company();
  c.EMPS.find(e => e.id === 'ken').title = 'Store Leader';
  vm.runInContext(`var document={ getElementById:function(){ return null; }, querySelectorAll:function(){ return []; } }; window._kevSel='ken';`, c);
  assert.equal(person(c, 'ken').blocked, 'track');
  const tab = run(c, 'kevTabHtml(kbCfg())');
  assert.match(tab, /G3 職種（2026-Q3）/);
  assert.match(tab, /bonusSetTrack\(&quot;ken&quot;,'sv'\)/);
  assert.match(run(c, 'kevPersonInnerHtml(EMPS[1], bonusForEmp(EMPS[1], kbCfg()), kbCfg(), {})'), /bonusSetTrack/);
  // grade change confirmed with blank philosophy items (v1065 record) → missing; an older record is shown as such
  const c2 = company();
  c2.SEGS.sam = [{ g: 'G4', from: '2026-07-01', to: '2026-08-15', days: 46 }, { g: 'G5', from: '2026-08-16', to: '2026-09-30', days: 46 }];
  c2.STORE.grade_hist = { sam: { recs: [{ d: '2026-08-15', g: 'G5', from: 'G4', start: false, prevEval: { g: 'G4', kv: 1, hUn: 2, cats: [{ key: 'H', score: 30, max: 54 }], at: '2026-08-15 10:00', by: 'CEO' } }] } };
  c2.STORE.bonus_eval[`${Q}|sam|G4`] = { ab: { lv: 3 }, kn: { lv: 3 }, qu: { lv: 3 }, fa: { lv: 3 }, la: { lv: 3 }, st: 'done', _at: 1 };
  let sam = person(c2, 'sam');
  assert.equal(sam.blocked, 'eval');
  assert.match(sam.missing.join(), /グレードを変えたときに確定した評価で、理念の 2 項目が未採点/);
  delete c2.STORE.grade_hist.sam.recs[0].prevEval.kv; delete c2.STORE.grade_hist.sam.recs[0].prevEval.hUn;
  sam = person(c2, 'sam');
  assert.deepEqual([sam.blocked, sam.segs[0].items.c.parts.ph.legacy], [null, true]);
  // the done toast escapes the name
  const c3 = company();
  c3.EMPS.find(e => e.id === 'neo').name = 'Neo <img src=x onerror=alert(1)>';
  c3.SCORES['Neo <img src=x onerror=alert(1)>'] = c3.SCORES['Neo Sample'];
  c3.STORE.bonus_eval[`${Q}|neo|G3`].st = 'edit';
  vm.runInContext(`var document={ getElementById:function(){ return null; }, querySelectorAll:function(){ return []; } };`, c3);
  run(c3, "kevDone('neo','G3','2026-Q3')");
  assert.equal(c3.STORE.bonus_eval[`${Q}|neo|G3`].st, 'done');
  assert.doesNotMatch(c3.TOASTS.at(-1)[0], /<img/);
  // the person page passes the id safely
  assert.match(run(c3, 'kevPersonInnerHtml(EMPS[3], bonusForEmp(EMPS[3], kbCfg()), kbCfg(), {})'), /<style>/);
});
