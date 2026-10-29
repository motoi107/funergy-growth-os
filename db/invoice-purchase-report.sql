-- 確認済みの仕入れ集計：店舗・月ごとの照合（読むだけ・何も変えない）。結果をそのまま Claude に貼ってください。
-- 集計（サーバーが書いた invoice_purchase_<月> の中身）と、アプリの invoice（spl_invoices_<店舗>：Drive の写しとアプリで登録したもの）、
-- 棚卸（fc_monthly_<店舗>_<月>）を店舗・月で並べます。金額はドル。名前・明細・メール・鍵は出しません。
-- 列：
--   確認済み … A（経理などが人で反映したもの・経理の照合済み。2026-10-29 から。それまでは照合済み・QuickBooks 送信済み／台帳の前は照合済み）の
--     件数と原本の純額、そのうち原価対象・原価対象外・仮分類（業者の区分）
--   未転送 B・確認待ち C・保留 E … 件数と金額（金額未確定の件数）。保留のうち「取込の開始前」はアプリの登録で数えているもの。
--     未転送 B は 10/29 より前の決まりで作った月だけ（原価に入っていない）
--   QuickBooks 未転送 … 確認済み（原価に入っている）のうち、QuickBooks へ原本をまだ送っていないもの（10/29 からの集計だけ。ここからは送らない）
--   アプリの登録 … アプリで登録した invoice（Drive の写しを除く・用途が仕入れ・仕込み）。原価率には今までどおり入る
--   今までの数え方 … Drive の写し＋アプリの登録（原価対象の用途）。新しい数え方 … 確認済み（原価対象）＋アプリの登録
--   差 … 今までの数え方 − 新しい数え方（主に未転送・確認待ち・保留と、写しにあった原価対象外の分）
with m as (
 -- サーバーが書いた中身（invoice_purchase_published）から読む。app_state の行は画面からも書けるので使わない
 select x.ym, x.summary || jsonb_build_object('generated_at', x.published_at) v from public.invoice_purchase_published x where x.summary is not null
),
s as (
 select m.ym, st.key store, st.value x, coalesce((m.v->>'closed')::boolean, false) closed, m.v->>'generated_at' gen from m, jsonb_each(m.v->'stores') st
),
app as (
 -- 日付は 2026/10/05・2026-10-5・2026年10月5日 のどれでも月を取る。金額が数でない行は 0（照合の表が止まらないように）
 select coalesce(sp.store, e->>'storeId') store,
  (select dm[1] || '-' || lpad(dm[2], 2, '0') from regexp_match(coalesce(nullif(e->>'docDate',''), e->>'date', ''), '^\s*(\d{4})\D(\d{1,2})(\D|$)') dm) ym,
  coalesce(e->>'src','') = 'drive-intake' copy,
  case when coalesce(e->>'total', '') ~ '^\s*-?\d+(\.\d+)?\s*$' then trim(e->>'total')::numeric else 0 end
   / greatest(1, coalesce(jsonb_array_length(case when jsonb_typeof(e->'splitStores')='array' then e->'splitStores' end), 0)) amt
 from public.app_state a
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e
  left join lateral (select jsonb_array_elements_text(case when jsonb_typeof(e->'splitStores')='array' and jsonb_array_length(e->'splitStores') > 0 then e->'splitStores' end) store) sp on true
 where a.key like 'spl\_invoices\_%' and coalesce((e->>'_deleted')::boolean, false) = false
  and coalesce(e->>'docType','') not in ('Receipt','Reimburse') and coalesce(nullif(e->>'purpose',''), '仕入れ・仕込み') = '仕入れ・仕込み'
),
ag as (select store, ym, sum(amt) filter (where copy) copies, sum(amt) filter (where not copy) manual from app group by 1, 2),
n as (select s.*, (s.x->'tot') t from s)
select n.store as "店舗", n.ym as "月", case when n.closed then '締め済み' else '' end as "締め",
 coalesce((n.t->'A'->>'n')::int, 0) || ' 件 / $' || to_char(coalesce((n.t->'A'->>'c')::numeric, 0) / 100, 'FM999,999,990.00') as "確認済み（原本の純額）",
 '$' || to_char(coalesce((n.t->'A'->>'cost')::numeric, 0) / 100, 'FM999,999,990.00') || ' / $' || to_char(coalesce((n.t->'A'->>'non')::numeric, 0) / 100, 'FM999,999,990.00')
  || '（仮分類 $' || to_char((coalesce((n.t->'A'->>'pc')::numeric, 0) + coalesce((n.t->'A'->>'pn')::numeric, 0)) / 100, 'FM999,999,990.00') || '）' as "原価対象 / 対象外",
 coalesce((n.t->'B'->>'n')::int, 0) || ' 件 / $' || to_char(coalesce((n.t->'B'->>'c')::numeric, 0) / 100, 'FM999,999,990.00') as "未転送 B",
 case when jsonb_typeof(n.x->'qbn') = 'object' then coalesce((n.x->'qbn'->>'n')::int, 0) || ' 件 / $' || to_char(coalesce((n.x->'qbn'->>'c')::numeric, 0) / 100, 'FM999,999,990.00')
  else '—' end as "QuickBooks 未転送（確認済みのうち）",
 coalesce((n.t->'C'->>'n')::int, 0) || ' 件 / $' || to_char(coalesce((n.t->'C'->>'c')::numeric, 0) / 100, 'FM999,999,990.00')
  || case when coalesce((n.t->'C'->>'u')::int, 0) > 0 then '（金額未確定 ' || (n.t->'C'->>'u') || ' 件）' else '' end as "確認待ち C",
 coalesce((n.t->'E'->>'n')::int, 0) || ' 件 / $' || to_char(coalesce((n.t->'E'->>'c')::numeric, 0) / 100, 'FM999,999,990.00')
  || case when (n.t->'E'->'by') ? 'before_start' then '（開始前 ' || (n.t->'E'->'by'->'before_start'->>'n') || ' 件）' else '' end as "保留 E",
 coalesce((n.t->'D'->>'n')::int, 0) as "除外 D",
 coalesce((n.x->'cr'->>'n')::int, 0) || ' 件 / ' || case when coalesce((n.x->'cr'->>'c')::numeric, 0) < 0 then '-$' else '$' end
  || to_char(abs(coalesce((n.x->'cr'->>'c')::numeric, 0)) / 100, 'FM999,999,990.00') as "返品・クレジット（確認済み）",
 coalesce((n.x->'pre'->>'n')::int, 0) as "台帳の前の原本",
 coalesce((n.x->'ad'->>'n')::int, 0) as "アプリの登録と同じかも",
 '$' || to_char(coalesce(ag.manual, 0), 'FM999,999,990.00') as "アプリの登録",
 '$' || to_char(coalesce(ag.copies, 0) + coalesce(ag.manual, 0), 'FM999,999,990.00') as "今までの数え方",
 '$' || to_char(coalesce((n.t->'A'->>'cost')::numeric, 0) / 100 + coalesce(ag.manual, 0), 'FM999,999,990.00') as "新しい数え方",
 case when coalesce(ag.copies, 0) - coalesce((n.t->'A'->>'cost')::numeric, 0) / 100 < 0 then '-$' else '$' end
  || to_char(abs(coalesce(ag.copies, 0) - coalesce((n.t->'A'->>'cost')::numeric, 0) / 100), 'FM999,999,990.00') as "差",
 -- そろった（そのあとに増えていない）／照合が要る業者（invoice がある、または「足りない」の記録がある。0 件でも足りないなら要る）
 (select count(*) from jsonb_array_elements(n.x->'vendors') vv where vv->'chk'->>'s' = 'complete' and coalesce(vv->'chk'->>'after', '0') = '0') || ' / '
  || (select count(*) from jsonb_array_elements(n.x->'vendors') vv where coalesce((vv->'a'->>'n')::int, 0) + coalesce((vv->'p'->>'n')::int, 0) > 0
      or vv->'chk'->>'s' = 'missing') as "請求明細と照合した業者",
 coalesce((select '$' || to_char((f.value::jsonb->>'endInv')::numeric, 'FM999,999,990.00') from public.app_state f
   where f.key = 'fc_monthly_' || n.store || '_' || n.ym
    and case when coalesce(f.value::jsonb->>'endInv', '') ~ '^\d+(\.\d+)?$' then (f.value::jsonb->>'endInv')::numeric > 0 else false end), 'まだ') as "期末棚卸",
 case when coalesce(n.gen, '') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)$'
  then to_char((n.gen)::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') else '?' end as "集計の時刻（ハワイ）"
from n left join ag on ag.store = n.store and ag.ym = n.ym
order by n.ym desc, n.store;
