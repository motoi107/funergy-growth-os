// v1109 bonus-close: the files Moto pastes (deploy/bonus-close-v1109) are the same as the reviewed sources, the SQL can run twice,
// and the checks answer OK on the result. PGlite only; no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const D = new URL('../deploy/bonus-close-v1109/', import.meta.url);
const read = (u) => fs.readFileSync(u, 'utf8');
const MIG = read(new URL('../supabase/migrations/20261028090000_bonus_close.sql', import.meta.url));
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('the pasted SQL is the migration; the single-file function is the handler with the serve line', () => {
  assert.equal(read(new URL('1_追加のSQL_ボーナスの締め.sql', D)), MIG);
  const one = read(new URL('3_関数_bonus-close_index.ts', D));
  const h = read(new URL('../supabase/functions/bonus-close/handler.mjs', import.meta.url));
  const ix = read(new URL('../supabase/functions/bonus-close/index.ts', import.meta.url));
  assert.ok(one.includes(h.trimEnd()), 'the handler, unchanged');
  const serve = ix.split('\n').find(l => l.includes('Deno.serve'));
  assert.ok(serve && one.trimEnd().endsWith(serve.trim()));
  assert.doesNotMatch(one, /^import /m, 'no imports (one file)');
  for (const f of ['0_最初に確認_読むだけ.sql', '2_確認のSQL_読むだけ.sql', '手順.md', '戻す_使う前だけ.sql']) assert.ok(fs.existsSync(new URL(f, D)), f);
});

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000e1','gm','E1'),('00000000-0000-4000-8000-0000000000e2','office','E2');`);
  return pg;
}
const rows = async (pg, file) => (await pg.query(read(new URL(file, D)))).rows;

test('before → SQL → twice → the checks: all OK; the rollback stops once anything is saved', async () => {
  const pg = await db();
  const pre = await rows(pg, '0_最初に確認_読むだけ.sql');
  assert.deepEqual(pre.map(r => r.result), ['OK', 'OK', '0', '1', '1']);
  await pg.exec(read(new URL('1_追加のSQL_ボーナスの締め.sql', D)));
  await pg.exec(read(new URL('1_追加のSQL_ボーナスの締め.sql', D)));   // twice: the same
  const post = await rows(pg, '2_確認のSQL_読むだけ.sql');
  assert.deepEqual(post.slice(0, -1).map(r => [r.check_item, r.result]).filter(x => x[1] !== 'OK'), []);
  assert.equal(post.at(-1).result, '0');
  // something saved → the rollback stops and keeps everything
  await pg.exec(`set role service_role; select public.bc_draft_save('{"actor":"00000000-0000-4000-8000-0000000000e1","quarter":"2026-Q3","expect_rev":0,"draft":{"choices":{}}}'::jsonb); reset role;`);
  await assert.rejects(pg.exec(read(new URL('戻す_使う前だけ.sql', D))), /STOP/);
  assert.equal((await pg.query(`select count(*)::int n from public.bc_quarters`)).rows[0].n, 1);
  // a fresh database: the rollback removes everything
  const pg2 = await db();
  await pg2.exec(read(new URL('1_追加のSQL_ボーナスの締め.sql', D)));
  await pg2.exec(read(new URL('戻す_使う前だけ.sql', D)));
  assert.equal((await pg2.query(`select count(*)::int n from information_schema.tables where table_name like 'bc\\_%'`)).rows[0].n, 0);
  assert.equal((await pg2.query(`select count(*)::int n from pg_proc where proname like 'bc\\_%'`)).rows[0].n, 0);
});
