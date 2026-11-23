// Career Score 2026 Q4（新制度）段階 3-1：サーバーの表と関数（SQL 20261214090000・関数 secure-state の cs4_*）。合成データだけ（本番には接続しない）。
// 確かめること（docs/CAREER_SCORE_Q4_JA.md の 7・プロンプトの 9 の 1・2・3・5・6・7・17・18・20）：
//  1. SQL（PGlite の本物の PostgreSQL）：公開の鍵は表・番号・関数を使えない・サーバーの鍵でも消せない・空にできない（記録と写しは直せない）・
//     最初の確かめ・確認の SQL・戻す SQL・形の違う表で STOP・2 回流しても同じ・開いている評価と確定・公開は 1 人 1 つ（索引）・版の違う保存は書かない
//  2. 今までの記録の写し：元（app_state）は変えない・同じ中身は 2 回写さない・元が変われば足す（前の行は残す）・期間の無い記録は期間未確認（保存日で決めない）・
//     同じ名前の人は人を決めない・2026-Q4 の記録は「Q4・旧制度」（新しい評価には使わない）
//  3. 関数（本物の handler と PGlite）：だれが見る・採点する・確定するか・評価表の提案・始める（何度押しても初期化しない）・下書き（サーバーが計算し直す・
//     形の誤りは書かない・同時の保存は片方だけ）・本人に共有（根拠と書いた人は出さない）・見直しの申し出・確認待ち・差戻し・確定と公開・再評価（新しい改訂・
//     前の確定は残す）・取りやめ・変えた理由と前後の記録・SQL の前は nosql／not_installed・app_state と社員の表は書かない・答えにいつも cs4fn:1
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { CSQ4, CSQ4_MASTER } from '../supabase/functions/secure-state/csq4.gen.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261214090000_csq4.sql');
const PRE = rd('db/csq4-precheck.sql');
const POST = rd('db/csq4-postcheck.sql');
const BACK = rd('db/csq4-rollback.sql');
const Q4 = '2026-Q4';
const COMPANY = CSQ4.NA_REASON.COMPANY;
const ids = sys => CSQ4.csq4System(CSQ4_MASTER, sys).items.map(i => i.id);
const all = (sys, score) => Object.fromEntries(ids(sys).map(id => [id, { status: 'SCORED', score }]));
const TABLES = ['csq4_periods', 'csq4_assign', 'csq4_evals', 'csq4_reqs', 'csq4_log', 'csq4_runs', 'csq4_hist'];
const SEQS = ['csq4_evals_id_seq', 'csq4_reqs_id_seq', 'csq4_log_id_seq', 'csq4_runs_id_seq', 'csq4_hist_id_seq'];
const FNS = [['csq4_unwrap', ['jsonb']], ['csq4_open_reqs', ['text', 'text']], ['csq4_assign_save', ['jsonb', 'text', 'text', 'text']],
  ['csq4_eval_start', ['text', 'text', 'text', 'integer', 'jsonb', 'text', 'text', 'text']],
  ['csq4_eval_reeval', ['text', 'text', 'text', 'bigint', 'integer', 'boolean', 'text', 'jsonb', 'text', 'text', 'text']],
  ['csq4_eval_save', ['bigint', 'integer', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'text', 'text', 'text']],
  ['csq4_eval_act', ['bigint', 'integer', 'text', 'text', 'jsonb', 'boolean', 'text', 'text', 'text']],
  ['csq4_req_add', ['bigint', 'text', 'text', 'text', 'text', 'text']], ['csq4_req_answer', ['bigint', 'text', 'text', 'text', 'text']],
  ['csq4_hist_source', []], ['csq4_hist_copy', ['text', 'text', 'text']]];

// ---------- 合成の DB ----------
async function mkdb() {
  const db = new PGlite();
  // Supabase と同じく、public に作る表・番号・関数は anon・authenticated・service_role にも既定で権限が付く（だから SQL は明示的に外す）
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.employees(id text primary key, name text, store text, status text, data jsonb);
    create table public.wr_people(emp_id text primary key, name text not null, role text, grade integer);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());`);
  return db;
}
// 今までの記録（合成）：名前の記録（期間なし）・前の統合行・賞与の固定（包んだ形と四半期の行）・オフィス用・関係の無いキー
async function seed(db) {
  await db.exec(`insert into public.employees(id, name, store, status, data) values
      ('E-1', 'Kai One', 'S1', '', '{}'), ('E-D1', 'Dup Name', 'S1', '', '{}'), ('E-D2', 'Dup Name', 'S2', '退職', '{}'),
      ('E-L', 'Late Name', 'S1', '', '{}'), ('E-2', 'Sue Two', 'S2', '', '{}'), ('E-3', 'Kit Three', 'S1', '', '{}'), ('E-OF', 'Ofelia', 'ALL', '', '{}');
    insert into public.app_state(key, value, updated_at) values
      ('lss_emp_Kai One', '{"H-01":2,"A-01":3}', '2026-10-01 09:59:59.5+00'),
      ('lss_emp_Dup Name', '{"H-01":1}', '2026-11-01 00:00:00+00'),
      ('lss_emp_Late Name', '{"H-01":3}', '2027-01-01 10:00:00+00'),
      ('lss_emp_', '{"H-01":0}', '2026-11-01 00:00:00+00'),
      ('spl_lss_history_Kai One', '[{"pct":60,"at":"2026-08-01"}]', '2026-11-01 00:00:00+00'),
      ('spl_lss_requests_Dup Name', '[{"id":"r1"}]', '2026-11-01 00:00:00+00'),
      ('lss_scores', '{"Someone":{"H-01":2}}', '2026-09-01 00:00:00+00'),
      ('bonus_q', '{"__st":1,"v":{"2026-Q3":{"csFreeze":{"E-1":{"pct":70}}},"2026-Q4":{"__st":1,"v":{"csFreeze":{"E-1":{"pct":71},"E-2":{"pct":60}}}},"cfg":{"x":1}},"_at":"2026-11-01T00:00:00Z"}', '2026-11-01 00:00:00+00'),
      ('spl_bonus_q_2026-Q4', '{"csFreeze":{"E-3":{"pct":80}}}', '2026-11-01 00:00:00+00'),
      ('ocs_ev_E-OF', '{"empId":"E-OF","evals":{"2026-Q3":{"total":70},"2026-Q4":{"total":72},"bad":{"total":1}}}', '2026-11-01 00:00:00+00'),
      ('cfg_other', '{"a":1}', '2026-11-01 00:00:00+00');`);
}
async function as(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const table = async (db, sql) => { const out = []; const rs = await db.exec(sql); for (const r of rs) if (r.fields && r.fields.some(f => f.name === 'ok')) out.push(...r.rows); return out; };
const row = (rows, n) => rows.find(r => r.n === n);
const snap = async db => (await db.query('select key, value::text v, updated_at::text t from public.app_state order by key')).rows;
const copySql = async (db, via = 'sql') => (await as(db, 'service_role', 'select public.csq4_hist_copy($1, null, null) r', [via])).rows[0].r;
const nullCall = (f, ts) => ts.length ? `select public.${f}(${ts.map(t => 'null::' + t).join(', ')})` : `select * from public.${f}()`;

// ---------- 1. SQL ----------
test('SQL: the public keys cannot use the tables, numbers or functions; the server key cannot delete; precheck, postcheck, twice the same', async () => {
  const db = await mkdb(); await seed(db);
  const pre = await table(db, PRE);
  assert.ok(pre.every(r => !/STOP/.test(r.ok)), JSON.stringify(pre));
  assert.equal(row(pre, 4).value, '3 人分');   // lss_emp_ の 3 人（キーだけ「lss_emp_」の行は数えない）
  assert.equal(row(pre, 5).value, '1 人分');
  assert.equal(row(pre, 6).value, '1 人分');
  assert.equal(row(pre, 7).value, '1 行');
  assert.equal(row(pre, 8).value, '2 行');
  assert.equal(row(pre, 9).value, '1 人分');
  assert.match(row(pre, 10).value, /^1 組/);   // 同じ名前（退職の人も数える）
  assert.equal(row(pre, 11).value, 'まだ無い');
  for (const n of [2, 3, 12]) assert.deepEqual([row(pre, n).value, row(pre, n).ok], ['まだ無い', 'OK']);
  const before = await snap(db);
  await db.exec(MIG);
  await db.exec(MIG);   // 2 回目も通る（行は消えない）
  assert.deepEqual(await snap(db), before, 'the SQL does not touch app_state');
  const pre2 = await table(db, PRE);
  for (const n of [2, 3, 12]) assert.equal(row(pre2, n).ok, 'OK（2 回目）');
  assert.equal(row(pre2, 11).value, 'もうある');
  for (const role of ['anon', 'authenticated']) {
    for (const t of TABLES) {
      await assert.rejects(as(db, role, `select * from public.${t}`), /permission denied/, role + ' select ' + t);
      await assert.rejects(as(db, role, `insert into public.${t} default values`), /permission denied/, role + ' insert ' + t);
      await assert.rejects(as(db, role, `update public.${t} set ${t === 'csq4_periods' ? 'version' : t === 'csq4_assign' ? 'by_name' : t === 'csq4_runs' ? 'by_name' : t === 'csq4_hist' ? 'emp_name' : t === 'csq4_log' ? 'by_name' : t === 'csq4_reqs' ? 'note' : 'note'} = 'x'`), /permission denied/, role + ' update ' + t);
    }
    for (const s of SEQS) await assert.rejects(as(db, role, `select nextval('public.${s}')`), /permission denied/, role + ' ' + s);
    for (const [f, ts] of FNS) await assert.rejects(as(db, role, nullCall(f, ts)), /permission denied/, role + ' ' + f);
  }
  for (const t of TABLES) {
    await assert.rejects(as(db, 'service_role', `delete from public.${t}`), /permission denied/, 'service delete ' + t);
    await assert.rejects(as(db, 'service_role', `truncate public.${t} cascade`), /permission denied/, 'service truncate ' + t);
  }
  await assert.rejects(as(db, 'service_role', `update public.csq4_log set action = 'x'`), /permission denied/);
  await assert.rejects(as(db, 'service_role', `update public.csq4_hist set emp_name = 'x'`), /permission denied/);
  await assert.rejects(as(db, 'service_role', `update public.csq4_periods set version = 'x'`), /permission denied/);
  const post = await table(db, POST);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12]) assert.equal(row(post, n).ok, 'OK', JSON.stringify(row(post, n)));
  assert.equal(row(post, 6).value, '2026-Q4 2026-10-01〜2026-12-31 CAREER_2026_Q4_V1');
  assert.equal(row(post, 9).ok, 'info');
  assert.equal(row(post, 10).ok, 'info');
  assert.equal(row(post, 11).ok, 'info（まだ写していない）');
  assert.equal((await db.query('select count(*)::int n from public.csq4_assign')).rows[0].n, 0, 'the postcheck conflict test wrote nothing');
  await assert.rejects(as(db, 'service_role', `select public.csq4_hist_copy('app', null, null)`), /csq4_bad_via/);
});

test('SQL: a table of another shape stops the SQL and the precheck (nothing changes)', async () => {
  for (const [t, ddl, n] of [['csq4_evals', 'create table public.csq4_evals(id int)', 2], ['csq4_hist', 'create table public.csq4_hist(id int)', 3],
                             ['csq4_assign', 'create table public.csq4_assign(emp_id text)', 12]]) {
    const db = await mkdb();
    await db.exec(ddl);
    const pre = await table(db, PRE);
    assert.equal(row(pre, n).ok, 'STOP（形が違う）', t);
    await assert.rejects(db.exec(MIG), /STOP/, t);
    assert.equal((await db.query(`select to_regclass('public.csq4_periods') r`)).rows[0].r, null, t + ': nothing was created');
  }
});

test('SQL: one open and one published evaluation per person; a save with an old version writes nothing; the rollback keeps the rows', async () => {
  const db = await mkdb(); await seed(db); await db.exec(MIG);
  await assert.rejects(db.query(`insert into public.csq4_evals(emp_id, period, system, version, rev, status, result) values
    ('X', '2026-Q4', 'PREP', 'v', 1, 'draft', '{}'), ('X', '2026-Q4', 'PREP', 'v', 2, 'submitted', '{}')`), e => e.code === '23505');
  await assert.rejects(db.query(`insert into public.csq4_evals(emp_id, period, system, version, rev, status, result) values
    ('Y', '2026-Q4', 'PREP', 'v', 1, 'published', '{}'), ('Y', '2026-Q4', 'PREP', 'v', 2, 'published', '{}')`), e => e.code === '23505');
  const sv = (sql, p) => as(db, 'service_role', sql, p).then(x => x.rows[0].r);
  const a = await sv(`select public.csq4_assign_save($1::jsonb, 'E-GM', 'Gina M', 'gm') r`, [JSON.stringify([{ emp: 'E-1', name: 'Kai One', period: Q4, system: 'PREP', grade: null, type: null, expect: 0 }])]);
  assert.equal(a.ok, true);
  const s = await sv(`select public.csq4_eval_start('E-1', 'Kai One', '2026-Q4', 1, '{}'::jsonb, 'E-AM', 'Amy', 'am') r`);
  assert.equal(s.ok, true); assert.equal(s.ver, 1);
  const s2 = await sv(`select public.csq4_eval_start('E-1', 'Kai One', '2026-Q4', 1, '{}'::jsonb, 'E-AM', 'Amy', 'am') r`);
  assert.deepEqual([s2.resumed, s2.id], [true, s.id], 'starting again resumes');
  const bad = await sv(`select public.csq4_eval_save($1, 5, '{"PH1":{"status":"SCORED","score":3}}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, null, null, null) r`, [s.id]);
  assert.deepEqual(bad, { ok: false, conflict: true, ver: 1, status: 'draft' });
  assert.deepEqual((await db.query('select entries, ver from public.csq4_evals where id = $1', [s.id])).rows[0], { entries: {}, ver: 1 });
  const n0 = (await db.query('select (select count(*) from public.csq4_evals)::int e, (select count(*) from public.csq4_log)::int l')).rows[0];
  await db.exec(BACK); await db.exec(BACK);   // 2 回流しても同じ
  const n1 = (await db.query('select (select count(*) from public.csq4_evals)::int e, (select count(*) from public.csq4_log)::int l')).rows[0];
  assert.deepEqual(n1, n0, 'the rollback keeps the rows');
  const post = await table(db, POST);
  for (const n of [4, 8, 10]) assert.match(row(post, n).ok, /^NG/, JSON.stringify(row(post, n)));
  await db.exec(MIG);
  const post2 = await table(db, POST);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12]) assert.equal(row(post2, n).ok, 'OK');
});

