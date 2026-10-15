-- invoice 取込 段階 2（Moto 2026-10-14「経理のinvoice処理追加変更点」・UI案50・決めてほしいこと 1〜8 は A）。
-- 照合済みにした原本は「店舗フォルダ / 照合済み / 年-月（請求日の月）」へ移す（店舗フォルダの直下・「○月 Uploaded」の原本も）。
-- Packing list は invoice として扱い、同じ業者・店舗・請求日・合計の書類があれば「重複の可能性」を出す。
--
-- Changes (the worker and the screen do the rest):
--   invoice_folders.role       : 'reconciled_root' (照合済み right in the store folder) and 'reconciled_month' (YYYY-MM in it)
--   invoice_organize_due       : p.targets — only the filings that are switched on (mode.organize: 00_Upload → year/month/未照合;
--                                mode.organize_reconciled: reconciled originals; absent = the same as mode.organize)
--   invoice_list               : also returns vendor_key; rows with the same date and time keep one order (id) across pages
--   invoice_dup_scope          : also says whether a stored document is a packing list
--   invoice_post               : packing_list is for reference only; a file whose store a person chose is never posted automatically
--   invoice_files_due          : also says whether a person chose the store of the file
-- Replaced functions keep their names and arguments, so their grants (service_role only) stay. Nothing else changes:
-- no row, setting or Drive file is touched. Running this file twice changes nothing.

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_files' and column_name='rename_state') then
  raise exception '先に 20261012120000_invoice_rename_after_post.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

alter table public.invoice_folders drop constraint if exists invoice_folders_role_check;
alter table public.invoice_folders add constraint invoice_folders_role_check
 check (role in ('year','month','unreconciled','reconciled','reconciled_root','reconciled_month'));

create or replace function public.invoice_dup_scope(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'file_id',d.file_id,'status',d.status,'store_id',d.store_id,'vendor_key',d.vendor_key,
  'invoice_no_norm',d.invoice_no_norm,'invoice_date',d.invoice_date,'total_cents',d.total_cents,'content_sig',d.content_sig,'sha256',d.sha256,'duplicate_of',d.duplicate_of,
  'packing', d.reasons @> '[{"code":"packing_list"}]'::jsonb)), '[]')
 from public.invoice_docs d
 where d.status in ('review','posted','duplicate')
  and (d.sha256=p->>'sha256'
   or (d.vendor_key=p->>'vendor_key' and d.invoice_no_norm=p->>'invoice_no_norm')
   or (d.vendor_key=p->>'vendor_key' and d.store_id=p->>'store_id' and d.invoice_date=(p->>'invoice_date')::date and d.total_cents=(p->>'total_cents')::bigint));
$$;

