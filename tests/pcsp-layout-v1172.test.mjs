// v1172（Moto さん 11/14 21:52 HST：UI案82「１〜５ A」）：PC・スマホの共通の決まり（FUNERGY_LAYOUT）と、
// 従業員マスターの PC の表と右のパネル。合成データだけ・本番に接続しない。index.html の中を VM で動かす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const A = HTML.indexOf('/* ==== FUNERGY_LAYOUT start'), B = HTML.indexOf('/* ==== FUNERGY_LAYOUT end ==== */');
assert.ok(A > 0 && B > A, 'FUNERGY_LAYOUT の区切りがある');
const LAYOUT = HTML.slice(A, B);
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let depth = 0, j = HTML.indexOf('{', i);
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error(name);
}
const CSS = HTML.slice(HTML.indexOf('/* ===== v1172：PC・スマホの共通の決まり'), HTML.indexOf('</style>', HTML.indexOf('/* ===== v1172：PC・スマホの共通の決まり')));
const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 版 ---------- */
test('版：APP_VERSION と SW_BUILD が 1172 以上でそろう', () => {
  const a = +(HTML.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1], b = +(SW.match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
  assert.ok(a >= 1172 && a === b, a + ' / ' + b);
});

/* ---------- 画面の幅 ---------- */
function layoutCtx(opt = {}) {
  const body = { _a: {}, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, getAttribute(k) { return this._a[k]; } };
  const ctx = { console, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, setTimeout: () => 0, Set, NodeFilter: { SHOW_TEXT: 4 } };
  ctx.window = ctx;
  ctx.document = Object.assign({ body, readyState: 'complete', visibilityState: 'visible', getElementById: () => null, querySelector: () => null, addEventListener() { }, documentElement: { clientWidth: 390 } }, opt.doc || {});
  if (opt.matchMedia) ctx.matchMedia = opt.matchMedia;
  if (opt.getComputedStyle) ctx.getComputedStyle = opt.getComputedStyle;
  ctx.innerHeight = 844;
  Object.assign(ctx, opt.globals || {});
  vm.createContext(ctx);
  vm.runInContext(LAYOUT, ctx);
  return ctx;
}
test('画面の幅：表・一覧は wide、カードの画面は std、文章と短いフォームは read、自分の幅を持つ画面は印なし', () => {
  const c = layoutCtx({ globals: { mdCanOpen: () => true } });
  const L = c.FUNERGY_LAYOUT;
  for (const p of ['budget', 'meeting', 'staff_master', 'skill', 'leadership', 'labor', 'attendance', 'kpi_master', 'tip', 'hiring']) assert.equal(L.layoutOf(p), 'wide', p);
  for (const p of ['mypage', 'store_cmd', 'settings']) assert.equal(L.layoutOf(p), 'std', p);
  assert.equal(L.layoutOf('handbook_x'), 'read');
  assert.equal(L.layoutOf('shift_admin'), '');
  assert.equal(L.layoutOf('chat'), '');
  assert.equal(L.layoutOf('dashboard'), 'wide');
  const c2 = layoutCtx({ globals: { mdCanOpen: () => false } });
  assert.equal(c2.FUNERGY_LAYOUT.layoutOf('dashboard'), 'std', '管理ダッシュボードを開けない人のダッシュボードはふつう');
});
test('画面の幅：renderPage を包んで、描く前に body[data-layout] を付ける（中身・戻り値は同じ）', () => {
  const seen = [];
  let atRender = null;
  const c = layoutCtx({ globals: { renderPage(p) { atRender = this.document.body._a['data-layout']; seen.push(p); return 'r:' + p; } } });
  c.document.body._a = {};
  assert.equal(c.renderPage('budget'), 'r:budget');
  assert.equal(atRender, 'wide');
  c.renderPage('shift_admin');
  assert.equal(c.document.body._a['data-layout'], undefined, 'シフト作成は印を外す');
  assert.deepEqual(seen, ['budget', 'shift_admin']);
});

/* ---------- スマホ：押せる範囲を広げる（となりとは間の半分まで） ---------- */
function fakeEl(rect, extra = {}) {
  const el = {
    tagName: extra.tag || 'BUTTON', _a: {}, style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] || ''; } },
    parentElement: { closest: () => null }, firstElementChild: null,
    matches: sel => /button/.test(sel), getClientRects: () => [rect], getBoundingClientRect: () => rect,
    hasAttribute(k) { return k in this._a; }, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, getAttribute(k) { return this._a[k]; },
    querySelector: () => null,
  };
  el._cs = Object.assign({ display: 'inline-block', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }, extra.cs || {});
  return el;
}
const R = (left, top, w, h) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h });
function phoneRun(els, phone = true) {
  const root = { querySelectorAll: sel => (/table/.test(sel) ? [] : /input/.test(sel) ? [] : els) };
  const c = layoutCtx({
    matchMedia: q => ({ matches: phone && /767/.test(q) }),
    getComputedStyle: (el, pseudo) => pseudo ? { content: 'none' } : (el._cs || { display: 'block', overflowX: 'visible', overflow: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }),
    doc: { getElementById: id => (id === 'main-content' ? root : null), createTreeWalker: () => ({ nextNode: () => null }) },
  });
  c.FUNERGY_LAYOUT.run();
  return c;
}
test('スマホ：小さい押すところは押せる範囲を 44px に。となりの押すところとは間の半分まで（重ならない）', () => {
  const a = fakeEl(R(10, 100, 30, 30)), b = fakeEl(R(50, 100, 30, 30)), solo = fakeEl(R(200, 300, 20, 20)), big = fakeEl(R(10, 400, 60, 48));
  phoneRun([a, b, solo, big]);
  const ext = el => ['--ht', '--hb', '--hl', '--hr'].map(k => parseFloat(el.style.getPropertyValue(k)) || 0);
  assert.ok(a.hasAttribute('data-hit') && b.hasAttribute('data-hit'));
  assert.deepEqual(ext(a), [7, 7, 7, 5], 'a の右は間（10px）の半分');
  assert.deepEqual(ext(b), [7, 7, 5, 7], 'b の左も間の半分');
  assert.deepEqual(ext(solo), [12, 12, 12, 12], 'まわりに何もなければ 44px');
  assert.ok(!big.hasAttribute('data-hit'), '44px 以上はそのまま');
  /* 広げたあとの大きさ：a は 44×42、となりの b と重ならない */
  const ea = ext(a), eb = ext(b);
  assert.ok(10 + 30 + ea[3] <= 50 - eb[2] + 0.01, '重ならない');
});
test('スマホ：文字の行の中・表の中・はみ出しを切る中の押すところは広げない／PC では何もしない', () => {
  const inl = fakeEl(R(10, 10, 20, 14), { cs: { display: 'inline' } }), cell = fakeEl(R(10, 60, 20, 14), { cs: { display: 'table-cell' } }), clip = fakeEl(R(10, 120, 20, 14), { cs: { overflow: 'hidden', overflowX: 'hidden' } });
  phoneRun([inl, cell, clip]);
  for (const e of [inl, cell, clip]) assert.ok(!e.hasAttribute('data-hit'));
  const x = fakeEl(R(10, 10, 20, 20));
  phoneRun([x], false);
  assert.ok(!x.hasAttribute('data-hit'), 'PC（768px 以上）では印を付けない');
});

