// v1120 (request 10/30 ④): the "unregistered punches" list also shows
//   - punches that went to a resigned employee's record (the Toast name is the same as the resigned record, the day is after the resign date),
//   - punches the import put on another person because part of the name matches,
// and it leaves out Toast's own accounts with the same rule as the ops-bot (Toast Generic Login at every store, Server Default at LaLa F06).
// The import, the attendance rows and the tip data are not changed. Runs the real functions from index.html in a VM with synthetic names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.PUNCH_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const { isBotSystemAccount } = await import('../supabase/functions/ops-bot/handler.mjs');
function pick(src, name) {
  for (const head of ['\nfunction ' + name + '(', '\nasync function ' + name + '(']) {
    const start = src.indexOf(head);
    if (start < 0) continue;
    const end = src.indexOf('\n}', start + 1);
    return src.slice(start + 1, end + 2);
  }
  assert.fail('missing ' + name);
}
const NAMES = ['toastNameKey', 'toastAliasCovers', 'toastAliasField', '_toastAliasRec', 'empToastAliases', 'toastAliasIndex', 'toastAliasFind', 'toastAliasResolve', '_toastShiftsOverlap', 'tipLaborPut',
  'syncTipLaborFromDB', 'isOrderOnlyAccount', 'ceIsSystemAccount', 'unregisteredClockIns', '_toastNameTokens', 'toastNameCandidates', 'toastLinkCan', 'toastLinkItemOk',
  'toastLinkStoreName', 'renderUnregisteredCard', 'escapeHtml', 't', 'openToastLinkModal', 'empAliasCanEdit', 'toastAliasScope', 'toastLinkPeriodStart',
  'tipPeriodStartOf', 'toastLinkEarliest', '_toastLinkPreview', '_toastLinkByDate'];
