-- 中間レビュー v2 (段階 4・UI案44 B案): the server side. Spec: docs/MID_REVIEW_V2_JA.md.
-- Run after 20261012090000_mid_review.sql and 20261013090000_mid_review_fixes.sql. It works on a database that already
-- holds rows (demo reviews, members, live stores, settings) and running it twice is the same as running it once.
-- Tables stay service-role only (RLS on, nothing granted to browsers); every function here is executed only by the
-- mid-review Edge Function (service role). The function decides how the person signed in (via = 'email' | 'pin');
-- what the browser says about its own role or sign-in is never used.
-- It reads (never writes) manager_auth, employees and stores. The employee master is used to list candidates and to take
-- access away (退職, no longer AM / Head Chef / Corporate Chef), never to let anyone in.
-- Store publication and notices stay off; live input has its own switch (flags.live_input, off at first).

-- ---------------------------------------------------------------- 0) checks before anything changes
do $$
declare v_dup text;
begin
 if to_regclass('public.mr_members') is null or to_regclass('public.mr_reviews') is null then
  raise exception '先に 20261012090000_mid_review.sql と 20261013090000_mid_review_fixes.sql を流してください（何も変えていません）';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'title') then
  raise exception '社員の表（employees）に title（肩書き）の列がありません。止めました（何も変えていません）';
 end if;
 select string_agg(x.emp_id, ', ') into v_dup from (select emp_id from public.mr_members
  where enabled and emp_id is not null and emp_id <> '' group by emp_id having count(*) > 1) x;
 if v_dup is not null then
  raise exception '同じ社員の有効な利用者が 2 行以上あります（社員 ID：%）。片方を止めてから流してください（何も変えていません）', v_dup;
 end if;
end $$;

-- ---------------------------------------------------------------- 1) tables
-- People: chef (Head Chef / Corporate Chef, all live stores) and staff (PIN only; sees only what they are assigned).
-- A PIN-only person gets a server-made id (not an Auth user, never matched by an email sign-in).
alter table public.mr_members drop constraint if exists mr_members_role_check;
alter table public.mr_members add constraint mr_members_role_check check (role in ('ceo','gm','am','chef','staff'));
alter table public.mr_members alter column user_id set default gen_random_uuid();
-- One enabled row per employee (a PIN sign-in finds the person by employee id).
create unique index if not exists mr_members_one_per_emp on public.mr_members(emp_id) where enabled and emp_id is not null and emp_id <> '';

-- Who reports for a store (the store's base) and who else may look at it (AM / Head Chef / Corporate Chef).
alter table public.mr_stores add column if not exists input_emp text;
alter table public.mr_stores add column if not exists viewer_emps jsonb not null default '[]'::jsonb;
alter table public.mr_stores drop constraint if exists mr_stores_input_emp_check;
alter table public.mr_stores add constraint mr_stores_input_emp_check check (input_emp is null or length(input_emp) between 1 and 64);
alter table public.mr_stores drop constraint if exists mr_stores_viewer_emps_check;
alter table public.mr_stores add constraint mr_stores_viewer_emps_check check (jsonb_typeof(viewer_emps) = 'array');

-- A month's own input person (null: the store's base), and 確認完了.
alter table public.mr_reviews add column if not exists input_emp text;
alter table public.mr_reviews add column if not exists confirmed_at timestamptz;
alter table public.mr_reviews add column if not exists confirmed_by text;
alter table public.mr_reviews drop constraint if exists mr_reviews_input_emp_check;
alter table public.mr_reviews add constraint mr_reviews_input_emp_check check (input_emp is null or length(input_emp) between 1 and 64);
alter table public.mr_reviews drop constraint if exists mr_reviews_status_check;
alter table public.mr_reviews add constraint mr_reviews_status_check check (status in ('draft','submitted','followup','decision','consult','done','confirmed'));

-- Threads (v2): one row per entry, sent at once, never changed. Rows of the first edition (kind null) are kept but not read by v2.
alter table public.mr_replies add column if not exists kind text;
alter table public.mr_replies add column if not exists text text;
alter table public.mr_replies add column if not exists due date;
alter table public.mr_replies add column if not exists client_id uuid;
alter table public.mr_replies drop constraint if exists mr_replies_kind_check;
alter table public.mr_replies add constraint mr_replies_kind_check check (kind is null or kind in ('reply','note','done'));
alter table public.mr_replies drop constraint if exists mr_replies_text_check;
alter table public.mr_replies add constraint mr_replies_text_check check (kind is null or (text is not null and length(text) between 1 and 1000));
alter table public.mr_replies drop constraint if exists mr_replies_author_role_check;
alter table public.mr_replies add constraint mr_replies_author_role_check check (author_role in ('ceo','gm','am','chef','staff'));
-- The same entry sent twice (a retried request) is stored once.
create unique index if not exists mr_replies_client on public.mr_replies(review_id, client_id);

do $$ declare t text; begin
 foreach t in array array['mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update, delete on public.%I to service_role', t);
 end loop;
end $$;

-- Live input has its own switch (off). Store publication and notices stay off.
insert into public.mr_settings(key, value) values
 ('flags', jsonb_build_object('private', false, 'store_publish', false, 'notify', false, 'live_input', false))
on conflict (key) do nothing;
update public.mr_settings set value = value || jsonb_build_object('live_input', false) where key = 'flags' and not (value ? 'live_input');

-- ---------------------------------------------------------------- 2) the employee master (read only, only to take access away / list candidates)
-- In service: the employee row is there and is not 退職.
create or replace function public.mr_in_service(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_emp, '') <> '' and exists(select 1 from public.employees e where e.id::text = p_emp and coalesce(e.status, '') <> '退職');
$$;

-- Head Chef / Corporate Chef: role chef, or the title says so (and in service).
create or replace function public.mr_chef_hr_ok(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_emp, '') <> '' and exists(select 1 from public.employees e where e.id::text = p_emp and coalesce(e.status, '') <> '退職'
  and (e.role = 'chef' or btrim(coalesce(e.title, '')) in ('Head Chef','Corporate Chef')));
$$;

-- A staff member (PIN only) needs only to be in service.
create or replace function public.mr_staff_hr_ok(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select public.mr_in_service(p_emp);
$$;

-- Someone who can be added as a store's own viewer: an AM or a Head Chef / Corporate Chef (in service).
create or replace function public.mr_viewer_hr_ok(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select public.mr_chef_hr_ok(p_emp) or public.mr_am_hr_ok(p_emp);
$$;

-- Who can be chosen as a store's input person (null: nobody can): G3 leaders, G4 Store Manager / Head Chef, AM, GM.
create or replace function public.mr_input_kind(p_emp text) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select case
  when btrim(coalesce(e.title, '')) in ('Server Leader','Kitchen Leader','Operation Leader','Store Leader') then 'g3'
  when btrim(coalesce(e.title, '')) in ('Store Manager','Head Chef') then 'g4'
  when e.role = 'am' or btrim(coalesce(e.title, '')) = 'Area Manager' then 'am'
  when e.role = 'gm' or btrim(coalesce(e.title, '')) = 'General Manager' then 'gm' end
 from public.employees e where coalesce(p_emp, '') <> '' and e.id::text = p_emp and coalesce(e.status, '') <> '退職'
 limit 1;
$$;

create or replace function public.mr_emp_name(p_emp text) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select e.name from public.employees e where coalesce(p_emp, '') <> '' and e.id::text = p_emp limit 1;
$$;

-- ---------------------------------------------------------------- 3) who the person is
-- The role a member has now, or null when they are refused. The copy here can only be narrowed by the masters:
-- CEO / GM: the narrower of mr_members and manager_auth (v1068: a GM in either one is a GM here, bool_or below).
-- AM: still an AM in the employee master. chef: still Head Chef / Corporate Chef (role chef or title). staff: in service.
create or replace function public.mr_member_role(m public.mr_members) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_ma text;
begin
 if m.user_id is null or m.enabled is not true then return null; end if;
 if m.role in ('ceo','gm') then
  select case when bool_or(a.role = 'gm') then 'gm' when bool_or(a.role = 'ceo') then 'ceo' end into v_ma
   from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm');
  if v_ma is null then return null; end if;
  return case when m.role = 'gm' or v_ma = 'gm' then 'gm' else 'ceo' end;
 elsif m.role = 'am' then return case when public.mr_am_hr_ok(m.emp_id) then 'am' end;
 elsif m.role = 'chef' then return case when public.mr_chef_hr_ok(m.emp_id) then 'chef' end;
 elsif m.role = 'staff' then return case when public.mr_staff_hr_ok(m.emp_id) then 'staff' end;
 end if;
 return null;
end $$;

-- The signed-in person, if they may use the feature with one of these roles (the role returned is the one they have now).
-- p_enabled: also require the private check to be on.
create or replace function public.mr_auth(p_actor uuid, p_roles text[], p_enabled boolean) returns public.mr_members
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members; v_role text;
begin
 if p_actor is null then raise exception 'actor_required'; end if;
 select * into m from public.mr_members where user_id = p_actor and enabled;
 if m.user_id is null then raise exception 'forbidden'; end if;
 v_role := public.mr_member_role(m);
 if v_role is null or not (v_role = any(p_roles)) then raise exception 'forbidden'; end if;
 m.role := v_role;
 if p_enabled and coalesce((public.mr_setting('flags')->>'private')::boolean, false) is not true then raise exception 'disabled'; end if;
 return m;
end $$;

-- Settings (担当・閲覧設定, the switches, the demo) need an email sign-in. via is set by the Edge Function only.
create or replace function public.mr_need_email(p jsonb) returns void
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if coalesce(p->>'via', '') <> 'email' then raise exception 'email_required'; end if;
end $$;

-- A PIN sign-in: the employee in the PIN sign-in's mark (by employee id, or by exact name when exactly one employee in
-- service has it) → that person's enabled row here. Anything else is refused.
create or replace function public.mr_pin_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); v_name text := p->>'name'; v_n integer; v_user uuid;
begin
 if v_emp is null then
  if v_name is null or public.mr_blank(v_name) or length(v_name) > 80 then raise exception 'forbidden'; end if;
  select count(*), min(e.id::text) into v_n, v_emp from public.employees e where e.name = v_name and coalesce(e.status, '') <> '退職';
  if v_n <> 1 then raise exception 'forbidden'; end if;
 elsif length(v_emp) > 64 then raise exception 'forbidden';
 end if;
 select x.user_id into v_user from public.mr_members x where x.emp_id = v_emp and x.enabled;
 if v_user is null then raise exception 'forbidden'; end if;
 return jsonb_build_object('user_id', v_user);
