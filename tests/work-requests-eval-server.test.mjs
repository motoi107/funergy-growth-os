// v1132 work-requests 2 段目：評価の変更（skill・cs・tiprate）と表示設定。本物の SQL（1 段目＋2 段目・PGlite）と本物の handler、合成データだけ。
// PIN の確かめは代わり（'pin-E7' は社員 E7）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, normPayload } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG1 = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');
const MIG2 = fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8');

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'sl', 'Kitchen Leader', 'S2', null], ['E12', 'Hal Head', 'sl', 'Store Manager', 'S2', null],
  ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ mig2Twice = false } = {}) {
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
  await pg.exec(MIG1); await pg.exec(MIG2); if (mig2Twice) await pg.exec(MIG2);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'k-' + (++seq).toString().padStart(6, '0') + '-eval';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const skill = (who, target, store = 'S1', extra = {}) => call(who, { action: 'submit', kind: 'skill', store_id: store, client_key: extra.key || key(),
    payload: { target_emp: target, items: [{ pos: 'Grill', from: 1, to: 2 }], reason: 'グリルを一人で回せる', ...(extra.payload || {}) } });
  const act = (who, r, op, body = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: body.rev ?? r.rev, client_key: body.key || key(), ...body });
  return { pg, db, call, key, skill, act };
}

