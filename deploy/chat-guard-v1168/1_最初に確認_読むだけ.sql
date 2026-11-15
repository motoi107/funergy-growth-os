-- v1168 チャットの守り（個人のチャット暗証番号・グループのキー・プッシュ通知）：入れる前の確認（読むだけ・何も変えない）。STOP が 1 つも無ければ 2 へ。
-- 出るのは数と OK／STOP だけ（会話の中身・名前・暗証番号は出ない）。まだ無い表・関数は query_to_xml で読む（無くてもこの SQL は止まらない）。
select '1. チャット（v1156）・添付（v1161）・チャット改修（v1167）が入っている' as check_name,
  case when to_regprocedure('public.chat_case_create(jsonb)') is not null and to_regprocedure('public.chat_admin(jsonb)') is not null
    and to_regprocedure('public.chat_files_count(uuid)') is not null and to_regprocedure('public.chat_stage(jsonb)') is not null
    then 'OK' else 'STOP（先に deploy/chat-v1156 → deploy/chat-files-v1161 → deploy/chat-ui79-v1167 を入れる）' end as result
union all select '2. いまの SQL の段（3＝チャット改修まで・4＝この SQL がもう入っている＝もう一度流しても同じ）',
  case when to_regprocedure('public.chat_stage(jsonb)') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml($q$select public.chat_stage('{}'::jsonb)->>'chat' v$q$, false, false, '')))[1]::text, '?') end
union all select '3. sha256 が使える（開けた印をそのまま置かないために使う・PostgreSQL 11 以上）',
  case when to_regprocedure('pg_catalog.sha256(bytea)') is not null then 'OK' else 'STOP（Claude に知らせてください）' end
union all select '4. gen_random_uuid が使える（開けた印を作る）',
  case when to_regprocedure('pg_catalog.gen_random_uuid()') is not null or to_regprocedure('public.gen_random_uuid()') is not null
    or exists (select 1 from pg_proc where proname = 'gen_random_uuid') then 'OK' else 'STOP（Claude に知らせてください）' end
union all select '（参考）チャットの暗証番号を決めている人の数（0 なら初めて）',
  case when to_regclass('public.chat_guard') is null then '—（まだ）'
    else (xpath('/table/row/n/text()', query_to_xml($q$select count(*) n from public.chat_guard where pin_hash is not null$q$, false, false, '')))[1]::text end
union all select '（参考）会話の数（DM・グループ・申請のチャット）',
  case when to_regclass('public.chat_threads') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml($q$select coalesce(string_agg(kind || ' ' || n, '・' order by kind), '0') n
      from (select kind, count(*) n from public.chat_threads group by kind) x$q$, false, false, '')))[1]::text end;
