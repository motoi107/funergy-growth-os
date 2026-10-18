-- 食材マスターの「今のマスター」（表 ingredients）だけを見る（読むだけ・何も変えない）。
-- 10/17 に ingredient-master-export.sql を流したときは、最後の 1 つ（新マスター）の結果だけが出た（Supabase の画面は最後の結果だけを出す）。
-- 結果を「Download CSV」で保存して Claude に添付してください（リポジトリには入れません）。
-- 1 つ目：今のマスター。owners＝その品目を棚卸表に入れている店（Totoya 3 店は TOTOYA）。
select
  i.code,
  i.data->>'name' name_ja,
  i.data->>'nameEN' name_en,
  i.data->>'cat' cat,
  i.data->>'cls' cls,
  i.data->>'vendor' vendor,
  i.data->>'subVendor' sub_vendor,
  i.data->>'sku' vendor_code,
  i.data->>'pack' pack,
  i.data->>'unit' count_unit,
  i.data->>'qty' qty_per_purchase,
  i.data->>'orderUnit' order_unit,
  i.data->>'price' price,
  i.data->>'yield' yield_pct,
  case when jsonb_typeof(i.data->'aliases') = 'array' then jsonb_array_length(i.data->'aliases') else 0 end alias_count,
  (select string_agg(k, ' ') from jsonb_object_keys(case when jsonb_typeof(i.data->'storePrices') = 'object' then i.data->'storePrices' else '{}'::jsonb end) k) store_prices,
  (select string_agg(o.owner, ' ' order by o.owner) from (
     select substr(a.key, 23) owner
     from public.app_state a
     cross join lateral (select a.value::jsonb j) jv
     cross join lateral (select case
         when jsonb_typeof(jv.j) = 'array' then jv.j                                          -- 品目コードの配列
         when jsonb_typeof(jv.j -> 'v') = 'array' then jv.j -> 'v'                            -- アプリの保存の形 {__st:1, v:[…]}（v750 から）
         when jsonb_typeof(jv.j -> 'v' -> 'v') = 'array' then jv.j -> 'v' -> 'v'              -- 二重に包まれた形
         when jsonb_typeof(jv.j -> substr(a.key, 23)) = 'array' then jv.j -> substr(a.key, 23)  -- {店: […]}
         else '[]'::jsonb end lst) l
     where left(a.key, 22) = 'spl_store_ingredients_'   -- 店の棚卸表の行だけ（_ を 1 文字の何でもにしない）
       and (l.lst @> to_jsonb(array[i.code::text])      -- Codex 10/17：or を括弧でくくる（無かったので、ほかの行が店に混ざった）
            or case when i.code::text ~ '^\d+$' then l.lst @> to_jsonb(array[i.code::text::numeric]) else false end)   -- 数字のコードだけ数でも比べる（null を作らない）
  ) o) owners,
  concat_ws(' ',
    case when coalesce(i.data->>'nameEN', '') = '' then '英語名' end,
    case when coalesce(i.data->>'unit', '') = '' then '数える単位' end,
    case when coalesce(i.data->>'qty', '') in ('', '0') then '内容量' end,
    case when coalesce(i.data->>'vendor', '') = '' then '仕入先' end,
    case when coalesce(i.data->>'price', '') in ('', '0') then '価格' end) missing
from public.ingredients i
order by i.code;
