// v1154 workcenter A plan (UI proposal 70/71): GM bulk approval and the accounting review list.
// The real screen module (FUNERGY_WR in index.html) in a VM, talking to the real handler and the real SQL (PGlite). Harness copied from work-requests-ui.test.mjs.
// Synthetic data only (fictional people, stores and amounts). The PIN check is a stand-in: token 'pin-E7' means employee E7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E));
// v1132：2 段目の SQL（種類で振り分ける）を重ねても 1 段目の動きは同じ
const MIG = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68']
  .map(f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8')).join('\n');
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Crew', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'], ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null],
  ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null], ['E11', 'Ned Leader', 'sl', 'Operation Leader', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function server({ live = false, legacy = {}, confirm = live } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]',$6,$7)`, [id, name, role, title, store, '在籍', JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const [k, v] of Object.entries(legacy)) await pg.query('insert into app_state(key, value) values($1,$2)', [k, JSON.stringify(v)]);
  await pg.exec(MIG);
  if (live) await pg.exec('update public.wr_settings set live = true');
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  // live のときは、使い始めたときと同じく GM が承認・閲覧の権限（AM・G4 以上）の写しを確かめた状態（#123 のレビュー P1）
  if (confirm) { const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest }); }
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  return { pg, handler };
}

// A small stand-in for the page: elements by id, made from the HTML the module writes (id, value, checked, selected option).
function fakeDom() {
  const els = {};
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tagName, a1, id, a2] = m, attrs = a1 + a2;
      const el = els[id] || (els[id] = mkEl(id));
      if (tagName === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? v[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : ''; el.checked = /\bchecked\b/.test(attrs); }
      if (tagName === 'select') { const rest = h.slice(m.index); const end = rest.indexOf('</select>'); const sel = /<option value="([^"]*)" selected>/.exec(rest.slice(0, end)) || /<option value="([^"]*)"/.exec(rest.slice(0, end)); el.value = sel ? sel[1] : ''; }
      if (tagName === 'textarea') { const rest = h.slice(m.index + m[0].length); el.value = rest.slice(0, rest.indexOf('</textarea>')); }
    }
  };
  function mkEl(id) { let ih = ''; return { id, value: '', checked: false, files: null, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); } }; }
  return { els, parse };
}

async function app(srv, emp, { role = 'gm', realRole = '', storage = new Map(), fail = null, shared = new Map() } = {}) {
  const dom = fakeDom(), toasts = [], notifs = [], pages = [], calls = [];
  let modal = '';
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
    curPage: 'tasks', workTab: 'wr', curRole: role, curRealRole: realRole, STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: (ja) => ja, bizNow: () => new Date('2026-11-02T10:00:00'), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: p => pages.push(p), go: p => pages.push('go:' + p), showToast: (m, k) => toasts.push([k, m]), addNotif: n => notifs.push(JSON.parse(JSON.stringify(n))), getNotifs: () => notifs,
    openModal: h => { modal = h; dom.parse(h); }, closeModalDirect: () => { modal = ''; },
    confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }],
    ls: (k, d) => (k === 'approvals' ? [{ id: 'ap1', type: 'ガソリン代' }, { id: 'ap2', type: '休暇' }] : k === 'wr_live' && shared.has('wr_live') ? shared.get('wr_live') : d),
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: async (url, init) => {
      const r = await srv.handler(new Request(url, init));
      if (fail && fail.next) { fail.next = false; throw new TypeError('network lost after the server saved'); }
      return r;
    },
    document: { getElementById: id => dom.els[id] || null },
  };
  for (const n of ['approveMileage', 'openMileageModal', 'openExpenseModal', 'signoffApproval', 'renderMileage', 'saveReimbursement'])
    ctx[n] = (...a) => { calls.push([n, ...a]); return n === 'renderMileage' ? '<div>old list</div>' : 'orig'; };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { ctx.renderWrTab(); await settle(); return ctx.renderWrTab(); };
  return { ctx, dom, toasts, notifs, pages, calls, settle, render, modal: () => modal, S: () => ctx._wrState() };
}


