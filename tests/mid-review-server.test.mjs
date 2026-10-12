// 中間レビュー v2（段階 4・UI案44 B案）: the server side on synthetic data — the real SQL (PGlite) and the real handler.
// No production data. People are fake UUIDs and fictional names; email sign-in is a stand-in for Supabase Auth and the
// PIN sign-in is a stand-in verifier (the real one is added later).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHandler, demoData, demoSnapshot, missingV2, normBody, normSnap, KPI_PREV, KPI_CUR } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql'];
const mig = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const SQL = MIG.map(mig).join('\n');
const V1 = MIG.slice(0, 2).map(mig).join('\n');
const V2 = mig(MIG[2]);
const dbFile = f => fs.readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  crew: '00000000-0000-4000-8000-0000000000c4', am1: '00000000-0000-4000-8000-0000000000c5', am2: '00000000-0000-4000-8000-0000000000c6',
  off: '00000000-0000-4000-8000-0000000000c7', stranger: '00000000-0000-4000-8000-0000000000c8', amoff: '00000000-0000-4000-8000-0000000000c9' };
// The shared masters with the production columns (SUPA_MASTER_MAP), read only by the review.
const MASTERS = `create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
  create table public.employees(id text primary key, name text, emp_code text, role text, perms jsonb, title text, store text, support jsonb, status text, emp_type text, data jsonb);
  create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);`;
const ROLES_SQL = 'create role anon; create role authenticated; create role service_role bypassrls;';
const EMPLOYEES = [
  ['E1', 'CEO Test', 'ceo', 'CEO'], ['E2', 'GM Test', 'gm', 'General Manager'], ['E3', 'Office Test', 'office', 'Accounting'], ['E4', 'Crew Test', 'office_crew', 'Office Crew'],
  ['E5', 'Yuki', 'am', 'Area Manager'], ['E6', 'AM Two', 'am', 'Area Manager', null], ['E7', 'Old GM', 'gm', 'General Manager'], ['E9', 'Stopped AM', 'am', 'Area Manager'],
  ['E10', 'Chef Oka', 'g4', 'Head Chef'], ['E11', 'Corp Chef', 'chef', 'Corporate Chef'], ['E12', 'Server Lead', 'g3', 'Server Leader'], ['E13', 'Store Mgr', 'g4', 'Store Manager'],
  ['E14', 'Op Lead', 'g3', 'Operation Leader'], ['E15', 'Twin', 'g3', 'Kitchen Leader'], ['E16', 'Twin', 'g3', 'Kitchen Leader'], ['E17', 'Crew Kid', 'crew', 'Server'],
  ['E18', 'Gone Leader', 'g3', 'Kitchen Leader', '退職'], ['E19', 'Server Lead', 'g3', 'Server Leader', '退職']];

async function setup({ verifier = true } = {}) {
  const pg = new PGlite();
  // Like Supabase: new tables, sequences and functions in public are granted to anon / authenticated by default.
  await pg.exec(`${ROLES_SQL}
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    ${MASTERS}
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into public.stores(id, name, am, active) values ('F01','ToriTon','Yuki',true),('F02','Tenkichi','Yuki',true),('F05','Marujuu','AM Two',true),('F06','LaLa',null,true);`);
  for (const [id, name, role, title, status = '在籍'] of EMPLOYEES)
    await pg.query('insert into employees(id, name, role, title, status) values($1,$2,$3,$4,$5)', [id, name, role, title, status]);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['crew', 'office_crew', 'E4']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  // AMs are added by SQL (Moto). Two more members who have been turned off.
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
  // The PIN sign-in's mark, as the stand-in verifier reads it: 'pin-E12' → employee E12, 'pin-name-Twin' → the name Twin.
  const verifyPin = async tok => {
    if (tok === 'pin-throw') throw new Error('bad signature');
    if (tok === 'pin-junk') return { emp_id: 12 };
    if (tok.startsWith('pin-name-')) return { name: tok.slice(9) };
    if (tok.startsWith('pin-E')) return { emp_id: tok.slice(4) };
    return null;
  };
  const h = createHandler({ env, fetch, db, ...(verifier ? { verifyPin } : {}) });
  const call = async (body, headers = {}, method = 'POST') => {
    const r = await h(new Request('https://fn.test', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }));
    return { status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers };
  };
  const api = (who, body) => call(body, who ? { authorization: 'Bearer tok-' + who } : {});
  const pin = (tok, body) => call({ ...body, pin_session: tok }, { authorization: 'Bearer anon-key' });
  const q = async (sql, p = []) => { await pg.exec('reset role'); try { return (await pg.query(sql, p)).rows; } finally { await pg.exec('set role service_role'); } };
  const rpc = async (name, p) => (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p)])).rows[0].v;
  return { pg, api, pin, call, q, rpc };
}
const on = (E, extra = {}) => E.api('gm', { action: 'settings_save', key: 'flags', value: { private: true, ...extra } });
const STORES = [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am1, sort: 2 },
  { store_id: 'F05', name: 'Marujuu', am_user: U.am2, sort: 3 }, { store_id: 'F06', name: 'LaLa', am_user: null, sort: 4 }];
// Live: F01 reported by E12 (staff, PIN), F02 by Yuki (an AM), F05 by E14 (staff) with Yuki as an extra viewer; F06 has nobody.
async function live(E, { input = true } = {}) {
  assert.equal((await on(E, { live_input: input })).status, 200);
  assert.equal((await E.api('gm', { action: 'stores_save', stores: STORES })).status, 200);
  const a = await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: [] },
    { store_id: 'F02', input_emp: 'E5' }, { store_id: 'F05', input_emp: 'E14', viewer_emps: ['E5'] }] });
  assert.equal(a.status, 200, JSON.stringify(a.body));
}
const prevYmOf = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
// The numbers a screen would send (as the meeting tab judged them).
function snap(ym = '2026-10', o = {}) {
  const rows = (keys, over = {}) => Object.fromEntries(keys.map(k => [k, { act: 100, tgt: 100, unit: '', judge: over[k] || 'ok' }]));
  return { v: 2, period: { from: ym + '-01', to: ym + '-17' }, updated: ym + '-18T15:40:00Z',
    prev: { ym: o.prevYm || prevYmOf(ym), state: o.state || 'final', at: '', rows: rows(KPI_PREV, o.prev) },
    cur: { rows: rows(KPI_CUR, o.cur), fc_ref: { act: 33, tgt: 30, judge: 'miss' } },
    focus: { y: 2026, q: 4, keys: o.keys || [], rows: {} }, thresholds: {}, ...(o.period ? { period: o.period } : {}) };
}
// A body with every required item filled for these numbers.
function fullBody(sn, extra = {}) {
  const prev = {}, cur = {}, focus = {};
  for (const k of KPI_PREV) prev[k] = { eval: 4, comment: 'コメント ' + k, improve: '' };
  for (const k of KPI_CUR) { const miss = sn.cur.rows[k].judge === 'miss'; cur[k] = { eval: miss ? 2 : null, comment: '', measure: miss ? '対策 ' + k : '' }; }
  for (const k of sn.focus.keys) focus[k] = { status: 'ok', done: 'した', remaining: '残り', next: '次', owner: '担当' };
  return { prev, cur, focus, consult: 'none', issues: [], ...extra };
}
const at = (store, extra = {}, ym = '2026-10', env = 'live') => ({ env, ym, store_id: store, ...extra });
// Save then submit as one person (email or PIN). Returns the submit response.
async function report(E, as, store, body, sn, ym = '2026-10', env = 'live') {
  const send = b => (as.startsWith('pin-') ? E.pin(as, b) : E.api(as, b));
  const g = await send({ action: 'get', ...at(store, {}, ym, env) });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const s = await send({ action: 'save', ...at(store, { expect_version: g.body.review ? g.body.review.version : 0, body }, ym, env) });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return send({ action: 'submit', ...at(store, { expect_version: s.body.version, snapshot: sn }, ym, env) });
}
const post = (send, store, kind, target, text, extra = {}) => send({ action: 'post', ...at(store, { kind, target, text, client_id: randomUUID(), ...extra }) });

// ---------------------------------------------------------------- install, browsers shut out
test('install: CEO and GM from manager_auth become members; flags start off with live input off; the new roles and server-made ids', async () => {
  const E = await setup();
  const m = await E.q('select role, emp_id from mr_members order by emp_id');
  assert.deepEqual(m.map(x => [x.role, x.emp_id]), [['ceo', 'E1'], ['gm', 'E2'], ['am', 'E5'], ['am', 'E6'], ['gm', 'E7'], ['am', 'E9']]);
  assert.deepEqual((await E.q(`select value from mr_settings where key='flags'`))[0].value, { private: false, store_publish: false, notify: false, live_input: false });
  const x = await E.q(`insert into mr_members(emp_id, name, role) values('E12','Server Lead','staff') returning user_id`);
  assert.match(x[0].user_id, /^[0-9a-f-]{36}$/);
  await assert.rejects(E.q(`insert into mr_members(emp_id, role) values('E13','owner')`), /check/);
  // One enabled row per employee (a PIN sign-in finds the person by employee id).
  await assert.rejects(E.q(`insert into mr_members(emp_id, role) values('E12','chef')`), /unique|duplicate/);
  await E.q(`insert into mr_members(emp_id, role, enabled) values('E12','chef', false)`);
});

test('browsers cannot reach any table or function (anon / authenticated); the service role runs every function', async () => {
  const E = await setup();
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['mr_settings', 'mr_members', 'mr_stores', 'mr_reviews', 'mr_submissions', 'mr_replies', 'mr_events'])
      for (const pr of ['select', 'insert', 'update', 'delete'])
        assert.equal((await E.q(`select has_table_privilege($1, 'public.${t}', $2) v`, [role, pr]))[0].v, false, `${role} ${pr} ${t}`);
    for (const pr of ['usage', 'select', 'update']) assert.equal((await E.q(`select has_sequence_privilege($1, 'public.mr_events_id_seq', $2) v`, [role, pr]))[0].v, false);
  }
  const fns = await E.q(`select p.oid::regprocedure::text sig, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b,
    has_function_privilege('service_role', p.oid, 'execute') s, p.prosecdef d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'mr\\_%'`);
  assert.equal(fns.length, 77, 'all functions are there (v1066 40 + v2 37)');
  for (const f of fns) { assert.equal(f.a || f.b, false, f.sig); assert.equal(f.s, true, f.sig); assert.equal(f.d, false, f.sig); }
  for (const name of ['mr_can', 'mr_post', 'mr_confirm', 'mr_access_get', 'mr_pin_actor', 'mr_missing_v2']) assert.ok(fns.some(f => f.sig.includes(name + '(')), name);
  const rls = await E.q(`select relname, relrowsecurity from pg_class where relname like 'mr\\_%' and relkind='r'`);
  assert.ok(rls.length === 7 && rls.every(r => r.relrowsecurity));
});

