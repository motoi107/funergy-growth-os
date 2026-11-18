// v1188（UI案91・Moto さん 11/17「A」）：KPI設定 › 業務用アカウントで、ID の無い前の記録を名前で 外す／数える ことを見せる（表示だけ）。
//   1 名前ごとの表（扱い・理由・日数・時間）／2 月を選ぶ（今月〜13 か月前）／3 人の勤怠はたたむ／4 決まりは変えない／
//   5 勤怠データでこの月を開く／6 日次進捗の内訳を「ID で」「名前で」に分ける。
// 本物の関数（index.html の k2Sys*・k2HoursDays など）を VM で動かす。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fnSrc(name, src = SRC) {
  const SRC_ = src;
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC_);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC_.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC_.length; i++) {
    const ch = SRC_[i], nx = SRC_[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC_.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC_.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC_.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, code) => vm.runInContext(code, c);

const FNS = ['k2NormAcctName', 'k2SysAcctList', 'k2SysWhy', 'k2SysNameWhy', 'k2SysMatcher', 'k2DayIssues', 'k2HoursDays', 'k2HoursDaysM', 'k2HoursDaysAll',
  'k2RecGuids', 'isOrderOnlyAccount', 'toastSystemAccount', '_laborHrs', 'k2IsSysName', 'k2SysGuids', 'k2MonthGuids', 'k2YmAdd', 'daysOfYm',
  'k2SysNoIdTable', 'k2SysWhyText', 'k2SysYmOptions', 'k2SysYmSel', 'k2SysYmSet', 'k2OpenAtt', 'k2SysCanEdit', 'k2SysMonthAccounts', 'k2HoursDetailHtml',
  'renderKpiSysAcctTab', 'k2SysToggle'];
function world({ today = '2026-11-17', labor = {}, kpi = {}, role = 'gm', over = {}, src = SRC, fns = FNS } = {}) {
  const LS = {}; Object.keys(labor).forEach(k => { LS['tip_labor_' + k] = labor[k]; }); LS.kpi_config = kpi;
  const c = { console, JSON, Math, Object, Array, String, Number, RegExp, Date, Promise, LS, OVER: over, TODAY: today, ROLE: role, CALLS: [], RENDERS: [] };
  c.window = c;
  vm.createContext(c);
  run(c, `
    var curRole=ROLE, curRealRole=null, curUserName='Moto', _k2SysBusy=false, curStore='ALL', attMonthOffset=0, _laborStore=null, laborTab='x';
    function t(ja){ return ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(ch){ return '&#'+ch.charCodeAt(0)+';'; }); }
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : d; }
    function lsKeys(pre){ return Object.keys(LS).filter(function(k){ return k.indexOf(pre)===0; }); }
    function getKpiConfig(){ return LS.kpi_config || {}; }
    function getStoresAll(){ return [{ id:'F06', name:'LaLa' }, { id:'F01', name:'ToriTon' }]; }
    function kpiSettableStores(){ return getStoresAll(); }
    function getTipLabor(sid, d){ var o=OVER[sid+'|'+d]; if(o) return o; var r=ls('tip_labor_'+sid+'_'+d, null); if(!r) return null;
      var out={}; Object.keys(r).forEach(function(n){ if(isOrderOnlyAccount(n) || isOrderOnlyAccount(r[n] && r[n].toastName)) return; out[n]=r[n]; }); return out; }
    function getAttOverride(sid, d){ return OVER[sid+'|'+d] ? { data:OVER[sid+'|'+d] } : null; }
    function curYm(){ return TODAY.slice(0,7); } function bizToday(){ return TODAY; }
    function bizNow(){ return new Date(TODAY+'T12:00:00'); }
    function dayClosureMode(sid, d){ return d==='2026-10-12' ? 'closed' : null; }
    function myAmStores(){ return []; }
    function k2YmLabel(y){ return y.slice(0,4)+'年'+parseInt(y.slice(5),10)+'月'; }
    function k2ExplicitTarget(){ return null; } function k2OldHoursPlan(){ return null; } function k2PendingText(){ return '未集計'; }
    function k2hGraph(){ return ''; } function k2hDayLabel(d){ return d; } function k2hWhy(w){ return w; } function k2hSales(){ return 0; }
    function k2Hpd(v){ return v==null?'—':(Math.round(v*10)/10).toFixed(1)+' h/営業日'; } function k2HpdDiff(){ return ''; } function k2Chip(){ return ''; }
    var K2_J={ none:['','',''] };
    function canAccessKpiMaster(){ return true; }
    function renderPage(p){ RENDERS.push(p); } function go(p){ CALLS.push(['go', p]); }
    function loadMonthAndRerender(ym, p){ CALLS.push(['load', ym, p]); }
    function ceIsSystemAccount(n){ return /kiosk/i.test(String(n)); }
  `);
  fns.forEach(n => run(c, fnSrc(n, src)));
  return c;
}
/* 勤怠の 1 件：g があれば ID（toastGuid）つき・無ければ ID の無い前の記録（v1153 より前の取り込み） */
const LE = (h, g, extra) => Object.assign({ rawLunch: 0, rawDinner: h, lunch: 0, dinner: h }, g ? { toastGuid: g } : {}, extra || {});

/* 10 月：前半は ID の無い前の記録・後半は ID つき。一覧は Kiosk 1（g-k）を外す・Server Default（g-sd）は外すのをやめた */
function octLabor() {
  return {
    'F06_2026-10-02': { Ann: LE(8), 'Kiosk 1': LE(1), 'Toast Generic Login': LE(2), 'Server Default': LE(3) },
    'F06_2026-10-03': { Ann: LE(7), Ben: LE(6), 'Kiosk 1': LE(1.5) },
    'F06_2026-10-12': { Ann: LE(2) },                           /* 定休日（仕込み）：数えた日に入る */
    'F06_2026-10-20': { Ann: LE(8, 'g-a'), 'Kiosk 1': LE(1, 'g-k'), 'Server Default': LE(4, 'g-sd') },
    'F06_2026-10-21': { Ann: LE(8, 'g-a'), Cara: LE(5) },        /* ID のある日に ID の無い件が混ざる＝その日は「ID の無い日」 */
    'F06_2026-10-22': { Ann: LE(8, 'g-a', { openShifts: [{ inDate: '2026-10-22T17:00:00Z' }] }), 'Kiosk 1': LE(9) } /* 未集計の日：表にも数にも入らない */
  };
}
const LIST = { byStore: { F06: { sysAcct: { 'g-k': { name: 'Kiosk 1', on: true }, 'g-sd': { name: 'Server Default', on: false } } } } };

test('UI案91-1・4：外す／数えるとその理由は数え方と同じ関数から（k2SysMatcher は k2SysWhy の ex だけ）', () => {
  const c = world({ labor: octLabor(), kpi: LIST });
  const r = plain(run(c, `k2HoursDays('F06','2026-10',{trace:true})`));
  const want = {
    'Kiosk 1|0': ['list_name', true, 'name'], 'Toast Generic Login|0': ['sys_rule', true, 'name'], 'Server Default|0': ['off_name', false, 'name'],
    'Ann|0': ['none', false, 'name'], 'Ben|0': ['none', false, 'name'], 'Cara|0': ['none', false, 'name'],
    'Ann|1': ['id_none', false, 'id'], 'Kiosk 1|1': ['id_on', true, 'id'], 'Server Default|1': ['id_none', false, 'id']
  };
  for (const x of r.trace) {
    const w = want[x.name + '|' + (x.gid ? 1 : 0)];
    assert.ok(w, 'unexpected ' + x.name);
    assert.deepEqual([x.why, x.ex, x.by], w, x.date + ' ' + x.name);
    const m = run(c, `(function(){ var e=getTipLabor('F06','${x.date}')['${x.n}']; return [k2SysMatcher('F06','2026-10')('${x.n}', e), k2SysWhy('F06','2026-10')('${x.n}', e).ex]; })()`);
    assert.deepEqual(plain(m), [x.ex, x.ex], 'the matcher (used for counting) and the shown reason agree: ' + x.name);
  }
  assert.ok(!r.trace.some(x => x.date === '2026-10-22'), 'a pending day (no clock-out) is in neither the table nor the numbers');
  assert.ok(r.trace.some(x => x.date === '2026-10-12'), 'a closed day with prep hours is counted (like the daily breakdown)');
  assert.equal(r.trace.find(x => x.why === 'off_name').id, 'g-sd', 'the “no longer excluded” row names the list ID');
});

test('UI案91-6：外した時間を「ID で」「名前で」に分けても合計は前と同じ・ID の無い日を数える', () => {
  const c = world({ labor: octLabor(), kpi: LIST });
  const r = plain(run(c, `k2HoursDays('F06','2026-10')`));
  assert.equal(r.hasList, true);
  assert.equal(r.exId, 1, 'Kiosk 1 on 10/20 by ID');
  assert.equal(r.exName, 4.5, 'Kiosk 1 1h + Toast Generic Login 2h on 10/2 + Kiosk 1 1.5h on 10/3 by name');
  assert.equal(Math.round((r.exId + r.exName) * 100) / 100, r.excludedHours, 'the split adds up to the old total');
  assert.deepEqual(r.exIdBy, { 'Kiosk 1': 1 }); assert.deepEqual(r.exNameBy, { 'Kiosk 1': 2.5, 'Toast Generic Login': 2 });
  assert.equal(r.noIdDays, 4, '10/2, 10/3, 10/12 and 10/21 (Cara has no ID); 10/22 is pending');
  assert.equal(r.openHours, 8 + 3 + 7 + 6 + 8 + 4 + 8 + 5, 'Server Default counts (stopped on the list), people count');
  const html = run(c, `k2HoursDetailHtml(['F06'],'2026-10')`);
  assert.match(html, /ID で 1\.0h：<\/b>Kiosk 1 1h/);
  assert.match(html, /名前で（ID の無い日 4 日）4\.5h：<\/b>Kiosk 1 2\.5h · Toast Generic Login 2h/);
  assert.match(html, /ID の無い前の記録（11\/13 より前のアプリで取り込んだ日）は名前で決めます/, 'the corrected note');
  assert.doesNotMatch(html, /名前だけでは外しません/, 'the old note that said names never decide is gone');
  assert.match(html, /window\._k2SysYm='2026-10'/, 'the button opens the list on the same month');
});

test('UI案91-1・3：名前ごとの表は日次進捗の「名前で」と同じ数・人はまとめて 1 行', () => {
  const c = world({ labor: octLabor(), kpi: LIST });
  const tb = plain(run(c, `k2SysNoIdTable('F06','2026-10')`));
  assert.equal(tb.exH, tb.r.exName, 'excluded by name in the table = “by name” in the breakdown');
  const rows = tb.main.map(o => [o.name, o.ex, o.why, o.d, o.h]);
  assert.deepEqual(rows, [
    ['Kiosk 1', true, 'list_name', 2, 2.5],
    ['Toast Generic Login', true, 'sys_rule', 1, 2],
    ['Server Default', false, 'off_name', 1, 3]
  ], 'excluded first, larger hours first; ID records are not in the table');
  assert.deepEqual(tb.people.map(o => [o.name, o.d, o.h]), [['Ann', 3, 17], ['Ben', 1, 6], ['Cara', 1, 5]]);
  assert.equal(tb.cntH, 3 + 17 + 6 + 5); assert.equal(tb.offN, 1); assert.equal(tb.exNames, 2);
  assert.deepEqual(tb.noId, { n: 4, a: '2026-10-02', b: '2026-10-21' });
  assert.deepEqual(tb.withId, { n: 1, a: '2026-10-20', b: '2026-10-20' });
  const html = run(c, `window._kpiStore='F06'; window._k2SysYm='2026-10'; renderKpiSysAcctTab()`);
  assert.match(html, /人の勤怠 3 人/); assert.doesNotMatch(html, /padding-left:12px;overflow-wrap:anywhere">Ben/, 'people are collapsed');
  run(c, `window._k2SysPeopleOpen=true`);
  assert.match(run(c, `renderKpiSysAcctTab()`), /padding-left:12px;overflow-wrap:anywhere">Ben/, 'and open on press');
  assert.match(html, /一覧で「外すのをやめた」名前（…g-sd）/);
  assert.match(html, /合計 <b>35\.5h<\/b>/);
  assert.doesNotMatch(html, /k2SysToggle\([^)]*'Kiosk 1'/, 'no override buttons in the table (decisions do not change)');
});

test('UI案91-2・5：月は今月〜13 か月前・選んだ月で読む・勤怠データでその月を開く', () => {
  const c = world({ labor: octLabor(), kpi: LIST });
  const o = plain(run(c, `k2SysYmOptions()`));
  assert.equal(o.length, 14); assert.equal(o[0], '2026-11'); assert.equal(o[13], '2025-10');
  assert.equal(run(c, `window._k2SysYm='2024-01'; k2SysYmSel()`), '2026-11', 'a month outside the range falls back to this month');
  run(c, `k2SysYmSet('2026-10')`);
  assert.equal(run(c, `window._k2SysYm`), '2026-10');
  assert.deepEqual(plain(c.CALLS.pop()), ['load', '2026-10', 'kpi_master'], 'a past month is loaded');
  run(c, `k2SysYmSet('2020-01')`); assert.equal(run(c, `window._k2SysYm`), '2026-10', 'out of range is ignored');
  c.CALLS.length = 0;
  run(c, `k2OpenAtt('F06','2026-09')`);
  assert.equal(run(c, `attMonthOffset`), -2); assert.equal(run(c, `_laborStore`), 'F06'); assert.equal(run(c, `laborTab`), 'attendance');
  assert.deepEqual(plain(c.CALLS), [['go', 'labor'], ['load', '2026-09', 'labor']], 'only opens (the re-import is pressed by a person)');
  const html = run(c, `window._kpiStore='F06'; window._k2SysYm='2026-10'; renderKpiSysAcctTab()`);
  assert.match(html, /k2OpenAtt\(\\?'F06\\?',\\?'2026-10\\?'\)/); assert.match(html, /勤怠データでこの月を開く/);
  assert.match(html, /<option value="2026-10" selected>/);
});

test('UI案91：一覧の無い店は ID のある日も名前で決めている（表は ID の無い記録だけ・内訳は「一覧がまだ無い店」）', () => {
  const c = world({ labor: octLabor(), kpi: {} });
  const r = plain(run(c, `k2HoursDays('F06','2026-10')`));
  assert.equal(r.hasList, false); assert.equal(r.exId, 0);
  assert.equal(r.exName, r.excludedHours, 'everything is by name');
  assert.equal(r.excludedHours, 1 + 2 + 3 + 1.5 + 1 + 4, 'Server Default and Kiosk by the earlier name rules (as before)');
  const tb = plain(run(c, `k2SysNoIdTable('F06','2026-10')`));
  assert.ok(tb.main.every(o => o.why === 'sys_rule'));
  assert.ok(tb.exH < r.exName, 'the table has only the ID-less records');
  assert.match(run(c, `k2HoursDetailHtml(['F06'],'2026-10')`), /名前で（一覧がまだ無い店）/);
});

/* 前の版（v1187＝main 893554b。#189 の記録のコミット 52fa275 と index.html・sw.js は同じ）の関数。そのコミットが無いとき（浅い clone）は理由を出して落ちる（CI は取ってくる） */
import { execSync } from 'node:child_process';
const BASE_V1187 = '893554bbd3463a9aa285e3780b1f5d47fa672bd2';
function oldSrc() {
  try { return execSync('git show ' + BASE_V1187 + ':index.html', { cwd: new URL('..', import.meta.url), maxBuffer: 64 << 20 }).toString('utf8').replace(/\r\n/g, '\n'); }
  catch (e) { throw new Error('needs the v1187 commit (git fetch origin ' + BASE_V1187 + '): ' + e.message); }
}
const OLD_FNS = ['k2NormAcctName', 'k2SysAcctList', 'k2SysMatcher', 'k2DayIssues', 'k2HoursDays', 'k2RecGuids', 'isOrderOnlyAccount', 'toastSystemAccount', '_laborHrs', 'k2IsSysName', 'k2SysGuids', 'k2MonthGuids', 'k2YmAdd', 'daysOfYm'];
test('UI案91：数え方は前の版（v1187）と同じ（ランダムな月 300 通りで日ごとの実働・外した時間・未集計が変わらない）', () => {
  const OLD = oldSrc();
  assert.ok(!/function k2SysWhy\(/.test(OLD), 'the base commit is the old version');
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const names = ['Ann', 'Ben', 'Kiosk 1', 'Toast Generic Login', 'Server Default', 'Order Only', 'Front Tablet', 'kiosk 1'];
  for (let k = 0; k < 300; k++) {
    const labor = {};
    for (let d = 1; d <= 14; d++) {
      if (rnd() < 0.15) continue;
      const day = {};
      names.forEach((n, i) => {
        if (rnd() < 0.5) return;
        const ex = {};
        if (rnd() < 0.08) ex.openShifts = [{ inDate: '2026-10-0' + (d % 9 + 1) + 'T17:00:00Z' }];
        if (rnd() < 0.15) ex.toastName = names[(i + 1) % names.length];
        day[n] = LE(Math.round(rnd() * 80) / 10, rnd() < 0.5 ? 'g' + (rnd() < 0.8 ? i : (i + 2) % 8) : null, ex);
      });
      labor['F06_2026-10-' + String(d).padStart(2, '0')] = day;
    }
    labor['F06_2026-09-15'] = { 'Toast Generic Login': LE(1, 'g1'), 'Server Default': LE(1, 'g4') };
    const kpi = rnd() < 0.7 ? { byStore: { F06: { sysAcct: { g2: { name: 'Kiosk 1', on: rnd() < 0.8 }, g4: { name: 'Server Default', on: rnd() < 0.5 }, g6: { name: 'Front Tablet', on: rnd() < 0.7 } } } } } : {};
    const cNew = world({ labor, kpi }), cOld = world({ labor, kpi, src: OLD, fns: OLD_FNS });
    const a = plain(run(cNew, `k2HoursDays('F06','2026-10')`)), b = plain(run(cOld, `k2HoursDays('F06','2026-10')`));
    for (const f of ['openDays', 'openHours', 'pendingDays', 'closedHours', 'totalHours', 'excludedHours', 'avg']) assert.equal(a[f], b[f], 'case ' + k + ' ' + f);
    assert.deepEqual(a.days, b.days, 'case ' + k + ' days');
    assert.deepEqual(a.excludedBy, b.excludedBy, 'case ' + k + ' excludedBy');
    assert.equal(Math.round((a.exId + a.exName) * 100), Math.round(a.excludedHours * 100), 'case ' + k + ' split adds up');
  }
});
