-- v1141（段階 2b の 3 つ目）：サーバーが信じて使う設定を、公開の鍵（anon・authenticated）で書けないようにする（読むのは今までどおり）。
-- 仕様：docs/SECURE_SETTINGS_V1141_JA.md。入れる順番：deploy/secure-settings-v1141/手順.md（関数 secure-state を v1141 に → アプリ v1141 →
-- 全部の端末を 1141 に → この SQL）。
--
-- ・対象のキー：
--     mileage_config：ガソリン代の単価（work-requests の wr_mileage_rate が精算の金額に使う）・地図の鍵・往復の既定。書くのは CEO・GM・経理。
--     career_cfg：Score管理（専門職 × グレードの権限。関数 secure-state が Career Score の範囲に使う）。書くのは GM・CEO。
--   アプリ v1141 はこの 2 つを関数 secure-state（サーバーの鍵）で書く。だれが書けるかは関数が決める。
--   行は動かさない・書き換えない（app_state のまま）。読むのは今までどおり（公開の鍵で読める・行の一覧にも出る）。
-- ・決まりを選ぶ関数 ss_guard_key と、restrictive の決まり ss_guard_ins（足す）・ss_guard_upd（直す）・ss_guard_del（消す）。
--   読む（select）の決まりは足さない。サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。
-- ・v1139・v1140 の SQL がまだでも、この SQL だけで同じになる（RLS が OFF なら ON にして今までの決まり ss_open を足す）。
-- ・2 回流しても同じ。戻すとき：db/secure-settings-write-rollback.sql（この 2 つのキーをまた公開の鍵で書けるようにする。ほかは変えない）。

create or replace function public.ss_guard_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('mileage_config', 'career_cfg'), false)
$$;
comment on function public.ss_guard_key(text) is
  'v1141: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey と同じ決まり。';
revoke all on function public.ss_guard_key(text) from public;
grant execute on function public.ss_guard_key(text) to anon, authenticated, service_role;   -- 決まり（RLS）を読むときに要る

do $$
declare rls boolean;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  select c.relrowsecurity into rls from pg_class c where c.oid = 'public.app_state'::regclass;
  if not rls then
    -- RLS が OFF なのに決まりが残っている：ON にすると、今まで効いていなかったその決まりが効き始める。確かめてから（何も変えない）
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state'
               and policyname not in ('ss_open', 'ss_secret', 'ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')) then
      raise exception 'STOP: app_state の RLS が OFF で、効いていない決まり（policy）があります。ON にするとそれが効き始めるので、確かめてから（何も変えていません）';
    end if;
    alter table public.app_state enable row level security;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_open') then
      create policy ss_open on public.app_state as permissive for all to anon, authenticated using (true) with check (true);
      comment on policy ss_open on public.app_state is 'v1139: RLS was off before 20261108090000 (rollback turns it off again)';
    end if;
  end if;
  drop policy if exists ss_guard_ins on public.app_state;
  drop policy if exists ss_guard_upd on public.app_state;
  drop policy if exists ss_guard_del on public.app_state;
  create policy ss_guard_ins on public.app_state as restrictive for insert to anon, authenticated
    with check (not public.ss_guard_key(key::text));
  create policy ss_guard_upd on public.app_state as restrictive for update to anon, authenticated
    using (not public.ss_guard_key(key::text)) with check (not public.ss_guard_key(key::text));
  create policy ss_guard_del on public.app_state as restrictive for delete to anon, authenticated
    using (not public.ss_guard_key(key::text));
  comment on policy ss_guard_ins on public.app_state is 'v1141: mileage_config / career_cfg are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_upd on public.app_state is 'v1141: mileage_config / career_cfg are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_del on public.app_state is 'v1141: mileage_config / career_cfg are written by the secure-state function only (reading is unchanged)';
end $$;

notify pgrst, 'reload schema';
