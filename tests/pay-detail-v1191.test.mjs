// v1191 (Moto 11/18 "はい"): the shift leader allowance per person, HQ shift-in amounts per person and the onboarding
// Payroll step are payroll. Accounting (office) and Office Crew no longer see or export them; the CEO and GM do.
// The tip distribution table is NOT in that rule (Moto 11/18 09:09 HST: "TIPの配分表は今まで通り経理にも事務Crewにも全て見える、
// 出力できる状態を維持"): per-person amounts, ①〜④, No Tip hours, the exclude toggles, the CSV exports and the tip list on
// the accounting export screen stay for accounting and Office Crew exactly as before.
// Store-side views (store manager, AM, G2 and up looking at their own store's tip distribution) stay as before.
// HQ shift-in per person and the accounting book (3 tabs) follow canViewIndividualWage (CEO and GM only).
// Totals (day, period, store, all stores) stay visible to everyone who saw them before.
// Runs the real functions from index.html in VMs with synthetic data. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function fnFrom(name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, name);
  return src.slice(start + 1, src.indexOf('\n}', start + 1) + 2);
}
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
const ROLE_BLOCK = between('\nconst ROLE_CONFIG = {', '\n};') + '\n};';
const PAY_FNS = ['salaryDisplayOn', 'salaryVisibleToMe', 'canViewIndividualWage', 'canEditWages',
  'payDetailHidden', 'payDetailMsg', 'payDetailBlocked', 'payDetailNoteHtml'];
const ROLES = ['ceo', 'gm', 'office', 'office_crew', 'am', 'chef', 'g4', 'sl', 'g2', 'crew'];
const ACCT = ['office', 'office_crew'];
// PR #194 の Codex（2bdd2c1）：止めている範囲どおりの 3 つの文（店の画面の Tip・手当は今までどおりなので「CEO・GM だけ」とは言わない）
const NOTE_JA = '経理・事務Crew には出さず、出力もしません';
const NOTE_EN = 'not shown to or exported by accounting and office crew';
const NOTE_HQ_JA = '本部シフトインの個人の額と給与のまとめは、CEO・GM だけが見て出力します';
const NOTE_OUT_JA = 'ここからは出力しません（CEO・GM が出力します';
const NOTE_OUT_TIP_JA = 'Tip の一覧は今までどおり出力できます';

// Synthetic people (no real staff names) and amounts.
const A = 'Aki Sample', B = 'Ben Sample', C = 'Cai Trainee';
const DAY = { date: '2026-11-03', dist: {
  tip: { lunchCredit: 100, dinnerCredit: 200, lunchCash: 10, dinnerCash: 20, lunchTotal: 106.5, dinnerTotal: 213 },
  list: [{ name: A, lunch: 60.25, dinner: 100, lunchHours: 4, dinnerHours: 5 }, { name: B, lunch: 46.25, dinner: 113, lunchHours: 3, dinnerHours: 6 }],
} };
const DAY2 = { date: '2026-11-04', dist: {
  tip: { lunchCredit: 50, dinnerCredit: 0, lunchCash: 0, dinnerCash: 0, lunchTotal: 48.25, dinnerTotal: 0 },
  list: [{ name: A, lunch: 48.25, dinner: 0, lunchHours: 4, dinnerHours: 0 }],
} };

