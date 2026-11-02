-- LaLa（F06）の来店区分（FT・RP・SR）とメニュー出数が、どこで欠けているかを見る（11/02・読むだけ・何も変えない）。
-- ToriTon（F01）・Tenkichi（F02）と比べます。結果は 1 つの表で出ます。全部の行をそのまま Claude に貼ってください。
-- お客様の名前・電話・カードは出ません（店の数・商品名・商品の ID の末尾 8 文字だけ）。
--
-- 見方（part の列）：
--   1 cols ……… 3 つの表（toast_sales・toast_menu_items・recipes）の列の名前
--   2 menu_n …… 店ごとの Toast のメニューの表（toast_menu_items）の行の数・Customers の行の数・最後に書いた時刻
--   3 cust ……… ToriTon・Tenkichi：Customers のグループの商品ごとの出数（直近 30 日）と、同じ日の toast_sales の FT・RP・SR の合計
--                （FT・RP・SR を「どの数で数えているか」を、商品の出数と比べて確かめる）
--   4 lala_d …… LaLa の直近 14 日の 1 日ずつ：売上・客数・FT・RP・SR・売上を取り込んだ時刻・出数の行・出数の合計・商品の数・出数を取り込んだ時刻
--   5 lala_i …… LaLa の出数の商品（直近 30 日・出数の多い順に 60）：ID の末尾・出数・出た日の数・レシピに結ばれているか（名前・カテゴリー）
--   6 recipe … LaLa のレシピ（recipes の表）：Toast の ID のあるレシピの数・カテゴリーごとの数
with st as (
  select id, name, toast_guid from public.stores where id in ('F01', 'F02', 'F06') and coalesce(toast_guid, '') <> ''
),
hst as (select (now() at time zone 'Pacific/Honolulu')::date today),
ts as (
  select st.id store, j->>'business_date' d,
    case when coalesce(j->>'net_sales', '') ~ '^-?\d+(\.\d+)?$' then (j->>'net_sales')::numeric end sales,
    case when coalesce(j->>'guest_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'guest_count')::numeric end guests,
    case when coalesce(j->>'first_time_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'first_time_count')::numeric end ft,
    case when coalesce(j->>'repeat_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'repeat_count')::numeric end rp,
    case when coalesce(j->>'super_regular_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'super_regular_count')::numeric end sr,
    coalesce(j->>'fetched_at', j->>'updated_at', j->>'synced_at', j->>'created_at') fetched
  from public.toast_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid', hst
  where coalesce(j->>'business_date', '') >= (hst.today - 45)::text
),
ti as (
  select st.id store, nullif(left(coalesce(j->>'business_date', j->>'date', ''), 10), '') d,
    coalesce(j->>'item_guid', j->>'guid', '') item,
    case when coalesce(j->>'qty', j->>'quantity', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'qty', j->>'quantity')::numeric else 0 end q,
    coalesce(j->>'synced_at', j->>'updated_at', j->>'created_at') synced
  from public.toast_item_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid', hst
  where coalesce(j->>'business_date', j->>'date', '') >= (hst.today - 45)::text
),
mi as (
  select s.id store, coalesce(j->>'guid', j->>'item_guid', '') item, coalesce(j->>'name', '') nm,
    coalesce(j->>'category', j->>'group_name', j->>'menu_group', '') cat,
    coalesce(j->>'updated_at', j->>'synced_at', j->>'created_at') upd
  from public.toast_menu_items t cross join lateral (select to_jsonb(t) j) x
  join public.stores s on coalesce(s.toast_guid, '') <> '' and s.toast_guid = j->>'restaurant_guid'
),
rc as (
  select coalesce(j->'data'->>'storeId', j->>'store', '') store, coalesce(j->>'toast_guid', j->'data'->>'toastGuid', '') item,
    coalesce(j->>'name', '') nm, coalesce(j->>'category', j->'data'->>'category', '') cat
  from public.recipes t cross join lateral (select to_jsonb(t) j) x
),
cust as (   -- Customers のグループの商品（大文字小文字・前後の空白は見ない・完全一致）。アプリと hyper-worker の決まり
  select distinct on (store, item) store, item, nm from mi where item <> '' and lower(btrim(cat)) = 'customers' order by store, item, (nm = ''), nm
),
d30 as (select (hst.today - 30)::text since, (hst.today - 1)::text until from hst)
select part, store, a, b, c, d, e, f, g from (
  select 1 o, 'cols' part, c.table_name store, string_agg(c.column_name, ', ' order by c.ordinal_position) a,
         null b, null c, null d, null e, null f, null g
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('toast_sales', 'toast_menu_items', 'recipes')
   group by c.table_name
  union all
  select 2, 'menu_n', s.id, s.name, 'rows ' || count(m.item), 'customers ' || count(m.item) filter (where lower(btrim(m.cat)) = 'customers'),
         'categories ' || count(distinct nullif(btrim(m.cat), '')), 'last ' || coalesce(max(m.upd), '-'), null, null
    from public.stores s left join mi m on m.store = s.id
   where coalesce(s.toast_guid, '') <> '' group by s.id, s.name
  union all
  select 3, 'cust', c.store, c.nm, '…' || right(c.item, 8),
         'qty ' || coalesce((select sum(q) from ti, d30 where ti.store = c.store and ti.item = c.item and ti.d between d30.since and d30.until), 0),
         'days ' || (select count(distinct d) from ti, d30 where ti.store = c.store and ti.item = c.item and ti.d between d30.since and d30.until),
         null, null, null
    from cust c where c.store in ('F01', 'F02')
  union all
  select 3, 'cust', t.store, '(toast_sales)', null,
         'FT ' || coalesce(sum(t.ft), 0) || ' / RP ' || coalesce(sum(t.rp), 0) || ' / SR ' || coalesce(sum(t.sr), 0),
         'days ' || count(*) filter (where coalesce(t.sales, 0) > 0),
         'guests ' || coalesce(sum(t.guests), 0), null, null
    from ts t, d30 where t.store in ('F01', 'F02') and t.d between d30.since and d30.until group by t.store
  union all
  select 4, 'lala_d', 'F06', t.d,
         'sales ' || coalesce(t.sales::text, '-') || ' / guests ' || coalesce(t.guests::text, '-'),
         'FT ' || coalesce(t.ft::text, 'null') || ' / RP ' || coalesce(t.rp::text, 'null') || ' / SR ' || coalesce(t.sr::text, 'null'),
         'sales_fetched ' || coalesce(t.fetched, '-'),
         'item_rows ' || (select count(*) from ti where ti.store = 'F06' and ti.d = t.d)
           || ' / qty ' || coalesce((select sum(q) from ti where ti.store = 'F06' and ti.d = t.d), 0)
           || ' / items ' || (select count(distinct nullif(item, '')) from ti where ti.store = 'F06' and ti.d = t.d),
         'items_synced ' || coalesce((select max(synced) from ti where ti.store = 'F06' and ti.d = t.d), '-'), null
    from ts t, hst where t.store = 'F06' and t.d >= (hst.today - 14)::text
  union all
  select 5, 'lala_i', 'F06', '…' || right(z.item, 8), 'qty ' || z.q, 'days ' || z.n,
         coalesce((select string_agg(distinct coalesce(nullif(r.nm, ''), '(no name)') || ' [' || coalesce(nullif(r.cat, ''), '-') || ']', ' | ')
                     from rc r where r.item = z.item), '（レシピなし）'),
         coalesce((select string_agg(distinct m.store || ':' || m.nm || ' [' || m.cat || ']', ' | ') from mi m where m.item = z.item), '（メニューの表になし）'),
         null, null
    from (select item, sum(q) q, count(distinct d) n, row_number() over (order by sum(q) desc, item) rk
            from ti, d30 where store = 'F06' and item <> '' and d between d30.since and d30.until group by item) z
   where z.rk <= 60
  union all
  select 6, 'recipe', 'F06', coalesce(nullif(btrim(cat), ''), '（カテゴリーなし）'), 'recipes ' || count(*),
         'with_toast_id ' || count(*) filter (where item <> ''), null, null, null, null
    from rc where store = 'F06' group by coalesce(nullif(btrim(cat), ''), '（カテゴリーなし）')
) z
order by o, part, store, a, b;
