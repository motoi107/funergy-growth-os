-- v1109（UI案61 の ②・Moto さんの回答 5〜8 は A）：ボーナスの仮締め・支給額確定・修正・支給済み・調整記録。
-- Spec: docs/BONUS_CLOSE_V1109_JA.md.
--
-- All tables are service-role only. Browsers never read or write them directly: the bonus-close Edge Function checks the
-- person's Supabase Auth sign-in (email), and manager_auth here decides the role. Writing (draft, versions, paid,
-- adjustments) is for CEO / GM; accounting (office) may read. The app's own idea of its role is never used.
--
-- What this keeps: one row per quarter (bc_quarters: the working draft and the state of a correction), every saved
-- version (bc_versions: provisional / final, the whole snapshot the screen computed — amounts, coefficients, the values
-- chosen for unconfirmed parts and why, settings, pool, k), adjustment records when a paid quarter is confirmed again
-- (bc_adjust), and a log (bc_events).
--
-- What this never does: pay, deduct or send anything to payroll; change evaluations, Career Score, sales, settings or
-- the bonus formula; publish an amount to the person. The bonus formula stays in the app (FUNERGY_KARTE_EVAL). Here the
-- server checks who may write, that nobody else changed the quarter since the screen read it (rev), that a snapshot adds
-- up (k = min(1, cap / S); $1 units: the total is the whole dollars of the cap or S, and each person gets the floor of
-- raw × cap / S or one dollar more — the order of the remainders is the app's and is not checked here), and that a quarter
-- has at most one effective final version. Versions are never deleted or rewritten (a replaced version keeps its numbers).

create table if not exists public.bc_quarters(
 quarter text primary key check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
 rev integer not null default 0,
 draft jsonb not null default '{}'::jsonb,
 draft_at timestamptz,
 draft_by text,
 fixing integer,                 -- correcting: the version the correction started from (null: not correcting)
 fix_at timestamptz,
 fix_by text,
 updated_at timestamptz not null default now()
);

create table if not exists public.bc_versions(
 quarter text not null references public.bc_quarters(quarter),
 ver integer not null check (ver >= 1),
 kind text not null check (kind in ('provisional','final')),
 status text not null check (status in ('kept','effective','replaced')),
 snap jsonb not null,
 n integer not null check (n >= 0),
 total_raw bigint not null check (total_raw >= 0),
 cap numeric(14,2) not null check (cap >= 0),
 k double precision not null check (k >= 0 and k <= 1),   -- a $0 pool (with S > 0) is k = 0: everyone $0
 paid_total bigint not null check (paid_total >= 0),
 has_prov boolean not null default false,
 base_ver integer,
 from_ver integer,               -- a final copied from a provisional version (the numbers are that version's)
 why text not null default '' check (length(why) <= 500),
 made_at timestamptz not null default now(),
 made_by text not null,
 made_uid uuid not null,
 made_role text not null,
 replaced_at timestamptz,
 replaced_by text,
 paid_on date,
 paid_at timestamptz,
 paid_by text,
 primary key(quarter, ver),
 check (kind = 'final' or status = 'kept'),
 check (kind = 'provisional' or status in ('effective','replaced')),
 check ((paid_at is null) = (paid_on is null)),
 check (paid_at is null or kind = 'final')
);
-- One effective final version per quarter (the database refuses a second one).
create unique index if not exists bc_versions_one_effective on public.bc_versions(quarter) where status = 'effective';
-- Paid once per quarter (a later correction goes to bc_adjust, never a second payment record).
create unique index if not exists bc_versions_one_paid on public.bc_versions(quarter) where paid_at is not null;

create table if not exists public.bc_adjust(
 id bigint generated always as identity primary key,
 quarter text not null references public.bc_quarters(quarter),
 emp_id text not null,
 emp_name text not null default '',
 paid_ver integer not null,
 prev_ver integer not null,
 new_ver integer not null,
 prev_amount bigint not null,
 new_amount bigint not null,
 diff bigint not null check (diff <> 0),
 state text not null default 'open' check (state in ('open','done')),
 memo text not null default '' check (length(memo) <= 500),
 made_at timestamptz not null default now(),
 made_by text not null,
 done_at timestamptz,
 done_by text,
 unique(quarter, emp_id, new_ver)
);

create table if not exists public.bc_events(
 id bigint generated always as identity primary key,
 quarter text,
 at timestamptz not null default now(),
 uid uuid,
 by_name text,
 by_role text,
 action text not null,
 detail jsonb not null default '{}'::jsonb
);
create index if not exists bc_events_quarter on public.bc_events(quarter, id);

do $$ declare t text; begin
 foreach t in array array['bc_quarters','bc_versions','bc_adjust','bc_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update, delete on public.%I to service_role', t);
 end loop;
end $$;
revoke all on sequence public.bc_adjust_id_seq from public, anon, authenticated;
revoke all on sequence public.bc_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.bc_adjust_id_seq to service_role;
grant usage, select on sequence public.bc_events_id_seq to service_role;

-- ---------------------------------------------------------------- who is calling
-- The Edge Function passes the Supabase Auth user id it checked (p.actor). The role comes from manager_auth only.
-- CEO / GM write; accounting (office) reads. Anyone else (and a suspended account) is refused.
create or replace function public.bc_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a uuid; r text; n text; st text;
begin
 if coalesce(p->>'actor','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'unauthorized'; end if;
 a := (p->>'actor')::uuid;
 select m.role, e.name, e.status into r, n, st from public.manager_auth m left join public.employees e on e.id::text = m.emp_id::text where m.user_id = a;
 if r is null or r not in ('ceo','gm','office') then raise exception 'forbidden'; end if;
 if coalesce(st, '') = '退職' then raise exception 'forbidden'; end if;   -- an account linked to a resigned employee (v1085 also suspends it)
 return jsonb_build_object('uid', a, 'role', r, 'name', left(coalesce(nullif(btrim(n), ''), upper(r)), 80), 'write', r in ('ceo','gm'));
end $$;

create or replace function public.bc_writer(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_actor(p);
begin
 if not (a->>'write')::boolean then raise exception 'forbidden'; end if;
 return a;
end $$;

create or replace function public.bc_q(p jsonb) returns text
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if coalesce(p->>'quarter','') !~ '^[0-9]{4}-Q[1-4]$' then raise exception 'bad_value'; end if;
 return p->>'quarter';
end $$;

-- The version of the quarter the screen read. Required on every write: another change since then → conflict, nothing written.
create or replace function public.bc_rev(p jsonb) returns integer
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p->'expect_rev') is distinct from 'number' or (p->>'expect_rev') !~ '^[0-9]{1,9}$' then raise exception 'bad_value'; end if;
 return (p->>'expect_rev')::integer;
end $$;

create or replace function public.bc_event(q text, a jsonb, act text, d jsonb) returns void
language sql security invoker set search_path=public,pg_temp as $$
 insert into public.bc_events(quarter, uid, by_name, by_role, action, detail) values (q, (a->>'uid')::uuid, a->>'name', a->>'role', act, coalesce(d, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------- shapes
create or replace function public.bc_txt_ok(v jsonb, n integer, need boolean) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when v is null or jsonb_typeof(v) = 'null' then not need
             when jsonb_typeof(v) <> 'string' then false
             else length(v #>> '{}') <= n and (not need or btrim(v #>> '{}') <> '') end;
$$;

-- The 7 steps (0.85 … 1.15 by 0.05). The person's own range is checked by the screen (it knows the settings).
create or replace function public.bc_step_ok(v jsonb) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15);
$$;

-- The values chosen for unconfirmed parts. choices: { <employee id>: { <part>: {m, v?, why?, at?, by?} } }
--   part: c s f p (the four items) or d (the evaluation not yet marked complete)
--   m: input (use what is entered now — the screen offers it only when nothing is unscored)
--      tmp (provisional 1.00) / set (one of the 7 steps, with a reason)
-- bulk: the record of 「未確定部分を 1.00 で試算」 { at, by, why, parts: [[employee id, part], …] }
create or replace function public.bc_choices_ok(ch jsonb, bulk jsonb) returns boolean
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare e record; x record; b jsonb; pp jsonb;
begin
 if ch is null or jsonb_typeof(ch) = 'null' then ch := '{}'::jsonb; end if;
 if jsonb_typeof(ch) <> 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(ch)) > 1000 then return false; end if;
 for e in select * from jsonb_each(ch) loop
  if e.key !~ '^[A-Za-z0-9_.:@-]{1,64}$' or jsonb_typeof(e.value) <> 'object' then return false; end if;
  for x in select * from jsonb_each(e.value) loop
   if x.key not in ('c','s','f','p','d') or jsonb_typeof(x.value) <> 'object' then return false; end if;
   if coalesce(x.value->>'m','') not in ('input','tmp','set') then return false; end if;
   if x.value->>'m' = 'set' and not (public.bc_step_ok(x.value->'v') and public.bc_txt_ok(x.value->'why', 300, true)) then return false; end if;
   if x.value->>'m' <> 'set' and x.value ? 'v' and jsonb_typeof(x.value->'v') <> 'null' then return false; end if;
   if x.key = 'd' and x.value->>'m' = 'set' then return false; end if;   -- the whole evaluation is not one coefficient
   if not (public.bc_txt_ok(x.value->'why', 300, false) and public.bc_txt_ok(x.value->'at', 40, false) and public.bc_txt_ok(x.value->'by', 80, false)) then return false; end if;
  end loop;
 end loop;
 if bulk is null or jsonb_typeof(bulk) = 'null' then return true; end if;
 if jsonb_typeof(bulk) <> 'array' or jsonb_array_length(bulk) > 50 then return false; end if;
 for b in select value from jsonb_array_elements(bulk) loop
  if jsonb_typeof(b) <> 'object' or not public.bc_txt_ok(b->'why', 300, true) or not public.bc_txt_ok(b->'at', 40, false) or not public.bc_txt_ok(b->'by', 80, false) then return false; end if;
  if jsonb_typeof(b->'parts') <> 'array' or jsonb_array_length(b->'parts') > 5000 then return false; end if;
  for pp in select value from jsonb_array_elements(b->'parts') loop
   if jsonb_typeof(pp) <> 'array' or jsonb_array_length(pp) <> 2 or jsonb_typeof(pp->0) <> 'string' or coalesce(pp->>1,'') not in ('c','s','f','p','d') then return false; end if;
  end loop;
 end loop;
 return true;
end $$;

create or replace function public.bc_draft_ok(d jsonb) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select jsonb_typeof(d) = 'object' and length(d::text) <= 600000
   and (select count(*) from jsonb_object_keys(d) k where k not in ('choices','bulk','note')) = 0
   and public.bc_choices_ok(d->'choices', d->'bulk')
   and public.bc_txt_ok(d->'note', 1000, false);
$$;

-- A snapshot adds up. The app computes it (the bonus formula lives there); the server checks that it is whole and
-- consistent and that nothing is left unselected. Returns the number of parts that used a chosen value (has_prov).
-- people: { id: {raw, final, …} }, order: [id …], finals: { id: amount }, S, paid, cap (pool + special pool), k,
-- unsel (unselected parts — must be 0), prov (parts that used a chosen value), choices / bulk (as in the draft).
create or replace function public.bc_snap_check(q text, s jsonb) returns integer
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare ids text[]; id text; n integer; raw numeric; fin numeric; sraw numeric := 0; spaid numeric := 0; cap numeric; k double precision; tgt numeric; prov integer; ex numeric;
begin
 if jsonb_typeof(s) is distinct from 'object' or length(s::text) > 6000000 then raise exception 'bad_snapshot'; end if;
 if coalesce(s->>'q','') <> q then raise exception 'bad_snapshot'; end if;
 if jsonb_typeof(s->'order') <> 'array' or jsonb_typeof(s->'people') <> 'object' or jsonb_typeof(s->'finals') <> 'object' then raise exception 'bad_snapshot'; end if;
 if jsonb_typeof(s->'unsel') <> 'number' or (s->>'unsel') <> '0' then raise exception 'unselected'; end if;
 if jsonb_typeof(s->'prov') <> 'number' or (s->>'prov') !~ '^[0-9]{1,6}$' then raise exception 'bad_snapshot'; end if;
 prov := (s->>'prov')::integer;
 if not public.bc_choices_ok(s->'choices', s->'bulk') then raise exception 'bad_snapshot'; end if;
 select array_agg(value #>> '{}') into ids from jsonb_array_elements(s->'order');
 ids := coalesce(ids, array[]::text[]);
 n := cardinality(ids);
 if n > 1000 or n <> (select count(distinct x) from unnest(ids) x) then raise exception 'bad_snapshot'; end if;
 if (select count(*) from jsonb_array_elements(s->'order') v where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Za-z0-9_.:@-]{1,64}$') > 0 then raise exception 'bad_snapshot'; end if;
 if (select count(*) from jsonb_object_keys(s->'people')) <> n or (select count(*) from jsonb_object_keys(s->'finals')) <> n then raise exception 'bad_snapshot'; end if;
 foreach id in array ids loop
  if not (s->'people' ? id) or not (s->'finals' ? id) then raise exception 'bad_snapshot'; end if;
  if jsonb_typeof(s->'people'->id->'raw') <> 'number' or jsonb_typeof(s->'finals'->id) <> 'number' then raise exception 'bad_snapshot'; end if;
  raw := (s->'people'->id->>'raw')::numeric; fin := (s->'finals'->>id)::numeric;
  if raw <> trunc(raw) or fin <> trunc(fin) or raw < 0 or fin < 0 or raw > 100000000 or fin > raw then raise exception 'bad_amounts'; end if;
  if jsonb_typeof(s->'people'->id->'final') = 'number' and (s->'people'->id->>'final')::numeric <> fin then raise exception 'bad_amounts'; end if;
  sraw := sraw + raw; spaid := spaid + fin;
 end loop;
 if jsonb_typeof(s->'S') <> 'number' or (s->>'S')::numeric <> sraw then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'paid') <> 'number' or (s->>'paid')::numeric <> spaid then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'cap') <> 'number' or (s->>'cap')::numeric < 0 then raise exception 'no_pool'; end if;
 cap := (s->>'cap')::numeric;
 if round(cap, 2) <> cap then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'k') <> 'number' then raise exception 'bad_amounts'; end if;
 k := (s->>'k')::double precision;
 -- k = min(1, cap / S); S = 0 → k = 1 and nothing is paid. The total is the whole dollars of the cap (never more), or S.
 if sraw = 0 then
  if k <> 1 or spaid <> 0 then raise exception 'bad_amounts'; end if;
 else
  if abs(k - least(1::double precision, cap::double precision / sraw::double precision)) > 1e-9 then raise exception 'bad_amounts'; end if;
  tgt := least(sraw, floor(cap));
  if spaid <> tgt then raise exception 'bad_amounts'; end if;
  if cap >= sraw and spaid <> sraw then raise exception 'bad_amounts'; end if;
  -- each person: the floor of raw × cap / S, or one dollar more (the app's largest remainders; a small margin for the app's
  -- floating point on very large amounts)
  if cap < sraw then
   foreach id in array ids loop
    raw := (s->'people'->id->>'raw')::numeric; fin := (s->'finals'->>id)::numeric; ex := raw * cap / sraw;
    if fin < floor(ex - 0.000001) or fin > floor(ex + 0.000001) + 1 then raise exception 'bad_amounts'; end if;
   end loop;
  end if;
 end if;
 return prov;
end $$;

-- ---------------------------------------------------------------- reading
create or replace function public.bc_vrow(v public.bc_versions) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ver', v.ver, 'kind', v.kind, 'status', v.status, 'n', v.n, 'total_raw', v.total_raw, 'cap', v.cap, 'k', v.k,
  'paid_total', v.paid_total, 'has_prov', v.has_prov, 'base_ver', v.base_ver, 'from_ver', v.from_ver, 'why', v.why, 'made_at', v.made_at, 'made_by', v.made_by,
  'made_role', v.made_role, 'replaced_at', v.replaced_at, 'replaced_by', v.replaced_by, 'paid_on', v.paid_on, 'paid_at', v.paid_at, 'paid_by', v.paid_by,
  'lid', v.snap->>'lid');
$$;

-- The quarter: state, the draft, every version (without the snapshots), the adjustments, and the snapshots of the
-- latest version and of the effective final (the screen compares with them).
create or replace function public.bc_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_actor(p); q text := public.bc_q(p); r public.bc_quarters; lv public.bc_versions; ef public.bc_versions;
begin
 select * into r from public.bc_quarters where quarter = q;
 select * into lv from public.bc_versions where quarter = q order by ver desc limit 1;
 select * into ef from public.bc_versions where quarter = q and status = 'effective';
 return jsonb_build_object('me', a, 'quarter', q, 'rev', coalesce(r.rev, 0), 'draft', coalesce(r.draft, '{}'::jsonb), 'draft_at', r.draft_at, 'draft_by', r.draft_by,
  'fixing', r.fixing, 'fix_at', r.fix_at, 'fix_by', r.fix_by,
  'versions', coalesce((select jsonb_agg(public.bc_vrow(v) order by v.ver) from public.bc_versions v where v.quarter = q), '[]'::jsonb),
  'adjust', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'emp_id', x.emp_id, 'emp_name', x.emp_name, 'paid_ver', x.paid_ver, 'prev_ver', x.prev_ver, 'new_ver', x.new_ver,
     'prev_amount', x.prev_amount, 'new_amount', x.new_amount, 'diff', x.diff, 'state', x.state, 'memo', x.memo, 'made_at', x.made_at, 'made_by', x.made_by, 'done_at', x.done_at, 'done_by', x.done_by) order by x.id)
     from public.bc_adjust x where x.quarter = q), '[]'::jsonb),
  'latest', case when lv.ver is null then null else jsonb_build_object('ver', lv.ver, 'snap', lv.snap) end,
  'effective', case when ef.ver is null then null when ef.ver = lv.ver then jsonb_build_object('ver', ef.ver, 'same', true) else jsonb_build_object('ver', ef.ver, 'snap', ef.snap) end);
