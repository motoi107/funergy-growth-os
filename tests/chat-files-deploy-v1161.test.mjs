// v1161 チャットの添付：Moto さんが貼るファイル（deploy/chat-files-v1161）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/chat-files-v1161/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const FILES = M('20261124090000_chat_files'), CHAT = M('20261121090000_chat');
const WR = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];

test('the SQL to paste is the attachment migration, letter for letter; the steps say the order, the version, the private function file and how to stop', () => {
  assert.equal(read('2_SQL_添付.sql'), FILES);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1161_index\.ts`（非公開/); assert.match(h, /1161/);
  assert.match(h, /deploy\/chat-v1156/, 'says what must come first');
  assert.match(h, /1 B 2 A 3 A 4 A 5 A 6 A 7 A 8 B/);
  assert.match(h, /戻す_添付を止める\.md/);
  assert.match(read('戻す_添付を止める.md'), /work-requests_v1159_index\.ts/);
  assert.ok(!fs.existsSync(new URL('work-requests_v1161_index.ts', D)), 'the PIN check file never goes into the repository');
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci/, f + ' has no keys');
});

async function base({ storage = true, policy = null } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.manager_auth(role, emp_id) values ('gm','E2');
    insert into public.employees values ('E2','Gabe GM','gm','General Manager','OFFICE','[]','在籍','{"name":"Gabe GM"}');`);
  if (storage) {
    await pg.exec(`create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create policy "invoices read" on storage.objects for select to anon using (bucket_id = 'invoices');`);
    if (policy) await pg.exec(policy);
  }
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK' || /^OK（/.test(r.result));

test('before the chat the pre-check says STOP and the SQL changes nothing; a storage rule not limited to one place is a STOP', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), '0'); assert.equal(pre('3.'), 'OK'); assert.equal(pre('4.'), 'OK'); assert.equal(pre('5.'), '無い（2 が作る）');
  assert.equal(pre('（参考）'), '—');
  await assert.rejects(pg.exec(read('2_SQL_添付.sql')), /STOP: 先にチャットの SQL/);
  assert.equal((await pg.query(`select count(*)::int n from pg_tables where tablename = 'chat_files'`)).rows[0].n, 0);
  const p2 = await base({ policy: `create policy "all read" on storage.objects for select to anon using (true);` });
  for (const f of WR) await p2.exec(M(f));
  await p2.exec(CHAT);
  assert.match(by(await rowsOf(p2, '1_最初に確認_読むだけ.sql'))('3.'), /^STOP（Claude に決まりの名前を：all read）/);
  const p3 = await base({ policy: `create policy "chat open" on storage.objects for select to authenticated using (bucket_id = 'chat-files');` });
  assert.match(by(await rowsOf(p3, '1_最初に確認_読むだけ.sql'))('4.'), /^STOP/);
  const p4 = await base({ storage: false });
  const pre4 = by(await rowsOf(p4, '1_最初に確認_読むだけ.sql'));
  assert.match(pre4('3.'), /^—/); assert.match(pre4('5.'), /^—/);
});

test('on top of the chat: pre-check, the SQL (twice), post-check all OK; a public bucket is made private; the chat SQL run again is caught and fixed', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT);
  await pg.exec(`insert into storage.buckets(id, name, public) values ('chat-files','chat-files', true)`);
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '0'); assert.match(pre('5.'), /公開になっている/); assert.equal(pre('（参考）'), '1');
  await pg.exec(read('2_SQL_添付.sql'));
  await pg.exec(read('2_SQL_添付.sql'));
  let post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  const P = by(post);
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.']) assert.equal(P(n), 'OK', n);
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('2.'), '1', 'already in'); assert.equal(pre('5.'), 'ある（非公開）'); assert.equal(pre('（参考）'), '2');
  // チャットの v1156 の確認も OK のまま（v1156 の ① ③ は添付のあとでも NG にしない）
  const D1156 = new URL('../deploy/chat-v1156/', import.meta.url);
  const r1156 = (await pg.query(fs.readFileSync(new URL('3_確認_読むだけ.sql', D1156), 'utf8'))).rows.filter(r => !/^（参考）/.test(r.check_name) && !r.check_name.startsWith('9.'));
  assert.ok(r1156.every(r => r.result === 'OK'), JSON.stringify(r1156));
  assert.equal(((await pg.query(fs.readFileSync(new URL('1_最初に確認_読むだけ.sql', D1156), 'utf8'))).rows.find(r => r.check_name.startsWith('3.')) || {}).result, 'OK', 'chat_files is not a stranger to the v1156 pre-check');
  // あとでチャットの SQL を流し直す → 5・6 が NG → この 2 をもう一度 → OK
  await pg.exec(CHAT);
  const P2 = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match(P2('5.'), /^NG/); assert.match(P2('6.'), /^NG/);
  await pg.exec(read('2_SQL_添付.sql'));
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
});

