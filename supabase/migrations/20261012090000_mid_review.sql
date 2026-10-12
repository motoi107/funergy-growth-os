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
 -- The submitted version the reply was written on (each save of a draft, and the send). A decision counts only while its
 -- item is unchanged (and after any answer to a question on it).
 sub_no integer,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 sent_at timestamptz
);
create index mr_replies_review on public.mr_replies(review_id);
-- One draft per person and item (saving again updates it; sending turns it into a sent reply and a new draft can start).
create unique index mr_replies_draft on public.mr_replies(review_id, author, target) where state = 'draft';

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

-- Empty as the screen sees it (JavaScript trim: spaces, tabs, line breaks, full-width and no-break spaces).
create function public.mr_blank(t text) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce(t, '') ~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$';
$$;

-- A real calendar date written YYYY-MM-DD in 2000–2099 (11-31, 02-30 and 0026 are not). The screen and the function check the same.
create function public.mr_date_ok(t text) returns boolean
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if t is null or t !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then return false; end if;
 perform t::date;
 return true;
exception when others then return false;
end $$;

-- What the managers read: the latest submitted version (the store manager's working copy may already be ahead of it).
create function public.mr_view_body(r public.mr_reviews) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce((select s.body from public.mr_submissions s where s.review_id = r.id order by s.no desc limit 1),
  -- Not submitted yet: only who reports (and the demo's own done reason). The draft itself is not shown.
  jsonb_strip_nulls(jsonb_build_object('reporter', r.body->'reporter', 'reporter_role', r.body->'reporter_role', 'done_reason', r.body->'done_reason')));
$$;

-- A person's name for records (members added from manager_auth have no name: take it from the employee master).
create function public.mr_actor_name(m public.mr_members) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(nullif(m.name, ''), (select e.name from public.employees e where e.id::text = m.emp_id), upper(m.role));
$$;

-- What the list needs from one review (no free text from the store manager except titles of what waits for a decision).
create function public.mr_summary(r public.mr_reviews) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with b as (select public.mr_view_body(r) v)
 select jsonb_build_object(
  'id', r.id, 'store_id', r.store_id, 'ym', r.ym, 'status', r.status, 'decision_by', r.decision_by,
  'next_actor', r.next_actor, 'next_due', r.next_due, 'deadlines', r.deadlines, 'consult', r.consult,
  'version', r.version, 'submitted_no', r.submitted_no, 'submitted_at', r.submitted_at, 'done_at', r.done_at,
  'updated_at', r.updated_at, 'updated_by', r.updated_by,
  'reporter', b.v->>'reporter',
  'reporter_role', b.v->>'reporter_role',
  'consult_state', b.v->>'consult',
  'done_reason', coalesce(b.v->>'done_reason', (select p.data->>'reason' from public.mr_replies p where p.review_id = r.id and p.target = 'summary'
     and p.decision = 'no_action' and p.state = 'sent' order by p.sent_at desc limit 1)),
  'focus', coalesce((select jsonb_object_agg(st, n) from (
     select coalesce(f->>'status','none') st, count(*) n from jsonb_array_elements(public.mr_arr(b.v->'focus')) f group by 1) x), '{}'::jsonb),
  'issues', jsonb_array_length(public.mr_arr(b.v->'issues')),
  'severity', (select case max(case i->>'severity' when 'high' then 2 when 'watch' then 1 when 'none' then 0 end)
     when 2 then 'high' when 1 then 'watch' when 0 then 'none' end from jsonb_array_elements(public.mr_arr(b.v->'issues')) i),
  'direct', exists(select 1 from jsonb_array_elements(public.mr_arr(b.v->'issues')) i where (i->>'direct')::boolean is true),
  'urgent', exists(select 1 from jsonb_array_elements(public.mr_arr(b.v->'issues')) i where (i->>'urgent')::boolean is true),
  'pl_state', (select s.snapshot->'pl'->>'state' from public.mr_submissions s where s.review_id=r.id order by s.no desc limit 1),
  'waits', (select coalesce(jsonb_agg(jsonb_build_object('kind', p.decision, 'to', p.escalate_to, 'title', p.data->>'title',
       'due', p.data->>'due', 'severity', p.data->>'severity', 'by', p.author_name) order by p.sent_at), '[]'::jsonb)
     from public.mr_replies p where p.review_id=r.id and p.state='sent' and p.decision in ('escalate','followup','consult')
      and coalesce((p.data->>'resolved')::boolean, false) is not true)
 ) from b;
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
   insert into public.mr_replies(review_id, target, author_name, author_role, decision, escalate_to, data, state, sent_at, sub_no, created_at, updated_at)
    values(v_id, x->>'target', x->>'author_name', x->>'author_role', x->>'decision', x->>'escalate_to', coalesce(x->'data','{}'),
     coalesce(x->>'state','sent'), nullif(x->>'sent_at','')::timestamptz, coalesce(nullif(x->>'sub_no','')::integer, nullif(r->>'submitted_no','')::integer), now(), now());
  end loop;
  n := n + 1;
 end loop;
 perform public.mr_event(null, 'demo', m.user_id::text, 'demo_reset', jsonb_build_object('reviews', n));
 return jsonb_build_object('stores', jsonb_array_length(p->'stores'), 'reviews', n);
end $$;

-- ---------------------------------------------------------------- 段階 2-2: one store's page and the store manager's input
-- What is still missing before a submission can go (the screen checks the same; this is the backstop).
-- snap: the numbers the reporter saw (judgements as the screen showed them with the meeting tab's thresholds).
create function public.mr_missing(b jsonb, snap jsonb) returns jsonb
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare out jsonb := '[]'; x jsonb; k text; v jsonb;
 nz text[] := array[]::text[];
begin
 if coalesce(b->>'consult','') not in ('yes','none') then out := out || '["consult"]'; end if;
 if b->>'consult' = 'yes' and jsonb_array_length(public.mr_arr(b->'issues')) = 0 then out := out || '["issues"]'; end if;
 for x in select * from jsonb_array_elements(case when b->>'consult' = 'yes' then public.mr_arr(b->'issues') else '[]'::jsonb end) loop
  if public.mr_blank(x->>'what') or public.mr_blank(x->>'action') or coalesce(x->>'severity','') not in ('none','watch','high')
     or (case when (x->>'investigating')::boolean is true
          then public.mr_blank(x->>'inv_check') or public.mr_blank(x->>'inv_owner') or coalesce(x->>'inv_date','') = ''
          else public.mr_blank(x->>'cause') end)
  then out := out || jsonb_build_array('issue:' || coalesce(x->>'id','?')); end if;
 end loop;
 for x in select * from jsonb_array_elements(public.mr_arr(b->'focus')) loop
  if coalesce(x->>'status','none') not in ('ok','late','help','done')
     or (x->>'status' = 'late' and (public.mr_blank(x->>'reason') or public.mr_blank(x->>'next') or public.mr_blank(x->>'next_owner') or coalesce(x->>'next_due','') = ''))
     or (x->>'status' = 'help' and (public.mr_blank(x->>'help_what') or coalesce(x->>'help_by','') = ''))
  then out := out || jsonb_build_array('focus:' || coalesce(x->>'id','?')); end if;
 end loop;
 for k, v in select * from jsonb_each(case when jsonb_typeof(snap->'kpi') = 'object' then snap->'kpi' else '{}' end) loop
  if v->>'judge' = 'miss' and public.mr_blank(b->'kpi'->k->>'comment') then out := out || jsonb_build_array('kpi:' || k); end if;
 end loop;
 for k, v in select * from jsonb_each(case when jsonb_typeof(snap->'pl'->'rows') = 'object' then snap->'pl'->'rows' else '{}' end) loop
  if v->>'judge' in ('warn','miss') and not (public.mr_arr(snap->'pl'->'checked') ? k)
     and (public.mr_blank(b->'pl'->k->>'cause') or public.mr_blank(b->'pl'->k->>'plan'))
  then out := out || jsonb_build_array('pl:' || k); end if;
 end loop;
 return out;
end $$;

-- One store's page: the review, every submitted version with the numbers seen then, replies and the history.
create function public.mr_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym'; v_store text := p->>'store_id';
 s public.mr_stores; r public.mr_reviews; am public.mr_members;
begin
 if v_env is null or v_env not in ('live','demo') or v_ym is null or v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or v_store is null or v_store !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 select * into s from public.mr_stores where env = v_env and store_id = v_store and active;
 if s.store_id is null or not public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id) then raise exception 'not_found'; end if;
 select * into am from public.mr_members where user_id = s.am_user;
 select * into r from public.mr_reviews where env = v_env and store_id = v_store and ym = v_ym;
 return jsonb_build_object('env', v_env, 'ym', v_ym,
  'store', jsonb_build_object('store_id', s.store_id, 'name', s.name, 'am_name', coalesce(public.mr_actor_name(am), s.am_name),
    'am_emp_id', am.emp_id, 'am_unset', (s.am_user is null and s.am_name is null), 'demo', case when s.env = 'demo' then s.demo else null end),
  'review', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'decision_by', r.decision_by,
    -- The working copy goes only where it can be written from this screen (the demo). Live: what was submitted.
    'body', case when r.env = 'demo' then r.body else public.mr_view_body(r) end,
    'deadlines', r.deadlines, 'consult', r.consult, 'next_actor', r.next_actor, 'next_due', r.next_due, 'version', r.version,
    'submitted_no', r.submitted_no, 'submitted_at', r.submitted_at, 'done_at', r.done_at, 'created_at', r.created_at,
    'updated_at', r.updated_at, 'updated_by', r.updated_by,
    'unsubmitted', r.submitted_no > 0 and r.body is distinct from public.mr_view_body(r),
    'required', case when r.submitted_no > 0 then to_jsonb(public.mr_required_targets(r)) else '[]'::jsonb end,
    'final', case when r.submitted_no > 0 then (select coalesce(jsonb_object_agg(t, public.mr_target_final(r.id, t)), '{}'::jsonb) from unnest(public.mr_required_targets(r)) t) else '{}'::jsonb end) end,
  -- The items that changed since the version a page was showing (its drafts are checked again before they are saved).
  'changed_since', case when r.id is not null and coalesce(p->>'since','') ~ '^[0-9]{1,6}$' and (p->>'since')::integer < r.submitted_no then
    (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from unnest(public.mr_targets_at(r.id, (p->>'since')::integer) || public.mr_targets_at(r.id, r.submitted_no)) t
      where public.mr_reply_outdated(r.id, (p->>'since')::integer, t)) else '[]'::jsonb end,
  'submissions', (select coalesce(jsonb_agg(jsonb_build_object('no', x.no, 'body', x.body, 'snapshot', x.snapshot, 'at', x.created_at, 'by', x.created_by) order by x.no), '[]'::jsonb)
    from public.mr_submissions x where x.review_id = r.id),
  -- Sent replies for everyone who sees the store; drafts only for their author.
  'replies', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'target', x.target, 'author_name', x.author_name, 'author_role', x.author_role,
      'decision', x.decision, 'escalate_to', x.escalate_to, 'data', x.data, 'state', x.state, 'version', x.version, 'sent_at', x.sent_at,
      'updated_at', x.updated_at, 'mine', x.author = m.user_id, 'sub_no', x.sub_no,
      -- Sent on an older version whose item has changed since (the decision no longer counts) / an item the latest version no longer has.
      'changed', r.submitted_no > 0 and public.mr_reply_outdated(r.id, x.sub_no, x.target),
      'gone', x.target ~ '^(issue|focus):' and public.mr_item_at(r.id, r.submitted_no, x.target) is null) order by x.created_at), '[]'::jsonb)
    from public.mr_replies x where x.review_id = r.id and (x.state = 'sent' or x.author = m.user_id)),
  'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'data', e.data) order by e.id), '[]'::jsonb)
    from (select * from public.mr_events e where e.review_id = r.id order by e.id desc limit 200) e));
