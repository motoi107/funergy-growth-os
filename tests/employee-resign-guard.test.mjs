// v1085（Moto 10/15「退職完了にした従業員がリストに戻ってくる」）: the server side of keeping a resignation —
// migration 20261023090000 on synthetic data in PGlite (no production data, fictional names, fake UUIDs).
// The app writes the employee table with the public key the way PostgREST does an upsert (merge-duplicates):
// insert … on conflict (id) do update set every column, as the role anon. A stale device sends a copy read before the resignation.
// The server (auth-pin, an Edge Function) writes as service_role; the SQL Editor as the database owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(process.env.FUNERGY_RESIGN_MIG || new URL('../supabase/migrations/20261023090000_employee_resign_guard.sql', import.meta.url), 'utf8');
const dbFile = f => fs.readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
const U = { gm: '00000000-0000-4000-8000-0000000000a1', ann: '00000000-0000-4000-8000-0000000000a2', bob: '00000000-0000-4000-8000-0000000000a3', shared: '00000000-0000-4000-8000-0000000000a4' };
const FNS = ['emp_status_ver', 'emp_status_key', 'emp_blocked_of', 'emp_pin_mark', 'emp_privileged', 'employee_status_note', 'employees_status_guard', 'employee_pin_reconcile',
  'employee_access_apply', 'employees_access_after', 'employee_restore', 'auth_pin_put', 'employee_access_state', 'offboard_record_guard'];

// production-like masters (columns of SUPA_MASTER_MAP.m_employees; auth_pins / manager_auth / bot_users as the functions use them)
async function setup({ before, defaults = true } = {}) {
  const pg = new PGlite();
  // Like Supabase: new tables, sequences and functions in public are granted to anon / authenticated by default
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    ${defaults ? `alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;` : ''}
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.bot_users(user_id uuid primary key, enabled boolean not null default true, created_at timestamptz not null default now());
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz);
    grant select, insert, update on public.employees, public.app_state to anon, authenticated;            -- open like the app's key
    grant select, insert, update, delete on public.auth_pins, public.manager_auth, public.bot_users, public.employees, public.app_state to service_role;
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
async function as(pg, role, f) { await pg.exec('set role ' + role); try { return await f(); } finally { await pg.exec('reset role'); } }
// PostgREST's upsert with the app's row shape (SUPA_MASTER_MAP.m_employees.map): every column from the row is set on conflict
async function upsert(pg, rows, role = 'anon') {
  await as(pg, role, async () => {
    for (const o of rows) {
      const d = { ...o }; delete d.wage; delete d.email; delete d.phone; delete d.monthlySalary;
      await pg.query(`insert into employees(id,name,emp_code,role,perms,title,store,support,status,emp_type,email,phone,data)
        values($1,$2,null,$3,null,$4,$5,$6,$7,null,null,null,$8)
        on conflict (id) do update set name=excluded.name, emp_code=excluded.emp_code, role=excluded.role, perms=excluded.perms, title=excluded.title,
          store=excluded.store, support=excluded.support, status=excluded.status, emp_type=excluded.emp_type, email=excluded.email, phone=excluded.phone, data=excluded.data`,
      [o.id, o.name, o.role || null, o.title || null, o.store || null, JSON.stringify(o.support || []), o.status || null, JSON.stringify(d)]);
    }
  });
}
const row = async (pg, id) => (await pg.query('select status, data from employees where id=$1', [id])).rows[0];
const all = async pg => Object.fromEntries((await pg.query('select id, status, data from employees order by id')).rows.map(r => [r.id, r]));
const pins = async pg => (await pg.query("select data from auth_pins where id='staff'")).rows[0].data;
const mgr = async (pg, u) => (await pg.query('select role from manager_auth where user_id=$1', [u])).rows[0].role;
const bot = async (pg, u) => (await pg.query('select enabled from bot_users where user_id=$1', [u])).rows[0].enabled;
const log = async (pg, id) => (await pg.query('select kind, old_status, new_status, version from employee_status_log where emp_id=$1 order by id', [id])).rows;
const state = (pg, id, fix = false, role = 'anon') => as(pg, role, async () => (await pg.query('select public.employee_access_state($1, $2) as v', [id, fix])).rows[0].v);
// auth-pin passes the role of the email account that pressed "restore" (p_caller_role); the SQL Editor passes none
const restore = (pg, id, by = 'Gus Sample', role = 'service_role', caller = 'gm', keep = false) => as(pg, role, async () => (await pg.query('select public.employee_restore($1, $2, $3, $4) as v', [id, by, keep, caller])).rows[0].v);
const resign = async (pg, id, extra = {}) => { const d = (await row(pg, id)).data; await upsert(pg, [{ ...d, status: '退職', ...extra }]); };

