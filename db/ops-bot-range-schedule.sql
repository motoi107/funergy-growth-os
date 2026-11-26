-- Original staggered morning and hourly monitor jobs are retained.
-- Production (read 2026-11-25): resume at 07:00 HST, one unfinished day per store per minute,
-- oldest first, so a month can be re-read before the 08:00 labor report.
-- The repository copy previously said 08:00, which was the gate for the old 09:00 summary.
select cron.schedule('ops-bot-range-resume','* * * * *',$cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
  headers := jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
  body := jsonb_build_object('action','worker','store_id',s.store_id),
  timeout_milliseconds := 120000)
 from public.store_config s
 where s.active and (now() at time zone 'Pacific/Honolulu')::time >= time '07:00'
 and public.bot_range_next(s.store_id) is not null;
$cron$);
