// v1168 チャットの守り（UI案79 の答え 1〜6 A の残り）：個人のチャット暗証番号・グループのキー・プッシュ通知。
// 本物の SQL（申請 1 段目〜段階 2 ＋ チャット ＋ 添付 ＋ UI案79 ＋ この SQL・PGlite）と本物の handler、合成データだけ。
// PIN のログインの印・ログインの PIN の確かめ（auth-pin）・プッシュの送り先は代わり。仕様：docs/CHAT_GUARD_V1168_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, webPush, secretMake, secretOk, PINV, KEYV, PUSH_HOST } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT_SQL = M('20261121090000_chat'), FILES_SQL = M('20261124090000_chat_files'), UI79_SQL = M('20261127090000_chat_ui79');
export const GUARD_SQL = M('20261128090000_chat_guard');
const FIX_SQL = M('20261129090000_fixes_v1169');   // v1169：関数 v1169 はキー付きのグループをこの SQL（chat_create_group_k）で作る

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const EP = who => 'https://fcm.googleapis.com/fcm/send/dev-' + who;

async function setup({ guard = true, twice = false, push = true, fix = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  await pg.exec(CHAT_SQL); await pg.exec(FILES_SQL); await pg.exec(UI79_SQL);
  if (guard) { await pg.exec(GUARD_SQL); if (twice) await pg.exec(GUARD_SQL); if (fix) await pg.exec(FIX_SQL); }
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const calls = [], params = [];
  const db = { async rpc(name, p) { calls.push(name); params.push([name, p]); const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const pushed = [], later = [];
  const status = {};   // 送り先ごとの答え（既定 201）
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  if (push) Object.assign(env, { CHAT_VAPID_PUBLIC: 'BPUB' }, push === 'pub' ? {} : { CHAT_VAPID_PRIVATE: 'priv' });
  const logins = [];
  const handler = createHandler({ env: k => env[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; },
    loginCheck: async (w, pin) => { logins.push([w.emp_id, w.name]); return pin === '1111' ? { ok: true } : pin === '9999' ? { ok: false, locked: 600 } : { ok: false }; },
    pushSend: push === true ? async ep => { pushed.push(ep); return status[ep] || 201; } : undefined,
    waitUntil: p => { later.push(p); } });
  let seq = 0;
  const key = () => 'g-' + (++seq).toString().padStart(6, '0') + '-guard';
  const call = async (who, body, unlock) => {
    const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin_session: 'pin-' + who, ...(unlock ? { unlock } : {}), ...body }) }));
    return { status: r.status, body: await r.json() };
  };
  const ok = async (who, body, unlock) => { const r = await call(who, body, unlock); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const send = (who, thread, text, unlock, extra = {}) => call(who, { action: 'chat_send', thread, body: text, client_key: key(), ...extra }, unlock);
  const msgs = (who, thread, unlock) => call(who, { action: 'chat_messages', thread }, unlock);
  const group = (who, members, extra = {}) => ok(who, { action: 'chat_create_group', title: 'Kitchen', members, client_key: key(), ...extra }, extra.unlock);
  const flush = async () => { while (later.length) await later.shift(); };
  const q = async sql => { await pg.exec('reset role'); const r = await pg.query(sql); await pg.exec('set role service_role'); return r.rows; };
  const qx = async sql => { await pg.exec('reset role'); await pg.exec(sql); await pg.exec('set role service_role'); };
  return { pg, db, calls, params, call, ok, key, send, msgs, group, pushed, status, flush, q, qx, logins };
}

test('the SQL needs the UI79 SQL first (STOP), runs twice, says chat 4 (5 with the v1169 fixes); the function is fn 11; only the server key can run or read any of it', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(pg.exec(GUARD_SQL), /STOP: 先にチャット/);
  const { ok, q } = await setup({ twice: true });
  const me = await ok('E7', { action: 'whoami' });
  assert.ok(me.fn >= 11, 'fn ' + me.fn);   /* v1184 から 12 */ assert.equal(me.chat, 5); assert.equal(me.push, true);
  const fns = ['chat_guard_get', 'chat_pin_begin', 'chat_pin_end', 'chat_pin_save', 'chat_relock', 'chat_key_begin', 'chat_key_end', 'chat_key_save',
    'chat_push_save', 'chat_push_drop', 'chat_push_check', 'chat_push_targets', 'chat_push_result', 'chat_sess_open', 'chat_gate_actor', 'chat_actor', 'chat_find_nokey', 'wr_receipt_from_chat'];
  for (const f of fns) {
    const r = (await q(`select has_function_privilege('anon', 'public.${f}(jsonb)', 'execute') a, has_function_privilege('authenticated', 'public.${f}(jsonb)', 'execute') b,
      has_function_privilege('service_role', 'public.${f}(jsonb)', 'execute') c`).catch(async () => q(`select false a, false b, true c`)))[0];
    assert.deepEqual(r, { a: false, b: false, c: true }, f);
  }
  for (const tb of ['chat_guard', 'chat_sess', 'chat_sess_keys', 'chat_key_fails', 'chat_push_subs']) {
    const r = (await q(`select has_table_privilege('anon', 'public.${tb}', 'select') a, has_table_privilege('authenticated', 'public.${tb}', 'insert') b,
      (select relrowsecurity from pg_class where relname = '${tb}') rls`))[0];
    assert.deepEqual(r, { a: false, b: false, rls: true }, tb);
  }
});

