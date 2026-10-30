-- v1118 キャッシュチップ：毎日 2 回、終わった営業日の未登録に 0 を書く（ハワイ時間 4:17 と 8:47。直近 62 日）
-- 2 回目は朝 9:00 の業務Bot の知らせより前。売上の取り込みが遅れた日も、次の回で書きます。
select cron.unschedule(jobid) from cron.job where jobname in ('cash-tip-autofill-a', 'cash-tip-autofill-b');
select cron.schedule('cash-tip-autofill-a', '17 14 * * *', $cron$ select public.cash_tip_autofill((now() at time zone 'Pacific/Honolulu')::date - 62, null, true); $cron$);
select cron.schedule('cash-tip-autofill-b', '47 18 * * *', $cron$ select public.cash_tip_autofill((now() at time zone 'Pacific/Honolulu')::date - 62, null, true); $cron$);

-- 確認（期待：2 行・active true）
select jobname, schedule, active from cron.job where jobname like 'cash-tip-autofill-%' order by jobname;
