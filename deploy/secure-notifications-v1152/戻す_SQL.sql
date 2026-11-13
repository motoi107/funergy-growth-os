-- v1152（2b の最後）の SQL だけを戻す（20261119090000_secure_notifications.sql を入れる前に戻す）。困ったときだけ。
-- ・通知（notifications）を、また公開の鍵で読み書きできるようにする（v1148 のあとと同じ）。
-- ・成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄・Tip の期間の確定・注意ログ・グレード履歴・賞与の個人設定・G3 の職種は外したまま
--  （決まりの関数を v1148 の形に）。RLS は ON のまま。行・値は何も変えない。2 回流しても同じ。
-- ・v1151 の SQL が入っていれば、機密の区分を v1151 の形に戻す（通知の合図は notifications のキーのまま。アプリは通知を読み直す）。
-- ・アプリ v1152 は戻さなくても動く（関数 secure-state の nt で読み書きする）。関数を v1151 以前に戻すときは、先にこの SQL を流す
--  （前の版の関数は通知を扱わないので、アプリは REST で読み書きする。この SQL の前に戻すと、だれも通知を読めない）。
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
-- 決まりを作り直す（決まりの関数を置き換えたことを、すぐ効かせる）。決まりが無いときは何もしない（作らない）
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_secret') then
    drop policy ss_secret on public.app_state;
    create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
    comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144/v1147/v1148: growth karte / bonus / Career Score / hiring / consultation / employee personal / tip period confirmation / warning log / grade history / bonus personal settings / G3 track keys go through the secure-state function only';
  end if;
end $$;
-- v1151 の機密の区分を v1151 の形に（通知を外す）。v1151 の SQL が無ければ何もしない
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
    else 'secure' end
$b$
$f$;
  execute 'revoke all on function public.fp_sec_cat(text) from public, anon, authenticated';
end $$;
notify pgrst, 'reload schema';
