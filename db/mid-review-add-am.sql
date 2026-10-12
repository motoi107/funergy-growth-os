-- 中間レビュー：AM を 1 人足す（SQL Editor で、< > の 2 か所を書き換えて 1 回だけ実行）
-- 先に Supabase の Authentication → Users で、その人のメールのアカウントを作っておく。
-- 社員の ID は社員の表（employees）から名前で探す。ちょうど 1 人に決まらないときは空のまま入れる
-- （入れるのはできる。「この端末で覚える」が使えず、毎回メール認証になる。あとで emp_id を入れれば直る）。
do $$
declare v_email text := '<AM のメールアドレス>';
        v_name  text := '<社員の表の名前の一部（例：Yuki）>';
        v_user uuid; v_emp text; v_n integer;
begin
 select id into v_user from auth.users where lower(email) = lower(v_email);
 if v_user is null then raise exception 'このメールのアカウントがまだありません。Authentication → Users で作ってから実行してください。'; end if;
 select count(*), min(e.data->>'id') into v_n, v_emp from public.employees e
  where e.data->>'name' ilike '%' || v_name || '%' and coalesce(e.data->>'status', '') <> '退職';
 if v_n <> 1 then v_emp := null; raise notice '社員の表で % 人が当たったので、社員の ID は空のまま入れます', v_n; end if;
 insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
  values(v_user, v_emp, v_name, 'am', true, 'sql')
  on conflict (user_id) do update set role = 'am', enabled = true, emp_id = coalesce(excluded.emp_id, public.mr_members.emp_id),
   name = excluded.name, updated_at = now(), updated_by = 'sql';
end $$;
-- 確認（読むだけ）
select m.role, m.name, m.emp_id, m.enabled, e.data->>'name' as employee_name
from public.mr_members m left join public.employees e on e.data->>'id' = m.emp_id
order by m.role, m.name;
