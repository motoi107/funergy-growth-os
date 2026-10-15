-- 従業員の退職を守る（アプリ v1085・Motoさん 10/15「退職完了にした従業員がリストに戻ってくる」）。
-- 原因：従業員の表（employees）は、アプリの端末が全員分を丸ごと書き戻す作りだった。退職の前から開いていた端末が
--   ほかの人を直すと、退職した人を「在籍」のまま書き戻していた（古い端末の書き戻し）。
-- この SQL で変えること（表の行は消さない・本人の記録は残す）：
--   1) 社員の状態（status・resignDate・osDisabled）に版 data._stV を持たせる。状態を変える書き込みは、
--      読んだときの版（送られてきた _stV）がいまの版と同じときだけ通る（通ったら版を 1 つ進める）。
--      古い写しからの書き込みは、状態だけ今のまま残す（ほかの欄はそのまま書く。前の版のアプリでも同じ）。
--      状態の書き込みはすべて記録する（employee_status_log。通した・残した・止めた）。
--   2) 退職（または「OSアカウントの無効化」）になったら、その人のアクセスを止める（戻したら元に戻す）：
--      ・ログインの PIN（auth_pins の staff）を使えない印にする（前の PIN は employee_access_hold に残す）。
--        同じ名前の在籍者がいるときは止めない（PIN が名前で決まるため。記録に残す）。
--      ・その社員に紐づく管理者のメールのアカウント（manager_auth.emp_id）を役割 'suspended' にし、
--        同じアカウントの業務Bot の利用（bot_users）も止める（前の役割・状態は employee_access_hold に残す）。
--   3) employee_access_state(社員ID, 直す)：その人が退職・停止の状態か、アクセスが止まっているかを返す
--      （アプリが「退職手続きを完了」の前に確かめる。止まっていなければ止め直せる）。
-- 前の版のアプリ（v1084 以前）の端末も、この SQL を入れたあとは古い写しで状態を戻せない（版が古いため）。
-- ただし、この SQL を入れる前から開いたままの端末は、状態を変えても通らない（版を知らない）。入れたら、みんなの端末を
-- v1085 に更新する（ログインし直す）。通らなかった書き込みは employee_status_log の kept に残る（1_確かめで見える）。
-- 入れ方：deploy/employee-resign-v1085/手順.md（先に 1_確かめ・読むだけ）。2 回流しても同じ。
do $$
begin
 if to_regclass('public.employees') is null then
  raise exception '社員の表（employees）がありません。止めました（何も変えていません）';
 end if;
 if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('id','status','data')) <> 3 then
  raise exception '社員の表（employees）に id・status・data の列がありません。止めました（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 1) 記録と、止めたときに前の値を残す表（サーバーだけ）
create table if not exists public.employee_status_log (
 id bigserial primary key,
 at timestamptz not null default now(),
 emp_id text not null,
 kind text not null,          -- accepted / kept / pin_locked / pin_unlocked / pin_shared_name / manager_suspended / manager_restored / bot_disabled / bot_enabled / apply_failed
 old_status text,
 new_status text,
 version integer,
 by_name text,
 detail jsonb
);
create index if not exists employee_status_log_emp on public.employee_status_log(emp_id, at desc);
alter table public.employee_status_log enable row level security;
revoke all on public.employee_status_log from public, anon, authenticated;
grant select, insert on public.employee_status_log to service_role;
revoke all on sequence public.employee_status_log_id_seq from public, anon, authenticated;
grant usage on sequence public.employee_status_log_id_seq to service_role;

create table if not exists public.employee_access_hold (
 kind text not null check (kind in ('pin','manager','bot')),
 key text not null,           -- pin: 名前 / manager・bot: user_id
 emp_id text not null,
 prev jsonb,                  -- pin: 前の PIN（null＝自分の PIN が無かった）/ manager: {"role":…} / bot: {"enabled":true}
 at timestamptz not null default now(),
 primary key (kind, key)
);
alter table public.employee_access_hold enable row level security;
revoke all on public.employee_access_hold from public, anon, authenticated;
grant select on public.employee_access_hold to service_role;

