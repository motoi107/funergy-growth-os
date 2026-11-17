-- v1183 ログインの試し：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前・PIN・メールは出さない（数だけ）。
with
 t as (select
   to_regclass('public.employees') is not null as emp,
   to_regclass('public.manager_auth') is not null as mgr,
   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name in ('user_id','role','emp_id')) as mgr_cols,
   to_regprocedure('public.dl_stage()') is not null as staged,
   to_regprocedure('gen_random_uuid()') is not null as uuidfn)
select 1 as no, 'employees の表' as check_item, case when emp then 'OK' else 'STOP' end as result, case when emp then '' else '社員の表がありません。Claude に' end as detail from t
union all select 2, 'manager_auth の表（user_id・role・emp_id）', case when mgr and mgr_cols = 3 then 'OK' else 'STOP' end, case when mgr and mgr_cols = 3 then '' else '管理者の表の形が違います。Claude に' end from t
union all select 3, 'gen_random_uuid()', case when uuidfn then 'OK' else 'STOP' end, '' from t
union all select 4, 'もう入っているか（dl_stage）', case when staged then 'もう入っています（2 をもう一度流しても同じ）' else 'まだ（初めて）' end, '' from t
union all select 5, 'GM・CEO のメールのアカウント（manager_auth）',
  case when mgr and mgr_cols = 3 then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.manager_auth where role in (''gm'',''ceo'')', false, true, '')))[1]::text else '—' end,
  '0 なら「ログインの試し」を開けません（メール認証が要るため）' from t
order by 1;
