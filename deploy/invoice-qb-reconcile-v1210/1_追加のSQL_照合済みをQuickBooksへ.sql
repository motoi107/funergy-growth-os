-- 照合済みの invoice が QuickBooks へ（2026-11-23・Moto さんの依頼 B-3・PR は v1210）。
-- Run after 20261103090000_invoice_price_compare.sql. Running it twice is the same as once. Nothing is sent, deleted or rewritten
-- by this file: it adds one column (outbox.parts), replaces six functions and adds five. The rows already in the ledger stay as they are.
--  * 照合 (one or many): saving a reconciliation asks for the QuickBooks send at once, under the same conditions as before (posted,
--    renamed, since, the route, the ledger on). 照合済み is not 転送済み; a mail accepted by Gmail is not "registered in QuickBooks".
--  * An invoice of several originals (merged pages, UI案50 5) is sent as ONE mail with ONE PDF of its pages in page order, when this
--    system sends (route invoice-intake). The old route (external) keeps waiting them out of its ledger (multi_file) as before.
--    Its row: sha256 = 'multi-' || sha-256 of the pages' contents in order; parts = the pages. The same pages are never sent twice:
--    a page already sent (alone, or in an older combination) or under way keeps the invoice out and asks for a person (manual).
--  * A row set aside before sending (the content or the invoice changed, its reconciliation was taken back) blocks its key until a
--    person sends it again (invoice_qb_retry); the worker no longer picks the same file again and again (it kept 20 places busy).
--  * Taking a reconciliation back (stop_qb) stops the sends of that invoice that have not started (cancelled 'recon_cancelled').
--  * invoice_qb_doc_states: for the screen, per invoice: not_sent / queued / sending / sent / failed / unknown and why.
--  * invoice_qb_unsent: reconciled invoices without a send recorded, with what is known (confirmed) and what is not (unconfirmed).
do $$ begin
 if to_regprocedure('public.invoice_price_cmp(numeric,numeric,text,numeric,text,text)') is null
    or to_regprocedure('public.invoice_qb_send_context(jsonb)') is null or to_regclass('public.invoice_qb_outbox') is null then
  raise exception '先に 20261103090000_invoice_price_compare.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

alter table public.invoice_qb_outbox add column if not exists parts jsonb;

-- Every posted invoice that has pages merged into it (UI案50 5), with what one send of it is: its pages in order (file, content),
-- the key of their contents, and why it cannot be sent now (null: it can).
--   part_changed      : an original no longer holds the content the page was read from (it is read again first)
--   rename_waiting    : a page still waits for its name (日付_業者名_番号_pN)
--   part_already_sent : a page went to this address already (alone, or in another combination): a person records the rest (manual)
--   part_in_progress  : a page is waiting, being sent, failed or unknown in another row: settled first
create or replace function public.invoice_qb_merges() returns table(head_file uuid, head_doc uuid, composite text, parts jsonb, why text)
language sql stable security invoker set search_path=public,pg_temp as $$
 with h as (
  select f.id head_file, d0.id head_doc from public.invoice_files f
  join public.invoice_docs d0 on d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted'
  where exists(select 1 from public.invoice_docs x where x.merged_into=d0.id)),
 pt as (
  select h.head_file, h.head_doc, x.file_id, x.sha256 psha, coalesce(x.part_no, 0) part_no, pf.current_sha256 fsha
  from h join public.invoice_docs x on x.id=h.head_doc or x.merged_into=h.head_doc
  join public.invoice_files pf on pf.id=x.file_id),
 g as (
  select pt.head_file, pt.head_doc,
   'multi-' || encode(sha256(convert_to(string_agg(pt.psha, ',' order by pt.part_no, pt.file_id), 'UTF8')), 'hex') composite,
   jsonb_agg(jsonb_build_object('file_id', pt.file_id, 'sha256', pt.psha, 'part_no', pt.part_no) order by pt.part_no, pt.file_id) parts,
   bool_or(pt.fsha is distinct from pt.psha) changed, array_agg(pt.psha) shas, array_agg(pt.file_id) files
  from pt group by pt.head_file, pt.head_doc)
 select g.head_file, g.head_doc, g.composite, g.parts,
  case when g.changed then 'part_changed'
   when exists(select 1 from public.invoice_rename_waiting_all() w where w.file_id = any(g.files)) then 'rename_waiting'
   when exists(select 1 from public.invoice_qb_outbox o where o.state='sent' and o.to_address=public.invoice_setting('qb')->>'to' and o.sha256 <> g.composite
     and (o.sha256 = any(g.shas) or exists(select 1 from jsonb_array_elements(coalesce(o.parts, '[]'::jsonb)) e where e->>'sha256' = any(g.shas)))) then 'part_already_sent'
   when exists(select 1 from public.invoice_qb_outbox o where o.state in ('pending','sending','error','unknown') and o.to_address=public.invoice_setting('qb')->>'to'
     and o.sha256 <> g.composite
     and (o.sha256 = any(g.shas) or exists(select 1 from jsonb_array_elements(coalesce(o.parts, '[]'::jsonb)) e where e->>'sha256' = any(g.shas)))) then 'part_in_progress'
  end
 from g;
