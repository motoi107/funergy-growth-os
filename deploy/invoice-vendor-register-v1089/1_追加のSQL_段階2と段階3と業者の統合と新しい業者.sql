-- invoice 取込 段階 2（Moto 2026-10-14「経理のinvoice処理追加変更点」・UI案50・決めてほしいこと 1〜8 は A）。
-- 照合済みにした原本は「店舗フォルダ / 照合済み / 年-月（請求日の月）」へ移す（店舗フォルダの直下・「○月 Uploaded」の原本も）。
-- Packing list は invoice として扱い、同じ業者・店舗・請求日・合計の書類があれば「重複の可能性」を出す。
--
-- Changes (the worker and the screen do the rest):
--   invoice_folders.role       : 'reconciled_root' (照合済み right in the store folder) and 'reconciled_month' (YYYY-MM in it)
--   invoice_organize_due       : p.targets — only the filings that are switched on (mode.organize: 00_Upload → year/month/未照合;
--                                mode.organize_reconciled: reconciled originals; absent = the same as mode.organize); p.back — an
--                                original whose reconciliation was taken back leaves 照合済み/年-月 under the reconciled switch too
--   invoice_list               : also returns vendor_key; rows with the same date and time keep one order (id) across pages
--   invoice_dup_scope          : also says whether a stored document is a packing list
--   invoice_post               : a file whose store a person chose is never posted automatically (a packing list never is either:
--                                its reason packing_list is not one of the reasons for reference)
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
  'mode_review_item','catch_weight','line_math','zero_price','negative_line','line_qty_price_missing','discount_allocation','mixed_tax'];
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
   and (jsonb_typeof(p->'targets') is distinct from 'array' or f.organize_target in (select jsonb_array_elements_text(case when jsonb_typeof(p->'targets')='array' then p->'targets' else '[]'::jsonb end))
    -- back: an original whose reconciliation was taken back leaves 照合済み/年-月 under the reconciled switch too.
    or (coalesce((p->>'back')::boolean,false) and f.organize_target='unreconciled'
     and exists(select 1 from public.invoice_folders fo where fo.id=f.organized_folder_id and fo.role='reconciled_month')))
   and (f.organize_status='pending' or (f.organize_status='error' and f.organize_next_at <= now() and f.organize_attempts < 8))
   and d.status in ('review','posted') and d.vendor_name is not null and d.invoice_date is not null
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0)
  order by f.updated_at limit coalesce((p->>'limit')::int, 10)) x;
$$;

-- invoice 取込 段階 3（Moto 2026-10-14「経理のinvoice処理追加変更点」5「同じinvoice#で続いてるパターンもあるので、重複か複数枚で１つの
-- invoiceか選択して処理できる様に」・UI案50 決めてほしいこと 6A・7A・8A・10/14「台帳に出さずに作る」）。
-- 同じ invoice 番号の原本（2 枚に分けて撮った invoice など）を 1 つの invoice にまとめる。QuickBooks へは、転送側（ChatGPT 側）が
-- 1 件にまとめて送れるようになるまで台帳に出さず、経理が手で入れたら「QuickBooks に入れた」と記録する。
--
-- Changes (the worker and the screen do the rest):
--   invoice_docs                : status 'merged' (a page merged into another invoice), merged_into, part_no, merge_base
--   invoice_merge               : merges pages into one invoice (also into a posted one: a correction), marks duplicates in the same step
--   invoice_unmerge             : takes a merge back while the invoice waits for review
--   invoice_qb_manual           : records that accounting entered an invoice of several originals in QuickBooks by hand
--   invoice_file_settle, _stage, _post, _edit, _mark, _reconcile, _reassign : the pages follow their invoice
--   invoice_organize_due, invoice_rename_waiting(_all), invoice_rename_due   : filed and named with their invoice (_p1, _p2)
--   invoice_qb_enqueue, invoice_qb_candidates : an invoice of several originals waits out of the ledger
--   invoice_list, invoice_get, invoice_purchase_month : a merged page is shown and counted in its invoice, never on its own
-- Replaced functions keep their names and arguments, so their grants (service_role only) stay. The new ones are for the service
-- role only. No row, setting or Drive file is changed. Running this file twice changes nothing.

do $$ begin
-- This file replaces invoice_purchase_month (20261019090000): without it the function would be new here, open to the browser roles
-- and without its tables. Run in this order: 20261019090000 → 20261020090000 → this file.
 if to_regclass('public.invoice_purchase_checks') is null or to_regclass('public.invoice_purchase_published') is null
  or to_regprocedure('public.invoice_purchase_month(text,jsonb)') is null then
  raise exception '先に 20261019090000_invoice_purchase_summary.sql を流してください（この SQL はそのあとに流します）';
 end if;
 if not exists(select 1 from pg_constraint where conname='invoice_folders_role_check' and pg_get_constraintdef(oid) like '%reconciled_month%') then
  raise exception '先に 20261020090000_invoice_reconciled_folder.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

alter table public.invoice_docs drop constraint if exists invoice_docs_status_check;
alter table public.invoice_docs add constraint invoice_docs_status_check
 check (status in ('review','posted','rejected','superseded','duplicate','merged'));
alter table public.invoice_docs add column if not exists merged_into uuid references public.invoice_docs(id);
alter table public.invoice_docs add column if not exists part_no integer;
alter table public.invoice_docs add column if not exists merge_base jsonb;
create index if not exists invoice_docs_merged on public.invoice_docs(merged_into) where merged_into is not null;

create or replace function public.invoice_file_settle(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f uuid := (p->>'file_id')::uuid; st text;
begin
 select case
   when bool_or(status='review') then 'review'
   when bool_and(status='duplicate') then 'duplicate'
   when bool_and(status in ('posted','duplicate','rejected','superseded')) and bool_or(status='posted') then 'posted'
   else 'review' end into st
 -- A page merged into another invoice (Moto 2026-10-14・UI案50 5) counts as that invoice does.
 from (select case when d.status='merged' then coalesce((select m.status from public.invoice_docs m where m.id=d.merged_into), 'review') else d.status end status
       from public.invoice_docs d where d.file_id=f and d.sha256=(select current_sha256 from public.invoice_files where id=f)) x;
 if p ? 'status' then st := p->>'status'; end if;
 update public.invoice_files set intake_status=coalesce(st,'review'), lease_owner=null, lease_until=null, last_error=null, next_attempt_at=null, updated_at=now()
 where id=f and (lease_owner=p->>'owner' or (p->>'owner' is null and intake_status not in ('pending','processing')));
 return jsonb_build_object('status', st);
end $$;

create or replace function public.invoice_stage(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; h jsonb := p->'header'; l jsonb; i int := 0; dup uuid; st text; prior text;
 rs jsonb := coalesce(p->'reasons','[]'); auto boolean := coalesce((p->>'auto_eligible')::boolean,false);
begin
 select * into d from public.invoice_docs where source_key=p->>'source_key';
 if d.id is not null then return jsonb_build_object('doc_id', d.id, 'existed', true, 'version', d.version, 'status', d.status); end if;
 -- The same Drive file read before with other content (overwritten in Drive): the new version always waits for a person,
 -- who supersedes the earlier version, marks this one as a duplicate, or confirms that both stand.
 select string_agg(o.id::text, ',' order by o.created_at, o.doc_index) into prior from public.invoice_docs o
 -- A page merged into an invoice counts too (its lines are in that invoice, UI案50 5).
 where o.file_id=(p->>'file_id')::uuid and o.sha256 is distinct from p->>'sha256' and o.status in ('posted','review','merged');
 if prior is not null then
  rs := rs || jsonb_build_array(jsonb_build_object('code', 'original_replaced', 'detail', prior)); auto := false;
 end if;
 dup := nullif(p->>'duplicate_of','')::uuid;
 st := case when dup is not null then 'duplicate' else 'review' end;
 insert into public.invoice_docs(source_key, file_id, sha256, doc_index, internal_no, store_id, doc_type, posting_kind,
  vendor_key, vendor_name, vendor_raw, vendor_code, food_kind, invoice_no, invoice_no_norm,
  invoice_date, delivery_date, due_date, posting_date, effective_date, effective_basis, currency,
  subtotal_cents, discount_cents, tax_cents, shipping_cents, other_cents, total_cents, lines_sum_cents, other_charges,
  ship_to_raw, pages, pages_marked, references_raw, content_sig, status, reasons, auto_eligible, duplicate_of, ai)
 values(p->>'source_key', (p->>'file_id')::uuid, p->>'sha256', coalesce((p->>'doc_index')::int,0),
  upper(substr(md5(p->>'source_key'),1,10)), p->>'store_id', h->>'doc_type', h->>'posting_kind',
  h->>'vendor_key', h->>'vendor_name', h->>'vendor_raw', h->>'vendor_code', h->>'food_kind', h->>'invoice_no', h->>'invoice_no_norm',
  (h->>'invoice_date')::date, (h->>'delivery_date')::date, (h->>'due_date')::date, (h->>'posting_date')::date, (h->>'effective_date')::date,
  h->>'effective_basis', h->>'currency',
  (h->>'subtotal_cents')::bigint, (h->>'discount_cents')::bigint, (h->>'tax_cents')::bigint, (h->>'shipping_cents')::bigint,
  (h->>'other_cents')::bigint, (h->>'total_cents')::bigint, (h->>'lines_sum_cents')::bigint, coalesce(h->'other_charges','[]'),
  h->>'ship_to_raw', coalesce(array(select (jsonb_array_elements_text(h->'pages'))::int), '{}'),
  coalesce(array(select jsonb_array_elements_text(h->'pages_marked')), '{}'), coalesce(h->'references','[]'),
  p->>'content_sig', st, rs, auto, dup, p->'ai')
 returning * into d;
 for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
  i := i + 1;
  insert into public.invoice_lines(doc_id, line_no, page, item_code, raw_name, raw, qty, purchase_unit, spec, spec_key, unit_price,
   line_discount_cents, amount_cents, weight, weight_unit, price_unit, taxable, map_id, ingredient_code, count_unit, count_per_purchase,
   base_unit, base_per_purchase, price_per_purchase, price_per_count, price_per_base, prev_price, reasons)
  values(d.id, coalesce((l->>'line_no')::int, i), (l->>'page')::int, l->>'item_code', coalesce(l->>'raw_name',''), coalesce(l->'raw','{}'),
   (l->>'qty')::numeric, l->>'purchase_unit', l->>'spec', coalesce(l->>'spec_key',''), (l->>'unit_price')::numeric,
   (l->>'line_discount_cents')::bigint, (l->>'amount_cents')::bigint, l->>'weight', l->>'weight_unit', l->>'price_unit', (l->>'taxable')::boolean,
   (l->>'map_id')::uuid, l->>'ingredient_code', l->>'count_unit', (l->>'count_per_purchase')::numeric, l->>'base_unit', (l->>'base_per_purchase')::numeric,
   (l->>'price_per_purchase')::numeric, (l->>'price_per_count')::numeric, (l->>'price_per_base')::numeric, l->'prev_price', coalesce(l->'reasons','[]'));
 end loop;
 perform public.invoice_event(d.id, d.file_id, 'worker', 'staged', jsonb_build_object('reasons', d.reasons, 'auto', d.auto_eligible));
 return jsonb_build_object('doc_id', d.id, 'existed', false, 'version', d.version, 'status', d.status);
end $$;

create or replace function public.invoice_post(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; old public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; who text; mode text; rules jsonb; m jsonb;
 closed text; n int := 0; l public.invoice_lines; skipped int := 0; blocking text; ack text[];
 -- Accounting checks the vendor, the invoice number, the amount and the store (Moto 2026-10-07). Products and unit prices
 -- are kept for reference only: they never stop posting (info), and a line that cannot be matched is not price history.
 must_fix text[] := array['duplicate_certain','total_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 info text[] := array['unmapped','map_ambiguous','map_unverified','unit_mismatch','unit_unverified','spec_changed','no_price_ref','price_jump',
  'mode_review_item','catch_weight','line_math','zero_price','negative_line','line_qty_price_missing','discount_allocation','mixed_tax'];
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
  -- An invoice made of several originals is not replaced by a new version of one of them (UI案50 5): a person decides.
  if exists(select 1 from public.invoice_docs c where c.merged_into=old.id) then raise exception 'has_parts'; end if;
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
 update public.invoice_files set organize_target=coalesce(organize_target,'unreconciled') where id=d.file_id or id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id);
 perform public.invoice_event(d.id, d.file_id, who, 'posted', jsonb_build_object('mode', mode, 'price_rows', n, 'price_skipped', skipped,
  'reason', p->>'reason', 'ack', p->'ack', 'supersedes', p->>'supersedes'));
 perform public.invoice_file_settle(jsonb_build_object('file_id', d.file_id));
 perform public.invoice_file_settle(jsonb_build_object('file_id', x.file_id)) from public.invoice_docs x where x.merged_into=d.id;
 -- file_ids: every original of the invoice (the pages merged into it too), in page order, to rename and file.
 return jsonb_build_object('ok', true, 'price_rows', n, 'price_skipped', skipped, 'version', d.version + 1, 'file_id', d.file_id,
  'file_ids', (select jsonb_agg(q.fid order by q.o) from (select d.file_id fid, coalesce(d.part_no, 0) o
   union all select x.file_id, x.part_no from public.invoice_docs x where x.merged_into=d.id) q));
end $$;

create or replace function public.invoice_edit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; e jsonb; f text; v jsonb; ov jsonb; lid uuid;
 lrow public.invoice_lines; closed text; touched_price boolean := false; affects boolean := false; chg jsonb := '[]';
 money_fields text[] := array['invoice_date','delivery_date','total_cents','subtotal_cents','tax_cents','shipping_cents','discount_cents','other_cents',
  'vendor_key','invoice_no','doc_type','effective_date','currency'];
 -- Values a mismatch is computed from: when one of these (or a line) changes, an earlier acknowledgement no longer covers it.
 amount_fields text[] := array['total_cents','subtotal_cents','tax_cents','shipping_cents','discount_cents','other_cents','currency','doc_type'];
 amounts boolean := false;
 -- Accounting checks the vendor, the invoice number, the amount and the store (Moto 2026-10-07). Products and unit prices
 -- are kept for reference only: they never stop posting (info), and a line that cannot be matched is not price history.
 must_fix text[] := array['duplicate_certain','total_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 may_ack text[] := array['total_mismatch','line_amount_missing','line_value_missing'];
 ack text[] := coalesce(array(select jsonb_array_elements_text(p->'ack')), '{}'); blocking text;
 learned text; akey text;
begin
 -- 事務Crew (office_crew) does the invoice work like accounting (Moto 2026-10-09: 事務Crew completes it on their own).
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if length(coalesce(p->>'reason','')) = 0 then raise exception 'reason_required'; end if;
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status not in ('review','posted') then raise exception 'invalid_state'; end if;
 closed := public.invoice_setting('rules')->>'closed_through';
 ov := d.overrides;
 for f, v in select * from jsonb_each(coalesce(p->'header','{}')) loop
  if not (f = any(array['vendor_key','vendor_name','invoice_no','invoice_no_norm','invoice_date','delivery_date','due_date','doc_type','posting_kind',
     'currency','subtotal_cents','discount_cents','tax_cents','shipping_cents','other_cents','total_cents','food_kind','effective_date','effective_basis','posting_date'])) then
   raise exception 'field_not_editable'; end if;
  if f = any(money_fields) then affects := true; end if;
  if f = any(amount_fields) then amounts := true; end if;
  ov := ov || jsonb_build_object(f, jsonb_build_object('old', to_jsonb(d)->f, 'new', v, 'by', actor, 'at', now(), 'reason', p->>'reason'));
  chg := chg || jsonb_build_array(jsonb_build_object('field', f, 'old', to_jsonb(d)->f, 'new', v));
 end loop;
 touched_price := exists(select 1 from jsonb_array_elements(coalesce(p->'lines','[]')) ln where jsonb_typeof(ln->'set')='object' and ln->'set' <> '{}'::jsonb);
 -- A posted document stays posted only if the corrected values would pass posting. This applies to every correction of a
 -- posted document (a currency change alone must not slip through). A mismatch needs the person's acknowledgement again
 -- whenever an amount, the currency, the document type or a line changes; only a correction that touches none of these
 -- keeps a mismatch that was acknowledged when it was posted.
 if d.status='posted' then
  select r->>'code' into blocking from jsonb_array_elements(coalesce(p->'reasons', d.reasons)) r where r->>'code' = any(must_fix) limit 1;
  if blocking is not null then raise exception 'blocked:%', blocking; end if;
  select r->>'code' into blocking from jsonb_array_elements(coalesce(p->'reasons', d.reasons)) r
  where r->>'code' = any(may_ack) and not (r->>'code' = any(ack)) and (amounts or touched_price or not (d.reasons @> jsonb_build_array(r))) limit 1;
  if blocking is not null then raise exception 'blocked:%', blocking; end if;
 end if;
 if d.status='posted' and (affects or touched_price) and closed is not null
    and (to_char(d.invoice_date,'YYYY-MM') <= closed or coalesce((p->'header'->>'invoice_date'),'9999') <= closed||'-31') then
  if not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;
 end if;
 update public.invoice_docs x set
  vendor_key=coalesce(p->'header'->>'vendor_key', x.vendor_key), vendor_name=coalesce(p->'header'->>'vendor_name', x.vendor_name),
  invoice_no=coalesce(p->'header'->>'invoice_no', x.invoice_no), invoice_no_norm=coalesce(p->'header'->>'invoice_no_norm', x.invoice_no_norm),
  invoice_date=coalesce((p->'header'->>'invoice_date')::date, x.invoice_date), delivery_date=case when p->'header' ? 'delivery_date' then (p->'header'->>'delivery_date')::date else x.delivery_date end,
  due_date=case when p->'header' ? 'due_date' then (p->'header'->>'due_date')::date else x.due_date end, doc_type=coalesce(p->'header'->>'doc_type', x.doc_type),
  posting_kind=coalesce(p->'header'->>'posting_kind', x.posting_kind), currency=coalesce(p->'header'->>'currency', x.currency),
  subtotal_cents=coalesce((p->'header'->>'subtotal_cents')::bigint, x.subtotal_cents), discount_cents=coalesce((p->'header'->>'discount_cents')::bigint, x.discount_cents),
  tax_cents=coalesce((p->'header'->>'tax_cents')::bigint, x.tax_cents), shipping_cents=coalesce((p->'header'->>'shipping_cents')::bigint, x.shipping_cents),
  other_cents=coalesce((p->'header'->>'other_cents')::bigint, x.other_cents), total_cents=coalesce((p->'header'->>'total_cents')::bigint, x.total_cents),
  food_kind=coalesce(p->'header'->>'food_kind', x.food_kind), effective_date=coalesce((p->'header'->>'effective_date')::date, x.effective_date),
  effective_basis=coalesce(p->'header'->>'effective_basis', x.effective_basis), posting_date=coalesce((p->'header'->>'posting_date')::date, x.posting_date),
  overrides=ov,
  reasons=coalesce(p->'reasons', x.reasons), auto_eligible=false, content_sig=coalesce(p->>'content_sig', x.content_sig),
  lines_sum_cents=coalesce((p->>'lines_sum_cents')::bigint, x.lines_sum_cents),
  recon_status=case when x.status='posted' and affects and x.recon_status<>'unreconciled' then 'unreconciled' else x.recon_status end,
  needs_adjustment=x.needs_adjustment or (x.status='posted' and (affects or touched_price) and closed is not null
   and (to_char(x.invoice_date,'YYYY-MM') <= closed or coalesce(p->'header'->>'invoice_date','9999') <= closed||'-31')),
  version=x.version+1, updated_at=now()
 where x.id=d.id;
 for e in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
  lid := (e->>'line_id')::uuid;
  select * into lrow from public.invoice_lines where id=lid and doc_id=d.id for update;
  if lrow.id is null then raise exception 'line_not_found'; end if;
  ov := lrow.overrides;
  for f, v in select * from jsonb_each(coalesce(e->'set','{}')) loop
   if not (f = any(array['qty','unit_price','amount_cents','line_discount_cents','purchase_unit','spec_key','map_id','ingredient_code','count_unit',
      'count_per_purchase','base_unit','base_per_purchase','price_per_purchase','price_per_count','price_per_base','taxable','prev_price'])) then
    raise exception 'field_not_editable'; end if;
   ov := ov || jsonb_build_object(f, jsonb_build_object('old', to_jsonb(lrow)->f, 'new', v, 'by', actor, 'at', now(), 'reason', p->>'reason'));
   chg := chg || jsonb_build_array(jsonb_build_object('line', lrow.line_no, 'field', f, 'old', to_jsonb(lrow)->f, 'new', v));
   touched_price := true;
  end loop;
  update public.invoice_lines x set
   qty=coalesce((e->'set'->>'qty')::numeric, x.qty), unit_price=coalesce((e->'set'->>'unit_price')::numeric, x.unit_price),
   amount_cents=coalesce((e->'set'->>'amount_cents')::bigint, x.amount_cents), line_discount_cents=coalesce((e->'set'->>'line_discount_cents')::bigint, x.line_discount_cents),
   purchase_unit=coalesce(e->'set'->>'purchase_unit', x.purchase_unit), spec_key=coalesce(e->'set'->>'spec_key', x.spec_key),
   map_id=coalesce((e->'set'->>'map_id')::uuid, x.map_id), ingredient_code=coalesce(e->'set'->>'ingredient_code', x.ingredient_code),
   count_unit=coalesce(e->'set'->>'count_unit', x.count_unit), count_per_purchase=coalesce((e->'set'->>'count_per_purchase')::numeric, x.count_per_purchase),
   base_unit=coalesce(e->'set'->>'base_unit', x.base_unit), base_per_purchase=coalesce((e->'set'->>'base_per_purchase')::numeric, x.base_per_purchase),
   price_per_purchase=coalesce((e->'set'->>'price_per_purchase')::numeric, x.price_per_purchase),
   price_per_count=coalesce((e->'set'->>'price_per_count')::numeric, x.price_per_count), price_per_base=coalesce((e->'set'->>'price_per_base')::numeric, x.price_per_base),
   taxable=coalesce((e->'set'->>'taxable')::boolean, x.taxable), prev_price=coalesce(e->'set'->'prev_price', x.prev_price),
   reasons=coalesce(e->'reasons', x.reasons), overrides=ov
  where x.id=lid;
 end loop;
 if d.status='posted' and (affects or touched_price) then
  -- Earlier price rows are voided (kept, with who and why) and rebuilt from the corrected values.
  update public.invoice_price_history set status='voided', voided_by=actor::text, voided_at=now(), void_reason=p->>'reason'
  where doc_id=d.id and status='active';
  perform public.invoice_price_insert(d.id, l2.id, actor::text, p->>'reason') from public.invoice_lines l2 where l2.doc_id=d.id;
  -- A reconciled original whose key values changed is reconciled again and goes back to 未照合.
  update public.invoice_docs set recon_status='unreconciled' where id=d.id and recon_status<>'unreconciled';
  update public.invoice_files set organize_target='unreconciled', organize_status='pending', organize_attempts=0, organize_next_at=null
  where (id=d.file_id or id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id)) and organize_target='reconciled';
  update public.invoice_app_mirror set state='held', error='edited_after_post', updated_at=now() where doc_id=d.id and state='mirrored';
 end if;
 -- Every earlier value is kept in the event log, so repeated corrections never lose history.
 perform public.invoice_event(d.id, d.file_id, actor::text, 'edited', jsonb_build_object('changes', chg, 'reason', p->>'reason'));
 -- A person picked the vendor for a printed name that matched no vendor: teach that name, in this transaction, on the
 -- latest vendor row. Only the name is appended (the vendor's switches and other names stay as they are now), and only
 -- when no vendor has the name yet (same normalisation as invoice/dedupe.mjs aliasKey), so a name never becomes ambiguous.
 akey := nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw,''), NFKC)), '\s+', ' ', 'g')), '');
 if coalesce((p->>'learn_alias')::boolean,false) and d.vendor_key is null and akey is not null
    and coalesce(p->'header'->>'vendor_key','') <> '' then
  perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
  if not exists(select 1 from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) a(name)
                where nullif(btrim(regexp_replace(lower(normalize(a.name, NFKC)), '\s+', ' ', 'g')), '') = akey) then
   update public.invoice_vendor_rules set aliases=aliases || d.vendor_raw, updated_at=now() where vendor_key=p->'header'->>'vendor_key';
   if found then
    learned := d.vendor_raw;
    perform public.invoice_event(d.id, d.file_id, actor::text, 'vendor_alias_learned', jsonb_build_object('vendor_key', p->'header'->>'vendor_key', 'alias', learned));
   end if;
  end if;
 end if;
 return jsonb_build_object('ok', true, 'version', d.version + 1) || case when learned is not null then jsonb_build_object('alias_learned', learned) else '{}'::jsonb end;