test('the migration gives the rows version 1, runs twice to the same result, and leaves the other columns alone', async () => {
  const pg = await setup();
  const a = await all(pg);
  for (const r of Object.values(a)) assert.equal(r.data._stV, 1);
  assert.equal(a.e1.status, '在籍'); assert.equal(a.e1.data.title, 'Accountant');
  await pg.exec(MIG);
  assert.deepEqual(await all(pg), a, 'running it again changes nothing');
  const trg = (await pg.query("select tgname from pg_trigger where tgrelid in ('public.employees'::regclass, 'public.app_state'::regclass) and not tgisinternal order by tgname")).rows.map(r => r.tgname);
  assert.deepEqual(trg, ['employees_access_after_trg', 'employees_delete_guard_trg', 'employees_status_guard_trg', 'offboard_record_guard_trg']);
  assert.deepEqual(await pins(pg), { 'Ann Sample': '4821', 'Gus Sample': '7710', 'Twin Sample': '3333' }, 'no PIN is touched by the migration itself');
  assert.equal(await mgr(pg, U.ann), 'office');
  // a row added after the first run keeps version 0 when the SQL is run again (a pending edit on it is not turned into a conflict)
  await upsert(pg, [{ id: 'e9', name: 'New Sample', status: '在籍' }]);
  assert.equal((await row(pg, 'e9')).data._stV, 0);
  await pg.exec(MIG);
  assert.equal((await row(pg, 'e9')).data._stV, 0);
});

test('root cause: a stale device writing the whole list does not bring a resigned person back (status stays, other edits go in)', async () => {
  const pg = await setup();
  const stale = Object.values(await all(pg)).map(r => r.data);           // device B read everyone before the resignation
  const ann = (await row(pg, 'e1')).data;
  await upsert(pg, [{ ...ann, status: '退職', resignDate: '2026-10-14', _stBy: 'Gus Sample' }]);   // device A resigns Ann
  let r = await row(pg, 'e1');
  assert.equal(r.status, '退職'); assert.equal(r.data.status, '退職'); assert.equal(r.data._stV, 2); assert.match(r.data._stAt, /^2\d{3}-\d\d-\d\dT/);
  assert.equal(r.data._stBy, 'Gus Sample');
  // device B (opened before) fixes Bob's title and saves everyone (what v1084 does)
  await upsert(pg, stale.map(x => x.id === 'e2' ? { ...x, title: 'Crew Leader' } : x));
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
  // the other fields of a stale copy are written as before (only the state is protected)
  await upsert(pg, [{ ...stale[0], title: 'Senior Accountant' }]);
  r = await row(pg, 'e1');
  assert.equal(r.data.title, 'Senior Accountant'); assert.equal(r.data.status, '退職');
  // the same stale write repeated within an hour is logged once (old devices save the whole list again and again)
  assert.equal((await log(pg, 'e1')).filter(x => x.kind === 'kept').length, 1);
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
  // not only a reinstatement: Bob was put on leave before the SQL; a copy read before that does not put him back in service
  let staleBob;
  const pg2 = await setup({ before: async pg => {
    staleBob = (await pg.query("select data from employees where id='e2'")).rows[0].data;
    await pg.query("update employees set status='休職', data = data || '{\"status\":\"休職\"}' where id='e2'");
  } });
  await upsert(pg2, [staleBob]);
  assert.equal((await row(pg2, 'e2')).data.status, '休職');
});

