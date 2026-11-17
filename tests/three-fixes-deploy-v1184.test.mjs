// v1184 入れる一式（deploy/three-fixes-v1184）：2 の SQL は migration と同じ・1 と 3 の確かめを PGlite で流す（合成データ・本番にはつながない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = f => fs.readFileSync(new URL('../deploy/three-fixes-v1184/' + f, import.meta.url), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIG = M('20261204090000_wr_exp_grants');
const V1164 = fs.readFileSync(new URL('../deploy/expense-g2-v1164/2_SQL_経費の申請.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files',
  '20261125090000_wr_expense_g2', '20261126090000_wr_approve_v1165'];
const PEOPLE = [   // [id, 名前, 役割, 肩書き, 所属, 状態]
  ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE'], ['E4', 'Oli Office', 'office_crew', 'Office Crew', 'OFFICE'], ['E12', 'Hana Hq', 'office_crew', 'Office Crew', '本部'],
  ['E13', 'Sora Staff', 'crew', 'Office Staff', 'S1'], ['E14', 'Nao None', 'office_crew', 'Office Crew', ''], ['E9', 'Cam Crew', 'crew', 'Crew', 'S1'],
  ['E15', 'Rei Ret', 'office_crew', 'Office Crew', 'OFFICE', '退職']];

async function base({ upto = MIGS.length } = {}) {
  const pg = new PGlite();
  // Supabase と同じく、新しい表・関数は既定で公開の鍵にも付く（SQL が外すことを確かめる）
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.manager_auth(role, emp_id) values ('gm','E2');`);
  for (const [id, name, role, title, store, st] of PEOPLE) await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]',$6,'{}')`, [id, name, role, title, store, st || '在籍']);
  for (const f of MIGS.slice(0, upto)) await pg.exec(M(f));
  return pg;
}
const rows = async (pg, sql) => { const r = await pg.exec(sql); return r[r.length - 1].rows; };

test('2 の SQL は migration と同じ（1 文字も違わない）', () => { assert.equal(D('2_SQL_経費の申請の権限.sql'), MIG); });

test('1 の確認：入れる前と後（STOP なし・読むだけ・数だけ）・前の SQL が無ければ STOP', async () => {
  const pg = await base();
  const before = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.ok(!before.some(r => r.result === 'STOP'), JSON.stringify(before));
  assert.match(before.find(r => r.no === 4).result, /まだ/);
  assert.match(before.find(r => r.no === 5).detail, /^4 人/, '在籍の事務Crew：役割 office_crew 3 人＋肩書き Office Staff 1 人（退職は数えない）');
  assert.match(before.find(r => r.no === 5).detail, /うち事務Crew のメールのアカウント 0 人/, 'この合成データでは E4 にメールのアカウントが無い');
  assert.match(before.find(r => r.no === 6).detail, /^2 人/, '所属が本部（OFFICE・本部）');
  assert.match(before.find(r => r.no === 7).detail, /^1 件/);
  assert.ok(!JSON.stringify(before).match(/Oli|Hana|Sora|Nao|Cam|Gabe/), '名前は出さない');
  await pg.exec(D('2_SQL_経費の申請の権限.sql'));
  assert.match((await rows(pg, D('1_最初に確認_読むだけ.sql'))).find(r => r.no === 4).result, /もう入っています/);
  const pg0 = await base({ upto: MIGS.indexOf('20261125090000_wr_expense_g2') });
  const stop = await rows(pg0, D('1_最初に確認_読むだけ.sql'));
  assert.equal(stop.find(r => r.no === 2).result, 'STOP');
  await assert.rejects(pg0.exec(D('2_SQL_経費の申請の権限.sql')), /STOP/);
  assert.equal((await rows(pg0, `select to_regclass('public.wr_exp_grants') is null as none`))[0].none, true, '止まったら何も変えない');
});

