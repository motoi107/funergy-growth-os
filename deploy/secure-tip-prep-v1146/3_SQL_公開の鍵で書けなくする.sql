-- v1146（段階 2b の 8 つ目）：Tip Rate の申請・決定とプレップの時給の表・認定も、公開の鍵（anon・authenticated）で書けないようにする（読むのは今までどおり）。
-- Moto さん 11/10「Tip Rate とプレップから」「今の画面で決められる人だけ」。仕様：docs/SECURE_TIP_PREP_V1146_JA.md。入れる順番：deploy/secure-tip-prep-v1146/手順.md
-- （関数 secure-state を v1146 に → アプリ v1146 → 全部の端末を 1146 に → この SQL）。
--
-- ・対象のキー（v1145 までの 11＋v1146）：
--     v1141・v1143・v1145 の 11（ガソリン代の設定・Score管理・賞与と Career Score の設定 8 つ・グレード履歴）：今までと同じ。
--     spl_tip_requests_<名前>（人ごとの Tip Rate の申請と決定）・tip_requests（前の統合行）：チップの配分の率（v1092 から）。
--     prep_tables（プレップの Lv と時給の表）・prep_certs（プレップの認定）：プレップの人の時給（v1106 から）。
--   アプリ v1146 はこれを関数 secure-state（サーバーの鍵）で書く。だれが書けるかは関数が決める（今の画面で決められる人と同じ）。
--   行は動かさない・書き換えない（app_state のまま）。読むのは今までどおり（公開の鍵で読める・行の一覧にも出る）。
--   spl_tip_requests_ で始まるキーは、関数が書かない長さ（201 字より長い）でも書けない（アプリはこの名前で始まる行をすべて Tip Rate として読むので）。
-- ・中身は v1145 の SQL（20261114090000）と同じで、決まりを選ぶ関数 ss_guard_key のキーが増えただけ。v1141・v1143・v1145 の SQL がまだでも、この SQL だけで同じになる。
-- ・2 回流しても同じ。戻すとき：db/secure-tip-prep-rollback.sql（Tip Rate・プレップをまた公開の鍵で書けるようにする。v1145 までの 11 は書けないまま）。
-- ・Tip Rate の合図の行（live_tip_rate）・Tip の履歴（spl_tip_history_）・プレップの店の設定（prep_cfg）・プレップの前の記録（prep_history）は対象にしない（今までどおり）。

create or replace function public.ss_guard_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('mileage_config', 'career_cfg',
                        'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide',
                        'grade_hist',
                        'tip_requests', 'prep_tables', 'prep_certs')
                  or (char_length(k) > 17 and left(k, 17) = 'spl_tip_requests_'), false)
$$;
comment on function public.ss_guard_key(text) is
  'v1146: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey・tpIsKey と同じ決まり（v1141 の 2 つ＋v1143 の 8 つ＋v1145 のグレード履歴＋v1146 の Tip Rate・プレップ）。';
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
      comment on policy ss_open on public.app_state is 'v1141: RLS was off before 20261110090000 / 20261112090000 / 20261114090000 / 20261115090000 (rollback turns it off again)';   -- v1141 と同じ印（どの戻す SQL も読む）
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
  comment on policy ss_guard_ins on public.app_state is 'v1146: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_upd on public.app_state is 'v1146: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_del on public.app_state is 'v1146: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
end $$;

notify pgrst, 'reload schema';
