// v1143（2b-5）：GM・CEO だけが変える賞与・Career Score の設定 8 つを公開の鍵で書けなくする SQL（20261112090000）を
// 本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1141 の SQL のあと／v1139〜v1142 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は 10 のキーを読めるが、
//     足す・上書き・直す・消す・名前を変えて入れる、ができない。ほかの行は今までどおり。サーバーの鍵は書ける。行の一覧（app_state_index）にも出る
//   ・2 回流しても同じ。最初に確かめる SQL が動く・確認の SQL がすべて OK（穴があれば NG）
//   ・戻す SQL で v1141 のあとと同じ（8 つはまた書ける・ガソリン代・Score管理は書けないまま）。そのあと v1141 の戻す SQL も今までどおり
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
const MIG = rd('supabase/migrations/20261112090000_secure_settings_more.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-settings-more-precheck.sql');
const POST = rd('db/secure-settings-more-postcheck.sql');
const BACK = rd('db/secure-settings-more-rollback.sql');
const BACK41 = rd('db/secure-settings-write-rollback.sql');
const V41 = ['mileage_config', 'career_cfg'];
const GUARD = [...V41, ...SW2_KEYS];
const OTHER = ['tasks_all', 'grade_hist', 'bonus_store_q', 'bonus_pool_extra', 'mileage_requests', 'notifications'];
const V0 = {
  cs_criteria: { G2: { cats: { A: { m: 'pct', v: 60 } }, _at: 1762500000000 } },
  bonus_coef: { 'g:G3': { v: 1, _at: 1762500000000 } },
  bonus_coef_rng: { 'g:G3': { lo: 0.85, hi: 1.15, _at: 1762500000000 } },
  bonus_track: { '2026-Q3|E-1': { t: 'ops', _at: 1762500000000 } },
  bonus_eval_rule: { '_common|2026-Q3': { set: {}, _at: 1762500000000, _t: {} } },
  bonus_eval_ovr: { 'E-1|2026-Q3': { set: {}, _at: 1762600000000, _t: {} } },
  cs_strength_rule: { rule: { minItems: 3, top: 3, _at: 1762500000000 } },
  cs_guide: { 'H1@ja': { v: { what: 'x' }, _at: 1762500000000 } },
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
  await db.query(`insert into public.app_state(key, value) values ('mileage_config', $1), ('career_cfg', $2)`, [JSON.stringify({ gmapsKey: 'AIza-secret-x', ratePerMile: 0.7, roundTripDefault: true }), JSON.stringify({ '経理|G4': { csApprove: ['am'], _at: 5 } })]);
  for (const k of SW2_KEYS) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [k, JSON.stringify(V0[k])]);
  await db.exec(`insert into public.app_state(key, value) values ${['growth_karte', 'applicants', ...OTHER].map(k => `('${k}', '{"v":1}')`).join(',')};`);
  await db.exec(IDX);
  if (initial === 'v1141') await db.exec(MIG41);
  if (initial === 'v1142') { await db.exec(MIG39); await db.exec(MIG40); await db.exec(MIG41); await db.exec(MIG42); }
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
const rate = async db => Number((await db.query('select public.wr_mileage_rate() r')).rows[0].r);

