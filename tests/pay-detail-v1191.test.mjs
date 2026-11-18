// v1191 (Moto 11/18 "はい"): individual tip amounts, the shift leader allowance per person, HQ shift-in amounts per person
// and the onboarding Payroll step are payroll. Accounting (office) and Office Crew no longer see or export them; the CEO
// and GM do. Store-side views (store manager, AM, G2 and up looking at their own store's tip distribution) stay as before.
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
    // loose check (tip / shift leader exports): blocks accounting only, with a notice
    assert.equal(run(c, 'payDetailBlocked()'), ACCT.includes(r), r + ' blocked (loose)');
    assert.equal(c.TOASTS.length, ACCT.includes(r) ? 1 : 0, r + ' notice (loose)');
    if (ACCT.includes(r)) assert.ok(c.TOASTS[0].includes(NOTE_JA), r + ': the tip wording');
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
  assert.ok(!run(app('office'), 'payDetailNoteHtml()').includes('CEO・GM だけ'), 'the tip note does not say "CEO/GM only" (store screens still show tip and allowance)');
  assert.ok(run(app('office'), "payDetailNoteHtml('hq')").includes(NOTE_HQ_JA));
  assert.ok(run(app('office'), "payDetailNoteHtml('out')").includes(NOTE_OUT_JA));
  assert.ok(run(app('office', { lang: 'en' }), 'payDetailNoteHtml()').includes(NOTE_EN));
});

