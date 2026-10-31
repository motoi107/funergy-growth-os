// App v1088 (UI案52 ②, Moto 2026-10-16 "全部A" = 5A〜8A):
//  - tasks are retired: no task screens or entry points, no automatic tasks (cash tip, consultations, recurring);
//    the cash-tip notice stays (once per store and day); stored tasks (tasks_all) and their sync rule stay;
//  - every error-center issue carries a key (which problem) and a fingerprint (its details);
//  - sort (priority / type / store / newest / oldest) and filter (store, type);
//  - "解除" with a reason (handled / not a problem / not applicable to this store) and a note, saved in the synced key
//    ec_resolutions (one record per issue and fingerprint, newest wins, undo = off, old undone / handled records expire);
//    a cleared issue shows again when its fingerprint changes; clearing a new occurrence keeps the earlier record;
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

const EC = ['cashTipValueOk', 'cashTipInvalid', 'ecLogCashTipUnset', '_ecYmd', '_ecRecentDates', '_ecClosedDates', '_ecEmpAlive', 'ecDetEmpMaster', 'ecDetCashTip', 'ecDetClock', 'ecDetOnboard', 'ecDetClose',
  'ecDetInventory', 'ecDetOverwork', '_ecNorm', 'ecCollect', 'ecWhyLabel', 'ecCanView', 'ecCanResolve', 'ecResAll', '_ecResLive', 'ecResOf', 'ecOpenIssues',
  '_ecResSave', 'ecPullLatest', '_ecOnPage', '_ecRerender', 'ecAutoPull', 'ecSetSort', 'ecSetStore', 'ecSetCat', '_ecStoreName', '_ecStoresOf',
  '_ecDateLabel', '_ecAtLabel', '_ecMeta', '_ecStoreRank', 'ecSortIssues', 'ecFilterIssues', '_ecBarHtml', '_ecHeadRow', '_ecSevBadge', '_ecCells',
  '_ecRowHtml', '_ecResRows', '_ecResView', 'ecOpenResolve', 'ecResolveGo', 'ecUndoResolve', 'ecSevMeta', 'setEcView', 'setEcRange', 'getEcLog',
  '_ecAttribute', 'ecSnapshot', '_ecOpenSig', 'ecMaybeAutoSnapshot', 'ecLogInRange', '_ecFalseSet', 'ecLogCounted', 'ecRenderLogView', 'renderErrorCenter',
  'mergeMapByTime', '_coversMapByTime', '_recAt', 'mergeEcLog', '_ecLogSig', '_coversEcLog', '_ecPartSig', '_ecLogParts', '_ecPartsUnion', 'ecLogSev', '_ecRid', '_ecResKey', '_ecResExpired', '_ecResMark', '_ecResGone', 'mergeEcRes', '_coversEcRes', '_canonForSig', '_logSig',
  'ecCloseResolve', '_ecNaOk'];
const VARS = ['EC_MIN_DATE', 'EC_RES_KEY', 'EC_WHY', '_ecPullAt', 'EC_SEV_ORDER', 'EC_CAT_ORDER', 'ecSort', '_ecShown', 'ecView', 'EC_DETECTORS', 'EC_RES_OFF_KEEP_MS', 'EC_NA_CATS'];
const RID = (key, fp = '') => key + '\u241e' + fp;
// v1118: the cash tip issue is an invalid value (missing counts as 0); its fingerprint is the value
const TK = 'tipinv|F01|2026-10-15', TFP = 'lunch=-5';

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
    // v1118: missing cash tips count as 0 and are no error; the cash tip issue in these checks is an invalid value
    getCashTips: sid => Object.fromEntries(missingTip.filter(([s]) => s === sid).map(([, d]) => [d, { lunch: -5, lunchEntered: true }])),
    isNoCashTipStore: sid => sid === 'F03' || sid === 'F03-G', openCashTipModal: () => {},
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
  if (cloud) c.pullOpKey = async key => { c.pulls = (c.pulls || 0) + 1; if (key in cloud) S[key] = c.mergeEcRes(cloud[key], S[key] || {}); return true; };
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
  const tip = by(TK);
  assert.ok(tip, 'cash tip issue has a key');
  assert.equal(tip.store, 'F01'); assert.equal(tip.date, '2026-10-15'); assert.equal(tip.fp, TFP);
  const clock = by('clock|F02|2026-10-14|Crew B');
  assert.ok(clock); assert.equal(clock.fp, '2026-10-14T17:02'); assert.equal(clock.store, 'F02'); assert.equal(clock.who, 'Crew B');
  const ow = by('ow|Crew A|2026-10-11');
  assert.ok(ow); assert.deepEqual(ow.stores, ['F01', 'F02']); assert.equal(ow.fp, '40|mid'); assert.equal(ow.dateLabel, '10/11〜10/17');
  assert.ok(by('emp|email|e1') && by('emp|email|e1').store === 'F01');
  assert.equal(by('emp|resign|e3').fp, '2026-10-01|在籍');
  assert.equal(by('emp|dob|e2').store, 'F02');
  assert.equal(by('ob|ob1').fp, '提出完了'); assert.equal(by('ob|ob1').store, 'F02');
  assert.ok(by('close|2026-09')); assert.equal(by('close|2026-09').store, '');
  const inv = by('inv|F01|m|i1'); assert.ok(inv); assert.equal(inv.fp, '2026-09|-1|10|-11'); assert.equal(inv.date, '2026-09-01');
  // Duplicate names: the fingerprint is the count (a third person with the same name shows again).
  const dup = app({ fns: [] });
  dup.getEmployees = () => [{ id: 'x1', name: 'Same', store: 'F01', status: '在籍', email: 'a@x', dob: '1' }, { id: 'x2', name: 'Same', store: 'F02', status: '在籍', email: 'b@x', dob: '1' }];
  const d = plain(run(dup, 'ecDetEmpMaster()')).find(x => x.key === 'empdup|name|Same');
  assert.equal(d.fp, '2');
  // Inventory lines without id or name get separate keys (by line number).
  const noName = app({ st: { inv_hist_F02: [{ ym: '2026-09', lines: [{ actual: -1, theory: 5, diff: -6 }, { actual: -2, theory: 5, diff: -7 }] }] } });
  const nk = plain(run(noName, 'ecDetInventory()')).map(x => x.key);
  assert.deepEqual(nk, ['inv|F02|m|#0', 'inv|F02|m|#1']);
  // Keys are unique (one issue per key).
  assert.equal(new Set(all.map(x => x.key)).size, all.length);
  // An issue without a key gets one from its type and title, and its details as fingerprint.
  const n = plain(run(c, '_ecNorm({ cat:"X", title:"Store Two：something", detail:"d1" })'));
  assert.equal(n.key, 'x|X|Store Two：something'); assert.equal(n.fp, 'd1'); assert.equal(n.store, 'F02');
});

