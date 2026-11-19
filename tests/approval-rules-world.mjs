// v1190 の試験の土台（承認ルールの試験と入れる一式の試験で使う）。本物の SQL（申請の本番の順＋20261209090000・PGlite）と本物の handler、合成データだけ。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

export const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
export const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
export const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2', '20261126090000_wr_approve_v1165', '20261127090000_chat_ui79', '20261128090000_chat_guard', '20261129090000_fixes_v1169', '20261204090000_wr_exp_grants'];
export const AR = process.env.AR_MUT_FILE ? fs.readFileSync(process.env.AR_MUT_FILE, 'utf8') : M('20261209090000_approval_rules');   // わざと壊す試験だけが使う
export const ROLLBACK = fs.readFileSync(new URL('../db/approval-rules-rollback.sql', import.meta.url), 'utf8');
export const PEOPLE = [   // [id, 名前, 社員の表の役割, 肩書き, 店, manager_auth]
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'],
  ['E3', 'Ann Acct', 'office', 'Office Manager', 'OFFICE', 'office'], ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE', 'office_crew'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E10', 'Bea Area', 'am', 'Area Manager', 'S3', null],
  ['E11', 'Hal Head', 'chef', 'Head Chef', 'S1', null], ['E12', 'Ivy Ledger', 'office', 'Accounting Leader', 'OFFICE', null],
  ['E13', 'Mo Third', 'sl', 'Store Manager', 'S3', null], ['E14', 'Pat Two', 'sl', 'Store Manager', 'S2', null],
];
export const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
export const KINDS16 = ['mileage', 'reimburse', 'expense_pre', 'skill', 'cs', 'tiprate', 'budget', 'leave', 'shift', 'hire', 'resign', 'promo', 'tip_self', 'skill_self', 'prep', 'plan'];

export async function setup({ ar = true, twice = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true),('S3','Store Three','Bea Area',true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name, status: '在籍' })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0, ap = 500000;
  const key = () => 'k-' + (++seq).toString().padStart(8, '0');
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  const w0 = await ok('E2', { action: 'whoami' });
  await ok('E2', { action: 's2_save', s2: true, expect_rev: w0.settings_rev });
  if (ar) { await pg.exec('reset role'); await pg.exec(AR); if (twice) await pg.exec(AR); await pg.exec('set role service_role'); }
  const today = new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);   // ハワイの今日（代理の期間はハワイの日付で比べる）
  const sub = (who, kind, store, payload = {}) => {
    let p;
    if (kind === 'reimburse') p = { date: today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 8000 + (++seq), ...payload };
    else if (kind === 'mileage') p = { date: today, purpose: '買い出し', origin: 'A', destination: 'B', one_way_miles: 10 + (++seq) / 10, round_trip: false, ...payload };
    else if (kind === 'expense_pre') p = { date: today, purpose: 'Team dinner', total_cents: 10000 + (++seq), ...payload };
    else if (kind === 'plan') p = { ap_id: 'ap17' + (++ap), title: 'plan', from_name: NAME[who], ym: '2026-12', ...payload };
    else if (kind === 'budget') p = { ap_id: 'ap17' + (++ap), title: 'b', from_name: NAME[who], ym: '2026-12', total_cents: 200, days: { '2026-12-01': 100, '2026-12-02': 100 }, ...payload };
    else p = { ap_id: 'ap17' + (++ap), title: kind + ' の申請', from_name: NAME[who], ...payload };
    return call(who, { action: 'submit', kind, store_id: store, client_key: key(), payload: p });
  };
  const subOk = async (...a) => { const r = await sub(...a); assert.equal(r.status, 200, 'submit ' + JSON.stringify(r.body)); return r.body; };
  const get = (who, r) => call(who, { action: 'get', id: r.id });
  const fresh = async r => (await ok('E2', { action: 'get', id: r.id }));
  const act = (who, r, op, body = {}) => call(who, { action: 'act', id: r.id, op, expect_rev: body.rev ?? r.rev, client_key: body.key || key(), ...body });
  const approve = async (who, r) => { const f = await fresh(r); return act(who, f, 'approve'); };
  const state = () => ok('E2', { action: 'ar_state' });
  const activate = async (kinds = KINDS16, by = 'E2') => {
    const st = await state();
    for (const k of st.kinds) if (kinds.includes(k.kind) && k.draft) await ok(by, { action: 'ar_rule_activate', kind: k.kind, expect_ver: k.draft.ver, expect_rev: k.draft.rev, note: '確かめた' });
  };
  const live = async (by = 'E2') => { const st = await state(); return ok(by, { action: 'ar_go_live', expect_rev: st.rev, note: '使い始め' }); };
  const saveRule = async (kind, def, by = 'E2') => {
    const st = await state(); const k = st.kinds.find(x => x.kind === kind);
    return call(by, { action: 'ar_rule_save', kind, def, expect_ver: k.draft ? k.draft.ver : 0, expect_rev: k.draft ? k.draft.rev : 0, base_ver: k.active ? k.active.ver : 0, note: 'テスト' });
  };
  const setRule = async (kind, def) => {   // 下書きにして有効にする
    const s = await saveRule(kind, def); assert.equal(s.status, 200, JSON.stringify(s.body));
    const r = await call('E2', { action: 'ar_rule_activate', kind, expect_ver: s.body.draft.ver, expect_rev: s.body.draft.rev, note: 'テスト' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
  };
  const retire = async emp => { await pg.exec('reset role'); await pg.query(`update employees set status = '退職', data = data || '{"status":"退職"}' where id = $1`, [emp]); await pg.exec('set role service_role'); };
  const q = async (sql, args = []) => { await pg.exec('reset role'); try { return (await pg.query(sql, args)).rows; } finally { await pg.exec('set role service_role'); } };
  return { pg, db, call, ok, key, sub, subOk, get, fresh, act, approve, state, activate, live, saveRule, setRule, retire, q, today };
}
export const G = { t: 'role', role: 'gm', scope: 'all' }, C = { t: 'role', role: 'ceo', scope: 'all' }, AMm = { t: 'role', role: 'am', scope: 'mine' };
export const STAGE = (...slots) => ({ mode: 'any', slots });
export const ALLS = (...slots) => ({ mode: 'all', slots });
