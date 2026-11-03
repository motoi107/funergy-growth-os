// #123 review (Codex P2): wr_submit looked for duplicates before any lock that two sends with different client keys share,
// so two sends of the same person, day and amount at the same time could both see "no duplicate" and both be saved.
// The fix takes an advisory lock on (kind, date, amount) before looking, so the second send waits for the first and sees it.
//
// Two sessions have to overlap at READ COMMITTED to show this. PGlite is one backend and cannot do it, so this file starts a
// real PostgreSQL in a temporary directory, applies the real migration and talks to it with psql. Synthetic data only: no
// production data, no network, nothing written outside the temp directory. It skips itself where no PostgreSQL is available.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-dup-'));
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
const send = key => `select public.wr_submit(${q({ emp_id: 'E7', name: 'Lee Leader', kind: 'mileage', store_id: 'S1', client_key: key,
  payload: { date: '2026-10-28', purpose: '銀行・郵便', origin: 'Store', destination: 'Bank', one_way_miles: 12.4, round_trip: true, memo: '' } })})::text`;

async function fixture(C) {
  const boot = `create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.employees values ('E7','Lee Leader','sl','Server Leader','S1','[]','在籍','{}');
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`;
  fs.writeFileSync(path.join(C.dir, 'boot.sql'), boot);
  fs.copyFileSync(new URL('../../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), path.join(C.dir, 'wr.sql'));
  const file = f => run('psql', ['-h', C.dir, '-p', C.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(C.dir, f)]);
  await file('boot.sql'); await file('wr.sql');
  await C.one('update public.wr_settings set live = true');
}

test('#123 [P2]: two sends with different client keys at the same time — the second waits and is told about the first', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const a = C.session(), b = C.session();
  await a.sendWait('set role service_role'); await b.sendWait('set role service_role');
  const ra = await a.sendWait('begin; ' + send('k-race-aaaa-0001'));
  assert.match(ra.out, /"code": "GS-/, 'the first send is saved (not committed yet)');
  const pb = b.send(send('k-race-bbbb-0002'));
  // the second send waits on the lock for this kind, day and amount
  await waitFor(async () => Number(await C.one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory'`)) >= 1, 'the second send to wait');
  assert.equal(pb.answered, false);
  await a.sendWait('commit');
  const rb = await pb.answer;
  assert.match(rb.out, /"duplicate"/, 'the second send sees the first one and stops for a reason');
  assert.equal(Number(await C.one('select count(*) from public.wr_requests')), 1, 'only one request was saved');
});
