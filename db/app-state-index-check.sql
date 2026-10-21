-- 読むだけ（v1098）。supabase/migrations/20261027090000_app_state_index.sql を入れたあと、Supabase の SQL Editor で流す。何も書き換えない。
-- 全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身・名前は出ません）。
with f as (
  select p.oid, p.prosecdef
    from pg_proc p
   where p.proname = 'app_state_index' and p.pronamespace = 'public'::regnamespace
),
idx as (select * from public.app_state_index(array['invoice_purchase_', 'lunch_photo_']::text[])),
base as (select key from public.app_state where left(key, 17) <> 'invoice_purchase_' and left(key, 12) <> 'lunch_photo_')
select 'function app_state_index' as what, (select count(*) from f)::text as value,
       case when (select count(*) from f) = 1 then 'OK' else 'NG' end as ok
union all
select 'security invoker（呼んだ人の権限で読む）', (select case when bool_or(prosecdef) then 'definer' else 'invoker' end from f),
       case when (select not bool_or(prosecdef) from f) then 'OK' else 'NG' end
union all
select 'anon が呼べる', has_function_privilege('anon', 'public.app_state_index(text[])', 'execute')::text,
       case when has_function_privilege('anon', 'public.app_state_index(text[])', 'execute') then 'OK' else 'NG' end
union all
select 'rows（一覧の行の数 / app_state の行の数）', (select count(*) from idx)::text || ' / ' || (select count(*) from base)::text,
       case when (select count(*) from idx) = (select count(*) from base) then 'OK' else 'NG' end
union all
select 'md5 が中身と同じ', (select count(*) from idx i join public.app_state s on s.key = i.key where i.h <> md5(s.value::text))::text || ' 行ちがう',
       case when (select count(*) from idx i join public.app_state s on s.key = i.key where i.h <> md5(s.value::text)) = 0 then 'OK' else 'NG' end
union all
select 'skip（invoice_purchase_・lunch_photo_ は出さない）', (select count(*) from idx where left(key, 17) = 'invoice_purchase_' or left(key, 12) = 'lunch_photo_')::text,
       case when (select count(*) from idx where left(key, 17) = 'invoice_purchase_' or left(key, 12) = 'lunch_photo_') = 0 then 'OK' else 'NG' end;
