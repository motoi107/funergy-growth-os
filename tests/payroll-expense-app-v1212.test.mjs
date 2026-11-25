// v1212（B-2）：Payroll 別のガソリン代・立替経費の画面（index.html の FUNERGY_PE）を VM で動かし、本物の関数 payroll-expense と本物の SQL（PGlite）につなぐ。
// 合成データだけ（名前・金額は架空）。本番にはつながない。仕様：docs/PAYROLL_EXPENSE_V1212_JA.md（UI案100・11/24 の答え）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setup, M, NAME } from './approval-rules-world.mjs';
import { createHandler } from '../supabase/functions/payroll-expense/handler.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const B = '/* ==== FUNERGY_PE（v1212', E = '/* ==== FUNERGY_PE end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E) + E.length);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plain = v => JSON.parse(JSON.stringify(v));   // VM の配列・オブジェクトをこの側の形に

async function server() {
  const s = await setup({});
  await s.pg.exec('reset role');
  await s.pg.exec(M('20261213090000_wr_lost'));
  for (const [id, nm, role, title, store] of [['E15', 'Pia Pin', 'office_crew', 'Office Crew', 'OFFICE']]) {
    await s.pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, nm, role, title, store, JSON.stringify({ name: nm, status: '在籍' })]);
    NAME[id] = nm;
  }
  await s.pg.exec(M('20261217090000_wr_actor_crew_grant'));
  await s.pg.exec(M('20261218090000_payroll_expense'));
  await s.pg.exec('set role service_role');
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: true, expect_rev: 0 })).status, 200);
  for (const t of ['E8', 'E9']) assert.equal((await s.call('E2', { action: 'exp_grant_save', target: t, mileage: true, reimburse: true, expect_rev: 0 })).status, 200);
  const wrWho = async tok => { const r = await s.handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'whoami', pin_session: tok }) }));
    if (r.status !== 200) return null; const j = await r.json(); return j.me; };
  s.pe = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' })[k], db: s.db,
    whoami: async tok => { const me = await wrWho(tok); return me && { emp: me.emp, role: me.role, name: me.name }; } });
  return s;
}
async function checked(s, who, kind, cents, day) {
  const r = await s.subOk(who, kind, who === 'E9' ? 'S2' : 'S1', kind === 'reimburse' ? { amount_cents: Math.max(cents, 1) } : { one_way_miles: 1 });
  assert.equal((await s.approve('E2', r)).status, 200);
  assert.equal((await s.act('E3', await s.fresh(r), 'check')).status, 200);
  await s.q(`update wr_requests set amount_cents = $2, checked_at = ($3 || ' 12:00')::timestamp at time zone 'Pacific/Honolulu' where id = $1`, [r.id, cents, day]);
  return r.id;
}

function fakeDom() {
  const byId = new Map();
  const el = (id, tag) => ({ id, tag, textContent: '', innerHTML: '', value: '', checked: false, style: {}, appendChild() {} });
  const D = { byId, head: { appendChild(c) { if (c.id) byId.set(c.id, c); } }, body: { appendChild() {} },
    getElementById: id => byId.get(id) || null, createElement: tag => el('', tag),
    querySelector: sel => { const m = /^input\[name="pe-how"\]:checked$/.exec(sel); if (!m) return null; return byId.get('pe-how-split') && byId.get('pe-how-split').checked ? { value: 'split' } : { value: 'one' }; } };
  for (const id of ['pe-card', 'pe-assign', 'pe-reason', 'pe-p1', 'pe-s1', 'pe-s2', 'pe-c1', 'pe-c2', 'pe-note', 'pe-d1', 'pe-d2', 'pe-add', 'pe-off', 'pe-how-split']) byId.set(id, el(id));
  return D;
}
function app(srv, emp, { role = 'office_crew', storeLogin = false, en = false } = {}) {
  const D = fakeDom(), toasts = [], books = [], calls = [], wrote = [], modal = { h: '' };
  let pending = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Error, RegExp, Map, Set, Intl, setTimeout, clearTimeout,
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null, curStoreLogin: storeLogin, curRole: role,
    localStorage: new Proxy({}, { get(_, k) { wrote.push('localStorage.' + String(k)); return () => null; } }),
    t: (ja, enT) => (en ? enT : ja), showToast: (m, k) => toasts.push([k, m]),
    openModal: h => { modal.h = h; const m = /id="pe-assign"/.test(h); if (m) D.byId.get('pe-assign').innerHTML = ''; }, closeModalDirect: () => { modal.h = ''; },
    downloadExcelSheets: (sheets, name) => books.push({ sheets, name }),
    wrOpen: () => {},
    fetch: async (url, init) => {
      pending++;
      try { const b = JSON.parse(init.body); calls.push(b.action); assert.ok(String(url).endsWith('/functions/v1/payroll-expense')); return await srv.pe(new Request(url, init)); }
      finally { pending--; }
    },
  };
  ctx.window = ctx; ctx.document = D;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const idle = async () => { for (let quiet = 0; quiet < 3;) { await sleep(8); quiet = pending ? 0 : quiet + 1; } };
  const card = () => D.byId.get('pe-card').innerHTML;
  return { ctx, D, toasts, books, calls, wrote, modal, idle, card, S: () => ctx._peState() };
}

test('入っている：index.html に FUNERGY_PE・版 1212（ページと SW）・経理出力の中の区画・事務Crew は区画だけ・CEO／GM のまとめての出力に 1 枚', () => {
  assert.ok(MOD.length > 1000);
  { const v = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], w = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1]; assert.ok(Number(v) >= 1212, v); assert.equal(v, w); }   // 1212 以上（ページと SW が同じ）
  assert.match(html, /acct_export:\s+\['ceo','gm','office','office_crew'\]/);
  assert.match(html, /id:'export', label:'経理出力', labelEn:'Accounting export',\s+fn:'renderAcctExport', roles:\['ceo','gm','office','office_crew'\]/);
  const f = html.slice(html.indexOf('function renderAcctExport() {'), html.indexOf('function renderAcctExport() {') + 4000);
  const crew = f.slice(f.indexOf("if (curRole === 'office_crew') {"), f.indexOf("var stores = getVisibleStores();"));
  assert.match(crew, /peCardHtml\(/); assert.match(crew, /return /);
  assert.ok(!/exportTipCSV|exportAcctPayrollBook|officePayrollCardHtml/.test(crew), '事務Crew には Tip・給与の出力を出さない');
  assert.match(html, /if \(typeof peCardHtml === 'function'\) html \+= peCardHtml\(y, m\);\n  if \(_axPc\) return html/);
  const book = html.slice(html.indexOf('async function exportAcctPayrollBook('), html.indexOf('async function exportTipCSV('));
  assert.match(book, /peBookSheet/); assert.match(book, /payDetailBlocked\(true\)/, 'まとめての出力は今までどおり CEO・GM だけ');
  assert.match(html, /<Style ss:ID="m"><NumberFormat ss:Format="0\.00"\/><\/Style>/);
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(MOD.replace(/localStorage・IndexedDB/g, '')), 'この端末に書かない');
});

test('事務Crew（確かめた PIN）：3 つのタブ・6 列・1 人 1 行・セント → ドル 2 桁・要確認の帯・内訳から元の申請へ', async () => {
  const s = await server();
  await checked(s, 'E8', 'mileage', 1234, '2026-11-03');
  await checked(s, 'E8', 'reimburse', 5001, '2026-11-15');
  await checked(s, 'E9', 'reimburse', 79900, '2026-11-16');
  await s.q(`update employees set name = 'Kai <b>Kitchen</b>' where id = 'E9'`);
  await s.q(`insert into wr_requests (code, kind, status, store_id, requester_emp, requester_name, amount_cents, use_date, pay_method, legacy, legacy_ref, legacy_info)
    values ('LG-ME-1', 'mileage', 'paid', 'S1', 'E8', 'Cam Crew', 3300, '2026-11-03', '月末処理', true, 'lg:me1', '{"archivedMonth":"2026-11"}')`);
  const a = app(s, 'E15');
  let h = a.ctx.peCardHtml(2026, 10);
  assert.match(h, /Payroll 別 ガソリン代・立替経費/); assert.match(h, /読み込み中/);
  await a.idle();
  h = a.card();
  for (const w of ['申請者', 'ガソリン代', '立替経費', '精算額合計', '既払・他経路支給額', '今回Payroll支給額合計']) assert.ok(h.includes(w), w);
  assert.match(h, /11\/1〜11\/15/); assert.match(h, /支給日 11\/20/); assert.match(h, /16日〜末日|11\/16〜11\/30/); assert.match(h, /月の両方/);
  assert.match(h, /Cam Crew/); assert.match(h, /\$12\.34/); assert.match(h, /\$50\.01/); assert.match(h, /\$62\.35/);
  assert.ok(!h.includes('Kai Kitchen'), '1〜15 日のタブには 16 日の人はいない');
  assert.match(h, /支払状況要確認/); assert.match(h, /LG-ME-1/);
  assert.match(h, /未出力/);
  a.ctx.peTab('p2'); h = a.card();
  assert.match(h, /Kai &lt;b&gt;Kitchen&lt;\/b&gt;/, '名前はエスケープ'); assert.match(h, /\$799\.00/);
  a.ctx.peTab('both'); h = a.card();
  assert.match(h, /Cam Crew/); assert.match(h, /Kai &lt;b&gt;/); assert.match(h, /\$861\.35/, '両方の合計');
  // 内訳（1 人）：申請番号・種類・元の申請を開く
  a.ctx.peTab('p1');
  a.ctx.peDrill('p1', 'E8');
  assert.match(a.modal.h, /Cam Crew/); assert.match(a.modal.h, /ガソリン代/); assert.match(a.modal.h, /立替経費/); assert.match(a.modal.h, /wrOpen\('/);
  assert.match(a.modal.h, /期間を変える・分ける/);
  assert.deepEqual(a.wrote, [], 'この端末に書かない');
});

test('出力：サーバーで版を作ってから Excel（まとめ・明細・要確認・セントは 0.00 のドル）。出力しただけでは支給済みにしない → 支給済みにする（確かめ）→ 申請は精算済み', async () => {
  const s = await server();
  const x1 = await checked(s, 'E8', 'mileage', 1234, '2026-11-03');
  const x2 = await checked(s, 'E8', 'reimburse', 5001, '2026-11-05');
  const a = app(s, 'E15');
  a.ctx.peCardHtml(2026, 10); await a.idle();
  // 出していない期間の「支給済みにする」は、まず出力を
  a.ctx.pePaidAsk('2026-11-1');
  assert.match(a.modal.h, /まだ出力していません/);
  await a.ctx.peExport('p1'); await a.idle();
  assert.equal(a.books.length, 1);
  const bk = a.books[0];
  assert.match(bk.name, /2026-11-1_版1\.xls$/);
  assert.deepEqual(plain(bk.sheets.map(x => x.name)), ['まとめ', '明細', '要確認']);
  const sum = bk.sheets[0].rows;
  const cam = sum.find(r => r[0] === 'Cam Crew');
  assert.deepEqual(plain(cam.slice(2).map(c => [c.v, c.money])), [[12.34, true], [50.01, true], [62.35, true], [0, true], [62.35, true]]);
  assert.equal(bk.sheets[1].rows.length, 3, '明細＝見出し＋2 件');
  assert.match(a.toasts.at(-1)[1], /まだ支給済みではありません/);
  assert.equal((await s.q(`select count(*)::int n from wr_requests where id = any($1::uuid[]) and status = 'checked'`, [[x1, x2]]))[0].n, 2);
  assert.match(a.card(), /出力済み（版 1/);
  a.ctx.pePaidAsk('2026-11-1');
  assert.match(a.modal.h, /版 1/); assert.match(a.modal.h, /\$62\.35/); assert.match(a.modal.h, /取り消しはできません/);
  await a.ctx.pePaidGo('2026-11-1'); await a.idle();
  assert.match(a.toasts.at(-1)[1], /支給済みにしました（申請 2 件/);
  assert.equal((await s.q(`select count(*)::int n from wr_requests where id = any($1::uuid[]) and status = 'paid' and pay_method = 'Payroll'`, [[x1, x2]]))[0].n, 2);
  let h = a.card();
  assert.match(h, /支給済み（/); assert.match(h, /支給済みの版を Excel で/); assert.ok(!/pePaidAsk\('2026-11-1'\)/.test(h), '2 回目のボタンは出さない');
  // 支給済みの期間の出力は写し（同じ版）
  await a.ctx.peExport('p1'); await a.idle();
  assert.match(a.books.at(-1).name, /版1\.xls$/);
  assert.deepEqual(a.calls.filter(c => c === 'export').length, 1, '支給済みの期間は export を呼ばない（ver）');
  // 履歴から前の版
  a.ctx.peHist();
  assert.match(a.modal.h, /版 1/); assert.match(a.modal.h, /支給済み/);
  await a.ctx.peVerDl('2026-11-1', 1);
  assert.match(a.books.at(-1).name, /2026-11-1_版1\.xls$/);
  // 月の両方：合計のシートも
  await checked(s, 'E9', 'reimburse', 2500, '2026-11-20');
  await a.ctx.peExport('both'); await a.idle();
  assert.deepEqual(plain(a.books.at(-1).sheets.map(x => x.name)), ['まとめ', '明細', '要確認', '合計（月の両方）']);
  const tot = a.books.at(-1).sheets[3].rows;
  assert.equal(tot.at(-1)[6].v, 87.35);
});

test('割当を変える（理由は必ず）・分ける（合計が合わなければ画面で止める）・支給済みの期間は選べない', async () => {
  const s = await server();
  const id = await checked(s, 'E8', 'reimburse', 10000, '2026-11-05');
  const a = app(s, 'E3', { role: 'office' });
  a.ctx.peCardHtml(2026, 10); await a.idle();
  a.ctx.peAssignOpen(id); await a.idle();
  let h = a.D.byId.get('pe-assign').innerHTML;
  assert.match(h, /今の割当：2026-11-1（自動）/); assert.match(h, /理由（必ず）/);
  await a.ctx.peAssignGo();
  assert.match(a.D.byId.get('pe-assign').innerHTML, /理由を入れてください/);
  // 分ける：合計が違う
  a.D.byId.get('pe-how-split').checked = true;
  Object.assign(a.D.byId.get('pe-s1'), { value: '2026-11-1' }); Object.assign(a.D.byId.get('pe-s2'), { value: '2026-11-2' });
  a.D.byId.get('pe-c1').value = '60'; a.D.byId.get('pe-c2').value = '30'; a.D.byId.get('pe-reason').value = '2 回に分ける';
  await a.ctx.peAssignGo();
  assert.match(a.D.byId.get('pe-assign').innerHTML, /合計が申請の額と合いません（\$90\.00 \/ \$100\.00）/);
  a.D.byId.get('pe-c2').value = '40.00';
  await a.ctx.peAssignGo(); await a.idle();
  assert.match(a.toasts.at(-1)[1], /割当を保存しました/);
  const al = await s.q(`select period, cents::int, how, reason from pe_alloc where request_id = $1 and off_at is null order by period`, [id]);
  assert.deepEqual(al, [{ period: '2026-11-1', cents: 6000, how: 'manual', reason: '2 回に分ける' }, { period: '2026-11-2', cents: 4000, how: 'manual', reason: '2 回に分ける' }]);
  // 支給済みにした期間は選べない
  const ex = await (await s.pe(new Request('https://fn.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', period: '2026-11-1', pin_session: 'pin-E3' }) }))).json();
  await s.pe(new Request('https://fn.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'paid', period: '2026-11-1', ver: ex.ver, fp: ex.fp, pin_session: 'pin-E3' }) }));
  a.ctx.peReload(); await a.idle();
  a.ctx.peAssignOpen(id); await a.idle();
  h = a.D.byId.get('pe-assign').innerHTML;
  assert.match(h, /<option value="2026-11-1" disabled[^>]*>2026-11 1〜15日（支給済み）/);
});

test('店のスタッフ・店のタブレット・ログインなし：サーバーを呼ばない。ログインが変わったら前の人の答えを捨てる。英語', async () => {
  const s = await server();
  await checked(s, 'E8', 'mileage', 1234, '2026-11-03');
  for (const [emp, o] of [['E8', { role: 'crew' }], ['E3', { role: 'office', storeLogin: true }], [null, { role: 'office' }]]) {
    const a = app(s, emp, o);
    assert.match(a.ctx.peCardHtml(2026, 10), /個人の PIN でログインしたときだけ/);
    await a.idle(); assert.deepEqual(a.calls, []);
  }
  const a = app(s, 'E3', { role: 'office' });
  a.ctx.peCardHtml(2026, 10); await a.idle();
  assert.match(a.card(), /Cam Crew/);
  a.ctx._hwSession = 'pin-E15'; a.ctx.curRole = 'office_crew';
  assert.ok(!/Cam Crew/.test(a.ctx.peCardHtml(2026, 10)), '前の人の答えを出さない');
  await a.idle(); assert.match(a.card(), /Cam Crew/);
  const en = app(s, 'E3', { role: 'office', en: true });
  en.ctx.peCardHtml(2026, 10); await en.idle();
  const h = en.card();
  for (const w of ['Employee', 'Mileage', 'Reimbursement', 'Settled total', 'Already paid / other route', 'This payroll', 'Export to Excel']) assert.ok(h.includes(w), w);
});

test('サーバーがまだ：関数が無い（404）・SQL が無い（pe_missing）をそのまま知らせる', async () => {
  const s = await server();
  const a = app({ pe: async () => new Response('not found', { status: 404 }) }, 'E3', { role: 'office' });
  a.ctx.peCardHtml(2026, 10); await a.idle();
  assert.match(a.card(), /関数 payroll-expense）がまだ入っていません/);
  a.ctx.peTab('p2'); a.ctx.peCardHtml(2026, 10); await a.idle();
  assert.equal(a.calls.length, 1, '失敗しても描き直しのたびにサーバーを呼ばない（「もう一度」で）');
  a.ctx.peReload(); await a.idle(); assert.equal(a.calls.length, 2);
  const b = app({ pe: async () => new Response(JSON.stringify({ error: 'pe_missing', fn: 1 }), { status: 503 }) }, 'E3', { role: 'office' });
  b.ctx.peCardHtml(2026, 10); await b.idle();
  assert.match(b.card(), /サーバー（SQL）がまだ入っていません/);
  void s;
});

test('CEO・GM のまとめての出力の 1 枚：両方の期間（版を作る）と要確認', async () => {
  const s = await server();
  await checked(s, 'E8', 'mileage', 1234, '2026-11-03');
  await checked(s, 'E9', 'reimburse', 500, '2026-11-20');
  const a = app(s, 'E2', { role: 'gm' });
  const sh = await a.ctx.peBookSheet(2026, 10);
  assert.equal(sh.name, 'ガソリン代・立替経費');
  const txt = JSON.stringify(sh.rows);
  assert.match(txt, /2026-11-1/); assert.match(txt, /2026-11-2/); assert.match(txt, /Cam Crew/); assert.match(txt, /Kai Kitchen/); assert.match(txt, /要確認/);
  assert.equal((await s.q(`select count(*)::int n from pe_exports`))[0].n, 2, '出力ごとに版');
  const bad = app({ pe: async () => new Response('{}', { status: 500 }) }, 'E2', { role: 'gm' });
  assert.match(JSON.stringify((await bad.ctx.peBookSheet(2026, 10)).rows), /読めませんでした/);
});
