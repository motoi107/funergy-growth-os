// App v1095 (Moto 2026-10-19, UI案57 ③, answers 「7はい 8出さない 9はい」): one accounting review body for both entry points.
// The independent 「経理レビュー」 page and 経理センター › 経理レビュー › 「区分・承認」 show the same body (same counts, totals, states, buttons);
// the review category opens on 「区分・承認」 (tabs unchanged); a button keeps you in the entry you are in; the month is the document date
// (Q7 A); Invoice取込 (Drive) mirrors are not shown or counted (Q8); the 建て替え tab reads the current store (Q9 A); 確認済み（Drive整理） and
// 削除 run once even when pressed twice; a failed read is not shown as the latest.
// Runs the real functions from index.html in a VM with synthetic data. No network, no storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OLD = process.env.FUNERGY_OLD_INDEX || null;

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
    if (ch === '/' && /[(,=:[!&|?{};+]/.test(prevSig(i))) { i = skipRegex(i); continue; }   // a regex literal such as /\//g
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
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  return SRC.slice(m.index, block(m.index));
}
function varSrc(name) {   // `var NAME = <expr>;` (arrays / objects over several lines)
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
const plain = v => JSON.parse(JSON.stringify(v));

const FNS = ['renderAcctReview', 'arStatusColor', 'arStatusRank', 'arYm', 'arDocYm', 'arReviewList', 'arOnPage', 'arRerender', 'arSetFilter',
  '_arFetchInvoices', 'arPullLatest', 'arFreshHtml', 'arSetStatus', 'arApprove', '_arApproveCore', 'arRejectModal', 'arRejectConfirm', 'deleteInvoiceDo', '_deleteInvoiceCore',
  'canDeleteInvoice', 'invIsIntake', 'invInGuardOld', 'invIsMine', 'renderReviewThread', 'addReviewThread', '_invDate', 'parseJaDate', 'invTouch',
  'acSetCat', 'acSetSub', '_acPend', '_acPendHtml', '_acRows', '_acDate', '_acYm', '_acStoreName', 'acUploadList', '_acStatus', '_acStCol', '_acStRank',
  'renderAcctCenter', 'pageSync', 'pageSyncScope', '_syncMeta', 'getReimbursements', 'pendingAcctReviewCount', 'acFilterSet'];
const VARS = ['AR_STATUSES', 'AC_TABS', 'AC_ST', '_acF', '_acCat', '_acSub', '_arBusy', '_arPull', 'SYNC_SCOPE_META', 'PAGE_SYNC_SCOPE'];

function app(opt = {}) {
  const c = {
    console, AbortController, STORE: {}, TOASTS: [], RENDERS: [], DRIVE: [], FETCHES: [], TIMERS: [], SYNCED: [], NOTIFS: [], MODALS: [],
    fetchImpl: null, driveImpl: null, renderBody: false,
  };
  vm.createContext(c);
  vm.runInContext(`var window = globalThis;` + FNS.map(fnSrc).join('\n') + '\n' + VARS.map(varSrc).join('\n') + `
    var curPage = ${JSON.stringify(opt.page || 'acct_review')}, curRole = ${JSON.stringify(opt.role || 'office')}, curUserName = 'Akane', curLang = 'ja', curStore = 'ALL';
    var ROLE_CONFIG = { office: { name: '経理' }, gm: { name: 'GM' }, am: { name: 'AM' } };
    var STORES = [{ id: 'F01', name: 'Store One', color: '#111', active: true }, { id: 'F02', name: 'Store Two', color: '#222', active: true }];
    function activeStores(){ return STORES; }
    var SUPA_SYNC_ENABLED = ${opt.syncOff ? 'false' : 'true'};
    var SUPABASE_URL = 'https://example.invalid';
    function supaHeaders(){ return {}; }
    function t(ja){ return ja; }
    function escapeHtml(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function showToast(m, k){ TOASTS.push([m, k]); }
    function renderPage(p){ RENDERS.push(p); if (renderBody) { try { if (p === 'acct_center') LAST = renderAcctCenter(); else if (p === 'acct_review') LAST = renderAcctReview(); } catch (e) { LAST = 'ERR ' + e.message; } } }
    var LAST = '';
    function nowJP(){ return '2026/10/19 10:00'; } function curYm(){ return '2026-10'; }
    function addNotif(n){ NOTIFS.push(n); } function openModal(h){ MODALS.push(h); } function closeModalDirect(){}
    var DOCVAL = {}; function docVal(id){ return DOCVAL[id]; }
    var document = { querySelector: function(){ return null; }, getElementById: function(){ return null; } };
    function setTimeout(fn, ms){ if (ms === 0 || ms >= 15000) { TIMERS.push([fn, ms]); return TIMERS.length; } Promise.resolve().then(fn); return 0; }
    function clearTimeout(){}
    function driveSync(op, p){ DRIVE.push([op, p]); return driveImpl ? driveImpl(op, p) : Promise.resolve({ ok: true, webViewLink: 'https://drive.example/f' }); }
    function fetch(u, o){ FETCHES.push(u); return fetchImpl ? fetchImpl(u, o) : Promise.resolve({ ok: true, json: function(){ return Promise.resolve([]); } }); }
    function getEmployees(){ return []; }
    function getChecks(){ return []; } function getLostReceipts(){ return []; } function getMileageRequests(){ return []; }
    function invInPendingReview(){ return 0; }
    function flushOutbox(){ return Promise.resolve(); } function outboxCount(){ return 0; } function markSynced(s){ SYNCED.push(s); }
    function mergeInvoices(cloud, local){ var by = {}, order = []; function put(x){ if (!x || x.id == null) return; if (!by[x.id]) order.push(x.id); if (!by[x.id] || (Number(x._mut)||0) >= (Number(by[x.id]._mut)||0)) by[x.id] = x; }
      (cloud||[]).forEach(put); (local||[]).forEach(put); return order.map(function(id){ return by[id]; }); }
    function _lsRaw(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function _lsWriteVerified(k, json){ STORE[k] = JSON.parse(json); return true; }
    function ls(k, d){
      if (k === 'invoices') { var out = []; Object.keys(STORE).sort().forEach(function(x){ if (x.indexOf('spl_invoices_') === 0) out = out.concat(STORE[x]); }); return JSON.parse(JSON.stringify(out)).filter(function(v){ return v && !v._deleted; }); }
      return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d;
    }
    function lsSet(k, v){
      if (k === 'invoices') { var by = {}; (v||[]).forEach(function(x){ var s = x.storeId || '_'; (by[s] = by[s] || []).push(x); });
        Object.keys(by).forEach(function(s){ var key = 'spl_invoices_' + s, old = STORE[key] || []; var keep = old.filter(function(o){ return o._deleted && !by[s].some(function(n){ return n.id === o.id; }); }); STORE[key] = JSON.parse(JSON.stringify(by[s].concat(keep))); });
        return true; }
      STORE[k] = JSON.parse(JSON.stringify(v)); return true;
    }
    function viewInvoiceImage(){} function openInvoiceViewer(){} function openCheckReview(){}
    function renderInvoice(){ return ''; } function renderReimburseCard(){ return ''; } function renderLostReceipt(){ return ''; } function renderMileage(){ return ''; }`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const INV = o => Object.assign({ storeId: 'F01', docType: 'Invoice', vendor: 'Vendor', total: 100, reviewStatus: '未確認', lines: [{}, {}], _mut: 1 }, o);
function seed(c, list) { for (const v of list) { const k = 'spl_invoices_' + v.storeId; (c.STORE[k] = c.STORE[k] || []).push(v); } }
const tick = () => new Promise(r => setImmediate(r));
function gate() { let open; const p = new Promise(r => { open = r; }); return { p, open }; }
function bodyOf(html) { const i = html.indexOf('<div class="section-header"><div><div class="section-title">経理レビュー'); return i < 0 ? '' : html.slice(i); }

test('the review category opens on 区分・承認; the body there is the same as the independent page (same counts, total, buttons); the tabs are unchanged', () => {
  const a = app({ page: 'acct_center' }), b = app({ page: 'acct_review' });
  const data = [INV({ id: 'i1', total: 120.5, date: '2026/10/18', docDate: '2026/10/17' }), INV({ id: 'i2', storeId: 'F02', total: 64.2, reviewStatus: '差し戻し', reviewNote: 'blurry', date: '2026/10/15' }),
    INV({ id: 'i3', total: 10, reviewStatus: '確認済み', date: '2026/10/01', docType: 'Receipt' })];
  seed(a, plain(data)); seed(b, plain(data));
  run(a, "acSetCat('review')");
  assert.equal(run(a, '_acSub'), 'acctrev');
  const center = run(a, 'renderAcctCenter()'), page = run(b, 'renderAcctReview()');
  assert.ok(bodyOf(center).length > 100);
  assert.equal(bodyOf(center), bodyOf(page), 'same body in both entries');
  assert.match(page, /3 件 ・ 合計 \$194\.70/);
  const subs = plain(run(a, "AC_TABS.find(function(x){ return x.id==='review'; }).subs.map(function(s){ return s.id + ':' + s.label; })"));
  assert.deepEqual(subs, ['invoice:Invoice', 'receipt:レシート', 'reimb:建て替え', 'check:チェック', 'lost:紛失届', 'gas:ガソリン代', 'vac:休暇申請', 'exp:事前経費',
    'purchase:仕入明細', 'vendor:業者マスター', 'acctrev:区分・承認', 'err:エラーセンター', 'appr:報告・承認']);
  run(a, "acSetCat('drive')"); assert.equal(run(a, '_acSub'), 'dlist', 'other categories open on their first tab as before');
  // the pending chip for unconfirmed invoices opens the review body
  run(a, "acSetCat('review')");
  assert.match(run(a, '_acPendHtml()'), /acSetSub\('acctrev'\)[^]*未確認のInvoice/);
});

test('a button keeps you in the entry you are in (the accounting center does not jump to the other page)', () => {
  const a = app({ page: 'acct_center' });
  seed(a, [INV({ id: 'i1', date: '2026/10/18' })]);
  run(a, "acSetCat('review')"); a.RENDERS.length = 0;
  run(a, "arSetStatus('i1', '確認中')");
  assert.deepEqual(a.RENDERS, ['acct_center']);
  run(a, "arSetFilter('Status', '確認中')");
  assert.deepEqual(a.RENDERS, ['acct_center', 'acct_center']);
  run(a, "DOCVAL['ar-reason'] = 'please retake'");
  return run(a, "arRejectConfirm('i1')").then(() => {
    assert.equal(a.RENDERS[a.RENDERS.length - 1], 'acct_center');
    assert.equal(plain(run(a, "ls('invoices',[])"))[0].reviewStatus, '差し戻し');
    const b = app({ page: 'acct_review' }); seed(b, [INV({ id: 'i1' })]);
    run(b, "arSetStatus('i1', '確認中')"); assert.deepEqual(b.RENDERS, ['acct_review']);
  });
});

test('Q7 A: the month is the document date (registration date when there is none); the Drive folder month is still the registration date', async () => {
  const c = app();
  seed(c, [INV({ id: 'sep', date: '2026/10/02', docDate: '2026/09/30', driveFileId: 'f1' }), INV({ id: 'oct', date: '2026/10/03' })]);
  let html = run(c, 'renderAcctReview()');
  assert.match(html, /<option value="2026-09"/); assert.match(html, /伝票 2026\/09\/30（登録 2026\/10\/02）/);
  run(c, "window._arMonth = '2026-09'");
  html = run(c, 'renderAcctReview()');
  assert.match(html, /1 件 ・ 合計 \$100\.00<span[^>]*>（全 2 件）/);
  assert.ok(html.includes("arApprove('sep')") && !html.includes("arApprove('oct')"));
  run(c, "window._arMonth = 'ALL'");
  await run(c, "arApprove('sep')");
  assert.equal(c.DRIVE[0][1].ym, '2026-10', 'Drive folder month unchanged (registration date)');
});

test('Q8: Invoice取込 (Drive) mirrors are not shown or counted in either entry, and cannot be changed here', () => {
  const c = app({ page: 'acct_center' });
  seed(c, [INV({ id: 'drv_1', src: 'drive-intake', reviewStatus: 'Drive取込', total: 999, date: '2026/10/10' }), INV({ id: 'i1', date: '2026/10/11' })]);
  const html = run(c, 'renderAcctReview()');
  assert.ok(!html.includes('drv_1')); assert.match(html, /1 件 ・ 合計 \$100\.00/);
  const rows = plain(run(c, "_acRows('invoice').rows"));
  assert.deepEqual(rows.map(r => r.id), ['i1']);
  run(c, "_acF = { store:'', ym:'', third:'', st:'' }");
  assert.match(run(c, "acUploadList('invoice')"), /1 件[^]*\$100\.00/);
  run(c, "arSetStatus('drv_1', '確認中')");
  assert.equal(plain(run(c, "ls('invoices',[])")).find(v => v.id === 'drv_1').reviewStatus, 'Drive取込');
  assert.ok(c.TOASTS.some(([m]) => /Invoice取込/.test(m)));
});

test('Q9 A: the 建て替え tab reads the current store (reimbursements); old records in the invoices store still show', () => {
  const c = app({ page: 'acct_center' });
  c.STORE.reimbursements = [{ id: 'rb1', payer: 'Taro', storeId: 'F01', amount: 42.5, vendor: 'Shop', purpose: 'parts', date: '2026-10-12', status: '申請中', payStatus: '未払い', byUser: 'Ken' },
    { id: 'rb2', payer: 'Hana', storeId: 'F02', amount: 10, date: '2026-10-13', status: '承認', payStatus: '支払済' }, { id: 'rb3', payer: 'X', storeId: 'F02', amount: 5, date: '2026-10-13', status: '申請中', _deleted: true }];
  seed(c, [INV({ id: 'old', docType: 'Reimburse', empName: 'Old Payer', total: 7, date: '2026/08/01' })]);
  const rows = plain(run(c, "_acRows('reimb').rows"));
  assert.deepEqual(rows.map(r => [r.id, r.third, r.amount]), [['rb1', 'Taro', 42.5], ['rb2', 'Hana', 10], ['old', 'Old Payer', 7]]);
  assert.match(rows[1].sub, /支払済/); assert.match(rows[2].sub, /前の保存先/);
  run(c, "_acF = { store:'', ym:'', third:'', st:'' }");
  const html = run(c, "acUploadList('reimb')");
  assert.match(html, /Taro/); assert.match(html, /\$59\.50/);
});

test('確認済み（Drive整理）: pressing twice moves the file once; the buttons wait while it runs; what changed on the device meanwhile is kept', async () => {
  const c = app({ page: 'acct_center' });
  seed(c, [INV({ id: 'i1', driveFileId: 'f1', date: '2026/10/18' })]);
  run(c, "acSetCat('review')");
  const g = gate(); c.driveImpl = () => g.p;
  const p1 = run(c, "arApprove('i1')"); const p2 = run(c, "arApprove('i1')");
  await tick();
  assert.equal(c.DRIVE.length, 1, 'Drive moved once');
  let html = run(c, 'renderAcctReview()');
  assert.match(html, /Drive に整理しています…/); assert.ok(!html.includes("arApprove('i1')"), 'the button is not offered while it runs');
  assert.ok(c.TOASTS.some(([m]) => /終わるまで待って/.test(m)));
  // meanwhile another invoice arrives on this device (a read from the cloud)
  seed(c, [INV({ id: 'n9', storeId: 'F01', date: '2026/10/19' })]);
  g.open({ ok: true, webViewLink: 'https://drive.example/moved' });
  await p1; await p2;
  const all = plain(run(c, "ls('invoices',[])"));
  assert.deepEqual(all.map(v => v.id).sort(), ['i1', 'n9'], 'the invoice that arrived meanwhile is kept');
  const i1 = all.find(v => v.id === 'i1');
  assert.equal(i1.reviewStatus, '確認済み'); assert.equal(i1.driveMoved, true); assert.equal(i1.driveUrl, 'https://drive.example/moved');
  assert.equal(c.RENDERS[c.RENDERS.length - 1], 'acct_center');
  assert.match(run(c, 'renderAcctReview()'), /確認済みを取り消し/);
});

test('削除: pressing twice deletes once (Drive file once); an invoice that arrived meanwhile is kept; it stays in the entry you are in', async () => {
  const c = app({ page: 'acct_center' });
  seed(c, [INV({ id: 'i1', driveFileId: 'f1', date: '2026/10/18' })]);
  const g = gate(); c.driveImpl = () => g.p;
  const p1 = run(c, "deleteInvoiceDo('i1')"); const p2 = run(c, "deleteInvoiceDo('i1')");
  await tick();
  assert.equal(c.DRIVE.filter(d => d[0] === 'delete').length, 1);
  assert.match(run(c, 'renderAcctReview()'), /削除しています…/);
  seed(c, [INV({ id: 'n9', storeId: 'F01', date: '2026/10/19' })]);
  g.open({ ok: true });
  await p1; await p2;
  assert.deepEqual(plain(run(c, "ls('invoices',[])")).map(v => v.id), ['n9']);
  assert.ok(c.STORE.spl_invoices_F01.some(v => v.id === 'i1' && v._deleted), 'deleted with a mark (does not come back from a merge)');
  assert.equal(c.RENDERS[c.RENDERS.length - 1], 'acct_center');
});

test('reading the latest: a failed or hanging read is shown as this device’s copy (not as the latest) with “try again”; a good read shows the time and merges', async () => {
  const c = app();
  seed(c, [INV({ id: 'i1', date: '2026/10/18' })]);
  // an HTTP error is not read as data, even when the error page has a body shaped like rows
  c.fetchImpl = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([{ key: 'spl_invoices_F01', value: [] }]) });
  assert.equal(await run(c, 'arPullLatest(true)'), false);
  let html = run(c, 'renderAcctReview()');
  assert.match(html, /クラウドから読み直せませんでした。この端末の写しを出しています/); assert.match(html, /もう一度読む/); assert.ok(!/最終取得/.test(html));
  // opening again within a minute does not read again (no loop on failure)
  const n = c.FETCHES.length; await run(c, 'arPullLatest(false)'); assert.equal(c.FETCHES.length, n);
  // a good read
  c.fetchImpl = () => Promise.resolve({ ok: true, json: () => Promise.resolve([{ key: 'spl_invoices_F02', value: [INV({ id: 'c1', storeId: 'F02', date: '2026/10/19', total: 50 })] }]) });
  assert.equal(await run(c, 'arPullLatest(true)'), true);
  html = run(c, 'renderAcctReview()');
  assert.match(html, /最終取得 \d\d:\d\d/); assert.match(html, /最新を取得/); assert.match(html, /2 件 ・ 合計 \$150\.00/);
  // a read that never answers is stopped after 15 s and shown as not read
  c.fetchImpl = (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const p = run(c, 'arPullLatest(true)');
  await tick();
  assert.match(run(c, 'arFreshHtml()'), /読み直しています/);
  const abort = c.TIMERS.filter(([, ms]) => ms === 15000).pop(); assert.ok(abort, 'a 15 s limit'); abort[0]();
  assert.equal(await p, false);
  assert.match(run(c, 'arFreshHtml()'), /読み直せませんでした[^]*（\d\d:\d\d に取得）/);
});

test('the page 「同期」 for the review: a failed read does not say 最新に同期しました and does not mark the time; a good one does', async () => {
  const c = app();
  assert.equal(run(c, "pageSyncScope('acct_review')"), 'acctrev');
  c.fetchImpl = () => Promise.reject(new Error('offline'));
  await run(c, "pageSync('acctrev')");
  assert.ok(!c.TOASTS.some(([m]) => /最新に同期しました/.test(m)));
  assert.ok(c.TOASTS.some(([m, k]) => /読み直せませんでした/.test(m) && k === 'warning'));
  assert.deepEqual(c.SYNCED, []);
  c.fetchImpl = null;
  await run(c, "pageSync('acctrev')");
  assert.ok(c.TOASTS.some(([m]) => /最新に同期しました/.test(m))); assert.deepEqual(c.SYNCED, ['acctrev']);
  // other scopes keep their old behaviour (their pull returns nothing)
  run(c, "SYNC_SCOPE_META.food.pull = async function(){ }");
  c.TOASTS.length = 0; await run(c, "pageSync('food')");
  assert.ok(c.TOASTS.some(([m]) => /最新に同期しました/.test(m)));
  // sync off: says so
  const d = app({ syncOff: true });
  assert.equal(await run(d, 'arPullLatest(true)'), false);
  assert.match(run(d, 'arFreshHtml()'), /クラウド同期が OFF/);
});

test('opening the review reads the latest once after drawing (not while drawing), and who can see it is unchanged', async () => {
  const c = app();
  seed(c, [INV({ id: 'i1' })]);
  run(c, 'renderAcctReview()');
  assert.equal(c.FETCHES.length, 0, 'not while drawing');
  const pull = c.TIMERS.find(([, ms]) => ms === 0); assert.ok(pull);
  await pull[0](); await tick(); await tick();
  assert.equal(c.FETCHES.length, 1);
  for (const role of ['am', 'sl', 'crew']) {
    const x = app({ role }); seed(x, [INV({ id: 'i1' })]);
    assert.match(run(x, 'renderAcctReview()'), /この画面は経理（office／事務Crew）／GM／CEO専用です/);
  }
  for (const role of ['office', 'gm']) { const x = app({ role }); seed(x, [INV({ id: 'i1' })]); assert.match(run(x, 'renderAcctReview()'), /arApprove\('i1'\)/); }
});

test('review f1d567a P3-2/3/6: the Handbook 「同期」 reports a failed read; 「同期」 during an automatic read waits for its result; opening reads at most every 5 minutes', async () => {
  const c = app();
  run(c, 'var HBR = false; async function hbPullLatest(){ return HBR; }');
  await run(c, "pageSync('handbook')");
  assert.ok(!c.TOASTS.some(([m]) => /最新に同期しました/.test(m)), 'a failed Handbook read is not reported as synced');
  run(c, 'HBR = true'); c.TOASTS.length = 0;
  await run(c, "pageSync('handbook')");
  assert.ok(c.TOASTS.some(([m]) => /最新に同期しました/.test(m)));
  // an automatic read is still running when 「同期」 is pressed: the button waits for that read
  let open; const g = new Promise(r => { open = r; });
  c.fetchImpl = () => g;
  const auto = run(c, 'arPullLatest(false)');
  const press = run(c, 'arPullLatest(true)');
  open({ ok: true, json: () => Promise.resolve([]) });
  assert.equal(await press, true, 'the button reports the result of the read, not the earlier state');
  assert.equal(await auto, true);
  // opening again 2 minutes later does not read; 6 minutes later it does
  const n = c.FETCHES.length;
  run(c, '_arPull.tried = Date.now() - 120000'); await run(c, 'arPullLatest(false)'); assert.equal(c.FETCHES.length, n);
  run(c, '_arPull.tried = Date.now() - 360000'); await run(c, 'arPullLatest(false)'); assert.equal(c.FETCHES.length, n + 1);
});
