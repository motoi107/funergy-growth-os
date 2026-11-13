-- v1147（2b の 9 つ目）の SQL だけを戻す（20261116090000_secure_tip_cf.sql を入れる前に戻す）。困ったときだけ。
-- ・Tip の期間の確定（tip_cf_）・注意ログ（warnings_）のキーを、また公開の鍵で読み書きできるようにする（v1146 のあとと同じ）。
-- ・成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄は外したまま（決まりの関数を v1144 の形に）。
--   v1141〜v1146 の決まり（ss_guard_*）はそのまま。RLS は ON のまま。行・値は何も変えない。2 回流しても同じ。
-- ・アプリ v1147 は戻さなくても動く（関数 secure-state で読み書きする）。関数を v1146 に戻すときは、先にこの SQL を流す
--   （v1146 の関数とアプリの道は REST なので、この SQL の前に戻すと、v1147 より前の端末は Tip の確定・注意ログを読めない）。
create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$'                         -- spl_bonus_q_<四半期>（v1139）
      or k in ('lss_scores', 'lss_requests', 'lss_history')                -- v1140：Career Score の前の統合行
      or (length(k) > 8 and left(k, 8) = 'lss_emp_')                      -- v1140：点（人ごと）
      or (length(k) > 17 and left(k, 17) = 'spl_lss_requests_')           -- v1140：申請（人ごと）
      or (length(k) > 16 and left(k, 16) = 'spl_lss_history_')            -- v1140：履歴（人ごと）
      or k in ('applicants', 'reject_log', 'growthhub')                   -- v1142：採用（応募者・不採用ログ）・お悩み相談室
      or k = 'emp_pii', false)                                            -- v1144：従業員の個人の欄
$$;
comment on function public.ss_secret_key(text) is
  'v1144: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey・piiIsKey と同じ決まり。';
-- 決まりを作り直す（決まりの関数を置き換えたことを、すぐ効かせる）。決まりが無いときは何もしない（作らない）
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_secret') then
    drop policy ss_secret on public.app_state;
    create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
    comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144: growth karte / bonus / Career Score / hiring / consultation / employee personal keys go through the secure-state function only';
  end if;
end $$;
notify pgrst, 'reload schema';
