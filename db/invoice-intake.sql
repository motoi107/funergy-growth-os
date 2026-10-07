-- Invoice intake from per-store Google Drive folders.
-- All tables are service-role only. Browsers never read or write them directly;
-- the invoice-intake Edge Function authenticates people (Supabase Auth +
-- manager_auth) and the scheduled worker (a key held in invoice_settings).
-- Originals stay in Google Drive. Nothing here deletes a Drive file.

create table public.invoice_settings(
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now(),
 updated_by text
);

-- Store <-> Drive folder table. The store of an invoice is the store whose
-- 00_Upload folder received it; the printed address can only confirm it.
create table public.invoice_stores(
 store_id text primary key,
 label text not null check (label ~ '^[A-Za-z0-9-]{1,24}$'),
 root_folder_id text unique,
 upload_folder_id text unique,
 active boolean not null default false,
 auto_post boolean not null default false,
 aliases text[] not null default '{}',
 address_group text,
 reviewer text,
 updated_at timestamptz not null default now(),
 updated_by text
);

create table public.invoice_folders(
 id text primary key,
 parent_id text not null,
 name text not null,
 store_id text not null references public.invoice_stores(store_id),
 role text not null check (role in ('year','month','unreconciled','reconciled')),
 created_by_worker boolean not null default false,
 created_at timestamptz not null default now(),
 unique(parent_id, name)
);