const HAS_NEW = source.includes('\nfunction toastSystemAccount(');
function app() {
  const c = { console, STORE: {}, EMPS: [], ROWS: [], TOASTS: [], MODAL: {}, SEL: { options: [], value: '' }, curRole: 'gm', curRealRole: 'gm', curLang: 'ja', window: {}, Object, JSON, Math, Date, String, Array, Number, Promise,
    STORES: [{ id: 'F01', name: 'Store One', color: '#111' }, { id: 'F03', name: 'Store Three', color: '#333' }, { id: 'F04-P', name: 'Store Four', color: '#444' }, { id: 'F06', name: 'Store Six', color: '#666' }] };
  vm.createContext(c);
  vm.runInContext(NAMES.concat(HAS_NEW ? ['toastSystemAccount'] : []).map(n => pick(source, n)).join('\n') + `
    var _tipLaborSeq = 0;
    function _tipLaborNewer(){ return false; }
    function _tipLaborMark(){}
    function normalizeBusinessDate(d){ return String(d); }
    function setCreditTipAdjLocal(){}
    function getEmployees(){ return JSON.parse(JSON.stringify(EMPS)); }
    function getStoresAll(){ return STORES; }
    function setTipLabor(sid, d, v){ STORE['tip_labor_'+sid+'_'+d] = JSON.parse(JSON.stringify(v)); }
    function tipHoursFromShifts(sid, sh){ return { lunch: 0, dinner: 0 }; }
    async function fetchTipLaborFromDB(){ return ROWS; }
    function lsKeys(p){ return Object.keys(STORE).filter(function(k){ return k.indexOf(p) === 0; }); }
    function _lsRaw(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _laborHrs(e){ return (+e.rawLunch||0) + (+e.rawDinner||0); }
    function isoOf(d){ return '2020-01-01'; }
    function myAmStores(){ return ['F04-P']; }
    function bizToday(){ return '2026-10-30'; }
    function showToast(m){ TOASTS.push(m); }
    function openModal(h){ MODAL.html = h; SEL.options = []; var re = /<option value="([^"]*)"/g, m; while((m = re.exec(h))) SEL.options.push({ value: m[1] }); SEL.value = SEL.options.length ? SEL.options[0].value : ''; }
    var document = { getElementById: function(id){ return id === 'tl-emp' ? SEL : null; } };`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const plain = (v) => JSON.parse(JSON.stringify(v));
const punch = (name, hours) => ({ name, lunchHours: 0, dinnerHours: hours, shifts: [] });
async function importDay(c, store, date, entries) {
  c.ROWS = [{ business_date: date, data: entries }];
  await run(c, `syncTipLaborFromDB('${store}', 'g', [{date:'${date}'}])`);
  return plain(c.STORE['tip_labor_' + store + '_' + date] || {});
}
const list = (c) => plain(run(c, 'unregisteredClockIns(3650)'));
const fld = (n) => 'toastAlias_' + n.normalize('NFKC').toLowerCase().replace(/[\s\-.,'_]/g, '');
const alias = (n, extra) => Object.assign({ n, from: '2026-10-16', at: '2026-10-30T00:00:00Z', by: 'GM', via: 'unreg' }, extra || {});

test('a Toast name that is the same as a resigned record: punches after the resign date are listed (the import still puts them on that record)', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10', store: 'F03' }, { id: 'a1', name: 'Kai Example', status: '在籍', store: 'F04-P' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F03', '2026-09-05', [punch('Mia Sample', 6)])), ['Mia Sample']);
  assert.deepEqual(Object.keys(await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5), punch('Kai Example', 4)])), ['Mia Sample', 'Kai Example'], 'the import is unchanged');
  await importDay(c, 'F04-P', '2026-10-27', [punch('Mia Sample', 7)]);
  const l = list(c);
  assert.equal(l.length, 1, 'only the punches after the resign date');
  assert.equal(l[0].kind, 'resigned');
  assert.equal(l[0].name, 'Mia Sample');
  assert.equal(l[0].emp.id, 'r1');
  assert.equal(l[0].emp.resignDate, '2026-09-10');
  assert.deepEqual(l[0].stores, ['F04-P']);
  assert.equal(l[0].days, 2); assert.equal(l[0].hours, 12);
  assert.deepEqual(l[0].byDate, { '2026-10-26': 5, '2026-10-27': 7 });
  // the raw attendance rows are not touched
  assert.equal(c.STORE['tip_labor_F04-P_2026-10-26']['Mia Sample'].toastName, 'Mia Sample');
});

test('the warning clears when the record is restored, or when the punches are linked to an active employee', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10', store: 'F03' }, { id: 'a2', name: 'Mia Sample-Lee', status: '在籍', store: 'F04-P' }];
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  assert.equal(list(c).length, 1);
  // linked to the active record (this device has not re-read the attendance yet): no longer listed
  c.EMPS[1][fld('Mia Sample')] = alias('Mia Sample');
  assert.deepEqual(list(c), []);
  // and after re-reading, the import puts the punches on the active record (the alias wins over the resigned record with the same name)
  assert.deepEqual(Object.keys(await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)])), ['Mia Sample-Lee']);
  assert.deepEqual(list(c), []);
  // or: restored to in service
  const d = app();
  d.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10', store: 'F03' }];
  await importDay(d, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  assert.equal(list(d).length, 1);
  d.EMPS[0].status = '在籍';
  assert.deepEqual(list(d), []);
});

test('an alias held by another resigned record does not clear the warning (only an active person can take the punches)', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10' }, { id: 'r3', name: 'Mia Old', status: '退職', resignDate: '2026-08-01' }];
  c.EMPS[1][fld('Mia Sample')] = alias('Mia Sample');
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'resigned'); assert.equal(l[0].emp.id, 'r3'); assert.equal(l[0].viaAlias, true);
  assert.ok(run(c, 'renderUnregisteredCard()').includes('さんの記録の別名'));
});

test('a resigned record without a resign date: every punch in the period is listed (which punches are after resigning is unknown)', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', store: 'F03' }];
  await importDay(c, 'F03', '2026-09-05', [punch('Mia Sample', 6)]);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'resigned'); assert.equal(l[0].emp.resignDate, '');
});

