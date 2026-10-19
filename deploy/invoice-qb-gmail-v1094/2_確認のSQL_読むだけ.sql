-- 入ったことの確認（読むだけ。鍵は表示しません）
-- 対象はこの migration の表 24・関数 115 の名前だけ（別の仕組みの invoice_uploads などは数えない）。
-- 期待：tables 24 / functions 115 / 運転の項目は配備直後はすべて false / rls_on true / browser_can_read 0 / browser_can_run 0 / review_fixes true / accounting_checks true / store_folder_intake true / office_crew_accounting true / rename_after_post true / purchase_summary true / reconciled_folder true / multi_file true / vendor_merge true / vendor_register true / item_link true / qb_gmail true
-- （20261012120000 を入れる前の本番では functions 65・rename_after_post false。入れたあとは 70・true。rename_on は「反映したら名前を変える」の設定で、入れた直後は false）
-- （20261019090000＝確認済みの仕入れ集計 を入れる前は tables 16・functions 70・purchase_summary false。入れたあとは 18・74・true）
-- （20261020090000＝照合済みフォルダ・Packing list を入れる前は reconciled_folder false。入れたあとは true。表と関数の数は変わらない）
-- （20261021090000＝複数枚で 1 つの invoice を入れる前は functions 74・multi_file false。入れたあとは 77・true）
-- （20261022090000＝業者の統合を入れる前は tables 18・functions 77・vendor_merge false。入れたあとは 19・81・true）
-- （20261024090000＝新しい業者を決める を入れる前は functions 81・vendor_register false。入れたあとは 84・true）
-- （20261025090000＝紐づけ 段階 1 を入れる前は tables 19・functions 84・item_link false。入れたあとは 21・94・true）
-- （20261026090000＝QuickBooks からすぐ（Gmail）を入れる前は tables 21・functions 94・qb_gmail false。入れたあとは 24・115・true）
with mine as (select unnest(array['invoice_settings', 'invoice_stores', 'invoice_folders', 'invoice_files', 'invoice_file_versions', 'invoice_extractions', 'invoice_vendor_rules', 'invoice_docs', 'invoice_lines', 'invoice_item_maps', 'invoice_price_history', 'invoice_events', 'invoice_qb_outbox', 'invoice_leases', 'invoice_runs', 'invoice_app_mirror', 'invoice_purchase_checks', 'invoice_purchase_published', 'invoice_vendor_merges', 'invoice_link_members', 'invoice_link_marks', 'invoice_gmail_auth', 'invoice_gmail_oauth', 'invoice_qb_alerts']) as t), fn as (select unnest(array[
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
   'invoice_worker_context', 'invoice_worker_key', 'invoice_purchase_classes', 'invoice_purchase_month', 'invoice_purchase_publish', 'invoice_purchase_check',
   'invoice_merge', 'invoice_unmerge', 'invoice_qb_manual', 'invoice_vendor_final', 'invoice_vendor_usage', 'invoice_vendor_merge', 'invoice_vendor_unmerge', 'invoice_vendor_register', 'invoice_vendor_waiting', 'invoice_vendor_merge_into',
   'invoice_code_key', 'invoice_link_hr_ok', 'invoice_link_role', 'invoice_link_whoami', 'invoice_link_lines', 'invoice_link_data', 'invoice_link_save',
   'invoice_link_retire', 'invoice_link_mark', 'invoice_link_apply',
   'invoice_gmail_public', 'invoice_gmail_start', 'invoice_gmail_take', 'invoice_gmail_save', 'invoice_gmail_creds', 'invoice_gmail_mark', 'invoice_gmail_disconnect',
   'invoice_qb_has_due', 'invoice_qb_send_context', 'invoice_qb_send_check', 'invoice_qb_content_changed', 'invoice_qb_unknown_due', 'invoice_qb_gmail_checked',
   'invoice_qb_row', 'invoice_qb_status', 'invoice_qb_alerts_publish', 'invoice_qb_alert_put', 'invoice_qb_alert_scan', 'invoice_qb_alert_claim',
   'invoice_qb_alert_done', 'invoice_line_route']) as f)
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
      where n.nspname = 'public' and p.proname in ('invoice_organize_due', 'invoice_dup_scope', 'invoice_files_due', 'invoice_post', 'invoice_list')), false) as reconciled_folder,
  -- 段階 3（20261021090000, Moto 2026-10-14・UI案50 5・6A・7A・8A）：同じ番号の原本を 1 つの invoice にまとめる（まとめたページは 'merged'）、
  -- まとめた invoice のページは名前・整理・状態がその invoice に付いていく、QuickBooks へは転送側が対応するまで台帳に出さない。
  coalesce((select bool_and(pg_get_constraintdef(c.oid) like '%merged%')
      from pg_constraint c where c.conrelid = 'public.invoice_docs'::regclass and c.conname = 'invoice_docs_status_check')
    and (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_docs'
      and column_name in ('merged_into', 'part_no', 'merge_base'))
    and (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_merge', 'invoice_unmerge', 'invoice_qb_manual')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select bool_and(case when p.proname in ('invoice_qb_enqueue') then p.prosrc like '%multi_file%'
        when p.proname in ('invoice_mark', 'invoice_reassign') then p.prosrc like '%has_parts%'
        when p.proname = 'invoice_purchase_month' then p.prosrc like '%<> ''merged''%'
        when p.proname = 'invoice_stage' then p.prosrc like '%''merged''%'
        when p.proname in ('invoice_merge', 'invoice_qb_manual') then p.prosrc like '%qb_in_progress%'
        else p.prosrc like '%merged_into%' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_file_settle', 'invoice_stage', 'invoice_post', 'invoice_edit', 'invoice_mark', 'invoice_reconcile',
        'invoice_organize_due', 'invoice_rename_waiting', 'invoice_rename_waiting_all', 'invoice_rename_due', 'invoice_qb_enqueue', 'invoice_qb_candidates',
        'invoice_list', 'invoice_get', 'invoice_purchase_month', 'invoice_reassign', 'invoice_merge', 'invoice_qb_manual')), false) as multi_file,
  -- 業者の統合（20261022090000, Moto 2026-10-15・UI案51）：統合した業者の印（merged_into）と統合の記録の表があり、ブラウザーからは読めない。
  -- まとめる・外す・数える・行き先の関数 4 つはブラウザーからは動かせない。統合した業者は編集できず、照合の記録・商品の対応表の候補・業者の候補は
  -- 統合先に行く。
  coalesce((select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_vendor_rules'
      and column_name in ('merged_into', 'merged_at', 'merged_by'))
    and (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'invoice_vendor_merges')
    and (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_vendor_final', 'invoice_vendor_usage', 'invoice_vendor_merge', 'invoice_vendor_unmerge')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select count(*) = 4 and bool_and(case p.proname when 'invoice_vendor_save' then p.prosrc like '%merged_into is not null%'
        when 'invoice_purchase_check' then p.prosrc like '%invoice_vendor_final%'
        when 'invoice_map_seed' then p.prosrc like '%merged_into is null%'
        when 'invoice_vendor_seed' then p.prosrc like '%normalize(v.name%' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_vendor_save', 'invoice_purchase_check', 'invoice_map_seed', 'invoice_vendor_seed')), false) as vendor_merge,
  -- 新しい業者を決める（20261024090000, Moto 2026-10-16・UI案52 ③）：invoice の印字名から業者を登録する関数（同じ名前の業者があれば登録しない）、
  -- 名前で待っている invoice を数える関数、印字名を業者にまとめる関数（ほかの業者をまとめないか同じロックの中で確かめてから業者の統合）。
  -- どれもブラウザーからは動かせない。経理・事務Crew・GM・CEO が使う（10A）。業者の統合で業者が決まった待ちの invoice は統合の記録に残り、
  -- 統合を外すと業者を選ぶ待ちに戻る（業者の統合の 2 つの置き換え・Codex の PR #72 のレビュー）。
  coalesce((select count(*) = 3 and bool_and(p.prosrc like '%''office'',''office_crew''])%' and p.prosrc like '%vendor_key is null and d.status=''review''%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_vendor_register', 'invoice_vendor_waiting', 'invoice_vendor_merge_into')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select count(*) = 2 and bool_and(p.prosrc like '%pg_advisory_xact_lock(hashtext(''invoice_vendor_rules''))%'
        and p.prosrc like case p.proname when 'invoice_vendor_register' then '%''taken''%' else '%''shared''%' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_vendor_register', 'invoice_vendor_merge_into'))
    and (select count(*) = 2 and bool_and(p.prosrc like '%''unknown'', v_unk%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_vendor_merge', 'invoice_vendor_unmerge')), false) as vendor_register,
  -- 紐づけ 段階 1（20261025090000, Moto 2026-10-18・UI案55）：戻した結びの印（retired_at）と、Head Chef・AM の表・品目の印の表があり、ブラウザーからは
  -- 読めない。紐づけの関数 10 個はブラウザーからは動かせない。戻した結びは取込と単価に使わない（置き換えた 3 つ）。結ぶのは同じロックの中。
  coalesce((select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_item_maps'
      and column_name in ('retired_at', 'retired_by'))
    and (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('invoice_link_members', 'invoice_link_marks') and c.relrowsecurity)
    and (select count(*) = 10 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_code_key', 'invoice_link_hr_ok', 'invoice_link_role', 'invoice_link_whoami', 'invoice_link_lines',
        'invoice_link_data', 'invoice_link_save', 'invoice_link_retire', 'invoice_link_mark', 'invoice_link_apply')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select count(*) = 3 and bool_and(p.prosrc like '%retired_at%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_price_insert', 'invoice_worker_context', 'invoice_map_save'))
    and (select count(*) = 3 and bool_and(p.prosrc like '%pg_advisory_xact_lock(hashtext(''invoice_vendor_rules''))%' and p.prosrc like '%invoice_link_role%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_link_save', 'invoice_link_retire', 'invoice_link_mark'))
    and (select count(*) = 1 and bool_and(p.prosrc like '%invoice_link_role%' and p.prosrc like '%invoice_price_insert%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'invoice_link_apply'), false) as item_link,
  -- QuickBooks からすぐ（20261026090000, Moto 2026-10-18・UI案56）：Gmail の接続・つなぐ途中・知らせの表 3 つ（ブラウザーからは読めない）、
  -- 関数 21 個（ブラウザーからは動かせない）、台帳の「Gmail で調べた」の欄、知らせの出し先の設定。送る担当を「このシステム」にするのは
  -- qb.from の Gmail がつながっているときだけ（置き換えた設定の保存）。送る直前に予約・中身・設定をもう一度確かめる。
  coalesce((select count(*) = 3 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('invoice_gmail_auth', 'invoice_gmail_oauth', 'invoice_qb_alerts') and c.relrowsecurity)
    and (select count(*) = 21 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_gmail_public', 'invoice_gmail_start', 'invoice_gmail_take', 'invoice_gmail_save', 'invoice_gmail_creds',
        'invoice_gmail_mark', 'invoice_gmail_disconnect', 'invoice_qb_has_due', 'invoice_qb_send_context', 'invoice_qb_send_check', 'invoice_qb_content_changed',
        'invoice_qb_unknown_due', 'invoice_qb_gmail_checked', 'invoice_qb_row', 'invoice_qb_status', 'invoice_qb_alerts_publish', 'invoice_qb_alert_put',
        'invoice_qb_alert_scan', 'invoice_qb_alert_claim', 'invoice_qb_alert_done', 'invoice_line_route')
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
    and (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_qb_outbox'
      and column_name in ('gmail_checked_at', 'gmail_checks'))
    and exists(select 1 from public.invoice_settings where key = 'qb_notify')
    and (select bool_and(case p.proname when 'invoice_settings_save' then p.prosrc like '%gmail_not_ready%' and p.prosrc like '%route_since%'
        when 'invoice_config' then p.prosrc like '%invoice_gmail_public%'
        when 'invoice_qb_send_check' then p.prosrc like '%13 minutes%' and p.prosrc like '%invoice_qb_send_context%' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('invoice_settings_save', 'invoice_config', 'invoice_qb_send_check')), false) as qb_gmail;
