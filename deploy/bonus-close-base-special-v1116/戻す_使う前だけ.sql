-- v1116 ボーナスの締め：無条件で基準額・特別報酬を外して v1109 に戻す（まだ一度も使っていないときだけ）。
-- 「無条件で基準額」・特別報酬を 1 つでも入れた（または入れた版がある）ときは、何も変えずに止まります（記録は消しません）。
-- 関数 bonus-close も v1109 の 1 ファイル（deploy/bonus-close-v1109/3_関数_bonus-close_index.ts）に戻してください。
do $$ begin
 if to_regclass('public.bc_quarters') is null then raise exception 'STOP: ボーナスの締め（v1109）が入っていません'; end if;
 if exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bc_quarters' and column_name = 'pay') then
  if exists(select 1 from public.bc_quarters where pay <> '{}'::jsonb)
     or exists(select 1 from public.bc_versions v where coalesce((v.snap->>'SP')::numeric, 0) > 0 or coalesce((v.snap->>'F')::numeric, 0) > 0
       or exists(select 1 from jsonb_each(case when jsonb_typeof(v.snap->'people') = 'object' then v.snap->'people' else '{}'::jsonb end) x where x.value ? 'sp' or x.value ? 'mode'))
     or exists(select 1 from public.bc_events where action in ('pay_mode','sp')) then
   raise exception 'STOP: 無条件で基準額・特別報酬の記録があるため、何も変えていません';
  end if;
 end if;
end $$;

-- v1109 の関数（20261028090000_bonus_close.sql と同じ中身）
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

drop function if exists public.bc_pay_mode(jsonb), public.bc_sp_save(jsonb), public.bc_pay_match(jsonb,jsonb), public.bc_pay_from_snap(jsonb),
  public.bc_emp(jsonb), public.bc_amt(jsonb,boolean), public.bc_now_txt();
alter table public.bc_quarters drop column if exists pay;
do $$ declare f text; begin
 foreach f in array array['bc_snap_check(text,jsonb)','bc_get(jsonb)','bc_save(jsonb)','bc_fix_start(jsonb)','bc_fix_cancel(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
select 'back to v1109' as result;
