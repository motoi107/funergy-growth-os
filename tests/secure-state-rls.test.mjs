// v1139（2b-1）：app_state の RLS（成長カルテ・賞与のキーを公開の鍵から外す）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・RLS が OFF の表／ON で今の決まりがある表の両方：anon・authenticated は対象のキーを読めない・書けない・消せない。ほかの行は今までどおり
//   ・サーバーの鍵（BYPASSRLS）は読める・書ける。app_state_index（security invoker）は anon には対象のキーを返さない
//   ・2 回流しても同じ。確認の SQL がすべて OK。戻す SQL で前と同じに（OFF だった表は OFF に）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（ssIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { ssIsKey, SS_KEYS } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const PRE = rd('db/secure-state-precheck.sql');
const POST = rd('db/secure-state-postcheck.sql');
const BACK = rd('db/secure-state-rls-rollback.sql');
const SECRET = ['growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra', 'spl_bonus_q_2026-Q3', 'spl_bonus_q_2026-Q4'];
const OTHER = ['tasks_all', 'bonus_eval_rule', 'bonus_eval_ovr', 'bonus_track', 'grade_hist', 'spl_bonus_qx', 'lss_emp_A', 'notifications'];

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid, role text, emp_id text);
    create table public.employees(id text primary key, name text);
    insert into public.employees values ('E-GM','G M');
    insert into public.manager_auth values ('aaaaaaaa-0000-0000-0000-00000000000a','gm','E-GM'), ('aaaaaaaa-0000-0000-0000-00000000000b','ceo',null);`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  const vals = [...SECRET, ...OTHER].map(k => `('${k}', '{"v":"${k}"}')`).join(',');
  await db.exec(`insert into public.app_state(key, value) values ${vals};`);
  await db.exec(IDX);
  return db;
}
const as = async (db, role, sql) => { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();

for (const initial of ['off', 'on']) {
  test(`app_state RLS (initially ${initial}): the public keys lose the karte and bonus rows, nothing else changes`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).value, initial === 'on' ? /^ON$/ : /^OFF/);
    assert.match(pre.find(x => x.n === 5).value, /^10 行/);
    assert.equal(pre.find(x => x.n === 7).value, '1', 'the CEO account without an employee is counted');
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), [...OTHER].sort(), role + ' sees only the other rows');
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('bonus_eval', '{}')`), role + ' cannot insert over a secret key');
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('spl_bonus_q_2030-Q1', '{}')`), role + ' cannot create a new split bonus row');
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('growth_karte', '{"x":1}') on conflict (key) do update set value = excluded.value`), role + ' cannot upsert');
      assert.equal((await as(db, role, `update public.app_state set value = '{"x":1}' where key = 'growth_karte'`)).affectedRows, 0);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'karte_pin'`)).affectedRows, 0);
      assert.ok(await fails(db, role, `update public.app_state set key = 'bonus_rules' where key = 'tasks_all'`), role + ' cannot rename a row into a secret key');
      // ほかの行は今までどおり読み書きできる
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      assert.equal((await as(db, role, `update public.app_state set value = '{"y":1}' where key = 'x_${role}'`)).affectedRows, 1);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    // サーバーの鍵は RLS を通らない
    assert.equal((await as(db, 'service_role', `select count(*)::int c from public.app_state where key = 'growth_karte'`)).rows[0].c, 1);
    assert.equal((await as(db, 'service_role', `update public.app_state set value = '{"by":"fn"}' where key = 'growth_karte'`)).affectedRows, 1);
    assert.equal((await db.query(`select value->>'by' b from public.app_state where key = 'growth_karte'`)).rows[0].b, 'fn');
    // 行の一覧（security invoker）も anon には出さない
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index()`)), [...OTHER].sort());
    assert.equal((await as(db, 'service_role', `select count(*)::int c from public.app_state_index()`)).rows[0].c, SECRET.length + OTHER.length);
    // 確認の SQL
    const res = await db.exec(POST);
    const rows = res.find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
    assert.equal(rows.length, 12);
    rows.filter(x => x.ok !== 'info').forEach(x => assert.equal(x.ok, 'OK', x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 11).value, '0', 'the row list was really checked as anon');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'spl_bonus_q_zz-postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.equal((await db.query(`select count(*)::int c from pg_class where relname = 'ss_chk'`)).rows[0].c, 0, 'the check leaves nothing behind');
    assert.equal((await db.query(`select current_user u`)).rows[0].u, 'postgres', 'the check gives the role back');
    // 確認の SQL は、決まりが外れていれば NG を出す
    await db.exec('alter policy ss_secret on public.app_state using (true) with check (true)');
    const bad = (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
    for (const n of [5, 8, 9, 10, 11, 12]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec(MIG);
    // ss_open は OFF だったときだけ
    const pol = (await db.query(`select policyname from pg_policies where tablename = 'app_state' order by 1`)).rows.map(x => x.policyname);
    assert.deepEqual(pol, initial === 'on' ? ['app_all', 'ss_secret'] : ['ss_open', 'ss_secret']);
    // 戻す（2 回流しても同じ）
    await db.exec(BACK); await db.exec(BACK);
    assert.equal((await as(db, 'anon', `select count(*)::int c from public.app_state`)).rows[0].c, SECRET.length + OTHER.length, 'after the rollback anon reads everything again');
    const rls = (await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r;
    assert.equal(rls, initial === 'on', 'RLS goes back to how it was');
    assert.deepEqual((await db.query(`select policyname from pg_policies where tablename = 'app_state'`)).rows.map(x => x.policyname), initial === 'on' ? ['app_all'] : []);
    assert.equal((await db.query(`select count(*)::int c from pg_proc where proname = 'ss_secret_key'`)).rows[0].c, 0);
    // 戻したあとにもう一度入れても同じ
    await db.exec(MIG);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state')), [...OTHER].sort());
    await db.close();
  });
}

