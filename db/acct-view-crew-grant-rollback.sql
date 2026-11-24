-- B-1（v1211）を戻す：20261217090000_wr_actor_crew_grant.sql の前に戻す（wr_actor は 20261107090000、wr_exp_base は 20261204090000 の中身）。
-- 戻すと、PIN でログインする事務Crew（GM・CEO が「事務Crew と確かめた」人）は、また staff・G1 になり、
-- 共通ルールを使う前は経理レビュー › 申請が 0 件、使い始めたあとは「確認した」「差し戻す」が出なくなる（v1210 までと同じ）。
-- 表・記録・確かめ（wr_exp_grants）は消さない。2 回流しても同じ。中身は tests/acct-view-v1211.test.mjs が元の 2 つのファイルと比べる。

do $$
begin
 if to_regprocedure('public.wr_actor(jsonb)') is null or to_regprocedure('public.wr_exp_base(jsonb)') is null then
  raise exception 'STOP: wr_actor・wr_exp_base がありません（申請の SQL がまだ）。何も変えていません。';
 end if;
end $$;

-- 呼んだ人（20261107090000_work_requests_ui68.sql と同じ）
create or replace function public.wr_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); e public.employees; v_mgr text;
 live jsonb; conf jsonb; v_role text; v_grade integer; v_stores text[]; v_am text[]; v_nm text;
begin
 if v_emp is null or length(v_emp) > 64 then raise exception 'forbidden'; end if;
 select * into e from public.employees x where x.id::text = v_emp;
 if not found or public.wr_emp_out(e) then raise exception 'forbidden'; end if;
 v_nm := coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), btrim(coalesce(e.name, '')));
 select a.role into v_mgr from public.manager_auth a where a.emp_id::text = v_emp and a.role in ('ceo','gm','office','office_crew')
  order by case a.role when 'gm' then 1 when 'ceo' then 2 when 'office' then 3 else 4 end limit 1;
 if v_mgr is not null then
  return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_mgr, 'grade', public.wr_grade(e.title, v_mgr),
   'stores', '[]'::jsonb, 'am_stores', '[]'::jsonb, 'confirmed', true, 'pending', false);
 end if;
 live := public.wr_person_live(v_emp);
 conf := public.wr_person_conf(v_emp);
 if conf is not null then
  v_role := case when (conf->>'role') = 'am' and (live->>'role') = 'am' then 'am' else 'staff' end;
  v_grade := least((conf->>'grade')::int, (live->>'grade')::int);
  v_am := case when v_role = 'am' then public.wr_meet(public.wr_arr(conf->'am_stores'), public.wr_arr(live->'am_stores')) else '{}'::text[] end;
  v_stores := case when v_role = 'am' or v_grade >= 3 then public.wr_meet(public.wr_arr(conf->'stores'), public.wr_arr(live->'stores')) else public.wr_arr(live->'stores') end;   -- v1135：G3 も写しの店だけ
  v_nm := conf->>'name';
 else
  v_role := 'staff'; v_grade := least((live->>'grade')::int, 3); v_stores := public.wr_arr(live->'stores'); v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_role, 'grade', v_grade, 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am),
  'confirmed', conf is not null, 'pending', public.wr_up(conf, live));
end $$;

-- 経費の申請の基本の範囲（20261204090000_wr_exp_grants.sql と同じ）
create or replace function public.wr_exp_base(a jsonb) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; v_ok boolean;
begin
 if a is null or jsonb_typeof(a) <> 'object' then return 'g1'; end if;
 if (a->>'role') in ('ceo','gm','am') or coalesce((a->>'grade')::int, 0) >= 2 then return 'full'; end if;
 if (a->>'role') = 'office_crew' then return 'office_crew'; end if;
 if (a->>'role') = 'office' then return 'office'; end if;
 select * into e from public.employees x where x.id::text = a->>'emp';
 if found and public.wr_exp_crew(e.role, e.title) then
  select g.crew into v_ok from public.wr_exp_grants g where g.emp_id = a->>'emp';
  return case when coalesce(v_ok, false) then 'office_crew' else 'crew_wait' end;
 end if;
 return 'g1';
end $$;

revoke all on function public.wr_actor(jsonb), public.wr_exp_base(jsonb) from public, anon, authenticated;
grant execute on function public.wr_actor(jsonb), public.wr_exp_base(jsonb) to service_role;
