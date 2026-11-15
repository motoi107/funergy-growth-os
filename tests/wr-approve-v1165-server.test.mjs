// v1165（UI案77 の 4B・5A）：経理が建て替え経費（実費）を事前経費の番号に結ぶ。予定を超えたら GM の承認をもう一度。
// 1 件の答えの prev_amount_cents（金額の変更前後）。本物の SQL（work-requests の本番の順・PGlite）と本物の handler、合成データだけ。
// PIN の確かめは代わり（'pin-E8' は社員 E8）。仕様：docs/WR_APPROVE_V1165_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2'];
const FIX = M('20261126090000_wr_approve_v1165');
const PEOPLE = [   // [id, 名前, 社員の表の役割, 肩書き, 店, manager_auth]
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'],
  ['E7', 'Sam Three', 'sl', 'Server Leader', 'S1', null], ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null], ['E10', 'Kai Two', 'g2', 'Crew Leader', 'S1', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ fix = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (fix) await pg.exec(FIX);
  await pg.exec('update public.wr_settings set live = true');
  const gm = { emp_id: 'E2', name: NAME.E2 };
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'k-' + String(++seq).padStart(8, '0');
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const today = new Date().toISOString().slice(0, 10);
  const pre = (who, cents, purpose = 'Team dinner') => ok(who, { action: 'submit', kind: 'expense_pre', store_id: 'S1', client_key: key(), payload: { date: today, purpose, total_cents: cents } });
  const rb = (who, cents) => ok(who, { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(), payload: { date: today, payer: NAME[who], vendor: 'Costco', purpose: 'その他', amount_cents: cents } });
  const act = (who, r, op, extra = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: r.rev, client_key: key(), ...extra });
  const get = (who, r) => ok(who, { action: 'get', id: r.id });
  const done = async (who, cents, purpose) => { let x = await pre(who, cents, purpose); x = (await act('E2', x, 'approve')).body; x = (await act('E3', x, 'check')).body; assert.equal(x.status, 'done'); return x; };
  const approved = async (who, cents) => { let x = await rb(who, cents); x = (await act('E2', x, 'approve')).body; assert.equal(x.status, 'approved'); return x; };
  const link = (who, r, pre, k = key()) => call(who, { action: 'link_pre', id: r.id, pre: pre === null ? null : pre.id, expect_rev: r.rev, client_key: k });
  return { pg, db, call, ok, key, act, get, pre, rb, done, approved, link };
}

test('v1165 4B: accounting links a reimbursement (actual $92) to the pre-approval (planned $100); it stays with accounting and only the $92 is paid', async () => {
  const s = await setup();
  const ex = await s.done('E8', 10000);
  const r = await s.approved('E8', 9200);
  const cand = await s.ok('E3', { action: 'pre_candidates', id: r.id });
  assert.deepEqual(cand.rows.map(x => [x.code, x.amount_cents, x.purpose, x.linked]), [[ex.code, 10000, 'Team dinner', false]]);
  const l = await s.link('E3', r, ex);
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.status, 'approved', 'not over: stays waiting for the accounting check');
  assert.equal(l.body.over, false);
  assert.deepEqual([l.body.link_pre.code, l.body.link_pre.amount_cents, l.body.link_over, l.body.link_pre.by], [ex.code, 10000, false, 'Ann Acct']);
  assert.ok(l.body.can.includes('check'));
  const exNow = await s.get('E3', ex);
  assert.deepEqual([exNow.actual.code, exNow.actual.amount_cents, exNow.status, exNow.rev], [r.code, 9200, 'done', ex.rev], 'the pre-approval shows its actual, unchanged state');
  assert.match(exNow.events.at(-1).note, /実費 RB-\d{4}-\d{4}（\$92\.00）を結んだ/);
  // 経理の確認 → 精算は実費だけ
  const ck = (await s.act('E3', l.body, 'check')).body; assert.equal(ck.status, 'checked');
  const pd = (await s.act('E3', ck, 'pay', { pay_date: new Date().toISOString().slice(0, 10), pay_method: 'Check' })).body;
  assert.equal(pd.status, 'paid'); assert.equal(pd.amount_cents, 9200);
  assert.equal((await s.get('E3', ex)).status, 'done', 'the pre-approval is never paid');
  // 本人にも見える（自分の申請の 1 件の画面）
  const mine = await s.get('E8', ex); assert.equal(mine.actual.code, r.code);
});