function app(role, opts) {
  opts = opts || {};
  const c = {
    curRole: role, curLang: opts.lang || 'ja', curStore: 'F01', curStoreLogin: false, curUserName: 'Test User',
    TOASTS: [], CALLS: [], window: {}, STORES: [{ id: 'F01', name: 'Store One', color: '#123' }, { id: 'F02', name: 'Store Two', color: '#456' }],
    TIP_CC_FEE: 0.035, Date, JSON, Math, Object, String, Number, Promise,
    setTimeout: () => 0, MODE: opts.mode || 'pc', SALARY_ON: opts.salaryOn !== false,
  };
  vm.createContext(c);
  vm.runInContext(`
    ${ROLE_BLOCK}
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m, k){ TOASTS.push(String(m)); }
    function ls(k, d){ if (k === 'salary_display') return SALARY_ON; return d; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _money(v){ return '$' + (Number(v)||0).toFixed(2); }
    ${PAY_FNS.map(fnFrom).join('\n')}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);

test('role rule: per-person pay is hidden from accounting and Office Crew only; strict (HQ shift-in, accounting book) is CEO/GM only', () => {
  for (const r of ROLES) {
    const c = app(r);
    assert.equal(run(c, 'payDetailHidden()'), ACCT.includes(r), r + ' hidden');
    assert.equal(run(c, 'canViewIndividualWage()'), r === 'ceo' || r === 'gm', r + ' individual wage');
    assert.equal(run(c, 'canEditWages()'), r === 'ceo' || r === 'gm', r + ' edit wages');
    // loose check (shift leader exports): blocks accounting only, with a notice
    assert.equal(run(c, 'payDetailBlocked()'), ACCT.includes(r), r + ' blocked (loose)');
    assert.equal(c.TOASTS.length, ACCT.includes(r) ? 1 : 0, r + ' notice (loose)');
    if (ACCT.includes(r)) {
      assert.ok(c.TOASTS[0].includes(NOTE_JA), r + ': the shift leader wording');
      assert.ok(!c.TOASTS[0].includes('Tip'), r + ': the notice no longer says tip amounts are hidden');
    }
    // strict check (HQ shift-in, the accounting book): only the CEO and GM pass
    c.TOASTS.length = 0;
    const strict = !(r === 'ceo' || r === 'gm');
    assert.equal(run(c, 'payDetailBlocked(true)'), strict, r + ' blocked (strict)');
    assert.equal(c.TOASTS.length, strict ? 1 : 0, r + ' notice (strict)');
    if (strict) assert.ok(c.TOASTS[0].includes(NOTE_HQ_JA), r + ': the HQ wording (not "accounting only")');
  }
  // the company-wide "hide pay" switch does not open anything for accounting
  assert.equal(run(app('office', { salaryOn: false }), 'payDetailHidden()'), true);
  assert.equal(run(app('gm', { salaryOn: false }), 'canViewIndividualWage()'), true);
  // the notice says why, in both languages
  assert.ok(run(app('office'), 'payDetailNoteHtml()').includes(NOTE_JA));
  assert.ok(!run(app('office'), 'payDetailNoteHtml()').includes('CEO・GM だけ'), 'the allowance note does not say "CEO/GM only" (store screens still show the allowance)');
  assert.ok(!run(app('office'), 'payDetailNoteHtml()').includes('Tip'), 'the allowance note does not mention tips');
  assert.ok(run(app('office'), "payDetailNoteHtml('hq')").includes(NOTE_HQ_JA));
  assert.ok(run(app('office'), "payDetailNoteHtml('out')").includes(NOTE_OUT_JA));
  assert.ok(run(app('office'), "payDetailNoteHtml('out')").includes(NOTE_OUT_TIP_JA), 'the export note says the tip lists still export');
  assert.ok(run(app('office', { lang: 'en' }), 'payDetailNoteHtml()').includes(NOTE_EN));
});

// ---- export guards: the export does not start (no data read, no file) and a notice explains why ----
const EXPORTS = [
  { fn: 'exportSlPayrollCSV', args: "'F01','2026-11-05'", strict: false, probe: '_p4Period' },
  { fn: 'exportAllSlPayrollCSV', args: "'2026-11-05','2026-11-20'", strict: false, probe: 'getVisibleStores' },
  // tip exports: open to everyone who could run them before, accounting and Office Crew included (Moto 11/18 09:09 HST)
  { fn: 'exportTipPeriodCsv', args: '', open: true, probe: 'tipPeriodInfo' },
  { fn: 'exportTipCSV', args: "'F01','2026-11-05'", open: true, probe: 'tipNtSettle' },
  { fn: 'exportAllTipCSV', args: "'2026-11-05','2026-11-20'", open: true, probe: 'getVisibleStores' },
  { fn: 'exportHqSitePayrollCSV', args: "'F01','2026-11-01','2026-11-15'", strict: true, probe: 'hqSiteLaborData' },
  { fn: 'exportAllHqSitePayrollCSV', args: "'2026-11-01','2026-11-15'", strict: true, probe: 'hqSiteLaborAll' },
  { fn: 'exportAcctPayrollBook', args: "'2026-11-05','2026-11-20'", strict: true, probe: 'tipNtSettle' },
];
for (const ex of EXPORTS) {
  test(`${ex.fn}: ${ex.open ? 'runs for accounting and Office Crew as before' : (ex.strict ? 'CEO/GM only' : 'not for accounting / Office Crew') + ' (no data read, a notice)'}`, async () => {
    for (const r of ROLES) {
      const c = app(r);
      // the first thing the export would read after the guard records a call and stops the run
      run(c, `function ${ex.probe}(){ CALLS.push('${ex.probe}'); throw new Error('PROCEEDED'); }
              var curStore = 'F01';
              ${fnFrom(ex.fn)}`);
      let proceeded = false;
      try { await run(c, `${ex.fn}(${ex.args})`); } catch (e) { if (String(e.message) === 'PROCEEDED') proceeded = true; else throw e; }
      const blocked = ex.open ? false : ex.strict ? !(r === 'ceo' || r === 'gm') : ACCT.includes(r);
      assert.equal(proceeded, !blocked, `${ex.fn} ${r}: ${blocked ? 'stopped before reading data' : 'runs as before'}`);
      assert.deepEqual([...c.CALLS], blocked ? [] : [ex.probe], `${ex.fn} ${r} calls`);
      if (blocked) assert.ok(c.TOASTS.some(m => m.includes('CEO・GM')), `${ex.fn} ${r}: says who can`);
      if (ex.open) assert.equal(c.TOASTS.length, 0, `${ex.fn} ${r}: no "hidden" notice`);
    }
  });
}

// ---- tip distribution table (PC and phone) ----
function tipMatrixApp(role, mode, opts) {
  const c = app(role, Object.assign({ mode }, opts || {}));
  run(c, `
    var M0 = { names: ['${A}', '${B}'], dists: [${JSON.stringify(DAY)}, ${JSON.stringify(DAY2)}], rates: {}, rateFrom: {}, unmatched: [], pending: false };
    function tipPeriodMatrix(){ return M0; }
    function tipCellHtml(storeId, date, name, slot, r, bl){ return '<td data-cell="' + name + '|' + slot + '">' + (r && r[slot] ? Number(r[slot]).toFixed(2) : '') + '</td>'; }
    function tipCashCellHtml(){ return '<td></td>'; }
    function _tipCashCanEdit(){ return false; }
    function creditTipAdjCanEdit(){ return false; }
    function getCreditTipAdj(){ return {}; }
    function getTipLabor(){ var o = {}; o['${C}'] = { lunch: 4, dinner: 0 }; return o; }
    function effectiveTipRate(nm){ return nm === '${C}' ? 0 : 100; }
    function tipRateColor(){ return '#000'; }
    function u9Mode(){ return MODE; }
    function u11TipDay(){}
    function todayISO(){ return '2026-11-05'; }
    ${fnFrom('renderTipPeriodMatrix')}
  `);
  return c;
}
const INFO = "{ from: '2026-11-01', to: '2026-11-15', rangeLabel: '11/1〜11/15' }";
for (const mode of ['pc', 'sp']) {
  test(`tip distribution table (${mode}): everyone who opens it sees the people, ①〜④ and the totals — accounting and Office Crew included`, () => {
    for (const r of ROLES) {
      for (const lang of ['ja', 'en']) {
        const c = tipMatrixApp(r, mode, { lang });
        c.window._u11TipDay = '2026-11-03';   // phone: show 11/3
        const h = run(c, `renderTipPeriodMatrix('F01', STORES[0], ${INFO})`);
        // the people (with the No Tip person's hours on PC) and their amounts stay for every role (Moto 11/18 09:09 HST)
        for (const nm of mode === 'pc' ? [A, B, C] : [A, B]) assert.ok(h.includes(nm), `${mode} ${r} ${lang}: ${nm}`);
        if (mode === 'pc') assert.ok(h.includes('$208.50'), `${mode} ${r} ${lang}: per-person period total`);   // Aki: 60.25+100+48.25
        assert.ok(h.includes(mode === 'pc' ? 'data-cell=' : 'u11-tdt'), `${mode} ${r} ${lang}: per-person cells (and their exclude toggles)`);
        // ④ actual tips stay
        assert.ok(h.includes('106.50') && h.includes('213.00'), `${mode} ${r} ${lang}: actual tips`);
        // no "hidden" note and no narrowed label column any more
        assert.ok(!h.includes(lang === 'en' ? NOTE_EN : NOTE_JA) && !h.includes('u-paynote'), `${mode} ${r} ${lang}: no note`);
        assert.ok(!h.includes('min-width:128px'), `${mode} ${r} ${lang}: the label column is as before`);
        // the "tap a staff cell to exclude it" hint is back for everyone
        assert.ok(h.includes(lang === 'en' ? 'Tap a staff cell' : '各スタッフのセルをタップ'), `${mode} ${r} ${lang}: the tap hint`);
      }
    }
  });
}
test('tip distribution table: the rows for accounting and Office Crew are the same as for the CEO (nothing taken out)', () => {
  for (const mode of ['pc', 'sp']) {
    const base = (() => { const c = tipMatrixApp('ceo', mode); c.window._u11TipDay = '2026-11-03'; return run(c, `renderTipPeriodMatrix('F01', STORES[0], ${INFO})`); })();
    for (const r of ACCT) {
      const c = tipMatrixApp(r, mode); c.window._u11TipDay = '2026-11-03';
      assert.equal(run(c, `renderTipPeriodMatrix('F01', STORES[0], ${INFO})`), base, `${mode} ${r}: identical to the CEO's table`);
    }
  }
});

