-- 従業員の退職を守る（アプリ v1085・Motoさん 10/15「退職完了にした従業員がリストに戻ってくる」）。
-- 原因：従業員の表（employees）は、アプリの端末が全員分を丸ごと書き戻す作りだった。退職の前から開いていた端末が
--   ほかの人を直すと、退職した人を「在籍」のまま書き戻していた（古い端末の書き戻し）。
-- この SQL で変えること（表の行は消さない・本人の記録は残す）：
--   1) 社員の状態（status・resignDate・osDisabled）に版 data._stV を持たせる。状態を変える書き込みは、
--      読んだときの版（送られてきた _stV）がいまの版と同じときだけ通る（通ったら版を 1 つ進める）。
--      古い写しからの書き込みは、状態だけ今のまま残す（ほかの欄はそのまま書く。前の版のアプリでも同じ）。
--   2) 退職（または OS アカウントの無効化）から在籍に戻すのは、employee_restore（auth-pin の「在籍に戻す」が service_role で呼ぶ）と
--      データベースの管理者（SQL Editor）だけ。アプリの公開の鍵（anon）でも、ほかの service_role の書き込みでも戻せない
--      （版が合っていても止める）。公開の鍵では社員の行を消せない・data を壊せない・消えた退職者の ID を在籍で入れ直せない。
--      退職にするほう（止めるほう）は今までどおりアプリから。状態の書き込みはすべて記録する（employee_status_log）。
--   3) 退職・OS 無効になったら、その人のアクセスを止める（在籍に戻したら元に戻す）：
--      ・ログインの PIN（auth_pins の staff）を使えない印にする（前の PIN は employee_access_hold に残す）。
--        同じ名前の在籍者がいるときは止めない（PIN が名前で決まるため。記録に残す）。
--      ・その社員に紐づく管理者のメールのアカウント（manager_auth.emp_id）を役割 'suspended' にし、
--        同じアカウントの業務Bot の利用（bot_users）も止める（前の役割・状態は employee_access_hold に残す）。
--   4) employee_access_state(社員ID, 直す)：退職・停止の人のアクセスが止まっているかを返す（アプリが完了の前に確かめる）。
--      employee_restore(社員ID, 人)：在籍に戻す（service_role・管理者だけ。GM・CEO の人は GM・CEO だけ）。auth_pin_put：PIN を 1 人分だけ書く（auth-pin 用）。
--   5) 退職記録（app_state の offboardings）の「完了」「取消」を古い写しで戻させない（前の版のアプリにも効く）。
-- 前の版のアプリ（v1084 以前）の端末も、この SQL を入れたあとは古い写しで状態を戻せない（版が古いため）。
-- ただし、この SQL を入れる前から開いたままの端末は、状態を変えても通らない（版を知らない）。入れたら、みんなの端末を
-- v1085 に更新する（ログインし直す）。通らなかった書き込みは employee_status_log の kept・refused に残る（1_確かめで見える）。
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
 kind text not null,          -- accepted / kept / refused / restored / pin_locked / pin_unlocked / pin_shared_name / manager_suspended / manager_restored / bot_disabled / bot_enabled / apply_failed / offboard_kept
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

-- ---------------------------------------------------------------- 2) 状態の読み方（計算だけの関数）
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
-- 書いているのがサーバー（service_role）かデータベースの管理者（SQL Editor）か。アプリの公開の鍵（anon・authenticated）なら false。
-- PostgREST は要求ごとに role を anon・authenticated・service_role にする（SECURITY DEFINER の中でも変わらない）
create or replace function public.emp_privileged() returns boolean
language sql stable set search_path=public,pg_temp as $$
 select coalesce(nullif(current_setting('role', true), ''), 'none') in ('service_role','postgres','supabase_admin')
  or (coalesce(nullif(current_setting('role', true), ''), 'none') = 'none' and session_user not in ('authenticator','anon','authenticated'));
$$;
-- 在籍に戻してよい書き込みか：データベースの管理者（SQL Editor）か、employee_restore の中（取引の中だけの印 funergy.emp_restore）。
-- ほかの service_role の書き込み（ほかの関数が端末から来た行をそのまま書く場合など）では戻さない
create or replace function public.emp_reinstate_ok() returns boolean
language sql stable set search_path=public,pg_temp as $$
 select public.emp_privileged() and (coalesce(nullif(current_setting('role', true), ''), 'none') <> 'service_role'
  or coalesce(current_setting('funergy.emp_restore', true), '') = 'on');
