-- 退職の保護（20261023090000）を外す（v1085 の取り消し）。2 回流しても同じ。
-- 止めた PIN・管理者のメールのアカウント・業務Bot の利用を元に戻してから、見張り（トリガー）と関数を外す。
-- 社員の表の行（状態・data の _stV など）・退職記録（app_state）は変えない。記録（employee_status_log）は残す。
-- 外したあとは、前の版のアプリの端末が古い写しで退職した人を在籍に戻せる（v1084 と同じ）。
-- 関数 auth-pin を v1085 のままにすると、PIN の変更（auth_pin_put）が無くなるので前の書き方に戻る（auth-pin は両方に合う）。
do $$
declare h record; cur jsonb;
begin
 if to_regclass('public.employee_access_hold') is null then return; end if;
 for h in select * from public.employee_access_hold order by kind, key loop
  if h.kind = 'pin' and to_regclass('public.auth_pins') is not null then
   select a.data into cur from public.auth_pins a where a.id = 'staff' for update;
   if found and (cur->>h.key) = '!blocked' then
    update public.auth_pins set data = case when h.prev is null or jsonb_typeof(h.prev) = 'null' then cur - h.key else jsonb_set(cur, array[h.key], h.prev, true) end where id = 'staff';
   end if;
  elsif h.kind = 'manager' and to_regclass('public.manager_auth') is not null then
   update public.manager_auth set role = h.prev->>'role' where user_id::text = h.key and role = 'suspended';
  elsif h.kind = 'bot' and to_regclass('public.bot_users') is not null then
   update public.bot_users set enabled = true where user_id::text = h.key and not enabled;
  end if;
  delete from public.employee_access_hold where kind = h.kind and key = h.key;
 end loop;
end $$;
do $$
begin
 if to_regclass('public.employees') is not null then
  execute 'drop trigger if exists employees_status_guard_trg on public.employees';
  execute 'drop trigger if exists employees_access_after_trg on public.employees';
  execute 'drop trigger if exists employees_delete_guard_trg on public.employees';
 end if;
 if to_regclass('public.app_state') is not null then
  execute 'drop trigger if exists offboard_record_guard_trg on public.app_state';
 end if;
end $$;
drop function if exists public.employee_access_state(text, boolean);
drop function if exists public.employee_restore(text, text, boolean, text);
drop function if exists public.employee_restore(text, text, boolean);
drop function if exists public.employee_restore(text, text);
drop function if exists public.auth_pin_put(text, text, text);
drop function if exists public.offboard_record_guard();
drop function if exists public.employees_access_after();
drop function if exists public.employee_access_apply(text);
drop function if exists public.employee_pin_reconcile(text);
drop function if exists public.employees_status_guard();
drop function if exists public.employees_delete_guard();
drop function if exists public.employee_status_note(text, text, text, text, integer, text, jsonb);
drop function if exists public.emp_reinstate_ok();
drop function if exists public.emp_privileged();
drop function if exists public.emp_pin_mark();
drop function if exists public.emp_blocked_of(text, jsonb);
drop function if exists public.emp_status_key(text, jsonb);
drop function if exists public.emp_status_ver(jsonb);
drop table if exists public.employee_access_hold;
