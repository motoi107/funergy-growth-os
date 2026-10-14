-- 中間レビュー：店舗の管轄に GM も選べるようにする（Motoさん 10/14「店舗管轄の選択を GM・AM のどちらか選べる様に」）。
-- 選べるのは「未設定（GM・CEO みんなで見る）」・GM の名前・AM の名前。権限は今のまま（GM・CEO は全店を見て、返信・確認完了ができる。
-- AM は管轄の店だけ）。GM を選んだ店は、一覧と担当・閲覧設定に担当として名前が出る（Motoさん 10/14：権限は今までどおり・未設定も選べる）。
-- 変えるのは 2 つ：mr_stores_save（管轄に GM も入れられる。20261017090000 の直し＝書くときも読んだ版を条件に、はそのまま）と
-- mr_row_v2（一覧の行に担当の役割 am_role）。表・行・権限・ほかの関数は変えない。
-- 20261017090000 のあとに流す（2 回流しても同じ）。20261016090000・20261017090000 を流し直したときも、続けてこれを流す。
do $$
begin
 if to_regclass('public.mr_stores') is null or not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'am_version')
    or to_regprocedure('public.mr_member_role(public.mr_members)') is null or to_regprocedure('public.mr_row_v2(public.mr_members,public.mr_stores,text,text)') is null then
  raise exception '先に 20261016090000_mid_review_v2_versions.sql と 20261017090000_mid_review_stores_save_fix.sql を流してください（何も変えていません）';
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
  -- 20261018090000: the store may be overseen by an AM or a GM — the role the person has now (mr_member_role: an AM still an AM
  -- in the employee list; a GM still a GM in manager_auth, the narrower of the two). A CEO, a chef or staff is refused.
  if v_am is not null and not exists(select 1 from public.mr_members x where x.user_id = v_am and x.enabled
     and public.mr_member_role(x) in ('am','gm')) then raise exception 'bad_value'; end if;
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

create or replace function public.mr_row_v2(m public.mr_members, st public.mr_stores, p_ym text, p_via text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_can jsonb := public.mr_can(m, st, p_ym, p_via); r public.mr_reviews; v_am public.mr_members;
begin
 select * into r from public.mr_reviews x where x.env = st.env and x.store_id = st.store_id and x.ym = p_ym;
 select * into v_am from public.mr_members x where x.user_id = st.am_user;
 return jsonb_build_object('store_id', st.store_id, 'name', st.name, 'sort', st.sort,
  'am_name', coalesce(case when v_am.user_id is not null then public.mr_actor_name(v_am) end, st.am_name), 'am_unset', st.am_user is null and st.am_name is null,
  'am_role', case when v_am.user_id is not null then public.mr_member_role(v_am) end,   -- 20261018090000: 'gm' or 'am' (null: no longer either)
  'input', public.mr_input_info(st, v_can->>'input_emp', v_can->>'input_from'),
  'perms', v_can - 'input_emp' - 'input_from',
  'review', public.mr_review_summary(r));
end $$;

revoke all on function public.mr_row_v2(public.mr_members, public.mr_stores, text, text) from public, anon, authenticated;
grant execute on function public.mr_row_v2(public.mr_members, public.mr_stores, text, text) to service_role;
