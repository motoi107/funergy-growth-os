-- 入ったことの確認（読むだけ。鍵は表示しません）
-- 対象はこの migration の表 18・関数 74 の名前だけ（別の仕組みの invoice_uploads などは数えない）。
-- 期待：tables 18 / functions 74 / 運転の項目は配備直後はすべて false / rls_on true / browser_can_read 0 / browser_can_run 0 / review_fixes true / accounting_checks true / store_folder_intake true / office_crew_accounting true / rename_after_post true / purchase_summary true / reconciled_folder true
-- （20261012120000 を入れる前の本番では functions 65・rename_after_post false。入れたあとは 70・true。rename_on は「反映したら名前を変える」の設定で、入れた直後は false）
-- （20261019090000＝確認済みの仕入れ集計 を入れる前は tables 16・functions 70・purchase_summary false。入れたあとは 18・74・true）
-- （20261020090000＝照合済みフォルダ・Packing list を入れる前は reconciled_folder false。入れたあとは true。表と関数の数は変わらない）
with mine as (select unnest(array['invoice_settings', 'invoice_stores', 'invoice_folders', 'invoice_files', 'invoice_file_versions', 'invoice_extractions', 'invoice_vendor_rules', 'invoice_docs', 'invoice_lines', 'invoice_item_maps', 'invoice_price_history', 'invoice_events', 'invoice_qb_outbox', 'invoice_leases', 'invoice_runs', 'invoice_app_mirror', 'invoice_purchase_checks', 'invoice_purchase_published']) as t), fn as (select unnest(array[
   'invoice_actor_role', 'invoice_app_drive_ids', 'invoice_app_records', 'invoice_backfill_register', 'invoice_config', 'invoice_drive_conn',
   'invoice_drive_credentials', 'invoice_drive_status', 'invoice_dup_scope', 'invoice_edit', 'invoice_event', 'invoice_extraction',
   'invoice_file_brief', 'invoice_file_claim', 'invoice_file_content_changed', 'invoice_file_fail', 'invoice_file_retry', 'invoice_file_seen',
   'invoice_file_settle', 'invoice_file_version', 'invoice_files_due', 'invoice_folder', 'invoice_get', 'invoice_health', 'invoice_integrity_due',
   'invoice_latest_prices', 'invoice_lease', 'invoice_list', 'invoice_map_save', 'invoice_map_seed', 'invoice_mark', 'invoice_mirror_apply',
   'invoice_mirror_due', 'invoice_organize_due', 'invoice_organize_request', 'invoice_organize_result', 'invoice_post', 'invoice_price_history_list',
   'invoice_price_insert', 'invoice_price_ref', 'invoice_problems', 'invoice_qb_candidates', 'invoice_qb_enqueue', 'invoice_qb_external_key',
   'invoice_qb_external_list', 'invoice_qb_external_reserve', 'invoice_qb_reserve', 'invoice_qb_result', 'invoice_qb_since_at', 'invoice_qb_sweep', 'invoice_reassign',
   'invoice_reconcile', 'invoice_registered', 'invoice_relate', 'invoice_rename_due', 'invoice_rename_result', 'invoice_rename_waiting', 'invoice_rename_waiting_all',
   'invoice_require', 'invoice_run_log', 'invoice_setting', 'invoice_settings_save',
   'invoice_stage', 'invoice_store_folder', 'invoice_store_save', 'invoice_vendor_save', 'invoice_vendor_seed', 'invoice_whoami',
   'invoice_worker_context', 'invoice_worker_key', 'invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check']) as f)
