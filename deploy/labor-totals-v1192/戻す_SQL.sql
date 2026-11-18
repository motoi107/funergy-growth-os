-- v1192（20261210090000_md_all_viewers_gm.sql）の SQL だけを戻す。全店を見る AM の写し（app_state の md_all_viewers_gm）を、
-- また公開の鍵で書けるようにし（v1146 のあとと同じ）、関数 md_all_viewers_gm_trusted を消す。行・値は何も変えない（写しの行も残す）。
-- v1141〜v1146 の 14 と spl_tip_requests_ は書けないまま。2 回流しても同じ。v1146 の SQL（20261115090000）が無ければ何もしない。
-- ★先に関数 secure-state を前の版（deploy/secure-notifications-v1152/2_関数_secure-state_index.ts）に戻してから流す
--   （deploy/labor-totals-v1192/手順.md の「戻すとき」）。関数を v1192 のまま残すなら、この SQL は流さない（写しの守りも残す）。
--   順番を間違えても、v1192 の関数は md_all_viewers_gm_trusted が無い・false なら写しを使わない（全店を見る AM も担当の店だけ。Codex 6989812896 の P2-3）。
-- ・戻したあとにもう一度 20261210090000 を入れるときは、写しが守られていないので止まる。deploy の 1b（db/md-all-viewers-gm-discard.sql）で
--   写しを捨ててから入れ、GM・CEO が付け直す。
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
drop function if exists public.md_all_viewers_gm_trusted();
notify pgrst, 'reload schema';
