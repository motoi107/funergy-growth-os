-- db/mc-escalate-stop.sql を戻す（v815 と同じ登録。何度流しても 1 つだけ）。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mc-escalate')
      where exists (select 1 from cron.job where jobname = 'mc-escalate');
    perform cron.schedule('mc-escalate', '*/15 * * * *', $cron$select public.mc_escalate();$cron$);
  end if;
end $$;
select jobname, schedule, active from cron.job where jobname = 'mc-escalate';
