-- ⑦ メニュータブ：商品別の出数（toast_item_sales）が、店・月ごとにどこまで入っているか（読むだけ。何も書き換えません）。
-- 1 行 ＝ 店 × 月。そのまま Claude に貼ってください（お客様の情報・金額は出ません。出数と行の数だけ）。
--   rows ………… 行の数。dated_rows … 日付のある行（日別の行）。month_rows … 日付の無い行（月のまとめの行）
--   days ………… 出数のある日の数。first_day・last_day … 最初と最後の日
--   missing_days … その月の 1 日から月末（今月は昨日）までで、行の無い日の数（定休日も数えます）
--   items ……… 商品（item_guid）の数。no_guid … 商品の印の無い行の数
--   qty ………… 出数の合計
--   dup_groups … 同じ日・同じ商品の行が 2 つ以上ある組の数（二重に数えている疑い）
--   both_kinds … 同じ商品で、日別の行と月のまとめの行の両方がある数（足すと二重になる疑い）
with st as (select id, name, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
r as (
  select st.id as store_id, to_jsonb(t) as j from public.toast_item_sales t join st on st.toast_guid = t.restaurant_guid
),
x as (
  select store_id,
         coalesce(j ->> 'business_month', left(coalesce(j ->> 'business_date', j ->> 'date'), 7)) as ym,
         nullif(left(coalesce(j ->> 'business_date', j ->> 'date', ''), 10), '') as d,
         nullif(coalesce(j ->> 'item_guid', j ->> 'guid', ''), '') as item,
         coalesce((j ->> 'qty')::numeric, 0) as qty
    from r
),
dup as (select store_id, ym, count(*) as n from (select store_id, ym, d, item from x where d is not null and item is not null group by 1, 2, 3, 4 having count(*) > 1) z group by 1, 2),
both_k as (select store_id, ym, count(*) as n from (select store_id, ym, item from x where item is not null group by 1, 2, 3 having bool_or(d is null) and bool_or(d is not null)) z group by 1, 2),
m as (
  select store_id, ym, count(*) as rows, count(d) as dated_rows, count(*) - count(d) as month_rows,
         count(distinct d) as days, min(d) as first_day, max(d) as last_day,
         count(distinct item) as items, count(*) - count(item) as no_guid, sum(qty) as qty
    from x group by 1, 2
)
select m.store_id, m.ym, m.rows, m.dated_rows, m.month_rows, m.days, m.first_day, m.last_day,
       case when m.last_day is null then null else
         (least(((m.ym || '-01')::date + interval '1 month' - interval '1 day')::date, (now() at time zone 'Pacific/Honolulu')::date - 1)
          - (m.ym || '-01')::date + 1) - m.days end as missing_days,
       m.items, m.no_guid, m.qty, coalesce(dup.n, 0) as dup_groups, coalesce(both_k.n, 0) as both_kinds
  from m left join dup using (store_id, ym) left join both_k using (store_id, ym)
 where m.ym >= to_char((now() at time zone 'Pacific/Honolulu')::date - 400, 'YYYY-MM')
 order by m.store_id, m.ym;
