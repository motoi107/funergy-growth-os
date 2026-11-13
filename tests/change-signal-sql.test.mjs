// v1151（「変わった」の合図と変更の記録）: migration 20261118090000 on synthetic data in PGlite (fictional names, no production data).
// The app writes app_state / app_settings / the master tables with the public key the way PostgREST does (as anon, with the request headers and
// the JWT claims in request.headers / request.jwt.claims). The secure-state function writes with the service key and its verified actor (f:'1').
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SECURE = fs.readFileSync(new URL('../supabase/migrations/20261117090000_secure_grade_bonus_read.sql', import.meta.url), 'utf8');
const MIG = fs.readFileSync(process.env.FUNERGY_CHANGE_SIGNAL_MIG || new URL('../supabase/migrations/20261118090000_change_signal.sql', import.meta.url), 'utf8');
const PRE = fs.readFileSync(new URL('../db/change-signal-precheck.sql', import.meta.url), 'utf8');
const POST = fs.readFileSync(new URL('../db/change-signal-postcheck.sql', import.meta.url), 'utf8');
const ROLLBACK = fs.readFileSync(new URL('../db/change-signal-rollback.sql', import.meta.url), 'utf8');

async function setup({ mig = true, pub = true } = {}) {
  const pg = new PGlite();
  // Like Supabase: new tables, sequences and functions in public are granted to anon / authenticated by default
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    create table public.app_settings(key text primary key, value jsonb, category text, updated_at timestamptz default now());
    create table public.stores(id text primary key, name text, active boolean, data jsonb, updated_at timestamptz default now());
    create table public.employees(id text primary key, name text, role text, store text, status text, data jsonb, updated_at timestamptz default now());
    create table public.ingredients(code text primary key, name text, price numeric, data jsonb, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state, public.app_settings, public.stores, public.employees, public.ingredients to anon, authenticated, service_role;`);
  if (pub) { try { await pg.exec('create publication supabase_realtime'); } catch { /* PGlite without publications: Realtime part is skipped */ } }
  await pg.exec(SECURE);   // app_state RLS on, the secret keys (ss_secret_key) as production has them after v1148
  if (mig) await pg.exec(MIG);
  return pg;
}
const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const ANN = { e: 'E1', n: 'Ann 試験', r: 'gm', d: 'dev-A', k: 'pc' };
const BOB = { e: 'E2', n: 'Bob Sample', r: 'sl', d: 'dev-B', k: 'iphone' };
// one PostgREST request: the role, the JWT claims and the request headers are local to the request
async function as(pg, role, actor, f) {
  await pg.exec('set role ' + role);
  const claims = role === 'postgres' ? '' : JSON.stringify({ role });
  const headers = actor ? JSON.stringify({ 'x-fp-actor': typeof actor === 'string' ? actor : b64(actor) }) : '{}';
  await pg.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`, [claims, headers]);
  try { return await f(); } finally { await pg.exec('reset role'); await pg.query(`select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false)`); }
}
const upKv = (pg, key, value, role = 'anon', actor = ANN, table = 'app_state') =>
  as(pg, role, actor, () => pg.query(`insert into public.${table}(key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]));
const sig = async (pg, key) => (await pg.query('select key, n::int as n, by_emp, by_dev from sync_signal where key = $1', [key])).rows[0] || null;
const sigs = async pg => (await pg.query('select key, n from sync_signal order by key')).rows.map(r => r.key + ':' + r.n);
const logs = async (pg, where = 'true', args = []) => (await pg.query(`select src, key, cat, by_emp, by_name, by_role, by_dev, by_kind, via, parts, more, n from change_log where ${where} order by id`, args)).rows;

test('an app write moves the key\'s signal and leaves who changed which part; the same value again leaves nothing', async () => {
  const pg = await setup();
  assert.deepEqual(await sigs(pg), [], 'the migration itself signals nothing');
  await upKv(pg, 'meetings', { F01: { a: 1 }, F02: { b: 2 } });
  assert.deepEqual(await sig(pg, 'meetings'), { key: 'meetings', n: 1, by_emp: 'E1', by_dev: 'dev-A' });
  assert.deepEqual(await logs(pg), [{ src: 'app_state', key: 'meetings', cat: null, by_emp: 'E1', by_name: 'Ann 試験', by_role: 'gm', by_dev: 'dev-A', by_kind: 'pc', via: 'app', parts: ['F01', 'F02'], more: false, n: 1 }]);
  await upKv(pg, 'meetings', { F01: { a: 1 }, F02: { b: 2 } });   // the same value (only updated_at moves)
  await as(pg, 'anon', ANN, () => pg.query(`update public.app_state set updated_at = now() where key = 'meetings'`));
  assert.equal((await sig(pg, 'meetings')).n, 1, 'no signal for a write that changed nothing');
  assert.equal((await logs(pg)).length, 1);
  await upKv(pg, 'meetings', { F01: { a: 1 }, F02: { b: 3 }, F03: {} });
  assert.equal((await sig(pg, 'meetings')).n, 2);
  const l = await logs(pg);
  assert.equal(l.length, 1, 'the same person, device and key within 5 minutes is one row');
  assert.deepEqual([l[0].n, l[0].parts], [2, ['F01', 'F02', 'F03']], 'parts are kept in the order they first changed');
});

test('another device, another person, or a write after 5 minutes is its own row; what was written is never kept', async () => {
  const pg = await setup();
  await upKv(pg, 'meetings', { F01: { amount: 123456, note: 'secret words' } });
  await upKv(pg, 'meetings', { F01: { amount: 7 }, F02: {} }, 'anon', BOB);
  await pg.query(`update change_log set at = at - interval '6 minutes', last_at = last_at - interval '6 minutes'`);
  await upKv(pg, 'meetings', { F01: { amount: 8 }, F02: {} }, 'anon', BOB);
  const l = await logs(pg);
  assert.deepEqual(l.map(r => [r.by_name, r.by_dev, r.n, r.parts]), [['Ann 試験', 'dev-A', 1, ['F01']], ['Bob Sample', 'dev-B', 1, ['F01', 'F02']], ['Bob Sample', 'dev-B', 1, ['F01']]]);
  const all = JSON.stringify((await pg.query('select * from change_log')).rows) + JSON.stringify((await pg.query('select * from sync_signal')).rows);
  assert.ok(!/123456|secret words/.test(all), 'no value is kept in the signal or the log');
  assert.deepEqual(await sig(pg, 'meetings'), { key: 'meetings', n: 3, by_emp: 'E2', by_dev: 'dev-B' });
});

test('the way a write came: app (with the header), old (an app without it), fn (the function with its checked actor), server, sql', async () => {
  const pg = await setup();
  await upKv(pg, 'k_app', { a: 1 });
  await upKv(pg, 'k_old', { a: 1 }, 'anon', null);
  await upKv(pg, 'k_server', { a: 1 }, 'service_role', null);
  await upKv(pg, 'k_fn', { a: 1 }, 'service_role', { e: 'E9', n: 'Gina GM', r: 'gm', f: '1' });
  await upKv(pg, 'k_fake', { a: 1 }, 'service_role', { e: 'E9', n: 'Gina GM', r: 'gm' });   // no f: a server writer that forwarded a header
  await upKv(pg, 'k_sql', { a: 1 }, 'postgres', null);
  await upKv(pg, 'k_bad', { a: 1 }, 'anon', '!!not base64 json!!');
  await upKv(pg, 'k_arr', { a: 1 }, 'anon', Buffer.from('[1,2]').toString('base64'));
  const v = Object.fromEntries((await logs(pg)).map(r => [r.key, [r.via, r.by_name]]));
  assert.deepEqual(v, { k_app: ['app', 'Ann 試験'], k_old: ['old', null], k_server: ['server', null], k_fn: ['fn', 'Gina GM'], k_fake: ['server', 'Gina GM'],
    k_sql: ['sql', null], k_bad: ['old', null], k_arr: ['old', null] });
  // a name longer than 120 characters and a very long header are cut / ignored
  await upKv(pg, 'k_long', { a: 1 }, 'anon', { ...ANN, n: 'x'.repeat(500), d: 'd'.repeat(200) });
  const r = (await logs(pg, "key = 'k_long'"))[0];
  assert.equal(r.by_name.length, 120); assert.equal(r.by_dev.length, 64);
  await upKv(pg, 'k_huge', { a: 1 }, 'anon', { ...ANN, n: 'y'.repeat(4000) });
  assert.equal((await logs(pg, "key = 'k_huge'"))[0].via, 'old', 'a header longer than 3000 characters is not read');
});

test('the secure keys: one signal per kind without the person, the log keeps only the kind (no key, no part, no person in the key)', async () => {
  const pg = await setup();
  const fn = { e: 'E9', n: 'Gina GM', r: 'gm', f: '1' };
  await upKv(pg, 'growth_karte', { 'Ann 試験': { pay: 1 } }, 'service_role', fn);
  await upKv(pg, 'lss_emp_Ann 試験', { A1: 3 }, 'service_role', fn);
  await upKv(pg, 'lss_emp_Bob Sample', { A1: 2 }, 'service_role', fn);
  await upKv(pg, 'spl_bonus_q_2026-Q3', { x: 1 }, 'service_role', fn);
  await upKv(pg, 'emp_pii', { E1: { dob: '1990-01-01' } }, 'service_role', fn);
  assert.deepEqual(await sigs(pg), ['_secure:bonus:1', '_secure:career_score:2', '_secure:karte:1', '_secure:pii:1']);
  assert.ok((await pg.query('select by_emp from sync_signal')).rows.every(r => r.by_emp === null), 'no person on a secure signal');
  const l = await logs(pg);
  assert.deepEqual(l.map(r => [r.key, r.cat, r.parts, r.n, r.via, r.by_name]), [
    ['_secure', 'karte', [], 1, 'fn', 'Gina GM'], ['_secure', 'career_score', [], 2, 'fn', 'Gina GM'], ['_secure', 'bonus', [], 1, 'fn', 'Gina GM'], ['_secure', 'pii', [], 1, 'fn', 'Gina GM']]);
  assert.ok(!/Ann|Bob|1990/.test(JSON.stringify(l)), 'no person or value of a secure key in the log');
  // the app (anon) cannot write a secure key at all (v1139), so nothing is signalled for it
  await assert.rejects(upKv(pg, 'growth_karte', { x: 1 }));
});

test('app_settings signals set:<key>; the master tables signal m:<table> with the changed rows only', async () => {
  const pg = await setup();
  await upKv(pg, 'm_store_kpi', { F01: 1 }, 'anon', ANN, 'app_settings');
  assert.ok(await sig(pg, 'set:m_store_kpi'));
  const up = (rows, actor = ANN) => as(pg, 'anon', actor, () => pg.query(`insert into public.stores(id, name, data)
    select r->>'id', r->>'name', r->'data' from jsonb_array_elements($1::jsonb) r on conflict (id) do update set name = excluded.name, data = excluded.data, updated_at = now()`, [JSON.stringify(rows)]));
  await up([{ id: 'F01', name: 'A', data: {} }, { id: 'F02', name: 'B', data: {} }]);
  await up([{ id: 'F01', name: 'A2', data: {} }, { id: 'F02', name: 'B', data: {} }]);   // only F01 changed
  await up([{ id: 'F01', name: 'A2', data: {} }, { id: 'F02', name: 'B', data: {} }]);   // nothing changed (updated_at only)
  assert.equal((await sig(pg, 'm:stores')).n, 2);
  const l = await logs(pg, "src = 'stores'");
  assert.deepEqual(l.map(r => [r.key, r.n, r.parts]), [['stores', 2, ['F01', 'F02']]]);
  await as(pg, 'anon', BOB, () => pg.query(`delete from public.stores where id = 'F02'`));
  assert.deepEqual((await logs(pg, "src = 'stores' and by_dev = 'dev-B'")).map(r => r.parts), [['F02']]);
  assert.equal((await sig(pg, 'm:stores')).by_emp, 'E2');
  // many rows in one write: the first 50 and "more"
  const many = Array.from({ length: 60 }, (_, i) => ({ code: 'I' + String(i).padStart(3, '0'), name: 'n' + i, data: {} }));
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.ingredients(code, name, data) select r->>'code', r->>'name', r->'data' from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(many)]));
  const li = (await logs(pg, "src = 'ingredients'"))[0];
  assert.deepEqual([li.parts.length, li.parts[0], li.parts[49], li.more], [50, 'I000', 'I049', true]);
  assert.equal((await sig(pg, 'm:ingredients')).n, 1, 'one signal for one write');
});

test('many keys in one write are one signal "*" (every device takes everything again); invoice_purchase_* and lunch_photo_* are not signalled', async () => {
  const pg = await setup();
  const rows = Array.from({ length: 150 }, (_, i) => ({ key: 'bulk_' + String(i).padStart(3, '0'), value: { a: i } }));
  rows.push({ key: 'lss_emp_Ann 試験', value: {} });   // a secure key in the batch (written by the server): its name is not a part
  await as(pg, 'service_role', null, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(rows)]));
  assert.deepEqual(await sigs(pg), ['*:1']);
  const l = (await logs(pg))[0];
  assert.deepEqual([l.key, l.parts.length, l.more, l.via], ['*', 50, true, 'server']);
  assert.ok(!JSON.stringify(l.parts).includes('lss_emp'), 'a secure key name is not a part');
  await upKv(pg, 'invoice_purchase_F01_2026-10', { a: 1 }, 'service_role', null);
  await upKv(pg, 'lunch_photo_x', { a: 1 });
  assert.deepEqual(await sigs(pg), ['*:1']);
  // 100 keys or fewer are signalled one by one
  const rows2 = Array.from({ length: 3 }, (_, i) => ({ key: 'small_' + i, value: { a: i } }));
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(rows2)]));
  assert.deepEqual(await sigs(pg), ['*:1', 'small_0:1', 'small_1:1', 'small_2:1']);
});

test('in one write with several rows: rows whose value did not change and invoice_purchase_* / lunch_photo_* rows are left out, and do not count toward "*"', async () => {
  const pg = await setup();
  const many = Array.from({ length: 120 }, (_, i) => ({ key: 'same_' + String(i).padStart(3, '0'), value: { a: i } }));
  await as(pg, 'service_role', null, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(many)]));
  await pg.query('delete from sync_signal'); await pg.query('delete from change_log');
  // 120 rows written again in one statement, only one of them really changed: one signal for that key (not "*")
  const again = many.map((r, i) => (i === 7 ? { key: r.key, value: { a: 'changed' } } : r));
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(again)]));
  assert.deepEqual(await sigs(pg), ['same_007:1']);
  // one statement that changes a row and writes another row with the same value: only the changed row
  await as(pg, 'anon', ANN, () => pg.query(`update public.app_state set value = case when key = 'same_001' then '{"a":"x"}'::jsonb else value end, updated_at = now() where key in ('same_001', 'same_002')`));
  assert.deepEqual(await sigs(pg), ['same_001:1', 'same_007:1']);
  assert.deepEqual((await logs(pg)).map(r => r.key).sort(), ['same_001', 'same_007']);
  // one statement with a normal key and the keys that are never signalled (insert, update, delete)
  const mixed = [{ key: 'meetings', value: { F01: {} } }, { key: 'invoice_purchase_F01_2026-10', value: { a: 1 } }, { key: 'lunch_photo_y', value: { a: 1 } }];
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(mixed)]));
  await as(pg, 'anon', ANN, () => pg.query(`update public.app_state set value = jsonb_build_object('b', key), updated_at = now() where key in ('meetings', 'invoice_purchase_F01_2026-10', 'lunch_photo_y')`));
  await as(pg, 'anon', ANN, () => pg.query(`delete from public.app_state where key in ('meetings', 'invoice_purchase_F01_2026-10', 'lunch_photo_y')`));
  assert.deepEqual(await sigs(pg), ['meetings:3', 'same_001:1', 'same_007:1']);
  assert.ok(!(await logs(pg)).some(r => /invoice_purchase|lunch_photo/.test(r.key)), 'never in the log');
});

test('parts: a wrapped value is compared inside, arrays by id, more than 50 is "more", a value over 1 MB gives no parts', async () => {
  const pg = await setup();
  await upKv(pg, 'wrapped', { __st: 1, v: { a: 1, b: 2 } });
  await upKv(pg, 'wrapped', { __st: 1, v: { a: 1, b: 3 } });
  assert.deepEqual((await logs(pg, "key = 'wrapped'"))[0].parts, ['a', 'b']);
  await upKv(pg, 'list', [{ id: 'x', v: 1 }, { id: 'y', v: 1 }, { code: 'z', v: 1 }]);
  await pg.query(`update change_log set at = at - interval '6 minutes', last_at = last_at - interval '6 minutes'`);
  await upKv(pg, 'list', [{ id: 'x', v: 1 }, { id: 'y', v: 2 }]);
  assert.deepEqual((await logs(pg, "key = 'list'")).map(r => r.parts), [['x', 'y', 'z'], ['y', 'z']]);
  const wide = Object.fromEntries(Array.from({ length: 70 }, (_, i) => ['f' + String(i).padStart(2, '0'), i]));
  await upKv(pg, 'wide', wide);
  const w = (await logs(pg, "key = 'wide'"))[0];
  assert.deepEqual([w.parts.length, w.more], [50, true]);
  const big = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => ['k' + i, 'z'.repeat(300)]));
  await upKv(pg, 'big', big);
  const b = (await logs(pg, "key = 'big'"))[0];
  assert.deepEqual([b.parts, b.more], [[], true]);
  assert.equal((await pg.query(`select count(*)::int c from app_state where key = 'big'`)).rows[0].c, 1, 'the big value is saved');
});

test('who can read and write: the signal is public to read only; the log is the server\'s only; the functions are not callable by the public key', async () => {
  const pg = await setup();
  await upKv(pg, 'meetings', { a: 1 });
  assert.equal((await as(pg, 'anon', null, () => pg.query('select count(*)::int c from sync_signal'))).rows[0].c, 1);
  await assert.rejects(as(pg, 'anon', null, () => pg.query('select * from change_log')), /permission denied/);
  await assert.rejects(as(pg, 'authenticated', null, () => pg.query('select * from change_log')), /permission denied/);
  await assert.rejects(as(pg, 'anon', null, () => pg.query(`insert into sync_signal(key) values ('x')`)), /permission denied/);
  await assert.rejects(as(pg, 'anon', null, () => pg.query(`update sync_signal set n = 0`)), /permission denied/);
  await assert.rejects(as(pg, 'anon', null, () => pg.query(`insert into change_log(src, key, via) values ('a', 'b', 'app')`)), /permission denied/);
  await assert.rejects(as(pg, 'anon', null, () => pg.query(`select public.fp_note('app_state', 'x', false, null, '[]', null, 'app')`)), /permission denied/);
  assert.equal((await as(pg, 'service_role', null, () => pg.query('select count(*)::int c from change_log'))).rows[0].c, 1);
});

test('a failure of the signal or the log never stops the save (and leaves no half signal)', async () => {
  const pg = await setup();
  await pg.exec(`alter table public.change_log add constraint test_break check (n < 0) not valid`);
  await upKv(pg, 'meetings', { a: 1 });
  assert.deepEqual((await pg.query(`select value from app_state where key = 'meetings'`)).rows[0].value, { a: 1 }, 'saved');
  assert.equal(await sig(pg, 'meetings'), null, 'the signal is taken back with the failed log');
  await pg.exec(`alter table public.change_log drop constraint test_break`);
  await upKv(pg, 'meetings', { a: 2 });
  assert.equal((await sig(pg, 'meetings')).n, 1);
});

test('old rows (more than a year) are removed little by little; the newer rows stay', async () => {
  const pg = await setup();
  await pg.query(`insert into change_log(src, key, via, at, last_at) select 'app_state', 'old_' || g, 'app', now() - interval '400 days', now() - interval '400 days' from generate_series(1, 150) g`);
  await pg.query(`insert into change_log(src, key, via, at, last_at) select 'app_state', 'recent_' || g, 'app', now() - interval '300 days', now() - interval '300 days' from generate_series(1, 30) g`);
  for (let i = 0; i < 25; i++) await upKv(pg, 'k' + i, { a: 1 });   // the 200th row removes up to 500 old rows
  const c = (await pg.query(`select count(*) filter (where key like 'old_%')::int o, count(*) filter (where key like 'recent_%')::int r from change_log`)).rows[0];
  assert.deepEqual(c, { o: 0, r: 30 });
});

test('the migration twice is the same; the precheck and the postcheck read OK; the rollback stops the signals and keeps the log', async () => {
  const pg0 = await setup({ mig: false });
  const pre = (await pg0.query(PRE)).rows;
  assert.ok(pre.length >= 9 && pre.every(r => !String(r.ok).startsWith('STOP')), JSON.stringify(pre));
  const pg = await setup();
  await upKv(pg, 'meetings', { a: 1 });
  await pg.exec(MIG);
  await upKv(pg, 'meetings', { a: 2 });
  assert.equal((await sig(pg, 'meetings')).n, 2, 'one trigger each after the second run');
  assert.equal((await pg.query(`select count(*)::int c from pg_trigger where tgname like 'fp\\_sig\\_%'`)).rows[0].c, 15, '3 x app_state, app_settings, stores, employees, ingredients');
  const post = (await pg.exec(POST)).at(-2).rows;   // the last statement is rollback
  assert.ok(post.length >= 8, JSON.stringify(post));
  for (const r of post) assert.ok(['OK', 'info'].includes(r.ok), JSON.stringify(r));
  assert.equal(await sig(pg, '_fp_postcheck'), null, 'the postcheck leaves nothing');
  assert.equal((await pg.query(`select count(*)::int c from app_state where key = '_fp_postcheck'`)).rows[0].c, 0);
  await pg.exec(ROLLBACK); await pg.exec(ROLLBACK);
  await upKv(pg, 'meetings', { a: 3 });
  assert.equal((await sig(pg, 'meetings')).n, 2, 'no signal after the rollback');
  assert.equal((await pg.query('select count(*)::int c from change_log')).rows[0].c, 1, 'the log is kept');
  assert.equal((await pg.query(`select count(*)::int c from pg_proc where proname like 'fp\\_%'`)).rows[0].c, 0);
  await pg.exec(MIG);   // put back again
  await upKv(pg, 'meetings', { a: 4 });
  assert.equal((await sig(pg, 'meetings')).n, 3);
});

test('a one-row save stays quick with the watchers (synthetic sizes)', async () => {
  const pg = await setup();
  const big = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['k' + i, { name: 'item ' + i, price: i, note: 'x'.repeat(200) }]));
  await upKv(pg, 'big', big);
  let t = performance.now();
  for (let i = 0; i < 5; i++) { big.k7.price = i; await upKv(pg, 'big', big); }
  const ms = (performance.now() - t) / 5;
  assert.ok(ms < 500, 'one save of about 0.5 MB: ' + ms.toFixed(1) + ' ms');
  const rows = Array.from({ length: 800 }, (_, i) => ({ key: 'b' + i, value: { a: i } }));
  t = performance.now();
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r on conflict (key) do update set value = excluded.value`, [JSON.stringify(rows)]));
  rows.forEach(r => r.value.a++);
  await as(pg, 'anon', ANN, () => pg.query(`insert into public.app_state(key, value) select r->>'key', r->'value' from jsonb_array_elements($1::jsonb) r on conflict (key) do update set value = excluded.value`, [JSON.stringify(rows)]));
  assert.ok(performance.now() - t < 2500, 'two writes of 800 rows');
});
