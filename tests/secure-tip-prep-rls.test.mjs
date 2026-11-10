// v1146（2b-8）：Tip Rate の申請・決定とプレップの時給の表・認定を公開の鍵で書けなくする SQL（20261115090000）を本物の PostgreSQL（PGlite）で確かめる。合成データだけ。
//   ・v1145 の SQL のあと／v1139〜v1145 の SQL のあと／RLS が OFF／ON（ほかの決まり）のどれからでも：anon・authenticated は Tip Rate の行（人ごと・前の統合行）・
//     プレップの表と認定を読めるが、足す・上書き・直す・消す・名前を変えて入れる、ができない。v1145 までの 11 も同じ。ほかの行（Tip の履歴・合図・プレップの店の設定）は今までどおり
//   ・2 回流しても同じ。最初に確かめる SQL（11 行）が動く・確認の SQL（22 行）がすべて OK（穴があれば NG）
//   ・戻す SQL で v1145 のあとと同じ（Tip Rate・プレップはまた書ける・11 は書けないまま）。v1145 の戻す SQL も今までどおり
//   ・SQL の決まり（ss_guard_key）と関数の決まり（swIsKey・tpIsKey）とアプリの決まり（index.html の gwIsKey）が同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { swIsKey, tpIsKey, SW2_KEYS, GH_KEYS, TP_KEYS } from '../supabase/functions/secure-state/handler.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG39 = rd('supabase/migrations/20261108090000_secure_state_rls.sql');
const MIG40 = rd('supabase/migrations/20261109090000_secure_cs_rls.sql');
const MIG41 = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const MIG42 = rd('supabase/migrations/20261111090000_secure_hr_rls.sql');
const MIG43 = rd('supabase/migrations/20261112090000_secure_settings_more.sql');
const MIG45 = rd('supabase/migrations/20261114090000_secure_grade_hist.sql');
const MIG = rd('supabase/migrations/20261115090000_secure_tip_prep.sql');
const CHEF = rd('supabase/migrations/20261113080000_wr_people_chef.sql');
const IDX = rd('supabase/migrations/20261027090000_app_state_index.sql');
const WR = rd('supabase/migrations/20261104090000_work_requests.sql');
const PRE = rd('db/secure-tip-prep-precheck.sql');
const POST = rd('db/secure-tip-prep-postcheck.sql');
const BACK = rd('db/secure-tip-prep-rollback.sql');
const BACK45 = rd('db/secure-grade-hist-rollback.sql');
const ELEVEN = ['mileage_config', 'career_cfg', ...SW2_KEYS, ...GH_KEYS];
const TIPK = n => 'spl_tip_requests_' + n;
const NEW = [...TP_KEYS, TIPK('Kai One'), TIPK('Ria Two')];
const GUARD = [...ELEVEN, ...NEW];
const OTHER = ['tasks_all', 'spl_tip_history_Kai One', 'tip_history', 'live_tip_rate', 'prep_cfg', 'prep_history', 'prep_certs_x', 'tip_requests_x'];
const TIP1 = [
  { id: 'tip0', name: 'Kai One', rate: 80, status: '承認', date: '2026/09/01', approver: 'Moto', decAt: 1762500000000 },
  { id: 'tip1', name: 'Kai One', rate: 90, status: '申請中', date: '2026/11/01' },
];
const TIP2 = [{ id: 'tip2', name: 'Ria Two', rate: 100, status: '承認', date: '2026/11/02', approver: 'Moto', decAt: 1762600000000 }];
const LEGACY = [TIP1[0], { id: 'tipOld', name: 'Ria Two', rate: 80, status: '承認', date: '2025/01/01' }];   // tipOld は人ごとの行に無い
const TBL = { t1: { store: 'S1', from: '2026-11-01', levels: [{ lv: 1, name: 'L1', cents: 1700 }], _at: 1762000000000 } };
const CERTS = { c1: { emp: 'E-1', name: 'Kai One', store: 'S1', lv: 2, state: 'approved', from: '2026-11-10', tbl: 't1', _at: 1762700000000 } };

