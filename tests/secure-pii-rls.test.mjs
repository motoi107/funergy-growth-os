// v1144（2b-6）：従業員の表の個人の欄を emp_pii に写して消し、公開の鍵から外す SQL（20261113090000）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1143 のあと／RLS が OFF・ON から：emp_pii に写す（もうある人は emp_pii の値を残す）・従業員の表から 5 つの欄だけ消す（ほかの欄・状態の版はそのまま）
//   ・anon・authenticated は emp_pii を読めない・書けない。ほかの行は今までどおり。従業員の表に書いても 5 つの欄は入らない（見張り）
//   ・本番と同じ従業員の表の見張り（退職の守り 20261023090000・変更記録 20261029090000）と一緒に動く（変更記録に行を足さない）
//   ・最初に確かめる SQL・確認の SQL（すべて OK・穴があれば NG）・2 回流しても同じ・戻す SQL で従業員の表に戻る
//   ・SQL の決まり（ss_secret_key）と関数の決まり（ssIsKey・csIsKey・hrIsKey・piiIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { secretKey, hrIsKey, piiIsKey } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PREV = ['20261108090000_secure_state_rls.sql', '20261109090000_secure_cs_rls.sql', '20261110090000_secure_settings_write.sql', '20261111090000_secure_hr_rls.sql', '20261112090000_secure_settings_more.sql'].map(f => rd('supabase/migrations/' + f));
const MIG = rd('supabase/migrations/20261113090000_secure_emp_pii.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const GUARD = rd('supabase/migrations/20261023090000_employee_resign_guard.sql');
const FLOG = rd('supabase/migrations/20261029090000_employee_field_log.sql');
const PRE = rd('db/secure-pii-precheck.sql');
const POST = rd('db/secure-pii-postcheck.sql');
const BACK = rd('db/secure-pii-rollback.sql');
const F = ['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
const PEOPLE = [
  { id: 'e1', name: 'Ann Sample', role: 'crew', title: 'Crew', store: 'S1', status: '在籍', dob: '2001-01-01', cardLast4: '', insurance: true, dental: false, insuranceAmt: 250, coef: 1 },
  { id: 'e2', name: 'Bob Sample', role: 'sl', title: 'Store Manager', store: 'S1', status: '在籍', dob: '1985-05-05', cardLast4: '1111', insurance: true, dental: true, insuranceAmt: null },
  { id: 'e3', name: 'Cy Sample', role: 'crew', title: 'Crew', store: 'S2', status: '退職', resignDate: '2026-09-01', dob: '1999/12/31' },   // 前からの形の違う値もそのまま写す
  { id: 'e4', name: 'Dee Sample', role: 'crew', title: 'Crew', store: 'S2', status: '在籍' },                                               // 個人の欄が無い人
];

async function mkdb(initial, { entry = false } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.bot_users(user_id uuid primary key, enabled boolean not null default true, created_at timestamptz not null default now());
    grant select, insert, update on public.employees to anon, authenticated;
    grant select, insert, update, delete on public.employees, public.auth_pins, public.manager_auth, public.bot_users to service_role;
    insert into public.auth_pins(id, data) values ('staff', '{}');`);
  for (const p of PEOPLE) await db.query('insert into public.employees(id,name,role,title,store,support,status,data) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [p.id, p.name, p.role, p.title, p.store, '[]', p.status, JSON.stringify({ ...p, support: [] })]);
  await db.query(`insert into public.employees(id,name,status,data) values ('e5','Odd Row','在籍','"not an object"'::jsonb)`);   // data がオブジェクトでない行（変えない）
  await db.exec(GUARD);
  await db.exec(FLOG);
  for (const k of ['growth_karte', 'applicants', 'tasks_all', 'mileage_config', 'notifications']) await db.query(`insert into public.app_state(key, value) values ($1, '{"v":1}')`, [k]);
  if (entry) await db.query(`insert into public.app_state(key, value) values ('emp_pii', $1::jsonb)`, [JSON.stringify({ e2: { dob: '1985-06-06', cardLast4: '1111', insurance: true, dental: false, insuranceAmt: 300, _at: 'x', _by: 'Gina' } })]);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security; create policy app_all on public.app_state for all to public using (true) with check (true);`);
  await db.exec(IDX);
  if (initial === 'v1143') for (const m of PREV) await db.exec(m);
  return db;
}
const as = async (db, role, sql, params) => { await db.exec(`set role ${role}`); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const dataOf = async (db, id) => (await db.query('select data from public.employees where id = $1', [id])).rows[0].data;
const pii = async db => { const r = (await db.query(`select value from public.app_state where key = 'emp_pii'`)).rows[0]; return r ? r.value : null; };
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]]));

