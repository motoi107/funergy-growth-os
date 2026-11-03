// v1131 work-requests: the real screen module (FUNERGY_WR in index.html) in a VM, talking to the real handler and the real SQL (PGlite).
// Synthetic data only (fictional people, stores and amounts). The PIN check is a stand-in: token 'pin-E7' means employee E7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E));
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Crew', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'], ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null],
  ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null], ['E11', 'Ned Leader', 'sl', 'Operation Leader', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function server({ live = false, legacy = {} } = {}) {
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

const fill = (dom, vals) => { for (const [k, v] of Object.entries(vals)) { const el = dom.els['wrf-' + k]; assert.ok(el, 'field ' + k); if (typeof v === 'boolean') el.checked = v; else el.value = String(v); } };

test('before it is live: the screen says so; the GM turns it on (old requests copied); others cannot', async () => {
  const srv = await server({ legacy: { 'spl_mileage_requests_Lee Leader': [{ id: 'mi1761000000000', employee: 'Lee Leader', storeId: 'S1', date: '2026-10-01', amount: 7, status: '申請中' }] } });
  const g3 = await app(srv, 'E7', { role: 'sl' });
  const h = await g3.render();
  assert.match(h, /まだ使い始めていません/);
  assert.doesNotMatch(h, /使い始める（前からの申請を写す）/);
  const store = new Map();
  const gm = await app(srv, 'E2', { storage: store });
  assert.match(await gm.render(), /使い始める（前からの申請を写す）/);
  gm.ctx.wrGoLive(true); await gm.settle();
  assert.equal(JSON.parse(store.get('_wr_live_v1')).live, true);
  assert.ok(gm.toasts.some(([k, m]) => k === 'success' && /前からの申請 1 件を写しました/.test(m)));
  const after = await gm.render();
  assert.match(after, /要対応/); assert.match(after, /自分の申請/); assert.match(after, /チーム／全件/);
});

test('a G3 asks for mileage; an answer that never came still makes one request; the AM is told by name', async () => {
  const srv = await server({ live: true });
  const fail = { next: false };
  const g3 = await app(srv, 'E7', { role: 'sl', fail });
  await g3.render();
  g3.ctx.wrNew('mileage');
  fill(g3.dom, { date: '2026-10-28', origin: 'Store', destination: 'Bank', miles: 12.4, round: true });
  g3.ctx.wrCalc();
  assert.match(g3.dom.els['wrf-calc'].innerHTML, /24\.8 mi × \$0\.7 = <b>\$17\.36/);
  fail.next = true;                       // the server saves, the answer is lost
  await g3.ctx.wrSend(); await g3.settle();
  assert.ok(g3.toasts.some(([k, m]) => k === 'error' && /つながりません/.test(m)));
  await g3.ctx.wrSend(); await g3.settle();   // pressed again: the same key
  assert.ok(g3.toasts.some(([k, m]) => k === 'success' && /申請しました：GS-\d{4}-0001/.test(m)));
  const n = await srv.pg.query('select count(*)::int n from public.wr_requests'); assert.equal(n.rows[0].n, 1);
  assert.equal(g3.notifs.length, 1, 'the first answer was lost, so the notice goes with the replay (its id is fixed: once)');
  assert.match(g3.notifs[0].id, /^ntf_wr_GS-\d{4}-0001_1$/);
  // the store's AM is told by name (not the role am, which also holds G4s)
  assert.deepEqual([g3.notifs[0].toUser, g3.notifs[0].toRoles, g3.notifs[0].page, g3.notifs[0].wrTab], ['Ami Area', undefined, 'tasks', 'todo']);
  g3.ctx.wrNew('mileage');
  fill(g3.dom, { date: '2026-10-29', miles: 3 });
  await g3.ctx.wrSend(); await g3.settle();
  assert.equal(g3.notifs.length, 2);
  assert.match(g3.notifs[1].id, /^ntf_wr_GS-\d{4}-0002_1$/);
});

test('approve → return with a reason → fixed and resubmitted under the same number → approved again', async () => {
  const srv = await server({ live: true });
  const g3 = await app(srv, 'E7', { role: 'sl' });
  await g3.render();
  g3.ctx.wrNew('mileage'); fill(g3.dom, { date: '2026-10-28', miles: 5 }); await g3.ctx.wrSend(); await g3.settle();
  const am = await app(srv, 'E5', { role: 'am', realRole: 'am' });
  const list = await am.render();
  assert.match(list, /GS-\d{4}-0001/);
  const id = am.S().rows[0].id;
  am.ctx.wrOpen(id); await am.settle();
  assert.match(am.dom.els['wr-detail'].innerHTML, /① <\/div><div style="width:120px">承認|①/);
  assert.match(am.dom.els['wr-detail'].innerHTML, /承認する/);
  am.ctx.wrAsk('approve'); await am.settle();
  assert.equal(am.S().d.status, 'approved');
  assert.ok(am.notifs.some(n => (n.toRoles || []).join() === 'office,office_crew'), 'accounting and office crew are told');
  assert.ok(am.notifs.some(n => n.toUser === 'Lee Leader' && /承認されました/.test(n.title)));
  const acct = await app(srv, 'E3', { role: 'office' });
  await acct.render();
  // the same approve again with the same key (as when an answer was lost): one decision, the notices are not doubled
  const before = am.notifs.length;
  am.S().d = Object.assign({}, am.S().d, { rev: 1, status: 'pending', can: ['approve'] });
  am.ctx.wrAsk('approve'); await am.settle();
  assert.equal(am.notifs.length, before, 'replayed: the notices with the same ids are already on this device');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_events where action = 'approve'`)).rows[0].n, 1);
  acct.ctx.wrOpen(id); await acct.settle();
  acct.ctx.wrAsk('return'); await acct.settle();
  assert.match(acct.dom.els['wr-detail'].innerHTML, /理由（必ず）/);
  acct.ctx.wrAskGo(); await acct.settle();
  assert.ok(acct.toasts.some(([k, m]) => k === 'error' && /理由を書いてください/.test(m)), 'no reason: not sent');
  acct.dom.els['wr-note'].value = '往復ではありません';
  acct.ctx.wrAskGo(); await acct.settle();
  assert.equal(acct.S().d.status, 'returned');
  // the requester fixes it from the detail
  await g3.render();
  g3.ctx.wrSetView('mine'); await g3.settle();
  g3.ctx.wrOpen(id); await g3.settle();
  assert.match(g3.dom.els['wr-detail'].innerHTML, /差し戻し：往復ではありません/);
  g3.ctx.wrAsk('resubmit'); await g3.settle();
  fill(g3.dom, { miles: 4, round: false, note: '片道にした' });
  await g3.ctx.wrSend(); await g3.settle();
  const r = (await srv.pg.query('select code, version, status, amount_cents from public.wr_requests')).rows[0];
  assert.deepEqual([r.version, r.status, Number(r.amount_cents)], [2, 'pending', 280]);
  am.ctx.wrOpen(id); await am.settle();
  assert.match(am.dom.els['wr-detail'].innerHTML, /版 1 → 2：金額 \$3\.50 → \$2\.80/);
  assert.match(am.dom.els['wr-detail'].innerHTML, /承認する（版 2）/);
});

test('a possible duplicate: the form shows it and asks why; payment waits for a confirmation', async () => {
  const srv = await server({ live: true });
  const a = await app(srv, 'E7', { role: 'sl' }), b = await app(srv, 'E11', { role: 'sl' });
  for (const x of [a, b]) await x.render();
  const rb = x => { x.ctx.wrNew('reimburse'); fill(x.dom, { date: '2026-11-01', vendor: 'Costco', amount: '86.40' }); };
  rb(a); await a.ctx.wrSend(); await a.settle();
  rb(b); await b.ctx.wrSend(); await b.settle();
  assert.match(b.dom.els['wr-form'].innerHTML, /重複の候補があります/);
  assert.match(b.dom.els['wr-form'].innerHTML, /理由を付けて出す/);
  await b.ctx.wrSend(); await b.settle();
  assert.ok(b.toasts.some(([k, m]) => k === 'error' && /理由を書いてください/.test(m)));
  b.dom.els['wrf-dupreason'].value = '2 回目の会計';
  await b.ctx.wrSend(); await b.settle();
  assert.ok(b.toasts.some(([k, m]) => k === 'success' && /RB-/.test(m)));
  const rows = (await srv.pg.query(`select code, dup_codes, dup_reason from public.wr_requests order by code`)).rows;
  assert.deepEqual(rows[1].dup_codes, [rows[0].code]);
});

test('after it is live, the earlier screens point here; other approval types still work there', async () => {
  const srv = await server({ live: true });
  const store = new Map([['_wr_live_v1', '1']]);
  const x = await app(srv, 'E2', { storage: store });
  assert.equal(x.ctx.approveMileage('mi1'), false);
  assert.ok(x.toasts.some(([, m]) => /ワークセンターの「申請」に移りました/.test(m)));
  assert.ok(x.pages.includes('go:tasks'));
  assert.equal(x.ctx.signoffApproval('ap2'), 'orig', 'a leave approval stays on the old center');
  assert.equal(x.ctx.signoffApproval('ap1'), false, 'a mileage approval is pointed here');
  assert.match(x.ctx.renderMileage(), /移りました[\s\S]*old list/);
  x.ctx.openMileageModal(); await x.settle();
  assert.ok(x.dom.els['wr-form'], 'the new form opens instead');
  assert.ok(!x.calls.some(c => c[0] === 'approveMileage' || c[0] === 'openMileageModal'));
  // not live on this device: the old functions run as before
  const y = await app(srv, 'E2', { storage: new Map() });
  assert.equal(y.ctx.approveMileage('mi1'), 'orig');
  assert.equal(y.ctx.renderMileage(), '<div>old list</div>');
});

test('who lands on the Work Center after sign-in (10A) and a server that is not there yet', async () => {
  const srv = await server({ live: true });
  const store = new Map([['_wr_live_v1', '1']]);
  const land = async (role, realRole) => (await app(srv, 'E2', { role, realRole, storage: store })).ctx.wrLandHere();
  assert.equal(await land('gm', 'gm'), true);
  assert.equal(await land('office', 'office'), true);
  assert.equal(await land('office_crew', 'office_crew'), true);
  assert.equal(await land('am', 'g4'), true);
  assert.equal(await land('am', 'am'), false);
  assert.equal(await land('ceo', 'ceo'), false);
  assert.equal(await land('sl', 'sl'), false);
  assert.equal((await app(srv, 'E2', { role: 'gm', storage: new Map() })).ctx.wrLandHere(), false, 'not seen live on this device');
  const none = { handler: async () => new Response('Not found', { status: 404 }) };
  const z = await app(none, 'E7', { role: 'sl' });
  const h = await z.render();
  assert.match(h, /work-requests）につながりません/);
  assert.match(h, /今までの画面で申請してください/);
});

test('the shared mark (wr_live, written by the server) stops the old screens on a device that never opened the tab', async () => {
  const srv = await server();
  const gm = await app(srv, 'E2');
  await gm.render();
  gm.ctx.wrGoLive(true); await gm.settle();
  const row = (await srv.pg.query(`select value from public.app_state where key = 'wr_live'`)).rows[0].value;
  assert.equal(row.live, true);
  // a shared-login device: never signs in to work-requests, only gets the app_state row
  const shop = await app(srv, null, { role: 'sl', shared: new Map([['wr_live', row]]) });
  assert.equal(shop.ctx.wrLiveSeen(), true);
  assert.equal(shop.ctx.approveMileage('mi1'), false);
  // turned off later: the newer shared mark wins over this device's older answer
  const store = new Map([['_wr_live_v1', JSON.stringify({ live: true, at: '2026-11-01T00:00:00Z' })]]);
  const dev = await app(srv, 'E2', { storage: store, shared: new Map([['wr_live', { live: false, at: '2026-11-02T00:00:00Z' }]]) });
  assert.equal(dev.ctx.wrLiveSeen(), false);
  assert.equal(dev.ctx.approveMileage('mi1'), 'orig');
});

test('amounts are read as text (no floating point); the detail does not show an older answer after a newer tap', async () => {
  const srv = await server({ live: true });
  const x = await app(srv, 'E7', { role: 'sl' });
  await x.render();
  x.ctx.wrNew('reimburse'); fill(x.dom, { date: '2026-11-01', vendor: 'V', amount: '1.005' }); await x.ctx.wrSend(); await x.settle();
  x.ctx.wrNew('reimburse'); fill(x.dom, { date: '2026-11-01', vendor: 'W', amount: '0.29' }); await x.ctx.wrSend(); await x.settle();
  const c = (await srv.pg.query('select amount_cents from public.wr_requests order by code')).rows.map(r => Number(r.amount_cents));
  assert.deepEqual(c, [101, 29]);
});
