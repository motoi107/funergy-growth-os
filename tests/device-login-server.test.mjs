// v1183 device-login：本物の SQL（PGlite）と本物の handler。合成データだけ（架空の名前・ID・PIN）。本番にはつながない。
// メールのログインは Supabase Auth の代わり、PIN は auth-pin の代わり、ログインの印は代わりの関数（形は公開しない 1 ファイルで別に確かめる）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, signText } from '../supabase/functions/device-login/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261203090000_device_login.sql', import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  stranger: '00000000-0000-4000-8000-0000000000c4', sus: '00000000-0000-4000-8000-0000000000c5', former: '00000000-0000-4000-8000-0000000000c6' };
const PINS = { 'Aki Test': '24681357', 'Ben Test': '1357', 'Cho Test': '8642', 'Dee Test': '9753' };
const enc = new TextEncoder();
const b64u = buf => Buffer.from(buf).toString('base64url');

async function newKey() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', k.publicKey);
  return { priv: k.privateKey, pub: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } };
}

async function setup(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values
     ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}'),
     ('S1','Aki Test','在籍','crew','F01','{}'),('S2','Ben Test','在籍','sl','F02','{}'),('S3','Cho Test','在籍','crew','F01','{"osDisabled":"false"}'),
     ('S9','Gone Test','退職','crew','F01','{}'),('S4','Dee Test','在籍','office','OFFICE','{}'),('S8','Top Test','在籍','crew','F01','{"role":"gm"}'),('E5','Former GM','退職','gm','OFFICE','{}');`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['sus', 'suspended', 'E2'], ['former', 'gm', 'E5']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(MIG);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const pinCalls = [], marks = [];
  const state = { locked: false, server: false };
  const pinCheck = async (name, emp, pin) => {
    pinCalls.push({ name, emp });
    if (state.server) return { ok: false, server: true };
    if (state.locked) return { ok: false, locked: 600 };
    if (pin === '0000') return { ok: true, mark: false };   // 初期の PIN：auth-pin は ok でも印を出さない
    return PINS[name] === pin ? { ok: true, mark: true } : { ok: false };
  };
  const signMark = opts.noSign ? null : async ({ emp_id, name, iat, exp }) => { marks.push({ emp_id, name, iat, exp }); return `mark.${emp_id}.${exp}`; };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch, db, pinCheck, signMark });
  const call = async (body, who, origin) => {
    const headers = { 'content-type': 'application/json', 'user-agent': 'TestAgent/1', 'x-forwarded-for': '203.0.113.9' };
    if (who) headers.authorization = 'Bearer tok-' + who;
    if (origin) headers.origin = origin;
    const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  // 端末の操作：確かめの値 → 署名 → 操作
  const dev = async (d, act, body, signAct) => {
    const c = await call({ action: 'challenge', device_id: d.id });
    if (c.status !== 200) return c;
    const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, d.priv, enc.encode(signText(c.body.chal_id, c.body.nonce, signAct || act))));
    return call({ chal_id: c.body.chal_id, sig, ...body });
  };
  const sql = async q => { await pg.exec('reset role'); try { return await pg.query(q); } finally { await pg.exec('set role service_role'); } };
  // 試す人に足して招待し、登録する
  const register = async (emp, name, pin, extra = {}) => {
    await call({ action: 'admin_trial', emp_id: emp, on: true }, 'gm');
    const inv = await call({ action: 'admin_invite', emp_id: emp }, 'gm');
    const k = await newKey();
    const r = await call({ action: 'invite_complete', token: inv.body.token, pin: pin || PINS[name], pubkey: k.pub, device_name: 'Phone', ...extra });
    return { id: r.body.device_id, priv: k.priv, res: r, token: inv.body.token };
  };
  return { pg, db, call, dev, sql, register, pinCalls, marks, state };
}

test('tables and functions are closed to browsers; only the service role reaches them', async () => {
  const { pg } = await setup();
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const t = await pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name like 'dl\\_%'`, [role]);
    assert.equal(t.rows[0].n, 0, role + ' has no table grants');
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role + ' cannot run dl_ functions');
  }
  const rls = await pg.query(`select count(*)::int n from pg_class where relname in ('dl_trial','dl_invites','dl_devices','dl_challenges','dl_events') and relrowsecurity`);
  assert.equal(rls.rows[0].n, 5);
  const sec = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_%' and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
  assert.equal(sec.rows[0].n, 0, 'security invoker with a fixed search_path');
  await pg.exec(MIG);   // 2 回流しても同じ
  const again = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_%' and has_function_privilege('anon', p.oid, 'execute')`);
  assert.equal(again.rows[0].n, 0);
});

