// v1159 work-requests 段階 3：前の「承認」タブの記録を写す（UI案74 の答え・Moto さん 11/13 18:42 HST「1 はい 2 はい 3 B 4 はい」）。
// 本物の SQL（1 段目〜段階 2＋段階 3・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/WORKCENTER_APPROVALS_STAGE3_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const S3 = M('20261123090000_work_requests_stage3');
const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
// 前の承認タブの記録（共通データ approvals）。id は 'ap' + ミリ秒
const T26 = Date.parse('2026-10-20T20:00:00Z'), T25 = Date.parse('2025-11-20T20:00:00Z');
const AP = (n, over = {}) => ({ id: 'ap' + (T26 + n), type: '休暇', title: '休暇の申請 ' + n, store: 'S1', from: NAME.E8, status: 'pending', date: '2026/10/20', ref: 'vac' + n, _mut: T26 + n, ...over });

async function setup({ s3 = true, s2on = true, approvals = [] } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (s3) await pg.exec(S3);
  await pg.query(`insert into public.app_state(key, value) values ('approvals', $1::jsonb)`, [JSON.stringify(approvals)]);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'k-' + (++seq).toString().padStart(6, '0') + '-s3';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  if (s2on) { const w = (await call('E2', { action: 'whoami' })).body; assert.equal((await call('E2', { action: 's2_save', s2: true, expect_rev: w.settings_rev })).status, 200); }
  const item = (a, over = {}) => ({ ap_id: a.id, kind: over.kind || 'leave', store_id: over.store_id || 'S1', payload: { ap_id: a.id, title: a.title, from_name: a.from, store_name: 'Store One', ...(over.payload || {}) } });
  const imp = (who, items) => call(who, { action: 's3_import', items });
  const list = async (who, scope = 'team', state = 'all') => (await call(who, { action: 'list', scope, state, limit: 500 })).body.rows;
  const act = (who, r, op, body = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: body.rev ?? r.rev, client_key: body.key || key(), ...body });
  return { pg, db, call, key, item, imp, list, act };
}

test('the stage 3 SQL comes after stage 2 (stops first), runs twice, says stage 6; whoami says fn 6', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(pg.exec(S3), /STOP: 先に段階 2/);
  const { pg: pg2, call } = await setup();
  await pg2.exec('reset role'); await pg2.exec(S3); await pg2.exec('set role service_role');
  const w = (await call('E2', { action: 'whoami' })).body;
  assert.equal(w.sql, 6); assert.equal(w.fn, 6);
  const n = (await pg2.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\\_s3\\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows[0].n;
  assert.equal(n, 0, 'the browser key cannot call the stage 3 functions');
});

