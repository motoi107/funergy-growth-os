// v1144（2b-6）：③ の SQL（20261113090000）が流れているあいだに、ほかの書き込みが重なったとき。
// PGlite は 1 つのつなぎしか持てないので、一時フォルダで本物の PostgreSQL を動かし、psql の 2 つのつなぎで順番を決める（pr45 と同じ作り）。
// 合成データだけ（本番・ネットワークに触れない。一時フォルダの外に書かない）。PostgreSQL が無い環境では理由を出して飛ばす。
//   1. ③ が emp_pii を読んだあと・書く前に、関数（v1144）が emp_pii の行を作った：関数の値を残す（③ の写しで上書きしない）
//   2. ③ のあいだに前の版の端末が従業員の表に書いた：③ が終わるまで待ち、5 つの欄は見張りが外す（ほかの欄は入る）。写した値は消さない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const MIG = '20261113090000_secure_emp_pii.sql';
const PAUSE_KEY = 911440;

const findBin = () => {
  const dirs = [];
  try { dirs.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()); } catch { /* no pg_config */ }
  try { for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) dirs.push(`/usr/lib/postgresql/${v}/bin`); } catch { /* not debian */ }
  dirs.push('/usr/local/pgsql/bin', '/opt/homebrew/bin', '/usr/bin');
  return dirs.find(d => d && ['initdb', 'postgres', 'pg_ctl', 'psql'].every(f => fs.existsSync(path.join(d, f)))) || null;
};
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-pg-'));
  if (RUN_AS.uid != null) { fs.chownSync(dir, RUN_AS.uid, RUN_AS.gid); fs.chmodSync(dir, 0o700); }
  const data = path.join(dir, 'data'), port = String(5530 + Math.floor(Math.random() * 90));
  const conn = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t'];
  await run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { env: { HOME: dir } });
  await run('pg_ctl', ['-D', data, '-l', path.join(dir, 'log.txt'), '-w', '-o',
    `-c listen_addresses='' -c unix_socket_directories=${dir} -p ${port}`, 'start'], { env: { HOME: dir } });
  let stopped = false;
  t.after(async () => {
    if (stopped) return; stopped = true;
    await run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop'], { allowFail: true, env: { HOME: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const one = async text => (await run('psql', [...conn, '-c', text])).out.trim();
  const file = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };
  // 1 つのファイルを流す（終わるのを待たない：途中で待たされるのを外から見る）
  const bg = f => run('psql', [...conn, '-f', f], { allowFail: true });
  // 開いたままのつなぎ（ロックを持ち続ける）
  const session = () => {
    const p = spawn(path.join(BIN, 'psql'), conn.map(x => (x === 'ON_ERROR_STOP=1' ? 'ON_ERROR_STOP=0' : x)), { ...RUN_AS, env: { ...process.env, PGUSER: 'postgres', HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', waiter = null;
    const check = () => { if (waiter && out.includes('@@END@@')) { const w = waiter; waiter = null; const [body] = out.split('@@END@@'); out = out.slice(out.indexOf('@@END@@') + 7); w(body.trim()); } };
    p.stdout.on('data', d => { out += d; check(); });
    t.after(() => p.kill('SIGKILL'));
    return { send: text => new Promise(res => { waiter = res; p.stdin.write(text.trim() + '\n\\echo @@END@@\n'); check(); }) };
  };
  return { dir, one, file, bg, session };
}

const waitFor = async (fn, why, ms = 15000) => {
  const until = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error('timed out waiting for ' + why); await new Promise(r => setTimeout(r, 50)); }
};
const WAITING = (kind) => `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and wait_event = '${kind}'`;

// 合成の表（本番と同じ形の列だけ）。X・Y は個人の欄がある人
async function setup(C, { pauseInsert }) {
  const boot = `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
create table public.employees(id text primary key, name text, role text, title text, store text, status text, data jsonb);
grant select, insert, update on public.employees to anon, authenticated;
insert into public.employees(id, name, role, title, store, status, data) values
  ('X', 'Xia Sample', 'crew', 'Crew', 'S1', '在籍', '{"name":"Xia Sample","dob":"1990-01-01","insurance":true,"insuranceAmt":200}'),
  ('Y', 'Yao Sample', 'crew', 'Crew', 'S2', '在籍', '{"name":"Yao Sample","dob":"1991-02-02","cardLast4":"2222"}');
insert into public.app_state(key, value) values ('tasks_all', '{"v":1}');
` + (pauseInsert ? `
-- 試験だけ：③ が emp_pii を書く直前で待つ（試験が鍵を放すまで）。関数（ほかのつなぎ）の書き込みは待たない
create function public.t_pause() returns trigger language plpgsql as $$
begin
  if new.key = 'emp_pii' and current_setting('t.pause', true) = '1' then
    perform pg_advisory_lock(${PAUSE_KEY}); perform pg_advisory_unlock(${PAUSE_KEY});
  end if;
  return new;
end $$;
create trigger t_pause before insert on public.app_state for each row execute function public.t_pause();
` : '');
  await C.one(boot);
  fs.copyFileSync(new URL('../supabase/migrations/' + MIG, import.meta.url), path.join(C.dir, MIG));
}

test('③ keeps the function\'s value when the function creates emp_pii between ③\'s read and ③\'s write', { skip: SKIP }, async t => {
  const C = await cluster(t);
  await setup(C, { pauseInsert: true });
  const holder = C.session();
  assert.equal(await holder.send(`select pg_advisory_lock(${PAUSE_KEY});`), '');
  // ③：emp_pii を読み（まだ無い）、写しを作り、書く直前で待つ
  const a = C.bg(C.file('a.sql', `set t.pause = '1';\n\\i ${path.join(C.dir, MIG)}\n`));
  await waitFor(async () => Number(await C.one(WAITING('advisory'))) === 1, '③ to wait just before writing emp_pii');
  // そのあいだに関数（v1144）が X の生年月日を直した：行が無かったので作る（つなぎは別・試験の待ちは効かない）
  await C.one(`insert into public.app_state(key, value) values ('emp_pii', '{"X":{"dob":"1990-03-03","insurance":true,"insuranceAmt":200,"_at":"f","_by":"GM"}}')`);
  assert.equal(await holder.send(`select pg_advisory_unlock(${PAUSE_KEY});`), 't');
  const r = await a;
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(await C.one(`select value::text from public.app_state where key = 'emp_pii'`));
  assert.equal(v.X.dob, '1990-03-03', 'the function\'s newer value is kept (not the table copy)');
  assert.equal(v.X._by, 'GM');
  assert.equal(v.Y.dob, '1991-02-02', 'the others are copied');
  assert.equal(v.Y.cardLast4, '2222');
  assert.equal(await C.one(`select count(*) from public.employees where data ?| array['dob','cardLast4','insurance','dental','insuranceAmt']`), '0', 'removed from the table');
});

test('an old device writing the employee table during ③ waits; its personal fields are dropped, the other fields go in, the copied values stay', { skip: SKIP }, async t => {
  const C = await cluster(t);
  await setup(C, { pauseInsert: true });
  const holder = C.session();
  assert.equal(await holder.send(`select pg_advisory_lock(${PAUSE_KEY});`), '');
  const a = C.bg(C.file('a.sql', `set t.pause = '1';\n\\i ${path.join(C.dir, MIG)}\n`));
  await waitFor(async () => Number(await C.one(WAITING('advisory'))) === 1, '③ to wait while holding the employee table');
  // 前の版の端末（公開の鍵）が X の生年月日と名前を直す：③ が従業員の表を止めているので待つ
  const b = C.bg(C.file('b.sql', `set role anon;\nupdate public.employees set name = 'Xia Renamed', data = data || '{"name":"Xia Renamed","dob":"1990-09-09"}' where id = 'X';\n`));
  await waitFor(async () => Number(await C.one(WAITING('relation'))) === 1, 'the old device to wait for ③');
  assert.equal(await holder.send(`select pg_advisory_unlock(${PAUSE_KEY});`), 't');
  const ra = await a, rb = await b;
  assert.equal(ra.code, 0, ra.err); assert.equal(rb.code, 0, rb.err);
  const row = JSON.parse(await C.one(`select row_to_json(e)::text from public.employees e where id = 'X'`));
  assert.equal(row.name, 'Xia Renamed', 'the other fields of the waiting write go in');
  assert.equal(row.data.name, 'Xia Renamed');
  assert.ok(!('dob' in row.data), 'its personal field is dropped by the guard');
  const v = JSON.parse(await C.one(`select value::text from public.app_state where key = 'emp_pii'`));
  assert.equal(v.X.dob, '1990-01-01', 'the copied value stays (the old device\'s birthday did not land anywhere; update to 1144 first)');
});
