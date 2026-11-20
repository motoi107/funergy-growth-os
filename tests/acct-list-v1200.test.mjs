// v1200（段階 3 の 2 歩目・UI案97 の 3A・4A・Moto さん 11/19）：経理センター › 経理レビュー › 確認する（1 つの一覧）。
// GM が承認した申請・承認の要らない書類・前の画面の記録を 1 つの一覧に（読むだけで並べる）。本物の関数を index.html から切り出して VM で動かす。合成データだけ。
// 申請の読み込み（wrAcctFeed）は tests/wr-approve-v1165-app.test.mjs で本物の関数・SQL とつないで確かめる。
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


const FNS = ['acrOnPage', 'acrDocSt', 'acrRows', 'acrSet', 'acrMore', 'acrRefresh', 'acrOpen', 'acrBody', 'acSubsOf', 'acResolve', 'acOpenSub', 'acSetCat', 'acSetSub',
  'renderAcctCenter', '_acStatus', '_acDate', '_acStoreName', 'arOnPage', 'arReviewList', 'invIsIntake'];

function app(opt = {}) {
  const c = { console, RENDERS: [], OPENED: [], PULLS: 0 };
  vm.createContext(c);
  vm.runInContext(`var window = globalThis; window.innerWidth = ${opt.width || 1280};` + FNS.map(fnSrc).join('\n') + '\n' + ['AC_TABS', 'ACR_PAGE', '_acr', 'ACR_OLD', 'AC_ST'].map(varSrc).join('\n') + `
    var curPage = 'acct_center', curRole = ${JSON.stringify(opt.role || 'office')}, curLang = ${JSON.stringify(opt.lang || 'ja')};
    var _acCat = 'dash', _acSub = 'dash', _acF = {};
    var STORES = [{ id:'F01', name:'Store One' }, { id:'F02', name:'Store Two' }];
    function t(ja, en){ return curLang === 'en' && en !== undefined ? en : ja; }
    function escapeHtml(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function renderPage(p){ RENDERS.push(p); }
    function go(p){ RENDERS.push('go:' + p); curPage = p; }
    function setTimeout(f){ f(); return 0; }
    function arPullLatest(){ PULLS++; }
    var DATA = ${JSON.stringify(opt.data || {})};
    function ls(k, d){ return DATA[k] !== undefined ? JSON.parse(JSON.stringify(DATA[k])) : d; }
    function getChecks(){ return ls('checks', []).filter(function(x){ return x && !x._deleted; }); }
    function getMileageRequests(){ return ls('mileage_requests', []).filter(function(x){ return x && !x._deleted; }); }
    function getExpenseRequests(){ return ls('expense_requests', []).filter(function(x){ return x && !x._deleted; }); }
    function getReimbursements(){ return ls('reimbursements', []); }
    function getLostReceipts(){ return ls('lost_receipts', []).filter(function(x){ return x && !x._deleted; }); }
    var FEED = ${JSON.stringify(opt.feed === undefined ? { state: 'ok', rows: [] } : opt.feed)};
    ${opt.noFeed ? '' : 'function wrAcctFeed(){ return JSON.parse(JSON.stringify(FEED)); }'}
    var FRESH = ${JSON.stringify(opt.fresh || '<div class="DOCFRESH">最終取得 10:00</div>')}; function arFreshHtml(){ return FRESH; }
    var REFRESHED = 0;
    function wrOpen(id){ OPENED.push('wr:' + id); } function arOpenBox(id){ OPENED.push('box:' + id); } function openCheckReview(id){ OPENED.push('check:' + id); }
    function wrAcctRefresh(){ REFRESHED++; }
    function _acPend(){ return [{ sub:'gas', n:1 }]; } function _acPendHtml(){ return '<div class="PENDCHIPS"></div>'; }
    function invInPendingReview(){ return 0; }
    ['renderInvoice','renderReimburseCard','renderLostReceipt','renderMileage','renderVacation','renderExpense','renderPurchaseDetail','renderAcctReview','renderApproval']
      .forEach(function(n){ window[n] = function(){ return '<div class="BODY-' + n + '"></div>'; }; });
    function acUploadList(k){ return '<div class="LIST-' + k + '"></div>'; }`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const REQ = (id, o = {}) => Object.assign({ id, code: 'RB-' + id, kind: 'reimburse', kindL: '建て替え経費', status: 'approved', st: 'ck', amount: 10, who: 'Lee Two', store: 'F01', storeL: 'Store One', useH: '消耗品（Costco）', gmBy: 'Gabe GM', gmAt: '2026-11-18T20:00:00Z', at: '2026-11-18T20:00:00Z' }, o);
const INV = (id, o = {}) => Object.assign({ id, storeId: 'F01', docType: 'Invoice', vendor: 'Vendor ' + id, total: 100, reviewStatus: '未確認', date: '2026/11/10' }, o);
const BASE = {
  feed: { state: 'ok', viewOnly: false, rows: [REQ('a', { amount: 42.5 }), REQ('b', { status: 'checked', st: 'pay', amount: 18 }), REQ('c', { kind: 'leave', kindL: '休暇', status: 'acct', amount: null, store: 'F02', storeL: 'Store Two' })] },
  data: {
    invoices: [INV('i1'), INV('i2', { reviewStatus: '確認中', total: 50 }), INV('i3', { reviewStatus: '差し戻し' }), INV('i4', { reviewStatus: '確認済み' }),
      INV('r1', { docType: 'Receipt', empName: 'Ren Sato', total: 63.18, storeId: 'F02' }), INV('drv', { src: 'drive-intake', reviewStatus: 'Drive取込', total: 999 }),
      INV('del', { _deleted: true }), INV('oldrb', { docType: 'Reimburse', empName: 'Old Payer', total: 7 })],
    checks: [{ id: 'k1', checkNo: '1043', payee: 'Landlord', amount: 500, storeId: 'F02', checkDate: '2026-11-12' }, { id: 'k2', checkNo: '1044', payee: 'X', amount: 5, reviewStatus: '確認済み' }],
    mileage_requests: [{ id: 'g1', employee: 'Kai Ito', storeId: 'F01', amount: 29.4, status: '申請中', date: '2026-10-01', origin: 'A', destination: 'B' }],
    expense_requests: [{ id: 'x1', employee: 'Yui Abe', storeId: 'F01', total: 350, status: '承認', date: '2026-10-02', project: 'Party' }],
    my_vacations: [{ id: 'v1', employee: 'Noa Kato', storeId: 'F02', type: '有給', startDate: '2026-11-24', endDate: '2026-11-26', status: '申請中' }, { id: 'v2', _deleted: true, status: '申請中' }],
    reimbursements: [{ id: 'rb1', payer: 'Taro', storeId: 'F01', amount: 42.5, vendor: 'Shop', date: '2026-10-12', status: '申請中' }],
    lost_receipts: [{ id: 'l1', status: '申請中' }, { id: 'l2', status: '承認' }],
  },
};
const open = (opt = {}) => { const c = app(Object.assign({}, BASE, opt)); run(c, "acSetCat('review')"); return c; };
const rowKeys = html => [...html.matchAll(/class="acr-row" data-k="([^"]+)"/g)].map(m => m[1]);

test('3A: 経理レビュー opens on 確認する with 確認待ち: GM-approved requests waiting for the check and documents not yet checked; the chips count each state', () => {
  const c = open();
  assert.deepEqual([run(c, '_acCat'), run(c, '_acSub'), run(c, '_acr.st')], ['review', 'all', 'ck']);
  const subs = plain(run(c, "acSubsOf(AC_TABS.find(function(x){ return x.id==='review'; })).map(function(s){ return s.id; })"));
  assert.equal(subs[0], 'all'); assert.ok(subs.includes('acctrev') && subs.includes('invoice'), 'the kind tabs are still there');
  const h = run(c, 'renderAcctCenter()');
  assert.match(h, /acSetSub\('all'\)">確認する/);
  assert.deepEqual(rowKeys(h).sort(), ['c:k1', 'd:i1', 'd:i2', 'd:r1', 'r:a', 'r:c'].sort());
  assert.match(h, /確認待ち <span[^>]*>6<\/span>/); assert.match(h, /精算待ち <span[^>]*>1<\/span>/); assert.match(h, /差し戻し <span[^>]*>1<\/span>/); assert.match(h, /すべて <span[^>]*>10<\/span>/);
  assert.match(h, /6 件<\/span><span[^>]*>\$755\.68</, 'count and total (a leave request has no amount)');
  assert.ok(!/drv|Vendor del/.test(h), 'no Invoice取込 mirror (Q8), no deleted');
  assert.ok(!/PENDCHIPS/.test(h), 'the list is the pending view (no chips above it)');
  assert.equal(c.PULLS, 1, 'documents are read again when it opens (v1095 rule)');
  run(c, "acSetSub('gas')"); assert.match(run(c, 'renderAcctCenter()'), /PENDCHIPS/, 'the other review tabs keep the chips');
});

test('the other states: 精算待ち (checked requests), 差し戻し, すべて; kind and store filters; the GM column', () => {
  const c = open();
  run(c, "acrSet('st','pay')"); let h = run(c, 'acrBody()'); assert.deepEqual(rowKeys(h), ['r:b']);
  run(c, "acrSet('st','ret')"); h = run(c, 'acrBody()'); assert.deepEqual(rowKeys(h), ['d:i3']);
  run(c, "acrSet('st','all')"); h = run(c, 'acrBody()'); assert.equal(rowKeys(h).length, 10);
  run(c, "acrSet('kind','req:reimburse')"); h = run(c, 'acrBody()'); assert.deepEqual(rowKeys(h).sort(), ['r:a', 'r:b']);
  assert.match(h, /<span class="tag tag-green">済み 11\/18<\/span>/);
  run(c, "acrSet('kind',''); acrSet('store','F02'); acrSet('st','ck')"); h = run(c, 'acrBody()');
  assert.deepEqual(rowKeys(h).sort(), ['c:k1', 'd:r1', 'r:c']);
  assert.match(h, /<span class="tag tag-gray">不要<\/span>/, 'documents need no GM approval');
  assert.match(h, /<option value="req:reimburse">建て替え経費（申請）<\/option>/);
});

test('4A: earlier-screen records are hidden at first (counted below); ticked, they show marked and read only; pressing one opens its earlier list', () => {
  const c = open();
  let h = run(c, 'acrBody()');
  assert.ok(!/data-k="o:/.test(h));
  assert.match(h, /前の画面の記録 5 件は出していません/);
  run(c, "acrSet('old', true); acrSet('st','all')"); h = run(c, 'acrBody()');
  const old = rowKeys(h).filter(k => k.startsWith('o:')).sort();
  assert.deepEqual(old, ['o:old_exp:x1', 'o:old_gas:g1', 'o:old_rb:rb1', 'o:old_vac:v1', 'o:rbi:oldrb']);
  assert.equal((h.match(/前の画面の記録・読むだけ/g) || []).length, 5);
  assert.match(h, /2026-11-24 – 2026-11-26/, 'time off shows the days');
  assert.match(h, /<option value="old_gas">ガソリン代（前の画面）<\/option>/);
  run(c, "acrOpen('o:old_gas:g1')"); assert.deepEqual([run(c, '_acCat'), run(c, '_acSub')], ['review', 'gas']);
  assert.equal(c.OPENED.length, 0, 'no action screen for earlier records');
});

test('pressing a row opens the same one-item screen as before: request → wrOpen, document → the review box, check → the check review', () => {
  const c = open();
  run(c, 'acrBody()');
  run(c, "acrOpen('r:a')"); run(c, "acrOpen('d:i1')"); run(c, "acrOpen('c:k1')"); run(c, "acrOpen('nope')");
  assert.deepEqual(plain(c.OPENED), ['wr:a', 'box:i1', 'check:k1']);
});

test('requests that cannot be read: the documents still show, with a note (loading, sign-in, error with 最新); not live → the earlier screens are the requests', () => {
  for (const [state, re] of [['loading', /読み込んでいます/], ['signin', /サインインすると出ます/], ['err', /申請を読めませんでした：boom[^]*acrRefresh\(\)/]]) {
    const c = open({ feed: { state, msg: state === 'err' ? 'boom' : '', rows: [] } });
    const h = run(c, 'acrBody()');
    assert.match(h, re, state); assert.ok(rowKeys(h).includes('d:i1'), state);
  }
  const nl = open({ feed: { state: 'not_live', msg: 'x', rows: [] } });
  const h = run(nl, 'acrBody()');
  assert.match(h, /前の画面の記録を今の申請として出しています/);
  assert.ok(rowKeys(h).includes('o:old_gas:g1')); assert.match(h, /type="checkbox" checked disabled/);
  const nf = open({ noFeed: true }); assert.match(run(nf, 'acrBody()'), /申請の画面を読み込めませんでした/);
  const gm = open({ role: 'gm', feed: { state: 'ok', viewOnly: true, rows: [] } }); assert.match(run(gm, 'acrBody()'), /申請は見るだけ/);
});

test('lost receipts stay on today’s list until 8B: the count and a way there', () => {
  const c = open();
  const h = run(c, 'acrBody()');
  assert.match(h, /紛失届（今の一覧）：承認待ち <b>1<\/b>/);
  run(c, "acOpenSub('lost')"); assert.equal(run(c, '_acSub'), 'lost');
});

test('100 at a time with “show more”; names are escaped; phone shows one-line cards; English', () => {
  const many = []; for (let i = 0; i < 230; i++) many.push(INV('m' + i, { vendor: i === 7 ? '<img src=x onerror=alert(1)>' : 'V' + i, date: '2026/11/' + String(1 + (i % 28)).padStart(2, '0') }));
  const c = open({ data: Object.assign({}, BASE.data, { invoices: many }) });
  let h = run(c, 'acrBody()');
  assert.equal(rowKeys(h).length, 100); assert.match(h, /さらに 100 件を出す（全 233 件）/);
  run(c, 'acrMore()'); run(c, 'acrMore()'); h = run(c, 'acrBody()');
  assert.equal(rowKeys(h).length, 233); assert.ok(!/acr-more/.test(h));
  assert.ok(!h.includes('<img src=x'), 'escaped'); assert.match(h, /&lt;img src=x/);
  run(c, "acrSet('store','F01')"); assert.equal(run(c, '_acr.limit'), 100, 'a new filter starts at the first 100');
  const sp = open({ width: 390 }); h = run(sp, 'acrBody()');
  assert.match(h, /<button type="button" class="acr-row" data-k="r:a"/); assert.ok(!/<table/.test(h));
  const en = open({ lang: 'en' }); h = run(en, 'renderAcctCenter()');
  assert.match(h, />To check<\/button>|acSetSub\('all'\)">To check/); assert.match(h, /To check <span/); assert.match(h, /Show earlier-screen records/);
});

test('the review body counts this list as its page (confirm / return redraws here); the old 経理レビュー page opens this list', () => {
  const c = open();
  assert.equal(run(c, 'arOnPage()'), true);
  run(c, "_acSub='purchase'"); assert.equal(run(c, 'arOnPage()'), false);
  assert.match(SRC, /curPage === 'acct_center' && _acCat === 'review'\)\) \{ _acCat = 'review'; _acSub = 'all'; \}/, 'from outside: the one list (inside the review: the open tab stays; tests/unified-ui-v1191.test.mjs)');
  assert.equal(run(c, 'acrOnPage()'), false); run(c, "_acSub='all'"); assert.equal(run(c, 'acrOnPage()'), true);
  run(c, "curPage='tasks'"); assert.equal(run(c, 'acrOnPage()'), false);
});

test('Codex #205: a [最新] button reads both the GM-approved requests and the documents again; it says when the requests were read or that they are being read again; the document warnings show here too', () => {
  const c = open({ feed: Object.assign({}, BASE.feed, { at: Date.UTC(2026, 10, 19, 20, 5), busy: false }) });
  let h = run(c, 'acrBody()');
  assert.match(h, /onclick="acrRefresh\(\)"><i class="ti ti-refresh"><\/i> 最新/);
  assert.match(h, /申請の最終取得 \d\d:\d\d/);
  assert.match(h, /<div class="acr-docfresh"><div class="DOCFRESH">/, 'the document freshness line of the review (arFreshHtml)');
  const p0 = c.PULLS, r0 = c.RENDERS.length;
  run(c, 'acrRefresh()');
  assert.equal(run(c, 'REFRESHED'), 1, 'requests read again (wrAcctRefresh)'); assert.ok(c.PULLS > p0, 'documents read again (arPullLatest(true))'); assert.equal(c.RENDERS.at(-1), 'acct_center'); assert.ok(c.RENDERS.length > r0);
  const busy = open({ feed: Object.assign({}, BASE.feed, { busy: true }) });
  assert.match(run(busy, 'acrBody()'), /申請を読み直しています…/);
  const warn = open({ fresh: '<div class="alert alert-warning">クラウドから読み直せませんでした。この端末の写し（09:00 に取得）を出しています<button onclick="arPullLatest(true)">取り直す</button></div>' });
  h = run(warn, 'acrBody()');
  assert.match(h, /クラウドから読み直せませんでした。この端末の写し（09:00 に取得）を出しています/, 'a failed document read is said'); assert.ok(rowKeys(h).includes('d:i1'), 'the device copy is still listed');
});
