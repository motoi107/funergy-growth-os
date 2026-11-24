-- 2b：事務Crew のメールのアカウントを足す前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前・メールは出さない（数だけ）。表は Claude との会話にだけ貼ってください。
-- Moto さん 11/24「GMやCEOの様にメールで登録（ログインはPINでも入れる様に）」。
with
 t as (select
   to_regclass('public.employees') is not null and to_regclass('public.manager_auth') is not null as base,
   to_regclass('auth.users') is not null as auth,
   to_regprocedure('public.wr_emp_out(public.employees)') is not null and to_regprocedure('public.wr_exp_crew(text,text)') is not null
     and to_regprocedure('public.wr_actor(jsonb)') is not null as wr,
   to_regprocedure('public.invoice_actor_role(uuid)') is not null as inv),
 c as (select a.attname::text col, a.attnotnull nn, d.adbin is not null as has_def, a.attidentity <> '' as ident, a.attgenerated <> '' as gen
   from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = to_regclass('public.manager_auth') and a.attnum > 0 and not a.attisdropped),
 k as (select
   (select count(*) from c where col in ('user_id', 'role', 'emp_id')) = 3 as cols,
   (select string_agg(col, ', ' order by col) from c where nn and not has_def and not ident and not gen and col not in ('user_id', 'role', 'emp_id')) as extra)
select 1 as no, '社員の表・メールのアカウントの表（manager_auth）' as check_item, case when base then 'OK' else 'STOP' end as result,
  case when base then '' else '表がありません。Claude に' end as detail from t
union all select 2, 'メールのアカウント（auth.users）', case when auth then 'OK' else 'STOP' end, case when auth then '' else 'auth.users が読めません。Claude に' end from t
union all select 3, '申請の SQL（wr_actor・wr_exp_crew・v1184）', case when wr then 'OK' else 'STOP' end,
  case when wr then '' else '先に申請の SQL と deploy/three-fixes-v1184 の 2 を。Claude に' end from t
union all select 4, 'Invoice取込の SQL（invoice_actor_role）', case when inv then 'OK' else 'STOP' end, case when inv then '' else 'Invoice取込の SQL がありません。Claude に' end from t
union all select 5, 'manager_auth の列（user_id・role・emp_id）', case when cols then 'OK' else 'STOP' end,
  case when cols then '' else '列が違います。この表を Claude に（2 は流さない）' end from k
union all select 6, 'manager_auth のほかの必須の列', case when extra is null then 'OK' else 'STOP' end,
  case when extra is null then '' else '値の要る列があります（' || extra || '）。2 は流さずに Claude に' end from k
union all select 7, '（参考）事務Crew のメールのアカウント', 'info',
  case when base then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.manager_auth a where a.role = 'office_crew'$q$, false, true, '')))[1]::text || ' 件' else '—' end from t
union all select 8, '（参考）従業員マスターで在籍の事務Crew で、メールのアカウントが無い人', 'info',
  case when base and wr then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.employees e
    where not public.wr_emp_out(e) and public.wr_exp_crew(e.role, e.title)
      and not exists (select 1 from public.manager_auth a where a.emp_id::text = e.id::text and a.role in ('ceo','gm','office','office_crew'))$q$, false, true, '')))[1]::text
    || ' 人（2 で 1 人ずつ足す）' else '—' end from t
union all select 9, '（参考）事務Crew のメールのアカウントで、社員の ID が空・社員の表にいない', 'info',
  case when base then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.manager_auth a where a.role = 'office_crew'
      and (coalesce(a.emp_id::text, '') = '' or not exists (select 1 from public.employees e where e.id::text = a.emp_id::text))$q$, false, true, '')))[1]::text
    || ' 件（0 でなければ、その人は PIN では入れない。2 でメールと社員の ID を入れ直すと直る）' else '—' end from t
order by 1;
