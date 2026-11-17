// v1184：経費の申請の権限（Moto さんの依頼 11/16 の 3）。事務Crew は初期値でガソリン代・立替経費・ほかの G1 は人ごとに ON／OFF・GM・CEO だけが変える・変更の記録。
// 本物の SQL（work-requests の本番の順・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/THREE_FIXES_V1184_JA.md の 3
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2', '20261126090000_wr_approve_v1165'];
export const GRANTS = M('20261204090000_wr_exp_grants');
const PEOPLE = [   // [id, 名前, 社員の表の役割, 肩書き, 店, manager_auth, 状態]
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'],   // 事務Crew（メールのアカウントもある）
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Mia Four', 'g4', 'Store Manager', 'S1', null],
  ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null], ['E9', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E10', 'Pia Prep', 'crew', 'Prep', 'S2', null],
  ['E12', 'Hana Hq', 'office_crew', 'Office Crew', 'OFFICE', null],   // 本部所属の事務Crew（PIN だけ。今まで何も出せなかった）
  ['E13', 'Sora Staff', 'crew', 'Office Staff', 'S1', null],            // 肩書きが Office Staff（事務Crew）・店に所属
  ['E14', 'Nao None', 'office_crew', 'Office Crew', '', null],           // 事務Crew・所属が空
  ['E15', 'Rei Ret', 'crew', 'Crew', 'S1', null, '退職'],
  ['E16', 'Kei Clerk', 'office', '', 'OFFICE', 'office'],               // 経理（メール）・肩書きなし＝G1 相当：今までどおり立替経費だけ
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const ALL = ['mileage', 'reimburse', 'expense_pre'];

export async function setup({ grants = true } = {}) {
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
  for (const [id, name, role, title, store, ma, st] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]',$6,$7)`, [id, name, role, title, store, st || '在籍', JSON.stringify({ name, status: st || '在籍' })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (grants) await pg.exec(GRANTS);
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const today = new Date().toISOString().slice(0, 10);
  const PAY = { mileage: { date: today, purpose: '買い出し', origin: 'A', destination: 'B', one_way_miles: 10, round_trip: false },
    reimburse: { date: today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 8000 },
    expense_pre: { date: today, purpose: 'Team dinner', total_cents: 10000 } };
  const pay = kind => { ++seq; const p = { ...PAY[kind] };
    if (kind === 'mileage') p.one_way_miles = 10 + seq / 10; if (kind === 'reimburse') p.amount_cents = 8000 + seq; if (kind === 'expense_pre') p.total_cents = 10000 + seq; return p; };
  const key = () => 'k-' + (++seq).toString().padStart(8, '0');
  const submit = (who, kind, store = 'S1', k = key()) => call(who, { action: 'submit', kind, store_id: store, client_key: k, payload: pay(kind) });
  const kinds = async who => (await call(who, { action: 'whoami' })).body.exp_kinds;
  const list = async () => (await call('E2', { action: 'exp_grant_list' })).body;
  const row = async emp => (await list()).rows.find(r => r.emp === emp);
  const save = async (by, target, mileage, reimburse, extra = {}) => {
    const r = await row(target);
    return call(by, { action: 'exp_grant_save', target, mileage, reimburse, expect_rev: r ? r.rev : 0, ...extra });
  };
  // GM・CEO が「事務Crew と確かめる」（保存済みの ON／OFF はそのまま）。Codex #182 の P1：従業員マスターだけでは事務Crew にしない
  const crew = async (target, on = true, by = 'E2') => {
    const r = await row(target);
    return call(by, { action: 'exp_grant_save', target, mileage: r.mileage.set, reimburse: r.reimburse.set, crew: on ? true : null, expect_rev: r.rev });
  };
  // 公開の鍵（anon）で社員の表を書き換える（本番でも公開の鍵で書ける＝前から）
  const asAnon = async sql => { await pg.exec('reset role; set role anon'); try { await pg.exec(sql); } finally { await pg.exec('reset role; set role service_role'); } };
  return { pg, db, call, submit, kinds, list, row, save, crew, asAnon, pay, key };
}

test('v1184 office crew can send mileage and reimbursement by default (email account, or GM/CEO confirmed + still office crew in the master); other G1 nothing; G2+ unchanged', async () => {
  const s = await setup();
  const want = { E1: ALL, E2: ALL, E3: ALL, E5: ALL, E6: ALL, E8: ALL,
    E4: ['mileage', 'reimburse'], E12: [], E13: [], E14: [],   // 事務Crew のメールのアカウント（E4）はそのまま・従業員マスターだけの事務Crew は確かめ待ち
    E9: [], E10: [], E16: ['reimburse'] };
  for (const [who, k] of Object.entries(want)) assert.deepEqual(await s.kinds(who), k, who + ' ' + NAME[who]);
  for (const who of ['E12', 'E13', 'E14']) {
    assert.equal((await s.call(who, { action: 'whoami' })).body.exp_base, 'crew_wait', who);
    assert.equal((await s.crew(who)).status, 200, who);
    assert.deepEqual(await s.kinds(who), ['mileage', 'reimburse'], who + ' after the GM confirmed');
    assert.equal((await s.call(who, { action: 'whoami' })).body.exp_base, 'office_crew', who);
  }
  assert.equal((await s.call('E4', { action: 'whoami' })).body.exp_base, 'office_crew');
  assert.equal((await s.call('E9', { action: 'whoami' })).body.exp_base, 'g1');
  // 名前では決めない：G1 の Crew の名前を事務Crew と同じにしても出せない
  await s.pg.exec(`reset role; update employees set name = 'Hana Hq' where id = 'E9'; set role service_role`);
  assert.deepEqual(await s.kinds('E9'), []);
});

test('v1184 HQ office crew (PIN only) sends each kind from HQ; it shows in their own list and in the GM approval queue; no store is assigned; pre-approval is still refused', async () => {
  const s = await setup();
  for (const who of ['E12', 'E13', 'E14']) assert.equal((await s.crew(who)).status, 200);
  const w = (await s.call('E12', { action: 'whoami' })).body;
  assert.equal(w.exp_hq, true); assert.equal(w.exp_grants, true); assert.equal(w.fn, 12);
  const a = await s.submit('E12', 'mileage', '---');
  const b = await s.submit('E12', 'reimburse', 'OFFICE');
  assert.deepEqual([a.status, a.body.status, a.body.store_id, a.body.requester_emp], [200, 'pending', '---', 'E12']);
  assert.deepEqual([b.status, b.body.status, b.body.store_id], [200, 'pending', 'OFFICE']);
  assert.deepEqual([(await s.submit('E12', 'expense_pre', '---')).body.error], ['no_exp_right']);
  // 本部以外の店には出せない（店に自動で割り当てない・所属の店だけ）
  assert.equal((await s.submit('E12', 'reimburse', 'S1')).status, 403);
  const mine = (await s.call('E12', { action: 'list', scope: 'mine', state: 'all', limit: 50 })).body.rows;
  assert.deepEqual(mine.map(r => r.code).sort(), [a.body.code, b.body.code].sort());
  const todo = (await s.call('E2', { action: 'list', scope: 'todo', state: 'open', limit: 50 })).body.rows;
  for (const r of [a.body, b.body]) { const t = todo.find(x => x.code === r.code); assert.ok(t, 'GM sees ' + r.code); assert.ok(t.can.includes('approve')); }
  // 事務Crew は承認できない（権限は足さない）
  const ap = await s.call('E12', { action: 'act', id: a.body.id, op: 'approve', expect_rev: a.body.rev, client_key: s.key() });
  assert.equal(ap.status, 403);
  // 所属が空の事務Crew は本部（---）で出せる・店の事務Crew は所属の店で
  assert.equal((await s.submit('E14', 'reimburse', '---')).status, 200);
  assert.equal((await s.submit('E13', 'mileage', 'S1')).status, 200);
  assert.equal((await s.submit('E13', 'mileage', '---')).status, 403);
});

test('v1184 other G1: both, mileage only, reimbursement only, none; changing the kind of a request is refused; the GM must set each person', async () => {
  const s = await setup();
  assert.deepEqual((await s.submit('E9', 'mileage')).body.error, 'no_exp_right');
  assert.equal((await s.save('E2', 'E9', true, null)).status, 200);
  assert.deepEqual(await s.kinds('E9'), ['mileage']);
  assert.equal((await s.submit('E9', 'mileage')).status, 200);
  // ガソリン代だけの人が種類を立替経費に変えて送る（API を直接）：断る
  assert.deepEqual([(await s.submit('E9', 'reimburse')).status, (await s.submit('E9', 'reimburse')).body.error], [403, 'no_exp_right']);
  assert.equal((await s.save('E1', 'E9', false, true)).status, 200);   // CEO も変えられる
  assert.deepEqual(await s.kinds('E9'), ['reimburse']);
  assert.deepEqual((await s.submit('E9', 'mileage')).body.error, 'no_exp_right');
  assert.equal((await s.save('E2', 'E9', true, true)).status, 200);
  assert.deepEqual(await s.kinds('E9'), ['mileage', 'reimburse']);
  assert.equal((await s.save('E2', 'E9', null, null)).status, 200);   // 初期値に戻す＝G1 は OFF
  assert.deepEqual(await s.kinds('E9'), []);
  // ほかの G1（E10）は変わらない（人ごと）
  assert.deepEqual(await s.kinds('E10'), []);
});

test('v1184 an explicit OFF for office crew stays OFF (not restored by the default); back to default only when the GM picks it', async () => {
  const s = await setup();
  assert.equal((await s.crew('E12')).status, 200);
  assert.equal((await s.save('E2', 'E12', false, null)).status, 200);
  for (let i = 0; i < 2; i++) assert.deepEqual(await s.kinds('E12'), ['reimburse']);
  const r = await s.row('E12');
  assert.deepEqual([r.mileage.set, r.mileage.def, r.mileage.eff, r.reimburse.set, r.reimburse.eff], [false, true, false, null, true]);
  // 区分が変わっても（ほかの店へ異動）明示の OFF のまま
  await s.pg.exec(`reset role; update employees set store = 'S2' where id = 'E12'; set role service_role`);
  assert.deepEqual(await s.kinds('E12'), ['reimburse']);
  assert.equal((await s.save('E2', 'E12', null, null)).status, 200);
  assert.deepEqual(await s.kinds('E12'), ['mileage', 'reimburse']);
});

test('v1184 revoking blocks new requests and re-sending a returned one (open screens and other devices too); withdrawing still works; the records stay; a re-sent key is still one request', async () => {
  const s = await setup();
  assert.equal((await s.crew('E12')).status, 200);
  const k1 = s.key();
  const p1 = s.pay('reimburse');
  const one = await s.call('E12', { action: 'submit', kind: 'reimburse', store_id: '---', client_key: k1, payload: p1 });
  assert.equal(one.status, 200);
  // 二度押し・通信の送り直し：同じ鍵は 1 件だけ（前の答え）
  const again = await s.call('E12', { action: 'submit', kind: 'reimburse', store_id: '---', client_key: k1, payload: p1 });
  assert.deepEqual([again.status, again.body.code, again.body.replay], [200, one.body.code, true]);
  const two = (await s.submit('E12', 'mileage', '---')).body;
  // GM が差し戻す
  const ret = await s.call('E2', { action: 'act', id: one.body.id, op: 'return', note: '領収書を付けて', expect_rev: one.body.rev, client_key: s.key() });
  assert.equal(ret.body.status, 'returned');
  // GM が取り消す（両方 OFF）
  assert.equal((await s.save('E2', 'E12', false, false)).status, 200);
  assert.deepEqual(await s.kinds('E12'), []);
  // 開いていた画面からの出し直し・直す・新しい申請：断る
  const rs = await s.call('E12', { action: 'act', id: one.body.id, op: 'resubmit', kind: 'reimburse', payload: s.pay('reimburse'), expect_rev: ret.body.rev, client_key: s.key() });
  assert.deepEqual([rs.status, rs.body.error], [403, 'no_exp_right']);
  const ed = await s.call('E12', { action: 'act', id: two.id, op: 'edit', kind: 'mileage', payload: s.pay('mileage'), expect_rev: two.rev, client_key: s.key() });
  assert.deepEqual([ed.status, ed.body.error], [403, 'no_exp_right']);
  assert.deepEqual((await s.submit('E12', 'reimburse', '---')).body.error, 'no_exp_right');
  // 取り消す前に送れた鍵の送り直しは前の答え（増えない）
  assert.equal((await s.call('E12', { action: 'submit', kind: 'reimburse', store_id: '---', client_key: k1, payload: p1 })).body.replay, true);
  // 取り下げはできる・記録は残る
  const wd = await s.call('E12', { action: 'act', id: two.id, op: 'withdraw', expect_rev: two.rev, client_key: s.key() });
  assert.equal(wd.body.status, 'withdrawn');
  const mine = (await s.call('E12', { action: 'list', scope: 'mine', state: 'all', limit: 50 })).body.rows;
  assert.deepEqual(mine.map(r => [r.code, r.status]).sort(), [[one.body.code, 'returned'], [two.code, 'withdrawn']].sort());
  const n = (await s.pg.query('select count(*)::int n from wr_requests')).rows[0].n;
  assert.equal(n, 2);
  // 戻すと出し直せる
  assert.equal((await s.save('E2', 'E12', null, null)).status, 200);
  const rs2 = await s.call('E12', { action: 'act', id: one.body.id, op: 'resubmit', kind: 'reimburse', payload: s.pay('reimburse'), expect_rev: ret.body.rev, client_key: s.key() });
  assert.equal(rs2.body.status, 'pending');
});

test('v1184 only GM and CEO can list or change; targets are G1 only; same values twice add nothing; a stale screen is refused; every change is logged (who, whose, which, when)', async () => {
  const s = await setup();
  for (const who of ['E3', 'E4', 'E5', 'E6', 'E8', 'E9', 'E12', 'E16']) {
    assert.deepEqual([(await s.call(who, { action: 'exp_grant_list' })).status, (await s.call(who, { action: 'exp_grant_list' })).body.error], [403, 'forbidden'], who);
    assert.equal((await s.call(who, { action: 'exp_grant_save', target: 'E9', mileage: true, reimburse: null, expect_rev: 0 })).status, 403, who);
  }
  const l = await s.list();
  assert.deepEqual(l.rows.map(r => r.emp).sort(), ['E10', 'E12', 'E13', 'E14', 'E16', 'E4', 'E9'].sort());   // 退職（E15）・G2 以上は出ない
  // G2 以上・退職・いない人は変えられない
  assert.deepEqual([(await s.call('E2', { action: 'exp_grant_save', target: 'E8', mileage: false, reimburse: false, expect_rev: 0 })).body.error], ['bad_value']);
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: true, reimburse: true, expect_rev: 0 })).status, 404);
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E99', mileage: true, reimburse: true, expect_rev: 0 })).status, 404);
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E9', mileage: 'yes', reimburse: null, expect_rev: 0 })).status, 400);
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E9', reimburse: null, expect_rev: 0 })).status, 400);
  // 2 回押しても 1 回分
  const a1 = await s.call('E2', { action: 'exp_grant_save', target: 'E9', mileage: true, reimburse: null, expect_rev: 0, note: '配達の手伝い' });
  const a2 = await s.call('E2', { action: 'exp_grant_save', target: 'E9', mileage: true, reimburse: null, expect_rev: 0, note: '配達の手伝い' });
  assert.deepEqual([a1.status, a1.body.rev, a2.status, a2.body.rev, a2.body.same], [200, 1, 200, 1, true]);
  // 古い画面（rev 0 を見ていた）から違う値：断る（何も変えない）
  const st = await s.call('E1', { action: 'exp_grant_save', target: 'E9', mileage: false, reimburse: true, expect_rev: 0 });
  assert.deepEqual([st.status, st.body.error], [409, 'conflict']);
  assert.deepEqual(await s.kinds('E9'), ['mileage']);
  await s.save('E1', 'E9', true, true);
  const log = (await s.list()).log;
  assert.deepEqual(log.map(x => [x.emp, x.emp_name, x.kind, x.before_set, x.after_set, x.before_eff, x.after_eff, x.by_emp, x.by_name, x.by_role]), [
    ['E9', 'Cam Crew', 'reimburse', null, true, false, true, 'E1', 'Cora CEO', 'ceo'],
    ['E9', 'Cam Crew', 'mileage', null, true, false, true, 'E2', 'Gabe GM', 'gm']]);
  assert.equal(log[1].note, '配達の手伝い');
  for (const x of log) assert.ok(!Number.isNaN(Date.parse(x.at)));
  // 記録は消さない：初期値に戻しても前の記録は残る
  await s.save('E2', 'E9', null, null);
  assert.equal((await s.list()).log.length, 4);
});

