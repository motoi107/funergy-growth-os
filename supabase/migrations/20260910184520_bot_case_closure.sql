-- Service-only, transactional case closure; no person is enrolled automatically.
lock table public.bot_cases in access exclusive mode;
alter table public.bot_cases add column legacy_code text unique;
update public.bot_cases set legacy_code=code;
create sequence public.bot_case_number_seq;
with numbered as (select id,row_number() over(order by created_at,id) n from public.bot_cases)
update public.bot_cases c set code='#'||n.n from numbered n where c.id=n.id;
select setval('public.bot_case_number_seq',greatest((select count(*) from public.bot_cases),1),(select count(*)>0 from public.bot_cases));
alter table public.bot_cases alter column code set default ('#'||nextval('public.bot_case_number_seq'));
revoke all on sequence public.bot_case_number_seq from public,anon,authenticated;
grant usage,select on sequence public.bot_case_number_seq to service_role;
alter table public.bot_cases drop constraint bot_cases_status_check;
alter table public.bot_cases add constraint bot_cases_status_check check(status in ('review','waiting','correction','verify','hq_review','ready','done'));
alter table public.bot_cases add column due_date date;
alter table public.bot_cases add column closed_at timestamptz;
alter table public.bot_cases add column status_version integer not null default 1;
insert into public.bot_settings(key,value) values('closure_rules','{"finance_hq":true,"unchanged_hq":true,"other_hq":true,"labor_fixed_hq":false,"finance_threshold":0}') on conflict do nothing;

create function public.bot_needs_hq(p_kind text,p_action text,p_amount numeric default null) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
select (p_action='unchanged' and coalesce((value->>'unchanged_hq')::boolean,true))
 or (p_action='other' and coalesce((value->>'other_hq')::boolean,true))
 or (p_kind in ('void','unpaid') and coalesce((value->>'finance_hq')::boolean,true) and (p_amount is null or abs(p_amount)>=coalesce((value->>'finance_threshold')::numeric,0)))
 or (p_kind='labor' and p_action='fixed' and coalesce((value->>'labor_fixed_hq')::boolean,false))
 from public.bot_settings where key='closure_rules';
