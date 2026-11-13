// v1155 workcenter step 2 (UI proposal 72, Moto's answers 11/13): the old 承認-tab kinds and budgets go to the server-side requests.
// The real screen module (FUNERGY_WR in index.html) in a VM, talking to the real handler and the real SQL (stage 1 → v1135 + stage 2, PGlite).
// The earlier screens (leave, budget, plan, …) are stand-ins that keep their own records, like the app does.
// Synthetic data only (fictional people, stores and amounts). The PIN check is a stand-in: token 'pin-E7' means employee E7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = SRC.slice(SRC.indexOf(B), SRC.indexOf(E));
const MIG = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2']
  .map(f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8')).join('\n');
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return SRC.slice(m.index, i + 1);
  }
  throw new Error('unterminated: ' + name);
}

async function server({ s2 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.5}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  await pg.exec(MIG);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  const call = async (who, body) => { const r = await handler(new Request('https://db.test/functions/v1/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, j: await r.json() }; };
  if (s2) { const w = (await call('E2', { action: 'whoami' })).j; assert.equal((await call('E2', { action: 's2_save', s2: true, expect_rev: w.settings_rev })).status, 200); }
  return { pg, handler, call };
}

// The earlier screens, as stand-ins that keep their own records (shared between the test devices like synced data).
const OLD = `
function ls(k, d){ var v = __st[k]; return v === undefined ? d : JSON.parse(JSON.stringify(v)); }
function lsSet(k, v){ __st[k] = JSON.parse(JSON.stringify(v)); }
function todayJP(){ return '2026/11/13'; }
async function apPullLatest(){ if (__st.pull) { var f = __st.pull; __st.pull = null; f(); } }
function _apOldNotif(rec){ __st.old.push(rec.id); }
function __ap(id, st, why){ var aps = ls('approvals', []), a = aps.find(function(x){ return x.id === id; }); if (a) { a.status = st; if (why) a.rejectReason = why; lsSet('approvals', aps); } return a; }
function __apRef(type, ref, ym, st){ var aps = ls('approvals', []); aps.forEach(function(a){ if (a.type === type && String(a.ref) === String(ref) && (!ym || a.ym === ym) && a.status === 'pending') a.status = st; }); lsSet('approvals', aps); }
async function approveItem(id, status, reason, opt){ __st.calls.push(['approveItem', id, status]); if (__st.noop) return; var a = __ap(id, status, reason); if (a) apNotifyDecision(a, status, {}); }
function signoffApproval(id){ __st.calls.push(['signoffApproval', id]); }
function rejectApprovalItem(id){ __st.calls.push(['rejectApprovalItem', id]); }
function overrideApproveAll(id){ __st.calls.push(['overrideApproveAll', id]); }
function apFinalize(id){ __st.calls.push(['apFinalize', id]); }
function cancelMySignoff(id){ __st.calls.push(['cancelMySignoff', id]); }
function approveVacation(id){ __st.calls.push(['approveVacation', id]); }
function rejectVacation(id){ __st.calls.push(['rejectVacation', id]); }
function getBudgets(){ return __st.budgets; }
function budStatusFor(b, ym){ return (b.st || {})[ym] || '提出済み'; }
function monthSalesBudget(store, ym){ return __st.msb[store + '|' + ym] || 0; }
function getBudgetForMonth(){ return null; }
function budRationale(){ return { basis:'前年 +3%', focus:'ランチの客数' }; }
function approveBudgetSeg(store, ym){ __st.calls.push(['approveBudgetSeg', store, ym]); var b = __st.budgets.find(function(x){ return x.storeId === store; }); b.st = b.st || {}; b.st[ym] = '承認済み'; __apRef('予算', store, ym, 'approved'); }
function rejectBudgetSeg(store, ym){ openInputModal({ title:'差し戻し' }, function(why){ __st.calls.push(['rejectBudgetSeg', store, ym, why]); var b = __st.budgets.find(function(x){ return x.storeId === store; }); b.st = b.st || {}; b.st[ym] = '差し戻し'; __apRef('予算', store, ym, 'rejected'); }); }
function openInputModal(){ __st.calls.push(['openInputModal']); }
function ccPlan(ym){ return __st.plans[ym] || null; }
function ccApprove(ym){ __st.calls.push(['ccApprove', ym]); __st.plans[ym].status = '承認済'; __apRef('月間行動計画', ym, null, 'approved'); }
function ccReturn(ym){ var why = prompt('理由'); if (!why) return; __st.calls.push(['ccReturn', ym, why]); __st.plans[ym].status = '差し戻し'; __apRef('月間行動計画', ym, null, 'rejected'); }
function getVacations(){ return [{ id:'vac1', employee:'Lee Leader', startDate:'2026-12-01', endDate:'2026-12-02', type:'有給', reason:'家族の用事' }]; }
function getOffboardings(){ return []; }
function getLssRequests(){ return []; }
function approveLssRequest(id, d){ __st.calls.push(['approveLssRequest', id, d]); }
function approveTip(id, d){ __st.calls.push(['approveTip', id, d]); }
function apNotifyDecision(a, status, opt){ __st.calls.push(['apNotifyDecision', a && a.id, status, !!(opt && opt.noAcct)]); }
function apNotifyAcctApplied(){ __st.calls.push(['apNotifyAcctApplied']); }
function _apMarkDecided(a, status){ __st.calls.push(['_apMarkDecided', a && a.id, status]); }
`;

function fakeDom() {
  const els = {};
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tagName, a1, id, a2] = m, attrs = a1 + a2;
      const el = els[id] || (els[id] = mkEl(id));
      if (tagName === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? v[1] : ''; el.checked = /\bchecked\b/.test(attrs); }
      if (tagName === 'textarea') { const rest = h.slice(m.index + m[0].length); el.value = rest.slice(0, rest.indexOf('</textarea>')); }
    }
  };
  function mkEl(id) { let ih = ''; return { id, value: '', checked: false, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); } }; }
  return { els, parse };
}