async function mkdb(initial, o = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM'), ('ceo','E-CEO'), ('office', null), ('gm', '');
    insert into public.employees(id, name, role, title, store, status, data) values
      ('E-GM','Gina M','gm','General Manager','HQ','',null), ('E-AM','Amy Area','am','Area Manager','S1','',null),
      ('E-4','Leo Four','g4','Store Manager','S1','',null), ('E-CH','Chef Ken',null,'','S1','','{"role":"chef","title":"Head Chef"}'),
      ('E-CC','Corp Cora','chef','Corporate Chef','HQ','',null), ('E-1','Kai One','crew','Crew','S1','',null),
      ('E-OUT','Gone Am','am','Area Manager','S1','退職',null);`);
  await db.exec(WR);
  if (o.chef !== false) await db.exec(CHEF);
  if (o.live !== undefined) await db.query(`update public.wr_settings set live = $1 where id = 1`, [o.live]);
  if (o.conf) for (const c of o.conf) await db.query(`insert into public.wr_people(emp_id, name, role, grade${o.chef !== false ? ', chef' : ''}) values ($1, $2, $3, $4${o.chef !== false ? ', $5' : ''})`,
    o.chef !== false ? [c.emp, c.name, c.role, c.grade, !!c.chef] : [c.emp, c.name, c.role, c.grade]);
  if (initial === 'on') await db.exec(`alter table public.app_state enable row level security;
    create policy app_all on public.app_state for all to public using (true) with check (true);`);
  await db.query(`insert into public.app_state(key, value) values ('mileage_config', $1), ('career_cfg', $2), ('grade_hist', $3)`,
    [JSON.stringify({ gmapsKey: 'AIza-secret-x', ratePerMile: 0.7, roundTripDefault: true }), JSON.stringify({ '経理|G4': { csApprove: ['am'], _at: 5 } }), JSON.stringify({ 'E-1': { recs: [], _at: 1762400000000 } })]);
  for (const k of SW2_KEYS) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [k, JSON.stringify({ a: { v: 1, _at: 1762500000000 } })]);
  await db.query(`insert into public.app_state(key, value) values ($1, $2), ($3, $4), ('tip_requests', $5), ('prep_tables', $6), ('prep_certs', $7)`,
    [TIPK('Kai One'), JSON.stringify(TIP1), TIPK('Ria Two'), JSON.stringify(TIP2), JSON.stringify(LEGACY), JSON.stringify(TBL), JSON.stringify(CERTS)]);
  await db.exec(`insert into public.app_state(key, value) values ${['growth_karte', 'applicants', ...OTHER].map(k => `('${k}', '{"v":1}')`).join(',')};`);
  await db.exec(IDX);
  if (initial === 'v1145') { await db.exec(MIG41); await db.exec(MIG43); await db.exec(MIG45); }
  if (initial === 'v1144') { await db.exec(MIG39); await db.exec(MIG40); await db.exec(MIG41); await db.exec(MIG42); await db.exec(MIG43); await db.exec(MIG45); }
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { await db.query(sql, p); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const keysOf = r => r.rows.map(x => x.key).sort();
const resRows = async (db, sql) => (await db.exec(sql)).find(r => r.fields && r.fields.some(f => f.name === 'what')).rows;

for (const initial of ['v1145', 'v1144', 'off', 'on']) {
  test(`Tip Rate / prep guard v1146 (from ${initial}): anon/authenticated read but cannot write them (or the eleven); the rest is unchanged; rollback to v1145`, async () => {
    const db = await mkdb(initial, { live: false, conf: [{ emp: 'E-4', name: 'Leo Four', role: 'staff', grade: 4 }] });
    const pre = await resRows(db, PRE);
    assert.equal(pre.length, 11);
    assert.equal(pre.find(x => x.n === 1).ok, 'OK');
    assert.match(pre.find(x => x.n === 2).ok, initial === 'off' ? /^info/ : /^OK/);
    assert.equal(pre.find(x => x.n === 3).value, /v114[45]/.test(initial) ? '3' : '0');
    assert.equal(pre.find(x => x.n === 4).value, '2 行・3 件・決めたもの 2・配列でない行 0・同じ id のある行 0・形の合わない記録 0・200 字より長い名前の行 0'); assert.equal(pre.find(x => x.n === 4).ok, 'OK');
    assert.equal(pre.find(x => x.n === 5).value, '2 件・人ごとの行に無い記録 1'); assert.match(pre.find(x => x.n === 5).ok, /^info/);
    assert.equal(pre.find(x => x.n === 6).value, '1 件・形の合わない記録 0'); assert.equal(pre.find(x => x.n === 6).ok, 'OK');
    assert.equal(pre.find(x => x.n === 7).value, '1 件・形の合わない記録 0'); assert.equal(pre.find(x => x.n === 7).ok, 'OK');
    // AM（確かめていない・退職した人は数えない）・Head Chef（data の中の役割）・Corporate Chef。G4 は確かめてある
    assert.match(pre.find(x => x.n === 8).what, /AM 1・G4 0・Head Chef 1・Corporate Chef 1/); assert.equal(pre.find(x => x.n === 8).value, '3'); assert.match(pre.find(x => x.n === 8).ok, /^info/);
    assert.equal(pre.find(x => x.n === 9).value, 'OFF');
    assert.equal(pre.find(x => x.n === 10).value, '1'); assert.match(pre.find(x => x.n === 10).ok, /^info/);
    assert.equal(pre.find(x => x.n === 11).value, '3'); assert.equal(pre.find(x => x.n === 11).ok, 'OK');
    assert.ok(!/Kai One|Ria Two|Amy Area|Chef Ken|E-1\b/.test(JSON.stringify(pre)), 'no names or ids are shown');
    const allBefore = keysOf(await as(db, 'anon', 'select key from public.app_state'));
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(keysOf(await as(db, role, 'select key from public.app_state')), allBefore, role + ' reads the same rows as before');
      assert.equal((await as(db, role, `select value->1->>'status' s from public.app_state where key = $1`, [TIPK('Kai One')])).rows[0].s, '申請中', role + ' reads the Tip Rate rows');
      assert.equal((await as(db, role, `select value->'c1'->>'lv' lv from public.app_state where key = 'prep_certs'`)).rows[0].lv, '2', role + ' reads the prep certifications');
      for (const k of GUARD) {
        assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ($1, '[]') on conflict (key) do update set value = excluded.value`, [k]), role + ' cannot upsert ' + k);
        assert.equal((await as(db, role, `update public.app_state set value = '[]' where key = $1`, [k])).affectedRows, 0, role + ' cannot update ' + k);
        assert.equal((await as(db, role, `delete from public.app_state where key = $1`, [k])).affectedRows, 0, role + ' cannot delete ' + k);
      }
      for (const k of [TIPK('New Person'), TIPK('x'.repeat(400))]) assert.ok(await fails(db, role, `insert into public.app_state(key, value) values ($1, '[]')`, [k]), role + ' cannot create a Tip Rate row');
      await as(db, role, `insert into public.app_state(key, value) values ('x_${role}', '{}') on conflict (key) do update set value = excluded.value`);
      for (const k of OTHER) assert.equal((await as(db, role, `update public.app_state set value = '{"y":2}' where key = $1`, [k])).affectedRows, 1, role + ' still writes ' + k);
      assert.equal((await as(db, role, `delete from public.app_state where key = 'x_${role}'`)).affectedRows, 1);
    }
    assert.ok(await fails(db, 'anon', `update public.app_state set key = $1 where key = 'tasks_all'`, [TIPK('Kai Two')]), 'cannot rename a row into a Tip Rate row');
    assert.ok(await fails(db, 'anon', `update public.app_state set key = 'prep_tables_old' where key = 'prep_tables'`) || (await as(db, 'anon', `select count(*)::int c from public.app_state where key = 'prep_tables'`)).rows[0].c === 1, 'cannot rename the prep table away');
    assert.equal((await as(db, 'service_role', `insert into public.app_state(key, value) values ($1, '[]') returning key`, [TIPK('New Person')])).rows.length, 1, 'the server key writes');
    assert.deepEqual(keysOf(await as(db, 'anon', `select key from public.app_state_index() where key = any($1)`, [GUARD])), [...GUARD].sort(), 'still in the row list');
    if (initial === 'v1144') for (const k of ['growth_karte', 'applicants']) assert.equal((await as(db, 'anon', `select key from public.app_state where key = $1`, [k])).rows.length, 0, k + ' stays closed');
    const rows = await resRows(db, POST);
    assert.equal(rows.length, 22);
    rows.filter(x => !/^info/.test(x.ok)).forEach(x => assert.match(x.ok, /^OK/, x.n + ' ' + x.what + ' ' + x.value));
    assert.equal(rows.find(x => x.n === 3).value, '15');
    assert.equal(rows.find(x => x.n === 4).value, '17'); assert.equal(rows.find(x => x.n === 5).value, '17');   // 11＋前の統合行・表・認定・人ごとの行 3
    assert.equal(rows.find(x => x.n === 20).value, '3 行・3 件'); assert.equal(rows.find(x => x.n === 20).ok, 'OK');
    assert.equal(rows.find(x => x.n === 21).value, 'prep_tables 1 件 / prep_certs 1 件'); assert.equal(rows.find(x => x.n === 21).ok, 'OK');
    assert.equal(rows.find(x => x.n === 22).value, 'Tip Rate：2025-11-08 01:06 / prep_tables：2025-11-01 02:26 / prep_certs：2025-11-09 04:53', 'Hawaii time');
    assert.ok(!JSON.stringify(rows).includes('AIza-secret-x') && !/Kai One|Ria Two/.test(JSON.stringify(rows)), 'no secrets or names are shown');
    assert.equal((await db.query(`select count(*)::int c from public.app_state where key in ('zz_v1146_postcheck', $1)`, [TIPK('zz_check')])).rows[0].c, 0, 'the write tries are rolled back');
    assert.deepEqual((await db.query(`select value from public.app_state where key = $1`, [TIPK('Kai One')])).rows[0].value, TIP1, 'the postcheck changed nothing');
    // 穴があれば NG
    await db.exec('alter policy ss_guard_upd on public.app_state using (true) with check (true)');
    await db.exec('alter policy ss_guard_ins on public.app_state with check (true)');
    await db.exec('alter policy ss_guard_del on public.app_state using (true)');
    const bad = await resRows(db, POST);
    for (const n of [6, 7, 8, 10]) assert.equal(bad.find(x => x.n === n).ok, 'NG', 'the check sees the hole: row ' + n);
    await db.exec('drop policy ss_guard_del on public.app_state');
    assert.equal((await resRows(db, POST)).find(x => x.n === 2).ok, 'NG', 'a missing policy is NG');
    await db.exec(MIG);
    // 戻す（2 回流しても同じ）：Tip Rate・プレップはまた書ける・11 は書けないまま。ss_guard_key が v1145 のまま（キー 11）なら 3 行目と 6 行目が NG
    await db.exec(BACK); await db.exec(BACK);
    const b45 = await resRows(db, POST);
    assert.equal(b45.find(x => x.n === 3).ok, 'NG'); assert.equal(b45.find(x => x.n === 3).value, '11'); assert.equal(b45.find(x => x.n === 6).ok, 'NG');
    for (const k of NEW) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [k])).affectedRows, 1, k + ' writable again after the rollback');
    for (const k of ELEVEN) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [k])).affectedRows, 0, k + ' stays guarded');
    await db.exec(MIG);
    assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [TIPK('Kai One')])).affectedRows, 0, 'and closed again');
    // v1145 の戻す SQL：v1143 の 10 に戻る（グレード履歴・Tip Rate・プレップはまた書ける）
    await db.exec(BACK45);
    for (const k of ['grade_hist', ...NEW]) assert.equal((await as(db, 'anon', `update public.app_state set value = value where key = $1`, [k])).affectedRows, 1, k + ' writable after the v1145 rollback');
    await db.exec(MIG);
    // v1146 の戻す SQL は、決まりが無いときは何もしない（決まりを作らない）
    await db.exec(`drop policy ss_guard_ins on public.app_state; drop policy ss_guard_upd on public.app_state; drop policy ss_guard_del on public.app_state; drop function public.ss_guard_key(text);`);
    await db.exec(BACK);
    assert.equal((await db.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true);
    await db.close();
  });
}

