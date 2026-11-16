// v1169：Codex の blocked の P2（#161〜#164）のサーバーの直し。仕様：docs/FIXES_V1169_JA.md
// 本物の SQL（申請 1 段目〜段階 2 ＋ チャット ＋ 添付 ＋ UI案79 ＋ 守り ＋ この直し・PGlite）と本物の handler、合成データだけ。
// 直す前のコードで落ちることを確かめるとき：WR_HANDLER=<v1168 の handler.mjs>（関数）／ FIX_V1169=0（SQL を流さない）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { createHandler } = await import(process.env.WR_HANDLER ? pathToFileURL(process.env.WR_HANDLER).href : '../supabase/functions/work-requests/handler.mjs');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2',
  '20261121090000_chat', '20261124090000_chat_files', '20261127090000_chat_ui79', '20261128090000_chat_guard'];
export const FIX_SQL = M('20261129090000_fixes_v1169');
const WITH_FIX = process.env.FIX_V1169 !== '0';

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function base() {
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
  return pg;
}

async function setup({ fix = WITH_FIX, before } = {}) {
  const pg = await base();
  if (before) await before(pg);
  if (fix) await pg.exec(FIX_SQL);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const later = [];
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', CHAT_VAPID_PUBLIC: 'BPUB', CHAT_VAPID_PRIVATE: 'priv' };
  const handler = createHandler({ env: k => env[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; },
    loginCheck: async () => ({ ok: false }), pushSend: async () => 201, waitUntil: p => { later.push(p); } });
  let seq = 0;
  const key = () => 'f-' + (++seq).toString().padStart(6, '0') + '-v1169';
  const call = async (who, body, unlock) => {
    const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin_session: 'pin-' + who, ...(unlock ? { unlock } : {}), ...body }) }));
    return { status: r.status, body: await r.json() };
  };
  const ok = async (who, body, unlock) => { const r = await call(who, body, unlock); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const q = async sql => { await pg.exec('reset role'); const r = await pg.query(sql); await pg.exec('set role service_role'); return r.rows; };
  const qx = async sql => { await pg.exec('reset role'); await pg.exec(sql); await pg.exec('set role service_role'); };
  let nreq = 0;
  const submit = async (who, extra = {}) => { nreq++;
    const r = await ok(who, { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
      payload: { date: '2026-11-0' + Math.min(9, nreq), payer: NAME[who], payer_is_employee: true, vendor: 'Costco ' + nreq, purpose: '仕入れ', amount_cents: 8640 + nreq, ...extra } });
    assert.ok(r && r.id); return r; };
  const retire = who => qx(`update public.employees set status = '退職' where id = '${who}'`);
  return { pg, db, call, ok, key, q, qx, submit, retire, later };
}

test('v1169 SQL: needs the chat protection and the request SQL first (STOP, nothing changed); runs twice; chat 5; the request stage is left as it is (v1165’s check wants 7); only the server key runs the new functions', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(pg.exec(FIX_SQL), /STOP: 先にチャットの守り/);
  const p2 = await base();
  await p2.exec(FIX_SQL); await p2.exec(FIX_SQL);
  const st = async () => (await p2.query(`select public.chat_stage('{}'::jsonb) c, public.wr_stage('{}'::jsonb) w`)).rows[0];
  assert.deepEqual(await st(), { c: { chat: 5 }, w: { stage: 5 } }, 'the request stage is not changed');
  await p2.exec(`create or replace function public.wr_stage(p jsonb) returns jsonb language sql stable as $$ select jsonb_build_object('stage', 7) $$;`);
  await p2.exec(FIX_SQL);
  assert.deepEqual((await st()).w, { stage: 7 }, 'still 7 (the v1165 check looks for exactly 7)');
  for (const f of ['chat_create_group_k(jsonb)', 'wr_acct_done(jsonb)', 'chat_live_n(uuid)']) {
    const r = (await p2.query(`select has_function_privilege('anon', 'public.${f}', 'execute') a, has_function_privilege('authenticated', 'public.${f}', 'execute') b,
      has_function_privilege('service_role', 'public.${f}', 'execute') c`)).rows[0];
    assert.deepEqual(r, { a: false, b: false, c: true }, f);
  }
});

