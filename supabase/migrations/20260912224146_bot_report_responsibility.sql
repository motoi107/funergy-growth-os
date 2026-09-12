-- Include case kind for separate labor/finance completion reports; retain monitored scope.
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
  'recent_closed',coalesce((select jsonb_agg(z) from (select c.code,c.kind,c.store_id,c.subject,c.closed_at,c.payload->'closure' closure from public.bot_cases c where c.status='done' and c.kind in ('labor','void','unpaid') and (c.kind<>'void' or c.payload->>'scope'='payment') and c.closed_at>coalesce((select max(coalesce((data->>'snapshot_at')::timestamptz,created_at)) from public.bot_events where kind='morning_summary' and data->>'state'='accepted' and coalesce(data->>'variant','daily')='daily'),p_now-interval '1 day') and c.closed_at<=p_now order by c.closed_at,c.code) z),'[]'),
  'stores',coalesce((select jsonb_agg(to_jsonb(x)) from by_store x),'[]'::jsonb),'detail_total',(select count(*) from open_cases),
  'details',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_cases order by store_name,business_date,kind,code)x),'[]'::jsonb)) from bounds b;
$function$;
