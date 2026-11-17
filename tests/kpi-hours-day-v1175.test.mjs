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

test('A: the per-store list decides; names alone do not exclude real staff; old copies without an ID: the list name, else the earlier name rules (v1176)', () => {
  const kpi = { byStore: { F01: { sysAcct: { 'g-sys': { name: 'Toast Generic Login', on: true }, 'g-off': { name: 'Kiosk', on: false } } } } };
  const labor = { 'F01_2026-11-03': {
    'Toast Generic Login': E(4, 'g-sys'),
    'Server': E(7, 'g-real-server'),                 // 職種の名前でも人なら外さない
    'Kiosk': E(2, 'g-off'),                          // 外すのをやめた ID は数える
    'Toast Generic Login 2': E(1, ''),               // ID の無い前の写し：一覧の名前とは違う → 前の名前の決まり（v1176・Claude #174 の P3-1）で外す（一覧を作る前と同じ）
    'toast generic login': E(1.5, ''),               // ID の無い前の写し：一覧の名前とちょうど同じ → 外す
    'Ann': E(1, ''),                                 // ID の無い前の写し：人の名前 → 数える
  } };
  const w = world({ stores: [{ id: 'F01' }], labor, kpi });
  const d = w.k2HoursDays('F01', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 7 + 2 + 1); assert.equal(d.excluded, 4 + 1 + 1.5);
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
    _lsPushP: {}, showToast: (m, k) => toasts.push(k), renderPage: () => { rendered++; },
    t: (j) => j, window: { _kpiStore: 'F02', _kpiTab: 'manual' }, curPage: 'kpi_master', Promise, Array, Date };
  ctx.setKpiConfigStore = (sid, p) => { stored = { sid, p }; ctx._lsPushP.kpi_config = Promise.resolve(pushed); };
  vm.createContext(ctx); vm.runInContext(fnSrc('kpiCfgPush'), ctx); vm.runInContext(fnSrc('kpiCfgUnsavedMsg'), ctx); vm.runInContext(fnSrc('upsellDraftMap'), ctx); vm.runInContext(fnSrc('upsellDraftFor'), ctx); vm.runInContext(fnSrc('upsellDraftDrop'), ctx); vm.runInContext(fnSrc('upsellKeepDom'), ctx); vm.runInContext(fnSrc('kpiSameView'), ctx); vm.runInContext(save, ctx);
  return ctx.saveUpsellGuids('F02').then(() => {
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), { sid: 'F02', p: { upsellGuids: ['g1', 'g2'] } });
    assert.equal(ctx.window._upsellSaveState.ok, true); assert.deepEqual(toasts, ['success']);
    pushed = false; toasts = [];
    return ctx.saveUpsellGuids('F02');
  }).then(() => { assert.equal(ctx.window._upsellSaveState.ok, false); assert.deepEqual(toasts, ['warning']); assert.equal(rendered, 2); });
});

/* ---- Codex #173 の指摘の直し（v1175） ---- */
const IMPORT_FNS = ['syncTipLaborFromDB', 'tipLaborPut', 'tipLaborWithGuid', 'toastAliasIndex', 'toastAliasResolve', 'toastAliasFind', 'empToastAliases', '_toastAliasRec', 'toastAliasField', 'toastNameKey', '_toastShiftsOverlap', 'normalizeBusinessDate', '_tipLaborNewer', '_tipLaborMark'];
function importWorld(rows, kpi, opts = {}) {
  const w = world({ kpi, stores: [{ id: 'F06' }] });
  const LS = {};
  w.ls = (k, d) => (Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : (k === 'kpi_config' ? kpi : d));
  w._lsRaw = w.ls; w.lsKeys = pre => Object.keys(LS).filter(k => k.startsWith(pre));
  w.getAttOverride = (sid, dt) => (opts.ovr && opts.ovr[dt]) || null;
  w.setTipLabor = (sid, d, data) => { LS['tip_labor_' + sid + '_' + d] = JSON.parse(JSON.stringify(data)); };
  w.setCreditTipAdjLocal = () => {};
  w.fetchTipLaborFromDB = async () => rows;
  w.getEmployees = () => [{ id: 'e1', name: 'Real Person', status: '在籍' }];
  w.tipHoursFromShifts = () => ({ lunch: 0, dinner: 0 });
  vm.runInContext('var _tipLaborSeq = 0, _tipLaborSaved = {};', w);
  IMPORT_FNS.forEach(n => vm.runInContext(fnSrc(n), w));
  return { w, LS };
}
const OO_ROWS = () => [{ business_date: '2026-11-03', data: [
  { name: 'Real Person', guid: 'g-real', lunchHours: 0, dinnerHours: 6, shifts: [] },
  { name: 'Order Only', guid: 'g-oo', lunchHours: 0, dinnerHours: 8, shifts: [] },
] }];