end $$;

create or replace function public.invoice_mark(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; a text := p->>'action';
begin
 -- 事務Crew (office_crew) does the invoice work like accounting (Moto 2026-10-09: 事務Crew completes it on their own).
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if length(coalesce(p->>'reason','')) = 0 then raise exception 'reason_required'; end if;
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status = 'posted' then raise exception 'posted_use_correction'; end if;
 -- A page merged into an invoice, or an invoice made of several originals, changes through the merge (take it back first).
 if d.status = 'merged' then raise exception 'invalid_state'; end if;
 if exists(select 1 from public.invoice_docs c where c.merged_into=d.id) then raise exception 'has_parts'; end if;
 if a = 'duplicate' then
  if nullif(p->>'duplicate_of','') is null then raise exception 'duplicate_of_required'; end if;
  update public.invoice_docs set status='duplicate', duplicate_of=(p->>'duplicate_of')::uuid, version=version+1, updated_at=now() where id=d.id;
 elsif a = 'reject' then
  update public.invoice_docs set status='rejected', version=version+1, updated_at=now() where id=d.id;
 elsif a = 'reopen' then
  update public.invoice_docs set status='review', version=version+1, updated_at=now() where id=d.id;
 else raise exception 'bad_action'; end if;
 perform public.invoice_event(d.id, d.file_id, actor::text, 'marked_'||a, jsonb_build_object('reason', p->>'reason', 'duplicate_of', p->>'duplicate_of'));
 perform public.invoice_file_settle(jsonb_build_object('file_id', d.file_id));
 return jsonb_build_object('ok', true, 'version', d.version + 1);
end $$;

create or replace function public.invoice_reconcile(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; r text := p->>'result';
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if r not in ('reconciled','discrepancy','unreconciled') then raise exception 'bad_result'; end if;
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status not in ('posted') and not (d.posting_kind='none' and d.status='review') then raise exception 'invalid_state'; end if;
 if r = 'discrepancy' and length(coalesce(p->>'note','')) = 0 then raise exception 'note_required'; end if;
 update public.invoice_docs set recon_status=r, recon_by=actor::text, recon_at=now(), recon_note=nullif(p->>'note',''), recon_diff=p->'diff',
  version=version+1, updated_at=now() where id=d.id;
 if r = 'reconciled' then
  -- Every original of the invoice (the pages merged into it too, UI案50 5) goes with it.
  update public.invoice_files set organize_target='reconciled', organize_status='pending', organize_attempts=0, organize_error=null, organize_next_at=null
  where id=d.file_id or id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id);
 else
  update public.invoice_files set organize_target='unreconciled', organize_status='pending', organize_attempts=0, organize_error=null, organize_next_at=null
  where (id=d.file_id or id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id)) and organize_target='reconciled';
 end if;
 perform public.invoice_event(d.id, d.file_id, actor::text, 'reconcile_'||r, jsonb_build_object('note', p->>'note', 'diff', p->'diff'));
 return jsonb_build_object('ok', true, 'version', d.version + 1);
end $$;

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
  join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.doc_index=0
  -- A page merged into another invoice (UI案50 5) is filed with that invoice: its date, vendor and state.
  join public.invoice_docs d on d.id=coalesce(d0.merged_into, d0.id)
  where f.drive_state='ok' and f.organize_target is not null
   -- targets: the filings that are switched on (00_Upload filing and moving reconciled originals are two switches, Moto 2026-10-14).
   and (jsonb_typeof(p->'targets') is distinct from 'array' or f.organize_target in (select jsonb_array_elements_text(case when jsonb_typeof(p->'targets')='array' then p->'targets' else '[]'::jsonb end))
    -- back: an original whose reconciliation was taken back leaves 照合済み/年-月 under the reconciled switch too.
    or (coalesce((p->>'back')::boolean,false) and f.organize_target='unreconciled'
     and exists(select 1 from public.invoice_folders fo where fo.id=f.organized_folder_id and fo.role='reconciled_month')))
   and (f.organize_status='pending' or (f.organize_status='error' and f.organize_next_at <= now() and f.organize_attempts < 8))
   and d.status in ('review','posted') and d.vendor_name is not null and d.invoice_date is not null
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0)
  order by f.updated_at limit coalesce((p->>'limit')::int, 10)) x;
$$;

create or replace function public.invoice_rename_waiting(p_file uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.invoice_files f
  join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.doc_index=0 and d0.status in ('posted','merged')
  -- d: the posted invoice the original belongs to (itself, or the invoice it was merged into as one of its pages, UI案50 5).
  join public.invoice_docs d on d.id=coalesce(d0.merged_into, d0.id) and d.status='posted'
  cross join lateral (select 1 + count(*) n from public.invoice_docs x where x.merged_into=d.id) np
  cross join (select public.invoice_setting('mode') m) s
  where f.id=p_file and f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'
   and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz
   and f.rename_key is distinct from (d.id::text || ':' || d.version || case when np.n > 1 then ':p' || coalesce(d0.part_no, 1) else '' end)
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0));
$$;

create or replace function public.invoice_rename_waiting_all() returns table(file_id uuid, doc_id uuid, target_key text)
language sql stable security invoker set search_path=public,pg_temp as $$
 select f.id, d.id, d.id::text || ':' || d.version || case when np.n > 1 then ':p' || coalesce(d0.part_no, 1) else '' end
 from public.invoice_files f
 join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.doc_index=0 and d0.status in ('posted','merged')
 -- d: the posted invoice the original belongs to (itself, or the invoice it was merged into as one of its pages, UI案50 5).
 join public.invoice_docs d on d.id=coalesce(d0.merged_into, d0.id) and d.status='posted'
 cross join lateral (select 1 + count(*) n from public.invoice_docs x where x.merged_into=d.id) np
 cross join (select public.invoice_setting('mode') m) s
 where f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'
  and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz
  and f.rename_key is distinct from (d.id::text || ':' || d.version || case when np.n > 1 then ':p' || coalesce(d0.part_no, 1) else '' end)
  and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0);
$$;

create or replace function public.invoice_rename_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id file_id, f.drive_file_id, f.store_id, f.original_name, f.current_name, w.target_key,
   coalesce(d.invoice_date, d.effective_date) invoice_date, coalesce(d.vendor_name, d.vendor_raw) vendor_name, d.doc_type,
   nullif(d.invoice_no, '') invoice_no, d.internal_no, (select count(*) from public.invoice_file_versions v where v.file_id=f.id) version_no,
   -- An invoice of several originals: which page this original is and how many there are (named _p1, _p2, UI案50).
   (select x.part_no from public.invoice_docs x where x.file_id=f.id and x.sha256=f.current_sha256 and x.doc_index=0 and (x.id=d.id or x.merged_into=d.id)) part_no,
   (select 1 + count(*) from public.invoice_docs x where x.merged_into=d.id) parts,
   (select coalesce(jsonb_agg(fo.id), '[]') from public.invoice_folders fo where fo.store_id=f.store_id) store_folder_ids,
   -- A file a person assigned to another store may still sit in a store's 00_Upload; it may be renamed there.
   case when f.store_assigned_by is not null then (select coalesce(jsonb_agg(s2.upload_folder_id), '[]') from public.invoice_stores s2 where s2.upload_folder_id is not null)
        else '[]'::jsonb end upload_folder_ids
  from public.invoice_rename_waiting_all() w
  join public.invoice_files f on f.id=w.file_id
  join public.invoice_docs d on d.id=w.doc_id
  where f.drive_state='ok'
   and (case when nullif(p->>'file_id', '') is not null then f.id=(p->>'file_id')::uuid
        else f.rename_state<>'error' or (f.rename_next_at <= now() and f.rename_attempts < 8) end)
  order by f.updated_at limit coalesce((p->>'limit')::int, 10)) x;
