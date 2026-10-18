// App v1092 (Moto 2026-10-17「Tip Rate の承認で決める」): the tip distribution is weighted by that day's Tip Rate
// (approved 80/90/100% from the day it was approved, 100% from 3 months after the first shift) from TIP_RATE_WEIGHT_START;
// days before it keep the employee master coefficient (periods that may already be paid do not change).
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1091 fails the new ones).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(process.env.FUNERGY_SW || new URL('../sw.js', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const START = (/var TIP_RATE_WEIGHT_START = '(\d{4}-\d{2}-\d{2})';/.exec(SRC) || [])[1];

function app() {
  const c = { console, STORE: {}, EMPS: [], LABOR: {}, TIPS: {}, NOTIP: {}, TOASTS: [], RENDERS: [], CONFIRMS: {} };
  vm.createContext(c);
  vm.runInContext(['calcTipDistribution', 'tipWeightByRate', '_tipDecDay', 'tipRateOn', '_tipLatestApproved', '_tipDecT', 'firstWorkDate', 'isThreeMonths',
    'effectiveTipRate', 'isTipEligibleRole', 'tipBaseRole', 'isTipExcludedTitle', 'getTipLeaderSplit', 'tipPeriodRates', 'tipPeriodRateLabel', 'tipRateLabel',
    'tipPeriodMatrix', 'calcHalfMonthSettlement', 'halfMonthRange', 'halfMonthDates', 'confirmTip', 'renderTipDaily', 'isoOf', '_tipHstDay'].map(fnSrc).join('\n') + `
    var TIP_RATE_WEIGHT_START = ${JSON.stringify(START || '2026-10-16')};
    var TIP_SL_SPLIT_END = '2026-08-01';
    var TIP_EXCLUDED_TITLES = ['Prep','Prep Specialist','Store Manager','Area Manager','General Manager','CEO','Office Crew','Accountant'];
    var ROLE_ALIAS = { g2: 'sl', g4: 'am' };
    var STORES = [{ id: 'F01', brand: 'ToriTon' }, { id: 'F03', brand: 'Waikiki' }];
    var ROLE_CONFIG = { gm: { name: 'GM' } }, curRole = 'gm', curLang = 'ja';
    function t(ja){ return ja; }
    function getEmployees(){ return EMPS; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function getTipLabor(s, d){ return LABOR[s + '|' + d] || null; }
    function tipForDay(s, d){ var x = TIPS[s + '|' + d] || { l: 0, d: 0 }; return { lunchTotal: x.l, dinnerTotal: x.d, total: x.l + x.d, lunchCredit: x.l, dinnerCredit: x.d, lunchCash: 0, dinnerCash: 0 }; }
    var EXCL = {}; function isTipExcluded(s, d, n, slot){ return !!EXCL[s + '|' + d + '|' + n + '|' + slot]; }
    function isOrderOnlyAccount(){ return false; }
    function isStoreLeader(){ return false; }
    function workedShiftCount(emp){ return NOTIP[emp.name] ? 0 : 99; }
    function noTipShifts(){ return 3; }
    function getAttOverride(){ return null; }
    var PERIOD = null; function tipPeriodInfo(){ return PERIOD; }
    function attDaysApprovedForPeriod(){ return { anyData: false, allApproved: true }; }
    function setTipConfirm(s, info, data){ CONFIRMS[s + '|' + info.from] = JSON.parse(JSON.stringify(data)); }
    function nowJP(){ return '2026/10/31 22:00'; }
    function showToast(m){ TOASTS.push(m); } function renderPage(p){ RENDERS.push(p); }
    function cashTipMissing(){ return false; }`, c);
  return c;
}
const EMP = (o) => Object.assign({ store: 'F01', role: 'crew', status: '在籍', title: 'Crew', coef: 1 }, o);
function days(from, to) { const out = []; const d = new Date(from + 'T00:00:00'); const e = new Date(to + 'T00:00:00'); const p2 = n => String(n).padStart(2, '0');
  for (; d <= e; d.setDate(d.getDate() + 1)) out.push(d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())); return out; }   // local dates (also on a Japan-time machine)
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);

