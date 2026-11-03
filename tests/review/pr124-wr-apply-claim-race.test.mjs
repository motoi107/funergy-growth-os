// #124 review (Codex P2-1): the v1132 app wrote the official value before it recorded the apply, so a close from another device
// during the slow read (or while the Tip Rate check was open) did not stop the write. v1133 claims the request first
// (apply_start, a row lock and the version check) and only the claimer records the result with its key.
//
// Two sessions have to overlap at READ COMMITTED to show the order. PGlite is one backend, so this file starts a real PostgreSQL in a
// temporary directory, applies the real migrations (stage 1, stage 2, v1133) and talks to it with psql. Synthetic data only: no production
// data, no network, nothing written outside the temp directory. It skips itself where no PostgreSQL is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

// --- a real PostgreSQL in a temporary directory -------------------------------------------------------
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-claim-'));
  if (RUN_AS.uid != null) { fs.chownSync(dir, RUN_AS.uid, RUN_AS.gid); fs.chmodSync(dir, 0o700); }
  const data = path.join(dir, 'data'), port = String(5440 + Math.floor(Math.random() * 90));
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

  // One statement, its own session.
  const one = async text => (await run('psql', [...conn, '-c', text])).out.trim();
  // A session that stays open, so a transaction can hold a lock while another session runs.
  const session = () => {
    const p = spawn(path.join(BIN, 'psql'), conn, { ...RUN_AS, env: { ...process.env, PGUSER: 'postgres', HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', waiter = null;
    const check = () => { if (waiter && out.includes('@@END@@')) { const w = waiter; waiter = null; const [body] = out.split('@@END@@'); const e = err; out = out.slice(out.indexOf('@@END@@') + 7); err = ''; w({ out: body.trim(), err: e.trim() }); } };
    p.stdout.on('data', d => { out += d; check(); }); p.stderr.on('data', d => { err += d; });
    t.after(() => p.kill('SIGKILL'));
    return {
      // Resolves when the statement has answered. `answered` stays false while the session waits on a lock.
      send(text) {
        let done = false;
        const answer = new Promise(res => { waiter = v => { done = true; res(v); }; check(); });
        const line = text.replace(/\n/g, ' ').trim();
        // psql holds a statement until a semicolon, while \echo runs at once: without this the marker
        // would come back before the statement had run.
        p.stdin.write(line + (line.endsWith(';') ? '' : ';') + '\n\\echo @@END@@\n');
        return { answer, get answered() { return done; } };
      },
      async sendWait(text) { return (await this.send(text)).answer; },
    };
  };
  return { dir, port, one, session, stop };
}


const q = o => "'" + JSON.stringify(o).replace(/'/g, "''") + "'::jsonb";
const waitFor = async (fn, why, ms = 10000) => {
  const until = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error('timed out waiting for ' + why); await new Promise(r => setTimeout(r, 50)); }
};
const GM = { emp_id: 'E2', name: 'Gabe GM' }, CEO = { emp_id: 'E1', name: 'Cora CEO' };
const act = (who, op, rev, key, extra = {}) => `select public.wr_act(${q({ ...who, id: '00000000-0000-4000-8000-000000000001', action: op, expect_rev: rev, client_key: key, ...extra })})::text`;

async function fixture(C) {
  const boot = `create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.employees values ('E1','Cora CEO','ceo','CEO','OFFICE','[]','在籍','{}'),('E2','Gabe GM','gm','General Manager','OFFICE','[]','在籍','{}'),
      ('E6','Sam Store','sl','Store Manager','S1','[]','在籍','{}'),('E8','Cam Crew','crew','Crew','S1','[]','在籍','{}');
    insert into public.manager_auth(role, emp_id) values ('ceo','E1'),('gm','E2');`;
  fs.writeFileSync(path.join(C.dir, 'boot.sql'), boot);
  const mig = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql'];
  mig.forEach((f, i) => fs.copyFileSync(new URL('../../supabase/migrations/' + f, import.meta.url), path.join(C.dir, 'm' + i + '.sql')));
  const file = f => run('psql', ['-h', C.dir, '-p', C.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(C.dir, f)]);
  await file('boot.sql'); for (let i = 0; i < mig.length; i++) await file('m' + i + '.sql');
  // an approved skill request (written directly: the test is about applying it)
  await C.one(`update public.wr_settings set live = true;
    insert into public.wr_requests(id, code, kind, status, store_id, requester_emp, requester_name, target_emp, target_name, payload, approved_by, approved_emp, approved_at)
     values ('00000000-0000-4000-8000-000000000001', 'SK-2611-0001', 'skill', 'approved', 'S1', 'E6', 'Sam Store', 'E8', 'Cam Crew',
      '{"target_emp":"E8","reason":"r","items":[{"pos":"Grill","from":1,"to":2}]}', 'Gabe GM', 'E2', now());`);
}

test('#124 [P2-1]: the GM claims while another device closes at the same moment — the close waits, then finds the claim and is refused', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const a = C.session(), b = C.session();
  await a.sendWait('set role service_role'); await b.sendWait('set role service_role');
  const ra = await a.sendWait('begin; ' + act(GM, 'apply_start', 1, 'k-claim-aaaa-0001'));
  assert.match(ra.out, /"apply_done"/, 'the GM holds the request (not committed yet)');
  const pb = b.send(act(CEO, 'reject', 1, 'k-close-bbbb-0002', { note: '別の値にした' }));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'`)) >= 1, 'the close to wait on the row');
  assert.equal(pb.answered, false, 'the close waits for the claim');
  await a.sendWait('commit');
  const rb = await pb.answer;
  assert.match(rb.err, /conflict/, 'the close was for the version before the claim');
  const rc = await b.sendWait(act(CEO, 'reject', 2, 'k-close-bbbb-0003', { note: '別の値にした' }));
  assert.match(rc.err, /forbidden/, 'with the new version it is still refused while the GM applies');
  assert.equal(await C.one(`select status || ' ' || apply_emp from public.wr_requests`), 'approved E2');
});

test('#124 [P2-1]: the close comes first — the GM’s claim waits, then finds the request closed and the app writes nothing', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const a = C.session(), b = C.session();
  await a.sendWait('set role service_role'); await b.sendWait('set role service_role');
  const rb = await b.sendWait('begin; ' + act(CEO, 'reject', 1, 'k-close-bbbb-0004', { note: '別の値にした' }));
  assert.match(rb.out, /"rejected"/);
  const pa = a.send(act(GM, 'apply_start', 1, 'k-claim-aaaa-0005'));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'`)) >= 1, 'the claim to wait on the row');
  assert.equal(pa.answered, false);
  await b.sendWait('commit');
  const ra = await pa.answer;
  assert.match(ra.err, /conflict/, 'no claim: the app does not write');
  assert.equal(await C.one(`select status || ' ' || coalesce(apply_emp, '-') from public.wr_requests`), 'rejected -');
});

test('#124: two devices claim at once — one holds it, the other is told it moved', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const a = C.session(), b = C.session();
  await a.sendWait('set role service_role'); await b.sendWait('set role service_role');
  const ra = await a.sendWait('begin; ' + act(GM, 'apply_start', 1, 'k-claim-aaaa-0006'));
  assert.match(ra.out, /"apply_done"/);
  const pb = b.send(act(GM, 'apply_start', 1, 'k-claim-bbbb-0007'));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'`)) >= 1, 'the second claim to wait');
  await a.sendWait('commit');
  assert.match((await pb.answer).err, /conflict/);
  assert.equal(await C.one(`select apply_key from public.wr_requests`), 'k-claim-aaaa-0006', 'the first device holds it');
});
