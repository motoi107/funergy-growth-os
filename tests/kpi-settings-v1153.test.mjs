// v1153（UI案70・Moto さん 11/13 の回答 1A〜7A）：KPI設定を「店舗 × 月」に。
//   ① 目標・使う／対象外は kpi_man_<YYYY.M>[店] の欄（tgt_・off_）。その月に無ければ前の月（24 か月まで）から引き継ぐ（6A）
//   ② getStoreKpiTargets・keyKpiStats（会議）はその月の目標を使う。前の月・ほかの店は変わらない
//   ③ 表の実績・目標・判定は会議と同じ関数・しきい値から（keyKpiStats・_meetApplyPl・meetingBudgetKpi・_meetStatus）
//   ④ 総労働時間：人件費と同じ勤怠の時間。仕組みのアカウントは外す（今は名前で）。今月の計画は前日までの営業日の分だけ
//   ⑤ 保存は変えた欄だけ（引き継いだ値と同じなら書かない・空にすると前の月から引き継ぐ・範囲の外は保存しない）
//   ⑥ Google の口コミ（1A）：会議の実績は「その月に投稿された口コミの平均」（手入力 gAvg）
//   ⑦ 重点 KPI のカード：G1〜G3＝現場の KPI だけ・G4＝管理の KPI。対象外は出さない。数字が無ければカードごと出さない
//   ⑧ 味噌汁UP率 → アップグレード率（数え方は今のまま・3A）
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
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const K2 = between('/* ===== FUNERGY_KPI2 start =====', '/* ===== FUNERGY_KPI2 end ===== */');
const MEET_DEF = between('var MEET_KPI_DEF=[', '\n];');
const FMT_DEF = between('const FORMAT_KPI_DEFAULTS = {', '\n};').replace('const ', 'var ');
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);

const MERGE = ['_cjson', '_lrObj', '_lrOwn', '_lrAt', '_fsHas', '_fsT', '_fsObj', '_fsFiOf', '_fsCont', '_fsSubs', '_fsSameEntry', '_fsStamp'];
const REAL = ['kpiManualKey', '_kpiManualRaw', 'getKpiManual', 'setKpiManual', 'getFormatKpi', 'getStoreKpiTargets', 'getStoreKpiOverride',
  'periodForOffset', 'daysOfYm', 'isOrderOnlyAccount', 'toastSystemAccount', 'guestCountType', 'isDrinkRateStore',
  '_meetKpiDef', 'getMeetThreshold', '_meetStatus', '_meetStatColor', '_meetStatLabel', '_meetDiffStr', 'fmtK'];

const STORES = [
  { id: 'F01', name: 'ToriTon', format: 'izakaya', brand: 'ToriTon' },
  { id: 'F04-K', name: 'Totoya Kaimuki', format: 'dining', brand: 'Totoya' },
  { id: 'F06', name: 'LaLa', format: 'dining', brand: 'LaLa' },
  { id: 'F09', name: 'Sample', format: 'dining', brand: 'Sample' }
];

/* 端末 1 台。会議の値（keyKpiStats の結果）と勤怠（laborCoreForYm）は合成の stub。CUR＝今月（ハワイ） */
function device(opts = {}) {
  const c = { console: { log() {}, warn() {}, error() {} }, STORE: new Map(), STORES, CUR: opts.cur || '2026-11', TODAY: opts.today || '2026-11-13',
    NOW: Date.UTC(2026, 10, 13, 20), K: opts.k || {}, LC: opts.lc || {}, CONF: opts.conf || {}, DRINK: opts.drink || {}, CLOSED: opts.closed || {}, TL: opts.tl || {},
    CAN: opts.can !== false, DOM: {}, TOASTS: [], RENDERS: 0, GRADE: opts.grade || 2, ROLE: opts.role || 'gm' };
  vm.createContext(c);
  run(c, [MEET_DEF, FMT_DEF, ...MERGE.map(fnSrc), ...REAL.map(fnSrc)].join('\n') + `
    Date.now = function(){ return NOW; };
    var curLang = 'ja', curStore = 'ALL', curRole = ROLE, DRINK_RATE_STORES = ['F01','F02','F05'];
    function t(ja){ return ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _lsStoreGet(k){ return STORE.has(k) ? STORE.get(k) : null; }
    function _lsRawStr(k){ return _lsStoreGet(k); }
    function ls(k, d){ var s=_lsStoreGet(k); if(s==null) return d; var v=JSON.parse(s); return v==null ? d : v; }
    function lsSet(k, v){ STORE.set(k, JSON.stringify(v)); return true; }
    function v1136Moved(){ return true; }
    function getStoresAll(){ return STORES; }
    function isTotoyaStore(id){ return /^F04/.test(id); }
    function ceIsSystemAccount(n){ return /kiosk/i.test(String(n)); }
    function curYm(){ return CUR; } function bizToday(){ return TODAY; }
    function dayClosureMode(sid, d){ return CLOSED[sid+'|'+d] ? 'closed' : null; }
    function keyKpiStats(stores, days){ var ym=days[0].date.slice(0,7); var k=K[stores[0].id+'|'+ym]; if(!k) throw new Error('no k'); return JSON.parse(JSON.stringify(k)); }
    function _meetApplyPl(k){ return k; }
    function meetingBudgetKpi(k, cur){ var n=Object.assign({}, k); if(cur && k.pace){ n.budget=k.pace.budget; n.guestBudget=k.pace.guestBudget; } return n; }
    function _meetConfirmState(sid, ym){ return CONF[sid+'|'+ym] || 'prov'; }
    function laborCoreForYm(sid, ym){ return LC[sid+'|'+ym] || { byName:{}, laborDays:0, noLaborDays:[] }; }
    function getTipLabor(sid, d){ return TL[sid+'|'+d] || null; }
    function lsKeys(pre){ return Object.keys(TL).map(function(k){ var p=k.split('|'); return 'tip_labor_'+p[0]+'_'+p[1]; }).filter(function(k){ return k.indexOf(pre)===0; }); }
    function _lsRaw(k){ var m=/^tip_labor_(.+)_(\\d{4}-\\d{2}-\\d{2})$/.exec(k); return m ? (TL[m[1]+'|'+m[2]] || null) : null; }
    function storeDrinkSales(sid, per){ return DRINK[sid+'|'+per] || { drink:0, total:0, hasCfg:false }; }
    function canSetKpiStore(){ return CAN; } function kpiSettableStores(){ return STORES; }
    function canAccessKpiMaster(){ return true; } function myGradeNum(){ return GRADE; }
    function showToast(m, k){ TOASTS.push([m, k]); } function renderPage(){ RENDERS++; } function mdCacheClear(){}
    var document = { getElementById: function(id){ return Object.prototype.hasOwnProperty.call(DOM, id) ? DOM[id] : null; } };
    var window = {};
  ` + K2);
  return c;
}
// その月の会議の値（keyKpiStats の結果）の見本
const kBase = (o = {}) => Object.assign({ sales: 128930, budget: 126480, guests: 3872, guestBudget: 3950, ppa: 33.3, ppaBudget: 32.02,
  repeatRate: 37.8, repeatHas: true, first: 2410, repeat: 1464, sr: 274, repeatTgt: null, fcRate: 29.1, fcBudgetRate: 30, laborRate: 33.2, laborBudgetRate: 31.5,
  totoyaScope: false, drinkScope: true, drinkRate: 33.4, drinkTgt: 35 }, o);
