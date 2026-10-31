-- 中間レビュー v1122（10/30 の依頼 ⑥）：デモをやめて本番に。中間レビューだけのメールの認証をやめる。
-- Run after 20261018090000_mid_review_scope_gm.sql. Running it twice is the same as once. Nothing is deleted:
-- the live reviews, submissions and threads stay as they are; the demo rows (env 'demo') stay in the tables but cannot be
-- read or written any more (every request for the demo is 'gone').
--  1) No email step: the settings (GM / CEO) are open to the PIN sign-in as well (mr_need_email does nothing).
--     The role still comes from mr_members (CEO / GM still need manager_auth, as before).
--  1b) A CEO / GM row counts only while its manager_auth account names that employee and they are in service.
--  2) A PIN sign-in without a row in mr_members gets one made from the logins the app already has:
--     CEO / GM: the manager_auth account linked to the employee (its user id); AM: an AM in the employee master.
--     A row stopped by SQL is not made again. Head Chef / Corporate Chef and input people are still chosen in the settings.
--     In-service AMs get their row now, so a GM can choose them in 店舗の管轄.
--  3) The switches (first run only): the review is on (private) and the input person can write (live_input). Store publication and notices stay off.
--  4) The demo: list / get / save / submit / post / settings for env 'demo' and the demo reset are 'gone'.
--  5) Several input people per store and per month, chosen by name (Moto 10/30: 指名、複数選択可に), up to 10.

-- Is this the first run? (a re-run must not turn the review back on after a GM / CEO turned it off)
select set_config('mr_v1122.first', case when exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mr_demo_reset' and position('v1122' in p.prosrc) > 0) then 'no' else 'yes' end, false);

do $chk$
begin
 if to_regprocedure('public.mr_stores_save(jsonb)') is null or to_regprocedure('public.mr_settings_save(jsonb)') is null
    or not exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'am_version') then
  raise exception '先に 20261016090000・20261017090000・20261018090000 の中間レビューの SQL を流してください（何も変えていません）';
 end if;
end
$chk$;

-- ---------------------------------------------------------------- 1) no email step
create or replace function public.mr_need_email(p jsonb) returns void
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 -- v1122: the email step is gone (the role and the stores are still checked by mr_auth / mr_can).
 return;
end $$;

-- ---------------------------------------------------------------- 2) the role comes from the logins the app already has
-- A CEO / GM row counts only while its manager_auth account still names this employee and the employee is in service
-- (v1122: with the PIN as the only way in, a wrong link must not keep working after manager_auth is put right, and a resigned
-- CEO / GM must not keep the review through a mark that has not expired). Rows without an employee (from an email sign-in) are
-- checked as before. AM / Head Chef / staff are as before.
create or replace function public.mr_member_role(m public.mr_members) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_ma text;
begin
 if m.user_id is null or m.enabled is not true then return null; end if;
 if m.role in ('ceo','gm') then
  -- v1122: the account must still name this employee
  select case when bool_or(a.role = 'gm') then 'gm' when bool_or(a.role = 'ceo') then 'ceo' end into v_ma
   from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm')
    and (coalesce(m.emp_id, '') = '' or a.emp_id::text = m.emp_id);
  if v_ma is null then return null; end if;
  if coalesce(m.emp_id, '') <> '' and not public.mr_in_service(m.emp_id) then return null; end if;
  return case when m.role = 'gm' or v_ma = 'gm' then 'gm' else 'ceo' end;
 elsif m.role = 'am' then return case when public.mr_am_hr_ok(m.emp_id) then 'am' end;
 elsif m.role = 'chef' then return case when public.mr_chef_hr_ok(m.emp_id) then 'chef' end;
 elsif m.role = 'staff' then return case when public.mr_staff_hr_ok(m.emp_id) then 'staff' end;
 end if;
 return null;
end $$;

-- A PIN sign-in → the employee's enabled row here. Without one, a row is made from the masters (never wider than them):
--   CEO / GM: the manager_auth account linked to this employee (its user id); AM: an AM in the employee master.
--   Head Chef / Corporate Chef and input people are still chosen by a GM / CEO in the settings.
-- Someone who moved: a staff row of someone who is now an AM becomes am; the row of someone who is now CEO / GM (staff, chef, am,
-- or a CEO / GM row that no longer counts) gives way to the account's row; a CEO / GM row of someone who is now only an AM gives way
-- to an am row. A row that gives way is turned off with updated_by 'v1122 switch' and is turned on again if they move back.
-- The account's row follows manager_auth: when manager_auth now names this employee, the row is moved to them.
-- A row stopped by SQL is not made again (an AM stop does not block someone manager_auth has made CEO / GM).
create or replace function public.mr_pin_actor(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); v_name text := p->>'name'; v_n integer; x public.mr_members; y public.mr_members;
 v_ma uuid; v_mar text; v_new text;
