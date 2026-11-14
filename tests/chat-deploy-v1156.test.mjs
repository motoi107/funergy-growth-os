// v1156 チャット：Moto さんが貼るファイル（deploy/chat-v1156）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/chat-v1156/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const CHAT = M('20261121090000_chat');
const WR = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];

test('the SQL to paste is the chat migration, letter for letter; the steps say the order, the version and that the function file is private', () => {
  assert.equal(read('2_SQL_チャット.sql'), CHAT);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1156_index\.ts`（非公開/); assert.match(h, /1156/);
  assert.match(h, /deploy\/work-requests-v1155/, 'says what must come first');
  assert.match(h, /戻す_チャットを止める\.md/);
  assert.match(read('戻す_チャットを止める.md'), /work-requests_v1155_index\.ts/);
  assert.ok(!fs.existsSync(new URL('work-requests_v1156_index.ts', D)), 'the PIN check file never goes into the repository');
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci/, f + ' has no keys');
});

async function base() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.manager_auth(role, emp_id) values ('gm','E2');
    insert into public.employees values ('E2','Gabe GM','gm','General Manager','OFFICE','[]','在籍','{"name":"Gabe GM"}'),
      ('E8','Cam Crew','crew','Crew','S1','[]','在籍','{"name":"Cam Crew"}'),('E9','Old One','crew','Crew','S1','[]','退職','{"name":"Old One"}');`);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK' || r.result === '—' || /^OK（/.test(r.result));

test('before the work requests stage 2 the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await base();
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), '0'); assert.equal(pre('3.'), 'OK'); assert.equal(pre('5.'), '—');
  assert.equal(pre('（参考）在籍の社員の数'), '2', 'the retired person is not counted');
  await assert.rejects(pg.exec(read('2_SQL_チャット.sql')), /STOP: 先にワークセンターの申請の SQL/);
  assert.equal((await pg.query(`select count(*)::int n from pg_tables where tablename like 'chat\\_%'`)).rows[0].n, 0);
});

test('on top of stage 2: pre-check, the SQL (twice), post-check all OK; a stray chat_ table stops the pre-check; a later old work-requests SQL is caught', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '0', 'the first time'); assert.equal(pre('3.'), 'OK');
  assert.match(pre('4.'), /^OK/); assert.equal(pre('5.'), 'false');
  await pg.exec(read('2_SQL_チャット.sql'));
  await pg.exec(read('2_SQL_チャット.sql'));
  const post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  const P = by(post);
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '10.']) assert.equal(P(n), 'OK', n);
  assert.equal(P('9.'), '—', 'no Realtime publication in this test database');
  assert.equal(P('（参考）会話の数'), '0'); assert.equal(P('（参考）メッセージの数'), '0');
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('2.'), '5', 'already in');
  // ほかの chat_ の表があれば止める
  await pg.exec('create table public.chat_other(id int)');
  assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('3.'), /^STOP/);
  await pg.exec('drop table public.chat_other');
  // 申請の前の SQL をあとで流すと段が戻る → 8 が NG
  await pg.exec(M('20261107090000_work_requests_ui68'));
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), /^NG/);
});

test('the post-check notices what it is meant to notice', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT);
  const P = async () => by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  await pg.exec('alter table public.chat_messages disable row level security');
  assert.match((await P())('1.'), /^NG/);
  await pg.exec('alter table public.chat_messages enable row level security; grant select on public.chat_messages to anon');
  assert.match((await P())('2.'), /^NG/);
  await pg.exec('revoke all on public.chat_messages from anon; grant insert on public.chat_sig to anon');
  assert.match((await P())('3.'), /^NG/, 'the public key may only read the signal');
  await pg.exec('revoke insert on public.chat_sig from anon; grant execute on function public.chat_send(jsonb) to anon');
  assert.match((await P())('4.'), /^NG/);
  await pg.exec('revoke execute on function public.chat_send(jsonb) from anon; alter function public.chat_stage(jsonb) security definer');
  assert.match((await P())('5.'), /^NG/);
  await pg.exec('alter function public.chat_stage(jsonb) security invoker');
  assert.equal((await P())('5.'), 'OK');
});

// Codex #150 P2-1 の直し：前に渡した 2（least で加え直す）を流していたら 10 が NG。今の 2 をもう一度流すと OK
test('post-check 10 notices the chat SQL from before the re-add fix; the current SQL fixes it', async () => {
  const { execSync } = await import('node:child_process');
  let OLD;
  try { OLD = execSync('git show 95f9ff9:supabase/migrations/20261121090000_chat.sql', { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { assert.fail('git history with 95f9ff9 is needed (fetch with full depth)'); }
  assert.match(OLD, /least\(public\.chat_members\.history_from/);
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(OLD);
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('10.'), /^NG/);
  await pg.exec(read('2_SQL_チャット.sql'));
  const post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
});
