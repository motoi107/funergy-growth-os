// v1111 (UI案62): "Name in Toast" (alias) links a Toast name that differs a little from the employee master
// to an existing employee, and two punches of the same person on one day are added (4A).
// Runs the real functions from index.html in a VM with synthetic attendance. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const read = (src) => src.replace(/\r\n/g, '\n');
const source = read(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
function pick(src, name) {
  for (const head of ['\nfunction ' + name + '(', '\nasync function ' + name + '(']) {
    const start = src.indexOf(head);
    if (start < 0) continue;
    const end = src.indexOf('\n}', start + 1);
    return src.slice(start + 1, end + 2);
  }
  assert.fail('missing ' + name);
}
const H = (d, hm, plus) => { const [y, m, dd] = d.split('-').map(Number), [h, mi] = hm.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd + (plus ? 1 : 0), h + 10, mi)).toISOString(); };

const NEW = ['toastNameKey', 'empToastAliases', 'toastAliasIndex', 'toastAliasFind', 'toastAliasResolve', '_toastShiftsOverlap', 'tipLaborPut',
  '_toastNameTokens', 'toastNameCandidates', 'toastAliasProblem', 'toastLinkCan', '_toastLinkPreview', 'unregisteredClockIns'];
function app(src, names) {
  const c = { console, STORE: {}, EMPS: [], ROWS: [], curRole: 'gm', Object, JSON, Math, Date, String, Array, Number };
  vm.createContext(c);
  vm.runInContext(names.map(n => pick(src, n)).join('\n') + `
    var _tipLaborSeq = 0, _tipLaborSaved = {};
    function _tipLaborNewer(){ return false; }
    function _tipLaborMark(){}
    function normalizeBusinessDate(d){ return String(d); }
    function setCreditTipAdjLocal(){}
    function isOrderOnlyAccount(n){ return n === 'Order Only'; }
    function getEmployees(){ return JSON.parse(JSON.stringify(EMPS)); }
    function setTipLabor(sid, d, v){ STORE['tip_labor_'+sid+'_'+d] = JSON.parse(JSON.stringify(v)); }
    function tipHoursFromShifts(sid, sh){ var h = 0; sh.forEach(function(s){ h += (new Date(s.outDate) - new Date(s.inDate)) / 3600000; }); return { lunch: 0, dinner: h }; }
    async function fetchTipLaborFromDB(){ return ROWS; }
    function lsKeys(p){ return Object.keys(STORE).filter(function(k){ return k.indexOf(p) === 0; }); }
    function _lsRaw(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _laborHrs(e){ return (+e.rawLunch||0) + (+e.rawDinner||0); }
    function isoOf(d){ return '2026-10-01'; }
    function t(ja){ return ja; }`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const entry = (name, d, a, b) => ({ name, lunchHours: 0, dinnerHours: (Date.parse(H(d, b)) - Date.parse(H(d, a))) / 3600000, shifts: [{ inDate: H(d, a), outDate: H(d, b) }] });
const EMPS = () => [
  { id: 'e9', name: 'Kana Mori-Sample', status: '退職', store: 'F04-P' },      // the duplicate that was resigned (sorts first)
  { id: 'imp1', name: 'Kana Mori-Sample', status: '在籍', store: 'F04-P' },
  { id: 'imp2', name: 'Aoi Example', status: '在籍', store: 'F04-P' },
  { id: 'imp3', name: 'Ren Placeholder', status: '在籍', store: 'F04-P' },
];
async function sync(c, rows) { c.ROWS = rows; return run(c, `syncTipLaborFromDB('F04-P', 'g', [{date:'${rows[0].business_date}'},{date:'${rows[rows.length - 1].business_date}'}])`); }

test('a Toast name that differs only in hyphens is not matched without an alias (as before)', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS();
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Kana-Mori Sample', '2026-10-20', '17:00', '20:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-20']), ['Kana-Mori Sample']);
});

test('with an alias from 10/16, the punches from 10/16 count as the employee; earlier days do not', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS(); c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16', at: 'x', by: 'GM', via: 'unreg' }];
  await sync(c, [
    { business_date: '2026-10-15', data: [entry('Kana-Mori Sample', '2026-10-15', '17:00', '20:00')] },
    { business_date: '2026-10-20', data: [entry('Kana-Mori Sample', '2026-10-20', '17:00', '21:00')] },
  ]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-15']), ['Kana-Mori Sample']);
  const d20 = c.STORE['tip_labor_F04-P_2026-10-20'];
  assert.deepEqual(Object.keys(d20), ['Kana Mori-Sample']);
  assert.equal(d20['Kana Mori-Sample'].rawDinner, 4);
  assert.equal(d20['Kana Mori-Sample'].toastName, 'Kana-Mori Sample');
});

test('two punches of the same person on one day are added (4A); overlap is marked and still counted', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS(); c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16' }];
  await sync(c, [
    { business_date: '2026-10-20', data: [entry('Kana Mori-Sample', '2026-10-20', '17:00', '20:00'), entry('Kana-Mori Sample', '2026-10-20', '20:30', '23:00')] },
    { business_date: '2026-10-22', data: [entry('Kana Mori-Sample', '2026-10-22', '17:00', '21:00'), entry('Kana-Mori Sample', '2026-10-22', '19:00', '22:00')] },
  ]);
  const a = c.STORE['tip_labor_F04-P_2026-10-20']['Kana Mori-Sample'];
  assert.equal(a.rawDinner, 5.5); assert.equal(a.dinner, 5.5);
  assert.deepEqual(a.toastNames, ['Kana Mori-Sample', 'Kana-Mori Sample']);
  assert.equal(a.shifts.length, 2); assert.ok(!a.overlap);
  const b = c.STORE['tip_labor_F04-P_2026-10-22']['Kana Mori-Sample'];
  assert.equal(b.rawDinner, 7); assert.equal(b.overlap, true);
  await sync(c, [{ business_date: '2026-10-23', data: [entry('Kana Mori-Sample', '2026-10-23', '17:00', '20:00'), entry('Kana-Mori Sample', '2026-10-23', '20:00', '22:00')] }]);
  const t = c.STORE['tip_labor_F04-P_2026-10-23']['Kana Mori-Sample'];
  assert.equal(t.rawDinner, 5); assert.ok(!t.overlap, 'one ends when the other starts: not an overlap');
});