test('only a GM / CEO email sign-in manages the trial; others are refused', async () => {
  const { call } = await setup();
  const none = await call({ action: 'admin_list' });
  assert.equal(none.status, 401); assert.equal(none.body.error, 'email_required');
  for (const who of ['stranger', 'office', 'sus', 'former']) assert.equal((await call({ action: 'admin_list' }, who)).status, 403, who);
  assert.equal((await call({ action: 'admin_list' }, 'ceo')).status, 200);
  const l = await call({ action: 'admin_list' }, 'gm');
  assert.equal(l.status, 200); assert.deepEqual(l.body.members, []); assert.equal(l.body.me.role, 'gm');
  // GM・CEO の人・退職した人は試せない
  assert.equal((await call({ action: 'admin_trial', emp_id: 'E2', on: true }, 'gm')).body.error, 'top_not_allowed');
  assert.equal((await call({ action: 'admin_trial', emp_id: 'S8', on: true }, 'gm')).body.error, 'top_not_allowed', 'role in data');
  assert.equal((await call({ action: 'admin_trial', emp_id: 'S9', on: true }, 'gm')).body.error, 'inactive');
  assert.equal((await call({ action: 'admin_trial', emp_id: 'NOPE', on: true }, 'gm')).status, 404);
  const t = await call({ action: 'admin_trial', emp_id: 'S1', on: true }, 'gm');
  assert.equal(t.status, 200); assert.equal(t.body.member.state, 'none'); assert.equal(t.body.member.name, 'Aki Test');
  assert.equal((await call({ action: 'admin_invite', emp_id: 'S2' }, 'gm')).body.error, 'not_trial', 'invite only for trial members');
});

test('an invite: 48 hours, only its hash is kept, reissuing revokes the earlier one, peeking does not use it', async () => {
  const { call, sql } = await setup();
  await call({ action: 'admin_trial', emp_id: 'S1', on: true }, 'gm');
  const a = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  assert.equal(a.status, 200); assert.match(a.body.token, /^[A-Za-z0-9_-]{43}$/);
  const hours = (new Date(a.body.expires_at) - Date.now()) / 3600000;
  assert.ok(hours > 47.9 && hours <= 48.01, 'expires in 48 hours');
  const raw = await sql(`select count(*)::int n from dl_invites where token_hash = '${a.body.token}' or position('${a.body.token}' in coalesce(revoke_reason,'')) > 0`);
  assert.equal(raw.rows[0].n, 0, 'the URL value itself is not stored');
  const p1 = await call({ action: 'invite_peek', token: a.body.token });
  assert.deepEqual([p1.body.state, p1.body.name], ['ok', 'Aki Test']);
  assert.equal(p1.body.emp_id, undefined, 'the employee id is not shown');
  assert.equal((await call({ action: 'invite_peek', token: a.body.token })).body.state, 'ok', 'peeking twice does not use it');
  const b = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  assert.equal((await call({ action: 'invite_peek', token: a.body.token })).body.state, 'revoked', 'reissued');
  assert.equal((await call({ action: 'invite_peek', token: b.body.token })).body.state, 'ok');
  assert.equal((await call({ action: 'invite_peek', token: 'x'.repeat(43) })).body.state, 'unknown');
  assert.equal((await call({ action: 'invite_peek', token: 'short' })).body.error, 'invite_gone');
  await sql(`update dl_invites set expires_at = now() - interval '1 minute' where revoked_at is null`);
  assert.equal((await call({ action: 'invite_peek', token: b.body.token })).body.state, 'expired');
  const k = await newKey();
  const c = await call({ action: 'invite_complete', token: b.body.token, pin: '24681357', pubkey: k.pub, device_name: 'Phone' });
  assert.equal(c.status, 410); assert.equal(c.body.state, 'expired');
  const rv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  assert.equal((await call({ action: 'admin_invite_revoke', emp_id: 'S1' }, 'gm')).body.revoked, 1);
  assert.equal((await call({ action: 'invite_peek', token: rv.body.token })).body.state, 'revoked');
});

