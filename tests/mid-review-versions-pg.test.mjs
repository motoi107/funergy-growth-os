// 中間レビュー v1073（Codex のレビュー 685f49e の P2）：担当・閲覧設定と ON・OFF の版を、本物の PostgreSQL の 2 つのセッションで確かめる。
// PGlite は 1 本の接続しか無く、2 つのトランザクションを重ねられない。ここでは一時フォルダに本物の PostgreSQL を立て、
// 本物の migration（v1066 → v1068 → v2 → v1073）を流し、psql の 2 つのセッションで「片方が保存して、まだコミットしていない
// ときに、同じ版を読んだもう片方が保存する」順序を作る。あとの保存は待ち、先の保存がコミットされたら conflict になり、
// 何も上書きしない（v2 の関数のままだと、待ったあとに先の変更を戻す）。
// 合成データだけ。本番データ・ネットワークは使わない。一時フォルダの外には書かない。PostgreSQL が無い環境では理由を出して飛ばす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const MIGRATIONS = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql', '20261016090000_mid_review_v2_versions.sql', '20261017090000_mid_review_stores_save_fix.sql'];
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2' };

// --- a real PostgreSQL in a temporary directory (the same harness as tests/review/pr45-mid-review-lock-order.test.mjs) ---
const findBin = () => {
  const dirs = [];
  try { dirs.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()); } catch { /* no pg_config */ }
  try { for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) dirs.push(`/usr/lib/postgresql/${v}/bin`); } catch { /* not debian */ }
  dirs.push('/usr/local/pgsql/bin', '/opt/homebrew/bin', '/usr/bin');
  return dirs.find(d => d && ['initdb', 'postgres', 'pg_ctl', 'psql'].every(f => fs.existsSync(path.join(d, f)))) || null;
};
// PostgreSQL refuses to run as root, so as root we run it as an unprivileged account that already exists.
const findRunAs = () => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return {};
  const passwd = fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':'));
  for (const name of ['postgres', 'nobody']) {
    const row = passwd.find(p => p[0] === name);
    if (row) return { uid: Number(row[2]), gid: Number(row[3]), name };
  }
  return null;
};
const BIN = findBin(), RUN_AS = BIN ? findRunAs() : null;
const SKIP = !BIN ? 'no PostgreSQL server binaries (initdb / postgres / pg_ctl / psql) on this machine'
  : !RUN_AS ? 'running as root and neither the postgres nor the nobody account exists to run the server as' : false;