end $$;

-- One version with its snapshot (history: every version opens with the numbers it was saved with).
create or replace function public.bc_version(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_actor(p); q text := public.bc_q(p); v public.bc_versions;
begin
 if jsonb_typeof(p->'ver') <> 'number' or (p->>'ver') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 select * into v from public.bc_versions where quarter = q and ver = (p->>'ver')::integer;
 if v.ver is null then raise exception 'not_found'; end if;
 return public.bc_vrow(v) || jsonb_build_object('snap', v.snap);
end $$;

-- ---------------------------------------------------------------- writing (CEO / GM)
-- Takes the quarter row for update (made when missing) and checks the version the screen read.
create or replace function public.bc_lock(q text, er integer) returns public.bc_quarters
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.bc_quarters;
begin
 insert into public.bc_quarters(quarter) values (q) on conflict (quarter) do nothing;
 select * into r from public.bc_quarters where quarter = q for update;
 if r.rev <> er then raise exception 'conflict'; end if;
 return r;
end $$;

-- The draft can be edited while nothing is saved yet, or while correcting.
create or replace function public.bc_draft_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; d jsonb := p->'draft';
begin
 if not public.bc_draft_ok(d) then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 if r.fixing is null and exists(select 1 from public.bc_versions v where v.quarter = q) then raise exception 'not_editable'; end if;
 update public.bc_quarters set draft = d, draft_at = now(), draft_by = a->>'name', rev = rev + 1, updated_at = now() where quarter = q returning * into r;
 perform public.bc_event(q, a, 'draft', jsonb_build_object('choices', (select count(*) from jsonb_object_keys(coalesce(d->'choices', '{}'::jsonb)))));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'draft_at', r.draft_at, 'draft_by', r.draft_by);
