-- 中間レビュー v2 の直し（v1073）: 担当・閲覧設定・店舗の管轄（AM）と ON・OFF（flags）に版を入れる。Spec: docs/MID_REVIEW_V2_JA.md（「版（v1073）」）.
-- Codex のレビュー（685f49e・P2）: 画面は読んだときの値を持ち、保存は版を見ずに上書きしていた。GM・CEO の 2 人が同じ店・同じ
-- スイッチを開くと、古い画面の保存が先の変更を黙って戻した。店舗の管轄（stores_save・全店をまとめて送る）も同じ（Moto さん 10/13：
-- いっしょに直す）。ここからは、読んだときの版（expect_version）が今と違えば何も書かずに conflict（画面は読み直す）。
-- Run after 20261015090000_mid_review_v2.sql. Running it twice is the same as running it once. It works on a database that
-- already holds rows. Re-running 20261015090000 after this one puts back the v2 functions (without the version check):
-- run this file again after it.
-- Only the service role runs these (the mid-review Edge Function). Tables stay service-role only.

-- ---------------------------------------------------------------- 0) checks before anything changes
do $$
begin
 if to_regclass('public.mr_stores') is null or to_regclass('public.mr_settings') is null
    or not exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'input_emp')
    or to_regprocedure('public.mr_access_save(jsonb)') is null then
  raise exception '先に 20261015090000_mid_review_v2.sql を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 1) versions
-- The switches (one version per key) and each live store's input person and viewers (access_version).
alter table public.mr_settings add column if not exists version integer not null default 0;
alter table public.mr_settings drop constraint if exists mr_settings_version_check;
alter table public.mr_settings add constraint mr_settings_version_check check (version >= 0);
alter table public.mr_stores add column if not exists access_version integer not null default 0;
alter table public.mr_stores drop constraint if exists mr_stores_access_version_check;
alter table public.mr_stores add constraint mr_stores_access_version_check check (access_version >= 0);
-- The store itself as the 管轄 table saves it (the AM in charge, name, order, in use). A store saved from here starts at 1, so a
-- screen that read "not saved yet" (0) cannot write over a store someone else has just saved.
alter table public.mr_stores add column if not exists am_version integer not null default 0;
alter table public.mr_stores drop constraint if exists mr_stores_am_version_check;
alter table public.mr_stores add constraint mr_stores_am_version_check check (am_version >= 0);

-- The version moves whenever the value moves, whoever writes it (these functions, the stop SQL, a hand-written SQL), and
-- nothing else moves it (a write that sets the version itself is ignored).
create or replace function public.mr_settings_bump() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 new.version := case when new.value is distinct from old.value then old.version + 1 else old.version end;
 return new;
end $$;
drop trigger if exists mr_settings_bump on public.mr_settings;
create trigger mr_settings_bump before update on public.mr_settings for each row execute function public.mr_settings_bump();

create or replace function public.mr_stores_bump() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 new.access_version := case when new.input_emp is distinct from old.input_emp or new.viewer_emps is distinct from old.viewer_emps
  then old.access_version + 1 else old.access_version end;
 new.am_version := case when new.am_user is distinct from old.am_user or new.name is distinct from old.name or new.sort is distinct from old.sort
  or new.active is distinct from old.active then old.am_version + 1 else old.am_version end;
 return new;
end $$;
drop trigger if exists mr_stores_bump on public.mr_stores;
create trigger mr_stores_bump before update on public.mr_stores for each row execute function public.mr_stores_bump();

-- A version the screen read: a whole number (0 or more).
create or replace function public.mr_ver(v jsonb) returns integer
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]{1,9}$' then (v #>> '{}')::integer end;
$$;

-- ---------------------------------------------------------------- 2) who am I: the switches come with their version
-- (the same as 20261015090000 with flags_version added: the screen turns the private check on from here while it is off)
create or replace function public.mr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am','chef','staff'], false);
 v_via text := coalesce(p->>'via', ''); v_ym text := p->>'ym'; v_on boolean := coalesce((public.mr_setting('flags')->>'private')::boolean, false) is true;
begin
 if v_ym is null or v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then v_ym := to_char(public.mr_today('live'), 'YYYY-MM'); end if;
 return jsonb_build_object('role', m.role, 'via', v_via, 'emp_id', m.emp_id, 'name', public.mr_actor_name(m),
  'flags', public.mr_setting('flags'), 'flags_version', coalesce((select x.version from public.mr_settings x where x.key = 'flags'), 0),
  'demo', public.mr_setting('demo'), 'ym', v_ym, 'today', public.mr_today('live'),
  'perms', jsonb_build_object('settings', m.role in ('gm','ceo') and v_via = 'email', 'deadline', m.role in ('gm','ceo'),
    'confirm', m.role in ('am','gm','ceo'), 'unconfirm', m.role in ('gm','ceo'), 'reply', m.role in ('chef','am','gm','ceo'),
    'all_live', m.role in ('ceo','gm','chef')),
  -- Nothing about stores while the private check is off.
  'live_stores', case when not v_on then '[]'::jsonb else
    (select coalesce(jsonb_agg(x.store_id order by x.sort, x.store_id), '[]'::jsonb) from public.mr_stores x
     where x.env = 'live' and x.active and (public.mr_can(m, x, v_ym, v_via)->>'view')::boolean) end);
