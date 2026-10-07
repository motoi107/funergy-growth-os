-- Invoice intake: fixes from the Codex independent review of 1851593 (2026-10-07). Apply on a database that already has
-- 20261007090000_invoice_intake.sql. Only these six functions are replaced (same names and arguments, so the existing
-- grants stay: service_role only). No table, setting or record is changed by this file.
--   C1 invoice_qb_candidates / invoice_qb_enqueue: an original is forwarded only after its current content was read,
--      staged and checked for duplicates (a failed or pending reading is never forwarded).
--   C3 invoice_edit: a posted invoice stays posted only if the corrected values would pass posting (every correction,
--      a currency change included); a mismatch is acknowledged again whenever an amount, the currency, the document
--      type or a line changes (Codex re-review of 1301623: C3a, C3b).
--   C4 invoice_folder: a remembered destination folder that a person moved, renamed or trashed is replaced (and logged).
--   C5 invoice_stage / invoice_post: new content in an already-read Drive file waits for a person (original_replaced),
--      who supersedes the earlier version or confirms that both stand.
--   (C2 is in the Edge Function: a correction is compared with the app's own records again.)

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
 where o.file_id=(p->>'file_id')::uuid and o.sha256 is distinct from p->>'sha256' and o.status in ('posted','review');
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
 must_fix text[] := array['duplicate_certain','total_missing','line_value_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','no_lines','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 may_ack text[] := array['line_math','total_mismatch','original_replaced'];
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
  -- Automatic posting: only a document with no reason at all, with every switch on.
  if not coalesce((m->>'auto_post')::boolean,false) then raise exception 'auto_off'; end if;
  if not d.auto_eligible or jsonb_array_length(d.reasons) > 0 or d.doc_type<>'invoice' then raise exception 'not_eligible'; end if;
  if not exists(select 1 from public.invoice_stores where store_id=d.store_id and auto_post and active) then raise exception 'not_eligible'; end if;
  if not exists(select 1 from public.invoice_vendor_rules where vendor_key=d.vendor_key and auto_post) then raise exception 'not_eligible'; end if;
  if exists(select 1 from public.invoice_lines il left join public.invoice_item_maps im on im.id=il.map_id
            where il.doc_id=d.id and (im.id is null or not im.verified or not im.auto_post or jsonb_array_length(il.reasons) > 0)) then raise exception 'not_eligible'; end if;
  who := 'auto'; mode := 'auto';
 else
  perform public.invoice_require(actor, array['ceo','gm','office']);
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

create or replace function public.invoice_edit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; e jsonb; f text; v jsonb; ov jsonb; lid uuid;
 lrow public.invoice_lines; closed text; touched_price boolean := false; affects boolean := false; chg jsonb := '[]';
 money_fields text[] := array['invoice_date','delivery_date','total_cents','subtotal_cents','tax_cents','shipping_cents','discount_cents','other_cents',
  'vendor_key','invoice_no','doc_type','effective_date','currency'];
 -- Values a mismatch is computed from: when one of these (or a line) changes, an earlier acknowledgement no longer covers it.
 amount_fields text[] := array['total_cents','subtotal_cents','tax_cents','shipping_cents','discount_cents','other_cents','currency','doc_type'];
 amounts boolean := false;
 must_fix text[] := array['duplicate_certain','total_missing','line_value_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','no_lines','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 may_ack text[] := array['line_math','total_mismatch'];
 ack text[] := coalesce(array(select jsonb_array_elements_text(p->'ack')), '{}'); blocking text;
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
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
  where id=d.file_id and organize_target='reconciled';
  update public.invoice_app_mirror set state='held', error='edited_after_post', updated_at=now() where doc_id=d.id and state='mirrored';
 end if;
 -- Every earlier value is kept in the event log, so repeated corrections never lose history.
 perform public.invoice_event(d.id, d.file_id, actor::text, 'edited', jsonb_build_object('changes', chg, 'reason', p->>'reason'));
 return jsonb_build_object('ok', true, 'version', d.version + 1);
end $$;

create or replace function public.invoice_folder(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.invoice_folders;
begin
 if p ? 'id' then
  -- replace=true: the worker found the remembered folder moved, renamed or trashed in Drive; the record now points to the folder in place.
  if coalesce((p->>'replace')::boolean,false) then
   if exists(select 1 from public.invoice_folders where id=p->>'id' and not (parent_id=p->>'parent_id' and name=p->>'name')) then raise exception 'folder_conflict'; end if;
   select * into r from public.invoice_folders where parent_id=p->>'parent_id' and name=p->>'name';
   if r.id is not null and r.id <> p->>'id' then
    update public.invoice_folders set id=p->>'id', store_id=p->>'store_id', role=p->>'role', created_by_worker=coalesce((p->>'created_by_worker')::boolean,false), created_at=now()
    where parent_id=p->>'parent_id' and name=p->>'name';
    perform public.invoice_event(null, null, 'worker', 'folder_replaced', jsonb_build_object('parent_id', p->>'parent_id', 'name', p->>'name', 'old_id', r.id, 'new_id', p->>'id'));
   end if;
  end if;
  insert into public.invoice_folders(id, parent_id, name, store_id, role, created_by_worker)
  values(p->>'id', p->>'parent_id', p->>'name', p->>'store_id', p->>'role', coalesce((p->>'created_by_worker')::boolean,false))
  on conflict(parent_id, name) do nothing;
 end if;
 select * into r from public.invoice_folders where parent_id=p->>'parent_id' and name=p->>'name';
 return case when r.id is null then null else to_jsonb(r) end;
end $$;

create or replace function public.invoice_qb_candidates(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id)), '[]') from (
  select f.id from public.invoice_files f
  where f.source='drive' and f.current_sha256 is not null and f.intake_status in ('review','posted')
   and (f.drive_created_at at time zone 'Pacific/Honolulu')::date >= (public.invoice_setting('qb')->>'since')::date
   and not exists(select 1 from public.invoice_qb_outbox o where o.sha256=f.current_sha256 and o.to_address=public.invoice_setting('qb')->>'to' and o.state<>'cancelled')
   -- The current content must have been read and checked for duplicates: a failed or pending reading has no documents yet.
   and exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256)
   -- Possible duplicates, replaced originals and documents that could not be read wait for a person before anything is forwarded.
   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review'
     and exists(select 1 from jsonb_array_elements(d.reasons) r where r->>'code' in
       ('duplicate_candidate','same_number_different','app_duplicate_candidate','unreadable','ai_failed','ai_truncated','multiple_documents','original_replaced')))
  order by f.ingested_at limit coalesce((p->>'limit')::int, 20)) f;
