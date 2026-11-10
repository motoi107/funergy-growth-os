-- v1144 の直し（Codex #138 P1-1）：Head Chef（全員の生年月日・カード・保険の加入、全店の Career Score を見る）も、
-- GM・CEO が確かめた写し（wr_people）で決める。
--
-- 【前】関数 secure-state は、社員の表の肩書き・役割（Head Chef・Corporate Chef・chef）だけで Head Chef と決めていた。
--   社員の表は公開の鍵で書けるので、GM・CEO が確かめた G4（店長）が自分の肩書きを Head Chef に書き換えると、
--   全員の個人の欄（生年月日・カードの下 4 桁・保険の加入）を読み書きでき、全店の Career Score も見られた。
-- 【いま】確かめた写しに「Head Chef か（chef）」を足す。Head Chef として広い範囲を見るのは、写しと今の社員の表の両方で Head Chef のときだけ
--   （AM・G4 以上と同じ「確かめた写しと今の狭いほう」）。Head Chef になる変更は「承認・閲覧の権限の確かめ」で「権限が増える」と出て、
--   GM・CEO が確かめるまで効かない。Head Chef でなくなる変更はすぐ効く。
--   入れた直後は、今の Head Chef も全員「権限が増える」と出る（写しにまだ印が無いため）。GM・CEO が確かめるまで、Head Chef は
--   個人の欄を見られず、Career Score は G4（自分の店の G4 以下）の範囲。
--
-- 変えるもの：表 wr_people に列 chef を足す・関数 4 つ（wr_person_live・wr_person_conf・wr_up・wr_people_sync）と新しい wr_chef。
-- Head Chef でない人の写しと今の形は前と同じ（chef の印は Head Chef のときだけ付ける）ので、ほかの人は確かめの一覧に増えない。
-- 2 回流しても同じ。前の関数（work-requests・secure-state v1143 以前）は列 chef を使わないので、入れたあとも今までどおり動く。

do $$ begin
 if to_regclass('public.wr_people') is null or to_regprocedure('public.wr_person_live(text)') is null then
  raise exception '先に 20261104090000_work_requests.sql（ワークセンターの申請）を流してください。何も変えていません。';
 end if;
end $$;

alter table public.wr_people add column if not exists chef boolean not null default false;

-- 社員の表の肩書き・役割が Head Chef か（関数 secure-state の CHEF_TITLES・役割 chef と同じ）
create or replace function public.wr_chef(p_title text, p_role text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_role, '') = 'chef' or btrim(coalesce(p_title, '')) in ('Head Chef', 'Corporate Chef');
$$;

-- 今の社員の表と店の表から見た人（20261104090000 と同じ。Head Chef なら chef: true を足す）
create or replace function public.wr_person_live(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; v_stores text[]; v_am text[];
begin
 select * into e from public.employees x where x.id::text = p_emp;
 if not found or public.wr_emp_out(e) then return null; end if;
 select coalesce(array_agg(distinct s order by s), '{}'::text[]) into v_stores from (
  select nullif(btrim(e.store), '') as s
  union all
  select nullif(btrim(x), '') from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(e.support)) = 'array' then to_jsonb(e.support) else '[]'::jsonb end) x
 ) q where s is not null;
 if e.role = 'am' then
  select coalesce(array_agg(st.id::text order by st.id::text), '{}'::text[]) into v_am from public.stores st
   where btrim(coalesce(st.am, '')) <> '' and btrim(st.am) = btrim(e.name) and coalesce(st.active, true);
 else v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', p_emp, 'name', btrim(coalesce(e.name, '')), 'role', case when e.role = 'am' then 'am' else 'staff' end,
  'grade', public.wr_grade(e.title, e.role), 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am))
  || case when public.wr_chef(e.title, e.role) then jsonb_build_object('chef', true) else '{}'::jsonb end;
end $$;

-- GM・CEO が確かめた写し（同じ形。確かめた Head Chef なら chef: true）。無ければ null。
create or replace function public.wr_person_conf(p_emp text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('emp', c.emp_id, 'name', c.name, 'role', c.role, 'grade', c.grade, 'stores', to_jsonb(c.stores), 'am_stores', to_jsonb(c.am_stores))
   || case when c.chef then jsonb_build_object('chef', true) else '{}'::jsonb end
  from public.wr_people c where c.emp_id = p_emp;
$$;

-- 写しより今のほうが権限が増えるか（20261104090000 の決まりに「Head Chef になる」を足す）
create or replace function public.wr_up(b jsonb, a jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select public.wr_elevated(a) and (b is null
  or ((a->>'role') = 'am' and (b->>'role') <> 'am')
  or (a->>'grade')::int > (b->>'grade')::int
  or not (public.wr_arr(a->'stores') <@ public.wr_arr(b->'stores'))
  or not (public.wr_arr(a->'am_stores') <@ public.wr_arr(b->'am_stores'))
  or (a->>'name') is distinct from (b->>'name')
  or (coalesce(a->>'chef', '') = 'true' and coalesce(b->>'chef', '') <> 'true'));
$$;

-- GM・CEO：見た一覧（digest）のとおりに写しを更新する（20261104090000 と同じ。chef も写す）
create or replace function public.wr_people_sync(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v jsonb; x jsonb; n integer := 0; af jsonb; v_pick text[];
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if coalesce(p->>'digest', '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_value'; end if;
 if p ? 'emps' and jsonb_typeof(p->'emps') <> 'array' then raise exception 'bad_value'; end if;
 v_pick := case when jsonb_typeof(p->'emps') = 'array' then public.wr_arr(p->'emps') end;
 perform pg_advisory_xact_lock(hashtext('wr_people'));
 v := public.wr_people_items();
 if md5(v::text) <> p->>'digest' then raise exception 'conflict'; end if;
 for x in select * from jsonb_array_elements(v) where v_pick is null or value->>'emp' = any(v_pick) loop
  af := x->'after';
  if jsonb_typeof(af) = 'object' then
   insert into public.wr_people(emp_id, name, role, grade, stores, am_stores, chef, confirmed_by, confirmed_emp, confirmed_at)
    values (x->>'emp', af->>'name', af->>'role', (af->>'grade')::int, public.wr_arr(af->'stores'), public.wr_arr(af->'am_stores'),
     coalesce(af->>'chef', '') = 'true', a->>'name', a->>'emp', now())
    on conflict (emp_id) do update set name = excluded.name, role = excluded.role, grade = excluded.grade, stores = excluded.stores,
     am_stores = excluded.am_stores, chef = excluded.chef, confirmed_by = excluded.confirmed_by, confirmed_emp = excluded.confirmed_emp, confirmed_at = excluded.confirmed_at;
  else
   delete from public.wr_people where emp_id = x->>'emp';
  end if;
  insert into public.wr_people_log(emp_id, before, after, by_emp, by_name)
   values (x->>'emp', case when jsonb_typeof(x->'before') = 'object' then x->'before' end, case when jsonb_typeof(af) = 'object' then af end, a->>'emp', a->>'name');
  n := n + 1;
 end loop;
 return jsonb_build_object('applied', n, 'confirmed', (select count(*) from public.wr_people));
end $$;

-- 呼べるのはサーバーの鍵だけ（20261104090000 と同じ）
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
