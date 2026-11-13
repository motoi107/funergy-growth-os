// v1155 work-requests 段階 2：Moto さんが貼るファイル（deploy/work-requests-v1155）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/work-requests-v1155/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const S2 = M('20261120090000_work_requests_stage2');
const V1135 = fs.readFileSync(new URL('../deploy/work-requests-v1135/2_SQL_まとめて.sql', import.meta.url), 'utf8');
const CHEF = M('20261113080000_wr_people_chef'), G2 = M('20261116080000_wr_people_g2');

test('the SQL to paste is the stage-2 migration, letter for letter; the steps say the order and that the function file is private', () => {
  assert.equal(read('2_SQL_段階2.sql'), S2);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1155_index\.ts`（非公開/); assert.match(h, /1155/); assert.match(h, /#148/);
  assert.match(h, /段階 2 を使い始める/);
  assert.ok(!fs.existsSync(new URL('work-requests_v1155_index.ts', D)), 'the PIN check file never goes into the repository');
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
    insert into public.manager_auth(role, emp_id) values ('gm','E2'),('office','E3');`);
  return pg;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');

test('before v1131〜v1135 the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await base();
  const pre = await rowsOf(pg, '1_最初に確認_読むだけ.sql');
  assert.match(by(pre)('1.'), /^STOP/); assert.equal(by(pre)('2.'), '—'); assert.match(by(pre)('6.'), /^STOP/);
  assert.equal(by(pre)('（参考）今の申請の数'), '—', 'the pre-check itself never stops on a missing table');
  await assert.rejects(pg.exec(S2), /STOP: 先に 1 段目〜v1135/);
  assert.equal((await pg.query(`select to_regprocedure('public.wr_s2_save(jsonb)') v`)).rows[0].v, null);
});

test('on top of the v1135 set and the v1144/v1147 fixes: pre-check, the SQL (twice), post-check; requests and settings are kept; re-running an old set is caught', async () => {
  const pg = await base();
  await pg.exec(V1135); await pg.exec(CHEF); await pg.exec(G2);
  await pg.exec(`update public.wr_settings set live = true;
    insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, payload)
     values ('GS-2611-0001','mileage','pending','S1','E7','Lee Leader','{}');`);
  const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '4', 'the first time'); assert.equal(pre('3.'), 'OK');
  assert.match(pre('4.'), /^OK/); assert.match(pre('5.'), /^OK/); assert.equal(pre('6.'), 'true');
  await pg.exec(read('2_SQL_段階2.sql'));
  let post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post));
  assert.equal(by(post)('（参考）wr_ の関数の数'), '71', 'with the Head Chef fix (v1144)');
  assert.equal(by(post)('（参考）段階 2 を使い始めたか'), 'false', 'nothing changes until the GM or CEO turns it on');
  await pg.exec(read('2_SQL_段階2.sql'));
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), 'twice: the same ' + JSON.stringify(post));
  assert.equal(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('2.'), '5', 'the pre-check now says it is in');
  assert.deepEqual((await pg.query(`select code, status from public.wr_requests`)).rows, [{ code: 'GS-2611-0001', status: 'pending' }]);
  assert.equal((await pg.query(`select live from public.wr_settings where id = 1`)).rows[0].live, true, 'still live');
  // an old set run again puts its own dispatchers back: the check shows NG until ② runs again
  await pg.exec(V1135);
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.match(by(post)('7.'), /^NG/); assert.match(by(post)('10.'), /^NG/, 'and v1135 alone takes G2 out again');
  await pg.exec(read('2_SQL_段階2.sql')); await pg.exec(G2);
  assert.ok(okAll(await rowsOf(pg, '3_確認_読むだけ.sql')));
});

test('without the v1147 fix the pre-check and the post-check say so (stage 2 itself does not need it)', async () => {
  const pg = await base();
  await pg.exec(V1135);
  assert.match(by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'))('3.'), /^NG/);
  await pg.exec(S2);
  const post = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match(post('10.'), /^NG/); assert.equal(post('9.'), 'OK'); assert.equal(post('（参考）wr_ の関数の数'), '70');
});
