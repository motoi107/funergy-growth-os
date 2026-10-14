-- 入ったかの確認（読むだけ・何も変えない）。
-- 期待：表 2・関数 4・ブラウザーから読める表 0・ブラウザーから動かせる関数 0。
-- 「集計がある月」「最後に集計を確かめた時刻」は、関数を入れて 5 分たつか 4_すぐに集計を作る.sql を流すと入る（それまでは空でよい）。
select
 (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('invoice_purchase_checks', 'invoice_purchase_published') and c.relrowsecurity) as "表（2）",
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check')) as "関数（4）",
 (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('invoice_purchase_checks', 'invoice_purchase_published')
    and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) as "ブラウザーから読める表（0）",
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) as "ブラウザーから動かせる関数（0）",
 (select string_agg(substring(key from 18), ', ' order by key) from public.app_state where key ~ '^invoice_purchase_\d{4}-\d{2}$') as "集計がある月",
 (select to_char((value::jsonb->>'checked_at')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') from public.app_state where key = 'invoice_purchase_status') as "最後に集計を確かめた時刻（ハワイ）",
 (select case when (value::jsonb->>'off')::boolean then '止めてある' else '動いている' end from public.app_state where key = 'invoice_purchase_status') as "集計";
