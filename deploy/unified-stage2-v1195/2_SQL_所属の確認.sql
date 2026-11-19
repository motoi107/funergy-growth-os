-- v1195（UI案96 の段階 2 の ①・Moto さん 11/18「1 B・2 A・3 A・4 A・5 B・6 B・7 B」）：GM・CEO が確かめた所属（本部か店か）の写し。
-- 仕様：docs/UNIFIED_UI_V1191_JA.md の 18。入れる順番：deploy/unified-stage2-v1195/手順.md（確かめ → この SQL → 確かめ → 関数 secure-state → マージ →
-- 全部の端末を 1195 に → GM・CEO が従業員マスターの「所属の確認」で 1 人ずつ決める）。
--
-- ・表 aff_people（人ごとに 1 行）：GM・CEO が「所属の確認」で決めた所属。aff＝'hq'（本部）／'store'（店）・store＝所属の店（本部は空）・
--   support＝応援の店。ver は人ごとの版（保存のたびに 1 つ進む）。
--   公開の鍵（anon・authenticated）では読めない・書けない。読み書きは関数 secure-state だけ（サーバーの鍵）。
--   関数は、ログインした人には自分の行だけ（aff_get）、GM・CEO には全員の行と記録（aff_full）を返す。
-- ・表 aff_log：保存のたびの記録（いつ・だれ・だれの・前と後・理由）。消さない。
-- ・関数 aff_save（サーバーの鍵だけ）：人ごとに、読んだときの版（expect・行が無ければ 0）と今の版が同じときだけ書く。
--   1 人でも違えば何も書かずに conflict と違った人を返す（全員まとめて 1 回）。中身が同じ人は書かない（same）。
--   中身の形と、人が在籍しているかは関数 secure-state が確かめてから渡す（ここでも形は確かめる）。
-- ・この表が決めるのは「所属の確認」の画面と、次の版（v1196）からの左上・見える店・大タブだけ。
--   従業員マスターの所属（employees の store・support）は、アプリが今までの保存の道で書く（この SQL は変えない）。
--   見え方が変わるのは、マスターと写しが同じときだけ（違えば狭いほう＝v1196）。
-- ・2 回流しても同じ（行・記録は消さない）。戻すとき：先に関数 secure-state を v1194 までの 1 ファイル（deploy/page-view-v1193/ の関数）に戻してから db/aff-rollback.sql。

do $$
begin
  if to_regclass('public.aff_people') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'aff_people' and column_name = 'support' and data_type = 'jsonb') then
    raise exception 'STOP: public.aff_people がありますが形が違います（何も変えていません）';
  end if;
  if to_regclass('public.aff_log') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'aff_log' and column_name = 'after' and data_type = 'jsonb') then
    raise exception 'STOP: public.aff_log がありますが形が違います（何も変えていません）';
  end if;
end $$;

create table if not exists public.aff_people (
  emp_id text primary key check (char_length(emp_id) between 1 and 64),
  aff text not null check (aff in ('hq', 'store')),
  store text not null default '' check (char_length(store) <= 32),
  support jsonb not null default '[]'::jsonb check (jsonb_typeof(support) = 'array'),
  ver integer not null default 1 check (ver >= 1),
  updated_at timestamptz not null default now(),
  by_emp text,
  by_name text,
  by_role text,
  check ((aff = 'hq' and store = '') or (aff = 'store' and store <> ''))
);
comment on table public.aff_people is 'v1195: GM・CEO が「所属の確認」で決めた所属（本部か店か）の写し。読み書きは関数 secure-state だけ（aff_get・aff_full・aff_save）。docs/UNIFIED_UI_V1191_JA.md の 18';

create table if not exists public.aff_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  emp_id text not null,
  emp_name text,
  ver integer not null,
  by_emp text,
  by_name text,
  by_role text,
  via text not null default 'fn' check (via in ('fn', 'sql')),
  reason text not null default '' check (char_length(reason) <= 500),
  before jsonb,
  after jsonb not null
);
comment on table public.aff_log is 'v1195: 所属の確認で所属を変えた記録（消さない）。docs/UNIFIED_UI_V1191_JA.md の 18';
create index if not exists aff_log_at on public.aff_log (at desc);
create index if not exists aff_log_emp on public.aff_log (emp_id, id desc);

alter table public.aff_people enable row level security;
alter table public.aff_log enable row level security;
revoke all on table public.aff_people from public, anon, authenticated;
revoke all on table public.aff_log from public, anon, authenticated;
revoke all on sequence public.aff_log_id_seq from public, anon, authenticated;
grant select, insert, update on table public.aff_people to service_role;
grant select, insert on table public.aff_log to service_role;
grant usage, select on sequence public.aff_log_id_seq to service_role;

