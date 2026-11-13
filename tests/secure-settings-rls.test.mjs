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
import { swIsKey, SW2_KEYS } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-settings-precheck.sql');
const POST = rd('db/secure-settings-postcheck.sql');
const BACK = rd('db/secure-settings-write-rollback.sql');
const BACK39 = rd('db/secure-state-rls-rollback.sql');
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
    assert.match(pre.find(x => x.n === 7).value, /^1 件・.*形の合わない記録 0$/);
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
    assert.equal(rows.length, 16);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 13).ok, 'OK'); assert.equal(rows.find(x => x.n === 15).value, 'なし'); assert.equal(rows.find(x => x.n === 16).value, 'なし');
    assert.match(rows.find(x => x.n === 14).value, /^経理\|G4：/); assert.ok(!JSON.stringify(rows).includes('AIza-secret-x'), 'the map key is never shown');
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
  // v1143 で関数のキーは 10 になった（SW2_KEYS の 8 つは v1143 の SQL 20261112090000 が足す。tests/secure-settings-more-rls.test.mjs）。v1141 の SQL は 2 つだけ
  for (const k of keys) assert.equal((await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s, swIsKey(k) && !SW2_KEYS.includes(k), JSON.stringify(k));
  for (const k of SW2_KEYS) assert.equal((await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s, false, 'the v1141 SQL alone does not close ' + k);
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
  assert.equal(pre.find(x => x.n === 5).value, '7（包んだ形）'); assert.match(pre.find(x => x.n === 5).ok, /^NG/);
  assert.match(pre.find(x => x.n === 9).ok, /^STOP/);
  await d2.exec(`delete from public.app_state where key = 'mileage_config'`);
  assert.equal((await d2.query(PRE)).rows.find(x => x.n === 5).value, '行なし');
  await d2.close();
});

test('v1141 review: the postcheck shows what the direct tries cannot — a security definer function or a writable view over app_state (CHECK); a wrapped or too small rate (NG); odd Score records (info)', async () => {
  const db = await mkdb('v1140');
  await db.exec(MIG);
  let rows = await postRows(db);
  assert.equal(rows.find(x => x.n === 15).ok, 'OK'); assert.equal(rows.find(x => x.n === 16).ok, 'OK');
  // 決まり（RLS）を通らない道：作った人の権限で動く関数と、作った人の権限で書ける view
  await db.exec(`create function public.zz_put(k text, v jsonb) returns void language sql security definer as $f$ insert into public.app_state(key, value) values (k, v) on conflict (key) do update set value = excluded.value $f$;
    grant execute on function public.zz_put(text, jsonb) to anon;
    create function public.zz_inv() returns int language sql security invoker as $f$ select count(*)::int from public.app_state $f$;
    create function public.zz_priv() returns int language sql security definer as $f$ select count(*)::int from public.app_state $f$;
    revoke execute on function public.zz_priv() from public, anon, authenticated;
    create view public.zz_v as select key, value from public.app_state; grant insert, update on public.zz_v to anon;
    create view public.zz_ro as select key from public.app_state; revoke all on public.zz_ro from anon, authenticated; grant select on public.zz_ro to anon;`);
  assert.equal(await (async () => { await db.exec('set role anon'); try { await db.query(`select public.zz_put('mileage_config', '{"ratePerMile":4}')`); return 'wrote'; } finally { await db.exec('reset role'); } })(), 'wrote', 'the hole is real');
  rows = await postRows(db);
  assert.equal(rows.find(x => x.n === 15).value, 'zz_put', 'only the definer function that anon can call (not the invoker one, not the private one)'); assert.match(rows.find(x => x.n === 15).ok, /^CHECK/);
  assert.equal(rows.find(x => x.n === 16).value, 'zz_v', 'not the read-only view'); assert.match(rows.find(x => x.n === 16).ok, /^CHECK/);
  for (const n of [6, 7, 8, 10]) assert.equal(rows.find(x => x.n === n).ok, 'OK', 'the direct tries still pass: only rows 15 and 16 see it');
  // 値の形：包んだ形・小さすぎる単価は NG、Score管理の形の合わない記録は info（数だけ）
  for (const [v, ng] of [['{"__st":1,"v":{"ratePerMile":0.7}}', true], ['{"__st":"1","ratePerMile":0.7,"v":{"ratePerMile":5}}', true], ['{"ratePerMile":0.000000001}', true], ['{"ratePerMile":0.7,"gmapsKey":5}', true], ['{"ratePerMile":0.7,"roundTripDefault":"yes"}', true], ['{"ratePerMile":0.01,"gmapsKey":null}', false]]) {
    await db.query(`update public.app_state set value = $1 where key = 'mileage_config'`, [v]);
    const r = (await postRows(db)).find(x => x.n === 13);
    assert.equal(/^NG/.test(r.ok), ng, v + ' → ' + r.ok);
  }
  assert.match((await postRows(db)).find(x => x.n === 12).ok, /^OK/);
  await db.query(`update public.app_state set value = '{"__st":"1","ratePerMile":0.7,"v":{"ratePerMile":0.000001}}' where key = 'mileage_config'`);
  assert.match((await postRows(db)).find(x => x.n === 12).ok, /^NG/, 'a rate below 1 cent is NG');
  await db.query(`update public.app_state set value = $1 where key = 'career_cfg'`, [JSON.stringify({ '経理|G4': { at: '2026/11/04 10:00' }, x: 1, y: [], ['k'.repeat(101)]: {}, z: null })]);
  const r13 = (await postRows(db)).find(x => x.n === 13);
  assert.match(r13.value, /形の合わない記録 3$/); assert.match(r13.ok, /^NG/, 'the mileage row is still bad (NG first)');
  await db.query(`update public.app_state set value = '{"ratePerMile":0.7}' where key = 'mileage_config'`);
  assert.match((await postRows(db)).find(x => x.n === 13).ok, /^info.*3 件/);
  assert.match((await db.query(PRE)).rows.find(x => x.n === 7).value, /形の合わない記録 3$/);
  assert.match((await postRows(db)).find(x => x.n === 14).value, /経理\|G4：2026\/11\/04 10:00/);
  // Codex #135 の P2：単価が無い・数でない（NULL）を OK にしない／Score管理の行がオブジェクトでないのは NG（-1 を OK にしていた）
  await db.query(`update public.app_state set value = '{}' where key = 'mileage_config'`);
  let r = (await postRows(db)).find(x => x.n === 13);
  assert.match(r.value, /^ガソリン代 NG/); assert.match(r.ok, /^NG/, '{} → ' + r.ok);
  await db.query(`update public.app_state set value = '{"ratePerMile":"0.7"}' where key = 'mileage_config'`);
  assert.match((await postRows(db)).find(x => x.n === 13).ok, /^NG/, 'a string rate');
  await db.query(`update public.app_state set value = '{"ratePerMile":0.7}' where key = 'mileage_config'`);
  for (const v of ['[]', '"x"', '5']) {
    await db.query(`update public.app_state set value = $1 where key = 'career_cfg'`, [v]);
    const rr = await postRows(db);
    assert.match(rr.find(x => x.n === 13).value, /Score管理 全体がオブジェクトでない/, v); assert.match(rr.find(x => x.n === 13).ok, /^NG/, v);
    assert.match(rr.find(x => x.n === 14).value, /全体がオブジェクトでない/, v);
    assert.match((await db.query(PRE)).rows.find(x => x.n === 7).ok, /^NG/, 'precheck ' + v);
  }
  await db.query(`delete from public.app_state where key = 'career_cfg'`);
  r = (await postRows(db)).find(x => x.n === 13);
  assert.match(r.value, /Score管理 行なし$/); assert.equal(r.ok, 'OK', 'no row is not an error');
  await db.close();
});

