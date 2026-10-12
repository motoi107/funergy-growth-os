// 中間レビュー（非公開版）: the server side on synthetic data — the real SQL (PGlite) and the real handler.
// No production data. People are fake UUIDs; sign-in is a stand-in for Supabase Auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, demoData } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql'].map(f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');
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
  assert.equal(rows.length, 17);
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
  await assert.rejects(E.pg.exec(add('gm@example.test', 'GM Test', 'ceo')), /manager_auth/);   // a GM in manager_auth is never added as CEO
  await E.pg.exec(`update manager_auth set role='ceo' where user_id='${U.gm}'`);
  await assert.rejects(E.pg.exec(add('gm@example.test', 'GM Test', 'ceo')), /もう gm/);       // roles are never changed by this file
  await E.pg.exec(`update manager_auth set role='gm' where user_id='${U.gm}'`);
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
// The numbers a screen would send for a demo store (the server checks them against its own demo numbers).
const demoSnap = async (E, store, judge = {}) => {
  const st = (await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: store })).body.store.demo;
  const kpi = Object.fromEntries(Object.entries(st.kpi).map(([k, v]) => [k, { act: v.act, tgt: v.tgt, judge: judge[k] || 'ok' }]));
  return { period: { from: '2026-10-01', to: '2026-10-17' }, updated: st.updated, kpi,
    pl: { ym: '2026-09', state: st.pl.state, at: st.pl.at || '', rows: st.pl.rows, checked: st.pl.checked } };
};
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
  await save('gm', 2, { ...okBody({ consult: 'yes' }), evil: 1, issues: [{ id: 'i1', what: '<b>x</b>', severity: 'high', x: 2 }], kpi: { fc: { comment: 'c', tags: ['weather', 'bogus'] }, 'BAD KEY': {} } });
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
  const snap = await demoSnap(E, 'D6', { fc: 'warn', labor: 'miss' });   // as if the meeting tab's thresholds were stricter
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
  assert.equal(s.length, 1); assert.equal(s[0].c, '応援が多かった'); assert.equal(s[0].snapshot.kpi.labor.act, 26.2);
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
  const snap = await demoSnap(E, 'D4', { guests: 'miss' });
  // The AM's question needs an answer first.
  const i = await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v, snapshot: snap });
  assert.equal(i.status, 422);
  const q1 = (await E.q(`select p.id::text id from mr_replies p join mr_reviews r on r.id=p.review_id where r.store_id='D4' and p.decision='followup'`))[0].id;
  // Answers are kept by question: an answer under another key does not count.
  const bad = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v, body: { ...body, answers: { 'issue:i1': 'x' } } })).body.version;
  assert.equal((await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: bad, snapshot: snap })).status, 422);
  const v2 = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: bad, body: { ...body, answers: { [q1]: '工事は 11 月末まで。テイクアウトは売上の 18%。' } } })).body.version;
  const s = await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v2, snapshot: snap });
  assert.equal(s.status, 200);
  // Answered: the question is closed and no longer waits in the list.
  const rp = await E.q(`select data from mr_replies p join mr_reviews r on r.id=p.review_id where r.store_id='D4' and p.decision='followup'`);
  assert.equal(rp[0].data.resolved, true); assert.equal(rp[0].data.answered_no, 2);
  const l = (await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D4');
  assert.deepEqual(l.waits, []); assert.equal(l.status, 'submitted');
  // A second question on the same item (as stage 2-3 will allow) needs its own answer; the first stays answered by version 2.
  const rid = (await E.q(`select id from mr_reviews where store_id='D4'`))[0].id;
  const q2 = (await E.q(`insert into mr_replies(review_id, target, author, author_name, author_role, decision, data, state, sent_at) values($1,'issue:i1',$2,'Yuki','am','followup','{"title":"もう 1 つ","due":"2026-10-19"}','sent',now()) returning id::text id`, [rid, U.am1]))[0].id;
  await E.q(`update mr_reviews set status='followup' where id=$1`, [rid]);
  const v3 = (await E.q(`select version from mr_reviews where id=$1`, [rid]))[0].version;
  const b3 = (await E.api('am1', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D4' })).body.review.body;
  const v4 = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v3, body: { ...b3, reporter: 'x' } })).body.version;
  assert.equal((await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v4, snapshot: snap })).status, 422);
  const v5 = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v4, body: { ...b3, answers: { ...b3.answers, [q2]: '2 つ目の答え' } } })).body.version;
  assert.equal((await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D4', expect_version: v5, snapshot: snap })).status, 200);
  const both = await E.q(`select id::text id, data from mr_replies where review_id=$1 and decision='followup' order by created_at`, [rid]);
  assert.deepEqual(both.map(x => [x.id === q1 ? 'q1' : 'q2', x.data.answered_no]), [['q1', 2], ['q2', 3]]);
  const x = (await E.q(`select status, next_actor, next_due::text d, submitted_no from mr_reviews where store_id='D4'`))[0];
  assert.deepEqual(x, { status: 'submitted', next_actor: 'Yuki', d: '2026-10-19', submitted_no: 3 });
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

test('submit refuses: nothing new since the last version, numbers outside the month, demo numbers that are not the demo’s, a locked review, live stores', async () => {
  const E = await setup(); await demoOn(E);
  const v1 = (await E.q(`select version from mr_reviews where store_id='D1'`))[0].version;
  const snap = await demoSnap(E, 'D1', { fc: 'miss' });
  const sub = (sn, v = v1, st = 'D1', who = 'gm') => E.api(who, { action: 'submit', env: 'demo', ym: '2026-10', store_id: st, expect_version: v, snapshot: sn });
  const u = await sub(snap); assert.equal(u.status, 409); assert.equal(u.body.error, 'unchanged');                 // pressing again makes no version 2
  // Change something, then the numbers must still be the right ones.
  const body = (await E.api('gm', { action: 'get', env: 'demo', ym: '2026-10', store_id: 'D1' })).body.review.body;
  const v2 = (await E.api('gm', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D1', expect_version: v1, body: { ...body, reporter: '店長 田中（デモ）2' } })).body.version;
  for (const [label, sn] of [
    ['empty', {}],
    ['period of another month', { ...snap, period: { from: '2026-09-01', to: '2026-09-30' } }],
    ['PL of this month', { ...snap, pl: { ...snap.pl, ym: '2026-10' } }],
    ['forged number', { ...snap, kpi: { ...snap.kpi, fc: { ...snap.kpi.fc, act: 29 } } }],
    ['KPI left out', { ...snap, kpi: Object.fromEntries(Object.entries(snap.kpi).filter(([k]) => k !== 'fc')) }],
    ['forged checked', { ...snap, pl: { ...snap.pl, checked: ['sales', 'labor', 'fc'] } }],
    ['forged PL state', { ...snap, pl: { ...snap.pl, state: 'final', rows: {} } }]]) {
    const r = await sub(sn, v2); assert.equal(r.status, 400, label);
  }
  assert.equal((await sub(snap, v2)).status, 200);
  // Locked: waiting for a decision.
  const v3 = (await E.q(`select version from mr_reviews where store_id='D3'`))[0].version;
  const l = await sub(await demoSnap(E, 'D3'), v3, 'D3'); assert.equal(l.status, 409); assert.equal(l.body.error, 'locked');
  // Live: not in this edition.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  const lv = await E.api('am1', { action: 'submit', env: 'live', ym: '2026-10', store_id: 'F01', expect_version: 1, snapshot: snap });
  assert.equal(lv.status, 409); assert.equal(lv.body.error, 'not_available');
});

test('save: too long is refused (never cut quietly); "相談はない" drops the questions; a new draft needs no version', async () => {
  const E = await setup(); await demoOn(E);
  await E.q(`insert into mr_stores(env, store_id, name, sort) values('demo','D8','別の店（デモ）',8)`);
  const save = (v, body) => E.api('gm', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D8', expect_version: v, body });
  assert.equal((await save(3, okBody())).status, 409);                                       // a "new" draft with a version
  const long = await save(null, { ...okBody(), kpi: { fc: { comment: 'あ'.repeat(401) } } });
  assert.equal(long.status, 400); assert.equal((await E.q(`select count(*)::int n from mr_reviews where store_id='D8'`))[0].n, 0);
  assert.equal((await save(null, { ...okBody(), kpi: { fc: { comment: 'あ'.repeat(400) } } })).status, 200);
  await save(1, { ...okBody({ consult: 'none' }), issues: [{ id: 'i1', what: 'hidden', cause: 'c', action: 'a', severity: 'high', urgent: true }] });
  const b = (await E.q(`select body from mr_reviews where store_id='D8'`))[0].body;
  assert.deepEqual(b.issues, []); assert.equal(b.consult, 'none');
});

test('managers see only what was submitted: a draft gives the list nothing, a live draft is not sent to the page', async () => {
  const E = await setup(); await demoOn(E);
  const r = (await E.q(`select version, body from mr_reviews where store_id='D6'`))[0];
  await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: r.version,
    body: { ...okBody({ consult: 'yes' }), focus: r.body.focus.map(f => ({ ...f, status: 'late', reason: 'x' })), issues: [{ id: 'i1', what: 'draft only', severity: 'high', urgent: true, direct: true, cause: 'c', action: 'a' }] } });
  const l = (await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D6');
  assert.deepEqual([l.issues, l.urgent, l.direct, l.severity, l.consult_state, JSON.stringify(l.focus)], [0, false, false, null, null, '{}']);
  // Live (later, after store publication): the page gets the submitted version, not the working copy.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  await E.q(`insert into mr_reviews(env, store_id, ym, status, body) values('live','F01','2026-10','draft','{"reporter":"店長 A","consult":"yes","issues":[{"id":"i1","what":"secret draft"}]}')`);
  const g = (await E.api('am1', { action: 'get', env: 'live', ym: '2026-10', store_id: 'F01' })).body;
  assert.deepEqual(g.review.body, { reporter: '店長 A' });
});

test('store scope also holds for writing (checked with store publication switched on by hand, as a later edition would)', async () => {
  const E = await setup(); await demoOn(E);
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }, { store_id: 'F05', name: 'Marujuu', am_user: U.am2 }] });
  await E.q(`update mr_settings set value = jsonb_set(value, '{store_publish}', 'true') where key='flags'`);
  const w = (who, st) => E.api(who, { action: 'save', env: 'live', ym: '2026-10', store_id: st, expect_version: null, body: okBody() });
  assert.equal((await w('am2', 'F01')).status, 404);
  assert.equal((await w('am1', 'F05')).status, 404);
  assert.equal((await w('am1', 'F01')).status, 200);
  const sn = { period: { from: '2026-10-01', to: '2026-10-17' }, kpi: {}, pl: { ym: '2026-09', state: 'none', rows: {}, checked: [] } };
  assert.equal((await E.api('am2', { action: 'submit', env: 'live', ym: '2026-10', store_id: 'F01', expect_version: 1, snapshot: sn })).status, 404);
  assert.equal((await E.api('am1', { action: 'submit', env: 'live', ym: '2026-10', store_id: 'F01', expect_version: 1, snapshot: sn })).status, 200);
});