test('v1165 5A: an actual over the plan goes back to the GM; the GM approves again, then accounting checks it', async () => {
  const s = await setup();
  const ex = await s.done('E8', 10000);
  const r = await s.approved('E8', 12000);
  const l = await s.link('E4', r, ex);   // 事務Crew も経理と同じ
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.deepEqual([l.body.status, l.body.over, l.body.link_over, l.body.approved], ['pending', true, true, null]);
  assert.match((await s.get('E2', l.body)).events.at(-1).note, /予定 \$100\.00）に結んだ。実費 \$120\.00 が予定を \$20\.00 超えるので、GM の承認をもう一度/);
  const todo = await s.ok('E2', { action: 'list', scope: 'todo', state: 'open', limit: 50 });
  const row = todo.rows.find(x => x.id === r.id);
  assert.ok(row && row.can.includes('approve') && row.link_over === true, 'it is in the GM todo with the over mark');
  assert.ok(!l.body.can.includes('check'), 'accounting cannot check it before the GM');
  const ap = (await s.act('E2', l.body, 'approve')).body; assert.equal(ap.status, 'approved');
  assert.equal(ap.link_pre.code, ex.code, 'the link stays');
  assert.equal((await s.act('E3', ap, 'check')).body.status, 'checked');
  // 予定と同じ額は超えていない
  const ex2 = await s.done('E8', 5000); const r2 = await s.approved('E8', 5000);
  const l2 = await s.link('E3', r2, ex2); assert.deepEqual([l2.body.status, l2.body.over], ['approved', false]);
});

test('v1165 4B rules: only accounting while GM-approved; same requester; the pre-approval must be done and not taken; rev and key; unlink', async () => {
  const s = await setup();
  const ex = await s.done('E8', 10000);
  const other = await s.done('E10', 10000);
  const notDone = await s.pre('E8', 10100);   // GM の承認待ち（同じ額だと重複の候補になる）
  const r = await s.approved('E8', 8000);
  // 結べる人：経理・事務Crew だけ（GM・本人は確認できないので断る）
  assert.equal((await s.link('E2', r, ex)).status, 403);
  assert.equal((await s.link('E8', r, ex)).status, 403);
  assert.equal((await s.call('E2', { action: 'pre_candidates', id: r.id })).status, 403);
  // GM の承認前（pending）は結べない
  const pend = await s.rb('E8', 7000);
  assert.equal((await s.link('E3', pend, ex)).status, 403);
  // ほかの人の・事前承認済みでない事前経費・事前経費でないもの
  assert.deepEqual([(await s.link('E3', r, other)).body.error, (await s.link('E3', r, notDone)).body.error, (await s.link('E3', r, pend)).body.error], ['pre_bad', 'pre_bad', 'pre_bad']);
  // 候補にはほかの人の・承認待ちの事前経費は出ない
  assert.deepEqual((await s.ok('E3', { action: 'pre_candidates', id: r.id })).rows.map(x => x.code), [ex.code]);
  // 古い rev は conflict
  const stale = { ...r, rev: r.rev - 1 };
  assert.equal((await s.link('E3', stale, ex)).status, 409);
  // 結ぶ・同じ鍵の 2 回目は同じ 1 回・別の鍵で同じ EX は何もしない
  const k = s.key();
  const l = await s.link('E3', r, ex, k); assert.equal(l.status, 200);
  const again = await s.link('E3', r, ex, k); assert.equal(again.status, 200); assert.equal(again.body.replay, true); assert.equal(again.body.rev, l.body.rev);
  const same = await s.link('E3', l.body, ex); assert.equal(same.body.same, true); assert.equal(same.body.rev, l.body.rev);
  // 同じ事前経費にほかの実費は結べない（候補にも出ない）
  const r2 = await s.approved('E8', 6000);
  assert.equal((await s.link('E3', r2, ex)).body.error, 'pre_taken');
  assert.deepEqual((await s.ok('E3', { action: 'pre_candidates', id: r2.id })).rows.map(x => x.code), []);
  // 鍵の使い回し（ほかの申請）は conflict
  assert.equal((await s.call('E3', { action: 'link_pre', id: r2.id, pre: ex.id, expect_rev: r2.rev, client_key: k })).status, 409);
  // 外す → ほかの実費に結べる
  const un = await s.link('E3', l.body, null); assert.equal(un.status, 200); assert.equal(un.body.link_pre, undefined);
  assert.equal((await s.get('E3', ex)).actual, undefined);
  assert.equal((await s.link('E3', r2, ex)).status, 200);
  // 結んでいないものを外すのは bad_value・形の違う pre は bad_value
  assert.equal((await s.link('E3', un.body, null)).status, 400);
  assert.equal((await s.call('E3', { action: 'link_pre', id: r.id, pre: 'EX-1', expect_rev: un.body.rev, client_key: s.key() })).status, 400);
  // 実費が取り下げ・却下になったら、その事前経費はまた結べる
  const r3 = await s.approved('E8', 1000); const ex3 = await s.done('E8', 2000);
  const l3 = (await s.link('E3', r3, ex3)).body;
  const rt = (await s.act('E3', l3, 'return', { note: '金額を直してください' })).body; assert.equal(rt.status, 'returned');
  assert.equal((await s.get('E3', ex3)).actual.code, l3.code, 'the pre-approval shows its actual while it is open');
  const wd = (await s.act('E8', rt, 'withdraw', { note: '出し直します' })).body; assert.equal(wd.status, 'withdrawn');
  assert.equal((await s.get('E3', ex3)).actual, undefined, 'a withdrawn actual is not shown as the actual');
  const r4 = await s.approved('E8', 1500);
  assert.equal((await s.link('E3', r4, ex3)).status, 200, 'a withdrawn actual does not hold the pre-approval');
});