end $$;

-- Today in Hawaii (the demo looks at its fixed point in time).
create or replace function public.mr_today(p_env text) returns date
language sql stable security invoker set search_path=public,pg_temp as $$
 select case when p_env = 'demo' and coalesce(public.mr_setting('demo')->>'now', '') <> ''
  then ((public.mr_setting('demo')->>'now')::timestamptz at time zone 'Pacific/Honolulu')::date
  else (now() at time zone 'Pacific/Honolulu')::date end;
$$;

-- ---------------------------------------------------------------- 4) what a person may do on one store-month (every action uses this)
-- view: demo → every member; live → CEO / GM / chef all stores, an AM their stores (GM-saved copy and the store master's AM
--   column), the store's own viewers (still AM / chef-type), the month's input person.
-- input (save / submit) and note: the month's input person (live: only while flags.live_input is on); demo → every member.
-- reply: view and role chef / am / gm / ceo. done: input or reply. confirm: view and am / gm / ceo. unconfirm, deadline:
-- view and gm / ceo. settings: gm / ceo with an email sign-in.
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
 if v_role in ('gm','ceo') and coalesce(p_via, '') <> 'email' then why := why || 'email_required'::text; end if;
 if not v_view then why := why || 'no_view'::text; end if;
 return jsonb_build_object('role', v_role, 'view', v_view, 'input', v_input, 'reply', v_reply, 'note', v_input, 'done', v_input or v_reply,
  'confirm', v_view and v_role in ('am','gm','ceo'), 'unconfirm', v_view and v_role in ('gm','ceo'), 'deadline', v_view and v_role in ('gm','ceo'),
  'settings', v_role in ('gm','ceo') and coalesce(p_via, '') = 'email', 'input_emp', v_inp, 'input_from', v_from, 'why', to_jsonb(why));
end $$;

-- The store a request names (env, ym and store checked; an inactive or unknown store is "not found").
create or replace function public.mr_store(p jsonb) returns public.mr_stores
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_st public.mr_stores;
begin
 if (p->>'env') is null or (p->>'env') not in ('live','demo') or (p->>'ym') is null or (p->>'ym') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or (p->>'store_id') is null or (p->>'store_id') !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 select * into v_st from public.mr_stores x where x.env = p->>'env' and x.store_id = p->>'store_id' and x.active;
 if v_st.store_id is null then raise exception 'not_found'; end if;
 return v_st;
end $$;

-- A review written in the first edition (read only in v2). A row made by v2 always has body.v = 2.
create or replace function public.mr_legacy(r public.mr_reviews) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select r.id is not null and coalesce(r.body->>'v', '') <> '2' and (r.submitted_no > 0 or r.body <> '{}'::jsonb or r.status <> 'draft');
$$;