test('v1184 G2+ ignore any grant row (existing rights are never removed by this setting)', async () => {
  const s = await setup();
  await s.pg.exec(`reset role; insert into wr_exp_grants(emp_id, mileage, reimburse) values ('E8', false, false), ('E6', false, false); set role service_role`);
  assert.deepEqual(await s.kinds('E8'), ALL);
  assert.deepEqual(await s.kinds('E6'), ALL);
  assert.equal((await s.submit('E8', 'mileage')).status, 200);
});

test('v1184 the SQL: stops before its prerequisites, runs twice keeping the settings, browser keys cannot call or read anything; old SQL answers grant_old', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await assert.rejects(pg.exec(GRANTS), /STOP: 先に経費の申請の SQL/);
  const s = await setup();
  await s.save('E2', 'E9', true, false);
  await s.pg.exec('reset role'); await s.pg.exec(GRANTS); await s.pg.exec(GRANTS); await s.pg.exec('set role service_role');
  assert.deepEqual(await s.kinds('E9'), ['mileage']);
  assert.equal((await s.list()).log.length, 2);
  await s.pg.exec('reset role');
  for (const f of ['wr_exp_kinds(jsonb)', 'wr_can_submit(jsonb,text,text)', 'wr_whoami(jsonb)', 'wr_exp_grant_list(jsonb)', 'wr_exp_grant_save(jsonb)', 'wr_exp_right(jsonb,text)',
    'wr_submit(jsonb)', 'wr_act(jsonb)', 'wr_exp_base(jsonb)', 'wr_exp_grant_row(text)']) for (const role of ['anon', 'authenticated'])
    assert.equal((await s.pg.query(`select has_function_privilege($1, $2, 'execute') v`, [role, 'public.' + f])).rows[0].v, false, role + ' ' + f);
  for (const t of ['wr_exp_grants', 'wr_exp_grant_log']) for (const role of ['anon', 'authenticated']) for (const pr of ['select', 'insert', 'update', 'delete'])
    assert.equal((await s.pg.query(`select has_table_privilege($1, $2, $3) v`, [role, 'public.' + t, pr])).rows[0].v, false, role + ' ' + t + ' ' + pr);
  const old = await setup({ grants: false });
  const w = (await old.call('E2', { action: 'whoami' })).body;
  assert.equal(w.exp_grants, undefined);
  assert.deepEqual([(await old.call('E2', { action: 'exp_grant_list' })).status, (await old.call('E2', { action: 'exp_grant_list' })).body.error], [503, 'grant_old']);
  // 前の SQL のままなら、PIN だけの事務Crew は今までどおり何も出せない（壊れない）
  assert.deepEqual(w.exp_kinds && (await old.kinds('E12')), []);
});