test('the public key cannot bring a resigned person back, even with the current version; only the server / an administrator can', async () => {
  const pg = await setup();
  await resign(pg, 'e1', { resignDate: '2026-10-14', osDisabled: true });
  const cur = (await row(pg, 'e1')).data;                                    // the current version, readable by anyone
  // the resigned person (or anyone with the app's key) writes herself back in service with the current version
  await upsert(pg, [{ ...cur, status: '在籍', resignDate: '', osDisabled: false, _restoreAt: '2099-01-01T00:00:00Z' }]);
  let r = await row(pg, 'e1');
  assert.equal(r.data.status, '退職'); assert.equal(r.data.osDisabled, true); assert.equal(r.data._restoreAt, undefined, '_restoreAt is the server\'s too');
  assert.equal((await pins(pg))['Ann Sample'], '!blocked'); assert.equal(await mgr(pg, U.ann), 'suspended');
  assert.ok((await log(pg, 'e1')).some(x => x.kind === 'refused' && x.new_status === '在籍'));
  // the same through the column only (data unchanged) is refused too
  await as(pg, 'anon', () => pg.query("update employees set status='在籍' where id='e1'"));
  assert.equal((await row(pg, 'e1')).data.status, '退職'); assert.equal((await row(pg, 'e1')).status, '退職');
  // the app's key cannot call the restore or the PIN writer
  for (const sql of ["select public.employee_restore('e1', 'x')", "select public.auth_pin_put('staff', 'Ann Sample', '1111')"])
    await assert.rejects(as(pg, 'anon', () => pg.query(sql)), /permission denied/, sql);
  // even if someone granted it to the app's roles by mistake, the restore checks who is calling
  await pg.exec('grant execute on function public.employee_restore(text, text, boolean, text) to authenticated');
  await assert.rejects(restore(pg, 'e1', 'x', 'authenticated'), /permission denied/);
  await pg.exec('revoke execute on function public.employee_restore(text, text, boolean, text) from authenticated');
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  // the server (auth-pin, service_role) restores: PIN, manager role and Bot come back, the restorer is recorded
  const res = await restore(pg, 'e1', 'Gus Sample');
  assert.equal(res.ok, true); assert.equal(res.state.blocked, false);
  r = await row(pg, 'e1');
  assert.equal(r.data.status, '在籍'); assert.equal(r.data.osDisabled, false); assert.equal(r.data.resignDate, ''); assert.equal(r.data._restoreBy, 'Gus Sample');
  assert.equal(r.data._stV, 3);
  assert.equal((await pins(pg))['Ann Sample'], '4821'); assert.equal(await mgr(pg, U.ann), 'office'); assert.equal(await bot(pg, U.ann), true);
  const again = await restore(pg, 'e1');
  assert.equal(again.ok, true); assert.equal(again.already, true, 'twice is the same');
  // the SQL Editor (database owner) can restore by a plain update, too (recovery)
  await resign(pg, 'e2');
  await pg.query(`update employees set status='在籍', data = data || '{"status":"在籍"}' where id='e2'`);
  assert.equal((await row(pg, 'e2')).data.status, '在籍');
  // … also through the column only (the data follows the column)
  await resign(pg, 'e2');
  await pg.query(`update employees set status='在籍' where id='e2'`);
  assert.equal((await row(pg, 'e2')).data.status, '在籍'); assert.equal((await state(pg, 'e2')).blocked, false);
  // a copy read while she was resigned does not resign her again; resigning with the current version from the app works (the safe way)
  await upsert(pg, [cur]);
  assert.equal((await row(pg, 'e1')).data.status, '在籍');
  await resign(pg, 'e1');
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  // while she stays resigned, the app may still turn the OS account flag on and off (the offboarding screen): she stays stopped
  await upsert(pg, [{ ...(await row(pg, 'e1')).data, osDisabled: true }]);
  await upsert(pg, [{ ...(await row(pg, 'e1')).data, osDisabled: false }]);
  r = await row(pg, 'e1');
  assert.equal(r.data.osDisabled, false); assert.equal(r.data.status, '退職'); assert.equal((await state(pg, 'e1')).blocked, true);
  // in service with the OS account off: turning it back on is a reinstatement (the server's)
  await restore(pg, 'e2');
  await upsert(pg, [{ ...(await row(pg, 'e2')).data, osDisabled: true }]);
  await upsert(pg, [{ ...(await row(pg, 'e2')).data, osDisabled: false }]);
  assert.equal((await row(pg, 'e2')).data.osDisabled, true);
});

test('the resignation stops the PIN, the linked manager account and its Bot use; nothing else is touched', async () => {
  const pg = await setup();
  await resign(pg, 'e1', { resignDate: '2026-10-14' });
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  assert.equal((await pins(pg))['Gus Sample'], '7710', 'other people keep their PIN');
  assert.equal(await mgr(pg, U.ann), 'suspended');
  assert.equal(await bot(pg, U.ann), false);
  assert.equal(await bot(pg, U.shared), true, 'a Bot account not linked to her stays');
  assert.equal(await mgr(pg, U.shared), 'office_crew', 'an unlinked (shared) manager account is not touched');
  assert.deepEqual(await state(pg, 'e1'), { found: true, status: '退職', blocked: true, version: 2, pin: 'locked', manager: 'stopped', stopped: true, fixed: false });
  assert.deepEqual((await pg.query("select data from auth_pins where id='store'")).rows[0].data, { F01: '1234' }, 'the store PIN (shared account) is not touched');
  // a stale copy that says "in service" does not give the access back either
  await upsert(pg, [{ ...(await row(pg, 'e1')).data, _stV: 1, status: '在籍' }]);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  assert.equal(await mgr(pg, U.ann), 'suspended');
  // for someone in service the app learns nothing about manager accounts
  const g = await state(pg, 'e3');
  assert.deepEqual([g.blocked, g.pin, g.manager, g.stopped], [false, 'open', 'n/a', false]);
});

test('someone without an own PIN (default) gets a stopped PIN and back to the default; OS account off also stops', async () => {
  const pg = await setup();
  await upsert(pg, [{ ...(await row(pg, 'e2')).data, osDisabled: true }]);
  assert.equal((await pins(pg))['Bob Sample'], '!blocked', 'the default PIN no longer works');
  assert.equal((await state(pg, 'e2')).blocked, true);
  await restore(pg, 'e2');
  assert.equal(Object.prototype.hasOwnProperty.call(await pins(pg), 'Bob Sample'), false, 'back to no own PIN (the default)');
});

