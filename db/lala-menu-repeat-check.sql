-- LaLa（F06）のメニュー出数とリピート率（FT・RP・SR）がどこで欠けているかを、ToriTon（F01）・Tenkichi（F02）と比べて見る（読むだけ・何も変えない）。
-- 結果は 1 つの表で出ます。全部の行をそのまま Claude に貼ってください（お客様の名前・電話・カードは出ません。店の数と商品名だけ）。
--
-- 見方（part の列）：
--   cols ………… 4 つの表の列の名前（取込の形の確かめ用）
--   store ……… 店舗マスターの Toast の店（GUID の頭 8 文字）・同じ GUID の店の数
--   sales_m …… 売上の取込（toast_sales）の月ごと：行・売上のある日・FT・RP・SR の合計・来店区分のある日・売上はあるのに来店区分が無い日・最後に取り込んだ時刻
--   sales_d …… LaLa の最近 21 日の 1 日ずつ：売上・客数・FT・RP・SR（ランチ・ディナー）
--   items_m …… 商品の出数（toast_item_sales）の月ごと：行・日・出数の合計・商品の数・売上はあるのに出数の行が無い日
--   items_d …… LaLa の最近 21 日の 1 日ずつ：出数の行・合計・商品の数（売上のある日に行が無ければ「欠け」）
--   vt_name …… 名前に first・repeat・regular・FT・RP・SR・初回・リピ・常連・新規 を含む商品・モディファイヤー・メニュー（どこに・何回）
--   menu_cat … Toast のメニューのカテゴリーごとの商品の数（LaLa と ToriTon。Customers のようなグループがあるか）
with st as (
  select id, name, toast_guid from public.stores where id in ('F01', 'F02', 'F06')
),
ts as (
  select st.id store, j from public.toast_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_date', '') >= '2026-08-01'
),
tsn as (
  select store, j->>'business_date' d, left(j->>'business_date', 7) ym,
    case when coalesce(j->>'net_sales', '') ~ '^-?\d+(\.\d+)?$' then (j->>'net_sales')::numeric end sales,
    case when coalesce(j->>'guest_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'guest_count')::numeric end guests,
    case when coalesce(j->>'first_time_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'first_time_count')::numeric end ft,
    case when coalesce(j->>'repeat_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'repeat_count')::numeric end rp,
    case when coalesce(j->>'super_regular_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'super_regular_count')::numeric end sr,
    coalesce(j->>'lunch_first_time_count', j->>'first_time_lunch_count') l_ft, coalesce(j->>'lunch_repeat_count', j->>'repeat_lunch_count') l_rp,
    coalesce(j->>'dinner_first_time_count', j->>'first_time_dinner_count') d_ft, coalesce(j->>'dinner_repeat_count', j->>'repeat_dinner_count') d_rp,
    coalesce(j->>'updated_at', j->>'synced_at', j->>'created_at') upd
  from ts
),
ti as (
  select st.id store, j from public.toast_item_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_month', left(coalesce(j->>'business_date', j->>'date', ''), 7)) >= '2026-08'
),
tin as (
  select store, nullif(left(coalesce(j->>'business_date', j->>'date', ''), 10), '') d,
    coalesce(j->>'business_month', left(coalesce(j->>'business_date', j->>'date', ''), 7)) ym,
    coalesce(j->>'item_guid', j->>'guid', '') item, coalesce(j->>'item_name', j->>'name', '') nm,
    case when coalesce(j->>'qty', j->>'quantity', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'qty', j->>'quantity')::numeric else 0 end q
  from ti
),
tm as (
  select st.id store, coalesce(j->>'modifier_name', j->>'name', '') nm,
    case when coalesce(j->>'qty', j->>'quantity', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'qty', j->>'quantity')::numeric else 1 end q
  from public.toast_item_modifier_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_date', '') >= '2026-08-01'
),
mi as (
  select st.id store, coalesce(j->>'name', '') nm, coalesce(j->>'category', j->>'group_name', j->>'menu_group', '') cat
  from public.toast_menu_items t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
),
pat as (select '(first|repeat|regular|\mft\M|\mrp\M|\msr\M|初回|リピ|常連|新規|customer)'::text p),
hst as (select (now() at time zone 'Pacific/Honolulu')::date today),
sd as (select store, d from tsn where coalesce(sales, 0) > 0),
idays as (select distinct store, d from tin where d is not null)
select * from (
  select 1 o, 'cols' part, c.table_name store, string_agg(c.column_name, ', ' order by c.ordinal_position) a, null b, null c, null d, null e, null f, null g
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('toast_sales', 'toast_item_sales', 'toast_item_modifier_sales', 'toast_menu_items')
   group by c.table_name
  union all
  select 2, 'store', s.id, s.name, case when coalesce(s.toast_guid, '') = '' then '（空）' else left(s.toast_guid, 8) || '…' end,
         (select count(*) from public.stores x where coalesce(x.toast_guid, '') <> '' and x.toast_guid = s.toast_guid)::text, null, null, null, null
    from st s
  union all
  select 3, 'sales_m', store, ym, 'rows ' || count(*) || ' / days_sales ' || count(*) filter (where coalesce(sales, 0) > 0),
         'FT ' || coalesce(sum(ft), 0) || ' / RP ' || coalesce(sum(rp), 0) || ' / SR ' || coalesce(sum(sr), 0),
         'days_with_vt ' || count(*) filter (where coalesce(ft, 0) + coalesce(rp, 0) + coalesce(sr, 0) > 0),
         'sales_no_vt ' || count(*) filter (where coalesce(sales, 0) > 0 and coalesce(ft, 0) + coalesce(rp, 0) + coalesce(sr, 0) = 0),
         'vt_null_days ' || count(*) filter (where ft is null and rp is null and sr is null),
         'last_upd ' || coalesce(max(upd), '-')
    from tsn group by store, ym
  union all
  select 4, 'sales_d', store, d, 'sales ' || coalesce(sales::text, '-') || ' / guests ' || coalesce(guests::text, '-'),
         'FT ' || coalesce(ft::text, 'null') || ' / RP ' || coalesce(rp::text, 'null') || ' / SR ' || coalesce(sr::text, 'null'),
         'L ' || coalesce(l_ft, 'null') || '/' || coalesce(l_rp, 'null') || ' · D ' || coalesce(d_ft, 'null') || '/' || coalesce(d_rp, 'null'),
         'upd ' || coalesce(upd, '-'), null, null
    from tsn, hst where store = 'F06' and d >= (hst.today - 21)::text
  union all
  select 5, 'items_m', i.store, i.ym, 'rows ' || count(*) || ' / dated ' || count(i.d) || ' / days ' || count(distinct i.d),
         'qty ' || coalesce(sum(i.q), 0) || ' / items ' || count(distinct nullif(i.item, '')),
         'sales_days_without_items ' || (select count(*) from sd where sd.store = i.store and left(sd.d, 7) = i.ym and not exists (select 1 from idays x where x.store = sd.store and x.d = sd.d)),
         null, null, null
    from tin i group by i.store, i.ym
  union all
  select 6, 'items_d', sd.store, sd.d,
         'rows ' || (select count(*) from tin where tin.store = sd.store and tin.d = sd.d),
         'qty ' || coalesce((select sum(q) from tin where tin.store = sd.store and tin.d = sd.d), 0),
         'items ' || (select count(distinct nullif(item, '')) from tin where tin.store = sd.store and tin.d = sd.d),
         case when exists (select 1 from idays x where x.store = sd.store and x.d = sd.d) then '' else '欠け（売上あり・出数の行なし）' end, null, null
    from sd, hst where sd.store = 'F06' and sd.d >= (hst.today - 21)::text
  union all
  select 7, 'vt_name', store, 'item', nm, 'qty ' || sum(q), null, null, null, null from tin, pat where nm ~* pat.p group by store, nm
  union all
  select 7, 'vt_name', store, 'modifier', nm, 'qty ' || sum(q), null, null, null, null from tm, pat where nm ~* pat.p group by store, nm
  union all
  select 7, 'vt_name', store, 'menu', nm, 'category ' || max(cat), null, null, null, null from mi, pat where nm ~* pat.p or cat ~* pat.p group by store, nm
  union all
  select 8, 'menu_cat', store, cat, 'items ' || count(*), null, null, null, null, null from mi where store in ('F01', 'F06') group by store, cat
) z
order by o, part, store, a, b;
