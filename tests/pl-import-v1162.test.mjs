// v1162 会計PLブックの取り込み（読み取り規則の作り直し）。合成データだけ（本番の PL の数は使わない）。
// 2026年10月版（Oct26）の形：科目番号つき（'Total for 60000 1.Payroll expenses'）・販管費の中の入れ子の小計（General Excise Tax (GET)）・
// 各月に CURRENT と % of Income・右端に期間累計（Total）。前の形（v1020 の Aug26 の形）も同じ入口で読めること。仕様：docs/PL_IMPORT_V1162_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('./runtime/', import.meta.url));
const XLSX = require('xlsx');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 取り込みのブロック（読む・区分の表）と、見せる・保存する関数を取り出す
function block(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, 'block ' + a); return html.slice(i, j); }
function fnSrc(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, k = html.indexOf('{', i);
  for (; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) break; } }
  return html.slice(i, k + 1);
}
function load(store = {}) {
  const toasts = [];
  const ctx = {
    XLSX, console, JSON, Math, Object, Array, String, Number, RegExp, Date,
    ls: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d),
    lsSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    t: (ja) => ja, escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtK: v => '$' + Math.round(v), todayJP: () => '2026/11/14', showToast: (m, k) => toasts.push([k, m]),
    closeModalDirect() {}, _secRerender() {}, STORES: [{ id: 'F06', name: 'LaLa' }, { id: 'F05', name: 'Marujuu' }],
  };
  vm.createContext(ctx);
  vm.runInContext(block('var PL_SHEET_MAP = {', '/* SheetJS は取り込みのときだけ読む'), ctx);
  vm.runInContext(['_plPreviewHtml', '_plStoreLabel', 'plImportSave'].map(fnSrc).join('\n') + '\nvar _plImport = null;', ctx);
  return Object.assign(ctx, { store, toasts });
}

