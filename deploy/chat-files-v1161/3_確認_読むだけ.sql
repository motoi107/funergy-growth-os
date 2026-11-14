-- v1161 チャットの添付：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
-- Storage の表は query_to_xml で読む（Storage が無い環境では「—」）。
with pol as (
  -- Storage の決まり（公開の鍵に許すもの）。chat：chat-files の字がある・loose：置き場所を 1 つ（chat-files 以外）に限っていない（#155 の Codex 6876878458 の 1）
  select p.policyname, (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%chat-files%' as chat,
    (case p.cmd when 'INSERT' then x.w_ok when 'SELECT' then x.q_ok when 'DELETE' then x.q_ok
            else x.q_ok and (p.with_check is null or x.w_ok) end) is not true as loose
  from pg_policies p
   cross join lateral (select
     (coalesce(p.qual, '') ~ '^\(bucket_id = ''[^'']+''::text\)$' or coalesce(p.qual, '') ~ '^\(\(bucket_id = ''[^'']+''::text\) AND .+\)$')
       and substring(p.qual from '^\(\(?bucket_id = ''([^'']+)''::text\)') <> 'chat-files' as q_ok,
     (coalesce(p.with_check, '') ~ '^\(bucket_id = ''[^'']+''::text\)$' or coalesce(p.with_check, '') ~ '^\(\(bucket_id = ''[^'']+''::text\) AND .+\)$')
       and substring(p.with_check from '^\(\(?bucket_id = ''([^'']+)''::text\)') <> 'chat-files' as w_ok) x
  where p.schemaname = 'storage' and p.tablename = 'objects' and p.permissive = 'PERMISSIVE'
     and p.roles && array['public','anon','authenticated']::name[])
select '1. 添付の表（chat_files）の行の守り（RLS）が ON' as check_name,
  case when (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'chat_files') then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. ブラウザの鍵では添付の表を読めない・書けない',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public' and table_name = 'chat_files') = 0
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. ブラウザの鍵では chat_ と wr_receipt_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file'))
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. 添付の関数がどれも security invoker（関数 work-requests のサーバーの鍵だけで動く）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file')) and p.prosecdef) = 0
    and to_regprocedure('public.wr_receipt_from_chat(jsonb)') is not null and to_regprocedure('public.chat_files_list(jsonb)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. SQL の段（チャット 2＝添付）',
  case when public.chat_stage('{}'::jsonb)->>'chat' = '2' then 'OK' else 'NG（チャットの SQL を流し直した？ この 2 をもう一度）' end
union all select '6. 送る・消す・一覧が添付に対応している（チャットの SQL をあとで流し直していない）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_send(jsonb)')) like '%chat_files%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_delete(jsonb)')) like '%chat_files%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%chat_files_label%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_msg(jsonb,public.chat_threads,public.chat_messages)')) like '%chat_file_pub%'
    then 'OK' else 'NG（この 2 をもう一度）' end
union all select '7. 置き場所 chat-files が非公開・1 つ 10MB まで',
  case when to_regclass('storage.buckets') is null then '—（Storage が無い）'
    when coalesce((xpath('/table/row/v/text()', query_to_xml($q$select (not public and file_size_limit = 10485760)::text v from storage.buckets where id = 'chat-files'$q$, false, false, '')))[1]::text, '') = 'true'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. Storage に chat-files を開ける決まり・置き場所を 1 つに限らない決まりが無い',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when exists (select 1 from pol where chat or loose)
    then 'NG（Claude に決まりの名前を：' || (select string_agg(policyname, ', ' order by policyname) from pol where chat or loose) || '。公開の鍵で添付を読めるおそれ）' else 'OK' end
union all select '9. 申請の段階 2 が入ったまま（添付のあとに前の申請の SQL を流していない）',
  case when (public.wr_stage('{}'::jsonb)->>'stage')::int >= 5 then 'OK' else 'NG（deploy/work-requests-v1155 の ② → チャットの ② → この 2）' end
union all select '（参考）送ったファイルの数',
  case when to_regclass('public.chat_files') is null then '—（2 がまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_files where status = 'sent'$q$, false, false, '')))[1]::text end
union all select '（参考）送っていない・消しかけのファイルの数（1 日・10 分で片づく）',
  case when to_regclass('public.chat_files') is null then '—（2 がまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_files where status in ('up','ok','bad','del','purging')$q$, false, false, '')))[1]::text end;
