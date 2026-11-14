-- v1156 チャット：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- まだ無い表は直接書かず、あるときだけ query_to_xml で読む（申請の SQL が入っていなくてもこの SQL は止まらない）。
select '1. ワークセンターの申請の段階 2（v1155）が入っている' as check_name,
  case when to_regprocedure('public.wr_actor(jsonb)') is not null and to_regprocedure('public.wr_visible(jsonb,public.wr_requests)') is not null
    and to_regprocedure('public.wr_is_s2(text)') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1155 を入れる）' end as result
union all select '2. チャットの表の数（0 なら初めて・5 ならもう入っている＝もう一度流しても同じ）',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('chat_threads','chat_members','chat_messages','chat_sig','chat_sig_owner'))
union all select '3. 同じ名前のほかの表・関数が無い（chat_ で始まる、この SQL が作らないもの。添付の chat_files（v1161）は除く）',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m')
      and c.relname like 'chat\_%' and c.relname not in ('chat_threads','chat_members','chat_messages','chat_sig','chat_sig_owner','chat_files')) = 0
    then 'OK' else 'STOP（chat_ で始まる別の表がある。Claude に名前を）' end
union all select '4. Realtime（supabase_realtime）がある（無くても動く：1 分ごとに確かめる）',
  case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'OK' else 'OK（無い：Realtime なしで動く）' end
union all select '5. ワークセンターの申請を使い始めているか（true なら OK・false でもチャットは使える）',
  case when to_regclass('public.wr_settings') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select live::text v from public.wr_settings where id = 1', false, false, '')))[1]::text, 'false') end
union all select '（参考）在籍の社員の数（チャットで選べる人）',
  (select count(*)::text from public.employees e where coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true');