function shared() {
  return { approvals: [], budgets: [{ storeId: 'S1', st: {} }], plans: {}, msb: {}, old: [], calls: [],
    wr_live: { live: true, s2: true, at: '2026-11-13T00:00:00.000Z' } };
}

async function app(srv, emp, st, { role = 'gm', storage = new Map(), net = { down: false } } = {}) {
  const dom = fakeDom(), toasts = [], notifs = [], pages = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null, __st: st,
    curPage: 'tasks', workTab: 'wr', curRole: role, curRealRole: '', STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: (ja) => ja, bizNow: () => new Date('2026-11-13T10:00:00'), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: p => pages.push(p), go: p => pages.push('go:' + p), showToast: (m, k) => toasts.push([k, m]), addNotif: n => notifs.push(JSON.parse(JSON.stringify(n))), getNotifs: () => notifs,
    openModal: h => dom.parse(h), closeModal: () => {}, closeModalDirect: () => {},
    confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }],
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: async (url, init) => { if (net.down) throw new TypeError('offline'); return srv.handler(new Request(url, init)); },
    document: { getElementById: id => dom.els[id] || null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(OLD, ctx);
  vm.runInContext(fnSrc('addApproval'), ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { ctx.renderWrTab(); await settle(); return ctx.renderWrTab(); };
  const open = async id => { ctx.wrOpen(id); await settle(); return dom.els['wr-detail'].innerHTML; };
  return { ctx, dom, toasts, notifs, pages, settle, render, open, S: () => ctx._wrState(), storage, net };
}

async function submit(srv, emp, kind, store, payload) {
  const r = await srv.call(emp, { action: 'submit', kind, store_id: store, payload, client_key: 'k-' + Math.random().toString(36).slice(2) });
  assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j;
}
const mil = (d, miles) => ({ date: d, purpose: '銀行・郵便', origin: 'Store', destination: 'Bank', one_way_miles: miles, round_trip: true });
const rb = (d, cents) => ({ date: d, payer: 'Lee Leader', payer_is_employee: true, vendor: 'Costco ' + cents, purpose: '消耗品', amount_cents: cents, receipt: null });
const rows = async srv => Object.fromEntries((await srv.pg.query('select code, kind, status, version, amount_cents from public.wr_requests order by code')).rows.map(r => [r.code, r]));
const events = async (srv, action) => (await srv.pg.query(`select count(*)::int n from public.wr_events where action = $1`, [action])).rows[0].n;
// Arrays made inside the VM have another prototype: compare their JSON.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const apOf = (st, id) => st.approvals.find(a => a.id === id);

test('acceptance: a reimbursement $80 + mileage $20 + a budget $1,000 → 3 selected / to pay $100 / budget $1,000; the budget only after it is opened; the budget is applied right after', async () => {
  const srv = await server(), st = shared();
  st.msb['S1|2026-12'] = 1000;
  const a = await submit(srv, 'E7', 'reimburse', 'S1', rb('2026-11-10', 8000));
  const b = await submit(srv, 'E7', 'mileage', 'S1', mil('2026-11-11', 20));
  assert.equal(b.amount_cents, 2000, '20 miles each way × 2 × $0.50');
  // the store manager submits the budget on the budget screen: the old screen keeps its record and the request goes to the server
  const sm = await app(srv, 'E6', st, { role: 'sl' });
  sm.ctx.addApproval({ id: 'ap1700000001', type: '予算', ref: 'S1', ym: '2026-12', store: 'S1', title: 'Store One 2026-12 予算', from: 'Sam Store' });
  await sm.settle();
  const ap = apOf(st, 'ap1700000001');
  assert.equal(ap.wrq, 1); assert.match(ap.wrc, /^BG-/);
  deq(st.old, [], 'no notice from the old approval center');
  assert.ok(sm.notifs.some(n => (n.toRoles || []).includes('gm') && /承認待ち：予算/.test(n.title)));
  deq(sm.ctx._wrS2Queue(), []);
  const bg = (await rows(srv))[ap.wrc];
  assert.equal(bg.kind, 'budget'); assert.equal(Number(bg.amount_cents), 100000);

  const gm = await app(srv, 'E2', st);
  let h = await gm.render();
  gm.ctx.wrSelAll(true); h = await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 2, 'the budget is not picked before it is opened');
  assert.match(h, /予算 1 件はまだ開いていない/);
  const det = await gm.open(gm.S().rows.find(r => r.code === ap.wrc).id);
  assert.match(det, /予算承認額（月の売上予算）/); assert.match(det, /\$1,000\.00/);
  gm.ctx.wrSelAll(true); h = await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 3);
  assert.match(h, /選択 3 件/);
  assert.match(h, /精算対象 <b>\$100\.00<\/b>/);
  assert.match(h, /予算承認額 <b>\$1,000\.00<\/b>/);
  gm.ctx.wrBulkAsk();
  const m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /3 件を承認します/);
  assert.match(m, /3 件・精算対象 <b>\$100\.00<\/b>・予算承認額 <b>\$1,000\.00<\/b>/, '3 / to pay $100 / budget $1,000');
  gm.ctx.wrBulkGo(); await gm.settle();
  const done = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(done, /3 件承認/);
  assert.match(done, /反映しました（経理の確認待ち）/);
  const r = await rows(srv);
  assert.equal(r[a.code].status, 'approved'); assert.equal(r[b.code].status, 'approved');
  assert.equal(r[ap.wrc].status, 'acct', 'the budget was applied and waits for accounting (予算反映済み)');
  deq(st.calls.filter(c => c[0] === 'approveBudgetSeg'), [['approveBudgetSeg', 'S1', '2026-12']], 'applied once with the earlier screen');
  assert.equal(st.budgets[0].st['2026-12'], '承認済み');
  assert.ok(gm.notifs.some(n => (n.toRoles || []).includes('office') && /予算の反映待ち（経理）/.test(n.title)));
  assert.equal(await events(srv, 'apply_done'), 1);
});

