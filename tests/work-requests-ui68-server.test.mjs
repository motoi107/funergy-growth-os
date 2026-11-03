// v1135 work-requests：UI案68 の答え（Moto さん 11/03）。本物の SQL（1 段目＋2 段目＋v1133＋v1135・PGlite）と本物の handler、合成データだけ。
//   4B ガソリン代は GM・CEO の承認／6 G3・AM も評価の変更を GM に申請／9B 表示対象は店で 1 つ（GM・CEO が決める）／wr_stage 4。
// PIN の確かめは代わり（'pin-E7' は社員 E7）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIG1 = rd('20261104090000_work_requests.sql');
const MIG2 = rd('20261105090000_work_requests_eval.sql');
const MIG3 = rd('20261106090000_work_requests_apply_claim.sql');
export const MIG4 = rd('20261107090000_work_requests_ui68.sql');

const PEOPLE = [
  // id, name, role, title, store, support, manager_auth role
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', [], 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', [], 'gm'],
  ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', [], 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', [], null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', [], null],
  ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', ['S3'], null], ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', [], null],
  ['E9', 'Kai Kitchen', 'sl', 'Kitchen Leader', 'S2', [], null], ['E10', 'Gus Crewlead', 'g2', 'Crew Leader', 'S1', [], null],
  ['E11', 'Ned Leader', 'sl', 'Operation Leader', 'S1', [], null], ['E12', 'Tia Three', 'crew', 'Crew', 'S3', [], null],
  ['E13', 'Bo Two', 'crew', 'Crew', 'S2', [], null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ mig4 = true, mig4Twice = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true),('S3','Store Three','',true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, support, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,$6,'在籍',$7)`, [id, name, role, title, store, JSON.stringify(support), JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  await pg.exec(MIG1); await pg.exec(MIG2); await pg.exec(MIG3);
  if (mig4) { await pg.exec(MIG4); if (mig4Twice) await pg.exec(MIG4); }
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'k-' + (++seq).toString().padStart(6, '0') + '-ui68';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ask = (who, kind, target, store = 'S1', payload = {}) => call(who, { action: 'submit', kind, store_id: store, client_key: key(),
    payload: kind === 'skill' ? { target_emp: target, items: [{ pos: 'Grill', from: 1, to: 2 }], reason: 'グリルを一人で回せる', ...payload }
      : kind === 'cs' ? { target_emp: target, lss_req: 'lssq-' + target, items: [{ key: 'A1', label: 'A 1', from: 1, to: 2 }], reason: 'OJT 合格', ...payload }
      : { target_emp: target, rate_from: 80, rate_to: 90, from_day: '2026-11-16', reason: '3 か月の評価', ...payload } });
  const mileage = (who, store, miles = 5) => call(who, { action: 'submit', kind: 'mileage', store_id: store, client_key: key(),
    payload: { date: '2026-11-02', purpose: '銀行・郵便', origin: 'Store', destination: 'Bank', one_way_miles: miles, round_trip: true, memo: '' } });
  const act = (who, r, op, body = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: body.rev ?? r.rev, client_key: body.key || key(), ...body });
  return { pg, db, call, key, ask, mileage, act };
}

test('the SQL stage is 4; the new table and the functions stay closed to browsers; twice is the same', async () => {
  const { pg, call } = await setup({ mig4Twice: true });
  assert.equal((await call('E7', { action: 'whoami' })).body.sql, 4);
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const t = await pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name = 'wr_store_views'`, [role]);
    assert.equal(t.rows[0].n, 0, role + ' has no grants on wr_store_views');
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role + ' cannot run wr_ functions');
  }
  const rls = await pg.query(`select relrowsecurity from pg_class where relname = 'wr_store_views'`);
  assert.equal(rls.rows[0].relrowsecurity, true);
});

test('the SQL stops and changes nothing before the v1133 SQL', async () => {
  const pg = new PGlite();
  await pg.exec(`create role service_role bypassrls; create table public.wr_requests(id uuid);`);
  await assert.rejects(pg.exec(MIG4), /STOP/);
  const t = await pg.query(`select to_regclass('public.wr_store_views') as t`);
  assert.equal(t.rows[0].t, null);
});

