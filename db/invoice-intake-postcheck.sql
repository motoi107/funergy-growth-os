-- 2. 入ったことの確認（読むだけ。鍵は表示しません）
-- 期待：tables 16 / functions 65 / 運転の項目はすべて false / rls_on true / browser_can_read 0 / browser_can_run 0
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'invoice\_%') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'invoice\_%') as functions,
  (select value->>'enabled' from public.invoice_settings where key = 'worker') as worker_enabled,
  (select value->>'intake' from public.invoice_settings where key = 'mode') as intake_on,
  (select value->>'auto_post' from public.invoice_settings where key = 'mode') as auto_post_on,
  (select value->>'mirror' from public.invoice_settings where key = 'mode') as app_copy_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb') as qb_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb_external') as qb_external_on,
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'invoice\_%' and c.relkind = 'r') as rls_on,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'invoice\_%' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) as browser_can_read,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'invoice\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) as browser_can_run;
