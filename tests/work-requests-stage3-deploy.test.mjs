// v1159 段階 3：Moto さんが貼るファイル（deploy/work-requests-v1159）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/work-requests-v1159/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const WR = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68'];
const S2 = '20261120090000_work_requests_stage2', S3 = M('20261123090000_work_requests_stage3');

test('the SQL to paste is the migration letter for letter; the steps name the order, the private file and the chat', () => {
  assert.equal(read('2_SQL_段階3.sql'), S3);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1159_index\.ts`（非公開/); assert.match(h, /1159/);
  assert.match(h, /チャットの ④（v1156 のファイル）の代わりにこれを貼って/);
  assert.match(h, /#151（v1157）→ #152（v1158）→ この PR（v1159）/);
  assert.ok(!fs.existsSync(new URL('work-requests_v1159_index.ts', D)), 'the PIN check file never goes into the repository');
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
    insert into public.app_state(key, value) values ('approvals', '[{"id":"ap1792000000001","type":"休暇","status":"pending"},{"id":"ap1792000000002","type":"休暇","status":"pending","wrq":1}]'),
      ('spl_approvals_S1', '{"__st":1,"v":[{"id":"ap1792000000003","type":"スキル","status":"approved"}]}');`);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');

test('before stage 2 the pre-check says STOP and the SQL changes nothing; on top of stage 2 all OK (twice); the post-check notices what it should', async () => {
  const pg = await base();
  for (const f of WR) await pg.exec(M(f));
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.match(pre('1.'), /^STOP/);
  await assert.rejects(pg.exec(read('2_SQL_段階3.sql')), /STOP: 先に段階 2/);
  await pg.exec(M(S2));
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '5'); assert.equal(pre('3.'), 'いいえ');
  assert.equal(pre('（参考）前の承認タブの承認待ち'), '1', 'the one already in the work center is not counted');
  assert.equal(pre('（参考）前の承認タブの記録の数'), '3', 'the split row is read too');
  await pg.exec(read('2_SQL_段階3.sql')); await pg.exec(read('2_SQL_段階3.sql'));
  const post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('2.'), '6');
  // 段階 2 の SQL をあとで流し直すと戻る → 1 と 3 が NG（もう一度 2）
  await pg.exec(M(S2));
  const P = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match(P('1.'), /^NG/); assert.match(P('3.'), /^NG/);
  await pg.exec(read('2_SQL_段階3.sql'));
  await pg.exec('grant execute on function public.wr_s3_import(jsonb) to anon');
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('4.'), /^NG/);
  await pg.exec('revoke execute on function public.wr_s3_import(jsonb) from anon; alter function public.wr_s3_kind(text) security definer');
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('5.'), /^NG/);
  // #153 の Codex（6880375329）：店・月の鍵を取らない前の wr_s3_import（11/14 に本番へ入った形）に戻っていたら 6 が NG
  await pg.exec('alter function public.wr_s3_kind(text) security invoker');
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('6.'), 'OK');
  const before = M('20261123090000_work_requests_stage3').match(/create or replace function public\.wr_s3_import[\s\S]*?\nend \$\$;\n/)[0]
    .replace(/ -- #153 の Codex（6880375329）[\s\S]*? end loop;\n/, '').replace(/   if v_kind = 'budget' and not v_hist and not \(\('wr_bg:'[^\n]*\n/, '');
  assert.doesNotMatch(before, /wr_bg/);
  await pg.exec(before);
  assert.match(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('6.'), /^NG/);
  await pg.exec(read('2_SQL_段階3.sql'));
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
});

// 11/14 の直し（#153 の Codex 6880375329）は、本番（チャット・Google の口コミ・段階 3・添付が入ったあと）でこの ② を流し直して入れる。
// 流し直しても、添付・チャット・Google の確認は OK のまま（ほかの関数を前に戻さない）・写した記録は変えない
test('re-running this SQL in production (after the chat, Google reviews and attachments SQL) keeps their checks OK and changes no copied record', async () => {
  const pg = await base();
  await pg.exec(`create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create policy "invoices read" on storage.objects for select to anon using (bucket_id = 'invoices');`);
  for (const f of [...WR, S2, '20261121090000_chat', '20261122090000_google_reviews']) await pg.exec(M(f));
  await pg.exec(S3);
  await pg.exec(M('20261124090000_chat_files'));
  await pg.exec(`insert into public.wr_requests(code, kind, status, store_id, requester_name, payload, ap_id, legacy, legacy_ref, legacy_info, submitted_at)
    values ('BG-2610-0001', 'budget', 'pending', 'S1', 'x', '{"ym":"2026-12","ap_id":"ap1792000000009","title":"t","total_cents":1}', 'ap1792000000009', true, 'ap:ap1792000000009', '{"src":"approvals","id":"ap1792000000009"}', now())`);
  const snap = async () => (await pg.query(`select to_jsonb(r) - 'updated_at' v from public.wr_requests r order by code`)).rows.map(r => JSON.stringify(r.v));
  const before = await snap();
  const checks = [['work-requests-v1159', '3_確認_読むだけ.sql'], ['chat-files-v1161', '3_確認_読むだけ.sql'], ['chat-v1156', '3_確認_読むだけ.sql'], ['google-reviews-v1157', '3_確認_読むだけ.sql']];
  const run = async () => { const o = {}; for (const [d, f] of checks) o[d] = (await pg.query(fs.readFileSync(new URL('../deploy/' + d + '/' + f, import.meta.url), 'utf8'))).rows
    .filter(r => !/^（参考）/.test(r.check_name)).map(r => r.check_name.split(' ')[0] + r.result); return o; };
  const was = await run();
  for (const d of ['work-requests-v1159', 'chat-files-v1161']) assert.ok(was[d].every(x => /^[0-9.]+OK/.test(x)), d + ' ' + JSON.stringify(was[d]));
  await pg.exec(read('1_最初に確認_読むだけ.sql'));
  await pg.exec(read('2_SQL_段階3.sql'));
  assert.deepEqual(await run(), was, 'every check reads the same after the re-run');
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
  assert.deepEqual(await snap(), before, 'no request changed');
});
