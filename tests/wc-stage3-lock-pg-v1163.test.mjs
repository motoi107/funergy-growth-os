// #153 の Codex（6880375329・11/14 本番 v1162 のあとの直し）：段階 3 の旧予算の移行（wr_s3_import）と通常の予算の申請（wr_submit_s2）が、
// 同じ店・同じ月で重なっても承認待ちは 1 件。本物の PostgreSQL の 2 つのセッションで「片方がまだコミットしていないときに、もう片方が来る」順を作る。
// 直す前の wr_s3_import は移行の鍵（wr_s3_import）だけで、店・月の鍵（wr_bg:<店>:<月>）を取らなかったので、どちらの順でも 2 件になった。
// 直したあと：あとから来た方は待ち、先の方のコミットのあとに見て、移行は「known」・申請は同じ番号の新しい版（2 版）になる。
// 移行は何も書く前に予算の店・月の鍵を全部取る（書いたあとに待つと、番号の行の鍵と待ち合って止まりうる）ことも確かめる。
// 合成データだけ。本番データ・ネットワークは使わない。一時フォルダの外には書かない。PostgreSQL が無い環境では理由を出して飛ばす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const MIGRATIONS = ['20261104090000_work_requests.sql', '20261105090000_work_requests_eval.sql', '20261106090000_work_requests_apply_claim.sql',
  '20261107090000_work_requests_ui68.sql', '20261120090000_work_requests_stage2.sql', '20261123090000_work_requests_stage3.sql'];
const SQL_DIR = process.env.WR_S3_SQL_DIR ? new URL('file://' + path.resolve(process.env.WR_S3_SQL_DIR) + '/') : new URL('../supabase/migrations/', import.meta.url);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-s3-lock-'));
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

// 前の承認タブの記録（承認待ちの予算）。id は 'ap' + ミリ秒（番号はその月で取る）。40 日前＝前の月にして、移行の番号の行（BG-前の月）が
// 申請の番号の行（BG-今の月）と別になるようにする（同じ行だと、直す前の SQL でもその行の鍵で待ってしまい、3 つ目の試験が違いを見分けない）
const NOW = Date.now(), OLD = NOW - 40 * 86400000;
const LEG = (n, store, ym) => ({ id: 'ap' + (OLD + n), type: '予算', title: '予算 ' + ym + '（前の画面）', ym, store, from: 'Gabe GM', status: 'pending', date: '2026/10/05', _mut: OLD + n });
const LEGS = [LEG(1, 'S1', '2026-12'), LEG(2, 'S2', '2026-12'), LEG(3, 'S1', '2027-01')];
const GM = { emp_id: 'E2', name: 'Gabe GM' };
const item = (a, total) => ({ ap_id: a.id, kind: 'budget', store_id: a.store, payload: { ap_id: a.id, title: a.title, ym: a.ym, total_cents: total, days: { [a.ym + '-01']: total } } });
let seq = 0;
const submit = (store, ym, total) => rpc('wr_submit_s2', { ...GM, kind: 'budget', store_id: store, client_key: 'k-lock-' + String(++seq).padStart(6, '0'),
  payload: { ap_id: 'ap' + (NOW + seq), title: '予算 ' + ym, ym, total_cents: total } });
const imp = items => rpc('wr_s3_import', { ...GM, items });