test('the post-check notices what it is meant to notice', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT); await pg.exec(FILES);
  const P = async () => by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  await pg.exec('alter table public.chat_files disable row level security');
  assert.match((await P())('1.'), /^NG/);
  await pg.exec('alter table public.chat_files enable row level security; grant select on public.chat_files to anon');
  assert.match((await P())('2.'), /^NG/);
  await pg.exec('revoke all on public.chat_files from anon; grant execute on function public.chat_file_start(jsonb) to authenticated');
  assert.match((await P())('3.'), /^NG/);
  await pg.exec('revoke execute on function public.chat_file_start(jsonb) from authenticated; grant execute on function public.wr_receipt_file(jsonb) to anon');
  assert.match((await P())('3.'), /^NG/);
  await pg.exec('revoke execute on function public.wr_receipt_file(jsonb) from anon; alter function public.chat_files_list(jsonb) security definer');
  assert.match((await P())('4.'), /^NG/);
  await pg.exec('alter function public.chat_files_list(jsonb) security invoker; update storage.buckets set public = true where id = \'chat-files\'');
  assert.match((await P())('7.'), /^NG/);
  await pg.exec(`update storage.buckets set public = false where id = 'chat-files'; create policy "chat open" on storage.objects for select to anon using (bucket_id = 'chat-files')`);
  assert.match((await P())('8.'), /^NG/);
  await pg.exec(`drop policy "chat open" on storage.objects; create policy "everything" on storage.objects for select to authenticated using (true)`);
  assert.match((await P())('8.'), /^NG/);
  await pg.exec(`drop policy "everything" on storage.objects`);
  await pg.exec(M('20261107090000_work_requests_ui68'));
  assert.match((await P())('9.'), /^NG/);
});

