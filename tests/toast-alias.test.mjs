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

const NEW = ['toastNameKey', 'toastAliasField', '_toastAliasRec', 'empToastAliases', 'toastAliasIndex', 'toastAliasFind', 'toastAliasResolve', '_toastShiftsOverlap', 'tipLaborPut',
  '_toastNameTokens', 'toastNameCandidates', 'toastNameOwnerNow', 'toastAliasMovesFrom', 'toastAliasProblem', 'toastLinkCan', 'toastLinkItemOk', 'empAliasCanEdit',
  'toastLinkPeriodStart', 'toastLinkEarliest', '_toastLinkPreview', 'unregisteredClockIns', 'empAliasChanges', '_empAliasProbe',
  'toastAliasStamps', '_toastPrevMonthStart', 'toastAliasCatchUp', 'tipPeriodStartOf',
  'toastAliasCovers', 'toastAliasScope', 'toastAliasEntries', '_toastLinkByDate', '_empAliasGroups', '_empAliasRemovable'];
function app(src, names) {
  const c = { console, STORE: {}, EMPS: [], ROWS: [], SYNCS: [], SYNC_FAIL: false, TODAY: '2026-10-29', curRole: 'gm', curRealRole: 'gm', curUserName: 'Am Sample', Object, JSON, Math, Date, String, Array, Number, Promise };
  vm.createContext(c);
  vm.runInContext(names.map(n => pick(src, n)).join('\n') + `
    var _tipLaborSeq = 0, _tipLaborSaved = {};
    var TOAST_ALIAS_SEEN = '_toast_alias_seen_v1', _toastAliasCatchQ = Promise.resolve();
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
    function ls(k, d){ return _lsRaw(k, d); }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); }
    function _laborHrs(e){ return (+e.rawLunch||0) + (+e.rawDinner||0); }
    function isoOf(d){ return '2026-10-01'; }
    function bizToday(){ return TODAY; }
    function myAmStores(){ return ['F04-P']; }
    function getVisibleStores(){ return [{ id: 'F04-P', toastGuid: 'g4p' }, { id: 'F01', toastGuid: 'g1' }, { id: 'F06' }]; }
    function t(ja){ return ja; }`, c);
  if (!names.includes('syncTipLaborFromDB'))
    vm.runInContext(`async function syncTipLaborFromDB(id, guid, days){ SYNCS.push([id, days[0].date, days[days.length-1].date]); return SYNC_FAIL ? { fetchErr: true } : { updated: 1 }; }`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const plain = (v) => JSON.parse(JSON.stringify(v));
const entry = (name, d, a, b) => ({ name, lunchHours: 0, dinnerHours: (Date.parse(H(d, b)) - Date.parse(H(d, a))) / 3600000, shifts: [{ inDate: H(d, a), outDate: H(d, b) }] });
const al = (n, from, extra) => Object.assign({ n, from, at: '2026-10-29T00:00:00Z', by: 'GM', via: 'unreg' }, extra || {});
const fld = (n) => 'toastAlias_' + n.normalize('NFKC').toLowerCase().replace(/[\s\-.,'_]/g, '');
const EMPS = () => [
  { id: 'e9', name: 'Kana Mori-Sample', status: '退職', store: 'F04-P' },      // the duplicate that was resigned (sorts first)
  { id: 'imp1', name: 'Kana Mori-Sample', status: '在籍', store: 'F04-P' },
  { id: 'imp2', name: 'Aoi Example', status: '在籍', store: 'F04-P' },
  { id: 'imp3', name: 'Ren Placeholder', status: '在籍', store: 'F04-P' },
];
const linkKana = (emps, from = '2026-10-16') => { emps[1][fld('Kana-Mori Sample')] = al('Kana-Mori Sample', from); return emps; };
async function sync(c, rows, store = 'F04-P') { c.ROWS = rows; return run(c, `syncTipLaborFromDB('${store}', 'g', [{date:'${rows[0].business_date}'},{date:'${rows[rows.length - 1].business_date}'}])`); }

test('a Toast name that differs only in hyphens is not matched without an alias (as before)', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS();
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Kana-Mori Sample', '2026-10-20', '17:00', '20:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-20']), ['Kana-Mori Sample']);
});

test('with an alias from 10/16, the punches from 10/16 count as the employee; earlier days do not', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = linkKana(EMPS());
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

test('a removed alias (off) no longer counts', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS(); c.EMPS[1][fld('Kana-Mori Sample')] = al('Kana-Mori Sample', '2026-10-16', { off: true });
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Kana-Mori Sample', '2026-10-20', '17:00', '21:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-20']), ['Kana-Mori Sample']);
  assert.deepEqual(plain(run(c, 'empToastAliases(getEmployees()[1])')), []);
});

test('two punches of the same person on one day are added (4A); overlap is marked and still counted', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = linkKana(EMPS());
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
  const t2 = c.STORE['tip_labor_F04-P_2026-10-23']['Kana Mori-Sample'];
  assert.equal(t2.rawDinner, 5); assert.ok(!t2.overlap, 'one ends when the other starts: not an overlap');
});

test('review P3-1: only one of the two has punch times: the times are not kept, so re-reading does not drop the other hours', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = linkKana(EMPS());
  const noTimes = { name: 'Kana-Mori Sample', lunchHours: 2, dinnerHours: 0 };
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Kana Mori-Sample', '2026-10-20', '17:00', '20:00'), noTimes] }]);
  const e = c.STORE['tip_labor_F04-P_2026-10-20']['Kana Mori-Sample'];
  assert.deepEqual(plain(e.shifts), []);
  assert.equal(e.lunch + e.dinner, 5); assert.equal(e.rawLunch + e.rawDinner, 5);
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

test('review P2-1: a person who came back under a new record: the old (resigned) name goes to the new record from the alias date', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = [{ id: 'old', name: 'Kai Return', status: '退職' }, { id: 'new', name: 'Kai R Sample', status: '在籍' }];
  c.EMPS[1][fld('Kai Return')] = al('Kai Return', '2026-10-16');
  await sync(c, [{ business_date: '2026-10-10', data: [entry('Kai Return', '2026-10-10', '10:00', '12:00')] }, { business_date: '2026-10-20', data: [entry('Kai Return', '2026-10-20', '10:00', '13:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-10']), ['Kai Return'], 'before the alias date: as before');
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-20']), ['Kai R Sample']);
  // an active person with exactly that name still keeps it
  c.EMPS[0].status = '在籍';
  await sync(c, [{ business_date: '2026-10-21', data: [entry('Kai Return', '2026-10-21', '10:00', '13:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-21']), ['Kai Return']);
});

test('the same alias on two active people (two devices at the same time): not linked to either', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = linkKana(EMPS()); c.EMPS[3][fld('Kana-Mori Sample')] = al('Kana-Mori Sample', '2026-10-16');
  await sync(c, [{ business_date: '2026-10-20', data: [entry('Kana-Mori Sample', '2026-10-20', '17:00', '21:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-20']), ['Kana-Mori Sample']);
  // a resigned person and an active person with the same alias: the active person
  c.EMPS[3].status = '退職';
  await sync(c, [{ business_date: '2026-10-21', data: [entry('Kana-Mori Sample', '2026-10-21', '17:00', '21:00')] }]);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-21']), ['Kana Mori-Sample']);
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
    const emps = [{ id: 'x1', name: 'Aoi Example' }, { id: 'x2', name: 'Kana Mori-Sample', status: k % 2 ? '退職' : '在籍' }, { id: 'x3', name: 'Ann' }, { id: 'x4', name: 'Ren Placeholder' }];
    A.EMPS = emps; B.EMPS = emps;
    await sync(A, rows); await sync(B, rows);
    assert.deepEqual(plain(A.STORE), plain(B.STORE), 'case ' + k);
  }
});

test('live Toast import (fetchTipLabor) uses the same alias and adding', async () => {
  const c = app(source, ['fetchTipLabor', ...NEW]);
  c.EMPS = linkKana(EMPS());
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

test('linking rules: another active employee\'s name or alias is refused; a resigned person\'s name or alias is not', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS(); c.EMPS[2][fld('Ren P')] = al('Ren P', '');
  c.EMPS.push({ id: 'gone', name: 'Old Timer', status: '退職', [fld('Mio K')]: al('Mio K', '') });
  const p = (id, alias) => run(c, `toastAliasProblem(getEmployees().find(function(e){ return e.id==='${id}'; }), ${JSON.stringify(alias)})`);
  assert.equal(p('imp1', 'Kana-Mori Sample'), null);                                  // only the resigned e9 has that name
  assert.match(p('imp1', 'aoi-example'), /ほかの従業員/);                               // another active person's name
  assert.match(p('imp1', 'Ren  P'), /別名に入っています/);                              // already someone else's alias
  assert.equal(p('imp1', 'mio k'), null);                                              // a resigned person's alias does not block
  assert.match(p('imp1', ''), /入れてください/);
  c.EMPS = linkKana(c.EMPS);
  assert.match(p('imp1', 'kana mori sample'), /もう入っています/);
});

test('review P1-1: an alias that would take punches from another active person (part of the name) is asked first; an AM cannot take them from outside their stores', () => {
  const c = app(source, NEW);
  c.EMPS = [{ id: 'ann', name: 'Ann', status: '在籍', store: 'F01', support: [] }, { id: 'bob', name: 'Bob Example', status: '在籍', store: 'F04-P', support: [] }, { id: 'cy', name: 'Cy', status: '在籍', store: 'F04-P', support: [] }];
  assert.equal(run(c, `toastAliasMovesFrom(getEmployees()[1], 'Ann Leeson').id`), 'ann');
  assert.equal(run(c, `toastAliasMovesFrom(getEmployees()[1], 'Zed Q')`), null);
  assert.equal(run(c, `toastAliasProblem(getEmployees()[1], 'Ann Leeson')`), null, 'GM: asked in the screen, not refused');
  c.curRole = 'am'; c.curRealRole = 'am';
  assert.match(run(c, `toastAliasProblem(getEmployees()[1], 'Ann Leeson')`), /担当外/);
  assert.equal(run(c, `toastAliasProblem(getEmployees()[1], 'Cy Long')`), null, 'from a person of the AM\'s own store: asked, not refused');
  assert.equal(run(c, `toastAliasMovesFrom(getEmployees()[1], 'Cy Long').id`), 'cy');
});

test('candidates: same letters first, resigned people never; preview counts days from the chosen start', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  const cand = run(c, `toastNameCandidates('Kana-Mori Sample').map(function(x){ return [x.emp.id, x.same]; })`);
  assert.deepEqual(plain(cand), [['imp1', true]]);
  assert.equal(run(c, `toastNameCandidates('Zzz Unknown').length`), 0);
  const pv = run(c, `JSON.stringify([_toastLinkPreview({byDate:{'2026-10-15':3,'2026-10-20':4,'2026-10-21':2.5}}, '2026-10-16'), _toastLinkPreview({byDate:{'2026-10-15':3,'2026-10-20':4}}, '2026-10-01')])`);
  assert.deepEqual(JSON.parse(pv), [{ days: 2, hours: 6.5 }, { days: 2, hours: 7 }]);
  assert.equal(run(c, `toastLinkEarliest({byDate:{'2026-10-20':1,'2026-09-29':2}})`), '2026-09-16');
  assert.equal(run(c, `toastLinkPeriodStart()`), '2026-10-16');
});

test('the unregistered list leaves out names that are linked, and keeps hours per day for the preview', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  c.STORE['tip_labor_F04-P_2026-10-20'] = { 'Kana-Mori Sample': { rawLunch: 0, rawDinner: 4, toastName: 'Kana-Mori Sample' }, 'New Person': { rawLunch: 1, rawDinner: 2, toastName: 'New Person' } };
  let list = plain(run(c, `unregisteredClockIns(3650)`));
  assert.deepEqual(list.map(x => x.name).sort(), ['Kana-Mori Sample', 'New Person']);
  assert.deepEqual(list.find(x => x.name === 'New Person').byDate, { '2026-10-20': 3 });
  c.EMPS = linkKana(c.EMPS);
  list = plain(run(c, `unregisteredClockIns(3650)`));
  assert.deepEqual(list.map(x => x.name), ['New Person']);
});

test('employee editor: only what this screen added / removed is written, each alias in its own field (another device\'s alias is not touched)', () => {
  const c = app(source, NEW);
  const orig = [al('K Sample', '2026-10-01'), al('Kana M', '2026-10-16')];
  const now = [al('Kana M', '2026-10-16'), al('Kana-Mori Sample', '2026-10-16', { via: 'emp' })];
  const ch = plain(run(c, `empAliasChanges(${JSON.stringify(orig)}, ${JSON.stringify(now)})`));
  assert.deepEqual(ch.add.map(a => a.n), ['Kana-Mori Sample']);
  assert.deepEqual(ch.remove.map(a => a.n), ['K Sample']);
  assert.deepEqual(plain(run(c, `empAliasChanges(${JSON.stringify(orig)}, ${JSON.stringify(orig)})`)), { add: [], remove: [] });
  assert.equal(run(c, `toastAliasField('Kana-Mori Sample')`), run(c, `toastAliasField('kana mori sample')`));
  assert.notEqual(run(c, `toastAliasField('Kana M')`), run(c, `toastAliasField('Kana-Mori Sample')`));
  const probe = plain(run(c, `_empAliasProbe({ id:'x', name:'X', toastAlias_old:{ n:'Old', from:'' } }, [{ n:'New One', from:'2026-10-16' }])`));
  assert.deepEqual(Object.keys(probe).sort(), ['id', 'name', 'toastAlias_newone']);
});

test('the old single toastName field is not taken as an alias (nothing changes for records that have it)', () => {
  const c = app(source, NEW);
  assert.deepEqual(plain(run(c, `empToastAliases({ toastName: 'Old Name', toastAlias_x: { n: '' }, toastAlias_y: null, other: { n: 'Z' } })`)), []);
});

test('review P2-2: who can link: CEO / GM / AM / accounting (not a Store Manager); an AM only punches and people of their stores', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS(); c.EMPS.push({ id: 'imp7', name: 'Far Away', status: '在籍', store: 'F01', support: [] }, { id: 'imp8', name: 'Helps Here', status: '在籍', store: 'F01', support: ['F04-P'] });
  const can = (role, real, code) => { c.curRole = role; c.curRealRole = real; return run(c, code); };
  for (const r of ['ceo', 'gm', 'office']) {
    assert.equal(can(r, r, `toastLinkItemOk({ stores:['F01'] })`), true, r);
    assert.equal(can(r, r, `empAliasCanEdit(getEmployees()[4])`), true, r);
  }
  for (const r of ['sl', 'crew', 'office_crew']) assert.equal(can(r, r, `toastLinkItemOk({ stores:['F04-P'] })`), false, r);
  assert.equal(can('am', 'g4', `toastLinkCan()`), false, 'Store Manager (G4 shows as am)');
  assert.equal(can('am', 'g4', `toastLinkItemOk({ stores:['F04-P'] })`), false);
  assert.equal(can('am', 'am', `toastLinkItemOk({ stores:['F01'] })`), false);
  assert.equal(can('am', 'am', `toastLinkItemOk({ stores:['F01','F04-P'] })`), true, 'allowed, but only the F04-P punches are linked (see the Codex P1 test below)');
  assert.equal(can('am', 'am', `empAliasCanEdit(getEmployees()[4])`), false);   // another store only
  assert.equal(can('am', 'am', `empAliasCanEdit(getEmployees()[5])`), true);    // helps at the AM's store
  assert.equal(can('am', 'am', `empAliasCanEdit(getEmployees()[1])`), true);
});

test('review P2-4: after a link or removal (also made on another device), this device re-reads attendance of its stores from the alias date, once', async () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  let r = plain(await run(c, 'toastAliasCatchUp()'));
  assert.equal(r.ran, false); assert.deepEqual(c.SYNCS, []);
  c.EMPS = linkKana(c.EMPS, '2026-10-01');
  r = plain(await run(c, 'toastAliasCatchUp()'));
  assert.equal(r.ran, true);
  assert.deepEqual(plain(c.SYNCS), [['F04-P', '2026-10-01', '2026-10-29'], ['F01', '2026-10-01', '2026-10-29']], 'only stores with Toast, from the alias date to today');
  c.SYNCS.length = 0;
  r = plain(await run(c, 'toastAliasCatchUp()'));
  assert.equal(r.ran, false, 'already re-read');
  // removed on another device: the field becomes off with a new time
  c.EMPS[1][fld('Kana-Mori Sample')] = al('Kana-Mori Sample', '2026-09-16', { off: true, at: '2026-10-30T00:00:00Z' });
  c.TODAY = '2026-11-02';
  c.SYNC_FAIL = true;
  r = plain(await run(c, 'toastAliasCatchUp()'));
  assert.equal(r.fail, 2);
  assert.deepEqual(plain(c.SYNCS[0]), ['F04-P', '2026-10-01', '2026-11-02'], 'not before the 1st of the previous month');
  c.SYNCS.length = 0; c.SYNC_FAIL = false;
  r = plain(await run(c, 'toastAliasCatchUp()'));
  assert.equal(r.ran, true, 'could not read last time: tried again');
  c.SYNCS.length = 0;
  assert.equal(plain(await run(c, 'toastAliasCatchUp()')).ran, false);
  assert.equal(run(c, `_toastPrevMonthStart('2026-01-05')`), '2025-12-01');
});

test('the labor import, the sign-in sync and the save of the employee editor are wired to the alias', () => {
  assert.match(source, /var _r = toastAliasResolve\(m, emp\.name, _bdA, _aidx, storeId\);/);
  assert.match(source, /var _r = toastAliasResolve\(m, emp\.name, date, _aidx, storeId\);/);
  assert.match(source, /try \{ await toastAliasCatchUp\(\); \} catch\(e\)\{ console\.warn\('toastAliasCatchUp', e\); \}\n    markSynced\('ops'\);/);
  assert.match(source, /var _alC = empAliasChanges\(_alF\.aliasOrig, _alF\.aliases\);/);
  assert.match(source, /var f = a\.f\|\|toastAliasField\(a\.n, a\.store\); data\[f\] = \{ n:a\.n, from:a\.from\|\|'', at:_alNow, by:curUserName\|\|'', via:a\.via\|\|'', off:true \}; if \(a\.store\) data\[f\]\.store = a\.store;/);
  assert.match(source, /var _alOut = _alC\.add\.concat\(_alC\.remove\)\.find\(function\(a\)\{ return curRole==='am' && !_empAliasRemovable\(a\); \}\);/);
  assert.match(source, /toastAliasEntries\(target, alias, from, 'unreg', sc\)\.forEach/);
  assert.match(source, /F\.aliases=F\.aliases\.concat\(toastAliasEntries\(probe, v, ps, 'emp', sc\)\);/);
  assert.match(source, /Toast: \$\{escapeHtml\(e\.toastName\)\}/);
});

test('release markers are 1111 or later and the same', () => {
  const v = /const APP_VERSION = '(\d+)';/.exec(source)[1], sw = /const SW_BUILD = '(\d+)';/.exec(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))[1];
  assert.equal(v, sw); assert.ok(Number(v) >= 1111);
});

// Codex review of 62339b9 (P1): the same Toast name punched at an AM's store (F04-P) and at a store outside (F01).
// The AM may link it, but only for their stores: attendance and tips at F01 must not change.
const KANA = 'Kana-Mori Sample';
const rowsAt = (d) => [{ business_date: d, data: [entry(KANA, d, '17:00', '21:00')] }];
async function importAt(c, store, d) { await sync(c, rowsAt(d), store); return plain(c.STORE['tip_labor_' + store + '_' + d]); }

test('Codex P1 (62339b9): an AM links a name punched at their store and outside: only their store changes; the other store is the same as with no alias', async () => {
  const before = app(source, ['syncTipLaborFromDB', ...NEW]);
  before.EMPS = EMPS();
  const f01Before = await importAt(before, 'F01', '2026-10-20');
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS(); c.curRole = 'am'; c.curRealRole = 'am';
  const sc = plain(run(c, 'toastAliasScope()'));
  assert.deepEqual(sc, ['F04-P']);
  assert.equal(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, toastAliasScope())`), null);
  const ents = plain(run(c, `toastAliasEntries(getEmployees()[1], ${JSON.stringify(KANA)}, '2026-10-16', 'unreg', toastAliasScope())`));
  assert.deepEqual(ents.map(a => [a.store, a.f]), [['F04-P', fld(KANA) + '@F04-P']]);
  ents.forEach(a => { c.EMPS[1][a.f] = { n: a.n, from: a.from, at: a.at, by: a.by, via: a.via, store: a.store }; });
  const p = await importAt(c, 'F04-P', '2026-10-20');
  assert.deepEqual(Object.keys(p), ['Kana Mori-Sample'], 'the AM\'s store: linked');
  const o = await importAt(c, 'F01', '2026-10-20');
  assert.deepEqual(o, f01Before, 'the store outside: exactly as with no alias');
  assert.deepEqual(Object.keys(o), [KANA]);
  // the live Toast import too
  run(c, `var _tipLaborFetchGen = {}, _tipLaborFetchDone = {}, TOAST_SYNC_FN = 'x', SUPABASE_ANON = 'k';
    function toastFnBody(o){ return JSON.stringify(o); }
    async function supaUpsert(){ return false; }
    async function fetch(){ return { json: async function(){ return { employees: LIVE }; } }; }`);
  vm.runInContext(pick(source, 'fetchTipLabor'), c);
  c.LIVE = [entry(KANA, '2026-10-21', '17:00', '21:00')];
  await run(c, `fetchTipLabor('F01', 'g', '2026-10-21')`);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F01_2026-10-21']), [KANA]);
  await run(c, `fetchTipLabor('F04-P', 'g', '2026-10-21')`);
  assert.deepEqual(Object.keys(c.STORE['tip_labor_F04-P_2026-10-21']), ['Kana Mori-Sample']);
});

test('Codex P1 (62339b9): a store alias needs the field name to match its store; a GM link counts at every store', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS();
  c.EMPS[1][fld(KANA) + '@F01'] = al(KANA, '2026-10-16', { store: 'F04-P' });   // field says F01, record says F04-P: not used
  c.EMPS[1][fld(KANA)] = al(KANA, '2026-10-16', { store: 'F04-P' });            // a store record in the all-stores field: not used
  assert.deepEqual(plain(run(c, 'empToastAliases(getEmployees()[1])')), []);
  c.EMPS = EMPS(); c.EMPS[1][fld(KANA)] = al(KANA, '2026-10-16');                // GM (all stores)
  assert.deepEqual(Object.keys(await importAt(c, 'F01', '2026-10-20')), ['Kana Mori-Sample']);
  assert.deepEqual(Object.keys(await importAt(c, 'F04-P', '2026-10-20')), ['Kana Mori-Sample']);
  assert.equal(run(c, `toastAliasField('a@b', 'F01')`), 'toastAlias_ab@F01', 'an @ in a Toast name cannot look like a store');
});

test('Codex P1 (62339b9): the unregistered list keeps the punches of the store outside after an AM links the name for their store', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  c.STORE['tip_labor_F04-P_2026-10-20'] = { [KANA]: { rawLunch: 0, rawDinner: 4, toastName: KANA } };
  c.STORE['tip_labor_F01_2026-10-21'] = { [KANA]: { rawLunch: 1, rawDinner: 2, toastName: KANA } };
  let list = plain(run(c, `unregisteredClockIns(3650)`));
  assert.deepEqual(list[0].stores.sort(), ['F01', 'F04-P']); assert.equal(list[0].hours, 7);
  c.EMPS[1][fld(KANA) + '@F04-P'] = al(KANA, '2026-10-16', { store: 'F04-P' });
  list = plain(run(c, `unregisteredClockIns(3650)`));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].stores, ['F01']); assert.equal(list[0].hours, 3); assert.equal(list[0].days, 1);
  assert.deepEqual(list[0].byDate, { '2026-10-21': 3 }); assert.equal(list[0].last, '2026-10-21');
  c.EMPS[1][fld(KANA)] = al(KANA, '2026-10-16');                                  // then a GM links it for all stores
  assert.deepEqual(plain(run(c, `unregisteredClockIns(3650)`)), []);
});

test('Codex P1 (62339b9): the link screen counts only the AM\'s stores', () => {
  const c = app(source, NEW);
  const item = { byDate: { '2026-09-29': 2, '2026-10-20': 4, '2026-10-21': 3 }, per: { 'F04-P': { byDate: { '2026-10-20': 4 } }, F01: { byDate: { '2026-09-29': 2, '2026-10-21': 3 } } } };
  assert.deepEqual(plain(run(c, `_toastLinkPreview(${JSON.stringify(item)}, '2026-10-16', null)`)), { days: 2, hours: 7 });
  assert.deepEqual(plain(run(c, `_toastLinkPreview(${JSON.stringify(item)}, '2026-10-16', ['F04-P'])`)), { days: 1, hours: 4 });
  assert.equal(run(c, `toastLinkEarliest(${JSON.stringify(item)}, null)`), '2026-09-16');
  assert.equal(run(c, `toastLinkEarliest(${JSON.stringify(item)}, ['F04-P'])`), '2026-10-16');
});

test('Codex P1 (62339b9): an AM cannot remove or overwrite an all-stores alias, nor another store\'s; linking rules look at the same stores only', () => {
  const c = app(source, NEW);
  c.curRole = 'am'; c.curRealRole = 'am';
  assert.equal(run(c, `_empAliasRemovable({ n:'A', store:'' })`), false, 'an all-stores alias (made by GM / CEO / accounting)');
  assert.equal(run(c, `_empAliasRemovable({ n:'A', store:'F01' })`), false, 'another store');
  assert.equal(run(c, `_empAliasRemovable({ n:'A', store:'F04-P' })`), true);
  c.curRole = 'gm'; c.curRealRole = 'gm';
  assert.equal(run(c, `_empAliasRemovable({ n:'A', store:'' })`), true);
  // another person's alias at F01 only does not block an AM of F04-P, but blocks a GM (all stores)
  c.EMPS = EMPS(); c.EMPS[3][fld(KANA) + '@F01'] = al(KANA, '2026-10-16', { store: 'F01' });
  assert.match(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, null)`), /別名に入っています/);
  assert.equal(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, ['F04-P'])`), null);
  assert.match(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, ['F01','F04-P'])`), /別名に入っています/);
  // already linked: an all-stores alias covers an AM's stores; a store alias does not stop a GM from adding the all-stores one
  c.EMPS = EMPS(); c.EMPS[1][fld(KANA) + '@F04-P'] = al(KANA, '2026-10-16', { store: 'F04-P' });
  assert.match(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, ['F04-P'])`), /もう入っています/);
  assert.equal(run(c, `toastAliasProblem(getEmployees()[1], ${JSON.stringify(KANA)}, null)`), null);
  assert.equal(run(c, `toastAliasEntries(getEmployees()[1], ${JSON.stringify(KANA)}, '2026-10-16', 'emp', ['F04-P','F06']).map(function(a){ return a.store; }).join()`), 'F06', 'only stores not covered yet');
  assert.match(run(c, `toastAliasProblem(getEmployees()[1], 'New Name', [])`), /担当の店がありません/);
  // the editor: rows group the store aliases added together; changes are per field
  const list = [al(KANA, '2026-10-16', { store: 'F04-P', f: fld(KANA) + '@F04-P' }), al(KANA, '2026-10-16', { store: 'F06', f: fld(KANA) + '@F06' }), al('K M', '2026-10-01', { f: fld('K M') })];
  const g = plain(run(c, `_empAliasGroups(${JSON.stringify(list)})`));
  assert.deepEqual(g.map(x => [x.n, x.global, x.stores, x.idx]), [[KANA, false, ['F04-P', 'F06'], [0, 1]], ['K M', true, [], [2]]]);
  const ch = plain(run(c, `empAliasChanges(${JSON.stringify(list)}, ${JSON.stringify([list[1], list[2]])})`));
  assert.deepEqual(ch.remove.map(a => a.f), [fld(KANA) + '@F04-P']); assert.deepEqual(ch.add, []);
});

// Independent review of 7d234a4 (Claude, another agent)
test('review P3-1 (7d234a4): two people\'s aliases meet at one store (saved at the same time on two devices): the punch counts for nobody there, and it stays in the unregistered list', async () => {
  const c = app(source, ['syncTipLaborFromDB', ...NEW]);
  c.EMPS = EMPS();
  c.EMPS[1][fld(KANA) + '@F04-P'] = al(KANA, '2026-10-16', { store: 'F04-P' });   // an AM, for her store
  c.EMPS[3][fld(KANA)] = al(KANA, '2026-10-16');                                  // a GM, for another person, all stores
  assert.deepEqual(Object.keys(await importAt(c, 'F04-P', '2026-10-20')), [KANA], 'not linked to either at F04-P');
  assert.deepEqual(Object.keys(await importAt(c, 'F01', '2026-10-20')), ['Ren Placeholder'], 'only the all-stores alias at F01');
  c.STORE = {};
  c.STORE['tip_labor_F04-P_2026-10-20'] = { [KANA]: { rawLunch: 0, rawDinner: 4, toastName: KANA } };
  c.STORE['tip_labor_F01_2026-10-21'] = { [KANA]: { rawLunch: 0, rawDinner: 3, toastName: KANA } };
  const list = plain(run(c, `unregisteredClockIns(3650)`));
  assert.equal(list.length, 1); assert.deepEqual(list[0].stores, ['F04-P']); assert.equal(list[0].hours, 4);
  // a resigned person's alias and an active person's alias at the same store: the active one (as in the import)
  c.EMPS[3].status = '退職';
  assert.deepEqual(plain(run(c, `unregisteredClockIns(3650)`)), []);
});

test('review P3-2 (7d234a4): a store ID with a space (the store master takes free text) still works for a store alias', () => {
  const c = app(source, NEW);
  c.EMPS = EMPS();
  const ents = plain(run(c, `toastAliasEntries(getEmployees()[1], ${JSON.stringify(KANA)}, '2026-10-16', 'unreg', ['F04-P', 'F07 Kapolei'])`));
  ents.forEach(a => { c.EMPS[1][a.f] = { n: a.n, from: a.from, at: a.at, by: a.by, via: a.via, store: a.store }; });
  const got = plain(run(c, 'empToastAliases(getEmployees()[1]).map(function(a){ return a.store; })'));
  assert.deepEqual(got.sort(), ['F04-P', 'F07 Kapolei']);
  assert.equal(run(c, `toastAliasCovers(getEmployees()[1], toastNameKey(${JSON.stringify(KANA)}), 'F07 Kapolei')`), true);
  c.EMPS[1][fld(KANA) + '@ F01'] = al(KANA, '2026-10-16', { store: ' F01' });          // spaces around: not used
  assert.equal(plain(run(c, 'empToastAliases(getEmployees()[1]).length')), 2);
});
