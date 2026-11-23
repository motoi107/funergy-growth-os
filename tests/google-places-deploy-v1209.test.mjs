// v1209 Google の評価・口コミ（Places API（新））：Moto さんが貼るファイル（deploy/google-places-v1209）が migration・関数と同じか、
// 確かめの SQL（①・③）が読むべきものを読むか。合成の DB（v1157 の SQL の上）だけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/google-places-v1209/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261215090000_google_places_caps.sql', import.meta.url), 'utf8');
const V1157 = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const HANDLER = fs.readFileSync(new URL('../supabase/functions/google-reviews/handler.mjs', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../supabase/functions/google-reviews/index.ts', import.meta.url), 'utf8');

test('the SQL to paste is the migration; the one-file function is the current handler plus the serve line; the steps say what Moto needs', () => {
  assert.equal(read('2_SQL_Places上限.sql'), SQL);
  const fn = read('4_関数_google-reviews_index.ts');
  assert.ok(fn.startsWith('// @ts-nocheck\n'), 'no type check on the plain JavaScript');
  const lines = fn.split('\n');
  assert.equal(lines[3], '', 'four header lines (ts-nocheck, two comments, a blank)');
  assert.equal(lines.slice(4).join('\n'), HANDLER + '\nDeno.serve(createHandler({ env: (key) => Deno.env.get(key) }));\n', 'the current handler, letter for letter, and the serve line');
  assert.match(INDEX, /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/, 'the same serve line as index.ts');
  assert.doesNotMatch(fn, /^import /m, 'one file: nothing to import');
  assert.match(HANDLER, /export const NOW_MASK = 'id,displayName,formattedAddress,googleMapsUri,rating,userRatingCount,reviews,attributions';/);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/);
  assert.match(h, /1209/);
  for (const s of ['GOOGLE_PLACES_API_KEY', '1_最初に確認_読むだけ.sql', '2_SQL_Places上限.sql', '3_確認_読むだけ.sql', '4_関数_google-reviews_index.ts', '止める_Places.sql', '戻す.md']) assert.ok(h.includes(s), s);
  assert.match(h, /#211 → #213 → #212 → #214 → #215/, 'the merge order');
  assert.match(h, /関連性の高い順/); assert.match(h, /新しい順ではない/);
  assert.match(h, /アプリケーションの制限/); assert.match(h, /予算/); assert.match(h, /割り当て/);
  assert.match(h, /1,000 回/); assert.match(h, /5,000 回/);
  for (const n of ['40 回', '10 回', '25 回', '900 回', '400 回']) assert.ok(h.includes(n), n);
  assert.match(read('戻す.md'), /止める_Places\.sql/);
  assert.match(read('戻す.md'), /deploy\/google-reviews-v1157\/4_関数_google-reviews_index\.ts/);
  // 上限のはじめの値が SQL と同じ
  for (const [k, v] of [['places_day_max', 40], ['places_store_day_max', 10], ['places_person_day_max', 25], ['places_month_max', 900], ['search_day_max', 40], ['search_month_max', 400]])
    assert.match(SQL, new RegExp('add column if not exists ' + k + ' int not null default ' + v + ' '), k);
  assert.match(read('止める_Places.sql'), /^update public\.gr_settings set places_day_max = 0, search_day_max = 0 where id = 1;$/m);
  assert.match(read('止める_Places.sql'), /places_day_max = 40, search_day_max = 40/);
  // 鍵・トークンは入れない
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /AIza[0-9A-Za-z_-]{20,}|GOCSPX-|eyJhbGci|1\/\/0[0-9A-Za-z_-]{20,}|SUPABASE_SERVICE_ROLE_KEY=|ChIJ[0-9A-Za-z_-]{10,}/, f + ' has no keys or place IDs');
  // migration の中の「戻すとき」が指すファイルがある
  assert.match(SQL, /deploy\/google-places-v1209\/戻す\.md/);
  assert.ok(fs.existsSync(new URL('戻す.md', D)));
});

async function base({ v1157 = true, stores = null } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  if (stores) {
    await pg.exec(`create table public.stores (id text primary key, name text, active boolean, data jsonb)`);
    for (const s of stores) await pg.query('insert into public.stores values ($1, $2, $3, $4)', [s.id, s.id, s.active !== false, s.data || {}]);
  }
  if (v1157) await pg.exec(V1157);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');
const link = (pg, s) => pg.query("insert into public.gr_places (store_id, place_id) values ($1, 'PLACE_ID_FOR_TEST_' || $1) on conflict (store_id) do nothing", [s]);

test('without the v1157 SQL: the pre-check says STOP and the SQL stops without changing anything', async () => {
  const pg = await base({ v1157: false });
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), 'まだ（② を流す）');
  await assert.rejects(pg.exec(read('2_SQL_Places上限.sql')), /STOP: 先に v1157 の SQL/);
  assert.equal((await pg.query("select to_regclass('public.gr_places_use') t")).rows[0].t, null, 'nothing was made');
});

