-- v1211 事務Crew の経理レビュー（B-1）：入れたあとに確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「result」に NG が 1 つも無ければ OK。名前は出さない（数だけ）。
with
 t as (select
   coalesce(pg_get_functiondef(to_regprocedure('public.wr_actor(jsonb)')) like '%crew_grant%', false) as actor,
   coalesce(pg_get_functiondef(to_regprocedure('public.wr_exp_base(jsonb)')) like '%crew_grant%', false) as base,
   to_regprocedure('public.wr_actor(jsonb)') is not null and to_regprocedure('public.wr_exp_base(jsonb)') is not null as fns,
   to_regclass('public.wr_exp_grants') is not null as grants)
select 1 as no, '呼んだ人の決め方（wr_actor）に事務Crew の確かめ' as check_item, case when actor then 'OK' else 'NG' end as result,
  case when actor then '' else '2 のあとに前の申請の SQL（deploy/work-requests-v1131〜v1135）を流しています → 2 をもう一度' end as detail from t
union all select 2, '経費の区分（wr_exp_base）', case when base then 'OK' else 'NG' end,
  case when base then '' else '2 のあとに deploy/three-fixes-v1184 の 2 を流しています → 2 をもう一度' end from t
union all select 3, 'アプリの鍵（anon・authenticated）では呼べない', case when fns and not (
    has_function_privilege('anon', 'public.wr_actor(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.wr_actor(jsonb)', 'execute')
    or has_function_privilege('anon', 'public.wr_exp_base(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.wr_exp_base(jsonb)', 'execute')) then 'OK' else 'NG' end, '' from t
union all select 4, 'サーバーの鍵（service_role）は呼べる', case when fns and has_function_privilege('service_role', 'public.wr_actor(jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.wr_exp_base(jsonb)', 'execute') then 'OK' else 'NG' end, '' from t
union all select 5, '（参考）確かめから事務Crew になる人', 'info',
  case when actor and grants then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where not public.wr_emp_out(e) and length(e.id::text) <= 64 and (public.wr_actor(jsonb_build_object('emp_id', e.id::text))->>'src') = 'crew_grant'$q$, false, true, '')))[1]::text
    || ' 人（1 の 6 と同じ数なら OK）' else '—' end from t
order by 1;
