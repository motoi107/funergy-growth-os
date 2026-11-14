-- v1167 チャット改修（UI案79）：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- まだ無い列は直接書かず、query_to_xml で読む（無くてもこの SQL は止まらない）。出るのは数だけ（会話の中身・名前は出ない）。
select '1. チャット（v1156）と添付（v1161）が入っている' as check_name,
  case when to_regprocedure('public.chat_stage(jsonb)') is not null and to_regprocedure('public.chat_file_start(jsonb)') is not null
    and to_regprocedure('public.chat_files_count(uuid)') is not null and to_regprocedure('public.chat_actor_of(text)') is not null
    then 'OK' else 'STOP（先に deploy/chat-v1156 → deploy/chat-files-v1161 を入れる）' end as result
union all select '2. ワークセンターの申請の段階 2 が入っている（申請を見られるかを確かめるのに使う）',
  case when to_regprocedure('public.wr_visible(jsonb,public.wr_requests)') is not null and to_regprocedure('public.wr_find(jsonb,jsonb)') is not null
    then 'OK' else 'STOP（先に deploy/work-requests-v1155 を入れる）' end
union all select '3. 管理する人の列（admin）の数（0 なら初めて・1 ならもう入っている＝もう一度流しても同じ）',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'chat_members' and column_name = 'admin')
union all select '4. いまの SQL の段（2＝添付まで・3＝この SQL がもう入っている）',
  case when to_regprocedure('public.chat_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '?') end
union all select '（参考）申請のチャットに自動で入っている人の数（2 が「いま申請を見られる人」だけ残し、ほかは外す）',
  case when to_regclass('public.chat_members') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_members where auto and left_at is null$q$, false, false, '')))[1]::text end
union all select '（参考）会話の数（DM・グループ・申請のチャット）',
  case when to_regclass('public.chat_threads') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml($q$select coalesce(string_agg(kind || ' ' || n, '・' order by kind), '0') n
      from (select kind, count(*) n from public.chat_threads group by kind) x$q$, false, false, '')))[1]::text end;
