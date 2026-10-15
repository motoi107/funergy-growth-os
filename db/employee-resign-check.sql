-- 退職の確かめ（読むだけ・v1085）。SQL を入れる前と入れたあとに流す。表の中身は何も変えない
-- （この接続のあいだだけの関数 pg_temp.resign_check を作って読むだけ。接続を閉じると消える）。PIN の値は出さない。
-- 見るところ：
--   ・in service, but the latest offboarding is 完了 … 退職手続きを完了したのに在籍に戻っている人（復活した人の候補）。
--     修復はアプリの従業員マスター（GM・CEO）の「退職の記録と食い違う人」で 1 人ずつ（推測で退職にしない）。
--   ・manager accounts linked to a resigned / stopped employee and still active … 退職した人のメールのアカウントが使える。
--     4_既に退職の人のアクセスを止める.sql で止める（その前に、ほかの人と共用していないか確かめる）。
--   ・manager accounts not linked to an employee … 誰のものか分からないアカウント（自動では止まらない）。
--   ・bot accounts not linked to an employee … 業務Bot だけのアカウント（自動では止まらない。退職したら enabled を false に）。
--   ・resigned / stopped employees whose PIN still works … 4_ で止める。
--   ・status writes kept … 古い写しからの書き込みで状態を残した回数（v1084 以前の端末がまだ使われている）。
create or replace function pg_temp.resign_check() returns table(n integer, item text, value text, verdict text, detail text)
language plpgsql as $$
declare v text; d text; c integer; guard boolean;
begin
 guard := to_regprocedure('public.employee_access_state(text,boolean)') is not null;
 n := 1; item := 'guard installed (20261023090000)'; value := case when guard then 'yes' else 'no' end;
 verdict := case when guard then 'OK' else '未（2_追加のSQL を流す前）' end; detail := null; return next;

 n := 2; item := 'employees resigned or OS account off';
 select count(*) into c from public.employees e where coalesce(nullif(e.data->>'status',''), e.status, '') = '退職' or coalesce(e.data->'osDisabled' = 'true'::jsonb, false);
 value := c::text; verdict := 'info'; detail := null; return next;

 n := 3; item := 'employees whose status column differs from the data';
 select count(*), string_agg(e.id::text || ' ' || coalesce(e.data->>'name',''), ', ' order by e.id::text) into c, d from public.employees e
  where e.data is not null and nullif(e.data->>'status','') is not null and e.data->>'status' is distinct from e.status;
 value := c::text; verdict := case when c = 0 then 'OK' else 'info（アプリは data を読む）' end; detail := left(d, 900); return next;

 n := 4; item := 'in service, but the latest offboarding is 完了 (resurrected?)'; value := 'n/a'; verdict := 'app_state が無い'; detail := null;
 if to_regclass('public.app_state') is not null then
  with ob as (
   select o.value as r from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) o
   where s.key = 'offboardings' or s.key like 'spl\_offboardings\_%' escape '\'
  ), latest as (
   select distinct on (r->>'empId') r->>'empId' as emp, r from ob
   where coalesce(r->>'empId','') <> '' and not coalesce(r->'_deleted' = 'true'::jsonb, false)
   order by r->>'empId', coalesce(r->>'initiatedAt','') desc, coalesce(r->>'completedAt','') desc
  )
  select count(*), string_agg(e.id::text || ' ' || coalesce(e.data->>'name','') || '（いま ' || coalesce(nullif(e.data->>'status',''), e.status, '') || '・完了 ' || coalesce(l.r->>'completedAt','?')
     || ' ' || coalesce(l.r->>'completedBy','') || '・最終出勤 ' || coalesce(l.r->>'lastWorkDate','') || coalesce('・入社 ' || nullif(e.data->>'hireDate',''), '') || '）', '、 ' order by e.id::text)
   into c, d
  from latest l join public.employees e on e.id::text = l.emp
  where l.r->>'status' = '完了'
   and not (coalesce(nullif(e.data->>'status',''), e.status, '') = '退職' or coalesce(e.data->'osDisabled' = 'true'::jsonb, false))
   and coalesce(e.data->>'_restoreAt','') <= coalesce(l.r->>'completedAt','');
  value := c::text; verdict := case when c = 0 then 'OK' else '要確認（アプリの「退職の記録と食い違う人」で 1 人ずつ）' end; detail := left(d, 1800);
 end if;
 return next;

 n := 5; item := 'manager accounts linked to a resigned / stopped employee and still active'; value := 'n/a'; verdict := 'manager_auth に emp_id が無い'; detail := null;
 if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
  execute $q$ select count(*), string_agg(m.user_id::text || ' ' || coalesce(m.role,'') || ' → ' || e.id::text || ' ' || coalesce(e.data->>'name',''), '、 ')
   from public.manager_auth m join public.employees e on e.id::text = m.emp_id::text
   where coalesce(m.role,'') <> 'suspended' and (coalesce(nullif(e.data->>'status',''), e.status, '') = '退職' or coalesce(e.data->'osDisabled' = 'true'::jsonb, false)) $q$ into c, d;
  value := c::text; verdict := case when c = 0 then 'OK' else '要対応（4_ で止める。共用なら先に紐づけを直す）' end; detail := left(d, 900);
 end if;
 return next;

 n := 6; item := 'manager accounts not linked to an employee'; value := 'n/a'; verdict := null; detail := null;
 if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
  if to_regclass('auth.users') is not null then
   execute $q$ select count(*), string_agg(m.user_id::text || ' ' || coalesce(m.role,'') || coalesce(' ' || u.email, ''), '、 ') from public.manager_auth m
    left join auth.users u on u.id::text = m.user_id::text
    where coalesce(m.emp_id::text,'') = '' or not exists(select 1 from public.employees e where e.id::text = m.emp_id::text) $q$ into c, d;
  else
   execute $q$ select count(*), string_agg(m.user_id::text || ' ' || coalesce(m.role,''), '、 ') from public.manager_auth m
    where coalesce(m.emp_id::text,'') = '' or not exists(select 1 from public.employees e where e.id::text = m.emp_id::text) $q$ into c, d;
  end if;
  value := c::text; verdict := case when c = 0 then 'OK' else 'info（退職しても自動では止まらない）' end; detail := left(d, 900);
 end if;
 return next;

 n := 7; item := 'bot accounts not linked to an employee (enabled)'; value := 'n/a'; verdict := 'bot_users が無い'; detail := null;
 if to_regclass('public.bot_users') is not null then
  if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
   execute $q$ select count(*), string_agg(b.user_id::text, '、 ') from public.bot_users b where b.enabled
    and not exists(select 1 from public.manager_auth m join public.employees e on e.id::text = m.emp_id::text where m.user_id::text = b.user_id::text) $q$ into c, d;
  else
   execute $q$ select count(*), string_agg(b.user_id::text, '、 ') from public.bot_users b where b.enabled $q$ into c, d;
  end if;
  value := c::text; verdict := case when c = 0 then 'OK' else 'info（退職したら bot_users.enabled を false に）' end; detail := left(d, 900);
 end if;
 return next;

 n := 8; item := 'resigned / stopped employees whose PIN still works'; value := 'n/a'; verdict := 'auth_pins が無い'; detail := null;
 if to_regclass('public.auth_pins') is not null then
  execute $q$ with p as (select coalesce((select a.data from public.auth_pins a where a.id = 'staff'), '{}'::jsonb) as m)
   select count(*), string_agg(e.id::text || ' ' || coalesce(e.data->>'name',''), '、 ' order by e.id::text) from public.employees e, p
   where (coalesce(nullif(e.data->>'status',''), e.status, '') = '退職' or coalesce(e.data->'osDisabled' = 'true'::jsonb, false))
    and nullif(btrim(coalesce(e.data->>'name','')), '') is not null
    and (p.m->>btrim(e.data->>'name')) is distinct from '!blocked'
    and not exists(select 1 from public.employees x where x.id::text <> e.id::text and btrim(coalesce(x.data->>'name','')) = btrim(e.data->>'name')
      and not (coalesce(nullif(x.data->>'status',''), x.status, '') = '退職' or coalesce(x.data->'osDisabled' = 'true'::jsonb, false))) $q$ into c, d;
  value := c::text; verdict := case when c = 0 then 'OK' else '要対応（4_ で止める）' end; detail := left(d, 900);
 end if;
 return next;

 n := 9; item := 'resigned / stopped employees sharing a name with someone in service (PIN not stopped by name)'; value := '0'; verdict := 'OK'; detail := null;
 select count(*), string_agg(e.id::text || ' ' || coalesce(e.data->>'name',''), '、 ') into c, d from public.employees e
  where (coalesce(nullif(e.data->>'status',''), e.status, '') = '退職' or coalesce(e.data->'osDisabled' = 'true'::jsonb, false))
   and exists(select 1 from public.employees x where x.id::text <> e.id::text and btrim(coalesce(x.data->>'name','')) = btrim(coalesce(e.data->>'name',''))
    and not (coalesce(nullif(x.data->>'status',''), x.status, '') = '退職' or coalesce(x.data->'osDisabled' = 'true'::jsonb, false)));
 value := c::text; verdict := case when c = 0 then 'OK' else 'info（PIN は名前で決まるので止めない。在籍の人の PIN を変えてもらう）' end; detail := left(d, 900); return next;

 n := 10; item := 'status writes kept (stale copies) in the last 30 days'; value := 'n/a'; verdict := null; detail := null;
 if to_regclass('public.employee_status_log') is not null then
  execute $q$ select count(*), string_agg(distinct l.emp_id || ' ' || coalesce(l.old_status,'') || '→' || coalesce(l.new_status,''), '、 ')
   from public.employee_status_log l where l.kind = 'kept' and l.at > now() - interval '30 days' $q$ into c, d;
  value := c::text; verdict := case when c = 0 then 'OK' else 'info（前の版の端末がまだある）' end; detail := left(d, 900);
 end if;
 return next;

 n := 11; item := 'resignations that were sent on a stale copy and not taken (last 30 days)'; value := 'n/a'; verdict := null; detail := null;
 if to_regclass('public.employee_status_log') is not null then
  execute $q$ select count(*), string_agg(l.emp_id || ' ' || to_char(l.at, 'YYYY-MM-DD HH24:MI') || ' ' || coalesce(l.by_name,''), '、 ')
   from public.employee_status_log l where l.kind = 'kept' and l.new_status = '退職' and l.old_status <> '退職' and l.at > now() - interval '30 days' $q$ into c, d;
  value := c::text; verdict := case when c = 0 then 'OK' else '要確認（その端末で退職にしたが入っていない。更新した端末でやり直す）' end; detail := left(d, 900);
 end if;
 return next;

 n := 12; item := 'access stops failed (last 30 days)'; value := 'n/a'; verdict := null; detail := null;
 if to_regclass('public.employee_status_log') is not null then
  execute $q$ select count(*), string_agg(l.emp_id || ' ' || coalesce(l.detail->>'step','') || ' ' || coalesce(l.detail->>'error',''), '、 ')
   from public.employee_status_log l where l.kind = 'apply_failed' and l.at > now() - interval '30 days' $q$ into c, d;
  value := c::text; verdict := case when c = 0 then 'OK' else '要確認' end; detail := left(d, 900);
 end if;
 return next;
end $$;
select item, value, verdict, detail from pg_temp.resign_check() order by n;
