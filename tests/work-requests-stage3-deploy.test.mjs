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
});
