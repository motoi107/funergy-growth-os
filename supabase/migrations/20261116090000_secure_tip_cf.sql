-- v1147（段階 2b の 9 つ目・Moto さん 11/10「読む人も書く人も絞る」）：Tip の期間の確定と注意ログを、公開の鍵（anon・authenticated）で読み書きできないようにする。
-- 仕様：docs/SECURE_TIP_CF_V1147_JA.md。入れる順番：deploy/secure-tip-cf-v1147/手順.md（関数 secure-state を v1147 に → アプリ v1147 → 全部の端末を 1147 に → この SQL）。
--
-- ・対象のキー（v1139〜v1144 のキーに足す）：tip_cf_<店>_<年>（Tip の期間の確定。人ごとの最終チップ額が入る）・warnings_<店>（注意ログ）。
--   行は動かさない・書き換えない（app_state のまま）。アプリ v1147 はこの行を関数 secure-state（サーバーの鍵）で読み書きする（見られる店の分だけ・書けるのも決めた人だけ）。
-- ・キーの決まりは前に何かが付いているかだけ（長さによらない：長いキーも公開の鍵では読めない。関数が読み書きするのは 200 字まで）。
-- ・v1139〜v1144 の SQL と同じ作り：決まりを選ぶ関数 ss_secret_key を置き換え、restrictive の決まり ss_secret で外す。
--   v1139〜v1144 の SQL がまだでも、この SQL だけで同じになる（RLS が OFF なら ON にして今までの決まり ss_open を足す）。
--   サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。v1141〜v1146 の決まり（ss_guard_*）はそのまま。
-- ・2 回流しても同じ。この 2 つだけ戻すとき：db/secure-tip-cf-rollback.sql（ほかは外したまま）。
--   v1144 より前の戻す SQL（db/secure-pii-rollback.sql など）は決まりの関数を前の形に置き換えるので、このあとに流すと、この 2 つも公開の鍵で読めるようになる。

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
      or (length(k) > 9 and left(k, 9) = 'warnings_'), false)             -- v1147：注意ログ（店ごと）
$$;
comment on function public.ss_secret_key(text) is
  'v1147: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄・Tip の期間の確定・注意ログのキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey・piiIsKey・scIsKey と同じ決まり。';
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
  comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144/v1147: growth karte / bonus / Career Score / hiring / consultation / employee personal / tip period confirmation / warning log keys go through the secure-state function only';
end $$;

notify pgrst, 'reload schema';
