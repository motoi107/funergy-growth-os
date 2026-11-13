// v1144 の直し（Codex #138 P1-1）：GM・CEO が確かめた権限の写し（wr_people）に「Head Chef か（chef）」を足す SQL 20261113080000。
// 本物の SQL（ワークセンターの申請 1 段目〜v1135 ＋ この SQL・PGlite）と合成データだけ（架空の人・店）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql', '20261107090000_work_requests_ui68.sql'].map(rd);
export const CHEF = rd('20261113080000_wr_people_chef.sql');

const PEOPLE = [
  ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null],
  ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null], ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null],
  ['E14', 'Ken Chef', 'chef', 'Head Chef', 'S1', null], ['E15', 'Cory Corp', 'crew', 'Corporate Chef', 'S2', null],
];
const GM = { emp_id: 'E2', name: 'Gabe GM' };

async function setup({ chef = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const m of MIGS) await pg.exec(m);
  const rpc = async (name, p) => (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})])).rows[0].v;
  // 前の SQL で GM が全員を確かめた（Head Chef も G4 として写しにいる）
  await pg.exec('set role service_role');
  const d0 = await rpc('wr_people_diff', GM); await rpc('wr_people_sync', { ...GM, digest: d0.digest });
  await pg.exec('reset role');
  if (chef) { await pg.exec(CHEF); await pg.exec(CHEF); }   // 2 回流しても同じ
  await pg.exec('set role service_role');
  const diff = async () => rpc('wr_people_diff', GM);
  const sync = async emps => { const d = await diff(); return rpc('wr_people_sync', { ...GM, digest: d.digest, ...(emps ? { emps } : {}) }); };
  const chefOf = async id => (await pg.query('select chef from public.wr_people where emp_id = $1', [id])).rows[0]?.chef;
  return { pg, rpc, diff, sync, chefOf };
}

test('after the SQL: only the Head Chefs show up, as an increase; nobody else gets a spurious difference', async () => {
  const S = await setup();
  const d = await S.diff();
  assert.deepEqual(d.items.map(x => x.emp), ['E14', 'E15'], 'the Head Chef and the Corporate Chef only');
  for (const x of d.items) {
    assert.equal(x.up, true, x.emp + ': an increase (not picked by default on the screen)');
    assert.equal(x.after.chef, true); assert.ok(!('chef' in x.before), 'the confirmed copy has no chef mark yet');
  }
  assert.equal(await S.chefOf('E14'), false, 'the new column starts false');
  // 本人の whoami：確かめ待ち（G4 の権限はそのまま）
  const me = (await S.rpc('wr_whoami', { emp_id: 'E14', name: 'Ken Chef' })).me;
  assert.equal(me.pending, true); assert.equal(me.grade, 4); assert.equal(me.confirmed, true);
});

test('the GM confirms: the chef mark goes into the copy and the log; the difference is gone', async () => {
  const S = await setup();
  const r = await S.sync(['E14']);
  assert.equal(r.applied, 1);
  assert.equal(await S.chefOf('E14'), true);
  assert.equal(await S.chefOf('E15'), false, 'not picked: still not confirmed');
  assert.deepEqual((await S.diff()).items.map(x => x.emp), ['E15']);
  const log = (await S.pg.query(`select before, after from public.wr_people_log where emp_id = 'E14' order by id desc limit 1`)).rows[0];
  assert.equal(log.after.chef, true); assert.ok(!('chef' in log.before));
  assert.equal((await S.rpc('wr_whoami', { emp_id: 'E14', name: 'Ken Chef' })).me.pending, false);
});

test('a store manager who edits their own title to Head Chef waits for the GM; a Head Chef who stops being one is a decrease', async () => {
  const S = await setup();
  await S.sync();
  assert.deepEqual((await S.diff()).items, [], 'all confirmed');
  await S.pg.exec('reset role');
  await S.pg.exec(`update public.employees set title = 'Head Chef' where id = 'E6'`);
  await S.pg.exec(`update public.employees set role = 'chef' where id = 'E7'`);   // G3 のリーダーが役割だけ chef に（グレードも 4 になる＝増える）
  await S.pg.exec(`update public.employees set title = 'Store Manager', role = 'sl' where id = 'E14'`);
  await S.pg.exec('set role service_role');
  const d = await S.diff();
  const by = Object.fromEntries(d.items.map(x => [x.emp, x]));
  assert.deepEqual(Object.keys(by).sort(), ['E14', 'E6', 'E7']);
  assert.equal(by.E6.up, true); assert.equal(by.E6.after.chef, true);
  assert.equal(by.E7.up, true);
  assert.equal(by.E14.up, false, 'no longer a Head Chef: a decrease (already in effect in the function, which also looks at the employee table)');
  assert.equal(await S.chefOf('E6'), false, 'not before the GM confirms');
  await S.sync(['E14']);
  assert.equal(await S.chefOf('E14'), false);
});

test('the SQL stops when the work-request tables are not there, and stays closed to browsers', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(pg.exec(CHEF), /先に 20261104090000_work_requests\.sql/);
  const S = await setup();
  await S.pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const f = await S.pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role + ' cannot run wr_ functions (wr_chef too)');
    const t = await S.pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name = 'wr_people'`, [role]);
    assert.equal(t.rows[0].n, 0, role + ' has no grants on wr_people');
  }
  assert.equal((await S.pg.query(`select public.wr_chef(' Head Chef ', 'crew') a, public.wr_chef('Corporate Chef', null) b, public.wr_chef('', 'chef') c, public.wr_chef('Head Cheff', 'sl') d`)).rows[0].d, false);
  assert.deepEqual((await S.pg.query(`select public.wr_chef(' Head Chef ', 'crew') a, public.wr_chef('Corporate Chef', null) b, public.wr_chef('', 'chef') c`)).rows[0], { a: true, b: true, c: true });
});

test('running the older work-request SQL again after this one fails closed (the chef mark stays as confirmed; nobody new gets it)', async () => {
  const S = await setup();
  await S.sync(['E14']);
  await S.pg.exec('reset role');
  await S.pg.exec(MIGS[0]);   // 前の一式を流し直した（関数が前の形に戻る）
  await S.pg.exec(`update public.employees set title = 'Head Chef' where id = 'E6'`);
  await S.pg.exec('set role service_role');
  await S.sync();
  assert.equal(await S.chefOf('E14'), true, 'kept');
  assert.equal(await S.chefOf('E6'), false, 'the older sync does not set it');
});
