// App v1106 (UI案60 ③, Moto 2026-10-21: "9 A 10 A 11 AまたはGMが引き上げ 12 A 13 A 14 A 15 A"; storage "今と同じ形"):
//  Prep specialists (G1-P) per store — items, overall Lv, wage tables by version, certification (request → approval center with
//  an effective date, or GM/CEO sets it), the switch list for a new table, Toast "done" marks — and the labor cost from the
//  certified Lv × the store's table, by day. Without any certification every labor number is the same as v1105.
// Runs the real functions from index.html in a VM with synthetic data. No network, no production data.
// FUNERGY_INDEX=<path> runs the same checks against another build. FUNERGY_BASE=<commit> is the v1105 build compared for "no change".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BASE_SHA = process.env.FUNERGY_BASE || '0d8e6e57d755682af3f2f50811b0c87ec9e8f509';   // v1105 (PR #93 head)
let OLD = null;
try { OLD = execFileSync('git', ['show', BASE_SHA + ':index.html'], { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (_e) { OLD = null; }

function fnFrom(src, name) {
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
const fnSrc = n => fnFrom(SRC, n);
function varFrom(src, name) { const m = new RegExp('^var ' + name + '\\b[^\\n]*$', 'm').exec(src); if (!m) throw new Error('var not found: ' + name); return m[0]; }
const PM = (() => { const a = SRC.indexOf('/* FUNERGY_PREP_BEGIN */'), b = SRC.indexOf('/* FUNERGY_PREP_END */'); assert.ok(a > 0 && b > a, 'prep module markers'); return SRC.slice(a, b); })();

const LABOR = ['_laborHrs', 'laborWeekDays', 'laborMonthWeeks', 'laborWeekRange', 'isoOf', 'isoLocalDate', 'laborForEmployee', '_laborCoreForYmRaw',
  'toastLaborCostForDate', 'ldLaborDay', '_ldWage', 'laborBreakdownForPeriod', 'empWage', 'empWageOf', 'empPayType', '_mdMemo', 'mdCacheClear'];
const APPROVAL = ['_apFollowPage', '_apNewestForRef', 'apFinalize', 'apNotifyAcctApplied', '_apSigBody', '_actorName', '_apGradeChainTypes', '_apApplicantGrade', '_apUserInScope', '_apStoreHasAm', 'approvalRequiredRoles',
  '_approvalStore', '_approvalStoreId', '_approvalMyRoles', '_approvalSignedMap', '_approvalAllDone', 'addApproval', 'signoffApproval', 'overrideApproveAll', 'rejectApprovalItem', 'approveItem', 'reopenApproval',
  '_apFreshPending', 'apPullLatest', '_apOnApprovalPage', '_apRerender', '_apRecordState', '_apMarkDecided', 'apNotifyDecision', 'apNeedsAcct', 'apWithOfficeCrew', '_apStoreLabel', '_apReopenRec',
  'resolveApprovalByRef', '_apResolveLocal', '_apRecTime', '_apPullRecord', 'apDecStamp', '_apStT', '_apMut', '_apGen', '_apSyncRecStamp', '_rtStT', '_rtStK', '_rtDecT', '_rtDecG',
  'getNotifs', 'addNotif', 'mergeMapByTime', '_recAt', '_coversMapByTime'];
const AP_VARS = ['AP_ACCT_TYPES', '_apBusy', '_apTab', '_apPullAt', 'AP_REC_KEYS', 'AP_REC_FIELD', 'RT_DEC_FIELDS'];

const ROLE_CONFIG = { ceo: { name: 'Tac' }, gm: { name: 'Moto' }, office: { name: 'Marcia' }, am: { name: 'Yuki' }, sl: { name: 'Store Leader' }, crew: { name: 'スタッフ' } };
// F01 = ToriTon, F06 = LaLa. Prep people: Pia (ToriTon, Lv2 from v1105, an individual wage $18.00), Pete (ToriTon, Lv1, $16),
// Lani (LaLa, no Lv yet), Sam (ToriTon home, also works at LaLa). Cora is a normal G1 (not prep).
const EMPS = () => [
  { id: 'e1', name: 'Pia', store: 'F01', role: 'crew', prep: true, prepLv: 2, wage: 18, title: 'Prep Specialist' },
  { id: 'e2', name: 'Pete', store: 'F01', role: 'crew', prep: true, prepLv: 1, wage: 16, title: 'Prep Specialist' },
  { id: 'e3', name: 'Lani', store: 'F06', role: 'crew', prep: true, wage: 17, title: 'Prep Specialist' },
  { id: 'e4', name: 'Sam', store: 'F01', support: ['F06'], role: 'crew', prep: true, prepLv: 3, wage: 19, title: 'Prep Specialist' },
  { id: 'e5', name: 'Cora', store: 'F01', role: 'crew', wage: 16.5, title: 'Crew' },
  { id: 'e6', name: 'Gone', store: 'F06', role: 'crew', prep: true, prepLv: 4, wage: 20, status: '退職' },
];
// Synthetic Toast hours (Oct–Dec 2026) — fixed pseudo-random so every run is the same.
function laborData() {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = { F01: {}, F06: {} };
  for (let d = new Date(Date.UTC(2026, 8, 27)); d <= new Date(Date.UTC(2026, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    for (const sid of ['F01', 'F06']) {
      const day = {};
      for (const n of ['Pia', 'Pete', 'Lani', 'Sam', 'Cora']) {
        if (sid === 'F01' && n === 'Lani') continue;
        if (sid === 'F06' && (n === 'Pia' || n === 'Pete' || n === 'Cora')) continue;
        if (rnd() < 0.2) continue;
        const h = Math.round((3 + rnd() * 6) * 4) / 4;   // 3–9 h in quarter hours; some weeks pass 40 h
        const lunch = Math.round(h * 40) / 100;
        day[n] = { rawLunch: lunch, rawDinner: Math.round((h - lunch) * 100) / 100, lunch: lunch, dinner: Math.round((h - lunch) * 100) / 100 };
      }
      out[sid][iso] = day;
    }
  }
  return out;
}
const LAB = laborData();

function app(src, { role = 'gm', user = 'Moto', st = {}, today = '2026-10-22', fns = [], withPm = true, cloud = null } = {}) {
  const S = JSON.parse(JSON.stringify(Object.assign({ m_employees: EMPS() }, st)));
  const c = {
    curRole: role, curUserName: user, curStore: 'ALL', curStoreLogin: false, curLang: 'ja', curPage: 'skill', ROLE_CONFIG, today,
    STORES: [{ id: 'F01', name: 'ToriTon' }, { id: 'F06', name: 'LaLa' }, { id: 'F02', name: 'Tenkichi' }],
    alerts: [], toasts: [], rendered: [], modals: [], notifs: [], S, PAYROLL_TAX_RATE: 0.17, WAGE: { crew: 16 },
    t: (ja) => ja, ls: (k, d) => (k in S ? JSON.parse(JSON.stringify(S[k])) : d), lsSet: (k, v) => { S[k] = JSON.parse(JSON.stringify(v)); return true; },
    alert: m => c.alerts.push(m), confirm: () => true, showToast: (m, k) => c.toasts.push([m, k]), renderPage: p => c.rendered.push(p),
    openModal: h => c.modals.push(h), closeModalDirect: () => {}, openInputModal: (o, cb) => cb('理由'),
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    nowJP: () => '2026/10/22 09:10', todayJP: () => '2026/10/22', bizToday: () => c.today, curYm: () => c.today.slice(0, 7),
    getEmployees: () => JSON.parse(JSON.stringify(S.m_employees)), getStoresAll: () => c.STORES, getVisibleStores: () => c.STORES,
    getTipLabor: (sid, dt) => (LAB[sid] && LAB[sid][dt]) || null, storeMonthlyStaff: () => [], empMonthlyOf: () => 0, empIsMonthlyByName: () => false,
    daysOfYm: ym => { const out = []; const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); for (let i = 1; i <= n; i++) out.push({ date: ym + '-' + String(i).padStart(2, '0') }); return out; },
    daysInMonthOf: ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
    dayClosureMode: () => 'open', _daRO: () => ({}), storeInsuranceDaily: () => 0, isFrozenMonth: () => false, storeSalaryMonthly: () => 0, storeInsuranceMonthly: () => 0,
    getTitleWageTable: () => ({}), isMonthlyTitle: () => false, empSiteWageOf: () => 0,
    canViewWages: () => ['gm', 'ceo', 'office', 'am'].indexOf(c.curRole) >= 0, canViewIndividualWage: () => ['gm', 'ceo', 'office'].indexOf(c.curRole) >= 0,
    canEditWages: () => c.curRole === 'gm' || c.curRole === 'ceo', isStoreManager: () => c.curRole === 'sl' && c.curUserName === 'Store Leader',
    myName: () => c.curUserName, GRADE_MAP_DATA: [{ g: 'G1-P', levels: [16, 17.5, 19, 20.5, 22].map((w, i) => ({ lv: i + 1, wage: w.toFixed(2), ja: ['基本の仕込み（指示通り）', '主要メニュー', '品質', '段取り', 'プレップのマスター（指導）'][i] })) }],
    skillRadarSvg: () => '<svg></svg>', bStoreChips: () => '', getNotifs: () => S.notifications || [],
    empGradeNum: () => 1, myGradeNum: () => 6, myAmStores: () => [], approversForType: t => (t === 'プレップ認定' ? ['gm'] : ['office', 'gm', 'am']),
    renderNotifBell: () => {}, renderNotifPanel: () => {}, document: { getElementById: id => (c.dom && c.dom[id]) || null }, setTimeout, clearTimeout,
    SUPA_SYNC_ENABLED: !!cloud, getSkillRequests: () => [], getOffboardings: () => [], setOffboardings: () => {},
  };
  if (cloud) c.pullOpKey = async key => { (c.pulled = c.pulled || []).push(key); if (cloud.fail && cloud.fail.indexOf(key) >= 0) return false; if (key in cloud) S[key] = c.mergeMapByTime ? c.mergeMapByTime(cloud[key], S[key] || {}) : cloud[key]; return true; };
  c.window = c;
  vm.createContext(c);
  const names = LABOR.concat(fns);
  const code = names.map(n => { try { return fnFrom(src, n); } catch (_e) { return ''; } }).join('\n')
    + '\n' + AP_VARS.map(n => { try { return varFrom(src, n); } catch (_e) { return ''; } }).join('\n')
    + '\nvar _mdCache = {}, _mdCacheArmed = false;\n' + (withPm ? PM : '');
  vm.runInContext(code, c);
  return c;
}
const run = (c, expr) => vm.runInContext(expr, c);
const plain = v => JSON.parse(JSON.stringify(v));
const clear = c => run(c, 'mdCacheClear()');
const LV5 = [1700, 1825, 1950, 2075, 2200];
const table = (store, from, cents = LV5, extra = {}) => ({ store, from, levels: cents.map((x, i) => ({ lv: i + 1, name: 'L' + (i + 1), cents: x })), by: 'Moto', _at: 10, ...extra });
const cert = (emp, name, store, lv, from, tbl, extra = {}) => ({ emp, name, store, lv, from, tbl, kind: 'switch', state: 'approved', dt: 100, _at: 100, by: 'Moto', dBy: 'Moto', ...extra });

/* -------------------- no change without certification -------------------- */
test('labor: without any Prep data, every labor number is the same as v1105 (core, per day, L/D, one-day breakdown)', { skip: OLD ? false : 'v1105 build (git history) not available' }, () => {
  const a = app(OLD, { withPm: false }), b = app(SRC);
  for (const sid of ['F01', 'F06']) for (const ym of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(plain(run(b, `_laborCoreForYmRaw('${sid}','${ym}',{})`)), plain(run(a, `_laborCoreForYmRaw('${sid}','${ym}',{})`)), sid + ' ' + ym);
  }
  for (const dt of ['2026-10-05', '2026-11-03', '2026-12-24']) for (const sid of ['F01', 'F06']) {
    assert.equal(run(b, `toastLaborCostForDate('${sid}','${dt}')`), run(a, `toastLaborCostForDate('${sid}','${dt}')`));
    assert.deepEqual(plain(run(b, `ldLaborDay('${sid}','${dt}')`)), plain(run(a, `ldLaborDay('${sid}','${dt}')`)));
    assert.deepEqual(plain(run(b, `laborBreakdownForPeriod('${sid}',[{date:'${dt}'}]).rows`)), plain(run(a, `laborBreakdownForPeriod('${sid}',[{date:'${dt}'}]).rows`)));
  }
});

test('labor: a certification at LaLa changes only that person at LaLa; ToriTon and everyone else are the same as v1105', { skip: OLD ? false : 'v1105 build (git history) not available' }, () => {
  const st = { prep_tables: { t1: table('F06', '2026-11-01') }, prep_certs: { c1: cert('e4', 'Sam', 'F06', 3, '2026-11-01', 't1') } };
  const a = app(OLD, { withPm: false, st }), b = app(SRC, { st });
  for (const ym of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(plain(run(b, `_laborCoreForYmRaw('F01','${ym}',{})`)), plain(run(a, `_laborCoreForYmRaw('F01','${ym}',{})`)), 'F01 ' + ym);
    const nb = plain(run(b, `_laborCoreForYmRaw('F06','${ym}',{})`)), na = plain(run(a, `_laborCoreForYmRaw('F06','${ym}',{})`));
    for (const n of Object.keys(na.byName)) {
      if (n === 'Sam') continue;
      assert.deepEqual(nb.byName[n], na.byName[n], ym + ' ' + n);
    }
    if (ym === '2026-10') assert.deepEqual(nb, na);   // before the effective date: nothing changes, even for Sam
  }
});

test('labor: from the effective date the store pays certified Lv × its table, by day; weeks over 40 h use the week’s average × 1.5', () => {
  // Sam: LaLa v1 from 11/1 at Lv2 (switch), promoted to Lv3 from 11/18 (GM). Before 11/1: the master wage $19.
  const st = { prep_tables: { t1: table('F06', '2026-11-01') },
    prep_certs: { c1: cert('e4', 'Sam', 'F06', 2, '2026-11-01', 't1'), c2: cert('e4', 'Sam', 'F06', 3, '2026-11-18', 't1', { kind: 'raise', dt: 200, _at: 200 }) } };
  const c = app(SRC, { st });
  const wageOn = dt => (dt < '2026-11-01' ? 19 : dt < '2026-11-18' ? 18.25 : 19.5);
  for (const ym of ['2026-11', '2026-12']) {
    // Independent calculation: weeks Sun–Sat, only the month's days, OT over 40 h at the week's average × 1.5.
    let pay = 0;
    const [y, m] = ym.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), last = new Date(Date.UTC(y, m, 0));
    const s = new Date(first); s.setUTCDate(s.getUTCDate() - s.getUTCDay());
    for (const w = new Date(s); w <= last; w.setUTCDate(w.getUTCDate() + 7)) {
      let h = 0, hw = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(w); d.setUTCDate(d.getUTCDate() + i); const iso = d.toISOString().slice(0, 10);
        if (iso.slice(0, 7) !== ym) continue;
        const e = (LAB.F06[iso] || {}).Sam; if (!e) continue;
        const hh = Math.max(e.rawLunch + e.rawDinner, e.lunch + e.dinner); h += hh; hw += hh * wageOn(iso);
      }
      if (h > 0) { const ot = Math.max(0, h - 40), avg = hw / h; pay += (h - ot) * avg + ot * avg * 1.5; }
    }
    const core = plain(run(c, `_laborCoreForYmRaw('F06','${ym}',{})`));
    assert.equal(core.byName.Sam.pay, Math.round(pay * 100) / 100, ym);
    // The store's hourly total = Sam's certified pay + Lani at her master wage ($17, weekly OT × 1.5).
    const la = core.byName.Lani, laniPay = la.reg * 17 + la.ot * 17 * 1.5;
    assert.equal(core.hourly, Math.round((core.byName.Sam.pay + laniPay) * 100) / 100, ym + ' hourly');
    const lfe = plain(run(c, `laborForEmployee('Sam', {regular:${core.byName.Sam.reg}, ot:${core.byName.Sam.ot}, pay:${core.byName.Sam.pay}})`));
    assert.equal(lfe.total, core.byName.Sam.pay);
    assert.equal(lfe.mixed, true);
  }
  assert.equal(run(c, `empWageAt('Sam','F06','2026-10-31')`), 19);
  assert.equal(run(c, `empWageAt('Sam','F06','2026-11-01')`), 18.25);
  assert.equal(run(c, `empWageAt('Sam','F06','2026-11-18')`), 19.5);
  assert.equal(run(c, `empWageAt('Sam','F01','2026-11-18')`), 19);   // 14A: ToriTon keeps its own wage
  // A monthly-paid person never gets the Prep table wage (even with a certificate).
  const mo = app(SRC, { st: { ...st, m_employees: EMPS().map(e => (e.id === 'e4' ? { ...e, monthlySalary: 4000 } : e)) } });
  assert.equal(run(mo, `pmCertWage('Sam','F06','2026-11-20')`), null);
  // Per-day screens use the same wage.
  const e = LAB.F06['2026-11-20'].Sam;
  if (e) {
    const hh = Math.max(e.rawLunch + e.rawDinner, e.lunch + e.dinner);
    const all = Object.keys(LAB.F06['2026-11-20']).reduce((s2, n) => { const x = LAB.F06['2026-11-20'][n]; const h2 = Math.max(x.rawLunch + x.rawDinner, x.lunch + x.dinner); return s2 + h2 * (n === 'Sam' ? 19.5 : { Lani: 17 }[n]); }, 0);
    assert.ok(Math.abs(run(c, `toastLaborCostForDate('F06','2026-11-20')`) - all) < 1e-9);
    const bd = plain(run(c, `laborBreakdownForPeriod('F06',[{date:'2026-11-20'}]).rows`)).find(r => r.name === 'Sam');
    assert.equal(bd.amount, Math.round(hh * 19.5 * 100) / 100);
  }
});

test('labor: a new table changes no one until the switch is approved; a later approval of an older-table certificate does not undo the switch', () => {
  const base = { t1: table('F01', '2026-11-01', [1600, 1750, 1900, 2050, 2200]), t2: table('F01', '2026-12-01', LV5, { _at: 20 }) };
  // Pia: on v1 from 11/1 (Lv2). v2 exists from 12/1, not approved for her → still v1.
  let c = app(SRC, { st: { prep_tables: base, prep_certs: { a: cert('e1', 'Pia', 'F01', 2, '2026-11-01', 't1') } } });
  assert.equal(run(c, `empWageAt('Pia','F01','2026-12-10')`), 17.5);
  // The switch to v2 from 12/1 is approved. A promotion to Lv3 from 12/15 was approved earlier against v1 (dt smaller).
  c = app(SRC, { st: { prep_tables: base, prep_certs: {
    a: cert('e1', 'Pia', 'F01', 2, '2026-11-01', 't1'),
    p: cert('e1', 'Pia', 'F01', 3, '2026-12-15', 't1', { kind: 'req', dt: 150 }),
    s: cert('e1', 'Pia', 'F01', 2, '2026-12-01', 't2', { dt: 300 }) } } });
  assert.equal(run(c, `empWageAt('Pia','F01','2026-11-30')`), 17.5);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-12-01')`), 18.25);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-12-15')`), 19.5);   // Lv3 on v2 (the newest table she was approved on)
  // Removing the Prep mark ends the Prep wage the next day; afterwards the master wage again.
  c = app(SRC, { st: { prep_tables: base, prep_certs: { a: cert('e1', 'Pia', 'F01', 2, '2026-11-01', 't1'), z: cert('e1', 'Pia', 'F01', 0, '2026-11-20', '', { kind: 'end', dt: 400 }) } } });
  assert.equal(run(c, `empWageAt('Pia','F01','2026-11-19')`), 17.5);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-11-20')`), 18);
  // A certification whose table was cancelled or never existed does not invent a wage.
  c = app(SRC, { st: { prep_tables: { t1: table('F01', '2026-11-01', LV5, { void: true }) }, prep_certs: { a: cert('e1', 'Pia', 'F01', 2, '2026-11-01', 't1') } } });
  assert.equal(run(c, `empWageAt('Pia','F01','2026-11-10')`), 18);
});

