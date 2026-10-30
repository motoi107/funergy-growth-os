// v1105：ops-bot を入れる 1 ファイル（deploy/ops-bot-job-check-v1105）が今のソースと同じか・戻す 1 ファイルが main のときのものか。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'deploy/ops-bot-job-check-v1105');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const BUNDLE = path.join(dir, '1_関数_ops-bot_index.ts'), ROLLBACK = path.join(dir, '戻す_関数_ops-bot_index.ts');

// v1118 から ops-bot の今のソースは deploy/cash-tip-auto-zero-v1118 がまとめる。この一式は v1105 のとき（FROZEN）のソースのまま残す
// （v1118 の「戻す」はこの 1_関数）。だから元のファイルは FROZEN のコミットの中身と比べる。
const FROZEN = '96a2c7e';
const hasFrozen = (() => { try { execFileSync('git', ['-C', root, 'cat-file', '-e', FROZEN + '^{commit}'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const frozenFile = f => execFileSync('git', ['-C', root, 'show', FROZEN + ':' + f]);
test('the bundle was built from the ops-bot sources of v1105 (commit ' + FROZEN + ')', { skip: !hasFrozen && 'commit ' + FROZEN + ' is not in this clone' }, () => {
  for (const [file, hash] of Object.entries(meta.sources)) assert.equal(sha(frozenFile(file)), hash, file + ' at ' + FROZEN);
  // every module the function imports is listed
  const listed = new Set(Object.keys(meta.sources));
  for (const f of listed) for (const m of frozenFile(f).toString('utf8').matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(listed.has(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1]))), f + ' imports ' + m[1]);
  assert.equal(sha(fs.readFileSync(BUNDLE)), meta.bundle_sha256);
  assert.equal(sha(fs.readFileSync(ROLLBACK)), meta.rollback_sha256);
  for (const f of [BUNDLE, ROLLBACK]) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /^\s*import\s|\bimport\(/m, 'one file without imports');
});

const ESBUILD = '/opt/npm-tools/node_modules/.bin/esbuild';
const { bundle, rollbackSources } = await import('../deploy/ops-bot-job-check-v1105/build.mjs');
test('rebuilding the v1105 sources gives the same bytes, from any folder (when esbuild is available)', { skip: (!fs.existsSync(ESBUILD) && 'esbuild not installed here') || (!hasFrozen && 'commit ' + FROZEN + ' is not in this clone') }, () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-v1105-')), out = path.join(src, 'b.ts'), tree = path.join(src, 'tree');
  for (const f of Object.keys(meta.sources)) { fs.mkdirSync(path.join(tree, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tree, f), frozenFile(f)); }
  const was = process.cwd();
  try { process.chdir(os.tmpdir()); bundle(tree, out, ESBUILD); } finally { process.chdir(was); }
  assert.equal(sha(fs.readFileSync(out)), meta.bundle_sha256);
});
const hasRollbackCommit = (() => { try { execFileSync('git', ['-C', root, 'cat-file', '-e', meta.rollback_commit + '^{commit}'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('the rollback file rebuilds to the same bytes from the rollback commit (in a different folder each time)', { skip: (!fs.existsSync(ESBUILD) && 'esbuild not installed here') || (!hasRollbackCommit && 'the rollback commit is not in this clone') }, () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-rb-src-')), out = path.join(src, 'out.ts');
  rollbackSources(root, path.join(src, 'tree'));
  bundle(path.join(src, 'tree'), out, ESBUILD);
  assert.equal(sha(fs.readFileSync(out)), meta.rollback_sha256);
  assert.doesNotMatch(fs.readFileSync(ROLLBACK, 'utf8'), /tmp|opsbot-rollback/, 'no temporary folder names in the file');
});

async function load(file) {
  let handler = null;
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', TOAST_CLIENT_ID: 'x', TOAST_CLIENT_SECRET: 'y' };
  globalThis.Deno = { serve: h => { handler = h; }, env: { get: k => env[k] } };
  await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(file, 'utf8') + '\n//' + Math.random()).toString('base64'));
  assert.equal(typeof handler, 'function');   // Deno.env is read on each request: keep the stub
  return handler;
}
function mockFetch(role) {
  return async url => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return Response.json({ id: '00000000-0000-4000-8000-000000000099' });
    if (u.includes('/manager_auth?')) return Response.json([{ role }]);
    if (u.includes('/bot_users?')) return Response.json([]);
    if (u.includes('/store_config?')) return Response.json([{ store_id: 'F06', restaurant_guid: '00000000-0000-4000-8000-000000000077', name: 'LaLa' }]);
    if (u.includes('/bot_settings?key=eq.job_check')) return Response.json([]);
    if (u.includes('/authentication/v1/authentication/login')) return Response.json({ token: { accessToken: 't' } });
    if (u.includes('/labor/v1/jobs')) return Response.json([{ guid: 'AAAAAAAA-0000-4000-8000-000000000001', title: 'Prep', deleted: false, defaultWage: 99 }]);
    throw Error('unexpected ' + u);
  };
}
const call = (h, body) => h(new Request('https://fn.test', { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body) }));

test('the bundled function answers the Job check actions; the rollback bundle is the version without them', async () => {
  const saved = globalThis.fetch;
  let current = mockFetch('office');
  globalThis.fetch = (...a) => current(...a);   // the function keeps the fetch it saw when it was created
  try {
    const h = await load(BUNDLE);
    assert.equal((await call(h, { action: 'job_list', store_id: 'F06' })).status, 403);
    current = mockFetch('gm');
    const r = await call(h, { action: 'job_list', store_id: 'F06' }); const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.jobs[0].guid, 'aaaaaaaa-0000-4000-8000-000000000001'); assert.equal(j.rev, 0);
    assert.doesNotMatch(JSON.stringify(j), /defaultWage|99/);
    const old = await load(ROLLBACK);
    const o = await call(old, { action: 'job_list', store_id: 'F06' });
    assert.notEqual(o.status, 200, 'the rollback version does not know job_list');
    assert.doesNotMatch(fs.readFileSync(ROLLBACK, 'utf8'), /job_1630|labor_job:/);
    assert.match(fs.readFileSync(BUNDLE, 'utf8'), /labor_job:/);
  } finally { globalThis.fetch = saved; }
});


// v1105（独立レビュー P2）：ops-bot を前に戻しても、Job の案件を「直った（Toast で確かめた）」で閉じない
test('after a rollback, a Job case still wrong in Toast is not closed by the old function', async () => {
  const J = await import('../bot/job-check.mjs');
  const g = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const SERVER = g(502);
  const scfg = { enabled: true, cutoff: '16:30', from: '2026-10-16', g1p: 'exclude', straddle: { enabled: false, minutes: 30 }, jobs: { [SERVER]: { name: 'Server', cls: 'service' } } };
  const entry = { guid: g(1), employeeReference: { guid: g(900) }, jobReference: { guid: SERVER }, inDate: '2026-10-20T15:00:00.000-10:00', outDate: '2026-10-20T22:00:00.000-10:00', businessDate: '20261020' };
  const f = J.jobFindings({ entries: [entry], toastEmployees: [{ guid: g(900), firstName: 'Synthetic', lastName: 'Crew' }], appEmployees: [{ name: 'Synthetic Crew', title: 'Crew', role: 'crew' }], scfg, store: { store_id: 'F06', name: 'LaLa' }, date: '2026-10-20' })[0];
  const theCase = { id: g(10), version: 4, kind: 'labor', store_id: 'F06', business_date: '2026-10-20', status: 'review', payload: f.payload };
  const saved = globalThis.fetch;
  for (const [file, label] of [[ROLLBACK, 'rollback'], [BUNDLE, 'current']]) {
    const writes = [], checks = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith('/auth/v1/user')) return Response.json({ id: g(99) });
      if (u.includes('/manager_auth?')) return Response.json([{ role: 'gm' }]);
      if (u.includes('/bot_users?')) return Response.json([]);
      if (u.includes('/bot_cases?id=')) return Response.json([theCase]);
      if (u.includes('/store_config?')) return Response.json([{ store_id: 'F06', restaurant_guid: g(77), name: 'LaLa' }]);
      if (u.includes('/bot_settings?key=eq.clock')) return Response.json([{ value: { nightFrom: '03:00', nightTo: '05:00', longH: 12, shortMin: 15 } }]);
      if (u.includes('/bot_settings?key=eq.job_check')) return Response.json([{ value: { stores: { F06: scfg } } }]);
      if (u.includes('/authentication/v1/authentication/login')) return Response.json({ token: { accessToken: 't' } });
      if (u.includes('/app_state?')) return Response.json([]);
      if (u.includes('/labor/v1/timeEntries?')) return Response.json([entry]);
      if (u.includes('/labor/v1/employees')) return Response.json([{ guid: g(900), firstName: 'Synthetic', lastName: 'Crew' }]);
      if (u.endsWith('/rpc/bot_case_write')) { writes.push(JSON.parse(init.body)); return Response.json({ id: g(10), status: 'done' }); }
      if (u.endsWith('/rpc/bot_record_check')) { checks.push(JSON.parse(init.body)); return Response.json({}); }
      throw Error('unexpected ' + u);
    };
    try {
      const h = await load(file);
      const r = await call(h, { action: 'recheck', id: g(10), version: 4 });
      assert.equal(writes.filter(w => w.p_op === 'verified').length, 0, label + ': the case is not closed (' + r.status + ')');
      assert.ok(checks.length >= 1, label + ': the check is recorded as not clean');
      if (label === 'rollback') assert.notEqual(r.status, 200);
    } finally { globalThis.fetch = saved; }
  }
});