$$;

create or replace function public.invoice_qb_enqueue(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare q jsonb := public.invoice_setting('qb'); f public.invoice_files; o public.invoice_qb_outbox;
begin
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid;
 if f.id is null or f.current_sha256 is null then raise exception 'not_found'; end if;
 if f.source <> 'drive' then return jsonb_build_object('queued', false, 'why', 'not_new_intake'); end if;
 if coalesce(q->>'route','') not in ('invoice-intake','external') then return jsonb_build_object('queued', false, 'why', 'route_not_assigned'); end if;
 if (f.drive_created_at at time zone 'Pacific/Honolulu')::date < (q->>'since')::date then return jsonb_build_object('queued', false, 'why', 'before_since'); end if;
 -- Same readiness as invoice_qb_candidates, checked again at the moment of queuing.
 if f.intake_status not in ('review','posted')
    or not exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256)
    or exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review'
      and exists(select 1 from jsonb_array_elements(d.reasons) r where r->>'code' in
        ('duplicate_candidate','same_number_different','app_duplicate_candidate','unreadable','ai_failed','ai_truncated','multiple_documents','original_replaced'))) then
  return jsonb_build_object('queued', false, 'why', 'not_ready');
 end if;
 insert into public.invoice_qb_outbox(file_id, sha256, to_address, route, attempt_key)
 values(f.id, f.current_sha256, q->>'to', q->>'route', 'qb-' || f.current_sha256 || '-' || md5(q->>'to'))
 on conflict do nothing returning * into o;
 if o.id is null then return jsonb_build_object('queued', false, 'why', 'already'); end if;
 perform public.invoice_event(null, f.id, 'worker', 'qb_queued', jsonb_build_object('to', q->>'to'));
 return jsonb_build_object('queued', true, 'id', o.id);
end $$;
