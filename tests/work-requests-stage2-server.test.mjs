// v1155 work-requests 段階 2：予算と前の「承認」タブの種類（UI案72 の答え・Moto さん 11/13）。
// 本物の SQL（1 段目〜v1135＋段階 2・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, normPayload, S2_KINDS } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68'];
const S2 = M('20261120090000_work_requests_stage2');

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E12', 'Hal Head', 'sl', 'Store Manager', 'S2', null],
  ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function setup({ s2 = true, twice = false } = {}) {
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
  await pg.exec(S2); if (twice) await pg.exec(S2);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0, ap = 100000;
  const key = () => 'k-' + (++seq).toString().padStart(6, '0') + '-s2';
  const apId = () => 'ap17' + (++ap);
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  if (s2) {
    const w = (await call('E2', { action: 'whoami' })).body;
    const r = await call('E2', { action: 's2_save', s2: true, expect_rev: w.settings_rev });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const sub = (who, kind, store, payload = {}, extra = {}) => call(who, { action: 'submit', kind, store_id: store, client_key: extra.key || key(),
    payload: { ap_id: extra.ap || apId(), title: kind + ' の申請', from_name: NAME[who], ...payload } });
  const budget = (who, store, ym, total, extra = {}) => sub(who, 'budget', store, { ym, total_cents: total, days: { [ym + '-01']: Math.floor(total / 2), [ym + '-02']: total - Math.floor(total / 2) }, ...(extra.payload || {}) }, extra);
  const act = (who, r, op, body = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: body.rev ?? r.rev, client_key: body.key || key(), ...body });
  const applyAll = async (who, r, note = 'x') => { const k = key(); const st = (await act(who, r, 'apply_start', { key: k })).body; return act(who, st, 'apply_done', { claim: k, note }); };
  return { pg, db, call, key, apId, sub, budget, act, applyAll };
}

test('stage 2 starts only when the GM or CEO turns it on (after stage 1); before that the server refuses the new kinds', async () => {
  const { call, sub, pg } = await setup({ s2: false });
  assert.equal((await sub('E8', 'leave', 'S1')).status, 409, 'not live yet');
  const w = (await call('E2', { action: 'whoami' })).body;
  assert.equal(w.fn, 4); assert.equal(w.sql, 5); assert.equal(w.s2, false);
  assert.equal((await call('E5', { action: 's2_save', s2: true, expect_rev: w.settings_rev })).status, 403, 'an AM cannot turn it on');
  assert.equal((await call('E3', { action: 's2_save', s2: true, expect_rev: w.settings_rev })).status, 403, 'accounting cannot either');
  assert.equal((await call('E2', { action: 's2_save', s2: true, expect_rev: w.settings_rev + 5 })).status, 409, 'an old screen does not turn it on');
  assert.equal((await call('E2', { action: 's2_save', s2: 'yes', expect_rev: w.settings_rev })).status, 400);
  const on = (await call('E1', { action: 's2_save', s2: true, expect_rev: w.settings_rev })).body;
  assert.equal(on.s2, true);
  const live = (await pg.query(`select value from public.app_state where key = 'wr_live'`)).rows[0].value;
  assert.equal(live.s2, true, 'the shared row the app reads every login says stage 2 is on'); assert.equal(live.live, true);
  assert.equal((await sub('E8', 'leave', 'S1')).status, 200);
  // turning stage 1 off also turns stage 2 off for everyone
  const w2 = (await call('E2', { action: 'whoami' })).body;
  await call('E2', { action: 'settings_save', live: false, expect_rev: w2.settings_rev });
  assert.equal((await call('E2', { action: 'whoami' })).body.s2, false);
  assert.equal((await pg.query(`select value from public.app_state where key = 'wr_live'`)).rows[0].value.s2, false);
  assert.equal((await sub('E8', 'leave', 'S1')).status, 409);
  const w3 = (await call('E2', { action: 'whoami' })).body;
  assert.equal((await call('E2', { action: 's2_save', s2: true, expect_rev: w3.settings_rev })).status, 409, 'stage 2 cannot start while stage 1 is off');
  assert.equal((await call('E2', { action: 'whoami' })).body.s2, false);
});

