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
  off: '00000000-0000-4000-8000-0000000000c7', stranger: '00000000-0000-4000-8000-0000000000c8', amoff: '00000000-0000-4000-8000-0000000000c9' };

async function setup() {
  const pg = new PGlite();
  // Like Supabase: new tables, sequences and functions in public are granted to anon / authenticated by default.
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    -- The shared masters as the app syncs them (SUPA_MASTER_MAP): read only by the review, to take access away.
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.employees, public.stores to service_role;
    insert into public.employees(id, name, role, status) values ('E1','CEO Test','ceo','在籍'),('E2','GM Test','gm','在籍'),('E5','Yuki','am','在籍'),('E6','AM Two','am',null),('E7','Old GM','gm','在籍'),('E9','Stopped AM','am','在籍');
    insert into public.stores(id, name, am, active) values ('F01','ToriTon','Yuki',true),('F02','Tenkichi','Yuki',true),('F05','Marujuu','AM Two',true),('F06','LaLa',null,true);`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['crew', 'office_crew', 'E4']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  // AMs are added by SQL (Moto). One more member who has been turned off.
  await pg.query(`insert into mr_members(user_id, emp_id, name, role) values($1,'E5','Yuki','am'),($2,'E6','AM Two','am'),($3,'E7','Old GM','gm'),($4,'E9','Stopped AM','am')`, [U.am1, U.am2, U.off, U.amoff]);
  await pg.query('update mr_members set enabled=false where user_id in ($1,$2)', [U.off, U.amoff]);
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
  assert.deepEqual(m.map(x => [x.role, x.emp_id]), [['ceo', 'E1'], ['gm', 'E2'], ['am', 'E5'], ['am', 'E6'], ['gm', 'E7'], ['am', 'E9']]);
  const f = (await E.q(`select value from mr_settings where key='flags'`))[0].value;
  assert.deepEqual(f, { private: false, store_publish: false, notify: false });
});

test('browsers cannot reach the tables or functions directly (anon / authenticated)', async () => {
  const E = await setup();
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['mr_settings', 'mr_members', 'mr_stores', 'mr_reviews', 'mr_submissions', 'mr_replies', 'mr_events'])
      for (const pr of ['select', 'insert', 'update', 'delete'])
        assert.equal((await E.q(`select has_table_privilege($1, 'public.${t}', $2) v`, [role, pr]))[0].v, false, `${role} ${pr} ${t}`);
    for (const fn of ['mr_whoami(jsonb)', 'mr_list(jsonb)', 'mr_settings_save(jsonb)', 'mr_stores_save(jsonb)', 'mr_demo_reset(jsonb)', 'mr_members_list(jsonb)', 'mr_auth(uuid,text[],boolean)',
      'mr_am_hr_ok(text)', 'mr_am_master_ok(uuid,text)', 'mr_sees(text,uuid,text,uuid,text)'])
      assert.equal((await E.q(`select has_function_privilege($1, 'public.${fn}', 'execute') v`, [role]))[0].v, false, `${role} ${fn}`);
    for (const pr of ['usage', 'select', 'update']) assert.equal((await E.q(`select has_sequence_privilege($1, 'public.mr_events_id_seq', $2) v`, [role, pr]))[0].v, false, `${role} seq ${pr}`);
    const rls = await E.q(`select relname, relrowsecurity from pg_class where relname like 'mr\\_%' and relkind='r'`);
    assert.ok(rls.length === 7 && rls.every(r => r.relrowsecurity));
  }
});

test('who can call: no sign-in 401, anon key 401, office / office_crew / turned-off member / stranger 403', async () => {
  const E = await setup();
  assert.equal((await E.api(null, { action: 'whoami' })).status, 401);
  assert.equal((await E.call({ action: 'whoami' }, { authorization: 'Bearer anon-key' })).status, 401);
  for (const who of ['office', 'crew', 'off', 'amoff', 'stranger']) {
    const r = await E.api(who, { action: 'whoami' });
    assert.equal(r.status, 403, who); assert.equal(r.body.error, 'forbidden');
  }
  for (const who of ['ceo', 'gm', 'am1']) assert.equal((await E.api(who, { action: 'whoami' })).status, 200, who);
});

test('a CEO / GM taken off in manager_auth loses access here at once (the copy at setup is not enough)', async () => {
  const E = await setup(); await on(E);
  assert.equal((await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).status, 200);
  await E.q(`update manager_auth set role='office' where user_id=$1`, [U.gm]);
  assert.equal((await E.api('gm', { action: 'whoami' })).status, 403);
  assert.equal((await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).status, 403);
  await E.q(`delete from manager_auth where user_id=$1`, [U.ceo]);
  assert.equal((await E.api('ceo', { action: 'settings_save', key: 'flags', value: { private: false } })).status, 403);
  // AMs are not in manager_auth: only the members table decides.
  assert.equal((await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).status, 200);
});

test('while the private check is off nobody can list; only GM / CEO can turn it on; store publication and notices stay off', async () => {
  const E = await setup();
  await E.q(`insert into mr_stores(env, store_id, name, am_user) values('live','F01','ToriTon',$1)`, [U.am1]);
  const w = await E.api('am1', { action: 'whoami' });
  assert.equal(w.body.flags.private, false); assert.deepEqual(w.body.live_stores, []);
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
  // Moving a store to another AM (store master, then the GM saves here): the old AM no longer sees it.
  await E.q(`update stores set am='AM Two' where id='F02'`);
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
  assert.equal(m.status, 200); assert.equal(m.body.length, 6);
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
  assert.equal(rows.length, 14);
  for (const r of rows) assert.ok(/^OK/.test(r.result), r.check_name + ': ' + r.result);
  // Add a member by SQL: the account must exist, the employee name must match exactly one, an AM must be an AM, roles are never changed.
  await E.pg.exec('reset role');
  await E.pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
    insert into auth.users values ('00000000-0000-4000-8000-0000000000d1','yuki@example.test'),('00000000-0000-4000-8000-0000000000d2','sm@example.test'),('${U.gm}','gm@example.test'),
     ('${U.amoff}','stopped@example.test'),('00000000-0000-4000-8000-0000000000d3','gm2@example.test');
    insert into public.employees(id, name, role, status) values ('EY','Yuki Test','am','在籍'),('E8','Yuki Test','am','退職'),
     ('EG','Store Mgr','g4',null),('EA','Twin','am',null),('EB','Twin','am',null),('EH','GM Two','gm',null);
    insert into manager_auth values ('00000000-0000-4000-8000-0000000000d3','gm','E2');`);
  const tpl = fs.readFileSync(new URL('../db/mid-review-add-member.sql', import.meta.url), 'utf8');
  const add = (email, name, role) => tpl.replace('<メールアドレス>', email).replace('<社員の表の名前（完全に同じ）>', name).replace('<am / gm / ceo のどれか>', role);
  await E.pg.exec(add('YUKI@example.test', 'Yuki Test', 'am'));
  assert.deepEqual((await E.pg.query(`select role, emp_id, name, enabled from mr_members where user_id='00000000-0000-4000-8000-0000000000d1'`)).rows, [{ role: 'am', emp_id: 'EY', name: 'Yuki Test', enabled: true }]);
  await assert.rejects(E.pg.exec(add('nobody@example.test', 'Yuki Test', 'am')), /まだありません/);
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Yuki T', 'am')), /0 人/);         // partial names do not match
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Twin', 'am')), /2 人/);
  await assert.rejects(E.pg.exec(add('sm@example.test', 'Store Mgr', 'am')), /AM ではありません/);   // a G4 store manager is not added
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Yuki Test', 'gm')), /manager_auth/);
  await assert.rejects(E.pg.exec(add('gm@example.test', 'GM Test', 'ceo')), /もう gm/);       // roles are never changed by this file
  await assert.rejects(E.pg.exec(add('gm2@example.test', 'GM Two', 'gm')), /manager_auth の社員/);   // the email account is someone else's employee
  await assert.rejects(E.pg.exec(add('stopped@example.test', 'Stopped AM', 'am')), /止めてあります/);   // a stopped member is not turned back on quietly
  await E.pg.exec(add('stopped@example.test', 'Stopped AM', 'am').replace('v_reenable boolean := false', 'v_reenable boolean := true'));
  assert.equal((await E.pg.query(`select enabled from mr_members where user_id='${U.amoff}'`)).rows[0].enabled, true);
  // Disable by SQL.
  const dis = fs.readFileSync(new URL('../db/mid-review-disable-member.sql', import.meta.url), 'utf8');
  await E.pg.exec(dis.replace('<メールアドレス>', 'stopped@example.test'));
  assert.equal((await E.pg.query(`select enabled from mr_members where user_id='${U.amoff}'`)).rows[0].enabled, false);
  await assert.rejects(E.pg.exec(dis.replace('<メールアドレス>', 'nobody@example.test')), /ありません/);
  await E.pg.exec('set role service_role');
  // Rollback: stops while a live review exists, otherwise removes only the mr_ objects.
  const rb = fs.readFileSync(new URL('../db/mid-review-rollback.sql', import.meta.url), 'utf8');
  await E.pg.exec('reset role');
  await E.pg.exec(`insert into mr_stores(env, store_id, name) values('live','F01','ToriTon'); insert into mr_reviews(env, store_id, ym) values('live','F01','2026-10')`);
  await assert.rejects(E.pg.exec(rb), /本番/);
  assert.equal((await E.pg.query(`select count(*)::int n from pg_class where relname like 'mr\\_%' and relkind='r'`)).rows[0].n, 7);   // nothing was dropped
  await E.pg.exec(`delete from mr_reviews where env='live'`);
  await E.pg.exec(rb);
  const left = (await E.pg.query(`select count(*)::int n from pg_class where relname like 'mr\\_%' and relkind='r'`)).rows[0].n;
  assert.equal(left, 0);
  assert.equal((await E.pg.query(`select count(*)::int n from pg_proc where proname like 'mr\\_%'`)).rows[0].n, 0);
  assert.equal((await E.pg.query(`select count(*)::int n from manager_auth`)).rows[0].n, 5);
  assert.equal((await E.pg.query(`select count(*)::int n from employees`)).rows[0].n, 12);   // the masters are never touched
});

