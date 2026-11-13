// v1148（2b-10）：グレード履歴（grade_hist）・賞与の個人設定（bonus_eval_ovr）・G3 の職種（bonus_track）を公開の鍵で読めなくする SQL（20261117090000）を、
// 本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1147 の SQL のあと／v1144 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は 3 つの行を読めない・足せない・直せない・消せない・
//     名前を変えて入れられない。v1147 までのキーも閉じたまま。ほかの行は今までどおり。サーバーの鍵は読み書きできる
//   ・2 回流しても同じ。最初に確かめる SQL（10 行）が動く・確認の SQL（16 行）がすべて OK（穴があれば NG）
//   ・戻す SQL で v1147 のあとと同じ（3 つはまた読める・ほかは閉じたまま。v1141〜v1146 の書く決まりがあれば書けないまま）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（gbIsKey）とアプリの決まり（index.html の GB_KEYS）が同じ
//   ・最初に確かめる SQL の社員 ID の読み方が関数（gbEntryId）と同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { gbIsKey, gbEntryId } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG41 = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const MIG42 = rd('supabase/migrations/20261111090000_secure_hr_rls.sql');
const MIG43 = rd('supabase/migrations/20261112090000_secure_settings_more.sql');
const MIG44full = rd('supabase/migrations/20261113090000_secure_emp_pii.sql');
const MIG44 = MIG44full.slice(0, MIG44full.indexOf('-- 書くたびに'));   // v1144 の決まりの部分だけ（ss_secret_key と ss_secret。個人の欄の写しは試験に要らない）
const MIG45 = rd('supabase/migrations/20261114090000_secure_grade_hist.sql');
const MIG46 = rd('supabase/migrations/20261115090000_secure_tip_prep.sql');
const MIG47 = rd('supabase/migrations/20261116090000_secure_tip_cf.sql');
const MIG = rd('supabase/migrations/20261117090000_secure_grade_bonus_read.sql');
const CHEF = rd('supabase/migrations/20261113080000_wr_people_chef.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const G2SQL = rd('supabase/migrations/20261116080000_wr_people_g2.sql');
const PRE = rd('db/secure-grade-bonus-read-precheck.sql');
const POST = rd('db/secure-grade-bonus-read-postcheck.sql');
const BACK = rd('db/secure-grade-bonus-read-rollback.sql');
const GB = {
  grade_hist: { 'E-1': [{ date: '2026-04-01', from: 'G1', to: 'G1', _t: 1 }], 'E-3': [{ date: '2026-07-01', from: 'G2', to: 'G3', _t: 2 }],
    'E-GHOST': [{ date: '2025-01-01', to: 'G2' }], 'E-OUT': [{ date: '2025-01-01', to: 'G4' }] },
  bonus_eval_ovr: { 'E-1|2026-Q3': { on: { csp: true }, _t: 3 }, 'E-4|2026-Q4': { on: { sp: false }, _t: 4 }, nopipe: { x: 1 } },
  bonus_track: { '2026-Q3|E-3': { v: 'kitchen', _t: 5 }, '2026-Q3|': { v: 'server' } },
};
const GBK = Object.keys(GB).sort();
const OLD_SECRET = ['growth_karte', 'applicants', 'lss_emp_Kai One', 'emp_pii', 'tip_cf_S1_2026', 'warnings_S1'];
const OTHER = ['tasks_all', 'grade_history', 'bonus_trackx', 'gh', 'prep_cfg'];
const GUARD_READ = ['bonus_eval_rule', 'bonus_coef', 'cs_criteria'];   // v1143：読めるが書けない（ss_guard_*）

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.stores(id, name) values ('S1', 'Store One'), ('S2', 'Store Two');
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM'), ('office_crew','E-OC'), ('office', 'E-GONE'), ('office', null);
    insert into public.employees(id, name, role, title, store, status, data) values
      ('E-GM','Gina M','gm','General Manager','HQ','',null), ('E-AM','Amy Area','am','Area Manager','S1','',null),
      ('E-4','Leo Four','g4','Store Manager','S1','',null), ('E-CH','Chef Ken',null,'','S1','','{"role":"chef","title":"Head Chef"}'),
      ('E-OC','Oscar','office_crew','Office Crew','HQ','',null), ('E-OC2','Olga','office_crew','Office Crew','HQ','',null),
      ('E-1','Kai One','crew','Crew','S1','',null), ('E-OUT','Gone Am','am','Area Manager','S1','退職',null),
      ('E-2','Ria Two','g2','Crew Leader','S2','',null), ('E-3','Sal Three','sl','Store Leader','S1','',null);`);
  await db.exec(WR);
  await db.exec(CHEF);
  await db.exec(G2SQL);
  await db.query(`insert into public.wr_people(emp_id, name, role, grade, chef) values ('E-4', 'Leo Four', 'staff', 4, false), ('E-CH', 'Chef Ken', 'staff', 4, false), ('E-3', 'Sal Three', 'staff', 3, false)`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  for (const [k, v] of Object.entries(GB)) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [k, JSON.stringify(v)]);
  for (const k of [...OLD_SECRET, ...OTHER, ...GUARD_READ]) await db.query(`insert into public.app_state(key, value) values ($1, '{"v":1}')`, [k]);
  await db.exec(IDX);
  if (initial === 'v1147') for (const m of [MIG39, MIG40, MIG41, MIG42, MIG43, MIG44, MIG45, MIG46, MIG47]) await db.exec(m);
  if (initial === 'v1144') for (const m of [MIG39, MIG40, MIG42, MIG44]) await db.exec(m);
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { await db.query(sql, p); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const resRows = async (db, sql) => (await db.exec(sql)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
const GBSQL = `key in ('grade_hist', 'bonus_eval_ovr', 'bonus_track')`;

for (const initial of ['v1147', 'v1144', 'off', 'on']) {
  test(`grade history / bonus personal settings / G3 track v1148 (from ${initial}): anon/authenticated cannot read or write them (or the older keys); the rest is unchanged; rollback to v1147`, async () => {
    const db = await mkdb(initial);
    const pre = await resRows(db, PRE);
    assert.equal(pre.length, 10);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, /v114/.test(initial) ? /^OK/ : /^info/);
    assert.equal(pre.find(x => x.n === 3).value, /v114/.test(initial) ? 'ON' : (initial === 'on' ? 'ON' : 'OFF'));
    assert.deepEqual([pre.find(x => x.n === 4).value, pre.find(x => x.n === 4).ok], ['オブジェクト・記録 4・社員 ID の読めない記録 0・社員の表に無い ID 1・退職した人 1', 'OK']);
    assert.equal(pre.find(x => x.n === 5).value, 'オブジェクト・記録 3・社員 ID の読めない記録 1・社員の表に無い ID 0・退職した人 0');
    assert.match(pre.find(x => x.n === 5).ok, /^info/);
    assert.equal(pre.find(x => x.n === 6).value, 'オブジェクト・記録 2・社員 ID の読めない記録 1・社員の表に無い ID 0・退職した人 0');
    assert.deepEqual([pre.find(x => x.n === 7).value, pre.find(x => x.n === 7).ok],
      initial === 'v1147' ? ['3 / 3', 'OK（入っている）'] : ['ない', 'info（v1143・v1145 の SQL がまだ。v1148 の SQL だけでも公開の鍵からは読み書きできなくなります）']);
    assert.equal(pre.find(x => x.n === 8).value, '1', 'office crew not linked');
    assert.equal(pre.find(x => x.n === 9).value, '1', 'office account with a missing employee');
    assert.equal(pre.find(x => x.n === 10).value, '2', 'the AM and the G2 (no confirmed copy)');
    assert.ok(!/Kai One|Amy Area|Chef Ken|Oscar|Olga|kitchen|server|2026-Q3|G4/.test(JSON.stringify(pre)), 'no names, grades or settings are shown');
    const otherBefore = keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OTHER]));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where ${GBSQL}`)), [], role + ' reads none of the three');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OLD_SECRET])), [], role + ' reads none of the older keys');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OTHER])), otherBefore, role + ' reads the other rows as before');
      for (const k of GBK) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ($1, '{}') on conflict (key) do update set value = excluded.value`, [k]), role + ' cannot upsert ' + k);
        assert.equal((await as(db, role, `update public.app_state set value = '{}' where key = $1`, [k])).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = $1`, [k])).affectedRows, 0, role + ' cannot delete ' + k);
      }
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      for (const k of OTHER) assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = $1`, [k])).affectedRows, 1, role + ' still writes ' + k);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    await db.query(`delete from public.app_state where key = 'bonus_track'`);   // 行が無いキーへ名前を変えて入れる
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'bonus_track' where key = 'tasks_all'`), 'cannot rename a row into a G3 track row');
    assert.ok(await fails(db, 'anon', `insert into public.app_state(key, value) values ('bonus_track', '{}')`), 'cannot add the missing row either');
    await db.query(`insert into public.app_state(key, value) values ('bonus_track', $1)`, [JSON.stringify(GB.bonus_track)]);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where ${GBSQL}`)), [], 'not in the row list');
    assert.deepEqual(keysOf(await as(db, 'service_role', `select key from public.app_state where ${GBSQL}`)), GBK, 'the server key reads them');
    assert.equal((await as(db, 'service_role', `update public.app_state set value = value where key = 'grade_hist'`)).affectedRows, 1, 'the server key writes them');
    if (initial === 'v1147') {   // v1141〜v1146 の決まり（書けない設定）はそのまま
      for (const k of GUARD_READ) {
        assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [k])).affectedRows, 0, 'v1143 guard still on ' + k);
        assert.equal((await as(db, 'anon', `select key from public.app_state where key = $1`, [k])).rows.length, 1, 'and still readable ' + k);
      }
    }
    const rows = await resRows(db, POST);
    assert.equal(rows.length, 16);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '27');
    assert.equal(rows.find(x => x.n === 7).value, '3');
    assert.equal(rows.find(x => x.n === 13).ok, initial === 'v1147' ? 'OK（入っている）' : 'info（v1141〜v1146 の SQL がまだ）');
    assert.deepEqual([rows.find(x => x.n === 14).value, rows.find(x => x.n === 14).ok], initial === 'v1147' ? ['3 / 3', 'OK'] : ['ない', 'info（v1143・v1145 の SQL がまだ）']);
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'bonus_track'`)).rows[0].value, GB.bonus_track, 'the postcheck changed nothing (its insert try is rolled back)');
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'grade_hist'`)).rows[0].value, GB.grade_hist);
    // 穴があれば NG
    await db.exec(`drop policy ss_secret on public.app_state; create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text) or key = 'bonus_track') with check (not public.ss_secret_key(key::text) or key = 'bonus_track')`);
    const bad = await resRows(db, POST);
    // 読めること（4・5）は NG。v1143 の書く決まり（ss_guard_*）があれば、書き込み（8〜10）はそれが止める（それでよい）
    for (const n of initial === 'v1147' ? [4, 5] : [4, 5, 8, 9, 10]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    if (initial === 'v1147') for (const n of [8, 9, 10]) assert.equal(bad.find(x => x.n === n).ok, 'OK', 'the write guard still stops row ' + n);
    await db.exec('drop policy ss_secret on public.app_state');
    assert.equal((await resRows(db, POST)).find(x => x.n === 2).ok, 'NG', 'a missing policy is NG');
    await db.exec(MIG);
    // 戻す（2 回流しても同じ）：3 つはまた読める。書けるかは v1141〜v1146 の書く決まりしだい。ほかは閉じたまま。3 行目と 4 行目が NG
    await db.exec(BACK); await db.exec(BACK);
    const back = await resRows(db, POST);
    assert.equal(back.find(x => x.n === 3).ok, 'NG'); assert.equal(back.find(x => x.n === 3).value, '24'); assert.equal(back.find(x => x.n === 4).ok, 'NG');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where ${GBSQL}`)), GBK, 'readable again after the rollback');
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'grade_hist'`)).affectedRows, initial === 'v1147' ? 0 : 1,
      initial === 'v1147' ? 'still not writable (v1145 guard)' : 'writable again (no write guard yet)');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OLD_SECRET])), [], 'the older keys stay closed');
    assert.equal((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, true, 'RLS stays on');
    await db.exec(MIG);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where ${GBSQL}`)), [], 'and closed again');
    // 戻す SQL は、決まりが無いときは決まりを作らない
    await db.exec(`drop policy ss_secret on public.app_state`);
    await db.exec(BACK);
    assert.equal((await db.query(`select count(*)::int c from pg_policies where tablename = 'app_state' and policyname = 'ss_secret'`)).rows[0].c, 0);
    await db.close();
  });
}

