// App v1095 (Moto 2026-10-19, UI案57 Q1〜Q5: 1〜4 A, 5「80%,90%,100%で表示」): a Tip Rate change has a start date (適用開始日, the Hawaii day
// it counts from, that day included). The tip split uses, for each work day, the rate in force on that day; the change goes on until the
// next change; the newer decision replaces an older one from its start date; the dates allowed are from the first day of the current pay
// period; before saving, the person sees the change and an estimate of what it changes; the history shows before → after, the start date,
// who and when. Days before TIP_RATE_WEIGHT_START keep the employee master coefficient (Q1 A); their label shows the coefficient as %.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
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
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);
const START = (/var TIP_RATE_WEIGHT_START = '(\d{4}-\d{2}-\d{2})';/.exec(SRC) || [])[1];
const AHEAD = (/var TIP_DEC_DAY_AHEAD = (\d+)/.exec(SRC) || [])[1], CLOCK = (/TIP_DEC_CLOCK_DAYS = (\d+);/.exec(SRC) || [])[1];
const HST = (y, m, d, h = 9, mi = 0) => Date.UTC(y, m - 1, d, h + 10, mi);   // a Hawaii time as an instant

const FNS = ['calcTipDistribution', 'tipWeightByRate', '_tipDecDay', '_tipDecDayRaw', '_tipFromOk', '_tipDecDayExact', '_tipDayOk', 'tipRateOn', '_tipLatestApproved',
  '_tipDecT', 'firstWorkDate', 'isThreeMonths', 'effectiveTipRate', 'isTipEligibleRole', 'tipBaseRole', 'isTipExcludedTitle', 'getTipLeaderSplit',
  'tipPeriodRates', 'tipPeriodRateLabel', 'tipRateLabel', 'tipPeriodRateFrom', '_tipUsedRate', 'tipPeriodMatrix', 'isoOf', '_tipHstDay',
  'tipFromRange', 'tipFromCheck', 'tipPeriodStartOf', 'tipFromGuard', 'tipFromSet', '_tipNotFuture', '_tipLiveRateSig', 'tipDayLabel', 'tipChangePreview', 'tipPreviewText', 'tipReplacedBy', 'renderTipRate',
  'approveTip', 'applyTipRaise', 'tipRaisePreview', 'openTipRaiseModal', 'tipStampLegacy', 'tipDecStamp', 'tipDecDayStamp', 'tipDecClockAhead', 'tipDecClockMsg',
  '_tipDecided', '_tipReqT', '_tipDecSeen', 'todayJP', 'fmtJP'];

function app(now) {
  const c = { console, STORE: {}, EMPS: [], LABOR: {}, TIPS: {}, TOASTS: [], RENDERS: [], CONFIRMS: [], NOTIFS: [], answer: true, EL: {} };
  vm.createContext(c);
  vm.runInContext(FNS.map(fnSrc).join('\n') + `
    Date.now = function(){ return ${now}; };
    var TIP_RATE_WEIGHT_START = ${JSON.stringify(START || '2026-10-16')};
    var TIP_SL_SPLIT_END = '2026-08-01';
    var TIP_DEC_DAY_AHEAD = ${AHEAD || 31}, TIP_DEC_CLOCK_DAYS = ${CLOCK || 400};
    var TIP_EXCLUDED_TITLES = ['Store Manager','Area Manager','General Manager','CEO','Office Crew','Accountant'];
    var TIP_OPTIONS = [80, 90, 100];
    var _tipFromSel = {};
    var ROLE_ALIAS = { g2: 'sl', g4: 'am' };
    var STORES = [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }];
    var ROLE_CONFIG = { gm: { name: 'Moto', canApprove: true }, crew: { name: 'Crew' } }, curRole = 'gm', curLang = 'ja', curStore = 'ALL', curUserName = 'Moto', curPage = 'tiprate';
    function t(ja){ return ja; }
    function getEmployees(){ return EMPS; }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function getTipLabor(s, d){ return LABOR[s + '|' + d] || null; }
    function tipForDay(s, d){ var x = TIPS[s + '|' + d] || { l: 0, d: 0 }; return { lunchTotal: x.l, dinnerTotal: x.d, total: x.l + x.d }; }
    function isTipExcluded(){ return false; }
    function isOrderOnlyAccount(){ return false; }
    function workedShiftCount(){ return 99; }
    function noTipShifts(){ return 3; }
    function showToast(m, k){ TOASTS.push([m, k]); } function renderPage(p){ RENDERS.push(p); }
    function confirm(m){ CONFIRMS.push(m); return answer; }
    function escapeHtml(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function getTipPolicy(){ return 'policy'; } function tipRateColor(){ return '#000'; } function langDateLocale(){ return 'ja'; }
    function myName(){ return curUserName; } function checkLevelUpEligibility(){ return null; } function skillScoreStore(){ return { total: 0, lv3: 0 }; }
    function addNotif(n){ NOTIFS.push(n); } function closeModalDirect(){} var MODAL = ''; function openModal(h){ MODAL = h; }
    function alert(){}
    var document = { getElementById: function(id){ return Object.prototype.hasOwnProperty.call(EL, id) ? EL[id] : null; } };`, c);
  return c;
}
const EMP = o => Object.assign({ store: 'F01', role: 'crew', status: '在籍', title: 'Crew', coef: 1 }, o);
function days(from, to) { const out = []; const d = new Date(from + 'T00:00:00Z'); const e = new Date(to + 'T00:00:00Z');
  for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; }