test('an AM follows the employee master: moved to G4, 退職, removed or without an employee id → refused at once', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  assert.equal((await E.api('am1', { action: 'list', env: 'live', ym: '2026-10' })).status, 200);
  for (const [sql, label] of [[`update employees set role='g4' where id='E5'`, 'g4'], [`update employees set role='am', status='退職' where id='E5'`, '退職'],
    [`delete from employees where id='E5'`, 'removed'], [`update mr_members set emp_id=null where user_id='${U.am1}'`, 'no emp_id']]) {
    await E.q(sql);
    for (const body of [{ action: 'whoami' }, { action: 'list', env: 'live', ym: '2026-10' }, { action: 'list', env: 'demo', ym: '2026-10' }]) {
      const r = await E.api('am1', body);
      assert.equal(r.status, 403, label + ' ' + body.action); assert.equal(r.body.error, 'forbidden');
    }
    await E.q(`insert into employees(id, name, role, status) values('E5','Yuki','am','在籍') on conflict (id) do update set role='am', status='在籍', name='Yuki'`);
    await E.q(`update mr_members set emp_id='E5' where user_id='${U.am1}'`);
    assert.equal((await E.api('am1', { action: 'whoami' })).status, 200, 'back ' + label);
  }
  // The master can only take access away: a CEO / GM does not depend on it, and making someone an AM there gives nothing.
  await E.q(`update employees set role='am' where id='E2'`);
  assert.equal((await E.api('gm', { action: 'whoami' })).body.role, 'gm');
  assert.equal((await E.api('stranger', { action: 'whoami' })).status, 403);
});

