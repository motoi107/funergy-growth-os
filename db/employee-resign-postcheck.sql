-- 退職の保護（20261023090000）が入ったかの確認（読むだけ・v1085）。7 行すべて OK なら入っている。
with fn as (
 select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg, p.oid, p.pronargs
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('emp_status_ver','emp_status_key','emp_blocked_of','emp_pin_mark','emp_privileged','emp_reinstate_ok','employee_status_note',
  'employees_status_guard','employees_delete_guard','employee_pin_reconcile','employee_access_apply','employees_access_after','employee_restore','auth_pin_put',
  'employee_access_state','offboard_record_guard')
), trg as (
 select t.tgname from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D' and (
  (t.tgrelid = to_regclass('public.employees') and t.tgname in ('employees_status_guard_trg','employees_access_after_trg','employees_delete_guard_trg'))
  or (t.tgrelid = to_regclass('public.app_state') and t.tgname = 'offboard_record_guard_trg'))
), want as (
 select 3 + case when to_regclass('public.app_state') is not null then 1 else 0 end as n
)
select 'functions (16; the restore takes the restorer''s role)' as item, (select count(*) from fn)::text as value,
  case when (select count(*) from fn) = 16 and exists(select 1 from fn where proname = 'employee_restore' and pronargs = 4) then 'OK' else 'NG：2_追加のSQL を流す' end as verdict
union all select 'fixed search_path on all', (select count(*) from fn where cfg like '%search_path=public%')::text,
  case when (select count(*) from fn where cfg like '%search_path=public%') = 16 then 'OK' else 'NG' end
union all select 'security definer (8: note, guard, delete guard, pin, apply, after, state, offboard)', (select count(*) from fn where prosecdef)::text,
  case when (select count(*) from fn where prosecdef and proname in ('employee_status_note','employees_status_guard','employees_delete_guard','employee_pin_reconcile',
    'employee_access_apply','employees_access_after','employee_access_state','offboard_record_guard')) = 8
   and (select count(*) from fn where prosecdef) = 8 then 'OK' else 'NG' end
union all select 'triggers (employees 3 + app_state 1, enabled)', (select count(*) from trg)::text || ' / ' || (select n from want)::text,
  case when (select count(*) from trg) = (select n from want) then 'OK' else 'NG：見張りが無い・止まっている' end
union all select 'app key can call only employee_access_state',
  (select string_agg(proname, ',' order by proname) from fn where has_function_privilege('anon', oid, 'execute')),
  case when (select string_agg(proname, ',' order by proname) from fn where has_function_privilege('anon', oid, 'execute')) = 'employee_access_state' then 'OK' else 'NG' end
union all select 'app key cannot read the held PINs / the log',
  (case when to_regclass('public.employee_access_hold') is null or to_regclass('public.employee_status_log') is null then 'missing'
   else (has_table_privilege('anon', 'public.employee_access_hold', 'select') or has_table_privilege('anon', 'public.employee_status_log', 'select'))::text end),
  case when to_regclass('public.employee_access_hold') is not null and to_regclass('public.employee_status_log') is not null
   and not has_table_privilege('anon', 'public.employee_access_hold', 'select') and not has_table_privilege('anon', 'public.employee_status_log', 'select') then 'OK' else 'NG' end
union all select 'employee rows without a state version (right after the SQL: 0)',
  (select count(*) from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object' and not (e.data ? '_stV'))::text,
  case when (select count(*) from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object' and not (e.data ? '_stV')) = 0 then 'OK' else 'NG：2_追加のSQL を流し直す' end;