select
  (select count(*) from mine where to_regclass('public.' || t) is not null) as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.f = p.proname where n.nspname = 'public') as functions,
  (select value->>'enabled' from public.invoice_settings where key = 'worker') as worker_enabled,
  (select value->>'intake' from public.invoice_settings where key = 'mode') as intake_on,
  (select value->>'auto_post' from public.invoice_settings where key = 'mode') as auto_post_on,
  (select value->>'mirror' from public.invoice_settings where key = 'mode') as app_copy_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb') as qb_on,
  (select value->>'enabled' from public.invoice_settings where key = 'qb_external') as qb_external_on,
  (select coalesce(value->>'rename', 'false') from public.invoice_settings where key = 'mode') as rename_on,
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace join mine on mine.t = c.relname
    where n.nspname = 'public' and c.relkind = 'r') as rls_on,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace join mine on mine.t = c.relname
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))) as browser_can_read,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.f = p.proname
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) as browser_can_run,
  -- The Codex review fixes (2026-10-07) are in: a replaced original is marked when it is read. (From 20261012120000 the
  -- forwarding waits for the posting instead, which a replaced original never gets without a person: either counts.)
  coalesce((select count(*) = 4 and bool_and(p.prosrc like '%original_replaced%' or (p.proname like 'invoice_qb_%' and p.prosrc like '%invoice_rename_waiting%'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invoice_stage', 'invoice_post', 'invoice_qb_candidates', 'invoice_qb_enqueue')), false) as review_fixes,
  -- Accounting checks only vendor, number, amount and store (UI案36, 20261007200000): products and prices are for reference.
  coalesce((select bool_and(p.prosrc like '%line_amount_missing%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_price_insert')
    and (select bool_and(p.prosrc like '%info text[]%' and p.prosrc like '%line_qty_price_missing%' and p.prosrc not like '%''line_math'',''total_mismatch''%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_post')
    -- Names are learned in the database with the correction; a switch changes only the switch (Codex R6–R8 fixes).
    and (select bool_and(p.prosrc like '%learn_alias%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_edit')
    and (select count(*) = 2 and bool_and(p.prosrc like '%expect_updated_at%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invoice_vendor_save', 'invoice_store_save')), false) as accounting_checks,
  -- Invoices put right in the store folder are read too, only those put there after the start (20261008090000).
  coalesce((select bool_and(p.prosrc like '%root_folder_id=p->>''folder_id''%' and p.prosrc like '%before_start%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoice_file_seen'), false) as store_folder_intake,
  -- 事務Crew does the invoice work like accounting (20261009190000): every role check of these ten functions lets 事務Crew in
  -- and none limits 事務Crew further; settings, stores, backfill, seeds and folder setup stay GM・CEO only.
  coalesce((select count(*) = 10 and bool_and(p.prosrc like '%''office'',''office_crew''])%' and p.prosrc not like '%''office''])%' and p.prosrc not like '%= ''office_crew''%')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invoice_post', 'invoice_edit', 'invoice_mark', 'invoice_relate', 'invoice_reconcile', 'invoice_file_retry',
      'invoice_qb_result', 'invoice_reassign', 'invoice_vendor_save', 'invoice_map_save'))
    and (select count(*) = 6 and bool_and(p.prosrc not like '%office_crew%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('invoice_settings_save', 'invoice_store_save', 'invoice_backfill_register', 'invoice_vendor_seed', 'invoice_map_seed', 'invoice_store_folder')), false) as office_crew_accounting,
  -- 反映 → 名前を変える → QuickBooks (20261012120000, Moto 2026-10-12): the rename is recorded on the file, and an original is
  -- queued for QuickBooks only once it is posted and renamed.
  coalesce((select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_files'
      and column_name in ('rename_state', 'rename_key', 'rename_attempts', 'rename_error', 'rename_next_at', 'renamed_at'))
    and (select count(*) = 5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_rename_waiting', 'invoice_rename_waiting_all', 'invoice_rename_due', 'invoice_rename_result',
        'invoice_qb_since_at'))
    and exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoice_docs_file')
    and (select count(*) = 2 and bool_and(p.prosrc like '%invoice_rename_waiting%' and p.prosrc like '%intake_status%''posted''%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_qb_candidates', 'invoice_qb_enqueue')), false) as rename_after_post,
  -- 確認済みの仕入れ集計（20261019090000, Moto 2026-10-14）：表 2 つと関数 4 つがあり、ブラウザーからは読めず動かせない。
  -- 集計は app_state（invoice_purchase_<月>・invoice_purchase_status）に書かれ、アプリはそれを読むだけ。
  coalesce((select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('invoice_purchase_checks', 'invoice_purchase_published') and c.relrowsecurity)
    and (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select bool_and(p.prosrc like '%invoice_purchase_status%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'invoice_purchase_publish'), false) as purchase_summary,
  -- 段階 2（20261020090000, Moto 2026-10-14・UI案50）：照合済みの原本は 照合済み/年-月 へ（フォルダの役割）、整理は入っているスイッチの分だけ、
  -- Packing list は invoice として扱い同じ納品と見比べる、人が店舗を選んだファイルは自動で反映しない、一覧は業者のキーと id の順。
  coalesce((select bool_and(pg_get_constraintdef(c.oid) like '%reconciled_root%' and pg_get_constraintdef(c.oid) like '%reconciled_month%')
      from pg_constraint c where c.conrelid = 'public.invoice_folders'::regclass and c.conname = 'invoice_folders_role_check')
    and (select bool_and(case p.proname when 'invoice_organize_due' then p.prosrc like '%targets%' and p.prosrc like '%reconciled_month%'
        when 'invoice_dup_scope' then p.prosrc like '%packing_list%'
        when 'invoice_files_due' then p.prosrc like '%store_assigned%'
        when 'invoice_post' then p.prosrc like '%store_assigned_by is not null%'
        when 'invoice_list' then p.prosrc like '%d.vendor_key%' and p.prosrc like '%ingested_at desc, id%' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_organize_due', 'invoice_dup_scope', 'invoice_files_due', 'invoice_post', 'invoice_list')), false) as reconciled_folder;
