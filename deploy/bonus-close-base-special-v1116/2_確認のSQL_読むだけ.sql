-- v1116 ボーナスの締め：無条件で基準額・特別報酬。入れたあとの確認（読むだけ・何も変えません）。最後の 2 行以外すべて OK なら次へ。
select 'pay column on bc_quarters' as check_item,
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bc_quarters' and column_name = 'pay' and is_nullable = 'NO') = 1 then 'OK' else 'NG' end as result
union all
select 'functions (30)',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%') = 30 then 'OK' else 'NG' end
union all
select 'new functions (bc_pay_mode, bc_sp_save, bc_pay_match, bc_pay_from_snap, bc_emp, bc_amt, bc_now_txt, bc_not_self, bc_base_ok)',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and p.proname in ('bc_pay_mode','bc_sp_save','bc_pay_match','bc_pay_from_snap','bc_emp','bc_amt','bc_now_txt','bc_not_self','bc_base_ok')) = 9 then 'OK' else 'NG' end
union all
select 'browsers cannot run the functions',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG' end
union all
select 'the service role (Edge Function) can run them',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%'
    and not has_function_privilege('service_role', p.oid, 'execute')) = 0 then 'OK' else 'NG' end
union all
select 'security invoker with a fixed search_path',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%'
    and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))) = 0 then 'OK' else 'NG' end
union all
select 'browsers cannot read or write the tables',
  case when (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'bc\_%' and grantee in ('anon','authenticated','PUBLIC')) = 0 then 'OK' else 'NG' end
union all
select 'the new check: base $1,000 + special $200 + evaluated (made-up numbers, nothing saved)',
  case when public.bc_snap_check('2026-Q3', '{"q":"2026-Q3","unsel":0,"prov":0,"choices":{},"order":["a","b","c"],"people":{"a":{"raw":1000,"mode":"base","sp":200,"segs":[{"g":"G2","from":"2026-07-01","to":"2026-09-30","days":92,"gb":1000,"amount":1000}]},"b":{"raw":1000},"c":{"raw":2000}},"finals":{"a":1200,"b":667,"c":1333},"S":4000,"paid":3200,"cap":3000,"k":0.6666666666666666}'::jsonb) = 0 then 'OK' else 'NG' end
union all
select 'versions saved so far', (select count(*)::text from public.bc_versions)
union all
select 'quarters with base mode or special reward', (select count(*)::text from public.bc_quarters where pay <> '{}'::jsonb);