// ---------------------------------------------------------------- 段階 2-3: replies, decisions, completion
const R = (E, who, st, extra) => E.api(who, { env: 'demo', ym: '2026-10', store_id: st, ...extra });
const act = (o = {}) => ({ next: '配置表を作り直す', owner: '田中', due: '2026-10-20', next_check: '10/26 にランチの平均提供時間', ...o });
const saveR = async (E, who, st, target, decision, data = {}, escalate_to) => {
  const g = (await R(E, who, st, { action: 'get' })).body;
  const mine = (g.replies || []).find(x => x.mine && x.state === 'draft' && x.target === target);
  return R(E, who, st, { action: 'reply_save', target, decision, escalate_to, data, expect_version: mine ? mine.version : null, expect_no: g.review ? g.review.submitted_no : null });
};
// Send this person's drafts, looking at the latest submitted version.
// The drafts of this person as the screen shows them (id and version).
const shownDrafts = g => (g.replies || []).filter(x => x.mine && x.state === 'draft').map(x => ({ id: x.id, version: x.version }));
const send = async (E, who, st) => { const g = (await R(E, who, st, { action: 'get' })).body; return R(E, who, st, { action: 'reply_send', expect_no: g.review.submitted_no, drafts: shownDrafts(g) }); };
const status = async (E, st) => (await E.q(`select status, decision_by, next_actor, next_due::text d from mr_reviews where env='demo' and store_id=$1`, [st]))[0];

test('replies: the AM answers every item at once; an escalation waits for the GM; the GM decides; then the review can be completed', async () => {
  const E = await setup(); await demoOn(E);
  assert.equal((await saveR(E, 'am1', 'D1', 'pl', 'as_proposed', act())).status, 200);
  assert.equal((await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act({ next: '週の売上を見る' }))).status, 200);
  assert.equal((await saveR(E, 'am1', 'D1', 'focus:f1', 'modify', act({ owner: '' }))).status, 200);          // owner missing
  assert.equal((await saveR(E, 'am1', 'D1', 'issue:i1', 'escalate', { title: '米の業者の切り替え', reason: '駅前も同じ（店舗をまたぐ）', due: '2026-10-23' }, 'gm')).status, 200);
  assert.equal((await saveR(E, 'am1', 'D1', 'summary', null, { message: '報告ありがとう。米の件は GM に上げました。' })).status, 200);
  // Something incomplete: nothing is sent.
  const bad = await send(E, 'am1', 'D1'); assert.equal(bad.status, 422);
  assert.equal((await E.q(`select count(*)::int n from mr_replies p join mr_reviews r on r.id=p.review_id where r.store_id='D1' and p.state='sent'`))[0].n, 0);
  assert.equal((await saveR(E, 'am1', 'D1', 'focus:f1', 'modify', act())).status, 200);
  const ok = await send(E, 'am1', 'D1'); assert.equal(ok.status, 200); assert.equal(ok.body.sent, 5);
  assert.deepEqual(await status(E, 'D1'), { status: 'decision', decision_by: 'gm', next_actor: 'GM', d: '2026-10-23' });
  const w = (await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D1').waits;
  assert.deepEqual(w.map(x => [x.kind, x.to, x.title]), [['escalate', 'gm', '米の業者の切り替え']]);
  // Not complete while it waits for the GM; an AM cannot decide a GM item (nothing is sent).
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 422);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'as_proposed', act());
  assert.equal((await send(E, 'am1', 'D1')).status, 422);
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_delete', target: 'issue:i1' })).body.deleted, 1);
  assert.equal((await status(E, 'D1')).status, 'decision');
  // The GM decides.
  await saveR(E, 'gm', 'D1', 'issue:i1', 'modify', act({ next: '2 社の見積りを 10/22 までに（佐藤）', owner: '佐藤' }));
  assert.equal((await send(E, 'gm', 'D1')).status, 200);
  assert.equal((await status(E, 'D1')).status, 'submitted');
  const g = (await R(E, 'gm', 'D1', { action: 'get' })).body;
  assert.deepEqual(g.review.required, ['issue:i1', 'focus:f1', 'kpi', 'pl']); assert.equal(Object.values(g.review.final).every(Boolean), true);
  const done = await R(E, 'am1', 'D1', { action: 'complete' }); assert.equal(done.status, 200);
  assert.equal((await status(E, 'D1')).status, 'done');
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).body.error, 'locked');
  assert.equal((await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act())).body.error, 'locked');
  // The actions stay until their result is recorded (review done ≠ task done).
  const a = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.target === 'focus:f1' && x.state === 'sent');
  assert.equal((await R(E, 'gm', 'D1', { action: 'result_save', reply_id: a.id, result: '平均 8.2 分（10/26）', done: false })).status, 200);
  const esc = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'escalate');
  assert.equal((await R(E, 'gm', 'D1', { action: 'result_save', reply_id: esc.id, result: 'x', done: true })).status, 404);
  const ev = await E.q(`select kind from mr_events e join mr_reviews r on r.id=e.review_id where r.store_id='D1' order by e.id`);
  assert.deepEqual(ev.map(x => x.kind), ['reply', 'reply', 'done', 'result']);
});