// ---- the day detail (modal) ----
test('tip day detail: everyone who opens it sees the staff list, the L/D summary and the difference check', () => {
  for (const r of ROLES) {
    const c = app(r);
    run(c, `
      var MODAL = '';
      function openModal(h){ MODAL = h; }
      function cashTipNoteHtml(){ return ''; }
      function getCreditTipAdj(){ return {}; }
      function creditTipAdjCanEdit(){ return false; }
      function calcTipDistribution(){ var d = ${JSON.stringify(DAY.dist)}; d.hasLabor = true;
        d.tip.lunchCreditRaw = 100; d.tip.dinnerCreditRaw = 200; d.tip.lunchCreditAdj = 0; d.tip.dinnerCreditAdj = 0;
        d.list.forEach(function(x){ x.total = (x.lunch||0) + (x.dinner||0); x.by = 'rate'; x.rate = 100; }); return d; }
      ${fnFrom('openTipDayDetail')}
    `);
    run(c, "openTipDayDetail('F01','2026-11-03')");
    const h = c.MODAL;
    for (const nm of [A, B]) assert.ok(h.includes(nm), `${r}: ${nm}`);
    assert.ok(h.includes('toggleTipExclude'), `${r}: per-person exclude buttons (accounting can exclude a shift again)`);
    assert.ok(h.includes('$160.25'), `${r}: Aki's day amount`);
    assert.ok(h.includes('配分合計') && h.includes('差額'), `${r}: summary and difference check stay`);
    assert.ok(!h.includes(NOTE_JA), `${r}: no note`);
  }
});