// ---- 合成の PL ブックを作る
const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];
const n = (a) => a.map(v => (v == null ? null : Math.round(v * 100) / 100));
// 店の木（科目の行だけ指定。合計・粗利益・営業利益・最終利益は作る）
function store(seed = 1) {
  const f = (b, i) => b * seed + i * 101.37;
  const m3 = b => n([f(b, 0), f(b, 1), f(b, 2)]);
  return {
    inc: [['40100 Sales - Food', m3(80000)], ['40200 Sales - Non Alcohol Beverage', m3(2200)], ['40300 Sales - Liquor', m3(4100)], ['41000 Sales - Discount', n([-310.25, -280.5, -301.75])], ['41100 Sales - Point Card Discount', [null, null, null]]],
    cogs: [['50100 COGS - Food', m3(22000)], ['50200 COGS - Non Alcohol Beverage', m3(1150)], ['50400 COGS - Supplies', [null, null, null]]],
    pay: [['60300 Salaries - Employees', m3(29000)], ['60400 Salaries - Bonus', n([null, 1200, null])], ['60500 Payroll taxes', m3(4200)], ['60600 Payroll Related Insurance（WC/TDI)', m3(830)], ['60950 Payroll Processing Fees', m3(140)]],
    opex: [{ group: 'General Excise Tax (GET)', items: [['70500 Taxes - General Excise', m3(4400)], ['41200 Sales - State Tax（GET pass-on)', n([-4405.12, -4410.5, -4399.01])]] },
      ['70100 Rent - Store', n([11020.2, 11020.2, 11020.2])], ['70200 Utilities - Electricity', m3(2300)], ['70300 Supplies - Kitchen', m3(1800)], ['70400 Merchant account fees', m3(2100)],
      ['70510 Taxes - Liquor Commission', n([1215, null, null])], ['70520 Taxes, Licenses & Fees', n([200, null, 50])], ['70600 Repairs & maintenance', m3(1500)], ['70700 Insurance -  General', [null, null, null]]],
    oinc: [['80400 Gain/Loss on Asset Disposal', n([null, 150, null])]],
    oexp: [['85000 Depreciation Expense', n([2979.17, 2979.17, 2979.17])], ['Head Office Expenses', m3(10800)]],
  };
}
const sumv = (rows, i) => Math.round(rows.reduce((a, r) => a + (r[1][i] || 0), 0) * 100) / 100;
function flat(items) { const out = []; for (const x of items) { if (x.group) out.push(...x.items); else out.push(x); } return out; }
// 木 → 行の並び（[label, vals|null, kind]）。label の文字は opt で変えられる（前の形・ゆれ）
function rowsOf(s, opt = {}) {
  const L = Object.assign({ income: 'Income', cogs: 'Cost of Goods Sold', exp: 'Expenses', pay: '60000 1.Payroll expenses', opex: '70000 2. Operating Expenses', oinc: 'Other Income', oexp: 'Other Expenses' }, opt.labels || {});
  const k = MONTHS.length, R = [], T = (a) => Array.from({ length: k }, (_, i) => a(i));
  const tot = (rows) => T(i => sumv(rows, i));
  const inc = tot(s.inc), cogs = tot(s.cogs), pay = tot(s.pay), opexL = flat(s.opex), opex = tot(opexL), oinc = tot(s.oinc), oexp = tot(s.oexp);
  R.push([L.income]); s.inc.forEach(r => R.push(r)); R.push(['Total for ' + L.income, inc]);
  R.push([L.cogs]); s.cogs.forEach(r => R.push(r)); R.push(['Total for ' + L.cogs, cogs]);
  const gp = T(i => Math.round((inc[i] - cogs[i]) * 100) / 100); R.push(['Gross Profit', gp]);
  R.push([L.exp]);
  R.push([L.pay]); s.pay.forEach(r => R.push(r)); R.push(['Total for ' + L.pay, pay]);
  R.push([L.opex]);
  for (const x of s.opex) { if (x.group) { R.push([x.group]); x.items.forEach(r => R.push(r)); R.push(['Total for ' + x.group, tot(x.items)]); } else R.push(x); }
  R.push(['Total for ' + L.opex, opex]);
  const exp = T(i => Math.round((pay[i] + opex[i]) * 100) / 100); R.push(['Total for ' + L.exp, exp]);
  const noi = T(i => Math.round((gp[i] - exp[i]) * 100) / 100); R.push(['Net Operating Income', noi]);
  if (s.oinc.length) { R.push([L.oinc]); s.oinc.forEach(r => R.push(r)); R.push(['Total for ' + L.oinc, oinc]); }
  R.push([L.oexp]); s.oexp.forEach(r => R.push(r)); R.push(['Total for ' + L.oexp, oexp]);
  const no = T(i => Math.round((oinc[i] - oexp[i]) * 100) / 100); R.push(['Net Other Income', no]);
  R.push(['Net Income', T(i => Math.round((noi[i] + no[i]) * 100) / 100)]);
  return { R, keys: { inc, cogs, gp, pay, opex, exp, noi, oinc, oexp, no, ni: T(i => Math.round((noi[i] + no[i]) * 100) / 100) } };
}
// 行の並び → シート。layout 'oct'：各月 CURRENT と % of Income・右端に Total。'aug'：1 か月 1 列（前の形）
function sheetOf(R, opt = {}) {
  const layout = opt.layout || 'oct', months = opt.months || MONTHS, title = opt.title || 'Store - PL - Year to Last Month';
  const aoa = [[title], ['Funergy Group Inc.'], ['January-March, 2026'], []];
  const w = layout === 'oct' ? 2 : 1, head = [''], sub = [''];
  // opt.cols：月の中の列（'B'＝予算・'C'＝実績・'P'＝%）。既定は CURRENT と % of Income
  const colsPer = opt.cols || (layout === 'oct' ? ['C', 'P'] : ['C']);
  const SUBL = { B: 'BUDGET', C: 'CURRENT', P: '% of Income' };
  months.forEach(m => { colsPer.forEach((k, j) => { head.push(j === 0 ? m : ''); sub.push(layout === 'oct' ? (opt.noCurLabel && k === 'C' ? '' : SUBL[k]) : ''); }); });
  if (layout === 'oct') { head.push('Total', ''); sub.push('Jan 1 - Mar 31 2026', '% of Income'); }
  aoa.push(head); if (layout === 'oct') aoa.push(sub);
  const incRow = R.find(r => /^total for income$/i.test(String(r[0]).trim()));
  for (const r of R) {
    const line = [r[0]];
    if (r[1]) {
      r[1].forEach((v, i) => { colsPer.forEach(k => {
        if (k === 'C') line.push(v == null ? (layout === 'oct' ? '' : null) : v);
        else if (k === 'B') line.push(v == null ? '' : Math.round((v * 1.1 + 333) * 100) / 100);   // 予算の列（読み違えたら分かる）
        else { const ii = incRow && incRow[1][i]; line.push(v == null || !ii ? '' : 9999 + v / ii * 100); }   // % の列はわざと大きな数
      }); });
      if (layout === 'oct') { const t = Math.round(r[1].reduce((a, v) => a + (v || 0), 0) * 100) / 100; line.push(t, 5555); }   // Total（期間累計）も読まないはず
    }
    aoa.push(line);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // % の列は本物の PL と同じく % の書式（表示は「99990.0%」。見出しと取り違えないこと）
  if (layout === 'oct') for (let r = 6; r < aoa.length; r++) for (let i = 0; i < months.length; i++) { const a = XLSX.utils.encode_cell({ r, c: 1 + i * colsPer.length + colsPer.indexOf('P') }); if (colsPer.includes('P') && ws[a] && typeof ws[a].v === 'number') ws[a].z = '0.0%'; }
  if (opt.subLabels === false) { for (let c = 1; c < 30; c++) { const a = XLSX.utils.encode_cell({ r: 5, c }); if (ws[a] && ws[a].v === 'CURRENT') delete ws[a]; } }
  if (opt.mut) opt.mut(ws, aoa);
  return ws;
}
function book(sheets, opt = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name);
  // アプリと同じ道：一度 xlsx のバイトにして読み直す
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return XLSX.read(new Uint8Array(buf), { type: 'array' });
}
const near = (a, b) => Math.abs(a - b) < 0.006;
// 試験の VM の中の値は別の realm の配列・オブジェクトなので、比べる前に JSON で写す
const J = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);

