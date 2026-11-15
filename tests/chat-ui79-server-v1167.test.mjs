// v1167 チャット改修（UI案79・Moto さん 11/14 の答え 1〜6 A）：参加者だけ・申請のチャットは最初に参加者を選んで作る・管理する人・前からある会話の移し替え。
// 本物の SQL（申請 1 段目〜段階 2 ＋ チャット ＋ 添付 ＋ この SQL・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。
// 仕様：docs/CHAT_UI79_V1167_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT_SQL = M('20261121090000_chat');
const FILES_SQL = M('20261124090000_chat_files');
export const UI79_SQL = M('20261127090000_chat_ui79');

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E12', 'Hal Head', 'sl', 'Store Manager', 'S2', null],
  ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ ui79 = true, twice = false, files = true } = {}) {
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
  await pg.exec(CHAT_SQL);
  if (files) await pg.exec(FILES_SQL);
  if (ui79) { await pg.exec(UI79_SQL); if (twice) await pg.exec(UI79_SQL); }
  // v1168：CHAT_WITH_GUARD=1 なら守りの SQL も（暗証番号・キーを決めていなければ v1167 と同じに動くか）
  if (ui79 && process.env.CHAT_WITH_GUARD === '1') await pg.exec(M('20261128090000_chat_guard'));
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'u-' + (++seq).toString().padStart(6, '0') + '-ui79';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const send = (who, thread, text, extra = {}) => call(who, { action: 'chat_send', thread, body: text, client_key: extra.key || key(), mentions: extra.mentions });
  const msgs = (who, thread, extra = {}) => call(who, { action: 'chat_messages', thread, ...extra });
  const sync = (who, since) => ok(who, { action: 'chat_sync', since });
  let nreq = 0;
  const submit = async (who, extra = {}) => { nreq++;
    const r = await ok(who, { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
      payload: { date: '2026-11-0' + Math.min(9, nreq), payer: NAME[who], payer_is_employee: true, vendor: 'Costco ' + nreq, purpose: '仕入れ', amount_cents: 8640 + nreq, ...extra } });
    assert.ok(r && r.id, 'submitted ' + JSON.stringify(r).slice(0, 200)); return r; };
  const applyUi79 = async () => { await pg.exec('reset role'); await pg.exec(UI79_SQL); await pg.exec('set role service_role'); };
  return { pg, db, call, ok, key, send, msgs, sync, submit, applyUi79 };
}

test('the SQL needs chat and attachments first (STOP, nothing changed), runs twice, says chat 3, and the function is fn 9', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(pg.exec(UI79_SQL), /STOP: 先にチャット/);
  assert.equal((await pg.query(`select count(*)::int n from pg_proc where proname = 'chat_case_create'`)).rows[0].n, 0);
  const { ok, pg: pg2 } = await setup({ twice: true });
  const me = await ok('E7', { action: 'whoami' });
  assert.ok(me.fn >= 9, 'fn 9 or later'); assert.equal(me.chat, process.env.CHAT_WITH_GUARD === '1' ? 4 : 3);   // v1168 の関数は fn 10・守りの SQL は chat 4
  // only the server key may run the new functions
  for (const fn of ['chat_case_create(jsonb)', 'chat_admin(jsonb)', 'chat_admin_fix(uuid)']) {
    const r = (await pg2.query(`select has_function_privilege('anon', 'public.${fn}', 'execute') a, has_function_privilege('authenticated', 'public.${fn}', 'execute') b, has_function_privilege('service_role', 'public.${fn}', 'execute') c`)).rows[0];
    assert.deepEqual(r, { a: false, b: false, c: true }, fn);
  }
});

test('before the SQL, the new actions say chat_old (503); old case chats still work', async () => {
  const { call, ok, submit } = await setup({ ui79: false });
  const r = await submit('E7');
  assert.deepEqual(await call('E7', { action: 'chat_case_create', id: r.id, members: [], client_key: 'kkkkkkkk-1' }), { status: 503, body: { error: 'chat_old' } });
  assert.equal((await call('E7', { action: 'chat_admin', thread: '00000000-0000-4000-8000-000000000000', emp: 'E2', admin: true })).status, 503);
  assert.equal((await ok('E7', { action: 'whoami' })).chat, 2);
});

