-- v1157 Google の口コミ：入れたあとの確認（読むだけ・何も変えない）。result に NG が 1 つも無ければ次へ。
with t(n) as (values ('gr_settings'),('gr_places'),('gr_bp'),('gr_oauth'),('gr_bp_loc'),('gr_reviews'),('gr_runs')),
f as (select p.oid, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'gr\_%')
select '1. 表が 7 つある' as check_name,
  case when (select count(*) from t where to_regclass('public.' || t.n) is not null) = 7 then 'OK' else 'NG（② をもう一度）' end as result
union all select '2. 表はどれも RLS が ON',
  case when (select count(*) from t join pg_class c on c.oid = to_regclass('public.' || t.n) where c.relrowsecurity) = 7 then 'OK' else 'NG' end
union all select '3. 公開の鍵（anon・authenticated）は表を読めない・書けない',
  case when exists (select 1 from t, unnest(array['anon','authenticated']) r(role), unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr(priv)
      where to_regclass('public.' || t.n) is not null and has_table_privilege(r.role, 'public.' || t.n, pr.priv)) then 'NG（Claude に）' else 'OK' end
union all select '4. 関数 gr_* が 20 個・どれもサーバーの鍵で動く（security definer でない）',
  case when (select count(*) from f) = 20 and not exists (select 1 from f where prosecdef) then 'OK'
    else 'NG（' || (select count(*) from f) || ' 個）' end
union all select '5. 公開の鍵（anon・authenticated）は関数 gr_* を呼べない',
  case when exists (select 1 from f, unnest(array['anon','authenticated']) r(role) where has_function_privilege(r.role, f.oid, 'EXECUTE'))
    then 'NG（Claude に）' else 'OK' end
union all select '6. サーバーの鍵（service_role）は関数を呼べる',
  case when not exists (select 1 from f where not has_function_privilege('service_role', f.oid, 'EXECUTE')) and (select count(*) from f) > 0 then 'OK' else 'NG' end
union all select '7. 口コミを全部取れている最初の月（from_ym）の欄がある',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gr_bp_loc' and column_name = 'from_ym') then 'OK' else 'NG（② をもう一度）' end
union all select '8. 毎日の取り込みの鍵ができている（中身は出さない）',
  case when to_regclass('public.gr_settings') is null then 'NG'
    else (xpath('/table/row/v/text()', query_to_xml('select case when length(worker_key) >= 32 then ''OK'' else ''NG'' end v from public.gr_settings where id = 1', false, false, '')))[1]::text end
union all select '9. 段（gr_stage）',
  case when to_regprocedure('public.gr_stage(jsonb)') is null then 'NG'
    else (xpath('/table/row/v/text()', query_to_xml('select case when public.gr_stage(''{}''::jsonb)->>''gr'' = ''2'' then ''OK'' else ''NG'' end v', false, false, '')))[1]::text end
union all select '10. 1 つの Business Profile の店は 1 つの店だけ（索引 gr_bp_loc_location）',
  case when to_regclass('public.gr_bp_loc_location') is not null then 'OK' else 'NG（② をもう一度）' end
union all select '（参考）Business Profile のつなぎ',
  case when to_regclass('public.gr_bp') is null then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select status v from public.gr_bp where id = 1', false, false, '')))[1]::text end
union all select '（参考）Google の店（place ID）を決めた店の数',
  case when to_regclass('public.gr_places') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml('select count(*) n from public.gr_places', false, false, '')))[1]::text end
union all select '（参考）Business Profile に結んだ店の数',
  case when to_regclass('public.gr_bp_loc') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml('select count(*) n from public.gr_bp_loc', false, false, '')))[1]::text end
union all select '（参考）残っている口コミの数',
  case when to_regclass('public.gr_reviews') is null then '—'
    else (xpath('/table/row/n/text()', query_to_xml('select count(*) n from public.gr_reviews', false, false, '')))[1]::text end
union all select '（参考）毎日の取り込み（cron）',
  case when to_regclass('cron.job') is null then '—（pg_cron なし）'
    else (xpath('/table/row/v/text()', query_to_xml('select coalesce(max(schedule || case when active then '''' else ''（止まっている）'' end), ''まだ（⑤）'') v from cron.job where jobname = ''google-reviews-daily''', false, false, '')))[1]::text end;