test('the October layout: every store and month reads, the keys match to the cent, % of Income and the Total column are not read', () => {
  const c = load();
  const S1 = rowsOf(store(1)), S2 = rowsOf(store(1.2));
  const wb = book({ 'Marujuu': sheetOf(S1.R), 'Tori Ton': sheetOf(S2.R) });
  const r = c.parsePLWorkbook(wb, { fileName: 'PL_Mar26.xlsx' });
  same(r.issues, [], JSON.stringify(r.issues));
  same(r.months, ['2026-01', '2026-02', '2026-03']);
  assert.equal(r.rows.length, 6); assert.ok(r.rows.every(x => x.ok));
  const m = r.rows.find(x => x.storeKey === 'F05' && x.ym === '2026-02'), K = S1.keys, i = 1;
  for (const [k, want] of [['sales', K.inc[i]], ['cogs', K.cogs[i]], ['gp', K.gp[i]], ['payroll', K.pay[i]], ['opex', K.opex[i]], ['exp', K.exp[i]], ['netop', K.noi[i]], ['othInc', K.oinc[i]], ['othExp', K.oexp[i]], ['netOther', K.no[i]], ['netinc', K.ni[i]]])
    assert.ok(near(m.c[k], want), k + ' ' + m.c[k] + ' vs ' + want);
  // 前の画面が使う形（ドル単位・科目名から番号を外す）
  same(Object.keys(m.v).sort(), ['cogs', 'netinc', 'netop', 'opex', 'payroll', 'sales']);
  assert.equal(m.v.sales, Math.round(K.inc[i]));
  assert.ok(near(m.dets.detailInc['Sales - Food'], 80101.37));
  assert.ok(!('40100 Sales - Food' in m.dets.detailInc), 'the account number is not part of the name');
  // 41200 Sales - State Tax は名前に Sales があっても、親（販管費の中の GET）で決まる
  assert.ok(!('Sales - State Tax（GET pass-on)' in m.dets.detailInc));
  assert.ok(near(m.dets.detail['Sales - State Tax（GET pass-on)'], -4410.5) && near(m.dets.detail['Taxes - General Excise'], 4501.37));
  assert.ok(near(m.dets.detailPay['Salaries - Bonus'], 1200));
  assert.ok(near(m.dets.detailOth['Head Office Expenses'], 10901.37) && near(m.dets.detailOthInc['Gain/Loss on Asset Disposal'], 150));
  // 明細の合計＝合計行（入れ子の小計を二重に足さない）
  const sum = o => Math.round(Object.values(o).reduce((a, v) => a + v, 0) * 100) / 100;
  assert.ok(near(sum(m.dets.detail), m.c.opex) && near(sum(m.dets.detailPay), m.c.payroll) && near(sum(m.dets.detailInc), m.c.sales));
  // 科目の行：区分・番号・小計・元の行
  const get = m.lines.find(l => l.code === '41200');
  same([get.sec, get.grp, get.name], ['exp', 'General Excise Tax (GET)', 'Sales - State Tax（GET pass-on)']);
  assert.ok(get.row > 0);
  assert.equal(m.col, 'D', 'Feb CURRENT is column D (B=Jan, C=% of Jan)');
  // 空の科目は持たない（実績 0 と空を区別するのは月の単位）
  assert.ok(!m.lines.some(l => l.code === '41100'));
});

test('the cause of the October error: the payroll and operating-expense totals now carry account numbers', () => {
  const c = load();
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(rowsOf(store()).R) }), {});
  assert.ok(r.rows.every(x => x.ok));
  const L = rowsOf(store()).R.map(x => x[0]);
  assert.ok(L.includes('Total for 60000 1.Payroll expenses') && L.includes('Total for 70000 2. Operating Expenses'));
  // 前の読み取り（v910〜v1161）は 'total for 1.payroll expenses' を完全一致で探していた
  assert.equal(html.indexOf("payroll: 'total for 1.payroll expenses'"), -1, 'the exact-label lookup is gone');
});

test('the earlier layout (one column per month, no account numbers) still reads the same way as v1020', () => {
  const c = load();
  const s = {
    inc: [['01.Food', n([100000, 110000, null])], ['06. Sales - Other Income (Corkage, Cancel Fee)', n([500, 600, null])]],
    cogs: [['01.Food', n([30000, 33000, null])]], pay: [['Wages', n([30000, 31000, null])]],
    opex: [['Rent - Store', n([8000, 8000, null])], ['Merchant account fees', n([2500, 2600, null])], ['Taxes - General Excise Tax', n([4700, 5200, null])]],
    oinc: [['Sales Tax Collected', n([4735, 5210, null])]], oexp: [['Depreciation Expense', n([1200, 1200, null])], ['Head Office Fee', n([7000, 7700, null])]],
  };
  const S = rowsOf(s, { labels: { pay: '1.Payroll Expenses', opex: '2. Operating Expenses' } });
  const r = c.parsePLWorkbook(book({ 'Tori Ton': sheetOf(S.R, { layout: 'aug' }) }), {});
  same(r.issues, []);
  same(r.months, ['2026-01', '2026-02'], 'the empty future month is not imported');
  const t1 = r.rows[0];
  same(t1.v, { sales: 100500, cogs: 30000, payroll: 30000, opex: 15200, netop: 25300, netinc: 21835 });
  assert.equal(t1.dets.detailInc['01.Food'], 100000, 'short old numbers stay in the name');
  assert.equal(t1.dets.detailInc['06. Sales - Other Income (Corkage, Cancel Fee)'], 500);
  assert.equal(t1.dets.detailOthInc['Sales Tax Collected'], 4735);
  same(t1.dets.detailOth, { 'Depreciation Expense': 1200, 'Head Office Fee': 7000 });
  assert.equal(t1.col, 'B');
});

test('① blank rows, notes, reordering inside a section and width or space differences do not change the totals', () => {
  const c = load();
  const S = rowsOf(store());
  const base = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), {}).rows;
  const R = S.R.slice();
  const at = R.findIndex(x => x[0] === '70100 Rent - Store');
  [R[at], R[at + 1]] = [R[at + 1], R[at]];                       // 並べ替え
  R.splice(at + 2, 0, ['']);                                     // 空行
  R.splice(3, 0, ['※ 10月は暫定です（説明の行）']);                  // 説明の行（金額なし）
  const i2 = R.findIndex(x => x[0] === 'Total for Income'); R[i2] = ['Total  for  Ｉｎｃｏｍｅ', R[i2][1]];   // 空白・全角
  const i3 = R.findIndex(x => x[0] === 'Income'); R[i3] = ['ＩＮＣＯＭＥ'];
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
  assert.ok(r.rows.every(x => x.ok), JSON.stringify(r.issues));
  r.rows.forEach((x, i) => { same(x.c, base[i].c); same(x.dets, base[i].dets); });
  assert.ok(!r.issues.some(i => i.lv === 'fatal'));
});

