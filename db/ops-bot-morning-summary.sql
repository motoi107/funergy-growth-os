-- One automatic daily overview for the explicitly configured headquarters group.
-- The production group identifier belongs in service-only bot_settings, never here.
alter table public.bot_scan_days add column if not exists finance_collected boolean not null default false;

-- A finance-enabled worker must revisit rows that were previously collected as labor-only.
create or replace function public.bot_range_next(p_store text,p_now timestamptz default now()) returns date
language sql stable security invoker set search_path=public,pg_temp as $$
 with bounds as (select (p_now at time zone 'Pacific/Honolulu')::date as today),
 cfg as(select coalesce((value->>'finance_enabled')::boolean,false) finance_enabled from public.bot_settings where key='worker')
 select d::date from bounds,cfg,
 generate_series(date_trunc('month',today::timestamp),today::timestamp-interval '1 day',interval '1 day') d
 left join public.bot_scan_days q on q.store_id=p_store and q.business_date=d::date
 where exists(select 1 from public.store_config where store_id=p_store and active)
 and exists(select 1 from public.bot_settings where key='worker' and value->>'enabled'='true')
 and exists(select 1 from public.bot_settings where key='collection_range' and value->>'mode'='month_to_yesterday')
 and not exists(select 1 from public.bot_scan_days where store_id=p_store and state='running' and lease_until>p_now)
 and (q.cycle_date is distinct from today or q.state='ok' and cfg.finance_enabled and q.finance_collected is distinct from true or
  (q.state<>'ok' and q.attempts<3 and (q.state='running' and q.lease_until<=p_now or q.state='error' and q.attempted_at<=p_now-interval '15 minutes')))
 order by (q.cycle_date=today and (not cfg.finance_enabled or q.finance_collected)) nulls first,d asc limit 1;
$$;

create or replace function public.bot_finish_range_v2(p_store text,p_date date,p_lease uuid,p_error text,p_finance boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update public.bot_scan_days set state=case when p_error is null then 'ok' else 'error' end,
 finance_collected=p_error is null and p_finance,lease_until=null,finished_at=now(),last_error=left(p_error,120)
 where store_id=p_store and business_date=p_date and lease_id=p_lease and state='running';
 return found;
end $$;

create or replace function public.bot_morning_snapshot(p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with overview as(select public.bot_range_overview(p_now) o),
 bounds as(select (o->>'day')::date today_day,(o->>'from')::date from_day,(o->>'to')::date to_day,(o->>'expected')::int expected,(o->>'ok')::int ok,(o->>'failed')::int failed from overview),
 open_cases as(
  select c.store_id,s.name store_name,c.kind
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
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb)) from bounds b;
$$;

create or replace function public.bot_reserve_morning_summary(p_day date,p_group text,p_request uuid,p_message jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events; cfg jsonb; today date:=(now() at time zone 'Pacific/Honolulu')::date; k text;
begin
 if p_day is null or p_day<>today or p_request is null then raise exception 'daily_date_changed';end if;
 select value into cfg from public.bot_settings where key='morning_summary';
 if cfg is null or cfg->>'enabled'<>'true' or cfg->>'group_id' is distinct from p_group or coalesce(cfg->>'label','')='' then raise exception 'morning_summary_not_configured';end if;
 if not exists(select 1 from public.bot_groups where group_id=p_group and enabled and all_stores and label=cfg->>'label') then raise exception 'group_not_enabled';end if;
 if p_message->>'type'<>'text' or length(coalesce(p_message->>'text','')) not between 1 and 4900 then raise exception 'invalid_message';end if;
 -- One summary per Hawaii day even if a configuration edit is made mid-run.
 k:='morning-summary:'||p_day;
 insert into public.bot_events(event_key,kind,data) values(k,'morning_summary',jsonb_build_object('state','pending','day',p_day,'group_id',p_group,'request_id',p_request,'message',p_message))
 on conflict(event_key) do nothing returning * into e;
 if e.id is null then select * into e from public.bot_events where event_key=k for update;end if;
 if e.id is null or e.kind<>'morning_summary' or e.data->>'group_id' is distinct from p_group then raise exception 'conflict';end if;
 return to_jsonb(e);
end $$;

create or replace function public.bot_finish_morning_summary(p_event bigint,p_state text,p_status integer default null,p_line_request text default null) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.bot_events;
begin
 if p_state not in ('accepted','failed','unknown') then raise exception 'invalid_state';end if;
 select * into e from public.bot_events where id=p_event and kind='morning_summary' for update;
 if e.id is null or e.data->>'state'='accepted' then return;end if;
 update public.bot_events set data=data||jsonb_build_object('state',p_state,'line_status',p_status,'line_request_id',p_line_request,'checked_at',now()) where id=p_event;
end $$;

revoke all on function public.bot_range_next(text,timestamptz),public.bot_finish_range_v2(text,date,uuid,text,boolean),public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary(date,text,uuid,jsonb),public.bot_finish_morning_summary(bigint,text,integer,text) from public,anon,authenticated;
grant execute on function public.bot_range_next(text,timestamptz),public.bot_finish_range_v2(text,date,uuid,text,boolean),public.bot_morning_snapshot(timestamptz),public.bot_reserve_morning_summary(date,text,uuid,jsonb),public.bot_finish_morning_summary(bigint,text,integer,text) to service_role;
