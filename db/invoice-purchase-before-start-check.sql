-- 確認済みの仕入れ集計：取込の開始日時より前に Drive に入った invoice（保留 E「開始前」）が、アプリにも登録されているかを見る（読むだけ・何も変えない）。
-- 結果をそのまま Claude に貼ってください。
--
-- なぜ：開始前の Drive の invoice は、店がアプリにも登録している前提で、新しい数え方ではアプリの登録の方で数える（Drive の分は数えない＝二重にしない）。
--   アプリに登録が無いものは、今までの数え方にも新しい数え方にも入っていない（原価が少なく出る）。
-- 見方：
--   アプリ：同じ日・同じ金額 … 店のアプリの登録（Drive の写しを除く）に、請求日と金額が同じものがある → たぶん登録済み（業者名で確かめる）
--   アプリ：金額だけ同じ    … 日付は違うが金額が同じものがある → 日付を打ち間違えた登録かもしれない
--   どちらも「—」         … アプリに登録が見つからない → 原価に入っていない可能性が高い
--   「原価に入らない種類」 … 登録はあるが Receipt・立替、または用途が「仕入れ・仕込み」でないので、原価には入っていない
-- 月は下の '2026-10' を変えると、ほかの月も見られる。サーバーが書いた集計（invoice_purchase_published）とアプリの invoice（spl_invoices_<店舗>）を読むだけ。
with p as (select '2026-10'::text ym),
pub as (select x.ym, x.summary s from public.invoice_purchase_published x join p on p.ym = x.ym where x.summary is not null),
docs as (
 select st.key store, d, pub.s->>'start_at' start_at
 from pub cross join lateral jsonb_each(case when jsonb_typeof(pub.s->'stores')='object' then pub.s->'stores' else '{}'::jsonb end) st
  cross join lateral jsonb_array_elements(case when jsonb_typeof(st.value->'docs')='array' then st.value->'docs' else '[]'::jsonb end) d
 where d->>'cat' = 'E' and jsonb_typeof(d->'why') = 'array' and (d->'why') ? 'before_start'
),
app as (
 -- 日付は 2026/10/05・2026-10-5・2026年10月5日 のどれでも読む。金額が数でない行は比べない
 select s.store, coalesce(e->>'vendor', '') vendor,
  (select dm[1] || '-' || lpad(dm[2], 2, '0') || '-' || lpad(dm[3], 2, '0')
    from regexp_match(coalesce(nullif(e->>'docDate', ''), e->>'date', ''), '^\s*(\d{4})\D(\d{1,2})\D(\d{1,2})') dm) dt,
  case when coalesce(e->>'total', '') ~ '^\s*-?\d+(\.\d+)?\s*$' then abs(round(trim(e->>'total')::numeric * 100)) end cents,
  (coalesce(e->>'docType', '') in ('Receipt', 'Reimburse') or coalesce(nullif(e->>'purpose', ''), '仕入れ・仕込み') <> '仕入れ・仕込み') nocost
 from public.app_state a
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e
  cross join lateral (select e->>'storeId' store union
   select jsonb_array_elements_text(case when jsonb_typeof(e->'splitStores')='array' then e->'splitStores' else '[]'::jsonb end)) s
 where a.key like 'spl\_invoices\_%' and coalesce(e->>'src', '') <> 'drive-intake' and coalesce((e->>'_deleted')::boolean, false) = false
  and s.store is not null
),
x as (
 select d.store, d.d->>'d' dt, d.d->>'vn' vn, d.d->>'no' no, d.d->>'st' st, d.d->>'iat' iat, d.start_at,
  case when coalesce(d.d->>'c', '') ~ '^-?\d+$' then abs((d.d->>'c')::bigint) end cents
 from docs d
)
select x.store as "店舗", coalesce(x.dt, '（請求日なし）') as "請求日", coalesce(x.vn, '') as "業者", coalesce(x.no, '') as "invoice 番号",
 case when x.cents is null then '金額未確定' else '$' || to_char(x.cents / 100.0, 'FM999,999,990.00') end as "金額",
 case x.st when 'posted' then '反映済み' when 'review' then '確認待ち' when 'rejected' then '対象外' when 'duplicate' then '重複' else coalesce(x.st, '') end as "状態",
 case when coalesce(x.iat, '') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' then to_char(x.iat::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') else '?' end as "Drive に入った時刻（ハワイ）",
 case when coalesce(x.start_at, '') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}' then to_char(x.start_at::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') else '?' end as "取込の開始日時（ハワイ）",
 coalesce((select string_agg(case when a.vendor = '' then '（業者名なし）' else a.vendor end || case when a.nocost then '・原価に入らない種類' else '' end, ' / ')
   from app a where a.store = x.store and a.dt = x.dt and a.cents = x.cents), '—') as "アプリ：同じ日・同じ金額",
 coalesce((select string_agg(case when a.vendor = '' then '（業者名なし）' else a.vendor end || '（' || coalesce(substr(a.dt, 6, 2) || '/' || substr(a.dt, 9, 2), '日付なし') || '）'
   || case when a.nocost then '・原価に入らない種類' else '' end, ' / ')
   from app a where a.store = x.store and a.cents = x.cents and a.dt is distinct from x.dt), '—') as "アプリ：金額だけ同じ"
from x
order by x.store, x.dt nulls first, x.vn, x.no;
