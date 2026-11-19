// v1195 の入れる一式（deploy/unified-stage2-v1195/）：secure-state の 1 ファイルが今のソースから作ったものと同じで、
// 読み込めること・モジュールの handler と同じ答えを返すこと（所属の確認の頼みと、前の版の頼みも）。
// SQL の 4 つが元のファイルと 1 文字も違わないこと・手順の順番・戻すときの v1193 の 1 ファイルが変わっていないこと。合成データだけ。
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
const D = 'deploy/unified-stage2-v1195/';
const ONE = D + '4_関数_secure-state_index.ts';

test('the one-file secure-state (v1195) is what the build script makes now and has no private part', () => {
  assert.equal(OUT, ONE, 'the build writes into the v1195 folder');
  const one = rd(ONE);
  assert.equal(one, build(), 'the one file is up to date with the sources (run node scripts/build-secure-state-one.mjs)');
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /affn: 1/); assert.match(one, /pvfn: 1/); assert.match(one, /ltfn: 1/);
  assert.match(one, /async function affGet\(a\)/);
  assert.match(one, /async function affSave\(a, b\)/);
  assert.match(one, /aff_get: affGet, aff_full: affFull, aff_save: affSave/);
});

test('the one-file secure-state answers the same as the module handler (aff_get, aff_full, aff_save and the earlier pv_get)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aff-one-test-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    const URL0 = 'https://db.example.test', SS = URL0 + '/functions/v1/secure-state';
    const JWT = sub => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated', sub })).toString('base64url') + '.c2ln';
    const UID = '22222222-2222-4222-8222-222222222222';
    const res = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
    const ROWS = [{ emp_id: 'e1', aff: 'store', store: 'S1', support: ['S2'], ver: 2, updated_at: '2026-11-18T19:00:00Z', by_name: 'Gina Ross', by_role: 'gm' },
                  { emp_id: 'e9', aff: 'hq', store: '', support: [], ver: 1, updated_at: '2026-11-18T18:00:00Z', by_name: 'Gina Ross', by_role: 'gm' }];
    const LOG = [{ id: 7, at: '2026-11-18T19:00:00Z', emp_id: 'e1', emp_name: 'Kai Lee', ver: 2, by_name: 'Gina Ross', by_role: 'gm', reason: '', before: { aff: 'store', store: 'S1', support: [] }, after: { aff: 'store', store: 'S1', support: ['S2'] } }];
    const sent = [];
    const fetchStub = async (u, o) => {
      const url = new URL(u);
      if (url.pathname === '/auth/v1/user') return res({ id: UID });
      const t = url.pathname.slice(9);
      if (t === 'manager_auth') return res([{ role: 'gm', emp_id: 'e9' }]);
      if (t === 'employees') return res([{ id: 'e9', data: { id: 'e9', name: 'Gina Ross', title: 'General Manager', role: 'gm', status: '在籍' } },
                                         { id: 'e1', data: { id: 'e1', name: 'Kai Lee', role: 'crew', store: 'S1', status: '在籍' } }]);
      if (t === 'aff_people') return res(url.searchParams.get('emp_id') ? ROWS.filter(r => 'eq.' + r.emp_id === url.searchParams.get('emp_id')) : ROWS);
      if (t === 'aff_log') return res(LOG);
      if (t === 'stores') return res([{ id: 'S1' }, { id: 'S2' }]);
      if (t === 'rpc/aff_save') { sent.push(JSON.parse(o.body)); return res({ ok: true, rows: [{ emp_id: 'e1', ver: 3 }], same: 0, at: '2026-11-18T20:00:00Z' }); }
      if (t === 'pv_doc') return res([{ id: 1, doc: { v: 1, off: false, cols: {}, people: { e9: { 'p:dashboard': 's' } }, only: {} }, ver: 3, updated_at: '2026-11-18T19:00:00Z', by_name: 'Gina Ross', by_role: 'gm' }]);
      throw new Error('unexpected ' + u);
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' })[k];
    const now = () => Date.parse('2026-11-18T20:00:00Z');
    const ask = async (h, body) => {
      const r = await h(new Request(SS, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer ' + JWT(UID) }, body: JSON.stringify(body) }));
      return [r.status, await r.json()];
    };
    const SAVE = { action: 'aff_save', items: [{ emp: 'e1', aff: 'store', store: 'S1', support: ['S2'], expect: 2 }], reason: '確かめた' };
    for (const body of [{ action: 'aff_get' }, { action: 'aff_full' }, SAVE, { action: 'pv_get' }]) {
      const a = await ask(mod.createHandler({ env, fetch: fetchStub, now }), body);
      const b = await ask(createHandler({ env, fetch: fetchStub, now }), body);
      assert.equal(a[0], 200, JSON.stringify(a));
      assert.equal(a[1].affn, 1, 'the v1195 one file says it knows the affiliation check');
      assert.deepEqual(a, b, body.action);
    }
    const g = await ask(mod.createHandler({ env, fetch: fetchStub, now }), { action: 'aff_get' });
    assert.deepEqual(g[1].row, { aff: 'hq', store: '', support: [], ver: 1, at: '2026-11-18T18:00:00Z' }, 'only my own row');
    assert.ok(!JSON.stringify(g[1]).includes('e1'), 'no other person');
    assert.equal(sent.length, 2, 'both handlers called the save function once');
    assert.deepEqual(sent[0], sent[1]);
    assert.deepEqual(sent[0].p_items, [{ emp: 'e1', aff: 'store', store: 'S1', support: ['S2'], expect: 2, name: 'Kai Lee' }]);
    assert.equal(sent[0].p_by_role, 'gm');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the SQL files are byte-for-byte copies of the migration and the db files', () => {
  for (const [a, b] of [['1_確かめ_読むだけ.sql', 'db/aff-precheck.sql'], ['2_SQL_所属の確認.sql', 'supabase/migrations/20261212090000_aff_people.sql'],
                        ['3_確かめ_読むだけ.sql', 'db/aff-postcheck.sql'], ['戻す_SQL.sql', 'db/aff-rollback.sql']])
    assert.equal(rd(D + a), rd(b), a + ' = ' + b);
});

test('the rollback function (v1193) is unchanged and the steps name every file in order', () => {
  assert.equal(sha('deploy/page-view-v1193/4_関数_secure-state_index.ts'), '812cae2884a1f6315bec073a7b0093c4322b96dbe99753ae341cca9adc138235');
  assert.ok(!/affn/.test(rd('deploy/page-view-v1193/4_関数_secure-state_index.ts')), 'the v1193 function does not know the affiliation check');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_SQL_所属の確認.sql', '3_確かめ_読むだけ.sql', '4_関数_secure-state_index.ts', '戻す_SQL.sql',
                   'deploy/page-view-v1193/4_関数_secure-state_index.ts', 'docs/UNIFIED_UI_V1191_JA.md', 'scripts/build-secure-state-one.mjs',
                   'supabase/migrations/20261212090000_aff_people.sql'])
    assert.ok(how.includes(f), '手順.md names ' + f);
  const steps = how.slice(how.indexOf('## 入れる順番'), how.indexOf('## 入れたあと'));
  const at = t => { const i = steps.indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at('**`1_確かめ') < at('**`2_SQL') && at('**`2_SQL') < at('**`3_確かめ') && at('**`3_確かめ') < at('`4_関数') && at('`4_関数') < at('1195 にする')
    && at('1195 にする') < at('確かめて保存する'), 'the order: check, SQL, check, function, every device on 1195, then GM・CEO save');
  const back = how.slice(how.indexOf('## 戻すとき'), how.indexOf('## 困ったとき'));
  assert.ok(back.indexOf('page-view-v1193') >= 0 && back.indexOf('page-view-v1193') < back.indexOf('戻す_SQL.sql'), 'the function first, then the SQL');
  assert.match(how, /AM が見られる範囲は広げません/, 'the steps say AM access is not widened');
  assert.match(how, /左上の店・メニューの見え方は、この版では変わりません/, 'the steps say the left-top store and menus change from v1196');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(),
    ['1_確かめ_読むだけ.sql', '2_SQL_所属の確認.sql', '3_確かめ_読むだけ.sql', '4_関数_secure-state_index.ts', '戻す_SQL.sql', '手順.md'].sort());
});
