// 中間レビュー（非公開版）: the server side on synthetic data — the real SQL (PGlite) and the real handler.
// No production data. People are fake UUIDs; sign-in is a stand-in for Supabase Auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, demoData } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261012090000_mid_review.sql', import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  crew: '00000000-0000-4000-8000-0000000000c4', am1: '00000000-0000-4000-8000-0000000000c5', am2: '00000000-0000-4000-8000-0000000000c6',
  off: '00000000-0000-4000-8000-0000000000c7', stranger: '00000000-0000-4000-8000-0000000000c8' };

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['crew', 'office_crew', 'E4']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  // AMs are added by SQL (Moto). One more member who has been turned off.
  await pg.query(`insert into mr_members(user_id, emp_id, name, role) values($1,'E5','Yuki','am'),($2,'E6','AM Two','am'),($3,'E7','Old GM','gm')`, [U.am1, U.am2, U.off]);
  await pg.query('update mr_members set enabled=false where user_id=$1', [U.off]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, fetch, db });
  const call = async (body, headers = {}, method = 'POST') => {
    const r = await h(new Request('https://fn.test', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }));
    return { status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers };
  };
  const api = (who, body) => call(body, who ? { authorization: 'Bearer tok-' + who } : {});
  const q = async (sql, p = []) => { await pg.exec('reset role'); try { return (await pg.query(sql, p)).rows; } finally { await pg.exec('set role service_role'); } };
  return { pg, api, call, q };
}
const on = E => E.api('gm', { action: 'settings_save', key: 'flags', value: { private: true } });

test('setup: CEO and GM from manager_auth become members, office does not; everything starts off', async () => {
  const E = await setup();
  const m = await E.q('select user_id, role, emp_id from mr_members order by emp_id');
  assert.deepEqual(m.map(x => [x.role, x.emp_id]), [['ceo', 'E1'], ['gm', 'E2'], ['am', 'E5'], ['am', 'E6'], ['gm', 'E7']]);
  const f = (await E.q(`select value from mr_settings where key='flags'`))[0].value;
  assert.deepEqual(f, { private: false, store_publish: false, notify: false });
});

test('browsers cannot reach the tables or functions directly (anon / authenticated)', async () => {
  const E = await setup();
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['mr_settings', 'mr_members', 'mr_stores', 'mr_reviews', 'mr_submissions', 'mr_replies', 'mr_events'])
      for (const pr of ['select', 'insert', 'update', 'delete'])
        assert.equal((await E.q(`select has_table_privilege($1, 'public.${t}', $2) v`, [role, pr]))[0].v, false, `${role} ${pr} ${t}`);
    for (const fn of ['mr_whoami(jsonb)', 'mr_list(jsonb)', 'mr_settings_save(jsonb)', 'mr_stores_save(jsonb)', 'mr_demo_reset(jsonb)', 'mr_members_list(jsonb)', 'mr_auth(uuid,text[],boolean)'])
      assert.equal((await E.q(`select has_function_privilege($1, 'public.${fn}', 'execute') v`, [role]))[0].v, false, `${role} ${fn}`);
    const rls = await E.q(`select relname, relrowsecurity from pg_class where relname like 'mr\\_%' and relkind='r'`);
    assert.ok(rls.length === 7 && rls.every(r => r.relrowsecurity));
  }
});

test('who can call: no sign-in 401, anon key 401, office / office_crew / turned-off member / stranger 403', async () => {
  const E = await setup();
  assert.equal((await E.api(null, { action: 'whoami' })).status, 401);
  assert.equal((await E.call({ action: 'whoami' }, { authorization: 'Bearer anon-key' })).status, 401);
  for (const who of ['office', 'crew', 'off', 'stranger']) {
    const r = await E.api(who, { action: 'whoami' });
    assert.equal(r.status, 403, who); assert.equal(r.body.error, 'forbidden');
  }
  for (const who of ['ceo', 'gm', 'am1']) assert.equal((await E.api(who, { action: 'whoami' })).status, 200, who);
});