test('the start date is the first day of a pay period (10/16 or 10/1), and nothing before it changes', () => {
  assert.ok(START, 'TIP_RATE_WEIGHT_START is set');
  assert.match(START, /^\d{4}-\d{2}-(01|16)$/, 'a pay period starts on the 1st or the 16th, so no period is half and half');
  assert.ok(START >= '2026-10-01', 'not earlier than the month Moto decided in');
});

test('from the start date the weight is that day’s Tip Rate: approved rates from the day they were approved, 100% from 3 months after the first shift; the employee master coefficient is not used', () => {
  const c = app();
  c.EMPS = [
    EMP({ name: 'A', firstWork: '2026-07-22', coef: 1 }),                // 80% until 10/21, 100% from 10/22 (3 months)
    EMP({ name: 'B', firstWork: '2026-09-01', coef: 1 }),                // approved 90% on 10/20
    EMP({ name: 'C', firstWork: '2026-09-15', role: 'sl', coef: 0.8 }),  // raised to 100% on 10/17, then an older 80% request approved on 10/23 (Moto: the newer decision)
    EMP({ name: 'E', coef: 0.9 }),                                       // no first shift / hire date, no approval: the rate on the Tip Rate screen = the master coefficient
    EMP({ name: 'F', role: 'g2', title: 'Crew Leader', firstWork: '2026-09-20', coef: 0.8 }),   // Crew Leader: 100% (same rule as the Tip Rate screen)
  ];
  c.STORE.tip_requests = [
    { id: 't1', name: 'B', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: Date.UTC(2026, 9, 20, 22) },
    { id: 't2', name: 'C', rate: 80, status: '承認', date: '2026/10/01', approvedDate: '2026/10/23', decAt: Date.UTC(2026, 9, 23, 22) },
    { id: 't3', name: 'C', rate: 100, status: '承認', approvedDate: '2026/10/17', decAt: Date.UTC(2026, 9, 17, 22) },
    { id: 't4', name: 'B', rate: 100, status: '申請中', date: '2026/10/25' },   // pending: no effect
  ];
  const want = {
    '2026-10-18': { A: 80, B: 80, C: 100, E: 90, F: 100 },
    '2026-10-19': { A: 80, B: 80, C: 100, E: 90, F: 100 },
    '2026-10-20': { A: 80, B: 90, C: 100, E: 90, F: 100 },
    '2026-10-22': { A: 100, B: 90, C: 100, E: 90, F: 100 },
    '2026-10-23': { A: 100, B: 90, C: 80, E: 90, F: 100 },
  };
  for (const [d, rates] of Object.entries(want)) {
    for (const [n, r] of Object.entries(rates)) assert.equal(run(c, `tipRateOn('${n}', '${d}')`), r, n + ' on ' + d);
    c.LABOR['F01|' + d] = { A: { lunch: 4, dinner: 0 }, B: { lunch: 4, dinner: 2 }, C: { lunch: 2, dinner: 5 }, E: { lunch: 3, dinner: 3 }, F: { lunch: 1, dinner: 4 } };
    c.TIPS['F01|' + d] = { l: 250, d: 330 };
    const dist = plain(run(c, `calcTipDistribution('F01', '${d}')`));
    assert.equal(dist.weightBy, 'rate');
    for (const slot of ['lunch', 'dinner']) {
      const L = c.LABOR['F01|' + d], tot = slot === 'lunch' ? 250 : 330;
      const pts = Object.fromEntries(Object.keys(rates).map(n => [n, L[n][slot] * rates[n] / 100]));
      const sum = Object.values(pts).reduce((a, b) => a + b, 0);
      for (const n of Object.keys(rates)) {
        const row = dist.list.find(r => r.name === n);
        near(row[slot], tot * pts[n] / sum, `${d} ${n} ${slot}`);
        assert.equal(row.rate, rates[n]); assert.equal(row.by, 'rate');
      }
    }
    near(dist.distSum, 580, d + ' the whole tip is paid out');
  }
});