end $$;

-- The store manager's working copy (draft). This edition: demo stores only (live waits for store publication).
-- Versioned: a save made on an older version is refused (conflict), so nobody overwrites someone else's newer save.
-- Items fixed at the start of the month (focus with fixed=true) keep their title, owner, condition and original due date.
create function public.mr_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym'; v_store text := p->>'store_id';
 v_body jsonb := p->'body'; v_exp integer; s public.mr_stores; r public.mr_reviews; v_name text := public.mr_actor_name(m);
 v_dl jsonb; sch jsonb; f jsonb; o jsonb; v_focus jsonb := '[]';
begin
 if v_env is null or v_env not in ('live','demo') or v_ym is null or v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or v_store is null or v_store !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(v_body) is distinct from 'object' or length(v_body::text) > 60000 then raise exception 'bad_value'; end if;
 if (p->'expect_version') is not null and jsonb_typeof(p->'expect_version') not in ('number','null') then raise exception 'bad_value'; end if;
 if v_env = 'live' and coalesce((public.mr_setting('flags')->>'store_publish')::boolean, false) is not true then raise exception 'not_available'; end if;
 select * into s from public.mr_stores where env = v_env and store_id = v_store and active;
 if s.store_id is null or not public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id) then raise exception 'not_found'; end if;
 v_exp := case when jsonb_typeof(p->'expect_version') = 'number' and (p->>'expect_version') ~ '^[0-9]{1,6}$' then (p->>'expect_version')::integer else null end;
 select * into r from public.mr_reviews where env = v_env and store_id = v_store and ym = v_ym for update;
 if r.id is null then
  if coalesce(v_exp, 0) <> 0 then raise exception 'conflict'; end if;
  sch := public.mr_setting('schedule');
  v_dl := jsonb_build_object('submit', v_ym || '-' || lpad(coalesce(sch->>'submit_day','15'), 2, '0'), 'reply', v_ym || '-' || lpad(coalesce(sch->>'reply_day','17'), 2, '0'),
   'decide', v_ym || '-' || lpad(coalesce(sch->>'decide_day','19'), 2, '0'), 'consult_from', v_ym || '-' || lpad(coalesce(sch->>'consult_from','20'), 2, '0'),
   'consult_to', v_ym || '-' || lpad(coalesce(sch->>'consult_to','22'), 2, '0'));
  begin
   insert into public.mr_reviews(env, store_id, ym, status, body, deadlines, next_actor, next_due, updated_by)
    values(v_env, v_store, v_ym, 'draft', v_body, v_dl, coalesce(nullif(v_body->>'reporter',''), '店長'), (v_dl->>'submit')::date, v_name)
    returning * into r;
  exception when unique_violation then raise exception 'conflict';
  end;
  perform public.mr_event(r.id, v_env, m.user_id::text, 'create', jsonb_build_object('by', v_name));
  return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'updated_at', r.updated_at);
 end if;
 if v_exp is null or v_exp <> r.version then raise exception 'conflict'; end if;
 if r.status not in ('draft','submitted','followup') then raise exception 'locked'; end if;
 for f in select * from jsonb_array_elements(public.mr_arr(v_body->'focus')) loop
  select x into o from jsonb_array_elements(public.mr_arr(r.body->'focus')) x where x->>'id' = f->>'id' limit 1;
  if o is not null and (o->>'fixed')::boolean is true then
   f := f || jsonb_build_object('title', o->'title', 'owner', o->'owner', 'done_cond', o->'done_cond', 'due_orig', o->'due_orig', 'fixed', true);
  elsif o is null then
   f := f - 'fixed';
  end if;
  v_focus := v_focus || jsonb_build_array(f);
 end loop;
 -- Items fixed at the start of the month cannot be removed here.
 for o in select * from jsonb_array_elements(public.mr_arr(r.body->'focus')) loop
  if (o->>'fixed')::boolean is true and not exists(select 1 from jsonb_array_elements(v_focus) x where x->>'id' = o->>'id') then v_focus := v_focus || jsonb_build_array(o); end if;
 end loop;
 v_body := jsonb_set(v_body, '{focus}', v_focus);
 update public.mr_reviews set body = v_body, version = version + 1, updated_at = now(), updated_by = v_name where id = r.id returning * into r;
 return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'updated_at', r.updated_at);