const work = (c, list, who = ['X', 'Y'], tip = 180) => { for (const d of list) { c.LABOR['F01|' + d] = Object.fromEntries(who.map(n => [n, { lunch: 5, dinner: 0 }])); c.TIPS['F01|' + d] = { l: tip, d: 0 }; } };
const totals = (c, d, reqs) => Object.fromEntries(plain(run(c, `calcTipDistribution('F01', '${d}'${reqs ? ', ' + JSON.stringify(reqs) : ''})`)).list.map(r => [r.name, +r.total.toFixed(2)]));

test('a change counts from its start date (that day included), goes on into the next month, and the days before keep the old rate', () => {
  const c = app(HST(2026, 10, 19));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 'r1', name: 'X', rate: 100, status: '承認', fromDay: '2026-10-20', decAt: HST(2026, 10, 19), decDay: '2026-10-19', decHst: '2026-10-19' }];
  assert.equal(run(c, "tipRateOn('X', '2026-10-19')"), 80, 'the day before');
  assert.equal(run(c, "tipRateOn('X', '2026-10-20')"), 100, 'the start date');
  assert.equal(run(c, "tipRateOn('X', '2026-11-05')"), 100, 'the next month: not back to the old rate');
  // the split of a period with the change in the middle: day by day (not the new rate for the whole period)
  work(c, days('2026-10-16', '2026-10-31'));
  assert.deepEqual(totals(c, '2026-10-19'), { X: 90, Y: 90 });
  assert.deepEqual(totals(c, '2026-10-20'), { X: 100, Y: 80 });
});

test('the rate now leaves out a start date that has not come yet; the decision day is still used by the clock checks (a future start date is not a clock error)', () => {
  const c = app(HST(2026, 10, 19));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 'r1', name: 'X', rate: 100, status: '承認', fromDay: '2026-10-25', decAt: HST(2026, 10, 19), decDay: '2026-10-19', decHst: '2026-10-19' }];
  assert.equal(run(c, "effectiveTipRate('X')"), 80, 'not yet');
  assert.equal(run(c, "tipDecClockAhead(ls('tip_requests', []), null, 'X')"), null, 'no "this device’s clock is behind" question');
  const later = app(HST(2026, 10, 25)); later.EMPS = c.EMPS; later.STORE = c.STORE;
  assert.equal(run(later, "effectiveTipRate('X')"), 100, 'from that day');
});

