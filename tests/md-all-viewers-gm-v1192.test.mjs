// v1192（Codex 6986713362 の P2-1）：「ダッシュボードで全店を見る AM」を、GM・CEO だけが書ける写し（app_state の md_all_viewers_gm）にする。
// 前は関数 secure-state の人件費の合計（labor）が app_settings の md_all_viewers で全店を返していた。md_all_viewers は公開の鍵で書けるので、
// AM が自分の行を書き足すと、担当外の店の人件費の合計まで受け取れた。合成データだけ（本番には接続しない）。確かめること：
//  1. 関数：写しを書けるのは GM・CEO だけ（AM が自分の行を足すのも 403）・形・読んだ行の確かめ（409）・答えに ltfn:1
//  2. SQL（PGlite の本物の PostgreSQL）：v1146 の SQL のあとに流すと、公開の鍵は写しを読めるが書けない・写しは空で作る（md_all_viewers は写さない・
//     json でも jsonb でも）・2 回流しても GM・CEO の決めた値を変えない・v1146 の SQL が無ければ止まる・最初の確かめと確認の SQL・戻す SQL
//     v1192（Codex 6989812896 の P2-1・P2-3）：SQL の前に公開の鍵で作られた写し・守りが外れたあとの写しは信じない（前の確かめも SQL も STOP・
//     1b で捨ててから）・md_all_viewers_gm_trusted は守りの形を見る・戻す SQL はそれを消す
//  3. SQL の決まり（ss_guard_key）と関数の決まり（swIsKey・tpIsKey）とアプリの決まり（index.html の gwIsKey）が同じ
//  4. アプリ：mdAllViewers は写しを先に見る・mdSetAllViewer は写しと md_all_viewers の両方に書く・GM・CEO だけ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler, swIsKey, tpIsKey, swShapeOk, SW_WRITE, LV_KEYS, GH_KEYS, SW2_KEYS, secretKey, gbIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG41 = rd('supabase/migrations/20261110090000_secure_settings_write.sql');
const MIG43 = rd('supabase/migrations/20261112090000_secure_settings_more.sql');
const MIG45 = rd('supabase/migrations/20261114090000_secure_grade_hist.sql');
const MIG46 = rd('supabase/migrations/20261115090000_secure_tip_prep.sql');
const MIG = rd('supabase/migrations/20261210090000_md_all_viewers_gm.sql');
const WRM = rd('supabase/migrations/20261104090000_work_requests.sql');
const CHEF = rd('supabase/migrations/20261113080000_wr_people_chef.sql');
const PRE = rd('db/md-all-viewers-gm-precheck.sql');
const POST = rd('db/md-all-viewers-gm-postcheck.sql');
const BACK = rd('db/md-all-viewers-gm-rollback.sql');
const DISCARD = rd('db/md-all-viewers-gm-discard.sql');
const KEY = 'md_all_viewers_gm';

// ---------- 1. 関数 ----------
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' } };
const USERS = { gm: U(1), ceo: U(5), of: U(2), oc: U(3) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area', confirmed: true },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const T0 = '2026-11-18T09:00:00.000000+00:00';
const LV0 = { 'E-AM2': { on: true, name: 'Other Am', by: 'Gina M', at: '2026/11/01 10:00', _at: 5 } };
const withAm = (on, at = 9) => ({ ...LV0, 'E-AM': { on, name: 'Amy Area', by: 'Gina M', at: '2026/11/18 10:00', _at: at } });

function setup() {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])) });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 18, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  W.set(KEY, LV0, T0);
  return { W, call, pin: who => ({ pin_session: 't' + who }), email: who => ({ authorization: 'Bearer ' + JWT(who) }) };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('the copy is a key of its own: GM and CEO write it; still readable (not secret, not the gb part); md_all_viewers itself is not a function key', () => {
  assert.deepEqual(LV_KEYS, [KEY]);
  assert.deepEqual(SW_WRITE[KEY], ['ceo', 'gm']);
  assert.ok(swIsKey(KEY) && !secretKey(KEY) && !gbIsKey(KEY) && !tpIsKey(KEY));
  assert.ok(!GH_KEYS.includes(KEY) && !SW2_KEYS.includes(KEY));
  for (const k of ['md_all_viewers', KEY + ' ', 'Md_all_viewers_gm', 'md_all_viewers_g', KEY + '_x', '', null]) assert.ok(!swIsKey(k), String(k));
});