test('Codex #173: an Order Only account the list marks "stop excluding" (on:false) counts as work; payroll/Tip still drop it', async () => {
  const kpi = { byStore: { F06: { sysAcct: { 'g-oo': { name: 'Order Only', on: false } } } } };
  const { w, LS } = importWorld(OO_ROWS(), kpi);
  const r0 = await w.syncTipLaborFromDB('F06', 'guid-F06', [{ date: '2026-11-03' }]);
  assert.equal(r0.updated, 1);
  const copy = LS['tip_labor_F06_2026-11-03'];
  assert.ok(copy['Order Only'], 'the import keeps the Order Only record under its Toast name');
  assert.equal(copy['Order Only'].toastGuid, 'g-oo');
  assert.equal(copy['Real Person'].rawDinner, 6, 'Order Only is not joined to a person');
  // 給与・Tip が使う getTipLabor は今までどおり Order Only を外す
  assert.deepEqual(Object.keys(w.getTipLabor('F06', '2026-11-03')), ['Real Person']);
  // KPI：外すのをやめた → 実働 6 + 8
  let d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 14); assert.equal(d.excluded, 0);
  // 一覧で外す（on:true）→ 外す
  kpi.byStore.F06.sysAcct['g-oo'].on = true;
  d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 6); assert.equal(d.excluded, 8);
  // 一覧はあるがこの ID が無い → 一覧だけで決めるので実働
  kpi.byStore.F06.sysAcct = { 'g-other': { name: 'Kiosk', on: true } };
  d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 14); assert.equal(d.excluded, 0);
  // 一覧の無い店は今までの決まり（外す）
  delete kpi.byStore.F06;
  d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 6); assert.equal(d.excluded, 8);
});

test('Codex #173: a day fixed by hand uses the fixed copy for Order Only too', async () => {
  const kpi = { byStore: { F06: { sysAcct: { 'g-oo': { name: 'Order Only', on: false } } } } };
  const ovr = { '2026-11-03': { data: { 'Real Person': E(5, 'g-real'), 'Order Only': E(3, 'g-oo') } } };
  const { w } = importWorld(OO_ROWS(), kpi, { ovr });
  await w.syncTipLaborFromDB('F06', 'guid-F06', [{ date: '2026-11-03' }]);
  let d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 8, 'the fixed day: 5 + 3 (not the imported 6 + 8)'); assert.equal(d.excluded, 0);
  kpi.byStore.F06.sysAcct['g-oo'].on = true;
  d = w.k2HoursDays('F06', '2026-11', { cutoff: '2026-11-04' }).days.find(x => x.date === '2026-11-03');
  assert.equal(d.hours, 5); assert.equal(d.excluded, 3);
});

test('Codex #173: all-store closed and excluded hours are rounded like the others', () => {
  const labor = {
    'F06_2026-11-02': { X: E(0.1, 'g') }, 'F01_2026-11-02': { Y: E(0.2, 'h') },
    'F06_2026-11-03': { X: E(1, 'g'), 'Order Only': E(0.1, 'oo1') }, 'F01_2026-11-03': { Y: E(1, 'h'), 'Order Only': E(0.2, 'oo2') },
  };
  const w = world({ stores: [{ id: 'F06', bizDays: { 1: 'closed' } }, { id: 'F01', bizDays: { 1: 'closed' } }], labor });
  const o = w.k2HoursDaysAll(['F06', 'F01'], '2026-11', { cutoff: '2026-11-04' });
  assert.equal(o.closedHours, 0.3); assert.equal(o.excludedHours, 0.3);
});