const run = (file, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(path.join(BIN, file), args, { ...RUN_AS, env: { ...process.env, PGUSER: 'postgres', ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('error', reject);
  p.on('close', code => (code === 0 || opts.allowFail ? resolve({ code, out, err }) : reject(new Error(`${file} exited ${code}\n${err}${out}`))));
});

async function cluster(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ver-'));
  if (RUN_AS.uid != null) { fs.chownSync(dir, RUN_AS.uid, RUN_AS.gid); fs.chmodSync(dir, 0o700); }
  const data = path.join(dir, 'data'), port = String(5530 + Math.floor(Math.random() * 90));
  const conn = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=0', '-q', '-A', '-t'];
  await run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { env: { HOME: dir } });
  await run('pg_ctl', ['-D', data, '-l', path.join(dir, 'log.txt'), '-w', '-o',
    `-c listen_addresses='' -c unix_socket_directories=${dir} -p ${port}`, 'start'], { env: { HOME: dir } });
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    await run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop'], { allowFail: true, env: { HOME: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
  };
  t.after(stop);
  const one = async text => (await run('psql', [...conn, '-c', text])).out.trim();
  // A session that stays open, so a transaction can hold a lock while another session runs.
  const session = () => {
    const p = spawn(path.join(BIN, 'psql'), conn, { ...RUN_AS, env: { ...process.env, PGUSER: 'postgres', HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', waiter = null;
    const check = () => { if (waiter && out.includes('@@END@@')) { const w = waiter; waiter = null; const [body] = out.split('@@END@@'); const e = err; out = out.slice(out.indexOf('@@END@@') + 7); err = ''; w({ out: body.trim(), err: e.trim() }); } };
    p.stdout.on('data', d => { out += d; check(); }); p.stderr.on('data', d => { err += d; });
    t.after(() => p.kill('SIGKILL'));
    return {
      send(text) {
        let done = false;
        const answer = new Promise(res => { waiter = v => { done = true; res(v); }; check(); });
        const line = text.replace(/\n/g, ' ').trim();
        p.stdin.write(line + (line.endsWith(';') ? '' : ';') + '\n\\echo @@END@@\n');
        return { answer, get answered() { return done; } };
      },
      async sendWait(text) { return (await this.send(text)).answer; },
    };
  };
  const file = f => run('psql', ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(dir, f)]);
  return { dir, one, session, file };
}

const LOCK_WAITS = `select count(*) from pg_stat_activity where wait_event_type='Lock'`;
const q = o => "'" + JSON.stringify(o).replace(/'/g, "''") + "'::jsonb";
const rpc = (name, payload) => `select public.${name}(${q(payload)})::text`;
const waitFor = async (fn, why, ms = 10000) => {
  const until = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error('timed out waiting for ' + why); await new Promise(r => setTimeout(r, 50)); }
};

// The masters with fictional people, every migration, the switches on and one live store with its input person.
async function fixture(C) {
  fs.writeFileSync(path.join(C.dir, 'bootstrap.sql'), `create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, emp_code text, role text, perms jsonb, title text, store text, support jsonb, status text, emp_type text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into public.employees(id, name, role, title, status) values ('E1','CEO Test','ceo','CEO','在籍'),('E2','GM Test','gm','General Manager','在籍'),
     ('E6','AM Two','am','Area Manager','在籍'),('E12','Server Lead','g3','Server Leader','在籍'),('E13','Store Mgr','g4','Store Manager','在籍');
    insert into public.stores(id, name, am, active) values ('F01','ToriTon',null,true);
    insert into public.manager_auth(user_id, role, emp_id) values ('${U.ceo}','ceo','E1'),('${U.gm}','gm','E2');`);
  await C.file('bootstrap.sql');
  for (const f of MIGRATIONS) { fs.copyFileSync(new URL('../supabase/migrations/' + f, import.meta.url), path.join(C.dir, f)); await C.file(f); }
  const as = (who, name, p) => C.one(`set role service_role; ${rpc(name, { actor: U[who], via: 'email', ...p })}`);
  await as('gm', 'mr_settings_save', { key: 'flags', value: { private: true }, expect_version: 0 });
  await as('gm', 'mr_stores_save', { stores: [{ store_id: 'F01', name: 'ToriTon', am_user: null, sort: 1, expect_version: 0 }] });
  await as('gm', 'mr_access_save', { stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: [], expect_version: 0 }] });
  // (read through to_jsonb so the same file also runs on the v2 SQL alone and shows what went wrong there: version 0 there)
  const row = async () => JSON.parse(await C.one(`select jsonb_build_object('input_emp', s.input_emp, 'viewer_emps', s.viewer_emps,
    'version', coalesce((to_jsonb(s)->>'access_version')::int, 0))::text from mr_stores s where s.env='live' and s.store_id='F01'`));
  const flags = async () => JSON.parse(await C.one(`select jsonb_build_object('value', s.value, 'version', coalesce((to_jsonb(s)->>'version')::int, 0))::text from mr_settings s where s.key='flags'`));
  return { row, flags };
}

