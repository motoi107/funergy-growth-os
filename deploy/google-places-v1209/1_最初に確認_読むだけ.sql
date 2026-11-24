-- v1209 Google の評価・口コミ（Places API（新））：入れる前の確認（読むだけ・何も変えない）。
-- result に STOP が 1 つも無ければ ② へ。place ID は出しません（店の ID だけ）。
with c as (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'gr_settings'),
sc as (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'stores'),
pc as (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'gr_places')
select '1. v1157 の SQL（Google の口コミ）が入っている' as check_name,
  case when to_regclass('public.gr_settings') is not null and to_regclass('public.gr_places') is not null
        and to_regprocedure('public.gr_place_of(jsonb)') is not null then 'OK'
    else 'STOP（先に deploy/google-reviews-v1157 の ② を流す）' end as result
union all select '2. v1209 の SQL（②）',
  case when (select count(*) from c where column_name in ('places_day_max','places_store_day_max','places_person_day_max','places_month_max','search_day_max','search_month_max')) = 6
        and to_regclass('public.gr_places_use') is not null then 'もう入っている（② をもう一度流しても同じ）' else 'まだ（② を流す）' end
union all select '2b. 住所で確かめる SQL（2b）',
  case when to_regclass('public.gr_place_hint') is not null and to_regprocedure('public.gr_place_confirm(jsonb)') is not null
    then 'もう入っている（2b をもう一度流しても同じ）' else 'まだ（② のあと 2b を流す）' end
union all select '3. 店舗マスター（public.stores）',
  case when to_regclass('public.stores') is null then 'なし（店の ID の形だけで確かめます）'
    when (select count(*) from sc where column_name = 'id') = 1 then 'OK' else 'STOP（Claude に：stores に id の列が無い）' end
union all select '4. Google の店を結んだ店のうち、店舗マスターに無い・使っていない店',
  case when to_regclass('public.gr_places') is null or to_regclass('public.stores') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(p.store_id, '', '' order by p.store_id), ''OK（無し）'') v from public.gr_places p where not exists (select 1 from public.stores st where st.id::text = p.store_id'
      || case when exists (select 1 from sc where column_name = 'active') then ' and coalesce(st.active, true)' else '' end
      || case when exists (select 1 from sc where column_name = 'data') then ' and coalesce(st.data->>''_deleted'', '''') not in (''true'', ''1'')' else '' end
      || ')', false, false, '')))[1]::text, 'OK（無し）') end
union all select '5. Head Chef の確かめ（wr_person_conf・wr_person_live）',
  case when to_regprocedure('public.wr_person_conf(text)') is not null and to_regprocedure('public.wr_person_live(text)') is not null then 'OK（確かめた Head Chef は全店）'
    else 'なし（Head Chef は自分の店だけになります・止めなくてよい）' end
union all select '（参考）Google の店を結んだ店（店の ID だけ）',
  case when to_regclass('public.gr_places') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select coalesce(string_agg(store_id, '', '' order by store_id), ''まだ無し'') v from public.gr_places', false, false, '')))[1]::text, 'まだ無し') end
union all select '（参考）2b のあと確かめ直すまで Google を呼ばない店（結んであるが住所で確かめていない）',
  case when to_regclass('public.gr_places') is null then '—'
    when (select count(*) from pc where column_name in ('confirmed_place','confirm_how')) < 2 then
      coalesce((xpath('/table/row/v/text()', query_to_xml('select coalesce(string_agg(store_id, '', '' order by store_id), ''無し'') v from public.gr_places', false, false, '')))[1]::text, '無し')
    else coalesce((xpath('/table/row/v/text()', query_to_xml(
      'select coalesce(string_agg(store_id, '', '' order by store_id), ''無し'') v from public.gr_places where confirmed_place is null or confirmed_place <> place_id or confirm_how is null',
      false, false, '')))[1]::text, '無し') end;