-- none: nothing written yet (no row, or only dates / a month's input person set: version 0).
create or replace function public.mr_status_v2(r public.mr_reviews) returns text
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when r.id is null then 'none' when public.mr_legacy(r) then 'legacy' when r.version = 0 then 'none' else r.status end;
$$;

-- ---------------------------------------------------------------- 5) the record (本文 v2) and the numbers (snapshot v2)
create or replace function public.mr_txt_ok(v jsonb, n integer) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and length(v #>> '{}') <= n);
$$;

create or replace function public.mr_date_or_empty(v jsonb) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and ((v #>> '{}') = '' or public.mr_date_ok(v #>> '{}')));
$$;

-- 担当者評価: 1..5 (an integer) or not chosen.
create or replace function public.mr_eval_v(v jsonb) returns integer
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[1-5]$' then (v #>> '{}')::integer end;
$$;

create or replace function public.mr_obj(v jsonb) returns jsonb
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end;
$$;

-- The backstop for what the Edge Function already normalised: only the v2 shape, lengths, dates, 評価.
-- Too long is refused (never cut). The current month's cost rate (cur.fc) is not kept.
create or replace function public.mr_body_check_v2(b jsonb) returns jsonb
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare k text; x jsonb; f text; v_ids text[] := array[]::text[];
begin
 if jsonb_typeof(b) is distinct from 'object' or length(b::text) > 60000 or (b->'v') is distinct from '2'::jsonb then raise exception 'bad_value'; end if;
 if jsonb_typeof(coalesce(b->'prev', '{}')) <> 'object' or jsonb_typeof(coalesce(b->'cur', '{}')) <> 'object'
    or jsonb_typeof(coalesce(b->'focus', '{}')) <> 'object' or jsonb_typeof(coalesce(b->'issues', '[]')) <> 'array' then raise exception 'bad_value'; end if;
 for k, x in select * from jsonb_each(public.mr_obj(b->'prev')) loop
  if k not in ('sales','guests','ppa','repeat','labor','fc') or jsonb_typeof(x) <> 'object'
     or (x->'eval' is not null and jsonb_typeof(x->'eval') <> 'null' and public.mr_eval_v(x->'eval') is null)
     or not public.mr_txt_ok(x->'comment', 400) or not public.mr_txt_ok(x->'improve', 400) then raise exception 'bad_value'; end if;
 end loop;
 for k, x in select * from jsonb_each(public.mr_obj(b->'cur') - 'fc') loop
  if k not in ('sales','guests','ppa','repeat','labor') or jsonb_typeof(x) <> 'object'
     or (x->'eval' is not null and jsonb_typeof(x->'eval') <> 'null' and public.mr_eval_v(x->'eval') is null)
     or not public.mr_txt_ok(x->'comment', 400) or not public.mr_txt_ok(x->'measure', 400) or not public.mr_txt_ok(x->'cause', 400)
     or not public.mr_txt_ok(x->'inv_check', 400) or not public.mr_txt_ok(x->'owner', 60) or not public.mr_date_or_empty(x->'due')
     or jsonb_typeof(coalesce(x->'investigating', 'false')) <> 'boolean' then raise exception 'bad_value'; end if;
 end loop;
 if (select count(*) from jsonb_object_keys(public.mr_obj(b->'focus'))) > 12 then raise exception 'bad_value'; end if;
 for k, x in select * from jsonb_each(public.mr_obj(b->'focus')) loop
  if k !~ '^[a-z][a-z0-9_]{0,23}$' or jsonb_typeof(x) <> 'object' or coalesce(x->>'status', '') not in ('', 'ok','late','done','help')
     or not public.mr_txt_ok(x->'done', 400) or not public.mr_txt_ok(x->'remaining', 400) or not public.mr_txt_ok(x->'next', 400)
     or not public.mr_txt_ok(x->'owner', 60) then raise exception 'bad_value'; end if;
 end loop;
 if coalesce(b->>'consult', '') not in ('', 'yes', 'none') then raise exception 'bad_value'; end if;
 if jsonb_array_length(public.mr_arr(b->'issues')) > 10 then raise exception 'bad_value'; end if;
 for x in select * from jsonb_array_elements(public.mr_arr(b->'issues')) loop
  if jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' or (x->>'id') = any(v_ids)
     or not public.mr_txt_ok(x->'what', 200) or not public.mr_txt_ok(x->'ask', 400) or not public.mr_txt_ok(x->'proposal', 400)
     or not public.mr_date_or_empty(x->'ask_by') or coalesce(x->>'severity', '') not in ('', 'low','watch','high') then raise exception 'bad_value'; end if;
  v_ids := v_ids || (x->>'id');
 end loop;
 return jsonb_build_object('v', 2, 'prev', public.mr_obj(b->'prev'), 'cur', public.mr_obj(b->'cur') - 'fc', 'focus', public.mr_obj(b->'focus'),
  'consult', coalesce(b->>'consult', ''), 'issues', case when b->>'consult' = 'yes' then public.mr_arr(b->'issues') else '[]'::jsonb end);
end $$;

-- What is still missing before a submission can go (the screen checks the same: missingV2 in the Edge Function's handler).
-- Codes in order: prev:<kpi>:eval|comment, cur:<kpi>:eval|measure, focus:<key>:<field>, consult, issue:<id>:what|ask.
-- holds: last month's KPIs that cannot be judged (not final, or no target / no number) — 評価保留.
create or replace function public.mr_missing_v2(b jsonb, sn jsonb) returns jsonb
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare v_out text[] := array[]::text[]; k text; j text; v_holds integer := 0; fk text; f text; x jsonb;
 v_final boolean := coalesce(sn->'prev'->>'state', '') = 'final';
begin
 foreach k in array array['sales','guests','ppa','repeat','labor','fc'] loop
  j := sn->'prev'->'rows'->k->>'judge';
  if v_final and j in ('ok','warn','miss') then
   if public.mr_eval_v(b->'prev'->k->'eval') is null then v_out := v_out || ('prev:' || k || ':eval'); end if;
   if public.mr_blank(b->'prev'->k->>'comment') then v_out := v_out || ('prev:' || k || ':comment'); end if;
  else
   v_holds := v_holds + 1;
  end if;
 end loop;
 foreach k in array array['sales','guests','ppa','repeat','labor'] loop
  if sn->'cur'->'rows'->k->>'judge' = 'miss' then
   if public.mr_eval_v(b->'cur'->k->'eval') is null then v_out := v_out || ('cur:' || k || ':eval'); end if;
   if public.mr_blank(b->'cur'->k->>'measure') then v_out := v_out || ('cur:' || k || ':measure'); end if;
  end if;
 end loop;
 for fk in select e.value #>> '{}' from jsonb_array_elements(public.mr_arr(sn->'focus'->'keys')) with ordinality e(value, n)
   where jsonb_typeof(e.value) = 'string' order by e.n loop
  if coalesce(b->'focus'->fk->>'status', '') not in ('ok','late','done','help') then v_out := v_out || ('focus:' || fk || ':status'); end if;
  foreach f in array array['done','remaining','next','owner'] loop
   if public.mr_blank(b->'focus'->fk->>f) then v_out := v_out || ('focus:' || fk || ':' || f); end if;
  end loop;
 end loop;
 if coalesce(b->>'consult', '') not in ('yes','none') or (b->>'consult' = 'yes' and jsonb_array_length(public.mr_arr(b->'issues')) = 0) then
  v_out := v_out || 'consult'::text;
 elsif b->>'consult' = 'yes' then
  for x in select e.value from jsonb_array_elements(public.mr_arr(b->'issues')) with ordinality e(value, n) order by e.n loop
   if public.mr_blank(x->>'what') then v_out := v_out || ('issue:' || coalesce(x->>'id', '?') || ':what'); end if;
   if public.mr_blank(x->>'ask') then v_out := v_out || ('issue:' || coalesce(x->>'id', '?') || ':ask'); end if;
  end loop;
 end if;
 return jsonb_build_object('missing', to_jsonb(v_out), 'holds', v_holds);
end $$;

-- The numbers seen when submitting (the screen makes them with the meeting tab's functions). Checked: the month, last month,
-- the shape; for a demo store also the server's own fictional numbers and Qコミット keys.
create or replace function public.mr_snap_check_v2(sn jsonb, p_ym text, st public.mr_stores) returns void
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare k text; x jsonb;
begin
 if jsonb_typeof(sn) is distinct from 'object' or length(sn::text) > 30000 or (sn->'v') is distinct from '2'::jsonb then raise exception 'bad_value'; end if;
 if coalesce(sn->'period'->>'from', '') <> p_ym || '-01'
    or (coalesce(sn->'period'->>'to', '') <> '' and (not public.mr_date_ok(sn->'period'->>'to') or left(sn->'period'->>'to', 7) <> p_ym)) then raise exception 'bad_value'; end if;
 if jsonb_typeof(sn->'prev') is distinct from 'object' or coalesce(sn->'prev'->>'ym', '') <> to_char((p_ym || '-01')::date - interval '1 month', 'YYYY-MM')
    or coalesce(sn->'prev'->>'state', '') not in ('final','prov','none') or jsonb_typeof(coalesce(sn->'prev'->'rows', '{}')) <> 'object'
    or jsonb_typeof(sn->'cur') is distinct from 'object' or jsonb_typeof(coalesce(sn->'cur'->'rows', '{}')) <> 'object'
    or jsonb_typeof(sn->'focus') is distinct from 'object' or jsonb_typeof(coalesce(sn->'focus'->'keys', '[]')) <> 'array'
    or jsonb_array_length(coalesce(sn->'focus'->'keys', '[]')) > 12
    or exists(select 1 from jsonb_array_elements(coalesce(sn->'focus'->'keys', '[]')) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z][a-z0-9_]{0,23}$')
  then raise exception 'bad_value'; end if;
 if st.env = 'demo' then
  for k, x in select * from jsonb_each(public.mr_obj(st.demo->'prev'->'rows')) loop
   if (sn->'prev'->'rows'->k->'act') is distinct from coalesce(x->'act', 'null'::jsonb) or (sn->'prev'->'rows'->k->'tgt') is distinct from coalesce(x->'tgt', 'null'::jsonb) then raise exception 'bad_value'; end if;
  end loop;
  for k, x in select * from jsonb_each(public.mr_obj(st.demo->'cur'->'rows')) loop
   if (sn->'cur'->'rows'->k->'act') is distinct from coalesce(x->'act', 'null'::jsonb) or (sn->'cur'->'rows'->k->'tgt') is distinct from coalesce(x->'tgt', 'null'::jsonb) then raise exception 'bad_value'; end if;
  end loop;
  if coalesce(sn->'prev'->>'state', '') <> coalesce(st.demo->'prev'->>'state', 'none')
     or coalesce(sn->'focus'->'keys', '[]'::jsonb) is distinct from coalesce(st.demo->'focus'->'keys', '[]'::jsonb) then raise exception 'bad_value'; end if;
 end if;
end $$;

-- ---------------------------------------------------------------- 6) what the list and the page show
create or replace function public.mr_overdue(r public.mr_reviews) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'submit', r.id is not null and not public.mr_legacy(r) and r.submitted_no = 0 and public.mr_date_ok(r.deadlines->>'submit')
    and public.mr_today(r.env) > (r.deadlines->>'submit')::date,
  'reply', r.id is not null and not public.mr_legacy(r) and r.status = 'submitted' and public.mr_date_ok(r.deadlines->>'reply')
    and public.mr_today(r.env) > (r.deadlines->>'reply')::date
    and not exists(select 1 from public.mr_replies y where y.review_id = r.id and y.kind = 'reply' and y.sub_no = r.submitted_no));
$$;

-- The numbers of one submitted version (kept apart, never added together). unanswered: items that ask for a manager's word
-- (当月未達・評価 1／2・重点の遅延／支援必要・相談) with no reply on this version.
create or replace function public.mr_counts_v2(p_review uuid, p_no integer, b jsonb, sn jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare k text; fk text; v_st text; x jsonb; v_items text[] := array[]::text[]; v_miss integer := 0; v_low integer := 0; v_meas integer := 0;
 v_iss integer := 0; v_high boolean := false; v_un integer; v_need integer; v_m jsonb := public.mr_missing_v2(b, sn);
 v_f jsonb := jsonb_build_object('ok', 0, 'late', 0, 'done', 0, 'help', 0, 'none', 0);
begin
 foreach k in array array['sales','guests','ppa','repeat','labor','fc'] loop
  if public.mr_eval_v(b->'prev'->k->'eval') in (1, 2) then v_low := v_low + 1; v_items := v_items || ('prev:' || k); end if;
 end loop;
 foreach k in array array['sales','guests','ppa','repeat','labor'] loop
  if sn->'cur'->'rows'->k->>'judge' = 'miss' then v_miss := v_miss + 1; v_items := v_items || ('cur:' || k); end if;
  if public.mr_eval_v(b->'cur'->k->'eval') in (1, 2) then v_low := v_low + 1; v_items := v_items || ('cur:' || k); end if;
  if not public.mr_blank(b->'cur'->k->>'measure') then v_meas := v_meas + 1; end if;
 end loop;
 for fk in select e.value #>> '{}' from jsonb_array_elements(public.mr_arr(sn->'focus'->'keys')) e where jsonb_typeof(e.value) = 'string' loop
  v_st := coalesce(b->'focus'->fk->>'status', '');
  v_st := case when v_st in ('ok','late','done','help') then v_st else 'none' end;
  v_f := jsonb_set(v_f, array[v_st], to_jsonb((v_f->>v_st)::integer + 1));
  if v_st in ('late','help') then v_items := v_items || ('focus:' || fk); end if;
 end loop;
 if b->>'consult' = 'yes' then
  for x in select * from jsonb_array_elements(public.mr_arr(b->'issues')) loop
   v_iss := v_iss + 1;
   if x->>'severity' = 'high' then v_high := true; end if;
   v_items := v_items || ('issue:' || coalesce(x->>'id', '?'));
  end loop;
 end if;
 select count(*) filter (where not exists(select 1 from public.mr_replies y where y.review_id = p_review and y.kind = 'reply' and y.sub_no = p_no and y.target = i.t)),
  count(*) into v_un, v_need from (select distinct unnest(v_items) t) i;
 return jsonb_build_object('miss_cur', v_miss, 'eval_low', v_low, 'measures', v_meas, 'consult', v_iss, 'consult_high', v_high,
  'needs_reply', v_need, 'unanswered', v_un, 'holds', (v_m->>'holds')::integer, 'missing', jsonb_array_length(v_m->'missing'), 'focus', v_f);
end $$;

-- The input person of a store-month with a name (demo: fictional, from the demo data).
create or replace function public.mr_input_info(st public.mr_stores, p_emp text, p_from text) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('emp_id', p_emp, 'from', p_from, 'unset', p_emp is null,
  'name', case when st.env = 'demo' then st.demo->>'input_name' else public.mr_emp_name(p_emp) end);
$$;

-- One review in the list (no free text of the report).
create or replace function public.mr_review_summary(r public.mr_reviews) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_last public.mr_submissions;
begin
 if r.id is null then return jsonb_build_object('status', 'none', 'deadlines', '{}'::jsonb, 'overdue', jsonb_build_object('submit', false, 'reply', false)); end if;
 select * into v_last from public.mr_submissions x where x.review_id = r.id order by x.no desc limit 1;
 return jsonb_build_object('id', r.id, 'status', public.mr_status_v2(r), 'legacy', public.mr_legacy(r), 'version', r.version,
  'submitted_no', r.submitted_no, 'submitted_at', r.submitted_at, 'confirmed_at', r.confirmed_at, 'confirmed_by', r.confirmed_by,
  'deadlines', case when public.mr_legacy(r) then '{}'::jsonb else r.deadlines end, 'overdue', public.mr_overdue(r),
  'updated_at', r.updated_at, 'updated_by', r.updated_by,
  'counts', case when not public.mr_legacy(r) and v_last.no is not null then public.mr_counts_v2(r.id, v_last.no, v_last.body, v_last.snapshot) end);
end $$;

-- One store row of the list.
create or replace function public.mr_row_v2(m public.mr_members, st public.mr_stores, p_ym text, p_via text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_can jsonb := public.mr_can(m, st, p_ym, p_via); r public.mr_reviews; v_am public.mr_members;
begin
 select * into r from public.mr_reviews x where x.env = st.env and x.store_id = st.store_id and x.ym = p_ym;
 select * into v_am from public.mr_members x where x.user_id = st.am_user;
 return jsonb_build_object('store_id', st.store_id, 'name', st.name, 'sort', st.sort,
  'am_name', coalesce(case when v_am.user_id is not null then public.mr_actor_name(v_am) end, st.am_name), 'am_unset', st.am_user is null and st.am_name is null,
  'input', public.mr_input_info(st, v_can->>'input_emp', v_can->>'input_from'),
  'perms', v_can - 'input_emp' - 'input_from',
  'review', public.mr_review_summary(r));
end $$;

-- ---------------------------------------------------------------- 7) API (called only by the mid-review Edge Function)
create or replace function public.mr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], false);
 v_via text := coalesce(p->>'via', ''); v_ym text := p->>'ym'; v_on boolean := coalesce((public.mr_setting('flags')->>'private')::boolean, false) is true;
begin
 if v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then v_ym := to_char(public.mr_today('live'), 'YYYY-MM'); end if;
 return jsonb_build_object('role', m.role, 'via', v_via, 'emp_id', m.emp_id, 'name', public.mr_actor_name(m),
  'flags', public.mr_setting('flags'), 'demo', public.mr_setting('demo'), 'ym', v_ym, 'today', public.mr_today('live'),
  'perms', jsonb_build_object('settings', m.role in ('gm','ceo') and v_via = 'email', 'deadline', m.role in ('gm','ceo'),
    'confirm', m.role in ('am','gm','ceo'), 'unconfirm', m.role in ('gm','ceo'), 'reply', m.role in ('chef','am','gm','ceo'),
    'all_live', m.role in ('ceo','gm','chef')),
  -- Nothing about stores while the private check is off.
  'live_stores', case when not v_on then '[]'::jsonb else
    (select coalesce(jsonb_agg(x.store_id order by x.sort, x.store_id), '[]'::jsonb) from public.mr_stores x
     where x.env = 'live' and x.active and (public.mr_can(m, x, v_ym, v_via)->>'view')::boolean) end);
end $$;

create or replace function public.mr_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym'; v_via text := coalesce(p->>'via', '');
begin
 if v_env is null or v_env not in ('live','demo') or v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 return jsonb_build_object('env', v_env, 'ym', v_ym, 'today', public.mr_today(v_env),
  'stores', (select coalesce(jsonb_agg(public.mr_row_v2(m, x, v_ym, v_via) order by x.sort, x.store_id), '[]'::jsonb) from public.mr_stores x
    where x.env = v_env and x.active and (public.mr_can(m, x, v_ym, v_via)->>'view')::boolean));
end $$;

-- One store-month: the review (the working copy only for those who may write it; others see the latest submitted version),
-- every submitted version with its numbers, the thread (v2 entries only) and the history.
create or replace function public.mr_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_can jsonb; r public.mr_reviews; v_leg boolean; v_last public.mr_submissions; v_am public.mr_members;
begin
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym;
 v_leg := public.mr_legacy(r);
 select * into v_last from public.mr_submissions x where x.review_id = r.id order by x.no desc limit 1;
 select * into v_am from public.mr_members x where x.user_id = v_st.am_user;
 return jsonb_build_object('env', v_st.env, 'ym', v_ym, 'today', public.mr_today(v_st.env),
  'store', jsonb_build_object('store_id', v_st.store_id, 'name', v_st.name,
    'am_name', coalesce(case when v_am.user_id is not null then public.mr_actor_name(v_am) end, v_st.am_name), 'am_unset', v_st.am_user is null and v_st.am_name is null,
    'input', public.mr_input_info(v_st, v_can->>'input_emp', v_can->>'input_from'),
    'demo', case when v_st.env = 'demo' then v_st.demo else null end),
  'perms', v_can - 'input_emp' - 'input_from',
  'review', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', public.mr_status_v2(r), 'legacy', v_leg, 'version', r.version,
    'body', case when v_leg then public.mr_view_body(r) when (v_can->>'input')::boolean then r.body else v_last.body end,
    'deadlines', case when v_leg then '{}'::jsonb else r.deadlines end, 'overdue', public.mr_overdue(r),
    'submitted_no', r.submitted_no, 'submitted_at', r.submitted_at, 'confirmed_at', r.confirmed_at, 'confirmed_by', r.confirmed_by,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'updated_by', r.updated_by,
    'unsubmitted', not v_leg and (v_can->>'input')::boolean and r.submitted_no > 0 and r.body is distinct from v_last.body,
    'counts', case when not v_leg and v_last.no is not null then public.mr_counts_v2(r.id, v_last.no, v_last.body, v_last.snapshot) end) end,
  'submissions', (select coalesce(jsonb_agg(jsonb_build_object('no', x.no, 'body', x.body, 'snapshot', x.snapshot, 'at', x.created_at, 'by', x.created_by) order by x.no), '[]'::jsonb)
    from public.mr_submissions x where x.review_id = r.id),
  'replies', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'client_id', x.client_id, 'kind', x.kind, 'target', x.target, 'text', x.text,
      'decision', x.decision, 'due', x.due, 'sub_no', x.sub_no, 'author_name', x.author_name, 'author_role', x.author_role, 'at', x.created_at,
      'mine', x.author is not null and x.author = m.user_id) order by x.created_at, x.id), '[]'::jsonb)
    from public.mr_replies x where x.review_id = r.id and x.kind is not null),
  'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'data', e.data) order by e.id), '[]'::jsonb)
    from (select * from public.mr_events y where y.review_id = r.id order by y.id desc limit 200) e));