test('② a new account with its subtotal updated is counted once; without the subtotal updated the store-month is refused with the cell, expected value and difference', () => {
  const c = load();
  const s = store();
  s.opex.push(['70960 Shipping & Postage', n([45.5, 30, 12.25])]);
  const S = rowsOf(s);
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), {});
  assert.ok(r.rows.every(x => x.ok));
  const m = r.rows[0];
  assert.equal(m.lines.filter(l => l.code === '70960').length, 1);
  assert.ok(near(m.c.opex, S.keys.opex[0]) && near(m.dets.detail['Shipping & Postage'], 45.5));
  // 小計（Total for 70000 2. Operating Expenses）を直さずに明細だけ足した
  const s2 = store(), S2 = rowsOf(s2);
  const R = S2.R.slice(), at = R.findIndex(x => x[0] === 'Total for 70000 2. Operating Expenses');
  R.splice(at, 0, ['70960 Shipping & Postage', n([45.5, null, null])]);
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
  const jan = r2.rows.find(x => x.ym === '2026-01'), feb = r2.rows.find(x => x.ym === '2026-02');
  assert.equal(jan.ok, false); assert.equal(feb.ok, true, 'the other months are still imported');
  const f = r2.issues.find(i => i.lv === 'fatal' && i.ym === '2026-01');
  assert.equal(f.cell, 'Marujuu!B' + (at + 1 + 7), 'the total row cell (the rows start at Excel row 7; one row was added above it)');
  assert.ok(near(f.expected, S2.keys.opex[0] + 45.5) && near(f.actual, S2.keys.opex[0]) && near(f.diff, -45.5));
  assert.match(f.fix, /合計の数式/);
});

test('③ a new operating-expense account is kept with its amount and shown as unclassified; renamed accounts keep their earlier class', () => {
  const c = load();
  const s = store(); s.opex.push(['70980 Travel - Hotel & Transportation', n([480, null, null])]);
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(rowsOf(s).R) }), {});
  const m = r.rows[0];
  assert.ok(near(m.dets.detail['Travel - Hotel & Transportation'], 480));
  assert.equal(c.plClassOf('Travel - Hotel & Transportation'), 'other');
  const t = c.plClassTotals(m.dets.detail);
  assert.ok(t._unknown.includes('Travel - Hotel & Transportation'));
  // 名前が変わった科目（Oct26）：前の区分を引き継ぐ
  assert.equal(c.plClassOf('70500 Taxes - General Excise'), 'variable');
  assert.equal(c.plClassOf('Taxes, Licenses & Fees'), 'fixed');
  assert.equal(c.plClassOf('70991 Freight / Delivery(Dont USE)'), 'variable');
  assert.equal(c.plClassOf('Gift - Under $25'), 'discretionary', 'the spacing around the hyphen no longer matters');
  assert.equal(c.plClassOf('70925 Staff Meal Expense  (賄い)'), 'variable');
  assert.equal(c.plClassOf('41200 Sales - State Tax（GET pass-on)'), 'other', 'a new account needs a decision');
  assert.equal(c.plClassOf('70510 Taxes - Liquor Commission'), 'other');
  // 画面で決めた区分（pl_expense_class）は前のそろえ方のキーでも効く
  const c2 = load({ pl_expense_class: { 'taxes - liquor commission': 'fixed', 'gift- under $25': 'variable' } });
  assert.equal(c2.plClassOf('70510 Taxes - Liquor Commission'), 'fixed');
  assert.equal(c2.plClassOf('Gift - Under $25'), 'variable');
});

test('④ a new month column before the Total column is read; the Total column, % columns and shifted columns are not misread', () => {
  const c = load();
  const months = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026'];
  const s = store(); const add = a => a.map(r => (r.group ? { group: r.group, items: add(r.items) } : [r[0], r[1].concat([r[1][0] == null ? null : Math.round((r[1][0] + 7) * 100) / 100])]));
  for (const k of Object.keys(s)) s[k] = add(s[k]);
  const prev = MONTHS.slice(); MONTHS.push('Apr 2026');
  try {
    const S = rowsOf(s);
    // 見出しの行をひとつ下げ、列を 1 つ右へ（左に空の列）
    const ws = sheetOf(S.R, { months, mut: (w, aoa) => {} });
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    aoa.splice(1, 0, ['Profit and Loss（暫定）']);
    const moved = aoa.map((r, i) => (i < 4 ? r : [r[0], null].concat(r.slice(1))));
    const r = c.parsePLWorkbook(book({ 'Marujuu': XLSX.utils.aoa_to_sheet(moved) }), { fileName: 'PL.xlsx' });
    same(r.issues, [], JSON.stringify(r.issues));
    same(r.months, ['2026-01', '2026-02', '2026-03', '2026-04']);
    const apr = r.rows.find(x => x.ym === '2026-04');
    assert.equal(apr.col, 'I', 'Apr CURRENT (A label, B empty, C/D Jan, E/F Feb, G/H Mar, I/J Apr, K Total)');
    assert.ok(near(apr.c.sales, S.keys.inc[3]));
    assert.equal(apr.prov, true, 'the title says 暫定: the last month is provisional');
    assert.equal(r.rows.find(x => x.ym === '2026-03').prov, false);
  } finally { MONTHS.length = 0; MONTHS.push(...prev); }
});

test('provisional months: the file name, the title, or a note on the month heading', () => {
  const c = load();
  const S = rowsOf(store());
  let r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'Funergy_Group_Inc__PL_Mar26_暫定_Manager.xlsx' });
  same(r.rows.map(x => x.prov), [false, false, true]);
  r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'Funergy_Group_Inc__PL_Mar26_Manager.xlsx' });
  same(r.rows.map(x => x.prov), [false, false, false]);
  const ws = sheetOf(S.R, { months: ['Jan 2026', 'Feb 2026 (暫定)', 'Mar 2026'] });
  r = c.parsePLWorkbook(book({ 'Marujuu': ws }), {});
  same(r.rows.map(x => x.prov), [false, true, false]);
});

