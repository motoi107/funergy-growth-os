// v1185 入れる一式（deploy/email-login-v1185）：SQL は migration と同じ・確かめの SQL・止める SQL を PGlite で流す（合成データ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = f => fs.readFileSync(new URL('../deploy/email-login-v1185/' + f, import.meta.url), 'utf8');
const MIG83 = fs.readFileSync(new URL('../supabase/migrations/20261203090000_device_login.sql', import.meta.url), 'utf8');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261205090000_email_login.sql', import.meta.url), 'utf8');
const GM = '00000000-0000-4000-8000-0000000000c2';

async function base({ v1183 = true } = {}) {
  const pg = new PGlite();
  // Supabase と同じく、新しい表・関数は既定で公開の鍵にも付く（SQL が外すことを確かめる）
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    insert into public.manager_auth values ('${GM}','gm','E2'),('00000000-0000-4000-8000-0000000000c1','ceo',null),('00000000-0000-4000-8000-0000000000c3','office','X9'),('00000000-0000-4000-8000-0000000000d1','am','E5');
    insert into public.employees values ('E2','GM Sample','在籍','gm','OFFICE','{}'),('S1','Aki Test','在籍','crew','F01','{}');`);
  if (v1183) await pg.exec(MIG83);
  return pg;
}
const rows = async (pg, sql) => { const r = await pg.exec(sql); return r[r.length - 1].rows; };

test('2 の SQL は migration と同じ', () => { assert.equal(D('2_SQL.sql'), MIG); });

test('1 の確認：v1183 がまだなら STOP・入れる前と後・数だけ（名前・メールは出さない）', async () => {
  const pg0 = await base({ v1183: false });
  const s = await rows(pg0, D('1_最初に確認_読むだけ.sql'));
  assert.equal(s.find(r => r.no === 1).result, 'STOP');
  await assert.rejects(pg0.exec(D('2_SQL.sql')), /STOP: 先に 20261203090000/);
  const pg = await base();
  const before = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.ok(!before.some(r => r.result === 'STOP'), JSON.stringify(before));
  assert.equal(before.length, 7);
  assert.match(before.find(r => r.no === 4).result, /まだ/);
  assert.equal(before.find(r => r.no === 5).result, '3', 'ceo・gm・office だけ数える（am は数えない）');
  assert.equal(before.find(r => r.no === 6).result, '2', 'emp_id が空の 1 つ・社員の表に無い 1 つ');
  assert.match(before.find(r => r.no === 7).result, /まだ無い/);
  assert.ok(!JSON.stringify(before).includes('GM Sample'), '名前を出さない');
  await pg.exec(D('2_SQL.sql'));
  const after = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.match(after.find(r => r.no === 4).result, /もう入っています/);
  await pg.exec(`insert into public.app_state values ('notifications', '{"x":1}', now())`);
  assert.match((await rows(pg, D('1_最初に確認_読むだけ.sql'))).find(r => r.no === 7).result, /注意/);
  await pg.exec(`update public.app_state set value = '[]' where key = 'notifications'`);
  assert.match((await rows(pg, D('1_最初に確認_読むだけ.sql'))).find(r => r.no === 7).result, /OK（配列）/);
  const pg2 = new PGlite(); await pg2.exec('create table public.employees(id text primary key)');
  const stop = await rows(pg2, D('1_最初に確認_読むだけ.sql'));
  assert.equal(stop.find(r => r.no === 2).result, 'STOP');
  assert.equal(stop.find(r => r.no === 3).result, 'STOP');
});

test('3 の確認：入れたあと NG なし・2 回流しても同じ・公開の鍵を付け直すと NG・入れる前は NG', async () => {
  const pg = await base();
  await pg.exec(D('2_SQL.sql')); await pg.exec(D('2_SQL.sql'));
  const r = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(!r.some(x => x.result === 'NG'), JSON.stringify(r));
  assert.equal(r.length, 9);
  assert.equal(r.find(x => x.no === 8).detail, '1 / 3');
  assert.equal(r.find(x => x.no === 9).detail, '0 回・0 台');
  const r83 = await rows(pg, fs.readFileSync(new URL('../deploy/device-login-v1183/3_確認_読むだけ.sql', import.meta.url), 'utf8'));
  assert.ok(!r83.some(x => x.result === 'NG'), 'v1185 のあとも v1183 の ③ は NG なし：' + JSON.stringify(r83));
  await pg.exec('grant select on public.dl_email_devices to anon');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 3).result, 'NG');
  await pg.exec('revoke select on public.dl_email_devices from anon; grant execute on function public.dl_email_login(jsonb) to authenticated');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 5).result, 'NG');
  await pg.exec('revoke execute on function public.dl_email_login(jsonb) from authenticated; alter function public.dl_email_notice(text,text,text,text) security definer');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 7).result, 'NG');
  const pg0 = await base();
  const none = await rows(pg0, D('3_確認_読むだけ.sql'));
  assert.ok(none.filter(x => x.result === 'NG').length >= 6, '入れる前は NG：' + JSON.stringify(none));
});

test('止める SQL：関数を外す（表と記録は残す）→ device-login は 503 not_installed → 2 をもう一度で戻る', async () => {
  const pg = await base();
  await pg.exec(D('2_SQL.sql'));
  await pg.exec(`insert into public.dl_email_devices(emp_id, dev_hash, name) values ('E2', repeat('a',64), 'Phone')`);
  const db = { async rpc(name, p) {
    try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
    catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('not found'); x.status = 404; throw x; } throw e; }
  } };
  const handler = createHandler({
    env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k], db,
    fetch: async url => { if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: GM }); throw new Error('unexpected ' + url); },
    pinCheck: async () => ({ ok: false }), signMark: async ({ emp_id }) => 'mark:' + emp_id,
  });
  const ask = () => handler(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer at-1' },
    body: JSON.stringify({ action: 'email_login', emp_id: 'E2', device_id: '7b8da7fb-fb85-4e98-adfc-778d9f7c8ccd', device_name: 'Phone', mode: 'start' }) }));
  const ok1 = await ask(); assert.equal(ok1.status, 200, await ok1.clone().text());
  const r = await rows(pg, D('止める.sql'));
  assert.deepEqual(r[0], { stopped: true, devices_kept: 2 });
  const off = await ask();
  assert.equal(off.status, 503); assert.equal((await off.json()).error, 'not_installed');
  assert.equal((await rows(pg, `select count(*)::int n from public.dl_events where kind like 'email_%'`))[0].n, 1, '記録は残す');
  await pg.exec(D('2_SQL.sql'));
  assert.equal((await ask()).status, 200);
  assert.ok(!(await rows(pg, D('3_確認_読むだけ.sql'))).some(x => x.result === 'NG'));
});