end $$;

-- Save a version computed by the screen (kind provisional: 仮締め; kind final: re-confirming while correcting the effective
-- final). A final while not correcting an effective final, or a provisional once a final exists, is refused.
create or replace function public.bc_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters;
 kind text := p->>'kind'; s jsonb := p->'snap'; why text := coalesce(p->>'why', ''); ef public.bc_versions; ver integer; prov integer;
 paid public.bc_versions; x record; nv public.bc_versions;
begin
 if kind not in ('provisional','final') then raise exception 'bad_value'; end if;
 if length(why) > 500 then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 select * into ef from public.bc_versions where quarter = q and status = 'effective';
 if kind = 'provisional' then
  if ef.ver is not null then raise exception 'not_editable'; end if;
  if r.fixing is null and exists(select 1 from public.bc_versions v where v.quarter = q) then raise exception 'not_editable'; end if;
 else
  if ef.ver is null or r.fixing is distinct from ef.ver then raise exception 'not_editable'; end if;
  if btrim(why) = '' then raise exception 'why_required'; end if;
 end if;
 prov := public.bc_snap_check(q, s);
 select coalesce(max(v.ver), 0) + 1 into ver from public.bc_versions v where v.quarter = q;
 -- The server names the version (the app's copy of the effective final carries it).
 s := s || jsonb_build_object('lid', 'BC-' || q || '-v' || ver, 'vid', ver, 'kind', kind, 'lt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
 if kind = 'final' then
  update public.bc_versions bv set status = 'replaced', replaced_at = now(), replaced_by = a->>'name' where bv.quarter = q and bv.ver = ef.ver;
 end if;
 insert into public.bc_versions(quarter, ver, kind, status, snap, n, total_raw, cap, k, paid_total, has_prov, base_ver, why, made_by, made_uid, made_role)
 values (q, ver, kind, case when kind = 'final' then 'effective' else 'kept' end, s, jsonb_array_length(s->'order'), (s->>'S')::bigint, (s->>'cap')::numeric,
  (s->>'k')::double precision, (s->>'paid')::bigint, prov > 0, r.fixing, why, a->>'name', (a->>'uid')::uuid, a->>'role') returning * into nv;
 -- Paid already: the differences become adjustment records against the previous effective final (paid amounts stay).
 select * into paid from public.bc_versions where quarter = q and paid_at is not null;
 if kind = 'final' and paid.ver is not null then
  for x in
   select coalesce(o.id, nn.id) as id, coalesce((ef.snap->'finals'->>coalesce(o.id, nn.id))::bigint, 0) as a0, coalesce((s->'finals'->>coalesce(o.id, nn.id))::bigint, 0) as a1,
     coalesce(s->'people'->coalesce(o.id, nn.id)->>'name', ef.snap->'people'->coalesce(o.id, nn.id)->>'name', '') as nm
   from (select jsonb_object_keys(ef.snap->'finals') as id) o full join (select jsonb_object_keys(s->'finals') as id) nn on nn.id = o.id
  loop
   if x.a1 <> x.a0 then
    insert into public.bc_adjust(quarter, emp_id, emp_name, paid_ver, prev_ver, new_ver, prev_amount, new_amount, diff, made_by)
    values (q, x.id, left(x.nm, 80), paid.ver, ef.ver, ver, x.a0, x.a1, x.a1 - x.a0, a->>'name');
   end if;
  end loop;
 end if;
 update public.bc_quarters set fixing = null, fix_at = null, fix_by = null,
  draft = jsonb_strip_nulls(jsonb_build_object('choices', s->'choices', 'bulk', s->'bulk')), draft_at = now(), draft_by = a->>'name', rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'save', jsonb_build_object('ver', ver, 'kind', kind, 'n', nv.n, 'S', nv.total_raw, 'paid', nv.paid_total, 'prov', prov, 'replaced', ef.ver));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'ver', ver, 'lid', s->>'lid', 'lt', s->'lt');
