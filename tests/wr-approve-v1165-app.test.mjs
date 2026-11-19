// v1165（UI案77）：申請/承認の画面。本物の画面のモジュール（index.html の FUNERGY_WR）を VM で、本物の handler と本物の SQL（PGlite・本番の順）につなぐ。
// 合成データだけ（架空の人・店・金額）。PIN の確かめは代わり（'pin-E8' は社員 E8）。仕様：docs/WR_APPROVE_V1165_JA.md
//  1A 一覧の 1 行（申請者・店舗・種別・用途・対象日／月・金額の変更前後・添付）／ 明細の［選択に戻る］［選んで次へ］［この 1 件を承認］
//  2A 前の「承認」タブは無い（前の承認待ちは申請/承認から開く）／ 3A 経理レビューは 確認待ち・確認済み・処理待ち・処理済み（今月）
//  4B 経理が実費（建て替え経費）を事前経費に結ぶ ／ 5A 予定を超えたら GM の承認をもう一度 ／ 6A スマホはボタンを下に固定
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E));
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2'];
const FIX = M('20261126090000_wr_approve_v1165');
const PEOPLE = [   // [id, 名前, 社員の表の役割, 肩書き, 店, manager_auth]
  ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'],
  ['E7', 'Sam Three', 'sl', 'Server Leader', 'S1', null], ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const today = () => new Date().toISOString().slice(0, 10);

function fnSrc(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { const c = html[k]; if (c === '{') d++; else if (c === '}' && --d === 0) return html.slice(i, k + 1); }
  throw new Error('no end ' + name);
}

// v1169：チャット改修・守りと直しの SQL（処理済み（今月）を処理した日で読む wr_acct_done が入る）
const V1169 = ['20261127090000_chat_ui79', '20261128090000_chat_guard', '20261129090000_fixes_v1169'].map(M);
async function server({ fix = true, v1169 = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (fix) await pg.exec(FIX);
  if (v1169) for (const q of V1169) await pg.exec(q);
  await pg.exec('update public.wr_settings set live = true');
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 };
  const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'k-' + String(++seq).padStart(8, '0');
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const act = async (who, r, op, extra = {}) => ok(who, { action: 'act', id: r.id, op, expect_rev: r.rev, client_key: key(), ...extra });
  const pre = (who, cents, purpose = 'Team dinner') => ok(who, { action: 'submit', kind: 'expense_pre', store_id: 'S1', client_key: key(), payload: { date: today(), purpose, total_cents: cents } });
  const rb = (who, cents, receipt = null) => ok(who, { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(), payload: { date: today(), payer: NAME[who], vendor: 'Costco', purpose: '消耗品', amount_cents: cents, receipt } });
  const done = async (who, cents, purpose) => { let x = await pre(who, cents, purpose); x = await act('E2', x, 'approve'); x = await act('E3', x, 'check'); assert.equal(x.status, 'done'); return x; };
  const approved = async (who, cents) => { let x = await rb(who, cents); x = await act('E2', x, 'approve'); assert.equal(x.status, 'approved'); return x; };
  return { pg, handler, call, ok, act, key, pre, rb, done, approved };
}

function fakeDom() {
  const els = {};
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tagName, a1, id, a2] = m, attrs = a1 + a2;
      const el = els[id] || (els[id] = mkEl(id));
      if (tagName === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? v[1] : ''; el.checked = /\bchecked\b/.test(attrs); }
    }
  };
  function mkEl(id) { let ih = ''; return { id, value: '', checked: false, files: null, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); } }; }
  return { els, parse };
}