test('Moto’s example: same hours, 80% and 100% → $80 and $100 of $180; before the start date the master coefficients (1.0 / 1.0) give $90 each, as before', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01', coef: 1 }), EMP({ name: 'Y', firstWork: '2026-09-01', coef: 1 })];
  c.STORE.tip_requests = [{ id: 'y', name: 'Y', rate: 100, status: '承認', approvedDate: '2026/09/30', decAt: Date.UTC(2026, 8, 30) }];
  for (const d of ['2026-10-10', START]) { c.LABOR['F01|' + d] = { X: { lunch: 5, dinner: 0 }, Y: { lunch: 5, dinner: 0 } }; c.TIPS['F01|' + d] = { l: 180, d: 0 }; }
  const before = plain(run(c, "calcTipDistribution('F01', '2026-10-10')"));
  assert.equal(before.weightBy, 'coef');
  near(before.list.find(r => r.name === 'X').total, 90, 'before X'); near(before.list.find(r => r.name === 'Y').total, 90, 'before Y');
  const after = plain(run(c, `calcTipDistribution('F01', '${START}')`));
  near(after.list.find(r => r.name === 'X').total, 80, 'after X'); near(after.list.find(r => r.name === 'Y').total, 100, 'after Y');
});

test('before the start date the numbers are exactly the employee master coefficient ones (random staff, approvals and hours)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const before = days('2026-09-16', '2026-10-15');
  for (let k = 0; k < 40; k++) {
    const c = app();
    const n = 2 + Math.floor(rnd() * 6), names = [];
    for (let i = 0; i < n; i++) {
      const nm = 'S' + i; names.push(nm);
      c.EMPS.push(EMP({ name: nm, coef: [0.8, 0.9, 1][Math.floor(rnd() * 3)], role: ['crew', 'sl', 'g2'][Math.floor(rnd() * 3)], firstWork: rnd() < 0.3 ? '' : '2026-0' + (5 + Math.floor(rnd() * 4)) + '-1' + Math.floor(rnd() * 9) }));
    }
    c.STORE.tip_requests = names.filter(() => rnd() < 0.5).map((nm, i) => ({ id: 'r' + i, name: nm, rate: [80, 90, 100][Math.floor(rnd() * 3)], status: '承認', approvedDate: '2026/09/0' + (1 + i % 9) }));
    const d = before[Math.floor(rnd() * before.length)];
    c.LABOR['F01|' + d] = Object.fromEntries(names.map(nm => [nm, { lunch: Math.round(rnd() * 60) / 10, dinner: Math.round(rnd() * 60) / 10 }]));
    c.TIPS['F01|' + d] = { l: Math.round(rnd() * 40000) / 100, d: Math.round(rnd() * 40000) / 100 };
    const dist = plain(run(c, `calcTipDistribution('F01', '${d}')`));
    assert.equal(dist.weightBy, 'coef');
    for (const slot of ['lunch', 'dinner']) {
      const L = c.LABOR['F01|' + d], tot = c.TIPS['F01|' + d][slot === 'lunch' ? 'l' : 'd'];
      const act = names.filter(nm => L[nm][slot] > 0);
      const sum = act.reduce((a, nm) => a + L[nm][slot] * c.EMPS.find(e => e.name === nm).coef, 0);
      for (const nm of act) {
        const row = dist.list.find(r => r.name === nm);
        near(row[slot], sum > 0 ? tot * L[nm][slot] * c.EMPS.find(e => e.name === nm).coef / sum : 0, `${k} ${d} ${nm} ${slot}`);
        assert.equal(row.coef, c.EMPS.find(e => e.name === nm).coef);
      }
    }
  }
});