test('v1073 [Codex P2] two sessions save 担当・閲覧設定 of the same store on the same version: the later one waits, then gets conflict and puts nothing back', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const v = (await F.row()).version;
  assert.deepEqual(await F.row(), { input_emp: 'E12', viewer_emps: [], version: v });
  const gm = C.session(), ceo = C.session();
  await gm.sendWait('set role service_role'); await ceo.sendWait('set role service_role');
  // GM: a new input person, saved but not committed yet.
  const a = await gm.sendWait(`begin; ${rpc('mr_access_save', { actor: U.gm, via: 'email', stores: [{ store_id: 'F01', input_emp: 'E13', viewer_emps: [], expect_version: v }] })}`);
  assert.match(a.out, /"saved": 1/, a.err);
  // CEO, on the same version: adds a viewer and sends back the input person it read (E12).
  const b = ceo.send(rpc('mr_access_save', { actor: U.ceo, via: 'email', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: ['E6'], expect_version: v }] }));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the second save to wait or to answer');
  assert.equal(b.answered, false, 'the second save waits for the first one');
  await gm.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.out, '', 'the second save returns nothing');
  assert.match(r.err, /conflict/, 'the second save is refused with conflict');
  assert.deepEqual(await F.row(), { input_emp: 'E13', viewer_emps: [], version: v + 1 }, 'the first save stays; nothing was put back');
  // On the version it reads now, the CEO's viewer goes in and the GM's input person stays.
  const c = await C.one(`set role service_role; ${rpc('mr_access_save', { actor: U.ceo, via: 'email', stores: [{ store_id: 'F01', input_emp: 'E13', viewer_emps: ['E6'], expect_version: v + 1 }] })}`);
  assert.match(c, /"saved": 1/);
  assert.deepEqual(await F.row(), { input_emp: 'E13', viewer_emps: ['E6'], version: v + 2 });
});

test('v1073 [Codex P2] two sessions save the switches on the same version: the later one waits, then gets conflict and puts nothing back', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const f0 = await F.flags();
  assert.deepEqual(f0.value, { private: true, store_publish: false, notify: false, live_input: false });
  const gm = C.session(), ceo = C.session();
  await gm.sendWait('set role service_role'); await ceo.sendWait('set role service_role');
  // GM turns live input on (not committed yet).
  const a = await gm.sendWait(`begin; ${rpc('mr_settings_save', { actor: U.gm, via: 'email', key: 'flags', value: { private: true, live_input: true }, expect_version: f0.version })}`);
  assert.match(a.out, /"live_input": true/, a.err);
  // CEO, on the same version: turns the private check off and sends back live input as read (off).
  const b = ceo.send(rpc('mr_settings_save', { actor: U.ceo, via: 'email', key: 'flags', value: { private: false, live_input: false }, expect_version: f0.version }));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the second save to wait or to answer');
  assert.equal(b.answered, false, 'the second save waits for the first one');
  await gm.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.out, ''); assert.match(r.err, /conflict/);
  assert.deepEqual(await F.flags(), { value: { private: true, store_publish: false, notify: false, live_input: true }, version: f0.version + 1 });
});