test('an AM follows the store master: when the AM column names someone else the old AM loses the store at once; the new AM waits for the GM', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F05', name: 'Marujuu', am_user: U.am2, sort: 2 }] });
  await E.q(`insert into mr_reviews(env, store_id, ym, status) values('live','F01','2026-10','draft'),('live','F05','2026-10','draft')`);
  const list = async who => (await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body;
  assert.deepEqual((await list('am1')).reviews.map(x => x.store_id), ['F01']);
  await E.q(`update stores set am='AM Two' where id='F01'`);
  assert.deepEqual((await list('am1')).stores, []); assert.deepEqual((await list('am1')).reviews, []);
  assert.deepEqual((await E.api('am1', { action: 'whoami' })).body.live_stores, []);
  assert.deepEqual((await list('am2')).reviews.map(x => x.store_id), ['F05']);       // not widened by the master alone
  const g = Object.fromEntries((await list('gm')).stores.map(s => [s.store_id, s.am_ok]));
  assert.deepEqual(g, { F01: false, F05: true });                                   // the GM sees which one to check
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am2, sort: 1 }] });
  assert.deepEqual((await list('am2')).reviews.map(x => x.store_id), ['F01', 'F05']);
  // A store master that names nobody, or a name with extra spaces, gives nobody access (same rule as the app: exactly the same name).
  await E.q(`update stores set am=' AM Two' where id='F05'`);
  assert.deepEqual((await list('am2')).reviews.map(x => x.store_id), ['F01']);
  assert.equal((await list('am2')).stores.every(s => s.am_ok === null), true);    // an AM is not shown the check
});

