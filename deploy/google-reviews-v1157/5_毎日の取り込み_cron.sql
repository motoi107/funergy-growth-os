-- v1157 Google の口コミ：毎日 4:30（ハワイ）に Business Profile の口コミを取る（鍵は画面に出さない）。
-- 4:30 HST ＝ 14:30 UTC（ハワイは夏時間なし）。2 回流しても 1 つのまま（同じ名前の予定を置き換える）。
-- Business Profile をつないでいないあいだは、関数が何もせずに終わる（記録だけ）。
select cron.schedule('google-reviews-daily', '30 14 * * *', $cron$
 select net.http_post(
  url := 'https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/google-reviews',
  headers := jsonb_build_object('Content-Type','application/json','x-gr-worker-key',(select worker_key from public.gr_settings where id = 1)),
  body := jsonb_build_object('action','worker'),
  timeout_milliseconds := 150000
 );
$cron$);

-- 確認（期待：1 行・schedule 30 14 * * *・active true）
select j.jobname, j.schedule, j.active from cron.job j where j.jobname = 'google-reviews-daily';