-- ---------------------------------------------------------------- 2) 状態の読み方
-- 状態の版（data._stV。無い・数字でないときは 0）
create or replace function public.emp_status_ver(d jsonb) returns integer
language sql immutable set search_path=public,pg_temp as $$
 select case when d is not null and jsonb_typeof(d) = 'object' and jsonb_typeof(d->'_stV') in ('number','string') and (d->>'_stV') ~ '^[0-9]{1,9}$'
  then (d->>'_stV')::integer else 0 end;
$$;
-- 状態（status・resignDate・osDisabled）を 1 つの文字にする。data に status が無ければ列の status
create or replace function public.emp_status_key(p_status text, d jsonb) returns text
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(nullif(d->>'status', ''), p_status, '') || '|' || coalesce(d->>'resignDate', '') || '|'
  || case when d->'osDisabled' = 'true'::jsonb then '1' else '0' end;
$$;
-- アクセスを止める状態か（退職、または OS アカウントの無効化）
create or replace function public.emp_blocked_of(p_status text, d jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(nullif(d->>'status', ''), p_status, '') = '退職' or coalesce(d->'osDisabled' = 'true'::jsonb, false);
$$;
-- 止めた PIN の印（数字の PIN とは一致しない）
create or replace function public.emp_pin_mark() returns text
language sql immutable set search_path=public,pg_temp as $$ select '!blocked'::text; $$;

-- ---------------------------------------------------------------- 3) 書き込みの前：古い写しで状態を戻させない
create or replace function public.employees_status_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare od jsonb; nd jsonb; ov integer; nv integer; ok text; nk text; k text;
begin
 if NEW.data is null or jsonb_typeof(NEW.data) <> 'object' then
  -- data の無い行（アプリは書かない）：退職の列だけは戻させない
  if TG_OP = 'UPDATE' and coalesce(OLD.status, '') = '退職' and NEW.status is distinct from OLD.status then NEW.status := OLD.status; end if;
  return NEW;
 end if;
 nd := NEW.data;
 if TG_OP = 'INSERT' then
  -- 版の無い行は 0（upsert の候補の行もここを通る。0 は「版を知らない」と同じ扱い）
  if not (nd ? '_stV') then nd := nd || jsonb_build_object('_stV', 0); end if;
  NEW.data := nd;
  NEW.status := coalesce(nullif(nd->>'status', ''), NEW.status);
  return NEW;
 end if;
 od := case when OLD.data is not null and jsonb_typeof(OLD.data) = 'object' then OLD.data else '{}'::jsonb end;
 ov := public.emp_status_ver(od);
 nv := public.emp_status_ver(nd);
 ok := public.emp_status_key(OLD.status, od);
 nk := public.emp_status_key(NEW.status, nd);
 if nk is distinct from ok and nv = ov then
  -- いまの版を読んで状態を変えた：通して版を進める
  nd := nd || jsonb_build_object('_stV', ov + 1, '_stAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.employee_status_log(emp_id, kind, old_status, new_status, version, by_name, detail)
  values (NEW.id::text, 'accepted', split_part(ok, '|', 1), split_part(nk, '|', 1), ov + 1, left(nd->>'_stBy', 120),
   jsonb_build_object('from', ok, 'to', nk));
  NEW.data := nd;
  NEW.status := coalesce(nullif(nd->>'status', ''), NEW.status);
  return NEW;
 end if;
 if nk is distinct from ok then
  -- 古い写し（読んだ版がいまの版と違う）：状態だけ今のまま残す
  insert into public.employee_status_log(emp_id, kind, old_status, new_status, version, by_name, detail)
  values (NEW.id::text, 'kept', split_part(ok, '|', 1), split_part(nk, '|', 1), nv, left(nd->>'_stBy', 120),
   jsonb_build_object('stored', ok, 'sent', nk, 'stored_version', ov, 'sent_version', nv));
 end if;
 foreach k in array array['status','resignDate','osDisabled','_stAt','_stBy'] loop
  if od ? k then nd := jsonb_set(nd, array[k], od->k, true); else nd := nd - k; end if;
 end loop;
 nd := nd || jsonb_build_object('_stV', ov);
 NEW.data := nd;
 NEW.status := case when od ? 'status' and nullif(od->>'status', '') is not null then od->>'status' else OLD.status end;
 return NEW;
end $$;
revoke all on function public.employees_status_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) 退職・停止に合わせてアクセスを止める／戻す
create or replace function public.employee_access_apply(p_emp text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e record; blocked boolean; nm text; shared boolean; cur jsonb; h record; m record; res jsonb := '{}'::jsonb;
begin
 if coalesce(p_emp, '') = '' then return jsonb_build_object('found', false); end if;
 select x.id::text as id, x.status, x.data into e from public.employees x where x.id::text = p_emp limit 1;
 if not found then return jsonb_build_object('found', false); end if;
 blocked := public.emp_blocked_of(e.status, e.data);
 nm := nullif(btrim(coalesce(e.data->>'name', '')), '');
 -- (1) ログインの PIN
 begin
  if to_regclass('public.auth_pins') is not null and nm is not null then
   -- 名前が変わったとき：前の名前で止めた PIN は戻す（止めるのはいまの名前）
   for h in select * from public.employee_access_hold where kind = 'pin' and emp_id = p_emp and key <> nm loop
    select a.data into cur from public.auth_pins a where a.id = 'staff' for update;
    if found and (cur->>h.key) = public.emp_pin_mark() then
     update public.auth_pins set data = case when h.prev is null or jsonb_typeof(h.prev) = 'null' then cur - h.key else jsonb_set(cur, array[h.key], h.prev, true) end where id = 'staff';
    end if;
    delete from public.employee_access_hold where kind = 'pin' and key = h.key;
    insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'pin_unlocked', jsonb_build_object('name', 'previous'));
   end loop;
   if blocked then
    select exists(select 1 from public.employees x where x.id::text <> p_emp and btrim(coalesce(x.data->>'name', '')) = nm
      and not public.emp_blocked_of(x.status, x.data)) into shared;
    if shared then
     if not exists(select 1 from public.employee_status_log l where l.emp_id = p_emp and l.kind = 'pin_shared_name' and l.at > now() - interval '1 day') then
      insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'pin_shared_name', jsonb_build_object('note', '同じ名前の在籍者がいるので PIN は止めていません'));
     end if;
     res := res || jsonb_build_object('pin', 'shared_name');
    else
     select a.data into cur from public.auth_pins a where a.id = 'staff' for update;
     if not found then
      insert into public.auth_pins(id, data) values ('staff', '{}'::jsonb);
      cur := '{}'::jsonb;
     end if;
     cur := case when cur is not null and jsonb_typeof(cur) = 'object' then cur else '{}'::jsonb end;
     if (cur->>nm) is distinct from public.emp_pin_mark() then
      insert into public.employee_access_hold(kind, key, emp_id, prev) values ('pin', nm, p_emp, cur->nm)
       on conflict (kind, key) do update set emp_id = excluded.emp_id, prev = excluded.prev, at = now();
      update public.auth_pins set data = jsonb_set(cur, array[nm], to_jsonb(public.emp_pin_mark()), true) where id = 'staff';
      insert into public.employee_status_log(emp_id, kind) values (p_emp, 'pin_locked');
     end if;
     res := res || jsonb_build_object('pin', 'locked');
    end if;
   else
    select * into h from public.employee_access_hold where kind = 'pin' and key = nm and emp_id = p_emp;
    if found then
     select a.data into cur from public.auth_pins a where a.id = 'staff' for update;
     if found and (cur->>nm) = public.emp_pin_mark() then
      update public.auth_pins set data = case when h.prev is null or jsonb_typeof(h.prev) = 'null' then cur - nm else jsonb_set(cur, array[nm], h.prev, true) end where id = 'staff';
     end if;
     delete from public.employee_access_hold where kind = 'pin' and key = nm;
     insert into public.employee_status_log(emp_id, kind) values (p_emp, 'pin_unlocked');
    end if;
    res := res || jsonb_build_object('pin', 'open');
   end if;
  else
   res := res || jsonb_build_object('pin', 'n/a');
  end if;
 exception when others then
  insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'apply_failed', jsonb_build_object('step', 'pin', 'error', left(SQLERRM, 200)));
  res := res || jsonb_build_object('pin', 'failed');
 end;
 -- (2) この社員に紐づく管理者のメールのアカウントと、同じアカウントの業務Bot
 begin
  if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
   if blocked then
    for m in select a.user_id, a.role from public.manager_auth a where a.emp_id::text = p_emp and coalesce(a.role, '') <> 'suspended' loop
     insert into public.employee_access_hold(kind, key, emp_id, prev) values ('manager', m.user_id::text, p_emp, jsonb_build_object('role', m.role))
      on conflict (kind, key) do update set emp_id = excluded.emp_id, prev = excluded.prev, at = now();
     update public.manager_auth set role = 'suspended' where user_id::text = m.user_id::text;
     insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'manager_suspended', jsonb_build_object('role', m.role));
    end loop;
    if to_regclass('public.bot_users') is not null then
     for m in select b.user_id from public.bot_users b where b.enabled and b.user_id::text in (select a.user_id::text from public.manager_auth a where a.emp_id::text = p_emp) loop
      insert into public.employee_access_hold(kind, key, emp_id, prev) values ('bot', m.user_id::text, p_emp, jsonb_build_object('enabled', true))
       on conflict (kind, key) do update set emp_id = excluded.emp_id, prev = excluded.prev, at = now();
      update public.bot_users set enabled = false where user_id::text = m.user_id::text;
      insert into public.employee_status_log(emp_id, kind) values (p_emp, 'bot_disabled');
     end loop;
    end if;
    res := res || jsonb_build_object('manager', case when exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp and coalesce(a.role, '') <> 'suspended') then 'active' else 'stopped' end);
   else
    for h in select * from public.employee_access_hold where kind = 'manager' and emp_id = p_emp loop
     update public.manager_auth set role = h.prev->>'role' where user_id::text = h.key and role = 'suspended';
     delete from public.employee_access_hold where kind = 'manager' and key = h.key;
     insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'manager_restored', jsonb_build_object('role', h.prev->>'role'));
    end loop;
    if to_regclass('public.bot_users') is not null then
     for h in select * from public.employee_access_hold where kind = 'bot' and emp_id = p_emp loop
      update public.bot_users set enabled = true where user_id::text = h.key and not enabled;
      delete from public.employee_access_hold where kind = 'bot' and key = h.key;
      insert into public.employee_status_log(emp_id, kind) values (p_emp, 'bot_enabled');
     end loop;
    end if;
    res := res || jsonb_build_object('manager', 'open');
   end if;
  else
   res := res || jsonb_build_object('manager', 'n/a');
  end if;
 exception when others then
  insert into public.employee_status_log(emp_id, kind, detail) values (p_emp, 'apply_failed', jsonb_build_object('step', 'manager', 'error', left(SQLERRM, 200)));
  res := res || jsonb_build_object('manager', 'failed');
 end;
 return res || jsonb_build_object('found', true, 'blocked', blocked);