test('the SQL rule, the function rule and the app rule agree on the three keys', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var GB_KEYS = \{[^}]*\};/), pick(/function gbIsKey\(k\)\{[^\n]*\}/), 'this.appIs = gbIsKey;'].join('\n'), ctx);
  const keys = [...GBK, ...OTHER, ...GUARD_READ, 'Grade_hist', 'grade_hist ', ' bonus_track', 'bonus_eval_ovr_x', 'bonus_eval', 'toString', '__proto__', 'constructor', 'hasOwnProperty', ''];
  for (let i = 0; i < 300; i++) keys.push(['grade_hist', 'bonus_eval_ovr', 'bonus_track', 'bonus_', ''][i % 5] + (i % 3 ? Math.random().toString(36).slice(2, 2 + (i % 7)) : ''));
  for (const k of keys) {
    const s = (await db.query('select public.ss_secret_key($1) s', [k])).rows[0].s;
    const fnIs = gbIsKey(k);
    assert.equal(ctx.appIs(k), fnIs, 'app vs function ' + JSON.stringify(k));
    const older = /^(growth_karte|karte_pin|karte_bonus_config|bonus_q|bonus_eval|bonus_store_q|bonus_rules|bonus_pool_extra|lss_scores|lss_requests|lss_history|applicants|reject_log|growthhub|emp_pii)$/.test(k);
    assert.equal(s, fnIs || older, 'sql vs function ' + JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_secret_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the precheck reads the employee ID of each record the same way as the function (gbEntryId); odd shapes are seen', async () => {
  const db = await mkdb('off');
  const r = async n => (await resRows(db, PRE)).find(x => x.n === n);
  const emps = new Set((await db.query('select id from public.employees')).rows.map(x => x.id));
  const parts = ['E-1', 'E-3', 'E-GHOST', '', '|', 'x', '2026-Q3', 'E-1|E-3', '日本', 'a b'];
  const rnd = () => parts[Math.floor(Math.random() * parts.length)];
  for (let round = 0; round < 12; round++) {
    const maps = {};
    for (const key of GBK) {
      const m = {};
      for (let i = 0; i < 25; i++) m[[rnd(), rnd(), rnd()].join(['', '|', '||'][i % 3])] = { i };
      maps[key] = m;
      await db.query(`update public.app_state set value = $2 where key = $1`, [key, JSON.stringify(m)]);
    }
    for (const [key, n] of [['grade_hist', 4], ['bonus_eval_ovr', 5], ['bonus_track', 6]]) {
      const ids = Object.keys(maps[key]).map(k => gbEntryId(key, k));
      const unread = ids.filter(x => !x).length, missing = ids.filter(x => x && !emps.has(x)).length;
      const out = ids.filter(x => x === 'E-OUT').length;
      assert.equal((await r(n)).value, `オブジェクト・記録 ${ids.length}・社員 ID の読めない記録 ${unread}・社員の表に無い ID ${missing}・退職した人 ${out}`, key + ' round ' + round);
    }
  }
  await db.query(`update public.app_state set value = '"{\\"E-1\\": []}"' where key = 'grade_hist'`);   // 前の版が JSON の文字で書いた行
  assert.equal((await r(4)).value.split('・')[0], 'JSON の文字'); assert.match((await r(4)).ok, /^info/);
  await db.query(`update public.app_state set value = '[1]' where key = 'bonus_track'`);
  assert.equal((await r(6)).value.split('・')[0], 'array'); assert.match((await r(6)).ok, /^NG/);
  await db.exec(`delete from public.app_state where ${GBSQL}`);
  assert.deepEqual([(await r(4)).value, (await r(4)).ok], ['行なし・記録 0・社員 ID の読めない記録 0・社員の表に無い ID 0・退職した人 0', 'OK']);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await d2.query(`select count(*)::int c from pg_policies where tablename = 'app_state' and policyname = 'ss_secret'`)).rows[0].c, 0, 'nothing made either (one transaction)');
  assert.equal((await d2.query(`select public.ss_secret_key('grade_hist') s`).catch(() => ({ rows: [{ s: 'none' }] }))).rows[0].s, 'none', 'the rule function was not made either');
  await d2.close();
});