-- p_items：[{ emp, name, aff, store, support, expect }]（1〜200 人）
create or replace function public.aff_save(p_items jsonb, p_reason text, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  it jsonb;
  cur public.aff_people%rowtype;
  t timestamptz := now();
  e text; a text; s text; sup jsonb; ex integer; nv integer; had boolean;
  bad text[] := array[]::text[];
  seen text[] := array[]::text[];
  done jsonb := '[]'::jsonb;
  nsame integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'aff_bad_items' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'aff_bad_reason' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.aff_people'));
  -- 1 回目：形と版をすべて確かめる（1 人でも違えば何も書かない）
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'aff_bad_item' using errcode = '22023'; end if;
    e := it->>'emp'; a := it->>'aff'; s := coalesce(it->>'store', ''); sup := coalesce(it->'support', '[]'::jsonb);
    if e is null or char_length(e) < 1 or char_length(e) > 64 or e = any(seen) then raise exception 'aff_bad_emp' using errcode = '22023'; end if;
    seen := seen || e;
    if a is null or a not in ('hq', 'store') then raise exception 'aff_bad_aff' using errcode = '22023'; end if;
    if (a = 'hq' and s <> '') or (a = 'store' and (s = '' or char_length(s) > 32)) then raise exception 'aff_bad_store' using errcode = '22023'; end if;
    if jsonb_typeof(sup) <> 'array' or jsonb_array_length(sup) > 20 then raise exception 'aff_bad_support' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(sup) x where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and 32) then
      raise exception 'aff_bad_support' using errcode = '22023';
    end if;
    if jsonb_typeof(it->'expect') <> 'number' then raise exception 'aff_bad_expect' using errcode = '22023'; end if;
    ex := (it->>'expect')::integer;
    if ex < 0 then raise exception 'aff_bad_expect' using errcode = '22023'; end if;
    select * into cur from public.aff_people where emp_id = e for update;
    if (found and cur.ver <> ex) or (not found and ex <> 0) then bad := bad || e; end if;
  end loop;
  if array_length(bad, 1) is not null then
    return jsonb_build_object('ok', false, 'conflict', true, 'ids', to_jsonb(bad));
  end if;
  -- 2 回目：書く
  for it in select value from jsonb_array_elements(p_items) loop
    e := it->>'emp'; a := it->>'aff'; s := coalesce(it->>'store', ''); sup := coalesce(it->'support', '[]'::jsonb);
    select * into cur from public.aff_people where emp_id = e;
    had := found;   -- 下の update・insert で found が変わるので先に覚える
    if had and cur.aff = a and cur.store = s and cur.support = sup then
      nsame := nsame + 1;
      done := done || jsonb_build_object('emp', e, 'ver', cur.ver, 'same', true);
      continue;
    end if;
    if had then
      nv := cur.ver + 1;
      update public.aff_people set aff = a, store = s, support = sup, ver = nv, updated_at = t,
             by_emp = p_by_emp, by_name = p_by_name, by_role = p_by_role where emp_id = e;
    else
      nv := 1;
      insert into public.aff_people (emp_id, aff, store, support, ver, updated_at, by_emp, by_name, by_role)
        values (e, a, s, sup, 1, t, p_by_emp, p_by_name, p_by_role);
    end if;
    insert into public.aff_log (at, emp_id, emp_name, ver, by_emp, by_name, by_role, via, reason, before, after)
      values (t, e, left(coalesce(it->>'name', ''), 120), nv, p_by_emp, p_by_name, p_by_role, 'fn', coalesce(p_reason, ''),
              case when had then jsonb_build_object('aff', cur.aff, 'store', cur.store, 'support', cur.support) else null end,
              jsonb_build_object('aff', a, 'store', s, 'support', sup));
    done := done || jsonb_build_object('emp', e, 'ver', nv);
  end loop;
  return jsonb_build_object('ok', true, 'rows', done, 'same', nsame, 'at', t);
end $$;
comment on function public.aff_save(jsonb, text, text, text, text) is
  'v1195: 所属の確認で決めた所属を、人ごとの読んだときの版のときだけ書く（1 人でも違えば何も書かずに conflict）。記録を足す。サーバーの鍵だけ。';
revoke all on function public.aff_save(jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.aff_save(jsonb, text, text, text, text) to service_role;
