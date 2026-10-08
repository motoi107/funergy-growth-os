-- Invoice intake: invoices put right in the store folder are read too, not only those in 00_Upload (Moto 2026-10-08).
-- Apply on a database that already has 20261007090000, 20261007160000 and 20261007200000.
-- Only invoice_file_seen is replaced (same name and arguments, so the existing grant stays: service_role only).
-- No table, setting or record is changed by this file.
--   A file seen in an active store's folder (root_folder_id) is taken in like one in its 00_Upload, but only when it was
--   put there at or after the start of the intake (mode.start_at); older files there are left alone and not recorded.
--   Nothing is taken from the store folder while no start is set. The worker reads only the files directly in the
--   store folder (never the folders in it) and leaves those originals where they are.

create or replace function public.invoice_file_seen(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.invoice_stores; f public.invoice_files; act text; start_at timestamptz;
begin
 -- A store's 00_Upload, or (Moto 2026-10-08) the store folder itself: staff also put invoices right in it.
 select * into s from public.invoice_stores where active and (upload_folder_id=p->>'folder_id' or root_folder_id=p->>'folder_id')
 order by (upload_folder_id is not distinct from p->>'folder_id') desc limit 1;
 if s.store_id is null then raise exception 'folder_not_configured'; end if;
 select * into f from public.invoice_files where drive_file_id=p->>'drive_file_id' for update;
 if f.id is null then
  -- The store folder also keeps older invoices: from it, only files put there at or after the start are taken in.
  if s.upload_folder_id is distinct from p->>'folder_id' then
   start_at := nullif(public.invoice_setting('mode')->>'start_at', '')::timestamptz;
   if start_at is null or nullif(p->>'created_time', '') is null or (p->>'created_time')::timestamptz < start_at then
    return jsonb_build_object('file_id', null, 'action', 'before_start', 'status', null);
   end if;
  end if;
  insert into public.invoice_files(drive_file_id, store_id, source, original_name, current_name, mime_type, size_bytes,
   drive_created_at, drive_modified_at, drive_md5, parent_ids, submitter)
  values(p->>'drive_file_id', s.store_id, coalesce(p->>'source','drive'), p->>'name', p->>'name', p->>'mime_type', (p->>'size')::bigint,
   (p->>'created_time')::timestamptz, (p->>'modified_time')::timestamptz, p->>'md5',
   coalesce(array(select jsonb_array_elements_text(p->'parents')), '{}'), nullif(p->>'submitter',''))
  returning * into f;
  perform public.invoice_event(null, f.id, 'worker', 'file_seen', jsonb_build_object('name', f.original_name, 'store', s.store_id));
  return jsonb_build_object('file_id', f.id, 'action', 'new', 'status', f.intake_status);
 end if;
 if f.store_id <> s.store_id and f.store_assigned_by is null then
  -- Moved into another store's folder: never reassign. Flag it for a person.
  update public.invoice_files set drive_state='moved_store', updated_at=now() where id=f.id;
  perform public.invoice_event(null, f.id, 'worker', 'moved_between_stores', jsonb_build_object('from', f.store_id, 'to', s.store_id));
  return jsonb_build_object('file_id', f.id, 'action', 'store_conflict', 'status', f.intake_status);
 end if;
 act := case when f.drive_md5 is distinct from (p->>'md5') then 'content_changed'
             when f.current_name is distinct from (p->>'name') then 'renamed' else 'same' end;
 update public.invoice_files set current_name=coalesce(p->>'name', current_name), drive_modified_at=(p->>'modified_time')::timestamptz,
  drive_md5=coalesce(p->>'md5', drive_md5), size_bytes=coalesce((p->>'size')::bigint, size_bytes),
  parent_ids=coalesce(array(select jsonb_array_elements_text(p->'parents')), parent_ids),
  drive_state=case when drive_state in ('missing','trashed','permission_lost') then 'ok' else drive_state end,
  intake_status=case when act='content_changed' and intake_status not in ('processing') then 'pending' else intake_status end,
  updated_at=now()
 where id=f.id;
 if act<>'same' then perform public.invoice_event(null, f.id, 'worker', 'file_'||act, jsonb_build_object('name', p->>'name')); end if;
 return jsonb_build_object('file_id', f.id, 'action', act, 'status', f.intake_status, 'sha256', f.current_sha256);
end $$;