test('Honolulu dates: the quarter starts and ends at Honolulu midnight', () => {
  const t = (...a) => Date.UTC(...a);
  assert.equal(CSQ4.csq4HnlDate(t(2026, 9, 1, 9, 59, 59, 500)), '2026-09-30');
  assert.equal(CSQ4.csq4HnlDate(t(2026, 9, 1, 10, 0, 0)), '2026-10-01');
  assert.equal(CSQ4.csq4HnlDate(t(2027, 0, 1, 9, 59, 59)), '2026-12-31');
  assert.equal(CSQ4.csq4HnlDate(t(2027, 0, 1, 10, 0, 0)), '2027-01-01');
  assert.deepEqual([t(2026, 9, 1, 9, 59, 59, 500), t(2026, 9, 1, 10), t(2027, 0, 1, 9, 59, 59), t(2027, 0, 1, 10)].map(x => CSQ4.csq4InPeriod(CSQ4_MASTER, x)),
    [false, true, true, false]);
});

// ---------- 2. 今までの記録の写し ----------
test('copying the old records: the source is not changed, the same content is copied once, a changed source adds a row, no period stays unknown', async () => {
  const db = await mkdb(); await seed(db); await db.exec(MIG);
  const before = await snap(db);
  const r1 = await copySql(db);
  assert.deepEqual({ ...r1, run: 0, at: 0 }, { run: 0, at: 0, added: 12,
    kinds: { lss_emp: { src: 3, present: 3 }, lss_history: { src: 1, present: 1 }, lss_requests: { src: 1, present: 1 }, lss_legacy: { src: 1, present: 1 },
             bonus_csfreeze: { src: 4, present: 4 }, ocs_ev: { src: 2, present: 2 } },
    periods: { '2026-Q3': 2, '2026-Q4': 4 }, unknown: 6, no_emp: 3, missing: 0, hist_rows: 12 });
  assert.deepEqual(await snap(db), before, 'the source is not changed');
  const H = async () => (await db.query('select src_key, src_part, kind, emp_id, emp_name, period, period_state, data from public.csq4_hist order by id')).rows;
  const h = await H();
  const k = (key, part = '') => h.filter(x => x.src_key === key && x.src_part === part);
  assert.deepEqual(k('lss_emp_Kai One').map(x => [x.emp_id, x.period, x.period_state]), [['E-1', null, 'unknown']], 'saved just before the quarter: still unknown');
  assert.deepEqual(k('lss_emp_Late Name').map(x => [x.emp_id, x.period, x.period_state]), [['E-L', null, 'unknown']], 'saved just after the quarter: still unknown');
  assert.deepEqual(k('lss_emp_Dup Name').map(x => x.emp_id), [null], 'the same name twice: no person');
  assert.deepEqual(k('spl_lss_requests_Dup Name').map(x => x.emp_id), [null]);
  assert.equal(k('lss_emp_').length, 0);
  assert.deepEqual(k('bonus_q', '2026-Q4|E-1').map(x => [x.emp_id, x.emp_name, x.period, x.period_state, x.data]), [['E-1', 'Kai One', '2026-Q4', 'known', { pct: 71 }]]);
  assert.deepEqual(k('bonus_q', '2026-Q3|E-1').map(x => x.data), [{ pct: 70 }]);
  assert.deepEqual(k('spl_bonus_q_2026-Q4', '2026-Q4|E-3').map(x => [x.emp_id, x.emp_name]), [['E-3', 'Kit Three']]);
  assert.deepEqual(h.filter(x => x.kind === 'ocs_ev').map(x => [x.emp_id, x.emp_name, x.period]).sort(), [['E-OF', 'Ofelia', '2026-Q3'], ['E-OF', 'Ofelia', '2026-Q4']]);
  assert.equal(h.filter(x => x.src_key === 'cfg_other').length, 0);
  const r2 = await copySql(db);
  assert.equal(r2.added, 0); assert.equal(r2.hist_rows, 12); assert.equal(r2.missing, 0);
  assert.equal((await db.query('select count(*)::int n from public.csq4_runs')).rows[0].n, 2);
  const post = await table(db, POST);
  assert.equal(row(post, 11).ok, 'OK');
  await db.query(`update public.app_state set value = '{"H-01":3,"A-01":3}' where key = 'lss_emp_Kai One'`);
  const r3 = await copySql(db, 'fn');
  assert.equal(r3.added, 1); assert.equal(r3.hist_rows, 13);
  assert.deepEqual((await H()).filter(x => x.src_key === 'lss_emp_Kai One').map(x => x.data), [{ 'H-01': 2, 'A-01': 3 }, { 'H-01': 3, 'A-01': 3 }], 'the old row stays');
});

test('copying: a name owned by two people (the column, the data name or the confirmed copy) gets no person (#214 review)', async () => {
  const db = await mkdb(); await seed(db);
  await db.exec(`insert into public.employees(id, name, store, status, data) values
      ('E-C1', 'Col Name', 'S1', '', '{"name":"Data Twin"}'), ('E-C2', 'Data Twin', 'S2', '', '{}'),
      ('E-C3', 'Only Data', 'S1', '', '{"name":"Only Data"}'), ('E-C4', 'Conf Twin', 'S1', '', '{}');
    insert into public.wr_people(emp_id, name, role, grade) values ('E-W9', 'Conf Twin', 'staff', 2), ('E-C3', 'Only Data', 'staff', 1);
    insert into public.app_state(key, value, updated_at) values
      ('lss_emp_Data Twin', '{"H-01":2}', '2026-11-01 00:00:00+00'), ('lss_emp_Conf Twin', '{"H-01":2}', '2026-11-01 00:00:00+00'),
      ('lss_emp_Only Data', '{"H-01":2}', '2026-11-01 00:00:00+00');`);
  await db.exec(MIG);
  await copySql(db);
  const who = async k => (await db.query('select emp_id from public.csq4_hist where src_key = $1', [k])).rows.map(r => r.emp_id);
  assert.deepEqual(await who('lss_emp_Data Twin'), [null], 'one person has it as the column, another in the data');
  assert.deepEqual(await who('lss_emp_Conf Twin'), [null], 'another person has it in the confirmed copy');
  assert.deepEqual(await who('lss_emp_Only Data'), ['E-C3'], 'one person in several places is still one person');
  assert.deepEqual(await who('lss_emp_Kai One'), ['E-1']);
  const pre = await table(await (async () => { const d = await mkdb(); await d.exec(`insert into public.employees(id, name, data) values ('A', 'X', '{}'), ('B', 'Y', '{"name":"X"}')`); return d; })(), PRE);
  assert.match(row(pre, 10).value, /^1 組/, 'the precheck counts the same owners');
  const noW = await mkdb(); await noW.exec('drop table public.wr_people');
  await assert.rejects(() => noW.exec(MIG), /STOP: public\.wr_people/);
  assert.equal(row(await table(noW, PRE), 1).ok, 'STOP（無い）');
});

