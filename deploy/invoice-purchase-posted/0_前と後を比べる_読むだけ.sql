-- 確認済みの仕入れ集計：前と後を比べる（読むだけ・何も変えない・2026-10-29）
-- 「確認済み」を「経理の照合済み（＋QuickBooks 送信済み）」から「人が反映したもの、または照合済み」に変える（20261029100000）前と後の数字。
-- いつ流してもよい：
--   ・入れる前：「前」と「見込み」（今の集計の各 invoice に新しい決まりを当てた数）が出る。「後」は前と同じ（関数がまだ前の決まり）。
--   ・入れたあと：「前」は残した集計（invoice_purchase_snapshots）、「後」は今の関数で計算した数。「見込み」と「後」が同じなら決まりどおり。
--     （入れたあとに反映・照合が進んだ分だけ、「後」は「見込み」より増えることがある）
-- 月は下の '2026-10' を変えると、ほかの月も見られる（入れたあとに初めて集計した月は残していないので、「前」も新しい決まりの数になる＝「前の出どころ」に出る）。金額は原本の合計（クレジットはマイナス）、原価対象は食材・お酒・飲料の分（消耗品・食材以外は入らない）。
-- アプリ（予実管理の原価率）は「後」の確認済み（原価対象）＋アプリで登録した invoice（Drive の外）＋買い出し＋食材移動で出す（v1077 から変わらない）。
with p as (select '2026-10'::text ym),
-- 残した集計（入れる前は表が無いので読まない。中身は base64 で受け渡す＝業者名の記号もそのまま。
-- その月を残していなければ空＝<table> だけが返る）
snap as (
 select to_regclass('public.invoice_purchase_snapshots') is not null as has_table,
  case when to_regclass('public.invoice_purchase_snapshots') is not null then
   convert_from(decode((xpath('/table/row/s/text()', query_to_xml(format(
     'select encode(convert_to(summary::text, ''UTF8''), ''base64'') s from public.invoice_purchase_snapshots where ym = %L and reason = %L order by id limit 1',
     p.ym, 'before 20261029100000 (confirmed = posted by a person or reconciled)'), false, false, '')))[1]::text, 'base64'), 'UTF8')::jsonb end summary
 from p
),
before as (
 select coalesce((select summary from snap), (select x.summary from public.invoice_purchase_published x, p where x.ym = p.ym)) s
),
live as (select public.invoice_purchase_month(p.ym) -> 'summary' s from p),
bs as (select st.key sid, st.value v from before, jsonb_each(coalesce(before.s -> 'stores', '{}'::jsonb)) st),
ls as (select st.key sid, st.value v from live, jsonb_each(coalesce(live.s -> 'stores', '{}'::jsonb)) st),
bd as (
 select bs.sid, d.value x from bs, jsonb_array_elements(case when jsonb_typeof(bs.v -> 'docs') = 'array' then bs.v -> 'docs' else '[]'::jsonb end) d
),
-- 見込み：今の集計の各 invoice に新しい決まりを当てる（B＝照合済み・未転送 → 確認済み、C のうち人が反映した・未照合・アプリと同じかもしれない印なし → 確認済み）
pv as (
 select bd.sid,
  count(*) filter (where x ->> 'cat' = 'A') a0_n, coalesce(sum((x ->> 'cost')::bigint) filter (where x ->> 'cat' = 'A'), 0) a0_cost,
  count(*) filter (where x ->> 'cat' = 'B') b0_n, count(*) filter (where x ->> 'cat' = 'C') c0_n,
  coalesce(sum((x ->> 'c')::bigint) filter (where x ->> 'cat' = 'C' and x ->> 'c' is not null), 0) c0_c,
  count(*) filter (where x ->> 'cat' in ('A','B') or (x ->> 'cat' = 'C' and x ->> 'st' = 'posted' and x ->> 'rc' = 'unreconciled' and x ->> 'pm' = 'manual'
    and not coalesce((x ->> 'ad')::boolean, false))) pa_n,
  coalesce(sum((x ->> 'cost')::bigint) filter (where x ->> 'cat' in ('A','B') or (x ->> 'cat' = 'C' and x ->> 'st' = 'posted' and x ->> 'rc' = 'unreconciled'
    and x ->> 'pm' = 'manual' and not coalesce((x ->> 'ad')::boolean, false))), 0) pa_cost,
  count(*) filter (where x ->> 'cat' = 'C' and x ->> 'st' = 'posted' and x ->> 'rc' = 'unreconciled' and x ->> 'pm' = 'manual' and coalesce((x ->> 'ad')::boolean, false)) p_dup,
  count(*) filter (where x ->> 'cat' = 'C' and x ->> 'st' = 'posted' and x ->> 'rc' = 'unreconciled' and x ->> 'pm' is distinct from 'manual') p_auto
 from bd group by bd.sid
),
lv as (
 select ls.sid,
  coalesce((ls.v -> 'tot' -> 'A' ->> 'n')::int, 0) a_n, coalesce((ls.v -> 'tot' -> 'A' ->> 'cost')::bigint, 0) a_cost,
  coalesce((ls.v -> 'tot' -> 'A' ->> 'c')::bigint, 0) a_c, coalesce((ls.v -> 'tot' -> 'C' ->> 'n')::int, 0) c_n,
  coalesce((ls.v -> 'tot' -> 'C' ->> 'c')::bigint, 0) c_c,
  coalesce((ls.v -> 'qbn' ->> 'n')::int, 0) q_n, coalesce((ls.v -> 'qbn' ->> 'c')::bigint, 0) q_c,
  coalesce((ls.v -> 'tot' -> 'A' -> 'by' -> 'posted_manual' ->> 'n')::int, 0) a_pm
 from ls
),
k as (select sid from pv union select sid from lv),
r as (
 select k.sid, coalesce(pv.a0_n, 0) a0_n, coalesce(pv.a0_cost, 0) a0_cost, coalesce(pv.b0_n, 0) b0_n, coalesce(pv.c0_n, 0) c0_n, coalesce(pv.c0_c, 0) c0_c,
  coalesce(pv.pa_n, 0) pa_n, coalesce(pv.pa_cost, 0) pa_cost, coalesce(pv.p_dup, 0) p_dup, coalesce(pv.p_auto, 0) p_auto,
  coalesce(lv.a_n, 0) a_n, coalesce(lv.a_cost, 0) a_cost, coalesce(lv.a_c, 0) a_c, coalesce(lv.c_n, 0) c_n, coalesce(lv.c_c, 0) c_c,
  coalesce(lv.q_n, 0) q_n, coalesce(lv.q_c, 0) q_c, coalesce(lv.a_pm, 0) a_pm
 from k left join pv on pv.sid = k.sid left join lv on lv.sid = k.sid
),
t as (
 select 0 o, sid, a0_n, a0_cost, b0_n, c0_n, c0_c, pa_n, pa_cost, p_dup, p_auto, a_n, a_cost, a_c, c_n, c_c, q_n, q_c, a_pm from r
 union all
 select 1, '合計', sum(a0_n), sum(a0_cost), sum(b0_n), sum(c0_n), sum(c0_c), sum(pa_n), sum(pa_cost), sum(p_dup), sum(p_auto), sum(a_n), sum(a_cost), sum(a_c),
  sum(c_n), sum(c_c), sum(q_n), sum(q_c), sum(a_pm) from r
)
select (select ym from p) as "月", t.sid as "店舗",
 t.a0_n as "前：確認済み 件", to_char(t.a0_cost / 100.0, 'FM999,999,990.00') as "前：原価対象 $",
 t.b0_n as "前：未転送 件", t.c0_n as "前：確認待ち 件", to_char(t.c0_c / 100.0, 'FM999,999,990.00') as "前：確認待ち $",
 t.pa_n as "見込み：確認済み 件", to_char(t.pa_cost / 100.0, 'FM999,999,990.00') as "見込み：原価対象 $",
 to_char((t.pa_cost - t.a0_cost) / 100.0, 'FM999,999,990.00') as "見込み：増える原価 $",
 t.a_n as "後：確認済み 件", t.a_pm as "後：うち人の反映（未照合）", to_char(t.a_cost / 100.0, 'FM999,999,990.00') as "後：原価対象 $",
 to_char(t.a_c / 100.0, 'FM999,999,990.00') as "後：原本の純額 $", t.c_n as "後：確認待ち 件", to_char(t.c_c / 100.0, 'FM999,999,990.00') as "後：確認待ち $",
 t.q_n as "後：うち QuickBooks 未転送 件", to_char(t.q_c / 100.0, 'FM999,999,990.00') as "後：QuickBooks 未転送 $",
 t.p_dup as "照合を待つ（アプリと同じかも）", t.p_auto as "照合を待つ（自動で反映）",
 coalesce((select s ->> 'rule' from live), '前の決まり') as "後の決まり",
 case when (select summary from snap) is not null then '残した集計'
  when (select has_table from snap) then 'この月は残していない（前も新しい決まり）'
  else 'いまの集計（まだ入れていない）' end as "前の出どころ"
from t
order by t.o, t.sid;