test('replies: a CEO item waits for the CEO (a GM cannot close it); GM and CEO items together are "GM・CEO"; who may escalate where', async () => {
  const E = await setup(); await demoOn(E);
  assert.deepEqual(await status(E, 'D3'), { status: 'decision', decision_by: 'both', next_actor: 'GM 山本（デモ）', d: '2026-10-19' });
  await saveR(E, 'gm', 'D3', 'issue:i2', 'as_proposed', act());                                            // a GM cannot decide the CEO item
  assert.equal((await send(E, 'gm', 'D3')).status, 422);
  await R(E, 'gm', 'D3', { action: 'reply_delete', target: 'issue:i2' });
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act({ next: '11/15 まで火・金の夜に港町から 1 名', owner: '佐藤' }));
  await send(E, 'gm', 'D3');
  assert.deepEqual(await status(E, 'D3'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-22' });
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'modify', act({ next: '1 か月だけ月 $600。応募数を 11/15 に見る', owner: '鈴木' }));
  await send(E, 'ceo', 'D3');
  assert.equal((await status(E, 'D3')).status, 'submitted');
  assert.equal((await R(E, 'am1', 'D3', { action: 'complete' })).status, 422);                               // focus, KPI and PL still need a decision
  for (const t of ['focus:f1', 'focus:f2', 'kpi', 'pl']) await saveR(E, 'am1', 'D3', t, 'as_proposed', act());
  await send(E, 'am1', 'D3');
  assert.equal((await R(E, 'am1', 'D3', { action: 'complete' })).status, 200);
  // Escalating: an AM may go to GM or CEO, a GM only to CEO, a CEO decides.
  await saveR(E, 'ceo', 'D1', 'kpi', 'escalate', { title: 't', reason: 'r', recommend: 'x', due: '2026-10-20' }, 'gm');
  assert.equal((await send(E, 'ceo', 'D1')).status, 422);
  await R(E, 'ceo', 'D1', { action: 'reply_delete', target: 'kpi' });
  await saveR(E, 'gm', 'D1', 'kpi', 'escalate', { title: 't', reason: 'r', due: '2026-10-20' }, 'gm');
  assert.equal((await send(E, 'gm', 'D1')).status, 422);
  // To the CEO: the question, a recommendation and an answer-by date are all needed.
  await saveR(E, 'gm', 'D1', 'kpi', 'escalate', { title: 't', reason: 'r', due: '2026-10-20' }, 'ceo');
  assert.equal((await send(E, 'gm', 'D1')).status, 422);
  await saveR(E, 'gm', 'D1', 'kpi', 'escalate', { title: 't', recommend: 'x', due: '2026-10-20' }, 'ceo');
  assert.equal((await send(E, 'gm', 'D1')).status, 200);
  assert.equal((await status(E, 'D1')).decision_by, 'ceo');
});

test('replies: follow-up questions go back to the store manager together; a 1:1 talk is recorded and closed only by a decision after it', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'followup', { title: '米の値上げはいつから何 %？', question: '業者からの通知を見せて', due: '2026-10-19' });
  await saveR(E, 'am1', 'D1', 'focus:f1', 'followup', { title: '研修の予定', question: '新人 2 名の研修はいつ終わる？', due: '2026-10-20' });
  await send(E, 'am1', 'D1');
  assert.deepEqual(await status(E, 'D1'), { status: 'followup', decision_by: null, next_actor: '店長 田中（デモ）', d: '2026-10-20' });
  // 1:1 talk on 公園通り: needs the date, time, people and what to decide.
  await saveR(E, 'am2', 'D5', 'summary', 'consult', { consult: { date: '2026-10-21', time: '15:00', people: ['店長 Garcia'], topics: [] } });
  assert.equal((await send(E, 'am2', 'D5')).status, 422);
  await R(E, 'am2', 'D5', { action: 'reply_delete', target: 'summary' });
  await saveR(E, 'am2', 'D5', 'issue:i1', 'consult', { title: '夜のリーダー', consult: { date: '2026-10-22', time: '16:00', minutes: 20, people: ['店長 Garcia', 'AM Lee'], topics: ['夜のリーダーを誰にするか'] } });
  await send(E, 'am2', 'D5');
  const c = (await E.q(`select status, consult, next_due::text d from mr_reviews where store_id='D5'`))[0];
  assert.equal(c.status, 'consult'); assert.equal(c.consult.time, '16:00'); assert.equal(c.d, '2026-10-22');
  // After the talk: the decision closes it.
  await saveR(E, 'am2', 'D5', 'issue:i1', 'modify', act({ next: '原田さんを夜のリーダーに（11/1 から）', owner: 'Garcia' }));
  await send(E, 'am2', 'D5');
  assert.equal((await status(E, 'D5')).status, 'submitted');
});

test('replies: drafts are per person and versioned; only items of the submitted version; locked before submission; scope and roles', async () => {
  const E = await setup(); await demoOn(E);
  const a = await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act());
  assert.equal(a.body.version, 1);
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_save', target: 'kpi', decision: 'modify', data: act(), expect_version: null, expect_no: 1 })).status, 409);
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_save', target: 'kpi', decision: 'modify', data: act(), expect_version: 1, expect_no: 1 })).body.version, 2);
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_save', target: 'kpi', decision: 'modify', data: act(), expect_version: 1, expect_no: 1 })).status, 409);
  assert.equal((await saveR(E, 'gm', 'D1', 'kpi', 'as_proposed', act())).body.version, 1);                       // the GM's own draft
  for (const t of ['issue:i9', 'focus:zz', 'other']) assert.equal((await saveR(E, 'am1', 'D1', t, 'as_proposed', act())).status, 400, t);
  assert.equal((await saveR(E, 'am1', 'D6', 'summary', null, { message: 'x' })).body.error, 'locked');           // draft review
  assert.equal((await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act({ next: 'あ'.repeat(301) }))).status, 400);    // too long: refused
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  assert.equal((await send(E, 'am1', 'D1')).body.error, 'nothing');                     // nothing left to send
  for (const who of ['office', 'stranger']) assert.equal((await saveR(E, who, 'D1', 'kpi', 'as_proposed', act())).status, 403);
  // Live: an AM cannot answer another AM's store.
  await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1 }] });
  const id = (await E.q(`insert into mr_reviews(env, store_id, ym, status, submitted_no, body) values('live','F01','2026-10','submitted',1,'{"consult":"none"}') returning id`))[0].id;
  await E.q(`insert into mr_submissions(review_id, no, body, snapshot) values($1, 1, '{"consult":"none"}', '{}')`, [id]);
  const lv = (who) => E.api(who, { action: 'reply_save', env: 'live', ym: '2026-10', store_id: 'F01', target: 'summary', decision: 'no_action', data: { reason: 'ok' }, expect_no: 1 });
  assert.equal((await lv('am2')).status, 404); assert.equal((await lv('am1')).status, 200);
});

test('deadlines: GM / CEO change one review’s dates (in order); a date moved after it passed keeps the delay on record', async () => {
  const E = await setup(); await demoOn(E);
  const dl = { submit: '2026-10-15', reply: '2026-10-20', decide: '2026-10-22', consult_from: '2026-10-23', consult_to: '2026-10-24' };
  assert.equal((await R(E, 'am1', 'D1', { action: 'deadline_save', deadlines: dl })).status, 403);
  assert.equal((await R(E, 'gm', 'D1', { action: 'deadline_save', deadlines: { ...dl, reply: '2026-10-14' } })).status, 400);
  assert.equal((await R(E, 'gm', 'D1', { action: 'deadline_save', deadlines: dl })).status, 200);
  const r = (await E.q(`select deadlines, next_due::text d from mr_reviews where store_id='D1'`))[0];
  assert.equal(r.deadlines.reply, '2026-10-20'); assert.equal(r.d, '2026-10-20');
  const ev = (await E.q(`select data from mr_events e join mr_reviews x on x.id=e.review_id where x.store_id='D1' and kind='deadline'`))[0].data;
  assert.equal(ev.late_days, 1); assert.equal(ev.old.reply, '2026-10-17');                                       // the demo's today is 10/18
  assert.equal((await R(E, 'ceo', 'D2', { action: 'deadline_save', deadlines: dl })).body.error, 'locked');        // done
});

// The store manager sends a new version (demo): today's demo numbers judged as last time, the body changed by `edit`.
const resubmit = async (E, st, who, edit, judge = {}) => {
  const g = (await R(E, who, st, { action: 'get' })).body;
  const last = g.submissions[g.submissions.length - 1].snapshot;
  const sv = await R(E, who, st, { action: 'save', expect_version: g.review.version, body: edit(JSON.parse(JSON.stringify(g.review.body))) });
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  const sn = await demoSnap(E, st, { ...Object.fromEntries(Object.entries(last.kpi).map(([k, v]) => [k, v.judge])), ...judge });
  const r = await R(E, who, st, { action: 'submit', expect_version: sv.body.version, snapshot: sn });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
};

