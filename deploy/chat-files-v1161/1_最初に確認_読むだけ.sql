-- v1161 チャットの添付：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- まだ無いもの（チャットの関数・Storage の表）は直接書かず、query_to_xml で読む（無くてもこの SQL は止まらない）。
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
     -- #155・#156 の Codex（6880266210・6880661922）：anon・authenticated が入っているロール宛ての決まりも公開の鍵に効く
     and (p.roles && array['public','anon','authenticated']::name[]
          or exists (select 1 from unnest(p.roles) pr(n) join pg_roles g on g.rolname = pr.n
                      join pg_roles u on u.rolname in ('anon','authenticated') where pg_has_role(u.oid, g.oid, 'MEMBER'))))
select '1. チャット（v1156）が入っている' as check_name,
  case when to_regprocedure('public.chat_send(jsonb)') is not null and to_regclass('public.chat_messages') is not null
    and to_regprocedure('public.wr_find(jsonb,jsonb)') is not null then 'OK' else 'STOP（先に deploy/chat-v1156 を入れる）' end as result
union all select '2. 添付の表の数（0 なら初めて・1 ならもう入っている＝もう一度流しても同じ）',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'chat_files')
union all select '3. Storage の決まりがどれも置き場所を 1 つに限っている（限っていないと公開の鍵で chat-files も読めてしまうおそれ）',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when exists (select 1 from pol where loose and not chat)
      then 'STOP（Claude に決まりの名前を：' || (select string_agg(policyname, ', ' order by policyname) from pol where loose and not chat) || '）'
    else 'OK' end
union all select '4. Storage に chat-files を開ける決まりが無い',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when exists (select 1 from pol where chat) then 'STOP（Claude に決まりの名前を：' || (select string_agg(policyname, ', ' order by policyname) from pol where chat) || '）' else 'OK' end
union all select '5. 置き場所 chat-files（無ければ 2 が作る・あれば非公開・10MB にそろえる）',
  case when to_regclass('storage.buckets') is null then '—（Storage が無い）'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select case when public then 'ある（公開になっている：2 が非公開に直す）' else 'ある（非公開）' end v from storage.buckets where id = 'chat-files'$q$, false, false, '')))[1]::text, '無い（2 が作る）') end
union all select '6. Storage の行の守り（RLS）が効いている（OFF・RLS を飛ばせる公開の鍵だと、決まりに関係なく chat-files も読めてしまう）',
  case when to_regclass('storage.objects') is null then '—（Storage が無い）'
    when coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'), false)
     and not exists (select 1 from pg_roles r where r.rolname in ('anon','authenticated') and (r.rolbypassrls or r.rolsuper)) then 'OK'
    else 'STOP（Claude にこの表を）' end
union all select '（参考）チャットの SQL の段（1＝チャット・2＝添付まで）',
  case when to_regprocedure('public.chat_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '?') end;