test('a cleared issue stays cleared while its fingerprint is the same, and shows again when the details change', () => {
  const rec = { key: 'clock|F02|2026-10-14|Crew B', fp: '2026-10-14T17:02', why: 'done', by: 'Marcia', at: '2026-10-16T19:00:00.000Z', _at: NOW - 10 };
  const c = app({ st: { ec_resolutions: { [RID('clock|F02|2026-10-14|Crew B', '2026-10-14T17:02')]: rec } }, labor: { 'F02|2026-10-14': { 'Crew B': { shifts: [{ inDate: '2026-10-14T17:02' }] } } } });
  const open = () => plain(run(c, 'ecOpenIssues()')).map(x => x.key);
  assert.ok(!open().includes('clock|F02|2026-10-14|Crew B'));
  assert.ok(open().includes(TK));
  // The clock-in time is corrected in Toast: a different fingerprint, so it shows again.
  c.getTipLabor = () => ({ 'Crew B': { shifts: [{ inDate: '2026-10-14T17:30' }] } });
  assert.ok(open().includes('clock|F02|2026-10-14|Crew B'));
  // Undone (off) records do not clear anything.
  c.getTipLabor = () => ({ 'Crew B': { shifts: [{ inDate: '2026-10-14T17:02' }] } });
  c.S.ec_resolutions[RID('clock|F02|2026-10-14|Crew B', '2026-10-14T17:02')].off = true;
  assert.ok(open().includes('clock|F02|2026-10-14|Crew B'));
});

