-- 今までに照合済みにした invoice の原本を「照合済み / 年-月」へ移す待ちに入れ直す（Moto 2026-10-15「経理確認済みのファイルは
-- 今までのものも照合済みフォルダに移動できますか」）。
--
-- 何をするか：経理が照合済みにした invoice の原本のうち、まだ「照合済み / 年-月」に無いもの（店舗フォルダの直下や「○月 Uploaded」に
--   置いたまま整理済みにしたもの・前の版の「年 / 月 / 照合済み」に入ったもの・移せなかったもの）を、移す待ちに戻すだけ。
--   この SQL は Drive を触らない。実際に移すのは 5 分ごとの動き（「照合したら移す」が ON のとき・1 回に 10 件ずつ）。
--   移すときは今までどおり、店舗フォルダの中にあるものだけを動かす（外にあるものは動かさず、取込状況にエラー）。名前は変えない。
-- 入れないもの：もう「照合済み / 年-月」にあるもの・照合していないもの・1 つのファイルに書類が 2 つのもの・請求日か業者が無いもの・
--   Drive で見つからないもの。
-- 先に：1_追加のSQL_段階2と段階3.sql と関数（段階 3）。段階 2 の SQL が入っていなければ、何も変えずに止まる。
-- 2 回流しても同じ（もう待っているもの・移したものは数えない）。流したあと invoice-reconciled-backlog-check.sql で確かめる。
do $$ begin
 if not exists(select 1 from pg_constraint where conname='invoice_folders_role_check' and pg_get_constraintdef(oid) like '%reconciled_month%') then
  raise exception '先に 1_追加のSQL_段階2と段階3.sql を流してください（何も変えていません）';
 end if;
end $$;

with t as (
 select f.id, f.store_id, d.id doc_id
 from public.invoice_files f
 join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.doc_index=0
 join public.invoice_docs d on d.id=coalesce((to_jsonb(d0)->>'merged_into')::uuid, d0.id)
 left join public.invoice_folders fo on fo.id=f.organized_folder_id
 where f.drive_file_id is not null and f.drive_state='ok'
  and d.recon_status='reconciled' and d.status in ('review','posted')
  and d.vendor_name is not null and d.invoice_date is not null
  and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0)
  -- already in 照合済み/年-月, or already waiting: left as it is
  and not (f.organize_target='reconciled' and f.organize_status='done' and fo.role is not distinct from 'reconciled_month')
  and not (f.organize_target='reconciled' and f.organize_status='pending')
 for update of f
),
u as (
 update public.invoice_files f set organize_target='reconciled', organize_status='pending', organize_attempts=0, organize_error=null,
  organize_next_at=null, updated_at=now()
 from t where f.id=t.id
 returning f.id, f.store_id, t.doc_id
),
e as (
 insert into public.invoice_events(doc_id, file_id, actor, kind, data)
 select u.doc_id, u.id, 'backfill', 'organize_requeued', jsonb_build_object('target', 'reconciled', 'why', 'reconciled before 段階 2') from u
 returning 1
)
select "店舗", "移す待ちに入れた原本" from (
 select 0 k, coalesce(s.label, u.store_id) "店舗", count(*) "移す待ちに入れた原本"
 from u left join public.invoice_stores s on s.store_id=u.store_id group by 2
 union all
 select 1, '合計', (select count(*) from u)
) r order by k, "店舗";
