// App v1088 (UI案52 ②, Moto 2026-10-16 "全部A" = 5A〜8A):
//  - tasks are retired: no task screens or entry points, no automatic tasks (cash tip, consultations, recurring);
//    the cash-tip notice stays (once per store and day); stored tasks (tasks_all) and their sync rule stay;
//  - every error-center issue carries a key (which problem) and a fingerprint (its details);
//  - sort (priority / type / store / newest / oldest) and filter (store, type);
//  - "解除" with a reason (handled / not a problem / not applicable to this store) and a note, saved in the synced key
//    ec_resolutions (newest record per key, undo = off); a cleared issue shows again when its fingerprint changes;
//  - the past log (for reviews) does not count issues cleared as "not a problem" (7A); cleared issues are not logged afterwards;
//  - CEO / GM / accounting / office crew see and clear errors (6A, 8A).
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1087 fails them).
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
function varSrc(name) { const m = new RegExp('^var ' + name + '\\b[^\\n]*$', 'm').exec(SRC); if (!m) throw new Error('var not found: ' + name); return m[0]; }
// Static checks: the text from the declaration to the first closing brace at the start of a line (the top-level end).
function bodyOf(name) { const i = SRC.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); if (i < 0) throw new Error('not found: ' + name); return SRC.slice(i, SRC.indexOf('\n}', i) + 2); }
const has = name => new RegExp('^(async )?function ' + name + '\\(', 'm').test(SRC);

const EC = ['_ecYmd', '_ecRecentDates', '_ecClosedDates', '_ecEmpAlive', 'ecDetEmpMaster', 'ecDetCashTip', 'ecDetClock', 'ecDetOnboard', 'ecDetClose',
  'ecDetInventory', 'ecDetOverwork', '_ecNorm', 'ecCollect', 'ecWhyLabel', 'ecCanView', 'ecCanResolve', 'ecResAll', '_ecResLive', 'ecResOf', 'ecOpenIssues',
  '_ecResSave', 'ecPullLatest', '_ecOnPage', '_ecRerender', 'ecAutoPull', 'ecSetSort', 'ecSetStore', 'ecSetCat', '_ecStoreName', '_ecStoresOf',
  '_ecDateLabel', '_ecAtLabel', '_ecMeta', '_ecStoreRank', 'ecSortIssues', 'ecFilterIssues', '_ecBarHtml', '_ecHeadRow', '_ecSevBadge', '_ecCells',
  '_ecRowHtml', '_ecResRows', '_ecResView', 'ecOpenResolve', 'ecResolveGo', 'ecUndoResolve', 'ecSevMeta', 'setEcView', 'setEcRange', 'getEcLog',
  '_ecAttribute', 'ecSnapshot', 'ecMaybeAutoSnapshot', 'ecLogInRange', '_ecFalseSet', 'ecLogCounted', 'ecRenderLogView', 'renderErrorCenter',
  'mergeMapByTime', '_coversMapByTime', '_recAt', 'mergeEcLog', '_ecLogSig', '_coversEcLog'];
const VARS = ['EC_MIN_DATE', 'EC_RES_KEY', 'EC_WHY', '_ecPullAt', 'EC_SEV_ORDER', 'EC_CAT_ORDER', 'ecSort', '_ecShown', 'ecView', 'EC_DETECTORS'];

const STORES = [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }, { id: 'F03', name: 'Store Three' }];
const EMPLOYEES = [
  { id: 'e1', name: 'Crew A', store: 'F01', status: '在籍', role: 'crew', email: '', dob: '2000-01-01' },
  { id: 'e2', name: 'Crew B', store: 'F02', status: '在籍', role: 'crew', email: 'b@example.com', dob: '' },
  { id: 'e3', name: 'Crew C', store: 'F01', status: '在籍', role: 'crew', resignDate: '2026-10-01', email: 'c@example.com', dob: '1999-01-01' },
];
// Today in these checks: 2026-10-16 (Hawaii); yesterday 10-15.
const NOW = new Date(2026, 9, 16, 9, 30).getTime();