test('the bridge: one request per old record; offline it is kept and the old notice goes out once; it is sent on the next look; a server that refuses keeps the old way', async () => {
  const srv = await server(), st = shared(), net = { down: true };
  const lee = await app(srv, 'E7', st, { role: 'sl', net });
  lee.ctx.addApproval({ id: 'ap1700000002', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇 12/1〜12/2', from: 'Lee Leader' });
  await lee.settle();
  assert.equal(apOf(st, 'ap1700000002').wrq, undefined, 'not marked while offline');
  deq(st.old, ['ap1700000002'], 'the old notice goes out (so the approver still knows)');
  assert.equal(lee.ctx._wrS2Queue().length, 1, 'kept on this device');
  lee.ctx.wrPing(); await lee.settle();
  deq(st.old, ['ap1700000002'], 'not twice');
  net.down = false;
  lee.ctx.wrPing(); await lee.settle();
  const ap = apOf(st, 'ap1700000002');
  assert.equal(ap.wrq, 1); assert.match(ap.wrc, /^LV-/);
  deq(lee.ctx._wrS2Queue(), []);
  // sent again (another device, the same old record): still one request
  const other = await app(srv, 'E7', st, { role: 'sl' });
  const st0 = JSON.parse(JSON.stringify(ap)); st0.wrq = undefined;
  other.ctx.wrS2Take(st0); await other.settle();
  assert.equal(Object.values(await rows(srv)).filter(x => x.kind === 'leave').length, 1);
  const lv = (await rows(srv))[ap.wrc];
  assert.equal(lv.status, 'pending');
  // stage 2 turned off on the server: the request is refused, the old approval center keeps it
  const srv2 = await server({ s2: false }), st2 = shared();
  const lee2 = await app(srv2, 'E7', st2, { role: 'sl' });
  lee2.ctx.addApproval({ id: 'ap1700000003', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇', from: 'Lee Leader' });
  await lee2.settle();
  assert.equal(apOf(st2, 'ap1700000003').wrq, undefined);
  deq(st2.old, ['ap1700000003']);
  deq(lee2.ctx._wrS2Queue(), [], 'not kept: it is the old way now');
  // a device that has not heard stage 2 is on takes the old way right away
  const st3 = shared(); st3.wr_live = { live: true, s2: false, at: '2026-11-13T00:00:00.000Z' };
  const lee3 = await app(srv, 'E7', st3, { role: 'sl' });
  lee3.ctx.addApproval({ id: 'ap1700000004', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇', from: 'Lee Leader' });
  deq(st3.old, ['ap1700000004']);
  assert.equal(lee3.ctx.wrS2Take({ id: 'ap1700000005', type: 'ガソリン代', status: 'pending', store: 'S1' }), false, 'stage 1 kinds are not taken here');
});

test('the old approval tab is closed for these requests; only the apply on this screen may call the old decision, once', async () => {
  const srv = await server(), st = shared();
  const lee = await app(srv, 'E7', st, { role: 'sl' });
  lee.ctx.addApproval({ id: 'ap1700000010', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇 12/1〜12/2', from: 'Lee Leader' });
  await lee.settle();
  const ap = apOf(st, 'ap1700000010');
  const gm = await app(srv, 'E2', st);
  for (const n of ['approveItem', 'signoffApproval', 'rejectApprovalItem', 'overrideApproveAll', 'apFinalize', 'cancelMySignoff']) {
    assert.equal(await gm.ctx[n](ap.id, 'approved'), false, n + ' is stopped');
  }
  assert.equal(gm.ctx.approveVacation('vac1'), false); assert.equal(gm.ctx.rejectVacation('vac1'), false);
  deq(st.calls, [], 'none of the old decisions ran');
  assert.ok(gm.toasts.some(([k, m]) => k === 'info' && m.includes(ap.wrc) && /ワークセンター/.test(m)));
  // the GM approves it here: the leave is applied right after with the old decision (it tells the requester; accounting is told from here)
  await gm.render();
  const id = gm.S().rows.find(r => r.code === ap.wrc).id;
  let h = await gm.open(id);
  assert.match(h, /期間/); assert.match(h, /2026-12-01 〜 2026-12-02/); assert.match(h, /前の画面の記録/);
  gm.ctx.wrAsk('approve'); await gm.settle();
  deq(st.calls.filter(c => c[0] === 'approveItem'), [['approveItem', ap.id, 'approved']]);
  deq(st.calls.filter(c => c[0] === 'apNotifyDecision'), [['apNotifyDecision', ap.id, 'approved', true]], 'the old accounting notice is not sent (noAcct)');
  assert.equal(apOf(st, ap.id).status, 'approved');
  assert.equal((await rows(srv))[ap.wrc].status, 'acct');
  assert.ok(gm.notifs.some(n => (n.toRoles || []).includes('office') && /経理の確認待ち：休暇/.test(n.title)));
  // after the apply the old record is decided: nothing can approve it again from the old tab (the guard is only for pending ones)
  assert.equal(gm.ctx.approveVacation('vac1'), undefined);
  assert.equal(st.calls.filter(c => c[0] === 'approveItem').length, 1);
});

test('apply outcomes: already approved elsewhere → recorded without writing; rejected elsewhere → not applied; a check left open → the claim stays; a different budget → stopped', async () => {
  const srv = await server(), st = shared();
  const lee = await app(srv, 'E7', st, { role: 'sl' });
  for (const n of [20, 21, 22]) lee.ctx.addApproval({ id: 'ap17000000' + n, type: 'シフト変更', store: 'S1', title: 'シフト変更 ' + n, from: 'Lee Leader' });
  await lee.settle();
  const gm = await app(srv, 'E2', st);
  await gm.render();
  const rowOf = n => gm.S().rows.find(r => r.code === apOf(st, 'ap17000000' + n).wrc);
  // 20: another device already approved it on the old screen (it reached this device on the pull before writing)
  st.pull = () => { const aps = st.approvals; aps.find(a => a.id === 'ap1700000020').status = 'approved'; };
  await gm.open(rowOf(20).id); gm.ctx.wrAsk('approve'); await gm.settle();
  assert.equal(st.calls.filter(c => c[0] === 'approveItem').length, 0, 'not written again');
  assert.equal((await rows(srv))[apOf(st, 'ap1700000020').wrc].status, 'applied', 'recorded (a shift change has no accounting step)');
  // 21: rejected on another device
  st.pull = () => { st.approvals.find(a => a.id === 'ap1700000021').status = 'rejected'; };
  await gm.open(rowOf(21).id); gm.ctx.wrAsk('approve'); await gm.settle();
  assert.equal((await rows(srv))[apOf(st, 'ap1700000021').wrc].status, 'apply_error');
  assert.equal(st.calls.filter(c => c[0] === 'approveItem').length, 0);
  // 22: the old decision did not finish (a check screen was closed): nothing recorded, this device keeps the claim
  st.noop = true;
  await gm.open(rowOf(22).id); gm.ctx.wrAsk('approve'); await gm.settle();
  const r22 = (await rows(srv))[apOf(st, 'ap1700000022').wrc];
  assert.equal(r22.status, 'approved');
  const g22 = (await srv.call('E2', { action: 'get', code: r22.code })).j;
  assert.ok((g22.can || []).includes('apply_done'), 'still held by this device');
  assert.ok(gm.toasts.some(([k, m]) => k === 'info' && /まだ反映していません/.test(m)));
  st.noop = false;
  gm.ctx.wrEvalApply(); await gm.settle();
  assert.equal((await rows(srv))[r22.code].status, 'applied', 'pressed again: applied and recorded');
  assert.equal(st.calls.filter(c => c[0] === 'approveItem').length, 2, 'the first (unfinished) call and this one');

  // a budget whose amount on this device differs from the approved version: stopped, nothing written, the claim let go
  st.msb['S1|2026-12'] = 1000;
  const sm = await app(srv, 'E6', st, { role: 'sl' });
  sm.ctx.addApproval({ id: 'ap1700000030', type: '予算', ref: 'S1', ym: '2026-12', store: 'S1', title: '予算', from: 'Sam Store' });
  await sm.settle();
  const code = apOf(st, 'ap1700000030').wrc;
  st.msb['S1|2026-12'] = 1200;   // changed on this device after the store submitted
  gm.ctx.wrRefresh(); await gm.settle();
  await gm.open(gm.S().rows.find(r => r.code === code).id);
  gm.ctx.wrAsk('approve'); await gm.settle();
  assert.equal(st.calls.filter(c => c[0] === 'approveBudgetSeg').length, 0);
  assert.equal((await rows(srv))[code].status, 'approved');
  assert.equal(await events(srv, 'apply_cancel'), 1);
  assert.ok(gm.toasts.some(([k, m]) => k === 'warning' && /\$1,200\.00/.test(m) && /\$1,000\.00/.test(m)));
});

test('a budget changed later is a new version of the same number; the bulk box needs the new version opened again', async () => {
  const srv = await server(), st = shared();
  st.msb['S1|2026-12'] = 1000;
  const sm = await app(srv, 'E6', st, { role: 'sl' });
  sm.ctx.addApproval({ id: 'ap1700000040', type: '予算', ref: 'S1', ym: '2026-12', store: 'S1', title: '予算', from: 'Sam Store' });
  await sm.settle();
  const code = apOf(st, 'ap1700000040').wrc;
  const gm = await app(srv, 'E2', st);
  await gm.render();
  await gm.open(gm.S().rows.find(r => r.code === code).id);
  gm.ctx.wrSelAll(true); await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 1);
  // the store raises the budget before the GM approves: the budget screen sends it again (same store and month)
  st.msb['S1|2026-12'] = 1100;
  sm.ctx.wrS2Take(apOf(st, 'ap1700000040')); await sm.settle();
  const r = (await rows(srv))[code];
  assert.equal(r.version, 2); assert.equal(Number(r.amount_cents), 110000);
  assert.ok(sm.notifs.some(n => /承認待ち：予算/.test(n.title) && /_2$|_[0-9]+$/.test(n.id)));
  gm.ctx.wrRefresh(); await gm.settle(); let h = gm.ctx.renderWrTab();
  assert.equal(Object.keys(gm.S().sel).length, 0, 'the pick of version 1 is dropped');
  gm.ctx.wrSelAll(true); h = await gm.render();
  assert.equal(Object.keys(gm.S().sel).length, 0, 'version 2 is not opened yet');
  const det = await gm.open(gm.S().rows.find(x => x.code === code).id);
  assert.match(det, /前に承認した版|版 2/);
  gm.ctx.wrSelAll(true); h = await gm.render();
  assert.match(h, /予算承認額 <b>\$1,100\.00<\/b>/);
});

test('reject and return here also close the earlier record (leave, budget, monthly plan)', async () => {
  const srv = await server(), st = shared();
  st.msb['S1|2026-12'] = 1000; st.plans['2026-12'] = { status: '提出済' };
  const lee = await app(srv, 'E7', st, { role: 'sl' });
  lee.ctx.addApproval({ id: 'ap1700000050', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇', from: 'Lee Leader' });
  const sm = await app(srv, 'E6', st, { role: 'sl' });
  sm.ctx.addApproval({ id: 'ap1700000051', type: '予算', ref: 'S1', ym: '2026-12', store: 'S1', title: '予算', from: 'Sam Store' });
  sm.ctx.addApproval({ id: 'ap1700000052', type: '月間行動計画', ref: '2026-12', ym: '2026-12', store: 'S1', title: '12 月の行動計画', from: 'Sam Store' });
  await sm.settle(); await lee.settle();
  const gm = await app(srv, 'E2', st);
  await gm.render();
  const decide = async (apId, op, why) => {
    await gm.open(gm.S().rows.find(r => r.code === apOf(st, apId).wrc).id);
    gm.ctx.wrAsk(op); gm.dom.els['wr-note'].value = why; gm.ctx.wrAskGo(); await gm.settle();
  };
  await decide('ap1700000050', 'reject', '人が足りない日');
  deq(st.calls.filter(c => c[0] === 'approveItem'), [['approveItem', 'ap1700000050', 'rejected']]);
  assert.equal(apOf(st, 'ap1700000050').status, 'rejected'); assert.equal(apOf(st, 'ap1700000050').rejectReason, '人が足りない日');
  await decide('ap1700000051', 'return', 'ランチの根拠を足して');
  deq(st.calls.filter(c => c[0] === 'rejectBudgetSeg'), [['rejectBudgetSeg', 'S1', '2026-12', 'ランチの根拠を足して']]);
  assert.equal(st.calls.filter(c => c[0] === 'openInputModal').length, 0, 'the reason is passed, no input box');
  assert.equal(st.budgets[0].st['2026-12'], '差し戻し');
  assert.equal((await rows(srv))[apOf(st, 'ap1700000051').wrc].status, 'returned');
  await decide('ap1700000052', 'reject', '数字を見直して');
  deq(st.calls.filter(c => c[0] === 'ccReturn'), [['ccReturn', '2026-12', '数字を見直して']]);
  assert.equal(st.plans['2026-12'].status, '差し戻し');
  assert.equal(gm.toasts.filter(([k, m]) => /まだ「申請中」/.test(m)).length, 0);
});

test('withdrawn on the earlier screen by the requester: withdrawn here too', async () => {
  const srv = await server(), st = shared();
  const lee = await app(srv, 'E7', st, { role: 'sl' });
  lee.ctx.addApproval({ id: 'ap1700000060', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇', from: 'Lee Leader' });
  await lee.settle();
  const ap = apOf(st, 'ap1700000060');
  lee.ctx._apMarkDecided(ap, 'withdrawn'); await lee.settle();
  assert.equal((await rows(srv))[ap.wrc].status, 'withdrawn');
  // someone else's device does not withdraw it (the server checks the owner)
  lee.ctx.addApproval({ id: 'ap1700000061', type: '休暇', ref: 'vac1', store: 'S1', title: '休暇', from: 'Lee Leader' });
  await lee.settle();
  const gm = await app(srv, 'E2', st);
  gm.ctx._apMarkDecided(apOf(st, 'ap1700000061'), 'withdrawn'); await gm.settle();
  assert.equal((await rows(srv))[apOf(st, 'ap1700000061').wrc].status, 'pending');
});

test('the mark (wrq) survives a merge with an older copy without it, in either order', () => {
  const ctx = {};
  vm.createContext(ctx);
  for (const n of ['_apDecided', '_apTs', '_apUnionSignoffs', '_apMut', '_apGen', '_apAcctOn', '_apStT', '_apSoT', '_apSigBody', '_apMergeOne', '_apMergeOne0', 'mergeApprovals', '_rtStK', '_rtDecRank'])
    vm.runInContext(fnSrc(n), ctx);
  const base = { id: 'ap1', type: '休暇', status: 'pending', signoffs: [], _mut: 100 };
  const marked = { ...base, wrq: 1, wrc: 'LV-2611-0001', _mut: 101 };
  const newerPlain = { ...base, title: 'edited on an old app', _mut: 105 };
  for (const [c, l] of [[[marked], [newerPlain]], [[newerPlain], [marked]]]) {
    const out = ctx.mergeApprovals(c, l)[0];
    assert.equal(out.wrq, 1); assert.equal(out.wrc, 'LV-2611-0001');
    assert.ok(out._mut > 105, 'the merged copy is newer than the unmarked one (an old app picks it)');
  }
  const out2 = ctx.mergeApprovals([marked], [{ ...marked }])[0];
  assert.equal(out2._mut, 101, 'nothing changes when both are marked');
  assert.notEqual(ctx._apSigBody(marked), ctx._apSigBody(base), 'the write check sees the mark');
});

test('the old lists leave these requests to the work center; the version is 1155', () => {
  const add = fnSrc('addApproval');
  assert.match(add, /window\.wrS2Take\(rec\)/); assert.match(add, /if\(!_s2\) _apOldNotif\(rec\)/);
  assert.match(fnSrc('mdPendingApprovals'), /a\.status !== 'pending' \|\| a\.wrq/);
  assert.match(SRC, /var approvalsAll = ls\('approvals', \[\]\)\.filter\(a=>a\.status==='pending' && !a\.wrq\)/);
  assert.match(SRC, /var pend = ls\('approvals',\[\]\)\.filter\(function\(a\)\{return a\.status==='pending' && !a\.wrq;\}\)/);
  assert.match(fnSrc('renderApproval'), /ワークセンターで処理中（段階 2）/);
  assert.match(fnSrc('renderApproval'), /pending = pending\.filter\(function\(a\)\{ return !\(a && a\.wrq\); \}\);/, 'the old approval tab does not offer them');
  assert.match(SRC, /if \(pid==='approval'\) return ls\('approvals', \[\]\)\.filter\(a=>a\.status==='pending' && !a\.wrq\)\.length;/, 'not counted on the old tab badge');
  assert.match(SRC, /const APP_VERSION = '1155';/); assert.match(SW, /const SW_BUILD = '1155';/);
});

test('the shape the device sends passes the server (a long note is cut, not refused)', async () => {
  const srv = await server(), st = shared();
  const lee = await app(srv, 'E7', st, { role: 'sl' });
  lee.ctx.addApproval({ id: 'ap1700000070', type: 'スキル', store: 'S1', title: 'x'.repeat(400), from: 'Lee Leader', position: 'Grill', fromLevel: 1, reqLevel: 2, selfComment: 'y'.repeat(900) });
  await lee.settle();
  const ap = apOf(st, 'ap1700000070');
  assert.match(ap.wrc || '', /^SK|^S[A-Z]-/, 'sent');
  const g = (await srv.call('E7', { action: 'get', code: ap.wrc })).j;
  assert.equal(g.payload.title.length, 200);
  assert.ok(g.payload.facts.every(f => f.v.length <= 200));
});

test('the old budget, monthly plan, Leadership and Tip buttons are stopped too; the bridge keeps one old notice across a reload; only the sign-in that made it sends it', async () => {
  const srv = await server(), st = shared();
  st.msb['S1|2026-12'] = 1000; st.plans['2026-12'] = { status: '提出済' };
  const sm = await app(srv, 'E6', st, { role: 'sl' });
  sm.ctx.addApproval({ id: 'ap1700000060', type: '予算', ref: 'S1', ym: '2026-12', store: 'S1', title: '予算', from: 'Sam Store' });
  sm.ctx.addApproval({ id: 'ap1700000061', type: '月間行動計画', ref: '2026-12', ym: '2026-12', store: '---', title: '計画', from: 'Sam Store' });
  sm.ctx.addApproval({ id: 'ap1700000062', type: 'Leadership', ref: 'lr1', store: 'S1', title: '昇格', from: 'Sam Store' });
  sm.ctx.addApproval({ id: 'ap1700000063', type: 'TipRate', ref: 'tq1', store: 'S1', title: 'Tip Rate', from: 'Sam Store' });
  await sm.settle();
  for (const id of ['ap1700000060', 'ap1700000061', 'ap1700000062', 'ap1700000063']) assert.equal(apOf(st, id).wrq, 1, id);
  const gm = await app(srv, 'E2', st);
  assert.equal(gm.ctx.approveBudgetSeg('S1', '2026-12'), false); assert.equal(gm.ctx.rejectBudgetSeg('S1', '2026-12'), false);
  assert.equal(gm.ctx.ccApprove('2026-12'), false); assert.equal(gm.ctx.ccReturn('2026-12'), false);
  assert.equal(gm.ctx.approveLssRequest('lr1', '承認'), false); assert.equal(await gm.ctx.approveTip('tq1', '承認'), false);
  deq(st.calls, [], 'none of the old decisions ran');
  assert.equal(st.budgets[0].st['2026-12'], undefined);
  // another month of the same store is not this request: the old screen still works for it
  gm.ctx.approveBudgetSeg('S1', '2027-01');
  deq(st.calls.filter(c => c[0] === 'approveBudgetSeg'), [['approveBudgetSeg', 'S1', '2027-01']]);

  // offline: one old notice, kept across a reload of the same device (the queue says it was told)
  const net = { down: true }, storage = new Map(), st2 = shared();
  const lee = await app(srv, 'E7', st2, { role: 'sl', net, storage });
  lee.ctx.addApproval({ id: 'ap1700000070', type: 'シフト変更', store: 'S1', title: 'シフト変更', from: 'Lee Leader' });
  await lee.settle();
  deq(st2.old, ['ap1700000070']);
  await lee.ctx._wrS2Push(lee.ctx._wrS2Queue()[0]); await lee.settle();
  const again = await app(srv, 'E7', st2, { role: 'sl', net, storage });
  await again.ctx._wrS2Push(again.ctx._wrS2Queue()[0]); await again.settle();
  deq(st2.old, ['ap1700000070'], 'still one notice (also after a reload)');
  assert.equal(again.ctx._wrS2Queue().length, 1);
  // the old record was decided elsewhere before the device came back: the kept request is dropped, not sent
  st2.approvals.find(a => a.id === 'ap1700000070').status = 'approved';
  net.down = false;
  again.ctx.wrPing(); await again.settle();
  deq(again.ctx._wrS2Queue(), [], 'dropped');
  assert.equal(Object.values(await rows(srv)).filter(x => x.kind === 'shift').length, 0, 'not sent');
  // another person signed in on this device: a request kept for someone else is not sent (or told) with this sign-in
  st2.approvals.push({ id: 'ap1700000071', type: 'シフト変更', status: 'pending', store: 'S1', title: 'x', from: 'Lee Leader' });
  const gm2 = await app(srv, 'E2', st2, { storage });
  const q = { ap: 'ap1700000071', kind: 'shift', store: 'S1', key: 'ap-ap1700000071-s2', ak: 'p|E7', at: Date.now(), payload: { ap_id: 'ap1700000071', title: 'x' } };
  assert.equal(await gm2.ctx._wrS2Push(q), null);
  assert.equal(Object.values(await rows(srv)).filter(x => x.kind === 'shift').length, 0);
  deq(st2.old, ['ap1700000070'], 'no notice made for the other person');
});
