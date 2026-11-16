// v1168 チャットの守り：Moto さんが貼るファイル（deploy/chat-guard-v1168）が migration と同じか・確認の SQL が読むべきものを読むか。
// 合成の DB（PGlite）・本物の SQL だけ。秘密（関数の 1 ファイル・プッシュの鍵）はリポジトリに無いことも。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/chat-guard-v1168/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const WR = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT = M('20261121090000_chat'), FILES = M('20261124090000_chat_files'), UI79 = M('20261127090000_chat_ui79'), GUARD = M('20261128090000_chat_guard');

test('the SQL to paste is the migration letter for letter; the steps name the order, the private files, the secrets and how to stop; no secret is in the repository', () => {
  assert.equal(read('2_SQL_チャットの守り.sql'), GUARD);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1168_index\.ts`（非公開/); assert.match(h, /チャットのプッシュ通知の鍵_v1168\.txt`（非公開/);
  for (const k of ['CHAT_VAPID_PUBLIC', 'CHAT_VAPID_PRIVATE', 'CHAT_VAPID_SUBJECT']) assert.match(h, new RegExp(k));
  assert.match(h, /#160 → #161 → #162 → #163 → この PR/);
  assert.match(h, /deploy\/chat-ui79-v1167/); assert.match(h, /自分の端末をすべて 1168 にしてから/);
  assert.match(h, /新着メッセージがあります/); assert.match(h, /続けて 5 回間違えると止まります/);
  assert.match(h, /戻す_チャットの守りを止める\.md/);
  const back = read('戻す_チャットの守りを止める.md');
  assert.match(back, /work-requests_v1167_index\.ts/); assert.match(back, /戻す SQL は用意していません/);
  for (const f of ['work-requests_v1168_index.ts', 'チャットのプッシュ通知の鍵_v1168.txt']) assert.ok(!fs.existsSync(new URL(f, D)), f + ' never goes into the repository');
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci|CHAT_VAPID_PRIVATE\s*[=:]\s*\S{20,}/, f + ' has no keys');
});

async function base({ ui79 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  for (const f of WR) await pg.exec(M(f));
  await pg.exec(CHAT); await pg.exec(FILES);
  if (ui79) await pg.exec(UI79);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');

test('before the UI79 SQL: the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await base({ ui79: false });
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), '2'); assert.equal(pre('3.'), 'OK'); assert.equal(pre('4.'), 'OK');
  await assert.rejects(pg.exec(read('2_SQL_チャットの守り.sql')), /STOP: 先にチャット/);
  assert.equal((await pg.query(`select to_regclass('public.chat_guard') r`)).rows[0].r, null);
});

test('after the UI79 SQL: the pre-check is all OK (stage 3, first time); the check before 2 says NG without failing; after 2 all OK; running 2 twice is the same', async () => {
  const pg = await base();
  const pre = await rowsOf(pg, '1_最初に確認_読むだけ.sql');
  assert.ok(!pre.some(r => /^STOP/.test(r.result)), JSON.stringify(pre));
  assert.equal(by(pre)('2.'), '3');
  assert.equal(by(pre)('（参考）チャットの暗証番号'), '—（まだ）');
  const early = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(early.filter(r => !/^（参考）/.test(r.check_name)).some(r => /^NG/.test(r.result)), 'NG before 2');
  await pg.exec(read('2_SQL_チャットの守り.sql'));
  let post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post.filter(r => r.result !== 'OK')));
  assert.equal(by(post)('（参考）'), '0・0・0');
  await pg.exec(read('2_SQL_チャットの守り.sql'));
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post));
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('2.'), '4');
});

test('running the older chat SQL again after 2 stops (v1169) and changes nothing (before, 1 and 4 turned NG: the protection was off); 2 itself can run again', async () => {
  const pg = await base();
  await pg.exec(read('2_SQL_チャットの守り.sql'));
  const fns = async () => (await pg.query(`select string_agg(p.proname || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)) v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'chat%'`)).rows[0].v;
  const before = await fns();
  for (const [sql, n] of [[UI79, 4], [CHAT, 4], [FILES, 4]]) await assert.rejects(pg.exec(sql), new RegExp(`STOP: これより新しいチャットの SQL（段 ${n}）が入っています`));
  assert.equal(await fns(), before, 'no chat function changed');
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')), 'the protection is still on');
  await pg.exec(read('2_SQL_チャットの守り.sql'));
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
});

test('the check finds a PIN or key stored as is (8) and a table readable with the public key (5)', async () => {
  const pg = await base();
  await pg.exec(read('2_SQL_チャットの守り.sql'));
  await pg.exec(`alter table public.chat_guard drop constraint chat_guard_pin_hash_check; insert into public.chat_guard(emp_id, pin_hash) values ('E1', '4321')`);
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('8.'), /^NG/);
  await pg.exec(`delete from public.chat_guard; grant select on public.chat_sess to anon`);
  const r = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.equal(r('8.'), 'OK'); assert.match(r('5.'), /^NG/);
});
