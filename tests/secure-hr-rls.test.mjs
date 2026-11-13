// v1142（2b-4）：app_state の RLS に採用（応募者・不採用ログ）・お悩み相談室のキーを足す SQL（20261111090000）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1140 の SQL のあと（v1141 の決まりも）／v1139 のあと／RLS が OFF・ON から：anon・authenticated は採用・相談の行も読めない・書けない・消せない
//   ・成長カルテ・賞与・Career Score は外したまま・ほかの行は今までどおり・サーバーの鍵は読み書きできる・行の一覧（app_state_index）にも出ない
//   ・2 回流しても同じ。確認の SQL がすべて OK（穴があれば NG）。最初に確かめる SQL が動く（中身は出さない）
//   ・戻す SQL で v1140 のあとと同じ（採用・相談はまた読める・成長カルテ・賞与・Career Score は外したまま・v1141 の決まりはそのまま）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（ssIsKey・csIsKey・hrIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { secretKey, hrIsKey } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG41 = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const MIG = rd('supabase/migrations/20261111090000_secure_hr_rls.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql', '20261107090000_work_requests_ui68.sql'].map(f => rd('supabase/migrations/' + f));
const PRE = rd('db/secure-hr-precheck.sql');
const POST = rd('db/secure-hr-postcheck.sql');
const BACK = rd('db/secure-hr-rls-rollback.sql');
const KARTE = ['growth_karte', 'karte_pin', 'bonus_eval', 'spl_bonus_q_2026-Q3'];
const CS = ['lss_emp_Kai One', 'spl_lss_requests_Kai One', 'lss_scores'];
const HR = ['applicants', 'reject_log', 'growthhub'];
const OTHER = ['tasks_all', 'onboardings', 'mileage_config', 'career_cfg', 'notifications', 'applicants_old'];
const V = {
  applicants: [{ id: 'a1', name: 'Ann', store: 'Alpha', status: '応募中' }, { id: 'a 2', name: 'Bad Id', store: 'Nowhere', status: '応募中' }, { id: 'a3', name: 'U', store: '未分類', status: '要確認' }],
  reject_log: [{ name: 'Rex', store: 'Beta', reason: 'r' }, { name: 'Lost', store: 'Closed Shop', reason: 'r' }],
  growthhub: [{ id: 'gh1', title: 't', author: 'Kai One', store: 'S1' }, { id: 'gh2', title: 't', author: 'Gone', store: 'S9' }],
};

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.stores values ('S1','Alpha Kaimuki','Alpha','Ami Area',true,null), ('S2','Beta Ward','Beta',null,true,null),
      ('S3',null,null,null,true,'{"name":"Nowhere Ward","brand":"Nowhere"}');   -- 列が空で中身（data）にだけブランドがある店`);
  const people = [['E-GM', 'Gabe GM', 'gm', 'General Manager', 'HQ', 'gm'], ['E-AM', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E-1', 'Kai One', 'crew', 'Crew', 'S1', null], ['E-OUT', 'Gone', 'crew', 'Crew', 'S1', null]];
  for (const [id, name, role, title, store, ma] of people) {
    await db.query(`insert into public.employees values($1,$2,$3,$4,$5,'[]'::jsonb,$6,'{}'::jsonb)`, [id, name, role, title, store, id === 'E-OUT' ? '退職' : '在籍']);
    if (ma) await db.query('insert into public.manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  // 社員の行が無い社員 ID の経理（① の 13 行目で数える）・社員と結ばれていない CEO（数えない）
  await db.query(`insert into public.manager_auth(role, emp_id) values ('office', 'E-GONE'), ('ceo', null), ('office_crew', 'E-GONE2')`);
  for (const m of WR) await db.exec(m);
  await db.exec('update public.wr_settings set live = true');
  // 確かめたあとに入った AM（確かめがまだ）
  const gm = { emp_id: 'E-GM', name: 'Gabe GM' };
  const d = (await db.query('select public.wr_people_diff($1::jsonb) v', [JSON.stringify(gm)])).rows[0].v;
  await db.query('select public.wr_people_sync($1::jsonb)', [JSON.stringify({ ...gm, digest: d.digest })]);
  await db.query(`insert into public.employees values('E-AM2','Una Unconf','am','Area Manager','S2','[]'::jsonb,'在籍','{}'::jsonb)`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  for (const k of [...KARTE, ...CS, ...OTHER]) await db.query(`insert into public.app_state(key, value) values ($1, '{"v":1}')`, [k]);
  for (const k of HR) await db.query(`insert into public.app_state(key, value) values ($1, $2::jsonb)`, [k, JSON.stringify(V[k])]);
  await db.exec(IDX);
  if (initial === 'v1139' || initial === 'v1140' || initial === 'v1141') await db.exec(MIG39);
  if (initial === 'v1140' || initial === 'v1141') await db.exec(MIG40);
  if (initial === 'v1141') await db.exec(MIG41);
  return db;
}
const as = async (db, role, sql) => { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;

for (const initial of ['v1141', 'v1140', 'v1139', 'off', 'on']) {
  test(`hiring/consultation RLS (from ${initial}): the public keys lose those rows too; the rest is unchanged; rollback goes back to v1140`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 13);
    assert.equal(pre.find(x => x.n === 13).value, '1', 'the office account linked to a removed employee (not the unlinked CEO, not office crew)');
    assert.match(pre.find(x => x.n === 13).ok, /^info/);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK'); assert.equal(pre.find(x => x.n === 3).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, ['v1141', 'v1140', 'v1139'].includes(initial) ? /^OK/ : /^info/);
    assert.match(pre.find(x => x.n === 4).value, /^3 件・/); assert.equal(pre.find(x => x.n === 4).ok, 'info');
    assert.match(pre.find(x => x.n === 5).value, /^2 件・/); assert.match(pre.find(x => x.n === 6).value, /^2 件・/);
    assert.equal(pre.find(x => x.n === 7).value, '1', 'the closed shop (reject); Nowhere is the brand of S3 in data (the columns are empty)');
    assert.equal(pre.find(x => x.n === 8).value, '1', 'the applicant id with a space');
    assert.equal(pre.find(x => x.n === 9).value, '1', 'store S9 is not in the store table');
    assert.equal(pre.find(x => x.n === 10).value, '1', 'Gone is retired');
    assert.match(pre.find(x => x.n === 11).value, /^1：Una Unconf$/, 'the AM added after the GM confirmed');
    const preText = JSON.stringify(pre);
    for (const s of ['Ann', 'Rex', 'Bad Id', 'Lost']) assert.ok(!preText.includes(s), 'no applicant or reject names in the precheck: ' + s);
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), [...OTHER].sort(), role + ' sees only the other rows');
      for (const k of HR) assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('${k}', '[]') on conflict (key) do update set value = excluded.value`), role + ' cannot write ' + k);
      assert.equal((await as(db, role, `update public.app_state set value = '[]' where key in ('applicants','reject_log','growthhub')`)).affectedRows, 0);
      assert.equal((await as(db, role, `delete from public.app_state where key in ('applicants','reject_log','growthhub')`)).affectedRows, 0);
      assert.ok(await fails(db, role, `update public.app_state set key = 'growthhub_x' where key = 'tasks_all'`) === false, 'a neighbour name is fine');
      assert.ok(await fails(db, role, `update public.app_state set key = 'applicants' where key = 'applicants_old'`), role + ' cannot rename a row into a hiring key');
      await as(db, role, `update public.app_state set key = 'tasks_all' where key = 'growthhub_x'`);
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    assert.equal((await as(db, 'service_role', `update public.app_state set value = '[]' where key = 'growthhub'`)).affectedRows, 1);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state_index()')), [...OTHER].sort());
    const rows = await postRows(db);
    assert.equal(rows.length, 15);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 7).value, '3', 'the server key sees the three rows');
    assert.match(rows.find(x => x.n === 13).ok, initial === 'v1141' ? /^OK/ : /^info/);
    assert.deepEqual((await db.query(`select value v from public.app_state where key = 'growthhub'`)).rows[0].v, [], 'the write tries of the check are rolled back');
    // 穴があれば NG
    await db.exec('alter policy ss_secret on public.app_state using (true) with check (true)');
    const bad = await postRows(db);
    for (const n of [4, 5, 8, 9, 10, 11, 12]) assert.equal(bad.find(x => x.n === n).ok.slice(0, 2), 'NG', 'the check sees the hole: row ' + n);
    await db.exec(MIG);
    // 採用・相談だけ戻す（2 回流しても同じ）：v1140 のあとと同じ
    await db.exec(BACK); await db.exec(BACK);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state')), [...HR, ...OTHER].sort(), 'hiring readable again; karte/bonus/Career Score stay closed');
    assert.equal((await as(db, 'anon', `update public.app_state set value = '[]' where key = 'applicants'`)).affectedRows, 1);
    assert.equal((await as(db, 'anon', `update public.app_state set value = '{}' where key = 'lss_emp_Kai One'`)).affectedRows, 0);
    if (initial === 'v1141') assert.ok(await fails(db, 'anon', `update public.app_state set value = '{"ratePerMile":9}' where key = 'mileage_config'`) || (await as(db, 'anon', `update public.app_state set value = '{"ratePerMile":9}' where key = 'mileage_config'`)).affectedRows === 0, 'the v1141 rule is still there');
    await db.exec(MIG);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state')), [...OTHER].sort(), 'and in again');
    await db.close();
  });
}

