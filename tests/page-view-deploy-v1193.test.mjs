// v1193 の入れる一式（deploy/page-view-v1193/）：secure-state の 1 ファイルが今のソースから作ったものと同じで、
// 読み込めること・モジュールの handler と同じ答えを返すこと（画面の表示の頼みも）。
// SQL の 6 つが元のファイルと 1 文字も違わないこと・手順の順番・戻すときの v1192 の 1 ファイルが変わっていないこと。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withoutTail, TAIL, OUT } from '../scripts/build-secure-state-one.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const D = 'deploy/page-view-v1193/';

// v1195 から build() は deploy/unified-stage2-v1195/ に書く。v1193 の 1 ファイルは Moto さんに渡したときのまま（sha256 で固定）
const ONE = D + '4_関数_secure-state_index.ts';
const ONE_SHA = '812cae2884a1f6315bec073a7b0093c4322b96dbe99753ae341cca9adc138235';

test('the one-file secure-state (v1193) is the file given to Moto and has no private part', () => {
  assert.notEqual(OUT, ONE, 'v1195 builds into its own folder');
  const one = rd(ONE);
  assert.equal(sha(ONE), ONE_SHA, 'the v1193 one file stays as it was given');
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /pvfn: 1/); assert.match(one, /ltfn: 1/);
  assert.ok(!/affn/.test(one), 'the v1193 function does not know the affiliation check');
  assert.match(one, /export function pvCheck\(doc\)/);
  assert.match(one, /async function pvSave\(a, b\)/);
});

test('the one-file secure-state answers the same as the module handler (pv_get and pv_full)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-one-test-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    const URL0 = 'https://db.example.test', SS = URL0 + '/functions/v1/secure-state';
    const JWT = sub => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated', sub })).toString('base64url') + '.c2ln';
    const UID = '22222222-2222-4222-8222-222222222222';
    const res = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    const DOC = { v: 1, off: false, cols: { g2: { 'p:dashboard': 'h' }, g1: { 'g1:g_tip': 's' } }, people: { e9: { 'p:dashboard': 's' }, e1: { 'p:kpi': 'h' } }, only: { 'p:budget': ['e9'] } };
    const fetchStub = async u => {
      const url = new URL(u);
      if (url.pathname === '/auth/v1/user') return res({ id: UID });
      const t = url.pathname.slice(9);
      if (t === 'manager_auth') return res([{ role: 'gm', emp_id: 'e9' }]);
      if (t === 'employees') return res([{ id: 'e9', data: { id: 'e9', name: 'Gina Ross', title: 'General Manager', role: 'gm', status: '在籍' } }]);
      if (t === 'pv_doc') return res([{ id: 1, doc: DOC, ver: 3, updated_at: '2026-11-18T19:00:00Z', by_name: 'Gina Ross', by_role: 'gm' }]);
      throw new Error('unexpected ' + u);
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' })[k];
    const now = () => Date.parse('2026-11-18T20:00:00Z');
    const ask = async (h, body) => {
      const r = await h(new Request(SS, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer ' + JWT(UID) }, body: JSON.stringify(body) }));
      return [r.status, await r.json()];
    };
    for (const body of [{ action: 'pv_get' }, { action: 'pv_full' }]) {
      const a = await ask(mod.createHandler({ env, fetch: fetchStub, now }), body);
      const b = await ask(createHandler({ env, fetch: fetchStub, now }), body);
      assert.equal(a[0], 200, JSON.stringify(a));
      delete b[1].affn;   // v1195 の handler は答えに affn:1 も付ける（v1193 の 1 ファイルは付けない）
      assert.deepEqual(a, b);
    }
    const g = await ask(mod.createHandler({ env, fetch: fetchStub, now }), { action: 'pv_get' });
    assert.deepEqual(g[1].pv.mine, { 'p:dashboard': 's' }, 'only my own person exceptions');
    assert.ok(!JSON.stringify(g[1]).includes('e1'), 'no other person');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the SQL files are byte-for-byte copies of the migration and the db files', () => {
  for (const [a, b] of [['1_確かめ_読むだけ.sql', 'db/page-view-precheck.sql'], ['2_SQL_画面の表示.sql', 'supabase/migrations/20261211090000_pv_doc.sql'],
                        ['3_確かめ_読むだけ.sql', 'db/page-view-postcheck.sql'], ['止める_SQL.sql', 'db/page-view-stop.sql'],
                        ['もう一度使う_SQL.sql', 'db/page-view-resume.sql'], ['戻す_SQL.sql', 'db/page-view-rollback.sql']])
    assert.equal(rd(D + a), rd(b), a + ' = ' + b);
});

test('the rollback function (v1192) is unchanged and the steps name every file in order', () => {
  assert.equal(sha('deploy/labor-totals-v1192/4_関数_secure-state_index.ts'), '86df77ff4a2d66b83574eab2ffab76687dacddcee5776aa848581382a12bdb6c');
  assert.ok(!/pvfn/.test(rd('deploy/labor-totals-v1192/4_関数_secure-state_index.ts')), 'the v1192 function does not know the page view');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_SQL_画面の表示.sql', '3_確かめ_読むだけ.sql', '4_関数_secure-state_index.ts', '止める_SQL.sql', 'もう一度使う_SQL.sql', '戻す_SQL.sql',
                   'deploy/labor-totals-v1192/4_関数_secure-state_index.ts', 'docs/PAGE_VIEW_V1193_JA.md', 'scripts/build-secure-state-one.mjs'])
    assert.ok(how.includes(f), '手順.md names ' + f);
  const steps = how.slice(how.indexOf('## 入れる順番'), how.indexOf('## 入れたあと'));
  const at = t => { const i = steps.indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at('**`1_確かめ') < at('**`2_SQL') && at('**`2_SQL') < at('**`3_確かめ') && at('**`3_確かめ') < at('`4_関数') && at('`4_関数') < at('1193 にする')
    && at('1193 にする') < at('初めて保存'), 'the order: check, SQL, check, function, every device on 1193, then the first save');
  const back = how.slice(how.indexOf('## 止めるとき'), how.indexOf('## 困ったとき'));
  assert.ok(back.indexOf('止める_SQL.sql') < back.indexOf('labor-totals-v1192') && back.indexOf('labor-totals-v1192') < back.indexOf('戻す_SQL.sql'),
    'stop first, then the function, then the SQL');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(),
    ['1_確かめ_読むだけ.sql', '2_SQL_画面の表示.sql', '3_確かめ_読むだけ.sql', '4_関数_secure-state_index.ts', 'もう一度使う_SQL.sql', '戻す_SQL.sql', '止める_SQL.sql', '手順.md'].sort());
});