test('two records with the same name, one active: the punches count for the active one, nothing is listed', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10' }, { id: 'a1', name: 'Mia Sample', status: '在籍', store: 'F04-P' }];
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  assert.deepEqual(list(c), []);
});

test('a Toast name the import put on another person by part of the name is listed, and clears when it is linked', async () => {
  const c = app();
  c.EMPS = [{ id: 'a1', name: 'Ann Example', status: '在籍', store: 'F01' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F01', '2026-10-20', [punch('Ann', 4)])), ['Ann Example'], 'the import still matches by part of the name');
  let l = list(c);
  assert.equal(l.length, 1);
  assert.equal(l[0].kind, 'part'); assert.equal(l[0].name, 'Ann'); assert.equal(l[0].toastName, 'Ann'); assert.equal(l[0].emp.id, 'a1'); assert.equal(l[0].hours, 4);
  // an alias for another store does not cover F01
  c.EMPS[0][fld('Ann') + '@F04-P'] = alias('Ann', { store: 'F04-P' });
  assert.equal(list(c).length, 1);
  // confirmed (linked for all stores): cleared
  c.EMPS[0][fld('Ann')] = alias('Ann');
  assert.deepEqual(list(c), []);
});

test('names that are the same except for case, spaces or hyphens are not listed as a part match', async () => {
  const c = app();
  c.EMPS = [{ id: 'a1', name: 'Ann Example', status: '在籍', store: 'F01' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F01', '2026-10-20', [punch('ann example', 4)])), ['Ann Example']);
  c.STORE['tip_labor_F01_2026-10-21'] = { 'Ann Example': { rawDinner: 3, toastName: 'Ann  Example' } };
  c.STORE['tip_labor_F01_2026-10-22'] = { 'Ann Example': { rawDinner: 3 } };   // an old row without the Toast name
  assert.deepEqual(list(c), []);
});

test('the exact-name employee loses to a part match that comes first in the list: the punches are listed for review (the import is unchanged)', async () => {
  const c = app();
  c.EMPS = [{ id: 'a1', name: 'Ann Example', status: '在籍', store: 'F01' }, { id: 'a2', name: 'Ann', status: '在籍', store: 'F01' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F01', '2026-10-20', [punch('Ann', 4)])), ['Ann Example']);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'part'); assert.equal(l[0].emp.id, 'a1');
});

test('Toast\'s own accounts are left out with the same rule as the ops-bot; people are still listed', () => {
  const GENERIC = ['Toast Generic Login', 'TOAST GENERIC LOGIN', 'toast_generic-login', 'Toast.Generic.Login', '*Toast Generic Login*', 'Ｔｏａｓｔ　Ｇｅｎｅｒｉｃ　Ｌｏｇｉｎ', 'Toast Generic Login 2'];
  const DEFAULT = ['Server Default', 'SERVER DEFAULT', 'server_default', 'Server-Default', '*Server Default*', 'server.default'];
  const PEOPLE = ['Synthetic Person', 'MyToast Generic Login', 'Toast Generic Logins', 'Generic Login', 'Default Server', 'Server Default 2', 'Server'];
  const OTHER = ['Order Only', 'order-only', 'Kiosk Mode', 'Order'];
  const c = app();
  assert.ok(HAS_NEW, 'toastSystemAccount exists');
  for (const store of ['F01', 'F04-P', 'F06']) for (const n of GENERIC.concat(DEFAULT, PEOPLE, OTHER))
    assert.equal(run(c, `toastSystemAccount(${JSON.stringify(n)}, ${JSON.stringify(store)})`), isBotSystemAccount(n, store) || run(c, `isOrderOnlyAccount(${JSON.stringify(n)})`), n + ' @' + store);
  c.EMPS = [];
  const row = (names) => Object.fromEntries(names.map(n => [n, { rawDinner: 2, toastName: n }]));
  c.STORE['tip_labor_F01_2026-10-20'] = row(GENERIC.concat(DEFAULT, ['Synthetic Person', 'Order Only', 'Kiosk Mode']));
  c.STORE['tip_labor_F06_2026-10-20'] = row(GENERIC.concat(DEFAULT, ['Synthetic Person']));
  const l = list(c);
  const at = (sid) => l.filter(x => x.stores.includes(sid)).map(x => x.name).sort();
  assert.deepEqual(at('F06'), ['Synthetic Person']);
  assert.deepEqual(at('F01'), DEFAULT.concat(['Synthetic Person']).sort(), 'Server Default is a person outside LaLa');
});

test('the card: a resigned record has a restore button and a store hint; a part match can be confirmed for that person; names are escaped', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia <b>Sample', status: '退職', resignDate: '2026-09-10', store: 'F03' }, { id: 'a1', name: 'Ann Example', status: '在籍', store: 'F01' }];
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia <b>Sample', 5)]);
  await importDay(c, 'F01', '2026-10-27', [punch('Ann', 3)]);
  const html = run(c, 'renderUnregisteredCard()');
  assert.ok(!html.includes('<b>Sample'), 'escaped');
  assert.ok(html.includes('退職の記録に入っている'));
  assert.ok(html.includes('restoreEmployee(&quot;r1&quot;)'));
  assert.ok(html.includes('退職日 2026/09/10'));
  assert.ok(html.includes('所属か応援の店に Store Four を入れてください'));
  assert.ok(html.includes('名前の一部で入っている'));
  assert.ok(/openToastLinkModal\(\d+,&quot;a1&quot;\)/.test(html), 'confirm for Ann Example');
  assert.ok(html.includes('2名'));
  // someone who cannot link (a store manager whose real role is not a linking role) gets no restore / link buttons
  c.curRole = 'am'; c.curRealRole = 'g4';
  const g4 = run(c, 'renderUnregisteredCard()');
  assert.ok(g4.includes('退職の記録に入っている') && !g4.includes('restoreEmployee(') && !g4.includes('openToastLinkModal('));
  // an AM sees only the rows of their stores (F04-P), and no buttons for other stores
  c.curRole = 'am'; c.curRealRole = 'am';
  const am = run(c, 'renderUnregisteredCard()');
  assert.ok(am.includes('restoreEmployee(&quot;r1&quot;)'));
  assert.ok(!am.includes('名前の一部で入っている'));
});

test('a part match that went to a person who has since resigned (before the resign date) offers no link to the resigned record', async () => {
  const c = app();
  c.EMPS = [{ id: 'r2', name: 'Ann Example', status: '退職', resignDate: '2026-10-25', store: 'F01' }];
  await importDay(c, 'F01', '2026-10-20', [punch('Ann', 3)]);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'part'); assert.equal(l[0].emp.id, 'r2');
  const html = run(c, 'renderUnregisteredCard()');
  assert.ok(!/openToastLinkModal\(\d+,&quot;r2&quot;\)/.test(html));
  assert.ok(html.includes('ほかの従業員に結ぶ'));
});

test('"same person" opens the link screen with that person already chosen (the other names stay choosable)', async () => {
  const c = app();
  c.EMPS = [{ id: 'a0', name: 'Annabel Other', status: '在籍', store: 'F01' }, { id: 'a1', name: 'Ann Example', status: '在籍', store: 'F01' }];
  await importDay(c, 'F01', '2026-10-20', [punch('Ann', 4)]);
  run(c, 'renderUnregisteredCard()');
  const items = plain(run(c, 'window._unregList')), i = items.findIndex(x => x.kind === 'part');
  assert.ok(i >= 0);
  assert.equal(items[i].emp.id, 'a0', 'the import put "Ann" on the first part match');
  assert.notEqual(c.SEL.options[0] && c.SEL.options[0].value, 'a0');
  run(c, `openToastLinkModal(${i}, 'a0')`);
  assert.equal(c.SEL.value, 'a0');
  assert.notEqual(c.SEL.options[0].value, 'a0', 'not simply the first choice');
  assert.ok(c.SEL.options.some(o => o.value === 'a1'));
  run(c, `openToastLinkModal(${i}, 'nobody')`);   // an id that is not a choice: the first choice stays
  assert.equal(c.SEL.value, c.SEL.options[0].value);
  run(c, `openToastLinkModal(${i})`);
  assert.equal(c.SEL.value, c.SEL.options[0].value);
});

test('review P2-1: a Toast name that went onto a resigned record by part of the name is a part match, not "the same name"', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Kenji Sato', status: '退職', resignDate: '2026-09-10', store: 'F01' }, { id: 'a1', name: 'Ken', status: '在籍', store: 'F01' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F01', '2026-10-20', [punch('Ken', 4)])), ['Kenji Sato'], 'the import is unchanged (part match first in the list)');
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'part'); assert.equal(l[0].emp.id, 'r1'); assert.equal(l[0].name, 'Ken');
  const html = run(c, 'renderUnregisteredCard()');
  assert.ok(!html.includes('restoreEmployee('), 'no restore button for a part match');
  assert.ok(html.includes('退職しています'));
});

