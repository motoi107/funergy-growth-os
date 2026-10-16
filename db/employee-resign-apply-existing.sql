-- 既に退職（または OS アカウントの無効化）になっている人のアクセスを止める（v1085・20261023090000 のあと）。2 回流しても同じ。
-- 止めるもの：ログインの PIN（同じ名前の在籍者がいるときは止めない）・その人に紐づく管理者のメールのアカウントと業務Bot の利用。
-- 先に 1_確かめ・読むだけ.sql で「manager accounts linked to a resigned / stopped employee and still active」に
-- ほかの人と共用しているアカウントが無いことを確かめてから流す（共用なら先に manager_auth.emp_id を使っている人に直す）。
-- 社員の表の状態は変えない（在籍の人には何もしない・推測で退職にしない）。戻すときは、その人を在籍に戻せば元に戻る。
do $$
begin
 if to_regprocedure('public.employee_access_apply(text)') is null then
  raise exception '先に 20261023090000_employee_resign_guard.sql（2_追加のSQL）を流してください（何も変えていません）';
 end if;
end $$;
select e.id::text as emp_id, coalesce(e.data->>'name', '') as name, public.employee_access_apply(e.id::text) as result
from public.employees e
where public.emp_blocked_of(e.status, e.data)
order by e.id::text;
