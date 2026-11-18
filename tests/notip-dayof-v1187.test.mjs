// App v1187 (Moto 2026-10-18 decision, 2026-11-17「12/1 から」): from TIP_NOTIP_DAYOF_START, No Tip is decided by the shifts worked
// before that day and slot (from the first work day), counted from the time records read from the database (tip_labor) in this session.
// Until those records are read the distribution is provisional and marked pending; finalizing and exports wait or stop.
// Days before the start keep the old rule (the shift count as of today), so periods that may already be paid do not change.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
// FUNERGY_INDEX=<path> runs the checks against another build (v1186 fails the new ones).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
const BLOCK = (() => { const a = SRC.indexOf('/* ===== v1187：No Tip'), b = SRC.indexOf('/* ===== v1095：適用開始日（UI案57）'); if (a < 0 || b < a) throw new Error('v1187 block not found'); return SRC.slice(a, b); })();
const START = (/var TIP_NOTIP_DAYOF_START = '(\d{4}-\d{2}-\d{2})'/.exec(SRC) || [])[1];
const SEQ_LINE = (/^var _tipLaborSeq = 0[^\n]*$/m.exec(SRC) || [])[0];
const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const run = (c, code) => vm.runInContext(code, c);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function settle(c) { for (let i = 0; i < 20; i++) { await tick(); if (run(c, 'tipNtIdle()')) { await tick(); return; } } }

const FNS = ['calcTipDistribution', 'tipWeightByRate', '_tipDecDay', '_tipDecDayRaw', '_tipFromOk', '_tipDecDayExact', '_tipDayOk', 'tipRateOn', '_tipLatestApproved',
  '_tipDecT', 'firstWorkDate', 'isThreeMonths', 'effectiveTipRate', 'isTipEligibleRole', 'tipBaseRole', 'isTipExcludedTitle', 'getTipLeaderSplit',
  'calcHalfMonthSettlement', 'halfMonthRange', 'halfMonthDates', 'isoOf', '_tipHstDay', 'workedShiftCount',
  'tipPeriodRates', 'tipPeriodRateFrom', '_tipUsedRate', '_tipRateSlotUsed', 'tipPeriodMatrix', 'confirmTip', 'payDetailHidden', 'payDetailMsg', 'payDetailBlocked', 'exportTipCSV', 'exportAllTipCSV', 'estimateMyTip',
  'syncTipLaborFromDB', 'fetchTipLaborFromDB', '_tipLaborFetchErr', '_tipLaborNewer', '_tipLaborMark', 'fetchTipLabor',
  'toastNameKey', 'toastAliasField', '_toastAliasRec', 'empToastAliases', 'toastAliasIndex', 'toastAliasFind', 'toastAliasResolve', 'tipLaborPut', '_toastShiftsOverlap', 'tipLaborWithGuid'];