begin
 if v_emp is null then
  if v_name is null or public.mr_blank(v_name) or length(v_name) > 80 then raise exception 'forbidden'; end if;
  select count(*), min(e.id::text) into v_n, v_emp from public.employees e where e.name = v_name and coalesce(e.status, '') <> '退職';
  if v_n <> 1 then raise exception 'forbidden'; end if;
 elsif length(v_emp) > 64 then raise exception 'forbidden';
 end if;
 select a.user_id, a.role into v_ma, v_mar from public.manager_auth a
  where a.emp_id::text = v_emp and a.role in ('ceo','gm') order by (a.role = 'gm') desc, a.user_id limit 1;
 v_new := case when v_ma is not null and public.mr_in_service(v_emp) then v_mar when public.mr_am_hr_ok(v_emp) then 'am' end;
 select * into x from public.mr_members m where m.emp_id = v_emp and m.enabled;
 begin
  if x.user_id is not null then
   if x.role = 'staff' and v_new = 'am' then
    update public.mr_members set role = 'am', updated_at = now(), updated_by = 'v1122 pin' where user_id = x.user_id;
    perform public.mr_event(null, 'live', x.user_id::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', 'am', 'from', 'staff'));
    return jsonb_build_object('user_id', x.user_id);
   elsif (v_new in ('ceo','gm') and x.user_id is distinct from v_ma and (x.role in ('staff','chef','am') or public.mr_member_role(x) is null))
      or (v_new = 'am' and x.role in ('ceo','gm') and public.mr_member_role(x) is null) then
    -- they moved: this row gives way (turned on again if they move back)
    update public.mr_members set enabled = false, updated_at = now(), updated_by = 'v1122 switch' where user_id = x.user_id;
    perform public.mr_event(null, 'live', x.user_id::text, 'member_switch', jsonb_build_object('emp_id', v_emp, 'from', x.role, 'to', v_new));
   else
    return jsonb_build_object('user_id', x.user_id);
   end if;
  end if;
  if v_new is null then raise exception 'forbidden'; end if;
  -- Someone stopped by SQL stays stopped (not the rows turned off above when someone moved).
  if exists(select 1 from public.mr_members m where m.emp_id = v_emp and not m.enabled and m.updated_by is distinct from 'v1122 switch'
    and m.role = any(case when v_new = 'am' then array['ceo','gm','am'] else array['ceo','gm'] end)) then raise exception 'forbidden'; end if;
  if v_new in ('ceo','gm') then
   select * into y from public.mr_members m where m.user_id = v_ma;
   if y.user_id is not null then
    -- The account's row: one stopped by SQL, or not a CEO / GM row, stays as it is.
    if y.role not in ('ceo','gm') or (not y.enabled and y.updated_by is distinct from 'v1122 switch') then raise exception 'forbidden'; end if;
    if coalesce(y.emp_id, '') <> v_emp or not y.enabled then
     -- without the employee (email sign-in), on someone manager_auth no longer names, or turned off when they moved: move it here
     update public.mr_members set emp_id = v_emp, enabled = true,
      name = case when coalesce(y.emp_id, '') = '' then coalesce(y.name, public.mr_emp_name(v_emp)) else public.mr_emp_name(v_emp) end,
      updated_at = now(), updated_by = 'v1122 pin' where user_id = v_ma;
     perform public.mr_event(null, 'live', v_ma::text, 'member_linked', jsonb_build_object('emp_id', v_emp, 'role', y.role, 'from_emp', nullif(y.emp_id, '')));
    end if;
    return jsonb_build_object('user_id', v_ma);
   end if;
   insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by) values(v_ma, v_emp, public.mr_emp_name(v_emp), v_new, true, 'v1122 pin');
   perform public.mr_event(null, 'live', v_ma::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', v_new));
   return jsonb_build_object('user_id', v_ma);
  end if;
  -- AM: the am row turned off when they moved up (its 店舗の管轄 stays), else a new one
  select * into y from public.mr_members m where m.emp_id = v_emp and m.role = 'am' and not m.enabled and m.updated_by = 'v1122 switch'
   order by m.updated_at desc limit 1;
  if y.user_id is not null then
   update public.mr_members set enabled = true, updated_at = now(), updated_by = 'v1122 pin' where user_id = y.user_id;
   perform public.mr_event(null, 'live', y.user_id::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', 'am', 'again', true));
   return jsonb_build_object('user_id', y.user_id);
  end if;
  insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by) values(gen_random_uuid(), v_emp, public.mr_emp_name(v_emp), 'am', true, 'v1122 pin') returning * into y;
  perform public.mr_event(null, 'live', y.user_id::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', 'am'));
  return jsonb_build_object('user_id', y.user_id);
 exception when unique_violation then
  -- another sign-in of the same person made the row at the same moment
  select * into x from public.mr_members m where m.emp_id = v_emp and m.enabled;
  if x.user_id is null then raise exception 'forbidden'; end if;
  return jsonb_build_object('user_id', x.user_id);
 end;
end $$;

-- In-service AMs get their row now (a GM chooses them in 店舗の管轄 before they sign in); a staff row of someone who is now an AM
-- becomes am. Not for anyone stopped by SQL.
update public.mr_members m set role = 'am', updated_at = now(), updated_by = 'v1122'
 where m.enabled and m.role = 'staff' and public.mr_am_hr_ok(m.emp_id);
insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by)
select gen_random_uuid(), e.id::text, e.name, 'am', true, 'v1122'
 from public.employees e
 where e.role = 'am' and coalesce(e.status, '') <> '退職' and coalesce(e.id::text, '') <> ''
  and not exists(select 1 from public.mr_members y where y.emp_id = e.id::text and (y.enabled or y.role in ('ceo','gm','am')))
on conflict do nothing;

-- ---------------------------------------------------------------- 3) the switches: on, input on (store publication and notices stay off)
-- Only on the first run: running this again keeps what a GM / CEO chose since.
update public.mr_settings set value = value || jsonb_build_object('private', true, 'live_input', true, 'store_publish', false, 'notify', false), updated_at = now(), updated_by = 'v1122'
 where key = 'flags' and current_setting('mr_v1122.first', true) = 'yes'
  and (coalesce((value->>'private')::boolean, false) is not true or coalesce((value->>'live_input')::boolean, false) is not true);