test('LALA reads as LaLa (F06); months with no postings (before opening) are not imported as zero', () => {
  const c = load();
  const s = store();
  for (const k of Object.keys(s)) s[k] = s[k].map(r => (r.group ? { group: r.group, items: r.items.map(x => [x[0], [null, null, x[1][2]]]) } : [r[0], [null, null, r[1][2]]]));
  const r = c.parsePLWorkbook(book({ 'LALA': sheetOf(rowsOf(s).R) }), {});
  same(r.rows.map(x => [x.storeKey, x.ym, x.ok]), [['F06', '2026-03', true]], 'January and February have only 0 totals: no record');
  same(r.issues, []);
});

test('a subtotal inside a section that does not match its rows becomes one line with a warning; a key total that does not match refuses the month', () => {
  const c = load();
  const S = rowsOf(store());
  const R = S.R.map(x => x.slice());
  const g = R.findIndex(x => x[0] === 'Total for General Excise Tax (GET)');
  R[g + 0] = [R[g][0], R[g][1].map((v, i) => (i === 0 ? Math.round((v + 3) * 100) / 100 : v))];   // GET の小計だけ +3（上の行も +3：販管費の合計は小計を足す）
  const op = R.findIndex(x => x[0] === 'Total for 70000 2. Operating Expenses');
  const fix = (name, d) => { const i = R.findIndex(x => x[0] === name); R[i] = [name, R[i][1].map((v, k) => (k === 0 ? Math.round((v + d) * 100) / 100 : v))]; };
  fix('Total for 70000 2. Operating Expenses', 3); fix('Total for Expenses', 3); fix('Net Operating Income', -3); fix('Net Income', -3);
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
  const jan = r.rows[0];
  assert.equal(jan.ok, true, JSON.stringify(r.issues));
  const w = r.issues.find(i => i.lv === 'warn' && i.ym === '2026-01');
  assert.match(w.msg, /General Excise Tax \(GET\).*1 行/);
  const lump = jan.lines.filter(l => l.grp === 'General Excise Tax (GET)' || l.name === 'General Excise Tax (GET)');
  assert.equal(lump.length, 1); assert.ok(lump[0].lump);
  assert.ok(near(Object.values(jan.dets.detail).reduce((a, v) => a + v, 0), jan.c.opex), 'the details still add up to the total');
  assert.ok(op > 0);
  // 売上の合計行が明細と合わない → その月は取り込まない
  const R2 = S.R.map(x => x.slice()), ti = R2.findIndex(x => x[0] === 'Total for Income');
  R2[ti] = ['Total for Income', R2[ti][1].map((v, k) => (k === 1 ? v + 100 : v))];
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R2) }), {});
  same(r2.rows.map(x => x.ok), [true, false, true]);
  assert.ok(r2.issues.some(i => i.lv === 'fatal' && i.ym === '2026-02' && i.cell === 'Marujuu!D' + (ti + 7)));
});

test('formula errors and text in a value cell refuse that month; an unknown sheet and a doubled month column are reported', () => {
  const c = load();
  const S = rowsOf(store());
  const ni = S.R.findIndex(x => x[0] === 'Net Income');
  const ws = sheetOf(S.R, { mut: (w) => { w['F' + (ni + 7)] = { t: 'e', v: 7 }; } });   // 3 月の Net Income が #DIV/0!
  const fd = S.R.findIndex(x => x[0] === '40100 Sales - Food');
  const ws2 = sheetOf(S.R, { mut: (w) => { w['B' + (fd + 7)] = { t: 's', v: 'n/a' }; } });
  const r = c.parsePLWorkbook(book({ 'Marujuu': ws, 'Tenkichi': ws2, 'Summary': sheetOf(S.R) }), {});
  same(r.rows.filter(x => x.sheet === 'Marujuu').map(x => x.ok), [true, true, false]);
  same(r.rows.filter(x => x.sheet === 'Tenkichi').map(x => x.ok), [false, true, true]);
  assert.ok(r.issues.some(i => i.lv === 'fatal' && i.cell === 'Marujuu!F' + (ni + 7) && /数式エラー/.test(i.msg)));
  assert.ok(r.issues.some(i => i.lv === 'fatal' && i.cell === 'Tenkichi!B' + (fd + 7)));
  assert.ok(r.issues.some(i => i.sheet === 'Summary' && i.lv === 'warn'));
  const dup = sheetOf(S.R, { months: ['Jan 2026', 'Jan 2026', 'Mar 2026'] });
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': dup }), {});
  assert.equal(r2.rows.length, 0); assert.match(r2.issues[0].msg, /同じ月の列/);
});

test('a section that the reader does not know breaks the operating-income check and refuses the month (no silent drop)', () => {
  const c = load();
  const S = rowsOf(store());
  const R = S.R.slice(), at = R.findIndex(x => x[0] === 'Net Operating Income');
  // 経費の外（Expenses の合計の後ろ）に知らない区分を足し、営業利益だけそれを引いた値にする
  R.splice(at, 0, ['Special Items'], ['Closing Cost', n([500, null, null])], ['Total for Special Items', n([500, null, null])]);
  const i = R.findIndex(x => x[0] === 'Net Operating Income'); R[i] = ['Net Operating Income', R[i][1].map((v, k) => (k === 0 ? v - 500 : v))];
  const j = R.findIndex(x => x[0] === 'Net Income'); R[j] = ['Net Income', R[j][1].map((v, k) => (k === 0 ? v - 500 : v))];
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
  assert.equal(r.rows[0].ok, false);
  assert.ok(r.issues.some(x => x.lv === 'warn' && /区分「Special Items」が分かりません/.test(x.msg)));
  const f = r.issues.find(x => x.lv === 'fatal' && x.ym === '2026-01');
  assert.match(f.item, /Net Operating Income/); assert.ok(near(f.diff, -500));
  same(r.rows.slice(1).map(x => x.ok), [true, true]);
});