// One device. DB = the shared database rows by store (business_date → data). LOCAL = this device's own tip_labor copies.
function device(DB, opts = {}) {
  const c = { console, STORE: {}, EMPS: [], TIPS: {}, TOASTS: [], RENDERS: [], CONFIRMS: {}, ALERTS: [], CSV: [], FETCHES: [], LATER: [], UPS: [], DBQ: [], UX: { notes: 0, refresh: 0 }, DB, OPTS: opts, Promise, URL };
  c.setTimeout = (fn, ms) => { if ((ms || 0) >= 1000) { c.LATER.push({ fn, ms }); return 0; } return setTimeout(fn, ms); };
  c.clearTimeout = (h) => clearTimeout(h);
  c.window = { FUNERGY_UX: { noteDataChange() { c.UX.notes++; }, bgRefresh() { c.UX.refresh++; } } };
  vm.createContext(c);
  run(c, FNS.map(fnSrc).join('\n') + '\n' + BLOCK + '\n' + SEQ_LINE + `
    var TIP_RATE_WEIGHT_START = '2026-10-16', TIP_SL_SPLIT_END = '2026-08-01';
    var TIP_EXCLUDED_TITLES = ['Prep','Store Manager','Area Manager','General Manager','CEO','Office Crew','Accountant'];
    var ROLE_ALIAS = { g2: 'sl', g4: 'am' };
    var STORES = [{ id: 'F01', brand: 'ToriTon', toastGuid: 'g-F01' }, { id: 'F02', brand: 'Tenkichi', toastGuid: 'g-F02' }, { id: 'F09', brand: 'X' }];
    var ROLE_CONFIG = { gm: { name: 'GM' } }, curRole = 'gm', curLang = 'ja', curPage = 'tip';
    var SUPABASE_URL = 'https://db.example', SUPABASE_ANON = 'anon', TOAST_SYNC_FN = 'https://fn.example/toast';
    function t(ja){ return ja; } function escapeHtml(s){ return String(s); }
    function getEmployees(){ return EMPS; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function lsKeys(p){ return Object.keys(STORE).filter(function(k){ return k.indexOf(p) === 0; }); }
    function _lsRaw(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : d; }
    function setTipLabor(s, d, labor){ STORE['tip_labor_' + s + '_' + d] = JSON.parse(JSON.stringify(labor)); }
    function getTipLabor(s, d){ var x = STORE['tip_labor_' + s + '_' + d]; return x ? JSON.parse(JSON.stringify(x)) : null; }
    function setCreditTipAdjLocal(){}
    function normalizeBusinessDate(b){ return String(b).slice(0, 10); }
    function tipHoursFromShifts(){ return { lunch: 0, dinner: 0 }; }
    function tipForDay(s, d){ var x = TIPS[s + '|' + d] || { l: 0, d: 0 }; return { lunchTotal: x.l, dinnerTotal: x.d, total: x.l + x.d, lunchCredit: x.l, dinnerCredit: x.d, lunchCash: 0, dinnerCash: 0 }; }
    var EXCL = {}; function isTipExcluded(s, d, n, slot){ return !!EXCL[s + '|' + d + '|' + n + '|' + slot]; }
    function isOrderOnlyAccount(){ return false; }
    function isStoreLeader(){ return false; }
    function noTipShifts(){ return 3; }
    var PERIOD = null; function tipPeriodInfo(){ return PERIOD; }
    function attDaysApprovedForPeriod(){ return { anyData: false, allApproved: true }; }
    function setTipConfirm(s, info, data){ CONFIRMS[s + '|' + info.from] = JSON.parse(JSON.stringify(data)); }
    function nowJP(){ return '2026/12/16 22:00'; }
    function todayISO(){ return '2026-12-10'; }
    function alert(m){ ALERTS.push(m); }
    function showToast(m, k){ TOASTS.push([m, k]); } function renderPage(p){ RENDERS.push(p); }
    function getVisibleStores(){ return STORES.filter(function(s){ return s.toastGuid; }); }
    function _acctPeriods(a, b){ return [a]; }
    function _acctTipMiss(s, d){ return [s.id, d, 'miss']; } function _acctTipMissRows(l){ return l; }
    function acctMonthLabel(){ return '2026-12'; }
    function tipCSVRows(s, d){ return [[s, d, calcHalfMonthSettlement(s, d).rows.map(function(r){ return r.name + ':' + r.final.toFixed(4); }).join(' ')]]; }
    function downloadCSV(rows, name){ CSV.push({ rows: JSON.parse(JSON.stringify(rows)), name: name }); }
    // OPTS.upsertDefer: each save waits until the test answers it (UPS[i].res(true|false)); rows = what was saved
    function supaUpsert(t, rows){ if (OPTS.upsertDefer) return new Promise(function(res){ UPS.push({ rows: rows, res: res }); }); return Promise.resolve(!!OPTS.upsertOk); }
    function toastFnBody(o){ return JSON.stringify(o); }
    function fetch(url){
      FETCHES.push(String(url));
      if (OPTS.down) return Promise.reject(new Error('offline'));
      // OPTS.toastQ: one list of employees per Toast pull, in the order the pulls start
      if (String(url).indexOf(TOAST_SYNC_FN) === 0) { var emps = (OPTS.toastQ && OPTS.toastQ.length) ? OPTS.toastQ.shift() : (OPTS.toast || []);
        return Promise.resolve({ json: function(){ return Promise.resolve({ employees: emps }); } }); }
      var u = new URL(String(url)), guid = (u.searchParams.get('restaurant_guid') || '').replace(/^eq\\./, ''), g = u.searchParams.getAll('business_date'),
          from = (g.find(function(x){ return x.indexOf('gte.') === 0; }) || '').slice(4), to = (g.find(function(x){ return x.indexOf('lte.') === 0; }) || '').slice(4);
      var sid = (STORES.find(function(s){ return s.toastGuid === guid; }) || {}).id, rows = [];
      Object.keys((DB[sid] || {})).sort().forEach(function(d){ if (d >= from && d <= to) rows.push({ restaurant_guid: guid, business_date: d, data: DB[sid][d] }); });
      if (OPTS.manyRows) for (var i = rows.length; i < 1000; i++) rows.push({ restaurant_guid: guid, business_date: '1999-01-01', data: [] });
      var ans = { ok: true, json: function(){ return Promise.resolve(rows); } };
      // OPTS.dbDefer: the database answers when the test says so (DBQ[i]()) — the rows are the ones at the time the read was asked
      if (OPTS.dbDefer) return new Promise(function(res){ DBQ.push(function(){ res(ans); }); });
      return Promise.resolve(ans);
    }
    // the business day (Hawaii) of the device: later than every test day unless a test sets OPTS.today. Older builds have no such function.
    var TODAY = OPTS.today || '2026-12-20'; if (typeof _tipNtToday === 'function') _tipNtToday = function(){ return TODAY; };
  `);
  return c;
}
const EMP = (o) => Object.assign({ store: 'F01', role: 'crew', status: '在籍', title: 'Crew', coef: 1 }, o);
const W = (name, l, d) => ({ name, lunchHours: l, dinnerHours: d });   // a database row entry (no punch times → the hours as given)
const local = (c, s, d, map) => { c.STORE['tip_labor_' + s + '_' + d] = Object.fromEntries(Object.entries(map).map(([k, [l, dn]]) => [k, { lunch: l, dinner: dn }])); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);
const dist = (c, s, d) => plain(run(c, `calcTipDistribution(${JSON.stringify(s)}, ${JSON.stringify(d)})`));
const row = (x, n) => x.list.find(r => r.name === n) || {};