test('the chat PIN is off at first; set it and nothing (list, messages, people, @, files, signal) comes back without opening it; no PIN is stored as is', async () => {
  const { ok, call, group, send, msgs, q } = await setup();
  const g = await group('E7', ['E6']);
  assert.equal((await send('E6', g.id, 'hello @Lee', null, { mentions: ['E7'] })).status, 200);
  const g0 = await ok('E7', { action: 'chat_guard' });
  assert.equal(g0.pin, false); assert.equal(g0.unlocked, true);
  const s0 = await ok('E7', { action: 'chat_sync', since: 0 });
  assert.equal(s0.threads.length, 1); assert.ok(s0.token);
  // bad shapes
  assert.equal((await call('E7', { action: 'chat_pin_set', pin: '12' })).status, 400);
  assert.equal((await call('E7', { action: 'chat_pin_set', pin: '12a4' })).status, 400);
  assert.equal((await call('E7', { action: 'chat_pin_set', pin: '123456789' })).status, 400);
  const set = await ok('E7', { action: 'chat_pin_set', pin: '４３２１' });   // full-width digits from the Japanese keyboard are the same
  assert.equal(set.ok, true); assert.equal(set.pin, true); assert.match(set.unlock, /^[0-9a-f]{64}$/);
  // without the opening mark: only the counts
  const s1 = await ok('E7', { action: 'chat_sync', since: 0 });
  assert.deepEqual(s1.guard, { pin: true, unlocked: false });
  assert.deepEqual(s1.threads, []); assert.equal(s1.token, undefined); assert.equal(s1.unread, 1); assert.equal(s1.mention, 1);
  for (const body of [{ action: 'chat_messages', thread: g.id }, { action: 'chat_people' }, { action: 'chat_mentions' }, { action: 'chat_files', thread: g.id },
    { action: 'chat_file_url', id: g.id }, { action: 'chat_send', thread: g.id, body: 'x', client_key: 'kkkkkkkk-a' }, { action: 'chat_read', thread: g.id, seq: 1 },
    { action: 'chat_open_dm', to: 'E8' }, { action: 'chat_create_group', title: 'x', members: ['E8'], client_key: 'kkkkkkkk-b' }, { action: 'chat_key_verify', thread: g.id, key: 'abcd' }]) {
    assert.deepEqual(await call('E7', body), { status: 423, body: { error: 'chat_pin_required' } }, body.action);
    assert.deepEqual(await call('E7', body, 'f'.repeat(64)), { status: 423, body: { error: 'chat_pin_required' } }, body.action + ' with a made-up mark');
  }
  // E7's mark from setting it works; another person cannot use E7's mark
  assert.equal((await msgs('E7', g.id, set.unlock)).status, 200);
  assert.equal((await ok('E7', { action: 'chat_sync', since: 0 }, set.unlock)).threads.length, 1);
  assert.equal((await msgs('E6', g.id, set.unlock)).status, 200, 'E6 has no PIN, so the mark does not matter');
  // nothing stored as is: no column anywhere holds 4321 or the mark
  const dump = JSON.stringify(await q(`select to_jsonb(g) || coalesce((select jsonb_agg(to_jsonb(s)) from public.chat_sess s), '[]'::jsonb) v from public.chat_guard g`));
  assert.ok(!dump.includes('4321') && !dump.includes(set.unlock), 'only hashes are stored');
  assert.match((await q(`select pin_hash from public.chat_guard where emp_id = 'E7'`))[0].pin_hash, /^[0-9a-f]{64}$/);
});

test('opening the PIN on another device: a wrong PIN counts, five in a row stop it (even the right one), even when sent at the same time; it opens again later', async () => {
  const { ok, call, group, msgs, q } = await setup();
  const g = await group('E7', ['E6']);
  await ok('E7', { action: 'chat_pin_set', pin: '4321' });
  const w1 = await ok('E7', { action: 'chat_pin_verify', pin: '0000' });
  assert.deepEqual([w1.ok, w1.left, w1.locked], [false, 4, 0]);
  const right = await ok('E7', { action: 'chat_pin_verify', pin: '4321' });
  assert.equal(right.ok, true); assert.match(right.unlock, /^[0-9a-f]{64}$/);
  assert.equal((await msgs('E7', g.id, right.unlock)).status, 200);
  assert.equal((await q(`select fails from public.chat_guard where emp_id = 'E7'`))[0].fails, 0, 'a right PIN resets the count');
  // 7 wrong at the same time: counted before checking, so it stops at 5
  const rs = await Promise.all(Array.from({ length: 7 }, () => ok('E7', { action: 'chat_pin_verify', pin: '1234' })));
  assert.ok(rs.every(r => r.ok === false));
  assert.ok(rs.filter(r => r.locked > 0).length >= 3, JSON.stringify(rs));
  const row = (await q(`select fails, locked_until > now() + interval '14 minutes' l from public.chat_guard where emp_id = 'E7'`))[0];
  assert.equal(row.fails, 5); assert.equal(row.l, true);
  const stopped = await ok('E7', { action: 'chat_pin_verify', pin: '4321' });
  assert.equal(stopped.ok, false); assert.ok(stopped.locked > 800, 'even the right PIN waits');
  const st = await ok('E7', { action: 'chat_guard' });
  assert.ok(st.locked > 800);
  // later: it opens; the next stop is longer (30 min)
  await q(`update public.chat_guard set locked_until = now() - interval '1 second' where emp_id = 'E7'`);
  for (let i = 0; i < 5; i++) await ok('E7', { action: 'chat_pin_verify', pin: '1234' });
  assert.equal((await q(`select locked_until > now() + interval '29 minutes' l from public.chat_guard where emp_id = 'E7'`))[0].l, true);
  await q(`update public.chat_guard set locked_until = now() - interval '1 second' where emp_id = 'E7'`);
  assert.equal((await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).ok, true);
  assert.equal((await q(`select fails from public.chat_guard where emp_id = 'E7'`))[0].fails, 0);
  assert.equal((await call('E7', { action: 'chat_pin_verify', pin: 'abcd' })).status, 400);
});