test('No Tip is unchanged: the people whose Tip Rate is No Tip now are left out, and the rest share the whole tip by Tip Rate', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'N', firstWork: '2026-10-10' }), EMP({ name: 'M', firstWork: '2026-09-01' })];
  c.NOTIP = { N: true };
  c.LABOR[`F01|${START}`] = { N: { lunch: 5, dinner: 0 }, M: { lunch: 5, dinner: 0 } }; c.TIPS[`F01|${START}`] = { l: 100, d: 0 };
  const dist = plain(run(c, `calcTipDistribution('F01', '${START}')`));
  const N = dist.list.find(r => r.name === 'N'), M = dist.list.find(r => r.name === 'M');
  assert.equal(N.total, 0); assert.equal(N.lunchNoTip, true);
  near(M.total, 100, 'M gets all');
});

test('Waikiki and roles outside 80/90/100 are 100%; legacy approvals without a date count on every day; a stamped legacy time is not taken for a day', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'W', store: 'F03', coef: 0.8, firstWork: '2026-10-01' }), EMP({ name: 'L', firstWork: '2026-09-01' }), EMP({ name: 'D', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [
    { id: 'l1', name: 'L', rate: 90, status: '承認' },                     // no date at all (imported): counts on every day
    { id: 'd1', name: 'D', rate: 90, status: '承認', decAt: 3 },           // stamped by tipStampLegacy (not a real time), no approvedDate
    { id: 'd2', name: 'D', rate: 100, status: '承認', decAt: Date.UTC(2026, 9, 25, 22) },   // a time without a date is not a day (could be stamped from the order): every day, newest in order
  ];
  assert.equal(run(c, `tipRateOn('W', '${START}')`), 100);
  assert.equal(run(c, `tipRateOn('L', '${START}')`), 90);
  assert.equal(run(c, "_tipDecDay({ decAt: 3 })"), '');
  assert.equal(run(c, "tipRateOn('D', '2026-10-20')"), 100);
  assert.equal(run(c, "tipRateOn('D', '2026-10-27')"), 100);
  assert.equal(run(c, "_tipDecDay({ decDay: '2026-10-25', approvedDate: '2026/10/26' })"), '2026-10-25', 'the Hawaii day first');
  assert.equal(run(c, "_tipDecDay({ approvedDate: '2026/1/5' })"), '2026-01-05');
  assert.equal(run(c, "tipRateOn('nobody', '2026-10-20')"), 100);
  // a rejection does not change the rate; a request decided after the day does not count yet
  c.STORE.tip_requests.push({ id: 'd3', name: 'D', rate: 80, status: '却下', approvedDate: '2026/10/26', decAt: Date.UTC(2026, 9, 26, 22) });
  assert.equal(run(c, "tipRateOn('D', '2026-10-27')"), 100);
});

test('独立レビュー（dc96c7e）: Waikiki tips are shared by hours for everyone (helpers too); same-name records keep their own coefficient before the start date', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'W', store: 'F03', firstWork: '2026-10-01' }), EMP({ name: 'H', store: 'F01', support: ['F03'], firstWork: '2026-09-01' })];
  c.LABOR[`F03|${START}`] = { W: { lunch: 5, dinner: 0 }, H: { lunch: 5, dinner: 0 } }; c.TIPS[`F03|${START}`] = { l: 200, d: 0 };
  const w = plain(run(c, `calcTipDistribution('F03', '${START}')`));
  near(w.list.find(r => r.name === 'W').total, 100, 'W'); near(w.list.find(r => r.name === 'H').total, 100, 'H (an 80% helper)');
  // the helper at their own store keeps their own rate
  assert.equal(run(c, `tipRateOn('H', '${START}')`), 80);
  // two records with the same name (pre-start): each its own coefficient, as before
  const d = app();
  d.EMPS = [EMP({ name: 'Same', coef: 0.8, firstWork: '2026-09-01' }), EMP({ name: 'Same', coef: 1, firstWork: '2026-09-01', support: ['F01'], store: 'F02' }), EMP({ name: 'Z', coef: 1, firstWork: '2026-09-01' })];
  d.LABOR['F01|2026-10-10'] = { Same: { lunch: 5, dinner: 0 }, Z: { lunch: 5, dinner: 0 } }; d.TIPS['F01|2026-10-10'] = { l: 280, d: 0 };
  const x = plain(run(d, "calcTipDistribution('F01', '2026-10-10')"));
  near(x.distSum, 280, 'whole tip');
  near(x.list.find(r => r.name === 'Z').total, 280 * 5 / (4 + 5 + 5), 'Z as with the old per-record coefficients');
});

