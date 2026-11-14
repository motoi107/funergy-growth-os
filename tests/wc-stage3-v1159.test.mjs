// v1159 workcenter step 3 (UI proposal 74, Moto's answers 11/13 18:42 HST: 1A 2A 3B 4): the old 承認 tab closes and its records are copied (pending → pending, 2026 decisions → read-only history).
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
const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = SRC.slice(SRC.indexOf(B), SRC.indexOf(E));
const MIG = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2', '20261123090000_work_requests_stage3']
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

async function server({ s2 = true, s3 = true } = {}) {
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
  await pg.exec(s3 ? MIG : MIG.slice(0, MIG.indexOf('-- v1159')));
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
// the day-by-day budget: none unless a test sets __st.days[store|ym] (then the budget screen has a budget for the month)
function getBudgetForMonth(store, ym){ var d = (__st.days || {})[store + '|' + ym]; return d ? { days:d } : null; }
function budgetAuthorLabel(){ return 'store'; }
function getDailyActuals(){ return {}; }
function dayBudgetFor(b, date){ return (b.days || {})[date] || 0; }
function daysOfYm(ym){ var y = +ym.slice(0, 4), m = +ym.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), o = []; for (var i = 1; i <= n; i++) o.push({ date:ym + '-' + String(i).padStart(2, '0') }); return o; }
function budRationale(){ return __st.ra || { basis:'前年 +3%', focus:'ランチの客数' }; }
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