test('weekly labor import (Toast regular / OT hours) uses the alias and adds the two records of one person', async () => {
  const c = app(source, ['doToastLaborFetch', ...NEW]);
  c.EMPS = EMPS(); c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16' }];
  c.LIVE = [{ name: 'Kana Mori-Sample', regularHours: 10, overtimeHours: 0 }, { name: 'Kana-Mori Sample', regularHours: 25, overtimeHours: 2 }, { name: 'Aoi Example', regularHours: 8, overtimeHours: 0 }];
  c.HOURS = { 'Kana Mori-Sample': { regular: 99, ot: 9, source: 'toast', toastName: 'Kana Mori-Sample' } };   // last week's fetch of the same week
  run(c, `var TOAST_SYNC_FN = 'x', SUPABASE_ANON = 'k', laborLastFetch = null, document = { getElementById: function(){ return null; } };
    function toastFnBody(o){ return JSON.stringify(o); }
    function laborWeekRange(){ return { from: '2026-10-19', to: '2026-10-25' }; }
    async function fetch(){ return { json: async function(){ return { employees: LIVE }; } }; }
    function getLaborHours(){ return JSON.parse(JSON.stringify(HOURS)); }
    function setLaborHours(s, w, v){ HOURS = v; }
    function staffForStore(){ return getEmployees().filter(function(e){ return e.status !== '退職'; }); }
    function renderPage(){}`);
  await run(c, `doToastLaborFetch('F04-P', 'g', '2026-W43')`);
  const h = JSON.parse(JSON.stringify(c.HOURS));
  assert.deepEqual(h['Kana Mori-Sample'], { regular: 35, ot: 2, source: 'toast', toastName: 'Kana Mori-Sample', toastNames: ['Kana Mori-Sample', 'Kana-Mori Sample'] });
  assert.ok(!h['Kana-Mori Sample']);
  assert.equal(h['Aoi Example'].regular, 8);
  assert.match(c.laborLastFetch, /マスター一致2名/);
});

test('two Toast records with the employee\'s own name (or only upper / lower case different) on one day are added too', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS();
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Aoi Example', '2026-10-20', '10:00', '12:00'), entry('aoi example', '2026-10-20', '17:00', '20:00')] }]);
  const e = c.STORE['tip_labor_F04-P_2026-10-20']['Aoi Example'];
  assert.equal(e.rawDinner, 5); assert.deepEqual(e.toastNames, ['Aoi Example', 'aoi example']);
});

test('a "part of the name" match is not added to (as before, the later one is kept)', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = [{ id: 'a', name: 'Ann', status: '在籍' }];
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Ann', '2026-10-20', '10:00', '12:00'), entry('Ann Leeson', '2026-10-20', '13:00', '18:00')] }]);
  const e = c.STORE['tip_labor_F04-P_2026-10-20'].Ann;
  assert.equal(e.rawDinner, 5); assert.equal(e.toastName, 'Ann Leeson'); assert.ok(!e.toastNames);
});