insert into public.mr_settings(key, value, updated_by) values ('flags', jsonb_build_object('private', true, 'store_publish', false, 'notify', false, 'live_input', true), 'v1122')
 on conflict (key) do nothing;

-- ---------------------------------------------------------------- 4) the settings need no email; the demo is gone
-- mr_can (the settings need no email; several input people) is in 5) below.

create or replace function public.mr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], false);
 v_via text := coalesce(p->>'via', ''); v_ym text := p->>'ym'; v_on boolean := coalesce((public.mr_setting('flags')->>'private')::boolean, false) is true;
begin
 if v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then v_ym := to_char(public.mr_today('live'), 'YYYY-MM'); end if;
 return jsonb_build_object('role', m.role, 'via', v_via, 'emp_id', m.emp_id, 'name', public.mr_actor_name(m),
  'flags', public.mr_setting('flags'), 'flags_version', coalesce((select x.version from public.mr_settings x where x.key = 'flags'), 0),
  'ym', v_ym, 'today', public.mr_today('live'),
  -- v1122: no email step, no demo key
  'perms', jsonb_build_object('settings', m.role in ('gm','ceo'), 'deadline', m.role in ('gm','ceo'),
    'confirm', m.role in ('am','gm','ceo'), 'unconfirm', m.role in ('gm','ceo'), 'reply', m.role in ('chef','am','gm','ceo'),
    'all_live', m.role in ('ceo','gm','chef')),
  -- Nothing about stores while the private check is off.
  'live_stores', case when not v_on then '[]'::jsonb else
    (select coalesce(jsonb_agg(x.store_id order by x.sort, x.store_id), '[]'::jsonb) from public.mr_stores x
     where x.env = 'live' and x.active and (public.mr_can(m, x, v_ym, v_via)->>'view')::boolean) end);
end $$;

create or replace function public.mr_store(p jsonb) returns public.mr_stores
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_st public.mr_stores;
begin
 if (p->>'env') = 'demo' then raise exception 'gone'; end if;   -- v1122: the demo is gone
 if (p->>'env') is null or (p->>'env') <> 'live' or (p->>'ym') is null or (p->>'ym') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or (p->>'store_id') is null or (p->>'store_id') !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 select * into v_st from public.mr_stores x where x.env = p->>'env' and x.store_id = p->>'store_id' and x.active;
 if v_st.store_id is null then raise exception 'not_found'; end if;
 return v_st;
