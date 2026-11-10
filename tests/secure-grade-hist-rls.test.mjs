// v1145（2b-7）：グレード履歴（grade_hist）を公開の鍵で書けなくする SQL（20261114090000）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1143 の SQL のあと／v1139〜v1144 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は 11 のキーを読めるが、
//     足す・上書き・直す・消す・名前を変えて入れる、ができない。ほかの行は今までどおり。サーバーの鍵は書ける。行の一覧（app_state_index）にも出る
//   ・2 回流しても同じ。最初に確かめる SQL が動く・確認の SQL（19 行）がすべて OK（穴があれば NG）
//   ・戻す SQL で v1143 のあとと同じ（グレード履歴はまた書ける・10 は書けないまま）。v1143・v1141 の戻す SQL も今までどおり
//   ・SQL の決まり（ss_guard_key）と関数の決まり（swIsKey）とアプリの決まり（index.html の swIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { swIsKey, SW2_KEYS, GH_KEYS } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG41 = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const MIG42 = rd('supabase/migrations/20261111090000_secure_hr_rls.sql');
const MIG43 = rd('supabase/migrations/20261112090000_secure_settings_more.sql');
const MIG = rd('supabase/migrations/20261114090000_secure_grade_hist.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-grade-hist-precheck.sql');
const POST = rd('db/secure-grade-hist-postcheck.sql');
const BACK = rd('db/secure-grade-hist-rollback.sql');
const BACK43 = rd('db/secure-settings-more-rollback.sql');
const BACK41 = rd('db/secure-settings-write-rollback.sql');
const V41 = ['mileage_config', 'career_cfg'];
const TEN = [...V41, ...SW2_KEYS];
const GUARD = [...TEN, ...GH_KEYS];
const OTHER = ['tasks_all', 'bonus_store_q', 'bonus_pool_extra', 'mileage_requests', 'notifications', 'grade_hist_x'];
const GH0 = {
  'E-1': { recs: [{ id: 'gh1', d: '2026-04-01', g: 'G1', start: true, src: 'hire' }], name: 'Kai One', _at: 1762500000000 },
  'E-4': { recs: [{ id: 'gh2', d: '2026-06-30', g: 'G4', from: 'G3', src: 'title' }], name: 'Leo Four', _at: 1762600000000 },
};

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM'), ('ceo','E-CEO'), ('office', null), ('gm', '');`);
  await db.exec(WR);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  await db.query(`insert into public.app_state(key, value) values ('mileage_config', $1), ('career_cfg', $2), ('grade_hist', $3)`,
    [JSON.stringify({ gmapsKey: 'AIza-secret-x', ratePerMile: 0.7, roundTripDefault: true }), JSON.stringify({ '経理|G4': { csApprove: ['am'], _at: 5 } }), JSON.stringify(GH0)]);
  for (const k of SW2_KEYS) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [k, JSON.stringify({ a: { v: 1, _at: 1762500000000 } })]);
  await db.exec(`insert into public.app_state(key, value) values ${['growth_karte', 'applicants', ...OTHER].map(k => `('${k}', '{"v":1}')`).join(',')};`);
  await db.exec(IDX);
  if (initial === 'v1143') { await db.exec(MIG41); await db.exec(MIG43); }
  if (initial === 'v1144') { await db.exec(MIG39); await db.exec(MIG40); await db.exec(MIG41); await db.exec(MIG42); await db.exec(MIG43); }
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;