end $$;
revoke all on function public.employee_access_apply(text) from public, anon, authenticated;
grant execute on function public.employee_access_apply(text) to service_role;

create or replace function public.employees_access_after() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare ob boolean := false; nb boolean;
begin
 nb := public.emp_blocked_of(NEW.status, NEW.data);
 if TG_OP = 'UPDATE' then ob := public.emp_blocked_of(OLD.status, OLD.data); end if;
 if nb is distinct from ob or (TG_OP = 'UPDATE' and nb and (OLD.data->>'name') is distinct from (NEW.data->>'name')) then
  perform public.employee_access_apply(NEW.id::text);
 end if;
 return null;
end $$;
revoke all on function public.employees_access_after() from public, anon, authenticated;

-- いまの行にも版 1 を付ける（この SQL を入れる前の写ししか持たない端末の書き込みは「古い写し」になる。
-- 付けないと、入れる前に退職した人を、版の無い古い写しが在籍に戻せてしまう）。状態・ほかの欄は変えない。
-- 付けるあいだは見張りを外す（2 回目に流したときは、もう版があるので何も変わらない）。
drop trigger if exists employees_status_guard_trg on public.employees;
drop trigger if exists employees_access_after_trg on public.employees;
update public.employees set data = data || jsonb_build_object('_stV', 1)
 where data is not null and jsonb_typeof(data) = 'object' and public.emp_status_ver(data) = 0;