end $$;

-- Submit the saved working copy as a new submitted version, with the numbers the reporter saw.
-- draft → AM 返信待ち; 追加確認 → AM 返信待ち again (re-answer); AM 返信待ち → AM 返信待ち (corrected before the AM replied).
-- The previous versions stay. Who pressed it is recorded (in the demo, the CEO / GM / AM trying the store manager's screen).
create function public.mr_submit(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 v_env text := p->>'env'; v_ym text := p->>'ym'; v_store text := p->>'store_id'; v_snap jsonb := p->'snapshot';
 s public.mr_stores; r public.mr_reviews; am public.mr_members; v_name text := public.mr_actor_name(m); v_exp integer; v_miss jsonb; v_prev text;
begin
 if v_env is null or v_env not in ('live','demo') or v_ym is null or v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or v_store is null or v_store !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(v_snap) is distinct from 'object' or length(v_snap::text) > 30000 then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'expect_version') is distinct from 'number' or (p->>'expect_version') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 v_exp := (p->>'expect_version')::integer;
 if v_env = 'live' and coalesce((public.mr_setting('flags')->>'store_publish')::boolean, false) is not true then raise exception 'not_available'; end if;
 select * into s from public.mr_stores where env = v_env and store_id = v_store and active;
 if s.store_id is null or not public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id) then raise exception 'not_found'; end if;
 select * into r from public.mr_reviews where env = v_env and store_id = v_store and ym = v_ym for update;
 if r.id is null then raise exception 'not_found'; end if;
 if v_exp <> r.version then raise exception 'conflict'; end if;
 if r.status not in ('draft','submitted','followup') then raise exception 'locked'; end if;
 -- Nothing changed since the last submitted version: no new version (pressed twice, or a lost answer retried).
 if r.status = 'submitted' and r.submitted_no > 0 and r.body = public.mr_view_body(r) then raise exception 'unchanged'; end if;
 -- The numbers seen: this month's KPIs, last month's PL.
 if coalesce(v_snap->'period'->>'from','') <> v_ym || '-01' or (coalesce(v_snap->'period'->>'to','') <> '' and left(v_snap->'period'->>'to', 7) <> v_ym)
    or jsonb_typeof(v_snap->'kpi') is distinct from 'object' or jsonb_typeof(v_snap->'pl') is distinct from 'object'
    or coalesce(v_snap->'pl'->>'ym','') <> to_char((v_ym || '-01')::date - interval '1 month', 'YYYY-MM') then raise exception 'bad_value'; end if;
 -- Demo: the numbers are the server's own fictional ones (the screen's judgements use the meeting tab's thresholds).
 if v_env = 'demo' then
  if exists(select 1 from jsonb_each(coalesce(s.demo->'kpi','{}')) d where not (v_snap->'kpi' ? d.key)
      or (v_snap->'kpi'->d.key->'act') is distinct from coalesce(d.value->'act','null'::jsonb) or (v_snap->'kpi'->d.key->'tgt') is distinct from coalesce(d.value->'tgt','null'::jsonb))
   or exists(select 1 from jsonb_each(coalesce(s.demo->'pl'->'rows','{}')) d where not (v_snap->'pl'->'rows' ? d.key)
      or (v_snap->'pl'->'rows'->d.key->'act') is distinct from coalesce(d.value->'act','null'::jsonb) or (v_snap->'pl'->'rows'->d.key->'tgt') is distinct from coalesce(d.value->'tgt','null'::jsonb))
   or public.mr_arr(v_snap->'pl'->'checked') is distinct from public.mr_arr(s.demo->'pl'->'checked')
   or coalesce(v_snap->'pl'->>'state','') <> coalesce(s.demo->'pl'->>'state','none')
  then raise exception 'bad_value'; end if;
 end if;
 v_miss := public.mr_missing(r.body, v_snap);
 if jsonb_array_length(v_miss) > 0 then raise exception 'incomplete'; end if;
 -- Answering a follow-up question: every open question needs an answer (by question id); answered questions are closed.
 if r.status = 'followup' and exists(select 1 from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'followup'
    and coalesce((p.data->>'resolved')::boolean, false) is not true and public.mr_blank(r.body->'answers'->>p.id::text)) then raise exception 'incomplete'; end if;
 select * into am from public.mr_members where user_id = s.am_user and enabled;
 v_prev := r.status;
 insert into public.mr_submissions(review_id, no, body, snapshot, created_by) values(r.id, r.submitted_no + 1, r.body, v_snap, v_name);
 if r.status = 'followup' then
  update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'answered_no', r.submitted_no + 1), updated_at = now()
   where review_id = r.id and state = 'sent' and decision = 'followup' and coalesce((data->>'resolved')::boolean, false) is not true;
 end if;
 -- An item the new version no longer has (a question withdrawn, a focus item removed): what waited on it (上位判断・個別相談)
 -- closes as withdrawn, so nobody is left waiting on something nobody can answer any more.
 update public.mr_replies p set data = p.data || jsonb_build_object('resolved', true, 'withdrawn_no', r.submitted_no + 1), updated_at = now()
  where p.review_id = r.id and p.state = 'sent' and p.decision in ('escalate','consult') and coalesce((p.data->>'resolved')::boolean, false) is not true
   and p.target ~ '^(issue|focus):' and public.mr_item_at(r.id, r.submitted_no + 1, p.target) is null;
 update public.mr_reviews set status = 'submitted', submitted_no = submitted_no + 1, submitted_at = now(), version = version + 1,
   next_actor = coalesce(public.mr_actor_name(am), s.am_name, 'GM（AM 未設定）'),
   updated_at = now(), updated_by = v_name
  where id = r.id returning * into r;
 -- An item the GM / CEO decided that needs a decision again (its content changed, or a question on it was answered):
 -- the escalation opens again, so it waits for them (an AM cannot decide it).
 update public.mr_replies p set data = (p.data - 'resolved' - 'resolved_by' - 'resolved_at') || jsonb_build_object('reopened_no', r.submitted_no), updated_at = now()
  where p.review_id = r.id and p.state = 'sent' and p.decision = 'escalate' and coalesce((p.data->>'resolved')::boolean, false)
   and (p.data->>'withdrawn_no') is null and (p.data->>'forwarded') is null and not public.mr_decided(r.id, p.target);
 perform public.mr_recompute(r.id);
 perform public.mr_event(r.id, v_env, m.user_id::text, 'submit', jsonb_build_object('no', r.submitted_no, 'by', v_name, 'from', v_prev));
 select * into r from public.mr_reviews where id = r.id;
 return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'submitted_no', r.submitted_no, 'updated_at', r.updated_at);