function app({ role = 'office', user = 'Marcia', st = {}, cloud = null, missingTip = [['F01', '2026-10-15']], labor = {}, page = 'tasks', workTab = 'error', fns = [] } = {}) {
  const S = JSON.parse(JSON.stringify(st));
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const c = {
    Date: FakeDate, curRole: role, curUserName: user, curStore: 'ALL', curLang: 'ja', curPage: page, workTab, STORES,
    ROLE_CONFIG: { ceo: { name: 'Tac' }, gm: { name: 'Moto' }, office: { name: 'Marcia' }, office_crew: { name: '事務スタッフ' }, am: { name: 'Yuki' }, sl: { name: 'SL' }, crew: { name: 'Crew' } },
    toasts: [], rendered: [], writes: [], modals: [], closed: 0, S,
    t: (ja) => ja, ls: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), lsSet: (k, v) => { S[k] = JSON.parse(JSON.stringify(v)); c.writes.push(k); return true; },
    showToast: (m, k) => c.toasts.push([m, k]), renderPage: p => c.rendered.push(p), escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    openModal: h => c.modals.push(h), closeModalDirect: () => { c.closed++; }, myName: () => c.curUserName,
    getEmployees: () => EMPLOYEES, isTipExcludedTitle: () => false,
    cashTipMissing: (sid, dt) => missingTip.some(([s, d]) => s === sid && d === dt), openCashTipModal: () => {},
    getTipLabor: (sid, dt) => labor[sid + '|' + dt] || null,
    getOfficeClose: () => ({ a: true }), OFFICE_CLOSE_ITEMS: [{ id: 'a' }, { id: 'b' }], ymLabelJP: ym => ym,
    parseJaDate: () => null,
    getOwLimits: () => ({ G1: { max: 40 } }), OW_GRADES: ['G1'], owRecentSundays: () => ['2026-10-11'],
    laborWeekRange: sun => ({ from: sun, to: '2026-10-17', label: '10/11〜10/17' }),
    owScanWeek: () => [{ name: 'Crew A', over: 3, max: 40, total: 43, grade: 'G1', byStore: { F01: 30, F02: 13 }, weekDone: false }],
    _owStoreName: sid => (STORES.find(s => s.id === sid) || { name: sid }).name,
    todayISO: () => '2026-10-16', isoOf: d => new RealDate(d).toISOString().slice(0, 10),
    renderInactiveCard: () => '<inactive>', renderUnregisteredCard: () => '<unreg>',
    document: { querySelector: () => (c._why ? { value: c._why } : null), getElementById: id => (id === 'ec-memo' ? { value: c._memo || '' } : null) },
    setTimeout, clearTimeout, SUPA_SYNC_ENABLED: !!cloud, _acSub: '', officeMgrTab: 'dash',
  };
  if (cloud) c.pullOpKey = async key => { c.pulls = (c.pulls || 0) + 1; if (key in cloud) S[key] = c.mergeMapByTime(cloud[key], S[key] || {}); return true; };
  vm.createContext(c);
  const code = EC.concat(fns).map(n => { try { return fnSrc(n); } catch (_e) { return ''; } })
    .concat(VARS.map(n => { try { return varSrc(n); } catch (_e) { return ''; } })).join('\n');
  vm.runInContext(code, c);
  return c;
}
const run = (c, expr) => vm.runInContext(expr, c);
const plain = v => JSON.parse(JSON.stringify(v));
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

