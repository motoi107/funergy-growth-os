// v1201（段階 3 の 3 歩目・UI案97・9A）：③ インボイス取り込みに「明細」（前の仕入明細）と「前の経路の書類」（② の Invoice の一覧・読むだけ）を移す。
// 移す前と後で件数と金額が同じ（同じ関数・同じ行）・二重に数えない（Drive の写しは前の経路の書類に出さない・未処理の数は 1 つの中タブだけ）ことを照合する。
// 経理センターの中の画面の描き直しは経理センターのまま（acPageInCenter）。本物の関数を index.html から切り出して VM で動かす。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function prevSig(i) { let j = i - 1; while (j >= 0 && /\s/.test(SRC[j])) j--; return j < 0 ? ';' : SRC[j]; }
function skipRegex(i) { let cls = false; for (let j = i + 1; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '\\') { j++; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) return j; else if (ch === '\n') return i; } return i; }
function block(start) {
  let i = SRC.indexOf('{', start), depth = 0, q = null, tpl = [];
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
    if (ch === '/' && /[(,=:[!&|?{};+]/.test(prevSig(i))) { i = skipRegex(i); continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unterminated');
}
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  return SRC.slice(m.index, block(m.index));
}
function varSrc(name) {
  const m = new RegExp('^var ' + name + ' *=', 'm').exec(SRC);
  if (!m) throw new Error('var not found: ' + name);
  let i = m.index + m[0].length, depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i) - 1; continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) return SRC.slice(m.index, i + 1);
  }
  throw new Error('unterminated var ' + name);
}
// botRender は 1 行の関数（中に { が多い）なので行で取る
function lineFn(name) { const m = new RegExp('^function ' + name + '\\(.*$', 'm').exec(SRC); if (!m) throw new Error('not found ' + name); return m[0]; }
const plain = v => JSON.parse(JSON.stringify(v));



const FNS = ['acSubsOf', 'acResolve', 'acOpenSub', 'acSetCat', 'acSetSub', 'renderAcctCenter', 'acPageInCenter', '_acRows', '_acDate', '_acYm', '_acStoreName', 'acUploadList',
  '_acStatus', '_acStCol', '_acStRank', '_acPend', 'invIsIntake', 'pendingAcctReviewCount', 'renderPurchaseDetail', 'pdRows', 'pdYm', '_invDate', 'parseJaDate', '_invStoreIds'];
const VARS = ['AC_TABS', 'AC_ST', 'AC_SUB_PAGES', '_pdMonthOff', '_pdStore', '_pdVendor', '_pdType', '_pdOpen'];
const now = new Date(), YM = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
const D = d => YM + '/' + String(d).padStart(2, '0');