end $$;

-- ---------------------------------------------------------------- 段階 2-3: management replies and decisions
-- What needs a management decision in the latest submitted version: every question, every focus item that is late or needs
-- help, the KPIs when one is a MISS, last month's PL when an item was 注意・未達 (not checked at the start of the month).
-- Nothing of that: one overall reply (summary).
create function public.mr_required_targets(r public.mr_reviews) returns text[]
language sql stable security invoker set search_path=public,pg_temp as $$
 with b as (select public.mr_view_body(r) v),
  sn as (select coalesce((select s.snapshot from public.mr_submissions s where s.review_id = r.id order by s.no desc limit 1), '{}'::jsonb) v),
  t as (
   select 'issue:' || (x->>'id') t, 1 o from b, jsonb_array_elements(case when b.v->>'consult' = 'yes' then public.mr_arr(b.v->'issues') else '[]'::jsonb end) x
   union all select 'focus:' || (x->>'id'), 2 from b, jsonb_array_elements(public.mr_arr(b.v->'focus')) x where x->>'status' in ('late','help')
   union all select 'kpi', 3 from sn where exists(select 1 from jsonb_each(case when jsonb_typeof(sn.v->'kpi') = 'object' then sn.v->'kpi' else '{}' end) k where k.value->>'judge' = 'miss')
   union all select 'pl', 4 from sn where exists(select 1 from jsonb_each(case when jsonb_typeof(sn.v->'pl'->'rows') = 'object' then sn.v->'pl'->'rows' else '{}' end) k
     where k.value->>'judge' in ('warn','miss') and not (public.mr_arr(sn.v->'pl'->'checked') ? k.key)))
 select case when count(*) = 0 then array['summary'] else array_agg(t order by o, t) end from t;
$$;

-- What still waits on an item: an open follow-up question, an escalation to GM / CEO, or a 1:1 talk.
create function public.mr_open_waits(p_review uuid, p_target text) returns bigint
language sql stable security invoker set search_path=public,pg_temp as $$
 select count(*) from public.mr_replies p where p.review_id = p_review and p.state = 'sent' and p.decision in ('followup','escalate','consult')
  and coalesce((p.data->>'resolved')::boolean, false) is not true and (p_target is null or p.target = p_target);
