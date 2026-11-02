// v1131 work-requests: the real SQL (PGlite) and the real handler on synthetic data (fictional people, stores and amounts).
// The PIN check is a stand-in (the real one is not in this public repository): token 'pin-E7' means employee E7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, normPayload } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');

const PEOPLE = [
  // id, name, role, title, store, support, status, manager_auth role
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', [], '在籍', 'ceo'],
  ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', [], '在籍', 'gm'],
  ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', [], '在籍', 'office'],
  ['E4', 'Oli Crew', 'office_crew', 'Office Crew', 'OFFICE', [], '在籍', 'office_crew'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', [], '在籍', null],
  ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', [], '在籍', null],
  ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', ['S3'], '在籍', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', [], '在籍', null],
  ['E9', 'Kai Kitchen', 'sl', 'Kitchen Leader', 'S2', [], '在籍', null],
  ['E10', 'Fay Former', 'sl', 'Server Leader', 'S1', [], '退職', null],
  ['E11', 'Ned Leader', 'sl', 'Operation Leader', 'S1', [], '在籍', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ live = true, legacy = null, rate = 0.7, verify = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores, public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true),('S3','Store Three','',true);`);
  for (const [id, name, role, title, store, support, status, ma] of PEOPLE) {
    await pg.query('insert into employees values($1,$2,$3,$4,$5,$6,$7,$8)', [id, name, role, title, store, JSON.stringify(support), status, JSON.stringify({ name, status })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  if (rate != null) await pg.query(`insert into app_state(key, value) values('mileage_config', $1)`, [JSON.stringify({ ratePerMile: rate })]);
  for (const [k, v] of Object.entries(legacy || {})) await pg.query('insert into app_state(key, value) values($1,$2)', [k, JSON.stringify(v)]);
  await pg.exec(MIG);
  if (live) await pg.exec('update public.wr_settings set live = true');
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const verifyPin = verify ? async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } : null;
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k];
  const handler = createHandler({ env, db, verifyPin, fetch: async () => { throw new Error('no network'); } });
  let seq = 0;
  const call = async (who, body, init = {}) => {
    const headers = { 'content-type': 'application/json', ...(init.origin ? { origin: init.origin } : {}) };
    const b = who ? { pin_session: 'pin-' + who, ...body } : body;
    const r = await handler(new Request('https://fn.test/work-requests', { method: init.method || 'POST', headers, body: init.method === 'GET' ? undefined : JSON.stringify(b) }));
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  const key = () => 'k-' + (++seq).toString().padStart(6, '0') + '-test';
  const mileage = (who, store, extra = {}) => call(who, { action: 'submit', kind: 'mileage', store_id: store, client_key: extra.client_key || key(),
    payload: { date: '2026-10-28', purpose: '銀行・郵便', origin: 'Store', destination: 'Bank', one_way_miles: 12.4, round_trip: true, memo: '', ...(extra.payload || {}) },
    ...(extra.dup_reason ? { dup_reason: extra.dup_reason } : {}) });
  const act = (who, r, op, extra = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: extra.rev ?? r.rev, client_key: extra.client_key || key(), ...extra.body });
  return { pg, call, key, mileage, act };
}

test('tables and functions are closed to browsers; only the service role reaches them', async () => {
  const { pg } = await setup();
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const t = await pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name like 'wr\\_%'`, [role]);
    assert.equal(t.rows[0].n, 0, role + ' has no table grants');
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role + ' cannot run wr_ functions');
  }
  const rls = await pg.query(`select count(*)::int n from pg_class where relname in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events') and relrowsecurity`);
  assert.equal(rls.rows[0].n, 5);
  // running the SQL twice changes nothing
  await pg.exec(MIG);
  const s = await pg.query('select count(*)::int n from public.wr_settings');
  assert.equal(s.rows[0].n, 1);
});