test('the v2 SQL on a database that already holds the first edition’s rows: rows kept, flags kept, runs twice; the old rows are read as before', async () => {
  const pg = new PGlite();
  await pg.exec(`${ROLES_SQL} alter default privileges in schema public grant all on functions to anon, authenticated; ${MASTERS}
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into employees(id, name, role, title, status) values ('E2','GM Test','gm','General Manager','在籍'),('E5','Yuki','am','Area Manager','在籍');
    insert into stores(id, name, am) values ('F01','ToriTon','Yuki');
    insert into manager_auth values ('${U.gm}','gm','E2');`);
  await pg.exec(V1);
  // Rows as the first edition left them: an AM, a live store, the switch on, a demo review with a reply.
  await pg.exec(`insert into mr_members(user_id, emp_id, name, role) values ('${U.am1}','E5','Yuki','am');
    update mr_settings set value = value || '{"private": true}' where key='flags';
    insert into mr_stores(env, store_id, name, am_user) values ('live','F01','ToriTon','${U.am1}'), ('demo','D1','港町（デモ）',null);
    insert into mr_reviews(env, store_id, ym, status, body, submitted_no) values ('demo','D1','2026-10','submitted','{"reporter":"店長","consult":"none","focus":[],"issues":[]}',1);
    insert into mr_submissions(review_id, no, body, snapshot) select id, 1, body, '{}' from mr_reviews;
    insert into mr_replies(review_id, target, author_name, author_role, decision, data, state, sub_no) select id, 'summary', 'AM', 'am', 'no_action', '{"reason":"x"}', 'sent', 1 from mr_reviews;`);
  const count = async () => (await pg.query(`select (select count(*)::int from mr_members) m, (select count(*)::int from mr_stores) s, (select count(*)::int from mr_reviews) r,
    (select count(*)::int from mr_submissions) x, (select count(*)::int from mr_replies) y, (select value->>'private' from mr_settings where key='flags') p`)).rows[0];
  const before = await count();
  const post = dbFile('mid-review-postcheck.sql');
  const row = async name => (await pg.query(post)).rows.find(r => r.check_name === name).result;
  assert.match(await row('mid-review v2 (20261015090000)'), /^NG/);   // the check runs before v2 too and says what is missing
  await pg.exec(V2);
  await pg.exec(`update mr_settings set value = value || '{"live_input": true}' where key='flags'`);
  await pg.exec(V2);
  assert.deepEqual(await count(), before);
  assert.equal((await pg.query(`select value->>'live_input' v from mr_settings where key='flags'`)).rows[0].v, 'true');   // a second run keeps the switch
  assert.match(await row('mid-review v2 (20261015090000)'), /^OK/);
  for (const r of (await pg.query(post)).rows) assert.match(r.result, /^(OK|参考)/, r.check_name + ': ' + r.result);
  // The first edition's review is read as before (legacy), its reply is not part of the v2 thread, and it cannot be written in v2.
  await pg.exec('set role service_role');
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const db = { async rpc(name, p) { return (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})])).rows[0].v; } };
  const h = createHandler({ env, db, fetch: async () => Response.json({ id: U.am1 }) });
  const api = async b => { const r = await h(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(b) })); return { status: r.status, body: await r.json() }; };
  const g = await api({ action: 'get', ...at('D1', {}, '2026-10', 'demo') });
  assert.equal(g.status, 200); assert.equal(g.body.review.legacy, true); assert.equal(g.body.review.status, 'legacy');
  assert.equal(g.body.review.body.reporter, '店長'); assert.deepEqual(g.body.replies, []); assert.equal(g.body.submissions.length, 1);
  for (const b of [{ action: 'save', expect_version: 1, body: {} }, { action: 'submit', expect_version: 1, snapshot: snap('2026-10', { state: 'none' }) },
    { action: 'post', kind: 'reply', target: 'review', text: 'x', client_id: randomUUID() }, { action: 'confirm', expect_no: 1 }])
    assert.deepEqual([(await api({ ...b, ...at('D1', {}, '2026-10', 'demo') })).body.error], ['legacy'], b.action);
  const l = await api({ action: 'list', env: 'demo', ym: '2026-10' });
  assert.equal(l.body.stores[0].review.status, 'legacy'); assert.equal(l.body.stores[0].review.counts, null);
  // The first edition's reply steps are gone (old screens get a clear answer, nothing is written).
  for (const a of ['reply_save', 'reply_delete', 'reply_send', 'complete', 'result_save']) assert.equal((await api({ action: a })).status, 410, a);
  await assert.rejects(pg.query(`select public.mr_reply_send('{}'::jsonb)`), /gone/);
});