test('the newer decision replaces an older one from its start date (same start date, or an earlier one); the history marks the older one as replaced', () => {
  const c = app(HST(2026, 10, 19, 15));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [
    { id: 'a', name: 'X', rate: 90, status: '承認', fromDay: '2026-10-20', decAt: HST(2026, 10, 19, 11), decDay: '2026-10-19', decHst: '2026-10-19', approver: 'Yuki', basis: 'manual', prevRate: 80 },
    { id: 'b', name: 'X', rate: 100, status: '承認', fromDay: '2026-10-20', decAt: HST(2026, 10, 19, 15), decDay: '2026-10-19', decHst: '2026-10-19', approver: 'Moto', basis: 'manual', prevRate: 80 },
    { id: 'c', name: 'X', rate: 90, status: '承認', fromDay: '2026-10-28', decAt: HST(2026, 10, 19, 12), decDay: '2026-10-19', decHst: '2026-10-19', approver: 'Yuki', basis: 'manual', prevRate: 90 },
  ];
  assert.equal(run(c, "tipRateOn('X', '2026-10-20')"), 100, 'same start date: the later decision');
  assert.equal(run(c, "tipRateOn('X', '2026-10-29')"), 100, 'a later decision from an earlier date also covers the earlier-decided future change');
  const L = run(c, "ls('tip_requests', [])");
  assert.equal(run(c, 'tipReplacedBy')(L[0], L).id, 'b');
  assert.equal(run(c, 'tipReplacedBy')(L[2], L).id, 'b');
  assert.equal(run(c, 'tipReplacedBy')(L[1], L), null);
  const html = run(c, 'renderTipRate()');
  assert.match(html, /X · 80% → 100%<\/div>/);
  assert.match(html, /10\/20（火）から · 10\/19 15:00（ハワイ）/, 'start date, and the time it was changed in Hawaii time');
  assert.equal((html.match(/置き換え/g) || []).length >= 2, true);
});

test('before saving: the person, before → after from the start date, and an estimate per pay period (only days with hours); coefficient days and future days do not change', () => {
  const c = app(HST(2026, 10, 19));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [];
  work(c, days('2026-10-16', '2026-10-18'));
  const pv = plain(run(c, "tipChangePreview('X', 100, '2026-10-16')"));
  assert.equal(pv.before, 80); assert.equal(pv.after, 100);
  assert.equal(pv.periods.length, 1);
  assert.equal(pv.periods[0].first, '2026-10-16'); assert.equal(pv.periods[0].last, '2026-10-18');
  near(pv.periods[0].delta, 3 * (100 - 90), 'X goes from $90 to $100 on each of 3 days');
  const txt = run(c, "tipPreviewText('X', 100, '2026-10-16', tipChangePreview('X', 100, '2026-10-16'))");
  assert.match(txt, /10\/16（金）の勤務から 80% → 100%/);
  assert.match(txt, /2026\/10 後期：この人 \+\$30\.00（試算・勤怠の入っている 10\/16〜10\/18 の分/);
  // nothing was saved by the estimate
  assert.deepEqual(c.STORE.tip_requests, []);
  // a start date before TIP_RATE_WEIGHT_START: those days keep the coefficient
  const c2 = app(HST(2026, 10, 10)); c2.EMPS = c.EMPS; c2.STORE.tip_requests = []; c2.LABOR = c.LABOR; c2.TIPS = c.TIPS;
  assert.equal(plain(run(c2, "tipChangePreview('X', 100, '2026-10-05')")).coefDays, true);
  assert.match(run(c2, "tipPreviewText('X', 100, '2026-10-05', tipChangePreview('X', 100, '2026-10-05'))"), /10\/16 より前は評価係数の期間なので/);
  // a future start date
  assert.match(run(c, "tipPreviewText('X', 100, '2026-10-25', tipChangePreview('X', 100, '2026-10-25'))"), /まだその日が来ていないので/);
});