test('v1073 the switches: a save that reads while another one is in the middle of writing waits for it (the row is held from the read), then gets conflict', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const f0 = await F.flags();
  // A pause inside the first save's write, only to fix the order of the two sessions: the version trigger waits on an
  // advisory lock when the private check is being turned off. Its answer is unchanged.
  const KEY = 918073;
  await C.one(`create or replace function public.mrt_pause() returns trigger language plpgsql as $f$
    begin if new.value->>'private' = 'false' then perform pg_advisory_lock(${KEY}); perform pg_advisory_unlock(${KEY}); end if; return new; end $f$;
    create trigger mrt_pause before update on public.mr_settings for each row execute function public.mrt_pause();`);
  const first = C.session(), second = C.session(), pauser = C.session();
  for (const s of [first, second, pauser]) await s.sendWait('set role service_role');
  await pauser.sendWait(`select pg_advisory_lock(${KEY})`);
  // 1. The CEO's save has read the version and stops in the middle of writing (the private check off).
  const a = first.send(rpc('mr_settings_save', { actor: U.ceo, via: 'email', key: 'flags', value: { private: false, live_input: false }, expect_version: f0.version }));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_locks where locktype='advisory' and not granted`)) > 0, 'the first save to reach the pause');
  // 2. The GM's save, read on the same version, comes in now (live input on).
  const b = second.send(rpc('mr_settings_save', { actor: U.gm, via: 'email', key: 'flags', value: { private: true, live_input: true }, expect_version: f0.version }));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the second save to wait or to answer');
  const waited = !b.answered;
  // 3. The first save goes on and commits.
  await pauser.sendWait(`select pg_advisory_unlock(${KEY})`);
  const ra = await a.answer, rb = await b.answer;
  t.diagnostic(JSON.stringify({ waited, first: ra, second: rb }));
  assert.match(ra.out, /"private": false/, ra.err);
  assert.equal(waited, true, 'the second save waits from its read (the row is held), not only at its write');
  assert.equal(rb.out, ''); assert.match(rb.err, /conflict/);
  assert.deepEqual(await F.flags(), { value: { private: false, store_publish: false, notify: false, live_input: false }, version: f0.version + 1 },
    'the first save stays; live input was not put on over it');
});

test('v1073 店舗の管轄: two sessions save a store that was not saved yet (version 0): the later one waits, then gets conflict and writes nothing over it', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const gm = C.session(), ceo = C.session();
  await gm.sendWait('set role service_role'); await ceo.sendWait('set role service_role');
  const store = { store_id: 'F07', name: 'Kapolei', sort: 2, expect_version: 0 };
  const a = await gm.sendWait(`begin; ${rpc('mr_stores_save', { actor: U.gm, via: 'email', stores: [{ ...store, am_user: null }] })}`);
  assert.match(a.out, /"saved": 1/, a.err);
  const b = ceo.send(rpc('mr_stores_save', { actor: U.ceo, via: 'email', stores: [{ ...store, name: 'Kapolei (CEO)', am_user: null }] }));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the second save to wait or to answer');
  assert.equal(b.answered, false, 'the second save waits for the first one');
  await gm.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.out, ''); assert.match(r.err, /conflict/);
  assert.equal(await C.one(`select name || '|' || coalesce((to_jsonb(s)->>'am_version'), '?') from mr_stores s where env='live' and store_id='F07'`), 'Kapolei|1');
});

test('v1073 店舗の管轄: two sessions put in the same two new stores sent in the other order: no deadlock — the later one waits, then gets conflict', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  // A pause in the first session only, when it puts in F08 (after F07), to fix the order. The answers are unchanged.
  const KEY = 918074;
  await C.one(`create or replace function public.mrt_pause_ins() returns trigger language plpgsql as $f$
    begin if current_setting('mrt.who', true) = 'a' and new.store_id = 'F08' then perform pg_advisory_lock(${KEY}); perform pg_advisory_unlock(${KEY}); end if; return new; end $f$;
    create trigger mrt_pause_ins before insert on public.mr_stores for each row execute function public.mrt_pause_ins();`);
  const a = C.session(), b = C.session(), pauser = C.session();
  await a.sendWait(`set role service_role; set mrt.who = 'a'`); await b.sendWait('set role service_role'); await pauser.sendWait(`select pg_advisory_lock(${KEY})`);
  const F07 = { store_id: 'F07', name: 'Kapolei', sort: 2, am_user: null, expect_version: 0 }, F08 = { store_id: 'F08', name: 'Ewa', sort: 3, am_user: null, expect_version: 0 };
  // 1. The GM's save (F07, F08) has put in F07 and stops before F08.
  const ra = a.send(rpc('mr_stores_save', { actor: U.gm, via: 'email', stores: [F07, F08] }));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_locks where locktype='advisory' and not granted`)) > 0, 'the first save to reach the pause');
  // 2. The CEO's save sends them the other way round (F08, F07).
  const rb = b.send(rpc('mr_stores_save', { actor: U.ceo, via: 'email', stores: [{ ...F08, name: 'Ewa (CEO)' }, { ...F07, name: 'Kapolei (CEO)' }] }));
  await waitFor(async () => rb.answered || Number(await C.one(LOCK_WAITS)) > 1, 'the second save to wait or to answer');
  // 3. The first one goes on.
  await pauser.sendWait(`select pg_advisory_unlock(${KEY})`);
  const x = await ra.answer, y = await rb.answer;
  t.diagnostic(JSON.stringify({ first: x, second: y }));
  assert.match(x.out, /"saved": 2/, x.err);
  assert.doesNotMatch(y.err, /deadlock/); assert.equal(y.out, ''); assert.match(y.err, /conflict/);
  assert.equal(await C.one(`select string_agg(store_id || ':' || name || ':' || (to_jsonb(s)->>'am_version'), ',' order by store_id) from mr_stores s where env='live' and store_id in ('F07','F08')`), 'F07:Kapolei:1,F08:Ewa:1');
});

