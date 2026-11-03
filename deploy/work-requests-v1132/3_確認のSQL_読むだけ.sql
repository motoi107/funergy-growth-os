-- v1132 ワークセンターの申請 2 段目：入れたあとの確認（読むだけ）。すべて OK なら関数（非公開の 1 ファイル）へ。
select 'wr_views (表示設定)' as check_name,
  case when to_regclass('public.wr_views') is not null then 'OK' else 'NG' end as result
union all select 'row level security on all 8',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events','wr_people','wr_people_log','wr_views') and c.relrowsecurity) = 8 then 'OK' else 'NG' end
union all select 'browser roles cannot read the tables',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'wr\_%') = 0 then 'OK' else 'NG' end
union all select 'browser roles cannot run wr_ functions',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG' end
union all select '1 段目の関数が _exp で残っている（3）',
  case when to_regprocedure('public.wr_submit_exp(jsonb)') is not null and to_regprocedure('public.wr_act_exp(jsonb)') is not null
    and to_regprocedure('public.wr_actions_exp(jsonb,public.wr_requests)') is not null then 'OK' else 'NG' end
union all select '振り分け（wr_submit・wr_act・wr_actions が 2 段目のもの）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit(jsonb)')) like '%wr_submit_eval%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_act(jsonb)')) like '%wr_act_eval%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_actions(jsonb,public.wr_requests)')) like '%wr_actions_eval%'
    then 'OK' else 'NG（1 段目の SQL を流し直したなら、2_追加のSQL.sql をもう一度）' end
union all select 'functions (54)', (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%');
