-- v1139（2b-1）の SQL を戻す。成長カルテ・賞与のキーを、また公開の鍵で読み書きできるようにする（前と同じ）。
-- 行・値は何も変えない。2 回流しても同じ。アプリ v1139 は戻さなくても動く（関数 secure-state で読み書きする）。
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  drop policy if exists ss_secret on public.app_state;
  -- この SQL が RLS を ON にしたときだけ（ss_open に印がある）、ss_open を外して RLS を OFF に戻す
  if exists (select 1 from pg_policy p where p.polrelid = 'public.app_state'::regclass and p.polname = 'ss_open'
               and obj_description(p.oid, 'pg_policy') like 'v1139: RLS was off before%') then
    drop policy if exists ss_open on public.app_state;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state') then
      alter table public.app_state disable row level security;
    end if;
  end if;
end $$;
drop function if exists public.ss_secret_key(text);
notify pgrst, 'reload schema';
