-- v1118 キャッシュチップ：毎日の自動の0 を止める（書いた 0 はそのまま残ります。戻すときは 戻す_埋めた0.sql）
select cron.unschedule(jobid) from cron.job where jobname in ('cash-tip-autofill-a', 'cash-tip-autofill-b');
select count(*) as remaining_jobs from cron.job where jobname like 'cash-tip-autofill-%';