$$;

create or replace function public.invoice_qb_enqueue(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare q jsonb := public.invoice_setting('qb'); f public.invoice_files; o public.invoice_qb_outbox;
begin
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid;
 if f.id is null or f.current_sha256 is null then raise exception 'not_found'; end if;
 if f.source <> 'drive' then return jsonb_build_object('queued', false, 'why', 'not_new_intake'); end if;
 if coalesce(q->>'route','') not in ('invoice-intake','external') then return jsonb_build_object('queued', false, 'why', 'route_not_assigned'); end if;
 if not coalesce(f.drive_created_at >= public.invoice_qb_since_at(), false) then return jsonb_build_object('queued', false, 'why', 'before_since'); end if;
 -- Same readiness as invoice_qb_candidates, checked again at the moment of queuing (Moto 2026-10-12: posted, then renamed).
 -- Every document of the current content is settled and one is posted: possible duplicates, replaced originals and
 -- documents that could not be read are still waiting for a person (review), so they are never queued.
 if f.intake_status <> 'posted'
    or not exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted')
    or exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review') then
  return jsonb_build_object('queued', false, 'why', 'not_ready');
 end if;
 if public.invoice_rename_waiting(f.id) then return jsonb_build_object('queued', false, 'why', 'rename_waiting'); end if;
 -- Several originals make one invoice (UI案50 5・6A): they go to QuickBooks together once the forwarder can send them as one
 -- (Moto 2026-10-14: built now, kept out of the ledger until then). Accounting records a manual entry meanwhile (invoice_qb_manual).
 if exists(select 1 from public.invoice_docs d0 join public.invoice_docs x on x.merged_into=d0.id where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted') then
  return jsonb_build_object('queued', false, 'why', 'multi_file');
 end if;
 insert into public.invoice_qb_outbox(file_id, sha256, to_address, route, attempt_key)
 values(f.id, f.current_sha256, q->>'to', q->>'route', 'qb-' || f.current_sha256 || '-' || md5(q->>'to'))
 on conflict do nothing returning * into o;
 if o.id is null then return jsonb_build_object('queued', false, 'why', 'already'); end if;
 perform public.invoice_event(null, f.id, 'worker', 'qb_queued', jsonb_build_object('to', q->>'to'));
 return jsonb_build_object('queued', true, 'id', o.id);
end $$;

create or replace function public.invoice_qb_candidates(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id)), '[]') from (
  select f.id from public.invoice_files f
  -- Moto 2026-10-12: an original goes to QuickBooks once it is posted (「この内容で反映」 or automatically) and renamed.
  where f.source='drive' and f.current_sha256 is not null and f.intake_status='posted'
   and f.drive_created_at >= (select public.invoice_qb_since_at())
   and not exists(select 1 from public.invoice_qb_outbox o where o.sha256=f.current_sha256 and o.to_address=public.invoice_setting('qb')->>'to' and o.state<>'cancelled')
   and exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted')
   -- Possible duplicates, replaced originals and documents that could not be read wait for a person (review): never forwarded before.
   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review')
   and f.id not in (select w.file_id from public.invoice_rename_waiting_all() w)
   -- An invoice of several originals waits out of the ledger (invoice_qb_enqueue).
   and not exists(select 1 from public.invoice_docs d0 join public.invoice_docs x on x.merged_into=d0.id where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted')
  order by f.ingested_at limit coalesce((p->>'limit')::int, 20)) f;
$$;

create or replace function public.invoice_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; r jsonb; total int; sum_cents bigint;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 with q as (
  select d.id, d.store_id, d.doc_type, d.vendor_key, d.vendor_name, d.vendor_raw, d.invoice_no, d.invoice_date, d.delivery_date, d.total_cents,
   d.status, d.recon_status, d.reasons, d.needs_adjustment, d.posted_mode, d.version, f.drive_file_id, f.current_name, f.organize_status, f.drive_state,
   f.ingested_at, (select state from public.invoice_qb_outbox o where o.file_id=f.id and o.state<>'cancelled' order by created_at desc limit 1) qb_state,
   (select count(*) from public.invoice_docs x where x.merged_into=d.id) parts, d.part_no
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where (jsonb_typeof(p->'stores') is distinct from 'array' or d.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
   and (p->>'vendor' is null or d.vendor_name ilike '%'||(p->>'vendor')||'%' or d.vendor_raw ilike '%'||(p->>'vendor')||'%')
   and (p->>'from' is null or d.invoice_date >= (p->>'from')::date) and (p->>'to' is null or d.invoice_date <= (p->>'to')::date)
   and (p->>'invoice_no' is null or d.invoice_no ilike '%'||(p->>'invoice_no')||'%')
   and (p->>'min_cents' is null or d.total_cents >= (p->>'min_cents')::bigint) and (p->>'max_cents' is null or d.total_cents <= (p->>'max_cents')::bigint)
   and (p->>'item' is null or exists(select 1 from public.invoice_lines l where l.doc_id=d.id and l.raw_name ilike '%'||(p->>'item')||'%'))
   and (d.status <> 'merged' or p->>'status' = 'merged')
   and (p->>'status' is null or d.status=p->>'status') and (p->>'recon' is null or d.recon_status=p->>'recon'))
 select (select count(*) from q), (select coalesce(sum(total_cents),0) from q),
  coalesce((select jsonb_agg(to_jsonb(x) order by x.invoice_date desc nulls first, x.ingested_at desc, x.id) from
   (select * from q order by invoice_date desc nulls first, ingested_at desc, id
    limit least(coalesce((p->>'limit')::int,50),200) offset coalesce((p->>'offset')::int,0)) x), '[]')
 into total, sum_cents, r;
 return jsonb_build_object('rows', r, 'total', total, 'sum_cents', sum_cents);
end $$;

create or replace function public.invoice_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; d public.invoice_docs;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid;
 if d.id is null then raise exception 'not_found'; end if;
 return jsonb_build_object('doc', to_jsonb(d),
  'file', (select to_jsonb(f) - 'lease_owner' - 'lease_until' from public.invoice_files f where f.id=d.file_id),
  'lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no),'[]') from public.invoice_lines l where l.doc_id=d.id),
  'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.invoice_events e where e.doc_id=d.id or (e.file_id=d.file_id and e.doc_id is null)),
  'related', (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'doc_type',x.doc_type,'invoice_no',x.invoice_no,'relation',x.relation,'status',x.status)),'[]')
              from public.invoice_docs x where x.related_doc_id=d.id or x.id=d.related_doc_id or x.duplicate_of=d.id or x.id=d.duplicate_of),
  'qb', (select coalesce(jsonb_agg(to_jsonb(o) - 'reserved_by'),'[]') from public.invoice_qb_outbox o where o.file_id=d.file_id),
  -- Several originals are one invoice (UI案50 5): its other pages, and for a page the invoice it was merged into.
  'parts', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'part_no', x.part_no, 'version', x.version, 'file_id', x.file_id,
     'drive_file_id', f.drive_file_id, 'current_name', f.current_name, 'ingested_at', f.ingested_at, 'pages_marked', x.pages_marked,
     'invoice_no', x.invoice_no, 'total_cents', x.total_cents, 'tax_cents', x.tax_cents, 'shipping_cents', x.shipping_cents, 'lines_sum_cents', x.lines_sum_cents,
     'qb_state', (select o.state from public.invoice_qb_outbox o where o.file_id=f.id and o.state<>'cancelled' order by o.created_at desc limit 1)) order by x.part_no), '[]')
    from public.invoice_docs x join public.invoice_files f on f.id=x.file_id where x.merged_into=d.id),
  'main', (select jsonb_build_object('id', m.id, 'invoice_no', m.invoice_no, 'vendor_name', m.vendor_name, 'status', m.status, 'part_no', m.part_no)
    from public.invoice_docs m where m.id=d.merged_into),
  -- How many documents the original holds (one original with several documents is not merged).
  'file_docs', (select count(distinct x.doc_index) from public.invoice_docs x where x.file_id=d.file_id and x.sha256=d.sha256),
  -- The AI's transcription of this document, shown beside the values in use (never changed).
  'ai_doc', (select e.raw->'documents'->d.doc_index from public.invoice_extractions e
             where e.sha256=d.sha256 and e.prompt_version=d.ai->>'prompt_version' limit 1));
end $$;