const setMan = (c, sid, per, rec) => { const k = 'kpi_man_' + per; const all = c.STORE.has(k) ? JSON.parse(c.STORE.get(k)) : {}; all[sid] = rec; c.STORE.set(k, JSON.stringify(all)); };
const rowOf = (A, key) => A.rows.find(r => r.key === key);
// その店・月の表を本物の renderKpi2Store で描き、ブラウザと同じく 描いたときの値＝defaultValue／defaultChecked の欄を作る
const shownDom = (c, sid, ym) => {
  run(c, `window._kpiStore=${JSON.stringify(sid)}; window._k2Ym=${JSON.stringify(ym)};`);
  const html = run(c, `renderKpi2Store()`), dom = {};
  for (const m of html.matchAll(/<input class="form-input k2-tgt" id="(k2t-[A-Za-z]+)"[^>]*? value="([^"]*)"/g)) dom[m[1]] = { value: m[2], defaultValue: m[2] };
  for (const m of html.matchAll(/<input type="checkbox" id="(k2o-[A-Za-z]+)"([^>]*)>/g)) { const on = /\bchecked\b/.test(m[2]); dom[m[1]] = { checked: on, defaultChecked: on }; }
  return dom;
};

test('① a target set in a month carries over to later months only; earlier months and other stores keep theirs (6A)', () => {
  const c = device();
  c.STORE.set('m_store_kpi', JSON.stringify({ F09: { repeatRate: 30, foodCost: 31 } }));
  setMan(c, 'F09', '2026.10', { tgt_repeatRate: 36, off_drinkRate: true });
  setMan(c, 'F09', '2026.12', { tgt_repeatRate: 38 });
  const tg = ym => plain(run(c, `getStoreKpiTargets('F09', 0, '${ym}')`));
  assert.equal(tg('2026-09').repeatRate, 30, 'before: the store override');
  assert.equal(tg('2026-10').repeatRate, 36, 'the month it was set');
  assert.equal(tg('2026-11').repeatRate, 36, 'carried over');
  assert.equal(tg('2026-12').repeatRate, 38, 'a later month with its own value keeps it');
  assert.equal(tg('2027-03').repeatRate, 38);
  assert.equal(tg('2026-11').foodCost, 31, 'other fields: still the store override');
  assert.equal(tg('2026-11').laborPct, 28, 'and the format default under it (dining)');
  assert.equal(plain(run(c, `getStoreKpiTargets('F01', 0, '2026-11')`)).repeatRate, 40, 'another store is untouched (izakaya default)');
  // 24 months is the limit
  assert.equal(tg('2028-09').repeatRate, 38);
  assert.equal(tg('2028-12').repeatRate, 30, 'more than 24 months later: back to the store override');
  // off_ carries over too, and false is a real answer
  assert.equal(run(c, `k2On('F09','2026-11','drinkRate')`), false);
  setMan(c, 'F09', '2027.1', { tgt_repeatRate: 38, off_drinkRate: false });
  assert.equal(run(c, `k2On('F09','2027-02','drinkRate')`), true);
  assert.equal(run(c, `k2On('F09','2026-11','drinkRate')`), false, 'the earlier months stay off');
  // default use: drink only for the drink stores, upgrade/ikura only for Totoya; sales is always used
  assert.equal(run(c, `k2On('F01','2026-11','drinkRate')`), true);
  assert.equal(run(c, `k2On('F09','2026-09','drinkRate')`), false);
  assert.equal(run(c, `k2On('F04-K','2026-11','misoUpgradeRate')`), true);
  assert.equal(run(c, `k2On('F01','2026-11','ikuraShowerRate')`), false);
  setMan(c, 'F01', '2026.11', { off_sales: true });
  assert.equal(run(c, `k2On('F01','2026-11','sales')`), true);
  // explicit targets for the meeting (fc/labor/repeat): month first, then the store override, never the format default
  assert.deepEqual(plain(run(c, `k2ExplicitTargets('F09','2026-11')`)), { repeatRate: 36, foodCost: 31 });
  assert.deepEqual(plain(run(c, `k2ExplicitTargets('F01','2026-11')`)), {});
  // offset → month
  assert.equal(run(c, `k2YmOfPeriod('2026.3')`), '2026-03');
  assert.equal(run(c, `k2YmAdd('2026-01', -1)`), '2025-12');
  assert.equal(run(c, `k2YmAdd('2026-12', 1)`), '2027-01');
});

