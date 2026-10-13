-- 反映 → 名前を変える → QuickBooks（Moto 2026-10-12：「この内容で反映ボタンを押したら、読み取りした Google Drive のファイル名を
-- 日付、業者名、インボイスナンバーの順でファイル名を変更 → ファイル名を変更したらクイックブックスに送信する」）。
-- 名前の形は 2026-10-07_Marujuu-Produce_12345.pdf。QuickBooks へ送るのは ChatGPT 側（この台帳を見て、名前を変えたものだけを送る）。
--
-- Adds to invoice_files the record of the rename (existing rows are not changed: every file starts at 'none'), and an
-- index for looking up the documents of a file (invoice_docs(file_id, sha256)).
-- The name is made for the posted document as it is now: rename_key is that document's id and version, so a correction
-- or a replacing version asks for the name again.
-- New functions (service_role only, like every other invoice_ function):
--   invoice_rename_waiting / invoice_rename_waiting_all : whether a posted original still waits for its name (one / all)
--   invoice_rename_due / invoice_rename_result          : the posting itself and the worker rename the original, then record it
--   invoice_qb_since_at                                 : qb.since is a Hawaii date (as before) or a moment (the switch-over time)
-- Replaced functions (same names and arguments, so their grants stay):
--   invoice_qb_candidates / invoice_qb_enqueue : only posted originals, and only after their rename
--   invoice_settings_save                       : mode.rename (mode.rename_since is set each time it is turned on); qb.since is checked
--   invoice_file_retry                          : also tries a failed rename again
--   invoice_health / invoice_problems           : rename errors and originals waiting for their name are shown
-- Renaming starts OFF (mode.rename): nothing is renamed until a GM or CEO turns it on in the settings screen.
-- Running this file twice changes nothing.

alter table public.invoice_files
 add column if not exists rename_state text not null default 'none' check (rename_state in ('none','done','error')),
 add column if not exists rename_key text,
 add column if not exists rename_attempts integer not null default 0,
 add column if not exists rename_error text,
 add column if not exists rename_next_at timestamptz,
 add column if not exists renamed_at timestamptz;
-- The documents of a file's current content are looked up per file (rename, QuickBooks, filing): an index for that.
create index if not exists invoice_docs_file on public.invoice_docs(file_id, sha256);

-- True while a posted original still waits for its name: it goes to QuickBooks only after the rename (Moto 2026-10-12).
-- The name is made for the posted document of the file's current content, as it is now (its id and version: rename_key);
-- a later change of that document (a correction, a replacing version) asks again. Only an original that came in through
-- Drive (not a past original), holds one document (one name cannot describe several) and was posted after renaming was
-- first turned on. invoice_rename_waiting_all is the same for all files at once (the tests check the two agree).
create or replace function public.invoice_rename_waiting(p_file uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.invoice_files f
  join public.invoice_docs d on d.file_id=f.id and d.sha256=f.current_sha256 and d.doc_index=0 and d.status='posted'
  cross join (select public.invoice_setting('mode') m) s
  where f.id=p_file and f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'
   and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz
   and f.rename_key is distinct from (d.id::text || ':' || d.version)
   and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0));
$$;

-- Every posted original still waiting for its name, with its posted document and the key the name is made for: the
-- conditions of invoice_rename_waiting for all files at once (renaming, QuickBooks and the count on the screen use it).
create or replace function public.invoice_rename_waiting_all() returns table(file_id uuid, doc_id uuid, target_key text)
language sql stable security invoker set search_path=public,pg_temp as $$
 select f.id, d.id, d.id::text || ':' || d.version
 from public.invoice_files f
 join public.invoice_docs d on d.file_id=f.id and d.sha256=f.current_sha256 and d.doc_index=0 and d.status='posted'
 cross join (select public.invoice_setting('mode') m) s
 where f.source='drive' and f.intake_status='posted' and s.m->>'rename' = 'true'
  and d.posted_at >= nullif(s.m->>'rename_since', '')::timestamptz
  and f.rename_key is distinct from (d.id::text || ':' || d.version)
  and not exists(select 1 from public.invoice_docs d2 where d2.file_id=f.id and d2.sha256=f.current_sha256 and d2.doc_index>0);