test('registering: the person\'s own PIN (by the server), 5 wrong PINs revoke the invite, used only once, the mark comes from the database', async () => {
  const { call, pinCalls, marks, state } = await setup();
  await call({ action: 'admin_trial', emp_id: 'S1', on: true }, 'gm');
  const inv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const k = await newKey();
  const body = { action: 'invite_complete', token: inv.body.token, pubkey: k.pub, device_name: 'Phone', emp_id: 'E2', name: 'GM Sample' };
  for (let i = 1; i <= 4; i++) {
    const r = await call({ ...body, pin: '0001' });
    assert.equal(r.status, 401); assert.equal(r.body.error, 'pin_wrong'); assert.equal(r.body.left, 5 - i);
  }
  assert.deepEqual(pinCalls[0], { name: 'Aki Test', emp: 'S1' }, 'the PIN is checked for the invited person, not what the app sends');
  state.locked = true;
  const lk = await call({ ...body, pin: '24681357' });
  assert.equal(lk.status, 423); assert.equal(lk.body.retry_after, 600);
  state.locked = false; state.server = true;
  assert.equal((await call({ ...body, pin: '24681357' })).status, 503, 'auth-pin unreachable is not "wrong"');
  state.server = false;
  const fifth = await call({ ...body, pin: '1111' });
  assert.equal(fifth.body.left, 0);
  assert.equal((await call({ action: 'invite_peek', token: inv.body.token })).body.state, 'revoked', '5 wrong PINs');
  const inv2 = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const ok = await call({ ...body, token: inv2.body.token, pin: '24681357' });
  assert.equal(ok.status, 200); assert.match(ok.body.device_id, /^[0-9a-f-]{36}$/);
  assert.equal(ok.body.emp_id, 'S1'); assert.equal(ok.body.name, 'Aki Test');
  assert.equal(ok.body.token, `mark.S1.${marks[0].exp}`); assert.equal(marks[0].exp - marks[0].iat, 12 * 3600);
  const again = await call({ ...body, token: inv2.body.token, pin: '24681357' });
  assert.equal(again.status, 410, 'used only once');
  const l = await call({ action: 'admin_list' }, 'gm');
  assert.equal(l.body.members[0].state, 'registered'); assert.equal(l.body.members[0].devices, 1);
  // 公開鍵は EC P-256 の 4 つの欄だけ（秘密の d は受けない）
  const inv3 = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const jwk = (await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).privateKey));
  assert.equal((await call({ ...body, token: inv3.body.token, pin: '24681357', pubkey: jwk })).status, 400);
  assert.equal((await call({ action: 'invite_peek', token: inv3.body.token })).body.state, 'ok', 'a refused request does not use the invite');
});

test('without the mark maker (the public index.ts) nothing is used up', async () => {
  const { call } = await setup({ noSign: true });
  await call({ action: 'admin_trial', emp_id: 'S1', on: true }, 'gm');
  const inv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const k = await newKey();
  const r = await call({ action: 'invite_complete', token: inv.body.token, pin: '24681357', pubkey: k.pub, device_name: 'Phone' });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'sign_missing');
  assert.equal((await call({ action: 'invite_peek', token: inv.body.token })).body.state, 'ok');
});

