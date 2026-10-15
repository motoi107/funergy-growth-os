-- v1084: 管理統括・対応依頼の画面は廃止した（Moto 10/15）。
-- サーバーの 15 分ごとの自動の再通知・エスカレーション（pg_cron の mc-escalate → public.mc_escalate()）を止める。
-- 流すかは Moto さんの判断。流さなくてもアプリは壊れない（作られた通知を読む画面が無いだけ）。
-- 表（management_*）・関数・記録は消さない。戻すときは db/mc-escalate-restart.sql。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mc-escalate')
      where exists (select 1 from cron.job where jobname = 'mc-escalate');
  end if;
end $$;
-- 確認（0 行なら止まっている）
select jobname, schedule, active from cron.job where jobname = 'mc-escalate';
