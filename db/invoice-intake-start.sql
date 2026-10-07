-- Invoice取込：5 分ごとの取込を始める（鍵は画面に出さない）
-- 取込そのものは、アプリの「設定」→「運用」で「新しい invoice を取り込む」が ON のときだけ動きます。
update public.invoice_settings
   set value = value || '{"enabled": true}'::jsonb, updated_at = now(), updated_by = 'sql:start'
 where key = 'worker';

select cron.schedule('invoice-intake', '*/5 * * * *', $cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/invoice-intake',
  headers := jsonb_build_object('Content-Type','application/json','x-invoice-worker-key',(select value->>'key' from public.invoice_settings where key='worker')),
  body := jsonb_build_object('action','worker'),
  timeout_milliseconds := 150000
 ) where (select coalesce((value->>'enabled')::boolean,false) from public.invoice_settings where key='worker');
$cron$);

-- 確認（期待：1 行・schedule */5 * * * *・active true・worker_enabled true）
select j.jobname, j.schedule, j.active,
       (select value->>'enabled' from public.invoice_settings where key = 'worker') as worker_enabled
  from cron.job j where j.jobname = 'invoice-intake';