for (const initial of ['v1143', 'v1144', 'off', 'on']) {
  test(`grade history guard v1145 (from ${initial}): anon/authenticated read but cannot write the eleven keys; the rest is unchanged; rollback to v1143`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 6);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, initial === 'off' ? /^info/ : /^OK/);
    assert.equal(pre.find(x => x.n === 3).value, /v114[34]/.test(initial) ? '3' : '0');
    assert.equal(pre.find(x => x.n === 4).ok, 'OK'); assert.match(pre.find(x => x.n === 4).value, /^2 人・\d+ 千字・形の合わない記録 0$/);
    assert.equal(pre.find(x => x.n === 5).value, '1', 'the GM account with an empty employee id'); assert.match(pre.find(x => x.n === 5).ok, /^info/);
    assert.equal(pre.find(x => x.n === 6).value, '3'); assert.equal(pre.find(x => x.n === 6).ok, 'OK');
    assert.ok(!JSON.stringify(pre).includes('Kai One') && !JSON.stringify(pre).includes('E-1'), 'no names or ids are shown');
    const allBefore = keysOf(await as(db, 'anon', 'select key from public.app_state'));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), allBefore, role + ' reads the same rows as before');
      assert.equal((await as(db, role, `select value->'E-4'->'recs'->0->>'g' g from public.app_state where key = 'grade_hist'`)).rows[0].g, 'G4', role + ' reads the grade history');
      for (const k of GUARD) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('${k}', '{"x":{}}') on conflict (key) do update set value = excluded.value`), role + ' cannot upsert ' + k);
        assert.equal((await as(db, role, `update public.app_state set value = '{"x":{}}' where key = '${k}'`)).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = '${k}'`)).affectedRows, 0, role + ' cannot delete ' + k);
      }
      await db.exec(`delete from public.app_state where key = 'grade_hist'`);
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('grade_hist', '{}')`), role + ' cannot create grade_hist');
      await db.query(`insert into public.app_state(key, value) values ('grade_hist', $1)`, [JSON.stringify(GH0)]);
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      for (const k of ['tasks_all', 'grade_hist_x']) assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = '${k}'`)).affectedRows, 1, role + ' still writes ' + k);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    await db.exec(`delete from public.app_state where key = 'grade_hist'`);
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'grade_hist' where key = 'tasks_all'`), 'cannot rename a row into the grade history');
    assert.equal((await as(db, 'service_role', `insert into public.app_state(key, value) values ('grade_hist', $1) returning key`, [JSON.stringify(GH0)])).rows.length, 1, 'the server key writes');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where key = any($1)`, [GUARD])), [...GUARD].sort(), 'still in the row list');
    if (initial === 'v1144') for (const k of ['growth_karte', 'applicants']) assert.equal((await as(db, 'anon', `select key from public.app_state where key = $1`, [k])).rows.length, 0, k + ' stays closed');
    const rows = await postRows(db);
    assert.equal(rows.length, 19);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '11');
    assert.equal(rows.find(x => x.n === 4).value, '11'); assert.equal(rows.find(x => x.n === 5).value, '11');
    assert.equal(rows.find(x => x.n === 18).ok, 'OK'); assert.equal(rows.find(x => x.n === 18).value, '2 人');
    assert.equal(rows.find(x => x.n === 19).value, '2025-11-08 01:06', 'the newest save in Hawaii time (1762600000000)');
    assert.ok(!JSON.stringify(rows).includes('AIza-secret-x') && !JSON.stringify(rows).includes('Kai One'), 'no secrets or names are shown');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'zz_v1145_postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'grade_hist'`)).rows[0].value, GH0, 'the postcheck changed nothing');
    // 穴があれば NG
    await db.exec('alter policy ss_guard_upd on public.app_state using (true) with check (true)');
    await db.exec('alter policy ss_guard_ins on public.app_state with check (true)');
    await db.exec('alter policy ss_guard_del on public.app_state using (true)');
    const bad = await postRows(db);
    for (const n of [6, 7, 8, 10]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec('drop policy ss_guard_del on public.app_state');
    assert.equal((await postRows(db)).find(x => x.n === 2).ok, 'NG', 'a missing policy is NG');
    await db.exec(MIG);
    // ss_guard_key が v1143 のまま（キー 10）なら 3 行目と 6 行目が NG
    await db.exec(BACK);
    const b43 = await postRows(db);
    assert.equal(b43.find(x => x.n === 3).ok, 'NG'); assert.equal(b43.find(x => x.n === 3).value, '10'); assert.equal(b43.find(x => x.n === 6).ok, 'NG');
    // 戻す（2 回流しても同じ）：グレード履歴はまた書ける・10 は書けないまま
    await db.exec(BACK);
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'grade_hist'`)).affectedRows, 1, 'grade_hist writable again after the rollback');
    for (const k of TEN) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 0, k + ' stays guarded');
    await db.exec(MIG);
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'grade_hist'`)).affectedRows, 0, 'and closed again');
    // v1143 の戻す SQL：v1141 の 2 つに戻る（v1143 の 8 つとグレード履歴はまた書ける）
    await db.exec(BACK43);
    for (const k of [...SW2_KEYS, 'grade_hist']) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 1, k + ' writable after the v1143 rollback');
    for (const k of V41) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 0, k + ' stays guarded (v1141)');
    // v1141 の戻す SQL も今までどおり（11 のキーをまた書ける。RLS OFF から入れたなら OFF に戻る）
    await db.exec(MIG); await db.exec(BACK41);
    for (const k of GUARD) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 1, k + ' writable after the v1141 rollback');
    assert.equal((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, initial === 'on' || initial === 'v1144', 'RLS as before');
    // v1145 の戻す SQL は、決まりが無いときは何もしない（決まりを作らない）
    await db.exec(BACK);
    assert.equal((await db.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true);
    await db.close();
  });
}