test('(#164) a keyed group is made with its key in one step: if the key cannot be stored, there is no group at all (no unprotected conversation is left)', async () => {
  const s = await setup();
  // 守り（キー）を保存するところで失敗させる（どの版でもキーは chat_threads.key_hash に入る）
  await s.qx(`create function public.t_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
    create trigger t_boom before update of key_hash on public.chat_threads for each row when (new.key_hash is not null) execute function public.t_boom();`);
  const before = (await s.q(`select count(*)::int n from public.chat_threads`))[0].n;
  const r = await s.call('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: s.key(), key: 'kitchen-1' });
  assert.notEqual(r.status, 200, 'the key was not stored, so it is not made: ' + JSON.stringify(r.body));
  assert.notEqual(r.body.key_failed, true);
  assert.equal((await s.q(`select count(*)::int n from public.chat_threads`))[0].n, before, 'no group without its key');
  await s.qx(`drop trigger t_boom on public.chat_threads`);
  const g = await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: s.key(), key: 'kitchen-1' });
  assert.equal(g.keyed, true); assert.match(g.unlock, /^[0-9a-f]{64}$/, 'the maker is open');
  assert.equal((await s.call('E7', { action: 'chat_messages', thread: g.id }, g.unlock)).status, 200);
  assert.deepEqual(await s.call('E6', { action: 'chat_messages', thread: g.id }), { status: 423, body: { error: 'chat_key_required' } }, 'a member needs the key');
});

test('(#164) sending it again (the same client key) puts the key on a group that never had one; a key the manager has set or changed is never replaced', async () => {
  const s = await setup();
  const k1 = s.key();
  // 前の版で作りかけた会話（キーを付ける前に止まった）＝キーの無い同じ鍵の会話
  const g0 = await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: k1 });
  assert.equal((await s.q(`select key_rev, key_hash is null nk from public.chat_threads where id = '${g0.id}'`))[0].nk, true);
  const g1 = await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: k1, key: 'kitchen-1' });
  assert.equal(g1.id, g0.id, 'the same conversation');
  assert.equal(g1.keyed, true, 'sent again: the key is put on now');
  assert.deepEqual((await s.q(`select key_rev from public.chat_threads where id = '${g0.id}'`))[0], { key_rev: 1 });
  assert.deepEqual(await s.call('E6', { action: 'chat_messages', thread: g0.id }), { status: 423, body: { error: 'chat_key_required' } });
  // 管理する人がキーを変えた → 同じ鍵をもう一度送っても前のキーには戻らない
  const ks = await s.ok('E7', { action: 'chat_key_set', thread: g0.id, key: 'kitchen-2' }, g1.unlock);
  const g2 = await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: k1, key: 'kitchen-1' }, g1.unlock);
  assert.equal(g2.id, g0.id);
  assert.deepEqual((await s.q(`select key_rev from public.chat_threads where id = '${g0.id}'`))[0], { key_rev: ks.key_rev });
  assert.equal((await s.ok('E6', { action: 'chat_key_verify', thread: g0.id, key: 'kitchen-1' })).ok, false, 'the old key does not open it');
  assert.equal((await s.ok('E6', { action: 'chat_key_verify', thread: g0.id, key: 'kitchen-2' })).ok, true);
  // 管理する人がキーを外した会話にも、送り直しで付け直さない
  await s.ok('E7', { action: 'chat_key_set', thread: g0.id, key: null }, g1.unlock);   // 変えた人の印は開いたまま
  await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6'], client_key: k1, key: 'kitchen-1' });
  assert.deepEqual((await s.q(`select key_hash is null nk from public.chat_threads where id = '${g0.id}'`))[0], { nk: true });
  // 作った人でない人（参加者）が同じ鍵を送っても付けない（管理する人だけ）
  const k2 = s.key();
  const h = await s.ok('E7', { action: 'chat_create_group', title: 'Hall', members: ['E6'], client_key: k2 });
  assert.equal((await s.call('E6', { action: 'chat_create_group', title: 'Hall', members: ['E7'], client_key: k2, key: 'hall-key' })).status, 409);
  assert.deepEqual((await s.q(`select key_hash is null nk from public.chat_threads where id = '${h.id}'`))[0], { nk: true });
});