$$;
-- 記録（同じ人の同じ「残した・止めた」は 1 時間に 1 回だけ。前の版の端末は保存のたびに全員分を送るため）
create or replace function public.employee_status_note(p_emp text, p_kind text, p_old text, p_new text, p_ver integer, p_by text, p_detail jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_kind in ('kept','refused','offboard_kept') and exists(select 1 from public.employee_status_log l where l.emp_id = p_emp and l.kind = p_kind
   and l.old_status is not distinct from p_old and l.new_status is not distinct from p_new and l.at > now() - interval '1 hour') then
  return;
 end if;
 insert into public.employee_status_log(emp_id, kind, old_status, new_status, version, by_name, detail)
 values (p_emp, p_kind, p_old, p_new, p_ver, left(p_by, 120), p_detail);
end $$;

-- ---------------------------------------------------------------- 3) 書き込みの前：古い写しで状態を戻させない・公開の鍵で在籍に戻させない
create or replace function public.employees_status_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare od jsonb; nd jsonb; ov integer; nv integer; ok text; nk text; k text; rpriv boolean; reinstate boolean;
begin
 rpriv := public.emp_reinstate_ok();
 -- 退職・停止のまま消えた社員の ID（止めた PIN・アカウントの記録が残っている）を、在籍として新しく入れさせない
 -- （入れると止めたアクセスが戻る）。行があるとき（upsert の更新）は下の UPDATE で見る
 if TG_OP = 'INSERT' and not rpriv
    and not public.emp_blocked_of(NEW.status, case when jsonb_typeof(NEW.data) = 'object' then NEW.data else '{}'::jsonb end)
    and exists(select 1 from public.employee_access_hold h where h.emp_id = NEW.id::text)
    and not exists(select 1 from public.employees x where x.id::text = NEW.id::text) then
  perform public.employee_status_note(NEW.id::text, 'refused', '退職', coalesce(NEW.data->>'status', NEW.status), null, NEW.data->>'_stBy', jsonb_build_object('reason', 'insert_after_delete'));
  return null;
 end if;
 if NEW.data is null or jsonb_typeof(NEW.data) <> 'object' then
  -- data が無い・オブジェクトでない書き込み（アプリは書かない）：前の data と状態をそのまま残す（OS 無効などの印を消させない）
  if TG_OP = 'UPDATE' and not rpriv and OLD.data is not null and jsonb_typeof(OLD.data) = 'object' then
   perform public.employee_status_note(NEW.id::text, 'refused', coalesce(nullif(OLD.data->>'status', ''), OLD.status), null, null, null, jsonb_build_object('reason', 'data_not_object'));
   NEW.data := OLD.data; NEW.status := OLD.status;
   return NEW;
  end if;
  -- data の無い行：退職の列だけは公開の鍵で戻させない
  if TG_OP = 'UPDATE' and not rpriv and coalesce(OLD.status, '') = '退職' and NEW.status is distinct from OLD.status then NEW.status := OLD.status; end if;
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
 -- 列の status だけを変えた書き込み（data の status は前のまま）：列の値を新しい状態として扱う（版は同じ）
 if NEW.status is distinct from OLD.status and (nd->>'status') is not distinct from (od->>'status') and nullif(NEW.status, '') is not null then
  nd := nd || jsonb_build_object('status', NEW.status);
 end if;
 ov := public.emp_status_ver(od);
 nv := public.emp_status_ver(nd);
 ok := public.emp_status_key(OLD.status, od);
 nk := public.emp_status_key(NEW.status, nd);
 -- 在籍に戻す＝止めた状態から外れる、または退職から外れる（OS 無効のまま状態だけ在籍にするのも同じ。一覧に戻るため）
 reinstate := (public.emp_blocked_of(OLD.status, od) and not public.emp_blocked_of(NEW.status, nd))
  or (coalesce(nullif(od->>'status', ''), OLD.status, '') = '退職' and coalesce(nullif(nd->>'status', ''), NEW.status, '') <> '退職');
 if nk is distinct from ok and nv = ov and (rpriv or not reinstate) then
  -- いまの版を読んで状態を変えた：通して版を進める
  nd := nd || jsonb_build_object('_stV', ov + 1, '_stAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  perform public.employee_status_note(NEW.id::text, case when reinstate then 'restored' else 'accepted' end, split_part(ok, '|', 1), split_part(nk, '|', 1), ov + 1,
   nd->>'_stBy', jsonb_build_object('from', ok, 'to', nk));
  if not rpriv then
   foreach k in array array['_restoreAt','_restoreBy'] loop
    if od ? k then nd := jsonb_set(nd, array[k], od->k, true); else nd := nd - k; end if;
   end loop;
  end if;
  NEW.data := nd;
  NEW.status := coalesce(nullif(nd->>'status', ''), NEW.status);
  return NEW;
 end if;
 if nk is distinct from ok then
  -- 古い写し（読んだ版がいまの版と違う）、または公開の鍵で在籍に戻そうとした：状態だけ今のまま残す
  perform public.employee_status_note(NEW.id::text, case when nv = ov then 'refused' else 'kept' end, split_part(ok, '|', 1), split_part(nk, '|', 1), nv,
   nd->>'_stBy', jsonb_build_object('stored', ok, 'sent', nk, 'stored_version', ov, 'sent_version', nv));
 end if;
 foreach k in array array['status','resignDate','osDisabled','_stAt','_stBy'] loop
  if od ? k then nd := jsonb_set(nd, array[k], od->k, true); else nd := nd - k; end if;
 end loop;
 if not rpriv then
  foreach k in array array['_restoreAt','_restoreBy'] loop
   if od ? k then nd := jsonb_set(nd, array[k], od->k, true); else nd := nd - k; end if;
  end loop;
 end if;
 nd := nd || jsonb_build_object('_stV', ov);
 NEW.data := nd;
 NEW.status := case when od ? 'status' and nullif(od->>'status', '') is not null then od->>'status' else OLD.status end;
 return NEW;
