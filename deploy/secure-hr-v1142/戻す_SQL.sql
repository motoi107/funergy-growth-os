-- v1142（2b の 4 つ目）の SQL だけを戻す。採用（応募者・不採用ログ）・お悩み相談室のキーを、また公開の鍵で読み書きできるようにする（v1140 のあとと同じ）。
-- 成長カルテ・賞与・Career Score のキーは外したまま（v1139・v1140）。行・値は何も変えない。2 回流しても同じ。
-- アプリ v1142 は戻さなくても動く（関数 secure-state で読み書きする）。
-- 気をつけること：v1140 の戻す SQL（db/secure-cs-rls-rollback.sql）・v1139 の戻す SQL は、決まりの関数をその版より前の形に置き換えるので、
--   v1142 のあとに流すと、採用・相談のキーも公開の鍵で読めるようになる。
create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$'                         -- spl_bonus_q_<四半期>（v1139）
      or k in ('lss_scores', 'lss_requests', 'lss_history')                -- v1140：Career Score の前の統合行
      or (length(k) > 8 and left(k, 8) = 'lss_emp_')                      -- v1140：点（人ごと）
      or (length(k) > 17 and left(k, 17) = 'spl_lss_requests_')           -- v1140：申請（人ごと）
      or (length(k) > 16 and left(k, 16) = 'spl_lss_history_'), false)   -- v1140：履歴（人ごと）
$$;
comment on function public.ss_secret_key(text) is
  'v1140: app_state の成長カルテ・賞与・Career Score のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey と同じ決まり。';
-- 決まりを作り直す（決まりの関数を置き換えたことを、すぐ効かせる）
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_secret') then
    drop policy ss_secret on public.app_state;
    create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
      using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
    comment on policy ss_secret on public.app_state is 'v1139/v1140: growth karte / bonus / Career Score keys go through the secure-state function only';
  end if;
end $$;
notify pgrst, 'reload schema';