for (const initial of ['v1141', 'v1142', 'off', 'on']) {
  test(`settings guard v1143 (from ${initial}): anon/authenticated read but cannot write the ten keys; the rest is unchanged; rollback to v1141`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 13);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, initial === 'off' ? /^info/ : /^OK/);
    assert.equal(pre.find(x => x.n === 3).value, /v114[12]/.test(initial) ? '3' : '0');
    for (let n = 4; n <= 11; n++) { const r = pre.find(x => x.n === n); assert.equal(r.ok, 'OK', r.what); assert.match(r.value, /^1 件・\d+ 千字・形の合わない記録 0$/, r.what); }
    assert.equal(pre.find(x => x.n === 12).value, '1', 'the GM account with an empty employee id'); assert.match(pre.find(x => x.n === 12).ok, /^info/);
    assert.equal(pre.find(x => x.n === 13).value, '3'); assert.equal(pre.find(x => x.n === 13).ok, 'OK');
    assert.ok(!JSON.stringify(pre).includes('AIza-secret-x') && !JSON.stringify(pre).includes('ops'), 'no contents are shown');
    const allBefore = keysOf(await as(db, 'anon', 'select key from public.app_state'));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), allBefore, role + ' reads the same rows as before');
      assert.equal((await as(db, role, `select value->'G2'->'cats'->'A'->>'v' v from public.app_state where key = 'cs_criteria'`)).rows[0].v, '60', role + ' reads the criteria');
      for (const k of GUARD) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('${k}', '{"x":{}}') on conflict (key) do update set value = excluded.value`), role + ' cannot upsert ' + k);
        assert.equal((await as(db, role, `update public.app_state set value = '{"x":{}}' where key = '${k}'`)).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = '${k}'`)).affectedRows, 0, role + ' cannot delete ' + k);
      }
      // 行が無いときも足せない
      await db.exec(`delete from public.app_state where key = 'bonus_track'`);
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('bonus_track', '{}')`), role + ' cannot create bonus_track');
      await db.query(`insert into public.app_state(key, value) values ('bonus_track', $1)`, [JSON.stringify(V0.bonus_track)]);
      // ほかの行は今までどおり（グレードの履歴も：v1143 では外していない）
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = 'grade_hist'`)).affectedRows, 1, role + ' still writes grade_hist');
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    // 名前を変えて対象のキーにする：断られる
    await db.exec(`delete from public.app_state where key = 'cs_guide'`);
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'cs_guide' where key = 'tasks_all'`), 'cannot rename a row into a guarded key');
    assert.equal((await as(db, 'service_role', `insert into public.app_state(key, value) values ('cs_guide', $1) returning key`, [JSON.stringify(V0.cs_guide)])).rows.length, 1, 'the server key writes');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where key = any($1)`, [GUARD])), [...GUARD].sort(), 'still in the row list');
    if (initial === 'v1142') for (const k of ['growth_karte', 'applicants']) assert.equal((await as(db, 'anon', `select key from public.app_state where key = $1`, [k])).rows.length, 0, k + ' stays closed');
    assert.equal(await rate(db), 0.7);
    const rows = await postRows(db);
    assert.equal(rows.length, 17);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '10');
    assert.equal(rows.find(x => x.n === 4).value, '10'); assert.equal(rows.find(x => x.n === 5).value, '10');
    assert.equal(rows.find(x => x.n === 13).ok, 'OK'); assert.match(rows.find(x => x.n === 13).value, /^cs_criteria 1 件 \/ bonus_coef 1 件/);
    assert.equal(rows.find(x => x.n === 14).ok, 'OK'); assert.equal(rows.find(x => x.n === 15).value, 'なし'); assert.equal(rows.find(x => x.n === 16).value, 'なし');
    assert.match(rows.find(x => x.n === 17).value, /bonus_eval_ovr：2025-11-0\d \d\d:\d\d/); assert.ok(!/なし/.test(rows.find(x => x.n === 17).value), rows.find(x => x.n === 17).value);
    assert.ok(!JSON.stringify(rows).includes('AIza-secret-x'), 'the map key is never shown');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'zz_v1143_postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'cs_criteria'`)).rows[0].value, V0.cs_criteria, 'the postcheck changed nothing');
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
    // ss_guard_key が v1141 のまま（キー 2 つ）なら 3 行目と 6 行目が NG
    await db.exec(BACK);
    const b41 = await postRows(db);
    assert.equal(b41.find(x => x.n === 3).ok, 'NG'); assert.equal(b41.find(x => x.n === 3).value, '2');
    // 戻す（2 回流しても同じ）：8 つはまた書ける・v1141 の 2 つは書けないまま
    await db.exec(BACK);
    for (const k of SW2_KEYS) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 1, k + ' writable again after the rollback');
    for (const k of V41) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 0, k + ' stays guarded (v1141)');
    if (initial === 'v1142') assert.equal((await as(db, 'anon', `select key from public.app_state where key = 'applicants'`)).rows.length, 0, 'v1142 stays');
    await db.exec(MIG);
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'cs_guide'`)).affectedRows, 0, 'and closed again');
    // v1141 の戻す SQL も今までどおり（10 のキーをまた書ける。RLS OFF から入れたなら OFF に戻る）
    await db.exec(BACK41);
    for (const k of GUARD) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = '${k}'`)).affectedRows, 1, k + ' writable after the v1141 rollback');
    // RLS：v1141 か v1143 の SQL が OFF から ON にしたとき（v1141・off）は OFF に戻る。もとから ON（on）・v1139 が ON にした（v1142）なら ON のまま
    assert.equal((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, initial === 'on' || initial === 'v1142', 'RLS as before');
    // v1143 の戻す SQL は、v1141 の決まりが無いときは何もしない（決まりを作らない）
    await db.exec(BACK);
    assert.equal((await db.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true);
    await db.close();
  });
}