create or replace function public.invoice_purchase_month(p_ym text, p_cls jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_start timestamptz; v_since timestamptz := public.invoice_qb_since_at();
 v_closed text := public.invoice_setting('rules')->>'closed_through'; v_cls jsonb := p_cls; v_names jsonb := '{}'; v_res jsonb;
 -- The ledger is kept per content and destination: a send to the QuickBooks address in use counts (as the ledger itself checks).
 v_to text := public.invoice_setting('qb')->>'to';
 v_mirror boolean := coalesce((public.invoice_setting('mode')->>'mirror')::boolean, false);
begin
 if p_ym is null or p_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 begin v_start := (public.invoice_setting('mode')->>'start_at')::timestamptz; exception when others then v_start := null; end;
 if v_cls is null then
  select public.invoice_purchase_classes(coalesce(array_agg(distinct l.ingredient_code), '{}')) into v_cls
  from public.invoice_lines l join public.invoice_docs d on d.id=l.doc_id join public.invoice_files f on f.id=d.file_id
  where l.ingredient_code is not null
   and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = p_ym;
 end if;
 -- Who reconciled or checked: the employee's name when the account is linked to one (manager_auth.emp_id).
 if to_regclass('public.employees') is not null then
  begin
   execute $q$ select coalesce(jsonb_object_agg(a.user_id::text, e.name), '{}'::jsonb) from public.manager_auth a
    join public.employees e on e.id::text = a.emp_id where coalesce(e.name, '') <> '' $q$ into v_names;
  exception when others then v_names := '{}';
  end;
 end if;
 with
 d0 as (
  select d.id, d.internal_no, d.store_id, d.doc_type, d.status, d.vendor_key, coalesce(v.display_name, d.vendor_name, d.vendor_raw) vname,
   d.invoice_no, d.invoice_date, d.delivery_date, d.currency, d.total_cents, d.subtotal_cents, d.discount_cents, d.tax_cents, d.shipping_cents,
   d.other_cents, d.food_kind, d.reasons, d.recon_status, d.recon_by, d.recon_at, d.posted_mode, d.posted_at, d.needs_adjustment,
   d.related_doc_id, d.relation, d.duplicate_of, (select x.invoice_no from public.invoice_docs x where x.id=d.related_doc_id) rno,
   f.drive_file_id, f.current_name, f.source fsource, f.drive_created_at, f.ingested_at, m.state mstate,
   -- 'held' (a closed month or an adjustment met when copying): the copy may or may not be in the app. Look at the app's list.
   case when m.state='held' then exists(select 1 from public.app_state a
     cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e
     where a.key='spl_invoices_' || m.store_id and e->>'id' = m.app_inv_id and coalesce(e->>'_deleted', '') <> 'true') end hcopy,
   (d.invoice_date is null and d.effective_date is null) nodate,
   -- The QuickBooks ledger is kept per original content and address: a send of the same content to the address in use counts,
   -- whatever the file is called now.
   (select o.state from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.to_address=v_to and o.state<>'cancelled'
     order by (o.state='sent') desc, o.updated_at desc, o.id limit 1) qbs,
   (select max(o.sent_at) from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.to_address=v_to and o.state='sent') qbat
  from public.invoice_docs d
  join public.invoice_files f on f.id=d.file_id
  left join public.invoice_app_mirror m on m.doc_id=d.id
  left join public.invoice_vendor_rules v on v.vendor_key=d.vendor_key
  where (d.posting_kind='purchase' or (d.status='review' and d.doc_type='unknown'))
   -- A page merged into another invoice is counted in that invoice (its lines moved there, UI案50 5).
   and d.status <> 'merged'
   and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = p_ym
 ),
 d1 as (
  select d0.*, (d0.doc_type='credit_memo') credit, case when d0.total_cents < 0 then -1 else 1 end f,
   -- Counted here when the app's cost would have it through the copy (invoice_mirror_apply): copied, or due to be copied.
   -- Taken in before the start or while the copies are off (not copied: the store entered it in the app), or its copy deleted
   -- in the app: the app's own entry counts it, so it is held here (never counted twice).
   case when d0.mstate='mirrored' then true when d0.mstate='tombstoned' then false when d0.mstate='error' then true
    when d0.mstate='held' then coalesce(d0.hcopy, false)
    else v_mirror and coalesce(d0.ingested_at >= v_start, false) end link,
   -- Counted through the store's own app entry instead (not in "not in yet"). A held original with no copy is not: whether the
   -- store entered it is not known (copies may have been off, or the month closed before it was copied), so it stays to check.
   (d0.mstate is distinct from 'held') appentry,
   -- Not a ledger target (put in Drive before qb.since, or not a Drive original): no ledger row is expected.
   (v_since is not null and not (d0.fsource='drive' and coalesce(d0.drive_created_at >= v_since, false))) preledger,
   exists(select 1 from jsonb_array_elements(d0.reasons) r where r->>'code'='multi_store') multi,
   exists(select 1 from jsonb_array_elements(d0.reasons) r where r->>'code'='app_duplicate_candidate') appdup
  from d0
 ),
 l0 as (
  select l.doc_id, l.line_no, l.raw_name, l.qty, l.purchase_unit, l.amount_cents, l.ingredient_code, d1.food_kind,
   d1.f * coalesce(l.amount_cents, 0) a,
   case when l.ingredient_code is not null and (v_cls->>l.ingredient_code) in ('food','liquor','beverage','supply') then v_cls->>l.ingredient_code end mcls
  from public.invoice_lines l join d1 on d1.id=l.doc_id
 ),
 w as (
  select d1.id doc_id, case when d1.total_cents is null then null else abs(d1.total_cents) end tp,
   coalesce(sum(greatest(l0.a, 0)), 0) wpos, coalesce(sum(abs(l0.a)), 0) wabs, coalesce(sum(l0.a), 0) asum
  from d1 left join l0 on l0.doc_id=d1.id group by d1.id, d1.total_cents
 ),
 l1 as (
  select l0.*, w.tp, (w.tp - w.asum) rem, case when w.wpos > 0 then w.wpos else w.wabs end wsum,
   case when w.wpos > 0 then greatest(l0.a, 0) else abs(l0.a) end wt
  from l0 join w on w.doc_id=l0.doc_id
 ),
 l2 as (
  select l1.*, case when l1.tp is null or l1.wsum = 0 then 0::numeric
   else div(l1.rem::numeric * l1.wt, l1.wsum) - case when mod(l1.rem::numeric * l1.wt, l1.wsum) < 0 then 1 else 0 end end fl
  from l1
 ),
 l3 as (
  select l2.*, case when l2.tp is null or l2.wsum = 0 then 0::numeric else l2.rem::numeric * l2.wt - l2.fl * l2.wsum end frn,
   sum(l2.fl) over (partition by l2.doc_id) flsum
  from l2
 ),
 l4 as (select l3.*, row_number() over (partition by l3.doc_id order by l3.frn desc, l3.line_no) rn from l3),
 ls as (
  select l4.doc_id, l4.line_no, l4.raw_name, l4.qty, l4.purchase_unit, l4.amount_cents, l4.ingredient_code,
   case when l4.tp is null then null
    else (l4.a + l4.fl + case when l4.wsum > 0 and l4.rn <= l4.rem - l4.flsum then 1 else 0 end)::bigint end share,
   coalesce(l4.mcls, case l4.food_kind when 'food' then 'food' when 'nonfood' then 'nonfood' end, 'unclass') c,
   case when l4.mcls is not null then 'm' when l4.food_kind in ('food','nonfood') then 'v' else 'u' end b
  from l4
 ),
 da as (
  select d1.id, coalesce(sum(ls.share), 0) alloc,
   coalesce(sum(ls.share) filter (where ls.c='food'), 0) s_food, coalesce(sum(ls.share) filter (where ls.c='liquor'), 0) s_liquor,
   coalesce(sum(ls.share) filter (where ls.c='beverage'), 0) s_beverage, coalesce(sum(ls.share) filter (where ls.c='supply'), 0) s_supply,
   coalesce(sum(ls.share) filter (where ls.c='nonfood'), 0) s_nonfood, coalesce(sum(ls.share) filter (where ls.c='unclass'), 0) s_unclass,
   coalesce(sum(ls.share) filter (where ls.b='v' and ls.c='food'), 0) s_vfood, coalesce(sum(ls.share) filter (where ls.b='v' and ls.c='nonfood'), 0) s_vnon
  from d1 left join ls on ls.doc_id=d1.id group by d1.id
 ),
 dd0 as (
  select d1.*, w.tp, case when d1.credit then -1 else d1.f end mul,
   -- What no line carries (no lines, or only zero lines) goes by the vendor's class.
   case when w.tp is null then 0 else w.tp - da.alloc end ua,
   da.s_food, da.s_liquor, da.s_beverage, da.s_supply, da.s_nonfood, da.s_unclass, da.s_vfood, da.s_vnon
  from d1 join w on w.doc_id=d1.id join da on da.id=d1.id
 ),
 dd1 as (
  select dd0.*,
   s_food + case when food_kind='food' then ua else 0 end food_m, s_liquor liquor_m, s_beverage beverage_m, s_supply supply_m,
   s_nonfood + case when food_kind='nonfood' then ua else 0 end nonfood_m,
   s_unclass + case when coalesce(food_kind,'') not in ('food','nonfood') then ua else 0 end unclass_m,
   s_vfood + case when food_kind='food' then ua else 0 end vfood_m, s_vnon + case when food_kind='nonfood' then ua else 0 end vnon_m
  from dd0
 ),
 dd2 as (
  select dd1.*,
   case
    when status in ('rejected','duplicate','superseded') then 'D'
    when not link then 'E'
    when status='review' then 'C'
    when multi or coalesce(currency,'USD')<>'USD' or needs_adjustment or unclass_m<>0 or tp is null then 'E'
    when recon_status<>'reconciled' then 'C'
    when qbs='sent' or preledger then 'A'
    else 'B' end cat
  from dd1
 ),
 dd as (
  select dd2.*, case when tp is null then null else mul * tp end cents,
   mul * (food_m + liquor_m + beverage_m) cost, mul * (supply_m + nonfood_m) non, mul * unclass_m unc,
   mul * vfood_m pc, mul * vnon_m pn,
   case cat
    when 'D' then array[status]
    when 'E' then case when not link then array[case when mstate='tombstoned' then 'deleted_in_app' when mstate='held' then 'held_no_copy'
      when not v_mirror then 'no_copy' else 'before_start' end]
     else array_remove(array[case when multi then 'multi_store' end, case when coalesce(currency,'USD')<>'USD' then 'currency' end,
      case when needs_adjustment then 'closed_adjustment' end, case when unclass_m<>0 then 'no_class' end, case when tp is null then 'no_amount' end], null) end
    when 'C' then case when status='review' then array_remove(array['review', case when doc_type='unknown' then 'unreadable' end,
      case when nodate then 'no_date' end, case when tp is null then 'no_amount' end], null) else array[recon_status] end
    when 'B' then array['qb_' || coalesce(qbs, 'none')]
    else case when qbs is distinct from 'sent' then array['pre_ledger'] else array[]::text[] end end why
  from dd2
 ),
 sto as (
  select s.store_id from public.invoice_stores s where s.active
  union select dd.store_id from dd
  union select c.store_id from public.invoice_purchase_checks c where c.ym=p_ym
 ),
 ck as (
  select distinct on (c.store_id, c.vendor_key) c.* from public.invoice_purchase_checks c where c.ym=p_ym
  order by c.store_id, c.vendor_key, c.id desc
 ),
 vd as (
  select dd.store_id, coalesce(dd.vendor_key, '?' || lower(coalesce(dd.vname, ''))) gk, max(dd.vendor_key) vk, max(dd.vname) vn,
   count(*) filter (where cat='A') a_n, coalesce(sum(cents) filter (where cat='A'), 0) a_c, coalesce(sum(cost) filter (where cat='A'), 0) a_cost,
   coalesce(sum(non) filter (where cat='A'), 0) a_non, coalesce(sum(pc + pn) filter (where cat='A'), 0) a_prov,
   coalesce(sum(mul * food_m) filter (where cat='A'), 0) a_food, coalesce(sum(mul * liquor_m) filter (where cat='A'), 0) a_liquor,
   coalesce(sum(mul * beverage_m) filter (where cat='A'), 0) a_beverage, coalesce(sum(mul * supply_m) filter (where cat='A'), 0) a_supply,
   coalesce(sum(mul * nonfood_m) filter (where cat='A'), 0) a_nonfood,
   count(*) filter (where cat='A' and credit) cr_n, coalesce(sum(cents) filter (where cat='A' and credit), 0) cr_c,
   -- not in yet: B, C and E, except what the app's own entry counts (E without a copy)
   count(*) filter (where cat in ('B','C') or (cat='E' and not (not link and appentry))) p_n,
   coalesce(sum(cents) filter (where (cat in ('B','C') or (cat='E' and not (not link and appentry))) and cents is not null), 0) p_c,
   count(*) filter (where (cat in ('B','C') or (cat='E' and not (not link and appentry))) and cents is null) p_u, count(*) filter (where cat='D') d_n
  from dd group by 1, 2
 ),
 vj as (
  select vd.store_id, vd.a_c ord, vd.vn, jsonb_build_object('k', vd.vk, 'n', vd.vn,
    'a', jsonb_build_object('n', a_n, 'c', a_c, 'cost', a_cost, 'non', a_non, 'prov', a_prov,
     'cls', jsonb_build_object('food', a_food, 'liquor', a_liquor, 'beverage', a_beverage, 'supply', a_supply, 'nonfood', a_nonfood)),
    'cr', jsonb_build_object('n', cr_n, 'c', cr_c), 'p', jsonb_build_object('n', p_n, 'c', p_c, 'u', p_u), 'dn', d_n,
    'chk', (select jsonb_build_object('s', ck.state, 'at', ck.checked_at, 'by', v_names->>ck.checked_by, 'note', ck.note, 'sc', ck.statement_cents,
       'after', (select count(*) from dd x where x.store_id=vd.store_id and x.vendor_key=vd.vk and x.cat<>'D' and x.ingested_at > ck.checked_at))
      from ck where ck.store_id=vd.store_id and ck.vendor_key=vd.vk and ck.state<>'none')) j
  from vd
  union all
  select ck.store_id, 0, coalesce(v.display_name, ck.vendor_key), jsonb_build_object('k', ck.vendor_key, 'n', coalesce(v.display_name, ck.vendor_key),
    'chk', jsonb_build_object('s', ck.state, 'at', ck.checked_at, 'by', v_names->>ck.checked_by, 'note', ck.note, 'sc', ck.statement_cents, 'after', 0))
  from ck left join public.invoice_vendor_rules v on v.vendor_key=ck.vendor_key
  where ck.state<>'none' and not exists(select 1 from vd where vd.store_id=ck.store_id and vd.vk=ck.vendor_key)
 ),
 dj as (
  select dd.store_id, dd.id, dd.invoice_date, jsonb_build_object('id', dd.id, 'in', internal_no, 'no', invoice_no, 'vk', vendor_key, 'vn', vname,
    't', case when credit then 'c' when doc_type='unknown' then 'u' else 'i' end, 'd', invoice_date, 'dl', delivery_date,
    'cat', cat, 'why', to_jsonb(why), 'c', cents, 'cost', cost, 'non', non, 'unc', unc, 'pc', pc, 'pn', pn,
    'cls', jsonb_build_object('food', mul * food_m, 'liquor', mul * liquor_m, 'beverage', mul * beverage_m, 'supply', mul * supply_m, 'nonfood', mul * nonfood_m),
    'st', status, 'rc', recon_status, 'rat', recon_at, 'rby', v_names->>recon_by, 'qb', qbs, 'qat', qbat, 'pm', posted_mode, 'pat', posted_at,
    'rel', relation, 'rid', related_doc_id, 'rno', rno, 'dup', duplicate_of, 'ad', appdup, 'fn', current_name, 'fid', drive_file_id, 'iat', ingested_at) j
  from dd
 ),
 tj as (
  select g.store_id, g.cat, jsonb_build_object('n', count(*), 'c', coalesce(sum(g.cents) filter (where g.cents is not null), 0),
    'u', count(*) filter (where g.cents is null), 'cost', coalesce(sum(g.cost), 0), 'non', coalesce(sum(g.non), 0), 'unc', coalesce(sum(g.unc), 0),
    'pc', coalesce(sum(g.pc), 0), 'pn', coalesce(sum(g.pn), 0),
    'by', (select coalesce(jsonb_object_agg(z.k, jsonb_build_object('n', z.n, 'c', z.c, 'u', z.u)), '{}'::jsonb) from (
      select coalesce(y.why[1], '-') k, count(*) n, coalesce(sum(y.cents) filter (where y.cents is not null), 0) c, count(*) filter (where y.cents is null) u
      from dd y where y.store_id=g.store_id and y.cat=g.cat group by 1) z)) j
  from dd g group by g.store_id, g.cat
 ),
 lg as (
  select ls.doc_id, jsonb_agg(jsonb_build_array(ls.line_no, ls.raw_name, trim_scale(ls.qty), ls.purchase_unit, ls.amount_cents,
    case when ls.share is null then null else dd.mul * ls.share end, ls.c, ls.b, ls.ingredient_code) order by ls.line_no) l
  from ls join dd on dd.id=ls.doc_id group by ls.doc_id
 ),
 lj as (
  select dd.store_id, dd.id, jsonb_build_object(
    'h', jsonb_build_object('sub', subtotal_cents, 'disc', discount_cents, 'tax', tax_cents, 'ship', shipping_cents, 'oth', other_cents, 'tot', total_cents),
    'u', case when tp is null or ua = 0 then null else mul * ua end,
    'uc', case when food_kind in ('food','nonfood') then food_kind else 'unclass' end,
    'l', coalesce(lg.l, '[]'::jsonb)) j
  from dd left join lg on lg.doc_id=dd.id
 )
 select jsonb_build_object(
  'summary', jsonb_build_object('v', 1, 'ym', p_ym, 'closed', v_closed is not null and p_ym <= v_closed,
   'start_at', v_start, 'qb_since', v_since,
   'stores', coalesce((select jsonb_object_agg(s.store_id, jsonb_build_object(
     'tot', coalesce((select jsonb_object_agg(tj.cat, tj.j) from tj where tj.store_id=s.store_id), '{}'::jsonb),
     'cls', (select jsonb_build_object('food', coalesce(sum(mul * food_m), 0), 'liquor', coalesce(sum(mul * liquor_m), 0), 'beverage', coalesce(sum(mul * beverage_m), 0),
        'supply', coalesce(sum(mul * supply_m), 0), 'nonfood', coalesce(sum(mul * nonfood_m), 0)) from dd where dd.store_id=s.store_id and dd.cat='A'),
     'cr', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents), 0)) from dd where dd.store_id=s.store_id and dd.cat='A' and dd.credit),
     'pre', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents), 0)) from dd where dd.store_id=s.store_id and dd.cat='A' and 'pre_ledger' = any(dd.why)),
     'ad', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents) filter (where cents is not null), 0)) from dd where dd.store_id=s.store_id and dd.cat in ('A','B','C') and dd.appdup),
     -- held because the app's own entry counts them (taken in before the start, no copy, copy deleted): not "not in yet"
     'ap', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents) filter (where cents is not null), 0), 'u', count(*) filter (where cents is null))
        from dd where dd.store_id=s.store_id and dd.cat='E' and not dd.link and dd.appentry),
     'last', (select jsonb_build_object('a', max(invoice_date) filter (where cat='A'), 'in', max(ingested_at)) from dd where dd.store_id=s.store_id),
     'vendors', coalesce((select jsonb_agg(vj.j order by vj.ord desc, vj.vn) from vj where vj.store_id=s.store_id), '[]'::jsonb),
     'docs', coalesce((select jsonb_agg(dj.j order by dj.invoice_date desc nulls first, dj.id) from dj where dj.store_id=s.store_id), '[]'::jsonb)))
    from sto s), '{}'::jsonb)),
  'lines', coalesce((select jsonb_object_agg(q.store_id, q.j) from (
    select lj.store_id, jsonb_object_agg(lj.id::text, lj.j) j from lj group by lj.store_id) q), '{}'::jsonb))
 into v_res;
 return v_res;
end $$;

