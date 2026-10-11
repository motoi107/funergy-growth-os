-- 事務Crew（office_crew）の Invoice取込の権限を元に戻す（閲覧だけ）。20261009190000（と 20261009170000）を取り消すとき用。
-- 中身は 2026-10-09 の変更の前（commit 6e1383d）の関数 10 個そのまま。表・設定・記録は変えない（反映済みの書類・照合・履歴は残る）。
-- 流したあと db/invoice-intake-postcheck.sql の office_crew_accounting が false になる。アプリは v1058 に戻すか、v1059 のままなら事務Crew の操作は「権限がありません」になる。
-- Reverts office_crew to view-only in invoice intake: the ten functions exactly as before 2026-10-09 (6e1383d). No table, setting or record changes.

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
 -- Accounting checks the vendor, the invoice number, the amount and the store (Moto 2026-10-07). Products and unit prices
 -- are kept for reference only: they never stop posting (info), and a line that cannot be matched is not price history.
 must_fix text[] := array['duplicate_certain','total_missing','date_missing','date_unreadable','date_disagree','vendor_unknown',
  'currency','doc_type_unknown','receipt_route','statement','unreadable','ai_failed','ai_truncated'];
 may_ack text[] := array['total_mismatch','line_amount_missing','line_value_missing'];
 ack text[] := coalesce(array(select jsonb_array_elements_text(p->'ack')), '{}'); blocking text;
 learned text; akey text;
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
 perform public.invoice_require(actor, array['ceo','gm','office']);
 if length(coalesce(p->>'reason','')) = 0 then raise exception 'reason_required'; end if;
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status = 'posted' then raise exception 'posted_use_correction'; end if;
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