test('dates allowed: from the first day of the current pay period (Hawaii date, also when the device is ahead in UTC/Japan) up to a year ahead', () => {
  const c = app(Date.UTC(2026, 9, 16, 8));   // 10/16 08:00 UTC = 10/15 22:00 in Hawaii = 10/16 17:00 in Japan
  assert.deepEqual(plain(run(c, 'tipFromRange()')).min, '2026-10-01');
  assert.equal(run(c, 'tipFromRange()').today, '2026-10-15');
  const d = app(HST(2026, 10, 16, 0, 5));
  assert.equal(run(d, 'tipFromRange()').min, '2026-10-16');
  assert.match(run(d, "tipFromCheck('2026-10-15')"), /10\/16（いまの期間の初日）から選べます/);
  assert.equal(run(d, "tipFromCheck('2026-10-16')"), '');
  assert.equal(run(d, "tipFromCheck('2026-11-30')"), '');
  assert.match(run(d, "tipFromCheck('2027-12-01')"), /先すぎます/);
  assert.match(run(d, "tipFromCheck('2026-10-99')"), /選んでください/);
  const e = app(HST(2026, 10, 31, 23)); assert.equal(run(e, 'tipFromRange()').min, '2026-10-16');
  const f = app(HST(2026, 11, 1, 0, 1)); assert.equal(run(f, 'tipFromRange()').min, '2026-11-01');
});

test('approving: the start date from the row (today by default), the change and the estimate are shown first; cancel or a date before the period saves nothing', async () => {
  const c = app(HST(2026, 10, 19, 10));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 'p', name: 'X', rate: 90, status: '申請中', date: '2026/10/18', store: 'F01' }];
  // the pending row shows the start date field, today by default, and the request day button
  const html = run(c, 'renderTipRate()');
  assert.match(html, /id="tipfrom-p" value="2026-10-19" min="2026-10-16"/);
  assert.match(html, /申請した日（10\/18）/);
  c.EL['tipfrom-p'] = { value: '2026-10-15' };
  await run(c, "approveTip('p', '承認')");
  assert.equal(plain(c.STORE.tip_requests)[0].status, '申請中', 'before the period: not approved');
  assert.ok(c.TOASTS.some(([m]) => /いまの期間の初日/.test(m)));
  c.EL['tipfrom-p'] = { value: '2026-10-18' }; c.answer = false;
  await run(c, "approveTip('p', '承認')");
  assert.equal(plain(c.STORE.tip_requests)[0].status, '申請中', 'cancelled');
  assert.match(c.CONFIRMS[c.CONFIRMS.length - 1], /10\/18（日）の勤務から 80% → 90%/);
  c.answer = true;
  await run(c, "approveTip('p', '承認')");
  const r = plain(c.STORE.tip_requests)[0];
  assert.equal(r.status, '承認'); assert.equal(r.fromDay, '2026-10-18'); assert.equal(r.prevRate, 80); assert.equal(r.decDay, '2026-10-19', 'the decision day is still kept');
  assert.equal(run(c, "tipRateOn('X', '2026-10-17')"), 80); assert.equal(run(c, "tipRateOn('X', '2026-10-18')"), 90);
  const h = plain(c.STORE.tip_history)[0]; assert.equal(h.fromDay, '2026-10-18'); assert.equal(h.prevRate, 80); assert.ok(h.at > 0);
});

test('raising: the dialog has the start date and shows the change before saving; the record keeps the start date and the rate before', async () => {
  const c = app(HST(2026, 10, 19, 10));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [];
  work(c, days('2026-10-16', '2026-10-18'));
  run(c, 'openTipRaiseModal()');
  assert.match(run(c, 'MODAL'), /id="tipraise-from" value="2026-10-19" min="2026-10-16"/);
  c.EL['tipraise-name'] = { value: 'X' }; c.EL['tipraise-rate'] = { value: '100' }; c.EL['tipraise-from'] = { value: '2026-10-16' }; c.EL['tipraise-preview'] = { textContent: '' };
  run(c, 'tipRaisePreview()');
  assert.match(c.EL['tipraise-preview'].textContent, /保存する前に確かめてください[\s\S]*10\/16（金）の勤務から 80% → 100%[\s\S]*\+\$30\.00/);
  await run(c, 'applyTipRaise()');
  const r = plain(c.STORE.tip_requests)[0];
  assert.equal(r.fromDay, '2026-10-16'); assert.equal(r.prevRate, 80); assert.equal(r.status, '承認');
  assert.deepEqual(totals(c, '2026-10-16'), { X: 100, Y: 80 }, 'the second half pays the new rate from 10/16 (the reported problem)');
  // a date before the period is refused
  c.EL['tipraise-from'] = { value: '2026-10-10' };
  await run(c, 'applyTipRaise()');
  assert.equal(plain(c.STORE.tip_requests).length, 1);
  // a date too far ahead, or not a date, is refused too
  for (const bad of ['2027-12-01', '2026-10-99']) { c.EL['tipraise-from'] = { value: bad }; await run(c, 'applyTipRaise()'); }
  assert.equal(plain(c.STORE.tip_requests).length, 1);
  assert.ok(c.TOASTS.some(([m]) => /先すぎます/.test(m)) && c.TOASTS.some(([m]) => /選んでください/.test(m)));
});