for (const initial of ['v1143', 'off', 'on']) {
  test(`employee personal fields (from ${initial}): copied to emp_pii, removed from the table, hidden from the public keys; rollback puts them back`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 7);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.equal(pre.find(x => x.n === 3).value, '3・1・2・1・1', 'birthday 3 (e1, e2, e3)・card 1・medical 2・dental 1・amount 1');
    assert.equal(pre.find(x => x.n === 4).value, '1');
    assert.equal(pre.find(x => x.n === 5).value, 'まだない');
    assert.equal(pre.find(x => x.n === 6).ok, 'OK');
    assert.equal(pre.find(x => x.n === 7).ok, 'OK（まだ）');
    const before = {};
    for (const p of PEOPLE) before[p.id] = await dataOf(db, p.id);
    const st0 = (await db.query('select id, status from public.employees order by id')).rows;
    const log0 = (await db.query('select count(*)::int n from public.employee_field_log')).rows[0].n;
    await db.exec(MIG);
    const v = await pii(db);
    assert.deepEqual(Object.keys(v).sort(), ['e1', 'e2', 'e3'], 'the people with any of the fields');
    for (const id of ['e1', 'e2', 'e3']) {
      assert.deepEqual(pick(v[id], F), pick(before[id], F), id);
      assert.equal(v[id]._by, 'SQL 20261113090000');
    }
    for (const p of PEOPLE) {
      const d = await dataOf(db, p.id), b = { ...before[p.id] };
      for (const k of F) delete b[k];
      assert.deepEqual(d, b, p.id + ': only the five fields go (the rest and the status version stay)');
    }
    assert.deepEqual((await dataOf(db, 'e5')), 'not an object');
    assert.deepEqual((await db.query('select id, status from public.employees order by id')).rows, st0, 'status columns unchanged');
    assert.equal((await db.query('select count(*)::int n from public.employee_field_log')).rows[0].n, log0, 'no change log rows (the fields are not tracked)');
    // 公開の鍵
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await as(db, role, `select key from public.app_state where key = 'emp_pii'`)).rows.length, 0, role + ' cannot read emp_pii');
      assert.ok((await as(db, role, `select key from public.app_state where key = 'tasks_all'`)).rows.length === 1, role + ' reads the other rows');
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('emp_pii', '{}')`), role + ' cannot add emp_pii');
      const u = await as(db, role, `update public.app_state set value = '{}' where key = 'emp_pii' returning key`).catch(() => ({ rows: [] }));
      assert.equal(u.rows.length, 0);
      const dl = await as(db, role, `delete from public.app_state where key = 'emp_pii' returning key`).catch(() => ({ rows: [] }));
      assert.equal(dl.rows.length, 0);
      assert.equal((await as(db, role, `select count(*)::int n from public.app_state_index(array[]::text[]) where key = 'emp_pii'`)).rows[0].n, 0);
    }
    assert.deepEqual(pick(v.e2, F), pick((await pii(db)).e2, F), 'the server key still reads it');
    // 前の版の端末（公開の鍵）が個人の欄を書いても入らない。ほかの欄・状態の変更は今までどおり
    const d1 = await dataOf(db, 'e1');
    await as(db, 'anon', `update public.employees set data = $1::jsonb, store = 'S2' where id = 'e1'`, [JSON.stringify({ ...d1, dob: '1111-11-11', insuranceAmt: 9, store: 'S2', status: '退職', _stV: d1._stV })]);
    const d1b = await dataOf(db, 'e1');
    assert.ok(!F.some(k => k in d1b), 'stripped');
    assert.equal(d1b.store, 'S2');
    assert.equal(d1b.status, '退職', 'a status change with the right version still goes through the resignation guard');
    assert.equal(d1b._stV, d1._stV + 1);
    await as(db, 'anon', `insert into public.employees(id, name, status, data) values ('e9', 'New Sample', '在籍', '{"id":"e9","name":"New Sample","status":"在籍","dob":"2000-01-01","cardLast4":"9999"}')`);
    const d9 = await dataOf(db, 'e9');
    assert.ok(!F.some(k => k in d9), 'a new row too');
    const post = await postRows(db);
    for (const r of post) assert.match(r.ok, /^(OK|info)/, r.n + ' ' + r.what + ' = ' + r.value + ' ' + r.ok);
    assert.equal(post.length, 16);
    assert.equal(post.find(x => x.n === 7).value, '3 人');
    assert.equal(post.find(x => x.n === 16).ok, 'OK');
    // 2 回目：何も変えない
    const v1 = JSON.stringify(await pii(db)), e1 = JSON.stringify((await db.query('select * from public.employees order by id')).rows);
    await db.exec(MIG);
    assert.equal(JSON.stringify(await pii(db)), v1);
    assert.equal(JSON.stringify((await db.query('select * from public.employees order by id')).rows), e1);
    assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname = 'employees_pii_strip_trg' and not tgisinternal`)).rows[0].n, 1);
    // 戻す：emp_pii の値を従業員の表に（e1 は emp_pii の値。e9 は emp_pii に無いので戻らない）・見張りを外す・emp_pii はまた読める
    await db.exec(BACK);
    for (const id of ['e2', 'e3']) assert.deepEqual(pick(await dataOf(db, id), F), pick(before[id], F), id);
    assert.deepEqual(pick(await dataOf(db, 'e1'), F), pick(before.e1, F));
    assert.equal((await dataOf(db, 'e1')).store, 'S2', 'the other fields stay');
    assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname = 'employees_pii_strip_trg'`)).rows[0].n, 0);
    assert.equal((await as(db, 'anon', `select key from public.app_state where key = 'emp_pii'`)).rows.length, initial === 'v1143' ? 1 : 1);
    if (initial === 'v1143') assert.equal((await as(db, 'anon', `select key from public.app_state where key in ('growth_karte', 'applicants')`)).rows.length, 0, 'the earlier keys stay hidden');
    await as(db, 'anon', `update public.employees set data = data || '{"dob":"2000-02-02"}'::jsonb where id = 'e4'`);
    assert.equal((await dataOf(db, 'e4')).dob, '2000-02-02', 'after rollback the table takes the fields again');
    await db.exec(BACK);   // 2 回流しても同じ
  });
}

test('a person already in emp_pii (changed with the v1144 function) keeps the emp_pii value; the precheck counts the difference', async () => {
  const db = await mkdb('v1143', { entry: true });
  const pre = (await db.query(PRE)).rows;
  assert.equal(pre.find(x => x.n === 5).value.split('・')[0], '1 人');
  assert.equal(pre.find(x => x.n === 6).value, '1');
  assert.match(pre.find(x => x.n === 6).ok, /^info/);
  await db.exec(MIG);
  const v = await pii(db);
  assert.equal(v.e2.dob, '1985-06-06', 'emp_pii first');
  assert.equal(v.e2._by, 'Gina');
  assert.equal(v.e1._by, 'SQL 20261113090000');
  assert.ok(!('dob' in await dataOf(db, 'e2')));
});

test('an emp_pii row that is not an object: STOP, nothing changed', async () => {
  const db = await mkdb('v1143');
  await db.query(`insert into public.app_state(key, value) values ('emp_pii', '["x"]')`);
  assert.equal((await db.query(PRE)).rows.find(x => x.n === 5).ok.slice(0, 4), 'STOP');
  const e0 = JSON.stringify((await db.query('select * from public.employees order by id')).rows);
  await assert.rejects(db.exec(MIG), /STOP: app_state の emp_pii/);
  assert.equal(JSON.stringify((await db.query('select * from public.employees order by id')).rows), e0);
});

test('the postcheck finds holes', async () => {
  const db = await mkdb('v1143');
  await db.exec(MIG);
  await db.exec('drop trigger employees_pii_strip_trg on public.employees');
  await db.query(`update public.employees set data = data || '{"dental":true}'::jsonb where id = 'e4'`);
  const post = await postRows(db);
  assert.equal(post.find(x => x.n === 4).ok, 'NG');
  assert.equal(post.find(x => x.n === 5).ok, 'NG');
  assert.equal(post.find(x => x.n === 6).ok.slice(0, 2), 'NG');
  assert.equal(post.find(x => x.n === 10).ok, 'NG');
  const db2 = await mkdb('v1143');
  await db2.exec(MIG);
  await db2.exec(`create or replace function public.ss_secret_key(k text) returns boolean language sql immutable as $$ select k = 'growth_karte' $$`);
  const p2 = await postRows(db2);
  assert.equal(p2.find(x => x.n === 3).ok, 'NG');
  assert.equal(p2.find(x => x.n === 8).ok, 'NG');
});

test('the SQL rule and the function rule agree', async () => {
  const db = await mkdb('v1143');
  await db.exec(MIG);
  const keys = ['emp_pii', 'emp_pii ', 'Emp_pii', 'emp_pii_x', 'm_employees', 'growth_karte', 'spl_bonus_q_2026-Q3', 'lss_emp_A B', 'applicants', 'reject_log', 'growthhub', 'tasks_all', 'career_cfg', 'mileage_config'];
  for (const k of keys) {
    const sql = (await db.query('select public.ss_secret_key($1) v', [k])).rows[0].v;
    assert.equal(sql, secretKey(k) || hrIsKey(k) || piiIsKey(k), k);
  }
});