$$;
create or replace function public.bot_case_write(p_op text, p_actor uuid, p_id uuid default null, p_version integer default null, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases; r text; n integer; target text;
begin
 if p_actor is not null then
  select public.bot_actor_role(p_actor) into r;
  if r is null or r not in ('ceo','gm','office','office_crew') then raise exception 'forbidden'; end if;
 elsif p_op not in ('finding','verified') then raise exception 'actor_required'; end if;
 if p_op='finding' then
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'source_key',0));
  select * into c from public.bot_cases where source_key=p_data->>'source_key' for update;
  if c.id is null then
  insert into public.bot_cases(source_key,kind,store_id,business_date,subject,payload,assignee)
  values(p_data->>'source_key',p_data->>'kind',p_data->>'store_id',(p_data->>'business_date')::date,p_data->>'subject',p_data->'payload',coalesce((select value->>'name' from public.bot_settings where key='owner:'||(p_data->>'store_id')),''))
  on conflict(source_key) do nothing returning * into c;
  else
   select * into c from public.bot_cases where source_key=p_data->>'source_key' for update;
   if p_data->'payload'->>'fingerprint' is not null and c.payload->>'fingerprint' is null then
    update public.bot_cases set payload=payload||jsonb_build_object('fingerprint',p_data->'payload'->>'fingerprint') where id=c.id returning * into c;
   elsif p_data->'payload'->>'fingerprint' is not null and (c.payload->>'fingerprint') is distinct from (p_data->'payload'->>'fingerprint') then
    update public.bot_cases set payload=(payload-'response'-'closure')||((p_data->'payload')- 'draft'),closed_at=null,due_date=null,status='review',version=version+1,updated_at=now() where id=c.id returning * into c;
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
  if c.status in ('done','hq_review') then raise exception 'invalid_state'; end if; c.status='correction';
 elsif p_op='reported' then
  if c.status in ('done','hq_review') then raise exception 'invalid_state'; end if; raise exception 'response_required';
 elsif p_op='verified' then
  if c.kind not in ('labor','void','unpaid') or coalesce((p_data->>'clean')::boolean,false)=false then raise exception 'verification_required'; end if;
  if c.kind='void' and (c.payload->>'scope' is distinct from 'payment' or p_data->>'verification_type' is distinct from 'payment_void_recovered') then raise exception 'verification_required'; end if;
  if c.kind='unpaid' and p_data->>'verification_type' is distinct from 'unpaid_paid' then raise exception 'verification_required'; end if;
  if c.status='done' then return to_jsonb(c); end if;
  c.payload=c.payload||jsonb_build_object('verification',p_data);
  if c.status='correction' and c.payload->'returned' is not null then c.status='correction';
  elsif c.status='hq_review' or public.bot_needs_hq(c.kind,coalesce(c.payload->'response'->>'action','fixed'),case when c.payload->>'amount'~'^-?[0-9]+(\.[0-9]+)?$' then (c.payload->>'amount')::numeric end) then c.status='hq_review';
  else c.status='done';c.closed_at=now(); c.payload=c.payload||jsonb_build_object('closure',jsonb_build_object('type','verified','note','Toast verified','at',now()));end if;
  if c.kind in ('unpaid','labor') and c.status='done' then c.payload=c.payload||jsonb_build_object('fingerprint','verified:'||(p_data->>'checked_at')); end if;
  c.last_checked_at=now();c.last_check=p_data;
 elsif p_op='acknowledge' then
  if c.kind='purchase' then raise exception 'order_number_required'; end if;
  if r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
  if length(coalesce(p_data->>'note','')) not between 1 and 4000 then raise exception 'note_required'; end if;
  raise exception 'hq_review_required';
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
 update public.bot_cases set closed_at=c.closed_at,due_date=c.due_date,last_checked_at=c.last_checked_at,last_check=c.last_check,payload=c.payload,status=c.status,assignee=c.assignee,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,p_op,p_data);
 return to_jsonb(c);
end $$;

