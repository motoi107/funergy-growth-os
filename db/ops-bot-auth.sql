-- Bot access is independent of manager_auth; no users are provisioned here.
create table public.bot_users (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.bot_users enable row level security;
revoke all on public.bot_users from public,anon,authenticated;
grant select,insert,update,delete on public.bot_users to service_role;

-- Called only by service-role RPCs; never gives a manager_auth membership.
create function public.bot_actor_role(p_actor uuid) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(
  (select role from public.manager_auth where user_id=p_actor and role in ('ceo','gm','office','office_crew')),
  (select 'office_crew'::text from public.bot_users where user_id=p_actor and enabled)
 );
$$;
revoke all on function public.bot_actor_role(uuid) from public,anon,authenticated;
grant execute on function public.bot_actor_role(uuid) to service_role;

create or replace function public.bot_case_write(p_op text, p_actor uuid, p_id uuid default null, p_version integer default null, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases; r text; n integer; target text;
begin
 if p_actor is not null then
  select public.bot_actor_role(p_actor) into r;
  if r is null or r not in ('ceo','gm','office','office_crew') then raise exception 'forbidden'; end if;
 elsif p_op not in ('finding','verified') then raise exception 'actor_required'; end if;
 if p_op='finding' then
  insert into public.bot_cases(source_key,kind,store_id,business_date,subject,payload,assignee)
  values(p_data->>'source_key',p_data->>'kind',p_data->>'store_id',(p_data->>'business_date')::date,p_data->>'subject',p_data->'payload',coalesce((select value->>'name' from public.bot_settings where key='owner:'||(p_data->>'store_id')),''))
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
 if p_op='assign' then
  if r not in ('gm','ceo','office') then raise exception 'forbidden'; end if;
  if c.status='done' then raise exception 'closed_case'; end if;
  if length(trim(coalesce(p_data->>'assignee',''))) not between 1 and 120 then raise exception 'assignee_required'; end if;
  c.assignee=trim(p_data->>'assignee');
 elsif p_op='note' then
  if length(coalesce(p_data->>'note','')) not between 1 and 4000 then raise exception 'note_required'; end if;
 elsif p_op='draft' then
  if length(coalesce(p_data->>'draft','')) not between 1 and 4500 then raise exception 'draft_required'; end if;
  c.payload=c.payload||jsonb_build_object('draft',p_data->>'draft');
 elsif p_op='correction' then
  if c.status='done' then raise exception 'closed_case'; end if; c.status='correction';
 elsif p_op='reported' then
  if c.status='done' then raise exception 'closed_case'; end if; c.status='verify';
 elsif p_op='verified' then
  if c.kind not in ('labor','void','unpaid') or coalesce((p_data->>'clean')::boolean,false)=false then raise exception 'verification_required'; end if;
  if c.kind='void' and (c.payload->>'scope' is distinct from 'payment' or p_data->>'verification_type' is distinct from 'payment_void_recovered') then raise exception 'verification_required'; end if;
  if c.kind='unpaid' and p_data->>'verification_type' is distinct from 'unpaid_paid' then raise exception 'verification_required'; end if;
  c.payload=c.payload||jsonb_build_object('verification',p_data); c.status='done';
  if c.kind='unpaid' then c.payload=c.payload||jsonb_build_object('fingerprint','verified:'||(p_data->>'checked_at')); end if;
  c.last_checked_at=now();c.last_check=p_data;
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
 update public.bot_cases set last_checked_at=c.last_checked_at,last_check=c.last_check,payload=c.payload,status=c.status,assignee=c.assignee,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,p_op,p_data);
 return to_jsonb(c);
end $$;
create or replace function public.bot_record_check(p_id uuid,p_version integer,p_actor uuid,p_result jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r text; c public.bot_cases;
begin
 if p_actor is not null then
  select public.bot_actor_role(p_actor) into r;
  if r is null or r not in ('gm','ceo','office','office_crew') then raise exception 'forbidden'; end if;
 end if;
 select * into c from public.bot_cases where id=p_id for update;
 if c.id is null then raise exception 'not_found'; end if;
 if c.version<>p_version then raise exception 'conflict'; end if;
 if c.status='done' then return; end if;
 update public.bot_cases set last_checked_at=now(),last_check=p_result,version=version+1 where id=p_id;
 insert into public.bot_events(case_id,actor,kind,data) values(p_id,p_actor,'verification_checked',p_result);
end $$;

create or replace function public.bot_assign_intake(p_actor uuid,p_event bigint,p_store text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events; c jsonb; r text;
begin
 select public.bot_actor_role(p_actor) into r;
 if r is null or r not in ('gm','ceo','office','office_crew') then raise exception 'forbidden'; end if;
 select * into e from public.bot_events where id=p_event and kind='line_needs_store' for update;
 if e.id is null then raise exception 'not_found'; end if;
 if e.case_id is not null then select to_jsonb(bot_cases) into c from public.bot_cases where id=e.case_id; return c; end if;
 if not exists(select 1 from public.store_config where store_id=p_store and active) then raise exception 'invalid_store'; end if;
 c=public.bot_case_write('finding',p_actor,null,null,jsonb_build_object('source_key','line:'||e.event_key,'kind','purchase','store_id',p_store,'business_date',(e.created_at at time zone 'Pacific/Honolulu')::date,'subject',left(e.data->>'text',160),'payload',jsonb_build_object('request',e.data->>'text','group_id',e.data->>'group','sender',e.data->>'sender')));
 update public.bot_events set case_id=(c->>'id')::uuid where id=e.id;
 insert into public.bot_events(case_id,actor,kind,data) values((c->>'id')::uuid,p_actor,'intake_store_assigned',jsonb_build_object('store_id',p_store));
 return c;
end $$;
