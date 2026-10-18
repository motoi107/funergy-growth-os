-- 食材マスターの全件と、足りない項目を見る（読むだけ・何も変えない）。
-- 結果の 2 つの表を、Supabase の画面の「Download CSV」で保存して Claude に添付してください（リポジトリには入れません）。
-- Supabase の画面は最後の結果（2 つ目）だけを出すので、1 つ目は ingredient-master-export-current.sql で流してください。
--
-- なぜ：今の食材マスターは 2 つある。
--   ・今のマスター（表 ingredients・アプリの m_ingredients）：棚卸し・レシピの原価・食材移動が使う。数える単位（unit）・1 購入単位の内容量（qty）・価格・歩留
--   ・新マスター（app_state の m_ingredients_v2）：invoice の読取から作る。規格（spec）の欄があるが、棚卸し・原価・移動はまだ使っていない
--   全件と、どの店が使っているか、どの項目が空かを見て、調べる順番（使っている店が多い・棚卸表に入っている品目から）を決める。
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
     where left(a.key, 22) = 'spl_store_ingredients_'   -- 店の棚卸表の行だけ（_ を 1 文字の何でもにしない）
       and ((case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb
                 when jsonb_typeof(a.value::jsonb -> substr(a.key, 23)) = 'array' then a.value::jsonb -> substr(a.key, 23)
                 else '[]'::jsonb end) @> to_jsonb(array[i.code::text])
        or (case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb
                 when jsonb_typeof(a.value::jsonb -> substr(a.key, 23)) = 'array' then a.value::jsonb -> substr(a.key, 23)
                 else '[]'::jsonb end) @> to_jsonb(array[(case when i.code::text ~ '^\d+$' then i.code::text::numeric end)]))   -- Codex 10/17：or を括弧でくくる（無かったので、ほかの行が店に混ざった）
  ) o) owners,
  concat_ws(' ',
    case when coalesce(i.data->>'nameEN', '') = '' then '英語名' end,
    case when coalesce(i.data->>'unit', '') = '' then '数える単位' end,
    case when coalesce(i.data->>'qty', '') in ('', '0') then '内容量' end,
    case when coalesce(i.data->>'vendor', '') = '' then '仕入先' end,
    case when coalesce(i.data->>'price', '') in ('', '0') then '価格' end) missing
from public.ingredients i
order by i.code;

-- 2 つ目：新マスター（invoice から作った品目と、その規格）。
select
  v->>'id' id,
  v->>'name' name,
  v->>'legacyCode' legacy_code,
  v->>'cls' cls,
  v->>'vendor' vendor,
  (select string_agg(r, ' / ') from jsonb_array_elements_text(case when jsonb_typeof(v->'rawNames') = 'array' then v->'rawNames' else '[]'::jsonb end) r) raw_names,
  v->'spec'->>'orderUnit' order_unit,
  v->'spec'->>'packQty' pack_qty,
  v->'spec'->>'packUnit' pack_unit,
  v->'spec'->>'contentQty' content_qty,
  v->'spec'->>'contentUnit' content_unit,
  v->'spec'->>'invUnit' count_unit,
  v->'spec'->>'measureUnit' measure_unit,
  v->>'specDone' spec_done,
  (select string_agg(s, ' ') from jsonb_array_elements_text(case when jsonb_typeof(v->'stores') = 'array' then v->'stores' else '[]'::jsonb end) s) stores,
  case when jsonb_typeof(v->'priceHistory') = 'array' then jsonb_array_length(v->'priceHistory') else 0 end price_history_count
from public.app_state a
cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb else '[]'::jsonb end) v
where a.key = 'm_ingredients_v2'
order by v->>'vendor', v->>'name';