end $$;

-- The input person's working copy. Versioned: a save on an older version is refused (conflict). expect_version 0 (or none):
-- nothing written yet. Live stores only while flags.live_input is on. After 確認完了 nothing can be written (locked).
create or replace function public.mr_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_body jsonb; v_exp integer; v_can jsonb; r public.mr_reviews; v_name text := public.mr_actor_name(m);
begin
 if (p->'expect_version') is not null and jsonb_typeof(p->'expect_version') not in ('number','null') then raise exception 'bad_value'; end if;
 v_exp := case when jsonb_typeof(p->'expect_version') = 'number' and (p->>'expect_version') ~ '^[0-9]{1,6}$' then (p->>'expect_version')::integer else 0 end;
 v_body := public.mr_body_check_v2(p->'body');
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if v_st.env = 'live' and coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is not true then raise exception 'not_available'; end if;
 if not (v_can->>'input')::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym for update;
 if r.id is null then
  if v_exp <> 0 then raise exception 'conflict'; end if;
  begin
   insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, version, updated_by)
    values(v_st.env, v_st.store_id, v_ym, 'draft', v_body, '{}'::jsonb, 1, v_name) returning * into r;
  exception when unique_violation then raise exception 'conflict';
  end;
  perform public.mr_event(r.id, r.env, m.user_id::text, 'create', jsonb_build_object('by', v_name));
  return jsonb_build_object('id', r.id, 'version', r.version, 'status', 'draft', 'updated_at', r.updated_at);
 end if;
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if v_exp <> r.version then raise exception 'conflict'; end if;
 if r.status = 'confirmed' then raise exception 'locked'; end if;
 if r.status not in ('draft','submitted') then raise exception 'legacy'; end if;
 update public.mr_reviews set body = v_body, version = version + 1, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 if r.version = 1 then perform public.mr_event(r.id, r.env, m.user_id::text, 'create', jsonb_build_object('by', v_name)); end if;
 return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'updated_at', r.updated_at);