create or replace function public.invoice_relate(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null or not exists(select 1 from public.invoice_docs where id=(p->>'related_doc_id')::uuid) then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if (p->>'relation') not in ('credit_for','payment_for','correction_of','statement_covers') then raise exception 'bad_relation'; end if;
 update public.invoice_docs set related_doc_id=(p->>'related_doc_id')::uuid, relation=p->>'relation', version=version+1, updated_at=now() where id=d.id;
 perform public.invoice_event(d.id, d.file_id, actor::text, 'related', jsonb_build_object('to', p->>'related_doc_id', 'relation', p->>'relation'));
 return jsonb_build_object('ok', true, 'version', d.version + 1);
end $$;

create or replace function public.invoice_reconcile(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; r text := p->>'result';
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 if r not in ('reconciled','discrepancy','unreconciled') then raise exception 'bad_result'; end if;
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid for update;
 if d.id is null then raise exception 'not_found'; end if;
 if d.version <> (p->>'version')::int then raise exception 'conflict'; end if;
 if d.status not in ('posted') and not (d.posting_kind='none' and d.status='review') then raise exception 'invalid_state'; end if;
 if r = 'discrepancy' and length(coalesce(p->>'note','')) = 0 then raise exception 'note_required'; end if;
 update public.invoice_docs set recon_status=r, recon_by=actor::text, recon_at=now(), recon_note=nullif(p->>'note',''), recon_diff=p->'diff',
  version=version+1, updated_at=now() where id=d.id;
 if r = 'reconciled' then
  update public.invoice_files set organize_target='reconciled', organize_status='pending', organize_attempts=0, organize_error=null, organize_next_at=null
  where id=d.file_id;
 else
  update public.invoice_files set organize_target='unreconciled', organize_status='pending', organize_attempts=0, organize_error=null, organize_next_at=null
  where id=d.file_id and organize_target='reconciled';
 end if;
 perform public.invoice_event(d.id, d.file_id, actor::text, 'reconcile_'||r, jsonb_build_object('note', p->>'note', 'diff', p->'diff'));
 return jsonb_build_object('ok', true, 'version', d.version + 1);
end $$;

create or replace function public.invoice_qb_result(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; s text := p->>'state';
begin
 if s not in ('sent','error','unknown','pending') then raise exception 'bad_state'; end if;
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid for update;
 if o.id is null then raise exception 'not_found'; end if;
 -- A person (accounting, GM, CEO) may only settle an unknown result after checking the sender's records.
 if nullif(p->>'actor','') is not null and p->>'actor' <> 'external' then
  perform public.invoice_require((p->>'actor')::uuid, array['ceo','gm','office']);
  if o.state <> 'unknown' or s not in ('sent','pending') then raise exception 'invalid_state'; end if;
 end if;
 -- The external sender may only report on its own rows, and only after reserving them.
 if p->>'actor' = 'external' and (o.route <> 'external' or o.state not in ('sending','unknown') or s = 'pending') then raise exception 'invalid_state'; end if;
 if s='pending' then
  -- Only a person who checked the sender's records may re-queue an unknown send.
  if o.state<>'unknown' then raise exception 'invalid_state'; end if;
  perform public.invoice_require(nullif(p->>'actor','')::uuid, array['ceo','gm','office']);
 end if;
 if o.state='sent' then return jsonb_build_object('ok', true, 'state', 'sent'); end if;
 update public.invoice_qb_outbox set state=s, sent_at=case when s='sent' then now() else sent_at end,
  message_id=coalesce(p->>'message_id', message_id), result=coalesce(p->'result', result), last_error=left(p->>'error',300),
  next_at=case when s='error' then now() + make_interval(mins => least(720, 15 * power(2, least(attempts,5))::int)) end, updated_at=now()
 where id=o.id;
 perform public.invoice_event(null, o.file_id, coalesce(p->>'actor','worker'), 'qb_'||s, jsonb_build_object('message_id', p->>'message_id', 'error', left(p->>'error',300)));
 return jsonb_build_object('ok', true, 'state', s);
end $$;

create or replace function public.invoice_vendor_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor'; cur public.invoice_vendor_rules;
 k text; known text[] := array['vendor_key','display_name','aliases','food_kind','auto_post','expect_updated_at'];
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 if coalesce(v->>'vendor_key','') !~ '^[A-Za-z0-9_.:@-]{1,80}$' then raise exception 'bad_value'; end if;
 if v ? 'display_name' and length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
 for k in select jsonb_object_keys(v) loop if not (k = any(known)) then raise exception 'bad_value'; end if; end loop;
 -- One writer at a time with the alias learning in invoice_edit (no name is taught twice or lost between a read and a write).
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into cur from public.invoice_vendor_rules where vendor_key=v->>'vendor_key' for update;
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

create or replace function public.invoice_map_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; m jsonb := p->'map'; r public.invoice_item_maps; rl text;
begin
 rl := public.invoice_require(actor, array['ceo','gm','office']);
 if coalesce((m->>'auto_post')::boolean,false) and not coalesce((m->>'verified')::boolean,false) then raise exception 'bad_value'; end if;
 if coalesce((m->>'auto_post')::boolean,false) and rl not in ('ceo','gm')
    and not (m ? 'id' and coalesce((select auto_post from public.invoice_item_maps where id=(m->>'id')::uuid), false)) then raise exception 'forbidden'; end if;
 if m ? 'id' then
  update public.invoice_item_maps set ingredient_code=m->>'ingredient_code', count_unit=m->>'count_unit', count_per_purchase=(m->>'count_per_purchase')::numeric,
   base_unit=m->>'base_unit', base_per_purchase=(m->>'base_per_purchase')::numeric, verified=coalesce((m->>'verified')::boolean,false),
   verified_by=case when coalesce((m->>'verified')::boolean,false) then actor::text end, verified_at=case when coalesce((m->>'verified')::boolean,false) then now() end,
   auto_post=coalesce((m->>'auto_post')::boolean,false), note=m->>'note', version=version+1, updated_at=now()
  where id=(m->>'id')::uuid and version=(m->>'version')::int returning * into r;
  if r.id is null then raise exception 'conflict'; end if;
 else
  insert into public.invoice_item_maps(vendor_key, store_id, vendor_item_code, alias_key, spec_key, purchase_unit, ingredient_code, count_unit,
   count_per_purchase, base_unit, base_per_purchase, verified, verified_by, verified_at, auto_post, source, note)
  values(m->>'vendor_key', m->>'store_id', m->>'vendor_item_code', m->>'alias_key', coalesce(m->>'spec_key',''), coalesce(m->>'purchase_unit',''),
   m->>'ingredient_code', m->>'count_unit', (m->>'count_per_purchase')::numeric, m->>'base_unit', (m->>'base_per_purchase')::numeric,
   coalesce((m->>'verified')::boolean,false), case when coalesce((m->>'verified')::boolean,false) then actor::text end,
   case when coalesce((m->>'verified')::boolean,false) then now() end, coalesce((m->>'auto_post')::boolean,false), coalesce(m->>'source','manual'), m->>'note')
  returning * into r;
 end if;
 perform public.invoice_event(null, null, actor::text, 'map_saved', to_jsonb(r));
 return to_jsonb(r);
end $$;

create or replace function public.invoice_file_retry(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 update public.invoice_files set intake_status=case when intake_status='error' then 'pending' else intake_status end, attempts=0, next_attempt_at=null,
  organize_status=case when organize_status='error' then 'pending' else organize_status end, organize_attempts=0, organize_next_at=null, updated_at=now()
 where id=(p->>'file_id')::uuid;
 if not found then raise exception 'not_found'; end if;
 perform public.invoice_event(null, (p->>'file_id')::uuid, actor::text, 'retry', '{}');
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.invoice_reassign(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; f public.invoice_files;
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 if length(coalesce(p->>'reason','')) = 0 then raise exception 'reason_required'; end if;
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid for update;
 if f.id is null or not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 if exists(select 1 from public.invoice_docs where file_id=f.id and status='posted') then raise exception 'posted_use_correction'; end if;
 update public.invoice_docs set status='rejected', version=version+1, updated_at=now() where file_id=f.id and status in ('review','duplicate');
 update public.invoice_files set store_id=p->>'store_id', store_assigned_by=actor::text, drive_state=case when drive_state='moved_store' then 'ok' else drive_state end,
  intake_status='pending', attempts=0, next_attempt_at=null, organize_status='none', organize_target=null, updated_at=now() where id=f.id;
 perform public.invoice_event(null, f.id, actor::text, 'reassigned', jsonb_build_object('from', f.store_id, 'to', p->>'store_id', 'reason', p->>'reason'));
 return jsonb_build_object('ok', true);
end $$;