end $$;

create or replace function public.mr_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym'; v_via text := coalesce(p->>'via', '');
begin
 if v_env = 'demo' then raise exception 'gone'; end if;   -- v1122: the demo is gone
 if v_env is null or v_env <> 'live' or v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 return jsonb_build_object('env', v_env, 'ym', v_ym, 'today', public.mr_today(v_env),
  'stores', (select coalesce(jsonb_agg(public.mr_row_v2(m, x, v_ym, v_via) order by x.sort, x.store_id), '[]'::jsonb) from public.mr_stores x
    where x.env = v_env and x.active and (public.mr_can(m, x, v_ym, v_via)->>'view')::boolean));
end $$;

create or replace function public.mr_demo_reset(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 raise exception 'gone';   -- v1122: the demo is gone (its rows stay in the tables, unread)
end $$;

-- ---------------------------------------------------------------- 5) several input people (Moto 10/30: 「指名、複数選択可に」)
-- A store's input people (and a month's own input people) are chosen by name, up to 10. Every chosen person can write and submit
-- (a save on an older version is refused as before, so one never silently writes over another). input_emps holds the list;
-- input_emp keeps the first one (the rows stay readable as before). A row written before this keeps its one person.
-- A save that names only one person (an app before v1122) is refused while the store or month has more than one (update_app),
-- so an old screen cannot drop the others.
create or replace function public.mr_emp_list_ok(v jsonb) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select v is null or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 10
  and not exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 64)
  and (select count(distinct e) from jsonb_array_elements_text(v) e) = jsonb_array_length(v));
$$;
alter table public.mr_stores add column if not exists input_emps jsonb;
alter table public.mr_reviews add column if not exists input_emps jsonb;
-- the one person a row already has becomes its list (before the version trigger below counts the list: no version moves)
update public.mr_stores set input_emps = jsonb_build_array(input_emp) where input_emps is null and nullif(input_emp, '') is not null;
update public.mr_reviews set input_emps = jsonb_build_array(input_emp) where input_emps is null and nullif(input_emp, '') is not null;
alter table public.mr_stores drop constraint if exists mr_stores_input_emps_check;
alter table public.mr_stores add constraint mr_stores_input_emps_check check (public.mr_emp_list_ok(input_emps));
alter table public.mr_reviews drop constraint if exists mr_reviews_input_emps_check;
alter table public.mr_reviews add constraint mr_reviews_input_emps_check check (public.mr_emp_list_ok(input_emps));

-- The people of a row: the list, or the one person of a row written without a list.
create or replace function public.mr_inputs(p_list jsonb, p_one text) returns text[]
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when jsonb_typeof(p_list) = 'array' and jsonb_array_length(p_list) > 0
   then array(select e from jsonb_array_elements_text(p_list) with ordinality q(e, n) order by n)
  when nullif(p_one, '') is not null then array[p_one] else array[]::text[] end;
$$;

-- The input people with their names (for the settings screen).
create or replace function public.mr_inputs_json(p_ids text[]) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('emp_id', e, 'name', public.mr_emp_name(e), 'ok', public.mr_input_kind(e) is not null,
   'member', exists(select 1 from public.mr_members w where w.emp_id = e and w.enabled)) order by n), '[]'::jsonb)
  from unnest(coalesce(p_ids, array[]::text[])) with ordinality u(e, n);
$$;

create or replace function public.mr_inputs_names(p_ids text[]) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select string_agg(coalesce(public.mr_emp_name(e), e), '・' order by n) from unnest(coalesce(p_ids, array[]::text[])) with ordinality u(e, n);
$$;

-- The version of a store's access settings moves when the people who can write change (the list, or the one person of a row
-- without a list) or the viewers change. Making the list from the one person (the same people) does not move it.
create or replace function public.mr_stores_bump() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 new.access_version := case when public.mr_inputs(new.input_emps, new.input_emp) is distinct from public.mr_inputs(old.input_emps, old.input_emp)
  or new.viewer_emps is distinct from old.viewer_emps then old.access_version + 1 else old.access_version end;
 new.am_version := case when new.am_user is distinct from old.am_user or new.name is distinct from old.name or new.sort is distinct from old.sort
  or new.active is distinct from old.active then old.am_version + 1 else old.am_version end;
 return new;
end $$;

