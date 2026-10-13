-- 中間レビュー：AM（Yuki さん）を足す。
-- **書き換えるところはありません。** この全文を Supabase → SQL Editor に貼って Run するだけです。
-- 先に Supabase の Authentication → Users で yuki@funergygroup.com のアカウントを作っておいてください。
-- 社員の名前は、社員の表（employees）で役職が AM の在籍者から自動で決めます（1 人に決まらないときは止まります）。
-- 何度流しても同じ結果です（もう入っていれば名前と社員 ID を今の社員の表に合わせるだけ）。
do $$
declare v_email text := 'yuki@funergygroup.com';
        v_role  text := 'am';
        v_user uuid; v_emp text; v_name text; v_list text; v_n integer; v_old text; v_old_on boolean;
begin
 select id into v_user from auth.users where lower(email) = lower(v_email);
 if v_user is null then
  raise exception 'メール % のアカウントがまだありません。Authentication → Users で作ってから、もう一度この SQL を流してください。', v_email;
 end if;

 select count(*), min(e.id::text), min(e.name), string_agg(e.name, ' / ' order by e.name)
   into v_n, v_emp, v_name, v_list
   from public.employees e
  where lower(trim(coalesce(e.role, ''))) = 'am' and coalesce(e.status, '') <> '退職';
 if v_n = 0 then
  raise exception '社員の表に、役職が AM の在籍者がいません。社員の表で Yuki さんの役職を AM にしてから流してください。';
 end if;
 if v_n > 1 then
  raise exception '役職が AM の在籍者が % 人います（%）。どの人かを Claude に伝えてください（この SQL は流れていません）。', v_n, v_list;
 end if;

 select role, enabled into v_old, v_old_on from public.mr_members where user_id = v_user;
 if v_old is not null and v_old <> v_role then
  raise exception 'この人はもう % として入っています（役職は変えません）。Claude に伝えてください。', v_old;
 end if;
 if v_old is not null and not v_old_on then
  raise exception 'この人は止めてあります。戻してよいか Claude に伝えてください（この SQL は流れていません）。';
 end if;

 insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
  values(v_user, v_emp, v_name, v_role, true, 'sql')
  on conflict (user_id) do update set enabled = true, emp_id = excluded.emp_id, name = excluded.name, updated_at = now(), updated_by = 'sql';
 raise notice 'AM として足しました：% （社員 %）', v_name, v_emp;
end $$;
-- 確認（読むだけ）。ceo・gm・am の 3 行が出れば、この手順は終わりです。
select m.role, m.name, m.emp_id, m.enabled, e.name as employee_name, e.role as employee_role, e.status as employee_status
from public.mr_members m left join public.employees e on e.id::text = m.emp_id
order by m.role, m.name;