async function app(srv, emp, { role = 'gm', page = 'tasks', width = 1024, approvals = [], closed = false, answer = true } = {}) {
  const dom = fakeDom(), toasts = [], notifs = [], pages = [], asked = [];
  let modal = '';
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: 'pin-' + emp, innerWidth: width,
    curPage: page, workTab: 'wr', _arTab: 'req', curRole: role, curRealRole: '', STORES: [{ id: 'S1', name: 'Store One' }],
    t: (ja) => ja, bizNow: () => new Date(), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: p => { pages.push(p); if (p === 'acct_review' && ctx.curPage === 'acct_review') ctx.renderWrAcct(); else if (p === 'tasks' && ctx.curPage === 'tasks') ctx.renderWrTab(); }, go: p => pages.push('go:' + p), showToast: (m, k) => toasts.push([k, m]), addNotif: n => notifs.push(JSON.parse(JSON.stringify(n))), getNotifs: () => notifs,
    openModal: h => { modal = h; dom.parse(h); }, closeModalDirect: () => { modal = ''; },
    confirm: m => { asked.push(m); return answer; }, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }],
    ls: (k, d) => (k === 'approvals' ? approvals : d),
    _apClosed: () => closed, apOldPend: () => (closed ? [] : approvals.filter(a => a.status === 'pending' && !a.wrq)),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url, init) => srv.handler(new Request(url, init)),
    document: { getElementById: id => dom.els[id] || null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { ctx.renderWrTab(); await settle(); return ctx.renderWrTab(); };
  const acct = async () => { ctx.renderWrAcct(); await settle(); ctx.renderWrAcct(); await settle(); return ctx.renderWrAcct(); };
  const open = async id => { ctx.wrOpen(id); await settle(); return dom.els['wr-detail'].innerHTML; };
  return { ctx, dom, toasts, notifs, pages, asked, settle, render, acct, open, modal: () => modal, S: () => ctx._wrState() };
}

