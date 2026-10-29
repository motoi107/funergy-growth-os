-- 従業員の変更記録（Moto さん 10/29・PR #99 の Codex の P1 の扱い「(c) で受け入れ・変更記録を足す・あとで (b)」）。
-- なぜ：従業員の表（employees）はアプリの公開の鍵で書ける（前から）。Toast での名前（別名・v1111）・Tip Rate（評価係数 coef）・
--   名前・役割・肩書き・店を変えると、勤怠とチップの配分がだれのものに・いくらになるかが変わる。書き込みを止めるのはあとの段階（(b)）。
--   いまは、変わったことに気づけて、元の値に戻せるようにする。
-- この SQL で変えること（ほかの表・関数・書き込みの決まりは変えない）：
--   1) 表 employee_field_log（サーバーだけ。公開の鍵では読めない・書けない）：いつ・だれの・どの欄が・前の値 → 後の値・どの鍵で書いたか。
--   2) 従業員の表の見張り（書いたあと）：data の欄 name・role・title・perms・store・support・coef と、toastAlias_ で始まる欄（別名）が
--      変わったときだけ 1 欄 1 行を記録する。書き込みは止めない・変えない。記録に失敗しても書き込みは通る（警告だけ）。
-- だれが変えたかまでは分からない（アプリも公開の鍵で書くため。鍵の種類と、ログインの印があればその印だけ残す）。
-- 見方：db/employee-field-log-check.sql（読むだけ）。入れ方：deploy/employee-field-log/手順.md。2 回流しても同じ。
do $$
begin
 if to_regclass('public.employees') is null then
  raise exception '社員の表（employees）がありません。止めました（何も変えていません）';
 end if;
 if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('id','data')) <> 2 then
  raise exception '社員の表（employees）に id・data の列がありません。止めました（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 1) 記録の表（サーバーだけ）
create table if not exists public.employee_field_log (
 id bigserial primary key,
 at timestamptz not null default now(),
 emp_id text not null,
 emp_name text,               -- 変えたときの名前（あとで名前が変わっても分かるように）
 field text not null,         -- name / role / title / perms / store / support / coef / toastAlias_…
 old_value jsonb,             -- 無かったときは null
 new_value jsonb,             -- 消したときは null
 op text not null check (op in ('insert','update','delete')),
 writer text not null,        -- anon（アプリの公開の鍵）/ authenticated / service_role（サーバー）/ admin（SQL Editor）
 who text                     -- ログインの印（authenticated のときの staff_id・email・sub）。公開の鍵では空
);
create index if not exists employee_field_log_emp on public.employee_field_log(emp_id, at desc);
create index if not exists employee_field_log_at on public.employee_field_log(at desc);
alter table public.employee_field_log enable row level security;
revoke all on public.employee_field_log from public, anon, authenticated;
grant select, insert on public.employee_field_log to service_role;
revoke all on sequence public.employee_field_log_id_seq from public, anon, authenticated;
grant usage on sequence public.employee_field_log_id_seq to service_role;

-- ---------------------------------------------------------------- 2) 見張り（書いたあと・止めない）
-- 記録する欄（data の中）：配分・勤怠の結び先・権限に効くもの
create or replace function public.employee_field_tracked(k text) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select k in ('name','role','title','perms','store','support','coef') or left(k, 11) = 'toastAlias_';
$$;

create or replace function public.employees_field_log() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare od jsonb := '{}'::jsonb; nd jsonb := '{}'::jsonb; eid text; nm text; w text; who text; k text; claims jsonb;
begin
 begin
  if TG_OP in ('UPDATE','DELETE') then
   eid := OLD.id::text;
   if jsonb_typeof(OLD.data) = 'object' then od := OLD.data; end if;
  end if;
  if TG_OP in ('INSERT','UPDATE') then
   eid := NEW.id::text;
   if jsonb_typeof(NEW.data) = 'object' then nd := NEW.data; end if;
  end if;
  -- どの鍵で書いたか（PostgREST は要求ごとに role を anon・authenticated・service_role にする。SQL Editor は postgres）
  w := coalesce(nullif(current_setting('role', true), ''), 'none');
  if w = 'none' then w := case when session_user in ('anon','authenticated') then session_user::text else 'admin' end; end if;
  if w not in ('anon','authenticated','service_role') then w := 'admin'; end if;
  begin
   claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then claims := null;
  end;
  who := case when w = 'authenticated' and jsonb_typeof(claims) = 'object'
   then left(coalesce(nullif(claims->>'staff_id', ''), nullif(claims->>'email', ''), nullif(claims->>'sub', '')), 120) end;
  nm := left(coalesce(nullif(nd->>'name', ''), nullif(od->>'name', '')), 120);
  for k in select x.k from (select jsonb_object_keys(od) k union select jsonb_object_keys(nd) k) x
    where public.employee_field_tracked(x.k) order by x.k loop
   if (od->k) is distinct from (nd->k) then
    insert into public.employee_field_log(emp_id, emp_name, field, old_value, new_value, op, writer, who)
    values (coalesce(eid, '?'), nm, k, od->k, nd->k, lower(TG_OP), w, who);
   end if;
  end loop;
 exception when others then
  -- 記録できなくても、従業員の書き込みは止めない
  raise warning 'employee_field_log: %', sqlerrm;
 end;
 return null;
end $$;
revoke all on function public.employees_field_log() from public, anon, authenticated;
revoke all on function public.employee_field_tracked(text) from public, anon, authenticated;
grant execute on function public.employee_field_tracked(text) to service_role;

drop trigger if exists employees_field_log_trg on public.employees;
create trigger employees_field_log_trg after insert or update or delete on public.employees
 for each row execute function public.employees_field_log();