test('the SQL rule, the function rule and the app rule agree on every key (the grade history included)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var SW_KEYS = \{[^}]*\};/), pick(/var SW2_KEYS = \{[^}]*\};/), pick(/function sw2IsKey\(k\)\{[^\n]*\}/), pick(/var GH_KEYS = \{[^}]*\};/), pick(/function ghIsKey\(k\)\{[^\n]*\}/), pick(/function swIsKey\(k\)\{[^\n]*\}/), 'this.appIs = swIsKey; this.appGh = ghIsKey;'].join('\n'), ctx);
  const keys = [...GUARD, ...OTHER, 'grade_hist ', ' grade_hist', 'Grade_hist', 'grade_hist\n', 'grade', 'gradehist', 'toString', '__proto__', 'constructor', ''];
  for (let i = 0; i < 300; i++) keys.push(['grade', 'grade_', 'hist', 'cs_', 'bonus_', ''][i % 6] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s;
    assert.equal(s, swIsKey(k), 'sql vs function ' + JSON.stringify(k));
    assert.equal(ctx.appIs(k), swIsKey(k), 'app vs function ' + JSON.stringify(k));
    assert.equal(ctx.appGh(k), GH_KEYS.includes(k), 'app grade-history list vs function ' + JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_guard_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy; the precheck and postcheck see odd shapes, a too-big history and no writer', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await d2.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true, 'nothing is made either (one transaction)');
  const r = async n => (await d2.query(PRE)).rows.find(x => x.n === n);
  await d2.query(`update public.app_state set value = '[1,2]' where key = 'grade_hist'`);
  assert.match((await r(4)).value, /全体がオブジェクトでない（array）/); assert.match((await r(4)).ok, /^NG/);
  await d2.query(`update public.app_state set value = $1 where key = 'grade_hist'`, [JSON.stringify({ ...GH0, x: 'odd', ['k'.repeat(201)]: {} })]);
  assert.match((await r(4)).value, /形の合わない記録 2$/); assert.match((await r(4)).ok, /^info/);
  await d2.query(`update public.app_state set value = $1 where key = 'grade_hist'`, [JSON.stringify({ a: { recs: [], note: 'y'.repeat(6000001) } })]);
  assert.match((await r(4)).ok, /^NG.*600 万字/);
  await d2.query(`update public.app_state set value = $1 where key = 'grade_hist'`, [JSON.stringify({ a: { recs: [], note: 'y'.repeat(3000001) } })]);
  assert.match((await r(4)).ok, /^info.*300 万字/);
  await d2.exec(`delete from public.app_state where key = 'grade_hist'`);
  assert.equal((await r(4)).value, '行なし'); assert.equal((await r(4)).ok, 'OK');
  await d2.exec(`delete from public.manager_auth where role in ('ceo','gm');`);
  assert.match((await r(6)).ok, /^STOP/);
  await d2.close();
  // 確認の SQL の 18 行目（形）
  const d3 = await mkdb('v1144');
  await d3.exec(MIG);
  const r18 = async () => (await postRows(d3)).find(x => x.n === 18);
  await d3.query(`update public.app_state set value = '"x"' where key = 'grade_hist'`);
  assert.match((await r18()).value, /全体がオブジェクトでない（string）/); assert.match((await r18()).ok, /^NG/);
  await d3.query(`update public.app_state set value = $1 where key = 'grade_hist'`, [JSON.stringify({ ...GH0, z: 1 })]);
  assert.equal((await r18()).value, '3 人・形の合わない記録 1'); assert.match((await r18()).ok, /^info/);
  await d3.query(`update public.app_state set value = $1 where key = 'grade_hist'`, [JSON.stringify({ a: { recs: [], note: 'y'.repeat(6000001) } })]);
  assert.match((await r18()).ok, /^NG/, 'too big');
  await d3.exec(`delete from public.app_state where key = 'grade_hist'`);
  assert.equal((await r18()).value, '行なし'); assert.equal((await r18()).ok, 'OK');
  assert.equal((await postRows(d3)).find(x => x.n === 19).value, 'なし');
  // キーの判定が広すぎる・狭すぎるなら 3 行目が NG
  await d3.exec(`create or replace function public.ss_guard_key(k text) returns boolean language sql immutable as $f$ select coalesce(k in (${GUARD.map(k => `'${k}'`).join(', ')}, 'grade_hist_x'), false) $f$`);
  assert.equal((await postRows(d3)).find(x => x.n === 3).ok, 'NG', 'grade_hist_x must stay writable');
  await d3.exec(`create or replace function public.ss_guard_key(k text) returns boolean language sql immutable as $f$ select coalesce(k in (${TEN.map(k => `'${k}'`).join(', ')}), false) $f$`);
  assert.equal((await postRows(d3)).find(x => x.n === 3).ok, 'NG', 'grade_hist must be guarded');
  await d3.close();
});
