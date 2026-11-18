// v1188（UI案76・Moto さん 11/17「全部A」）：管理者セキュアページ › 会計 PL の月別推移・取り込みの前の差分・要分類の科目を決める。
//   1A 上の 3 つ（売上・営業利益＝Net Operating Income・最終利益＝Net Income）／3A 前の月との差（額と ％）／4A 暫定の月／
//   5A 取り込んだ月をすべて／6A 保存する前の差分（変わる額の大きい順）／7A 決めるのは GM・CEO・経理／
//   8A 決めた区分は全部の端末で共有（区分と科目名だけ・金額とメールは入れない）／9A 3 科目の初期の区分。
// 本物の関数（index.html）を VM で動かす。合成データだけ（本番の PL の数は使わない）。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function grab(re, src) {
  const m = re.exec(src);
  if (!m) return null;
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
      if (depth === 0) { let j = i + 1; if (src[j] === ';') j++; return src.slice(m.index, j); }
    }
  }
  throw new Error('unterminated');
}
function fnSrc(name, src = SRC) {
  const s = grab(new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm'), src);
  if (!s) throw new Error('function not found: ' + name);
  return s;
}
function varSrc(name, src = SRC) {
  const s = grab(new RegExp('^var ' + name + ' = \\{', 'm'), src);
  if (!s) throw new Error('var not found: ' + name);
  return s;
}
const run = (c, code) => vm.runInContext(code, c);
const plain = v => JSON.parse(JSON.stringify(v));

const VARS = ['PL_EXPENSE_CLASS_DEFAULT', 'PL_EXPENSE_CLASS_ALIAS', 'PL_CLASS_LABEL'];
const FNS = ['plNormText', 'plNormKey', 'plSplitCode', 'plNormAccount', 'getPlExpenseClass', '_plClsMaps', 'plClassOf', 'plClassTotals',
  'mergeMapByTime', '_recAt', 'plMoney', 'plNum', 'plYmSeq', 'plYmLabel', 'plTrendMonths', 'plTrendSel', 'plTrendRow', 'plDiff', 'plRate', 'plProvTag',
  'plScopeName', 'plTilesHtml', 'plWaterfallHtml', 'plTrendTableHtml', 'plClsCanEdit', 'plClsWho', 'plClsKey', 'plClsCurAt', '_plClsMapsOf', 'plClsBuild', 'plClsCasSave', 'plClsSave',
  'plUnknownAccounts', '_plDiffPair', '_plImportDiff', '_plImportDiffHtml', '_tsMicro', '_casTs', '_fetchOpRow', '_opCasWrite'];

/* #189 の Codex（6964022211）：クラウドの app_state の 1 行を PostgREST の決まりで（GET・読んだ updated_at が同じときだけ PATCH・無ければ POST、あれば 409）。
   2 台の端末が同じ CLOUD を使う。hook：書く直前に 1 回だけ（ほかの端末の保存をはさむ）。fail：その頼みを 500 に。 */
function newCloud(value) {
  return { row: value === undefined ? null : { value: JSON.parse(JSON.stringify(value)), updated_at: '2026-11-17T10:00:00.000001+00:00' }, gets: 0, writes: 0, fail: {}, hook: null };
}
function cloudFetch(CL) {
  return async (url, opt = {}) => {
    const u = new URL(url), method = opt.method || 'GET';
    const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
    if (u.searchParams.get('key') !== 'eq.pl_expense_class' && method !== 'POST') return res(200, []);
    if (method === 'GET') { CL.gets++; if (CL.fail.get) return res(500, {}); return res(200, CL.row ? [{ value: CL.row.value, updated_at: CL.row.updated_at }] : []); }
    if (CL.hook) { const h = CL.hook; CL.hook = null; await h(); }
    if (CL.fail.write) return res(500, {});
    const body = JSON.parse(opt.body);
    if (method === 'PATCH') {
      const cond = u.searchParams.get('updated_at');
      if (!CL.row || cond !== 'eq.' + CL.row.updated_at) return res(200, []);
      CL.row = { value: body.value, updated_at: body.updated_at }; CL.writes++;
      return res(200, [{ key: 'pl_expense_class', updated_at: CL.row.updated_at }]);
    }
    if (method === 'POST') {
      if (body.key !== 'pl_expense_class') return res(400, {});
      if (CL.row) return res(409, {});
      CL.row = { value: body.value, updated_at: body.updated_at }; CL.writes++;
      return res(201, [{ key: 'pl_expense_class' }]);
    }
    return res(400, {});
  };
}

function world({ act = null, cls = undefined, role = 'gm', session = undefined, emps = [], online = true, sync = true, src = SRC, cloud = null } = {}) {
  const LS = {};
  if (act) LS.pl_actual = act;
  if (cls !== undefined) LS.pl_expense_class = cls;
  const CL = cloud || newCloud(cls);
  const c = { console, JSON, Math, Object, Array, String, Number, RegExp, Date, Promise, isFinite, parseInt, URL, AbortController, LS, TOASTS: [], EMPS: emps, CL, fetch: cloudFetch(CL), LSREADS: 0 };
  c.window = c;
  c.navigator = { onLine: online };
  if (session !== undefined) c._authSession = session;
  vm.createContext(c);
  run(c, `
    var curRole=${JSON.stringify(role)}, curUserName='', curLang='ja', SUPA_SYNC_ENABLED=${sync ? 'true' : 'false'};
    var _plTrendScope='ALL', _plTrendYm=null, _plTrendMode='amt', _plTrendOpexOpen=true, _plClsCache=null;
    var PL_BAR_BLUE='#2563eb', PL_BAR_HATCH='hatch', PL_POS='#0f7a4d', PL_NEG='#c62828';
    function t(ja){ return ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(ch){ return '&#'+ch.charCodeAt(0)+';'; }); }
    function ls(k, d){ if (k === 'pl_expense_class') LSREADS++; return Object.prototype.hasOwnProperty.call(LS, k) ? JSON.parse(JSON.stringify(LS[k])) : d; }
    var _RAW = {};
    function _lsStoreGet(k){ if (!Object.prototype.hasOwnProperty.call(LS, k)) return null; var j = JSON.stringify(LS[k]); if (_RAW[k] !== j) _RAW[k] = j; return _RAW[k]; }
    function lsSet(){ throw new Error('区分の保存は lsSet（端末に書いてあとで送る）を使わない'); }
    function _opMergeDef(k){ return k === 'pl_expense_class' ? { merge: mergeMapByTime, cas: true } : null; }
    function _opWriteBack(k, def, v){ LS[k] = JSON.parse(JSON.stringify(v)); return v; }
    function _lsMarkFetched(){}
    var SUPABASE_URL = 'https://x.supabase.co';
    function supaHeaders(){ return { apikey: 'anon' }; }
    function clearTimeout(){}
    function getPlActual(){ return ls('pl_actual', {}) || {}; }
    function plScopeLabel(k){ return ({ F01:'ToriTon', F02:'Tenkichi', F06:'LaLa' })[k] || k; }
    function _plStoreLabel(k){ return plScopeLabel(k); }
    function getEmployees(){ return EMPS; }
    function showToast(m, kind){ TOASTS.push([kind, m]); }
    function setTimeout(fn, ms){ if ((Number(ms)||0) < 1000) Promise.resolve().then(fn); return 0; }   /* 15 秒の打ち切りは起こさない */
    function _plKeepsFinal(){ return false; }
  `);
  VARS.forEach(n => run(c, varSrc(n, src)));
  FNS.forEach(n => run(c, fnSrc(n, src)));
  return c;
}

/* 合成の PL：2 店（F01・F02）。7 月・9 月・10 月（暫定）。8 月はどの店も無い（欠けた月）。
   F02 の 9 月は Net Income が無い（前の版の取り込み）。10 月は F06 が増える。 */
function rec(o) {
  const sales = o.sales, cogs = o.cogs, payroll = o.payroll, opex = o.opex, netop = sales - cogs - payroll - opex;
  const out = { sales, cogs, payroll, opex, netop, ln: 'x' };
  if (o.ni !== undefined) out.netinc = o.ni;
  if (o.othInc !== undefined) out.c = { sales, cogs, payroll, opex, netop, othInc: o.othInc, othExp: o.othInc + netop - (o.ni ?? 0), netinc: o.ni };
  if (o.detail) out.detail = o.detail;
  if (o.detailOth) out.detailOth = o.detailOth;
  if (o.prov) out.prov = true;
  return out;
}
const ACT = {
  '2026-07': {
    F01: rec({ sales: 100000, cogs: 30000, payroll: 30000, opex: 20000, othInc: 500.4, ni: 15000,
      detail: { 'Rent - Store': 8000, 'Utilities - Electricity': 2000, 'Merchant Account Fees': 3000, 'Sales - State Tax (GET Pass-On)': 4000, 'Mystery Fee': 3000 },
      detailOth: { 'Head Office Expenses': 4000, 'Depreciation': 1300, 'Interest Expense': 200 } }),
    F02: rec({ sales: 50000, cogs: 15000, payroll: 20000, opex: 10000, othInc: 0, ni: 4000,
      detail: { 'Rent - Store': 6000, 'Taxes - Liquor Commission': 1000, 'Travel - Hotel & Transportation': 3000 },
      detailOth: { 'Head Office Expenses': 1000 } })
  },
  '2026-09': {
    F01: rec({ sales: 110000, cogs: 33000, payroll: 31000, opex: 21000, othInc: 400, ni: 20000,
      detail: { 'Rent - Store': 8000, 'Utilities - Electricity': 2200, 'Merchant Account Fees': 3300, 'Sales - State Tax (GET Pass-On)': 4400, '70990 Mystery Fee': 3100 },
      detailOth: { 'Head Office Expenses': 4400, 'Depreciation': 1000, 'Interest Expense': 0 } }),
    F02: rec({ sales: 40000, cogs: 14000, payroll: 20000, opex: 9000 })     /* Net Income も c も無い（前の版の取り込み） */
  },
  '2026-10': {
    F01: rec({ sales: 90000, cogs: 28000, payroll: 30000, opex: 20000, othInc: 300, ni: 9000, prov: true,
      detail: { 'Rent - Store': 8000, 'Utilities - Electricity': 2000, 'Merchant Account Fees': 2700, 'Sales - State Tax (GET Pass-On)': 3600, 'Mystery Fee': 3700 },
      detailOth: { 'Head Office Expenses': 3500, 'Depreciation': 1000 } }),
    F06: rec({ sales: 20000, cogs: 7000, payroll: 9000, opex: 6000, othInc: 0, ni: -2500, prov: true,
      detail: { 'Rent - Store': 6000 }, detailOth: { 'Head Office Expenses': 500 } })
  }
};

test('9A：3 つの科目に初期の区分（番号付きの名前・書き方のゆれも）', () => {
  const c = world();
  assert.equal(c.plClassOf('41200 Sales - State Tax (GET Pass-On)'), 'variable');
  assert.equal(c.plClassOf('sales-state tax (get pass-on)'), 'variable');
  assert.equal(c.plClassOf('70510 Taxes - Liquor Commission'), 'fixed');
  assert.equal(c.plClassOf('70980 Travel - Hotel & Transportation'), 'discretionary');
  assert.equal(c.plClassOf('Mystery Fee'), 'other');
});

test('8A：決めた区分の形（記録）と前の形（文字）を読む・新しい記録が勝つ・消した印と変な区分は使わない', () => {
  const c = world({ cls: {
    'mystery fee': { c: 'fixed', name: 'Mystery Fee', _at: 100 },
    'Mystery Fee': 'utility',                                       /* 前の形：記録の形が先 */
    'MYSTERY  FEE': { c: 'discretionary', name: 'Mystery Fee', _at: 50 },   /* 古い記録 */
    'rent - store': { c: 'variable', _at: 999, _deleted: true },    /* 消した印は使わない（初期の固定費のまま） */
    'utilities - electricity': { c: 'nonsense', _at: 999 },         /* 区分でない値は使わない */
    'merchant account fees': 'fixed'                                /* 前の形だけ：使う */
  } });
  assert.equal(c.plClassOf('Mystery Fee'), 'fixed');
  assert.equal(c.plClassOf('Rent - Store'), 'fixed');
  assert.equal(c.plClassOf('Utilities - Electricity'), 'utility');
  assert.equal(c.plClassOf('Merchant Account Fees'), 'fixed');
  // 合流（mergeMapByTime）：同じ科目は _at の新しい記録・前の形（_at なし）より記録
  const m = plain(c.mergeMapByTime({ 'mystery fee': { c: 'fixed', _at: 10 }, 'old': 'variable' },
    { 'mystery fee': { c: 'utility', _at: 20 }, 'old': { c: 'fixed', _at: 5 } }));
  assert.equal(m['mystery fee'].c, 'utility');
  assert.equal(m.old.c, 'fixed');
});

test('同期の登録：pl_expense_class は全部の端末で共有（cas）・容量の整理で消さない', () => {
  assert.match(SRC, /'pl_overrides','pl_expense_class'/);
  assert.match(SRC, /pl_expense_class:\s*\{\s*merge:\s*mergeMapByTime,\s*covers:\s*_coversMapByTime,\s*cas:\s*true\s*\}/);
  const nf = /var LS_NEVER_FREE = \[([\s\S]*?)\];/.exec(SRC);
  assert.ok(nf && /'pl_expense_class'/.test(nf[1]), 'LS_NEVER_FREE');
  // pl_actual（営業利益・経費）は今までどおりこの端末だけ
  assert.doesNotMatch(SRC, /'pl_actual'\s*,\s*'pl_expense_class'/);
});

test('月ごとの数：欠けた月は missing・Net Income が無い店があれば最終利益は null・足し算が合う', () => {
  const c = world({ act: ACT });
  const rows = plain(c.plTrendMonths('ALL'));
  assert.deepEqual(rows.map(r => r.ym), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(rows[1].missing, true);
  assert.equal(rows[0].sales, 150000);
  assert.equal(rows[0].netop, 20000 + 5000);
  assert.equal(rows[0].netinc, 19000);
  // 営業利益 ＋ その他の収入 − その他の費用 ＝ 最終利益（丸めの差を残さない）
  for (const r of rows.filter(r => !r.missing && r.netinc != null && r.othInc != null)) {
    assert.equal(r.netop + r.othInc - r.othExp, r.netinc, r.ym);
  }
  assert.equal(rows[2].netinc, null, '9 月は F02 に Net Income が無い');
  assert.equal(rows[2].othInc, null);
  assert.equal(rows[3].prov, true);
  // 本部費・減価償却・ほか
  assert.equal(rows[0].hq, 5000); assert.equal(rows[0].dep, 1300); assert.equal(rows[0].othRest, 200);
  // 区分の合計＝販管費（明細がある月）
  const r0 = rows[0];
  assert.equal(r0.variable + r0.utility + r0.fixed + r0.discretionary + r0.other, r0.opex);
  assert.equal(r0.variable, 4000 + 3000);        /* GET 上乗せ（9A）＋ Merchant Account Fees */
  assert.equal(r0.fixed, 8000 + 6000 + 1000);   /* Rent ＋ 酒類の手数料（9A） */
  assert.equal(r0.discretionary, 3000);          /* 出張（9A） */
  assert.deepEqual(Object.keys(r0.unknown), ['Mystery Fee']);
  // 1 店だけ
  const f02 = plain(c.plTrendMonths('F02'));
  assert.equal(f02[3].missing, true);
  assert.equal(f02[2].hasDetail, false, '9 月の F02 は明細が無い');
});

test('3A：前の月との差（額と ％）・前の月が無いと「—」・0 からは ％ を出さない', () => {
  const c = world();
  assert.equal(c.plDiff(110000, 100000).txt, '+$10,000（+10%）');
  assert.equal(c.plDiff(9000, 20000).txt, '−$11,000（−55%）');
  assert.equal(c.plDiff(9000, 20000).col, '#c62828');
  assert.equal(c.plDiff(-2500, -5000).txt, '+$2,500（+50%）');
  assert.equal(c.plDiff(500, 0).txt, '+$500');
  assert.equal(c.plDiff(100, 100).txt, '±$0（±0%）');
  assert.equal(c.plDiff(100, null).none, true);
  assert.equal(c.plDiff(null, 100).none, true);
  assert.equal(c.plRate(9000, 90000), '10%');
  assert.equal(c.plRate(null, 90000), '—');
  assert.equal(c.plRate(5, 0), '—');
});

test('1A・4A：上の 3 つ（暫定の印・店の数の違い・最終利益が無い月）', () => {
  const c = world({ act: ACT });
  const rows = c.plTrendMonths('ALL');
  assert.equal(c.plTrendSel(rows), '2026-10', '初めは数のある最後の月');
  const h = c.plTilesHtml(rows, '2026-10');
  assert.match(h, /営業利益（Net Operating Income）/);
  assert.match(h, /最終利益（Net Income）/);
  assert.match(h, /暫定/);
  assert.match(h, /店の数が違います/);   /* 9 月 F01・F02 → 10 月 F01・F06 */
  assert.match(h, /F06|LaLa/);
  assert.match(h, /前の月の数がありません|—/);   /* 9 月の最終利益は null */
  const h9 = c.plTilesHtml(rows, '2026-09');
  assert.match(h9, /Net Income が取り込まれていません/);
  // 欠けた 8 月の次（9 月）は「前の月の数がありません」
  assert.match(h9, /前の月の数がありません/);
  // 選んだ月が無ければ最後の月
  c._plTrendYm = '2026-08';
  assert.equal(c.plTrendSel(rows), '2026-10');
  c._plTrendYm = '2026-07';
  assert.equal(c.plTrendSel(rows), '2026-07');
});

test('営業利益 → 最終利益の図・表（最終利益が無い月・その他の内訳が無い月・％）', () => {
  const c = world({ act: ACT });
  const rows = plain(c.plTrendMonths('ALL'));
  const w = c.plWaterfallHtml(rows[0]);
  assert.match(w, /その他の収入/); assert.match(w, /その他の費用/);
  assert.match(w, /本部費/); assert.match(w, /減価償却/);
  assert.match(c.plWaterfallHtml(rows[2]), /Net Income（最終利益）が取り込まれていません/);
  assert.equal(c.plWaterfallHtml(rows[1]), '');
  // 収入・費用が分からない月（c が無い）は 1 本にまとめる
  const f02 = plain(c.plTrendMonths('F02'));
  const x = Object.assign({}, rows[0], { othKnown: false, othInc: null, othExp: null });
  assert.match(c.plWaterfallHtml(x), /± その他（収入 − 費用）/);
  const tb = c.plTrendTableHtml(rows, '2026-10', ['mystery fee']);
  assert.match(tb, /最終利益率/);
  assert.match(tb, /1 科目・決める/);       /* GM は決められる */
  assert.equal((tb.match(/<th scope="col"/g) || []).length, 1 + rows.length);
  // ％ の表示
  c._plTrendMode = 'pct';
  assert.match(c.plTrendTableHtml(rows, '2026-10', []), />30%</);   /* 7 月の原価 45,000 ÷ 150,000 */
  // 決められない人には「決める」を出さない
  const s = world({ act: ACT, role: 'am' });
  assert.doesNotMatch(s.plTrendTableHtml(plain(s.plTrendMonths('ALL')), '2026-10', ['mystery fee']), /決める/);
  assert.ok(f02.length);
});

test('7A：決められるのは GM・CEO・経理（メールのログインの役割が先）', () => {
  for (const r of ['ceo', 'gm', 'office']) assert.equal(world({ role: 'sl', session: { role: r } }).plClsCanEdit(), true, r);
  for (const r of ['am', 'sl', 'crew', 'office_crew', '']) assert.equal(world({ role: 'sl', session: { role: r } }).plClsCanEdit(), false, r);
  assert.equal(world({ role: 'gm' }).plClsCanEdit(), true);
  assert.equal(world({ role: 'am' }).plClsCanEdit(), false);
});

test('要分類の科目の一覧（番号を外して名前でまとめる・額の大きい順）', () => {
  const c = world({ act: ACT });
  const u = plain(c.plUnknownAccounts());
  assert.equal(u.length, 1);
  assert.equal(u[0].key, 'mystery fee');
  assert.equal(u[0].name, 'Mystery Fee');
  assert.equal(u[0].total, 3000 + 3100 + 3700);
  assert.equal(u[0].last, '2026-10'); assert.equal(u[0].lastAmt, 3700);
  assert.deepEqual(Object.keys(u[0].stores), ['F01']);
});

const MF = { 'mystery fee': { c: 'fixed', name: 'Mystery Fee' } };

test('8A：区分の記録（だれ・いつ・前の区分・記録 10 件まで・メールと金額は入れない）', () => {
  const c = world({ act: ACT, session: { role: 'gm', email: 'someone@example.invalid', emp_id: 'E7' }, emps: [{ id: 'E7', name: 'Test GM' }] });
  const r = plain(c.plClsBuild({}, { 'mystery fee': { c: 'fixed', name: '70990 Mystery Fee' } }, { 'mystery fee': 0 }));
  assert.equal(r.n, 1); assert.deepEqual(r.conflict, []);
  const v = r.map['mystery fee'];
  assert.equal(v.c, 'fixed'); assert.equal(v.name, 'Mystery Fee'); assert.equal(v.prev, 'other'); assert.equal(v.by, 'Test GM');
  assert.equal(v.hist.length, 1);
  assert.ok(v._at > 0);
  const txt = JSON.stringify(r.map);
  assert.doesNotMatch(txt, /@/, 'メールは入れない');
  assert.doesNotMatch(txt, /3700|3100|3000/, '金額は入れない');
  // 同じ区分にするだけなら何も書かない（前の区分は渡した表から決める）
  let map = r.map;
  const at0 = v._at;
  assert.equal(c.plClsBuild(map, MF, { 'mystery fee': at0 }).n, 0);
  // 記録は 10 件まで・_at は前より必ず大きい
  let seen = at0;
  for (let i = 0; i < 12; i++) {
    const to = i % 2 ? 'fixed' : 'utility';
    const b = c.plClsBuild(map, { 'mystery fee': { c: to, name: 'Mystery Fee' } }, { 'mystery fee': seen });
    assert.equal(b.n, 1);
    map = b.map;
    const nv = map['mystery fee'];
    assert.ok(nv._at > seen); seen = nv._at;
    assert.equal(nv.prev, i % 2 ? 'utility' : 'fixed');
  }
  assert.equal(map['mystery fee'].hist.length, 10);
  // 「未分類」には戻せない（区分を選ぶ画面に無い）・区分でない値は書かない
  assert.equal(c.plClsBuild(map, { 'mystery fee': { c: 'other', name: 'Mystery Fee' } }, { 'mystery fee': seen }).n, 0);
  assert.equal(c.plClsBuild(map, { 'mystery fee': { c: 'bogus', name: 'Mystery Fee' } }, { 'mystery fee': seen }).n, 0);
});

test('8A：ほかの端末が先に決めた科目は上書きしない（開いたときの _at と比べる）・渡した表は変えない', () => {
  const c = world({ act: ACT });
  const base = { 'mystery fee': { c: 'utility', name: 'Mystery Fee', _at: 500 } };
  const r = plain(c.plClsBuild(base, Object.assign({ 'rent - store': { c: 'variable', name: 'Rent - Store' } }, MF), { 'mystery fee': 0, 'rent - store': 0 }));
  assert.deepEqual(r.conflict, ['Mystery Fee']);
  assert.equal(r.n, 1);
  assert.equal(r.map['mystery fee'].c, 'utility');
  assert.equal(r.map['mystery fee']._at, 500);
  assert.equal(r.map['rent - store'].c, 'variable');
  assert.equal(r.map['rent - store'].prev, 'fixed');
  assert.equal(base['rent - store'], undefined, '渡した表は変えない');
});

test('保存の道：クラウドに書けてから「保存しました」・オフラインや読めないときは保存しない・決められない人は保存しない', async () => {
  const seen = { 'mystery fee': 0 };
  // ぶつからない → クラウドに書いて、端末にも置いて、after
  let after = 0;
  const b = world({ act: ACT });
  assert.equal(await b.plClsSave(MF, seen, () => { after++; }), true);
  assert.equal(b.CL.row.value['mystery fee'].c, 'fixed');
  assert.equal(b.LS.pl_expense_class['mystery fee'].c, 'fixed');
  assert.equal(b.plClassOf('Mystery Fee'), 'fixed', '保存したらすぐに使う');
  assert.equal(after, 1);
  assert.equal(b._plClsBusy, 0);
  assert.ok(b.TOASTS.some(x => x[0] === 'success' && /全部の端末で共有/.test(x[1])));
  // クラウドにほかの端末の新しい区分（端末の写しは古い）→ その科目は変えない
  const a = world({ act: ACT, cloud: newCloud({ 'mystery fee': { c: 'utility', name: 'Mystery Fee', _at: 77 } }) });
  assert.equal(await a.plClsSave(MF, seen), true);
  assert.equal(a.CL.row.value['mystery fee'].c, 'utility');
  assert.equal(a.CL.writes, 0, '書くものが無ければ書かない');
  assert.equal(a.LS.pl_expense_class['mystery fee'].c, 'utility', '端末の写しもクラウドの最新に');
  assert.ok(a.TOASTS.some(x => x[0] === 'warning' && /先に決まって/.test(x[1])));
  assert.ok(!a.TOASTS.some(x => x[0] === 'success'));
  // 読めない → 保存しない
  const d = world({ act: ACT }); d.CL.fail.get = true;
  assert.equal(await d.plClsSave(MF, seen), false);
  assert.equal(d.LS.pl_expense_class, undefined); assert.equal(d.CL.row, null);
  assert.equal(d._plClsBusy, 0);
  assert.ok(d.TOASTS.some(x => x[0] === 'danger' && /読めなかった/.test(x[1])));
  // オフライン・同期 OFF → 読まずに止める
  for (const o of [{ online: false }, { sync: false }]) {
    const f = world(Object.assign({ act: ACT }, o));
    assert.equal(await f.plClsSave(MF, seen), false);
    assert.equal(f.CL.gets, 0);
    assert.equal(f.LS.pl_expense_class, undefined);
  }
  // 決められない人
  const g = world({ act: ACT, role: 'am' });
  assert.equal(await g.plClsSave(MF, seen), false);
  assert.equal(g.CL.gets, 0);
  // 2 回目の押し（保存中）は何もしない
  const h = world({ act: ACT });
  h._plClsBusy = 1;
  assert.equal(await h.plClsSave(MF, seen), false);
  assert.equal(h.CL.gets, 0);
});

test('#189 Codex P2-1：クラウドに書けなかったら「保存しました」と出さない・閉じない・端末の値も変えない（押し直せば保存できる）', async () => {
  const seen = { 'mystery fee': 0 };
  let after = 0;
  const c = world({ act: ACT, cls: { 'rent - store': { c: 'fixed', name: 'Rent - Store', _at: 5 } } });
  c.CL.fail.write = true;
  assert.equal(await c.plClsSave(MF, seen, () => { after++; }), false);
  assert.equal(after, 0, '画面を閉じない');
  assert.ok(!c.TOASTS.some(x => x[0] === 'success'), '「保存しました」と出さない');
  assert.ok(c.TOASTS.some(x => x[0] === 'danger' && /保存できませんでした/.test(x[1])));
  assert.equal(c.LS.pl_expense_class['mystery fee'], undefined, '端末にも置かない（あとで黙って送らない）');
  assert.equal(c.CL.row.value['mystery fee'], undefined);
  assert.equal(c._plClsBusy, 0);
  // つながったら同じ画面のまま押し直せる
  c.CL.fail.write = false;
  assert.equal(await c.plClsSave(MF, seen, () => { after++; }), true);
  assert.equal(after, 1);
  assert.equal(c.CL.row.value['mystery fee'].c, 'fixed');
  assert.equal(c.CL.row.value['rent - store'].c, 'fixed', 'ほかの科目は残る');
});

test('#189 Codex P2-2：2 台が同じ古い版から同じ科目を決める → あとの端末は上書きしない（先の区分と履歴が残る）', async () => {
  for (const interleave of [false, true]) {
    const CL = newCloud({});
    const A = world({ act: ACT, cloud: CL, cls: {}, session: { role: 'gm', emp_id: 'E1' }, emps: [{ id: 'E1', name: 'GM A' }] });
    const B = world({ act: ACT, cloud: CL, cls: {}, session: { role: 'office', emp_id: 'E2' }, emps: [{ id: 'E2', name: 'Acct B' }] });
    const seen = { 'mystery fee': 0 };   /* どちらも区分の無いときに開いた */
    if (interleave) {
      /* B が読んだあと・書く直前に A が保存し終える（読んだ行が変わる → B は読み直して比べ直す） */
      CL.hook = async () => { assert.equal(await A.plClsSave(MF, seen), true); };
      assert.equal(await B.plClsSave({ 'mystery fee': { c: 'utility', name: 'Mystery Fee' } }, seen), true);
    } else {
      assert.equal(await A.plClsSave(MF, seen), true);
      assert.equal(await B.plClsSave({ 'mystery fee': { c: 'utility', name: 'Mystery Fee' } }, seen), true);
    }
    const v = CL.row.value['mystery fee'];
    assert.equal(v.c, 'fixed', `先に決めた区分が残る（interleave=${interleave}）`);
    assert.equal(v.by, 'GM A');
    assert.equal(v.hist.length, 1); assert.equal(v.hist[0].to, 'fixed');
    assert.ok(B.TOASTS.some(x => x[0] === 'warning' && /先に決まって/.test(x[1]) && /Mystery Fee/.test(x[1])));
    assert.ok(!B.TOASTS.some(x => x[0] === 'success'));
    assert.equal(B.LS.pl_expense_class['mystery fee'].c, 'fixed', 'B の写しもクラウドの最新に');
  }
});

test('#189 Codex P2-2：2 台が同時に別の科目を決める → 両方残る', async () => {
  for (const interleave of [false, true]) {
    const CL = newCloud({});
    const A = world({ act: ACT, cloud: CL, cls: {} }), B = world({ act: ACT, cloud: CL, cls: {} });
    const seen = { 'mystery fee': 0, 'rent - store': 0 };
    const pa = MF, pb = { 'rent - store': { c: 'variable', name: 'Rent - Store' } };
    if (interleave) {
      CL.hook = async () => { assert.equal(await A.plClsSave(pa, seen), true); };
      assert.equal(await B.plClsSave(pb, seen), true);
    } else {
      assert.equal(await A.plClsSave(pa, seen), true);
      assert.equal(await B.plClsSave(pb, seen), true);
    }
    assert.equal(CL.row.value['mystery fee'].c, 'fixed');
    assert.equal(CL.row.value['rent - store'].c, 'variable');
    assert.ok(B.TOASTS.some(x => x[0] === 'success'));
    assert.ok(!B.TOASTS.some(x => x[0] === 'warning'));
  }
});

test('#189 Codex P3：区分の表は保存した文字が同じあいだ 1 回だけ読む（推移の画面で何千回も解かない）', () => {
  const c = world({ act: ACT, cls: { 'mystery fee': { c: 'fixed', name: 'Mystery Fee', _at: 3, hist: Array.from({ length: 10 }, (_, i) => ({ from: 'other', to: 'fixed', by: 'x', at: i })) } } });
  c.LSREADS = 0;
  for (let i = 0; i < 2000; i++) assert.equal(c.plClassOf(i % 2 ? 'Mystery Fee' : 'Rent - Store'), i % 2 ? 'fixed' : 'fixed');
  assert.equal(c.LSREADS, 1, '1 回だけ解く');
  // 変わったら読み直す
  c.LS.pl_expense_class['rent - store'] = { c: 'variable', name: 'Rent - Store', _at: 9 };
  assert.equal(c.plClassOf('Rent - Store'), 'variable');
  assert.equal(c.LSREADS, 2);
});

/* 6A：取り込みの前の差分 */
function imp(ym, sk, v, o = {}) {
  const c = o.c !== undefined ? o.c : { sales: v.sales, cogs: v.cogs, payroll: v.payroll, opex: v.opex, netop: v.netop, othInc: o.othInc ?? 0, othExp: (o.othInc ?? 0) + v.netop - v.netinc, netinc: v.netinc };
  return { ok: true, ym, storeKey: sk, prov: !!o.prov, v, c, dets: { detail: o.detail || { 'Rent - Store': 100 } } };
}
const V = (sales, netinc) => ({ sales, cogs: 10, payroll: 10, opex: 10, netop: sales - 30, netinc });

test('6A：保存する前の差分（新しく入る・暫定 → 確定・確定の月で変わる・暫定のまま変わる・同じ・取り込まない）', () => {
  const old = {
    '2026-08': { F01: Object.assign({}, V(1000, 900), { c: { sales: 1000, cogs: 10, payroll: 10, opex: 10, netop: 970, othInc: 0, othExp: 70, netinc: 900 } }),
                 F02: Object.assign({}, V(2000, 1900)) },
    '2026-09': { F01: Object.assign({}, V(3000, 2900), { prov: true }), F02: Object.assign({}, V(4000, 3900), { prov: true }) }
  };
  const c = world({ act: old });
  const good = [
    imp('2026-08', 'F01', V(1000, 900)),                       /* 同じ */
    imp('2026-08', 'F02', V(2500, 2400), { c: null }),          /* 確定の月で変わる（c が片方だけ → ドルで比べる） */
    imp('2026-09', 'F01', V(3100, 2950)),                       /* 暫定 → 確定 */
    imp('2026-09', 'F02', V(4001, 3901), { prov: true }),       /* 暫定のまま変わる */
    imp('2026-10', 'F01', V(5000, 4000), { prov: true, detail: { 'Brand New Account': 5 } })   /* 新しく入る */
  ];
  good[1].c = null;
  const r = { rows: good.concat([{ ok: false, ym: '2026-10', storeKey: 'F02' }, { ok: false, ym: '2026-10', storeKey: 'F02' }]) };
  const d = plain(c._plImportDiff(r, good.slice().reverse()));   /* 並びによらず、変わる額の大きい順 */
  assert.deepEqual(d.counts, { new: 1, p2f: 1, finChg: 1, provChg: 1, same: 1, fatal: 1 });
  assert.deepEqual(d.newBy, { '2026-10': ['F01'] });
  assert.deepEqual(d.p2fBy, { '2026-09': ['F01'] });
  assert.deepEqual(Object.keys(d.unknown), ['Brand New Account']);
  // 変わる額の大きい順
  assert.deepEqual(d.groups.map(g => g.sk + g.ym), ['F022026-08', 'F012026-09', 'F022026-09']);
  const g0 = d.groups[0];
  assert.equal(g0.kind, 'finChg');
  assert.deepEqual(g0.ch.find(x => x.f === 'sales'), { f: 'sales', ja: '売上', en: 'Sales', a: 2000, b: 2500, d: 500 });
  // c が片方だけのとき、その他の収入・費用は比べない（分からない項目は「変わる」に数えない）
  assert.equal(g0.ch.some(x => x.f === 'othInc' || x.f === 'othExp'), false);
  const html = c._plImportDiffHtml(d);
  assert.match(html, /保存すると変わること/);
  assert.match(html, /暫定 → 確定/);
  assert.match(html, /区分の決まっていない科目が 1 つ/);
  assert.match(html, /取り込まない店・月/);
  assert.match(html, /会議タブ・中間レビュー/);
  // 端末に何も無ければ全部「新しく入る」
  const e = world({ act: {} });
  assert.deepEqual(plain(e._plImportDiff({ rows: good }, good)).counts, { new: 5, p2f: 0, finChg: 0, provChg: 0, same: 0, fatal: 0 });
});

test('6A：セントで比べる（両方に c があるとき）・小さな差（0.5 セント未満）は変わらない', () => {
  const c = world();
  assert.deepEqual(plain(c._plDiffPair({ sales: 100, c: { sales: 100.004 } }, { v: { sales: 100 }, c: { sales: 100.001 } }, 'sales')), { a: 100, b: 100 });
  assert.deepEqual(plain(c._plDiffPair({ sales: 100, c: { sales: 100.25 } }, { v: { sales: 100 }, c: { sales: 100.5 } }, 'sales')), { a: 100.25, b: 100.5 });
  assert.deepEqual(plain(c._plDiffPair({ sales: 100.4 }, { v: { sales: 99.6 } }, 'sales')), { a: 100, b: 100 });
  assert.deepEqual(plain(c._plDiffPair({ sales: 100 }, { v: { sales: 100 } }, 'othInc')), { a: null, b: null });
  assert.deepEqual(plain(c._plDiffPair(null, { v: { netinc: 5 } }, 'netinc')), { a: null, b: 5 });
});

test('2A：名前を営業利益＝Net Operating Income・最終利益＝Net Income にそろえた（本部予算のタブはそのまま）', () => {
  assert.match(SRC, /kpi\('最終利益（実PL）'/);
  assert.match(SRC, /最終利益＝PLブックの Net Income/);
  assert.match(SRC, /\['cost','推移','ti-chart-line'\]/);
  // 区分を変える画面は、画面に出したときの _at と比べる
  assert.match(fnSrc('plAcctSetClass'), /A\.seen != null/);
  assert.match(fnSrc('openPlClassModal'), /seen:plClsCurAt\(/);
});
