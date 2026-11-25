// キャリア・育成 A-2-1：入れる一式（deploy/growth-plan-a2/）。SQL の写しが元と同じ・1 ファイルの secure-state が今の部品から作ったものと同じで
// モジュールの handler と同じに答える（gp_* を扱う・SQL の前は nosql）・手順の順。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, withoutTail, TAIL, OUT } from '../scripts/build-secure-state-one.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const D = 'deploy/growth-plan-a2/';
const ONE = D + '4_関数_secure-state_index.ts';

test('the deploy folder: copies equal their sources; the one-file secure-state is up to date and has no private part', () => {
  assert.equal(OUT, ONE, 'the build writes into the A-2 folder');
  assert.equal(rd(D + '1_最初に確認_読むだけ.sql'), rd('db/gp-precheck.sql'));
  assert.equal(rd(D + '2_SQL_育成計画とOJT.sql'), rd('supabase/migrations/20261219090000_gp_plan.sql'));
  assert.equal(rd(D + '3_確認_読むだけ.sql'), rd('db/gp-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/gp-rollback.sql'));
  const one = rd(ONE);
  assert.equal(one, build(), 'run node scripts/build-secure-state-one.mjs');
  assert.ok(one.endsWith(TAIL)); assert.ok(!/^import\s/m.test(one)); assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /gpfn: 1/); assert.match(one, /cs4fn: 1/);
  for (const a of ['gp_me', 'gp_roster', 'gp_get', 'gp_plan_save', 'gp_close', 'gp_task_save', 'gp_task_act', 'gp_note', 'gp_legacy', 'gp_copy']) assert.ok(one.includes(a + ':'), a);
  const h = rd(D + '手順.md');
  const order = ['1_最初に確認_読むだけ.sql', '2_SQL_育成計画とOJT.sql', '3_確認_読むだけ.sql', '4_関数_secure-state_index.ts', '5_旧の記録を写す.sql'].map(f => h.indexOf(f));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'the steps are in order');
  const five = rd(D + '5_旧の記録を写す.sql');
  assert.match(five, /gp_legacy_copy\('sql', '11\/24 Moto さんの決定（答え 5 B）/);
  assert.ok(rd('supabase/functions/secure-state/handler.mjs').includes(five.match(/'(11\/24 Moto さんの決定[^']+)'/)[1]), 'the same reason as the function');
});

test('the one-file answers like the module (gp_* before the SQL, and an older action)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-one-gp-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    const mk = () => {
      const W = makeWorld({
        emps: [{ id: 'E-GM', name: 'Gina M', store: 'OFFICE', role: 'gm', title: 'General Manager', status: '', data: { name: 'Gina M', store: 'OFFICE' } },
               { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', status: '', data: { name: 'Kai One', store: 'S1' } }],
        mgr: { 'cccccccc-0000-0000-0000-000000000001': { emp_id: 'E-GM', role: 'gm' } }, users: { gm: 'cccccccc-0000-0000-0000-000000000001' },
      });
      const base = W.fetch;
      W.fetch = async (u, opt) => (/\/rest\/v1\/(rpc\/)?(gp|csq4)_/.test(new URL(u).pathname) ? new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 }) : base(u, opt));
      return W;
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
    const ask = async (create, body) => {
      const W = mk(); const h = create({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 24, 20, 0, 0) });
      const r = await h(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + JWT('gm') }, body: JSON.stringify(body) }));
      return [r.status, await r.json()];
    };
    for (const body of [{ action: 'gp_me' }, { action: 'gp_roster' }, { action: 'gp_copy' }, { action: 'gp_plan_save', emp: 'E-1', f: { system: 'G', grade: 'G1', type: 'Kitchen中心' } }, { action: 'cs4_me' }, { action: 'pull', keys: [] }]) {
      const a = await ask(mod.createHandler, body), b = await ask(createHandler, body);
      assert.deepEqual(a, b, body.action);
      assert.equal(a[1].gpfn, 1, body.action);
    }
    assert.equal((await ask(mod.createHandler, { action: 'gp_me' }))[1].nosql, true);
    assert.equal((await ask(mod.createHandler, { action: 'gp_copy' }))[0], 503);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