test('opening on the device: a signed one-time challenge, no PIN; background refresh does not count as opening', async () => {
  const { call, dev, sql, register, pinCalls } = await setup();
  const d = await register('S1', 'Aki Test');
  const n0 = pinCalls.length;
  await sql(`update dl_devices set last_used_at = now() - interval '5 days'`);
  const s = await dev(d, 'start', { action: 'start' });
  assert.equal(s.status, 200); assert.equal(s.body.emp_id, 'S1'); assert.match(s.body.token, /^mark\.S1\./);
  assert.equal(pinCalls.length, n0, 'no PIN');
  const used = await sql(`select extract(epoch from now() - last_used_at)::int s from dl_devices`);
  assert.ok(used.rows[0].s < 5, 'opening moves the last use');
  await sql(`update dl_devices set last_used_at = now() - interval '5 days'`);
  const r = await dev(d, 'start', { action: 'start', mode: 'refresh' }, 'refresh');
  assert.equal(r.status, 200);
  const still = await sql(`select extract(day from now() - last_used_at)::int d from dl_devices`);
  assert.equal(still.rows[0].d, 5, 'a background refresh is not "opened"');
  // ほかの鍵の署名・使った値・ほかの操作の署名・2 分を過ぎた値
  const other = await newKey();
  const bad = await dev({ id: d.id, priv: other.priv }, 'start', { action: 'start' });
  assert.equal(bad.status, 401); assert.equal(bad.body.error, 'bad_signature');
  const ev = await sql(`select count(*)::int n from dl_events where result = 'bad_signature' and actor = 'unknown'`);
  assert.equal(ev.rows[0].n, 1, 'recorded as an unknown actor');
  const c = await call({ action: 'challenge', device_id: d.id });
  const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, d.priv, new TextEncoder().encode(signText(c.body.chal_id, c.body.nonce, 'start')))).toString('base64url');
  assert.equal((await call({ action: 'start', chal_id: c.body.chal_id, sig })).status, 200);
  assert.equal((await call({ action: 'start', chal_id: c.body.chal_id, sig })).body.error, 'challenge_gone', 'used once');
  assert.equal((await dev(d, 'logout', { action: 'logout', scope: 'all' }, 'start')).body.error, 'bad_signature', 'a "start" signature cannot log out');
  const c2 = await call({ action: 'challenge', device_id: d.id });
  await sql(`update dl_challenges set created_at = now() - interval '3 minutes' where id = '${c2.body.chal_id}'`);
  const sig2 = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, d.priv, new TextEncoder().encode(signText(c2.body.chal_id, c2.body.nonce, 'start')))).toString('base64url');
  assert.equal((await call({ action: 'start', chal_id: c2.body.chal_id, sig: sig2 })).body.error, 'challenge_gone', '2 minutes');
  assert.equal((await call({ action: 'challenge', device_id: '00000000-0000-4000-8000-000000000999' })).body.error, 'device_gone');
  await sql(`insert into dl_challenges (device_id, nonce) select '${d.id}', 'n' from generate_series(1, 30)`);
  assert.equal((await call({ action: 'challenge', device_id: d.id })).status, 429, 'too many challenges');
});