test('a decision counts for what it decided: an item changed in a new version needs a new decision; unchanged items keep theirs', async () => {
  const E = await setup(); await demoOn(E);
  for (const t of ['pl', 'kpi', 'focus:f1', 'issue:i1']) assert.equal((await saveR(E, 'am1', 'D1', t, 'as_proposed', act())).status, 200, t);
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  assert.deepEqual(await status(E, 'D1'), { status: 'submitted', decision_by: null, next_actor: 'AM 佐藤（デモ）', d: '2026-10-19' });   // after a reply: the decision date
  // The store manager raises the ask afterwards (version 2).
  assert.equal((await resubmit(E, 'D1', 'gm', b => { b.issues[0].ask = '本部で米の業者を比べて、月 $6,000 まで出してほしい'; return b; })).status, 200);
  const g = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  assert.deepEqual(g.review.final, { 'issue:i1': false, 'focus:f1': true, kpi: true, pl: true });
  const old = g.replies.find(x => x.target === 'issue:i1' && x.state === 'sent');
  assert.deepEqual([old.sub_no, old.changed], [1, true]);
  assert.deepEqual([g.replies.find(x => x.target === 'kpi').changed, g.replies.find(x => x.target === 'focus:f1').changed], [false, false]);
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 422);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'modify', act({ next: '$6,000 は出さない。2 社の見積りで決める' }));
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 200);
});

test('an item the store manager removes: what waited on it is withdrawn, a draft on it has to be deleted, nothing gets stuck', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'focus:f1', 'followup', { question: '研修はいつ終わる？', due: '2026-10-20' });
  await saveR(E, 'am1', 'D1', 'issue:i1', 'escalate', { title: '米の業者', reason: '店舗をまたぐ', due: '2026-10-23' }, 'gm');
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  assert.equal((await status(E, 'D1')).status, 'followup');
  await saveR(E, 'gm', 'D1', 'issue:i1', 'as_proposed', act());                                          // the GM's draft, not sent yet
  const fq = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'followup');
  // The store manager answers and withdraws the question (相談はない).
  assert.equal((await resubmit(E, 'D1', 'am1', b => ({ ...b, consult: 'none', issues: [], answers: { [fq.id]: '11/1 に終わる' } }))).status, 200);
  assert.equal((await status(E, 'D1')).status, 'submitted');                                             // not 判断待ち on something gone
  const g = (await R(E, 'gm', 'D1', { action: 'get' })).body;
  const esc = g.replies.find(x => x.decision === 'escalate');
  assert.deepEqual([esc.data.resolved, esc.data.withdrawn_no, esc.gone], [true, 2, true]);
  assert.deepEqual(g.review.required, ['focus:f1', 'kpi', 'pl']);
  assert.equal(g.replies.find(x => x.state === 'draft' && x.target === 'issue:i1').gone, true);
  assert.equal((await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D1').waits.length, 0);
  // The GM's draft on the removed question: sending is refused until it is deleted; no new draft on it.
  assert.equal((await send(E, 'gm', 'D1')).status, 422);
  assert.equal((await R(E, 'gm', 'D1', { action: 'reply_delete', target: 'issue:i1' })).body.deleted, 1);
  assert.equal((await saveR(E, 'gm', 'D1', 'issue:i1', 'as_proposed', act())).status, 400);
  for (const t of ['focus:f1', 'kpi', 'pl']) await saveR(E, 'am1', 'D1', t, 'as_proposed', act());
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 200);
});

test('an item waiting for the GM / CEO is theirs; a GM can pass a GM item on to the CEO; a follow-up elsewhere still blocks completion', async () => {
  const E = await setup(); await demoOn(E);
  assert.ok((await R(E, 'gm', 'D3', { action: 'get' })).body.review.required.includes('focus:f1'));       // a focus item that needs help
  await saveR(E, 'am1', 'D3', 'issue:i1', 'no_action', { reason: '様子を見る' });
  assert.equal((await send(E, 'am1', 'D3')).status, 422);                           // an AM on a GM item
  await R(E, 'am1', 'D3', { action: 'reply_delete', target: 'issue:i1' });
  await saveR(E, 'gm', 'D3', 'issue:i1', 'escalate', { title: '応援と残業の上限', recommend: '11/15 まで週 2 回', due: '2026-10-21' }, 'ceo');
  assert.equal((await send(E, 'gm', 'D3')).status, 200);
  assert.deepEqual(await status(E, 'D3'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-21' });
  const fw = (await R(E, 'gm', 'D3', { action: 'get' })).body.replies.find(x => x.decision === 'escalate' && x.escalate_to === 'gm');
  assert.deepEqual([fw.data.resolved, fw.data.forwarded], [true, 'ceo']);
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act());
  assert.equal((await send(E, 'gm', 'D3')).status, 422);                            // now a CEO item
  await R(E, 'gm', 'D3', { action: 'reply_delete', target: 'issue:i1' });
  for (const t of ['issue:i1', 'issue:i2']) await saveR(E, 'ceo', 'D3', t, 'as_proposed', act());
  assert.equal((await send(E, 'ceo', 'D3')).status, 200);
  assert.equal((await status(E, 'D3')).status, 'submitted');
  // The other items decided, and one more question on an item that needs none: not done while it is open.
  for (const t of ['focus:f1', 'focus:f2', 'kpi', 'pl']) await saveR(E, 'am1', 'D3', t, 'as_proposed', act());
  await send(E, 'am1', 'D3');
  assert.equal((await R(E, 'am1', 'D3', { action: 'get' })).body.review.required.includes('focus:f3'), false);   // 順調: needs no decision
  await saveR(E, 'am1', 'D3', 'focus:f3', 'followup', { question: '記録はどこに？', due: '2026-10-21' });
  await send(E, 'am1', 'D3');
  assert.equal((await status(E, 'D3')).status, 'followup');
  assert.equal((await R(E, 'am1', 'D3', { action: 'complete' })).status, 422);
  // Someone else's draft is not theirs to delete.
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act());
  assert.equal((await R(E, 'gm', 'D1', { action: 'reply_delete', target: 'kpi' })).body.deleted, 0);
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.replies.filter(x => x.state === 'draft').length, 1);
});

test('a reply, a date change or completion does not make the store manager’s next save a conflict', async () => {
  const E = await setup(); await demoOn(E);
  const v = (await R(E, 'gm', 'D1', { action: 'get' })).body.review.version;
  await saveR(E, 'am1', 'D1', 'summary', null, { message: '読みました。返信はこのあと。' }); await send(E, 'am1', 'D1');
  await R(E, 'gm', 'D1', { action: 'deadline_save', deadlines: { submit: '2026-10-15', reply: '2026-10-20', decide: '2026-10-22', consult_from: '2026-10-23', consult_to: '2026-10-24' } });
  const body = (await R(E, 'gm', 'D1', { action: 'get' })).body.review.body;
  assert.equal((await R(E, 'gm', 'D1', { action: 'save', expect_version: v, body: { ...body, reporter: '店長 田中（デモ）' } })).status, 200);
});

test('blank and dates as the screen sees them: full-width spaces and line breaks are empty; 11/31 is not a date; a result needs text and the latest version', async () => {
  const E = await setup(); await demoOn(E);
  assert.deepEqual((await E.q(`select public.mr_blank(E'　\n\t ') a, public.mr_blank(' x ') b, public.mr_blank(null) c, public.mr_date_ok('2026-11-31') d, public.mr_date_ok('2026-02-28') e, public.mr_date_ok('2026-1-1') f`))[0],
    { a: true, b: false, c: true, d: false, e: true, f: false });
  await saveR(E, 'am1', 'D1', 'kpi', 'no_action', { reason: '　' });
  assert.equal((await send(E, 'am1', 'D1')).status, 422);
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act({ next: '\n', owner: '　' }));
  assert.equal((await send(E, 'am1', 'D1')).status, 422);
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act({ due: '2026-11-31' }));                          // dropped: no due date
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.state === 'draft').data.due, undefined);
  assert.equal((await send(E, 'am1', 'D1')).status, 422);
  const dl = { submit: '2026-10-15', reply: '2026-10-20', decide: '2026-11-31', consult_from: '2026-12-01', consult_to: '2026-12-02' };
  assert.equal((await R(E, 'gm', 'D1', { action: 'deadline_save', deadlines: dl })).status, 400);
  // Only the decision's own fields are kept (a question typed before switching to 提案どおり is not).
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act({ question: '前に書いた質問', reason: 'r', title: 't' }));
  assert.deepEqual(Object.keys((await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.state === 'draft').data).sort(), ['due', 'next', 'next_check', 'owner']);
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  const a = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.state === 'sent');
  assert.equal((await R(E, 'gm', 'D1', { action: 'result_save', reply_id: a.id, result: '　\n', done: false })).status, 400);
  assert.equal((await R(E, 'gm', 'D1', { action: 'result_save', reply_id: a.id, result: '週の売上を見た', done: false })).status, 200);
  assert.equal((await R(E, 'am1', 'D1', { action: 'result_save', reply_id: a.id, result: '前の画面から', done: true })).status, 409);   // saved over the GM's result
  const at = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.id === a.id).data.result_at;
  assert.equal((await R(E, 'am1', 'D1', { action: 'result_save', reply_id: a.id, result: '確かめた', done: true, expect_at: at })).status, 200);
  // A follow-up or a word is not an action: no result on it.
  await saveR(E, 'am1', 'D1', 'summary', null, { message: 'ありがとう' }); await send(E, 'am1', 'D1');
  const w = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.target === 'summary');
  assert.equal((await R(E, 'gm', 'D1', { action: 'result_save', reply_id: w.id, result: 'x', done: true })).status, 404);
});