test('1A: the GM list row shows requester, store, kind, use, the day, the amount (before → after) and whether there is a receipt', async () => {
  const s = await server();
  const a = await s.rb('E8', 4250, { path: 'wr/S1/receipt-a.jpg' });
  let b = await s.rb('E7', 1800);
  b = await s.act('E2', b, 'return', { note: '金額を直して' });
  b = await s.act('E7', b, 'resubmit', { kind: 'reimburse', payload: { date: today(), payer: NAME.E7, vendor: 'Costco', purpose: '消耗品', amount_cents: 1500 } });
  assert.equal(b.status, 'pending');
  const gm = await app(s, 'E2');
  const h = await gm.render();
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(h)[1];
  for (const c of ['種別', '申請した人', '店舗', '用途', '対象日・月', '金額（変更前後）', '添付']) assert.match(head, new RegExp('>' + c + '<'), c);
  const rowOf = code => { const i = h.indexOf('aria-label="' + code + '"'); assert.ok(i >= 0, code); return h.slice(h.lastIndexOf('<tr', i), h.indexOf('</tr>', i)); };
  const ra = rowOf(a.code);
  assert.match(ra, /Lee Two/); assert.match(ra, /Store One/); assert.match(ra, /建て替え経費/); assert.match(ra, /\$42\.50/);
  assert.match(ra, />領収書</, 'there is a receipt'); assert.doesNotMatch(ra, /✓見た/, 'not opened yet');
  const rb = rowOf(b.code);
  assert.match(rb, /text-decoration:line-through">\$18\.00<\/span> → <b>\$15\.00<\/b>/, 'the amount before → after the fix');
  assert.match(rb, />なし</, 'no receipt');
  // スマホは 1 行のカード：同じ中身
  const ph = await app(s, 'E2', { width: 390 });
  const m = await ph.render();
  assert.match(m, /\$18\.00<\/span> → <b>\$15\.00/); assert.match(m, /領収書/);
});

test('1A・6A: from the list the detail has [選択に戻る] [選んで次へ] [この 1 件を承認]; 選んで次へ picks it and opens the next; the last one goes back to the bar', async () => {
  const s = await server();
  const x = [await s.rb('E8', 1000), await s.rb('E8', 2000), await s.rb('E7', 3000)];
  const gm = await app(s, 'E2');
  await gm.render();
  const order = gm.S().lastTodo.slice();
  assert.equal(order.length, 3);
  let d = await gm.open(order[0]);
  assert.match(d, /onclick="wrBackToList\(\)">選択に戻る</);
  assert.match(d, /data-a="[0-9a-f-]+" onclick="wrPickNext\(this\.dataset\.a\)">選んで次へ</);
  assert.match(d, /onclick="wrAsk\('approve'\)">この 1 件を承認</);
  assert.doesNotMatch(d, /position:sticky/, 'on a PC the buttons stay in the detail');
  gm.ctx.wrPickNext(order[0]); await gm.settle();
  assert.deepEqual(Object.keys(gm.S().sel), [order[0]]);
  assert.equal(gm.S().d.id, order[1], 'the next one in the same order is open');
  gm.ctx.wrPickNext(order[1]); await gm.settle();
  assert.equal(gm.S().d.id, order[2]);
  gm.ctx.wrPickNext(order[2]); await gm.settle();
  assert.equal(gm.modal(), '', 'the last one closes the detail');
  assert.equal(Object.keys(gm.S().sel).length, 3);
  assert.ok(gm.toasts.some(([k, m]) => k === 'success' && /選択 3 件。下の帯から承認できます/.test(m)));
  // 選択に戻る：閉じて一覧へ（選んだものはそのまま）
  await gm.open(order[0]);
  assert.match(gm.dom.els['wr-detail'].innerHTML, />選択済み・次へ</);
  gm.ctx.wrBackToList();
  assert.equal(gm.modal(), ''); assert.equal(Object.keys(gm.S().sel).length, 3);
  // まとめて承認（今までの帯）：3 件とも承認
  gm.ctx.wrBulkAsk(); gm.ctx.wrBulkGo(); await gm.settle();
  const st = (await s.pg.query('select status from public.wr_requests order by code')).rows.map(r => r.status);
  assert.deepEqual(st, ['approved', 'approved', 'approved']);
  // 変わった申請は選ばない（読み直す）
  const y = await s.rb('E8', 500);
  const gm2 = await app(s, 'E2');
  await gm2.render();
  await gm2.open(y.id);
  await s.act('E8', y, 'edit', { kind: 'reimburse', payload: { date: today(), payer: NAME.E8, vendor: 'Costco', purpose: '消耗品', amount_cents: 700 } });
  // 一覧を読み直して版 2 になった（開いている明細は版 1 のまま）
  const row = gm2.S().rows.find(q => q.id === y.id); row.rev = row.rev + 1;
  assert.equal(gm2.S().d.id, y.id);
  gm2.ctx.wrPickNext(y.id); await gm2.settle();
  assert.deepEqual(Object.keys(gm2.S().sel), [], 'not picked');
  assert.ok(gm2.toasts.some(([k, m]) => k === 'warning' && /内容が変わったので選べませんでした/.test(m)));
  assert.equal(gm2.modal(), '', 'closed and the list is read again');
  void x;
});

test('1A: a request that cannot be approved together (an open duplicate) has no 選んで次へ, only 承認する', async () => {
  const s = await server();
  await s.rb('E8', 4250);
  const d2 = await s.ok('E8', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: s.key(), dup_reason: '2 回買った', payload: { date: today(), payer: NAME.E8, vendor: 'Costco', purpose: '消耗品', amount_cents: 4250 } });
  assert.ok(d2.id, JSON.stringify(d2));
  const gm = await app(s, 'E2');
  await gm.render();
  assert.ok(gm.S().lastTodo.includes(d2.id), 'listed in 要対応');
  const d = await gm.open(d2.id);
  assert.doesNotMatch(d, /wrPickNext|選択に戻る/);
  assert.match(d, /onclick="wrAsk\('approve'\)">承認する</);
});

test('6A: on a phone the buttons sit fixed at the bottom of the detail, 44px high', async () => {
  const s = await server();
  const a = await s.rb('E8', 1000);
  const gm = await app(s, 'E2', { width: 390 });
  await gm.render();
  const d = await gm.open(a.id);
  const box = /<div id="wr-btns" style="([^"]*)">/.exec(d);
  assert.ok(box, 'one button bar');
  assert.match(box[1], /position:sticky;bottom:-16px/);
  assert.match(box[1], /env\(safe-area-inset-bottom/);
  assert.match(d, /min-height:44px/);
  // 経理の 1 件の画面も同じ（経理レビューから開く）
  await s.act('E2', a, 'approve');
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_review', width: 390 });
  await ac.acct();
  assert.match(await ac.open(a.id), /<div id="wr-btns" style="[^"]*position:sticky/);
});

