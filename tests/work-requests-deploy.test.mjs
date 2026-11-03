// v1131 work-requests: the files Moto pastes (deploy/work-requests-v1131) are the migration, and the checks read what they should. Synthetic DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/work-requests-v1131/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');

test('the SQL to paste is the migration, letter for letter', () => {
  assert.equal(read('2_追加のSQL.sql'), MIG);
  assert.match(read('手順.md'), /Verify JWT は OFF/);
});

test('pre-check, post-check and stop on a synthetic database', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.manager_auth(role, emp_id) values ('gm','E2'),('office','E3');
    insert into public.app_state(key, value) values ('mileage_config', '{"__st":1,"v":{"ratePerMile":0.7}}'), ('spl_mileage_requests_A', '[]');`);
  const pre = (await pg.query(read('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.every(r => !/^STOP/.test(r.result)), JSON.stringify(pre));
  assert.equal(pre.find(r => /mileage rate/.test(r.check_name)).result, 'OK', 'a wrapped value is read');
  assert.equal(pre.find(r => /wr_ tables/.test(r.check_name)).result, '0');
  await pg.exec(MIG);
  const post = (await pg.query(read('3_確認のSQL_読むだけ.sql'))).rows;
  const by = n => post.find(r => r.check_name.startsWith(n)).result;
  assert.equal(by('wr_ tables'), 'OK'); assert.equal(by('row level'), 'OK'); assert.equal(by('browser roles cannot read'), 'OK');
  assert.equal(by('browser roles cannot run'), 'OK'); assert.equal(by('functions'), '33'); assert.equal(by('live'), 'false'); assert.equal(by('requests'), '0');
  await pg.exec('update public.wr_settings set live = true');
  await pg.exec(read('止める.sql'));
  assert.equal((await pg.query('select live, rev from public.wr_settings')).rows[0].live, false);
  await pg.exec(read('止める.sql'));
  assert.equal((await pg.query('select rev from public.wr_settings')).rows[0].rev, 2, 'twice: the same');
  assert.equal((await pg.query(`select value->>'live' v from public.app_state where key = 'wr_live'`)).rows[0].v, 'false', 'the shared mark is off too');
});
