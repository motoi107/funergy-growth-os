-- v1169 の直し：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
-- 出るのは数と OK／NG だけ（会話・申請の中身・名前は出ない）。2 の前に流しても止まらない。
select '1. チャットの段（5＝この直し）' as check_name,
  case when to_regprocedure('public.chat_stage(jsonb)') is not null
    and coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '0')::int >= 5
    then 'OK' else 'NG（2 をもう一度流す）' end as result
union all select '2. キー付きのグループを 1 つの取引で作る（chat_create_group_k）',
  case when to_regprocedure('public.chat_create_group_k(jsonb)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. 申請のチャット：最後の参加者は抜けられない・だれも読めない会話は新しく始められる・退職した人は管理する人に数えない（あとで退職しても、残った参加者が画面から直せる）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_remove(jsonb)')) like '%last_member%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_case_create(jsonb)')) like '%ref_old%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_case(jsonb)')) like '%restart%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_admin_fix(uuid)')) like '%chat_admin_next%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_admin_next(uuid)')) like '%chat_emp_ok%'
    and to_regprocedure('public.chat_admin_lock(jsonb,uuid)') is not null
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_add(jsonb)')) like '%chat_admin_lock%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_remove(jsonb)')) like '%chat_admin_lock%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_messages_get(jsonb)')) like '%chat_admin_eff%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%chat_admin_eff%'
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_threads' and column_name = 'ref_old') = 1
    then 'OK' else 'NG（チャットの SQL を流し直した？ 守り → この 2 の順にもう一度）' end
union all select '4. 経理レビュー › 申請の「処理済み（今月）」を処理した日で読む（wr_acct_done）',
  case when to_regprocedure('public.wr_acct_done(jsonb)') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. ブラウザの鍵では新しい関数を呼べない（サーバーの鍵だけ）',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and p.proname in ('chat_create_group_k','chat_live_n','wr_acct_done','chat_case','chat_case_create','chat_remove','chat_admin_fix','chat_admin_next','chat_admin_eff','chat_admin_lock','chat_add','chat_admin','chat_rename','chat_key_save')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '6. 新しい関数がどれも security invoker',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and p.proname in ('chat_create_group_k','chat_live_n','wr_acct_done','chat_admin_lock','chat_admin_next','chat_admin_eff') and p.prosecdef) = 0 then 'OK' else 'NG（Claude に）' end
union all select '7. 管理する人が退職した人だけのグループ・申請のチャットが無い',
  case when to_regclass('public.chat_threads') is null then 'NG（チャットの SQL がまだ）'
    when coalesce((xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads t where t.kind in ('group','case')
      and not exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and x.admin and public.chat_emp_ok(x.emp_id))
      and exists (select 1 from public.chat_members x where x.thread_id = t.id and x.left_at is null and not x.auto and public.chat_emp_ok(x.emp_id))$q$, false, false, '')))[1]::text, '?') = '0'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. チャットの守りが入ったまま（暗証番号・キーを確かめる）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_actor(jsonb)')) like '%chat_pin_required%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_find(jsonb,text)')) like '%chat_key_required%'
    then 'OK' else 'NG（チャットの SQL を流し直した？ Claude に）' end
union all select '（参考）申請の段（7＝申請/承認 v1165。この SQL は変えない）',
  case when to_regprocedure('public.wr_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.wr_stage('{}'::jsonb)->>'stage' v$q$, false, false, '')))[1]::text, '?') end
union all select '（参考）申請から外した前の申請のチャット（だれも読めない・中身はそのまま）',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_threads' and column_name = 'ref_old') = 0 then '—（2 がまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_threads where ref_old is not null$q$, false, false, '')))[1]::text end;