test('moving the old chats: auto members who can read now stay, the others leave; the maker manages; nobody reads more than before', async () => {
  const { pg, ok, call, send, msgs, sync, submit, applyUi79 } = await setup({ ui79: false });
  const r = await submit('E7');
  const c = await ok('E7', { action: 'chat_case', id: r.id });   // 前の版（4A）：自動で入る
  const tid = c.thread.id;
  assert.equal((await send('E7', tid, '領収書あります')).status, 200);
  await ok('E2', { action: 'chat_add', thread: tid, members: ['E6'], history: true });   // 前の版：GM が加えた
  await pg.exec(`reset role; delete from public.manager_auth where emp_id = 'E3'; set role service_role`);   // 経理の役を外す＝もう読めない
  assert.equal((await msgs('E3', tid)).status, 404, 'before: E3 could not read');
  const listed = (await msgs('E7', tid)).body.members.map(x => x.emp).sort();
  assert.deepEqual(listed, ['E1', 'E13', 'E2', 'E3', 'E6', 'E7'], 'before: E3 was listed although E3 could not read');
  const before = [];
  for (const e of listed) if ((await msgs(e, tid)).status === 200) before.push(e);
  assert.deepEqual(before, ['E1', 'E13', 'E2', 'E6', 'E7']);
  await applyUi79();
  const after = (await msgs('E7', tid)).body;
  assert.deepEqual(after.members.map(x => x.emp).sort(), before, 'the same people read it (E3 left)');
  assert.ok(after.members.every(x => x.auto === false));
  assert.equal(after.members.find(x => x.emp === 'E7').admin, true, 'the maker manages it');
  assert.equal(after.members.filter(x => x.admin).length, 1);
  assert.equal((await msgs('E3', tid)).status, 404, 'E3 still cannot read');
  const e3 = await sync('E3', 0);
  assert.equal(e3.threads.length, 0);
  // E3 gets the role back: under the new rule the role alone does not let them in
  await pg.exec(`reset role; insert into public.manager_auth(role, emp_id) values ('office','E3'); set role service_role`);
  assert.equal((await msgs('E3', tid)).status, 404, 'a role alone does not open a conversation');
  assert.deepEqual(await ok('E3', { action: 'chat_case', id: r.id }), { thread: null, can_open: false, exists: true }, 'only that it exists (no title, no count)');
  // running it again changes nothing
  await applyUi79();
  assert.deepEqual((await msgs('E7', tid)).body.members.map(x => x.emp + ':' + x.admin).sort(), after.members.map(x => x.emp + ':' + x.admin).sort());
  assert.equal((await call('E1', { action: 'chat_messages', thread: tid })).status, 200, 'CEO was an auto member who could read: stays');
});