test('⑤ saving: the same store and month is replaced (no double points), refused months keep the earlier values, provisional months are marked', () => {
  const store0 = {
    pl_actual: { _src: { '2026-01': 'PL取込 2026/10/01' }, '2026-01': { F05: { sales: 1, cogs: 1, payroll: 1, opex: 1, netop: 1, netinc: 1, detail: { old: 1 }, detailOthInc: { stale: 5 } } },
      '2026-03': { F05: { sales: 7, cogs: 7, payroll: 7, opex: 7, netop: 7, netinc: 7 } } },
    pl_public: { '2026-03': { F05: { sales: 7, cogs: 7, payroll: 7, _at: 1 } } },
  };
  const c = load(store0);
  const S = rowsOf(store());
  const ni = S.R.findIndex(x => x[0] === 'Net Income');
  const ws = sheetOf(S.R, { mut: (w) => { w['F' + (ni + 7)] = { t: 'e', v: 7 }; } });   // 3 月は取り込まない
  c._plImport = c.parsePLWorkbook(book({ 'Marujuu': ws }), { fileName: 'PL_Mar26_暫定.xlsx' });
  vm.runInContext('_plImport = this._plImport', c);
  c.plImportSave();
  const a = c.store.pl_actual;
  assert.equal(Object.keys(a['2026-01']).length, 1);
  assert.ok(near(a['2026-01'].F05.c.sales, S.keys.inc[0]) && !a['2026-01'].F05.detail.old, 'replaced, not merged');
  assert.equal('detailOthInc' in a['2026-01'].F05, false, 'a field only the earlier import had is gone (January has no other income now)');
  same(a['2026-03'].F05, { sales: 7, cogs: 7, payroll: 7, opex: 7, netop: 7, netinc: 7 }, 'the refused month keeps the earlier import');
  same(c.store.pl_public['2026-03'].F05, { sales: 7, cogs: 7, payroll: 7, _at: 1 });
  assert.equal(a['2026-02'].F05.prov, false);
  assert.equal(a._src['2026-03'], undefined, 'the refused month is not stamped as imported');
  assert.match(a._src['2026-02'], /^PL取込 /);
  assert.ok(Array.isArray(a['2026-02'].F05.ln) && a['2026-02'].F05.ln.some(l => l[1] === '41200' && l[0] === 'exp' && l[3] === 'General Excise Tax (GET)'));
  assert.equal(a['2026-02'].F05.at, 'Marujuu!D');
  assert.ok(!('opex' in c.store.pl_public['2026-02'].F05) && !('netop' in c.store.pl_public['2026-02'].F05) && !('c' in c.store.pl_public['2026-02'].F05), 'no profit or cents in the shared copy');
  // 同じブックをもう一度：数は同じ・点は増えない
  c._plImport = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'PL_Mar26_暫定.xlsx' });
  vm.runInContext('_plImport = this._plImport', c); c.plImportSave();
  const b1 = JSON.stringify(c.store.pl_actual['2026-02'].F05.c);
  c._plImport = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'PL_Mar26_暫定.xlsx' });
  vm.runInContext('_plImport = this._plImport', c); c.plImportSave();
  assert.equal(JSON.stringify(c.store.pl_actual['2026-02'].F05.c), b1);
  assert.equal(c.store.pl_actual['2026-03'].F05.prov, true);
  assert.match(c.store.pl_actual._src['2026-03'], /（暫定）$/);
  // 確定版（ファイル名に 暫定 が無い）で 3 月が確定に変わる
  c._plImport = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'PL_Mar26.xlsx' });
  vm.runInContext('_plImport = this._plImport', c); c.plImportSave();
  assert.equal(c.store.pl_actual['2026-03'].F05.prov, false);
  assert.doesNotMatch(c.store.pl_actual._src['2026-03'], /暫定/);
});

test('the preview separates refused items (cell, expected, actual, difference, next step) from imported-but-check items, and escapes names', () => {
  const c = load();
  const S = rowsOf(store());
  const R = S.R.slice(), at = R.findIndex(x => x[0] === 'Total for 70000 2. Operating Expenses');
  R.splice(at, 0, ['70960 <b>Shipping</b>', n([45.5, null, null])]);
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R), 'Other <i>Sheet<i>': sheetOf(S.R) }), {});
  const h = c._plPreviewHtml(r);
  assert.match(h, /取り込まないもの（前に取り込んだ値はそのまま）/);
  assert.match(h, /Marujuu 2026-01：「70000 2\. Operating Expenses」の合計行と明細の合計が合いません（Marujuu!B\d+）/);
  assert.match(h, /期待 \$[\d,]+\.\d\d \/ 実際 \$[\d,]+\.\d\d \/ 差 -\$45\.50/);
  assert.match(h, /→ 元の PL の合計の数式/);
  assert.match(h, /確かめてください（取り込みはします）/);
  assert.match(h, /Other &lt;i&gt;Sheet&lt;i&gt;/);
  assert.doesNotMatch(h, /<i>Sheet<i>/);
  assert.match(h, /<b>2件<\/b> を取り込みます/);
});

test('a provisional month carries a flag in the shared copy (no profit) and the meeting badge says 暫定 until the final PL replaces it', () => {
  const c = load({});
  const S = rowsOf(store());
  const imp = (fileName) => { c._plImport = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName }); vm.runInContext('_plImport = this._plImport', c); c.plImportSave(); };
  imp('PL_Mar26_暫定.xlsx');
  same(c.store.pl_public['2026-03'].F05, { sales: Math.round(S.keys.inc[2]), cogs: Math.round(S.keys.cogs[2]), payroll: Math.round(S.keys.pay[2]), _at: c.store.pl_public['2026-03'].F05._at, prov: 1 });
  assert.equal('prov' in c.store.pl_public['2026-02'].F05, false);
  vm.runInContext(['_meetPlProv', '_meetConfirmSrc', '_meetConfirmBadge'].map(fnSrc).join('\n') + '\nfunction _meetConfirmState(){ return "final"; }', c);
  assert.match(c._meetConfirmBadge('F05', '2026-03', true), />暫定<\/span>$/);
  assert.match(c._meetConfirmBadge('F05', '2026-02', true), />確定<\/span>$/);
  imp('PL_Mar26.xlsx');
  assert.equal('prov' in c.store.pl_public['2026-03'].F05, false);
  assert.match(c._meetConfirmBadge('F05', '2026-03', true), />確定<\/span>$/);
  // 共有の写しに利益・セント・科目は入らない
  for (const ym of ['2026-01', '2026-02', '2026-03']) assert.deepEqual(Object.keys(c.store.pl_public[ym].F05).filter(k => !['sales', 'cogs', 'payroll', '_at', 'prov'].includes(k)), []);
});

