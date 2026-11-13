// v1152（2b の最後）：通知（notifications）を公開の鍵で読めない・書けなくする SQL（20261119090000）を、本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1148 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は通知の行を読めない・足せない・直せない・消せない・名前を変えて入れられない。
//     v1148 までのキーも閉じたまま。ほかの行は今までどおり。サーバーの鍵は読み書きできる
//   ・2 回流しても同じ。最初に確かめる SQL（9 行）が動く・確認の SQL（15 行）がすべて OK（穴があれば NG）
//   ・v1151 の SQL（fp_sec_cat）があれば機密の区分に notifications を足す（ほかのキーの区分は v1151 と同じ）。無ければ何もしない
//   ・戻す SQL で v1148 のあとと同じ（通知はまた読める・ほかは閉じたまま。区分は v1151 の形）
//   ・SQL の決まり（ss_secret_key）と関数の決まり（ntIsKey・ssIsKey など）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { ntIsKey, ssIsKey, csIsKey, hrIsKey, piiIsKey, scIsKey, gbIsKey } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG48 = rd('supabase/migrations/20261117090000_secure_grade_bonus_read.sql');
const MIG51 = rd('supabase/migrations/20261118090000_change_signal.sql');
const MIG = rd('supabase/migrations/20261119090000_secure_notifications.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const CHEF = rd('supabase/migrations/20261113080000_wr_people_chef.sql');
const G2SQL = rd('supabase/migrations/20261116080000_wr_people_g2.sql');
const PRE = rd('db/secure-notifications-precheck.sql');
const POST = rd('db/secure-notifications-postcheck.sql');
const BACK = rd('db/secure-notifications-rollback.sql');
// v1151 の機密の区分の関数だけ（合図と変更の記録の表・見張りは試験に要らない）
const CAT51 = (() => { const i = MIG51.indexOf('create or replace function public.fp_sec_cat'); const j = MIG51.indexOf('\n$$;', i); assert.ok(i > 0 && j > i); return MIG51.slice(i, j + 4); })();
const NT = [
  { id: 'a', by: 'X', toStore: 'S1', toRoles: ['sl', 'am'], title: '退職手続き開始', text: '理由', readBy: [] },
  { id: 'b', by: 'Y', toUser: 'Kai One', title: '特別育成', readBy: ['Kai One'] },
  { id: 'c', by: 'Z', title: 'だれあてでもない' },
  { title: 'id なし' },
];
const OLD_SECRET = ['growth_karte', 'applicants', 'lss_emp_Kai One', 'emp_pii', 'tip_cf_S1_2026', 'warnings_S1', 'grade_hist'];
const OTHER = ['tasks_all', 'notifications_x', 'invoice_qb_alerts', 'notip_config', 'approvals'];
const CATKEYS = ['growth_karte', 'bonus_q', 'spl_bonus_q_2026-Q3', 'lss_emp_A', 'applicants', 'growthhub', 'emp_pii', 'tip_cf_S1_2026', 'warnings_S1', 'grade_hist', 'bonus_track', 'something_else'];

async function mkdb(initial) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.stores(id, name) values ('S1', 'Store One'), ('S2', 'Store Two');
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM');
    insert into public.employees(id, name, role, title, store, status, data) values
      ('E-GM','Gina M','gm','General Manager','HQ','',null), ('E-AM','Amy Area','am','Area Manager','S1','',null),
      ('E-3','Sal Three','sl','Store Leader','S1','',null), ('E-3B','Tim Three','sl','Store Leader','S2','',null),
      ('E-CH','Chef Ken',null,'','S1','','{"role":"chef","title":"Head Chef"}'), ('E-1','Kai One','crew','Crew','S1','',null),
      ('E-OUT','Gone','sl','Store Leader','S1','退職',null);`);
  await db.exec(WR); await db.exec(CHEF); await db.exec(G2SQL);
  await db.query(`insert into public.wr_people(emp_id, name, role, grade, chef) values ('E-3', 'Sal Three', 'staff', 3, false)`);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  await db.query(`insert into public.app_state(key, value) values ('notifications', $1)`, [JSON.stringify(NT)]);
  for (const k of [...OLD_SECRET, ...OTHER]) await db.query(`insert into public.app_state(key, value) values ($1, '{"v":1}')`, [k]);
  await db.exec(IDX);
  if (initial === 'v1148' || initial === 'v1151') await db.exec(MIG48);
  if (initial === 'v1151') await db.exec(CAT51);
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { await db.query(sql, p); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const resRows = async (db, sql) => (await db.exec(sql)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;
const cats = async db => Object.fromEntries((await db.query(`select k, public.fp_sec_cat(k) c from unnest($1::text[]) k`, [[...CATKEYS, 'notifications']])).rows.map(r => [r.k, r.c]));

for (const initial of ['v1151', 'v1148', 'off', 'on']) {
  test(`notifications v1152 (from ${initial}): anon/authenticated cannot read or write the row (or the older keys); the rest is unchanged; rollback to v1148`, async () => {
    const db = await mkdb(initial);
    const pre = await resRows(db, PRE);
    assert.equal(pre.length, 9);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, /v11/.test(initial) ? /^OK/ : /^info/);
    assert.deepEqual([pre.find(x => x.n === 4).value.replace(/大きさ \d+/, '大きさ N'), pre.find(x => x.n === 4).ok], ['配列・通知 4・大きさ N バイト', 'OK']);
    assert.equal(pre.find(x => x.n === 5).value, '2', 'no destination: c and the one without id');
    assert.equal(pre.find(x => x.n === 6).value, '1', 'no id');
    assert.equal(pre.find(x => x.n === 7).value, '2', 'the SL of S2 and the Head Chef (no confirmed copy)');
    assert.equal(pre.find(x => x.n === 8).value, '1', 'the AM (no confirmed copy)');
    assert.equal(pre.find(x => x.n === 9).value, initial === 'v1151' ? 'ある' : 'ない');
    assert.ok(!/Kai One|退職手続き|理由|特別育成|Sal|Tim|Chef Ken/.test(JSON.stringify(pre)), 'no names or contents are shown');
    const before51 = initial === 'v1151' ? await cats(db) : null;
    const otherBefore = keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OTHER]));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = 'notifications'`)), [], role + ' reads no notifications');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OLD_SECRET])), [], role + ' reads none of the older keys');
      assert.deepEqual(keysOf(await as(db, role, `select key from public.app_state where key = any($1)`, [OTHER])), otherBefore, role + ' reads the other rows as before');
      assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ('notifications', '[]') on conflict (key) do update set value = excluded.value`), role + ' cannot upsert');
      assert.equal((await as(db, role, `update public.app_state set value = '[]' where key = 'notifications'`)).affectedRows, 0, role + ' cannot update');
      assert.equal((await as(db, role, `delete from public.app_state where key = 'notifications'`)).affectedRows, 0, role + ' cannot delete');
      for (const k of OTHER) assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = $1`, [k])).affectedRows, 1, role + ' still writes ' + k);
    }
    await db.query(`delete from public.app_state where key = 'notifications'`);
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'notifications' where key = 'tasks_all'`), 'cannot rename a row into the notifications row');
    assert.ok(await fails(db, 'anon', `insert into public.app_state(key, value) values ('notifications', '[]')`), 'cannot add the missing row either');
    await db.query(`insert into public.app_state(key, value) values ('notifications', $1)`, [JSON.stringify(NT)]);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where key = 'notifications'`)), [], 'not in the row list');
    assert.deepEqual(keysOf(await as(db, 'service_role', `select key from public.app_state where key = 'notifications'`)), ['notifications'], 'the server key reads it');
    assert.equal((await as(db, 'service_role', `update public.app_state set value = value where key = 'notifications'`)).affectedRows, 1, 'the server key writes it');
    if (initial === 'v1151') {
      const after = await cats(db);
      assert.equal(after.notifications, 'notifications', 'the signal is _secure:notifications');
      for (const k of CATKEYS) assert.equal(after[k], before51[k], 'same category as v1151 for ' + k);
      assert.equal(before51.notifications, 'secure');
    } else assert.equal((await db.query(`select to_regprocedure('public.fp_sec_cat(text)') f`)).rows[0].f, null, 'the v1151 function is not made by this SQL');
    const rows = await resRows(db, POST);
    assert.equal(rows.length, 15);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '28');
    assert.equal(rows.find(x => x.n === 7).value, '1');
    assert.match(rows.find(x => x.n === 13).ok, initial === 'v1151' ? /^OK$/ : /^info/);
    assert.deepEqual((await db.query(`select value from public.app_state where key = 'notifications'`)).rows[0].value, NT, 'the postcheck changed nothing');
    // 穴があれば NG
    await db.exec(`drop policy ss_secret on public.app_state; create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text) or key = 'notifications') with check (not public.ss_secret_key(key::text) or key = 'notifications')`);
    const bad = await resRows(db, POST);
    for (const n of [4, 8, 9, 10, 12]) assert.match(bad.find(x => x.n === n).ok, /^NG/, 'hole found: ' + n);
    await db.exec(MIG);   // 直す
    // 戻す：通知はまた読める・ほかは閉じたまま
    await db.exec(BACK); await db.exec(BACK);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where key = 'notifications'`)), ['notifications']);
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state where key = any($1)`, [OLD_SECRET])), []);
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = 'notifications'`)).affectedRows, 1);
    if (initial === 'v1151') { const back = await cats(db); for (const k of [...CATKEYS, 'notifications']) assert.equal(back[k], before51[k], 'v1151 categories again: ' + k); }
  });
}

test('the SQL rule and the function rule agree (notifications and the older keys)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
  await db.exec(MIG);
  const keys = ['notifications', 'Notifications', 'notifications ', 'notification', 'notifications_x', 'growth_karte', 'spl_bonus_q_2026-Q3', 'lss_emp_A', 'spl_lss_requests_B', 'applicants', 'emp_pii',
    'tip_cf_S1_2026', 'warnings_S1', 'grade_hist', 'bonus_eval_ovr', 'bonus_track', 'tasks_all', 'cs_guide', 'bonus_coef', 'karte_pin'];
  const fnRule = k => ntIsKey(k) || ssIsKey(k) || csIsKey(k) || hrIsKey(k) || piiIsKey(k) || scIsKey(k) || gbIsKey(k);
  for (const k of keys) assert.equal((await db.query(`select public.ss_secret_key($1) s`, [k])).rows[0].s, fnRule(k), k);
});
