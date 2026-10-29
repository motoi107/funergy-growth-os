-- 従業員の変更記録を止める（記録は消さない・従業員の表は変えない・2026-10-29）
-- 見張りだけを外します。これまでの記録（employee_field_log）は残ります。もう一度始めるときは 1_追加のSQL.sql を流してください。
drop trigger if exists employees_field_log_trg on public.employees;
select '止めました（記録は残っています）' as "結果";
