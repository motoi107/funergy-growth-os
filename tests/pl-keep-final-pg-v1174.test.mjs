// v1174 の直し（PR #172 の Codex の P2）：本物の PostgreSQL の 2 つのセッションで、2 台の端末がほぼ同時に pl_public を書く。
// 片方がまだコミットしていないあいだに、もう片方の upsert（アプリと同じ insert … on conflict do update）が来る。
// あとから来た方は行の鍵で待ち、先の方のコミットのあとの行を「前の行」として見張り（fp_pl_public_keep_final）が合わせる。
// 確定は暫定に負けない・どちらの店も残る。行がまだ無いとき（最初の 2 回の取り込みが重なる）も同じ。
// 合成データだけ。本番データ・ネットワークは使わない。一時フォルダの外には書かない。PostgreSQL が無い環境では理由を出して飛ばす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const MIG = process.env.PL_KEEP_SQL || new URL('../supabase/migrations/20261202090000_pl_public_keep_final.sql', import.meta.url);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-keep-final-'));
  if (RUN_AS.uid != null) { fs.chownSync(dir, RUN_AS.uid, RUN_AS.gid); fs.chmodSync(dir, 0o700); }
  const data = path.join(dir, 'data'), port = String(5620 + Math.floor(Math.random() * 90));
  const conn = ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=0', '-q', '-A', '-t'];
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
  const file = f => run('psql', ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', f]);
  return { dir, one, session, file };
}

const q = o => "'" + JSON.stringify(o).replace(/'/g, "''") + "'::jsonb";
const upsert = v => `insert into public.app_settings(key, value) values ('pl_public', ${q(v)}) on conflict (key) do update set value = excluded.value`;
const LOCK_WAITS = `select count(*) from pg_stat_activity where wait_event_type='Lock'`;
const waitFor = async (fn, why, ms = 10000) => {
  const until = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error('timed out waiting for ' + why); await new Promise(r => setTimeout(r, 50)); }
};
const FIN = (sales, at) => ({ sales, cogs: 1, payroll: 1, _at: at });
const PROV = (sales, at) => ({ ...FIN(sales, at), prov: 1 });

async function setup(t, { row }) {
  const C = await cluster(t);
  fs.writeFileSync(path.join(C.dir, 'boot.sql'), `create role anon; create role authenticated;
    create table public.app_settings(key text primary key, value jsonb, category text);
    grant select, insert, update on public.app_settings to anon, authenticated;`);
  await C.file(path.join(C.dir, 'boot.sql'));
  fs.copyFileSync(MIG, path.join(C.dir, 'mig.sql'));
  await C.file(path.join(C.dir, 'mig.sql'));
  if (row) await C.one(upsert(row));
  const A = C.session(), B = C.session();
  await A.sendWait('set role anon'); await B.sendWait('set role anon');
  const cloud = async () => JSON.parse(await C.one("select value::text from public.app_settings where key = 'pl_public'"));
  return { C, A, B, cloud };
}
// A が書いてコミットせずに持つ → B が書く（待つ） → A がコミット → B が終わる
async function race(C, A, B, first, second) {
  await A.sendWait('begin');
  const a = await A.sendWait(upsert(first)); assert.equal(a.err, '');
  const b = B.send(upsert(second));
  await waitFor(async () => Number(await C.one(LOCK_WAITS)) >= 1, 'B to wait on the row lock');
  assert.equal(b.answered, false, 'B waits for A');
  await A.sendWait('commit');
  const rb = await b.answer; assert.equal(rb.err, '');
}

test('the final is written first and held; a provisional upsert from another device waits and then keeps the final and both stores', { skip: SKIP }, async t => {
  const { C, A, B, cloud } = await setup(t, { row: { _at: 1, '2026-10': { F06: PROV(90, 1) } } });
  await race(C, A, B, { _at: 50, '2026-10': { F06: FIN(100, 50) } }, { _at: 60, '2026-10': { F06: PROV(95, 60), F01: PROV(10, 60) } });
  assert.deepEqual(await cloud(), { _at: 60, '2026-10': { F06: FIN(100, 50), F01: PROV(10, 60) } });
});

test('the provisional is written first and held; the final from another device waits and wins', { skip: SKIP }, async t => {
  const { C, A, B, cloud } = await setup(t, { row: { _at: 1, '2026-09': { F06: FIN(70, 1) } } });
  await race(C, A, B, { _at: 60, '2026-10': { F06: PROV(95, 60), F01: PROV(10, 60) } }, { _at: 50, '2026-10': { F06: FIN(100, 50) } });
  assert.deepEqual(await cloud(), { _at: 60, '2026-09': { F06: FIN(70, 1) }, '2026-10': { F06: FIN(100, 50), F01: PROV(10, 60) } });
});

test('no row yet (the first two imports overlap): the second insert turns into an update and the trigger still keeps the final', { skip: SKIP }, async t => {
  const { C, A, B, cloud } = await setup(t, { row: null });
  await race(C, A, B, { _at: 50, '2026-10': { F06: FIN(100, 50) } }, { _at: 60, '2026-10': { F06: PROV(95, 60), F02: PROV(3, 60) } });
  assert.deepEqual(await cloud(), { _at: 60, '2026-10': { F06: FIN(100, 50), F02: PROV(3, 60) } });
});
