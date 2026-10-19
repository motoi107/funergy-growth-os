-- QuickBooks への原本転送を「台帳に積んだらすぐ」（Moto 2026-10-18・UI案56 決めてほしいこと 1〜6 は A）。
-- このファイルは Invoice取込の分（Gmail の接続・送る前の確かめ・知らせ）。送るのは関数 invoice-intake（このシステム）。
--
-- The originals of this system's route (invoice_qb_outbox.route = 'invoice-intake') are sent by the function invoice-intake from
-- the Gmail account connected in the app (Settings › Gmail), right after a posting is queued (and by the worker if that start was
-- lost). Before every send the ledger row is reserved (invoice_qb_reserve, as before), the settings are read again
-- (invoice_qb_send_context), Gmail's sent mail is searched, the Drive bytes are hashed, and the reservation is checked once more
-- just before sending (invoice_qb_send_check). Rows of the outside forwarder (route 'external') are not touched: it keeps sending
-- what it was given (decision 6A). New rows get the route the setting names (as before); switching the setting to this system
-- needs a working Gmail connection of the configured sender (qb.from).
--
-- Changes (the function invoice-intake and the screen do the rest):
--   invoice_gmail_auth      : the one Gmail connection (account, refresh token, scopes, state). Service role only; the token is never
--                             returned to a screen or written to the event history.
--   invoice_gmail_oauth     : a connection being made (the state's hash and the PKCE verifier; ten minutes, used once).
--   invoice_qb_alerts       : notices to Moto (decisions 1・2・5: in the app, by mail and in LINE's 本部業務連絡グループ), once each.
--   invoice_qb_outbox.gmail_checked_at/gmail_checks : an "unknown" send of this system looked for in Gmail's sent mail (a found
--                             message settles it as sent; nothing is ever sent again from here).
--   invoice_settings 'qb_notify' : where the notices go (app, email, line; all on).
--   invoice_settings_save   : (replaced) qb.from (the sender, set once by SQL) and qb.route_since are not set from a screen; the route
--                             becomes this system only with the Gmail of qb.from connected with both scopes, and route_since records when.
--                             qb_notify takes three switches.
--   invoice_config          : (replaced) the Gmail connection's state (no token) and qb_notify for the settings screen.
--   invoice_gmail_*         : connect (start, take the state back, save), the token for the function, record a check or a problem,
--                             disconnect, the state for a screen.
--   invoice_qb_has_due / invoice_qb_send_context / invoice_qb_send_check / invoice_qb_content_changed : one send.
--   invoice_qb_unknown_due / invoice_qb_gmail_checked / invoice_qb_row : unknown sends looked for in Gmail (the function, or a person).
--   invoice_qb_status       : the 取込状況 card (counts by route, the latest rows with their times and Gmail IDs, notices not delivered).
--   invoice_qb_alert_put / invoice_qb_alert_scan / invoice_qb_alert_claim / invoice_qb_alert_done / invoice_qb_alerts_publish :
--                             notices (made once, delivered once per channel, the app's copy in app_state 'invoice_qb_alerts').
--   invoice_line_route      : the LINE group of 本部業務連絡 (the operations bot's finance route), when it is set up.
-- No invoice, ledger row, Drive file or other setting is changed by running this file. Running it twice changes nothing.

do $$ begin
 if to_regprocedure('public.invoice_link_apply(jsonb)') is null then
  raise exception '先に 20261025090000_invoice_item_link.sql（紐づけ 段階 1）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

-- ---------------------------------------------------------------- 1) tables
create table if not exists public.invoice_gmail_auth(
 id integer primary key default 1 check (id = 1),
 account text,
 refresh_token text,
 scopes text[] not null default '{}',
 status text not null default 'none' check (status in ('none','ok','expired','denied','disconnected')),
 connected_at timestamptz,
 connected_by text,
 checked_at timestamptz,
 checked_by text,
 check_result jsonb,
 last_error text,
 problem_at timestamptz,
 updated_at timestamptz not null default now()
);

create table if not exists public.invoice_gmail_oauth(
 state_hash text primary key,
 verifier text not null,
 actor text not null,
 created_at timestamptz not null default now(),
 used_at timestamptz
);

create table if not exists public.invoice_qb_alerts(
 id uuid primary key default gen_random_uuid(),
 key text not null unique,
 kind text not null check (kind in ('first_sent','unknown','error_final','content_changed','backlog','auth','intake_error','rename_error')),
 data jsonb not null default '{}',
 app boolean not null default true,
 email_state text not null default 'pending' check (email_state in ('pending','sending','sent','failed','skipped','off')),
 email_tries integer not null default 0,
 email_at timestamptz,
 line_state text not null default 'pending' check (line_state in ('pending','sending','sent','failed','skipped','off')),
 line_tries integer not null default 0,
 line_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists invoice_qb_alerts_created on public.invoice_qb_alerts(created_at desc);

alter table public.invoice_qb_outbox add column if not exists gmail_checked_at timestamptz;
alter table public.invoice_qb_outbox add column if not exists gmail_checks integer not null default 0;

do $$ declare t text; begin
 foreach t in array array['invoice_gmail_auth','invoice_gmail_oauth','invoice_qb_alerts'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update on public.%I to service_role', t);
 end loop;
end $$;
grant delete on public.invoice_gmail_oauth to service_role;

insert into public.invoice_settings(key, value) values ('qb_notify', jsonb_build_object('app', true, 'email', true, 'line', true))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 2) replaced: settings
create or replace function public.invoice_settings_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; k text := p->>'key'; v jsonb := p->'value'; cur jsonb;
 g_status text; g_token text; g_account text; g_scopes text[]; g_check jsonb;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if k not in ('mode','rules','qb','qb_external','qb_notify') then raise exception 'bad_key'; end if;
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 if k = 'qb_external' and (select count(*) from jsonb_object_keys(v) x where x <> 'enabled') > 0 then raise exception 'field_not_editable'; end if;
 -- Where the notices go (UI案56 decision 1): three switches and nothing else.
 if k = 'qb_notify' and ((select count(*) from jsonb_object_keys(v) x where x not in ('app','email','line')) > 0
    or exists(select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'boolean')) then raise exception 'bad_value'; end if;
 cur := public.invoice_setting(k);
 if k='rules' then
  if (v ? 'price_jump_pct') and not ((v->>'price_jump_pct')::numeric between 1 and 100) then raise exception 'bad_value'; end if;
  if (v ? 'total_tolerance_cents') and not ((v->>'total_tolerance_cents')::int between 0 and 100) then raise exception 'bad_value'; end if;
  if (v ? 'closed_through') and v->>'closed_through' is not null and (v->>'closed_through') !~ '^\d{4}-\d{2}$' then raise exception 'bad_value'; end if;
 end if;
 if k='qb' and (v ? 'route') and v->>'route' is not null and v->>'route' not in ('invoice-intake','external') then raise exception 'bad_value'; end if;
 if k='qb' and (v ? 'to') then raise exception 'field_not_editable'; end if;
 -- The sender (set once by SQL) and the moment this system took over are never set from a screen.
 if k='qb' and ((v ? 'from') or (v ? 'route_since')) then raise exception 'field_not_editable'; end if;
 -- This system sends only from the Gmail of qb.from, connected with both scopes (sending, and reading the sent mail), checked
 -- (確かめる) after connecting, and, when an original had been sent before, found again in the sent mail by the same search.
 if k='qb' and v->>'route' = 'invoice-intake' and coalesce(cur->>'route','') <> 'invoice-intake' then
  select status, refresh_token, account, scopes, check_result into g_status, g_token, g_account, g_scopes, g_check from public.invoice_gmail_auth where id=1;
  if g_status is distinct from 'ok' or g_token is null or nullif(cur->>'from','') is null or lower(coalesce(g_account,'')) <> lower(cur->>'from')
     or not coalesce(g_scopes @> array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly'], false)
     or coalesce(g_check->>'ok', '') <> 'true'
     or (coalesce(g_check->'history_probe'->>'tried', '') = 'true' and coalesce(g_check->'history_probe'->>'found', '') <> 'true') then
   raise exception 'gmail_not_ready';
  end if;
  v := v || jsonb_build_object('route_since', now());
 end if;
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

create or replace function public.invoice_config(p jsonb) returns jsonb
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
   'qb_external_enabled', coalesce((public.invoice_setting('qb_external')->>'enabled')::boolean, false),
   'qb_notify', public.invoice_setting('qb_notify'), 'gmail', public.invoice_gmail_public('{}'::jsonb)));
end $$;

-- ---------------------------------------------------------------- 3) the Gmail connection
-- What a screen may know about the connection: never the token.
create or replace function public.invoice_gmail_public(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('status', coalesce(g.status, 'none'), 'account', g.account,
  'from', nullif(public.invoice_setting('qb')->>'from', ''),
  'from_ok', g.account is not null and lower(g.account) = lower(coalesce(public.invoice_setting('qb')->>'from', '')),
  'send_scope', coalesce(g.scopes @> array['https://www.googleapis.com/auth/gmail.send'], false),
  'read_scope', coalesce(g.scopes @> array['https://www.googleapis.com/auth/gmail.readonly'], false),
  'connected_at', g.connected_at, 'connected_by', g.connected_by, 'checked_at', g.checked_at, 'checked_by', g.checked_by,
  'check_result', g.check_result, 'last_error', g.last_error, 'problem_at', g.problem_at)
 from (select 1) one left join public.invoice_gmail_auth g on g.id = 1;
$$;

-- A connection begins (CEO・GM, decision 3A): the state's hash and the PKCE verifier are kept ten minutes, for one use.
create or replace function public.invoice_gmail_start(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_from text := nullif(public.invoice_setting('qb')->>'from', '');
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if v_from is null then raise exception 'from_not_set'; end if;
 if coalesce(p->>'state_hash','') !~ '^[0-9a-f]{64}$' or length(coalesce(p->>'verifier','')) not between 43 and 128 then raise exception 'bad_value'; end if;
 delete from public.invoice_gmail_oauth where created_at < now() - interval '1 day';
 insert into public.invoice_gmail_oauth(state_hash, verifier, actor) values(p->>'state_hash', p->>'verifier', actor::text);
 return jsonb_build_object('from', v_from);
end $$;

-- Google came back with the state: it is taken (once, within ten minutes) and gives the verifier and who began.
create or replace function public.invoice_gmail_take(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_gmail_oauth;
begin
 update public.invoice_gmail_oauth set used_at=now()
 where state_hash=p->>'state_hash' and used_at is null and created_at > now() - interval '10 minutes'
 returning * into o;
 if o.state_hash is null then raise exception 'bad_state'; end if;
 return jsonb_build_object('actor', o.actor, 'verifier', o.verifier);
end $$;

-- The connection is kept only for the account named qb.from, with both scopes; the one who began must still be CEO or GM.
create or replace function public.invoice_gmail_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_from text := nullif(public.invoice_setting('qb')->>'from', '');
 v_scopes text[] := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p->'scopes')='array' then p->'scopes' else '[]'::jsonb end)), '{}');
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 if v_from is null then raise exception 'from_not_set'; end if;
 if lower(coalesce(p->>'account','')) <> lower(v_from) then raise exception 'wrong_account'; end if;
 if not (v_scopes @> array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly']) then raise exception 'scope_missing'; end if;
 if coalesce(p->>'refresh_token','') = '' then raise exception 'bad_value'; end if;
 insert into public.invoice_gmail_auth(id, account, refresh_token, scopes, status, connected_at, connected_by, checked_at, checked_by, check_result, last_error, problem_at, updated_at)
 values(1, p->>'account', p->>'refresh_token', v_scopes, 'ok', now(), actor::text, now(), actor::text, p->'check_result', null, null, now())
 on conflict(id) do update set account=excluded.account, refresh_token=excluded.refresh_token, scopes=excluded.scopes, status='ok',
  connected_at=now(), connected_by=excluded.connected_by, checked_at=now(), checked_by=excluded.checked_by, check_result=excluded.check_result,
  last_error=null, problem_at=null, updated_at=now();
 perform public.invoice_event(null, null, actor::text, 'gmail_connected', jsonb_build_object('account', p->>'account'));
 return public.invoice_gmail_public('{}'::jsonb);
end $$;

-- For the function only (service role): the token to send with.
create or replace function public.invoice_gmail_creds(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('account', g.account, 'refresh_token', g.refresh_token, 'status', g.status, 'scopes', to_jsonb(g.scopes),
  'from', nullif(public.invoice_setting('qb')->>'from', ''))
 from public.invoice_gmail_auth g where g.id = 1 and g.refresh_token is not null;
$$;

-- A check's result (a person's 確かめる) or a problem the function met (the permission taken back, a scope refused).
create or replace function public.invoice_gmail_mark(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.invoice_gmail_auth; s text := p->>'status';
begin
 select * into g from public.invoice_gmail_auth where id=1 for update;
 if g.id is null or g.refresh_token is null then return jsonb_build_object('ok', false); end if;
 if s is not null and s not in ('ok','expired','denied') then raise exception 'bad_state'; end if;
 if nullif(p->>'actor','') is not null then perform public.invoice_require((p->>'actor')::uuid, array['ceo','gm']); end if;
 update public.invoice_gmail_auth set status=coalesce(s, status), last_error=case when p ? 'error' then left(p->>'error', 200) else last_error end,
  problem_at=case when s in ('expired','denied') and g.status = 'ok' then now() when s = 'ok' then null else problem_at end,
  checked_at=case when p ? 'check_result' then now() else checked_at end, checked_by=case when p ? 'check_result' then coalesce(p->>'actor', 'worker') else checked_by end,
  check_result=case when p ? 'check_result' then p->'check_result' else check_result end, updated_at=now()
 where id=1;
 if s is not null and s <> g.status then perform public.invoice_event(null, null, coalesce(nullif(p->>'actor',''), 'worker'), 'gmail_'||s, jsonb_build_object('error', left(p->>'error', 200))); end if;
 return jsonb_build_object('ok', true, 'changed', s is not null and s <> g.status);
end $$;

-- 切る (CEO・GM): the token is forgotten here. Nothing asks Google to take it back (the Drive connection may share the grant).
create or replace function public.invoice_gmail_disconnect(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 update public.invoice_gmail_auth set refresh_token=null, status='disconnected', last_error=null, updated_at=now() where id=1;
 perform public.invoice_event(null, null, actor::text, 'gmail_disconnected', '{}');
 return public.invoice_gmail_public('{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- 4) one send
-- Rows of this system ready to be reserved (the function starts Gmail only when there is one), while this system is the sender and
-- the Gmail connection is good: with the route given back or the permission taken back, nothing is reserved and the rows wait
-- (their tries are not used up). A person's つなぎ直す or 確かめる sets the connection good again.
create or replace function public.invoice_qb_has_due(p jsonb) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(public.invoice_setting('qb')->>'route', '') = 'invoice-intake'
  and exists(select 1 from public.invoice_gmail_auth where id=1 and status='ok' and refresh_token is not null)
  and exists(select 1 from public.invoice_qb_outbox where route='invoice-intake' and state in ('pending','error') and (next_at is null or next_at<=now()) and attempts < 5);
$$;

-- What a reserved row is sent as, with the settings read again (enabled, the address, the start, the rename, the sender).
-- why: not_reserved (another sender has it, or the reservation is gone) · qb_off · route_changed · to_changed · before_since ·
-- not_posted · rename_waiting · content_changed (the database already knows a new content) · gmail_not_ok · sender_mismatch.
-- route_changed and gmail_not_ok let the row go (invoice_qb_release: it waits, the try is not counted).
create or replace function public.invoice_qb_send_context(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; f public.invoice_files; q jsonb := public.invoice_setting('qb'); g public.invoice_gmail_auth; v_why text;
begin
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid;
 if o.id is null or o.state <> 'sending' or o.reserved_by is distinct from p->>'owner' then return jsonb_build_object('ok', false, 'why', 'not_reserved'); end if;
 select * into f from public.invoice_files where id=o.file_id;
 select * into g from public.invoice_gmail_auth where id=1;
 v_why := case
  when not coalesce((q->>'enabled')::boolean, false) then 'qb_off'
  when coalesce(q->>'route', '') <> 'invoice-intake' then 'route_changed'
  when o.to_address is distinct from q->>'to' then 'to_changed'
  when not coalesce(f.drive_created_at >= public.invoice_qb_since_at(), false) then 'before_since'
  when f.intake_status <> 'posted' then 'not_posted'
  when f.current_sha256 is distinct from o.sha256 then 'content_changed'
  when public.invoice_rename_waiting(f.id) then 'rename_waiting'
  when g.id is null or g.status is distinct from 'ok' or g.refresh_token is null then 'gmail_not_ok'
  when g.account is null or lower(g.account) <> lower(coalesce(q->>'from','')) then 'sender_mismatch'
 end;
 if v_why is not null then return jsonb_build_object('ok', false, 'why', v_why); end if;
 return jsonb_build_object('ok', true, 'to', o.to_address, 'from', g.account, 'attempt_key', o.attempt_key, 'sha256', o.sha256,
  'reserved_at', o.reserved_at, 'file', jsonb_build_object('id', f.id, 'drive_file_id', f.drive_file_id, 'current_name', f.current_name, 'mime_type', f.mime_type,
   'size', (select v.size_bytes from public.invoice_file_versions v where v.file_id=f.id and v.sha256=o.sha256 limit 1)));
end $$;

-- Just before sending: the reservation is still this sender's and young enough to send and record within the 15 minutes
-- (13 minutes are left at most for the reading before), and the row, the original and the settings are what was read.
create or replace function public.invoice_qb_send_check(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; f public.invoice_files; c jsonb;
begin
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid;
 if o.id is null or o.state <> 'sending' or o.reserved_by is distinct from p->>'owner' then return jsonb_build_object('ok', false, 'why', 'not_reserved'); end if;
 if o.reserved_at < now() - interval '13 minutes' then return jsonb_build_object('ok', false, 'why', 'reservation_expired'); end if;
 select * into f from public.invoice_files where id=o.file_id;
 if o.sha256 is distinct from p->>'sha256' or o.attempt_key is distinct from p->>'attempt_key' or f.drive_file_id is distinct from p->>'drive_file_id' then
  return jsonb_build_object('ok', false, 'why', 'row_changed');
 end if;
 c := public.invoice_qb_send_context(jsonb_build_object('id', o.id, 'owner', p->>'owner'));
 if not (c->>'ok')::boolean then return c; end if;
 return jsonb_build_object('ok', true);
end $$;

-- A reserved row let go without a try (the route was given back, the connection is no longer good, Gmail refused the permission):
-- it waits as before, its try is not counted. Only the sender that holds the reservation lets it go.
create or replace function public.invoice_qb_release(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox;
begin
 update public.invoice_qb_outbox set state='pending', attempts=greatest(attempts-1, 0), reserved_by=null, reserved_at=null,
  last_error=left(p->>'error', 300), next_at=null, updated_at=now()
 where id=(p->>'id')::uuid and state='sending' and reserved_by is not distinct from p->>'owner'
 returning * into o;
 if o.id is null then return jsonb_build_object('ok', false); end if;
 perform public.invoice_event(null, o.file_id, 'worker', 'qb_released', jsonb_build_object('error', left(p->>'error', 300)));
 return jsonb_build_object('ok', true);
end $$;

-- For 確かめる: the newest original already sent to this address (the forwarder before's first; with or without a Gmail ID),
-- to look it up in the sent mail the way every send does before sending (the search is checked on real mail before the switch).
create or replace function public.invoice_qb_probe_row(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select to_jsonb(x) from (
  select o.id, o.route, o.sha256, o.to_address, o.attempt_key, o.message_id, o.sent_at, f.drive_file_id, f.current_name,
   (select v.size_bytes from public.invoice_file_versions v where v.file_id=f.id and v.sha256=o.sha256 limit 1) size
  from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  where o.state='sent' and o.route in ('external','invoice-intake') and o.to_address = public.invoice_setting('qb')->>'to'
  order by (o.route = 'external') desc, o.sent_at desc nulls last limit 1) x;
$$;

-- The Drive bytes are not the content that was posted and queued: the row is set aside (nothing was sent) and the original is
-- checked again soon (a new content goes to review as before). A person is told (content_changed).
create or replace function public.invoice_qb_content_changed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; f public.invoice_files;
begin
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid for update;
 if o.id is null or o.state <> 'sending' or o.reserved_by is distinct from p->>'owner' then return jsonb_build_object('ok', false); end if;
 update public.invoice_qb_outbox set state='cancelled', last_error='content_changed', next_at=null, updated_at=now() where id=o.id;
 update public.invoice_files set drive_checked_at=null where id=o.file_id returning * into f;
 perform public.invoice_event(null, o.file_id, 'worker', 'qb_content_changed', jsonb_build_object('outbox_id', o.id));
 perform public.invoice_qb_alert_put(jsonb_build_object('kind', 'content_changed', 'key', 'content_changed:' || o.id,
  'data', jsonb_build_object('name', f.current_name, 'store', f.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=f.store_id), 'outbox_id', o.id, 'drive_file_id', f.drive_file_id)));
 return jsonb_build_object('ok', true);
end $$;

-- Unknown sends of this system looked for in the sent mail: after 15 minutes, then 30, 60 … (six times at most).
create or replace function public.invoice_qb_unknown_due(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select o.id, o.sha256, o.to_address, o.attempt_key, f.drive_file_id, f.current_name,
   (select v.size_bytes from public.invoice_file_versions v where v.file_id=f.id and v.sha256=o.sha256 limit 1) size
  from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  where o.route='invoice-intake' and o.state='unknown' and o.gmail_checks < 6
   and coalesce(o.gmail_checked_at, o.updated_at) < now() - make_interval(mins => 15 * power(2, o.gmail_checks)::int)
  order by o.updated_at limit least(coalesce((p->>'limit')::int, 5), 20)) x;
$$;

create or replace function public.invoice_qb_gmail_checked(p jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 update public.invoice_qb_outbox set gmail_checked_at=now(), gmail_checks=gmail_checks+1 where id=(p->>'id')::uuid and state='unknown';
$$;

-- One row for a person's 「Gmail の送信済みを調べる」 (accounting, 事務Crew, GM, CEO; decision 4A).
create or replace function public.invoice_qb_row(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return (select jsonb_build_object('id', o.id, 'state', o.state, 'route', o.route, 'sha256', o.sha256, 'to_address', o.to_address, 'attempt_key', o.attempt_key,
   'drive_file_id', f.drive_file_id, 'current_name', f.current_name,
   'size', (select v.size_bytes from public.invoice_file_versions v where v.file_id=f.id and v.sha256=o.sha256 limit 1))
  from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id where o.id=(p->>'id')::uuid);
end $$;

-- (replaced) a result: as before, and a person who checked the sent mail and sends an unknown row again gives it one more try
-- (a row that had used its five tries would otherwise wait forever, told to nobody). Never more than one, never a reset.
create or replace function public.invoice_qb_result(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.invoice_qb_outbox; s text := p->>'state';
begin
 if s not in ('sent','error','unknown','pending') then raise exception 'bad_state'; end if;
 select * into o from public.invoice_qb_outbox where id=(p->>'id')::uuid for update;
 if o.id is null then raise exception 'not_found'; end if;
 -- A person (accounting, 事務Crew, GM, CEO) may only settle an unknown result after checking the sender's records.
 if nullif(p->>'actor','') is not null and p->>'actor' <> 'external' then
  perform public.invoice_require((p->>'actor')::uuid, array['ceo','gm','office','office_crew']);
  if o.state <> 'unknown' or s not in ('sent','pending') then raise exception 'invalid_state'; end if;
 end if;
 -- The external sender may only report on its own rows, and only after reserving them.
 if p->>'actor' = 'external' and (o.route <> 'external' or o.state not in ('sending','unknown') or s = 'pending') then raise exception 'invalid_state'; end if;
 if s='pending' then
  -- Only a person who checked the sender's records may re-queue an unknown send.
  if o.state<>'unknown' then raise exception 'invalid_state'; end if;
  perform public.invoice_require(nullif(p->>'actor','')::uuid, array['ceo','gm','office','office_crew']);
 end if;
 if o.state='sent' then return jsonb_build_object('ok', true, 'state', 'sent'); end if;
 update public.invoice_qb_outbox set state=s, sent_at=case when s='sent' then now() else sent_at end,
  message_id=coalesce(p->>'message_id', message_id), result=coalesce(p->'result', result), last_error=left(p->>'error',300),
  next_at=case when s='error' then now() + make_interval(mins => least(720, 15 * power(2, least(attempts,5))::int)) end,
  -- a person who checked the sent mail and sends again gives one more try (no more): a row that had used its five would wait forever
  attempts=case when s='pending' then least(attempts, 4) else attempts end, updated_at=now()
 where id=o.id;
 perform public.invoice_event(null, o.file_id, coalesce(p->>'actor','worker'), 'qb_'||s, jsonb_build_object('message_id', p->>'message_id', 'error', left(p->>'error',300)));
 return jsonb_build_object('ok', true, 'state', s);
end $$;

-- ---------------------------------------------------------------- 5) the 取込状況 card
-- monitor: the forwarder before reads it with its own key (the function decides that; a person's call is always checked).
create or replace function public.invoice_qb_status(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 if coalesce(p->>'monitor', '') <> 'true' then perform public.invoice_require(actor, array['ceo','gm','office','office_crew']); end if;
 return jsonb_build_object(
  'counts', (select coalesce(jsonb_object_agg(r, s), '{}') from (select route r, jsonb_object_agg(state, n) s from (
     select route, state, count(*) n from public.invoice_qb_outbox where state <> 'cancelled' or last_error = 'content_changed' group by route, state) a group by route) b),
  'stopped', (select count(*) from public.invoice_qb_outbox where route='invoice-intake' and state='error' and attempts >= 5),
  'waiting_30', (select count(*) from public.invoice_qb_outbox where route='invoice-intake' and state in ('pending','error') and attempts < 5 and created_at < now() - interval '30 minutes'),
  'external_waiting', (select count(*) from public.invoice_qb_outbox where route='external' and state in ('pending','error','sending') and attempts < 5),
  'oldest_waiting', (select min(created_at) from public.invoice_qb_outbox where route='invoice-intake' and state in ('pending','error','sending') and attempts < 5),
  'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]') from (
     select o.id, o.route, o.state, o.attempts, o.next_at, o.last_error, o.message_id, o.created_at, o.reserved_at, o.sent_at, o.updated_at, o.result,
      f.store_id, f.current_name, f.drive_file_id, f.renamed_at, (select max(d.posted_at) from public.invoice_docs d where d.file_id=f.id and d.status='posted') posted_at
     from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
     where o.state <> 'cancelled' or o.last_error = 'content_changed'
     order by o.updated_at desc limit least(coalesce((p->>'limit')::int, 40), 100)) x),
  -- What needs a person (unknown, or this system's row that used its five tries), oldest first, apart from the recent rows: an old
  -- one is never pushed out of sight by newer sends.
  'open_total', (select count(*) from public.invoice_qb_outbox where state='unknown' or (route='invoice-intake' and state='error' and attempts >= 5)),
  'open', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at), '[]') from (
     select o.id, o.route, o.state, o.attempts, o.next_at, o.last_error, o.message_id, o.created_at, o.reserved_at, o.sent_at, o.updated_at, o.result,
      f.store_id, f.current_name, f.drive_file_id, f.renamed_at, (select max(d.posted_at) from public.invoice_docs d where d.file_id=f.id and d.status='posted') posted_at
     from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
     where o.state='unknown' or (o.route='invoice-intake' and o.state='error' and o.attempts >= 5)
     order by o.updated_at limit 100) x),
  'notices_failed', (select count(*) from public.invoice_qb_alerts where created_at > now() - interval '7 days' and (email_state='failed' or line_state='failed')),
  'gmail', public.invoice_gmail_public('{}'::jsonb),
  'qb', public.invoice_setting('qb'),
  'notify', public.invoice_setting('qb_notify'));
end $$;

-- ---------------------------------------------------------------- 6) notices to Moto
-- The app's copy: the 50 latest notices meant for the app (the app only reads it; app_state is readable with the app's key, so it
-- carries names, counts and times only).
create or replace function public.invoice_qb_alerts_publish(p jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.app_state(key, value, updated_at)
 values('invoice_qb_alerts', jsonb_build_object('v', 1, 'at', now(), 'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'data', a.data, 'at', a.created_at) order by a.created_at desc), '[]')
   from (select * from public.invoice_qb_alerts where app order by created_at desc limit 50) a)), now())
 on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
$$;

-- A notice, made once (its key). A channel turned off is marked so and never delivered.
create or replace function public.invoice_qb_alert_put(p jsonb) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n jsonb := public.invoice_setting('qb_notify'); v_id uuid;
begin
 insert into public.invoice_qb_alerts(key, kind, data, app, email_state, line_state)
 values(p->>'key', p->>'kind', coalesce(p->'data', '{}'), coalesce((n->>'app')::boolean, true),
  case when coalesce((n->>'email')::boolean, true) then 'pending' else 'off' end, case when coalesce((n->>'line')::boolean, true) then 'pending' else 'off' end)
 on conflict(key) do nothing returning id into v_id;
 if v_id is null then return false; end if;
 perform public.invoice_qb_alerts_publish('{}'::jsonb);
 return true;
end $$;

-- Looks for what to tell, from the moment this system took over (qb.route_since). Each notice once:
-- first_sent (the first mail this system sent itself), unknown (each time a row becomes unknown), error_final (a row that used its
-- five tries), backlog (once a Hawaii day: something of this system waiting more than 30 minutes, or unknown or stopped for 12 hours,
-- or the forwarder before still has rows after 3 hours), intake_error and rename_error (an original that failed three times).
create or replace function public.invoice_qb_alert_scan(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare rs timestamptz; v_n int := 0; r record; v_day text := to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM-DD');
 w30 int; unk int; stp int; ext int;
begin
 begin rs := nullif(public.invoice_setting('qb')->>'route_since', '')::timestamptz; exception when others then rs := null; end;
 if rs is null then return jsonb_build_object('made', 0); end if;
 perform pg_advisory_xact_lock(hashtext('invoice_qb_alert_scan'));
 for r in select o.id, o.sent_at, o.created_at, o.reserved_at, o.message_id, f.current_name, f.store_id, f.renamed_at,
   (select max(d.posted_at) from public.invoice_docs d where d.file_id=f.id and d.status='posted') posted_at
  from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  where o.route='invoice-intake' and o.state='sent' and o.sent_at >= rs and o.result->>'via' = 'gmail' order by o.sent_at limit 1 loop
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'first_sent', 'key', 'first_sent:' || rs::text, 'data', jsonb_build_object('name', r.current_name, 'store', r.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=r.store_id),
     'posted_at', r.posted_at, 'renamed_at', r.renamed_at, 'queued_at', r.created_at, 'started_at', r.reserved_at, 'sent_at', r.sent_at, 'message_id', r.message_id))) then v_n := v_n + 1; end if;
 end loop;
 -- Each kind leaves out what was already told before taking 20, so the next scan goes on to what is not told yet.
 -- unknown: once per unknown (the try, and how many times a person sent it again: a resend can end unknown at the same try).
 for r in select o.id, o.route, o.attempts, o.last_error, o.updated_at, f.current_name, f.store_id, k.key from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  cross join lateral (select 'unknown:' || o.id || ':' || o.attempts || ':'
     || (select count(*) from public.invoice_events e where e.file_id = o.file_id and e.kind = 'qb_pending') as key) k
  where o.state='unknown' and o.updated_at >= rs and not exists(select 1 from public.invoice_qb_alerts a where a.key = k.key) order by o.updated_at limit 20 loop
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'unknown', 'key', r.key, 'data', jsonb_build_object('name', r.current_name,
     'store', r.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=r.store_id), 'outbox_id', r.id, 'route', r.route, 'error', r.last_error, 'at', r.updated_at))) then v_n := v_n + 1; end if;
 end loop;
 for r in select o.id, o.route, o.attempts, o.last_error, o.updated_at, f.current_name, f.store_id from public.invoice_qb_outbox o join public.invoice_files f on f.id=o.file_id
  where o.state='error' and o.attempts >= 5 and o.updated_at >= rs and not exists(select 1 from public.invoice_qb_alerts a where a.key = 'error_final:' || o.id)
  order by o.updated_at limit 20 loop
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'error_final', 'key', 'error_final:' || r.id, 'data', jsonb_build_object('name', r.current_name,
     'store', r.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=r.store_id), 'outbox_id', r.id, 'route', r.route, 'error', r.last_error, 'attempts', r.attempts, 'at', r.updated_at))) then v_n := v_n + 1; end if;
 end loop;
 for r in select f.id, f.current_name, f.store_id, f.intake_status, f.last_error, f.updated_at from public.invoice_files f
  where ((f.intake_status = 'error' and f.attempts >= 3) or f.intake_status = 'unsupported') and f.updated_at >= rs
   and not exists(select 1 from public.invoice_qb_alerts a where a.key = 'intake_error:' || f.id || ':' || f.intake_status) order by f.updated_at limit 20 loop
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'intake_error', 'key', 'intake_error:' || r.id || ':' || r.intake_status, 'data', jsonb_build_object('name', r.current_name,
     'store', r.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=r.store_id), 'status', r.intake_status, 'error', left(r.last_error, 120), 'at', r.updated_at))) then v_n := v_n + 1; end if;
 end loop;
 for r in select f.id, f.current_name, f.store_id, f.rename_error, f.updated_at from public.invoice_files f
  where f.rename_state = 'error' and f.rename_attempts >= 3 and f.updated_at >= rs
   and not exists(select 1 from public.invoice_qb_alerts a where a.key = 'rename_error:' || f.id) order by f.updated_at limit 20 loop
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'rename_error', 'key', 'rename_error:' || r.id, 'data', jsonb_build_object('name', r.current_name,
     'store', r.store_id, 'store_label', (select s.label from public.invoice_stores s where s.store_id=r.store_id), 'error', left(r.rename_error, 120), 'at', r.updated_at))) then v_n := v_n + 1; end if;
 end loop;
 select count(*) into w30 from public.invoice_qb_outbox where route='invoice-intake' and state in ('pending','error') and attempts < 5 and created_at < now() - interval '30 minutes' and created_at >= rs;
 select count(*) into unk from public.invoice_qb_outbox where state='unknown' and updated_at < now() - interval '12 hours' and updated_at >= rs;
 select count(*) into stp from public.invoice_qb_outbox where state='error' and attempts >= 5 and updated_at < now() - interval '12 hours' and updated_at >= rs;
 select count(*) into ext from public.invoice_qb_outbox where route='external' and state in ('pending','error','sending') and attempts < 5 and created_at < now() - interval '3 hours';
 if w30 + unk + stp + ext > 0 then
  if public.invoice_qb_alert_put(jsonb_build_object('kind', 'backlog', 'key', 'backlog:' || v_day, 'data', jsonb_build_object('waiting', w30, 'unknown', unk, 'stopped', stp,
     'external', ext, 'oldest', (select min(created_at) from public.invoice_qb_outbox where route='invoice-intake' and state in ('pending','error') and attempts < 5),
     'gmail', (select status from public.invoice_gmail_auth where id=1)))) then v_n := v_n + 1; end if;
 end if;
 return jsonb_build_object('made', v_n);