// #155 の Codex（6876878458）の 1：「bucket_id という字がある」では足りない。置き場所を 1 つ（chat-files 以外）に限った決まりだけを通し、
// <>・OR・IN・関数・true・式が無いものは止める（ほかの置き場所の決まりは消さない）。本番と同じ 3 つの形・AND でつないだもの・RESTRICTIVE は通す
const POLS = {
  safe: [
    `create policy "anon_documents_rw" on storage.objects for all to anon using (bucket_id = 'documents') with check (bucket_id = 'documents')`,
    `create policy "invoices anon upload" on storage.objects for insert to anon with check (bucket_id = 'invoices')`,
    `create policy "own folder" on storage.objects for select to authenticated using (bucket_id = 'avatars' and name like 'x/%')`,
    `create policy "own folder or" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (name like 'x/%' or name like 'y/%')) with check (bucket_id = 'avatars')`,
    `create policy "limit" on storage.objects as restrictive for select to anon using (true)`,
    `create policy "server" on storage.objects for select to service_role using (true)`,
  ],
  loose: [
    `create policy "not invoices" on storage.objects for select to anon using (bucket_id <> 'invoices')`,
    `create policy "or true" on storage.objects for select to anon using (bucket_id = 'invoices' or true)`,
    `create policy "and then or" on storage.objects for select to public using ((bucket_id = 'invoices' and name like 'a%') or name like 'b%')`,
    `create policy "in list" on storage.objects for select to anon using (bucket_id in ('invoices', 'docs'))`,
    `create policy "two eq" on storage.objects for select to authenticated using (bucket_id = 'invoices' or bucket_id = 'docs')`,
    `create policy "insert not" on storage.objects for insert to anon with check (bucket_id <> 'x')`,
    `create policy "all check true" on storage.objects for all to anon using (bucket_id = 'documents') with check (true)`,
    `create policy "update true" on storage.objects for update to authenticated using (true)`,
    `create policy "lower" on storage.objects for delete to anon using (lower(bucket_id) = 'invoices')`,
  ],
  chat: [
    `create policy "chat in list" on storage.objects for select to anon using (bucket_id in ('invoices', 'chat-files'))`,
    `create policy "chat eq" on storage.objects for insert to authenticated with check (bucket_id = 'chat-files')`,
  ],
};
test('#155 storage rules: only rules limited to one other place pass; <>, OR, IN, functions, true and chat-files stop (pre-check, the SQL, post-check)', async () => {
  // 通るもの（まとめて）：① 3・4 OK → ② が入る → ③ 8 OK
  const pg = await base({ policy: POLS.safe.join(';\n') + ';' });
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT);
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('3.'), 'OK'); assert.equal(pre('4.'), 'OK');
  await pg.exec(read('2_SQL_添付.sql'));
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), 'OK');
  // 入れたあとに増えた限らない決まり・chat-files の決まりは ③ の 8 が NG（名前つき）。消すと OK
  for (const sql of [...POLS.loose, ...POLS.chat]) {
    const name = /policy "([^"]+)"/.exec(sql)[1];
    await pg.exec(sql);
    assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), new RegExp('^NG（Claude に決まりの名前を：' + name), name);
    await pg.exec(`drop policy "${name}" on storage.objects`);
  }
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), 'OK');
  // 止まるもの（1 つずつ）：① が STOP・② は何も変えずに止まる
  for (const [kind, list] of [['loose', POLS.loose], ['chat', POLS.chat]]) for (const sql of list) {
    const name = /policy "([^"]+)"/.exec(sql)[1];
    const db = await base({ policy: sql });
    for (const f of WR) await db.exec(M(f));
    await db.exec(CHAT);
    const p = by(await rowsOf(db, '1_最初に確認_読むだけ.sql'));
    if (kind === 'loose') { assert.match(p('3.'), new RegExp('^STOP（Claude に決まりの名前を：' + name), name); assert.equal(p('4.'), 'OK', name); }
    else assert.match(p('4.'), new RegExp('^STOP（Claude に決まりの名前を：' + name), name);
    await assert.rejects(db.exec(read('2_SQL_添付.sql')), kind === 'loose' ? /STOP: Storage（storage.objects）に置き場所を限らない決まり/ : /STOP: Storage に chat-files を開ける決まり/, name);
    assert.equal((await db.query(`select count(*)::int n from pg_tables where tablename = 'chat_files'`)).rows[0].n, 0, name + ': nothing changed');
    assert.equal((await db.query(`select count(*)::int n from storage.buckets where id = 'chat-files'`)).rows[0].n, 0, name + ': no bucket');
  }
  // なぜ止めるか：<> の決まりがあると、公開の鍵で chat-files の行が読める（前の確かめは通していた）
  const db = await base({ policy: POLS.loose[0] });
  await db.exec(`grant usage on schema storage to anon; grant select on storage.objects to anon;
    insert into storage.objects(bucket_id, name) values ('chat-files', 'a/b'), ('invoices', 'c')`);
  await db.exec('set role anon');
  assert.deepEqual((await db.query(`select bucket_id from storage.objects order by 1`)).rows.map(r => r.bucket_id), ['chat-files', 'invoices'], 'chat-files is readable (invoices by the usual rule)');
  await db.exec('reset role');
});

// 11/14 本番：2 が入っていないのに 3 を流すと「chat_files does not exist」で止まった → NG と「—（2 がまだ）」を出す
test('the post-check before the SQL: NG lines, not an error', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT);
  const rows = await rowsOf(pg, '3_確認_読むだけ.sql');
  const P = by(rows);
  assert.match(P('1.'), /^NG/); assert.match(P('5.'), /^NG/);
  assert.equal(P('（参考）送ったファイルの数'), '—（2 がまだ）');
  assert.equal(P('（参考）送っていない'), '—（2 がまだ）');
});

