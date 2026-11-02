-- LaLa の来店区分（FT・RP・SR）の 2 つ目の確かめ（11/02・読むだけ・何も変えない）。結果は 1 つの表で出ます。そのまま Claude に貼ってください。
-- 11/02 の 1 つ目の結果：LaLa の Toast のメニューに「Customers」というグループが無く、代わりにレシピのカテゴリー「Customer Property」に 3 品ある。
--   取込（hyper-worker）は名前がちょうど「Customers」のグループの中の FT・RP・SR だけを数えるので、LaLa は 0 になっていた（の見込み）。
-- ここでは、来店区分らしい商品（グループ名に customer を含む・名前が FT／RP／SR／first／repeat／super／regular／初回／リピ／常連／新規）を全店で並べ、
-- 注文に入っている数（toast_item_sales）を見る。LaLa は日ごとに、客数・注文数と並べる。
-- 見方（part の列）：
--   cand …… 来店区分らしい商品：店・グループ・名前・ID の末尾・価格・販売中・8/1 からの数・出た日の数・最初と最後の日
--   lala_d … LaLa の直近 21 日：客数・注文数・来店区分らしい商品の数（名前ごと）
with st as (select id, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
mi as (
  select s.id store, t.guid item, coalesce(t.name, '') nm, coalesce(t.category, '') cat, t.price, t.active
  from public.toast_menu_items t join st s on s.toast_guid = t.restaurant_guid
),
cand as (
  select * from mi
  where cat ~* 'customer' or btrim(nm) ~* '^(ft|rp|sr)$' or nm ~* '(first|repeat|super|regular|初回|リピ|常連|新規)'
),
ti as (
  select s.id store, t.item_guid item, left(t.business_date::text, 10) d, coalesce(t.qty, 0)::numeric q
  from public.toast_item_sales t join st s on s.toast_guid = t.restaurant_guid
  where t.business_date::text >= '2026-08-01'
),
hst as (select (now() at time zone 'Pacific/Honolulu')::date today),
ts as (
  select left(t.business_date::text, 10) d, t.guest_count g, t.order_count o, t.net_sales n
  from public.toast_sales t join st s on s.toast_guid = t.restaurant_guid, hst
  where s.id = 'F06' and t.business_date::text >= (hst.today - 21)::text
)
select part, store, a, b, c, d, e, f, g from (
  select 1 o, 'cand' part, c.store, c.cat a, c.nm b, '…' || right(c.item, 8) c,
         'price ' || coalesce(c.price::text, '-') || ' / active ' || coalesce(c.active::text, '-') d,
         'qty ' || coalesce((select sum(q) from ti where ti.store = c.store and ti.item = c.item), 0)
           || ' / days ' || (select count(distinct d) from ti where ti.store = c.store and ti.item = c.item) e,
         coalesce((select min(d) || '〜' || max(d) from ti where ti.store = c.store and ti.item = c.item), '（注文に無し）') f,
         null::text g
    from cand c
  union all
  select 2, 'lala_d', 'F06', ts.d, 'guests ' || coalesce(ts.g::text, '-') || ' / orders ' || coalesce(ts.o::text, '-') || ' / sales ' || coalesce(round(ts.n::numeric, 2)::text, '-'),
         coalesce((select string_agg(c.nm || ' ' || sum_q, ' · ' order by c.nm)
                     from (select c2.nm, (select coalesce(sum(q), 0) from ti where ti.store = 'F06' and ti.item = c2.item and ti.d = ts.d) sum_q
                             from cand c2 where c2.store = 'F06') c), '（来店区分らしい商品なし）'),
         null, null, null, null
    from ts
) z
order by o, store, a, b;