-- mr_can: the settings need no email (v1122), and the input people are a list: the month's people if it has any, otherwise
-- the store's. Every one of them is an input person. 'input_emp' is now the list (a json array, null when nobody); mr_input_info reads it.
create or replace function public.mr_can(m public.mr_members, st public.mr_stores, p_ym text, p_via text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_role text := public.mr_member_role(m); v_rin text[]; v_sin text[]; v_inps text[]; v_inp jsonb; v_from text; v_demo boolean := st.env = 'demo';   -- v1122: settings without email; several input people
 v_live_in boolean := coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is true;
 v_is_inp boolean; v_am boolean; v_viewer boolean; v_view boolean; v_input boolean; v_reply boolean; why text[] := array[]::text[];
begin
 select public.mr_inputs(x.input_emps, x.input_emp) into v_rin from public.mr_reviews x where x.env = st.env and x.store_id = st.store_id and x.ym = p_ym;
 v_rin := coalesce(v_rin, array[]::text[]);
 v_sin := public.mr_inputs(st.input_emps, st.input_emp);
 v_inps := case when cardinality(v_rin) > 0 then v_rin else v_sin end;
 v_inp := case when cardinality(v_inps) > 0 then to_jsonb(v_inps) end;
 v_from := case when cardinality(v_rin) > 0 then 'month' when cardinality(v_sin) > 0 then 'store' end;
 if v_role is null or st.store_id is null or st.active is not true then
  return jsonb_build_object('role', v_role, 'view', false, 'input', false, 'reply', false, 'note', false, 'done', false, 'confirm', false,
   'unconfirm', false, 'deadline', false, 'settings', false, 'input_emp', v_inp, 'input_from', v_from,
   'why', jsonb_build_array(case when v_role is null then 'revoked' else 'inactive' end));
 end if;
 v_is_inp := coalesce(coalesce(m.emp_id, '') <> '' and m.emp_id = any(v_inps), false);
 v_am := coalesce(v_role = 'am' and st.am_user is not null and st.am_user = m.user_id and public.mr_am_master_ok(m.user_id, st.store_id), false);
 v_viewer := coalesce(not v_demo and coalesce(m.emp_id, '') <> '' and jsonb_typeof(st.viewer_emps) = 'array' and st.viewer_emps ? m.emp_id
  and public.mr_viewer_hr_ok(m.emp_id), false);
 v_view := coalesce(v_demo or v_role in ('ceo','gm','chef') or v_am or v_viewer or v_is_inp, false);
 v_input := coalesce(v_view and (v_demo or (v_is_inp and v_live_in)), false);
 v_reply := coalesce(v_view and v_role in ('chef','am','gm','ceo'), false);
 if v_demo then why := why || 'demo'::text; end if;
 if not v_demo and v_role in ('ceo','gm','chef') then why := why || 'all_stores'::text; end if;
 if v_am then why := why || 'am_store'::text; end if;
 if v_viewer then why := why || 'viewer'::text; end if;
 if v_is_inp and not v_demo then why := why || 'input'::text; end if;
 if v_is_inp and not v_demo and not v_live_in then why := why || 'live_input_off'::text; end if;
 if not v_demo and v_inp is null then why := why || 'input_unset'::text; end if;
 if not v_view then why := why || 'no_view'::text; end if;
 return jsonb_build_object('role', v_role, 'view', v_view, 'input', v_input, 'reply', v_reply, 'note', v_input, 'done', v_input or v_reply,
  'confirm', v_view and v_role in ('am','gm','ceo'), 'unconfirm', v_view and v_role in ('gm','ceo'), 'deadline', v_view and v_role in ('gm','ceo'),
  'settings', v_role in ('gm','ceo'), 'input_emp', v_inp, 'input_from', v_from, 'why', to_jsonb(why));
end $$;

-- The input people of a store-month with their names (the list or, from an older caller, one id). 'name' joins the names.
create or replace function public.mr_input_info(st public.mr_stores, p_emp text, p_from text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_ids text[];   -- v1122: several input people
begin
 v_ids := case when left(coalesce(p_emp, ''), 1) = '[' then public.mr_inputs(p_emp::jsonb, null)
  when nullif(p_emp, '') is not null then array[p_emp] else array[]::text[] end;
 return jsonb_build_object('emp_id', v_ids[1], 'emp_ids', to_jsonb(v_ids), 'from', p_from, 'unset', cardinality(v_ids) = 0,
  'name', case when st.env = 'demo' then st.demo->>'input_name' else public.mr_inputs_names(v_ids) end,
  'people', case when st.env = 'demo' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('emp_id', e, 'name', public.mr_emp_name(e)) order by n), '[]'::jsonb)
    from unnest(v_ids) with ordinality u(e, n)) end);