end $$;

-- 支給額を確定 from 仮締め: the latest provisional version becomes the effective final with the same numbers (no recount;
-- a newer evaluation is taken in only by correcting first).
create or replace function public.bc_confirm(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; lv public.bc_versions; ver integer; s jsonb;
begin
 if jsonb_typeof(p->'ver') <> 'number' or (p->>'ver') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 if r.fixing is not null then raise exception 'not_editable'; end if;
 if exists(select 1 from public.bc_versions v where v.quarter = q and v.kind = 'final') then raise exception 'not_editable'; end if;
 select * into lv from public.bc_versions bv where bv.quarter = q order by bv.ver desc limit 1;
 if lv.ver is null or lv.kind <> 'provisional' or lv.ver <> (p->>'ver')::integer then raise exception 'not_editable'; end if;
 if lv.has_prov and btrim(coalesce(p->>'why', '')) = '' then raise exception 'why_required'; end if;
 if length(coalesce(p->>'why', '')) > 500 then raise exception 'bad_value'; end if;
 ver := lv.ver + 1;
 s := lv.snap || jsonb_build_object('lid', 'BC-' || q || '-v' || ver, 'vid', ver, 'kind', 'final', 'from', lv.ver, 'lt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
 insert into public.bc_versions(quarter, ver, kind, status, snap, n, total_raw, cap, k, paid_total, has_prov, base_ver, from_ver, why, made_by, made_uid, made_role)
 values (q, ver, 'final', 'effective', s, lv.n, lv.total_raw, lv.cap, lv.k, lv.paid_total, lv.has_prov, lv.ver, lv.ver, coalesce(p->>'why', ''), a->>'name', (a->>'uid')::uuid, a->>'role');
 update public.bc_quarters set rev = rev + 1, updated_at = now() where quarter = q returning * into r;
 perform public.bc_event(q, a, 'confirm', jsonb_build_object('ver', ver, 'from', lv.ver, 'prov', lv.has_prov));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'ver', ver, 'lid', s->>'lid', 'lt', s->'lt');
end $$;

-- 修正を開始 / 確定版から修正: from the effective final if there is one, otherwise from the latest provisional version.
-- The draft starts from that version's chosen values. The effective final stays effective until re-confirmed.
create or replace function public.bc_fix_start(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; b public.bc_versions;
begin
 r := public.bc_lock(q, er);
 if r.fixing is not null then raise exception 'not_editable'; end if;
 select * into b from public.bc_versions where quarter = q and status = 'effective';
 if b.ver is null then
  select * into b from public.bc_versions where quarter = q order by ver desc limit 1;
  if b.ver is null then raise exception 'not_editable'; end if;
 end if;
 update public.bc_quarters set fixing = b.ver, fix_at = now(), fix_by = a->>'name',
  draft = jsonb_strip_nulls(jsonb_build_object('choices', b.snap->'choices', 'bulk', b.snap->'bulk')), draft_at = now(), draft_by = a->>'name', rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'fix_start', jsonb_build_object('base', b.ver));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'fixing', b.ver);