// ---- export guards: the export does not start (no data read, no file) and a notice explains why ----
const EXPORTS = [
  { fn: 'exportSlPayrollCSV', args: "'F01','2026-11-05'", strict: false, probe: '_p4Period' },
  { fn: 'exportAllSlPayrollCSV', args: "'2026-11-05','2026-11-20'", strict: false, probe: 'getVisibleStores' },
  { fn: 'exportTipPeriodCsv', args: '', strict: false, probe: 'tipPeriodInfo' },
  { fn: 'exportTipCSV', args: "'F01','2026-11-05'", strict: false, probe: 'tipNtSettle' },
  { fn: 'exportAllTipCSV', args: "'2026-11-05','2026-11-20'", strict: false, probe: 'getVisibleStores' },
  { fn: 'exportHqSitePayrollCSV', args: "'F01','2026-11-01','2026-11-15'", strict: true, probe: 'hqSiteLaborData' },
  { fn: 'exportAllHqSitePayrollCSV', args: "'2026-11-01','2026-11-15'", strict: true, probe: 'hqSiteLaborAll' },
  { fn: 'exportAcctPayrollBook', args: "'2026-11-05','2026-11-20'", strict: true, probe: 'tipNtSettle' },
];
for (const ex of EXPORTS) {
  test(`${ex.fn}: ${ex.strict ? 'CEO/GM only' : 'not for accounting / Office Crew'} (no data read, a notice)`, async () => {
    for (const r of ROLES) {
      const c = app(r);
      // the first thing the export would read after the guard records a call and stops the run
      run(c, `function ${ex.probe}(){ CALLS.push('${ex.probe}'); throw new Error('PROCEEDED'); }
              var curStore = 'F01';
              ${fnFrom(ex.fn)}`);
      let proceeded = false;
      try { await run(c, `${ex.fn}(${ex.args})`); } catch (e) { if (String(e.message) === 'PROCEEDED') proceeded = true; else throw e; }
      const blocked = ex.strict ? !(r === 'ceo' || r === 'gm') : ACCT.includes(r);
      assert.equal(proceeded, !blocked, `${ex.fn} ${r}: ${blocked ? 'stopped before reading data' : 'runs as before'}`);
      assert.deepEqual([...c.CALLS], blocked ? [] : [ex.probe], `${ex.fn} ${r} calls`);
      if (blocked) assert.ok(c.TOASTS.some(m => m.includes('CEO・GM')), `${ex.fn} ${r}: says who can`);
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
  test(`tip distribution table (${mode}): accounting and Office Crew see the ①〜④ rows and the distribution total, not the people`, () => {
    for (const r of ROLES) {
      for (const lang of ['ja', 'en']) {
        const c = tipMatrixApp(r, mode, { lang });
        c.window._u11TipDay = '2026-11-03';   // phone: show 11/3
        const h = run(c, `renderTipPeriodMatrix('F01', STORES[0], ${INFO})`);
        const hidden = ACCT.includes(r);
        for (const nm of [A, B, C]) assert.equal(h.includes(nm), !hidden, `${mode} ${r} ${lang}: ${nm}`);
        // per-person period total for Aki (60.25+100+48.25 = 208.50) is a pay amount
        assert.equal(h.includes('$208.50'), !hidden, `${mode} ${r} ${lang}: per-person period total`);
        assert.equal(h.includes('data-cell='), !hidden, `${mode} ${r} ${lang}: per-person cells (and their exclude toggles)`);
        // the distribution total stays for everyone: phone = the day (11/3: 60.25+100+46.25+113 = 319.50),
        // PC = the period over both days (319.50 + 48.25 = 367.75)
        assert.ok(h.includes(mode === 'sp' ? '$319.50' : '$367.75'), `${mode} ${r} ${lang}: distribution total`);
        // ④ actual tips stay
        assert.ok(h.includes('106.50') && h.includes('213.00'), `${mode} ${r} ${lang}: actual tips`);
        assert.equal(h.includes(lang === 'en' ? NOTE_EN : NOTE_JA), hidden, `${mode} ${r} ${lang}: the note`);
        // the "tap a staff cell to exclude it" hint is only for people who can tap the cells
        assert.equal(h.includes(lang === 'en' ? 'Tap a staff cell' : '各スタッフのセルをタップ'), !hidden, `${mode} ${r} ${lang}: the tap hint`);
        // PC: the note is above the table, not a table row (a colspan + sticky row squeezed the name column and overlapped ④ — 11/18 screen check)
        if (hidden && mode === 'pc') {
          const ni = h.indexOf(lang === 'en' ? NOTE_EN : NOTE_JA);
          assert.ok(ni >= 0 && ni < h.indexOf('<table'), `${mode} ${r} ${lang}: the note is above the table`);
          assert.ok(!/<tr><td colspan="[^"]*" style="position:sticky[^"]*"><div class="u-paynote"/.test(h), `${mode} ${r} ${lang}: no note row inside the table`);
        }
      }
    }
  });
}

// ---- the day detail (modal) ----
test('tip day detail: accounting sees the L/D summary and the difference check, not the staff list', () => {
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
    const h = c.MODAL, hidden = ACCT.includes(r);
    for (const nm of [A, B]) assert.equal(h.includes(nm), !hidden, `${r}: ${nm}`);
    assert.equal(h.includes('toggleTipExclude'), !hidden, `${r}: per-person exclude buttons`);
    assert.equal(h.includes('$160.25'), !hidden, `${r}: Aki's day amount`);
    assert.ok(h.includes('配分合計') && h.includes('差額'), `${r}: summary and difference check stay`);
    assert.equal(h.includes(NOTE_JA), hidden, `${r}: note`);
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
test('tip page buttons: accounting keeps "re-fetch from Toast" but not the per-person CSV or the accounting book', () => {
  const block = between('// ペイロール期間（半月）の日次ランチ/ディナー配分内訳をCSV出力', "if (tipPeriodView==='hqsite')");
  for (const r of ROLES) {
    const c = app(r);
    run(c, "var tipPeriodView = 'matrix', storeId = 'F01', info = { from: '2026-11-01', to: '2026-11-15' }, html = '';");
    run(c, block);
    const h = c.html;
    assert.ok(h.includes('tipRefreshPeriodFromToast'), `${r}: re-fetch stays`);
    assert.equal(h.includes('exportTipPeriodCsv'), !ACCT.includes(r), `${r}: per-person L/D CSV`);
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
  test(`accounting export (${pc ? 'PC' : 'phone/tablet'}): tip list, shift leader allowance, office payroll and the book are CEO/GM only; inventory and invoices stay`, () => {
    for (const r of ['ceo', 'gm', 'office']) {
      const h = run(acctApp(r, pc), 'renderAcctExport()'), full = r !== 'office';
      for (const fn of ['exportAcctPayrollBook', 'exportTipCSV', 'exportAllTipCSV', 'exportSlPayrollCSV', 'exportAllSlPayrollCSV', 'exportOfficePayrollCSV'])
        assert.equal(h.includes(fn), full, `${r}: ${fn}`);
      assert.equal(h.includes(C), full, `${r}: an office person's pay row`);
      assert.ok(h.includes('exportAllInventoryCSV'), `${r}: inventory export stays`);
      assert.ok(h.includes('請求書（仕入）集計'), `${r}: invoice summary stays`);
      assert.equal(h.includes(NOTE_OUT_JA), !full, `${r}: note`);
    }
  });
}
test('accounting center menu: the payroll CSV entries are CEO/GM only; accounting keeps the category export', () => {
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) {
    const c = app(r);
    run(c, fnFrom('renderOfficeExport'));
    const h = run(c, 'renderOfficeExport()'), full = r === 'ceo' || r === 'gm';
    assert.equal(h.includes('給与・経理CSV'), full, `${r}: group title`);
    assert.equal(h.includes('給与CSV（店舗）'), full, `${r}: store payroll CSV`);
    assert.equal(h.includes('給与CSV（Office）'), full, `${r}: office payroll CSV`);
    assert.ok(h.includes('経理区分エクスポート') && h.includes('棚卸Excel'), `${r}: category export and inventory stay`);
  }
});
