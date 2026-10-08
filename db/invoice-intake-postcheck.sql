-- 入ったことの確認（読むだけ。鍵は表示しません）
-- 対象はこの migration の表 16・関数 65 の名前だけ（別の仕組みの invoice_uploads などは数えない）。
-- 期待：tables 16 / functions 65 / 運転の項目は配備直後はすべて false / rls_on true / browser_can_read 0 / browser_can_run 0 / review_fixes true / accounting_checks true
with mine as (select unnest(array['invoice_settings', 'invoice_stores', 'invoice_folders', 'invoice_files', 'invoice_file_versions', 'invoice_extractions', 'invoice_vendor_rules', 'invoice_docs', 'invoice_lines', 'invoice_item_maps', 'invoice_price_history', 'invoice_events', 'invoice_qb_outbox', 'invoice_leases', 'invoice_runs', 'invoice_app_mirror']) as t), fn as (select unnest(array[
   'invoice_actor_role', 'invoice_app_drive_ids', 'invoice_app_records', 'invoice_backfill_register', 'invoice_config', 'invoice_drive_conn',
   'invoice_drive_credentials', 'invoice_drive_status', 'invoice_dup_scope', 'invoice_edit', 'invoice_event', 'invoice_extraction',
   'invoice_file_brief', 'invoice_file_claim', 'invoice_file_content_changed', 'invoice_file_fail', 'invoice_file_retry', 'invoice_file_seen',
   'invoice_file_settle', 'invoice_file_version', 'invoice_files_due', 'invoice_folder', 'invoice_get', 'invoice_health', 'invoice_integrity_due',
   'invoice_latest_prices', 'invoice_lease', 'invoice_list', 'invoice_map_save', 'invoice_map_seed', 'invoice_mark', 'invoice_mirror_apply',
   'invoice_mirror_due', 'invoice_organize_due', 'invoice_organize_request', 'invoice_organize_result', 'invoice_post', 'invoice_price_history_list',
   'invoice_price_insert', 'invoice_price_ref', 'invoice_problems', 'invoice_qb_candidates', 'invoice_qb_enqueue', 'invoice_qb_external_key',
   'invoice_qb_external_list', 'invoice_qb_external_reserve', 'invoice_qb_reserve', 'invoice_qb_result', 'invoice_qb_sweep', 'invoice_reassign',
   'invoice_reconcile', 'invoice_registered', 'invoice_relate', 'invoice_require', 'invoice_run_log', 'invoice_setting', 'invoice_settings_save',
   'invoice_stage', 'invoice_store_folder', 'invoice_store_save', 'invoice_vendor_save', 'invoice_vendor_seed', 'invoice_whoami',
   'invoice_worker_context', 'invoice_worker_key']) as f)
select
  (select count(*) from mine where to_regclass('public.' || t) is not null) as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.f = p.proname where n.nspname = 'public') as functions,
  (select value->>'enabled' from public.invoice_settings where key = 'worker') as worker_enabled,
  (select value->>'intake' from public.invoice_settings where key = 'mode') as intake_on,
  (select value->>'auto_post' from public.invoice_settings where key = 'mode') as auto_post_on,
  (select value->>'mirror' from public.invoice_settings where key = 'mode') as app_copy_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb') as qb_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb_external') as qb_external_on,
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace join mine on mine.t = c.relname
    where n.nspname = 'public' and c.relkind = 'r') as rls_on,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace join mine on mine.t = c.relname
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) as browser_can_read,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.f = p.proname
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) as browser_can_run,
  -- The Codex review fixes (2026-10-07) are in: a replaced original is marked when it is read.
  coalesce((select bool_and(p.prosrc like '%original_replaced%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invoice_stage', 'invoice_post', 'invoice_qb_candidates', 'invoice_qb_enqueue')), false) as review_fixes,
  -- Accounting checks only vendor, number, amount and store (UI案36, 20261007200000): products and prices are for reference.
  coalesce((select bool_and(p.prosrc like '%line_amount_missing%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_price_insert')
    and (select bool_and(p.prosrc like '%info text[]%' and p.prosrc not like '%''line_math'',''total_mismatch''%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_post'), false) as accounting_checks;
