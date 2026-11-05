// v1141（2b-3）：ガソリン代の単価（mileage_config）と Score管理（career_cfg）を公開の鍵で書けなくする SQL（20261110090000）を
// 本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1140 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は 2 つのキーを読めるが、足す・上書き・直す・消す・
//     名前を変えて入れる、ができない。ほかの行は今までどおり。サーバーの鍵は書ける。行の一覧（app_state_index）にも今までどおり出る
//   ・成長カルテ・賞与・Career Score（v1139・v1140）は外したまま。ガソリン代の単価（wr_mileage_rate）は今までどおり読める
//   ・2 回流しても同じ。最初に確かめる SQL が動く・確認の SQL がすべて OK（穴があれば NG）
//   ・戻す SQL で v1140 のあとと同じ（2 つのキーはまた書ける・ほかの決まりはそのまま）
//   ・SQL の決まり（ss_guard_key）と関数の決まり（swIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { swIsKey } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-settings-precheck.sql');
const POST = rd('db/secure-settings-postcheck.sql');
const BACK = rd('db/secure-settings-write-rollback.sql');
const GUARD = ['mileage_config', 'career_cfg'];
const SECRET = ['growth_karte', 'lss_emp_Kai One'];
const OTHER = ['tasks_all', 'cs_criteria', 'mileage_requests', 'notifications'];

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM'), ('ceo','E-CEO'), ('office', null), ('office_crew','E-OC');`);
  await db.exec(WR);   // wr_mileage_rate（ガソリン代の単価を読む関数）
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  await db.query(`insert into public.app_state(key, value) values ('mileage_config', $1), ('career_cfg', $2)`, [JSON.stringify({ gmapsKey: 'AIza-secret-x', ratePerMile: 0.7, roundTripDefault: true }), JSON.stringify({ '経理|G4': { csApprove: ['am'], _at: 5 } })]);
  await db.exec(`insert into public.app_state(key, value) values ${[...SECRET, ...OTHER].map(k => `('${k}', '{"v":1}')`).join(',')};`);
  await db.exec(IDX);
  if (initial === 'v1140') { await db.exec(MIG39); await db.exec(MIG40); }
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
const rate = async db => Number((await db.query('select public.wr_mileage_rate() r')).rows[0].r);

