-- v1157 Google の口コミ：毎日の取り込みを止める（口コミ・店の結び・つなぎ・鍵は消えません）。また始めるときは ⑤ をもう一度。
select cron.unschedule(jobid) from cron.job where jobname = 'google-reviews-daily';
select count(*) as jobs_left from cron.job where jobname = 'google-reviews-daily';
