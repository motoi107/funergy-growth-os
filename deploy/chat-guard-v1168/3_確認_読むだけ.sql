-- v1168 チャットの守り：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
-- 出るのは数と OK／NG だけ（会話の中身・名前・暗証番号・キーは出ない）。2 の前に流しても止まらない。
select '1. SQL の段（チャット 4＝守り）' as check_name,
  case when public.chat_stage('{}'::jsonb)->>'chat' = '4' then 'OK' else 'NG（2 をもう一度。チャット改修の SQL を流し直したら、この 2 も流し直す）' end as result
union all select '2. 守りの表がある（暗証番号・開けた印・キーの印・続けて間違えた数・通知の送り先）',
  case when to_regclass('public.chat_guard') is not null and to_regclass('public.chat_sess') is not null and to_regclass('public.chat_sess_keys') is not null
    and to_regclass('public.chat_key_fails') is not null and to_regclass('public.chat_push_subs') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '3. 会話にキーの列がある',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_threads'
    and column_name in ('key_hash','key_salt','key_iter','key_rev')) = 4 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '4. チャットの関数はどれも暗証番号とキーを確かめる（chat_actor・chat_find・chat_sync が v1168）',
  case when to_regclass('public.chat_guard') is not null
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_actor(jsonb)')) like '%chat_pin_required%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_find(jsonb,text)')) like '%chat_key_required%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_sync(jsonb)')) like '%chat_gate_actor%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_row(jsonb,public.chat_threads,public.chat_members)')) like '%key_ok%'
    then 'OK' else 'NG（チャット・添付・チャット改修の SQL を流し直した？ この 2 をもう一度）' end
union all select '5. 守りの表は RLS が ON・ブラウザの鍵では読めない・書けない',
  case when to_regclass('public.chat_guard') is null then 'NG（2 がまだ）'
    when (select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.chat_guard'), to_regclass('public.chat_sess'), to_regclass('public.chat_sess_keys'), to_regclass('public.chat_key_fails'), to_regclass('public.chat_push_subs')))
     and (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public'
       and table_name in ('chat_guard','chat_sess','chat_sess_keys','chat_key_fails','chat_push_subs','chat_threads','chat_members','chat_messages','chat_files')) = 0
    then 'OK' else 'NG（Claude にこの表を）' end
union all select '6. ブラウザの鍵では chat_ と wr_receipt_ の関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and (p.proname like 'chat\_%' or p.proname in ('wr_receipt_from_chat','wr_receipt_file'))
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '7. チャットの関数がどれも security invoker',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
    and p.proname like 'chat\_%' and p.prosecdef) = 0 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. 暗証番号・キーはそのまま置いていない（印は 64 桁の 16 進だけ）',
  case when to_regclass('public.chat_guard') is null then 'NG（2 がまだ）'
    when coalesce((xpath('/table/row/n/text()', query_to_xml($q$select (select count(*) from public.chat_guard where pin_hash is not null and pin_hash !~ '^[0-9a-f]{64}$')
      + (select count(*) from public.chat_threads where key_hash is not null and key_hash !~ '^[0-9a-f]{64}$') n$q$, false, false, '')))[1]::text, '?') = '0'
    then 'OK' else 'NG（Claude に知らせてください）' end
union all select '9. 申請の領収書（チャットのファイル）も暗証番号・キーを確かめる',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_receipt_from_chat(jsonb)')) like '%chat_key_ok%' then 'OK' else 'NG（この 2 をもう一度）' end
union all select '10. 添付・チャット改修が入ったまま（送る・管理する人）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.chat_send(jsonb)')) like '%chat_files%'
    and to_regprocedure('public.chat_case_create(jsonb)') is not null and to_regprocedure('public.chat_admin(jsonb)') is not null
    and (select prosrc from pg_proc where oid = to_regprocedure('public.chat_member_of(jsonb,public.chat_threads)')) like '%m.auto%'
    then 'OK' else 'NG（チャットの SQL を流し直した？ 添付 → チャット改修 → この 2 の順にもう一度）' end
union all select '（参考）暗証番号を決めている人・キーのある会話・通知を受け取る端末の数',
  case when to_regclass('public.chat_guard') is null then '—（2 がまだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select (select count(*) from public.chat_guard where pin_hash is not null)::text || '・'
      || (select count(*) from public.chat_threads where key_hash is not null)::text || '・' || (select count(*) from public.chat_push_subs)::text n$q$, false, false, '')))[1]::text end;
