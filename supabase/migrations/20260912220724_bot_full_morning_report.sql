-- Preserve current closure/carryover logic; report every case and its saved shift evidence.
CREATE OR REPLACE FUNCTION public.bot_morning_snapshot(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with overview as(select public.bot_range_overview(p_now) o),
 bounds as(select (o->>'day')::date today_day,(o->>'from')::date from_day,(o->>'to')::date to_day,(o->>'expected')::int expected,(o->>'ok')::int ok,(o->>'failed')::int failed from overview),
 open_cases as(
  select c.code,c.store_id,s.name store_name,c.business_date,c.kind,c.subject,c.assignee,c.status,c.due_date,c.payload->'response' response,c.payload->'returned' returned,c.payload->'shifts' shifts,c.payload->'cfg' shift_cfg,
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
 select jsonb_build_object('day',b.today_day,'snapshot_at',p_now,'from',b.from_day,'to',b.to_day,'expected',b.expected,'ok',b.ok,'failed',b.failed,
  'active_stores',(select count(*) from public.store_config where active),
  'finance_enabled',coalesce((select (value->>'finance_enabled')::boolean from public.bot_settings where key='worker'),false),
  'finance_ok',(select count(*) from public.bot_scan_days q where q.cycle_date=b.today_day and q.state='ok' and q.finance_collected and q.business_date between b.from_day and b.to_day),
  'counts',jsonb_build_object('labor',(select count(*) from open_cases where kind='labor'),'void',(select count(*) from open_cases where kind='void'),'unpaid',(select count(*) from open_cases where kind='unpaid')),
  'progress_counts',jsonb_build_object('not_sent',(select count(*) from open_cases where progress='not_sent'),'notify_failed',(select count(*) from open_cases where progress='notify_failed'),'waiting',(select count(*) from open_cases where progress='waiting'),'reminder_failed',(select count(*) from open_cases where progress='reminder_failed'),'in_progress',(select count(*) from open_cases where progress='in_progress'),'recheck',(select count(*) from open_cases where progress='recheck'),'send_check',(select count(*) from open_cases where progress='send_check'),'review',(select count(*) from open_cases where progress='review')),
    'status_counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from open_cases group by status) z),
  'recent_closed',coalesce((select jsonb_agg(z) from (select c.code,c.store_id,c.subject,c.closed_at,c.payload->'closure' closure from public.bot_cases c where c.status='done' and c.closed_at>coalesce((select max(coalesce((data->>'snapshot_at')::timestamptz,created_at)) from public.bot_events where kind='morning_summary' and data->>'state'='accepted' and coalesce(data->>'variant','daily')='daily'),p_now-interval '1 day') and c.closed_at<=p_now order by c.closed_at,c.code) z),'[]'),
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb),'detail_total',(select count(*) from open_cases),
  'details',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_cases order by store_name,business_date,kind,code)x),'[]'::jsonb)) from bounds b;
$function$;