// Submit straight to the server as the requester (a stand-in for the form; the receipt path is a storage path).
async function submit(srv, emp, kind, store, payload) {
  const r = await srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'submit', pin_session: 'pin-' + emp, kind, store_id: store, payload, client_key: 'k-' + Math.random().toString(36).slice(2) }) }));
  const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j;
}
async function act(srv, emp, id, op, rev, extra = {}) {
  const r = await srv.handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'act', pin_session: 'pin-' + emp, id, op, expect_rev: rev, client_key: 'a-' + Math.random().toString(36).slice(2), ...extra }) }));
  return { status: r.status, j: await r.json() };
}
const mil = (d, miles) => ({ date: d, purpose: '銀行・郵便', origin: 'Store', destination: 'Bank', one_way_miles: miles, round_trip: true });
const rb = (d, cents, path) => ({ date: d, payer: 'Lee Leader', payer_is_employee: true, vendor: 'Costco ' + cents, purpose: '消耗品', amount_cents: cents, receipt: path ? { path } : null });
const pre = (d, cents) => ({ date: d, purpose: 'Team dinner ' + cents, total_cents: cents });
const statuses = async srv => Object.fromEntries((await srv.pg.query('select code, status, version from public.wr_requests order by code')).rows.map(r => [r.code, r.status + '/' + r.version]));
const approvals = async srv => (await srv.pg.query(`select count(*)::int n from public.wr_events where action = 'approve'`)).rows[0].n;

test('GM bulk approval: pick the shown requests, see the totals and the unopened receipt, approve all at once', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-10', 14.3));
  const b = await submit(srv, 'E7', 'reimburse', 'S1', rb('2026-11-10', 8000, 'S1/2026-11/rcpt_1.jpg'));
  const c = await submit(srv, 'E6', 'expense_pre', 'S1', pre('2026-11-20', 100000));
  const gm = await app(srv, 'E2');
  let h = await gm.render();
  assert.match(h, /表示中の承認待ちを全選択（3）/);
  assert.match(h, /絞り込みを変えると選択を外します/);
  assert.equal((h.match(/onchange="wrSel\(this\.dataset\.a,this\.checked\)"/g) || []).length, 3, 'a box per request the GM can approve');
  assert.doesNotMatch(h, /選択した \d+ 件を承認/, 'no bar before picking');
  gm.ctx.wrSelAll(true); h = await gm.render();
  assert.match(h, /選択 3 件/);
  const pay = a.amount_cents + b.amount_cents;
  assert.match(h, new RegExp('精算対象 <b>\\$' + (pay / 100).toFixed(2).replace('.', '\\.')));
  assert.match(h, /事前経費 <b>\$1,000\.00<\/b>（精算には入れない）/);
  gm.ctx.wrBulkAsk();
  let m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /3 件を承認します/);
  assert.match(m, /まだ開いていない領収書が 1 件/);
  assert.match(m, new RegExp(b.code));
  gm.ctx.viewInvoiceImage = () => {};
  gm.ctx.wrReceipt('S1/2026-11/rcpt_1.jpg'); await gm.settle();
  m = gm.dom.els['wr-bulk'].innerHTML;
  assert.doesNotMatch(m, /まだ開いていない領収書/, 'opened: no warning');
  gm.ctx.wrBulkGo(); gm.ctx.wrBulkGo();          // pressed twice
  await gm.settle();
  m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /3 件承認/);
  const st = await statuses(srv);
  assert.deepEqual([st[a.code], st[b.code], st[c.code]], ['approved/1', 'approved/1', 'approved/1']);
  assert.equal(await approvals(srv), 3, 'once each');
  assert.deepEqual(Object.keys(gm.S().sel), [], 'the selection is cleared');
  assert.ok(gm.notifs.some(n => n.toUser === 'Lee Leader' && /承認されました/.test(n.title)));
  assert.ok(gm.notifs.some(n => (n.toRoles || []).includes('office') && /経理の確認待ち/.test(n.title)));
});

test('a request changed after the GM looked is not approved (check again); the others are', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const b = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-12', 4));
  const gm = await app(srv, 'E2');
  await gm.render();
  gm.ctx.wrSelAll(true); await gm.render();
  gm.ctx.wrBulkAsk();
  // the requester withdraws and is too late? no: the requester edits b (version 2) while the GM's confirm screen is open
  const ed = await act(srv, 'E7', b.id, 'edit', b.rev, { kind: 'mileage', payload: mil('2026-11-12', 40) });
  assert.equal(ed.status, 200, JSON.stringify(ed.j));
  gm.ctx.wrRefresh(); await gm.settle();            // the list behind the confirm screen is read again (it now shows version 2)
  assert.equal(gm.S().rows.find(r => r.id === b.id).rev !== b.rev, true);
  gm.ctx.wrBulkGo(); await gm.settle();
  const m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /1 件承認／1 件は要再確認/);
  assert.match(m, /承認していません。あなたが見たあと内容が変わりました（版 2・金額 \$5\.60 → \$56\.00）。開いて確かめてください/);
  const st = await statuses(srv);
  assert.equal(st[a.code], 'approved/1');
  assert.equal(st[b.code], 'pending/2', 'the changed request waits for the GM');
});

