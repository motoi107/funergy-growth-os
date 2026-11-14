// v1164：経費の申請（ガソリン代・建て替え経費・事前経費）を G2〜G6 が出せる・G1 は出せない（依頼書 11/14 の最優先）。
// 本物の SQL（work-requests の本番の順・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/EXPENSE_SUBMIT_V1164_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files'];
const FIX = M('20261125090000_wr_expense_g2');
const PEOPLE = [   // [id, 名前, 社員の表の役割, 肩書き, 店, manager_auth]
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Mia Four', 'g4', 'Store Manager', 'S1', null], ['E7', 'Sam Three', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null], ['E9', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E10', 'Kai Two', 'g2', 'Crew Leader', 'S2', null],
  ['E11', 'Ola Lead', 'office_crew', 'Office Crew Leader', 'OFFICE', 'office_crew'],   // 事務Crew でも肩書きが Office Crew Leader なら G2（#160 の Codex P3：記録の「事務Crew は建て替えだけ」は G1 の事務Crew のこと）
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const ALL = ['mileage', 'reimburse', 'expense_pre'];

async function setup({ fix = true, confirm = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (fix) await pg.exec(FIX);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  if (confirm) { const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest }); }
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const today = new Date().toISOString().slice(0, 10);
  const PAY = { mileage: { date: today, purpose: '買い出し', origin: 'A', destination: 'B', one_way_miles: 10, round_trip: false },
    reimburse: { date: today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 8000 },
    expense_pre: { date: today, purpose: 'Team dinner', total_cents: 10000 } };
  // 金額は毎回ちがう（同じ店・日・金額は重複の候補になり、理由を求められるため）
  const submit = (who, kind, store = 'S1') => { ++seq; const p = { ...PAY[kind] };
    if (kind === 'mileage') p.one_way_miles = 10 + seq / 10; if (kind === 'reimburse') p.amount_cents = 8000 + seq; if (kind === 'expense_pre') p.total_cents = 10000 + seq;
    return call(who, { action: 'submit', kind, store_id: store, client_key: 'k-' + seq.toString().padStart(8, '0'), payload: p }); };
  return { pg, db, call, submit };
}

test('v1164 whoami says which expense kinds each person can send; the server takes exactly those (G2–G6 all three incl. Office Crew Leader, G1 none, G1 office crew reimbursement)', async () => {
  const s = await setup();
  const want = { E1: ALL, E2: ALL, E3: ALL, E4: ['reimburse'], E5: ALL, E6: ALL, E7: ALL, E8: ALL, E9: [], E10: ALL, E11: ALL };
  for (const [who, kinds] of Object.entries(want)) {
    const w = (await s.call(who, { action: 'whoami' })).body;
    assert.deepEqual(w.exp_kinds, kinds, who + ' ' + NAME[who]);
    const store = ['E1', 'E2', 'E3', 'E4', 'E11'].includes(who) ? 'S1' : who === 'E10' ? 'S2' : 'S1';
    for (const k of ALL) {
      const r = await s.submit(who, k, store);
      if (kinds.includes(k)) { assert.equal(r.status, 200, who + ' ' + k + ' ' + JSON.stringify(r.body)); assert.equal(r.body.status, 'pending', who + ' ' + k + ' ' + r.body.status); assert.equal(r.body.requester_emp, who); }
      else assert.deepEqual([r.status, r.body.error], [403, 'forbidden'], who + ' ' + k);
    }
  }
  // 店の範囲は今までどおり：G2 はほかの店に出せない
  assert.equal((await s.submit('E8', 'reimburse', 'S2')).status, 403);
  // G2 の出した 3 種は GM の承認待ち（ガソリン代も GM：v1135 の 4B）・G2 は承認できない
  const rows = (await s.call('E8', { action: 'list', scope: 'mine', state: 'all', limit: 50 })).body.rows;
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.next && r.next.who]).sort(), ALL.map(k => [k, 'pending', 'gm']).sort());
  for (const r of rows) assert.ok(!(r.can || []).includes('approve'), 'not on own');
  const other = (await s.submit('E7', 'reimburse')).body;
  // G2 はほかの人の申請を見られない（not_found）＝承認できない
  const g2ap = await s.call('E8', { action: 'act', id: other.id, op: 'approve', expect_rev: other.rev, client_key: 'k-g2-ap-000001' });
  assert.ok([403, 404].includes(g2ap.status), 'G2 cannot approve another person: ' + g2ap.status);
  assert.equal((await s.call('E2', { action: 'act', id: other.id, op: 'approve', expect_rev: other.rev, client_key: 'k-gm-ap-000001' })).body.status, 'approved');
});

