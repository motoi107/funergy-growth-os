-- v1165 申請/承認（事前経費と実費を結ぶ）：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。
select '1. SQL の段が 7（関数 work-requests はこれで「結ぶ」を出す）' as check_name,
  case when public.wr_stage('{}'::jsonb)->>'stage' = '7' then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. 結ぶ・候補の関数がある',
  case when to_regprocedure('public.wr_link_pre(jsonb)') is not null and to_regprocedure('public.wr_pre_candidates(jsonb)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. 1 つの事前経費に実費は 1 つ（索引）',
  case when exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'wr_requests' and indexname = 'wr_requests_pre_one') then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. 1 件の答えに 金額の変更前・結んだ事前経費・実費 が入る（wr_row が新しい形）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_row(jsonb,public.wr_requests)')) like '%link_pre%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_row(jsonb,public.wr_requests)')) like '%prev_amount_cents%' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. ブラウザの鍵では wr_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '6. v1164 の出せる種類はそのまま',
  case when public.wr_exp_kinds('{"role":"staff","grade":2}'::jsonb) = array['mileage','reimburse','expense_pre'] then 'OK' else 'NG（deploy/expense-g2-v1164 の 2 → この 2）' end;