test('2A: no 承認 tab; the old waiting approvals are opened from 申請/承認 until step 3 (then nothing is shown)', async () => {
  const s = await server();
  const old = [{ id: 'ap1', type: 'ガソリン代', status: 'pending' }, { id: 'ap2', type: '休暇', status: 'pending' }, { id: 'ap3', type: '休暇', status: 'pending', wrq: 1 }];
  const gm = await app(s, 'E2', { approvals: old });
  const h = await gm.render();
  assert.match(h, /前の承認の画面に残っている承認待ち 2 件/, 'the copied one (wrq) is not counted');
  assert.match(h, /onclick="setWorkTab\('approval'\)">前の承認の画面を開く</);
  const none = await app(s, 'E2');
  const h0 = await none.render();
  assert.doesNotMatch(h0, /前の承認の画面に残っている/, 'nothing waiting: no count');
  const after = await app(s, 'E2', { approvals: old, closed: true });
  after.ctx.apOldPend = () => old.filter(a => !a.wrq);   /* 閉じたあとは、前の一覧に何か残っていても出さない */
  const ha = await after.render();
  assert.doesNotMatch(ha, /前の承認の画面に残っている|前の承認の画面を開く|setWorkTab\('approval'\)/, 'after step 3 the old screen is gone');
  // メインの画面：タブは「申請/承認」1 つ。古い行き先（承認センター）は申請/承認の中の前の承認の画面へ
  const wc = fnSrc('renderWorkCenter');
  assert.match(wc, /t\('申請\/承認','Requests \/ Approvals'\)/);
  assert.doesNotMatch(wc, /setWorkTab\('approval'\)"><i class="ti ti-checklist"/, 'no 承認 tab');
  assert.match(wc, /if \(workTab==='approval'\) return bar \+ [^\n]*申請\/承認に戻る[^\n]*renderApproval\(\);/);
  const ctx = { workTab: 'wr', NAV_RETIRED: {}, _apClosed: () => false };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('navResolvePage') + '\nfunction navGuardPage(p){ return p; }', ctx);   /* v1191：行き先の守りは tests/unified-ui-v1191 で確かめる */
  assert.equal(ctx.navResolvePage('approval'), 'tasks'); assert.equal(ctx.workTab, 'approval');
  ctx._apClosed = () => true; ctx.workTab = 'wr';
  assert.equal(ctx.navResolvePage('approval'), 'tasks'); assert.equal(ctx.workTab, 'wr');
});