test('the v2 SQL stops before changing anything when an employee has two enabled rows, or the employee master has no title', async () => {
  for (const [prep, msg] of [[`insert into mr_members(user_id, emp_id, role) values ('${U.am1}','E5','am'),('${U.am2}','E5','am')`, /同じ社員/],
    [`alter table employees drop column title`, /title/]]) {
    const pg = new PGlite();
    await pg.exec(`${ROLES_SQL} ${MASTERS} grant select on public.manager_auth, public.employees, public.stores to service_role;`);
    await pg.exec(V1); await pg.exec(prep);
    await assert.rejects(pg.exec(V2), msg);
    assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name='mr_stores' and column_name='input_emp'`)).rows[0].n, 0);
    assert.equal((await pg.query(`select count(*)::int n from pg_proc where proname='mr_can'`)).rows[0].n, 0);
  }
});

// ---------------------------------------------------------------- who is calling
test('email sign-in: no sign-in 401, anon key 401, office / office_crew / turned-off / stranger 403; whoami says how and what', async () => {
  const E = await setup();
  assert.equal((await E.api(null, { action: 'whoami' })).status, 401);
  assert.equal((await E.call({ action: 'whoami' }, { authorization: 'Bearer anon-key' })).status, 401);
  for (const who of ['office', 'crew', 'off', 'amoff', 'stranger']) {
    const r = await E.api(who, { action: 'whoami' });
    assert.equal(r.status, 403, who); assert.equal(r.body.error, 'forbidden');
  }
  const w = (await E.api('gm', { action: 'whoami', ym: '2026-10' })).body;
  assert.equal(w.role, 'gm'); assert.equal(w.via, 'email'); assert.equal(w.emp_id, 'E2'); assert.equal(w.name, 'GM Test'); assert.equal(w.ym, '2026-10');
  assert.deepEqual(w.perms, { settings: true, deadline: true, confirm: true, unconfirm: true, reply: true, all_live: true });
  assert.deepEqual(w.live_stores, []);   // nothing about stores while the private check is off
  const a = (await E.api('am1', { action: 'whoami' })).body;
  assert.deepEqual(a.perms, { settings: false, deadline: false, confirm: true, unconfirm: false, reply: true, all_live: false });
  assert.match(a.ym, /^20\d{2}-\d{2}$/);
});

test('PIN sign-in: the verifier’s employee finds the member; unknown, ambiguous, turned off, revoked → refused; no verifier → 401; the body’s via / actor are ignored', async () => {
  const E = await setup(); await live(E);
  const w = await E.pin('pin-E12', { action: 'whoami', via: 'email', actor: U.ceo });
  assert.equal(w.status, 200); assert.equal(w.body.role, 'staff'); assert.equal(w.body.via, 'pin'); assert.equal(w.body.emp_id, 'E12');
  assert.equal(w.body.perms.settings, false);
  assert.equal((await E.pin('pin-E2', { action: 'whoami' })).body.role, 'gm');                       // a GM can sign in with a PIN too
  assert.equal((await E.pin('pin-E2', { action: 'whoami' })).body.perms.settings, false);
  assert.equal((await E.pin('pin-name-Server Lead', { action: 'whoami' })).body.emp_id, 'E12');      // exact name, one employee in service
  await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F06', input_emp: 'E15' }] });   // one of the two named Twin is a member
  assert.equal((await E.pin('pin-E15', { action: 'whoami' })).body.role, 'staff');
  for (const tok of ['pin-E13', 'pin-E99', 'pin-name-Twin', 'pin-name-Server', 'pin-name-Gone Leader', 'pin-E7', 'pin-E9', 'pin-E3'])
    assert.equal((await E.pin(tok, { action: 'whoami' })).status, 403, tok);                          // not a member / ambiguous / turned off
  for (const tok of ['pin-throw', 'pin-junk', 'nobody', ''])
    assert.equal((await E.pin(tok, { action: 'whoami' })).status, 401, tok);
  assert.equal((await E.call({ action: 'whoami', pin_session: 'pin-E12'.repeat(700) }, {})).status, 401);
  // An email sign-in wins over a PIN mark in the same request.
  assert.equal((await E.call({ action: 'whoami', pin_session: 'pin-E12' }, { authorization: 'Bearer tok-gm' })).body.via, 'email');
  assert.equal((await E.call({ action: 'whoami', pin_session: 'pin-E12' }, { authorization: 'Bearer tok-nobody' })).status, 401);   // a bad email sign-in does not fall back
  // A staff member who leaves (退職) is refused at once; a chef whose title changes is refused at once.
  await E.q(`update employees set status='退職' where id='E12'`);
  assert.equal((await E.pin('pin-E12', { action: 'whoami' })).status, 403);
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E10', on: true })).status, 200);
  assert.equal((await E.pin('pin-E10', { action: 'whoami' })).body.role, 'chef');
  await E.q(`update employees set title='Sous Chef' where id='E10'`);
  assert.equal((await E.pin('pin-E10', { action: 'whoami' })).status, 403);
  await E.q(`update employees set title='Head Chef', role='chef' where id='E10'`);
  assert.equal((await E.pin('pin-E10', { action: 'whoami' })).status, 200);                         // role chef also counts
  await E.q(`update employees set status='退職' where id='E10'`);
  assert.equal((await E.pin('pin-E10', { action: 'whoami' })).status, 403);
  // Without a verifier every PIN sign-in is refused; email still works.
  const N = await setup({ verifier: false });
  assert.equal((await N.pin('pin-E2', { action: 'whoami' })).status, 401);
  assert.equal((await N.api('gm', { action: 'whoami' })).status, 200);
});

test('settings need an email sign-in: a GM / CEO with a PIN can read, reply, confirm and change dates but not settings', async () => {
  const E = await setup(); await live(E);
  for (const b of [{ action: 'settings_save', key: 'flags', value: { private: true } }, { action: 'demo_reset' }, { action: 'access_get', ym: '2026-10' },
    { action: 'access_save', stores: [{ store_id: 'F06', input_emp: 'E13' }] }, { action: 'month_input_save', store_id: 'F06', ym: '2026-10', input_emp: 'E13' },
    { action: 'chef_save', emp_id: 'E10', on: true }, { action: 'stores_save', stores: STORES }, { action: 'members_list' }]) {
    const r = await E.pin('pin-E2', b);
    assert.deepEqual([r.status, r.body.error], [403, 'email_required'], b.action);
  }
  assert.equal((await E.q(`select count(*)::int n from mr_members where emp_id='E13'`))[0].n, 0);
  const sn = snap(); await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  assert.equal((await E.pin('pin-E2', { action: 'list', env: 'live', ym: '2026-10' })).status, 200);
  const pp = (await E.pin('pin-E2', { action: 'get', ...at('F01') })).body.perms, pe = (await E.api('gm', { action: 'get', ...at('F01') })).body.perms;
  assert.deepEqual([pp.settings, pp.why], [false, ['all_stores', 'email_required']]); assert.deepEqual([pe.settings, pe.why], [true, ['all_stores']]);
  assert.equal((await post(b => E.pin('pin-E2', b), 'F01', 'reply', 'review', 'PIN からの返信')).status, 200);
  assert.equal((await E.pin('pin-E2', { action: 'deadline_save', ...at('F01', { deadlines: { submit: '', reply: '2026-10-20' } }) })).status, 200);
  assert.equal((await E.pin('pin-E2', { action: 'confirm', ...at('F01', { expect_no: 1 }) })).status, 200);
  assert.equal((await E.pin('pin-E2', { action: 'unconfirm', ...at('F01') })).status, 200);
  // A manager without a PIN-able employee id cannot sign in with a PIN (email only).
  await E.q(`update mr_members set emp_id=null where user_id=$1`, [U.ceo]);
  assert.equal((await E.pin('pin-E1', { action: 'whoami' })).status, 403);
});

test('v1068 kept: a CEO changed to GM in manager_auth is a GM here at once; a GM changed to CEO there stays a GM here; taken off → refused', async () => {
  const E = await setup(); await live(E);
  const sn = snap(); await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  await E.q(`update manager_auth set role='gm' where user_id=$1`, [U.ceo]);
  assert.equal((await E.api('ceo', { action: 'whoami' })).body.role, 'gm');
  const p = await post(b => E.api('ceo', b), 'F01', 'reply', 'review', 'GM として');
  assert.equal(p.body.author_role, 'gm');                              // the role at the time of posting
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.gm]);
  assert.equal((await E.api('gm', { action: 'whoami' })).body.role, 'gm');
  await E.q(`update manager_auth set role='ceo' where user_id=$1`, [U.ceo]);
  assert.equal((await post(b => E.api('ceo', b), 'F01', 'reply', 'review', 'CEO として')).body.author_role, 'ceo');
  const post2 = Object.fromEntries((await E.q(dbFile('mid-review-postcheck.sql'))).map(r => [r.check_name, r]));
  assert.equal(post2['gm here but ceo in manager_auth'].value, '1'); assert.match(post2['gm here but ceo in manager_auth'].result, /^注意/);
  assert.match(post2['role narrowing (v1068)'].result, /^OK/);
  await E.q(`update manager_auth set role='office' where user_id=$1`, [U.gm]);
  assert.equal((await E.api('gm', { action: 'list', env: 'live', ym: '2026-10' })).status, 403);
  await E.q(`delete from manager_auth where user_id=$1`, [U.ceo]);
  assert.equal((await E.api('ceo', { action: 'whoami' })).status, 403);
  assert.equal((await E.api('am1', { action: 'list', env: 'live', ym: '2026-10' })).status, 200);   // AMs do not depend on manager_auth
});

test('switches: off → nobody can list; only GM / CEO with email change them; store publication and notices stay off; live input has its own switch', async () => {
  const E = await setup();
  assert.equal((await E.api('gm', { action: 'list', env: 'demo', ym: '2026-10' })).body.error, 'disabled');
  assert.equal((await E.api('am1', { action: 'settings_save', key: 'flags', value: { private: true } })).status, 403);
  for (const v of [{ private: true, store_publish: true }, { private: true, notify: true }])
    assert.deepEqual([(await E.api('gm', { action: 'settings_save', key: 'flags', value: v })).body.error], ['not_available']);
  for (const v of [{ private: 'yes' }, { private: true, live_input: 'on' }, {}])
    assert.equal((await E.api('gm', { action: 'settings_save', key: 'flags', value: v })).status, 400, JSON.stringify(v));
  assert.equal((await E.api('gm', { action: 'settings_save', key: 'schedule', value: {} })).status, 400);
  assert.deepEqual((await on(E)).body.value, { private: true, store_publish: false, notify: false, live_input: false });
  assert.deepEqual((await on(E, { live_input: true })).body.value.live_input, true);
  assert.deepEqual((await on(E)).body.value.live_input, true);                       // not sent: kept
  assert.deepEqual((await on(E, { live_input: false })).body.value.live_input, false);
  assert.equal((await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).status, 200);
  await E.api('gm', { action: 'stores_save', stores: STORES });
  assert.equal((await E.api('am1', { action: 'whoami', ym: '2026-10' })).body.live_stores.length, 2);
  await E.api('ceo', { action: 'settings_save', key: 'flags', value: { private: false } });
  assert.equal((await E.api('am1', { action: 'list', env: 'demo', ym: '2026-10' })).body.error, 'disabled');
  assert.deepEqual((await E.api('gm', { action: 'whoami', ym: '2026-10' })).body.live_stores, []);
  const ev = await E.q(`select kind, data from mr_events where kind='settings' order by id`);
  assert.equal(ev.length, 5); assert.equal(ev[1].data.old.live_input, false); assert.equal(ev[1].data.value.live_input, true);
});

test('an AM follows the employee master (moved to G4, 退職, removed, no employee id) and the store master’s AM column', async () => {
  const E = await setup(); await live(E);
  const list = async who => (await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body.stores.map(s => s.store_id);
  assert.deepEqual(await list('am1'), ['F01', 'F02', 'F05']);      // F01, F02 (AM column) and F05 (an extra viewer)
  assert.deepEqual(await list('am2'), ['F05']);
  await E.q(`update stores set am='AM Two' where id='F01'`);       // the store master moves F01: the old AM loses it at once
  assert.deepEqual(await list('am1'), ['F02', 'F05']);
  assert.deepEqual(await list('am2'), ['F05']);                      // the new AM waits for the GM
  await E.api('gm', { action: 'stores_save', stores: [{ ...STORES[0], am_user: U.am2 }] });
  assert.deepEqual(await list('am2'), ['F01', 'F05']);
  for (const [sql, label] of [[`update employees set role='g4' where id='E5'`, 'g4'], [`update employees set status='退職' where id='E5'`, '退職'],
    [`delete from employees where id='E5'`, 'removed'], [`update mr_members set emp_id=null where user_id='${U.am1}'`, 'no emp_id']]) {
    await E.q(sql);
    for (const b of [{ action: 'whoami' }, { action: 'list', env: 'live', ym: '2026-10' }, { action: 'get', ...at('F02') }])
      assert.equal((await E.api('am1', b)).status, 403, label + ' ' + b.action);
    await E.q(`insert into employees(id, name, role, title, status) values('E5','Yuki','am','Area Manager','在籍') on conflict (id) do update set role='am', status='在籍', name='Yuki'`);
    await E.q(`update mr_members set emp_id='E5' where user_id='${U.am1}'`);
    assert.equal((await E.api('am1', { action: 'whoami' })).status, 200, 'back ' + label);
  }
  // The master can only take access away: making a stranger an AM there gives nothing.
  await E.q(`update employees set role='am' where id='E3'`);
  assert.equal((await E.api('office', { action: 'whoami' })).status, 403);
});

test('stores_save (email GM / CEO): only enabled AMs still AMs; values in range; inactive stores are not listed', async () => {
  const E = await setup(); await on(E);
  for (const bad of [U.gm, U.office, U.stranger, U.off, U.amoff, 'not-a-uuid'])
    assert.equal((await E.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: bad }] })).status, 400, bad);
  for (const bad of [{ store_id: 'F 01', name: 'x' }, { store_id: 'F01', name: '' }, { store_id: 'F01' }])
    assert.equal((await E.api('gm', { action: 'stores_save', stores: [bad] })).status, 400, JSON.stringify(bad));
  assert.equal((await E.api('am1', { action: 'stores_save', stores: STORES })).status, 403);
  await E.api('gm', { action: 'stores_save', stores: [...STORES, { store_id: 'F09', name: 'Closed', am_user: U.am1, sort: 9, active: false }] });
  for (const who of ['gm', 'am1']) assert.ok(!(await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body.stores.some(s => s.store_id === 'F09'), who);
  assert.equal((await E.api('gm', { action: 'get', ...at('F09') })).status, 404);
  // Saving the stores again keeps the input person and the viewers set in 担当・閲覧設定.
  await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: ['E6'] }] });
  await E.api('gm', { action: 'stores_save', stores: STORES });
  assert.deepEqual((await E.q(`select input_emp, viewer_emps from mr_stores where store_id='F01'`))[0], { input_emp: 'E12', viewer_emps: ['E6'] });
  await E.q(`update employees set status='退職' where id='E6'`);
  assert.equal((await E.api('gm', { action: 'stores_save', stores: [STORES[2]] })).status, 400);
});

// ---------------------------------------------------------------- 担当・閲覧設定
test('access_get: candidates by kind from the employee master (in service, by title / role); stores, chefs and the month', async () => {
  const E = await setup(); await live(E);
  const g = await E.api('gm', { action: 'access_get', ym: '2026-10' });
  assert.equal(g.status, 200);
  const ids = list => list.map(x => x.emp_id).sort();
  assert.deepEqual(ids(g.body.candidates.input), ['E10', 'E12', 'E13', 'E14', 'E15', 'E16', 'E2', 'E5', 'E6', 'E7', 'E9']);
  assert.deepEqual(Object.fromEntries(g.body.candidates.input.map(x => [x.emp_id, x.kind])),
    { E10: 'g4', E12: 'g3', E13: 'g4', E14: 'g3', E15: 'g3', E16: 'g3', E2: 'gm', E5: 'am', E6: 'am', E7: 'gm', E9: 'am' });
  assert.deepEqual(ids(g.body.candidates.viewer), ['E10', 'E11', 'E5', 'E6', 'E9']);
  assert.deepEqual(ids(g.body.candidates.chef), ['E10', 'E11']);
  const st = Object.fromEntries(g.body.stores.map(s => [s.store_id, s]));
  assert.equal(st.F01.input_emp, 'E12'); assert.equal(st.F01.input_name, 'Server Lead'); assert.equal(st.F01.input_ok, true);
  assert.deepEqual(st.F05.viewers, [{ emp_id: 'E5', name: 'Yuki', ok: true, member: true }]);
  assert.equal(st.F06.input_emp, null); assert.equal(st.F01.month_input_emp, null); assert.equal(st.F01.effective_input_emp, 'E12');
  assert.deepEqual(g.body.chefs, []);
  assert.equal((await E.api('am1', { action: 'access_get', ym: '2026-10' })).status, 403);
  assert.equal((await E.api('gm', { action: 'access_get', ym: '2026/10' })).status, 400);
  // It never writes the masters or manager_auth.
  assert.equal((await E.q(`select count(*)::int n from employees`))[0].n, EMPLOYEES.length);
  assert.equal((await E.q(`select count(*)::int n from manager_auth`))[0].n, 4);
});

test('access_save: bad candidates refused (nothing written); the input person gets a PIN-only staff row; roles never change; history kept', async () => {
  const E = await setup(); await on(E);
  await E.api('gm', { action: 'stores_save', stores: STORES });
  const save = stores => E.api('gm', { action: 'access_save', stores });
  for (const [s, code] of [[{ store_id: 'F01', input_emp: 'E17' }, 'bad_candidate'], [{ store_id: 'F01', input_emp: 'E18' }, 'bad_candidate'],
    [{ store_id: 'F01', input_emp: 'NOPE' }, 'bad_candidate'], [{ store_id: 'F01', input_emp: 'E3' }, 'bad_candidate'], [{ store_id: 'F01', input_emp: 'E11' }, 'bad_candidate'],
    [{ store_id: 'F01', viewer_emps: ['E12'] }, 'bad_candidate'], [{ store_id: 'F01', viewer_emps: ['E2'] }, 'bad_candidate'], [{ store_id: 'F01', viewer_emps: ['E18'] }, 'bad_candidate'],
    [{ store_id: 'F99', input_emp: 'E12' }, 'not_found'], [{ store_id: 'F01', viewer_emps: 'E5' }, 'bad_value'], [{ store_id: 'F01', input_emp: 12 }, 'bad_value'],
    [{ store_id: 'F01', viewer_emps: Array.from({ length: 21 }, () => 'E5') }, 'bad_value']])
    assert.equal((await save([s])).body.error, code, JSON.stringify(s));
  // A bad second entry: the first one is not written either.
  assert.equal((await save([{ store_id: 'F01', input_emp: 'E12' }, { store_id: 'F02', input_emp: 'E17' }])).body.error, 'bad_candidate');
  assert.equal((await E.q(`select count(*)::int n from mr_stores where input_emp is not null`))[0].n, 0);
  assert.equal((await E.q(`select count(*)::int n from mr_members where emp_id='E12'`))[0].n, 0);
  const r = await save([{ store_id: 'F01', input_emp: 'E12', viewer_emps: ['E6', 'E11', 'E6'] }, { store_id: 'F02', input_emp: 'E5' }, { store_id: 'F05', input_emp: 'E2' }]);
  assert.equal(r.status, 200); assert.equal(r.body.saved, 3);
  assert.deepEqual(r.body.members.map(x => [x.emp_id, x.role, x.action]), [['E12', 'staff', 'created']]);
  const mem = await E.q(`select user_id::text, emp_id, name, role, enabled from mr_members where emp_id in ('E12','E5','E2') order by emp_id`);
  assert.deepEqual(mem.map(x => [x.emp_id, x.role, x.enabled]), [['E12', 'staff', true], ['E2', 'gm', true], ['E5', 'am', true]]);
  assert.equal(mem[0].name, 'Server Lead');
  assert.ok(![U.ceo, U.gm, U.am1, U.am2].includes(mem[0].user_id));               // a server-made id, not an Auth user
  assert.deepEqual((await E.q(`select viewer_emps from mr_stores where store_id='F01'`))[0].viewer_emps, ['E6', 'E11']);
  // Saving again makes no second row; the history keeps the old and new values.
  await save([{ store_id: 'F01', input_emp: 'E13', viewer_emps: [] }]);
  await save([{ store_id: 'F01', input_emp: 'E12', viewer_emps: [] }]);
  assert.equal((await E.q(`select count(*)::int n from mr_members where emp_id='E12'`))[0].n, 1);
  const ev = await E.q(`select data from mr_events where kind='access' and data->>'store_id'='F01' order by id`);
  assert.deepEqual(ev.map(e => [e.data.old.input_emp, e.data.new.input_emp]), [[null, 'E12'], ['E12', 'E13'], ['E13', 'E12']]);
  assert.equal(ev[1].data.by, 'GM Test');
  // A stopped AM is not let back in from here.
  assert.equal((await save([{ store_id: 'F06', input_emp: 'E9' }])).body.error, 'member_stopped');
  assert.equal((await E.q(`select enabled from mr_members where user_id=$1`, [U.amoff]))[0].enabled, false);
  assert.equal((await E.api('am1', { action: 'access_save', stores: [{ store_id: 'F06', input_emp: 'E13' }] })).status, 403);
});

test('month_input_save: one month’s own input person (null: back to the store’s); the row waits with nothing written (version 0)', async () => {
  const E = await setup(); await live(E);
  const m = (store, ym, emp) => E.api('gm', { action: 'month_input_save', store_id: store, ym, input_emp: emp });
  assert.equal((await m('F01', '2026-11', 'E17')).body.error, 'bad_candidate');
  assert.equal((await m('F99', '2026-11', 'E13')).body.error, 'not_found');
  assert.equal((await m('F01', '2026-1', 'E13')).status, 400);
  const r = await m('F01', '2026-11', 'E13');
  assert.equal(r.status, 200); assert.equal(r.body.member.action, 'created');
  const row = (await E.q(`select version, status, body, input_emp from mr_reviews where store_id='F01' and ym='2026-11'`))[0];
  assert.deepEqual(row, { version: 0, status: 'draft', body: { v: 2 }, input_emp: 'E13' });
  const g = (await E.api('gm', { action: 'get', ...at('F01', {}, '2026-11') })).body;
  assert.deepEqual(g.store.input, { emp_id: 'E13', name: 'Store Mgr', from: 'month', unset: false });
  assert.equal(g.review.status, 'none');
  const l = (await E.api('gm', { action: 'list', env: 'live', ym: '2026-11' })).body.stores.find(s => s.store_id === 'F01');
  assert.equal(l.input.from, 'month'); assert.equal(l.review.status, 'none');
  assert.equal((await E.api('gm', { action: 'get', ...at('F01', {}, '2026-10') })).body.store.input.from, 'store');
  await m('F01', '2026-11', null);
  assert.equal((await E.api('gm', { action: 'get', ...at('F01', {}, '2026-11') })).body.store.input.emp_id, 'E12');
  const ev = await E.q(`select data from mr_events where kind='month_input' order by id`);
  assert.deepEqual(ev.map(e => [e.data.old, e.data.new]), [[null, 'E13'], ['E13', null]]);
});

test('staff see only the store-months they report for (the store’s base and month overrides)', async () => {
  const E = await setup(); await live(E);
  const list = async (tok, ym) => (await E.pin(tok, { action: 'list', env: 'live', ym })).body.stores.map(s => s.store_id);
  assert.deepEqual(await list('pin-E12', '2026-10'), ['F01']);
  assert.deepEqual(await list('pin-E12', '2026-11'), ['F01']);
  await E.api('gm', { action: 'month_input_save', store_id: 'F02', ym: '2026-11', input_emp: 'E12' });
  await E.api('gm', { action: 'month_input_save', store_id: 'F01', ym: '2026-11', input_emp: 'E13' });
  assert.deepEqual(await list('pin-E12', '2026-11'), ['F02']);
  assert.deepEqual(await list('pin-E12', '2026-10'), ['F01']);
  assert.deepEqual(await list('pin-E13', '2026-11'), ['F01']);
  assert.deepEqual(await list('pin-E13', '2026-10'), []);
  assert.equal((await E.pin('pin-E12', { action: 'get', ...at('F01', {}, '2026-11') })).status, 404);
  assert.equal((await E.pin('pin-E12', { action: 'get', ...at('F05', {}, '2026-10') })).status, 404);
  assert.deepEqual((await E.pin('pin-E12', { action: 'whoami', ym: '2026-11' })).body.live_stores, ['F02']);
  const p = (await E.pin('pin-E12', { action: 'get', ...at('F01') })).body.perms;
  assert.deepEqual([p.view, p.input, p.reply, p.note, p.done, p.confirm, p.unconfirm, p.deadline, p.settings], [true, true, false, true, true, false, false, false, false]);
  assert.deepEqual(p.why, ['input']);
});

test('Head Chef / Corporate Chef: all live stores, reply, never confirm; added / removed by email GM / CEO; a staff row becomes chef and back', async () => {
  const E = await setup(); await live(E);
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E12', on: true })).body.error, 'bad_candidate');
  assert.equal((await E.api('am1', { action: 'chef_save', emp_id: 'E11', on: true })).status, 403);
  const a = await E.api('ceo', { action: 'chef_save', emp_id: 'E11', on: true });
  assert.deepEqual([a.status, a.body.role, a.body.action], [200, 'chef', 'created']);
  assert.deepEqual((await E.pin('pin-E11', { action: 'whoami' })).body.live_stores, ['F01', 'F02', 'F05', 'F06']);
  const sn = snap(); await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  const r = await post(b => E.pin('pin-E11', b), 'F01', 'reply', 'cur:sales', '仕込みの量を見直して');
  assert.equal(r.status, 200); assert.equal(r.body.author_role, 'chef');
  for (const b of [{ action: 'confirm', expect_no: 1 }, { action: 'unconfirm' }, { action: 'deadline_save', deadlines: { reply: '2026-10-20' } }])
    assert.equal((await E.pin('pin-E11', { ...b, ...at('F01') })).status, 403, b.action);
  assert.equal((await E.pin('pin-E11', { action: 'save', ...at('F01', { expect_version: 3, body: {} }) })).status, 403);   // not the input person
  // Removing a chef who reports nowhere turns the row off.
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E11', on: false })).body.action, 'disabled');
  assert.equal((await E.pin('pin-E11', { action: 'whoami' })).status, 403);
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E11', on: false })).body.error, 'not_found');
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E11', on: true })).body.action, 'enabled');     // added again: the same row
  // A Head Chef who reports for F06 (staff) becomes chef (same row), and on removal is staff again (still reports for F06).
  await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F06', input_emp: 'E10' }] });
  const id0 = (await E.q(`select user_id::text id from mr_members where emp_id='E10' and enabled`))[0].id;
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E10', on: true })).body.action, 'chef');
  assert.equal((await E.q(`select user_id::text id from mr_members where emp_id='E10' and enabled`))[0].id, id0);
  assert.equal((await E.pin('pin-E10', { action: 'whoami' })).body.live_stores.length, 4);
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E10', on: false })).body.action, 'staff');
  assert.deepEqual((await E.pin('pin-E10', { action: 'whoami' })).body.live_stores, ['F06']);
  // As a store's own viewer (still a Head Chef) they see that store too; once the title changes, only where they report.
  await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: ['E10'] }] });
  assert.deepEqual((await E.pin('pin-E10', { action: 'whoami' })).body.live_stores, ['F01', 'F06']);
  await E.q(`update employees set title='Sous Chef' where id='E10'`);
  assert.deepEqual((await E.pin('pin-E10', { action: 'whoami' })).body.live_stores, ['F06']);
  // An AM row is never changed; a stopped AM is not let back in.
  await E.q(`update employees set title='Head Chef' where id in ('E6','E9')`);
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E6', on: true })).body.error, 'role_exists');
  assert.equal((await E.api('gm', { action: 'chef_save', emp_id: 'E9', on: true })).body.error, 'member_stopped');
  assert.deepEqual((await E.q(`select role, enabled from mr_members where emp_id in ('E6','E9') order by emp_id`)).map(x => [x.role, x.enabled]), [['am', true], ['am', false]]);
  assert.equal((await E.q(`select count(*)::int n from mr_events where kind='chef'`))[0].n, 5);   // refused tries leave no history
});

test('access_get perms: who can do what on each live store and why (from mr_can); people who cannot sign in are shown', async () => {
  const E = await setup(); await live(E, { input: false });
  await E.api('gm', { action: 'access_save', stores: [{ store_id: 'F06', input_emp: null, viewer_emps: ['E11'] }] });
  await E.api('gm', { action: 'chef_save', emp_id: 'E10', on: true });
  const g = (await E.api('gm', { action: 'access_get', ym: '2026-10' })).body;
  const by = Object.fromEntries(g.perms.map(p => [p.store_id, Object.fromEntries(p.people.map(x => [x.emp_id, x]))]));
  const f = (s, e) => { const x = by[s][e]; return x && [x.view, x.input, x.reply, x.confirm, x.settings, x.why.join(',')]; };
  assert.deepEqual(f('F01', 'E1'), [true, false, true, true, true, 'all_stores']);
  assert.deepEqual(f('F01', 'E5'), [true, false, true, true, false, 'am_store']);
  assert.deepEqual(f('F01', 'E12'), [true, false, false, false, false, 'input,live_input_off']);
  assert.deepEqual(f('F01', 'E10'), [true, false, true, false, false, 'all_stores']);
  assert.equal(by.F01.E6, undefined);                                             // AM Two does not see F01
  assert.deepEqual(f('F05', 'E5'), [true, false, true, true, false, 'viewer']);
  assert.deepEqual(f('F05', 'E6'), [true, false, true, true, false, 'am_store']);
  assert.deepEqual(f('F06', 'E2'), [true, false, true, true, true, 'all_stores,input_unset']);
  assert.deepEqual(by.F06.E11, { user_id: null, emp_id: 'E11', name: 'Corp Chef', role: null, member: false, view: false, input: false, reply: false, note: false,
    done: false, confirm: false, unconfirm: false, deadline: false, settings: false, why: ['no_member'] });
  await on(E, { live_input: true });
  const g2 = (await E.api('gm', { action: 'access_get', ym: '2026-10' })).body;
  assert.deepEqual(g2.perms.find(p => p.store_id === 'F01').people.find(x => x.emp_id === 'E12').why, ['input']);
});

// ---------------------------------------------------------------- what is required (spec §4)
test('mr_missing_v2: last month needs 評価 and comment when judged (else 評価保留); this month only a 未達; Qコミット all fields; consult; the screen’s missingV2 says the same', async () => {
  const E = await setup();
  const sqlMiss = async (b, sn) => (await E.pg.query('select public.mr_missing_v2($1::jsonb, $2::jsonb) v', [JSON.stringify(b), JSON.stringify(sn)])).rows[0].v;
  const both = async (b, sn) => { const s = await sqlMiss(b, sn), j = missingV2(b, sn); assert.deepEqual(s, j); return s; };
  const empty = { consult: 'none' };
  const all = KPI_PREV.flatMap(k => [`prev:${k}:eval`, `prev:${k}:comment`]);
  assert.deepEqual(await both(empty, snap()), { missing: all, holds: 0 });
  assert.deepEqual(await both(empty, snap('2026-10', { prev: { sales: 'unset', guests: 'missing', ppa: 'warn', fc: 'miss' } })),
    { missing: all.filter(c => !/^prev:(sales|guests):/.test(c)), holds: 2 });
  assert.deepEqual(await both(empty, snap('2026-10', { state: 'prov' })), { missing: [], holds: 6 });
  assert.deepEqual(await both(empty, snap('2026-10', { state: 'none' })), { missing: [], holds: 6 });
  const sn = snap('2026-10', { state: 'prov', cur: { sales: 'miss', guests: 'warn', ppa: 'unset', repeat: 'missing' } });
  assert.deepEqual(await both(empty, sn), { missing: ['cur:sales:eval', 'cur:sales:measure'], holds: 6 });
  assert.deepEqual(await both({ consult: 'none', cur: { sales: { eval: 2, measure: '  ' } } }, sn), { missing: ['cur:sales:measure'], holds: 6 });
  // This month's cost rate is never required, even if a snapshot judged it.
  const fc = snap('2026-10', { state: 'prov' }); fc.cur.rows.fc = { act: 40, tgt: 30, judge: 'miss' };
  assert.deepEqual(await both(empty, fc), { missing: [], holds: 6 });
  // Qコミット: every key, every field; no keys → nothing.
  const fk = snap('2026-10', { state: 'prov', keys: ['repeat', 'cs'] });
  assert.deepEqual(await both({ consult: 'none', focus: { repeat: { status: 'late', done: 'a', remaining: 'b', next: 'c', owner: '' }, cs: { status: 'nope' } } }, fk),
    { missing: ['focus:repeat:owner', 'focus:cs:status', 'focus:cs:done', 'focus:cs:remaining', 'focus:cs:next', 'focus:cs:owner'], holds: 6 });
  // Consult.
  const p = snap('2026-10', { state: 'prov' });
  assert.deepEqual((await both({ consult: '' }, p)).missing, ['consult']);
  assert.deepEqual((await both({ consult: 'yes', issues: [] }, p)).missing, ['consult']);
  assert.deepEqual((await both({ consult: 'yes', issues: [{ id: 'i1', what: '　\n', ask: 'x' }, { id: 'i2', what: 'y', ask: '' }] }, p)).missing, ['issue:i1:what', 'issue:i2:ask']);
  assert.deepEqual((await both({ consult: 'none', issues: [{ id: 'i1' }] }, p)).missing, []);
  // 評価 is 1..5 (an integer); blanks as the screen sees them (full-width spaces, line breaks).
  for (const [ev, ok] of [[1, true], [5, true], [0, false], [6, false], [3.5, false], ['3', false], [null, false]]) {
    const s1 = snap('2026-10', { cur: { sales: 'miss' } });
    const r = await both({ consult: 'none', prev: Object.fromEntries(KPI_PREV.map(k => [k, { eval: 3, comment: 'c' }])), cur: { sales: { eval: ev, measure: 'm' } } }, s1);
    assert.deepEqual(r.missing, ok ? [] : ['cur:sales:eval'], String(ev));
  }
  // Random shapes: the SQL and the screen agree.
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = a => a[rnd(a.length)];
  const txt = () => pick(['', ' ', '　', 'x', '\n', null, 5]);
  for (let i = 0; i < 250; i++) {
    const keys = ['repeat', 'cs', 'menu'].filter(() => rnd(2));
    const s = snap('2026-10', { state: pick(['final', 'prov', 'none']), keys,
      prev: Object.fromEntries(KPI_PREV.map(k => [k, pick(['ok', 'warn', 'miss', 'unset', 'missing'])])),
      cur: Object.fromEntries(KPI_CUR.map(k => [k, pick(['ok', 'warn', 'miss', 'unset', 'missing'])])) });
    if (rnd(5) === 0) delete s.prev.rows.sales;
    const b = { consult: pick(['yes', 'none', '', null]),
      prev: Object.fromEntries(KPI_PREV.filter(() => rnd(3)).map(k => [k, { eval: pick([1, 3, 5, 0, null, 7]), comment: txt() }])),
      cur: Object.fromEntries(KPI_CUR.filter(() => rnd(3)).map(k => [k, { eval: pick([2, 4, null]), measure: txt() }])),
      focus: Object.fromEntries(keys.filter(() => rnd(3)).map(k => [k, { status: pick(['ok', 'late', 'done', 'help', '', 'x']), done: txt(), remaining: txt(), next: txt(), owner: txt() }])),
      issues: Array.from({ length: rnd(3) }, (_, n) => ({ id: pick(['i' + n, null, n]), what: txt(), ask: txt() })) };
    await both(b, s);
  }
});

test('the body (本文 v2) is normalised and checked: too long or bad dates refused, unknown fields and this month’s cost rate dropped; the SQL checks again', async () => {
  const E = await setup(); await live(E);
  const save = body => E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: 0, body }) });
  for (const [b, label] of [[{ prev: { sales: { comment: 'x'.repeat(401) } } }, 'comment'], [{ cur: { sales: { owner: 'x'.repeat(61) } } }, 'owner'],
    [{ cur: { sales: { due: '2026-02-30' } } }, 'due'], [{ consult: 'yes', issues: [{ id: 'i1', what: 'x'.repeat(201) }] }, 'what'],
    [{ consult: 'yes', issues: [{ id: 'i1', ask_by: 'tomorrow' }] }, 'ask_by'], [{ consult: 'yes', issues: Array.from({ length: 11 }, (_, i) => ({ id: 'i' + i })) }, '11 issues'],
    [{ consult: 'yes', issues: [{ id: 'i1' }, { id: 'i1' }] }, 'same id'], [{ consult: 'yes', issues: [{ what: 'no id' }] }, 'no id'],
    [{ focus: { 'Bad Key': {} } }, 'focus key'], [{ focus: Object.fromEntries(Array.from({ length: 13 }, (_, i) => ['k' + String.fromCharCode(97 + i), {}])) }, '13 keys']])
    assert.equal((await save(b)).status, 400, label);
  assert.equal((await E.q(`select count(*)::int n from mr_reviews`))[0].n, 0);
  const s = await save({ v: 9, evil: 1, prev: { sales: { eval: 6, comment: 'a\u0000b', x: 1 } }, cur: { fc: { eval: 1, comment: '捨てる' }, sales: { eval: 2, investigating: 'yes' } },
    focus: { repeat: { status: 'bogus', done: 'd' } }, consult: 'none', issues: [{ id: 'i1', what: '消える' }] });
  assert.equal(s.status, 200);
  const b = (await E.q(`select body from mr_reviews where store_id='F01'`))[0].body;
  assert.equal(b.v, 2); assert.equal(b.evil, undefined); assert.equal(b.cur.fc, undefined); assert.deepEqual(b.issues, []);
  assert.deepEqual(b.prev.sales, { eval: null, comment: 'ab', improve: '' });
  assert.equal(b.cur.sales.eval, 2); assert.equal(b.cur.sales.investigating, false);
  assert.deepEqual(Object.keys(b.prev).sort(), [...KPI_PREV].sort()); assert.deepEqual(Object.keys(b.cur).sort(), [...KPI_CUR].sort());
  assert.deepEqual(b.focus, { repeat: { status: '', done: 'd', remaining: '', next: '', owner: '' } });
  // The SQL's own backstop (a request that did not come through the handler's normalising).
  const direct = async body => E.rpc('mr_save', { actor: (await E.q(`select user_id::text u from mr_members where emp_id='E12'`))[0].u, via: 'pin', ...at('F01', { expect_version: 1, body }) });
  for (const body of [{ v: 1 }, { v: 2, prev: { sales: { comment: 'x'.repeat(401) } } }, { v: 2, cur: { sales: { eval: 7 } } }, { v: 2, prev: { other: {} } },
    { v: 2, cur: { sales: { due: '2026-13-01' } } }, { v: 2, consult: 'maybe' }, { v: 2, consult: 'yes', issues: [{ id: 'i1' }, { id: 'i1' }] },
    { v: 2, focus: { BAD: {} } }, { v: 2, issues: 'x' }, { v: 2, cur: { sales: { investigating: 1 } } }])
    await assert.rejects(direct(body), /bad_value/, JSON.stringify(body));
  await direct({ v: 2, cur: { fc: { eval: 1 }, sales: { eval: 3 } }, junk: 1, consult: 'none', issues: [{ id: 'i1' }] });
  const b2 = (await E.q(`select body from mr_reviews where store_id='F01'`))[0].body;
  assert.deepEqual(b2, { v: 2, prev: {}, cur: { sales: { eval: 3 } }, focus: {}, consult: 'none', issues: [] });
});

// ---------------------------------------------------------------- the flow (spec §6)
test('flow: live input waits for its switch; save → submit (incomplete lists what is missing) → resubmit → 確認完了 → locked → 取り消し → resubmit', async () => {
  const E = await setup(); await live(E, { input: false });
  const send = b => E.pin('pin-E12', b);
  const sn = snap('2026-10', { cur: { sales: 'miss' }, keys: ['repeat'] });
  assert.deepEqual([(await send({ action: 'save', ...at('F01', { expect_version: 0, body: {} }) })).body.error], ['not_available']);
  await on(E, { live_input: true });
  const s1 = await send({ action: 'save', ...at('F01', { expect_version: 0, body: { consult: 'yes', issues: [{ id: 'i1', what: '米' }] } }) });
  assert.deepEqual([s1.status, s1.body.version, s1.body.status], [200, 1, 'draft']);
  assert.equal((await send({ action: 'save', ...at('F01', { expect_version: 0, body: {} }) })).body.error, 'conflict');   // a second "new" draft is not made
  const i = await send({ action: 'submit', ...at('F01', { expect_version: 1, snapshot: sn }) });
  assert.equal(i.status, 422); assert.equal(i.body.error, 'incomplete');
  assert.deepEqual(i.body.missing, missingV2(normBody({ consult: 'yes', issues: [{ id: 'i1', what: '米' }] }), normSnap(sn)).missing);
  assert.ok(i.body.missing.includes('issue:i1:ask') && i.body.missing.includes('focus:repeat:status') && i.body.missing.includes('cur:sales:measure'));
  const body = fullBody(sn);
  const s2 = await send({ action: 'save', ...at('F01', { expect_version: 1, body }) });
  assert.equal((await send({ action: 'submit', ...at('F01', { expect_version: 1, snapshot: sn }) })).body.error, 'conflict');
  const sub = await send({ action: 'submit', ...at('F01', { expect_version: s2.body.version, snapshot: sn }) });
  assert.deepEqual([sub.status, sub.body.status, sub.body.submitted_no, sub.body.holds], [200, 'submitted', 1, 0]);
  assert.equal((await send({ action: 'submit', ...at('F01', { expect_version: sub.body.version, snapshot: sn }) })).body.error, 'unchanged');
  // Corrected before anyone confirmed: version 2; the first one stays.
  const s3 = await send({ action: 'save', ...at('F01', { expect_version: sub.body.version, body: { ...body, prev: { ...body.prev, sales: { eval: 3, comment: '直した' } } } }) });
  const sub2 = await send({ action: 'submit', ...at('F01', { expect_version: s3.body.version, snapshot: sn }) });
  assert.equal(sub2.body.submitted_no, 2);
  // 確認完了 on the version the screen showed.
  assert.equal((await E.api('am1', { action: 'confirm', ...at('F01', { expect_no: 1 }) })).body.error, 'new_version');
  assert.equal((await E.api('am1', { action: 'confirm', ...at('F01') })).body.error, 'new_version');
  const c = await E.api('am1', { action: 'confirm', ...at('F01', { expect_no: 2 }) });
  assert.deepEqual([c.status, c.body.status, c.body.confirmed_by, c.body.holds, c.body.missing], [200, 'confirmed', 'Yuki', 0, 0]);
  assert.equal((await E.api('gm', { action: 'confirm', ...at('F01', { expect_no: 2 }) })).body.error, 'locked');
  const v = (await send({ action: 'get', ...at('F01') })).body.review.version;
  assert.equal((await send({ action: 'save', ...at('F01', { expect_version: v, body }) })).body.error, 'locked');
  assert.equal((await send({ action: 'submit', ...at('F01', { expect_version: v, snapshot: sn }) })).body.error, 'locked');
  assert.equal((await E.api('gm', { action: 'deadline_save', ...at('F01', { deadlines: { reply: '2026-10-30' } }) })).body.error, 'locked');
  assert.equal((await post(send, 'F01', 'done', 'cur:sales', '実行しました')).status, 200);       // the thread goes on after 確認完了
  // Only GM / CEO take it back; then the input person can correct and submit again.
  assert.equal((await E.api('am1', { action: 'unconfirm', ...at('F01') })).status, 403);
  const u = await E.api('gm', { action: 'unconfirm', ...at('F01') });
  assert.deepEqual([u.status, u.body.status], [200, 'submitted']);
  assert.equal((await E.api('gm', { action: 'unconfirm', ...at('F01') })).body.error, 'not_confirmed');
  const s4 = await send({ action: 'save', ...at('F01', { expect_version: v, body: { ...body, consult: 'none', prev: { ...body.prev, guests: { eval: 2, comment: '3 回目' } } } }) });
  assert.equal((await send({ action: 'submit', ...at('F01', { expect_version: s4.body.version, snapshot: sn }) })).body.submitted_no, 3);
  const ev = (await E.q(`select e.kind, e.data from mr_events e join mr_reviews r on r.id=e.review_id where r.store_id='F01' order by e.id`));
  assert.deepEqual(ev.map(e => e.kind), ['create', 'submit', 'submit', 'confirm', 'post', 'unconfirm', 'submit']);
  assert.equal(ev[1].data.by, 'Server Lead'); assert.equal(ev[3].data.by, 'Yuki'); assert.equal(ev[5].data.was_by, 'Yuki');
  const subs = await E.q(`select no, created_by from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='F01' order by no`);
  assert.deepEqual(subs.map(x => [x.no, x.created_by]), [[1, 'Server Lead'], [2, 'Server Lead'], [3, 'Server Lead']]);
});

test('confirm: AM / GM / CEO who see the store; with 評価保留 it still confirms and says how many; not before a submission', async () => {
  const E = await setup(); await live(E);
  assert.equal((await E.api('am1', { action: 'confirm', ...at('F01', { expect_no: 0 }) })).body.error, 'not_submitted');
  const sn = snap('2026-10', { state: 'prov' });
  await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  assert.equal((await E.pin('pin-E12', { action: 'confirm', ...at('F01', { expect_no: 1 }) })).status, 403);     // the input person (staff)
  assert.equal((await E.api('am2', { action: 'confirm', ...at('F01', { expect_no: 1 }) })).status, 404);         // an AM of another store
  const c = await E.api('ceo', { action: 'confirm', ...at('F01', { expect_no: 1 }) });
  assert.deepEqual([c.status, c.body.holds, c.body.missing], [200, 6, 0]);
  // An AM who is an extra viewer of F05 can confirm it.
  const sn5 = snap(); await report(E, 'pin-E14', 'F05', fullBody(sn5), sn5);
  assert.equal((await E.api('am1', { action: 'confirm', ...at('F05', { expect_no: 1 }) })).status, 200);
});

test('who writes and who replies: the input person reports, adds notes and marks 対策の実行完了; managers reply; an AM who reports may also reply', async () => {
  const E = await setup(); await live(E);
  const sn = snap('2026-10', { cur: { sales: 'miss' }, keys: ['repeat'] });
  const body = fullBody(sn, { consult: 'yes', issues: [{ id: 'i1', what: '米の値上げ', ask: '業者を比べて', severity: 'high' }] });
  assert.equal((await E.api('gm', { action: 'save', ...at('F01', { expect_version: 0, body }) })).status, 403);   // GM sees F01 but does not report it
  assert.equal((await E.api('am1', { action: 'save', ...at('F01', { expect_version: 0, body }) })).status, 403);
  assert.equal((await report(E, 'pin-E12', 'F01', body, sn)).status, 200);
  const staff = b => E.pin('pin-E12', b), am1 = b => E.api('am1', b), am2 = b => E.api('am2', b);
  assert.equal((await post(staff, 'F01', 'reply', 'issue:i1', '返信')).status, 403);
  assert.equal((await post(staff, 'F01', 'note', 'issue:i1', '補足：業者に聞いた')).body.author_role, 'staff');
  assert.equal((await post(staff, 'F01', 'done', 'cur:sales', '実行した')).status, 200);
  assert.equal((await post(am1, 'F01', 'note', 'issue:i1', 'AM の補足')).status, 403);          // not the input person
  assert.equal((await post(am1, 'F01', 'done', 'cur:sales', 'AM が見た')).status, 200);
  assert.equal((await post(am2, 'F01', 'reply', 'review', '見えない店')).status, 404);
  // Yuki reports F02 (an AM as the input person) and can also reply on it.
  assert.equal((await report(E, 'am1', 'F02', body, sn)).status, 200);
  assert.equal((await post(am1, 'F02', 'reply', 'issue:i1', 'AM として返信')).body.author_role, 'am');
  assert.equal((await post(am1, 'F02', 'note', 'issue:i1', '報告として補足')).body.kind, 'note');
  // Live input switched off: the input person's notes wait; managers still reply.
  await on(E, { live_input: false });
  assert.equal((await post(staff, 'F01', 'note', 'issue:i1', 'x')).body.error, 'not_available');
  assert.equal((await post(staff, 'F01', 'done', 'cur:sales', 'x')).status, 403);
  assert.equal((await post(am1, 'F01', 'reply', 'issue:i1', '返信')).status, 200);
});

test('post: targets of the submitted version only; text 1–1000; kinds, decisions, dates and versions checked; nothing before a submission', async () => {
  const E = await setup(); await live(E);
  const sn = snap('2026-10', { keys: ['repeat', 'cs'] });
  await report(E, 'pin-E12', 'F01', fullBody(sn, { consult: 'yes', issues: [{ id: 'i1', what: 'w', ask: 'a' }] }), sn);
  const gm = b => E.api('gm', b);
  for (const t of ['review', 'prev:sales', 'prev:fc', 'cur:labor', 'focus:repeat', 'focus:cs', 'issue:i1'])
    assert.equal((await post(gm, 'F01', 'reply', t, 'ok')).status, 200, t);
  for (const t of ['cur:fc', 'prev:other', 'focus:menu', 'issue:i9', 'summary', 'kpi', 'Review', 'issue:' + 'x'.repeat(41), 'cur', '', null])
    assert.equal((await post(gm, 'F01', 'reply', t, 'ok')).status, 400, String(t));
  for (const text of ['', '   ', '　\n', 'x'.repeat(1001), 5, null]) assert.equal((await post(gm, 'F01', 'reply', 'review', text)).status, 400, String(text).slice(0, 5));
  assert.equal((await post(gm, 'F01', 'reply', 'review', 'x'.repeat(1000))).status, 200);
  for (const extra of [{ decision: 'approve' }, { due: '2026-13-01' }, { due: '2026-02-29' }, { client_id: 'abc' }, { client_id: null }, { sub_no: 0 }, { sub_no: 2 }, { sub_no: '1' }, { kind: 'comment' }])
    assert.equal((await post(gm, 'F01', 'reply', 'review', 'x', extra)).status, 400, JSON.stringify(extra));
  const d = await post(gm, 'F01', 'reply', 'issue:i1', '本部で見積りを取る', { decision: 'modify', due: '2026-10-25' });
  assert.deepEqual([d.body.decision, d.body.due, d.body.sub_no, d.body.author_name, d.body.existing], ['modify', '2026-10-25', 1, 'GM Test', false]);
  const n = await post(b => E.pin('pin-E12', b), 'F01', 'note', 'issue:i1', '補足', { decision: 'modify', due: '2026-10-25' });
  assert.deepEqual([n.status, n.body.decision, n.body.due], [200, null, null]);   // a note carries no decision or date
  assert.equal((await post(gm, 'F02', 'reply', 'review', 'まだ')).body.error, 'not_submitted');
  await E.api('gm', { action: 'month_input_save', store_id: 'F06', ym: '2026-10', input_emp: 'E13' });
  assert.equal((await post(gm, 'F06', 'reply', 'review', 'まだ')).body.error, 'not_submitted');
  // A newer version without the question: the latest has no issue:i1, the first one still has it.
  const g = (await E.pin('pin-E12', { action: 'get', ...at('F01') })).body;
  const s = await E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: g.review.version, body: fullBody(sn) }) });
  await E.pin('pin-E12', { action: 'submit', ...at('F01', { expect_version: s.body.version, snapshot: sn }) });
  assert.equal((await post(gm, 'F01', 'reply', 'issue:i1', '前の版へ')).status, 400);
  const old = await post(gm, 'F01', 'reply', 'issue:i1', '前の版へ', { sub_no: 1 });
  assert.deepEqual([old.status, old.body.sub_no], [200, 1]);
  // The SQL checks again: a note carries no decision; a question counts only in a version that says 相談がある.
  const gmId = U.gm;
  const n2 = await E.rpc('mr_post', { actor: gmId, via: 'email', ...at('F01', { kind: 'done', target: 'review', text: 'x', client_id: randomUUID(), decision: 'modify', due: '2026-10-25' }) });
  assert.deepEqual([n2.decision, n2.due], [null, null]);
  await E.q(`update mr_submissions x set body = x.body || '{"consult":"none"}' from mr_reviews r where r.id = x.review_id and r.store_id = 'F01' and x.no = 1`);
  assert.equal((await post(gm, 'F01', 'reply', 'issue:i1', '前の版へ', { sub_no: 1 })).status, 400);
  // Replies never change the report and never block anything.
  const g2 = (await E.pin('pin-E12', { action: 'get', ...at('F01') })).body;
  assert.equal(g2.review.version, s.body.version + 1); assert.deepEqual(g2.review.body, normBody(fullBody(sn)));
  assert.equal(g2.replies.filter(r => r.kind === 'reply').length, 10);
  assert.equal(g2.replies.filter(r => r.kind === 'done').length, 1);
  assert.equal(g2.replies.every(r => r.mine === false || r.kind === 'note'), true);
});

test('post is stored once per client_id (a retried request gives back the first entry); another person’s client_id is refused', async () => {
  const E = await setup(); await live(E);
  const sn = snap(); await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  const id = randomUUID();
  const send = (who, text) => E.api(who, { action: 'post', ...at('F01', { kind: 'reply', target: 'review', text, client_id: id }) });
  const a = await send('am1', '一度だけ');
  const b = await send('am1', '二度目（同じ ID）');
  assert.deepEqual([a.status, b.status, b.body.id, b.body.text, b.body.existing], [200, 200, a.body.id, '一度だけ', true]);
  const id2 = randomUUID();
  const [x, y] = await Promise.all([1, 2].map(() => E.api('gm', { action: 'post', ...at('F01', { kind: 'reply', target: 'review', text: '同時', client_id: id2.toUpperCase() }) })));
  assert.deepEqual([x.status, y.status, x.body.id === y.body.id], [200, 200, true]);
  assert.equal((await send('gm', '他人の ID')).body.error, 'conflict');
  assert.equal((await E.q(`select count(*)::int n from mr_replies where client_id in ($1, $2)`, [id, id2]))[0].n, 2);
  assert.equal((await E.q(`select count(*)::int n from mr_events where kind='post'`))[0].n, 2);
});

test('list: the numbers are kept apart (未達・評価 1／2・対策・相談・未返信・評価保留・Qコミット); 未返信 counts management replies on the latest version; 期限超過', async () => {
  const E = await setup(); await live(E);
  const sn = snap('2026-10', { cur: { sales: 'miss', guests: 'warn' }, keys: ['repeat', 'cs'] });
  const body = fullBody(sn, { consult: 'yes', issues: [{ id: 'i1', what: '米の値上げ', ask: '業者', severity: 'high' }] });
  body.prev.fc = { eval: 2, comment: '原価が高い' };
  body.cur.guests = { eval: 1, comment: '客数が少ない', measure: '' };
  body.focus.repeat.status = 'late';
  await report(E, 'pin-E12', 'F01', body, sn);
  const row = async (who = 'gm', s = 'F01') => (await E.api(who, { action: 'list', env: 'live', ym: '2026-10' })).body.stores.find(x => x.store_id === s);
  const c0 = (await row()).review.counts;
  assert.deepEqual(c0, { miss_cur: 1, eval_low: 3, measures: 1, consult: 1, consult_high: true, needs_reply: 5, unanswered: 5, holds: 0, missing: 0,
    focus: { ok: 1, late: 1, done: 0, help: 0, none: 0 } });
  const staff = b => E.pin('pin-E12', b);
  await post(staff, 'F01', 'note', 'issue:i1', '補足');                 // a note is not a reply
  assert.equal((await row()).review.counts.unanswered, 5);
  await post(b => E.api('am1', b), 'F01', 'reply', 'issue:i1', '返信');
  await post(b => E.api('gm', b), 'F01', 'reply', 'cur:sales', '返信');
  await post(b => E.api('gm', b), 'F01', 'done', 'cur:guests', '見た');  // done is not a reply either
  assert.equal((await row()).review.counts.unanswered, 3);
  // A new version: its items need a word again (replies are kept on the version they answered).
  const g = (await staff({ action: 'get', ...at('F01') })).body;
  const s = await staff({ action: 'save', ...at('F01', { expect_version: g.review.version, body: { ...body, prev: { ...body.prev, sales: { eval: 3, comment: '直した' } } } }) });
  await staff({ action: 'submit', ...at('F01', { expect_version: s.body.version, snapshot: sn }) });
  assert.equal((await row()).review.counts.unanswered, 5);
  // The list carries no free text of the report.
  const l = JSON.stringify((await E.api('gm', { action: 'list', env: 'live', ym: '2026-10' })).body);
  assert.ok(!/米の値上げ|原価が高い|客数が少ない|返信|補足/.test(l));
  // 期限超過: only when a date is set and has passed (Hawaii date), and the step is not done.
  const r = await row();
  assert.deepEqual([r.review.deadlines, r.review.overdue], [{}, { submit: false, reply: false }]);
  await E.api('gm', { action: 'deadline_save', ...at('F01', { deadlines: { submit: '2021-01-01', reply: '2021-01-02' } }) });
  await E.api('gm', { action: 'deadline_save', ...at('F06', { deadlines: { submit: '2021-01-01' } }) });
  await E.api('gm', { action: 'deadline_save', ...at('F02', { deadlines: { submit: '2099-01-01', reply: '2099-01-02' } }) });
  assert.deepEqual((await row()).review.overdue, { submit: false, reply: true });       // no reply on version 2 yet
  await post(b => E.api('ceo', b), 'F01', 'reply', 'review', '見ました');
  assert.deepEqual((await row()).review.overdue, { submit: false, reply: false });
  assert.deepEqual((await row('gm', 'F06')).review.overdue, { submit: true, reply: false });
  assert.deepEqual((await row('gm', 'F02')).review.overdue, { submit: false, reply: false });
  assert.equal((await row('gm', 'F06')).review.status, 'none');
  assert.deepEqual((await row('gm', 'F06')).input, { emp_id: null, from: null, unset: true, name: null });
  // Each store row also says what this person may do there.
  assert.deepEqual([(await row('am1', 'F05')).perms.confirm, (await row('am1', 'F05')).perms.why], [true, ['viewer']]);
});

test('deadlines: GM / CEO (email or PIN) set the submit and reply dates; both optional, no defaults; the row waits at version 0 for the first save', async () => {
  const E = await setup(); await live(E);
  const d = (who, store, deadlines) => E.api(who, { action: 'deadline_save', ...at(store, { deadlines }) });
  for (const who of ['am1']) assert.equal((await d(who, 'F01', { submit: '2026-10-15' })).status, 403);
  assert.equal((await E.pin('pin-E12', { action: 'deadline_save', ...at('F01', { deadlines: { submit: '2026-10-15' } }) })).status, 403);
  assert.equal((await E.pin('pin-E13', { action: 'deadline_save', ...at('F06', { deadlines: {} }) })).status, 403);   // not a member yet
  for (const v of [{ submit: '2026-10-32' }, { submit: '2026-10-15', reply: '2026-10-14' }, { reply: '10/20' }]) assert.equal((await d('gm', 'F06', v)).status, 400, JSON.stringify(v));
  const r = await d('gm', 'F06', { submit: '2026-10-15', reply: '' });
  assert.deepEqual([r.status, r.body.deadlines, r.body.version], [200, { submit: '2026-10-15' }, 0]);
  assert.deepEqual((await E.pin('pin-E2', { action: 'deadline_save', ...at('F06', { deadlines: {} }) })).body.deadlines, {});
  await d('gm', 'F06', { submit: '2026-10-15', reply: '2026-10-17' });
  // The month's own input person writes the first save on the waiting row with version 0.
  await E.api('gm', { action: 'month_input_save', store_id: 'F06', ym: '2026-10', input_emp: 'E13' });
  assert.equal((await E.pin('pin-E13', { action: 'save', ...at('F06', { expect_version: 1, body: {} }) })).body.error, 'conflict');
  const s = await E.pin('pin-E13', { action: 'save', ...at('F06', { body: { consult: 'none' } }) });
  assert.deepEqual([s.status, s.body.version], [200, 1]);
  const g = (await E.pin('pin-E13', { action: 'get', ...at('F06') })).body;
  assert.deepEqual([g.review.status, g.review.deadlines], ['draft', { submit: '2026-10-15', reply: '2026-10-17' }]);
  const ev = await E.q(`select e.kind, e.data from mr_events e join mr_reviews r on r.id=e.review_id where r.store_id='F06' order by e.id`);
  assert.deepEqual(ev.map(e => e.kind), ['deadline', 'deadline', 'deadline', 'month_input', 'create']);
  assert.deepEqual([ev[2].data.old, ev[2].data.new], [{}, { submit: '2026-10-15', reply: '2026-10-17' }]);
});

test('get: the working copy only for the input person; others see the latest submitted version (nothing before it); the thread is v2 only', async () => {
  const E = await setup(); await live(E);
  const sn = snap();
  const s = await E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: 0, body: { consult: 'none', prev: { sales: { eval: 4, comment: '下書き' } } } }) });
  assert.equal((await E.api('gm', { action: 'get', ...at('F01') })).body.review.body, null);
  assert.equal((await E.pin('pin-E12', { action: 'get', ...at('F01') })).body.review.body.prev.sales.comment, '下書き');
  await E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: s.body.version, body: fullBody(sn) }) });
  await E.pin('pin-E12', { action: 'submit', ...at('F01', { expect_version: s.body.version + 1, snapshot: sn }) });
  await E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: s.body.version + 2, body: { ...fullBody(sn), consult: 'yes', issues: [{ id: 'i2', what: '新しい下書き' }] } }) });
  const gm = (await E.api('gm', { action: 'get', ...at('F01') })).body;
  assert.equal(gm.review.body.consult, 'none'); assert.equal(gm.review.unsubmitted, false); assert.equal(gm.submissions.length, 1);
  assert.equal(gm.submissions[0].snapshot.v, 2); assert.equal(gm.submissions[0].by, 'Server Lead');
  const me = (await E.pin('pin-E12', { action: 'get', ...at('F01') })).body;
  assert.equal(me.review.body.consult, 'yes'); assert.equal(me.review.unsubmitted, true);
  assert.deepEqual(me.store.input, { emp_id: 'E12', name: 'Server Lead', from: 'store', unset: false });
  // A first-edition reply row on the same review is not part of the v2 thread.
  await E.q(`insert into mr_replies(review_id, target, author_name, author_role, decision, data, state) select id, 'summary', 'old', 'am', 'no_action', '{}', 'sent' from mr_reviews where store_id='F01'`);
  await post(b => E.api('am1', b), 'F01', 'reply', 'review', 'v2');
  const r = (await E.api('am1', { action: 'get', ...at('F01') })).body.replies;
  assert.deepEqual(r.map(x => [x.kind, x.text, x.mine]), [['reply', 'v2', true]]);
  assert.equal((await E.api('gm', { action: 'get', ...at('F01') })).body.replies[0].mine, false);
  for (const b of [at('F01', {}, '2026-10', 'prod'), at("F01'", {}), at('F01', {}, '2026-13')]) assert.equal((await E.api('gm', { action: 'get', ...b })).status, 400);
});

test('snapshot v2 is checked: the month, last month, Qコミット keys; a demo store’s numbers must be the demo’s own', async () => {
  const E = await setup(); await live(E); await E.api('gm', { action: 'demo_reset' });
  const sn = snap();
  const g = (await E.pin('pin-E12', { action: 'get', ...at('F01') })).body;
  const s = await E.pin('pin-E12', { action: 'save', ...at('F01', { expect_version: 0, body: fullBody(sn) }) });
  const sub = x => E.pin('pin-E12', { action: 'submit', ...at('F01', { expect_version: s.body.version, snapshot: x }) });
  for (const [x, label] of [[{ ...sn, period: { from: '2026-09-01', to: '2026-10-17' } }, 'from'], [{ ...sn, period: { from: '2026-10-01', to: '2026-11-01' } }, 'to'],
    [snap('2026-10', { prevYm: '2026-08' }), 'prev ym'], [{ ...sn, focus: { keys: ['Bad'] } }, 'key'], [{ ...sn, focus: { keys: Array.from({ length: 13 }, (_, i) => 'k' + i) } }, '13 keys']])
    assert.equal((await sub(x)).status, 400, label);
  assert.equal(g.review, null);
  assert.equal((await sub(sn)).status, 200);
  // Demo: the screen must send the demo's own numbers.
  const d = demoData('2026-10'), D6 = d.stores.find(x => x.store_id === 'D6').demo;
  const good = demoSnapshot('2026-10', D6);
  const gd = (await E.api('am1', { action: 'get', ...at('D6', {}, '2026-10', 'demo') })).body;
  const body = fullBody(normSnap(good));
  const sd = await E.api('am1', { action: 'save', ...at('D6', { expect_version: gd.review.version, body }, '2026-10', 'demo') });
  const subd = x => E.api('am1', { action: 'submit', ...at('D6', { expect_version: sd.body.version, snapshot: x }, '2026-10', 'demo') });
  const alt = JSON.parse(JSON.stringify(good)); alt.cur.rows.sales.act = 99999;
  const alt2 = JSON.parse(JSON.stringify(good)); alt2.prev.state = 'prov';
  const alt3 = JSON.parse(JSON.stringify(good)); alt3.focus.keys = ['ppa'];
  for (const x of [alt, alt2, alt3]) assert.equal((await subd(x)).status, 400);
  const ok = await subd(good);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await E.q(`select created_by from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='D6'`))[0].created_by, 'Yuki');   // who pressed it
});

// ---------------------------------------------------------------- the demo
test('demo: GM / CEO (email) make it; every member sees the six fictional stores and may try the input; it covers the cases; twice is the same', async () => {
  const E = await setup(); await live(E);
  await E.api('gm', { action: 'chef_save', emp_id: 'E11', on: true });
  assert.equal((await E.api('am1', { action: 'demo_reset' })).status, 403);
  assert.equal((await E.pin('pin-E2', { action: 'demo_reset' })).body.error, 'email_required');
  const r = await E.api('gm', { action: 'demo_reset' });
  assert.deepEqual(r.body, { stores: 6, reviews: 6 });
  await E.api('ceo', { action: 'demo_reset' });
  for (const [t, n] of [['mr_stores', 6], ['mr_reviews', 6], ['mr_submissions', 5], ['mr_replies', 12]])
    assert.equal((await E.q(`select count(*)::int n from ${t} where ${t === 'mr_stores' || t === 'mr_reviews' ? "env='demo'" : "true"}`))[0].n, n, t);
  const l = (await E.api('am2', { action: 'list', env: 'demo', ym: '2026-10' })).body;
  const by = Object.fromEntries(l.stores.map(s => [s.store_id, s]));
  assert.deepEqual(l.stores.map(s => [s.store_id, s.name, s.review.status]), [['D1', '港町（デモ）', 'submitted'], ['D2', '丘の上（デモ）', 'confirmed'],
    ['D3', '駅前（デモ）', 'submitted'], ['D4', '海岸（デモ）', 'submitted'], ['D5', '公園通り（デモ）', 'submitted'], ['D6', '川沿い（デモ）', 'draft']]);
  assert.equal(by.D3.review.counts.holds, 6); assert.equal(by.D4.review.counts.holds, 1); assert.equal(by.D3.review.counts.consult, 2);
  assert.deepEqual(by.D5.review.overdue, { submit: false, reply: true }); assert.deepEqual(by.D6.review.overdue, { submit: true, reply: false });
  assert.equal(by.D2.review.confirmed_by, 'AM 佐藤（デモ）'); assert.equal(by.D6.am_unset, true);
  assert.deepEqual(by.D1.input, { emp_id: 'DEMO-1', from: 'store', unset: false, name: '店長 田中（デモ）' });
  const d1 = (await E.api('am1', { action: 'get', ...at('D1', {}, '2026-10', 'demo') })).body;
  assert.deepEqual(new Set(d1.replies.filter(x => x.kind === 'reply').map(x => x.author_role)), new Set(['chef', 'am', 'gm', 'ceo']));
  assert.ok(d1.replies.some(x => x.kind === 'note' && x.target === 'issue:i1') && d1.replies.filter(x => x.target === 'issue:i1').length >= 4);
  assert.ok(d1.replies.some(x => x.kind === 'done'));
  const d4 = (await E.api('am1', { action: 'get', ...at('D4', {}, '2026-10', 'demo') })).body;
  assert.equal(d4.submissions[0].snapshot.cur.rows.labor.judge, 'unset'); assert.equal(d4.submissions[0].snapshot.prev.rows.labor.judge, 'unset');
  const d6 = (await E.api('am1', { action: 'get', ...at('D6', {}, '2026-10', 'demo') })).body;
  const miss = missingV2(d6.review.body, demoSnapshot('2026-10', d6.store.demo)).missing;
  assert.ok(miss.includes('consult') && miss.includes('cur:repeat:measure') && miss.some(x => x.startsWith('focus:')), miss.join());
  // Every submitted demo version is complete by the same rule as the screen.
  for (const st of ['D1', 'D2', 'D3', 'D4', 'D5']) {
    const g = (await E.api('am1', { action: 'get', ...at(st, {}, '2026-10', 'demo') })).body;
    assert.deepEqual(missingV2(g.submissions[0].body, g.submissions[0].snapshot).missing, [], st);
  }
  // Everybody may try the input on the demo (the person who pressed it is recorded); replies still follow the roles.
  for (const [who, send] of [['chef', b => E.pin('pin-E11', b)], ['staff', b => E.pin('pin-E12', b)], ['am', b => E.api('am2', b)]]) {
    const g = (await send({ action: 'get', ...at('D6', {}, '2026-10', 'demo') })).body;
    assert.equal(g.perms.input, true, who); assert.deepEqual(g.perms.why, ['demo']);
    assert.equal((await send({ action: 'save', ...at('D6', { expect_version: g.review.version, body: g.review.body }, '2026-10', 'demo') })).status, 200, who);
  }
  assert.equal((await post(b => E.pin('pin-E12', { ...b, env: 'demo' }), 'D1', 'reply', 'review', 'x')).status, 403);
  assert.equal((await post(b => E.pin('pin-E12', { ...b, env: 'demo' }), 'D1', 'note', 'review', '店長として補足（デモ）')).status, 200);
  assert.equal((await post(b => E.pin('pin-E11', { ...b, env: 'demo' }), 'D1', 'reply', 'review', 'Chef（デモ）')).status, 200);
  // The demo never touches live rows.
  assert.equal((await E.q(`select count(*)::int n from mr_stores where env='live'`))[0].n, 4);
  const text = JSON.stringify(demoData('2026-10'));
  assert.ok(!/@|funergy|ToriTon|Tenkichi|Marujuu|Totoya|LaLa/i.test(text), 'the demo names nothing real');
});

test('demoData: the same six fictional stores; the snapshots judge with the default thresholds; months roll over', () => {
  const d = demoData('2026-10');
  assert.deepEqual(d.stores.map(s => s.store_id), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
  assert.equal(d.stores[5].name, '川沿い（デモ）');
  const s = demoSnapshot('2026-10', d.stores[2].demo);
  assert.deepEqual([s.prev.state, s.cur.rows.sales.judge, s.cur.rows.repeat.judge, s.cur.rows.labor.judge], ['prov', 'miss', 'warn', 'miss']);
  assert.equal(demoData('2027-01').stores[0].demo.prev.ym, '2026-12');
  assert.equal(demoData('2027-01').stores[0].demo.focus.q, 1);
  assert.deepEqual(normSnap(s), s);                                  // the demo snapshot is already in the shape the handler keeps
});

test('the handler’s shapes (the screen uses the same): issues only with 相談がある, at most 10; Qコミット keys checked; the demo uses the meeting tab’s default thresholds', () => {
  assert.deepEqual(normBody({ consult: 'none', issues: [{ id: 'i1', what: 'x' }] }).issues, []);
  assert.equal(normBody({ consult: 'yes', issues: [{ id: 'i1', what: 'x' }] }).issues.length, 1);
  assert.throws(() => normBody({ consult: 'yes', issues: Array.from({ length: 11 }, (_, i) => ({ id: 'i' + i })) }), /bad_value/);
  assert.throws(() => normBody({ focus: { 'Bad Key': {} } }), /bad_value/);
  assert.throws(() => normSnap({ focus: { keys: ['Bad Key'] } }), /bad_value/);
  assert.deepEqual(normBody({}).consult, '');
  const d = demoData('2026-10');
  assert.equal(demoSnapshot('2026-10', d.stores[2].demo).prev.rows.repeat.judge, 'warn');     // 93.3% of the target: 注意 with the default 90%
  assert.equal(demoSnapshot('2026-10', d.stores[0].demo).cur.fc_ref.judge, 'miss');           // 108.9%: over the default 108%
  assert.equal(demoSnapshot('2026-10', d.stores[3].demo).cur.rows.labor.judge, 'unset');
});

// ---------------------------------------------------------------- requests, the SQL helper files
test('request handling: origin, method, unknown and removed actions, bad values; a database error is not passed on; Auth that hangs is cut off', async () => {
  const E = await setup(); await on(E);
  assert.equal((await E.call({ action: 'whoami' }, { origin: 'https://evil.test', authorization: 'Bearer tok-gm' })).status, 403);
  const ok = await E.call({ action: 'whoami' }, { origin: 'https://funergy-plus.com', authorization: 'Bearer tok-gm' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://funergy-plus.com'); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await E.call(null, { origin: 'https://funergy-plus.com' }, 'OPTIONS')).status, 204);
  assert.equal((await E.call(null, {}, 'GET')).status, 405);
  for (const a of ['constructor', 'drop', 'members', '__proto__']) assert.equal((await E.api('gm', { action: a })).status, 400, a);
  for (const a of ['reply_save', 'reply_delete', 'reply_send', 'complete', 'result_save']) assert.deepEqual([(await E.api(null, { action: a })).status], [410], a);
  assert.equal((await E.call([1], { authorization: 'Bearer tok-gm' })).status, 400);
  assert.equal((await E.call({ action: 'whoami', pad: 'x'.repeat(100001) }, { authorization: 'Bearer tok-gm' })).status, 413);
  for (const b of [{ env: 'prod', ym: '2026-10' }, { env: 'demo', ym: '2026-13' }, { env: 'demo', ym: '1999-10' }, { env: 'demo', ym: "2026-10'; --" }])
    assert.equal((await E.api('gm', { action: 'list', ...b })).status, 400);
  const m = await E.api('gm', { action: 'members_list' });
  assert.equal(m.status, 200); assert.equal(m.body.length, 6); assert.equal(m.body.find(x => x.emp_id === 'E7').role_now, null);
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const h = createHandler({ env, fetch: async () => Response.json({ id: U.gm }), db: { rpc: async () => { throw new Error('relation "public.mr_x" does not exist key=abc token=xyz'); } } });
    const r = await h(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer tok-gm' }, body: JSON.stringify({ action: 'whoami' }) }));
    assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'error' });
    assert.ok(logs.length && !/abc|xyz/.test(logs.join(' ')));
  } finally { console.error = orig; }
  let signal = null;
  const h2 = createHandler({ env, fetch: async (u, init) => { signal = init.signal; return Response.json({ id: U.gm }); }, db: { rpc: async () => ({}) } });
  await h2(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer tok-gm' }, body: JSON.stringify({ action: 'whoami' }) }));
  assert.ok(signal && typeof signal.aborted === 'boolean');
  // A refused PIN mark goes no further than the verifier (no database call).
  const calls = [];
  const h3 = createHandler({ env, verifyPin: async () => null, db: { rpc: async n => { calls.push(n); return {}; } } });
  const r3 = await h3(new Request('https://fn.test', { method: 'POST', body: JSON.stringify({ action: 'whoami', pin_session: 'x' }) }));
  assert.equal(r3.status, 401); assert.deepEqual(calls, []);
});

test('one review per store × month × environment; legacy (first edition) reviews are read only', async () => {
  const E = await setup(); await live(E);
  await E.q(`insert into mr_reviews(env, store_id, ym, status, body, submitted_no) values('live','F06','2026-09','submitted','{"reporter":"x","consult":"none"}',1)`);
  await assert.rejects(E.q(`insert into mr_reviews(env, store_id, ym) values('live','F06','2026-09')`));
  await E.api('gm', { action: 'month_input_save', store_id: 'F06', ym: '2026-10', input_emp: 'E13' });
  const g = (await E.api('gm', { action: 'get', ...at('F06', {}, '2026-09') })).body;
  assert.deepEqual([g.review.legacy, g.review.status, g.review.body.reporter], [true, 'legacy', 'x']);
  assert.equal((await E.api('gm', { action: 'deadline_save', ...at('F06', { deadlines: {} }, '2026-09') })).body.error, 'legacy');
  assert.equal((await E.api('gm', { action: 'month_input_save', store_id: 'F06', ym: '2026-09', input_emp: 'E13' })).body.error, 'legacy');
  assert.equal((await E.api('gm', { action: 'unconfirm', ...at('F06', {}, '2026-09') })).body.error, 'not_confirmed');
});

test('the check before installing: OK on an empty database and on one with the first edition; says NG for a missing title or a duplicate', async () => {
  const pre = dbFile('mid-review-precheck.sql');
  const pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text); ${MASTERS}
    insert into manager_auth values ('${U.gm}','gm','E2'); insert into employees(id, name, role, title) values ('E10','Chef','g4','Head Chef'),('E12','Lead','g3','Server Leader');`);
  const rows = async () => Object.fromEntries((await pg.query(pre)).rows.map(r => [r.check_name, r]));
  let r = await rows();
  assert.equal(Object.keys(r).length, 13);
  for (const x of Object.values(r)) assert.match(x.result, /^OK/, x.check_name + ': ' + x.result);
  assert.match(r['mid-review tables (v1066)'].result, /まだ無い/);
  assert.equal(r['Head Chef / Corporate Chef in the employee master'].value, '1'); assert.equal(r['input candidates in the employee master'].value, '2');
  await pg.exec(ROLES_SQL); await pg.exec(V1);
  r = await rows();
  assert.match(r['mid-review tables (v1066)'].result, /入っている/); assert.match(r['mid-review v2 already there'].result, /まだ/);
  await pg.exec(`insert into mr_members(user_id, emp_id, role) values ('${U.am1}','E5','am'),('${U.am2}','E5','am')`);
  assert.match((await rows())['the same employee enabled twice in mr_members'].result, /^NG/);
  await pg.exec(`update mr_members set enabled=false where user_id='${U.am2}'`);
  await pg.exec(V2);
  r = await rows();
  for (const x of Object.values(r)) assert.match(x.result, /^OK/, x.check_name + ': ' + x.result);
  assert.match(r['mid-review v2 already there'].result, /もう入っている/);
  await pg.exec(`alter table employees drop column title`);
  r = await rows();
  assert.match(r['employees.title (Head Chef・入力担当の候補)'].result, /^NG/);
  // Without the masters the install stops before anything is made.
  const bare = new PGlite();
  await bare.exec(`${ROLES_SQL} create table public.manager_auth(user_id uuid primary key, role text, emp_id text);`);
  await assert.rejects(bare.exec('begin;' + SQL + 'commit;'), /employees|stores/);
});

