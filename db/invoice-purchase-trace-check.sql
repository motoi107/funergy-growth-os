-- 仕入れタブに「経理確認済み」の invoice が入らない件：1 件ずつ、どこで止まっているかを見る（読むだけ・何も変えない・2026-10-29）
-- 結果をそのまま Claude に貼ってください（結果の表の右上「Copy」→ Markdown か CSV）。
--
-- 何を見るか（上から順に）
--   設定 … 取込・名前の変更・照合済みフォルダ・QuickBooks の送る担当・仕入れ集計・5 分ごとの動き・書き出しの時刻
--   店   … 店ごとに、反映済み（うち人が反映）・照合済みの件数と額、サーバーが今計算した区分（A 確認済み／B 未転送＝10/29 より前の決まり／
--          C 確認待ち／E 保留）、アプリが読んでいる集計（app_state）の A
--   1 件 … 経理が確認した invoice（人が反映したもの・または照合済み。10/29 からの「確認済み」）を 1 件ずつ：ファイル名（変更の前と後）、
--          名前の変更、照合済みフォルダへの移動、QuickBooks の台帳、アプリの写し、サーバーが今計算した区分と理由、アプリが読んでいる集計の区分
-- 月は下の '2026-10' を変えると、ほかの月も見られる（月は請求日・無ければ納品日・ハワイ時間。集計と同じ決め方）。
-- 出さないもの：鍵・メールアドレス（QuickBooks の宛先は「設定あり／なし」と「今の宛先と同じか」だけ）・明細。
with p as (select '2026-10'::text ym),
sq as (select coalesce((select value from public.invoice_settings where key='qb'), '{}'::jsonb) v),
sm as (select coalesce((select value from public.invoice_settings where key='mode'), '{}'::jsonb) v),
sr as (select coalesce((select value from public.invoice_settings where key='rules'), '{}'::jsonb) v),
sp as (select coalesce((select value from public.invoice_settings where key='purchase'), '{}'::jsonb) v),
sw as (select coalesce((select value from public.invoice_settings where key='worker'), '{}'::jsonb) v),
since as (select public.invoice_qb_since_at() t),
-- サーバーが今この月を計算したら（書き出す前の中身。読むだけの関数）
pm as (select public.invoice_purchase_month(p.ym) j from p),
calc as (
 select st.key store, e->>'id' id, e->>'cat' cat, e->'why' why, e->>'cost' cost, e->>'c' cents
 from pm cross join lateral jsonb_each(case when jsonb_typeof(pm.j->'summary'->'stores')='object' then pm.j->'summary'->'stores' else '{}'::jsonb end) st
  cross join lateral jsonb_array_elements(case when jsonb_typeof(st.value->'docs')='array' then st.value->'docs' else '[]'::jsonb end) e
),
-- アプリが読んでいる集計（app_state の invoice_purchase_<月>）
ar as (select (select a.value::jsonb from public.app_state a where a.key = 'invoice_purchase_' || p.ym) j from p),
arst as (select (select a.value::jsonb from public.app_state a where a.key = 'invoice_purchase_status') j),
aread as (
 select st.key store, e->>'id' id, e->>'cat' cat, e->'why' why
 from ar cross join lateral jsonb_each(case when jsonb_typeof(ar.j->'stores')='object' then ar.j->'stores' else '{}'::jsonb end) st
  cross join lateral jsonb_array_elements(case when jsonb_typeof(st.value->'docs')='array' then st.value->'docs' else '[]'::jsonb end) e
),
pub as (select x.* from public.invoice_purchase_published x join p on p.ym = x.ym),
run as (select r.* from public.invoice_runs r where r.kind = 'intake' order by r.finished_at desc limit 1),
-- その月の invoice（集計と同じ月の決め方）
d as (
 select x.*, f.original_name, f.current_name, f.drive_state, f.current_sha256, f.drive_created_at, f.source fsource,
  f.rename_state, f.rename_attempts, f.rename_error, f.renamed_at, f.organize_target, f.organize_status, f.organize_attempts, f.organize_error,
  (select fo.role from public.invoice_folders fo where fo.id = f.organized_folder_id) folder_role,
  public.invoice_rename_waiting(f.id) rename_wait,
  coalesce(nullif(x.vendor_name, ''), x.vendor_raw, '') vn
 from public.invoice_docs x join public.invoice_files f on f.id = x.file_id, p
 where (x.posting_kind = 'purchase' or (x.status = 'review' and x.doc_type = 'unknown'))
  and to_char(coalesce(x.invoice_date, x.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = p.ym
)
-- ---------------------------------------------------------------- 設定
select 1 as "順", '設定' as "区分", '' as "店舗", '取込' as "invoice",
 '取込 ' || coalesce(sm.v->>'intake', '?') || '・写し ' || coalesce(sm.v->>'mirror', '?')
  || '・開始 ' || coalesce(to_char(nullif(sm.v->>'start_at', '')::timestamptz at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI'), '?')
  || '・5 分ごとの動き ' || coalesce(sw.v->>'enabled', '?') as "請求日",
 '' as "金額", '' as "状態", '' as "照合",
 '名前の変更 ' || coalesce(sm.v->>'rename', '?') || '（' || coalesce(to_char(nullif(sm.v->>'rename_since', '')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '—') || ' から）' as "ファイル名",
 '' as "名前の変更",
 '00_Upload の整理 ' || coalesce(sm.v->>'organize', '?') || '・照合したら移す ' || coalesce(sm.v->>'organize_reconciled', '（未設定＝整理と同じ）') as "照合済みフォルダへ",
 '' as "QuickBooks", '' as "アプリの写し", '' as "サーバーの今の計算", '' as "アプリが読む集計"
from sm, sw
union all
select 2, '設定', '', 'QuickBooks の設定',
 '送る ' || coalesce(sq.v->>'enabled', '?') || '・送る担当 ' || coalesce(nullif(sq.v->>'route', ''), '未設定')
  || '・送り始め ' || coalesce(to_char(since.t at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI'), '未設定（＝台帳の前の扱いなし）'),
 '', '', '',
 '宛先 ' || case when coalesce(sq.v->>'to', '') <> '' then '設定あり' else 'なし' end
  || '・このシステムに切り替えた時刻 ' || coalesce(to_char(nullif(sq.v->>'route_since', '')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '—'),
 '', '',
 '台帳：' || coalesce((select string_agg(k || ' ' || n, '・' order by k) from (
   select o.route || '/' || o.state k, count(*) n from public.invoice_qb_outbox o group by 1) q), '0 件')
  || '・今の宛先と違う行 ' || (select count(*) from public.invoice_qb_outbox o where o.to_address is distinct from (sq.v->>'to')),
 '', '', ''
from sq, since
union all
select 3, '設定', '', '仕入れ集計',
 '止める ' || coalesce(sp.v->>'off', 'false') || '・締め済み ' || coalesce(sr.v->>'closed_through', 'なし'),
 '', '', '', '', '',
 'サーバーの書き出し：' || coalesce((select to_char(pub.published_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') || ' に書いた・'
   || to_char(pub.checked_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') || ' に確かめた' || case when pub.closed then '・締めた月' else '' end from pub), 'この月は書いていない'),
 '', '',
 'アプリの一覧：' || coalesce((select case when (arst.j->>'off')::boolean then '止めてある' else
    to_char((arst.j->>'checked_at')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') || ' に確かめた・この月 '
    || coalesce(to_char((arst.j->'months'->(select ym from p)->>'at')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '載っていない') end from arst), '無い'),
 'アプリの月の集計：' || coalesce((select case when ar.j is null then '無い' else
    coalesce(to_char((ar.j->>'generated_at')::timestamptz at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '?') || ' の版・サーバーと '
    || case when (select md5((ar.j - 'generated_at')::text) = md5(pub.summary::text) from pub) then '同じ' else '違う' end end from ar), '無い')
from sp, sr
union all
select 4, '設定', '', '最後の 5 分ごとの動き',
 coalesce((select to_char(run.finished_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI') || case when run.ok then '・成功' else '・失敗 ' || coalesce(left(run.error, 120), '') end from run), '記録なし'),
 '', '', '', '',
 '名前の変更 ' || coalesce((select (run.stats->>'renamed') from run), '0') || '・失敗 ' || coalesce((select (run.stats->>'rename_errors') from run), '0'),
 '照合済みへ移す・整理 ' || coalesce((select (run.stats->>'organized') from run), '0') || '・失敗 ' || coalesce((select (run.stats->>'organize_errors') from run), '0'),
 'QB：積んだ ' || coalesce((select run.stats->>'qb_queued' from run), '0') || '・送った ' || coalesce((select run.stats->>'qb_sent' from run), '0')
  || '・エラー ' || coalesce((select run.stats->>'qb_errors' from run), '0'),
 '', '集計の書き出し ' || coalesce((select run.stats->>'purchase_published' from run), '0') || '・失敗 ' || coalesce((select run.stats->>'purchase_errors' from run), '0'),
 '直近 24 時間の動き ' || (select count(*) from public.invoice_runs r where r.kind = 'intake' and r.finished_at > now() - interval '24 hours')
  || ' 回・失敗 ' || (select count(*) from public.invoice_runs r where r.kind = 'intake' and r.finished_at > now() - interval '24 hours' and not r.ok)
-- ---------------------------------------------------------------- 店ごと
union all
select 10, '店', s.store_id, '',
 '反映済み ' || count(*) filter (where d.status = 'posted') || ' 件 $' || to_char(coalesce(sum(d.total_cents) filter (where d.status = 'posted'), 0) / 100.0, 'FM999,999,990.00')
  || '（うち人が反映 ' || count(*) filter (where d.status = 'posted' and d.posted_mode = 'manual') || ' 件）',
 '照合済み ' || count(*) filter (where d.status = 'posted' and d.recon_status = 'reconciled') || ' 件 $'
  || to_char(coalesce(sum(d.total_cents) filter (where d.status = 'posted' and d.recon_status = 'reconciled'), 0) / 100.0, 'FM999,999,990.00'),
 '要確認 ' || count(*) filter (where d.status = 'review'), '差異 ' || count(*) filter (where d.status = 'posted' and d.recon_status = 'discrepancy'),
 '', '', '', '',
 '',
 'A ' || (select count(*) from calc c where c.store = s.store_id and c.cat = 'A') || ' 件 原価 $'
  || to_char(coalesce((select sum((c.cost)::numeric) from calc c where c.store = s.store_id and c.cat = 'A'), 0) / 100.0, 'FM999,999,990.00')
  || '・B ' || (select count(*) from calc c where c.store = s.store_id and c.cat = 'B') || ' 件 $'
  || to_char(coalesce((select sum((c.cents)::numeric) from calc c where c.store = s.store_id and c.cat = 'B'), 0) / 100.0, 'FM999,999,990.00')
  || '・C ' || (select count(*) from calc c where c.store = s.store_id and c.cat = 'C')
  || '・E ' || (select count(*) from calc c where c.store = s.store_id and c.cat = 'E')
  || coalesce('（B の理由：' || (select string_agg(k || ' ' || n, '・' order by k) from (select c.why->>0 k, count(*) n from calc c where c.store = s.store_id and c.cat = 'B' group by 1) q) || '）', ''),
 'A ' || (select count(*) from aread a where a.store = s.store_id and a.cat = 'A') || ' 件 原価 $'
  || to_char(coalesce((select ((ar.j->'stores'->s.store_id->'tot'->'A'->>'cost')::numeric) from ar), 0) / 100.0, 'FM999,999,990.00')
  || '・B ' || (select count(*) from aread a where a.store = s.store_id and a.cat = 'B')
from (select store_id from public.invoice_stores union select store_id from d) s left join d on d.store_id = s.store_id
group by s.store_id
-- ---------------------------------------------------------------- 1 件ずつ（経理が確認したもの：人が反映した・または照合済み）
union all
select 20, '1 件', d.store_id,
 d.internal_no || ' ' || d.vn || ' #' || coalesce(nullif(d.invoice_no, ''), '（番号なし）') || ' [' || left(d.id::text, 8) || ']',
 coalesce(to_char(d.invoice_date, 'MM/DD'), '（なし）') || coalesce(' 納品 ' || to_char(d.delivery_date, 'MM/DD'), '')
  || case when d.doc_type = 'credit_memo' then '・クレジット' else '' end,
 coalesce('$' || to_char(d.total_cents / 100.0, 'FM999,999,990.00'), '金額なし'),
 d.status || '・' || coalesce(d.posted_mode, '?') || ' ' || coalesce(to_char(d.posted_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '') || '・版 ' || d.version
  || case when d.sha256 is distinct from d.current_sha256 then '・原本の中身が変わった' else '' end,
 d.recon_status || ' ' || coalesce(to_char(d.recon_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), ''),
 d.original_name || case when d.current_name is distinct from d.original_name then ' → ' || d.current_name else '（変わっていない）' end
  || case when d.drive_state <> 'ok' then '・Drive ' || d.drive_state else '' end,
 coalesce(d.rename_state, '') || case when d.rename_wait then '・変更待ち' else '' end
  || case when coalesce(d.rename_attempts, 0) > 0 then '・' || d.rename_attempts || ' 回' else '' end
  || coalesce('・' || left(d.rename_error, 80), '') || coalesce('・' || to_char(d.renamed_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), ''),
 coalesce(d.organize_target, '—') || '・' || coalesce(d.organize_status, '') || coalesce('（' || d.folder_role || '）', '')
  || case when coalesce(d.organize_attempts, 0) > 0 then '・' || d.organize_attempts || ' 回' else '' end || coalesce('・' || left(d.organize_error, 80), ''),
 coalesce((select o.route || '/' || o.state || case when o.to_address is distinct from (select v->>'to' from sq) then '（前の宛先）' else '' end
    || case when o.attempts > 0 then '・' || o.attempts || ' 回' else '' end || coalesce('・送った ' || to_char(o.sent_at at time zone 'Pacific/Honolulu', 'MM/DD HH24:MI'), '')
    || coalesce('・' || left(o.last_error, 60), '')
   from public.invoice_qb_outbox o where o.sha256 = d.sha256 and o.state <> 'cancelled'
   order by (o.to_address is not distinct from (select v->>'to' from sq)) desc, (o.state = 'sent') desc, o.updated_at desc limit 1),
  '台帳に無い' || case when d.fsource <> 'drive' then '（Drive の原本ではない）'
    when (select t from since) is null then '（送り始めが未設定）'
    when not coalesce(d.drive_created_at >= (select t from since), false) then '（送り始めより前の原本）'
    when exists(select 1 from public.invoice_docs x where x.merged_into = d.id) then '（複数枚の invoice）'
    else '' end),
 coalesce((select m.state || coalesce('・' || left(m.error, 60), '') from public.invoice_app_mirror m where m.doc_id = d.id), '写しの記録なし'),
 coalesce((select c.cat || ' ' || coalesce((select string_agg(w, '・') from jsonb_array_elements_text(case when jsonb_typeof(c.why) = 'array' then c.why else '[]'::jsonb end) w), '')
   from calc c where c.id = d.id::text), '載っていない'),
 coalesce((select a.cat || ' ' || coalesce((select string_agg(w, '・') from jsonb_array_elements_text(case when jsonb_typeof(a.why) = 'array' then a.why else '[]'::jsonb end) w), '')
   from aread a where a.id = d.id::text), '載っていない')
from d
where d.status = 'posted' and (d.posted_mode = 'manual' or d.recon_status = 'reconciled')
order by 1, 3, 4;
