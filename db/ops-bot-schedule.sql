-- Daily collection at 08:40–08:47 Hawaii for the active stores at deployment.
-- The worker switch defaults OFF; there are no LINE sends in this job.
do $$
declare s record; minute integer:=40; command text;
begin
 for s in select store_id from public.store_config where active order by store_id loop
  command := format($job$
   select net.http_post(
    url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot',
    headers := jsonb_build_object('Content-Type','application/json','x-bot-worker-key',(select value->>'key' from public.bot_settings where key='worker')),
    body := jsonb_build_object('action','worker','store_id',%L),
    timeout_milliseconds := 120000
   ) where (select coalesce((value->>'enabled')::boolean,false) from public.bot_settings where key='worker');
  $job$,s.store_id);
  perform cron.schedule('ops-bot-'||s.store_id,minute::text||' 18 * * *',command);
  minute:=minute+1;
 end loop;
end $$;