test('v1184 the function checks the values before SQL (bad target / not true-false-null / no expect_rev never reach SQL)', async () => {
  const seen = [];
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k],
    db: { async rpc(name, p) { seen.push(name); return name === 'wr_exp_grant_save' ? { ok: true } : {}; } },
    verifyPin: async tok => tok === 'pin-E2' ? { emp_id: 'E2', name: 'Gabe GM' } : null });
  const send = async b => (await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin_session: 'pin-E2', action: 'exp_grant_save', ...b }) }))).status;
  for (const b of [{ target: 'E9', mileage: 'yes', reimburse: null, expect_rev: 0 }, { target: 'E9', mileage: true, reimburse: 1, expect_rev: 0 },
    { target: 'bad id!', mileage: true, reimburse: true, expect_rev: 0 }, { target: 'E9', mileage: true, reimburse: true }, { mileage: true, reimburse: true, expect_rev: 0 },
    { target: 'E9', mileage: true, reimburse: true, expect_rev: 0, crew: false }, { target: 'E9', mileage: true, reimburse: true, expect_rev: 0, crew: 'yes' }, { target: 'E9', mileage: true, reimburse: true, expect_rev: 0, crew: 1 }]) {
    assert.equal(await send(b), 400, JSON.stringify(b));
  }
  assert.deepEqual(seen.filter(n => n === 'wr_exp_grant_save'), [], 'bad values never reach SQL');
  assert.equal(await send({ target: 'E9', mileage: false, reimburse: null, expect_rev: 0 }), 200);
  assert.deepEqual(seen.filter(n => n === 'wr_exp_grant_save'), ['wr_exp_grant_save']);
  // crew は送ったときだけ SQL に渡す（true か null）
  const sent = [];
  const h2 = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k],
    db: { async rpc(name, p) { if (name === 'wr_exp_grant_save') sent.push(p); return {}; } },
    verifyPin: async tok => tok === 'pin-E2' ? { emp_id: 'E2', name: 'Gabe GM' } : null });
  const send2 = async b => (await h2(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin_session: 'pin-E2', action: 'exp_grant_save', target: 'E9', mileage: null, reimburse: null, expect_rev: 0, ...b }) }))).status;
  assert.equal(await send2({}), 200); assert.equal(await send2({ crew: true }), 200); assert.equal(await send2({ crew: null }), 200);
  assert.deepEqual(sent.map(p => [Object.prototype.hasOwnProperty.call(p, 'crew'), p.crew]), [[false, undefined], [true, true], [true, null]]);
});