// ---------- 3. 関数 ----------
const U = n => 'cccccccc-0000-0000-0000-00000000000' + n;
const E = (id, name, store, role, title, status = '') => ({ id, name, store, role, title, status, data: { name, store } });
const EMPS = [
  E('E-CEO', 'Cal E', 'ALL', 'ceo', ''), E('E-GM', 'Gina M', 'OFFICE', 'gm', 'General Manager'), E('E-AM', 'Amy Area', 'S1', 'am', 'Area Manager'), E('E-AM2', 'Ann Two', 'S1', 'am', 'Area Manager'),
  E('E-CH', 'Chef Hana', 'S1', 'chef', 'Head Chef'), E('E-4', 'Leo Four', 'S1', 'g4', 'Store Manager'), E('E-3', 'Kit Three', 'S1', 'sl', 'Kitchen Leader'),
  E('E-1', 'Kai One', 'S1', 'crew', 'Crew'), E('E-1B', 'Ben One', 'S1', 'crew', 'Crew'), E('E-2', 'Sue Two', 'S2', 'crew', 'Crew'),
  E('E-P', 'Pat Prep', 'S1', 'crew', 'Prep'), E('E-OC', 'Oscar Crew', 'ALL', 'office_crew', 'Office Crew'), E('E-OF', 'Ofelia', 'ALL', 'office', 'Accountant'),
  E('E-OUT', 'Otto Out', 'S1', 'crew', 'Crew', '退職'),
];
const PIN = (emp, role, grade, stores = [], extra = {}) => ({ emp, role, grade, stores, am_stores: [], name: (EMPS.find(e => e.id === emp) || {}).name || '', confirmed: true, ...extra });
const SIG = {
  csq4_assign_save: [['p_items', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_eval_start: [['p_emp', 'text'], ['p_name', 'text'], ['p_period', 'text'], ['p_assign_ver', 'integer'], ['p_result', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_eval_reeval: [['p_emp', 'text'], ['p_name', 'text'], ['p_period', 'text'], ['p_pub_id', 'bigint'], ['p_assign_ver', 'integer'], ['p_copy', 'boolean'], ['p_reason', 'text'], ['p_result', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_eval_save: [['p_id', 'bigint'], ['p_expect', 'integer'], ['p_entries', 'jsonb'], ['p_prep', 'jsonb'], ['p_feedback', 'jsonb'], ['p_result', 'jsonb'], ['p_changes', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_eval_act: [['p_id', 'bigint'], ['p_expect', 'integer'], ['p_act', 'text'], ['p_note', 'text'], ['p_shared', 'jsonb'], ['p_ok', 'boolean'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_req_add: [['p_eval_id', 'bigint'], ['p_item', 'text'], ['p_kind', 'text'], ['p_note', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text']],
  csq4_req_answer: [['p_id', 'bigint'], ['p_answer', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  csq4_hist_copy: [['p_via', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text']],
};
const unq = s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const splitList = s => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.map(unq); };

async function setup({ sql = true, extra = [] } = {}) {
  const db = await mkdb(); await seed(db);
  if (sql) await db.exec(MIG);
  const W = makeWorld({
    emps: [...EMPS, ...extra].map(e => ({ ...e, data: { ...e.data } })),
    mgr: { [U(1)]: { emp_id: 'E-GM', role: 'gm' }, [U(2)]: { emp_id: 'E-OF', role: 'office' }, [U(3)]: { emp_id: 'E-CEO', role: 'ceo' },
           [U(4)]: { emp_id: null, role: 'gm' }, [U(5)]: { emp_id: 'E-OC', role: 'office_crew' } },
    users: { gm: U(1), of: U(2), ceo: U(3), gmx: U(4) },
    wrPeople: [{ emp_id: 'E-AM', name: 'Amy Area', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'] },
               { emp_id: 'E-AM2', name: 'Ann Two', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'] },
               { emp_id: 'E-3', name: 'Kit Three', role: 'staff', grade: 3, stores: ['S1'] },
               { emp_id: 'E-4', name: 'Leo Four', role: 'staff', grade: 4, stores: ['S1'] },
               { emp_id: 'E-CH', name: 'Chef Hana', role: 'staff', grade: 4, stores: ['S1'], chef: true }],
    pins: { tceo: PIN('E-CEO', 'ceo', 7), tgm: PIN('E-GM', 'gm', 6), tam: PIN('E-AM', 'am', 5, ['S1'], { am_stores: ['S1'] }),
            tch: PIN('E-CH', 'staff', 4, ['S1']), tg4: PIN('E-4', 'staff', 4, ['S1']), tg3: PIN('E-3', 'staff', 3, ['S1']),   // GM・CEO が確かめた G3（自分の店の G2 だけ採点する・Moto さん 11/23）
            tg1: PIN('E-1', 'staff', 1, ['S1'], { confirmed: false }), tg1b: PIN('E-1B', 'staff', 1, ['S1'], { confirmed: false }),
            tg2: PIN('E-2', 'staff', 1, ['S2'], { confirmed: false }), tp: PIN('E-P', 'staff', 1, ['S1'], { confirmed: false }),
            tout: PIN('E-OUT', 'staff', 1, ['S1'], { confirmed: false }) },
  });
  W.set('bonus_track', { '2026-Q4|E-1': { t: 'kt' }, '2026-Q3|E-1B': { t: 'sv' } });
  // csq4_* の読み書き（PostgREST の代わり）：サーバーの鍵だけ・PGlite に service_role で流す（1 つずつ）
  let chain = Promise.resolve();
  const lock = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const base = W.fetch;
  W.db = { gets: 0, rpcs: [] };
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname, m = (opt.method || 'GET').toUpperCase();
    if (!p.startsWith('/rest/v1/csq4_') && !p.startsWith('/rest/v1/rpc/csq4_')) return base(u, opt);
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(h.apikey, SERVICE, 'csq4 tables only with the server key');
    if (!sql) return J({ code: p.includes('/rpc/') ? 'PGRST202' : 'PGRST205', message: 'not found' }, 404);
    try {
      if (p.startsWith('/rest/v1/rpc/')) {
        assert.equal(m, 'POST');
        const fn = p.slice('/rest/v1/rpc/'.length), sig = SIG[fn];
        assert.ok(sig, 'known rpc ' + fn);
        const body = JSON.parse(opt.body);
        assert.deepEqual(Object.keys(body).sort(), sig.map(x => x[0]).sort(), fn + ' arguments');
        const params = sig.map(([k, t]) => { const v = body[k]; if (v === null || v === undefined) return null; if (t === 'jsonb') return JSON.stringify(v); if (t === 'boolean') return !!v; return String(v); });
        W.db.rpcs.push(fn);
        const r = await lock(() => as(db, 'service_role', `select public.${fn}(${sig.map(([k, t], i) => `${k} => $${i + 1}::${t}`).join(', ')}) as r`, params));
        return J(r.rows[0].r);
      }
      assert.equal(m, 'GET');
      const tbl = p.slice('/rest/v1/'.length);
      assert.match(tbl, /^csq4_[a-z_]+$/);
      const q = url.searchParams, cols = (q.get('select') || '*').split(','), where = [], params = [];
      for (const c of cols) assert.match(c, /^[a-z_]+$/);
      for (const [k, v] of q.entries()) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        assert.match(k, /^[a-z_]+$/);
        if (v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k}::text = $${params.length}`); }
        else if (v.startsWith('in.(') && v.endsWith(')')) { params.push(JSON.stringify(splitList(v.slice(4, -1)))); where.push(`${k}::text in (select jsonb_array_elements_text($${params.length}::jsonb))`); }
        else if (v === 'is.null') where.push(`${k} is null`);
        else throw new Error('filter ' + k + '=' + v);
      }
      let order = '';
      if (q.get('order')) { const [c, d] = q.get('order').split('.'); assert.match(c, /^[a-z_]+$/); order = ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; }
      const lim = q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '';
      W.db.gets++;
      const r = await lock(() => as(db, 'service_role', `select coalesce(json_agg(t), '[]'::json) j from (select ${cols.join(',')} from public.${tbl}${where.length ? ' where ' + where.join(' and ') : ''}${order}${lim}) t`, params));
      return J(r.rows[0].j);
    } catch (e) {
      const c = String(e.code || ''); if (process.env.CSQ4_DEBUG) console.error('rpc error', c, e.message);
      return J({ code: c, message: String(e.message || e) }, c.startsWith('22') || c === 'P0001' ? 400 : c === '23505' ? 409 : 500);
    }
  };
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 22, 20, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    assert.equal(j && j.cs4fn, 1, 'every answer says cs4fn:1 ' + JSON.stringify(body).slice(0, 80));
    return { status: r.status, j };
  };
  const pin = (who, body) => call({ ...body, pin_session: 't' + who });
  const email = (who, body) => call(body, { authorization: 'Bearer ' + JWT(who) });
  return { db, W, call, pin, email };
}
const okj = (r, what) => { assert.equal(r.status, 200, what + ' ' + JSON.stringify(r.j)); assert.equal(r.j.error, undefined, what); return r.j; };
const fail = (r, status, error, what) => { assert.equal(r.status, status, what + ' ' + JSON.stringify(r.j)); assert.equal(r.j.error, error, what); return r.j; };
const evalRow = async (db, id) => (await db.query('select * from public.csq4_evals where id = $1', [id])).rows[0];

test('who sees whom: rosters, suggested evaluation forms, retired and no-employee accounts', async () => {
  const { pin, email, W } = await setup();
  const emps = async r => okj(await r, 'roster').rows.map(x => x.emp).sort();
  assert.deepEqual(await emps(email('gm', { action: 'cs4_roster' })), ['E-1', 'E-1B', 'E-2', 'E-3', 'E-4', 'E-AM', 'E-AM2', 'E-CEO', 'E-CH', 'E-OC', 'E-OF', 'E-P'], 'the GM sees the CEO person too (not self)');
  assert.deepEqual(await emps(pin('ceo', { action: 'cs4_roster' })), ['E-1', 'E-1B', 'E-2', 'E-3', 'E-4', 'E-AM', 'E-AM2', 'E-CH', 'E-GM', 'E-OC', 'E-OF', 'E-P']);
  assert.deepEqual(await emps(pin('am', { action: 'cs4_roster' })), ['E-1', 'E-1B', 'E-3', 'E-4', 'E-CH', 'E-P'], 'not the other AM of the same store');
  assert.deepEqual(await emps(pin('ch', { action: 'cs4_roster' })), ['E-3', 'E-P']);
  assert.deepEqual(await emps(pin('g4', { action: 'cs4_roster' })), ['E-1', 'E-1B', 'E-3', 'E-P']);
  assert.deepEqual(await emps(pin('g3', { action: 'cs4_roster' })), [], 'the G3 scores G2 only (no G2 in S1 here)');
  assert.deepEqual(await emps(pin('g1', { action: 'cs4_roster' })), []);
  assert.deepEqual(await emps(email('of', { action: 'cs4_roster' })), ['E-OC']);
  fail(await pin('out', { action: 'cs4_roster' }), 403, 'forbidden', 'retired');
  fail(await email('gmx', { action: 'cs4_roster' }), 403, 'no_emp', 'a GM account without an employee');
  assert.equal(okj(await email('gmx', { action: 'cs4_me' }), 'me').none, true);
  const R = okj(await pin('ceo', { action: 'cs4_roster' }), 'roster');
  const sug = Object.fromEntries(R.rows.map(x => [x.emp, x.suggest && [x.suggest.system, x.suggest.grade, x.suggest.type, x.suggest.from].join(' ')]));
  assert.deepEqual(sug, {
    'E-1': 'G G1 Kitchen中心 track', 'E-1B': 'G G1  none', 'E-2': 'G G1  none', 'E-3': 'G G3 Kitchen中心 title', 'E-P': 'PREP   title',
    'E-CH': 'S_CHEF S4  dept', 'E-4': 'G G4 店長 grade', 'E-AM': 'G G5 管轄責任 grade', 'E-AM2': 'G G5 管轄責任 grade', 'E-GM': 'G G6 全社責任 grade', 'E-OF': 'S_OFFICE S4  dept', 'E-OC': 'S_OFFICE S1  dept',
  });
  assert.deepEqual(R.counts, { not_started: 12, draft: 0, submitted: 0, returned: 0, published: 0 });
  assert.equal(R.rows.find(x => x.emp === 'E-GM').can.assign, true);
  assert.equal(okj(await pin('am', { action: 'cs4_roster' }), 'am').rows.every(x => x.can.score && !x.can.confirm && !x.can.assign), true);
  assert.equal(W.calls.post + W.calls.patch, 0);
});

test('the main flow (G1 Kitchen中心): assign, start, save, share, requests, submit, return, confirm, re-evaluate, cancel', async () => {
  const { db, W, pin, email } = await setup();
  const empsBefore = JSON.stringify(W.emps), rowsBefore = JSON.stringify([...W.rows]);
  // 今までの記録を写してから始める（写した 2026-Q4 の記録は「Q4・旧制度」・新しい評価は空から）
  fail(await pin('am', { action: 'cs4_copy' }), 403, 'forbidden', 'AM cannot copy');
  const c1 = okj(await email('gm', { action: 'cs4_copy' }), 'copy');
  assert.equal(c1.report.added, 12); assert.equal(c1.report.missing, 0);
  assert.equal(okj(await email('gm', { action: 'cs4_copy' }), 'copy again').report.added, 0);
  const leg = okj(await email('gm', { action: 'cs4_hist', legacy: true }), 'legacy');
  assert.equal(leg.rows.length, 3); assert.equal(leg.runs.length, 2);
  fail(await pin('am', { action: 'cs4_hist', legacy: true }), 403, 'forbidden');
  const hE1 = okj(await pin('am', { action: 'cs4_hist', emp: 'E-1' }), 'hist E-1').rows;
  assert.equal(hE1.length, 4);
  assert.deepEqual(hE1.filter(x => x.oldSystem).map(x => [x.kind, x.period]), [['bonus_csfreeze', '2026-Q4']], 'the old Q4 record is marked old');
  assert.ok(hE1.filter(x => x.period_state === 'unknown').every(x => x.period === null));
  fail(await pin('am', { action: 'cs4_hist', emp: 'E-2' }), 403, 'forbidden', 'not my store');
  fail(await pin('g1', { action: 'cs4_hist', emp: 'E-1' }), 403, 'forbidden', 'staff use cs4_me');

  // 評価表
  fail(await pin('am', { action: 'cs4_start', emp: 'E-1' }), 409, 'no_assign');
  const asg = it => email('gm', { action: 'cs4_assign', items: [it] });
  fail(await pin('am', { action: 'cs4_assign', items: [{ emp: 'E-1', system: 'G', grade: 'G1', type: 'Kitchen中心', expect: 0 }] }), 403, 'forbidden', 'AM cannot assign');
  fail(await asg({ emp: 'E-1', system: 'G', grade: 'G1', type: 'Bogus', expect: 0 }), 400, 'bad_value', 'a type the master does not have');
  assert.deepEqual(okj(await asg({ emp: 'E-1', system: 'G', grade: 'G1', type: 'Kitchen中心', expect: 0 }), 'assign').rows, [{ emp: 'E-1', period: Q4, ver: 1 }]);
  assert.equal(okj(await asg({ emp: 'E-1', system: 'G', grade: 'G1', type: 'Kitchen中心', expect: 1 }), 'same').same, 1);
  assert.deepEqual(fail(await asg({ emp: 'E-1', system: 'G', grade: 'G1', type: 'Server中心', expect: 0 }), 409, 'conflict').ids, ['E-1']);
  fail(await pin('am', { action: 'cs4_start', emp: 'E-1', assign: 99 }), 409, 'conflict', 'the form changed since the screen read it');
  fail(await pin('g1', { action: 'cs4_start', emp: 'E-1' }), 403, 'forbidden', 'no self scoring');
  fail(await pin('am', { action: 'cs4_start', emp: 'E-OUT' }), 403, 'forbidden', 'retired');
  fail(await pin('am', { action: 'cs4_start', emp: 'E-AM2' }), 403, 'forbidden', 'the other AM');

  // 始める（2 台で同時に押しても 1 つ・押し直しても初期化しない）
  const [s1, s1b] = await Promise.all([pin('am', { action: 'cs4_start', emp: 'E-1' }), pin('am', { action: 'cs4_start', emp: 'E-1' })]);
  const st = okj(s1, 'start'), stb = okj(s1b, 'start2');
  assert.equal(st.id, stb.id); assert.deepEqual([st.rev, st.status].sort(), [1, 'draft'].sort());
  assert.equal([st.resumed, stb.resumed].filter(Boolean).length, 1);
  const id1 = st.id;
  let ev = await evalRow(db, id1);
  assert.deepEqual([ev.entries, ev.result.state, ev.result.counts.unassessed, ev.system, ev.grade, ev.type, ev.version], [{}, 'not_started', 122, 'G', 'G1', 'Kitchen中心', 'CAREER_2026_Q4_V1']);
  assert.equal(okj(await pin('am', { action: 'cs4_start', emp: 'E-1' }), 'again').resumed, true);
  fail(await pin('g1', { action: 'cs4_save', id: id1, expect: 1, entries: { '01-01': { status: 'SCORED', score: 3 } } }), 403, 'forbidden', 'the person cannot change scores');
  let me = okj(await pin('g1', { action: 'cs4_me' }), 'me');
  assert.deepEqual([me.state, me.open.id, me.open.shared, me.published], ['in_progress', id1, null, null]);
  assert.equal(me.hist.length, 2, 'own old records (names only)');
  fail(await pin('g1', { action: 'cs4_req', id: id1, kind: 'comment', note: 'まだ' }), 409, 'state', 'nothing shared yet');

  // 下書き（サーバーが計算し直す）
  const save = (body, who = 'am') => pin(who, { action: 'cs4_save', ...body });
  let r = okj(await save({ id: id1, expect: 1, entries: all('G', 2), result: { total: { display: '99.9' } } }), 'save all 2');
  assert.equal(r.ver, 2); assert.equal(r.result.total.display, '66.7'); assert.equal(r.result.state, 'complete');
  assert.deepEqual(fail(await save({ id: id1, expect: 2, entries: { '99-99': { status: 'SCORED', score: 2 } } }), 400, 'bad_value').ids, ['99-99']);
  assert.deepEqual(fail(await save({ id: id1, expect: 2, entries: { '01-01': { status: 'SCORED', score: 4 } } }), 400, 'bad_value').ids, ['01-01']);
  fail(await save({ id: id1, expect: 2, entries: { '01-01': { status: 'SCORED', score: 3, byEmp: 'E-X', foo: 1 } } }), 400, 'bad_value', 'an unknown field');
  fail(await save({ id: id1, expect: 1, entries: { '01-01': { status: 'SCORED', score: 3 } } }), 409, 'conflict', 'an old version');
  assert.equal((await evalRow(db, id1)).entries['01-01'].score, 2, 'nothing written');
  r = okj(await save({ id: id1, expect: 2, entries: { '01-01': { status: 'UNASSIGNED', unassignedReason: '今期は担当していない' } } }), 'unassigned');
  assert.equal(r.result.total.display, '66.0'); assert.equal(r.ver, 3);
  ev = await evalRow(db, id1);
  assert.deepEqual([ev.entries['01-01'].status, ev.entries['01-01'].score, ev.entries['01-01'].byEmp, ev.entries['01-01'].prevStatus], ['UNASSIGNED', 0, 'E-AM', 'SCORED']);
  // 同時の保存：片方だけ書く
  const [w1, w2] = await Promise.all([save({ id: id1, expect: 3, entries: { '01-04': { status: 'SCORED', score: 3 } } }), save({ id: id1, expect: 3, entries: { '01-05': { status: 'SCORED', score: 3 } } })]);
  assert.deepEqual([w1.status, w2.status].sort(), [200, 409]);
  ev = await evalRow(db, id1);
  assert.equal(ev.ver, 4);
  assert.equal([ev.entries['01-04'].score, ev.entries['01-05'].score].filter(x => x === 3).length, 1, 'only the winner is saved');
  r = okj(await save({ id: id1, expect: 4, entries: { '01-04': { status: 'SCORED', score: 2 }, '01-05': { status: 'SCORED', score: 2 }, '01-02': { status: 'SCORED', score: 2, evidence: '10/12 の朝の記録' } },
    feedback: { good: '準備が早い', improve: '声かけ', next: '新人に教える' } }), 'feedback');
  assert.equal(r.ver, 5);
  assert.equal(okj(await save({ id: id1, expect: 5, entries: { '01-02': { status: 'SCORED', score: 2, evidence: '10/12 の朝の記録' } } }), 'same').same, true);

  // 本人に共有（根拠・書いた人・変えた理由は出さない）
  const act = (body, who = 'am') => pin(who, { action: 'cs4_act', ...body });
  fail(await act({ id: id1, expect: 5, act: 'confirm' }), 403, 'forbidden', 'AM cannot confirm');
  assert.equal(okj(await act({ id: id1, expect: 5, act: 'share' }), 'share').ver, 6);
  fail(await act({ id: id1, expect: 5, act: 'share' }), 409, 'conflict', 'an old version');
  me = okj(await pin('g1', { action: 'cs4_me' }), 'me shared');
  assert.equal(me.state, 'shared');
  assert.deepEqual(me.open.shared.feedback, { good: '準備が早い', improve: '声かけ', next: '新人に教える' });
  assert.deepEqual(me.open.shared.items['01-02'], { status: 'SCORED', score: 2 });
  assert.deepEqual(me.open.shared.items['01-01'], { status: 'UNASSIGNED', score: 0, unassignedReason: '今期は担当していない' });
  assert.ok(!JSON.stringify(me.open.shared).includes('E-AM') && !JSON.stringify(me.open.shared).includes('10/12'), 'no evidence, no writer');
  assert.equal(me.open.shared.result.total.display, '66.0');
  // 共有したあとに点を変えるには理由が要る
  assert.deepEqual(fail(await save({ id: id1, expect: 6, entries: { '01-03': { status: 'SCORED', score: 3 } } }), 400, 'reason_required').ids, ['01-03']);

  // 本人の見直しの申し出・コメント（本人の評価だけ・点は変えられない）
  const rq = okj(await pin('g1', { action: 'cs4_req', id: id1, kind: 'not_assigned', item: '01-02', note: '任されていません' }), 'req');
  assert.equal(okj(await pin('g1', { action: 'cs4_req', id: id1, kind: 'not_assigned', item: '01-02', note: 'もう一度' }), 'req again').same, true);
  okj(await pin('g1', { action: 'cs4_req', id: id1, kind: 'comment', note: '説明をお願いします' }), 'comment');
  fail(await pin('g1', { action: 'cs4_req', id: id1, kind: 'not_assigned', item: 'PH1', note: 'x' }), 400, 'bad_value', 'an item of another form');
  fail(await pin('g1b', { action: 'cs4_req', id: id1, kind: 'comment', note: 'x' }), 404, 'not_found', 'someone else');
  fail(await pin('g1', { action: 'cs4_act', id: id1, expect: 6, act: 'submit' }), 403, 'forbidden');
  fail(await pin('g1', { action: 'cs4_get', emp: 'E-1' }), 403, 'forbidden');
  fail(await act({ id: id1, expect: 6, act: 'submit' }), 409, 'open_requests', 'requests left');
  const G = okj(await pin('am', { action: 'cs4_get', emp: 'E-1' }), 'get');
  assert.equal(G.reqs.length, 2);
  assert.deepEqual(okj(await email('gm', { action: 'cs4_get', emp: 'E-1' }), 'gm get').evals, G.evals, 'GM and AM read the same rows');
  for (const x of G.reqs) okj(await pin('am', { action: 'cs4_answer', id: x.id, answer: '確認しました' }), 'answer');
  fail(await pin('am', { action: 'cs4_answer', id: rq.id, answer: 'もう一度' }), 409, 'state', 'answered already');

  // 変えた理由と前後の記録（17）
  r = okj(await save({ id: id1, expect: 6, entries: { '01-01': { status: 'NOT_APPLICABLE', naReasonType: COMPANY, naReason: '会社の都合で今期は任せていない', periodOnly: true, periodFrom: '2026-10-01', periodTo: '2026-12-31', changeReason: '本人の申し出' } } }), 'company na');
  assert.equal(r.result.total.display, '66.7'); assert.equal(r.ver, 7);
  const lg = (await db.query(`select detail from public.csq4_log where eval_id = $1 and action = 'save' order by id desc limit 1`, [id1])).rows[0].detail;
  assert.deepEqual(lg.changes['01-01'], { before: { status: 'UNASSIGNED', score: 0 },
    after: { status: 'NOT_APPLICABLE', score: null, naReasonType: COMPANY, periodOnly: true, periodFrom: '2026-10-01', periodTo: '2026-12-31' }, reason: '本人の申し出' });
  r = okj(await save({ id: id1, expect: 7, entries: { '01-02': { status: 'NOT_APPLICABLE', naReasonType: COMPANY, naReason: 'x', periodOnly: true, periodFrom: '2026-09-30', periodTo: '2026-12-31', changeReason: '申し出' } } }), 'out of quarter');
  assert.equal(r.result.state, 'in_progress'); assert.deepEqual(r.result.entryErrors, { '01-02': ['company_na_period_out_of_quarter'] });
  fail(await act({ id: id1, expect: 8, act: 'submit' }), 409, 'not_complete');
  okj(await save({ id: id1, expect: 8, entries: { '01-02': { status: 'SCORED', score: 2, changeReason: '担当していた' } } }), 'back');
  assert.equal(okj(await act({ id: id1, expect: 9, act: 'submit' }), 'submit').ver, 10);
  fail(await save({ id: id1, expect: 10, entries: { '01-03': { status: 'SCORED', score: 3, changeReason: 'x' } } }), 409, 'state', 'submitted: no edits');
  fail(await act({ id: id1, expect: 10, act: 'confirm' }), 403, 'forbidden');
  fail(await email('gm', { action: 'cs4_act', id: id1, expect: 10, act: 'return' }), 400, 'bad_value', 'a return needs a note');
  okj(await email('gm', { action: 'cs4_act', id: id1, expect: 10, act: 'return', note: '01-03 を見直して' }), 'return');
  okj(await act({ id: id1, expect: 11, act: 'submit' }), 'resubmit');
  okj(await email('gm', { action: 'cs4_act', id: id1, expect: 12, act: 'confirm' }), 'confirm');
  me = okj(await pin('g1', { action: 'cs4_me' }), 'me published');
  assert.deepEqual([me.state, me.published.id, me.published.shared.result.total.display, me.published.confirmed_by_name], ['published', id1, '66.7', 'Gina M']);
  assert.deepEqual(me.published.shared.feedback, { good: '準備が早い', improve: '声かけ', next: '新人に教える' });
  assert.deepEqual(me.reqs.map(x => x.status), ['answered', 'answered']);

  // 確定のあと：始めると published、再評価は新しい改訂（理由が要る・前の確定は残す）（18）
  assert.deepEqual(fail(await pin('am', { action: 'cs4_start', emp: 'E-1' }), 409, 'published').ids, [String(id1)]);
  fail(await pin('am', { action: 'cs4_reeval', emp: 'E-1', pub: id1 }), 400, 'bad_value', 'a re-evaluation needs a reason');
  const rv = okj(await pin('am', { action: 'cs4_reeval', emp: 'E-1', pub: id1, reason: '追加の事実' }), 'reeval');
  assert.deepEqual([rv.rev, rv.copied, rv.status], [2, true, 'draft']);
  const rev1 = await evalRow(db, id1);
  assert.equal(rev1.status, 'published');
  me = okj(await pin('g1', { action: 'cs4_me' }), 'me reeval');
  assert.deepEqual([me.state, me.published.id, me.open.id, me.open.shared], ['in_progress', id1, rv.id, null]);
  assert.deepEqual(fail(await save({ id: rv.id, expect: 1, entries: { '01-03': { status: 'SCORED', score: 3 } } }), 400, 'reason_required').ids, ['01-03']);
  r = okj(await save({ id: rv.id, expect: 1, entries: { '01-03': { status: 'SCORED', score: 3, changeReason: '追加の事実' } } }), 'rev2 save');
  const rev2 = await evalRow(db, rv.id);
  assert.equal(r.result.total.display, CSQ4.csq4Score(CSQ4_MASTER, { system: 'G', grade: 'G1', type: 'Kitchen中心', entries: rev2.entries }).total.display);
  const want = { ...all('G', 2), '01-01': { status: 'NOT_APPLICABLE', naReasonType: COMPANY, naReason: 'x', periodOnly: true, periodFrom: '2026-10-01', periodTo: '2026-12-31' }, '01-03': { status: 'SCORED', score: 3 } };
  const wantTotal = CSQ4.csq4Score(CSQ4_MASTER, { system: 'G', grade: 'G1', type: 'Kitchen中心', entries: want }).total.display;
  assert.equal(r.result.total.display, wantTotal, 'the entries we meant to send');
  assert.ok(Number(wantTotal) > 66.7);
  assert.deepEqual((await evalRow(db, id1)).entries, rev1.entries, 'rev 1 is not changed');
  okj(await act({ id: rv.id, expect: 2, act: 'submit' }), 'submit rev2');
  okj(await email('gm', { action: 'cs4_act', id: rv.id, expect: 3, act: 'confirm' }), 'confirm rev2');
  const old = await evalRow(db, id1);
  assert.deepEqual([old.status, old.superseded_by], ['superseded', rv.id]);
  assert.deepEqual(old.entries, rev1.entries);
  me = okj(await pin('g1', { action: 'cs4_me' }), 'me rev2');
  assert.deepEqual([me.state, me.published.id, me.published.rev, me.past.map(x => x.id)], ['published', rv.id, 2, [id1]]);

  // 開いている評価があるあいだは評価表を変えない・取りやめは確定する人（理由が要る・行は残す）
  const rv3 = okj(await pin('am', { action: 'cs4_reeval', emp: 'E-1', pub: rv.id, reason: 'もう一度' }), 'rev3');
  assert.deepEqual(fail(await asg({ emp: 'E-1', system: 'G', grade: 'G1', type: 'Server中心', expect: 1 }), 409, 'open').ids, ['E-1']);
  fail(await act({ id: rv3.id, expect: 1, act: 'cancel', note: 'x' }), 403, 'forbidden');
  fail(await email('gm', { action: 'cs4_act', id: rv3.id, expect: 1, act: 'cancel' }), 400, 'bad_value');
  okj(await email('gm', { action: 'cs4_act', id: rv3.id, expect: 1, act: 'cancel', note: '不要になった' }), 'cancel');
  me = okj(await pin('g1', { action: 'cs4_me' }), 'me after cancel');
  assert.deepEqual([me.state, me.published.id, me.open], ['published', rv.id, null]);
  assert.deepEqual((await db.query(`select rev, status from public.csq4_evals where emp_id = 'E-1' order by rev`)).rows, [
    { rev: 1, status: 'superseded' }, { rev: 2, status: 'published' }, { rev: 3, status: 'cancelled' }]);
  const acts = (await db.query(`select action from public.csq4_log where emp_id = 'E-1' order by id`)).rows.map(x => x.action);
  for (const a of ['assign', 'start', 'save', 'share', 'request', 'answer', 'submit', 'return', 'confirm', 'reeval', 'cancel']) assert.ok(acts.includes(a), 'logged ' + a);
  const R = okj(await email('gm', { action: 'cs4_roster' }), 'roster');
  assert.equal(R.counts.published, 1);
  assert.deepEqual(R.rows.find(x => x.emp === 'E-1').published, { ...R.rows.find(x => x.emp === 'E-1').published, rev: 2, status: 'published', total: wantTotal });
  // 段階 3-2：賞与の ① のために、総合点の分数・基準点・評価表も返す（分数は表示の数と同じ値）
  const pb = R.rows.find(x => x.emp === 'E-1').published;
  assert.deepEqual([pb.system, pb.grade, pb.type, pb.base], ['G', 'G1', 'Kitchen中心', 55]);
  assert.match(pb.exact, /^\d+\/\d+$/);
  const [en, ed] = pb.exact.split('/').map(Number);
  assert.equal((Math.round(en / ed * 10) / 10).toFixed(1), wantTotal);

  // 20：app_state と社員の表は書かない
  assert.equal(W.calls.post + W.calls.patch, 0);
  assert.equal(JSON.stringify(W.emps), empsBefore);
  assert.equal(JSON.stringify([...W.rows]), rowsBefore);
});

test('other forms: G6 by the CEO, PREP by the Head Chef, G3 by the store manager, S_OFFICE by the accountant', async () => {
  const { pin, email } = await setup();
  const asg = (who, items) => (who === 'gm' ? email('gm', { action: 'cs4_assign', items }) : pin(who, { action: 'cs4_assign', items }));
  fail(await asg('gm', [{ emp: 'E-GM', system: 'G', grade: 'G6', type: '全社責任', expect: 0 }]), 403, 'forbidden', 'GM does not assign self');
  okj(await asg('ceo', [{ emp: 'E-GM', system: 'G', grade: 'G6', type: '全社責任', expect: 0 }]), 'assign GM');
  okj(await asg('gm', [{ emp: 'E-P', system: 'PREP', expect: 0 }, { emp: 'E-3', system: 'G', grade: 'G3', type: 'Kitchen中心', expect: 0 },
    { emp: 'E-OC', system: 'S_OFFICE', grade: 'S1', expect: 0 }, { emp: 'E-1', system: 'G', grade: 'G1', type: 'Kitchen中心', expect: 0 }]), 'assign 4');
  fail(await asg('gm', [{ emp: 'E-P', system: 'PREP', grade: 'G1', expect: 1 }]), 400, 'bad_value', 'PREP has no grade');

  // G6：CEO が採点・確定（基準に届かなくても確定できる）
  fail(await pin('gm', { action: 'cs4_start', emp: 'E-GM' }), 403, 'forbidden');
  const g = okj(await pin('ceo', { action: 'cs4_start', emp: 'E-GM' }), 'start GM');
  let r = okj(await pin('ceo', { action: 'cs4_save', id: g.id, expect: 1, entries: all('G', 2) }), 'save GM');
  assert.deepEqual([r.result.total.display, r.result.base, r.result.baseMet, r.result.confirmable], ['66.7', 95, false, true]);
  okj(await pin('ceo', { action: 'cs4_act', id: g.id, expect: 2, act: 'submit' }), 'submit GM');
  fail(await email('gm', { action: 'cs4_act', id: g.id, expect: 3, act: 'confirm' }), 403, 'forbidden', 'GM does not confirm self');
  okj(await pin('ceo', { action: 'cs4_act', id: g.id, expect: 3, act: 'confirm' }), 'CEO confirms GM');

  // PREP：Head Chef（調理の人）
  assert.deepEqual(okj(await pin('ch', { action: 'cs4_roster' }), 'chef roster').rows.map(x => x.emp).sort(), ['E-1', 'E-3', 'E-P'], 'the kitchen form brings E-1 in');
  fail(await pin('ch', { action: 'cs4_start', emp: 'E-1B' }), 403, 'forbidden', 'not kitchen');
  fail(await pin('ch', { action: 'cs4_start', emp: 'E-4' }), 403, 'forbidden', 'same grade');
  const p = okj(await pin('ch', { action: 'cs4_start', emp: 'E-P' }), 'start prep');
  assert.deepEqual(fail(await pin('ch', { action: 'cs4_save', id: p.id, expect: 1, entries: { PH1: { status: 'NOT_APPLICABLE', naReasonType: COMPANY, naReason: 'x' } } }), 400, 'bad_value').ids, ['PH1']);
  assert.deepEqual(fail(await pin('ch', { action: 'cs4_save', id: p.id, expect: 1, entries: { PH1: { status: 'UNASSIGNED', unassignedReason: 'x' } } }), 400, 'bad_value').ids, ['PH1']);
  fail(await pin('ch', { action: 'cs4_save', id: p.id, expect: 1, prep: { quality: { Q9: 'clear' } } }), 400, 'bad_value');
  r = okj(await pin('ch', { action: 'cs4_save', id: p.id, expect: 1, entries: all('PREP', 3), prep: { quality: { Q1: 'clear', Q2: 'clear', Q3: 'clear' }, currentStep: 'P1' } }), 'save prep');
  assert.deepEqual([r.result.state, r.result.confirmable, r.result.score.display, r.result.pay.state], ['complete', true, '100.0', 'unmeasured']);
  okj(await pin('ch', { action: 'cs4_act', id: p.id, expect: 2, act: 'submit' }), 'submit prep');
  fail(await pin('ch', { action: 'cs4_act', id: p.id, expect: 3, act: 'confirm' }), 403, 'forbidden');
  okj(await email('gm', { action: 'cs4_act', id: p.id, expect: 3, act: 'confirm' }), 'confirm prep');
  const mp = okj(await pin('p', { action: 'cs4_me' }), 'prep me');
  assert.deepEqual([mp.state, mp.published.shared.result.score.display, mp.published.shared.result.pay.state], ['published', '100.0', 'unmeasured']);

  // G3：店長（G4）が自分の店の下のグレードを採点
  const k = okj(await pin('g4', { action: 'cs4_start', emp: 'E-3' }), 'start G3');
  fail(await pin('g4', { action: 'cs4_save', id: k.id, expect: 1, prep: {} }), 400, 'bad_value', 'not a PREP form');
  r = okj(await pin('g4', { action: 'cs4_save', id: k.id, expect: 1, entries: all('G', 2) }), 'save G3');
  assert.deepEqual([r.result.total.display, r.result.base, r.result.baseMet], ['66.7', 75, false]);
  fail(await pin('g3', { action: 'cs4_start', emp: 'E-1' }), 403, 'forbidden', 'the G3 does not score a G1');

  // S_OFFICE：経理（メール）が事務Crew を採点・確定は GM
  const o = okj(await email('of', { action: 'cs4_start', emp: 'E-OC' }), 'start office');
  assert.deepEqual(fail(await email('of', { action: 'cs4_save', id: o.id, expect: 1, entries: { [ids('S_OFFICE')[0]]: { status: 'UNASSIGNED', unassignedReason: 'x' } } }), 400, 'bad_value').ids, [ids('S_OFFICE')[0]]);
  r = okj(await email('of', { action: 'cs4_save', id: o.id, expect: 1, entries: all('S_OFFICE', 2) }), 'save office');
  assert.deepEqual([r.result.total.display, r.result.base, r.result.baseMet], ['66.7', 65, true]);
  okj(await email('of', { action: 'cs4_act', id: o.id, expect: 2, act: 'submit' }), 'submit office');
  fail(await email('of', { action: 'cs4_act', id: o.id, expect: 3, act: 'confirm' }), 403, 'forbidden');
  fail(await email('of', { action: 'cs4_start', emp: 'E-1' }), 403, 'forbidden', 'office scores office crew only');
});

test('#214 review: unknown grades, retired people\'s open evaluations and change reasons', async () => {
  const { db, W, pin, email } = await setup({ extra: [E('E-U', 'Uma Unknown', 'S1', '', '')] });
  const ros = async (r, what) => okj(await r, what).rows;
  // 肩書きも役割も決まりに無い人：G4 は採点しない（「自分より下」と決められない）・AM・GM は採点する
  assert.ok(!(await ros(pin('g4', { action: 'cs4_roster' }), 'g4')).some(x => x.emp === 'E-U'));
  assert.ok((await ros(pin('am', { action: 'cs4_roster' }), 'am')).some(x => x.emp === 'E-U'));
  okj(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-U', system: 'G', grade: 'G1', type: 'Server中心', expect: 0 }] }), 'assign U');
  fail(await pin('g4', { action: 'cs4_start', emp: 'E-U' }), 403, 'forbidden', 'G4 and an unknown grade');

  // 退職した人の開いた評価：CEO・GM は一覧に出て取り消せる（採点・確定はしない）・AM・G4 は触れない・本人は申し出ない
  okj(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-1B', system: 'G', grade: 'G1', type: 'Server中心', expect: 0 }] }), 'assign 1B');
  const st = okj(await pin('am', { action: 'cs4_start', emp: 'E-1B' }), 'start 1B');
  let r = okj(await pin('am', { action: 'cs4_save', id: st.id, expect: 1, entries: { '01-01': { status: 'SCORED', score: 2 } } }), 'save');
  r = okj(await pin('am', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'share' }), 'share');
  // 共有のあと：変えた理由は記録にだけ残す（明細には残さない）
  r = okj(await pin('am', { action: 'cs4_save', id: st.id, expect: r.ver, entries: { '01-01': { status: 'SCORED', score: 3, changeReason: '10/20 の朝の様子' } } }), 'reason');
  let ev = await evalRow(db, st.id);
  assert.equal(ev.entries['01-01'].changeReason, undefined, 'the reason is not kept in the entry');
  const lg = (await db.query(`select detail from public.csq4_log where eval_id = $1 and action = 'save' order by id desc limit 1`, [st.id])).rows[0].detail;
  assert.equal(lg.changes['01-01'].reason, '10/20 の朝の様子');
  fail(await pin('am', { action: 'cs4_save', id: st.id, expect: r.ver, entries: { '01-01': { status: 'SCORED', score: 1 } } }), 400, 'reason_required', 'a new change needs a new reason');
  // 前の版が明細に残した理由は使えない
  await db.query(`update public.csq4_evals set entries = jsonb_set(entries, '{01-01,changeReason}', '"前の理由"') where id = $1`, [st.id]);
  assert.deepEqual(fail(await pin('am', { action: 'cs4_save', id: st.id, expect: r.ver, entries: { '01-01': { status: 'SCORED', score: 1, changeReason: '前の理由' } } }), 400, 'reason_required', 'the old reason').ids, ['01-01']);
  r = okj(await pin('am', { action: 'cs4_save', id: st.id, expect: r.ver, entries: { '01-01': { status: 'UNASSESSED', changeReason: '見直すため未評価に戻す' } } }), 'back to unassessed with a reason');
  // #214 のルーティン（7096582005）の P3-2：理由だけの未評価の明細は残さない（理由は記録にだけ）
  ev = await evalRow(db, st.id);
  assert.equal(ev.entries['01-01'], undefined, 'no entry with only a reason');
  const lg2 = (await db.query(`select detail from public.csq4_log where eval_id = $1 and action = 'save' order by id desc limit 1`, [st.id])).rows[0].detail;
  assert.equal(lg2.changes['01-01'].reason, '見直すため未評価に戻す');
  assert.equal(lg2.changes['01-01'].after, null);
  okj(await pin('g1b', { action: 'cs4_req', id: st.id, kind: 'comment', note: '確認したい' }), 'comment before');
  W.emps.find(e => e.id === 'E-1B').status = '退職';
  fail(await pin('g1b', { action: 'cs4_req', id: st.id, kind: 'comment', note: 'もう一度' }), 403, 'forbidden', 'retired people do not send');
  assert.ok(!(await ros(pin('am', { action: 'cs4_roster' }), 'am')).some(x => x.emp === 'E-1B'), 'the AM does not see');
  fail(await pin('am', { action: 'cs4_save', id: st.id, expect: r.ver, entries: { '01-02': { status: 'SCORED', score: 2 } } }), 403, 'forbidden', 'no scoring');
  for (const who of [['gm', email], ['ceo', pin]]) {
    const row1 = (await ros(who[1](who[0], { action: 'cs4_roster' }), who[0])).find(x => x.emp === 'E-1B');
    assert.ok(row1, who[0] + ' sees the retired person with an open evaluation');
    assert.deepEqual([row1.out, row1.can.score, row1.can.confirm, row1.can.assign, row1.can.cancel], [true, false, false, false, true]);
  }
  assert.equal(okj(await email('gm', { action: 'cs4_get', emp: 'E-1B' }), 'get').person.out, true);
  fail(await email('gm', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'confirm' }), 403, 'forbidden', 'no confirming');
  fail(await email('gm', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'cancel' }), 400, 'bad_value', 'a note is needed');
  okj(await email('gm', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'cancel', note: '退職のため' }), 'cancel');
  assert.equal((await evalRow(db, st.id)).status, 'cancelled');
  assert.ok(!(await ros(email('gm', { action: 'cs4_roster' }), 'gm')).some(x => x.emp === 'E-1B'), 'gone after cancelling');
  assert.deepEqual(okj(await email('gm', { action: 'cs4_get', emp: 'E-OUT' }), 'a retired person: CEO・GM read').evals, []);
  fail(await pin('am', { action: 'cs4_get', emp: 'E-OUT' }), 403, 'forbidden', 'the AM does not read retired people');
});

test('Moto 11/23: a confirmed G3 scores G2 people of the own store (CEO・GM confirm); a GM has every right the CEO has (other GM・CEO people too, not self)', async () => {
  const G2 = (id, name, store, support) => ({ id, name, store, role: 'g2', title: 'Crew Leader', status: '', ...(support ? { support } : {}), data: { name, store } });
  const { db, W, pin, email } = await setup({ extra: [
    G2('E-2L', 'Lia Lead', 'S1'), G2('E-2X', 'Xan Lead', 'S2'), G2('E-2S', 'Sam Lead', 'S2', ['S1']),
    E('E-OCL', 'Olga Lead', 'S1', 'office_crew', 'Office Crew Leader'), E('E-GM2', 'Gus Two', 'OFFICE', 'gm', 'General Manager')] });
  W.mgr[U(6)] = { emp_id: 'E-GM2', role: 'gm' };
  W.pins.tgm2 = { ...PIN('E-GM2', 'gm', 6), name: 'Gus Two' };
  W.pins.tg3u = PIN('E-3', 'staff', 3, ['S1'], { confirmed: false });
  const ros = async (r, what) => okj(await r, what);

  // 確かめた G3：自分の店（応援を含む）の G2 だけ（ほかの店・本部の人・G1・G4 は出ない）
  const g3 = await ros(pin('g3', { action: 'cs4_roster' }), 'g3 roster');
  assert.deepEqual(g3.rows.map(x => x.emp).sort(), ['E-2L', 'E-2S']);
  assert.ok(g3.rows.every(x => x.can.score && !x.can.confirm && !x.can.assign && !x.can.cancel));
  assert.deepEqual((await ros(pin('g3u', { action: 'cs4_roster' }), 'unconfirmed g3')).rows, [], 'a G3 not confirmed by GM・CEO does not score');
  for (const e of ['E-2X', 'E-OCL', 'E-1', 'E-4']) fail(await pin('g3', { action: 'cs4_start', emp: e }), 403, 'forbidden', 'G3 and ' + e);
  // 採点 → 共有 → 確認依頼（G3）→ 確定・差戻しは CEO・GM だけ
  okj(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-2L', system: 'G', grade: 'G2', type: 'Server中心', expect: 0 }] }), 'assign 2L');
  fail(await pin('g3', { action: 'cs4_assign', items: [{ emp: 'E-2L', system: 'G', grade: 'G2', type: 'Kitchen中心', expect: 1 }] }), 403, 'forbidden', 'the G3 does not assign');
  const st = okj(await pin('g3', { action: 'cs4_start', emp: 'E-2L' }), 'start 2L');
  let r = okj(await pin('g3', { action: 'cs4_save', id: st.id, expect: 1, entries: all('G', 2) }), 'save 2L');
  assert.equal(r.result.confirmable, true);
  r = okj(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'share' }), 'share 2L');
  r = okj(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'submit' }), 'submit 2L');
  fail(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'confirm' }), 403, 'forbidden', 'the G3 does not confirm');
  fail(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'return', note: 'x' }), 403, 'forbidden', 'the G3 does not return');
  fail(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'cancel', note: 'x' }), 403, 'forbidden', 'the G3 does not cancel');
  r = okj(await email('gm', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'return', note: '01 をもう一度' }), 'GM returns');
  r = okj(await pin('g3', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'submit' }), 'submit again');
  okj(await email('gm', { action: 'cs4_act', id: st.id, expect: r.ver, act: 'confirm' }), 'GM confirms');
  const ev = await evalRow(db, st.id);
  assert.deepEqual([ev.status, ev.submitted_by_name, ev.confirmed_by_role], ['published', 'Kit Three', 'gm']);
  okj(await pin('g3', { action: 'cs4_reeval', emp: 'E-2L', pub: st.id, reason: '見直し' }), 'the G3 starts a re-evaluation (CEO・GM confirm again)');

  // GM は CEO と同じにすべて（閲覧・採点・変更・確定・取り消し・評価表・申し出への答え）。ほかの GM・CEO の人も。自分だけは除く
  //（Moto さん 11/23「GMは全ての閲覧、評価、変更、承認の権限を持たせてください」）
  okj(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-GM2', system: 'G', grade: 'G6', type: '全社責任', expect: 0 }] }), 'the GM assigns GM2');
  const gmRos = async () => (await ros(email('gm', { action: 'cs4_roster' }), 'gm roster'));
  let R = await gmRos();
  const row = R.rows.find(x => x.emp === 'E-GM2');
  assert.deepEqual([row.view, row.can.score, row.can.confirm, row.can.assign, row.can.cancel, row.assign.system, row.suggest.system], [undefined, true, true, true, true, 'G', 'G']);
  const ceoRow = R.rows.find(x => x.emp === 'E-CEO');
  assert.deepEqual([ceoRow.can.score, ceoRow.can.confirm, ceoRow.can.assign, ceoRow.can.cancel], [true, true, true, true], 'the CEO person too');
  assert.ok(!R.rows.some(x => x.emp === 'E-GM'), 'not self');
  const before = R.counts.not_started;
  const g = okj(await email('gm', { action: 'cs4_start', emp: 'E-GM2' }), 'the GM starts GM2');
  r = okj(await email('gm', { action: 'cs4_save', id: g.id, expect: 1, entries: all('G', 2) }), 'the GM saves GM2');
  r = okj(await email('gm', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'share' }), 'the GM shares');
  r = okj(await email('gm', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'submit' }), 'the GM submits');
  R = await gmRos();
  assert.deepEqual([R.rows.find(x => x.emp === 'E-GM2').open.status, R.counts.not_started, R.counts.submitted], ['submitted', before - 1, 1], 'counted like anyone');
  let G = okj(await email('gm', { action: 'cs4_get', emp: 'E-GM2' }), 'gm get');
  assert.deepEqual([G.view, G.evals.map(x => x.status), G.assign.system], [undefined, ['submitted'], 'G']);
  assert.ok(G.log.length > 0, 'the GM reads the log');
  r = okj(await email('gm', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'return', note: 'もう一度' }), 'the GM returns');
  r = okj(await email('gm', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'submit' }), 'the GM submits again');
  okj(await email('gm', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'confirm' }), 'the GM confirms GM2');
  assert.deepEqual([(await evalRow(db, g.id)).status, (await evalRow(db, g.id)).confirmed_by_role], ['published', 'gm']);
  // 申し出（本人）に GM が答える・中身も読める
  okj(await pin('gm2', { action: 'cs4_req', id: g.id, kind: 'comment', note: '確認したい' }), 'GM2 comments');
  const rq = (await db.query(`select id from public.csq4_reqs where emp_id = 'E-GM2'`)).rows[0];
  okj(await email('gm', { action: 'cs4_answer', id: Number(rq.id), answer: '見ました' }), 'the GM answers');
  G = okj(await email('gm', { action: 'cs4_get', emp: 'E-GM2' }), 'gm get after');
  assert.deepEqual(G.reqs.map(x => [x.status, x.answer]), [['answered', '見ました']]);
  // 変える（再評価）・取りやめ
  r = okj(await email('gm', { action: 'cs4_reeval', emp: 'E-GM2', pub: g.id, reason: '見直し' }), 'the GM re-evaluates');
  r = okj(await email('gm', { action: 'cs4_save', id: r.id, expect: r.ver, entries: { '01-01': { status: 'SCORED', score: 3, changeReason: '見直し' } } }), 'the GM changes a score');
  r = okj(await email('gm', { action: 'cs4_act', id: r.id, expect: r.ver, act: 'submit' }), 'the GM submits rev 2');
  okj(await email('gm', { action: 'cs4_act', id: r.id, expect: r.ver, act: 'confirm' }), 'the GM confirms rev 2');
  G = okj(await email('gm', { action: 'cs4_get', emp: 'E-GM2' }), 'gm get rev 2');
  assert.deepEqual(G.evals.map(x => x.status), ['published', 'superseded']);
  const pub2 = r.id;
  r = okj(await email('gm', { action: 'cs4_reeval', emp: 'E-GM2', pub: pub2, reason: 'もう一度' }), 'the GM re-evaluates again');
  okj(await email('gm', { action: 'cs4_act', id: r.id, expect: r.ver, act: 'cancel', note: '不要になった' }), 'the GM cancels');
  // CEO の人も GM が採点・確定できる
  okj(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-CEO', system: 'G', grade: 'G6', type: '全社責任', expect: 0 }] }), 'the GM assigns the CEO person');
  const c = okj(await email('gm', { action: 'cs4_start', emp: 'E-CEO' }), 'the GM starts the CEO person');
  r = okj(await email('gm', { action: 'cs4_save', id: c.id, expect: 1, entries: all('G', 2) }), 'save the CEO person');
  r = okj(await email('gm', { action: 'cs4_act', id: c.id, expect: r.ver, act: 'submit' }), 'submit the CEO person');
  okj(await email('gm', { action: 'cs4_act', id: c.id, expect: r.ver, act: 'confirm' }), 'the GM confirms the CEO person');
  assert.equal((await evalRow(db, c.id)).status, 'published');
  // 今までの記録：全部の種類（CEO と同じ）
  for (const [n, kind] of [['1', 'lss_emp'], ['2', 'lss_requests'], ['3', 'bonus_csfreeze'], ['4', 'ocs_ev']])
    await db.query(`insert into public.csq4_hist (src_key, src_hash, kind, emp_id, emp_name, period_state, data) values ($1, $2, $3, 'E-GM2', 'Gus Two', 'unknown', '{}'::jsonb)`, ['k-' + kind, n.repeat(64), kind]);
  const allKinds = ['bonus_csfreeze', 'lss_emp', 'lss_requests', 'ocs_ev'];
  assert.deepEqual(okj(await email('gm', { action: 'cs4_hist', emp: 'E-GM2' }), 'gm hist').rows.map(x => x.kind).sort(), allKinds);
  assert.deepEqual(okj(await pin('ceo', { action: 'cs4_hist', emp: 'E-GM2' }), 'ceo hist').rows.map(x => x.kind).sort(), allKinds);
  // ほかの GM（GM2）から見た GM：採点・確定できる。自分は出ない・自分は採点しない
  const R2 = await ros(pin('gm2', { action: 'cs4_roster' }), 'gm2 roster');
  assert.ok(R2.rows.some(x => x.emp === 'E-GM' && x.can.score && x.can.confirm && x.can.assign && x.can.cancel));
  assert.ok(!R2.rows.some(x => x.emp === 'E-GM2'), 'not self');
  fail(await pin('gm2', { action: 'cs4_start', emp: 'E-GM2' }), 403, 'forbidden', 'GM2 does not start self');
  fail(await pin('gm2', { action: 'cs4_get', emp: 'E-GM2' }), 403, 'forbidden', 'GM2 reads self through cs4_me only');
  fail(await pin('gm2', { action: 'cs4_assign', items: [{ emp: 'E-GM2', system: 'G', grade: 'G6', type: '全社責任', expect: 1 }] }), 403, 'forbidden', 'GM2 does not assign self');
  // GM2 が退職：開いたままの評価を GM が取り消せる（読むのと取り消しだけ）
  const op = okj(await email('gm', { action: 'cs4_reeval', emp: 'E-GM2', pub: pub2, reason: '退職の前' }), 'an open re-evaluation');
  W.emps.find(e => e.id === 'E-GM2').status = '退職';
  const outRow = (await gmRos()).rows.find(x => x.emp === 'E-GM2');
  assert.deepEqual([outRow.out, outRow.can.score, outRow.can.confirm, outRow.can.cancel], [true, false, false, true], 'a retired GM');
  okj(await email('gm', { action: 'cs4_act', id: op.id, expect: op.ver, act: 'cancel', note: '退職のため' }), 'the GM cancels the retired GM2');
  // AM・G4・G3 は見ない
  for (const who of ['am', 'g4', 'g3']) fail(await pin(who, { action: 'cs4_get', emp: 'E-GM2' }), 403, 'forbidden', who + ' does not read GM2');
});

test('before the SQL: reads say nosql and writes say not_installed', async () => {
  const { pin, email } = await setup({ sql: false });
  assert.equal(okj(await pin('g1', { action: 'cs4_me' }), 'me').nosql, true);
  const R = okj(await email('gm', { action: 'cs4_roster' }), 'roster');
  assert.deepEqual([R.rows, R.nosql], [[], true]);
  assert.equal(okj(await email('gm', { action: 'cs4_hist', legacy: true }), 'legacy').nosql, true);
  assert.equal(okj(await email('gm', { action: 'cs4_get', emp: 'E-1' }), 'get').nosql, true);
  fail(await email('gm', { action: 'cs4_assign', items: [{ emp: 'E-1', system: 'PREP', expect: 0 }] }), 503, 'not_installed');
  fail(await pin('am', { action: 'cs4_start', emp: 'E-1' }), 503, 'not_installed');
  fail(await email('gm', { action: 'cs4_copy' }), 503, 'not_installed');
  fail(await pin('am', { action: 'cs4_save', id: 1, expect: 1, entries: {} }), 503, 'not_installed');
});

// Codex（#214 7108123737）・Moto さん 11/23 07:3x HST「G の評価表だけ」：G3 が採点できるのは自分の店の G2 の人の G の評価表だけ。
// S（S_CHEF・S_OFFICE）・PREP の評価表は、一覧に出さず、始める・保存・本人に共有・確認待ち・再評価・読むのどれでも断る（S は AM と G4 以上）
test('Moto 11/23 (Codex #214): a G3 scores only the G form of G2 people; S and PREP forms are refused at every step', async () => {
  const G2 = (id, name, store, support) => ({ id, name, store, role: 'g2', title: 'Crew Leader', status: '', ...(support ? { support } : {}), data: { name, store } });
  const { db, pin, email } = await setup({ extra: [G2('E-2L', 'Lia Lead', 'S1'), G2('E-2K', 'Kat Cook', 'S1'), G2('E-2P', 'Pia Prep', 'S1')] });
  const ros = async (who) => okj(await pin(who, { action: 'cs4_roster' }), who + ' roster').rows.map(x => x.emp).sort();
  assert.deepEqual(await ros('g3'), ['E-2K', 'E-2L', 'E-2P'], 'before the forms are decided: G2 people of the own store (as before)');
  okj(await email('gm', { action: 'cs4_assign', items: [
    { emp: 'E-2L', system: 'G', grade: 'G2', type: 'Kitchen中心', expect: 0 },
    { emp: 'E-2K', system: 'S_CHEF', grade: 'S2', expect: 0 },
    { emp: 'E-2P', system: 'PREP', expect: 0 }] }), 'assign');
  assert.deepEqual(await ros('g3'), ['E-2L'], 'the G3 list keeps only the G form');
  for (const e of ['E-2K', 'E-2P']) {
    fail(await pin('g3', { action: 'cs4_start', emp: e }), 403, 'forbidden', 'G3 start ' + e);
    fail(await pin('g3', { action: 'cs4_get', emp: e }), 403, 'forbidden', 'G3 get ' + e);
  }
  // S の評価は店長（G4）が始めて付ける。G3 は保存・共有・確認待ち・再評価のどれもできない（前は全部できた）
  const k = okj(await pin('g4', { action: 'cs4_start', emp: 'E-2K' }), 'G4 starts S_CHEF');
  let r = okj(await pin('g4', { action: 'cs4_save', id: k.id, expect: 1, entries: all('S_CHEF', 2) }), 'G4 saves S_CHEF');
  fail(await pin('g3', { action: 'cs4_save', id: k.id, expect: r.ver, entries: { [ids('S_CHEF')[0]]: { status: 'SCORED', score: 3 } } }), 403, 'forbidden', 'G3 save S');
  fail(await pin('g3', { action: 'cs4_act', id: k.id, expect: r.ver, act: 'share' }), 403, 'forbidden', 'G3 share S');
  fail(await pin('g3', { action: 'cs4_act', id: k.id, expect: r.ver, act: 'submit' }), 403, 'forbidden', 'G3 submit S');
  assert.equal((await evalRow(db, k.id)).ver, r.ver, 'nothing written by the G3');
  r = okj(await pin('g4', { action: 'cs4_act', id: k.id, expect: r.ver, act: 'submit' }), 'G4 submits');
  okj(await email('gm', { action: 'cs4_act', id: k.id, expect: r.ver, act: 'confirm' }), 'GM confirms S_CHEF');
  fail(await pin('g3', { action: 'cs4_reeval', emp: 'E-2K', pub: k.id, reason: '見直し' }), 403, 'forbidden', 'G3 re-evaluates S');
  // G の評価表の G2 の人は今までどおり（始める・保存・共有・確認待ち）
  const g = okj(await pin('g3', { action: 'cs4_start', emp: 'E-2L' }), 'G3 starts G');
  r = okj(await pin('g3', { action: 'cs4_save', id: g.id, expect: 1, entries: all('G', 2) }), 'G3 saves G');
  r = okj(await pin('g3', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'share' }), 'G3 shares G');
  okj(await pin('g3', { action: 'cs4_act', id: g.id, expect: r.ver, act: 'submit' }), 'G3 submits G');
  // AM・店長（G4）・GM は S も今までどおり
  assert.ok((await ros('am')).includes('E-2K'));
  assert.ok((await ros('g4')).includes('E-2K'));
});