test('3A: accounting review has 確認待ち / 確認済み・処理待ち / 処理済み（今月）; the totals; the GM approval is shown', async () => {
  const s = await server();
  const a = await s.approved('E8', 4250);
  const b = await s.approved('E7', 1000);
  const ex = await s.pre('E8', 5000, 'Party'); await s.act('E2', ex, 'approve');
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_review' });
  let h = await ac.acct();
  assert.match(h, />確認待ち <span class="tag tag-red"[^>]*>3<\/span>/);
  assert.match(h, />確認済み・処理待ち <span class="tag"[^>]*>0<\/span>/);
  assert.match(h, />処理済み（今月）</);
  assert.match(h, /<th>GM の承認<\/th>/); assert.match(h, /Gabe GM <span/);
  assert.equal((h.match(/>確認する</g) || []).length, 3);
  // 確認 → 処理待ちへ。精算待ちの合計は建て替え・ガソリン代だけ
  await s.act('E3', a, 'check'); await s.act('E3', b, 'check');
  ac.ctx.wrAcctRefresh(); await ac.settle();
  ac.ctx.wrAcctTab('wait'); await ac.settle();
  h = ac.ctx.renderWrAcct();
  assert.match(h, /精算待ちの合計 <b[^>]*>\$52\.50<\/b>/);
  assert.match(h, />精算を記録</);
  assert.match(h, new RegExp(a.code)); assert.doesNotMatch(h, new RegExp(ex.code), 'the pre-approval is still in 確認待ち');
  // 精算 → 処理済み（今月）
  const a2 = (await s.ok('E3', { action: 'get', id: a.id }));
  await s.act('E3', a2, 'pay', { pay_date: today(), pay_method: 'Check' });
  // b は先月より前に精算した形（今月の「処理済み」には出ない）・c は確認しただけ（まだ精算していない）
  await s.act('E3', await s.ok('E3', { action: 'get', id: b.id }), 'pay', { pay_date: today(), pay_method: 'Cash' });
  await s.pg.exec(`reset role; update public.wr_requests set paid_at = paid_at - interval '62 days', checked_at = checked_at - interval '62 days' where id = '${b.id}'; set role service_role;`);
  const c = await s.approved('E7', 2000); await s.act('E3', c, 'check');
  ac.ctx.wrAcctRefresh(); await ac.settle();
  ac.ctx.wrAcctTab('done'); await ac.settle(); ac.ctx.renderWrAcct(); await ac.settle();
  h = ac.ctx.renderWrAcct();
  assert.match(h, /<th>処理（人・日時）<\/th>/);
  assert.match(h, new RegExp(a.code)); assert.match(h, /Ann Acct <span[^>]*>[^<]+<\/span> · Check/);
  assert.doesNotMatch(h, new RegExp(b.code), 'paid in an earlier month');
  assert.doesNotMatch(h, new RegExp(c.code), 'checked but not paid yet');
  // GM は見るだけ
  const gm = await app(s, 'E2', { page: 'acct_review' });
  const hg = await gm.acct();
  assert.match(hg, /（見るだけ）/); assert.doesNotMatch(hg, />確認する</);
});

test('v1200（UI案97 の 3A）: wrAcctFeed gives the accounting one list the same GM-approved requests (確認待ち・精算待ち), read only; it redraws the list when they arrive; GM is view only; no sign-in says so', async () => {
  const s = await server();
  const a = await s.approved('E8', 4250);
  const ex = await s.pre('E8', 5000, 'Party'); await s.act('E2', ex, 'approve');
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_center' });
  ac.ctx.acrOnPage = () => true;   // 経理センター › 経理レビュー › 確認する が開いている
  let f = ac.ctx.wrAcctFeed();
  assert.equal(f.state, 'loading');
  await ac.settle(); ac.ctx.wrAcctFeed(); await ac.settle(); f = ac.ctx.wrAcctFeed();
  assert.equal(f.state, 'ok'); assert.equal(f.viewOnly, false);
  const ra = f.rows.find(r => r.id === a.id), re = f.rows.find(r => r.id === ex.id);
  assert.deepEqual([ra.code, ra.kind, ra.kindL, ra.st, ra.amount, ra.who, ra.storeL, ra.gmBy], [a.code, 'reimburse', '建て替え経費', 'ck', 42.5, 'Lee Two', 'Store One', 'Gabe GM']);
  assert.ok(ra.gmAt && ra.at); assert.match(ra.useH, /Costco/);
  assert.deepEqual([re.kind, re.st, re.amount], ['expense_pre', 'ck', 50]);
  assert.ok(ac.pages.includes('acct_center'), 'the one list is redrawn when the rows arrive');
  // 確認したら精算待ち（同じ読み込み：wrAcctRefresh）
  await s.act('E3', a, 'check'); ac.ctx.wrAcctRefresh(); await ac.settle();
  ac.ctx.wrAcctFeed(); await ac.settle(); f = ac.ctx.wrAcctFeed();   // 一覧を描くたびに読む（読み終えたら描き直す）
  assert.equal(f.rows.find(r => r.id === a.id).st, 'pay');
  assert.ok(!f.rows.some(r => r.id === ex.id && r.st === 'pay'));
  // GM・CEO は見るだけ
  const gm = await app(s, 'E2', { page: 'acct_center' });
  gm.ctx.wrAcctFeed(); await gm.settle(); gm.ctx.wrAcctFeed(); await gm.settle();
  assert.equal(gm.ctx.wrAcctFeed().viewOnly, true);
  // サインインしていない：rows は空・そう言う
  ac.ctx._hwSession = null;
  f = ac.ctx.wrAcctFeed();
  assert.equal(f.state, 'signin'); assert.equal(f.rows.length, 0); assert.ok(f.msg.length > 0);
});