end $$;

-- Whether an employee is still someone's input person (on any list).
create or replace function public.mr_is_input_somewhere(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_emp, '') <> '' and (exists(select 1 from public.mr_stores x where x.env = 'live' and x.active and p_emp = any(public.mr_inputs(x.input_emps, x.input_emp)))
  or exists(select 1 from public.mr_reviews x where x.env = 'live' and p_emp = any(public.mr_inputs(x.input_emps, x.input_emp)) and x.ym >= to_char(public.mr_today('live'), 'YYYY-MM')));
$$;

-- The list a save asks for: input_emps (the screen from v1122) or input_emp (an older screen: one person or nobody).
-- Every person must be a candidate; null when nobody. An older screen is refused while the row has more than one (update_app).
create or replace function public.mr_inputs_req(s jsonb, p_now text[]) returns text[]
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v text[]; e text;
begin
 if (s->'input_emps') is not null and jsonb_typeof(s->'input_emps') <> 'null' then
  if jsonb_typeof(s->'input_emps') <> 'array' or jsonb_array_length(s->'input_emps') > 10 then raise exception 'bad_value'; end if;
  if exists(select 1 from jsonb_array_elements(s->'input_emps') x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') not between 1 and 64) then raise exception 'bad_value'; end if;
  v := array(select z from (select distinct on (z) z, n from jsonb_array_elements_text(s->'input_emps') with ordinality q(z, n) order by z, n) d order by n);
 else
  if (s->'input_emp') is not null and jsonb_typeof(s->'input_emp') not in ('string','null') then raise exception 'bad_value'; end if;
  if cardinality(coalesce(p_now, array[]::text[])) > 1 then raise exception 'update_app'; end if;
  v := case when nullif(s->>'input_emp', '') is not null then array[s->>'input_emp'] else array[]::text[] end;
 end if;
 foreach e in array v loop
  if public.mr_input_kind(e) is null then raise exception 'bad_candidate'; end if;
 end loop;
 return v;
end $$;

-- The settings screen (as in 20261016090000) with every store's and month's list of input people.
create or replace function public.mr_access_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);   -- v1122: several input people
 v_ym text := p->>'ym'; st public.mr_stores; x public.mr_members; v_can jsonb; v_people jsonb; v_perms jsonb := '[]'::jsonb; v_seen text[]; v_e text;