test('filters clear the selection; the requester filter shows and selects only that person; a reload drops a changed pick', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const b = await submit(srv, 'E6', 'mileage', 'S1', mil('2026-11-12', 5));
  const gm = await app(srv, 'E2');
  let h = await gm.render();
  assert.match(h, /申請した人：すべて/); assert.match(h, /<option value="Lee Leader">/); assert.match(h, /<option value="Sam Store">/);
  gm.ctx.wrSelAll(true); await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 2);
  gm.ctx.wrSetFilter('who', 'Sam Store'); h = await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 0, 'a filter change clears the selection');
  assert.match(h, /表示中の承認待ちを全選択（1）/);
  gm.ctx.wrSelAll(true);
  assert.deepEqual(Object.keys(gm.S().sel), [b.id], 'only the shown request');
  await gm.render();
  gm.ctx.wrSetFilter('kind', 'mileage'); await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 0);
  // picked, then the request changes and the list is read again: the pick is dropped and the GM is told
  gm.ctx.wrSetFilter('who', ''); await gm.render();
  gm.ctx.wrSel(a.id, true); await gm.render();
  await act(srv, 'E7', a.id, 'edit', a.rev, { kind: 'mileage', payload: mil('2026-11-11', 11) });
  gm.ctx.wrRefresh(); await gm.settle(); h = gm.ctx.renderWrTab();
  assert.equal(Object.keys(gm.S().sel).length, 0);
  assert.match(h, new RegExp('内容が変わった申請の選択を外しました：' + a.code));
});

test('an answer lost after the server approved: still one approval; staff see no boxes', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const fail = { next: false };
  const gm = await app(srv, 'E2', { fail });
  await gm.render();
  gm.ctx.wrSel(a.id, true); await gm.render();
  gm.ctx.wrBulkAsk(); fail.next = true;
  gm.ctx.wrBulkGo(); await gm.settle();
  assert.match(gm.dom.els['wr-bulk'].innerHTML, /できませんでした/);
  assert.equal((await statuses(srv))[a.code], 'approved/1', 'the server saved it');
  assert.equal(await approvals(srv), 1);
  const h = await gm.render();
  assert.doesNotMatch(h, /表示中の承認待ちを全選択/, 'nothing left to approve');
  const g3 = await app(srv, 'E7', { role: 'sl' });
  const h3 = await g3.render();
  assert.doesNotMatch(h3, /wrSel\(/, 'a requester has nothing to approve');
});

test('accounting review › requests: accounting sees GM-approved requests to check or pay; the GM only views', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const b = await submit(srv, 'E7', 'reimburse', 'S1', rb('2026-11-10', 4250, ''));
  const w = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-13', 3));  // still waiting for the GM: not listed
  for (const x of [a, b]) assert.equal((await act(srv, 'E2', x.id, 'approve', x.rev)).status, 200);
  const acct = await app(srv, 'E3', { role: 'office' });
  acct.ctx.curPage = 'acct_review'; acct.ctx._arTab = 'req';
  acct.ctx.renderWrAcct(); await acct.settle(); acct.ctx.renderWrAcct(); await acct.settle();
  let h = acct.ctx.renderWrAcct();
  assert.match(h, /\[経理の確認待ち:2件\]/);
  assert.match(h, new RegExp(a.code)); assert.match(h, new RegExp(b.code));
  assert.equal((h.match(/確認する/g) || []).length, 2);
  assert.doesNotMatch(h, new RegExp(w.code), 'not approved yet');
  const gm = await app(srv, 'E2');
  gm.ctx.curPage = 'acct_review'; gm.ctx._arTab = 'req';
  gm.ctx.renderWrAcct(); await gm.settle(); gm.ctx.renderWrAcct(); await gm.settle();
  const hg = gm.ctx.renderWrAcct();
  assert.match(hg, /（見るだけ）/);
  assert.doesNotMatch(hg, /確認する/);
  assert.match(hg, />見る</);
});