// ---- shift leader allowance ----
function slApp(role) {
  const c = app(role);
  run(c, `
    var slHalf = 'first';
    function soloStoreId(){ return 'F01'; }
    function slCfg(){ return { stores: ['F01'], amount: 10 }; }
    function slStoreEnabled(){ return true; }
    function _owStoreName(id){ return id === 'F01' ? 'Store One' : id; }
    function tipPeriodInfo(){ return { y: 2026, m: 10 }; }
    function _p4Period(){ return { from: '2026-11-01', to: '2026-11-15', label: '11/1〜11/15' }; }
    function slPeriodSummary(){ return { amount: 10, total: 70, excluded: [], rows: [
      { name: '${A}', amount: 40, count: 4, L: 2, D: 2, recs: [{ date: '2026-11-02', period: 'L' }] },
      { name: '${B}', amount: 30, count: 3, L: 1, D: 2, recs: [{ date: '2026-11-03', period: 'D' }] } ] }; }
    function slToastHasJob(){ return true; }
    function slManualAll(){ return {}; }
    function getEmployees(){ return []; }
    function _slGrade(){ return 'G1'; }
    ${fnFrom('renderTipShiftLeader')}
  `);
  return c;
}
test('shift leader allowance: accounting sees the people count, shifts and total, not who gets how much; no CSV button', () => {
  for (const r of ROLES) {
    const h = run(slApp(r), 'renderTipShiftLeader()'), hidden = ACCT.includes(r);
    for (const nm of [A, B]) assert.equal(h.includes(nm), !hidden, `${r}: ${nm}`);
    assert.equal(h.includes('$40.00'), !hidden, `${r}: Aki's allowance`);
    assert.equal(h.includes('exportSlPayrollCSV'), !hidden, `${r}: CSV button`);
    assert.ok(h.includes('$70.00'), `${r}: the total stays`);
    assert.equal(h.includes(NOTE_JA), hidden, `${r}: note`);
  }
});