test('while the private check is off nobody can list; only GM / CEO can turn it on; store publication and notices stay off', async () => {
  const E = await setup();
  const w = await E.api('am1', { action: 'whoami' });
  assert.equal(w.body.flags.private, false);
  const l = await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' });
  assert.equal(l.status, 403); assert.equal(l.body.error, 'disabled');
  assert.equal((await E.api('am1', { action: 'settings_save', key: 'flags', value: { private: true } })).status, 403);
  for (const v of [{ private: true, store_publish: true }, { private: true, notify: true }]) {
    const r = await E.api('gm', { action: 'settings_save', key: 'flags', value: v });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'not_available');
  }
  assert.equal((await E.api('gm', { action: 'settings_save', key: 'flags', value: { private: 'yes' } })).status, 400);
  const ok = await on(E);
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.value, { private: true, store_publish: false, notify: false });
  assert.equal((await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).status, 200);
  // Turning it off again closes it for everyone at once.
  await E.api('ceo', { action: 'settings_save', key: 'flags', value: { private: false } });
  assert.equal((await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).body.error, 'disabled');
  const ev = await E.q(`select kind, actor from mr_events order by id`);
  assert.deepEqual(ev.map(e => e.kind), ['settings', 'settings']);
});

test('schedule: GM / CEO only, days 1–28 in order', async () => {
  const E = await setup(); await on(E);
  const good = { submit_day: 14, reply_day: 16, decide_day: 18, consult_from: 20, consult_to: 23 };
  assert.equal((await E.api('am1', { action: 'settings_save', key: 'schedule', value: good })).status, 403);
  assert.equal((await E.api('ceo', { action: 'settings_save', key: 'schedule', value: good })).status, 200);
  for (const bad of [{ ...good, reply_day: 13 }, { ...good, consult_to: 29 }, { ...good, submit_day: 0 }, { ...good, decide_day: '18' }, { ...good, reply_day: 16.5 }, { submit_day: 14 }])
    assert.equal((await E.api('gm', { action: 'settings_save', key: 'schedule', value: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await E.api('gm', { action: 'settings_save', key: 'other', value: {} })).status, 400);
  assert.deepEqual((await E.api('am1', { action: 'whoami' })).body.schedule, good);
});

test('demo: GM / CEO make it, every member sees the six fictional stores; making it again does not double it', async () => {
  const E = await setup(); await on(E);
  assert.equal((await E.api('am1', { action: 'demo_reset' })).status, 403);
  const r = await E.api('gm', { action: 'demo_reset' });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { stores: 6, reviews: 6 });
  await E.api('ceo', { action: 'demo_reset' });
  assert.equal((await E.q(`select count(*)::int n from mr_reviews where env='demo'`))[0].n, 6);
  assert.equal((await E.q(`select count(*)::int n from mr_stores where env='demo'`))[0].n, 6);
  for (const who of ['ceo', 'gm', 'am1', 'am2']) {
    const l = await E.api(who, { action: 'list', env: 'demo', ym: '2026-10' });
    assert.equal(l.status, 200); assert.equal(l.body.stores.length, 6, who); assert.equal(l.body.reviews.length, 6, who);
  }
  const l = (await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).body;
  const by = Object.fromEntries(l.reviews.map(x => [x.store_id, x]));
  assert.deepEqual(by.D1.focus, { late: 1, ok: 1, done: 1 });
  assert.equal(by.D1.status, 'submitted'); assert.equal(by.D1.pl_state, 'final'); assert.equal(by.D1.severity, 'watch');
  assert.equal(by.D2.status, 'done'); assert.equal(by.D2.issues, 0); assert.equal(by.D2.severity, null); assert.equal(by.D2.consult_state, 'none');
  assert.deepEqual(by.D3.waits.map(w => [w.kind, w.to]), [['escalate', 'gm'], ['escalate', 'ceo']]);
  assert.equal(by.D3.severity, 'high'); assert.equal(by.D3.pl_state, 'prov');
  assert.equal(by.D4.waits[0].kind, 'followup'); assert.equal(by.D5.direct, true); assert.equal(by.D5.consult.time, '15:00');
  assert.equal(by.D6.status, 'draft'); assert.equal(by.D6.pl_state, null); assert.equal(by.D6.submitted_no, 0);
  const st = Object.fromEntries(l.stores.map(s => [s.store_id, s]));
  assert.equal(st.D6.am_unset, true); assert.equal(st.D1.am_unset, false); assert.equal(st.D1.am_name, 'AM 佐藤（デモ）');
  assert.equal(st.D5.demo.kpi.sales.act, null); assert.deepEqual(st.D5.demo.kpi.sales.missing, ['2026-10-16', '2026-10-17']);
  // The list carries no store manager's free text other than what waits for a decision.
  const text = JSON.stringify(l.reviews);
  assert.ok(!/米の仕入|盛り付け/.test(text));
});

test('demo reset touches nothing outside the demo', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  await E.q(`insert into mr_reviews(env, store_id, ym, body) values('live','F01','2026-10','{"reporter":"x"}')`);
  await E.api('gm', { action: 'demo_reset' }); await E.api('gm', { action: 'demo_reset' });
  assert.equal((await E.q(`select count(*)::int n from mr_reviews where env='live'`))[0].n, 1);
  assert.equal((await E.q(`select count(*)::int n from mr_stores where env='live'`))[0].n, 1);
});