test('changing the PIN needs the current one and closes the other devices; removing it needs the current one; forgetting it: the login PIN (auth-pin) removes it', async () => {
  const { ok, call, group, msgs, logins } = await setup();
  const g = await group('E7', ['E6']);
  const a = (await ok('E7', { action: 'chat_pin_set', pin: '4321' })).unlock;
  const b = (await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).unlock;   // another device
  assert.equal((await msgs('E7', g.id, b)).status, 200);
  const bad = await ok('E7', { action: 'chat_pin_set', pin: '5555', cur: '0000' }, a);
  assert.equal(bad.ok, false); assert.equal(bad.left, 4);
  assert.equal((await call('E7', { action: 'chat_pin_set', pin: '5555' }, a)).status, 400, 'the current PIN is needed');
  const ch = await ok('E7', { action: 'chat_pin_set', pin: '5555', cur: '4321' }, a);
  assert.equal(ch.ok, true); assert.equal(ch.unlock, undefined, 'the same mark stays open');
  assert.equal((await msgs('E7', g.id, a)).status, 200, 'this device stays open');
  assert.equal((await msgs('E7', g.id, b)).status, 423, 'the other device asks again');
  assert.equal((await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).ok, false, 'the old PIN no longer works');
  const b2 = (await ok('E7', { action: 'chat_pin_verify', pin: '5555' }, b));
  assert.equal(b2.ok, true); assert.equal(b2.unlock, undefined, 'the other device keeps its mark (opened again)');
  assert.equal((await msgs('E7', g.id, b)).status, 200);
  // remove
  assert.equal((await ok('E7', { action: 'chat_pin_clear', cur: '0000' }, a)).ok, false);
  assert.equal((await ok('E7', { action: 'chat_pin_clear', cur: '5555' }, a)).pin, false);
  assert.equal((await msgs('E7', g.id)).status, 200, 'no PIN: open without a mark');
  // forgot
  await ok('E7', { action: 'chat_pin_set', pin: '2468' });
  assert.equal((await msgs('E7', g.id)).status, 423);
  const r0 = await ok('E7', { action: 'chat_pin_reset', login_pin: '0000' });
  assert.deepEqual([r0.ok, r0.login], [false, true]);
  const r9 = await ok('E7', { action: 'chat_pin_reset', login_pin: '9999' });
  assert.equal(r9.locked, 600, 'auth-pin stopped it');
  const r1 = await ok('E7', { action: 'chat_pin_reset', login_pin: '1111' });
  assert.deepEqual([r1.ok, r1.pin], [true, false]);
  assert.deepEqual(logins.at(-1), ['E7', NAME.E7], 'checked as the signed-in person');
  assert.equal((await msgs('E7', g.id)).status, 200);
  assert.equal((await ok('E7', { action: 'chat_guard' })).pin, false);
});

test('lock (pin) clears only the PIN part of this mark; log out (all) clears the mark; the mark ends after 12 hours or 2 hours unused', async () => {
  const { ok, group, msgs, q, call } = await setup();
  const g = await group('E7', ['E6']);
  const t = (await ok('E7', { action: 'chat_pin_set', pin: '4321' })).unlock;
  assert.equal((await call('E7', { action: 'chat_relock', mode: 'x' }, t)).status, 400);
  await ok('E7', { action: 'chat_relock', mode: 'pin' }, t);
  assert.equal((await msgs('E7', g.id, t)).status, 423);
  const again = await ok('E7', { action: 'chat_pin_verify', pin: '4321' }, t);
  assert.equal(again.ok, true); assert.equal(again.unlock, undefined, 'the same mark is opened again');
  assert.equal((await msgs('E7', g.id, t)).status, 200);
  await ok('E7', { action: 'chat_relock', mode: 'all' }, t);
  assert.equal((await q(`select count(*)::int n from public.chat_sess where emp_id = 'E7'`))[0].n, 0);
  assert.equal((await msgs('E7', g.id, t)).status, 423);
  const t2 = (await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).unlock;
  assert.notEqual(t2, t);
  await q(`update public.chat_sess set seen_at = now() - interval '3 hours'`);
  assert.equal((await msgs('E7', g.id, t2)).status, 423, '2 hours unused');
  const t3 = (await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).unlock;
  await q(`update public.chat_sess set expires_at = now() - interval '1 second'`);
  assert.equal((await msgs('E7', g.id, t3)).status, 423, '12 hours');
  // somebody else's relock does nothing to E7's mark
  const t4 = (await ok('E7', { action: 'chat_pin_verify', pin: '4321' })).unlock;
  await ok('E6', { action: 'chat_relock', mode: 'all' }, t4);
  assert.equal((await msgs('E7', g.id, t4)).status, 200);
});