test('30 days unopened, logging out, "ask every time" → the person\'s PIN; 90 days → register again', async () => {
  const { dev, sql, register, state } = await setup();
  const d = await register('S1', 'Aki Test');
  await sql(`update dl_devices set last_used_at = now() - interval '31 days'`);
  const s = await dev(d, 'start', { action: 'start' });
  assert.equal(s.status, 401); assert.equal(s.body.error, 'reauth'); assert.equal(s.body.name, 'Aki Test');
  assert.equal((await dev(d, 'start', { action: 'start', mode: 'refresh' }, 'refresh')).body.error, 'reauth', 'refresh too');
  assert.equal((await dev(d, 'reauth', { action: 'reauth', pin: '9999' })).body.error, 'pin_wrong');
  state.locked = true;
  assert.equal((await dev(d, 'reauth', { action: 'reauth', pin: '24681357' })).status, 423);
  state.locked = false;
  const ok = await dev(d, 'reauth', { action: 'reauth', pin: '24681357' });
  assert.equal(ok.status, 200); assert.match(ok.body.token, /^mark\.S1\./);
  assert.equal((await dev(d, 'start', { action: 'start' })).status, 200);
  assert.equal((await dev(d, 'logout', { action: 'logout', scope: 'this' }, 'logout_this')).body.ok, true);
  assert.equal((await dev(d, 'start', { action: 'start' })).body.error, 'reauth', 'logged out → PIN next time');
  await dev(d, 'reauth', { action: 'reauth', pin: '24681357' });
  assert.equal((await dev(d, 'setting', { action: 'setting', ask_pin: true }, 'setting:ask_pin')).body.ask_pin, true);
  assert.equal((await dev(d, 'start', { action: 'start' })).body.error, 'reauth', 'asks every time');
  await dev(d, 'reauth', { action: 'reauth', pin: '24681357' });
  assert.equal((await dev(d, 'start', { action: 'start' })).body.error, 'reauth', 'still asks');
  assert.equal((await dev(d, 'start', { action: 'start', mode: 'refresh' }, 'refresh')).status, 200, 'refreshing an open session does not ask');
  assert.equal((await dev(d, 'setting', { action: 'setting', ask_pin: false }, 'setting:ask_pin')).body.error, 'bad_signature', 'the setting is in the signature');
  await dev(d, 'setting', { action: 'setting', ask_pin: false }, 'setting:no_pin');
  assert.equal((await dev(d, 'start', { action: 'start' })).status, 200);
  await sql(`update dl_devices set expires_at = now() - interval '1 minute'`);
  const ex = await dev(d, 'start', { action: 'start' });
  assert.equal(ex.status, 410); assert.equal(ex.body.error, 'device_expired');
  assert.equal((await dev(d, 'reauth', { action: 'reauth', pin: '24681357' })).body.error, 'device_expired', 'a PIN does not extend 90 days');
});

test('several devices; "log out of every device"; 5 at most and the 6th chooses which to remove', async () => {
  const { call, dev, register } = await setup();
  const a = await register('S1', 'Aki Test');
  const more = [];
  for (let i = 0; i < 4; i++) {
    const inv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
    const k = await newKey();
    const r = await call({ action: 'invite_complete', token: inv.body.token, pin: '24681357', pubkey: k.pub, device_name: 'PC ' + i });
    assert.equal(r.status, 200); more.push({ id: r.body.device_id, priv: k.priv });
  }
  // スマホと PC 2 台を同時に（ほかの端末を勝手にログアウトさせない）
  for (const d of [a, more[0], more[1]]) assert.equal((await dev(d, 'start', { action: 'start' })).status, 200);
  const inv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const k6 = await newKey();
  const six = { action: 'invite_complete', token: inv.body.token, pin: '24681357', pubkey: k6.pub, device_name: 'Sixth' };
  const r6 = await call(six);
  assert.equal(r6.status, 200); assert.equal(r6.body.need_replace, true); assert.equal(r6.body.devices.length, 5);
  assert.equal((await call({ action: 'invite_peek', token: inv.body.token })).body.state, 'ok', 'nothing used until a device is chosen');
  for (const d of [a, ...more]) assert.equal((await dev(d, 'start', { action: 'start' })).status, 200, 'nothing removed by itself');
  // ほかの人の端末は選べない
  const b = await register('S2', 'Ben Test');
  assert.equal((await call({ ...six, replace: [b.id] })).status, 400);
  const ok = await call({ ...six, replace: [more[3].id] });
  assert.equal(ok.status, 200); assert.ok(ok.body.device_id);
  assert.equal((await dev(more[3], 'start', { action: 'start' })).body.error, 'device_revoked');
  assert.equal((await dev(b, 'start', { action: 'start' })).status, 200, 'the other person is untouched');
  // すべての端末からログアウト（ほかの人は変わらない）
  await dev(a, 'logout', { action: 'logout', scope: 'all' }, 'logout_all');
  for (const d of [a, more[0], more[1], more[2], { id: ok.body.device_id, priv: k6.priv }]) assert.equal((await dev(d, 'start', { action: 'start' })).body.error, 'reauth');
  assert.equal((await dev(b, 'start', { action: 'start' })).status, 200);
});

