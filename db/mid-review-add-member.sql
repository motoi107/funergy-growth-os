-- 中間レビュー：利用者を 1 人足す（SQL Editor で、< > の 3 か所を書き換えて 1 回だけ実行）
-- 先に Supabase の Authentication → Users で、その人のメールのアカウントを作っておく。
-- ・社員の名前は社員の表（employees）の名前と完全に同じに書く（1 人に決まらないときは止まる）。
-- ・AM として足すのは、社員の表の役職が AM（am）の人だけ（G4 の店長は入れない）。
-- ・CEO・GM は manager_auth でも CEO・GM であること（そこで外れると、ここでも入れなくなる）。
-- ・すでにいる人の役職は変えない（違う役職で足そうとすると止まる。変えるときは Claude に相談）。
do $$
declare v_email text := '<メールアドレス>';
        v_name  text := '<社員の表の名前（完全に同じ）>';
        v_role  text := '<am / gm / ceo のどれか>';
        v_user uuid; v_emp text; v_emp_role text; v_n integer; v_old text;
begin
 if v_role not in ('am','gm','ceo') then raise exception '役職は am・gm・ceo のどれかにしてください'; end if;
 select id into v_user from auth.users where lower(email) = lower(v_email);
 if v_user is null then raise exception 'このメールのアカウントがまだありません。Authentication → Users で作ってから実行してください。'; end if;
 select count(*), min(e.data->>'id'), min(e.data->>'role') into v_n, v_emp, v_emp_role from public.employees e
  where e.data->>'name' = v_name and coalesce(e.data->>'status', '') <> '退職';
 if v_n <> 1 then raise exception '社員の表で「%」の在籍者が % 人です（1 人のときだけ足せます）', v_name, v_n; end if;
 if v_role = 'am' and coalesce(v_emp_role, '') <> 'am' then raise exception '社員の表の役職が AM ではありません（%）。AM だけを足せます', coalesce(v_emp_role, '空'); end if;
 if v_role in ('gm','ceo') and not exists(select 1 from public.manager_auth a where a.user_id = v_user and a.role in ('ceo','gm')) then
  raise exception 'manager_auth で CEO・GM になっていないので足せません'; end if;
 select role into v_old from public.mr_members where user_id = v_user;
 if v_old is not null and v_old <> v_role then raise exception 'この人はもう % として入っています（役職は変えません）', v_old; end if;
 insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
  values(v_user, v_emp, v_name, v_role, true, 'sql')
  on conflict (user_id) do update set enabled = true, emp_id = excluded.emp_id, name = excluded.name, updated_at = now(), updated_by = 'sql';
end $$;
-- 確認（読むだけ）
select m.role, m.name, m.emp_id, m.enabled, e.data->>'name' as employee_name, e.data->>'role' as employee_role
from public.mr_members m left join public.employees e on e.data->>'id' = m.emp_id
order by m.role, m.name;