test('leave at a store with an AM: the AM decides (7B: the GM sees it and can decide too); then the approver applies; accounting confirms', async () => {
  const { call, sub, act, applyAll } = await setup();
  const r = (await sub('E8', 'leave', 'S1', { facts: [{ k: '期間', v: '12/24〜12/26' }] })).body;
  assert.match(r.code, /^LV-\d{4}-0001$/); assert.equal(r.status, 'pending');
  assert.deepEqual(r.steps, ['am']); assert.equal(r.step, 'am');
  assert.deepEqual(r.next, { step: 'approve', who: 'am', gm_too: true });
  assert.deepEqual(r.can, ['withdraw'], 'the requester can only withdraw');
  assert.ok((await call('E5', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'the AM has it to do');
  assert.ok((await call('E2', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'the GM has it to do too (7B)');
  assert.ok(!(await call('E6', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === r.id), 'the store manager does not decide');
  assert.equal((await act('E6', r, 'approve')).status, 403);
  assert.equal((await act('E3', r, 'approve')).status, 403, 'accounting does not approve');
  assert.equal((await act('E5', r, 'reject')).status, 400, 'a reason is needed to reject');
  const a = (await act('E5', r, 'approve', { note: 'OK' })).body;
  assert.equal(a.status, 'approved'); assert.equal(a.signoffs.length, 1);
  assert.equal(a.signoffs[0].step, 'am'); assert.equal(a.signoffs[0].proxy, false); assert.equal(a.signoffs[0].by, NAME.E5);
  assert.deepEqual(a.next, { step: 'apply', who: 'am', name: NAME.E5 });
  assert.deepEqual(a.can, ['apply_start', 'reject'], 'the AM applies leave (decided at the AM step)');
  const done = (await applyAll('E5', a, '休暇を承認しました')).body;
  assert.equal(done.status, 'acct', 'leave goes on to accounting (6A: 確認完了)');
  assert.deepEqual(done.next, { step: 'check', who: 'acct' });
  assert.ok((await call('E3', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === done.id));
  assert.ok((await call('E13', { action: 'list', scope: 'todo' })).body.rows.some(x => x.id === done.id), 'office crew too');
  const c = (await act('E3', done, 'check')).body;
  assert.equal(c.status, 'done'); assert.equal(c.checked.by, NAME.E3);
  assert.deepEqual(c.can, ['undo']);
  const u = (await act('E3', c, 'undo')).body;
  assert.equal(u.status, 'acct');
  const open = (await call('E3', { action: 'list', scope: 'team', state: 'open' })).body;
  assert.ok(open.rows.some(x => x.id === r.id), 'waiting for accounting is still open'); assert.ok(open.counts.acct2 >= 1);
});

test('kinds with an AM step: AM then GM; the GM can approve at any step and the rest is recorded as done by the GM (2A + bulk)', async () => {
  const { sub, act, applyAll } = await setup();
  const s = (await sub('E8', 'shift', 'S1')).body;
  assert.deepEqual(s.steps, ['am', 'gm']); assert.equal(s.step, 'am');
  const a1 = (await act('E5', s, 'approve')).body;
  assert.equal(a1.status, 'pending'); assert.equal(a1.step, 'gm'); assert.deepEqual(a1.next, { step: 'approve', who: 'gm' });
  assert.equal((await act('E5', a1, 'approve')).status, 403, 'the AM is done; the GM step is the GM\'s');
  const a2 = (await act('E2', a1, 'approve')).body;
  assert.equal(a2.status, 'approved'); assert.deepEqual(a2.signoffs.map(x => [x.step, x.proxy]), [['am', false], ['gm', false]]);
  assert.equal((await act('E5', a2, 'apply_start')).status, 403, 'only the GM applies a shift change');
  const ap = (await applyAll('E2', a2)).body;
  assert.equal(ap.status, 'applied', 'a shift change ends when applied (6A: no accounting step)');
  assert.deepEqual(ap.can, []);

  const h = (await sub('E6', 'hire', 'S1', { target_name: 'New Person' })).body;
  assert.deepEqual(h.steps, ['am', 'gm']); assert.equal(h.target_name, 'New Person');
  const g = (await act('E2', h, 'approve')).body;
  assert.equal(g.status, 'approved', 'the GM approves before the AM (like the old 代理の全承認)');
  assert.deepEqual(g.signoffs.map(x => [x.step, x.proxy, x.by]), [['am', true, NAME.E2], ['gm', false, NAME.E2]]);
  assert.equal((await act('E5', g, 'approve')).status, 403);
});

test('a store without an AM (and the head office) goes straight to the GM; kinds without an AM step go to the GM', async () => {
  const { sub, act } = await setup();
  const h = (await sub('E12', 'hire', 'S2')).body;
  assert.deepEqual(h.steps, ['gm']); assert.equal(h.step, 'gm');
  const l = (await sub('E9', 'leave', 'S2')).body;
  assert.deepEqual(l.steps, ['gm']);
  assert.equal((await act('E5', l, 'approve')).status, 404, 'the AM of another store does not even see it');
  for (const kind of ['promo', 'prep', 'plan', 'budget']) {
    const r = (await sub('E6', kind, 'S1', kind === 'plan' || kind === 'budget' ? { ym: '2026-12', total_cents: 100 } : {})).body;
    assert.deepEqual(r.steps, ['gm'], kind);
    assert.equal((await act('E5', r, 'approve')).status, 403, kind + ' is the GM\'s');
  }
  const own = (await sub('E5', 'leave', 'S1')).body;
  assert.deepEqual(own.steps, ['gm'], 'the AM\'s own leave goes to the GM (the AM is not their own approver)');
  const hq = (await sub('E3', 'leave', '---')).body;
  assert.deepEqual(hq.steps, ['gm']);
});

test('who may submit where; nobody approves their own request', async () => {
  const { sub, act } = await setup();
  assert.equal((await sub('E9', 'leave', 'S1')).status, 403, 'a crew member of another store');
  assert.equal((await sub('E8', 'leave', 'S2')).status, 403);
  assert.equal((await sub('E8', 'leave', '---')).status, 200, 'the head office is open to everyone');
  assert.equal((await sub('E5', 'shift', 'S1')).status, 200, 'the AM for their store');
  assert.equal((await sub('E3', 'hire', 'S2')).status, 200, 'accounting anywhere');
  const p = (await sub('E2', 'plan', '---', { ym: '2026-12' })).body;
  assert.deepEqual(p.can, ['withdraw'], 'the GM cannot approve their own');
  assert.equal((await act('E2', p, 'approve')).status, 403);
  assert.equal((await act('E1', p, 'approve')).body.status, 'approved', 'the CEO can');
});

test('the same record of the old screen is one request (a resend, two devices)', async () => {
  const { sub, pg } = await setup();
  const a = (await sub('E8', 'leave', 'S1', {}, { ap: 'ap1700000001' })).body;
  const b = (await sub('E8', 'leave', 'S1', {}, { ap: 'ap1700000001' })).body;
  assert.equal(b.id, a.id); assert.equal(b.replay, true);
  // （Codex #149 P1）only the same person at the same store gets it back; nobody else learns what is in it
  const c = await sub('E5', 'leave', 'S1', {}, { ap: 'ap1700000001' });
  assert.equal(c.status, 409, 'another person sending the same old record is refused'); assert.equal(c.body.id, undefined);
  assert.equal((await pg.query(`select count(*)::int n from public.wr_requests where ap_id = 'ap1700000001'`)).rows[0].n, 1);
  const k = 'k-same-key-0001';
  const d1 = (await sub('E8', 'shift', 'S1', {}, { key: k })).body;
  const d2 = await sub('E8', 'shift', 'S1', {}, { key: k });
  assert.equal(d2.body.id, d1.id); assert.equal(d2.body.replay, true, 'the same tap twice');
  assert.equal((await sub('E8', 'leave', 'S1', {}, { key: k })).status, 409, 'the same key for another kind is refused');
});

test('budget: returned and resubmitted under the same number; approved, applied (予算反映済み) and confirmed; a change later is a new version of the same number', async () => {
  const { call, budget, act, applyAll, pg } = await setup();
  const r = (await budget('E6', 'S1', '2026-12', 9000000)).body;
  assert.match(r.code, /^BG-\d{4}-0001$/); assert.equal(r.amount_cents, 9000000); assert.equal(r.version, 1);
  assert.deepEqual(r.steps, ['gm']);
  const gmView = (await call('E2', { action: 'get', id: r.id })).body;
  assert.deepEqual(gmView.can, ['approve', 'return', 'reject']);
  assert.equal((await act('E2', r, 'return')).status, 400, 'a reason is needed to return');
  const rt = (await act('E2', r, 'return', { note: '12/31 が高すぎます' })).body;
  assert.equal(rt.status, 'returned'); assert.equal(rt.returned.reason, '12/31 が高すぎます');
  assert.deepEqual(rt.next, { step: 'fix', who: 'requester', name: NAME.E6 });
  const r2 = (await budget('E6', 'S1', '2026-12', 8500000)).body;
  assert.equal(r2.id, r.id); assert.equal(r2.code, r.code, 'the same number'); assert.equal(r2.version, 2); assert.equal(r2.status, 'pending');
  assert.equal(r2.returned.reason, '12/31 が高すぎます', 'the return is kept for the record');
  const a = (await act('E2', r2, 'approve')).body;
  assert.equal(a.status, 'approved');
  const ap = (await applyAll('E2', a, '予算を承認しました')).body;
  assert.equal(ap.status, 'acct', '6A: 予算反映済み comes from accounting');
  const c = (await act('E3', ap, 'check')).body;
  assert.equal(c.status, 'done');
  // 予算変更（4A）：承認したあとの版を変えられるのは GM・CEO（前の画面の「承認済みは GM 以上」・Codex #149 P2）
  assert.equal((await budget('E6', 'S1', '2026-12', 9300000)).status, 403, 'the store manager cannot change an approved budget');
  const r3 = (await budget('E2', 'S1', '2026-12', 9300000)).body;
  assert.equal(r3.id, r.id); assert.equal(r3.version, 3); assert.equal(r3.status, 'pending');
  assert.equal(r3.payload.prev_cents, 8500000, 'the applied amount of the version before'); assert.equal(r3.payload.prev_version, 2);
  assert.equal(r3.checked, null); assert.equal(r3.approved, null); assert.deepEqual(r3.signoffs, []);
  const full = (await call('E2', { action: 'get', id: r.id })).body;
  assert.deepEqual(full.versions.map(v => [v.version, v.amount_cents]), [[1, 9000000], [2, 8500000], [3, 9300000]]);
  assert.equal(full.versions[2].note, '予算変更');
  assert.deepEqual(full.events.map(e => e.action), ['submit', 'return', 'resubmit', 'approve', 'apply_start', 'apply_done', 'check', 'revise']);
  // a second change before the first change is applied keeps the same prev
  const r4 = (await budget('E6', 'S1', '2026-12', 9400000)).body;
  assert.equal(r4.version, 4); assert.equal(r4.payload.prev_cents, 8500000); assert.equal(r4.payload.prev_version, 2);
  assert.equal((await pg.query(`select count(*)::int n from public.wr_requests where kind = 'budget'`)).rows[0].n, 1, 'one request for the store and month');
  const other = (await budget('E6', 'S1', '2027-01', 100)).body;
  assert.notEqual(other.id, r.id, 'another month is another request');
});

test('budget: no new version while the GM is applying (claimed); after the claim ends it is accepted', async () => {
  const { budget, act, key } = await setup();
  const r = (await budget('E6', 'S1', '2026-12', 1000)).body;
  const a = (await act('E2', r, 'approve')).body;
  const k = key();
  const st = (await act('E2', a, 'apply_start', { key: k })).body;
  assert.equal((await budget('E1', 'S1', '2026-12', 2000)).status, 409, 'wait while the approved version is being applied');
  const cancel = (await act('E2', st, 'apply_cancel', { claim: k })).body;
  assert.equal(cancel.status, 'approved');
  assert.equal((await budget('E6', 'S1', '2026-12', 2000)).status, 403, 'an approved version is changed by the GM or CEO only');
  const r2 = (await budget('E1', 'S1', '2026-12', 2000)).body;
  assert.equal(r2.status, 'pending'); assert.equal(r2.version, 2);
  assert.equal(r2.payload.prev_cents, undefined, 'nothing was applied yet');
});

test('(Codex #149 P1) a resend of the same old record returns it only to the same person at the same store', async () => {
  const { call, sub, pg } = await setup();
  const ap = 'ap1700000999';
  const own = (await sub('E12', 'resign', 'S2', { detail: 'secret reason', facts: [{ k: '理由', v: 'secret reason' }] }, { ap })).body;
  assert.equal(own.store_id, 'S2');
  // another store: a crew member of S1 guesses the id
  const o1 = await sub('E8', 'resign', 'S1', {}, { ap });
  assert.equal(o1.status, 409); assert.doesNotMatch(JSON.stringify(o1.body), /secret|S2|Hal Head|RS-/);
  // the same store, not the owner (a crew member at S2), and even naming the store of the request
  const o2 = await sub('E9', 'resign', 'S2', {}, { ap });
  assert.equal(o2.status, 409); assert.doesNotMatch(JSON.stringify(o2.body), /secret|Hal Head|RS-/);
  assert.equal((await call('E9', { action: 'get', id: own.id })).status, 404, 'the crew member cannot read it either');
  // the owner naming another store is refused too (the store is part of the resend)
  assert.equal((await sub('E12', 'resign', 'S1', {}, { ap })).status, 403, 'not their store');
  const o3 = await sub('E12', 'resign', '---', {}, { ap });
  assert.equal(o3.status, 409, 'the owner sending it as the head office is not the same request');
  // the owner at the same store gets the same request back
  const again = await sub('E12', 'resign', 'S2', {}, { ap });
  assert.equal(again.status, 200); assert.equal(again.body.id, own.id); assert.equal(again.body.replay, true);
  assert.equal((await pg.query(`select count(*)::int n from public.wr_requests where ap_id = $1`, [ap])).rows[0].n, 1);
  // the same tap (same key) at another store is refused as well
  const k = 'k-same-key-0099';
  const t1 = (await sub('E5', 'shift', 'S1', {}, { key: k })).body;
  assert.equal(t1.store_id, 'S1');
  assert.equal((await sub('E5', 'shift', '---', {}, { key: k })).status, 409, 'the same key for another store');
});

test('(Codex #149 P2) who may submit a budget follows the old budget screen; an approved version is changed by the GM or CEO only', async () => {
  const { budget, act, call, applyAll } = await setup();
  assert.equal((await budget('E8', 'S1', '2026-12', 100)).status, 403, 'crew cannot submit a budget');
  assert.equal((await budget('E13', 'S1', '2026-12', 100)).status, 403, 'office crew cannot either (not on the old budget screen)');
  const r = (await budget('E6', 'S1', '2026-12', 5000000)).body;   // the store manager
  assert.equal(r.status, 'pending');
  assert.equal((await budget('E8', 'S1', '2026-12', 1)).status, 403, 'crew cannot make a new version of a waiting budget');
  const a = (await act('E2', r, 'approve')).body;
  assert.equal(a.status, 'approved');
  for (const who of ['E8', 'E7', 'E6', 'E5', 'E3']) assert.equal((await budget(who, 'S1', '2026-12', 1)).status, 403, who + ' cannot change an approved budget');
  let now = (await call('E2', { action: 'get', id: r.id })).body;
  assert.equal(now.status, 'approved'); assert.equal(now.version, 1); assert.equal(now.requester_name, 'Sam Store'); assert.equal(Number(now.amount_cents), 5000000);
  assert.ok([403, 404].includes((await act('E8', now, 'withdraw')).status), 'and cannot withdraw it (crew do not even see it)');
  assert.ok([403, 404].includes((await act('E7', now, 'withdraw')).status), 'a leader who did not send it cannot withdraw it');
  assert.equal((await act('E5', now, 'withdraw')).status, 403, 'the AM sees it but cannot withdraw it');
  // applied, waiting for accounting, done: still the GM or CEO only
  const ap = (await applyAll('E2', now)).body;
  assert.equal(ap.status, 'acct');
  assert.equal((await budget('E6', 'S1', '2026-12', 1)).status, 403);
  const c = (await budget('E1', 'S1', '2026-12', 5100000)).body;
  assert.equal(c.status, 'pending'); assert.equal(c.version, 2); assert.equal(c.requester_name, 'Cora CEO');
  // a waiting (not approved) version: the store side (G3 and up, AM, accounting) may send a new one, crew may not
  assert.equal((await budget('E8', 'S1', '2026-12', 1)).status, 403);
  const d = (await budget('E5', 'S1', '2026-12', 5200000)).body;
  assert.equal(d.version, 3); assert.equal(d.requester_name, 'Ami Area');
  const rt = (await act('E2', d, 'return', { note: 'もう少し' })).body;
  assert.equal(rt.status, 'returned');
  assert.equal((await budget('E8', 'S1', '2026-12', 1)).status, 403, 'crew cannot resubmit a returned budget');
  const e = (await budget('E6', 'S1', '2026-12', 5300000)).body;
  assert.equal(e.status, 'pending'); assert.equal(e.version, 4);
  // other kinds are unchanged: crew still send their own leave and shift
  assert.equal((await call('E8', { action: 'submit', kind: 'leave', store_id: 'S1', client_key: 'k-crew-leave-1', payload: { ap_id: 'ap1700000777', title: 't' } })).status, 200);
});

test('the AM step needs the GM-checked copy and the store table to agree (the employee and store tables only narrow)', async () => {
  const { sub, pg } = await setup();
  const as = sql => pg.exec('reset role; ' + sql + '; set role service_role');
  await as(`update public.stores set am = 'Someone Else' where id = 'S1'`);
  assert.deepEqual((await sub('E8', 'leave', 'S1')).body.steps, ['gm'], 'the store table names another AM');
  await as(`update public.stores set am = 'Ami Area' where id = 'S1'; update public.wr_people set role = 'staff' where emp_id = 'E5'`);
  assert.deepEqual((await sub('E8', 'shift', 'S1')).body.steps, ['gm'], 'the checked copy no longer says AM (even with the store in it)');
  await as(`update public.wr_people set role = 'am' where emp_id = 'E5'`);
  assert.deepEqual((await sub('E8', 'shift', 'S1')).body.steps, ['am', 'gm']);
});

test('only budgets are returned; the claim is the applier\'s; a stale screen and a wrong claim are refused; accounting does not check their own', async () => {
  const { call, sub, act, key, applyAll } = await setup();
  const l = (await sub('E8', 'leave', 'S1')).body;
  const gmL = (await call('E2', { action: 'get', id: l.id })).body;
  assert.ok(!gmL.can.includes('return')); assert.equal((await act('E2', l, 'return', { note: 'x' })).status, 403, 'only a budget is returned');
  const s = (await sub('E8', 'shift', 'S1')).body;
  assert.equal((await act('E2', s, 'approve', { rev: s.rev + 1 })).status, 409, 'an old screen (another rev)');
  const a = (await act('E2', s, 'approve')).body;
  const k = key();
  const st = (await act('E2', a, 'apply_start', { key: k })).body;
  const ceo = (await call('E1', { action: 'get', id: s.id })).body;
  assert.deepEqual(ceo.can, [], 'while the GM is applying, the CEO waits (no second claim, no reject, no done)');
  assert.equal((await act('E1', st, 'apply_start')).status, 403);
  assert.equal((await act('E1', st, 'apply_done', { claim: k })).status, 403, 'even with the key, only the device that claimed it');
  assert.equal((await act('E2', st, 'apply_done', { claim: 'k-not-the-claim-01' })).status, 409, 'a wrong claim');
  const still = (await call('E2', { action: 'get', id: s.id })).body;
  assert.equal(still.status, 'approved'); assert.deepEqual(still.can, ['apply_done', 'apply_fail', 'apply_cancel']);
  assert.equal((await act('E2', still, 'apply_done', { claim: k })).body.status, 'applied');
  // accounting's own request is checked by someone else
  const h = (await sub('E3', 'hire', '---')).body;
  const done = (await applyAll('E2', (await act('E2', h, 'approve')).body)).body;
  assert.equal(done.status, 'acct');
  assert.deepEqual((await call('E3', { action: 'get', id: h.id })).body.can, []);
  assert.equal((await act('E3', done, 'check')).status, 403, 'not their own');
  assert.equal((await act('E13', done, 'check')).body.status, 'done', 'office crew checks it');
});

test('withdraw by the requester only, before a decision', async () => {
  const { sub, act } = await setup();
  const r = (await sub('E8', 'leave', 'S1')).body;
  assert.equal((await act('E5', r, 'withdraw')).status, 403);
  const w = (await act('E8', r, 'withdraw', { note: '前の画面で取り下げ' })).body;
  assert.equal(w.status, 'withdrawn'); assert.deepEqual(w.can, []);
  const r2 = (await sub('E8', 'leave', 'S1')).body;
  const a = (await act('E5', r2, 'approve')).body;
  assert.equal((await act('E8', a, 'withdraw')).status, 403, 'not after it is approved');
});

test('reject at any step, and reject an approved one before it is applied', async () => {
  const { sub, act, applyAll } = await setup();
  const r = (await sub('E8', 'resign', 'S1', { target_name: 'Cam Crew' })).body;
  const a1 = (await act('E5', r, 'approve')).body;
  const rj = (await act('E2', a1, 'reject', { note: '日付を確かめて' })).body;
  assert.equal(rj.status, 'rejected'); assert.equal(rj.closed.reason, '日付を確かめて'); assert.equal(rj.step, null);
  const r2 = (await sub('E8', 'skill_self', 'S1')).body;
  const ok = (await act('E2', r2, 'approve')).body;
  const rj2 = (await act('E2', ok, 'reject', { note: 'やめる' })).body;
  assert.equal(rj2.status, 'rejected');
  const r3 = (await sub('E8', 'tip_self', 'S1')).body;
  const ok3 = (await applyAll('E2', (await act('E2', r3, 'approve')).body)).body;
  assert.equal(ok3.status, 'acct');
  assert.equal((await act('E2', ok3, 'reject', { note: 'x' })).status, 403, 'not after it is applied');
});

test('the shape is checked by the function and again by the SQL', async () => {
  const { sub, budget, db, key } = await setup();
  assert.equal((await sub('E8', 'leave', 'S1', {}, { ap: 'not-an-id' })).status, 400);
  assert.equal((await sub('E8', 'leave', 'S1', { title: '' })).status, 400);
  assert.equal((await sub('E8', 'leave', 'S1', { title: 'x'.repeat(201) })).status, 400);
  assert.equal((await sub('E6', 'plan', 'S1', { ym: null })).status, 400, 'a plan needs its month');
  assert.equal((await sub('E6', 'budget', 'S1', { ym: '2026-12' })).status, 400, 'a budget needs its total');
  assert.equal((await budget('E6', 'S1', '2026-12', -5)).status, 400);
  assert.equal((await budget('E6', 'S1', '2026-12', 100, { payload: { days: { '2027-01-01': 100 } } })).status, 400, 'a day outside the month');
  assert.equal((await sub('E8', 'leave', 'S1', { facts: [{ k: '', v: 'x' }] })).status, 400);
  assert.equal((await sub('E8', 'leave', 'S1', { facts: Array.from({ length: 13 }, (_, i) => ({ k: 'k' + i, v: 'v' })) })).status, 400);
  // a budget is sent by the store manager (crew may not send budgets: Codex #149 P2)
  const sql = (kind, payload) => { const who = kind === 'budget' ? 'E6' : 'E8'; return db.rpc('wr_submit', { emp_id: who, name: NAME[who], kind, store_id: 'S1', client_key: key(), payload }).then(() => 'ok', e => e.message); };
  assert.match(await sql('leave', { ap_id: 'bad', title: 't' }), /bad_value/);
  assert.match(await sql('leave', { ap_id: 'ap1700009999' }), /bad_value/);
  assert.match(await sql('budget', { ap_id: 'ap1700009998', title: 't', ym: '2026-12', total_cents: 'a lot' }), /bad_value/);
  assert.match(await sql('budget', { ap_id: 'ap1700009997', title: 't', ym: '2026-12', total_cents: 5, days: { '2026-11-30': 5 } }), /bad_value/);
  assert.match(await sql('budget', { ap_id: 'ap1700009995', title: 't', total_cents: 5 }), /bad_value/, 'the SQL wants the month of a budget');
  assert.match(await sql('plan', { ap_id: 'ap1700009994', title: 't' }), /bad_value/, 'and of a plan');
  assert.match(await sql('budget', { ap_id: 'ap1700009993', title: 't', ym: '2026-12', total_cents: -5 }), /bad_value/, 'no minus total');
  assert.match(await sql('budget', { ap_id: 'ap1700009992', title: 't', ym: '2026-12', total_cents: 100000000001 }), /bad_value/, 'not too large');
  // （Claude #149 P3）a decimal is bad_value, not a cast error; the days must be whole cents in range
  assert.match(await sql('budget', { ap_id: 'ap1700009991', title: 't', ym: '2026-12', total_cents: 12.5 }), /bad_value/, 'a decimal total');
  assert.match(await sql('budget', { ap_id: 'ap1700009990', title: 't', ym: '2026-12', total_cents: 5, days: { '2026-12-01': 2.5 } }), /bad_value/, 'a decimal day');
  assert.match(await sql('budget', { ap_id: 'ap1700009989', title: 't', ym: '2026-12', total_cents: 5, days: { '2026-12-01': -1 } }), /bad_value/, 'a minus day');
  assert.match(await sql('budget', { ap_id: 'ap1700009988', title: 't', ym: '2026-12', total_cents: 5, days: { '2026-12-01': 10000000001 } }), /bad_value/, 'a day too large');
  assert.doesNotMatch(await sql('budget', { ap_id: 'ap1700009987', title: 't', ym: '2026-12', total_cents: 5, days: { '2026-12-01': 5 } }), /bad_value/, 'whole cents pass');
  assert.equal(await sql('leave', { ap_id: 'ap1700009996', title: 't' }), 'ok');
  // the function keeps only known fields
  const n = normPayload('leave', { ap_id: 'ap1700000123', title: 't', evil: '<script>', ref: 'vac17000', facts: [{ k: '期間', v: 'x', z: 1 }] });
  assert.deepEqual(Object.keys(n).sort(), ['ap_id', 'detail', 'facts', 'from_name', 'ref', 'store_name', 'target_name', 'title']);
  assert.deepEqual(n.facts, [{ k: '期間', v: 'x' }]);
  assert.equal(normPayload('leave', { ap_id: 'ap1700000123', title: 't', ref: "x');(" }).ref, undefined, 'an odd ref is dropped');
  assert.deepEqual(S2_KINDS, ['budget', 'leave', 'shift', 'hire', 'resign', 'promo', 'tip_self', 'skill_self', 'prep', 'plan']);
});

test('stage 1 and the evaluation changes still go their own way (the dispatchers send the new kinds first)', async () => {
  const { call, key, act } = await setup();
  const x = (await call('E6', { action: 'submit', kind: 'expense_pre', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-10', purpose: '会食', total_cents: 5000 } })).body;
  assert.match(x.code, /^EX-/); assert.equal(x.steps, null); assert.equal(x.ap_id, null);
  const a = (await act('E2', x, 'approve')).body;
  assert.equal(a.status, 'approved'); assert.deepEqual(a.next, { step: 'check', who: 'acct' });
});

test('the SQL runs twice the same; it stops before stage 1; only the server key may call the functions', async () => {
  const { pg, sub } = await setup({ twice: true });
  assert.equal((await sub('E8', 'leave', 'S1')).status, 200);
  const st = (await pg.query(`select public.wr_stage('{}'::jsonb) v`)).rows[0].v;
  assert.equal(st.stage, 5);
  await pg.exec('reset role');
  const g = (await pg.query(`select has_function_privilege('anon', 'public.wr_submit_s2(jsonb)', 'execute') a, has_function_privilege('authenticated', 'public.wr_act_s2(jsonb)', 'execute') b,
    has_function_privilege('service_role', 'public.wr_s2_save(jsonb)', 'execute') c`)).rows[0];
  assert.deepEqual(g, { a: false, b: false, c: true });
  const fresh = new PGlite();
  await fresh.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(fresh.exec(S2), /STOP/);
});