test('pending → work center pending (same order as stage 2); 2026 decisions → read-only history; the server decides status, store and requester', async () => {
  const pend = AP(1), appr = AP(2, { status: 'approved', decidedBy: NAME.E5, decidedAt: '2026-10-22T19:00:00.000Z', type: 'スキル', title: 'Grill Lv 2', from: NAME.E8 });
  const rej = AP(3, { status: 'rejected', decidedBy: NAME.E2, decidedAt: '2026-10-23T19:00:00.000Z', rejectReason: '人が足りない' });
  const old = AP(4, { id: 'ap' + T25, status: 'approved', decidedAt: '2025-11-21T19:00:00.000Z' });
  const inwc = AP(5, { wrq: 1, wrc: 'LV-2611-0001' });
  const { imp, item, list, act, call } = await setup({ approvals: [pend, appr, rej, old, inwc] });
  // 端末が「承認待ち」の記録を承認済みと言っても、サーバーは共通データで決める
  const r = (await imp('E2', [item(pend, { payload: { title: '端末の見出し' } }), item(appr, { kind: 'skill_self' }), item(rej), item(old), item(inwc)])).body;
  assert.deepEqual(r.items.map(x => x.result), ['pending', 'history', 'history', 'old', 'in_wc']);
  assert.deepEqual(r.known.sort(), [pend.id, appr.id, rej.id].sort());
  const rows = await list('E2');
  const p = rows.find(x => x.payload.ap_id === pend.id), a = rows.find(x => x.payload.ap_id === appr.id), j = rows.find(x => x.payload.ap_id === rej.id);
  assert.equal(p.status, 'pending'); assert.equal(p.kind, 'leave'); assert.match(p.code, /^LV-/); assert.equal(p.legacy, true);
  assert.equal(p.requester_name, NAME.E8); assert.equal(p.store_id, 'S1');
  assert.deepEqual([a.status, a.kind, a.legacy_info.hist, a.legacy_info.decidedBy], ['applied', 'skill_self', 'true', NAME.E5]);
  assert.match(a.code, /^SS-2610-/, 'numbered by the day it was asked');
  assert.deepEqual([j.status, j.legacy_info.rejectReason], ['rejected', '人が足りない']);
  // 履歴にはボタンが無い（もう一度は反映しない）
  for (const h of [a, j]) assert.deepEqual((await call('E2', { action: 'get', id: h.id })).body.can || [], [], h.code);
  // 承認待ちは段階 2 と同じ：AM の段 → 休暇は AM で決まる。GM の要対応にも出る（7B）
  assert.ok((await list('E5', 'todo', 'open')).some(x => x.id === p.id), 'the AM of the store sees it to approve');
  assert.ok((await list('E2', 'todo', 'open')).some(x => x.id === p.id), 'the GM too');
  assert.ok(!(await list('E9', 'team', 'all')).some(x => x.id === p.id), 'a crew member of another store does not see it');
  const ok = (await act('E5', p, 'approve')).body;
  assert.equal(ok.status, 'approved', 'then the approving device applies it once, as in stage 2');
  // 2 回目は写さない
  const again = (await imp('E2', [item(pend), item(appr, { kind: 'skill_self' })])).body;
  assert.deepEqual(again.items.map(x => x.result), ['known', 'known']);
});

test('only GM/CEO, only while stage 2 is on; wrong kind, store, missing and deleted records are not copied; the payload is checked', async () => {
  const a1 = AP(11), del = AP(12, { _deleted: true }), hq = AP(13, { store: '本部', type: 'シフト変更' }), named = AP(14, { store: 'Store One' });
  const { imp, item, pg } = await setup({ approvals: [a1, del, hq, named] });
  assert.equal((await imp('E5', [item(a1)])).status, 403, 'an AM cannot');
  assert.equal((await imp('E3', [item(a1)])).status, 403, 'accounting cannot');
  const r = (await imp('E1', [item(a1, { kind: 'shift' }), item(del), item(AP(99)), item(hq, { kind: 'shift', store_id: '---' }), item(named)])).body;
  assert.deepEqual(r.items.map(x => x.result), ['kind', 'deleted', 'missing', 'pending', 'pending'], 'the 本部 record goes to ---; a store written by name matches its id');
  assert.deepEqual((await imp('E1', [item(a1, { store_id: 'S2' })])).body.items.map(x => x.result), ['store'], 'the device cannot move it to another store');
  assert.equal((await imp('E2', [item(a1, { payload: { ap_id: 'ap123456789' } })])).status, 400, 'the payload id must be the record id');
  assert.equal((await imp('E2', [item(a1), item(a1)])).status, 400, 'the same record twice in one call');
  assert.equal((await imp('E2', Array.from({ length: 101 }, (_, i) => item(AP(200 + i))))).status, 400, 'at most 100');
  await pg.exec(`reset role; update public.wr_settings set s2_live = false; set role service_role`);
  assert.equal((await imp('E2', [item(a1)])).status, 409, 'not while stage 2 is off');
});

