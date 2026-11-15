// v1175（11/15 の依頼の A・UI案84）：総労働時間を「1 営業日あたり」に（計算の元 k2HoursDays）と、B の保存の不具合（本部も店ごとに保存）。
// 本物の関数（index.html）を VM で動かす。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

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

const FNS = ['k2NormAcctName','k2SysAcctList','k2SysMatcher','k2DayIssues','k2HoursDays','k2HoursDaysM','k2HoursDaysAll','k2RecGuids','isOrderOnlyAccount','toastSystemAccount','ceIsSystemAccount','_laborHrs','getTipLabor','k2IsSysName','k2SysGuids','k2MonthGuids','k2YmAdd','daysOfYm'];

function world({ today = '2026-11-12', stores = [{ id: 'F06', bizDays: { 1: 'closed' } }], labor = {}, kpi = {}, closures = {} } = {}) {
  const LS = {};
  Object.keys(labor).forEach(k => { LS['tip_labor_' + k] = labor[k]; });
  LS.kpi_config = kpi;
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, RegExp, Date,
    ls: (k, d) => (Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : d),
    _lsRaw: (k, d) => (Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : d),
    lsKeys: pre => Object.keys(LS).filter(k => k.startsWith(pre)),
    getKpiConfig: () => LS.kpi_config || {},
    getStoresAll: () => stores, STORES: stores,
    getAttOverride: () => null, applyTipHoursClip: (s, d, x) => x, applyTipSplit: (s, d, x) => x,
    getStoreClosures: sid => closures[sid] || {},
    curYm: () => today.slice(0, 7), bizToday: () => today,
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('dayClosureMode'), ctx);
  FNS.forEach(n => vm.runInContext(fnSrc(n), ctx));
  return ctx;
}
const E = (h, g, extra) => Object.assign({ rawLunch: 0, rawDinner: h, lunch: 0, dinner: h, toastGuid: g }, extra || {});

test('v1175 version markers (1175 or later, page and SW the same)', () => {
  const a = /const APP_VERSION = '(\d+)'/.exec(SRC)[1], b = /const SW_BUILD = '(\d+)'/.exec(SW)[1];
  assert.ok(+a >= 1175, a); assert.equal(a, b);
});

test('A example 1: 8 business days, 336h → 42.0 h/business day; system accounts do not change it; a late import updates both sides', () => {
  // 11 月。月曜（11/2・11/9）は定休。11/11 は勤怠をまだ取り込んでいない。今日は 11/12（入れない）
  const hrs = { '2026-11-01': 41, '2026-11-03': 44.5, '2026-11-04': 40, '2026-11-05': 43.5, '2026-11-06': 42, '2026-11-07': 41.5, '2026-11-08': 40.5, '2026-11-10': 43 };
  const labor = {};
  Object.keys(hrs).forEach(d => { labor['F06_' + d] = { 'A Real': E(hrs[d] - 10, 'g-a'), 'B Real': E(10, 'g-b') }; });
  labor['F06_2026-11-02'] = { 'A Real': E(3, 'g-a') };            // 定休日の仕込み
  labor['F06_2026-11-12'] = { 'A Real': E(5, 'g-a') };            // 今日（入れない）
  const kpi = { byStore: { F06: { sysAcct: { 'g-oo': { name: 'Order Only', on: true }, 'g-sd': { name: 'Server Default', on: true } } } } };
  let w = world({ labor, kpi });
  let r = w.k2HoursDays('F06', '2026-11');
  assert.equal(r.openDays, 8); assert.equal(r.openHours, 336); assert.equal(r.avg, 42);
  assert.equal(r.pendingDays, 1); assert.deepEqual([...r.pendingDates], ['2026-11-11']);
  assert.equal(r.closedHours, 3); assert.equal(r.totalHours, 339);
  assert.equal(r.days.find(d => d.date === '2026-11-12'), undefined, 'today is not counted');
  assert.equal(r.days.find(d => d.date === '2026-11-09').kind, 'closed');
  // 業務用アカウントの打刻を足しても変わらない
  labor['F06_2026-11-03'] = Object.assign({}, labor['F06_2026-11-03'], { 'Order Only': E(3, 'g-oo'), 'Server Default': E(2, 'g-sd') });
  w = world({ labor, kpi });
  r = w.k2HoursDays('F06', '2026-11');
  assert.equal(r.avg, 42); assert.equal(r.openHours, 336); assert.equal(r.excludedHours, 5);
  // 未取込の日（11/11）を取り込むと分子と分母が一緒に変わる
  labor['F06_2026-11-11'] = { 'A Real': E(34, 'g-a'), 'B Real': E(10, 'g-b') };
  w = world({ labor, kpi });
  r = w.k2HoursDays('F06', '2026-11');
  assert.equal(r.openDays, 9); assert.equal(r.openHours, 380); assert.equal(r.pendingDays, 0); assert.equal(r.avg, 42.2);
});

test('A example 2: Server 8h + unregistered real 6h + order only 3h + server default 2h → 14.0 h/business day', () => {
  const labor = { 'F06_2026-11-03': {
    'Kai Server': E(8, 'g-srv', { jobs: ['Server'] }),
    'New Person': E(6, 'g-new'),
    'order only': E(3, 'g-oo'),
    'server default': E(2, 'g-sd'),
  } };
  const kpi = { byStore: { F06: { sysAcct: { 'g-oo': { name: 'order only', on: true }, 'g-sd': { name: 'server default', on: true } } } } };
  const w = world({ labor, kpi });
  const r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' });
  const d3 = r.days.find(d => d.date === '2026-11-03');
  assert.equal(d3.hours, 14); assert.equal(d3.excluded, 5);
  // 11/1 は未取込・11/2 は定休なので対象は 11/3 の 1 日
  assert.equal(r.openDays, 1); assert.equal(r.avg, 14);
  assert.equal(Math.round(1400 / r.totalHours), 100, 'sales per labor hour uses the same total');
});