test('group key: only the managers set it; members see the name and counts only until they open it; outsiders cannot open it with the key; changing it asks again', async () => {
  const { ok, call, group, send, msgs, q } = await setup();
  const g = await group('E7', ['E6', 'E8']);
  assert.equal((await send('E6', g.id, 'secret plan', null, { mentions: ['E8'] })).status, 200);
  assert.equal((await call('E6', { action: 'chat_key_set', thread: g.id, key: 'kitchen-1' })).status, 403, 'not a manager');
  assert.equal((await call('E7', { action: 'chat_key_set', thread: g.id, key: 'abc' })).status, 400, 'too short');
  assert.equal((await call('E9', { action: 'chat_key_set', thread: g.id, key: 'kitchen-1' })).status, 404);
  const ks = await ok('E7', { action: 'chat_key_set', thread: g.id, key: 'kitchen-1' });
  assert.equal(ks.keyed, true); assert.match(ks.unlock, /^[0-9a-f]{64}$/);
  const mgr = ks.unlock;
  // the manager who set it stays open
  assert.equal((await msgs('E7', g.id, mgr)).status, 200);
  const rowM = (await ok('E7', { action: 'chat_sync', since: 0 }, mgr)).threads[0];
  assert.deepEqual([rowM.keyed, rowM.key_ok], [true, true]); assert.equal(rowM.preview.text, 'secret plan');
  // a member without the key: name and counts only
  const row = (await ok('E8', { action: 'chat_sync', since: 0 })).threads[0];
  assert.deepEqual([row.keyed, row.key_ok, row.title, row.unread, row.mention], [true, false, 'Kitchen', 1, 1]);
  assert.deepEqual(Object.keys(row.preview).sort(), ['at', 'locked', 'seq']);
  assert.ok(!JSON.stringify(row).includes('secret'));
  for (const body of [{ action: 'chat_messages', thread: g.id }, { action: 'chat_send', thread: g.id, body: 'x', client_key: 'kkkkkkkk-c' }, { action: 'chat_read', thread: g.id, seq: 1 },
    { action: 'chat_files', thread: g.id }, { action: 'chat_add', thread: g.id, members: ['E9'], history: true }, { action: 'chat_rename', thread: g.id, title: 'x', expect_rev: 1 }]) {
    assert.deepEqual(await call('E8', body), { status: 423, body: { error: 'chat_key_required' } }, body.action);
  }
  const mid = (await msgs('E7', g.id, mgr)).body.messages[0].id;
  assert.equal((await call('E8', { action: 'chat_edit', id: mid, body: 'x' })).status, 423);
  assert.deepEqual((await ok('E8', { action: 'chat_mentions' })).items, [], 'the @ list leaves it out');
  // wrong key counts; right key opens
  const w = await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'kitchen-2' });
  assert.deepEqual([w.ok, w.left], [false, 4]);
  const r = await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'ｋｉｔｃｈｅｎ-1 ' });   // full width and spaces are the same
  assert.equal(r.ok, true); assert.match(r.unlock, /^[0-9a-f]{64}$/);
  assert.equal((await msgs('E8', g.id, r.unlock)).status, 200);
  assert.equal((await ok('E8', { action: 'chat_mentions' }, r.unlock)).items.length, 1);
  // an outsider with the right key: not a member, so not even the key check
  assert.equal((await call('E9', { action: 'chat_key_verify', thread: g.id, key: 'kitchen-1' })).status, 404);
  assert.equal((await q(`select count(*)::int n from public.chat_key_fails where emp_id = 'E9'`))[0].n, 0);
  // change the key: E8 asks again, the manager stays open
  const ks2 = await ok('E7', { action: 'chat_key_set', thread: g.id, key: 'kitchen-2', expect: ks.key_rev }, mgr);
  assert.equal(ks2.key_rev, ks.key_rev + 1); assert.equal(ks2.unlock, undefined);
  assert.equal((await call('E7', { action: 'chat_key_set', thread: g.id, key: 'kitchen-3', expect: ks.key_rev }, mgr)).status, 409, 'someone changed it first');
  assert.equal((await msgs('E8', g.id, r.unlock)).status, 423);
  assert.equal((await ok('E8', { action: 'chat_sync', since: 0 }, r.unlock)).threads[0].key_ok, false);
  assert.equal((await msgs('E7', g.id, mgr)).status, 200);
  assert.equal((await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'kitchen-1' }, r.unlock)).ok, false, 'the old key no longer works');
  assert.equal((await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'kitchen-2' }, r.unlock)).ok, true);
  assert.equal((await msgs('E8', g.id, r.unlock)).status, 200);
  // the manager forgot it: sets a new one without the old one (from another device)
  assert.equal((await ok('E7', { action: 'chat_key_set', thread: g.id, key: 'kitchen-9' })).keyed, true);
  // leaving does not need the key; clearing opens it for all
  assert.equal((await ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E8' })).removed, 1);
  assert.equal((await ok('E7', { action: 'chat_key_set', thread: g.id, key: null })).keyed, false);
  assert.equal((await msgs('E6', g.id)).status, 200);
  assert.equal((await ok('E6', { action: 'chat_sync', since: 0 })).threads[0].keyed, false);
  assert.ok(!JSON.stringify(await q(`select to_jsonb(t) v from public.chat_threads t`)).includes('kitchen'), 'no key stored as is');
  // a DM cannot have a key
  const dm = await ok('E6', { action: 'chat_open_dm', to: 'E8' });
  assert.equal((await call('E6', { action: 'chat_key_set', thread: dm.id, key: 'kitchen-1' })).status, 403);
});