create trigger employees_status_guard_trg before insert or update on public.employees
 for each row execute function public.employees_status_guard();
create trigger employees_access_after_trg after insert or update on public.employees
 for each row execute function public.employees_access_after();

-- ---------------------------------------------------------------- 5) アプリが確かめる（アプリの鍵で呼べる。返すのは止まっているかどうかだけ）
-- p_fix＝true：社員の表の状態に合わせてアクセスを止め直す／戻す（社員の表の状態を変えるわけではない）
create or replace function public.employee_access_state(p_emp text, p_fix boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e record; blocked boolean; nm text; pin text := 'n/a'; mgr text := 'n/a'; cur jsonb; ap jsonb;
begin
 if coalesce(p_emp, '') = '' or length(p_emp) > 80 then return jsonb_build_object('found', false); end if;
 if p_fix then ap := public.employee_access_apply(p_emp); end if;
 select x.id::text as id, x.status, x.data into e from public.employees x where x.id::text = p_emp limit 1;
 if not found then return jsonb_build_object('found', false); end if;
 blocked := public.emp_blocked_of(e.status, e.data);
 nm := nullif(btrim(coalesce(e.data->>'name', '')), '');
 if to_regclass('public.auth_pins') is not null and nm is not null then
  select a.data into cur from public.auth_pins a where a.id = 'staff';
  if blocked then
   pin := case when (cur->>nm) = public.emp_pin_mark() then 'locked'
    when exists(select 1 from public.employees x where x.id::text <> p_emp and btrim(coalesce(x.data->>'name', '')) = nm and not public.emp_blocked_of(x.status, x.data)) then 'shared_name'
    else 'open' end;
  else
   pin := case when (cur->>nm) = public.emp_pin_mark() then 'locked' else 'open' end;
  end if;
 end if;
 if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
  mgr := case when not exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp) then 'none'
   when exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp and coalesce(a.role, '') <> 'suspended') then 'active' else 'stopped' end;
 end if;
 return jsonb_build_object('found', true, 'status', coalesce(nullif(e.data->>'status', ''), e.status), 'blocked', blocked,
  'version', public.emp_status_ver(e.data), 'pin', pin, 'manager', mgr,
  'stopped', blocked and pin in ('locked','shared_name','n/a') and mgr in ('none','stopped','n/a'),
  'fixed', ap is not null);
end $$;
revoke all on function public.employee_access_state(text, boolean) from public;
grant execute on function public.employee_access_state(text, boolean) to anon, authenticated, service_role;

revoke all on function public.emp_status_ver(jsonb) from public, anon, authenticated;
revoke all on function public.emp_status_key(text, jsonb) from public, anon, authenticated;
revoke all on function public.emp_blocked_of(text, jsonb) from public, anon, authenticated;
revoke all on function public.emp_pin_mark() from public, anon, authenticated;
grant execute on function public.emp_status_ver(jsonb), public.emp_status_key(text, jsonb), public.emp_blocked_of(text, jsonb), public.emp_pin_mark() to service_role;