end $$;

-- Notices to deliver on one channel (each claimed by one run; three tries).
create or replace function public.invoice_qb_alert_claim(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare ch text := p->>'channel'; r jsonb;
begin
 if ch = 'email' then
  with c as (select id from public.invoice_qb_alerts where email_state='pending' or (email_state='sending' and email_at < now() - interval '10 minutes' and email_tries < 3)
             order by created_at limit least(coalesce((p->>'limit')::int, 10), 20) for update skip locked),
   u as (update public.invoice_qb_alerts a set email_state='sending', email_tries=email_tries+1, email_at=now() from c where a.id=c.id
         returning a.id, a.kind, a.data, a.created_at, a.email_tries tries)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'data', u.data, 'created_at', u.created_at, 'tries', u.tries) order by u.created_at), '[]') into r from u;
 elsif ch = 'line' then
  with c as (select id from public.invoice_qb_alerts where line_state='pending' or (line_state='sending' and line_at < now() - interval '10 minutes' and line_tries < 3)
             order by created_at limit least(coalesce((p->>'limit')::int, 10), 20) for update skip locked),
   u as (update public.invoice_qb_alerts a set line_state='sending', line_tries=line_tries+1, line_at=now() from c where a.id=c.id
         returning a.id, a.kind, a.data, a.created_at, a.line_tries tries)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'data', u.data, 'created_at', u.created_at, 'tries', u.tries) order by u.created_at), '[]') into r from u;
 else raise exception 'bad_value';
 end if;
 return r;