test('budgets: a pending one becomes the request for that month (later versions build on it); copied history never does', async () => {
  const bp = AP(21, { type: '予算', title: '予算 2026-12', ym: '2026-12', from: NAME.E5 });
  const bh = AP(22, { type: '予算', title: '予算 2026-11', ym: '2026-11', from: NAME.E5, status: 'approved', decidedBy: NAME.E2, decidedAt: '2026-10-28T19:00:00.000Z' });
  const { imp, item, list, call, key } = await setup({ approvals: [bp, bh] });
  const bud = (a, ym, total) => item(a, { kind: 'budget', payload: { ym, total_cents: total, days: { [ym + '-01']: total } } });
  const r = (await imp('E2', [bud(bp, '2026-12', 500000), bud(bh, '2026-11', 400000)])).body;
  assert.deepEqual(r.items.map(x => x.result), ['pending', 'history']);
  const rows = await list('E2');
  const h = rows.find(x => x.payload.ym === '2026-11');
  assert.equal(h.amount_cents, null, 'the history keeps no amount (today’s budget may differ from what was approved)');
  assert.equal(h.payload.days, undefined);
  // 11 月の新しい予算は、写した履歴の新しい版にならない（新しい申請）
  const n = (await call('E5', { action: 'submit', kind: 'budget', store_id: 'S1', client_key: key(), payload: { ap_id: 'ap' + (T26 + 500), title: '予算 2026-11', ym: '2026-11', total_cents: 410000 } })).body;
  assert.notEqual(n.id, h.id); assert.equal(n.version, 1);
  // 12 月：写した承認待ちに新しい版が重なる（段階 2 と同じ）
  const p = rows.find(x => x.payload.ym === '2026-12');
  const v2 = (await call('E5', { action: 'submit', kind: 'budget', store_id: 'S1', client_key: key(), payload: { ap_id: 'ap' + (T26 + 501), title: '予算 2026-12', ym: '2026-12', total_cents: 510000 } })).body;
  assert.equal(v2.id, p.id); assert.equal(v2.version, 2);
  // 12 月にもう段階 2 の申請があれば、前の承認待ちは写さない
  const bp2 = AP(23, { type: '予算', title: '予算 2026-12（前）', ym: '2026-12', from: NAME.E5 });
  const { imp: imp2, item: item2, call: call2, key: key2 } = await setup({ approvals: [bp2] });
  await call2('E5', { action: 'submit', kind: 'budget', store_id: 'S1', client_key: key2(), payload: { ap_id: 'ap' + (T26 + 600), title: '予算 2026-12', ym: '2026-12', total_cents: 1 } });
  assert.deepEqual((await imp2('E2', [item2(bp2, { kind: 'budget', payload: { ym: '2026-12', total_cents: 9 } })])).body.items.map(x => x.result), ['known']);
});

test('the decided day is read in Hawaii time and from older records too (_stT, the id)', async () => {
  const late = AP(31, { status: 'approved', decidedAt: '2026-01-01T09:00:00.000Z' });   // ハワイでは 2025-12-31
  const st = AP(32, { status: 'rejected', _stT: Date.parse('2026-02-01T20:00:00Z') });
  const byId = AP(33, { id: 'ap' + Date.parse('2026-03-01T20:00:00Z'), status: 'withdrawn' });
  const oldId = AP(34, { id: 'ap' + T25, status: 'withdrawn' });
  const { imp, item } = await setup({ approvals: [late, st, byId, oldId] });
  assert.deepEqual((await imp('E2', [item(late), item(st), item(byId), item(oldId)])).body.items.map(x => x.result), ['old', 'history', 'history', 'old']);
});

test('split rows: the split copy of a record decides, as in the stage 1 copy (a pending copy left in the old combined row is not used, even with a newer mark)', async () => {
  const { pg, imp, item } = await setup({ approvals: [AP(41, { _mut: T26 + 99999 })] });
  await pg.exec('reset role');
  await pg.query(`insert into public.app_state(key, value) values ('spl_approvals_S1', $1::jsonb)`, [JSON.stringify([AP(41, { status: 'approved', decidedAt: '2026-10-25T19:00:00.000Z', _stT: T26 + 50, _mut: T26 + 50 })])]);
  await pg.exec('set role service_role');
  assert.deepEqual((await imp('E2', [item(AP(41))])).body.items.map(x => x.result), ['history']);
});
