-- v1135：UI案68 の答え（Moto さん 11/03 01:07〜01:18 HST）。仕様：docs/WORK_REQUESTS_V1135_JA.md
-- 先に 1 段目（20261104090000）・2 段目（20261105090000）・v1133（20261106090000）を流してから。2 回流しても同じ。
--
--   ・4B：ガソリン代の ① の承認は GM・CEO（前は「その店の AM（いない店は GM）」）。wr_approver_am をいつも null にする
--     （承認できるか・画面の「次の対応」・知らせが同じ決まりで GM になる）。AM は担当の店の申請を見るだけ（今までどおり）。
--   ・6（A ＋ G3 以上に申請権限）：評価の変更（スキル Lv・Career Score・Tip Rate）を出せるのは
--     GM・CEO が確かめた G4 以上（今までどおり）＋ G3（社員の表の肩書き・役割から決まる 3。確かめの写しは要らない）＋ AM（担当の店）。
--     対象は今までどおり、その店の自分より下のグレードの在籍の人（自分・AM・CEO・GM・経理・事務Crew は不可）。決めるのは GM・CEO。
--     G3 がスキル Lv を直接変えられるのは今のまま（アプリ）。AM は OJT の合格の反映を GM に申請するときに使う（アプリ）。
--     G3 の申請の権限も、AM・G4 以上と同じく GM・CEO が確かめた写し（wr_people）が要る（wr_elevated を G3 以上に・wr_actor の店も写しと今の重なり）。
--     入れたあと、GM・CEO がワークセンターの「承認・閲覧の権限の確かめ」で G3 を確かめるまで、G3 は申請できない（独立レビュー 229d6c7 の P2-2）。
--   ・9B：スキルマトリクスの表示は店で 1 つ（店の全員の表示が変わる）。だれを表示するかは GM・CEO が決める。
--     表 wr_store_views（店・非表示の人の社員 ID・版・変えた人と時刻）。読むのはログインした人みんな・書くのは GM・CEO だけ。
--     関数の名前（wr_view_get・wr_view_save）は前と同じなので、関数 work-requests（handler）は変えない。
--     前の「自分の表示設定」（wr_views・人 × 店）は残すが使わない（9A のあと半日も使っていない）。
--   ・wr_stage は 4（アプリが SQL の段を見る）。
-- 1 段目の SQL をあとで流し直すと wr_approver_am が AM に戻るので、2 段目・v1133・この SQL も順に流し直す（入れる一式の ② は全部を順に入れる）。

do $$ begin
 if to_regprocedure('public.wr_apply_fresh(public.wr_requests)') is null or to_regprocedure('public.wr_act_eval(jsonb)') is null then
  raise exception 'STOP: 先に deploy/work-requests-v1131-v1133 の SQL（1 段目・2 段目・v1133）を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 4B：ガソリン代も GM・CEO の承認
create or replace function public.wr_approver_am(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select null::jsonb;   -- UI案68 の 4B：AM には承認を回さない（前の版は「その店の AM が 1 人だけのとき」の AM）
$$;

-- ---------------------------------------------------------------- 6：G3 も権限の写し（GM・CEO が確かめる）に入れる
-- 写しに入れる人：AM か G3 以上（前は G4 以上）。社員の表で G3 になった・店が増えた変更は、GM・CEO が確かめるまで効かない。
create or replace function public.wr_elevated(x jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select x is not null and jsonb_typeof(x) = 'object' and ((x->>'role') = 'am' or coalesce((x->>'grade')::int, 0) >= 3);
$$;

-- 呼んだ人（1 段目と同じ。v1135 で G3 の店も写しと今の重なりにした）
create or replace function public.wr_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); e public.employees; v_mgr text;
 live jsonb; conf jsonb; v_role text; v_grade integer; v_stores text[]; v_am text[]; v_nm text;
begin
 if v_emp is null or length(v_emp) > 64 then raise exception 'forbidden'; end if;
 select * into e from public.employees x where x.id::text = v_emp;
 if not found or public.wr_emp_out(e) then raise exception 'forbidden'; end if;
 v_nm := coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), btrim(coalesce(e.name, '')));
 select a.role into v_mgr from public.manager_auth a where a.emp_id::text = v_emp and a.role in ('ceo','gm','office','office_crew')
  order by case a.role when 'gm' then 1 when 'ceo' then 2 when 'office' then 3 else 4 end limit 1;
 if v_mgr is not null then
  return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_mgr, 'grade', public.wr_grade(e.title, v_mgr),
   'stores', '[]'::jsonb, 'am_stores', '[]'::jsonb, 'confirmed', true, 'pending', false);
 end if;
 live := public.wr_person_live(v_emp);
 conf := public.wr_person_conf(v_emp);
 if conf is not null then
  v_role := case when (conf->>'role') = 'am' and (live->>'role') = 'am' then 'am' else 'staff' end;
  v_grade := least((conf->>'grade')::int, (live->>'grade')::int);
  v_am := case when v_role = 'am' then public.wr_meet(public.wr_arr(conf->'am_stores'), public.wr_arr(live->'am_stores')) else '{}'::text[] end;
  v_stores := case when v_role = 'am' or v_grade >= 3 then public.wr_meet(public.wr_arr(conf->'stores'), public.wr_arr(live->'stores')) else public.wr_arr(live->'stores') end;   -- v1135：G3 も写しの店だけ
  v_nm := conf->>'name';
 else
  v_role := 'staff'; v_grade := least((live->>'grade')::int, 3); v_stores := public.wr_arr(live->'stores'); v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_role, 'grade', v_grade, 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am),
  'confirmed', conf is not null, 'pending', public.wr_up(conf, live));
