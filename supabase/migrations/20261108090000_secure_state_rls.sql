-- v1139（段階 2b の 1 つ目）：成長カルテ・賞与のキーを、公開の鍵（anon・authenticated）で読み書きできないようにする。
-- 仕様：docs/SECURE_STATE_V1139_JA.md。入れる順番：deploy/secure-state-v1139/手順.md（関数 secure-state → アプリ v1139 → 全部の端末を 1139 に → この SQL）。
--
-- ・対象のキー：growth_karte・karte_pin・karte_bonus_config・bonus_q・bonus_eval・bonus_store_q・bonus_rules・bonus_pool_extra・spl_bonus_q_<四半期>。
--   行は動かさない・書き換えない（app_state のまま）。アプリ v1139 はこの行を関数 secure-state（サーバーの鍵）で読み書きする。
-- ・app_state の RLS（行ごとの決まり）：
--     RLS が OFF のとき：ON にし、今までと同じに読み書きできる決まり ss_open（anon・authenticated・すべての行）を足す。
--     RLS が ON のとき：今の決まりはそのまま。
--   どちらも、対象のキーの行だけを外す決まり ss_secret（restrictive：ほかの決まりと「かつ」）を足す。
--   サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。
-- ・2 回流しても同じ。戻すとき：db/secure-state-rls-rollback.sql。

create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$', false)   -- spl_bonus_q_<四半期>（2026-Q3 など）
$$;
comment on function public.ss_secret_key(text) is
  'v1139: app_state の成長カルテ・賞与のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey と同じ決まり。';
revoke all on function public.ss_secret_key(text) from public;
grant execute on function public.ss_secret_key(text) to anon, authenticated, service_role;   -- 決まり（RLS）を読むときに要る

do $$
declare rls boolean;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  select c.relrowsecurity into rls from pg_class c where c.oid = 'public.app_state'::regclass;
  if not rls then
    -- RLS が OFF なのに決まりが残っている：ON にすると、今まで効いていなかったその決まりが効き始める。確かめてから（何も変えない）
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname not in ('ss_open', 'ss_secret')) then
      raise exception 'STOP: app_state の RLS が OFF で、効いていない決まり（policy）があります。ON にするとそれが効き始めるので、確かめてから（何も変えていません）';
    end if;
    alter table public.app_state enable row level security;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_open') then
      create policy ss_open on public.app_state as permissive for all to anon, authenticated using (true) with check (true);
      comment on policy ss_open on public.app_state is 'v1139: RLS was off before 20261108090000 (rollback turns it off again)';
    end if;
  end if;
  drop policy if exists ss_secret on public.app_state;
  create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
    using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
  comment on policy ss_secret on public.app_state is 'v1139: growth karte / bonus keys go through the secure-state function only';
end $$;

notify pgrst, 'reload schema';