create or replace function public.invoice_reassign(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; f public.invoice_files;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if length(coalesce(p->>'reason','')) = 0 then raise exception 'reason_required'; end if;
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid for update;
 if f.id is null or not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 if exists(select 1 from public.invoice_docs where file_id=f.id and status='posted') then raise exception 'posted_use_correction'; end if;
 -- A page merged into an invoice, or an invoice made of several originals: take the merge back first (UI案50 5).
 if exists(select 1 from public.invoice_docs d where d.file_id=f.id and (d.status='merged' or exists(select 1 from public.invoice_docs c where c.merged_into=d.id))) then
  raise exception 'has_parts'; end if;
 update public.invoice_docs set status='rejected', version=version+1, updated_at=now() where file_id=f.id and status in ('review','duplicate');
 update public.invoice_files set store_id=p->>'store_id', store_assigned_by=actor::text, drive_state=case when drive_state='moved_store' then 'ok' else drive_state end,
  intake_status='pending', attempts=0, next_attempt_at=null, organize_status='none', organize_target=null, updated_at=now() where id=f.id;
 perform public.invoice_event(null, f.id, actor::text, 'reassigned', jsonb_build_object('from', f.store_id, 'to', p->>'store_id', 'reason', p->>'reason'));
 return jsonb_build_object('ok', true);
end $$;

-- Several originals are one invoice (Moto 2026-10-14「同じinvoice#で続いてるパターンもあるので、重複か複数枚で１つのinvoiceか選択して
-- 処理できる様に」・UI案50 5・7A・8A). Accounting picks the pages of one invoice number in page order. The main invoice keeps its id
-- (a posted one keeps its posting, now corrected); every line of the other pages moves to it, in page order, and those pages wait
-- as 'merged' (their originals stay in Drive). The reasons, the totals and the products are worked out again for the whole invoice
-- by the caller from the current values (header, lines, reasons). Pages marked as duplicates in the same step are set aside (Drive
-- is never touched). A merge of an invoice still waiting for review can be taken back (invoice_unmerge).
create or replace function public.invoice_merge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; m public.invoice_docs; x public.invoice_docs; l public.invoice_lines; e jsonb; h jsonb := p->'header';
 ids uuid[]; files uuid[]; dups uuid[] := '{}'; mx int; k int := 0; nq int := 0; base jsonb; closed text; blocking text;
 must_fix text[] := array['duplicate_certain','total_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 may_ack text[] := array['total_mismatch','original_replaced','line_amount_missing','line_value_missing'];
 ack text[] := coalesce(array(select jsonb_array_elements_text(p->'ack')), '{}');
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(p->'parts') is distinct from 'array' or jsonb_array_length(p->'parts') not between 1 and 9
    or jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_typeof(h) is distinct from 'object' or jsonb_typeof(p->'reasons') is distinct from 'array' then
  raise exception 'bad_merge'; end if;
 -- Every document of the merge is locked first, in one order (two people merging the same pages in another order wait, never deadlock).
 perform 1 from public.invoice_docs where id in (select (p->>'doc_id')::uuid
   union select (e2->>'id')::uuid from jsonb_array_elements(p->'parts') e2
   union select (e2->>'id')::uuid from jsonb_array_elements(coalesce(p->'duplicates','[]')) e2) order by id for update;
 select * into m from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if m.id is null then raise exception 'not_found'; end if;
 if m.version is distinct from (p->>'version')::int then raise exception 'conflict'; end if;
 if m.status not in ('review','posted') then raise exception 'invalid_state'; end if;
 -- One document per original, read from what the original holds now (a file with several documents is never merged; the
 -- reading set aside when a person chose another store is not another document).
 if m.doc_index > 0 or exists(select 1 from public.invoice_docs o where o.file_id=m.file_id and o.sha256=m.sha256 and o.doc_index > 0)
    or not exists(select 1 from public.invoice_files f where f.id=m.file_id and f.current_sha256=m.sha256) then raise exception 'bad_merge'; end if;
 -- Files already in the invoice (its pages merged before): a new reading of one of them is not another page of it.
 ids := array[m.id]; files := array[m.file_id] || array(select c.file_id from public.invoice_docs c where c.merged_into=m.id order by c.part_no);
 for e in select * from jsonb_array_elements(p->'parts') loop
  select * into x from public.invoice_docs where id=(e->>'id')::uuid for update;
  if x.id is null then raise exception 'not_found'; end if;
  if x.version is distinct from (e->>'version')::int then raise exception 'conflict'; end if;
  if x.status <> 'review' or exists(select 1 from public.invoice_docs c where c.merged_into=x.id) then raise exception 'invalid_state'; end if;
  if x.id = any(ids) or x.file_id = any(files) or (e->>'part_no')::int is null then raise exception 'bad_merge'; end if;
  -- The same store, vendor, invoice number, kind of document and currency (a page whose vendor, number, kind or currency could
  -- not be read may join; a statement or a credit memo never joins an invoice).
  if x.store_id <> m.store_id or x.vendor_key <> coalesce(h->>'vendor_key', m.vendor_key) or x.invoice_no_norm <> coalesce(h->>'invoice_no_norm', m.invoice_no_norm)
     or (x.doc_type <> coalesce(h->>'doc_type', m.doc_type) and 'unknown' <> all(array[x.doc_type, coalesce(h->>'doc_type', m.doc_type)]))
     or x.currency <> coalesce(h->>'currency', m.currency) then
   raise exception 'bad_merge'; end if;
  if x.doc_index > 0 or exists(select 1 from public.invoice_docs o where o.file_id=x.file_id and o.sha256=x.sha256 and o.doc_index > 0)
     or not exists(select 1 from public.invoice_files f where f.id=x.file_id and f.current_sha256=x.sha256) then raise exception 'bad_merge'; end if;
  ids := ids || x.id; files := files || x.file_id;
 end loop;
 for e in select * from jsonb_array_elements(coalesce(p->'duplicates','[]')) loop
  select * into x from public.invoice_docs where id=(e->>'id')::uuid for update;
  if x.id is null then raise exception 'not_found'; end if;
  if x.version is distinct from (e->>'version')::int then raise exception 'conflict'; end if;
  if x.status <> 'review' or x.id = any(ids) or x.id = any(dups) or exists(select 1 from public.invoice_docs c where c.merged_into=x.id) then raise exception 'invalid_state'; end if;
  dups := dups || x.id;
 end loop;
 closed := public.invoice_setting('rules')->>'closed_through';
 if m.status='posted' then
  -- A page added to a posted invoice is a correction of it (UI案50 8A): it passes what posting passes, and the invoice stays itself.
  if h->>'vendor_key' is distinct from m.vendor_key or h->>'invoice_no_norm' is distinct from m.invoice_no_norm or h->>'doc_type' is distinct from m.doc_type
     or (h->>'invoice_date')::date is distinct from m.invoice_date then raise exception 'bad_merge'; end if;
  select r->>'code' into blocking from jsonb_array_elements(p->'reasons') r where r->>'code' = any(must_fix) limit 1;
  if blocking is not null then raise exception 'blocked:%', blocking; end if;
  select r->>'code' into blocking from jsonb_array_elements(p->'reasons') r where r->>'code' = any(may_ack) and not (r->>'code' = any(ack)) limit 1;
  if blocking is not null then raise exception 'blocked:%', blocking; end if;
  if closed is not null and to_char(m.invoice_date,'YYYY-MM') <= closed and not coalesce((p->>'adjustment_ack')::boolean,false) then raise exception 'closed_month'; end if;
  -- QuickBooks (6A・「台帳に出さずに作る」): an invoice of several originals waits out of the ledger. A send of the posted invoice
  -- that is under way or whose outcome is unknown is settled first (取込状況); one still waiting is taken back below.
  perform 1 from public.invoice_qb_outbox where file_id=m.file_id for update;
  if exists(select 1 from public.invoice_qb_outbox where file_id=m.file_id and state in ('sending','unknown')) then raise exception 'qb_in_progress'; end if;
 end if;
 select coalesce(max(line_no), 0) into mx from public.invoice_lines where doc_id=m.id;
 -- What the invoice was before its first merge, while it waits for review: what invoice_unmerge puts back.
 base := m.merge_base;
 if m.status='review' and base is null then
  base := jsonb_build_object('doc', to_jsonb(m) - 'merge_base' - 'ai', 'moved', '[]'::jsonb,
   'own', (select coalesce(jsonb_agg(to_jsonb(o) order by o.line_no), '[]'::jsonb) from public.invoice_lines o where o.doc_id=m.id));
 end if;
 -- Every line of the invoice, in order: its own lines (their reasons worked out again), then each page's lines, moved to it.
 for e in select * from jsonb_array_elements(p->'lines') loop
  select * into l from public.invoice_lines where id=(e->>'line_id')::uuid for update;
  if l.id is null or not (l.doc_id = any(ids)) then raise exception 'line_not_found'; end if;
  if l.doc_id <> m.id then
   k := k + 1;
   if m.status='review' then base := jsonb_set(base, '{moved}', (base->'moved') || jsonb_build_array(to_jsonb(l))); end if;
   update public.invoice_lines y set doc_id=m.id, line_no=mx+k, page=coalesce((e->>'page')::int, y.page),
    map_id=(e->>'map_id')::uuid, ingredient_code=e->>'ingredient_code', count_unit=e->>'count_unit', count_per_purchase=(e->>'count_per_purchase')::numeric,
    base_unit=e->>'base_unit', base_per_purchase=(e->>'base_per_purchase')::numeric, price_per_purchase=(e->>'price_per_purchase')::numeric,
    price_per_count=(e->>'price_per_count')::numeric, price_per_base=(e->>'price_per_base')::numeric, prev_price=e->'prev_price'
   where y.id=l.id;
  end if;
  update public.invoice_lines y set reasons=coalesce(e->'reasons', y.reasons) where y.id=l.id;
 end loop;
 -- No line of a page is left behind (the caller sent every line).
 if exists(select 1 from public.invoice_lines o where o.doc_id = any(ids) and o.doc_id <> m.id) then raise exception 'bad_merge'; end if;
 update public.invoice_docs y set vendor_key=h->>'vendor_key', vendor_name=h->>'vendor_name', food_kind=h->>'food_kind',
  invoice_no=h->>'invoice_no', invoice_no_norm=h->>'invoice_no_norm', invoice_date=(h->>'invoice_date')::date, delivery_date=(h->>'delivery_date')::date,
  due_date=(h->>'due_date')::date, posting_date=(h->>'posting_date')::date, effective_date=(h->>'effective_date')::date, effective_basis=h->>'effective_basis',
  currency=h->>'currency', doc_type=coalesce(h->>'doc_type', y.doc_type), posting_kind=coalesce(h->>'posting_kind', y.posting_kind),
  subtotal_cents=(h->>'subtotal_cents')::bigint, discount_cents=(h->>'discount_cents')::bigint, tax_cents=(h->>'tax_cents')::bigint,
  shipping_cents=(h->>'shipping_cents')::bigint, other_cents=(h->>'other_cents')::bigint, total_cents=(h->>'total_cents')::bigint,
  lines_sum_cents=(h->>'lines_sum_cents')::bigint, other_charges=coalesce(h->'other_charges', '[]'::jsonb),
  pages=coalesce(array(select (jsonb_array_elements_text(h->'pages'))::int), '{}'), pages_marked=coalesce(array(select jsonb_array_elements_text(h->'pages_marked')), '{}'),
  content_sig=h->>'content_sig', reasons=p->'reasons', auto_eligible=false, part_no=coalesce(y.part_no, (p->>'part_no')::int, 1), merge_base=base,
  recon_status=case when y.status='posted' then 'unreconciled' else y.recon_status end,
  needs_adjustment=y.needs_adjustment or (y.status='posted' and closed is not null and to_char(y.invoice_date,'YYYY-MM') <= closed),
  version=y.version+1, updated_at=now()
 where y.id=m.id;
 for e in select * from jsonb_array_elements(p->'parts') loop
  update public.invoice_docs set status='merged', merged_into=m.id, part_no=(e->>'part_no')::int, version=version+1, updated_at=now() where id=(e->>'id')::uuid;
  perform public.invoice_event(x2.id, x2.file_id, actor::text, 'merged_into', jsonb_build_object('into', m.id, 'part_no', x2.part_no, 'reason', p->>'reason'))
  from public.invoice_docs x2 where x2.id=(e->>'id')::uuid;
 end loop;
 -- One place per page.
 if (select count(*) from public.invoice_docs where id=m.id or merged_into=m.id) <> (select count(distinct part_no) from public.invoice_docs where id=m.id or merged_into=m.id) then
  raise exception 'bad_merge'; end if;
 update public.invoice_docs set status='duplicate', duplicate_of=m.id, version=version+1, updated_at=now() where id = any(dups);
 perform public.invoice_event(x2.id, x2.file_id, actor::text, 'marked_duplicate', jsonb_build_object('reason', p->>'reason', 'duplicate_of', m.id))
 from public.invoice_docs x2 where x2.id = any(dups);
 if m.status='posted' then
  -- Price history is rebuilt from the whole invoice, the reconciliation starts again and the app's copy is written again.
  update public.invoice_price_history set status='voided', voided_by=actor::text, voided_at=now(), void_reason=coalesce(nullif(p->>'reason',''), 'merged')
  where doc_id=m.id and status='active';
  perform public.invoice_price_insert(m.id, l2.id, actor::text, p->>'reason') from public.invoice_lines l2 where l2.doc_id=m.id;
  update public.invoice_files set organize_target='unreconciled', organize_status='pending', organize_attempts=0, organize_next_at=null
  where id = any(files) and organize_target='reconciled';
  update public.invoice_files set organize_target='unreconciled' where id = any(files) and organize_target is null;
  update public.invoice_app_mirror set state='held', error='edited_after_post', updated_at=now() where doc_id=m.id and state='mirrored';
  -- The posted invoice's own row that waits to be sent alone is taken back (it goes with its pages, or by hand: invoice_qb_manual).
  with c as (update public.invoice_qb_outbox set state='cancelled', next_at=null, last_error='multi_file', updated_at=now()
             where file_id=m.file_id and state in ('pending','error') returning id)
  select count(*) into nq from c;
  if nq > 0 then perform public.invoice_event(m.id, m.file_id, actor::text, 'qb_cancelled', jsonb_build_object('rows', nq, 'why', 'multi_file')); end if;
 end if;
 perform public.invoice_file_settle(jsonb_build_object('file_id', fid)) from unnest(files || array(select x3.file_id from public.invoice_docs x3 where x3.id = any(dups))) fid;
 perform public.invoice_event(m.id, m.file_id, actor::text, 'merged', jsonb_build_object('parts', to_jsonb(ids[2:]), 'duplicates', to_jsonb(dups),
  'reason', p->>'reason', 'posted', m.status='posted', 'ack', p->'ack'));
 return jsonb_build_object('ok', true, 'version', m.version + 1, 'file_ids', to_jsonb(files), 'posted', m.status='posted');
end $$;

-- Takes a merge back while the invoice waits for review: the invoice is as it was before its first merge (values corrected since
-- then are gone too), each page gets its own lines back and waits for review again.
create or replace function public.invoice_unmerge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; m public.invoice_docs; b jsonb; l jsonb; files uuid[];
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 select * into m from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if m.id is null then raise exception 'not_found'; end if;
 if m.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if m.status <> 'review' or m.merge_base is null then raise exception 'invalid_state'; end if;
 perform 1 from public.invoice_docs where merged_into=m.id for update;
 b := m.merge_base;
 for l in select * from jsonb_array_elements(b->'moved') loop
  update public.invoice_lines y set (doc_id, line_no, page, qty, purchase_unit, spec_key, unit_price, line_discount_cents, amount_cents, map_id, ingredient_code,
    count_unit, count_per_purchase, base_unit, base_per_purchase, price_per_purchase, price_per_count, price_per_base, prev_price, reasons, overrides)
   = (select r.doc_id, r.line_no, r.page, r.qty, r.purchase_unit, r.spec_key, r.unit_price, r.line_discount_cents, r.amount_cents, r.map_id, r.ingredient_code,
      r.count_unit, r.count_per_purchase, r.base_unit, r.base_per_purchase, r.price_per_purchase, r.price_per_count, r.price_per_base, r.prev_price, r.reasons, r.overrides
      from jsonb_populate_record(null::public.invoice_lines, l) r)
  where y.id=(l->>'id')::uuid and y.doc_id=m.id;
 end loop;
 for l in select * from jsonb_array_elements(b->'own') loop
  update public.invoice_lines y set (page, qty, purchase_unit, spec_key, unit_price, line_discount_cents, amount_cents, map_id, ingredient_code,
    count_unit, count_per_purchase, base_unit, base_per_purchase, price_per_purchase, price_per_count, price_per_base, prev_price, reasons, overrides)
   = (select r.page, r.qty, r.purchase_unit, r.spec_key, r.unit_price, r.line_discount_cents, r.amount_cents, r.map_id, r.ingredient_code,
      r.count_unit, r.count_per_purchase, r.base_unit, r.base_per_purchase, r.price_per_purchase, r.price_per_count, r.price_per_base, r.prev_price, r.reasons, r.overrides
      from jsonb_populate_record(null::public.invoice_lines, l) r)
  where y.id=(l->>'id')::uuid and y.doc_id=m.id;
 end loop;
 -- Only the invoice's own lines are left on it.
 if (select count(*) from public.invoice_lines where doc_id=m.id) <> jsonb_array_length(b->'own') then raise exception 'bad_merge'; end if;
 update public.invoice_docs y set (vendor_key, vendor_name, food_kind, invoice_no, invoice_no_norm, invoice_date, delivery_date, due_date, posting_date,
   effective_date, effective_basis, currency, doc_type, posting_kind, subtotal_cents, discount_cents, tax_cents, shipping_cents, other_cents, total_cents,
   lines_sum_cents, other_charges, pages, pages_marked, content_sig, reasons, overrides)
  = (select r.vendor_key, r.vendor_name, r.food_kind, r.invoice_no, r.invoice_no_norm, r.invoice_date, r.delivery_date, r.due_date, r.posting_date,
     r.effective_date, r.effective_basis, r.currency, r.doc_type, r.posting_kind, r.subtotal_cents, r.discount_cents, r.tax_cents, r.shipping_cents, r.other_cents, r.total_cents,
     r.lines_sum_cents, r.other_charges, r.pages, r.pages_marked, r.content_sig, r.reasons, r.overrides
     from jsonb_populate_record(null::public.invoice_docs, b->'doc') r)
 where y.id=m.id;
 update public.invoice_docs set auto_eligible=false, part_no=null, merge_base=null, version=version+1, updated_at=now() where id=m.id;
 select array_agg(file_id order by part_no) into files from public.invoice_docs where merged_into=m.id;
 perform public.invoice_event(x.id, x.file_id, actor::text, 'unmerged_from', jsonb_build_object('from', m.id, 'reason', p->>'reason'))
 from public.invoice_docs x where x.merged_into=m.id;
 update public.invoice_docs set status='review', merged_into=null, part_no=null, version=version+1, updated_at=now() where merged_into=m.id;
 perform public.invoice_file_settle(jsonb_build_object('file_id', fid)) from unnest(array[m.file_id] || coalesce(files, '{}')) fid;
 perform public.invoice_event(m.id, m.file_id, actor::text, 'unmerged', jsonb_build_object('reason', p->>'reason', 'files', to_jsonb(files)));
 return jsonb_build_object('ok', true, 'version', m.version + 1, 'file_ids', to_jsonb(array[m.file_id] || coalesce(files, '{}')));
end $$;

-- An invoice of several originals waits out of the QuickBooks ledger until the forwarder can send them as one (Moto 2026-10-14).
-- Meanwhile accounting enters it in QuickBooks by hand and records that here: each original's ledger row is written as sent (route
-- 'manual'), so it counts as in QuickBooks and is never sent again.
create or replace function public.invoice_qb_manual(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; m public.invoice_docs; q jsonb := public.invoice_setting('qb'); n int := 0; fr record;
 o public.invoice_qb_outbox; key text; res jsonb;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 select * into m from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if m.id is null then raise exception 'not_found'; end if;
 if m.version is distinct from (p->>'version')::int then raise exception 'conflict'; end if;
 if m.status <> 'posted' or not exists(select 1 from public.invoice_docs c where c.merged_into=m.id) then raise exception 'invalid_state'; end if;
 if coalesce(q->>'to', '') = '' then raise exception 'route_not_assigned'; end if;
 res := jsonb_build_object('manual', true, 'by', actor, 'note', nullif(left(coalesce(p->>'note', ''), 300), ''));
 perform 1 from public.invoice_qb_outbox ob where ob.file_id in (select x.file_id from public.invoice_docs x where x.id=m.id or x.merged_into=m.id) for update;
 -- Each page as it is in the invoice (its content when it was read), whatever its original holds now. A row that waits (or was
 -- taken back when the page was added) becomes the manual entry; a send under way or with an unknown outcome is settled first.
 for fr in select x.file_id, x.sha256 from public.invoice_docs x where x.id=m.id or x.merged_into=m.id order by coalesce(x.part_no, 0) loop
  key := 'qb-' || fr.sha256 || '-' || md5(q->>'to');
  select * into o from public.invoice_qb_outbox where attempt_key=key;
  if o.id is null then
   insert into public.invoice_qb_outbox(file_id, sha256, to_address, route, state, attempt_key, sent_at, result)
   values(fr.file_id, fr.sha256, q->>'to', 'manual', 'sent', key, now(), res);
   n := n + 1;
  elsif o.state in ('sending','unknown') then raise exception 'qb_in_progress';
  elsif o.state <> 'sent' then
   update public.invoice_qb_outbox set state='sent', route='manual', sent_at=now(), next_at=null, last_error=null, result=res, updated_at=now() where id=o.id;
   n := n + 1;
  end if;
 end loop;
 perform public.invoice_event(m.id, m.file_id, actor::text, 'qb_manual', jsonb_build_object('added', n, 'note', nullif(left(coalesce(p->>'note', ''), 300), '')));
 return jsonb_build_object('ok', true, 'added', n);
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_merge(jsonb)','invoice_unmerge(jsonb)','invoice_qb_manual(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;

-- 業者の統合（Moto 2026-10-15「アプリでインボイスを取り込んでいた時や今も複数の業者名（同じ業者なのに読み取りで若干違う）この複数いる
-- 同じ業者を統合したいです」・UI案51 決めてほしいこと 1〜7 はすべて A）。同じ業者の名前を 1 つにまとめる：アプリ（業者マスター・請求書・
-- 商品・発注・小切手・食材の原価）と Invoice取込を一度に（1A）。このファイルは Invoice取込の分。
--
-- Changes (the worker and the screen do the rest):
--   invoice_vendor_rules   : merged_into / merged_at / merged_by (a vendor merged into another one; its names go with it)
--   invoice_vendor_merges  : one row per merge: what was moved, to take it back exactly (service role only)
--   invoice_vendor_final   : the vendor a key ends at (following merges)
--   invoice_vendor_usage   : per vendor, how many invoices; printed names no vendor has yet; the merges in force (for the screen)
--   invoice_vendor_merge   : merges vendors by their names. The kept vendor takes the others' names (a later invoice with any of them
--                            is that vendor) and, in months not closed, their invoices, statement checks, product mappings and price
--                            history (3A). Closed months stay as they are (posted with the same number under the kept vendor: left
--                            where it is, and listed). Nothing is renamed in Drive and nothing is sent again to QuickBooks
--                            (the invoices keep their version). preview: nothing is changed, what would change is returned.
--   invoice_vendor_unmerge : takes a merge back (the latest one of its vendor first)
--   invoice_vendor_save    : a merged vendor is not edited any more (its names live in the kept vendor)
--   invoice_purchase_check : a statement check given for a merged vendor is kept for the vendor it ended at
--   invoice_vendor_seed, invoice_map_seed : a card whose name a vendor already has is not added again; seeds go to vendors not merged
-- Replaced functions keep their names and arguments, so their grants (service_role only) stay. The new ones are for the service
-- role only. No invoice, line, setting or Drive file is changed by running this file. Running it twice changes nothing.

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_docs' and column_name='merged_into')
  or to_regprocedure('public.invoice_merge(jsonb)') is null then
  raise exception '先に 20261021090000_invoice_multi_file.sql（段階 3）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

alter table public.invoice_vendor_rules add column if not exists merged_into text references public.invoice_vendor_rules(vendor_key);
alter table public.invoice_vendor_rules add column if not exists merged_at timestamptz;
alter table public.invoice_vendor_rules add column if not exists merged_by text;

create table if not exists public.invoice_vendor_merges(
 id uuid primary key default gen_random_uuid(),
 to_key text not null references public.invoice_vendor_rules(vendor_key),
 from_keys text[] not null default '{}',
 names text[] not null default '{}',
 group_id text,                         -- the app's record of the same merge
 before jsonb not null default '{}',    -- the kept vendor before (display_name, food_kind) and what the merge set (name, kind)
 added_aliases text[] not null default '{}',
 moved jsonb not null default '{}',     -- {docs:[{id,k,n}], maps:[{id,k}], prices:[{id,k}], checks:[{id,k}]}: where each one was
 kept jsonb not null default '[]',      -- posted invoices left with their vendor (the kept vendor has one with the same number)
 merged_by text not null,
 merged_at timestamptz not null default now(),
 undone_by text,
 undone_at timestamptz
);
create index if not exists invoice_vendor_merges_to on public.invoice_vendor_merges(to_key, merged_at desc);

do $$ begin
 alter table public.invoice_vendor_merges enable row level security;
 revoke all on public.invoice_vendor_merges from public, anon, authenticated;
 grant select, insert, update on public.invoice_vendor_merges to service_role;
end $$;

create or replace function public.invoice_vendor_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor'; cur public.invoice_vendor_rules;
 k text; known text[] := array['vendor_key','display_name','aliases','food_kind','auto_post','expect_updated_at'];
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(v->>'vendor_key','') !~ '^[A-Za-z0-9_.:@-]{1,80}$' then raise exception 'bad_value'; end if;
 if v ? 'display_name' and length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
 for k in select jsonb_object_keys(v) loop if not (k = any(known)) then raise exception 'bad_value'; end if; end loop;
 -- One writer at a time with the alias learning in invoice_edit (no name is taught twice or lost between a read and a write).
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into cur from public.invoice_vendor_rules where vendor_key=v->>'vendor_key' for update;
 -- A vendor merged into another one (業者の統合, Moto 2026-10-15) is not edited: its names live in the kept vendor now.
 if cur.merged_into is not null then raise exception 'merged'; end if;
 -- A screen sends the time it read the vendor; if someone saved it since (or a name was learned), nothing is overwritten.
 if v ? 'expect_updated_at' and (cur.vendor_key is null or cur.updated_at is distinct from (v->>'expect_updated_at')::timestamptz) then raise exception 'conflict'; end if;
 if coalesce((v->>'auto_post')::boolean,false) and public.invoice_actor_role(actor) not in ('ceo','gm')
    and not coalesce(cur.auto_post, false) then raise exception 'forbidden'; end if;
 if cur.vendor_key is null then
  if length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
  insert into public.invoice_vendor_rules(vendor_key, display_name, aliases, food_kind, auto_post, verified_by, verified_at)
  values(v->>'vendor_key', v->>'display_name', coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}'), v->>'food_kind',
   coalesce((v->>'auto_post')::boolean,false), actor::text, now());
 else
  -- Only the keys that were sent change (a switch on its own leaves the names and the kind as they are now).
  update public.invoice_vendor_rules x set
   display_name=case when v ? 'display_name' then v->>'display_name' else x.display_name end,
   aliases=case when v ? 'aliases' then coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}') else x.aliases end,
   food_kind=case when v ? 'food_kind' then v->>'food_kind' else x.food_kind end,
   auto_post=case when v ? 'auto_post' then coalesce((v->>'auto_post')::boolean,false) else x.auto_post end,
   verified_by=actor::text, verified_at=now(), updated_at=now()
  where x.vendor_key=cur.vendor_key;
 end if;
 perform public.invoice_event(null, null, actor::text, 'vendor_saved', v);
 return (select to_jsonb(x) from public.invoice_vendor_rules x where vendor_key=v->>'vendor_key');
