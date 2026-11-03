-- LaLa（F06）の来店区分（FT・RP・SR）を、注文の商品と保存した数で 1 日ずつ照らし合わせる（11/02・読むだけ・何も変えない）。
-- hyper-worker v1130 を入れて「期間一括取り込み」で LaLa を取り込み直したあとに流してください。結果をそのまま Claude に貼ってください。
-- お客様の名前・電話・カードは出ません（店の数だけ）。
--
-- 比べるもの：
--   商品 …… 注文に入った Customer Property（customer で始まるグループ）の FT・RP・SR の商品の数（toast_item_sales）
--   保存 …… hyper-worker が保存した数（toast_sales の first_time_count・repeat_count・super_regular_count。repeat_count は RP＋SR）
--   アプリのリピート率は「保存」から（期間で足してから割る）。商品と保存が同じなら、取り込みは正しい。
-- 見方（part の列）：
--   1 day …… 9/19（開店）〜昨日（ハワイ時間）の 1 日ずつ：客数・注文・売上／商品の FT・RP・SR／保存の FT・RP・SR／合っているか／取り込んだ時刻
--   2 month … 月ごと：同じ数の合計と、リピート率（保存から・商品から）、来店区分のある日・売上のある日
--   3 total … 全期間：同じ
-- 「合っているか」：一致／違う（hyper-worker がまだ前の版・取り込み直しがまだ、のとき）／保存の行なし（取り込みがまだ）／来店区分なし（その日は押されていない）／休み（売上 0）
--   ／未確認（保存の FT・RP＋SR・SR のどれかが空・読めない。0 とみなして「一致」にしない。月と全期間の「保存」の数・率にも入れない）
with st as (select id, toast_guid from public.stores where id = 'F06' and coalesce(toast_guid, '') <> ''),
hst as (select (now() at time zone 'Pacific/Honolulu')::date today),
days as (
  select d::date d from hst, generate_series(date '2026-09-19', hst.today - 1, interval '1 day') d
),
mi as (   -- 来店区分の商品：グループの名前が customer で始まる（hyper-worker v1130 と同じ）。名前で FT・RP・SR を分ける（SR を先に）
  select t.guid item,
    case
      when lower(btrim(coalesce(t.name, ''))) = 'sr' or lower(t.name) like '%super%' or t.name like '%常連%' then 'sr'
      when lower(btrim(coalesce(t.name, ''))) = 'rp' or lower(t.name) like '%repeat%' or t.name like '%リピ%' then 'rp'
      when lower(btrim(coalesce(t.name, ''))) = 'ft' or lower(t.name) like '%first%' or t.name like '%初回%' or t.name like '%新規%' then 'ft'
    end cls
  from public.toast_menu_items t join st on st.toast_guid = t.restaurant_guid
  where lower(btrim(coalesce(t.category, ''))) like 'customer%'
),
it as (
  select left(t.business_date::text, 10)::date d,
    sum(case when mi.cls = 'ft' then coalesce(t.qty, 0) else 0 end) ft,
    sum(case when mi.cls = 'rp' then coalesce(t.qty, 0) else 0 end) rp,
    sum(case when mi.cls = 'sr' then coalesce(t.qty, 0) else 0 end) sr
  from public.toast_item_sales t join st on st.toast_guid = t.restaurant_guid join mi on mi.item = t.item_guid and mi.cls is not null
  where t.business_date is not null and left(t.business_date::text, 10) >= '2026-09-19'
  group by 1
),
ts as (
  select left(j->>'business_date', 10)::date d,
    case when coalesce(j->>'net_sales', '') ~ '^-?\d+(\.\d+)?$' then (j->>'net_sales')::numeric end sales,
    case when coalesce(j->>'guest_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'guest_count')::numeric end guests,
    case when coalesce(j->>'order_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'order_count')::numeric end orders,
    case when coalesce(j->>'first_time_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'first_time_count')::numeric end ft,
    case when coalesce(j->>'repeat_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'repeat_count')::numeric end rp,
    case when coalesce(j->>'super_regular_count', '') ~ '^-?\d+(\.\d+)?$' then (j->>'super_regular_count')::numeric end sr,
    coalesce(j->>'fetched_at', j->>'updated_at', j->>'synced_at', j->>'created_at') fetched
  from public.toast_sales t cross join lateral (select to_jsonb(t) j) x join st on st.toast_guid = j->>'restaurant_guid'
  where coalesce(j->>'business_date', '') ~ '^\d{4}-\d{2}-\d{2}' and left(j->>'business_date', 10) >= '2026-09-19'
),
dd as (
  select days.d, ts.d is not null has_row, ts.sales, ts.guests, ts.orders, ts.fetched,
    coalesce(it.ft, 0) i_ft, coalesce(it.rp, 0) i_rp, coalesce(it.sr, 0) i_sr,
    ts.ft s_ft, ts.rp s_rp, ts.sr s_sr,
    -- 保存の値が空・読めない日（11/02 のレビュー：NULL を 0 とみなして「一致」にしない）
    (ts.d is not null and (ts.ft is null or ts.rp is null or ts.sr is null)) s_unk
  from days left join ts on ts.d = days.d left join it on it.d = days.d
),
judged as (
  select dd.*,
    case
      when not has_row then '保存の行なし'
      when s_unk then '未確認（保存の値が空）'
      when i_ft = s_ft and i_rp + i_sr = s_rp and i_sr = s_sr then
        case when s_ft + s_rp = 0 then (case when coalesce(sales, 0) > 0 then '来店区分なし' else '休み' end) else '一致' end
      else '違う'
    end judge
  from dd
),
agg as (
  select grp, min(d) d0, max(d) d1,
    sum(i_ft) i_ft, sum(i_rp) i_rp, sum(i_sr) i_sr,
    -- 保存の数は値のそろった日だけ（未確認の日は入れない）
    coalesce(sum(s_ft) filter (where has_row and not s_unk), 0) s_ft, coalesce(sum(s_rp) filter (where has_row and not s_unk), 0) s_rp,
    coalesce(sum(s_sr) filter (where has_row and not s_unk), 0) s_sr,
    count(*) filter (where has_row and not s_unk and s_ft + s_rp > 0) vt_days,
    count(*) filter (where coalesce(sales, 0) > 0) sales_days,
    count(*) filter (where judge = '違う') diff_days,
    count(*) filter (where judge = '保存の行なし') no_row_days,
    count(*) filter (where s_unk) unk_days,
    sum(coalesce(guests, 0)) guests
  from (select 'month' p, to_char(d, 'YYYY-MM') grp, * from judged union all select 'total', 'total', * from judged) z
  group by p, grp
),
rate as (
  select agg.*,
    case when s_ft + s_rp > 0 then round(100.0 * s_rp / (s_ft + s_rp), 1)::text || '%' else '対象データなし' end r_saved,
    case when i_ft + i_rp + i_sr > 0 then round(100.0 * (i_rp + i_sr) / (i_ft + i_rp + i_sr), 1)::text || '%' else '対象データなし' end r_items
  from agg
)
select part, a, b, c, d, e, f from (
  select 1 o, d::text k, 'day' part, d::text a,
    'guests ' || coalesce(guests::text, '-') || ' / orders ' || coalesce(orders::text, '-') || ' / sales ' || coalesce(round(sales, 2)::text, '-') b,
    '商品 FT ' || i_ft || ' · RP ' || i_rp || ' · SR ' || i_sr c,
    case when not has_row then '保存 -' else '保存 FT ' || coalesce(s_ft::text, '空') || ' · RP+SR ' || coalesce(s_rp::text, '空') || ' · SR ' || coalesce(s_sr::text, '空') end d,
    judge e,
    coalesce(to_char((fetched::timestamptz) at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') || ' HST', '-') f
  from judged
  union all
  select case when grp = 'total' then 3 else 2 end, grp, case when grp = 'total' then 'total' else 'month' end, grp || '（' || to_char(d0, 'MM/DD') || '〜' || to_char(d1, 'MM/DD') || '）',
    'guests ' || guests || ' / 来店区分のある日 ' || vt_days || ' / 売上のある日 ' || sales_days,
    '商品 FT ' || i_ft || ' · RP ' || i_rp || ' · SR ' || i_sr || ' → ' || r_items,
    '保存 FT ' || s_ft || ' · RP+SR ' || s_rp || ' · SR ' || s_sr || ' → ' || r_saved,
    '違う日 ' || diff_days || ' / 保存の行なし ' || no_row_days || ' / 未確認 ' || unk_days,
    null
  from rate
) z
order by o, k;
