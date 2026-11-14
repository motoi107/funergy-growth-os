// v1157 Google の口コミ：Moto さんが貼るファイル（deploy/google-reviews-v1157）が migration・関数と同じか・確認の SQL が読むべきものを読むか・
// 毎日の取り込み（cron）が鍵を画面に出さずに関数を呼ぶか。合成の DB と、cron・pg_net の代わりの小さな schema だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/google-reviews-v1157/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const HANDLER = fs.readFileSync(new URL('../supabase/functions/google-reviews/handler.mjs', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../supabase/functions/google-reviews/index.ts', import.meta.url), 'utf8');

test('the SQL to paste is the migration, letter for letter; the one-file function is the handler plus the serve line; the steps say what Moto needs', () => {
  assert.equal(read('2_SQL_Google口コミ.sql'), SQL);
  const fn = read('4_関数_google-reviews_index.ts');
  assert.ok(fn.startsWith('// @ts-nocheck\n'), 'no type check on the plain JavaScript');
  const body = fn.split('\n').slice(4).join('\n');   // 先頭の 4 行（ts-nocheck・説明 2 行・空行）を除く
  assert.equal(body, HANDLER + '\nDeno.serve(createHandler({ env: (key) => Deno.env.get(key) }));\n', 'the handler, unchanged, then the same serve line as index.ts');
  assert.match(INDEX, /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/);
  assert.doesNotMatch(fn, /^import /m, 'one file: nothing to import');
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/);
  assert.match(h, /1157/);
  for (const s of ['GOOGLE_PLACES_API_KEY', 'GBP_OAUTH_CLIENT_ID', 'GBP_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_CLIENT_ID']) assert.ok(h.includes(s), s);
  assert.ok(h.includes('https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/google-reviews'), 'the redirect URI');
  assert.match(h, /business\.manage/);
  assert.match(h, /4:30/); assert.match(h, /30 14 \* \* \*/);
  assert.match(h, /手入力/); assert.match(h, /place ID/);
  assert.match(h, /戻す\.md/);
  assert.match(read('戻す.md'), /止める_毎日の取り込み\.sql/);
  // 鍵・トークンは入れない
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /AIza[0-9A-Za-z_-]{20,}|GOCSPX-|eyJhbGci|1\/\/0[0-9A-Za-z_-]{20,}|SUPABASE_SERVICE_ROLE_KEY=/, f + ' has no keys');
  // migration の中の「戻すとき」が指すファイルがある
  assert.match(SQL, /deploy\/google-reviews-v1157\/戻す\.md/);
  assert.ok(fs.existsSync(new URL('戻す.md', D)));
});

async function base() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');

test('the first time: pre-check, the SQL (twice), post-check all OK; then the pre-check says it is in', async () => {
  const pg = await base();
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), '0', 'the first time');
  assert.equal(pre('2.'), 'OK'); assert.equal(pre('3.'), 'OK');
  assert.match(pre('4.'), /^あとで/, 'no pg_cron in this test database: not a STOP');
  assert.equal(pre('（参考）もう入っている口コミの数'), '—');
  await pg.exec(read('2_SQL_Google口コミ.sql'));
  await pg.exec(read('2_SQL_Google口コミ.sql'));
  const post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  const P = by(post);
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.', '11.', '12.', '13.']) assert.equal(P(n), 'OK', n);
  assert.equal(P('（参考）Business Profile のつなぎ'), 'none');
  assert.equal(P('（参考）Google の店（place ID）を決めた店の数'), '0');
  assert.equal(P('（参考）残っている口コミの数'), '0');
  assert.equal(P('（参考）毎日の取り込み（cron）'), '—（pg_cron なし）');
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), '7', 'already in');
  assert.equal(pre('2.'), 'OK'); assert.equal(pre('3.'), 'OK');
  assert.equal(pre('（参考）もう入っている口コミの数'), '0');
  // 2 回流しても鍵は変わらない（cron の鍵が切れない）
  const k1 = (await pg.query('select worker_key from public.gr_settings')).rows[0].worker_key;
  await pg.exec(read('2_SQL_Google口コミ.sql'));
  assert.equal((await pg.query('select worker_key from public.gr_settings')).rows[0].worker_key, k1);
  assert.equal((await pg.query('select count(*)::int n from public.gr_settings')).rows[0].n, 1);
});

test('the pre-check stops on another gr_ table or function', async () => {
  const pg = await base();
  await pg.exec('create table public.gr_other(id int)');
  assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('2.'), /^STOP/);
  await pg.exec('drop table public.gr_other; create function public.gr_extra() returns int language sql as $$ select 1 $$');
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('2.'), 'OK'); assert.match(pre('3.'), /^STOP/);
});