end $$;

-- Submit the saved working copy as a new submitted version with the numbers seen. Refused while anything required is missing
-- (the codes follow 'incomplete'). Resubmitting is allowed until 確認完了; the earlier versions and their threads stay.
create or replace function public.mr_submit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_snap jsonb := p->'snapshot'; v_can jsonb; r public.mr_reviews;
 v_name text := public.mr_actor_name(m); v_exp integer; v_miss jsonb; v_prev text;
begin
 if jsonb_typeof(p->'expect_version') is distinct from 'number' or (p->>'expect_version') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 v_exp := (p->>'expect_version')::integer;
 perform public.mr_snap_check_v2(v_snap, v_ym, v_st);
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if v_st.env = 'live' and coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is not true then raise exception 'not_available'; end if;
 if not (v_can->>'input')::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym for update;
 if r.id is null then raise exception 'not_found'; end if;
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if v_exp <> r.version then raise exception 'conflict'; end if;
 if r.status = 'confirmed' then raise exception 'locked'; end if;
 if r.status not in ('draft','submitted') then raise exception 'legacy'; end if;
 -- Nothing changed since the last submitted version: no new version.
 if r.submitted_no > 0 and r.body = (select x.body from public.mr_submissions x where x.review_id = r.id and x.no = r.submitted_no) then raise exception 'unchanged'; end if;
 v_miss := public.mr_missing_v2(r.body, v_snap);
 if jsonb_array_length(v_miss->'missing') > 0 then
  raise exception 'incomplete %', (select string_agg(e #>> '{}', ',') from jsonb_array_elements(v_miss->'missing') e);
 end if;
 v_prev := r.status;
 insert into public.mr_submissions(review_id, no, body, snapshot, created_by) values(r.id, r.submitted_no + 1, r.body, v_snap, v_name);
 update public.mr_reviews set status = 'submitted', submitted_no = submitted_no + 1, submitted_at = now(), version = version + 1,
  next_actor = null, next_due = null, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'submit', jsonb_build_object('no', r.submitted_no, 'by', v_name, 'from', v_prev, 'holds', (v_miss->>'holds')::integer));
 return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'submitted_no', r.submitted_no, 'holds', (v_miss->>'holds')::integer, 'updated_at', r.updated_at);
end $$;

-- One entry of a thread, stored at once and never changed: reply (chef / AM / GM / CEO), note (the input person),
-- done (対策の実行完了: the input person or a manager). On a submitted version's item (prev:<kpi>, cur:<kpi>, focus:<key>,
-- issue:<id>) or the whole review. The same client_id twice gives back the first entry. Nothing waits on replies.
create or replace function public.mr_post(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_kind text := p->>'kind'; v_t text := p->>'target'; v_text text := p->>'text';
 v_dec text := nullif(p->>'decision', ''); v_due text := nullif(p->>'due', ''); v_cid uuid; v_no integer; v_can jsonb; r public.mr_reviews;
 v_sub public.mr_submissions; x public.mr_replies; v_name text := public.mr_actor_name(m); v_ok boolean; v_existing boolean := false;
begin
 if v_kind is null or v_kind not in ('reply','note','done') or coalesce(p->>'client_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'text') is distinct from 'string' or length(v_text) > 1000 or public.mr_blank(v_text)
    or v_t is null or v_t !~ '^[a-z]+(:[A-Za-z0-9_-]{1,40})?$' then raise exception 'bad_value'; end if;
 v_cid := (p->>'client_id')::uuid;
 if v_kind = 'reply' then
  if (v_dec is not null and v_dec not in ('as_proposed','modify','followup','escalate','consult','no_action')) or (v_due is not null and not public.mr_date_ok(v_due)) then raise exception 'bad_value'; end if;
 else
  v_dec := null; v_due := null;
 end if;
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if v_kind = 'note' and v_st.env = 'live' and coalesce((public.mr_setting('flags')->>'live_input')::boolean, false) is not true then raise exception 'not_available'; end if;
 if not (v_can->>v_kind)::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews y where y.env = v_st.env and y.store_id = v_st.store_id and y.ym = v_ym;
 if r.id is null then raise exception 'not_submitted'; end if;
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if r.submitted_no < 1 then raise exception 'not_submitted'; end if;
 -- The submitted version the entry is about (the latest unless the screen shows an older one).
 if (p->'sub_no') is not null and jsonb_typeof(p->'sub_no') <> 'null' then
  if jsonb_typeof(p->'sub_no') <> 'number' or (p->>'sub_no') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
  v_no := (p->>'sub_no')::integer;
 else v_no := r.submitted_no; end if;
 if v_no < 1 or v_no > r.submitted_no then raise exception 'bad_value'; end if;
 select * into v_sub from public.mr_submissions y where y.review_id = r.id and y.no = v_no;
 v_ok := v_t = 'review'
  or (v_t ~ '^prev:' and substr(v_t, 6) in ('sales','guests','ppa','repeat','labor','fc'))
  or (v_t ~ '^cur:' and substr(v_t, 5) in ('sales','guests','ppa','repeat','labor'))
  or (v_t ~ '^focus:' and public.mr_arr(v_sub.snapshot->'focus'->'keys') ? substr(v_t, 7))
  or (v_t ~ '^issue:' and v_sub.body->>'consult' = 'yes'
      and exists(select 1 from jsonb_array_elements(public.mr_arr(v_sub.body->'issues')) i where i->>'id' = substr(v_t, 7)));
 if not v_ok then raise exception 'bad_value'; end if;
 select * into x from public.mr_replies y where y.review_id = r.id and y.client_id = v_cid;
 if x.id is null then
  insert into public.mr_replies(review_id, target, author, author_name, author_role, decision, data, state, sub_no, kind, text, due, client_id, sent_at, created_at, updated_at)
   values(r.id, v_t, m.user_id, v_name, m.role, v_dec, '{}'::jsonb, 'sent', v_no, v_kind, v_text, v_due::date, v_cid, now(), now(), now())
   on conflict (review_id, client_id) do nothing returning * into x;
  if x.id is null then select * into x from public.mr_replies y where y.review_id = r.id and y.client_id = v_cid; v_existing := true;
  else perform public.mr_event(r.id, r.env, m.user_id::text, 'post', jsonb_build_object('kind', v_kind, 'target', v_t, 'by', v_name, 'no', v_no));
  end if;
 else v_existing := true; end if;
 if x.author is distinct from m.user_id then raise exception 'conflict'; end if;
 return jsonb_build_object('id', x.id, 'client_id', x.client_id, 'kind', x.kind, 'target', x.target, 'text', x.text, 'decision', x.decision, 'due', x.due,
  'sub_no', x.sub_no, 'author_name', x.author_name, 'author_role', x.author_role, 'at', x.created_at, 'mine', true, 'existing', v_existing);
end $$;

-- 確認完了 (AM / GM / CEO who see the store) on the latest submitted version the screen showed (expect_no). Holds and missing
-- items do not stop it; their numbers come back.
create or replace function public.mr_confirm(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_can jsonb; r public.mr_reviews; v_last public.mr_submissions; v_c jsonb; v_name text := public.mr_actor_name(m);
begin
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if not (v_can->>'confirm')::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym for update;
 if r.id is null then raise exception 'not_submitted'; end if;
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if r.status = 'confirmed' then raise exception 'locked'; end if;
 if r.submitted_no < 1 or r.status <> 'submitted' then raise exception 'not_submitted'; end if;
 if jsonb_typeof(p->'expect_no') is distinct from 'number' or (p->>'expect_no') !~ '^[0-9]{1,6}$' or (p->>'expect_no')::integer <> r.submitted_no then raise exception 'new_version'; end if;
 select * into v_last from public.mr_submissions x where x.review_id = r.id and x.no = r.submitted_no;
 v_c := public.mr_counts_v2(r.id, v_last.no, v_last.body, v_last.snapshot);
 update public.mr_reviews set status = 'confirmed', confirmed_at = now(), confirmed_by = v_name, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'confirm', jsonb_build_object('by', v_name, 'role', m.role, 'no', r.submitted_no,
  'holds', v_c->'holds', 'missing', v_c->'missing', 'unanswered', v_c->'unanswered'));
 return jsonb_build_object('status', r.status, 'confirmed_at', r.confirmed_at, 'confirmed_by', r.confirmed_by, 'submitted_no', r.submitted_no,
  'version', r.version, 'holds', v_c->'holds', 'missing', v_c->'missing', 'unanswered', v_c->'unanswered');
end $$;

-- GM / CEO take 確認完了 back (the input person can correct and submit again).
create or replace function public.mr_unconfirm(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_can jsonb; r public.mr_reviews; v_name text := public.mr_actor_name(m);
begin
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if not (v_can->>'unconfirm')::boolean then raise exception 'forbidden'; end if;
 select * into r from public.mr_reviews x where x.env = v_st.env and x.store_id = v_st.store_id and x.ym = v_ym for update;
 if r.id is null or public.mr_legacy(r) or r.status <> 'confirmed' then raise exception 'not_confirmed'; end if;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'unconfirm', jsonb_build_object('by', v_name, 'was_at', r.confirmed_at, 'was_by', r.confirmed_by));
 update public.mr_reviews set status = 'submitted', confirmed_at = null, confirmed_by = null, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 return jsonb_build_object('status', r.status, 'version', r.version, 'submitted_no', r.submitted_no);
end $$;

-- A store-month's row before anything is written (dates or a month's input person set first). version 0 = nothing written.
create or replace function public.mr_review_row(p_env text, p_store text, p_ym text) returns public.mr_reviews
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.mr_reviews;
begin
 insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, version, updated_by)
  values(p_env, p_store, p_ym, 'draft', '{"v":2}'::jsonb, '{}'::jsonb, 0, null)
  on conflict (env, store_id, ym) do nothing;
 select * into r from public.mr_reviews x where x.env = p_env and x.store_id = p_store and x.ym = p_ym for update;
 return r;