create function public.bot_case_respond(p_id uuid,p_version integer,p_action text,p_note text,p_actor uuid default null,p_group text default null,p_user text default null,p_due date default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases;r text;link jsonb;who text;needs boolean;amount numeric;
begin
 select * into c from public.bot_cases where id=p_id for update;
 if c.id is null then raise exception 'not_found';end if;
 if c.version is distinct from p_version then raise exception 'conflict';end if;
 if c.kind not in ('labor','void','unpaid') then raise exception 'invalid_state';end if;
 if p_actor is not null then
  r=public.bot_actor_role(p_actor);who=p_actor::text;
  if r is null or r not in ('ceo','gm','office') then raise exception 'forbidden';end if;
  r='hq';
 else
  if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and (all_stores or store_id=c.store_id)) then raise exception 'forbidden';end if;
  select value into link from public.bot_settings where key='line_responder:'||p_group||':'||p_user;
  if link is null or link->>'enabled' is distinct from 'true' then raise exception 'forbidden';end if;
  if not exists(select 1 from public.manager_auth where user_id=(link->>'approved_by')::uuid and role in ('ceo','gm','office')) then raise exception 'forbidden';end if;
  r=link->>'role';who=link->>'display_name';
  if r not in ('manager','hq') or r is null or (r='manager' and not coalesce((link->'stores') ? c.store_id,false)) then raise exception 'forbidden';end if;
 end if;
 if c.status='done' then raise exception 'closed_case';end if;
 if length(trim(coalesce(p_note,''))) not between 1 and 4000 then raise exception 'note_required';end if;
 if p_action in ('hq_approve','hq_return') then
  if r<>'hq' then raise exception 'forbidden';end if;
  if c.status<>'hq_review' then raise exception 'hq_review_required';end if;
  if p_action='hq_approve' then
   c.status='done';c.closed_at=now();c.due_date=null;
   if c.kind in ('labor','unpaid') and c.payload->'verification'->>'clean'='true' and coalesce(c.payload->'response'->>'action','fixed')='fixed' then c.payload=c.payload||jsonb_build_object('fingerprint','verified:'||now());end if;
   c.payload=c.payload||jsonb_build_object('closure',jsonb_build_object('type','hq_approved','note',trim(p_note),'actor',who,'line_user',p_user,'at',now()));
  else
   c.status='correction';c.due_date=(now() at time zone 'Pacific/Honolulu')::date+1;
   c.payload=(c.payload-'closure')||jsonb_build_object('returned',jsonb_build_object('note',trim(p_note),'actor',who,'at',now()));
  end if;
 elsif p_action in ('fixed','unchanged','other','continue') then
  if c.status='hq_review' then raise exception 'hq_review_required';end if;
  amount=case when c.payload->>'amount'~'^-?[0-9]+(\.[0-9]+)?$' then (c.payload->>'amount')::numeric end;
  needs=coalesce(public.bot_needs_hq(c.kind,p_action,amount),true);
  if p_action='continue' then
   if p_due is null or p_due<(now() at time zone 'Pacific/Honolulu')::date or p_due>(now() at time zone 'Pacific/Honolulu')::date+366 then raise exception 'due_date_required';end if;
   c.status='correction';c.due_date=p_due;
  elsif needs then c.status='hq_review';c.due_date=null;
  elsif p_action='fixed' then c.status='verify';c.due_date=null;
  else c.status='done';c.closed_at=now();c.due_date=null;
   c.payload=c.payload||jsonb_build_object('closure',jsonb_build_object('type',p_action,'note',trim(p_note),'actor',who,'at',now()));
  end if;
  c.payload=(c.payload-'returned')||jsonb_build_object('response',jsonb_build_object('action',p_action,'note',trim(p_note),'actor',who,'line_user',p_user,'group_id',p_group,'at',now(),'due_date',p_due));
 else raise exception 'bad_action';end if;
 update public.bot_cases set status=c.status,payload=c.payload,due_date=c.due_date,closed_at=c.closed_at,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,'case_'||p_action,jsonb_build_object('note',trim(p_note),'actor_name',who,'line_user',p_user,'group',p_group,'status',c.status,'due_date',c.due_date));
 return to_jsonb(c);
end $$;

create function public.bot_reply_ingest(p_event text,p_group text,p_user text,p_text text,p_code text,p_action text default null,p_note text default null,p_due date default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.bot_cases;e public.bot_events;result jsonb;
begin
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled) then return '{"ignored":true}';end if;
 select c0.* into c from public.bot_cases c0 join public.bot_groups g on g.group_id=p_group where (c0.code=p_code or c0.legacy_code=p_code) and (g.all_stores or g.store_id=c0.store_id) for update of c0;
 if c.id is null then return '{"not_found":true}';end if;
 insert into public.bot_events(event_key,case_id,kind,data) values(p_event,c.id,'line_received',jsonb_build_object('group',p_group,'sender',p_user,'text',left(p_text,5000))) on conflict(event_key) do nothing returning * into e;
 if e.id is null then return '{"duplicate":true}';end if;
 if p_action is null then return jsonb_build_object('needs_reply',true,'code',c.code);end if;
 begin
  result=public.bot_case_respond(c.id,c.version,p_action,p_note,null,p_group,p_user,p_due);
 exception when others then
  if sqlerrm in ('forbidden','closed_case','hq_review_required','note_required','due_date_required','invalid_state') then
   result=jsonb_build_object('error',sqlerrm,'code',c.code);
  else raise;end if;
 end;
 update public.bot_events set data=data||jsonb_build_object('result',result-'payload') where id=e.id;
 return result;
end $$;