test('dates after replies: moving the 1:1 window keeps the decision date; a 1:1 talk planned again replaces the first; it clears once decided', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act()); await send(E, 'gm', 'D3');
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'as_proposed', act()); await send(E, 'ceo', 'D3');
  assert.deepEqual(await status(E, 'D3'), { status: 'submitted', decision_by: null, next_actor: 'AM 佐藤（デモ）', d: '2026-10-19' });
  const dl = (await E.q(`select deadlines from mr_reviews where store_id='D3'`))[0].deadlines;
  assert.equal((await R(E, 'gm', 'D3', { action: 'deadline_save', deadlines: { ...dl, consult_to: '2026-10-25' } })).status, 200);
  assert.equal((await status(E, 'D3')).d, '2026-10-19');                                                  // not back to the reply date
  // D5: the AM decides first, then plans a talk on the same item: not decided until a decision after it.
  await saveR(E, 'am2', 'D5', 'issue:i1', 'consult', { consult: { date: '2026-10-23', time: '10:00', people: ['店長 Garcia'], topics: ['夜のリーダー'] } });
  await send(E, 'am2', 'D5');
  let g = (await R(E, 'am2', 'D5', { action: 'get' })).body;
  assert.equal(g.replies.filter(x => x.decision === 'consult' && !x.data.resolved).length, 1);
  assert.equal(g.replies.find(x => x.decision === 'consult' && x.data.replaced).data.resolved, true);
  assert.equal(g.review.consult.date, '2026-10-23'); assert.equal((await status(E, 'D5')).d, '2026-10-23');
  await saveR(E, 'am2', 'D5', 'issue:i1', 'modify', act()); await send(E, 'am2', 'D5');
  g = (await R(E, 'am2', 'D5', { action: 'get' })).body;
  assert.equal(g.review.status, 'submitted'); assert.equal(g.review.consult, null); assert.equal(g.review.final['issue:i1'], true);
  await saveR(E, 'am2', 'D5', 'issue:i1', 'consult', { consult: { date: '2026-10-24', time: '10:00', people: ['店長 Garcia'], topics: ['締め作業'] } });
  await send(E, 'am2', 'D5');
  g = (await R(E, 'am2', 'D5', { action: 'get' })).body;
  assert.equal(g.review.status, 'consult'); assert.equal(g.review.final['issue:i1'], false);              // the talk alone does not decide
  assert.equal((await R(E, 'am2', 'D5', { action: 'complete' })).status, 422);
});

test('a store with nothing to decide is completed with a reason; the list shows it', async () => {
  const E = await setup(); await demoOn(E);
  const r = (await E.q(`select version, body from mr_reviews where store_id='D6'`))[0];
  const v = (await E.api('am1', { action: 'save', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: r.version, body: { ...okBody(), focus: r.body.focus.map(f => ({ ...f, status: 'ok' })) } })).body.version;
  assert.equal((await E.api('am1', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: v, snapshot: await demoSnap(E, 'D6') })).status, 200);
  assert.deepEqual((await R(E, 'gm', 'D6', { action: 'get' })).body.review.required, ['summary']);
  assert.equal((await R(E, 'gm', 'D6', { action: 'complete' })).status, 422);
  await saveR(E, 'gm', 'D6', 'summary', 'no_action', { reason: '全項目が目標どおり。相談なし。' });
  await send(E, 'gm', 'D6');
  assert.equal((await R(E, 'gm', 'D6', { action: 'complete' })).status, 200);
  const l = (await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D6');
  assert.equal(l.status, 'done'); assert.equal(l.done_reason, '全項目が目標どおり。相談なし。');
});

test('what needs a decision: PL rows checked at the start of the month do not; an escalation target is kept only for an escalation; a 1:1 talk has at most 6 people and 2 topics', async () => {
  const E = await setup(); await demoOn(E);
  const id = (await E.q(`select id from mr_reviews where store_id='D2'`))[0].id;
  const req = async (rows, checked) => {
    await E.q(`update mr_submissions set snapshot = $2::jsonb where review_id = $1`, [id, JSON.stringify({ kpi: {}, pl: { rows, checked } })]);
    return (await E.q(`select public.mr_required_targets(r) t from mr_reviews r where id = $1`, [id]))[0].t;
  };
  assert.deepEqual(await req({ sales: { judge: 'warn' } }, ['sales']), ['summary']);
  assert.deepEqual(await req({ sales: { judge: 'warn' } }, []), ['pl']);
  assert.deepEqual(await req({ sales: { judge: 'ok' }, fc: { judge: 'miss' } }, ['sales']), ['pl']);
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act(), 'ceo');
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.state === 'draft').escalate_to, null);
  const c = n => ({ consult: { date: '2026-10-22', time: '10:00', people: Array.from({ length: n }, (_, i) => 'P' + i), topics: ['a'] } });
  assert.equal((await saveR(E, 'am1', 'D1', 'issue:i1', 'consult', c(7))).status, 400);
  assert.equal((await saveR(E, 'am1', 'D1', 'issue:i1', 'consult', c(6))).status, 200);
  assert.equal((await saveR(E, 'am1', 'D1', 'issue:i1', 'consult', { consult: { ...c(1).consult, topics: ['a', 'b', 'c'] } })).status, 400);
});

test('replies are written and sent on the version shown: a newer version is refused; a draft on an item changed since is checked and saved again', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'as_proposed', act());            // on version 1
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act());
  await resubmit(E, 'D1', 'gm', b => { b.issues[0].ask = '本部で米の業者を比べて、月 $6,000 まで出してほしい'; return b; });
  // The page still shows version 1.
  const old = await R(E, 'am1', 'D1', { action: 'reply_send', expect_no: 1, drafts: shownDrafts((await R(E, 'am1', 'D1', { action: 'get' })).body) }); assert.deepEqual([old.status, old.body.error], [409, 'new_version']);
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_save', target: 'pl', decision: 'as_proposed', data: act(), expect_no: 1 })).body.error, 'new_version');
  assert.equal((await R(E, 'am1', 'D1', { action: 'reply_send' })).body.error, 'new_version');      // the version is required
  // Loaded again: the draft on the changed question is marked; the KPI draft is not (unchanged).
  const g = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  const dr = t => g.replies.find(x => x.state === 'draft' && x.target === t);
  assert.deepEqual([dr('issue:i1').sub_no, dr('issue:i1').changed, dr('kpi').changed], [1, true, false]);
  assert.equal((await send(E, 'am1', 'D1')).status, 422);                                              // stale: look again first
  await saveR(E, 'am1', 'D1', 'issue:i1', 'modify', act({ next: '$6,000 は出さない。2 社の見積りで決める' }));
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  const s2 = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.filter(x => x.state === 'sent');
  assert.deepEqual(s2.map(x => [x.target, x.sub_no, x.changed]).sort(), [['issue:i1', 2, false], ['kpi', 2, false]]);
});