test('PINs are by name: a namesake in service keeps the PIN; a new namesake later gets the default PIN, not the resigned person\'s; renaming moves the stop', async () => {
  const pg = await setup();
  await resign(pg, 'e4');
  assert.equal((await pins(pg))['Twin Sample'], '3333');
  const s = await state(pg, 'e4');
  assert.equal(s.pin, 'shared_name'); assert.equal(s.stopped, true, 'nothing more can be stopped by name; reported as such');
  assert.ok((await log(pg, 'e4')).some(x => x.kind === 'pin_shared_name'));
  // Ann resigned (locked with her PIN held); later a different person named Ann Sample joins: the lock is released to the default
  await resign(pg, 'e1');
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  await upsert(pg, [{ id: 'e8', name: 'Ann Sample', role: 'crew', status: '在籍' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(await pins(pg), 'Ann Sample'), false, 'not the resigned person\'s PIN');
  // the new hire is renamed (a typo fix): the name is only the resigned Ann's again → stopped
  await upsert(pg, [{ ...(await row(pg, 'e8')).data, name: 'Anne Sample' }]);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  // Ann renamed while resigned: the new name is stopped; nobody has the old name, so its stop is lifted (default)
  await upsert(pg, [{ ...(await row(pg, 'e1')).data, name: 'Ann Sample-Old' }]);
  const p = await pins(pg);
  assert.equal(p['Ann Sample-Old'], '!blocked');
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'Ann Sample'), false);
  // a rename made while the guard was off (e.g. between the rollback and installing it again): the check with "fix" moves the stop
  await pg.exec("set session_replication_role = replica; update employees set data = data || '{\"name\":\"Ann S\"}' where id = 'e1'; set session_replication_role = origin;");
  assert.equal((await pins(pg))['Ann Sample-Old'], '!blocked', 'nothing ran yet');
  await state(pg, 'e1', true);
  const p2 = await pins(pg);
  assert.equal(p2['Ann S'], '!blocked');
  assert.equal(Object.prototype.hasOwnProperty.call(p2, 'Ann Sample-Old'), false, 'the old name\'s stop is lifted (nobody has it)');
});