/* -------------------- scoring and items -------------------- */
test('scores: overall Lv by average (rounded) or lowest item, counts only scored items, and the speed rule counts 4–5 as 3 unless the others are 3+', () => {
  const c = app(SRC, { st: { prep_cfg: { F06: { on: true, items: [
    { id: 'a', name: 'A', on: true }, { id: 'b', name: 'B', on: true }, { id: 'sp', name: '段取り・速さ', on: true }, { id: 'x', name: 'Old', on: false }], method: 'avg', speed: 'sp', _at: 5 } } } });
  const set = (sk) => { const em = c.S.m_employees; em[2].prepSkills = { F06: sk }; clear(c); return plain(run(c, `pmScore(getEmployees()[2],'F06')`)); };
  let s = set({ a: 3, b: 4 });
  assert.deepEqual([s.lv, s.n, s.total, s.full], [4, 2, 3, false]);   // (3+4)/2 = 3.5 → 4
  s = set({ a: 3, b: 4, sp: 5 });
  assert.deepEqual([s.lv, s.full, s.capped], [4, true, false]);       // others ≥3 → speed 5 counts: (3+4+5)/3 = 4
  s = set({ a: 2, b: 4, sp: 5, x: 5 });
  assert.deepEqual([s.lv, s.capped], [3, true]);                      // a = 2 → speed counted as 3: (2+4+3)/3 = 3; the item that is off is not counted
  c.S.prep_cfg.F06.method = 'min'; s = set({ a: 2, b: 4, sp: 3 });
  assert.equal(s.lv, 2);
  // The real scoring button refuses 4–5 on the speed item while another item is below 3, and never writes Lv or wage.
  c.S.prep_cfg.F06.method = 'avg'; set({ a: 2, b: 4 });
  run(c, `setPrepSkill('e3','F06',2,4)`);
  assert.match(c.alerts.pop(), /ほかの項目がすべて 3 以上/);
  run(c, `setPrepSkill('e3','F06',0,3)`); run(c, `setPrepSkill('e3','F06',2,4)`);
  const e3 = c.S.m_employees.find(e => e.id === 'e3');
  assert.deepEqual(e3.prepSkills.F06, { a: 3, b: 4, sp: 4 });
  assert.equal(e3.wage, 17); assert.equal(e3.prepLv, undefined);
  run(c, `setPrepSkill('e3','F06',2,4)`);   // the same number again clears it
  assert.equal(c.S.m_employees.find(e => e.id === 'e3').prepSkills.F06.sp, 0);
  // Only GM/CEO score.
  const am = app(SRC, { role: 'am', user: 'Yuki' }); run(am, `setPrepSkill('e3','F06',0,3)`); assert.equal(am.alerts.length, 1);
});

