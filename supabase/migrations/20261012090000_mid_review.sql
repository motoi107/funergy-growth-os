-- 中間レビュー（mid-month review）, private edition for CEO / GM / AM.
-- All tables are service-role only. Browsers never read or write them directly:
-- the mid-review Edge Function checks the person's Supabase Auth sign-in, then the
-- people table here (mr_members) decides the role and, for an AM, the stores.
-- Nothing here reads or changes PL, sales, budgets, attendance, tasks or evaluations.
-- Store publication and outside notices stay off in this edition (mr_settings 'flags').
-- It also reads (never writes) the shared employee and store masters (employees, stores), only to take access away:
-- an AM who is no longer an AM in the employee master, or no longer the AM in the store master's AM column, is refused.

create table public.mr_settings(
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now(),
 updated_by text
);

-- Who can use the feature. Added by SQL (Moto); the app never adds a person.
create table public.mr_members(
 user_id uuid primary key,
 emp_id text,
 name text,
 role text not null check (role in ('ceo','gm','am')),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 updated_by text
);

-- Stores per environment. live: the AM in charge as a GM confirmed it (copied from the
-- store master's AM column, never widened). demo: fictional stores with fictional numbers.
create table public.mr_stores(
 env text not null check (env in ('live','demo')),
 store_id text not null check (store_id ~ '^[A-Za-z0-9-]{1,24}$'),
 name text not null check (length(name) between 1 and 60),
 am_user uuid references public.mr_members(user_id),
 am_name text check (am_name is null or length(am_name) <= 60),
 sort integer not null default 0,
 active boolean not null default true,
 demo jsonb not null default '{}',
 updated_at timestamptz not null default now(),
 updated_by text,
 primary key(env, store_id),
 check (env = 'demo' or (am_name is null and demo = '{}'::jsonb))
);

-- One review per store × month × environment.
create table public.mr_reviews(
 id uuid primary key default gen_random_uuid(),
 env text not null check (env in ('live','demo')),
 store_id text not null,
 ym text not null check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 status text not null default 'draft' check (status in ('draft','submitted','followup','decision','consult','done')),
 decision_by text check (decision_by in ('gm','ceo','both')),
 body jsonb not null default '{}',
 deadlines jsonb not null default '{}',
 consult jsonb,
 next_actor text,
 next_due date,
 version integer not null default 1,
 submitted_no integer not null default 0,
 submitted_at timestamptz,
 done_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by text,
 unique(env, store_id, ym),
 foreign key (env, store_id) references public.mr_stores(env, store_id)
);

-- Each submission keeps what the store manager wrote and the numbers they saw.
create table public.mr_submissions(
 review_id uuid not null references public.mr_reviews(id) on delete cascade,
 no integer not null check (no >= 1),
 body jsonb not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 created_by text,
 primary key(review_id, no)
);

-- Management replies: one row per person and item, so nobody overwrites another person's reply.
create table public.mr_replies(
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.mr_reviews(id) on delete cascade,
 target text not null check (target ~ '^[a-z]+(:[A-Za-z0-9_-]{1,40})?$'),
 author uuid,
 author_name text,
 author_role text check (author_role in ('ceo','gm','am')),
 decision text check (decision in ('as_proposed','modify','followup','escalate','consult','no_action')),
 escalate_to text check (escalate_to in ('gm','ceo')),
 data jsonb not null default '{}',
 state text not null default 'draft' check (state in ('draft','sent')),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 sent_at timestamptz
);
create index mr_replies_review on public.mr_replies(review_id);

create table public.mr_events(
 id bigserial primary key,
 review_id uuid references public.mr_reviews(id) on delete cascade,
 env text,
 at timestamptz not null default now(),
 actor text not null,
 kind text not null,
 data jsonb not null default '{}'
);
create index mr_events_review on public.mr_events(review_id);

do $$ declare t text; begin
 foreach t in array array['mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update, delete on public.%I to service_role', t);
 end loop;
end $$;
revoke all on sequence public.mr_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.mr_events_id_seq to service_role;

-- Off until a GM or CEO turns the private check on. Store publication and notices cannot be turned on in this edition.
insert into public.mr_settings(key, value) values
 ('flags', jsonb_build_object('private', false, 'store_publish', false, 'notify', false)),
 ('schedule', jsonb_build_object('submit_day', 15, 'reply_day', 17, 'decide_day', 19, 'consult_from', 20, 'consult_to', 22)),
 ('demo', jsonb_build_object('ym', '2026-10', 'now', '2026-10-18T18:15:00Z'))
on conflict (key) do nothing;

-- CEO and GM who already sign in with email (manager_auth) can use the feature. AMs are added by SQL (Moto).
insert into public.mr_members(user_id, emp_id, role, updated_by)
 select user_id, nullif(emp_id::text, ''), role, 'setup' from public.manager_auth where role in ('ceo','gm')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- helpers
create function public.mr_setting(p_key text) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce((select value from public.mr_settings where key=p_key), '{}'::jsonb);
$$;

-- The shared masters can be changed from the app, so they are used only to refuse, never to let anyone in.
-- An AM must still be an AM (and not 退職) in the employee master.
create function public.mr_am_hr_ok(p_emp text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_emp, '') <> '' and exists(select 1 from public.employees e
  where e.id::text = p_emp and e.role = 'am' and coalesce(e.status, '') <> '退職');
$$;

-- The store master's AM column must still name this AM (the app's own rule for an AM's stores, myAmStores: same name).
-- When the store master moves a store to another AM, the old AM loses it at once; the new AM gets it after a GM saves.
create function public.mr_am_master_ok(p_user uuid, p_store text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.mr_members m
  join public.employees e on e.id::text = m.emp_id
  join public.stores st on st.id::text = p_store
  where m.user_id = p_user and coalesce(e.name, '') <> '' and st.am = e.name);
$$;

-- The signed-in person, if they may use the feature with one of these roles. p_enabled: also require the private check to be on.
-- A CEO / GM must also still be CEO / GM in manager_auth: taking someone off there takes them off here at once.
-- An AM must also still be an AM in the employee master (not 退職, not moved to another role such as G4).
create function public.mr_auth(p_actor uuid, p_roles text[], p_enabled boolean) returns public.mr_members
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members;
begin
 if p_actor is null then raise exception 'actor_required'; end if;
 select * into m from public.mr_members where user_id=p_actor and enabled;
 if m.user_id is null or not (m.role = any(p_roles)) then raise exception 'forbidden'; end if;
 if m.role in ('ceo','gm') and not exists(select 1 from public.manager_auth a where a.user_id=m.user_id and a.role in ('ceo','gm')) then raise exception 'forbidden'; end if;
 if m.role = 'am' and not public.mr_am_hr_ok(m.emp_id) then raise exception 'forbidden'; end if;
 if p_enabled and coalesce((public.mr_setting('flags')->>'private')::boolean, false) is not true then raise exception 'disabled'; end if;
 return m;
end $$;

-- Whether this person may see this store's reviews. demo: every member sees the fictional stores.
-- live: an AM needs both the GM-confirmed copy (mr_stores.am_user) and the store master's AM column (never wider than the app).
create function public.mr_sees(p_role text, p_user uuid, p_env text, p_am_user uuid, p_store text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select p_env = 'demo' or p_role in ('ceo','gm')
  or (p_role = 'am' and p_am_user is not null and p_am_user = p_user and public.mr_am_master_ok(p_user, p_store));
$$;

create function public.mr_event(p_review uuid, p_env text, p_actor text, p_kind text, p_data jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.mr_events(review_id, env, actor, kind, data) values(p_review, p_env, coalesce(p_actor,'system'), p_kind, coalesce(p_data,'{}'));
$$;

create function public.mr_arr(p jsonb) returns jsonb
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when jsonb_typeof(p)='array' then p else '[]'::jsonb end;
$$;

-- What the list needs from one review (no free text from the store manager except titles of what waits for a decision).
create function public.mr_summary(r public.mr_reviews) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'id', r.id, 'store_id', r.store_id, 'ym', r.ym, 'status', r.status, 'decision_by', r.decision_by,
  'next_actor', r.next_actor, 'next_due', r.next_due, 'deadlines', r.deadlines, 'consult', r.consult,
  'version', r.version, 'submitted_no', r.submitted_no, 'submitted_at', r.submitted_at, 'done_at', r.done_at,
  'updated_at', r.updated_at, 'updated_by', r.updated_by,
  'reporter', r.body->>'reporter',
  'consult_state', r.body->>'consult',
  'done_reason', r.body->>'done_reason',
  'focus', coalesce((select jsonb_object_agg(st, n) from (
     select coalesce(f->>'status','none') st, count(*) n from jsonb_array_elements(public.mr_arr(r.body->'focus')) f group by 1) x), '{}'::jsonb),
  'issues', jsonb_array_length(public.mr_arr(r.body->'issues')),
  'severity', (select case max(case i->>'severity' when 'high' then 2 when 'watch' then 1 when 'none' then 0 end)
     when 2 then 'high' when 1 then 'watch' when 0 then 'none' end from jsonb_array_elements(public.mr_arr(r.body->'issues')) i),
  'direct', exists(select 1 from jsonb_array_elements(public.mr_arr(r.body->'issues')) i where (i->>'direct')::boolean is true),
  'urgent', exists(select 1 from jsonb_array_elements(public.mr_arr(r.body->'issues')) i where (i->>'urgent')::boolean is true),
  'pl_state', (select s.snapshot->'pl'->>'state' from public.mr_submissions s where s.review_id=r.id order by s.no desc limit 1),
  'waits', (select coalesce(jsonb_agg(jsonb_build_object('kind', p.decision, 'to', p.escalate_to, 'title', p.data->>'title',
       'due', p.data->>'due', 'severity', p.data->>'severity', 'by', p.author_name) order by p.sent_at), '[]'::jsonb)
     from public.mr_replies p where p.review_id=r.id and p.state='sent' and p.decision in ('escalate','followup','consult')
      and coalesce((p.data->>'resolved')::boolean, false) is not true)
 );
$$;

-- ---------------------------------------------------------------- API (called only by the mid-review Edge Function)
create function public.mr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], false);
begin
 return jsonb_build_object('role', m.role, 'emp_id', m.emp_id, 'name', m.name,
  'flags', public.mr_setting('flags'), 'schedule', public.mr_setting('schedule'), 'demo', public.mr_setting('demo'),
  -- Nothing about stores while the private check is off.
  'live_stores', case when coalesce((public.mr_setting('flags')->>'private')::boolean, false) is not true then '[]'::jsonb else
    (select coalesce(jsonb_agg(s.store_id order by s.sort, s.store_id), '[]'::jsonb) from public.mr_stores s
     where s.env='live' and s.active and public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id)) end);