test('the check from the app: the public key can ask and re-apply, but cannot read the held PINs or the log, or call the inner functions', async () => {
  const pg = await setup();
  await resign(pg, 'e1');
  // something rewrote the PIN table after the stop: the check sees it and the fix stops it again
  await pg.query(`update auth_pins set data = data || '{"Ann Sample":"4821"}' where id='staff'`);
  assert.equal((await state(pg, 'e1')).pin, 'open');
  assert.equal((await state(pg, 'e1')).stopped, false);
  const f = await state(pg, 'e1', true);
  assert.equal(f.pin, 'locked'); assert.equal(f.stopped, true); assert.equal(f.fixed, true);
  assert.equal((await state(pg, 'e1', true)).fixed, false, 'nothing to fix: no write');
  // a person in service: the fix gives nothing away and stops nothing
  const g = await state(pg, 'e3', true);
  assert.deepEqual([g.blocked, g.pin, g.manager, g.stopped, g.fixed], [false, 'open', 'n/a', false, false]);
  assert.equal(await mgr(pg, U.gm), 'gm');
  assert.deepEqual(await state(pg, 'nobody'), { found: false });
  for (const sql of ['select * from employee_access_hold', 'select * from employee_status_log', "select public.employee_access_apply('e1')", 'select * from auth_pins',
    "select public.employee_pin_reconcile('Ann Sample')", "select public.employee_status_note('e1','kept',null,null,null,null,null)"])
    await assert.rejects(as(pg, 'anon', () => pg.query(sql)), /permission denied/, sql);
  // a project without Supabase's default grants: the app key can still ask (the grant is explicit)
  const bare = await setup({ defaults: false });
  assert.equal((await state(bare, 'e1')).found, true);
  const fns = (await pg.query(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname = any($1) order by 1`, [FNS])).rows;
  assert.equal(fns.length, FNS.length);
  for (const f of fns) {
    assert.match(f.cfg, /search_path=public, ?pg_temp/, f.proname);
    assert.equal(f.anon, f.proname === 'employee_access_state', f.proname + ' callable with the public key?');
  }
});

test('the PIN writer of auth-pin changes one PIN only and does not overwrite a stopped PIN', async () => {
  const pg = await setup();
  await resign(pg, 'e1');
  const put = (k, v, scope = 'staff') => as(pg, 'service_role', async () => (await pg.query('select public.auth_pin_put($1,$2,$3) as v', [scope, k, v])).rows[0].v);
  assert.equal(await put('Gus Sample', '2468'), 'ok');
  assert.equal(await put('Ann Sample', '1111'), 'blocked');
  assert.equal(await put('Gus Sample', 'abcd'), 'invalid');
  assert.deepEqual(await pins(pg), { 'Ann Sample': '!blocked', 'Gus Sample': '2468', 'Twin Sample': '3333' });
  assert.equal(await put('F01', '5555', 'store'), 'ok');
});

test('the offboarding record in app_state: 完了 and 取消 are not turned back by a stale copy, and are not dropped', async () => {
  const pg = await setup();
  const put = v => as(pg, 'anon', () => pg.query("insert into app_state(key, value) values ('spl_offboardings__', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(v)]));
  const get = async () => (await pg.query("select value from app_state where key='spl_offboardings__'")).rows[0].value;
  await put([{ id: 'o1', empId: 'e1', status: '進行中' }, { id: 'o2', empId: 'e2', status: '進行中' }]);
  await put([{ id: 'o1', empId: 'e1', status: '完了', completedBy: 'Gus Sample', completedAt: '2026-10-15T00:00:00Z' }, { id: 'o2', empId: 'e2', status: '進行中' }]);
  // a v1084 device (local copy wins) writes its stale copy: o1 stays 完了 (the checklist edit of the stale copy goes in), o2 changes
  await put([{ id: 'o1', empId: 'e1', status: '進行中', completedBy: '', completedAt: '', checklist: [{ done: true }] }, { id: 'o2', empId: 'e2', status: '申請中' }]);
  const v = await get();
  assert.deepEqual(v.map(x => [x.id, x.status, x.completedBy || '']), [['o1', '完了', 'Gus Sample'], ['o2', '申請中', '']]);
  assert.deepEqual(v[0].checklist, [{ done: true }]);
  assert.ok((await log(pg, 'e1')).some(x => x.kind === 'offboard_kept' && x.new_status === '進行中'));
  // a copy that does not have o1 at all keeps it
  await put([{ id: 'o2', empId: 'e2', status: '申請中' }]);
  assert.deepEqual((await get()).map(x => x.id).sort(), ['o1', 'o2']);
  // 完了 → 取消 from the app key (the old app's 在籍に戻す, which cannot restore the person either) does not go in …
  await put([{ ...v[0], status: '取消' }, { id: 'o2', empId: 'e2', status: '申請中' }]);
  assert.equal((await get()).find(x => x.id === 'o1').status, '完了');
  // … nor from another service_role writer; only the restore (employee_restore) or the SQL Editor
  await as(pg, 'service_role', () => pg.query("update app_state set value = $1 where key='spl_offboardings__'", [JSON.stringify([{ ...v[0], status: '取消' }, { id: 'o2', empId: 'e2', status: '申請中' }])]));
  assert.equal((await get()).find(x => x.id === 'o1').status, '完了');
  await pg.query("update app_state set value = $1 where key='spl_offboardings__'", [JSON.stringify([{ ...v[0], status: '取消' }, { id: 'o2', empId: 'e2', status: '申請中' }])]);
  assert.equal((await get()).find(x => x.id === 'o1').status, '取消', 'the SQL Editor');
  // 取消 does not go back
  await put([{ ...v[0], status: '完了' }, { id: 'o2', empId: 'e2', status: '申請中' }]);
  assert.equal((await get()).find(x => x.id === 'o1').status, '取消');
  // a deletion mark is respected
  await put([{ ...v[0], status: '取消', _deleted: true }, { id: 'o2', status: '申請中' }]);
  assert.equal((await get()).find(x => x.id === 'o1')._deleted, true);
  // other keys are not looked at
  await as(pg, 'anon', () => pg.query("insert into app_state(key, value) values ('approvals', '[{\"id\":\"a\",\"status\":\"完了\"}]') on conflict (key) do update set value = excluded.value"));
  await as(pg, 'anon', () => pg.query("insert into app_state(key, value) values ('approvals', '[]') on conflict (key) do update set value = excluded.value"));
  assert.deepEqual((await pg.query("select value from app_state where key='approvals'")).rows[0].value, []);
});

test('restoring through the server also sets that person\'s offboarding records to 取消 (not when an approval is undone)', async () => {
  const pg = await setup();
  await as(pg, 'anon', () => pg.query("insert into app_state(key, value, updated_at) values ('spl_offboardings__', $1, '2026-01-01')", [JSON.stringify([
    { id: 'o1', empId: 'e1', status: '完了', completedBy: 'Gus Sample' }, { id: 'o2', empId: 'e2', status: '進行中' }, { id: 'o3', empId: 'e1', status: '取消', _stAt: 'x' }, { id: 'o4', empId: 'e1', status: '進行中', _deleted: true }])]));
  await resign(pg, 'e1'); await resign(pg, 'e2');
  const res = await restore(pg, 'e1', 'Gus Sample');
  assert.equal(res.ok, true); assert.equal(res.already, false);
  let row = (await pg.query("select value, updated_at from app_state where key='spl_offboardings__'")).rows[0];
  const by = Object.fromEntries(row.value.map(x => [x.id, x]));
  assert.equal(by.o1.status, '取消'); assert.equal(by.o1._stBy, 'Gus Sample'); assert.equal(typeof by.o1._mut, 'number'); assert.equal(by.o1.completedBy, 'Gus Sample', 'the rest of the record stays');
  assert.equal(by.o2.status, '進行中', 'another person is not touched');
  assert.equal(by.o3._stAt, 'x', 'an already cancelled record is not touched');
  assert.equal(by.o4.status, '進行中', 'a deleted record is not touched');
  assert.ok(row.updated_at > new Date('2026-01-02'), 'the row time moves (other devices see the change)');
  assert.deepEqual(row.value.map(x => x.id), ['o1', 'o2', 'o3', 'o4'], 'the order stays');
  // undoing an approval: the person comes back, the record is left for the app (申請中)
  const r2 = await as(pg, 'service_role', async () => (await pg.query("select public.employee_restore('e2', 'Gus Sample', true, 'gm') as v")).rows[0].v);
  assert.equal(r2.ok, true); assert.equal(r2.already, false);
  assert.equal((await row_(pg, 'e2')).data.status, '在籍');
  assert.equal((await row_(pg, 'e2')).data._restoreAt, undefined, 'no "restored" mark: if the record ends up 完了 anyway, the repair list shows the person');
  row = (await pg.query("select value from app_state where key='spl_offboardings__'")).rows[0];
  assert.equal(row.value.find(x => x.id === 'o2').status, '進行中');
  // twice is the same; nobody of that id: not_found
  assert.equal((await restore(pg, 'e1')).already, true);
  assert.deepEqual(await restore(pg, 'nobody'), { ok: false, error: 'not_found' });
});
const row_ = row;

test('the app key cannot delete a row, put a resigned person back by deleting and inserting, or break the data; another service_role writer cannot reinstate either', async () => {
  const pg = await setup();
  await pg.exec('grant delete on public.employees to anon');               // in case the project grants it (Supabase does by default)
  await resign(pg, 'e1', { osDisabled: true });
  const before = (await row(pg, 'e1')).data;
  // delete: refused (the row stays) and logged
  await as(pg, 'anon', () => pg.query("delete from employees where id='e1'"));
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  assert.ok((await pg.query("select 1 from employee_status_log where emp_id='e1' and kind='refused' and detail->>'reason'='delete'")).rows.length);
  // data that is not an object: the stored data and state stay (OS account off is not dropped)
  await upsert(pg, [{ id: 'e2', name: 'Bob Sample', status: '在籍' }]);
  await upsert(pg, [{ ...(await row(pg, 'e2')).data, osDisabled: true }]);
  assert.equal(await state(pg, 'e2').then(x => x.blocked), true);
  await as(pg, 'anon', () => pg.query(`update employees set data = '"x"'::jsonb where id='e2'`));
  assert.equal((await row(pg, 'e2')).data.osDisabled, true);
  assert.equal((await state(pg, 'e2')).blocked, true);
  // the database owner deletes a resigned person's row (her stops are still recorded); the app key cannot insert her back in service
  await pg.query("delete from employees where id='e1'");
  await upsert(pg, [{ ...before, status: '在籍', osDisabled: false, resignDate: '' }]);
  assert.equal((await pg.query("select count(*)::int as n from employees where id='e1'")).rows[0].n, 0, 'not inserted');
  assert.equal((await pins(pg))['Ann Sample'], '!blocked'); assert.equal(await mgr(pg, U.ann), 'suspended'); assert.equal(await bot(pg, U.ann), false);
  // … inserting her as resigned is allowed (nothing comes back)
  await upsert(pg, [{ ...before }]);
  assert.equal((await row(pg, 'e1')).data.status, '退職');
  // another service_role writer (not the restore) cannot put her back in service; its other changes go in
  await as(pg, 'service_role', () => pg.query(`update employees set status='在籍', data = data || '{"status":"在籍","osDisabled":false,"title":"Senior Accountant","_restoreAt":"2099-01-01T00:00:00Z"}' where id='e1'`));
  let r = await row(pg, 'e1');
  assert.equal(r.data.status, '退職'); assert.equal(r.data.title, 'Senior Accountant'); assert.equal(r.data._restoreAt, undefined);
  assert.equal((await pins(pg))['Ann Sample'], '!blocked');
  // the restore (employee_restore as service_role) does it, and the mark does not stay on after it
  assert.equal((await restore(pg, 'e1')).ok, true);
  assert.equal((await row(pg, 'e1')).data.status, '在籍'); assert.equal(await mgr(pg, U.ann), 'office');
  await resign(pg, 'e1');
  for (const keep of [true, false]) {                                   // undoing an approval (no record change) and the full restore
    await upsert(pg, [{ ...(await row(pg, 'e2')).data, osDisabled: true }]);
    await as(pg, 'service_role', async () => {
      await pg.exec('begin');
      try {
        await pg.query("select public.employee_restore('e2', 'Gus Sample', $1, 'gm')", [keep]);
        await pg.query(`update employees set status='在籍', data = data || '{"status":"在籍"}' where id='e1'`);   // same transaction, after the restore
        assert.equal((await pg.query("select data->>'status' as s from employees where id='e1'")).rows[0].s, '退職', 'the restore\'s mark ends with it (keep ' + keep + ')');
      } finally { await pg.exec('commit'); }
    });
  }
});

test('a GM / CEO person can be restored only by a GM / CEO (Moto 10/15); a service_role call without the restorer\'s role restores nobody', async () => {
  const M = { b: '00000000-0000-4000-8000-0000000000b1', c: '00000000-0000-4000-8000-0000000000b2' };
  const pg = await setup({ before: async pg => {
    await pg.query("insert into manager_auth(user_id, role, emp_id) values ($1, 'ceo', 'e2'), ($2, 'gm', 'e5')", [M.b, M.c]);   // crew rows with a GM / CEO email account
  } });
  const stillOut = async id => { const r = await row(pg, id); assert.equal(r.data.status, '退職', id); assert.equal(r.status, '退職', id); };
  // (1) the employee's own role is gm (Gus: his manager account is held as gm too)
  await resign(pg, 'e3');
  assert.equal(await mgr(pg, U.gm), 'suspended');
  for (const caller of ['am', 'office', 'AM'])
    assert.deepEqual(await restore(pg, 'e3', 'Amy Sample', 'service_role', caller), { ok: false, error: 'forbidden_rank' }, caller);
  await stillOut('e3');
  assert.equal((await pins(pg))['Gus Sample'], '!blocked', 'the PIN stays stopped');
  assert.equal(await mgr(pg, U.gm), 'suspended', 'the GM account stays stopped');
  // (2) the role of the employee row is crew, but the held (stopped) manager account was ceo
  await resign(pg, 'e2');
  assert.equal(await mgr(pg, M.b), 'suspended');
  assert.deepEqual(await restore(pg, 'e2', 'Amy Sample', 'service_role', 'am'), { ok: false, error: 'forbidden_rank' });
  await stillOut('e2');
  // (3) only the linked manager account says gm (resigned before the SQL ran: nothing held, the account still active)
  await pg.exec('alter table employees disable trigger employees_access_after_trg');
  await upsert(pg, [{ ...(await row(pg, 'e5')).data, status: '退職' }]);
  await pg.exec('alter table employees enable trigger employees_access_after_trg');
  assert.equal(await mgr(pg, M.c), 'gm');
  assert.deepEqual(await restore(pg, 'e5', 'Amy Sample', 'service_role', 'office'), { ok: false, error: 'forbidden_rank' });
  await stillOut('e5');
  // (4) the employee's role is ceo, no manager account at all
  await resign(pg, 'e4', { role: 'ceo' });
  assert.deepEqual(await restore(pg, 'e4', 'Amy Sample', 'service_role', 'am'), { ok: false, error: 'forbidden_rank' });
  await stillOut('e4');
  // undoing an approval is a restore too
  assert.deepEqual(await restore(pg, 'e3', 'Amy Sample', 'service_role', 'am', true), { ok: false, error: 'forbidden_rank' });
  // a service_role call without the restorer's role (or with another role) restores nobody, a crew member included
  await resign(pg, 'e1');
  for (const caller of [null, '', 'crew', 'office_crew', 'suspended'])
    assert.deepEqual(await restore(pg, 'e1', 'x', 'service_role', caller), { ok: false, error: 'forbidden' }, String(caller));
  await stillOut('e1');
  // AM / accounting restore the others; GM / CEO restore GM / CEO people
  assert.equal((await restore(pg, 'e1', 'Amy Sample', 'service_role', 'am')).ok, true);
  assert.equal((await row(pg, 'e1')).data.status, '在籍');
  assert.equal((await restore(pg, 'e3', 'Cat Sample', 'service_role', 'ceo')).ok, true);
  assert.equal((await row(pg, 'e3')).data.status, '在籍'); assert.equal(await mgr(pg, U.gm), 'gm', 'the GM account comes back as gm');
  assert.equal((await restore(pg, 'e2', 'Gus Sample', 'service_role', 'gm')).ok, true);
  assert.equal(await mgr(pg, M.b), 'ceo');
  assert.equal((await restore(pg, 'e5', 'Gus Sample', 'service_role', ' GM ')).ok, true, 'the role is compared without case / spaces');
  // the SQL Editor (database owner) restores anyone without a role
  const ed = (await pg.query("select public.employee_restore('e4', 'Admin') as v")).rows[0].v;
  assert.equal(ed.ok, true); assert.equal((await row(pg, 'e4')).data.status, '在籍');
});

test('PINs are keyed by the name exactly as stored (as the app and auth-pin do)', async () => {
  const pg = await setup();
  await pg.query(`update auth_pins set data = data || '{"Cy Sample ":"5555"}' where id='staff'`);
  await upsert(pg, [{ id: 'e7', name: 'Cy Sample ', status: '在籍' }]);
  await resign(pg, 'e7');
  const p = await pins(pg);
  assert.equal(p['Cy Sample '], '!blocked');
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'Cy Sample'), false);
  assert.equal((await state(pg, 'e7')).pin, 'locked');
  await restore(pg, 'e7');
  assert.equal((await pins(pg))['Cy Sample '], '5555');
});

test('a status change made on a stale copy is kept and logged; the same change on the current version goes in', async () => {
  const pg = await setup();
  const stale = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...stale, title: 'Crew Leader' }]);                       // someone else changes the title only
  assert.equal((await row(pg, 'e2')).data._stV, 1, 'a change of other fields does not move the version');
  await upsert(pg, [{ ...stale, status: '休職' }]);                              // read before the title change: still version 1 → accepted
  assert.equal((await row(pg, 'e2')).data.status, '休職');
  assert.equal((await row(pg, 'e2')).data.title, 'Crew', 'the whole stale row overwrote the title (fields other than the state are as before)');
  const now = (await row(pg, 'e2')).data;
  await upsert(pg, [{ ...now, status: '在籍' }]);                                // version 2 → 3
  await upsert(pg, [{ ...now, status: '研修中' }]);                              // based on version 2 → kept
  assert.equal((await row(pg, 'e2')).data.status, '在籍');
  assert.deepEqual((await log(pg, 'e2')).filter(x => x.kind === 'kept').map(x => [x.old_status, x.new_status, x.version]), [['在籍', '研修中', 2]]);
});

test('rollback gives back the stopped PINs and accounts, and removes the guard (the rows and the log stay)', async () => {
  const pg = await setup();
  await resign(pg, 'e1');
  await pg.exec(dbFile('employee-resign-rollback.sql'));
  assert.equal((await pins(pg))['Ann Sample'], '4821');
  assert.equal(await mgr(pg, U.ann), 'office');
  assert.equal(await bot(pg, U.ann), true);
  assert.equal((await row(pg, 'e1')).data.status, '退職', 'the employee row is not changed');
  const trg = (await pg.query("select count(*)::int as n from pg_trigger where tgrelid in ('public.employees'::regclass, 'public.app_state'::regclass) and not tgisinternal")).rows[0].n;
  assert.equal(trg, 0);
  assert.equal((await pg.query("select to_regclass('public.employee_access_hold') as t")).rows[0].t, null);
  assert.equal((await pg.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname = any($1)`, [FNS])).rows[0].n, 0);
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
  // an earlier restore without the restorer's role (3 arguments) left in place shows NG; running the SQL again removes it
  await pg.exec(`create function public.employee_restore(p_emp text, p_by text, p_keep_offboard boolean default false) returns jsonb
    language sql security invoker set search_path=public,pg_temp as $$ select '{}'::jsonb $$`);
  assert.notEqual((await pg.exec(dbFile('employee-resign-postcheck.sql'))).at(-1).rows[0].verdict, 'OK');
  await pg.exec(MIG);
  assert.equal((await pg.query("select count(*)::int as n from pg_proc where proname = 'employee_restore'")).rows[0].n, 1);
  for (const r of (await pg.exec(dbFile('employee-resign-postcheck.sql'))).at(-1).rows) assert.equal(r.verdict, 'OK', r.item);
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
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text, constraint role_ok check (role in ('ceo','gm','office','office_crew')));`);
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
  assert.match(by["manager_auth.role accepts 'suspended'"].verdict, /要対応/);
  assert.match(by["manager_auth.role accepts 'suspended'"].detail, /role_ok/);
  assert.equal(JSON.stringify(await pg.query('select * from employees order by id')), before);
  // GM decided "keep in service" for that record → not listed again (a newer completed record would be listed)
  await pg.query(`update employees set data = data || '{"_resignOk":{"ob":"ob1","at":"2026-10-11T00:00:00Z","by":"Gus Sample"}}' where id = 'e1'`);
  const rows2 = (await pg.exec(dbFile('employee-resign-check.sql'))).at(-1).rows;
  assert.equal(rows2.find(x => x.item === 'in service, but the latest offboarding is 完了 (resurrected?)').value, '0');
  await pg.query(`update employees set data = data || '{"_resignOk":{"ob":"ob0"}}' where id = 'e1'`);
  const rows3 = (await pg.exec(dbFile('employee-resign-check.sql'))).at(-1).rows;
  assert.equal(rows3.find(x => x.item === 'in service, but the latest offboarding is 完了 (resurrected?)').value, '1');
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