test('the shape: a map of employee records (object or null), keys up to 200 characters; a wrapped value or a non-map is refused', () => {
  assert.ok(swShapeOk(KEY, LV0)); assert.ok(swShapeOk(KEY, {})); assert.ok(swShapeOk(KEY, { a: null })); assert.ok(swShapeOk(KEY, { ['k'.repeat(200)]: { on: true } }));
  for (const v of [null, [], 'x', 5, { a: true }, { a: 'on' }, { a: [] }, { ['k'.repeat(201)]: {} }, { __st: 1, v: LV0 }]) assert.ok(!swShapeOk(KEY, v), JSON.stringify(v).slice(0, 40));
});

test('GM and CEO write the copy (PIN or email); the answer has ltfn:1 and who wrote', async () => {
  const S = setup();
  let i = 0;
  for (const [how, who] of [['pin', 'gm'], ['pin', 'ceo'], ['email', 'gm'], ['email', 'ceo']]) {
    const v = withAm(i % 2 === 0, 10 + ++i);
    const r = await S.call({ action: 'put', key: KEY, value: v, ...(how === 'pin' ? S.pin(who) : {}) }, how === 'email' ? S.email(who) : {});
    assert.equal(r.status, 200, how + ' ' + who); assert.equal(r.j.ok, true); assert.equal(r.j.ltfn, 1); assert.equal(r.j.by, who);
    assert.deepEqual(S.W.get(KEY), v);
  }
  assert.deepEqual(writes(S.W, KEY), ['service', 'service', 'service', 'service']);
});

test('an AM cannot add her own row (the Codex P2-1 path); Accounting, office crew, G4 and crew are refused too; nothing is written', async () => {
  const S = setup();
  for (const who of ['am', 'of', 'oc', 'g4', 'g1']) {
    const r = await S.call({ action: 'put', key: KEY, value: withAm(true), ...S.pin(who) });
    assert.equal(r.status, 403, who); assert.equal(r.j.error, 'forbidden'); assert.equal(r.j.ltfn, 1);
  }
  for (const who of ['of', 'oc']) assert.equal((await S.call({ action: 'put', key: KEY, value: withAm(true) }, S.email(who))).status, 403, who + ' by email');
  assert.equal((await S.call({ action: 'put', key: KEY, value: withAm(true) })).status, 401, 'the public key alone');
  assert.equal((await S.call({ action: 'put', key: KEY, value: withAm(true), role: 'gm', ...S.pin('am') })).status, 403, 'the device says gm');
  assert.deepEqual(S.W.get(KEY), LV0);
  assert.deepEqual(writes(S.W, KEY), []);
});

test('the same value as the cloud passes for anyone (the copy is readable anyway) without writing; a bad shape is 400; a stale read is 409', async () => {
  const S = setup();
  const r = await S.call({ action: 'put', key: KEY, value: { 'E-AM2': { _at: 5, at: '2026/11/01 10:00', by: 'Gina M', name: 'Other Am', on: true } }, ...S.pin('am') });
  assert.equal(r.status, 200); assert.equal(r.j.same, true);
  for (const value of [null, [], { 'E-AM': true }, { __st: 1, v: LV0 }]) assert.equal((await S.call({ action: 'put', key: KEY, value, ...S.pin('ceo') })).status, 400, JSON.stringify(value));
  assert.equal((await S.call({ action: 'put', key: KEY, value: withAm(true), expect: { exists: true, updated_at: '2026-11-18T08:00:00+00:00' }, ...S.pin('gm') })).status, 409);
  assert.equal((await S.call({ action: 'put', key: KEY, value: withAm(true), expect: { exists: false }, ...S.pin('gm') })).status, 409);
  assert.deepEqual(S.W.get(KEY), LV0);
  const ok = await S.call({ action: 'put', key: KEY, value: withAm(true), expect: { exists: true, updated_at: T0 }, ...S.pin('gm') });
  assert.equal(ok.status, 200); assert.deepEqual(S.W.get(KEY), withAm(true));
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 1);
});