test('a confirmed G4 asks the GM to change a skill level; the GM approves; the change is recorded once as applied', async () => {
  const { call, skill, act, pg } = await setup();
  const r = (await skill('E6', 'E8')).body;
  assert.match(r.code, /^SK-\d{4}-0001$/); assert.equal(r.status, 'pending'); assert.equal(r.target_emp, 'E8'); assert.equal(r.target_name, 'Cam Crew');
  assert.deepEqual(r.next, { step: 'approve', who: 'gm' }); assert.deepEqual(r.can, ['edit', 'withdraw']);
  assert.equal(r.amount_cents, null);
  assert.equal((await act('E5', r, 'approve')).status, 403, 'an AM does not decide evaluation changes');
  assert.equal((await act('E3', r, 'approve')).status, 403, 'accounting does not either');
  const todo = (await call('E2', { action: 'list', scope: 'todo' })).body;
  assert.ok(todo.rows.some(x => x.id === r.id));
  const a = (await act('E2', r, 'approve')).body;
  assert.equal(a.status, 'approved'); assert.deepEqual(a.next, { step: 'apply', who: 'gm' }); assert.deepEqual(a.can, ['apply', 'apply_fail', 'reject']);
  assert.ok((await call('E2', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'still to do for the GM until applied');
  const k = 'k-apply-000001';
  const ap = (await act('E2', a, 'apply', { key: k, note: 'Grill 1 → 2' })).body;
  assert.equal(ap.status, 'applied'); assert.equal(ap.closed.reason, 'Grill 1 → 2'); assert.deepEqual(ap.can, []);
  const again = await act('E2', a, 'apply', { key: k });
  assert.equal(again.body.replay, true, 'the same tap again is the same one');
  assert.equal((await act('E1', ap, 'apply')).status, 403, 'not twice');
  const ev = await pg.query(`select action from public.wr_events where request_id = $1 order by id`, [r.id]);
  assert.deepEqual(ev.rows.map(x => x.action), ['submit', 'approve', 'apply']);
});

test('who may ask and for whom', async () => {
  const { skill, pg } = await setup();
  assert.equal((await skill('E7', 'E8')).status, 403, 'a G3 cannot ask');
  assert.equal((await skill('E5', 'E8')).status, 403, 'an AM changes directly (as before)');
  assert.equal((await skill('E2', 'E8')).status, 403, 'so does the GM');
  assert.equal((await skill('E6', 'E6')).status, 403, 'not for oneself');
  assert.equal((await skill('E6', 'E5')).status, 403, 'not for the AM');
  assert.equal((await skill('E6', 'E2')).status, 403, 'not for the GM');
  assert.equal((await skill('E6', 'E9', 'S1')).status, 403, 'not for someone outside the store');
  assert.equal((await skill('E6', 'E9', 'S2')).status, 403, 'not for a store that is not theirs');
  assert.equal((await skill('E6', 'E12', 'S1')).status, 403, 'not for someone at the same grade elsewhere');
  assert.equal((await skill('E6', 'E7')).status, 200, 'a G3 of the store');
  // an unconfirmed G4 (title raised in the employee table, not checked by a GM) cannot ask
  await pg.exec(`reset role; set role anon; update public.employees set title = 'Store Manager' where id = 'E7'; reset role; set role service_role;`);
  assert.equal((await skill('E7', 'E8')).status, 403);
  assert.equal((await skill('E6', 'E8', 'S1', { payload: { items: [{ pos: 'Grill', from: 1, to: 9 }] } })).status, 400, 'level out of range');
  assert.equal((await skill('E6', 'E8', 'S1', { payload: { reason: '' } })).status, 400, 'a reason is needed');
  assert.equal((await skill('E6', 'E8', 'S1', { payload: { target_emp: "X');(" } })).status, 400);
  assert.equal((await skill('E6', 'E13')).status, 403, 'not for accounting / office crew, even when they work at the store');
});

test('a confirmed G4 who is now G3 in the employee table cannot ask (the narrower one wins)', async () => {
  const { skill, pg, call, key } = await setup();
  assert.equal((await skill('E6', 'E8')).status, 200);
  await pg.exec(`reset role; set role anon; update public.employees set title = 'Server Leader' where id = 'E6'; reset role; set role service_role;`);
  assert.equal((await skill('E6', 'E7')).status, 403, 'confirmed, but G3 now');
  const tip = await call('E6', { action: 'submit', kind: 'tiprate', store_id: 'S1', client_key: key(), payload: { target_emp: 'E8', reason: 'r', rate_to: 90, from_day: '2026-11-16' } });
  assert.equal(tip.status, 403, 'not even for someone below G3');
});

test('the SQL checks the fields itself (not only the function); the function checks them too', async () => {
  const { db, key } = await setup();
  const sub = (kind, payload) => db.rpc('wr_submit', { emp_id: 'E6', name: NAME.E6, kind, store_id: 'S1', client_key: key(),
    payload: { target_emp: 'E8', target_name: 'Cam Crew', reason: 'r', ...payload } }).then(v => v.code ? 'ok' : JSON.stringify(v), e => String(e.message).split(/[\s:]/)[0]);
  assert.equal(await sub('skill', { items: [{ pos: 'Grill', from: 1, to: 2 }], reason: '' }), 'bad_value', 'reason');
  assert.equal(await sub('skill', { items: [{ pos: 'Grill', from: 1, to: 6 }] }), 'bad_value', 'skill level 0–5');
  assert.equal(await sub('cs', { items: [{ key: 'B-2', from: 3, to: 4 }], lss_req: 'q1' }), 'bad_value', 'Career Score 0–3');
  assert.equal(await sub('cs', { items: [{ key: 'B-2', from: 3, to: 2 }] }), 'bad_value', 'the score request it came from');
  assert.equal(await sub('tiprate', { rate_to: 85, from_day: '2026-11-16' }), 'bad_value', 'Tip Rate 80 / 90 / 100');
  assert.equal(await sub('tiprate', { rate_to: 90, from_day: '2026-11-16' }), 'ok', 'control');
  const P = { target_emp: 'E8', reason: 'r' };
  assert.throws(() => normPayload('skill', { ...P, reason: '  ', items: [{ pos: 'Grill', to: 2 }] }), /bad_value/);
  assert.throws(() => normPayload('tiprate', { ...P, rate_to: 85, from_day: '2026-11-16' }), /bad_value/);
  assert.throws(() => normPayload('skill', { ...P, items: [{ pos: 'Grill', to: 6 }] }), /bad_value/);
  assert.throws(() => normPayload('cs', { ...P, items: [{ key: 'B-2', to: 2 }] }), /bad_value/);
  assert.equal(normPayload('tiprate', { ...P, rate_to: 90, from_day: '2026-11-16' }).rate_to, 90);
});

test('one open request per person and kind; return needs a reason and keeps the number; withdraw', async () => {
  const { call, skill, act, key } = await setup();
  const r = (await skill('E6', 'E8')).body;
  const same = (await skill('E6', 'E8')).body;
  assert.equal(same.open_same, r.code, 'the open one is named instead of a second');
  const tr = (await call('E6', { action: 'submit', kind: 'tiprate', store_id: 'S1', client_key: key(), payload: { target_emp: 'E8', rate_from: 80, rate_to: 90, from_day: '2026-11-16', reason: '定着' } })).body;
  assert.match(tr.code, /^TR-/); assert.equal(tr.effective_date, '2026-11-16');
  assert.equal((await act('E2', r, 'return')).status, 400, 'reason required');
  const back = (await act('E2', r, 'return', { note: 'どの日のチェックか書いて' })).body;
  assert.equal(back.status, 'returned'); assert.deepEqual(back.can, []);
  const mine = (await call('E6', { action: 'get', id: r.id })).body;
  assert.deepEqual(mine.can, ['resubmit', 'withdraw']);
  const v2 = (await call('E6', { action: 'act', id: r.id, op: 'resubmit', kind: 'skill', expect_rev: mine.rev, client_key: key(),
    payload: { target_emp: 'E8', items: [{ pos: 'Grill', from: 1, to: 2 }], reason: '10/30 のチェックで全部 OK' } })).body;
  assert.equal(v2.status, 'pending'); assert.equal(v2.version, 2); assert.equal(v2.code, r.code);
  assert.equal((await call('E6', { action: 'act', id: r.id, op: 'edit', kind: 'skill', expect_rev: v2.rev, client_key: key(),
    payload: { target_emp: 'E7', items: [{ pos: 'Grill', from: 1, to: 2 }], reason: 'x' } })).status, 400, 'not another person');
  const w = (await act('E6', v2, 'withdraw')).body;
  assert.equal(w.status, 'withdrawn');
  assert.equal((await skill('E6', 'E8')).body.status, 'pending', 'a new one after withdrawing');
});

test('apply can fail with a reason and be tried again; Tip Rate and Career Score check their own fields', async () => {
  const { pg, db, call, act, key } = await setup();
  const t = (k, payload) => call('E6', { action: 'submit', kind: k, store_id: 'S1', client_key: key(), payload: { target_emp: 'E8', reason: 'r', ...payload } });
  assert.equal((await t('tiprate', { rate_to: 85, from_day: '2026-11-16' })).status, 400);
  assert.equal((await t('tiprate', { rate_to: 90, from_day: '2099-01-01' })).status, 400);
  assert.equal((await t('cs', { items: [{ key: 'B-2', from: 3, to: 2 }] })).status, 400, 'a Career Score change carries the score request it came from');
  const cs = (await t('cs', { lss_req: 'lssq_abc', quarter: '2026-Q4', items: [{ key: 'B-2', label: 'お客様の名前', from: 3, to: 2 }], total_from: 312, total_to: 309 })).body;
  assert.match(cs.code, /^CS-/); assert.equal(cs.payload.lss_req, 'lssq_abc');
  const a = (await act('E2', cs, 'approve')).body;
  assert.equal((await act('E2', a, 'apply_fail')).status, 400, 'reason required');
  const f = (await act('E2', a, 'apply_fail', { note: 'Career Score の記録を読めなかった' })).body;
  assert.equal(f.status, 'apply_error'); assert.deepEqual(f.can, ['apply', 'apply_fail', 'reject']);
  assert.equal((await act('E6', f, 'apply')).status, 403, 'only a GM or the CEO applies');
  assert.equal((await act('E1', f, 'apply', { note: 'B-2 3 → 2' })).body.status, 'applied');
  // 承認のあと反映しないときは、GM・CEO が理由を書いて閉じる。閉じたら同じ人・同じ種類をまた出せる（独立レビュー P2-1）
  const tr = (await t('tiprate', { rate_to: 90, from_day: '2026-11-16' })).body;
  const ta = (await act('E2', tr, 'approve')).body;
  assert.equal((await act('E6', ta, 'reject', { note: 'x' })).status, 403, 'the G4 cannot close it');
  assert.equal((await act('E2', ta, 'reject')).status, 400, 'reason required');
  const closed = (await act('E2', ta, 'reject', { note: '別の率にした' })).body;
  assert.equal(closed.status, 'rejected'); assert.deepEqual(closed.can, []);
  const again = (await t('tiprate', { rate_to: 100, from_day: '2026-11-16' })).body;
  assert.match(again.code, /^TR-/); assert.notEqual(again.code, tr.code);
  const who = (await call('E2', { action: 'whoami' })).body;
  assert.equal(who.fn, 2); assert.equal(who.sql, 2, 'the function says the stage-2 SQL is there');
  const h1 = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k],
    db: { rpc: (n, p) => (n === 'wr_stage' ? Promise.reject(new Error('function not found')) : db.rpc(n, p)) },
    verifyPin: async () => ({ emp_id: 'E2', name: NAME.E2 }) });
  const w1 = await (await h1(new Request('https://fn.test/work-requests', { method: 'POST', body: JSON.stringify({ action: 'whoami', pin_session: 'x' }) }))).json();
  assert.equal(w1.sql, 1, 'without the stage-2 SQL the function says stage 1');
  // Career Score は「未採点に戻す」（to が null）もある。スキルは数だけ（サーバーの SQL でも）
  const t7 = (k, payload) => call('E6', { action: 'submit', kind: k, store_id: 'S1', client_key: key(), payload: { target_emp: 'E7', reason: 'r', ...payload } });
  const nul = (await t7('cs', { lss_req: 'lssq_def', items: [{ key: 'C-1', from: 2, to: null }] })).body;
  assert.match(nul.code, /^CS-/); assert.equal(nul.payload.items[0].to, null);
  assert.equal((await t7('skill', { items: [{ pos: 'Grill', from: 1, to: null }] })).status, 400);
  const sqlTwo = await pg.query(`select public.wr_norm_eval(jsonb_build_object('emp','E6','grade',4), 'skill', 'S1', $1::jsonb)`,
    [JSON.stringify({ target_emp: 'E7', reason: 'r', items: [{ pos: 'Grill', from: 1, to: 2 }] })]).then(() => 'ok', e => String(e.message));
  assert.equal(sqlTwo, 'ok', 'control: the same call with a number passes');
  const sqlNull = await pg.query(`select public.wr_norm_eval(jsonb_build_object('emp','E6','grade',4), 'skill', 'S1', $1::jsonb)`,
    [JSON.stringify({ target_emp: 'E7', reason: 'r', items: [{ pos: 'Grill', from: 1, to: null }] })]).then(() => 'ok', e => String(e.message));
  assert.match(sqlNull, /bad_value/, 'the SQL refuses a skill level that is not a number');
});