test('v1169（#161）: 処理済み（今月） is read by the day it was processed: an old request paid this month is shown; with the older SQL it says it uses the earlier way', async () => {
  for (const v1169 of [true, false]) {
    const s = await server({ v1169 });
    let old = await s.approved('E8', 3300);
    old = await s.act('E3', old, 'check');
    await s.act('E3', await s.ok('E3', { action: 'get', id: old.id }), 'pay', { pay_date: today(), pay_method: 'Check' });
    // 4 か月前に申請した（前の読み方は申請した日で 2 か月前までしか読まない）
    await s.pg.exec(`reset role; update public.wr_requests set submitted_at = submitted_at - interval '120 days', created_at = created_at - interval '120 days' where id = '${old.id}'; set role service_role;`);
    const ac = await app(s, 'E3', { role: 'office', page: 'acct_review' });
    await ac.acct();
    ac.ctx.wrAcctTab('done'); await ac.settle(); ac.ctx.renderWrAcct(); await ac.settle();
    const h = ac.ctx.renderWrAcct();
    if (v1169) {
      assert.match(h, new RegExp(old.code), 'the old request processed this month is in');
      assert.doesNotMatch(h, /前の読み方/);
    } else {
      assert.match(h, /サーバーが前の版なので、前の読み方（申請した日で 2 か月前まで・1,000 件）で出しています/);
      assert.doesNotMatch(h, new RegExp(old.code), 'the earlier way misses it (and says so)');
    }
  }
});

test('4B: accounting links the actual (reimbursement) to the pre-approval from the detail; the pre-approval shows its actual; unlink', async () => {
  const s = await server();
  const ex = await s.done('E8', 10000, 'Team dinner');
  const r = await s.approved('E8', 9200);
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_review' });
  await ac.acct();
  let d = await ac.open(r.id);
  assert.match(d, /事前経費に結ぶ/); assert.match(d, /onclick="wrPreOpen\(\)">同じ人の事前経費を見る</);
  ac.ctx.wrPreOpen(); await ac.settle();
  d = ac.dom.els['wr-detail'].innerHTML;
  assert.match(d, new RegExp(ex.code + '</b> · Team dinner'));
  assert.match(d, /予定 \$100\.00 · 実費との差 [−-]\$8\.00/);
  assert.match(d, /type="radio"[^>]* checked/, 'the only candidate is picked');
  ac.ctx.wrPreLink(); await ac.settle();
  assert.equal(ac.asked.length, 0, 'not over: no question');
  assert.ok(ac.toasts.some(([k, m]) => k === 'success' && new RegExp('事前経費に結びました · ' + r.code).test(m)));
  d = ac.dom.els['wr-detail'].innerHTML;
  assert.match(d, new RegExp('<b>事前経費</b>　' + ex.code + '（Team dinner） · 予定 \\$100\\.00 → 実費 <b>\\$92\\.00</b>（[−-]\\$8\\.00）'));
  assert.match(d, /結んだ人 Ann Acct/);
  assert.match(d, /onclick="wrAsk\('check'\)"/, 'still waiting for the accounting check');
  // 一覧の金額の下にも
  const h = ac.ctx.renderWrAcct();
  assert.match(h, new RegExp(ex.code + ' 予定 \\$100\\.00</div>'));
  // 事前経費の 1 件の画面：実費
  const dx = await ac.open(ex.id);
  assert.match(dx, new RegExp('<b>実費</b>　' + r.code + ' · \\$92\\.00（予定から [−-]\\$8\\.00）'));
  assert.match(dx, /精算するのは実費だけです/);
  // 外す
  await ac.open(r.id);
  ac.ctx.wrPreUnlink(); await ac.settle();
  assert.equal(ac.asked.length, 1);
  assert.ok(ac.toasts.some(([k, m]) => k === 'success' && /事前経費から外しました/.test(m)));
  assert.match(ac.dom.els['wr-detail'].innerHTML, /同じ人の事前経費を見る/);
  const dx2 = await ac.open(ex.id);
  assert.match(dx2, /まだありません。買ったら「建て替え経費」で/);
  // GM・申請した人には結ぶボタンが無い
  const gm = await app(s, 'E2');
  await gm.render();
  assert.doesNotMatch(await gm.open(r.id), /wrPreOpen/);
  const me = await app(s, 'E8', { role: 'sl' });
  await me.render();
  assert.doesNotMatch(await me.open(r.id), /wrPreOpen/);
});