// ---------- 2. SQL ----------
async function mkdb(o = {}) {
  const db = new PGlite();
  const vt = o.json ? 'json' : 'jsonb';
  // Supabase と同じく、public に作る関数は anon・authenticated にも既定で実行の権限が付く（だから SQL は両方から明示的に外す）
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.app_state(key text primary key, value ${vt} not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.employees(id, name, role, status, data) values
      ('E-AM', 'Amy Area', 'am', '在籍', '{"role":"am","status":"在籍","name":"Amy Area"}'),
      ('E-AM2', 'Other Am', 'am', '在籍', '{"role":"am","status":"在籍","name":"Other Am"}'),
      ('E-1', 'Kai One', 'crew', '在籍', '{"role":"crew","status":"在籍","name":"Kai One"}'),
      ('E-OUT', 'Gone Am', 'am', '退職', '{"role":"am","status":"退職","name":"Gone Am"}');`);
  if (o.settings !== false) {
    await db.exec(`create table public.app_settings(key text primary key, value ${o.settingsJson ? 'json' : 'jsonb'}, updated_at timestamptz default now());
      grant select, insert, update, delete on public.app_settings to anon, authenticated, service_role;`);
    if (o.mdav !== undefined) await db.query(`insert into public.app_settings(key, value) values ('md_all_viewers', $1)`, [JSON.stringify(o.mdav)]);
  }
  await db.exec(WRM); await db.exec(CHEF);
  await db.query(`insert into public.app_state(key, value) values ('tasks_all', '{"v":1}'), ('grade_hist', '{}'), ('prep_certs', '{}')`);
  if (o.copy !== undefined) await db.query(`insert into public.app_state(key, value) values ($1, $2)`, [KEY, JSON.stringify(o.copy)]);
  if (o.v1146 !== false) { await db.exec(MIG41); await db.exec(MIG43); await db.exec(MIG45); await db.exec(MIG46); }
  return db;
}
const as = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const fails = async (db, role, sql, p) => { await db.exec(`set role ${role}`); try { await db.query(sql, p); return false; } catch { return true; } finally { await db.exec('reset role'); } };
const copyOf = async db => { const r = await db.query(`select value::text v from public.app_state where key = $1`, [KEY]); return r.rows[0] ? JSON.parse(r.rows[0].v) : undefined; };
const trustedOf = async db => { const f = (await db.query(`select to_regprocedure('public.md_all_viewers_gm_trusted()') f`)).rows[0].f; return f ? (await db.query('select public.md_all_viewers_gm_trusted() t')).rows[0].t : null; };
const postRows = async db => { const res = await db.exec(POST); return res.find(r => r.rows && r.rows.length && 'ok' in r.rows[0]).rows; };
const ONROW = { 'E-AM': { on: true, name: 'Amy Area', by: 'Gina M', at: '2026/11/01', _at: 3 }, 'E-1': { on: true, name: 'Kai One', _at: 4 }, 'E-OUT': { on: false, _at: 2 } };

test('the SQL stops (changes nothing) without the v1146 SQL; after it, the public keys read the copy but cannot add, overwrite, change, delete or rename it in', async () => {
  const d0 = await mkdb({ v1146: false, mdav: ONROW });
  assert.equal((await d0.query(PRE)).rows[0].ok, 'STOP（先に 20261115090000）', 'the precheck says STOP too');
  await assert.rejects(d0.exec(MIG), /STOP/);
  assert.equal(await copyOf(d0), undefined, 'nothing copied');
  await d0.close();
  // v1141 の SQL だけ（ss_guard_key はあるが v1146 の形でない）：前の確かめも SQL も止まる
  const d1 = await mkdb({ v1146: false, mdav: ONROW });
  await d1.exec(MIG41);
  assert.equal((await d1.query(PRE)).rows[0].ok, 'STOP（先に 20261115090000）');
  await assert.rejects(d1.exec(MIG), /STOP/);
  assert.equal(await copyOf(d1), undefined);
  assert.equal((await d1.query(`select public.ss_guard_key('prep_certs') a`)).rows[0].a, false, 'the v1141 rule is left as it was');
  await d1.close();
  const db = await mkdb({ mdav: ONROW });
  await db.exec(MIG);
  assert.deepEqual(await copyOf(db), {}, 'the copy starts empty: md_all_viewers (publicly writable) is not copied (Codex 6989812896 P2-1)');
  assert.equal(await trustedOf(db), true);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await as(db, role, `select key from public.app_state where key = $1`, [KEY])).rows.length, 1, role + ' reads the copy');
    assert.equal(await fails(db, role, `update public.app_state set value = '{"E-AM2":{"on":true}}' where key = $1`, [KEY]) || (await copyOf(db))['E-AM2'] === undefined, true, role + ' update');
    assert.deepEqual(await copyOf(db), {}, role + ' cannot change it');
    await as(db, role, `delete from public.app_state where key = $1`, [KEY]).catch(() => null);
    assert.deepEqual(await copyOf(db), {}, role + ' cannot delete it');
    assert.equal(await fails(db, role, `update public.app_state set key = $1 where key = 'tasks_all'`, [KEY]), true, role + ' cannot rename a row into it');
    assert.equal(await fails(db, role, `insert into public.app_state(key, value) values ($1, '{}') on conflict (key) do update set value = excluded.value`, [KEY]), true, role + ' upsert');
    // ほかの行（v1146 までのキーは書けないまま・ほかは今までどおり）
    assert.equal(await fails(db, role, `update public.app_state set value = '{"x":1}' where key = 'grade_hist'`) || (await db.query(`select value::text v from public.app_state where key = 'grade_hist'`)).rows[0].v === '{}', true);
    assert.equal(await fails(db, role, `update public.app_state set value = '{"v":2}' where key = 'tasks_all'`), false, role + ' still writes other rows');
    // md_all_viewers（app_settings）は今までどおり書ける（前の版の端末が読む・関数はもう見ない）
    assert.equal(await fails(db, role, `update public.app_settings set value = '{"E-1":{"on":true}}' where key = 'md_all_viewers'`), false);
  }
  await db.query(`update public.app_settings set value = $1 where key = 'md_all_viewers'`, [JSON.stringify(ONROW)]);
  // サーバーの鍵は書ける
  await as(db, 'service_role', `update public.app_state set value = '{"E-AM":{"on":false,"_at":9}}' where key = $1`, [KEY]);
  assert.deepEqual(await copyOf(db), { 'E-AM': { on: false, _at: 9 } });
  // 2 回流しても同じ（この SQL で守られていた写しはそのまま＝GM・CEO が関数で書いた値を戻さない・空にもしない）
  await db.exec(MIG); await db.exec(MIG);
  assert.deepEqual(await copyOf(db), { 'E-AM': { on: false, _at: 9 } }, 'running it again keeps the GM/CEO decision');
  assert.equal(await trustedOf(db), true);
  await assert.rejects(db.exec(DISCARD), /STOP/, 'the guarded copy is not thrown away');
  assert.deepEqual(await copyOf(db), { 'E-AM': { on: false, _at: 9 } });
  assert.equal(await fails(db, 'anon', `insert into public.app_state(key, value) values ('md_all_viewers_gm ', '{}')`), false, 'a look-alike key is an ordinary row');
  await db.close();
});

test('the copy is made empty from json or jsonb columns whatever md_all_viewers holds; RLS off with no stray rule is turned on', async () => {
  for (const o of [{ json: true, settingsJson: true, mdav: ONROW }, { json: false, settingsJson: true, mdav: ONROW }, { json: true, mdav: ONROW }, { mdav: [1, 2] }, { mdav: 'x' }, {}, { settings: false }]) {
    const db = await mkdb(o);
    await db.exec(MIG);
    assert.deepEqual(await copyOf(db), {}, JSON.stringify(o));
    assert.equal(await fails(db, 'anon', `update public.app_state set value = '{"E-AM":{"on":true}}' where key = $1`, [KEY]) || JSON.stringify(await copyOf(db)) === '{}', true);
    await db.close();
  }
  // RLS が OFF（効いていない決まりも無い）なら ON にして今までの決まり ss_open を足す（前の版の SQL と同じ）
  const off = await mkdb({ mdav: ONROW });
  await off.exec(`drop policy if exists ss_guard_ins on public.app_state; drop policy if exists ss_guard_upd on public.app_state; drop policy if exists ss_guard_del on public.app_state;
    drop policy if exists ss_open on public.app_state; drop policy if exists ss_secret on public.app_state; alter table public.app_state disable row level security;`);
  await off.exec(MIG);
  assert.equal(await trustedOf(off), true);
  assert.equal(await fails(off, 'anon', `update public.app_state set value = '{"v":2}' where key = 'tasks_all'`), false);
  assert.equal(await fails(off, 'anon', `insert into public.app_state(key, value) values ($1, '{}') on conflict (key) do update set value = excluded.value`, [KEY]), true);
  await off.close();
});

test('Codex 6989812896 P2-1: a copy made with the public key before the SQL is not trusted; the precheck and the SQL STOP (nothing changes); 1b throws it away; then the copy starts empty', async () => {
  for (const json of [false, true]) {
    const db = await mkdb({ json, mdav: ONROW });
    // SQL の前：公開の鍵で写しを作れる（Codex の手順。AM が自分を ON にした写し）
    assert.equal(await fails(db, 'anon', `insert into public.app_state(key, value) values ($1, '{"E-AM":{"on":true,"_at":99}}')`, [KEY]), false);
    const pre = (await db.query(PRE)).rows;
    assert.deepEqual([pre[1].ok, pre[1].value], ['STOP（1b で写しを捨ててから）', 'もうあるが、守られていない（公開の鍵で作られた・書かれたかもしれない）']);
    await assert.rejects(db.exec(MIG), /STOP: app_state に写し md_all_viewers_gm がもうありますが/);
    assert.deepEqual(await copyOf(db), { 'E-AM': { on: true, _at: 99 } }, 'nothing changed');
    assert.equal((await db.query(`select public.ss_guard_key($1) b`, [KEY])).rows[0].b, false, 'the guard is not added either');
    assert.equal(await trustedOf(db), null);
    // 1b：守られていない写しを捨てる（2 回流しても同じ）→ もう一度流すと空の写し・守られる
    await db.exec(DISCARD); await db.exec(DISCARD);
    assert.equal(await copyOf(db), undefined);
    assert.equal((await db.query(PRE)).rows[1].ok, 'OK');
    await db.exec(MIG);
    assert.deepEqual(await copyOf(db), {}, json ? 'json' : 'jsonb');
    assert.equal(await trustedOf(db), true);
    assert.equal(await fails(db, 'anon', `update public.app_state set value = '{"E-AM":{"on":true}}' where key = $1`, [KEY]) || JSON.stringify(await copyOf(db)) === '{}', true);
    await db.close();
  }
});

test('Codex 6989812896 P2-3: when the guard is lost again (an older SQL re-run) the copy is no longer trusted; running the SQL again STOPs until 1b, and a proper re-run keeps the GM value', async () => {
  const db = await mkdb({ mdav: ONROW });
  await db.exec(MIG);
  await as(db, 'service_role', `update public.app_state set value = $2 where key = $1`, [KEY, JSON.stringify({ 'E-AM2': { on: true, _at: 7 } })]);
  await db.exec(MIG46);
  assert.equal(await trustedOf(db), false, 'the v1146 SQL takes the key out of the guard');
  const rows = await postRows(db);
  assert.deepEqual([rows.find(r => r.n === 1).ok, rows.find(r => r.n === 4).ok, rows.find(r => r.n === 4).value], ['NG', 'NG', 'いいえ'], 'the postcheck shows it (手順.md 困ったとき)');
  assert.equal(await fails(db, 'anon', `update public.app_state set value = '{"E-AM":{"on":true}}' where key = $1`, [KEY]), false, 'so the public key can write the copy again');
  assert.equal((await db.query(PRE)).rows[1].ok, 'STOP（1b で写しを捨ててから）');
  await assert.rejects(db.exec(MIG), /STOP/);
  assert.deepEqual(await copyOf(db), { 'E-AM': { on: true } });
  assert.equal(await trustedOf(db), false, 'the stopped SQL left the trust check saying no');
  await db.exec(DISCARD);
  await db.exec(MIG);
  assert.deepEqual(await copyOf(db), {}); assert.equal(await trustedOf(db), true);
  await db.close();
});

test('the copy that appears while the SQL runs (after its first check) STOPs the SQL; so does a guard that does not hold at the end (everything rolls back)', async () => {
  const at = MIG.indexOf('create or replace function public.ss_guard_key');
  assert.ok(at > 0);
  const db = await mkdb({ mdav: ONROW });
  await db.exec(MIG.slice(0, at));
  await as(db, 'service_role', `insert into public.app_state(key, value) values ($1, '{"E-AM":{"on":true}}')`, [KEY]);
  await assert.rejects(db.exec(MIG.slice(at)), /STOP: この SQL を流しているあいだに写し/);
  assert.deepEqual(await copyOf(db), { 'E-AM': { on: true } });
  assert.equal((await db.query(`select public.ss_guard_key($1) b`, [KEY])).rows[0].b, false);
  await db.close();
  // 最後の確かめ：anon が RLS を飛ばせる DB では守れない → STOP・写しも決まりも残らない
  const d2 = await mkdb({ mdav: ONROW });
  await d2.exec('alter role anon bypassrls');
  await assert.rejects(d2.exec(MIG), /STOP/);
  assert.equal(await copyOf(d2), undefined, 'the empty copy is rolled back');
  assert.equal((await d2.query(`select public.ss_guard_key($1) b`, [KEY])).rows[0].b, false, 'the guard change is rolled back too');
  assert.equal(await trustedOf(d2), null);
  await d2.close();
});

test('md_all_viewers_gm_trusted says no when RLS is off, a guard rule is missing, permissive, narrowed or changed, or anon can skip RLS; the public keys cannot run it', async () => {
  const cases = [
    ['rls off', 'alter table public.app_state disable row level security'],
    ['no update rule', 'drop policy ss_guard_upd on public.app_state'],
    ['permissive insert rule', `drop policy ss_guard_ins on public.app_state; create policy ss_guard_ins on public.app_state as permissive for insert to anon, authenticated with check (not public.ss_guard_key(key))`],
    ['delete rule changed', `drop policy ss_guard_del on public.app_state; create policy ss_guard_del on public.app_state as restrictive for delete to anon, authenticated using (not public.ss_guard_key(key) or true)`],
    ['update rule only for anon', `drop policy ss_guard_upd on public.app_state; create policy ss_guard_upd on public.app_state as restrictive for update to anon using (not public.ss_guard_key(key)) with check (not public.ss_guard_key(key))`],
    ['update rule without check', `drop policy ss_guard_upd on public.app_state; create policy ss_guard_upd on public.app_state as restrictive for update to anon, authenticated using (not public.ss_guard_key(key))`],
    ['anon bypassrls', 'alter role anon bypassrls'],
    ['authenticated superuser', 'alter role authenticated superuser'],
    ['anon is the table owner role', `create role owner_r nologin; alter table public.app_state owner to owner_r; grant owner_r to anon`],
  ];
  for (const [name, sql] of cases) {
    const db = await mkdb({ mdav: ONROW });
    await db.exec(MIG);
    assert.equal(await trustedOf(db), true, name + ' (before)');
    await db.exec(sql);
    assert.equal(await trustedOf(db), false, name);
    if (name === 'anon is the table owner role') {
      await db.exec('alter table public.app_state force row level security');
      assert.equal(await trustedOf(db), true, 'forced RLS covers the owner role');
    }
    await db.close();
  }
  const db = await mkdb({ mdav: ONROW });
  await db.exec(MIG);
  for (const role of ['anon', 'authenticated']) assert.equal(await fails(db, role, 'select public.md_all_viewers_gm_trusted()'), true, role);
  assert.equal((await as(db, 'service_role', 'select public.md_all_viewers_gm_trusted() t')).rows[0].t, true);
  await db.close();
});

test('the precheck lists who is ON (and who is not an active AM); the postcheck is all OK after the SQL and NG before; the rollback opens the copy again, drops the trust check and keeps v1146', async () => {
  const db = await mkdb({ mdav: ONROW });
  const pre = (await db.query(PRE)).rows;
  assert.equal(pre[0].ok, 'OK');
  assert.match(pre[1].value, /まだ無い/);
  assert.equal(pre[3].value, '2', 'two people are ON');
  assert.equal(pre[4].ok, 'CHECK（下の表で確かめる）', 'Kai One is not an AM');
  const listed = pre.filter(r => r.n >= 7).map(r => r.what).sort();
  assert.deepEqual(listed, ['E-1', 'E-AM']);
  assert.ok(pre.find(r => r.what === 'E-1').value.includes('crew'));
  const b = await postRows(db);
  assert.ok(b.some(r => r.ok !== 'OK' && r.ok !== 'info'), 'before the SQL the postcheck finds the hole');
  assert.equal(b.find(r => r.n === 7).ok, 'NG');
  assert.deepEqual([b.find(r => r.n === 4).value, b.find(r => r.n === 4).ok], ['関数が無い', 'NG'], 'the trust row does not break before the SQL');
  await db.exec(MIG);
  const pre2 = (await db.query(PRE)).rows;
  assert.deepEqual([pre2[1].ok, pre2[1].value], ['OK', 'もうある・この SQL で守られている（ON 0 人・そのまま）'], 'running the precheck again after the SQL');
  const a = await postRows(db);
  assert.equal(a.length, 11);
  for (const r of a) assert.ok(r.ok === 'OK' || r.ok === 'info', JSON.stringify(r));
  assert.equal(a.find(r => r.n === 4).value, 'はい');
  assert.equal(a.find(r => r.n === 5).value, '0', 'the copy starts empty');
  assert.equal(a.find(r => r.n === 6).value, '違う', 'md_all_viewers still has two people ON until the GM/CEO turn them on again');
  assert.deepEqual(await copyOf(db), {}, 'the postcheck rolls back');
  // GM・CEO が関数で付け直した（サーバーの鍵）
  await as(db, 'service_role', `update public.app_state set value = $2 where key = $1`, [KEY, JSON.stringify({ 'E-AM': ONROW['E-AM'] })]);
  assert.equal((await postRows(db)).find(r => r.n === 5).value, '1');
  await db.query(`update public.app_settings set value = $1 where key = 'md_all_viewers'`, [JSON.stringify({ 'E-AM': { on: true } })]);
  assert.equal((await postRows(db)).find(r => r.n === 6).value, '同じ');
  // 戻す：写しはまた公開の鍵で書ける・守りの関数も消える（v1192 の関数は写しを使わなくなる）・v1146 までのキーは書けないまま・写しの行は残る。2 回流しても同じ
  await db.exec(BACK); await db.exec(BACK);
  assert.equal(await trustedOf(db), null, 'md_all_viewers_gm_trusted is gone (the v1192 function gets 404 and stops using the copy)');
  assert.equal(await fails(db, 'anon', `update public.app_state set value = '{"E-1":{"on":true}}' where key = $1`, [KEY]), false);
  assert.deepEqual(await copyOf(db), { 'E-1': { on: true } });
  assert.equal((await db.query(`select public.ss_guard_key('prep_certs') a, public.ss_guard_key($1) b`, [KEY])).rows[0].a, true);
  assert.equal((await db.query(`select public.ss_guard_key($1) b`, [KEY])).rows[0].b, false);
  const back = await postRows(db);
  assert.deepEqual([back.find(r => r.n === 4).value, back.find(r => r.n === 4).ok], ['関数が無い', 'NG']);
  // 戻したあとにもう一度入れる：写しは守られていない（anon が書いた）ので STOP → 1b で捨てる → 入れ直すと空
  assert.equal((await db.query(PRE)).rows[1].ok, 'STOP（1b で写しを捨ててから）');
  await assert.rejects(db.exec(MIG), /STOP/);
  assert.deepEqual(await copyOf(db), { 'E-1': { on: true } }, 'nothing changed by the stopped SQL');
  await db.exec(DISCARD); await db.exec(DISCARD);
  assert.equal(await copyOf(db), undefined);
  await db.exec(MIG);
  assert.deepEqual(await copyOf(db), {}); assert.equal(await trustedOf(db), true);
  await db.close();
  // v1146 の SQL が無ければ、戻す SQL は何もしない
  const d2 = await mkdb({ v1146: false });
  await d2.exec(BACK);
  assert.equal((await d2.query(`select to_regprocedure('public.ss_guard_key(text)') f`)).rows[0].f, null);
  await d2.close();
});

// ---------- 3. 決まりが同じ ----------
test('the SQL rule, the function rule and the app rule agree on every key (the v1192 copy included)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());`);
  await db.exec(MIG41); await db.exec(MIG43); await db.exec(MIG45); await db.exec(MIG46); await db.exec(MIG);
  const html = rd('index.html');
  const pick = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([pick(/var SW_KEYS = \{[^}]*\};/), pick(/var SW2_KEYS = \{[^}]*\};/), pick(/function sw2IsKey\(k\)\{[^\n]*\}/), pick(/var GH_KEYS = \{[^}]*\};/), pick(/function ghIsKey\(k\)\{[^\n]*\}/),
    pick(/var LV_KEYS = \{[^}]*\};/), pick(/function lvIsKey\(k\)\{[^\n]*\}/),
    pick(/function swIsKey\(k\)\{[^\n]*\}/), pick(/var TP_KEYS = \{[^}]*\};/), pick(/var TP_TIP_PRE = '[^']*';/), pick(/function tpIsKey\(k\)\{[^\n]*\}/), pick(/function gwIsKey\(k\)\{[^\n]*\}/),
    'this.appIs = gwIsKey; this.appLv = lvIsKey;'].join('\n'), ctx);
  const fnIs = k => swIsKey(k) || tpIsKey(k);
  const keys = [KEY, 'md_all_viewers', KEY + ' ', ' ' + KEY, 'Md_all_viewers_gm', 'md_all_viewers_g', KEY + '\n', KEY + '_x', 'md_all', 'grade_hist', 'prep_certs', 'tasks_all',
    'spl_tip_requests_Kai', 'toString', '__proto__', 'constructor', ''];
  for (let i = 0; i < 300; i++) keys.push(['md_', 'md_all_', 'md_all_viewers', 'viewers', 'gm', ''][i % 6] + Math.random().toString(36).slice(2, 2 + (i % 9)));
  for (const k of keys) {
    const s = (await db.query('select public.ss_guard_key($1) s', [k])).rows[0].s;
    assert.equal(s, fnIs(k), 'sql vs function ' + JSON.stringify(k));
    assert.equal(ctx.appIs(k), fnIs(k), 'app vs function ' + JSON.stringify(k));
    assert.equal(ctx.appLv(k), LV_KEYS.includes(k), 'app copy list vs function ' + JSON.stringify(k));
  }
  assert.equal((await db.query('select public.ss_guard_key(null) s')).rows[0].s, false);
  await db.close();
});