test('every detector gives each issue a key, a fingerprint, its store and date', () => {
  const c = app({
    st: {
      onboardings: [{ id: 'ob1', name: 'New One', store: 'F02', obStatus: '提出完了' }],
      inv_hist_F01: [{ ym: '2026-09', lines: [{ id: 'i1', name: 'Rice', actual: -1, theory: 10, diff: -11 }] }],
    },
    labor: { 'F02|2026-10-14': { 'Crew B': { shifts: [{ inDate: '2026-10-14T17:02', outDate: null }] } } },
  });
  const all = plain(run(c, 'ecCollect()'));
  const by = k => all.find(x => x.key === k);
  const tip = by('tip|F01|2026-10-15');
  assert.ok(tip, 'cash tip issue has a key');
  assert.equal(tip.store, 'F01'); assert.equal(tip.date, '2026-10-15'); assert.equal(tip.fp, '');
  const clock = by('clock|F02|2026-10-14|Crew B');
  assert.ok(clock); assert.equal(clock.fp, '2026-10-14T17:02'); assert.equal(clock.store, 'F02'); assert.equal(clock.who, 'Crew B');
  const ow = by('ow|Crew A|2026-10-11');
  assert.ok(ow); assert.deepEqual(ow.stores, ['F01', 'F02']); assert.equal(ow.fp, '40'); assert.equal(ow.dateLabel, '10/11〜10/17');
  assert.ok(by('emp|email|e1') && by('emp|email|e1').store === 'F01');
  assert.equal(by('emp|resign|e3').fp, '2026-10-01|在籍');
  assert.equal(by('emp|dob|e2').store, 'F02');
  assert.equal(by('ob|ob1').fp, '提出完了'); assert.equal(by('ob|ob1').store, 'F02');
  assert.ok(by('close|2026-09')); assert.equal(by('close|2026-09').store, '');
  const inv = by('inv|F01|m|i1'); assert.ok(inv); assert.equal(inv.fp, '2026-09|-1|10|-11'); assert.equal(inv.date, '2026-09-01');
  // Keys are unique (one issue per key).
  assert.equal(new Set(all.map(x => x.key)).size, all.length);
  // An issue without a key gets one from its type and title, and its details as fingerprint.
  const n = plain(run(c, '_ecNorm({ cat:"X", title:"Store Two：something", detail:"d1" })'));
  assert.equal(n.key, 'x|X|Store Two：something'); assert.equal(n.fp, 'd1'); assert.equal(n.store, 'F02');
});

test('a cleared issue stays cleared while its fingerprint is the same, and shows again when the details change', () => {
  const rec = { fp: '2026-10-14T17:02', why: 'done', by: 'Marcia', at: '2026-10-16T19:00:00.000Z', _at: 10 };
  const c = app({ st: { ec_resolutions: { 'clock|F02|2026-10-14|Crew B': rec } }, labor: { 'F02|2026-10-14': { 'Crew B': { shifts: [{ inDate: '2026-10-14T17:02' }] } } } });
  const open = () => plain(run(c, 'ecOpenIssues()')).map(x => x.key);
  assert.ok(!open().includes('clock|F02|2026-10-14|Crew B'));
  assert.ok(open().includes('tip|F01|2026-10-15'));
  // The clock-in time is corrected in Toast: a different fingerprint, so it shows again.
  c.getTipLabor = () => ({ 'Crew B': { shifts: [{ inDate: '2026-10-14T17:30' }] } });
  assert.ok(open().includes('clock|F02|2026-10-14|Crew B'));
  // Undone (off) records do not clear anything.
  c.getTipLabor = () => ({ 'Crew B': { shifts: [{ inDate: '2026-10-14T17:02' }] } });
  c.S.ec_resolutions['clock|F02|2026-10-14|Crew B'].off = true;
  assert.ok(open().includes('clock|F02|2026-10-14|Crew B'));
});

test('two devices clearing different issues keep both; the newer record of the same issue wins; undo is not overwritten by an older copy', () => {
  const c = app();
  const A = { 'tip|F01|2026-10-15': { fp: '', why: 'done', _at: 100 } };
  const B = { 'emp|email|e1': { fp: '', why: 'false', _at: 120 } };
  const m = plain(run(c, 'mergeMapByTime(' + JSON.stringify(A) + ',' + JSON.stringify(B) + ')'));
  assert.deepEqual(Object.keys(m).sort(), ['emp|email|e1', 'tip|F01|2026-10-15']);
  assert.equal(run(c, '_coversMapByTime(' + JSON.stringify(A) + ',' + JSON.stringify(B) + ')'), false);
  const undo = { 'tip|F01|2026-10-15': { fp: '', why: 'done', _at: 200, off: true } };
  for (const [cl, lo] of [[A, undo], [undo, A]]) {
    const r = plain(run(c, 'mergeMapByTime(' + JSON.stringify(cl) + ',' + JSON.stringify(lo) + ')'));
    assert.equal(r['tip|F01|2026-10-15'].off, true);
  }
});