-- One immutable daily report, split into LINE batches of at most five messages.
-- Existing v2 reservations keep their payload and retry key during rollout.
create or replace function public.bot_reserve_morning_summary_v3(p_day date,p_group text,p_request uuid,p_messages jsonb,p_variant text default 'daily',p_snapshot_at timestamptz default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events;cfg jsonb;today date:=(now() at time zone 'Pacific/Honolulu')::date;k text;bundle jsonb;batches jsonb:='[]';i integer;n integer;
begin
 if p_day is null or p_day<>today or p_request is null then raise exception 'daily_date_changed';end if;
 if p_variant is null or p_variant not in ('daily','resend-details-v1','resend-report-v1','mention-preview-v1') then raise exception 'invalid_summary_variant';end if;
 if p_snapshot_at is not null and (p_snapshot_at>now() or (p_snapshot_at at time zone 'Pacific/Honolulu')::date<>today) then raise exception 'daily_date_changed';end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 if cfg is null or cfg->>'enabled'<>'true' or cfg->>'group_id' is distinct from p_group or coalesce(cfg->>'label','')='' then raise exception 'morning_summary_not_configured';end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and all_stores and label=cfg->>'label') then raise exception 'group_not_enabled';end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' then raise exception 'invalid_message';end if;
 if jsonb_array_length(p_messages)<1 or exists(select 1 from jsonb_array_elements(p_messages)m where jsonb_typeof(m) is distinct from 'object' or m->>'type' is distinct from 'text' or jsonb_typeof(m->'text') is distinct from 'string' or length(m->>'text') not between 1 and 4900) then raise exception 'invalid_message';end if;
 k:='morning-summary:'||p_day||case when p_variant='daily' then '' else ':'||p_variant end;
 n:=jsonb_array_length(p_messages);
 for i in 0..(n-1)/5 loop
  select jsonb_agg(m order by ord) into bundle from jsonb_array_elements(p_messages) with ordinality x(m,ord) where ord between i*5+1 and i*5+5;
  batches:=batches||jsonb_build_array(jsonb_build_object('state','pending','request_id',case when i=0 then p_request else gen_random_uuid() end,'messages',bundle));
 end loop;
 insert into public.bot_events(event_key,kind,data)values(k,'morning_summary',jsonb_build_object('state','pending','day',p_day,'variant',p_variant,'group_id',p_group,'request_id',p_request,'snapshot_at',coalesce(p_snapshot_at,now()),'messages',p_messages,'batches',batches))on conflict(event_key)do nothing returning * into e;
 if e.id is null then select * into e from public.bot_events where event_key=k for update;end if;
 if e.id is null or e.kind<>'morning_summary' or e.data->>'group_id' is distinct from p_group then raise exception 'conflict';end if;
 if not(e.data?'batches') and e.data->>'state' not in ('accepted','failed') then
  bundle:=coalesce(e.data->'messages',jsonb_build_array(e.data->'message'));
  if jsonb_typeof(bundle)<>'array' or jsonb_array_length(bundle) not between 1 and 5 then raise exception 'invalid_message';end if;
  update public.bot_events set data=data||jsonb_build_object('batches',jsonb_build_array(jsonb_build_object('state',e.data->>'state','request_id',e.data->>'request_id','messages',bundle)))where id=e.id returning * into e;
 end if;
 return to_jsonb(e);
end $$;

create or replace function public.bot_finish_morning_summary_batch(p_event bigint,p_batch integer,p_state text,p_status integer default null,p_line_request text default null) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events;batches jsonb;report_state text;
begin
 if p_state is null or p_state not in ('accepted','failed','unknown') then raise exception 'invalid_state';end if;
 select * into e from public.bot_events where id=p_event and kind='morning_summary' for update;
 if e.id is null then raise exception 'not_found';end if;
 batches:=e.data->'batches';
 if p_batch is null or p_batch<0 or jsonb_typeof(batches) is distinct from 'array' or p_batch>=jsonb_array_length(batches) then raise exception 'invalid_batch';end if;
 if e.data->>'state'='accepted' or batches->p_batch->>'state'='accepted' then return;end if;
 if exists(select 1 from jsonb_array_elements(batches) with ordinality x(b,ord) where ord<=p_batch and b->>'state'<>'accepted') then raise exception 'invalid_batch_order';end if;
 batches:=jsonb_set(batches,array[p_batch::text],(batches->p_batch)||jsonb_build_object('state',p_state,'line_status',p_status,'line_request_id',p_line_request,'checked_at',now()));
 report_state:=case when not exists(select 1 from jsonb_array_elements(batches)b where b->>'state'<>'accepted') then 'accepted' when exists(select 1 from jsonb_array_elements(batches)b where b->>'state'='failed') then 'failed' else 'pending' end;
 update public.bot_events set data=data||jsonb_build_object('batches',batches,'state',report_state,'checked_at',now()) where id=p_event;
end $$;

revoke all on function public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary_v3(date,text,uuid,jsonb,text,timestamptz),public.bot_finish_morning_summary_batch(bigint,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary_v3(date,text,uuid,jsonb,text,timestamptz),public.bot_finish_morning_summary_batch(bigint,integer,text,integer,text) to service_role;