test('the SQL rule, the function rule and the app rule agree on every key (Tip Rate and prep included)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb);`);
  await db.exec(MIG);
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var SW_KEYS = \{[^}]*\};/), pick(/var SW2_KEYS = \{[^}]*\};/), pick(/function sw2IsKey\(k\)\{[^\n]*\}/), pick(/var GH_KEYS = \{[^}]*\};/), pick(/function ghIsKey\(k\)\{[^\n]*\}/),
    pick(/function swIsKey\(k\)\{[^\n]*\}/), pick(/var TP_KEYS = \{[^}]*\};/), pick(/var TP_TIP_PRE = '[^']*';/), pick(/function tpIsKey\(k\)\{[^\n]*\}/), pick(/function gwIsKey\(k\)\{[^\n]*\}/),
    'this.appIs = gwIsKey; this.appTp = tpIsKey;'].join('\n'), ctx);
  const fnIs = k => swIsKey(k) || tpIsKey(k);
  const keys = [...GUARD, ...OTHER, 'spl_tip_requests_', 'spl_tip_requests_ ', TIPK('x'.repeat(183)), TIPK('x'.repeat(184)), TIPK('x'.repeat(3000)), 'Spl_tip_requests_x', ' spl_tip_requests_x',
    'spl_tip_request_x', 'tip_requests ', 'prep_tables\n', 'prep', 'tip', 'toString', '__proto__', 'constructor', '', TIPK('日本語の名前'), TIPK("O'Neil")];
  for (let i = 0; i < 400; i++) keys.push(['spl_tip_requests_', 'spl_tip_', 'prep_', 'tip_', 'grade', ''][i % 6] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s;
    assert.equal(s, fnIs(k), 'sql vs function ' + JSON.stringify(k.slice(0, 40)));
    assert.equal(ctx.appIs(k), fnIs(k), 'app vs function ' + JSON.stringify(k.slice(0, 40)));
    assert.equal(ctx.appTp(k), tpIsKey(k), 'app Tip/prep list vs function ' + JSON.stringify(k.slice(0, 40)));
  }
  assert.equal((await db.query('select public.ss_guard_key(null) s')).rows[0].s, false);
  await db.close();
});