test('② the meeting (keyKpiStats) reads the month targets: the source passes the month to every target lookup', () => {
  const ks = fnSrc('keyKpiStats');
  assert.match(ks, /var ov=\(typeof k2ExplicitTargets==='function' && ym\)\?\(k2ExplicitTargets\(s\.id, ym\)\|\|\{\}\):/, 'fc / labor / repeat targets come from the month (then the store override)');
  assert.equal((ks.match(/getStoreKpiTargets\(s\.id, ofst, ym\)/g) || []).length, 2, 'upgrade, ikura and drink targets for the same month');
  assert.doesNotMatch(ks, /getStoreKpiTargets\(s\.id, ofst\)/);
  // the year table: Google uses the month target and the manual month average
  const ym = fnSrc('_meetYearMatrix');
  assert.match(ym, /kk==='google'\)\{ try\{ return _k2Num\(\(getKpiManual\(sid, k2Period\(ym\)\)\|\|\{\}\)\.gAvg\)/);
  assert.match(ym, /kk==='google'\)\{ try\{ return k2ExplicitTarget\(sid, ym, 'reviewScore'\)/);
  assert.match(ym, /\['sales','guests','ppa','google'\]\.indexOf\(k\)>=0/);
  assert.match(fnSrc('renderMeetingReview'), /_meetGoogleCard\(x\.s, ym\)/);
});

test('③ the table shows the meeting values and judges with the meeting thresholds', () => {
  const k = kBase({ pace: { budget: 49030, guestBudget: 1558 }, sales: 50210, guests: 1520, ppa: 33.03 });
  const c = device({ k: { 'F01|2026-11': k, 'F01|2026-10': kBase() }, conf: { 'F01|2026-10': 'final' },
    drink: { 'F01|2026.10': { drink: 31410, total: 94050, hasCfg: true } } });
  setMan(c, 'F01', '2026.10', { tgt_repeatRate: 35, gAvg: 4.8, gCnt: 12, reviewScore: 4.6, tgt_reviewScore: 4.4 });
  const A = plain(run(c, `_k2ActualsRaw('F01','2026-10')`));
  assert.equal(A.rows.length, 11);
  assert.deepEqual(A.rows.map(r => r.key), ['sales', 'guests', 'ppa', 'repeatRate', 'foodCost', 'laborPct', 'laborHours', 'drinkRate', 'misoUpgradeRate', 'ikuraShowerRate', 'reviewScore']);
  const st = (key, act, tgt, lower) => run(c, `_meetStatus(${JSON.stringify(key)}, ${act}, ${tgt}, ${lower})`);
  for (const [key, meet, act, tgt, lower] of [['sales', 'sales', 128930, 126480, false], ['guests', 'guests', 3872, 3950, false], ['ppa', 'ppa', 33.3, 32.02, false],
    ['foodCost', 'fc', 29.1, 30, true], ['laborPct', 'labor', 33.2, 31.5, true], ['drinkRate', 'drink', 33.4, 35, false], ['reviewScore', 'google', 4.8, 4.4, false]]) {
    const r = rowOf(A, key);
    assert.equal(r.act, act, key + ' actual = the meeting value');
    assert.equal(r.tgtJudge, tgt, key + ' target = the meeting value');
    assert.equal(r.j, st(meet, act, tgt, lower), key + ' judged like the meeting');
  }
  // repeat: the meeting target (repeatTgt from keyKpiStats), not the format default
  assert.equal(rowOf(A, 'repeatRate').tgt, null, 'keyKpiStats said no target → none (the format default 40 is not used)');
  assert.equal(rowOf(A, 'repeatRate').actNote, 'FT 2,410・RP 1,190・SR 274', 'FT / RP (= repeat − SR) / SR');
  assert.equal(rowOf(A, 'laborPct').j, 'warn', '105% of the target: within the meeting yellow line');
  assert.equal(rowOf(A, 'laborPct').diff, '+1.7pt');
  assert.equal(rowOf(A, 'reviewScore').diff, '+0.4');
  assert.equal(rowOf(A, 'sales').st, '確定（会計 PL）', 'a confirmed month');
  assert.equal(rowOf(A, 'repeatRate').st, '目標未設定');
  c.K['F01|2026-10'].repeatTgt = 35;
  assert.equal(rowOf(plain(run(c, `_k2ActualsRaw('F01','2026-10')`)), 'repeatRate').tgt, 35, 'the meeting target (month first) is what the row shows');
  assert.equal(rowOf(plain(run(c, `_k2ActualsRaw('F01','2026-10')`)), 'repeatRate').st, '月の合計');
  assert.equal(rowOf(A, 'drinkRate').actNote, '$31,410 ÷ $94,050');
  // Totoya-only rows are off at ToriTon
  assert.equal(rowOf(A, 'misoUpgradeRate').on, false);
  assert.equal(rowOf(A, 'misoUpgradeRate').st, '対象外');
  assert.equal(rowOf(A, 'misoUpgradeRate').label, 'アップグレード率');
  // the current month: sales and guests against the budget to date, with a note
  const B = plain(run(c, `_k2ActualsRaw('F01','2026-11')`));
  assert.equal(rowOf(B, 'sales').tgt, 126480, 'the month target is shown');
  assert.equal(rowOf(B, 'sales').tgtJudge, 49030, 'judged against the budget to date (as the meeting)');
  assert.equal(rowOf(B, 'sales').j, st('sales', 50210, 49030, false));
  assert.match(rowOf(B, 'sales').tgtNote, /前日までの予算 \$49,030/);
  assert.equal(rowOf(B, 'guests').tgtJudge, 1558);
  assert.equal(rowOf(B, 'foodCost').st, '速報（前日まで）');
  // bowls and plates keep their counting and their names (3A)
  const c2 = device({ k: { 'F04-K|2026-10': kBase({ totoyaScope: true, misoRate: 20, misoUp: 8, misoAll: 40, misoTgt: 22, ikuraRate: 10, ikura: 3, ikuraBowls: 30, ikuraTgt: 12 }) } });
  const T = plain(run(c2, `_k2ActualsRaw('F04-K','2026-10')`));
  assert.equal(rowOf(T, 'guests').label, '丼数');
  assert.equal(rowOf(T, 'misoUpgradeRate').act, 20);
  assert.equal(rowOf(T, 'misoUpgradeRate').actNote, '8 ÷ 40');
  assert.equal(rowOf(T, 'ikuraShowerRate').act, 10);
  assert.equal(run(c2, `k2GuestLabel('F03')`), 'プレート数');
  // a future month: targets can be set, nothing is judged
  setMan(c, 'F01', '2027.1', { tgt_reviewScore: 4.5, gAvg: 4.9, gCnt: 3, tgt_laborHours: 400 });
  const F = plain(run(c, `_k2ActualsRaw('F01','2027-01')`));
  assert.ok(F.future);
  assert.ok(F.rows.every(r => r.j === 'none'), 'nothing is judged, even a typed Google average');
  assert.ok(F.rows.filter(r => r.on).every(r => r.st === 'これから'));
  assert.equal(rowOf(F, 'laborHours').tgt, 400, 'the plan for a later month can already be set');
  // a drink store whose drink categories are not set: no rate even with sales (設定待ち)
  const c3 = device({ k: { 'F01|2026-10': kBase() }, drink: { 'F01|2026.10': { drink: 0, total: 94050, hasCfg: false } } });
  const D = rowOf(plain(run(c3, `_k2ActualsRaw('F01','2026-10')`)), 'drinkRate');
  assert.equal(D.act, null);
  assert.equal(D.st, '設定待ち');
});

test('④ labor hours: the labor-cost hours of this store, system accounts left out; the plan is prorated by open days this month', () => {
  const by = { 'Ann': { hours: 160 }, 'Ben': { hours: 120.5 }, 'Toast Generic Login': { hours: 6 }, 'Server Default': { hours: 4 }, 'Order Only': { hours: 3 }, 'Kiosk 1': { hours: 2 } };
  const c = device({ k: { 'F06|2026-10': kBase(), 'F01|2026-10': kBase(), 'F06|2026-11': kBase() },
    lc: { 'F06|2026-10': { byName: by, laborDays: 31, noLaborDays: [] }, 'F01|2026-10': { byName: by, laborDays: 30, noLaborDays: ['2026-10-05'] },
          'F06|2026-11': { byName: { Ann: { hours: 60 }, Ben: { hours: 40 } }, laborDays: 12, noLaborDays: [] } },
    closed: { 'F06|2026-11-03': 1, 'F06|2026-11-10': 1, 'F06|2026-11-17': 1, 'F06|2026-11-24': 1 } });
  const h = plain(run(c, `k2LaborHours('F06','2026-10')`));
  assert.equal(h.hours, 280.5);
  assert.equal(h.excluded, 15, 'Toast Generic Login, LaLa Server Default, Order Only, Kiosk');
  assert.equal(plain(run(c, `k2LaborHours('F01','2026-10')`)).hours, 284.5, 'Server Default is a person outside LaLa (F06 only)');
  setMan(c, 'F06', '2026.10', { tgt_laborHours: 270 });
  const A = plain(run(c, `_k2ActualsRaw('F06','2026-10')`));
  const r = rowOf(A, 'laborHours');
  assert.equal(r.act, 280.5);
  assert.equal(r.j, 'over', 'over the plan');
  assert.equal(r.diff, '計画差 +10.5h');
  assert.equal(r.st, '確定');
  assert.match(r.actNote, /15h を除外/);
  // a missing attendance day keeps the month provisional
  setMan(c, 'F01', '2026.10', { tgt_laborHours: 300 });
  const r2 = rowOf(plain(run(c, `_k2ActualsRaw('F01','2026-10')`)), 'laborHours');
  assert.equal(r2.j, 'ok');
  assert.equal(r2.st, '暫定：勤怠の無い日 1 日');
  // this month: plan × open days before today ÷ open days in the month (4 closed days in November)
  assert.equal(run(c, `k2OpenDays('F06','2026-11')`), 26);
  assert.equal(run(c, `k2OpenDays('F06','2026-11','2026-11-13')`), 10, '11/1–11/12 minus 11/3 and 11/10');
  const r3 = rowOf(plain(run(c, `_k2ActualsRaw('F06','2026-11')`)), 'laborHours');
  assert.equal(r3.tgt, 270, 'the plan carries over from October');
  assert.equal(r3.tgtJudge, Math.round(270 * 10 / 26 * 10) / 10);
  assert.equal(r3.j, 'ok');
  assert.match(r3.tgtNote, /営業日 10\/26 日/);
  // no plan → waits for one
  const r4 = rowOf(plain(run(c, `_k2ActualsRaw('F06','2026-09')`)), 'laborHours');
  assert.equal(r4.j, 'none');
});

test('④b labor hours: a system account renamed in Toast is still left out by its Toast account ID (4A)', () => {
  // Sept: the account was "Toast Generic Login" (guid G-SYS). Oct: Toast renamed it to "Front Tablet"; the same guid. Ann (G-ANN) is a person.
  const tl = {
    'F01|2026-09-20': { 'Toast Generic Login': { toastName: 'Toast Generic Login', toastNames: ['Toast Generic Login'], toastGuids: ['G-SYS'], rawLunch: 3 }, Ann: { toastName: 'Ann', toastGuid: 'G-ANN', rawLunch: 5 } },
    'F01|2026-10-02': { 'Front Tablet': { toastName: 'Front Tablet', toastGuid: 'G-SYS', rawLunch: 4 }, Ann: { toastName: 'Ann', toastGuid: 'G-ANN', rawLunch: 6 } },
    'F01|2026-10-03': { 'Front Tablet': { toastName: 'Front Tablet', toastGuids: ['G-SYS'], rawLunch: 2 } }
  };
  const lc = { 'F01|2026-10': { byName: { Ann: { hours: 100 }, 'Front Tablet': { hours: 6 } }, laborDays: 31, noLaborDays: [] } };
  const c = device({ k: { 'F01|2026-10': kBase() }, lc, tl });
  const h = plain(run(c, `k2LaborHours('F01','2026-10')`));
  assert.equal(h.hours, 100, 'the renamed account is not counted');
  assert.equal(h.excluded, 6);
  assert.deepEqual(h.exNames, ['Front Tablet']);
  // without the earlier day (no proof that G-SYS was a system account), the name alone does not exclude it
  const tl2 = Object.assign({}, tl); delete tl2['F01|2026-09-20'];
  const c2 = device({ k: { 'F01|2026-10': kBase() }, lc, tl: tl2 });
  assert.equal(plain(run(c2, `k2LaborHours('F01','2026-10')`)).hours, 106);
  // a person who shares no guid with a system account is never excluded
  assert.equal(plain(run(c, `k2IsSysName('F01','2026-10','Ann')`)), false);
});

test('⑤ saving writes only what changed this month; an empty target carries the earlier one again; bad values are not saved', () => {
  const c = device({ k: { 'F09|2026-11': kBase(), 'F09|2026-10': kBase() } });
  c.STORE.set('m_store_kpi', JSON.stringify({ F09: { foodCost: 31 } }));
  setMan(c, 'F09', '2026.10', { tgt_repeatRate: 36, gAvg: 4.5 });
  setMan(c, 'F09', '2026.11', { gAvg: 4.7, gCnt: 9 });
  // 画面を描いて、描いたときの値（defaultValue・defaultChecked）を持つ欄を作り、vals の欄だけ人が変えたことにする
  const inputs = vals => { c.DOM = shownDom(c, 'F09', '2026-11'); for (const [id, v] of Object.entries(vals)) { if (!c.DOM[id]) c.DOM[id] = typeof v === 'boolean' ? { checked: v } : { value: v }; else if (typeof v === 'boolean') c.DOM[id].checked = v; else c.DOM[id].value = v; } };
  const rec = per => JSON.parse(c.STORE.get('kpi_man_' + per)).F09;
  // nothing changed (the shown values are the inherited ones)
  inputs({ 'k2t-repeatRate': '36', 'k2t-foodCost': '31', 'k2t-laborHours': '', 'k2o-drinkRate': false, 'k2o-guests': true });
  assert.equal(run(c, `k2SaveMonth('F09','2026-11')`), false);
  assert.equal(c.TOASTS.at(-1)[0], '変わったところはありません');
  assert.deepEqual(Object.keys(rec('2026.11')).sort(), ['gAvg', 'gCnt'], 'nothing was written');
  // change two things
  inputs({ 'k2t-repeatRate': '37.5', 'k2t-foodCost': '31', 'k2t-laborHours': '420', 'k2o-drinkRate': true, 'k2o-guests': true });
  assert.equal(run(c, `k2SaveMonth('F09','2026-11')`), true);
  const r = rec('2026.11');
  assert.equal(r.tgt_repeatRate, 37.5);
  assert.equal(r.tgt_laborHours, 420);
  assert.equal(r.off_drinkRate, false, 'turned on: written as false (not deleted)');
  assert.ok(!('tgt_foodCost' in r), 'the inherited 31 is not copied into the month');
  assert.equal(r.gAvg, 4.7, 'the hand-entered review fields are kept');
  assert.equal(r.gCnt, 9);
  assert.ok(r._ft && r._ft.tgt_repeatRate > 0, 'field stamps (the v1136 merge keeps both devices\' fields)');
  assert.ok(!r._ft.gAvg || r._ft.gAvg !== r._ft.tgt_repeatRate, 'untouched fields keep their stamps');
  assert.equal(rec('2026.10').tgt_repeatRate, 36, 'October is unchanged');
  assert.equal(run(c, `getStoreKpiTargets('F09', 0, '2026-12').repeatRate`), 37.5, 'December inherits November');
  assert.equal(c.RENDERS, 1);
  // empty → this month's value is removed and October's is used again
  inputs({ 'k2t-repeatRate': '', 'k2t-laborHours': '420' });
  assert.equal(run(c, `k2SaveMonth('F09','2026-11')`), true);
  assert.ok(!('tgt_repeatRate' in rec('2026.11')) || rec('2026.11').tgt_repeatRate == null);
  assert.equal(run(c, `getStoreKpiTargets('F09', 0, '2026-11').repeatRate`), 36);
  // out of range: nothing is written
  const before = c.STORE.get('kpi_man_2026.11');
  for (const bad of [{ 'k2t-repeatRate': '150' }, { 'k2t-reviewScore': '6' }, { 'k2t-laborHours': '-1' }, { 'k2t-foodCost': 'abc' }]) {
    inputs(bad);
    assert.equal(run(c, `k2SaveMonth('F09','2026-11')`), false, JSON.stringify(bad));
    assert.equal(c.TOASTS.at(-1)[1], 'warning');
  }
  assert.equal(c.STORE.get('kpi_man_2026.11'), before);
  // sales, guests and check are never written (they come from the budget)
  inputs({ 'k2t-sales': '999999', 'k2t-guests': '1', 'k2t-ppa': '1' });
  assert.equal(run(c, `k2SaveMonth('F09','2026-11')`), false);
  // no permission
  const d = device({ can: false });
  d.DOM = { 'k2t-repeatRate': { value: '40' } };
  assert.equal(run(d, `k2SaveMonth('F09','2026-11')`), false);
  assert.equal(d.STORE.has('kpi_man_2026.11'), false);
});

test("⑤c (Codex #147 P2-1) another device's change that reached this device before the table was drawn again is not undone by saving untouched fields", () => {
  const c = device({ k: { 'F01|2026-11': kBase(), 'F01|2026-10': kBase() } });
  setMan(c, 'F01', '2026.11', { tgt_repeatRate: 35, tgt_foodCost: 30, gAvg: 4.6 });
  const rec = () => JSON.parse(c.STORE.get('kpi_man_2026.11')).F01;
  // A draws the table: repeat 35, food 30, drink used
  const dom = shownDom(c, 'F01', '2026-11');
  assert.equal(dom['k2t-repeatRate'].defaultValue, '35', 'the box carries the value it was drawn with');
  assert.equal(dom['k2t-foodCost'].defaultValue, '30');
  assert.equal(dom['k2o-drinkRate'].defaultChecked, true);
  c.DOM = dom;
  // A changes only the repeat rate
  c.DOM['k2t-repeatRate'].value = '36';
  // B's food cost 28 and "drink not used" reach A's device (the table is not drawn again yet)
  const r0 = rec(), at = (r0._ft && r0._ft.tgt_foodCost) || 0;
  setMan(c, 'F01', '2026.11', Object.assign({}, r0, { tgt_foodCost: 28, off_drinkRate: true, _ft: Object.assign({}, r0._ft, { tgt_foodCost: at + 1, off_drinkRate: at + 1 }) }));
  assert.equal(run(c, `k2SaveMonth('F01','2026-11')`), true);
  let r = rec();
  assert.equal(r.tgt_repeatRate, 36, 'what A changed is saved');
  assert.equal(r.tgt_foodCost, 28, 'B\'s food cost stays (A did not touch it)');
  assert.equal(r.off_drinkRate, true, 'B\'s "not used" stays (A did not touch the box)');
  assert.equal(r.gAvg, 4.6);
  // A clears a target it had drawn → this month's value is removed, even though B's value is newer
  c.DOM = shownDom(c, 'F01', '2026-11');
  setMan(c, 'F01', '2026.11', Object.assign({}, rec(), { tgt_laborHours: 400 }));
  c.DOM['k2t-repeatRate'].value = '';
  assert.equal(run(c, `k2SaveMonth('F01','2026-11')`), true);
  r = rec();
  assert.ok(r.tgt_repeatRate == null, 'the cleared target is removed');
  assert.equal(r.tgt_laborHours, 400, 'B\'s plan (arrived after drawing) stays');
  assert.equal(r.tgt_foodCost, 28);
  // A turns a box it had drawn as "used" off → written; a box drawn as off and still off is not touched
  c.DOM = shownDom(c, 'F01', '2026-11');
  assert.equal(c.DOM['k2o-drinkRate'].defaultChecked, false);
  setMan(c, 'F01', '2026.11', Object.assign({}, rec(), { off_drinkRate: false }));
  c.DOM['k2o-guests'].checked = false;
  assert.equal(run(c, `k2SaveMonth('F01','2026-11')`), true);
  r = rec();
  assert.equal(r.off_guests, true);
  assert.equal(r.off_drinkRate, false, 'B turned drink on again after A drew it; A did not touch it');
  // nothing touched → nothing written even if the device has newer values from elsewhere
  c.DOM = shownDom(c, 'F01', '2026-11');
  setMan(c, 'F01', '2026.11', Object.assign({}, rec(), { tgt_foodCost: 27 }));
  const before = c.STORE.get('kpi_man_2026.11');
  assert.equal(run(c, `k2SaveMonth('F01','2026-11')`), false);
  assert.equal(c.TOASTS.at(-1)[0], '変わったところはありません');
  assert.equal(c.STORE.get('kpi_man_2026.11'), before);
  // the same number written differently (36 / 36.0) is not a change
  assert.equal(run(c, `k2SameInput('36', '36.0')`), true);
  assert.equal(run(c, `k2SameInput('', '0')`), false);
  assert.equal(run(c, `k2SameInput(' 30 ', '30')`), true);
});

test("⑤d (Codex #147 P2-2) a past month is judged with that month's targets, not this month's", () => {
  const c = device({ cur: '2026-11' });
  setMan(c, 'F09', '2026.10', { tgt_laborPct: 32, tgt_foodCost: 31 });
  setMan(c, 'F09', '2026.11', { tgt_laborPct: 28, tgt_foodCost: 27 });
  run(c, between('var MD_KPI = {', '\n};').replace('var MD_KPI', 'var MD_KPI') + '\n' + ['mcRound', 'mdUnknown', 'mdJudge', 'mdVerdict', 'mdWeekRates'].map(fnSrc).join('\n') + `
    function mdV(code, state, o){ return Object.assign({ code: code, state: state }, o || {}); }
    function mcYm(){ return CUR; }
    function cumulativeToToday(){ return { laborRate: 30, actToToday: 1000, actMonth: 1000, budMonth: 1000, daysWithActual: 30, budToToday: 1000 }; }
    function mcEnoughDays(){ return true; }
    function mdViewLaborGate(){ return false; }
    function foodCostOf(){ return { hasEnd: true, rate: 29 }; }
    function _mdMemo(ns, key, make){ return make(); }
    function mcYmOffset(){ return 0; }
    function monthGuestBudget(){ return 0; }
    function mdStoreSeries(){ return { budMonth: 1000, weeks: [{ sun: '2026-10-04', hasAct: true, sales: 1000, bud: 1000, guests: 0, labor: 300, food: 290 }] }; }
  `);
  const lab = plain(run(c, `mdVerdict('F09','labor_rate','2026-10')`));
  assert.equal(lab.target, 32, 'October\'s labor target');
  assert.equal(lab.state, 'ok', '30% against 32% is met');
  const nov = plain(run(c, `mdVerdict('F09','labor_rate','2026-11')`));
  assert.equal(nov.target, 28);
  assert.equal(nov.state, 'miss');
  const fc = plain(run(c, `mdVerdict('F09','cost_rate','2026-10')`));
  assert.equal(fc.target, 31, 'October\'s food cost target');
  assert.equal(fc.state, 'ok');
  const wk = plain(run(c, `mdWeekRates('F09','2026-10')`))[0];
  assert.equal(wk.labor_rate, Math.round(32 / 30 * 100), 'the week rate uses October\'s labor target');
  assert.equal(wk.cost_rate, Math.round(31 / 29 * 100), 'and October\'s food cost target');
  // every other lookup that knows its month passes it
  assert.match(fnSrc('quarterTargets'), /getStoreKpiTargets\(storeId, 0, months\[months\.length-1\]\)/);
  assert.match(fnSrc('_qbMonthData'), /getStoreKpiTargets\(storeId, 0, ym\)/);
  assert.match(fnSrc('laborSummaryCard'), /getStoreKpiTargets\(storeId, 0, _ym\)/);
  assert.match(fnSrc('renderLaborDetail'), /getStoreKpiTargets\(storeId, 0, ym\)/);
  assert.doesNotMatch(fnSrc('mdVerdict'), /getStoreKpiTargets\(storeId\)/);
  assert.doesNotMatch(fnSrc('mdWeekRates'), /getStoreKpiTargets\(storeId\)/);
});

test('⑤b the table renders every KPI with a target box only where it can be changed', () => {
  const c = device({ k: { 'F01|2026-10': kBase(), 'F01|2026-11': kBase() } });
  run(c, `window._kpiStore='F01'; window._k2Ym='2026-10';`);
  const html = run(c, `renderKpi2Store()`);
  for (const no of ['① 売上', '② 客数', '③ 客単価', '④ リピート率', '⑤ 原価率', '⑥ 人件費率', '⑦ 総労働時間', '⑧ ドリンク比率', '⑨ アップグレード率', '⑩ いくらシャワー率', '⑪ Googleレビュー']) assert.ok(html.includes(no), no);
  for (const key of ['repeatRate', 'foodCost', 'laborPct', 'laborHours', 'drinkRate', 'reviewScore']) assert.ok(html.includes('id="k2t-' + key + '"'), key);
  for (const key of ['sales', 'guests', 'ppa']) assert.ok(!html.includes('id="k2t-' + key + '"'), key + ' has no box');
  assert.ok(!html.includes('id="k2t-misoUpgradeRate"'), 'an off KPI has no target box');
  assert.ok(html.includes('id="k2o-misoUpgradeRate"'), 'but it can be turned on');
  assert.ok(!html.includes('id="k2o-sales"'), 'sales is always used');
  assert.ok(html.includes('旧 味噌汁UP率'));
  assert.ok(html.includes('2026年10月の目標を保存'));
  // view only
  const d = device({ can: false, k: { 'F01|2026-11': kBase() } });
  run(d, `window._kpiStore='F01';`);
  const v = run(d, `renderKpi2Store()`);
  assert.ok(!v.includes('k2t-'), 'no target boxes');
  assert.ok(v.includes('disabled'), 'the use boxes are locked');
  assert.ok(!v.includes('の目標を保存'));
  assert.ok(v.includes('見るだけ'));
});

test('④b hours and Google show even when the meeting has no sales numbers for the month; not for future months', () => {
  const c = device({ lc: { 'F06|2026-09': { byName: { Ann: { hours: 150 }, 'Toast Generic Login': { hours: 5 } }, laborDays: 30, noLaborDays: [] },
                          'F06|2026-12': { byName: { Ann: { hours: 9 } }, laborDays: 1, noLaborDays: [] } } });
  setMan(c, 'F06', '2026.9', { tgt_laborHours: 160, gAvg: 4.7, gCnt: 9, tgt_reviewScore: 4.5 });
  const A = plain(run(c, `_k2ActualsRaw('F06','2026-09')`));   // keyKpiStats throws here (no sales data) → k is null
  const h = rowOf(A, 'laborHours'), g = rowOf(A, 'reviewScore'), s = rowOf(A, 'sales');
  assert.equal(s.act, null, 'no sales numbers');
  assert.equal(h.act, 150, 'hours come from attendance, not from the sales numbers');
  assert.match(h.actNote, /5h を除外/);
  assert.equal(h.j, 'ok');
  assert.equal(g.act, 4.7, 'Google comes from the hand input');
  assert.match(g.actNote, /9 件の平均/);
  assert.equal(g.j, 'ok');
  setMan(c, 'F06', '2026.12', { gAvg: 4.9, tgt_reviewScore: 4.5 });
  const F = plain(run(c, `_k2ActualsRaw('F06','2026-12')`));
  assert.equal(rowOf(F, 'laborHours').act, null, 'a future month shows no actual');
  assert.equal(rowOf(F, 'reviewScore').act, null, 'a future month shows no actual');
});

test('⑥ Google in the meeting: the month average of the reviews posted that month (1A), against the KPI target', () => {
  const c = device();
  setMan(c, 'F01', '2026.10', { gAvg: 4.8, gCnt: 12, reviewScore: 4.6, gTotalCnt: 312, tgt_reviewScore: 4.4 });
  const h = run(c, `_meetGoogleCard({id:'F01', name:'ToriTon', googleUrl:'https://maps.example/x'}, '2026-10')`);
  assert.ok(h.includes('★4.8'), 'the month average is the actual');
  assert.ok(h.includes('12 件・会議の「実績」に入る値'));
  assert.ok(h.includes('★4.4'), 'the target');
  assert.ok(h.includes('達成'), 'judged with the meeting threshold');
  assert.ok(h.includes('★4.6') && h.includes('累計 312 件'), 'the overall rating for reference');
  assert.ok(h.includes('Google の API はつなぎません'));
  assert.ok(h.includes('href="https://maps.example/x"'));
  assert.ok(h.includes('Google で見る'));
  // no review page in the store master: a Google Maps search for the store; an unsafe address is never used as a link
  const m = run(c, `_meetGoogleCard({id:'F01', name:'ToriTon'}, '2026-10')`);
  assert.ok(m.includes('href="https://www.google.com/maps/search/?api=1&amp;query=ToriTon%20Hawaii"') && m.includes('Google マップで探す'));
  const x = run(c, `_meetGoogleCard({id:'F01', name:'ToriTon', googleUrl:'javascript:alert(1)'}, '2026-10')`);
  assert.ok(!x.includes('javascript:') && x.includes('google.com/maps/search'));
  // the target carries over to November; no average yet → no judgment
  const n = run(c, `_meetGoogleCard({id:'F01', name:'ToriTon'}, '2026-11')`);
  assert.ok(n.includes('★4.4'));
  assert.ok(n.includes('>—<'));
  // the input tab has the new fields and checks them
  const tab = fnSrc('renderKpiManualTab'), save = fnSrc('saveKpiManual');
  assert.match(tab, /\['gAvg','Google：この月に投稿された口コミの平均（会議の実績）','★'\]/);
  for (const f of ['gCnt', 'gTotalCnt']) { assert.ok(tab.includes(`['${f}'`), f); assert.ok(save.includes(`'${f}'`), f); }
  assert.match(save, /v<1\|\|v>5/);
});

test('⑦ focus cards: G1–G3 see the floor KPIs only, G4 the management KPIs; off KPIs and empty cards are not shown', () => {
  const k = kBase({ pace: { budget: 49030, guestBudget: 1558 }, sales: 50210, guests: 1520 });
  const c = device({ k: { 'F01|2026-11': k }, lc: { 'F01|2026-11': { byName: { Ann: { hours: 192 } }, laborDays: 12, noLaborDays: [] } },
    drink: { 'F01|2026.11': { drink: 100, total: 300, hasCfg: true } } });
  setMan(c, 'F01', '2026.11', { tgt_repeatRate: 35, tgt_laborHours: 420, gAvg: 4.6, gCnt: 5 });
  const f = run(c, `k2FocusCard('F01','field')`);
  for (const s of ['ToriTon の現場の重点 KPI', '客数', 'リピート率', 'ドリンク比率', 'Googleレビュー', '見るだけ', '11月・前日（11/12）まで', 'FT 2,410・RP 1,190・SR 274']) assert.ok(f.includes(s), s);
  for (const s of ['>売上<', '>原価率<', '>人件費率<', '>総労働時間<', '>アップグレード率<']) assert.ok(!f.includes(s), 'no ' + s);
  assert.ok(f.includes('G4（店舗責任）の KPI です'), 'says where the store KPIs are');
  const m = run(c, `k2FocusCard('F01','mgmt')`);
  for (const s of ['ToriTon の KPI', '>売上<', '>客単価<', '>原価率<', '>人件費率<', '>総労働時間<', '店舗責任（G4・自店）', 'KPI設定を開く']) assert.ok(m.includes(s), s);
  assert.ok(m.includes('前日までの計画'), 'hours against the plan to date');
  assert.ok(m.includes('現場の KPI（G1〜G3 が取り組む・あなたが見る）'));
  // off → not shown
  setMan(c, 'F01', '2026.11', { tgt_repeatRate: 35, off_repeatRate: true });
  assert.ok(!run(c, `k2FocusCard('F01','field')`).includes('リピート率'));
  // no numbers on this device → no card; the all-store view → no card
  const e = device({ k: { 'F01|2026-11': kBase({ sales: 0, guests: 0, ppa: 0, repeatRate: null, repeatHas: false, guestBudget: null, budget: 0, drinkRate: null, fcRate: 0, laborRate: 0 }) } });
  assert.equal(run(e, `k2FocusCard('F01','field')`), '');
  assert.equal(run(c, `k2FocusCard('ALL','field')`), '');
  // where it is shown
  const roughFn = name => { const i = SRC.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); assert.ok(i >= 0, name); const j = SRC.indexOf('\nfunction ', i + 10); return SRC.slice(i, j > i ? j : undefined); };
  assert.match(roughFn('renderMypage'), /if \(myGradeNum\(\)<=3\) html \+= k2FocusCard\(storeId, 'field'\)/);
  assert.match(roughFn('renderSlFunergyNow'), /k2FocusCard\(myStoreId\(\), myGradeNum\(\)>=4 \? 'mgmt' : 'field'\)/);
  assert.match(roughFn('renderDashboard'), /if \(curRealRole==='g4'\) \{ try \{ html \+= k2FocusCard\(myStoreId\(\), 'mgmt'\)/, 'G4 is aliased to am: the real role decides');
  assert.match(roughFn('renderMgmtDash'), /if \(curRealRole === 'g4'\) \{ try \{ h \+= k2FocusCard\(myStoreId\(\), 'mgmt'\); \} catch \(e\) \{\} \}\n  h \+= '<div class="md-shell">'/, 'G4 opens the management dashboard (mdCanOpen): the card goes above it');
});

test('⑧ names: アップグレード率 (formerly 味噌汁UP率) everywhere on screen; KPI設定; version 1153', () => {
  const c = device();
  assert.equal(run(c, `_meetKpiDef('miso').label`), 'アップグレード率');
  assert.match(SRC, /\{key:'misoUpgradeRate', label:'アップグレード率'/);
  assert.match(fnSrc('_meetKpiRows'), /label:t\('アップグレード率','Upgrade rate'\)/);
  const screen = SRC.split('\n').filter(l => /味噌汁UP率/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l) && !/旧 味噌汁UP率|味噌汁UP率から|味噌汁UP率・/.test(l));
  assert.deepEqual(screen, [], 'no screen label left');
  assert.match(SRC, /\{id:'kpi_master',  label:'KPI設定',/);
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  assert.equal(v, '1153');
  assert.equal(/const SW_BUILD = '(\d+)'/.exec(SW)[1], v);
});

test('④c the labor import keeps the Toast account ID, and two Toast entries added to one person keep both IDs', () => {
  const c = { console };
  vm.createContext(c);
  run(c, ['_toastShiftsOverlap', 'tipLaborPut'].map(fnSrc).join('\n'));
  const labor = {}, conf = {};
  run(c, `var L=${JSON.stringify(labor)}, C={};`);
  run(c, `tipLaborPut(L, C, 'Ann', { lunch:3, dinner:0, rawLunch:3, rawDinner:0, shifts:[], toastName:'Ann', toastGuid:'G-1' }, { conf:true });`);
  run(c, `tipLaborPut(L, C, 'Ann', { lunch:2, dinner:0, rawLunch:2, rawDinner:0, shifts:[], toastName:'Ann K', toastGuid:'G-2' }, { conf:true });`);
  const a = plain(run(c, 'L.Ann'));
  assert.deepEqual(a.toastGuids, ['G-1', 'G-2']);
  assert.equal(a.toastGuid, 'G-1');
  assert.equal(a.lunch, 5);
  // the import passes the ID through (both import paths)
  assert.equal((SRC.match(/tipLaborPut\(labor, _conf, key, tipLaborWithGuid\(\{[^}]*toastName: emp\.name \}, emp\), _r\)/g) || []).length, 2);
  run(c, fnSrc('tipLaborWithGuid'));
  assert.deepEqual(plain(run(c, `tipLaborWithGuid({ a:1 }, { guid:'G-9' })`)), { a: 1, toastGuid: 'G-9' });
  assert.deepEqual(plain(run(c, `tipLaborWithGuid({ a:1 }, { guid:'unknown' })`)), { a: 1 }, 'no reference in Toast: nothing is added');
  assert.deepEqual(plain(run(c, `tipLaborWithGuid({ a:1 }, {})`)), { a: 1 }, 'older rows: the same shape as before');
});
