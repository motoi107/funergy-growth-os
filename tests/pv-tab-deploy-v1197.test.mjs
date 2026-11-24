// v1197 の入れる一式（deploy/page-view-tab-v1197/）：secure-state の 1 ファイルは入れたときのまま（v1207 から sha256 で固定）で、
// 読み込めること・モジュールの handler と同じ答えを返すこと（pv_tab・pv_full・pv_get と、前の版の頼み aff_get）。
// 戻す前の SQL が db/page-view-tab-drop.sql と 1 文字も違わないこと・手順の順番・戻す先の v1195 の 1 ファイルが変わっていないこと。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, withoutTail, TAIL, OUT } from '../scripts/build-secure-state-one.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const D = 'deploy/page-view-tab-v1197/';
const ONE = D + '1_関数_secure-state_index.ts';

// v1207 から build() は deploy/am-office-v1207/ に書く。v1197 の 1 ファイルは Moto さんが入れたときのまま（sha256 で固定）
const ONE_SHA = 'dcbce29dbc4eee87169d5251bf9efa1af9de52307d0c4dd6ca1ae59ff4df95c3';
test('the one-file secure-state (v1197) stays as it was given and has no private part', () => {
  assert.notEqual(OUT, ONE, 'the build now writes into a later folder');
  assert.ok(build().length > 0);
  const one = rd(ONE);
  assert.equal(sha(ONE), ONE_SHA, 'the v1197 one file stays as it was given');
  assert.ok(one.startsWith('// secure-state の 1 ファイル（v1197）'));
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /affn: 1/); assert.match(one, /pvfn: 1/); assert.match(one, /ltfn: 1/);
  assert.match(one, /if \(body\.action === 'pv_tab'\)/);
  assert.match(one, /export const PV_COLS = \['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'am', 'chef', 'acct', 'tab'\];/);
});

test('the one-file secure-state answers the same as the module handler (pv_tab without a sign-in, pv_full with tabok, pv_get, aff_get)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvtab-one-test-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    const URL0 = 'https://db.example.test', SS = URL0 + '/functions/v1/secure-state';
    const JWT = sub => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated', sub })).toString('base64url') + '.c2ln';
    const UID = '22222222-2222-4222-8222-222222222222';
    const res = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    const DOC = { v: 1, off: false, cols: { tab: { 'p:menu': 's', 'p:vacation': 'h' }, g2: { 'p:budget': 'h' } }, people: { e9: { 'p:dashboard': 's' } }, only: { 'p:hiring': ['e9'] } };
    const fetchStub = async u => {
      const url = new URL(u);
      if (url.pathname === '/auth/v1/user') return res({ id: UID });
      const t = url.pathname.slice(9);
      if (t === 'manager_auth') return res([{ role: 'gm', emp_id: 'e9' }]);
      if (t === 'employees') return res([{ id: 'e9', name: 'Gina Ross', status: '在籍', data: { id: 'e9', name: 'Gina Ross', role: 'gm', status: '在籍' } }]);
      if (t === 'aff_people') return res([{ aff: 'hq', store: '', support: [], ver: 1, updated_at: '2026-11-18T18:00:00Z' }]);
      if (t === 'pv_doc') return res([{ id: 1, doc: DOC, ver: 4, updated_at: '2026-11-19T19:00:00Z', by_name: 'Gina Ross', by_role: 'gm' }]);
      throw new Error('unexpected ' + u);
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' })[k];
    const now = () => Date.parse('2026-11-19T20:00:00Z');
    const ask = async (h, body, signed) => {
      const r = await h(new Request(SS, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer ' + (signed ? JWT(UID) : 'anon-key') }, body: JSON.stringify(body) }));
      return [r.status, await r.json()];
    };
    for (const [body, signed] of [[{ action: 'pv_tab' }, false], [{ action: 'pv_full' }, true], [{ action: 'pv_get' }, true], [{ action: 'aff_get' }, true]]) {
      const a = await ask(mod.createHandler({ env, fetch: fetchStub, now }), body, signed);
      const b = await ask(createHandler({ env, fetch: fetchStub, now }), body, signed);
      assert.equal(a[0], 200, JSON.stringify(a));
      assert.deepEqual(a, b, body.action);
    }
    const t = await ask(mod.createHandler({ env, fetch: fetchStub, now }), { action: 'pv_tab' }, false);
    assert.deepEqual(t[1].pv, { ver: 4, at: '2026-11-19T19:00:00Z', col: { 'p:menu': 's', 'p:vacation': 'h' } });
    const fl = await ask(mod.createHandler({ env, fetch: fetchStub, now }), { action: 'pv_full' }, true);
    assert.equal(fl[1].tabok, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the rollback SQL is the db file, the steps are in order, and the v1195 one file to go back to is unchanged', () => {
  assert.equal(rd(D + '戻す前_SQL_店のタブレットの列を外す.sql'), rd('db/page-view-tab-drop.sql'));
  const s = rd(D + '手順.md');
  const order = ['1. **関数 secure-state を差し替える**', '2. **PR をマージし、全部の端末を 1197 にする**', '3. **（変えるときだけ）CEO・GM'];
  let at = -1; for (const x of order) { const i = s.indexOf(x); assert.ok(i > at, x); at = i; }
  assert.match(s, /戻す前_SQL_店のタブレットの列を外す\.sql/);
  assert.match(s, /deploy\/unified-stage2-v1195\/4_関数_secure-state_index\.ts/);
  assert.equal(sha('deploy/unified-stage2-v1195/4_関数_secure-state_index.ts'), 'b47740ea32ca07855e4f92aae8f9b0471246793ce7bd8a1613b06cb619db2915');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(), ['1_関数_secure-state_index.ts', '戻す前_SQL_店のタブレットの列を外す.sql', '手順.md'].sort());
});
