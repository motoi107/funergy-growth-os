-- v1167 チャット改修（UI案79）：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
-- 出るのは数と OK／NG だけ（会話の中身・名前は出ない）。2 の前に流しても止まらない（管理する人の列は、あるときだけ query_to_xml で読む）。
select '1. SQL の段（チャット 3＝UI案79）' as check_name,
  case when public.chat_stage('{}'::jsonb)->>'chat' = '3' then 'OK' else 'NG（チャットか添付の SQL を流し直した？ この 2 をもう一度）' end as result
union all select '2. 管理する人の列（admin）がある',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_members' and column_name = 'admin')
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. 読めるかは参加者だけで決める（申請を見られるかでは決めない）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_member_of(jsonb,public.chat_threads)')) not like '%wr_visible%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_member_of(jsonb,public.chat_threads)')) like '%m.auto%'
    then 'OK' else 'NG（前のチャットの SQL を流し直した。この 2 をもう一度）' end
union all select '4. 申請の担当を自動で入れない（前の「自動で入る」は止まっている）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_case_sync(public.wr_requests,public.chat_threads)')) ~ 'select\s+0'
    then 'OK' else 'NG（この 2 をもう一度）' end
union all select '5. 自動で入ったまま確かめていない参加者が 0（いたら読めない）',
  case when (select count(*) from public.chat_members where auto and left_at is null) = 0 then 'OK'
    else 'NG（' || (select count(*) from public.chat_members where auto and left_at is null)::text || '・この 2 をもう一度）' end
union all select '6. 人のいるグループ・申請のチャットには管理する人が 1 人以上',
  case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_members' and column_name = 'admin') then 'NG（2 がまだ）'
    when coalesce((xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads t where t.kind in ('group','case')
      and exists (select 1 from public.chat_members m where m.thread_id = t.id and m.left_at is null and not m.auto)
      and not exists (select 1 from public.chat_members m where m.thread_id = t.id and m.left_at is null and not m.auto and m.admin)$q$, false, false, '')))[1]::text, '?') = '0'
    then 'OK' else 'NG（この 2 をもう一度）' end
union all select '7. 新しい関数がある（申請のチャットを作る・管理する人を決める）',
  case when to_regprocedure('public.chat_case_create(jsonb)') is not null and to_regprocedure('public.chat_admin(jsonb)') is not null
    and to_regprocedure('public.chat_admin_fix(uuid)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. ブラウザの鍵では chat_ と wr_receipt_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file'))
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '9. チャットの関数がどれも security invoker（関数 work-requests のサーバーの鍵だけで動く）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and p.proname like 'chat\_%' and p.prosecdef) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '10. ブラウザの鍵ではチャットの表を読めない・書けない（chat_sig は前から読むだけ）',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public'
    and table_name in ('chat_threads','chat_members','chat_messages','chat_files','chat_sig_owner')) = 0 then 'OK' else 'NG（Claude にこの表を）' end
union all select '11. 添付が入ったまま（送る・一覧が添付と管理する人に対応）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_send(jsonb)')) like '%chat_files%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%chat_files_count%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%''admin''%'
    then 'OK' else 'NG（この 2 をもう一度）' end
union all select '12. 申請の段階 2 が入ったまま（このあとに前の申請の SQL を流していない）',
  case when (public.wr_stage('{}'::jsonb)->>'stage')::int >= 5 then 'OK' else 'NG（申請の SQL → チャット → 添付 → この 2 の順にもう一度）' end
union all select '（参考）いまの参加者の数（グループ・申請のチャット）・そのうち管理する人',
  case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_members' and column_name = 'admin') then '—（2 がまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) filter (where m.left_at is null and not m.auto)::text || '・' || count(*) filter (where m.left_at is null and not m.auto and m.admin)::text n
     from public.chat_members m join public.chat_threads t on t.id = m.thread_id where t.kind in ('group','case')$q$, false, false, '')))[1]::text end
union all select '（参考）自動で入っていて、いまは外れている人の数（2 が外した人と、前から抜けていた人）',
  (select count(*)::text from public.chat_members where not auto and left_at is not null and added_by = 'auto');