-- Do not permit old app versions or old LINE parsing to bypass managerial review.
create or replace function public.bot_ingest(p_event_id text,p_group text,p_user text,p_text text,p_type text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.bot_groups; c public.bot_cases; e bigint; ref text; target_store text; store_hint text; report text;
begin
 insert into public.bot_groups(group_id) values(p_group) on conflict do nothing;
 select * into g from public.bot_groups where group_id=p_group;
 if p_type='leave' then update public.bot_groups set enabled=false,updated_at=now() where group_id=p_group; return '{"left":true}'; end if;
 if not g.enabled or (not g.all_stores and g.store_id is null) or p_type<>'message' then return '{"ignored":true}'; end if;
 ref=upper(substring(p_text from '[Bb]-[A-Fa-f0-9]{12}'));
 if ref is not null then select * into c from public.bot_cases where (code=ref or legacy_code=ref) and (g.all_stores or store_id=g.store_id) for update; end if;
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
  if false and c.status<>'done' and report ~* '^(修正済み?|修正しました|対応済み?|対応しました|完了しました|完了|corrected|fixed|completed|done)([[:space:]。.!！,:：]|$)' then
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
 if c.status in ('done','hq_review','verify') then raise exception 'closed_case'; end if;
 if length(p_body) not between 1 and 4900 then raise exception 'invalid_message'; end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and (all_stores or store_id=c.store_id)) then raise exception 'group_not_enabled'; end if;
 update public.bot_cases set version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into public.bot_outbox(id,case_id,group_id,actor,body,case_version) values(p_request,c.id,p_group,p_actor,p_body,c.version) returning * into o;
 insert into public.bot_events(case_id,actor,kind,data) values(c.id,p_actor,'send_approved',jsonb_build_object('outbox',o.id,'group',p_group,'text',p_body));
 return to_jsonb(o);
end $$;

-- Resolve an all-store purchase intake without guessing its store or dropping its text.
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
 update public.bot_cases set last_checked_at=now(),last_check=p_result,status=case when status='verify' and payload->'response'->>'action'='fixed' and (payload->'response'->>'at')::timestamptz<now()-interval '24 hours' and p_result->>'message'='still_flagged_or_manual_review' then 'correction' else status end,version=version+1 where id=p_id;
 insert into public.bot_events(case_id,actor,kind,data) values(p_id,p_actor,'verification_checked',p_result);
end $$;