test('five wrong keys stop that conversation for that person (others are not stopped); a group made with a key opens for the maker', async () => {
  const { ok, group, msgs } = await setup();
  const g = await group('E7', ['E6', 'E8'], { key: 'night-shift' });
  assert.equal(g.keyed, true); assert.match(g.unlock, /^[0-9a-f]{64}$/);
  assert.equal((await msgs('E7', g.id, g.unlock)).status, 200);
  assert.equal((await msgs('E7', g.id)).status, 423);
  for (let i = 0; i < 5; i++) await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'wrong-key' });
  const st = await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'night-shift' });
  assert.equal(st.ok, false); assert.ok(st.locked > 800);
  assert.equal((await ok('E6', { action: 'chat_key_verify', thread: g.id, key: 'night-shift' })).ok, true, 'E6 is not stopped');
});

test('both on: the PIN first, then the key; one mark holds both; the request receipt from a keyed request chat needs the key', async () => {
  const { ok, call, group, msgs, q, qx } = await setup();
  const g = await group('E7', ['E6'], { key: 'both-key' });
  const pinTok = (await ok('E6', { action: 'chat_pin_set', pin: '8642' })).unlock;
  assert.equal((await call('E6', { action: 'chat_key_verify', thread: g.id, key: 'both-key' })).status, 423, 'PIN first');
  assert.equal((await msgs('E6', g.id, pinTok)).status, 423, 'PIN open, key not yet');
  assert.equal((await call('E6', { action: 'chat_key_verify', thread: g.id, key: 'both-key' }, pinTok)).body.ok, true);
  assert.equal((await msgs('E6', g.id, pinTok)).status, 200, 'the same mark now holds both');
  await ok('E6', { action: 'chat_relock', mode: 'pin' }, pinTok);
  assert.equal((await msgs('E6', g.id, pinTok)).status, 423, 'locked: the PIN again');
  await ok('E6', { action: 'chat_pin_verify', pin: '8642' }, pinTok);
  assert.equal((await msgs('E6', g.id, pinTok)).status, 200, 'the key part stayed (lock asks for the PIN only)');
  assert.equal((await q(`select count(*)::int n from public.chat_sess where emp_id = 'E6'`))[0].n, 1);
  // receipts: a keyed request chat
  const r = await ok('E7', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'kkkkkkkk-r1',
    payload: { date: '2026-11-03', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 } });
  const c = await ok('E7', { action: 'chat_case_create', id: r.id, members: [], client_key: 'kkkkkkkk-c1' });
  const kc = await ok('E7', { action: 'chat_key_set', thread: c.id, key: 'case-key' });
  await qx(`insert into public.chat_messages(thread_id, seq, author_emp, author_name, body, client_key) values ('${c.id}', 1, 'E7', 'Lee', null, 'kkkkkkkk-m1');
    update public.chat_threads set last_seq = 1 where id = '${c.id}';
    insert into public.chat_files(id, thread_id, owner_emp, client_key, name, ext, kind, mime, size, path, status, message_id, seq)
      select gen_random_uuid(), '${c.id}', 'E7', 'kkkkkkkk-f1', 'r.jpg', 'jpg', 'photo', 'image/jpeg', 100, gen_random_uuid()::text || '/' || gen_random_uuid()::text, 'sent', m.id, 1 from public.chat_messages m where m.thread_id = '${c.id}'`);
  const fid = (await q(`select id from public.chat_files where thread_id = '${c.id}'`))[0].id;
  const rev = (await ok('E7', { action: 'get', id: r.id })).rev;
  assert.deepEqual(await call('E7', { action: 'wr_receipt_chat', id: r.id, file: fid, expect_rev: rev, client_key: 'kkkkkkkk-x1' }), { status: 423, body: { error: 'chat_key_required' } });
  assert.equal((await call('E7', { action: 'wr_receipt_chat', id: r.id, file: fid, expect_rev: rev, client_key: 'kkkkkkkk-x2' }, kc.unlock)).status, 200);
  // files of a keyed conversation do not open without the key
  const fu = await call('E7', { action: 'chat_file_url', ids: [fid], thumb: true });
  assert.deepEqual(fu.body.items, []);
});