test('a new request chat: the first opener picks people (the related people come pre-picked and can be taken off); one chat per request', async () => {
  const { pg, ok, call, send, msgs, submit } = await setup();
  const r = await submit('E7');
  const pre = await ok('E7', { action: 'chat_case', id: r.id });
  assert.equal(pre.thread, null); assert.equal(pre.can_create, true); assert.equal(pre.exists, false); assert.equal(pre.code, r.code);
  assert.deepEqual(pre.candidates.map(x => x.emp).sort(), ['E1', 'E13', 'E2', 'E3'], 'the related people (not me)');
  assert.ok(pre.candidates.every(x => x.pre === true && x.name));
  assert.equal(pre.title, '仕入れ');
  assert.equal((await pg.query('select count(*)::int n from public.chat_threads where ref_id = $1', [r.id])).rows[0].n, 0, 'opening alone makes nothing');
  // E7 takes CEO, accounting and office crew off and adds the store manager
  const t = await ok('E7', { action: 'chat_case_create', id: r.id, title: '領収書の確認', members: ['E2', 'E6'], client_key: 'case-key-0001' });
  assert.equal(t.kind, 'case'); assert.equal(t.title, '領収書の確認'); assert.equal(t.admin, true); assert.equal(t.members, 3);
  assert.equal(t.ref.code, r.code);
  const again = await ok('E7', { action: 'chat_case_create', id: r.id, title: 'x', members: [], client_key: 'case-key-0001' });
  assert.equal(again.id, t.id); assert.equal(again.replay, true, 'the same key is the same chat');
  // someone else who also sees the request, at the same time with another key
  assert.deepEqual(await call('E1', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0002' }), { status: 409, body: { error: 'case_exists' } });
  assert.equal((await ok('E2', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0003' })).existing, true, 'a member gets the same chat');
  assert.equal((await pg.query('select count(*)::int n from public.chat_threads where ref_id = $1', [r.id])).rows[0].n, 1);
  // not a member: the CEO sees only that it exists
  assert.deepEqual(await ok('E1', { action: 'chat_case', id: r.id }), { thread: null, can_open: false, exists: true });
  assert.equal((await msgs('E1', t.id)).status, 404);
  assert.equal((await send('E1', t.id, 'hi')).status, 404);
  assert.equal((await ok('E1', { action: 'chat_sync', since: 0 })).threads.length, 0);
  // someone who cannot see the request cannot start or open it
  assert.equal((await call('E8', { action: 'chat_case', id: r.id })).status, 404);
  assert.equal((await call('E8', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0004' })).status, 404);
  // a chat with nobody else (all taken off) is allowed
  const r2 = await submit('E6', { purpose: '備品' });
  const t2 = await ok('E6', { action: 'chat_case_create', id: r2.id, members: [], client_key: 'case-key-0005' });
  assert.equal(t2.members, 1); assert.equal(t2.title, '備品', 'empty title: the request purpose');
  // bad input
  assert.equal((await call('E6', { action: 'chat_case_create', id: r2.id, members: 'E2', client_key: 'case-key-0006' })).status, 400);
  assert.equal((await call('E6', { action: 'chat_case_create', id: r2.id, members: [], client_key: 'short' })).status, 400);
  assert.equal((await call('E6', { action: 'chat_case_create', id: r2.id, members: Array.from({ length: 50 }, (_, i) => 'E' + i), client_key: 'case-key-0007' })).status, 400);
  // racing two first openers: still one chat
  const r3 = await submit('E7', { purpose: '同時' });
  const [a, b] = await Promise.all([
    call('E7', { action: 'chat_case_create', id: r3.id, members: ['E2'], client_key: 'case-key-0008' }),
    call('E2', { action: 'chat_case_create', id: r3.id, members: ['E7'], client_key: 'case-key-0009' }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200], 'each picked the other, so the second gets the same chat');
  assert.equal(a.body.id, b.body.id);
  assert.equal((await pg.query('select count(*)::int n from public.chat_threads where ref_id = $1', [r3.id])).rows[0].n, 1);
});

test('an invitation or a mention does not open the request itself; the chat row hides the request from people who cannot see it', async () => {
  const { ok, call, send, msgs, submit } = await setup();
  const r = await submit('E7');
  const t = await ok('E7', { action: 'chat_case_create', id: r.id, members: ['E9'], client_key: 'case-key-0101' });
  assert.equal((await send('E7', t.id, '@Kai 写真ください', { mentions: ['E9'] })).status, 200);
  const m9 = await msgs('E9', t.id);
  assert.equal(m9.status, 200); assert.equal(m9.body.messages.length, 1);
  assert.equal(m9.body.thread.ref, null, 'no request number, kind, status or store');
  assert.equal(m9.body.thread.title, '仕入れ', 'only the chat title the maker chose');
  assert.equal((await call('E9', { action: 'get', id: r.id })).status, 404, 'still cannot open the request');
  assert.equal((await call('E9', { action: 'chat_case', id: r.id })).status, 404);
  const row9 = (await ok('E9', { action: 'chat_sync', since: 0 })).threads[0];
  assert.equal(row9.ref, null);
  assert.equal((await ok('E9', { action: 'chat_mentions' })).items.length, 1);
});

test('GM and CEO: no reading, adding or hiding in conversations they are not in; hiding works where they are a member', async () => {
  const { ok, call, send, msgs } = await setup();
  const g = await ok('E8', { action: 'chat_create_group', title: 'S1 kitchen', members: ['E6'], client_key: 'grp-key-0001' });
  const m = (await send('E8', g.id, 'hello')).body;
  for (const who of ['E1', 'E2']) {
    assert.equal((await msgs(who, g.id)).status, 404, who + ' read');
    assert.equal((await call(who, { action: 'chat_add', thread: g.id, members: [who], history: true })).status, 404, who + ' self-add');
    assert.equal((await call(who, { action: 'chat_hide', id: m.id, hide: true, reason: 'x' })).status, 404, who + ' hide');
    assert.equal((await call(who, { action: 'chat_remove', thread: g.id, emp: 'E6' })).status, 404, who + ' remove');
  }
  await ok('E8', { action: 'chat_add', thread: g.id, members: ['E2'], history: true });
  const h = await ok('E2', { action: 'chat_hide', id: m.id, hide: true, reason: '個人の電話番号' });
  assert.equal(h.hidden, true);
  assert.equal((await msgs('E6', g.id)).body.messages[0].body, null);
});

test('managing people: only managers add, remove, rename and choose managers; anyone may leave; the last manager stays; DM has none', async () => {
  const { ok, call, msgs } = await setup();
  const g = await ok('E8', { action: 'chat_create_group', title: 'Prep', members: ['E9', 'E6'], client_key: 'grp-key-0201' });
  assert.equal(g.admin, true);
  const m = (await msgs('E9', g.id)).body;
  assert.deepEqual([m.can_add, m.can_remove, m.can_rename, m.can_admin, m.can_leave], [false, false, false, false, true]);
  assert.deepEqual(m.members.filter(x => x.admin).map(x => x.emp), ['E8']);
  assert.equal((await call('E9', { action: 'chat_add', thread: g.id, members: ['E12'], history: true })).status, 403);
  assert.equal((await call('E9', { action: 'chat_remove', thread: g.id, emp: 'E6' })).status, 403);
  assert.equal((await call('E9', { action: 'chat_rename', thread: g.id, title: 'x', expect_rev: 1 })).status, 403);
  assert.equal((await call('E9', { action: 'chat_admin', thread: g.id, emp: 'E9', admin: true })).status, 403);
  assert.equal((await call('E8', { action: 'chat_admin', thread: g.id, emp: 'E8', admin: false })).status, 409, 'the last manager');
  assert.equal((await call('E8', { action: 'chat_admin', thread: g.id, emp: 'E8', admin: false })).body.error, 'last_admin');
  assert.equal((await call('E8', { action: 'chat_admin', thread: g.id, emp: 'E12', admin: true })).status, 409, 'not a member');
  assert.equal((await call('E8', { action: 'chat_admin', thread: g.id, emp: 'E6', admin: 'yes' })).status, 400);
  assert.deepEqual(await ok('E8', { action: 'chat_admin', thread: g.id, emp: 'E6', admin: true }), { emp: 'E6', admin: true });
  await ok('E6', { action: 'chat_add', thread: g.id, members: ['E12'], history: false });
  assert.equal((await msgs('E12', g.id)).status, 200);
  await ok('E6', { action: 'chat_rename', thread: g.id, title: 'Prep team', expect_rev: 1 });
  assert.equal((await ok('E6', { action: 'chat_remove', thread: g.id, emp: 'E12' })).removed, 1);
  assert.equal((await msgs('E12', g.id)).status, 404);
  // both managers leave: the earliest remaining member manages it
  assert.equal((await ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E8' })).removed, 1);
  assert.equal((await ok('E6', { action: 'chat_remove', thread: g.id, emp: 'E6' })).removed, 1);
  const left = (await msgs('E9', g.id)).body;
  assert.deepEqual(left.members.map(x => x.emp + ':' + x.admin), ['E9:true']);
  assert.equal(left.can_add, true);
  // a case chat member may leave now (people are chosen, not automatic)
  // DM: no managers, no adding
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  assert.equal((await call('E8', { action: 'chat_admin', thread: dm.id, emp: 'E9', admin: true })).status, 403);
  assert.equal((await call('E8', { action: 'chat_add', thread: dm.id, members: ['E6'], history: true })).status, 403);
  assert.equal((await call('E8', { action: 'chat_remove', thread: dm.id, emp: 'E8' })).status, 403);
  assert.equal(dm.admin, false);
});

test('mentions: several people at once, members only (a removed or never-added person is refused)', async () => {
  const { ok, send } = await setup();
  const g = await ok('E8', { action: 'chat_create_group', title: 'Mentions', members: ['E9', 'E6', 'E12'], client_key: 'grp-key-0301' });
  const s = await send('E8', g.id, '@Kai @Sam @Hal 明日の準備', { mentions: ['E9', 'E6', 'E12'] });
  assert.equal(s.status, 200); assert.deepEqual(s.body.mentions.sort(), ['E12', 'E6', 'E9']);
  for (const who of ['E9', 'E6', 'E12']) assert.equal((await ok(who, { action: 'chat_mentions' })).items.length, 1, who);
  assert.equal((await send('E8', g.id, '@Ami', { mentions: ['E5'] })).body.error, 'not_member');
  await ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E12' });
  assert.equal((await send('E8', g.id, '@Hal', { mentions: ['E12'] })).body.error, 'not_member');
  assert.equal((await ok('E12', { action: 'chat_mentions' })).items.length, 0, 'a removed person no longer sees the mention');
});

test('an automatic row left over (old SQL run again) cannot read until someone adds the person; the old auto-sync does nothing', async () => {
  const { pg, ok, msgs, send, submit, sync } = await setup();
  const r = await submit('E7');
  const t = await ok('E7', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0401' });
  await send('E7', t.id, 'first');
  await pg.exec(`reset role; insert into public.chat_members(thread_id, emp_id, auto, added_by) values ('${t.id}', 'E2', true, 'auto'); set role service_role`);
  assert.equal((await msgs('E2', t.id)).status, 404);
  assert.equal((await sync('E2', 0)).threads.length, 0);
  assert.equal((await msgs('E7', t.id)).body.members.length, 1, 'not counted');
  assert.equal((await send('E7', t.id, '@Gabe', { mentions: ['E2'] })).body.error, 'not_member');
  assert.equal(await pg.query(`select public.chat_case_sync(r, t) v from public.wr_requests r, public.chat_threads t where r.id = $1 and t.id = $2`, [r.id, t.id]).then(x => x.rows[0].v), 0);
  await ok('E7', { action: 'chat_add', thread: t.id, members: ['E2'], history: false });
  const m2 = await msgs('E2', t.id);
  assert.equal(m2.status, 200); assert.equal(m2.body.messages.length, 0, 'added now without the earlier messages');
});