test('the SQL rule and the function rule agree on every key (karte, bonus, Career Score and hiring)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const keys = [...KARTE, ...CS, ...HR, ...OTHER, 'applicant', 'Applicants', ' applicants', 'applicants ', 'reject_log2', 'growthhub_', 'growth_hub', 'reject_logs', 'lss_emp_A', 'spl_bonus_q_x', ''];
  for (let i = 0; i < 200; i++) keys.push(['applicants', 'reject_log', 'growthhub', 'lss_emp_', 'x'][i % 5] + (i % 3 ? Math.random().toString(36).slice(2, 2 + (i % 7)) : ''));
  for (const k of keys) {
    const s = (await db.query('select public.ss_secret_key($1) s', [k])).rows[0].s;
    const want = k.length > 400 && /^(lss_emp_|spl_lss_requests_|spl_lss_history_)/.test(k) ? true : (secretKey(k) || hrIsKey(k));
    assert.equal(s, want, JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_secret_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) when there is no app_state; RLS off with stray policies also stops', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  await d2.close();
});

test('the checks work on a json column too, and the postcheck shows routes around the rules (definer functions, views)', async () => {
  const db = await mkdb('v1141');
  await db.exec('alter table public.app_state alter column value type json using value::json');
  await db.exec(`insert into public.employees values('E-G4X','Gil Four','g4','Store Manager','S1','[]'::jsonb,'在籍','{}'::jsonb),
    ('E-SMX','Sue Manager','sl','Store Manager','S2','[]'::jsonb,'在籍','{}'::jsonb), ('E-SLX','Lee Lead','sl','Server Leader','S2','[]'::jsonb,'在籍','{}'::jsonb)`);
  const pre = (await db.query(PRE)).rows;
  assert.equal(pre.find(x => x.n === 11).value, '3：Gil Four・Sue Manager・Una Unconf', 'G4 and store managers without a confirmed copy too (not the leader)');
  assert.equal(pre.length, 13);
  assert.match(pre.find(x => x.n === 4).value, /^3 件・/, 'json column: counted like jsonb');
  assert.equal(pre.find(x => x.n === 8).value, '1');
  await db.exec(MIG);
  let rows = await postRows(db);
  assert.equal(rows.length, 15);
  rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
  // 決まりを通らない道を作る：postcheck が名前を出す
  await db.exec(`create function public.peek_state(k text) returns json language sql security definer set search_path = public as $$ select value from public.app_state where key = k $$;
    grant execute on function public.peek_state(text) to anon;
    create view public.state_view as select key, value from public.app_state;
    grant select on public.state_view to anon;`);
  assert.ok((await as(db, 'anon', `select public.peek_state('applicants') v`)).rows[0].v, 'the definer function does go around the rule');
  rows = await postRows(db);
  assert.match(rows.find(x => x.n === 14).ok, /^CHECK/); assert.match(rows.find(x => x.n === 14).value, /peek_state/);
  assert.match(rows.find(x => x.n === 15).ok, /^CHECK/); assert.match(rows.find(x => x.n === 15).value, /state_view/);
  await db.exec('alter view public.state_view set (security_invoker = true)');
  rows = await postRows(db);
  assert.match(rows.find(x => x.n === 15).ok, /^OK/, 'a security_invoker view follows the rules');
  await db.close();
});
