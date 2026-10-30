-- 中間レビュー v1122（10/30 の依頼 ⑥）：デモをやめて本番に。中間レビューだけのメールの認証をやめる。
-- Run after 20261018090000_mid_review_scope_gm.sql. Running it twice is the same as once. Nothing is deleted:
-- the live reviews, submissions and threads stay as they are; the demo rows (env 'demo') stay in the tables but cannot be
-- read or written any more (every request for the demo is 'gone').
--  1) No email step: the settings (GM / CEO) are open to the PIN sign-in as well (mr_need_email does nothing).
--     The role still comes from mr_members (CEO / GM still need manager_auth, as before).
--  2) A PIN sign-in without a row in mr_members gets one made from the logins the app already has:
--     CEO / GM: the manager_auth account linked to the employee (its user id); AM: an AM in the employee master.
--     A row stopped by SQL is not made again. Head Chef / Corporate Chef and input people are still chosen in the settings.
--     In-service AMs get their row now, so a GM can choose them in 店舗の管轄.
--  3) The switches: the review is on (private) and the input person can write (live_input). Store publication and notices stay off.
--  4) The demo: list / get / save / submit / post / settings for env 'demo' and the demo reset are 'gone'.

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
-- A PIN sign-in → the employee's enabled row here. Without one, a row is made from the masters (never wider than them):
--   CEO / GM: the manager_auth account linked to this employee (its user id; mr_member_role checks manager_auth again on every call);
--   AM: an AM in the employee master. Head Chef / Corporate Chef and input people are still chosen by a GM / CEO in the settings.
-- A row stopped by SQL (CEO / GM / AM) is not made again. A row the settings made as staff for someone who is now an AM becomes am;
-- for someone who is CEO / GM it is turned off and the CEO / GM row is used (the input person is by employee, so nothing else moves).
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
   elsif x.role in ('staff','chef') and v_new in ('ceo','gm') and x.user_id <> v_ma and not exists(select 1 from public.mr_members m where m.user_id = v_ma) then
    update public.mr_members set enabled = false, updated_at = now(), updated_by = 'v1122 pin' where user_id = x.user_id;
    insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by) values(v_ma, v_emp, public.mr_emp_name(v_emp), v_new, true, 'v1122 pin');
    perform public.mr_event(null, 'live', v_ma::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', v_new, 'from', x.role));
    return jsonb_build_object('user_id', v_ma);
   end if;
   return jsonb_build_object('user_id', x.user_id);
  end if;
  if v_new is null then raise exception 'forbidden'; end if;
  -- Someone stopped by SQL stays stopped.
  if exists(select 1 from public.mr_members m where m.emp_id = v_emp and not m.enabled and m.role in ('ceo','gm','am')) then raise exception 'forbidden'; end if;
  if v_new in ('ceo','gm') then
   select * into y from public.mr_members m where m.user_id = v_ma;
   if y.user_id is not null then
    -- the same account's row from an email sign-in, without the employee: link it (anything else on that account is left alone)
    if not (y.enabled and coalesce(y.emp_id, '') = '' and y.role in ('ceo','gm')) then raise exception 'forbidden'; end if;
    update public.mr_members set emp_id = v_emp, name = coalesce(name, public.mr_emp_name(v_emp)), updated_at = now(), updated_by = 'v1122 pin' where user_id = v_ma;
    perform public.mr_event(null, 'live', v_ma::text, 'member_linked', jsonb_build_object('emp_id', v_emp, 'role', y.role));
    return jsonb_build_object('user_id', v_ma);
   end if;
   insert into public.mr_members(user_id, emp_id, name, role, enabled, updated_by) values(v_ma, v_emp, public.mr_emp_name(v_emp), v_new, true, 'v1122 pin');
   perform public.mr_event(null, 'live', v_ma::text, 'member_auto', jsonb_build_object('emp_id', v_emp, 'role', v_new));
   return jsonb_build_object('user_id', v_ma);
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
update public.mr_settings set value = value || jsonb_build_object('private', true, 'live_input', true, 'store_publish', false, 'notify', false), updated_at = now(), updated_by = 'v1122'
 where key = 'flags' and (coalesce((value->>'private')::boolean, false) is not true or coalesce((value->>'live_input')::boolean, false) is not true);
insert into public.mr_settings(key, value, updated_by) values ('flags', jsonb_build_object('private', true, 'store_publish', false, 'notify', false, 'live_input', true), 'v1122')
 on conflict (key) do nothing;

-- ---------------------------------------------------------------- 4) the settings need no email; the demo is gone
create or replace function public.mr_can(m public.mr_members, st public.mr_stores, p_ym text, p_via text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_role text := public.mr_member_role(m); v_rin text; v_inp text; v_from text; v_demo boolean := st.env = 'demo';
 v_live_in boolean := coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is true;
 v_is_inp boolean; v_am boolean; v_viewer boolean; v_view boolean; v_input boolean; v_reply boolean; why text[] := array[]::text[];
begin
 select x.input_emp into v_rin from public.mr_reviews x where x.env = st.env and x.store_id = st.store_id and x.ym = p_ym;
 v_inp := coalesce(nullif(v_rin, ''), nullif(st.input_emp, ''));
 v_from := case when nullif(v_rin, '') is not null then 'month' when nullif(st.input_emp, '') is not null then 'store' end;
 if v_role is null or st.store_id is null or st.active is not true then
  return jsonb_build_object('role', v_role, 'view', false, 'input', false, 'reply', false, 'note', false, 'done', false, 'confirm', false,
   'unconfirm', false, 'deadline', false, 'settings', false, 'input_emp', v_inp, 'input_from', v_from,
   'why', jsonb_build_array(case when v_role is null then 'revoked' else 'inactive' end));
 end if;
 v_is_inp := coalesce(coalesce(m.emp_id, '') <> '' and m.emp_id = v_inp, false);
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

create or replace function public.mr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], false);
 v_via text := coalesce(p->>'via', ''); v_ym text := p->>'ym'; v_on boolean := coalesce((public.mr_setting('flags')->>'private')::boolean, false) is true;
begin
 if v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then v_ym := to_char(public.mr_today('live'), 'YYYY-MM'); end if;
 return jsonb_build_object('role', m.role, 'via', v_via, 'emp_id', m.emp_id, 'name', public.mr_actor_name(m),
  'flags', public.mr_setting('flags'), 'flags_version', coalesce((select x.version from public.mr_settings x where x.key = 'flags'), 0),
  'ym', v_ym, 'today', public.mr_today('live'),
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

do $grant$ declare f text; begin
 foreach f in array array['mr_need_email(jsonb)','mr_pin_actor(jsonb)','mr_can(public.mr_members,public.mr_stores,text,text)','mr_whoami(jsonb)','mr_store(jsonb)','mr_list(jsonb)','mr_demo_reset(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $grant$;