const T26 = Date.parse('2026-10-20T20:00:00Z');
const AP = (n, over = {}) => ({ id: 'ap' + (T26 + n), type: '休暇', title: '休暇の申請 ' + n, store: 'S1', from: 'Lee Leader', status: 'pending', date: '2026/10/20', ref: 'vac1', _mut: T26 + n, ...over });
// 共通データ（クラウド）の approvals：サーバーが状態を読む。端末の写し（st.approvals）と同じにする
async function cloud(srv, aps) { await srv.pg.exec('reset role'); await srv.pg.query(`insert into public.app_state(key, value) values ('approvals', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(aps)]); await srv.pg.exec('set role service_role'); }

test('GM login with stage 3: the old tab closes on this device; pending → work center pending (marked like stage 2); 2026 decisions → history; once only', async () => {
  const srv = await server(), st = shared();
  const pend = AP(1), dec = AP(2, { type: 'スキル', title: 'Grill Lv 2', status: 'approved', decidedBy: 'Ami Area', decidedAt: '2026-10-22T19:00:00.000Z', position: 'Grill', fromLevel: 1, reqLevel: 2 });
  const old = AP(3, { id: 'ap' + Date.parse('2025-10-01T20:00:00Z'), status: 'rejected', decidedAt: '2025-10-02T20:00:00.000Z' });
  const other = AP(4, { type: '経費' });
  st.approvals = [pend, dec, old, other]; await cloud(srv, st.approvals);
  const g = await app(srv, 'E2', st);
  assert.equal(g.ctx.wrS3Seen(), false, 'before this device has heard from the server');
  await g.render();
  assert.equal(g.ctx.wrS3Seen(), true); assert.equal(g.storage.get('_wr_s3_v1'), '1', 'remembered for the menu at the next start');
  await g.settle();
  const rr = (await srv.pg.query(`select kind, status, legacy_info->>'hist' hist, ap_id from public.wr_requests order by code`)).rows;
  deq(rr.map(r => [r.kind, r.status, r.hist]), [['leave', 'pending', null], ['skill_self', 'applied', 'true']]);
  assert.equal(apOf(st, pend.id).wrq, 1, 'the old record gets the stage 2 mark (old devices cannot decide it in the old tab)');
  assert.match(apOf(st, pend.id).wrc, /^LV-/);
  assert.equal(apOf(st, dec.id).wrq, undefined, 'history is not marked (nothing to decide)');
  assert.ok(g.toasts.some(t => /承認待ち 1 件・履歴 1 件/.test(t[1])), JSON.stringify(g.toasts));
  // 2 回目（次のログイン）は何も写さない・知らせない
  const g2 = await app(srv, 'E2', st); await g2.render(); await g2.settle();
  assert.equal((await srv.pg.query('select count(*)::int n from public.wr_requests')).rows[0].n, 2);
  assert.ok(!g2.toasts.some(t => /写しました/.test(t[1])));
  // AM・店長の端末は写さない（サーバーも GM・CEO だけ）が、前の承認タブは閉じる
  const am = await app(srv, 'E5', st, { role: 'am' }); await am.render(); await am.settle();
  assert.equal(am.ctx.wrS3Seen(), true);
});

test('history: "From the old Approvals tab" shows only the copied rows; a copied decision has no buttons; a copied pending one is decided like stage 2', async () => {
  const srv = await server(), st = shared();
  const pend = AP(11), dec = AP(12, { status: 'rejected', decidedBy: 'Gabe GM', decidedAt: '2026-10-23T19:00:00.000Z', rejectReason: '人が足りない' });
  st.approvals = [pend, dec]; await cloud(srv, st.approvals);
  const own = await submit(srv, 'E7', 'leave', 'S1', { ap_id: 'ap' + (T26 + 900), title: '休暇 新しい', from_name: 'Lee Leader' });
  const rj = await srv.call('E2', { action: 'act', id: own.id, op: 'reject', expect_rev: own.rev, client_key: 'k-reject-own-1', note: '日が合わない' });
  assert.equal(rj.status, 200, JSON.stringify(rj.j));
  const g = await app(srv, 'E2', st); await g.render(); await g.settle();
  g.ctx.wrSetView('history'); await g.settle();
  let h = g.ctx.renderWrTab();
  assert.match(h, /前の承認タブから/);
  assert.match(h, /前の承認タブ<\/span>/, 'the list marks copied rows');
  assert.ok(h.includes(own.code), 'without the filter: the request made in the work center too');
  g.ctx.wrSetFilter('old', '1');
  const S = g.S();
  h = g.ctx.renderWrTab();
  assert.ok(!h.includes(own.code), 'with the filter: only what came from the old tab');
  assert.ok(S.rows.some(r => r.legacy && h.includes(r.code)));
  const hist = S.rows.find(r => r.status === 'rejected' && r.legacy);
  const d = await g.open(hist.id);
  assert.match(d, /前の承認タブから写した/); assert.match(d, /ボタンはありません/); assert.match(d, /人が足りない/);
  assert.doesNotMatch(d, /wrDo\('approve'|>承認する</);
  g.ctx.wrSetView('todo'); await g.settle();
  const p = g.S().rows.find(r => r.payload && r.payload.ap_id === pend.id);
  assert.ok(p, 'the copied pending request waits for the GM');
  const dp = await g.open(p.id);
  assert.match(dp, /承認すると、今までの画面の決め方で 1 回だけ反映/);
});

test('before the stage 3 SQL/function: nothing is copied and the old tab stays', async () => {
  const srv = await server({ s3: false }), st = shared();
  st.approvals = [AP(21)]; await cloud(srv, st.approvals);
  const g = await app(srv, 'E2', st); await g.render(); await g.settle();
  assert.equal(g.ctx.wrS3Seen(), false);
  assert.equal((await srv.pg.query('select count(*)::int n from public.wr_requests')).rows[0].n, 0);
  assert.equal(apOf(st, AP(21).id).wrq, undefined);
});

test('the rest of the app: the menu drops 承認センター, old links go to the work center requests, the old counters say 0 (only when closed)', () => {
  const ctx = { window: {}, NAV_ITEMS: [{ id: 'approval', roles: ['gm'] }, { id: 'tasks' }], curRole: 'gm' };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('_apClosed') + '\n' + fnSrc('navChildAllowed'), ctx);
  assert.equal(ctx.navChildAllowed('approval'), true, 'still there before stage 3');
  ctx.window.wrS3Seen = () => true;
  assert.equal(ctx.navChildAllowed('approval'), false); assert.equal(ctx.navChildAllowed('tasks'), true);
  assert.match(fnSrc('navResolvePage'), /\(page === 'approval' \|\| \(page === 'tasks' && typeof workTab !== 'undefined' && workTab === 'approval'\)\) && typeof _apClosed === 'function' && _apClosed\(\)\) \{ page = 'tasks'; workTab = 'wr'; \}/);
  assert.match(fnSrc('renderWorkCenter'), /var apOff = typeof _apClosed==='function' && _apClosed\(\);[\s\S]*if \(apOff && workTab==='approval'\) workTab='wr';[\s\S]*\$\{apOff\?'':/);
  assert.match(SRC, /if \(pid==='approval'\) return \(typeof _apClosed==='function' && _apClosed\(\)\) \? 0 :/);
  assert.match(SRC, /var approvalsAll = \(typeof _apClosed==='function' && _apClosed\(\)\) \? \[\] :/);
  assert.match(SRC, /out = \(\(typeof _apClosed === 'function' && _apClosed\(\)\) \? \[\] : \(ls\('approvals', \[\]\) \|\| \[\]\)\)\.filter/);
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  assert.ok(Number(v) >= 1159); assert.match(SW, new RegExp("const SW_BUILD = '" + v + "'"));
});

// #153 の Codex（PR #153 の判定のコメント・`56e9392`）：サーバーが写し終えたのに答えが届かないと、前の記録に印が付かず、次のログインでも付かなかった
test('#153: the answer is lost after the server copied a pending record: the next GM login puts the stage 2 mark on the old record', async () => {
  const srv = await server(), st = shared();
  const pend = AP(31), pend2 = AP(32, { title: '休暇の申請 2つ目', ref: 'vac2' }), dec = AP(33, { status: 'approved', decidedBy: 'Ami Area', decidedAt: '2026-10-22T19:00:00.000Z' });
  st.approvals = [pend, pend2, dec]; await cloud(srv, st.approvals);
  // 1 回目：写す答え（items があるほう）だけ、サーバーが書いたあとで失う
  let lose = true;
  const wrap = { ...srv, handler: async req => {
    const body = await req.clone().json();
    const r = await srv.handler(req);
    if (lose && body.action === 's3_import' && Array.isArray(body.items) && body.items.length) throw new TypeError('the answer was lost after the server saved');
    return r;
  } };
  const g = await app(wrap, 'E2', st); await g.render(); await g.settle();
  const saved = (await srv.pg.query(`select ap_id, code, status from public.wr_requests where legacy order by code`)).rows;
  assert.ok(saved.some(r => r.ap_id === pend.id && r.status === 'pending'), 'the server copied it');
  assert.equal(apOf(st, pend.id).wrq, undefined, 'the answer was lost: no mark yet');
  // 2 回目のログイン（通信は戻った）：印を付け直す。もう一度は写さない
  lose = false;
  const g2 = await app(wrap, 'E2', st); await g2.render(); await g2.settle();
  const code = saved.find(r => r.ap_id === pend.id).code;
  assert.equal(apOf(st, pend.id).wrq, 1); assert.equal(apOf(st, pend.id).wrc, code);
  assert.equal(apOf(st, pend2.id).wrq, 1, 'every pending one');
  assert.equal(apOf(st, dec.id).wrq, undefined, 'a decided record is not marked');
  assert.equal((await srv.pg.query('select count(*)::int n from public.wr_requests where legacy')).rows[0].n, 3, 'nothing copied twice');
  // 3 回目：もう印があるので書かない
  const before = JSON.stringify(st.approvals);
  const g3 = await app(wrap, 'E2', st); await g3.render(); await g3.settle();
  assert.equal(JSON.stringify(st.approvals), before);
});

test('#153: a pending record already sent in stage 2 whose answer was lost (no mark) gets its mark from the "known" answer; marks also come back on the next login', async () => {
  const srv = await server(), st = shared();
  const pend = AP(41), pend2 = AP(42, { title: '休暇の申請 42', ref: 'vac42' });
  const dec = AP(43, { status: 'approved', title: '休暇 43', ref: 'vac43', decidedBy: 'Ami Area', decidedAt: '2026-10-22T19:00:00.000Z' });
  st.approvals = [pend, pend2, dec]; await cloud(srv, st.approvals);
  // 段階 2 で出した（ap_id がこの前の記録）が、答えが届かず前の記録に印が無い
  const sent = await submit(srv, 'E7', 'leave', 'S1', { ap_id: pend.id, title: '休暇の申請 41', from_name: 'Lee Leader' });
  const g = await app(srv, 'E2', st); await g.render(); await g.settle();
  assert.equal(apOf(st, pend.id).wrq, 1); assert.equal(apOf(st, pend.id).wrc, sent.code, 'marked with the stage 2 request, not copied again');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.wr_requests where ap_id = $1`, [pend.id])).rows[0].n, 1);
  const code2 = apOf(st, pend2.id).wrc;
  assert.match(code2, /^LV-/);
  // 印が消えた（ほかの端末の古い写しで上書きされたなど）：次のログインの最初の問い合わせ（marks）で付け直す
  delete apOf(st, pend2.id).wrq; delete apOf(st, pend2.id).wrc;
  const g2 = await app(srv, 'E2', st); await g2.render(); await g2.settle();
  assert.equal(apOf(st, pend2.id).wrq, 1); assert.equal(apOf(st, pend2.id).wrc, code2);
  const j = (await srv.call('E2', { action: 's3_import', items: [] })).j;
  deq(j.marks, [{ ap_id: pend2.id, code: code2 }], 'only records copied as pending (not the history one, not stage 2 ones)');
  // 決まった前の記録に、承認待ちの申請番号が来ても印は付けない（端末の守り）
  await g2.ctx._wrS3Remark([{ ap_id: dec.id, code: code2 }]);
  assert.equal(apOf(st, dec.id).wrq, undefined);
});