// N (new, first work 11/20) worked 11/20 lunch and 11/21 dinner (2 shifts). No Tip lasts 3 shifts.
// On 12/05 lunch is the 3rd shift (No Tip); dinner is the 4th (paid). V (veteran) works both slots.
const DB0 = () => ({ F01: {
  '2026-11-20': [W('N', 4, 0), W('V', 4, 5)],
  '2026-11-21': [W('N', 0, 5), W('V', 4, 5)],
  '2026-12-05': [W('N', 4, 5), W('V', 4, 5)],
} });
function staff(c) {
  c.EMPS = [EMP({ name: 'N', firstWork: '2026-11-20' }), EMP({ name: 'V', firstWork: '2025-01-10' })];
  c.TIPS['F01|2026-12-05'] = { l: 80, d: 100 };
  c.TIPS['F01|2026-11-21'] = { l: 80, d: 100 };
}

test('the start is 12/1 (Moto 11/17), the first day of a pay period, so no period that may already be paid changes', () => {
  assert.equal(START, '2026-12-01');
  assert.match(START, /^\d{4}-\d{2}-(01|16)$/);
});

test('two devices give the same amounts: one with every earlier record on the device, one with only the day itself', async () => {
  const A = device(DB0()), B = device(DB0());
  [A, B].forEach(staff);
  // device A holds all of N's days; device B only the day itself (it has not read November)
  for (const [d, m] of [['2026-11-20', { N: [4, 0], V: [4, 5] }], ['2026-11-21', { N: [0, 5], V: [4, 5] }], ['2026-12-05', { N: [4, 5], V: [4, 5] }]]) local(A, 'F01', d, m);
  local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  // the old rule (today's count on the device) disagrees between them
  assert.equal(run(A, "effectiveTipRate('N')"), 80, 'A counts 4 shifts → past No Tip');
  assert.equal(run(B, "effectiveTipRate('N')"), 0, 'B counts 2 shifts → still No Tip');
  const a0 = dist(A, 'F01', '2026-12-05'), b0 = dist(B, 'F01', '2026-12-05');
  assert.equal(a0.pending, true, 'not known yet on A'); assert.equal(b0.pending, true, 'not known yet on B');
  assert.deepEqual(a0.pendingNames, ['N']);
  await settle(A); await settle(B);
  assert.ok(A.FETCHES.some(u => /restaurant_guid=eq\.g-F01/.test(u) && /gte\.2026-11-20/.test(u) && /lte\.2026-12-05/.test(u)), 'reads from the first work day to that day');
  const a1 = dist(A, 'F01', '2026-12-05'), b1 = dist(B, 'F01', '2026-12-05');
  assert.equal(a1.pending, false); assert.equal(b1.pending, false);
  for (const x of [a1, b1]) {
    assert.equal(row(x, 'N').lunchNoTip, true, 'lunch is the 3rd shift: No Tip');
    assert.equal(row(x, 'N').dinnerNoTip, false, 'dinner is the 4th shift: paid');
    near(row(x, 'N').lunch, 0, 'no lunch tip');
    near(row(x, 'V').lunch, 80, 'V takes the whole lunch');
    near(row(x, 'N').dinner, 100 * (5 * 0.8) / (5 * 0.8 + 5 * 1.0), 'N shares the dinner at 80%');
  }
  assert.deepEqual(a1.list.map(r => [r.name, r.total]), b1.list.map(r => [r.name, r.total]), 'same amounts on both devices');
  assert.ok(A.UX.notes >= 1 && A.UX.refresh >= 1, 'the screen is redrawn after the records are read');
});

test('days before 12/1 keep the old rule (shift count as of today) and read nothing more', async () => {
  const B = device(DB0()); staff(B);
  local(B, 'F01', '2026-11-21', { N: [0, 5], V: [4, 5] });
  const x = dist(B, 'F01', '2026-11-21');
  assert.equal(x.pending, false);
  assert.equal(row(x, 'N').dinnerNoTip, true, 'the old rule on this device (1 shift on the device → No Tip)');
  await settle(B);
  assert.equal(B.FETCHES.length, 0, 'nothing is read for days before 12/1');
});

test('people the shift count cannot change are decided without reading: Waikiki, roles outside 80/90/100, 3 months, an approval in effect', async () => {
  const c = device(DB0());
  c.EMPS = [EMP({ name: 'K', store: 'F03', firstWork: '2026-11-20' }), EMP({ name: 'L', role: 'g2', title: 'Crew Leader', firstWork: '2026-11-20' }),
    EMP({ name: 'O', firstWork: '2026-08-01' }), EMP({ name: 'P', firstWork: '2026-11-25' })];
  c.STORE.tip_requests = [{ id: 'tip1', name: 'P', rate: 90, status: '承認', decDay: '2026-12-02', decAt: 1 }];
  for (const n of ['K', 'L', 'O']) assert.equal(run(c, `tipNoTipOn('${n}', '2026-12-05', 'lunch')`), false, n);
  assert.equal(run(c, "tipNoTipOn('P', '2026-12-05', 'lunch')"), false, 'approved 90% from 12/2');
  assert.equal(run(c, "tipNoTipOn('P', '2026-12-01', 'lunch')"), null, 'before the approval: the shift count decides (needs the records)');
  assert.equal(run(c, "tipNoTipOn('P', '2026-11-24', 'lunch')"), true, 'a day before the first work day: no earlier shifts');
  await settle(c);
});