test('the check after installing: every row OK on a fresh install; it points at people who can no longer get in', async () => {
  const E = await setup(); await live(E);
  const post = dbFile('mid-review-postcheck.sql');
  let rows = await E.q(post);
  assert.equal(rows.length, 24);
  for (const r of rows) assert.match(r.result, /^(OK|参考)/, r.check_name + ': ' + r.result);
  assert.match(rows.find(r => r.check_name === 'live stores without an input person').result, /^参考/);
  await E.api('gm', { action: 'chef_save', emp_id: 'E10', on: true });
  await E.q(`update employees set title='Cook', role='g3' where id='E10'`); await E.q(`update employees set status='退職' where id='E12'`);
  rows = Object.fromEntries((await E.q(post)).map(r => [r.check_name, r]));
  assert.match(rows['chef no longer Head Chef / Corporate Chef'].result, /^注意/); assert.match(rows['staff not in service'].result, /^注意/);
  assert.equal(rows['members (enabled, by role)'].value, 'am 2, ceo 1, chef 1, gm 1, staff 2');
});

test('add-member (SQL, AM / GM / CEO) and disable-member: the same rules as before; a PIN-only staff row of the same employee is replaced', async () => {
  const E = await setup(); await live(E);
  await E.pg.exec('reset role');
  await E.pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
    insert into auth.users values ('00000000-0000-4000-8000-0000000000d1','yuki@example.test'),('00000000-0000-4000-8000-0000000000d2','sm@example.test'),('${U.gm}','gm@example.test'),
     ('${U.amoff}','stopped@example.test'),('00000000-0000-4000-8000-0000000000d3','gm2@example.test'),('00000000-0000-4000-8000-0000000000d4','lead@example.test'),
     ('00000000-0000-4000-8000-0000000000d5','chef@example.test');
    insert into public.employees(id, name, role, title, status) values ('EY','Yuki Test','am','Area Manager','在籍'),('E8','Yuki Test','am','Area Manager','退職'),
     ('EG','Store Mgr G4','g4','Store Manager',null),('EA','Twin AM','am',null,null),('EB','Twin AM','am',null,null),('EH','GM Two','gm',null,null);
    insert into manager_auth values ('00000000-0000-4000-8000-0000000000d3','gm','E2');`);
  const tpl = dbFile('mid-review-add-member.sql');
  const add = (email, name, role) => tpl.replace('<メールアドレス>', email).replace('<社員の表の名前（完全に同じ）>', name).replace('<am / gm / ceo のどれか>', role);
  await E.pg.exec(add('YUKI@example.test', 'Yuki Test', 'am'));
  assert.deepEqual((await E.pg.query(`select role, emp_id, enabled from mr_members where user_id='00000000-0000-4000-8000-0000000000d1'`)).rows, [{ role: 'am', emp_id: 'EY', enabled: true }]);
  await assert.rejects(E.pg.exec(add('nobody@example.test', 'Yuki Test', 'am')), /まだありません/);
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Yuki T', 'am')), /0 人/);
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Twin AM', 'am')), /2 人/);
  await assert.rejects(E.pg.exec(add('sm@example.test', 'Store Mgr G4', 'am')), /AM ではありません/);
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Yuki Test', 'gm')), /manager_auth/);
  await assert.rejects(E.pg.exec(add('gm@example.test', 'GM Test', 'ceo')), /manager_auth/);
  await assert.rejects(E.pg.exec(add('yuki@example.test', 'Yuki Test', 'chef')), /am・gm・ceo/);
  await assert.rejects(E.pg.exec(add('gm2@example.test', 'GM Two', 'gm')), /manager_auth の社員/);
  await assert.rejects(E.pg.exec(add('stopped@example.test', 'Stopped AM', 'am')), /止めてあります/);
  await E.pg.exec(add('stopped@example.test', 'Stopped AM', 'am').replace('v_reenable boolean := false', 'v_reenable boolean := true'));
  assert.equal((await E.pg.query(`select enabled from mr_members where user_id='${U.amoff}'`)).rows[0].enabled, true);
  // E12 reports F01 with a PIN-only staff row; made an AM by email, the staff row is turned off and the email row takes over.
  await E.pg.exec(`update employees set role='am' where id='E12'`);
  const old = (await E.pg.query(`select user_id::text u from mr_members where emp_id='E12' and enabled`)).rows[0].u;
  await E.pg.exec(add('lead@example.test', 'Server Lead', 'am'));
  assert.deepEqual((await E.pg.query(`select user_id::text u, role from mr_members where emp_id='E12' and enabled`)).rows, [{ u: '00000000-0000-4000-8000-0000000000d4', role: 'am' }]);
  assert.equal((await E.pg.query(`select enabled from mr_members where user_id=$1`, [old])).rows[0].enabled, false);
  await E.pg.exec('set role service_role');
  assert.equal((await E.pin('pin-E12', { action: 'whoami' })).body.role, 'am');                      // the PIN reaches the enabled row
  await E.pg.exec('reset role');
  // A chef row of the same employee is not replaced quietly.
  await E.pg.exec('set role service_role');
  await E.api('gm', { action: 'chef_save', emp_id: 'E11', on: true });
  await E.pg.exec('reset role');
  await E.pg.exec(`update employees set role='am' where id='E11'`);
  await assert.rejects(E.pg.exec(add('chef@example.test', 'Corp Chef', 'am')), /もう chef/);
  const dis = dbFile('mid-review-disable-member.sql');
  await E.pg.exec(dis.replace('<メールアドレス>', 'stopped@example.test'));
  assert.equal((await E.pg.query(`select enabled from mr_members where user_id='${U.amoff}'`)).rows[0].enabled, false);
  await assert.rejects(E.pg.exec(dis.replace('<メールアドレス>', 'nobody@example.test')), /ありません/);
  await E.pg.exec('set role service_role');
});

test('rollback: stops while a live review exists; otherwise removes every mid-review table and function (v1 and v2) and nothing else', async () => {
  const E = await setup(); await live(E);
  const sn = snap(); await report(E, 'pin-E12', 'F01', fullBody(sn), sn);
  const rb = dbFile('mid-review-rollback.sql');
  await E.pg.exec('reset role');
  await assert.rejects(E.pg.exec(rb), /本番/);
  assert.equal((await E.pg.query(`select count(*)::int n from pg_class where relname like 'mr\\_%' and relkind='r'`)).rows[0].n, 7);
  await E.pg.exec(`delete from mr_reviews where env='live'`);
  await E.pg.exec(rb);
  assert.equal((await E.pg.query(`select count(*)::int n from pg_class where relname like 'mr\\_%' and relkind='r'`)).rows[0].n, 0);
  assert.deepEqual((await E.pg.query(`select proname from pg_proc where proname like 'mr\\_%'`)).rows, []);
  assert.equal((await E.pg.query(`select count(*)::int n from manager_auth`)).rows[0].n, 4);
  assert.equal((await E.pg.query(`select count(*)::int n from employees`)).rows[0].n, EMPLOYEES.length);
  await E.pg.exec(rb);                                                                   // a second run does nothing
});