test('a decision made before the answer to a question on the same item does not count; KPI / PL decisions keep through changes that need no decision', async () => {
  const E = await setup(); await demoOn(E);
  for (const t of ['pl', 'kpi', 'focus:f1', 'issue:i1']) await saveR(E, 'am1', 'D1', t, 'as_proposed', act());
  await send(E, 'am1', 'D1');
  await saveR(E, 'gm', 'D1', 'kpi', 'followup', { question: '原価率はどこまで上がる？', due: '2026-10-20' });
  await send(E, 'gm', 'D1');
  const q = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'followup');
  // Answered (v2) with the KPI text unchanged; sales 注意 → 達成 and an empty entry for 客単価 change nothing that needs a decision.
  await resubmit(E, 'D1', 'gm', b => ({ ...b, kpi: { ...b.kpi, ppa: { tags: [], comment: '' } }, pl: { ...b.pl, labor: { cause: '', plan: '' } }, answers: { [q.id]: '40% まで上がるかもしれない' } }), { sales: 'ok' });
  let g = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  assert.deepEqual(g.review.final, { 'issue:i1': true, 'focus:f1': true, kpi: false, pl: true });        // the KPI waits for a decision after the answer
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 422);
  await saveR(E, 'gm', 'D1', 'kpi', 'modify', act({ next: '仕入先を替える（10/24）' })); await send(E, 'gm', 'D1');
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.review.final.kpi, true);
  // A new 未達 is a change that needs a decision.
  await resubmit(E, 'D1', 'gm', b => ({ ...b, kpi: { ...b.kpi, drink: { tags: [], comment: 'サワーが遅れた' } } }), { drink: 'miss' });
  g = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  assert.equal(g.review.final.kpi, false); assert.equal(g.review.final.pl, true);
});

test('an item sent up stays with the GM / CEO when it changes later (an AM cannot decide it); a withdrawn one does not', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'as_proposed', act()); await send(E, 'ceo', 'D3');
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act()); await send(E, 'gm', 'D3');
  for (const t of ['focus:f1', 'focus:f2', 'kpi', 'pl']) await saveR(E, 'am1', 'D3', t, 'as_proposed', act());
  await send(E, 'am1', 'D3');
  assert.equal((await status(E, 'D3')).status, 'submitted');
  await resubmit(E, 'D3', 'gm', b => { b.issues[1].ask = '追加の求人広告費 月 $900 を 3 か月出してよいか'; return b; });
  assert.equal((await R(E, 'am1', 'D3', { action: 'get' })).body.review.final['issue:i2'], false);
  // It waits for the CEO again (not for the AM, who cannot decide it).
  assert.deepEqual(await status(E, 'D3'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-22' });
  const w = (await E.api('ceo', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D3').waits;
  assert.deepEqual(w.map(x => [x.kind, x.to]), [['escalate', 'ceo']]);
  assert.equal((await R(E, 'ceo', 'D3', { action: 'get' })).body.replies.find(x => x.decision === 'escalate' && x.escalate_to === 'ceo').data.reopened_no, 2);
  await saveR(E, 'am1', 'D3', 'issue:i2', 'as_proposed', act());
  assert.equal((await send(E, 'am1', 'D3')).status, 422);                                               // still the CEO's
  await R(E, 'am1', 'D3', { action: 'reply_delete', target: 'issue:i2' });
  await saveR(E, 'gm', 'D3', 'issue:i2', 'modify', act()); assert.equal((await send(E, 'gm', 'D3')).status, 422);
  await R(E, 'gm', 'D3', { action: 'reply_delete', target: 'issue:i2' });
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'modify', act({ next: '月 $600 を 2 か月まで' })); assert.equal((await send(E, 'ceo', 'D3')).status, 200);
  assert.equal((await R(E, 'am1', 'D3', { action: 'complete' })).status, 200);
});

test('after an answer: a CEO item waits for the CEO again; a draft written before the answer is checked again; what changed since a version', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'as_proposed', act()); await send(E, 'ceo', 'D3');
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act()); await send(E, 'gm', 'D3');
  await saveR(E, 'am1', 'D3', 'kpi', 'as_proposed', act());                                              // a draft on version 1
  await saveR(E, 'gm', 'D3', 'issue:i2', 'followup', { question: '応募は何件？', due: '2026-10-21' });
  await saveR(E, 'gm', 'D3', 'kpi', 'followup', { question: '人件費はいつ下がる？', due: '2026-10-21' }); await send(E, 'gm', 'D3');
  assert.equal((await status(E, 'D3')).status, 'followup');
  const qs = (await R(E, 'gm', 'D3', { action: 'get' })).body.replies.filter(x => x.decision === 'followup');
  await resubmit(E, 'D3', 'gm', b => ({ ...b, answers: Object.fromEntries(qs.map(q => [q.id, '回答'])) }));
  assert.deepEqual(await status(E, 'D3'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-22' });
  const g = (await R(E, 'am1', 'D3', { action: 'get', since: 1 })).body;
  assert.equal(g.replies.find(x => x.state === 'draft' && x.target === 'kpi').changed, true);
  assert.deepEqual(g.changed_since.sort(), ['issue:i2', 'kpi']);                                         // answered (the text is unchanged)
  assert.equal((await send(E, 'am1', 'D3')).status, 422);                                                 // stale until saved again
  await saveR(E, 'am1', 'D3', 'kpi', 'as_proposed', act()); assert.equal((await send(E, 'am1', 'D3')).status, 200);
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'modify', act()); await send(E, 'ceo', 'D3');
  assert.equal((await status(E, 'D3')).status, 'submitted');
  assert.deepEqual((await R(E, 'am1', 'D3', { action: 'get', since: 2 })).body.changed_since, []);
  assert.deepEqual((await E.q(`select public.mr_date_ok('0026-10-20') a, public.mr_date_ok('2026-10-20') b`))[0], { a: false, b: true });
  await saveR(E, 'am1', 'D3', 'pl', 'as_proposed', act({ due: '0026-10-20' }));
  assert.equal((await R(E, 'am1', 'D3', { action: 'get' })).body.replies.find(x => x.state === 'draft' && x.target === 'pl').data.due, undefined);
});

test('a GM / CEO decision on an item later removed or no longer needing a decision is not reopened (the review can still finish)', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'as_proposed', act()); await send(E, 'ceo', 'D3');
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act()); await send(E, 'gm', 'D3');
  await saveR(E, 'am1', 'D3', 'focus:f2', 'escalate', { title: 'ランチの呼び込み', reason: '人を回せない', due: '2026-10-22' }, 'gm'); await send(E, 'am1', 'D3');
  await saveR(E, 'gm', 'D3', 'focus:f2', 'as_proposed', act()); await send(E, 'gm', 'D3');
  await saveR(E, 'am1', 'D3', 'focus:f2', 'followup', { question: 'チラシは何枚？', due: '2026-10-21' }); await send(E, 'am1', 'D3');
  const q = (await R(E, 'am1', 'D3', { action: 'get' })).body.replies.find(x => x.decision === 'followup');
  // Version 2: question 2 withdrawn, focus 2 now 順調 (needs no decision), the question answered.
  await resubmit(E, 'D3', 'gm', b => ({ ...b, issues: b.issues.filter(i => i.id !== 'i2'),
    focus: b.focus.map(f => f.id === 'f2' ? { ...f, status: 'ok', note: '呼び込みを再開' } : f), answers: { [q.id]: '500 枚' } }));
  const g = (await R(E, 'am1', 'D3', { action: 'get' })).body;
  assert.equal(g.replies.filter(x => x.decision === 'escalate' && x.data.reopened_no).length, 0);
  assert.equal((await status(E, 'D3')).status, 'submitted');
  for (const t of g.review.required.filter(t => !g.review.final[t])) await saveR(E, 'am1', 'D3', t, 'as_proposed', act());
  await send(E, 'am1', 'D3');
  assert.equal((await R(E, 'am1', 'D3', { action: 'complete' })).status, 200);
});