test('when the records cannot be read: provisional amounts, finalizing and exports stop (nothing provisional is kept or exported)', async () => {
  const B = device(DB0(), { down: true }); staff(B);
  local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  B.PERIOD = { from: '2026-12-01', to: '2026-12-15', anyDate: '2026-12-05', label: '12/1-15', rangeLabel: '12/1-15', dates: [] };
  const x = dist(B, 'F01', '2026-12-05');
  assert.equal(x.pending, true);
  assert.equal(row(x, 'N').lunchNoTip, true, 'provisional = the old rule on this device');
  await settle(B);
  assert.equal(dist(B, 'F01', '2026-12-05').pending, true, 'still unknown after the failed read');
  run(B, "confirmTip('F01')"); await tick(20);   // finalizing also waits for the records first (Claude routine #187 P3-4), then stops
  assert.equal(Object.keys(B.CONFIRMS).length, 0, 'not finalized');
  assert.match(B.ALERTS[0] || '', /No Tip/);
  await run(B, "exportTipCSV('F01', '2026-12-05')");
  await run(B, "exportAllTipCSV('2026-12-05', '2026-12-20')");
  assert.equal(B.CSV.length, 0, 'nothing exported');
  assert.ok(B.TOASTS.some(([m, k]) => k === 'danger' && /No Tip/.test(m)));
  assert.ok(B.LATER.some(l => l.ms >= 30000), 'tries again later (redraws after 30 seconds)');
  // the connection comes back: the next try reads and the export goes through
  B.OPTS.down = false;
  run(B, "_tipNtSt().failAt = {}");
  await run(B, "exportTipCSV('F01', '2026-12-05')");
  assert.equal(B.CSV.length, 1, 'exported after reading');
  run(B, "confirmTip('F01')");
  assert.equal(Object.keys(B.CONFIRMS).length, 1, 'finalized after reading');
});

test('an export waits for the records and then uses the decided amounts', async () => {
  const B = device(DB0()); staff(B);
  local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  await run(B, "exportTipCSV('F01', '2026-12-05')");
  assert.equal(B.CSV.length, 1);
  const text = B.CSV[0].rows[0][2];
  // decided: lunch 80 all to V; dinner 100 split 5×1.0 : 5×0.8 → V 80+55.5556, N 44.4444. Provisional on this device (N No Tip in both) would be V 180, N 0.
  assert.match(text, /V:135\.5556/, 'V: the whole lunch and his dinner share');
  assert.match(text, /N:44\.4444/, 'N: the dinner share only');
});