end $$;
revoke all on function public.employees_status_guard() from public, anon, authenticated;
-- 社員の行は消させない（アプリは消さない。消して在籍で入れ直すと、止めたアクセスが戻る）。サーバー・管理者は消せる
create or replace function public.employees_delete_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.emp_privileged() then return OLD; end if;
 perform public.employee_status_note(OLD.id::text, 'refused', coalesce(OLD.data->>'status', OLD.status), null, null, null, jsonb_build_object('reason', 'delete'));
 return null;
end $$;
revoke all on function public.employees_delete_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) PIN（名前ごと）：その名前の人が退職・停止だけなら止める。在籍の人がいれば止めない
create or replace function public.employee_pin_reconcile(p_name text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare nm text := case when btrim(coalesce(p_name, '')) = '' then null else p_name end; v_blocked text; v_active boolean; cur jsonb; h record;
begin
 if nm is null or to_regclass('public.auth_pins') is null then return 'n/a'; end if;
 select min(x.id::text) into v_blocked from public.employees x where coalesce(x.data->>'name', '') = nm and public.emp_blocked_of(x.status, x.data);
 select exists(select 1 from public.employees x where coalesce(x.data->>'name', '') = nm and not public.emp_blocked_of(x.status, x.data)) into v_active;
 select a.data into cur from public.auth_pins a where a.id = 'staff' for update;
 if not found then
  if v_blocked is null or v_active then return 'open'; end if;
  insert into public.auth_pins(id, data) values ('staff', '{}'::jsonb);
  cur := '{}'::jsonb;
 end if;
 cur := case when cur is not null and jsonb_typeof(cur) = 'object' then cur else '{}'::jsonb end;
 if v_blocked is not null and not v_active then
  if (cur->>nm) is distinct from public.emp_pin_mark() then
   insert into public.employee_access_hold(kind, key, emp_id, prev) values ('pin', nm, v_blocked, cur->nm) on conflict (kind, key) do nothing;
   update public.auth_pins set data = jsonb_set(cur, array[nm], to_jsonb(public.emp_pin_mark()), true) where id = 'staff';
   insert into public.employee_status_log(emp_id, kind, detail) values (v_blocked, 'pin_locked', jsonb_build_object('name', nm));
  end if;
  return 'locked';
 end if;
 if (cur->>nm) = public.emp_pin_mark() then
  -- 止めた本人が在籍に戻ったなら前の PIN に、別の人（同じ名前の新しい人）なら初期の PIN に（前の人の PIN を渡さない）
  select * into h from public.employee_access_hold where kind = 'pin' and key = nm;
  update public.auth_pins set data = case
    when h.emp_id is not null and h.prev is not null and jsonb_typeof(h.prev) <> 'null'
     and exists(select 1 from public.employees x where x.id::text = h.emp_id and not public.emp_blocked_of(x.status, x.data)) then jsonb_set(cur, array[nm], h.prev, true)
    else cur - nm end
   where id = 'staff';
  delete from public.employee_access_hold where kind = 'pin' and key = nm;
  insert into public.employee_status_log(emp_id, kind, detail) values (coalesce(h.emp_id, ''), 'pin_unlocked', jsonb_build_object('name', nm));
 else
  delete from public.employee_access_hold where kind = 'pin' and key = nm;
 end if;
 if v_blocked is not null and v_active then
  if not exists(select 1 from public.employee_status_log l where l.emp_id = v_blocked and l.kind = 'pin_shared_name' and l.at > now() - interval '1 day') then
   insert into public.employee_status_log(emp_id, kind, detail) values (v_blocked, 'pin_shared_name', jsonb_build_object('note', '同じ名前の在籍者がいるので PIN は止めていません'));
  end if;
  return 'shared_name';
 end if;
 return 'open';
end $$;
revoke all on function public.employee_pin_reconcile(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5) 退職・停止に合わせてアクセスを止める／戻す
create or replace function public.employee_access_apply(p_emp text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e record; blocked boolean; nm text; h record; m record; res jsonb := '{}'::jsonb; pin text;
begin
 if coalesce(p_emp, '') = '' then return jsonb_build_object('found', false); end if;
 select x.id::text as id, x.status, x.data into e from public.employees x where x.id::text = p_emp limit 1;
 if not found then return jsonb_build_object('found', false); end if;
 blocked := public.emp_blocked_of(e.status, e.data);
 nm := case when btrim(coalesce(e.data->>'name', '')) = '' then null else e.data->>'name' end;   -- PIN の表と同じ（名前そのまま）
 -- (1) ログインの PIN：いまの名前と、名前が変わる前に止めた名前
 begin
  for h in select * from public.employee_access_hold where kind = 'pin' and emp_id = p_emp and key is distinct from nm loop
   perform public.employee_pin_reconcile(h.key);
  end loop;
  pin := public.employee_pin_reconcile(nm);
  res := res || jsonb_build_object('pin', pin);
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
 -- 新しく足した人も見る（同じ名前の退職者の PIN を止めていたら、新しい人には初期の PIN にする）
 if nb is distinct from ob or TG_OP = 'INSERT'
    or (TG_OP = 'UPDATE' and coalesce(OLD.data->>'name', '') is distinct from coalesce(NEW.data->>'name', '')) then
  perform public.employee_access_apply(NEW.id::text);
  -- 名前が変わったとき：前の名前の人たち（同じ名前の在籍者）の PIN の扱いも見直す
  if TG_OP = 'UPDATE' and coalesce(OLD.data->>'name', '') is distinct from coalesce(NEW.data->>'name', '') then
   perform public.employee_pin_reconcile(OLD.data->>'name');
  end if;
 end if;
 return null;
end $$;
revoke all on function public.employees_access_after() from public, anon, authenticated;

-- いまの行にも版 1 を付ける（この SQL を入れる前の写ししか持たない端末の書き込みは「古い写し」になる。
-- 付けないと、入れる前に退職した人を、版の無い古い写しが在籍に戻せてしまう）。状態・ほかの欄は変えない。
-- 付けるあいだは見張りを外す。2 回目に流したときは、版の無い行だけ（入れたあとに足された行は版 0 のまま）。
drop trigger if exists employees_status_guard_trg on public.employees;
drop trigger if exists employees_access_after_trg on public.employees;
drop trigger if exists employees_delete_guard_trg on public.employees;
update public.employees set data = data || jsonb_build_object('_stV', 1)
 where data is not null and jsonb_typeof(data) = 'object' and not (data ? '_stV');
create trigger employees_status_guard_trg before insert or update on public.employees
 for each row execute function public.employees_status_guard();
create trigger employees_access_after_trg after insert or update on public.employees
 for each row execute function public.employees_access_after();
create trigger employees_delete_guard_trg before delete on public.employees
 for each row execute function public.employees_delete_guard();

-- ---------------------------------------------------------------- 6) 在籍に戻す（サーバー・管理者だけ）
-- auth-pin（v1085）が、メールで認証した CEO・GM・AM・経理かを確かめてから、その人の役割（p_caller_role）を付けて service_role で呼ぶ。
-- GM・CEO の人（社員の役割・止めた管理者のアカウントの役割・紐づく管理者のアカウントの役割のどれかが gm か ceo）を戻せるのは、
-- 役割が GM・CEO の人だけ（Motoさん 10/15）。役割を付けない service_role の呼び出しは戻さない。SQL Editor からも使える（役割は見ない）：
--   select public.employee_restore('<社員ID>', '<戻した人の名前>');
-- その人の退職記録（app_state の offboardings）も「取消」にする（p_keep_offboard＝true のときはしない：承認の取り消し。
-- そのときは「在籍に戻した」印 _restoreAt も付けない＝あとで記録が完了なら、修復の一覧に出る）。
drop function if exists public.employee_restore(text, text);
drop function if exists public.employee_restore(text, text, boolean);
create or replace function public.employee_restore(p_emp text, p_by text, p_keep_offboard boolean default false, p_caller_role text default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d jsonb; v_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); v_by text := left(coalesce(p_by, ''), 120);
 v_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint; v_upd boolean; v_done boolean;
 v_caller text := lower(btrim(coalesce(p_caller_role, ''))); v_high boolean := false;
begin
 if coalesce(p_emp, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
 if not public.emp_privileged() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
 if coalesce(nullif(current_setting('role', true), ''), 'none') = 'service_role' then   -- サーバー（auth-pin）：戻す人の役割で決める
  if v_caller not in ('ceo','gm','am','office') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_caller not in ('ceo','gm') then
   v_high := exists(select 1 from public.employees x where x.id::text = p_emp and lower(btrim(coalesce(x.data->>'role', ''))) in ('gm','ceo'))
    or exists(select 1 from public.employee_access_hold h where h.kind = 'manager' and h.emp_id = p_emp and lower(btrim(coalesce(h.prev->>'role', ''))) in ('gm','ceo'));
   if not v_high and to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
    v_high := exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp and lower(btrim(coalesce(a.role, ''))) in ('gm','ceo'));
   end if;
   if v_high then return jsonb_build_object('ok', false, 'error', 'forbidden_rank'); end if;
  end if;
 end if;
 perform set_config('funergy.emp_restore', 'on', true);          -- この取引の中だけ：在籍に戻す書き込みとして通す
 update public.employees x set status = '在籍', data = x.data || jsonb_build_object('status', '在籍', 'resignDate', '', 'osDisabled', false, '_stBy', v_by)
   || case when coalesce(p_keep_offboard, false) then '{}'::jsonb else jsonb_build_object('_restoreAt', v_at, '_restoreBy', v_by) end
  where x.id::text = p_emp and public.emp_blocked_of(x.status, x.data)
  returning x.data into d;
 v_done := found;
 perform set_config('funergy.emp_restore', 'off', true);
 if d is null then
  select x.data into d from public.employees x where x.id::text = p_emp;
  if d is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
 end if;
 if not coalesce(p_keep_offboard, false) and to_regclass('public.app_state') is not null then
  perform set_config('funergy.emp_restore', 'on', true);         -- 完了の記録も取消にできる（見張り 8 が見る）
  v_upd := exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name = 'updated_at');
  if v_upd then
   update public.app_state s set updated_at = now(), value = (
     select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' and x->>'empId' = p_emp and coalesce(x->>'status', '') <> '取消'
        and not coalesce(x->'_deleted' = 'true'::jsonb, false)
       then x || jsonb_build_object('status', '取消', '_stAt', v_at, '_stBy', v_by, '_mut', v_ms) else x end order by o), '[]'::jsonb)
     from jsonb_array_elements(s.value) with ordinality as e(x, o))
    where (s.key = 'offboardings' or s.key like 'spl\_offboardings\_%') and jsonb_typeof(s.value) = 'array'
     and exists(select 1 from jsonb_array_elements(s.value) x where jsonb_typeof(x) = 'object' and x->>'empId' = p_emp and coalesce(x->>'status', '') <> '取消');
  else
   update public.app_state s set value = (
     select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object' and x->>'empId' = p_emp and coalesce(x->>'status', '') <> '取消'
        and not coalesce(x->'_deleted' = 'true'::jsonb, false)
       then x || jsonb_build_object('status', '取消', '_stAt', v_at, '_stBy', v_by, '_mut', v_ms) else x end order by o), '[]'::jsonb)
     from jsonb_array_elements(s.value) with ordinality as e(x, o))
    where (s.key = 'offboardings' or s.key like 'spl\_offboardings\_%') and jsonb_typeof(s.value) = 'array'
     and exists(select 1 from jsonb_array_elements(s.value) x where jsonb_typeof(x) = 'object' and x->>'empId' = p_emp and coalesce(x->>'status', '') <> '取消');
  end if;
  perform set_config('funergy.emp_restore', 'off', true);
 end if;
 return jsonb_build_object('ok', true, 'already', not v_done, 'data', d, 'state', public.employee_access_state(p_emp, false));
