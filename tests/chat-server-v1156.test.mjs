// v1156 チャット（DM・グループ・申請の案件のチャット）。本物の SQL（申請 1 段目〜段階 2 ＋ チャット・PGlite）と本物の handler、合成データだけ。
// PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/CHAT_V1156_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, CHAT } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT_SQL = M('20261121090000_chat');

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E12', 'Hal Head', 'sl', 'Store Manager', 'S2', null],
  ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ chat = true, twice = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (chat) { await pg.exec(CHAT_SQL); if (twice) await pg.exec(CHAT_SQL); }
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'c-' + (++seq).toString().padStart(6, '0') + '-chat';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const send = (who, thread, text, extra = {}) => call(who, { action: 'chat_send', thread, body: text, client_key: extra.key || key(), mentions: extra.mentions });
  const msgs = (who, thread, extra = {}) => call(who, { action: 'chat_messages', thread, ...extra });
  const sync = (who, since) => ok(who, { action: 'chat_sync', since });
  return { pg, db, call, ok, key, send, msgs, sync };
}

test('the chat SQL comes after the work requests (stops first), runs twice, and before it the function says chat_missing', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(pg.exec(CHAT_SQL), /STOP/);
  assert.equal((await pg.query(`select count(*)::int n from pg_tables where tablename like 'chat\\_%'`)).rows[0].n, 0, 'nothing made');
  const { call } = await setup({ chat: false });
  const w = (await call('E8', { action: 'whoami' })).body;
  assert.equal(w.fn, 5); assert.equal(w.chat, 0);
  const r = await call('E8', { action: 'chat_sync' });
  assert.deepEqual([r.status, r.body.error], [503, 'chat_missing']);
  const s2 = await setup({ twice: true });
  assert.equal((await s2.call('E8', { action: 'whoami' })).body.chat, 1);
});

test('only the server key can run chat functions; the public key can read only the change signal (no names, no text)', async () => {
  const { pg, ok, send } = await setup();
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  assert.equal((await send('E8', dm.id, 'hi')).status, 200);
  await pg.exec('reset role; set role anon');
  for (const t of ['chat_threads', 'chat_members', 'chat_messages', 'chat_sig_owner']) await assert.rejects(pg.query(`select * from public.${t}`), /permission denied/, t);
  await assert.rejects(pg.query(`select public.chat_send('{}'::jsonb)`), /permission denied/);
  await assert.rejects(pg.query(`select public.chat_sync('{}'::jsonb)`), /permission denied/);
  const sig = (await pg.query('select * from public.chat_sig')).rows;
  assert.ok(sig.length >= 2);
  assert.deepEqual(Object.keys(sig[0]).sort(), ['at', 'n', 'token']);
  await assert.rejects(pg.query(`insert into public.chat_sig(token) values ('x')`), /permission denied/);
  await assert.rejects(pg.query(`update public.chat_sig set n = 0`), /permission denied/);
  await pg.exec('reset role');
});