end $$;

create or replace function public.invoice_vendor_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 -- A card whose name a vendor already has (its own name or one of its names, also a vendor merged into another one) is not
 -- added again (業者の統合, Moto 2026-10-15): the name would belong to two vendors and match neither.
 select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.id::text, 'display_name', v.name,
   'food_kind', case when v.data->>'kind' in ('food','nonfood') then v.data->>'kind' end,
   'exists', exists(select 1 from public.invoice_vendor_rules r where r.vendor_key=v.id::text
     or exists(select 1 from unnest(array[r.display_name] || r.aliases) a(n)
       where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = nullif(btrim(regexp_replace(lower(normalize(v.name, NFKC)), '\s+', ' ', 'g')), '')))) order by v.name), '[]')
 into rows from public.vendors v where coalesce(v.name,'') <> '' and v.id::text ~ '^[A-Za-z0-9_.:@-]{1,80}$';
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_vendor_rules(vendor_key, display_name, food_kind, auto_post)
  select x->>'vendor_key', x->>'display_name', x->>'food_kind', false from jsonb_array_elements(rows) x
  where not coalesce((x->>'exists')::boolean, false)
  on conflict(vendor_key) do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'vendor_seed', jsonb_build_object('added', n));
 end if;
 return jsonb_build_object('vendors', rows, 'added', n);
end $$;

-- Product master rows that carry a vendor product code (LaLa's imported items do) -> unverified mappings.
-- Case vs bag/bottle comes from the master's own "qty per purchase unit"; grams only where the master counts in g.
create or replace function public.invoice_map_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 with src as (
  select i.code::text code, coalesce(i.data->>'name', i.name) name, coalesce(i.data->>'vendor', i.vendor) vendor, i.data->>'sku' sku,
   upper(regexp_replace(coalesce(i.data->>'orderUnit',''), '[\s.]', '', 'g')) order_unit, coalesce(i.data->>'unit', i.unit) count_unit,
   coalesce(nullif(i.data->>'qty','')::numeric, i.qty) qty, i.data->>'pack' pack
  from public.ingredients i
  where coalesce(i.data->>'sku','') <> '' and (not coalesce((p->>'only_ext')::boolean,true) or coalesce(i.data->>'extId','') <> '')),
 cand as (
  -- a vendor merged into another one is found through the kept vendor, which has its names (業者の統合, Moto 2026-10-15)
  select s.*, (select r.vendor_key from public.invoice_vendor_rules r where r.merged_into is null and (lower(r.display_name)=lower(s.vendor)
     or lower(s.vendor) in (select lower(a) from unnest(r.aliases) a)) limit 1) vendor_key from src s)
 select coalesce(jsonb_agg(jsonb_build_object('ingredient_code', code, 'name', name, 'vendor', vendor, 'vendor_key', vendor_key, 'vendor_item_code', sku,
   'purchase_unit', order_unit, 'count_unit', count_unit, 'count_per_purchase', case when qty > 0 then qty end,
   'base_unit', case when lower(count_unit) in ('g','ml') then lower(count_unit) end,
   'base_per_purchase', case when lower(count_unit) in ('g','ml') and qty > 0 then qty end, 'pack', pack) order by vendor, name), '[]')
 into rows from cand;
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_item_maps(vendor_key, store_id, vendor_item_code, spec_key, purchase_unit, ingredient_code, count_unit, count_per_purchase,
   base_unit, base_per_purchase, verified, auto_post, source, note)
  select x->>'vendor_key', p->>'store_id', x->>'vendor_item_code', '', coalesce(x->>'purchase_unit',''), x->>'ingredient_code', x->>'count_unit',
   (x->>'count_per_purchase')::numeric, x->>'base_unit', (x->>'base_per_purchase')::numeric, false, false, 'master_seed', x->>'pack'
  from jsonb_array_elements(rows) x where x->>'vendor_key' is not null
   and not exists(select 1 from public.invoice_item_maps m where m.vendor_key=x->>'vendor_key' and m.vendor_item_code=x->>'vendor_item_code')
  on conflict do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'map_seed', jsonb_build_object('added', n, 'store', p->>'store_id'));
 end if;
 return jsonb_build_object('candidates', rows, 'added', n,
  'vendor_unmatched', (select coalesce(jsonb_agg(distinct x->>'vendor'), '[]') from jsonb_array_elements(rows) x where x->>'vendor_key' is null));
end $$;

-- "This month of this vendor is all here" (compared with the vendor's statement), or what is missing. Accounting, 事務Crew,
-- GM and CEO, like reconciling. Never for a closed month. Kept as history: the latest row is the current state ('none' clears it).
-- A screen opened before a merge may still name a merged vendor: the check is kept for the vendor it ended at (業者の統合).
create or replace function public.invoice_purchase_check(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_actor uuid := nullif(p->>'actor','')::uuid; v_state text := p->>'state'; v_ym text := p->>'ym';
 v_closed text := public.invoice_setting('rules')->>'closed_through'; v_sc bigint; v_row public.invoice_purchase_checks;
 v_vk text := public.invoice_vendor_final(p->>'vendor_key');
begin
 perform public.invoice_require(v_actor, array['ceo','gm','office','office_crew']);
 if v_state is null or v_state not in ('complete','missing','none') then raise exception 'bad_value'; end if;
 if v_ym is null or v_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' or v_ym > to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM') then raise exception 'bad_value'; end if;
 if not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 if v_vk is null then raise exception 'not_found'; end if;
 if v_closed is not null and v_ym <= v_closed then raise exception 'closed_month'; end if;
 if v_state='missing' and length(btrim(coalesce(p->>'note',''))) = 0 then raise exception 'note_required'; end if;
 if jsonb_typeof(p->'statement_cents') = 'number' then
  if (p->>'statement_cents')::numeric <> trunc((p->>'statement_cents')::numeric) or abs((p->>'statement_cents')::numeric) > 100000000000 then raise exception 'bad_value'; end if;
  v_sc := (p->>'statement_cents')::bigint;
 elsif p->'statement_cents' is not null and jsonb_typeof(p->'statement_cents') <> 'null' then raise exception 'bad_value';
 end if;
 insert into public.invoice_purchase_checks(store_id, vendor_key, ym, state, note, statement_cents, checked_by)
 values(p->>'store_id', v_vk, v_ym, v_state, nullif(left(btrim(coalesce(p->>'note','')), 500), ''), v_sc, v_actor::text)
 returning * into v_row;
 perform public.invoice_event(null, null, v_actor::text, 'purchase_check', jsonb_build_object('store_id', v_row.store_id, 'vendor_key', v_row.vendor_key,
  'ym', v_ym, 'state', v_state, 'note', v_row.note, 'statement_cents', v_sc));
 return jsonb_build_object('ok', true, 'id', v_row.id, 'checked_at', v_row.checked_at);
end $$;

-- The vendor a key ends at: itself, or the vendor it was merged into (and so on). Null for a key no vendor has.
create or replace function public.invoice_vendor_final(p_key text) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 with recursive c(k, n) as (
  select r.vendor_key, 0 from public.invoice_vendor_rules r where r.vendor_key=p_key
  union all
  select r.merged_into, c.n + 1 from c join public.invoice_vendor_rules r on r.vendor_key=c.k where r.merged_into is not null and c.n < 20)
 select k from c order by n desc limit 1;
$$;

-- For the vendor master's 業者の統合 (accounting, 事務Crew, GM, CEO): every vendor with its names and how many invoices it has,
-- the printed names no vendor has yet (invoices waiting for a person), and the merges in force.
create or replace function public.invoice_vendor_usage(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return jsonb_build_object(
  'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.vendor_key, 'display_name', v.display_name, 'aliases', to_jsonb(v.aliases),
     'merged_into', v.merged_into, 'food_kind', v.food_kind, 'auto_post', v.auto_post,
     'docs', (select count(*) from public.invoice_docs d where d.vendor_key=v.vendor_key and d.status <> 'merged')) order by v.display_name, v.vendor_key), '[]')
   from public.invoice_vendor_rules v),
  'unknown', (select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'docs', q.n) order by q.n desc, q.name), '[]') from (
    select min(d.vendor_raw) name, count(*) n from public.invoice_docs d
    where d.vendor_key is null and d.status='review' and coalesce(btrim(d.vendor_raw), '') <> ''
    group by nullif(btrim(regexp_replace(lower(normalize(d.vendor_raw, NFKC)), '\s+', ' ', 'g')), '')) q),
  'merges', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'to_key', m.to_key, 'from_keys', to_jsonb(m.from_keys), 'names', to_jsonb(m.names),
     'group_id', m.group_id, 'merged_at', m.merged_at) order by m.merged_at desc), '[]')
   from public.invoice_vendor_merges m where m.undone_at is null));