test('4B: mileage at a store with an AM goes to the GM; the AM cannot approve it (before v1135 it went to the AM)', async () => {
  const before = await setup({ mig4: false });
  const b = (await before.mileage('E7', 'S1')).body;
  assert.deepEqual(b.next, { step: 'approve', who: 'am', name: 'Ami Area' }, 'v1133: the AM of the store');
  const { mileage, act, call } = await setup();
  const r = (await mileage('E7', 'S1')).body;
  assert.deepEqual(r.next, { step: 'approve', who: 'gm' });
  assert.equal((await act('E5', r, 'approve')).status, 403, 'the AM does not approve');
  assert.ok(!(await call('E5', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'not on the AM to-do');
  const seen = (await call('E5', { action: 'get', id: r.id }));
  assert.equal(seen.status, 200, 'the AM still sees requests of the stores they lead'); assert.deepEqual(seen.body.can, []);
  assert.ok((await call('E2', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'on the GM to-do');
  const a = (await act('E2', r, 'approve')).body;
  assert.equal(a.status, 'approved'); assert.deepEqual(a.next, { step: 'check', who: 'acct' });
  const c = (await mileage('E11', 'S1', 9)).body;
  assert.equal(c.status, 'pending', JSON.stringify(c));
  assert.equal((await act('E1', c, 'approve')).body.status, 'approved', 'the CEO can approve too');
});

test('6: a G3 asks for a G2 or G1 at their own store (all three kinds); not for a peer, a higher grade or another store', async () => {
  const { ask, act, call, pg } = await setup();
  const sk = await ask('E7', 'skill', 'E8');
  assert.equal(sk.status, 200, JSON.stringify(sk.body)); assert.equal(sk.body.status, 'pending'); assert.deepEqual(sk.body.next, { step: 'approve', who: 'gm' });
  assert.equal((await ask('E7', 'cs', 'E10')).status, 200, 'Career Score for a G2');
  assert.equal((await ask('E7', 'tiprate', 'E8')).body.open_same, undefined, 'Tip Rate (another kind) is its own request');
  assert.equal((await ask('E7', 'tiprate', 'E10')).status, 200);
  assert.equal((await ask('E7', 'skill', 'E11')).status, 403, 'not for another G3');
  assert.equal((await ask('E7', 'skill', 'E6')).status, 403, 'not for the G4');
  assert.equal((await ask('E7', 'skill', 'E5')).status, 403, 'not for the AM');
  assert.equal((await ask('E7', 'skill', 'E13', 'S2')).status, 403, 'not at a store that is not theirs');
  assert.equal((await ask('E7', 'skill', 'E12', 'S3')).status, 200, 'a support store counts');
  assert.equal((await ask('E8', 'skill', 'E10')).status, 403, 'a G1 cannot ask');
  assert.equal((await ask('E10', 'skill', 'E8')).status, 403, 'a G2 cannot ask');
  // the G3 cannot decide; the GM decides and applies as before
  assert.equal((await act('E7', sk.body, 'approve')).status, 403);
  assert.equal((await act('E6', sk.body, 'approve')).status, 403, 'a G4 does not decide either');
  const ap = (await act('E2', sk.body, 'approve')).body;
  assert.equal(ap.status, 'approved'); assert.deepEqual(ap.can, ['apply_start', 'reject']);
  const ck = 'k-claim-ui68-01';
  const st = (await act('E2', ap, 'apply_start', { key: ck })).body;
  assert.equal((await act('E2', st, 'apply_done', { claim: ck, note: 'Grill 1 → 2' })).body.status, 'applied');
  // the G3 sees their own requests, not the store's
  const mine = (await call('E7', { action: 'list', scope: 'mine' })).body.rows.map(x => x.code).sort();
  assert.equal(mine.length, 4);
  const other = (await ask('E6', 'skill', 'E11')).body;
  assert.equal((await call('E7', { action: 'get', id: other.id })).status, 404, 'a G3 does not see a request by the G4');
  const ev = await pg.query(`select by_role from public.wr_events where action = 'submit' and by_emp = 'E7' limit 1`);
  assert.equal(ev.rows[0].by_role, 'staff');
});

test('6: the AM asks for people of the stores they lead (OJT passes); not elsewhere; a G4 still asks as before', async () => {
  const { ask, act } = await setup();
  const r = await ask('E5', 'skill', 'E8');
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.next, { step: 'approve', who: 'gm' });
  assert.equal((await act('E5', r.body, 'approve')).status, 403, 'the AM does not decide it');
  assert.equal((await ask('E5', 'cs', 'E7')).status, 200, 'a G3 at the AM store');
  assert.equal((await ask('E5', 'skill', 'E13', 'S2')).status, 403, 'not at a store the AM does not lead');
  assert.equal((await ask('E6', 'skill', 'E11')).status, 200, 'a confirmed G4 as before');
});

test('6: a G4 that the GM has not confirmed asks like a G3 (only for people below G3)', async () => {
  const { ask, pg } = await setup();
  await pg.exec(`reset role; insert into public.employees values ('E14','Nia New','sl','Store Manager','S1','[]','在籍','{"name":"Nia New"}'); set role service_role`);
  // E14 has no checked copy (wr_people): grade is capped at 3
  const NAME2 = 'Nia New';
  const h = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k],
    db: { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } },
    verifyPin: async () => ({ emp_id: 'E14', name: NAME2 }) });
  const send = async target => { const r = await h(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin_session: 'x', action: 'submit', kind: 'skill', store_id: 'S1', client_key: 'k-new-g4-' + target + '-0001',
      payload: { target_emp: target, items: [{ pos: 'Grill', from: 0, to: 1 }], reason: 'r' } }) })); return r.status; };
  assert.equal(await send('E10'), 200, 'a G2');
  assert.equal(await send('E11'), 403, 'not a G3 until the GM confirms the G4');
  assert.equal((await ask('E7', 'skill', 'E10')).body.open_same !== undefined, true, 'one open request per person and kind (the one above)');
});

