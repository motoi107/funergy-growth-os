-- invoice の仕入れ集計：今月の状況（読むだけ・何も変えない・2026-10-14）
-- 確認済み仕入れの集計を作る前に、本番で「反映」「照合」「QuickBooks 送信」がどこまで使われているかを店舗ごとに見る。
-- 月は請求日（invoice_date）でハワイ時間の今月。別の月を見るときは下の m の行の日付を書き換える（例 date '2026-09-01'）。
-- 金額は印字のままの合計（total_cents）。クレジットの符号は印字どおり。名前・金額の合計だけを出す（明細・メール・鍵は出さない）。
with m as (select date_trunc('month', (now() at time zone 'Pacific/Honolulu'))::date as d0),
d as (
 select x.*, (x.total_cents / 100.0) as amt,
  exists(select 1 from public.invoice_qb_outbox o where o.file_id = x.file_id and o.sha256 = x.sha256 and o.state = 'sent') as qb_sent,
  exists(select 1 from jsonb_array_elements(x.reasons) r where r->>'code' = 'multi_store') as multi_store
 from public.invoice_docs x, m
 where x.posting_kind = 'purchase' and x.invoice_date >= m.d0 and x.invoice_date < (m.d0 + interval '1 month')
),
l as (
 select il.doc_id, count(*) as n, count(il.ingredient_code) as mapped
 from public.invoice_lines il join d on d.id = il.doc_id group by il.doc_id
),
s as (
 select d.store_id,
  count(*) filter (where status = 'posted') as p_n, sum(amt) filter (where status = 'posted') as p_amt,
  count(*) filter (where status = 'posted' and posted_mode = 'manual') as p_manual,
  count(*) filter (where status = 'posted' and posted_mode = 'auto') as p_auto,
  count(*) filter (where status = 'posted' and recon_status = 'reconciled') as rc_n, sum(amt) filter (where status = 'posted' and recon_status = 'reconciled') as rc_amt,
  count(*) filter (where status = 'posted' and recon_status = 'discrepancy') as diff_n,
  count(*) filter (where status = 'posted' and qb_sent) as qb_n, sum(amt) filter (where status = 'posted' and qb_sent) as qb_amt,
  count(*) filter (where status = 'posted' and recon_status = 'reconciled' and qb_sent) as both_n,
  sum(amt) filter (where status = 'posted' and recon_status = 'reconciled' and qb_sent) as both_amt,
  count(*) filter (where status = 'review') as rv_n, sum(amt) filter (where status = 'review') as rv_amt,
  count(*) filter (where doc_type = 'credit_memo' and status = 'posted') as cm_n, sum(amt) filter (where doc_type = 'credit_memo' and status = 'posted') as cm_amt,
  count(*) filter (where status = 'posted' and multi_store) as ms_n,
  count(*) filter (where status = 'posted' and total_cents is null) as noamt_n,
  count(*) filter (where status = 'posted' and coalesce(food_kind, '') <> 'food') as nonfood_n,
  coalesce(sum(l.n) filter (where status = 'posted'), 0) as lines_n, coalesce(sum(l.mapped) filter (where status = 'posted'), 0) as lines_mapped
 from d left join l on l.doc_id = d.id group by d.store_id
)
select s.store_id as "店舗", (select to_char(d0, 'YYYY-MM') from m) as "月",
 s.p_n || ' 件 / $' || to_char(coalesce(s.p_amt, 0), 'FM999,999,990.00') as "反映済み",
 s.p_manual || ' / ' || s.p_auto as "うち人 / 自動",
 s.rc_n || ' 件 / $' || to_char(coalesce(s.rc_amt, 0), 'FM999,999,990.00') as "照合済み",
 s.diff_n::text as "差異あり",
 s.qb_n || ' 件 / $' || to_char(coalesce(s.qb_amt, 0), 'FM999,999,990.00') as "QB 送信済み",
 s.both_n || ' 件 / $' || to_char(coalesce(s.both_amt, 0), 'FM999,999,990.00') as "照合済み かつ QB 送信済み",
 s.rv_n || ' 件 / $' || to_char(coalesce(s.rv_amt, 0), 'FM999,999,990.00') as "要確認（未反映）",
 s.cm_n || ' 件 / $' || to_char(coalesce(s.cm_amt, 0), 'FM999,999,990.00') as "クレジット（反映済み）",
 s.ms_n::text as "複数店舗の印",
 s.noamt_n::text as "金額なし",
 s.nonfood_n::text as "食材以外の業者",
 s.lines_mapped || ' / ' || s.lines_n as "明細：商品に対応 / 全部"
from s
union all
select '（設定）', (select to_char(d0, 'YYYY-MM') from m),
 'QB 送信 ' || coalesce((select value->>'enabled' from public.invoice_settings where key = 'qb'), '?')
  || '・送る担当 ' || coalesce((select value->>'route' from public.invoice_settings where key = 'qb'), '未設定')
  || '・送り始め ' || coalesce((select value->>'since' from public.invoice_settings where key = 'qb'), '?'),
 'アプリへの写し ' || coalesce((select value->>'mirror' from public.invoice_settings where key = 'mode'), '?'),
 '自動反映 ' || coalesce((select value->>'auto_post' from public.invoice_settings where key = 'mode'), '?'),
 '名前の変更 ' || coalesce((select value->>'rename' from public.invoice_settings where key = 'mode'), '?'),
 'QB の台帳：' || coalesce((select string_agg(state || ' ' || n, '・' order by state) from (select state, count(*) n from public.invoice_qb_outbox group by state) q), '0 件'),
 '締め済み ' || coalesce((select value->>'closed_through' from public.invoice_settings where key = 'rules'), 'なし'),
 '開始 ' || coalesce((select value->>'start_at' from public.invoice_settings where key = 'mode'), '?'),
 '', '', '', '', ''
order by 1;