test('push: only the endpoint is kept; a send rings the other members (not the sender, not people who left), once per 30 s, without any content; gone endpoints are removed', async () => {
  const { ok, call, group, send, pushed, status, flush, q } = await setup();
  const g = await group('E7', ['E6', 'E8']);
  assert.deepEqual(await ok('E7', { action: 'chat_push_key' }), { key: 'BPUB' });
  assert.equal((await call('E6', { action: 'chat_push_sub', endpoint: 'https://evil.example.com/x' })).status, 400);
  assert.equal((await call('E6', { action: 'chat_push_sub', endpoint: 'http://fcm.googleapis.com/fcm/send/x' })).status, 400);
  for (const e of ['E6', 'E7', 'E8']) await ok(e, { action: 'chat_push_sub', endpoint: EP(e) });
  await ok('E8', { action: 'chat_push_sub', endpoint: 'https://web.push.apple.com/QE8' });
  assert.equal((await send('E7', g.id, 'first')).status, 200); await flush();
  assert.deepEqual(pushed.sort(), [EP('E6'), EP('E8'), 'https://web.push.apple.com/QE8'].sort(), 'not the sender');
  pushed.length = 0;
  assert.equal((await send('E7', g.id, 'second')).status, 200); await flush();
  assert.deepEqual(pushed, [], 'once per 30 seconds');
  await q(`update public.chat_push_subs set last_push_at = now() - interval '31 seconds'`);
  await ok('E7', { action: 'chat_remove', thread: g.id, emp: 'E8' });
  status[EP('E6')] = 410;
  assert.equal((await send('E7', g.id, 'third')).status, 200); await flush();
  assert.deepEqual(pushed, [EP('E6')], 'E8 left the conversation');
  assert.equal((await q(`select count(*)::int n from public.chat_push_subs where endpoint = '${EP('E6')}'`))[0].n, 0, 'gone (410) is removed');
  // the stored row has the endpoint and who only
  assert.deepEqual(Object.keys((await q(`select * from public.chat_push_subs limit 1`))[0]).sort(), ['created_at', 'emp_id', 'endpoint', 'fails', 'id', 'last_ok_at', 'last_push_at']);
  // stop: only one's own; check clears somebody else's endpoint on this device (they did not log out)
  assert.equal((await ok('E6', { action: 'chat_push_unsub', endpoint: EP('E7') })).removed, 0);
  assert.equal((await ok('E7', { action: 'chat_push_check', endpoint: EP('E7') })).on, true);
  assert.deepEqual(await ok('E6', { action: 'chat_push_check', endpoint: EP('E7') }), { on: false, cleared: true });
  assert.equal((await q(`select count(*)::int n from public.chat_push_subs where endpoint = '${EP('E7')}'`))[0].n, 0);
  // the same endpoint saved by another person moves to them
  await ok('E8', { action: 'chat_push_sub', endpoint: EP('E7') });
  assert.equal((await q(`select emp_id from public.chat_push_subs where endpoint = '${EP('E7')}'`))[0].emp_id, 'E8');
  assert.equal((await ok('E8', { action: 'chat_push_unsub', endpoint: EP('E7') })).removed, 1);
  // a PIN-locked person can still stop push (log out), but not start it
  await ok('E8', { action: 'chat_pin_set', pin: '1357' });
  assert.equal((await call('E8', { action: 'chat_push_sub', endpoint: EP('E8') })).status, 423);
  assert.equal((await call('E8', { action: 'chat_push_unsub', endpoint: EP('E8') })).status, 200);
});

test('without the push keys: no push and starting push says push_off; before the SQL: the new actions say guard_old and chat still works', async () => {
  const a = await setup({ push: false });
  const g = await a.group('E7', ['E6']);
  assert.deepEqual(await a.ok('E7', { action: 'chat_push_key' }), { key: null });
  assert.deepEqual(await a.call('E6', { action: 'chat_push_sub', endpoint: EP('E6') }), { status: 503, body: { error: 'push_off' } });
  assert.equal((await a.send('E7', g.id, 'hi')).status, 200); await a.flush();
  assert.equal((await a.ok('E7', { action: 'whoami' })).push, false);
  const b = await setup({ guard: false });
  const g2 = await b.group('E7', ['E6']);
  for (const body of [{ action: 'chat_guard' }, { action: 'chat_pin_set', pin: '1234' }, { action: 'chat_pin_verify', pin: '1234' }, { action: 'chat_relock', mode: 'all' },
    { action: 'chat_key_set', thread: g2.id, key: 'abcd' }, { action: 'chat_push_sub', endpoint: EP('E6') }]) {
    assert.deepEqual(await b.call('E7', body), { status: 503, body: { error: 'guard_old' } }, body.action);
  }
  assert.equal((await b.call('E7', { action: 'chat_messages', thread: g2.id }, 'a'.repeat(64))).status, 200, 'the mark is ignored by the older SQL');
  assert.equal((await b.send('E6', g2.id, 'hi')).status, 200); await b.flush();
  assert.equal((await b.ok('E7', { action: 'whoami' })).chat, 3);
  // v1169（Codex #164 の P2）：キー付きのグループは、作るのとキーを 1 つの取引で（chat_create_group_k）。SQL がまだなら作らない（守りの無い会話を残さない）
  const before = (await b.q(`select count(*)::int n from public.chat_threads`))[0].n;
  assert.deepEqual(await b.call('E7', { action: 'chat_create_group', title: 'Later', members: ['E6'], client_key: b.key(), key: 'later-key' }),
    { status: 503, body: { error: 'fix_old' } }, 'no group without the key when the SQL is older');
  assert.equal((await b.q(`select count(*)::int n from public.chat_threads`))[0].n, before, 'nothing was made');
});