// #155・#156 の Codex（6880266210・6880661922）：名前が public・anon・authenticated の決まりだけを見ていた。
// anon・authenticated が入っているロール宛ての決まり（継承・何段でも・INHERIT FALSE で SET ROLE だけでも）も公開の鍵に効くので、同じに見る。
// storage.objects の RLS が OFF・anon が BYPASSRLS なら、決まりに関係なく読めるので止める。anon が入っていないロール宛ては今までどおり見ない。
const VIA = {
  loose: [
    ['readers all', `create role storage_readers; grant storage_readers to anon;
      create policy "readers all" on storage.objects for select to storage_readers using (true)`],
    ['two steps', `create role r_outer; create role r_inner; grant r_inner to r_outer; grant r_outer to authenticated;
      create policy "two steps" on storage.objects for select to r_inner using (bucket_id <> 'invoices')`],
    ['set role only', `create role r_set; grant r_set to anon with inherit false;
      create policy "set role only" on storage.objects for select to r_set using (true)`],
    ['mixed roles', `create role r_mix; grant r_mix to anon;
      create policy "mixed roles" on storage.objects for select to service_role, r_mix using (true)`],
  ],
  chat: [
    ['chat via role', `create role chat_readers; grant chat_readers to authenticated;
      create policy "chat via role" on storage.objects for select to chat_readers using (bucket_id = 'chat-files')`],
  ],
  safe: [
    `create role internal_readers; create policy "internal" on storage.objects for select to internal_readers using (true)`,
    `create role r_member_of_anon; grant anon to r_member_of_anon; create policy "above anon" on storage.objects for select to r_member_of_anon using (true)`,
    `create role docs_readers; grant docs_readers to anon; create policy "docs via role" on storage.objects for select to docs_readers using (bucket_id = 'documents')`,
  ],
};
test('#155/#156 storage rules for roles that anon or authenticated belong to are checked too; RLS off or a key that skips RLS stops', async () => {
  // なぜ止めるか：anon が入っているロール宛ての using (true) で、公開の鍵が chat-files の行を読める（前の確かめは通していた）
  const why = await base({ policy: VIA.loose[0][1] + ';' });
  await why.exec(`grant usage on schema storage to anon; grant select on storage.objects to anon;
    insert into storage.objects(bucket_id, name) values ('chat-files', 'a/b'), ('invoices', 'c')`);
  await why.exec('set role anon');
  assert.deepEqual((await why.query(`select bucket_id from storage.objects order by 1`)).rows.map(r => r.bucket_id), ['chat-files', 'invoices']);
  await why.exec('reset role');
  // 止まるもの（1 つずつ）：① が STOP（名前つき）・② は何も変えずに止まる
  for (const [kind, list] of [['loose', VIA.loose], ['chat', VIA.chat]]) for (const [name, sql] of list) {
    const db = await base({ policy: sql + ';' });
    for (const f of WR) await db.exec(M(f));
    await db.exec(CHAT);
    const p = by(await rowsOf(db, '1_最初に確認_読むだけ.sql'));
    if (kind === 'loose') { assert.match(p('3.'), new RegExp('^STOP（Claude に決まりの名前を：' + name), name); assert.equal(p('4.'), 'OK', name); }
    else assert.match(p('4.'), new RegExp('^STOP（Claude に決まりの名前を：' + name), name);
    assert.equal(p('6.'), 'OK', name);
    await assert.rejects(db.exec(read('2_SQL_添付.sql')), kind === 'loose' ? /STOP: Storage（storage.objects）に置き場所を限らない決まり/ : /STOP: Storage に chat-files を開ける決まり/, name);
    assert.equal((await db.query(`select count(*)::int n from pg_tables where tablename = 'chat_files'`)).rows[0].n, 0, name + ': nothing changed');
    assert.equal((await db.query(`select count(*)::int n from storage.buckets where id = 'chat-files'`)).rows[0].n, 0, name + ': no bucket');
  }
  // 通るもの（まとめて）：anon・authenticated が入っていないロール（anon の上のロールも）・1 つの置き場所に限ったもの → ① OK → ② → ③ OK
  const pg = await base({ policy: VIA.safe.join(';\n') + ';' });
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT);
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('3.'), 'OK'); assert.equal(pre('4.'), 'OK'); assert.equal(pre('6.'), 'OK');
  await pg.exec(read('2_SQL_添付.sql'));
  let post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  // 入れたあとに増えた（ロール経由の）決まりは ③ の 8 が NG（名前つき）。ロールから anon を外すと OK
  await pg.exec(`create role late_readers; grant late_readers to anon; create policy "late" on storage.objects for select to late_readers using (true)`);
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), /^NG（Claude に決まりの名前を：late/);
  await pg.exec('revoke late_readers from anon');
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), 'OK');
  // なぜ止めるか（Codex の再現）：anon が storage.objects の持ち主のロールに入っていると、決まり・RLS に関係なく chat-files の行を読める
  const owner = (await pg.query(`select r.rolname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles r on r.oid = c.relowner
    where n.nspname = 'storage' and c.relname = 'objects'`)).rows[0].rolname;
  await pg.exec(`create role demo_owner; alter table storage.objects owner to demo_owner; grant demo_owner to anon; grant usage on schema storage to anon;
    insert into storage.objects(bucket_id, name) values ('chat-files', 'synthetic-private.pdf')`);
  await pg.exec('set role anon');
  assert.deepEqual((await pg.query(`select name from storage.objects where bucket_id = 'chat-files'`)).rows.map(r => r.name), ['synthetic-private.pdf']);
  await pg.exec('reset role');
  await pg.exec(`revoke demo_owner from anon; alter table storage.objects owner to ${owner}; drop role demo_owner; revoke usage on schema storage from anon;
    delete from storage.objects where name = 'synthetic-private.pdf'`);
  // RLS が OFF・anon が RLS を飛ばせる・表の持ち主か RLS を飛ばせるロールに入っている：③ の 10 が NG・① の 6 が STOP・② は止まる
  for (const [label, on, off] of [['rls off', 'alter table storage.objects disable row level security', 'alter table storage.objects enable row level security'],
                                  ['bypassrls', 'alter role anon bypassrls', 'alter role anon nobypassrls'],
                                  ['authenticated bypassrls', 'alter role authenticated bypassrls', 'alter role authenticated nobypassrls'],
                                  // #158・#159 の Codex（6881786429・6881979126）：表の持ち主のロール・RLS を飛ばせるロールに入っている公開の鍵
                                  ['inherited owner', `create role inherited_owner; alter table storage.objects owner to inherited_owner; grant inherited_owner to anon`,
                                    `revoke inherited_owner from anon; alter table storage.objects owner to ${owner}; drop role inherited_owner`],
                                  ['owner by set role only', `create role set_owner; alter table storage.objects owner to set_owner; grant set_owner to authenticated with inherit false`,
                                    `revoke set_owner from authenticated; alter table storage.objects owner to ${owner}; drop role set_owner`],
                                  ['bypassrls role', `create role skip_rls bypassrls; grant skip_rls to anon`, `revoke skip_rls from anon; drop role skip_rls`],
                                  ['superuser role', `create role super_r superuser; grant super_r to authenticated`, `revoke super_r from authenticated; drop role super_r`]]) {
    await pg.exec(on);
    assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), /^NG/, label);
    assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('6.'), /^STOP/, label);
    await assert.rejects(pg.exec(read('2_SQL_添付.sql')), /STOP: Storage（storage.objects）の行の守り（RLS）が効いていません/, label);
    await pg.exec(off);
    assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), 'OK', label);
  }
  // 添付の表 chat_files の持ち主のロールに入っている公開の鍵：③ の 10 が NG（① の 6・② は流す人のロールで見る）
  await pg.exec(`create role cf_owner; alter table public.chat_files owner to cf_owner; grant cf_owner to anon`);
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), /^NG/, 'chat_files owner');
  await pg.exec(`revoke cf_owner from anon`);
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), 'OK', 'chat_files owner revoked');
  await pg.exec(`alter table public.chat_files owner to ${owner}; drop role cf_owner`);
  // 入っていないだけのロール（anon の上・関係ない持ち主）は止めない
  await pg.exec(`create role above_owner; grant anon to above_owner; create role other_owner; create table public.zz_other(x int); alter table public.zz_other owner to other_owner`);
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), 'OK', 'roles above anon and owners of other tables');
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('6.'), 'OK');
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  // Storage が無い環境：① の 6・③ の 10 は「—」
  const none = await base({ storage: false });
  assert.match(by(await rowsOf(none, '1_最初に確認_読むだけ.sql'))('6.'), /^—/);
});
