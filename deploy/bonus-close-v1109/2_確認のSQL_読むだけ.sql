-- v1109 ボーナスの締め：入れたあとの確認（読むだけ・何も変えません）。すべて OK なら次へ。
select 'tables (4)' as check_item,
  case when (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('bc_quarters','bc_versions','bc_adjust','bc_events')) = 4 then 'OK' else 'NG' end as result
union all
select 'row level security on (4)',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('bc_quarters','bc_versions','bc_adjust','bc_events') and c.relrowsecurity) = 4 then 'OK' else 'NG' end
union all
select 'browsers cannot read or write the tables',
  case when (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'bc\_%' and grantee in ('anon','authenticated','PUBLIC')) = 0 then 'OK' else 'NG' end
union all
select 'functions (21)',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%') = 21 then 'OK' else 'NG' end
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
select 'one effective final / one paid per quarter (indexes)',
  case when (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bc_versions_one_effective','bc_versions_one_paid')) = 2 then 'OK' else 'NG' end
union all
select 'versions saved so far', (select count(*)::text from public.bc_versions);