test('the mid-review and the KPI tab say 暫定 for a provisional PL month (numbers and judgements are the same as a final month)', () => {
  const c = load({});
  const S = rowsOf(store());
  c._plImport = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'PL_Mar26_暫定.xlsx' }); vm.runInContext('_plImport = this._plImport', c); c.plImportSave();
  vm.runInContext(['_meetPlProv', 'mrPrevProv'].map(fnSrc).join('\n'), c);
  const ctx = sid => ({ R: { store: { store_id: sid }, ym: '2026-04' } });
  assert.equal(c.mrPrevProv(ctx('F05'), '2026-03'), true);
  assert.equal(c.mrPrevProv(ctx('F05'), '2026-02'), false);
  assert.equal(c.mrPrevProv(ctx('F01'), '2026-03'), false);
  assert.equal(c.mrPrevProv({}, '2026-03'), false);
  // 4 か所の表示と KPI 管理の 1 か所が mrPrevProv／_meetPlProv を通る（状態の値は final のまま＝サーバーの提出版の形は変えない）
  for (const re of [/var st = p\.state === 'final' \? \(mrPrevProv\(ctx, p\.ym\)/, /var stc = p\.state === 'final' \? '<span class="mr-chip mr-c-ok">'\+\(mrPrevProv\(ctx, ym\)/,
    /state === 'final' \? \(mrPrevProv\(ctx, mrObj\(sn\.prev\)\.ym\)/, /p\.state === 'final' \? \(mrPrevProv\(ctx, p\.ym\) \? '会計 PL（暫定）'/,
    /conf==='final' && typeof _meetPlProv==='function' && _meetPlProv\(sid, ym\)\) \? t\('暫定（会計 PL）'/]) assert.match(html, re);
  assert.match(html, /var state = cs === 'final' \? 'final'/);
});

test('percent-formatted cells right under the heading are not mistaken for sub-headings; without a CURRENT label the left column of the month is used', () => {
  const c = load();
  const S = rowsOf(store());
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), {});
  const ws = book({ 'Marujuu': sheetOf(S.R) }).Sheets['Marujuu'];
  assert.match(String(ws['C8'].w), /%$/, 'the % column shows a percent text in the synthetic sheet');
  assert.deepEqual(r.issues.length, 0);
  assert.ok(near(r.rows[0].c.sales, S.keys.inc[0]));
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R, { subLabels: false }) }), {});
  assert.deepEqual(r2.issues.length, 0, JSON.stringify(r2.issues));
  same(r2.rows.map(x => x.col), ['B', 'D', 'F']);
  assert.ok(near(r2.rows[2].c.netinc, S.keys.ni[2]));
});

test('gross profit, net other income and net income that do not follow from the sections refuse the month', () => {
  const c = load();
  const S = rowsOf(store());
  for (const [lab, idx] of [['Gross Profit', 0], ['Net Other Income', 1], ['Net Income', 2]]) {
    const R = S.R.map(x => x.slice()), k = R.findIndex(x => x[0] === lab);
    R[k] = [lab, R[k][1].map((v, i) => (i === idx ? Math.round((v + 10) * 100) / 100 : v))];
    const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
    same(r.rows.map(x => x.ok), [0, 1, 2].map(i => i !== idx), lab);
    const f = r.issues.find(x => x.lv === 'fatal');
    assert.equal(f.cell, 'Marujuu!' + 'BDF'[idx] + (k + 7), lab);
    assert.ok(near(f.diff, 10), lab + ' ' + f.diff);
  }
});

test('the amount column is the one labelled CURRENT (a budget column on its left is not read); a % column on the left of an unlabelled amount column is skipped', () => {
  const c = load();
  const S = rowsOf(store());
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R, { cols: ['B', 'C', 'P'] }) }), {});
  assert.deepEqual(r.issues.length, 0, JSON.stringify(r.issues));
  same(r.rows.map(x => x.col), ['C', 'F', 'I']);
  r.rows.forEach((x, i) => assert.ok(near(x.c.netinc, S.keys.ni[i]) && near(x.c.sales, S.keys.inc[i])));
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R, { cols: ['P', 'C'], noCurLabel: true }) }), {});
  assert.deepEqual(r2.issues.length, 0, JSON.stringify(r2.issues));
  same(r2.rows.map(x => x.col), ['C', 'E', 'G']);
  r2.rows.forEach((x, i) => assert.ok(near(x.c.netinc, S.keys.ni[i])));
});

