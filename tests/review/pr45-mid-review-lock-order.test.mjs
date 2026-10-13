// Codex review of PR #45 (head f00f421): mr_reply_delete took no lock, so a delete from another tab could
// commit after mr_reply_send had checked the draft set and before the loops that send it read the drafts
// again. Only part of the set the person saw was then sent, and nothing said drafts_changed.
//
// Two sessions have to overlap at READ COMMITTED to show this. PGlite is one backend and cannot do it, so
// this file starts a real PostgreSQL in a temporary directory, applies the real migrations and talks to it
// with psql. Synthetic data only: no production data, no network, nothing written outside the temp directory.
// It skips itself (with a reason) where no PostgreSQL server binaries are available.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const MIGRATIONS = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql'];
// The demo rows of the v1069 handler for store D1 in 2026-10, frozen as data: v2 (1072) changes the handler's demo and
// retires these reply functions, while this file keeps checking the v1069 SQL that production ran before v2.
const demoData = () => JSON.parse(fs.readFileSync(new URL('./fixtures/mid-review-v1069-demo-D1-2026-10.json', import.meta.url), 'utf8'));
const YM = '2026-10', STORE = 'D1';
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2' };
// The test holds this while the send is paused, so the delete arrives after the check and before the sending.
const PAUSE_KEY = 918045;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-lock-'));
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

const LOCK_WAITS = `select count(*) from pg_stat_activity where wait_event_type='Lock'`;
const q = o => "'" + JSON.stringify(o).replace(/'/g, "''") + "'::jsonb";
const rpc = (name, payload) => `select public.${name}(${q(payload)})::text`;
const waitFor = async (fn, why, ms = 10000) => {
  const until = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error('timed out waiting for ' + why); await new Promise(r => setTimeout(r, 50)); }
};

// The review, a store and two of the GM's drafts, made through the real functions.
async function fixture(C) {
  const bootstrap = `create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into public.employees(id, name, role, status) values ('E1','CEO Test','ceo','在籍'),('E2','GM Test','gm','在籍');
    insert into public.manager_auth(user_id, role, emp_id) values ('${U.ceo}','ceo','E1'),('${U.gm}','gm','E2');`;
  fs.writeFileSync(path.join(C.dir, 'bootstrap.sql'), bootstrap);
  const file = f => run('psql', ['-h', C.dir, '-p', C.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(C.dir, f)]);
  await file('bootstrap.sql');
  for (const f of MIGRATIONS) { fs.copyFileSync(new URL('../../supabase/migrations/' + f, import.meta.url), path.join(C.dir, f)); await file(f); }
  await C.one(`set role service_role; ${rpc('mr_settings_save', { actor: U.gm, key: 'flags', value: { private: true } })}`);
  await C.one(`set role service_role; ${rpc('mr_demo_reset', { actor: U.gm, ...demoData(YM) })}`);
  const no = Number(await C.one(`select submitted_no from mr_reviews where env='demo' and ym='${YM}' and store_id='${STORE}'`));
  assert.ok(no > 0, 'the demo store D1 must be submitted');
  for (const target of ['kpi', 'pl'])
    await C.one(`set role service_role; ${rpc('mr_reply_save', { actor: U.gm, env: 'demo', ym: YM, store_id: STORE, target,
      expect_no: no, expect_version: 0, decision: 'no_action', escalate_to: null, data: { reason: 'checked on this tab (' + target + ')' } })}`);
  const drafts = JSON.parse(await C.one(`select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'version', y.version, 'target', y.target) order by y.created_at), '[]')
    from mr_replies y join mr_reviews r on r.id = y.review_id where r.env='demo' and r.ym='${YM}' and r.store_id='${STORE}' and y.author='${U.gm}' and y.state='draft'`));
  assert.equal(drafts.length, 2, 'two drafts must be waiting');
  return { no, drafts };
}