test('without aliases the result is the same as before (v1110) on random synthetic days', async () => {
  let old;
  try { old = read(execFileSync('git', ['show', '337e779:index.html'], { cwd: new URL('..', import.meta.url), maxBuffer: 1 << 28 }).toString('utf8')); }
  catch (e) { assert.fail('git history is needed for this test (337e779): ' + e.message); }
  const pool = ['Aoi Example', 'Ren Placeholder', 'Kana Mori-Sample', 'Kana-Mori Sample', 'Ann', 'Ann Leeson', 'Mio', 'Order Only', 'Zed Q'];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 300; k++) {
    const rows = [];
    for (let d = 0; d < 3; d++) {
      const day = '2026-10-2' + d, data = [], used = new Set();
      const n = Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) { const nm = pool[Math.floor(rnd() * pool.length)]; if (used.has(nm.toLowerCase())) continue; used.add(nm.toLowerCase()); const a = 9 + Math.floor(rnd() * 8); data.push(entry(nm, day, a + ':00', (a + 1 + Math.floor(rnd() * 5)) + ':30')); }
      rows.push({ business_date: day, data });
    }
    const A = app(source, ['syncTipLaborFromDB', ...NEW]), B = app(old, ['syncTipLaborFromDB']);
    const emps = [{ id: 'x1', name: 'Aoi Example' }, { id: 'x2', name: 'Kana Mori-Sample' }, { id: 'x3', name: 'Ann' }, { id: 'x4', name: 'Ren Placeholder' }];
    A.EMPS = emps; B.EMPS = emps;
    await sync(A, rows); await sync(B, rows);
    assert.deepEqual(JSON.parse(JSON.stringify(A.STORE)), JSON.parse(JSON.stringify(B.STORE)), 'case ' + k);
  }
});

test('live Toast import (fetchTipLabor) uses the same alias and adding', async () => {
  const c = app(source, ['fetchTipLabor', ...NEW]);
  c.EMPS = EMPS(); c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16' }];
  run(c, `var _tipLaborFetchGen = {}, _tipLaborFetchDone = {}, TOAST_SYNC_FN = 'x', SUPABASE_ANON = 'k';
    function toastFnBody(o){ return JSON.stringify(o); }
    async function supaUpsert(){ return false; }`);
  c.EMPLOYEES_LIVE = [entry('Kana Mori-Sample', '2026-10-21', '11:00', '14:00'), entry('Kana-Mori Sample', '2026-10-21', '17:00', '21:00')];
  run(c, `async function fetch(){ return { json: async function(){ return { employees: EMPLOYEES_LIVE }; } }; }`);
  const r = await run(c, `fetchTipLabor('F04-P', 'g', '2026-10-21')`);
  assert.equal(r.count, 1);
  const e = c.STORE['tip_labor_F04-P_2026-10-21']['Kana Mori-Sample'];
  assert.equal(e.rawDinner, 7); assert.deepEqual(e.toastNames, ['Kana Mori-Sample', 'Kana-Mori Sample']);
});

test('linking rules: other active employee with that name, or someone else\'s alias, is refused; a resigned duplicate is not', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS(); c.EMPS[2].toastAliases = [{ n: 'Ren P', from: '' }];
  const p = (id, alias) => run(c, `toastAliasProblem(getEmployees().find(function(e){ return e.id==='${id}'; }), ${JSON.stringify(alias)})`);
  assert.equal(p('imp1', 'Kana-Mori Sample'), null);                                  // only the resigned e9 has that name
  assert.match(p('imp1', 'aoi-example'), /ほかの従業員/);                               // another active person's name
  assert.match(p('imp1', 'Ren  P'), /別名に入っています/);                              // already someone else's alias
  assert.match(p('imp1', ''), /入れてください/);
  c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16' }];
  assert.match(p('imp1', 'kana mori sample'), /もう入っています/);
});

test('candidates: same letters first, resigned people never; preview counts days from the chosen start', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  const cand = run(c, `toastNameCandidates('Kana-Mori Sample').map(function(x){ return [x.emp.id, x.same]; })`);
  assert.deepEqual(JSON.parse(JSON.stringify(cand)), [['imp1', true]]);
  assert.equal(run(c, `toastNameCandidates('Zzz Unknown').length`), 0);
  const pv = run(c, `JSON.stringify([_toastLinkPreview({byDate:{'2026-10-15':3,'2026-10-20':4,'2026-10-21':2.5}}, '2026-10-16'), _toastLinkPreview({byDate:{'2026-10-15':3,'2026-10-20':4}}, '')])`);
  assert.deepEqual(JSON.parse(pv), [{ days: 2, hours: 6.5 }, { days: 2, hours: 7 }]);
});