$$;

-- Entries with something written (a comment, a cause, a tag). An empty entry left by the screen is not a change.
create function public.mr_written(o jsonb) returns jsonb
language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) from jsonb_each(case when jsonb_typeof(o) = 'object' then o else '{}'::jsonb end) k
  where exists(select 1 from jsonb_each(case when jsonb_typeof(k.value) = 'object' then k.value else '{}'::jsonb end) f
   where (jsonb_typeof(f.value) = 'string' and not public.mr_blank(f.value #>> '{}')) or (jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0));
$$;

-- What one item said in a submitted version (to tell whether a decision made on an older version still matches it).
-- PL / KPI: what the store manager wrote and what needs a decision (KPIs that are 未達; PL rows 注意・未達 not checked at the
-- start of the month), not every small change of the numbers. Overall: the whole report. null: the version has no such item.
create function public.mr_item_at(p_review uuid, p_no integer, p_target text) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with s as (select x.body b, x.snapshot sn from public.mr_submissions x where x.review_id = p_review and x.no = p_no),
  v as (select s.b, s.sn,
    (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from jsonb_each(case when jsonb_typeof(s.sn->'kpi') = 'object' then s.sn->'kpi' else '{}'::jsonb end) k
      where k.value->>'judge' = 'miss') kpi_miss,
    (select coalesce(jsonb_object_agg(k.key, k.value->'judge'), '{}'::jsonb) from jsonb_each(case when jsonb_typeof(s.sn->'pl'->'rows') = 'object' then s.sn->'pl'->'rows' else '{}'::jsonb end) k
      where k.value->>'judge' in ('warn','miss') and not (public.mr_arr(s.sn->'pl'->'checked') ? k.key)) pl_need,
    case when s.b->>'consult' = 'yes' then public.mr_arr(s.b->'issues') else '[]'::jsonb end issues
   from s)
 select case
  when p_target = 'summary' then jsonb_build_object('focus', v.b->'focus', 'issues', v.issues, 'consult', v.b->'consult', 'kpi', public.mr_written(v.b->'kpi'),
    'pl', public.mr_written(v.b->'pl'), 'kpi_miss', v.kpi_miss, 'pl_need', v.pl_need, 'pl_ym', v.sn->'pl'->'ym', 'pl_state', v.sn->'pl'->'state')
  when p_target = 'pl' then jsonb_build_object('text', public.mr_written(v.b->'pl'), 'need', v.pl_need, 'ym', v.sn->'pl'->'ym', 'state', v.sn->'pl'->'state')
  when p_target = 'kpi' then jsonb_build_object('text', public.mr_written(v.b->'kpi'), 'miss', v.kpi_miss)
  when p_target like 'focus:%' then (select f from jsonb_array_elements(public.mr_arr(v.b->'focus')) f where 'focus:' || (f->>'id') = p_target limit 1)
  when p_target like 'issue:%' then (select i from jsonb_array_elements(v.issues) i where 'issue:' || (i->>'id') = p_target limit 1)
  end
 from v;
$$;

-- A reply written on version p_no no longer fits the latest version: the item changed since, or a question asked on it
-- was answered since (a decision is made after reading the answer).
create function public.mr_reply_outdated(p_review uuid, p_no integer, p_target text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(p_no, 0) <> r.submitted_no and (
   public.mr_item_at(p_review, p_no, p_target) is distinct from public.mr_item_at(p_review, r.submitted_no, p_target)
   or exists(select 1 from public.mr_replies f where f.review_id = p_review and f.target = p_target and f.state = 'sent' and f.decision = 'followup'
     and coalesce(nullif(f.data->>'answered_no','')::integer, 0) > coalesce(p_no, 0)))
 from public.mr_reviews r where r.id = p_review;
$$;

-- Someone sent a decision (提案どおり／修正／対応不要) that fits the latest version.
create function public.mr_decided(p_review uuid, p_target text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.mr_replies p where p.review_id = p_review and p.target = p_target and p.state = 'sent'
  and p.decision in ('as_proposed','modify','no_action') and not public.mr_reply_outdated(p_review, p.sub_no, p_target));
$$;

-- An item is decided when a decision fits the latest version and nothing waits on it any more.
create function public.mr_target_final(p_review uuid, p_target text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select public.mr_open_waits(p_review, p_target) = 0 and public.mr_decided(p_review, p_target);
$$;

-- Every item of a submitted version (to tell what changed between two versions).
create function public.mr_targets_at(p_review uuid, p_no integer) returns text[]
language sql stable security invoker set search_path=public,pg_temp as $$
 select array['summary','pl','kpi']
  || coalesce((select array_agg('focus:' || (f->>'id')) from public.mr_submissions s, jsonb_array_elements(public.mr_arr(s.body->'focus')) f
       where s.review_id = p_review and s.no = p_no), '{}'::text[])
  || coalesce((select array_agg('issue:' || (i->>'id')) from public.mr_submissions s,
       jsonb_array_elements(case when s.body->>'consult' = 'yes' then public.mr_arr(s.body->'issues') else '[]'::jsonb end) i
       where s.review_id = p_review and s.no = p_no), '{}'::text[]);
$$;

-- The state from what still waits: 追加確認 → 判断待ち (GM / CEO) → 個別相談予定 → back to the AM.
-- The date due: before any reply the AM's reply date; after that the decision date (questions, escalations and the 1:1 talk
-- keep their own dates). The 1:1 talk still to be held is kept on the review; it clears once a decision after it closes it.
create function public.mr_recompute(p_review uuid) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.mr_reviews; s public.mr_stores; am public.mr_members; v_gm boolean; v_ceo boolean; v_due date; v_rep text;
begin
 select * into r from public.mr_reviews where id = p_review for update;
 if r.status in ('draft','done') then return; end if;
 select * into s from public.mr_stores where env = r.env and store_id = r.store_id;
 select * into am from public.mr_members where user_id = s.am_user and enabled;
 v_rep := coalesce(public.mr_view_body(r)->>'reporter', '店長');
 update public.mr_reviews set consult = (select p.data->'consult' from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'consult'
   and coalesce((p.data->>'resolved')::boolean, false) is not true order by nullif(p.data->'consult'->>'date','') nulls last, p.updated_at desc limit 1) where id = r.id;
 if exists(select 1 from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'followup' and coalesce((p.data->>'resolved')::boolean, false) is not true) then
  select max(nullif(p.data->>'due','')::date) into v_due from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'followup' and coalesce((p.data->>'resolved')::boolean, false) is not true;
  update public.mr_reviews set status = 'followup', decision_by = null, next_actor = v_rep, next_due = coalesce(v_due, nullif(deadlines->>'decide','')::date) where id = r.id;
 elsif exists(select 1 from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'escalate' and coalesce((p.data->>'resolved')::boolean, false) is not true) then
  select bool_or(p.escalate_to = 'gm'), bool_or(p.escalate_to = 'ceo'), min(nullif(p.data->>'due','')::date) into v_gm, v_ceo, v_due
   from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'escalate' and coalesce((p.data->>'resolved')::boolean, false) is not true;
  update public.mr_reviews set status = 'decision', decision_by = case when v_gm and v_ceo then 'both' when v_ceo then 'ceo' else 'gm' end,
   next_actor = case when v_gm and v_ceo then 'GM・CEO' when v_ceo then 'CEO' else 'GM' end, next_due = coalesce(v_due, nullif(deadlines->>'decide','')::date) where id = r.id;
 elsif exists(select 1 from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'consult' and coalesce((p.data->>'resolved')::boolean, false) is not true) then
  select min(nullif(p.data->'consult'->>'date','')::date) into v_due from public.mr_replies p where p.review_id = r.id and p.state = 'sent' and p.decision = 'consult'
   and coalesce((p.data->>'resolved')::boolean, false) is not true;
  update public.mr_reviews set status = 'consult', decision_by = null, next_actor = coalesce(public.mr_actor_name(am), s.am_name, 'GM'),
   next_due = coalesce(v_due, nullif(deadlines->>'consult_to','')::date) where id = r.id;
 else
  update public.mr_reviews set status = 'submitted', decision_by = null, next_actor = coalesce(public.mr_actor_name(am), s.am_name, 'GM（AM 未設定）'),
   next_due = case when exists(select 1 from public.mr_replies p where p.review_id = r.id and p.state = 'sent') then nullif(deadlines->>'decide','')::date
     else nullif(deadlines->>'reply','')::date end where id = r.id;
 end if;
end $$;

-- The review an AM / GM / CEO answers (any member who sees the store). Not before submission, not after completion.
create function public.mr_reply_review(m public.mr_members, p jsonb) returns public.mr_reviews
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_env text := p->>'env'; v_ym text := p->>'ym'; v_store text := p->>'store_id'; s public.mr_stores; r public.mr_reviews;
begin
 if v_env is null or v_env not in ('live','demo') or v_ym is null or v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or v_store is null or v_store !~ '^[A-Za-z0-9-]{1,24}$' then raise exception 'bad_value'; end if;
 select * into s from public.mr_stores where env = v_env and store_id = v_store and active;
 if s.store_id is null or not public.mr_sees(m.role, m.user_id, s.env, s.am_user, s.store_id) then raise exception 'not_found'; end if;
 select * into r from public.mr_reviews where env = v_env and store_id = v_store and ym = v_ym;
 if r.id is null then raise exception 'not_found'; end if;
 return r;
end $$;

-- Save one reply as a draft (only the author sees it). Versioned like the store manager's draft.
create function public.mr_reply_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); v_t text := p->>'target'; v_dec text := nullif(p->>'decision',''); v_to text := nullif(p->>'escalate_to','');
 v_data jsonb := coalesce(p->'data','{}'); v_exp integer; x public.mr_replies; b jsonb;
begin
 -- Lock the review first, then look at its state (a completion or a new version cannot slip in between).
 select * into r from public.mr_reviews where id = r.id for update;
 if r.status not in ('submitted','followup','decision','consult') then raise exception 'locked'; end if;
 if v_t is null or v_t !~ '^[a-z]+(:[A-Za-z0-9_-]{1,40})?$' or jsonb_typeof(v_data) is distinct from 'object' or length(v_data::text) > 8000 then raise exception 'bad_value'; end if;
 if (coalesce(v_data->>'due','') <> '' and not public.mr_date_ok(v_data->>'due'))
    or (jsonb_typeof(v_data->'consult') = 'object' and coalesce(v_data->'consult'->>'date','') <> '' and not public.mr_date_ok(v_data->'consult'->>'date')) then raise exception 'bad_value'; end if;
 if v_dec is not null and v_dec not in ('as_proposed','modify','followup','escalate','consult','no_action') then raise exception 'bad_value'; end if;
 if v_to is not null and v_to not in ('gm','ceo') then raise exception 'bad_value'; end if;
 -- Written while looking at the latest submitted version (a newer one came in: load it first).
 if (p->>'expect_no') is null or (p->>'expect_no') !~ '^[0-9]{1,6}$' or (p->>'expect_no')::integer <> r.submitted_no then raise exception 'new_version'; end if;
 -- Only items of the submitted version (or the overall reply).
 b := public.mr_view_body(r);
 if not (v_t = 'summary' or v_t = 'pl' or v_t = 'kpi'
   or (v_t like 'issue:%' and exists(select 1 from jsonb_array_elements(public.mr_arr(b->'issues')) i where 'issue:' || (i->>'id') = v_t))
   or (v_t like 'focus:%' and exists(select 1 from jsonb_array_elements(public.mr_arr(b->'focus')) f where 'focus:' || (f->>'id') = v_t))) then raise exception 'bad_value'; end if;
 v_exp := case when jsonb_typeof(p->'expect_version') = 'number' and (p->>'expect_version') ~ '^[0-9]{1,6}$' then (p->>'expect_version')::integer else null end;
 select * into x from public.mr_replies where review_id = r.id and author = m.user_id and target = v_t and state = 'draft' for update;
 if x.id is null then
  if coalesce(v_exp, 0) <> 0 then raise exception 'conflict'; end if;
  begin
   insert into public.mr_replies(review_id, target, author, author_name, author_role, decision, escalate_to, data, state, sub_no)
    values(r.id, v_t, m.user_id, public.mr_actor_name(m), m.role, v_dec, v_to, v_data, 'draft', r.submitted_no) returning * into x;
  exception when unique_violation then raise exception 'conflict';
  end;
 else
  if v_exp is null or v_exp <> x.version then raise exception 'conflict'; end if;
  update public.mr_replies set decision = v_dec, escalate_to = v_to, data = v_data, sub_no = r.submitted_no, version = version + 1, updated_at = now() where id = x.id returning * into x;
 end if;
 return jsonb_build_object('id', x.id, 'target', x.target, 'version', x.version, 'updated_at', x.updated_at);
end $$;

create function public.mr_reply_delete(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); n integer;
begin
 delete from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' and target = p->>'target';
 get diagnostics n = row_count;
 return jsonb_build_object('deleted', n);
end $$;

-- What a reply must hold before it is sent (the screen checks the same).
create function public.mr_reply_missing(m public.mr_members, x public.mr_replies) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select case
  -- A draft on an item the latest version no longer has: delete it (nothing can be decided on it).
  when x.target ~ '^(issue|focus):' and public.mr_item_at(x.review_id, (select r.submitted_no from public.mr_reviews r where r.id = x.review_id), x.target) is null then 'gone'
  -- A draft written on an older version whose item has changed since (or a question on it was answered since):
  -- look again and save it (then it is on the latest).
  when x.decision is not null and public.mr_reply_outdated(x.review_id, x.sub_no, x.target) then 'stale'
  -- An item sent up to the GM / CEO is decided by them, also when it changes later (GM items: GM or CEO; CEO items: the CEO).
  -- Not when the item was withdrawn.
  when x.decision in ('as_proposed','modify','no_action') and exists(select 1 from public.mr_replies w where w.review_id = x.review_id and w.target = x.target
    and w.state = 'sent' and w.decision = 'escalate' and (w.data->>'withdrawn_no') is null
    and ((w.escalate_to = 'ceo' and m.role <> 'ceo') or (w.escalate_to = 'gm' and m.role = 'am'))) then 'reserved'
  -- The overall reply can be just a word to the store manager.
  when x.target = 'summary' and x.decision is null then (case when public.mr_blank(x.data->>'message') then 'message' else null end)
  when x.decision is null then 'decision'
  when x.decision in ('as_proposed','modify') and (public.mr_blank(x.data->>'next') or public.mr_blank(x.data->>'owner')
    or not public.mr_date_ok(x.data->>'due') or public.mr_blank(x.data->>'next_check')) then 'action'
  when x.decision = 'no_action' and public.mr_blank(x.data->>'reason') then 'reason'
  when x.decision = 'followup' and (public.mr_blank(x.data->>'question') or not public.mr_date_ok(x.data->>'due')) then 'question'
  when x.decision = 'escalate' and (x.escalate_to is null or public.mr_blank(x.data->>'title') or not public.mr_date_ok(x.data->>'due')
    or public.mr_blank(x.data->>(case when x.escalate_to = 'ceo' then 'recommend' else 'reason' end))) then 'escalate'
  -- An escalation goes up: an AM to GM or CEO, a GM to CEO; a CEO decides.
  when x.decision = 'escalate' and (m.role = 'ceo' or (m.role = 'gm' and x.escalate_to = 'gm')) then 'escalate_up'
  when x.decision = 'consult' and (not public.mr_date_ok(x.data->'consult'->>'date') or coalesce(x.data->'consult'->>'time','') = ''
    or jsonb_array_length(public.mr_arr(x.data->'consult'->'people')) = 0 or jsonb_array_length(public.mr_arr(x.data->'consult'->'topics')) = 0) then 'consult'
  when x.target = 'summary' and x.decision in ('followup','escalate','consult') then 'summary'
  else null end;
$$;

-- Send all of this person's drafts on the review at once (questions go back together, once).
-- A decision resolves what waited on the same item when the sender may decide it (GM items: GM or CEO; CEO items: CEO;
-- a 1:1 talk: any decision after it). Then the state follows from what still waits.
create function public.mr_reply_send(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); x public.mr_replies; v_bad text; n integer := 0;
begin
 select * into r from public.mr_reviews where id = r.id for update;
 if r.status not in ('submitted','followup','decision','consult') then raise exception 'locked'; end if;
 -- Sent while looking at the latest submitted version (a newer one came in: load it and look again).
 if (p->>'expect_no') is null or (p->>'expect_no') !~ '^[0-9]{1,6}$' or (p->>'expect_no')::integer <> r.submitted_no then raise exception 'new_version'; end if;
 if not exists(select 1 from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft') then raise exception 'nothing'; end if;
 for x in select * from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' order by created_at loop
  v_bad := public.mr_reply_missing(m, x);
  if v_bad is not null then raise exception 'incomplete'; end if;
 end loop;
 for x in select * from public.mr_replies where review_id = r.id and author = m.user_id and state = 'draft' order by created_at loop
  if x.decision in ('as_proposed','modify','no_action') then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now()), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and coalesce((data->>'resolved')::boolean, false) is not true
     and (decision = 'consult' or (decision = 'escalate' and (escalate_to = 'ceo' and m.role = 'ceo' or escalate_to = 'gm' and m.role in ('gm','ceo'))));
  end if;
  -- A new 1:1 talk on the same item replaces the one planned before (a new date, people or topics).
  if x.decision = 'consult' then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now(), 'replaced', true), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and decision = 'consult' and coalesce((data->>'resolved')::boolean, false) is not true;
  end if;
  -- A GM passing a GM item on to the CEO: the GM's part is done (it now waits for the CEO only).
  if x.decision = 'escalate' and x.escalate_to = 'ceo' and m.role = 'gm' then
   update public.mr_replies set data = data || jsonb_build_object('resolved', true, 'resolved_by', public.mr_actor_name(m), 'resolved_at', now(), 'forwarded', 'ceo'), updated_at = now()
    where review_id = r.id and target = x.target and state = 'sent' and decision = 'escalate' and escalate_to = 'gm' and coalesce((data->>'resolved')::boolean, false) is not true;
  end if;
  update public.mr_replies set state = 'sent', sent_at = now(), sub_no = r.submitted_no, updated_at = now() where id = x.id;
  n := n + 1;
 end loop;
 -- The review's version is the store manager's working copy: a reply does not make their next save a conflict.
 update public.mr_reviews set updated_at = now(), updated_by = public.mr_actor_name(m) where id = r.id;
 perform public.mr_recompute(r.id);
 perform public.mr_event(r.id, r.env, m.user_id::text, 'reply', jsonb_build_object('by', public.mr_actor_name(m), 'count', n));
 select * into r from public.mr_reviews where id = r.id;
 return jsonb_build_object('sent', n, 'status', r.status, 'version', r.version);
end $$;

-- レビュー完了: nothing waits any more and every item that needs it has a decision (with action, owner, due date and next
-- check, or a reason for no action). Review done is not task done: the actions stay until their result is recorded.
create function public.mr_complete(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); t text;
begin
 select * into r from public.mr_reviews where id = r.id for update;
 if r.status = 'done' then raise exception 'locked'; end if;
 if r.status <> 'submitted' then raise exception 'incomplete'; end if;
 if public.mr_open_waits(r.id, null) > 0 then raise exception 'incomplete'; end if;
 foreach t in array public.mr_required_targets(r) loop
  if not public.mr_target_final(r.id, t) then raise exception 'incomplete'; end if;
 end loop;
 update public.mr_reviews set status = 'done', done_at = now(), next_actor = null, next_due = null, decision_by = null,
  updated_at = now(), updated_by = public.mr_actor_name(m) where id = r.id returning * into r;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'done', jsonb_build_object('by', public.mr_actor_name(m)));
 return jsonb_build_object('status', r.status, 'done_at', r.done_at, 'version', r.version);
end $$;

-- GM / CEO change the dates of one review. A date moved after it passed keeps the delay on record.
create function public.mr_deadline_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); v jsonb := p->'deadlines'; d text; prev text := ''; v_today date; v_late integer := 0;
begin
 select * into r from public.mr_reviews where id = r.id for update;
 if r.status = 'done' then raise exception 'locked'; end if;
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 foreach d in array array['submit','reply','decide','consult_from','consult_to'] loop
  if not public.mr_date_ok(v->>d) or (v->>d) < prev then raise exception 'bad_value'; end if;
  prev := v->>d;
 end loop;
 -- Today in Hawaii (the demo looks at its fixed point in time).
 v_today := case when r.env = 'demo' and (public.mr_setting('demo')->>'now') is not null then ((public.mr_setting('demo')->>'now')::timestamptz at time zone 'Pacific/Honolulu')::date
   else (now() at time zone 'Pacific/Honolulu')::date end;
 if r.next_due is not null and v_today > r.next_due then v_late := v_today - r.next_due; end if;
 update public.mr_reviews set deadlines = jsonb_build_object('submit', v->>'submit', 'reply', v->>'reply', 'decide', v->>'decide', 'consult_from', v->>'consult_from', 'consult_to', v->>'consult_to'),
  next_due = case when status = 'draft' then (v->>'submit')::date else next_due end,
  updated_at = now(), updated_by = public.mr_actor_name(m) where id = r.id;
 perform public.mr_recompute(r.id);
 perform public.mr_event(r.id, r.env, m.user_id::text, 'deadline', jsonb_build_object('by', public.mr_actor_name(m), 'old', r.deadlines, 'new', v, 'late_days', v_late));
 return jsonb_build_object('ok', true);
