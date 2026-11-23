-- v1209 Google の評価・口コミ（Places API（新））：入れたあとの確認（読むだけ・何も変えない）。result に NG が 1 つも無ければ次へ。
with f as (select p.oid, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gr\_%'),
c as (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'gr_settings')
select '1. 回数の上限の欄が 6 つある' as check_name,
  case when (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) = 6
    then 'OK' else 'NG（② をもう一度）' end as result
union all select '2. 回数の表（gr_places_use）があり RLS が ON',
  case when to_regclass('public.gr_places_use') is not null
        and (select relrowsecurity from pg_class where oid = to_regclass('public.gr_places_use')) then 'OK' else 'NG（② をもう一度）' end
union all select '3. 公開の鍵（anon・authenticated）は回数の表を読めない・書けない',
  case when to_regclass('public.gr_places_use') is null then 'NG'
    when exists (select 1 from unnest(array['anon','authenticated']) r(role), unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr(priv)
      where has_table_privilege(r.role, 'public.gr_places_use', pr.priv)) then 'NG（Claude に）' else 'OK' end
union all select '4. 関数 gr_* が 26 個・どれもサーバーの鍵で動く（security definer でない）',
  case when (select count(*) from f) = 26 and not exists (select 1 from f where prosecdef) then 'OK'
    else 'NG（' || (select count(*) from f) || ' 個）' end
union all select '5. 公開の鍵（anon・authenticated）は関数 gr_* を呼べない',
  case when exists (select 1 from f, unnest(array['anon','authenticated']) r(role) where has_function_privilege(r.role, f.oid, 'EXECUTE'))
    then 'NG（Claude に）' else 'OK' end
union all select '6. サーバーの鍵（service_role）は関数を呼べる',
  case when not exists (select 1 from f where not has_function_privilege('service_role', f.oid, 'EXECUTE')) and (select count(*) from f) > 0 then 'OK' else 'NG' end
union all select '7. 店を結ぶときに店舗マスターを確かめる（gr_place_set）',
  case when exists (select 1 from f where proname = 'gr_place_set' and pg_get_functiondef(f.oid) like '%unknown_store%') then 'OK'
    else 'NG（v1157 の ② をあとで流した：v1209 の ② をもう一度）' end
union all select '8. Google の店を結んだ店はどれも店舗マスターにある',
  case when to_regprocedure('public.gr_store_known(jsonb)') is null then 'NG（② をもう一度）'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(''NG（'' || string_agg(store_id, '', '' order by store_id) || ''：アプリで外すか店舗マスターを確かめる）'', ''OK'') v from public.gr_places where not public.gr_store_known(jsonb_build_object(''store'', store_id))',
      false, false, '')))[1]::text, 'OK') end
union all select '（参考）上限（店の評価と口コミ：1 日・1 店 1 日・1 人 1 日・月／店を探す：1 日・月）',
  case when (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) < 6 then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select places_day_max || ''・'' || places_store_day_max || ''・'' || places_person_day_max || ''・'' || places_month_max
      || ''／'' || search_day_max || ''・'' || search_month_max v from public.gr_settings where id = 1', false, false, '')))[1]::text end
union all select '（参考）今日・今月の回数（店の評価と口コミ／店を探す・太平洋時間）',
  case when to_regprocedure('public.gr_places_usage(jsonb)') is null or (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) < 6 then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select (u->''now''->>''day'') || ''・'' || (u->''now''->>''month'') || ''／'' || (u->''search''->>''day'') || ''・'' || (u->''search''->>''month'') v
      from (select public.gr_places_usage(''{}''::jsonb) u) x', false, false, '')))[1]::text end
union all select '（参考）Google の店を結んだ店（店の ID だけ）',
  case when to_regclass('public.gr_places') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select coalesce(string_agg(store_id, '', '' order by store_id), ''まだ無し'') v from public.gr_places', false, false, '')))[1]::text, 'まだ無し') end;
