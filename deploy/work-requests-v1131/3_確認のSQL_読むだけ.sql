-- v1131 ワークセンターの申請：入れたあとの確認（読むだけ）。すべて OK なら関数（非公開の 1 ファイル）へ。
select 'wr_ tables (5)' as check_name,
  case when (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events')) = 5 then 'OK' else 'NG' end as result
union all select 'row level security on all 5',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events') and c.relrowsecurity) = 5 then 'OK' else 'NG' end
union all select 'browser roles cannot read the tables',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'wr\_%') = 0 then 'OK' else 'NG' end
union all select 'browser roles cannot run wr_ functions',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG' end
union all select 'functions (31)', (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%')
union all select 'live (false until a GM / CEO turns it on in the app)', (select live::text from public.wr_settings where id = 1)
union all select 'requests (0 before turning on)', (select count(*)::text from public.wr_requests);