function app(opt = {}) {
  const c = { console, RENDERS: [] };
  vm.createContext(c);
  vm.runInContext(`var window = globalThis;` + FNS.map(fnSrc).join('\n') + '\n' + VARS.map(varSrc).join('\n') + `
    var curPage = 'acct_center', curRole = ${JSON.stringify(opt.role || 'office')}, curLang = ${JSON.stringify(opt.lang || 'ja')}, curStore = 'ALL';
    var _acCat = 'dash', _acSub = 'dash', _acF = { store:'', ym:'', third:'', st:'' };
    var STORES = [{ id:'F01', name:'Store One', color:'#111' }, { id:'F02', name:'Store Two', color:'#222' }];
    function getVisibleStores(){ return STORES; }
    function t(ja, en){ return curLang === 'en' && en !== undefined ? en : ja; }
    function escapeHtml(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function renderPage(p){ RENDERS.push(p); }
    var DATA = ${JSON.stringify(opt.data || {})};
    function ls(k, d){ return DATA[k] !== undefined ? JSON.parse(JSON.stringify(DATA[k])).filter(function(v){ return v && !v._deleted; }) : d; }
    function lsSplitRO(k){ return ls(k, []); }
    function getChecks(){ return ls('checks', []); } function getLostReceipts(){ return ls('lost_receipts', []); } function getMileageRequests(){ return ls('mileage_requests', []); }
    function getReimbursements(){ return ls('reimbursements', []); }
    function invInPendingReview(){ return ${opt.dreview || 0}; }
    function vendorCanon(v){ return String(v || '').trim(); }
    function uiPcWatch1179(){}
    function u10PdHtml(rows){ return '<div class="PDROWS" data-n="' + rows.length + '">' + rows.map(function(r){ return r.v.id + ':' + r.amount.toFixed(2); }).join(',') + '</div>'; }
    function _acPendHtml(){ return ''; }
    ['invInList','invInReview','invInRecon','invInHealth','invInSettings','renderTipMgmt','renderTipShiftLeader','renderOfficeAttend','renderOfficeExport','renderAcctExport','renderVendorMaster',
     'renderVacation','renderExpense','renderAcctReview','renderApproval','renderInvoice','renderReimburseCard','renderLostReceipt','renderMileage','acrBody','acDashBody']
      .forEach(function(n){ window[n] = function(){ return '<div class="BODY-' + n + '"></div>'; }; });`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const subs = (c, id) => plain(run(c, `acSubsOf(AC_TABS.find(function(x){ return x.id===${JSON.stringify(id)}; })).map(function(s){ return s.id + ':' + s.label; })`));
const INV = (id, o = {}) => Object.assign({ id, storeId: 'F01', docType: 'Invoice', vendor: 'V-' + id, total: 100, reviewStatus: '未確認', date: D(5), imagePath: 'x.jpg' }, o);
const DATA = {
  invoices: [INV('a', { total: 120.5 }), INV('b', { storeId: 'F02', total: 80, date: D(6) }), INV('r', { docType: 'Receipt', total: 30.25, empName: 'Ren' }),
    INV('drv', { src: 'drive-intake', reviewStatus: 'Drive取込', total: 999, vendor: 'Sysco' }), INV('rb', { docType: 'Reimburse', total: 7 }),
    INV('split', { storeId: 'F01', splitStores: ['F01', 'F02'], total: 50, date: D(7) }), INV('noimg', { total: 10, imagePath: '', imageMissing: true }), INV('del', { _deleted: true, total: 5000 })],
};

test('③ インボイス取り込み now has 明細 and 前の経路の書類 (moved from ②, 9A); ② keeps the rest; the order', () => {
  const c = app({ data: DATA });
  assert.deepEqual(subs(c, 'drive'), ['dlist:一覧', 'dreview:要確認', 'drecon:照合', 'dhealth:取込状況', 'purchase:明細', 'invoice:前の経路の書類']);
  assert.deepEqual(subs(c, 'review').map(x => x.split(':')[0]), ['all', 'receipt', 'reimb', 'check', 'lost', 'gas', 'vac', 'exp', 'acctrev', 'appr']);
  const en = app({ lang: 'en' }); run(en, "acSetCat('drive'); acSetSub('invoice')");
  assert.match(run(en, 'renderAcctCenter()'), /acSetSub\('purchase'\)">Purchase lines[^]*acSetSub\('invoice'\)">Earlier-route documents/);
});

test('件数と金額の照合：明細 in ③ is the same as the purchase details page (same rows, count and total; Drive copies as before, not deleted / reimbursements)', () => {
  const c = app({ data: DATA });
  const page = run(c, 'renderPurchaseDetail()');
  run(c, "acSetCat('drive'); acSetSub('purchase')");
  const center = run(c, 'renderAcctCenter()');
  const body = s => s.slice(s.indexOf('<div class="section-header">'));
  assert.ok(body(page).length > 100); assert.equal(body(center), body(page), 'the same body (count, total, rows)');
  const rows = /data-n="(\d+)">([^<]*)</.exec(center);
  assert.equal(rows[1], '6'); assert.deepEqual(rows[2].split(',').sort(), ['a:120.50', 'b:80.00', 'drv:999.00', 'noimg:10.00', 'r:30.25', 'split:50.00']);
  assert.match(center, /<div style="font-size:20px;font-weight:800">6<\/div>[^]*\$1289\.75/);
});

test('件数と金額の照合：前の経路の書類 is the same list as ②「Invoice」was (app-registered invoices only): no Drive copy (so nothing is listed twice with ③ 一覧), no receipts / reimbursements / deleted; read only', () => {
  const c = app({ data: DATA });
  run(c, "acSetCat('drive'); acSetSub('invoice')");
  const h = run(c, 'renderAcctCenter()');
  assert.match(h, /アプリで登録した書類（前の経路）です。ここは読むだけです/);
  const listed = plain(run(c, "_acRows('invoice').rows.map(function(r){ return r.id; })")).sort();
  assert.deepEqual(listed, ['a', 'b', 'noimg', 'split']);
  assert.match(h, /4 件<\/span><span[^>]*>\$260\.50</, 'count and total');
  assert.ok(!/登録・承認の画面を開く|BODY-renderInvoice/.test(h), 'no entry / approval screen here (read only)');
  assert.ok(!h.includes('Sysco'), 'the Drive copy is not here');
});

test('badges are counted once: the old-route “no image” count moved with its tab from ② to ③ (with 要確認); the total over all tabs is the same as before', () => {
  const c = app({ data: DATA, dreview: 3 });
  run(c, "acSetCat('review')");
  const h = run(c, 'renderAcctCenter()');
  const n = id => { const m = new RegExp("acSetCat\\('" + id + "'\\)[^]*?</button>").exec(h); const k = m && /class="ac-n">(\d+)</.exec(m[0]); return k ? Number(k[1]) : 0; };
  const pend = plain(run(c, '_acPend()'));
  const want = id => pend.filter(x => plain(run(c, `acSubsOf(AC_TABS.find(function(x){ return x.id===${JSON.stringify(id)}; })).map(function(s){ return s.id; })`)).includes(x.sub)).reduce((a, x) => a + x.n, 0);
  assert.equal(n('drive'), 3 + 1, '要確認 3 + no image 1'); assert.equal(n('drive'), want('drive') + 3);
  assert.equal(n('review'), want('review'));
  const all = pend.reduce((a, x) => a + x.n, 0) + 3;
  assert.equal(['dash', 'review', 'drive', 'tip', 'attend', 'reports', 'master'].reduce((a, id) => a + n(id), 0), all, 'each pending item counted in one tab only');
});

test('screens shown inside the accounting center redraw inside it (their own page name while their tab is open); other pages and office_mgr are not touched', () => {
  const c = app();
  for (const [sub, page] of [['purchase', 'purchase_detail'], ['invoice', 'invoice'], ['export', 'acct_export'], ['vendor', 'vendor_master'], ['tip', 'tip'], ['tipsl', 'tip'],
    ['gas', 'mileage'], ['vac', 'vacation'], ['exp', 'expense'], ['lost', 'lost_receipt'], ['appr', 'approval'], ['acctrev', 'acct_review'], ['reimb', 'acct_review'], ['all', 'acct_review']]) {
    run(c, `_acSub=${JSON.stringify(sub)}`);
    assert.equal(run(c, `acPageInCenter(${JSON.stringify(page)})`), 'acct_center', sub + ' ' + page);
  }
  run(c, "_acSub='purchase'");
  assert.equal(run(c, "acPageInCenter('acct_export')"), 'acct_export', 'another tab’s page: not this tab');
  assert.equal(run(c, "acPageInCenter('office_mgr')"), 'office_mgr', 'office_mgr stays with acFromOfficeTab');
  run(c, "curPage='purchase_detail'"); assert.equal(run(c, "acPageInCenter('purchase_detail')"), 'purchase_detail', 'the page itself (go() changes curPage first)');
  // both renderPage copies ask before the old-destination rules
  assert.equal((SRC.match(/try \{ if \(typeof acPageInCenter === 'function'\) page = acPageInCenter\(page\); \} catch\(e\)\{\}[^\n]*\n  try \{ var _np = navResolvePage\(page\);/g) || []).length, 2);
  for (const f of ['pdNavMonth', 'pdSetStore', 'pdSetType', 'pdSetVendor']) assert.match(fnSrc(f), /renderPage\('purchase_detail'\)/, f);
});