create or replace function public.invoice_post(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; old public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; who text; mode text; rules jsonb; m jsonb;
 closed text; n int := 0; l public.invoice_lines; skipped int := 0; blocking text; ack text[];
 -- Accounting checks the vendor, the invoice number, the amount and the store (Moto 2026-10-07). Products and unit prices
 -- are kept for reference only: they never stop posting (info), and a line that cannot be matched is not price history.
 must_fix text[] := array['duplicate_certain','total_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 info text[] := array['unmapped','map_ambiguous','map_unverified','unit_mismatch','unit_unverified','spec_changed','no_price_ref','price_jump',
  'mode_review_item','catch_weight','line_math','zero_price','negative_line','line_qty_price_missing','discount_allocation','mixed_tax','packing_list'];
 -- A line amount that cannot be read leaves the total unchecked: posted only when the person checked it against the
 -- original. line_value_missing is the code documents read before 2026-10-07 carry for the same case (Codex R7).
 may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing','line_value_missing'];
begin
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status <> 'review' then raise exception 'invalid_state'; end if;
 if d.posting_kind <> 'purchase' then raise exception 'not_a_purchase'; end if;
 if d.effective_date is null or d.vendor_key is null or d.total_cents is null then raise exception 'header_incomplete'; end if;
 rules := public.invoice_setting('rules'); m := public.invoice_setting('mode');
 ack := coalesce(array(select jsonb_array_elements_text(p->'ack')), '{}');
 select r->>'code' into blocking from jsonb_array_elements(d.reasons) r where r->>'code' = any(must_fix) limit 1;
 if blocking is not null then raise exception 'blocked:%', blocking; end if;
 select r->>'code' into blocking from jsonb_array_elements(d.reasons) r where r->>'code' = any(may_ack) and not (r->>'code' = any(ack))
  and not (r->>'code' = 'original_replaced' and nullif(p->>'supersedes','') is not null) limit 1;
 if blocking is not null then raise exception 'blocked:%', blocking; end if;
 if d.doc_type='credit_memo' and (d.related_doc_id is null or d.relation is distinct from 'credit_for') then raise exception 'relation_required'; end if;
 if actor is null then
  -- Automatic posting: only a document whose reasons are all for reference (products, unit prices), with every switch on.
  if not coalesce((m->>'auto_post')::boolean,false) then raise exception 'auto_off'; end if;
  if not d.auto_eligible or d.doc_type<>'invoice' then raise exception 'not_eligible'; end if;
  if exists(select 1 from jsonb_array_elements(d.reasons) r where not (r->>'code' = any(info))) then raise exception 'not_eligible'; end if;
  if exists(select 1 from public.invoice_lines il, jsonb_array_elements_text(il.reasons) c where il.doc_id=d.id and not (c = any(info))) then raise exception 'not_eligible'; end if;
  if not exists(select 1 from public.invoice_stores where store_id=d.store_id and auto_post and active) then raise exception 'not_eligible'; end if;
  if not exists(select 1 from public.invoice_vendor_rules where vendor_key=d.vendor_key and auto_post) then raise exception 'not_eligible'; end if;
  -- A file whose store a person chose waits for a person (UI案50).
  if exists(select 1 from public.invoice_files where id=d.file_id and store_assigned_by is not null) then raise exception 'not_eligible'; end if;
  who := 'auto'; mode := 'auto';
 else
  -- 事務Crew (office_crew) posts like accounting (Moto 2026-10-09: 事務Crew completes the invoice work on their own).
  perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
  who := actor::text; mode := 'manual';
  if length(coalesce(p->>'reason','')) = 0 and jsonb_array_length(d.reasons) > 0 then raise exception 'reason_required'; end if;
 end if;
 closed := rules->>'closed_through';
 if closed is not null and to_char(coalesce(d.invoice_date, d.effective_date),'YYYY-MM') <= closed then
  if actor is null or not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;
  update public.invoice_docs set needs_adjustment=true where id=d.id;
 end if;
 -- A corrected version replaces a posted one in the same transaction; the old one is kept as superseded.
 if nullif(p->>'supersedes','') is not null then
  select * into old from public.invoice_docs where id=(p->>'supersedes')::uuid for update;
  if old.id is null or old.status<>'posted' or old.store_id<>d.store_id or old.vendor_key is distinct from d.vendor_key then raise exception 'bad_supersede'; end if;
  if closed is not null and to_char(old.invoice_date,'YYYY-MM') <= closed then
   if not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;
   update public.invoice_docs set needs_adjustment=true where id=old.id;
  end if;
  update public.invoice_price_history set status='voided', voided_by=who, voided_at=now(), void_reason='superseded' where doc_id=old.id and status='active';
  update public.invoice_docs set status='superseded', version=version+1, updated_at=now() where id=old.id;
  update public.invoice_docs set related_doc_id=old.id, relation='correction_of' where id=d.id;
  update public.invoice_files set organize_target='unreconciled', organize_status='pending', organize_attempts=0, organize_next_at=null
  where id in (old.file_id, d.file_id) and organize_target='reconciled';
  perform public.invoice_event(old.id, old.file_id, who, 'superseded', jsonb_build_object('by', d.id));
 end if;
 for l in select * from public.invoice_lines where doc_id=d.id order by line_no loop
  if public.invoice_price_insert(d.id, l.id, who, nullif(p->>'reason','')) then n := n + 1; else skipped := skipped + 1; end if;
 end loop;
 update public.invoice_docs set status='posted', posted_at=now(), posted_by=who, posted_mode=mode, version=version+1, updated_at=now()
 where id=d.id;
 update public.invoice_files set organize_target=coalesce(organize_target,'unreconciled') where id=d.file_id;
 perform public.invoice_event(d.id, d.file_id, who, 'posted', jsonb_build_object('mode', mode, 'price_rows', n, 'price_skipped', skipped,
  'reason', p->>'reason', 'ack', p->'ack', 'supersedes', p->>'supersedes'));
 perform public.invoice_file_settle(jsonb_build_object('file_id', d.file_id));
 return jsonb_build_object('ok', true, 'price_rows', n, 'price_skipped', skipped, 'version', d.version + 1, 'file_id', d.file_id);
end $$;

create or replace function public.invoice_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; r jsonb; total int; sum_cents bigint;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 with q as (
  select d.id, d.store_id, d.doc_type, d.vendor_key, d.vendor_name, d.vendor_raw, d.invoice_no, d.invoice_date, d.delivery_date, d.total_cents,
   d.status, d.recon_status, d.reasons, d.needs_adjustment, d.posted_mode, d.version, f.drive_file_id, f.current_name, f.organize_status, f.drive_state,
   f.ingested_at, (select state from public.invoice_qb_outbox o where o.file_id=f.id and o.state<>'cancelled' order by created_at desc limit 1) qb_state
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where (jsonb_typeof(p->'stores') is distinct from 'array' or d.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
   and (p->>'vendor' is null or d.vendor_name ilike '%'||(p->>'vendor')||'%' or d.vendor_raw ilike '%'||(p->>'vendor')||'%')
   and (p->>'from' is null or d.invoice_date >= (p->>'from')::date) and (p->>'to' is null or d.invoice_date <= (p->>'to')::date)
   and (p->>'invoice_no' is null or d.invoice_no ilike '%'||(p->>'invoice_no')||'%')
   and (p->>'min_cents' is null or d.total_cents >= (p->>'min_cents')::bigint) and (p->>'max_cents' is null or d.total_cents <= (p->>'max_cents')::bigint)
   and (p->>'item' is null or exists(select 1 from public.invoice_lines l where l.doc_id=d.id and l.raw_name ilike '%'||(p->>'item')||'%'))
   and (p->>'status' is null or d.status=p->>'status') and (p->>'recon' is null or d.recon_status=p->>'recon'))
 select (select count(*) from q), (select coalesce(sum(total_cents),0) from q),
  coalesce((select jsonb_agg(to_jsonb(x) order by x.invoice_date desc nulls first, x.ingested_at desc, x.id) from
   (select * from q order by invoice_date desc nulls first, ingested_at desc, id
    limit least(coalesce((p->>'limit')::int,50),200) offset coalesce((p->>'offset')::int,0)) x), '[]')
 into total, sum_cents, r;
 return jsonb_build_object('rows', r, 'total', total, 'sum_cents', sum_cents);
end $$;

create or replace function public.invoice_files_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id, f.drive_file_id, f.store_id, f.original_name, f.mime_type, f.store_assigned_by is not null store_assigned from public.invoice_files f
  where f.drive_state='ok' and f.attempts < 6
   and (f.intake_status in ('pending','error') or (f.intake_status='processing' and f.lease_until < now()))
   and (f.next_attempt_at is null or f.next_attempt_at <= now()) and (f.lease_until is null or f.lease_until < now())
   and (jsonb_typeof(p->'stores') is distinct from 'array' or f.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
  order by f.ingested_at limit coalesce((p->>'limit')::int, 3)) x;
$$;

create or replace function public.invoice_organize_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id file_id, f.drive_file_id, f.store_id, f.original_name, f.organize_target target, d.invoice_date, d.vendor_name, d.doc_type,
   d.invoice_no, d.internal_no, (select count(*) from public.invoice_file_versions v where v.file_id=f.id) version_no,
   (select coalesce(jsonb_agg(fo.id), '[]') from public.invoice_folders fo where fo.store_id=f.store_id) store_folder_ids,
   -- A file a person assigned to another store may still sit in a store's 00_Upload; it may be filed from there.
   case when f.store_assigned_by is not null then (select coalesce(jsonb_agg(s2.upload_folder_id), '[]') from public.invoice_stores s2 where s2.upload_folder_id is not null)
        else '[]'::jsonb end upload_folder_ids
  from public.invoice_files f
  join public.invoice_docs d on d.file_id=f.id and d.sha256=f.current_sha256 and d.doc_index=0
  where f.drive_state='ok' and f.organize_target is not null
   -- targets: the filings that are switched on (00_Upload filing and moving reconciled originals are two switches, Moto 2026-10-14).
   and (jsonb_typeof(p->'targets') is distinct from 'array' or f.organize_target in (select jsonb_array_elements_text(case when jsonb_typeof(p->'targets')='array' then p->'targets' else '[]'::jsonb end)))
   and (f.organize_status='pending' or (f.organize_status='error' and f.organize_next_at <= now() and f.organize_attempts < 8))
   and d.status in ('review','posted') and d.vendor_name is not null and d.invoice_date is not null
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0)
  order by f.updated_at limit coalesce((p->>'limit')::int, 10)) x;
$$;
