-- 読むだけ（v1098 の調べ・ログインと画面の重さ）。何も書き換えない。Supabase の SQL Editor でそのまま流す。
-- ログインのたびにアプリが読む量を、表とキーの種類ごとに数える。中身（名前・金額・PIN など）は出さない。
--   キーの名前は、先頭の 3 つの区切り（_ で分けたもの）だけを出す。小文字と数字だけでない区切り（店舗 ID・人の名前・日付）は * にする。
--   bytes は JSON の文字の長さ（圧縮する前・通信のおおよその量）。
-- 出てきた表をそのまま Claude に貼ってください。

with st as (
  select
    array_to_string(array(
      select case when tok ~ '^[a-z0-9]+$' then tok else '*' end
        from unnest((string_to_array(key, '_'))[1:3]) as tok
    ), '_') as fam,
    octet_length(value::text) as b,
    (key like 'invoice_purchase_%' or key like 'lunch_photo_%') as not_at_login
  from public.app_state
)
select 'A app_state ログインで読む 合計' as what, '' as fam, count(*)::text as rows, sum(b)::text as bytes, max(b)::text as max_row
  from st where not not_at_login
union all
select 'A app_state ログインで読まない 合計', '', count(*)::text, sum(b)::text, max(b)::text
  from st where not_at_login
union all
select * from (
  select 'B app_state 種類ごと（大きい順 40）', fam, count(*)::text, sum(b)::text, max(b)::text
    from st where not not_at_login
   group by fam order by sum(b) desc limit 40
) x
union all
select 'C app_settings 合計', '', count(*)::text, sum(octet_length(value::text))::text, max(octet_length(value::text))::text
  from public.app_settings
union all
select * from (
  select 'D app_settings 大きい順 10',
         array_to_string(array(
           select case when tok ~ '^[a-z0-9]+$' then tok else '*' end
             from unnest((string_to_array(key, '_'))[1:3]) as tok
         ), '_'),
         '1', octet_length(value::text)::text, ''
    from public.app_settings order by octet_length(value::text) desc limit 10
) y
union all
select 'E employees', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.employees
union all
select 'E stores', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.stores
union all
select 'E ingredients', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.ingredients
union all
select 'E recipes', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.recipes
union all
select 'E vendors', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.vendors
union all
select 'E categories', '', count(*)::text, sum(octet_length(data::text))::text, max(octet_length(data::text))::text from public.categories
union all
select * from (
  select 'F toast_item_sales 今月（店ごと）', '店 ' || dense_rank() over (order by restaurant_guid)::text,
         count(*)::text, sum(octet_length(t::text))::text, max(octet_length(t::text))::text
    from public.toast_item_sales t
   where business_month = to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM')
   group by restaurant_guid
) z
union all
select 'G toast_sales 今月', '', count(*)::text, sum(octet_length(t::text))::text, max(octet_length(t::text))::text
  from public.toast_sales t
 where business_date::text >= to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM') || '-01'
union all
select 'G tip_labor 今月', '', count(*)::text, sum(octet_length(t::text))::text, max(octet_length(t::text))::text
  from public.tip_labor t
 where business_date::text >= to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM') || '-01';
