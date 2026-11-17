// v1185 メールのログイン（段階 2）：本物の SQL（PGlite・v1183 と v1185）と本物の handler。合成データだけ（架空の名前・ID・メール）。本番にはつながない。
// Supabase Auth はトークン → 利用者 ID の代わり、ログインの印は代わりの関数（形は公開しない 1 ファイルで別に確かめる）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG83 = fs.readFileSync(new URL('../supabase/migrations/20261203090000_device_login.sql', import.meta.url), 'utf8');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261205090000_email_login.sql', import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  stranger: '00000000-0000-4000-8000-0000000000c4', sus: '00000000-0000-4000-8000-0000000000c5', former: '00000000-0000-4000-8000-0000000000c6',
  am: '00000000-0000-4000-8000-0000000000c7', nolink: '00000000-0000-4000-8000-0000000000c8', ghost: '00000000-0000-4000-8000-0000000000c9' };
const DEV1 = '11111111-1111-4111-8111-111111111111', DEV2 = '22222222-2222-4222-8222-222222222222';

async function setup(opts = {}) {
  const pg = new PGlite();
  const vt = opts.json ? 'json' : 'jsonb';
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    ${opts.noAppState ? '' : `create table public.app_state(key text primary key, value ${vt}, updated_at timestamptz not null default now());
    grant select, insert, update on public.app_state to service_role;`}
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values
     ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}'),
     ('E5','Former GM','退職','gm','OFFICE','{}'),('E7','Area Sample','在籍','am','OFFICE','{}'),('E8','Stop Sample','在籍','office','OFFICE','{"osDisabled":"true"}');`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['sus', 'suspended', 'E2'], ['former', 'gm', 'E5'], ['am', 'am', 'E7'], ['nolink', 'gm', null], ['ghost', 'office', 'E8']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  if (opts.notifs !== undefined) await pg.query('insert into app_state(key, value, updated_at) values($1, $2, $3)', ['notifications', opts.notifs, '2026-11-16T00:00:00Z']);
  await pg.exec(MIG83);
  await pg.exec(MIG);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const marks = [];
  const signMark = opts.noSign ? null : async ({ emp_id, name, iat, exp }) => { marks.push({ emp_id, name, iat, exp }); return `mark.${emp_id}.${exp}`; };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch, db, pinCheck: async () => ({ ok: false }), signMark });
  const call = async (body, who, extra = {}) => {
    const headers = { 'content-type': 'application/json', 'user-agent': 'TestAgent/1', 'x-forwarded-for': '203.0.113.9', ...extra };
    if (who) headers.authorization = who.startsWith('Bearer ') ? who : 'Bearer tok-' + who;
    const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const login = (who, emp, dev = DEV1, more = {}) => call({ action: 'email_login', emp_id: emp, device_id: dev, device_name: 'iPhone · Safari', ...more }, who);
  const sql = async q => { await pg.exec('reset role'); try { return await pg.query(q); } finally { await pg.exec('set role service_role'); } };
  const notifs = async () => { const r = await sql(`select value::text v, updated_at from app_state where key = 'notifications'`); if (!r.rows[0]) return null; let v = JSON.parse(r.rows[0].v); if (typeof v === 'string') v = JSON.parse(v); return { list: v, at: r.rows[0].updated_at }; };
  return { pg, call, login, sql, marks, notifs };
}

test('GM・CEO・経理 with their own linked email account get the same mark as a PIN login', async () => {
  const { login, marks, sql } = await setup();
  for (const [who, emp, name, role] of [['gm', 'E2', 'GM Sample', 'gm'], ['ceo', 'E1', 'CEO Sample', 'ceo'], ['office', 'E3', 'Office Sample', 'office']]) {
    const r = await login(who, emp);
    assert.equal(r.status, 200, who);
    assert.equal(r.body.ok, true); assert.equal(r.body.emp_id, emp); assert.equal(r.body.name, name); assert.equal(r.body.role, role);
    assert.match(r.body.token, new RegExp('^mark\\.' + emp + '\\.\\d+$'));
    const m = marks[marks.length - 1];
    assert.deepEqual([m.emp_id, m.name], [emp, name], 'the mark is for the linked employee (name from the employee table)');
    assert.equal(m.exp - m.iat, 12 * 3600);
  }
  const ev = await sql(`select kind, emp_id, actor, result, reason, ip, ua from dl_events order by id`);
  assert.equal(ev.rows.length, 3);
  assert.deepEqual([ev.rows[0].kind, ev.rows[0].emp_id, ev.rows[0].result, ev.rows[0].reason], ['email_start', 'E2', 'ok', 'new_device']);
  assert.equal(ev.rows[0].actor, 'mail:' + '00000000-0000-4000-8000-0000000000c2');
  assert.deepEqual([ev.rows[0].ip, ev.rows[0].ua], ['203.0.113.9', 'TestAgent/1']);
});

test('the name the app sends is not trusted: another person, an unlinked account, a stopped account, other roles are refused (no mark)', async () => {
  const { login, marks, sql } = await setup();
  const cases = [['gm', 'E1', 403, 'wrong_person'], ['office', 'E2', 403, 'wrong_person'], ['nolink', 'E2', 403, 'not_linked'], ['sus', 'E2', 403, 'inactive'],
    ['former', 'E5', 403, 'inactive'], ['ghost', 'E8', 403, 'inactive'], ['am', 'E7', 403, 'forbidden'], ['stranger', 'E2', 403, 'forbidden']];
  for (const [who, emp, st, code] of cases) {
    const r = await login(who, emp);
    assert.equal(r.status, st, who); assert.equal(r.body.error, code, who); assert.equal(r.body.token, undefined);
  }
  assert.equal(marks.length, 0, 'no mark for a refused sign-in');
  assert.equal((await sql(`select count(*)::int n from dl_email_devices`)).rows[0].n, 0, 'no device remembered');
  const ev = await sql(`select count(*)::int n from dl_events where result = 'fail'`);
  assert.equal(ev.rows[0].n, cases.length, 'every refusal is in the record');
});

test('without an email sign-in (no token, the public key, a wrong token) it is refused', async () => {
  const { call, login } = await setup();
  const none = await call({ action: 'email_login', emp_id: 'E2', device_id: DEV1 });
  assert.equal(none.status, 401); assert.equal(none.body.error, 'email_required');
  assert.equal((await login('Bearer anon-key', 'E2')).body.error, 'email_required');
  assert.equal((await login('Bearer tok-nobody', 'E2')).body.error, 'email_required');
});

test('bad values are refused before anything is written', async () => {
  const { login, sql } = await setup();
  for (const more of [{ device_id: 'not-a-uuid' }, { emp_id: 'bad id!' }, { device_name: '' }, { device_name: 5 }]) {
    const r = await login('gm', more.emp_id || 'E2', more.device_id || DEV1, more);
    assert.equal(r.status, 400, JSON.stringify(more)); assert.equal(r.body.error, 'bad_value');
  }
  assert.equal((await sql(`select count(*)::int n from dl_email_devices`)).rows[0].n, 0);
});

test('without the mark maker (the public index.ts) nothing is remembered and nobody is told', async () => {
  const { login, sql, notifs } = await setup({ noSign: true });
  const r = await login('gm', 'E2');
  assert.equal(r.status, 503); assert.equal(r.body.error, 'sign_missing');
  assert.equal((await sql(`select count(*)::int n from dl_email_devices`)).rows[0].n, 0);
  assert.equal(await notifs(), null);
});

test('a new device tells the person and the other GM・CEO in the app; the same device again does not', async () => {
  const { login, notifs, sql } = await setup({ notifs: JSON.stringify([{ id: 'old1', title: 'keep me', toRoles: ['gm'], at: '2026-11-15T00:00:00.000Z', readBy: ['GM Sample'] }]) });
  const r = await login('gm', 'E2');
  assert.equal(r.body.new_device, true); assert.equal(r.body.notice, true);
  const n1 = await notifs();
  assert.equal(n1.list.length, 3, 'two notices added, the old one kept');
  assert.deepEqual(n1.list[0], { id: 'old1', title: 'keep me', toRoles: ['gm'], at: '2026-11-15T00:00:00.000Z', readBy: ['GM Sample'] });
  const [me, others] = n1.list.slice(1);
  assert.equal(me.toUser, 'GM Sample'); assert.equal(me.by, 'システム'); assert.equal(me.type, 'login'); assert.match(me.title, /新しい端末でログインしました/);
  assert.match(me.text, /iPhone · Safari/); assert.equal(me.toRoles, undefined);
  assert.deepEqual(others.toRoles, ['ceo', 'gm']); assert.equal(others.by, 'GM Sample', 'shown to the other GM・CEO, not to the person (the app hides what you sent)');
  assert.match(others.title, /GM Sample さん（GM）が新しい端末でログインしました/);
  for (const x of [me, others]) { assert.match(x.id, /^[A-Za-z0-9_:.-]{1,100}$/); assert.match(x.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); assert.deepEqual([x.readBy, x.ackBy], [[], []]); }
  assert.ok(new Date(n1.at) > new Date('2026-11-16T00:00:00Z'), 'updated_at moves forward (other devices notice and writers with an old copy retry)');
  const again = await login('gm', 'E2');
  assert.equal(again.body.new_device, false); assert.equal(again.body.notice, false);
  assert.equal((await notifs()).list.length, 3, 'the same device does not tell again');
  const other = await login('gm', 'E2', DEV2);
  assert.equal(other.body.new_device, true);
  assert.equal((await notifs()).list.length, 5);
  // 経理の人：本人と GM・CEO
  await login('office', 'E3');
  const last = (await notifs()).list.slice(-2);
  assert.equal(last[0].toUser, 'Office Sample'); assert.match(last[1].title, /Office Sample さん（経理）/);
  // 端末の番号そのものは残さない
  const raw = await sql(`select count(*)::int n from dl_email_devices where dev_hash like '%1111%' or position('${DEV1}' in coalesce(name,'')) > 0`);
  assert.equal(raw.rows[0].n, 0);
  const hashes = await sql(`select dev_hash from dl_email_devices`);
  for (const h of hashes.rows) assert.match(h.dev_hash, /^[0-9a-f]{64}$/);
  // 同じ番号でもほかの人の端末は別（同じブラウザで二人が入った）
  await login('ceo', 'E1', DEV1);
  assert.equal((await sql(`select count(*)::int n from dl_email_devices`)).rows[0].n, 4);
});

test('refreshing the mark in the background neither remembers a device nor tells anyone, but is still checked', async () => {
  const { login, notifs, sql, marks } = await setup();
  const r = await login('gm', 'E2', DEV2, { mode: 'refresh' });
  assert.equal(r.status, 200); assert.equal(r.body.new_device, false); assert.ok(r.body.token);
  assert.equal(await notifs(), null);
  assert.equal((await sql(`select count(*)::int n from dl_email_devices`)).rows[0].n, 0);
  assert.equal((await sql(`select kind from dl_events`)).rows[0].kind, 'email_refresh');
  // 止めたら取り替えも断る
  await sql(`update manager_auth set role = 'suspended' where emp_id = 'E2' and role = 'gm'`);
  const s = await login('gm', 'E2', DEV2, { mode: 'refresh' });
  assert.equal(s.body.error, 'inactive'); assert.equal(marks.length, 1);
});

test('the notifications row: a JSON text row is read, a broken row is not overwritten, a missing table does not stop the login, 500 at most', async () => {
  const a = await setup({ notifs: JSON.stringify(JSON.stringify([{ id: 'x1', title: 'text row' }])) });
  assert.equal((await a.login('gm', 'E2')).body.notice, true);
  const al = (await a.notifs()).list;
  assert.equal(al.length, 3); assert.equal(al[0].id, 'x1');
  const b = await setup({ notifs: JSON.stringify({ not: 'an array' }) });
  const rb = await b.login('gm', 'E2');
  assert.equal(rb.status, 200); assert.equal(rb.body.notice, false);
  assert.deepEqual((await b.sql(`select value::jsonb v from app_state where key='notifications'`)).rows[0].v, { not: 'an array' }, 'not overwritten');
  assert.equal((await b.sql(`select reason from dl_events`)).rows[0].reason, 'new_device_notice_failed');
  const c = await setup({ noAppState: true });
  const rc = await c.login('gm', 'E2');
  assert.equal(rc.status, 200); assert.equal(rc.body.notice, false); assert.ok(rc.body.token);
  const many = Array.from({ length: 499 }, (_, i) => ({ id: 'n' + i, title: 't' + i }));
  const d = await setup({ notifs: JSON.stringify(many) });
  await d.login('gm', 'E2');
  const dl = (await d.notifs()).list;
  assert.equal(dl.length, 500); assert.equal(dl[0].id, 'n1', 'the oldest drops'); assert.match(dl[499].id, /-g$/);
  const e = await setup({ json: true, notifs: JSON.stringify([]) });
  assert.equal((await e.login('gm', 'E2')).body.notice, true, 'a json (not jsonb) column works too');
  assert.equal((await e.notifs()).list.length, 2);
});

test('tables and functions are closed to browsers; the SQL runs twice; it stops without the v1183 SQL', async () => {
  const { pg, sql } = await setup();
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const t = await pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name = 'dl_email_devices'`, [role]);
    assert.equal(t.rows[0].n, 0, role);
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_email%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role);
  }
  assert.equal((await pg.query(`select relrowsecurity r from pg_class where relname = 'dl_email_devices'`)).rows[0].r, true);
  const sec = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_email%' and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
  assert.equal(sec.rows[0].n, 0);
  await pg.exec(MIG);
  assert.equal((await sql(`select public.dl_email_stage() s`)).rows[0].s, 1);
  const bare = new PGlite();
  await bare.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(bare.exec(MIG), /STOP: 先に 20261203090000_device_login\.sql/);
  assert.equal((await bare.query(`select to_regclass('public.dl_email_devices') t`)).rows[0].t, null, 'nothing changed');
});

test('a function that has the v1185 code but not the v1185 SQL answers not_installed (the app says to use the PIN), other database failures stay "error"', async () => {
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const fetch = async (url, init) => { if (String(url).endsWith('/auth/v1/user')) return init.headers.authorization === 'Bearer tok-gm' ? Response.json({ id: U.gm }) : new Response('{}', { status: 401 }); throw new Error('net'); };
  const run = async status => {
    const db = { async rpc() { const e = new Error('Could not find the function'); e.status = status; throw e; } };
    const h = createHandler({ env, fetch, db, pinCheck: async () => ({ ok: false }), signMark: async () => 'm' });
    const r = await h(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-gm' }, body: JSON.stringify({ action: 'email_login', emp_id: 'E2', device_id: DEV1 }) }));
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual(await run(404), { status: 503, body: { error: 'not_installed' } });
  assert.deepEqual(await run(500), { status: 500, body: { error: 'error' } });
});
