-- 中間レビュー：利用者を社員 ID で止める（SQL Editor で、< > の 1 か所を書き換えて実行）
-- v1122 から、AM の行は PIN で入ったとき（と SQL を入れたとき）に社員の表から作られ、メールのアカウントを持たない。
-- そのため mid-review-disable-member.sql（メールで探す）では止められない。こちらは社員 ID で探して、その人の行をすべて止める。
-- 止めた人は、次の操作から中間レビューを開けない（一覧・読み書きのすべてでサーバーが断る）。PIN で入り直しても行は作られない。
-- 記録・返信は消さない。担当の店は、アプリの設定で GM が選び直して保存する。
-- CEO・GM の人は、manager_auth の役職を外すのが確か（この SQL で止めても、CEO・GM の行がまだ無ければ PIN で入ったときに作られる）。
do $$
declare v_emp text := '<社員ID>';
        v_n integer;
begin
 if v_emp like '<%' then raise exception '社員 ID を書き換えてください'; end if;
 update public.mr_members set enabled = false, updated_at = now(), updated_by = 'sql' where emp_id = v_emp and (enabled or updated_by = 'v1122 switch');
 get diagnostics v_n = row_count;
 if v_n = 0 and not exists(select 1 from public.mr_members where emp_id = v_emp) then
  -- まだ行が無い人（PIN で入ったことの無い AM）も、入れないように止めた行を作る
  insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
  select gen_random_uuid(), e.id::text, e.name, 'am', false, 'sql' from public.employees e where e.id::text = v_emp;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'この社員 ID は社員の表にありません'; end if;
 end if;
end $$;
-- 確認（読むだけ）
select m.role, m.name, m.emp_id, m.enabled, m.updated_by from public.mr_members m where m.emp_id = '<社員ID>' order by m.enabled desc, m.role;