test('独立レビュー（dc96c7e）: the day an approval counts is its Hawaii day (decDay, also when approved in Japan), else the device date; the decision time is never a day; an undated approval counts on every day in the same order', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'J', firstWork: '2026-09-01' }), EMP({ name: 'K1', firstWork: '2026-09-01' }), EMP({ name: 'L', firstWork: '2026-09-01' }), EMP({ name: 'U', firstWork: '2026-09-01' })];
  const hst = (y, m, d, h) => Date.UTC(y, m - 1, d, h + 10);
  c.STORE.tip_requests = [
    // v1092: approved in Japan at 10/20 10:00 JST = 10/19 15:00 HST: the device date says 10/20, the Hawaii day 10/19
    { id: 'j', name: 'J', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: hst(2026, 10, 19, 15), decDay: '2026-10-19' },
    // v1091 (no decDay): the device date
    { id: 'k', name: 'K1', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: hst(2026, 10, 19, 15) },
    // a time stamped from the order (tipStampLegacy) on an old approval: the day is the approval date
    { id: 'l0', name: 'L', rate: 90, status: '承認', approvedDate: '2026/10/05', decAt: hst(2026, 10, 5, 9) },
    { id: 'l1', name: 'L', rate: 100, status: '承認', approvedDate: '2026/10/21', decAt: hst(2026, 10, 5, 9) + 1 },
    { id: 'u0', name: 'U', rate: 90, status: '承認', approvedDate: '2026/10/25', decAt: hst(2026, 10, 25, 9), decDay: '2026-10-25' },
    { id: 'u1', name: 'U', rate: 100, status: '承認', decAt: hst(2026, 10, 25, 9) + 1 },   // imported, no date (a stamped time only): every day
    { id: 'u2', name: 'U', rate: 80, status: '承認', approvedDate: '2026/10/12', decAt: hst(2026, 10, 12, 9), decDay: '2026-10-12' },
  ];
  assert.equal(run(c, "tipRateOn('J', '2026-10-19')"), 90, 'from the Hawaii day of the decision');
  assert.equal(run(c, "tipRateOn('J', '2026-10-18')"), 80);
  assert.equal(run(c, "tipRateOn('K1', '2026-10-19')"), 80, 'a v1091 record: the device date (one day late from Japan)');
  assert.equal(run(c, "tipRateOn('K1', '2026-10-20')"), 90);
  assert.equal(run(c, "tipRateOn('L', '2026-10-20')"), 90, 'the stamped time is not taken as the day');
  assert.equal(run(c, "tipRateOn('L', '2026-10-21')"), 100);
  assert.equal(run(c, "_tipDecDay({ decAt: " + hst(2026, 10, 19, 23) + " })"), '', 'a time alone is never a day');
  assert.equal(run(c, "_tipHstDay(" + hst(2026, 10, 19, 23) + ")"), '2026-10-19', 'Hawaii day, whatever the device');
  assert.equal(run(c, "tipRateOn('U', '2026-10-20')"), 100, 'the undated approval (after the 10/25 one in the list) counts');
  assert.equal(run(c, "tipRateOn('U', '2026-10-26')"), 100, 'the same on later days');
  // the reviewer's example (an imported approval with no date and no time between two dated ones): the same on every day
  c.EMPS.push(EMP({ name: 'V', firstWork: '2026-09-01' }));
  c.STORE.tip_requests = c.STORE.tip_requests.concat([
    { id: 'v0', name: 'V', rate: 90, status: '承認', approvedDate: '2026/10/25', decAt: hst(2026, 10, 25, 9), decDay: '2026-10-25' },
    { id: 'v1', name: 'V', rate: 100, status: '承認' },
    { id: 'v2', name: 'V', rate: 80, status: '承認', approvedDate: '2026/10/12', decAt: hst(2026, 10, 12, 9), decDay: '2026-10-12' },
  ]);
  assert.equal(run(c, "tipRateOn('V', '2026-10-20')"), 100);
  assert.equal(run(c, "tipRateOn('V', '2026-10-26')"), 100);
});