test('expense requests still go through the first stage (dispatch); the SQL runs twice; browsers cannot reach the new functions', async () => {
  const { call, act, key, pg } = await setup({ mig2Twice: true });
  const m = (await call('E7', { action: 'submit', kind: 'mileage', store_id: 'S1', client_key: key(), payload: { date: '2026-10-28', purpose: '銀行・郵便', origin: 'a', destination: 'b', one_way_miles: 5, round_trip: false, memo: '' } })).body;
  assert.match(m.code, /^GS-/); assert.equal(m.amount_cents, 350);
  const ap = (await act('E5', m, 'approve')).body;
  assert.equal(ap.status, 'approved'); assert.deepEqual(ap.next, { step: 'check', who: 'acct' });
  assert.equal((await act('E3', ap, 'check')).body.status, 'checked');
  const fns = await pg.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\\_%'`);
  assert.ok(fns.rows.length >= 50);
  assert.deepEqual(fns.rows.filter(x => x.a || x.b).map(x => x.proname), []);
  assert.ok(fns.rows.some(x => x.proname === 'wr_act_exp') && fns.rows.some(x => x.proname === 'wr_submit_exp') && fns.rows.some(x => x.proname === 'wr_actions_exp'));
  const t = await pg.query(`select has_table_privilege('anon', 'public.wr_views', 'select') a`); assert.equal(t.rows[0].a, false);
});

