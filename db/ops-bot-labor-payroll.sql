-- Production labor payroll reports (funergy-os, read 2026-11-25).
-- Does not schedule cron and does not send LINE. Apply on a database that already has bot_morning_snapshot.
-- bot_morning_snapshot is the 20260912224146 body, except finance_ok counts only days in bot_collection_days
-- (active stores, from the later of month start and collection_range.first_business_dates, through yesterday).
-- bot_reserve_morning_report and cash_tip_autofill already match production and are not replaced.

CREATE OR REPLACE FUNCTION public.bot_collection_days(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(store_id text, business_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with bounds as(select (p_now at time zone 'Pacific/Honolulu')::date today),
 cfg as(select coalesce((select value->'first_business_dates' from public.bot_settings where key='collection_range'),'{}'::jsonb) starts)
 select s.store_id,d::date
 from bounds b,cfg,public.store_config s
 cross join lateral generate_series(
  greatest(date_trunc('month',b.today::timestamp)::date,(cfg.starts->>s.store_id)::date)::timestamp,
  (b.today-1)::timestamp,interval '1 day') d
 where s.active;
$function$;

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
  'finance_ok',(select count(*) from public.bot_scan_days q join public.bot_collection_days(p_now) d using(store_id,business_date) where q.cycle_date=b.today_day and q.state='ok' and q.finance_collected),
  'counts',jsonb_build_object('labor',(select count(*) from open_cases where kind='labor'),'void',(select count(*) from open_cases where kind='void'),'unpaid',(select count(*) from open_cases where kind='unpaid')),
  'progress_counts',jsonb_build_object('not_sent',(select count(*) from open_cases where progress='not_sent'),'notify_failed',(select count(*) from open_cases where progress='notify_failed'),'waiting',(select count(*) from open_cases where progress='waiting'),'reminder_failed',(select count(*) from open_cases where progress='reminder_failed'),'in_progress',(select count(*) from open_cases where progress='in_progress'),'recheck',(select count(*) from open_cases where progress='recheck'),'send_check',(select count(*) from open_cases where progress='send_check'),'review',(select count(*) from open_cases where progress='review')),
    'status_counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from open_cases group by status) z),
  'recent_closed',coalesce((select jsonb_agg(z) from (select c.code,c.kind,c.store_id,c.subject,c.closed_at,c.payload->'closure' closure from public.bot_cases c where c.status='done' and c.kind in ('labor','void','unpaid') and (c.kind<>'void' or c.payload->>'scope'='payment') and c.closed_at>coalesce((select max(coalesce((data->>'snapshot_at')::timestamptz,created_at)) from public.bot_events where kind='morning_summary' and data->>'state'='accepted' and coalesce(data->>'variant','daily')='daily'),p_now-interval '1 day') and c.closed_at<=p_now order by c.closed_at,c.code) z),'[]'),
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb),'detail_total',(select count(*) from open_cases),
  'details',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_cases order by store_name,business_date,kind,code)x),'[]'::jsonb)) from bounds b;
$function$;

CREATE OR REPLACE FUNCTION public.bot_labor_payroll_period(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with clock as (
  select (p_now at time zone 'Pacific/Honolulu')::date as today
 ), anchor as (
  select today,today-1 as last_day,date_trunc('month',(today-1)::timestamp)::date as month_start from clock
 ), period as (
  select today,last_day,
   case when extract(day from last_day)<=15 then month_start else month_start+15 end as period_from,
   case when extract(day from last_day)<=15 then month_start+14 else (month_start+interval '1 month'-interval '1 day')::date end as period_to
  from anchor
 )
 select jsonb_build_object('day',today,'from',period_from,'to',last_day,
  'payroll_from',period_from,'payroll_to',period_to,
  'is_final',last_day=period_to,
  'is_scheduled',extract(isodow from today)=3 or last_day=period_to)
 from period;
$function$;

CREATE OR REPLACE FUNCTION public.bot_labor_payroll_snapshot(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with period as (select public.bot_labor_payroll_period(p_now) as v),
 source as materialized (select public.bot_morning_snapshot(p_now) as v),
 cfg as (select coalesce((select value->'first_business_dates' from public.bot_settings where key='collection_range'),'{}'::jsonb) as starts),
 expected as (
  select s.store_id,d::date as business_date
  from public.store_config s cross join period p cross join cfg
  cross join lateral generate_series(
   greatest((p.v->>'from')::date,coalesce((cfg.starts->>s.store_id)::date,(p.v->>'from')::date))::timestamp,
   (p.v->>'to')::date::timestamp,interval '1 day') d
  where s.active
 ), collection as (
  select e.*,
   (coalesce(q.cycle_date=(p.v->>'day')::date and q.state='ok',false) or exists(
    select 1 from public.bot_events x
    where x.event_key='payroll-labor-scan:'||(p.v->>'day')||':'||e.store_id||':'||e.business_date::text
     and x.kind='payroll_labor_scan' and x.data->>'state'='ok'
   )) as collected
  from expected e cross join period p
  left join public.bot_scan_days q using(store_id,business_date)
 ), labor as (
  select d from source s cross join period p cross join lateral jsonb_array_elements(s.v->'details') d
  where d->>'kind'='labor' and (d->>'business_date')::date between (p.v->>'from')::date and (p.v->>'to')::date
 )
 select jsonb_build_object(
  'day',p.v->'day','snapshot_at',p_now,'from',p.v->'from','to',p.v->'to',
  'labor_period',p.v||jsonb_build_object('expected',(select count(*) from collection),'ok',(select count(*) from collection where collected),'failed',0),
  'active_stores',(select count(*) from public.store_config where active),
  'expected',(select count(*) from collection),'ok',(select count(*) from collection where collected),'failed',0,
  'collection_missing',coalesce((select jsonb_agg(jsonb_build_object('store_id',store_id,'business_date',business_date) order by store_id,business_date) from collection where not collected),'[]'::jsonb),
  'counts',jsonb_build_object('labor',(select count(*) from labor),'void',0,'unpaid',0),
  'detail_total',(select count(*) from labor),
  'details',coalesce((select jsonb_agg(d order by d->>'store_name',d->>'business_date',d->>'code') from labor),'[]'::jsonb)
 ) from period p;
$function$;

revoke all on function public.bot_collection_days(timestamptz) from public, anon, authenticated;
revoke all on function public.bot_labor_payroll_period(timestamptz) from public, anon, authenticated;
revoke all on function public.bot_labor_payroll_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.bot_collection_days(timestamptz), public.bot_labor_payroll_period(timestamptz), public.bot_labor_payroll_snapshot(timestamptz) to service_role;
