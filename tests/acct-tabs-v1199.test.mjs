// v1199（段階 3 の 1 歩目・UI案97・Moto さん 11/19 の答え「1 打刻はホームに残す／2 Tip＆シフトリーダーは独立して残す／3 A／4 A／5 本部タイムカードのみ残す／6 A」）：
// 経理センターの中タブの並べ替えと入口の付け替え（中身はそのまま）。本物の関数を index.html から切り出して VM で動かす。合成データだけ。
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

const FNS = ['acSubsOf', 'acResolve', 'acOpenSub', 'acFromOfficeTab', 'acWorkLinksHtml', 'acGoWork', 'acSetCat', 'acSetSub', 'renderAcctCenter',
  'invInOnPage', 'renderOfficeMgr', 'renderOfficeDash'];

function app(opt = {}) {
  const c = { console, RENDERS: [], WENT: [], CALLED: [] };
  vm.createContext(c);
  vm.runInContext(`var window = globalThis;` + FNS.map(fnSrc).join('\n') + '\n' + lineFn('botRender') + '\n' + varSrc('AC_TABS') + `
    var curPage = ${JSON.stringify(opt.page || 'acct_center')}, curRole = ${JSON.stringify(opt.role || 'office')}, curLang = 'ja';
    var _acCat = 'dash', _acSub = 'dash', _acF = {}, officeMgrTab = 'dash', workTab = 'today';
    function t(ja, en){ return ${opt.lang === 'en' ? "en === undefined ? ja : en" : 'ja'}; }
    function escapeHtml(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function renderPage(p){ RENDERS.push(p); }
    function go(p){ WENT.push(p); curPage = p; }
    var PEND = ${JSON.stringify(opt.pend || [])};
    function _acPend(){ return PEND; } function _acPendHtml(){ return '<div class="PENDLIST"></div>'; }
    function invInPendingReview(){ return ${opt.drivePend || 0}; }
    function acUploadList(k){ CALLED.push('list:' + k); return '<div class="LIST-' + k + '"></div>'; }
    function hqStaffMembers(){ return []; }
    var ISSUES = ${JSON.stringify(opt.issues || [])};
    function ecOpenIssues(){ return ISSUES; }
    function botCanView(){ return ${opt.bot === false ? 'false' : 'true'}; }
    function navGuardAllows(p){ return ${JSON.stringify(opt.deny || [])}.indexOf(p) < 0; }
    function _secRerender(){ RENDERS.push('secure'); }
    function officeClockCard(){ return '<div class="CLOCK"></div>'; } function officeTodayBoard(){ return ''; } function officeLaunch(){ return ''; }
    function renderOfficeCloseCard(){ return ''; } function renderOfficeObStatus(){ return ''; } function officeOnDutyCount(){ return 0; } function officePendingApprovals(){ return 0; }
    function setOfficeMgrTab(x){ officeMgrTab = x; renderPage('office_mgr'); }
    function renderOfficeReport(){ return ''; } function renderOfficeMember(){ return ''; } function renderErrorCenter(){ return '<div class="ERRC"></div>'; }
    function acDashBody(){ return renderOfficeMgr(true); }
    ['renderTipMgmt','renderTipShiftLeader','renderOfficeAttend','renderOfficeExport','renderAcctExport','renderVendorMaster','invInSettings','invInList','invInReview',
     'invInRecon','invInHealth','renderVacation','renderExpense','renderPurchaseDetail','renderAcctReview','renderApproval','renderInvoice','renderReimburseCard',
     'renderLostReceipt','renderMileage'].forEach(function(n){ window[n] = function(){ CALLED.push(n); return '<div class="BODY-' + n + '"></div>'; }; });`, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const cats = c => plain(run(c, 'AC_TABS.map(function(x){ return x.id + ":" + x.label; })'));
const subsOf = (c, id) => plain(run(c, `acSubsOf(AC_TABS.find(function(x){ return x.id===${JSON.stringify(id)}; })).map(function(s){ return s.id; })`));
const state = c => [run(c, '_acCat'), run(c, '_acSub')];

test('the 7 middle tabs in Moto’s order: home (clock stays), review, intake, Tip & shift leaders (own tab), HQ time card (kept), records, masters', () => {
  const c = app();
  assert.deepEqual(cats(c), ['dash:経理ホーム', 'review:経理レビュー', 'drive:インボイス取り込み', 'tip:Tip＆シフトリーダー', 'attend:本部タイムカード', 'reports:履歴・帳票', 'master:マスター・設定']);
  assert.deepEqual(subsOf(c, 'review'), ['all', 'receipt', 'reimb', 'check', 'lost', 'gas', 'vac', 'exp', 'acctrev', 'appr']);   // v1200：確認する（1 つの一覧）が先頭・v1201：Invoice・仕入明細は ③ へ
  assert.deepEqual(subsOf(c, 'drive'), ['dlist', 'dreview', 'drecon', 'dhealth', 'purchase', 'invoice']);   // v1201（9A）
  assert.deepEqual(subsOf(c, 'tip'), ['tip', 'tipsl']);
  assert.deepEqual(subsOf(c, 'attend'), ['attend']);
  assert.deepEqual(subsOf(c, 'reports'), ['ohub', 'export']);
  assert.deepEqual(subsOf(c, 'master'), ['vendor', 'dsettings']);
  assert.deepEqual(plain(run(c, 'AC_TABS.map(function(x){ return !!x.labelEn; })')), [true, true, true, true, true, true, true], 'English names for every tab');
});

test('nothing is lost: every screen of v1198 is still here, or moved out to a screen that has it (Work Center, People)', () => {
  const c = app();
  const now = new Set(plain(run(c, 'AC_TABS.reduce(function(a, x){ return a.concat(x.subs.map(function(s){ return s.fn || s.list; })); }, [])')));
  const v1198 = ['acDashBody', 'renderBotCenter', 'invInList', 'invInReview', 'invInRecon', 'invInHealth', 'invInSettings', 'invoice', 'receipt', 'reimb', 'check', 'lost', 'gas',
    'renderVacation', 'renderExpense', 'renderPurchaseDetail', 'renderVendorMaster', 'renderAcctReview', 'acErrBody', 'renderApproval', 'renderTipMgmt', 'renderTipShiftLeader',
    'renderAcctExport', 'renderOfficeAttend', 'renderHR', 'renderGrowthHub', 'renderHiring'];
  const movedOut = ['renderBotCenter', 'acErrBody', 'renderHR', 'renderGrowthHub', 'renderHiring'];
  for (const k of v1198) if (!movedOut.includes(k)) assert.ok(now.has(k), 'still in the accounting center: ' + k);
  for (const k of movedOut) assert.ok(!now.has(k), 'moved out: ' + k);
  assert.ok(now.has('renderOfficeExport'), 'the export hub is the first tab of 履歴・帳票');
  // where the moved ones live (the same screens)
  const wc = fnSrc('renderWorkCenter');
  assert.match(wc, /workTab==='bot' && botCanView\(\)\) return bar \+ renderBotCenter\(\)/);
  assert.match(wc, /workTab==='error'\)\s+return bar \+ renderErrorCenter\(true\)/);
  assert.match(SRC, /case 'hr':\s+el\.innerHTML = renderHR\(\); break;/);
  const ag = SRC.slice(SRC.indexOf('const ACCT_GROUPS = ['), SRC.indexOf('];', SRC.indexOf('const ACCT_GROUPS = [')));
  assert.ok(ag.length > 100);
  for (const p of ['tasks', 'hr', 'growthhub', 'hiring']) assert.match(ag, new RegExp("'" + p + "'"), 'office roles can open ' + p);
  // every function a tab calls exists
  for (const k of now) if (!/^(invoice|receipt|reimb|check|lost|gas)$/.test(k)) assert.match(SRC, new RegExp('^(async )?function ' + k + '\\(', 'm'), k);
  // the pending badges still point at review tabs (v886 rule)
  for (const s of ['check', 'lost', 'gas', 'exp', 'vac']) assert.ok(subsOf(c, 'review').includes(s), s);
  assert.ok(subsOf(c, 'drive').includes('invoice'), 'v1201: the no-image chip (invoice) points at ③ 前の経路の書類');
});