test('review P2-1: a resigned record and an active record whose names differ only in spaces / hyphens: linking comes first, restoring second', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10', store: 'F03' }, { id: 'a2', name: 'Mia-Sample', status: '在籍', store: 'F04-P' }];
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'resigned');
  const html = run(c, 'renderUnregisteredCard()');
  assert.ok(/class="btn btn-primary btn-sm" onclick="openToastLinkModal\(0,&quot;a2&quot;\)"/.test(html), 'link to the active record is the main button');
  assert.ok(/class="btn btn-secondary btn-sm" onclick="restoreEmployee\(&quot;r1&quot;\)"/.test(html));
  assert.ok(html.includes('同じ人が 2 人になります'));
});

test('review P2-2: the resign date is escaped, and a date that is not YYYY-MM-DD counts as no date', async () => {
  const c = app();
  c.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '1<img src=x onerror=alert(1)>', store: 'F03' }];
  await importDay(c, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  const l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].emp.resignDate, '');
  const html = run(c, 'renderUnregisteredCard()');
  assert.ok(!html.includes('<img'), 'not rendered as HTML');
  assert.ok(html.includes('退職日が入っていません'));
  c.EMPS[0].resignDate = '2026/12/31';   // not the date format: does not hide the punches
  assert.equal(list(c).length, 1);
});