test('Codex（dc96c7e）: approving a pending request later does not change what past days paid (an undated old approval after a dated one)', async () => {
  const c = app();
  vm.runInContext(['approveTip', 'tipStampLegacy', 'tipDecStamp', 'tipDecDayStamp', 'todayJP', 'fmtJP'].map(fnSrc).join('\n') + `
    var curUserName = 'Moto', curPage = 'tip'; function confirm(){ return true; }
    Date.now = function(){ return ${Date.UTC(2026, 9, 23, 20)}; };   // approved on 10/23 (Hawaii 10:00)`, c);
  c.EMPS = [EMP({ name: 'A', firstWork: '2026-09-01' }), EMP({ name: 'B', firstWork: '2026-09-01' })];
  const hst = (y, m, d, h) => Date.UTC(y, m - 1, d, h + 10);
  c.STORE.tip_requests = [
    { id: 'p', name: 'A', rate: 80, status: '申請中', date: '2026/10/01' },
    { id: 'a90', name: 'A', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: hst(2026, 10, 20, 9) },
    { id: 'old', name: 'A', rate: 100, status: '承認' },   // an old approval with no date or time (counts on every day)
  ];
  c.LABOR['F01|2026-10-18'] = { A: { lunch: 5, dinner: 0 }, B: { lunch: 5, dinner: 0 } }; c.TIPS['F01|2026-10-18'] = { l: 180, d: 0 };
  const before = plain(run(c, "calcTipDistribution('F01', '2026-10-18')")).list.map(r => [r.name, +r.total.toFixed(2)]);
  assert.deepEqual(before, [['A', 100], ['B', 80]]);
  await run(c, "approveTip('p', '承認')");
  const st = plain(c.STORE.tip_requests);
  assert.ok(st.find(r => r.id === 'old').decAt > 1e12, 'the old approval got a time from the order (the case Codex found)');
  assert.equal(st.find(r => r.id === 'p').decDay, '2026-10-23', 'the new decision keeps its Hawaii day');
  // from 10/23 the newer decision (80%) counts (Moto: the newer decision)
  c.LABOR['F01|2026-10-23'] = c.LABOR['F01|2026-10-18']; c.TIPS['F01|2026-10-23'] = { l: 180, d: 0 };
  assert.deepEqual(plain(run(c, "calcTipDistribution('F01', '2026-10-23')")).list.map(r => [r.name, +r.total.toFixed(2)]), [['A', 90], ['B', 90]]);
  assert.match(fnSrc('applyTipRaise'), /approvedDate:todayJP\(\), decAt:_dec, decDay:\(\(typeof tipDecDayStamp==='function'\) \? tipDecDayStamp\(requests, name\) : undefined\)\}\);/, 'a raise keeps its Hawaii day too');
  const after = plain(run(c, "calcTipDistribution('F01', '2026-10-18')")).list.map(r => [r.name, +r.total.toFixed(2)]);
  assert.deepEqual(after, before, 'the past day pays the same');
});

