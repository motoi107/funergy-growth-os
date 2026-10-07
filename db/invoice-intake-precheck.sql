-- 事前の確認（読むだけ。何も書き換えません）
-- Supabase の SQL Editor に貼って Run。出てきた行の result がすべて OK で始まっていれば migration（db/invoice-intake.sql）に進んでください。
-- NG・STOP が 1 つでもあれば、migration は流さずに結果の画面を Claude に見せてください。
-- 確かめる対象は、この migration が作る表 16・関数 65 の名前だけ（別の仕組みの invoice_uploads などは対象外・参考として表示）。
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
select '1. GM/CEO などの登録表（manager_auth）がある' as check_item,
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'manager_auth'
                    and ((column_name = 'user_id' and data_type = 'uuid') or (column_name = 'role'))) = 2
            then 'OK' else 'NG：manager_auth の形が想定と違う' end as result
union all
select '2. GM か CEO が 1 人以上登録されている',
       case when to_regclass('public.manager_auth') is null then 'NG：manager_auth が無い'
            when (select count(*) from public.manager_auth where role in ('gm', 'ceo')) > 0 then 'OK'
            else 'NG：GM・CEO の登録が無い（設定の画面を開ける人がいない）' end
union all
select '3. 取込の表・関数はまだ入っていない',
       case when exists (select 1 from mine where to_regclass('public.' || t) is not null)
              or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace join fn on fn.f = p.proname where n.nspname = 'public')
            then 'STOP：この migration の表か関数が既にある（migration は流さない）' else 'OK' end
union all
select '4. アプリのデータの表（app_state）がある',
       case when to_regclass('public.app_state') is not null then 'OK' else 'NG：app_state が無い' end
union all
select '5. gen_random_uuid が使える',
       case when exists (select 1 from pg_proc where proname = 'gen_random_uuid') then 'OK' else 'NG' end
union all
select '6.（参考）drive-sync の Drive 連携（drive_oauth）',
       case when to_regclass('public.drive_oauth') is not null then 'OK（フォルダを確かめるときに使います）'
            else 'OK（ただし Drive の連携がまだ無い：配備はできる。フォルダを確かめる前に連携が要る）' end
union all
select '7.（参考）別の仕組みの invoice_ の表（そのまま・対象外）',
       'OK（' || coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'invoice\_%' and c.relname not in (select t from mine)), 'なし') || '）';