test('two devices clearing different issues keep both; the newer record wins (ties decided the same on every device); undo is not overwritten; old undone / handled records expire', () => {
  const c = app();
  const A = { [RID(TK, TFP)]: { key: TK, fp: TFP, why: 'done', _at: NOW - 100 } };
  const B = { [RID('emp|email|e1')]: { key: 'emp|email|e1', fp: '', why: 'false', _at: NOW - 80 } };
  const mg = (a, b) => plain(run(c, 'mergeEcRes(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')'));
  assert.deepEqual(Object.keys(mg(A, B)).sort(), [RID('emp|email|e1'), RID(TK, TFP)]);
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(A) + ',' + JSON.stringify(B) + ')'), false);
  const newer = { [RID(TK, TFP)]: Object.assign({}, A[RID(TK, TFP)], { _at: NOW - 10, off: true }) };
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(A) + ',' + JSON.stringify(newer) + ')'), false, 'an older cloud record does not cover a newer one');
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(newer) + ',' + JSON.stringify(A) + ')'), true);
  const undo = { [RID(TK, TFP)]: { key: TK, fp: TFP, why: 'done', _at: NOW - 50, off: true } };
  for (const [cl, lo] of [[A, undo], [undo, A]]) assert.equal(mg(cl, lo)[RID(TK, TFP)].off, true);
  // Same time on two devices (a skewed clock): both devices keep the same record.
  const X = { [RID('k')]: { key: 'k', fp: '', why: 'done', memo: 'a', _at: NOW - 5 } }, Y = { [RID('k')]: { key: 'k', fp: '', why: 'false', memo: 'b', _at: NOW - 5 } };
  assert.deepEqual(mg(X, Y), mg(Y, X));
  // Undone records are dropped after 120 days, "handled" after 400 days; "not a problem" / "not applicable" stay.
  const day = 86400000;
  const old = {
    [RID('a')]: { key: 'a', fp: '', why: 'false', _at: NOW - 121 * day, off: true },
    [RID('b')]: { key: 'b', fp: '', why: 'done', _at: NOW - 401 * day },
    [RID('c')]: { key: 'c', fp: '', why: 'false', _at: NOW - 900 * day },
    [RID('d')]: { key: 'd', fp: '', why: 'na', _at: NOW - 900 * day },
    [RID('e')]: { key: 'e', fp: '', why: 'done', _at: NOW - 300 * day },
  };
  for (const merged of [mg(old, {}), mg({}, old)]) {
    assert.deepEqual(Object.keys(merged).sort(), [RID('a'), RID('b'), RID('c'), RID('d'), RID('e')]);
    // Undone / handled records shrink to a small undo mark (kept, so a stale copy cannot bring the clear back).
    assert.deepEqual(merged[RID('a')], { key: 'a', fp: '', off: true, _m: 1, _at: NOW - 121 * day });
    assert.deepEqual(merged[RID('b')], { key: 'b', fp: '', off: true, _m: 1, _at: NOW - 401 * day });
    assert.equal(merged[RID('c')].why, 'false'); assert.equal(merged[RID('e')].why, 'done');
  }
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(mg(old, {})) + ',' + JSON.stringify(old) + ')'), true, 'the shrunk cloud covers the long form');
  // A device unused for months still holds the clear before it was undone: the mark in the cloud wins.
  const stale = { [RID('a')]: { key: 'a', fp: '', why: 'false', _at: NOW - 200 * day } };
  const back = mg(mg(old, {}), stale);
  assert.equal(back[RID('a')].off, true, 'the old clear does not come back');
  // Marks are dropped after three years.
  assert.equal(RID('z') in mg({ [RID('z')]: { key: 'z', fp: '', off: true, _m: 1, _at: NOW - 1100 * day } }, {}), false);
  assert.equal(run(c, '_coversEcRes({},' + JSON.stringify({ [RID('z')]: { key: 'z', fp: '', off: true, _m: 1, _at: NOW - 1100 * day } }) + ')'), true, 'a dropped mark is not required in the cloud');
  // Same time, different content: the cloud covers only when it holds the version the merge would keep.
  const RA = { [RID('t')]: { key: 't', fp: '', why: 'done', memo: 'a', _at: NOW - 5 } }, RB = { [RID('t')]: { key: 't', fp: '', why: 'false', memo: 'b', _at: NOW - 5 } };
  const win = JSON.stringify(RA[RID('t')]) > JSON.stringify(RB[RID('t')]) ? RA : RB, lose = win === RA ? RB : RA;
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(lose) + ',' + JSON.stringify(win) + ')'), false);
  assert.equal(run(c, '_coversEcRes(' + JSON.stringify(win) + ',' + JSON.stringify(lose) + ')'), true);
});