test('KPI / PL decisions: an empty entry or 注意 → 達成 changes nothing; a new 未達 on a KPI (same text) needs a decision again', async () => {
  const E = await setup(); await demoOn(E);
  for (const t of ['pl', 'kpi', 'focus:f1', 'issue:i1']) await saveR(E, 'am1', 'D1', t, 'as_proposed', act());
  await send(E, 'am1', 'D1');
  await saveR(E, 'am1', 'D1', 'focus:f2', 'followup', { question: '廃棄の記録は？', due: '2026-10-20' }); await send(E, 'am1', 'D1');
  let q = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'followup' && !x.data.resolved);
  await resubmit(E, 'D1', 'gm', b => ({ ...b, kpi: { ...b.kpi, ppa: { tags: [], comment: '' } }, pl: { ...b.pl, labor: { cause: '', plan: '' } }, answers: { [q.id]: '毎日' } }), { sales: 'ok', guests: 'ok' });
  assert.deepEqual((await R(E, 'am1', 'D1', { action: 'get' })).body.review.final, { 'issue:i1': true, 'focus:f1': true, kpi: true, pl: true });
  await saveR(E, 'am1', 'D1', 'focus:f2', 'followup', { question: 'もう一つ', due: '2026-10-20' }); await send(E, 'am1', 'D1');
  q = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'followup' && !x.data.resolved);
  await resubmit(E, 'D1', 'gm', b => ({ ...b, answers: { ...b.answers, [q.id]: 'はい' } }), { drink: 'miss' });   // drink already has a comment
  const g = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  assert.equal(g.review.final.kpi, false); assert.equal(g.review.final.pl, true);
});

test('at most 20 questions wait for the store manager; the working copy keeps answers only to open questions', async () => {
  const E = await setup(); await demoOn(E);
  const items = ['issue:i1', 'issue:i2', 'focus:f1', 'focus:f2', 'focus:f3', 'kpi', 'pl'];
  for (const who of ['am1', 'gm']) { for (const t of items) await saveR(E, who, 'D3', t, 'followup', { question: who + ' ' + t, due: '2026-10-21' }); assert.equal((await send(E, who, 'D3')).status, 200); }
  for (const t of items) await saveR(E, 'ceo', 'D3', t, 'followup', { question: 'ceo ' + t, due: '2026-10-21' });
  const tm = await send(E, 'ceo', 'D3'); assert.deepEqual([tm.status, tm.body.error], [409, 'too_many']);          // 21
  await R(E, 'ceo', 'D3', { action: 'reply_delete', target: 'pl' }); assert.equal((await send(E, 'ceo', 'D3')).status, 200);   // 20
  let g = (await R(E, 'am1', 'D3', { action: 'get' })).body;
  const open = g.replies.filter(x => x.decision === 'followup' && !x.data.resolved); assert.equal(open.length, 20);
  assert.equal((await resubmit(E, 'D3', 'gm', b => ({ ...b, answers: Object.fromEntries(open.map(q => [q.id, '回答 ' + q.data.question])) }))).status, 200);
  assert.equal((await R(E, 'am1', 'D3', { action: 'get' })).body.replies.filter(x => x.decision === 'followup' && !x.data.resolved).length, 0);
  // A second round: the old answers in the working copy do not crowd out the new one.
  await saveR(E, 'am1', 'D3', 'kpi', 'followup', { question: 'もう一つ', due: '2026-10-22' }); await send(E, 'am1', 'D3');
  g = (await R(E, 'gm', 'D3', { action: 'get' })).body;
  const q2 = g.replies.find(x => x.decision === 'followup' && !x.data.resolved);
  const sv = await R(E, 'gm', 'D3', { action: 'save', expect_version: g.review.version, body: { ...g.review.body, answers: { ...(g.review.body.answers || {}), [q2.id]: 'はい' } } });
  assert.equal(sv.status, 200);
  assert.deepEqual(Object.keys((await E.q(`select body from mr_reviews where store_id='D3'`))[0].body.answers), [q2.id]);
});

test('an item sent to both the GM and the CEO waits for the CEO only; a 1:1 talk on a CEO item says the CEO decides after it', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'kpi', 'escalate', { title: '原価', reason: 'r', due: '2026-10-21' }, 'gm'); await send(E, 'am1', 'D1');
  await saveR(E, 'am1', 'D1', 'kpi', 'escalate', { title: '原価', recommend: 'x', due: '2026-10-22' }, 'ceo'); await send(E, 'am1', 'D1');
  assert.deepEqual(await status(E, 'D1'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-21' });
  const w = (await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D1').waits;
  assert.deepEqual(w.map(x => [x.kind, x.to]), [['escalate', 'ceo']]);
  await saveR(E, 'gm', 'D1', 'kpi', 'as_proposed', act()); assert.equal((await send(E, 'gm', 'D1')).status, 422);
  // 駅前: both items decided; then the AM plans a talk on the CEO item.
  await saveR(E, 'ceo', 'D3', 'issue:i2', 'as_proposed', act()); await send(E, 'ceo', 'D3');
  await saveR(E, 'gm', 'D3', 'issue:i1', 'as_proposed', act()); await send(E, 'gm', 'D3');
  await saveR(E, 'am1', 'D3', 'issue:i2', 'consult', { consult: { date: '2026-10-23', time: '10:00', people: ['店長 鈴木'], topics: ['求人'] } }); await send(E, 'am1', 'D3');
  assert.deepEqual(await status(E, 'D3'), { status: 'consult', decision_by: null, next_actor: 'AM 佐藤（デモ）（判断は CEO）', d: '2026-10-23' });
  const w3 = (await E.api('ceo', { action: 'list', env: 'demo', ym: '2026-10' })).body.reviews.find(x => x.store_id === 'D3').waits;
  assert.deepEqual(w3.map(x => [x.kind, x.to]), [['consult', 'ceo']]);
});

test('an item at the CEO is decided by the CEO: an earlier AM decision that fits again does not count; it is not sent down to the GM', async () => {
  const E = await setup(); await demoOn(E);
  for (const t of ['pl', 'kpi', 'focus:f1', 'issue:i1']) await saveR(E, 'am1', 'D1', t, 'as_proposed', act());
  await send(E, 'am1', 'D1');
  const drink0 = (await R(E, 'gm', 'D1', { action: 'get' })).body.review.body.kpi.drink;
  await resubmit(E, 'D1', 'gm', b => ({ ...b, kpi: { ...b.kpi, drink: { ...drink0, comment: drink0.comment + '（遅れた）' } } }), { drink: 'miss' });   // v2: one more 未達
  await saveR(E, 'am1', 'D1', 'kpi', 'escalate', { title: 'ドリンク', recommend: '新メニューを前倒し', due: '2026-10-22' }, 'ceo'); await send(E, 'am1', 'D1');
  await saveR(E, 'ceo', 'D1', 'kpi', 'modify', act({ next: 'サワーを 10/15 に前倒し' })); await send(E, 'ceo', 'D1');
  assert.equal((await status(E, 'D1')).status, 'submitted');
  await resubmit(E, 'D1', 'gm', b => ({ ...b, kpi: { ...b.kpi, drink: drink0 } }), { drink: 'warn' });      // v3: KPIs back as in v1
  assert.deepEqual(await status(E, 'D1'), { status: 'decision', decision_by: 'ceo', next_actor: 'CEO', d: '2026-10-22' });
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.review.final.kpi, false);
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 422);
  await saveR(E, 'am1', 'D1', 'kpi', 'escalate', { title: 'ドリンク', reason: 'r', due: '2026-10-22' }, 'gm');
  assert.equal((await send(E, 'am1', 'D1')).status, 422);                                                 // not down to the GM
  await R(E, 'am1', 'D1', { action: 'reply_delete', target: 'kpi' });
  await saveR(E, 'ceo', 'D1', 'kpi', 'as_proposed', act()); await send(E, 'ceo', 'D1');
  assert.equal((await R(E, 'am1', 'D1', { action: 'complete' })).status, 200);
});

test('"a newer draft" in a second round of questions: only answers to open questions that are not submitted yet', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'kpi', 'followup', { question: '週の売上は？', due: '2026-10-20' }); await send(E, 'am1', 'D1');
  const q1 = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.decision === 'followup');
  await resubmit(E, 'D1', 'gm', b => ({ ...b, answers: { [q1.id]: '予算どおり' } }));
  // Saving again only drops the answered question's answer: submitting that is "the same as the last version".
  let g0 = (await R(E, 'gm', 'D1', { action: 'get' })).body;
  const sv0 = await R(E, 'gm', 'D1', { action: 'save', expect_version: g0.review.version, body: g0.review.body });
  assert.deepEqual((await E.q(`select body->'answers' a from mr_reviews where store_id='D1'`))[0].a, {});
  const u = await R(E, 'gm', 'D1', { action: 'submit', expect_version: sv0.body.version, snapshot: g0.submissions[g0.submissions.length - 1].snapshot });
  assert.deepEqual([u.status, u.body.error], [409, 'unchanged']);
  await saveR(E, 'gm', 'D1', 'pl', 'followup', { question: '原価の内訳は？', due: '2026-10-21' }); await send(E, 'gm', 'D1');
  let g = (await R(E, 'gm', 'D1', { action: 'get' })).body;
  assert.equal(g.review.status, 'followup'); assert.equal(g.review.unsubmitted, false);
  const q2 = g.replies.find(x => x.decision === 'followup' && !x.data.resolved);
  await R(E, 'gm', 'D1', { action: 'save', expect_version: g.review.version, body: { ...g.review.body, answers: { [q2.id]: '米が 7 割' } } });
  assert.equal((await R(E, 'gm', 'D1', { action: 'get' })).body.review.unsubmitted, true);
});

