// v1209 Google の評価・口コミ（Places API（新））：Moto さんが貼るファイル（deploy/google-places-v1209）が migration・関数と同じか、
// 確かめの SQL（①・③）が読むべきものを読むか。合成の DB（v1157 の SQL の上）だけ。本番にはつながない。
// 11/23 の更新：2b（住所で確かめる・1 店 1 日 1 回・見られる店）も。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/google-places-v1209/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261215090000_google_places_caps.sql', import.meta.url), 'utf8');
const SQL2B = fs.readFileSync(new URL('../supabase/migrations/20261215100000_google_places_scope.sql', import.meta.url), 'utf8');
const V1157 = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const HANDLER = fs.readFileSync(new URL('../supabase/functions/google-reviews/handler.mjs', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../supabase/functions/google-reviews/index.ts', import.meta.url), 'utf8');

test('the SQL to paste is the migration; the one-file function is the current handler plus the serve line; the steps say what Moto needs', () => {
  assert.equal(read('2_SQL_Places上限.sql'), SQL);
  assert.equal(read('2b_SQL_住所で確かめ.sql'), SQL2B);
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
  for (const s of ['GOOGLE_PLACES_API_KEY', '1_最初に確認_読むだけ.sql', '2_SQL_Places上限.sql', '2b_SQL_住所で確かめ.sql', '3_確認_読むだけ.sql', '4_関数_google-reviews_index.ts', '止める_Places.sql', '戻す.md']) assert.ok(h.includes(s), s);
  assert.match(fn.split('\n')[2], /② と 2b の SQL/, 'the header says to run ② and 2b first');
  // 11/23 14:36 の更新：毎日取って残さない理由・住所で確かめる・LaLa・見られる店・1 店 1 日 1 回・規約とプライバシー
  for (const s of ['3.2.3(b)', 'place ID だけ', '毎朝の自動の呼び出し（スケジュール）は入れません', 'Business Profile API', '住所で確かめた', '手で確かめた', 'LaLa', '選ぶまで Google を呼ばない',
    'AM＝担当（管轄）の店だけ', 'G4 以下＝配属の店だけ', '1 店 1 日 1 回', '確かめた店の数', 'places_store_day_max = 3', 'Place Details Pro', 'Text Search Pro',
    'https://maps.google.com/help/terms_maps/', 'https://policies.google.com/privacy', 'insert into public.gr_place_hint', '合成のデータと偽の Google'])
    assert.ok(h.includes(s), s);
  assert.match(h, /#211 → #213 → #212 → #214 → #215/, 'the merge order');
  assert.match(h, /関連性の高い順/); assert.match(h, /新しい順ではない/);
  assert.match(h, /アプリケーションの制限/); assert.match(h, /予算/); assert.match(h, /割り当て/);
  assert.match(h, /1,000 回/); assert.match(h, /5,000 回/);
  for (const n of ['40 回', '1 回', '25 回', '900 回', '400 回']) assert.ok(h.includes(n), n);
  assert.match(read('戻す.md'), /止める_Places\.sql/);
  assert.match(read('戻す.md'), /2b をもう一度/);
  assert.match(read('戻す.md'), /deploy\/google-reviews-v1157\/4_関数_google-reviews_index\.ts/);
  // 上限のはじめの値が SQL と同じ
  for (const [k, v] of [['places_day_max', 40], ['places_store_day_max', 10], ['places_person_day_max', 25], ['places_month_max', 900], ['search_day_max', 40], ['search_month_max', 400]])
    assert.match(SQL, new RegExp('add column if not exists ' + k + ' int not null default ' + v + ' '), k);
  // 2b：1 店 1 日は 1 回に（はじめの 10 のままのときだけ。変えていたら残す）
  assert.match(SQL2B, /alter column places_store_day_max set default 1;/);
  assert.match(SQL2B, /update public\.gr_settings set places_store_day_max = 1 where id = 1 and places_store_day_max = 10;/);
  assert.match(read('止める_Places.sql'), /^update public\.gr_settings set places_day_max = 0, search_day_max = 0 where id = 1;$/m);
  assert.match(read('止める_Places.sql'), /places_day_max = 40, search_day_max = 40/);
  // 鍵・トークンは入れない
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /AIza[0-9A-Za-z_-]{20,}|GOCSPX-|eyJhbGci|1\/\/0[0-9A-Za-z_-]{20,}|SUPABASE_SERVICE_ROLE_KEY=|ChIJ[0-9A-Za-z_-]{10,}/, f + ' has no keys or place IDs');
  // migration の中の「戻すとき」が指すファイルがある
  assert.match(SQL, /deploy\/google-places-v1209\/戻す\.md/);
  assert.match(SQL2B, /deploy\/google-places-v1209\/戻す\.md/);
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

const confirmF01 = pg => pg.query(`select public.gr_place_confirm('{"store":"F01","place_id":"PLACE_ID_FOR_TEST_F01","g_addr":"2334 S King St, Honolulu, HI 96826","g_name":"ToriTon","emp":"E1","name":"GM"}'::jsonb) r`);

test('without the v1157 SQL: the pre-check says STOP and the SQL stops without changing anything; 2b without ② stops too', async () => {
  const pg = await base({ v1157: false });
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), 'まだ（② を流す）'); assert.equal(pre('2b.'), 'まだ（② のあと 2b を流す）');
  await assert.rejects(pg.exec(read('2_SQL_Places上限.sql')), /STOP: 先に v1157 の SQL/);
  assert.equal((await pg.query("select to_regclass('public.gr_places_use') t")).rows[0].t, null, 'nothing was made');
  const pg2 = await base();
  await assert.rejects(pg2.exec(read('2b_SQL_住所で確かめ.sql')), /STOP: 先に 20261215090000/);
  assert.equal((await pg2.query("select to_regclass('public.gr_place_hint') t")).rows[0].t, null, 'nothing was made');
});

test('the first time (with a store master): pre-check, ② and 2b twice, post-check all OK; a v1157 link is not used until it is confirmed', async () => {
  const pg = await base({ stores: [{ id: 'F01' }, { id: 'F02' }, { id: 'F06' }, { id: 'F07' }, { id: 'F09', active: false }, { id: 'F10', data: { _deleted: true } }] });
  await link(pg, 'F01');
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), 'まだ（② を流す）'); assert.equal(pre('2b.'), 'まだ（② のあと 2b を流す）'); assert.equal(pre('3.'), 'OK');
  assert.equal(pre('4.'), 'OK（無し）'); assert.match(pre('5.'), /^なし/, 'no wr_person_conf in this test database: not a STOP');
  assert.equal(pre('（参考）Google の店を結んだ店'), 'F01', 'store IDs only');
  assert.equal(pre('（参考）2b のあと確かめ直すまで'), 'F01', 'a v1157 link is not confirmed');
  await pg.exec(read('2_SQL_Places上限.sql'));
  await pg.exec(read('2_SQL_Places上限.sql'));
  let post = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.equal(post('7.'), 'NG（2b を流す）'); assert.equal(post('9.'), 'NG（2b を流す）'); assert.equal(post('10.'), 'NG（2b を流す）');
  await pg.exec(read('2b_SQL_住所で確かめ.sql'));
  await pg.exec(read('2b_SQL_住所で確かめ.sql'));
  const rows = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(rows), JSON.stringify(rows));
  const P = by(rows);
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.']) assert.equal(P(n), 'OK', n);
  assert.equal(P('（参考）上限のはじめの値'), '40・1・25・900／40・400', '1 store, once a day');
  assert.equal(P('（参考）今の上限'), '0 店・1 日 0 回・月 0 回', 'no store confirmed yet: no call at all');
  assert.equal(P('（参考）今日・今月の回数'), '0・0／0・0');
  assert.equal(P('（参考）住所で確かめた店'), 'まだ無し');
  assert.equal(P('（参考）結んであるが確かめていない店'), 'F01');
  assert.equal(P('（参考）住所の目安の無い店'), 'F07', 'F01, F02 and F06 have a hint; F09 and F10 are not used');
  assert.equal(P('（参考）手で確かめる店'), 'F06', 'LaLa is always checked by hand');
  for (const r of rows) assert.doesNotMatch(String(r.result), /PLACE_ID_FOR_TEST/, 'no place ID in the result');
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('2.'), /^もう入っている/); assert.match(pre('2b.'), /^もう入っている/);
  // まだ確かめていない店は Google を呼ばない（数えない）
  const t0 = (await pg.query(`select public.gr_places_take('{"kind":"now","emp":"E1","store":"F01"}'::jsonb) r`)).rows[0].r;
  assert.equal(t0.ok, false); assert.equal(t0.cap, 'not_confirmed');
  // 住所で確かめると 1 店・1 日 1 回・月は日数分。2 回目はその店の上限
  assert.equal((await confirmF01(pg)).rows[0].r.how, 'address');
  const t1 = (await pg.query(`select public.gr_places_take('{"kind":"now","emp":"E1","store":"F01"}'::jsonb) r`)).rows[0].r;
  assert.equal(t1.ok, true);
  const t2 = (await pg.query(`select public.gr_places_take('{"kind":"now","emp":"E2","store":"F01"}'::jsonb) r`)).rows[0].r;
  assert.equal(t2.ok, false);
  const P2 = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match(P2('（参考）今の上限'), /^1 店・1 日 1 回・月 (28|29|30|31) 回$/);
  assert.equal(P2('（参考）今日・今月の回数'), '1・1／0・0');
  assert.equal(P2('（参考）住所で確かめた店'), 'F01（住所）');
  assert.equal(P2('（参考）結んであるが確かめていない店'), '無し');
  // 上限を変えてから ② と 2b をもう一度流しても、変えた上限・確かめた印・回数は残る
  await pg.exec('update public.gr_settings set places_month_max = 500, places_store_day_max = 3 where id = 1');
  await pg.exec(read('2_SQL_Places上限.sql'));
  await pg.exec(read('2b_SQL_住所で確かめ.sql'));
  const P3 = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.equal(P3('（参考）上限のはじめの値'), '40・3・25・500／40・400');
  assert.equal(P3('（参考）今日・今月の回数'), '1・1／0・0');
  assert.equal(P3('（参考）住所で確かめた店'), 'F01（住所）');
  assert.equal(P3('7.'), 'OK');
});