test('clearing: the reason, note, who and when are saved after reading the cloud; the issue leaves the list; undo brings it back', async () => {
  const cloud = { ec_resolutions: { 'emp|email|e1': { fp: '', why: 'false', by: 'Moto', _at: 50 } } };
  const c = app({ role: 'office_crew', user: 'Akane', cloud });
  const html = run(c, 'renderErrorCenter(true)');
  assert.match(html, /ecOpenResolve\(/, 'office crew gets 解除 buttons (6A)');
  const shown = plain(run(c, '_ecShown'));
  const i = shown.findIndex(x => x.key === 'tip|F01|2026-10-15');
  assert.ok(i >= 0);
  run(c, 'ecOpenResolve(' + i + ')');
  assert.equal(c.modals.length, 1);
  assert.match(c.modals[0], /value="na"/, 'an issue with a store offers "この店は対象外"');
  c._why = 'na'; c._memo = '  現金の扱いが無い店  ';
  await run(c, 'ecResolveGo()'); await tick();
  assert.ok(c.pulls >= 1, 'reads the cloud before saving');
  const r = c.S.ec_resolutions['tip|F01|2026-10-15'];
  assert.equal(r.why, 'na'); assert.equal(r.memo, '現金の扱いが無い店'); assert.equal(r.by, 'Akane'); assert.equal(r.role, 'office_crew');
  assert.equal(r.fp, ''); assert.equal(r.store, 'F01'); assert.equal(r.off, false); assert.ok(r._at >= NOW);
  assert.ok(c.S.ec_resolutions['emp|email|e1'], 'the other device\'s record was merged in, not dropped');
  assert.equal(c.closed, 1);
  assert.ok(!plain(run(c, 'ecOpenIssues()')).some(x => x.key === 'tip|F01|2026-10-15'));
  // The cleared tab lists it with an undo button.
  run(c, 'ecView="res"');
  const resHtml = run(c, 'renderErrorCenter(true)');
  assert.match(resHtml, /この店は対象外/); assert.match(resHtml, /現金の扱いが無い店/); assert.match(resHtml, /ecUndoResolve\(/);
  const rs = plain(run(c, '_ecResShown'));
  const j = rs.findIndex(x => x.key === 'tip|F01|2026-10-15');
  assert.equal(rs[j]._now, 'same');
  await run(c, 'ecUndoResolve(' + j + ')'); await tick();
  assert.equal(c.S.ec_resolutions['tip|F01|2026-10-15'].off, true);
  assert.equal(c.S.ec_resolutions['tip|F01|2026-10-15'].offBy, 'Akane');
  assert.ok(c.S.ec_resolutions['tip|F01|2026-10-15']._at > r._at);
  assert.ok(plain(run(c, 'ecOpenIssues()')).some(x => x.key === 'tip|F01|2026-10-15'));
});

test('clearing: only CEO / GM / accounting / office crew; no "not applicable" for an issue without a store; a reason is required', async () => {
  for (const role of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(run(app({ role }), 'ecCanResolve() && ecCanView()'), true, role);
  for (const role of ['am', 'sl', 'crew', 'chef']) {
    const c = app({ role });
    assert.equal(run(c, 'ecCanResolve() || ecCanView()'), false, role);
    const h = run(c, 'renderErrorCenter(true)');
    assert.doesNotMatch(h, /ecOpenResolve/); assert.match(h, /CEO・GM・経理・事務Crew/);
    c._why = 'done'; run(c, '_ecModal={key:"tip|F01|2026-10-15",fp:"",stores:["F01"]}');
    await run(c, 'ecResolveGo()');
    assert.equal(c.S.ec_resolutions, undefined, role + ' cannot save');
  }
  const c = app({ role: 'gm', user: 'Moto' });
  run(c, 'renderErrorCenter(true)');
  const i = plain(run(c, '_ecShown')).findIndex(x => x.key === 'close|2026-09');
  run(c, 'ecOpenResolve(' + i + ')');
  assert.doesNotMatch(c.modals[0], /value="na"/);
  c._why = 'na'; await run(c, 'ecResolveGo()');
  assert.equal(c.S.ec_resolutions, undefined, '"not applicable" is refused without a store');
  c._why = ''; await run(c, 'ecResolveGo()');
  assert.equal(c.S.ec_resolutions, undefined);
  c._why = 'false'; await run(c, 'ecResolveGo()');
  assert.equal(c.S.ec_resolutions['close|2026-09'].why, 'false');
});

test('sorting and filtering', () => {
  const c = app();
  const L = [
    { key: 'a', sev: 'low', cat: '棚卸', store: 'F02', date: '2026-10-10' },
    { key: 'b', sev: 'high', cat: 'チップ', store: 'F01', date: '2026-10-12' },
    { key: 'c', sev: 'high', cat: '勤怠', store: 'F02', date: '2026-10-14' },
    { key: 'd', sev: 'mid', cat: '月次締め', store: '', date: '2026-09' },
    { key: 'e', sev: 'mid', cat: '従業員', store: 'F01', date: '' },
    { key: 'f', sev: 'high', cat: '勤怠', store: 'F01', stores: ['F01', 'F03'], date: '2026-10-11' },
  ];
  const s = how => plain(run(c, 'ecSortIssues(' + JSON.stringify(L) + ',"' + how + '")')).map(x => x.key).join('');
  assert.equal(s('sev'), 'cbfdea');
  assert.equal(s('cat'), 'cfbeda');
  assert.equal(s('store'), 'bfecad');
  assert.equal(s('new'), 'cbfade');
  assert.equal(s('old'), 'dafbce');
  const f = (st, cat) => plain(run(c, 'ecFilterIssues(' + JSON.stringify(L) + ',"' + st + '","' + cat + '")')).map(x => x.key).join('');
  assert.equal(f('F02', ''), 'ac');
  assert.equal(f('F03', ''), 'f', 'an issue over several stores matches each of them');
  assert.equal(f('-', ''), 'd');
  assert.equal(f('', '勤怠'), 'cf');
  assert.equal(f('F01', '勤怠'), 'f');
  // The screen applies them; the choice of sort is remembered only on this device (_ec_sort).
  const store = {};
  c.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  run(c, 'ecSetSort("store")'); assert.equal(store._ec_sort, 'store');
  run(c, 'ecSetSort("bogus")'); assert.equal(run(c, 'ecSort'), 'sev');
  run(c, 'ecSetStore("F01"); ecSetCat("チップ")');
  const h = run(c, 'renderErrorCenter(true)');
  const keys = plain(run(c, '_ecShown')).map(x => x.key);
  assert.deepEqual(keys, ['tip|F01|2026-10-15']);
  assert.match(h, /<option value="F01" selected>/);
});

test('the past log does not count issues cleared as "not a problem" (7A); other reasons are counted; cleared issues are not logged after', () => {
  const st = {
    ec_resolutions: {
      'emp|email|e1': { fp: '', why: 'false', cat: '従業員', title: 'Crew A：Email未登録', _at: 5 },
      'emp|dob|e2': { fp: '', why: 'done', cat: '従業員', title: 'Crew B：生年月日 未登録', _at: 6 },
    },
    ec_log: [
      { date: '2026-10-14', title: 'Crew A：Email未登録', cat: '従業員', sev: 'low', store: 'F01', emp: 'Crew A', key: 'emp|email|e1', fp: '' },
      { date: '2026-10-13', title: 'Crew A：Email未登録', cat: '従業員', sev: 'low', store: 'F01', emp: 'Crew A' },   // before v1088: no key
      { date: '2026-10-14', title: 'Crew B：生年月日 未登録', cat: '従業員', sev: 'low', store: 'F02', emp: 'Crew B', key: 'emp|dob|e2', fp: '' },
      { date: '2026-10-12', title: 'Crew A：Email未登録', cat: '従業員', sev: 'low', store: 'F01', emp: 'Crew A', key: 'emp|email|e1', fp: 'old' },
    ],
  };
  const c = app({ st });
  const counted = plain(run(c, 'ecLogInRange().filter(function(r){ return ecLogCounted(r); })'));
  assert.deepEqual(counted.map(r => r.date + r.emp), ['2026-10-14Crew B', '2026-10-12Crew A']);
  const h = run(c, 'ecRenderLogView()');
  assert.match(h, /解除した 2 件は数えていません/);
  // Today's snapshot logs only open issues and keeps key and fingerprint.
  run(c, 'ecSnapshot()');
  const today = c.S.ec_log.filter(r => r.date === '2026-10-16');
  assert.ok(today.length > 0);
  assert.ok(!today.some(r => r.key === 'emp|email|e1' || r.key === 'emp|dob|e2'), 'cleared issues are not logged');
  assert.ok(today.every(r => typeof r.key === 'string' && 'fp' in r));
  // Attribution for the review counts is unchanged (title based, as before v1088).
  const tip = today.find(r => r.key === 'tip|F01|2026-10-15');
  assert.equal(tip.store, 'F01'); assert.equal(tip.emp, '');
});

test('the cleared tab shows whether each record is still detected, changed or gone', () => {
  const st = { ec_resolutions: {
    'tip|F01|2026-10-15': { fp: '', why: 'done', title: 't1', _at: 3 },
    'emp|email|e1': { fp: 'other', why: 'done', title: 't2', _at: 2 },
    'tip|F02|2026-10-01': { fp: '', why: 'false', title: 't3', _at: 1 },
    'tip|F03|2026-10-02': { fp: '', why: 'done', title: 't4', _at: 9, off: true },
  } };
  const c = app({ st });
  const rows = plain(run(c, '_ecResRows()'));
  assert.deepEqual(rows.map(r => r.key + ':' + r._now), ['tip|F01|2026-10-15:same', 'emp|email|e1:changed', 'tip|F02|2026-10-01:gone']);
  const open = plain(run(c, 'ecOpenIssues()')).map(x => x.key);
  assert.ok(open.includes('emp|email|e1'), 'changed details show under current again');
  assert.ok(!open.includes('tip|F01|2026-10-15'));
});

test('opening the error center reads the cloud at most once a minute and redraws only while it is still open', async () => {
  const cloud = { ec_resolutions: { 'tip|F01|2026-10-15': { fp: '', why: 'done', _at: 7 } } };
  const c = app({ cloud });
  run(c, 'renderErrorCenter(true)'); await tick();
  assert.equal(c.pulls, 1);
  assert.deepEqual(c.rendered, ['tasks'], 'redraws after the cloud brought a new record');
  run(c, 'renderErrorCenter(true)'); await tick();
  assert.equal(c.pulls, 1, 'not again within a minute');
  // Moved away while reading: no redraw over another page.
  const d = app({ cloud: { ec_resolutions: { x: { fp: '', _at: 1 } } } });
  run(d, 'renderErrorCenter(true)'); d.curPage = 'dashboard'; await tick();
  assert.deepEqual(d.rendered, []);
  assert.equal(run(d, 'curPage="acct_center"; _acSub="err"; _ecOnPage()'), true);
  assert.equal(run(d, 'curPage="error_center"; _ecOnPage()'), true);
});

test('tasks are retired: no task screens or entry points; the data and its merge rule stay', () => {
  for (const name of ['renderTasks', 'renderTaskCreate', 'openTaskModal', 'openTaskDetail', 'renderOfficeTasks', 'officeQuickAddTask', 'ensureRecurringTasks',
    'taskDeadlineReminders', 'mdTodayTasks', 'botOpenTasks', 'checkCashTipTasks', 'sweepCashTipTasks', 'maybeSyncTasks', 'quickAddTask']) {
    assert.equal(has(name), false, name + ' is gone');
  }
  assert.ok(has('getTasks') && has('mergeTasks') && has('_coversTasks'), 'tasks_all is still read and merged');
  assert.match(SRC, /tasks_all:\s+\{ merge: mergeTasks, covers: _coversTasks \}/);
  const keys = JSON.parse(SRC.match(/var OP_SYNC_KEYS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.ok(keys.includes('tasks_all') && keys.includes('ec_resolutions'));
  assert.match(SRC, /ec_resolutions: \{ merge: mergeMapByTime, covers: _coversMapByTime \}/);
  assert.match(SRC.match(/var LS_NEVER_FREE = \[[^;]*;/)[0], /'ec_resolutions'/);
  // Work center: no タスク tab, an old saved tab goes to 今日; accounting review and the office pages have no task tab.
  const wc = bodyOf('renderWorkCenter');
  assert.doesNotMatch(wc, /setWorkTab\('tasks'\)|renderTasks|期限内タスク|今日までのタスク/);
  assert.match(wc, /workTab==='tasks'\) workTab='today'/);
  assert.match(wc, /ecOpenIssues\(\)/);
  assert.doesNotMatch(SRC, /\{ id:'task',\s+label:'タスク'/);
  assert.doesNotMatch(bodyOf('renderOfficeMgr'), /\['tasks','タスク'/);
  assert.doesNotMatch(bodyOf('renderOfficeDash'), /未処理タスク/);
  assert.doesNotMatch(bodyOf('renderMypage'), /今日のタスク|_taskCard/);
  assert.doesNotMatch(bodyOf('renderStoreCmd'), /go\('tasks'\)/);
  for (const f of ['renderDashboard', 'renderSlFunergyNow']) {
    const b = bodyOf(f);
    assert.doesNotMatch(b, /getTasks\(|期限切れタスク|本日期限タスク|本日のタスク/, f);
    assert.match(b, /本日の対応/, f);
  }
  assert.doesNotMatch(bodyOf('mdRailHtml'), /本日のタスク/);
  assert.doesNotMatch(bodyOf('renderMgmtDash'), /taskList|mdTodayTasks/);
  assert.match(bodyOf('mdErrors'), /ecOpenIssues/);
  assert.doesNotMatch(bodyOf('enterAppWithSync'), /ensureRecurringTasks|taskDeadlineReminders/);
  assert.doesNotMatch(bodyOf('saveGHPost'), /tasks_all|getTasks/);
  assert.match(bodyOf('saveGHPost'), /addNotif\(\{ type:'consult'/, 'consultations still notify managers');
  assert.doesNotMatch(bodyOf('setCashTips') + bodyOf('saveCashTipSides') + bodyOf('ghAssignMe'), /tasks_all|getTasks/);
  // Old links: workTab tasks → today, office_mgr tasks → dash; favourites of the task tab are hidden.
  const nav = bodyOf('navResolvePage');
  assert.match(nav, /workTab === 'tasks'\)\) workTab = 'today'/);
  assert.match(nav, /officeMgrTab === 'tasks'\) officeMgrTab = 'dash'/);
  assert.match(bodyOf('_favRetired'), /st\.workTab === 'tasks'/);
  // The error center page is open to office crew (8A).
  assert.match(SRC, /\{id:'error_center',label:'エラーセンター',icon:'ti-alert-hexagon',\s+roles:\['ceo','gm','office','office_crew'\]\}/);
  // The work center sync button reads approvals and resolutions instead of tasks.
  assert.match(SRC, /tasks:\s+\{ label:'ワークセンター', toast:false, pull: async function\(\)\{ try\{ await apPullLatest\(\); \}catch\(e\)\{\} try\{ await ecPullLatest\(\); \}catch\(e\)\{\} \} \}/);
});

test('cash tip: yesterday\'s missing cash tip still notifies the store once (no task is created)', () => {
  const S = { tasks_all: [{ id: 'old', refId: 'ctip_F02_2026-10-15', auto: 'cashtip', status: '進行中' }], notifications: [] };
  const c = {
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    window: {}, S, notifs: [],
    isoOf: d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    getTasks: () => S.tasks_all, getNotifs: () => S.notifications, addNotif: n => { S.notifications.push(n); c.notifs.push(n); },
    activeStores: () => STORES, cashTipMissing: (sid, dt) => dt === '2026-10-15' && sid !== 'F03', console,
  };
  vm.createContext(c);
  vm.runInContext(fnSrc('notifHasRef') + '\n' + fnSrc('checkCashTipNotify'), c);
  vm.runInContext('checkCashTipNotify()', c);
  assert.deepEqual(c.notifs.map(n => n.refId), ['ctip_F01_2026-10-15'], 'F02 was already notified by the old task; F03 is entered');
  assert.equal(c.notifs[0].toStore, 'F01');
  assert.deepEqual(S.tasks_all.map(t => t.id), ['old'], 'no task is created and the old one is not changed');
  c.window._ctipChk = null;
  vm.runInContext('checkCashTipNotify()', c);
  assert.equal(c.notifs.length, 1, 'the same store and day is not notified twice');
});

test('the dashboard rail and work center count only open issues', () => {
  const c = app({ st: { ec_resolutions: { 'tip|F01|2026-10-15': { fp: '', why: 'done', _at: 1 } } }, fns: ['mdErrors'] });
  const n = plain(run(c, 'mdErrors()')).length;
  assert.equal(n, plain(run(c, 'ecCollect()')).length - 1);
});

test('release markers are 1088', () => {
  assert.match(SRC, /const APP_VERSION = '1088';/);
  assert.match(SW, /const SW_BUILD = '1088';/);
});