test('the device list and removing: only the same person\'s devices; GM / CEO can remove; leaving the trial or resigning stops the devices', async () => {
  const { call, dev, sql, register } = await setup();
  const a = await register('S1', 'Aki Test');
  const inv = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const k = await newKey();
  const a2 = { id: (await call({ action: 'invite_complete', token: inv.body.token, pin: '24681357', pubkey: k.pub, device_name: 'Laptop <b>' })).body.device_id, priv: k.priv };
  const b = await register('S2', 'Ben Test');
  const l = await dev(a, 'devices', { action: 'devices' });
  assert.equal(l.status, 200); assert.equal(l.body.devices.length, 2);
  assert.deepEqual(l.body.devices.map(x => x.this).sort(), [false, true]);
  assert.ok(l.body.devices.every(x => !('pubkey' in x)), 'no keys in the list');
  assert.ok(l.body.devices.some(x => x.name === 'Laptop b'), 'markup is dropped from the device name');
  assert.equal((await dev(a, 'device_revoke', { action: 'device_revoke', target: b.id }, 'revoke:' + b.id)).status, 404, 'not another person\'s device');
  assert.equal((await dev(a, 'device_revoke', { action: 'device_revoke', target: a2.id }, 'revoke:' + b.id)).body.error, 'bad_signature', 'the target is in the signature');
  assert.equal((await dev(a, 'device_revoke', { action: 'device_revoke', target: a2.id }, 'revoke:' + a2.id)).status, 200);
  assert.equal((await dev(a2, 'start', { action: 'start' })).body.error, 'device_revoked');
  assert.equal((await dev(a2, 'devices', { action: 'devices' })).body.error, 'device_revoked', 'a removed device cannot list');
  const ad = await call({ action: 'admin_devices', emp_id: 'S2' }, 'gm');
  assert.equal(ad.body.devices.length, 1);
  assert.equal((await call({ action: 'admin_device_revoke', emp_id: 'S2', device_id: b.id }, 'ceo')).body.revoked, 1);
  assert.equal((await dev(b, 'start', { action: 'start' })).body.error, 'device_revoked');
  assert.equal((await call({ action: 'admin_device_revoke', emp_id: 'S2', device_id: b.id }, 'ceo')).status, 404);
  // 退職 → 止まる・在籍に戻すと戻る
  await sql(`update employees set status = '退職' where id = 'S1'`);
  assert.equal((await dev(a, 'start', { action: 'start' })).body.error, 'inactive');
  await sql(`update employees set status = '在籍' where id = 'S1'`);
  assert.equal((await dev(a, 'start', { action: 'start' })).status, 200);
  await sql(`update employees set data = '{"osDisabled":"true"}' where id = 'S1'`);
  assert.equal((await dev(a, 'start', { action: 'start' })).body.error, 'inactive', 'OS disabled');
  await sql(`update employees set data = '{}' where id = 'S1'`);
  // 試しから外す → 端末も招待も止まる
  const pending = await call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  await call({ action: 'admin_trial', emp_id: 'S1', on: false }, 'gm');
  assert.equal((await dev(a, 'start', { action: 'start' })).body.error, 'device_revoked');
  assert.equal((await call({ action: 'invite_peek', token: pending.body.token })).body.state, 'revoked');
  const list = await call({ action: 'admin_list' }, 'gm');
  assert.deepEqual(list.body.members.map(m => m.emp_id), ['S2'], 'S1 left the trial; S2 stays');
});

