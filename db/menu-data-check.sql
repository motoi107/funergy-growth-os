-- メニュータブの出数・カテゴリー・モディファイヤーの元データを見る（読むだけ・何も変えない）。
-- 結果をそのまま Claude に貼ってください（お客様の情報・金額は出ません）。
--
-- なぜ：出数の表は Toast 取込（hyper-worker）が作っていて、そのソースがこのリポジトリに無い。
--   カテゴリー別出数推移とモディファイヤー内訳（UI案54）を作る前に、列・一意の鍵・いつからデータがあるかを確かめる。
-- 1 つ目：3 つの表（と売上の表）の列。
select table_name, ordinal_position, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('toast_item_sales', 'toast_menu_items', 'toast_item_modifier_sales', 'toast_sales')
order by table_name, ordinal_position;

-- 2 つ目：一意の鍵（取り直しても二重にならないか）。
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('toast_item_sales', 'toast_menu_items', 'toast_item_modifier_sales', 'toast_sales')
order by tablename, indexname;

-- 3 つ目：店舗ごとに、商品の出数の日別の行がいつからあるか（月の合計だけの古い行は日付が空）。
with s as (select id, name, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
r as (select to_jsonb(t) j from public.toast_item_sales t)
select s.id, s.name,
  count(*) filter (where coalesce(r.j->>'business_date', r.j->>'date', '') <> '') daily_rows,
  count(*) filter (where coalesce(r.j->>'business_date', r.j->>'date', '') = '') monthly_rows,
  min(coalesce(r.j->>'business_date', r.j->>'date')) first_day,
  max(coalesce(r.j->>'business_date', r.j->>'date')) last_day,
  count(distinct coalesce(r.j->>'business_date', r.j->>'date')) days
from s join r on r.j->>'restaurant_guid' = s.toast_guid
group by s.id, s.name
order by s.id;

-- 4 つ目：メニューのカテゴリーの値（店舗ごと・商品の数）。
with s as (select id, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
m as (select to_jsonb(t) j from public.toast_menu_items t)
select s.id, coalesce(m.j->>'category', '（空）') category, count(*) items,
  count(*) filter (where coalesce(m.j->>'active', 'true') <> 'false') active_items
from s join m on m.j->>'restaurant_guid' = s.toast_guid
group by s.id, coalesce(m.j->>'category', '（空）')
order by s.id, items desc;

-- 5 つ目：モディファイヤーの行がいつからあるか・名前の種類の数。
with s as (select id, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
d as (select to_jsonb(t) j from public.toast_item_modifier_sales t)
select s.id, count(*) mod_rows,
  min(d.j->>'business_date') first_day, max(d.j->>'business_date') last_day,
  count(distinct d.j->>'modifier_name') modifier_names,
  count(distinct d.j->>'item_guid') parent_items
from s join d on d.j->>'restaurant_guid' = s.toast_guid
group by s.id
order by s.id;
