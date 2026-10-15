-- 読むだけ（何も変えない）。照合済みにした invoice の原本が、いまどこにあるかを店舗ごとに数える（Moto 2026-10-15「経理確認済みの
-- ファイルは今までのものも照合済みフォルダに移動できますか」）。段階 2・3 の SQL の前でもあとでも流せる。
--
-- 列（件数は原本のファイルの数。複数枚の invoice はページごとに数える）
--   照合済みの原本          : 反映済み（または対象外の書類）で、経理が照合済みにした invoice の原本（Drive にあるもの）
--   照合済み_年月に移した    : もう「照合済み / 年-月」にある（段階 2 のあと移したもの）
--   移す待ち                : 移す順番を待っている（「照合したら移す」が ON なら 5 分ごとに 10 件ずつ移る）
--   移せなかった            : 移そうとしてエラー（店舗フォルダの外に移された・Drive が見つからない など。取込状況に出る）
--   前の版の_年月_照合済み   : 前の版の整理で「年 / 月 / 照合済み」に入ったもの（いまはそのまま）
--   店舗の場所に置いたまま    : 店舗フォルダの直下や「○月 Uploaded」など、店舗の人の場所に置いたまま「整理済み」にしたもの（いまはそのまま）
--   移せないもの            : 1 つのファイルに書類が 2 つ・請求日か業者が無い（どれも自動では動かさない）
-- 「前の版の_年月_照合済み」と「店舗の場所に置いたまま」が、invoice-reconciled-backlog-move.sql で移す待ちに入れ直すもの。
with mode as (select coalesce(public.invoice_setting('mode'), '{}'::jsonb) m),
f as (
 select f.store_id, f.organize_target, f.organize_status, fo.role folder_role,
  d.vendor_name is null or d.invoice_date is null
   or exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0) cannot
 from public.invoice_files f
 join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.doc_index=0
 -- a page merged into another invoice (段階 3) goes with that invoice; to_jsonb keeps this file working before 段階 3 too
 join public.invoice_docs d on d.id=coalesce((to_jsonb(d0)->>'merged_into')::uuid, d0.id)
 left join public.invoice_folders fo on fo.id=f.organized_folder_id
 where f.drive_file_id is not null and f.drive_state='ok' and d.recon_status='reconciled' and d.status in ('review','posted')
),
c as (
 select store_id,
  count(*) n,
  count(*) filter (where not cannot and organize_target='reconciled' and organize_status='done' and folder_role='reconciled_month') moved,
  count(*) filter (where not cannot and organize_target='reconciled' and organize_status='pending') waiting,
  count(*) filter (where not cannot and organize_target='reconciled' and organize_status='error') failed,
  count(*) filter (where not cannot and organize_status='done' and folder_role='reconciled') old_folder,
  count(*) filter (where not cannot and organize_status='done' and coalesce(folder_role, '') not in ('reconciled', 'reconciled_month')) left_in_place,
  count(*) filter (where cannot) cannot
 from f group by store_id
)
select "店舗", "照合済みの原本", "照合済み_年月に移した", "移す待ち", "移せなかった", "前の版の_年月_照合済み", "店舗の場所に置いたまま", "移せないもの", "そのほか"
from (
 select 0 k, coalesce(s.label, c.store_id) "店舗", c.n "照合済みの原本", c.moved "照合済み_年月に移した", c.waiting "移す待ち", c.failed "移せなかった",
  c.old_folder "前の版の_年月_照合済み", c.left_in_place "店舗の場所に置いたまま", c.cannot "移せないもの",
  c.n - c.moved - c.waiting - c.failed - c.old_folder - c.left_in_place - c.cannot "そのほか"
 from c left join public.invoice_stores s on s.store_id=c.store_id
 union all
 select 1, '合計', coalesce(sum(n),0), coalesce(sum(moved),0), coalesce(sum(waiting),0), coalesce(sum(failed),0), coalesce(sum(old_folder),0),
  coalesce(sum(left_in_place),0), coalesce(sum(cannot),0), coalesce(sum(n - moved - waiting - failed - old_folder - left_in_place - cannot),0) from c
 union all
 -- スイッチ：「00_Upload を整理する」と「照合したら移す」（入れていなければ「整理する」と同じ）・段階 2 の SQL が入っているか
 select 2, '設定：整理する=' || coalesce((select m->>'organize' from mode), 'false')
  || '・照合したら移す=' || coalesce((select m->>'organize_reconciled' from mode), '（整理すると同じ）')
  || '・段階2の SQL=' || case when exists(select 1 from pg_constraint where conname='invoice_folders_role_check'
    and pg_get_constraintdef(oid) like '%reconciled_month%') then '入っている' else 'まだ' end,
  null, null, null, null, null, null, null, null
) r
order by k, "店舗";