end $$;

-- GM / CEO (email or PIN): the submit and reply dates of one store-month. Both optional, no defaults; reply not before submit.
create or replace function public.mr_deadline_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], true);
 v_st public.mr_stores := public.mr_store(p); v_ym text := p->>'ym'; v_can jsonb; r public.mr_reviews; v jsonb := p->'deadlines';
 v_sub text; v_rep text; v_new jsonb; v_name text := public.mr_actor_name(m);
begin
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 if not public.mr_date_or_empty(v->'submit') or not public.mr_date_or_empty(v->'reply') then raise exception 'bad_value'; end if;
 v_sub := nullif(v->>'submit', ''); v_rep := nullif(v->>'reply', '');
 if v_sub is not null and v_rep is not null and v_rep < v_sub then raise exception 'bad_value'; end if;
 v_can := public.mr_can(m, v_st, v_ym, p->>'via');
 if not (v_can->>'view')::boolean then raise exception 'not_found'; end if;
 if not (v_can->>'deadline')::boolean then raise exception 'forbidden'; end if;
 r := public.mr_review_row(v_st.env, v_st.store_id, v_ym);
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 if r.status = 'confirmed' then raise exception 'locked'; end if;
 v_new := jsonb_strip_nulls(jsonb_build_object('submit', v_sub, 'reply', v_rep));
 update public.mr_reviews set deadlines = v_new, updated_at = now(), updated_by = v_name where id = r.id;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'deadline', jsonb_build_object('by', v_name, 'old', r.deadlines, 'new', v_new));
 select * into r from public.mr_reviews x where x.id = r.id;
 return jsonb_build_object('deadlines', r.deadlines, 'overdue', public.mr_overdue(r), 'version', r.version);
end $$;

-- GM / CEO with an email sign-in: the switches. Works while the private check is off (to turn it on).
create or replace function public.mr_settings_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], false);
 k text := p->>'key'; v jsonb := p->'value'; v_old jsonb := public.mr_setting('flags');
begin
 perform public.mr_need_email(p);
 if k is distinct from 'flags' then raise exception 'bad_key'; end if;
 if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'private') is distinct from 'boolean'
    or ((v->'live_input') is not null and jsonb_typeof(v->'live_input') <> 'boolean') then raise exception 'bad_value'; end if;
 -- This edition never publishes to stores and never sends notices.
 if coalesce((v->>'store_publish')::boolean, false) or coalesce((v->>'notify')::boolean, false) then raise exception 'not_available'; end if;
 v := jsonb_build_object('private', (v->>'private')::boolean, 'store_publish', false, 'notify', false,
  'live_input', coalesce((v->>'live_input')::boolean, (v_old->>'live_input')::boolean, false));
 insert into public.mr_settings(key, value, updated_at, updated_by) values(k, v, now(), m.user_id::text)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
 perform public.mr_event(null, null, m.user_id::text, 'settings', jsonb_build_object('key', k, 'value', v, 'old', v_old, 'by', public.mr_actor_name(m)));
 return jsonb_build_object('key', k, 'value', v);
end $$;

-- GM / CEO with an email sign-in: who is in the members table (read only).
create or replace function public.mr_members_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], false);
begin
 perform public.mr_need_email(p);
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'emp_id', x.emp_id, 'name', public.mr_actor_name(x), 'role', x.role,
   'role_now', public.mr_member_role(x), 'enabled', x.enabled) order by x.role, x.name), '[]'::jsonb) from public.mr_members x);
end $$;

-- GM / CEO with an email sign-in: the live stores and the AM in charge (as in v1; the input person and viewers are kept).
create or replace function public.mr_stores_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; v_am uuid; n integer := 0;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if (s->>'store_id') is null or (s->>'store_id') !~ '^[A-Za-z0-9-]{1,24}$' or coalesce(length(s->>'name'),0) not between 1 and 60 then raise exception 'bad_value'; end if;
  if nullif(s->>'am_user','') is not null and (s->>'am_user') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  if (s->'sort') is not null and jsonb_typeof(s->'sort') <> 'null' and (jsonb_typeof(s->'sort') <> 'number' or (s->>'sort') !~ '^[0-9]{1,4}$') then raise exception 'bad_value'; end if;
  if (s->'active') is not null and jsonb_typeof(s->'active') not in ('boolean','null') then raise exception 'bad_value'; end if;
  v_am := nullif(s->>'am_user','')::uuid;
  if v_am is not null and not exists(select 1 from public.mr_members x where x.user_id = v_am and x.enabled and x.role = 'am' and public.mr_am_hr_ok(x.emp_id)) then raise exception 'bad_value'; end if;
  insert into public.mr_stores(env, store_id, name, am_user, sort, active, updated_at, updated_by)
   values('live', s->>'store_id', s->>'name', v_am, coalesce((s->>'sort')::integer, 0), coalesce((s->>'active')::boolean, true), now(), m.user_id::text)
   on conflict (env, store_id) do update set name = excluded.name, am_user = excluded.am_user, sort = excluded.sort, active = excluded.active,
    updated_at = now(), updated_by = excluded.updated_by;
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'live', m.user_id::text, 'stores', p->'stores');
 return jsonb_build_object('saved', n);
end $$;

