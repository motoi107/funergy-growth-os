// v1190 入れる一式（deploy/approval-rules-v1190）：② と戻すの SQL はリポジトリのものと同じ・① と ③ を PGlite で流す（合成データ・本番にはつながない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, PGlite, M, MIGS, AR, ROLLBACK, PEOPLE } from './approval-rules-world.mjs';
import { execSync } from 'node:child_process';

const D = f => fs.readFileSync(new URL('../deploy/approval-rules-v1190/' + f, import.meta.url), 'utf8');
const rows = async (pg, sql) => { await pg.exec('reset role'); try { const r = await pg.exec(sql); return r[r.length - 1].rows; } finally { await pg.exec('set role service_role'); } };
const res = (list, start) => list.find(r => r.check_name.startsWith(start))?.result;
const NAMES = new RegExp(PEOPLE.map(p => p[1]).join('|'));

test('② は migration、戻すは db/approval-rules-rollback.sql と同じ（1 文字も違わない）', () => {
  assert.equal(D('2_SQL_承認ルール.sql'), M('20261209090000_approval_rules'));
  assert.equal(D('戻す_SQL.sql'), ROLLBACK);
  assert.equal(AR, M('20261209090000_approval_rules'));
});

test('① の確認：入れる前と後・名前は出さない・前の SQL が無ければ STOP（② も止まって何も変えない）', async () => {
  const s = await setup({ ar: false });
  const before = await rows(s.pg, D('1_最初に確認_読むだけ.sql'));
  assert.ok(!before.some(r => /STOP/.test(r.result)), JSON.stringify(before));
  assert.equal(res(before, '2.'), '0（初めて）'); assert.equal(res(before, '3.'), '7');
  assert.ok(!NAMES.test(JSON.stringify(before)), '名前は出さない');
  assert.match(res(before, '（参考）CEO・GM'), /^2 \/ 2$/);
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_承認ルール.sql')); await s.pg.exec('set role service_role');
  const after = await rows(s.pg, D('1_最初に確認_読むだけ.sql'));
  assert.equal(res(after, '2.'), '1'); assert.equal(res(after, '3.'), '8');
  // 前の SQL（v1184）が無いとき
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());`);
  for (const f of MIGS.filter(f => f < '20261204')) await pg.exec(M(f));
  const r0 = (await pg.exec(D('1_最初に確認_読むだけ.sql'))).pop().rows;
  assert.match(res(r0, '1.'), /^STOP/);
  await assert.rejects(pg.exec(D('2_SQL_承認ルール.sql')), /STOP/);
  assert.equal((await pg.exec(`select to_regclass('public.ar_rules') is null as none`)).pop().rows[0].none, true, '止まったら何も変えない');
});

/* 本番（11/17 20:04 HST）：v1184 の SQL が前の版（d21250e・Codex #182 の P1 の直しの前＝wr_exp_grants に crew の列が無い）のままだった。
   ① はエラー（column "crew" does not exist）で止まっていた → ① は 1b で STOP と案内・② も STOP で何も変えない・今の v1184 を流し直すと進める。
   d21250e が無いとき（浅い clone）は理由を出して落ちる（CI は取ってくる） */
const OLD_V1184 = 'd21250ee4868c51a89c8e2c1f443e6ab437f75a4';
test('v1184 が前の版（crew の列なし）のとき：① はエラーにならず 1b が STOP・② は STOP で何も変えない・今の v1184 を流し直すと ① が OK・② が通る', async () => {
  let oldSql;
  try { oldSql = execSync('git show ' + OLD_V1184 + ':supabase/migrations/20261204090000_wr_exp_grants.sql', { cwd: new URL('..', import.meta.url), maxBuffer: 16 << 20 }).toString('utf8'); }
  catch (e) { throw new Error('needs the old v1184 commit (git fetch origin ' + OLD_V1184 + '): ' + e.message); }
  assert.ok(!/crew boolean/.test(oldSql), 'the base commit is the v1184 SQL before the crew fix');
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name, status: '在籍' })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(f === '20261204090000_wr_exp_grants' ? oldSql : M(f));
  await pg.exec(`insert into public.wr_exp_grants(emp_id, mileage) values ('E12', false)`);
  const r0 = (await pg.exec(D('1_最初に確認_読むだけ.sql'))).pop().rows;
  assert.equal(res(r0, '1.'), 'OK');
  assert.match(res(r0, '1b.'), /^STOP（v1184 が前の版のまま/);
  assert.equal(res(r0, '（参考）事務Crew').split(' / ')[1], '—（v1184 が前の版）');
  assert.ok(!NAMES.test(JSON.stringify(r0)), '名前は出さない');
  await assert.rejects(pg.exec(D('2_SQL_承認ルール.sql')), /STOP: 経費の申請の権限の SQL/);
  assert.equal((await pg.exec(`select to_regclass('public.ar_rules') is null as none`)).pop().rows[0].none, true, '止まったら何も変えない');
  // 今の v1184 をもう一度（前に決めた設定は残る）
  await pg.exec(M('20261204090000_wr_exp_grants'));
  assert.equal((await pg.exec(`select mileage from public.wr_exp_grants where emp_id = 'E12'`)).pop().rows[0].mileage, false);
  const r1 = (await pg.exec(D('1_最初に確認_読むだけ.sql'))).pop().rows;
  assert.ok(!r1.some(r => /STOP/.test(r.result)), JSON.stringify(r1));
  assert.equal(res(r1, '1b.'), 'OK');
  await pg.exec(D('2_SQL_承認ルール.sql'));
  assert.equal(res((await pg.exec(D('1_最初に確認_読むだけ.sql'))).pop().rows, '3.'), '8');
});

test('③ の確認：入れたあと NG なし・2 回流しても同じ・前の申請の SQL の流し直し・公開の鍵の付け直しで NG・戻すと NG', async () => {
  const s = await setup();
  const ok = await rows(s.pg, D('3_確認_読むだけ.sql'));
  assert.ok(!ok.some(r => /NG/.test(r.result)), JSON.stringify(ok));
  assert.equal(res(ok, '（参考）共通ルールで動いているか'), 'false');
  assert.equal(res(ok, '（参考）ルール：有効'), '0 / 16');
  assert.equal(res(ok, '（参考）承認上の役割の人数'), 'ceo 1・gm 1・am 2・chef 1・acct_mgr 1・office_crew 1');
  assert.ok(!NAMES.test(JSON.stringify(ok)), '名前は出さない');
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_承認ルール.sql')); await s.pg.exec('set role service_role');
  assert.ok(!(await rows(s.pg, D('3_確認_読むだけ.sql'))).some(r => /NG/.test(r.result)));
  // 申請の前の SQL（v1184）を流し直すと、包んだ関数が前に戻る → 3 が NG
  await s.pg.exec('reset role'); await s.pg.exec(M('20261204090000_wr_exp_grants')); await s.pg.exec('set role service_role');
  assert.match(res(await rows(s.pg, D('3_確認_読むだけ.sql')), '3.'), /^NG/);
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_承認ルール.sql')); await s.pg.exec('set role service_role');
  assert.equal(res(await rows(s.pg, D('3_確認_読むだけ.sql')), '3.'), 'OK');
  // 公開の鍵に付け直すと 6・7 が NG
  await s.pg.exec('reset role'); await s.pg.exec(`grant execute on function public.ar_state(jsonb) to anon; grant select on public.ar_rules to authenticated;`); await s.pg.exec('set role service_role');
  const g = await rows(s.pg, D('3_確認_読むだけ.sql'));
  assert.match(res(g, '6.'), /^NG/); assert.match(res(g, '7.'), /^NG/);
  // 戻すと 1・3・4 が NG（表と記録は残る）
  await s.pg.exec('reset role'); await s.pg.exec(D('戻す_SQL.sql')); await s.pg.exec('set role service_role');
  const b = await rows(s.pg, D('3_確認_読むだけ.sql'));
  assert.match(res(b, '1.'), /^NG/); assert.match(res(b, '3.'), /^NG/); assert.match(res(b, '4.'), /^NG/); assert.equal(res(b, '5.'), 'OK');
});

test('③ の参考：使い始めたあと、ルートの付いた承認待ちと止まっている数', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.subOk('E8', 'hire', 'S1');
  await s.retire('E5');
  await s.setRule('leave', { branches: [{ when: { stores: ['S3'] }, stages: [{ mode: 'any', slots: [{ t: 'role', role: 'am', scope: 'mine' }] }] }], default: { stages: [{ mode: 'any', slots: [{ t: 'role', role: 'gm', scope: 'all' }] }] } });
  await s.subOk('E13', 'leave', 'S3');
  await s.retire('E10');
  const r = await rows(s.pg, D('3_確認_読むだけ.sql'));
  assert.equal(res(r, '（参考）共通ルールで動いているか'), 'true');
  assert.equal(res(r, '（参考）ルートが付いている承認待ち'), '2 / 1');
});

/* 今 Supabase に入っている関数（main d14d444 の handler.mjs）のままで ② を入れても今までどおり動く（④ を待つあいだ）。
   そのコミットが無いとき（浅い clone）は理由を出して落ちる（CI は取ってくる） */
import os from 'node:os';
import path from 'node:path';
const BASE_V1189 = 'd14d4447e3299323bbee7b70a9b1282a52dfa2c9';
test('今の関数 work-requests（main d14d444）のままで ② を入れても、出す・AM → GM の承認・一覧は今までどおり', async () => {
  let src;
  try { src = execSync('git show ' + BASE_V1189 + ':supabase/functions/work-requests/handler.mjs', { cwd: new URL('..', import.meta.url), maxBuffer: 16 << 20 }).toString('utf8'); }
  catch (e) { throw new Error('needs the v1189 commit (git fetch origin ' + BASE_V1189 + '): ' + e.message); }
  assert.ok(!/ar_state/.test(src), 'the base commit is the old handler');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-old-')); const file = path.join(dir, 'handler.mjs');
  fs.writeFileSync(file, src);
  const { createHandler } = await import(file);
  const s = await setup();
  const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
  const h = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db: s.db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  const call = async (who, body) => { const r = await h(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const w = await call('E2', { action: 'whoami' });
  assert.equal(w.status, 200); assert.equal(w.body.fn, 12); assert.equal(String(w.body.sql), '8');
  const sub = await call('E8', { action: 'submit', kind: 'hire', store_id: 'S1', client_key: 'k-00000001', payload: { ap_id: 'ap17999001', title: 'x', from_name: NAME.E8 } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body)); assert.equal(sub.body.route, undefined, 'not live: no route');
  const g = await call('E2', { action: 'get', id: sub.body.id });
  const a = await call('E5', { action: 'act', id: sub.body.id, op: 'approve', expect_rev: g.body.rev, client_key: 'k-00000002' });
  assert.equal(a.body.status, 'pending', 'the AM stage as before');
  const g2 = await call('E2', { action: 'get', id: sub.body.id });
  const b = await call('E2', { action: 'act', id: sub.body.id, op: 'approve', expect_rev: g2.body.rev, client_key: 'k-00000003' });
  assert.equal(b.body.status, 'approved');
  assert.equal((await call('E2', { action: 'ar_state' })).status, 400, 'the old function does not know the new actions');
  const l = await call('E5', { action: 'list', scope: 'team', state: 'all' });
  assert.equal(l.status, 200); assert.ok(l.body.rows.some(r => r.id === sub.body.id));
  fs.rmSync(dir, { recursive: true, force: true });
});