test('the SQL rule and the function rule agree on every key', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const keys = [...SS_KEYS, ...SECRET, ...OTHER, 'spl_bonus_q_', 'spl_bonus_q_x', 'Growth_karte', 'growth_karte ', 'bonus_q_2026', 'spl_bonus_q', 'karte_pin2', 'spl_spl_bonus_q_1', '',
    'spl_bonus_q_a&b', 'spl_bonus_q_a#b', 'spl_bonus_q_a+b', 'spl_bonus_q_a b', 'spl_bonus_q_2026-Q3\n', 'spl_bonus_q_四半期', 'spl_bonus_q_' + 'x'.repeat(40), 'spl_bonus_q_' + 'x'.repeat(41), 'SPL_BONUS_Q_2026-Q3'];
  for (let i = 0; i < 200; i++) keys.push('spl_bonus_q_' + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_secret_key($1) s', [k])).rows[0].s;
    assert.equal(s, ssIsKey(k), JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_secret_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the check SQL says NG when there is no secret row at all (otherwise "anon reads 0" proves nothing)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    insert into public.app_state(key, value) values ('tasks_all', '{}');`);
  await db.exec(IDX); await db.exec(MIG);
  const rows = (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
  assert.equal(rows.find(x => x.n === 7).ok, 'NG');
  await db.close();
});

test('RLS off but policies left from before: the migration stops (turning RLS on would wake them up)', async () => {
  const db = await mkdb('off');
  await db.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  const pre = (await db.query(PRE)).rows;
  assert.match(pre.find(x => x.n === 2).ok, /^STOP/);
  await assert.rejects(db.exec(MIG), /STOP/);
  assert.equal((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await db.query(`select count(*)::int c from pg_policies where policyname = 'ss_secret'`)).rows[0].c, 0);
  await db.close();
});

test('the migration stops (changes nothing) when there is no app_state', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
});
