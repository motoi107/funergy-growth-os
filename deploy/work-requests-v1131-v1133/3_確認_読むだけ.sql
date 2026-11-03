-- ワークセンターの申請（v1131＋v1132＋v1133）：2 を流したあとの確認（読むだけ・何も変えない）。
-- 「result」の列に NG が 1 つも無ければ OK。（参考）の行は数を見るだけ。
select '1. 表が 8 つある' as check_name,
  case when (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events','wr_people','wr_people_log','wr_views')) = 8 then 'OK' else 'NG' end as result
union all select '2. 表はサーバーの鍵だけ（行の守り）',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events','wr_people','wr_people_log','wr_views') and c.relrowsecurity) = 8 then 'OK' else 'NG' end
union all select '3. ブラウザの鍵では表を読めない',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'wr\_%') = 0 then 'OK' else 'NG' end
union all select '4. ブラウザの鍵では関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG' end
union all select '5. 2 段目の振り分けが入っている',
  case when to_regprocedure('public.wr_submit_exp(jsonb)') is not null and to_regprocedure('public.wr_act_exp(jsonb)') is not null
    and to_regprocedure('public.wr_actions_exp(jsonb,public.wr_requests)') is not null
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit(jsonb)')) like '%wr_submit_eval%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_act(jsonb)')) like '%wr_act_eval%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_actions(jsonb,public.wr_requests)')) like '%wr_actions_eval%'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '6. 反映の押さえ（v1133）が入っている',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_requests' and column_name = 'apply_key')
    and to_regprocedure('public.wr_apply_fresh(public.wr_requests)') is not null
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_actions_eval(jsonb,public.wr_requests)')) like '%apply_start%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_act_eval(jsonb)')) like '%apply_key%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_stage(jsonb)')) like '%3)%'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '7. 関数の数（56 なら OK）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%') = 56 then 'OK'
    else 'NG（' || (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%') || '）' end
union all select '（参考）使い始めたか：アプリで使い始めるまで false', (select live::text from public.wr_settings where id = 1)
union all select '（参考）申請の数：使い始める前は 0', (select count(*)::text from public.wr_requests);