end $$;

-- PIN を 1 人分だけ書く（auth-pin v1085 の本人の変更・GM・CEO のリセット）。PIN の表を丸ごと書き戻さないので、
-- 同時に止めた PIN を消さない。止めた PIN（退職・停止）は書き換えない → 'blocked'
create or replace function public.auth_pin_put(p_scope text, p_key text, p_pin text) returns text
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cur jsonb;
begin
 if p_scope not in ('staff','store') or coalesce(p_key, '') = '' or length(p_key) > 120 or coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then return 'invalid'; end if;
 select a.data into cur from public.auth_pins a where a.id = p_scope for update;
 if not found then insert into public.auth_pins(id, data) values (p_scope, '{}'::jsonb); cur := '{}'::jsonb; end if;
 if p_scope = 'staff' and (cur->>p_key) = public.emp_pin_mark() then return 'blocked'; end if;
 update public.auth_pins set data = jsonb_set(case when cur is not null and jsonb_typeof(cur) = 'object' then cur else '{}'::jsonb end, array[p_key], to_jsonb(p_pin), true)
  where id = p_scope;
 return 'ok';
end $$;

-- ---------------------------------------------------------------- 7) アプリが確かめる（アプリの鍵で呼べる。返すのは退職・停止の人のアクセスが止まっているかだけ）
-- p_fix＝true：退職・停止なのに止まっていない（または在籍なのに止まったまま）のときだけ、社員の表の状態に合わせて直す
create or replace function public.employee_access_state(p_emp text, p_fix boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e record; blocked boolean; nm text; pin text := 'n/a'; mgr text := 'n/a'; cur jsonb; fixed boolean := false; i integer;
begin
 if coalesce(p_emp, '') = '' or length(p_emp) > 80 then return jsonb_build_object('found', false); end if;
 for i in 1..2 loop
  select x.id::text as id, x.status, x.data into e from public.employees x where x.id::text = p_emp limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  blocked := public.emp_blocked_of(e.status, e.data);
  nm := case when btrim(coalesce(e.data->>'name', '')) = '' then null else e.data->>'name' end;
  pin := 'n/a'; mgr := 'n/a';
  if to_regclass('public.auth_pins') is not null and nm is not null then
   select a.data into cur from public.auth_pins a where a.id = 'staff';
   pin := case when (cur->>nm) = public.emp_pin_mark() then 'locked'
    when exists(select 1 from public.employees x where x.id::text <> p_emp and coalesce(x.data->>'name', '') = nm and not public.emp_blocked_of(x.status, x.data)) then 'shared_name'
    else 'open' end;
  end if;
  if to_regclass('public.manager_auth') is not null and exists(select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'manager_auth' and column_name = 'emp_id') then
   mgr := case when exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp and coalesce(a.role, '') <> 'suspended') then 'active'
    when exists(select 1 from public.manager_auth a where a.emp_id::text = p_emp) then 'stopped' else 'none' end;
  end if;
  exit when not p_fix or fixed;
  exit when (blocked and pin in ('locked','shared_name','n/a') and mgr in ('none','stopped','n/a'))
    or (not blocked and pin <> 'locked' and mgr <> 'stopped' and not exists(select 1 from public.employee_access_hold h where h.emp_id = p_emp));
  perform public.employee_access_apply(p_emp);
  fixed := true;
 end loop;
 return jsonb_build_object('found', true, 'status', coalesce(nullif(e.data->>'status', ''), e.status), 'blocked', blocked,
  'version', public.emp_status_ver(e.data),
  'pin', case when blocked then pin else case when pin = 'locked' then 'locked' else 'open' end end,
  'manager', case when blocked then mgr when mgr = 'stopped' then 'stopped' else 'n/a' end,
  'stopped', blocked and pin in ('locked','shared_name','n/a') and mgr in ('none','stopped','n/a'),
  'fixed', fixed);
