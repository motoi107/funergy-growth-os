-- 従業員の変更記録（Moto さん 10/29・PR #99 の Codex の P1 の扱い「(c) で受け入れ・変更記録を足す・あとで (b)」）。
-- なぜ：従業員の表（employees）はアプリの公開の鍵で書ける（前から）。Toast での名前（別名・v1111）・Tip Rate（評価係数 coef）・
--   名前・役割・肩書き・店を変えると、勤怠とチップの配分がだれのものに・いくらになるかが変わる。書き込みを止めるのはあとの段階（(b)）。
--   いまは、変わったことに気づけて、元の値に戻せるようにする。
-- この SQL で変えること（ほかの表・関数・書き込みの決まりは変えない）：
--   1) 表 employee_field_log（サーバーだけ。公開の鍵では読めない・書けない）：いつ・だれの・どの欄が・前の値 → 後の値・どの鍵で書いたか。
--   2) 従業員の表の見張り（書いたあと）：data の欄 id・name・role・title・perms・store・support・status・emp・empCode・coef と、
--      toastAlias_ で始まる欄（別名）が変わったときだけ 1 欄 1 行を記録する。
--      表の列（id・name・emp_code・role・perms・title・store・support・status・emp_type）も見る（Codex PR #101 P1：公開の鍵で列だけを
--      書き換えると data は変わらない。サーバーの SQL には列を読むものがある）。列の変化は、同じ書き込みで data の対応する欄が
--      同じ値に変わったときは data の 1 行だけ（アプリのふだんの保存）。そうでなければ列の行を別に残す（field は col:列名・
--      note は column_only＝data はそのまま／differs_from_data＝data は別の値に変わった）。
--      書き込みは止めない・変えない。記録に失敗しても書き込みは通る（警告だけ）。
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
 field text not null,         -- data の欄（name / role / … / coef / toastAlias_…）か、表の列（col:name / col:role / …）
 old_value jsonb,             -- 無かったときは null
 new_value jsonb,             -- 消したときは null
 op text not null check (op in ('insert','update','delete')),
 writer text not null,        -- anon（アプリの公開の鍵）/ authenticated / service_role（サーバー）/ admin（SQL Editor）
 who text,                    -- ログインの印（authenticated のときの staff_id・email・sub）。公開の鍵では空
 note text                    -- 列の行だけ：column_only（data はそのまま）／differs_from_data（data は別の値に）
);
alter table public.employee_field_log add column if not exists note text;
create index if not exists employee_field_log_emp on public.employee_field_log(emp_id, at desc);
create index if not exists employee_field_log_at on public.employee_field_log(at desc);
alter table public.employee_field_log enable row level security;
revoke all on public.employee_field_log from public, anon, authenticated;
grant select, insert on public.employee_field_log to service_role;
revoke all on sequence public.employee_field_log_id_seq from public, anon, authenticated;
grant usage on sequence public.employee_field_log_id_seq to service_role;

-- ---------------------------------------------------------------- 2) 見張り（書いたあと・止めない）
-- 記録する欄（data の中）：だれの行か・配分・勤怠の結び先・権限・在籍に効くもの
create or replace function public.employee_field_tracked(k text) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select k in ('id','name','role','title','perms','store','support','status','emp','empCode','coef') or left(k, 11) = 'toastAlias_';
$$;
-- 記録する表の列と、アプリが同じ値を入れる data の欄（SUPA_MASTER_MAP.m_employees）。email・phone は値を残さない（アプリはいつも空）
create or replace function public.employee_field_columns() returns table(col text, k text)
language sql immutable set search_path=public,pg_temp as $$
 values ('id','id'), ('name','name'), ('emp_code','empCode'), ('role','role'), ('perms','perms'), ('title','title'), ('store','store'),
  ('support','support'), ('status','status'), ('emp_type','emp');
$$;
-- 列と data の値を同じとみなす（無い・null・空の文字・空の配列は同じ）
create or replace function public.employee_field_norm(v jsonb) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select case when v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then null else v end;
$$;

create or replace function public.employees_field_log() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare od jsonb := '{}'::jsonb; nd jsonb := '{}'::jsonb; oc jsonb := '{}'::jsonb; nc jsonb := '{}'::jsonb;
 eid text; nm text; w text; who text; k text; c record; claims jsonb;
begin
 begin
  if TG_OP in ('UPDATE','DELETE') then
   eid := OLD.id::text;
   if jsonb_typeof(OLD.data) = 'object' then od := OLD.data; end if;
   oc := to_jsonb(OLD) - 'data';
  end if;
  if TG_OP in ('INSERT','UPDATE') then
   eid := NEW.id::text;
   if jsonb_typeof(NEW.data) = 'object' then nd := NEW.data; end if;
   nc := to_jsonb(NEW) - 'data';
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
  nm := left(coalesce(nullif(nd->>'name', ''), nullif(nc->>'name', ''), nullif(od->>'name', ''), nullif(oc->>'name', '')), 120);
  -- data の欄
  for k in select x.k from (select jsonb_object_keys(od) k union select jsonb_object_keys(nd) k) x
    where public.employee_field_tracked(x.k) order by x.k loop
   if (od->k) is distinct from (nd->k) then
    insert into public.employee_field_log(emp_id, emp_name, field, old_value, new_value, op, writer, who)
    values (coalesce(eid, '?'), nm, k, od->k, nd->k, lower(TG_OP), w, who);
   end if;
  end loop;
  -- 表の列（data の対応する欄が同じ値に変わったときは、上の 1 行で足りる）
  for c in select f.col, f.k from public.employee_field_columns() f order by f.col loop
   if public.employee_field_norm(oc->c.col) is distinct from public.employee_field_norm(nc->c.col)
     and not ((od->c.k) is distinct from (nd->c.k)
       and public.employee_field_norm(nd->c.k) is not distinct from public.employee_field_norm(nc->c.col)) then
    insert into public.employee_field_log(emp_id, emp_name, field, old_value, new_value, op, writer, who, note)
    values (coalesce(eid, '?'), nm, 'col:' || c.col, oc->c.col, nc->c.col, lower(TG_OP), w, who,
     case when (od->c.k) is distinct from (nd->c.k) then 'differs_from_data' else 'column_only' end);
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
revoke all on function public.employee_field_columns() from public, anon, authenticated;
grant execute on function public.employee_field_columns() to service_role;
revoke all on function public.employee_field_norm(jsonb) from public, anon, authenticated;
grant execute on function public.employee_field_norm(jsonb) to service_role;

drop trigger if exists employees_field_log_trg on public.employees;
create trigger employees_field_log_trg after insert or update or delete on public.employees
 for each row execute function public.employees_field_log();