test('live stores: an AM sees only the stores a GM put in their charge; GM / CEO see all', async () => {
  const E = await setup(); await on(E);
  // The AM must be an enabled member with the AM role.
  for (const bad of [U.gm, U.office, U.stranger, U.off, 'not-a-uuid'])
    assert.equal((await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: bad }] })).status, 400, bad);
  for (const bad of [{ store_id: 'F 01', name: 'x' }, { store_id: 'F01', name: '' }, { store_id: 'F01' }])
    assert.equal((await E.api('gm', { action: 'stores_save', stores: [bad] })).status, 400, JSON.stringify(bad));
  assert.equal((await E.q(`select count(*)::int n from mr_stores`))[0].n, 0);
  assert.equal((await E.api('am1', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] })).status, 403);
  const s = await E.api('gm', { action: 'stores_save', stores: [
    { store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am1, sort: 2 },
    { store_id: 'F05', name: 'Marujuu', am_user: U.am2, sort: 3 }, { store_id: 'F06', name: 'LaLa', am_user: null, sort: 4 }] });
  assert.equal(s.status, 200);
  for (const st of ['F01', 'F02', 'F05', 'F06']) await E.q(`insert into mr_reviews(env, store_id, ym, status) values('live',$1,'2026-10','draft')`, [st]);
  const ids = async who => (await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body;
  assert.deepEqual((await ids('am1')).stores.map(x => x.store_id), ['F01', 'F02']);
  assert.deepEqual((await ids('am1')).reviews.map(x => x.store_id), ['F01', 'F02']);
  assert.deepEqual((await ids('am2')).reviews.map(x => x.store_id), ['F05']);
  assert.deepEqual((await ids('gm')).reviews.map(x => x.store_id), ['F01', 'F02', 'F05', 'F06']);
  assert.deepEqual((await ids('ceo')).stores.find(x => x.store_id === 'F06').am_unset, true);
  assert.deepEqual((await E.api('am1', { action: 'whoami' })).body.live_stores, ['F01', 'F02']);
  assert.equal((await E.api('gm', { action: 'whoami' })).body.live_stores.length, 4);
  // Moving a store to another AM moves it at once; the old AM no longer sees it.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F02', name: 'Tenkichi', am_user: U.am2, sort: 2 }] });
  assert.deepEqual((await ids('am1')).reviews.map(x => x.store_id), ['F01']);
  assert.deepEqual((await ids('am2')).reviews.map(x => x.store_id), ['F02', 'F05']);
  // A member who is turned off loses access at once.
  await E.q('update mr_members set enabled=false where user_id=$1', [U.am2]);
  assert.equal((await E.api('am2', { action: 'list', env: 'live', ym: '2026-10' })).status, 403);
});

test('one review per store × month × environment', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: null }] });
  await E.q(`insert into mr_reviews(env, store_id, ym) values('live','F01','2026-10')`);
  await assert.rejects(E.q(`insert into mr_reviews(env, store_id, ym) values('live','F01','2026-10')`));
  await E.q(`insert into mr_reviews(env, store_id, ym) values('live','F01','2026-11')`);
});

