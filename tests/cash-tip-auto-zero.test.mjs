// v1118（Moto さん 2026-10-30 ①「キャッシュチップ：未登録を自動で0にする」）
//  App (index.html in a VM, synthetic data):
//   - a missing cash tip counts as 0 and is no error anywhere (error center, tip period, notes, notices); invalid values still are;
//   - "automatic 0" (<side>Auto) never beats a value a person entered, in v1118 and in the v1117 merge (no timestamp on the automatic record);
//   - earlier "未登録" past-log rows and notices are not counted / shown (kept, not deleted).
//  Server (migration 20261031090000 in PGlite, synthetic data, no production data):
//   - cash_tip_autofill fills only the missing sides of finished business days that have sales or credit tips;
//     entered values (0 too), invalid values and legacy "entered" records are untouched; today and excluded stores are not filled;
//     a dry run writes nothing; a second run adds nothing; undo restores only the sides still automatic;
//   - only service_role can run it.
//  Deploy: the ops-bot bundle is built from the current sources; the rollback is the v1105 bundle.
// FUNERGY_INDEX=<path> runs the app checks against another build (v1117 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const MIG = fs.readFileSync(path.join(root, 'supabase/migrations/20261031090000_cash_tip_autofill.sql'), 'utf8');

function fnSrcOf(src, name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const fnSrc = name => fnSrcOf(SRC, name);
function bodyOf(name) { const i = SRC.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); if (i < 0) throw new Error('not found: ' + name); return SRC.slice(i, SRC.indexOf('\n}', i) + 2); }

const FNS = ['getCashTips', 'getCashTip', 'setCashTips', 'saveCashTipSides', 'isNoCashTipStore', 'cashTipSideEntered', 'cashTipSideAuto', '_ctSideState',
  'cashTipValueOk', 'cashTipInvalid', 'cashTipZeroSides', 'cashTipMissing', 'cashTipNeededSides', '_cashTs', 'mergeCashTips', '_coversCashTips',
  'cashTipNoteHtml', '_tipCashCanEdit', 'tipCashCellHtml', 'ecDetCashTip', 'ecLogCashTipUnset', '_ecPartSig', '_ecLogParts', 'ecLogSev', 'notifRetired',
  'checkCashTipNotify'];
const STORES = [{ id: 'F01', name: 'Store One' }, { id: 'F03', name: 'Store Three' }];
function app({ st = {}, today = '2026-10-30', role = 'gm', actuals = {} } = {}) {
  const S = JSON.parse(JSON.stringify(st));
  const c = {
    S, STORES, curRole: role, curUserName: 'Synthetic GM', curLang: 'ja',
    t: ja => ja, ls: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), lsSet: (k, v) => { S[k] = JSON.parse(JSON.stringify(v)); return true; },
    todayISO: () => today, myName: () => 'Synthetic GM', nowJP: () => '2026/10/30 21:00',
    dayClosureMode: () => null, tipDayLunchOff: () => false, getDailyActuals: sid => actuals[sid] || {},
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  };
  vm.createContext(c);
  vm.runInContext(['var NO_CASHTIP_STORES = ["F03","F03-G"];', "var EC_MIN_DATE = '2026-07-01';"].concat(FNS.map(fnSrc)).join('\n'), c);
  return c;
}
const run = (c, e) => vm.runInContext(e, c);
const J = v => JSON.parse(JSON.stringify(v));

// The record the server writes (cash_tip_autofill): no at / editedAt
const AUTO_BOTH = { lunch: 0, lunchEntered: true, lunchAuto: true, dinner: 0, dinnerEntered: true, dinnerAuto: true, entered: true, autoBy: 'system', autoAt: '2026-10-21 04:17' };
const REAL_LUNCH = { lunch: 12.5, lunchEntered: true, entered: false, by: 'Crew A', at: '2026/10/20 21:00' };

