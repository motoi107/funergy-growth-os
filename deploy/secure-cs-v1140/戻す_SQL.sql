-- v1140（2b-2）の SQL だけを戻す。Career Score のキーを、また公開の鍵で読み書きできるようにする（v1139 のあとと同じ）。
-- 成長カルテ・賞与のキーは外したまま（v1139）。行・値は何も変えない。2 回流しても同じ。
-- アプリ v1140 は戻さなくても動く（関数 secure-state で読み書きする）。v1139 の SQL も戻すときは db/secure-state-rls-rollback.sql。
create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$', false)   -- spl_bonus_q_<四半期>（2026-Q3 など）
$$;
comment on function public.ss_secret_key(text) is
  'v1139: app_state の成長カルテ・賞与のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey と同じ決まり。';
-- 決まりを作り直す（決まりの関数を置き換えたことを、すぐ効かせる）
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_secret') then
    drop policy ss_secret on public.app_state;
    create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
    comment on policy ss_secret on public.app_state is 'v1139: growth karte / bonus keys go through the secure-state function only';
  end if;
end $$;
notify pgrst, 'reload schema';
