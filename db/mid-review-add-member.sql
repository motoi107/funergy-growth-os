-- 中間レビュー：利用者を 1 人足す（SQL Editor で、< > の 3 か所を書き換えて 1 回だけ実行）
-- 先に Supabase の Authentication → Users で、その人のメールのアカウントを作っておく。
-- ここで足すのは AM・GM・CEO だけ。Head Chef・Corporate Chef と入力担当（PIN だけの人）は、アプリの「担当・閲覧設定」で足す。
-- ・社員の名前は社員の表（employees）の名前と完全に同じに書く（在籍者が 1 人に決まらないときは止まる）。
-- ・AM として足すのは、社員の表の役職が AM（am）の人だけ（G4 の店長は入れない）。
-- ・CEO・GM は manager_auth でも CEO・GM であること（そこで外れると、ここでも入れなくなる）。
--   manager_auth に社員の ID があるときは、ここで選んだ社員と同じであること。
-- ・すでにいる人の役職は変えない（違う役職で足そうとすると止まる。変えるときは Claude に相談）。
-- ・止めた人（mid-review-disable-member.sql）は、v_reenable を true にしたときだけ戻す。
-- ・同じ社員が入力担当として PIN だけで入っていたら（staff）、その行は止めて、このメールの行に置き換える
--   （社員 1 人に有効な行は 1 つ。PIN で入っても、この行で入る）。Head Chef・Corporate Chef の行があるときは止まる。
do $$
declare v_email text := '<メールアドレス>';
        v_name  text := '<社員の表の名前（完全に同じ）>';
        v_role  text := '<am / gm / ceo のどれか>';
        v_reenable boolean := false;
        v_user uuid; v_emp text; v_emp_role text; v_n integer; v_old text; v_old_on boolean; v_ma_emp text; v_other uuid; v_other_role text;
begin
 if v_role not in ('am','gm','ceo') then raise exception '役職は am・gm・ceo のどれかにしてください'; end if;
 select id into v_user from auth.users where lower(email) = lower(v_email);
 if v_user is null then raise exception 'このメールのアカウントがまだありません。Authentication → Users で作ってから実行してください。'; end if;
 select count(*), min(e.id::text), min(e.role) into v_n, v_emp, v_emp_role from public.employees e
  where e.name = v_name and coalesce(e.status, '') <> '退職';
 if v_n <> 1 then raise exception '社員の表で「%」の在籍者が % 人です（1 人のときだけ足せます）', v_name, v_n; end if;
 if v_role = 'am' and coalesce(v_emp_role, '') <> 'am' then raise exception '社員の表の役職が AM ではありません（%）。AM だけを足せます', coalesce(v_emp_role, '空'); end if;
 if v_role in ('gm','ceo') then
  if not exists(select 1 from public.manager_auth a where a.user_id = v_user and a.role = v_role) then
   raise exception 'manager_auth で CEO・GM になっていないので足せません'; end if;
  select nullif(a.emp_id::text, '') into v_ma_emp from public.manager_auth a where a.user_id = v_user;
  if v_ma_emp is not null and v_ma_emp <> v_emp then raise exception 'manager_auth の社員（%）と、ここで選んだ社員（%）が違います', v_ma_emp, v_emp; end if;
 end if;
 select role, enabled into v_old, v_old_on from public.mr_members where user_id = v_user;
 if v_old is not null and v_old <> v_role then raise exception 'この人はもう % として入っています（役職は変えません）', v_old; end if;
 if v_old is not null and not v_old_on and not v_reenable then raise exception 'この人は止めてあります。戻すときは v_reenable を true にして実行してください'; end if;
 select user_id, role into v_other, v_other_role from public.mr_members where emp_id = v_emp and enabled and user_id <> v_user;
 if v_other is not null then
  if v_other_role <> 'staff' then raise exception 'この社員はもう % として入っています（担当・閲覧設定で外してから実行してください）', v_other_role; end if;
  update public.mr_members set enabled = false, updated_at = now(), updated_by = 'sql' where user_id = v_other;
  raise notice 'PIN だけの行（入力担当）を止めて、このメールの行に置き換えました';
 end if;
 insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
  values(v_user, v_emp, v_name, v_role, true, 'sql')
  on conflict (user_id) do update set enabled = true, emp_id = excluded.emp_id, name = excluded.name, updated_at = now(), updated_by = 'sql';
end $$;
-- 確認（読むだけ）
select m.role, m.name, m.emp_id, m.enabled, e.name as employee_name, e.role as employee_role, e.status as employee_status
from public.mr_members m left join public.employees e on e.id::text = m.emp_id
order by m.role, m.name;
