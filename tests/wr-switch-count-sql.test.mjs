// v1165（UI案77）：切り替え前後の件数を見る読むだけの SQL（db/wr-switch-count-check.sql）。PGlite・合成データだけ（架空の人・金額）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const CHECK = fs.readFileSync(new URL('../db/wr-switch-count-check.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2'];
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'], ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ fix }) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
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
  if (fix) await pg.exec(M('20261126090000_wr_approve_v1165'));
  await pg.exec('update public.wr_settings set live = true');
  // 前の「承認」タブの記録：本体の行と分割の行（同じ id は分割の行を先に）・ワークセンターへ写した印つき・番号が無い印
  const secret = 'Zed Secret Person';
  await pg.query(`insert into public.app_state(key, value) values ('approvals', $1), ('spl_approvals_S1', $2)`, [
    JSON.stringify([{ id: 'ap1000001', type: '休暇', status: 'pending', from: secret, title: secret + ' vacation' },
      { id: 'ap1000002', type: 'スキル', status: 'approved', from: secret }, { id: 'ap1000003', type: '休暇', status: 'pending', wrq: 1, wrc: 'LV-2611-0099', from: secret }]),
    JSON.stringify({ __st: '1', v: [{ id: 'ap1000001', type: '休暇', status: 'approved', from: secret }, { id: 'ap1000004', type: '採用', status: 'pending', from: secret }] })]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 };
  const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, client_key: 'k-' + String(++seq).padStart(8, '0'), ...body }) })); return r.json(); };
  const today = new Date().toISOString().slice(0, 10);
  await call('E8', { action: 'submit', kind: 'reimburse', store_id: 'S1', payload: { date: today, payer: NAME.E8, vendor: 'Costco', purpose: 'その他', amount_cents: 1234 } });
  await call('E8', { action: 'submit', kind: 'expense_pre', store_id: 'S1', payload: { date: today, purpose: 'Party', total_cents: 5000 } });
  await pg.exec('reset role');
  return { pg, secret };
}

const rowsOf = async pg => (await pg.query(CHECK)).rows;
const find = (rows, part, kind, status) => rows.filter(r => r.part === part && (kind == null || r.kind === kind) && (status == null || r.status === status));

for (const fix of [false, true]) {
  test(`the switch-count SQL reads the old tab and the work center without changing anything (${fix ? 'after' : 'before'} the v1165 SQL)`, async () => {
    const { pg, secret } = await setup({ fix });
    const before = (await pg.query('select key, value::text v, updated_at from public.app_state order by key')).rows;
    const wrBefore = (await pg.query('select id, rev, status, updated_at from public.wr_requests order by id')).rows;
    const rows = await rowsOf(pg);
    assert.deepEqual((await pg.query('select key, value::text v, updated_at from public.app_state order by key')).rows, before, 'app_state unchanged');
    assert.deepEqual((await pg.query('select id, rev, status, updated_at from public.wr_requests order by id')).rows, wrBefore, 'wr_requests unchanged');
    const text = JSON.stringify(rows);
    assert.doesNotMatch(text, new RegExp(secret), 'no names or titles');
    assert.doesNotMatch(text, /1234|12\.34|5000|50\.00/, 'no amounts');
    // 1：同じ id は 1 回（分割の行の「承認済み」が勝つ）
    const p1 = find(rows, '1 前の承認タブ');
    assert.equal(p1.reduce((t, r) => t + Number(r.n), 0), 4, 'four distinct records');
    assert.equal(Number(find(rows, '1 前の承認タブ', '休暇', 'approved')[0].n), 1, 'ap1000001 counted once, as the split row says');
    // 3：印なしの承認待ちは 採用 1（休暇の ap1000001 は分割の行で承認済み・ap1000003 は印あり）
    const p3 = find(rows, '3 前の承認の画面に残る承認待ち');
    assert.deepEqual(p3.filter(r => r.kind !== '(合計)').map(r => [r.kind, r.n]), [['採用', '1']]);
    assert.equal(find(rows, '3 前の承認の画面に残る承認待ち', '(合計)')[0].n, '1');
    // 4：印はあるのに番号がワークセンターに無い（LV-2611-0099）
    const p4 = find(rows, '4 印があるのにワークセンターに無い')[0];
    assert.deepEqual([p4.n, p4.note], ['1', 'NG：Claude に']);
    assert.equal(find(rows, '5 同じ前の記録を 2 回写した')[0].note, 'OK（0）');
    // 2・7：ワークセンターの申請
    assert.deepEqual(find(rows, '2 ワークセンター').map(r => [r.kind, r.status, r.note, r.n]).sort(),
      [['expense_pre', 'pending', '新しく出した', '1'], ['reimburse', 'pending', '新しく出した', '1']]);
    assert.deepEqual(find(rows, '7 ワークセンターの合計').map(r => [r.kind, r.n]).sort(), [['expense_pre', '1'], ['reimburse', '1']]);
    assert.equal(find(rows, '6 事前経費に結んだ実費').length, 0, 'nothing linked yet');
  });
}

test('the switch-count SQL only reads (no insert, update, delete, alter, create, drop, grant)', () => {
  const body = CHECK.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(body, /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i);
  assert.match(CHECK, /^-- 読むだけ/);
});