test('5A: an actual over the plan asks first, goes back to the GM (told), the GM sees the red line and approves again', async () => {
  const s = await server();
  const ex = await s.done('E8', 10000);
  const r = await s.approved('E8', 12000);
  const no = await app(s, 'E4', { role: 'office_crew', page: 'acct_review', answer: false });
  await no.acct(); await no.open(r.id);
  no.ctx.wrPreOpen(); await no.settle();
  assert.match(no.dom.els['wr-detail'].innerHTML, /予定を超える → GM の承認をもう一度/);
  no.ctx.wrPreLink(); await no.settle();
  assert.match(no.asked[0], /\$120\.00 は予定 \$100\.00 を超えています。結ぶと GM の承認待ちに戻ります/);
  assert.equal((await s.pg.query('select count(*)::int n from public.wr_requests where pre_id is not null')).rows[0].n, 0, 'said no: nothing sent');
  const ac = await app(s, 'E4', { role: 'office_crew', page: 'acct_review' });
  await ac.acct(); await ac.open(r.id);
  ac.ctx.wrPreOpen(); await ac.settle();
  ac.ctx.wrPreLink(); await ac.settle();
  assert.ok(ac.toasts.some(([k, m]) => k === 'warning' && new RegExp('予定を超えたので GM の承認待ちに戻しました · ' + r.code).test(m)));
  const n = ac.notifs.find(x => (x.toRoles || []).join() === 'gm');
  assert.ok(n, 'the GM is told'); assert.match(n.title, /承認待ち/); assert.equal(n.wrTab, 'todo');
  const d = ac.dom.els['wr-detail'].innerHTML;
  assert.match(d, /予定を超えています。GM の承認をもう一度もらいます。/);
  assert.match(d, /承認待ち/);
  // GM：要対応の行に赤い線（予定と超え）、承認すると経理の確認に戻る
  const gm = await app(s, 'E2');
  const h = await gm.render();
  assert.match(h, new RegExp('color:var\\(--red\\)">' + ex.code + ' 予定 \\$100\\.00 · 超え \\+\\$20\\.00</div>'));
  await gm.open(r.id);
  gm.ctx.wrAsk('approve'); await gm.settle();
  assert.equal(gm.S().d.status, 'approved');
  const back = await app(s, 'E3', { role: 'office', page: 'acct_review' });
  assert.match(await back.acct(), new RegExp(r.code));
});

test('before the v1165 SQL and function: the detail says to wait; no link button; the old pieces still work', async () => {
  const s = await server({ fix: false });
  const r = await s.approved('E8', 1000);
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_review' });
  const h = await ac.acct();
  assert.match(h, new RegExp(r.code));
  assert.equal(ac.S().sql, 6);
  const d = await ac.open(r.id);
  assert.doesNotMatch(d, /wrPreOpen/);
  assert.match(d, /事前経費に結ぶには/);
  assert.match(d, /onclick="wrAsk\('check'\)"/);
});

test('the version is 1165 or later (the app and the service worker)', () => {
  const v = /const APP_VERSION = '(\d+)';/.exec(html)[1];
  assert.ok(Number(v) >= 1165); assert.match(SW, new RegExp("const SW_BUILD = '" + v + "';"));
});