$$;

-- Originals to rename now (from invoice_rename_waiting_all), with what the name is made of. The worker takes them on every
-- run; the posting (and a correction of a posted invoice) asks for its own file at once (file_id). A failed rename is tried
-- again later, 8 times at most, then waits for a person's retry. A missing, trashed or moved original is not touched (the
-- problem is shown instead).
create or replace function public.invoice_rename_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select f.id file_id, f.drive_file_id, f.store_id, f.original_name, f.current_name, w.target_key,
   coalesce(d.invoice_date, d.effective_date) invoice_date, coalesce(d.vendor_name, d.vendor_raw) vendor_name, d.doc_type,
   nullif(d.invoice_no, '') invoice_no, d.internal_no, (select count(*) from public.invoice_file_versions v where v.file_id=f.id) version_no,
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

-- Result of a rename in Drive. It is recorded for the values the name was made from: a correction made meanwhile asks again.
create or replace function public.invoice_rename_result(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.invoice_files; ok boolean := coalesce((p->>'ok')::boolean, false);
begin
 select * into f from public.invoice_files where id=(p->>'file_id')::uuid for update;
 if f.id is null then raise exception 'not_found'; end if;
 if ok then
  if nullif(p->>'key', '') is null or nullif(p->>'name', '') is null then raise exception 'bad_value'; end if;
  update public.invoice_files set rename_state='done', rename_key=p->>'key', current_name=p->>'name', rename_attempts=0, rename_error=null,
   rename_next_at=null, renamed_at=now(), updated_at=now()
  where id=f.id;
 else
  update public.invoice_files set rename_state='error', rename_attempts=rename_attempts+1, rename_error=left(p->>'error', 300),
   rename_next_at=now() + make_interval(mins => least(720, 10 * power(2, least(rename_attempts, 6))::int)), updated_at=now()
  where id=f.id;
 end if;
 perform public.invoice_event(null, f.id, coalesce(nullif(p->>'actor', ''), 'worker'), case when ok then 'renamed' else 'rename_failed' end,
  jsonb_build_object('from', f.current_name, 'name', p->>'name', 'error', left(p->>'error', 300)));
 return jsonb_build_object('ok', true);
end $$;

-- qb.since as a moment: a Hawaii date (YYYY-MM-DD: originals saved on or after that day in Hawaii, as before) or a moment
-- with its offset (the time the forwarding switched to this ledger, Moto 2026-10-12). Anything else, or none, gives null:
-- then nothing is forwarded.
create or replace function public.invoice_qb_since_at() returns timestamptz
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare s text := public.invoice_setting('qb')->>'since';
begin
 if s ~ '^\d{4}-\d{2}-\d{2}$' then return s::date::timestamp at time zone 'Pacific/Honolulu'; end if;
 if s ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then return s::timestamptz; end if;
 return null;
exception when others then return null;
end $$;

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
  order by f.ingested_at limit coalesce((p->>'limit')::int, 20)) f;
$$;