test('Q1 A and Q5: days before the switch keep the employee master coefficient; the period label shows the coefficient as % and, when the rate changes in a period, the day it changed', () => {
  const c = app(HST(2026, 10, 25));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01', coef: 0.8 }), EMP({ name: 'Y', firstWork: '2026-09-01', coef: 1 })];
  c.STORE.tip_requests = [{ id: 'r', name: 'X', rate: 100, status: '承認', fromDay: '2026-10-16', decAt: HST(2026, 10, 19), decDay: '2026-10-19', decHst: '2026-10-19' }];
  work(c, days('2026-10-01', '2026-10-31'));
  const first = plain(run(c, "tipPeriodMatrix('F01', { dates: " + JSON.stringify(days('2026-10-01', '2026-10-15')) + ' })'));
  assert.deepEqual(first.rates, { X: [80], Y: [100] }, 'the coefficients 0.8 and 1.0, as %');
  assert.deepEqual(totals(c, '2026-10-10'), { Y: 100, X: 80 }, 'the first half is unchanged (coefficients), whatever the start date of the change');
  const second = plain(run(c, "tipPeriodMatrix('F01', { dates: " + JSON.stringify(days('2026-10-16', '2026-10-31')) + ' })'));
  assert.deepEqual(second.rates.X, [100]);
  c.STORE.tip_requests[0].fromDay = '2026-10-20';
  const mid = plain(run(c, "tipPeriodMatrix('F01', { dates: " + JSON.stringify(days('2026-10-16', '2026-10-31')) + ' })'));
  assert.deepEqual(mid.rates.X, [80, 100]); assert.equal(mid.rateFrom.X, '2026-10-20'); assert.equal(mid.rateFrom.Y, undefined);
});

