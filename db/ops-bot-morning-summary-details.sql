-- Add actionable case details to the private morning snapshot and support one audited resend variant.
create or replace function public.bot_morning_snapshot(p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with overview as(select public.bot_range_overview(p_now) o),
 bounds as(select (o->>'day')::date today_day,(o->>'from')::date from_day,(o->>'to')::date to_day,(o->>'expected')::int expected,(o->>'ok')::int ok,(o->>'failed')::int failed from overview),
 open_cases as(
  select c.code,c.store_id,s.name store_name,c.business_date,c.kind,c.subject,
   c.payload->>'employee_name' employee_name,c.payload->'kinds' kinds,coalesce((c.payload->>'open_shift')::boolean,false) open_shift,
   case when c.payload->>'amount'~'^-?[0-9]+(?:\.[0-9]+)?$' then (c.payload->>'amount')::numeric end amount,
   c.payload->>'user_name' user_name,c.payload->>'approver_name' approver_name,c.payload->>'reason' reason
  from bounds b join public.bot_cases c on c.business_date between b.from_day and b.to_day
  join public.store_config s on s.store_id=c.store_id
  where c.status<>'done' and c.kind in ('labor','void','unpaid')
  and (c.kind<>'void' or c.payload->>'scope'='payment')
 ), by_store as(
  select store_id,store_name,count(*) filter(where kind='labor') labor,
   count(*) filter(where kind='void') as "void",count(*) filter(where kind='unpaid') unpaid
  from open_cases group by store_id,store_name order by store_id
 )
 select jsonb_build_object('day',b.today_day,'from',b.from_day,'to',b.to_day,'expected',b.expected,'ok',b.ok,'failed',b.failed,
  'active_stores',(select count(*) from public.store_config where active),
  'finance_enabled',coalesce((select (value->>'finance_enabled')::boolean from public.bot_settings where key='worker'),false),
  'finance_ok',(select count(*) from public.bot_scan_days q where q.cycle_date=b.today_day and q.state='ok' and q.finance_collected and q.business_date between b.from_day and b.to_day),
  'counts',jsonb_build_object('labor',(select count(*) from open_cases where kind='labor'),'void',(select count(*) from open_cases where kind='void'),'unpaid',(select count(*) from open_cases where kind='unpaid')),
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb),
  'detail_total',(select count(*) from open_cases),
  'details',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_cases order by store_name,business_date,kind,code limit 200) x),'[]'::jsonb)) from bounds b;
$$;

create or replace function public.bot_reserve_morning_summary_v2(p_day date,p_group text,p_request uuid,p_messages jsonb,p_variant text default 'daily') returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events; cfg jsonb; today date:=(now() at time zone 'Pacific/Honolulu')::date; k text;
begin
 if p_day is null or p_day<>today or p_request is null then raise exception 'daily_date_changed';end if;
 if p_variant is null or p_variant not in ('daily','resend-details-v1') then raise exception 'invalid_summary_variant';end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 if cfg is null or cfg->>'enabled'<>'true' or cfg->>'group_id' is distinct from p_group or coalesce(cfg->>'label','')='' then raise exception 'morning_summary_not_configured';end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and all_stores and label=cfg->>'label') then raise exception 'group_not_enabled';end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 5 or exists(
  select 1 from jsonb_array_elements(p_messages) m where m->>'type'<>'text' or length(coalesce(m->>'text','')) not between 1 and 4900
 ) then raise exception 'invalid_message';end if;
 k:='morning-summary:'||p_day||case when p_variant='daily' then '' else ':'||p_variant end;
 insert into public.bot_events(event_key,kind,data) values(k,'morning_summary',jsonb_build_object('state','pending','day',p_day,'variant',p_variant,'group_id',p_group,'request_id',p_request,'messages',p_messages))
 on conflict(event_key) do nothing returning * into e;
 if e.id is null then select * into e from public.bot_events where event_key=k for update;end if;
 if e.id is null or e.kind<>'morning_summary' or e.data->>'group_id' is distinct from p_group then raise exception 'conflict';end if;
 return to_jsonb(e);
end $$;

revoke all on function public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary_v2(date,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary_v2(date,text,uuid,jsonb,text) to service_role;