test('PR #45 [P2]: mr_reply_delete waits for a send that holds the review row', { skip: SKIP }, async t => {
  const C = await cluster(t); await fixture(C);
  const holder = C.session(), deleter = C.session();
  await holder.sendWait('set role service_role');
  await deleter.sendWait('set role service_role');
  // Exactly the lock mr_reply_send takes first.
  await holder.sendWait(`begin; select id from mr_reviews where env='demo' and ym='${YM}' and store_id='${STORE}' for update`);
  const del = deleter.send(rpc('mr_reply_delete', { actor: U.gm, env: 'demo', ym: YM, store_id: STORE, target: 'pl' }));
  // Either it waits on the lock (the fix) or it answers at once (the reviewed head).
  await waitFor(async () => del.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the delete to be applied or to wait');
  t.diagnostic(JSON.stringify({ answered: del.answered, lockWaits: await C.one(LOCK_WAITS) }));
  assert.equal(del.answered, false, 'the delete must not be applied while a send holds the review row');
  await holder.sendWait('commit');
  assert.equal((await del.answer).out, '{"deleted": 1}', 'once the send is over the delete goes through');
});

test('PR #45 [P2]: a delete after the check cannot cut the set the person saw', { skip: SKIP }, async t => {
  const C = await cluster(t); const { no, drafts } = await fixture(C);
  // A pause inside mr_reply_send, after it has checked the draft set and before it reads the drafts again.
  // Only to fix the order of the two sessions; mr_reply_missing's own answer is unchanged.
  await C.one(`alter function public.mr_reply_missing(public.mr_members, public.mr_replies) rename to mrt_missing_orig;
    create function public.mr_reply_missing(m public.mr_members, x public.mr_replies) returns text
    language plpgsql security invoker set search_path=public,pg_temp as $f$
    begin perform pg_advisory_lock(${PAUSE_KEY}); perform pg_advisory_unlock(${PAUSE_KEY}); return public.mrt_missing_orig(m, x); end $f$;`);
  const sender = C.session(), deleter = C.session(), pauser = C.session();
  for (const s of [sender, deleter, pauser]) await s.sendWait('set role service_role');
  await pauser.sendWait(`select pg_advisory_lock(${PAUSE_KEY})`);

  // 1. The send checks the draft set the screen showed, then stops at the pause.
  const send = sender.send(rpc('mr_reply_send', { actor: U.gm, env: 'demo', ym: YM, store_id: STORE, expect_no: no,
    drafts: drafts.map(d => ({ id: d.id, version: d.version })) }));
  await waitFor(async () => Number(await C.one(`select count(*) from pg_locks where locktype='advisory' and not granted`)) > 0, 'the send to reach the pause');
  assert.equal(send.answered, false);

  // 2. The other tab deletes one of the drafts that was just checked.
  const del = deleter.send(rpc('mr_reply_delete', { actor: U.gm, env: 'demo', ym: YM, store_id: STORE, target: 'pl' }));
  await waitFor(async () => del.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the delete to be applied or to wait');
  const deleteWaited = !del.answered;

  // 3. The send carries on.
  await pauser.sendWait(`select pg_advisory_unlock(${PAUSE_KEY})`);
  const sent = JSON.parse((await send.answer).out || '{}');
  const deleted = (await del.answer).out;
  const states = await C.one(`select string_agg(y.target || '=' || y.state, ',' order by y.target) from mr_replies y
    join mr_reviews r on r.id = y.review_id where r.env='demo' and r.ym='${YM}' and r.store_id='${STORE}' and y.author='${U.gm}'`);
  t.diagnostic(JSON.stringify({ deleteWaited, sent, deleted, states }));

  assert.equal(deleteWaited, true, 'the delete must wait for the send that already checked this draft');
  assert.equal(sent.sent, 2, 'both drafts the person saw must be sent');
  assert.equal(states, 'kpi=sent,pl=sent', 'neither draft may disappear instead of being sent');
  assert.equal(deleted, '{"deleted": 0}', 'the delete then finds nothing to delete (the draft has been sent)');
  await C.one(`drop function public.mr_reply_missing(public.mr_members, public.mr_replies);
    alter function public.mrt_missing_orig(public.mr_members, public.mr_replies) rename to mr_reply_missing;`);
});