test('v1164 a G2 not yet confirmed by GM can still send (grade from the employee table, capped at G3 as before); a G1 who writes g2 into the employee table gets G2 only', async () => {
  const s = await setup({ confirm: false });
  const w = (await s.call('E8', { action: 'whoami' })).body;
  assert.deepEqual([w.me.grade, w.me.confirmed, w.exp_kinds], [2, false, ALL]);
  assert.equal((await s.submit('E8', 'mileage')).status, 200);
  // G4 で写しが無い人は G3 まで（今までどおり）：それでも 3 種とも出せる
  assert.deepEqual((await s.call('E6', { action: 'whoami' })).body.exp_kinds, ALL);
});

test('v1164 before this SQL (the v1162 production): G2 is refused mileage and pre-approval, and whoami has no exp_kinds (the app then uses the old rule)', async () => {
  const s = await setup({ fix: false });
  const w = (await s.call('E8', { action: 'whoami' })).body;
  assert.equal(w.exp_kinds, undefined);
  assert.deepEqual([(await s.submit('E8', 'mileage')).status, (await s.submit('E8', 'expense_pre')).status, (await s.submit('E8', 'reimburse')).status], [403, 403, 200]);
  // この SQL を流すと（2 回でも）通る
  await s.pg.exec('reset role'); await s.pg.exec(FIX); await s.pg.exec(FIX); await s.pg.exec('set role service_role');
  assert.equal((await s.submit('E8', 'mileage')).status, 200);
  assert.equal((await s.submit('E8', 'expense_pre')).status, 200);
});

test('v1164 the SQL stops before stage 2, and the browser keys cannot call the new or changed functions', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(pg.exec(FIX), /STOP: 先にワークセンターの申請の SQL/);
  const s = await setup();
  await s.pg.exec('reset role');
  for (const f of ['wr_exp_kinds(jsonb)', 'wr_can_submit(jsonb,text,text)', 'wr_whoami(jsonb)']) for (const role of ['anon', 'authenticated'])
    assert.equal((await s.pg.query(`select has_function_privilege($1, $2, 'execute') v`, [role, 'public.' + f])).rows[0].v, false, role + ' ' + f);
});

test('v1164 the files Moto pastes: the SQL is the migration letter for letter; pre-check, the SQL (twice), post-check all OK; the post-check notices the stage 2 SQL run again', async () => {
  const D = new URL('../deploy/expense-g2-v1164/', import.meta.url);
  const read = f => fs.readFileSync(new URL(f, D), 'utf8');
  assert.equal(read('2_SQL_経費の申請.sql'), FIX);
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci/, f + ' has no keys');
  const s = await setup({ fix: false });
  await s.pg.exec('reset role');
  const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
  let pre = by((await s.pg.query(read('1_最初に確認_読むだけ.sql'))).rows);
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '0');
  await s.pg.exec(read('2_SQL_経費の申請.sql')); await s.pg.exec(read('2_SQL_経費の申請.sql'));
  const post = (await s.pg.query(read('3_確認_読むだけ.sql'))).rows;
  assert.ok(post.every(r => r.result === 'OK'), JSON.stringify(post));
  assert.equal(by((await s.pg.query(read('1_最初に確認_読むだけ.sql'))).rows)('2.'), '1');
  // 段階 2 の SQL をあとで流し直すと whoami が前の形に戻る → 3 が NG → この 2 をもう一度
  await s.pg.exec(M('20261120090000_work_requests_stage2'));
  assert.match(by((await s.pg.query(read('3_確認_読むだけ.sql'))).rows)('3.'), /^NG/);
  await s.pg.exec(read('2_SQL_経費の申請.sql'));
  assert.ok((await s.pg.query(read('3_確認_読むだけ.sql'))).rows.every(r => r.result === 'OK' || /NG（deploy\/work-requests-v1159/.test(r.result)));
});