test('accounting review › requests: the first open fills itself in when the reading ends, without drawing it again by hand (Codex #148 P2-1)', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  assert.equal((await act(srv, 'E2', a.id, 'approve', a.rev)).status, 200);
  // the page is drawn only by the screen itself (renderPage → renderWrAcct), like the app
  const open = async (emp, opts, before) => {
    const d = await app(srv, emp, opts), shown = [];
    d.ctx.renderPage = p => { d.pages.push(p); if (p === 'acct_review') shown.push(d.ctx.renderWrAcct()); };
    d.ctx.curPage = 'acct_review'; d.ctx._arTab = 'req';
    if (before) before(d);
    const first = d.ctx.renderWrAcct();
    await d.settle();
    return { d, first, shown };
  };
  const { d, first, shown } = await open('E3', { role: 'office' });
  assert.match(first, /読み込み中/, 'the first drawing waits for the reading');
  assert.ok(shown.length >= 1, 'the screen is drawn again when the reading ends');
  const last = shown.at(-1);
  assert.match(last, new RegExp(a.code), 'the approved request is listed');
  assert.match(last, /\[経理の確認待ち:1件\]/);
  assert.doesNotMatch(last, /読み込み中/);
  assert.ok(!d.pages.includes('tasks'), 'the work center is not drawn in its place');
  // a failure also replaces "loading…"
  const bad = await open('E3', { role: 'office' }, x => { x.ctx.fetch = async () => { throw new TypeError('offline'); }; });
  assert.match(bad.first, /読み込み中/);
  assert.ok(bad.shown.length >= 1);
  assert.doesNotMatch(bad.shown.at(-1), /読み込み中/);
  assert.match(bad.shown.at(-1), /つながりません/, 'the reason is shown');
  // nothing is drawn when the person has moved to another page meanwhile
  const away = await app(srv, 'E3', { role: 'office' }), drawn = [];
  away.ctx.renderPage = p => drawn.push(p);
  away.ctx.curPage = 'acct_review'; away.ctx._arTab = 'req';
  away.ctx.renderWrAcct(); away.ctx.curPage = 'dashboard';
  await away.settle();
  assert.deepEqual(drawn, []);
});

test('what can be bulk-approved: the three expense kinds, waiting, approvable by this person, no open duplicate', async () => {
  const srv = await server({ live: true });
  const gm = await app(srv, 'E2');
  const ok = r => gm.ctx._wrBulkOk(Object.assign({ kind: 'mileage', status: 'pending', can: ['approve'], dup_codes: [], dup_ok: false }, r));
  assert.equal(ok({}), true);
  for (const k of ['reimburse', 'expense_pre']) assert.equal(ok({ kind: k }), true, k);
  for (const k of ['skill', 'cs', 'tiprate']) assert.equal(ok({ kind: k }), false, k + ' is applied after approval: one at a time');
  assert.equal(ok({ status: 'approved' }), false);
  assert.equal(ok({ can: ['return', 'reject'] }), false);
  assert.equal(ok({ dup_codes: ['RB-2611-0001'] }), false, 'an open duplicate needs a look first');
  assert.equal(ok({ dup_codes: ['RB-2611-0001'], dup_ok: true }), true);
});

test('the sign-in changes between the confirm screen and the press: nothing is sent', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const gm = await app(srv, 'E2');
  await gm.render();
  gm.ctx.wrSel(a.id, true); await gm.render();
  gm.ctx.wrBulkAsk();
  gm.ctx.closeModal = () => {};
  gm.ctx.mrAuthKey = () => 'p|E9';
  gm.ctx.wrBulkGo(); await gm.settle();
  assert.ok(gm.toasts.some(([k, m]) => k === 'error' && /別の人のログインに変わった/.test(m)));
  assert.equal((await statuses(srv))[a.code], 'pending/1');
  assert.equal(await approvals(srv), 0);
});

test('someone else approved it first: not approved again, shown as already handled', async () => {
  const srv = await server({ live: true });
  const a = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 10));
  const b = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-12', 4));
  const gm = await app(srv, 'E2');
  await gm.render();
  gm.ctx.wrSelAll(true); await gm.render();
  gm.ctx.wrBulkAsk();
  assert.equal((await act(srv, 'E2', a.id, 'approve', a.rev)).status, 200);   // another device of the GM approves a first
  gm.ctx.wrBulkGo(); await gm.settle();
  const m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /1 件承認／1 件は要再確認/);
  assert.match(m, /承認していません。もう処理されています（経理の確認待ち）/);
  assert.equal(await approvals(srv), 2, 'a once by the other device, b once here');
});
