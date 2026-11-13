-- v1152（段階 2b の最後・Moto さん 11/12「2b の残り」・選択肢「店のタブレットには出さない」「会社の設定は今回は外さない」）：
--   通知（app_state の notifications）を、公開の鍵（anon・authenticated）で読めない・書けないようにする。
-- 仕様：docs/SECURE_NOTIFICATIONS_V1152_JA.md。入れる順番：deploy/secure-notifications-v1152/手順.md
--   （関数 secure-state を v1152 に → アプリ v1152 → 全部の端末を 1152 に → この SQL）。
--
-- ・対象のキー（v1139〜v1148 のキーに足す）：notifications（1 行・新しい 500 件の配列）。
--   行は動かさない・書き換えない（app_state のまま）。アプリ v1152 は関数 secure-state（サーバーの鍵）の nt で読み書きする
--   （読むのはログインした人の宛先の分と自分が出した分だけ。書くのは足す・自分の既読と確認の印だけ）。
--   店舗の PIN のタブレット・PIN が初期の人は、関数で足すだけ（読めない）。
-- ・v1139〜v1148 の SQL と同じ作り：決まりを選ぶ関数 ss_secret_key を置き換え、restrictive の決まり ss_secret で外す。
--   v1139〜v1148 の SQL がまだでも、この SQL だけで同じになる（RLS が OFF なら ON にして今までの決まり ss_open を足す）。
--   サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。v1141〜v1146 の決まり（ss_guard_*）はそのまま。
-- ・v1151 の SQL（20261118090000：合図と変更の記録）が入っていれば、機密の区分に notifications を足す（合図は _secure:notifications。
--   アプリは通知だけを読み直す）。v1151 の SQL がまだなら何もしない（あとで v1151 の SQL を流したら、この SQL をもう一度流す）。
-- ・2 回流しても同じ。通知だけ戻すとき：db/secure-notifications-rollback.sql（ほかは外したまま）。
--   v1148 より前の戻す SQL（db/secure-grade-bonus-read-rollback.sql など）は決まりの関数を前の形に置き換えるので、このあとに流すと、通知もまた公開の鍵で読めるようになる。

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
      or k in ('grade_hist', 'bonus_eval_ovr', 'bonus_track')             -- v1148：グレード履歴・賞与の個人設定・G3 の職種
      or k = 'notifications', false)                                      -- v1152：通知
$$;
comment on function public.ss_secret_key(text) is
  'v1152: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄・Tip の期間の確定・注意ログ・グレード履歴・賞与の個人設定・G3 の職種・通知のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey・piiIsKey・scIsKey・gbIsKey・ntIsKey と同じ決まり。';
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
  comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144/v1147/v1148/v1152: growth karte / bonus / Career Score / hiring / consultation / employee personal / tip period confirmation / warning log / grade history / bonus personal settings / G3 track / notification keys go through the secure-state function only';
end $$;

-- v1151 の機密の区分（合図 _secure:<区分> と変更の記録の区分）に通知を足す。v1151 の SQL がまだなら何もしない
do $$
begin
  if to_regprocedure('public.fp_sec_cat(text)') is null then return; end if;
  execute $f$
create or replace function public.fp_sec_cat(k text) returns text
language sql immutable set search_path = public, pg_temp as $b$
  select case
    when k in ('growth_karte', 'karte_pin', 'karte_bonus_config') then 'karte'
    when k in ('bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra', 'bonus_eval_ovr', 'bonus_track') or k like 'spl\_bonus\_q\_%' then 'bonus'
    when k in ('lss_scores', 'lss_requests', 'lss_history') or k like 'lss\_emp\_%' or k like 'spl\_lss\_%' then 'career_score'
    when k in ('applicants', 'reject_log') then 'hiring'
    when k = 'growthhub' then 'growthhub'
    when k = 'emp_pii' then 'pii'
    when k like 'tip\_cf\_%' then 'tip_confirm'
    when k like 'warnings\_%' then 'warnings'
    when k = 'grade_hist' then 'grade_hist'
    when k = 'notifications' then 'notifications'
    else 'secure' end
$b$
$f$;
  execute 'revoke all on function public.fp_sec_cat(text) from public, anon, authenticated';
end $$;

notify pgrst, 'reload schema';