end $$;

-- 業者の統合 (Moto 2026-10-15・UI案51 1A・2A・3A): the vendors any of the names belongs to become one. The kept vendor is the one
-- called by the name to keep (p.to), else the one that has it as a name, else the one with the most invoices; it is called p.to
-- from now on and takes every other name (its old name too), so a later invoice printed with any of them is that vendor. The
-- others are marked merged into it (not removed: the merge can be taken back). In months not closed (rules.closed_through) their
-- invoices (each page too), statement checks and product mappings (where the kept vendor has none for the same key) go to the
-- kept vendor, with its name; their price history goes to it in every month (it is what later prices are compared with). A
-- posted invoice whose number the kept vendor already has posted in the same store stays where it is and is listed (a double
-- posting for a person to look at). Invoices keep their version: no original is renamed again in Drive and nothing is sent to
-- QuickBooks again. Invoices waiting for review (also those whose printed name no vendor had) are returned for the caller to
-- work out again with the kept vendor. p.food_kind sets the kept vendor's kind (for invoices read from now on). p.preview:
-- nothing is changed; what would change is returned.
create or replace function public.invoice_vendor_merge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_to text := btrim(coalesce(p->>'to','')); v_prev boolean := coalesce((p->>'preview')::boolean, false);
 v_kind text := nullif(p->>'food_kind', ''); v_gid text := nullif(btrim(coalesce(p->>'group_id', '')), '');
 v_closed text := public.invoice_setting('rules')->>'closed_through';
 v_names text[]; v_keys text[]; v_tok text; v_match text[]; v_tk text; v_from text[]; tgt public.invoice_vendor_rules;
 v_have text[]; v_added text[] := '{}'; v_name text; v_k text; v_rename boolean; r record; v_id uuid;
 v_docs jsonb := '[]'; v_kept jsonb := '[]'; v_maps jsonb := '[]'; v_prices jsonb := '[]'; v_checks jsonb := '[]';
 v_review uuid[] := '{}'; v_unknown uuid[] := '{}'; v_months text[] := '{}'; v_pk text[] := '{}'; v_posted int := 0; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(p->'names') is distinct from 'array' then raise exception 'bad_value'; end if;
 v_names := array(select n from (select distinct on (btrim(x)) btrim(x) n, i from jsonb_array_elements_text(p->'names') with ordinality q(x, i)
   where btrim(x) <> '' order by btrim(x), i) z order by i);
 if length(v_to) = 0 or length(v_to) > 200 or cardinality(v_names) = 0 or cardinality(v_names) > 50
    or exists(select 1 from unnest(v_names) n where length(n) > 200) then raise exception 'bad_value'; end if;
 if v_kind is not null and v_kind not in ('food','nonfood') then raise exception 'bad_value'; end if;
 if v_gid is not null and v_gid !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'bad_value'; end if;
 v_tok := nullif(btrim(regexp_replace(lower(normalize(v_to, NFKC)), '\s+', ' ', 'g')), '');
 v_keys := array(select distinct k from (select nullif(btrim(regexp_replace(lower(normalize(x, NFKC)), '\s+', ' ', 'g')), '') k
   from unnest(v_names || v_to) x) q where k is not null);
 -- One writer at a time with the vendor edits and the name learning (invoice_vendor_save, invoice_edit) and other merges.
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 v_match := array(select v.vendor_key from public.invoice_vendor_rules v where v.merged_into is null
   and exists(select 1 from unnest(array[v.display_name] || v.aliases) a(n)
     where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)) order by v.vendor_key);
 if cardinality(v_match) = 0 then
  -- No vendor of invoice intake has any of these names: nothing to merge here (the app merges its own records).
  return jsonb_build_object('ok', true, 'preview', v_prev, 'matched', 0, 'merge_id', null, 'target', null, 'from', '[]'::jsonb,
   'unknown', (select count(*) from public.invoice_docs d where d.vendor_key is null and d.status='review'
     and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)));
 end if;
 select v.vendor_key into v_tk from public.invoice_vendor_rules v where v.vendor_key = any(v_match)
 order by (v.display_name = v_to) desc,
  (nullif(btrim(regexp_replace(lower(normalize(v.display_name, NFKC)), '\s+', ' ', 'g')), '') = v_tok) desc,
  exists(select 1 from unnest(v.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tok) desc,
  (select count(*) from public.invoice_docs d where d.vendor_key=v.vendor_key) desc, v.vendor_key
 limit 1;
 perform 1 from public.invoice_vendor_rules where vendor_key = any(v_match) for update;
 select * into tgt from public.invoice_vendor_rules where vendor_key=v_tk;
 v_from := array(select x from unnest(v_match) x where x <> v_tk order by x);
 v_rename := tgt.display_name is distinct from v_to;
 -- Invoices: the other vendors' (and the kept vendor's when it is called by another name now), month by month.
 for r in select d.id, d.file_id, d.vendor_key, d.vendor_name, d.status, d.store_id, d.doc_type, d.invoice_no_norm, d.invoice_no, d.internal_no,
   to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key = any(v_from) or (d.vendor_key = v_tk and d.vendor_name is distinct from v_to)
  order by (d.status='posted') desc, d.posted_at nulls last, d.created_at, d.id
 loop
  if v_closed is not null and r.ym <= v_closed then
   if r.vendor_key <> v_tk then v_left := v_left + 1; end if;
   continue;
  end if;
  if r.status='posted' and r.vendor_key <> v_tk and r.invoice_no_norm is not null
     and (r.store_id || '|' || r.doc_type || '|' || r.invoice_no_norm = any(v_pk)
      or exists(select 1 from public.invoice_docs x where x.status='posted' and x.id<>r.id and x.store_id=r.store_id and x.vendor_key=v_tk
       and x.doc_type=r.doc_type and x.invoice_no_norm=r.invoice_no_norm)) then
   v_kept := v_kept || jsonb_build_object('id', r.id, 'internal_no', r.internal_no, 'invoice_no', r.invoice_no, 'store_id', r.store_id, 'vendor_key', r.vendor_key);
   continue;
  end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=v_tk, vendor_name=v_to, updated_at=now() where id=r.id;
   perform public.invoice_event(r.id, r.file_id, actor::text, 'vendor_merged', jsonb_build_object('from', r.vendor_key, 'to', v_tk, 'name', v_to));
  end if;
  v_docs := v_docs || jsonb_build_object('id', r.id, 'k', r.vendor_key, 'n', r.vendor_name);
  if r.status='review' then v_review := v_review || r.id; end if;
  if r.status='posted' then
   v_posted := v_posted + 1;
   if r.invoice_no_norm is not null then v_pk := v_pk || (r.store_id || '|' || r.doc_type || '|' || r.invoice_no_norm); end if;
  end if;
  v_months := v_months || r.ym;
 end loop;
 -- Invoices waiting for a person because their printed name was no vendor's: they get the kept vendor (the caller does it).
 for r in select d.id, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)
  order by d.created_at, d.id
 loop
  if v_closed is not null and r.ym <= v_closed then continue; end if;
  v_unknown := v_unknown || r.id; v_months := v_months || r.ym;
 end loop;
 -- Product mappings: to the kept vendor, unless it has one for the same product code, name, spec and unit (that one stays).
 for r in select m.id, m.vendor_key, m.store_id, m.vendor_item_code, m.alias_key, m.spec_key, m.purchase_unit from public.invoice_item_maps m
  where m.vendor_key = any(v_from) order by m.updated_at, m.id
 loop
  if exists(select 1 from public.invoice_item_maps x where x.vendor_key=v_tk and coalesce(x.store_id,'')=coalesce(r.store_id,'')
     and coalesce(x.vendor_item_code,'')=coalesce(r.vendor_item_code,'') and coalesce(x.alias_key,'')=coalesce(r.alias_key,'')
     and x.spec_key=r.spec_key and x.purchase_unit=r.purchase_unit) then continue; end if;
  if not v_prev then update public.invoice_item_maps set vendor_key=v_tk, updated_at=now() where id=r.id; end if;
  v_maps := v_maps || jsonb_build_object('id', r.id, 'k', r.vendor_key);
 end loop;
 -- The kept vendor's names: its own (also the old one when it is called by another name now), the merged vendors' and the given ones.
 v_have := array(select nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') from unnest(tgt.aliases || v_to) a(n));
 for v_name in
  select x.n from (
   select tgt.display_name n, 0 o, ''::text kk, 0::bigint i where v_rename
   union all
   select a.n, 1, v.vendor_key, a.i from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) with ordinality a(n, i) where v.vendor_key = any(v_from)
   union all
   select u.n, 2, '', u.i from unnest(v_names) with ordinality u(n, i)) x
  order by x.o, x.kk, x.i
 loop
  v_k := nullif(btrim(regexp_replace(lower(normalize(coalesce(v_name, ''), NFKC)), '\s+', ' ', 'g')), '');
  if v_k is null or v_k = any(v_have) then continue; end if;
  v_added := v_added || v_name; v_have := v_have || v_k;
 end loop;
 if cardinality(v_from) = 0 and not v_rename and cardinality(v_added) = 0 and cardinality(v_unknown) = 0 then
  -- The names are already the kept vendor's, as it is called: nothing to merge here (no record either).
  return jsonb_build_object('ok', true, 'preview', v_prev, 'matched', cardinality(v_match), 'merge_id', null,
   'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post, 'food_kind', tgt.food_kind),
   'from', '[]'::jsonb, 'docs', 0, 'review', 0, 'posted', 0, 'kept', '[]'::jsonb, 'closed_left', 0, 'unknown', 0, 'maps', 0, 'prices', 0, 'checks', 0,
   'added_aliases', '[]'::jsonb, 'months', '[]'::jsonb);
 end if;
 if v_prev then
  return jsonb_build_object('ok', true, 'preview', true, 'merge_id', null, 'matched', cardinality(v_match),
   'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post,
     'food_kind', coalesce(v_kind, tgt.food_kind), 'kind_before', tgt.food_kind),
   'from', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.vendor_key, 'display_name', v.display_name, 'food_kind', v.food_kind,
     'auto_post', v.auto_post) order by v.vendor_key), '[]') from public.invoice_vendor_rules v where v.vendor_key = any(v_from)),
   'docs', jsonb_array_length(v_docs), 'review', cardinality(v_review), 'posted', v_posted, 'kept', v_kept, 'closed_left', v_left,
   'unknown', cardinality(v_unknown), 'maps', jsonb_array_length(v_maps),
   'prices', (select count(*) from public.invoice_price_history h where h.vendor_key = any(v_from)),
   'checks', (select count(*) from public.invoice_purchase_checks c where c.vendor_key = any(v_from) and (v_closed is null or c.ym > v_closed)),
   'added_aliases', to_jsonb(v_added), 'months', to_jsonb(array(select distinct m from unnest(v_months) m order by 1)));
 end if;
 with s as (select h.id, h.vendor_key k from public.invoice_price_history h where h.vendor_key = any(v_from)),
 u as (update public.invoice_price_history h set vendor_key=v_tk from s where h.id=s.id returning h.id, s.k)
 select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'k', u.k) order by u.id), '[]') into v_prices from u;
 with s as (select c.id, c.vendor_key k, c.ym from public.invoice_purchase_checks c where c.vendor_key = any(v_from) and (v_closed is null or c.ym > v_closed)),
 u as (update public.invoice_purchase_checks c set vendor_key=v_tk from s where c.id=s.id returning c.id, s.k, s.ym)
 select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'k', u.k, 'ym', u.ym) order by u.id), '[]') into v_checks from u;
 v_months := v_months || array(select e->>'ym' from jsonb_array_elements(v_checks) e);
 update public.invoice_vendor_rules set display_name=v_to, aliases=aliases || v_added, food_kind=coalesce(v_kind, food_kind), updated_at=now() where vendor_key=v_tk;
 update public.invoice_vendor_rules set merged_into=v_tk, merged_at=now(), merged_by=actor::text, updated_at=now() where vendor_key = any(v_from);
 insert into public.invoice_vendor_merges(to_key, from_keys, names, group_id, before, added_aliases, moved, kept, merged_by)
 values(v_tk, v_from, v_names, v_gid, jsonb_build_object('display_name', tgt.display_name, 'food_kind', tgt.food_kind, 'name', v_to, 'kind', v_kind), v_added,
  jsonb_build_object('docs', v_docs, 'maps', v_maps, 'prices', v_prices, 'checks', v_checks), v_kept, actor::text)
 returning id into v_id;
 perform public.invoice_event(null, null, actor::text, 'vendors_merged', jsonb_build_object('merge_id', v_id, 'to', v_tk, 'name', v_to, 'from', to_jsonb(v_from),
  'names', to_jsonb(v_names), 'docs', jsonb_array_length(v_docs), 'kept', v_kept, 'group_id', v_gid));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', v_id, 'matched', cardinality(v_match),
  'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post, 'food_kind', coalesce(v_kind, tgt.food_kind)),
  'from', to_jsonb(v_from), 'docs', jsonb_array_length(v_docs), 'review', cardinality(v_review), 'posted', v_posted, 'kept', v_kept, 'closed_left', v_left,
  'unknown', cardinality(v_unknown), 'maps', jsonb_array_length(v_maps), 'prices', jsonb_array_length(v_prices), 'checks', jsonb_array_length(v_checks),
  'added_aliases', to_jsonb(v_added), 'review_doc_ids', to_jsonb(v_review || v_unknown),
  'months', to_jsonb(array(select distinct m from unnest(v_months) m order by 1)));
end $$;

