// 中間レビュー v1122（10/30 の依頼 ⑥）: the review on live data only, without its own email sign-in.
// The real SQL (all mid-review migrations, then 20261102090000) on PGlite and the real handler. The PIN sign-in's mark
// is checked by a stand-in verifier (the real one is in the private 1-file function). Synthetic people and stores only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, normBody } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql', '20261016090000_mid_review_v2_versions.sql',
  '20261017090000_mid_review_stores_save_fix.sql', '20261018090000_mid_review_scope_gm.sql'];
const mig = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const LIVE = fs.readFileSync(process.env.MR_LIVE_SQL || new URL('../supabase/migrations/20261102090000_mid_review_live.sql', import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  am9: '00000000-0000-4000-8000-0000000000c9' };
const EMPLOYEES = [['E1', 'CEO Test', 'ceo', 'CEO'], ['E2', 'GM Test', 'gm', 'General Manager'], ['E3', 'Office Test', 'office', 'Accounting'],
  ['E5', 'Yuki', 'am', 'Area Manager'], ['E6', 'AM Two', 'am', 'Area Manager'], ['E9', 'Stopped AM', 'am', 'Area Manager'], ['E8', 'Gone AM', 'am', 'Area Manager', '退職'],
  ['E11', 'Corp Chef', 'chef', 'Corporate Chef'], ['E12', 'Server Lead', 'g3', 'Server Leader'], ['E13', 'Store Mgr', 'g4', 'Store Manager'], ['E14', 'New AM', 'g4', 'Store Manager'],
  ['E17', 'Crew Kid', 'crew', 'Server']];

// before(pg) runs on the database as it was before v1122 (rows made by SQL or the earlier settings screen).
async function setup({ before, apply = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, emp_code text, role text, perms jsonb, title text, store text, support jsonb, status text, emp_type text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into public.stores(id, name, am, active) values ('F01','ToriTon','Yuki',true),('F02','Tenkichi','Yuki',true),('F05','Marujuu','AM Two',true);`);
  for (const [id, name, role, title, status = '在籍'] of EMPLOYEES)
    await pg.query('insert into employees(id, name, role, title, status) values($1,$2,$3,$4,$5)', [id, name, role, title, status]);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  for (const f of MIG) await pg.exec(mig(f));
  // A stopped AM (by SQL) stays stopped.
  await pg.query(`insert into mr_members(user_id, emp_id, name, role, enabled) values($1,'E9','Stopped AM','am',false)`, [U.am9]);
  if (before) await before(pg);
  if (apply) await pg.exec(LIVE);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const fetch = async () => { throw new Error('no email sign-in in v1122'); };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  // The real verifier returns the person's name (the mark has no employee id); 'pin-name:<name>' stands in for that path.
  const verifyPin = async tok => { const m = /^pin-(E\d+)$/.exec(tok), n = /^pin-name:(.+)$/.exec(tok); return m ? { emp_id: m[1] } : n ? { name: n[1] } : null; };
  const h = createHandler({ env, fetch, db, verifyPin });
  // 'E2' → pin-E2 (the mark by employee id); 'name:GM Test' → pin-name:GM Test (the mark by name)
  const call = async (emp, body) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer anon-key' }, body: JSON.stringify({ ...body, pin_session: 'pin-' + emp }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (emp, body) => { const r = await call(emp, body); assert.equal(r.status, 200, emp + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const q = async (sql, p = []) => { await pg.exec('reset role'); try { return (await pg.query(sql, p)).rows; } finally { await pg.exec('set role service_role'); } };
  const x = async sql => { await pg.exec('reset role'); try { return await pg.exec(sql); } finally { await pg.exec('set role service_role'); } };
  return { pg, h, call, ok, q, x };
}
const YM = '2026-10';
const snap = () => ({ v: 2, period: { from: YM + '-01', to: YM + '-17' }, prev: { ym: '2026-09', state: 'final', rows: {} }, cur: { rows: {}, fc_ref: null }, focus: { y: 2026, q: 4, keys: [], rows: {} } });

test('the migration: needs the earlier ones, runs twice the same, turns the review and input on, makes the in-service AMs, keeps stopped and resigned people out', async () => {
  const bare = new PGlite();
  await assert.rejects(bare.exec(LIVE), /先に 20261016090000/);
  const S = await setup();
  await S.pg.exec('reset role'); await S.pg.exec(LIVE); await S.pg.exec('set role service_role');   // twice is the same
  const flags = (await S.q(`select value from mr_settings where key = 'flags'`))[0].value;
  assert.deepEqual([flags.private, flags.live_input, flags.store_publish, flags.notify], [true, true, false, false]);
  const m = await S.q(`select emp_id, role, enabled from mr_members order by emp_id, enabled`);
  assert.deepEqual(m.filter(x => x.role === 'am').map(x => [x.emp_id, x.enabled]), [['E5', true], ['E6', true], ['E9', false]], 'Yuki and AM Two once each; the stopped AM stays off; the resigned AM is not made');
  // nothing here can be run by the browser roles
  for (const f of ['mr_pin_actor(jsonb)', 'mr_need_email(jsonb)', 'mr_whoami(jsonb)', 'mr_list(jsonb)', 'mr_demo_reset(jsonb)'])
    assert.deepEqual((await S.q(`select has_function_privilege('anon', 'public.${f}', 'execute') a, has_function_privilege('authenticated', 'public.${f}', 'execute') b`))[0], { a: false, b: false }, f);
});

test('the check after installing (db/mid-review-postcheck.sql): the v1122 row is NG before and OK after; every row OK or 参考; points at a CEO / GM account without an employee id', async () => {
  const post = fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8');
  const row = async (S, n) => (await S.q(post)).find(r => r.check_name === n);
  const pre = await setup({ apply: false });
  assert.match((await row(pre, 'mid-review live (20261102090000)')).result, /^NG/);
  const S = await setup();
  const rows = await S.q(post);
  assert.equal(rows.length, 31);
  for (const r of rows) assert.match(r.result, /^(OK|参考)/, r.check_name + ': ' + r.result);
  assert.match((await row(S, 'live input')).result, /^OK（本番の店の入力は ON）/);
  await S.q(`insert into manager_auth(user_id, role, emp_id) values('00000000-0000-4000-8000-0000000000d7','gm',null)`);
  const w = await row(S, 'ceo / gm accounts without an employee id');
  assert.deepEqual([w.value, /^注意/.test(w.result)], ['1', true]);
  // Running the earlier mid-review SQL again puts back the email step; the row says to run v1122 again (and that brings it back).
  await S.pg.exec('reset role');
  for (const f of MIG.slice(2)) await S.pg.exec(mig(f));
  await S.pg.exec('set role service_role');
  assert.match((await row(S, 'mid-review live (20261102090000)')).result, /^NG/);
  await S.pg.exec('reset role'); await S.pg.exec(LIVE); await S.pg.exec('set role service_role');
  assert.match((await row(S, 'mid-review live (20261102090000)')).result, /^OK/);
  assert.equal((await S.call('E2', { action: 'whoami' })).body.role, 'gm');
});

test('no email step: a GM signs in with the PIN only — a row from manager_auth, the settings, the stores and the access settings all work', async () => {
  const S = await setup();
  const w = await S.ok('E2', { action: 'whoami' });
  assert.equal(w.role, 'gm'); assert.equal(w.via, 'pin');
  assert.equal((await S.q(`select user_id::text u, role from mr_members where emp_id = 'E2' and enabled`))[0].u, U.gm, 'the manager_auth account');
  assert.equal(w.demo, undefined, 'no demo in whoami');
  // switches
  const fl = await S.ok('E2', { action: 'settings_save', key: 'flags', value: { private: true, live_input: true }, expect_version: w.flags_version });
  assert.ok(fl);
  // stores (管轄) and the access settings
  const am = (await S.q(`select user_id::text u from mr_members where emp_id = 'E5' and enabled`))[0].u, am2 = (await S.q(`select user_id::text u from mr_members where emp_id = 'E6' and enabled`))[0].u;
  let A = await S.ok('E2', { action: 'access_get', ym: YM });
  const v0 = Object.fromEntries((A.stores || []).map(x => [x.store_id, x.am_version]));
  await S.ok('E2', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: am, sort: 1, expect_version: v0.F01 ?? 0 }, { store_id: 'F02', name: 'Tenkichi', am_user: am, sort: 2, expect_version: v0.F02 ?? 0 },
    { store_id: 'F05', name: 'Marujuu', am_user: am2, sort: 3, expect_version: v0.F05 ?? 0 }] });
  A = await S.ok('E2', { action: 'access_get', ym: YM });
  const v = Object.fromEntries(A.stores.map(x => [x.store_id, x.version]));
  const r = await S.ok('E2', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: [], expect_version: v.F01 }] });
  assert.equal(r.saved, 1);
  // what the server says the GM may do, signed in with the PIN: the settings too (no email needed for them any more)
  assert.equal((await S.ok('E2', { action: 'whoami' })).perms.settings, true);
  const row = (await S.ok('E2', { action: 'list', env: 'live', ym: YM })).stores.find(x => x.store_id === 'F01');
  assert.equal(row.perms.settings, true); assert.ok(!(row.perms.why || []).some(x => /email|demo/.test(x)), JSON.stringify(row.perms.why));
  assert.ok((await S.ok('E2', { action: 'members_list' })).some(x => x.emp_id === 'E5' && x.role_now === 'am'), 'an AM can be chosen for 店舗の管轄');
  await S.ok('E2', { action: 'chef_save', emp_id: 'E11', on: true });
  // the CEO too
  assert.equal((await S.ok('E1', { action: 'whoami' })).role, 'ceo');
  // the office has manager_auth but is not CEO / GM: no row, refused
  assert.equal((await S.call('E3', { action: 'whoami' })).status, 403);
});

test('the demo is gone: list, a store of the demo and the demo reset answer 410; demo rows stay in the tables', async () => {
  const S = await setup({ before: async pg => {
    await pg.query(`insert into mr_stores(env, store_id, name, sort) values ('demo','D1','Demo One',1)`);
    await pg.query(`insert into mr_reviews(env, store_id, ym, status) values ('demo','D1','2026-10','draft')`);
  } });
  for (const body of [{ action: 'list', env: 'demo', ym: YM }, { action: 'get', env: 'demo', ym: YM, store_id: 'D1' }, { action: 'save', env: 'demo', ym: YM, store_id: 'D1', expect_version: 1, body: normBody({ v: 2 }) }, { action: 'demo_reset' }]) {
    const r = await S.call('E2', body);
    assert.equal(r.status, 410, JSON.stringify(body) + ' ' + JSON.stringify(r.body));
  }
  assert.equal((await S.q(`select count(*)::int n from mr_reviews where env = 'demo'`))[0].n, 1, 'kept, unread');
  assert.equal((await S.ok('E2', { action: 'list', env: 'live', ym: YM })).stores.length, 0);
});

test('input → save → read again → submit → the AM confirms, all with the PIN; another device reads the same; out of scope is refused', async () => {
  const S = await setup();
  const am = (await S.q(`select user_id::text u from mr_members where emp_id = 'E5' and enabled`))[0].u, am2 = (await S.q(`select user_id::text u from mr_members where emp_id = 'E6' and enabled`))[0].u;
  await S.ok('E2', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: am, sort: 1, expect_version: 0 }, { store_id: 'F05', name: 'Marujuu', am_user: am2, sort: 2, expect_version: 0 }] });
  const A = await S.ok('E2', { action: 'access_get', ym: YM });
  const v = Object.fromEntries(A.stores.map(x => [x.store_id, x.version]));
  await S.ok('E2', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: [], expect_version: v.F01 }, { store_id: 'F05', input_emp: 'E13', viewer_emps: [], expect_version: v.F05 }] });
  // the input person: only their store
  const L = await S.ok('E12', { action: 'list', env: 'live', ym: YM });
  assert.deepEqual(L.stores.map(s => s.store_id), ['F01']);
  let g = await S.ok('E12', { action: 'get', env: 'live', ym: YM, store_id: 'F01' });
  assert.equal(g.perms.input, true);
  const body = normBody({ v: 2, prev: { sales: { eval: 3, comment: 'ok' } }, consult: 'none' });
  const s1 = await S.ok('E12', { action: 'save', env: 'live', ym: YM, store_id: 'F01', expect_version: g.review ? g.review.version : 0, body });
  // someone else's newer save is not overwritten: the old version is refused
  const stale = await S.call('E12', { action: 'save', env: 'live', ym: YM, store_id: 'F01', expect_version: g.review ? g.review.version : 0, body: normBody({ v: 2, consult: 'none' }) });
  assert.equal(stale.status, 409);
  // read again (another device, the same person): the saved text, who and when
  g = await S.ok('E12', { action: 'get', env: 'live', ym: YM, store_id: 'F01' });
  assert.equal(g.review.body.prev.sales.comment, 'ok');
  assert.ok(g.review.updated_by && g.review.updated_at && g.review.version === s1.version);
  // the GM sees the store, but a draft only once it is submitted (as before)
  assert.equal((await S.ok('E2', { action: 'get', env: 'live', ym: YM, store_id: 'F01' })).review.body, null);
  // out of scope: the other store's input person and the other AM cannot read F01; a crew member is not a member at all
  assert.equal((await S.call('E13', { action: 'get', env: 'live', ym: YM, store_id: 'F01' })).status, 404);
  assert.equal((await S.call('E6', { action: 'get', env: 'live', ym: YM, store_id: 'F01' })).status, 404);
  assert.equal((await S.call('E17', { action: 'whoami' })).status, 403);
  assert.equal((await S.call('E9', { action: 'whoami' })).status, 403, 'stopped by SQL');
  assert.equal((await S.call('E13', { action: 'save', env: 'live', ym: YM, store_id: 'F01', expect_version: g.review.version, body })).status, 404);
  // AM Yuki sees F01 (her store) but not F05
  assert.deepEqual((await S.ok('E5', { action: 'list', env: 'live', ym: YM })).stores.map(s => s.store_id), ['F01']);
  // submit (the server checks what is missing), then the AM in charge confirms and only the GM / CEO can take it back
  const sub = await S.ok('E12', { action: 'submit', env: 'live', ym: YM, store_id: 'F01', expect_version: g.review.version, snapshot: snap() });
  assert.equal(sub.no || sub.submitted_no, 1, JSON.stringify(sub));
  const seen = await S.ok('E2', { action: 'get', env: 'live', ym: YM, store_id: 'F01' });
  assert.equal(seen.review.body.prev.sales.comment, 'ok'); assert.equal(seen.submissions[0].by, 'Server Lead');
  assert.equal((await S.call('E6', { action: 'confirm', env: 'live', ym: YM, store_id: 'F01', expect_no: 1 })).status, 404, 'not her store');
  await S.ok('E5', { action: 'confirm', env: 'live', ym: YM, store_id: 'F01', expect_no: 1 });
  assert.equal((await S.ok('E12', { action: 'get', env: 'live', ym: YM, store_id: 'F01' })).review.status, 'confirmed');
  assert.equal((await S.call('E5', { action: 'unconfirm', env: 'live', ym: YM, store_id: 'F01' })).status, 403);
  await S.ok('E2', { action: 'unconfirm', env: 'live', ym: YM, store_id: 'F01' });
});

test('rows from before: a CEO row made by SQL without the employee is linked to the PIN person; a staff row of someone now an AM becomes am; a staff row of a GM gives way to the GM row', async () => {
  const S = await setup({ before: async pg => {
    await pg.query(`update mr_members set emp_id = null where user_id = $1`, [U.ceo]);   // added by SQL before the employee link
    await pg.query(`delete from mr_members where user_id = $1`, [U.gm]);                  // the GM had no row; the settings made a staff row
    await pg.query(`insert into mr_members(emp_id, name, role) values('E14', 'New AM', 'staff'), ('E2', 'GM Test', 'staff')`);
  } });
  // E14 became an AM after the screen made the staff row
  await S.q(`update employees set role = 'am' where id = 'E14'`);
  assert.equal((await S.ok('E14', { action: 'whoami' })).role, 'am');
  assert.equal((await S.q(`select role from mr_members where emp_id = 'E14' and enabled`))[0].role, 'am');
  const w = await S.ok('E1', { action: 'whoami' });
  assert.equal(w.role, 'ceo');
  assert.equal((await S.q(`select emp_id from mr_members where user_id = $1`, [U.ceo]))[0].emp_id, 'E1', 'linked');
  assert.equal((await S.ok('E2', { action: 'whoami' })).role, 'gm');
  assert.deepEqual((await S.q(`select role, enabled from mr_members where emp_id = 'E2' order by enabled`)).map(x => [x.role, x.enabled]), [['staff', false], ['gm', true]]);
  // events say what was made
  assert.ok((await S.q(`select count(*)::int n from mr_events where kind in ('member_auto','member_linked')`))[0].n >= 3);
  // At install, before anyone signs in: a staff row (made by the settings) of someone who is an AM now is already am, so a GM can choose
  // them in 店舗の管轄 at once; no second row is made for them.
  const T = await setup({ before: async pg => {
    await pg.query(`update employees set role = 'am' where id = 'E14'`);
    await pg.query(`insert into mr_members(emp_id, name, role) values('E14', 'New AM', 'staff')`);
  } });
  assert.deepEqual((await T.q(`select role, enabled from mr_members where emp_id = 'E14'`)).map(x => [x.role, x.enabled]), [['am', true]]);
});

test('a CEO / GM row turned off by SQL is not made again; an AM who is no longer an AM in the employee master is refused', async () => {
  const S = await setup({ before: async pg => {
    await pg.query(`update mr_members set enabled = false where user_id = $1`, [U.gm]);   // stopped by SQL
  } });
  assert.equal((await S.call('E2', { action: 'whoami' })).status, 403);
  await S.q(`update employees set role = 'g4' where id = 'E6'`);
  assert.equal((await S.call('E6', { action: 'whoami' })).status, 403, 'the row is there but the role is gone');
  // A CEO whose employee record is resigned (the manager_auth account still says ceo) gets no row from a PIN sign-in.
  const R = await setup({ before: async pg => { await pg.query(`delete from mr_members where user_id = $1`, [U.ceo]); await pg.query(`update employees set status = '退職' where id = 'E1'`); } });
  assert.equal((await R.call('E1', { action: 'whoami' })).status, 403);
  assert.equal((await R.q(`select count(*)::int n from mr_members where emp_id = 'E1' or user_id = $1`, [U.ceo]))[0].n, 0, 'no row is made');
  // Someone in service who is neither CEO / GM nor an AM (nor chosen in the settings) gets no row either.
  assert.equal((await R.call('E17', { action: 'whoami' })).status, 403);
  assert.equal((await R.q(`select count(*)::int n from mr_members where emp_id = 'E17'`))[0].n, 0);
  // The CEO account's own row is stopped by SQL without an employee: the PIN sign-in neither links nor takes it over.
  const T = await setup({ before: async pg => { await pg.exec(`update mr_members set enabled = false, emp_id = null where user_id = '${U.ceo}'`); } });
  const was = (await T.q(`select user_id, emp_id, enabled, role from mr_members where user_id = $1`, [U.ceo]))[0];
  assert.equal((await T.call('E1', { action: 'whoami' })).status, 403);
  assert.deepEqual((await T.q(`select user_id, emp_id, enabled, role from mr_members where user_id = $1`, [U.ceo]))[0], was);
  // The CEO account's row is on another employee (manager_auth names E1): that employee is not CEO through it, and E1's PIN moves it.
  const W = await setup({ before: async pg => { await pg.exec(`update mr_members set emp_id = 'E11' where user_id = '${U.ceo}'`); } });
  assert.equal((await W.call('E11', { action: 'whoami' })).status, 403, 'the account does not name E11');
  assert.equal((await W.ok('E1', { action: 'whoami' })).role, 'ceo');
  assert.equal((await W.q(`select emp_id from mr_members where user_id = $1`, [U.ceo]))[0].emp_id, 'E1');
});

test('the review follows manager_auth: a wrong link stops working once corrected, the right person gets the row; a resigned GM is out at once', async () => {
  const post = fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8');
  const row = async (S, n) => (await S.q(post)).find(r => r.check_name === n);
  // The GM account was linked to a crew member (E17) — by the 10/12 seed, which copied manager_auth's employee id.
  const S = await setup({ before: async pg => {
    await pg.query(`update manager_auth set emp_id = 'E17' where user_id = $1`, [U.gm]);
    await pg.query(`update mr_members set emp_id = 'E17' where user_id = $1`, [U.gm]);
  } });
  assert.match((await row(S, 'ceo / gm accounts linked to someone resigned or not ceo / gm')).result, /^注意/);
  assert.equal((await S.ok('E17', { action: 'whoami' })).role, 'gm', 'what manager_auth says, while it says it');
  // Moto puts manager_auth right: E17 is out at once (even with a mark that has not expired), the real GM gets the row.
  await S.q(`update manager_auth set emp_id = 'E2' where user_id = $1`, [U.gm]);
  assert.equal((await S.call('E17', { action: 'whoami' })).status, 403);
  assert.equal((await S.call('E17', { action: 'settings_save', key: 'flags', value: { private: false }, expect_version: 1 })).status, 403);
  assert.match((await row(S, 'ceo / gm rows whose account names another employee')).result, /^注意/);
  assert.match((await row(S, 'ceo / gm accounts linked to someone resigned or not ceo / gm')).result, /^OK/);
  const w = await S.ok('E2', { action: 'whoami' });
  assert.equal(w.role, 'gm'); assert.equal(w.perms.settings, true);
  assert.deepEqual((await S.q(`select emp_id, name, enabled from mr_members where user_id = $1`, [U.gm]))[0], { emp_id: 'E2', name: 'GM Test', enabled: true });
  assert.match((await row(S, 'ceo / gm rows whose account names another employee')).result, /^OK/);
  assert.ok((await S.q(`select count(*)::int n from mr_events where kind = 'member_linked' and data->>'from_emp' = 'E17'`))[0].n === 1);
  // The GM resigns (manager_auth still says gm): out at the next request.
  await S.q(`update employees set status = '退職' where id = 'E2'`);
  assert.equal((await S.call('E2', { action: 'whoami' })).status, 403);
});

test('the real mark has a name, not an employee id: CEO / GM / AM rows are made from the masters by name', async () => {
  const S = await setup({ before: async pg => {
    await pg.query(`delete from mr_members where user_id in ($1, $2)`, [U.gm, U.ceo]);   // no rows from the seed
  } });
  await S.q(`delete from mr_members where emp_id = 'E6'`);   // the install made AM Two's row; take it away to see it made by name
  assert.equal((await S.q(`select count(*)::int n from mr_members where user_id in ($1, $2)`, [U.gm, U.ceo]))[0].n, 0);
  const g = await S.ok('name:GM Test', { action: 'whoami' });
  assert.equal(g.role, 'gm'); assert.equal(g.via, 'pin');
  assert.deepEqual((await S.q(`select user_id::text u, emp_id, role from mr_members where emp_id = 'E2' and enabled`))[0], { u: U.gm, emp_id: 'E2', role: 'gm' });
  assert.equal((await S.ok('name:AM Two', { action: 'whoami' })).role, 'am');
  assert.equal((await S.q(`select role from mr_members where emp_id = 'E6' and enabled`))[0].role, 'am');
  // a resigned CEO by name: no row (the name finds nobody in service)
  await S.q(`update employees set status = '退職' where id = 'E1'`);
  assert.equal((await S.call('name:CEO Test', { action: 'whoami' })).status, 403);
  // a CEO in service whose PIN mark arrives by employee id, but the employee resigned: no row is made
  assert.equal((await S.call('E1', { action: 'whoami' })).status, 403);
  assert.equal((await S.q(`select count(*)::int n from mr_members where user_id = $1`, [U.ceo]))[0].n, 0, 'no CEO row for someone resigned');
  // two people in service with the same name: nobody
  await S.q(`insert into employees(id, name, role, title, status) values('E21', 'AM Two', 'crew', 'Server', '在籍')`);
  assert.equal((await S.call('name:AM Two', { action: 'whoami' })).status, 403);
});

test('people who move: an AM made GM, back to AM (the same am row, its 店舗の管轄 kept); a stopped AM made GM; a GM with an email row and a staff row', async () => {
  const S = await setup();
  const U5 = '00000000-0000-4000-8000-0000000000e5';
  const am5 = (await S.q(`select user_id::text u from mr_members where emp_id = 'E5' and enabled`))[0].u;
  await S.ok('E2', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: am5, sort: 1, expect_version: 0 }] });
  // Yuki becomes a GM (a manager_auth account linked to her; the employee master says gm)
  await S.x(`insert into manager_auth(user_id, role, emp_id) values('${U5}', 'gm', 'E5'); update employees set role = 'gm' where id = 'E5'`);
  const w = await S.ok('E5', { action: 'whoami' });
  assert.equal(w.role, 'gm');
  assert.deepEqual((await S.q(`select user_id::text u, role, enabled, updated_by from mr_members where emp_id = 'E5' order by enabled, role`)).map(x => [x.u === am5, x.role, x.enabled, x.updated_by]),
    [[true, 'am', false, 'v1122 switch'], [false, 'gm', true, 'v1122 pin']]);
  // back to AM: the account is taken away; the same am row comes back (stores still point at it)
  await S.x(`delete from manager_auth where user_id = '${U5}'; update employees set role = 'am' where id = 'E5'`);
  assert.equal((await S.ok('E5', { action: 'whoami' })).role, 'am');
  assert.equal((await S.q(`select user_id::text u from mr_members where emp_id = 'E5' and enabled`))[0].u, am5);
  assert.deepEqual((await S.ok('E5', { action: 'list', env: 'live', ym: YM })).stores.map(x => x.store_id), ['F01']);
  // An AM stopped by SQL whom manager_auth later makes a GM: in as GM (manager_auth decides CEO / GM)
  const U9 = '00000000-0000-4000-8000-0000000000e9';
  await S.x(`insert into manager_auth(user_id, role, emp_id) values('${U9}', 'gm', 'E9'); update employees set role = 'gm' where id = 'E9'`);
  assert.equal((await S.ok('E9', { action: 'whoami' })).role, 'gm');
  // A GM with a row from an email sign-in (no employee) and a staff row the settings made: the GM row is linked, the staff row gives way
  const T = await setup({ before: async pg => {
    await pg.query(`update mr_members set emp_id = null where user_id = $1`, [U.gm]);
    await pg.query(`insert into mr_members(emp_id, name, role) values('E2', 'GM Test', 'staff')`);
  } });
  assert.equal((await T.ok('E2', { action: 'whoami' })).role, 'gm');
  assert.deepEqual((await T.q(`select user_id::text u, role, enabled from mr_members where emp_id = 'E2' order by enabled`)).map(x => [x.u === U.gm, x.role, x.enabled]), [[false, 'staff', false], [true, 'gm', true]]);
});

test('running the SQL again keeps the switches a GM chose; the check notices when an earlier SQL put the old whoami back', async () => {
  const post = fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8');
  const row = async (S, n) => (await S.q(post)).find(r => r.check_name === n);
  const S = await setup();
  const w = await S.ok('E2', { action: 'whoami' });
  await S.ok('E2', { action: 'settings_save', key: 'flags', value: { ...w.flags, private: false, live_input: false }, expect_version: w.flags_version });
  await S.pg.exec('reset role'); await S.pg.exec(LIVE); await S.pg.exec('set role service_role');
  const f = (await S.q(`select value from mr_settings where key = 'flags'`))[0].value;
  assert.deepEqual([f.private, f.live_input], [false, false], 'a second run does not turn the review back on');
  // only 20261016090000 again: whoami and mr_can are the old ones (the settings would need email again) → NG
  await S.pg.exec('reset role'); await S.pg.exec(mig('20261016090000_mid_review_v2_versions.sql')); await S.pg.exec('set role service_role');
  assert.match((await row(S, 'mid-review live (20261102090000)')).result, /^NG/);
  // only 20261015090000 again (mr_member_role and mr_pin_actor as before v1122) → NG
  const T = await setup();
  await T.pg.exec('reset role'); await T.pg.exec(mig('20261015090000_mid_review_v2.sql')); await T.pg.exec('set role service_role');
  assert.match((await row(T, 'mid-review live (20261102090000)')).result, /^NG/);
});

test('stopping one person by employee id (db/mid-review-disable-member-by-employee.sql): an AM made by v1122, and an AM who never signed in', async () => {
  const stop = fs.readFileSync(new URL('../db/mid-review-disable-member-by-employee.sql', import.meta.url), 'utf8');
  const S = await setup();
  assert.equal((await S.ok('E5', { action: 'whoami' })).role, 'am');
  await S.x(stop.replaceAll('<社員ID>', 'E5'));
  assert.equal((await S.call('E5', { action: 'whoami' })).status, 403);
  assert.equal((await S.call('E5', { action: 'whoami' })).status, 403, 'a second PIN sign-in does not make the row again');
  // someone made an AM after the install, who never signed in: stopped before they can
  await S.q(`update employees set role = 'am' where id = 'E14'`);
  await S.x(stop.replaceAll('<社員ID>', 'E14'));
  assert.equal((await S.call('E14', { action: 'whoami' })).status, 403);
  await assert.rejects(S.x(stop.replaceAll('<社員ID>', 'E99')), /社員の表にありません/);
  await assert.rejects(S.x(stop), /書き換えてください/);
});

test('a CEO / GM row whose account now names someone else gives way when the person signs in with another GM account; the old account\'s row then follows manager_auth to its new person', async () => {
  const A2 = '00000000-0000-4000-8000-0000000000c7';
  const S = await setup();
  assert.equal((await S.ok('E2', { action: 'whoami' })).role, 'gm');                     // E2 has the row of U.gm
  // manager_auth changes: U.gm now names E13, and a new GM account A2 names E2
  await S.q(`update manager_auth set emp_id = 'E13' where user_id = $1`, [U.gm]);
  await S.q(`insert into manager_auth(user_id, role, emp_id) values($1, 'gm', 'E2')`, [A2]);
  const w = await S.ok('E2', { action: 'whoami' });
  assert.equal(w.role, 'gm', 'E2 is GM through A2 (the dead row does not hold them)');
  assert.deepEqual((await S.q(`select user_id::text, enabled, updated_by from mr_members where emp_id = 'E2' order by enabled desc`)).map(r => [r.user_id, r.enabled, r.updated_by]),
    [[A2, true, 'v1122 pin'], [U.gm, false, 'v1122 switch']]);
  // E13 signs in: U.gm's row (turned off when E2 moved over) follows manager_auth to E13
  assert.equal((await S.ok('E13', { action: 'whoami' })).role, 'gm');
  assert.deepEqual((await S.q(`select emp_id, enabled from mr_members where user_id = $1`, [U.gm]))[0], { emp_id: 'E13', enabled: true });
});