end $$;

-- 修正をやめる: back to the version the correction started from (its chosen values); nothing else changes.
create or replace function public.bc_fix_cancel(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; b public.bc_versions;
begin
 r := public.bc_lock(q, er);
 if r.fixing is null then raise exception 'not_editable'; end if;
 select * into b from public.bc_versions where quarter = q and ver = r.fixing;
 update public.bc_quarters set fixing = null, fix_at = null, fix_by = null,
  draft = jsonb_strip_nulls(jsonb_build_object('choices', b.snap->'choices', 'bulk', b.snap->'bulk')), draft_at = now(), draft_by = a->>'name', rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'fix_cancel', jsonb_build_object('base', b.ver));
 return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

-- 支給済みとして記録: the effective final, once per quarter, with the payment date. Nothing is paid or sent from here.
create or replace function public.bc_mark_paid(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; ef public.bc_versions; d date;
begin
 if jsonb_typeof(p->'ver') <> 'number' or (p->>'ver') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 if coalesce(p->>'paid_on','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then raise exception 'bad_value'; end if;
 begin d := (p->>'paid_on')::date; exception when others then raise exception 'bad_value'; end;
 if to_char(d, 'YYYY-MM-DD') <> p->>'paid_on' then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 if r.fixing is not null then raise exception 'fixing'; end if;
 select * into ef from public.bc_versions where quarter = q and status = 'effective';
 if ef.ver is null or ef.ver <> (p->>'ver')::integer then raise exception 'not_editable'; end if;
 if exists(select 1 from public.bc_versions v where v.quarter = q and v.paid_at is not null) then raise exception 'already_paid'; end if;
 update public.bc_versions set paid_on = d, paid_at = now(), paid_by = a->>'name' where quarter = q and ver = ef.ver;
 update public.bc_quarters set rev = rev + 1, updated_at = now() where quarter = q returning * into r;
 perform public.bc_event(q, a, 'paid', jsonb_build_object('ver', ef.ver, 'paid_on', d, 'total', ef.paid_total));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'ver', ef.ver);
end $$;

-- 「対応済み」：what was done for one adjustment (a memo is required). The amount itself is never changed here.
create or replace function public.bc_adjust_done(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; x public.bc_adjust;
begin
 if jsonb_typeof(p->'id') <> 'number' or (p->>'id') !~ '^[0-9]{1,12}$' then raise exception 'bad_value'; end if;
 if not public.bc_txt_ok(p->'memo', 500, true) then raise exception 'memo_required'; end if;
 r := public.bc_lock(q, er);
 select * into x from public.bc_adjust where id = (p->>'id')::bigint and quarter = q for update;
 if x.id is null then raise exception 'not_found'; end if;
 if x.state <> 'open' then raise exception 'not_editable'; end if;
 update public.bc_adjust set state = 'done', memo = p->>'memo', done_at = now(), done_by = a->>'name' where id = x.id;
 update public.bc_quarters set rev = rev + 1, updated_at = now() where quarter = q returning * into r;
 perform public.bc_event(q, a, 'adjust_done', jsonb_build_object('id', x.id, 'emp', x.emp_id, 'diff', x.diff));
 return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

do $$ declare f text; begin
 foreach f in array array['bc_actor(jsonb)','bc_writer(jsonb)','bc_q(jsonb)','bc_rev(jsonb)','bc_event(text,jsonb,text,jsonb)','bc_txt_ok(jsonb,integer,boolean)',
  'bc_step_ok(jsonb)','bc_choices_ok(jsonb,jsonb)','bc_draft_ok(jsonb)','bc_snap_check(text,jsonb)','bc_vrow(public.bc_versions)','bc_get(jsonb)','bc_version(jsonb)',
  'bc_lock(text,integer)','bc_draft_save(jsonb)','bc_save(jsonb)','bc_confirm(jsonb)','bc_fix_start(jsonb)','bc_fix_cancel(jsonb)','bc_mark_paid(jsonb)','bc_adjust_done(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