test('独立レビュー（e59f3f9）P1・P3: rejecting an old request changes neither past days nor the rate now; a device whose clock is behind does not move a decision to an earlier day', async () => {
  const c = app();
  vm.runInContext(['approveTip', 'tipStampLegacy', 'tipDecStamp', 'tipDecDayStamp', 'todayJP', 'fmtJP'].map(fnSrc).join('\n') + `
    var curUserName = 'Moto', curPage = 'tip'; function confirm(){ return true; } var NOW = 0;
    Date.now = function(){ return NOW; };`, c);
  const hst = (y, m, d, h) => Date.UTC(y, m - 1, d, h + 10);
  c.EMPS = [EMP({ name: 'A', firstWork: '2026-09-01' }), EMP({ name: 'B', firstWork: '2026-05-01' })];   // B: past 3 months → 100%
  c.STORE.tip_requests = [
    { id: 'p', name: 'A', rate: 100, status: '申請中', date: '2026/09/01' },                 // an old request still pending
    { id: 'l', name: 'A', rate: 80, status: '承認', approvedDate: '2026/09/10' },              // approved before v1091 (no time)
    { id: 'r', name: 'A', rate: 100, status: '承認', decDay: '2026-10-18', decAt: hst(2026, 10, 18, 9) },   // a raise on 10/18
  ];
  c.LABOR['F01|2026-10-20'] = { A: { lunch: 5, dinner: 0 }, B: { lunch: 5, dinner: 0 } }; c.TIPS['F01|2026-10-20'] = { l: 180, d: 0 };
  const pay = d => plain(run(c, `calcTipDistribution('F01', '${d}')`)).list.map(r => [r.name, +r.total.toFixed(2)]);
  assert.deepEqual(pay('2026-10-20'), [['A', 90], ['B', 90]]);
  // P1: the old request is rejected on 10/23
  c.NOW = hst(2026, 10, 23, 10);
  await run(c, "approveTip('p', '却下')");
  assert.deepEqual(pay('2026-10-20'), [['A', 90], ['B', 90]], 'the past day pays the same (before: $80 / $100)');
  assert.equal(run(c, "effectiveTipRate('A')"), 100, 'the rate now stays at the raise (before: 80%)');
  // P3: a device whose clock reads 10/19 23:00 approves a new 90% request: its day is not before the latest decision day
  c.STORE.tip_requests = plain(c.STORE.tip_requests).concat([{ id: 'q', name: 'A', rate: 90, status: '申請中', date: '2026/10/19' }]);
  c.NOW = hst(2026, 10, 19, 23);
  await run(c, "approveTip('q', '承認')");
  assert.equal(plain(c.STORE.tip_requests).find(r => r.id === 'q').decDay, '2026-10-23', 'not 10/19');
  assert.deepEqual(pay('2026-10-20'), [['A', 90], ['B', 90]], 'the past day pays the same (before: the slow clock made it count from 10/19)');
  // a later day uses the new decision
  c.LABOR['F01|2026-10-24'] = c.LABOR['F01|2026-10-20']; c.TIPS['F01|2026-10-24'] = { l: 190, d: 0 };
  assert.deepEqual(pay('2026-10-24'), [['B', 100], ['A', 90]]);
});

