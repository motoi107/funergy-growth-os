-- メニュータブ（UI案54）の元データを 1 つの表で見る（読むだけ・何も変えない）。そのまま Claude に貼ってください（お客様の情報・金額は出ません）。
-- 10/17 に menu-data-check.sql を流したときは、最後の 1 つ（モディファイヤー）の結果だけが出た（Supabase の画面は最後の結果だけを出す）。
-- 10/17 の結果：モディファイヤーの行は Marujuu（F05）だけ・8/14 から・名前 3 種類・親の商品 3 つ。
-- part の見方：
--   column … 4 つの表の列（table・列の名前・型）
--   index  … 一意の鍵（取り直しても二重にならないか）
--   daily  … 店舗ごとの商品の出数の行（日別の行・月の合計だけの行・最初と最後の日・日数）
--   category … メニューのカテゴリーの値（店舗ごと・商品の数・有効な商品の数）
select 'column' part, table_name a, column_name b, data_type c, ordinal_position::text d, '' e
from information_schema.columns
where table_schema = 'public' and table_name in ('toast_item_sales', 'toast_menu_items', 'toast_item_modifier_sales', 'toast_sales')
union all
select 'index', tablename, indexname, left(indexdef, 300), '', ''
from pg_indexes
where schemaname = 'public' and tablename in ('toast_item_sales', 'toast_menu_items', 'toast_item_modifier_sales', 'toast_sales')
union all
select 'daily', s.id, s.name,
  (count(*) filter (where coalesce(r.j->>'business_date', r.j->>'date', '') <> ''))::text || ' 日別の行 / ' ||
  (count(*) filter (where coalesce(r.j->>'business_date', r.j->>'date', '') = ''))::text || ' 月の行',
  coalesce(min(coalesce(r.j->>'business_date', r.j->>'date')), '') || ' 〜 ' || coalesce(max(coalesce(r.j->>'business_date', r.j->>'date')), ''),
  count(distinct coalesce(r.j->>'business_date', r.j->>'date'))::text || ' 日'
from (select id, name, toast_guid from public.stores where coalesce(toast_guid, '') <> '') s
join (select to_jsonb(t) j from public.toast_item_sales t) r on r.j->>'restaurant_guid' = s.toast_guid
group by s.id, s.name
union all
select 'category', s.id, coalesce(m.j->>'category', '（空）'), count(*)::text || ' 品',
  (count(*) filter (where coalesce(m.j->>'active', 'true') <> 'false'))::text || ' 有効', ''
from (select id, toast_guid from public.stores where coalesce(toast_guid, '') <> '') s
join (select to_jsonb(t) j from public.toast_menu_items t) m on m.j->>'restaurant_guid' = s.toast_guid
group by s.id, coalesce(m.j->>'category', '（空）')
order by 1, 2, 3;