test('a read that may be cut off (1000 rows) is not trusted; a later read of an older start does not undo a newer one', async () => {
  const c = device(DB0(), { manyRows: true }); staff(c);
  local(c, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(c, 'F01', '2026-12-05'); await settle(c);
  assert.equal(dist(c, 'F01', '2026-12-05').pending, true, 'not covered');
  const d = device(DB0());
  run(d, "_tipNtRecordDay('F01', '2026-11-20', { N: { lunch: 0, dinner: 0 } }, 5); _tipNtRecordDay('F01', '2026-11-20', { N: { lunch: 4, dinner: 0 } }, 3)");
  assert.deepEqual(plain(run(d, "_tipNtSt().day.F01['2026-11-20']")), { seq: 5, c: {} }, 'the newer read stays');
  run(d, "_tipNtRecordRange('F01', '2026-11-20', '2026-11-25'); _tipNtRecordRange('F01', '2026-11-26', '2026-12-05')");
  assert.equal(run(d, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), true, 'touching ranges join');
  // the database later has no records for a day (emptied): a newer read counts it as 0, not the older copy
  const e = device({ F01: { '2026-11-21': [] } });
  run(e, "_tipNtRecordDay('F01', '2026-11-21', { N: { lunch: 0, dinner: 5 } }, 1)");
  await run(e, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-21' }, { date: '2026-11-21' }])");
  assert.deepEqual(plain(run(e, "_tipNtSt().day.F01['2026-11-21'].c")), {}, 'emptied day → no shifts');
  run(d, "_tipNtRecordRange('F01', '2026-12-07', '2026-12-09')");
  assert.equal(run(d, "_tipNtCovered('F01', '2026-11-20', '2026-12-08')"), false, 'a gap (12/6) is not covered');
});

test('records only on this device (a Toast pull that could not be saved to the database) are not counted; saved ones are', async () => {
  const c = device({ F01: { '2026-12-05': [W('N', 4, 5), W('V', 4, 5)] } }, { upsertOk: false, toast: [W('N', 4, 0), W('V', 4, 5)] }); staff(c);
  run(c, "fetchTipLabor('F01', 'g-F01', '2026-11-20')"); await settle(c);
  assert.equal(run(c, "_tipNtSt().day.F01 && _tipNtSt().day.F01['2026-11-20'] ? 1 : 0"), 0, 'not saved to the database → not counted');
  c.OPTS.upsertOk = true;
  await run(c, "fetchTipLabor('F01', 'g-F01', '2026-11-20')");
  assert.deepEqual(plain(run(c, "_tipNtSt().day.F01['2026-11-20'].c")), { N: { n: 1, l: 1 }, V: { n: 2, l: 1 } }, 'saved → counted like the database');
});

test('the rates used in the period count a day when a slot was paid (a No Tip lunch with a paid dinner still uses the rate)', () => {
  const c = device({});
  const rates = plain(run(c, `tipPeriodRates([{ date: '2026-12-05', dist: { list: [
    { name: 'N', by: 'rate', rate: 80, lunchHours: 4, dinnerHours: 5, lunchNoTip: true, dinnerNoTip: false },
    { name: 'M', by: 'rate', rate: 80, lunchHours: 4, dinnerHours: 0, lunchNoTip: true, dinnerNoTip: true } ] } }])`));
  assert.deepEqual(rates, { N: [80] });
});

test('my tip shows that it is still being checked; version markers are 1187 or later and match', async () => {
  const B = device(DB0()); staff(B);
  local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  run(B, "todayISO = function(){ return '2026-12-05'; }");
  assert.equal(plain(run(B, "estimateMyTip('F01', 'N')")).pending, true);
  await settle(B);
  assert.equal(plain(run(B, "estimateMyTip('F01', 'N')")).pending, false);
  assert.match(SRC, /tipEst\.pending \? t\('・確認中'/);
  const v = (/const APP_VERSION = '(\d+)'/.exec(SRC) || [])[1], SW = fs.readFileSync(process.env.FUNERGY_SW || new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(Number(v) >= 1187); assert.equal((/const SW_BUILD = '(\d+)'/.exec(SW) || [])[1], v);
});

// ===== Codex（#187 6959067758・6959181675）P2 1〜3 と Claude のルーティン（6959088692）P3 の直し =====

test('Codex P2-1: an older Toast pull whose save answers later does not replace the newer pull’s shift count (the same order rule as the device copy)', async () => {
  // A (older) = lunch only, B (newer) = lunch and dinner. Both saves succeed; B's answer arrives first, A's later.
  const c = device({ F01: {} }, { toastQ: [[W('N', 4, 0)], [W('N', 4, 5)]], upsertDefer: true }); staff(c);
  const pA = run(c, "fetchTipLabor('F01', 'g-F01', '2026-11-21')");
  const pB = run(c, "fetchTipLabor('F01', 'g-F01', '2026-11-21')");
  for (let i = 0; i < 10 && c.UPS.length < 2; i++) await tick();
  assert.equal(c.UPS.length, 2, 'both pulls are saving');
  const which = u => u.rows[0].data[0].dinnerHours;   // 0 = A, 5 = B
  const ua = c.UPS.find(u => which(u) === 0), ub = c.UPS.find(u => which(u) === 5);
  ub.res(true); await pB;
  ua.res(true); await pA;
  const N = plain(c.STORE['tip_labor_F01_2026-11-21']).N;
  assert.deepEqual([N.lunch, N.dinner], [4, 5], 'the device copy keeps B (as before)');
  assert.deepEqual(plain(run(c, "_tipNtSt().day.F01['2026-11-21'].c")).N, { n: 2, l: 1 }, 'the No Tip count keeps B too (2 shifts), not A (1)');
});

test('Codex P2-2: a day that is gone from the database counts as 0 after a full read of the range (two devices agree); a newer record is not cleared by an older read', async () => {
  const DB = DB0(), A = device(DB); staff(A);
  local(A, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(A, 'F01', '2026-12-05'); await settle(A);
  near(row(dist(A, 'F01', '2026-12-05'), 'N').dinner, 44.4444444444, 'with 11/21 in the database: dinner is the 4th shift (paid)');
  delete DB.F01['2026-11-21'];   // the row is gone from the database
  await run(A, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-12-05' }])");
  const B = device(DB); staff(B); local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(B, 'F01', '2026-12-05'); await settle(B);
  const a = dist(A, 'F01', '2026-12-05'), b = dist(B, 'F01', '2026-12-05');
  assert.equal(a.pending, false); assert.equal(b.pending, false);
  near(row(a, 'N').dinner, 0, 'A after reading again: dinner is the 3rd shift (No Tip)');
  assert.deepEqual(a.list.map(r => [r.name, r.total]), b.list.map(r => [r.name, r.total]), 'the same amounts as a device that reads now');
  // order: a record from a read started later (seq 9) stays when an earlier read (seq 7) did not see that day; a later read (seq 10) clears it
  const d = device({});
  run(d, "_tipNtRecordDay('F01', '2026-11-21', { N: { lunch: 0, dinner: 5 } }, 9)");
  run(d, "_tipNtRecordRange('F01', '2026-11-20', '2026-11-25', 7, null, ['2026-11-20'])");
  assert.deepEqual(plain(run(d, "_tipNtSt().day.F01['2026-11-21']")), { seq: 9, c: { N: { n: 1, l: 0 } } }, 'the newer record stays');
  run(d, "_tipNtRecordRange('F01', '2026-11-20', '2026-11-25', 10, null, ['2026-11-20'])");
  assert.deepEqual(plain(run(d, "_tipNtSt().day.F01['2026-11-21']")), { seq: 10, c: {} }, 'a later full read that did not see it: 0');
  // a read that may be cut off (1000 rows) clears nothing
  const e = device({ F01: { '2026-11-20': [W('N', 4, 0)] } }, { manyRows: true });
  run(e, "_tipNtRecordDay('F01', '2026-11-21', { N: { lunch: 0, dinner: 5 } }, 1)");
  await run(e, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-11-25' }])");
  assert.deepEqual(plain(run(e, "_tipNtSt().day.F01['2026-11-21'].c")), { N: { n: 1, l: 0 } }, 'not trusted → not cleared');
});

test('Codex re-review (#187 6959851589): a day the newer read found missing stays 0 when an older read answers later, even if the device had no record of it (two devices agree)', async () => {
  const range = "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-12-05' }])";
  const wait = async (c, n) => { for (let i = 0; i < 20 && c.DBQ.length < n; i++) await tick(); assert.equal(c.DBQ.length, n, n + ' read(s) waiting for the database'); };
  // the device has read nothing yet (no record of 11/21). R1 is asked while 11/21 is still there, R2 after it is gone; R2 answers first
  const DB = DB0(), A = device(DB, { dbDefer: true }); staff(A);
  local(A, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  assert.equal(run(A, "(_tipNtSt().day.F01 ? 1 : 0)"), 0, 'nothing recorded before the reads');
  const p1 = run(A, range); await wait(A, 1);
  delete DB.F01['2026-11-21'];
  const p2 = run(A, range); await wait(A, 2);
  A.DBQ[1](); await p2;
  near(row(dist(A, 'F01', '2026-12-05'), 'N').dinner, 0, 'after the newer read: 11/21 is gone, dinner is the 3rd shift (No Tip)');
  const r2 = plain(run(A, "_tipNtSt().day.F01['2026-11-21']"));
  assert.deepEqual(r2 && r2.c, {}, 'the newer read leaves a 0 record with its order even for a day the device never had');
  A.DBQ[0](); await p1;
  assert.deepEqual(plain(run(A, "_tipNtSt().day.F01['2026-11-21']")), r2, 'the older read answering later does not bring 11/21 back');
  const a = dist(A, 'F01', '2026-12-05');
  assert.equal(a.pending, false);
  near(row(a, 'N').dinner, 0, 'still No Tip after the older answer');
  // a device that reads the database now (11/21 gone) gives the same amounts
  const B = device(DB); staff(B); local(B, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(B, 'F01', '2026-12-05'); await settle(B);
  const b = dist(B, 'F01', '2026-12-05');
  assert.equal(b.pending, false);
  assert.deepEqual(a.list.map(r => [r.name, r.total]), b.list.map(r => [r.name, r.total]), 'the same amounts on both devices');
  // the other way round: a day that appears between the reads stays when the older read (which did not see it) answers later
  const DB2 = DB0(); delete DB2.F01['2026-11-21'];
  const C = device(DB2, { dbDefer: true }); staff(C);
  local(C, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  const q1 = run(C, range); await wait(C, 1);
  DB2.F01['2026-11-21'] = [W('N', 0, 5), W('V', 4, 5)];
  const q2 = run(C, range); await wait(C, 2);
  C.DBQ[1](); await q2; C.DBQ[0](); await q1;
  assert.deepEqual(plain(run(C, "_tipNtSt().day.F01['2026-11-21'].c")).N, { n: 1, l: 0 }, 'the newer read’s 11/21 stays');
  const c2 = dist(C, 'F01', '2026-12-05'), D = device(DB2); staff(D); local(D, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(D, 'F01', '2026-12-05'); await settle(D);
  near(row(c2, 'N').dinner, 44.4444444444, 'dinner is the 4th shift (paid)');
  assert.deepEqual(c2.list.map(r => [r.name, r.total]), dist(D, 'F01', '2026-12-05').list.map(r => [r.name, r.total]), 'the same amounts on both devices');
  // every day of the range gets the read's order, the first and the last included; an older answer for any of them is not used
  const E = device({});
  run(E, "_tipNtRecordRange('F01', '2026-11-20', '2026-11-25', 5, null, ['2026-11-22'])");
  assert.deepEqual(Object.keys(plain(run(E, '_tipNtSt().day.F01'))).sort(), ['2026-11-20', '2026-11-21', '2026-11-23', '2026-11-24', '2026-11-25'], 'all days not returned, ends included');
  ['2026-11-20', '2026-11-25'].forEach(d => {
    run(E, `_tipNtRecordDay('F01', '${d}', { N: { lunch: 4, dinner: 5 } }, 4)`);
    assert.deepEqual(plain(run(E, `_tipNtSt().day.F01['${d}']`)), { seq: 5, c: {} }, d + ': an older answer does not bring it back');
  });
});

test('Codex P2-3: logging out (or another person logging in) drops what was read, the waiting exports and the late answers of the previous login', async () => {
  // doLogout calls the reset (both copies of the function)
  assert.equal((SRC.match(/if\(typeof tipNtReset==='function'\) tipNtReset\(\);/g) || []).length, 2, 'both doLogout copies reset No Tip');
  const c = device(DB0()); staff(c);
  local(c, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(c, 'F01', '2026-12-05'); await settle(c);
  assert.equal(dist(c, 'F01', '2026-12-05').pending, false);
  run(c, 'tipNtReset()');   // what doLogout does
  c.OPTS.down = true; const n0 = c.FETCHES.length;
  const x = dist(c, 'F01', '2026-12-05');
  assert.equal(x.pending, true, 'the next login does not use what the previous one read');
  assert.equal(run(c, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false);
  await settle(c);
  assert.ok(c.FETCHES.length > n0, 'it reads again');
  // a read of the previous login that answers after the logout is not used; an export waiting for it stops without a message
  const d = device(DB0(), { dbDefer: true }); staff(d);
  local(d, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  const pe = run(d, "exportTipCSV('F01', '2026-12-05')");
  for (let i = 0; i < 10 && !d.DBQ.length; i++) await tick();
  assert.equal(d.DBQ.length, 1, 'the read is waiting for the database');
  run(d, 'tipNtReset()');
  const notes0 = d.UX.notes, later0 = d.LATER.length;
  d.DBQ.shift()(); await pe; await tick();
  assert.equal(d.UX.notes, notes0, 'the previous login’s read does not redraw the next person’s screen');
  assert.equal(d.LATER.length, later0, 'nor schedule anything');
  assert.equal(d.CSV.length, 0, 'the previous login’s export is not made');
  assert.ok(!d.TOASTS.some(([m, k]) => k === 'danger'), 'and no error is shown to the next person');
  assert.equal(run(d, "(_tipNtSt().day.F01 ? 1 : 0)"), 0, 'the late answer is not recorded for the next login');
  assert.equal(run(d, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false);
  // another person logs in without a logout on this page: the same
  const e = device(DB0()); staff(e);
  run(e, "var curUserName = 'Aki'");
  local(e, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(e, 'F01', '2026-12-05'); await settle(e);
  assert.equal(run(e, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), true);
  run(e, "curUserName = 'Ben'");
  assert.equal(run(e, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false, 'another person: read again');
  // finalizing that waits across a logout does nothing
  const f = device(DB0(), { dbDefer: true }); staff(f);
  local(f, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  f.PERIOD = { from: '2026-12-01', to: '2026-12-15', anyDate: '2026-12-05', label: '12/1-15', rangeLabel: '12/1-15', dates: [] };
  run(f, "confirmTip('F01')");
  for (let i = 0; i < 10 && !f.DBQ.length; i++) await tick();
  run(f, 'tipNtReset()'); f.DBQ.shift()(); await tick(20);
  assert.equal(Object.keys(f.CONFIRMS).length, 0, 'not finalized'); assert.equal(f.ALERTS.length, 0, 'no message');
});

test('Claude routine P3-1: a day that had not ended when it was read is used only that day; future days are not marked as read', async () => {
  const c = device(DB0(), { today: '2026-12-05' }); staff(c);
  await run(c, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-12-31' }])");
  assert.deepEqual(plain(run(c, "_tipNtSt().cov.F01")), [['2026-11-20', '2026-12-04']], 'whole days up to the day before');
  assert.equal(run(c, "_tipNtSt().part.F01"), '2026-12-05', 'today (not ended) separately');
  assert.equal(run(c, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), true, 'today it is used');
  assert.equal(run(c, "_tipNtCovered('F01', '2026-11-20', '2026-12-31')"), true, 'a later day counts what exists up to today');
  run(c, "TODAY = '2026-12-06'");   // the page stays open past midnight
  assert.equal(run(c, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false, '12/5 was read before it ended → read again');
  assert.equal(run(c, "_tipNtCovered('F01', '2026-11-20', '2026-12-04')"), true);
  // a read asked before midnight that answers after it: the day it was asked is not whole
  const d = device({}, { today: '2026-12-06' });
  run(d, "_tipNtRecordRange('F01', '2026-11-20', '2026-12-05', 1, null, [], '2026-12-05')");
  assert.equal(run(d, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false);
  assert.equal(run(d, "_tipNtCovered('F01', '2026-11-20', '2026-12-04')"), true);
  // the same through the real read: asked on 12/5, the database answers after midnight
  const g = device(DB0(), { today: '2026-12-05', dbDefer: true });
  const pg = run(g, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-12-05' }])");
  for (let i = 0; i < 10 && !g.DBQ.length; i++) await tick();
  run(g, "TODAY = '2026-12-06'"); g.DBQ.shift()(); await pg;
  assert.equal(run(g, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false, 'the day it was asked was not over: not whole');
  assert.equal(run(g, "_tipNtCovered('F01', '2026-11-20', '2026-12-04')"), true);
  // today that was not read is not covered (only the days before it were read)
  const h = device(DB0(), { today: '2026-12-05' });
  await run(h, "syncTipLaborFromDB('F01', 'g-F01', [{ date: '2026-11-20' }, { date: '2026-12-04' }])");
  assert.equal(run(h, "_tipNtCovered('F01', '2026-11-20', '2026-12-04')"), true);
  assert.equal(run(h, "_tipNtCovered('F01', '2026-11-20', '2026-12-05')"), false, 'today was not read');
  // the distribution of a day read the same day is decided; the next day it is read again
  const e = device(DB0(), { today: '2026-12-05' }); staff(e);
  local(e, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  dist(e, 'F01', '2026-12-05'); await settle(e);
  assert.equal(dist(e, 'F01', '2026-12-05').pending, false);
  run(e, "TODAY = '2026-12-06'"); const n0 = e.FETCHES.length;
  assert.equal(dist(e, 'F01', '2026-12-05').pending, true); await settle(e);
  assert.ok(e.FETCHES.length > n0); assert.equal(dist(e, 'F01', '2026-12-05').pending, false);
});

test('Claude routine P3-3 and P3-4: when the records cannot be read, the wait grows (30 s → 5 min); finalizing waits for the records like the exports', async () => {
  const c = device(DB0(), { down: true }); staff(c);
  local(c, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  const ms = [];
  for (let i = 0; i < 6; i++) {
    run(c, "var _S = _tipNtSt(); if (_S.failAt.F01) _S.failAt.F01 = Date.now() - 400000");   // the wait has passed
    dist(c, 'F01', '2026-12-05'); await settle(c);
    ms.push(run(c, "_tipNtRetryMs(_tipNtSt(), 'F01')"));
  }
  assert.deepEqual(ms, [30000, 60000, 120000, 240000, 300000, 300000]);
  // online but not read yet: finalizing reads first and then finalizes (no message)
  const d = device(DB0()); staff(d);
  local(d, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  d.PERIOD = { from: '2026-12-01', to: '2026-12-15', anyDate: '2026-12-05', label: '12/1-15', rangeLabel: '12/1-15', dates: [] };
  run(d, "confirmTip('F01')"); await settle(d); await tick(20);
  assert.equal(d.ALERTS.length, 0);
  const conf = d.CONFIRMS['F01|2026-12-01'];
  assert.ok(conf, 'finalized after reading');
  near(conf.rows.find(r => r.name === 'N').final, 44.4444444444, 'with the decided No Tip (dinner paid)');
  // the period on the screen changed while waiting: the period that was pressed is not finalized as another one
  const e = device(DB0(), { dbDefer: true }); staff(e);
  local(e, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  e.PERIOD = { from: '2026-12-01', to: '2026-12-15', anyDate: '2026-12-05', label: '12/1-15', rangeLabel: '12/1-15', dates: [] };
  run(e, "confirmTip('F01')");
  for (let i = 0; i < 10 && !e.DBQ.length; i++) await tick();
  e.PERIOD = { from: '2026-12-16', to: '2026-12-31', anyDate: '2026-12-20', label: '12/16-31', rangeLabel: '12/16-31', dates: [] };
  e.DBQ.shift()(); await settle(e); await tick(20);
  assert.equal(Object.keys(e.CONFIRMS).length, 0);
  // Claude routine (6959819492 P3-1): pressed again while waiting → still one finalizing and one message; the mark is released afterwards
  const done = c => c.TOASTS.filter(([m]) => m === 'Tipを確定しました').length;
  const f = device(DB0(), { dbDefer: true }); staff(f);
  local(f, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  f.PERIOD = { from: '2026-12-01', to: '2026-12-15', anyDate: '2026-12-05', label: '12/1-15', rangeLabel: '12/1-15', dates: [] };
  run(f, "confirmTip('F01')");
  for (let i = 0; i < 10 && !f.DBQ.length; i++) await tick();
  const toasts0 = f.TOASTS.length;
  run(f, "confirmTip('F01')"); run(f, "confirmTip('F01')");
  assert.equal(f.TOASTS.length, toasts0 + 2, 'each extra press only says it is still loading');
  assert.ok(f.TOASTS.slice(toasts0).every(([m, k]) => k === 'info' && /読み込んでいます/.test(m)));
  while (f.DBQ.length) f.DBQ.shift()();
  await settle(f); await tick(20);
  assert.equal(done(f), 1, 'finalized once');
  assert.ok(f.CONFIRMS['F01|2026-12-01']);
  run(f, "confirmTip('F01')"); await tick(20);
  assert.equal(done(f), 2, 'pressing again later works (the waiting mark was released)');
  // the mark is per period: while 12/1-15 waits, the next period of the same store can still be finalized
  const DBh = DB0(); DBh.F01['2026-12-20'] = [W('N', 4, 5), W('V', 4, 5)];
  const h = device(DBh, { dbDefer: true }); staff(h);
  local(h, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] }); local(h, 'F01', '2026-12-20', { N: [4, 5], V: [4, 5] });
  h.TIPS['F01|2026-12-20'] = { l: 80, d: 100 };
  h.PERIOD = f.PERIOD;
  run(h, "confirmTip('F01')");
  for (let i = 0; i < 10 && !h.DBQ.length; i++) await tick();
  h.PERIOD = { from: '2026-12-16', to: '2026-12-31', anyDate: '2026-12-20', label: '12/16-31', rangeLabel: '12/16-31', dates: [] };
  run(h, "confirmTip('F01')");
  for (let k = 0; k < 20; k++) { while (h.DBQ.length) h.DBQ.shift()(); await tick(); }
  await settle(h); await tick(20);
  assert.ok(h.CONFIRMS['F01|2026-12-16'], 'the later period is finalized');
  assert.ok(!h.CONFIRMS['F01|2026-12-01'], 'the earlier one is not (the screen moved to another period while it waited)');
  // a wait ended by a logout also releases the mark: the next login can finalize
  const g = device(DB0(), { dbDefer: true }); staff(g);
  local(g, 'F01', '2026-12-05', { N: [4, 5], V: [4, 5] });
  g.PERIOD = f.PERIOD;
  run(g, "confirmTip('F01')");
  for (let i = 0; i < 10 && !g.DBQ.length; i++) await tick();
  run(g, 'tipNtReset()'); g.DBQ.shift()(); await tick(20);
  const reads0 = g.FETCHES.length;
  run(g, "confirmTip('F01')");
  for (let i = 0; i < 10 && !g.DBQ.length; i++) await tick();
  assert.ok(g.FETCHES.length > reads0, 'the next login starts its own wait (not blocked by the previous one)');
  while (g.DBQ.length) g.DBQ.shift()();
  await settle(g); await tick(20);
  assert.equal(done(g), 1);
});
