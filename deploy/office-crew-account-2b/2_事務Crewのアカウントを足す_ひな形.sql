-- 2b：事務Crew のメールのアカウントを足す（1 人ずつ）。Moto さん 11/24「GMやCEOの様にメールで登録（ログインはPINでも入れる様に）」。
-- 先に Supabase → Authentication → Users → Add user で、その人のメールとパスワードのアカウントを作る（Auto Confirm User に印）。
-- 下の 2 つ（メール・社員）を書き換えて Run。社員は従業員マスターの社員の ID（確か）か、名前（完全に同じ。在籍の事務Crew で 1 人だけ当たるとき）。
-- このファイルはひな形です。書き換えたものを GitHub・共有の場所に置かないでください（メールと名前は公開のリポジトリに書かない）。
--
-- 足すのは manager_auth の 1 行（user_id＝そのメールのアカウント・role＝office_crew・emp_id＝その社員の ID）だけ。ほかは何も変えない。
-- 止まる（何も変えない）とき：メールのアカウントが無い／社員が見つからない・2 人以上当たる／退職・OS を止めた人／
--   従業員マスターで事務Crew でない（役割 office_crew か肩書き Office Crew・Office Staff）／そのメールがもう CEO・GM・経理のアカウント
--   （役割を下げない）／そのメールがもう別の社員と結ばれている／その社員がもう別のメールの事務Crew のアカウントと結ばれている。
-- 2 回流しても同じ（もう入っていれば何もしない）。社員の ID が空の事務Crew のアカウントなら、社員の ID だけ入れる。
do $$
declare v_email text := 'name@example.com'; v_who text := '社員の ID か名前';
 v_user uuid; n int; e public.employees; v_emp text; v_role text; v_cur text; v_typ text;
begin
 if btrim(v_email) = 'name@example.com' or btrim(v_who) = '社員の ID か名前' or btrim(v_who) = '' then
  raise exception 'STOP: 上の 2 つ（メールと社員）を書き換えてから Run してください（何も変えていません）';
 end if;
 select count(*) into n from auth.users u where lower(u.email) = lower(btrim(v_email));
 if n <> 1 then raise exception 'STOP: メール % のアカウントが % 件です。先に Authentication → Users → Add user で作ってください（何も変えていません）', v_email, n; end if;
 select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(v_email));
 -- 社員：ID がそのまま当たればその人。当たらなければ名前（完全に同じ・在籍の事務Crew で 1 人だけ）
 select * into e from public.employees x where x.id::text = btrim(v_who);
 if not found then
  select count(*) into n from public.employees x
   where btrim(coalesce(x.name, x.data->>'name', '')) = btrim(v_who) and not public.wr_emp_out(x) and public.wr_exp_crew(x.role, x.title);
  if n <> 1 then raise exception 'STOP: 社員の ID か名前「%」に当たる在籍の事務Crew が % 人です（1 人のときだけ足します。従業員マスターで社員の ID を確かめてください）', v_who, n; end if;
  select * into e from public.employees x
   where btrim(coalesce(x.name, x.data->>'name', '')) = btrim(v_who) and not public.wr_emp_out(x) and public.wr_exp_crew(x.role, x.title);
 end if;
 v_emp := e.id::text;
 if public.wr_emp_out(e) then raise exception 'STOP: 従業員マスターでこの人は退職（または OS を止めた人）です（何も変えていません）'; end if;
 if not public.wr_exp_crew(e.role, e.title) then
  raise exception 'STOP: 従業員マスターでこの人は事務Crew ではありません（役割 office_crew か肩書き Office Crew・Office Staff の人だけ。何も変えていません）';
 end if;
 select format_type(a.atttypid, a.atttypmod) into v_typ from pg_attribute a
  where a.attrelid = 'public.manager_auth'::regclass and a.attname = 'emp_id' and not a.attisdropped;
 select count(*) into n from public.manager_auth a where a.user_id = v_user;
 if n > 1 then raise exception 'STOP: このメールのアカウントの行が manager_auth に % 行あります。Claude に（何も変えていません）', n; end if;
 if n = 1 then
  select a.role, a.emp_id::text into v_role, v_cur from public.manager_auth a where a.user_id = v_user;
  if v_role is distinct from 'office_crew' then
   raise exception 'STOP: このメールはもう % のアカウントです。役割は変えません（何も変えていません）', coalesce(v_role, '（空）');
  end if;
  if v_cur = v_emp then raise notice 'もう入っています（何も変えていません）'; return; end if;
  if coalesce(v_cur, '') <> '' and exists (select 1 from public.employees x where x.id::text = v_cur) then
   raise exception 'STOP: このメールはもう別の社員（ID %）と結ばれています（何も変えていません）', v_cur;
  end if;
 end if;
 if exists (select 1 from public.manager_auth a where a.emp_id::text = v_emp and a.user_id <> v_user and a.role in ('ceo','gm','office','office_crew')) then
  raise exception 'STOP: この社員はもう別のメールのアカウントと結ばれています（1 人 1 つ。何も変えていません）';
 end if;
 if n = 1 then
  execute format('update public.manager_auth set emp_id = $1::%s where user_id = $2 and role = %L', v_typ, 'office_crew') using v_emp, v_user;
  raise notice '社員の ID を入れました';
 else
  execute format('insert into public.manager_auth (user_id, role, emp_id) values ($1, %L, $2::%s)', 'office_crew', v_typ) using v_user, v_emp;
  raise notice '事務Crew のアカウントを足しました';
 end if;
end $$;
-- 足したあとの事務Crew のアカウント（3 の確かめと同じ。ok＝true なら、メールでも PIN（この端末で覚える）でも入れる）
select count(*) filter (where a.role = 'office_crew') as office_crew_accounts,
  count(*) filter (where a.role = 'office_crew' and e.id is not null and not public.wr_emp_out(e) and public.wr_exp_crew(e.role, e.title)) as ok
from public.manager_auth a left join public.employees e on e.id::text = a.emp_id::text;
