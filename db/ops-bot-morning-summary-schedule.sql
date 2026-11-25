-- Production cron for the labor report, read from funergy-os on 2026-11-25.
-- Hawaii is UTC-10 year-round. This file is the definition to apply by hand.
-- Applying it replaces the named jobs. This repository change does not run it.
--
-- ops-bot-morning-summary: 08:00 / 08:05 / 08:10 HST, labor only.
-- Sends only when bot_labor_payroll_period says the day is scheduled
-- (Wednesday, the 16th after the 1st–15th period, or the 1st after the 16th–month-end period)
-- and that period's collection is complete. The route is morning_summary.routes.labor
-- (修正依頼グループ). Finance and cash-tip daily LINE are not posted by this job.
--
-- ops-bot-payroll-month-close-collect: every minute 07:00–07:59 HST on the 1st.
-- Collects missing labor days for stores that are still short. It does not send LINE.
-- F03 and F03-G workers stay as they are in production (inactive). This file does not recreate them.

select cron.schedule('ops-bot-morning-summary','0,5,10 18 * * *',$cron$
with ready as materialized (select public.bot_labor_payroll_snapshot() as v)
select net.http_post(
 url:='https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
 headers:=jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
 body:=jsonb_build_object('action','worker','mode','morning_summary','category','labor'),
 timeout_milliseconds:=120000)
from ready
where (v->'labor_period'->>'is_scheduled')::boolean
 and (v->>'day')::date=(now() at time zone 'Pacific/Honolulu')::date
 and (v->>'active_stores')::int>0
 and (v->'labor_period'->>'ok')::int=(v->'labor_period'->>'expected')::int
 and (v->'labor_period'->>'failed')::int=0
 and (select coalesce((value->>'enabled')::boolean,false) from public.bot_settings where key='morning_summary');
$cron$);

select cron.schedule('ops-bot-payroll-month-close-collect','* 17 1 * *',$cron$
with payroll as materialized (select public.bot_labor_payroll_snapshot() as v),
stores as (
 select distinct d->>'store_id' as store_id from payroll cross join lateral jsonb_array_elements(v->'collection_missing') d
 where extract(day from (v->>'day')::date)=1
)
select net.http_post(
 url:='https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
 headers:=jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
 body:=jsonb_build_object('action','worker','mode','labor_payroll_collect','store_id',store_id),
 timeout_milliseconds:=120000)
from stores;
$cron$);
