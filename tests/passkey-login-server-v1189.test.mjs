// v1189 パスキーのログイン（UI案92・Moto さん 11/17 12:38 HST）：本物の SQL（PGlite・v1183〜v1189）と本物の handler。
// Supabase Auth（利用者・パスキー）と Google（トークン・送信）は偽物。合成データだけ（架空の名前・ID・メール）。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const R = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIGS = ['20261203090000_device_login.sql', '20261205090000_email_login.sql', '20261206090000_top_pin_off.sql', '20261207090000_pin_blocked_id_first.sql'].map(R);
const MIG89 = R('20261208090000_passkey_login.sql');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const FROM = 'sender@example.test';   // 送り手（本物は 4_送り手_SQL.sql で Moto さんが入れる。リポジトリには書かない）
const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const b64uDec = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function readMail(raw) {
  const t = b64uDec(raw).toString('utf8');
  const [head, body] = t.split('\r\n\r\n');
  const h = Object.fromEntries(head.replace(/\r\n[ \t]/g, ' ').split('\r\n').map(l => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  const dec = v => String(v || '').replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  return { to: h.to, from: h.from, subject: dec(h.subject), text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

async function setup(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    grant select, insert, update on public.app_state to service_role;
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values
     ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}'),
     ('E9','Crew Nine','在籍','crew','F01','{}'),('E10','Crew Ten','在籍','crew','F02','{}'),('E11','Crew Nine','在籍','crew','F03','{}'),
     ('E12','Left Crew','退職','crew','F01','{}');`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], r, e]);
  for (const m of MIGS) await pg.exec(m);
  // v1183 の試し（やめる前）：試す人・招待・端末が 1 つずつ
  await pg.exec(`insert into public.dl_trial(emp_id, added_by) values ('E9', 'admin:x');
    insert into public.dl_invites(emp_id, token_hash, created_by, expires_at) values ('E9', repeat('a', 64), 'admin:x', now() + interval '1 day');
    insert into public.dl_devices(emp_id, pubkey, name, expires_at) values ('E9', '{}', 'Old phone', now() + interval '90 days');`);
  let stop = null;
  if (!opts.no89) { try { await pg.exec(MIG89); } catch (e) { stop = e; } }
  if (opts.from !== false && !stop) await pg.query('update public.dl_mail set from_addr = $1 where id = 1', [FROM]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) {
    try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
    catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
  } };
  // 偽の Supabase Auth：管理者 3 人（メールとパスワード・この道の利用者ではない）＋この道が作る利用者
  const S = { users: new Map(), tokens: new Map(), keys: new Map(), deleted: [], links: 0, failDelete: false, failCreate: false };
  const addUser = (id, email, meta) => { S.users.set(id, { id, email, app_metadata: meta || {} }); S.tokens.set('tok-' + id, id); };
  addUser(U.ceo, 'ceo@example.test'); addUser(U.gm, 'gm@example.test'); addUser(U.office, 'office@example.test');
  for (const [k, v] of Object.entries(U)) S.tokens.set('tok-' + k, v);
  let seq = 0;
  // 偽の Google：トークン・アカウント・送信
  const G = { account: FROM, sent: [], refreshFail: false, sendFail: false, codeScope: 'openid email https://www.googleapis.com/auth/gmail.send' };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase(), body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    calls.push({ u, m });
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    if (u === 'https://db.test/auth/v1/user') { const id = S.tokens.get(auth.replace('Bearer ', '')); return id && S.users.has(id) ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    if (u.startsWith('https://db.test/auth/v1/admin/') || u === 'https://db.test/auth/v1/verify') assert.ok(u === 'https://db.test/auth/v1/verify' || auth === 'Bearer service', 'admin calls use the server key');
    if (u === 'https://db.test/auth/v1/admin/users' && m === 'POST') {
      if (S.failCreate) return new Response('{"msg":"boom"}', { status: 500 });
      if ([...S.users.values()].some(x => x.email === body.email)) return Response.json({ error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, { status: 422 });
      const id = '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
      addUser(id, body.email, body.app_metadata); return Response.json(S.users.get(id));
    }
    if (u === 'https://db.test/auth/v1/admin/generate_link') {
      const x = [...S.users.values()].find(v => v.email === body.email); if (!x) return new Response('{}', { status: 404 });
      S.links++; const th = 'th-' + x.id + '-' + S.links; S.tokens.set(th, x.id);
      return Response.json({ ...x, hashed_token: th, verification_type: 'magiclink' });
    }
    if (u === 'https://db.test/auth/v1/verify') {
      const id = S.tokens.get(body.token_hash); if (!id || !S.users.has(id)) return new Response('{}', { status: 403 });
      S.tokens.delete(body.token_hash); const at = 'sb-' + id + '-' + (++seq); S.tokens.set(at, id);
      return Response.json({ access_token: at, refresh_token: 'r', expires_in: 3600 });
    }
    let mm = u.match(/^https:\/\/db\.test\/auth\/v1\/admin\/users\/([0-9a-f-]{36})(\/passkeys(?:\/([0-9a-f-]{36}))?)?$/);
    if (mm) {
      const [, id, pk, pid] = mm, x = S.users.get(id);
      if (!pk && m === 'GET') return x ? Response.json(x) : new Response('{}', { status: 404 });
      if (!pk && m === 'DELETE') { if (S.failDelete) return new Response('{}', { status: 500 }); S.users.delete(id); S.deleted.push(id); S.keys.delete(id); return Response.json({}); }
      if (pk && m === 'GET') return Response.json(S.keys.get(id) || []);
      if (pk && m === 'DELETE') { S.keys.set(id, (S.keys.get(id) || []).filter(k => k.id !== pid)); return Response.json({}); }
    }
    if (u === 'https://oauth2.googleapis.com/token') {
      const q = new URLSearchParams(String(body));
      if (q.get('grant_type') === 'authorization_code') return q.get('code') === 'good' ? Response.json({ refresh_token: 'g-refresh', access_token: 'g-access', scope: G.codeScope }) : new Response('{"error":"invalid_grant"}', { status: 400 });
      if (G.refreshFail) return new Response('{"error":"invalid_grant"}', { status: 400 });
      return q.get('refresh_token') === 'g-refresh' ? Response.json({ access_token: 'g-access2' }) : new Response('{"error":"invalid_grant"}', { status: 400 });
    }
    if (u === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ email: G.account, email_verified: true });
    if (u === SEND) { if (G.sendFail) return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }); G.sent.push(readMail(body.raw)); return Response.json({ id: 'm' + G.sent.length }); }
    throw new Error('unexpected network call ' + u);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key', GMAIL_OAUTH_CLIENT_ID: 'cid', GMAIL_OAUTH_CLIENT_SECRET: 'csec' })[k];
  const handler = createHandler({ env, fetch, db, pinCheck: async () => ({ ok: false }), signMark: async ({ emp_id }) => 'mark.' + emp_id });
  const call = async (body, who) => {
    const headers = { 'content-type': 'application/json', origin: 'https://funergy-plus.com' };
    if (who) headers.authorization = 'Bearer ' + (who.startsWith('tok-') || who.startsWith('sb-') ? who : 'tok-' + who);
    const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const get = async q => handler(new Request('https://db.test/functions/v1/device-login?' + q, { method: 'GET' }));
  const sql = async (q, a) => { await pg.exec('reset role'); try { return await pg.query(q, a); } finally { await pg.exec('set role service_role'); } };
  const rpc = (n, p) => db.rpc(n, p);
  // GM が送り手をつなぐ（Google のページは開いたことにする）
  const connectMail = async () => {
    const r = await call({ action: 'pk_mail_connect' }, 'gm');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const st = new URL(r.body.url).searchParams.get('state');
    const back = await get('state=' + encodeURIComponent(st) + '&code=good');
    return { url: r.body.url, location: back.headers.get('location') };
  };
  const lastMailTo = to => [...G.sent].reverse().find(x => x.to === to);
  const tokenOf = mail => (mail.text.match(/[?&]pk=([A-Za-z0-9_-]{43})/) || [])[1];
  const codeOf = mail => (mail.text.match(/コード：(\d{6})/) || [])[1];
  // 1 分あける（コードの送り直しの間）：コードの時刻を前にずらす
  const ago = async emp => sql(`update public.dl_pk_codes set created_at = created_at - interval '2 minutes' where emp_id = $1`, [emp]);
  return { pg, call, get, sql, rpc, stop, S, G, calls, connectMail, lastMailTo, tokenOf, codeOf, ago };
}

// 招待 → コード → ログイン（本人の端末ならパスキー用の Supabase のログインも）
async function enroll(w, emp, email, { keep = true, passkey = true } = {}) {
  const set = await w.call({ action: 'pk_admin_set', emp_id: emp, email, told: true }, 'gm');
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const token = w.tokenOf(w.lastMailTo(email));
  assert.ok(token, 'the invite mail carries the link');
  assert.equal((await w.call({ action: 'pk_code_send', token })).body.state, 'sent');
  const code = w.codeOf(w.lastMailTo(email));
  const v = await w.call({ action: 'pk_code_verify', token, code, keep, passkey, device_name: 'Phone' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { token, v: v.body };
}

test('先に止まる：v1186（20261207）がまだなら何も変えない', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());`);
  await pg.exec(MIGS[0]); await pg.exec(MIGS[1]);
  await assert.rejects(() => pg.exec(MIG89), /^error: STOP: 先に v1183・v1185・v1186/);
  assert.equal((await pg.query(`select to_regclass('public.dl_people') r`)).rows[0].r, null);
});

test('表と関数はサーバーの鍵だけ・2 回流しても同じ・試しはやめた（招待・端末を止める・試す人を消す）', async () => {
  const w = await setup();
  assert.equal(w.stop, null, String(w.stop));
  for (const t of ['dl_people', 'dl_pk_invites', 'dl_pk_codes', 'dl_pk_sessions', 'dl_mail']) {
    for (const r of ['anon', 'authenticated']) assert.equal((await w.sql(`select has_table_privilege($1, $2, 'select') v`, [r, 'public.' + t])).rows[0].v, false, r + ' ' + t);
  }
  const fns = (await w.sql(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'dl\\_pk%'`)).rows;
  assert.ok(fns.length >= 30);
  for (const { f } of fns) for (const r of ['anon', 'authenticated']) assert.equal((await w.sql(`select has_function_privilege($1, $2, 'execute') v`, [r, f])).rows[0].v, false, r + ' ' + f);
  assert.equal((await w.sql(`select count(*)::int n from public.dl_trial`)).rows[0].n, 0);
  assert.equal((await w.sql(`select count(*)::int n from public.dl_devices where revoked_at is null`)).rows[0].n, 0);
  assert.equal((await w.sql(`select count(*)::int n from public.dl_invites where revoked_at is null`)).rows[0].n, 0);
  // 試しを入れ直せない（7A）
  const t = await w.call({ action: 'admin_trial', emp_id: 'E10', on: true }, 'gm');
  assert.deepEqual(t, { status: 410, body: { error: 'trial_off' } });
  // 2 回目
  await w.pg.exec('reset role'); await w.pg.exec(MIG89); await w.pg.exec('set role service_role');
  assert.equal((await w.rpc('dl_pk_mail_creds', {})).from, FROM, '送り手は残る');
});

test('ログインの方式を変えられるのは GM だけ（2A）・GM・CEO・経理はこの方式にしない（6A）', async () => {
  const w = await setup();
  for (const who of ['ceo', 'office']) assert.deepEqual(await w.call({ action: 'pk_admin_list' }, who), { status: 403, body: { error: 'forbidden' } }, who);
  assert.deepEqual(await w.call({ action: 'pk_admin_list' }), { status: 401, body: { error: 'email_required' } });
  const l = await w.call({ action: 'pk_admin_list' }, 'gm');
  assert.equal(l.status, 200);
  const me = l.body.people.find(p => p.emp_id === 'E2');
  assert.equal(me.method, 'email');
  assert.equal(l.body.people.find(p => p.emp_id === 'E9').method, 'pin');
  assert.ok(!l.body.people.some(p => p.emp_id === 'E12'), '退職した人は出さない');
  assert.equal(l.body.mail.from_set, true);
  assert.equal(l.body.mail.state, 'none');
  for (const e of ['E1', 'E2', 'E3']) assert.deepEqual((await w.call({ action: 'pk_admin_set', emp_id: e, email: 'x' + e + '@example.test', told: true }, 'gm')).body, { error: 'top_not_allowed' }, e);
  assert.deepEqual((await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'crew9@example.test' }, 'gm')).body, { error: 'bad_value' }, '本人に伝えた（told）が要る');
  assert.deepEqual((await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'no-at-sign', told: true }, 'gm')).body, { error: 'bad_email' });
  assert.deepEqual((await w.call({ action: 'pk_admin_set', emp_id: 'E12', email: 'left@example.test', told: true }, 'gm')).body, { error: 'inactive' });
  // CEO も変えられない
  assert.deepEqual((await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'crew9@example.test', told: true }, 'ceo')).body, { error: 'forbidden' });
});

test('送り手：つなぐまで招待は送れない・違うアカウントは保存しない・state は 1 回だけ', async () => {
  const w = await setup();
  const s = await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'crew9@example.test', told: true }, 'gm');
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.mail, { sent: false, error: 'mail_not_connected' });
  assert.equal(s.body.person.need, 'send_failed');
  assert.equal(w.G.sent.length, 0);
  // 違うアカウントでつないだ
  w.G.account = 'someone-else@example.test';
  const bad = await w.connectMail();
  assert.match(bad.url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(new URL(bad.url).searchParams.get('login_hint'), FROM);
  assert.equal(new URL(bad.url).searchParams.get('redirect_uri'), 'https://db.test/functions/v1/device-login');
  assert.match(bad.location, /pkmail=wrong_account$/);
  assert.equal((await w.call({ action: 'pk_mail_status' }, 'gm')).body.state, 'none');
  // 正しいアカウント
  w.G.account = FROM;
  const ok = await w.connectMail();
  assert.match(ok.location, /^https:\/\/funergy-plus\.com\/\?pkmail=ok$/);
  const st = (await w.call({ action: 'pk_mail_status' }, 'gm')).body;
  assert.equal(st.state, 'ok'); assert.equal(st.account, FROM);
  assert.ok(!JSON.stringify(st).includes('g-refresh'), 'トークンは見せない');
  // 同じ state をもう一度・知らない state
  assert.match((await w.get('state=nope&code=good')).headers.get('location'), /pkmail=bad_state$/);
  // CEO はつなげない
  assert.deepEqual(await w.call({ action: 'pk_mail_connect' }, 'ceo'), { status: 403, body: { error: 'forbidden' } });
  // 送り直し → 届く
  const r = await w.call({ action: 'pk_admin_invite', emp_id: 'E9' }, 'gm');
  assert.equal(r.body.mail.sent, true);
  const m = w.lastMailTo('crew9@example.test');
  assert.equal(m.from, 'Funergy+ <' + FROM + '>');
  assert.match(m.text, /Crew Nine さん/);
  assert.ok(w.tokenOf(m));
  // 許可を取り消された → 送れない・状態は expired
  w.G.refreshFail = true;
  assert.deepEqual((await w.call({ action: 'pk_admin_invite', emp_id: 'E9' }, 'gm')).body.mail, { sent: false, error: 'mail_not_connected' });
  assert.equal((await w.call({ action: 'pk_mail_status' }, 'gm')).body.state, 'expired');
});

test('招待 → メールのコード → ログイン（12 時間）→ 本人の端末ならパスキーを保存する Supabase のログイン', async () => {
  const w = await setup(); await w.connectMail();
  await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'Crew9@Example.test', told: true }, 'gm');
  const token = w.tokenOf(w.lastMailTo('Crew9@Example.test'));
  const peek = (await w.call({ action: 'pk_invite_peek', token })).body;
  assert.equal(peek.state, 'ok'); assert.equal(peek.name, 'Crew Nine'); assert.equal(peek.email_masked, 'C•••••9@Example.test');
  assert.ok(!('emp_id' in peek) && !('invite_id' in peek));
  // メール＋パスキーにしたときから PIN では入れない（招待を済ませる前でも）
  assert.equal((await w.rpc('dl_pin_blocked', { emp_id: 'E9' })).blocked, true);
  assert.equal((await w.rpc('dl_pin_blocked', { name: 'Crew Nine' })).blocked, true, '名前で探すとき：同じ名前の在籍の人のだれかがパスキー');
  assert.equal((await w.rpc('dl_pin_blocked', { emp_id: 'E11', name: 'Crew Nine' })).blocked, false, '同じ名前でも ID が別の人は止めない');
  assert.deepEqual((await w.call({ action: 'login_info' })).body, { top_pin_off: true, pk: true, pk_emps: ['E9'] });
  // コード
  assert.equal((await w.call({ action: 'pk_code_send', token })).body.state, 'sent');
  assert.equal((await w.call({ action: 'pk_code_send', token })).body.state, 'wait', '1 分あける');
  const code = w.codeOf(w.lastMailTo('Crew9@Example.test'));
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.deepEqual(await w.call({ action: 'pk_code_verify', token, code: wrong }), { status: 401, body: { error: 'code_wrong', left: 4 } });
  const v = await w.call({ action: 'pk_code_verify', token, code: ' ' + code.slice(0, 3) + ' ' + code.slice(3), keep: true, passkey: true, device_name: 'My phone' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.emp_id, 'E9'); assert.equal(v.body.token, 'mark.E9'); assert.equal(v.body.keep, true);
  assert.match(v.body.session, /^[A-Za-z0-9_-]{43}$/);
  assert.match(v.body.supabase.access_token, /^sb-/);
  assert.ok(!('auth_uid' in v.body) && !('old_uid' in v.body) && !('email' in v.body));
  const pp = (await w.sql(`select * from public.dl_people where emp_id = 'E9'`)).rows[0];
  assert.ok(pp.confirmed_at); assert.ok(pp.auth_uid);
  assert.equal(w.S.users.get(pp.auth_uid).app_metadata.fdl, 'pk');
  assert.equal(w.S.users.get(pp.auth_uid).email, 'Crew9@Example.test');
  // 招待はもう使えない
  assert.equal((await w.call({ action: 'pk_invite_peek', token })).body.state, 'used');
  assert.equal((await w.call({ action: 'pk_code_verify', token, code })).body.error, 'code_gone');
  // 値そのものは残っていない
  const dump = JSON.stringify((await w.sql(`select * from public.dl_pk_invites`)).rows) + JSON.stringify((await w.sql(`select * from public.dl_pk_codes`)).rows) + JSON.stringify((await w.sql(`select * from public.dl_pk_sessions`)).rows);
  assert.ok(!dump.includes(token) && !dump.includes(v.body.session) && !dump.includes('"' + code + '"'));
  // ログインのあいだ：開いた・裏で確かめる
  const r1 = await w.call({ action: 'pk_resume', session: v.body.session });
  assert.deepEqual([r1.status, r1.body.emp_id, r1.body.token, r1.body.keep], [200, 'E9', 'mark.E9', true]);
  assert.equal((await w.call({ action: 'pk_resume', session: v.body.session, mode: 'refresh' })).body.emp_id, 'E9');
  // 共有の端末にした → ログインしたままにしない（アプリが閉じたらログアウト）
  await w.call({ action: 'pk_keep', session: v.body.session, keep: false });
  assert.equal((await w.call({ action: 'pk_resume', session: v.body.session })).body.keep, false);
  // パスキーを保存した（端末が Supabase に保存したあと）→ 一覧・消す
  await w.call({ action: 'pk_keys_added' }, v.body.supabase.access_token);
  w.S.keys.set(pp.auth_uid, [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', friendly_name: 'iPhone', created_at: '2026-11-17T00:00:00Z' }]);
  assert.deepEqual((await w.call({ action: 'pk_my_keys', session: v.body.session })).body.keys.map(k => k.name), ['iPhone']);
  assert.deepEqual((await w.call({ action: 'pk_my_key_delete', session: v.body.session, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).body, { error: 'not_found' });
  assert.equal((await w.call({ action: 'pk_my_key_delete', session: v.body.session, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).status, 200);
  assert.ok((await w.sql(`select keys_at from public.dl_people where emp_id = 'E9'`)).rows[0].keys_at);
  // ログアウト
  await w.call({ action: 'pk_logout', session: v.body.session });
  assert.deepEqual(await w.call({ action: 'pk_resume', session: v.body.session }), { status: 401, body: { error: 'session_gone' } });
});

test('共有の端末（9A）：コードで入っても Supabase の利用者は作らない・パスキーは残さない', async () => {
  const w = await setup(); await w.connectMail();
  const { v } = await enroll(w, 'E10', 'crew10@example.test', { keep: false, passkey: true });
  assert.equal(v.keep, false);
  assert.equal(v.supabase, undefined);
  assert.equal((await w.sql(`select auth_uid from public.dl_people where emp_id = 'E10'`)).rows[0].auth_uid, null);
});

test('パスキーで入る（8A）：スタッフは pk_login でログインのあいだ・GM・CEO・経理は email_login の道へ・失効したら入れない', async () => {
  const w = await setup(); await w.connectMail();
  const { v } = await enroll(w, 'E9', 'crew9@example.test');
  const uid = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  // 端末がパスキーで Supabase に入った（偽物：その利用者のトークン）
  const sbTok = 'sb-passkey-1'; w.S.tokens.set(sbTok, uid);
  const r = await w.call({ action: 'pk_login', keep: true, device_name: 'Phone' }, sbTok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'staff'); assert.equal(r.body.emp_id, 'E9'); assert.equal(r.body.token, 'mark.E9');
  assert.equal((await w.sql(`select via from public.dl_pk_sessions order by created_at desc limit 1`)).rows[0].via, 'passkey');
  // 管理者は manager（アプリが email_login を続ける）
  assert.deepEqual((await w.call({ action: 'pk_login' }, 'gm')).body, { kind: 'manager', emp_id: 'E2' });
  // 知らない Supabase の利用者
  const stranger = '00000000-0000-4000-8000-00000000ffff'; w.S.users.set(stranger, { id: stranger, email: 'z@example.test', app_metadata: {} }); w.S.tokens.set('sb-z', stranger);
  assert.deepEqual((await w.call({ action: 'pk_login' }, 'sb-z')).body, { error: 'not_linked' });
  // GM が失効（端末をなくした）→ ログインのあいだも止まり、Supabase の利用者（パスキー）は消える
  const rv = await w.call({ action: 'pk_admin_revoke', emp_id: 'E9' }, 'gm');
  assert.equal(rv.status, 200); assert.ok(!('old_uid' in rv.body));
  assert.ok(w.S.deleted.includes(uid));
  assert.deepEqual((await w.call({ action: 'pk_resume', session: v.session })).body, { error: 'session_gone' });
  assert.deepEqual((await w.call({ action: 'pk_resume', session: r.body.session })).body, { error: 'session_gone' });
  assert.equal((await w.call({ action: 'pk_login' }, sbTok)).status, 401, 'Supabase の利用者が消えた');
  // まだメール＋パスキー：メールのコードで入り直せる（名前を選んだあと・emp_id）
  await w.ago('E9');
  assert.equal((await w.call({ action: 'pk_code_send', emp_id: 'E9' })).body.state, 'sent');
  const code = w.codeOf(w.lastMailTo('crew9@example.test'));
  const again = await w.call({ action: 'pk_code_verify', emp_id: 'E9', code, keep: true, passkey: true });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const uid2 = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  assert.ok(uid2 && uid2 !== uid, '新しい利用者（前のパスキーは無い）');
});

test('前の利用者が消せずに残っていても、入り直すと作り直す（前のパスキーを使わせない）・管理者のメールは使わない', async () => {
  const w = await setup(); await w.connectMail();
  await enroll(w, 'E9', 'crew9@example.test');
  const uid = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  w.S.failDelete = true;
  await w.call({ action: 'pk_admin_revoke', emp_id: 'E9' }, 'gm');
  assert.ok(w.S.users.has(uid), '消せなかった');
  w.S.failDelete = false;
  await w.ago('E9');
  await w.call({ action: 'pk_code_send', email: 'crew9@example.test' });
  const again = await w.call({ action: 'pk_code_verify', email: 'CREW9@example.test ', code: w.codeOf(w.lastMailTo('crew9@example.test')), keep: true, passkey: true });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.ok(!w.S.users.has(uid), '残っていた利用者は消してから作り直す');
  const uid2 = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  assert.notEqual(uid2, uid);
  // GM のメール（管理者の利用者）を店のスタッフに使った：ログインはできるが、パスキーの利用者は作らない
  await w.call({ action: 'pk_admin_set', emp_id: 'E10', email: 'gm@example.test', told: true }, 'gm');
  const token = w.tokenOf(w.lastMailTo('gm@example.test'));
  await w.call({ action: 'pk_code_send', token });
  const v = await w.call({ action: 'pk_code_verify', token, code: w.codeOf(w.lastMailTo('gm@example.test')), keep: true, passkey: true });
  assert.equal(v.status, 200);
  assert.equal(v.body.passkey_error, 'email_taken');
  assert.equal(v.body.supabase, undefined);
  assert.ok(w.S.users.has(U.gm) && !w.S.deleted.includes(U.gm), '管理者の利用者は消さない');
  assert.equal((await w.sql(`select auth_uid from public.dl_people where emp_id = 'E10'`)).rows[0].auth_uid, null);
});

test('メールのコード：知らないメール・PIN の人には同じ答え・送らない／1 時間に 5 回まで／5 回間違えたら使えない', async () => {
  const w = await setup(); await w.connectMail();
  await enroll(w, 'E9', 'crew9@example.test');
  const n0 = w.G.sent.length;
  for (const b of [{ email: 'nobody@example.test' }, { emp_id: 'E10' }, { emp_id: 'E1' }, { emp_id: 'NOPE' }]) assert.deepEqual((await w.call({ action: 'pk_code_send', ...b })).body, { state: 'sent' }, JSON.stringify(b));
  assert.equal(w.G.sent.length, n0, '送っていない');
  assert.deepEqual((await w.call({ action: 'pk_code_send', email: 'bad' })).body, { error: 'bad_email' });
  // 5 回間違える
  await w.call({ action: 'pk_code_send', email: 'crew9@example.test' });
  for (let i = 0; i < 4; i++) assert.equal((await w.call({ action: 'pk_code_verify', email: 'crew9@example.test', code: '000000' })).body.error, 'code_wrong');
  const last = await w.call({ action: 'pk_code_verify', email: 'crew9@example.test', code: '000000' });
  assert.ok(['code_wrong', 'code_gone'].includes(last.body.error));
  assert.equal((await w.call({ action: 'pk_code_verify', email: 'crew9@example.test', code: w.codeOf(w.lastMailTo('crew9@example.test')) })).body.error, 'code_gone');
  // 1 時間に 5 回まで（メールで頼んだときは答えを変えない）
  for (let i = 0; i < 6; i++) { await w.ago('E9'); await w.call({ action: 'pk_code_send', email: 'crew9@example.test' }); }
  const k = (await w.sql(`select count(*)::int n from public.dl_pk_codes where emp_id = 'E9' and purpose = 'login'`)).rows[0].n;
  assert.ok(k <= 5, 'at most 5 codes an hour, got ' + k);
  assert.deepEqual((await w.call({ action: 'pk_code_send', email: 'crew9@example.test' })).body, { state: 'sent' });
});

test('メールを変える：確かめが済むまで前のメール・前のメールに知らせる・済んだら前のログインとパスキーを消す', async () => {
  const w = await setup(); await w.connectMail();
  const { v } = await enroll(w, 'E9', 'crew9@example.test');
  const uid = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  // ほかの人が使っているメールは使えない
  await w.call({ action: 'pk_admin_set', emp_id: 'E10', email: 'crew10@example.test', told: true }, 'gm');
  assert.deepEqual((await w.call({ action: 'pk_admin_email', emp_id: 'E9', email: 'CREW10@example.test' }, 'gm')).body, { error: 'email_taken' });
  const ch = await w.call({ action: 'pk_admin_email', emp_id: 'E9', email: 'new9@example.test' }, 'gm');
  assert.equal(ch.status, 200); assert.equal(ch.body.mail.sent, true);
  assert.equal(ch.body.person.email, 'crew9@example.test'); assert.equal(ch.body.person.email_new, 'new9@example.test');
  const notice = w.lastMailTo('crew9@example.test');
  assert.match(notice.subject, /変えます/); assert.match(notice.text, /n•••••9@example\.test/);
  // まだ前のメールでログインできる
  assert.equal((await w.call({ action: 'pk_resume', session: v.session })).status, 200);
  const token = w.tokenOf(w.lastMailTo('new9@example.test'));
  assert.equal((await w.call({ action: 'pk_invite_peek', token })).body.purpose, 'email_change');
  await w.ago('E9');
  assert.equal((await w.call({ action: 'pk_code_send', token })).body.state, 'sent');
  const done = await w.call({ action: 'pk_code_verify', token, code: w.codeOf(w.lastMailTo('new9@example.test')), keep: true, passkey: false });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const pp = (await w.sql(`select * from public.dl_people where emp_id = 'E9'`)).rows[0];
  assert.equal(pp.email, 'new9@example.test'); assert.equal(pp.email_new, null); assert.equal(pp.auth_uid, null);
  assert.ok(w.S.deleted.includes(uid), '前のメールの利用者（パスキー）を消す');
  assert.deepEqual((await w.call({ action: 'pk_resume', session: v.session })).body, { error: 'session_gone' }, '前のログインは止まる');
  assert.equal((await w.call({ action: 'pk_resume', session: done.body.session })).status, 200);
});

test('PIN に戻す：auth-pin で PIN を入れてから・PIN で入れる・ログインとパスキーは止まる／退職したらログインのあいだは止まる', async () => {
  const w = await setup(); await w.connectMail();
  const { v } = await enroll(w, 'E9', 'crew9@example.test');
  const uid = (await w.sql(`select auth_uid from public.dl_people where emp_id = 'E9'`)).rows[0].auth_uid;
  assert.deepEqual((await w.call({ action: 'pk_admin_pin', emp_id: 'E9' }, 'gm')).body, { error: 'pin_first' });
  const r = await w.call({ action: 'pk_admin_pin', emp_id: 'E9', pin_set: true }, 'gm');
  assert.equal(r.status, 200); assert.equal(r.body.person.method, 'pin');
  assert.equal((await w.rpc('dl_pin_blocked', { emp_id: 'E9' })).blocked, false);
  assert.ok(w.S.deleted.includes(uid));
  assert.deepEqual((await w.call({ action: 'pk_resume', session: v.session })).body, { error: 'session_gone' });
  assert.deepEqual((await w.call({ action: 'login_info' })).body.pk_emps, []);
  // メールは記録に残る：もう一度メール＋パスキーにできる（同じメール）
  assert.equal((await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'crew9@example.test', told: true }, 'gm')).status, 200);
  // 退職
  const { v: v2 } = await enroll(w, 'E10', 'crew10@example.test');
  await w.sql(`update public.employees set status = '退職' where id = 'E10'`);
  assert.deepEqual((await w.call({ action: 'pk_resume', session: v2.session })).body, { error: 'inactive' });
  assert.deepEqual((await w.call({ action: 'pk_resume', session: v2.session })).body, { error: 'session_gone' });
});

test('取り消した・送り直した招待は使えない・GM の右のパネル（記録・ログイン中）', async () => {
  const w = await setup(); await w.connectMail();
  await w.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'crew9@example.test', told: true }, 'gm');
  const t1 = w.tokenOf(w.lastMailTo('crew9@example.test'));
  await w.call({ action: 'pk_admin_invite', emp_id: 'E9' }, 'gm');
  const t2 = w.tokenOf(w.lastMailTo('crew9@example.test'));
  assert.notEqual(t1, t2);
  assert.equal((await w.call({ action: 'pk_invite_peek', token: t1 })).body.state, 'revoked');
  assert.deepEqual((await w.call({ action: 'pk_code_send', token: t1 })).body, { error: 'invite_gone' });
  await w.call({ action: 'pk_admin_invite_revoke', emp_id: 'E9' }, 'gm');
  assert.equal((await w.call({ action: 'pk_invite_peek', token: t2 })).body.state, 'revoked');
  const d = await w.call({ action: 'pk_admin_detail', emp_id: 'E9' }, 'gm');
  assert.equal(d.status, 200); assert.ok(!('auth_uid' in d.body));
  assert.ok(d.body.log.some(x => x.kind === 'pk_set' && x.by === 'GM'));
  assert.equal(d.body.person.need, 'invite_expired');
  // 招待の期限（7 日・4A）
  await w.call({ action: 'pk_admin_invite', emp_id: 'E9' }, 'gm');
  const exp = (await w.sql(`select extract(epoch from (expires_at - created_at))::int s from public.dl_pk_invites where emp_id = 'E9' order by created_at desc limit 1`)).rows[0].s;
  assert.equal(exp, 7 * 86400);
});