begin
 perform public.mr_need_email(p);
 if v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 for st in select * from public.mr_stores y where y.env = 'live' and y.active order by y.sort, y.store_id loop
  v_people := '[]'::jsonb; v_seen := array[]::text[];
  for x in select * from public.mr_members y where y.enabled order by y.role, y.name loop
   v_can := public.mr_can(x, st, v_ym, 'email');
   if (v_can->>'view')::boolean then
    v_people := v_people || jsonb_build_array(jsonb_build_object('user_id', x.user_id, 'emp_id', x.emp_id, 'name', public.mr_actor_name(x), 'role', x.role,
     'member', true) || (v_can - 'input_emp' - 'input_from'));
   end if;
   if x.emp_id is not null then v_seen := v_seen || x.emp_id; end if;
  end loop;
  -- The input people and the viewers who cannot sign in here (no enabled row): shown so the GM sees why.
  v_can := public.mr_can(m, st, v_ym, 'email');
  for v_e in select distinct z from (select jsonb_array_elements_text(case when jsonb_typeof(v_can->'input_emp') = 'array' then v_can->'input_emp' else '[]'::jsonb end) z
    union all select jsonb_array_elements_text(st.viewer_emps)) q where z is not null loop
   if not (v_e = any(v_seen)) then
    v_people := v_people || jsonb_build_array(jsonb_build_object('user_id', null, 'emp_id', v_e, 'name', public.mr_emp_name(v_e), 'role', null, 'member', false,
     'view', false, 'input', false, 'reply', false, 'note', false, 'done', false, 'confirm', false, 'unconfirm', false, 'deadline', false, 'settings', false,
     'why', jsonb_build_array('no_member')));
   end if;
  end loop;
  v_perms := v_perms || jsonb_build_array(jsonb_build_object('store_id', st.store_id, 'people', v_people));
 end loop;
 return jsonb_build_object('ym', v_ym, 'flags', public.mr_setting('flags'), 'flags_version', coalesce((select z.version from public.mr_settings z where z.key = 'flags'), 0),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', y.store_id, 'name', y.name, 'sort', y.sort, 'active', y.active, 'version', y.access_version,
     'am_user', y.am_user, 'am_name', (select public.mr_actor_name(w) from public.mr_members w where w.user_id = y.am_user), 'am_version', y.am_version,
     'input_emps', to_jsonb(q.si), 'inputs', public.mr_inputs_json(q.si),
     'input_emp', q.si[1], 'input_name', public.mr_inputs_names(q.si),
     'input_ok', not exists(select 1 from unnest(q.si) u(e) where public.mr_input_kind(u.e) is null),
     'viewers', (select coalesce(jsonb_agg(jsonb_build_object('emp_id', v.e, 'name', public.mr_emp_name(v.e), 'ok', public.mr_viewer_hr_ok(v.e),
        'member', exists(select 1 from public.mr_members w where w.emp_id = v.e and w.enabled)) order by v.n), '[]'::jsonb)
       from jsonb_array_elements_text(y.viewer_emps) with ordinality v(e, n)),
     'month_input_emps', to_jsonb(q.ri), 'month_inputs', public.mr_inputs_json(q.ri),
     'month_input_emp', q.ri[1], 'month_input_name', public.mr_inputs_names(q.ri),
     'month_input_ok', not exists(select 1 from unnest(q.ri) u(e) where public.mr_input_kind(u.e) is null),
     'effective_input_emps', to_jsonb(case when cardinality(q.ri) > 0 then q.ri else q.si end),
     'effective_input_emp', (case when cardinality(q.ri) > 0 then q.ri else q.si end)[1],
     'effective_input_name', public.mr_inputs_names(case when cardinality(q.ri) > 0 then q.ri else q.si end)
    ) order by y.sort, y.store_id), '[]'::jsonb)
    from public.mr_stores y left join public.mr_reviews r on r.env = 'live' and r.store_id = y.store_id and r.ym = v_ym
     cross join lateral (select public.mr_inputs(y.input_emps, y.input_emp) si, coalesce(public.mr_inputs(r.input_emps, r.input_emp), array[]::text[]) ri) q
    where y.env = 'live'),
  'chefs', (select coalesce(jsonb_agg(jsonb_build_object('user_id', y.user_id, 'emp_id', y.emp_id, 'name', public.mr_actor_name(y), 'ok', public.mr_chef_hr_ok(y.emp_id))
     order by y.name), '[]'::jsonb) from public.mr_members y where y.enabled and y.role = 'chef'),
  'candidates', jsonb_build_object('input', public.mr_cand_json('input'), 'viewer', public.mr_cand_json('viewer'), 'chef', public.mr_cand_json('chef')),
  'perms', v_perms);
end $$;