test('DM: everyone can talk to anyone (3A); one conversation per pair; others cannot read it; the store tablet and retired people cannot', async () => {
  const { call, ok, send, msgs, sync, pg } = await setup();
  const a = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const b = await ok('E9', { action: 'chat_open_dm', to: 'E8' });
  assert.equal(a.id, b.id, 'the same pair always gets the same chat');
  assert.equal(a.kind, 'dm'); assert.equal(a.title, NAME.E9); assert.equal(b.title, NAME.E8, 'a DM is named after the other person');
  assert.equal((await call('E8', { action: 'chat_open_dm', to: 'E8' })).status, 400, 'not with yourself');
  assert.equal((await call('E8', { action: 'chat_open_dm', to: 'E404' })).status, 400, 'not with someone who does not exist');
  const m = await send('E8', a.id, 'こんにちは\n2 行目');
  assert.equal(m.status, 200); assert.equal(m.body.body, 'こんにちは\n2 行目'); assert.equal(m.body.seq, 1); assert.equal(m.body.mine, true); assert.equal(m.body.read, 0);
  let s9 = await sync('E9', 0);
  assert.equal(s9.unread, 1); assert.equal(s9.threads[0].unread, 1); assert.equal(s9.threads[0].preview.text, 'こんにちは 2 行目');
  assert.equal((await msgs('E6', a.id)).status, 404, 'a store manager cannot read two crew members’ DM');
  assert.equal((await msgs('E2', a.id)).status, 404, 'nor can the GM');
  assert.equal((await call('E2', { action: 'chat_add', thread: a.id, members: ['E6'], history: true })).status, 404, 'nobody is added to a DM');
  const got = (await msgs('E9', a.id)).body;
  assert.equal(got.messages.length, 1); assert.equal(got.messages[0].mine, false); assert.equal(got.messages[0].read, null, 'read counts only on your own messages');
  assert.equal((await ok('E9', { action: 'chat_read', thread: a.id, seq: 1 })).last_read, 1);
  assert.equal((await ok('E9', { action: 'chat_read', thread: a.id, seq: 0 })).last_read, 1, 'reading never goes back');
  s9 = await sync('E9', 0); assert.equal(s9.unread, 0);
  assert.equal((await msgs('E8', a.id)).body.messages[0].read, 1, 'the sender sees 既読 1');
  // a retired person or someone not in the employee table cannot use chat
  await pg.exec(`reset role; update public.employees set status = '退職' where id = 'E9'; set role service_role`);
  assert.equal((await call('E9', { action: 'chat_sync' })).status, 403);
  assert.equal((await call('E8', { action: 'chat_open_dm', to: 'E9' })).status, 200, 'the old DM still opens for the other person');
  assert.equal((await msgs('E8', a.id)).body.messages.length, 1);
  await pg.exec(`reset role; update public.employees set status = '退職' where id = 'E12'; set role service_role`);
  assert.equal((await call('E8', { action: 'chat_open_dm', to: 'E12' })).status, 400, 'no new DM with someone who has left');
  const tablet = await (await createHandler({ env: k => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' })[k], db: { rpc: async () => { throw new Error('never'); } },
    verifyPin: async () => ({ name: 'S1 tablet' }) }))(new Request('https://fn.test/x', { method: 'POST', body: JSON.stringify({ action: 'chat_sync', pin_session: 'store' }) }));
  assert.equal(tablet.status, 401, 'a store login (no employee) cannot use chat');
});

test('sending: one message per key (a re-send after a lost answer is the same message), text is checked, mentions must be members', async () => {
  const { call, ok, send, msgs, key } = await setup();
  const g = await ok('E6', { action: 'chat_create_group', title: 'S1 リーダー', members: ['E7', 'E8'], client_key: key() });
  const k = key();
  const a = await send('E7', g.id, '在庫の確認', { key: k });
  const b = await send('E7', g.id, '在庫の確認', { key: k });
  assert.equal(a.body.id, b.body.id); assert.equal(b.body.replay, true);
  assert.equal((await msgs('E6', g.id)).body.messages.length, 1);
  const other = await ok('E7', { action: 'chat_open_dm', to: 'E6' });
  assert.equal((await send('E7', other.id, 'x', { key: k })).status, 409, 'the same key in another chat is refused');
  assert.equal((await send('E7', g.id, '   ')).status, 400);
  assert.equal((await send('E7', g.id, 'x'.repeat(CHAT.body + 1))).status, 400, 'too long is refused, never cut');
  assert.equal((await send('E7', g.id, 'x'.repeat(CHAT.body))).status, 200);
  assert.equal((await send('E7', g.id, 'a\u0007b')).body.body, 'ab', 'control characters are dropped');
  assert.equal((await call('E7', { action: 'chat_send', thread: g.id, body: 'x', client_key: 'bad key!' })).status, 400);
  const nm = await send('E7', g.id, '@Kai 見て', { mentions: ['E9'] });
  assert.deepEqual([nm.status, nm.body.error], [409, 'not_member'], 'the app then asks whether to add the person');
  assert.equal((await send('E9', g.id, 'x')).status, 404, 'a non-member cannot write');
  const mm = await send('E7', g.id, '@Cam お願い', { mentions: ['E8'] });
  assert.deepEqual(mm.body.mentions, ['E8']);
  const s8 = await ok('E8', { action: 'chat_sync' });
  assert.equal(s8.mention, 1);
  const mine = await ok('E8', { action: 'chat_mentions' });
  assert.equal(mine.items.length, 1); assert.equal(mine.items[0].thread, g.id); assert.equal(mine.items[0].unread, true); assert.equal(mine.items[0].thread_title, 'S1 リーダー');
});