end $$;

create function public.mr_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym';
begin
 if v_env is null or v_env not in ('live','demo') then raise exception 'bad_value'; end if;
 if v_ym is null or v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 return jsonb_build_object('env', v_env, 'ym', v_ym,
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id', s.store_id, 'name', s.name,
       'am_name', coalesce(am.name, s.am_name), 'am_user', s.am_user, 'am_emp_id', am.emp_id, 'am_unset', (s.am_user is null and s.am_name is null),
       'mine', (s.am_user is not null and s.am_user = m.user_id), 'sort', s.sort,
       -- live, GM / CEO: false when the saved AM cannot see the store now (stopped, not an AM in the employee master, or the
       -- store master names someone else). The GM then checks the store and saves the AM again.
       'am_ok', case when s.env <> 'live' or s.am_user is null or m.role = 'am' then null
         else coalesce(am.enabled, false) and public.mr_am_hr_ok(am.emp_id) and public.mr_am_master_ok(s.am_user, s.store_id) end,
       'demo', case when s.env='demo' then s.demo else null end) order by s.sort, s.store_id), '[]'::jsonb)
     from public.mr_stores s left join public.mr_members am on am.user_id=s.am_user
     where s.env=v_env and s.active and public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id)),
  'reviews', (select coalesce(jsonb_agg(public.mr_summary(r) order by r.store_id), '[]'::jsonb)
     from public.mr_reviews r join public.mr_stores s on s.env=r.env and s.store_id=r.store_id
     where r.env=v_env and r.ym=v_ym and s.active and public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id)));