// ---------------------------------------------------------------- after the Codex review of PR #44 (v1068)
test('v1068: a CEO changed to GM in manager_auth is a GM here at once; a GM changed to CEO there stays a GM here', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'escalate', { title: '米の業者', recommend: '2 社の見積り', due: '2026-10-22' }, 'ceo');
  assert.equal((await send(E, 'am1', 'D1')).status, 200);
  await E.q(`update manager_auth set role='gm' where user_id=$1`, [U.ceo]);
  assert.equal((await E.api('ceo', { action: 'whoami' })).body.role, 'gm');
  assert.equal((await saveR(E, 'ceo', 'D1', 'issue:i1', 'as_proposed', act())).status, 200);
  const r1 = await send(E, 'ceo', 'D1'); assert.deepEqual([r1.status, r1.body.error], [422, 'incomplete']);      // a CEO item is not decided by a GM
  assert.equal((await E.api('ceo', { action: 'settings_save', key: 'flags', value: { private: true } })).status, 200);   // still a GM for GM / CEO work
  // A GM made CEO in manager_auth is not made CEO here (never wider than the copy here).
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.gm]);
  assert.equal((await E.api('gm', { action: 'whoami' })).body.role, 'gm');
  assert.equal((await saveR(E, 'gm', 'D1', 'issue:i1', 'as_proposed', act())).status, 200);
  assert.equal((await send(E, 'gm', 'D1')).status, 422);
  // Back to CEO in manager_auth: a CEO here again, and the CEO decides.
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.ceo]);
  assert.equal((await E.api('ceo', { action: 'whoami' })).body.role, 'ceo');
  assert.equal((await send(E, 'ceo', 'D1')).status, 200);
  const esc = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.target === 'issue:i1' && x.decision === 'escalate');
  assert.equal(esc.data.resolved, true);
  // The decision counts as the CEO's: it was sent as CEO, though the draft was first saved while a GM.
  const dec = (await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.target === 'issue:i1' && x.state === 'sent' && x.decision === 'as_proposed' && x.author_role === 'ceo');
  assert.ok(dec, 'sent with the role at the time of sending');
  assert.equal((await R(E, 'gm', 'D1', { action: 'get' })).body.review.final['issue:i1'], true);
  // The other way: first saved as CEO, sent after becoming a GM → recorded as GM.
  await E.q(`update manager_auth set role='gm' where user_id=$1`, [U.ceo]);
  await saveR(E, 'ceo', 'D1', 'kpi', 'as_proposed', act());
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.ceo]);
  await saveR(E, 'ceo', 'D1', 'kpi', 'as_proposed', act({ next: '書き直した' }));
  await E.q(`update manager_auth set role='gm' where user_id=$1`, [U.ceo]);
  assert.equal((await send(E, 'ceo', 'D1')).status, 200);
  assert.equal((await R(E, 'gm', 'D1', { action: 'get' })).body.replies.find(x => x.target === 'kpi' && x.state === 'sent' && x.data.next === '書き直した').author_role, 'gm');
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.ceo]);
  // The check after installing points at both kinds of difference.
  await E.q(`update manager_auth set role='gm' where user_id=$1`, [U.ceo]);
  const post = Object.fromEntries((await E.q(fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8'))).map(r => [r.check_name, r]));
  assert.deepEqual([post['ceo here but gm in manager_auth'].value, post['gm here but ceo in manager_auth'].value], ['1', '1']);
  assert.match(post['ceo here but gm in manager_auth'].result, /^注意/);
  assert.match(post['fixes after the review (v1068)'].result, /^OK/);
});

test('v1068: replies are sent only as the screen showed them (the same drafts at the same versions)', async () => {
  const E = await setup(); await demoOn(E);
  await saveR(E, 'am1', 'D1', 'issue:i1', 'as_proposed', act());
  const g1 = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  const shown = shownDrafts(g1);
  const base = { action: 'reply_send', expect_no: g1.review.submitted_no };
  const err = async extra => { const r = await R(E, 'am1', 'D1', { ...base, ...extra }); return [r.status, r.body.error]; };
  // Another tab: a new draft, then a change to the shown one.
  await saveR(E, 'am1', 'D1', 'kpi', 'as_proposed', act());
  assert.deepEqual(await err({ drafts: shown }), [409, 'drafts_changed']);
  await R(E, 'am1', 'D1', { action: 'reply_delete', target: 'kpi' });
  await saveR(E, 'am1', 'D1', 'issue:i1', 'no_action', { reason: '別のタブで書き直した' });
  assert.deepEqual(await err({ drafts: shown }), [409, 'drafts_changed']);
  // An old screen (no list), a list that is not a list, a draft that is not there, someone else's draft id.
  const g2 = (await R(E, 'am1', 'D1', { action: 'get' })).body;
  for (const d of [undefined, null, 'x', {}, [...shownDrafts(g2), { id: '00000000-0000-4000-8000-00000000abcd', version: 1 }]])
    assert.deepEqual(await err({ drafts: d }), [409, 'drafts_changed'], JSON.stringify(d));
  await saveR(E, 'gm', 'D1', 'kpi', 'as_proposed', act());
  const gmDraft = shownDrafts((await R(E, 'gm', 'D1', { action: 'get' })).body);
  assert.deepEqual(await err({ drafts: [...shownDrafts(g2), ...gmDraft] }), [409, 'drafts_changed']);
  // Nothing was sent by the refused tries; the shown set at the shown versions is sent.
  assert.equal((await R(E, 'am1', 'D1', { action: 'get' })).body.replies.filter(x => x.mine && x.state === 'sent').length, 0);
  assert.deepEqual(await err({ drafts: shownDrafts(g2) }), [200, undefined]);
  const sent = (await R(E, 'am1', 'D1', { action: 'get' })).body.replies.filter(x => x.mine && x.state === 'sent');
  assert.deepEqual(sent.map(x => [x.target, x.data.reason]), [['issue:i1', '別のタブで書き直した']]);
  // The GM's own draft was not touched by the AM's send.
  assert.equal((await R(E, 'gm', 'D1', { action: 'get' })).body.replies.filter(x => x.mine && x.state === 'draft').length, 1);
  // A tab whose drafts another tab already sent: "load again", not "nothing to send". With nothing shown and nothing there: nothing to send.
  assert.deepEqual(await err({ drafts: shownDrafts(g2) }), [409, 'drafts_changed']);
  assert.deepEqual(await err({ drafts: [] }), [409, 'nothing']);
});

test('v1068: the fix SQL on a database that already has the first one (rows kept, browsers still shut out, runs twice)', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.employees, public.stores to service_role;
    insert into manager_auth values ('${U.gm}','gm','E2');`);
  const [first, fix] = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql'].map(f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
  await pg.exec(first);
  await pg.exec(`update mr_settings set value = value || '{"private": true}' where key='flags'`);
  const post = fs.readFileSync(new URL('../db/mid-review-postcheck.sql', import.meta.url), 'utf8');
  const row = async () => (await pg.query(post)).rows.find(r => r.check_name === 'fixes after the review (v1068)').result;
  assert.match(await row(), /^NG/);
  const before = (await pg.query(`select (select count(*)::int from mr_members) m, (select value::text from mr_settings where key='flags') f`)).rows[0];
  await pg.exec(fix); await pg.exec(fix);
  assert.match(await row(), /^OK/);
  assert.deepEqual((await pg.query(`select (select count(*)::int from mr_members) m, (select value::text from mr_settings where key='flags') f`)).rows[0], before);
  const open = (await pg.query(`select proname from pg_proc where proname in ('mr_auth','mr_reply_send')
    and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or not has_function_privilege('service_role', oid, 'execute'))`)).rows;
  assert.deepEqual(open, []);
  for (const r of (await pg.query(post)).rows) if (!/^(members|ceo here|gm here)/.test(r.check_name)) assert.match(r.result, /^OK/, r.check_name + ': ' + r.result);
});