test('items: LaLa starts from the 7 draft items (15A) and stays on them after scoring; a store with v1105 items keeps them (id = name, old scores read)', () => {
  const c = app(SRC);
  const lala = plain(run(c, `pmCfg('F06')`));
  assert.equal(lala.items.length, 7); assert.equal(lala.draft, true); assert.equal(lala.speed, 'll_speed'); assert.equal(lala.on, true);
  c.S.m_employees[2].prepSkills = { F06: { ll_recipe: 3 } }; clear(c);
  assert.equal(plain(run(c, `pmCfg('F06')`)).items[0].id, 'll_recipe');
  const tori = plain(run(c, `pmCfg('F01')`));
  assert.equal(tori.items[0].id, 'チキン'); assert.equal(tori.draft, false); assert.equal(tori.speed, '');
  c.S.m_employees[0].prepSkills = { F01: { 'チキン': 4, 'ポーク': 2 } }; clear(c);
  assert.deepEqual(plain(run(c, `prepSkillsOf(getEmployees()[0],'F01')`)), { 'チキン': 4, 'ポーク': 2 });   // the old name-keyed reader still works
  assert.deepEqual(plain(run(c, `getPrepPositions('F06')`)).length, 7);
  // LaLa with v1105 scores under the generic items keeps those items (no hidden scores).
  const d = app(SRC); d.S.m_employees[2].prepSkills = { F06: { '仕込み': 2 } }; clear(d);
  assert.equal(plain(run(d, `pmCfg('F06')`)).items[0].id, '仕込み');
  // A store without Prep staff is off by default.
  assert.equal(plain(run(c, `pmCfg('F02')`)).on, false);
});

