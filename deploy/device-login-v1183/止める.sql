-- v1183 ログインの試しを止める（全員）。招待のリンクと登録した端末をすべて使えなくし、試す人を空にする。
-- 記録（dl_events）と表は残す（消さない）。止めたあと、端末は次に開いたときに登録を忘れ、いつもの PIN のログインになる。
-- また始めるときは、GM・CEO が「ログインの試し」で人を足し直して招待する。
begin;
update public.dl_invites set revoked_at = now(), revoke_reason = 'trial_stopped' where used_at is null and revoked_at is null;
update public.dl_devices set revoked_at = now(), revoked_by = 'sql', revoke_reason = 'trial_stopped' where revoked_at is null;
insert into public.dl_events (kind, emp_id, actor, result, reason) select 'trial_off', emp_id, 'sql', 'ok', 'trial_stopped' from public.dl_trial;
delete from public.dl_trial;
commit;
select (select count(*) from public.dl_trial) as trial_left, (select count(*) from public.dl_devices where revoked_at is null) as devices_left;