test('v1141 review: rollbacks never leave only the "stop" rules (anon would read nothing)', async () => {
  // RLS が OFF だった：v1141 の SQL だけ → v1141 を戻すと RLS は OFF に戻る
  const d1 = await mkdb('off');
  await d1.exec(MIG);
  assert.match((await d1.query(`select obj_description(p.oid, 'pg_policy') c from pg_policy p where p.polrelid = 'public.app_state'::regclass and p.polname = 'ss_open'`)).rows[0].c, /^v1141:/);
  await d1.exec(BACK); await d1.exec(BACK);
  assert.equal((await d1.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'RLS off again');
  assert.equal((await d1.query(`select count(*)::int c from pg_policies where tablename = 'app_state'`)).rows[0].c, 0);
  // v1139 の戻す SQL を v1141 のあとに流しても、anon は今までどおり読める（前は ss_open だけを外し、止める決まりだけが残った）
  const d2 = await mkdb('off');
  await d2.exec(MIG39); await d2.exec(MIG40); await d2.exec(MIG);
  const before = keysOf(await as(d2, 'anon', 'select key from public.app_state'));
  await d2.exec(BACK39);
  const after = keysOf(await as(d2, 'anon', 'select key from public.app_state'));
  assert.ok(after.length >= before.length && after.includes('tasks_all') && after.includes('mileage_config'), 'anon still reads: ' + after.join(','));
  assert.ok(await fails(d2, 'anon', `update public.app_state set value = '{"ratePerMile":3}' where key = 'mileage_config' returning key`) || (await as(d2, 'anon', `update public.app_state set value = '{"ratePerMile":3}' where key = 'mileage_config'`)).affectedRows === 0, 'the v1141 guard is still there');
  // そのあと v1141 を戻すと、残るのは ss_open だけ（RLS ON・今までどおり読み書きできる）
  await d2.exec(BACK);
  assert.equal((await as(d2, 'anon', `update public.app_state set value = '{"ratePerMile":0.71}' where key = 'mileage_config'`)).affectedRows, 1);
  await d1.close(); await d2.close();
  // v1139 だけを入れて v1139 を戻す（今までと同じ：RLS OFF に戻る）
  const d3 = await mkdb('off');
  await d3.exec(MIG39); await d3.exec(BACK39);
  assert.equal((await d3.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false);
  await d3.close();
});