-- Save stores' input people and viewers (as in 20261016090000, on the version read) with the list.
create or replace function public.mr_access_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);   -- v1122: several input people
 s jsonb; v jsonb; st public.mr_stores; v_inps text[]; v_old text[]; v_view jsonb; n integer := 0; v_added jsonb := '[]'::jsonb; v_name text := public.mr_actor_name(m); v_r jsonb;
 v_ids text[] := array[]::text[]; v_ver integer; v_out jsonb := '[]'::jsonb; e text;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') = 0 or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if jsonb_typeof(s) <> 'object' or coalesce(s->>'store_id', '') !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
  if public.mr_ver(s->'expect_version') is null or (s->>'store_id') = any(v_ids) then raise exception 'bad_value'; end if;
  v_ids := v_ids || (s->>'store_id');
  if not exists(select 1 from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id') then raise exception 'not_found'; end if;
  if jsonb_typeof(coalesce(s->'viewer_emps', '[]')) <> 'array' or jsonb_array_length(coalesce(s->'viewer_emps', '[]')) > 20 then raise exception 'bad_value'; end if;
  for v in select * from jsonb_array_elements(coalesce(s->'viewer_emps', '[]')) loop
   if jsonb_typeof(v) <> 'string' or not public.mr_viewer_hr_ok(v #>> '{}') then raise exception 'bad_candidate'; end if;
  end loop;
 end loop;
 -- Lock the stores in one order (two saves never wait on each other in a circle), then compare every version before writing.
 perform 1 from public.mr_stores y where y.env = 'live' and y.store_id = any(v_ids) order by y.store_id for update;
 for s in select * from jsonb_array_elements(p->'stores') loop
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  if st.access_version <> public.mr_ver(s->'expect_version') then raise exception 'conflict'; end if;
 end loop;
 -- The people are checked store by store below (mr_inputs_req); any refusal undoes the whole save (one transaction).
 for s in select * from jsonb_array_elements(p->'stores') loop
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  v_old := public.mr_inputs(st.input_emps, st.input_emp);
  v_inps := public.mr_inputs_req(s, v_old);
  v_view := (select coalesce(jsonb_agg(z order by n0), '[]'::jsonb) from (select distinct on (z) z, n0 from jsonb_array_elements_text(coalesce(s->'viewer_emps', '[]')) with ordinality q(z, n0) order by z, n0) d);
  update public.mr_stores set input_emps = case when cardinality(v_inps) > 0 then to_jsonb(v_inps) end, input_emp = v_inps[1], viewer_emps = v_view,
    updated_at = now(), updated_by = m.user_id::text where env = 'live' and store_id = st.store_id
   returning access_version into v_ver;
  foreach e in array v_inps loop
   v_r := public.mr_ensure_member(e, 'staff', v_name);
   if v_r->>'action' <> 'kept' then v_added := v_added || jsonb_build_array(v_r); end if;
  end loop;
  perform public.mr_event(null, 'live', m.user_id::text, 'access', jsonb_build_object('store_id', st.store_id, 'by', v_name,
   'old', jsonb_build_object('input_emps', to_jsonb(v_old), 'viewer_emps', st.viewer_emps, 'version', st.access_version),
   'new', jsonb_build_object('input_emps', to_jsonb(v_inps), 'viewer_emps', v_view, 'version', v_ver)));
  v_out := v_out || jsonb_build_array(jsonb_build_object('store_id', st.store_id, 'version', v_ver, 'input_emps', to_jsonb(v_inps)));
  n := n + 1;
 end loop;
 return jsonb_build_object('saved', n, 'members', v_added, 'stores', v_out);
end $$;

-- One month's own input people for a live store (none: the store's). The records of who reported and replied stay.
create or replace function public.mr_month_input_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);   -- v1122: several input people
 v_ym text := p->>'ym'; v_inps text[]; v_old text[]; r public.mr_reviews; v_r jsonb; v_rs jsonb := '[]'::jsonb; v_name text := public.mr_actor_name(m); e text;
begin
 perform public.mr_need_email(p);
 if coalesce(p->>'store_id', '') !~ '^[A-Za-z0-9-]{1,24}$' or v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 if not exists(select 1 from public.mr_stores y where y.env = 'live' and y.store_id = p->>'store_id') then raise exception 'not_found'; end if;
 r := public.mr_review_row('live', p->>'store_id', v_ym);
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 v_old := public.mr_inputs(r.input_emps, r.input_emp);
 v_inps := public.mr_inputs_req(p, v_old);
 update public.mr_reviews set input_emps = case when cardinality(v_inps) > 0 then to_jsonb(v_inps) end, input_emp = v_inps[1], updated_at = now(), updated_by = v_name where id = r.id;
 foreach e in array v_inps loop
  v_r := public.mr_ensure_member(e, 'staff', v_name);
  v_rs := v_rs || jsonb_build_array(v_r);
 end loop;
 perform public.mr_event(r.id, 'live', m.user_id::text, 'month_input', jsonb_build_object('by', v_name, 'old', to_jsonb(v_old), 'new', to_jsonb(v_inps)));
 return jsonb_build_object('store_id', p->>'store_id', 'ym', v_ym, 'input_emps', to_jsonb(v_inps), 'input_emp', v_inps[1], 'member', v_rs->0, 'members', v_rs);
end $$;

do $grant$ declare f text; begin
 foreach f in array array['mr_need_email(jsonb)','mr_member_role(public.mr_members)','mr_pin_actor(jsonb)','mr_can(public.mr_members,public.mr_stores,text,text)','mr_whoami(jsonb)','mr_store(jsonb)','mr_list(jsonb)','mr_demo_reset(jsonb)',
  'mr_emp_list_ok(jsonb)','mr_inputs(jsonb,text)','mr_inputs_json(text[])','mr_inputs_names(text[])','mr_stores_bump()','mr_input_info(public.mr_stores,text,text)',
  'mr_is_input_somewhere(text)','mr_inputs_req(jsonb,text[])','mr_access_get(jsonb)','mr_access_save(jsonb)','mr_month_input_save(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $grant$;
