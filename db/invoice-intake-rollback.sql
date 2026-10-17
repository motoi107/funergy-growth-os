-- 9. 取り消し（使うのは「配備をやめて元に戻す」ときだけ）
-- この取込の表 19 個と関数 84 個（20261012120000 の 5 個・20261019090000 の表 2 個と関数 4 個・20261021090000 の関数 3 個・20261022090000 の表 1 個と関数 4 個・20261024090000 の関数 3 個を含む。まだ入れていないものは飛ばします）だけを消します。ほかの表（app_state・ingredients・vendors・manager_auth・drive_oauth など）には触りません。
-- ★取込が 1 件でも記録されていたら止まります（データを消さないため）。そのときは消さずに Claude に連絡してください。
-- Drive のファイルは、この SQL とは関係なく、どれも消えません。
do $$
declare n bigint; t text; f regprocedure;
begin
  if to_regclass('public.invoice_files') is not null then
    execute 'select (select count(*) from public.invoice_files) + (select count(*) from public.invoice_docs) + (select count(*) from public.invoice_qb_outbox)' into n;
    if n > 0 then raise exception '取込の記録が % 件あります。取り消しは止めました（データを消さないため）', n; end if;
  end if;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname = any (array['invoice_actor_role', 'invoice_app_drive_ids', 'invoice_app_records', 'invoice_backfill_register', 'invoice_config', 'invoice_drive_conn', 'invoice_drive_credentials', 'invoice_drive_status', 'invoice_dup_scope', 'invoice_edit', 'invoice_event', 'invoice_extraction', 'invoice_file_brief', 'invoice_file_claim', 'invoice_file_content_changed', 'invoice_file_fail', 'invoice_file_retry', 'invoice_file_seen', 'invoice_file_settle', 'invoice_file_version', 'invoice_files_due', 'invoice_folder', 'invoice_get', 'invoice_health', 'invoice_integrity_due', 'invoice_latest_prices', 'invoice_lease', 'invoice_list', 'invoice_map_save', 'invoice_map_seed', 'invoice_mark', 'invoice_mirror_apply', 'invoice_mirror_due', 'invoice_organize_due', 'invoice_organize_request', 'invoice_organize_result', 'invoice_post', 'invoice_price_history_list', 'invoice_price_insert', 'invoice_price_ref', 'invoice_problems', 'invoice_qb_candidates', 'invoice_qb_enqueue', 'invoice_qb_external_key', 'invoice_qb_external_list', 'invoice_qb_external_reserve', 'invoice_qb_reserve', 'invoice_qb_result', 'invoice_qb_since_at', 'invoice_qb_sweep', 'invoice_reassign', 'invoice_reconcile', 'invoice_registered', 'invoice_relate', 'invoice_rename_due', 'invoice_rename_result', 'invoice_rename_waiting', 'invoice_rename_waiting_all', 'invoice_require', 'invoice_run_log', 'invoice_setting', 'invoice_settings_save', 'invoice_stage', 'invoice_store_folder', 'invoice_store_save', 'invoice_vendor_save', 'invoice_vendor_seed', 'invoice_whoami', 'invoice_worker_context', 'invoice_worker_key', 'invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check', 'invoice_merge', 'invoice_unmerge', 'invoice_qb_manual', 'invoice_vendor_final', 'invoice_vendor_usage', 'invoice_vendor_merge', 'invoice_vendor_unmerge', 'invoice_vendor_register', 'invoice_vendor_waiting', 'invoice_vendor_merge_into']) loop
    execute 'drop function ' || f::text;
  end loop;
  foreach t in array array['invoice_settings', 'invoice_stores', 'invoice_folders', 'invoice_files', 'invoice_file_versions', 'invoice_extractions', 'invoice_vendor_rules', 'invoice_docs', 'invoice_lines', 'invoice_item_maps', 'invoice_price_history', 'invoice_events', 'invoice_qb_outbox', 'invoice_leases', 'invoice_runs', 'invoice_app_mirror', 'invoice_purchase_checks', 'invoice_purchase_published', 'invoice_vendor_merges'] loop
    execute format('drop table if exists public.%I cascade', t);
  end loop;
  -- 確認済みの仕入れ集計を使っていたら、アプリが今までの数え方に戻るように「止めた」と書く（集計の行は消さない・ほかの行は触らない）
  if to_regclass('public.app_state') is not null then
    execute format('update public.app_state set value = %L, updated_at = now() where key = %L',
      json_build_object('v', 1, 'off', true, 'checked_at', now())::text, 'invoice_purchase_status');
  end if;
end $$;
