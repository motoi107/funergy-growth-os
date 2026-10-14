-- 中間レビュー v1073 の直し（Codex のレビュー `3fbd9dd` の P2）：店舗の管轄（mr_stores_save）
-- 版を比べたあとに、ほかの保存がまだ無かった店を入れてコミットすると、その店は「あるもの」として版を見ずに書き直されていた。
-- 書くときにも読んだ版を条件にし、合わなければ conflict（何も書かない）。関数 1 つの置き換えだけ（表・行・権限はそのまま）。
-- 20261016090000 のあとに流す（2 回流しても同じ）。20261016090000 を流し直したときも、続けてこれを流す。
do $$
begin
 if to_regclass('public.mr_stores') is null or not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'am_version') then
  raise exception '先に 20261016090000_mid_review_v2_versions.sql を流してください（何も変えていません）';
 end if;
end $$;

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
 -- Written in store_id order too: two saves that both put in the same new stores (sent in another order) wait for each other
 -- in one order and the later one gets conflict (in the order sent, each could hold one new store and wait for the other).
 for s in select e.value from jsonb_array_elements(p->'stores') e order by e.value->>'store_id' loop
  v_am := nullif(s->>'am_user','')::uuid;
  select * into st from public.mr_stores y where y.env = 'live' and y.store_id = s->>'store_id';
  if st.store_id is not null then
   -- The row may have appeared after the compare above (another save put the store in and committed meanwhile; the lock
   -- held only the rows that were there). So the write itself requires the version the screen read: no row → conflict.
   update public.mr_stores set name = s->>'name', am_user = v_am, sort = coalesce((s->>'sort')::integer, 0), active = coalesce((s->>'active')::boolean, true),
     updated_at = now(), updated_by = m.user_id::text
    where env = 'live' and store_id = st.store_id and am_version = public.mr_ver(s->'expect_version') returning am_version into v_ver;
   if not found then raise exception 'conflict'; end if;
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

revoke all on function public.mr_stores_save(jsonb) from public, anon, authenticated;
grant execute on function public.mr_stores_save(jsonb) to service_role;
