-- メニュー出数分析（v1129・11/01 の依頼 ②）の照合（読むだけ・何も変えない）。
-- 注文の出数（toast_item_sales）と Toast のメニューの表（toast_menu_items）を、アプリと同じ決まりで突き合わせます。
-- 結果は 1 つの表で出ます。全部の行をそのまま Claude に貼ってください（お客様の名前・電話・カードは出ません。店の数と商品名だけ）。
--
-- アプリと同じ決まり：
--   ・商品名・カテゴリーは Toast のメニューの表（同じ店の GUID の行）。無い商品はアプリではレシピの名前（この SQL ではレシピを見ないので「表に無い」と数える）。
--   ・来店区分（FT・RP・SR など）＝メニューのカテゴリーが「customer」で始まる（Customers・Customer Property など。大文字小文字・前後の空白は無視・v1130）。出数に入れない。
--
-- 見方（part の列）：
--   month ……… 店・月ごと：出数の行・出数の合計・来店区分の出数・メニューの表に名前がある出数・表に無い出数（商品の数）・カテゴリーのある出数
--   menu ………… 店ごとのメニューの表：行・カテゴリーの数・販売中でない行・Customers の行
--   top ………… 店ごと・先月の出数の多い 10 品（来店区分を除く）。アプリの「メニュー」→ 期間「先月」→ 店 →「よく出たメニュー（上位 10）」と同じになるはず
--   visit ……… 店ごと・月ごとの来店区分の商品と出数（出数に入れないもの）
--   unknown … 店ごと・メニューの表に無い商品（GUID の末尾 6 文字）の出数（8 月から・多い順に 15）。アプリでは「名称未取得」か、レシピの名前
with st as (
  select id, name, toast_guid from public.stores where coalesce(toast_guid, '') <> ''
),
ti as (
  select st.id store, j from public.toast_item_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_month', left(coalesce(j->>'business_date', j->>'date', ''), 7)) >= '2026-08'
),
tin as (
  select store, nullif(left(coalesce(j->>'business_date', j->>'date', ''), 10), '') d,
    coalesce(j->>'business_month', left(coalesce(j->>'business_date', j->>'date', ''), 7)) ym,
    coalesce(j->>'item_guid', j->>'guid', '') item,
    case when coalesce(j->>'qty', j->>'quantity', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'qty', j->>'quantity')::numeric else 0 end q
  from ti
),
mi as (
  select st.id store, coalesce(j->>'guid', j->>'item_guid', '') item, coalesce(j->>'name', '') nm, coalesce(j->>'category', '') cat,
    coalesce(j->>'active', 'true') act
  from public.toast_menu_items t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
),
mi1 as (   -- 同じ GUID の行が 2 つ以上あっても 1 つに（名前の入っている行を先に）
  select distinct on (store, item) store, item, nm, cat, act from mi where item <> '' order by store, item, (nm = ''), nm
),
j as (
  select t.store, t.d, left(t.d, 7) ym, t.item, t.q, m.nm, m.cat, (m.item is not null) in_menu,
    (m.item is not null and lower(btrim(m.cat)) ~ '^customer') visit
  from tin t left join mi1 m on m.store = t.store and m.item = t.item
  where t.d is not null
),
last_month as (
  select to_char(date_trunc('month', (now() at time zone 'Pacific/Honolulu')) - interval '1 month', 'YYYY-MM') ym
),
out_month as (
  select 'month' part, store, ym a,
    'rows ' || count(*) || ' / qty ' || sum(q) b,
    'visit ' || coalesce(sum(q) filter (where visit), 0) c,
    'named ' || coalesce(sum(q) filter (where in_menu and not visit and nm <> ''), 0) d,
    'not_in_menu ' || coalesce(sum(q) filter (where not in_menu), 0) || ' (' || count(distinct item) filter (where not in_menu) || ' items)' e,
    'with_category ' || coalesce(sum(q) filter (where in_menu and not visit and btrim(cat) <> ''), 0) f,
    null::text g, 1 o
  from j group by store, ym
),
out_menu as (
  select 'menu' part, st.id store, null a,
    'rows ' || count(m.item) b,
    'categories ' || count(distinct nullif(btrim(m.cat), '')) c,
    'inactive ' || count(m.item) filter (where m.act = 'false') d,
    'customers ' || count(m.item) filter (where lower(btrim(m.cat)) ~ '^customer') e,
    null f, null g, 2 o
  from st left join mi1 m on m.store = st.id group by st.id
),
top0 as (
  select store, coalesce(nullif(nm, ''), '(not in menu …' || right(item, 6) || ')') label, q
  from j, last_month lm where j.ym = lm.ym and not visit
),
top as (
  select store, label nm, sum(q) q, row_number() over (partition by store order by sum(q) desc, label) rk from top0 group by store, label
),
out_top as (
  select 'top' part, store, (select ym from last_month) a, rk::text b, nm c, q::text d, null e, null f, null g, 3 o from top where rk <= 10
),
out_visit as (
  select 'visit' part, store, ym a, nm b, cat c, sum(q)::text d, null e, null f, null g, 4 o from j where visit group by store, ym, nm, cat
),
unk as (
  select store, right(item, 6) tail, sum(q) q, min(d) d1, max(d) d2,
    row_number() over (partition by store order by sum(q) desc, right(item, 6)) rk
  from j where not in_menu group by store, item
),
out_unknown as (
  select 'unknown' part, store, tail a, q::text b, d1 c, d2 d, null e, null f, null g, 5 o from unk where rk <= 15
)
select part, store, a, b, c, d, e, f, g from (
  select * from out_month union all select * from out_menu union all select * from out_top union all select * from out_visit union all select * from out_unknown
) z order by o, store, a, b;