end $$;

-- GM / CEO: the on/off switches and the month's schedule. Works while the private check is off (to turn it on).
create function public.mr_settings_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], false);
 k text := p->>'key'; v jsonb := p->'value'; d text; prev integer := 0;
begin
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 if k = 'flags' then
  if jsonb_typeof(v->'private') is distinct from 'boolean' then raise exception 'bad_value'; end if;
  -- This edition never publishes to stores and never sends notices.
  if coalesce((v->>'store_publish')::boolean, false) or coalesce((v->>'notify')::boolean, false) then raise exception 'not_available'; end if;
  v := jsonb_build_object('private', (v->>'private')::boolean, 'store_publish', false, 'notify', false);
 elsif k = 'schedule' then
  foreach d in array array['submit_day','reply_day','decide_day','consult_from','consult_to'] loop
   if jsonb_typeof(v->d) is distinct from 'number' or (v->>d) !~ '^[0-9]{1,2}$' or (v->>d)::integer < 1 or (v->>d)::integer > 28 or (v->>d)::integer < prev then
    raise exception 'bad_value'; end if;
   prev := (v->>d)::integer;
  end loop;
  v := jsonb_build_object('submit_day', (v->>'submit_day')::integer, 'reply_day', (v->>'reply_day')::integer, 'decide_day', (v->>'decide_day')::integer,
   'consult_from', (v->>'consult_from')::integer, 'consult_to', (v->>'consult_to')::integer);
 else raise exception 'bad_key'; end if;
 insert into public.mr_settings(key, value, updated_at, updated_by) values(k, v, now(), m.user_id::text)
  on conflict (key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by;
 perform public.mr_event(null, null, m.user_id::text, 'settings', jsonb_build_object('key', k, 'value', v));
 return jsonb_build_object('key', k, 'value', v);
end $$;

-- GM / CEO: who has access (read only here; people are added by SQL).
create function public.mr_members_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], false);
begin
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'emp_id', x.emp_id, 'name', x.name, 'role', x.role, 'enabled', x.enabled)
   order by x.role, x.name), '[]'::jsonb) from public.mr_members x);