test('clearing: the reason, note, who and when are saved after reading the cloud; the issue leaves the list; undo brings it back', async () => {
  const cloud = { ec_resolutions: { [RID('emp|email|e1')]: { key: 'emp|email|e1', fp: '', why: 'false', by: 'Moto', _at: NOW - 50 } } };
  const c = app({ role: 'office_crew', user: 'Akane', cloud });
  const html = run(c, 'renderErrorCenter(true)');
  assert.match(html, /ecOpenResolve\(/, 'office crew gets 解除 buttons (6A)');
  const shown = plain(run(c, '_ecShown'));
  const i = shown.findIndex(x => x.key === TK);
  assert.ok(i >= 0);
  run(c, 'ecOpenResolve(' + i + ')');
  assert.equal(c.modals.length, 1);
  assert.match(c.modals[0], /value="na"/, 'an issue with a store offers "この店は対象外"');
  c._why = 'na'; c._memo = '  現金の扱いが無い店  ';
  await run(c, 'ecResolveGo()'); await tick();
  assert.ok(c.pulls >= 1, 'reads the cloud before saving');
  const r = c.S.ec_resolutions[RID(TK, TFP)];
  assert.equal(r.why, 'na'); assert.equal(r.memo, '現金の扱いが無い店'); assert.equal(r.by, 'Akane'); assert.equal(r.role, 'office_crew');
  assert.equal(r.fp, TFP); assert.equal(r.store, 'F01'); assert.equal(r.off, false); assert.ok(r._at >= NOW);
  assert.ok(c.S.ec_resolutions[RID('emp|email|e1')], 'the other device\'s record was merged in, not dropped');
  assert.equal(r.key, TK);
  assert.equal(c.closed, 1);
  assert.ok(!plain(run(c, 'ecOpenIssues()')).some(x => x.key === TK));
  run(c, 'renderErrorCenter(true)');
  assert.ok(!plain(run(c, '_ecShown')).some(x => x.key === TK), 'the list leaves it out');
  // The cleared tab lists it with an undo button.
  run(c, 'ecView="res"');
  const resHtml = run(c, 'renderErrorCenter(true)');
  assert.match(resHtml, /この店は対象外/); assert.match(resHtml, /現金の扱いが無い店/); assert.match(resHtml, /ecUndoResolve\(/);
  const rs = plain(run(c, '_ecResShown'));
  const j = rs.findIndex(x => x.key === TK);
  assert.equal(rs[j]._now, 'same');
  await run(c, 'ecUndoResolve(' + j + ')'); await tick();
  assert.equal(c.S.ec_resolutions[RID(TK, TFP)].off, true);
  assert.equal(c.S.ec_resolutions[RID(TK, TFP)].offBy, 'Akane');
  assert.ok(c.S.ec_resolutions[RID(TK, TFP)]._at > r._at);
  assert.ok(plain(run(c, 'ecOpenIssues()')).some(x => x.key === TK));
});

test('clearing: only CEO / GM / accounting / office crew; no "not applicable" for an issue without a store; a reason is required', async () => {
  for (const role of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(run(app({ role }), 'ecCanResolve() && ecCanView()'), true, role);
  for (const role of ['am', 'sl', 'crew', 'chef']) {
    const c = app({ role });
    assert.equal(run(c, 'ecCanResolve() || ecCanView()'), false, role);
    const h = run(c, 'renderErrorCenter(true)');
    assert.doesNotMatch(h, /ecOpenResolve/); assert.match(h, /CEO・GM・経理・事務Crew/);
    c._why = 'done'; run(c, '_ecModal={key:"tipinv|F01|2026-10-15",fp:"lunch=-5",stores:["F01"]}');
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
  assert.equal(c.S.ec_resolutions[RID('close|2026-09')].why, 'false');
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
  assert.deepEqual(keys, [TK]);
  assert.match(h, /<option value="F01" selected>/);
});

test('the past log does not count issues cleared as "not a problem" (7A); other reasons are counted; cleared issues are not logged after', () => {
  const st = {
    ec_resolutions: {
      [RID('emp|email|e1')]: { key: 'emp|email|e1', fp: '', why: 'false', cat: '従業員', title: 'Crew A：Email未登録', _at: NOW - 5 },
      [RID('emp|dob|e2')]: { key: 'emp|dob|e2', fp: '', why: 'done', cat: '従業員', title: 'Crew B：生年月日 未登録', _at: NOW - 6 },
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
  const tip = today.find(r => r.key === TK);
  assert.equal(tip.store, 'F01'); assert.equal(tip.emp, '');
});

test('7A: clearing a later occurrence of the same issue keeps the earlier judgement (inventory every month, a corrected clock-in)', async () => {
  const inv = (ym, fp) => ({ date: ym + '-05', title: 'Store One：Rice 異常値', cat: '棚卸', sev: 'mid', store: 'F01', emp: '', key: 'inv|F01|m|i1', fp });
  const st = {
    inv_hist_F01: [{ ym: '2026-10', lines: [{ id: 'i1', name: 'Rice', actual: -2, theory: 10, diff: -12 }] }],
    ec_resolutions: { [RID('inv|F01|m|i1', '2026-09|-1|10|-11')]: { key: 'inv|F01|m|i1', fp: '2026-09|-1|10|-11', why: 'false', cat: '棚卸', title: 'Store One：Rice 異常値', _at: NOW - 1000 } },
    ec_log: [inv('2026-09', '2026-09|-1|10|-11'), inv('2026-10', '2026-10|-2|10|-12'),
      { date: '2026-08-05', title: 'Store One：Rice 異常値', cat: '棚卸', sev: 'mid', store: 'F01', emp: '' }],   // August, before v1088 (no key)
  };
  const c = app({ st, role: 'office' });
  run(c, 'renderErrorCenter(true)');
  const i = plain(run(c, '_ecShown')).findIndex(x => x.key === 'inv|F01|m|i1');
  assert.ok(i >= 0, 'October shows again');
  run(c, 'ecOpenResolve(' + i + ')'); c._why = 'false';
  await run(c, 'ecResolveGo()');
  assert.equal(Object.keys(c.S.ec_resolutions).length, 2, 'the September record is kept');
  const counted = plain(run(c, 'ecLogInRange().filter(function(r){ return r.cat==="棚卸" && ecLogCounted(r); })')).map(r => r.date);
  assert.deepEqual(counted, ['2026-08-05'], 'both judged months are out; the old August row (no key) is not matched by an inventory title');
  const rows = plain(run(c, '_ecResRows()'));
  assert.deepEqual(rows.map(r => r._now), ['same', 'replaced']);
});

test('the cleared tab shows whether each record is still detected, changed or gone', () => {
  const R = (key, fp, o) => ({ [RID(key, fp)]: Object.assign({ key, fp }, o) });
  const st = { ec_resolutions: Object.assign({},
    R(TK, TFP, { why: 'done', title: 't1', _at: NOW - 3 }),
    R('emp|email|e1', 'other', { why: 'done', title: 't2', _at: NOW - 4 }),
    R('tip|F02|2026-10-01', '', { why: 'false', title: 't3', _at: NOW - 5 }),
    R('tip|F03|2026-10-02', '', { why: 'done', title: 't4', _at: NOW - 1, off: true })) };
  const c = app({ st });
  const rows = plain(run(c, '_ecResRows()'));
  assert.deepEqual(rows.map(r => r.key + ':' + r._now), [TK + ':same', 'emp|email|e1:changed', 'tip|F02|2026-10-01:gone']);
  const open = plain(run(c, 'ecOpenIssues()')).map(x => x.key);
  assert.ok(open.includes('emp|email|e1'), 'changed details show under current again');
  assert.ok(!open.includes(TK));
});

test('overwork that grows from 確認 to 要対応 shows again after it was cleared', () => {
  const c = app();
  const fp1 = plain(run(c, 'ecCollect()')).find(x => x.key === 'ow|Crew A|2026-10-11').fp;
  c.S.ec_resolutions = { [RID('ow|Crew A|2026-10-11', fp1)]: { key: 'ow|Crew A|2026-10-11', fp: fp1, why: 'done', _at: NOW - 1 } };
  assert.ok(!plain(run(c, 'ecOpenIssues()')).some(x => x.key === 'ow|Crew A|2026-10-11'));
  c.owScanWeek = () => [{ name: 'Crew A', over: 5, max: 40, total: 45, grade: 'G1', byStore: { F01: 45 }, weekDone: false }];
  assert.ok(!plain(run(c, 'ecOpenIssues()')).some(x => x.key === 'ow|Crew A|2026-10-11'), 'more hours at the same weight stay cleared');
  c.owScanWeek = () => [{ name: 'Crew A', over: 9, max: 40, total: 49, grade: 'G1', byStore: { F01: 49 }, weekDone: false }];
  const x = plain(run(c, 'ecOpenIssues()')).find(x => x.key === 'ow|Crew A|2026-10-11');
  assert.ok(x && x.sev === 'high', 'escalated to 要対応: shows again');
});

test('7A: overwork cleared as "not a problem" that grows to 要対応 the same day is still counted in the past log (Codex P2 on 79d5675)', async () => {
  const OW = 'ow|Crew A|2026-10-11';
  const c = app({ missingTip: [] });
  run(c, 'ecSnapshot()');
  const mid = plain(c.S.ec_log).find(r => r.key === OW);
  assert.equal(mid.sev, 'mid');
  // Cleared as a false alarm at 43h.
  c.S.ec_resolutions = { [RID(OW, mid.fp)]: { key: OW, fp: mid.fp, why: 'false', cat: mid.cat, title: mid.title, _at: NOW - 1 } };
  const counted = () => plain(run(c, 'ecLogInRange().filter(function(r){ return ecLogCounted(r); })')).filter(r => r.title === mid.title);
  assert.equal(counted().length, 0);
  // The same day it grows to 49h (same stores, so the same title): it shows again (要対応) and the next record counts it,
  // still one row for the day.
  c.owScanWeek = () => [{ name: 'Crew A', over: 9, max: 40, total: 49, grade: 'G1', byStore: { F01: 30, F02: 19 }, weekDone: false }];
  const high = plain(run(c, 'ecOpenIssues()')).find(x => x.key === OW);
  assert.equal(high.sev, 'high');
  assert.equal(high.title, mid.title);
  assert.equal(run(c, 'ecSnapshot()'), 1);
  assert.equal(c.S.ec_log.filter(r => r.date === '2026-10-16' && r.title === mid.title).length, 1, 'one row for the day');
  assert.equal(counted().length, 1);
  assert.equal(run(c, 'ecLogSev(' + JSON.stringify(c.S.ec_log.find(r => r.title === mid.title)) + ')'), 'high');
  assert.match(run(c, 'ecRenderLogView()'), /●1<\/span> <span style="color:#e0a020">●0/);
  assert.equal(run(c, 'ecSnapshot()'), 0, 'the same details are not added twice');
  // Cleared as a false alarm at 49h as well: nothing counted.
  c.S.ec_resolutions[RID(OW, high.fp)] = { key: OW, fp: high.fp, why: 'false', cat: high.cat, title: high.title, _at: NOW };
  assert.equal(counted().length, 0);
  // Another device logged the 49h row while this one had the 43h row: the merge keeps both details (either order), and the cloud with
  // only the 43h row does not cover the 49h one.
  const rowMid = { ...mid, ts: 1 }, rowHigh = { ...mid, id: 'ecB', ts: 2, sev: 'high', fp: high.fp };
  delete c.S.ec_resolutions[RID(OW, high.fp)];
  for (const [x, y] of [[[rowMid], [rowHigh]], [[rowHigh], [rowMid]]]) {
    const m = plain(run(c, 'mergeEcLog(' + JSON.stringify(x) + ',' + JSON.stringify(y) + ')'));
    assert.equal(m.length, 1);
    assert.deepEqual(m[0].parts.map(p => p.sev).sort(), ['high', 'mid']);
    assert.equal(m[0].ts, 1, 'the earlier row is kept');
    assert.equal(run(c, 'ecLogSev(' + JSON.stringify(m[0]) + ')'), 'high');
    assert.equal(run(c, '_coversEcLog(' + JSON.stringify(m) + ',' + JSON.stringify([rowHigh]) + ')'), true);
    // Merging again (the cloud row came back through jsonb with its keys reordered) gives the same row.
    const back = m.map(r => Object.fromEntries(Object.entries(r).reverse().map(([k, v]) => [k, Array.isArray(v) ? v.map(o => Object.fromEntries(Object.entries(o).reverse())) : v])));
    assert.deepEqual(plain(run(c, 'mergeEcLog(' + JSON.stringify(back) + ',' + JSON.stringify(m) + ')'))[0].parts, m[0].parts);
  }
  assert.equal(run(c, '_coversEcLog(' + JSON.stringify([rowMid]) + ',' + JSON.stringify([rowHigh]) + ')'), false);
  // Without pressing 今すぐ記録: opening the error center again the same day records the new details (the day's first record was
  // made already); opening it again with nothing changed writes nothing.
  const d = app({ missingTip: [] });
  run(d, 'renderErrorCenter(true)'); await tick();
  const row0 = plain(d.S.ec_log).find(r => r.key === OW);
  d.S.ec_resolutions = { [RID(OW, row0.fp)]: { key: OW, fp: row0.fp, why: 'false', cat: row0.cat, title: row0.title, _at: NOW - 1 } };
  const w0 = d.writes.filter(k => k === 'ec_log').length;
  run(d, 'renderErrorCenter(true)'); await tick();   // the open issues changed (one cleared) but nothing new to add
  run(d, 'renderErrorCenter(true)'); await tick();
  assert.equal(d.writes.filter(k => k === 'ec_log').length, w0, 'nothing new: the log is not written again');
  d.owScanWeek = () => [{ name: 'Crew A', over: 9, max: 40, total: 49, grade: 'G1', byStore: { F01: 30, F02: 19 }, weekDone: false }];
  run(d, 'renderErrorCenter(true)'); await tick();
  const row1 = plain(d.S.ec_log).filter(r => r.date === '2026-10-16' && r.title === row0.title);
  assert.equal(row1.length, 1);
  assert.equal(run(d, 'ecLogSev(' + JSON.stringify(row1[0]) + ')'), 'high');
  assert.ok(!('ec_log_sig' in d.S && d.S.ec_log_sig.length > 40), 'only a short mark is kept on the device');
  // Rows without parts are merged and covered as before.
  assert.equal(run(c, '_coversEcLog(' + JSON.stringify([rowMid]) + ',' + JSON.stringify([{ ...rowMid, id: 'x', ts: 5 }]) + ')'), true);
  assert.ok(!('parts' in plain(run(c, 'mergeEcLog(' + JSON.stringify([rowMid]) + ',' + JSON.stringify([{ ...rowMid, id: 'x', ts: 5 }]) + ')'))[0]));
});

test('clears pushed through a jsonb cloud row (keys come back reordered) are confirmed in one upsert, and ties are decided the same on every device', async () => {
  const { PGlite } = await import('./runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  await db.exec('create table app_state(key text primary key, value jsonb)');
  const c = app();
  vm.runInContext(fnSrc('opMergePush'), c);
  let ups = 0;
  Object.assign(c, {
    _opMergeDef: () => ({ merge: c.mergeEcRes, covers: c._coversEcRes }), _opMergeChain: {}, _opLastPushErr: {}, _opWriteBack: () => {},
    _opUpsertRow: (k, v) => ({ key: k, value: v }), console,
    supaUpsert: async (_t, rows) => { ups++; for (const r of rows) await db.query('insert into app_state values($1,$2) on conflict(key) do update set value=excluded.value', [r.key, JSON.stringify(r.value)]); return true; },
    _fetchOpValue: async k => { const r = await db.query('select value::text as v from app_state where key=$1', [k]); return r.rows.length ? JSON.parse(r.rows[0].v) : null; },
  });
  const rec = { key: TK, fp: TFP, why: 'false', memo: 'x', by: 'Marcia', role: 'office', at: '2026-10-16T19:30:00.000Z', off: false, cat: 'チップ', title: 't', store: 'F01', stores: ['F01'], date: '2026-10-15', dateLabel: '', sev: 'high', _at: NOW };
  const local = { [RID(rec.key)]: rec };
  assert.equal(await run(c, 'opMergePush')('ec_resolutions', local), true);
  assert.equal(ups, 1, 'confirmed on the first try');
  const back = (await db.query("select value::text as v from app_state where key='ec_resolutions'")).rows[0].v;
  assert.notEqual(Object.keys(JSON.parse(back)[RID(rec.key)]).join(), Object.keys(rec).join(), 'jsonb did reorder the keys (the case being checked)');
  // A second device with a different record at the same time: both orders and both key orders give the same winner.
  const other = Object.assign({}, rec, { why: 'done', memo: 'y', by: 'Akane' });
  const reordered = o => Object.fromEntries(Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map(k => [k, o[k]]));
  const w1 = plain(run(c, 'mergeEcRes(' + JSON.stringify({ k: reordered(rec) }) + ',' + JSON.stringify({ k: other }) + ')')).k.why;
  const w2 = plain(run(c, 'mergeEcRes(' + JSON.stringify({ k: other }) + ',' + JSON.stringify({ k: rec }) + ')')).k.why;
  const w3 = plain(run(c, 'mergeEcRes(' + JSON.stringify({ k: reordered(other) }) + ',' + JSON.stringify({ k: reordered(rec) }) + ')')).k.why;
  assert.equal(w1, w2); assert.equal(w2, w3);
  ups = 0;
  assert.equal(await run(c, 'opMergePush')('ec_resolutions', { [RID(rec.key)]: other }), true);
  assert.ok(ups <= 2, 'settles within the push');
  await db.close();
});

test('the dialog: cancelling while the save waits for the cloud saves nothing; a second dialog waits for the first save; "not applicable" only for store operations', async () => {
  let release;
  const c = app({ role: 'gm', user: 'Moto', cloud: { ec_resolutions: {} } });
  c.pullOpKey = () => new Promise(r => { release = () => r(true); });
  run(c, '_ecPullAt=Date.now()');   // no automatic read when the screen opens
  run(c, 'renderErrorCenter(true)');
  const shown = plain(run(c, '_ecShown'));
  const tip = shown.findIndex(x => x.key === TK);
  run(c, 'ecOpenResolve(' + tip + ')'); c._why = 'done';
  const p = run(c, 'ecResolveGo()');
  run(c, 'ecOpenResolve(' + tip + ')');
  assert.equal(c.modals.length, 1, 'a second dialog does not open while saving');
  run(c, 'ecCloseResolve()');   // やめる while the cloud read is pending
  release(); await p;
  assert.deepEqual(c.S.ec_resolutions || {}, {}, 'nothing saved after cancelling');
  assert.ok(c.toasts.some(t => /やめました/.test(t[0])));
  // Closed by tapping outside, and another dialog opened while waiting: not saved either.
  const btn = {}; let cur = btn, overlayOpen = true;
  c.document = { querySelector: () => ({ value: 'done' }), getElementById: id => (id === 'ec-res-go' ? cur : id === 'modal-overlay' ? { classList: { contains: () => overlayOpen } } : null) };
  run(c, '_ecShown=' + JSON.stringify(shown));
  run(c, 'ecOpenResolve(' + tip + ')');
  const p2 = run(c, 'ecResolveGo()');
  cur = { other: true };   // a different dialog is open now
  release(); await p2;
  assert.deepEqual(c.S.ec_resolutions || {}, {}, 'nothing saved when another dialog replaced it');
  c.document = { querySelector: () => ({ value: 'done' }), getElementById: id => (id === 'ec-res-go' ? btn : id === 'modal-overlay' ? { classList: { contains: () => true } } : null) };
  run(c, 'ecOpenResolve(' + tip + ')');
  const p3 = run(c, 'ecResolveGo()'); release(); await p3;
  assert.equal(c.S.ec_resolutions[RID(TK, TFP)].why, 'done', 'a normal clear still saves');
  // "この店は対象外" is offered for tips, attendance and inventory, not for employee / onboarding / monthly close items.
  assert.equal(run(c, '_ecNaOk({ cat:"勤怠", store:"", key:"k" })'), false, 'not without a store');
  assert.equal(run(c, '_ecNaOk({ cat:"勤怠", store:"F01", key:"k" })'), true);
  for (const [key, na] of [[TK, true], ['ow|Crew A|2026-10-11', true], ['emp|email|e1', false], ['close|2026-09', false]]) {
    const i = shown.findIndex(x => x.key === key);
    c.modals.length = 0; run(c, 'ecOpenResolve(' + i + ')');
    assert.equal(/value="na"/.test(c.modals[0]), na, key);
    run(c, 'ecCloseResolve()');
  }
});

test('the daily log snapshot waits for the cloud read, so an issue cleared on another device is not logged today', async () => {
  const cloud = { ec_resolutions: { [RID(TK, TFP)]: { key: TK, fp: TFP, why: 'done', _at: NOW - 9 } } };
  const c = app({ cloud });
  run(c, 'renderErrorCenter(true)');
  run(c, 'ecSetSort("store"); renderErrorCenter(true)');   // drawn again while the read is still in flight
  assert.equal((c.S.ec_log || []).length, 0, 'not logged before the read');
  await tick();
  const today = (c.S.ec_log || []).filter(r => r.date === '2026-10-16').map(r => r.key);
  assert.ok(today.length > 0);
  assert.ok(!today.includes(TK));
});

test('the past-log view opened first thing in the day is drawn again once today\'s rows are written', async () => {
  const c = app({ cloud: { ec_resolutions: {} } });
  run(c, 'ecView="log"');
  const h = run(c, 'renderErrorCenter(true)');
  assert.match(h, /記録された過去ログはまだありません/);
  await tick();
  assert.ok((c.S.ec_log || []).length > 0);
  assert.deepEqual(c.rendered, ['tasks']);
});

test('opening the error center reads the cloud at most once a minute and redraws only while it is still open', async () => {
  const cloud = { ec_resolutions: { [RID(TK, TFP)]: { key: TK, fp: TFP, why: 'done', _at: NOW - 7 } } };
  const c = app({ cloud });
  run(c, 'renderErrorCenter(true)'); await tick();
  assert.equal(c.pulls, 1);
  assert.deepEqual(c.rendered, ['tasks'], 'redraws after the cloud brought a new record');
  run(c, 'renderErrorCenter(true)'); await tick();
  assert.equal(c.pulls, 1, 'not again within a minute');
  // Nothing new in the cloud: no redraw.
  const same = app({ cloud: { ec_resolutions: {} } });
  run(same, 'renderErrorCenter(true)'); await tick();
  assert.equal(same.pulls, 1); assert.deepEqual(same.rendered, []);
  // Moved away while reading: no redraw over another page.
  const d = app({ cloud: { ec_resolutions: { [RID('x')]: { key: 'x', fp: '', why: 'false', _at: NOW - 1 } } } });
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
  assert.match(SRC, /ec_resolutions: \{ merge: mergeEcRes, covers: _coversEcRes \}/);
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

test('cash tip (v1118): missing cash tips are no longer notified; earlier notices are hidden, not deleted; no task is created', () => {
  const S = { tasks_all: [{ id: 'old', refId: 'ctip_F02_2026-10-15', auto: 'cashtip', status: '進行中' }],
    notifications: [{ id: 'n1', refId: 'ctip_F01_2026-10-14', toStore: 'F01', title: 'キャッシュチップ未入力: Store One' }, { id: 'n2', refId: 'other_1', toStore: 'F01', title: 'x' }] };
  const c = {
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    window: {}, S, notifs: [], curUserName: 'SL', curRole: 'sl', curStore: 'F01',
    isoOf: d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    getTasks: () => S.tasks_all, getNotifs: () => S.notifications, addNotif: n => { S.notifications.push(n); c.notifs.push(n); },
    activeStores: () => STORES, cashTipMissing: () => true, console,
  };
  vm.createContext(c);
  vm.runInContext(fnSrc('notifHasRef') + '\n' + fnSrc('checkCashTipNotify') + '\n' + fnSrc('notifRetired'), c);
  vm.runInContext('checkCashTipNotify()', c);
  assert.equal(c.notifs.length, 0, 'no new notice even if something still reports a missing cash tip');
  assert.deepEqual(S.tasks_all.map(t => t.id), ['old'], 'no task is created and the old one is not changed');
  assert.equal(S.notifications.length, 2, 'earlier notices are kept (not deleted)');
  assert.equal(vm.runInContext('notifRetired(S.notifications[0])', c), true);
  assert.equal(vm.runInContext('notifRetired(S.notifications[1])', c), false);
  assert.match(bodyOf('notifForMe'), /notifRetired\(n\)\) return false;/, 'the list and unread count leave out the earlier cash tip notices');
});

test('the dashboard rail and work center count only open issues', () => {
  const c = app({ st: { ec_resolutions: { [RID(TK, TFP)]: { key: TK, fp: TFP, why: 'done', _at: NOW - 1 } } }, fns: ['mdErrors'] });
  const n = plain(run(c, 'mdErrors()')).length;
  assert.equal(n, plain(run(c, 'ecCollect()')).length - 1);
});

test('release markers are 1088 or later, the page and the service worker the same', () => {
  const v = Number((/const APP_VERSION = '(\d+)';/.exec(SRC) || [])[1]);
  assert.ok(v >= 1088, String(v));
  assert.ok(SW.includes("const SW_BUILD = '" + v + "';"));
});
