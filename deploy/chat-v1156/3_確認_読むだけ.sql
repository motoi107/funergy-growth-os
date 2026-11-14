-- v1156 チャット：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
select '1. 表が 5 つ・どれも行の守り（RLS）が ON' as check_name,
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    and c.relname in ('chat_threads','chat_members','chat_messages','chat_sig','chat_sig_owner') and c.relrowsecurity) = 5 then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. ブラウザの鍵では会話・参加者・本文を読めない・書けない',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated')
    and table_schema = 'public' and table_name in ('chat_threads','chat_members','chat_messages','chat_sig_owner')) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. ブラウザの鍵で読めるのは「変わった」の合図（chat_sig）だけ・書けない',
  case when (select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants where grantee in ('anon','authenticated')
    and table_schema = 'public' and table_name = 'chat_sig') = 'SELECT'
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_sig') = 3 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. ブラウザの鍵では chat_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'chat\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. chat_ の関数が 36・どれも security invoker',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'chat\_%' and not p.prosecdef) = 36
    and (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'chat\_%' and p.prosecdef) = 0
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '6. SQL の段（チャット 1）',
  case when public.chat_stage('{}'::jsonb)->>'chat' = '1' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '7. 申請のチャットが申請に戻れる（申請の id を返す）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%''id'', r.id%'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. 申請の段階 2 が入ったまま（チャットの SQL のあとに前の申請の SQL を流していない）',
  case when (public.wr_stage('{}'::jsonb)->>'stage')::int >= 5 then 'OK' else 'NG（deploy/work-requests-v1155 の ② → この 2 をもう一度）' end
union all select '9. Realtime：合図の表が入っている（Realtime が無いときは —）',
  case when not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then '—'
    when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_sig') then 'OK'
    else 'NG（2 をもう一度流す）' end
union all select '10. 加え直した人に、抜けていたあいだの会話を見せない（v1156 の直し）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_add(jsonb)')) like '%history_from = v_from%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_add(jsonb)')) not like '%least(public.chat_members.history_from%'
    then 'OK' else 'NG（今の 2 をもう一度流す）' end
union all select '（参考）会話の数', (select count(*)::text from public.chat_threads)
union all select '（参考）メッセージの数', (select count(*)::text from public.chat_messages);