async function fixture(C) {
  fs.writeFileSync(path.join(C.dir, 'bootstrap.sql'), `create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true),('S2','Store Two',null,true);
    insert into public.employees values ('E2','Gabe GM','gm','General Manager','OFFICE','[]','在籍','{"name":"Gabe GM"}');
    insert into public.manager_auth(role, emp_id) values ('gm','E2');`);
  await C.file('bootstrap.sql');
  for (const f of MIGRATIONS) { fs.copyFileSync(new URL(f, SQL_DIR), path.join(C.dir, f)); await C.file(f); }
  fs.writeFileSync(path.join(C.dir, 'data.sql'), `insert into public.app_state(key, value) values ('approvals', ${q(LEGS)});
    update public.wr_settings set live = true, s2_live = true;`);
  await C.file('data.sql');
  // 同じ店・同じ月の予算の申請（写した履歴は数えない）
  const open = async (store, ym) => JSON.parse(await C.one(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'version', version, 'legacy', legacy, 'status', status) order by created_at), '[]')::text
    from public.wr_requests where kind = 'budget' and store_id = '${store}' and payload->>'ym' = '${ym}' and status not in ('withdrawn','rejected') and not public.wr_s3_hist(wr_requests)`));
  return { open };
}
const sessions = async C => {
  const a = C.session(), b = C.session();
  await a.sendWait('set role service_role'); await b.sendWait('set role service_role');
  return [a, b];
};
const pidOf = async s => Number((await s.sendWait('select pg_backend_pid()')).out);
// そのセッションがもう何か書いたか（書くと transactionid の鍵を持つ）
const wrote = async (C, pid) => Number(await C.one(`select count(*) from pg_locks where pid = ${pid} and locktype = 'transactionid' and granted`)) > 0;

test('#153 a budget request is open (not committed) when the old one is moved over for the same store and month: the move waits, then says known; one pending request', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const [A, B] = await sessions(C);
  const pidB = await pidOf(B);
  const a = await A.sendWait(`begin; ${submit('S1', '2026-12', 410000)}`);
  assert.match(a.out, /"status": "pending"/, a.err);
  const b = B.send(imp([item(LEGS[0], 500000)]));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the move to wait or to answer');
  assert.equal(b.answered, false, 'the move waits for the request of the same store and month');
  assert.equal(await wrote(C, pidB), false, 'it waits before writing anything');
  await A.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.equal(JSON.parse(r.out).items[0].result, 'known', r.err);
  const rows = await F.open('S1', '2026-12');
  assert.equal(rows.length, 1, JSON.stringify(rows)); assert.equal(rows[0].legacy, false);
});

test('#153 the old one is being moved over (not committed) when a budget request comes for the same store and month: the request waits, then becomes version 2 of it; one pending request', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const [A, B] = await sessions(C);
  const b = await B.sendWait(`begin; ${imp([item(LEGS[0], 500000)])}`);
  assert.equal(JSON.parse(b.out).items[0].result, 'pending', b.err);
  const a = A.send(submit('S1', '2026-12', 410000));
  await waitFor(async () => a.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the request to wait or to answer');
  assert.equal(a.answered, false, 'the request waits for the move of the same store and month');
  await B.sendWait('commit');
  const r = await a.answer;
  t.diagnostic(JSON.stringify(r));
  const got = JSON.parse(r.out);
  const rows = await F.open('S1', '2026-12');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.deepEqual([got.id, got.version, rows[0].legacy], [rows[0].id, 2, true], 'a new version of the moved request');
});

test('#153 the move takes every store-and-month key before it writes; other stores and months are not held up afterwards', { skip: SKIP }, async t => {
  const C = await cluster(t); const F = await fixture(C);
  const [A, B] = await sessions(C);
  const pidB = await pidOf(B);
  await A.sendWait(`begin; ${submit('S1', '2026-12', 410000)}`);
  // S2 の 12 月を先に書いてから S1 の鍵で待つ（番号の行の鍵を持ったまま待つ）のではなく、何も書かずに待つ
  const b = B.send(imp([item(LEGS[1], 300000), item(LEGS[0], 500000), item(LEGS[2], 600000)]));
  await waitFor(async () => b.answered || Number(await C.one(LOCK_WAITS)) > 0, 'the move to wait or to answer');
  assert.equal(b.answered, false);
  assert.equal(await wrote(C, pidB), false, 'nothing written while it waits (no number row is held)');
  await A.sendWait('commit');
  const r = await b.answer;
  t.diagnostic(JSON.stringify(r));
  assert.deepEqual(JSON.parse(r.out).items.map(x => x.result), ['pending', 'known', 'pending'], r.err);
  for (const [s, ym] of [['S1', '2026-12'], ['S2', '2026-12'], ['S1', '2027-01']]) assert.equal((await F.open(s, ym)).length, 1, s + ' ' + ym);
  // あとから：別の店・月の申請は待たない（鍵はトランザクションの終わりで放す）
  const c = await C.one(`set role service_role; ${submit('S2', '2027-01', 1)}`);
  assert.match(c, /"status": "pending"/);
});
