// v1212（B-2）：入れる一式（deploy/payroll-expense-v1212）が migration・関数と同じか。①③ が読むべきものを読むか・戻すと ② で戻るか。
// 合成の DB（申請の SQL の上・PGlite）だけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, M } from './approval-rules-world.mjs';

const D = new URL('../deploy/payroll-expense-v1212/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const SQL = M('20261218090000_payroll_expense');
const HANDLER = fs.readFileSync(new URL('../supabase/functions/payroll-expense/handler.mjs', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../supabase/functions/payroll-expense/index.ts', import.meta.url), 'utf8');

test('② は migration と同じ・④ は今の handler と serve の行だけ・鍵や名前は無い・手順が言うこと', () => {
  assert.equal(read('2_SQL_ガソリン代立替経費.sql'), SQL);
  const fn = read('4_関数_payroll-expense_index.ts');
  const lines = fn.split('\n');
  assert.equal(lines[0], '// @ts-nocheck'); assert.equal(lines[3], '');
  assert.equal(lines.slice(4).join('\n'), HANDLER + '\nDeno.serve(createHandler({ env: (key) => Deno.env.get(key) }));\n');
  assert.match(INDEX, /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/);
  assert.doesNotMatch(fn, /^import /m);
  for (const f of ['1_最初に確認_読むだけ.sql', '2_SQL_ガソリン代立替経費.sql', '3_確認_読むだけ.sql', '4_関数_payroll-expense_index.ts', '戻す_SQL.sql', '手順.md']) {
    const t = read(f);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}|sk_live|service_role_key\s*=|@funergy/i.test(t), f + '：鍵・メールが無い');
  }
  const h = read('手順.md');
  for (const w of ['Verify JWT は OFF', 'payroll-expense', '1212', '出力しただけでは支給済みになりません', '支給済みにする', '取り消せません', '22 日', '翌月 7 日', '前の金曜', '前の営業日', 'Federal Reserve',
    '既払・他経路支給額', '支給期間要確認', '支払状況要確認', '事務Crew', 'まとめて出力', '負の差額は給与から引きません', '#216 → #217 → #218', '戻す_SQL.sql'])
    assert.ok(h.includes(w), w);
});

test('①：申請の SQL が無ければ STOP・あれば OK（数だけ）。②③：入れると OK・2 回流しても同じ。戻すと関数だけ外れ、② で戻る', async () => {
  const s = await setup({});
  await s.pg.exec('reset role');
  await s.pg.exec(M('20261213090000_wr_lost'));
  const q = async t => { const r = await s.pg.exec(t); return r.at(-1).rows; };
  let r1 = await q(read('1_最初に確認_読むだけ.sql'));
  assert.deepEqual(r1.filter(x => x.result === 'STOP'), []);
  assert.equal(r1.find(x => x.no === 4).result, '注意', 'v1211 がまだ');
  assert.match(r1.find(x => x.no === 5).result, /まだ/);
  await s.pg.exec(M('20261217090000_wr_actor_crew_grant'));
  await s.pg.exec(read('2_SQL_ガソリン代立替経費.sql'));
  await s.pg.exec(read('2_SQL_ガソリン代立替経費.sql'));
  r1 = await q(read('1_最初に確認_読むだけ.sql'));
  assert.equal(r1.find(x => x.no === 4).result, 'OK');
  assert.match(r1.find(x => x.no === 5).result, /もう入っています/);
  const r3 = await q(read('3_確認_読むだけ.sql'));
  assert.deepEqual(r3.filter(x => x.result === 'NG'), [], JSON.stringify(r3));
  assert.ok(r3.filter(x => x.no >= 7).every(x => /^20\d{2}-\d{2}-\d{2}$/.test(x.detail)), '支給日');
  const nf = (await s.pg.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pe\\_%'`)).rows[0].n;
  assert.equal(nf, 26);
  // 割当の行を作ってから戻す → 関数だけ外れて行は残る → ③ が NG → ② で戻る
  await s.pg.exec(`insert into wr_requests (code, kind, status, store_id, requester_emp, requester_name, amount_cents, checked_at) values ('X1','reimburse','checked','S1','E8','Cam',500, now())`);
  await s.pg.query(`select public.pe_sync()`);
  await s.pg.exec(read('戻す_SQL.sql'));
  assert.equal((await s.pg.query(`select count(*)::int n from public.pe_alloc`)).rows[0].n, 1, '割当は残る');
  assert.equal((await s.pg.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pe\\_%'`)).rows[0].n, 0);
  await assert.rejects(q(read('3_確認_読むだけ.sql')));
  await s.pg.exec(read('2_SQL_ガソリン代立替経費.sql'));
  const r3b = await q(read('3_確認_読むだけ.sql'));
  assert.deepEqual(r3b.filter(x => x.result === 'NG'), []);
  assert.equal((await s.pg.query(`select count(*)::int n from public.pe_alloc`)).rows[0].n, 1);
});

test('② は前の SQL が無ければ STOP（何も変えない）', async () => {
  const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await assert.rejects(pg.exec(read('2_SQL_ガソリン代立替経費.sql')), /STOP: 先に申請の SQL/);
  assert.equal((await pg.query(`select to_regclass('public.pe_alloc') r`)).rows[0].r, null);
});