test('v1073 店舗の管轄: two sessions save the same saved store on the same version: the later one waits, then gets conflict and puts nothing back', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const row = async () => C.one(`select name || '|' || coalesce(am_user::text, '-') || '|' || (to_jsonb(s)->>'am_version') from mr_stores s where env='live' and store_id='F01'`);
  assert.equal(await row(), 'ToriTon|-|1');
  const gm = C.session(), ceo = C.session();
  await gm.sendWait('set role service_role'); await ceo.sendWait('set role service_role');
  const a = await gm.sendWait(`begin; ${rpc('mr_stores_save', { actor: U.gm, via: 'email', stores: [{ store_id: 'F01', name: 'ToriTon Kaimuki', am_user: null, sort: 1, expect_version: 1 }] })}`);
  assert.match(a.out, /"saved": 1/, a.err);
  const b = ceo.send(rpc('mr_stores_save', { actor: U.ceo, via: 'email', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: null, sort: 5, expect_version: 1 }] }));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the second save to wait or to answer');
  assert.equal(b.answered, false, 'the second save waits for the first one (the row is held before the compare)');
  await gm.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.out, ''); assert.match(r.err, /conflict/);
  assert.equal(await row(), 'ToriTon Kaimuki|-|2', 'the first save stays; the older name was not put back');
});

// v1073 の直し（Codex `3fbd9dd` の P2）：A が既にある店（F01）とまだ無い店（F07）を保存し、版を比べ終えて F01 を書いているあいだに、
// B が F07 だけを保存してコミットする。A は F07 を「ある店」として見つけても、読んだ版（0）と違うので書かない（conflict）。
test('v1073 fix: a store another session puts in and commits after this save compared the versions is not written over (conflict)', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const KEY = 918075;
  await C.one(`create or replace function public.mrt_pause_upd() returns trigger language plpgsql as $f$
    begin if current_setting('mrt.who', true) = 'a' and new.store_id = 'F01' then perform pg_advisory_lock(${KEY}); perform pg_advisory_unlock(${KEY}); end if; return new; end $f$;
    create trigger mrt_pause_upd before update on public.mr_stores for each row execute function public.mrt_pause_upd();`);
  const a = C.session(), b = C.session(), pauser = C.session();
  await a.sendWait(`set role service_role; set mrt.who = 'a'`); await b.sendWait('set role service_role'); await pauser.sendWait(`select pg_advisory_lock(${KEY})`);
  const v01 = Number(await C.one(`select am_version from mr_stores where env='live' and store_id='F01'`));
  // 1. A (GM): F01 renamed and F07 new; compared, now writing F01 (stops there).
  const ra = a.send(rpc('mr_stores_save', { actor: U.gm, via: 'email', stores: [{ store_id: 'F01', name: 'ToriTon A', am_user: null, sort: 1, expect_version: v01 },
    { store_id: 'F07', name: 'Kapolei (A)', am_user: null, sort: 2, expect_version: 0 }] }));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_locks where locktype='advisory' and not granted`)) > 0, 'A to reach the pause');
  // 2. B (CEO): F07 only, committed.
  const rb = await b.sendWait(rpc('mr_stores_save', { actor: U.ceo, via: 'email', stores: [{ store_id: 'F07', name: 'Kapolei (B)', am_user: null, sort: 2, expect_version: 0 }] }));
  assert.match(rb.out, /"saved": 1/, rb.err);
  // 3. A goes on.
  await pauser.sendWait(`select pg_advisory_unlock(${KEY})`);
  const x = await ra.answer;
  t.diagnostic(JSON.stringify({ a: x, b: rb }));
  assert.equal(x.out, ''); assert.match(x.err, /conflict/);
  assert.equal(await C.one(`select string_agg(store_id || ':' || name || ':' || am_version, ',' order by store_id) from mr_stores s where env='live' and store_id in ('F01','F07')`),
    `F01:ToriTon:${v01},F07:Kapolei (B):1`, 'B stays; nothing of A was written');
});