test('settings: a saved store keeps its own items; copying a template copies items only and keeps the old items off (scores readable)', async () => {
  const c = app(SRC, { fns: [] });
  c.S.m_employees[0].prepSkills = { F01: { 'チキン': 4 } };
  run(c, `_pm.form=pmFormFrom('F06')`);
  run(c, `_pm.form.items[0].name='レシピの品質'; _pm.form.items.push({id:'n1',name:'新しい項目',desc:'',on:true}); _pm.form.draft=false`);
  await run(c, `pmSaveSettings()`);
  const r = c.S.prep_cfg.F06;
  assert.equal(r.items[0].id, 'll_recipe'); assert.equal(r.items[0].name, 'レシピの品質'); assert.equal(r.items.length, 8); assert.equal(r.draft, false);
  assert.equal(c.S.prep_cfg.F01, undefined);   // ToriTon unchanged
  run(c, `_pm.form=pmFormFrom('F02'); pmCopyTemplate('F01')`);
  const f = plain(run(c, `_pm.form`));
  assert.equal(f.items.filter(i => i.on).length, 8);
  assert.ok(f.items.every(i => i.id !== 'チキン'));   // new ids
  assert.equal(JSON.stringify(f).includes('"prepSkills"'), false);
  // Someone else saved first → nothing is overwritten.
  run(c, `_pm.form=pmFormFrom('F06')`); c.S.prep_cfg.F06._at = 999; run(c, `_pm.form.items[0].name='X'`);
  await run(c, `pmSaveSettings()`);
  assert.equal(c.S.prep_cfg.F06.items[0].name, 'レシピの品質');
  assert.match(c.toasts.pop()[0], /先に保存/);
  // A store manager may edit items of their own store only, not the method/speed/official flag.
  const sm = app(SRC, { role: 'sl', user: 'Store Leader', st: { m_employees: EMPS().concat([{ id: 'm1', name: 'Store Leader', store: 'F06', role: 'sl', title: 'Store Manager' }]) } });
  assert.equal(run(sm, `pmCanItems('F06')`), true); assert.equal(run(sm, `pmCanItems('F01')`), false);
  run(sm, `_pm.form=pmFormFrom('F06'); _pm.form.method='min'; _pm.form.draft=false; _pm.form.items[0].desc='計量'`);
  await run(sm, `pmSaveSettings()`);
  assert.equal(sm.S.prep_cfg.F06.method, 'avg'); assert.equal(sm.S.prep_cfg.F06.draft, true); assert.equal(sm.S.prep_cfg.F06.items[0].desc, '計量');
});