test('sign-in: only a PIN mark of an employee in service; the function without the PIN check says so', async () => {
  const { call } = await setup();
  assert.equal((await call(null, { action: 'whoami' })).status, 401);
  assert.equal((await call('E99', { action: 'whoami' })).status, 403, 'unknown employee');
  assert.equal((await call('E10', { action: 'whoami' })).status, 403, 'former employee');
  const me = await call('E7', { action: 'whoami' });
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.me.role, me.body.me.grade, me.body.me.stores.sort()], ['staff', 3, ['S1', 'S3']]);
  assert.equal(me.body.rate, 0.7);
  const am = await call('E5', { action: 'whoami' });
  assert.deepEqual([am.body.me.role, am.body.me.am_stores], ['am', ['S1']]);
  const acct = await call('E3', { action: 'whoami' });
  assert.equal(acct.body.me.role, 'office', 'accounting comes from manager_auth, not from the employee table');
  const { call: c2 } = await setup({ verify: false });
  assert.equal((await c2('E7', { action: 'whoami' })).status, 503);
  // a role written into the employee table is not enough to be a GM
  const x = await setup();
  await x.pg.exec(`reset role; update employees set role = 'gm', title = 'General Manager' where id = 'E8'; set role service_role;`);
  const fake = await x.call('E8', { action: 'whoami' });
  assert.equal(fake.body.me.role, 'staff');
});