// ---- HQ shift-in (per person = CEO/GM only, everyone else who opens the screen sees the store total) ----
function hqApp(role) {
  const c = app(role);
  run(c, `
    function canSeeHqSite(){ return ['ceo','gm','office','chef','am'].indexOf(curRole) >= 0; }
    function hqSiteLaborData(){ return { total: 123.45, hours: 7.5, rows: [
      { name: '${A}', title: 'Accountant', wage: 20, hours: 4, amount: 80, days: ['2026-11-02'] },
      { name: '${B}', title: 'Head Chef', wage: 0, hours: 3.5, amount: 43.45, days: ['2026-11-03'] } ] }; }
    function hqSiteLaborAll(){ return { total: 200, hours: 10, stores: ['F01'], noWage: 0 }; }
    function _owStoreName(){ return 'Store One'; }
    ${fnFrom('renderTipHqSite')}
  `);
  return c;
}
test('HQ shift-in: per person (field wage and amount) and the CSV are CEO/GM only; AM, Head Chef and accounting see the totals', () => {
  for (const r of ['ceo', 'gm', 'office', 'am', 'chef']) {
    const h = run(hqApp(r), `renderTipHqSite('F01', ${INFO})`), full = r === 'ceo' || r === 'gm';
    for (const nm of [A, B]) assert.equal(h.includes(nm), full, `${r}: ${nm}`);
    assert.equal(h.includes('exportHqSitePayrollCSV'), full, `${r}: CSV`);
    assert.ok(h.includes('$200.00') && h.includes('$123.45'), `${r}: all-store and store totals stay`);
    assert.equal(h.includes(NOTE_HQ_JA), !full, `${r}: note`);
  }
  // people who could not open the screen still cannot
  for (const r of ['office_crew', 'sl', 'crew']) assert.ok(run(hqApp(r), `renderTipHqSite('F01', ${INFO})`).includes('本部（GM / CEO / 経理 / AM / Head Chef）のみ'), r);
});

// ---- tip page buttons ----
test('tip page buttons: everyone keeps "re-fetch from Toast" and the L/D CSV; the accounting book (3 tabs) is CEO/GM only', () => {
  const block = between('// ペイロール期間（半月）の日次ランチ/ディナー配分内訳をCSV出力', "if (tipPeriodView==='hqsite')");
  for (const r of ROLES) {
    const c = app(r);
    run(c, "var tipPeriodView = 'matrix', storeId = 'F01', info = { from: '2026-11-01', to: '2026-11-15' }, html = '';");
    run(c, block);
    const h = c.html;
    assert.ok(h.includes('tipRefreshPeriodFromToast'), `${r}: re-fetch stays`);
    assert.ok(h.includes('exportTipPeriodCsv'), `${r}: per-person L/D CSV (as before)`);
    assert.equal(h.includes('exportAcctPayrollBook'), r === 'ceo' || r === 'gm', `${r}: accounting book`);
  }
});

// ---- onboarding: the Payroll step (hourly wage) ----
test('onboarding: the "Payroll登録" button and the register / finalize steps are CEO/GM only; accounting still reviews', () => {
  const ob = { id: 'ob1', obStatus: '経理確認中', name: 'New Hire', store: 'F01', storeName: 'Store One', pos: 'Server' };
  for (const r of ROLES) {
    const c = app(r);
    run(c, `function obImgSrc(){ return ''; }
            ${fnFrom('obCardInner')}
            var MODALS = 0, SAVED = 0;
            function openModal(){ MODALS++; }
            function lsSet(){ SAVED++; }
            ${fnFrom('openPayrollRegister')}
            ${fnFrom('finalizePayroll')}`);
    const h = run(c, `obCardInner(${JSON.stringify(ob)})`), can = r === 'ceo' || r === 'gm';
    assert.equal(h.includes('openPayrollRegister'), can, `${r}: Payroll button`);
    if (!can) {
      // a direct call (old link or console) stops before opening or saving
      run(c, "openPayrollRegister('ob1'); finalizePayroll('ob1');");
      assert.equal(c.MODALS, 0, `${r}: no modal`);
      assert.equal(c.SAVED, 0, `${r}: nothing saved`);
      assert.equal(c.TOASTS.length, 2, `${r}: two notices`);
    }
    // the accounting review step itself is unchanged
    const h2 = run(c, `obCardInner(${JSON.stringify(Object.assign({}, ob, { obStatus: '提出完了' }))})`);
    assert.equal(h2.includes("officeReview('ob1','approve')"), ['office', 'gm', 'ceo'].includes(r), `${r}: accounting review`);
  }
  // the onboarding list says who does the Payroll step
  const c = app('office'); run(c, fnFrom('u11ObNext'));
  assert.equal(run(c, "u11ObNext('経理確認中')"), 'GM・CEO が Payroll に登録');
  c.curLang = 'en'; assert.equal(run(c, "u11ObNext('Payroll登録中')"), 'GM/CEO registers in Payroll');
  // the error center points at the CEO/GM for the Payroll step, and at Office for the review
  run(c, `var OBS = [{ id:'a', name:'P1', obStatus:'経理確認中' }, { id:'b', name:'P2', obStatus:'提出完了' }];
          function ls(k, d){ return k === 'onboardings' ? OBS : d; }
          ${fnFrom('ecDetOnboard')}`);
  const iss = run(c, 'ecDetOnboard()');
  assert.ok(iss[0].title.includes('GM・CEO の Payroll 登録待ち') && iss[0].fp === '経理確認中', 'payroll step');
  assert.ok(iss[1].title.includes('Office対応待ち'), 'review step unchanged');
});

