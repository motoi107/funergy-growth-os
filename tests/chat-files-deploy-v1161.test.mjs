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