/* -------------------- tables -------------------- */
test('tables: wages must rise with Lv, be above $0, start after today and after the previous version (no overlap)', () => {
  const c = app(SRC, { st: { prep_tables: { t1: table('F06', '2026-11-01') } } });
  const lv = cents => cents.map((x, i) => ({ lv: i + 1, name: 'L' + (i + 1), cents: x }));
  const chk = (from, cents) => run(c, `pmCheckTable('F06','${from}',${JSON.stringify(lv(cents))})`);
  assert.equal(chk('2026-11-02', LV5), '');
  assert.match(chk('2026-11-01', LV5), /前の版/);
  assert.match(chk('2026-10-22', LV5), /明日以降/);
  assert.match(chk('2026-11-05', [1700, 1700, 1950, 2075, 2200]), /Lv の順に上がる/);
  assert.match(chk('2026-11-05', [0, 1825, 1950, 2075, 2200]), /\$0 より大きく/);
  assert.match(run(c, `pmCheckTable('F06','2026-11-05',[{lv:1,name:'',cents:1700}].concat(${JSON.stringify(lv(LV5).slice(1))}))`), /名前/);
  assert.equal(run(c, `pmCents('18.25')`), 1825); assert.equal(run(c, `pmCents('$17')`), 1700); assert.equal(run(c, `pmCents('17.5')`), 1750); assert.equal(run(c, `pmCents('1e3')`), null);
  // A different store's version does not block LaLa.
  const d = app(SRC, { st: { prep_tables: { t1: table('F01', '2026-12-01') } } });
  assert.equal(run(d, `pmCheckTable('F06','2026-11-02',${JSON.stringify(lv(LV5))})`), '');
});

