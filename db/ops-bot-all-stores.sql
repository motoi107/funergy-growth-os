-- All-store routing remains explicitly opted in; existing store groups keep their scope.
alter table public.bot_groups add column all_stores boolean not null default false;
alter table public.bot_groups add constraint bot_group_scope check (not all_stores or store_id is null);
alter table public.bot_cases add column assignee text not null default '' check (length(assignee)<=120);

create or replace function public.bot_case_write(p_op text, p_actor uuid, p_id uuid default null, p_version integer default null, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases; r text; n integer; target text;
begin
 if p_actor is not null then
  select role into r from public.manager_auth where user_id=p_actor;
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
 update public.bot_cases set payload=c.payload,status=c.status,assignee=c.assignee,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,p_op,p_data);
 return to_jsonb(c);
end $$;

create or replace function public.bot_ingest(p_event_id text,p_group text,p_user text,p_text text,p_type text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.bot_groups; c public.bot_cases; e bigint; ref text; target_store text; store_hint text; report text;
begin
 insert into public.bot_groups(group_id) values(p_group) on conflict do nothing;
 select * into g from public.bot_groups where group_id=p_group;
 if p_type='leave' then update public.bot_groups set enabled=false,updated_at=now() where group_id=p_group; return '{"left":true}'; end if;
 if not g.enabled or (not g.all_stores and g.store_id is null) or p_type<>'message' then return '{"ignored":true}'; end if;
 ref=upper(substring(p_text from '[Bb]-[A-Fa-f0-9]{12}'));
 if ref is not null then select * into c from public.bot_cases where code=ref and (g.all_stores or store_id=g.store_id) for update; end if;
 if ref is not null and c.id is null then return '{"ignored":true}'; end if;
 if c.id is null and p_text !~* '^(発注依頼|/order|order request)([[:space:]:：]|$)' then return '{"ignored":true}'; end if;
 insert into public.bot_events(event_key,kind,data) values(p_event_id,'line_received',jsonb_build_object('group',p_group,'sender',p_user,'text',left(p_text,5000))) on conflict(event_key) do nothing returning id into e;
 if e is null then return '{"duplicate":true}'; end if;
 if c.id is null then
  target_store=g.store_id;
  if g.all_stores then
   store_hint=substring(p_text from '^[^[]*\[([^]]+)\]');
   select min(store_id) into target_store from public.store_config
    where active and (lower(store_id)=lower(trim(store_hint)) or lower(name)=lower(trim(store_hint)))
    having count(*)=1;
   if target_store is null then
    update public.bot_events set kind='line_needs_store' where id=e;
    return jsonb_build_object('accepted',true,'needs_store',true);
   end if;
  end if;
  insert into public.bot_cases(source_key,kind,store_id,business_date,subject,payload,assignee)
  values('line:'||p_event_id,'purchase',target_store,(now() at time zone 'Pacific/Honolulu')::date,left(p_text,160),jsonb_build_object('request',left(p_text,5000),'group_id',p_group,'sender',p_user),coalesce((select value->>'name' from public.bot_settings where key='owner:'||target_store),'')) returning * into c;
 else
  -- An explicit report immediately after the case code; negatives/free-form text stay notes.
  report=trim(regexp_replace(p_text,'^.*[Bb]-[A-Fa-f0-9]{12}[][:space:]:：-]*',''));
  if c.status<>'done' and report ~* '^(修正済み?|修正しました|対応済み?|対応しました|完了しました|完了|corrected|fixed|completed|done)([[:space:]。.!！,:：]|$)' then
  update public.bot_cases set status='verify',version=version+1,updated_at=now() where id=c.id returning * into c;
  else
  update public.bot_cases set version=version+1,updated_at=now() where id=c.id returning * into c;
  end if;
 end if;
 update public.bot_events set case_id=c.id where id=e;
 return jsonb_build_object('accepted',true,'case_id',c.id);
end $$;

create or replace function public.bot_reserve_send(p_actor uuid,p_id uuid,p_version integer,p_request uuid,p_group text,p_body text) returns jsonb
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
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and (all_stores or store_id=c.store_id)) then raise exception 'group_not_enabled'; end if;
 update public.bot_cases set version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_outbox(id,case_id,group_id,actor,body,case_version) values(p_request,c.id,p_group,p_actor,p_body,c.version) returning * into o;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,'send_approved',jsonb_build_object('outbox',o.id,'group',p_group,'text',p_body));
 return to_jsonb(o);
end $$;

-- Resolve an all-store purchase intake without guessing its store or dropping its text.
create function public.bot_assign_intake(p_actor uuid,p_event bigint,p_store text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events; c jsonb; r text;
begin
 select role into r from public.manager_auth where user_id=p_actor;
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
revoke all on function public.bot_assign_intake(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bot_assign_intake(uuid,bigint,text) to service_role;