test('Codex #173: saves wait for their own push (a stale earlier success does not say "saved"); re-render only on the same screen', async () => {
  const ctxBase = () => {
    const c = { Promise, Array, Date, Object, t: (j) => j, window: { _kpiStore: 'F02', _kpiTab: 'manual' }, curPage: 'kpi_master', toasts: [], rendered: 0 };
    c.showToast = (m, k) => c.toasts.push(k); c.renderPage = () => { c.rendered++; };
    c._lsPushP = { kpi_config: Promise.resolve(true) };   // 前の保存の成功が残っている
    c.canSetKpiStore = () => true;
    c.document = { querySelectorAll: () => [{ value: 'g1' }] };
    vm.createContext(c);
    ['kpiCfgPush', 'kpiCfgUnsavedMsg', 'upsellDraftMap', 'upsellDraftFor', 'upsellDraftDrop', 'upsellKeepDom', 'kpiSameView', 'saveUpsellGuids', 'clearKpiCfgStore'].forEach(n => vm.runInContext(fnSrc(n), c));
    return c;
  };
  // 同期が OFF などでこの保存が送られなかった → 前の成功を使わず「未保存」
  let c = ctxBase();
  c.setKpiConfigStore = () => {};
  assert.equal(await c.saveUpsellGuids('F02'), false);
  assert.equal(c.window._upsellSaveState.ok, false); assert.deepEqual(c.toasts, ['warning']);
  // 送った答えが返る前に別の画面を開いた → 描き直さない（画面を取り上げない）
  c = ctxBase();
  let res; c.setKpiConfigStore = () => { c._lsPushP.kpi_config = new Promise(r => { res = r; }); };
  const p = c.saveUpsellGuids('F02');
  c.curPage = 'dashboard';
  res(true); assert.equal(await p, true);
  assert.equal(c.rendered, 0); assert.equal(c.window._upsellSaveState.ok, true);
  // 同じ画面でもほかの店を開いていたら描き直さない
  c = ctxBase();
  c.setKpiConfigStore = () => { c._lsPushP.kpi_config = new Promise(r => { res = r; }); };
  const p2 = c.saveUpsellGuids('F02');
  c.window._kpiStore = 'F05'; res(true); await p2;
  assert.equal(c.rendered, 0);
  // 続けて 2 回押した：前の保存の古い答えで状態を書き換えない
  c = ctxBase();
  const rs = []; c.setKpiConfigStore = () => { c._lsPushP.kpi_config = new Promise(r => rs.push(r)); };
  const a1 = c.saveUpsellGuids('F02'), a2 = c.saveUpsellGuids('F02');
  rs[1](false); await a2; rs[0](true); await a1;
  assert.equal(c.window._upsellSaveState.ok, false, 'the later save decides');
});

test('Codex #173: 全店共通に戻す says done only after the cloud write; a failed reset retries the reset', async () => {
  const c = { Promise, Array, Date, Object, t: (j) => j, window: { _kpiStore: 'F02', _kpiTab: 'manual' }, curPage: 'kpi_master', toasts: [], rendered: 0 };
  c.showToast = (m, k) => c.toasts.push(k); c.renderPage = () => { c.rendered++; }; c.canSetKpiStore = () => true;
  let cfg = { byStore: { F02: { upsellGuids: ['g1'], drinkCats: ['D'] } } }, pushed = false, sets = 0;
  c.getKpiConfig = () => JSON.parse(JSON.stringify(cfg));
  c.setKpiConfig = (v) => { cfg = v; sets++; c._lsPushP.kpi_config = Promise.resolve(pushed); };
  c._lsPushP = { kpi_config: Promise.resolve(true) };
  vm.createContext(c);
  ['kpiCfgPush', 'kpiCfgUnsavedMsg', 'upsellDraftFor', 'upsellDraftDrop', 'kpiSameView', 'clearKpiCfgStore'].forEach(n => vm.runInContext(fnSrc(n), c));
  assert.equal(await c.clearKpiCfgStore('F02', 'upsellGuids'), false);
  assert.deepEqual(cfg, { byStore: { F02: { drinkCats: ['D'] } } });
  assert.equal(c.window._upsellSaveState.ok, false); assert.equal(c.window._upsellSaveState.kind, 'clear'); assert.deepEqual(c.toasts, ['warning']);
  pushed = true;   // もう一度：もう端末には無いが、送り直す
  assert.equal(await c.clearKpiCfgStore('F02', 'upsellGuids'), true);
  assert.equal(sets, 2); assert.equal(c.window._upsellSaveState.ok, true); assert.equal(c.toasts[1], 'info');
  const card = SRC.slice(SRC.indexOf('function renderKpiManualTab'), SRC.indexOf('function saveAlcoholCats'));
  assert.match(card, /_upSt\.kind==='clear'\?`clearKpiCfgStore\('\$\{sid\}','upsellGuids'\)`/);
});
