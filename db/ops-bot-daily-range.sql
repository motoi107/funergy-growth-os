-- One durable row per store/business day. A fresh cycle re-reads each day every morning.
create table public.bot_scan_days (
 store_id text not null references public.store_config(store_id),
 business_date date not null,
 cycle_date date not null,
 state text not null check(state in ('running','ok','error')),
 attempts integer not null default 0,
 lease_id uuid,
 lease_until timestamptz,
 attempted_at timestamptz not null,
 finished_at timestamptz,
 last_error text,
 primary key(store_id,business_date)
);
alter table public.bot_scan_days enable row level security;
revoke all on public.bot_scan_days from public,anon,authenticated;
grant all on public.bot_scan_days to service_role;
insert into public.bot_settings(key,value) values('collection_range','{"mode":"month_to_yesterday"}') on conflict(key) do nothing;

-- Read-only candidate selection is also used by cron, so completed stores make no HTTP calls.
create function public.bot_range_next(p_store text,p_now timestamptz default now()) returns date
language sql stable security invoker set search_path=public,pg_temp as $$
 with bounds as (select (p_now at time zone 'Pacific/Honolulu')::date as today)
 select d::date from bounds,
 generate_series(date_trunc('month',today::timestamp),today::timestamp-interval '1 day',interval '1 day') d
 left join public.bot_scan_days q on q.store_id=p_store and q.business_date=d::date
 where exists(select 1 from public.store_config where store_id=p_store and active)
 and exists(select 1 from public.bot_settings where key='worker' and value->>'enabled'='true')
 and exists(select 1 from public.bot_settings where key='collection_range' and value->>'mode'='month_to_yesterday')
 and not exists(select 1 from public.bot_scan_days where store_id=p_store and state='running' and lease_until>p_now)
 and (q.cycle_date is distinct from today or
  (q.state<>'ok' and q.attempts<3 and (q.state='running' and q.lease_until<=p_now or q.state='error' and q.attempted_at<=p_now-interval '15 minutes')))
 order by (q.cycle_date=today) nulls first,d asc limit 1;
$$;
create function public.bot_claim_range(p_store text,p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target date; q public.bot_scan_days; today date:=(p_now at time zone 'Pacific/Honolulu')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('ops-bot-range:'||p_store,0));
 target:=public.bot_range_next(p_store,p_now);if target is null then return null;end if;
 insert into public.bot_scan_days(store_id,business_date,cycle_date,state,attempts,lease_id,lease_until,attempted_at)
 values(p_store,target,today,'running',1,gen_random_uuid(),p_now+interval '6 minutes',p_now)
 on conflict(store_id,business_date) do update set cycle_date=today,state='running',
 attempts=case when bot_scan_days.cycle_date=today then bot_scan_days.attempts+1 else 1 end,
 lease_id=excluded.lease_id,lease_until=excluded.lease_until,attempted_at=p_now,finished_at=null,last_error=null
 returning * into q;
 return to_jsonb(q);
end $$;
create function public.bot_finish_range(p_store text,p_date date,p_lease uuid,p_error text default null) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update public.bot_scan_days set state=case when p_error is null then 'ok' else 'error' end,
 lease_until=null,finished_at=now(),last_error=left(p_error,120)
 where store_id=p_store and business_date=p_date and lease_id=p_lease and state='running';
 return found;
end $$;
create function public.bot_range_overview(p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with b as(select (p_now at time zone 'Pacific/Honolulu')::date today),
 days as(select s.store_id,d::date business_date,q.state,q.cycle_date,q.attempts,q.last_error,q.lease_until
 from b,public.store_config s cross join lateral generate_series(date_trunc('month',b.today::timestamp),b.today::timestamp-interval '1 day',interval '1 day') d
 left join public.bot_scan_days q on q.store_id=s.store_id and q.business_date=d::date where s.active)
 select jsonb_build_object('day',today,'from',date_trunc('month',today::timestamp)::date,'to',today-1,
 'expected',(select count(*) from days),'ok',(select count(*) from days where cycle_date=today and state='ok'),
 'failed',(select count(*) from days where cycle_date=today and (state='error' or state='running' and lease_until<=p_now)),
 'issues',coalesce((select jsonb_agg(x) from (select store_id,business_date,state,attempts,last_error from days where cycle_date=today and (state='error' or state='running' and lease_until<=p_now) order by store_id,business_date limit 100) x),'[]'::jsonb)) from b;
$$;

-- Each morning reminder has one reservation per case/day, including uncertain sends.
alter table public.bot_outbox add column reminder_date date;
create unique index bot_daily_send_once on public.bot_outbox(case_id,reminder_date) where reminder_date is not null and state<>'failed';
create function public.bot_reserve_daily_send(p_actor uuid,p_id uuid,p_version integer,p_request uuid,p_group text,p_body text,p_message jsonb,p_day date) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
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
 if (c.payload->>'fetched_at' is not null and c.last_checked_at<(c.payload->>'fetched_at')::timestamptz) or c.last_checked_at is null or (c.last_checked_at at time zone 'Pacific/Honolulu')::date<>today or c.last_check->>'message' not in ('still_flagged_or_manual_review','payment_not_confirmed','payment_coverage_incomplete') or c.last_check->>'message' is null then raise exception 'recheck_required';end if;
 result:=public.bot_reserve_send_v2(p_actor,p_id,p_version,p_request,p_group,p_body,p_message);
 update public.bot_outbox set reminder_date=p_day where id=p_request;
 return result||jsonb_build_object('reminder_date',p_day);
end $$;
revoke all on function public.bot_range_next(text,timestamptz),public.bot_claim_range(text,timestamptz),public.bot_finish_range(text,date,uuid,text),public.bot_range_overview(timestamptz),public.bot_reserve_daily_send(uuid,uuid,integer,uuid,text,text,jsonb,date) from public,anon,authenticated;
grant execute on function public.bot_range_next(text,timestamptz),public.bot_claim_range(text,timestamptz),public.bot_finish_range(text,date,uuid,text),public.bot_range_overview(timestamptz),public.bot_reserve_daily_send(uuid,uuid,integer,uuid,text,text,jsonb,date) to service_role;
