-- v1161 チャットの添付：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- まだ無いもの（チャットの関数・Storage の表）は直接書かず、query_to_xml で読む（無くてもこの SQL は止まらない）。
select '1. チャット（v1156）が入っている' as check_name,
  case when to_regprocedure('public.chat_send(jsonb)') is not null and to_regclass('public.chat_messages') is not null
    and to_regprocedure('public.wr_find(jsonb,jsonb)') is not null then 'OK' else 'STOP（先に deploy/chat-v1156 を入れる）' end as result
union all select '2. 添付の表の数（0 なら初めて・1 ならもう入っている＝もう一度流しても同じ）',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'chat_files')
union all select '3. Storage に「置き場所を限らない」決まりが無い（あると公開の鍵で chat-files も読めてしまう）',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles && array['public','anon','authenticated']::name[]
      and position('bucket_id' in coalesce(qual, '') || coalesce(with_check, '')) = 0)
      then 'STOP（Claude に決まりの名前を：' || (select string_agg(policyname, ', ') from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and roles && array['public','anon','authenticated']::name[] and position('bucket_id' in coalesce(qual, '') || coalesce(with_check, '')) = 0) || '）'
    else 'OK' end
union all select '4. Storage に chat-files を開ける決まりが無い',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles && array['public','anon','authenticated']::name[]
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%chat-files%') then 'STOP（Claude に知らせる）' else 'OK' end
union all select '5. 置き場所 chat-files（無ければ 2 が作る・あれば非公開・10MB にそろえる）',
  case when to_regclass('storage.buckets') is null then '—（Storage が無い）'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select case when public then 'ある（公開になっている：2 が非公開に直す）' else 'ある（非公開）' end v from storage.buckets where id = 'chat-files'$q$, false, false, '')))[1]::text, '無い（2 が作る）') end
union all select '（参考）チャットの SQL の段（1＝チャット・2＝添付まで）',
  case when to_regprocedure('public.chat_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '?') end;