test('the first time (with a store master): pre-check, the SQL twice, post-check all OK; then the pre-check says it is in', async () => {
  const pg = await base({ stores: [{ id: 'F01' }, { id: 'F02' }, { id: 'F09', active: false }, { id: 'F10', data: { _deleted: true } }] });
  await link(pg, 'F01');
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), 'まだ（② を流す）'); assert.equal(pre('3.'), 'OK');
  assert.equal(pre('4.'), 'OK（無し）'); assert.match(pre('5.'), /^なし/, 'no wr_person_conf in this test database: not a STOP');
  assert.equal(pre('（参考）Google の店を結んだ店'), 'F01', 'store IDs only');
  await pg.exec(read('2_SQL_Places上限.sql'));
  await pg.exec(read('2_SQL_Places上限.sql'));
  const post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  const P = by(post);
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.']) assert.equal(P(n), 'OK', n);
  assert.equal(P('（参考）上限'), '40・10・25・900／40・400');
  assert.equal(P('（参考）今日・今月の回数'), '0・0／0・0');
  assert.equal(P('（参考）Google の店を結んだ店'), 'F01');
  for (const r of post) assert.doesNotMatch(String(r.result), /PLACE_ID_FOR_TEST/, 'no place ID in the result');
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('2.'), /^もう入っている/);
  // 回数を取ると（参考）に出る。② をもう一度流しても回数と上限の変更は残る
  await pg.query("select public.gr_places_take('{\"kind\":\"now\",\"emp\":\"E1\",\"store\":\"F01\"}'::jsonb)");
  await pg.exec('update public.gr_settings set places_month_max = 500 where id = 1');
  await pg.exec(read('2_SQL_Places上限.sql'));
  const P2 = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.equal(P2('（参考）上限'), '40・10・25・500／40・400');
  assert.equal(P2('（参考）今日・今月の回数'), '1・1／0・0');
});

test('without a store master the checks still work (store IDs by their form only)', async () => {
  const pg = await base();
  assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('3.'), /^なし/);
  await pg.exec(SQL);
  await link(pg, 'F05');
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
});

test('the checks notice what they are meant to notice', async () => {
  const pg = await base({ stores: [{ id: 'F01' }, { id: 'F06' }] });
  await link(pg, 'F01'); await link(pg, 'F06');
  await pg.exec('delete from public.stores where id = $$F06$$');
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('4.'), 'F06', 'a linked store that is not in the store master');
  await pg.exec(SQL);
  const P = async () => by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match((await P())('8.'), /^NG（F06/);
  await pg.exec("delete from public.gr_places where store_id = 'F06'");
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
  await pg.exec("update public.stores set active = false where id = 'F01'");
  assert.match((await P())('8.'), /^NG（F01/, 'a store that is not used any more');
  await pg.exec("update public.stores set active = true, data = '{\"_deleted\":true}' where id = 'F01'");
  assert.match((await P())('8.'), /^NG（F01/, 'a deleted store');
  await pg.exec("update public.stores set data = '{}' where id = 'F01'");
  assert.equal((await P())('8.'), 'OK');
  await pg.exec('alter table public.gr_places_use disable row level security');
  assert.match((await P())('2.'), /^NG/);
  await pg.exec('alter table public.gr_places_use enable row level security; grant select on public.gr_places_use to anon');
  assert.match((await P())('3.'), /^NG/, 'the count table readable with the public key');
  await pg.exec('revoke select on public.gr_places_use from anon; grant execute on function public.gr_places_take(jsonb) to authenticated');
  assert.match((await P())('5.'), /^NG/);
  await pg.exec('revoke execute on function public.gr_places_take(jsonb) from authenticated; alter function public.gr_places_usage(jsonb) security definer');
  assert.match((await P())('4.'), /^NG/);
  await pg.exec('alter function public.gr_places_usage(jsonb) security invoker; revoke execute on function public.gr_is_chef(jsonb) from service_role');
  assert.match((await P())('6.'), /^NG/);
  await pg.exec(SQL);
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')), 'running the SQL again puts it back');
  // v1157 の SQL をあとで流し直すと、店を結ぶ関数が前に戻る（店舗マスターを見ない）
  await pg.exec(V1157);
  assert.match((await P())('7.'), /^NG/, 'the v1157 SQL again');
  await pg.exec(SQL);
  assert.equal((await P())('7.'), 'OK');
  await pg.exec('drop function public.gr_places_linked(jsonb)');
  assert.match((await P())('4.'), /^NG（25 個）/);
  await pg.exec(SQL);
  await pg.exec('alter table public.gr_settings drop column search_month_max');
  assert.match((await P())('1.'), /^NG/);
  assert.equal((await P())('（参考）上限'), '—');
  assert.equal((await P())('（参考）今日・今月の回数'), '—', 'no error when a column is missing');
});