test('without a store master the checks still work (store IDs by their form only)', async () => {
  const pg = await base();
  assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('3.'), /^なし/);
  await pg.exec(SQL); await pg.exec(SQL2B);
  await link(pg, 'F05');
  const rows = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(rows), JSON.stringify(rows));
  assert.equal(by(rows)('（参考）住所の目安の無い店'), '—');
});

test('the checks notice what they are meant to notice', async () => {
  const pg = await base({ stores: [{ id: 'F01' }, { id: 'F06' }] });
  await link(pg, 'F01'); await link(pg, 'F06');
  await pg.exec('delete from public.stores where id = $$F06$$');
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('4.'), 'F06', 'a linked store that is not in the store master');
  await pg.exec(SQL); await pg.exec(SQL2B);
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
  await pg.exec('grant execute on function public.gr_is_chef(jsonb) to service_role; grant select on public.gr_place_hint to anon');
  assert.match((await P())('9.'), /^NG（Claude に）/, 'the address hints readable with the public key');
  await pg.exec('revoke select on public.gr_place_hint from anon; alter table public.gr_place_hint disable row level security');
  assert.match((await P())('9.'), /^NG/);
  await pg.exec('alter table public.gr_place_hint enable row level security; drop index public.gr_places_confirmed_uq');
  assert.match((await P())('10.'), /^NG/);
  await pg.exec(SQL); await pg.exec(SQL2B);
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')), 'running ② and 2b again puts it back');
  // v1157 や ② の SQL をあとで流し直すと、店を結ぶ関数・Google を呼ぶ店の関数が前に戻る → 2b をもう一度
  await pg.exec(V1157);
  assert.match((await P())('7.'), /^NG（v1157 か ②/, 'the v1157 SQL again');
  await pg.exec(SQL2B);
  assert.equal((await P())('7.'), 'OK');
  await pg.exec(SQL);
  assert.match((await P())('7.'), /^NG（v1157 か ②/, 'the ② SQL again');
  await pg.exec(SQL2B);
  assert.equal((await P())('7.'), 'OK');
  await pg.exec('drop function public.gr_places_linked(jsonb)');
  assert.match((await P())('4.'), /^NG（35 個）/);
  await pg.exec(SQL); await pg.exec(SQL2B);
  await pg.exec('alter table public.gr_settings drop column search_month_max');
  assert.match((await P())('1.'), /^NG/);
  assert.equal((await P())('（参考）上限のはじめの値'), '—');
  assert.equal((await P())('（参考）今の上限'), '—');
  assert.equal((await P())('（参考）今日・今月の回数'), '—', 'no error when a column is missing');
});