test('request handling: origin, method, unknown action, bad values, members list', async () => {
  const E = await setup(); await on(E);
  assert.equal((await E.call({ action: 'whoami' }, { origin: 'https://evil.test', authorization: 'Bearer tok-gm' })).status, 403);
  const ok = await E.call({ action: 'whoami' }, { origin: 'https://funergy-plus.com', authorization: 'Bearer tok-gm' });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://funergy-plus.com'); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await E.call(null, { origin: 'https://funergy-plus.com' }, 'OPTIONS')).status, 204);
  assert.equal((await E.call(null, {}, 'GET')).status, 405);
  assert.equal((await E.api('gm', { action: 'constructor' })).status, 400);
  assert.equal((await E.api('gm', { action: 'drop' })).status, 400);
  for (const b of [{ env: 'prod', ym: '2026-10' }, { env: 'demo', ym: '2026-13' }, { env: 'demo', ym: "2026-10'; --" }])
    assert.equal((await E.api('gm', { action: 'list', ...b })).status, 400);
  const m = await E.api('gm', { action: 'members_list' });
  assert.equal(m.status, 200); assert.equal(m.body.length, 5);
  assert.equal((await E.api('am1', { action: 'members_list' })).status, 403);
});

test('demo data matches UI案43 (same stores, same states)', () => {
  const d = demoData('2026-10');
  assert.deepEqual(d.reviews.map(r => [r.store_id, r.status]), [['D1', 'submitted'], ['D2', 'done'], ['D3', 'decision'], ['D4', 'followup'], ['D5', 'consult'], ['D6', 'draft']]);
  const s = d.stores.find(x => x.store_id === 'D1').demo.kpi;
  assert.equal(Math.round(s.sales.act / s.sales.tgt * 1000) / 10, 98.1);
  assert.equal(d.stores.find(x => x.store_id === 'D6').am_name, null);
  assert.equal(demoData('2027-01').reviews[0].submissions[0].snapshot.pl.ym, '2026-12');
});

test('the check, add-AM and rollback SQL work on the same schema', async () => {
  const E = await setup();
  const post = fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8');
  const rows = await E.q(post);
  assert.equal(rows.length, 9);
  for (const r of rows) assert.ok(/^OK/.test(r.result), r.check_name + ': ' + r.result);
  // Add an AM by SQL: the account must exist; the employee is found by name when exactly one matches.
  await E.pg.exec('reset role');
  await E.pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text); create table public.employees(id text primary key, data jsonb);
    insert into auth.users values ('00000000-0000-4000-8000-0000000000d1','yuki@example.test');
    insert into public.employees values ('E9','{"id":"E9","name":"Yuki Test"}'),('E8','{"id":"E8","name":"Old Yuki","status":"退職"}');`);
  await E.pg.exec('set role service_role');
  const add = fs.readFileSync(new URL('../db/mid-review-add-am.sql', import.meta.url), 'utf8')
    .replace('<AM のメールアドレス>', 'YUKI@example.test').replace('<社員の表の名前の一部（例：Yuki）>', 'Yuki');
  await E.pg.exec('reset role'); await E.pg.exec(add); await E.pg.exec('set role service_role');
  const m = await E.q(`select role, emp_id, enabled from mr_members where user_id='00000000-0000-4000-8000-0000000000d1'`);
  assert.deepEqual(m, [{ role: 'am', emp_id: 'E9', enabled: true }]);
  await E.pg.exec('reset role');
  await assert.rejects(E.pg.exec(add.replace('YUKI@example.test', 'nobody@example.test')), /まだありません/);
  // Rollback: stops while a live review exists, otherwise removes only the mr_ objects.
  const rb = fs.readFileSync(new URL('../db/mid-review-rollback.sql', import.meta.url), 'utf8');
  await E.pg.exec(`insert into mr_stores(env, store_id, name) values('live','F01','ToriTon'); insert into mr_reviews(env, store_id, ym) values('live','F01','2026-10')`);
  await assert.rejects(E.pg.exec(rb), /本番/);
  await E.pg.exec(`delete from mr_reviews where env='live'`);
  await E.pg.exec(rb);
  const left = (await E.pg.query(`select count(*)::int n from pg_class where relname like 'mr\\_%' and relkind='r'`)).rows[0].n;
  assert.equal(left, 0);
  assert.equal((await E.pg.query(`select count(*)::int n from pg_proc where proname like 'mr\\_%'`)).rows[0].n, 0);
  assert.equal((await E.pg.query(`select count(*)::int n from manager_auth`)).rows[0].n, 4);
});