end $$;

create or replace function public.invoice_qb_alert_done(p jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s text := p->>'state';
begin
 if s not in ('sent','failed','skipped','pending') then raise exception 'bad_state'; end if;
 if p->>'channel' = 'email' then
  update public.invoice_qb_alerts set email_state=case when s='pending' and email_tries >= 3 then 'failed' else s end, email_at=now() where id=(p->>'id')::uuid and email_state='sending';
 elsif p->>'channel' = 'line' then
  update public.invoice_qb_alerts set line_state=case when s='pending' and line_tries >= 3 then 'failed' else s end, line_at=now() where id=(p->>'id')::uuid and line_state='sending';
 else raise exception 'bad_value';
 end if;
end $$;

-- The LINE group of 本部業務連絡 (the operations bot's finance route, decision 1A), when the bot is set up and the group enabled.
create or replace function public.invoice_line_route(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare cfg jsonb; ok boolean;
begin
 if to_regclass('public.bot_settings') is null or to_regclass('public.bot_groups') is null then return null; end if;
 execute 'select value from public.bot_settings where key = $1' into cfg using 'morning_summary';
 if cfg is null or coalesce(cfg->'routes'->'finance'->>'group_id', '') !~* '^C[a-f0-9]{32}$' then return null; end if;
 execute 'select exists(select 1 from public.bot_groups where group_id = $1 and enabled)' into ok using cfg->'routes'->'finance'->>'group_id';
 if not ok then return null; end if;
 return jsonb_build_object('group_id', cfg->'routes'->'finance'->>'group_id', 'label', cfg->'routes'->'finance'->>'label');
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_gmail_public(jsonb)','invoice_gmail_start(jsonb)','invoice_gmail_take(jsonb)','invoice_gmail_save(jsonb)',
   'invoice_gmail_creds(jsonb)','invoice_gmail_mark(jsonb)','invoice_gmail_disconnect(jsonb)','invoice_qb_has_due(jsonb)','invoice_qb_send_context(jsonb)',
   'invoice_qb_send_check(jsonb)','invoice_qb_content_changed(jsonb)','invoice_qb_unknown_due(jsonb)','invoice_qb_gmail_checked(jsonb)','invoice_qb_row(jsonb)',
   'invoice_qb_status(jsonb)','invoice_qb_alerts_publish(jsonb)','invoice_qb_alert_put(jsonb)','invoice_qb_alert_scan(jsonb)','invoice_qb_alert_claim(jsonb)',
   'invoice_qb_alert_done(jsonb)','invoice_line_route(jsonb)','invoice_qb_release(jsonb)','invoice_qb_probe_row(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
