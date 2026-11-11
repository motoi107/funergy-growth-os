// v1147 の直し（Codex #141 6781928056 の P2-1）：GM・CEO が確かめた権限の写し（wr_people）に G2 も入れる SQL 20261116080000。
// 本物の SQL（ワークセンターの申請 1 段目〜v1135・Head Chef の印 ＋ この SQL・PGlite）と合成データだけ（架空の人・店）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql', '20261107090000_work_requests_ui68.sql', '20261113080000_wr_people_chef.sql'].map(rd);
const G2SQL = rd('20261116080000_wr_people_g2.sql');
const BACK = fs.readFileSync(new URL('../db/wr-people-g2-rollback.sql', import.meta.url), 'utf8');

const PEOPLE = [
  ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'],
  ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E9', 'Gus Two', 'g2', 'Crew Leader', 'S1', null], ['E10', 'Ola Two', 'office_crew', 'Office Crew Leader', 'S2', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null],
];
const GM = { emp_id: 'E2', name: 'Gabe GM' };

async function setup({ g2 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true),('S2','Store Two',null,true);`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const m of MIGS) await pg.exec(m);
  const rpc = async (name, p) => (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})])).rows[0].v;
  await pg.exec('set role service_role');
  const d0 = await rpc('wr_people_diff', GM); await rpc('wr_people_sync', { ...GM, digest: d0.digest });   // 前の SQL で GM が全員を確かめた（G3 以上だけ）
  await pg.exec('reset role');
  if (g2) { await pg.exec(G2SQL); await pg.exec(G2SQL); }   // 2 回流しても同じ
  await pg.exec('set role service_role');
  const diff = async () => rpc('wr_people_diff', GM);
  const sync = async emps => { const d = await diff(); return rpc('wr_people_sync', { ...GM, digest: d.digest, ...(emps ? { emps } : {}) }); };
  const copy = async id => (await pg.query('select grade, stores from public.wr_people where emp_id = $1', [id])).rows[0] || null;
  return { pg, rpc, diff, sync, copy };
}

test('before the SQL the G2s are not in the copy; after it they show up as an increase (only they), and Crew does not', async () => {
  const B = await setup({ g2: false });
  assert.deepEqual((await B.diff()).items, [], 'the G3+ were confirmed; a G2 is not listed before the SQL');
  assert.equal(await B.copy('E9'), null);
  const S = await setup();
  const d = await S.diff();
  assert.deepEqual(d.items.map(x => x.emp).sort(), ['E10', 'E9'], 'the Crew Leader and the Office Crew Leader only');
  for (const x of d.items) { assert.equal(x.up, true, x.emp); assert.equal(x.before, null); assert.equal(x.after.grade, 2); }
  // 本人の whoami：確かめ待ち（confirmed なし）。グレードは 2 のまま（権限は増えない）
  const me = (await S.rpc('wr_whoami', { emp_id: 'E9', name: 'Gus Two' })).me;
  assert.equal(me.pending, true); assert.equal(me.confirmed, false); assert.equal(me.grade, 2);
});

test('the GM confirms a G2: the copy has grade 2 and the stores; whoami says confirmed; the work-request rights stay those of a G2', async () => {
  const S = await setup();
  assert.equal((await S.sync(['E9'])).applied, 1);
  assert.deepEqual(await S.copy('E9'), { grade: 2, stores: ['S1'] });
  const me = (await S.rpc('wr_whoami', { emp_id: 'E9', name: 'Gus Two' })).me;
  assert.equal(me.confirmed, true); assert.equal(me.pending, false); assert.equal(me.grade, 2);
  assert.equal(me.role, 'staff');
  // G2 は評価の変更を申請できない（G3 からのまま）
  const can = (await S.pg.query(`select public.wr_can_submit_eval(public.wr_actor($1::jsonb), 'S1') as v`, [JSON.stringify({ emp_id: 'E9', name: 'Gus Two' })])).rows[0].v;
  assert.equal(can, false);
  // 社員の表で応援の店を足した：増える変更（確かめるまで写しは前のまま）
  await S.pg.exec('reset role'); await S.pg.query(`update employees set support = '["S2"]' where id = 'E9'`); await S.pg.exec('set role service_role');
  const it = (await S.diff()).items.find(x => x.emp === 'E9');
  assert.equal(it.up, true); assert.deepEqual((await S.copy('E9')).stores, ['S1']);
  // G1 に下がった（社員の表）：減る変更（確かめると写しから外れる）
  await S.pg.exec('reset role'); await S.pg.query(`update employees set role = 'crew', title = 'Crew', support = '[]' where id = 'E9'`); await S.pg.exec('set role service_role');
  const dn = (await S.diff()).items.find(x => x.emp === 'E9');
  assert.equal(dn.up, false); assert.equal(dn.after, null);
  await S.sync(['E9']); assert.equal(await S.copy('E9'), null);
});

test('only the server key runs it; the rollback puts G3+ back (a confirmed G2 shows as a decrease)', async () => {
  const S = await setup();
  await S.sync(['E9']);
  await S.pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await S.pg.exec('set role ' + role);
    await assert.rejects(S.pg.query(`select public.wr_elevated('{"grade":2}'::jsonb)`), /permission denied/, role);
    await S.pg.exec('reset role');
  }
  await S.pg.exec(BACK); await S.pg.exec(BACK);
  await S.pg.exec('set role service_role');
  const it = (await S.diff()).items;
  assert.deepEqual(it.map(x => [x.emp, x.up, x.after]), [['E9', false, null]], 'the confirmed G2 is a decrease; the unconfirmed one is not listed');
});
