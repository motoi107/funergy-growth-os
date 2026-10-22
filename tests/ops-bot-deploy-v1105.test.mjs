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

test('the bundle was built from the current ops-bot sources', () => {
  for (const [file, hash] of Object.entries(meta.sources)) assert.equal(sha(fs.readFileSync(path.join(root, file))), hash, file + ' changed: rebuild with node deploy/ops-bot-job-check-v1105/build.mjs');
  // every module the function imports is listed
  const listed = new Set(Object.keys(meta.sources));
  for (const f of listed) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(listed.has(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1]))), f + ' imports ' + m[1]);
  assert.equal(sha(fs.readFileSync(BUNDLE)), meta.bundle_sha256);
  assert.equal(sha(fs.readFileSync(ROLLBACK)), meta.rollback_sha256);
  for (const f of [BUNDLE, ROLLBACK]) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /^\s*import\s|\bimport\(/m, 'one file without imports');
});

test('rebuilding gives the same bytes (when esbuild is available)', { skip: !fs.existsSync('/opt/npm-tools/node_modules/.bin/esbuild') && 'esbuild not installed here' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-')), 'b.ts');
  execFileSync('/opt/npm-tools/node_modules/.bin/esbuild', [path.join(root, 'supabase/functions/ops-bot/index.ts'), '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning', '--outfile=' + out]);
  assert.equal(sha(fs.readFileSync(out)), meta.bundle_sha256);
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
