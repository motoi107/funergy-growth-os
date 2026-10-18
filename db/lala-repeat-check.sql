-- LaLa（F06）と ToriTon（F01）の来店区分（初回・リピート）が、Toast の取込にどこまで入っているかを見る（読むだけ・何も変えない）。
-- 結果をそのまま Claude に貼ってください（お客様の情報・金額は出ません）。
--
-- なぜ：アプリのリピート率は、どの店も同じ計算（リピート（RP＋SR）÷（初回 FT＋リピート））で、元の数は Toast 取込（hyper-worker）が
--   toast_sales に入れる first_time_count・repeat_count・super_regular_count。LaLa の数が入っていなければ、アプリでは「データなし」になる。
--   数を数えているのは hyper-worker（このリポジトリに無い）なので、LaLa の行に数が入っているかをここで確かめる。
-- 見方：
--   1 つ目：店舗マスターの LaLa と ToriTon の Toast の店（restaurant GUID）。LaLa が空、または ToriTon と同じなら教えてください。
--   2 つ目：月ごとに、取込の行の数・来店区分の数が入っている日数・初回・リピート・うち SR・リピート率（アプリと同じ式）。
--          LaLa の「来店区分のある日」が 0 なら、Toast の LaLa に Customers（FT・RP・SR）の商品が無いか、hyper-worker が LaLa を数えていない。
-- 列の名前が違っても止まらないように、行を JSON にして読む。
select s.id, s.name, s.toast_guid,
       (select count(*) from public.stores x where x.toast_guid is not null and x.toast_guid = s.toast_guid) stores_with_same_guid
from public.stores s
where s.id in ('F01', 'F06') or s.name ilike '%lala%' or s.name ilike '%toriton%'
order by s.id;

with s as (select id, toast_guid from public.stores where id in ('F01', 'F06') and toast_guid is not null and toast_guid <> ''),
t as (
  select s.id store, left(j->>'business_date', 7) ym, j
  from public.toast_sales ts
  join s on s.toast_guid = ts.restaurant_guid
  cross join lateral (select to_jsonb(ts) j) x
  where (j->>'business_date') >= '2026-01-01'
),
n as (
  select store, ym, j,
    case when coalesce(j->>'first_time_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'first_time_count')::numeric end ft,
    case when coalesce(j->>'repeat_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'repeat_count')::numeric end rp,
    case when coalesce(j->>'super_regular_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'super_regular_count')::numeric end sr
  from t
)
select store, ym,
  count(*) rows_in_toast_sales,
  count(*) filter (where ft is not null or rp is not null) days_with_visit_type,
  coalesce(sum(ft), 0) first_time,
  coalesce(sum(rp), 0) repeat_incl_sr,
  coalesce(sum(sr), 0) super_regular,
  case when coalesce(sum(ft), 0) + coalesce(sum(rp), 0) > 0
       then round(100.0 * coalesce(sum(rp), 0) / (coalesce(sum(ft), 0) + coalesce(sum(rp), 0)), 1) end repeat_rate_pct
from n
group by store, ym
order by store, ym;
