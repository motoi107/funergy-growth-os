-- v1192（20261210090000_md_all_viewers_gm.sql）の SQL だけを戻す。全店を見る AM の写し（app_state の md_all_viewers_gm）を、
-- また公開の鍵で書けるようにする（v1146 のあとと同じ）。行・値は何も変えない（写しの行も残す）。v1141〜v1146 の 14 と spl_tip_requests_ は書けないまま。
-- 2 回流しても同じ。v1146 の SQL（20261115090000）が無ければ何もしない。
-- ★戻すと、AM が写しに自分の行を書き足して、関数 secure-state の人件費の合計（labor）を全店で受け取れる形に戻る（Codex 6986713362 の P2-1）。
--   先に関数 secure-state を前の版に戻してから流す（deploy/labor-totals-v1192/手順.md の「戻すとき」）。関数が v1192 のままなら、全店を見る AM を 0 人にしておく。
do $$
begin
  if to_regprocedure('public.ss_guard_key(text)') is null then return; end if;   -- v1141〜v1146 の SQL が無い（戻すものが無い）
  if not public.ss_guard_key('prep_certs') then return; end if;                 -- v1146 より前（この SQL の前の形ではない・触らない）
  create or replace function public.ss_guard_key(k text) returns boolean
  language sql immutable parallel safe set search_path = public, pg_temp as $f$
    select coalesce(k in ('mileage_config', 'career_cfg',
                          'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide',
                          'grade_hist',
                          'tip_requests', 'prep_tables', 'prep_certs')
                    or (char_length(k) > 17 and left(k, 17) = 'spl_tip_requests_'), false)
  $f$;
  comment on function public.ss_guard_key(text) is
    'v1146: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey・tpIsKey と同じ決まり（v1141 の 2 つ＋v1143 の 8 つ＋v1145 のグレード履歴＋v1146 の Tip Rate・プレップ）。';
end $$;
notify pgrst, 'reload schema';