test('the unregistered list leaves out names that are linked, and keeps hours per day for the preview', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  c.STORE['tip_labor_F04-P_2026-10-20'] = { 'Kana-Mori Sample': { rawLunch: 0, rawDinner: 4, toastName: 'Kana-Mori Sample' }, 'New Person': { rawLunch: 1, rawDinner: 2, toastName: 'New Person' } };
  let list = JSON.parse(JSON.stringify(run(c, `unregisteredClockIns(3650)`)));
  assert.deepEqual(list.map(x => x.name).sort(), ['Kana-Mori Sample', 'New Person']);
  assert.deepEqual(list.find(x => x.name === 'New Person').byDate, { '2026-10-20': 3 });
  c.EMPS[1].toastAliases = [{ n: 'Kana-Mori Sample', from: '2026-10-16' }];
  list = JSON.parse(JSON.stringify(run(c, `unregisteredClockIns(3650)`)));
  assert.deepEqual(list.map(x => x.name), ['New Person']);
});

test('employee editor: only what this screen added / removed is put on the current record (an alias added on another device stays)', () => {
  const c = app(source, [...NEW, 'empAliasMerge']);
  c.EMPS = EMPS();
  c.EMPS[1].toastAliases = [{ n: 'K Sample', from: '2026-10-01' }, { n: 'Kana M', from: '2026-10-16' }];   // 'Kana M' was added on another device
  const orig = [{ n: 'K Sample', from: '2026-10-01' }];
  const now = [{ n: 'Kana-Mori Sample', from: '2026-10-16', via: 'emp' }];          // this screen removed 'K Sample' and added one
  const r = JSON.parse(JSON.stringify(run(c, `empAliasMerge(getEmployees()[1], ${JSON.stringify(orig)}, ${JSON.stringify(now)})`)));
  assert.deepEqual(r.after.map(a => a.n), ['Kana M', 'Kana-Mori Sample']);
  assert.deepEqual(r.before.map(a => a.n), ['K Sample', 'Kana M']);
  c.EMPS[3].toastAliases = [{ n: 'kana mori sample', from: '' }];                     // meanwhile linked to someone else
  const p = JSON.parse(JSON.stringify(run(c, `empAliasMerge(getEmployees()[1], ${JSON.stringify(orig)}, ${JSON.stringify(now)})`)));
  assert.match(p.problem, /Ren Placeholder/);
  c.EMPS[1].toastName = 'Legacy Name'; c.EMPS[3].toastAliases = [];
  const q = JSON.parse(JSON.stringify(run(c, `empAliasMerge(getEmployees()[1], ${JSON.stringify(orig.concat([{ n: 'Legacy Name', from: '', via: 'legacy' }]))}, ${JSON.stringify(now)})`)));
  assert.deepEqual(q.after.map(a => a.n), ['Kana M', 'Kana-Mori Sample']);                // the old single field was removed on this screen
});

test('old single toastName field is read as an alias for all days', () => {
  const c = app(source, NEW);
  const a = JSON.parse(JSON.stringify(run(c, `empToastAliases({ toastName: 'Old Name', toastAliases: [{ n: 'New Name', from: '2026-10-16' }, { n: '' }, null] })`)));
  assert.deepEqual(a.map(x => [x.n, x.from, x.via]), [['New Name', '2026-10-16', ''], ['Old Name', '', 'legacy']]);
});

test('release markers are 1111 or later and the same', () => {
  const v = /const APP_VERSION = '(\d+)';/.exec(source)[1], sw = /const SW_BUILD = '(\d+)';/.exec(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))[1];
  assert.equal(v, sw); assert.ok(Number(v) >= 1111);
});

test('who can link: CEO / GM / AM / accounting; an AM only punches of their stores and people of their stores', () => {
  const c = app(source, [...NEW, 'toastLinkItemOk', 'empAliasCanEdit']);
  c.EMPS = EMPS(); c.EMPS.push({ id: 'imp7', name: 'Far Away', status: '在籍', store: 'F01', support: [] }, { id: 'imp8', name: 'Helps Here', status: '在籍', store: 'F01', support: ['F04-P'] });
  run(c, `function myAmStores(){ return ['F04-P']; }`);
  const can = (role, code) => { c.curRole = role; return run(c, code); };
  for (const r of ['ceo', 'gm', 'office']) {
    assert.equal(can(r, `toastLinkItemOk({ stores:['F01'] })`), true, r);
    assert.equal(can(r, `empAliasCanEdit(getEmployees()[4])`), true, r);
  }
  for (const r of ['sl', 'crew', 'g4', 'office_crew']) assert.equal(can(r, `toastLinkItemOk({ stores:['F04-P'] })`), false, r);
  assert.equal(can('am', `toastLinkItemOk({ stores:['F01'] })`), false);
  assert.equal(can('am', `toastLinkItemOk({ stores:['F01','F04-P'] })`), true);
  assert.equal(can('am', `empAliasCanEdit(getEmployees()[4])`), false);   // another store only
  assert.equal(can('am', `empAliasCanEdit(getEmployees()[5])`), true);    // helps at the AM's store
  assert.equal(can('am', `empAliasCanEdit(getEmployees()[1])`), true);
});