test('records from before v1095 (no start date) keep their day: the decision day, else the device date, else every day', () => {
  const c = app(HST(2026, 10, 25));
  c.EMPS = [EMP({ name: 'A', firstWork: '2026-09-01' }), EMP({ name: 'B', firstWork: '2026-09-01' }), EMP({ name: 'C', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [
    { id: 'a', name: 'A', rate: 90, status: '承認', approvedDate: '2026/10/18', decAt: HST(2026, 10, 18), decDay: '2026-10-18' },
    { id: 'b', name: 'B', rate: 90, status: '承認', approvedDate: '2026/10/20', decAt: HST(2026, 10, 20) },
    { id: 'c', name: 'C', rate: 100, status: '承認' },
  ];
  assert.equal(run(c, "tipRateOn('A', '2026-10-17')"), 80); assert.equal(run(c, "tipRateOn('A', '2026-10-18')"), 90);
  assert.equal(run(c, "tipRateOn('B', '2026-10-19')"), 80); assert.equal(run(c, "tipRateOn('B', '2026-10-20')"), 90);
  assert.equal(run(c, "tipRateOn('C', '2026-10-01')"), 100);
});

test('guards: a broken start date falls back to the decision day; a future start date does not move the next decision day; the estimate uses the rules and starts at the switch; the history lists the newest decision first', () => {
  const c = app(HST(2026, 10, 19, 16));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' }), EMP({ name: 'W', store: 'F03', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 'bad', name: 'Y', rate: 100, status: '承認', fromDay: '2026-13-40', decAt: HST(2026, 10, 19), decDay: '2026-10-19', decHst: '2026-10-19' }];
  assert.equal(run(c, "tipRateOn('Y', '2026-10-18')"), 80); assert.equal(run(c, "tipRateOn('Y', '2026-10-19')"), 100, 'not the broken date');
  // X has a change from a future day; the next decision for X is still made today
  c.STORE.tip_requests.push({ id: 'fut', name: 'X', rate: 90, status: '承認', fromDay: '2026-10-25', decAt: HST(2026, 10, 19, 9), decDay: '2026-10-19', decHst: '2026-10-19' });
  assert.equal(run(c, "tipDecDayStamp(ls('tip_requests', []), 'X')"), '2026-10-19');
  // the estimate shows the rate the rules give (Waikiki is always 100%)
  assert.equal(plain(run(c, "tipChangePreview('W', 90, '2026-10-19')")).after, 100);
  assert.match(run(c, "tipPreviewText('W', 90, '2026-10-19', tipChangePreview('W', 90, '2026-10-19'))"), /決まりで 100% です/);
  // a start date in the coefficient period: the estimate counts from the switch only
  work(c, days('2026-10-01', '2026-10-18'));
  const pv = plain(run(c, "tipChangePreview('X', 100, '2026-10-05')"));
  assert.deepEqual(pv.periods.map(p => p.key), ['2026-10-2']); assert.equal(pv.periods[0].first, '2026-10-16');
  // history: newest decision first, whatever the order in the list
  c.STORE.tip_requests = [
    { id: 'h1', name: 'X', rate: 90, prevRate: 80, status: '承認', fromDay: '2026-10-16', decAt: HST(2026, 10, 16, 9), decDay: '2026-10-16', decHst: '2026-10-16', basis: 'manual' },
    { id: 'h3', name: 'Y', rate: 100, prevRate: 90, status: '承認', fromDay: '2026-10-19', decAt: HST(2026, 10, 19, 9), decDay: '2026-10-19', decHst: '2026-10-19', basis: 'manual' },
    { id: 'h2', name: 'X', rate: 100, prevRate: 90, status: '承認', fromDay: '2026-10-18', decAt: HST(2026, 10, 18, 9), decDay: '2026-10-18', decHst: '2026-10-18', basis: 'manual' },
  ];
  const html = run(c, 'renderTipRate()');
  const at = s => html.indexOf(s);
  assert.ok(at('Y · 90% → 100%') >= 0 && at('Y · 90% → 100%') < at('X · 90% → 100%') && at('X · 90% → 100%') < at('X · 80% → 90%'));
});

test('review f1d567a P2-1: a device whose clock is behind cannot put a change into an earlier period (other decisions show the real period); the clock question names the start date', async () => {
  // real date 11/20 (Hawaii); this device thinks it is 11/10; another person's decision was made on 11/20 by a correct device
  const c = app(HST(2026, 11, 10, 9));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-10-01' }), EMP({ name: 'Y', firstWork: '2026-10-01' })];
  c.STORE.tip_requests = [
    { id: 'o', name: 'Y', rate: 90, status: '承認', decAt: HST(2026, 11, 20, 8), decDay: '2026-11-20', decHst: '2026-11-20', approvedDate: '2026/11/20' },
    { id: 'p', name: 'X', rate: 100, status: '申請中', date: '2026/11/09' }];
  c.EL['tipfrom-p'] = { value: run(c, 'tipFromRange().today') };
  assert.equal(c.EL['tipfrom-p'].value, '2026-11-10');
  await run(c, "approveTip('p', '承認')");
  assert.equal(plain(c.STORE.tip_requests).find(x => x.id === 'p').status, '申請中', 'not saved into 11/1–15');
  assert.ok(c.TOASTS.some(([m]) => /2026\/11\/16 から選べます/.test(m)));
  // choosing a day in the real period: the clock question is asked and names that day
  c.EL['tipfrom-p'] = { value: '2026-11-16' }; c.CONFIRMS.length = 0;
  await run(c, "approveTip('p', '承認')");
  assert.ok(c.CONFIRMS.some(m => /2026\/11\/16 から効きます/.test(m)), c.CONFIRMS.join('\n'));
  const r = plain(c.STORE.tip_requests).find(x => x.id === 'p');
  assert.equal(r.status, '承認'); assert.equal(r.fromDay, '2026-11-16');
  // the raise has the same guard
  const d = app(HST(2026, 11, 10, 9)); d.EMPS = c.EMPS;
  d.STORE.tip_requests = [{ id: 'o', name: 'Y', rate: 90, status: '承認', decAt: HST(2026, 11, 20, 8), decDay: '2026-11-20', decHst: '2026-11-20', approvedDate: '2026/11/20' }];
  d.EL['tipraise-name'] = { value: 'X' }; d.EL['tipraise-rate'] = { value: '100' }; d.EL['tipraise-from'] = { value: '2026-11-10' };
  await run(d, 'applyTipRaise()');
  assert.equal(plain(d.STORE.tip_requests).length, 1, 'not raised into 11/1–15');
  assert.ok(d.TOASTS.some(([m]) => /2026\/11\/16 から選べます/.test(m)));
  // with no other decision ahead, nothing changes (today's period)
  assert.equal(run(d, "tipFromGuard('2026-11-10', '2026-11-10')"), '');
});

test('review f1d567a P2-2: the start date chosen on a pending row is kept when the page is drawn again, and is the one saved', async () => {
  const c = app(HST(2026, 10, 19, 10));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' }), EMP({ name: 'Y', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [{ id: 'p', name: 'X', rate: 90, status: '申請中', date: '2026/10/18', store: 'F01' }, { id: 'q', name: 'Y', rate: 90, status: '申請中', date: '2026/10/18', store: 'F01' }];
  assert.match(run(c, 'renderTipRate()'), /id="tipfrom-p" value="2026-10-19"/);
  run(c, "tipFromSet('p', '2026-10-16')");   // the person picks 10/16 for X
  await run(c, "approveTip('q', '承認')");   // approving Y draws the page again
  const html = run(c, 'renderTipRate()');
  assert.match(html, /id="tipfrom-p" value="2026-10-16"/, 'still 10/16 after the page is drawn again');
  assert.match(html, /onchange="tipFromSet\('p',this.value\)"/);
  await run(c, "approveTip('p', '承認')");   // no input element in this test: the chosen value is used
  assert.equal(plain(c.STORE.tip_requests).find(x => x.id === 'p').fromDay, '2026-10-16');
  assert.equal(run(c, "_tipFromSel['p']"), undefined, 'forgotten after the decision');
  // the buttons set the value too
  run(c, "tipFromSet('z', '2026-10-18', true)"); assert.equal(run(c, "_tipFromSel['z']"), '2026-10-18');
});

test('review f1d567a P3-5: screens that show the current rate leave out a change whose start date has not come', () => {
  const c = app(HST(2026, 10, 19, 10));
  c.EMPS = [EMP({ name: 'X', firstWork: '2026-09-01' })];
  c.STORE.tip_requests = [
    { id: 'a', name: 'X', rate: 90, status: '承認', fromDay: '2026-10-16', decAt: HST(2026, 10, 16), decDay: '2026-10-16' },
    { id: 'b', name: 'X', rate: 100, status: '承認', fromDay: '2026-10-25', decAt: HST(2026, 10, 19), decDay: '2026-10-19' }];
  assert.equal(run(c, "_tipLatestApproved('X', null, _tipNotFuture).id"), 'a');
  assert.equal(run(c, "_tipLiveRateSig('X')"), 'a|90');
  assert.match(SRC, /_tipLatestApproved\(e\.name, null, \(typeof _tipNotFuture==='function'\)\?_tipNotFuture:null\)/);
  assert.match(SRC, /_tipLatestApproved\(empName, null, \(typeof _tipNotFuture==='function'\)\?_tipNotFuture:null\)/);
});
