-- v1148（段階 2b の 10 個目・Moto さん 11/10「Career Score と同じ範囲に」）：グレード履歴・賞与の個人設定・G3 の職種を、公開の鍵（anon・authenticated）で読めないようにする。
-- 仕様：docs/SECURE_GRADE_BONUS_READ_V1148_JA.md。入れる順番：deploy/secure-grade-bonus-read-v1148/手順.md（関数 secure-state を v1148 に → アプリ v1148 → 全部の端末を 1148 に → この SQL）。
--
-- ・対象のキー（v1139〜v1147 のキーに足す）：grade_hist（グレード履歴）・bonus_eval_ovr（賞与の個人設定）・bonus_track（G3 の職種）。
--   行は動かさない・書き換えない（app_state のまま）。アプリ v1148 はこの 3 つを関数 secure-state（サーバーの鍵）で読む
--   （CEO・GM＝全部／経理・事務Crew＝グレード履歴は全部・ほかの 2 つは Career Score で見られる人と本人／ほかの人＝Career Score で見られる人と本人の分だけ）。
--   書くのは前から GM・CEO だけ（v1143・v1145 の決まり ss_guard_* と関数）。この SQL は読むのも止める。
-- ・v1139〜v1147 の SQL と同じ作り：決まりを選ぶ関数 ss_secret_key を置き換え、restrictive の決まり ss_secret で外す。
--   v1139〜v1147 の SQL がまだでも、この SQL だけで同じになる（RLS が OFF なら ON にして今までの決まり ss_open を足す）。
--   サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。v1141〜v1146 の決まり（ss_guard_*）はそのまま。
-- ・2 回流しても同じ。この 3 つだけ戻すとき：db/secure-grade-bonus-read-rollback.sql（ほかは外したまま）。
--   v1147 より前の戻す SQL（db/secure-tip-cf-rollback.sql など）は決まりの関数を前の形に置き換えるので、このあとに流すと、この 3 つも公開の鍵で読めるようになる。

create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$'                         -- spl_bonus_q_<四半期>（v1139）
      or k in ('lss_scores', 'lss_requests', 'lss_history')                -- v1140：Career Score の前の統合行
      or (length(k) > 8 and left(k, 8) = 'lss_emp_')                      -- v1140：点（人ごと）
      or (length(k) > 17 and left(k, 17) = 'spl_lss_requests_')           -- v1140：申請（人ごと）
      or (length(k) > 16 and left(k, 16) = 'spl_lss_history_')            -- v1140：履歴（人ごと）
      or k in ('applicants', 'reject_log', 'growthhub')                   -- v1142：採用（応募者・不採用ログ）・お悩み相談室
      or k = 'emp_pii'                                                    -- v1144：従業員の個人の欄
      or (length(k) > 7 and left(k, 7) = 'tip_cf_')                       -- v1147：Tip の期間の確定（店・年ごと）
      or (length(k) > 9 and left(k, 9) = 'warnings_')                     -- v1147：注意ログ（店ごと）
      or k in ('grade_hist', 'bonus_eval_ovr', 'bonus_track'), false)     -- v1148：グレード履歴・賞与の個人設定・G3 の職種
$$;
comment on function public.ss_secret_key(text) is
  'v1148: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄・Tip の期間の確定・注意ログ・グレード履歴・賞与の個人設定・G3 の職種のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey・piiIsKey・scIsKey・gbIsKey と同じ決まり。';
revoke all on function public.ss_secret_key(text) from public;
grant execute on function public.ss_secret_key(text) to anon, authenticated, service_role;   -- 決まり（RLS）を読むときに要る

do $$
declare rls boolean;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  select c.relrowsecurity into rls from pg_class c where c.oid = 'public.app_state'::regclass;
  if not rls then
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
  drop policy if exists ss_secret on public.app_state;
  create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
    using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
  comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144/v1147/v1148: growth karte / bonus / Career Score / hiring / consultation / employee personal / tip period confirmation / warning log / grade history / bonus personal settings / G3 track keys go through the secure-state function only';
end $$;

notify pgrst, 'reload schema';