/* -------------------- switch list (13A) -------------------- */
test('switch: current Lv stays, new amount; v1105 Lv needs a basis; individual wages are flagged; never guesses a Lv; approval writes no wage', async () => {
  const st = { prep_tables: { t1: table('F01', '2026-11-01') }, prep_history: [{ name: 'Pia', store: 'F01', toLv: 2 }] };
  const c = app(SRC, { st, fns: ['apNotifyAcctApplied', 'addNotif', 'getNotifs'] });
  c.S.m_employees[3].prepSkills = { F01: { 'チキン': 3 } };   // Sam: a score is a basis
  clear(c);
  const d = plain(run(c, `pmSwitchRows('t1')`)), row = n => d.rows.find(r => r.e.name === n);
  assert.deepEqual([row('Pia').lv, row('Pia').newCents, row('Pia').ok], [2, 1825, true]);
  assert.match(row('Pia').warn, /個人の時給/);                         // $18.00 vs the v1105 table $17.50
  assert.deepEqual([row('Pete').lv, row('Pete').ok], [null, false]);    // Lv1 with no record or score → not guessed
  assert.match(row('Pete').warn, /根拠/);
  assert.deepEqual([row('Sam').lv, row('Sam').newCents], [3, 1950]);
  assert.equal(d.rows.some(r => r.e.name === 'Lani' || r.e.name === 'Gone' || r.e.name === 'Cora'), false);   // other store / resigned / not prep
  // LaLa: Lani has no Lv → 要設定, Sam (support) too — Lv from v1105 counts only at the home store.
  const e = app(SRC, { st: { prep_tables: { t9: table('F06', '2026-11-01') } } });
  e.S.m_employees[3].prepSkills = { F06: { ll_recipe: 3 } };   // Sam has a LaLa score, but his v1105 Lv belongs to ToriTon
  clear(e);
  const dl = plain(run(e, `pmSwitchRows('t9')`));
  assert.deepEqual(dl.rows.map(r => [r.e.name, r.lv]).sort(), [['Lani', null], ['Sam', null]]);
  // Approve: certs with the Lv and the table, no wage amounts; the same rows are not switched twice.
  run(c, `_pm.sw={id:'t1',pick:{e1:true,e4:true}}`);
  await run(c, `pmApproveSwitch()`);
  const certs = Object.values(c.S.prep_certs);
  assert.deepEqual(certs.map(x => [x.name, x.lv, x.from, x.tbl, x.kind, x.state]).sort(), [['Pia', 2, '2026-11-01', 't1', 'switch', 'approved'], ['Sam', 3, '2026-11-01', 't1', 'switch', 'approved']]);
  assert.equal(/cents|wage/.test(JSON.stringify(c.S.prep_certs)), false);
  clear(c);
  assert.deepEqual(plain(run(c, `pmSwitchRows('t1')`)).rows.filter(r => r.ok).map(r => r.e.name), []);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-11-01')`), 18.25);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-10-31')`), 18);
  assert.ok(c.S.notifications.some(n => /プレップ認定/.test(n.title) && n.toRoles.indexOf('office') >= 0 && !/\$/.test(n.text)));
  // A version whose start date has come cannot be approved any more.
  const late = app(SRC, { st, today: '2026-11-01' }); run(late, `_pm.sw={id:'t1',pick:{e1:true}}`);
  await run(late, `pmApproveSwitch()`);
  assert.equal(late.S.prep_certs, undefined);
});

/* -------------------- request, approval center, direct decision -------------------- */
const APX = APPROVAL.concat([]);
test('approval center: a request goes to「プレップ認定」; GM approves with an effective date; the wage changes from that date only', async () => {
  const st = { prep_tables: { t1: table('F06', '2026-11-01') } };
  // CEO scores Lani fully at LaLa and requests Lv3.
  const ceo = app(SRC, { role: 'ceo', user: 'Tac', st, fns: APX });
  ceo.S.m_employees[2].prepSkills = { F06: { ll_recipe: 3, ll_hygiene: 3, ll_amount: 3, ll_tidy: 3, ll_speed: 3, ll_report: 3, ll_mission: 3 } };
  clear(ceo);
  await run(ceo, `pmRequest('e3','F06')`);
  const req = Object.entries(ceo.S.prep_certs)[0];
  assert.equal(req[1].state, 'pending'); assert.equal(req[1].lv, 3); assert.equal(req[1].n, 7);
  const ap = ceo.S.approvals.find(a => a.type === 'プレップ認定');
  assert.equal(ap.ref, req[0]); assert.equal(ap.store, 'F06'); assert.equal(ap.from, 'Tac');
  // Partial scores cannot be requested.
  const part = app(SRC, { role: 'ceo', user: 'Tac', st, fns: APX });
  part.S.m_employees[2].prepSkills = { F06: { ll_recipe: 4, ll_hygiene: 4 } }; clear(part);
  await run(part, `pmRequest('e3','F06')`);
  assert.equal(part.S.prep_certs, undefined); assert.match(part.toasts.pop()[0], /全部の項目/);
  // A second request while pending is refused.
  await run(ceo, `pmRequest('e3','F06')`); assert.equal(Object.keys(ceo.S.prep_certs).length, 1);
  // GM (another device with the same data) approves: picks 2026-11-05.
  const gm = app(SRC, { st: plain(ceo.S), fns: APX });
  run(gm, `pmAskFrom = async function(){ return '2026-11-05'; }`);
  await run(gm, `signoffApproval('${ap.id}')`);
  const done = gm.S.prep_certs[req[0]];
  assert.deepEqual([done.state, done.from, done.tbl, done.dBy], ['approved', '2026-11-05', 't1', 'Moto']);
  assert.equal(gm.S.approvals.find(a => a.id === ap.id).status, 'approved');
  clear(gm);
  assert.equal(run(gm, `empWageAt('Lani','F06','2026-11-04')`), 17);
  assert.equal(run(gm, `empWageAt('Lani','F06','2026-11-05')`), 19.5);
  assert.ok(gm.S.notifications.some(n => n.toUser === 'Lani' && /Lv3/.test(n.title) && !/\$/.test(n.text)));
  assert.ok(gm.S.notifications.some(n => /承認済み：プレップ認定/.test(n.title) && n.toRoles.indexOf('office') >= 0));
  // The requester cannot approve their own request.
  assert.deepEqual(plain(run(ceo, `_approvalMyRoles(ls('approvals',[])[0])`)), []);
  // Undo before the date → back to pending; after the date → refused.
  const gm2 = app(SRC, { st: plain(gm.S), fns: APX.concat(['_reopenOffboardApproval']) });
  await run(gm2, `reopenApproval('${ap.id}', true)`);
  assert.equal(gm2.S.prep_certs[req[0]].state, 'pending');
  const gm3 = app(SRC, { st: plain(gm.S), fns: APX, today: '2026-11-05' });
  await run(gm3, `reopenApproval('${ap.id}', true)`);
  assert.equal(gm3.S.prep_certs[req[0]].state, 'approved');
  assert.match(gm3.alerts.pop(), /取り消せません/);
});

test('approval center: cancelling the date changes nothing; a missing table, a past date, a removed person or a decided record holds or matches', async () => {
  const mk = (over = {}) => {
    const st = { prep_tables: { t1: table('F06', '2026-11-01') }, prep_certs: { r1: { emp: 'e3', name: 'Lani', store: 'F06', lv: 2, kind: 'req', state: 'pending', n: 7, total: 7, _at: 5 } },
      approvals: [{ id: 'ap9', type: 'プレップ認定', title: 'Lani', from: 'Tac', store: 'F06', ref: 'r1', status: 'pending', _mut: 5, signoffs: [] }], ...over };
    return app(SRC, { st, fns: APX });
  };
  let c = mk(); run(c, `pmAskFrom = async function(){ return null; }`);
  await run(c, `signoffApproval('ap9')`);
  assert.equal(c.S.approvals[0].status, 'pending'); assert.deepEqual(c.S.approvals[0].signoffs, []); assert.equal(c.S.prep_certs.r1.state, 'pending');
  c = mk({ prep_tables: { t1: table('F06', '2026-12-01') } }); run(c, `pmAskFrom = async function(){ return '2026-11-05'; }`);
  await run(c, `signoffApproval('ap9')`);
  assert.equal(c.S.approvals[0].status, 'pending'); assert.equal(c.S.prep_certs.r1.state, 'pending'); assert.match(c.toasts.pop()[0], /表がありません/);
  c = mk(); run(c, `pmAskFrom = async function(){ return '2026-10-01'; }`);
  await run(c, `approveItem('ap9','approved',null,{fresh:true, prepFrom:'2026-10-01'})`);
  assert.equal(c.S.prep_certs.r1.state, 'pending'); assert.match(c.toasts.pop()[0], /今日より前/);
  c = mk(); c.S.m_employees[2].prep = false;
  await run(c, `approveItem('ap9','approved',null,{fresh:true, prepFrom:'2026-11-05'})`);
  assert.equal(c.S.prep_certs.r1.state, 'pending'); assert.match(c.toasts.pop()[0], /プレップ専門職ではありません/);
  c = mk(); c.S.prep_certs.r1.state = 'withdrawn';
  await run(c, `approveItem('ap9','approved',null,{fresh:true, prepFrom:'2026-11-05'})`);
  assert.equal(c.S.approvals[0].status, 'withdrawn');   // the approval center follows the record
  // Reject: the record is rejected with the reason; nothing approved.
  c = mk(); await run(c, `approveItem('ap9','rejected','まだ早い',{fresh:true})`);
  assert.deepEqual([c.S.prep_certs.r1.state, c.S.prep_certs.r1.reason, c.S.approvals[0].status], ['rejected', 'まだ早い', 'rejected']);
  // The cloud cannot be read → nothing is decided.
  const st = { prep_tables: { t1: table('F06', '2026-11-01') }, prep_certs: { r1: { emp: 'e3', name: 'Lani', store: 'F06', lv: 2, kind: 'req', state: 'pending', _at: 5 } },
    approvals: [{ id: 'ap9', type: 'プレップ認定', title: 'Lani', from: 'Tac', store: 'F06', ref: 'r1', status: 'pending', _mut: 5, signoffs: [] }] };
  c = app(SRC, { st, fns: APX, cloud: { fail: ['prep_certs'] } });
  await run(c, `approveItem('ap9','approved',null,{fresh:true, prepFrom:'2026-11-05'})`);
  assert.equal(c.S.prep_certs.r1.state, 'pending'); assert.equal(c.S.approvals[0].status, 'pending');
});

test('GM/CEO set the Lv directly (11 “GMが引き上げ”): reason and a date from today are required; blocked while a request is pending', async () => {
  const st = { prep_tables: { t1: table('F06', '2026-11-01') } };
  const c = app(SRC, { st });
  const dom = (lv, from, why) => { c.dom = { pmDecLv: { value: String(lv) }, pmDecFrom: { value: from }, pmDecWhy: { value: why } }; };
  dom(2, '2026-11-03', ''); await run(c, `pmDecide('e3','F06')`);
  assert.equal(c.S.prep_certs, undefined); assert.match(c.toasts.pop()[0], /理由/);
  dom(2, '2026-10-21', '面談'); await run(c, `pmDecide('e3','F06')`);
  assert.equal(c.S.prep_certs, undefined); assert.match(c.toasts.pop()[0], /今日か/);
  dom(2, '2026-10-25', '面談'); await run(c, `pmDecide('e3','F06')`);
  assert.equal(c.S.prep_certs, undefined); assert.match(c.toasts.pop()[0], /表がありません/);   // the table starts 11/1
  dom(2, '2026-11-03', '面談で確認'); await run(c, `pmDecide('e3','F06')`);
  const r = Object.values(c.S.prep_certs)[0];
  assert.deepEqual([r.lv, r.from, r.kind, r.state, r.reason, r.tbl], [2, '2026-11-03', 'raise', 'approved', '面談で確認', 't1']);
  clear(c);
  assert.equal(run(c, `empWageAt('Lani','F06','2026-11-03')`), 18.25);
  // A store manager / AM cannot.
  const am = app(SRC, { role: 'am', user: 'Yuki', st }); am.dom = c.dom; await run(am, `pmDecide('e3','F06')`); assert.equal(am.S.prep_certs, undefined);
  // Pending request → blocked.
  const p = app(SRC, { st: { ...st, prep_certs: { q: { emp: 'e3', name: 'Lani', store: 'F06', lv: 3, kind: 'req', state: 'pending', _at: 1 } } } });
  p.dom = c.dom; await run(p, `pmDecide('e3','F06')`);
  assert.equal(Object.keys(p.S.prep_certs).length, 1); assert.match(p.toasts.pop()[0], /承認センター/);
});

test('remove the Prep mark: ends the Prep wage tomorrow, withdraws later certificates and pending requests (and their approval items)', async () => {
  const st = { prep_tables: { t1: table('F01', '2026-11-01') },
    prep_certs: { a: cert('e1', 'Pia', 'F01', 2, '2026-10-15', 't1'), f: cert('e1', 'Pia', 'F01', 3, '2026-12-01', 't1', { dt: 200 }), q: { emp: 'e1', name: 'Pia', store: 'F06', lv: 2, kind: 'req', state: 'pending', _at: 3 } },
    approvals: [{ id: 'apq', type: 'プレップ認定', ref: 'q', status: 'pending', _mut: 3, from: 'Tac', store: 'F06' }] };
  st.prep_tables.t1.from = '2026-10-01';
  const c = app(SRC, { st, fns: ['resolveApprovalByRef', '_apMarkDecided', 'apDecStamp', '_apStT', '_apMut', '_actorName', 'apNotifyAcctApplied', 'addNotif', 'getNotifs'] });
  await run(c, `removePrepEmp('e1')`);
  const certs = c.S.prep_certs;
  assert.equal(c.S.m_employees.find(e => e.id === 'e1').prep, false);
  assert.equal(certs.f.state, 'withdrawn'); assert.equal(certs.q.state, 'withdrawn');
  const end = Object.values(certs).find(x => x.kind === 'end');
  assert.deepEqual([end.store, end.from], ['F01', '2026-10-23']);
  assert.equal(c.S.approvals[0].status, 'withdrawn');
  clear(c);
  assert.equal(run(c, `empWageAt('Pia','F01','2026-10-22')`), 18.25);   // today: still the Prep wage (Lv2 on the table)
  assert.equal(run(c, `empWageAt('Pia','F01','2026-12-05')`), 18);      // after the end: the master wage again
});

test('Toast marks: approved certificates wait for “反映した” (GM/CEO/accounting); the record keeps who and when', async () => {
  const st = { prep_tables: { t1: table('F06', '2026-11-01') }, prep_certs: { a: cert('e3', 'Lani', 'F06', 2, '2026-11-01', 't1', { toast: null }) } };
  const c = app(SRC, { st });
  assert.equal(plain(run(c, `pmToastPending('F06')`)).length, 1);
  await run(c, `pmMarkToast('a')`);
  assert.equal(c.S.prep_certs.a.toast.by, 'Moto');
  clear(c); assert.equal(plain(run(c, `pmToastPending('F06')`)).length, 0);
  const am = app(SRC, { role: 'am', user: 'Yuki', st }); await run(am, `pmMarkToast('a')`); assert.equal(am.S.prep_certs.a.toast, null);
});

test('screens: matrix, person sheet, approval detail, settings and switch render without errors; AM sees wages as today, crew sees nothing', () => {
  const st = { prep_tables: { t1: table('F06', '2026-11-01') }, prep_certs: { a: cert('e4', 'Sam', 'F06', 2, '2026-10-01', 't1', { toast: null }), r: { emp: 'e3', name: 'Lani', store: 'F06', lv: 3, kind: 'req', state: 'pending', n: 7, total: 7, method: 'avg', _at: 9 } } };
  st.prep_tables.t1.from = '2026-10-01';
  const c = app(SRC, { st });
  const h = run(c, `renderStorePrepPanel('F06')`);
  assert.match(h, /プレップLv：LaLa/); assert.match(h, /設定案/); assert.match(h, /\$18\.25/); assert.match(h, /申請中/); assert.match(h, /反映していない人：1/);
  assert.match(run(c, `renderPrepLevel()`), /店ごと/);
  run(c, `pmOpenPerson('e3','F06')`); assert.match(c.modals.pop(), /レシピどおり/);
  assert.match(run(c, `pmApprovalDetailHtml({ref:'r'})`), /Lv3/);
  run(c, `pmOpenSettings('F06')`); assert.match(c.modals.pop(), /Lv と時給の表/);
  const am = app(SRC, { role: 'am', user: 'Yuki', st });
  assert.match(run(am, `renderStorePrepPanel('F06')`), /\$18\.25/);
  assert.doesNotMatch(run(am, `renderStorePrepPanel('F06')`), /Lv を決める/);
  const crew = app(SRC, { role: 'crew', user: 'Lani', st });
  assert.equal(run(crew, `renderStorePrepPanel('F06')`), '');
});

test('sync: the three new keys are synced, merged per record and never freed; the approval type and accounting notice exist', () => {
  const arr = d => { const i = SRC.indexOf(d); assert.ok(i >= 0, d); return SRC.slice(i, SRC.indexOf('];', i)); };
  const SYNC = arr('var OP_SYNC_KEYS = [');
  for (const k of ['prep_cfg', 'prep_tables', 'prep_certs']) {
    assert.ok(SYNC.indexOf("'" + k + "'") >= 0, 'OP_SYNC_KEYS ' + k);
    assert.match(SRC, new RegExp('  ' + k + ': +\\{ merge: mergeMapByTime, covers: _coversMapByTime \\}'));
    assert.match(SRC, new RegExp("var LS_NEVER_FREE[\\s\\S]*'" + k + "'[\\s\\S]*function _lsProtectedKey"));
  }
  assert.match(varFrom(SRC, 'APPROVAL_TYPES'), /'プレップ認定'/);
  assert.match(fnSrc('_aprDefaultRoles'), /'プレップ認定':\['gm'\]/);
  assert.match(varFrom(SRC, 'AP_ACCT_TYPES'), /'プレップ認定'/);
  // The v1106 code never writes a per-person wage into shared data (prep_history / e.wage) any more.
  assert.equal(/addPrepHistory\(/.test(PM.replace(/function addPrepHistory\(/, '')), false);
  assert.equal(/e\.wage\s*=/.test(PM), false);
});