test('v1165 the list row says the previous version amount (amount before and after), and a request at version 1 has none', async () => {
  const s = await setup();
  const r = await s.rb('E8', 2000);
  assert.equal(r.prev_amount_cents, undefined);
  const e = (await s.act('E8', r, 'edit', { kind: 'reimburse', payload: { date: new Date().toISOString().slice(0, 10), payer: 'Lee Two', vendor: 'Costco', purpose: 'その他', amount_cents: 2400 } })).body;
  assert.deepEqual([e.version, e.amount_cents, e.prev_amount_cents], [2, 2400, 2000]);
  const row = (await s.ok('E2', { action: 'list', scope: 'todo', state: 'open', limit: 50 })).rows.find(x => x.id === r.id);
  assert.deepEqual([row.version, row.amount_cents, row.prev_amount_cents], [2, 2400, 2000]);
});

test('v1165 before this SQL: whoami says sql 6 and linking answers pre_missing (the app hides the button); the SQL stops before v1164; browser keys cannot call it', async () => {
  const s0 = await setup({ fix: false });
  const w = await s0.ok('E3', { action: 'whoami' });
  assert.equal(w.sql, 6); assert.ok(w.fn >= 8, 'fn ' + w.fn);
  const ex = await s0.done('E8', 10000), r = await s0.approved('E8', 9000);
  assert.deepEqual([(await s0.link('E3', r, ex)).status, (await s0.link('E3', r, ex)).body.error], [503, 'pre_missing']);
  assert.equal((await s0.call('E3', { action: 'pre_candidates', id: r.id })).body.error, 'pre_missing');
  // この SQL を流す（2 回でも同じ）と結べる
  await s0.pg.exec('reset role'); await s0.pg.exec(FIX); await s0.pg.exec(FIX); await s0.pg.exec('set role service_role');
  assert.equal((await s0.ok('E3', { action: 'whoami' })).sql, 7);
  assert.equal((await s0.link('E3', r, ex)).status, 200);
  // v1164 の前は止まる
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(pg.exec(FIX), /STOP: 先に段階 3/);
  await s0.pg.exec('reset role');
  for (const f of ['wr_link_pre(jsonb)', 'wr_pre_candidates(jsonb)', 'wr_row(jsonb,public.wr_requests)', 'wr_same_requester(public.wr_requests,public.wr_requests)', 'wr_cents_text(bigint)', 'wr_stage(jsonb)'])
    for (const role of ['anon', 'authenticated'])
      assert.equal((await s0.pg.query(`select has_function_privilege($1, $2, 'execute') v`, [role, 'public.' + f])).rows[0].v, false, role + ' ' + f);
  // 1 つの事前経費に実費 2 つ（関数を通らない書き込み）は表の決まりでも止まる
  const r2 = await s0.approved('E8', 500);
  await s0.pg.exec('reset role');
  await assert.rejects(s0.pg.query('update public.wr_requests set pre_id = $1 where id = $2', [ex.id, r2.id]), /duplicate key|unique/);
});
