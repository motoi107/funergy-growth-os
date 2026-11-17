-- v1184 経費の申請の権限：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前は出さない（数だけ）。
with
 t as (select
   to_regclass('public.employees') is not null as emp,
   to_regclass('public.manager_auth') is not null as mgr,
   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('id','role','title','store','status')) as emp_cols,
   to_regprocedure('public.wr_exp_kinds(jsonb)') is not null as kinds,
   to_regprocedure('public.wr_is_s2(text)') is not null and to_regprocedure('public.wr_submit_exp(jsonb)') is not null
     and to_regprocedure('public.wr_act_exp(jsonb)') is not null and to_regprocedure('public.wr_actor(jsonb)') is not null
     and to_regprocedure('public.wr_emp_out(public.employees)') is not null as wr,
   to_regclass('public.wr_exp_grants') is not null as staged)
select 1 as no, '社員の表（id・role・title・store・status）' as check_item, case when emp and emp_cols = 5 then 'OK' else 'STOP' end as result, case when emp and emp_cols = 5 then '' else '社員の表の形が違います。Claude に' end as detail from t
union all select 2, '経費の申請の SQL（v1164・wr_exp_kinds）', case when kinds then 'OK' else 'STOP' end, case when kinds then '' else '先に deploy/expense-g2-v1164 の 2 を流してください' end from t
union all select 3, '申請の SQL（段階 2 まで）', case when wr then 'OK' else 'STOP' end, case when wr then '' else '先に申請の SQL（v1131〜v1165）を。Claude に' end from t
union all select 4, 'もう入っているか（wr_exp_grants）', case when staged then 'もう入っています（2 をもう一度流しても同じ・設定と記録は残る）' else 'まだ（初めて）' end, '' from t
union all select 5, '（参考）在籍の事務Crew（役割 office_crew・肩書き Office Crew／Office Staff）', 'info',
  case when emp and emp_cols = 5 then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where coalesce(e.status, '') <> '退職' and (coalesce(e.role, '') = 'office_crew' or btrim(coalesce(e.title, '')) in ('Office Crew','Office Staff'))$q$, false, true, '')))[1]::text
    || ' 人（うち事務Crew のメールのアカウント ' || case when mgr then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
      where coalesce(e.status, '') <> '退職' and (coalesce(e.role, '') = 'office_crew' or btrim(coalesce(e.title, '')) in ('Office Crew','Office Staff'))
        and exists (select 1 from public.manager_auth a where a.emp_id::text = e.id::text and a.role = 'office_crew')$q$, false, true, '')))[1]::text else '0' end
    || ' 人は初期値でガソリン代・立替経費とも出せる。ほかの人は GM・CEO が「事務Crew と確かめる」まで出せない）' else '—' end from t
union all select 6, '（参考）そのうち所属が本部（Office・本部・HQ・---）', 'info',
  case when emp and emp_cols = 5 then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where coalesce(e.status, '') <> '退職' and (coalesce(e.role, '') = 'office_crew' or btrim(coalesce(e.title, '')) in ('Office Crew','Office Staff'))
      and lower(btrim(coalesce(e.store, ''))) in ('office','本部','hq','---')$q$, false, true, '')))[1]::text || ' 人（本部（---）で出せる）' else '—' end from t
union all select 7, '（参考）GM・CEO のメールのアカウント（manager_auth）', 'info',
  case when mgr then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.manager_auth where role in (''gm'',''ceo'')', false, true, '')))[1]::text || ' 件（人ごとの権限を変えられる人。PIN のログインでも変えられる）' else '—' end from t
order by 1;