end $$;

-- GM / CEO: the live stores and the AM in charge (confirmed by a GM from the store master; an AM must be an enabled member).
create function public.mr_stores_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; v_am uuid; n integer := 0;
begin
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_array_length(p->'stores') > 60 then raise exception 'bad_value'; end if;
 for s in select * from jsonb_array_elements(p->'stores') loop
  if (s->>'store_id') is null or (s->>'store_id') !~ '^[A-Za-z0-9-]{1,24}$' or coalesce(length(s->>'name'),0) not between 1 and 60 then raise exception 'bad_value'; end if;
  if nullif(s->>'am_user','') is not null and (s->>'am_user') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  if (s->'sort') is not null and jsonb_typeof(s->'sort') <> 'null' and (jsonb_typeof(s->'sort') <> 'number' or (s->>'sort') !~ '^[0-9]{1,4}$') then raise exception 'bad_value'; end if;
  if (s->'active') is not null and jsonb_typeof(s->'active') not in ('boolean','null') then raise exception 'bad_value'; end if;
  v_am := nullif(s->>'am_user','')::uuid;
  if v_am is not null and not exists(select 1 from public.mr_members x where x.user_id=v_am and x.enabled and x.role='am' and public.mr_am_hr_ok(x.emp_id)) then raise exception 'bad_value'; end if;
  insert into public.mr_stores(env, store_id, name, am_user, sort, active, updated_at, updated_by)
   values('live', s->>'store_id', s->>'name', v_am, coalesce((s->>'sort')::integer, 0), coalesce((s->>'active')::boolean, true), now(), m.user_id::text)
   on conflict (env, store_id) do update set name=excluded.name, am_user=excluded.am_user, sort=excluded.sort, active=excluded.active,
    updated_at=now(), updated_by=excluded.updated_by;
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'live', m.user_id::text, 'stores', p->'stores');
 return jsonb_build_object('saved', n);
