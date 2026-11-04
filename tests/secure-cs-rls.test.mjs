// v1140（2b-2）：app_state の RLS に Career Score のキーを足す SQL（20261109090000）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1139 の SQL のあと／v1139 の SQL がまだ（RLS が OFF・ON）のどれからでも：anon・authenticated は Career Score のキーも読めない・書けない・消せない
//   ・成長カルテ・賞与のキーは外したまま・ほかの行は今までどおり・サーバーの鍵は読み書きできる・行の一覧（app_state_index）にも出ない
//   ・2 回流しても同じ。確認の SQL がすべて OK（穴があれば NG）。最初に確かめる SQL（work-requests の写しを見る）が動く
//   ・戻す SQL で v1139 のあとと同じ（Career Score はまた読める・成長カルテ・賞与は外したまま）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（ssIsKey・csIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { secretKey } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql', '20261107090000_work_requests_ui68.sql'].map(f => rd('supabase/migrations/' + f));
const PRE = rd('db/secure-cs-precheck.sql');
const POST = rd('db/secure-cs-postcheck.sql');
const BACK = rd('db/secure-cs-rls-rollback.sql');
const KARTE = ['growth_karte', 'karte_pin', 'bonus_eval', 'spl_bonus_q_2026-Q3'];
const CS = ['lss_emp_Kai One', 'lss_emp_山田 太郎', 'spl_lss_requests_Kai One', 'spl_lss_history_Kai One', 'lss_scores', 'lss_requests', 'lss_history'];
const OTHER = ['tasks_all', 'cs_criteria', 'career_cfg', 'lss_rules', 'skills', 'spl_skill_history_Kai One', 'notifications'];

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    insert into public.stores values ('S1','Store One','Ami Area',true);`);
  const people = [['E-GM', 'Gabe GM', 'gm', 'General Manager', 'HQ', 'gm'], ['E-AM', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E-4', 'Leo Four', 'g4', 'Store Manager', 'S1', null],
    ['E-1', 'Kai One', 'crew', 'Crew', 'S1', null], ['E-1x', 'Kai One', 'crew', 'Crew', 'S1', null], ['E-OUT', 'Gone', 'crew', 'Crew', 'S1', null], ['E-G2', 'Gone', 'crew', 'Crew', 'S1', null]];   // 退職した人と同じ名前の在籍の人
  for (const [id, name, role, title, store, ma] of people) {
    await db.query(`insert into public.employees values($1,$2,$3,$4,$5,'[]'::jsonb,$6,'{}'::jsonb)`, [id, name, role, title, store, id === 'E-OUT' ? '退職' : '在籍']);
    if (ma) await db.query('insert into public.manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const m of WR) await db.exec(m);
  await db.exec('update public.wr_settings set live = true');
  const gm = { emp_id: 'E-GM', name: 'Gabe GM' };
  const d = (await db.query('select public.wr_people_diff($1::jsonb) v', [JSON.stringify(gm)])).rows[0].v;
  await db.query('select public.wr_people_sync($1::jsonb)', [JSON.stringify({ ...gm, digest: d.digest })]);
  // 確かめたあとに入った G4（確かめがまだ）
  await db.query(`insert into public.employees values('E-4b','Lia Four','g4','Store Manager','S1','[]'::jsonb,'在籍','{}'::jsonb)`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  const vals = [...KARTE, ...CS, ...OTHER, 'lss_emp_Lost Name'].map(k => `('${k}', '{"v":1}')`).join(',');
  await db.exec(`insert into public.app_state(key, value) values ${vals};`);
  await db.exec(IDX);
  if (initial === 'v1139') await db.exec(MIG39);
  return db;
}
const as = async (db, role, sql) => { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql) => { await db.exec(`set role ${role}`); try { await db.query(sql); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const postRows = async db => (await db.exec(POST)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;

for (const initial of ['v1139', 'off', 'on']) {
  test(`Career Score RLS (from ${initial}): the public keys lose the Career Score rows too; the rest is unchanged; rollback goes back to v1139`, async () => {
    const db = await mkdb(initial);
    const pre = (await db.query(PRE)).rows;
    assert.equal(pre.length, 12);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK'); assert.equal(pre.find(x => x.n === 3).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, initial === 'v1139' ? /^OK/ : /^info/);
    assert.match(pre.find(x => x.n === 4).value, /^3 行/);   // lss_emp_ 2＋Lost Name
    assert.match(pre.find(x => x.n === 7).value, /lss_history.*lss_requests.*lss_scores/);
    assert.equal(pre.find(x => x.n === 8).ok, 'OK');
    assert.match(pre.find(x => x.n === 9).value, /Kai One（2 人）/, 'two active people with the same name');
    assert.match(pre.find(x => x.n === 9).ok, /^info/);
    assert.match(pre.find(x => x.n === 9).value, /Gone（2 人）/, 'a retired person counts too (the function keeps that name for CEO/GM)');
    assert.match(pre.find(x => x.n === 10).ok, /^NG/); assert.match(pre.find(x => x.n === 10).value, /^1：Lia Four$/, 'the G4 added after the GM confirmed');
    assert.equal(pre.find(x => x.n === 12).value, '2', 'Lost Name and 山田 太郎 match no active person');
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), [...OTHER].sort(), role + ' sees only the other rows');
      for (const k of ['lss_emp_New', 'spl_lss_requests_Kai One', 'lss_scores']) assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('${k}', '{}') on conflict (key) do update set value = excluded.value`), role + ' cannot write ' + k);
      assert.equal((await as(db, role, `update public.app_state set value = '{"x":1}' where key = 'lss_emp_Kai One'`)).affectedRows, 0);
      assert.equal((await as(db, role, `delete from public.app_state where key like 'spl_lss_%'`)).affectedRows, 0);
      assert.ok(await fails(db, role, `update public.app_state set key = 'lss_emp_Kai Two' where key = 'tasks_all'`), role + ' cannot rename a row into a Career Score key');
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    assert.equal((await as(db, 'service_role', `update public.app_state set value = '{"by":"fn"}' where key = 'lss_emp_Kai One'`)).affectedRows, 1);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state_index()')), [...OTHER].sort());
    const rows = await postRows(db);
    assert.equal(rows.length, 12);
    rows.filter(x => x.ok !== 'info').forEach(x => assert.equal(x.ok, 'OK', x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 7).value, String(CS.length + 1), 'the server key sees every Career Score row');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key = 'lss_emp_zz-postcheck'`)).rows[0].c, 0, 'the write tries are rolled back');
    assert.equal((await db.query(`select current_user u`)).rows[0].u, 'postgres');
    // 穴があれば NG
    await db.exec('alter policy ss_secret on public.app_state using (true) with check (true)');
    const bad = await postRows(db);
    for (const n of [4, 5, 8, 9, 10, 11, 12]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec(MIG);
    // Career Score だけ戻す（2 回流しても同じ）：v1139 のあとと同じ
    await db.exec(BACK); await db.exec(BACK);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state')), [...CS, ...OTHER, 'lss_emp_Lost Name'].sort(), 'Career Score readable again; the karte/bonus keys stay closed');
    assert.equal((await as(db, 'anon', `update public.app_state set value = '{"y":1}' where key = 'lss_emp_Kai One'`)).affectedRows, 1);
    assert.equal((await as(db, 'anon', `update public.app_state set value = '{"y":1}' where key = 'growth_karte'`)).affectedRows, 0);
    await db.exec(MIG);
    assert.deepEqual(keysOf(await as(db, 'anon', 'select key from public.app_state')), [...OTHER].sort(), 'and in again');
    await db.close();
  });
}

test('the SQL rule and the function rule agree on every key (karte, bonus and Career Score)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const keys = [...KARTE, ...CS, ...OTHER, 'lss_emp_', 'spl_lss_requests_', 'spl_lss_history_', 'lss_emp', 'LSS_EMP_A', 'lss_scores ', ' lss_scores', 'lss_emp_\n', 'lss_emp_ ',
    'spl_lss_requests', 'spl_lss_historyX', 'lss_emp_' + 'x'.repeat(392), 'lss_emp_' + 'x'.repeat(393), 'spl_lss_history_名前', 'lss_emp_a"b', "lss_emp_a'b", 'lss_emp_a\\b', ''];
  for (let i = 0; i < 300; i++) {
    const p = ['lss_emp_', 'spl_lss_requests_', 'spl_lss_history_', 'lss_', 'spl_lss_', 'spl_bonus_q_', ''][i % 7];
    keys.push(p + Math.random().toString(36).slice(2, 2 + (i % 11)));
  }
  for (const k of keys) {
    const s = (await db.query('select public.ss_secret_key($1) s', [k])).rows[0].s;
    // 400 文字を超える Career Score のキーは、SQL では外す（公開の鍵では読めない）が、関数は扱わない（最初に確かめる SQL の 8 で数える）
    const want = k.length > 400 && /^(lss_emp_|spl_lss_requests_|spl_lss_history_)/.test(k) ? true : secretKey(k);
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