/* ---------- CSS の決まり ---------- */
test('CSS：PC の幅（1024px 以上で 1440、1440px 以上で 1880）・箱の大きさ・スマホの全画面の箱と固定の行', () => {
  assert.match(CSS, /@media \(min-width:1024px\)[\s\S]*body\[data-layout="wide"\] \.main \{ max-width:1440px; \}/);
  assert.match(CSS, /@media \(min-width:1440px\)[\s\S]*body\[data-layout="wide"\] \.main \{ max-width:1880px; \}/);
  assert.match(CSS, /#modal-body\.modal\[data-msize="lg"\] \{ max-width:1000px; \}/);
  assert.match(CSS, /#modal-body\.modal\[data-mfull\][^{]*\{[^}]*height:100%/);
  assert.match(CSS, /\[data-mfull\] > \[data-mfoot\] \{ position:sticky; bottom:/);
  assert.match(CSS, /\[data-fs11\] \{ font-size:11px !important; \}/);
});
test('CSS：スマホの見出しはボタンを次の行へ・上の店の切り替えは縮めない（足りなければ名前の札を縮める・374px 以下は出さない）', () => {
  const sp = CSS.slice(CSS.indexOf('@media (max-width:767px)'));
  assert.match(sp, /\.section-header \{ flex-wrap:wrap;/);
  const m640 = CSS.slice(CSS.indexOf('@media (max-width:640px)'), CSS.indexOf('@media (max-width:374px)'));
  assert.match(m640, /\.topbar-store \{[^}]*flex:0 0 auto/);
  assert.match(m640, /\.topbar-role-badge \{ min-width:0; overflow:hidden; \}/);
  assert.match(m640, /\.tb-sn-f \{ display:none; \}/, '略称の決まりは 640px の段のまま');
  assert.match(CSS, /@media \(max-width:374px\) \{\s*\.topbar-role-badge \{ display:none; \}/);
});

/* ---------- 上の店の名前（略称） ---------- */
test('上の店の名前：正式名と略称の両方を出し、どちらもエスケープする', () => {
  const ctx = { escapeHtml, STORES: [{ id: 'F01', name: 'Tori<b>Ton' }], _bStoreAbbr: s => (s.id === 'F01' ? 'T<T' : s.id) };
  vm.createContext(ctx); vm.runInContext(fnSrc('tbStoreName'), ctx);
  const h = ctx.tbStoreName('F01', 'Tori<b>Ton');
  assert.match(h, /tb-sn-f">Tori&lt;b&gt;Ton</);
  assert.match(h, /tb-sn-s">T&lt;T</);
  assert.match(ctx.tbStoreName('ALL', '全店舗'), /tb-sn-s">全店</);
});

/* ---------- Qコミットビュー：棒の下の数字を重ねない ---------- */
test('Qコミットビュー：棒の下の数字は並べる（絶対位置で重ねない）。棒の印は今までどおり', () => {
  const src = HTML.slice(HTML.indexOf('/* ★着地見込みをバー上の印にする'), HTML.indexOf('/* ★埋め方をここに畳む'));
  assert.ok(src.length > 100);
  assert.match(src, /display:flex;flex-wrap:wrap;justify-content:space-between/);
  assert.doesNotMatch(src, /position:absolute;left:0">\$0/);
  assert.doesNotMatch(src, /transform:translateX\(-50%\)/);
  assert.match(src, /_qcBarMark\(pPace/);
  assert.match(src, /_qcBarMark\(pFc/);
});

/* ---------- 従業員マスター：PC は表と右のパネル、スマホは今のカード ---------- */
const EMPS = [
  { id: 'e1', name: 'Wes Endo', role: 'ceo', store: 'ALL', emp: '正社員', status: '在籍', step: 0, title: 'CEO' },
  { id: 'e2', name: 'Cora <img src=x onerror=alert(1)>', role: 'g4', store: 'F01', support: ['F02', 'F03'], emp: '正社員', status: '在籍', step: 3, empCode: 'TT-1', hireDate: '2025-04-01', insurance: true },
  { id: 'e3', name: 'Kai Mori', role: 'crew', store: 'F02', emp: 'パート', status: '在籍', step: 1 },
  { id: 'e4', name: 'Ren Old', role: 'crew', store: 'F03', emp: 'パート', status: '退職', step: 0 },
];
function staffCtx(opt = {}) {
  const els = {};
  const listeners = [];
  const mq = { matches: !!opt.pc, addEventListener: (ev, fn) => listeners.push(fn) };
  const ctx = {
    console, Math, String, Number, Object, Array, JSON, setTimeout: () => 0,
    escapeHtml, t: (ja) => ja, curRole: opt.role || 'gm', window: null, STORES: [{ id: 'F01' }, { id: 'F02' }, { id: 'F03' }],
    empFilter: opt.filter || 'active', empStoreFilter: opt.store || 'all', empSearchQ: opt.q || '',
    canAccessStaffMaster: () => true, empRosterRefresh() { }, piiEnsure() { },
    getEmployees: () => JSON.parse(JSON.stringify(EMPS)),
    myAmStores: () => opt.amStores || [],
    canViewPins: () => !!opt.pins, wageScopeStores: () => (opt.wage === 'all' ? null : []),
    canViewWageOf: e => opt.wage === 'all' || (opt.wage === 'F02' && e.store === 'F02'),
    getStaffPin: n => (n === 'Kai Mori' ? '4321' : '0000'),
    renderInactiveCard: () => '<div class="card" data-clear>in</div>', renderUnregisteredCard: () => '', renderOffboardingCard: () => '', renderResignRepairCard: () => '',
    bStoreChips: () => '<chips>', storeBadge: id => '<sb ' + escapeHtml(id) + '>',
    empGrade: e => ({ ceo: 'CEO', g4: 'G4', crew: 'G1' }[e.role] || ''),
    evalColorLv: () => '#999', getOffboardings: () => [{ id: 'o1', empId: 'e4', status: '進行中' }], offboardProgress: () => ({ pct: 40 }),
    empTitleHtml: e => (e.title ? '<b>' + escapeHtml(e.title) + '</b>' : ''), gradeLevelBadgeHtml: () => '<lv>',
    isMonthlyTitle: t => t === 'CEO', empMonthlyOf: () => 10000, empWageOf: () => 16,
    empToastAliases: e => (e.id === 'e2' ? [{ n: 'Cora<T>', store: 'F01' }] : []),
    document: { getElementById: id => els[id] || null, querySelector: () => null },
  };
  if (opt.noMq !== true) ctx.matchMedia = q => { assert.equal(q, '(min-width:1024px)'); return mq; };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['renderStaffMaster', 'empSmResignBtns', 'empSmPanelInner', 'empSmPick', 'empSmIsPc', 'empSmWatch']) vm.runInContext(fnSrc(f), ctx);
  ctx._els = els; ctx._mq = mq; ctx._listeners = listeners;
  return ctx;
}
const part = (h, a, b) => { const i = h.indexOf(a); assert.ok(i >= 0, a); const j = b ? h.indexOf(b, i) : h.length; return h.slice(i, j < 0 ? h.length : j); };
const cardIds = h => [...h.matchAll(/class="staff-item"[^>]*onclick="openEmpModal\('([^']+)'\)"/g)].map(m => m[1]);
const rowIds = h => [...h.matchAll(/class="sm-row[^"]*"[^>]*data-eid="([^"]+)"/g)].map(m => m[1]);
test('従業員マスター：幅に合うほうだけを描く（スマホ・タブレットはカード、1024px 以上は表とパネル。両方は描かない）', () => {
  const hs = staffCtx({ pc: false }).renderStaffMaster();
  const hp = staffCtx({ pc: true }).renderStaffMaster();
  assert.match(hs, /<div class="sm-wrap" data-v="sp"><div class="card sm-sp">/);
  assert.doesNotMatch(hs, /sm-pc|sm-tbl|sm-panel|sm-row/, 'カードのときは表もパネルも描かない');
  assert.match(hp, /<div class="sm-wrap" data-v="pc"><div class="sm-pc">/);
  assert.doesNotMatch(hp, /sm-sp|staff-item/, '表のときはカードを描かない');
  assert.deepEqual(cardIds(hs), ['e1', 'e2', 'e3']);
  assert.deepEqual(rowIds(hp), cardIds(hs), '在籍の 3 人・同じ順（Grade の順）');
  for (const h of [hs, hp]) {
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, '同じ id が 2 つない');
    assert.match(h, /<div class="sm-chk"><div class="card" data-clear>/, '上の確かめのカードは横に並べる箱の中');
  }
  assert.deepEqual([...hp.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(x => x !== 'emp-search'), ['sm-panel']);
  /* matchMedia が無い・使えないときはカード（今までどおり） */
  assert.match(staffCtx({ noMq: true }).renderStaffMaster(), /data-v="sp"/);
});
test('従業員マスター：名前・コード・Toast の名前はエスケープする（カード・表・パネル）', () => {
  const hs = staffCtx({ pc: false, pins: true }).renderStaffMaster();
  const c = staffCtx({ pc: true, pins: true });
  c.empSmSel = 'e2';
  const hp = c.renderStaffMaster();
  for (const h of [hs, hp]) assert.doesNotMatch(h, /<img src=x/);
  assert.equal((hs.match(/Cora &lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 1, 'カード');
  assert.ok((hp.match(/Cora &lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 2, '表とパネル');
  assert.match(hp, /Cora&lt;T&gt;/);
  assert.match(part(hp, 'id="sm-panel"'), /2025-04-01/);
  assert.match(part(hp, 'id="sm-panel"'), /<dt>保険<\/dt><dd>医療<\/dd>/);
});
test('従業員マスター：給与の列とパネルの給与は見てよい人だけ。PIN は PIN を見られる人だけ', () => {
  for (const pc of [false, true]) {
    const h = staffCtx({ pc, wage: 'none', pins: false }).renderStaffMaster();
    assert.doesNotMatch(h, /<th class="num">給与/);
    assert.doesNotMatch(h, /\$16\/h|\$10,000/);
    assert.doesNotMatch(h, /PIN/);
  }
  let h = staffCtx({ pc: true, wage: 'F02', pins: false }).renderStaffMaster();
  assert.match(h, /<th class="num">給与/);
  const rows = [...h.matchAll(/data-eid="(e\d)"[\s\S]*?<\/tr>/g)].map(m => [m[1], /\$16\/h|\$10,000/.test(m[0])]);
  assert.deepEqual(rows, [['e1', false], ['e2', false], ['e3', true]], '給与は F02 の人だけ');
  h = staffCtx({ pc: true, wage: 'all', pins: true }).renderStaffMaster();
  assert.match(part(h, 'id="sm-panel"'), /<dt>PIN<\/dt>/);
  assert.match(part(h, 'id="sm-panel"'), /\$10,000\/月/);
});
test('従業員マスター：AM は担当の店の人だけ（カードと表の両方）。退職の手続き・復元のボタンはカードと同じ決まり', () => {
  const hs = staffCtx({ pc: false, role: 'am', amStores: ['F03'] }).renderStaffMaster();
  const hp = staffCtx({ pc: true, role: 'am', amStores: ['F03'] }).renderStaffMaster();
  assert.deepEqual(cardIds(hs), ['e1', 'e2'], '全店の人と、F03 を応援する人だけ（F02 の人は出ない）');
  assert.deepEqual(rowIds(hp), cardIds(hs));
  /* 退職した人：GM は手続きと復元、店長（sl）は手続きだけ（カードもパネルも） */
  const c = staffCtx({ pc: true, filter: 'resigned' }); c.empSmSel = 'e4';
  const panel = part(c.renderStaffMaster(), 'id="sm-panel"');
  assert.match(panel, /openOffboardingModal\('o1'\)/);
  assert.match(panel, /restoreEmployee\('e4'\)/);
  const cs = staffCtx({ pc: false, filter: 'resigned' }).renderStaffMaster();
  assert.match(cs, /openOffboardingModal\('o1'\)/);
  assert.match(cs, /restoreEmployee\('e4'\)/);
  const c2 = staffCtx({ pc: true, filter: 'resigned', role: 'sl' }); c2.empSmSel = 'e4';
  const h2 = c2.renderStaffMaster();
  assert.doesNotMatch(h2, /restoreEmployee/);
  assert.match(part(h2, 'id="sm-panel"'), /openOffboardingModal\('o1'\)/);
  assert.doesNotMatch(staffCtx({ pc: false, filter: 'resigned', role: 'sl' }).renderStaffMaster(), /restoreEmployee/);
});
test('従業員マスター：AM の担当の外の人は表にもパネルにも出ない（選んでも出さない）', () => {
  const c = staffCtx({ pc: true, role: 'am', amStores: ['F02'] });
  c.empSmSel = 'e2';
  const h = c.renderStaffMaster();
  const allowed = new Set([...h.matchAll(/data-eid="(e\d)"/g)].map(m => m[1]));
  /* empSmPick：表にある行だけ。表に無い人の id では何も描かない */
  const rows = [...allowed].map(id => ({ id, attr: {}, getAttribute(k) { return k === 'data-eid' ? id : this.attr[k]; }, setAttribute(k, v) { this.attr[k] = v; }, classList: { toggle() { } } }));
  const panel = { innerHTML: 'old' };
  c.document = { querySelector: s => (s.includes('sm-tbl') ? { querySelectorAll: () => rows } : null), getElementById: id => (id === 'sm-panel' ? panel : null) };
  c.empSmPick('e4');
  assert.equal(panel.innerHTML, 'old', '表に無い人（退職・担当の外）は出さない');
  c.empSmPick([...allowed][0]);
  assert.notEqual(panel.innerHTML, 'old');
});
test('従業員マスター：パネルの編集はその行の人の画面を開く・表の行はクリックで選ぶ／ダブルクリックと Enter で開く', () => {
  const h = staffCtx({ pc: true }).renderStaffMaster();
  assert.match(part(h, 'id="sm-panel"'), /data-eid="e1" onclick="openEmpModal\(this\.getAttribute\('data-eid'\)\)"/);
  const row = part(h, 'class="sm-row sel"', '</tr>');
  assert.match(row, /onclick="empSmPick\(this\.getAttribute\('data-eid'\)\)"/);
  assert.match(row, /ondblclick="openEmpModal\(this\.getAttribute\('data-eid'\)\)"/);
  assert.match(row, /event\.key==='Enter'/);
  assert.match(row, /tabindex="0"/);
});
test('従業員マスター：幅が 1024px をまたいだら、開いているときだけ描き直す（見張りは 1 つ・入力中と箱を開いているあいだは待つ）', () => {
  const c = staffCtx({ pc: false });
  c.renderStaffMaster(); c.renderStaffMaster(); c.renderStaffMaster();
  assert.equal(c._listeners.length, 1, '何度描いても見張りは 1 つ');
  const calls = [];
  let wrapV = 'sp', modalOpen = false, typing = false;
  c.renderPage = p => calls.push(p);
  c._empTyping = () => typing;
  c.document = {
    querySelector: s => (s === '.sm-wrap' ? { getAttribute: k => (k === 'data-v' ? wrapV : null) } : null),
    getElementById: id => (id === 'modal-overlay' ? { classList: { contains: n => n === 'open' && modalOpen } } : null),
  };
  const fire = () => c._listeners[0]();
  c.curPage = 'dashboard'; c._mq.matches = true; fire();
  assert.deepEqual(calls, [], 'ほかの画面では描き直さない');
  c.curPage = 'staff_master'; c._mq.matches = false; fire();
  assert.deepEqual(calls, [], '形が同じなら描き直さない');
  const timers = [];
  c.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; }; c.clearTimeout = () => { };
  c._mq.matches = true; modalOpen = true; fire();
  typing = true; modalOpen = false; fire();
  assert.deepEqual(calls, [], '箱を開いている・入力中は待つ');
  assert.deepEqual(timers.map(x => x[1]), [1500, 1500], '待つあいだは 1.5 秒ごとに見直す');
  typing = false; timers[1][0]();
  assert.deepEqual(calls, ['staff_master'], '入力が終わったら描き直す（幅の変わる知らせを待たない）');
});
test('従業員マスター：CSS は 1024px 以上で表とパネルを横に並べる（片方を隠す決まりは無い。描き直すまでは縦に並ぶ）', () => {
  assert.doesNotMatch(CSS, /\.sm-pc \{ display:none; \}/);
  assert.doesNotMatch(CSS, /\.sm-sp \{ display:none; \}/);
  const at = CSS.indexOf('.sm-chk { display:grid;');
  assert.ok(at > 0);
  assert.match(CSS.slice(CSS.lastIndexOf('@media (min-width:1024px)', at)), /^@media \(min-width:1024px\) \{[\s\S]*?\.sm-wrap > \.sm-pc \{ display:grid;/);
  assert.match(CSS, /@media \(min-width:1024px\) \{ \.sm-pc > \.sm-panel \{ margin-top:0; position:sticky; top:64px; \} \}/);
});