test('the period table, CSV and staff tab show the rates used in the period (80%→90%); the daily table shows Tip Rate; the confirmation keeps the basis and the rates', () => {
  const c = app();
  c.EMPS = [EMP({ name: 'B', firstWork: '2026-09-01' }), EMP({ name: 'K', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 't1', name: 'B', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: Date.UTC(2026, 9, 20, 22) }];
  const P = days('2026-10-16', '2026-10-31');
  for (const d of P) { c.LABOR['F01|' + d] = { B: { lunch: 3, dinner: 3 }, K: { lunch: 3, dinner: 3 } }; c.TIPS['F01|' + d] = { l: 100, d: 100 }; }
  c.PERIOD = { from: '2026-10-16', to: '2026-10-31', dates: P, anyDate: '2026-10-20', label: '2026年10月後期', rangeLabel: '2026-10-16 〜 2026-10-31' };
  const M = plain(run(c, 'tipPeriodMatrix("F01", PERIOD)'));
  assert.deepEqual(M.rates, { B: [80, 90], K: [80] });
  // a day where B was excluded from both lunch and dinner is not "used"
  run(c, "EXCL['F01|2026-10-16|B|lunch'] = EXCL['F01|2026-10-16|B|dinner'] = true");
  assert.deepEqual(plain(run(c, 'tipPeriodMatrix("F01", PERIOD)')).rates.B, [80, 90], 'still 80 on the other days before 10/20');
  run(c, "for (var d of ['2026-10-16','2026-10-17','2026-10-18','2026-10-19']) { EXCL['F01|'+d+'|B|lunch'] = EXCL['F01|'+d+'|B|dinner'] = true; }");
  assert.deepEqual(plain(run(c, 'tipPeriodMatrix("F01", PERIOD)')).rates.B, [90], 'only the days B took part');
  run(c, 'EXCL = {}');
  c.M = M;
  assert.equal(run(c, 'tipPeriodRateLabel(M.rates, "B")'), '80→90%');
  assert.equal(run(c, 'tipPeriodRateLabel(M.rates, "K")'), '80%');
  // before the start date nothing is "used" (weighted by the coefficient): the current Tip Rate, as before
  const E = days('2026-10-01', '2026-10-15');
  for (const d of E) { c.LABOR['F01|' + d] = { B: { lunch: 3, dinner: 3 }, K: { lunch: 3, dinner: 3 } }; c.TIPS['F01|' + d] = { l: 100, d: 100 }; }
  c.PERIOD0 = { from: '2026-10-01', to: '2026-10-15', dates: E, anyDate: '2026-10-05' };
  assert.deepEqual(plain(run(c, 'tipPeriodMatrix("F01", PERIOD0)')).rates, {});
  assert.equal(run(c, 'tipPeriodRateLabel({}, "B")'), '90%');
  // the screens use these
  assert.match(fnSrc('renderTipPeriodMatrix'), /var used=M\.rates && M\.rates\[nm\]/);
  assert.match(fnSrc('exportTipPeriodCsv'), /_rcCsv\[nm\]=tipPeriodRateLabel\(M\.rates, nm\)/);
  assert.match(fnSrc('renderTipPeriodStaff'), /var _used=tipPeriodRates\(_sdists\)/);
  // confirmation
  run(c, 'confirmTip("F01")');
  const conf = plain(c.CONFIRMS['F01|2026-10-16']);
  assert.equal(conf.weight, 'rate');
  assert.deepEqual(conf.rows.find(r => r.name === 'B').rates, [80, 90]);
  near(conf.totalFinal, 200 * P.length, 'whole tip');
  // the daily table
  const h = run(c, `renderTipDaily('F01', { id: 'F01' }, '2026-10-21')`);
  assert.match(h, /<th>Tip Rate<\/th>/); assert.match(h, />90%<\/td>/); assert.match(h, /時間×その日の Tip Rate/);
  for (const d of ['2026-10-10']) { c.LABOR['F01|' + d] = { B: { lunch: 3, dinner: 0 } }; c.TIPS['F01|' + d] = { l: 50, d: 0 }; }
  const h2 = run(c, `renderTipDaily('F01', { id: 'F01' }, '2026-10-10')`);
  assert.match(h2, /<th>係数<\/th>/); assert.match(h2, /時間×評価係数）で全員按分（2026\/10\/16 より前の日）/);
});

test('the employee master explains the field; version markers are 1092 or later and match', () => {
  assert.match(SRC, /チップ配分の重みは、'\+TIP_RATE_WEIGHT_START\.replace\(\/-\/g,'\/'\)\+' からは Tip Rate/);
  assert.doesNotMatch(SRC, /チップ配分はこの係数で重み付けされます（評価に連動）/);
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1], b = /const SW_BUILD = '(\d+)'/.exec(SW)[1];
  assert.ok(Number(v) >= 1092, v); assert.equal(v, b);
});
