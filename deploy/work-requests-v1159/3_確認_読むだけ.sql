-- v1159 段階 3：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
select '1. SQL の段が 6' as check_name,
  case when public.wr_stage('{}'::jsonb)->>'stage' = '6' then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. 写す関数がある',
  case when to_regprocedure('public.wr_s3_import(jsonb)') is not null and to_regprocedure('public.wr_s3_hist(public.wr_requests)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. 予算の版は、写した履歴を元にしない',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit_s2(jsonb)')) like '%not public.wr_s3_hist(x)%' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. ブラウザの鍵では wr_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. wr_s3_ の関数はどれも security invoker',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_s3\_%' and p.prosecdef) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '（参考）写した承認待ち', (select count(*)::text from public.wr_requests where legacy and legacy_info->>'src' = 'approvals' and coalesce(legacy_info->>'hist', '') <> 'true')
union all select '（参考）写した履歴', (select count(*)::text from public.wr_requests where legacy and legacy_info->>'src' = 'approvals' and legacy_info->>'hist' = 'true');