test('A: the per-store list decides; names alone do not exclude real staff; old copies without an ID match the exact name only', () => {
  const kpi = { byStore: { F01: { sysAcct: { 'g-sys': { name: 'Toast Generic Login', on: true }, 'g-off': { name: 'Kiosk', on: false } } } } };
  const labor = { 'F01_2026-11-03': {
    'Toast Generic Login': E(4, 'g-sys'),
    'Server': E(7, 'g-real-server'),                 // 職種の名前でも人なら外さない
    'Kiosk': E(2, 'g-off'),                          // 外すのをやめた ID は数える
    'Toast Generic Login 2': E(1, ''),               // ID の無い前の写し：名前がちょうど同じでないので数える
    'toast generic login': E(1.5, ''),               // ID の無い前の写し：一覧の名前とちょうど同じ → 外す
  } };
  const w = world({ stores: [{ id: 'F01' }], labor, kpi });
  const d = w.k2HoursDays('F01', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 7 + 2 + 1); assert.equal(d.excluded, 4 + 1.5);
});

test('A: a store without a list keeps the current rules (name rules and IDs that had a system name)', () => {
  const labor = { 'F06_2026-11-03': { 'Server Default': E(2, 'g-sd'), 'Real One': E(9, 'g-r') } };
  const w = world({ labor, kpi: {} });
  const d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 9); assert.equal(d.excluded, 2);
});

test('A: a confirmed zero-hour day counts as one day; zero target days give no average; days before the opening date are not business days', () => {
  let w = world({ labor: { 'F06_2026-11-03': {} } });
  let r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' });
  assert.equal(r.openDays, 1); assert.equal(r.avg, 0);
  w = world({ labor: {} });
  r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' });
  assert.equal(r.openDays, 0); assert.equal(r.avg, null); assert.equal(r.pendingDays, 2);
  w = world({ stores: [{ id: 'F06', bizDays: { 1: 'closed' }, openDate: '2026-11-03' }], labor: { 'F06_2026-11-03': { X: E(5, 'g') } } });
  r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' });
  assert.equal(r.days.length, 1); assert.equal(r.openDays, 1); assert.equal(r.pendingDays, 0);
});

test('A: temporary closures are not business days; future months return nothing; opts.incomplete moves a day to pending', () => {
  const labor = { 'F06_2026-11-03': { X: E(5, 'g') }, 'F06_2026-11-04': { X: E(6, 'g') } };
  let w = world({ labor, closures: { F06: { '2026-11-04': { mode: 'closed' } } } });
  let r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-05' });
  assert.equal(r.openDays, 1); assert.equal(r.closedHours, 6); assert.equal(r.totalHours, 11);
  assert.equal(w.k2HoursDays('F06', '2026-12').future, true);
  w = world({ labor });
  r = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-05', incomplete: (sid, dt) => dt === '2026-11-04' });
  assert.equal(r.openDays, 1); assert.deepEqual([...r.pendingDates.filter(d => d >= '2026-11-03')], ['2026-11-04']);
});

test('A: all stores = total hours ÷ total store-business-days', () => {
  const labor = { 'F06_2026-11-03': { X: E(30, 'g') }, 'F01_2026-11-03': { Y: E(50, 'h') }, 'F01_2026-11-04': { Y: E(40, 'h') } };
  const w = world({ stores: [{ id: 'F06' }, { id: 'F01' }], labor });
  const o = w.k2HoursDaysAll(['F06', 'F01'], '2026-11', { cutoff: '2026-11-05' });
  assert.equal(o.openHours, 120); assert.equal(o.openDays, 3); assert.equal(o.avg, 40);
});

test('B: HQ sees and saves the store setting (not the all-store list); "saved" only after the cloud write', () => {
  const card = SRC.slice(SRC.indexOf('function renderKpiManualTab'), SRC.indexOf('function saveAlcoholCats'));
  assert.match(card, /var upSel = cfgStore\.upsellGuids\|\|\[\];/);
  assert.doesNotMatch(card, /isCfgGlobal \? \(getKpiConfig\(\)\.upsellGuids/);
  const save = fnSrc('saveUpsellGuids');
  assert.doesNotMatch(save, /setKpiConfig\(cfg\)/, 'no longer writes the all-store list');
  let stored = null, toasts = [], pushed = true, rendered = 0;
  const ctx = { document: { querySelectorAll: () => [{ value: 'g1' }, { value: 'g2' }] }, canSetKpiStore: () => true,
    setKpiConfigStore: (sid, p) => { stored = { sid, p }; }, _lsPushP: {}, showToast: (m, k) => toasts.push(k), renderPage: () => { rendered++; },
    t: (j) => j, window: {}, Promise, Array, Date };
  ctx._lsPushP = new Proxy({}, { get: () => Promise.resolve(pushed) });
  vm.createContext(ctx); vm.runInContext(save, ctx);
  return ctx.saveUpsellGuids('F02').then(() => {
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), { sid: 'F02', p: { upsellGuids: ['g1', 'g2'] } });
    assert.equal(ctx.window._upsellSaveState.ok, true); assert.deepEqual(toasts, ['success']);
    pushed = false; toasts = [];
    return ctx.saveUpsellGuids('F02');
  }).then(() => { assert.equal(ctx.window._upsellSaveState.ok, false); assert.deepEqual(toasts, ['warning']); assert.equal(rendered, 2); });
});