// #156 の Codex（6879068684・6879547415）の P2：前の名前に人が決めた区分は、新しい名前にも引き継ぐ（新しい名前に決めた区分が先）
test('#156 a class a person set on the earlier name follows the renamed account; a class set on the new name wins', () => {
  const pairs = [['Taxes - General Excise Tax', '70500 Taxes - General Excise', 'fixed', 'variable'],
    ['Taxes and Licenses', 'Taxes, Licenses & Fees', 'discretionary', 'fixed'],
    ['Freight / Delivery', '70991 Freight / Delivery(Dont USE)', 'utility', 'variable']];
  for (const [oldName, newName, set, dflt] of pairs) {
    assert.equal(load().plClassOf(newName), dflt, 'the default first');
    const c = load({ pl_expense_class: { [oldName.toLowerCase()]: set } });
    assert.equal(c.plClassOf(oldName), set);
    assert.equal(c.plClassOf(newName), set, newName + ' takes the earlier name’s class');
    const t2 = c.plClassTotals({ [newName.replace(/^\d+ /, '')]: 100 });
    assert.equal(t2[set], 100, 'the totals follow');
    const both = load({ pl_expense_class: { [oldName.toLowerCase()]: set, [newName.replace(/^\d+ /, '').toLowerCase()]: 'other' } });
    assert.equal(both.plClassOf(newName), 'other', 'a class set on the new name wins');
  }
});

// #156 の Codex：末尾に空の月の列があっても、暫定の印は金額のある最後の月。その月が検算エラーでも前の月に印を移さない
test('#156 provisional with a blank month column at the end: the last month with amounts is provisional; a refused last month keeps the mark to itself', () => {
  const c = load();
  const s = store();
  for (const k of Object.keys(s)) s[k] = s[k].map(r => (r.group ? { group: r.group, items: r.items.map(x => [x[0], [x[1][0], x[1][1], null]]) } : [r[0], [r[1][0], r[1][1], null]]));
  const S = rowsOf(s);
  let r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R) }), { fileName: 'PL_Feb26_暫定.xlsx' });
  same(r.rows.map(x => [x.ym, x.ok, x.prov]), [['2026-01', true, false], ['2026-02', true, true]]);
  // タイトルの「暫定」でも同じ
  r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(S.R, { title: 'Marujuu - PL 暫定' }) }), {});
  same(r.rows.map(x => x.prov), [false, true]);
  // 2 月（金額のある最後の月）が検算エラー：2 月は取り込まない・1 月に印を移さない
  const R = S.R.map(x => x.slice()), k = R.findIndex(x => x[0] === 'Gross Profit');
  R[k] = ['Gross Profit', R[k][1].map((v, i) => (i === 1 ? Math.round((v + 10) * 100) / 100 : v))];
  r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), { fileName: 'PL_Feb26_暫定.xlsx' });
  same(r.rows.map(x => [x.ym, x.ok, x.prov]), [['2026-01', true, false], ['2026-02', false, true]]);
});

// #156 の Codex：計算の行（粗利益・営業外損益）がブックにあるのに、その月のセルが空なら取り込まない（行そのものが無い前の形は今までどおり）
test('#156 a gross profit or net other income cell left empty refuses that month; a book without the row still reads', () => {
  const c = load();
  const S = rowsOf(store());
  for (const lab of ['Gross Profit', 'Net Other Income', 'Net Income', 'Net Operating Income']) {
    const R = S.R.map(x => x.slice()), k = R.findIndex(x => x[0] === lab);
    R[k] = [lab, R[k][1].map((v, i) => (i === 1 ? null : v))];
    const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R) }), {});
    same(r.rows.map(x => x.ok), [true, false, true], lab);
    const f = r.issues.find(x => x.lv === 'fatal' && x.ym === '2026-02');
    assert.match(f.msg, /のセルが空です/, lab);
    assert.equal(f.cell, 'Marujuu!D' + (k + 7), lab);
  }
  // 行そのものが無い（前の形）：粗利益・営業外損益は計算した値で補う
  const R2 = S.R.filter(x => x[0] !== 'Gross Profit' && x[0] !== 'Net Other Income');
  const r2 = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R2) }), {});
  same(r2.rows.map(x => x.ok), [true, true, true]);
  assert.ok(near(r2.rows[0].c.gp, S.keys.gp[0]));
});

// #156 の Codex：検算の文は英語の画面では英語
test('#156 the import messages follow the language (English screen)', () => {
  const c = load();
  c.t = (ja, en) => en;
  const S = rowsOf(store());
  const R = S.R.map(x => x.slice()), k = R.findIndex(x => x[0] === 'Gross Profit');
  R[k] = ['Gross Profit', R[k][1].map((v, i) => (i === 0 ? Math.round((v + 10) * 100) / 100 : v))];
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(R), 'Nowhere': sheetOf(S.R) }), {});
  const f = r.issues.find(x => x.lv === 'fatal');
  assert.equal(f.item, 'Gross Profit'); assert.match(f.msg, /^Gross Profit does not equal Sales − COGS$/);
  assert.ok(r.warnings.some(w => /^Sheet "Nowhere" is not imported/.test(w)), JSON.stringify(r.warnings));
  assert.ok(r.warnings.every(w => !/[ぁ-んァ-ヶ一-龥]/.test(w.replace(/：/g, ''))), JSON.stringify(r.warnings));
  const html = c._plPreviewHtml(r);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /合いません|見つかりません|取り込みません/);
});

// 暫定の月はブック全体で決める：その月の金額が無い店（例：合算の店）の前の月に印を付けない
test('#156 the provisional month is decided for the whole book: a store with no amounts in it keeps its earlier months final', () => {
  const c = load();
  const full = rowsOf(store());
  const s = store(2);
  for (const k of Object.keys(s)) s[k] = s[k].map(r => (r.group ? { group: r.group, items: r.items.map(x => [x[0], [x[1][0], x[1][1], null]]) } : [r[0], [r[1][0], r[1][1], null]]));
  const r = c.parsePLWorkbook(book({ 'Marujuu': sheetOf(full.R), 'LALA': sheetOf(rowsOf(s).R) }), { fileName: 'PL_Mar26_暫定.xlsx' });
  same(r.rows.map(x => [x.storeKey, x.ym, x.prov]), [['F05', '2026-01', false], ['F05', '2026-02', false], ['F05', '2026-03', true], ['F06', '2026-01', false], ['F06', '2026-02', false]]);
});