test('(#163) the last participant of a request chat cannot leave (or be removed); after adding someone they can', async () => {
  const s = await setup();
  const r = await s.submit('E7');
  const t = await s.ok('E7', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0001' });
  assert.deepEqual(await s.call('E7', { action: 'chat_remove', thread: t.id, emp: 'E7' }), { status: 409, body: { error: 'last_member' } });
  await s.ok('E7', { action: 'chat_add', thread: t.id, members: ['E6'], history: true });
  assert.equal((await s.ok('E7', { action: 'chat_remove', thread: t.id, emp: 'E7' })).removed, 1, 'someone else can read it, so the maker can leave');
  assert.deepEqual(await s.call('E6', { action: 'chat_remove', thread: t.id, emp: 'E6' }), { status: 409, body: { error: 'last_member' } }, 'now E6 is the last one');
  // グループ（申請でない）は今までどおり最後の人も抜けられる
  const g = await s.ok('E7', { action: 'chat_create_group', title: 'Tiny', members: ['E8'], client_key: s.key() });
  await s.ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E8' });
  assert.equal((await s.ok('E7', { action: 'chat_remove', thread: g.id, emp: 'E7' })).removed, 1);
});

test('(#163) a request chat that nobody can read any more (its people left or retired) can be started again; the old conversation is kept off the request and shown to nobody', async () => {
  const s = await setup();
  const r = await s.submit('E7');
  const t = await s.ok('E7', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0101' });
  assert.equal((await s.call('E7', { action: 'chat_send', thread: t.id, body: 'old secret', client_key: s.key() })).status, 200);
  await s.retire('E7');   // 唯一の参加者が退職
  const c = await s.ok('E2', { action: 'chat_case', id: r.id });
  assert.equal(c.can_create, true, 'GM can start it again: ' + JSON.stringify(c));
  assert.equal(c.restart, true, 'the app says it is a new start');
  assert.equal(c.thread, null);
  const t2 = await s.ok('E2', { action: 'chat_case_create', id: r.id, members: ['E6'], client_key: 'case-key-0102' });
  assert.notEqual(t2.id, t.id, 'a new conversation');
  assert.deepEqual((await s.q(`select ref_id, ref_old from public.chat_threads where id = '${t.id}'`))[0], { ref_id: null, ref_old: r.id });
  const m = await s.ok('E2', { action: 'chat_messages', thread: t2.id });
  assert.ok(!JSON.stringify(m).includes('old secret'), 'the old messages are not in the new one');
  assert.equal((await s.call('E2', { action: 'chat_messages', thread: t.id })).status, 404, 'the old conversation is shown to nobody');
  assert.equal((await s.ok('E6', { action: 'chat_case', id: r.id })).thread.id, t2.id, 'the request opens the new one');
  // 同じ鍵の押し直しは同じ新しい会話
  assert.equal((await s.ok('E2', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0102' })).id, t2.id);
  // 読める人がいれば、参加者でない人は今までどおり「ある」だけ
  const c2 = await s.ok('E1', { action: 'chat_case', id: r.id });
  assert.deepEqual([c2.exists, c2.can_open, c2.can_create === true], [true, false, false]);
  assert.deepEqual(await s.call('E1', { action: 'chat_case_create', id: r.id, members: [], client_key: 'case-key-0103' }), { status: 409, body: { error: 'case_exists' } });
});

test('(#163) a retired manager does not count: the next readable person becomes the manager when someone leaves, and the SQL fixes such conversations once', async () => {
  const s = await setup();
  const g = await s.ok('E7', { action: 'chat_create_group', title: 'Kitchen', members: ['E6', 'E8'], client_key: s.key() });
  await s.retire('E7');
  await s.ok('E8', { action: 'chat_remove', thread: g.id, emp: 'E8' });
  assert.deepEqual((await s.q(`select admin from public.chat_members where thread_id = '${g.id}' and emp_id = 'E6'`))[0], { admin: true });
  assert.equal((await s.call('E6', { action: 'chat_add', thread: g.id, members: ['E5'], history: false })).status, 200, 'E6 can manage it');
  // SQL を流す前からあった会話（管理する人が退職した人だけ）は、SQL が 1 回直す
  const p = await setup({ fix: false });
  const h = await p.ok('E7', { action: 'chat_create_group', title: 'Hall', members: ['E6'], client_key: p.key() });
  await p.retire('E7');
  if (WITH_FIX) { await p.qx(FIX_SQL); assert.deepEqual((await p.q(`select admin from public.chat_members where thread_id = '${h.id}' and emp_id = 'E6'`))[0], { admin: true }); }
  else assert.fail('the fix SQL is not run (FIX_V1169=0)');
});

test('v1170 fix (Codex #166 P2): after the SQL, if the only manager of a request chat retires, the participant left can add someone, manage, rename and set the key; the chat is still shown to nobody else', async () => {
  const s = await setup();
  const r = await s.submit('E7');
  const t = await s.ok('E7', { action: 'chat_case_create', id: r.id, members: ['E6'], client_key: 'case-key-0201' });
  await s.retire('E7');   // SQL のあとに唯一の管理する人が退職（E6 は一般の参加者）
  assert.deepEqual((await s.q(`select admin from public.chat_members where thread_id = '${t.id}' and emp_id = 'E6'`))[0], { admin: false }, 'E6 is not the manager yet');
  // 前は 403 forbidden（加える）・409 last_member（抜ける）・409 case_exists（GM の作り直し）で、どこからも直せなかった
  assert.deepEqual(await s.call('E6', { action: 'chat_remove', thread: t.id, emp: 'E6' }), { status: 409, body: { error: 'last_member' } }, 'E6 still cannot leave the only readable seat');
  const add = await s.call('E6', { action: 'chat_add', thread: t.id, members: ['E8'], history: true });
  assert.equal(add.status, 200, 'E6 can add someone: ' + JSON.stringify(add.body));
  assert.deepEqual((await s.q(`select admin from public.chat_members where thread_id = '${t.id}' and emp_id = 'E6'`))[0], { admin: true }, 'E6 became the manager under the lock');
  assert.equal((await s.ok('E6', { action: 'chat_remove', thread: t.id, emp: 'E6' })).removed, 1, 'after adding E8, E6 can leave');
  assert.deepEqual((await s.q(`select admin from public.chat_members where thread_id = '${t.id}' and emp_id = 'E8'`))[0], { admin: true }, 'E8 is the manager now');
  // GM（申請を見られる・参加者でない）は今までどおり「ある」とだけ（E8 が読める）
  const c = await s.ok('E2', { action: 'chat_case', id: r.id });
  assert.deepEqual([c.exists, c.can_open, c.thread], [true, false, null]);
  assert.equal((await s.call('E2', { action: 'chat_messages', thread: t.id })).status, 404, 'not shown to a non-participant');
  // 名前・管理する人・キー：退職した管理する人だけのグループでも、残った参加者が直せる
  const s2 = await setup();
  const g = await s2.ok('E7', { action: 'chat_create_group', title: 'Bar', members: ['E6'], client_key: s2.key() });
  await s2.retire('E7');
  const rev = (await s2.q(`select rev from public.chat_threads where id = '${g.id}'`))[0].rev;
  assert.equal((await s2.call('E6', { action: 'chat_rename', thread: g.id, title: 'Bar 2', expect_rev: rev })).status, 200, 'rename');
  const h = await s2.ok('E6', { action: 'chat_add', thread: g.id, members: ['E8'], history: false });
  assert.equal(h.added, 1);
  assert.equal((await s2.call('E6', { action: 'chat_admin', thread: g.id, emp: 'E8', admin: true })).status, 200, 'make E8 a manager too');
  assert.equal((await s2.call('E6', { action: 'chat_admin', thread: g.id, emp: 'E7', admin: false })).status, 200, 'the retired manager’s mark can be taken off (E6 and E8 still manage)');
  assert.deepEqual(await s2.call('E6', { action: 'chat_admin', thread: g.id, emp: 'E6', admin: false }), { status: 200, body: { emp: 'E6', admin: false } });
  assert.deepEqual(await s2.call('E8', { action: 'chat_admin', thread: g.id, emp: 'E8', admin: false }), { status: 409, body: { error: 'last_admin' } }, 'the last readable manager cannot step down');
  // 参加者でない人は今までどおり何もできない
  assert.equal((await s2.call('E9', { action: 'chat_add', thread: g.id, members: ['E9'], history: true })).status, 404);
});

test('v1170 fix (Codex #166 6891496601): after the only manager retires, opening the chat already shows the one who will manage next as the manager (add / rename / manage / key on the normal screen); only that one person, nothing written by reading, nobody else sees it', async () => {
  const s = await setup();
  const g = await s.ok('E7', { action: 'chat_create_group', title: 'Prep', members: ['E6', 'E8'], client_key: s.key() });
  const CAN = b => [b.can_add, b.can_rename, b.can_admin, b.can_remove];
  // 管理する人（E7）がいるあいだは、ほかの参加者には今までどおり出さない
  assert.deepEqual(CAN(await s.ok('E6', { action: 'chat_messages', thread: g.id })), [false, false, false, false]);
  await s.retire('E7');
  const before = await s.q(`select emp_id, admin from public.chat_members where thread_id = '${g.id}' order by emp_id`);
  // 次に管理する人になるのは、作った人（退職）を除いて、いちばん前から入っている人（同じ時刻なら社員 ID の順）＝ E6 だけ
  const m6 = await s.ok('E6', { action: 'chat_messages', thread: g.id });
  assert.deepEqual(CAN(m6), [true, true, true, true], 'E6 sees add / rename / manage / remove');
  assert.equal(m6.thread.admin, true, 'the row says E6 manages it (the lock screen shows “set a new key” too)');
  assert.deepEqual(m6.members.filter(x => x.admin).map(x => x.emp).sort(), ['E6', 'E7'], 'the list shows E6 as a manager (E7’s old mark stays until someone takes it off, as before)');
  const m8 = await s.ok('E8', { action: 'chat_messages', thread: g.id });
  assert.deepEqual(CAN(m8), [false, false, false, false], 'E8 is not the next manager: nothing more for E8');
  assert.equal(m8.thread.admin, false);
  const sync = await s.ok('E6', { action: 'chat_sync', since: 0 });
  assert.equal((sync.threads || []).find(t => t.id === g.id).admin, true, 'the list row too');
  assert.deepEqual(await s.q(`select emp_id, admin from public.chat_members where thread_id = '${g.id}' order by emp_id`), before, 'reading wrote nothing');
  assert.equal((await s.call('E9', { action: 'chat_messages', thread: g.id })).status, 404, 'a non-participant still sees nothing');
  // 画面から押す：ロックの下で本当に管理する人になって、加えられる
  assert.equal((await s.ok('E6', { action: 'chat_add', thread: g.id, members: ['E9'], history: false })).added, 1);
  assert.deepEqual(await s.q(`select emp_id, admin from public.chat_members where thread_id = '${g.id}' and left_at is null order by emp_id`),
    [{ emp_id: 'E6', admin: true }, { emp_id: 'E7', admin: true }, { emp_id: 'E8', admin: false }, { emp_id: 'E9', admin: false }]);
  assert.deepEqual(CAN(await s.ok('E8', { action: 'chat_messages', thread: g.id })), [false, false, false, false], 'E6 manages now: E8 sees no more');
  // 申請のチャット（Codex の手順）：唯一の管理する人の退職 → 残った参加者が読む → 加えられる → 抜けられる
  const s3 = await setup();
  const r2 = await s3.submit('E7');
  const t = await s3.ok('E7', { action: 'chat_case_create', id: r2.id, members: ['E6'], client_key: 'case-key-0301' });
  await s3.retire('E7');
  const c6 = await s3.ok('E6', { action: 'chat_messages', thread: t.id });
  assert.deepEqual([c6.can_add, c6.can_admin, c6.can_leave], [true, true, true], 'the screen shows “add people” to E6');
  assert.equal((await s3.ok('E6', { action: 'chat_add', thread: t.id, members: ['E8'], history: true })).added, 1);
  assert.equal((await s3.ok('E6', { action: 'chat_remove', thread: t.id, emp: 'E6' })).removed, 1);
});

test('v1170 fix (Codex / Claude #166 P3): in an ordinary group with a manager, the member list says admin true / false (never null) and the manager comes first, as before', async () => {
  const s = await setup();
  const g = await s.ok('E7', { action: 'chat_create_group', title: 'Line', members: ['E6', 'E8'], client_key: s.key() });
  for (const who of ['E6', 'E7', 'E8']) {
    const m = await s.ok(who, { action: 'chat_messages', thread: g.id });
    assert.deepEqual(m.members.map(x => typeof x.admin), ['boolean', 'boolean', 'boolean'], 'admin is true or false (not null)');
    assert.deepEqual(m.members.map(x => [x.emp, x.admin]), [['E7', true], ...m.members.slice(1).map(x => [x.emp, false])], 'the manager first, the others false');
    assert.deepEqual(m.members.slice(1).map(x => x.emp).sort(), ['E6', 'E8']);
  }
  // 管理する人の退職のあと：次に管理する人（E6）も true で前に並ぶ。ほかは false
  await s.retire('E7');
  const m6 = await s.ok('E6', { action: 'chat_messages', thread: g.id });
  assert.deepEqual(m6.members.map(x => typeof x.admin), ['boolean', 'boolean', 'boolean']);
  assert.deepEqual(m6.members.filter(x => !x.admin).map(x => x.emp), ['E8'], 'only E8 is not shown as a manager, and comes last');
  assert.equal(m6.members[2].emp, 'E8');
});

test('(#161) 処理済み（今月）: read by the time it was processed (paid, else checked; Hawaii month), newest first, page by page, only requests the person can see', async () => {
  const s = await setup();
  const old = await s.submit('E7', { date: '2026-08-20' });   // 前の申請を今月精算した
  const prev = await s.submit('E7', { date: '2026-11-02' });   // 先月（10 月）に確認した
  const open = await s.submit('E6');                            // まだ
  const nowHst = (await s.q(`select to_char(timezone('Pacific/Honolulu', now()), 'YYYY-MM') m`))[0].m;
  await s.qx(`update public.wr_requests set status = 'paid', checked_at = now() - interval '1 minute', paid_at = now() where id = '${old.id}';
    update public.wr_requests set status = 'done', checked_at = '2026-10-15 12:00:00-10', created_at = '2026-08-20 09:00:00-10' where id = '${prev.id}';
    update public.wr_requests set created_at = '2026-08-20 09:00:00-10' where id = '${old.id}'`);
  const cur = await s.ok('E3', { action: 'acct_done', limit: 500 });
  assert.equal(cur.month, nowHst);
  assert.deepEqual(cur.rows.map(r => r.id), [old.id], 'the old request processed this month is in');
  assert.ok(!cur.rows.some(r => r.id === open.id));
  assert.deepEqual((await s.ok('E3', { action: 'acct_done', month: '2026-10' })).rows.map(r => r.id), [prev.id], 'October: checked in October');
  // ページ：5 件・2 件ずつ
  const more = []; for (let i = 0; i < 4; i++) more.push((await s.submit('E7')).id);
  await s.qx(more.map((id, i) => `update public.wr_requests set status = 'paid', checked_at = now(), paid_at = now() - interval '${i + 2} minutes' where id = '${id}';`).join('\n'));
  const got = []; let next = null, pages = 0;
  do {
    const j = await s.ok('E3', { action: 'acct_done', limit: 2, ...(next || {}) });
    got.push(...j.rows.map(r => r.id)); next = j.next; pages++;
  } while (next && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(got, [old.id, ...more], 'newest first, none twice, none missing');
  // 見られる人だけ：S2 の Crew には S1 の申請は出ない
  assert.deepEqual((await s.ok('E9', { action: 'acct_done' })).rows, []);
  // 形の確かめ
  for (const b of [{ month: '2026-13' }, { month: 202611 }, { before_at: 'x', before_id: old.id }, { before_at: new Date().toISOString() }])
    assert.equal((await s.call('E3', { action: 'acct_done', ...b })).status, 400, JSON.stringify(b));
});

test('(#161) before the SQL: 処理済み（今月） says done_old (the app falls back to the older way and says so)', async () => {
  const s = await setup({ fix: false });
  assert.deepEqual(await s.call('E3', { action: 'acct_done' }), { status: 503, body: { error: 'done_old' } });
  assert.equal((await s.ok('E3', { action: 'whoami' })).fn, 11);
});
