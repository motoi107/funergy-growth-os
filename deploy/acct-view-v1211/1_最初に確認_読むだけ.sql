-- v1211 事務Crew の経理レビュー（B-1）：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前は出さない（数だけ）。表は Claude との会話にだけ貼ってください。
with
 t as (select
   to_regclass('public.employees') is not null and to_regclass('public.manager_auth') is not null as base,
   to_regclass('public.wr_exp_grants') is not null and to_regprocedure('public.wr_exp_crew(text,text)') is not null as grants,
   to_regprocedure('public.wr_person_conf(text)') is not null and to_regprocedure('public.wr_person_live(text)') is not null as ui68,
   to_regprocedure('public.wr_actor(jsonb)') is not null and to_regprocedure('public.wr_exp_base(jsonb)') is not null as wr,
   coalesce(pg_get_functiondef(to_regprocedure('public.wr_actor(jsonb)')) like '%crew_grant%', false) as staged)
select 1 as no, '社員の表・メールのアカウントの表' as check_item, case when base then 'OK' else 'STOP' end as result, case when base then '' else '表がありません。Claude に' end as detail from t
union all select 2, '申請の SQL（wr_actor・wr_exp_base）', case when wr then 'OK' else 'STOP' end, case when wr then '' else '先に申請の SQL（v1131〜v1165）を。Claude に' end from t
union all select 3, '権限の写し（v1135・wr_person_conf）', case when ui68 then 'OK' else 'STOP' end, case when ui68 then '' else '先に deploy/work-requests-v1135 を。Claude に' end from t
union all select 4, '経費の申請の権限（v1184・wr_exp_grants）', case when grants then 'OK' else 'STOP' end, case when grants then '' else '先に deploy/three-fixes-v1184 の 2 を流してください' end from t
union all select 5, 'もう入っているか', case when staged then 'もう入っています（2 をもう一度流しても同じ）' else 'まだ（初めて）' end, '' from t
union all select 6, '（参考）GM・CEO が確かめた事務Crew で、メールのアカウントが無い人', 'info',
  case when base and grants and ui68 then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where not public.wr_emp_out(e) and public.wr_exp_crew(e.role, e.title)
      and exists (select 1 from public.wr_exp_grants g where g.emp_id = e.id::text and g.crew is true)
      and not exists (select 1 from public.manager_auth a where a.emp_id::text = e.id::text and a.role in ('ceo','gm','office','office_crew'))
      and not exists (select 1 where (public.wr_person_conf(e.id::text)->>'role') = 'am' or coalesce((public.wr_person_conf(e.id::text)->>'grade')::int, 0) >= 3)$q$, false, true, '')))[1]::text
    || ' 人（2 のあと、経理レビュー › 申請を事務Crew のアカウントの人と同じに見られ、確認・差し戻し・支払ができる）' else '—' end from t
union all select 7, '（参考）事務Crew で、まだ確かめていない人（メールのアカウントも無い）', 'info',
  case when base and grants then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where not public.wr_emp_out(e) and public.wr_exp_crew(e.role, e.title)
      and not exists (select 1 from public.wr_exp_grants g where g.emp_id = e.id::text and g.crew is true)
      and not exists (select 1 from public.manager_auth a where a.emp_id::text = e.id::text and a.role in ('ceo','gm','office','office_crew'))$q$, false, true, '')))[1]::text
    || ' 人（GM・CEO が「経費の申請の権限」で「事務Crew と確かめる」を押すまで見られない）' else '—' end from t
union all select 8, '（参考）事務Crew のメールのアカウントの人', 'info',
  case when base then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.manager_auth a where a.role = 'office_crew'$q$, false, true, '')))[1]::text
    || ' 件（今も見られる・変わらない）' else '—' end from t
union all select 9, '（参考）従業員マスターで経理（役割 office）なのに、経理のメールのアカウントが無い人', 'info',
  case when base then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where coalesce(e.status, '') <> '退職' and coalesce(e.role, '') = 'office'
      and not exists (select 1 from public.manager_auth a where a.emp_id::text = e.id::text and a.role in ('ceo','gm','office'))$q$, false, true, '')))[1]::text
    || ' 人（この版でも見られない。経理のメールのアカウントを作ると見られる。Claude に）' else '—' end from t
order by 1;