test('the matrix view: each person keeps their own hidden list per store, with versions', async () => {
  const { call } = await setup();
  assert.deepEqual((await call('E6', { action: 'view_get', store: 'S1' })).body.hidden, []);
  const s1 = (await call('E6', { action: 'view_save', store: 'S1', hidden: ['E8', 'E8', 'E7'], expect_rev: 0 })).body;
  assert.deepEqual(s1.hidden, ['E7', 'E8']); assert.equal(s1.rev, 1);
  assert.equal((await call('E6', { action: 'view_save', store: 'S1', hidden: [], expect_rev: 0 })).status, 409, 'another device saved first');
  assert.deepEqual((await call('E6', { action: 'view_get', store: 'S1' })).body.hidden, ['E7', 'E8']);
  assert.deepEqual((await call('E5', { action: 'view_get', store: 'S1' })).body.hidden, [], 'someone else’s view is untouched');
  const e5 = await call('E5', { action: 'view_save', store: 'S1', hidden: ['E8'], expect_rev: 0 });
  assert.equal(e5.status, 200, 'someone else starts their own view at version 0'); assert.deepEqual(e5.body.hidden, ['E8']);
  assert.deepEqual((await call('E6', { action: 'view_get', store: 'S1' })).body.hidden, ['E7', 'E8']);
  assert.deepEqual((await call('E6', { action: 'view_get', store: 'S2' })).body.hidden, [], 'per store');
  assert.equal((await call('E6', { action: 'view_save', store: 'S1', hidden: ["x');"], expect_rev: 1 })).status, 400);
  assert.equal((await call('E6', { action: 'view_save', store: 'S1', hidden: [], expect_rev: 1 })).body.rev, 2);
});