test('review P3-1 / P3-2: a Toast account that landed on a person is listed; the old toastName field does not hide punches', async () => {
  const c = app();
  c.EMPS = [{ id: 'a1', name: 'Gen', status: '在籍', store: 'F01' }];
  assert.deepEqual(Object.keys(await importDay(c, 'F01', '2026-10-20', [punch('Toast Generic Login', 3)])), ['Gen']);
  let l = list(c);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'part'); assert.equal(l[0].name, 'Toast Generic Login');
  const d = app();
  d.EMPS = [{ id: 'r1', name: 'Mia Sample', status: '退職', resignDate: '2026-09-10' }, { id: 'a2', name: 'Mia S', status: '在籍', toastName: 'Mia Sample' }];
  await importDay(d, 'F04-P', '2026-10-26', [punch('Mia Sample', 5)]);
  l = list(d);
  assert.equal(l.length, 1); assert.equal(l[0].kind, 'resigned', 'the import does not read toastName, so the punches are on the resigned record');
  d.STORE = { 'tip_labor_F01_2026-10-21': { 'Nobody Here': { rawDinner: 2, toastName: 'Nobody Here' } } };
  d.EMPS = [{ id: 'a3', name: 'Some One', status: '在籍', toastName: 'Nobody Here' }];
  assert.equal(list(d).length, 1, 'a name nobody has is listed even if an old toastName field holds it');
});

test('review P3-4: the link screen keeps the chosen person when it reopens for a new tip period', () => {
  assert.ok(source.includes('openToastLinkModal(L.i, L.pre);'));
  assert.ok(source.includes("window._toastLink={ i:i, item:x, ps:ps, pre:pre||'' };"));
});
