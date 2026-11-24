-- v1209 Google の評価・口コミ（Places API（新））：入れたあとの確認（② と 2b のあと・読むだけ・何も変えない）。result に NG が 1 つも無ければ次へ。
-- place ID・店の名前・住所は出しません（店の ID だけ）。
with f as (select p.oid, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gr\_%'),
c as (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'gr_settings'),
ok2b as (select to_regclass('public.gr_place_hint') is not null and to_regprocedure('public.gr_place_confirm(jsonb)') is not null
           and to_regprocedure('public.gr_places_admin(jsonb)') is not null and to_regprocedure('public.gr_places_caps(jsonb)') is not null as y)
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
union all select '4. 関数 gr_* が 37 個・どれもサーバーの鍵で動く（security definer でない）',
  case when (select count(*) from f) = 37 and not exists (select 1 from f where prosecdef) then 'OK'
    else 'NG（' || (select count(*) from f) || ' 個）' end
union all select '5. 公開の鍵（anon・authenticated）は関数 gr_* を呼べない',
  case when exists (select 1 from f, unnest(array['anon','authenticated']) r(role) where has_function_privilege(r.role, f.oid, 'EXECUTE'))
    then 'NG（Claude に）' else 'OK' end
union all select '6. サーバーの鍵（service_role）は関数を呼べる',
  case when not exists (select 1 from f where not has_function_privilege('service_role', f.oid, 'EXECUTE')) and (select count(*) from f) > 0 then 'OK' else 'NG' end
union all select '7. 店を結ぶのは住所で確かめてから・Google を呼ぶのは確かめた店だけ（gr_place_set・gr_place_of・gr_places_take）',
  case when not (select y from ok2b) then 'NG（2b を流す）'
    when exists (select 1 from f where proname = 'gr_place_set' and pg_get_functiondef(f.oid) like '%use_confirm%')
     and exists (select 1 from f where proname = 'gr_place_of' and pg_get_functiondef(f.oid) like '%gr_place_ok%')
     and exists (select 1 from f where proname = 'gr_places_take' and pg_get_functiondef(f.oid) like '%not_confirmed%')
     and exists (select 1 from f where proname = 'gr_place_confirm' and pg_get_functiondef(f.oid) like '%unknown_store%' and pg_get_functiondef(f.oid) like '%shared%')
     and exists (select 1 from f where proname = 'gr_fold') then 'OK'
    else 'NG（v1157 か ② の SQL をあとで流した：2b をもう一度）' end
union all select '8. Google の店を結んだ店はどれも店舗マスターにある',
  case when to_regprocedure('public.gr_store_known(jsonb)') is null then 'NG（② をもう一度）'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(''NG（'' || string_agg(store_id, '', '' order by store_id) || ''：アプリで外すか店舗マスターを確かめる）'', ''OK'') v from public.gr_places where not public.gr_store_known(jsonb_build_object(''store'', store_id))',
      false, false, '')))[1]::text, 'OK') end
union all select '9. 店の住所の目安の表（gr_place_hint）があり RLS が ON・公開の鍵は読めない・書けない',
  case when to_regclass('public.gr_place_hint') is null then 'NG（2b を流す）'
    when not (select relrowsecurity from pg_class where oid = to_regclass('public.gr_place_hint')) then 'NG（2b をもう一度）'
    when exists (select 1 from unnest(array['anon','authenticated']) r(role), unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr(priv)
      where has_table_privilege(r.role, 'public.gr_place_hint', pr.priv)) then 'NG（Claude に）' else 'OK' end
union all select '10. 同じ Google の店を 2 つの店に確かめない（索引 gr_places_confirmed_uq）',
  case when to_regclass('public.gr_places_confirmed_uq') is not null then 'OK' else 'NG（2b を流す）' end
union all select '（参考）上限のはじめの値（店の評価と口コミ：1 日の天井・1 店 1 日・1 人 1 日・月の天井／店を探す・確かめる：1 日・月）',
  case when (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) < 6 then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select places_day_max || ''・'' || places_store_day_max || ''・'' || places_person_day_max || ''・'' || places_month_max
      || ''／'' || search_day_max || ''・'' || search_month_max v from public.gr_settings where id = 1', false, false, '')))[1]::text end
union all select '（参考）今の上限（確かめた店の数から：店の数・1 日・月）',
  case when to_regprocedure('public.gr_places_caps(jsonb)') is null or (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) < 6 then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select (k->>''stores'') || '' 店・1 日 '' || (k->>''day_max'') || '' 回・月 '' || (k->>''month_max'') || '' 回'' v
      from (select public.gr_places_caps(''{}''::jsonb) k) x', false, false, '')))[1]::text end
union all select '（参考）今日・今月の回数（店の評価と口コミ／店を探す・確かめる・太平洋時間）',
  case when to_regprocedure('public.gr_places_usage(jsonb)') is null or (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) < 6 then '—'
    else (xpath('/table/row/v/text()', query_to_xml('select (u->''now''->>''day'') || ''・'' || (u->''now''->>''month'') || ''／'' || (u->''search''->>''day'') || ''・'' || (u->''search''->>''month'') v
      from (select public.gr_places_usage(''{}''::jsonb) u) x', false, false, '')))[1]::text end
union all select '（参考）住所で確かめた店（店の ID・確かめ方：住所＝住所と名前が合った／手＝GM・CEO が地図で確かめた）',
  case when not (select y from ok2b) then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(store_id || ''（'' || case confirm_how when ''manual'' then ''手'' else ''住所'' end || ''）'', '', '' order by store_id), ''まだ無し'') v from public.gr_places pl where public.gr_place_ok(pl)',
      false, false, '')))[1]::text, 'まだ無し') end
union all select '（参考）結んであるが確かめていない店（GM・CEO が KPI設定で選び直すまで Google を呼ばない）',
  case when not (select y from ok2b) then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(store_id, '', '' order by store_id), ''無し'') v from public.gr_places pl where not public.gr_place_ok(pl)',
      false, false, '')))[1]::text, '無し') end
union all select '（参考）住所の目安の無い店（店舗マスターの店。選ぶ前に目安を SQL で足す：手順.md）',
  case when not (select y from ok2b) or to_regclass('public.stores') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(x, '', '' order by x), ''無し'') v from unnest(public.gr_store_ids(''{}''::jsonb)) x where not exists (select 1 from public.gr_place_hint h where h.store_id = x)',
      false, false, '')))[1]::text, '無し') end
union all select '（参考）手で確かめる店（同じ建物にほかの店・Google マップにあるか未確認）',
  case when to_regclass('public.gr_place_hint') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(store_id, '', '' order by store_id), ''無し'') v from public.gr_place_hint where unsure',
      false, false, '')))[1]::text, '無し') end;
