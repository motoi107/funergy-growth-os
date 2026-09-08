-- Additive, service-only storage. Existing Funergy+ tables are not modified.
create table public.bot_settings(key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table public.bot_groups(group_id text primary key, store_id text references public.store_config(store_id), label text not null default '', enabled boolean not null default false, updated_at timestamptz not null default now());
create table public.bot_cases(
 id uuid primary key default gen_random_uuid(), code text not null unique default ('B-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 source_key text not null unique, kind text not null check(kind in ('labor','void','purchase')), store_id text not null references public.store_config(store_id), business_date date not null,
 subject text not null, status text not null default 'review' check(status in ('review','waiting','correction','verify','ready','done')),
 payload jsonb not null default '{}', version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index bot_cases_status_date on public.bot_cases(status, business_date desc);
create table public.bot_events(id bigint generated always as identity primary key, case_id uuid references public.bot_cases(id), event_key text unique, actor uuid, kind text not null, data jsonb not null default '{}', created_at timestamptz not null default now());
create index bot_events_case on public.bot_events(case_id, id desc);
create table public.bot_outbox(id uuid primary key, case_id uuid not null references public.bot_cases(id), group_id text not null references public.bot_groups(group_id), actor uuid not null, body text not null, state text not null default 'pending' check(state in ('pending','sent','failed','unknown')), case_version integer not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index bot_one_unresolved_send on public.bot_outbox(case_id) where state in ('pending','unknown');
create table public.bot_runs(store_id text primary key references public.store_config(store_id), running_until timestamptz, last_success timestamptz, last_error text);
insert into public.bot_settings(key,value) values('worker',jsonb_build_object('enabled',false,'key',gen_random_uuid()::text||gen_random_uuid()::text));

-- All operations are invoked by the verified Edge Function with service_role.
create function public.bot_case_write(p_op text, p_actor uuid, p_id uuid default null, p_version integer default null, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases; r text; n integer; target text;
begin
 if p_actor is not null then
  select role into r from public.manager_auth where user_id=p_actor;
  if r is null or r not in ('ceo','gm','office','office_crew') then raise exception 'forbidden'; end if;
 elsif p_op not in ('finding','verified') then raise exception 'actor_required'; end if;
 if p_op='finding' then
  insert into public.bot_cases(source_key,kind,store_id,business_date,subject,payload)
  values(p_data->>'source_key',p_data->>'kind',p_data->>'store_id',(p_data->>'business_date')::date,p_data->>'subject',p_data->'payload')
  on conflict(source_key) do nothing returning * into c;
  if c.id is null then
   select * into c from public.bot_cases where source_key=p_data->>'source_key' for update;
   if p_data->'payload'->>'fingerprint' is not null and (c.payload->>'fingerprint') is distinct from (p_data->'payload'->>'fingerprint') then
    update public.bot_cases set payload=payload||((p_data->'payload')- 'draft'),status=case when status='done' then 'review' else status end,version=version+1,updated_at=now() where id=c.id returning * into c;
    insert into public.bot_events(case_id,actor,kind) values(c.id,p_actor,'source_changed');
   end if;
   return to_jsonb(c);
  end if;
  insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,'created',jsonb_build_object('source',p_data->>'kind'));
  return to_jsonb(c);
 end if;
 select * into c from public.bot_cases where id=p_id for update;
 if c.id is null then raise exception 'not_found'; end if;
 if c.version<>p_version then raise exception 'conflict'; end if;
 if exists(select 1 from public.bot_outbox where case_id=c.id and state in ('pending','unknown')) then raise exception 'send_unresolved'; end if;
 if p_op='note' then
  if length(coalesce(p_data->>'note','')) not between 1 and 4000 then raise exception 'note_required'; end if;
 elsif p_op='draft' then
  if length(coalesce(p_data->>'draft','')) not between 1 and 4500 then raise exception 'draft_required'; end if;
  c.payload=c.payload||jsonb_build_object('draft',p_data->>'draft');
 elsif p_op='correction' then
  if c.status='done' then raise exception 'closed_case'; end if; c.status='correction';
 elsif p_op='reported' then
  if c.status='done' then raise exception 'closed_case'; end if; c.status='verify';
 elsif p_op='verified' then
  if c.kind<>'labor' or coalesce((p_data->>'clean')::boolean,false)=false then raise exception 'verification_required'; end if;
  c.payload=c.payload||jsonb_build_object('verification',p_data); c.status='done';
 elsif p_op='acknowledge' then
  if c.kind='purchase' then raise exception 'order_number_required'; end if;
  if r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
  if length(coalesce(p_data->>'note','')) not between 1 and 4000 then raise exception 'note_required'; end if;
  c.status='done';
 elsif p_op='purchase' then
  if c.kind<>'purchase' or c.status in ('ready','done') then raise exception 'invalid_state'; end if;
  if (p_data->>'url') !~ '^https://[^/[:space:]]+' or coalesce((p_data->>'quantity')::numeric,0)<=0 then raise exception 'purchase_details_required'; end if;
  c.payload=c.payload||jsonb_build_object('url',p_data->>'url','quantity',p_data->'quantity');
 elsif p_op='approve' then
  if r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
  if c.kind<>'purchase' or c.status not in ('review','waiting','correction','verify') or coalesce(c.payload->>'url','') !~ '^https://' or coalesce((c.payload->>'quantity')::numeric,0)<=0 then raise exception 'purchase_details_required'; end if;
  c.status='ready';
 elsif p_op='ordered' then
  if r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
  if c.kind<>'purchase' or c.status<>'ready' or length(coalesce(p_data->>'order_number','')) not between 1 and 200 then raise exception 'order_number_required'; end if;
  c.status='done'; c.payload=c.payload||jsonb_build_object('order_number',p_data->>'order_number');
 else raise exception 'bad_action'; end if;
 update public.bot_cases set payload=c.payload,status=c.status,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,p_op,p_data);
 return to_jsonb(c);
end $$;

create function public.bot_ingest(p_event_id text,p_group text,p_user text,p_text text,p_type text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.bot_groups; c public.bot_cases; e bigint; ref text;
begin
 insert into public.bot_groups(group_id) values(p_group) on conflict do nothing;
 select * into g from public.bot_groups where group_id=p_group;
 if p_type='leave' then update public.bot_groups set enabled=false,updated_at=now() where group_id=p_group; return '{"left":true}'; end if;
 if not g.enabled or g.store_id is null or p_type<>'message' then return '{"ignored":true}'; end if;
 ref=upper(substring(p_text from '[Bb]-[A-Fa-f0-9]{12}'));
 if ref is not null then select * into c from public.bot_cases where code=ref and store_id=g.store_id for update; end if;
 if c.id is null and p_text !~* '^(発注依頼|/order|order request)([[:space:]:：]|$)' then return '{"ignored":true}'; end if;
 insert into public.bot_events(event_key,kind,data) values(p_event_id,'line_received',jsonb_build_object('group',p_group,'sender',p_user,'text',left(p_text,5000))) on conflict(event_key) do nothing returning id into e;
 if e is null then return '{"duplicate":true}'; end if;
 if c.id is null then
  insert into public.bot_cases(source_key,kind,store_id,business_date,subject,payload)
  values('line:'||p_event_id,'purchase',g.store_id,(now() at time zone 'Pacific/Honolulu')::date,left(p_text,160),jsonb_build_object('request',left(p_text,5000),'group_id',p_group,'sender',p_user)) returning * into c;
 elsif c.status<>'done' and p_text ~* '(修正済|修正しました|corrected|fixed)' then
  update public.bot_cases set status='verify',version=version+1,updated_at=now() where id=c.id returning * into c;
 else
  update public.bot_cases set version=version+1,updated_at=now() where id=c.id returning * into c;
 end if;
 update public.bot_events set case_id=c.id where id=e;
 return jsonb_build_object('accepted',true,'case_id',c.id);
end $$;

create function public.bot_reserve_send(p_actor uuid,p_id uuid,p_version integer,p_request uuid,p_group text,p_body text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases; o public.bot_outbox; r text;
begin
 select role into r from public.manager_auth where user_id=p_actor;
 if r is null or r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
 select * into c from public.bot_cases where id=p_id for update;
 if c.id is null then raise exception 'not_found'; end if;
 select * into o from public.bot_outbox where id=p_request;
 if o.id is not null then
  if o.actor<>p_actor or o.case_id<>p_id or o.group_id<>p_group or o.body<>p_body then raise exception 'retry_mismatch'; end if;
  if o.state='failed' then raise exception 'failed_send_requires_new_review'; end if;
  if o.state<>'sent' and o.created_at<now()-interval '23 hours' then raise exception 'retry_expired_check_line'; end if;
  return to_jsonb(o);
 end if;
 if c.version<>p_version then raise exception 'conflict'; end if;
 if c.status='done' then raise exception 'closed_case'; end if;
 if length(p_body) not between 1 and 4900 then raise exception 'invalid_message'; end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and store_id=c.store_id) then raise exception 'group_not_enabled'; end if;
 update public.bot_cases set version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_outbox(id,case_id,group_id,actor,body,case_version) values(p_request,c.id,p_group,p_actor,p_body,c.version) returning * into o;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,'send_approved',jsonb_build_object('outbox',o.id,'group',p_group,'text',p_body));
 return to_jsonb(o);
end $$;
create function public.bot_finish_send(p_id uuid,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.bot_outbox;
begin
 if p_state not in ('sent','failed','unknown') then raise exception 'bad_state'; end if;
 select * into o from public.bot_outbox where id=p_id for update;
 if o.id is null or o.state='sent' then return; end if;
 update public.bot_outbox set state=p_state,updated_at=now() where id=p_id;
 if p_state='sent' then update public.bot_cases set status='waiting',version=version+1,updated_at=now() where id=o.case_id and version=o.case_version and status in ('review','correction','waiting'); end if;
 insert into public.bot_events(case_id,actor,kind,data) values(o.case_id,o.actor,'send_'||p_state,jsonb_build_object('outbox',p_id));
end $$;
create function public.bot_take_run(p_store text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n integer;
begin
 insert into public.bot_runs(store_id,running_until) values(p_store,now()+interval '5 minutes')
 on conflict(store_id) do update set running_until=excluded.running_until where bot_runs.running_until is null or bot_runs.running_until<now();
 get diagnostics n=row_count; return n>0;
end $$;
-- Explicit service-only grants override Supabase's default grants.
alter table public.bot_settings enable row level security;
alter table public.bot_groups enable row level security;
alter table public.bot_cases enable row level security;
alter table public.bot_events enable row level security;
alter table public.bot_outbox enable row level security;
alter table public.bot_runs enable row level security;
revoke all on public.bot_settings,public.bot_groups,public.bot_cases,public.bot_events,public.bot_outbox,public.bot_runs from public,anon,authenticated;
grant all on public.bot_settings,public.bot_groups,public.bot_cases,public.bot_events,public.bot_outbox,public.bot_runs to service_role;
revoke all on sequence public.bot_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.bot_events_id_seq to service_role;
revoke all on function public.bot_case_write(text,uuid,uuid,integer,jsonb),public.bot_ingest(text,text,text,text,text),public.bot_reserve_send(uuid,uuid,integer,uuid,text,text),public.bot_finish_send(uuid,text),public.bot_take_run(text) from public,anon,authenticated;
grant execute on function public.bot_case_write(text,uuid,uuid,integer,jsonb),public.bot_ingest(text,text,text,text,text),public.bot_reserve_send(uuid,uuid,integer,uuid,text,text),public.bot_finish_send(uuid,text),public.bot_take_run(text) to service_role;

create function public.bot_resolve_send(p_actor uuid,p_id uuid,p_state text,p_note text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r text; o public.bot_outbox;
begin
 select role into r from public.manager_auth where user_id=p_actor;
 if r is null or r not in ('gm','ceo','office') then raise exception 'forbidden'; end if;
 if length(coalesce(p_note,'')) not between 1 and 4000 or p_state not in ('sent','failed') then raise exception 'review_required'; end if;
 select * into o from public.bot_outbox where id=p_id for update;
 if o.id is null or o.state='sent' then raise exception 'invalid_state'; end if;
 perform public.bot_finish_send(p_id,p_state);
 insert into public.bot_events(case_id,actor,kind,data) values(o.case_id,p_actor,'send_manually_reconciled',jsonb_build_object('outbox',p_id,'result',p_state,'note',p_note));
end $$;
revoke all on function public.bot_resolve_send(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.bot_resolve_send(uuid,uuid,text,text) to service_role;
