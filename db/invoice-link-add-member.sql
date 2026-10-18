-- 紐づけ（食材マスター › 紐づけ・アプリ v1093）に Head Chef・AM のメールのアカウントを足す（Moto さん 10/18 決まったこと 5）。
-- 1 人ずつ流す。先に Supabase → Authentication → Users → Add user で、その人のメールとパスワードのアカウントを作る（Auto Confirm User に印）。
-- 下の 3 つ（メール・社員の名前・役割）を書き換えて Run。名前は従業員マスターの名前（完全に同じに書くのが確か。'Taro%' のように % で前だけでもよいが、在籍の人が 2 人以上当たると止まる）。
-- 足すのは、従業員マスターでその名前の在籍の人が 1 人だけで、役割が合うとき（chef＝Head Chef／Corporate Chef、am＝Area Manager）。
-- 違えば止まる（何も変えない）。この人ができるのは食材マスターの紐づけだけ（Invoice取込のほかの画面は使えない）。
-- 退職・役割が変わると、従業員マスターのとおり、その時点で使えなくなる（行はそのまま）。止めるときは一番下。
do $$
declare v_email text := 'name@example.com'; v_name text := '社員の名前'; v_role text := 'chef';
 v_user uuid; v_emp text; n int;
begin
 if v_role not in ('am','chef') then raise exception '役割は chef（Head Chef）か am（AM）にしてください（何も変えていません）'; end if;
 select id into v_user from auth.users where lower(email) = lower(btrim(v_email));
 if v_user is null then raise exception 'メール % のアカウントがありません。先に Authentication → Users で作ってください（何も変えていません）', v_email; end if;
 select count(*), min(x.id) into n, v_emp from (select e.id::text id, to_jsonb(e) j from public.employees e) x
  where x.j->>'name' ilike v_name and coalesce(nullif(x.j->'data'->>'status',''), x.j->>'status', '') <> '退職';
 if n <> 1 then raise exception '従業員マスターで「%」の在籍の人が % 人です（1 人のときだけ足します。名前を確かめてください）', v_name, n; end if;
 if not public.invoice_link_hr_ok(v_emp, v_role) then raise exception '従業員マスターで、この人の役割が % ではありません（Head Chef は chef、AM は am）。何も変えていません', v_role; end if;
 insert into public.invoice_link_members(user_id, emp_id, role, enabled, added_by) values (v_user, v_emp, v_role, true, 'sql')
 on conflict (user_id) do update set emp_id = excluded.emp_id, role = excluded.role, enabled = true, updated_at = now();
end $$;
-- 今の一覧（ok＝いま紐づけに使える）
select m.role, m.enabled, e.name, public.invoice_link_hr_ok(m.emp_id, m.role) as ok, m.added_at
from public.invoice_link_members m left join public.employees e on e.id::text = m.emp_id order by m.added_at;
-- 止めるとき（その人の行を残したまま使えなくする）：
-- update public.invoice_link_members set enabled = false, updated_at = now() where user_id = (select id from auth.users where lower(email) = lower('name@example.com'));