test('the record: what happened, no PIN / URL value / mark; 180 days; unauthenticated tries are "unknown"', async () => {
  const { call, dev, sql, register } = await setup();
  const d = await register('S1', 'Aki Test');
  await dev(d, 'start', { action: 'start' });
  await dev(d, 'reauth', { action: 'reauth', pin: '77771111' });
  const rows = (await sql(`select kind, actor, result, ip, ua, coalesce(reason,'') reason from dl_events order by id`)).rows;
  const kinds = rows.map(r => r.kind);
  for (const k of ['trial_on', 'invite', 'register', 'start', 'reauth_pin']) assert.ok(kinds.includes(k), k);
  assert.ok(rows.every(r => r.ip === '203.0.113.9' && r.ua === 'TestAgent/1' || r.kind === 'trial_on' || r.kind === 'invite'));
  const all = JSON.stringify((await sql('select * from dl_events')).rows) + JSON.stringify((await sql('select * from dl_invites')).rows) + JSON.stringify((await sql('select id, emp_id, name from dl_devices')).rows);
  for (const secret of ['24681357', '77771111', d.token, 'mark.S1']) assert.ok(!all.includes(secret), 'no ' + secret);
  await sql(`insert into dl_events (at, kind, actor, result) values (now() - interval '181 days', 'old', 'unknown', 'ok'), (now() - interval '179 days', 'keep', 'unknown', 'ok')`);
  await call({ action: 'admin_list' }, 'gm');
  const left = (await sql(`select kind from dl_events where kind in ('old','keep')`)).rows.map(r => r.kind);
  assert.deepEqual(left, ['keep']);
});

test('requests from another site are refused; the preflight answers; unknown actions are refused', async () => {
  const { call } = await setup();
  assert.equal((await call({ action: 'admin_list' }, 'gm', 'https://evil.example')).status, 403);
  assert.equal((await call({ action: 'admin_list' }, 'gm', 'https://funergy-plus.com')).status, 200);
  assert.equal((await call({ action: 'nope' })).status, 400);
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, db: { rpc: async () => ({}) }, signMark: null });
  assert.equal((await h(new Request('https://fn.test/device-login', { method: 'OPTIONS', headers: { origin: 'https://funergy-plus.com' } }))).status, 204);
  assert.equal((await h(new Request('https://fn.test/device-login', { method: 'GET' }))).status, 405);
});

test('the initial PIN does not register or re-check; office staff give the PIN every time they open', async () => {
  const { call, dev, register } = await setup();
  await call({ action: 'admin_trial', emp_id: 'S3', on: true }, 'gm');
  const inv = await call({ action: 'admin_invite', emp_id: 'S3' }, 'gm');
  const k = await newKey();
  const r = await call({ action: 'invite_complete', token: inv.body.token, pin: '0000', pubkey: k.pub, device_name: 'Phone' });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'pin_default');
  assert.equal((await call({ action: 'invite_peek', token: inv.body.token })).body.state, 'ok', 'not used, not counted as wrong');
  const d = await register('S4', 'Dee Test');
  assert.equal(d.res.status, 200);
  const s = await dev(d, 'start', { action: 'start' });
  assert.equal(s.body.error, 'reauth', 'office: PIN when opening');
  assert.equal((await dev(d, 'reauth', { action: 'reauth', pin: '0000' })).body.error, 'pin_default');
  const ok = await dev(d, 'reauth', { action: 'reauth', pin: '9753' });
  assert.equal(ok.status, 200); assert.equal(ok.body.pin_always, true);
  assert.equal((await dev(d, 'start', { action: 'start', mode: 'refresh' }, 'refresh')).status, 200, 'refreshing does not ask');
  assert.equal((await dev(d, 'start', { action: 'start' })).body.error, 'reauth', 'next opening asks again');
});

test('the database itself uses an invite only once (two registrations that both passed the first look)', async () => {
  const { db, call } = await setup();
  await call({ action: 'admin_trial', emp_id: 'S2', on: true }, 'gm');
  const inv = await call({ action: 'admin_invite', emp_id: 'S2' }, 'gm');
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(inv.body.token)))).map(x => x.toString(16).padStart(2, '0')).join('');
  assert.equal((await db.rpc('dl_invite_get', { token_hash: h })).state, 'ok', 'both requests see a usable invite');
  const a = await newKey(), b = await newKey();
  const first = await db.rpc('dl_invite_use', { token_hash: h, pubkey: a.pub, name: 'Phone A' });
  assert.equal(first.ok, true);
  await assert.rejects(db.rpc('dl_invite_use', { token_hash: h, pubkey: b.pub, name: 'Phone B' }), /invite_gone/);
  const l = await call({ action: 'admin_list' }, 'gm');
  assert.equal(l.body.members.find(m => m.emp_id === 'S2').devices, 1);
});
