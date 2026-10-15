// v1085（Moto 10/15「退職完了にした従業員がリストに戻ってくる」）: the server side of keeping a resignation —
// migration 20261023090000 on synthetic data in PGlite (no production data, fictional names, fake UUIDs).
// The app writes the employee table with the public key the way PostgREST does an upsert (merge-duplicates):
// insert … on conflict (id) do update set every column. A stale device sends a copy read before the resignation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(process.env.FUNERGY_RESIGN_MIG || new URL('../supabase/migrations/20261023090000_employee_resign_guard.sql', import.meta.url), 'utf8');
const dbFile = f => fs.readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
const U = { gm: '00000000-0000-4000-8000-0000000000a1', ann: '00000000-0000-4000-8000-0000000000a2', bob: '00000000-0000-4000-8000-0000000000a3', shared: '00000000-0000-4000-8000-0000000000a4' };
const J = x => JSON.parse(JSON.stringify(x));

// production-like masters (columns of SUPA_MASTER_MAP.m_employees; auth_pins / manager_auth / bot_users as the functions use them)
async function setup({ before } = {}) {
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
    grant select, insert, update on public.employees to anon, authenticated;            -- open like the app's key
    grant select, insert, update, delete on public.auth_pins, public.manager_auth, public.bot_users, public.employees to service_role;
    revoke all on public.auth_pins, public.bot_users from anon, authenticated;
    grant select on public.manager_auth to authenticated;`);
  const people = [
    { id: 'e1', name: 'Ann Sample', role: 'office', title: 'Accountant', store: 'OFFICE', status: '在籍' },
    { id: 'e2', name: 'Bob Sample', role: 'crew', title: 'Crew', store: 'F01', status: '在籍' },
    { id: 'e3', name: 'Gus Sample', role: 'gm', title: 'General Manager', store: 'ALL', status: '在籍' },
    { id: 'e4', name: 'Twin Sample', role: 'crew', title: 'Crew', store: 'F01', status: '在籍' },
    { id: 'e5', name: 'Twin Sample', role: 'crew', title: 'Crew', store: 'F02', status: '在籍' },
  ];
  for (const p of people) await pg.query('insert into employees(id,name,role,title,store,status,data) values($1,$2,$3,$4,$5,$6,$7)', [p.id, p.name, p.role, p.title, p.store, p.status, JSON.stringify({ ...p, support: [] })]);
  await pg.query(`insert into auth_pins(id, data) values ('staff', $1), ('store', '{"F01":"1234"}')`, [JSON.stringify({ 'Ann Sample': '4821', 'Gus Sample': '7710', 'Twin Sample': '3333' })]);
  await pg.query('insert into manager_auth(user_id, role, emp_id) values ($1,\'gm\',\'e3\'), ($2,\'office\',\'e1\'), ($3,\'office_crew\', null)', [U.gm, U.ann, U.shared]);
  await pg.query('insert into bot_users(user_id) values ($1), ($2)', [U.ann, U.shared]);
  if (before) await before(pg);
  await pg.exec(MIG);
  return pg;
}
// PostgREST's upsert with the app's row shape (SUPA_MASTER_MAP.m_employees.map): every column from the row is set on conflict
async function upsert(pg, rows, role = 'anon') {
  await pg.exec('set role ' + role);
  try {
    for (const o of rows) {
      const d = { ...o }; delete d.wage; delete d.email; delete d.phone; delete d.monthlySalary;
      await pg.query(`insert into employees(id,name,emp_code,role,perms,title,store,support,status,emp_type,email,phone,data)
        values($1,$2,null,$3,null,$4,$5,$6,$7,null,null,null,$8)
        on conflict (id) do update set name=excluded.name, emp_code=excluded.emp_code, role=excluded.role, perms=excluded.perms, title=excluded.title,
          store=excluded.store, support=excluded.support, status=excluded.status, emp_type=excluded.emp_type, email=excluded.email, phone=excluded.phone, data=excluded.data`,
      [o.id, o.name, o.role || null, o.title || null, o.store || null, JSON.stringify(o.support || []), o.status || null, JSON.stringify(d)]);
    }
  } finally { await pg.exec('reset role'); }
}
const row = async (pg, id) => (await pg.query('select status, data from employees where id=$1', [id])).rows[0];
const all = async pg => Object.fromEntries((await pg.query('select id, status, data from employees order by id')).rows.map(r => [r.id, r]));
const pins = async pg => (await pg.query("select data from auth_pins where id='staff'")).rows[0].data;
const mgr = async (pg, u) => (await pg.query('select role from manager_auth where user_id=$1', [u])).rows[0].role;
const bot = async (pg, u) => (await pg.query('select enabled from bot_users where user_id=$1', [u])).rows[0].enabled;
const log = async (pg, id) => (await pg.query('select kind, old_status, new_status, version from employee_status_log where emp_id=$1 order by id', [id])).rows;
const state = async (pg, id, fix = false, role = 'anon') => { await pg.exec('set role ' + role); try { return (await pg.query('select public.employee_access_state($1, $2) as v', [id, fix])).rows[0].v; } finally { await pg.exec('reset role'); } };

test('the migration gives the rows version 1, runs twice to the same result, and leaves the other columns alone', async () => {
  const pg = await setup();
  const a = await all(pg);
  for (const r of Object.values(a)) assert.equal(r.data._stV, 1);
  assert.equal(a.e1.status, '在籍'); assert.equal(a.e1.data.title, 'Accountant');
  await pg.exec(MIG);
  assert.deepEqual(await all(pg), a, 'running it again changes nothing');
  const trg = (await pg.query("select tgname from pg_trigger where tgrelid='public.employees'::regclass and not tgisinternal order by tgname")).rows.map(r => r.tgname);
  assert.deepEqual(trg, ['employees_access_after_trg', 'employees_status_guard_trg']);
  assert.deepEqual(await pins(pg), { 'Ann Sample': '4821', 'Gus Sample': '7710', 'Twin Sample': '3333' }, 'no PIN is touched by the migration itself');
  assert.equal(await mgr(pg, U.ann), 'office');
});

test('root cause: a stale device writing the whole list does not bring a resigned person back (status stays, other edits go in)', async () => {
  const pg = await setup();
  const stale = J(Object.values(await all(pg)).map(r => r.data));          // device B read everyone before the resignation
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職', resignDate: '2026-10-14', _stBy: 'Gus Sample' }]);   // device A resigns Ann
  let r = await row(pg, 'e1');
  assert.equal(r.status, '退職'); assert.equal(r.data.status, '退職'); assert.equal(r.data._stV, 2); assert.match(r.data._stAt, /^2\d{3}-\d\d-\d\dT/);
  assert.equal(r.data._stBy, 'Gus Sample');
  // device B (opened before) fixes Bob's title and saves everyone (what v1084 does)
  const b = stale.map(x => x.id === 'e2' ? { ...x, title: 'Crew Leader' } : x);
  await upsert(pg, b);
  r = await row(pg, 'e1');
  assert.equal(r.status, '退職', 'the column stays');
  assert.equal(r.data.status, '退職', 'the data the app reads stays');
  assert.equal(r.data.resignDate, '2026-10-14');
  assert.equal(r.data._stV, 2, 'the version is not moved back');
  assert.equal((await row(pg, 'e2')).data.title, 'Crew Leader', 'the edit of another person goes in');
  assert.deepEqual((await log(pg, 'e1')).filter(x => ['accepted', 'kept'].includes(x.kind)).map(x => [x.kind, x.old_status, x.new_status]), [['accepted', '在籍', '退職'], ['kept', '退職', '在籍']]);
  // a copy without any version (a device that read the list before this SQL) is also stale
  const noVer = { ...stale[0] }; delete noVer._stV;
  await upsert(pg, [noVer]);
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  // the other fields of a stale copy are written as before (only the state is protected): the title change on Ann goes in
  await upsert(pg, [{ ...stale[0], title: 'Senior Accountant' }]);
  r = await row(pg, 'e1');
  assert.equal(r.data.title, 'Senior Accountant'); assert.equal(r.data.status, '退職');
});

test('a resignation before this SQL is protected too (the rows get version 1 when it is run)', async () => {
  let staleAnn;
  const pg = await setup({ before: async pg => {
    staleAnn = (await pg.query("select data from employees where id='e1'")).rows[0].data;   // read while she was in service (no version)
    await pg.query("update employees set status='退職', data = data || '{\"status\":\"退職\",\"resignDate\":\"2026-10-01\"}' where id='e1'");
  } });
  await upsert(pg, [staleAnn]);
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  assert.equal((await row(pg, 'e1')).status, '退職');
});

test('the resignation stops the PIN, the linked manager account and its Bot use; restoring with the current version gives them back', async () => {
  const pg = await setup();
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職', resignDate: '2026-10-14' }]);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  assert.equal((await pins(pg))['Gus Sample'], '7710', 'other people keep their PIN');
  assert.equal(await mgr(pg, U.ann), 'suspended');
  assert.equal(await bot(pg, U.ann), false);
  assert.equal(await bot(pg, U.shared), true, 'a Bot account not linked to her stays');
  assert.equal(await mgr(pg, U.shared), 'office_crew', 'an unlinked (shared) manager account is not touched');
  assert.deepEqual(await state(pg, 'e1'), { found: true, status: '退職', blocked: true, version: 2, pin: 'locked', manager: 'stopped', stopped: true, fixed: false });
  // the store PIN (shared account) is not touched
  assert.deepEqual((await pg.query("select data from auth_pins where id='store'")).rows[0].data, { F01: '1234' });
  // a stale copy that says "in service" does not give the access back either
  await upsert(pg, [{ ...ann }]);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  assert.equal(await mgr(pg, U.ann), 'suspended');
  // the explicit restore (the device read version 2)
  const now = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...now, status: '在籍', resignDate: '', osDisabled: false, _restoreAt: '2026-10-15T10:00:00Z', _restoreBy: 'Gus Sample' }]);
  const r = await row(pg, 'e1');
  assert.equal(r.data.status, '在籍'); assert.equal(r.data._stV, 3);
  assert.equal((await pins(pg))['Ann Sample'], '4821', 'her own PIN comes back');
  assert.equal(await mgr(pg, U.ann), 'office');
  assert.equal(await bot(pg, U.ann), true);
  assert.equal((await pg.query('select count(*)::int as n from employee_access_hold')).rows[0].n, 0);
  // a copy read while she was resigned (version 2) does not resign her again
  await upsert(pg, [now]);
  assert.equal((await row(pg, 'e1')).data.status, '在籍');
  assert.deepEqual((await log(pg, 'e1')).map(x => x.kind), ['accepted', 'pin_locked', 'manager_suspended', 'bot_disabled', 'kept', 'accepted', 'pin_unlocked', 'manager_restored', 'bot_enabled', 'kept']);
});

test('someone without an own PIN (default) gets a stopped PIN and comes back to the default; OS account off also stops', async () => {
  const pg = await setup();
  const bob = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...bob, osDisabled: true }]);
  assert.equal((await pins(pg))['Bob Sample'], '!blocked', 'the default PIN no longer works');
  assert.equal((await state(pg, 'e2')).blocked, true);
  const now = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...now, osDisabled: false }]);
  assert.equal(Object.prototype.hasOwnProperty.call(await pins(pg), 'Bob Sample'), false, 'back to no own PIN (the default)');
});

test('a namesake in service keeps the PIN (the PIN is by name) and says so; renaming moves the stop to the new name', async () => {
  const pg = await setup();
  const t1 = (await row(pg, 'e4')).data;
  await upsert(pg, [{ ...t1, status: '退職' }]);
  assert.equal((await pins(pg))['Twin Sample'], '3333');
  const s = await state(pg, 'e4');
  assert.equal(s.pin, 'shared_name'); assert.equal(s.stopped, true, 'nothing more can be stopped by name; reported as such');
  assert.ok((await log(pg, 'e4')).some(x => x.kind === 'pin_shared_name'));
  // Ann resigned, then renamed while resigned
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職' }]);
  const a2 = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...a2, name: 'Ann Sample-Old' }]);
  const p = await pins(pg);
  assert.equal(p['Ann Sample'], '4821', 'the old name gets its PIN back');
  assert.equal(p['Ann Sample-Old'], '!blocked');
});

test('the check from the app: the public key can ask and re-apply, but cannot read the held PINs or the log, or call the inner function', async () => {
  const pg = await setup();
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職' }]);
  // something rewrote the PIN table after the stop (auth-pin writes the whole map): the check sees it and the fix stops it again
  await pg.query(`update auth_pins set data = data || '{"Ann Sample":"4821"}' where id='staff'`);
  assert.equal((await state(pg, 'e1')).pin, 'open');
  assert.equal((await state(pg, 'e1')).stopped, false);
  const f = await state(pg, 'e1', true);
  assert.equal(f.pin, 'locked'); assert.equal(f.stopped, true); assert.equal(f.fixed, true);
  assert.equal((await pg.query("select prev from employee_access_hold where kind='pin' and key='Ann Sample'")).rows[0].prev, '4821');
  // a person in service: the fix gives nothing away and stops nothing
  const g = await state(pg, 'e3', true);
  assert.deepEqual([g.blocked, g.pin, g.manager, g.stopped], [false, 'open', 'active', false]);
  assert.equal(await mgr(pg, U.gm), 'gm');
  assert.deepEqual(await state(pg, 'nobody'), { found: false });
  for (const sql of ['select * from employee_access_hold', 'select * from employee_status_log', "select public.employee_access_apply('e1')", 'select * from auth_pins']) {
    await pg.exec('set role anon');
    await assert.rejects(pg.query(sql), /permission denied/, sql);
    await pg.exec('reset role');
  }
  // a project without Supabase's default grants: the app key can still ask (the grant is explicit)
  const bare = new PGlite();
  await bare.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.employees(id text primary key, name text, status text, data jsonb);
    insert into employees values ('e1', 'Ann Sample', '在籍', '{"id":"e1","name":"Ann Sample","status":"在籍"}');`);
  await bare.exec(MIG);
  await bare.exec('set role anon');
  assert.equal((await bare.query("select public.employee_access_state('e1', false) as v")).rows[0].v.found, true);
  await bare.exec('reset role');
  const fns = (await pg.query(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname in
    ('emp_status_ver','emp_status_key','emp_blocked_of','emp_pin_mark','employees_status_guard','employee_access_apply','employees_access_after','employee_access_state') order by 1`)).rows;
  assert.equal(fns.length, 8);
  for (const f of fns) {
    assert.match(f.cfg, /search_path=public, ?pg_temp/, f.proname);
    assert.equal(f.anon, f.proname === 'employee_access_state', f.proname + ' callable with the public key?');
  }
});

test('a resigned person kept by a stale copy is logged as kept; an attempted resignation on a stale copy is also kept (and visible)', async () => {
  const pg = await setup();
  const stale = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...stale, title: 'Crew Leader' }]);                       // someone else changes the title only
  assert.equal((await row(pg, 'e2')).data._stV, 1, 'a change of other fields does not move the version');
  await upsert(pg, [{ ...stale, status: '退職' }]);                              // a copy read before the title change: still version 1 → accepted
  assert.equal((await row(pg, 'e2')).data.status, '退職');
  assert.equal((await row(pg, 'e2')).data.title, 'Crew', 'the whole stale row overwrote the title (fields other than the state are as before)');
  const now = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...now, status: '在籍' }]);                                // restore (version 2) → 3
  await upsert(pg, [{ ...now, status: '休職' }]);                                // a change based on version 2 → kept
  assert.equal((await row(pg, 'e2')).data.status, '在籍');
  const l = (await log(pg, 'e2')).filter(x => x.kind === 'kept');
  assert.deepEqual(l.map(x => [x.old_status, x.new_status, x.version]), [['在籍', '休職', 2]]);
});

test('rollback gives back the stopped PINs and accounts, and removes the guard (the rows and the log stay)', async () => {
  const pg = await setup();
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職' }]);
  await pg.exec(dbFile('employee-resign-rollback.sql'));
  assert.equal((await pins(pg))['Ann Sample'], '4821');
  assert.equal(await mgr(pg, U.ann), 'office');
  assert.equal(await bot(pg, U.ann), true);
  assert.equal((await row(pg, 'e1')).data.status, '退職', 'the employee row is not changed');
  const trg = (await pg.query("select count(*)::int as n from pg_trigger where tgrelid='public.employees'::regclass and not tgisinternal")).rows[0].n;
  assert.equal(trg, 0);
  assert.equal((await pg.query("select to_regclass('public.employee_access_hold') as t")).rows[0].t, null);
  assert.ok((await pg.query('select count(*)::int as n from employee_status_log')).rows[0].n > 0, 'the log is kept');
  await pg.exec(dbFile('employee-resign-rollback.sql'));   // twice is fine
  await pg.exec(MIG);                                       // and it can be put back
  assert.equal((await row(pg, 'e1')).data._stV, 2);
});

test('the post-check says OK after the SQL (and the apply-existing step stops only people already resigned)', async () => {
  const pg = await setup();
  const rows = (await pg.exec(dbFile('employee-resign-postcheck.sql'))).at(-1).rows;
  assert.equal(rows.length, 7);
  for (const r of rows) assert.equal(r.verdict, 'OK', r.item + ' ' + r.value);
  // Ann was resigned before the SQL (no trigger then): the explicit step stops her access; nobody in service is touched
  await pg.exec('alter table employees disable trigger employees_access_after_trg');
  await pg.query(`update employees set status='退職', data = data || '{"status":"退職"}' where id='e1'`);
  await pg.exec('alter table employees enable trigger employees_access_after_trg');
  assert.equal((await pins(pg))['Ann Sample'], '4821');
  const out = (await pg.exec(dbFile('employee-resign-apply-existing.sql'))).at(-1).rows;
  assert.deepEqual(out.map(r => [r.emp_id, r.result.pin, r.result.manager]), [['e1', 'locked', 'stopped']]);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  assert.equal(await mgr(pg, U.ann), 'suspended');
  assert.equal(await mgr(pg, U.gm), 'gm');
  const again = (await pg.exec(dbFile('employee-resign-apply-existing.sql'))).at(-1).rows;
  assert.deepEqual(again.map(r => [r.emp_id, r.result.pin, r.result.manager]), [['e1', 'locked', 'stopped']], 'twice is the same');
  assert.equal((await pg.query("select count(*)::int as n from employee_status_log where emp_id='e1' and kind='pin_locked'")).rows[0].n, 1);
  // without the guard the post-check says NG
  const bare = new PGlite();
  await bare.exec('create role anon; create table public.employees(id text primary key, status text, data jsonb);');
  const nr = (await bare.exec(dbFile('employee-resign-postcheck.sql'))).at(-1).rows;
  assert.ok(nr.filter(r => r.verdict !== 'OK').length >= 5);
  await assert.rejects(bare.exec(dbFile('employee-resign-apply-existing.sql')), /20261023090000/);
});

test('the read-only checks run on a database without the guard and with it, and change nothing', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.employees(id text primary key, name text, status text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);`);
  await pg.query(`insert into employees values ('e1','Ann Sample','在籍','{"id":"e1","name":"Ann Sample","status":"在籍"}'), ('e2','Bob Sample','退職','{"id":"e2","name":"Bob Sample","status":"退職"}')`);
  await pg.query(`insert into app_state values ('spl_offboardings__', $1, now())`, [JSON.stringify([
    { id: 'ob1', empId: 'e1', empName: 'Ann Sample', status: '完了', completedAt: '2026-10-10T00:00:00Z', completedBy: 'Gus Sample', lastWorkDate: '2026-10-09' },
    { id: 'ob2', empId: 'e2', empName: 'Bob Sample', status: '完了', completedAt: '2026-10-10T00:00:00Z' }])]);
  await pg.query(`insert into manager_auth values ($1, 'office', 'e2')`, [U.ann]);
  const before = JSON.stringify(await pg.query('select * from employees order by id'));
  const rows = (await pg.exec(dbFile('employee-resign-check.sql'))).at(-1).rows;
  const by = Object.fromEntries(rows.map(x => [x.item, x]));
  assert.equal(by['guard installed (20261023090000)'].value, 'no');
  assert.equal(by['in service, but the latest offboarding is 完了 (resurrected?)'].value, '1');
  assert.match(by['in service, but the latest offboarding is 完了 (resurrected?)'].detail, /e1 Ann Sample/);
  assert.equal(by['manager accounts linked to a resigned / stopped employee and still active'].value, '1');
  assert.equal(JSON.stringify(await pg.query('select * from employees order by id')), before);
});