$$;

-- Whether an original can be queued now, and what as: {sha256, parts, doc_id} or {why}. The same conditions for the worker's
-- candidates, a posting, a reconciliation and a person's retry (Moto 2026-10-12: posted, then renamed).
create or replace function public.invoice_qb_ready(p_file uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare q jsonb := public.invoice_setting('qb'); f public.invoice_files; m record; v_doc uuid;
begin
 select * into f from public.invoice_files where id=p_file;
 if f.id is null or f.current_sha256 is null then return jsonb_build_object('why', 'not_found'); end if;
 if f.source <> 'drive' then return jsonb_build_object('why', 'not_new_intake'); end if;
 if coalesce(q->>'route','') not in ('invoice-intake','external') then return jsonb_build_object('why', 'route_not_assigned'); end if;
 if not coalesce(f.drive_created_at >= public.invoice_qb_since_at(), false) then return jsonb_build_object('why', 'before_since'); end if;
 -- Every document of the current content is settled and one is posted: possible duplicates, replaced originals and documents
 -- that could not be read are still waiting for a person (review), so they are never queued.
 select d0.id into v_doc from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted' order by d0.doc_index limit 1;
 if f.intake_status <> 'posted' or v_doc is null
    or exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review') then
  return jsonb_build_object('why', 'not_ready');
 end if;
 if public.invoice_rename_waiting(f.id) then return jsonb_build_object('why', 'rename_waiting', 'doc_id', v_doc); end if;
 select * into m from public.invoice_qb_merges() x where x.head_file=f.id;
 if m.head_file is not null then
  -- The old forwarder (route external) cannot send an invoice of several originals as one: it waits out of its ledger as before.
  if coalesce(q->>'route','') <> 'invoice-intake' then return jsonb_build_object('why', 'multi_file', 'doc_id', m.head_doc); end if;
  if m.why is not null then return jsonb_build_object('why', m.why, 'doc_id', m.head_doc); end if;
  return jsonb_build_object('sha256', m.composite, 'parts', m.parts, 'doc_id', m.head_doc);
 end if;
 -- The same content already went as a page of an invoice of several originals: never sent again alone.
 if exists(select 1 from public.invoice_qb_outbox o where o.parts is not null and o.state <> 'cancelled' and o.to_address=q->>'to'
           and o.parts @> jsonb_build_array(jsonb_build_object('sha256', f.current_sha256))) then
  return jsonb_build_object('why', 'part_already_sent', 'doc_id', v_doc);
 end if;
 return jsonb_build_object('sha256', f.current_sha256, 'doc_id', v_doc);
end $$;

create or replace function public.invoice_qb_enqueue(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare q jsonb := public.invoice_setting('qb'); r jsonb; o public.invoice_qb_outbox; v_file uuid := (p->>'file_id')::uuid; k text;
begin
 -- Same readiness as invoice_qb_candidates (invoice_qb_ready: intake_status 'posted' with nothing in review, invoice_rename_waiting,
 -- the start, the route; merged_into: an invoice of several originals goes as one PDF, or waits as multi_file on the old route),
 -- checked again at the moment of queuing.
 r := public.invoice_qb_ready(v_file);
 if r->>'why' = 'not_found' then raise exception 'not_found'; end if;
 if r ? 'why' then return jsonb_build_object('queued', false, 'why', r->>'why'); end if;
 k := 'qb-' || (r->>'sha256') || '-' || md5(q->>'to');
 select * into o from public.invoice_qb_outbox where attempt_key=k for update;
 if o.id is not null then
  -- A row taken back before it was sent comes back by itself only when what took it back is over: the invoice it waited for as
  -- several originals is one original again (unmerged), or its reconciliation that was taken back is given again.
  if o.state = 'cancelled' and ((o.last_error = 'multi_file' and o.parts is null and r->'parts' is null)
       or (o.last_error = 'recon_cancelled' and exists(select 1 from public.invoice_docs d where d.id=(r->>'doc_id')::uuid and d.recon_status='reconciled'))) then
   update public.invoice_qb_outbox set state='pending', file_id=v_file, route=q->>'route', attempts=least(attempts, 4), reserved_by=null, reserved_at=null,
    next_at=null, last_error=null, updated_at=now() where id=o.id;
   perform public.invoice_event(null, v_file, 'worker', 'qb_resumed', jsonb_build_object('to', q->>'to', 'why', o.last_error));
   return jsonb_build_object('queued', true, 'id', o.id, 'resumed', true);
  end if;
  return jsonb_build_object('queued', false, 'why', 'already');
 end if;
 insert into public.invoice_qb_outbox(file_id, sha256, to_address, route, attempt_key, parts)
 values(v_file, r->>'sha256', q->>'to', q->>'route', k, r->'parts')
 on conflict do nothing returning * into o;
 if o.id is null then return jsonb_build_object('queued', false, 'why', 'already'); end if;
 perform public.invoice_event(null, v_file, 'worker', 'qb_queued', jsonb_build_object('to', q->>'to', 'pages', jsonb_array_length(coalesce(r->'parts', '[]'::jsonb))));
 return jsonb_build_object('queued', true, 'id', o.id);
end $$;

create or replace function public.invoice_qb_candidates(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare q jsonb := public.invoice_setting('qb');
begin
 return (select coalesce(jsonb_agg(jsonb_build_object('file_id', c.id)), '[]') from (
  select f.id from public.invoice_files f
  left join public.invoice_qb_merges() m on m.head_file=f.id
  cross join lateral (select 'qb-' || coalesce(m.composite, f.current_sha256) || '-' || md5(q->>'to') k) kk
  -- Moto 2026-10-12: an original goes to QuickBooks once it is posted (「この内容で反映」 or automatically) and renamed.
  where f.source='drive' and f.current_sha256 is not null and f.intake_status='posted'
   and f.drive_created_at >= (select public.invoice_qb_since_at())
   and exists(select 1 from public.invoice_docs d0 where d0.file_id=f.id and d0.sha256=f.current_sha256 and d0.status='posted')
   -- Possible duplicates, replaced originals and documents that could not be read wait for a person (review): never forwarded before.
   and not exists(select 1 from public.invoice_docs d where d.file_id=f.id and d.sha256=f.current_sha256 and d.status='review')
   and f.id not in (select w.file_id from public.invoice_rename_waiting_all() w)
   -- An invoice of several originals (merged_into) goes as one PDF when this system sends and nothing of it is sent or under way.
   and (m.head_file is null or (coalesce(q->>'route','') = 'invoice-intake' and m.why is null))
   and not exists(select 1 from public.invoice_qb_outbox o where o.parts is not null and o.state <> 'cancelled' and o.to_address=q->>'to'
                  and m.head_file is null and o.parts @> jsonb_build_array(jsonb_build_object('sha256', f.current_sha256)))
   -- Any row of the same key (also one taken back before it was sent) keeps it out, unless invoice_qb_enqueue brings that row back.
   and not exists(select 1 from public.invoice_qb_outbox o where o.attempt_key=kk.k
     and not (o.state='cancelled' and ((o.last_error='multi_file' and o.parts is null and m.head_file is null)
       or (o.last_error='recon_cancelled' and exists(select 1 from public.invoice_docs dr where dr.id=coalesce(m.head_doc,
            (select d1.id from public.invoice_docs d1 where d1.file_id=f.id and d1.sha256=f.current_sha256 and d1.status='posted' order by d1.doc_index limit 1))
          and dr.recon_status='reconciled')))))
  order by f.ingested_at limit coalesce((p->>'limit')::int, 20)) c);
end $$;

-- What a reserved row is sent as, with the settings read again (enabled, the address, the start, the rename, the sender).
-- why: not_reserved (another sender has it, or the reservation is gone) · qb_off · route_changed · to_changed · before_since ·
-- not_posted · rename_waiting · content_changed (the database already knows a new content) · merge_changed (the invoice of several
-- originals is not the one queued any more) · part_already_sent · part_in_progress · gmail_not_ok · sender_mismatch.
-- route_changed and gmail_not_ok let the row go (invoice_qb_release: it waits, the try is not counted).
create or replace function public.invoice_qb_send_context(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; f public.invoice_files; q jsonb := public.invoice_setting('qb'); g public.invoice_gmail_auth; v_why text; m record;
begin
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid;
 if o.id is null or o.state <> 'sending' or o.reserved_by is distinct from p->>'owner' then return jsonb_build_object('ok', false, 'why', 'not_reserved'); end if;
 select * into f from public.invoice_files where id=o.file_id;
 select * into g from public.invoice_gmail_auth where id=1;
 -- always assigned (a record read in the CASE below must be), with nulls when this is not an invoice of several originals
 select * into m from public.invoice_qb_merges() x where o.parts is not null and x.head_file=o.file_id;
 v_why := case
  when not coalesce((q->>'enabled')::boolean, false) then 'qb_off'
  when coalesce(q->>'route', '') <> 'invoice-intake' then 'route_changed'
  when o.to_address is distinct from q->>'to' then 'to_changed'
  when not coalesce(f.drive_created_at >= public.invoice_qb_since_at(), false) then 'before_since'
  when f.intake_status <> 'posted' then 'not_posted'
  when o.parts is null and f.current_sha256 is distinct from o.sha256 then 'content_changed'
  when o.parts is not null and m.head_file is null then 'merge_changed'
  when o.parts is not null and m.why = 'part_changed' then 'content_changed'
  when o.parts is not null and m.composite is distinct from o.sha256 then 'merge_changed'
  when public.invoice_rename_waiting(f.id) then 'rename_waiting'
  when o.parts is not null and m.why is not null then m.why
  when g.id is null or g.status is distinct from 'ok' or g.refresh_token is null then 'gmail_not_ok'
  when g.account is null or lower(g.account) <> lower(coalesce(q->>'from','')) then 'sender_mismatch'
 end;
 if v_why is not null then return jsonb_build_object('ok', false, 'why', v_why); end if;
 return jsonb_build_object('ok', true, 'to', o.to_address, 'from', g.account, 'attempt_key', o.attempt_key, 'sha256', o.sha256,
  'reserved_at', o.reserved_at, 'file', jsonb_build_object('id', f.id, 'drive_file_id', f.drive_file_id, 'current_name', f.current_name, 'mime_type', f.mime_type,
   'size', (select v.size_bytes from public.invoice_file_versions v where v.file_id=f.id and v.sha256=o.sha256 limit 1)),
  -- the pages, in the order they are joined into one PDF (each one's content is checked against its sha256 before joining)
  'parts', (select jsonb_agg(jsonb_build_object('file_id', pf.id, 'drive_file_id', pf.drive_file_id, 'current_name', pf.current_name, 'mime_type', pf.mime_type,
     'sha256', e->>'sha256', 'part_no', (e->>'part_no')::int) order by (e->>'part_no')::int, pf.id)
   from jsonb_array_elements(o.parts) e join public.invoice_files pf on pf.id=(e->>'file_id')::uuid));
end $$;

-- The Drive bytes are not the content that was posted and queued: the row is set aside (nothing was sent) and the original is
-- checked again soon (a new content goes to review as before). A person is told (content_changed). An invoice of several originals
-- that is not the one queued any more (merge_changed: a page added or taken away) is only set aside: the new one is queued again.
-- A page found in the sent mail already (part_already_sent: alone, or by the forwarder before this ledger) is set aside too: a person
-- records the rest by hand (invoice_qb_manual), it is never sent again as part of the PDF.
create or replace function public.invoice_qb_content_changed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; f public.invoice_files;
begin
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid for update;
 if o.id is null or o.state <> 'sending' or o.reserved_by is distinct from p->>'owner' then return jsonb_build_object('ok', false); end if;
 if p->>'why' in ('merge_changed', 'part_already_sent') then
  update public.invoice_qb_outbox set state='cancelled', last_error=p->>'why', next_at=null, updated_at=now() where id=o.id;
  perform public.invoice_event(null, o.file_id, 'worker', 'qb_' || (p->>'why'), jsonb_build_object('outbox_id', o.id));
  return jsonb_build_object('ok', true);
 end if;
 update public.invoice_qb_outbox set state='cancelled', last_error='content_changed', next_at=null, updated_at=now() where id=o.id;
 update public.invoice_files set drive_checked_at=null where id=o.file_id returning * into f;
 update public.invoice_files set drive_checked_at=null
 where o.parts is not null and id in (select (e->>'file_id')::uuid from jsonb_array_elements(o.parts) e);
 perform public.invoice_event(null, o.file_id, 'worker', 'qb_content_changed', jsonb_build_object('outbox_id', o.id));
 perform public.invoice_qb_alert_put(jsonb_build_object('kind', 'content_changed', 'key', 'content_changed:' || o.id,
  'data', jsonb_build_object('name', f.current_name, 'store', f.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=f.store_id), 'outbox_id', o.id, 'drive_file_id', f.drive_file_id)));
 return jsonb_build_object('ok', true);
end $$;

-- An invoice of several originals entered in QuickBooks by hand (a page of it already went, or a person chose to): recorded here,
-- each original's ledger row written as sent (route 'manual'), so it counts as in QuickBooks and is never sent again. Its send as one
-- PDF that waits is taken back; one under way or with an unknown outcome is settled first; a page already sent is left as it is.
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
 for o in select * from public.invoice_qb_outbox ob where ob.file_id=m.file_id and ob.parts is not null and ob.to_address=q->>'to' and ob.state <> 'cancelled' loop
  if o.state in ('sending','unknown') then raise exception 'qb_in_progress'; end if;
  if o.state in ('pending','error') then
   update public.invoice_qb_outbox set state='cancelled', last_error='manual', next_at=null, updated_at=now() where id=o.id;
  end if;
 end loop;
 -- Each page as it is in the invoice (its content when it was read), whatever its original holds now. A row that waits (or was
 -- taken back when the page was added) becomes the manual entry; a send under way or with an unknown outcome is settled first.
 for fr in select x.file_id, x.sha256 from public.invoice_docs x where x.id=m.id or x.merged_into=m.id order by coalesce(x.part_no, 0) loop
  if exists(select 1 from public.invoice_qb_outbox s where s.state='sent' and s.to_address=q->>'to' and s.parts @> jsonb_build_array(jsonb_build_object('sha256', fr.sha256))) then
   continue;
  end if;
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

-- Accounting reconciliation. Independent of posting; payment, bank and QuickBooks booking are separate.
-- 2026-11-23 (B-3): the answer gives the invoice's original (file_id) so the QuickBooks send is asked for at once (the same
-- conditions as after a posting). stop_qb when a reconciliation is taken back (reconciled → unreconciled or discrepancy) stops the
-- sends of this invoice that have not started (cancelled 'recon_cancelled', queued again when it is reconciled again); a send under
-- way or with an unknown outcome is counted (qb_busy), never undone.
create or replace function public.invoice_reconcile(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; r text := p->>'result'; nq int := 0; nb int := 0;
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
 -- 照合取消 only (a reconciliation taken back): an invoice never reconciled keeps the send its posting asked for (Moto 2026-10-12).
 if r <> 'reconciled' and d.recon_status = 'reconciled' and coalesce((p->>'stop_qb')::boolean, false) then
  with c as (update public.invoice_qb_outbox set state='cancelled', last_error='recon_cancelled', next_at=null, updated_at=now()
             where (file_id=d.file_id or file_id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id)) and state in ('pending','error')
             returning id)
  select count(*) into nq from c;
  if nq > 0 then perform public.invoice_event(d.id, d.file_id, actor::text, 'qb_cancelled', jsonb_build_object('rows', nq, 'why', 'recon_cancelled')); end if;
 end if;
 select count(*) into nb from public.invoice_qb_outbox
 where (file_id=d.file_id or file_id in (select x.file_id from public.invoice_docs x where x.merged_into=d.id)) and state in ('sending','unknown');
 -- file_ids: every original of the invoice in page order (the answer renames them for the new version, as a posting does:
 -- the name is made for the document's id and version, so a reconciliation asks for it again; the name itself does not change).
 return jsonb_build_object('ok', true, 'version', d.version + 1, 'file_id', d.file_id, 'qb_stopped', nq, 'qb_busy', nb,
  'file_ids', (select jsonb_agg(q.fid order by q.o) from (select d.file_id fid, coalesce(d.part_no, 0) o
   union all select x.file_id, x.part_no from public.invoice_docs x where x.merged_into=d.id) q));
end $$;

-- For the screen (照合 and the invoice): each invoice's QuickBooks send in six words. A mail Gmail accepted is 'sent' (送信済み),
-- never "registered in QuickBooks" (QuickBooks' own reading is not seen here).
--   not_sent (未転送, with why) · queued (転送待ち) · sending (処理中) · sent (転送成功) · failed (転送失敗) · unknown (結果確認待ち)
create or replace function public.invoice_qb_doc_states(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; q jsonb := public.invoice_setting('qb'); res jsonb := '{}'::jsonb; v_id text;
 d public.invoice_docs; h public.invoice_docs; o public.invoice_qb_outbox; m record; shas text[]; v_last text; v_cid uuid; rd jsonb;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(p->'doc_ids') is distinct from 'array' or jsonb_array_length(p->'doc_ids') > 200 then raise exception 'bad_value'; end if;
 for v_id in select distinct x from jsonb_array_elements_text(p->'doc_ids') x where x ~ '^[0-9a-fA-F-]{36}$' loop
  select * into d from public.invoice_docs where id=v_id::uuid;
  if d.id is null then continue; end if;
  select * into h from public.invoice_docs where id=coalesce(d.merged_into, d.id);
  shas := array(select x.sha256 from public.invoice_docs x where x.id=h.id or x.merged_into=h.id);
  m := null;
  select * into m from public.invoice_qb_merges() x where x.head_doc=h.id;
  o := null;
  select * into o from public.invoice_qb_outbox ob where ob.to_address=q->>'to' and ob.state<>'cancelled'
   and ob.sha256 = coalesce(m.composite, h.sha256) order by ob.created_at desc limit 1;
  -- an invoice of several originals every page of which is in QuickBooks already (by hand, or in an earlier send)
  if o.id is null and array_length(shas, 1) > 1 and not exists(select 1 from unnest(shas) z where not exists(select 1 from public.invoice_qb_outbox ob
       where ob.state='sent' and ob.to_address=q->>'to' and (ob.sha256=z or ob.parts @> jsonb_build_array(jsonb_build_object('sha256', z))))) then
   select * into o from public.invoice_qb_outbox ob where ob.state='sent' and ob.to_address=q->>'to'
    and (ob.sha256 = any(shas) or exists(select 1 from jsonb_array_elements(coalesce(ob.parts, '[]'::jsonb)) e where e->>'sha256' = any(shas)))
   order by ob.sent_at desc nulls last limit 1;
  end if;
  if o.id is null then
   select ob.id, ob.last_error into v_cid, v_last from public.invoice_qb_outbox ob where ob.to_address=q->>'to' and ob.sha256 = coalesce(m.composite, h.sha256)
    and ob.state='cancelled' order by ob.updated_at desc limit 1;
   rd := public.invoice_qb_ready(h.file_id);
   -- can_retry: 「もう一度送る」 would wait it again now (the same rule as invoice_qb_retry; the screen shows the button only then)
   res := res || jsonb_build_object(d.id::text, jsonb_build_object('state', 'not_sent', 'why', coalesce(v_last, rd->>'why'),
     'cancelled', v_last is not null, 'cancelled_id', v_cid, 'pages', coalesce(array_length(shas, 1), 1),
     'can_retry', coalesce(v_last in ('content_changed','merge_changed','recon_cancelled') and not (rd ? 'why')
       and (v_last <> 'recon_cancelled' or h.recon_status = 'reconciled'), false)));
  else
   res := res || jsonb_build_object(d.id::text, jsonb_build_object('id', o.id,
     'state', case o.state when 'pending' then 'queued' when 'sending' then 'sending' when 'sent' then 'sent' when 'error' then 'failed' else o.state end,
     'manual', o.route = 'manual', 'combined', o.parts is not null, 'attempts', o.attempts, 'stopped', o.state = 'error' and o.attempts >= 5,
     'last_error', o.last_error, 'sent_at', o.sent_at, 'next_at', o.next_at, 'pages', coalesce(array_length(shas, 1), 1),
     'route', o.route, 'can_retry', o.state = 'error' and o.route = 'invoice-intake'));
  end if;
 end loop;
 return jsonb_build_object('enabled', coalesce((q->>'enabled')::boolean, false), 'route', q->>'route', 'states', res);
end $$;

-- 「もう一度送る」 (accounting, 事務Crew, GM, CEO): only a send known not to have gone. A failed try of this system (error, also one
-- stopped at five tries) gets one more; a row taken back before sending (content_changed, merge_changed, recon_cancelled) waits
-- again when the invoice is still the same and ready now. An unknown result is looked up first (qb_lookup / qb_resolve); a sent
-- row is never sent again; the old route's rows are its own.
create or replace function public.invoice_qb_retry(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; o public.invoice_qb_outbox; rd jsonb; q jsonb := public.invoice_setting('qb');
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid for update;
 if o.id is null then raise exception 'not_found'; end if;
 if o.state = 'error' and o.route = 'invoice-intake' then
  update public.invoice_qb_outbox set attempts=least(attempts, 4), next_at=null, updated_at=now() where id=o.id;
 elsif o.state = 'cancelled' and o.last_error in ('content_changed','merge_changed','recon_cancelled') then
  rd := public.invoice_qb_ready(o.file_id);
  -- not sent again now: the answer says why (the screen shows it); nothing is changed
  if rd ? 'why' then return jsonb_build_object('ok', false, 'why', rd->>'why'); end if;
  if 'qb-' || (rd->>'sha256') || '-' || md5(q->>'to') is distinct from o.attempt_key then return jsonb_build_object('ok', false, 'why', 'changed'); end if;
  -- stopped by taking the reconciliation back: sent again only once it is reconciled again (reconciling again also waits it again itself)
  if o.last_error = 'recon_cancelled' and (select x.recon_status from public.invoice_docs x where x.id=(rd->>'doc_id')::uuid) is distinct from 'reconciled' then
   return jsonb_build_object('ok', false, 'why', 'not_reconciled');
  end if;
  update public.invoice_qb_outbox set state='pending', route=q->>'route', attempts=least(attempts, 4), reserved_by=null, reserved_at=null,
   next_at=null, last_error=null, updated_at=now() where id=o.id;
 else raise exception 'invalid_state';
 end if;
 perform public.invoice_event(null, o.file_id, actor::text, 'qb_retry', jsonb_build_object('outbox_id', o.id, 'from', o.state, 'why', o.last_error));
 return jsonb_build_object('ok', true);
end $$;

-- 照合済みだが未転送 (B-3-4): reconciled invoices with no send recorded to this address, each with its ledger history and why.
-- confirmed: the reason is in the data (the start, the route, waiting, stopped, taken back, merged, a person's check pending).
-- confirmed=false: nothing in the ledger explains it (it may have gone by the forwarder before, outside this ledger): the sent mail is
-- looked up before anything is sent (the regular path does it), never sent again only because no row is here.
create or replace function public.invoice_qb_unsent(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; q jsonb := public.invoice_setting('qb'); v_from date;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 v_from := coalesce(nullif(p->>'from','')::date, (public.invoice_qb_since_at() at time zone 'Pacific/Honolulu')::date, (now() at time zone 'Pacific/Honolulu')::date - 90);
 return (with docs as (
   select d.id, d.file_id, d.store_id, d.vendor_name, d.vendor_raw, d.invoice_no, d.invoice_date, d.total_cents, d.recon_by, d.recon_at, d.version, d.sha256,
    f.drive_file_id, f.current_name, f.source, f.drive_created_at,
    array(select x.sha256 from public.invoice_docs x where x.id=d.id or x.merged_into=d.id) shas,
    (select count(*) from public.invoice_docs x where x.merged_into=d.id) npages
   from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
   where d.status='posted' and d.recon_status='reconciled' and d.recon_at >= (v_from::timestamp at time zone 'Pacific/Honolulu')),
  un as (
   select dc.*, public.invoice_qb_ready(dc.file_id) rd,
    (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'state', o.state, 'route', o.route, 'attempts', o.attempts, 'last_error', o.last_error,
       'created_at', o.created_at, 'sent_at', o.sent_at, 'combined', o.parts is not null) order by o.created_at), '[]'::jsonb)
     from public.invoice_qb_outbox o where o.to_address=q->>'to' and (o.file_id=dc.file_id or o.sha256 = any(dc.shas)
       or exists(select 1 from jsonb_array_elements(coalesce(o.parts, '[]'::jsonb)) e where e->>'sha256' = any(dc.shas)))) hist
   from docs dc
   where exists(select 1 from unnest(dc.shas) z where not exists(select 1 from public.invoice_qb_outbox ob where ob.state='sent' and ob.to_address=q->>'to'
     and (ob.sha256=z or ob.parts @> jsonb_build_array(jsonb_build_object('sha256', z)))))
    and not exists(select 1 from public.invoice_qb_outbox ob where ob.state='sent' and ob.to_address=q->>'to' and ob.parts is not null and ob.file_id=dc.file_id
     and ob.parts @> (select jsonb_agg(jsonb_build_object('sha256', z)) from unnest(dc.shas) z))),
  cl as (
   select un.*,
    (select h->>'state' from jsonb_array_elements(un.hist) h where h->>'state' <> 'cancelled' order by h->>'created_at' desc limit 1) live,
    (select h->>'last_error' from jsonb_array_elements(un.hist) h where h->>'state' = 'cancelled' order by h->>'created_at' desc limit 1) took
   from un)
  select jsonb_build_object('from', v_from, 'to_set', coalesce(q->>'to', '') <> '', 'enabled', coalesce((q->>'enabled')::boolean, false), 'route', q->>'route',
   'rows', coalesce(jsonb_agg(jsonb_build_object('doc_id', cl.id, 'store_id', cl.store_id, 'vendor', coalesce(cl.vendor_name, cl.vendor_raw), 'invoice_no', cl.invoice_no,
     'invoice_date', cl.invoice_date, 'total_cents', cl.total_cents, 'recon_by', cl.recon_by, 'recon_at', cl.recon_at, 'version', cl.version,
     'drive_file_id', cl.drive_file_id, 'current_name', cl.current_name, 'pages', cl.npages + 1, 'history', cl.hist,
     'reason', case
       when cl.live = 'pending' then 'queued'
       when cl.live = 'sending' then 'sending'
       when cl.live = 'unknown' then 'unknown'
       when cl.live = 'error' then 'failed'
       when cl.took is not null and cl.took in ('content_changed','merge_changed','recon_cancelled','manual','multi_file','part_already_sent') and cl.rd->>'why' is null then 'cancelled_' || cl.took
       when cl.rd->>'why' is not null then cl.rd->>'why'
       when not coalesce((q->>'enabled')::boolean, false) then 'qb_off'
       else 'not_in_ledger' end,
     'confirmed', case when cl.live is not null and cl.live <> 'unknown' then true
       when cl.live = 'unknown' then false
       when cl.took is not null and cl.rd->>'why' is null then true
       when cl.rd->>'why' in ('before_since','not_new_intake') then false
       when cl.rd->>'why' is not null then true
       when not coalesce((q->>'enabled')::boolean, false) then true
       else false end) order by cl.recon_at), '[]'::jsonb),
   'count', count(*)) from cl);
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_qb_merges()','invoice_qb_ready(uuid)','invoice_qb_doc_states(jsonb)','invoice_qb_retry(jsonb)','invoice_qb_unsent(jsonb)',
   'invoice_qb_enqueue(jsonb)','invoice_qb_candidates(jsonb)','invoice_qb_send_context(jsonb)','invoice_qb_content_changed(jsonb)','invoice_qb_manual(jsonb)',
   'invoice_reconcile(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