test('the SQL rule, the function rule and the app rule agree on every key', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  // アプリ（index.html）の swIsKey を本物のまま取り出す
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var SW_KEYS = \{[^}]*\};/), pick(/var SW2_KEYS = \{[^}]*\};/), pick(/function sw2IsKey\(k\)\{[^\n]*\}/), pick(/var GH_KEYS = \{[^}]*\};/), pick(/function ghIsKey\(k\)\{[^\n]*\}/), pick(/function swIsKey\(k\)\{[^\n]*\}/), 'this.appIs = swIsKey;'].join('\n'), ctx);
  const keys = [...GUARD, ...OTHER, 'cs_criteria ', ' cs_guide', 'Cs_guide', 'bonus_coef\n', 'bonus', 'cs_', 'bonus_eval', 'bonus_eval_rule_x', 'toString', '__proto__', 'constructor', ''];
  for (let i = 0; i < 300; i++) keys.push(['cs_', 'bonus_', 'coef', 'eval_', 'guide', ''][i % 6] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s;
    assert.equal(s, swIsKey(k) && !GH_KEYS.includes(k), 'sql (v1143: no grade history yet) vs function ' + JSON.stringify(k));
    assert.equal(ctx.appIs(k), swIsKey(k), 'app vs function ' + JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_guard_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy; the precheck sees odd shapes, a too-big setting and no writer', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await d2.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true, 'nothing is made either (one transaction)');
  await d2.query(`update public.app_state set value = '[1,2]' where key = 'bonus_coef'`);
  await d2.query(`update public.app_state set value = $1 where key = 'cs_guide'`, [JSON.stringify({ ...V0.cs_guide, x: 'odd', ['k'.repeat(201)]: {} })]);
  await d2.query(`update public.app_state set value = $1 where key = 'bonus_eval_ovr'`, [JSON.stringify({ a: { t: 'y'.repeat(6000001) } })]);
  await d2.query(`update public.app_state set value = $1 where key = 'bonus_eval_rule'`, [JSON.stringify({ a: { t: 'y'.repeat(3000001) } })]);
  await d2.exec(`delete from public.app_state where key = 'bonus_track'; delete from public.manager_auth where role in ('ceo','gm');`);
  const pre = (await d2.query(PRE)).rows;
  const r = n => pre.find(x => x.n === n);
  assert.match(r(5).value, /全体がオブジェクトでない（array）/); assert.match(r(5).ok, /^NG/);
  assert.match(r(11).value, /形の合わない記録 2$/); assert.match(r(11).ok, /^info/);
  assert.match(r(9).ok, /^NG.*600 万字/); assert.match(r(8).ok, /^info.*300 万字/);
  assert.equal(r(7).value, '行なし'); assert.equal(r(7).ok, 'OK');
  assert.match(r(13).ok, /^STOP/);
  await d2.close();
});

test('the postcheck shows odd shapes (13 NG / info), the v1141 shapes (14) and a definer path (15 CHECK)', async () => {
  const db = await mkdb('v1142');
  await db.exec(MIG);
  await db.query(`update public.app_state set value = '"x"' where key = 'bonus_coef_rng'`);
  let rows = await postRows(db);
  assert.match(rows.find(x => x.n === 13).value, /bonus_coef_rng 全体がオブジェクトでない（string）/); assert.match(rows.find(x => x.n === 13).ok, /^NG/);
  await db.query(`update public.app_state set value = $1 where key = 'bonus_coef_rng'`, [JSON.stringify({ ...V0.bonus_coef_rng, z: 1 })]);
  rows = await postRows(db);
  assert.match(rows.find(x => x.n === 13).value, /bonus_coef_rng 2 件・形の合わない記録 1/); assert.match(rows.find(x => x.n === 13).ok, /^info/);
  await db.query(`update public.app_state set value = $1 where key = 'cs_guide'`, [JSON.stringify({ a: { t: 'y'.repeat(6000001) } })]);
  assert.match((await postRows(db)).find(x => x.n === 13).ok, /^NG/, 'too big');
  await db.query(`update public.app_state set value = $1 where key = 'cs_guide'`, [JSON.stringify(V0.cs_guide)]);
  await db.query(`update public.app_state set value = '{"ratePerMile":9}' where key = 'mileage_config'`);
  rows = await postRows(db);
  assert.match(rows.find(x => x.n === 14).ok, /^NG/); assert.match(rows.find(x => x.n === 12).ok, /^NG/);
  await db.query(`update public.app_state set value = '{"ratePerMile":0.7}' where key = 'mileage_config'`);
  await db.exec(`create function public.zz_put(k text, v jsonb) returns void language sql security definer as $f$ insert into public.app_state(key, value) values (k, v) on conflict (key) do update set value = excluded.value $f$;
    grant execute on function public.zz_put(text, jsonb) to anon;`);
  rows = await postRows(db);
  assert.equal(rows.find(x => x.n === 15).value, 'zz_put'); assert.match(rows.find(x => x.n === 15).ok, /^CHECK/);
  // キーの判定が広すぎる（グレードの履歴まで閉じる：新しく入った人の登録・昇格の承認が書けなくなる）なら 3 行目が NG
  await db.exec(`create or replace function public.ss_guard_key(k text) returns boolean language sql immutable as $f$ select coalesce(k in (${GUARD.map(k => `'${k}'`).join(', ')}, 'grade_hist'), false) $f$`);
  rows = await postRows(db);
  assert.equal(rows.find(x => x.n === 3).value, '10'); assert.equal(rows.find(x => x.n === 3).ok, 'NG', 'grade_hist must stay writable');
  await db.close();
});