test('the deploy folder holds copies of the SQL files (what is pasted is what was tested) and no function source', () => {
  const D = 'deploy/employee-resign-v1085/';
  const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const list = fs.readdirSync(new URL('../' + D, import.meta.url)).sort();
  assert.deepEqual(list, ['1_確かめ_読むだけ.sql', '2_追加のSQL.sql', '3_確認のSQL_読むだけ.sql', '4_既に退職の人のアクセスを止める.sql', '戻す.sql', '手順.md'].sort());
  assert.equal(read(D + '1_確かめ_読むだけ.sql'), read('db/employee-resign-check.sql'));
  assert.equal(read(D + '2_追加のSQL.sql'), read('supabase/migrations/20261023090000_employee_resign_guard.sql'));
  assert.equal(read(D + '3_確認のSQL_読むだけ.sql'), read('db/employee-resign-postcheck.sql'));
  assert.equal(read(D + '4_既に退職の人のアクセスを止める.sql'), read('db/employee-resign-apply-existing.sql'));
  assert.equal(read(D + '戻す.sql'), read('db/employee-resign-rollback.sql'));
  assert.equal(list.some(f => /\.(ts|js|mjs)$/.test(f)), false, 'the private functions are not published');
  const howto = read(D + '手順.md');
  assert.match(howto, /7 行すべて `OK`/);
  assert.equal((read('db/employee-resign-postcheck.sql').match(/^union all select/gm) || []).length + 1, 7);
});
