-- v1143（段階 2b の 5 つ目）：GM・CEO だけが変える賞与・Career Score の設定も、公開の鍵（anon・authenticated）で書けないようにする（読むのは今までどおり）。
-- 仕様：docs/SECURE_SETTINGS_V1143_JA.md。入れる順番：deploy/secure-settings-v1143/手順.md（関数 secure-state を v1143 に → アプリ v1143 →
-- 全部の端末を 1143 に → この SQL）。
--
-- ・対象のキー（v1141 の 2 つ＋v1143 の 8 つ）：
--     mileage_config（CEO・GM・経理）・career_cfg（GM・CEO）：v1141 と同じ。
--     cs_criteria・bonus_coef・bonus_coef_rng・bonus_track・bonus_eval_rule・bonus_eval_ovr・cs_strength_rule・cs_guide：GM・CEO（今の画面と同じ）。
--   アプリ v1143 はこれを関数 secure-state（サーバーの鍵）で書く。だれが書けるかは関数が決める。
--   行は動かさない・書き換えない（app_state のまま）。読むのは今までどおり（公開の鍵で読める・行の一覧にも出る）。
-- ・中身は v1141 の SQL（20261110090000）と同じで、決まりを選ぶ関数 ss_guard_key のキーが 10 になっただけ。v1141 の SQL がまだでも、この SQL だけで同じになる。
-- ・2 回流しても同じ。戻すとき：db/secure-settings-more-rollback.sql（v1143 の 8 つをまた公開の鍵で書けるようにする。v1141 の 2 つは書けないまま）。

create or replace function public.ss_guard_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('mileage_config', 'career_cfg',
                        'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide'), false)
$$;
comment on function public.ss_guard_key(text) is
  'v1143: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey と同じ決まり（v1141 の 2 つ＋v1143 の 8 つ）。';
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
      comment on policy ss_open on public.app_state is 'v1141: RLS was off before 20261110090000 / 20261112090000 (rollback turns it off again)';   -- v1141 と同じ印（どの戻す SQL も読む）
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
  comment on policy ss_guard_ins on public.app_state is 'v1143: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_upd on public.app_state is 'v1143: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_del on public.app_state is 'v1143: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
end $$;

notify pgrst, 'reload schema';
