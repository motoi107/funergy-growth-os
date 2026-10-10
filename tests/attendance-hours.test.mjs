// v1057: worked hours on My page, pay estimate, shift-vs-actual check, weekly stats and one-day Labor breakdown
// count clock-in to clock-out (the Labor core's _laborHrs), not the Tip hours window.
// Runs the real functions from index.html in a VM with synthetic clock data. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start + 1);
  return source.slice(start + 1, end + 2);
}
const constant = name => { const m = new RegExp('^(?:const|var) ' + name + ' = [^;]+;', 'm').exec(source); assert.ok(m, name); return m[0].replace(/^const /, 'var '); };
const H = (d, hm, plus) => { const [y, m, dd] = d.split('-').map(Number), [h, mi] = hm.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd + (plus ? 1 : 0), h + 10, mi)).toISOString(); };

function app() {
  const c = { console, STORE: {}, CFG: {}, PLAN: {} };
  vm.createContext(c);
  vm.runInContext(['TIP_HOURS_FIX_FROM', 'TIP_BIZDAY_END_H', 'ATT_THRESHOLD', 'DOW_SHIFT', 'SHIFT_HOURS'].map(constant).join('\n') + '\n' +
    ['_laborHrs', '_thToMin', 'tipHoursFixOn', '_hstMidnightMs', '_tipOverlapBizH', '_thOverlapH', 'applyTipHoursClip', 'applyTipSplit', 'tipHoursWindowFor',
     'getTipLabor', 'actualHoursForDate', 'attendanceForDate', 'sumWeekStats', 'cyclePayHours', 'mondayMDof'].map(fn).join('\n') + `
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function getTipHoursCfg(sid){ return CFG[sid] || { mode:'all' }; }
    function tipSplitHourFor(sid){ var v=Number((getTipHoursCfg(sid)||{}).splitHour); return (v>=0&&v<=24)?v:16; }
    function getAttOverride(sid, d){ return ls('att_override_'+sid+'_'+d, null); }
    function isOrderOnlyAccount(){ return false; }
    function dowLabelForDate(){ return null; }
    function plannedHoursForDate(sid, d){ return PLAN[d] || {}; }
    function getDailyActuals(){ return {}; }
    function empWage(){ return 20; }
    function storeSalaryDaily(){ return 0; }
    function getStoresAll(){ return [{ id:'F06' }]; }
    function getShiftPlan(){ return null; }
    var STORES = getStoresAll();`, c);
  // Tip hours "business hours only", dinner window 17:30–0:00 (the shape LaLa uses); one store with "all clocked hours".
  c.CFG.F06 = { mode: 'hours', l1: '11:00', l2: '14:00', d1: '17:30', d2: '00:00' };
  c.CFG.F01 = { mode: 'all', splitHour: 16 };
  for (const [d, a, b] of [['2026-10-01', '17:08', '00:11'], ['2026-10-02', '17:24', '00:24']]) {
    const raw = (Date.parse(H(d, b, 1)) - Date.parse(H(d, a))) / 3600000;
    c.STORE['tip_labor_F06_' + d] = { 'Staff A': { lunch: 0, dinner: raw, rawLunch: 0, rawDinner: raw, shifts: [{ inDate: H(d, a), outDate: H(d, b, 1) }] } };
    c.STORE['tip_labor_F01_' + d] = { 'Staff B': { lunch: 2, dinner: 4, rawLunch: 2, rawDinner: 4, shifts: [{ inDate: H(d, '14:00'), outDate: H(d, '20:00') }] } };
    c.PLAN[d] = { 'Staff A': { hours: 7 } };
  }
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const r2 = v => Math.round(v * 100) / 100;

test('Tip hours stay clipped to the window; worked hours count the whole clock-in to clock-out', () => {
  const c = app();
  for (const d of ['2026-10-01', '2026-10-02']) {
    const e = run(c, `getTipLabor('F06','${d}')['Staff A']`);
    assert.deepEqual([e.lunch, e.dinner], [0, 6.5], 'Tip hours for ' + d);
  }
  assert.deepEqual(['2026-10-01', '2026-10-02'].map(d => r2(run(c, `actualHoursForDate('F06','${d}')['Staff A'].hours`))), [7.05, 7]);
});

test('a 7.05h clock against a 7h shift is not flagged as a 30-minute difference', () => {
  const errs = run(app(), `attendanceForDate('F06','2026-10-01').map(function(r){ return r.errors.join('/'); })`);
  assert.ok(!errs.join().includes('30分以上差異'), errs.join());
});

test('weekly stats and the pay estimate use worked hours', () => {
  const c = app();
  const w = run(c, `sumWeekStats('F06', ['2026-10-01','2026-10-02'])`);
  assert.equal(r2(w.hours), 14.05); assert.equal(r2(w.laborCost), r2(14.05 * 20));
  const ch = run(c, `cyclePayHours('F06', 'Staff A', { dates: [new Date(2026,9,1), new Date(2026,9,2)] })`);
  assert.equal(r2(ch.actual), 14.05); assert.equal(r2(ch.total), 14.05);
});

test('a store counting all clocked hours shows the same numbers as before', () => {
  const c = app();
  assert.equal(run(c, `actualHoursForDate('F01','2026-10-01')['Staff B'].hours`), 6);
  assert.equal(r2(run(c, `sumWeekStats('F01', ['2026-10-01','2026-10-02'])`).hours), 12);
});

test('the attendance and pay estimate lines on My page sum _laborHrs', () => {
  const mypage = fn('renderMypage');
  assert.ok(/var total = _laborHrs\(e\);/.test(mypage), 'This Month\'s Attendance');
  assert.ok(/var ah=_laborHrs\(e\);/.test(fn('cyclePayHours')), 'pay estimate');
  for (const name of ['renderMypage', 'cyclePayHours', 'actualHoursForDate', 'laborBreakdownForPeriod', 'sumWeekStats', 'unregisteredClockIns']) {
    const body = fn(name).replace(/\/\*[^]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/\.lunch\|\|0\)\s*\+\s*\([^)]*\.dinner\|\|0\)/.test(body), name + ' does not add Tip hours as worked hours');
  }
});