create table public.invoice_files(
 id uuid primary key default gen_random_uuid(),
 drive_file_id text not null unique,
 store_id text not null references public.invoice_stores(store_id),
 source text not null default 'drive' check (source in ('drive','app','backfill')),
 original_name text not null,
 current_name text not null,
 mime_type text,
 size_bytes bigint,
 drive_created_at timestamptz,
 drive_modified_at timestamptz,
 drive_md5 text,
 parent_ids text[] not null default '{}',
 submitter text,                 -- only what Drive reports; never guessed
 submitter_note text,            -- added by a manager when the submitter is unknown
 current_sha256 text,
 intake_status text not null default 'pending'
  check (intake_status in ('pending','processing','review','posted','error','duplicate','unsupported','archived')),
 organize_status text not null default 'none' check (organize_status in ('none','pending','done','error','hold')),
 organize_target text check (organize_target in ('unreconciled','reconciled')),
 organized_folder_id text,
 organize_attempts integer not null default 0,
 organize_error text,
 organize_next_at timestamptz,
 drive_state text not null default 'ok' check (drive_state in ('ok','missing','trashed','permission_lost','moved_store')),
 store_assigned_by text,         -- set when a person assigned the store (the file may still sit in another store's folder)
 drive_checked_at timestamptz,
 lease_owner text,
 lease_until timestamptz,
 attempts integer not null default 0,
 last_error text,
 next_attempt_at timestamptz,
 ingested_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index invoice_files_status on public.invoice_files(intake_status, next_attempt_at);

create table public.invoice_file_versions(
 file_id uuid not null references public.invoice_files(id),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 drive_md5 text,
 size_bytes bigint,
 seen_at timestamptz not null default now(),
 primary key(file_id, sha256)
);
create index invoice_file_versions_sha on public.invoice_file_versions(sha256);

-- One AI reading per content hash and prompt version: unchanged files are never read twice.
create table public.invoice_extractions(
 sha256 text not null,
 prompt_version text not null,
 model text,
 raw jsonb not null,
 created_at timestamptz not null default now(),
 primary key(sha256, prompt_version)
);

create table public.invoice_vendor_rules(
 vendor_key text primary key,
 display_name text not null,
 aliases text[] not null default '{}',
 food_kind text check (food_kind in ('food','nonfood')),
 auto_post boolean not null default false,
 verified_by text,
 verified_at timestamptz,
 updated_at timestamptz not null default now()
);

create table public.invoice_docs(
 id uuid primary key default gen_random_uuid(),
 source_key text not null unique,
 file_id uuid not null references public.invoice_files(id),
 sha256 text not null,
 doc_index integer not null default 0,
 internal_no text not null unique,
 store_id text not null references public.invoice_stores(store_id),
 doc_type text not null check (doc_type in ('invoice','credit_memo','statement','receipt','other','unknown')),
 posting_kind text not null check (posting_kind in ('purchase','none')),
 vendor_key text, vendor_name text, vendor_raw text, vendor_code text,
 food_kind text,
 invoice_no text, invoice_no_norm text,
 invoice_date date, delivery_date date, due_date date, posting_date date, effective_date date,
 effective_basis text check (effective_basis in ('delivery','invoice')),
 currency text,
 subtotal_cents bigint, discount_cents bigint, tax_cents bigint, shipping_cents bigint, other_cents bigint, total_cents bigint,
 lines_sum_cents bigint,
 other_charges jsonb not null default '[]',
 ship_to_raw text,
 pages integer[] not null default '{}',
 pages_marked text[] not null default '{}',
 references_raw jsonb not null default '[]',
 content_sig text,
 status text not null default 'review' check (status in ('review','posted','rejected','superseded','duplicate')),
 reasons jsonb not null default '[]',
 auto_eligible boolean not null default false,
 posted_at timestamptz, posted_by text, posted_mode text check (posted_mode in ('auto','manual')),
 duplicate_of uuid references public.invoice_docs(id),
 related_doc_id uuid references public.invoice_docs(id),
 relation text check (relation in ('credit_for','payment_for','correction_of','statement_covers')),
 recon_status text not null default 'unreconciled' check (recon_status in ('unreconciled','discrepancy','reconciled')),
 recon_by text, recon_at timestamptz, recon_note text, recon_diff jsonb,
 needs_adjustment boolean not null default false,
 ai jsonb,                         -- what the AI transcribed (never changed)
 overrides jsonb not null default '{}',   -- what people changed, with who/when/why
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- A posted purchase can exist once per store, vendor, type and number, and once per content hash.
create unique index invoice_docs_posted_number on public.invoice_docs(store_id, vendor_key, doc_type, invoice_no_norm)
 where status='posted' and invoice_no_norm is not null;
create unique index invoice_docs_posted_sha on public.invoice_docs(sha256, doc_index) where status='posted' and posting_kind='purchase';
create index invoice_docs_lookup on public.invoice_docs(vendor_key, invoice_no_norm);
create index invoice_docs_date on public.invoice_docs(store_id, invoice_date);

create table public.invoice_lines(
 id uuid primary key default gen_random_uuid(),
 doc_id uuid not null references public.invoice_docs(id),
 line_no integer not null,
 page integer,
 item_code text,
 raw_name text not null,
 raw jsonb not null,                  -- the transcription exactly as returned
 qty numeric(18,6),
 purchase_unit text,
 spec text, spec_key text not null default '',
 unit_price numeric(18,6),
 line_discount_cents bigint,
 amount_cents bigint,
 weight text, weight_unit text, price_unit text,
 taxable boolean,
 map_id uuid,
 ingredient_code text,
 count_unit text, count_per_purchase numeric(18,6),
 base_unit text, base_per_purchase numeric(18,6),
 price_per_purchase numeric(18,6),
 price_per_count numeric(24,10),
 price_per_base numeric(24,10),
 prev_price jsonb,
 reasons jsonb not null default '[]',
 overrides jsonb not null default '{}',
 unique(doc_id, line_no)
);
create index invoice_lines_name on public.invoice_lines(ingredient_code);

-- Vendor product code / alias / spec / purchase unit -> existing product master code.
create table public.invoice_item_maps(
 id uuid primary key default gen_random_uuid(),
 vendor_key text not null,
 store_id text,
 vendor_item_code text,
 alias_key text,
 spec_key text not null default '',
 purchase_unit text not null default '',
 ingredient_code text not null,
 count_unit text,
 count_per_purchase numeric(18,6) check (count_per_purchase is null or count_per_purchase > 0),
 base_unit text check (base_unit is null or base_unit in ('g','ml','ea')),
 base_per_purchase numeric(18,6) check (base_per_purchase is null or base_per_purchase > 0),
 verified boolean not null default false,
 verified_by text, verified_at timestamptz,
 auto_post boolean not null default false,
 source text not null default 'manual' check (source in ('manual','master_seed','review')),
 note text,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 check (vendor_item_code is not null or alias_key is not null),
 check (not auto_post or verified)
);
create unique index invoice_item_maps_key on public.invoice_item_maps(vendor_key, coalesce(store_id,''), coalesce(vendor_item_code,''), coalesce(alias_key,''), spec_key, purchase_unit);

create table public.invoice_price_history(
 id bigint generated always as identity primary key,
 store_id text not null,
 vendor_key text not null,
 ingredient_code text not null,
 spec_key text not null default '',
 purchase_unit text not null default '',
 doc_id uuid not null references public.invoice_docs(id),
 line_id uuid not null references public.invoice_lines(id),
 effective_date date not null,
 effective_basis text not null,
 invoice_date date,
 invoice_no_norm text,
 price_per_purchase numeric(18,6) not null,
 price_per_count numeric(24,10),
 count_unit text,
 price_per_base numeric(24,10),
 base_unit text,
 conversion jsonb not null default '{}',
 status text not null default 'active' check (status in ('active','voided')),
 created_by text not null,
 reason text,
 voided_by text, voided_at timestamptz, void_reason text,
 created_at timestamptz not null default now()
);
create unique index invoice_price_history_line on public.invoice_price_history(line_id) where status='active';
create index invoice_price_history_key on public.invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, effective_date);

create table public.invoice_events(
 id bigint generated always as identity primary key,
 doc_id uuid references public.invoice_docs(id),
 file_id uuid references public.invoice_files(id),
 actor text not null,
 kind text not null,
 data jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index invoice_events_doc on public.invoice_events(doc_id, id);

-- QuickBooks forwarding ledger: one row per original content and destination.
create table public.invoice_qb_outbox(
 id uuid primary key default gen_random_uuid(),
 file_id uuid not null references public.invoice_files(id),
 sha256 text not null,
 to_address text not null,
 route text not null,
 state text not null default 'pending' check (state in ('pending','sending','sent','error','unknown','cancelled')),
 attempt_key text not null unique,
 attempts integer not null default 0,
 reserved_by text, reserved_at timestamptz,
 sent_at timestamptz,
 message_id text,
 result jsonb,
 last_error text,
 next_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index invoice_qb_outbox_once on public.invoice_qb_outbox(sha256, to_address) where state<>'cancelled';

create table public.invoice_leases(name text primary key, owner text not null, until timestamptz not null);

create table public.invoice_runs(
 id bigint generated always as identity primary key,
 kind text not null,
 store_id text,
 started_at timestamptz not null,
 finished_at timestamptz not null default now(),
 ok boolean not null,
 stats jsonb not null default '{}',
 error text
);
create index invoice_runs_kind on public.invoice_runs(kind, store_id, finished_at desc);

create table public.invoice_app_mirror(
 doc_id uuid primary key references public.invoice_docs(id),
 app_inv_id text not null unique,
 store_id text not null,
 state text not null check (state in ('mirrored','tombstoned','held','error')),
 hash text,
 error text,
 updated_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['invoice_settings','invoice_stores','invoice_folders','invoice_files','invoice_file_versions','invoice_extractions',
  'invoice_vendor_rules','invoice_docs','invoice_lines','invoice_item_maps','invoice_price_history','invoice_events','invoice_qb_outbox',
  'invoice_leases','invoice_runs','invoice_app_mirror'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update on public.%I to service_role', t);
 end loop;
end $$;
-- Nothing is ever deleted by the worker or the API; corrections are new rows or state changes.

insert into public.invoice_settings(key, value) values
 ('worker', jsonb_build_object('key', replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''), 'enabled', false)),
 ('mode', jsonb_build_object('intake', false, 'auto_post', false, 'organize', false, 'mirror', false, 'start_at', null, 'pilot_stores', '[]'::jsonb)),
 ('rules', jsonb_build_object('price_jump_pct', 15, 'total_tolerance_cents', 0, 'line_tolerance_cents', 0,
   'currency_when_absent', null, 'discount_allocation', null, 'closed_through', null, 'max_file_mb', 20, 'batch', 5)),
 ('qb', jsonb_build_object('to', 'funergy+expenses@assist.intuit.com', 'since', '2026-09-29', 'route', null, 'enabled', false)),
 -- The existing forwarding (run outside this system) reads and records through this key when qb.route = 'external'.
 ('qb_external', jsonb_build_object('key', replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''), 'enabled', false))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- helpers
create function public.invoice_actor_role(p_actor uuid) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select role from public.manager_auth where user_id=p_actor and role in ('ceo','gm','office','office_crew');
$$;

create function public.invoice_require(p_actor uuid, p_roles text[]) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r text;
begin
 if p_actor is null then raise exception 'actor_required'; end if;
 r := public.invoice_actor_role(p_actor);
 if r is null or not (r = any(p_roles)) then raise exception 'forbidden'; end if;
 return r;
end $$;

create function public.invoice_setting(p_key text) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce((select value from public.invoice_settings where key=p_key), '{}'::jsonb);
$$;

create function public.invoice_event(p_doc uuid, p_file uuid, p_actor text, p_kind text, p_data jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.invoice_events(doc_id, file_id, actor, kind, data) values(p_doc, p_file, coalesce(p_actor,'system'), p_kind, coalesce(p_data,'{}'));
$$;

-- ---------------------------------------------------------------- worker steps
create function public.invoice_lease(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o text;
begin
 if coalesce((p->>'release')::boolean,false) then
  update public.invoice_leases set until=now() - interval '1 second' where name=p->>'name' and owner=p->>'owner';
  return jsonb_build_object('ok', true);
 end if;
 insert into public.invoice_leases(name, owner, until)
 values(p->>'name', p->>'owner', now() + make_interval(secs => coalesce((p->>'seconds')::int, 300)))
 on conflict(name) do update set owner=excluded.owner, until=excluded.until
  where public.invoice_leases.until < now() or public.invoice_leases.owner = excluded.owner
 returning owner into o;
 return jsonb_build_object('ok', o is not null);
end $$;

-- A file listed in a store's 00_Upload folder. Renames and moves never cause a new reading.
create function public.invoice_file_seen(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.invoice_stores; f public.invoice_files; act text;
begin
 select * into s from public.invoice_stores where upload_folder_id=p->>'folder_id' and active;
 if s.store_id is null then raise exception 'folder_not_configured'; end if;
 select * into f from public.invoice_files where drive_file_id=p->>'drive_file_id' for update;
 if f.id is null then
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

-- Claims a file for processing. Several workers can run; only one holds a file.
create function public.invoice_file_claim(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.invoice_files;
begin
 update public.invoice_files set lease_owner=p->>'owner', lease_until=now()+interval '10 minutes', intake_status='processing',
  attempts=attempts+1, updated_at=now()
 where id=(p->>'file_id')::uuid and intake_status in ('pending','error','processing')
  and (lease_until is null or lease_until < now() or lease_owner=p->>'owner')
  and (next_attempt_at is null or next_attempt_at <= now())
 returning * into f;
 return jsonb_build_object('ok', f.id is not null, 'attempts', f.attempts);
end $$;

create function public.invoice_file_fail(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.invoice_files; st text := coalesce(p->>'status','error');
begin
 if st not in ('error','unsupported') then raise exception 'bad_status'; end if;
 update public.invoice_files set intake_status=st, last_error=left(p->>'error',300), lease_owner=null, lease_until=null,
  next_attempt_at=case when st='error' then now() + make_interval(mins => least(240, 5 * power(2, least(attempts,6))::int)) end, updated_at=now()
 where id=(p->>'file_id')::uuid and lease_owner=p->>'owner' returning * into f;
 if f.id is null then return jsonb_build_object('ok', false); end if;
 perform public.invoice_event(null, f.id, 'worker', 'file_'||st, jsonb_build_object('error', left(p->>'error',300)));
 return jsonb_build_object('ok', true);
end $$;

create function public.invoice_file_version(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n int; others jsonb;
begin
 insert into public.invoice_file_versions(file_id, sha256, drive_md5, size_bytes)
 values((p->>'file_id')::uuid, p->>'sha256', p->>'md5', (p->>'size')::bigint) on conflict do nothing;
 get diagnostics n = row_count;
 update public.invoice_files set current_sha256=p->>'sha256', updated_at=now() where id=(p->>'file_id')::uuid;
 select coalesce(jsonb_agg(distinct v.file_id), '[]') into others from public.invoice_file_versions v
  where v.sha256=p->>'sha256' and v.file_id<>(p->>'file_id')::uuid;
 return jsonb_build_object('new_version', n>0, 'same_bytes_files', others);
end $$;

create function public.invoice_extraction(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb;
begin
 if p ? 'raw' then
  insert into public.invoice_extractions(sha256, prompt_version, model, raw) values(p->>'sha256', p->>'prompt_version', p->>'model', p->'raw')
  on conflict do nothing;
 end if;
 select raw into r from public.invoice_extractions where sha256=p->>'sha256' and prompt_version=p->>'prompt_version';
 return r;   -- first stored reading wins; a retry never replaces it
end $$;

-- Documents already stored that a new one must be compared with.
create function public.invoice_dup_scope(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'file_id',d.file_id,'status',d.status,'store_id',d.store_id,'vendor_key',d.vendor_key,
  'invoice_no_norm',d.invoice_no_norm,'invoice_date',d.invoice_date,'total_cents',d.total_cents,'content_sig',d.content_sig,'sha256',d.sha256,'duplicate_of',d.duplicate_of)), '[]')
 from public.invoice_docs d
 where d.status in ('review','posted','duplicate')
  and (d.sha256=p->>'sha256'
   or (d.vendor_key=p->>'vendor_key' and d.invoice_no_norm=p->>'invoice_no_norm')
   or (d.vendor_key=p->>'vendor_key' and d.store_id=p->>'store_id' and d.invoice_date=(p->>'invoice_date')::date and d.total_cents=(p->>'total_cents')::bigint));
$$;

-- Nearest earlier verified price for the same store, vendor, product, spec and unit.
create function public.invoice_price_ref(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select to_jsonb(x) from (
  select h.price_per_purchase::text price_per_purchase, h.price_per_base::text price_per_base, h.base_unit, h.effective_date, h.doc_id, h.invoice_no_norm
  from public.invoice_price_history h
  where h.status='active' and h.store_id=p->>'store_id' and h.vendor_key=p->>'vendor_key' and h.ingredient_code=p->>'ingredient_code'
   and h.spec_key=coalesce(p->>'spec_key','') and h.purchase_unit=coalesce(p->>'purchase_unit','')
   and h.effective_date < (p->>'before')::date
  order by h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc limit 1) x;
$$;

create function public.invoice_stage(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; h jsonb := p->'header'; l jsonb; i int := 0; dup uuid; st text; prior text;
 rs jsonb := coalesce(p->'reasons','[]'); auto boolean := coalesce((p->>'auto_eligible')::boolean,false);
begin
 select * into d from public.invoice_docs where source_key=p->>'source_key';
 if d.id is not null then return jsonb_build_object('doc_id', d.id, 'existed', true, 'version', d.version, 'status', d.status); end if;
 -- The same Drive file read before with other content (overwritten in Drive): the new version always waits for a person,
 -- who supersedes the earlier version, marks this one as a duplicate, or confirms that both stand.
 select string_agg(o.internal_no, ',' order by o.internal_no) into prior from public.invoice_docs o
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

-- Sets the file's intake status from its documents once staging is complete.
create function public.invoice_file_settle(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f uuid := (p->>'file_id')::uuid; st text;
begin
 select case
   when bool_or(status='review') then 'review'
   when bool_and(status='duplicate') then 'duplicate'
   when bool_and(status in ('posted','duplicate','rejected','superseded')) and bool_or(status='posted') then 'posted'
   else 'review' end into st
 from public.invoice_docs where file_id=f and sha256=(select current_sha256 from public.invoice_files where id=f);
 if p ? 'status' then st := p->>'status'; end if;
 update public.invoice_files set intake_status=coalesce(st,'review'), lease_owner=null, lease_until=null, last_error=null, next_attempt_at=null, updated_at=now()
 where id=f and (lease_owner=p->>'owner' or (p->>'owner' is null and intake_status not in ('pending','processing')));
 return jsonb_build_object('status', st);
end $$;

-- Price history row for one line, only from a verified mapping and clean values.
-- Credit memos, statements and receipts never set prices.
create function public.invoice_price_insert(p_doc uuid, p_line uuid, p_who text, p_reason text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; l public.invoice_lines; im public.invoice_item_maps;
begin
 select * into d from public.invoice_docs where id=p_doc;
 select * into l from public.invoice_lines where id=p_line and doc_id=p_doc;
 if d.doc_type<>'invoice' or l.id is null or l.ingredient_code is null or l.price_per_purchase is null or d.effective_date is null then return false; end if;
 select * into im from public.invoice_item_maps where id=l.map_id and verified and vendor_key=d.vendor_key and (store_id is null or store_id=d.store_id);
 if im.id is null or im.ingredient_code<>l.ingredient_code then return false; end if;
 if l.reasons ?| array['catch_weight','line_math','zero_price','negative_line','line_value_missing','unit_mismatch','unit_unverified','spec_changed','map_ambiguous','unmapped'] then return false; end if;
 insert into public.invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, doc_id, line_id, effective_date,
  effective_basis, invoice_date, invoice_no_norm, price_per_purchase, price_per_count, count_unit, price_per_base, base_unit, conversion, created_by, reason)
 values(d.store_id, d.vendor_key, l.ingredient_code, coalesce(nullif(im.spec_key,''), l.spec_key, ''), coalesce(nullif(im.purchase_unit,''), l.purchase_unit, ''),
  d.id, l.id, d.effective_date, d.effective_basis, d.invoice_date, d.invoice_no_norm, l.price_per_purchase, l.price_per_count, im.count_unit,
  l.price_per_base, im.base_unit, jsonb_build_object('map_id', im.id, 'count_per_purchase', im.count_per_purchase, 'base_per_purchase', im.base_per_purchase,
   'count_unit', im.count_unit, 'base_unit', im.base_unit), p_who, p_reason);
 return true;
end $$;

-- Posts one document as a whole: purchase and price history in one transaction, or nothing.
create function public.invoice_post(p jsonb) returns jsonb
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

-- A person's correction. The AI value stays in ai/raw; overrides keep old and new values with who and why.
create function public.invoice_edit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; actor uuid := nullif(p->>'actor','')::uuid; e jsonb; f text; v jsonb; ov jsonb; lid uuid;
 lrow public.invoice_lines; closed text; touched_price boolean := false; affects boolean := false; chg jsonb := '[]';
 money_fields text[] := array['invoice_date','delivery_date','total_cents','subtotal_cents','tax_cents','shipping_cents','discount_cents','other_cents',
  'vendor_key','invoice_no','doc_type','effective_date'];
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
  ov := ov || jsonb_build_object(f, jsonb_build_object('old', to_jsonb(d)->f, 'new', v, 'by', actor, 'at', now(), 'reason', p->>'reason'));
  chg := chg || jsonb_build_array(jsonb_build_object('field', f, 'old', to_jsonb(d)->f, 'new', v));
 end loop;
 touched_price := exists(select 1 from jsonb_array_elements(coalesce(p->'lines','[]')) ln where jsonb_typeof(ln->'set')='object' and ln->'set' <> '{}'::jsonb);
 -- A posted document stays posted only if the corrected values would pass posting: no must-fix reason, and a new or changed
 -- mismatch is acknowledged by the person (a mismatch accepted when it was posted, unchanged, needs nothing more).
 if d.status='posted' and (affects or touched_price) then
  select r->>'code' into blocking from jsonb_array_elements(coalesce(p->'reasons', d.reasons)) r where r->>'code' = any(must_fix) limit 1;
  if blocking is not null then raise exception 'blocked:%', blocking; end if;
  select r->>'code' into blocking from jsonb_array_elements(coalesce(p->'reasons', d.reasons)) r
  where r->>'code' = any(may_ack) and not (r->>'code' = any(ack)) and not (d.reasons @> jsonb_build_array(r)) limit 1;
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

create function public.invoice_mark(p jsonb) returns jsonb
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

create function public.invoice_relate(p jsonb) returns jsonb
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

-- Accounting reconciliation. Independent of posting; payment, bank and QuickBooks booking are separate.
create function public.invoice_reconcile(p jsonb) returns jsonb
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

-- Result of a rename/move in Drive. Failure keeps the reconciliation and is retried.
create function public.invoice_organize_result(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.invoice_files;
begin
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid for update;
 if f.id is null then raise exception 'not_found'; end if;
 if coalesce((p->>'ok')::boolean,false) then
  update public.invoice_files set organize_status=case when organize_target=(p->>'target') then 'done' else organize_status end,
   organized_folder_id=p->>'folder_id', current_name=coalesce(p->>'name', current_name),
   parent_ids=array[p->>'folder_id'], organize_error=null, organize_next_at=null, updated_at=now()
  where id=f.id;
 else
  update public.invoice_files set organize_status='error', organize_attempts=organize_attempts+1, organize_error=left(p->>'error',300),
   organize_next_at=now() + make_interval(mins => least(720, 10 * power(2, least(organize_attempts,6))::int)), updated_at=now()
  where id=f.id;
 end if;
 perform public.invoice_event(null, f.id, 'worker', case when coalesce((p->>'ok')::boolean,false) then 'organized' else 'organize_failed' end,
  jsonb_build_object('target', p->>'target', 'name', p->>'name', 'error', left(p->>'error',300)));
 return jsonb_build_object('ok', true);
end $$;

create function public.invoice_drive_status(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.invoice_files; s text := p->>'drive_state';
begin
 if s not in ('ok','missing','trashed','permission_lost') then raise exception 'bad_state'; end if;
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid for update;
 if f.id is null then raise exception 'not_found'; end if;
 -- Purchase data is never removed because the original disappeared; the problem is shown instead.
 update public.invoice_files set drive_state=s, drive_checked_at=now(),
  current_name=coalesce(p->>'name', current_name), parent_ids=coalesce(array(select jsonb_array_elements_text(p->'parents')), parent_ids), updated_at=now()
 where id=f.id;
 if s <> f.drive_state then perform public.invoice_event(null, f.id, 'worker', 'drive_'||s, '{}'); end if;
 return jsonb_build_object('ok', true, 'changed', s <> f.drive_state);
end $$;

-- ---------------------------------------------------------------- QuickBooks forwarding ledger
create function public.invoice_qb_enqueue(p jsonb) returns jsonb
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

create function public.invoice_qb_reserve(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox;
begin
 update public.invoice_qb_outbox set state='sending', attempts=attempts+1, reserved_by=p->>'owner', reserved_at=now(), updated_at=now()
 where id=(select id from public.invoice_qb_outbox where state in ('pending','error') and (next_at is null or next_at<=now())
            and attempts < 5 and route='invoice-intake' order by created_at limit 1 for update skip locked)
 returning * into o;
 return case when o.id is null then null else to_jsonb(o) end;
end $$;

-- A send whose outcome is unknown stays "unknown" until the sender's records are checked; it is never resent blindly.
create function public.invoice_qb_result(p jsonb) returns jsonb
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

-- ---------------------------------------------------------------- reading
create function public.invoice_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; r jsonb; total int; sum_cents bigint;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 with q as (
  select d.id, d.store_id, d.doc_type, d.vendor_name, d.vendor_raw, d.invoice_no, d.invoice_date, d.delivery_date, d.total_cents,
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
  coalesce((select jsonb_agg(to_jsonb(x) order by x.invoice_date desc nulls first, x.ingested_at desc) from
   (select * from q order by invoice_date desc nulls first, ingested_at desc
    limit least(coalesce((p->>'limit')::int,50),200) offset coalesce((p->>'offset')::int,0)) x), '[]')
 into total, sum_cents, r;
 return jsonb_build_object('rows', r, 'total', total, 'sum_cents', sum_cents);
end $$;

create function public.invoice_get(p jsonb) returns jsonb
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
  -- The AI's transcription of this document, shown beside the values in use (never changed).
  'ai_doc', (select e.raw->'documents'->d.doc_index from public.invoice_extractions e
             where e.sha256=d.sha256 and e.prompt_version=d.ai->>'prompt_version' limit 1));
end $$;

-- Latest verified price per store/vendor/product/spec/unit. Order: delivery date (or invoice
-- date when no delivery date), then invoice date, then invoice number, then posting order.
-- Upload time is never used.
create function public.invoice_latest_prices(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select distinct on (h.store_id, h.vendor_key, h.ingredient_code, h.spec_key, h.purchase_unit)
   h.store_id, h.vendor_key, h.ingredient_code, h.spec_key, h.purchase_unit, h.price_per_purchase::text price_per_purchase,
   h.price_per_count::text price_per_count, h.count_unit, h.price_per_base::text price_per_base, h.base_unit, h.effective_date, h.effective_basis,
   h.doc_id, h.line_id, h.invoice_no_norm, h.invoice_date
  from public.invoice_price_history h
  where h.status='active' and (jsonb_typeof(p->'stores') is distinct from 'array' or h.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
   and (jsonb_typeof(p->'codes') is distinct from 'array' or h.ingredient_code in (select jsonb_array_elements_text(case when jsonb_typeof(p->'codes')='array' then p->'codes' else '[]'::jsonb end)))
  order by h.store_id, h.vendor_key, h.ingredient_code, h.spec_key, h.purchase_unit,
   h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc) x;
$$;

create function public.invoice_health(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 if actor is not null then perform public.invoice_require(actor, array['ceo','gm','office','office_crew']); end if;
 return jsonb_build_object(
  'last_ok', (select max(finished_at) from public.invoice_runs where kind='intake' and ok),
  'last_run', (select to_jsonb(r) from public.invoice_runs r where kind='intake' order by id desc limit 1),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', s.store_id, 'label', s.label, 'active', s.active, 'auto_post', s.auto_post,
     'root_folder_id', s.root_folder_id, 'upload_folder_id', s.upload_folder_id, 'aliases', s.aliases, 'reviewer', s.reviewer,
     'last_ok', (select max(finished_at) from public.invoice_runs r where r.kind='scan' and r.store_id=s.store_id and r.ok),
     'last_error', (select error from public.invoice_runs r where r.kind='scan' and r.store_id=s.store_id order by id desc limit 1),
     'today', (select count(*) from public.invoice_files f where f.store_id=s.store_id
               and (f.ingested_at at time zone 'Pacific/Honolulu')::date = (now() at time zone 'Pacific/Honolulu')::date),
     'review', (select count(*) from public.invoice_docs d where d.store_id=s.store_id and d.status='review'),
     'errors', (select count(*) from public.invoice_files f where f.store_id=s.store_id and (f.intake_status in ('error','unsupported') or f.organize_status='error')))), '[]')
     from public.invoice_stores s),
  'pending', (select count(*) from public.invoice_files where intake_status='pending'),
  'processing', (select count(*) from public.invoice_files where intake_status='processing'),
  'stuck', (select count(*) from public.invoice_files where intake_status='processing' and lease_until < now()),
  'review', (select count(*) from public.invoice_docs where status='review'),
  'errors', (select count(*) from public.invoice_files where intake_status='error'),
  'unsupported', (select count(*) from public.invoice_files where intake_status='unsupported'),
  'organize_errors', (select count(*) from public.invoice_files where organize_status='error'),
  'drive_problems', (select count(*) from public.invoice_files where drive_state<>'ok'),
  'qb', (select coalesce(jsonb_object_agg(state, n), '{}') from (select state, count(*) n from public.invoice_qb_outbox group by state) q),
  'drive', public.invoice_setting('drive_conn'),
  'mode', public.invoice_setting('mode'),
  'rules', public.invoice_setting('rules'),
  'qb_settings', public.invoice_setting('qb'),
  'qb_external_enabled', coalesce((public.invoice_setting('qb_external')->>'enabled')::boolean, false),
  'oldest_pending', (select min(ingested_at) from public.invoice_files where intake_status in ('pending','processing','error')));
end $$;

create function public.invoice_run_log(p jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.invoice_runs(kind, store_id, started_at, ok, stats, error)
 values(p->>'kind', p->>'store_id', coalesce((p->>'started_at')::timestamptz, now()), coalesce((p->>'ok')::boolean,false), coalesce(p->'stats','{}'), left(p->>'error',300));
$$;

-- ---------------------------------------------------------------- settings (people)
create function public.invoice_settings_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; k text := p->>'key'; v jsonb := p->'value'; cur jsonb;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if k not in ('mode','rules','qb','qb_external') then raise exception 'bad_key'; end if;
 if k = 'qb_external' and (select count(*) from jsonb_object_keys(v) x where x <> 'enabled') > 0 then raise exception 'field_not_editable'; end if;
 cur := public.invoice_setting(k);
 if k='rules' then
  if (v ? 'price_jump_pct') and not ((v->>'price_jump_pct')::numeric between 1 and 100) then raise exception 'bad_value'; end if;
  if (v ? 'total_tolerance_cents') and not ((v->>'total_tolerance_cents')::int between 0 and 100) then raise exception 'bad_value'; end if;
  if (v ? 'closed_through') and v->>'closed_through' is not null and (v->>'closed_through') !~ '^\d{4}-\d{2}$' then raise exception 'bad_value'; end if;
 end if;
 if k='qb' and (v ? 'route') and v->>'route' is not null and v->>'route' not in ('invoice-intake','external') then raise exception 'bad_value'; end if;
 if k='qb' and (v ? 'to') then raise exception 'field_not_editable'; end if;
 insert into public.invoice_settings(key, value, updated_by) values(k, cur || v, actor::text)
 on conflict(key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by;
 -- Keys (qb_external) are never written to the history or returned to a screen.
 perform public.invoice_event(null, null, actor::text, 'settings_'||k, jsonb_build_object('old', cur - 'key', 'new', (cur || v) - 'key'));
 return public.invoice_setting(k) - 'key';
end $$;

create function public.invoice_store_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; s jsonb := p->'store';
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if coalesce(s->>'store_id','') !~ '^[A-Za-z0-9_-]{1,24}$' then raise exception 'bad_value'; end if;
 insert into public.invoice_stores(store_id, label, root_folder_id, upload_folder_id, active, auto_post, aliases, address_group, reviewer, updated_by)
 values(s->>'store_id', s->>'label', s->>'root_folder_id', s->>'upload_folder_id', coalesce((s->>'active')::boolean,false),
  coalesce((s->>'auto_post')::boolean,false), coalesce(array(select jsonb_array_elements_text(s->'aliases')),'{}'), s->>'address_group', s->>'reviewer', actor::text)
 on conflict(store_id) do update set label=excluded.label, root_folder_id=excluded.root_folder_id, upload_folder_id=excluded.upload_folder_id,
  active=excluded.active, auto_post=excluded.auto_post, aliases=excluded.aliases, address_group=excluded.address_group, reviewer=excluded.reviewer,
  updated_at=now(), updated_by=excluded.updated_by;
 perform public.invoice_event(null, null, actor::text, 'store_saved', s);
 return (select to_jsonb(x) from public.invoice_stores x where store_id=s->>'store_id');
end $$;

create function public.invoice_vendor_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor';
begin
 perform public.invoice_require(actor, array['ceo','gm','office']);
 if coalesce(v->>'vendor_key','') !~ '^[A-Za-z0-9_.:@-]{1,80}$' or length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
 if coalesce((v->>'auto_post')::boolean,false) and public.invoice_actor_role(actor) not in ('ceo','gm')
    and not coalesce((select auto_post from public.invoice_vendor_rules where vendor_key=v->>'vendor_key'), false) then raise exception 'forbidden'; end if;
 insert into public.invoice_vendor_rules(vendor_key, display_name, aliases, food_kind, auto_post, verified_by, verified_at)
 values(v->>'vendor_key', v->>'display_name', coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}'), v->>'food_kind',
  coalesce((v->>'auto_post')::boolean,false), actor::text, now())
 on conflict(vendor_key) do update set display_name=excluded.display_name, aliases=excluded.aliases, food_kind=excluded.food_kind,
  auto_post=excluded.auto_post, verified_by=excluded.verified_by, verified_at=excluded.verified_at, updated_at=now();
 perform public.invoice_event(null, null, actor::text, 'vendor_saved', v);
 return (select to_jsonb(x) from public.invoice_vendor_rules x where vendor_key=v->>'vendor_key');
end $$;

create function public.invoice_map_save(p jsonb) returns jsonb
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

-- ---------------------------------------------------------------- app mirror
-- Copies a posted purchase into the app's existing invoice list (app_state spl_invoices_<store>)
-- so that Food Cost and purchase lists keep using their current calculation. Off by default.
-- A record deleted in the app (tombstone) is never brought back.
create function public.invoice_mirror_apply(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; k text; cur jsonb; rec jsonb := p->'record'; app_id text := p->'record'->>'id'; ex jsonb; mm public.invoice_app_mirror;
begin
 select * into d from public.invoice_docs where id=(p->>'doc_id')::uuid;
 if d.id is null or d.status not in ('posted','superseded') then raise exception 'invalid_state'; end if;
 if d.status='superseded' and not coalesce((p->>'tombstone')::boolean,false) then raise exception 'invalid_state'; end if;
 -- A closed month in the app is never changed (neither a new copy nor removing a replaced one).
 if d.needs_adjustment or (public.invoice_setting('rules')->>'closed_through' is not null
     and to_char(coalesce(d.invoice_date, d.effective_date),'YYYY-MM') <= public.invoice_setting('rules')->>'closed_through') then
  insert into public.invoice_app_mirror(doc_id, app_inv_id, store_id, state, error) values(d.id, app_id, d.store_id, 'held', 'closed_month')
  on conflict(doc_id) do update set state='held', error='closed_month', updated_at=now();
  return jsonb_build_object('state','held');
 end if;
 select * into mm from public.invoice_app_mirror where doc_id=d.id;
 if mm.state = 'held' and not coalesce((p->>'replace')::boolean,false) then return jsonb_build_object('state','held'); end if;
 if mm.state = 'tombstoned' then return jsonb_build_object('state','tombstoned'); end if;
 k := 'spl_invoices_' || d.store_id;
 select value::jsonb into cur from public.app_state where key=k for update;
 if cur is null then
  insert into public.app_state(key, value, updated_at) values(k, jsonb_build_array(rec), now()) on conflict(key) do nothing;
  if not found then select value::jsonb into cur from public.app_state where key=k for update; end if;
 end if;
 if cur is not null then
  select e into ex from jsonb_array_elements(cur) e where e->>'id' = app_id limit 1;
  if ex is not null and coalesce((ex->>'_deleted')::boolean, false) then
   insert into public.invoice_app_mirror(doc_id, app_inv_id, store_id, state, hash) values(d.id, app_id, d.store_id, 'tombstoned', p->>'hash')
   on conflict(doc_id) do update set state='tombstoned', updated_at=now();
   return jsonb_build_object('state','tombstoned');
  end if;
  if coalesce((p->>'tombstone')::boolean,false) then
   -- The posted document was replaced by a corrected version: the app copy is marked deleted, never removed.
   if ex is not null then
    update public.app_state set value=(select jsonb_agg(case when e->>'id'=app_id then e || jsonb_build_object('_deleted', true, '_mut', (extract(epoch from clock_timestamp())*1000)::bigint) else e end)
     from jsonb_array_elements(cur) e), updated_at=now() where key=k;
   end if;
   insert into public.invoice_app_mirror(doc_id, app_inv_id, store_id, state, hash) values(d.id, app_id, d.store_id, 'tombstoned', p->>'hash')
   on conflict(doc_id) do update set state='tombstoned', updated_at=now();
   return jsonb_build_object('state','tombstoned');
  end if;
  if ex is null then
   update public.app_state set value = cur || jsonb_build_array(rec), updated_at=now() where key=k;
  elsif coalesce((p->>'replace')::boolean,false) then
   update public.app_state set value=(select jsonb_agg(case when e->>'id'=app_id then rec else e end) from jsonb_array_elements(cur) e), updated_at=now() where key=k;
  end if;
 end if;
 insert into public.invoice_app_mirror(doc_id, app_inv_id, store_id, state, hash) values(d.id, app_id, d.store_id, 'mirrored', p->>'hash')
 on conflict(doc_id) do update set state='mirrored', hash=excluded.hash, error=null, updated_at=now();
 return jsonb_build_object('state','mirrored', 'existed', ex is not null);
end $$;

-- ---------------------------------------------------------------- worker reads
create function public.invoice_worker_key(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('key', value->>'key', 'enabled', coalesce((value->>'enabled')::boolean,false)) from public.invoice_settings where key='worker';
$$;

create function public.invoice_whoami(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('role', public.invoice_actor_role(nullif(p->>'actor','')::uuid));
$$;

create function public.invoice_worker_context(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'settings', jsonb_build_object('mode', public.invoice_setting('mode'), 'rules', public.invoice_setting('rules'), 'qb', public.invoice_setting('qb')),
  'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.store_id), '[]') from public.invoice_stores s where s.active),
  'all_stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.store_id), '[]') from public.invoice_stores s),
  'vendors', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.invoice_vendor_rules v),
  'maps', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.invoice_item_maps m));
$$;

create function public.invoice_files_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id, f.drive_file_id, f.store_id, f.original_name, f.mime_type from public.invoice_files f
  where f.drive_state='ok' and f.attempts < 6
   and (f.intake_status in ('pending','error') or (f.intake_status='processing' and f.lease_until < now()))
   and (f.next_attempt_at is null or f.next_attempt_at <= now()) and (f.lease_until is null or f.lease_until < now())
   and (jsonb_typeof(p->'stores') is distinct from 'array' or f.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
  order by f.ingested_at limit coalesce((p->>'limit')::int, 3)) x;
$$;

-- Invoices already registered in the app (no invoice number there): used only to raise candidates.
create function public.invoice_app_records(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'storeId', e->>'storeId', 'vendor', e->>'vendor', 'docDate', e->>'docDate',
   'total', e->'total', '_deleted', coalesce((e->>'_deleted')::boolean,false))), '[]')
 from public.app_state a, jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e   -- ::jsonb: the column may be json or jsonb
 where a.key in ('spl_invoices_' || (p->>'store_id'), 'invoices') and e->>'storeId' = p->>'store_id' and coalesce(e->>'src','') <> 'drive-intake';
$$;

create function public.invoice_folder(p jsonb) returns jsonb
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

create function public.invoice_organize_request(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare t text := p->>'target';
begin
 if t not in ('unreconciled','reconciled') then raise exception 'bad_target'; end if;
 update public.invoice_files set organize_target=t, organize_status='pending', organize_next_at=null, organize_attempts=0, organize_error=null
 where id=(p->>'file_id')::uuid and not (coalesce(organize_target,'')='reconciled' and t='unreconciled')
  and not (organize_status='done' and coalesce(organize_target,'')=t);
 return jsonb_build_object('ok', found);
end $$;

create function public.invoice_organize_due(p jsonb) returns jsonb
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
   and (f.organize_status='pending' or (f.organize_status='error' and f.organize_next_at <= now() and f.organize_attempts < 8))
   and d.status in ('review','posted') and d.vendor_name is not null and d.invoice_date is not null
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0)
  order by f.updated_at limit coalesce((p->>'limit')::int, 10)) x;
$$;

create function public.invoice_integrity_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id, f.drive_file_id, f.drive_md5 from public.invoice_files f
  where f.intake_status in ('posted','review','duplicate') and (f.drive_checked_at is null or f.drive_checked_at < now() - interval '6 hours')
  order by f.drive_checked_at nulls first limit coalesce((p->>'limit')::int, 10)) x;
$$;

create function public.invoice_file_content_changed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update public.invoice_files set drive_md5=p->>'md5', intake_status='pending', attempts=0, next_attempt_at=null, updated_at=now()
 where id=(p->>'file_id')::uuid and drive_md5 is distinct from p->>'md5';
 if found then perform public.invoice_event(null, (p->>'file_id')::uuid, 'worker', 'file_content_changed', '{}'); end if;
 return jsonb_build_object('ok', found);
end $$;

create function public.invoice_file_retry(p jsonb) returns jsonb
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

create function public.invoice_drive_conn(p jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.invoice_settings(key, value) values('drive_conn', jsonb_build_object('ok', coalesce((p->>'ok')::boolean,false), 'at', now(), 'error', left(p->>'error',200)))
 on conflict(key) do update set value=jsonb_build_object('ok', coalesce((p->>'ok')::boolean,false), 'at', now(),
  'last_ok', case when coalesce((p->>'ok')::boolean,false) then now() else (public.invoice_settings.value->>'last_ok')::timestamptz end, 'error', left(p->>'error',200)), updated_at=now();
$$;

-- Sends that were reserved but never answered become "unknown" (not failed, not sent).
create function public.invoice_qb_sweep(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n int;
begin
 update public.invoice_qb_outbox set state='unknown', last_error='no_result_recorded', updated_at=now()
 where state='sending' and reserved_at < now() - interval '15 minutes';
 get diagnostics n = row_count;
 return jsonb_build_object('unknown', n);
end $$;

create function public.invoice_qb_candidates(p jsonb) returns jsonb
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

create function public.invoice_file_brief(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('drive_file_id', drive_file_id, 'current_name', current_name, 'mime_type', mime_type) from public.invoice_files where id=(p->>'file_id')::uuid;
$$;

create function public.invoice_mirror_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select d.id, d.internal_no, d.store_id, d.vendor_name, d.invoice_no, d.invoice_date, d.total_cents, d.food_kind, d.status, f.drive_file_id, f.ingested_at,
   m.state mirror_state, m.error mirror_error,
   (select coalesce(jsonb_agg(jsonb_build_object('raw_name', l.raw_name, 'qty', l.qty, 'unit_price', l.unit_price, 'amount_cents', l.amount_cents,
     'ingredient_code', l.ingredient_code) order by l.line_no), '[]') from public.invoice_lines l where l.doc_id=d.id) lines
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  left join public.invoice_app_mirror m on m.doc_id=d.id
  where d.posting_kind='purchase'
   -- Documents received before the start date (the pilot) are not copied: stores still entered them in the app.
   and (public.invoice_setting('mode')->>'start_at') is not null and f.ingested_at >= (public.invoice_setting('mode')->>'start_at')::timestamptz
   and (
   (d.status='posted' and (m.doc_id is null or m.state='error' or (m.state='held' and m.error='edited_after_post' and not d.needs_adjustment)))
   or (d.status='superseded' and m.state='mirrored'))
  order by d.posted_at limit coalesce((p->>'limit')::int, 20)) x;
$$;

-- Past originals: registered for the ledger only. Never read, posted or forwarded by this job.
create function public.invoice_backfill_register(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; f jsonb; n int := 0; k int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 for f in select * from jsonb_array_elements(coalesce(p->'files','[]')) loop
  insert into public.invoice_files(drive_file_id, store_id, source, original_name, current_name, mime_type, size_bytes, drive_created_at,
   drive_modified_at, drive_md5, parent_ids, intake_status)
  values(f->>'drive_file_id', p->>'store_id', 'backfill', f->>'name', f->>'name', f->>'mime_type', (f->>'size')::bigint,
   (f->>'created_time')::timestamptz, (f->>'modified_time')::timestamptz, f->>'md5', coalesce(array(select jsonb_array_elements_text(f->'parents')),'{}'), 'archived')
  on conflict(drive_file_id) do nothing;
  if found then n := n + 1; else k := k + 1; end if;
 end loop;
 perform public.invoice_event(null, null, actor::text, 'backfill_registered', jsonb_build_object('store', p->>'store_id', 'registered', n, 'already', k));
 return jsonb_build_object('registered', n, 'already', k);
end $$;

-- Drive file IDs the existing app already recorded for its invoices (exact match only).
create function public.invoice_app_drive_ids(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(distinct e->>'driveFileId'), '[]')
 from public.app_state a, jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e   -- ::jsonb: the column may be json or jsonb
 where a.key in ('spl_invoices_' || (p->>'store_id'), 'invoices') and coalesce(e->>'driveFileId','') <> '';
$$;

create function public.invoice_registered(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(drive_file_id), '[]') from public.invoice_files where drive_file_id in (select jsonb_array_elements_text(p->'ids'));
$$;

-- A person moves a file to the store it really belongs to. Only before anything was posted from it;
-- earlier readings are kept (rejected, with the reason) and the stored AI reading is reused.
create function public.invoice_reassign(p jsonb) returns jsonb
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

-- Onboarding helpers. They only propose: vendors start in review mode and mappings start unverified.
-- Vendor master -> vendor rules (food / non-food copied when the master says so).
create function public.invoice_vendor_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.id::text, 'display_name', v.name,
   'food_kind', case when v.data->>'kind' in ('food','nonfood') then v.data->>'kind' end,
   'exists', exists(select 1 from public.invoice_vendor_rules r where r.vendor_key=v.id::text)) order by v.name), '[]')
 into rows from public.vendors v where coalesce(v.name,'') <> '' and v.id::text ~ '^[A-Za-z0-9_.:@-]{1,80}$';
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_vendor_rules(vendor_key, display_name, food_kind, auto_post)
  select x->>'vendor_key', x->>'display_name', x->>'food_kind', false from jsonb_array_elements(rows) x
  on conflict(vendor_key) do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'vendor_seed', jsonb_build_object('added', n));
 end if;
 return jsonb_build_object('vendors', rows, 'added', n);
end $$;

-- Product master rows that carry a vendor product code (LaLa's imported items do) -> unverified mappings.
-- Case vs bag/bottle comes from the master's own "qty per purchase unit"; grams only where the master counts in g.
create function public.invoice_map_seed(p jsonb) returns jsonb
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
  select s.*, (select r.vendor_key from public.invoice_vendor_rules r where lower(r.display_name)=lower(s.vendor)
     or lower(s.vendor) in (select lower(a) from unnest(r.aliases) a) limit 1) vendor_key from src s)
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

-- Drive credentials already saved by drive-sync (service role only). Never returned to a browser.
create function public.invoice_drive_credentials(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r jsonb;
begin
 if to_regclass('public.drive_oauth') is null then return null; end if;
 execute 'select jsonb_build_object(''client_id'', client_id, ''client_secret'', client_secret, ''refresh_token'', refresh_token) from public.drive_oauth where id=1' into r;
 return r;
end $$;

-- QuickBooks forwarding done outside this system (qb.route = 'external') uses the same ledger:
-- it lists what to send, reserves one row, and records the result. Nothing is sent from here.
create function public.invoice_qb_external_key(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('key', value->>'key', 'enabled', coalesce((value->>'enabled')::boolean,false)) from public.invoice_settings where key='qb_external';
$$;

create function public.invoice_qb_external_list(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]') from (
  select o.id, o.state, o.attempt_key, o.sha256, o.to_address, o.attempts, o.created_at, f.drive_file_id, f.current_name, f.mime_type, f.store_id, f.drive_created_at
  from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  where o.route='external' and o.state in ('pending','error') and (o.next_at is null or o.next_at<=now()) and o.attempts < 5
  order by o.created_at limit least(coalesce((p->>'limit')::int,20),100)) x;
$$;

create function public.invoice_qb_external_reserve(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox;
begin
 update public.invoice_qb_outbox set state='sending', attempts=attempts+1, reserved_by='external', reserved_at=now(), updated_at=now()
 where id=(p->>'id')::uuid and route='external' and state in ('pending','error') and (next_at is null or next_at<=now()) and attempts < 5
 returning * into o;
 if o.id is null then raise exception 'invalid_state'; end if;
 perform public.invoice_event(null, o.file_id, 'external', 'qb_reserved', '{}');
 return to_jsonb(o);
end $$;

-- 00_Upload of a store: found by name under the store folder, created only on request.
create function public.invoice_store_folder(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 update public.invoice_stores set upload_folder_id=p->>'upload_folder_id', updated_at=now(), updated_by=actor::text
 where store_id=p->>'store_id' and root_folder_id is not null;
 if not found then raise exception 'not_found'; end if;
 perform public.invoice_event(null, null, actor::text, 'upload_folder_set', jsonb_build_object('store', p->>'store_id', 'folder', p->>'upload_folder_id'));
 return (select to_jsonb(x) from public.invoice_stores x where store_id=p->>'store_id');
end $$;

-- Purchase price history of one product, with the original and the page of each line.
create function public.invoice_price_history_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return (select coalesce(jsonb_agg(to_jsonb(x) - 'no_key' order by x.effective_date desc, x.invoice_date desc nulls last, x.no_key desc nulls last, x.id desc), '[]') from (
  select h.id, h.store_id, h.vendor_key, d.vendor_name, h.ingredient_code, h.spec_key, h.purchase_unit, h.effective_date, h.effective_basis, h.invoice_date,
   d.invoice_no, h.price_per_purchase::text price_per_purchase, h.price_per_count::text price_per_count, h.count_unit,
   h.price_per_base::text price_per_base, h.base_unit, h.status, h.created_by, h.doc_id, l.page, f.drive_file_id, d.posted_mode, lpad(h.invoice_no_norm, 40, '0') no_key
  from public.invoice_price_history h join public.invoice_docs d on d.id=h.doc_id join public.invoice_lines l on l.id=h.line_id
  join public.invoice_files f on f.id=d.file_id
  where h.ingredient_code=p->>'code' and (coalesce((p->>'include_voided')::boolean,false) or h.status='active')
   and (jsonb_typeof(p->'stores') is distinct from 'array' or h.store_id in (select jsonb_array_elements_text(case when jsonb_typeof(p->'stores')='array' then p->'stores' else '[]'::jsonb end)))
  order by h.effective_date desc, h.invoice_date desc nulls last, lpad(h.invoice_no_norm, 40, '0') desc nulls last, h.id desc limit 200) x);
end $$;

-- What the settings and review screens need to show (no keys).
create function public.invoice_config(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text;
begin
 rl := public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return jsonb_build_object('role', rl,
  'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.store_id), '[]') from public.invoice_stores s),
  'vendors', (select coalesce(jsonb_agg(to_jsonb(v) order by v.display_name), '[]') from public.invoice_vendor_rules v),
  'maps', (select coalesce(jsonb_agg(to_jsonb(m) order by m.vendor_key, m.vendor_item_code nulls last, m.alias_key), '[]')
           from (select * from public.invoice_item_maps order by verified, updated_at desc limit 5000) m),
  'settings', jsonb_build_object('mode', public.invoice_setting('mode'), 'rules', public.invoice_setting('rules'), 'qb', public.invoice_setting('qb'),
   'qb_external_enabled', coalesce((public.invoice_setting('qb_external')->>'enabled')::boolean, false)));
end $$;

-- Files that need a person (read errors, unsupported files, filing errors, originals gone) and forwarding rows to check.
create function public.invoice_problems(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return jsonb_build_object(
  'files', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]') from (
    select f.id, f.store_id, f.current_name, f.mime_type, f.drive_file_id, f.intake_status, f.last_error, f.organize_status, f.organize_error,
     f.organize_attempts, f.drive_state, f.updated_at
    from public.invoice_files f
    where f.intake_status in ('error','unsupported') or f.organize_status='error' or f.drive_state<>'ok'
    order by f.updated_at desc limit 100) x),
  'qb', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]') from (
    select o.id, o.state, o.route, o.attempts, o.last_error, o.updated_at, o.created_at, f.store_id, f.current_name, f.drive_file_id
    from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
    where o.state in ('unknown','error') order by o.updated_at desc limit 50) x));
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_actor_role(uuid)','invoice_require(uuid,text[])','invoice_setting(text)','invoice_event(uuid,uuid,text,text,jsonb)',
  'invoice_lease(jsonb)','invoice_file_seen(jsonb)','invoice_file_claim(jsonb)','invoice_file_fail(jsonb)','invoice_file_version(jsonb)',
  'invoice_extraction(jsonb)','invoice_dup_scope(jsonb)','invoice_price_ref(jsonb)','invoice_stage(jsonb)','invoice_file_settle(jsonb)',
  'invoice_price_insert(uuid,uuid,text,text)','invoice_post(jsonb)','invoice_edit(jsonb)','invoice_mark(jsonb)','invoice_relate(jsonb)','invoice_reconcile(jsonb)','invoice_organize_result(jsonb)',
  'invoice_drive_status(jsonb)','invoice_qb_enqueue(jsonb)','invoice_qb_reserve(jsonb)','invoice_qb_result(jsonb)','invoice_list(jsonb)','invoice_get(jsonb)',
  'invoice_latest_prices(jsonb)','invoice_health(jsonb)','invoice_run_log(jsonb)','invoice_settings_save(jsonb)','invoice_store_save(jsonb)',
  'invoice_vendor_save(jsonb)','invoice_map_save(jsonb)','invoice_mirror_apply(jsonb)','invoice_worker_key(jsonb)','invoice_whoami(jsonb)',
  'invoice_worker_context(jsonb)','invoice_files_due(jsonb)','invoice_app_records(jsonb)','invoice_folder(jsonb)','invoice_organize_request(jsonb)',
  'invoice_organize_due(jsonb)','invoice_integrity_due(jsonb)','invoice_file_content_changed(jsonb)','invoice_file_retry(jsonb)','invoice_drive_conn(jsonb)',
  'invoice_qb_sweep(jsonb)','invoice_qb_candidates(jsonb)','invoice_file_brief(jsonb)','invoice_mirror_due(jsonb)',
  'invoice_backfill_register(jsonb)','invoice_app_drive_ids(jsonb)','invoice_registered(jsonb)','invoice_reassign(jsonb)','invoice_vendor_seed(jsonb)','invoice_map_seed(jsonb)','invoice_drive_credentials(jsonb)','invoice_qb_external_key(jsonb)',
  'invoice_qb_external_list(jsonb)','invoice_qb_external_reserve(jsonb)','invoice_store_folder(jsonb)','invoice_price_history_list(jsonb)',
  'invoice_config(jsonb)','invoice_problems(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