test('helpers: PIN and key shapes, PBKDF2 marks, push hosts, and the VAPID header signs for the endpoint origin and sends no body', async () => {
  assert.equal(PINV('０１２３'), '0123');
  assert.throws(() => PINV('123'));
  assert.throws(() => PINV(1234));
  assert.equal(KEYV('  Ｋｅｙ１  '), 'Key1');
  assert.throws(() => KEYV('a'.repeat(33)));
  const h = await secretMake('4321');
  assert.equal(h.iter, 150000); assert.match(h.salt, /^[0-9a-f]{32}$/); assert.match(h.hash, /^[0-9a-f]{64}$/);
  assert.equal(await secretOk('4321', h), true); assert.equal(await secretOk('4322', h), false);
  assert.notEqual((await secretMake('4321')).hash, h.hash, 'a new salt each time');
  for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QAB', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x'])
    assert.ok(PUSH_HOST.test(u), u);
  for (const u of ['https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'https://db.test/rest/v1/x', 'https://push.apple.com.evil/x', 'https://fcm.googleapis.com/a b'])
    assert.ok(!PUSH_HOST.test(u), u);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const b64u = b => Buffer.from(b).toString('base64url');
  const seen = [];
  const send = webPush({ fetch: async (u, o) => { seen.push([u, o]); return new Response(null, { status: 201 }); }, pub: b64u(raw), priv: jwk.d, subject: 'mailto:t@example.com' });
  assert.equal(await send('https://fcm.googleapis.com/fcm/send/abc'), 201);
  const [u, o] = seen[0];
  assert.equal(u, 'https://fcm.googleapis.com/fcm/send/abc'); assert.equal(o.body, undefined); assert.equal(o.redirect, 'manual');
  assert.equal(o.headers['Content-Length'], '0'); assert.equal(o.headers.TTL, '3600');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(o.headers.Authorization);
  assert.ok(m); assert.equal(m[4], b64u(raw));
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, 'mailto:t@example.com'); assert.ok(claims.exp > Date.now() / 1000);
  const okSig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(m[3], 'base64url'), new TextEncoder().encode(m[1] + '.' + m[2]));
  assert.equal(okSig, true);
});

