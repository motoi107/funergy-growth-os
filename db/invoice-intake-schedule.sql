-- Invoice intake schedule: every 5 minutes. Apply only after the invoice-intake function is
-- deployed and its secrets are set. Nothing runs until invoice_settings.worker.enabled is true,
-- and the worker itself does nothing until mode.intake is true (both are off by default).
select cron.schedule('invoice-intake', '*/5 * * * *', $cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/invoice-intake',
  headers := jsonb_build_object('Content-Type','application/json','x-invoice-worker-key',(select value->>'key' from public.invoice_settings where key='worker')),
  body := jsonb_build_object('action','worker'),
  timeout_milliseconds := 150000
 ) where (select coalesce((value->>'enabled')::boolean,false) from public.invoice_settings where key='worker');
$cron$);
-- To stop: select cron.unschedule('invoice-intake');  (data is kept)