test('9B: the store view is one per store; only the GM or CEO saves it; everyone reads the same', async () => {
  const { call, pg } = await setup();
  const g3 = (await call('E7', { action: 'view_get', store: 'S1' })).body;
  assert.deepEqual({ sv: g3.store_view, h: g3.hidden, rev: g3.rev, can: g3.can_edit }, { sv: true, h: [], rev: 0, can: false });
  assert.equal((await call('E2', { action: 'view_get', store: 'S1' })).body.can_edit, true);
  assert.equal((await call('E1', { action: 'view_get', store: 'S1' })).body.can_edit, true);
  assert.equal((await call('E5', { action: 'view_get', store: 'S1' })).body.can_edit, false, 'the AM reads only');
  for (const who of ['E7', 'E6', 'E5', 'E3']) assert.equal((await call(who, { action: 'view_save', store: 'S1', hidden: ['E8'], expect_rev: 0 })).status, 403, who + ' cannot save');
  const s = (await call('E2', { action: 'view_save', store: 'S1', hidden: ['E8', 'E8', 'E10'], expect_rev: 0 })).body;
  assert.deepEqual({ h: s.hidden, rev: s.rev, by: s.updated_by }, { h: ['E10', 'E8'], rev: 1, by: 'Gabe GM' });
  for (const who of ['E7', 'E6', 'E5']) assert.deepEqual((await call(who, { action: 'view_get', store: 'S1' })).body.hidden, ['E10', 'E8'], who + ' sees the store view');
  assert.deepEqual((await call('E7', { action: 'view_get', store: 'S2' })).body.hidden, [], 'another store is its own');
  assert.equal((await call('E1', { action: 'view_save', store: 'S1', hidden: [], expect_rev: 0 })).status, 409, 'an older screen does not overwrite');
  const c = (await call('E1', { action: 'view_save', store: 'S1', hidden: [], expect_rev: 1 })).body;
  assert.deepEqual({ h: c.hidden, rev: c.rev, by: c.updated_by }, { h: [], rev: 2, by: 'Cora CEO' });
  assert.equal((await call('E2', { action: 'view_save', store: 'S1', hidden: ['bad id!'], expect_rev: 2 })).status, 400);
  // the SQL checks the ids too (not only the function)
  await assert.rejects(pg.query(`select public.wr_view_save($1::jsonb)`, [JSON.stringify({ emp_id: 'E2', name: 'Gabe GM', store: 'S1', hidden: ['bad id!'], expect_rev: 2 })]), /bad_value/);
  assert.equal((await call('E2', { action: 'view_save', store: 'bad store', hidden: [], expect_rev: 2 })).status, 400);
  assert.equal((await call('E2', { action: 'view_save', store: 'S2', hidden: [], expect_rev: 3 })).status, 409, 'a new store starts at 0');
  // the per-person rows of v1132 are left as they were (not used)
  const old = await pg.query(`select count(*)::int n from public.wr_views`);
  assert.equal(old.rows[0].n, 0);
});

test('before v1135 the view answer has no store mark (the app hides the view then)', async () => {
  const { call } = await setup({ mig4: false });
  const v = (await call('E2', { action: 'view_get', store: 'S1' })).body;
  assert.equal(v.store_view, undefined);
  assert.equal((await call('E2', { action: 'whoami' })).body.sql, 3);
  // and a G3 cannot ask before v1135 (the app says the SQL is older)
  const r = await call('E7', { action: 'submit', kind: 'skill', store_id: 'S1', client_key: 'k-old-sql-0000001',
    payload: { target_emp: 'E8', items: [{ pos: 'Grill', from: 1, to: 2 }], reason: 'r' } });
  assert.equal(r.status, 403);
});