for (const initial of ['v1140', 'off', 'on']) {
  test(`settings write guard (from ${initial}): anon/authenticated read but cannot write the two keys; the rest is unchanged; rollback`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 9);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, initial === 'off' ? /^info/ : /^OK/);
    assert.match(pre.find(x => x.n === 3).ok, initial === 'v1140' ? /^OK/ : /^info/);
    assert.equal(pre.find(x => x.n === 4).value, '0');
    assert.equal(pre.find(x => x.n === 5).value, '0.7'); assert.equal(pre.find(x => x.n === 5).ok, 'OK');
    assert.equal(pre.find(x => x.n === 6).value, '入っている'); assert.ok(!JSON.stringify(pre).includes('AIza-secret-x'), 'the map key itself is never shown');
    assert.match(pre.find(x => x.n === 7).value, /^1 件・/);
    assert.equal(pre.find(x => x.n === 8).value, '1'); assert.match(pre.find(x => x.n === 8).ok, /^info/);
    assert.equal(pre.find(x => x.n === 9).value, '3'); assert.equal(pre.find(x => x.n === 9).ok, 'OK');
    const allBefore = keysOf(await as(db, 'anon', 'select key from public.app_state'));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), allBefore, role + ' reads the same rows as before');
      assert.equal((await as(db, role, `select value->>'ratePerMile' r from public.app_state where key = 'mileage_config'`)).rows[0].r, '0.7', role + ' reads the rate');
      for (const k of GUARD) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('${k}', '{"ratePerMile":4}') on conflict (key) do update set value = excluded.value`), role + ' cannot upsert ' + k);
        assert.equal((await as(db, role, `update public.app_state set value = '{"ratePerMile":4}' where key = '${k}'`)).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = '${k}'`)).affectedRows, 0, role + ' cannot delete ' + k);
      }
      // 行が無いときも足せない
      await db.exec(`delete from public.app_state where key = 'career_cfg'`);
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('career_cfg', '{}')`), role + ' cannot create career_cfg');
      await db.query(`insert into public.app_state(key, value) values ('career_cfg', $1)`, [JSON.stringify({ '経理|G4': { csApprove: ['am'], _at: 5 } })]);
      // ほかの行は今までどおり
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = 'tasks_all'`)).affectedRows, 1);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    // 名前を変えて対象のキーにする：断られる（行が無いときと、ほかの行を移すとき）
    await db.exec(`delete from public.app_state where key = 'mileage_config'`);
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'mileage_config' where key = 'tasks_all'`), 'cannot rename a row into a guarded key');
    assert.equal((await as(db, 'service_role', `insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.72}') returning key`)).rows.length, 1, 'the server key writes');
    assert.equal(await rate(db), 0.72, 'wr_mileage_rate reads the rate as before');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where key in ('mileage_config','career_cfg')`)), [...GUARD].sort(), 'still in the row list');
    // 成長カルテ・Career Score（v1139・v1140 の SQL のあとだけ）は外したまま
    if (initial === 'v1140') assert.equal((await as(db, 'anon', `select key from public.app_state where key in ('growth_karte','lss_emp_Kai One')`)).rows.length, 0);
    const rows = await postRows(db);
    assert.equal(rows.length, 12);
    rows.filter(x => x.ok !== 'info').forEach(x => assert.equal(x.ok, 'OK', x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 4).value, '2'); assert.equal(rows.find(x => x.n === 5).value, '2');
    assert.equal(rows.find(x => x.n === 12).value, '0.72');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'zz_v1141_postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.equal(await rate(db), 0.72, 'the postcheck changed nothing');
    assert.equal((await db.query(`select current_user u`)).rows[0].u, 'postgres');
    // 穴があれば NG
    await db.exec('alter policy ss_guard_upd on public.app_state using (true) with check (true)');
    await db.exec('alter policy ss_guard_ins on public.app_state with check (true)');
    await db.exec('alter policy ss_guard_del on public.app_state using (true)');
    const bad = await postRows(db);
    for (const n of [6, 7, 8, 10]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec('drop policy ss_guard_del on public.app_state');
    assert.equal((await postRows(db)).find(x => x.n === 2).ok, 'NG', 'a missing policy is NG');
    await db.exec(MIG);
    // 戻す（2 回流しても同じ）
    await db.exec(BACK); await db.exec(BACK);
    assert.equal((await as(db, 'anon', `update public.app_state set value = '{"ratePerMile":0.9}' where key = 'mileage_config'`)).affectedRows, 1, 'writable again after the rollback');
    if (initial === 'v1140') assert.equal((await as(db, 'anon', `update public.app_state set value = '{"y":1}' where key = 'growth_karte'`)).affectedRows, 0, 'the karte keys stay closed');
    await db.exec(MIG);
    assert.equal((await as(db, 'anon', `update public.app_state set value = '{"ratePerMile":0.95}' where key = 'mileage_config'`)).affectedRows, 0, 'and closed again');
    await db.close();
  });
}

test('the SQL rule and the function rule agree on every key', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const keys = [...GUARD, ...SECRET, ...OTHER, 'mileage_config ', ' career_cfg', 'Mileage_config', 'career_cfg\n', 'career', 'mileage', 'toString', '__proto__', ''];
  for (let i = 0; i < 200; i++) keys.push(['mileage_', 'career_', 'cfg', ''][i % 4] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) assert.equal((await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s, swIsKey(k), JSON.stringify(k));
  assert.equal((await db.query('select public.ss_guard_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy; the precheck sees a bad rate and no writer', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  // 単価が使えない・単価を変えられる人がいない：最初に確かめる SQL が NG・STOP
  await d2.exec(`update public.app_state set value = '{"__st":1,"v":{"ratePerMile":7}}' where key = 'mileage_config'; delete from public.manager_auth where role in ('ceo','gm','office');`);
  const pre = (await d2.query(PRE)).rows;
  assert.equal(pre.find(x => x.n === 5).value, '7'); assert.match(pre.find(x => x.n === 5).ok, /^NG/);
  assert.match(pre.find(x => x.n === 9).ok, /^STOP/);
  await d2.exec(`delete from public.app_state where key = 'mileage_config'`);
  assert.equal((await d2.query(PRE)).rows.find(x => x.n === 5).value, '行なし');
  await d2.close();
});