end $$;

-- The result of an action (task done is separate from review done).
create function public.mr_result_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.mr_members := public.mr_auth(nullif(p->>'actor','')::uuid, array['ceo','gm','am'], true);
 r public.mr_reviews := public.mr_reply_review(m, p); v_id uuid; x public.mr_replies;
begin
 if coalesce(p->>'reply_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(length(p->>'result'),0) not between 1 and 600
    or public.mr_blank(p->>'result') or jsonb_typeof(p->'done') is distinct from 'boolean' then raise exception 'bad_value'; end if;
 v_id := (p->>'reply_id')::uuid;
 select * into x from public.mr_replies where id = v_id and review_id = r.id and state = 'sent' and decision in ('as_proposed','modify') for update;
 if x.id is null then raise exception 'not_found'; end if;
 -- Saved over a result someone else recorded in the meantime: refused (the screen sends the time of the result it showed).
 if coalesce(p->>'expect_at','') is distinct from coalesce(x.data->>'result_at','') then raise exception 'conflict'; end if;
 update public.mr_replies set data = data || jsonb_build_object('result', p->>'result', 'result_done', (p->>'done')::boolean, 'result_by', public.mr_actor_name(m), 'result_at', now()),
  updated_at = now() where id = v_id;
 perform public.mr_event(r.id, r.env, m.user_id::text, 'result', jsonb_build_object('by', public.mr_actor_name(m), 'reply', v_id, 'done', (p->>'done')::boolean));
 return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
 foreach f in array array['mr_setting(text)','mr_auth(uuid,text[],boolean)','mr_sees(text,uuid,text,uuid,text)','mr_am_hr_ok(text)','mr_am_master_ok(uuid,text)','mr_event(uuid,text,text,text,jsonb)',
  'mr_arr(jsonb)','mr_blank(text)','mr_date_ok(text)','mr_written(jsonb)','mr_item_at(uuid,integer,text)','mr_reply_outdated(uuid,integer,text)','mr_decided(uuid,text)','mr_targets_at(uuid,integer)','mr_summary(public.mr_reviews)','mr_whoami(jsonb)','mr_list(jsonb)','mr_settings_save(jsonb)','mr_members_list(jsonb)',
  'mr_stores_save(jsonb)','mr_demo_reset(jsonb)','mr_view_body(public.mr_reviews)','mr_actor_name(public.mr_members)',
  'mr_missing(jsonb,jsonb)','mr_get(jsonb)','mr_save(jsonb)','mr_submit(jsonb)',
  'mr_required_targets(public.mr_reviews)','mr_open_waits(uuid,text)','mr_target_final(uuid,text)','mr_recompute(uuid)',
  'mr_reply_review(public.mr_members,jsonb)','mr_reply_save(jsonb)','mr_reply_delete(jsonb)','mr_reply_missing(public.mr_members,public.mr_replies)',
  'mr_reply_send(jsonb)','mr_complete(jsonb)','mr_deadline_save(jsonb)','mr_result_save(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