end $$;

-- ---------------------------------------------------------------- 8) 退職記録（app_state の offboardings）：完了・取消を古い写しで戻させない
-- 完了を取消にできるのは「在籍に戻す」（employee_restore）と管理者だけ（前の版のアプリの「在籍に戻す」は社員を戻せないので、記録も変えない）
create or replace function public.offboard_record_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare o jsonb; n jsonb; out jsonb := '[]'::jsonb; seen text[] := array[]::text[]; f text; keep boolean; v_new text;
begin
 if OLD.value is null or jsonb_typeof(OLD.value) <> 'array' or NEW.value is null or jsonb_typeof(NEW.value) <> 'array' then return NEW; end if;
 for n in select * from jsonb_array_elements(NEW.value) loop
  o := null;
  if jsonb_typeof(n) = 'object' and (n->>'id') is not null then
   select x into o from jsonb_array_elements(OLD.value) x where jsonb_typeof(x) = 'object' and x->>'id' = n->>'id' limit 1;
   seen := seen || (n->>'id');
  end if;
  keep := o is not null and not coalesce(n->'_deleted' = 'true'::jsonb, false) and (
    (o->>'status' = '完了' and coalesce(n->>'status', '') <> '完了' and not (n->>'status' = '取消' and public.emp_reinstate_ok()))
    or (o->>'status' = '取消' and coalesce(n->>'status', '') <> '取消'));
  if keep then
   v_new := n->>'status';
   foreach f in array array['status','completedBy','completedAt','approvedBy','approvedAt','approvalId','_stAt','_stBy','_gen'] loop
    if o ? f then n := jsonb_set(n, array[f], o->f, true); else n := n - f; end if;
   end loop;
   perform public.employee_status_note(coalesce(n->>'empId', ''), 'offboard_kept', o->>'status', v_new, null, null, jsonb_build_object('record', n->>'id', 'key', NEW.key));
  end if;
  out := out || jsonb_build_array(n);
 end loop;
 -- 古い写しに無い記録（完了・取消）は落とさない（記録は消さない。消すときは _deleted の印）
 for o in select * from jsonb_array_elements(OLD.value) loop
  if jsonb_typeof(o) = 'object' and (o->>'id') is not null and not ((o->>'id') = any(seen)) and o->>'status' in ('完了','取消') then
   out := out || jsonb_build_array(o);
  end if;
 end loop;
 NEW.value := out;
 return NEW;
