// v1183 入れる一式（deploy/device-login-v1183）：SQL は migration と同じ・確かめの SQL・止める SQL を PGlite で流す（合成データ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = f => fs.readFileSync(new URL('../deploy/device-login-v1183/' + f, import.meta.url), 'utf8');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261203090000_device_login.sql', import.meta.url), 'utf8');

async function base() {
  const pg = new PGlite();
  // Supabase と同じく、新しい表・関数は既定で公開の鍵にも付く（SQL が外すことを確かめる）
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000c2','gm','E2');
    insert into public.employees values ('E2','GM Sample','在籍','gm','OFFICE','{}'),('S1','Aki Test','在籍','crew','F01','{}');`);
  return pg;
}
const rows = async (pg, sql) => { const r = await pg.exec(sql); return r[r.length - 1].rows; };

test('2 の SQL は migration と同じ', () => { assert.equal(D('2_SQL.sql'), MIG); });

test('1 の確認：入れる前と後（STOP なし・読むだけ）', async () => {
  const pg = await base();
  const before = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.ok(!before.some(r => r.result === 'STOP'), JSON.stringify(before));
  assert.match(before.find(r => r.no === 4).result, /まだ/);
  assert.equal(before.find(r => r.no === 5).result, '1');
  await pg.exec(D('2_SQL.sql'));
  const after = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.match(after.find(r => r.no === 4).result, /もう入っています/);
  const pg2 = new PGlite(); await pg2.exec('create table public.employees(id text primary key)');
  const stop = await rows(pg2, D('1_最初に確認_読むだけ.sql'));
  assert.equal(stop.find(r => r.no === 2).result, 'STOP');
});

test('3 の確認：入れたあと NG なし・2 回流しても同じ・公開の鍵の付け直しで NG', async () => {
  const pg = await base();
  await pg.exec(D('2_SQL.sql')); await pg.exec(D('2_SQL.sql'));
  const r = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(!r.some(x => x.result === 'NG'), JSON.stringify(r));
  assert.equal(r.length, 9);
  assert.equal(r.find(x => x.no === 9).detail, '0 人・0 台');
  await pg.exec('grant select on public.dl_devices to anon');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 3).result, 'NG');
  await pg.exec('revoke select on public.dl_devices from anon; grant execute on function public.dl_stage() to authenticated');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 5).result, 'NG');
  const pg0 = await base();
  const none = await rows(pg0, D('3_確認_読むだけ.sql'));
  assert.ok(none.filter(x => x.result === 'NG').length >= 5, '入れる前は NG');
});

test('止める SQL：招待と端末を止めて試す人を空に・記録は残す', async () => {
  const pg = await base();
  await pg.exec(D('2_SQL.sql'));
  await pg.exec(`insert into public.dl_trial(emp_id, added_by) values ('S1','admin:x');
    insert into public.dl_invites(emp_id, token_hash, created_by, expires_at) values ('S1', repeat('a',64), 'admin:x', now() + interval '1 day');
    insert into public.dl_devices(emp_id, pubkey, name, expires_at) values ('S1', '{"kty":"EC"}', 'Phone', now() + interval '90 days');`);
  const r = await rows(pg, D('止める.sql'));
  assert.deepEqual(r[0], { trial_left: 0, devices_left: 0 });
  assert.equal((await rows(pg, `select count(*)::int n from public.dl_invites where revoked_at is not null`))[0].n, 1);
  assert.equal((await rows(pg, `select count(*)::int n from public.dl_events where reason = 'trial_stopped'`))[0].n, 1);
  assert.equal((await rows(pg, `select count(*)::int n from public.dl_devices`))[0].n, 1, '端末の行は消さない');
});