test('merge: a value a person entered (0 too) always beats the automatic 0, side by side, in either order', () => {
  const c = app();
  const m = (a, b) => J(run(c, 'mergeCashTips(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')'));
  for (const [cloud, local] of [[{ d: AUTO_BOTH }, { d: REAL_LUNCH }], [{ d: REAL_LUNCH }, { d: AUTO_BOTH }]]) {
    const r = m(cloud, local).d;
    assert.equal(r.lunch, 12.5); assert.equal(r.lunchEntered, true); assert.equal(r.lunchAuto, undefined, 'the person\'s side is not automatic');
    assert.equal(r.dinner, 0); assert.equal(r.dinnerAuto, true, 'the other side stays the automatic 0');
    assert.equal(r.entered, true);
  }
  // A 0 a person entered stays a person's 0
  const real0 = { dinner: 0, dinnerEntered: true, by: 'Crew B', at: '2026/10/20 22:00' };
  for (const [a, b] of [[{ d: AUTO_BOTH }, { d: real0 }], [{ d: real0 }, { d: AUTO_BOTH }]]) assert.equal(m(a, b).d.dinnerAuto, undefined);
  // Only one side has a record: kept as it is
  assert.deepEqual(m({ d: AUTO_BOTH }, {}).d, AUTO_BOTH);
  assert.deepEqual(m({}, { d: AUTO_BOTH }).d, AUTO_BOTH);
  // Both automatic: automatic
  assert.equal(m({ d: AUTO_BOTH }, { d: Object.assign({}, AUTO_BOTH, { autoAt: 'x' }) }).d.lunchAuto, true);
  // The automatic side sits in the newer record (another person entered the other side later); the older record has a person's value
  const filledLater = { lunch: 0, lunchEntered: true, lunchAuto: true, dinner: 3, dinnerEntered: true, entered: true, by: 'Crew Y', at: '2026/10/20 23:00', autoBy: 'system' };
  const olderReal = { lunch: 12.5, lunchEntered: true, by: 'Crew X', at: '2026/10/20 21:00' };
  for (const [a, b] of [[{ d: filledLater }, { d: olderReal }], [{ d: olderReal }, { d: filledLater }]]) {
    const r = m(a, b).d;
    assert.equal(r.lunch, 12.5, 'the older person\'s lunch beats the newer automatic 0'); assert.equal(r.lunchAuto, undefined);
    assert.equal(r.dinner, 3);
  }
  // A stale automatic flag next to a person's non-zero value is not automatic (value must be 0)
  assert.equal(run(c, 'cashTipSideAuto(' + JSON.stringify({ lunch: 7, lunchEntered: true, lunchAuto: true }) + ',"lunch")'), false);
});

test('merge on a v1117 device (no Auto rule): the person\'s value still wins, the automatic side is carried over', { skip: (() => { try { execFileSync('git', ['-C', root, 'cat-file', '-e', '7c5aa13^{commit}'], { stdio: 'ignore' }); return false; } catch { return 'commit 7c5aa13 (v1117) is not in this clone'; } })() }, () => {
  const OLD = execFileSync('git', ['-C', root, 'show', '7c5aa13:index.html'], { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n');
  const c = {}; vm.createContext(c);
  vm.runInContext(fnSrcOf(OLD, '_cashTs') + '\n' + fnSrcOf(OLD, 'mergeCashTips'), c);
  for (const [cloud, local] of [[{ d: AUTO_BOTH }, { d: REAL_LUNCH }], [{ d: REAL_LUNCH }, { d: AUTO_BOTH }]]) {
    const r = J(run(c, 'mergeCashTips(' + JSON.stringify(cloud) + ',' + JSON.stringify(local) + ')')).d;
    assert.equal(r.lunch, 12.5, 'the person\'s lunch');
    assert.equal(r.dinner, 0); assert.equal(r.dinnerEntered, true); assert.equal(r.dinnerAuto, true, 'the automatic dinner stays marked');
  }
  // The v1118 reading of what the old merge produced: lunch is the person's value (12.5 ≠ 0 → not automatic)
  const v = app();
  const r = J(run(c, 'mergeCashTips(' + JSON.stringify({ d: AUTO_BOTH }) + ',' + JSON.stringify({ d: REAL_LUNCH }) + ')')).d;
  assert.equal(run(v, '_ctSideState(' + JSON.stringify(r) + ',"lunch")'), 'real');
  assert.equal(run(v, '_ctSideState(' + JSON.stringify(r) + ',"dinner")'), 'auto');
});

test('covers: a person\'s value that the cloud still has as the automatic 0 is not there yet (the push is retried)', () => {
  const c = app();
  const cov = (h, w) => run(c, '_coversCashTips(' + JSON.stringify(h) + ',' + JSON.stringify(w) + ')');
  const mine = { d: { lunch: 5, lunchEntered: true, dinner: 0, dinnerEntered: true, entered: true, by: 'A', at: '2026/10/20 21:00' } };
  assert.equal(cov({ d: AUTO_BOTH }, mine), false);
  assert.equal(cov({ d: Object.assign({}, AUTO_BOTH, mine.d, { lunchAuto: undefined, dinnerAuto: undefined }) }, mine), true);
  assert.equal(cov({ d: AUTO_BOTH }, { d: AUTO_BOTH }), true);
  // each side on its own
  assert.equal(cov({ d: AUTO_BOTH }, { d: { lunch: 5, lunchEntered: true, by: 'A', at: '2026/10/20 21:00' } }), false, 'lunch');
  assert.equal(cov({ d: AUTO_BOTH }, { d: { dinner: 5, dinnerEntered: true, by: 'A', at: '2026/10/20 21:00' } }), false, 'dinner');
});

test('saving a side removes the automatic mark; the other side keeps it', () => {
  const c = app({ st: { cash_tips_F01: { '2026-10-20': AUTO_BOTH } } });
  run(c, 'saveCashTipSides("F01","2026-10-20",0,null)');
  const r = c.S.cash_tips_F01['2026-10-20'];
  assert.equal(r.lunch, 0); assert.equal(r.lunchAuto, undefined); assert.equal(r.dinnerAuto, true);
  assert.equal(r.by, 'Synthetic GM'); assert.ok(r.at);
  assert.equal(run(c, '_ctSideState(S.cash_tips_F01["2026-10-20"],"lunch")'), 'real');
});

test('invalid values are detected; missing and 0 are not; stores without cash tips are never checked', () => {
  const c = app();
  const ok = v => run(c, 'cashTipValueOk(' + (v === undefined ? 'undefined' : JSON.stringify(v)) + ')');
  for (const v of [undefined, null, '', '  ', 0, 12.5, '0', ' 3.25 ']) assert.equal(ok(v), true, JSON.stringify(v));
  for (const v of ['abc', -1, '-3', '1e999', true, false, [], {}]) assert.equal(ok(v), false, JSON.stringify(v));
  assert.equal(run(c, 'cashTipValueOk(NaN) || cashTipValueOk(Infinity)'), false);
  const d = app({ st: { cash_tips_F01: { a: { lunch: 'x', dinner: -2 }, b: { lunch: 0 }, c: {} }, cash_tips_F03: { a: { lunch: 'x' } } } });
  assert.deepEqual(J(run(d, 'cashTipInvalid("F01","a")')), ['lunch', 'dinner']);
  assert.deepEqual(J(run(d, 'cashTipInvalid("F01","b")')), []);
  assert.deepEqual(J(run(d, 'cashTipInvalid("F01","c")')), []);
  assert.deepEqual(J(run(d, 'cashTipInvalid("F01","none")')), []);
  assert.deepEqual(J(run(d, 'cashTipInvalid("F03","a")')), []);
  assert.equal(run(d, 'cashTipMissing("F01","c")'), false, 'missing is no error any more');
});

test('error center: only invalid values, every finished day since EC_MIN_DATE (not today, not before the start, not the excluded store)', () => {
  const st = { cash_tips_F01: {
    '2026-10-10': {}, '2026-10-11': { lunch: 'abc', lunchEntered: true }, '2026-10-12': { dinner: -3, dinnerEntered: true, lunch: 4, lunchEntered: true },
    '2026-10-13': AUTO_BOTH, '2026-10-30': { lunch: 'x' }, '2026-06-30': { lunch: 'x' } },
    cash_tips_F03: { '2026-10-11': { lunch: 'x' } } };
  const c = app({ st, actuals: { F01: { '2026-10-10': { actual: 500, lunchCreditTip: 10 } } } });
  const is = J(run(c, 'ecDetCashTip()'));
  assert.deepEqual(is.map(x => x.key), ['tipinv|F01|2026-10-11', 'tipinv|F01|2026-10-12']);
  assert.equal(is[0].sev, 'high'); assert.equal(is[0].cat, 'チップ'); assert.equal(is[0].fp, 'lunch=abc'); assert.equal(is[1].fp, 'dinner=-3');
  assert.match(is[0].title, /キャッシュチップの値が不正/);
  assert.match(is[0].fix.action, /openCashTipModal\('F01','2026-10-11'\)/);
  // Fixing the value takes the issue away; a different wrong value shows again (another fingerprint)
  c.S.cash_tips_F01['2026-10-11'].lunch = 8; assert.equal(J(run(c, 'ecDetCashTip()')).length, 1);
  c.S.cash_tips_F01['2026-10-11'].lunch = 'zz'; assert.equal(J(run(c, 'ecDetCashTip()'))[0].fp, 'lunch=zz');
});

test('past log: earlier "キャッシュチップ未登録" rows are not counted (with or without a key); invalid values are', () => {
  const c = app();
  const sev = r => run(c, 'ecLogSev(' + JSON.stringify(r) + ', {})');
  assert.equal(sev({ date: '2026-10-14', key: 'tip|F01|2026-10-13', fp: '', cat: 'チップ', title: 'Store One：2026-10-13 キャッシュチップ未登録', sev: 'high' }), '');
  assert.equal(sev({ date: '2026-09-14', cat: 'チップ', title: 'Store One：2026-09-13 キャッシュチップ未登録', sev: 'high' }), '');
  assert.equal(sev({ date: '2026-10-14', key: 'tipinv|F01|2026-10-13', fp: 'lunch=x', cat: 'チップ', title: 't', sev: 'high' }), 'high');
  // A merged row that also carries another issue still counts that issue
  assert.equal(sev({ date: '2026-10-14', key: 'tip|F01|2026-10-13', fp: '', sev: 'high', parts: [{ key: 'clock|F01|2026-10-13|A', fp: 'x', sev: 'mid' }] }), 'mid');
  assert.match(bodyOf('ecRenderLogView'), /未登録を 0 として補完したので数えていません/);
  assert.equal(run(c, 'ecLogCashTipUnset({key:"tip|F01|2026-10-13"})'), true, 'counted separately in the past-log note');
  assert.equal(run(c, 'ecLogCashTipUnset({key:"tipinv|F01|2026-10-13"}) || ecLogCashTipUnset({cat:"チップ",title:"x"})'), false);
});

test('notices: no new "未入力" notice; earlier ones are hidden from the list and unread count, not deleted', () => {
  const c = app();
  assert.equal(run(c, 'checkCashTipNotify()'), undefined);
  assert.equal(run(c, 'notifRetired({refId:"ctip_F01_2026-10-14"})'), true);
  assert.equal(run(c, 'notifRetired({refId:"other"}) || notifRetired({}) || notifRetired(null)'), false);
  assert.match(bodyOf('notifForMe'), /notifRetired\(n\)\) return false;/);
  assert.doesNotMatch(bodyOf('checkCashTipNotify'), /addNotif/);
});

test('screens: invalid values are an error with a fix button; missing / automatic 0 is a quiet note; the tip period counts only invalid values', () => {
  // dates as keys (the cell compares them with today)
  const bad = '2026-10-21', auto = '2026-10-22', none = '2026-10-23', real = '2026-10-24';
  const st = { cash_tips_F01: { [bad]: { lunch: 'x', lunchEntered: true }, [auto]: AUTO_BOTH, [real]: { lunch: 1, dinner: 2, lunchEntered: true, dinnerEntered: true, entered: true, by: 'A', at: 'x' } } };
  const act = { F01: { [bad]: { actual: 100 }, [auto]: { actual: 100 }, [none]: { actual: 100 }, [real]: { actual: 100 } } };
  const c = app({ st, actuals: act });
  const h = d => run(c, 'cashTipNoteHtml("F01",' + JSON.stringify(d) + ')');
  assert.match(h(bad), /キャッシュチップの値が正しくありません/); assert.match(h(bad), new RegExp("openCashTipModal\\('F01','" + bad + "'\\)"));
  assert.match(h(auto), /未入力のため自動で 0 を保存しています/); assert.doesNotMatch(h(auto), /alert-danger/);
  assert.match(h(none), /0 として計算しています（翌日に自動で 0 を保存）/); assert.doesNotMatch(h(none), /alert-danger/);
  assert.equal(h(real), '');
  assert.doesNotMatch(run(c, 'cashTipNoteHtml("F01","' + bad + '",{noBtn:true})'), /openCashTipModal/);
  // The tip table cell: an automatic 0 is an empty field showing 0 (a person types over it)
  assert.match(run(c, 'tipCashCellHtml("F01","' + auto + '","l","")'), /value="" placeholder="0"/);
  assert.match(run(c, 'tipCashCellHtml("F01","' + real + '","l","")'), /value="1"/);
  // Someone who cannot type there sees a faint 0, not "—"
  const v = app({ st, actuals: act, role: 'crew' });
  assert.match(run(v, 'tipCashCellHtml("F01","' + auto + '","l","")'), /opacity:\.55">0\.00/);
  const agg = bodyOf('tipPeriodAggregate');
  assert.match(agg, /var _ctBad = cashTipInvalid\(storeId,date\)\.length>0;/);
  assert.doesNotMatch(agg, /cashTipMissing\(/);
  for (const f of ['renderTipDaily', 'openTipDayDetail', 'renderStoreCmdTip']) assert.doesNotMatch(bodyOf(f), /cashTipMissing\(/, f);
  // The computed amount was 0 for a missing side before v1118 too (getCashTip), so totals do not move
  assert.match(bodyOf('tipForDay'), /\(cash\.lunch\|\|0\)/);
});

test('release markers are 1118 or later, the page and the service worker the same', () => {
  const v = Number((/const APP_VERSION = '(\d+)';/.exec(SRC) || [])[1]);
  assert.ok(v >= 1118, String(v));
  assert.ok(SW.includes("const SW_BUILD = '" + v + "';"));
});

// ---------- server ----------
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const hstToday = () => new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);
const D = n => new Date(Date.parse(hstToday() + 'T00:00:00Z') - n * 86400e3).toISOString().slice(0, 10);

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    create table public.store_config(store_id text primary key, name text, active boolean, restaurant_guid text);
    create table public.toast_sales(restaurant_guid text, business_date date, net_sales numeric, lunch_credit_tip numeric, dinner_credit_tip numeric);
    grant select, insert, update on public.app_state to anon, authenticated, service_role;
    grant select on public.store_config, public.toast_sales to service_role;
    insert into public.store_config values ('F01','One',true,'g1'),('F02','Two',true,'g2'),('F03','FSP',true,'g3'),('F04','Four',false,'g4');`);
  const ts = (g, d, net, l, dn) => pg.query('insert into public.toast_sales values ($1,$2,$3,$4,$5)', [g, d, net, l, dn]);
  for (const n of [1, 2, 3, 4]) await ts('g1', D(n), 900, 20, 30);
  await ts('g1', D(5), 0, null, null);     // no sales, no credit tips: not a business day with data
  await ts('g1', D(0), 900, 20, 30);       // today: never filled
  await ts('g2', D(1), 0, 15, null);       // credit tip only
  await ts('g3', D(1), 900, 20, 30);       // F03: no cash tips
  await ts('g4', D(10), 900, 20, 30);
  const put = (k, v) => pg.query('insert into public.app_state(key, value, updated_at) values ($1, $2, $3)', [k, JSON.stringify(v), '2026-01-01T00:00:00Z']);
  await put('cash_tips_F01', {
    [D(1)]: { lunch: 20, lunchEntered: true, entered: false, by: 'Crew A', at: '2026/10/20 21:00' },
    [D(2)]: { lunch: 0, dinner: 0, entered: true, by: 'Crew B', at: '2026/10/19 21:00' },   // legacy record (no side flags)
    [D(3)]: { lunch: 'abc', lunchEntered: true, entered: false, by: 'Crew C', at: '2026/10/18 21:00' },
  });
  await put('cash_tips_F04', { __st: 1, v: {} });                     // wrapped shape: left alone
  await put('daily_actuals_F05', { [D(2)]: { actual: 500 }, [D(3)]: { actual: 0 }, [D(6)]: { lunchCreditTip: 0 } });   // store only in app_state
  await pg.exec(MIG);
  return pg;
}
const q1 = async (pg, sql, p = []) => (await pg.query(sql, p)).rows[0];
const cash = async (pg, s) => { const r = await q1(pg, 'select value from public.app_state where key = $1', ['cash_tips_' + s]); return r ? r.value : undefined; };

test('server: the dry run writes nothing; apply fills only missing sides of finished days with data; a second run adds nothing', async () => {
  const pg = await db();
  await pg.exec('set role service_role');
  const before = J((await pg.query('select key, value from public.app_state order by key')).rows);
  const dry = (await q1(pg, 'select public.cash_tip_autofill(null, null, false) as r')).r;
  assert.equal(dry.apply, false); assert.equal(dry.run_id, null);
  assert.equal(dry.filled_days, 6); assert.equal(dry.filled_sides, 10);
  assert.deepEqual(dry.stores, { F01: { days: 3, sides: 4 }, F02: { days: 1, sides: 2 }, F05: { days: 2, sides: 4 } });
  assert.deepEqual(dry.skipped, [{ store: 'F04', why: 'unexpected_shape' }]);
  assert.deepEqual(J((await pg.query('select key, value from public.app_state order by key')).rows), before, 'nothing written');
  assert.equal((await q1(pg, 'select count(*)::int n from public.cash_tip_autofill_log')).n, 0);

  const done = (await q1(pg, 'select public.cash_tip_autofill(null, null, true) as r')).r;
  assert.ok(done.run_id); assert.equal(done.filled_days, 6); assert.equal(done.filled_sides, 10);
  assert.equal(done.first, D(6)); assert.equal(done.last, D(1));
  const f1 = await cash(pg, 'F01');
  // D1: the person's lunch stays; dinner becomes the automatic 0; the record's time and author stay
  assert.deepEqual(f1[D(1)], { lunch: 20, lunchEntered: true, entered: true, by: 'Crew A', at: '2026/10/20 21:00', dinner: 0, dinnerEntered: true, dinnerAuto: true, autoBy: 'system', autoAt: f1[D(1)].autoAt });
  assert.match(f1[D(1)].autoAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(f1[D(2)], { lunch: 0, dinner: 0, entered: true, by: 'Crew B', at: '2026/10/19 21:00' }, 'legacy entered record untouched');
  assert.equal(f1[D(3)].lunch, 'abc', 'an invalid value is left for a person to fix'); assert.equal(f1[D(3)].dinnerAuto, true);
  assert.deepEqual(f1[D(4)], { lunch: 0, lunchEntered: true, lunchAuto: true, dinner: 0, dinnerEntered: true, dinnerAuto: true, entered: true, autoBy: 'system', autoAt: f1[D(4)].autoAt });
  assert.equal(f1[D(4)].at, undefined, 'no record time: a person\'s value always wins the merge');
  assert.equal(f1[D(5)], undefined, 'no sales and no credit tips: not filled');
  assert.equal(f1[D(0)], undefined, 'today is not filled');
  assert.deepEqual(Object.keys(await cash(pg, 'F02')), [D(1)], 'a missing row is created');
  const f5 = await cash(pg, 'F05');
  assert.deepEqual(Object.keys(f5).sort(), [D(2), D(6)].sort(), 'days from daily_actuals (sales > 0 or a credit tip field)');
  assert.equal(await cash(pg, 'F03'), undefined, 'excluded store');
  assert.deepEqual(await cash(pg, 'F04'), { __st: 1, v: {} });
  assert.equal((await q1(pg, 'select count(*)::int n from public.cash_tip_autofill_log where run_id = $1', [done.run_id])).n, 6);

  const again = (await q1(pg, 'select public.cash_tip_autofill(null, null, true) as r')).r;
  assert.equal(again.filled_days, 0); assert.equal(again.run_id, null);
  assert.deepEqual(await cash(pg, 'F01'), f1, 'nothing added twice');
  assert.equal((await q1(pg, 'select count(*)::int n from public.cash_tip_autofill_log')).n, 6);

  // The app reads the filled row: a person's later value wins, totals for the automatic side are 0
  const c = app();
  const local = { [D(4)]: { lunch: 0, lunchEntered: true, dinner: 15, dinnerEntered: true, entered: true, by: 'Crew D', at: '2026/10/30 08:00' } };
  const m = J(run(c, 'mergeCashTips(' + JSON.stringify(f1) + ',' + JSON.stringify(local) + ')'));
  assert.equal(m[D(4)].dinner, 15); assert.equal(m[D(4)].dinnerAuto, undefined); assert.equal(m[D(4)].lunchAuto, undefined);
  assert.equal(m[D(1)].lunch, 20); assert.equal(m[D(1)].dinnerAuto, true);
  await pg.close();
});

test('server: the range limits what is filled; today is never filled even when asked', async () => {
  const pg = await db();
  await pg.exec('set role service_role');
  const r = (await q1(pg, 'select public.cash_tip_autofill($1::date, $2::date, true) as r', [D(1), D(0)])).r;
  assert.equal(r.to, D(1)); assert.deepEqual(r.stores, { F01: { days: 1, sides: 1 }, F02: { days: 1, sides: 2 } });
  assert.equal((await cash(pg, 'F01'))[D(4)], undefined);
  await pg.close();
});

test('server: undo restores only the sides that are still the automatic 0; a person\'s later value stays', async () => {
  const pg = await db();
  await pg.exec('set role service_role');
  const before = { F01: await cash(pg, 'F01'), F05: await cash(pg, 'F05') };
  const run1 = (await q1(pg, 'select public.cash_tip_autofill(null, null, true) as r')).r.run_id;
  // A person enters 15 for the D4 dinner after the fill (the v1118 app removes the automatic mark)
  await pg.query(`update public.app_state set value = jsonb_set(value, array[$1], (value -> $1) - 'dinnerAuto' || '{"dinner":15,"by":"Crew D","at":"2026/10/30 08:00"}'::jsonb) where key = 'cash_tips_F01'`, [D(4)]);
  const u = (await q1(pg, 'select public.cash_tip_autofill_undo($1) as r', [run1])).r;
  assert.equal(u.undone_sides, 9); assert.equal(u.kept_sides_changed_by_people, 1);
  const f1 = await cash(pg, 'F01');
  assert.deepEqual(f1[D(1)], before.F01[D(1)], 'D1 is back as it was');
  assert.deepEqual(f1[D(3)], before.F01[D(3)]);
  assert.deepEqual(f1[D(4)], { dinner: 15, dinnerEntered: true, by: 'Crew D', at: '2026/10/30 08:00' }, 'the person\'s dinner stays; the automatic lunch is gone');
  assert.equal(before.F05, undefined);
  assert.deepEqual(await cash(pg, 'F05'), {}, 'records that did not exist are removed again');
  assert.deepEqual(await cash(pg, 'F02'), {});
  const u2 = (await q1(pg, 'select public.cash_tip_autofill_undo($1) as r', [run1])).r;
  assert.equal(u2.undone_sides, 0, 'a second undo changes nothing');
  await pg.close();
});

test('server: only service_role can run the fill and read its log; the rest of app_state keeps its grants', async () => {
  const pg = await db();
  for (const role of ['anon', 'authenticated']) {
    for (const f of ['public.cash_tip_autofill(date,date,boolean)', 'public.cash_tip_autofill_undo(uuid)'])
      assert.equal((await q1(pg, 'select has_function_privilege($1, $2, \'execute\') as ok', [role, f])).ok, false, role + ' ' + f);
    assert.equal((await q1(pg, 'select has_table_privilege($1, \'public.cash_tip_autofill_log\', \'select\') as ok', [role])).ok, false, role);
  }
  assert.equal((await q1(pg, `select has_function_privilege('service_role', 'public.cash_tip_autofill(date,date,boolean)', 'execute') as ok`)).ok, true);
  assert.equal((await q1(pg, `select has_table_privilege('anon', 'public.app_state', 'update') as ok`)).ok, true, 'app_state grants are unchanged');
  assert.equal((await q1(pg, `select relrowsecurity from pg_class where relname = 'cash_tip_autofill_log'`)).relrowsecurity, true);
  await pg.close();
});

// ---------- deploy ----------
const DEP = path.join(root, 'deploy/cash-tip-auto-zero-v1118');
const meta = JSON.parse(fs.readFileSync(path.join(DEP, 'source.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
test('deploy: the ops-bot file is built from the current sources; the rollback file is the v1105 bundle', () => {
  for (const [file, hash] of Object.entries(meta.sources)) assert.equal(sha(fs.readFileSync(path.join(root, file))), hash, file + ' changed: rebuild with node deploy/cash-tip-auto-zero-v1118/build.mjs');
  const listed = new Set(Object.keys(meta.sources));
  for (const f of listed) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(listed.has(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1]))), f + ' imports ' + m[1]);
  const bundleFile = path.join(DEP, '4_関数_ops-bot_index.ts');
  assert.equal(sha(fs.readFileSync(bundleFile)), meta.bundle_sha256);
  assert.equal(sha(fs.readFileSync(path.join(root, meta.rollback_file))), meta.rollback_sha256);
  assert.doesNotMatch(fs.readFileSync(bundleFile, 'utf8'), /^\s*import\s|\bimport\(/m, 'one file without imports');
  assert.match(fs.readFileSync(bundleFile, 'utf8'), /Cash tips: invalid values/);
});
const ESBUILD = '/opt/npm-tools/node_modules/.bin/esbuild';
test('deploy: rebuilding gives the same bytes from any folder (when esbuild is available)', { skip: !fs.existsSync(ESBUILD) && 'esbuild not installed here' }, async () => {
  const { bundle } = await import('../deploy/cash-tip-auto-zero-v1118/build.mjs');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-1118-')), 'b.ts');
  const was = process.cwd();
  try { process.chdir(os.tmpdir()); bundle(root, out, ESBUILD); } finally { process.chdir(was); }
  assert.equal(sha(fs.readFileSync(out)), meta.bundle_sha256);
});
test('deploy: the SQL files in the folder are the migration and the schedule; nothing else writes', () => {
  const f = n => fs.readFileSync(path.join(DEP, n), 'utf8');
  assert.equal(f('1_追加のSQL.sql'), MIG, 'the SQL to paste is the migration as it is');
  const sched = f('5_毎日動かす.sql');
  assert.match(sched, /cron\.schedule\('cash-tip-autofill-a', '17 14 \* \* \*'/);
  assert.match(sched, /cron\.schedule\('cash-tip-autofill-b', '47 18 \* \* \*'/);
  assert.match(sched, /cash_tip_autofill\(\(now\(\) at time zone 'Pacific\/Honolulu'\)::date - 62, null, true\)/);
  assert.match(f('止める.sql'), /cron\.unschedule/);
  assert.doesNotMatch(f('2_確認と見込み_読むだけ.sql'), /\b(insert|update|delete)\b|cash_tip_autofill\([^)]*true\)/i);
});

test('deploy: the read-only check, the fill and the schedule run in order (synthetic data, a stand-in cron schema)', async () => {
  const pg = await db();
  const f = n => fs.readFileSync(path.join(DEP, n), 'utf8');
  await pg.exec(`create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
    create function cron.unschedule(id int) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;`);
  const res = await pg.exec(f('2_確認と見込み_読むだけ.sql'));
  assert.deepEqual(res[0].rows[0], { log_table: true, fill_fn: true, undo_fn: true, browser_cannot_run: true });
  const kinds = Object.fromEntries(res[1].rows.map(r => [r.store_id + ':' + r.kind, Number(r.sides)]));
  assert.equal(kinds['F01:no_record'], 2, 'D4 has no record (2 sides)');
  assert.equal(kinds['F01:flag_off_or_missing'], 2, 'D1 and D3 dinner');
  assert.equal(kinds['F01:invalid'], 1, 'D3 lunch');
  assert.equal(kinds['F01:entered_zero'], 2, 'D2 legacy record (0 and 0)');
  assert.equal(kinds['F01:entered_number'], 1);
  assert.equal(res[2].rows[0].preview.filled_sides, 10);
  const before = J((await pg.query('select key, value from public.app_state order by key')).rows);
  assert.ok(before.length);
  const fill = await pg.exec(f('3_全期間を埋める.sql'));
  assert.equal(fill[0].rows[0].result.filled_sides, 10);
  assert.equal(fill[1].rows[0].remaining.filled_days, 0);
  const after = await pg.exec(f('2_確認と見込み_読むだけ.sql'));
  const k2 = Object.fromEntries(after[1].rows.map(r => [r.store_id + ':' + r.kind, Number(r.sides)]));
  assert.equal(k2['F01:auto_zero'], 4); assert.equal(k2['F01:no_record'], undefined); assert.equal(k2['F01:invalid'], 1, 'still an error for a person to fix');
  const sch = await pg.exec(f('5_毎日動かす.sql'));
  assert.deepEqual(sch[sch.length - 1].rows.map(r => r.jobname + ' ' + r.schedule), ['cash-tip-autofill-a 17 14 * * *', 'cash-tip-autofill-b 47 18 * * *']);
  await pg.exec(f('5_毎日動かす.sql'));   // again: still two jobs
  assert.equal((await q1(pg, 'select count(*)::int n from cron.job')).n, 2);
  // the scheduled command itself runs (nothing left to fill)
  const cmd = (await q1(pg, `select command from cron.job where jobname = 'cash-tip-autofill-a'`)).command;
  await pg.exec(cmd);
  const stop = await pg.exec(f('止める.sql'));
  assert.equal(Number(stop[stop.length - 1].rows[0].remaining_jobs), 0);
  const runs = await pg.exec(f('戻す_埋めた0.sql'));
  assert.equal(runs[0].rows.length, 1);
  await pg.close();
});