test('the migration stops (changes nothing) with no app_state, or with RLS off and a stray policy; the precheck and postcheck see odd shapes, duplicates and missing confirmations', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await assert.rejects(db.exec(MIG), /STOP/);
  await db.close();
  const d2 = await mkdb('off');
  await d2.exec(`create policy old_one on public.app_state for select to anon using (key <> 'tasks_all')`);
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal((await d2.query(`select relrowsecurity r from pg_class where oid = 'public.app_state'::regclass`)).rows[0].r, false, 'nothing changed');
  assert.equal((await d2.query(`select to_regprocedure('public.ss_guard_key(text)') is null n`)).rows[0].n, true, 'nothing is made either (one transaction)');
  const r = async n => (await resRows(d2, PRE)).find(x => x.n === n);
  await d2.query(`update public.app_state set value = '{"a":1}' where key = $1`, [TIPK('Kai One')]);
  assert.match((await r(4)).value, /配列でない行 1/); assert.match((await r(4)).ok, /^NG/);
  await d2.query(`update public.app_state set value = $1 where key = $2`, [JSON.stringify([...TIP1, TIP1[0]]), TIPK('Kai One')]);
  assert.match((await r(4)).value, /同じ id のある行 1/); assert.match((await r(4)).ok, /^NG/);
  await d2.query(`update public.app_state set value = $1 where key = $2`, [JSON.stringify([...TIP1, { ...TIP1[1], id: 'x1', name: 'Ria Two' }, { ...TIP1[1], id: 'x2', status: '取消' }, { ...TIP1[1], id: 'x3', rate: 150 }, 'str']), TIPK('Kai One')]);
  assert.match((await r(4)).value, /形の合わない記録 4/); assert.match((await r(4)).ok, /^info/);
  await d2.query(`update public.app_state set value = $1 where key = $2`, [JSON.stringify(TIP1), TIPK('Kai One')]);
  await d2.exec(`delete from public.app_state where key = 'tip_requests'`);
  assert.equal((await r(5)).value, '行なし'); assert.equal((await r(5)).ok, 'OK');
  await d2.query(`update public.app_state set value = '[1,2]' where key = 'prep_certs'`);
  assert.match((await r(7)).value, /全体がオブジェクトでない（array）/); assert.match((await r(7)).ok, /^NG/);
  await d2.query(`update public.app_state set value = $1 where key = 'prep_certs'`, [JSON.stringify({ ...CERTS, odd: 5, ['k'.repeat(201)]: {} })]);
  assert.equal((await r(7)).value, '3 件・形の合わない記録 2'); assert.match((await r(7)).ok, /^info/);
  await d2.exec(`delete from public.app_state where key = 'prep_tables'`);
  assert.equal((await r(6)).value, '行なし'); assert.equal((await r(6)).ok, 'OK');
  await d2.exec(`delete from public.manager_auth where role in ('ceo','gm');`);
  assert.match((await r(11)).ok, /^STOP/);
  await d2.close();
  // 確かめた写し：全部確かめてあれば 0。使い始めていれば G4・Head Chef は数えない。Head Chef の印の SQL（1b）が無いとき・ワークセンターの SQL が無いとき
  const conf = [{ emp: 'E-AM', name: 'Amy Area', role: 'am', grade: 5 }, { emp: 'E-4', name: 'Leo Four', role: 'staff', grade: 4 },
    { emp: 'E-CH', name: 'Chef Ken', role: 'staff', grade: 4, chef: true }, { emp: 'E-CC', name: 'Corp Cora', role: 'staff', grade: 5, chef: true }];
  const d3 = await mkdb('on', { live: false, conf });
  assert.equal((await resRows(d3, PRE)).find(x => x.n === 8).value, '0'); assert.equal((await resRows(d3, PRE)).find(x => x.n === 8).ok, 'OK');
  await d3.close();
  const d4 = await mkdb('on', { live: true, conf: [{ emp: 'E-AM', name: 'Amy Area', role: 'am', grade: 5 }] });
  const p4 = await resRows(d4, PRE);
  assert.match(p4.find(x => x.n === 8).what, /AM 0・G4 0・Head Chef 0・Corporate Chef 1/, 'after the Work Center is in use, G4 and Head Chef do not decide anyway');
  assert.equal(p4.find(x => x.n === 9).value, 'ON');
  await d4.close();
  const d5 = await mkdb('on', { live: false, chef: false, conf: [{ emp: 'E-CH', name: 'Chef Ken', role: 'staff', grade: 4 }] });
  const p5 = (await resRows(d5, PRE)).find(x => x.n === 8);
  assert.match(p5.what, /Head Chef 1・Corporate Chef 1/); assert.match(p5.ok, /1b の SQL/);
  await d5.close();
  const d6 = new PGlite();
  await d6.exec(`create role anon; create role authenticated; create role service_role;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM');`);
  const p6 = await resRows(d6, PRE);
  assert.match(p6.find(x => x.n === 8).ok, /^NG/); assert.equal(p6.find(x => x.n === 9).value, '表なし');
  assert.equal(p6.find(x => x.n === 4).value, '0 行・0 件・決めたもの 0・配列でない行 0・同じ id のある行 0・形の合わない記録 0・200 字より長い名前の行 0');
  await d6.close();
  // 確認の SQL の 20・21 行目（形）
  const d7 = await mkdb('v1145');
  await d7.exec(MIG);
  const q = async n => (await resRows(d7, POST)).find(x => x.n === n);
  await d7.query(`update public.app_state set value = $1 where key = $2`, [JSON.stringify([...TIP2, TIP2[0]]), TIPK('Ria Two')]);
  assert.match((await q(20)).value, /同じ id のある行 1/); assert.match((await q(20)).ok, /^NG/);
  await d7.query(`update public.app_state set value = $1 where key = $2`, [JSON.stringify([...TIP2, { ...TIP2[0], id: 'z', rate: 'x' }]), TIPK('Ria Two')]);
  assert.match((await q(20)).value, /形の合わない記録 1$/); assert.match((await q(20)).ok, /^info/);
  await d7.query(`update public.app_state set value = '"x"' where key = 'prep_tables'`);
  assert.match((await q(21)).value, /prep_tables 全体がオブジェクトでない（string）/); assert.match((await q(21)).ok, /^NG/);
  await d7.query(`update public.app_state set value = $1 where key = 'prep_tables'`, [JSON.stringify({ ...TBL, z: 1 })]);
  assert.match((await q(21)).value, /prep_tables 2 件・形の合わない記録 1/); assert.match((await q(21)).ok, /^info/);
  // キーの判定が広すぎる・狭すぎるなら 3 行目が NG
  await d7.exec(`create or replace function public.ss_guard_key(k text) returns boolean language sql immutable as $f$ select coalesce(k in (${[...ELEVEN, ...TP_KEYS].map(k => `'${k}'`).join(', ')}, 'prep_cfg') or left(k, 17) = 'spl_tip_requests_', false) $f$`);
  assert.equal((await q(3)).ok, 'NG', 'prep_cfg (and the bare prefix) must stay writable');
  await d7.exec(`create or replace function public.ss_guard_key(k text) returns boolean language sql immutable as $f$ select coalesce(k in (${[...ELEVEN, ...TP_KEYS].map(k => `'${k}'`).join(', ')}), false) $f$`);
  assert.equal((await q(3)).ok, 'NG', 'the per-person Tip Rate rows must be guarded');
  await d7.close();
});
