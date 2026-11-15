-- v1169 の直し（Codex の P2・#161〜#164）：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- 出るのは数と OK／STOP だけ（会話・申請の中身・名前は出ない）。まだ無い関数は query_to_xml で読む（無くてもこの SQL は止まらない）。
select '1. チャットの守り（v1168）が入っている' as check_name,
  case when to_regclass('public.chat_guard') is not null and to_regprocedure('public.chat_key_save(jsonb)') is not null
    and to_regprocedure('public.chat_case_create(jsonb)') is not null and to_regprocedure('public.chat_admin_fix(uuid)') is not null
    then 'OK' else 'STOP（先に deploy/chat-guard-v1168 を入れる）' end as result
union all select '2. 申請/承認（段階 2 まで）が入っている',
  case when to_regprocedure('public.wr_stage(jsonb)') is not null and to_regprocedure('public.wr_row(jsonb,public.wr_requests)') is not null
    and to_regprocedure('public.wr_visible(jsonb,public.wr_requests)') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1155 などの申請の SQL を）' end
union all select '3. いまのチャットの段（4＝守りまで・5＝この SQL がもう入っている＝もう一度流しても同じ）',
  case when to_regprocedure('public.chat_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '?') end
union all select '（参考）いまの申請の段（7＝申請/承認 v1165 まで。この SQL は変えない）',
  case when to_regprocedure('public.wr_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.wr_stage('{}'::jsonb)->>'stage' v$q$, false, false, '')))[1]::text, '?') end
union all select '（参考）だれも読めない申請のチャット（次に開いた人が新しく始められるようになる）',
  case when to_regclass('public.chat_threads') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads t where t.kind = 'case' and t.ref_id is not null
      and not exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id))$q$, false, false, '')))[1]::text end
union all select '（参考）管理する人が退職した人だけのグループ・申請のチャット（2 が直す）',
  case when to_regclass('public.chat_threads') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads t where t.kind in ('group','case')
      and not exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and x.admin and public.chat_emp_ok(x.emp_id))
      and exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id))$q$, false, false, '')))[1]::text end
union all select '（参考）キーの無いグループ（作るときにキーを付けそこねたものがあれば、管理する人が「グループのキー」で付ける）',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_threads' and column_name = 'key_hash') = 0 then '—（守りがまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads t where t.kind = 'group' and t.key_hash is null$q$, false, false, '')))[1]::text end;