create or replace function public.invoice_settings_save(p jsonb) returns jsonb
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
 -- qb.since: a Hawaii date, or the moment (with its offset) the forwarding switched to this ledger (Moto 2026-10-12).
 if k='qb' and (v ? 'since') then
  if not (jsonb_typeof(v->'since')='string' and ((v->>'since') ~ '^\d{4}-\d{2}-\d{2}$'
     or (v->>'since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')) then raise exception 'bad_value'; end if;
  begin perform (v->>'since')::timestamptz; exception when others then raise exception 'bad_value'; end;
 end if;
 -- Renaming after posting (Moto 2026-10-12). rename_since is set here each time renaming is turned on (from off), so
 -- originals posted before, or while it was off, keep their names; nobody sets it by hand.
 if k='mode' and (v ? 'rename_since') then raise exception 'field_not_editable'; end if;
 if k='mode' and (v ? 'rename') and jsonb_typeof(v->'rename') <> 'boolean' then raise exception 'bad_value'; end if;
 if k='mode' and v->>'rename' = 'true' and coalesce(cur->>'rename', 'false') <> 'true' then v := v || jsonb_build_object('rename_since', now()); end if;
 insert into public.invoice_settings(key, value, updated_by) values(k, cur || v, actor::text)
 on conflict(key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by;
 -- Keys (qb_external) are never written to the history or returned to a screen.
 perform public.invoice_event(null, null, actor::text, 'settings_'||k, jsonb_build_object('old', cur - 'key', 'new', (cur || v) - 'key'));
 return public.invoice_setting(k) - 'key';
end $$;

create or replace function public.invoice_file_retry(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 update public.invoice_files set intake_status=case when intake_status='error' then 'pending' else intake_status end, attempts=0, next_attempt_at=null,
  organize_status=case when organize_status='error' then 'pending' else organize_status end, organize_attempts=0, organize_next_at=null,
  rename_state=case when rename_state='error' then 'none' else rename_state end, rename_attempts=0, rename_next_at=null, updated_at=now()
 where id=(p->>'file_id')::uuid;
 if not found then raise exception 'not_found'; end if;
 perform public.invoice_event(null, (p->>'file_id')::uuid, actor::text, 'retry', '{}');
 return jsonb_build_object('ok', true);
end $$;

create or replace function public.invoice_health(p jsonb) returns jsonb
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
     'errors', (select count(*) from public.invoice_files f where f.store_id=s.store_id
                and (f.intake_status in ('error','unsupported') or f.organize_status='error' or f.rename_state='error')))), '[]')
     from public.invoice_stores s),
  'pending', (select count(*) from public.invoice_files where intake_status='pending'),
  'processing', (select count(*) from public.invoice_files where intake_status='processing'),
  'stuck', (select count(*) from public.invoice_files where intake_status='processing' and lease_until < now()),
  'review', (select count(*) from public.invoice_docs where status='review'),
  'errors', (select count(*) from public.invoice_files where intake_status='error'),
  'unsupported', (select count(*) from public.invoice_files where intake_status='unsupported'),
  'organize_errors', (select count(*) from public.invoice_files where organize_status='error'),
  -- Moto 2026-10-12: posted originals are renamed before they go to QuickBooks.
  'rename_errors', (select count(*) from public.invoice_files where rename_state='error'),
  'rename_waiting', (select count(*) from public.invoice_rename_waiting_all()),
  'drive_problems', (select count(*) from public.invoice_files where drive_state<>'ok'),
  'qb', (select coalesce(jsonb_object_agg(state, n), '{}') from (select state, count(*) n from public.invoice_qb_outbox group by state) q),
  'drive', public.invoice_setting('drive_conn'),
  'mode', public.invoice_setting('mode'),
  'rules', public.invoice_setting('rules'),
  'qb_settings', public.invoice_setting('qb'),
  'qb_external_enabled', coalesce((public.invoice_setting('qb_external')->>'enabled')::boolean, false),
  'oldest_pending', (select min(ingested_at) from public.invoice_files where intake_status in ('pending','processing','error')));
end $$;

-- Files that need a person (read errors, unsupported files, filing and renaming errors, originals gone) and forwarding rows to check.
create or replace function public.invoice_problems(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return jsonb_build_object(
  'files', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]') from (
    select f.id, f.store_id, f.current_name, f.mime_type, f.drive_file_id, f.intake_status, f.last_error, f.organize_status, f.organize_error,
     f.organize_attempts, f.drive_state, f.rename_state, f.rename_error, f.rename_attempts, f.updated_at
    from public.invoice_files f
    where f.intake_status in ('error','unsupported') or f.organize_status='error' or f.rename_state='error' or f.drive_state<>'ok'
    order by f.updated_at desc limit 100) x),
  'qb', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]') from (
    select o.id, o.state, o.route, o.attempts, o.last_error, o.updated_at, o.created_at, f.store_id, f.current_name, f.drive_file_id
    from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
    where o.state in ('unknown','error') order by o.updated_at desc limit 50) x));
end $$;

-- The new functions get the same grants as every other invoice_ function: service_role only. (Supabase grants new
-- functions to the browser roles by default; that is taken back here.) Replaced functions keep their grants.
do $$ declare f text; begin
 foreach f in array array['invoice_rename_waiting(uuid)','invoice_rename_waiting_all()','invoice_rename_due(jsonb)','invoice_rename_result(jsonb)',
  'invoice_qb_since_at()'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