test('3 の確認：入れたあと NG なし・2 回流しても設定は残る・公開の鍵の付け直しや前の SQL の流し直しで NG', async () => {
  const pg = await base();
  const none = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(none.filter(x => x.result === 'NG').length >= 6, '入れる前は NG：' + JSON.stringify(none));
  await pg.exec(D('2_SQL_経費の申請の権限.sql'));
  await pg.exec(`insert into public.wr_exp_grants(emp_id, mileage, reimburse) values ('E9', true, null);
    insert into public.wr_exp_grant_log(emp_id, kind, before_set, after_set, before_eff, after_eff, by_emp) values ('E9','mileage',null,true,false,true,'E2')`);
  await pg.exec(D('2_SQL_経費の申請の権限.sql'));
  const r = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(!r.some(x => x.result === 'NG'), JSON.stringify(r));
  assert.equal(r.length, 11);
  assert.equal(r.find(x => x.no === 11).detail, '1 人・1 件', '2 回流しても設定と記録は残る');
  await pg.exec('grant select on public.wr_exp_grants to anon');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 3).result, 'NG');
  await pg.exec('revoke select on public.wr_exp_grants from anon; grant execute on function public.wr_exp_kinds(jsonb) to authenticated');
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 5).result, 'NG');
  await pg.exec('revoke execute on function public.wr_exp_kinds(jsonb) from authenticated');
  // 1 つずつ外すと、その行だけが NG（RLS・関数の数・直す／出し直すの確かめ・whoami の本部）
  const only = async (sql, no, undo) => {
    await pg.exec(sql);
    const x = await rows(pg, D('3_確認_読むだけ.sql'));
    assert.deepEqual(x.filter(y => y.result === 'NG').map(y => y.no), [no], sql + ' → ' + JSON.stringify(x));
    await pg.exec(undo);
  };
  await only('alter table public.wr_exp_grants disable row level security', 2, 'alter table public.wr_exp_grants enable row level security');
  // Codex #182 の P1：事務Crew を従業員マスターだけで決める前の形（確かめを見ない wr_exp_base）→ 10 だけ NG
  await only(`create or replace function public.wr_exp_base(a jsonb) returns text language plpgsql stable security invoker set search_path = public, pg_temp as $$
    declare e public.employees; begin if (a->>'role') in ('ceo','gm','am') or coalesce((a->>'grade')::int, 0) >= 2 then return 'full'; end if;
    select * into e from public.employees x where x.id::text = a->>'emp'; if found and public.wr_exp_crew(e.role, e.title) then return 'office_crew'; end if; return 'g1'; end $$`,
    10, D('2_SQL_経費の申請の権限.sql'));
  await only('alter function public.wr_exp_grant_row(text) rename to wr_exp_grant_row_x', 4, 'alter function public.wr_exp_grant_row_x(text) rename to wr_exp_grant_row');
  await only(`create or replace function public.wr_act(p jsonb) returns jsonb language plpgsql volatile security invoker set search_path = public, pg_temp as $$ begin return public.wr_act_exp(p); end $$`,
    8, D('2_SQL_経費の申請の権限.sql'));
  await only(`create or replace function public.wr_whoami(p jsonb) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$ begin return jsonb_build_object('me', public.wr_actor(p)); end $$`,
    9, D('2_SQL_経費の申請の権限.sql'));
  // 前の SQL（v1164）を流し直すと、出せる種類と本部の決まりが前に戻る → 3 が見つける。2 をもう一度で戻る
  await pg.exec(V1164);
  const back = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.equal(back.find(x => x.no === 7).result, 'NG'); assert.equal(back.find(x => x.no === 9).result, 'NG');
  await pg.exec(D('2_SQL_経費の申請の権限.sql'));
  assert.ok(!(await rows(pg, D('3_確認_読むだけ.sql'))).some(x => x.result === 'NG'));
  // 段階 2 の SQL を流し直すと、送るときの確かめが外れる → 3 が見つける
  await pg.exec(M('20261120090000_work_requests_stage2'));
  assert.equal((await rows(pg, D('3_確認_読むだけ.sql'))).find(x => x.no === 8).result, 'NG');
});

test('前に渡した 2（crew の列が無い・記録の種類が 2 つだけの形）を入れていても、今の 2 で直る（設定と記録は残る・確かめを記録できる）', async () => {
  const pg = await base();
  // 前に渡した v1184 の 2 と同じ形の表（列 crew なし・kind の決まりが 2 つ）
  await pg.exec(`create table public.wr_exp_grants (emp_id text primary key, mileage boolean, reimburse boolean, rev integer not null default 1,
      updated_by text, updated_emp text, updated_at timestamptz not null default now());
    create table public.wr_exp_grant_log (id bigserial primary key, at timestamptz not null default now(), emp_id text not null, emp_name text,
      kind text not null check (kind in ('mileage','reimburse')), before_set boolean, after_set boolean, before_eff boolean, after_eff boolean,
      by_emp text, by_name text, by_role text, note text);
    insert into public.wr_exp_grants(emp_id, mileage, reimburse) values ('E9', true, null);
    insert into public.wr_exp_grant_log(emp_id, kind, before_set, after_set, before_eff, after_eff, by_emp) values ('E9','mileage',null,true,false,true,'E2');`);
  await assert.rejects(pg.exec(`insert into public.wr_exp_grant_log(emp_id, kind, by_emp) values ('E13','crew','E2')`), /check/i);
  await pg.exec(D('2_SQL_経費の申請の権限.sql'));
  await pg.exec(`insert into public.wr_exp_grant_log(emp_id, kind, by_emp) values ('E13','crew','E2')`);
  await assert.rejects(pg.exec(`insert into public.wr_exp_grant_log(emp_id, kind, by_emp) values ('E13','other','E2')`), /check/i);
  const g = await rows(pg, `select emp_id, mileage, reimburse, crew from public.wr_exp_grants`);
  assert.deepEqual(g, [{ emp_id: 'E9', mileage: true, reimburse: null, crew: null }]);
  const r = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(!r.some(x => x.result === 'NG'), JSON.stringify(r));
  assert.equal(r.find(x => x.no === 11).detail, '1 人・2 件');
});

test('手順.md：番号のファイルがそろっていて、非公開の 1 ファイル（関数）はリポジトリに無い', () => {
  const h = D('手順.md');
  for (const f of ['1_最初に確認_読むだけ.sql', '2_SQL_経費の申請の権限.sql', '3_確認_読むだけ.sql', 'work-requests_v1184_index.ts']) assert.ok(h.includes(f), f);
  assert.ok(!fs.existsSync(new URL('../deploy/three-fixes-v1184/work-requests_v1184_index.ts', import.meta.url)), '関数の 1 ファイルは置かない（PIN の確かめを含むため）');
});