-- Add actionable case details to the private morning snapshot and support one audited resend variant.
CREATE OR REPLACE FUNCTION public.bot_morning_snapshot(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with overview as(select public.bot_range_overview(p_now) o),
 bounds as(select (o->>'day')::date today_day,(o->>'from')::date from_day,(o->>'to')::date to_day,(o->>'expected')::int expected,(o->>'ok')::int ok,(o->>'failed')::int failed from overview),
 open_cases as(
  select c.code,c.store_id,s.name store_name,c.business_date,c.kind,c.subject,c.assignee,c.status,c.due_date,c.payload->'response' response,c.payload->'returned' returned,
   case when c.status='hq_review' then 'review' when c.status='verify' then 'recheck' when c.status='correction' then 'in_progress' when o.state in ('pending','unknown') then 'send_check' when o.state='failed' and c.status='waiting' then 'reminder_failed' when o.state='failed' then 'notify_failed' when c.status='waiting' or o.state='sent' then 'waiting' when o.state is null then 'not_sent' else 'review' end progress,
   c.payload->>'employee_name' employee_name,c.payload->'kinds' kinds,coalesce((c.payload->>'open_shift')::boolean,false) open_shift,
   case when c.payload->>'amount'~'^-?[0-9]+(?:\.[0-9]+)?$' then (c.payload->>'amount')::numeric end amount,
   c.payload->>'user_name' user_name,c.payload->>'approver_name' approver_name,c.payload->>'reason' reason
  from bounds b join public.bot_cases c on c.business_date<=b.to_day join public.store_config s on s.store_id=c.store_id
  left join lateral(select x.state from public.bot_outbox x where x.case_id=c.id order by x.created_at desc,x.id desc limit 1)o on true
  where c.status<>'done' and c.kind in ('labor','void','unpaid') and (c.kind<>'void' or c.payload->>'scope'='payment')
 ), by_store as(
  select store_id,store_name,count(*) filter(where kind='labor') labor,count(*) filter(where kind='void') as "void",count(*) filter(where kind='unpaid') unpaid
  from open_cases group by store_id,store_name order by store_name
 )
 select jsonb_build_object('day',b.today_day,'from',b.from_day,'to',b.to_day,'expected',b.expected,'ok',b.ok,'failed',b.failed,
  'active_stores',(select count(*) from public.store_config where active),
  'finance_enabled',coalesce((select (value->>'finance_enabled')::boolean from public.bot_settings where key='worker'),false),
  'finance_ok',(select count(*) from public.bot_scan_days q where q.cycle_date=b.today_day and q.state='ok' and q.finance_collected and q.business_date between b.from_day and b.to_day),
  'counts',jsonb_build_object('labor',(select count(*) from open_cases where kind='labor'),'void',(select count(*) from open_cases where kind='void'),'unpaid',(select count(*) from open_cases where kind='unpaid')),
  'progress_counts',jsonb_build_object('not_sent',(select count(*) from open_cases where progress='not_sent'),'notify_failed',(select count(*) from open_cases where progress='notify_failed'),'waiting',(select count(*) from open_cases where progress='waiting'),'reminder_failed',(select count(*) from open_cases where progress='reminder_failed'),'in_progress',(select count(*) from open_cases where progress='in_progress'),'recheck',(select count(*) from open_cases where progress='recheck'),'send_check',(select count(*) from open_cases where progress='send_check'),'review',(select count(*) from open_cases where progress='review')),
    'status_counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from open_cases group by status) z),
  'recent_closed',coalesce((select jsonb_agg(z) from (select c.code,c.store_id,c.subject,c.closed_at,c.payload->'closure' closure from public.bot_cases c where c.status='done' and c.closed_at>coalesce((select max(created_at) from public.bot_events where kind='morning_summary' and data->>'state'='accepted'),p_now-interval '1 day') order by c.closed_at limit 100) z),'[]'),
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb),'detail_total',(select count(*) from open_cases),
  'details',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_cases order by store_name,business_date,kind,code limit 200)x),'[]'::jsonb)) from bounds b;
$function$;