end $$;

-- GM / CEO: make the demo again (fictional stores only; nothing outside env 'demo' is touched).
create function public.mr_demo_reset(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 s jsonb; r jsonb; x jsonb; v_id uuid; n integer := 0;
begin
 if jsonb_typeof(p->'stores') is distinct from 'array' or jsonb_typeof(p->'reviews') is distinct from 'array' then raise exception 'bad_value'; end if;
 delete from public.mr_reviews where env='demo';
 delete from public.mr_stores where env='demo';
 for s in select * from jsonb_array_elements(p->'stores') loop
  insert into public.mr_stores(env, store_id, name, am_name, sort, demo, updated_by)
   values('demo', s->>'store_id', s->>'name', nullif(s->>'am_name',''), coalesce((s->>'sort')::integer,0), coalesce(s->'demo','{}'), m.user_id::text);
 end loop;
 for r in select * from jsonb_array_elements(p->'reviews') loop
  insert into public.mr_reviews(env, store_id, ym, status, decision_by, body, deadlines, consult, next_actor, next_due, submitted_no, submitted_at, done_at, updated_at, updated_by)
   values('demo', r->>'store_id', r->>'ym', r->>'status', r->>'decision_by', coalesce(r->'body','{}'), coalesce(r->'deadlines','{}'), r->'consult',
    r->>'next_actor', nullif(r->>'next_due','')::date, coalesce((r->>'submitted_no')::integer,0), nullif(r->>'submitted_at','')::timestamptz,
    nullif(r->>'done_at','')::timestamptz, coalesce(nullif(r->>'updated_at','')::timestamptz, now()), r->>'updated_by')
   returning id into v_id;
  for x in select * from jsonb_array_elements(public.mr_arr(r->'submissions')) loop
   insert into public.mr_submissions(review_id, no, body, snapshot, created_at, created_by)
    values(v_id, (x->>'no')::integer, coalesce(x->'body', r->'body', '{}'), coalesce(x->'snapshot','{}'), coalesce(nullif(x->>'at','')::timestamptz, now()), x->>'by');
  end loop;
  for x in select * from jsonb_array_elements(public.mr_arr(r->'replies')) loop
   insert into public.mr_replies(review_id, target, author_name, author_role, decision, escalate_to, data, state, sent_at, created_at, updated_at)
    values(v_id, x->>'target', x->>'author_name', x->>'author_role', x->>'decision', x->>'escalate_to', coalesce(x->'data','{}'),
     coalesce(x->>'state','sent'), nullif(x->>'sent_at','')::timestamptz, now(), now());
  end loop;
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'demo', m.user_id::text, 'demo_reset', jsonb_build_object('reviews', n));
 return jsonb_build_object('stores', jsonb_array_length(p->'stores'), 'reviews', n);
end $$;

do $$ declare f text; begin
 foreach f in array array['mr_setting(text)','mr_auth(uuid,text[],boolean)','mr_sees(text,uuid,text,uuid,text)','mr_am_hr_ok(text)','mr_am_master_ok(uuid,text)','mr_event(uuid,text,text,text,jsonb)',
  'mr_arr(jsonb)','mr_summary(public.mr_reviews)','mr_whoami(jsonb)','mr_list(jsonb)','mr_settings_save(jsonb)','mr_members_list(jsonb)',
  'mr_stores_save(jsonb)','mr_demo_reset(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