-- Takes a merge back: the merged vendors are vendors of their own again with their names, and what the merge moved goes back
-- where it was, as long as it is still with the kept vendor (an invoice corrected since stays). Invoices read after the merge stay
-- with the kept vendor. The latest merge of a vendor is taken back first (a later one could rest on the names this one added).
-- p.preview: nothing is changed; what would change is returned.
create or replace function public.invoice_vendor_unmerge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_prev boolean := coalesce((p->>'preview')::boolean, false);
 m public.invoice_vendor_merges; tgt public.invoice_vendor_rules; e jsonb; d public.invoice_docs;
 v_back int := 0; v_stay int := 0; v_review uuid[] := '{}'; v_months text[] := '{}';
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(p->>'merge_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into m from public.invoice_vendor_merges where id=(p->>'merge_id')::uuid for update;
 if m.id is null then raise exception 'not_found'; end if;
 if m.undone_at is not null then raise exception 'invalid_state'; end if;
 select * into tgt from public.invoice_vendor_rules where vendor_key=m.to_key for update;
 if tgt.merged_into is not null or exists(select 1 from public.invoice_vendor_merges x where x.undone_at is null and x.id<>m.id
    and x.to_key=m.to_key and x.merged_at > m.merged_at) then raise exception 'later_merge'; end if;
 for e in select x from jsonb_array_elements(coalesce(m.moved->'docs', '[]'::jsonb)) x loop
  select * into d from public.invoice_docs where id=(e->>'id')::uuid for update;
  if d.id is null or d.vendor_key is distinct from m.to_key then v_stay := v_stay + 1; continue; end if;
  if d.status='posted' and d.invoice_no_norm is not null and (e->>'k') is distinct from m.to_key and exists(select 1 from public.invoice_docs x
     where x.status='posted' and x.id<>d.id and x.store_id=d.store_id and x.vendor_key=e->>'k' and x.doc_type=d.doc_type and x.invoice_no_norm=d.invoice_no_norm) then
   v_stay := v_stay + 1; continue;
  end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=e->>'k', vendor_name=e->>'n', updated_at=now() where id=d.id;
   perform public.invoice_event(d.id, d.file_id, actor::text, 'vendor_unmerged', jsonb_build_object('from', m.to_key, 'to', e->>'k'));
  end if;
  v_back := v_back + 1;
  if d.status='review' then v_review := v_review || d.id; end if;
  v_months := v_months || to_char(coalesce(d.invoice_date, d.effective_date,
   (select (f.ingested_at at time zone 'Pacific/Honolulu')::date from public.invoice_files f where f.id=d.file_id)), 'YYYY-MM');
 end loop;
 v_months := v_months || array(select y->>'ym' from jsonb_array_elements(coalesce(m.moved->'checks', '[]'::jsonb)) y);
 if v_prev then
  return jsonb_build_object('ok', true, 'preview', true, 'merge_id', m.id, 'docs', v_back, 'stay', v_stay, 'review', cardinality(v_review),
   'from', to_jsonb(m.from_keys), 'months', to_jsonb(array(select distinct x from unnest(v_months) x where x is not null order by 1)));
 end if;
 update public.invoice_item_maps x set vendor_key=q.k, updated_at=now()
 from (select (y->>'id')::uuid id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'maps', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key and not exists(select 1 from public.invoice_item_maps z where z.vendor_key=q.k and z.id<>x.id
  and coalesce(z.store_id,'')=coalesce(x.store_id,'') and coalesce(z.vendor_item_code,'')=coalesce(x.vendor_item_code,'')
  and coalesce(z.alias_key,'')=coalesce(x.alias_key,'') and z.spec_key=x.spec_key and z.purchase_unit=x.purchase_unit);
 update public.invoice_price_history x set vendor_key=q.k
 from (select (y->>'id')::bigint id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'prices', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key;
 update public.invoice_purchase_checks x set vendor_key=q.k
 from (select (y->>'id')::bigint id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'checks', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key;
 update public.invoice_vendor_rules set merged_into=null, merged_at=null, merged_by=null, updated_at=now()
 where vendor_key = any(m.from_keys) and merged_into=m.to_key;
 update public.invoice_vendor_rules set
  aliases=array(select a from unnest(aliases) with ordinality u(a, i) where not (a = any(m.added_aliases)) order by i),
  display_name=case when display_name = m.before->>'name' then m.before->>'display_name' else display_name end,
  food_kind=case when m.before->>'kind' is not null and food_kind is not distinct from m.before->>'kind' then m.before->>'food_kind' else food_kind end,
  updated_at=now()
 where vendor_key=m.to_key;
 update public.invoice_vendor_merges set undone_by=actor::text, undone_at=now() where id=m.id;
 perform public.invoice_event(null, null, actor::text, 'vendors_unmerged', jsonb_build_object('merge_id', m.id, 'to', m.to_key, 'from', to_jsonb(m.from_keys),
  'docs', v_back, 'stayed', v_stay));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', m.id, 'docs', v_back, 'stay', v_stay, 'review', cardinality(v_review),
  'from', to_jsonb(m.from_keys), 'review_doc_ids', to_jsonb(v_review),
  'months', to_jsonb(array(select distinct x from unnest(v_months) x where x is not null order by 1)));
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_vendor_final(text)','invoice_vendor_usage(jsonb)','invoice_vendor_merge(jsonb)','invoice_vendor_unmerge(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;

-- 新しい業者を決める（Moto 2026-10-16 ③「インボイス取り込みで、新しい業者を検知した場合に、統合（読み間違い等で）か新規登録かを選択して
-- 選べるようにしたい」・UI案52 決めてほしいこと 9〜11 はすべて A）。このファイルは Invoice取込の分（画面はアプリ v1089）。
--
-- Changes (the screen and the function invoice-intake do the rest):
--   invoice_vendor_register : a new vendor from an invoice whose printed vendor name is no vendor's (accounting, 事務Crew, GM, CEO:
--                             10A). It takes the printed name as one of its names; a name some vendor has already is refused and
--                             that vendor is named (the screen offers the merge instead). The invoices waiting with the name (9A)
--                             are returned to be worked out again with the vendor.
--   invoice_vendor_waiting  : the vendors a printed name belongs to now and the invoices waiting with it (nothing is changed)
--   invoice_vendor_merge_into : the printed name merged into a vendor that exists, through invoice_vendor_merge (業者の統合,
--                             20261022090000, unchanged), after checking under the same lock that nothing else is merged
-- The new functions are for the service role only. No invoice, line, vendor, setting or Drive file is changed by running this
-- file. Running it twice changes nothing.

do $$ begin
 if to_regprocedure('public.invoice_vendor_merge(jsonb)') is null or to_regprocedure('public.invoice_vendor_final(text)') is null then
  raise exception '先に 20261022090000_invoice_vendor_merge.sql（業者の統合）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

-- 新しい業者を決める (Moto 2026-10-16・UI案52 ③ 9A・10A・11A): an invoice whose printed vendor name is no vendor's becomes a new
-- vendor's (accounting, 事務Crew, GM, CEO). The vendor is called p.vendor.display_name (the printed name, or the name a person
-- typed) and takes the printed name (p.printed) as one of its names when it differs, so a later invoice printed with it is this
-- vendor; it starts in review mode like every new vendor. A name some vendor has already (its own or one of its names; also a
-- key in use) is not registered: { ok:false, taken } names that vendor, for the screen to offer the merge instead (業者の統合).
-- One writer at a time with the other vendor writes (invoice_vendor_save, invoice_edit's name learning, invoice_vendor_merge).
-- The invoices waiting for a person with either name (vendor not chosen, in review), in months not closed, and the one on screen
-- (p.doc_id, if it is waiting) are returned for the caller to work out again with the new vendor (as a person's correction would).
create or replace function public.invoice_vendor_register(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor';
 v_key text; v_name text; v_kind text; v_printed text; v_doc uuid; v_keys text[]; v_aliases text[] := '{}';
 v_closed text := public.invoice_setting('rules')->>'closed_through';
 t record; r record; v_ids uuid[] := '{}'; v_months text[] := '{}'; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 v_key := v->>'vendor_key'; v_name := btrim(coalesce(v->>'display_name', '')); v_kind := v->>'food_kind';
 v_printed := nullif(btrim(coalesce(p->>'printed', '')), '');
 if coalesce(v_key, '') !~ '^[A-Za-z0-9_.:@-]{1,80}$' or length(v_name) = 0 or length(v_name) > 200 or length(coalesce(v_printed, '')) > 200
    or v_kind is null or v_kind not in ('food','nonfood') then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_keys := array(select distinct k from (select nullif(btrim(regexp_replace(lower(normalize(x, NFKC)), '\s+', ' ', 'g')), '') k
   from unnest(array[v_name, v_printed]) x) q where k is not null);
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select x.vendor_key, x.display_name, x.merged_into into t from public.invoice_vendor_rules x where x.vendor_key=v_key;
 if found then
  return jsonb_build_object('ok', false, 'taken', jsonb_build_object('why', 'key', 'vendor_key', coalesce(public.invoice_vendor_final(t.vendor_key), t.vendor_key),
   'display_name', (select y.display_name from public.invoice_vendor_rules y where y.vendor_key=coalesce(public.invoice_vendor_final(t.vendor_key), t.vendor_key)),
   'name', t.display_name));
 end if;
 select x.vendor_key, x.display_name, a.n into t from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n)
 where x.merged_into is null and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)
 order by (a.n = x.display_name) desc, x.display_name, x.vendor_key limit 1;
 if found then
  return jsonb_build_object('ok', false, 'taken', jsonb_build_object('why', 'name', 'vendor_key', t.vendor_key, 'display_name', t.display_name, 'name', t.n));
 end if;
 if v_printed is not null and nullif(btrim(regexp_replace(lower(normalize(v_printed, NFKC)), '\s+', ' ', 'g')), '')
    is distinct from nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '') then v_aliases := array[v_printed]; end if;
 insert into public.invoice_vendor_rules(vendor_key, display_name, aliases, food_kind, auto_post, verified_by, verified_at)
 values(v_key, v_name, v_aliases, v_kind, false, actor::text, now());
 for r in select d.id, (d.id = v_doc) here, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and (d.id = v_doc or nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys))
  order by (d.id = v_doc) desc, d.created_at, d.id
 loop
  if not coalesce(r.here, false) and v_closed is not null and r.ym <= v_closed then v_left := v_left + 1; continue; end if;
  v_ids := v_ids || r.id; v_months := v_months || r.ym;
 end loop;
 perform public.invoice_event(v_doc, null, actor::text, 'vendor_registered', jsonb_build_object('vendor_key', v_key, 'display_name', v_name,
  'printed', v_printed, 'food_kind', v_kind, 'docs', cardinality(v_ids), 'closed_left', v_left));
 return jsonb_build_object('ok', true, 'vendor', (select to_jsonb(x) from public.invoice_vendor_rules x where x.vendor_key=v_key),
  'doc_ids', to_jsonb(v_ids), 'closed_left', v_left, 'months', to_jsonb(array(select distinct m from unnest(v_months) m where m is not null order by 1)));
end $$;

-- The vendors a printed name belongs to now (vendors not merged into another one), and the invoices waiting for a person with
-- that name (vendor not chosen, in review), in months not closed, and the one on screen (p.doc_id, if it is waiting). For an
-- invoice read before its name became a vendor's (a name added in the settings, or merged or registered on another screen): the
-- caller gives them the vendor when exactly one has the name. Nothing is changed here.
create or replace function public.invoice_vendor_waiting(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_name text := btrim(coalesce(p->>'name', '')); v_k text; v_doc uuid;
 v_closed text := public.invoice_setting('rules')->>'closed_through'; r record; v_ids uuid[] := '{}'; v_months text[] := '{}'; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if length(v_name) = 0 or length(v_name) > 200 then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_k := nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '');
 for r in select d.id, (d.id = v_doc) here, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and (d.id = v_doc or nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k)
  order by (d.id = v_doc) desc, d.created_at, d.id
 loop
  if not coalesce(r.here, false) and v_closed is not null and r.ym <= v_closed then v_left := v_left + 1; continue; end if;
  v_ids := v_ids || r.id; v_months := v_months || r.ym;
 end loop;
 return jsonb_build_object(
  'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name, 'food_kind', x.food_kind) order by x.display_name, x.vendor_key), '[]')
   from public.invoice_vendor_rules x where x.merged_into is null
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k)),
  'doc_ids', to_jsonb(v_ids), 'closed_left', v_left, 'months', to_jsonb(array(select distinct m from unnest(v_months) m where m is not null order by 1)));
end $$;

-- 今の業者に統合 from an invoice (業者を決める): the printed name (p.name) joins the vendor p.vendor_key through 業者の統合
-- (invoice_vendor_merge: its record can be taken back from the vendor master). Under the lock of the vendor writes it is first
-- checked that nothing else is merged: the vendor is called by its name as it is now (a screen that read an older name never
-- renames it back), no other vendor has that name, and the printed name is no vendor's yet (if it is, the waiting invoices are
-- given that vendor instead: vendor_apply). Refused: { ok:false, why, vendors }. The invoice on screen (p.doc_id, if it is
-- waiting) comes first among the invoices to work out again, also in a closed month; the waiting ones with the name in closed
-- months are counted (closed_left) and left as they are. p.preview: nothing is changed.
create or replace function public.invoice_vendor_merge_into(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_key text := p->>'vendor_key'; v_name text := btrim(coalesce(p->>'name', ''));
 v_prev boolean := coalesce((p->>'preview')::boolean, false); v_doc uuid; v_k text; v_tk text; tgt public.invoice_vendor_rules;
 v_closed text := public.invoice_setting('rules')->>'closed_through'; r jsonb; v_ids jsonb; v_left int := 0; v_here boolean := false; v_extra int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(v_key, '') !~ '^[A-Za-z0-9_.:@-]{1,80}$' or length(v_name) = 0 or length(v_name) > 200 then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_k := nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '');
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into tgt from public.invoice_vendor_rules where vendor_key=v_key;
 if tgt.vendor_key is null or tgt.merged_into is not null then
  return jsonb_build_object('ok', false, 'why', 'gone', 'vendors', '[]'::jsonb);
 end if;
 if exists(select 1 from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n) where x.merged_into is null and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k) then
  return jsonb_build_object('ok', false, 'why', 'owned', 'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name)
   order by x.display_name, x.vendor_key), '[]') from public.invoice_vendor_rules x where x.merged_into is null
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k)));
 end if;
 v_tk := nullif(btrim(regexp_replace(lower(normalize(tgt.display_name, NFKC)), '\s+', ' ', 'g')), '');
 if exists(select 1 from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n) where x.merged_into is null and x.vendor_key <> tgt.vendor_key and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tk) then
  return jsonb_build_object('ok', false, 'why', 'shared', 'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name)
   order by x.display_name, x.vendor_key), '[]') from public.invoice_vendor_rules x where x.merged_into is null and x.vendor_key <> tgt.vendor_key
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tk)));
 end if;
 select count(*) into v_left from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
 where d.vendor_key is null and d.status='review' and d.id is distinct from v_doc and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k and v_closed is not null
  and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') <= v_closed;
 v_here := v_doc is not null and exists(select 1 from public.invoice_docs d where d.id=v_doc and d.vendor_key is null and d.status='review');
 -- The one on screen is given the vendor even when the merge would not reach it (a closed month): counted on top.
 if v_here and not exists(select 1 from public.invoice_docs d join public.invoice_files f on f.id=d.file_id where d.id=v_doc and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k
    and not (v_closed is not null and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') <= v_closed)) then v_extra := 1; end if;
 r := public.invoice_vendor_merge(jsonb_build_object('actor', p->>'actor', 'to', tgt.display_name, 'names', jsonb_build_array(tgt.display_name, v_name),
  'preview', v_prev, 'group_id', p->'group_id'));
 if v_prev then return r || jsonb_build_object('ok', true, 'closed_left', v_left, 'here', v_here, 'waiting', coalesce((r->>'unknown')::int, 0) + v_extra); end if;
 v_ids := coalesce(r->'review_doc_ids', '[]'::jsonb);
 if v_here then
  v_ids := jsonb_build_array(v_doc::text) || coalesce((select jsonb_agg(e) from jsonb_array_elements(v_ids) e where e #>> '{}' <> v_doc::text), '[]'::jsonb);
 end if;
 return r || jsonb_build_object('ok', true, 'review_doc_ids', v_ids, 'closed_left', v_left, 'here', v_here, 'waiting', coalesce((r->>'unknown')::int, 0) + v_extra);
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_vendor_register(jsonb)','invoice_vendor_waiting(jsonb)','invoice_vendor_merge_into(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