revoke all on function public.bot_needs_hq(text,text,numeric),public.bot_case_respond(uuid,integer,text,text,uuid,text,text,date),public.bot_reply_ingest(text,text,text,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.bot_needs_hq(text,text,numeric),public.bot_case_respond(uuid,integer,text,text,uuid,text,text,date),public.bot_reply_ingest(text,text,text,text,text,text,text,date) to service_role;

create function public.bot_queue_case_notice() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target text;cfg jsonb;
begin
 if new.status=old.status or new.kind='purchase' or not (new.status in ('hq_review','done') or (new.status='correction' and old.status in ('hq_review','verify'))) then return new;end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 target=case when new.status='hq_review' then cfg->>'group_id' else coalesce(new.payload->'response'->>'group_id',cfg->>'group_id') end;
 if target is null or not exists(select 1 from public.bot_groups where group_id=target and enabled and (all_stores or store_id=new.store_id)) then return new;end if;
 insert into public.bot_events(case_id,event_key,kind,data) values(new.id,'lifecycle:'||new.id||':'||new.version,'lifecycle_notice',jsonb_build_object('state','pending','group_id',target,'request_id',gen_random_uuid(),'case',jsonb_build_object('code',new.code,'status',new.status,'status_version',new.status_version,'store_id',new.store_id,'subject',new.subject,'payload',jsonb_build_object('store_name',new.payload->>'store_name','response',new.payload->'response','returned',new.payload->'returned','closure',new.payload->'closure')))) on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function public.bot_queue_case_notice() from public,anon,authenticated;
grant execute on function public.bot_queue_case_notice() to service_role;
create trigger bot_case_lifecycle_notice after update of status on public.bot_cases for each row execute function public.bot_queue_case_notice();

create function public.bot_stamp_case_status() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin if new.status is distinct from old.status then new.status_version=new.version;end if;return new;end $$;
revoke all on function public.bot_stamp_case_status() from public,anon,authenticated;
grant execute on function public.bot_stamp_case_status() to service_role;
create trigger bot_case_status_stamp before update of status on public.bot_cases for each row execute function public.bot_stamp_case_status();

-- A due HQ return asks for a human response, not another clean Toast result.
CREATE OR REPLACE FUNCTION public.bot_reserve_daily_send(p_actor uuid, p_id uuid, p_version integer, p_request uuid, p_group text, p_body text, p_message jsonb, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o public.bot_outbox; c public.bot_cases; result jsonb; today date:=(now() at time zone 'Pacific/Honolulu')::date;
begin
 if not exists(select 1 from public.manager_auth where user_id=p_actor and role in ('gm','ceo','office')) then raise exception 'forbidden';end if;
 if p_day<>today or p_day is null then raise exception 'daily_date_changed';end if;
 select * into c from public.bot_cases where id=p_id for update;
 select * into o from public.bot_outbox where case_id=p_id and reminder_date=p_day and state<>'failed';
 if o.id is not null then
  if o.group_id<>p_group or o.body<>p_body or o.line_message is distinct from p_message then raise exception 'daily_already_prepared';end if;
  -- Generic reservation enforces the original retry deadline and failed-send rules.
  return public.bot_reserve_send_v2(p_actor,p_id,p_version,o.id,p_group,p_body,p_message);
 end if;
 if c.status='done' or c.business_date>=today or c.kind not in ('labor','void','unpaid') or (c.kind='void' and c.payload->>'scope' is distinct from 'payment') then raise exception 'closed_case';end if;
 if c.status='correction' and c.payload->'returned' is not null and c.due_date<=today then
  result:=public.bot_reserve_send_v2(p_actor,p_id,p_version,p_request,p_group,p_body,p_message);
  update public.bot_outbox set reminder_date=p_day where id=p_request;
  return result||jsonb_build_object('reminder_date',p_day);
 end if;
 if (c.payload->>'fetched_at' is not null and c.last_checked_at<(c.payload->>'fetched_at')::timestamptz) or c.last_checked_at is null or (c.last_checked_at at time zone 'Pacific/Honolulu')::date<>today or c.last_check->>'message' not in ('still_flagged_or_manual_review','payment_not_confirmed','payment_coverage_incomplete') or c.last_check->>'message' is null then raise exception 'recheck_required';end if;
 result:=public.bot_reserve_send_v2(p_actor,p_id,p_version,p_request,p_group,p_body,p_message);
 update public.bot_outbox set reminder_date=p_day where id=p_request;
 return result||jsonb_build_object('reminder_date',p_day);
end $function$;

-- Delivery of a reminder is not a new store response to an HQ return.
create or replace function public.bot_finish_send(p_id uuid,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.bot_outbox;
begin
 if p_state not in ('sent','failed','unknown') then raise exception 'bad_state'; end if;
 select * into o from public.bot_outbox where id=p_id for update;
 if o.id is null or o.state='sent' then return; end if;
 update public.bot_outbox set state=p_state,updated_at=now() where id=p_id;
 if p_state='sent' then update public.bot_cases set status=case when payload->'returned' is not null then 'correction' else 'waiting' end,version=version+1,updated_at=now() where id=o.case_id and version=o.case_version and status in ('review','correction','waiting'); end if;
 insert into public.bot_events(case_id,actor,kind,data) values(o.case_id,o.actor,'send_'||p_state,jsonb_build_object('outbox',p_id));
end $$;
