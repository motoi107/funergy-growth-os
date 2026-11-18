// v1192 の入れる一式（deploy/labor-totals-v1192/）：secure-state の 1 ファイルが今のソースから作ったものと同じで、
// 読み込める（同じ名前の宣言が無い）こと・モジュールの handler と同じ答えを返すこと・戻すときの v1152 の 1 ファイルが変わっていないこと。
// emp-private v1192 は公開しない（このリポジトリに無い）ことも確かめる。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, withoutTail, OUT, TAIL } from '../scripts/build-secure-state-one.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const D = 'deploy/labor-totals-v1192/';

test('the one-file secure-state is built from the current sources and has no private part', () => {
  const one = rd(OUT);
  assert.equal(one, build(), 'run node scripts/build-secure-state-one.mjs');
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /ltfn: 1/); assert.match(one, /ntfn: 1/); assert.match(one, /clfn: 1/);
  assert.match(one, /export function laborCore\(env\)/);
  assert.match(one, /async function ltGet\(a, b\)/);
  assert.ok(!/employees_private\?select=[^'"]*(email|phone|ssn|address)/.test(one), 'the labor load reads wages only from the private table');
});

test('the one-file secure-state answers the same as the module handler', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-one-test-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(OUT)));
    const mod = await import(pathToFileURL(f).href);
    assert.equal(typeof mod.createHandler, 'function');
    const URL0 = 'https://db.example.test', SS = URL0 + '/functions/v1/secure-state';
    const JWT = sub => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated', sub })).toString('base64url') + '.c2ln';
    const UID = '11111111-1111-4111-8111-111111111111';
    const res = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    const fetchStub = async (u, opt = {}) => {
      const url = new URL(u);
      if (url.pathname === '/auth/v1/user') return res({ id: UID });
      const t = url.pathname.slice(9), q = url.searchParams;
      if (t === 'manager_auth') return res([{ role: 'office', emp_id: null }]);
      if (t === 'stores') return res([{ id: 'F01', data: { id: 'F01', name: 'ToriTon', toastGuid: 'g-1', lunchHours: '11:00-14:30', dinnerHours: '17:00-22:00' } }]);
      if (t === 'employees') return res([{ id: 'e1', data: { id: 'e1', name: 'Aki Tanaka', store: 'F01', title: 'Crew', status: '在籍' } }, { id: 'e2', data: { id: 'e2', name: 'Dan Ruiz', store: 'F01', title: 'Store Manager', status: '在籍' } }]);
      if (t === 'employees_private') return res([{ emp_id: 'e1', wage: 18.5, monthly_salary: null }, { emp_id: 'e2', wage: 0, monthly_salary: 6500 }]);
      if (t === 'app_settings') return res([]);
      if (t === 'app_state') return res([]);
      if (t === 'tip_labor') return res(['2026-11-02', '2026-11-03', '2026-11-04'].filter(d => d >= q.getAll('business_date')[0].slice(4) && d <= q.getAll('business_date')[1].slice(4)).map(d => ({ business_date: d, data: [{ name: 'Aki Tanaka', lunchHours: 4, dinnerHours: 5 }, { name: 'Dan Ruiz', lunchHours: 3, dinnerHours: 5 }] })));
      void opt; throw new Error('unexpected ' + u);
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' })[k];
    const now = () => Date.parse('2026-11-18T20:00:00Z');
    const ask = async h => {
      const r = await h(new Request(SS, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer ' + JWT(UID) }, body: JSON.stringify({ action: 'labor', asks: [{ s: 'F01', m: '2026-11' }], to: '2026-11-18' }) }));
      return [r.status, await r.json()];
    };
    const a = await ask(mod.createHandler({ env, fetch: fetchStub, now }));
    const b = await ask(createHandler({ env, fetch: fetchStub, now }));
    assert.equal(a[0], 200);
    assert.deepEqual(a, b);
    assert.ok(a[1].r['F01|2026-11'].p.hourly > 0 && a[1].r['F01|2026-11'].p.salary > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the rollback file (v1152) is unchanged, the steps name every file, and the private emp-private is not in the repository', () => {
  assert.equal(sha('deploy/secure-notifications-v1152/2_関数_secure-state_index.ts'), 'b50e2ba2d822b80b3463914a9d4d4470c396aa3810f8792adf3c35afd983597d');
  assert.ok(!/ltfn/.test(rd('deploy/secure-notifications-v1152/2_関数_secure-state_index.ts')), 'the v1152 function does not know labor');
  const how = rd(D + '手順.md');
  for (const f of ['1_関数_secure-state_index.ts', 'deploy/secure-notifications-v1152/2_関数_secure-state_index.ts', 'docs/LABOR_TOTALS_V1192_JA.md', 'scripts/build-secure-state-one.mjs', 'emp-private'])
    assert.ok(how.includes(f), '手順.md names ' + f);
  assert.ok(how.indexOf('secure-state') < how.indexOf('1192 に') && how.indexOf('1192 に') < how.lastIndexOf('emp-private v1192'), 'the order: function, then every device on 1192, then emp-private');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(), ['1_関数_secure-state_index.ts', '手順.md']);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => (x.name === '.git' || x.name === 'node_modules') ? [] : x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]);
  assert.deepEqual(walk(ROOT).filter(p => /emp-private/i.test(path.basename(p)) && /\.ts$/.test(p)), [], 'no emp-private source file');
  assert.ok(!fs.existsSync(path.join(ROOT, 'supabase/functions/emp-private')), 'emp-private stays outside the repository');
});
