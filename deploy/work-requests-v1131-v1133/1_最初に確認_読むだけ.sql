-- v1131 ワークセンターの申請：入れる前の確認（読むだけ・何も変えない）。すべて OK なら 2 へ。
select 'manager_auth (role, emp_id)' as check_name,
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name in ('role','emp_id')) = 2 then 'OK' else 'STOP' end as result
union all select 'employees (id, name, role, title, store, support, status, data)',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('id','name','role','title','store','support','status','data')) = 8 then 'OK' else 'STOP' end
union all select 'stores (id, am, active)',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('id','am','active')) = 3 then 'OK' else 'STOP' end
union all select 'app_state (key, value)',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name in ('key','value')) = 2 then 'OK' else 'STOP' end
union all select 'mileage rate (mileage_config.ratePerMile)',
  coalesce((select case when jsonb_typeof(coalesce(case when a.value::jsonb->>'__st' = '1' then a.value::jsonb->'v' else a.value::jsonb end, '{}'::jsonb)->'ratePerMile') = 'number' then 'OK' else 'NG（ガソリン代の画面の設定で単価を入れる）' end
    from public.app_state a where a.key = 'mileage_config'), 'NG（ガソリン代の画面の設定で単価を入れる）')
union all select 'GM / CEO accounts linked to an employee (manager_auth.emp_id)',
  (select case when count(*) > 0 then 'OK（' || count(*) || '）' else 'STOP（GM・CEO の emp_id が無いと使い始められない）' end from public.manager_auth where role in ('gm','ceo') and coalesce(emp_id::text, '') <> '')
union all select 'accounting / office crew accounts linked to an employee',
  (select case when count(*) > 0 then 'OK（' || count(*) || '）' else 'NG（経理・事務Crew が確認・精算できない）' end from public.manager_auth where role in ('office','office_crew') and coalesce(emp_id::text, '') <> '')
union all select 'wr_ tables already there (0 = first time)', (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name like 'wr\_%')
union all select 'old requests to copy (mileage / reimbursements / expense, rows)',
  (select count(*)::text from public.app_state where key in ('mileage_requests','reimbursements','expense_requests') or key like 'spl\_mileage\_requests\_%' or key like 'spl\_reimbursements\_%' or key like 'spl\_expense\_requests\_%');