test('stores_save: only AMs who are still AMs in the employee master; numbers in range; refused while the private check is off', async () => {
  const E = await setup();
  for (const action of ['stores_save', 'demo_reset']) {
    const r = await E.api('gm', { action, stores: [{ store_id: 'F01', name: 'ToriTon', am_user: null }] });
    assert.equal(r.status, 403, action); assert.equal(r.body.error, 'disabled');
  }
  await on(E);
  assert.equal((await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.amoff }] })).status, 400);   // stopped AM
  await E.q(`update employees set status='退職' where id='E6'`);
  assert.equal((await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F05', name: 'Marujuu', am_user: U.am2 }] })).status, 400);   // 退職 in the master
  const big = await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: null, sort: 1e12 }] });
  assert.equal(big.status, 200); assert.equal((await E.q(`select sort from mr_stores where store_id='F01'`))[0].sort, 0);   // the handler keeps numbers small
  for (const p of [{ sort: 99999 }, { sort: -1 }, { sort: 1.5 }, { sort: '3' }, { active: 'no' }])
    await assert.rejects(E.q(`select public.mr_stores_save($1::jsonb)`, [JSON.stringify({ actor: U.gm, stores: [{ store_id: 'F01', name: 'ToriTon', ...p }] })]), /bad_value/, JSON.stringify(p));
  const sch = await E.api('gm', { action: 'settings_save', key: 'schedule', value: { submit_day: 1e10, reply_day: 16, decide_day: 18, consult_from: 20, consult_to: 23 } });
  assert.equal(sch.status, 400);
});

test('an inactive live store is not listed (and not counted for the AM)', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am1, sort: 2, active: false }] });
  await E.q(`insert into mr_reviews(env, store_id, ym) values('live','F02','2026-10')`);
  for (const who of ['gm', 'am1']) {
    const l = (await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body;
    assert.deepEqual(l.stores.map(s => s.store_id), ['F01'], who); assert.deepEqual(l.reviews, [], who);
  }
  assert.deepEqual((await E.api('am1', { action: 'whoami' })).body.live_stores, ['F01']);
});

