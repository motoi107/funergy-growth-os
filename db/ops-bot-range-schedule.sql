-- Original staggered morning and hourly monitor jobs are retained.
-- Continue unfinished store/day work from 08:00 Hawaii so a 30-day month can finish before the 09:00 summary.
select cron.schedule('ops-bot-range-resume','* * * * *',$cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
  headers := jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
  body := jsonb_build_object('action','worker','store_id',s.store_id),
  timeout_milliseconds := 120000)
 from public.store_config s
 where s.active and (now() at time zone 'Pacific/Honolulu')::time >= time '08:00'
 and public.bot_range_next(s.store_id) is not null;
$cron$);
