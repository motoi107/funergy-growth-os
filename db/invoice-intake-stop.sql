-- Invoice取込：5 分ごとの取込を止める（記録・設定・鍵は消えません）
update public.invoice_settings
   set value = value || '{"enabled": false}'::jsonb, updated_at = now(), updated_by = 'sql:stop'
 where key = 'worker';
select cron.unschedule(jobid) from cron.job where jobname = 'invoice-intake';
select count(*) as jobs_left from cron.job where jobname = 'invoice-intake';