test('a database error is not passed on (500 says only "error"); Auth that hangs is cut off', async () => {
  const leak = 'relation "public.mr_secret" does not exist key=abc token=xyz';
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const h = createHandler({ env, fetch: async () => Response.json({ id: U.gm }), db: { rpc: async () => { throw new Error(leak); } } });
    const r = await h(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer tok-gm' }, body: JSON.stringify({ action: 'whoami' }) }));
    assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'error' });
    assert.ok(logs.length && !/abc|xyz/.test(logs.join(' ')), 'no secrets in the log');
  } finally { console.error = orig; }
  let signal = null;
  const h2 = createHandler({ env, fetch: async (u, init) => { signal = init.signal; return Response.json({ id: U.gm }); }, db: { rpc: async () => ({}) } });
  await h2(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer tok-gm' }, body: JSON.stringify({ action: 'whoami' }) }));
  assert.ok(signal && typeof signal.aborted === 'boolean', 'the Auth call has a time limit');
});

test('the check before installing: OK on a database without the review, NG once it is there', async () => {
  const pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); insert into manager_auth values ('${U.gm}','gm','E2');
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);`);
  const pre = fs.readFileSync(new URL('../db/mid-review-precheck.sql', import.meta.url), 'utf8');
  const rows = (await pg.query(pre)).rows;
  assert.equal(rows.length, 8);
  for (const r of rows) assert.ok(/^OK/.test(r.result), r.check_name + ': ' + r.result);
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await pg.exec(SQL);
  const after = Object.fromEntries((await pg.query(pre)).rows.map(r => [r.check_name, r.result]));
  assert.match(after['mid-review tables already there'], /^NG/);
  // A database without the masters stops the install before anything is made (the helper functions read them).
  const bare = new PGlite();
  await bare.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table public.manager_auth(user_id uuid primary key, role text, emp_id text);`);
  await assert.rejects(bare.exec('begin;' + SQL + 'commit;'), /employees|stores/);
});

// ---------------------------------------------------------------- 段階 2-2: one store's page, the draft and the submission
const demoOn = async E => { await on(E); assert.equal((await E.api('gm', { action: 'demo_reset' })).status, 200); };
const okBody = (extra = {}) => ({ reporter: '店長 X（デモ）', consult: 'none', pl: {}, kpi: {}, focus: [], issues: [], ...extra });