-- ---------------------------------------------------------------- 8) 担当・閲覧設定 (GM / CEO with an email sign-in)
-- Make sure the employee can sign in with a PIN here: 'staff' (an input person: any existing row will do) or 'chef'
-- (all live stores). An existing CEO / GM / AM row is never changed; a row this screen made as staff may become chef.
-- A person stopped by SQL (CEO / GM / AM) is not let back in from here.
create or replace function public.mr_ensure_member(p_emp text, p_role text, p_by text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare x public.mr_members; v_name text := public.mr_emp_name(p_emp);
begin
 if p_role not in ('staff','chef') or coalesce(p_emp, '') = '' then raise exception 'bad_value'; end if;
 select * into x from public.mr_members y where y.emp_id = p_emp and y.enabled for update;
 if x.user_id is not null then
  if p_role = 'staff' or x.role = p_role then return jsonb_build_object('user_id', x.user_id, 'emp_id', p_emp, 'role', x.role, 'action', 'kept'); end if;
  if x.role = 'staff' then
   update public.mr_members set role = 'chef', updated_at = now(), updated_by = p_by where user_id = x.user_id;
   return jsonb_build_object('user_id', x.user_id, 'emp_id', p_emp, 'role', 'chef', 'action', 'chef');
  end if;
  raise exception 'role_exists';
 end if;
 if exists(select 1 from public.mr_members y where y.emp_id = p_emp and not y.enabled and y.role in ('ceo','gm','am')) then raise exception 'member_stopped'; end if;
 select * into x from public.mr_members y where y.emp_id = p_emp and not y.enabled and y.role in ('staff','chef') order by y.updated_at desc limit 1 for update;
 if x.user_id is not null then
  update public.mr_members set enabled = true, role = p_role, name = coalesce(v_name, name), updated_at = now(), updated_by = p_by where user_id = x.user_id;
  return jsonb_build_object('user_id', x.user_id, 'emp_id', p_emp, 'role', p_role, 'action', 'enabled');
 end if;
 begin
  insert into public.mr_members(emp_id, name, role, enabled, updated_by) values(p_emp, v_name, p_role, true, p_by) returning * into x;
 exception when unique_violation then raise exception 'conflict';
 end;
 return jsonb_build_object('user_id', x.user_id, 'emp_id', p_emp, 'role', p_role, 'action', 'created');
end $$;

-- Whether an employee is still someone's input person (a store's base on an active live store, or a month from now on).
create or replace function public.mr_is_input_somewhere(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_emp, '') <> '' and (exists(select 1 from public.mr_stores x where x.env = 'live' and x.active and x.input_emp = p_emp)
  or exists(select 1 from public.mr_reviews x where x.env = 'live' and x.input_emp = p_emp and x.ym >= to_char(public.mr_today('live'), 'YYYY-MM')));
$$;

create or replace function public.mr_cand_json(p_kind text) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('emp_id', e.id::text, 'name', e.name, 'title', e.title, 'role', e.role,
   -- the store column is read when the master has it (it only helps the screen show where the person works)
   'store', to_jsonb(e)->>'store', 'kind', case p_kind when 'input' then public.mr_input_kind(e.id::text) when 'chef' then 'chef'
     else case when public.mr_am_hr_ok(e.id::text) then 'am' else 'chef' end end)
   order by e.name, e.id::text), '[]'::jsonb)
 from public.employees e
 where coalesce(e.status, '') <> '退職' and case p_kind when 'input' then public.mr_input_kind(e.id::text) is not null
   when 'viewer' then public.mr_viewer_hr_ok(e.id::text) when 'chef' then public.mr_chef_hr_ok(e.id::text) else false end;
$$;

-- The settings screen: stores with their input person and viewers, the month's own input person, Head Chef / Corporate Chef
-- members, candidates, and for each live store who can do what and why (from mr_can).
create or replace function public.mr_access_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
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
  -- The input person and the viewers who cannot sign in here (no enabled row): shown so the GM sees why.
  for v_e in select distinct z from (select (public.mr_can(m, st, v_ym, 'email')->>'input_emp') z union all select jsonb_array_elements_text(st.viewer_emps)) q where z is not null loop
   if not (v_e = any(v_seen)) then
    v_people := v_people || jsonb_build_array(jsonb_build_object('user_id', null, 'emp_id', v_e, 'name', public.mr_emp_name(v_e), 'role', null, 'member', false,
     'view', false, 'input', false, 'reply', false, 'note', false, 'done', false, 'confirm', false, 'unconfirm', false, 'deadline', false, 'settings', false,
     'why', jsonb_build_array('no_member')));
   end if;
  end loop;
  v_perms := v_perms || jsonb_build_array(jsonb_build_object('store_id', st.store_id, 'people', v_people));
 end loop;
 return jsonb_build_object('ym', v_ym, 'flags', public.mr_setting('flags'),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', y.store_id, 'name', y.name, 'sort', y.sort, 'active', y.active,
     'input_emp', y.input_emp, 'input_name', public.mr_emp_name(y.input_emp), 'input_ok', y.input_emp is null or public.mr_input_kind(y.input_emp) is not null,
     'viewers', (select coalesce(jsonb_agg(jsonb_build_object('emp_id', v.e, 'name', public.mr_emp_name(v.e), 'ok', public.mr_viewer_hr_ok(v.e),
        'member', exists(select 1 from public.mr_members w where w.emp_id = v.e and w.enabled)) order by v.n), '[]'::jsonb)
       from jsonb_array_elements_text(y.viewer_emps) with ordinality v(e, n)),
     'month_input_emp', r.input_emp, 'month_input_name', public.mr_emp_name(r.input_emp),
     'month_input_ok', r.input_emp is null or public.mr_input_kind(r.input_emp) is not null,
     'effective_input_emp', coalesce(r.input_emp, y.input_emp), 'effective_input_name', public.mr_emp_name(coalesce(r.input_emp, y.input_emp))
    ) order by y.sort, y.store_id), '[]'::jsonb)
    from public.mr_stores y left join public.mr_reviews r on r.env = 'live' and r.store_id = y.store_id and r.ym = v_ym where y.env = 'live'),
  'chefs', (select coalesce(jsonb_agg(jsonb_build_object('user_id', y.user_id, 'emp_id', y.emp_id, 'name', public.mr_actor_name(y), 'ok', public.mr_chef_hr_ok(y.emp_id))
     order by y.name), '[]'::jsonb) from public.mr_members y where y.enabled and y.role = 'chef'),
  'candidates', jsonb_build_object('input', public.mr_cand_json('input'), 'viewer', public.mr_cand_json('viewer'), 'chef', public.mr_cand_json('chef')),
  'perms', v_perms);
end $$;