test('groups: made by anyone with 1–49 others; add with or without history; rename by version; leave; remove by the maker or GM/CEO; at most 50', async () => {
  const { call, ok, send, msgs, sync, key, pg } = await setup();
  const k = key();
  const g = await ok('E8', { action: 'chat_create_group', title: '  シフトの相談  ', members: ['E7', 'E8', 'E7'], client_key: k });
  assert.equal(g.title, 'シフトの相談'); assert.equal(g.members, 2, 'the maker plus E7 (duplicates and the maker are dropped)');
  const again = await ok('E8', { action: 'chat_create_group', title: 'シフトの相談', members: ['E7'], client_key: k });
  assert.equal(again.id, g.id); assert.equal(again.replay, true);
  assert.equal((await call('E7', { action: 'chat_create_group', title: 'x', members: ['E8'], client_key: k })).status, 409, 'someone else’s key');
  assert.equal((await call('E8', { action: 'chat_create_group', title: '', members: ['E7'], client_key: key() })).status, 400);
  assert.equal((await call('E8', { action: 'chat_create_group', title: 'x', members: [], client_key: key() })).status, 400);
  assert.equal((await call('E8', { action: 'chat_create_group', title: 'x', members: ['E404'], client_key: key() })).status, 400);
  await send('E8', g.id, '1 つ目'); await send('E7', g.id, '2 つ目');
  // add without the past messages: E9 sees only what comes next
  assert.equal((await ok('E7', { action: 'chat_add', thread: g.id, members: ['E9'], history: false })).added, 1);
  assert.equal((await msgs('E9', g.id)).body.messages.length, 0);
  await send('E8', g.id, '3 つ目');
  assert.deepEqual((await msgs('E9', g.id)).body.messages.map(x => x.body), ['3 つ目']);
  assert.equal((await sync('E9', 0)).threads[0].unread, 1, 'only what E9 can read counts as unread');
  // add with the past messages
  await ok('E8', { action: 'chat_add', thread: g.id, members: ['E12'], history: true });
  assert.deepEqual((await msgs('E12', g.id)).body.messages.map(x => x.body), ['1 つ目', '2 つ目', '3 つ目']);
  assert.equal((await call('E6', { action: 'chat_add', thread: g.id, members: ['E5'], history: true })).status, 404, 'a non-member cannot add');
  // rename by version
  const r1 = await ok('E9', { action: 'chat_rename', thread: g.id, title: 'S1・S2 シフト', expect_rev: 1 });
  assert.equal(r1.title, 'S1・S2 シフト'); assert.equal(r1.rev, 2);
  assert.equal((await call('E7', { action: 'chat_rename', thread: g.id, title: '古い画面', expect_rev: 1 })).status, 409, 'an old screen does not overwrite');
  // leave and remove
  assert.equal((await call('E9', { action: 'chat_remove', thread: g.id, emp: 'E12' })).status, 403, 'only the maker or GM/CEO removes others');
  assert.equal((await ok('E9', { action: 'chat_remove', thread: g.id, emp: 'E9' })).removed, 1, 'anyone can leave');
  assert.equal((await msgs('E9', g.id)).status, 404);
  const s9 = await sync('E9', 0); assert.deepEqual(s9.gone, [g.id], 'the app drops it from the list');
  assert.equal((await ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E12' })).removed, 1);
  assert.equal((await call('E12', { action: 'chat_messages', thread: g.id })).status, 404);
  assert.equal((await ok('E2', { action: 'chat_open_dm', to: 'E8' })).kind, 'dm');
  assert.equal((await call('E2', { action: 'chat_remove', thread: g.id, emp: 'E7' })).status, 404, 'GM must be in the group to remove from it');
  await ok('E8', { action: 'chat_add', thread: g.id, members: ['E2'], history: true });
  assert.equal((await ok('E2', { action: 'chat_remove', thread: g.id, emp: 'E7' })).removed, 1, 'GM removes');
  // at most 50 people
  await pg.exec('reset role');
  for (let i = 100; i < 160; i++) await pg.query(`insert into employees values($1,$2,'crew','Crew','S1','[]','在籍','{}')`, ['E' + i, 'P' + i]);
  await pg.exec('set role service_role');
  const big = await call('E8', { action: 'chat_create_group', title: 'big', members: Array.from({ length: 50 }, (_, i) => 'E' + (100 + i)), client_key: key() });
  assert.equal(big.status, 400, '50 others + the maker is too many');
  const g2 = await ok('E8', { action: 'chat_create_group', title: 'ok', members: Array.from({ length: 49 }, (_, i) => 'E' + (100 + i)), client_key: key() });
  assert.equal(g2.members, 50);
  const tm = await call('E8', { action: 'chat_add', thread: g2.id, members: ['E150'], history: false });
  assert.deepEqual([tm.status, tm.body.error], [409, 'too_many']);
});

test('edit (author, 24 hours), delete (author), hide (GM/CEO with a reason; text stays on the server only)', async () => {
  const { call, ok, send, msgs, sync, key, pg } = await setup();
  const g = await ok('E2', { action: 'chat_create_group', title: '本部', members: ['E6', 'E8'], client_key: key() });
  const m = (await send('E8', g.id, '最初の文')).body;
  assert.equal(m.can_edit, true); assert.equal(m.can_delete, true); assert.equal(m.can_hide, false);
  assert.equal((await call('E6', { action: 'chat_edit', id: m.id, body: 'x' })).status, 403, 'only the author edits');
  const e = await ok('E8', { action: 'chat_edit', id: m.id, body: '直した文' });
  assert.equal(e.body, '直した文'); assert.equal(e.edited, true);
  const seen = (await msgs('E6', g.id)).body.messages[0];
  assert.equal(seen.body, '直した文'); assert.equal(seen.edited, true); assert.equal(seen.can_hide, false, 'a store manager cannot hide');
  assert.ok(!('edits' in seen), 'earlier text is not sent to the app');
  await pg.query(`update public.chat_messages set created_at = now() - interval '25 hours' where id = $1`, [m.id]);
  const late = await call('E8', { action: 'chat_edit', id: m.id, body: 'もう一度' });
  assert.deepEqual([late.status, late.body.error], [409, 'too_late']);
  assert.equal((await msgs('E8', g.id)).body.messages[0].can_edit, false);
  // hide
  const gmView = (await msgs('E2', g.id)).body.messages[0];
  assert.equal(gmView.can_hide, true);
  const nr = await call('E2', { action: 'chat_hide', id: m.id, hide: true, reason: '' });
  assert.deepEqual([nr.status, nr.body.error], [400, 'reason_required']);
  assert.equal((await call('E6', { action: 'chat_hide', id: m.id, hide: true, reason: 'x' })).status, 403);
  const h = await ok('E2', { action: 'chat_hide', id: m.id, hide: true, reason: '個人の情報' });
  assert.equal(h.hidden, true); assert.equal(h.body, null); assert.equal(h.hidden_name, NAME.E2);
  const v8 = (await msgs('E8', g.id)).body.messages[0];
  assert.equal(v8.body, null); assert.equal(v8.hidden, true); assert.equal(v8.can_delete, false, 'a hidden message stays as a record');
  assert.equal((await call('E8', { action: 'chat_delete', id: m.id })).status, 409);
  assert.equal((await sync('E6', 0)).threads[0].preview.text, '（見えなくなりました）');
  const row = (await pg.query('select body, hidden_reason from public.chat_messages where id = $1', [m.id])).rows[0];
  assert.deepEqual(row, { body: '直した文', hidden_reason: '個人の情報' }, 'the server keeps the text and why');
  const own = (await send('E2', g.id, 'GM の文')).body;
  assert.equal((await call('E2', { action: 'chat_hide', id: own.id, hide: true, reason: 'x' })).status, 403, 'not your own message (delete it instead)');
  assert.equal((await ok('E1', { action: 'chat_open_dm', to: 'E2' })).kind, 'dm');
  assert.equal((await call('E1', { action: 'chat_hide', id: m.id, hide: false })).status, 404, 'the CEO must be in the chat');
  const back = await ok('E2', { action: 'chat_hide', id: m.id, hide: false, reason: '' });
  assert.equal(back.body, '直した文');
  // delete: the text and earlier versions are gone from the server
  const d = await ok('E8', { action: 'chat_delete', id: m.id });
  assert.equal(d.deleted, true); assert.equal(d.body, null);
  assert.deepEqual((await pg.query('select body, edits from public.chat_messages where id = $1', [m.id])).rows[0], { body: null, edits: [] });
  assert.equal((await ok('E8', { action: 'chat_delete', id: m.id })).deleted, true, 'twice is fine');
  assert.equal((await call('E2', { action: 'chat_hide', id: m.id, hide: true, reason: 'x' })).status, 409);
  assert.equal((await sync('E6', 0)).threads[0].preview.text, 'GM の文');
});

test('case chat (4A): the requester and the deciders join on their own; others need an invite; a deciding role that leaves loses it; added people keep it', async () => {
  const { call, ok, send, msgs, sync, key, pg } = await setup();
  const r = (await ok('E7', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-01', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 } }));
  assert.equal((await call('E8', { action: 'chat_case', id: r.id })).status, 404, 'another crew member of the store cannot see the request');
  const c8 = await ok('E7', { action: 'chat_case', id: r.id });
  assert.equal(c8.can_open, true); assert.equal(c8.thread.kind, 'case'); assert.equal(c8.thread.ref.code, r.code);
  const mem = (await msgs('E7', c8.thread.id)).body.members.map(x => x.emp).sort();
  assert.deepEqual(mem, ['E1', 'E13', 'E2', 'E3', 'E7'], 'requester, CEO, GM, accounting and office crew (money kind)');
  assert.equal((await ok('E2', { action: 'chat_case', code: r.code })).thread.id, c8.thread.id, 'one chat per request');
  // a store manager who can see the request but is not a decider
  const c6 = await ok('E6', { action: 'chat_case', id: r.id });
  assert.deepEqual(c6, { thread: null, can_open: false });
  assert.equal((await call('E9', { action: 'chat_case', id: r.id })).status, 404, 'someone who cannot see the request');
  await send('E2', c8.thread.id, '@Lee 領収書を見せてください', { mentions: ['E7'] });
  assert.equal((await ok('E7', { action: 'chat_mentions' })).items[0].thread_kind, 'case');
  // GM adds the store manager (GM can add even without being in the chat on a case they can see)
  await ok('E2', { action: 'chat_add', thread: c8.thread.id, members: ['E6'], history: true });
  assert.equal((await msgs('E6', c8.thread.id)).body.messages.length, 1);
  assert.equal((await ok('E6', { action: 'chat_case', id: r.id })).thread.id, c8.thread.id);
  // accounting loses the role: no longer sees the request, so no longer in the chat
  await pg.exec(`reset role; delete from public.manager_auth where emp_id = 'E3'; set role service_role`);
  assert.equal((await msgs('E3', c8.thread.id)).status, 404);
  assert.equal((await sync('E3', 0)).threads.length, 0);
  // a removed decider is not added back on the next message
  assert.equal((await ok('E2', { action: 'chat_remove', thread: c8.thread.id, emp: 'E13' })).removed, 1);
  await send('E7', c8.thread.id, '送りました');
  assert.equal((await msgs('E13', c8.thread.id)).status, 404);
  assert.equal((await call('E7', { action: 'chat_remove', thread: c8.thread.id, emp: 'E7' })).status, 403, 'nobody leaves a case chat on their own');
  assert.equal((await call('E2', { action: 'chat_rename', thread: c8.thread.id, title: 'x', expect_rev: 1 })).status, 403, 'a case chat is named after the request');
  // a request without a chat: someone who is not a decider does not make one
  const r2 = (await ok('E6', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-02', payer: NAME.E6, payer_is_employee: true, vendor: 'Target', purpose: '備品', amount_cents: 1200 } }));
  assert.deepEqual(await ok('E5', { action: 'chat_case', id: r2.id }), { thread: null, can_open: false }, 'the AM can see it but is not a decider of a reimbursement');
  assert.equal((await pg.query('select count(*)::int n from public.chat_threads where ref_id = $1', [r2.id])).rows[0].n, 0);
});

test('sync: only changed chats after the cursor; the change signal moves for the members only', async () => {
  const { ok, send, sync, key, pg } = await setup();
  const a = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const g = await ok('E6', { action: 'chat_create_group', title: 'g', members: ['E8'], client_key: key() });
  const s1 = await sync('E8', 0);
  assert.equal(s1.threads.length, 2); assert.match(s1.token, /^[0-9a-f]{64}$/); assert.equal(s1.me, 'E8');
  assert.equal((await sync('E8', 0)).token, s1.token, 'the token stays the same');
  assert.equal((await sync('E8', s1.cursor)).threads.length, 0);
  const n = async tok => (await pg.query('select n from public.chat_sig where token = $1', [tok])).rows[0].n;
  const t9 = (await sync('E9', 0)).token, t6 = (await sync('E6', 0)).token;
  const [b8, b9, b6] = [await n(s1.token), await n(t9), await n(t6)];
  await send('E9', a.id, 'hello');
  assert.equal(await n(s1.token), b8 + 1); assert.equal(await n(t9), b9 + 1);
  assert.equal(await n(t6), b6, 'not in the DM: no signal');
  const s2 = await sync('E8', s1.cursor);
  assert.deepEqual(s2.threads.map(x => x.id), [a.id]); assert.ok(s2.cursor > s1.cursor);
  // reading moves only the reader’s own signal and row; the others see the read count next time they look
  await ok('E8', { action: 'chat_read', thread: a.id, seq: 1 });
  assert.equal(await n(t9), b9 + 1, 'no signal to the other person for a read');
  assert.equal((await sync('E8', s2.cursor)).threads[0].unread, 0, 'my own other devices see it');
  void g;
});