test('the post-check notices what it is meant to notice', async () => {
  const pg = await base();
  await pg.exec(SQL);
  const P = async () => by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  await pg.exec('alter table public.gr_reviews disable row level security');
  assert.match((await P())('2.'), /^NG/);
  await pg.exec('alter table public.gr_reviews enable row level security; grant select on public.gr_bp to anon');
  assert.match((await P())('3.'), /^NG/, 'the refresh token table readable with the public key');
  await pg.exec('revoke select on public.gr_bp from anon; grant execute on function public.gr_bp_creds(jsonb) to authenticated');
  assert.match((await P())('5.'), /^NG/);
  await pg.exec('revoke execute on function public.gr_bp_creds(jsonb) from authenticated; alter function public.gr_kpi(jsonb) security definer');
  assert.match((await P())('4.'), /^NG/);
  await pg.exec('alter function public.gr_kpi(jsonb) security invoker; revoke execute on function public.gr_month(jsonb) from service_role');
  assert.match((await P())('6.'), /^NG/);
  await pg.exec('grant execute on function public.gr_month(jsonb) to service_role; drop function public.gr_stage(jsonb)');
  const p = await P();
  assert.match(p('4.'), /^NG（20 個）/); assert.equal(p('9.'), 'NG');
  await pg.exec(SQL);   // もう一度流せば戻る
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
  await pg.exec('drop index public.gr_bp_loc_location');
  assert.match((await P())('10.'), /^NG/, '#151: the one-location-one-store index');
  await pg.exec(SQL);
  // #151 の再レビュー：前の ② の消し方（1 回で消す・始めた時刻を見ない）なら 11 が NG
  await pg.exec("create or replace function public.gr_reviews_prune(p jsonb) returns jsonb language sql security invoker set search_path = public, pg_temp as $f$ select '{}'::jsonb $f$");
  assert.match((await P())('11.'), /^NG/, 'the old prune');
  await pg.exec(SQL);
  assert.equal((await P())('11.'), 'OK');
  await pg.exec('alter table public.gr_reviews drop column gone_at');
  assert.match((await P())('11.'), /^NG/, 'no gone_at column');
  await pg.exec(SQL);
  assert.equal((await P())('11.'), 'OK', 'the SQL adds the column back on a table that already exists');
  // #155 の Codex（6876878458）の 3：前の ② の入れ方（古い取り込みが新しい星・総合評価を戻す）なら 12 が NG
  await pg.exec("create or replace function public.gr_reviews_put(p jsonb) returns jsonb language sql security invoker set search_path = public, pg_temp as $f$ select '{}'::jsonb $f$");
  assert.match((await P())('12.'), /^NG/, 'the old put');
  await pg.exec(SQL);
  assert.equal((await P())('12.'), 'OK');
  await pg.exec('alter table public.gr_bp_loc drop column rating_from');
  assert.match((await P())('12.'), /^NG/, 'no rating_from column');
  await pg.exec(SQL);
  assert.equal((await P())('12.'), 'OK', 'the SQL adds the column back on a table that already exists');
  await pg.exec('drop table public.gr_runs');
  assert.match((await P())('1.'), /^NG/);
});

test('the daily read (cron): 4:30 HST once, calls the function with the key from the table (never written out), and stops', async () => {
  const pg = await base();
  await pg.exec(SQL);
  await pg.exec(`create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
    create function cron.unschedule(id int) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;
    create schema net; create table net.calls(url text, headers jsonb, body jsonb, timeout int);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net.calls values (url, headers, body, timeout_milliseconds) returning 1 $$;`);
  const sch = read('5_毎日の取り込み_cron.sql');
  assert.doesNotMatch(sch, /[0-9a-f]{40,}/, 'no key written into the SQL');
  await pg.exec(sch); await pg.exec(sch);
  const jobs = (await pg.query(`select * from cron.job`)).rows;
  assert.equal(jobs.length, 1, 'running it twice keeps one job');
  assert.equal(jobs[0].jobname, 'google-reviews-daily'); assert.equal(jobs[0].schedule, '30 14 * * *', '4:30 in Hawaii (UTC-10, no daylight time)');
  // cron がする 1 回分
  await pg.exec(jobs[0].command);
  const call = (await pg.query('select * from net.calls')).rows[0];
  assert.equal(call.url, 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/google-reviews');
  assert.deepEqual(call.body, { action: 'worker' });
  const key = (await pg.query('select worker_key from public.gr_settings')).rows[0].worker_key;
  assert.equal(call.headers['x-gr-worker-key'], key, 'the same key the function checks (gr_worker_key)');
  assert.equal((await pg.query(`select public.gr_worker_key('{}'::jsonb) k`)).rows[0].k, key);
  assert.ok(key.length >= 64);
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('（参考）毎日の取り込み（cron）'), '30 14 * * *');
  await pg.exec(read('止める_毎日の取り込み.sql'));
  assert.equal((await pg.query(`select count(*)::int n from cron.job`)).rows[0].n, 0);
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('（参考）毎日の取り込み（cron）'), 'まだ（⑤）');
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('4.'), 'あとで（⑤ の前に Database → Extensions で pg_cron と pg_net を ON）', 'the stand-in schemas are not extensions');
});