test('the browser shell: origin, method, body', async () => {
  const { call } = await setup();
  assert.equal((await call('E7', { action: 'whoami' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('E7', { action: 'whoami' }, { origin: 'https://funergy-plus.com' })).status, 200);
  assert.equal((await call('E7', { action: 'whoami' }, { method: 'GET' })).status, 405);
  assert.equal((await call('E7', { action: 'nope' })).status, 400);
  assert.throws(() => normPayload('mileage', { date: '2026-02-30', purpose: 'その他', one_way_miles: 3 }), /bad_value/);
  assert.throws(() => normPayload('mileage', { date: '2026-10-01', purpose: '旅行', one_way_miles: 3 }), /bad_value/);
  assert.throws(() => normPayload('reimburse', { date: '2026-10-01', payer: 'A', vendor: 'B', amount_cents: 12.5 }), /bad_value/);
  assert.throws(() => normPayload('reimburse', { date: '2026-10-01', payer: 'A', vendor: 'B', amount_cents: 100, memo: 'x'.repeat(601) }), /bad_value/);
  const p = normPayload('reimburse', { date: '2026-10-01', payer: ' A ', vendor: 'B', amount_cents: 100, extra: 'dropped', receipt: { path: 'S1/2026-10/inv_1.pdf' } });
  assert.equal(p.payer, 'A'); assert.equal(p.extra, undefined); assert.deepEqual(p.receipt, { path: 'S1/2026-10/inv_1.pdf', drive_url: '' });
});

test('not live: nothing can be submitted; a GM turns it on (copies the old requests first)', async () => {
  const { call, mileage } = await setup({ live: false });
  const r0 = await mileage('E7', 'S1');
  assert.equal(r0.status, 409); assert.equal(r0.body.error, 'not_live');
  const w = await call('E2', { action: 'whoami' });
  assert.equal(w.body.live, false);
  assert.equal((await call('E3', { action: 'settings_save', live: true, expect_rev: w.body.settings_rev })).status, 403, 'accounting cannot turn it on');
  assert.equal((await call('E2', { action: 'settings_save', live: true, expect_rev: w.body.settings_rev + 1 })).status, 409, 'old version');
  const on = await call('E2', { action: 'settings_save', live: true, expect_rev: w.body.settings_rev });
  assert.equal(on.status, 200); assert.equal(on.body.live, true); assert.deepEqual(on.body.imported, { inserted: 0, skipped: 0 });
  assert.equal((await mileage('E7', 'S1')).status, 200);
});

test('mileage: who can submit, the amount from the rate, one row per client key, numbers', async () => {
  const { call, mileage, pg } = await setup();
  const k = 'same-key-0001';
  const a = await mileage('E7', 'S1', { client_key: k });
  assert.equal(a.status, 200);
  assert.match(a.body.code, /^GS-\d{4}-0001$/);
  assert.equal(a.body.amount_cents, 1736, '12.4 mi × 2 × $0.70');
  assert.equal(a.body.payload.miles, 24.8);
  assert.equal(a.body.status, 'pending');
  assert.deepEqual(a.body.next, { step: 'approve', who: 'am', name: 'Ami Area' });
  const again = await mileage('E7', 'S1', { client_key: k, payload: { one_way_miles: 99 } });
  assert.equal(again.body.replay, true); assert.equal(again.body.code, a.body.code);
  const n = await pg.query('select count(*)::int n from public.wr_requests'); assert.equal(n.rows[0].n, 1);
  assert.equal((await mileage('E7', 'S1', { client_key: k })).body.amount_cents, 1736, 'the same key never makes a second request');
  assert.equal((await mileage('E8', 'S1')).status, 403, 'crew (G1) cannot claim mileage');
  assert.equal((await mileage('E7', 'S2')).status, 403, 'not their store');
  assert.equal((await mileage('E7', 'S3', { payload: { date: '2026-10-29' } })).status, 200, 'a support store is theirs');
  const b = await mileage('E9', 'S2', { payload: { date: '2026-10-29' } });
  assert.match(b.body.code, /^GS-\d{4}-0003$/);
  assert.deepEqual(b.body.next, { step: 'approve', who: 'gm' }, 'a store without an AM: the GM approves');
  // another person's key is not a replay of theirs
  assert.equal((await mileage('E11', 'S1', { client_key: k })).status, 409);
  const { mileage: m2 } = await setup({ rate: null });
  assert.equal((await m2('E7', 'S1')).body.error, 'no_rate');
});

test('stages: approve → accounting check → pay; who may do each; stale versions are refused', async () => {
  const { mileage, act, call, pg } = await setup();
  let r = (await mileage('E7', 'S1')).body;
  assert.deepEqual(r.can, ['edit', 'withdraw'], 'the requester sees edit / withdraw only');
  assert.equal((await act('E7', r, 'approve')).status, 403, 'not their own');
  assert.equal((await act('E3', r, 'approve')).status, 403, 'accounting does not approve');
  assert.equal((await act('E6', r, 'approve')).status, 403, 'a G4 does not approve');
  assert.equal((await act('E3', r, 'check')).status, 403, 'not yet approved');
  const ok = await act('E5', r, 'approve');
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'approved'); assert.equal(ok.body.approved.by, 'Ami Area');
  assert.equal((await act('E2', r, 'undo', { body: { note: 'x' } })).body.error, 'conflict', 'old rev → conflict, nothing written');
  r = ok.body;
  assert.equal((await act('E3', r, 'pay', { body: { pay_date: '2026-10-31', pay_method: 'Check' } })).status, 403, 'pay before the check');
  const ck = await act('E4', r, 'check');
  assert.equal(ck.body.status, 'checked'); assert.equal(ck.body.checked.by, 'Oli Crew');
  r = ck.body;
  assert.equal((await act('E3', r, 'pay', { body: { pay_date: '2026-10-31' } })).status, 400, 'payment needs a method');
  const pd = await act('E3', r, 'pay', { body: { pay_date: '2026-10-31', pay_method: 'Payroll' } });
  assert.equal(pd.body.status, 'paid'); assert.deepEqual([pd.body.paid.date, pd.body.paid.method, pd.body.paid.by], ['2026-10-31', 'Payroll', 'Ann Acct']);
  const g = await call('E7', { action: 'get', id: r.id });
  assert.deepEqual(g.body.events.map(e => e.action), ['submit', 'approve', 'check', 'pay']);
  assert.deepEqual(g.body.events.map(e => e.by), ['Lee Leader', 'Ami Area', 'Oli Crew', 'Ann Acct']);
  // the same click twice: one event
  const k2 = 'twice-0000001';
  const u1 = await act('E3', pd.body, 'undo', { client_key: k2, body: { note: 'wrong date' } });
  const u2 = await act('E3', pd.body, 'undo', { client_key: k2, body: { note: 'wrong date' } });
  assert.equal(u1.body.status, 'checked'); assert.equal(u2.body.replay, true);
  const ev = await pg.query(`select count(*)::int n from public.wr_events where action = 'undo'`); assert.equal(ev.rows[0].n, 1);
  // GM undoes an approval; an AM cannot
  let s = (await mileage('E11', 'S1', { payload: { date: '2026-10-20' } })).body;
  s = (await act('E2', s, 'approve')).body;
  assert.equal((await act('E5', s, 'undo', { body: { note: 'x' } })).status, 403);
  assert.equal((await act('E2', s, 'undo')).body.error, 'reason_required');
  assert.equal((await act('E2', s, 'undo', { body: { note: 'mistake' } })).body.status, 'pending');
});

test('return and resubmit keep one number; the earlier approval stays in the history and is asked again', async () => {
  const { mileage, act, call } = await setup();
  let r = (await mileage('E7', 'S1')).body;
  r = (await act('E5', r, 'approve')).body;
  assert.equal((await act('E3', r, 'return')).body.error, 'reason_required');
  assert.equal((await act('E3', r, 'reject', { body: { note: 'no' } })).status, 403, 'accounting returns, never rejects');
  r = (await act('E3', r, 'return', { body: { note: '距離が地図と違います' } })).body;
  assert.equal(r.status, 'returned'); assert.equal(r.approved, null); assert.equal(r.returned.reason, '距離が地図と違います');
  assert.deepEqual(r.next, { step: 'fix', who: 'requester', name: 'Lee Leader' });
  assert.equal((await act('E5', r, 'resubmit', { body: { kind: 'mileage', payload: {} } })).status, 400, 'a bad body is refused first');
  assert.equal((await act('E5', r, 'resubmit', { body: { kind: 'mileage', payload: { date: '2026-10-28', purpose: 'その他', one_way_miles: 1 } } })).status, 403, 'only the requester resubmits');
  const re = await act('E7', r, 'resubmit', { body: { kind: 'mileage', note: '地図で測り直した', payload: { date: '2026-10-28', purpose: '銀行・郵便', one_way_miles: 10, round_trip: true } } });
  assert.equal(re.status, 200);
  assert.deepEqual([re.body.status, re.body.version, re.body.code, re.body.amount_cents], ['pending', 2, r.code, 1400]);
  const g = await call('E7', { action: 'get', id: r.id });
  assert.deepEqual(g.body.versions.map(v => [v.version, v.amount_cents]), [[1, 1736], [2, 1400]]);
  assert.deepEqual(g.body.events.map(e => e.action), ['submit', 'approve', 'return', 'resubmit']);
  assert.equal((await act('E3', re.body, 'check')).status, 403, 'needs approval again');
});

test('reject only by the deciding person; withdraw only by the requester', async () => {
  const { mileage, act } = await setup();
  const r = (await mileage('E7', 'S1')).body;
  assert.equal((await act('E3', r, 'reject', { body: { note: 'x' } })).status, 403);
  assert.equal((await act('E6', r, 'withdraw')).status, 403);
  assert.equal((await act('E5', r, 'reject')).body.error, 'reason_required');
  const rj = await act('E5', r, 'reject', { body: { note: '同じ日に 2 回' } });
  assert.deepEqual([rj.body.status, rj.body.closed.by, rj.body.closed.reason], ['rejected', 'Ami Area', '同じ日に 2 回']);
  const w = (await mileage('E7', 'S1', { payload: { date: '2026-10-01' } })).body;
  assert.equal((await act('E7', w, 'withdraw')).body.status, 'withdrawn');
});

test('duplicates: found, never merged; a reason to send it; payment waits until someone confirms', async () => {
  const { call, act, key, pg } = await setup();
  const rb = (who, extra = {}) => call(who, { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-01', payer: NAME[who], payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 }, ...extra });
  const a = (await rb('E7')).body;
  assert.match(a.code, /^RB-/);
  const d = await rb('E11');
  assert.equal(d.status, 200); assert.equal(d.body.duplicate.length, 1); assert.equal(d.body.duplicate[0].code, a.code);
  assert.equal(d.body.duplicate[0].requester_name, undefined, 'a G3 does not see another person’s request, only its number');
  assert.equal((await pg.query('select count(*)::int n from public.wr_requests')).rows[0].n, 1, 'nothing written');
  let b = (await rb('E11', { dup_reason: '別の買い物（2 回目の会計）' })).body;
  assert.deepEqual(b.dup_codes, [a.code]); assert.equal(b.dup_reason, '別の買い物（2 回目の会計）');
  assert.ok(!b.can.includes('dup_ok'), 'the requester cannot confirm their own');
  b = (await act('E2', b, 'approve')).body;
  b = (await act('E3', b, 'check')).body;
  assert.ok(!b.can.includes('pay'));
  const blocked = await act('E3', b, 'pay', { body: { pay_date: '2026-11-02', pay_method: 'Cash' } });
  assert.equal(blocked.body.error, 'dup_unresolved');
  assert.equal((await act('E3', b, 'dup_ok')).body.error, 'reason_required');
  b = (await act('E3', b, 'dup_ok', { body: { note: 'レシートの番号が違う' } })).body;
  assert.equal(b.dup_ok.by, 'Ann Acct');
  assert.equal((await act('E3', b, 'pay', { body: { pay_date: '2026-11-02', pay_method: 'Cash' } })).body.status, 'paid');
  // a withdrawn one is not a candidate
  const c = (await call('E9', { action: 'submit', kind: 'reimburse', store_id: 'S2', client_key: key(), payload: { date: '2026-11-01', payer: 'Kai', vendor: 'X', amount_cents: 500 } })).body;
  await act('E9', c, 'withdraw');
  const c2 = await call('E9', { action: 'submit', kind: 'reimburse', store_id: 'S2', client_key: key(), payload: { date: '2026-11-01', payer: 'Kai', vendor: 'X', amount_cents: 500 } });
  assert.equal(c2.body.duplicate, undefined);
});

test('who sees what: lists and single requests', async () => {
  const { mileage, call, act } = await setup();
  const own = (await mileage('E7', 'S1')).body;
  const other = (await mileage('E11', 'S1', { payload: { date: '2026-10-02' } })).body;
  const s2 = (await mileage('E9', 'S2', { payload: { date: '2026-10-03' } })).body;
  const codes = async (who, scope) => (await call(who, { action: 'list', scope, state: 'all' })).body.rows.map(r => r.code).sort();
  assert.deepEqual(await codes('E7', 'team'), [own.code], 'a G3 sees only their own');
  assert.deepEqual(await codes('E6', 'team'), [own.code, other.code].sort(), 'a G4 sees their store');
  assert.deepEqual(await codes('E5', 'team'), [own.code, other.code].sort(), 'an AM sees their stores');
  assert.deepEqual(await codes('E3', 'team'), [own.code, other.code, s2.code].sort(), 'accounting sees all');
  assert.deepEqual(await codes('E5', 'todo'), [own.code, other.code].sort());
  assert.deepEqual(await codes('E2', 'todo'), [own.code, other.code, s2.code].sort(), 'the GM can approve any');
  assert.deepEqual(await codes('E3', 'todo'), []);
  assert.equal((await call('E7', { action: 'get', id: other.id })).status, 404);
  assert.equal((await call('E7', { action: 'get', code: s2.code })).status, 404);
  await act('E5', own, 'approve');
  assert.deepEqual(await codes('E3', 'todo'), [own.code]);
  const l = await call('E2', { action: 'list', scope: 'team', state: 'open' });
  assert.equal(l.body.counts.waiting_pay, 1);
  assert.equal(l.body.counts.todo, 2);
});

test('pre-approval expenses end at the accounting check; G3 cannot ask for one', async () => {
  const { call, act, key } = await setup();
  const pre = who => call(who, { action: 'submit', kind: 'expense_pre', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-20', dept: 'Ops', purpose: '研修の食事', participants: 6, per_person_cents: 2500, total_cents: 15000 } });
  assert.equal((await pre('E7')).status, 403);
  let r = (await pre('E6')).body;
  assert.equal((await act('E5', r, 'approve')).status, 403, 'only the GM approves a pre-approval');
  r = (await act('E2', r, 'approve')).body;
  r = (await act('E3', r, 'check')).body;
  assert.equal(r.status, 'done'); assert.equal(r.next, null);
});

test('old requests are copied once, as they were; missing approvers stay missing', async () => {
  const legacy = {
    'spl_mileage_requests_Lee Leader': [
      { id: 'mi1761000000000', employee: 'Lee Leader', storeId: 'S1', date: '2026-10-01', purpose: '買い出し', miles: 10, rate: 0.7, amount: 7, status: '承認', approvedBy: 'Ami Area', approvedAt: '2026/10/02 09:00' },
      { id: 'mi1761000001000', employee: 'Lee Leader', storeId: 'S1', date: '2026-10-03', miles: 4, amount: 2.8, status: '承認', archived: true, archivedBy: 'Ann Acct', archivedAt: '2026/10/31 17:00' },
      { id: 'mi1761000002000', employee: 'Lee Leader', storeId: 'S1', date: '2026-10-04', miles: 4, amount: 2.8, status: '申請中' },
      { id: 'mi1761000003000', employee: 'Lee Leader', storeId: 'S1', date: '2026-10-05', amount: 1, status: '申請中', _deleted: true },
    ],
    spl_reimbursements_S1: { __st: 1, v: [
      { id: 'rb1761000004000', payer: 'Visitor', byUser: 'Sam Store', storeId: 'S1', amount: 45.5, vendor: 'Costco', date: '2026-10-06', status: '承認', payStatus: '支払済', paidBy: 'Ann Acct', paidAt: '2026/10/07' },
      { id: 'rb1761000005000', payer: 'Sam Store', byUser: 'Sam Store', storeId: 'S1', amount: 10, vendor: 'X', date: '2026-10-07', status: '却下', approvedBy: 'Gabe GM', rejectReason: '二重' },
    ] },
    expense_requests: [{ id: 'ex1761000006000', employee: 'Sam Store', storeId: 'S1', date: '2026-10-08', purpose: 'Lunch', total: 120, status: '承認' }],
    approvals: [{ id: 'ap1', type: 'ガソリン代', ref: 'mi1761000000000', acct: { by: 'Oli Crew', at: '2026/10/03 10:00', t: 1 } },
      { id: 'ap2', type: '経費', ref: 'ex1761000006000', acct: { by: 'Ann Acct', at: '2026/10/09', t: 1, off: true } }],
  };
  const { call, pg, act } = await setup({ legacy });
  assert.equal((await call('E3', { action: 'legacy_import' })).status, 403);
  const im = await call('E2', { action: 'legacy_import' });
  assert.deepEqual(im.body, { inserted: 6, skipped: 1 });
  assert.deepEqual((await call('E2', { action: 'legacy_import' })).body, { inserted: 0, skipped: 7 }, 'twice: the same');
  const rows = (await call('E2', { action: 'list', scope: 'team', state: 'all' })).body.rows;
  const by = id => rows.find(r => r.legacy_info.id === id);
  const m1 = by('mi1761000000000');
  assert.deepEqual([m1.status, m1.approved.by, m1.approved.at, m1.checked.by, m1.legacy], ['checked', 'Ami Area', null, 'Oli Crew', true]);
  assert.equal(m1.requester_emp, 'E7');
  assert.deepEqual([by('mi1761000001000').status, by('mi1761000001000').paid.by, by('mi1761000001000').paid.method], ['paid', 'Ann Acct', '月末処理']);
  assert.equal(by('mi1761000001000').approved, null, 'no approver was recorded: not made up');
  assert.equal(by('mi1761000002000').status, 'pending');
  assert.deepEqual([by('rb1761000004000').status, by('rb1761000004000').amount_cents, by('rb1761000004000').requester_name], ['paid', 4550, 'Sam Store']);
  assert.deepEqual([by('rb1761000005000').status, by('rb1761000005000').closed.reason, by('rb1761000005000').approved], ['rejected', '二重', null]);
  assert.equal(by('ex1761000006000').status, 'approved', 'an undone accounting check does not count');
  const n = await pg.query(`select count(*)::int n from public.wr_events where action = 'legacy_import'`); assert.equal(n.rows[0].n, 6);
  // the old pending one can be approved here; its content cannot be edited here
  const p = by('mi1761000002000');
  const mine = (await call('E7', { action: 'get', id: p.id })).body;
  assert.deepEqual(mine.can, ['withdraw']);
  assert.equal((await act('E5', p, 'approve')).body.status, 'approved');
  // app_state is only read
  const st = await pg.query(`select count(*)::int n from public.app_state`); assert.equal(st.rows[0].n, 5);
});

test('no one decides their own request; an AM decides only the stores they lead', async () => {
  const { call, act, key, mileage } = await setup();
  const rb = (who, store) => call(who, { action: 'submit', kind: 'reimburse', store_id: store, client_key: key(),
    payload: { date: '2026-11-03', payer: NAME[who], vendor: 'Office Depot', purpose: '消耗品', amount_cents: 2500 + Number(who.slice(1)) } });
  let g = (await rb('E2', 'OFFICE')).body;
  assert.ok(!g.can.includes('approve'));
  assert.equal((await act('E2', g, 'approve')).status, 403, 'the GM cannot approve their own');
  g = (await act('E1', g, 'approve')).body;
  assert.equal(g.status, 'approved', 'the CEO can');
  let a = (await rb('E3', 'OFFICE')).body;
  a = (await act('E2', a, 'approve')).body;
  assert.equal((await act('E3', a, 'check')).status, 403, 'accounting cannot check their own');
  assert.equal((await act('E4', a, 'check')).body.status, 'checked', 'office crew can');
  assert.equal((await act('E3', (await call('E3', { action: 'get', id: a.id })).body, 'pay', { body: { pay_date: '2026-11-04', pay_method: 'Cash' } })).status, 403, 'nor pay their own');
  const s2 = (await mileage('E9', 'S2', { payload: { date: '2026-11-03' } })).body;
  assert.equal((await act('E5', s2, 'approve')).status, 404, 'an AM does not even see a store they do not lead');
  assert.equal((await act('E5', s2, 'reject', { body: { note: 'x' } })).status, 404, 'nor reject it');
  assert.equal((await act('E2', s2, 'approve')).body.status, 'approved');
});