// ---- accounting center: export screens ----
function acctApp(role, pc) {
  const c = app(role);
  run(c, `
    var CLASSES = [{ id: 'food', name: 'Food' }];
    function getVisibleStores(){ return STORES; }
    function acctMonthRef(){ return new Date(2026, 10, 1); }
    function _acctAutoRefresh(){}
    function _acctBusy(){ return false; }
    function empSmIsPc(){ return ${pc ? 'true' : 'false'}; }
    function uiPcWatch1178(){}
    function acctMonthLabel(){ return '2026/11'; }
    function _acctFreshNoteHtml(){ return ''; }
    function _acctTipStatusHtml(){ return ''; }
    function slStoreEnabled(id){ return id === 'F01'; }
    function slCfg(){ return { amount: 10 }; }
    function _p4Period(d){ return { from: d, to: d }; }
    function slPayrollData(){ return { total: 70, rows: [{ name: '${A}' }] }; }
    function invHistInMonth(){ return false; }
    function itMonthlyReport(){ return { count: 0 }; }
    function officePayrollRows(){ return [{ name: '${C}', type: '時給', hours: 10, wage: 25, pay: 250, days: 2 }]; }
    function invoiceAcctData(){ return { inMonth: [], matrix: {}, clsTotals: {} }; }
    function cardReceiptAcctData(){ return { inMonth: [], purposes: {}, byEmp: {}, grand: 0 }; }
    function supplyAcctData(){ return { placed: [], grand: 0, classes: [], matrix: {}, clsTotals: {} }; }
    ${fnFrom('officePayrollCardHtml')}
    ${fnFrom('renderAcctExport')}
  `);
  return c;
}
for (const pc of [false, true]) {
  test(`accounting export (${pc ? 'PC' : 'phone/tablet'}): the tip list stays for accounting; shift leader allowance, office payroll and the book are CEO/GM only; inventory and invoices stay`, () => {
    for (const r of ['ceo', 'gm', 'office']) {
      const h = run(acctApp(r, pc), 'renderAcctExport()'), full = r !== 'office';
      for (const fn of ['exportTipCSV', 'exportAllTipCSV']) assert.ok(h.includes(fn), `${r}: ${fn} (as before)`);
      assert.ok(h.includes('Tip'), `${r}: the tip list heading`);
      for (const fn of ['exportAcctPayrollBook', 'exportSlPayrollCSV', 'exportAllSlPayrollCSV', 'exportOfficePayrollCSV'])
        assert.equal(h.includes(fn), full, `${r}: ${fn}`);
      assert.equal(h.includes(C), full, `${r}: an office person's pay row`);
      assert.ok(h.includes('exportAllInventoryCSV'), `${r}: inventory export stays`);
      assert.ok(h.includes('請求書（仕入）集計'), `${r}: invoice summary stays`);
      assert.equal(h.includes(NOTE_OUT_JA), !full, `${r}: note`);
    }
  });
}
const GUARD_BLOCK = between('\nvar PAGE_GUARD = {', '\n};') + '\n};';
test('accounting center menu: the payroll CSV entries are CEO/GM only; accounting keeps the tip CSV and the category export', () => {
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) {
    const c = app(r);
    run(c, `${GUARD_BLOCK}
            var CREW_EXTRA_PAGES = [];
            ${fnFrom('pageRoleAllowed')}
            ${fnFrom('navGuardAllows')}
            ${fnFrom('renderOfficeExport')}`);
    const h = run(c, 'renderOfficeExport()'), full = r === 'ceo' || r === 'gm';
    assert.equal(h.includes('給与・経理CSV'), full, `${r}: group title`);
    assert.equal(h.includes('Tip・経理CSV'), !full, `${r}: group title (accounting)`);
    // the tip CSV entry: accounting goes to the accounting export screen, Office Crew to the tip screen (it cannot open acct_export — as before)
    assert.equal(h.includes('Tip CSV（店舗）'), !full, `${r}: tip CSV entry`);
    if (r === 'office') assert.match(h, /go\('acct_export'\)[^>]*>[\s\S]{0,400}Tip CSV（店舗）/, 'office: tip CSV → acct_export');
    if (r === 'office_crew') assert.match(h, /go\('tip'\)[^>]*>[\s\S]{0,400}Tip CSV（店舗）/, 'office_crew: tip CSV → tip screen');
    assert.equal(h.includes('給与CSV（店舗）'), full, `${r}: store payroll CSV`);
    assert.equal(h.includes('給与CSV（Office）'), full, `${r}: office payroll CSV`);
    assert.ok(h.includes('経理区分エクスポート') && h.includes('棚卸Excel'), `${r}: category export and inventory stay`);
  }
});

