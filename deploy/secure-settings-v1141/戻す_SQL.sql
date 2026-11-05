-- v1141（2b-3）の SQL だけを戻す。ガソリン代の設定（mileage_config）と Score管理（career_cfg）を、また公開の鍵で書けるようにする（v1140 のあとと同じ）。
-- 行・値は何も変えない。成長カルテ・賞与・Career Score（v1139・v1140）は外したまま。2 回流しても同じ。
-- アプリ v1141 は戻さなくても動く（関数 secure-state で書く）。
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  drop policy if exists ss_guard_ins on public.app_state;
  drop policy if exists ss_guard_upd on public.app_state;
  drop policy if exists ss_guard_del on public.app_state;
  -- この SQL が RLS を ON にしたときだけ（ss_open に v1141 の印がある）、ほかの決まりが残っていなければ ss_open を外して RLS を OFF に戻す
  if exists (select 1 from pg_policy p where p.polrelid = 'public.app_state'::regclass and p.polname = 'ss_open'
               and obj_description(p.oid, 'pg_policy') like 'v1141: RLS was off before%')
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname <> 'ss_open') then
    drop policy if exists ss_open on public.app_state;
    alter table public.app_state disable row level security;
  end if;
end $$;
drop function if exists public.ss_guard_key(text);
notify pgrst, 'reload schema';
