// v1132 work-requests 2 段目：Moto さんが貼るファイル（deploy/work-requests-v1132）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/work-requests-v1132/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M1 = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');
const M2 = fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8');

test('the SQL to paste is the stage-2 migration, letter for letter; the steps say the order', () => {
  assert.equal(read('2_追加のSQL.sql'), M2);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /#123（v1131）→ この PR/); assert.match(h, /もう一度/);
});

async function base() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.manager_auth(role, emp_id) values ('gm','E2'),('office','E3');`);
  return pg;
}

test('without stage 1 the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await base();
  const pre = (await pg.query(read('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.some(r => /^STOP/.test(r.result)), JSON.stringify(pre)); assert.equal(pre.find(r => /^live/.test(r.check_name)).result, '—');
  await assert.rejects(pg.exec(M2), /STOP: 先に 20261104090000/);
  assert.equal((await pg.query(`select to_regclass('public.wr_views') v`)).rows[0].v, null);
});

test('pre-check, post-check, twice, and re-running stage 1 is caught', async () => {
  const pg = await base();
  await pg.exec(M1);
  const pre = (await pg.query(read('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.every(r => !/^STOP/.test(r.result)), JSON.stringify(pre));
  assert.equal(pre.find(r => /もう入っている/.test(r.check_name)).result, '0');
  assert.equal(pre.find(r => /functions now/.test(r.check_name)).result, '44');
  assert.equal(pre.find(r => /^live/.test(r.check_name)).result, 'false');
  assert.equal(pre.find(r => /G4 以上/.test(r.check_name)).result, '0');
  const post = async () => { const rows = (await pg.query(read('3_確認のSQL_読むだけ.sql'))).rows; return n => rows.find(r => r.check_name.startsWith(n)).result; };
  await pg.exec(M2);
  let by = await post();
  for (const n of ['wr_views', 'row level', 'browser roles cannot read', 'browser roles cannot run', '1 段目の関数', '振り分け']) assert.equal(by(n), 'OK', n);
  assert.equal(by('functions'), '54');
  await pg.exec(M2);
  by = await post(); assert.equal(by('functions'), '54', 'twice: the same'); assert.equal(by('振り分け'), 'OK');
  await pg.exec(M1);
  by = await post(); assert.match(by('振り分け'), /^NG/, 'stage 1 again puts its own wr_submit back');
  await pg.exec(M2);
  by = await post(); assert.equal(by('振り分け'), 'OK'); assert.equal(by('functions'), '54');
  assert.equal(by('browser roles cannot run'), 'OK');
});