test('v1184 (Codex #182 P1) a G1 who writes their own role/title to office crew with the public key gets no rights; only a GM/CEO confirmation does, and it ends when the master stops saying office crew', async () => {
  const s = await setup();
  // Codex の再現：G1（E9）の肩書きだけを公開の鍵で Office Staff に（GM・CEO は何もしていない）
  await s.asAnon(`update employees set title = 'Office Staff' where id = 'E9'`);
  assert.deepEqual(await s.kinds('E9'), []);
  const sub = await s.submit('E9', 'mileage');
  assert.deepEqual([sub.status, sub.body.error], [403, 'no_exp_right']);
  // 役割（role）を office_crew にしても同じ（manager_auth は公開の鍵で書けない）
  await s.asAnon(`update employees set role = 'office_crew', title = 'Office Crew', store = '' where id = 'E10'`);
  assert.deepEqual(await s.kinds('E10'), []);
  assert.equal((await s.submit('E10', 'reimburse', '---')).status, 403);
  assert.equal((await s.call('E10', { action: 'whoami' })).body.exp_hq, false);
  // GM の一覧では「確かめ待ち」
  const r9 = await s.row('E9');
  assert.deepEqual([r9.base, r9.crew_master, r9.crew_ok, r9.mileage.def, r9.mileage.eff], ['crew_wait', true, false, false, false]);
  // GM が確かめる → 初期値で 2 種
  const c = await s.crew('E9');
  assert.deepEqual([c.status, c.body.base, c.body.crew_ok, c.body.mileage.eff, c.body.reimburse.eff], [200, 'office_crew', true, true, true]);
  assert.deepEqual(await s.kinds('E9'), ['mileage', 'reimburse']);
  assert.equal((await s.submit('E9', 'mileage')).status, 200);
  // 二度押し：同じ（記録も増えない）
  const c2 = await s.crew('E9');
  assert.deepEqual([c2.status, c2.body.same], [200, true]);
  // 確かめたあと、従業員マスターで事務Crew でなくなる → 初期値 OFF（確かめと今の従業員マスターの狭いほう）
  await s.pg.exec(`reset role; update employees set title = 'Crew' where id = 'E9'; set role service_role`);
  assert.deepEqual(await s.kinds('E9'), []);
  const r9b = await s.row('E9');
  assert.deepEqual([r9b.base, r9b.crew_master, r9b.crew_ok], ['g1', false, true]);
  // 事務Crew でない人は確かめられない（not_crew）・確かめを外すのはできる
  const nc = await s.crew('E10', true);   // E10 は今は事務Crew（上で書き換えた）なので通る
  assert.equal(nc.status, 200);
  await s.pg.exec(`reset role; update employees set role = 'crew', title = 'Prep', store = 'S2' where id = 'E10'; set role service_role`);
  const r10 = await s.row('E10');
  const nc2 = await s.call('E2', { action: 'exp_grant_save', target: 'E9', mileage: null, reimburse: null, crew: true, expect_rev: r9b.rev });
  assert.equal(nc2.status, 200, 'already confirmed: keeping the confirmation is allowed');
  const nc3 = await s.call('E2', { action: 'exp_grant_save', target: 'E16', mileage: null, reimburse: null, crew: true, expect_rev: 0 });
  assert.deepEqual([nc3.status, nc3.body.error], [409, 'not_crew']);
  assert.equal((await s.crew('E10', false)).status, 200);
  assert.deepEqual([(await s.row('E10')).crew_ok, r10.crew_ok], [false, true]);
  // ほかの値は断る（false・文字）
  for (const v of [false, 'yes', 1]) assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E13', mileage: null, reimburse: null, crew: v, expect_rev: 0 })).status, 400, String(v));
  // SQL も自分で断る（関数を通らない呼び出し・二重の守り）。false を「外す」と読まない
  for (const v of [false, 'yes', 1, {}]) await assert.rejects(s.pg.query(`select public.wr_exp_grant_save($1::jsonb)`, [JSON.stringify({ emp_id: 'E2', name: 'Gina GM', target: 'E9', mileage: null, reimburse: null, crew: v, expect_rev: (await s.row('E9')).rev })]), /bad_value/, JSON.stringify(v));
  assert.equal((await s.row('E9')).crew_ok, true, '断ったあとも確かめは残る');
  // 確かめ・外すは記録に残る（だれが・だれを・前後・実際に事務Crew か）。確かめで変わった「出せるか」も項目ごとに残る
  const log = (await s.list()).log.filter(x => x.emp === 'E9');
  assert.deepEqual(log.map(x => [x.kind, x.before_set, x.after_set, x.before_eff, x.after_eff, x.by_emp]), [
    ['reimburse', null, null, false, true, 'E2'], ['mileage', null, null, false, true, 'E2'], ['crew', null, true, false, true, 'E2']]);
  // GM・CEO 以外は確かめられない
  for (const who of ['E3', 'E4', 'E9', 'E12']) assert.equal((await s.call(who, { action: 'exp_grant_save', target: 'E13', mileage: null, reimburse: null, crew: true, expect_rev: 0 })).status, 403, who);
  // CEO も確かめられる・明示の OFF は確かめても OFF のまま
  assert.equal((await s.save('E2', 'E13', false, null)).status, 200);
  assert.equal((await s.crew('E13', true, 'E1')).status, 200);
  assert.deepEqual(await s.kinds('E13'), ['reimburse']);
});