test('old pairs open the new place: Invoice settings → マスター・設定; removed tabs → the first tab; bad tab → home', () => {
  const c = app();
  run(c, "_acCat='drive'; _acSub='dsettings'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['master', 'dsettings']);
  run(c, "_acCat='review'; _acSub='vendor'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['master', 'vendor']);
  run(c, "_acCat='review'; _acSub='err'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['review', 'all']);
  run(c, "_acCat='bot'; _acSub='bot'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['dash', 'dash']);
  run(c, "_acCat='hr'; _acSub='growth'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['dash', 'dash']);
  run(c, "_acCat='export'; _acSub='export'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['reports', 'export'], 'old 出力センター');
  run(c, "_acCat='review'; _acSub='acctrev'"); run(c, 'renderAcctCenter()'); assert.deepEqual(state(c), ['review', 'acctrev'], 'unchanged pair stays');
  assert.equal(run(c, "acOpenSub('dsettings')"), true); assert.deepEqual(state(c), ['master', 'dsettings']); assert.deepEqual(c.RENDERS.at(-1), 'acct_center');
  assert.equal(run(c, "acOpenSub('nope')"), false);
});

test('事務Crew (6A): 経理出力 is not offered (the screen refused them before); the records tab opens on the export hub; old pair → the hub', () => {
  const oc = app({ role: 'office_crew' });
  assert.deepEqual(subsOf(oc, 'reports'), ['ohub']);
  run(oc, "acSetCat('reports')"); assert.deepEqual(state(oc), ['reports', 'ohub']);
  let html = run(oc, 'renderAcctCenter()');
  assert.ok(!/経理出力/.test(html) && !oc.CALLED.includes('renderAcctExport'));
  assert.ok(oc.CALLED.includes('renderOfficeExport'));
  run(oc, "_acCat='reports'; _acSub='export'"); run(oc, 'renderAcctCenter()'); assert.deepEqual(state(oc), ['reports', 'ohub']);
  const of = app({ role: 'office' });
  run(of, "acSetCat('reports'); _acSub='export'"); html = run(of, 'renderAcctCenter()');
  assert.match(html, /acSetSub\('export'\)">経理出力/); assert.ok(of.CALLED.includes('renderAcctExport'));
  // the other tabs are the same for 事務Crew and 経理
  for (const id of ['dash', 'review', 'drive', 'tip', 'attend', 'master']) assert.deepEqual(subsOf(oc, id), subsOf(of, id), id);
});

test('badges: review counts its own tabs, the intake counts 要確認; the tab bar shows 7 tabs with the counts', () => {
  const c = app({ pend: [{ sub: 'invoice', n: 2 }, { sub: 'gas', n: 1 }, { sub: 'vac', n: 4 }], drivePend: 3 });
  run(c, "acSetCat('review')");
  const html = run(c, 'renderAcctCenter()');
  const bar = html.slice(0, html.indexOf('</div>'));
  assert.equal((bar.match(/class="ac-btn/g) || []).length, 7);
  assert.match(bar, /acSetCat\('review'\)[^]*?経理レビュー<span class="ac-n">5<\/span>/);   // v1201：invoice（画像なし）は ③ へ
  assert.match(bar, /acSetCat\('drive'\)[^]*?インボイス取り込み<span class="ac-n">5<\/span>/);   // 要確認 3 ＋ 画像なし 2
  assert.ok(!/acSetCat\('(bot|hr|export)'\)/.test(html), 'no removed tabs');
  assert.equal(run(c, '_acSub'), 'all', 'v1200 (3A): review opens on 確認する');
  assert.ok(!/PENDLIST/.test(html), 'the one list is the pending view');
  run(c, "acSetSub('acctrev')"); assert.match(run(c, 'renderAcctCenter()'), /PENDLIST/, 'the pending list stays on the other review tabs');
});

test('home (1・5): the clock card stays; the moved entrances show the error count and go to Work Center / People; not on the old Office page', () => {
  const c = app({ issues: [{ sev: 'high' }, { sev: 'low' }, { sev: 'low' }] });
  let html = run(c, 'renderAcctCenter()');
  assert.match(html, /CLOCK/);
  assert.ok(html.indexOf('CLOCK') < html.indexOf('ac-wlinks'));
  assert.match(html, /エラーセンター <span class="tag tag-red"[^>]*>3<\/span>/);
  assert.match(html, /acGoWork\('error'\)/); assert.match(html, /acGoWork\('bot'\)/); assert.match(html, /go\('hr'\)/);
  run(c, "acGoWork('bot')"); assert.equal(run(c, 'workTab'), 'bot'); assert.deepEqual(c.WENT, ['tasks']);
  const nb = app({ bot: false, deny: ['hr'] });
  html = run(nb, 'renderAcctCenter()');
  assert.ok(!/acGoWork\('bot'\)/.test(html) && !/go\('hr'\)/.test(html), 'only what this login can open');
  assert.match(html, /エラーセンター <span class="tag tag-gray"[^>]*>0<\/span>/);
  assert.ok(!/ac-wlinks/.test(run(c, 'renderOfficeMgr()')), 'the old Office page (store side) is unchanged');
});

test('the old Office buttons (出勤中・承認待ち・今月・給与CSV（Office）) open the right tab; both router copies use it', () => {
  const c = app();
  for (const [tab, want] of [['attend', ['attend', 'attend']], ['report', ['review', 'all']], ['export', ['reports', 'ohub']], ['dash', ['dash', 'dash']], ['errors', ['dash', 'dash']]]) {
    run(c, `officeMgrTab=${JSON.stringify(tab)}; acFromOfficeTab()`);
    assert.deepEqual(state(c), want, tab); assert.equal(run(c, 'officeMgrTab'), 'dash', 'reset so the next visit is home');
  }
  const cases = SRC.match(/var _wasAc = \(curPage === 'acct_center'\); curPage = 'acct_center'; acFromOfficeTab\(_wasAc\);/g) || [];
  assert.equal(cases.length, 2, 'both renderPage copies (and they tell whether it came from inside the accounting center)');
  assert.ok(!/curPage = 'acct_center'; _acCat = 'dash'; _acSub = 'dash';/.test(SRC));
});

test('Invoice settings: still redraws in マスター・設定; Gmail return and the QuickBooks notice open it there', () => {
  const c = app();
  for (const [cat, sub, want] of [['drive', 'dlist', true], ['master', 'dsettings', true], ['master', 'vendor', false], ['review', 'acctrev', false]])
    assert.equal(run(c, `_acCat='${cat}'; _acSub='${sub}'; invInOnPage()`), want, cat + '/' + sub);
  assert.equal(run(c, "curPage='tasks'; _acCat='master'; _acSub='dsettings'; invInOnPage()"), false);
  assert.match(SRC, /_invIn\.loaded = \{\}; _acCat = 'master'; _acSub = 'dsettings'; if \(typeof go==='function'\) go\('acct_center'\);/);
  assert.match(SRC, /_acCat=\(n\.invTab==='dsettings'\?'master':'drive'\); _acSub=n\.invTab;/);
});

test('業務Bot answers redraw Work Center only (it is no longer in the accounting center); never another page', () => {
  for (const [page, want] of [['tasks', ['tasks']], ['acct_center', ['acct_center']], ['mypage', []], ['dashboard', []]]) {
    const c = app({ page }); run(c, 'botRender()'); assert.deepEqual(plain(c.RENDERS), want, page);
  }
});

test('English screen: every middle tab and sub tab has an English name, and the bar shows it', () => {
  const c = app({ lang: 'en' });
  assert.deepEqual(plain(run(c, 'AC_TABS.reduce(function(a, x){ return a.concat(x.subs.filter(function(s){ return !s.labelEn; }).map(function(s){ return x.id + "/" + s.id; })); }, [])')), []);
  run(c, "acSetCat('master')");
  const html = run(c, 'renderAcctCenter()');
  assert.match(html, />Masters &amp; settings</); assert.match(html, /acSetSub\('dsettings'\)">Invoice intake settings/); assert.ok(!/取り込みの設定/.test(html));
  const ja = app(); run(ja, "acSetCat('master')"); assert.match(run(ja, 'renderAcctCenter()'), /acSetSub\('dsettings'\)">Invoice 取り込みの設定/);
});

test('Codex #204: a redraw from inside the accounting center (HQ time card month / person, clocking, the close marks) keeps the open tab; an explicit old Office button still moves', () => {
  const c = app();
  run(c, "acSetCat('attend')");
  run(c, "officeMgrTab='dash'; acFromOfficeTab(true)"); assert.deepEqual(state(c), ['attend', 'attend'], 'month changed in 本部タイムカード: stays');
  run(c, "acSetCat('reports'); acSetSub('export'); acFromOfficeTab(true)"); assert.deepEqual(state(c), ['reports', 'export']);
  run(c, "officeMgrTab='attend'; acFromOfficeTab(true)"); assert.deepEqual(state(c), ['attend', 'attend'], 'the 給与CSV（Office） button inside still moves');
  assert.equal(run(c, 'officeMgrTab'), 'dash');
  run(c, "acSetCat('tip'); officeMgrTab='dash'; acFromOfficeTab(false)"); assert.deepEqual(state(c), ['dash', 'dash'], 'coming from outside: home');
  // the time card functions redraw through office_mgr (so the router decides)
  for (const f of ['officeAttendShiftMonth', 'toggleOfficeClose']) assert.match(fnSrc(f), /renderPage\('office_mgr'\)/, f);
  // v1204：打刻はマイページ ① からも押す。経理センターからは今までどおり office_mgr、マイページからはマイページのまま（officePunchRerender）
  assert.match(fnSrc('officeClockIn'), /officePunchRerender\(\)/);
  assert.match(fnSrc('officePunchRerender'), /curPage === 'mypage'\) \{ renderPage\('mypage'\); return; \}\n  renderPage\('office_mgr'\);/);
});
