// v1147（2b-9）：Tip の期間の確定（tip_cf_）と注意ログ（warnings_）を公開の鍵で読み書きできなくする SQL（20261116090000）を、本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1146 の SQL のあと／v1144 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は 2 つの行を読めない・足せない・直せない・消せない・
//     名前を変えて入れられない。v1144 までのキー（成長カルテ・採用・個人の欄など）も閉じたまま。ほかの行は今までどおり。サーバーの鍵は読み書きできる
//   ・2 回流しても同じ。最初に確かめる SQL（10 行）が動く・確認の SQL（15 行）がすべて OK（穴があれば NG）
//   ・戻す SQL で v1146 のあとと同じ（2 つはまた読める・ほかは閉じたまま）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（scIsKey）とアプリの決まり（index.html の scIsKey）が同じ（関数とアプリは 200 字まで。SQL は長さによらず閉じる）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { scIsKey } from '../supabase/functions/secure-state/handler.mjs';

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
const MIG = rd('supabase/migrations/20261116090000_secure_tip_cf.sql');
const CHEF = rd('supabase/migrations/20261113080000_wr_people_chef.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-tip-cf-precheck.sql');
const POST = rd('db/secure-tip-cf-postcheck.sql');
const BACK = rd('db/secure-tip-cf-rollback.sql');
const CF = (from, o = {}) => ({ status: '確定済み', from, rows: [{ name: 'Kai One', final: 123.45 }], totalFinal: 123.45, _at: 1762700000000, ...o });
const SC = {
  tip_cf_S1_2026: { '2026-11-01': CF('2026-11-01'), '2026-10-16': { _deleted: true, by: 'GM', _at: 1762000000000 } },
  tip_cf_S2_2026: { '2026-11-01': CF('2026-11-01'), bad: 1 },
  tip_cf_odd: { x: 1 },
  warnings_S1: [{ date: '2026/11/01', by: 'Yuki', reason: '必須タスク未完了 1件', id: 'wA', _mut: 1 }, { date: '2026/10/01', by: 'Yuki', reason: '必須タスク未完了 2件' }],
  warnings_S9: [],
};
const SCK = Object.keys(SC).sort();
const OLD_SECRET = ['growth_karte', 'applicants', 'lss_emp_Kai One', 'emp_pii'];
const OTHER = ['tasks_all', 'cash_tips_S1', 'tip_history', 'prep_cfg', 'warning_S1', 'tip_cfx'];
const TIPREQ = 'spl_tip_requests_Kai One';   // v1146：読めるが書けない（ss_guard_*）

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
      ('E-1','Kai One','crew','Crew','S1','',null), ('E-OUT','Gone Am','am','Area Manager','S1','退職',null);`);
  await db.exec(WR);
  await db.exec(CHEF);
  await db.query(`insert into public.wr_people(emp_id, name, role, grade, chef) values ('E-4', 'Leo Four', 'staff', 4, false), ('E-CH', 'Chef Ken', 'staff', 4, false)`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  for (const [k, v] of Object.entries(SC)) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [k, JSON.stringify(v)]);
  for (const k of [...OLD_SECRET, ...OTHER, TIPREQ]) await db.query(`insert into public.app_state(key, value) values ($1, '{"v":1}')`, [k]);
  await db.exec(IDX);
  if (initial === 'v1146') for (const m of [MIG39, MIG40, MIG41, MIG42, MIG43, MIG44, MIG45, MIG46]) await db.exec(m);
  if (initial === 'v1144') for (const m of [MIG39, MIG40, MIG42, MIG44]) await db.exec(m);
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { await db.query(sql, p); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const resRows = async (db, sql) => (await db.exec(sql)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;

for (const initial of ['v1146', 'v1144', 'off', 'on']) {
  test(`tip confirmation / warning log v1147 (from ${initial}): anon/authenticated cannot read or write them (or the older keys); the rest is unchanged; rollback to v1146`, async () => {
    const db = await mkdb(initial);
    const pre = await resRows(db, PRE);
    assert.equal(pre.length, 10);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, /v114/.test(initial) ? /^OK/ : /^info/);
    assert.equal(pre.find(x => x.n === 3).value, /v114/.test(initial) ? 'ON' : (initial === 'on' ? 'ON' : 'OFF'));
    assert.equal(pre.find(x => x.n === 4).value, '3 行・オブジェクトでない行 0・記録 5（確定 2・解除 1・形の合わない記録 2）・店と年の形でないキー 1・200 字より長いキー 0');
    assert.match(pre.find(x => x.n === 4).ok, /^info/);
    assert.equal(pre.find(x => x.n === 5).value, '2 行・配列でない行 0・記録 2・id の無い記録 1・オブジェクトでない記録 0・200 字より長いキー 0'); assert.equal(pre.find(x => x.n === 5).ok, 'OK');
    assert.equal(pre.find(x => x.n === 6).value, '2', 'tip_cf_odd (no store) and warnings_S9');
    assert.equal(pre.find(x => x.n === 7).value, '1', 'the AM (no confirmed copy); the G4 and the Head Chef are confirmed; the retired one is not counted');
    assert.equal(pre.find(x => x.n === 8).value, '1', 'Head Chef without the chef mark');
    assert.equal(pre.find(x => x.n === 9).value, '1', 'office crew not linked');
    assert.equal(pre.find(x => x.n === 10).value, '1', 'office account with a missing employee');
    assert.ok(!/Kai One|Amy Area|Chef Ken|Oscar|Olga|123\.45|必須タスク/.test(JSON.stringify(pre)), 'no names, amounts or warning text are shown');
    const otherBefore = keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OTHER]));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where left(key, 7) = 'tip_cf_' or left(key, 9) = 'warnings_'`)), [], role + ' reads none of the two kinds');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OLD_SECRET])), [], role + ' reads none of the older keys');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OTHER])), otherBefore, role + ' reads the other rows as before');
      for (const k of [...SCK, 'tip_cf_S3_2026', 'warnings_S3', 'tip_cf_' + 'x'.repeat(300)]) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ($1, '[]') on conflict (key) do update set value = excluded.value`, [k]), role + ' cannot upsert ' + k.slice(0, 30));
      }
      for (const k of SCK) {
        assert.equal((await as(db, role, `update public.app_state set value = '[]' where key = $1`, [k])).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = $1`, [k])).affectedRows, 0, role + ' cannot delete ' + k);
      }
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      for (const k of OTHER) assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = $1`, [k])).affectedRows, 1, role + ' still writes ' + k);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'warnings_S5' where key = 'tasks_all'`), 'cannot rename a row into a warning row');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where left(key, 7) = 'tip_cf_' or left(key, 9) = 'warnings_'`)), [], 'not in the row list');
    assert.deepEqual(keysOf(await as(db, 'service_role', `select key from public.app_state where left(key, 7) = 'tip_cf_' or left(key, 9) = 'warnings_'`)), SCK, 'the server key reads them');
    assert.equal((await as(db, 'service_role', `update public.app_state set value = value where key = 'warnings_S1'`)).affectedRows, 1, 'the server key writes them');
    if (initial === 'v1146') {   // v1141〜v1146 の決まり（書けない設定）はそのまま
      assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [TIPREQ])).affectedRows, 0, 'v1146 guard still on');
      assert.equal((await as(db, 'anon', `select key from public.app_state where key = $1`, [TIPREQ])).rows.length, 1, 'and still readable');
    }
    const rows = await resRows(db, POST);
    assert.equal(rows.length, 15);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '24');
    assert.equal(rows.find(x => x.n === 7).value, '5');
    assert.equal(rows.find(x => x.n === 13).ok, initial === 'v1146' ? 'OK（入っている）' : 'info（v1141〜v1146 の SQL がまだ）');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'warnings_zz_v1147_postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'warnings_S1'`)).rows[0].value, SC.warnings_S1, 'the postcheck changed nothing');
    // 穴があれば NG
    await db.exec(`drop policy ss_secret on public.app_state; create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text) or left(key, 9) = 'warnings_') with check (not public.ss_secret_key(key::text) or left(key, 9) = 'warnings_')`);
    const bad = await resRows(db, POST);
    for (const n of [4, 8, 9, 10]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec('drop policy ss_secret on public.app_state');
    assert.equal((await resRows(db, POST)).find(x => x.n === 2).ok, 'NG', 'a missing policy is NG');
    await db.exec(MIG);
    // 戻す（2 回流しても同じ）：2 つはまた読める・書ける。ほかは閉じたまま。3 行目と 4 行目が NG
    await db.exec(BACK); await db.exec(BACK);
    const back = await resRows(db, POST);
    assert.equal(back.find(x => x.n === 3).ok, 'NG'); assert.equal(back.find(x => x.n === 3).value, '19'); assert.equal(back.find(x => x.n === 4).ok, 'NG');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where left(key, 7) = 'tip_cf_' or left(key, 9) = 'warnings_'`)), SCK, 'readable again after the rollback');
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'warnings_S1'`)).affectedRows, 1, 'writable again');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OLD_SECRET])), [], 'the older keys stay closed');
    assert.equal((await db.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, true, 'RLS stays on');
    await db.exec(MIG);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where left(key, 9) = 'warnings_'`)), [], 'and closed again');
    // 戻す SQL は、決まりが無いときは決まりを作らない
    await db.exec(`drop policy ss_secret on public.app_state`);
    await db.exec(BACK);
    assert.equal((await db.query(`select count(*)::int c from pg_policies where tablename = 'app_state' and policyname = 'ss_secret'`)).rows[0].c, 0);
    await db.close();
  });
}

test('the SQL rule, the function rule and the app rule agree on the two kinds (SQL closes longer keys too)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var SC_TIP_PRE = '[^']*', SC_WN_PRE = '[^']*';/), pick(/function scIsKey\(k\)\{[^\n]*\}/), 'this.appIs = scIsKey;'].join('\n'), ctx);
  const keys = [...SCK, ...OTHER, 'tip_cf_', 'warnings_', 'tip_cf', 'warnings', 'Tip_cf_S1_2026', 'WARNINGS_S1', ' tip_cf_S1', 'tip_cf_ ', 'warnings_ ', 'tip_cf_日本語の店_2026',
    'tip_cf_' + 'x'.repeat(193), 'tip_cf_' + 'x'.repeat(194), 'warnings_' + 'x'.repeat(191), 'warnings_' + 'x'.repeat(192), 'tip_cf_' + 'x'.repeat(3000), 'toString', '__proto__', ''];
  for (let i = 0; i < 400; i++) keys.push(['tip_cf_', 'warnings_', 'tip_c', 'warning', 'tip_', ''][i % 6] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_secret_key($1) s', [k])).rows[0].s;
    const fnIs = scIsKey(k), looks = (k.startsWith('tip_cf_') && k.length > 7) || (k.startsWith('warnings_') && k.length > 9);
    assert.equal(ctx.appIs(k), fnIs, 'app vs function ' + JSON.stringify(k.slice(0, 40)));
    if (OTHER.includes(k) || !looks) assert.equal(s, false, 'sql: not a key of the two kinds ' + JSON.stringify(k.slice(0, 40)));
    else { assert.equal(s, true, 'sql closes ' + JSON.stringify(k.slice(0, 40))); assert.equal(fnIs, k.length <= 200, 'the function serves up to 200 characters'); }
  }
  assert.equal((await db.query('select public.ss_secret_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy; the precheck sees odd shapes', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await d2.query(`select count(*)::int c from pg_policies where tablename = 'app_state' and policyname = 'ss_secret'`)).rows[0].c, 0, 'nothing made either (one transaction)');
  const r = async n => (await resRows(d2, PRE)).find(x => x.n === n);
  await d2.query(`update public.app_state set value = '[1]' where key = 'tip_cf_S2_2026'`);
  assert.match((await r(4)).value, /オブジェクトでない行 1/); assert.match((await r(4)).ok, /^NG/);
  await d2.query(`update public.app_state set value = '{"a":1}' where key = 'warnings_S1'`);
  assert.match((await r(5)).value, /配列でない行 1/); assert.match((await r(5)).ok, /^NG/);
  await d2.query(`update public.app_state set value = '[1, {"id":"x"}]' where key = 'warnings_S1'`);
  assert.match((await r(5)).value, /オブジェクトでない記録 1/); assert.match((await r(5)).ok, /^info/);
  await d2.query(`insert into public.app_state(key, value) values ($1, '{}')`, ['tip_cf_' + 'x'.repeat(300) + '_2026']);
  assert.match((await r(4)).value, /200 字より長いキー 1/); assert.match((await r(4)).ok, /^NG/);
  // 行が 1 つも無くても動く
  await d2.exec(`delete from public.app_state where left(key, 7) = 'tip_cf_' or left(key, 9) = 'warnings_'`);
  assert.equal((await r(4)).value, '0 行・オブジェクトでない行 0・記録 0（確定 0・解除 0・形の合わない記録 0）・店と年の形でないキー 0・200 字より長いキー 0');
  assert.equal((await r(4)).ok, 'OK');
  await d2.close();
});