test('defense in depth (each holds alone): a PIN opened before the last change, another person\'s mark, a stale key number, and the SQL steps checked without the function', async () => {
  const { ok, call, group, msgs, q, qx, db } = await setup();
  const g = await group('E7', ['E6', 'E8'], { key: 'deep-key' });
  // another person's mark does not open the key (E8 uses E7's mark)
  assert.equal((await msgs('E8', g.id, g.unlock)).status, 423, 'the mark is only for the person who opened it');
  assert.equal((await call('E8', { action: 'chat_files', thread: g.id }, g.unlock)).status, 423);
  // a mark row with an old key number (as if the cleanup missed it) does not open the new key
  const r8 = await ok('E8', { action: 'chat_key_verify', thread: g.id, key: 'deep-key' });
  const old = (await q(`select key_rev from public.chat_threads where id = '${g.id}'`))[0].key_rev;
  await ok('E7', { action: 'chat_key_set', thread: g.id, key: 'deep-key-2' }, g.unlock);
  await qx(`insert into public.chat_sess_keys(sess_id, thread_id, key_rev) select s.id, '${g.id}', ${old} from public.chat_sess s where s.emp_id = 'E8'`);
  assert.equal((await msgs('E8', g.id, r8.unlock)).status, 423, 'only the current key number opens it');
  // a PIN opened before the last change does not count (even if the mark still has the time)
  const t = (await ok('E6', { action: 'chat_pin_set', pin: '4321' })).unlock;
  assert.equal((await msgs('E6', g.id, t)).status, 423, 'the key is still needed');
  const dm = await ok('E6', { action: 'chat_open_dm', to: 'E8' }, t);
  assert.equal((await msgs('E6', dm.id, t)).status, 200);
  await qx(`update public.chat_sess set pin_at = now() - interval '1 hour' where emp_id = 'E6'; update public.chat_guard set pin_set_at = now() - interval '1 minute' where emp_id = 'E6'`);
  assert.equal((await msgs('E6', dm.id, t)).status, 423, 'opened before the PIN was changed');
  // the SQL steps alone (the function is skipped): set over an existing PIN, change or clear with a wrong number, an end after a change
  const w6 = { emp_id: 'E6', name: 'Sam Store' };
  const h = await secretMake('9999');
  await assert.rejects(db.rpc('chat_pin_save', { ...w6, mode: 'set', ...h }), /conflict/);
  const rev = (await q(`select rev from public.chat_guard where emp_id = 'E6'`))[0].rev;
  await assert.rejects(db.rpc('chat_pin_save', { ...w6, mode: 'change', rev: rev - 1, ...h }), /conflict/);
  await assert.rejects(db.rpc('chat_pin_save', { ...w6, mode: 'change', ...h }), /conflict/);
  await assert.rejects(db.rpc('chat_pin_save', { ...w6, mode: 'clear', rev: rev + 5 }), /conflict/);
  // missing fields are refused, not read as "nothing" (a missing value used to slip past a "<>" check)
  await assert.rejects(db.rpc('chat_pin_save', { ...w6, ...h }), /bad_value/);
  await assert.rejects(db.rpc('chat_pin_end', { ...w6, ok: true }), /bad_value/);
  await assert.rejects(db.rpc('chat_relock', { ...w6 }), /bad_value/);
  await assert.rejects(db.rpc('chat_key_save', { emp_id: 'E7', name: 'Lee Leader', thread: g.id, unlock: g.unlock }), /bad_value/, 'no clear flag');
  await assert.rejects(db.rpc('chat_key_end', { emp_id: 'E8', name: 'Cam Crew', thread: g.id, ok: true }), /bad_value/);
  assert.equal((await q(`select key_hash is not null k from public.chat_threads where id = '${g.id}'`))[0].k, true, 'the key is still there');
  const b = await db.rpc('chat_pin_begin', w6);
  await db.rpc('chat_pin_save', { ...w6, mode: 'change', rev: b.rev, ...h });   // changed on another device in between
  const e = await db.rpc('chat_pin_end', { ...w6, ok: true, rev: b.rev });
  assert.equal(e.ok, false); assert.equal(e.conflict, true); assert.equal(e.unlock, undefined, 'no mark for the old PIN');
  // the same for a key: an end after a change
  const kb = await db.rpc('chat_key_begin', { emp_id: 'E8', name: 'Cam Crew', thread: g.id });
  await ok('E7', { action: 'chat_key_set', thread: g.id, key: 'deep-key-3' }, g.unlock);
  const ke = await db.rpc('chat_key_end', { emp_id: 'E8', name: 'Cam Crew', thread: g.id, ok: true, rev: kb.rev });
  assert.equal(ke.ok, false); assert.equal(ke.conflict, true);
});

test('the SQL alone refuses push endpoints that are not browser push servers (the function checks too)', async () => {
  const { db } = await setup();
  for (const ep of ['https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com/' + 'a'.repeat(1000)])
    await assert.rejects(db.rpc('chat_push_save', { emp_id: 'E6', name: 'Sam Store', endpoint: ep }), /bad_value|check/, ep.slice(0, 40));
  assert.deepEqual(await db.rpc('chat_push_save', { emp_id: 'E6', name: 'Sam Store', endpoint: EP('E6') }), { on: true });
});

test('the function passes only a 64-hex mark to the SQL (anything else is dropped)', async () => {
  const { call, params, group } = await setup();
  const g = await group('E7', ['E6']);
  for (const [u, want] of [['a'.repeat(64), 'a'.repeat(64)], ['A'.repeat(64), undefined], ['a'.repeat(63), undefined], ['x', undefined], [123, undefined]]) {
    params.length = 0;
    await call('E7', { action: 'chat_messages', thread: g.id, unlock: u });
    const p = params.find(x => x[0] === 'chat_messages_get');
    assert.ok(p, 'reached the SQL'); assert.equal(p[1].unlock, want, String(u).slice(0, 8));
  }
});

test('push goes only to browser push servers even if a bad endpoint got into the table; the host rule is anchored', async () => {
  const { ok, send, group, pushed, flush, qx } = await setup();
  const g = await group('E7', ['E6', 'E8']);
  await ok('E6', { action: 'chat_push_sub', endpoint: EP('E6') });
  await qx(`insert into public.chat_push_subs(endpoint, emp_id) values ('https://169.254.169.254/latest/meta-data', 'E8'), ('https://evil.example.com/?https://fcm.googleapis.com/x', 'E8')`);
  assert.equal((await send('E7', g.id, 'hi')).status, 200); await flush();
  assert.deepEqual(pushed, [EP('E6')]);
  assert.ok(!PUSH_HOST.test('https://evil.example.com/?https://fcm.googleapis.com/x'));
  assert.ok(!PUSH_HOST.test('xhttps://fcm.googleapis.com/x'));
});

test('push needs both keys: with only the public key nothing is offered or sent', async () => {
  const { ok, call, send, group, flush, pushed } = await setup({ push: 'pub' });
  assert.deepEqual(await ok('E7', { action: 'chat_push_key' }), { key: null });
  assert.deepEqual(await call('E6', { action: 'chat_push_sub', endpoint: EP('E6') }), { status: 503, body: { error: 'push_off' } });
  const g = await group('E7', ['E6']);
  assert.equal((await send('E7', g.id, 'hi')).status, 200); await flush();
  assert.deepEqual(pushed, []);
});
