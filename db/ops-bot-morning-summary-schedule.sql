-- Hawaii stays at UTC-10 year-round: 19:00 UTC is 09:00 HST.
-- 09:05 and 09:10 are idempotent safety retries for transient/unknown LINE results.
select cron.schedule('ops-bot-morning-summary','0,5,10 19 * * *',$cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
  headers := jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
  body := jsonb_build_object('action','worker','mode','morning_summary'),
  timeout_milliseconds := 120000)
 where (select coalesce((value->>'enabled')::boolean,false) from public.bot_settings where key='morning_summary');
$cron$);