-- Save stores' base input person and viewers. Every entry is checked before anything is written.
create or replace function public.mr_access_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; v jsonb; st public.mr_stores; v_inp text; v_view jsonb; n integer := 0; v_added jsonb := '[]'::jsonb; v_name text := public.mr_actor_name(m); v_r jsonb;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') = 0 or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if jsonb_typeof(s) <> 'object' or coalesce(s->>'store_id', '') !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
  if not exists(select 1 from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id') then raise exception 'not_found'; end if;
  if (s->'input_emp') is not null and jsonb_typeof(s->'input_emp') not in ('string','null') then raise exception 'bad_value'; end if;
  if nullif(s->>'input_emp', '') is not null and public.mr_input_kind(s->>'input_emp') is null then raise exception 'bad_candidate'; end if;
  if jsonb_typeof(coalesce(s->'viewer_emps', '[]')) <> 'array' or jsonb_array_length(coalesce(s->'viewer_emps', '[]')) > 20 then raise exception 'bad_value'; end if;
  for v in select * from jsonb_array_elements(coalesce(s->'viewer_emps', '[]')) loop
   if jsonb_typeof(v) <> 'string' or not public.mr_viewer_hr_ok(v #>> '{}') then raise exception 'bad_candidate'; end if;
  end loop;
 end loop;
 for s in select * from jsonb_array_elements(p->'stores') loop
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id' for update;
  v_inp := nullif(s->>'input_emp', '');
  v_view := (select coalesce(jsonb_agg(z order by n0), '[]'::jsonb) from (select distinct on (z) z, n0 from jsonb_array_elements_text(coalesce(s->'viewer_emps', '[]')) with ordinality q(z, n0) order by z, n0) d);
  update public.mr_stores set input_emp = v_inp, viewer_emps = v_view, updated_at = now(), updated_by = m.user_id::text where env = 'live' and store_id = st.store_id;
  if v_inp is not null then
   v_r := public.mr_ensure_member(v_inp, 'staff', v_name);
   if v_r->>'action' <> 'kept' then v_added := v_added || jsonb_build_array(v_r); end if;
  end if;
  perform public.mr_event(null, 'live', m.user_id::text, 'access', jsonb_build_object('store_id', st.store_id, 'by', v_name,
   'old', jsonb_build_object('input_emp', st.input_emp, 'viewer_emps', st.viewer_emps), 'new', jsonb_build_object('input_emp', v_inp, 'viewer_emps', v_view)));
  n := n + 1;
 end loop;
 return jsonb_build_object('saved', n, 'members', v_added);
end $$;

-- One month's own input person for a live store (null: the store's base). The records of who reported and replied stay.
create or replace function public.mr_month_input_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 v_ym text := p->>'ym'; v_inp text; r public.mr_reviews; v_r jsonb; v_old text; v_name text := public.mr_actor_name(m);
begin
 perform public.mr_need_email(p);
 if coalesce(p->>'store_id', '') !~ '^[A-Za-z0-9-]{1,24}$' or v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or ((p->'input_emp') is not null and jsonb_typeof(p->'input_emp') not in ('string','null')) then raise exception 'bad_value'; end if;
 if not exists(select 1 from public.mr_stores y where y.env = 'live' and y.store_id = p->>'store_id') then raise exception 'not_found'; end if;
 v_inp := nullif(p->>'input_emp', '');
 if v_inp is not null and public.mr_input_kind(v_inp) is null then raise exception 'bad_candidate'; end if;
 r := public.mr_review_row('live', p->>'store_id', v_ym);
 if public.mr_legacy(r) then raise exception 'legacy'; end if;
 v_old := r.input_emp;
 update public.mr_reviews set input_emp = v_inp, updated_at = now(), updated_by = v_name where id = r.id;
 if v_inp is not null then v_r := public.mr_ensure_member(v_inp, 'staff', v_name); end if;
 perform public.mr_event(r.id, 'live', m.user_id::text, 'month_input', jsonb_build_object('by', v_name, 'old', v_old, 'new', v_inp));
 return jsonb_build_object('store_id', p->>'store_id', 'ym', v_ym, 'input_emp', v_inp, 'member', v_r);
end $$;

-- Head Chef / Corporate Chef (all live stores): add (on) or remove (off). Removing keeps a PIN sign-in only while the
-- person is still an input person (then as staff); otherwise the row is turned off.
create or replace function public.mr_chef_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 v_emp text := p->>'emp_id'; v_r jsonb; x public.mr_members; v_name text := public.mr_actor_name(m);
begin
 perform public.mr_need_email(p);
 if coalesce(v_emp, '') = '' or length(v_emp) > 64 or jsonb_typeof(p->'on') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 if (p->>'on')::boolean then
  if not public.mr_chef_hr_ok(v_emp) then raise exception 'bad_candidate'; end if;
  v_r := public.mr_ensure_member(v_emp, 'chef', v_name);
 else
  select * into x from public.mr_members y where y.emp_id = v_emp and y.enabled and y.role = 'chef' for update;
  if x.user_id is null then raise exception 'not_found'; end if;
  if public.mr_is_input_somewhere(v_emp) then
   update public.mr_members set role = 'staff', updated_at = now(), updated_by = v_name where user_id = x.user_id;
   v_r := jsonb_build_object('user_id', x.user_id, 'emp_id', v_emp, 'role', 'staff', 'action', 'staff');
  else
   update public.mr_members set enabled = false, updated_at = now(), updated_by = v_name where user_id = x.user_id;
   v_r := jsonb_build_object('user_id', x.user_id, 'emp_id', v_emp, 'role', 'chef', 'action', 'disabled');
  end if;
 end if;
 perform public.mr_event(null, 'live', m.user_id::text, 'chef', jsonb_build_object('by', v_name, 'emp_id', v_emp, 'on', (p->>'on')::boolean, 'result', v_r));
 return v_r;
end $$;

-- ---------------------------------------------------------------- 9) the demo (fictional stores only; nothing outside env 'demo')
create or replace function public.mr_demo_reset(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; r jsonb; x jsonb; v_id uuid; n integer := 0;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_typeof(p->'reviews') is distinct from 'array' then raise exception 'bad_value'; end if;
 delete from public.mr_reviews where env = 'demo';
 delete from public.mr_stores where env = 'demo';
 for s in select * from jsonb_array_elements(p->'stores') loop
  insert into public.mr_stores(env, store_id, name, am_name, sort, demo, input_emp, updated_by)
   values('demo', s->>'store_id', s->>'name', nullif(s->>'am_name',''), coalesce((s->>'sort')::integer, 0), coalesce(s->'demo', '{}'), nullif(s->>'input_emp', ''), m.user_id::text);
 end loop;
 for r in select * from jsonb_array_elements(p->'reviews') loop
  insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, version, submitted_no, submitted_at, confirmed_at, confirmed_by, updated_at, updated_by)
   values('demo', r->>'store_id', r->>'ym', r->>'status', coalesce(r->'body', '{"v":2}'), coalesce(r->'deadlines', '{}'), coalesce((r->>'version')::integer, 1),
    coalesce((r->>'submitted_no')::integer, 0), nullif(r->>'submitted_at','')::timestamptz, nullif(r->>'confirmed_at','')::timestamptz, nullif(r->>'confirmed_by',''),
    coalesce(nullif(r->>'updated_at','')::timestamptz, now()), r->>'updated_by')
   returning id into v_id;
  for x in select * from jsonb_array_elements(public.mr_arr(r->'submissions')) loop
   insert into public.mr_submissions(review_id, no, body, snapshot, created_at, created_by)
    values(v_id, (x->>'no')::integer, coalesce(x->'body', r->'body', '{}'), coalesce(x->'snapshot', '{}'), coalesce(nullif(x->>'at','')::timestamptz, now()), x->>'by');
  end loop;
  for x in select * from jsonb_array_elements(public.mr_arr(r->'replies')) loop
   insert into public.mr_replies(review_id, target, author_name, author_role, decision, data, state, sub_no, kind, text, due, client_id, sent_at, created_at, updated_at)
    values(v_id, x->>'target', x->>'author_name', x->>'author_role', nullif(x->>'decision',''), '{}'::jsonb, 'sent', coalesce(nullif(x->>'sub_no','')::integer, 1),
     x->>'kind', x->>'text', nullif(x->>'due','')::date, gen_random_uuid(), coalesce(nullif(x->>'at','')::timestamptz, now()),
     coalesce(nullif(x->>'at','')::timestamptz, now()), coalesce(nullif(x->>'at','')::timestamptz, now()));
  end loop;
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'demo', m.user_id::text, 'demo_reset', jsonb_build_object('reviews', n, 'by', public.mr_actor_name(m)));
 return jsonb_build_object('stores', jsonb_array_length(p->'stores'), 'reviews', n);
end $$;

-- ---------------------------------------------------------------- 10) the first edition's reply / completion steps are gone in v2
create or replace function public.mr_reply_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$ begin raise exception 'gone'; end $$;
create or replace function public.mr_reply_delete(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$ begin raise exception 'gone'; end $$;
create or replace function public.mr_reply_send(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$ begin raise exception 'gone'; end $$;
create or replace function public.mr_complete(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$ begin raise exception 'gone'; end $$;
create or replace function public.mr_result_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$ begin raise exception 'gone'; end $$;

-- ---------------------------------------------------------------- 11) only the service role runs these
do $$ declare f text; begin
 foreach f in array array['mr_in_service(text)','mr_chef_hr_ok(text)','mr_staff_hr_ok(text)','mr_viewer_hr_ok(text)','mr_input_kind(text)','mr_emp_name(text)',
  'mr_member_role(public.mr_members)','mr_auth(uuid,text[],boolean)','mr_need_email(jsonb)','mr_pin_actor(jsonb)','mr_today(text)',
  'mr_can(public.mr_members,public.mr_stores,text,text)','mr_store(jsonb)','mr_legacy(public.mr_reviews)','mr_status_v2(public.mr_reviews)',
  'mr_txt_ok(jsonb,integer)','mr_date_or_empty(jsonb)','mr_eval_v(jsonb)','mr_obj(jsonb)','mr_body_check_v2(jsonb)','mr_missing_v2(jsonb,jsonb)',
  'mr_snap_check_v2(jsonb,text,public.mr_stores)','mr_overdue(public.mr_reviews)','mr_counts_v2(uuid,integer,jsonb,jsonb)',
  'mr_input_info(public.mr_stores,text,text)','mr_review_summary(public.mr_reviews)','mr_row_v2(public.mr_members,public.mr_stores,text,text)',
  'mr_whoami(jsonb)','mr_list(jsonb)','mr_get(jsonb)','mr_save(jsonb)','mr_submit(jsonb)','mr_post(jsonb)','mr_confirm(jsonb)','mr_unconfirm(jsonb)',
  'mr_review_row(text,text,text)','mr_deadline_save(jsonb)','mr_settings_save(jsonb)','mr_members_list(jsonb)','mr_stores_save(jsonb)',
  'mr_ensure_member(text,text,text)','mr_is_input_somewhere(text)','mr_cand_json(text)','mr_access_get(jsonb)','mr_access_save(jsonb)',
  'mr_month_input_save(jsonb)','mr_chef_save(jsonb)','mr_demo_reset(jsonb)',
  'mr_reply_save(jsonb)','mr_reply_delete(jsonb)','mr_reply_send(jsonb)','mr_complete(jsonb)','mr_result_save(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