end $$;
revoke all on function public.offboard_record_guard() from public, anon, authenticated;
do $$
begin
 if to_regclass('public.app_state') is not null and exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_state' and column_name = 'value' and data_type = 'jsonb') then
  execute 'drop trigger if exists offboard_record_guard_trg on public.app_state';
  execute $t$create trigger offboard_record_guard_trg before update on public.app_state for each row
   when (NEW.key = 'offboardings' or NEW.key like 'spl\_offboardings\_%') execute function public.offboard_record_guard()$t$;
 end if;
end $$;

revoke all on function public.employee_access_state(text, boolean) from public;
grant execute on function public.employee_access_state(text, boolean) to anon, authenticated, service_role;
revoke all on function public.employee_restore(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.employee_restore(text, text, boolean, text) to service_role;
revoke all on function public.auth_pin_put(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_pin_put(text, text, text) to service_role;
revoke all on function public.employee_status_note(text, text, text, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.emp_status_ver(jsonb) from public, anon, authenticated;
revoke all on function public.emp_status_key(text, jsonb) from public, anon, authenticated;
revoke all on function public.emp_blocked_of(text, jsonb) from public, anon, authenticated;
revoke all on function public.emp_pin_mark() from public, anon, authenticated;
revoke all on function public.emp_privileged() from public, anon, authenticated;
revoke all on function public.emp_reinstate_ok() from public, anon, authenticated;
grant execute on function public.emp_status_ver(jsonb), public.emp_status_key(text, jsonb), public.emp_blocked_of(text, jsonb), public.emp_pin_mark(), public.emp_privileged(), public.emp_reinstate_ok() to service_role;