end $$;

-- ---------------------------------------------------------------- 3) the switches: saved only on the version the screen read
-- GM / CEO with an email sign-in. Works while the private check is off (to turn it on). expect_version is required; another
-- version now → conflict and nothing is written.
create or replace function public.mr_settings_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], false);
 k text := p->>'key'; v jsonb := p->'value'; v_exp integer := public.mr_ver(p->'expect_version'); s public.mr_settings; v_ver integer;
begin
 perform public.mr_need_email(p);
 if k is distinct from 'flags' then raise exception 'bad_key'; end if;
 if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'private') is distinct from 'boolean'
    or ((v->'live_input') is not null and jsonb_typeof(v->'live_input') <> 'boolean') then raise exception 'bad_value'; end if;
 if v_exp is null then raise exception 'bad_value'; end if;
 -- This edition never publishes to stores and never sends notices.
 if coalesce((v->>'store_publish')::boolean, false) or coalesce((v->>'notify')::boolean, false) then raise exception 'not_available'; end if;
 insert into public.mr_settings(key, value) values('flags', jsonb_build_object('private', false, 'store_publish', false, 'notify', false, 'live_input', false))
  on conflict (key) do nothing;
 select * into s from public.mr_settings x where x.key = 'flags' for update;
 if s.version <> v_exp then raise exception 'conflict'; end if;
 v := jsonb_build_object('private', (v->>'private')::boolean, 'store_publish', false, 'notify', false,
  'live_input', coalesce((v->>'live_input')::boolean, (s.value->>'live_input')::boolean, false));
 update public.mr_settings set value = v, updated_at = now(), updated_by = m.user_id::text where key = 'flags' returning version into v_ver;
 perform public.mr_event(null, null, m.user_id::text, 'settings', jsonb_build_object('key', k, 'value', v, 'old', s.value, 'by', public.mr_actor_name(m),
  'version', v_ver));
 return jsonb_build_object('key', k, 'value', v, 'version', v_ver);
end $$;