end $$;

-- ---------------------------------------------------------------- 6：G3 以上が評価の変更を申請できる
create or replace function public.wr_can_submit_eval(a jsonb, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_store, '') <> '' and (
  -- G4 以上：GM・CEO が確かめた写しと社員の表の狭いほう（今までどおり）
  ((a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) >= 4 and coalesce(a->'confirmed' = 'true'::jsonb, false) and p_store = any(public.wr_arr(a->'stores')))
  -- G3：GM・CEO が確かめた写しの G3（社員の表は公開の鍵で書けるので、写しが無い・確かめ待ちの人は申請できない・独立レビュー 229d6c7 の P2-2）。
  -- 店は写しと今の社員の表の重なり（wr_actor）
  or ((a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) = 3 and coalesce(a->'confirmed' = 'true'::jsonb, false) and p_store = any(public.wr_arr(a->'stores')))
  -- AM：担当の店（OJT の合格の反映を GM に申請する）
  or ((a->>'role') = 'am' and (p_store = any(public.wr_arr(a->'am_stores')) or p_store = any(public.wr_arr(a->'stores')))));
$$;

-- ---------------------------------------------------------------- 9B：店で 1 つの表示（GM・CEO が決める）
create table if not exists public.wr_store_views (
  store_id text primary key,
  hidden text[] not null default '{}'::text[],
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_emp text,
  updated_by_name text
);
alter table public.wr_store_views enable row level security;
revoke all on public.wr_store_views from public, anon, authenticated;
grant select, insert, update, delete on public.wr_store_views to service_role;

create or replace function public.wr_view_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_store text := p->>'store'; v public.wr_store_views;
begin
 if v_store is null or v_store !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 select * into v from public.wr_store_views x where x.store_id = v_store;
 return jsonb_build_object('store', v_store, 'store_view', true, 'hidden', to_jsonb(coalesce(v.hidden, '{}'::text[])), 'rev', coalesce(v.rev, 0),
  'updated_at', v.updated_at, 'updated_by', v.updated_by_name, 'can_edit', (a->>'role') in ('ceo','gm'));
end $$;

create or replace function public.wr_view_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_store text := p->>'store'; v public.wr_store_views; v_hidden text[]; v_exp integer;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if v_store is null or v_store !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'hidden') <> 'array' or jsonb_array_length(p->'hidden') > 500 or jsonb_typeof(p->'expect_rev') <> 'number' then raise exception 'bad_value'; end if;
 select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_hidden from jsonb_array_elements_text(p->'hidden') x;
 if exists (select 1 from unnest(v_hidden) x where x !~ '^[A-Za-z0-9_.:-]{1,64}$') then raise exception 'bad_value'; end if;
 v_exp := (p->>'expect_rev')::int;
 select * into v from public.wr_store_views x where x.store_id = v_store for update;
 if not found then
  if v_exp <> 0 then raise exception 'conflict'; end if;
  insert into public.wr_store_views(store_id, hidden, rev, updated_at, updated_by_emp, updated_by_name)
   values (v_store, v_hidden, 1, now(), a->>'emp', a->>'name')
   on conflict (store_id) do nothing returning * into v;
  if v.store_id is null then raise exception 'conflict'; end if;
 else
  if v.rev <> v_exp then raise exception 'conflict'; end if;
  update public.wr_store_views set hidden = v_hidden, rev = v.rev + 1, updated_at = now(), updated_by_emp = a->>'emp', updated_by_name = a->>'name'
   where store_id = v.store_id returning * into v;
 end if;
 return jsonb_build_object('store', v.store_id, 'store_view', true, 'hidden', to_jsonb(v.hidden), 'rev', v.rev, 'updated_at', v.updated_at,
  'updated_by', v.updated_by_name, 'can_edit', true);
end $$;

-- ---------------------------------------------------------------- SQL の段
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 4) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