// ---- tip CSV exports (PR #194 Codex 4e7ae43 / 6989080060) ----
// The three tip CSVs stay open to accounting and Office Crew with every tip column and row (Moto 11/18 09:09 HST),
// but the shift leader allowance that used to ride in the same files (per-person shifts, rate, allowance, "received + allowance",
// people who only led shifts, and the payout block) is payroll and is left out for them. The CEO, GM and store roles keep it.
// The exports run to the end here and the rows handed to downloadCSV are checked.
const D = 'Dee Leader';                                   // led shifts, no tip this period (shows only in the allowance part)
const SL_AMT = ['12.50', '37.50', '87.50', '125.00'];     // rate, Aki's and Dee's allowance, total (no tip amount collides)
const CSV_NOTE = 'シフトリーダー手当（回数・単価・手当・受取＋手当）は給与のため、この出力には入れていません';
function csvApp(role) {
  const c = app(role);
  run(c, `
    var CSV = [];
    function downloadCSV(rows, name){ CSV.push({ rows: rows, name: name }); }
    ${src.includes('\nfunction payDetailCsvNote(') ? fnFrom('payDetailCsvNote') : ''}
    function tipNtSettle(fn){ return Promise.resolve(fn()); }
    function tipNtPendingMsg(){ return 'pending'; }
    function tipPeriodInfo(){ return { from: '2026-11-01', to: '2026-11-15' }; }
    function tipPeriodRateLabel(){ return '100%'; }
    function tipPeriodMatrix(){ return { names: ['${A}', '${B}'], dists: ${JSON.stringify([DAY, DAY2])}, rates: {}, pending: false }; }
    function slStoreEnabled(){ return true; }
    function slPeriodSummary(){ CALLS.push('slPeriodSummary'); return { amount: 12.5, total: 125, days: 3, excluded: [], rows: [
      { name: '${A}', amount: 37.5, count: 3, L: 1, D: 2, recs: [{ date: '2026-11-03', period: 'L' }] },
      { name: '${D}', amount: 87.5, count: 7, L: 3, D: 4, recs: [{ date: '2026-11-04', period: 'D' }] } ] }; }
    function slDayRecords(storeId, date){ return { ok: date === '2026-11-03' ? [{ name: '${A}', period: 'L' }, { name: '${D}', period: 'D' }] : [{ name: '${D}', period: 'D' }] }; }
    function _owStoreName(id){ return id === 'F01' ? 'Store One' : 'Store Two'; }
    function halfMonthRange(d){ return Number(String(d).slice(8)) <= 15 ? { from: d.slice(0, 8) + '01', to: d.slice(0, 8) + '15' } : { from: d.slice(0, 8) + '16', to: d.slice(0, 8) + '30' }; }
    function calcHalfMonthSettlement(storeId, d){ var r = halfMonthRange(d); return { anyLabor: true, pending: false, range: r, rows: [
      { name: '${A}', isSL: false, hours: 13, base: 208.5, contribution: 0, redistrib: 0, final: 208.5 },
      { name: '${B}', isSL: true, hours: 9, base: 159.25, contribution: 15.93, redistrib: 0, final: 143.32 } ] }; }
    function halfMonthDates(){ return ['2026-11-03', '2026-11-04']; }
    function calcTipDistribution(storeId, date){
      var d = JSON.parse(JSON.stringify(date === '2026-11-03' ? ${JSON.stringify(DAY.dist)} : ${JSON.stringify(DAY2.dist)}));
      d.hasLabor = true; d.tip.total = d.tip.lunchTotal + d.tip.dinnerTotal; return d; }
    function getVisibleStores(){ return STORES; }
    function acctMonthLabel(){ return '2026/11'; }
    ${['slPayrollData', '_slRecLabel', 'slPayrollRows', 'tipCSVRows', '_acctTipMiss', '_acctTipMissRows', '_acctPeriods',
       'exportTipPeriodCsv', 'exportTipCSV', 'exportAllTipCSV'].map(fnFrom).join('\n')}
  `);
  return c;
}
const cells = rows => rows.flat().map(v => String(v));
async function csvOf(role, call) {
  const c = csvApp(role);
  await run(c, call);
  assert.equal(c.CSV.length, 1, `${role} ${call}: one file`);
  // rows from different VMs have different Array prototypes: compare plain copies
  return { rows: JSON.parse(JSON.stringify(c.CSV[0].rows)), calls: [...c.CALLS], toasts: [...c.TOASTS] };
}
const TIP_CSV_CALLS = ['exportTipPeriodCsv()', "exportTipCSV('F01','2026-11-05')", "exportAllTipCSV('2026-11-05','2026-11-20')"];
test('tip CSVs: accounting and Office Crew keep every tip column and row, without the shift leader allowance; CEO, GM and store roles keep it', async () => {
  for (const call of TIP_CSV_CALLS) {
    for (const r of ROLES) {
      const { rows, calls, toasts } = await csvOf(r, call), all = cells(rows), hidden = ACCT.includes(r);
      // the tip part is there for everyone
      for (const nm of [A, B]) assert.ok(all.includes(nm), `${call} ${r}: ${nm}`);
      if (call === 'exportTipPeriodCsv()') {
        assert.ok(all.includes('④ 実チップ額') && all.includes('60.25') && all.includes('208.5'), `${call} ${r}: ①〜④ and per-person amounts`);
      } else {
        assert.ok(all.includes('208.50') && all.includes('143.32') && all.includes('351.82'), `${call} ${r}: final tips and the total`);
        assert.ok(all.includes('【日別 ランチ/ディナー内訳】'), `${call} ${r}: the day breakdown`);
      }
      // the shift leader allowance: left out for accounting and Office Crew only
      assert.equal(all.some(v => v.includes(D)), !hidden, `${call} ${r}: the person who only led shifts`);
      for (const v of SL_AMT) assert.equal(all.includes(v), !hidden, `${call} ${r}: allowance amount ${v}`);
      assert.equal(all.some(v => !v.startsWith(CSV_NOTE) && (v.includes('受取＋手当') || v.includes('支給額') || v.includes('【シフトリーダー'))), !hidden, `${call} ${r}: allowance headings`);
      assert.equal(all.includes('SL'), !hidden && call === 'exportTipPeriodCsv()', `${call} ${r}: the SL day marks`);
      assert.equal(calls.includes('slPeriodSummary'), !hidden, `${call} ${r}: the allowance data is ${hidden ? 'not even read' : 'read'}`);
      // what accounting gets instead: one line saying the allowance is not in this file
      assert.equal(all.some(v => v.startsWith(CSV_NOTE)), hidden, `${call} ${r}: the note row`);
      if (hidden) assert.ok(!all.some(v => v.includes('シフトリーダー') && !v.startsWith(CSV_NOTE)), `${call} ${r}: no other shift leader cell`);
      if (call === 'exportTipPeriodCsv()') assert.equal(toasts.some(m => m.includes('シフトリーダー支給額つき')), !hidden, `${call} ${r}: the notice`);
    }
  }
});
test('tip CSVs: for accounting and Office Crew the tip rows are the CEO\'s rows minus the allowance columns (nothing else changes)', async () => {
  for (const call of TIP_CSV_CALLS) {
    const ceo = (await csvOf('ceo', call)).rows;
    for (const r of ACCT) {
      const acc = (await csvOf(r, call)).rows;
      if (call === 'exportTipPeriodCsv()') {
        // ①〜④, every person and 配分合計 are identical
        const end = ceo.findIndex(x => x[0] === '配分合計') + 1;
        assert.ok(end > 0);
        assert.deepEqual(acc.slice(0, end), ceo.slice(0, end), `${call} ${r}: tip rows`);
        continue;
      }
      // the day breakdown and the headings before the per-person table are identical
      const head = ceo.findIndex(x => x[0] === '氏名');
      assert.deepEqual(acc.slice(0, head), ceo.slice(0, head), `${call} ${r}: day breakdown`);
      // per person (and the total): the first 7 columns of the CEO's row, nothing more
      for (const nm of [A, B, '合計']) {
        const cr = ceo.find(x => x[0] === nm && x.length === 13), ar = acc.filter(x => x[0] === nm);
        assert.ok(cr, `${call}: CEO row ${nm}`);
        assert.ok(ar.length >= 1, `${call} ${r}: row ${nm}`);
        for (const x of ar) if (x.length > 3) assert.deepEqual(x, cr.slice(0, 7), `${call} ${r}: ${nm} = the CEO's tip columns`);
      }
      assert.deepEqual(acc.find(x => x[0] === '氏名'), ceo.find(x => x[0] === '氏名').slice(0, 7), `${call} ${r}: header`);
    }
  }
});
