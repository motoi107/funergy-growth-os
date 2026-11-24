// Career Score 2026 Q4・段階 3-1 の入れる一式（deploy/career-score-q4-server/）：secure-state の 1 ファイルが今のソースから作ったものと同じで、
// 読み込める（同じ名前の宣言が無い）こと・モジュールの handler と同じ答えを返すこと（Career Score Q4 の頼みと前からの頼み）・非公開の部品が無いこと。
// SQL の 4 つ（確かめ・SQL・確かめ・戻す）が元のファイルと 1 文字も違わないこと・写す SQL は写す関数を呼ぶだけ・手順の順番。
// v1207 の 1 ファイルは渡したときのまま（tests/am-office-v1207.test.mjs が sha256 で固定）。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, withoutTail, TAIL, OUT, PARTS } from '../scripts/build-secure-state-one.mjs';
import { gen, OUT as GEN_OUT } from '../scripts/gen-secure-state-csq4.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const D = 'deploy/career-score-q4-server/';
const ONE = D + '4_関数_secure-state_index.ts';

test('the one-file secure-state is what the build script makes now and has no private part', () => {
  // キャリア・育成 A-2 から build() は deploy/growth-plan-a2/ に書く。段階 3-1 の 1 ファイルは渡したときのまま（sha256 で固定）
  assert.notEqual(OUT, ONE, 'the build now writes into a later folder');
  assert.deepEqual(PARTS, ['labor-core.gen.mjs', 'labor.mjs', 'csq4.gen.mjs', 'handler.mjs']);
  const one = rd(ONE);
  assert.equal(crypto.createHash('sha256').update(one).digest('hex'), '0d33d8f90abf24d3130ee491ab7cce589defd995a17ed6f2ec540f5133081107', 'the Career Score Q4 one file is as handed over');
  assert.equal(rd(GEN_OUT), gen(), 'csq4.gen.mjs is up to date (run node scripts/gen-secure-state-csq4.mjs)');
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /cs4fn: 1/);
  assert.match(one, /CAREER_2026_Q4_V1/);
  for (const a of ['cs4_me', 'cs4_roster', 'cs4_get', 'cs4_assign', 'cs4_start', 'cs4_reeval', 'cs4_save', 'cs4_act', 'cs4_req', 'cs4_answer', 'cs4_hist', 'cs4_copy']) assert.ok(one.includes(a + ':'), a);
  assert.ok(!/"reviewMemo"|reviewMemo:/.test(one), 'the review memo is not in the master (8 A)');
});

test('the one-file secure-state answers the same as the module handler (Career Score Q4 before the SQL, and an older action)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-one-csq4-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    assert.equal(typeof mod.createHandler, 'function');
    const mk = () => {
      const W = makeWorld({
        emps: [{ id: 'E-GM', name: 'Gina M', store: 'OFFICE', role: 'gm', title: 'General Manager', status: '', data: { name: 'Gina M', store: 'OFFICE' } },
               { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', status: '', data: { name: 'Kai One', store: 'S1' } }],
        mgr: { 'cccccccc-0000-0000-0000-000000000001': { emp_id: 'E-GM', role: 'gm' } },
        users: { gm: 'cccccccc-0000-0000-0000-000000000001' },
        pins: { tg1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false } },
      });
      const base = W.fetch;
      W.fetch = async (u, opt) => {
        const p = new URL(u).pathname;   // SQL の前（表と関数が無い）と同じ答え
        if (p.startsWith('/rest/v1/csq4_') || p.startsWith('/rest/v1/rpc/csq4_')) return new Response(JSON.stringify({ code: p.includes('/rpc/') ? 'PGRST202' : 'PGRST205' }), { status: 404, headers: { 'content-type': 'application/json' } });
        return base(u, opt);
      };
      W.set('growth_karte', { 'Kai One': { goal: 'x' } });
      return W;
    };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON })[k];
    const now = () => Date.UTC(2026, 10, 22, 20, 0, 0);
    const ask = async (mk2, body, hdr) => {
      const W = mk();
      const h = mk2({ env, fetch: W.fetch, now });
      const r = await h(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
      return [r.status, await r.json()];
    };
    const cases = [
      [{ action: 'cs4_me', pin_session: 'tg1' }, {}],
      [{ action: 'cs4_roster' }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'cs4_hist', legacy: true }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'cs4_start', emp: 'E-1' }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'cs4_copy' }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'cs4_save', id: 1, expect: 1, entries: {} }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'get', key: 'growth_karte' }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'pull', have: {} }, { authorization: 'Bearer ' + JWT('gm') }],
      [{ action: 'nope' }, { authorization: 'Bearer ' + JWT('gm') }],
    ];
    for (const [body, hdr] of cases) {
      const a = await ask(mod.createHandler, body, hdr), b = await ask(createHandler, body, hdr);
      delete b[1].gpfn;   // キャリア・育成 A-2 から handler は答えに gpfn:1 も付ける（この 1 ファイルは付けない）
      assert.deepEqual(a, b, body.action);
      if (['get', 'pull'].includes(body.action)) assert.equal(a[0], 200, body.action);
      assert.equal(a[1].cs4fn, 1, body.action);
    }
    assert.equal((await ask(mod.createHandler, cases[0][0], {}))[1].nosql, true);
    assert.deepEqual((await ask(mod.createHandler, cases[3][0], cases[3][1])).slice(0, 1), [503]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the SQL files are byte-for-byte copies; the copy SQL only calls the copy function; the steps are in order', () => {
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/csq4-precheck.sql'));
  assert.equal(rd(D + '2_SQL_Career Score Q4.sql'), rd('supabase/migrations/20261214090000_csq4.sql'));
  assert.equal(rd(D + '3_確かめ_読むだけ.sql'), rd('db/csq4-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/csq4-rollback.sql'));
  const cp = rd(D + '5_今の記録を写す.sql');
  const code = cp.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
  assert.deepEqual(code, ["select public.csq4_hist_copy('sql', null, null) as report;"]);
  for (const sql of ['1_確かめ_読むだけ.sql', '3_確かめ_読むだけ.sql']) {
    const s = rd(D + sql);
    assert.match(s, /^begin;$/m); assert.match(s, /^rollback;\s*$/m);
  }
  assert.ok(!/drop table/i.test(rd(D + '戻す_SQL.sql')), 'the rollback keeps the tables');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(),
    ['1_確かめ_読むだけ.sql', '2_SQL_Career Score Q4.sql', '3_確かめ_読むだけ.sql', '4_関数_secure-state_index.ts', '5_今の記録を写す.sql', '戻す_SQL.sql', '手順.md'].sort());
  const how = rd(D + '手順.md');
  const at = n => how.indexOf(n);
  const order = ['deploy/am-office-v1207/手順.md', '`1_確かめ_読むだけ.sql` を流す', '`2_SQL_Career Score Q4.sql` を流す', '`3_確かめ_読むだけ.sql` を流す',
    '関数 secure-state を差し替える', '`5_今の記録を写す.sql` を流す', '`3_確かめ_読むだけ.sql` をもう一度流す', '## 戻すとき'];
  for (const s of order) assert.ok(at(s) >= 0, s);
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), order[i]);
  assert.match(how, /Claude との会話にだけ/);
});