-- ---------------------------------------------------------------- 4) 担当・閲覧設定: read with versions, save on the version read
-- (the same as 20261015090000 with each store's version and the switches' version added)
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
 return jsonb_build_object('ym', v_ym, 'flags', public.mr_setting('flags'), 'flags_version', coalesce((select z.version from public.mr_settings z where z.key = 'flags'), 0),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', y.store_id, 'name', y.name, 'sort', y.sort, 'active', y.active, 'version', y.access_version,
     'am_user', y.am_user, 'am_name', (select public.mr_actor_name(w) from public.mr_members w where w.user_id = y.am_user), 'am_version', y.am_version,
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

-- Save stores' base input person and viewers. Every entry is checked before anything is written. Each store carries the
-- version the screen read (expect_version, required); if any store has another version now, nothing is written (conflict).
create or replace function public.mr_access_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; v jsonb; st public.mr_stores; v_inp text; v_view jsonb; n integer := 0; v_added jsonb := '[]'::jsonb; v_name text := public.mr_actor_name(m); v_r jsonb;
 v_ids text[] := array[]::text[]; v_ver integer; v_out jsonb := '[]'::jsonb;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') = 0 or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if jsonb_typeof(s) <> 'object' or coalesce(s->>'store_id', '') !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
  if public.mr_ver(s->'expect_version') is null or (s->>'store_id') = any(v_ids) then raise exception 'bad_value'; end if;
  v_ids := v_ids || (s->>'store_id');
  if not exists(select 1 from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id') then raise exception 'not_found'; end if;
  if (s->'input_emp') is not null and jsonb_typeof(s->'input_emp') not in ('string','null') then raise exception 'bad_value'; end if;
  if nullif(s->>'input_emp', '') is not null and public.mr_input_kind(s->>'input_emp') is null then raise exception 'bad_candidate'; end if;
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
 for s in select * from jsonb_array_elements(p->'stores') loop
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  v_inp := nullif(s->>'input_emp', '');
  v_view := (select coalesce(jsonb_agg(z order by n0), '[]'::jsonb) from (select distinct on (z) z, n0 from jsonb_array_elements_text(coalesce(s->'viewer_emps', '[]')) with ordinality q(z, n0) order by z, n0) d);
  update public.mr_stores set input_emp = v_inp, viewer_emps = v_view, updated_at = now(), updated_by = m.user_id::text where env = 'live' and store_id = st.store_id
   returning access_version into v_ver;
  if v_inp is not null then
   v_r := public.mr_ensure_member(v_inp, 'staff', v_name);
   if v_r->>'action' <> 'kept' then v_added := v_added || jsonb_build_array(v_r); end if;
  end if;
  perform public.mr_event(null, 'live', m.user_id::text, 'access', jsonb_build_object('store_id', st.store_id, 'by', v_name,
   'old', jsonb_build_object('input_emp', st.input_emp, 'viewer_emps', st.viewer_emps, 'version', st.access_version),
   'new', jsonb_build_object('input_emp', v_inp, 'viewer_emps', v_view, 'version', v_ver)));
  v_out := v_out || jsonb_build_array(jsonb_build_object('store_id', st.store_id, 'version', v_ver));
  n := n + 1;
 end loop;
 return jsonb_build_object('saved', n, 'members', v_added, 'stores', v_out);
end $$;

-- ---------------------------------------------------------------- 5) 店舗の管轄（the live stores and the AM in charge）: saved on the version read
-- GM / CEO with an email sign-in (the same rules as 20261015090000: only enabled AMs who are still AMs; the input person and the
-- viewers are kept). Each store carries the version the screen read (expect_version, required; 0 for a store not saved yet).
-- If any store has another version now — or was saved by someone else since — nothing is written (conflict).
create or replace function public.mr_stores_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; v_am uuid; n integer := 0; v_ids text[] := array[]::text[]; st public.mr_stores; v_ver integer; v_out jsonb := '[]'::jsonb;
begin
 perform public.mr_need_email(p);
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if jsonb_typeof(s) <> 'object' or (s->>'store_id') is null or (s->>'store_id') !~ '^[A-Za-z0-9-]{1,24}$' or coalesce(length(s->>'name'),0) not between 1 and 60 then raise exception 'bad_value'; end if;
  if public.mr_ver(s->'expect_version') is null or (s->>'store_id') = any(v_ids) then raise exception 'bad_value'; end if;
  v_ids := v_ids || (s->>'store_id');
  if nullif(s->>'am_user','') is not null and (s->>'am_user') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  if (s->'sort') is not null and jsonb_typeof(s->'sort') <> 'null' and (jsonb_typeof(s->'sort') <> 'number' or (s->>'sort') !~ '^[0-9]{1,4}$') then raise exception 'bad_value'; end if;
  if (s->'active') is not null and jsonb_typeof(s->'active') not in ('boolean','null') then raise exception 'bad_value'; end if;
  v_am := nullif(s->>'am_user','')::uuid;
  if v_am is not null and not exists(select 1 from public.mr_members x where x.user_id = v_am and x.enabled and x.role = 'am' and public.mr_am_hr_ok(x.emp_id)) then raise exception 'bad_value'; end if;
 end loop;
 -- Lock the saved stores in one order, then compare every version before writing.
 perform 1 from public.mr_stores y where y.env = 'live' and y.store_id = any(v_ids) order by y.store_id for update;
 for s in select * from jsonb_array_elements(p->'stores') loop
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  if coalesce(st.am_version, 0) <> public.mr_ver(s->'expect_version') then raise exception 'conflict'; end if;
 end loop;
 for s in select * from jsonb_array_elements(p->'stores') loop
  v_am := nullif(s->>'am_user','')::uuid;
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  if st.store_id is not null then
   update public.mr_stores set name = s->>'name', am_user = v_am, sort = coalesce((s->>'sort')::integer, 0), active = coalesce((s->>'active')::boolean, true),
     updated_at = now(), updated_by = m.user_id::text
    where env = 'live' and store_id = st.store_id returning am_version into v_ver;
  else
   -- Not saved yet when the screen read it: saved now at version 1, unless someone else saved it meanwhile (then conflict).
   insert into public.mr_stores(env, store_id, name, am_user, sort, active, am_version, updated_at, updated_by)
    values('live', s->>'store_id', s->>'name', v_am, coalesce((s->>'sort')::integer, 0), coalesce((s->>'active')::boolean, true), 1, now(), m.user_id::text)
    on conflict (env, store_id) do nothing returning am_version into v_ver;
   if v_ver is null then raise exception 'conflict'; end if;
  end if;
  v_out := v_out || jsonb_build_array(jsonb_build_object('store_id', s->>'store_id', 'version', v_ver));
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'live', m.user_id::text, 'stores', p->'stores');
 return jsonb_build_object('saved', n, 'stores', v_out);
end $$;

-- ---------------------------------------------------------------- 6) only the service role runs these
do $$ declare f text; begin
 foreach f in array array['mr_settings_bump()','mr_stores_bump()','mr_ver(jsonb)','mr_whoami(jsonb)','mr_settings_save(jsonb)','mr_access_get(jsonb)','mr_access_save(jsonb)','mr_stores_save(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
