-- LaLa（F06）の来店区分（初回・リピート）が 0 のままの理由を見る（読むだけ・何も変えない）。結果は 1 つの表で出ます。そのまま Claude に貼ってください。
--
-- 10/17 の結果：LaLa の toast_sales は 9 月 15 日・10 月 17 日の行があり、来店区分の欄も入っているが、初回・リピート・SR がどの日も 0。
--   ToriTon は毎日数が入っている。アプリはどの店も同じ計算なので、LaLa の Toast に初回・リピートを記録するもの（商品・ボタン）が無いか、
--   取込（hyper-worker）がそれを LaLa で見つけていない。ここでは、ToriTon と LaLa の出数の表で、来店区分らしい名前の商品・モディファイヤーを並べる。
-- 見方：
--   part=store … 店舗マスターの Toast の店（restaurant GUID）。LaLa と ToriTon が同じなら教えてください。
--   part=item / part=modifier … 名前に first / repeat / regular / FT / RP / SR / 初回 / リピ / 常連 / 新規 を含む商品・モディファイヤーと、2026 年 9 月からの数。
--   ToriTon にあって LaLa に無いものが、LaLa で数が出ない理由の候補です。
with s as (select id, name, toast_guid from public.stores where id in ('F01', 'F06')),
pat as (select '(first|repeat|regular|\mft\M|\mrp\M|\msr\M|初回|リピ|常連|新規)'::text p),
it as (
  select s.id store, coalesce(j->>'item_name', j->>'name', j->>'menu_item_name', '') nm,
         case when coalesce(j->>'quantity', j->>'qty', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'quantity', j->>'qty')::numeric else 1 end q
  from public.toast_item_sales t cross join lateral (select to_jsonb(t) j) x
  join s on s.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_date', j->>'date', '9999') >= '2026-09-01'
),
md as (
  select s.id store, coalesce(j->>'modifier_name', j->>'name', '') nm,
         case when coalesce(j->>'quantity', j->>'qty', '') ~ '^-?\d+(\.\d+)?$' then coalesce(j->>'quantity', j->>'qty')::numeric else 1 end q
  from public.toast_item_modifier_sales t cross join lateral (select to_jsonb(t) j) x
  join s on s.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_date', '9999') >= '2026-09-01'
)
select 'store' part, id store, name, coalesce(toast_guid, '（空）') detail, null::numeric n from s
union all
select 'item', store, nm, '', sum(q) from it, pat where nm ~* pat.p group by store, nm
union all
select 'modifier', store, nm, '', sum(q) from md, pat where nm ~* pat.p group by store, nm
order by 1, 2, 5 desc nulls last, 3;