// ---------- 4. アプリ ----------
function appCtx(o = {}) {
  const html = rd('index.html');
  const fn = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
  const store = { ...(o.store || {}) };
  const ctx = {
    curRole: o.role || 'gm', curUserName: 'Gina M', toasts: [], writes: [], failGm: !!o.failGm,
    ls: (k, d) => (Object.prototype.hasOwnProperty.call(store, k) ? JSON.parse(JSON.stringify(store[k])) : d),
    lsSet: (k, v) => { ctx.writes.push(k); if (k === KEY && ctx.failGm) return false; store[k] = JSON.parse(JSON.stringify(v)); return true; },
    showToast: (m, t) => ctx.toasts.push([m, t]), _actorName: () => 'Gina M', nowJP: () => '2026/11/18 10:00', Date, Math, Number, String, Object, Array, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(fn('mdAllViewers') + '\n' + fn('mdSetAllViewer'), ctx);
  return { ctx, store };
}

test('the app reads the GM/CEO copy first; it falls back to md_all_viewers only while there is no copy (before the SQL)', () => {
  let A = appCtx({ store: { md_all_viewers: { 'E-AM': { on: true } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(A.ctx.mdAllViewers())), { 'E-AM': { on: true } }, 'no copy yet: as before');
  A = appCtx({ store: { md_all_viewers: { 'E-AM': { on: true } }, [KEY]: {} } });
  assert.deepEqual(JSON.parse(JSON.stringify(A.ctx.mdAllViewers())), {}, 'an AM row added only to md_all_viewers does not count once the copy exists');
  A = appCtx({ store: { md_all_viewers: {}, [KEY]: { 'E-AM2': { on: true } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(A.ctx.mdAllViewers())), { 'E-AM2': { on: true } });
  for (const bad of [[1], 'x', 5]) {
    A = appCtx({ store: { md_all_viewers: { 'E-AM': { on: true } }, [KEY]: bad } });
    assert.deepEqual(JSON.parse(JSON.stringify(A.ctx.mdAllViewers())), { 'E-AM': { on: true } }, 'a copy that is not a map is ignored: ' + JSON.stringify(bad));
  }
});

test('GM and CEO turn a person on or off in both the copy and md_all_viewers (same record, newer _at); others cannot; a failed copy write stops before md_all_viewers', () => {
  for (const role of ['gm', 'ceo']) {
    const A = appCtx({ role, store: { md_all_viewers: { 'E-AM': { on: false, _at: 50 } }, [KEY]: { 'E-AM': { on: false, _at: 40 }, 'E-AM2': { on: true, _at: 7 } } } });
    assert.equal(A.ctx.mdSetAllViewer('E-AM', 'Amy Area', true), true);
    assert.deepEqual(A.ctx.writes, [KEY, 'md_all_viewers'], 'the copy first');
    const g = A.store[KEY]['E-AM'], s = A.store.md_all_viewers['E-AM'];
    assert.equal(g.on, true); assert.deepEqual(g, s);
    assert.ok(g._at > 50, 'newer than both earlier records');
    assert.deepEqual(A.store[KEY]['E-AM2'], { on: true, _at: 7 }, 'other people kept');
  }
  const N = appCtx({ store: { md_all_viewers: { 'E-AM': { on: true, _at: 3 } } } });
  assert.equal(N.ctx.mdSetAllViewer('E-AM', 'Amy Area', false), true);
  assert.equal(N.store[KEY]['E-AM'].on, false, 'the first copy is created from the app');
  for (const role of ['am', 'office', 'office_crew', 'sl']) {
    const A = appCtx({ role, store: { [KEY]: {} } });
    assert.equal(A.ctx.mdSetAllViewer('E-AM', 'Amy Area', true), false, role);
    assert.deepEqual(A.ctx.writes, []);
  }
  for (const bad of ['', null, '_x']) { const A = appCtx(); assert.equal(A.ctx.mdSetAllViewer(bad, 'x', true), false); assert.deepEqual(A.ctx.writes, []); }
  const F = appCtx({ failGm: true, store: { [KEY]: {} } });
  assert.equal(F.ctx.mdSetAllViewer('E-AM', 'Amy Area', true), false);
  assert.deepEqual(F.ctx.writes, [KEY], 'md_all_viewers is not written when the copy cannot be saved');
  assert.ok(F.ctx.toasts.some(t => t[1] === 'danger'));
});
