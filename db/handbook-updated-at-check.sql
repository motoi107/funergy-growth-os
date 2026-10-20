-- 読むだけ（v1097・独立レビュー 1b45d62 P3-3）。何も書き換えない。Supabase の SQL Editor でそのまま流す。
-- Handbook の読了・章（app_state の handbook_reads・handbook_chapters）は、読んだ行の updated_at が変わっていないときだけ書き、
-- 書く時刻は読んだ時刻より必ず 1 ms 以上あとにする。その前提を本番で確かめる：
--   1 行目  updated_at の型と精度（timestamp with time zone・6 が前提。3 でも動く。0〜2 だと読了が「保存しました」にならない）
--   trigger app_state の見張り（offboard_record_guard_trg だけのはず。「updated_at に触る」と出たら Claude に）
--   row     2 つのキーの今の時刻（PostgREST が返す形）。今より先なら、その差も出す（時計の進んだ端末が書いた。働きには影響しない）
select 'column' as what, data_type::text as a, coalesce(datetime_precision::text, '') as b, is_nullable::text as c
  from information_schema.columns
 where table_schema = 'public' and table_name = 'app_state' and column_name = 'updated_at'
union all
select 'trigger', t.tgname::text, p.proname::text,
       case when pg_get_functiondef(p.oid) ilike '%updated_at%' then 'updated_at に触る' else '' end
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.app_state'::regclass and not t.tgisinternal
union all
select 'row ' || key, to_json(updated_at) #>> '{}',
       case when updated_at > now() then '今より ' || (updated_at - now())::text || ' 先' else '' end, ''
  from public.app_state
 where key in ('handbook_reads', 'handbook_chapters');