test('get: the store page for those who see the store; drafts of replies only for their author; nothing for others', async () => {
  const E = await setup(); await demoOn(E);
  const g = await E.api('am1', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D1' });
  assert.equal(g.status, 200);
  assert.equal(g.body.store.name, '港町（デモ）'); assert.equal(g.body.review.status, 'submitted'); assert.equal(g.body.review.unsubmitted, false);
  assert.equal(g.body.submissions.length, 1); assert.equal(g.body.submissions[0].snapshot.period.to, '2026-10-13');
  assert.equal(g.body.submissions[0].snapshot.kpi.fc.judge, 'miss'); assert.deepEqual(g.body.submissions[0].snapshot.pl.checked, ['sales', 'labor']);
  assert.match(g.body.review.body.issues[0].cause, /米の仕入単価/);
  const d3 = (await E.api('ceo', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D3' })).body;
  assert.deepEqual(d3.replies.map(r => [r.target, r.decision, r.escalate_to]), [['issue:i1', 'escalate', 'gm'], ['issue:i2', 'escalate', 'ceo']]);
  await E.q(`insert into mr_replies(review_id, target, author, author_name, author_role, decision, data, state) select id, 'summary', $1, 'Yuki', 'am', 'modify', '{"next":"secret draft"}', 'draft' from mr_reviews where store_id='D3'`, [U.am1]);
  assert.equal((await E.api('am1', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D3' })).body.replies.length, 3);
  assert.equal((await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D3' })).body.replies.length, 2);   // someone else's draft is not shown
  // Live: an AM gets only their stores; unknown, inactive or someone else's store is "not found"; off = disabled.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }, { store_id: 'F05', name: 'Marujuu', am_user: U.am2 }] });
  assert.equal((await E.api('am1', { action: 'get', env: 'live', ym: '2026-10', store_id: 'F01' })).body.review, null);
  for (const [who, st] of [['am1', 'F05'], ['am1', 'F99'], ['am2', 'F01']]) assert.equal((await E.api(who, { action: 'get', env: 'live', ym: '2026-10', store_id: st })).status, 404, who + st);
  for (const b of [{ env: 'demo', ym: '2026-10', store_id: "D1'" }, { env: 'x', ym: '2026-10', store_id: 'D1' }, { env: 'demo', ym: '10', store_id: 'D1' }])
    assert.equal((await E.api('gm', { action: 'get', ...b })).status, 400);
  await E.api('gm', { action: 'settings_save', key: 'flags', value: { private: false } });
  assert.equal((await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D1' })).status, 403);
  for (const who of ['office', 'stranger']) assert.equal((await E.api(who, { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D1' })).status, 403);
});

test('save: creates the draft once, versions every save, refuses an older version (nobody overwrites a newer save), live waits for store publication', async () => {
  const E = await setup(); await demoOn(E);
  await E.q(`insert into mr_stores(env, store_id, name, sort) values('demo','D7','新店（デモ）',7)`);
  const save = (who, v, body) => E.api(who, { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D7', expect_version: v, body });
  const a = await save('am1', null, okBody({ consult: null }));
  assert.equal(a.status, 200); assert.equal(a.body.version, 1); assert.equal(a.body.status, 'draft');
  const r1 = (await E.q(`select deadlines, next_actor, next_due::text from mr_reviews where store_id='D7'`))[0];
  assert.equal(r1.deadlines.submit, '2026-10-15'); assert.equal(r1.next_actor, '店長 X（デモ）'); assert.equal(r1.next_due, '2026-10-15');
  assert.equal((await save('gm', null, okBody())).status, 409);                    // a second "new" draft is not made
  assert.equal((await save('gm', 1, okBody({ reporter: 'B' }))).body.version, 2);
  const late = await save('am1', 1, okBody({ reporter: 'A' }));                      // still on version 1: refused, B stays
  assert.equal(late.status, 409); assert.equal(late.body.error, 'conflict');
  assert.equal((await E.q(`select body->>'reporter' r, version from mr_reviews where store_id='D7'`))[0].r, 'B');
  assert.equal((await E.q(`select count(*)::int n from mr_reviews where store_id='D7'`))[0].n, 1);
  assert.equal((await E.q(`select count(*)::int n from mr_events e join mr_reviews r on r.id=e.review_id where r.store_id='D7' and e.kind='create'`))[0].n, 1);
  // Only these fields are kept; text is kept as text.
  await save('gm', 2, { ...okBody(), evil: 1, issues: [{ id: 'i1', what: '<b>x</b>', severity: 'high', x: 2 }], kpi: { fc: { comment: 'c', tags: ['weather', 'bogus'] }, 'BAD KEY': {} } });
  const b = (await E.q(`select body from mr_reviews where store_id='D7'`))[0].body;
  assert.equal(b.evil, undefined); assert.equal(b.issues[0].what, '<b>x</b>'); assert.equal(b.issues[0].x, undefined);
  assert.deepEqual(b.kpi, { fc: { comment: 'c', tags: ['weather'] } });
  // Live: store publication is off in this edition.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  const lv = await E.api('am1', { action: 'save', env: 'live', ym: '2026-10', store_id: 'F01', expect_version: null, body: okBody() });
  assert.equal(lv.status, 409); assert.equal(lv.body.error, 'not_available');
  assert.equal((await E.q(`select count(*)::int n from mr_reviews where env='live'`))[0].n, 0);
  // While waiting for a decision (or done), the store manager's copy cannot change.
  const d3 = (await E.q(`select version from mr_reviews where store_id='D3'`))[0].version;
  assert.equal((await E.api('gm', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D3', expect_version: d3, body: okBody() })).body.error, 'locked');
});

test('save: what was decided at the start of the month stays (title, owner, condition, original due date); items cannot be dropped', async () => {
  const E = await setup(); await demoOn(E);
  const r = (await E.q(`select version, body from mr_reviews where store_id='D6'`))[0];
  const focus = r.body.focus.map(f => ({ ...f, title: 'changed', owner: 'x', due_orig: '2026-10-01', due_now: '2026-11-15', status: 'late', reason: 'r' }));
  focus.pop();                                                                   // try to drop f2
  focus.push({ id: 'n1', title: '新しく足した重点', owner: 'Nguyen', due_orig: '2026-10-30', status: 'ok', fixed: true });
  const s = await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: r.version, body: { ...okBody(), focus } });
  assert.equal(s.status, 200);
  const f = (await E.q(`select body->'focus' f from mr_reviews where store_id='D6'`))[0].f;
  assert.deepEqual(f.map(x => [x.id, x.title, x.due_orig, x.due_now, x.status, !!x.fixed]), [
    ['f1', 'ドリンクの提案をメニューに', '2026-10-31', '2026-11-15', 'late', true],
    ['n1', '新しく足した重点', '2026-10-30', '', 'ok', false],
    ['f2', '清掃チェック表', '2026-10-31', '2026-10-31', 'none', true]]);
});

test('submit: the saved copy becomes a submitted version with the numbers seen; incomplete is refused; double submit makes one version', async () => {
  const E = await setup(); await demoOn(E);
  const v0 = (await E.q(`select version from mr_reviews where store_id='D6'`))[0].version;
  const snap = { period: { from: '2026-10-01', to: '2026-10-17' }, updated: '2026-10-18T15:40:00Z',
    kpi: { sales: { act: 66500, tgt: 65600, judge: 'ok' }, fc: { act: 31.5, tgt: 30.5, judge: 'warn' }, labor: { act: 30, tgt: 26, judge: 'miss' } },
    pl: { ym: '2026-09', state: 'none', rows: {}, checked: [] } };
  const sub = (who, v, sn = snap) => E.api(who, { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: v, snapshot: sn });
  // Draft as made by the demo: consult not chosen, focus without status → incomplete.
  const i1 = await sub('am1', v0); assert.equal(i1.status, 422); assert.equal(i1.body.error, 'incomplete');
  const focus = (await E.q(`select body->'focus' f from mr_reviews where store_id='D6'`))[0].f.map(f => ({ ...f, status: 'ok' }));
  let v = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: v0, body: { ...okBody(), focus } })).body.version;
  const i2 = await sub('am1', v); assert.equal(i2.status, 422);                       // labor is 未達 without a comment
  v = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: v, body: { ...okBody(), focus, kpi: { labor: { comment: '応援が多かった' } } } })).body.version;
  assert.equal((await sub('am1', v - 1)).status, 409);                               // not the saved version
  const [a, b] = await Promise.all([sub('am1', v), sub('gm', v)]);                    // pressed twice / two people
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const r = (await E.q(`select status, submitted_no, next_actor, next_due::text d from mr_reviews where store_id='D6'`))[0];
  assert.deepEqual(r, { status: 'submitted', submitted_no: 1, next_actor: 'GM（AM 未設定）', d: '2026-10-17' });
  const s = await E.q(`select x.no, x.created_by, x.snapshot, x.body->'kpi'->'labor'->>'comment' c from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='D6'`);
  assert.equal(s.length, 1); assert.equal(s[0].c, '応援が多かった'); assert.equal(s[0].snapshot.kpi.labor.act, 30);
  assert.ok(['Yuki', 'GM Test'].includes(s[0].created_by));                            // the real person who pressed it, not the demo manager
  const ev = await E.q(`select kind, data from mr_events e join mr_reviews r on r.id=e.review_id where r.store_id='D6' and kind='submit'`);
  assert.equal(ev.length, 1); assert.equal(ev[0].data.from, 'draft');
  // The list shows what was submitted, not a newer working copy.
  const vv = (await E.q(`select version from mr_reviews where store_id='D6'`))[0].version;
  await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: vv, body: { ...okBody({ consult: 'yes' }), focus, kpi: { labor: { comment: '応援が多かった' } }, issues: [{ id: 'i9', what: '新しい相談', severity: 'high', cause: 'c', action: 'a' }] } });
  const l = (await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D6');
  assert.equal(l.issues, 0); assert.equal(l.consult_state, 'none');
  assert.equal((await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D6' })).body.review.unsubmitted, true);
  // Corrected before the AM replied: a second version, the first one stays.
  const v2 = (await E.q(`select version from mr_reviews where store_id='D6'`))[0].version;
  assert.equal((await sub('gm', v2)).status, 200);
  assert.deepEqual((await E.q(`select no from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='D6' order by no`)).map(x => x.no), [1, 2]);
});

test('submit after a follow-up question goes back to the AM with the decision deadline; AM name from the employee master', async () => {
  const E = await setup(); await demoOn(E);
  await E.q(`update mr_stores set am_user=$1, am_name=null where env='demo' and store_id='D4'`, [U.am1]);
  const r = (await E.q(`select version from mr_reviews where store_id='D4'`))[0];
  const body = (await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D4' })).body.review.body;
  const v = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: r.version, body })).body.version;
  const snap = { period: { from: '2026-10-01', to: '2026-10-17' }, kpi: { guests: { act: 2610, tgt: 2870, judge: 'miss' } }, pl: { ym: '2026-09', state: 'final', rows: {}, checked: [] } };
  const s = await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v, snapshot: snap });
  assert.equal(s.status, 200);
  const x = (await E.q(`select status, next_actor, next_due::text d, submitted_no from mr_reviews where store_id='D4'`))[0];
  assert.deepEqual(x, { status: 'submitted', next_actor: 'Yuki', d: '2026-10-19', submitted_no: 2 });
});

test('what is missing: KPI 未達 needs a comment; PL 注意・未達 needs cause and plan unless checked at the start of the month; late / help / investigating need their fields', async () => {
  const E = await setup();
  const miss = async (b, sn) => (await E.q(`select public.mr_missing($1::jsonb, $2::jsonb) v`, [JSON.stringify(b), JSON.stringify(sn)]))[0].v;
  const sn = { kpi: { fc: { judge: 'miss' }, sales: { judge: 'warn' } }, pl: { rows: { fc: { judge: 'warn' }, sales: { judge: 'miss' }, labor: { judge: 'ok' } }, checked: ['sales'] } };
  assert.deepEqual(await miss({ consult: 'none' }, sn), ['kpi:fc', 'pl:fc']);
  assert.deepEqual(await miss({ consult: 'none', kpi: { fc: { comment: ' ' } }, pl: { fc: { cause: 'c' } } }, sn), ['kpi:fc', 'pl:fc']);
  assert.deepEqual(await miss({ consult: 'none', kpi: { fc: { comment: 'x' } }, pl: { fc: { cause: 'c', plan: 'p' } } }, sn), []);
  assert.deepEqual(await miss({}, {}), ['consult']);
  assert.deepEqual(await miss({ consult: 'yes' }, {}), ['issues']);
  const base = { id: 'i1', what: 'w', action: 'a', severity: 'watch' };
  assert.deepEqual(await miss({ consult: 'yes', issues: [base] }, {}), ['issue:i1']);                         // no cause
  assert.deepEqual(await miss({ consult: 'yes', issues: [{ ...base, cause: 'c' }] }, {}), []);
  assert.deepEqual(await miss({ consult: 'yes', issues: [{ ...base, investigating: true, inv_check: 'x', inv_owner: 'o' }] }, {}), ['issue:i1']);
  assert.deepEqual(await miss({ consult: 'yes', issues: [{ ...base, investigating: true, inv_check: 'x', inv_owner: 'o', inv_date: '2026-10-20' }] }, {}), []);
  assert.deepEqual(await miss({ consult: 'yes', issues: [{ ...base, cause: 'c', severity: '' }] }, {}), ['issue:i1']);
  const late = { id: 'f1', status: 'late', reason: 'r', next: 'n', next_owner: 'o', next_due: '2026-10-20' };
  assert.deepEqual(await miss({ consult: 'none', focus: [late, { ...late, id: 'f2', next_due: '' }, { id: 'f3', status: 'none' }, { id: 'f4', status: 'help', help_what: 'h' }, { id: 'f5', status: 'done' }] }, {}),
    ['focus:f2', 'focus:f3', 'focus:f4']);
});
