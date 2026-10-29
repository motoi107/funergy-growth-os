// 従業員の変更記録（Moto 10/29・PR #99 の Codex の P1 は「(c) で受け入れ・変更記録を足す・あとで (b)」）:
// migration 20261029090000 on synthetic data in PGlite (fictional names, no production data), on top of the resignation guard
// (20261023090000) as production has it. The app writes employees with the public key the way PostgREST upserts (as anon).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const GUARD = fs.readFileSync(new URL('../supabase/migrations/20261023090000_employee_resign_guard.sql', import.meta.url), 'utf8');
const MIG = fs.readFileSync(process.env.FUNERGY_FIELD_LOG_MIG || new URL('../supabase/migrations/20261029090000_employee_field_log.sql', import.meta.url), 'utf8');
const CHECK = fs.readFileSync(new URL('../db/employee-field-log-check.sql', import.meta.url), 'utf8');
const dep = f => fs.readFileSync(new URL('../deploy/employee-field-log/' + f, import.meta.url), 'utf8');

async function setup({ guard = true } = {}) {
  const pg = new PGlite();
  // Like Supabase: new tables, sequences and functions in public are granted to anon / authenticated by default
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.bot_users(user_id uuid primary key, enabled boolean not null default true, created_at timestamptz not null default now());
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz);
    grant select, insert, update on public.employees, public.app_state to anon, authenticated;
    grant select, insert, update, delete on public.auth_pins, public.manager_auth, public.bot_users, public.employees, public.app_state to service_role;
    revoke all on public.auth_pins, public.bot_users from anon, authenticated;`);
  for (const p of [
    { id: 'e1', name: 'Ann Sample', role: 'crew', title: 'Server', store: 'F04-P', status: '在籍', coef: 1 },
    { id: 'e2', name: 'Bob Sample', role: 'crew', title: 'Cook', store: 'F01', status: '在籍', coef: 0.9 },
  ]) await pg.query('insert into employees(id,name,role,title,store,status,data) values($1,$2,$3,$4,$5,$6,$7)', [p.id, p.name, p.role, p.title, p.store, p.status, JSON.stringify({ ...p, support: [] })]);
  await pg.query(`insert into auth_pins(id, data) values ('staff', '{}')`);
  if (guard) await pg.exec(GUARD);
  await pg.exec(MIG);
  return pg;
}
async function as(pg, role, f, claims) {
  await pg.exec('set role ' + role);
  if (claims) await pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  try { return await f(); } finally { await pg.exec('reset role'); await pg.query(`select set_config('request.jwt.claims', '', false)`); }
}
const data = async (pg, id) => (await pg.query('select data from employees where id=$1', [id])).rows[0].data;
// PostgREST's upsert with the app's row shape (SUPA_MASTER_MAP.m_employees.map): every column is set on conflict
async function upsert(pg, o, role = 'anon', claims) {
  await as(pg, role, async () => {
    await pg.query(`insert into employees(id,name,role,title,store,support,status,data) values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (id) do update set name=excluded.name, role=excluded.role, title=excluded.title, store=excluded.store, support=excluded.support,
        status=excluded.status, data=excluded.data`,
    [o.id, o.name, o.role || null, o.title || null, o.store || null, JSON.stringify(o.support || []), o.status || null, JSON.stringify(o)]);
  }, claims);
}
const log = async (pg, id) => (await pg.query('select field, old_value, new_value, op, writer, who, emp_name from employee_field_log where emp_id=$1 order by id', [id])).rows;

test('an alias, a Tip Rate, a name, a role, a title and a store change are each written once, with what was before and after', async () => {
  const pg = await setup();
  assert.deepEqual(await log(pg, 'e1'), [], 'the migration itself writes nothing');
  const d = await data(pg, 'e1');
  const alias = { n: 'Ann-Sample', from: '2026-10-16', at: '2026-10-29T17:40:00Z', by: 'Gina Sample', via: 'unreg' };
  await upsert(pg, { ...d, toastAlias_annsample: alias });
  await upsert(pg, { ...d, toastAlias_annsample: alias });                                 // the same row sent again: nothing new
  assert.deepEqual(await log(pg, 'e1'), [{ field: 'toastAlias_annsample', old_value: null, new_value: alias, op: 'update', writer: 'anon', who: null, emp_name: 'Ann Sample' }]);
  await upsert(pg, { ...d, toastAlias_annsample: { ...alias, off: true }, coef: 0.8, name: 'Ann B Sample', role: 'sl', title: 'Shift Leader', store: 'F01', support: ['F04-K'], phone: 'x' });
  const rows = (await log(pg, 'e1')).slice(1);
  assert.deepEqual(rows.map(r => [r.field, r.old_value, r.new_value]), [
    ['coef', 1, 0.8], ['name', 'Ann Sample', 'Ann B Sample'], ['role', 'crew', 'sl'], ['store', 'F04-P', 'F01'], ['support', [], ['F04-K']],
    ['title', 'Server', 'Shift Leader'], ['toastAlias_annsample', alias, { ...alias, off: true }]], 'one row per field, sorted; phone and the status are not this log');
  assert.ok(rows.every(r => r.emp_name === 'Ann B Sample' && r.writer === 'anon'));
  // a field taken away (data written without it) is a change too
  const d2 = await data(pg, 'e1'); delete d2.coef;
  await upsert(pg, d2);
  assert.deepEqual((await log(pg, 'e1')).slice(-1).map(r => [r.field, r.old_value, r.new_value]), [['coef', 0.8, null]]);
  // a store-only alias (AM) and a new person
  await upsert(pg, { id: 'e9', name: 'New Sample', status: '在籍', coef: 1, 'toastAlias_newsample@F04-P': { n: 'New Sample', store: 'F04-P' } });
  assert.deepEqual((await log(pg, 'e9')).map(r => [r.field, r.op, r.old_value]), [['coef', 'insert', null], ['name', 'insert', null], ['toastAlias_newsample@F04-P', 'insert', null]]);
});

test('which key wrote it: the app (anon), the server (service_role), the SQL Editor (admin), and a signed-in mark when there is one', async () => {
  const pg = await setup();
  const d = await data(pg, 'e2');
  await upsert(pg, { ...d, coef: 1 }, 'service_role');
  await upsert(pg, { ...d, coef: 0.95 }, 'authenticated', { role: 'authenticated', staff_id: 'e7', grade: '6' });
  await pg.query(`update employees set data = jsonb_set(data, '{coef}', '0.9') where id='e2'`);   // the SQL Editor (the owner)
  assert.deepEqual((await log(pg, 'e2')).map(r => [r.writer, r.who, r.new_value]), [['service_role', null, 1], ['authenticated', 'e7', 0.95], ['admin', null, 0.9]]);
  // the public key's own claims (and the server's) are not a sign-in: no mark
  await upsert(pg, { ...d, coef: 0.85 }, 'anon', { role: 'anon', email: 'someone@example.com', sub: 'x' });
  await upsert(pg, { ...d, coef: 0.8 }, 'service_role', { role: 'service_role', sub: 'y' });
  assert.deepEqual((await log(pg, 'e2')).slice(-2).map(r => [r.writer, r.who]), [['anon', null], ['service_role', null]]);
});

test('the public key can neither read nor change the log, and a failing log never stops the write', async () => {
  const pg = await setup();
  const d = await data(pg, 'e1');
  await upsert(pg, { ...d, coef: 0.7 });
  for (const sql of ['select * from employee_field_log', `insert into employee_field_log(emp_id, field, op, writer) values ('e1','coef','update','anon')`,
    `update employee_field_log set new_value='1'`, `delete from employee_field_log`, `select public.employees_field_log()`]) {
    for (const role of ['anon', 'authenticated']) await assert.rejects(as(pg, role, () => pg.query(sql)), /permission denied|trigger functions can only be called as triggers/, role + ': ' + sql);
  }
  assert.equal((await log(pg, 'e1')).length, 1);
  // even if the table is granted to the public key by mistake later, row security still shows it nothing
  await pg.exec('grant select on employee_field_log to anon');
  assert.deepEqual((await as(pg, 'anon', () => pg.query('select * from employee_field_log'))).rows, [], 'row security hides the log');
  await pg.exec('revoke all on employee_field_log from anon');
  // the log refuses a row (a broken log): the employee is written anyway
  await pg.exec(`alter table employee_field_log add constraint never check (field <> 'coef') not valid`);
  await upsert(pg, { ...d, coef: 0.6, title: 'Cook' });
  assert.equal((await data(pg, 'e1')).coef, 0.6);
  assert.equal((await data(pg, 'e1')).title, 'Cook');
  assert.equal((await log(pg, 'e1')).length, 1, 'nothing from the failed write is half-kept');
  // data that is not an object (a broken row; the resignation guard keeps that from the app, so here without it) is written and
  // read as empty: what it had is logged as taken away, and what comes next as new
  const bare = await setup({ guard: false });
  await as(bare, 'service_role', () => bare.query(`update employees set data = '[]' where id='e2'`));
  await as(bare, 'service_role', () => bare.query(`update employees set data = '{"name":"Bob Sample","coef":1}' where id='e2'`));
  assert.deepEqual((await log(bare, 'e2')).map(r => [r.field, r.old_value, r.new_value]), [['coef', 0.9, null], ['name', 'Bob Sample', null], ['role', 'crew', null],
    ['store', 'F01', null], ['support', [], null], ['title', 'Cook', null], ['coef', null, 1], ['name', null, 'Bob Sample']]);
  // a row taken away is logged too (what it had, as delete)
  await as(bare, 'service_role', () => bare.query(`delete from employees where id='e2'`));
  assert.deepEqual((await log(bare, 'e2')).slice(-2).map(r => [r.field, r.op, r.old_value, r.new_value, r.emp_name]), [['coef', 'delete', 1, null, 'Bob Sample'], ['name', 'delete', 'Bob Sample', null, 'Bob Sample']]);
});

test('the resignation guard keeps working with the log beside it, and the SQL runs twice to the same result', async () => {
  const pg = await setup();
  const d = await data(pg, 'e1');
  await upsert(pg, { ...d, status: '退職', resignDate: '2026-10-29' });           // a resignation from the app (allowed: version 1)
  const after = await data(pg, 'e1');
  assert.equal(after.status, '退職');
  await upsert(pg, { ...d, coef: 0.5 });                                           // a stale copy (still 在籍, version 1): the status stays
  assert.equal((await data(pg, 'e1')).status, '退職', 'the guard still keeps the resignation');
  assert.deepEqual((await log(pg, 'e1')).map(r => r.field), ['coef'], 'only the tracked field; the status has its own log');
  const before = (await pg.query('select count(*)::int n from employee_field_log')).rows[0].n;
  await pg.exec(MIG);
  assert.equal((await pg.query('select count(*)::int n from employee_field_log')).rows[0].n, before, 'running it again keeps the log');
  const trg = (await pg.query("select tgname from pg_trigger where tgrelid='public.employees'::regclass and not tgisinternal order by tgname")).rows.map(r => r.tgname);
  assert.deepEqual(trg, ['employees_access_after_trg', 'employees_delete_guard_trg', 'employees_field_log_trg', 'employees_status_guard_trg']);
});

test('without the resignation guard the SQL still goes in; it stops (changing nothing) when there is no employee table', async () => {
  const pg = await setup({ guard: false });
  await upsert(pg, { ...(await data(pg, 'e2')), coef: 0.5 });
  assert.equal((await log(pg, 'e2')).length, 1);
  const empty = new PGlite();
  await empty.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(empty.exec(MIG), /社員の表（employees）がありません/);
  assert.equal((await empty.query("select to_regclass('public.employee_field_log') r")).rows[0].r, null);
});

test('the read-only check lists the changes newest first and writes nothing', async () => {
  const pg = await setup();
  const d = await data(pg, 'e1');
  await upsert(pg, { ...d, toastAlias_annsample: { n: 'Ann-Sample', from: '2026-10-16', by: 'Gina Sample' } });
  await upsert(pg, { ...(await data(pg, 'e1')), coef: 0.8 });
  const snap = JSON.stringify((await pg.query('select * from employee_field_log order by id')).rows) + JSON.stringify((await pg.query('select * from employees order by id')).rows);
  const rows = (await pg.query(CHECK)).rows;
  assert.equal(JSON.stringify((await pg.query('select * from employee_field_log order by id')).rows) + JSON.stringify((await pg.query('select * from employees order by id')).rows), snap);
  assert.deepEqual(rows.map(r => [r['欄'], r['種類'], r['鍵']]), [['Tip Rate（評価係数）', '変更', 'anon'], ['別名 annsample', '変更', 'anon']]);
  assert.match(rows[1]['後'], /Ann-Sample/);
  assert.equal(rows[0]['前'], '1');
  assert.match(rows[0]['従業員'], /^Ann Sample \[e1\]$/);
});

test('the deploy folder holds exactly the migration and the check; the confirmation reads OK after it and NG before it', async () => {
  assert.equal(dep('1_追加のSQL.sql'), MIG);
  assert.equal(dep('3_変更記録を見る_読むだけ.sql'), CHECK);
  const CONF = dep('2_確認のSQL_読むだけ.sql');
  const pre = new PGlite();
  await pre.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.employees(id text primary key, name text, data jsonb, status text);`);
  assert.deepEqual((await pre.query(CONF)).rows.map(r => r['結果']), ['NG（1_追加のSQL がまだ）', 'NG（表が無い）', 'NG（1_追加のSQL がまだ）',
    '無い（v1085 の SQL を入れていないなら、そのままで大丈夫）', '—'], 'before: runs and says what is missing');
  const pg = await setup();
  await upsert(pg, { ...(await data(pg, 'e2')), coef: 0.5 });
  assert.deepEqual((await pg.query(CONF)).rows.map(r => r['結果']), ['OK', 'OK', 'OK', 'OK', '1 行']);
  // 止める：見張りだけ外れ、記録は残り、従業員の保存は通る。1 をもう一度流すと戻る
  await pg.exec(dep('止める.sql'));
  await upsert(pg, { ...(await data(pg, 'e2')), coef: 0.7 });
  assert.equal((await data(pg, 'e2')).coef, 0.7, 'the employee write still goes through');
  assert.deepEqual((await pg.query(CONF)).rows.map(r => r['結果']), ['OK', 'OK', 'NG（1_追加のSQL がまだ）', 'OK', '1 行'], 'stopped: the log is kept, nothing new is written');
  await pg.exec(MIG);
  await upsert(pg, { ...(await data(pg, 'e2')), coef: 0.8 });
  assert.deepEqual((await pg.query(CONF)).rows.map(r => r['結果']), ['OK', 'OK', 'OK', 'OK', '2 行']);
});
